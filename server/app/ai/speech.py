"""Persian speech: voice logging (Whisper small via sherpa-onnx) and read-aloud (Piper fa_IR via sherpa-onnx).

Both run on the server CPU. Voice notes are parsed into suggestions (meal, vitals, journal) that the user
confirms before anything is saved, because speech recognition can be wrong.
"""
import hashlib
import io
import json
import re
import threading
import wave
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

from ..config import settings
from .food import FOODS

ASR_DIR = "asr"
TTS_DIR = "tts"
MAX_SECONDS = 30


# --- speech to text -------------------------------------------------------------------------------
class Transcriber:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rec = None

    @property
    def dir(self) -> Path:
        return settings.models_dir / ASR_DIR

    def available(self) -> bool:
        try:
            import sherpa_onnx  # noqa: F401
        except ImportError:
            return False
        return all((self.dir / f).exists() for f in ("small-encoder.int8.onnx", "small-decoder.int8.onnx", "small-tokens.txt"))

    def _load(self):
        if self._rec is None:
            import sherpa_onnx

            self._rec = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=str(self.dir / "small-encoder.int8.onnx"),
                decoder=str(self.dir / "small-decoder.int8.onnx"),
                tokens=str(self.dir / "small-tokens.txt"),
                language="fa", task="transcribe", num_threads=2, tail_paddings=2000,
            )
        return self._rec

    def transcribe(self, samples: np.ndarray, rate: int) -> str:
        pad = np.zeros(int(rate * 0.5), dtype=np.float32)  # Whisper drops the last words without trailing silence
        audio = np.concatenate([pad, samples.astype(np.float32), pad])
        with self._lock:
            rec = self._load()
            stream = rec.create_stream()
            stream.accept_waveform(rate, audio)
            rec.decode_stream(stream)
            text = stream.result.text
        return clean_repetitions(text.strip())


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    """16-bit PCM WAV (mono or stereo) -> float32 mono samples."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            rate, channels, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            if width != 2:
                raise ValueError("فقط فایل WAV شانزده‌بیتی پشتیبانی می‌شود")
            if n / rate > MAX_SECONDS + 1:
                raise ValueError(f"صدا باید کوتاه‌تر از {MAX_SECONDS} ثانیه باشد")
            pcm = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float32) / 32768.0
    except wave.Error as exc:
        raise ValueError("فایل صوتی قابل خواندن نیست") from exc
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    if len(pcm) < rate * 0.3:
        raise ValueError("صدا خیلی کوتاه است")
    return pcm, rate


def clean_repetitions(text: str) -> str:
    """Whisper sometimes loops on a word ("از از از …"); collapse runs of the same word."""
    words, out = text.split(), []
    for w in words:
        if len(out) >= 2 and out[-1] == w and out[-2] == w:
            continue
        out.append(w)
    return " ".join(out)


# --- Persian text -> numbers ----------------------------------------------------------------------
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_UNITS = {"صفر": 0, "یک": 1, "یه": 1, "دو": 2, "سه": 3, "چهار": 4, "چار": 4, "پنج": 5, "پنچ": 5, "شش": 6, "شیش": 6,
          "هفت": 7, "هشت": 8, "نه": 9, "ده": 10, "یازده": 11, "دوازده": 12, "سیزده": 13, "چهارده": 14, "پانزده": 15,
          "پونزده": 15, "شانزده": 16, "شونزده": 16, "هفده": 17, "هیفده": 17, "هجده": 18, "هیجده": 18, "نوزده": 19}
_TENS = {"بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50, "شصت": 60, "هفتاد": 70, "هشتاد": 80, "نود": 90}
_HUNDREDS = {"صد": 100, "یکصد": 100, "دویست": 200, "سیصد": 300, "چهارصد": 400, "پانصد": 500, "پونصد": 500,
             "ششصد": 600, "هفتصد": 700, "هشتصد": 800, "نهصد": 900}


def normalize(text: str) -> str:
    text = text.translate(_DIGITS).replace("ي", "ی").replace("ك", "ک").replace("‌", " ")
    text = re.sub(r"[،,؛:!?؟.]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def words_to_numbers(text: str) -> str:
    """'صد و سی روی هشتاد' -> '130 روی 80'."""
    tokens, out, i = text.split(), [], 0
    while i < len(tokens):
        value, j, used = 0, i, False
        while j < len(tokens):
            t = tokens[j]
            if t in _HUNDREDS:
                value += _HUNDREDS[t]
            elif t in _TENS:
                value += _TENS[t]
            elif t in _UNITS:
                value += _UNITS[t]
            elif t == "هزار":
                value = (value or 1) * 1000
            elif t == "و" and used and j + 1 < len(tokens) and (tokens[j + 1] in _UNITS or tokens[j + 1] in _TENS or tokens[j + 1] in _HUNDREDS):
                j += 1
                continue
            else:
                break
            used = True
            j += 1
        if used:
            out.append(str(value))
            i = j
        else:
            out.append(tokens[i])
            i += 1
    return " ".join(out)


# --- understanding a voice note -------------------------------------------------------------------
_NUM = r"(\d{1,3}(?:\.\d)?)"


_GENERIC = {"چلو", "خورش", "با", "و", "یک", "عدد", "کاسه", "لیوان", "برش", "مشت", "نان", "سالاد", "آب", "پز"}
# Everyday names people say that differ from the table names.
_ALIASES = {
    "egg": ["تخم مرغ", "تخم مرغ آب پز"], "omelette": ["املت"], "tea": ["چای", "چایی"], "tea_sugar": ["چای شیرین", "چای با قند"],
    "rice": ["برنج", "پلو", "کته"], "chelow_kabab": ["کباب کوبیده", "کوبیده", "چلوکباب", "چلو کباب"], "joojeh_kabab": ["جوجه کباب", "جوجه"],
    "ghormeh_sabzi": ["قورمه سبزی", "قرمه سبزی"], "gheimeh": ["قیمه"], "fesenjan": ["فسنجان", "فسنجون"], "zereshk_polo": ["زرشک پلو"],
    "ash_reshteh": ["آش رشته", "آش"], "adasi": ["عدسی"], "kashk_bademjan": ["کشک بادمجان"], "mirza_ghasemi": ["میرزا قاسمی"],
    "abgoosht": ["آبگوشت", "دیزی"], "kuku_sabzi": ["کوکو سبزی", "کوکو"], "kotlet": ["کتلت"], "macaroni": ["ماکارونی"],
    "tahchin": ["ته چین"], "loobia_polo": ["لوبیا پلو"], "sabzi_polo_mahi": ["سبزی پلو", "سبزی پلو ماهی"], "halim": ["حلیم"],
    "shole_zard": ["شله زرد"], "sangak": ["نان سنگک", "سنگک"], "barbari": ["نان بربری", "بربری"], "lavash": ["نان لواش", "لواش"],
    "yogurt": ["ماست"], "doogh": ["دوغ"], "feta": ["پنیر"], "dates": ["خرما"], "walnut": ["گردو"], "pistachio": ["پسته"],
    "salad_shirazi": ["سالاد شیرازی"], "olivieh": ["الویه", "سالاد الویه"], "falafel": ["فلافل"], "chicken_breast": ["سینه مرغ", "مرغ"],
    "watermelon": ["هندوانه", "هندونه"], "grapes": ["انگور"], "apple": ["سیب"], "banana": ["موز"], "orange": ["پرتقال", "پرتغال"],
    "pizza": ["پیتزا"], "cheeseburger": ["همبرگر", "برگر"], "hotdog": ["هات داگ", "سوسیس"], "ice_cream": ["بستنی"],
    "pomegranate": ["انار"], "cucumber": ["خیار"], "soup": ["سوپ"], "mashed_potato": ["پوره سیب زمینی", "پوره"],
}


def _aliases(f: dict) -> list[str]:
    out = list(_ALIASES.get(f["key"], []))
    name = re.sub(r"\(.*?\)", "", f["fa"]).replace("\u200c", " ").replace("/", " ")
    words = [w for w in name.split() if w not in _GENERIC]
    if words:
        out.append(" ".join(words))
    return [a for a in dict.fromkeys(out) if a]


_FOOD_ALIASES = [(f, _aliases(f)) for f in FOODS]


# Letters that sound the same in Persian; speech recognition often picks the wrong one.
_SOUND = str.maketrans({"غ": "ق", "ص": "س", "ث": "س", "ض": "ز", "ظ": "ز", "ذ": "ز", "ح": "ه", "ط": "ت", "آ": "ا"})


def _sound(s: str) -> str:
    return s.translate(_SOUND)


def _match_foods(text: str) -> list[dict]:
    t = " " + _sound(text.replace("\u200c", " ")) + " "
    words = t.split()
    found: dict[str, tuple[float, dict]] = {}
    for f, aliases in _FOOD_ALIASES:
        best = 0.0
        for a in map(_sound, aliases):
            if f" {a} " in t:  # whole words only ("است" must not match "ماست")
                best = max(best, 0.9 + 0.01 * len(a.split()))
            elif len(a) >= 5:  # tolerate small recognition errors in longer names
                n = len(a.split())
                for k in range(len(words) - n + 1):
                    r = SequenceMatcher(None, " ".join(words[k:k + n]), a).ratio()
                    if r >= (0.75 if n >= 2 else 0.8):  # multi-word names carry more context
                        best = max(best, r * 0.95)
        if best and (f["key"] not in found or found[f["key"]][0] < best):
            found[f["key"]] = (best, f)
    ranked = sorted(found.values(), key=lambda x: x[0], reverse=True)
    # "چای شیرین" also contains "چای": keep the more specific match only.
    keys = {f["key"] for _, f in ranked}
    if "tea_sugar" in keys:
        ranked = [x for x in ranked if x[1]["key"] != "tea"]
    return [{"type": "meal", "food_key": f["key"], "name": f["fa"], "kcal": f["kcal"], "servings": 1,
             "confidence": round(min(score, 1.0), 2)} for score, f in ranked[:4]]


def understand(text: str) -> list[dict]:
    t = words_to_numbers(normalize(text))
    items: list[dict] = []

    m = re.search(r"فشار\D{0,20}?" + _NUM + r"\s*(?:روی|رو(?: 1)?|بر|به|/|و)\s*" + _NUM, t)
    if m:
        s, d = float(m.group(1)), float(m.group(2))
        if s < 30:  # "۱۳ روی ۸" means 130/80
            s, d = s * 10, d * 10
        if 60 <= s <= 260 and 30 <= d <= 160:
            items.append({"type": "vital", "kind": "bp", "value": s, "value2": d, "label": f"فشار خون {s:g}/{d:g}"})
    for kind, pattern, lo, hi, label in [
        ("glucose", r"(?:قند|گلوکز)\D{0,20}?" + _NUM, 30, 600, "قند خون"),
        ("weight", r"(?:وزن|کیلو)\D{0,15}?" + _NUM, 20, 300, "وزن"),
        ("hr", r"(?:ضربان|نبض)\D{0,20}?" + _NUM, 30, 220, "ضربان قلب"),
        ("spo2", r"(?:اکسیژن)\D{0,20}?" + _NUM, 50, 100, "اکسیژن خون"),
    ]:
        m = re.search(pattern, t)
        if m and lo <= float(m.group(1)) <= hi:
            v = float(m.group(1))
            items.append({"type": "vital", "kind": kind, "value": v, "label": f"{label} {v:g}"})
    if kind_weight := re.search(_NUM + r"\s*کیلو", t):
        v = float(kind_weight.group(1))
        if 20 <= v <= 300 and not any(i.get("kind") == "weight" for i in items):
            items.append({"type": "vital", "kind": "weight", "value": v, "label": f"وزن {v:g}"})

    items += _match_foods(t)

    from .mood import analyze
    mood = analyze(text)
    if mood["emotions"] or (not items and len(t.split()) >= 3):
        items.append({"type": "journal", "text": text.strip(),
                      "label": "یادداشت حال: " + "، ".join(e["label"] for e in mood["emotions"][:2]) if mood["emotions"] else "ثبت به‌عنوان یادداشت روزانه"})
    return items


# --- text to speech -------------------------------------------------------------------------------
class Speaker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tts = None

    @property
    def dir(self) -> Path:
        return settings.models_dir / TTS_DIR

    def available(self) -> bool:
        try:
            import sherpa_onnx  # noqa: F401
        except ImportError:
            return False
        return (self.dir / "fa_IR-amir-medium.onnx").exists() and (self.dir / "espeak-ng-data").is_dir()

    def _load(self):
        if self._tts is None:
            import sherpa_onnx

            cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=str(self.dir / "fa_IR-amir-medium.onnx"), tokens=str(self.dir / "tokens.txt"),
                    data_dir=str(self.dir / "espeak-ng-data")),
                num_threads=2))
            self._tts = sherpa_onnx.OfflineTts(cfg)
        return self._tts

    def wav(self, text: str, speed: float = 0.9) -> bytes:
        text = speakable(text)
        cache_dir = settings.data_dir / "tts-cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(json.dumps([text, speed]).encode()).hexdigest()[:24]
        path = cache_dir / f"{key}.wav"
        if path.exists():
            return path.read_bytes()
        with self._lock:
            audio = self._load().generate(text, sid=0, speed=speed)
        pcm = (np.clip(np.array(audio.samples, dtype=np.float32), -1, 1) * 32767).astype("<i2")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(audio.sample_rate)
            w.writeframes(pcm.tobytes())
        data = buf.getvalue()
        files = sorted(cache_dir.glob("*.wav"), key=lambda p: p.stat().st_mtime)
        for old in files[:-300]:  # keep the cache small
            old.unlink(missing_ok=True)
        path.write_bytes(data)
        return data


_ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده", "یازده", "دوازده", "سیزده", "چهارده",
         "پانزده", "شانزده", "هفده", "هجده", "نوزده"]
_TENS_W = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"]
_HUND_W = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"]


def number_to_words(n: int) -> str:
    if n == 0:
        return "صفر"
    parts = []
    for value, name in ((10**9, "میلیارد"), (10**6, "میلیون"), (1000, "هزار")):
        if n >= value:
            parts.append(f"{number_to_words(n // value)} {name}")
            n %= value
    if n >= 100:
        parts.append(_HUND_W[n // 100])
        n %= 100
    if n >= 20:
        parts.append(_TENS_W[n // 10])
        n %= 10
    if n:
        parts.append(_ONES[n])
    return " و ".join(p for p in parts if p)


def speakable(text: str) -> str:
    """Numbers and units the voice would otherwise read badly."""
    t = text.translate(_DIGITS).replace("٬", "").replace(",", "")
    t = re.sub(r"(\d+)\s*/\s*(\d+)", lambda m: f"{m.group(1)} روی {m.group(2)}", t)
    t = re.sub(r"(\d+)\.(\d+)", lambda m: f"{number_to_words(int(m.group(1)))} ممیز {number_to_words(int(m.group(2)))}", t)
    t = re.sub(r"\d+", lambda m: number_to_words(int(m.group(0))), t)
    for a, b in (("mg/dL", "میلی‌گرم در دسی‌لیتر"), ("mmHg", "میلی‌متر جیوه"), ("kcal", "کیلوکالری"), ("%", " درصد")):
        t = t.replace(a, b)
    t = re.sub(r"[^\w\s،.؟!:\-‌]", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:600]


transcriber = Transcriber()
speaker = Speaker()
