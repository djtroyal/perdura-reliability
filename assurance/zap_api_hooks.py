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
CONTEXT_NAME = 'Perdura API'
CONTEXT_EXCLUDE = r'http://127\.0\.0\.1:8000/api/v1/(?:docs|redoc)(?:[/?].*)?'
# zap_common loads hooks into a ModuleType without defining __file__.
EVIDENCE_DIR = Path('/zap/wrk/evidence/dynamic/zap-api')
_zap = None
_context_ready = False


def zap_started(zap, target):
    global _zap, _context_ready
    if target != API_ROOT + '/openapi.json':
        raise ValueError('This assurance profile only scans the isolated localhost API.')
    _zap = zap
    _context_ready = False
    # This runs as the scanner's real container user, before importing the
    # OpenAPI document or starting the scan. The workflow prepares only this
    # output leaf for that user; never chmod the source or other evidence here.
    _write_preflight(context_ready=False)
    result = zap.replacer.add_rule(
        description='Perdura API contract', enabled='true',
        matchtype='REQ_HEADER', matchregex='false',
        matchstring='X-Perdura-Client-API-Contract', replacement='1',
        url=API_PATTERN,
    )
    if result != 'OK':
        raise RuntimeError(f'Unable to configure the API contract header: {result}')


def _write_preflight(*, context_ready, context_id=None):
    (EVIDENCE_DIR / 'preflight.json').write_text(json.dumps({
        'evidence_writable': True,
        'context_ready': context_ready,
        'context_id': context_id,
        'phase': 'before_api_import',
    }, indent=2), encoding='utf-8')


def zap_import_context_wrap(context_id):
    global _context_ready
    # zap_common logs failed imports and otherwise continues with no context.
    # Its documented return hook lets us fail before the first API import.
    if context_id is None or not str(context_id).isdigit():
        raise RuntimeError(f'Unable to import the required API scan context: {context_id}')
    context = _zap.context.context(CONTEXT_NAME)
    if (not isinstance(context, dict)
            or context.get('name') != CONTEXT_NAME
            or context.get('inScope') != 'true'
            or _zap.context.include_regexs(CONTEXT_NAME) != [API_PATTERN]
            or _zap.context.exclude_regexs(CONTEXT_NAME) != [CONTEXT_EXCLUDE]):
        raise RuntimeError(f'The imported API scan context has unexpected scope: {context}')
    _write_preflight(context_ready=True, context_id=str(context_id))
    _context_ready = True
    return context_id


def importing_openapi(target_url, target_file):
    if not _context_ready:
        raise RuntimeError('The required API context preflight did not complete.')


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
    destination = EVIDENCE_DIR / 'messages.json'
    destination.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    return alerts
