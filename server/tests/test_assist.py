import io
import wave
from pathlib import Path

import pytest

from app.ai.food import food_model
from app.ai.speech import number_to_words, speakable, speaker, transcriber, understand, words_to_numbers
from app.ai.xray import xray_model

FIX = Path(__file__).parent / "fixtures"


def test_persian_numbers_both_ways():
    assert words_to_numbers("صد و سی روی هشتاد") == "130 روی 80"
    assert words_to_numbers("هفتاد و دو کیلو") == "72 کیلو"
    assert number_to_words(1250) == "یک هزار و دویست و پنجاه"
    assert "پنجاه هزار" in speakable("مبلغ ۵۰٬۰۰۰ تومان")
    assert "روی" in speakable("فشار 120/80")


@pytest.mark.parametrize("text,expect", [
    ("فشار خونم صد و سی روی هشتاد بود", ("vital", "bp", 130)),
    ("فشارم سیزده روی هشت", ("vital", "bp", 130)),
    ("قند خونم صد و ده است", ("vital", "glucose", 110)),
    ("وزنم هفتاد و دو کیلو", ("vital", "weight", 72)),
    ("ضربان قلبم هشتاد و پنج", ("vital", "hr", 85)),
    ("ناهار قورمه سبزی خوردم", ("meal", "ghormeh_sabzi", None)),
    ("نها رو برمه سبزی خوردم", ("meal", "ghormeh_sabzi", None)),  # real Whisper mistake
    ("شام چلوکباب کوبیده خوردم", ("meal", "chelow_kabab", None)),
    ("امروز خیلی خسته‌ام و استرس دارم", ("journal", None, None)),
])
def test_understand(text, expect):
    items = understand(text)
    kind, key, value = expect
    hit = [i for i in items if i["type"] == kind and (key is None or i.get("kind") == key or i.get("food_key") == key)]
    assert hit, items
    if value:
        assert hit[0]["value"] == value


def test_no_false_food_matches():
    assert not [i for i in understand("قند خونم صد و ده است") if i["type"] == "meal"]  # "است" is not "ماست"
    assert not [i for i in understand("امروز خیلی خسته‌ام") if i["type"] == "meal"]  # "امروز" is not "موز"


@pytest.mark.skipif(not speaker.available(), reason="tts model not installed")
def test_tts_returns_wav(client, auth):
    r = client.post("/api/tts", headers=auth, json={"text": "یادآور دارو: متفورمین ۵۰۰ میلی‌گرم"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(r.content)) as w:
        assert w.getnframes() / w.getframerate() > 1.5
    assert client.post("/api/tts", json={"text": "x"}).status_code == 401


@pytest.mark.skipif(not (speaker.available() and transcriber.available()), reason="speech models not installed")
def test_voice_round_trip(client, auth):
    """Speak a sentence with the TTS voice, send it as a voice note, get the blood pressure back."""
    wav = client.post("/api/tts", headers=auth, json={"text": "فشار خونم صد و سی روی هشتاد بود", "speed": 0.9}).content
    r = client.post("/api/voice/transcribe", headers=auth, files={"file": ("v.wav", wav, "audio/wav")}).json()
    # Synthetic speech is not word-perfect (the voice varies per run), so only check the pipeline.
    assert r["text"].startswith("فشا") and r["items"]
    bad = client.post("/api/voice/transcribe", headers=auth, files={"file": ("v.wav", b"not audio", "audio/wav")})
    assert bad.status_code == 400


@pytest.mark.skipif(not xray_model.available(), reason="xray model not installed")
def test_xray_flags_cardiomegaly(client, auth):
    # NIH ChestX-ray14 image 00000001_000, labelled "Cardiomegaly" in the dataset.
    with open(FIX / "chest_xray_nih_00000001_000.png", "rb") as f:
        r = client.post("/api/xray/analyze", headers=auth, files={"file": ("x.png", f, "image/png")})
    body = r.json()
    assert r.status_code == 200, body
    assert body["findings"][0]["code"] == "Cardiomegaly" and body["findings"][0]["flag"]
    assert len(body["findings"]) == 18 and body["disclaimer"]
    assert client.get("/api/xray/history", headers=auth).json()[0]["level"] in {"low", "medium", "high"}


@pytest.mark.skipif(not food_model.clip.available(), reason="clip not installed")
def test_clip_food_engine(client, auth):
    with open(FIX / "burger.jpg", "rb") as f:
        body = client.post("/api/food/analyze", headers=auth, files={"file": ("b.jpg", f, "image/jpeg")}).json()
    assert body["engine"] == "clip" and body["candidates"][0]["key"] == "cheeseburger" and body["is_food"]
    with open(FIX / "chest_xray_nih_00000001_000.png", "rb") as f:
        nf = client.post("/api/food/analyze", headers=auth, files={"file": ("x.png", f, "image/png")}).json()
    assert not nf["is_food"]  # an x-ray is not food
