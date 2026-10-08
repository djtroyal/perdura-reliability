import importlib.util
from pathlib import Path
import re
from types import SimpleNamespace
from unittest.mock import Mock
import xml.etree.ElementTree as ET

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('zap_api_hooks', ROOT / 'assurance/zap_api_hooks.py')
HOOKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOOKS)


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
    zap = SimpleNamespace(replacer=SimpleNamespace(add_rule=Mock(return_value='OK')))
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


def test_reporting_scope_keeps_all_api_findings_and_existing_rule_policy():
    ignored = ['existing-policy']
    scopes = {'10049': [re.compile('existing-exception')]}
    _, base, actual_ignored, actual_scopes = HOOKS.zap_get_alerts(None, '', ignored, scopes)
    assert base == HOOKS.API_ROOT
    assert actual_ignored is ignored
    assert actual_scopes['10049'][0].pattern == 'existing-exception'
    for route in ['/unknown', '/alt/test-simulation', '/descriptive/summary']:
        assert not any(pattern.match(HOOKS.API_ROOT + route) for pattern in actual_scopes['*'])
    assert any(pattern.match('http://127.0.0.1:8000/') for pattern in actual_scopes['*'])
