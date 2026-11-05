"""Food recognition: EfficientNet-Lite2 (ImageNet, on-device class model) mapped to a nutrition table.

The model only knows ~60 food classes, so results are shown as suggestions and the
user confirms or searches the full food table (which also has Iranian dishes).
"""
import json
import threading
import zipfile
from pathlib import Path

import numpy as np

from ..config import settings
from .images import center_square, load_rgb

MODEL_FILE = "efficientnet_lite2.tflite"
FOODS_PATH = Path(__file__).resolve().parent.parent / "data" / "foods.json"

FOODS: list[dict] = json.loads(FOODS_PATH.read_text(encoding="utf-8"))
FOODS_BY_KEY = {f["key"]: f for f in FOODS}
_LABEL_TO_FOOD = {label: f for f in FOODS for label in f["labels"]}


CLIP_MODEL = "clip-visual.int8.onnx"
CLIP_TEXT = "clip-foods.npz"
CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


class ClipFood:
    """Zero-shot food recognition: compares the photo with text descriptions of every dish in foods.json
    (including Iranian dishes), so new dishes need no training, only a description."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sess = None
        self._keys: list[str] = []
        self._emb = None
        self._scale = 100.0

    def available(self) -> bool:
        return (settings.models_dir / CLIP_MODEL).exists() and (settings.models_dir / CLIP_TEXT).exists()

    def _load(self):
        if self._sess is None:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            self._sess = ort.InferenceSession(str(settings.models_dir / CLIP_MODEL), opts, providers=["CPUExecutionProvider"])
            z = np.load(settings.models_dir / CLIP_TEXT)
            self._keys = [str(k) for k in z["keys"]]
            self._emb = z["embeddings"].astype(np.float32)
            self._scale = float(z["logit_scale"])
        return self._sess

    def predict(self, data: bytes, top_k: int = 5) -> dict:
        img = load_rgb(data)
        w, h = img.size
        scale = 224 / min(w, h)
        img = img.resize((max(224, round(w * scale)), max(224, round(h * scale))), resample=3)  # bicubic, like CLIP
        img = center_square(img).resize((224, 224))
        x = (np.asarray(img, dtype=np.float32) / 255.0 - CLIP_MEAN) / CLIP_STD
        x = np.transpose(x, (2, 0, 1))[None].astype(np.float32)
        with self._lock:
            sess = self._load()
            e = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
        e = e / (np.linalg.norm(e) + 1e-9)
        logits = self._scale * (self._emb @ e)
        p = np.exp(logits - logits.max())
        p /= p.sum()
        order = np.argsort(-p)
        not_food = float(sum(p[i] for i, k in enumerate(self._keys) if k.startswith("_not_food")))
        candidates = [{**FOODS_BY_KEY[self._keys[i]], "score": round(float(p[i]), 4)}
                      for i in order if not self._keys[i].startswith("_not_food")][:top_k]
        is_food = not_food < 0.5 and bool(candidates) and candidates[0]["score"] >= 0.15
        return {"is_food": is_food, "candidates": candidates, "engine": "clip", "not_food": round(not_food, 3)}


class FoodModel:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._interp = None
        self._labels: list[str] = []
        self.size = 260

    @property
    def path(self) -> Path:
        return settings.models_dir / MODEL_FILE

    def available(self) -> bool:
        return self.path.exists()

    def _load(self):
        if self._interp is None:
            from ai_edge_litert.interpreter import Interpreter

            interp = Interpreter(model_path=str(self.path), num_threads=2)
            interp.allocate_tensors()
            self.size = int(interp.get_input_details()[0]["shape"][1])
            # The labels file is packed inside the .tflite (it is also a zip).
            with zipfile.ZipFile(self.path) as z:
                self._labels = z.read("labels_without_background.txt").decode().splitlines()
            self._interp = interp
        return self._interp

    def predict(self, data: bytes, top_k: int = 5) -> dict:
        img = center_square(load_rgb(data)).resize((self.size, self.size))
        x = (np.asarray(img, dtype=np.float32) - 127.5) / 127.5
        with self._lock:
            interp = self._load()
            interp.set_tensor(interp.get_input_details()[0]["index"], x[None])
            interp.invoke()
            probs = interp.get_tensor(interp.get_output_details()[0]["index"])[0].copy()

        order = np.argsort(probs)[::-1]
        raw = [{"label": self._labels[i], "score": float(probs[i])} for i in order[:top_k]]
        # Collect food matches from the top 50 classes, summing scores per food.
        foods: dict[str, float] = {}
        for i in order[:50]:
            food = _LABEL_TO_FOOD.get(self._labels[i])
            if food:
                foods[food["key"]] = foods.get(food["key"], 0.0) + float(probs[i])
        candidates = [
            {**FOODS_BY_KEY[k], "score": round(s, 4)}
            for k, s in sorted(foods.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
        ]
        is_food = bool(candidates) and candidates[0]["score"] >= 0.15
        return {"is_food": is_food, "candidates": candidates, "raw": raw}


def search_foods(q: str, limit: int = 20) -> list[dict]:
    q = q.strip().lower()
    if not q:
        return FOODS[:limit]
    hits = [f for f in FOODS if q in f["fa"].lower() or q in f["en"].lower() or q in f["key"]]
    return hits[:limit]


class FoodRecognizer:
    """CLIP (Iranian dishes included) when its files are installed, otherwise EfficientNet-Lite2."""

    def __init__(self) -> None:
        self.clip = ClipFood()
        self.efficientnet = FoodModel()

    def available(self) -> bool:
        return self.clip.available() or self.efficientnet.available()

    def engine(self) -> str:
        return "clip" if self.clip.available() else "efficientnet" if self.efficientnet.available() else "none"

    def predict(self, data: bytes, top_k: int = 5) -> dict:
        if self.clip.available():
            return self.clip.predict(data, top_k)
        return self.efficientnet.predict(data, top_k) | {"engine": "efficientnet"}


food_model = FoodRecognizer()
