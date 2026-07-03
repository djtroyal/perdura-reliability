"""Tests for the app version surface (/api/version, /api/health, and the
PERDURA_VERSION env override)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import main


def test_version_endpoint_returns_app_version():
    assert main.version() == {"version": main.APP_VERSION}
    assert isinstance(main.APP_VERSION, str) and main.APP_VERSION


def test_health_includes_version():
    h = main.health()
    assert h["status"] == "ok"
    assert h["version"] == main.APP_VERSION


def test_env_override_takes_precedence(monkeypatch):
    monkeypatch.setenv("PERDURA_VERSION", "9.9.9")
    assert main._app_version() == "9.9.9"


def test_falls_back_to_library_version(monkeypatch):
    monkeypatch.delenv("PERDURA_VERSION", raising=False)
    # With no env override, falls back to reliability.__version__ (stamped at
    # release) or 'dev' — never empty.
    v = main._app_version()
    assert isinstance(v, str) and v
