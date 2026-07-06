FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_COLOR=1 \
    PIP_ROOT_USER_ACTION=ignore

# Install LibreOffice Calc (for xlsx → PDF conversion) + Liberation fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice-calc \
        fonts-liberation \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

RUN python -m pip install --no-compile --progress-bar=off -r requirements.txt

COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads/po_docs /app/uploads/qtn_docs /app/uploads/completion_docs

EXPOSE 8000

CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--log-level", "info", "--access-log"]
