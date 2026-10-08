"""Give the isolated API scan a valid client identity and retain failure evidence.

These are packaged-scan hooks, not application or production configuration.
No vulnerability rule is disabled. Non-API pages remain covered separately by
the browser/passive scan, including the intentionally HTML documentation UI.
"""

import json
from pathlib import Path
import re


API_ROOT = 'http://127.0.0.1:8000/api/v1'
API_PATTERN = r'http://127\.0\.0\.1:8000/api/v1(?:[/?].*)?'
OUTSIDE_API = re.compile(r'^(?!http://127\.0\.0\.1:8000/api/v1(?:[/?]|$)).*')
HTML_DOCS = re.compile(r'^http://127\.0\.0\.1:8000/api/v1/(?:docs|redoc)(?:[/?].*)?$')
_zap = None


def zap_started(zap, target):
    global _zap
    if target != API_ROOT + '/openapi.json':
        raise ValueError('This assurance profile only scans the isolated localhost API.')
    _zap = zap
    result = zap.replacer.add_rule(
        description='Perdura API contract', enabled='true',
        matchtype='REQ_HEADER', matchregex='false',
        matchstring='X-Perdura-Client-API-Contract', replacement='1',
        url=API_PATTERN,
    )
    if result != 'OK':
        raise RuntimeError(f'Unable to configure the API contract header: {result}')


def zap_get_alerts(zap, baseurl, ignore_scan_rules, out_of_scope_dict):
    # The packaged collector passes baseurl only on its first page. Request
    # the same unfiltered alert collection on every page, then filter every
    # alert against the API context so offsets cannot duplicate API findings.
    # No API finding is ignored merely because its rule is noisy.
    out_of_scope_dict.setdefault('*', []).extend([OUTSIDE_API, HTML_DOCS])
    return zap, '', ignore_scan_rules, out_of_scope_dict


def zap_get_alerts_wrap(alerts):
    evidence = []
    for rule, findings in alerts.items():
        for finding in findings[:10]:
            entry = {'rule': rule, 'alert': finding}
            if finding.get('messageId'):
                entry['http_message'] = _zap.core.message(finding['messageId'])
            evidence.append(entry)
    destination = Path('/zap/wrk/evidence/dynamic/zap-api-messages.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    return alerts
