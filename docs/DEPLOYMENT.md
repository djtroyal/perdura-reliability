# Deploying Perdura Centrally (Self-Hosted)

Host Perdura once on a server and let your team use it from their own browsers —
no per-user installs. This guide covers a container deployment behind a
TLS-terminating, authenticating reverse proxy.

## How it works

Perdura is a normal web app that is unusually simple to host:

- **One origin serves everything.** The FastAPI backend serves the built React
  UI *and* the `/api` endpoints from a single port, so users just visit one URL.
- **Host-agnostic frontend.** The UI calls the API on a relative `/api` path, so
  it works behind any hostname or reverse proxy with **no rebuild**.
- **Stateless, no database.** The backend is pure compute — request in, result
  out. It stores nothing server-side. Many users share one backend safely.
- **Your data stays in your browser.** Every project lives in your browser's
  `localStorage`; nothing is uploaded for storage. See
  [Data & backups](#data--backups).

```
                         ┌─────────────────────────────────────┐
  users' browsers  ──►   │  reverse proxy (Caddy)              │
   (HTTPS + auth)        │  · TLS termination                  │
                         │  · authentication (basic-auth/SSO)  │
                         │            │                        │
                         │            ▼                        │
                         │  app container : uvicorn :8000      │
                         │  · serves built SPA + /api          │
                         │  · stateless, no DB                 │
                         └─────────────────────────────────────┘
```

> ⚠️ **Perdura has no authentication of its own.** Exposed directly on a
> network, anyone who can reach the port gets full use of every (CPU-heavy)
> compute endpoint. The reverse proxy is **mandatory** — never publish the app
> container's port directly. See [Security](#security).

## Prerequisites

- A server with Docker and the Docker Compose plugin.
- To use real HTTPS: a domain name with a DNS record pointing at the server, and
  ports 80/443 reachable from the internet (Let's Encrypt needs port 80).

## Quick start

```bash
# 1. Get the code on the server
git clone <your-repo-url> perdura && cd perdura

# 2. Configure
cp .env.example .env
#    Edit .env: set PERDURA_DOMAIN, PERDURA_TLS_EMAIL, BASICAUTH_USER, and
#    generate BASICAUTH_HASH:
docker run --rm caddy:2 caddy hash-password --plaintext 'your-strong-password'
#    Paste the printed hash into BASICAUTH_HASH in .env.

# 3. Build and start
docker compose up -d --build

# 4. Visit https://your-domain — you'll get a login prompt, then the app.
```

`docker compose up` builds the frontend, bakes it into the Python image, starts
the app (internal only), and starts Caddy on 80/443 with automatic HTTPS.

### Local trial without a domain

Set `PERDURA_DOMAIN=localhost` in `.env` and comment out the `basicauth` block
in `deploy/Caddyfile`, then `docker compose up -d --build` and open
`https://localhost` (accept the internal-CA certificate warning).

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PERDURA_DOMAIN` | Public hostname users visit. Real domain → automatic Let's Encrypt TLS; `localhost` → Caddy internal cert. |
| `PERDURA_TLS_EMAIL` | Contact email for Let's Encrypt (real domains). |
| `BASICAUTH_USER` | Reverse-proxy login username. |
| `BASICAUTH_HASH` | Bcrypt hash from `caddy hash-password`. In compose/.env, escape any `$` as `$$`. |
| `WEB_CONCURRENCY` | Uvicorn worker processes; scale toward CPU-core count. |

## Scaling & performance

- **Workers:** raise `WEB_CONCURRENCY` toward the number of CPU cores. Each
  worker is an independent process; the app holds no shared state, so this is
  safe. (Some analyses also parallelize internally across cores.)
- **Vertical first:** the workload is CPU-bound scientific compute — more cores
  and RAM on one host go a long way.
- **Horizontal:** because there's no server state, you can run multiple `app`
  replicas behind the proxy (`docker compose up -d --scale app=3` with a
  load-balancing proxy config) if you outgrow one host.

## Data & backups

There is **no server-side database to back up** — that's by design. Each user's
projects live in *their own browser's* `localStorage`:

- Users should **Export** important projects to JSON (built into the app) and
  keep those files under their own version control (Git/SVN) or normal backups.
- Clearing site data / "forget this site" in a browser erases that browser's
  unexported projects. Communicate this to your team.
- Moving to a new machine or browser = re-import the JSON exports.

## Security

The proxy is the entire security boundary. At minimum:

1. **Never** publish the `app` container's port. The provided `docker-compose.yml`
   only `expose`s it to the proxy; keep it that way.
2. Keep authentication enabled on the proxy (basic-auth by default).
3. Terminate TLS at the proxy (automatic with a real domain).
4. Consider network-level limits too (firewall/allowlist or a VPN) if the tool
   should only be reachable internally.

### Single sign-on (optional)

To replace basic-auth with your identity provider, run an
[`oauth2-proxy`](https://oauth2-proxy.github.io/oauth2-proxy/) sidecar and switch
the `basicauth` block in `deploy/Caddyfile` to the commented `forward_auth`
example at the bottom of that file.

## Using nginx instead of Caddy

If you already run nginx, `deploy/nginx.conf` is a drop-in reverse-proxy server
block (TLS via certbot, `auth_basic` for auth, `proxy_pass` to `app:8000`). Swap
the `proxy` service's image/command accordingly, or run nginx on the host.

## Running without Docker

You don't need Docker. Install uv 0.11.29 and use the committed lock rather
than resolving packages independently on the server:

```bash
# Build the UI once
npm --prefix gui/frontend ci
npm --prefix gui/frontend run build      # -> gui/frontend/dist

# Install the exact application runtime; uv creates .venv
uv sync --locked --extra app --no-dev

# Serve UI + API on all interfaces (front it with your own proxy + auth!)
cd gui/backend
MPLBACKEND=Agg ../../.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

Then put nginx/Caddy (with TLS + auth) in front, exactly as above. A `systemd`
unit can run the `.venv/bin/python -m uvicorn` command as a managed service.
Do not run `uv lock`, `uv lock --upgrade`, or unconstrained `pip install`
commands on the deployment host; build and validate a new locked revision
instead. See [Dependency Management](DEPENDENCY_MANAGEMENT.md) for the supported
platform matrix and refresh procedure.

## Troubleshooting

- **UI shows nothing / only `/api` works:** the frontend wasn't built. Ensure
  `gui/frontend/dist/index.html` exists (the Docker build does this for you).
- **Certificate errors on a real domain:** confirm DNS points at the server and
  ports 80/443 are open; check `docker compose logs proxy`.
- **401 on every request:** that's the proxy auth working — log in with
  `BASICAUTH_USER` and the password whose hash you set.
- **Health:** `docker compose ps` shows the app's healthcheck; it probes
  `/api/health`.
