"""Caregiver follow-up, refill reminders, estimated HbA1c, doctor report link, period tracking."""
from datetime import date, datetime, timedelta, timezone


def user(client, email, name="کاربر"):
    r = client.post("/api/auth/register", json={"email": email, "password": "secret123", "name": name})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def noon_offset() -> int:
    """tz_offset that makes the local time 12:00 now, so a 10:00 dose is overdue and a 23:00 one is not."""
    n = datetime.now(timezone.utc)
    return n.hour * 60 + n.minute - 12 * 60


def test_refill_stock_counts_down_and_warns(client):
    h = user(client, "refill@t.io")
    m = client.post("/api/meds", headers=h, json={"name": "متفورمین", "times": ["08:00", "20:00"], "stock": 12, "per_dose": 1}).json()
    assert m["refill"]["days_left"] == 6 and m["refill"]["low"] is False
    r = client.post(f"/api/meds/{m['id']}/log", headers=h, json={"status": "taken"}).json()
    assert r["refill"]["stock"] == 11 and r["refill"]["days_left"] == 5 and r["refill"]["low"] is True
    client.post(f"/api/meds/{m['id']}/log", headers=h, json={"status": "skipped"})
    assert client.get("/api/meds", headers=h).json()[0]["refill"]["stock"] == 11  # skipped dose uses no pill
    m2 = client.post(f"/api/meds/{m['id']}/refill", headers=h, json={"amount": 30}).json()
    assert m2["refill"]["stock"] == 41 and m2["refill"]["low"] is False
    plain = client.post("/api/meds", headers=h, json={"name": "ویتامین", "times": ["09:00"]}).json()
    assert plain["refill"] is None


def test_estimated_a1c(client):
    h = user(client, "a1c@t.io")
    assert client.get("/api/vitals/a1c", headers=h).json()["available"] is False
    from sqlmodel import Session

    from app.db import User, Vital, engine
    with Session(engine) as s:
        uid = s.exec(__import__("sqlmodel").select(User).where(User.email == "a1c@t.io")).one().id
        for i in range(12):  # 12 readings over 11 days, mean 154 -> (154+46.7)/28.7 = 7.0
            s.add(Vital(user_id=uid, kind="glucose", value=154, created_at=datetime.now(timezone.utc) - timedelta(days=i)))
        s.commit()
    r = client.get("/api/vitals/a1c", headers=h).json()
    assert r["available"] and r["value"] == 7.0 and r["level"] == "danger" and r["readings"] == 12


def test_caregiver_flow_and_alerts(client):
    patient = user(client, "patient@t.io", "پدر")
    child = user(client, "child@t.io", "علی")
    stranger = user(client, "stranger@t.io")
    inv = client.post("/api/care/invite", headers=patient, json={"label": "پسرم"}).json()
    assert len(inv["code"]) == 6
    assert client.post("/api/care/join", headers=patient, json={"code": inv["code"]}).status_code == 400  # own code
    r = client.post("/api/care/join", headers=child, json={"code": inv["code"].lower()})
    assert r.status_code == 200 and r.json()["patient"] == "پدر"
    assert client.post("/api/care/join", headers=stranger, json={"code": inv["code"]}).status_code == 404  # used up

    tz = noon_offset()
    client.post("/api/meds", headers=patient, json={"name": "آملودیپین", "times": ["10:00", "23:00"], "stock": 3})
    client.post("/api/vitals", headers=patient, json={"kind": "bp", "value": 185, "value2": 115})
    alerts = client.get("/api/care/alerts", headers=child, params={"tz_offset": tz}).json()
    kinds = {a["kind"] for a in alerts}
    assert {"missed_dose", "vital", "refill"} <= kinds, alerts
    miss = next(a for a in alerts if a["kind"] == "missed_dose")
    assert "۱۰:۰۰" in miss["text"] and miss["patient"] == "پدر"

    pid = next(f for f in client.get("/api/care", headers=child).json()["following"])["patient_id"]
    detail = client.get(f"/api/care/patient/{pid}", headers=child, params={"tz_offset": tz}).json()
    assert detail["vitals"]["bp"]["level"] == "danger" and detail["meds"][0]["missed"] == 1
    assert client.get(f"/api/care/patient/{pid}", headers=stranger).status_code == 404

    # taking the dose clears the missed alert
    mid = client.get("/api/meds", headers=patient).json()[0]["id"]
    client.post(f"/api/meds/{mid}/log", headers=patient, json={"status": "taken"})
    alerts = client.get("/api/care/alerts", headers=child, params={"tz_offset": tz}).json()
    assert "missed_dose" not in {a["kind"] for a in alerts}

    # the patient sees and removes the caregiver
    followers = client.get("/api/care", headers=patient).json()["followers"]
    assert followers[0]["caregiver"] == "علی" and followers[0]["status"] == "active" and followers[0]["code"] is None
    assert client.delete(f"/api/care/{followers[0]['link_id']}", headers=stranger).status_code == 404
    assert client.delete(f"/api/care/{followers[0]['link_id']}", headers=patient).status_code == 200
    assert client.get("/api/care/alerts", headers=child).json() == []


