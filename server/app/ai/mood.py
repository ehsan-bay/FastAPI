"""Mood journal analysis: lightweight Persian/English lexicon model (runs anywhere, no download).

Scores sentiment in [-1, 1], tags emotions and flags crisis language.
"""
import re

_ZWNJ = "‌"

POSITIVE = {
    "خوب", "خوبم", "عالی", "شاد", "شادم", "خوشحال", "خوشحالم", "آرام", "آرومم", "آروم", "راضی", "امیدوار",
    "سرحال", "انرژی", "موفق", "لذت", "عاشق", "دوست", "خندیدم", "ممنون", "سپاسگزار", "قشنگ", "بهتر", "بهترم",
    "خوبه", "شادی", "آرامش", "happy", "good", "great", "calm", "relaxed", "grateful", "hopeful", "love", "excited", "proud", "better", "fine",
}
NEGATIVE = {
    "بد", "بدم", "غمگین", "ناراحت", "ناراحتم", "افسرده", "خسته", "خستم", "خسته‌ام", "تنها", "تنهام", "عصبانی",
    "عصبی", "نگران", "نگرانم", "استرس", "اضطراب", "ترس", "می‌ترسم", "میترسم", "گریه", "دلتنگ", "بی‌حوصله",
    "بیحوصله", "ناامید", "درد", "بی‌خوابی", "بیخوابی", "کلافه", "داغون", "ضعیف", "شکست",
    "sad", "bad", "tired", "lonely", "angry", "anxious", "worried", "stress", "stressed", "afraid", "cry",
    "depressed", "hopeless", "pain", "exhausted", "upset", "awful", "terrible",
}
NEGATIONS = {"نه", "نیست", "نیستم", "نبود", "not", "no", "never", "اصلا", "اصلاً", "هیچ"}
INTENSIFIERS = {"خیلی", "خیلییی", "بسیار", "واقعا", "واقعاً", "شدیدا", "very", "really", "so", "extremely"}

EMOTIONS = {
    "anxiety": ("اضطراب", ["نگران", "استرس", "اضطراب", "ترس", "میترسم", "می‌ترسم", "دلشوره", "anxious", "worried", "stress", "panic"]),
    "sadness": ("غم", ["غمگین", "ناراحت", "گریه", "دلتنگ", "افسرده", "تنها", "sad", "cry", "lonely", "depressed"]),
    "anger": ("خشم", ["عصبانی", "عصبی", "کلافه", "حرص", "angry", "mad", "furious"]),
    "fatigue": ("خستگی", ["خسته", "خستم", "بی‌خوابی", "بیخوابی", "بی‌حال", "tired", "exhausted", "sleepy"]),
    "joy": ("شادی", ["شاد", "خوشحال", "خندیدم", "عالی", "لذت", "happy", "excited", "joy"]),
    "calm": ("آرامش", ["آرام", "آروم", "راحت", "calm", "relaxed", "peaceful"]),
    "gratitude": ("قدردانی", ["ممنون", "شکر", "سپاسگزار", "grateful", "thankful"]),
}

CRISIS = [
    r"خودکشی", r"خودمو\s*بکشم", r"خودم\s*را\s*بکشم", r"می\s*‌?خوام\s*بمیرم", r"میخوام\s*بمیرم", r"آرزوی\s*مرگ",
    r"به\s*زندگی\s*ادامه\s*ندم", r"suicid", r"kill\s+myself", r"want\s+to\s+die", r"end\s+my\s+life", r"self[-\s]?harm",
]
_CRISIS_RX = re.compile("|".join(CRISIS), re.IGNORECASE)

CRISIS_MESSAGE = (
    "از اینکه این را گفتی ممنونم. حال تو مهم است و لازم نیست تنها باشی. "
    "لطفاً همین حالا با یک نفر صحبت کن: اورژانس اجتماعی ۱۲۳، صدای مشاور بهزیستی ۱۴۸۰، "
    "یا در خطر فوری اورژانس ۱۱۵. اگر خارج از ایران هستی، با شماره اورژانس محلی تماس بگیر."
)


def tokenize(text: str) -> list[str]:
    text = text.replace(_ZWNJ, "")
    return [t for t in re.split(r"[^\w]+", text.lower()) if t]


def _norm_set(words: set[str]) -> set[str]:
    return {w.replace(_ZWNJ, "").lower() for w in words}


_POS, _NEG, _NEGS, _INT = map(_norm_set, (POSITIVE, NEGATIVE, NEGATIONS, INTENSIFIERS))


def analyze(text: str) -> dict:
    tokens = tokenize(text)
    score, hits = 0.0, 0
    for i, tok in enumerate(tokens):
        val = 1.0 if tok in _POS else -1.0 if tok in _NEG else 0.0
        if not val:
            continue
        window = tokens[max(0, i - 2): i + 3]
        if any(w in _INT for w in window):
            val *= 1.5
        # Persian puts negation after the word ("خوب نیستم"), English before ("not good").
        if any(w in _NEGS for w in window):
            val *= -0.8
        score += val
        hits += 1
    sentiment = max(-1.0, min(1.0, score / max(3.0, hits * 1.2))) if hits else 0.0

    flat = text.replace(_ZWNJ, "").lower()
    emotions = []
    for key, (fa, words) in EMOTIONS.items():
        count = sum(flat.count(w.replace(_ZWNJ, "").lower()) for w in words)
        if count:
            emotions.append({"key": key, "label": fa, "count": count})
    emotions.sort(key=lambda e: e["count"], reverse=True)
    return {"sentiment": round(sentiment, 3), "emotions": emotions, "risk": bool(_CRISIS_RX.search(text))}


TIPS = {
    "anxiety": "یک تمرین تنفس ۴-۷-۸ امتحان کن: ۴ ثانیه دم، ۷ ثانیه نگه دار، ۸ ثانیه بازدم. سه بار تکرار کن.",
    "sadness": "احساساتت را بپذیر. یک قدم کوچک مثل یک پیاده‌روی ۱۰ دقیقه‌ای یا تماس با یک دوست می‌تواند کمک کند.",
    "anger": "قبل از واکنش، ۱۰ نفس آرام بکش. نوشتن دلیل عصبانیت روی کاغذ هم ذهن را آرام‌تر می‌کند.",
    "fatigue": "به خوابت توجه کن: ساعت ثابت خواب، کم کردن کافئین بعد از ظهر و دوری از گوشی قبل از خواب.",
    "joy": "عالیه! این لحظه را یادداشت کن تا در روزهای سخت‌تر یادت بیاید چه چیزهایی حالت را خوب می‌کند.",
    "calm": "چه خوب که آرامی. می‌توانی با چند دقیقه مدیتیشن این حس را عمیق‌تر کنی.",
    "gratitude": "قدردانی یکی از قوی‌ترین عادت‌ها برای سلامت روان است. هر شب سه چیز خوب روز را بنویس.",
}


def rule_reply(analysis: dict) -> str:
    if analysis["risk"]:
        return CRISIS_MESSAGE
    s = analysis["sentiment"]
    opening = (
        "به نظر می‌رسد روز خوبی داشتی. 🌱" if s > 0.25
        else "به نظر می‌رسد امروز کمی سخت بوده. ممنون که نوشتی. 💙" if s < -0.25
        else "ممنون که احساساتت را نوشتی."
    )
    tips = [TIPS[e["key"]] for e in analysis["emotions"][:2] if e["key"] in TIPS]
    if not tips:
        tips = ["نوشتن منظم احساسات به شناخت الگوهای ذهنی کمک می‌کند. فردا هم بنویس."]
    return " ".join([opening, *tips])
