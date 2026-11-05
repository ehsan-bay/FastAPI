"""One-off conversion of PyTorch models to ONNX for the server (needs torch; the server itself does not).

    pip install torch open-clip-torch torchxrayvision onnx onnxruntime
    python scripts/convert_models.py --clip-weights vit_b_32-quickgelu-laion400m_e32-46683a32.pt --out out/

Produces:
  clip-visual.int8.onnx     CLIP ViT-B/32 image encoder (OpenCLIP, LAION-400M), int8
  clip-foods.npz            text embeddings of every food in app/data/foods.json (+ "not food" classes)
  xray-densenet121.onnx     TorchXRayVision DenseNet-121 "all" (18 chest X-ray findings)
  xray-labels.json
"""
import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FOODS = json.loads((ROOT / "app" / "data" / "foods.json").read_text(encoding="utf-8"))

# What the dish looks like: CLIP knows appearance much better than Persian dish names.
LOOKS = {
    "chelow_kabab": "skewered grilled minced meat kebab with saffron white rice and grilled tomato",
    "joojeh_kabab": "grilled saffron chicken kebab pieces with white rice",
    "ghormeh_sabzi": "dark green herb stew with kidney beans and meat next to white rice",
    "gheimeh": "orange tomato stew with yellow split peas, meat and fried potato sticks on top, with rice",
    "fesenjan": "dark brown walnut and pomegranate stew with chicken, served with rice",
    "zereshk_polo": "white and saffron rice topped with red barberries, with chicken",
    "ash_reshteh": "thick green noodle and bean soup topped with whey, fried mint and fried onions",
    "adasi": "brown lentil soup in a bowl",
    "kashk_bademjan": "mashed eggplant dip topped with whey, fried onions and mint",
    "mirza_ghasemi": "smoky mashed eggplant with tomato, garlic and egg",
    "abgoosht": "lamb and chickpea stew with potatoes in a stone pot, with flatbread",
    "kuku_sabzi": "thick green herb omelette frittata slices",
    "kotlet": "fried flat patties of minced meat and potato",
    "macaroni": "spaghetti with meat and tomato sauce and crispy bottom",
    "tahchin": "golden crispy baked saffron rice cake with chicken",
    "loobia_polo": "rice mixed with green beans and meat in tomato sauce",
    "sabzi_polo_mahi": "green herb rice with fried fish",
    "halim": "thick wheat and meat porridge topped with cinnamon and sugar",
    "shole_zard": "yellow saffron rice pudding decorated with cinnamon and almonds",
    "rice": "a plate of plain white steamed rice",
    "sangak": "long whole wheat flatbread baked on pebbles",
    "barbari": "thick oval flatbread with sesame seeds",
    "lavash": "thin soft flatbread",
    "yogurt": "a bowl of plain white yogurt",
    "doogh": "a glass of white yogurt drink",
    "feta": "white feta cheese",
    "dates": "dates fruit",
    "walnut": "walnuts",
    "pistachio": "pistachio nuts",
    "tea_sugar": "a glass of black tea with sugar cubes",
    "tea": "a glass cup of black tea",
    "salad_shirazi": "chopped cucumber, tomato and onion salad",
    "olivieh": "creamy potato chicken and egg salad sandwich",
    "falafel": "falafel sandwich",
    "chicken_breast": "grilled chicken breast",
    "watermelon": "a slice of watermelon",
    "grapes": "a bunch of grapes",
    "egg": "boiled eggs",
    "omelette": "an omelette with tomato in a pan",
}
NOT_FOOD = ["a person", "a selfie", "a document with text", "a room interior", "human skin", "an x-ray image",
            "a car", "a cat or a dog", "a phone screen", "a landscape"]
TEMPLATES = ["a photo of {}.", "a close-up photo of {}, a type of food.", "{} on a plate."]


def convert_clip(weights: str, out: Path) -> None:
    import open_clip
    import torch

    model, _, _ = open_clip.create_model_and_transforms("ViT-B-32-quickgelu", pretrained=weights)
    model.eval()
    tok = open_clip.get_tokenizer("ViT-B-32-quickgelu")

    class Visual(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, x):
            return self.m.encode_image(x)

    fp32 = out / "clip-visual.onnx"
    torch.onnx.export(Visual(model), torch.randn(1, 3, 224, 224), str(fp32), input_names=["pixel_values"],
                      output_names=["image_embeds"], dynamic_axes={"pixel_values": {0: "b"}, "image_embeds": {0: "b"}},
                      opset_version=17, dynamo=False)
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(str(fp32), str(out / "clip-visual.int8.onnx"), weight_type=QuantType.QInt8)
    fp32.unlink()

    keys, texts = [], []
    for f in FOODS:
        keys.append(f["key"])
        texts.append(LOOKS.get(f["key"], f["en"]))
    for i, nf in enumerate(NOT_FOOD):
        keys.append(f"_not_food_{i}")
        texts.append(nf)
    with torch.no_grad():
        embs = []
        for t in texts:
            e = model.encode_text(tok([tpl.format(t) for tpl in TEMPLATES]))
            e = e / e.norm(dim=-1, keepdim=True)
            e = e.mean(0)
            embs.append((e / e.norm()).numpy())
    np.savez_compressed(out / "clip-foods.npz", keys=np.array(keys), embeddings=np.stack(embs).astype(np.float32),
                        logit_scale=np.float32(model.logit_scale.exp().item()))
    print("clip:", len(keys), "classes")


def convert_xray(out: Path) -> None:
    """Exports features + classifier + sigmoid. The operating-point calibration (op_norm) uses boolean
    indexing that ONNX export does not handle, so it is applied on the server with the thresholds saved here."""
    import torch
    import torchxrayvision as xrv

    model = xrv.models.DenseNet(weights="densenet121-res224-all")
    model.eval()

    class Core(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, x):
            return torch.sigmoid(self.m.classifier(self.m.features2(x)))

    torch.onnx.export(Core(model), torch.randn(1, 1, 224, 224), str(out / "xray-densenet121.onnx"), input_names=["image"],
                      output_names=["probs"], dynamic_axes={"image": {0: "b"}, "probs": {0: "b"}}, opset_version=17, dynamo=False)
    thr = [None if (t != t) else float(t) for t in model.op_threshs.tolist()]  # NaN -> None
    (out / "xray-labels.json").write_text(json.dumps({"labels": list(model.pathologies), "op_threshs": thr}), encoding="utf-8")
    print("xray:", len(model.pathologies), "labels")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--clip-weights")
    p.add_argument("--out", default="converted")
    p.add_argument("--skip-xray", action="store_true")
    a = p.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if a.clip_weights:
        convert_clip(a.clip_weights, out)
    if not a.skip_xray:
        convert_xray(out)
