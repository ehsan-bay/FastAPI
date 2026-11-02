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


food_model = FoodModel()
