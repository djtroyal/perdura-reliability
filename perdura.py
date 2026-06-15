#!/usr/bin/env python3
"""Perdura – Reliability Engineering Suite launcher.

When frozen by PyInstaller this is the single entry-point executable.
It starts the FastAPI/Uvicorn server and opens the user's default browser.
"""

import os
import sys
import socket
import subprocess
import threading
import time
import webbrowser

# When running from the PyInstaller bundle, make sure the library and
# backend packages are importable.
if getattr(sys, "frozen", False):
    _meipass = sys._MEIPASS  # type: ignore[attr-defined]
    sys.path.insert(0, os.path.join(_meipass, "gui", "backend"))
    sys.path.insert(0, os.path.join(_meipass, "src"))
else:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "gui", "backend"))
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))


def _find_free_port(preferred: int = 8000) -> int:
    """Use the preferred port if available, otherwise let the OS pick."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


def _system_env() -> dict:
    """A copy of the environment with PyInstaller's library-path overrides
    undone, suitable for launching *system* programs (e.g. the browser opener).

    A frozen bundle sets LD_LIBRARY_PATH / DYLD_LIBRARY_PATH to its own lib
    directory so it loads its bundled shared libraries. If a system binary such
    as xdg-open / /bin/sh inherits that, it tries to load our incompatible
    bundled libs and crashes ("undefined symbol: rl_print_keybinding").
    PyInstaller stashes the original value in <VAR>_ORIG; restore it here for
    the child only — the parent process keeps the bundle paths so lazily loaded
    scipy/sklearn C-extensions still resolve.
    """
    env = dict(os.environ)
    for var in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "LD_PRELOAD"):
        orig = env.pop(var + "_ORIG", None)
        if orig is not None:
            env[var] = orig
        else:
            env.pop(var, None)
    return env


def _open_url(url: str) -> None:
    """Open *url* in the default browser using a de-poisoned environment."""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", url], env=_system_env())
        elif sys.platform.startswith("win"):
            os.startfile(url)  # noqa: S606 — Windows is unaffected by LD_* vars
        else:
            subprocess.Popen(["xdg-open", url], env=_system_env())
    except Exception:
        # Last-ditch fallback; may emit the LD_* warning but is harmless.
        webbrowser.open(url)


def _open_browser(port: int) -> None:
    """Wait for the server to accept connections, then open the browser."""
    for _ in range(50):  # up to ~5 s
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.1)
    _open_url(f"http://localhost:{port}")


def main() -> None:
    import uvicorn

    port = _find_free_port()
    threading.Thread(target=_open_browser, args=(port,), daemon=True).start()

    print(f"\n  Perdura is running at  http://localhost:{port}\n")
    print("  Close this window (or press Ctrl+C) to stop.\n")

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
