"""Lab report reader: OCR (RapidOCR, ONNX) + rule-based parsing against adult reference ranges."""
import re
import threading

import numpy as np

from .images import load_rgb

# (key, Persian name, regex aliases, unit, low, high, meaning if low, meaning if high)
TESTS = [
    ("fbs", "قند خون ناشتا", r"\b(fbs|fasting\s*(blood)?\s*(sugar|glucose)|glucose|glu|bs)\b", "mg/dL", 70, 100,
     "قند پایین؛ ممکن است باعث ضعف و لرزش شود.", "قند بالا؛ احتمال پیش‌دیابت یا دیابت را با پزشک بررسی کنید."),
    ("hba1c", "هموگلوبین A1c", r"\b(hb\s*a1c|a1c|glycated)\b", "%", 4.0, 5.7,
     "", "میانگین قند سه ماه اخیر بالاست (۵٫۷ تا ۶٫۴ پیش‌دیابت، ۶٫۵ به بالا دیابت)."),
    ("tg", "تری‌گلیسیرید", r"\b(tg|triglycerides?|trig)\b", "mg/dL", 0, 150,
     "", "تری‌گلیسیرید بالا؛ کاهش قند و چربی و افزایش تحرک کمک می‌کند."),
    ("hdl", "کلسترول خوب (HDL)", r"\bhdl\b", "mg/dL", 40, 1000,
     "HDL پایین؛ ورزش منظم می‌تواند آن را بالا ببرد.", ""),
    ("ldl", "کلسترول بد (LDL)", r"\bldl\b", "mg/dL", 0, 130,
     "", "LDL بالا؛ رژیم کم‌چرب و پیگیری پزشک توصیه می‌شود."),
    ("chol", "کلسترول کل", r"\b(chol(esterol)?|tc)\b", "mg/dL", 0, 200,
     "", "کلسترول بالا خطر بیماری قلبی را افزایش می‌دهد."),
    ("hb", "هموگلوبین", r"\b(hb|hgb|ha?emoglobin)\b", "g/dL", 12, 17.5,
     "هموگلوبین پایین؛ احتمال کم‌خونی.", "هموگلوبین بالا؛ با پزشک بررسی شود."),
    ("wbc", "گلبول سفید", r"\b(wbc|white\s*blood)\b", "10³/µL", 4, 11,
     "گلبول سفید پایین؛ ممکن است ایمنی ضعیف شده باشد.", "گلبول سفید بالا؛ ممکن است نشانه عفونت یا التهاب باشد."),
    ("rbc", "گلبول قرمز", r"\b(rbc|red\s*blood)\b", "10⁶/µL", 4.2, 6.1,
     "گلبول قرمز پایین؛ احتمال کم‌خونی.", "گلبول قرمز بالا."),
    ("plt", "پلاکت", r"\b(plt|platelets?)\b", "10³/µL", 150, 450,
     "پلاکت پایین؛ ممکن است خونریزی راحت‌تر رخ دهد.", "پلاکت بالا."),
    ("mcv", "حجم گلبول قرمز (MCV)", r"\bmcv\b", "fL", 80, 100,
     "MCV پایین؛ از علائم احتمالی کمبود آهن.", "MCV بالا؛ گاهی به کمبود B12 یا فولات مربوط است."),
    ("ferritin", "فریتین", r"\bferritin\b", "ng/mL", 15, 300,
     "ذخیره آهن پایین است.", "فریتین بالا؛ با پزشک بررسی شود."),
    ("vitd", "ویتامین D", r"\b(vit(amin)?\s*d|25\s*-?\s*oh)\b", "ng/mL", 30, 100,
     "کمبود ویتامین D؛ مکمل با نظر پزشک.", "ویتامین D بیش از حد."),
    ("b12", "ویتامین B12", r"\b(vit(amin)?\s*b\s*12|b12|cobalamin)\b", "pg/mL", 200, 900,
     "کمبود B12؛ می‌تواند باعث خستگی و بی‌حسی شود.", ""),
    ("tsh", "هورمون TSH", r"\btsh\b", "mIU/L", 0.4, 4.5,
     "TSH پایین؛ احتمال پرکاری تیروئید.", "TSH بالا؛ احتمال کم‌کاری تیروئید."),
    ("cr", "کراتینین", r"\b(cr|creat(inine)?)\b", "mg/dL", 0.6, 1.3,
     "", "کراتینین بالا؛ عملکرد کلیه با پزشک بررسی شود."),
    ("bun", "اوره خون (BUN)", r"\b(bun|urea)\b", "mg/dL", 7, 20,
     "", "اوره بالا؛ ممکن است به کم‌آبی یا کلیه مربوط باشد."),
    ("ua", "اسید اوریک", r"\b(uric\s*acid|ua)\b", "mg/dL", 3.5, 7.2,
     "", "اسید اوریک بالا؛ خطر نقرس."),
    ("alt", "آنزیم کبدی ALT (SGPT)", r"\b(alt|sgpt)\b", "U/L", 0, 40,
     "", "ALT بالا؛ کبد چرب یا مشکلات کبدی را بررسی کنید."),
    ("ast", "آنزیم کبدی AST (SGOT)", r"\b(ast|sgot)\b", "U/L", 0, 40,
     "", "AST بالا؛ با پزشک بررسی شود."),
    ("na", "سدیم", r"\b(na|sodium)\b", "mmol/L", 135, 145, "سدیم پایین.", "سدیم بالا."),
    ("k", "پتاسیم", r"\b(k|potassium)\b", "mmol/L", 3.5, 5.1, "پتاسیم پایین.", "پتاسیم بالا."),
    ("ca", "کلسیم", r"\b(ca|calcium)\b", "mg/dL", 8.5, 10.5, "کلسیم پایین.", "کلسیم بالا."),
]
_COMPILED = [(t, re.compile(t[2], re.IGNORECASE)) for t in TESTS]
_NUM = re.compile(r"(?<![\d.])(\d{1,5}(?:[.,]\d{1,3})?)(?![\d])")
_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٫", "01234567890123456789.")


