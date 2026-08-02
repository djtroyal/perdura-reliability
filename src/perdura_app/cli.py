"""Cross-platform command-line launcher for the local Perdura application."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections.abc import Sequence

from ._version import __version__
from .runtime import runtime_identity


def _port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        try:
            handle.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.bind(("127.0.0.1", 0))
        return int(handle.getsockname()[1])


def _system_environment() -> dict[str, str]:
    environment = dict(os.environ)
    for variable in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "LD_PRELOAD"):
        original = environment.pop(f"{variable}_ORIG", None)
        if original is None:
            environment.pop(variable, None)
        else:
            environment[variable] = original
    return environment


def _open_url(url: str) -> None:
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", url], env=_system_environment())
        elif sys.platform.startswith("win"):
            os.startfile(url)  # type: ignore[attr-defined]  # noqa: S606
        else:
            subprocess.Popen(["xdg-open", url], env=_system_environment())
    except Exception:
        webbrowser.open(url)


def _open_when_ready(port: int) -> None:
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                _open_url(f"http://127.0.0.1:{port}")
                return
        except OSError:
            time.sleep(0.1)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="perdura",
        description="Run the Perdura Reliability Engineering and Statistics Suite locally.",
    )
    parser.add_argument("--version", action="version", version=f"Perdura {__version__}")
    subcommands = parser.add_subparsers(dest="command")

    run = subcommands.add_parser("run", help="Start Perdura (the default command).")
    run.add_argument("--port", type=int, help="Loopback TCP port; the default is 8000.")
    run.add_argument("--no-browser", action="store_true", help="Do not open a browser window.")

    doctor = subcommands.add_parser("doctor", help="Show installation and dependency identity.")
    doctor.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    return parser


def _normalize_default_command(arguments: Sequence[str]) -> list[str]:
    values = list(arguments)
    if values and values[0] in {"-h", "--help", "--version"}:
        return values
    if not values or values[0].startswith("-"):
        return ["run", *values]
    return values


def _doctor(as_json: bool) -> int:
    payload = {"app": "Perdura", "version": __version__, **runtime_identity(include_packages=True)}
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 0
    print(f"Perdura {payload['version']}")
    for key in (
        "distribution_channel", "python", "python_implementation", "operating_system",
        "operating_system_release", "architecture", "installation_record_sha256",
        "runtime_environment_sha256",
    ):
        print(f"{key.replace('_', ' ').title()}: {payload.get(key) or 'not available'}")
    print(f"Installed packages: {len(payload['packages'])}")
    return 0


def _run(port: int | None, no_browser: bool) -> int:
    try:
        import uvicorn
        from perdura_app.backend.main import app
    except ModuleNotFoundError as exc:
        if exc.name in {"fastapi", "uvicorn", "pydantic"}:
            print(
                "Perdura's application dependencies are not installed. "
                "Install with: uv tool install --python 3.11.15 'perdura[app]'",
                file=sys.stderr,
            )
            return 2
        raise

    if port is not None and not 1 <= port <= 65535:
        print("--port must be between 1 and 65535.", file=sys.stderr)
        return 2
    selected_port = port if port is not None else (8000 if _port_available(8000) else _free_port())
    if port is not None and not _port_available(port):
        print(f"Port {port} is already in use.", file=sys.stderr)
        return 2

    if not no_browser:
        threading.Thread(target=_open_when_ready, args=(selected_port,), daemon=True).start()

    print(f"\n  Perdura {__version__} is running at http://127.0.0.1:{selected_port}")
    print("  Press Ctrl+C to stop.\n")
    uvicorn.run(app, host="127.0.0.1", port=selected_port, log_level="warning")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else list(argv)
    parsed = _parser().parse_args(_normalize_default_command(arguments))
    if parsed.command == "doctor":
        return _doctor(parsed.json)
    return _run(parsed.port, parsed.no_browser)


if __name__ == "__main__":
    raise SystemExit(main())