def test_report_link(client):
    h = user(client, "report@t.io", "مریم رضایی")
    client.post("/api/vitals", headers=h, json={"kind": "bp", "value": 128, "value2": 82})
    client.post("/api/vitals", headers=h, json={"kind": "glucose", "value": 260})
    client.post("/api/meds", headers=h, json={"name": "لوزارتان", "dose": "۵۰ میلی‌گرم", "times": ["08:00"]})
    link = client.post("/api/report/link", headers=h, json={"days": 30}).json()
    r = client.get(link["path"])
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    body = r.text
    assert "مریم رضایی" in body and "لوزارتان" in body and "فشار خون" in body and "۱۲۸/۸۲" in body
    assert 'class="danger"' in body  # glucose 210 marked
    token = link["path"].split("t=")[1]
    # the report token must never work as a login
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.get("/api/report/view", params={"t": token + "x"}).status_code == 404
    import jwt

    from app.config import settings
    old = jwt.encode({"rid": 1, "purpose": "doctor-report", "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
                     settings.secret_key, algorithm="HS256")
    assert client.get("/api/report/view", params={"t": old}).status_code == 410
    login = jwt.encode({"sub": "1", "exp": datetime.now(timezone.utc) + timedelta(days=1)}, settings.secret_key, algorithm="HS256")
    assert client.get("/api/report/view", params={"t": login}).status_code == 404  # a login token is not a report link


def test_cycle_prediction(client):
    h = user(client, "cycle@t.io")
    today = date.today()
    starts = [today - timedelta(days=d) for d in (88, 58, 29)]  # gaps 30, 29
    for s in starts:
        r = client.post("/api/cycle", headers=h, json={"start": s.isoformat(), "end": (s + timedelta(days=4)).isoformat(),
                                                         "flow": "medium", "symptoms": ["cramps", "bogus"]})
        assert r.status_code == 200, r.text
        assert r.json()["symptoms"] == ["cramps"]
    p = client.get("/api/cycle", headers=h, params={"today": today.isoformat()}).json()["prediction"]
    assert p["cycle_length"] == 30 and p["period_length"] == 5 and p["cycle_day"] == 30
    assert p["next_start"] == (starts[-1] + timedelta(days=30)).isoformat() and p["days_to_next"] == 1
    assert p["ovulation"] == (starts[-1] + timedelta(days=16)).isoformat() and p["phase"] == "luteal"
    assert client.post("/api/cycle", headers=h, json={"start": starts[-1].isoformat()}).status_code == 400  # duplicate
    assert client.post("/api/cycle", headers=h, json={"start": (today + timedelta(days=5)).isoformat()}).status_code == 422
    r = client.post("/api/cycle", headers=h, json={"start": today.isoformat()}).json()  # period started today, still open
    p = client.get("/api/cycle", headers=h, params={"today": today.isoformat()}).json()["prediction"]
    assert p["phase"] == "period" and p["cycle_day"] == 1
    other = user(client, "cycle2@t.io")
    assert client.delete(f"/api/cycle/{r['id']}", headers=other).status_code == 404


def test_jalali():
    from app.jalali import jdate, to_gregorian, to_jalali
    assert to_jalali(2026, 3, 21) == (1405, 1, 1) and to_gregorian(1403, 12, 30) == (2025, 3, 20)
    assert jdate(date(2026, 11, 5)) == "۱۴ آبان ۱۴۰۵"
