"""Seed every built script/style into ZAP before its ordinary passive crawl.

Lazy-loaded chunks must not depend on which screens a time-bounded spider opens.
No alert is filtered or downgraded. A missing/mismatched response fails the scan.
"""

import hashlib
import json
from pathlib import Path
import re
from urllib.parse import quote


ORIGIN = 'http://127.0.0.1:8000'
# Packaged-scan hooks are loaded without __file__; use the action's mounted root.
BUILD_DIR = Path('/zap/wrk/gui/frontend/dist')
EVIDENCE_DIR = Path('/zap/wrk/evidence/dynamic/zap-baseline')
_coverage = None


def build_targets(build_dir):
    if not (build_dir / 'index.html').is_file():
        raise ValueError('The candidate frontend build is missing.')
    assets = sorted(path for path in (build_dir / 'assets').rglob('*')
                    if path.is_file() and path.suffix in {'.js', '.mjs', '.css'})
    if not assets or len(assets) > 1024:
        raise ValueError(f'Invalid candidate script/style inventory: {len(assets)}')
    targets = []
    for path in assets:
        if not path.resolve().is_relative_to(build_dir.resolve()):
            raise ValueError('A candidate asset escapes the build directory.')
        data = path.read_bytes()
        targets.append({'url': ORIGIN + '/' + quote(path.relative_to(build_dir).as_posix()),
                        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return targets


def _write():
    (EVIDENCE_DIR / 'coverage.json').write_text(json.dumps(_coverage, indent=2) + '\n',
                                              encoding='utf-8')


def zap_started(zap, target):
    global _coverage
    _coverage = None
    if target.rstrip('/') != ORIGIN:
        raise ValueError('This profile only scans the isolated localhost application.')
    _coverage = {'schema': 'perdura.passive-scan-coverage/v1',
                 'expected': build_targets(BUILD_DIR), 'fetched': [],
                 'complete': False, 'passive_scan_completed': False}
    # Prove the real scanner user can retain evidence before doing any work.
    _write()


def zap_tuned(zap):
    if _coverage is None:
        raise RuntimeError('The passive coverage preflight did not complete.')
    try:
        for asset in _coverage['expected']:
            messages = zap.core.access_url(asset['url'], followredirects='false')
            if not isinstance(messages, list) or len(messages) != 1:
                raise RuntimeError(f'No unambiguous response for {asset["url"]}')
            message = messages[0]
            if not re.match(r'^HTTP/\S+ 200(?:\s|$)', message.get('responseHeader', '')):
                raise RuntimeError(f'Candidate asset did not return HTTP 200: {asset["url"]}')
            body = message.get('responseBody')
            if not isinstance(body, str) or hashlib.sha256(body.encode('utf-8')).hexdigest() != asset['sha256']:
                raise RuntimeError(f'Served asset differs from the candidate build: {asset["url"]}')
            _coverage['fetched'].append(asset['url'])
        _coverage['complete'] = True
    except Exception as error:
        _coverage['error'] = str(error)
        raise
    finally:
        _write()


def zap_get_alerts(zap, baseurl, ignore_scan_rules, out_of_scope_dict):
    if _coverage is None or not _coverage['complete']:
        raise RuntimeError('Passive scan cannot pass without complete asset coverage.')
    # Upstream's wait can return after its timeout with work still queued.
    # Require actual completion before describing a coverage run as complete.
    remaining = int(zap.pscan.records_to_scan)
    _coverage['passive_scan_completed'] = False
    _coverage['remaining_passive_records'] = remaining
    _write()
    if remaining != 0:
        raise RuntimeError(f'Passive scanning is incomplete: {remaining} records remain.')
    visited = set(zap.core.urls(baseurl=ORIGIN))
    missing = set(_coverage['fetched']) - visited
    if missing:
        raise RuntimeError(f'Candidate assets are absent from ZAP history: {sorted(missing)}')
    _coverage['passive_scan_completed'] = True
    _write()
    return zap, baseurl, ignore_scan_rules, out_of_scope_dict
