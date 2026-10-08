import importlib.util
import json
import os
from pathlib import Path
import re
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock
import xml.etree.ElementTree as ET

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('zap_api_hooks', ROOT / 'assurance/zap_api_hooks.py')
HOOKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOOKS)


@pytest.fixture(autouse=True)
def isolated_hook_evidence(monkeypatch, tmp_path):
    monkeypatch.setattr(HOOKS, 'EVIDENCE_DIR', tmp_path)
    monkeypatch.setattr(HOOKS, '_zap', None)
    monkeypatch.setattr(HOOKS, '_context_ready', False)


def configured_zap():
    return SimpleNamespace(
        replacer=SimpleNamespace(add_rule=Mock(return_value='OK')),
        context=SimpleNamespace(
            context=Mock(return_value={'name': HOOKS.CONTEXT_NAME, 'inScope': 'true'}),
            include_regexs=Mock(return_value=[HOOKS.API_PATTERN]),
            exclude_regexs=Mock(return_value=[HOOKS.CONTEXT_EXCLUDE]),
        ),
    )


def test_upstream_module_loader_does_not_require_file_attribute():
    # The packaged scanner uses this loader shape, rather than module_from_spec.
    module = ModuleType(SPEC.loader.name)
    SPEC.loader.exec_module(module)
    assert module.EVIDENCE_DIR == Path('/zap/wrk/evidence/dynamic/zap-api')


@pytest.mark.parametrize('url,in_scope', [
    ('http://127.0.0.1:8000/api/v1/alt/test-simulation', True),
    ('http://127.0.0.1:8000/api/v1/unknown?probe=1', True),
    ('http://127.0.0.1:8000/api/v1/openapi.json', True),
    ('http://127.0.0.1:8000/', False),
    ('http://127.0.0.1:8000/api/v10/health', False),
    ('http://127.0.0.1:8000/api/v1/docs', False),
    ('http://127.0.0.1:8000/api/v1/redoc?x=1', False),
    ('https://production.example/api/v1/health', False),
])
def test_context_only_includes_local_api_and_preserves_unknown_routes(url, in_scope):
    context = ET.parse(ROOT / 'assurance/zap-api.context').find('context')
    includes = [re.compile(item.text) for item in context.findall('incregexes')]
    excludes = [re.compile(item.text) for item in context.findall('excregexes')]
    assert (any(p.fullmatch(url) for p in includes)
            and not any(p.fullmatch(url) for p in excludes)) is in_scope


def test_scan_sends_contract_header_and_rejects_failed_setup():
    zap = configured_zap()
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    args = zap.replacer.add_rule.call_args.kwargs
    assert args['matchstring'] == 'X-Perdura-Client-API-Contract'
    assert args['replacement'] == '1'
    assert re.fullmatch(args['url'], HOOKS.API_ROOT + '/alt/test-simulation')
    assert not re.fullmatch(args['url'], 'https://production.example/api/v1/health')
    zap.replacer.add_rule.return_value = 'FAIL'
    with pytest.raises(RuntimeError):
        HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    with pytest.raises(ValueError):
        HOOKS.zap_started(zap, 'https://production.example/api/v1/openapi.json')


def test_context_preflight_proves_live_scope_and_retains_startup_evidence():
    zap = configured_zap()
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    with pytest.raises(RuntimeError, match='preflight did not complete'):
        HOOKS.importing_openapi(HOOKS.API_ROOT + '/openapi.json', None)
    assert HOOKS.zap_import_context_wrap('1') == '1'
    zap.context.context.assert_called_once_with(HOOKS.CONTEXT_NAME)
    zap.context.include_regexs.assert_called_once_with(HOOKS.CONTEXT_NAME)
    zap.context.exclude_regexs.assert_called_once_with(HOOKS.CONTEXT_NAME)
    HOOKS.importing_openapi(HOOKS.API_ROOT + '/openapi.json', None)
    evidence = json.loads((HOOKS.EVIDENCE_DIR / 'preflight.json').read_text())
    assert evidence == {
        'evidence_writable': True, 'context_ready': True,
        'context_id': '1', 'phase': 'before_api_import',
    }
    # A subsequent invocation must not inherit the preceding scan's success.
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    with pytest.raises(RuntimeError, match='preflight did not complete'):
        HOOKS.importing_openapi(HOOKS.API_ROOT + '/openapi.json', None)


@pytest.mark.parametrize('context_id', [None, 'internal_error', '', False])
def test_failed_context_import_stops_before_api_import(context_id):
    zap = configured_zap()
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    with pytest.raises(RuntimeError, match='Unable to import'):
        HOOKS.zap_import_context_wrap(context_id)
    zap.context.context.assert_not_called()
    assert not HOOKS._context_ready


@pytest.mark.parametrize('field,value', [
    ('name', 'unexpected context'), ('inScope', 'false'),
    ('include_regexs', ['.*']), ('exclude_regexs', ['.*']),
])
def test_unexpected_live_context_scope_fails_before_api_import(field, value):
    zap = configured_zap()
    if field in {'include_regexs', 'exclude_regexs'}:
        getattr(zap.context, field).return_value = value
    else:
        zap.context.context.return_value[field] = value
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    with pytest.raises(RuntimeError, match='unexpected scope'):
        HOOKS.zap_import_context_wrap('1')
    assert not HOOKS._context_ready


