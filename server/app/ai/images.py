"""Shared image decoding for the vision models."""
import io

import numpy as np
from PIL import Image, ImageOps


class BadImage(ValueError):
    pass


def load_rgb(data: bytes) -> Image.Image:
    if not data:
        raise BadImage("فایل تصویر خالی است")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        return img.convert("RGB")
    except Exception as exc:  # PIL raises many types
        raise BadImage("تصویر قابل خواندن نیست (JPG یا PNG بفرستید)") from exc


def center_square(img: Image.Image) -> Image.Image:
    w, h = img.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    return img.crop((left, top, left + s, top + s))


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()
