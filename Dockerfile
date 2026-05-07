FROM python:3.12-slim

WORKDIR /app

# Install system deps for lxml, playwright, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Litestream
RUN curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.5.11/litestream-0.5.11-linux-x86_64.tar.gz \
    | tar -xz -C /usr/local/bin

# Install Python dependencies first (layer caches until requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8080

# On startup: always restore fresh DB from B2 (production is read-only), then launch app
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
