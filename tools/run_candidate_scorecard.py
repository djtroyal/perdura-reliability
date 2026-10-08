#!/usr/bin/env python3
"""Run supported Scorecard CLI assessments for a manual candidate branch.

The action rejects non-default branches outside pull_request events. The CLI
has explicit local/repository modes, so no GitHub event or ref is impersonated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
VERSION = '5.5.0'  # Same engine as scorecard-action v2.4.4.
ARCHIVE_URL = f'https://github.com/ossf/scorecard/releases/download/v{VERSION}/scorecard_{VERSION}_linux_amd64.tar.gz'
ARCHIVE_SHA256 = '83b90a05c1540ef1390db1cd5711e5fd04be9c1d8537fb84d39d02092d6a8dff'
POLICY_SHA256 = '6e75dcc0df989d333492c0e1f6e484fc5b4d26ab768333ddcd0e3788539689b0'
POLICY_SOURCE = 'https://github.com/ossf/scorecard-action/blob/2d1146689b8cda280b9bc96326124645441f03bc/policies/template.yml'


def install_verified_archive(archive: Path, destination: Path) -> Path:
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Scorecard release archive SHA256 mismatch')
    with tarfile.open(archive, 'r:gz') as package:
        member = package.getmember('scorecard')
        if not member.isfile():
            raise ValueError('Scorecard executable must be a regular archive member')
        # Extract only this verified file; never unpack paths from the archive.
        binary = destination / 'scorecard'
        with package.extractfile(member) as source, binary.open('wb') as target:
            shutil.copyfileobj(source, target)
    binary.chmod(0o755)
    return binary


def validate_report(path: Path, report_format: str) -> None:
    data = json.loads(path.read_text(encoding='utf-8'))
    if report_format == 'json':
        checks = data.get('checks') if isinstance(data, dict) else None
        if not isinstance(checks, list) or not checks or not all(
                isinstance(check, dict) and isinstance(check.get('name'), str)
                and isinstance(check.get('score'), (int, float)) for check in checks):
            raise ValueError(f'Scorecard JSON has no checks: {path}')
    else:
        runs = data.get('runs') if isinstance(data, dict) else None
        if (not isinstance(data, dict) or data.get('version') != '2.1.0'
                or not isinstance(runs, list) or not runs
                or not all(isinstance(run, dict) and isinstance(run.get('tool'), dict) for run in runs)):
            raise ValueError(f'Scorecard SARIF has no runs: {path}')


def prepare_sarif_upload(raw: Path, scope: str) -> Path:
    """Keep raw evidence intact; give each uploaded scope/check group an ID.

    Scorecard supplies automationDetails.id, which takes precedence over the
    upload action's category input. GitHub treats the portion before its last
    slash as the category, so retain a trailing slash and omit the engine/time
    suffix from this stable category. Findings and rule metadata are unchanged.
    """
    if scope not in {'candidate-local', 'repository-default'}:
        raise ValueError(f'Unsupported Scorecard upload scope: {scope}')
    data = json.loads(raw.read_text(encoding='utf-8'))
    categories = set()
    for run in data['runs']:
        automation = run.get('automationDetails', {})
        identifier = automation.get('id', '')
        match = re.fullmatch(r'supply-chain/([a-z0-9_.-]+)/[^/]+', identifier)
        if not match:
            raise ValueError(f'Unrecognized Scorecard SARIF run identity: {identifier}')
        category = f'perdura/scorecard/{scope}/supply-chain/{match[1]}/'
        if category in categories:
            raise ValueError(f'Duplicate Scorecard SARIF check group: {category}')
        categories.add(category)
        automation['id'] = category
    upload = raw.parent / 'upload' / raw.name
    upload.parent.mkdir(parents=True, exist_ok=True)
    upload.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    return upload


def generate_reports(binary: Path, candidate_root: Path, repository: str,
                     output_dir: Path, policy: Path) -> int:
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Repository must be an owner/name pair')
    if hashlib.sha256(policy.read_bytes()).hexdigest() != POLICY_SHA256:
        raise ValueError('Scorecard SARIF policy differs from the pinned action policy')
    candidate_root = candidate_root.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    provenance = {
        'schema': 'perdura.scorecard-scopes/v1', 'status': 'failed',
        'version': VERSION, 'archive_url': ARCHIVE_URL, 'archive_sha256': ARCHIVE_SHA256,
        'policy_source': POLICY_SOURCE, 'policy_sha256': POLICY_SHA256,
        'candidate_commit': subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=candidate_root, text=True).strip(),
        'workflow_event': os.environ.get('GITHUB_EVENT_NAME'),
        'workflow_ref': os.environ.get('GITHUB_REF'),
        'scopes': {
            'candidate-local': 'Checked-out candidate files; same local scope as the action on a pull request. Remote governance checks are not available in local mode.',
            'repository-default': f'github.com/{repository} default branch and repository governance; this is not candidate-branch evidence.',
        },
        'reports': [],
    }
    environment = {**os.environ, 'ENABLE_SARIF': 'true'}
    for scope, target in (
        ('candidate-local', f'--local={candidate_root}'),
        ('repository-default', f'--repo=github.com/{repository}'),
    ):
        for report_format, suffix in (('json', 'json'), ('sarif', 'sarif')):
            output = (output_dir / f'{scope}.{suffix}').resolve()
            command = [str(binary), target, '--show-details',
                       f'--format={report_format}', f'--output={output}']
            if report_format == 'sarif':
                command.append(f'--policy={policy.resolve()}')
            report = {'scope': scope, 'file': output.name, 'status': 'failed'}
            try:
                subprocess.run(command, cwd=candidate_root, env=environment, check=True, timeout=300)
                validate_report(output, report_format)
                report['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
                if report_format == 'sarif':
                    upload = prepare_sarif_upload(output, scope)
                    report['upload_file'] = str(upload.relative_to(output_dir.resolve()))
                    report['upload_sha256'] = hashlib.sha256(upload.read_bytes()).hexdigest()
                report['status'] = 'passed'
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                report['error'] = str(error)
                print(f'{scope} {report_format}: {error}', flush=True)
            provenance['reports'].append(report)
    passed = all(report['status'] == 'passed' for report in provenance['reports'])
    provenance['status'] = 'passed' if passed else 'failed'
    (output_dir / 'scopes.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    return 0 if passed else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--candidate-root', type=Path, default=ROOT)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='perdura-scorecard-') as directory:
        temporary = Path(directory)
        archive = temporary / 'scorecard.tar.gz'
        with urlopen(ARCHIVE_URL, timeout=60) as source, archive.open('wb') as target:
            shutil.copyfileobj(source, target)
        binary = install_verified_archive(archive, temporary)
        return generate_reports(binary, args.candidate_root, args.repository,
                                args.output_dir, ROOT / 'assurance/scorecard-policy.yml')


if __name__ == '__main__':
    raise SystemExit(main())
