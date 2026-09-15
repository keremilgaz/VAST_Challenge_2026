# Backend image for Azure.
# Difference from the compose backend/Dockerfile: the dataset is baked into the
# image instead of bind-mounted, because Container Apps has no host mounts.
#
# Build context is the repository root:
#   az acr build -r <acr> -f infra/docker/backend.Dockerfile -t vast-backend:v1 .

FROM python:3.12-slim

WORKDIR /app

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_PATH=/app/data/MC1_final_00.json

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ /app/
COPY data/ /app/data/

# Run as a non-root user (container security hygiene)
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
