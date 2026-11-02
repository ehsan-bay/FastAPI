from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.ai.food import food_model
from app.ai.skin import skin_model

FIX = Path(__file__).parent / "fixtures"


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_auth_flow(client, auth):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=auth).json()["email"] == "test@example.com"
    assert client.post("/api/auth/register", json={"email": "test@example.com", "password": "secret123"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "TEST@example.com", "password": "secret123"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "test@example.com", "password": "wrong"}).status_code == 401
    r = client.patch("/api/auth/me", headers=auth, json={"calorie_goal": 1800})
    assert r.json()["calorie_goal"] == 1800


def test_users_are_isolated(client, auth):
    other = client.post("/api/auth/register", json={"email": "b@example.com", "password": "secret123"}).json()
    h2 = {"Authorization": f"Bearer {other['token']}"}
    meal = client.post("/api/meals", headers=auth, json={"food_key": "rice"}).json()
    assert client.delete(f"/api/meals/{meal['id']}", headers=h2).status_code == 404
    assert all(m["id"] != meal["id"] for m in client.get("/api/meals", headers=h2).json())


@pytest.mark.skipif(not food_model.available(), reason="food model not downloaded")
def test_food_recognition(client, auth):
    with open(FIX / "burger.jpg", "rb") as f:
        r = client.post("/api/food/analyze", headers=auth, files={"file": ("b.jpg", f, "image/jpeg")})
    body = r.json()
    assert r.status_code == 200, body
    assert body["is_food"] and body["candidates"][0]["key"] == "cheeseburger"


