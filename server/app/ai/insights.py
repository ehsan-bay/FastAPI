"""Vital-sign insights: clinical thresholds + robust anomaly detection (median/MAD) + trend (least squares)."""
from datetime import datetime

import numpy as np

KINDS = {
    "bp": {"label": "فشار خون", "unit": "mmHg"},
    "glucose": {"label": "قند خون", "unit": "mg/dL"},
    "weight": {"label": "وزن", "unit": "kg"},
    "hr": {"label": "ضربان قلب", "unit": "bpm"},
    "spo2": {"label": "اکسیژن خون", "unit": "%"},
}


def classify(kind: str, value: float, value2: float | None = None) -> tuple[str, str]:
    """Return (level, message). level: ok | warn | danger."""
    if kind == "bp":
        sys_, dia = value, value2 or 0
        if sys_ >= 180 or dia >= 120:
            return "danger", "بحران فشار خون! اگر سردرد، درد قفسه سینه یا تنگی نفس داری فوراً با ۱۱۵ تماس بگیر."
        if sys_ >= 140 or dia >= 90:
            return "warn", "فشار خون مرحله ۲. با پزشک مشورت کن."
        if sys_ >= 130 or dia >= 80:
            return "warn", "فشار خون مرحله ۱. نمک کمتر و ورزش بیشتر."
        if sys_ < 90 or dia < 60:
            return "warn", "فشار خون پایین. اگر سرگیجه داری مایعات بنوش و استراحت کن."
        return "ok", "فشار خون طبیعی."
    if kind == "glucose":
        if value < 70:
            return "danger", "افت قند! یک منبع قند سریع (آبمیوه یا ۳ حبه قند) بخور و ۱۵ دقیقه بعد دوباره اندازه بگیر."
        if value >= 250:
            return "danger", "قند خیلی بالا. با پزشک تماس بگیر."
        if value >= 126:
            return "warn", "قند بالا (اگر ناشتا است در محدوده دیابت)."
        if value >= 100:
            return "warn", "قند کمی بالا (اگر ناشتا است: پیش‌دیابت)."
        return "ok", "قند خون طبیعی."
    if kind == "hr":
        if value > 120 or value < 45:
            return "danger", "ضربان در حال استراحت غیرعادی است. اگر علامت داری به پزشک مراجعه کن."
        if value > 100 or value < 55:
            return "warn", "ضربان خارج از محدوده معمول استراحت (۶۰ تا ۱۰۰)."
        return "ok", "ضربان طبیعی."
    if kind == "spo2":
        if value < 90:
            return "danger", "اکسیژن خون پایین! در صورت تنگی نفس فوراً به اورژانس مراجعه کن."
        if value < 95:
            return "warn", "اکسیژن خون کمی پایین."
        return "ok", "اکسیژن خون طبیعی."
    return "ok", ""


def analyze_series(kind: str, points: list[tuple[datetime, float]]) -> dict:
    """points: (time, value) sorted oldest -> newest."""
    out = {"kind": kind, "label": KINDS.get(kind, {}).get("label", kind), "count": len(points),
           "anomalies": [], "trend": None, "message": ""}
    if len(points) < 3:
        out["message"] = "برای تحلیل روند حداقل ۳ اندازه‌گیری لازم است."
        return out
    times = np.array([p[0].timestamp() for p in points]) / 86400.0
    vals = np.array([p[1] for p in points], dtype=float)
    out["mean"] = round(float(vals.mean()), 1)
    # Robust z-score: outliers stand out even if the series has a few spikes.
    med = np.median(vals)
    mad = np.median(np.abs(vals - med)) or (np.std(vals) or 1.0)
    z = 0.6745 * (vals - med) / mad
    out["anomalies"] = [
        {"at": points[i][0].isoformat(), "value": float(vals[i]), "z": round(float(z[i]), 2)}
        for i in np.where(np.abs(z) > 3.5)[0]
    ]
    if times[-1] - times[0] >= 1:
        slope = float(np.polyfit(times - times[0], vals, 1)[0])  # units per day
        out["trend"] = {"per_week": round(slope * 7, 2)}
        weekly = slope * 7
        unit = KINDS.get(kind, {}).get("unit", "")
        threshold = {"weight": 0.3, "glucose": 3, "bp": 2, "hr": 2, "spo2": 0.5}.get(kind, 1)
        if abs(weekly) >= threshold:
            direction = "افزایشی" if weekly > 0 else "کاهشی"
            out["message"] = f"روند {direction}: حدود {abs(weekly):.1f} {unit} در هفته."
        else:
            out["message"] = "روند پایدار است."
    if out["anomalies"]:
        out["message"] += f" {len(out['anomalies'])} مقدار غیرعادی نسبت به الگوی خودت دیده شد."
    return out
