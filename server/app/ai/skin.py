"""Skin lesion screening: EfficientNet-B3 ONNX model trained on ISIC (9 classes).

This is a screening aid, not a diagnosis. Risk levels are deliberately cautious.
"""
import threading
from pathlib import Path

import numpy as np

from ..config import settings
from .images import center_square, load_rgb, softmax

MODEL_FILE = "skin_classifier_v1.onnx"
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

CLASSES = [
    ("akiec", "کراتوز اکتینیک (پیش‌سرطانی)", "medium"),
    ("bcc", "کارسینوم سلول بازال", "high"),
    ("bkl", "ضایعه خوش‌خیم شبیه کراتوز", "low"),
    ("df", "درماتوفیبروما (خوش‌خیم)", "low"),
    ("nv", "خال ملانوسیتی (معمولاً خوش‌خیم)", "low"),
    ("mel", "ملانوما", "high"),
    ("vasc", "ضایعه عروقی", "low"),
    ("scc", "کارسینوم سلول سنگفرشی", "high"),
    ("unk", "نامشخص / سایر", "medium"),
]

ADVICE = {
    "high": "احتمال یک ضایعه نیازمند بررسی وجود دارد. لطفاً در اولین فرصت به متخصص پوست مراجعه کنید.",
    "medium": "نتیجه قطعی نیست. بهتر است ضایعه توسط پزشک دیده شود، به‌خصوص اگر تغییر اندازه، رنگ یا خونریزی دارد.",
    "low": "به نظر خوش‌خیم می‌رسد. با قانون ABCDE (عدم تقارن، لبه نامنظم، رنگ، قطر بیش از ۶ میلی‌متر، تغییر) آن را پایش کنید.",
}


class SkinModel:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sess = None

    @property
    def path(self) -> Path:
        return settings.models_dir / MODEL_FILE

    def available(self) -> bool:
        return self.path.exists() and (settings.models_dir / (MODEL_FILE + ".data")).exists()

    def _load(self):
        if self._sess is None:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            self._sess = ort.InferenceSession(str(self.path), opts, providers=["CPUExecutionProvider"])
        return self._sess

    def predict(self, data: bytes) -> dict:
        img = center_square(load_rgb(data)).resize((300, 300))
        x = (np.asarray(img, dtype=np.float32) / 255.0 - MEAN) / STD
        x = np.transpose(x, (2, 0, 1))[None].astype(np.float32)
        with self._lock:
            sess = self._load()
            logits = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
        probs = softmax(logits)
        preds = sorted(
            ({"code": c, "label": fa, "risk": r, "score": float(p)} for (c, fa, r), p in zip(CLASSES, probs)),
            key=lambda d: d["score"],
            reverse=True,
        )
        high = sum(p["score"] for p in preds if p["risk"] == "high")
        top = preds[0]
        if high >= 0.30 or top["risk"] == "high":
            risk = "high"
        elif top["score"] < 0.5 or top["risk"] == "medium" or high >= 0.15:
            risk = "medium"
        else:
            risk = "low"
        return {
            "risk": risk,
            "advice": ADVICE[risk],
            "uncertain": top["score"] < 0.5,
            "predictions": preds[:5],
            "disclaimer": "این ابزار فقط برای غربالگری است و جایگزین معاینه پزشک نیست.",
        }


skin_model = SkinModel()
