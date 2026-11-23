import importlib.util
import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('zap_baseline_hooks', ROOT / 'assurance/zap_baseline_hooks.py')
HOOKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOOKS)


@pytest.fixture
def candidate(tmp_path, monkeypatch):
    build = tmp_path / 'dist'
    (build / 'assets').mkdir(parents=True)
    (build / 'index.html').write_text('<html></html>')
    (build / 'assets' / 'lazy-123.js').write_text('window.value = "β";')
    (build / 'assets' / 'main-123.css').write_text('body { color: black; }')
    (build / 'assets' / 'unused.png').write_bytes(b'png')
    evidence = tmp_path / 'evidence'
    evidence.mkdir()
    monkeypatch.setattr(HOOKS, 'BUILD_DIR', build)
    monkeypatch.setattr(HOOKS, 'EVIDENCE_DIR', evidence)
    monkeypatch.setattr(HOOKS, '_coverage', None)
    urls = [entry['url'] for entry in HOOKS.build_targets(build)]
    def response(url, **kwargs):
        assert kwargs == {'followredirects': 'false'}
        body = (build / url.removeprefix(HOOKS.ORIGIN + '/')).read_text()
        return [{'responseHeader': 'HTTP/1.1 200 OK\r\n', 'responseBody': body}]
    return SimpleNamespace(pscan=SimpleNamespace(records_to_scan='0'),
                           core=SimpleNamespace(access_url=Mock(side_effect=response),
                                               urls=Mock(return_value=urls)))


def test_all_lazy_assets_are_scanned_and_alert_policy_is_unchanged(candidate):
    HOOKS.zap_started(candidate, HOOKS.ORIGIN)
    HOOKS.zap_tuned(candidate)
    evidence = json.loads((HOOKS.EVIDENCE_DIR / 'coverage.json').read_text())
    assert len(evidence['expected']) == len(evidence['fetched']) == 2
    assert evidence['complete'] and not evidence['passive_scan_completed']
    ignored, scopes = ['-1'], {}
    result = HOOKS.zap_get_alerts(candidate, HOOKS.ORIGIN, ignored, scopes)
    assert result == (candidate, HOOKS.ORIGIN, ignored, scopes)
    assert result[2] is ignored and result[3] is scopes
    assert json.loads((HOOKS.EVIDENCE_DIR / 'coverage.json').read_text())['passive_scan_completed']


@pytest.mark.parametrize('response', [[], {'error': 'unavailable'},
    [{'responseHeader': 'HTTP/1.1 404 Not Found', 'responseBody': ''}],
    [{'responseHeader': 'HTTP/1.1 302 Redirect', 'responseBody': ''}],
    [{'responseHeader': 'HTTP/1.1 200 OK', 'responseBody': 'stale bytes'}],
])
def test_missing_redirected_or_stale_assets_fail_closed(candidate, response):
    HOOKS.zap_started(candidate, HOOKS.ORIGIN)
    candidate.core.access_url.side_effect = None
    candidate.core.access_url.return_value = response
    with pytest.raises(RuntimeError):
        HOOKS.zap_tuned(candidate)
    evidence = json.loads((HOOKS.EVIDENCE_DIR / 'coverage.json').read_text())
    assert not evidence['complete'] and evidence['error']
    with pytest.raises(RuntimeError, match='complete asset coverage'):
        HOOKS.zap_get_alerts(candidate, '', [], {})


def test_scan_history_must_contain_every_seeded_asset(candidate):
    HOOKS.zap_started(candidate, HOOKS.ORIGIN)
    HOOKS.zap_tuned(candidate)
    candidate.core.urls.return_value = []
    with pytest.raises(RuntimeError, match='absent from ZAP history'):
        HOOKS.zap_get_alerts(candidate, '', [], {})


def test_passive_queue_timeout_cannot_be_reported_as_complete(candidate):
    HOOKS.zap_started(candidate, HOOKS.ORIGIN)
    HOOKS.zap_tuned(candidate)
    candidate.pscan.records_to_scan = '3'
    with pytest.raises(RuntimeError, match='3 records remain'):
        HOOKS.zap_get_alerts(candidate, '', [], {})
    evidence = json.loads((HOOKS.EVIDENCE_DIR / 'coverage.json').read_text())
    assert not evidence['passive_scan_completed']
    assert evidence['remaining_passive_records'] == 3


def test_invalid_target_missing_build_and_missing_evidence_leaf_stop_before_requests(candidate):
    with pytest.raises(ValueError, match='localhost'):
        HOOKS.zap_started(candidate, 'https://production.example')
    HOOKS.EVIDENCE_DIR.rmdir()
    with pytest.raises(FileNotFoundError):
        HOOKS.zap_started(candidate, HOOKS.ORIGIN)
    (HOOKS.BUILD_DIR / 'index.html').unlink()
    with pytest.raises(ValueError, match='build is missing'):
        HOOKS.zap_started(candidate, HOOKS.ORIGIN)
    candidate.core.access_url.assert_not_called()


def test_upstream_module_loader_does_not_require_file_attribute():
    module = ModuleType(SPEC.loader.name)
    SPEC.loader.exec_module(module)
    assert module.BUILD_DIR == Path('/zap/wrk/gui/frontend/dist')