def test_food_bad_image(client, auth):
    if not food_model.available():
        pytest.skip("no model")
    r = client.post("/api/food/analyze", headers=auth, files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400


def test_meals_and_search(client, auth):
    assert any(f["key"] == "ghormeh_sabzi" for f in client.get("/api/food/search", params={"q": "قورمه"}).json())
    r = client.post("/api/meals", headers=auth, json={"food_key": "ghormeh_sabzi", "servings": 0.5})
    assert r.json()["kcal"] == 340
    r = client.post("/api/meals", headers=auth, json={"name": "اسموتی", "kcal": 210})
    assert r.json()["kcal"] == 210
    assert client.post("/api/meals", headers=auth, json={"name": "؟"}).status_code == 400
    dash = client.get("/api/dashboard", headers=auth, params={"tz_offset": -210}).json()
    assert dash["nutrition"]["kcal"] >= 550


@pytest.mark.skipif(not skin_model.available(), reason="skin model not downloaded")
def test_skin(client, auth):
    img = Image.new("RGB", (400, 400), (205, 160, 140))
    ImageDraw.Draw(img).ellipse((150, 150, 250, 240), fill=(70, 40, 30))
    buf = BytesIO()
    img.save(buf, "JPEG")
    r = client.post("/api/skin/analyze", headers=auth, files={"file": ("s.jpg", buf.getvalue(), "image/jpeg")},
                    data={"body_part": "arm"})
    body = r.json()
    assert r.status_code == 200, body
    assert body["risk"] in {"low", "medium", "high"} and len(body["predictions"]) == 5
    assert abs(sum(p["score"] for p in body["predictions"]) - 1) < 0.2
    assert client.get("/api/skin/history", headers=auth).json()[0]["body_part"] == "arm"


def test_lab_text(client, auth):
    text = "Glucose 132 mg/dL\nHDL Cholesterol 35\nLDL 120\nCholesterol 210\nHb 13.5\nTSH ۵٫۲"
    body = client.post("/api/lab/analyze", headers=auth, data={"text": text}).json()
    by = {r["key"]: r for r in body["results"]}
    assert by["fbs"]["status"] == "high"
    assert by["hdl"]["value"] == 35 and by["hdl"]["status"] == "low"
    assert by["chol"]["value"] == 210
    assert by["ldl"]["status"] == "normal" and by["hb"]["status"] == "normal"
    assert by["tsh"]["value"] == 5.2


def test_lab_ocr_image(client, auth):
    img = Image.new("RGB", (900, 300), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=40)
    except TypeError:
        pytest.skip("old Pillow")
    d.text((40, 40), "Glucose      145   mg/dL", fill="black", font=font)
    d.text((40, 140), "Triglycerides  90  mg/dL", fill="black", font=font)
    buf = BytesIO()
    img.save(buf, "PNG")
    r = client.post("/api/lab/analyze", headers=auth, files={"file": ("lab.png", buf.getvalue(), "image/png")})
    body = r.json()
    assert r.status_code == 200, body
    by = {x["key"]: x for x in body["results"]}
    assert by["fbs"]["value"] == 145 and by["tg"]["value"] == 90


def test_journal_and_chat(client, auth):
    r = client.post("/api/journal", headers=auth, json={"text": "امروز خیلی خسته و نگرانم", "mood": 2}).json()
    assert r["sentiment"] < 0 and {e["key"] for e in r["emotions"]} >= {"anxiety", "fatigue"}
    r = client.post("/api/journal", headers=auth, json={"text": "امروز خیلی خوشحالم و حالم خوبه", "mood": 5}).json()
    assert r["sentiment"] > 0
    r = client.post("/api/journal", headers=auth, json={"text": "حالم خوب نیست", "mood": 2}).json()
    assert r["sentiment"] < 0
    r = client.post("/api/journal", headers=auth, json={"text": "دیگه می‌خوام بمیرم"}).json()
    assert r["risk"] and "۱۲۳" in r["reply"]
    r = client.post("/api/assistant/chat", headers=auth,
                    json={"messages": [{"role": "user", "content": "برای بی‌خوابی چکار کنم؟"}]}).json()
    assert r["reply"] and r["engine"] in {"llm", "rules"}


def test_vitals(client, auth):
    assert client.post("/api/vitals", headers=auth, json={"kind": "bp", "value": 120}).status_code == 422
    r = client.post("/api/vitals", headers=auth, json={"kind": "bp", "value": 185, "value2": 100}).json()
    assert r["level"] == "danger"
    for v in [80, 82, 79, 81, 300]:
        client.post("/api/vitals", headers=auth, json={"kind": "glucose", "value": v})
    ins = {i["kind"]: i for i in client.get("/api/vitals/insights", headers=auth).json()}
    assert ins["glucose"]["anomalies"][0]["value"] == 300


def test_meds(client, auth):
    assert client.post("/api/meds", headers=auth, json={"name": "متفورمین", "times": ["25:00"]}).status_code == 422
    m = client.post("/api/meds", headers=auth, json={"name": "متفورمین", "dose": "500mg", "times": ["20:00", "08:00"]}).json()
    assert m["times"] == ["08:00", "20:00"]
    client.post(f"/api/meds/{m['id']}/log", headers=auth, json={"status": "taken"})
    meds = client.get("/api/meds", headers=auth).json()
    assert meds[0]["today"][0]["status"] == "taken"
    assert client.get("/api/meds/adherence", headers=auth).json()["taken"] == 1


def test_sleep_and_workout(client, auth):
    start = datetime(2026, 1, 1, 23, 0)
    r = client.post("/api/sleep", headers=auth, json={
        "started_at": start.isoformat(), "ended_at": (start + timedelta(hours=7.5)).isoformat(),
        "snore_seconds": 3000, "cough_count": 2, "timeline": [{"t": 10, "label": "Snoring", "score": 0.8}]}).json()
    assert 0 < r["score"] < 100 and r["tips"]
    bad = client.post("/api/sleep", headers=auth, json={"started_at": start.isoformat(), "ended_at": start.isoformat()})
    assert bad.status_code == 422
    w = client.post("/api/workouts", headers=auth, json={"exercise": "squat", "reps": 20, "form_score": 80}).json()
    assert w["kcal"] > 0


def test_models_status(client):
    s = client.get("/api/models").json()["server"]
    assert s["mood"] and s["lab_ocr"]
