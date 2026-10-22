"""
Featherkeeper identifier: scores a bird photo against a list of candidate species
with BioCLIP 2 (https://huggingface.co/imageomics/bioclip-2), running locally.

The API decides which species are plausible (from eBird records near the photo's
location) and sends them as candidates with a prior weight. This service turns the
image-to-text similarities into probabilities, multiplies by the priors, and returns
the ranked list.

POST /identify   multipart: image (file), candidates (JSON list), top (int, optional)
GET  /health     {"status": "ok" | "loading" | "error", ...}
"""

import io
import json
import os
import threading
import time
from pathlib import Path

import numpy as np
import open_clip
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps

MODEL_ID = os.environ.get("MODEL", "hf-hub:imageomics/bioclip-2")
CACHE_DIR = Path(os.environ.get("CACHE_DIR", "/models"))
# Softmax temperature applied to the model's similarity logits. Above 1 spreads
# probability more evenly (less overconfident); below 1 sharpens it.
TEMPERATURE = float(os.environ.get("TEMPERATURE", "1.0"))
MAX_CANDIDATES = 3000

if os.environ.get("TORCH_THREADS"):
    torch.set_num_threads(int(os.environ["TORCH_THREADS"]))

app = FastAPI(title="Featherkeeper identifier")
state = {"status": "loading", "error": None, "load_seconds": None}
model_lock = threading.Lock()

# Text embeddings depend only on the prompt, so they are cached in memory and on disk.
text_cache: dict[str, np.ndarray] = {}
cache_file = CACHE_DIR / f"text-cache-{MODEL_ID.replace('/', '_').replace(':', '_')}.npz"


def load_model():
    try:
        started = time.time()
        model, _, preprocess = open_clip.create_model_and_transforms(MODEL_ID)
        tokenizer = open_clip.get_tokenizer(MODEL_ID)
        model.eval()
        state.update(model=model, preprocess=preprocess, tokenizer=tokenizer)
        if cache_file.exists():
            data = np.load(cache_file, allow_pickle=False)
            for prompt, vector in zip(data["prompts"], data["vectors"]):
                text_cache[str(prompt)] = vector
        state.update(status="ok", load_seconds=round(time.time() - started, 1))
        print(f"[identifier] {MODEL_ID} ready in {state['load_seconds']} s, {len(text_cache)} cached prompts", flush=True)
    except Exception as err:  # noqa: BLE001 - surfaced through /health
        state.update(status="error", error=repr(err))
        print(f"[identifier] failed to load model: {err!r}", flush=True)


threading.Thread(target=load_model, daemon=True).start()


def prompt_for(c: dict) -> str:
    """BioCLIP's taxonomic + common-name prompt, e.g.
    'a photo of Animalia Chordata Aves Passeriformes Turdidae Turdus migratorius with common name American Robin'."""
    ranks = ["Animalia", "Chordata", "Aves"]
    for key in ("order", "family"):
        if c.get(key):
            ranks.append(str(c[key]).strip())
    text = f"a photo of {' '.join(ranks)} {str(c['scientificName']).strip()}"
    if c.get("commonName"):
        text += f" with common name {str(c['commonName']).strip()}"
    return text


def save_cache():
    if not text_cache:
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = cache_file.with_suffix(".tmp.npz")
    prompts = list(text_cache.keys())
    np.savez(tmp, prompts=np.array(prompts), vectors=np.stack([text_cache[p] for p in prompts]))
    tmp.replace(cache_file)


def text_matrix(prompts: list[str]) -> np.ndarray:
    missing = [p for p in dict.fromkeys(prompts) if p not in text_cache]
    if missing:
        model, tokenizer = state["model"], state["tokenizer"]
        with torch.no_grad():
            for i in range(0, len(missing), 64):
                batch = missing[i : i + 64]
                features = model.encode_text(tokenizer(batch))
                features = features / features.norm(dim=-1, keepdim=True)
                for prompt, vector in zip(batch, features.numpy().astype(np.float32)):
                    text_cache[prompt] = vector
        save_cache()
    return np.stack([text_cache[p] for p in prompts])


def letterbox(image: Image.Image) -> Image.Image:
    """Pad to a square so the whole frame is seen (the default transform crops the edges)."""
    w, h = image.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), (128, 128, 128))
    canvas.paste(image, ((side - w) // 2, (side - h) // 2))
    return canvas


def image_vector(image: Image.Image) -> np.ndarray:
    """Average two views: the full frame and the default centre crop."""
    model, preprocess = state["model"], state["preprocess"]
    batch = torch.stack([preprocess(letterbox(image)), preprocess(image)])
    with torch.no_grad():
        features = model.encode_image(batch)
        features = features / features.norm(dim=-1, keepdim=True)
        mean = features.mean(dim=0)
        mean = mean / mean.norm()
    return mean.numpy().astype(np.float32)


def softmax(x: np.ndarray) -> np.ndarray:
    z = x - x.max()
    e = np.exp(z)
    return e / e.sum()


@app.get("/health")
def health():
    body = {"status": state["status"], "model": MODEL_ID, "cachedPrompts": len(text_cache)}
    if state["error"]:
        body["error"] = state["error"]
    if state["load_seconds"] is not None:
        body["loadSeconds"] = state["load_seconds"]
    return body


@app.post("/identify")
def identify(image: UploadFile = File(...), candidates: str = Form(...), top: int = Form(10)):
    if state["status"] != "ok":
        detail = "The model is still loading. Try again in a minute." if state["status"] == "loading" else state["error"]
        raise HTTPException(status_code=503, detail=detail)

    try:
        cands = json.loads(candidates)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=400, detail=f"candidates is not valid JSON: {err}") from err
    if not isinstance(cands, list) or not cands:
        raise HTTPException(status_code=400, detail="candidates must be a non-empty list")
    if len(cands) > MAX_CANDIDATES:
        raise HTTPException(status_code=400, detail=f"at most {MAX_CANDIDATES} candidates")
    for c in cands:
        if not isinstance(c, dict) or not c.get("scientificName"):
            raise HTTPException(status_code=400, detail="every candidate needs a scientificName")

    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(image.file.read()))).convert("RGB")
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"could not read the image: {err}") from err

    started = time.time()
    with model_lock:  # one inference at a time keeps memory predictable
        texts = text_matrix([prompt_for(c) for c in cands])
        vec = image_vector(img)
        scale = float(state["model"].logit_scale.exp())
    logits = scale * (texts @ vec) / TEMPERATURE
    image_prob = softmax(logits)

    priors = np.array([max(float(c.get("prior", 1.0)), 1e-6) for c in cands])
    posterior = image_prob * priors
    posterior = posterior / posterior.sum()

    order = np.argsort(-posterior)[: max(1, min(int(top), 50))]
    return {
        "model": MODEL_ID,
        "seconds": round(time.time() - started, 2),
        "candidates": len(cands),
        "predictions": [
            {
                "id": cands[i].get("id"),
                "scientificName": cands[i]["scientificName"],
                "commonName": cands[i].get("commonName"),
                "confidence": round(float(posterior[i]), 4),
                "imageScore": round(float(image_prob[i]), 4),
                "prior": round(float(priors[i]), 4),
            }
            for i in order
        ],
    }