def test_missing_output_leaf_fails_before_scanner_configuration(monkeypatch, tmp_path):
    monkeypatch.setattr(HOOKS, 'EVIDENCE_DIR', tmp_path / 'not-prepared')
    zap = configured_zap()
    with pytest.raises(FileNotFoundError):
        HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    zap.replacer.add_rule.assert_not_called()


@pytest.mark.skipif(os.name != 'posix' or getattr(os, 'geteuid', lambda: 0)() == 0,
                    reason='Requires an unprivileged POSIX user for real chmod denial.')
def test_unwritable_output_fails_before_scanner_configuration(tmp_path):
    # Exercise an actual filesystem denial, not only a mocked path operation.
    tmp_path.chmod(0o555)
    zap = configured_zap()
    try:
        with pytest.raises(PermissionError):
            HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    finally:
        tmp_path.chmod(0o755)
    zap.replacer.add_rule.assert_not_called()


def test_alert_evidence_is_written_to_the_preflighted_output_leaf():
    zap = configured_zap()
    zap.core = SimpleNamespace(message=Mock(return_value={'responseHeader': 'HTTP/1.1 500'}))
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    alerts = {'500': [{'messageId': '7', 'url': HOOKS.API_ROOT + '/unknown'}]}
    assert HOOKS.zap_get_alerts_wrap(alerts) is alerts
    retained = json.loads((HOOKS.EVIDENCE_DIR / 'messages.json').read_text())
    assert retained == [{
        'rule': '500', 'alert': alerts['500'][0],
        'http_message': {'responseHeader': 'HTTP/1.1 500'},
    }]
    zap.core.message.assert_called_once_with('7')


def test_active_scan_restores_api_subtree_and_preserves_scanner_and_policy():
    zap = configured_zap()
    with pytest.raises(RuntimeError, match='preflight did not complete'):
        HOOKS.zap_active_scan(zap, 'http://127.0.0.1:8000/', 'Default Policy')
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    HOOKS.zap_import_context_wrap('1')
    assert HOOKS.zap_active_scan(zap, 'http://127.0.0.1:8000/', 'Default Policy') == (
        zap, HOOKS.API_ROOT, 'Default Policy',
    )


@pytest.mark.parametrize('target', [
    'https://production.example/', 'http://localhost:8000/',
    'http://127.0.0.1:9000/', 'http://127.0.0.1:8000/other',
])
def test_active_scan_rejects_unexpected_normalized_targets(target):
    zap = configured_zap()
    HOOKS.zap_started(zap, HOOKS.API_ROOT + '/openapi.json')
    HOOKS.zap_import_context_wrap('1')
    with pytest.raises(ValueError, match='Unexpected normalized API scan target'):
        HOOKS.zap_active_scan(zap, target, 'Default Policy')


def test_reporting_scope_keeps_all_api_findings_and_existing_rule_policy():
    ignored = ['existing-policy']
    scopes = {'10049': [re.compile('existing-exception')]}
    _, base, actual_ignored, actual_scopes = HOOKS.zap_get_alerts(None, '', ignored, scopes)
    # Upstream omits baseurl on pages after the first: an empty first-page
    # filter keeps offsets relative to one consistent alert collection.
    assert base == ''
    assert actual_ignored is ignored
    assert actual_scopes['10049'][0].pattern == 'existing-exception'
    for route in ['/unknown', '/alt/test-simulation', '/descriptive/summary']:
        assert not any(pattern.match(HOOKS.API_ROOT + route) for pattern in actual_scopes['*'])
    assert any(pattern.match('http://127.0.0.1:8000/') for pattern in actual_scopes['*'])


@pytest.mark.parametrize('url', [
    'http://localhost:8000/api/v1/health',
    'http://127.0.0.1:9000/api/v1/health',
    'http://127.0.0.1:8000/api/v10/health',
    'https://production.example/api/v1/health',
    'http://127.0.0.1:8000/api/v1/docs?probe=1',
])
def test_every_page_excludes_findings_outside_the_exact_api_origin(url):
    _, _, _, scopes = HOOKS.zap_get_alerts(None, '', [], {})
    assert any(pattern.match(url) for pattern in scopes['*'])


def test_packaged_collector_pagination_reports_each_api_finding_once():
    # zap_common requests baseurl on page one and omits it on subsequent
    # pages. Different first/subsequent collections duplicate findings.
    alerts = ([{'url': f'https://other.example/{i}'} for i in range(5000)]
              + [{'url': HOOKS.API_ROOT + f'/unknown?probe={i}'} for i in range(5001)])
    _, base, _, scopes = HOOKS.zap_get_alerts(None, HOOKS.API_ROOT, [], {})
    first_collection = [alert for alert in alerts if alert['url'].startswith(base)]
    page = first_collection[:5000]
    collected = []
    offset = 0
    while page:
        collected.extend(alert['url'] for alert in page
                         if not any(pattern.match(alert['url']) for pattern in scopes['*']))
        offset += 5000
        page = alerts[offset:offset + 5000]
    assert len(collected) == len(set(collected)) == 5001
