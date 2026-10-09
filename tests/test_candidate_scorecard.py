import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile

import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def runner():
    spec = importlib.util.spec_from_file_location('candidate_scorecard', ROOT / 'tools/run_candidate_scorecard.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_verified_archive_extracts_only_executable_and_rejects_tampering(runner, tmp_path, monkeypatch):
    archive = tmp_path / 'release.tar.gz'
    with tarfile.open(archive, 'w:gz') as package:
        for name in ('scorecard', '../escape'):
            member = tarfile.TarInfo(name)
            member.size = 4
            package.addfile(member, io.BytesIO(b'test'))
    monkeypatch.setattr(runner, 'ARCHIVE_SHA256', hashlib.sha256(archive.read_bytes()).hexdigest())
    destination = tmp_path / 'bin'
    destination.mkdir()
    binary = runner.install_verified_archive(archive, destination)
    assert binary.read_bytes() == b'test'
    assert binary.stat().st_mode & 0o111 == 0o111
    assert not (tmp_path / 'escape').exists()
    archive.write_bytes(archive.read_bytes() + b'tampered')
    with pytest.raises(ValueError, match='SHA256 mismatch'):
        runner.install_verified_archive(archive, destination)


def test_pinned_action_policy_is_byte_identical(runner):
    assert hashlib.sha256((ROOT / 'assurance/scorecard-policy.yml').read_bytes()).hexdigest() == runner.POLICY_SHA256


@pytest.mark.parametrize('failure', [None, 'process', 'malformed'])
def test_both_scopes_and_formats_are_required_without_spoofing_events(runner, monkeypatch, tmp_path, failure):
    calls = []
    monkeypatch.setenv('GITHUB_EVENT_NAME', 'workflow_dispatch')
    monkeypatch.setenv('GITHUB_REF', 'refs/heads/candidate')
    monkeypatch.setattr(runner.subprocess, 'check_output', lambda *args, **kwargs: 'candidate-sha\n')
    def run(command, **kwargs):
        calls.append(command)
        assert kwargs['check'] is True
        assert kwargs['env']['GITHUB_EVENT_NAME'] == 'workflow_dispatch'
        assert kwargs['env']['GITHUB_REF'] == 'refs/heads/candidate'
        assert kwargs['env']['ENABLE_SARIF'] == 'true'
        output = Path(next(item.split('=', 1)[1] for item in command if item.startswith('--output=')))
        if len(calls) == 1 and failure == 'process':
            raise subprocess.CalledProcessError(1, command)
        if len(calls) == 1 and failure == 'malformed':
            output.write_text('{"checks":[]}')
        else:
            data = {'checks': [{'name': 'Pinned-Dependencies', 'score': 10}]} if '--format=json' in command else {'version': '2.1.0', 'runs': [{'tool': {'driver': {'name': 'Scorecard'}}, 'automationDetails': {'id': 'supply-chain/local/engine-timestamp'}}]}
            output.write_text(json.dumps(data))
    monkeypatch.setattr(runner.subprocess, 'run', run)
    output = tmp_path / 'evidence'
    assert runner.generate_reports(Path('/verified/scorecard'), tmp_path, 'owner/repo', output,
                                   ROOT / 'assurance/scorecard-policy.yml') == (1 if failure else 0)
    assert len(calls) == 4
    assert all(f'--local={tmp_path}' in command for command in calls[:2])
    assert all('--repo=github.com/owner/repo' in command for command in calls[2:])
    assert all(any(item.startswith('--policy=') for item in command) for command in (calls[1], calls[3]))
    evidence = json.loads((output / 'scopes.json').read_text())
    assert evidence['status'] == ('failed' if failure else 'passed')
    assert evidence['candidate_commit'] == 'candidate-sha'
    assert set(evidence['scopes']) == {'candidate-local', 'repository-default'}
    assert len(evidence['reports']) == 4


def test_changed_policy_is_rejected_before_generation(runner, monkeypatch, tmp_path):
    policy = tmp_path / 'policy.yml'
    policy.write_text('policies: {}')
    with pytest.raises(ValueError, match='policy differs'):
        runner.generate_reports(Path('/scorecard'), tmp_path, 'owner/repo', tmp_path / 'out', policy)


def test_upload_scopes_do_not_collide_and_preserve_raw_multirun_evidence(runner, tmp_path):
    categories = set()
    for scope, groups in [('candidate-local', ['local']),
                          ('repository-default', ['branch-protection', 'local', 'online-scm'])]:
        raw = tmp_path / f'{scope}.sarif'
        data = {'version': '2.1.0', 'runs': [
            {'tool': {'driver': {'name': 'Scorecard'}},
             'automationDetails': {'id': f'supply-chain/{group}/engine-08 Oct 26 22:00 +0000'},
             'results': [{'ruleId': group, 'level': 'warning', 'message': {'text': 'Original finding'}}]}
            for group in groups
        ]}
        original = json.dumps(data).encode()
        raw.write_bytes(original)
        upload = runner.prepare_sarif_upload(raw, scope)
        assert upload == tmp_path / 'upload' / raw.name
        assert raw.read_bytes() == original
        actual = json.loads(upload.read_text())
        for before, after, group in zip(data['runs'], actual['runs'], groups):
            identifier = after['automationDetails']['id']
            assert identifier == f'perdura/scorecard/{scope}/supply-chain/{group}/'
            category = identifier.rsplit('/', 1)[0]
            assert category not in categories
            categories.add(category)
            after['automationDetails']['id'] = before['automationDetails']['id']
            assert after == before
    assert len(categories) == 4


@pytest.mark.parametrize('identifiers', [[], ['unknown'], ['supply-chain/local/one', 'supply-chain/local/two']])
def test_unrecognized_or_duplicate_sarif_groups_cannot_be_uploaded(runner, tmp_path, identifiers):
    raw = tmp_path / 'candidate-local.sarif'
    runs = [{'automationDetails': {'id': identifier}} for identifier in identifiers] or [{}]
    raw.write_text(json.dumps({'runs': runs}))
    with pytest.raises(ValueError):
        runner.prepare_sarif_upload(raw, 'candidate-local')
