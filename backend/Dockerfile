FROM python:3.12-slim

WORKDIR /app

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# requirementsだけ先にCOPYしてレイヤーキャッシュを効かせる
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# --reload はdefaultにしない（起動が遅く不安定になるため）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
