# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Perdura — production image: one container serves the built UI and the API on
# a single origin (port 8000). Put a TLS-terminating, authenticating reverse
# proxy in front of it (see docker-compose.yml + deploy/Caddyfile). The app has
# no authentication of its own, so it must never be exposed to a network
# without that proxy. See docs/DEPLOYMENT.md.
# ---------------------------------------------------------------------------

# --- Stage 1: build the React/Vite frontend into static assets --------------
FROM node:22-slim AS frontend
WORKDIR /build
# Install deps first (cached unless package manifests change).
COPY gui/frontend/package.json gui/frontend/package-lock.json ./
RUN npm ci
# Build the SPA -> /build/dist (Vite outputs to <root>/dist).
COPY gui/frontend/ ./
RUN npm run build

# --- Stage 2: Python runtime that serves API + the built dist ---------------
FROM python:3.11-slim AS runtime

# Headless matplotlib (the reliability library imports pyplot); no bytecode
# files, unbuffered logs.
ENV MPLBACKEND=Agg \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WEB_CONCURRENCY=4

WORKDIR /app

# Backend dependencies (FastAPI/Uvicorn/Pydantic/numpy/scipy/pandas/sklearn).
COPY gui/backend/requirements.txt gui/backend/requirements.txt
RUN pip install --no-cache-dir -r gui/backend/requirements.txt

# Install the reliability library (src layout) so `import reliability` resolves.
COPY pyproject.toml ./
COPY src/ src/
RUN pip install --no-cache-dir -e .

# Application code.
COPY gui/backend/ gui/backend/

# The built SPA goes exactly where main.py's _find_static_dir() looks:
# <backend>/../frontend/dist == /app/gui/frontend/dist.
COPY --from=frontend /build/dist/ gui/frontend/dist/

# Run unprivileged.
RUN useradd --create-home --uid 10001 perdura \
    && chown -R perdura:perdura /app
USER perdura

WORKDIR /app/gui/backend
EXPOSE 8000

# Liveness: the slim image has no curl, so probe with Python.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

# Multiple workers = real parallelism across requests (the per-process
# Telcordia reference caches are read-only and safe). No --reload in prod.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-4}"]
