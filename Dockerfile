# Salamat AI — one container: FastAPI server + built PWA + AI models.

# 1) Build the web client (PWA)
FROM node:22-slim AS web
WORKDIR /app
COPY app/package.json app/package-lock.json ./
COPY app/scripts ./scripts
RUN npm ci
COPY app/ ./
RUN npm run build

# 2) Python server
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    MODELS_DIR=/srv/models DATA_DIR=/srv/data STATIC_DIR=/srv/web PORT=8000
WORKDIR /srv/server
COPY server/requirements.txt .
# Headless OpenCV avoids needing libGL / system packages.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python && pip install --no-cache-dir opencv-python-headless
# Optional chat LLM: docker build --build-arg WITH_LLM=1 .  (needs ~1 GB RAM)
ARG WITH_LLM=0
RUN if [ "$WITH_LLM" = "1" ]; then pip install --no-cache-dir llama-cpp-python; fi
COPY server/ .
RUN if [ "$WITH_LLM" = "1" ]; then python scripts/download_models.py --llm; else python scripts/download_models.py; fi
COPY --from=web /app/dist /srv/web
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
