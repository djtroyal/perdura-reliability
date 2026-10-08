import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def smoke(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('container_runtime', ROOT / 'tools/check_container_runtime.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(sys, 'argv', ['check_container_runtime.py', '--image', 'candidate',
                                    '--target', 'linux-amd64', '--output-dir', str(tmp_path)])
    return module


def fake_docker(smoke, monkeypatch, *, failed_start=False, failed_logs=False):
    calls = []
    def run(*args, check=True):
        calls.append(args)
        if args[0] == 'run' and args[3] == '/app/.venv/bin/python':
            output = json.dumps({'architecture': 'x86_64', 'uid': 10001, 'python': '3.13.14'})
        elif args[0] == 'image':
            output = '[{"Id":"sha256:candidate"}]'
        elif args[0] == 'create':
            output = 'container-id\n'
        elif args[0] == 'start' and failed_start:
            raise subprocess.CalledProcessError(1, args, stderr='entrypoint failed')
        elif args[0] == 'port':
            output = '127.0.0.1:49152\n'
        elif args[0] == 'logs':
            if failed_logs:
                raise subprocess.TimeoutExpired(args, 180)
            output = 'startup diagnostics\n'
        else:
            output = ''
        return subprocess.CompletedProcess(args, 0, stdout=output, stderr='')
    monkeypatch.setattr(smoke, 'docker', run)
    return calls


def test_failed_start_keeps_container_until_logs_and_report_are_saved(smoke, monkeypatch, tmp_path):
    calls = fake_docker(smoke, monkeypatch, failed_start=True)
    with pytest.raises(subprocess.CalledProcessError, match='start'):
        smoke.main()
    assert ('logs', 'container-id') in calls
    assert calls[-1] == ('rm', '--force', 'container-id')
    assert (tmp_path / 'server.log').read_text() == 'startup diagnostics\n'
    assert json.loads((tmp_path / 'runtime.json').read_text())['status'] == 'failed'
    assert '--rm' not in next(call for call in calls if call[0] == 'create')


def test_health_timeout_retries_and_diagnostic_failure_does_not_mask_result(smoke, monkeypatch, tmp_path):
    calls = fake_docker(smoke, monkeypatch, failed_logs=True)
    requests = []
    def request(base, path, payload=None):
        assert base == 'http://127.0.0.1:49152'
        requests.append(path)
        if len(requests) == 1:
            raise TimeoutError('server not ready')
        if path.endswith('/health'):
            return {}, b'{"status":"ok"}'
        if path == '/':
            return {'Content-Type': 'text/html'}, b'<html>Perdura</html>'
        assert payload == {'columns': {'measurement': [1, 2, 3, 4]}}
        return {}, b'{"measurement":{"n":4,"mean":2.5}}'
    monkeypatch.setattr(smoke, 'request', request)
    sleeps = []
    monkeypatch.setattr(smoke.time, 'sleep', sleeps.append)
    assert smoke.main() == 0
    assert sleeps == [1]
    assert calls[-1] == ('rm', '--force', 'container-id')
    report = json.loads((tmp_path / 'runtime.json').read_text())
    assert report['status'] == 'passed'
    assert report['calculation'] == {'n': 4, 'mean': 2.5}
    assert report['cleanup_errors'][0].startswith('logs: ')
