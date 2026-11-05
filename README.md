# Salamat AI — converted models

Converted with `server/scripts/convert_models.py` (PyTorch → ONNX). Downloaded by `server/scripts/download_models.py`.

| File | Source | License |
|---|---|---|
| `clip-visual.int8.onnx`, `clip-foods.npz` | OpenCLIP ViT-B/32 quickgelu, LAION-400M e32 (mlfoundations/open_clip); int8 image encoder + text embeddings of the app's food list | MIT (OpenCLIP) |
| `xray-densenet121.onnx`, `xray-labels.json` | TorchXRayVision DenseNet-121 "densenet121-res224-all" (mlmed/torchxrayvision) | Apache-2.0 |

Research models for decision support only; not certified medical devices.
