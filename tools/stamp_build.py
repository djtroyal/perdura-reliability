#!/usr/bin/env python3
"""Stamp immutable build diagnostics into the packaged Python application."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--timestamp")
    parser.add_argument("--verification-report-sha256", default="")
    parser.add_argument("--verification-run-url", default="")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-fA-F]{7,64}", args.commit):
        raise ValueError("Commit must be a 7-64 character hexadecimal identifier")
    timestamp = args.timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    # Validate early so a malformed CI value cannot enter release diagnostics.
    datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if args.verification_report_sha256 and not re.fullmatch(
            r"[0-9a-fA-F]{64}", args.verification_report_sha256):
        raise ValueError("Verification report SHA-256 must be a 64-character hexadecimal digest")
    target = ROOT / "src/reliability/_build.py"
    target.write_text(
        '"""Build diagnostics generated during release packaging."""\n\n'
        f'BUILD_COMMIT = "{args.commit.lower()}"\n'
        f'BUILD_TIMESTAMP = "{timestamp}"\n'
        f'BUILD_VERIFICATION_REPORT_SHA256 = "{args.verification_report_sha256.lower()}"\n'
        f'BUILD_VERIFICATION_RUN_URL = {args.verification_run_url!r}\n'
        'PROJECT_SCHEMA_VERSION = 4\n',
        encoding="utf-8",
    )
    print(f"Stamped build {args.commit[:12]} at {timestamp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
