# KaamKoRecord on the VPS. scripts/deploy.sh builds and starts it; Bideshkosathi's nginx sends
# kaamkorecord.com here.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=mywork.settings.production \
    SQLITE_PATH=/data/db.sqlite3

# Tesseract reads picking list photos (apps/plu). ffmpeg shortens and checks story videos.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt "gunicorn>=23,<24"

COPY . .
RUN useradd --uid 1000 --create-home app \
    && mkdir -p /data /app/media /app/staticfiles \
    && chown -R app:app /data /app/media /app/staticfiles
USER app

EXPOSE 8000
CMD ["gunicorn", "mywork.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120"]
