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
