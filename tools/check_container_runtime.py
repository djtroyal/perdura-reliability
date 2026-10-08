#!/usr/bin/env python3
"""Exercise the built production image, including its final non-root user."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import subprocess
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


NATIVE_PROBE = """
import importlib, json, os, platform, sys
assert os.getuid() == 10001, os.getuid()
assert sys.version_info[:3] == (3, 13, 14), sys.version
versions = {}
for name in ('numpy', 'scipy', 'onnxruntime'):
    versions[name] = importlib.import_module(name).__version__
print(json.dumps({'uid': os.getuid(), 'python': platform.python_version(),
                  'architecture': platform.machine(), 'native_imports': versions}))
"""


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ['docker', *args], check=check, capture_output=True, text=True, timeout=180,
    )


def request(base: str, path: str, payload: dict | None = None) -> tuple[dict, bytes]:
    headers = {'X-Perdura-Client-API-Contract': '1'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(base + path, headers=headers,
                  data=None if payload is None else json.dumps(payload).encode())
    with urlopen(req, timeout=20) as response:
        assert response.status == 200, response.status
        return dict(response.headers), response.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--target', choices=['linux-amd64', 'linux-arm64'], required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {'image': args.image, 'target': args.target, 'status': 'failed'}
    cid = None
    try:
        probe = json.loads(docker('run', '--rm', '--entrypoint', '/app/.venv/bin/python',
                                  args.image, '-c', NATIVE_PROBE).stdout)
        expected_arch = 'x86_64' if args.target == 'linux-amd64' else 'aarch64'
        assert probe['architecture'] == expected_arch, probe
        report['runtime'] = probe
        inventory = docker('run', '--rm', '--entrypoint', 'dpkg-query', args.image,
                           '-W', '-f=${Package}\t${Version}\n').stdout
        (args.output_dir / 'installed-debian-packages.tsv').write_text(inventory)
        report['image_inspect'] = json.loads(docker('image', 'inspect', args.image).stdout)
        cid = docker('run', '--rm', '-d', '-p', '127.0.0.1::8000',
                     '-e', 'WEB_CONCURRENCY=1', args.image).stdout.strip()
        port = docker('port', cid, '8000/tcp').stdout.strip().rsplit(':', 1)[1]
        base = f'http://127.0.0.1:{port}'
        deadline = time.monotonic() + 120
        while True:
            try:
                headers, body = request(base, '/api/v1/health')
                assert json.loads(body)['status'] == 'ok'
                report['health'] = json.loads(body)
                break
            except (URLError, ConnectionError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(1)
        headers, body = request(base, '/')
        assert any(k.lower() == 'content-type' and 'text/html' in v for k, v in headers.items())
        assert b'<html' in body.lower(), 'The container did not serve the built application.'
        _, body = request(base, '/api/v1/descriptive/summary',
                          {'columns': {'measurement': [1, 2, 3, 4]}})
        result = json.loads(body)['measurement']
        assert result['n'] == 4, result
        assert math.isclose(result['mean'], 2.5, rel_tol=0, abs_tol=1e-12), result
        report['calculation'] = result
        report['status'] = 'passed'
        return 0
    finally:
        if cid:
            logs = docker('logs', cid, check=False)
            (args.output_dir / 'server.log').write_text(logs.stdout + logs.stderr)
            docker('stop', cid, check=False)
        (args.output_dir / 'runtime.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
