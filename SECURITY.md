# Security Policy

## Supported versions

Only the **latest release** of Perdura receives security fixes. If you are
running an older build, please update to the newest release before reporting.

| Version | Supported |
| ------- | --------- |
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Instead, use one of these private channels:

1. **GitHub private vulnerability reporting** (preferred):
   [Security → Report a vulnerability](https://github.com/djtroyal/reliability/security/advisories/new)
2. **Email**: djtroyal@gmail.com — include steps to reproduce, the affected
   version, and any relevant configuration (e.g. self-hosted deployment details).

You can expect an acknowledgement within a few days. Once a fix is available it
will ship in the next release, and the advisory will be published after users
have had a reasonable window to update.

## Scope notes

- Perdura is local-first: analysis data stays in the browser/localStorage and the
  bundled backend by default. Reports about the optional self-hosted deployment
  (Docker + reverse proxy, see `docs/DEPLOYMENT.md`) are in scope.
- Vulnerabilities in third-party dependencies are best reported upstream, but a
  heads-up here is welcome if Perdura's usage makes an issue exploitable.
