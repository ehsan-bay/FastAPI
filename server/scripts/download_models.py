"""Download the AI models used by Salamat AI.

    python scripts/download_models.py            # required models
    python scripts/download_models.py --llm      # also a small chat LLM (~400 MB)

Server-side models go to MODELS_DIR (default server/models); on-device models go to
MODELS_DIR/device and are served to the app at /models/.
"""
import argparse
import hashlib
import os
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = Path(os.environ.get("MODELS_DIR", ROOT / "models"))

MP = "https://storage.googleapis.com/mediapipe-models"
SKIN = "https://media.githubusercontent.com/media/vin0san/skin-lesion-onnx-api/main/models"
SKIN_RAW = "https://raw.githubusercontent.com/vin0san/skin-lesion-onnx-api/main/models"

# (relative path, url, sha256 or None, description)
MODELS = [
    ("efficientnet_lite2.tflite",
     f"{MP}/image_classifier/efficientnet_lite2/float32/latest/efficientnet_lite2.tflite",
     None, "Food recognition (EfficientNet-Lite2, Apache-2.0)"),
    ("skin_classifier_v1.onnx", f"{SKIN_RAW}/skin_classifier_v1.onnx",
     None, "Skin lesion screening graph (EfficientNet-B3 / ISIC, MIT)"),
    ("skin_classifier_v1.onnx.data", f"{SKIN}/skin_classifier_v1.onnx.data",
     "a2fccc541a698d161a547b5962a9f752425ebe258280b789498e2dc3315f48c0", "Skin lesion weights"),
    ("device/pose_landmarker_lite.task",
     f"{MP}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
     None, "On-device pose (exercise coach, Apache-2.0)"),
    ("device/yamnet.tflite", f"{MP}/audio_classifier/yamnet/float32/latest/yamnet.tflite",
     None, "On-device sound events (sleep: snoring/cough, Apache-2.0)"),
]

LLM = ("llm/model.gguf",
       os.environ.get("LLM_URL",
                      "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/"
                      "qwen2.5-0.5b-instruct-q4_k_m.gguf"),
       None, "Chat assistant (Qwen2.5-0.5B-Instruct Q4, Apache-2.0)")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(rel: str, url: str, digest: str | None, desc: str, force: bool) -> bool:
    dest = MODELS_DIR / rel
    if dest.exists() and dest.stat().st_size > 1024 and not force:
        if not digest or sha256(dest) == digest:
            print(f"✓ {rel} (already present)")
            return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"↓ {rel} — {desc}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "salamat-ai-model-downloader"})
        with urllib.request.urlopen(req, timeout=60) as resp, tmp.open("wb") as out:
            shutil.copyfileobj(resp, out, length=1 << 20)
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        print(f"✗ {rel}: {exc}", file=sys.stderr)
        return False
    if tmp.stat().st_size < 1024:
        print(f"✗ {rel}: file too small (Git LFS pointer or error page?)", file=sys.stderr)
        tmp.unlink()
        return False
    if digest and sha256(tmp) != digest:
        print(f"✗ {rel}: checksum mismatch", file=sys.stderr)
        tmp.unlink()
        return False
    tmp.replace(dest)
    print(f"✓ {rel} ({dest.stat().st_size / 1e6:.1f} MB)")
    return True


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--llm", action="store_true", help="also download the optional chat LLM")
    p.add_argument("--force", action="store_true", help="download again even if present")
    args = p.parse_args()
    items = MODELS + ([LLM] if args.llm else [])
    ok = all([fetch(*m, force=args.force) for m in items])
    print("done" if ok else "some downloads failed (the related features will be disabled)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
