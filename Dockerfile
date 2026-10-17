# ── Stage 1: Build the React frontend ──────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python Backend & Production Runtime ──────────────────────────────
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy packaging configuration and Python source files
COPY pyproject.toml ./
COPY faultline/ /app/faultline/
COPY demo_agent/ /app/demo_agent/
COPY ui/ /app/ui/

# Install python dependencies and faultline package
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# Copy built frontend assets from Stage 1 into /app/frontend/dist
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Create runtime directories
RUN mkdir -p /app/data/otel /app/.cache /app/eval/results

EXPOSE 8000

# Health check endpoint
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "faultline.api:app", "--host", "0.0.0.0", "--port", "8000"]
