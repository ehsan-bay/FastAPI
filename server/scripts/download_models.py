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

AI = "https://raw.githubusercontent.com/ehsan-bay/FastAPI/ai-models"
MODELS += [
    ("clip-visual.int8.onnx", f"{AI}/clip-visual.int8.onnx",
     "38751b52d3631e3018bd5990298a9b758b7c72c14cd681631156b65c13ec5724", "Food zero-shot (OpenCLIP ViT-B/32, MIT)"),
    ("clip-foods.npz", f"{AI}/clip-foods.npz",
     "6e5fb30a4537898d78664ee4d4ec342f3d35d2192054e33425337e44907295f9", "Food descriptions for CLIP"),
    ("xray-densenet121.onnx", f"{AI}/xray-densenet121.onnx",
     "c1d8b5297f86884bf92048714031540efba55d142fc8d23d8868a3d69aa7c4bf", "Chest X-ray (TorchXRayVision, Apache-2.0)"),
    ("xray-labels.json", f"{AI}/xray-labels.json",
     "047fff862717cfc8a1519788a89446c096dc01b512ec267bcfae1496ed58fbc1", "Chest X-ray labels"),
]

SHERPA = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
# (target dir, archive url, members to keep (prefix match, path inside the archive's top folder), file that marks "done", description)
ARCHIVES = [
    ("asr", f"{SHERPA}/asr-models/sherpa-onnx-whisper-small.tar.bz2",
     ["small-encoder.int8.onnx", "small-decoder.int8.onnx", "small-tokens.txt"], "small-decoder.int8.onnx",
     "Persian speech recognition (Whisper small int8, MIT)"),
    ("tts", f"{SHERPA}/tts-models/vits-piper-fa_IR-amir-medium.tar.bz2",
     ["fa_IR-amir-medium.onnx", "fa_IR-amir-medium.onnx.json", "tokens.txt", "espeak-ng-data/", "MODEL_CARD"],
     "fa_IR-amir-medium.onnx", "Persian voice (Piper fa_IR amir)"),
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
    if not digest and tmp.stat().st_size < 1024:
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


def fetch_archive(target: str, url: str, keep: list[str], marker: str, desc: str, force: bool) -> bool:
    import tarfile
    import tempfile

    dest = MODELS_DIR / target
    if (dest / marker).exists() and not force:
        print(f"✓ {target}/ (already present)")
        return True
    print(f"↓ {target}/ — {desc}")
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".tar.bz2", dir=MODELS_DIR, delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "salamat-ai-model-downloader"})
        with urllib.request.urlopen(req, timeout=120) as resp, tmp_path.open("wb") as out:
            shutil.copyfileobj(resp, out, length=1 << 20)
        with tarfile.open(tmp_path, "r:bz2") as tar:
            for m in tar.getmembers():
                inner = m.name.split("/", 1)[1] if "/" in m.name else ""
                if not inner or not any(inner == k or inner.startswith(k) for k in keep):
                    continue
                if not (m.isfile() or m.isdir()) or ".." in inner:
                    continue
                m.name = inner
                tar.extract(m, dest, filter="data")
    except Exception as exc:
        print(f"✗ {target}/: {exc}", file=sys.stderr)
        return False
    finally:
        tmp_path.unlink(missing_ok=True)
    print(f"✓ {target}/")
    return (dest / marker).exists()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--llm", action="store_true", help="also download the optional chat LLM")
    p.add_argument("--force", action="store_true", help="download again even if present")
    args = p.parse_args()
    items = MODELS + ([LLM] if args.llm else [])
    ok = all([fetch(*m, force=args.force) for m in items])
    ok = all([fetch_archive(*a, force=args.force) for a in ARCHIVES]) and ok
    print("done" if ok else "some downloads failed (the related features will be disabled)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
