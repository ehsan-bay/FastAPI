"""Bank gateway flow against a fake gateway that speaks the REST services of IPG_Service v1.7."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest


class FakeGateway:
    def __init__(self):
        self.calls = []
        self.verify_amount = None  # rial returned by verifyMerchantTrans (None = echo expected)
        self.verify_result = "erSucceed"
        self.down = False
        self.expire_session_once = False
        self.sessions = 0
        gw = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
                param = body.get("param", {})
                name = self.path.strip("/").split("/")[-1]
                gw.calls.append((name, param))
                if gw.down:
                    self.send_response(503); self.end_headers(); return
                if name == "merchantLogin":
                    ok = param.get("UserName") == "merchant" and param.get("Password") == "secret"
                    gw.sessions += 1
                    out = {"Result": "erSucceed", "SessionId": f"S{gw.sessions}"} if ok else {"Result": "erAAS_InvalidUseridOrPass"}
                elif name == "verifyMerchantTrans":
                    if gw.expire_session_once:
                        gw.expire_session_once = False
                        out = {"Result": "erAAS_InvalidSession"}
                    else:
                        out = {"Result": gw.verify_result, "RefNum": param.get("RefNum"),
                               "Amount": gw.verify_amount if gw.verify_amount is not None else gw.expected}
                elif name == "reverseTransaction":
                    out = {"Result": "erSucceed", "RefNum": param.get("RefNum"), "Amount": 1}
                else:
                    out = {"Result": "erScm_InvalidParam"}
                data = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_port}/ipg"
        self.expected = 0
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@pytest.fixture(scope="module")
def gw():
    g = FakeGateway()
    yield g
    g.server.shutdown()


@pytest.fixture()
def ipg_on(client, admin, gw):
    s = client.put("/api/admin/settings", headers=admin, json={
        "ipg_enabled": True, "ipg_rest_url": gw.url, "ipg_username": "merchant", "ipg_password": "secret",
        "ipg_mid": "41642444", "ipg_payment_url": "http://192.168.141.45:1212/_ipgw_//payment/simple/",
        "ipg_allow_unverified": False}).json()
    assert s["ipg_enabled"] and s["ipg_can_verify"] and s["ipg_has_password"] and "ipg_password" not in s
    gw.down = False
    gw.verify_amount = None
    gw.verify_result = "erSucceed"
    yield
    client.put("/api/admin/settings", headers=admin, json={"ipg_enabled": False})


def user(client, email):
    r = client.post("/api/auth/register", json={"email": email, "password": "secret123"}).json()
    return {"Authorization": f"Bearer {r['token']}"}


def doctor(client, admin):
    return client.get("/api/admin/doctors", headers=admin).json()[1]


def start(client, h, doc, amount=120_000):
    r = client.post("/api/pay", headers=h, json={"token": doc["qr_token"], "amount": amount, "method": "ipg"})
    assert r.status_code == 200, r.text
    return r.json()


def callback(client, form):
    return client.post("/api/ipg/callback", data=form, follow_redirects=False)


def balance(client, admin, doc_id):
    return [d for d in client.get("/api/admin/doctors", headers=admin).json() if d["id"] == doc_id][0]["balance"]


def test_start_returns_gateway_form(client, admin, ipg_on):
    h = user(client, "ipg-form@test.com")
    doc = doctor(client, admin)
    info = client.get(f"/api/pay/doctors/{doc['qr_token']}", headers=h).json()
    assert info["ipg_enabled"] is True
    f = start(client, h, doc, 120_000)
    assert f["action"] == "http://192.168.141.45:1212/_ipgw_//payment/simple/"
    fields = f["fields"]
    assert fields["MID"] == "41642444" and fields["resNum"] == f["ref"] and fields["Amount"] == "1200000"  # toman -> rial
    assert fields["redirectURL"].endswith("/api/ipg/callback") and fields["language"] == "fa"
    assert client.get(f"/api/payments/{f['payment_id']}", headers=h).json()["status"] == "pending"


def test_ok_callback_is_verified_and_credits_doctor_once(client, admin, gw, ipg_on):
    h = user(client, "ipg-ok@test.com")
    doc = doctor(client, admin)
    before = balance(client, admin, doc["id"])
    f = start(client, h, doc, 80_000)
    gw.expected = 800_000
    form = {"State": "OK", "ResNum": f["ref"], "RefNum": "REF123", "CustomerRefNum": "RRN9", "MID": "41642444", "token": ""}
    r = callback(client, form)
    assert r.status_code == 303 and r.headers["location"] == f"/pay/result/{f['payment_id']}"
    p = client.get(f"/api/payments/{f['payment_id']}", headers=h).json()
    assert p["status"] == "paid" and p["verified"] is True and p["gateway_ref"] == "REF123" and p["gateway_rrn"] == "RRN9"
    assert balance(client, admin, doc["id"]) == before + 80_000
    assert client.get("/api/wallet", headers=h).json()["balance"] == 5_000_000  # wallet untouched
    names = [c[0] for c in gw.calls]
    assert "merchantLogin" in names and names[-1] == "verifyMerchantTrans"
    assert gw.calls[-1][1]["RefNum"] == "REF123" and gw.calls[-1][1]["WSContext"]["SessionId"].startswith("S")
    # the same post-back again (refresh / double submit) must not credit twice
    callback(client, form)
    assert balance(client, admin, doc["id"]) == before + 80_000


def test_cancelled_by_user(client, admin, ipg_on):
    h = user(client, "ipg-cancel@test.com")
    doc = doctor(client, admin)
    before = balance(client, admin, doc["id"])
    f = start(client, h, doc)
    callback(client, {"State": "Canceled By User", "ResNum": f["ref"], "MID": "41642444"})
    p = client.get(f"/api/payments/{f['payment_id']}", headers=h).json()
    assert p["status"] == "failed" and "لغو" in p["message"]
    assert balance(client, admin, doc["id"]) == before


def test_amount_mismatch_is_reversed(client, admin, gw, ipg_on):
    h = user(client, "ipg-mismatch@test.com")
    doc = doctor(client, admin)
    before = balance(client, admin, doc["id"])
    f = start(client, h, doc, 50_000)
    gw.verify_amount = 1000
    callback(client, {"State": "OK", "ResNum": f["ref"], "RefNum": "REF-MM", "MID": "41642444"})
    p = client.get(f"/api/payments/{f['payment_id']}", headers=h).json()
    assert p["status"] == "failed" and "برگشت داده شد" in p["message"]
    assert gw.calls[-1][0] == "reverseTransaction"
    assert balance(client, admin, doc["id"]) == before


def test_verify_failure_and_relogin(client, admin, gw, ipg_on):
    h = user(client, "ipg-verify-fail@test.com")
    doc = doctor(client, admin)
    f = start(client, h, doc)
    gw.verify_result = "erScm_OrgTransNotApproved"
    callback(client, {"State": "OK", "ResNum": f["ref"], "RefNum": "R1", "MID": "41642444"})
    p = client.get(f"/api/payments/{f['payment_id']}", headers=h).json()
    assert p["status"] == "failed" and "موفق نبوده" in p["message"]

    gw.verify_result = "erSucceed"
    gw.expire_session_once = True
    logins = gw.sessions
    f = start(client, h, doc, 60_000)
    gw.expected = 600_000
    callback(client, {"State": "OK", "ResNum": f["ref"], "RefNum": "R2", "MID": "41642444"})
    assert client.get(f"/api/payments/{f['payment_id']}", headers=h).json()["status"] == "paid"
    assert gw.sessions == logins + 1  # logged in again after the session error


def test_gateway_down_stays_pending_then_admin_recheck(client, admin, gw, ipg_on):
    h = user(client, "ipg-down@test.com")
    doc = doctor(client, admin)
    before = balance(client, admin, doc["id"])
    f = start(client, h, doc, 70_000)
    gw.down = True
    callback(client, {"State": "OK", "ResNum": f["ref"], "RefNum": "R-DOWN", "MID": "41642444"})
    p = client.get(f"/api/payments/{f['payment_id']}", headers=h).json()
    assert p["status"] == "pending" and "تأیید" in p["message"]
    assert balance(client, admin, doc["id"]) == before
    gw.down = False
    gw.expected = 700_000
    r = client.post(f"/api/admin/payments/{f['payment_id']}/recheck", headers=admin).json()
    assert r["status"] == "paid" and r["verified"] is True
    assert balance(client, admin, doc["id"]) == before + 70_000


def test_wrong_mid_and_unknown_resnum(client, admin, ipg_on):
    h = user(client, "ipg-mid@test.com")
    doc = doctor(client, admin)
    f = start(client, h, doc)
    callback(client, {"State": "OK", "ResNum": f["ref"], "RefNum": "R3", "MID": "99999"})
    assert client.get(f"/api/payments/{f['payment_id']}", headers=h).json()["status"] == "failed"
    r = callback(client, {"State": "OK", "ResNum": "NOPE", "RefNum": "R4"})
    assert r.status_code == 303 and r.headers["location"] == "/pay/result/0"


def test_without_verify_settings(client, admin):
    h = user(client, "ipg-noverify@test.com")
    doc = doctor(client, admin)
    client.put("/api/admin/settings", headers=admin, json={"ipg_enabled": True, "ipg_rest_url": "", "ipg_allow_unverified": True})
    f = start(client, h, doc)
    callback(client, {"State": "OK", "ResNum": f["ref"], "RefNum": "R5", "MID": "41642444"})
    p = client.get(f"/api/payments/{f['payment_id']}", headers=h).json()
    assert p["status"] == "paid" and p["verified"] is False
    client.put("/api/admin/settings", headers=admin, json={"ipg_allow_unverified": False})
    f = start(client, h, doc)
    callback(client, {"State": "OK", "ResNum": f["ref"], "RefNum": "R6", "MID": "41642444"})
    assert client.get(f"/api/payments/{f['payment_id']}", headers=h).json()["status"] == "pending"
    client.put("/api/admin/settings", headers=admin, json={"ipg_enabled": False, "ipg_allow_unverified": True})