def normalize(text: str) -> str:
    return text.translate(_FA_DIGITS)


def parse_text(text: str) -> list[dict]:
    """Find known tests in text lines and read the first number after the test name."""
    results: dict[str, dict] = {}
    for line in normalize(text).splitlines():
        for test, rx in _COMPILED:
            key = test[0]
            if key in results:
                continue
            m = rx.search(line)
            if not m:
                continue
            rest = line[m.end():]
            nm = _NUM.search(rest)
            if not nm:
                continue
            value = float(nm.group(1).replace(",", "."))
            results[key] = _evaluate(test, value)
            break  # one test per line
    order = [t[0] for t in TESTS]
    return sorted(results.values(), key=lambda r: order.index(r["key"]))


def _evaluate(test, value: float) -> dict:
    key, fa, _, unit, low, high, low_msg, high_msg = test
    if value < low:
        status, note = "low", low_msg or "پایین‌تر از محدوده مرجع."
    elif value > high:
        status, note = "high", high_msg or "بالاتر از محدوده مرجع."
    else:
        status, note = "normal", "در محدوده طبیعی."
    return {"key": key, "name": fa, "value": value, "unit": unit, "low": low, "high": high,
            "status": status, "note": note}


def summarize(results: list[dict]) -> str:
    if not results:
        return "هیچ آزمایش شناخته‌شده‌ای در متن پیدا نشد. می‌توانید نتایج را دستی تایپ کنید (مثلاً: FBS 110)."
    abnormal = [r for r in results if r["status"] != "normal"]
    if not abnormal:
        return f"{len(results)} مورد بررسی شد و همه در محدوده طبیعی هستند. 👌"
    names = "، ".join(r["name"] for r in abnormal)
    return (f"از {len(results)} مورد، {len(abnormal)} مورد خارج از محدوده است: {names}. "
            "محدوده‌ها عمومی هستند؛ تفسیر نهایی با پزشک شماست.")


class LabOCR:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._engine = None

    def available(self) -> bool:
        try:
            import rapidocr_onnxruntime  # noqa: F401
            return True
        except ImportError:
            return False

    def read(self, data: bytes) -> str:
        img = load_rgb(data)
        # Large photos slow OCR down a lot; 1600px on the long side is plenty.
        img.thumbnail((1600, 1600))
        arr = np.asarray(img)[:, :, ::-1].copy()  # RGB -> BGR
        with self._lock:
            if self._engine is None:
                from rapidocr_onnxruntime import RapidOCR
                self._engine = RapidOCR()
            result, _ = self._engine(arr)
        return group_lines(result or [])


def group_lines(boxes) -> str:
    """Join OCR boxes that sit on the same row into one text line (left to right)."""
    items = []
    for box, text, _score in boxes:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        items.append(((min(ys) + max(ys)) / 2, max(ys) - min(ys), min(xs), text))
    items.sort(key=lambda i: i[0])
    lines: list[list] = []
    for it in items:
        if lines and abs(it[0] - lines[-1][0][0]) < max(it[1], lines[-1][0][1]) * 0.6:
            lines[-1].append(it)
        else:
            lines.append([it])
    return "\n".join(" ".join(t[3] for t in sorted(line, key=lambda i: i[2])) for line in lines)


lab_ocr = LabOCR()
