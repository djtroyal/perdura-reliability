# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Perdura — production image: one container serves the built UI and the API on
# a single origin (port 8000). Put a TLS-terminating, authenticating reverse
# proxy in front of it (see docker-compose.yml + deploy/Caddyfile). The app has
# no authentication of its own, so it must never be exposed to a network
# without that proxy. See docs/DEPLOYMENT.md.
# ---------------------------------------------------------------------------

# --- Stage 1: build the React/Vite frontend into static assets --------------
FROM node:24-slim AS frontend
# Version stamped into the UI footer (pass --build-arg APP_VERSION=x.y.z).
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
WORKDIR /build
# Install deps first (cached unless package manifests change).
COPY gui/frontend/package.json gui/frontend/package-lock.json ./
RUN npm ci
# Build the SPA -> /build/dist (Vite outputs to <root>/dist).
COPY gui/frontend/ ./
RUN npm run build

# --- Stage 2: Python runtime that serves API + the built dist ---------------
# The deployment target is deliberately Linux x86_64 (see docker-compose.yml).
FROM python:3.11.15-slim-bookworm AS runtime

# Keep the resolver version identical to pyproject.toml and CI. Dependencies
# are still installed from the checked-in lock; uv is only the installer here.
COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /uvx /bin/

# Version reported by /api/v1/version and /api/v1/health.
ARG APP_VERSION=dev

# Headless matplotlib (the reliability library imports pyplot); no bytecode
# files, unbuffered logs.
ENV MPLBACKEND=Agg \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WEB_CONCURRENCY=4 \
    PERDURA_VERSION=$APP_VERSION \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Install the library and application dependencies atomically from the exact
# universal lock. --no-build + --no-cache verifies that every third-party
# dependency is available as a wheel for the declared container target.
COPY pyproject.toml uv.lock ./
COPY src/ src/
# pip/setuptools/wheel are inherited build tools, not runtime dependencies.
# Removing them reduces the final attack surface and prevents stale vendored
# packages in the base image from being mistaken for application packages.
RUN uv sync --locked --python 3.11.15 --extra app --no-dev \
        --no-install-project --no-build --no-cache \
    && uv sync --locked --python 3.11.15 --extra app --no-dev --no-cache \
    && /usr/local/bin/python -m pip uninstall --yes pip setuptools wheel

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
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status==200 else 1)"

# Multiple workers = real parallelism across requests (the per-process
# Telcordia reference caches are read-only and safe). No --reload in prod.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-4}"]
