"""Tests for app identity, API version surfaces, and stale-bytecode resistance."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import main


def test_version_endpoint_returns_app_version():
    assert main.version() == {
        "version": main.APP_VERSION,
        "commit": main.APP_COMMIT,
        "built_at": main.BUILD_TIMESTAMP,
        "api_contract": main.API_CONTRACT_VERSION,
        "minimum_client_api_contract": main.MINIMUM_CLIENT_API_CONTRACT,
        "maximum_client_api_contract": main.MAXIMUM_CLIENT_API_CONTRACT,
        "project_schema": main.PROJECT_SCHEMA_VERSION,
        "verification_report_sha256": main.BUILD_VERIFICATION_REPORT_SHA256,
        "verification_run_url": main.BUILD_VERIFICATION_RUN_URL,
        "runtime_executable_sha256": None,
    }
    assert isinstance(main.APP_VERSION, str) and main.APP_VERSION


def test_health_includes_version():
    h = main.health()
    assert h["status"] == "ok"
    assert h["version"] == main.APP_VERSION
    assert h["commit"] == main.APP_COMMIT
    assert h["built_at"] == main.BUILD_TIMESTAMP
    assert h["api_contract"] == main.API_CONTRACT_VERSION
    assert h["minimum_client_api_contract"] == main.MINIMUM_CLIENT_API_CONTRACT
    assert h["maximum_client_api_contract"] == main.MAXIMUM_CLIENT_API_CONTRACT
    assert h["project_schema"] == main.PROJECT_SCHEMA_VERSION
    assert h["verification_report_sha256"] == main.BUILD_VERIFICATION_REPORT_SHA256


def test_env_override_takes_precedence(monkeypatch):
    monkeypatch.setenv("PERDURA_VERSION", "9.9.9")
    assert main._app_version() == "9.9.9"


def test_falls_back_to_library_version(monkeypatch):
    monkeypatch.delenv("PERDURA_VERSION", raising=False)
    # With no env override, falls back to reliability.__version__ (stamped at
    # release) or 'dev' — never empty.
    v = main._app_version()
    assert isinstance(v, str) and v


def test_runtime_version_reads_the_release_declaration_not_stale_bytecode(
        monkeypatch):
    """A same-size, same-second bump must not reproduce the 0.3.2 server bug."""
    import reliability
    from reliability import _version as version_module

    version_source = Path(reliability.__file__).with_name("_version.py")
    declared = version_source.read_text(encoding="utf-8").split('"')[1]
    monkeypatch.delenv("PERDURA_VERSION", raising=False)
    assert reliability._runtime_version() == declared
    assert version_module.__version__ == declared
    assert main._app_version() == declared
