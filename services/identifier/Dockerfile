# Featherkeeper identifier: BioCLIP 2 on CPU.
FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    CACHE_DIR=/models

WORKDIR /app
# CPU-only PyTorch keeps the image around 1 GB instead of several GB of CUDA libraries.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .
# Model weights (about 1.7 GB for BioCLIP 2) download into /models on first start; mount a volume there.
RUN useradd -u 1000 -m app && mkdir -p /models && chown app:app /models
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=900s --retries=3 \
  CMD python -c "import json,urllib.request,sys; sys.exit(0 if json.load(urllib.request.urlopen('http://127.0.0.1:8000/health'))['status']=='ok' else 1)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
