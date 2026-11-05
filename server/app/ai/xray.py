"""Chest X-ray screening: TorchXRayVision DenseNet-121 ("all" weights, 18 findings), exported to ONNX.

For clinicians only: results are decision support, never a diagnosis. Scores are calibrated so that
0.5 is the model's operating point (op_norm from torchxrayvision), i.e. above 0.5 = "flagged".
"""
import json
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from ..config import settings
from .images import BadImage

MODEL = "xray-densenet121.onnx"
LABELS = "xray-labels.json"

FA = {
    "Atelectasis": "آتلکتازی (کلاپس بخشی از ریه)", "Consolidation": "کانسالیدیشن (تراکم ریه)", "Infiltration": "انفیلتراسیون",
    "Pneumothorax": "پنوموتوراکس (هوا در فضای جنب)", "Edema": "ادم ریه", "Emphysema": "آمفیزم", "Fibrosis": "فیبروز",
    "Effusion": "افیوژن (مایع در فضای جنب)", "Pneumonia": "پنومونی (ذات‌الریه)", "Pleural_Thickening": "ضخیم‌شدگی پرده جنب",
    "Cardiomegaly": "کاردیومگالی (بزرگی قلب)", "Nodule": "ندول ریوی", "Mass": "توده", "Hernia": "هرنی",
    "Lung Lesion": "ضایعه ریوی", "Fracture": "شکستگی", "Lung Opacity": "کدورت ریه", "Enlarged Cardiomediastinum": "پهن‌شدگی مدیاستن",
}
URGENT = {"Pneumothorax", "Edema", "Pneumonia", "Consolidation", "Effusion", "Mass"}


class XRayModel:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sess = None
        self._labels: list[str] = []
        self._th = None

    @property
    def path(self) -> Path:
        return settings.models_dir / MODEL

    def available(self) -> bool:
        return self.path.exists() and (settings.models_dir / LABELS).exists()

    def _load(self):
        if self._sess is None:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            self._sess = ort.InferenceSession(str(self.path), opts, providers=["CPUExecutionProvider"])
            meta = json.loads((settings.models_dir / LABELS).read_text(encoding="utf-8"))
            self._labels = meta["labels"]
            self._th = np.array([np.nan if t is None else t for t in meta["op_threshs"]], dtype=np.float32)
        return self._sess

    @staticmethod
    def preprocess(data: bytes) -> np.ndarray:
        import io

        try:
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        except Exception as exc:
            raise BadImage("تصویر قابل خواندن نیست") from exc
        img = img.convert("L")
        w, h = img.size
        if min(w, h) < 128:
            raise BadImage("وضوح تصویر برای عکس رادیولوژی کافی نیست")
        s = min(w, h)
        img = img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((224, 224), Image.BILINEAR)
        x = np.asarray(img, dtype=np.float32) / 255.0 * 2048.0 - 1024.0  # torchxrayvision range [-1024, 1024]
        return x[None, None]

    def predict(self, data: bytes) -> dict:
        x = self.preprocess(data)
        with self._lock:
            sess = self._load()
            p = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
        th = self._th
        scores = np.where(p < th, p / (th * 2), 1 - (1 - p) / ((1 - th) * 2))
        findings = sorted(
            ({"code": l, "label": FA.get(l, l), "score": round(float(s), 3), "flag": bool(s >= 0.5), "urgent": l in URGENT}
             for l, s in zip(self._labels, scores) if l and not np.isnan(s)),
            key=lambda f: f["score"], reverse=True)
        flagged = [f for f in findings if f["flag"]]
        level = "high" if any(f["urgent"] and f["score"] >= 0.6 for f in flagged) else "medium" if flagged else "low"
        return {
            "level": level,
            "findings": findings,
            "flagged": [f["label"] for f in flagged],
            "disclaimer": "این ابزار کمکی برای پزشک است و جایگزین گزارش رادیولوژیست نیست. فقط برای عکس‌های قفسه سینه (نمای روبه‌رو) طراحی شده است.",
        }


xray_model = XRayModel()
