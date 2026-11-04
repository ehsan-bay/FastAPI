from concurrent.futures import ThreadPoolExecutor


def new_user(client, email):
    r = client.post("/api/auth/register", json={"email": email, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["user"]


def first_doctor(client, admin):
    docs = client.get("/api/admin/doctors", headers=admin).json()
    assert len(docs) >= 5  # sample doctors are created on startup
    return docs[0]


def test_new_user_gets_initial_wallet(client):
    h, user = new_user(client, "wallet1@test.com")
    assert user["wallet_balance"] == 5_000_000 and user["is_admin"] is False
    w = client.get("/api/wallet", headers=h).json()
    assert w["balance"] == 5_000_000 and w["transactions"][0]["kind"] == "initial"


def test_pay_flow_moves_money_to_doctor(client, admin):
    h, _ = new_user(client, "payer@test.com")
    doc = first_doctor(client, admin)
    info = client.get(f"/api/pay/doctors/{doc['qr_token']}", headers=h).json()
    assert info["name"] == doc["name"] and info["fee"] == 50_000 and info["ipg_enabled"] is False
    assert set(info) >= {"name", "specialty", "fee"}

    r = client.post("/api/pay", headers=h, json={"token": doc["qr_token"], "amount": 120_000, "method": "wallet"})
    body = r.json()
    assert r.status_code == 200, body
    assert body["wallet_balance"] == 4_880_000 and body["ref"].startswith("SY") and body["doctor"] == doc["name"]

    after = [d for d in client.get("/api/admin/doctors", headers=admin).json() if d["id"] == doc["id"]][0]
    assert after["balance"] == doc["balance"] + 120_000
    rep = client.get("/api/payments", headers=h).json()
    assert rep["count"] == 1 and rep["total"] == 120_000 and rep["by_doctor"][0]["doctor"] == doc["name"]
    assert client.get(f"/api/payments/{body['id']}", headers=h).json()["ref"] == body["ref"]


def test_ipg_is_shown_but_disabled(client, admin):
    h, _ = new_user(client, "ipg@test.com")
    doc = first_doctor(client, admin)
    r = client.post("/api/pay", headers=h, json={"token": doc["qr_token"], "amount": 50_000, "method": "ipg"})
    assert r.status_code == 400 and "درگاه" in r.json()["detail"]
    assert client.get("/api/wallet", headers=h).json()["balance"] == 5_000_000


def test_insufficient_balance_and_bad_input(client, admin):
    h, _ = new_user(client, "poor@test.com")
    doc = first_doctor(client, admin)
    r = client.post("/api/pay", headers=h, json={"token": doc["qr_token"], "amount": 6_000_000})
    assert r.status_code == 400 and "موجودی" in r.json()["detail"]
    assert client.post("/api/pay", headers=h, json={"token": doc["qr_token"], "amount": 0}).status_code == 422
    assert client.post("/api/pay", headers=h, json={"token": "nope-nope", "amount": 1000}).status_code == 404
    assert client.get("/api/wallet", headers=h).json()["balance"] == 5_000_000


def test_no_double_spend_under_concurrency(client, admin):
    h, _ = new_user(client, "race@test.com")
    doc = first_doctor(client, admin)

    def pay(_):
        return client.post("/api/pay", headers=h, json={"token": doc["qr_token"], "amount": 2_000_000}).status_code

    with ThreadPoolExecutor(6) as ex:
        codes = list(ex.map(pay, range(6)))
    assert codes.count(200) == 2  # 5,000,000 covers exactly two payments of 2,000,000
    assert client.get("/api/wallet", headers=h).json()["balance"] == 1_000_000


def test_admin_only(client):
    h, _ = new_user(client, "notadmin@test.com")
    for path in ("/api/admin/overview", "/api/admin/doctors", "/api/admin/payments", "/api/admin/users", "/api/admin/settings"):
        assert client.get(path, headers=h).status_code == 403
    assert client.get("/api/admin/doctors").status_code == 401


def test_admin_manages_doctors_settings_and_wallets(client, admin):
    d = client.post("/api/admin/doctors", headers=admin, json={"name": "دکتر تست", "specialty": "اطفال"}).json()
    assert d["fee"] == 50_000 and d["qr_token"]
    d = client.patch(f"/api/admin/doctors/{d['id']}", headers=admin, json={"fee": 80_000}).json()
    assert d["fee"] == 80_000
    old = d["qr_token"]
    d = client.post(f"/api/admin/doctors/{d['id']}/new-qr", headers=admin).json()
    assert d["qr_token"] != old

    h, user = new_user(client, "patient2@test.com")
    assert client.get(f"/api/pay/doctors/{old}", headers=h).status_code == 404  # old QR no longer works
    client.post("/api/pay", headers=h, json={"token": d["qr_token"], "amount": 80_000})
    settled = client.post(f"/api/admin/doctors/{d['id']}/settle", headers=admin, json={"note": "واریز"}).json()
    assert settled["balance"] == 0
    assert client.post(f"/api/admin/doctors/{d['id']}/settle", headers=admin, json={}).status_code == 400
    assert client.get("/api/admin/settlements", headers=admin).json()[0]["amount"] == 80_000

    client.patch(f"/api/admin/doctors/{d['id']}", headers=admin, json={"active": False})
    assert client.get(f"/api/pay/doctors/{d['qr_token']}", headers=h).status_code == 404

    s = client.put("/api/admin/settings", headers=admin, json={"default_fee": 70_000, "initial_wallet": 1_000_000}).json()
    assert s["default_fee"] == 70_000 and s["ipg_enabled"] is False
    _, u3 = new_user(client, "after-settings@test.com")
    assert u3["wallet_balance"] == 1_000_000
    client.put("/api/admin/settings", headers=admin, json={"default_fee": 50_000, "initial_wallet": 5_000_000})

    r = client.post(f"/api/admin/users/{user['id']}/wallet", headers=admin, json={"amount": 500_000, "note": "هدیه"})
    assert r.json()["wallet_balance"] == 5_000_000 - 80_000 + 500_000
    assert client.post(f"/api/admin/users/{user['id']}/wallet", headers=admin, json={"amount": -99_000_000}).status_code == 400

    ov = client.get("/api/admin/overview", headers=admin, params={"tz_offset": -210}).json()
    assert ov["payments"]["count"] >= 1 and ov["users"] >= 2 and len(ov["series"]) == 30
    pays = client.get("/api/admin/payments", headers=admin, params={"doctor_id": d["id"]}).json()
    assert pays["count"] == 1 and pays["items"][0]["email"] == "patient2@test.com"
    users = client.get("/api/admin/users", headers=admin, params={"q": "patient2"}).json()
    assert users[0]["payments"] == 1


def test_backfill_existing_users(client):
    """Users that existed before wallets get the initial credit at startup."""
    from sqlmodel import Session

    from app.bootstrap import backfill_wallets
    from app.db import User, engine
    from app.auth import hash_password

    with Session(engine) as s:
        u = User(email="legacy@test.com", password_hash=hash_password("x12345"))
        s.add(u)
        s.commit()
        backfill_wallets(s)
        s.refresh(u)
        assert u.wallet_balance == 5_000_000


def test_admin_password_from_env_resets_login(client):
    from sqlmodel import Session

    from app import bootstrap
    from app.db import engine

    old = bootstrap.settings.admin_password
    try:
        bootstrap.settings.admin_password = "new-admin-pass-9"
        with Session(engine) as s:
            bootstrap.ensure_admin(s)
        r = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "new-admin-pass-9"})
        assert r.status_code == 200 and r.json()["user"]["is_admin"]
    finally:
        bootstrap.settings.admin_password = old
        with Session(engine) as s:
            bootstrap.ensure_admin(s)
