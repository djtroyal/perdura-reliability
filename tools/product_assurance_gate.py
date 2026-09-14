#!/usr/bin/env python3
"""Select assurance work and fail closed when any required job did not pass."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess


ASSURANCE_JOBS = (
    "local-controls",
    "dependency-review",
    "osv",
    "scorecard",
    "container",
    "dynamic-and-performance",
)
DOCUMENTATION_FILES = {
    "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md",
}
EVENTS = {"pull_request", "schedule", "workflow_dispatch"}


def documentation_only(paths: list[str]) -> bool:
    """Skip only an explicit documentation allowlist; unknown paths run scans."""
    def is_documentation(path: str) -> bool:
        return path in DOCUMENTATION_FILES or (
            path.startswith("docs/")
            and not path.startswith("docs/assurance/")
            and PurePosixPath(path).suffix == ".md"
        )

    return bool(paths) and all(is_documentation(path) for path in paths)


def changed_paths(base: str, head: str) -> list[str]:
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (base, head)):
        raise ValueError("The pull request base and head must be full commit SHAs.")
    # Full history is checked out by the scope job. No rename detection means
    # moving code to a documentation path still includes its original path.
    result = subprocess.run(
        ["git", "diff", "--no-renames", "--name-only", "-z", f"{base}...{head}"],
        check=True, capture_output=True, timeout=60,
    )
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def evaluate_jobs(
    needs: dict, event_name: str, same_repository: bool,
) -> tuple[bool, str]:
    if event_name not in EVENTS:
        return False, f"Unsupported assurance event: {event_name}"
    if set(needs) != {"scope", *ASSURANCE_JOBS}:
        return False, "The aggregate must receive the scope and every assurance job."
    scope = needs["scope"]
    if scope.get("result") != "success":
        return False, "Assurance scope detection did not succeed."
    run_assurance = scope.get("outputs", {}).get("run_assurance")
    if run_assurance not in {"true", "false"}:
        return False, "Assurance scope detection did not produce a valid decision."
    if run_assurance == "false" and event_name != "pull_request":
        return False, "Scheduled and manual runs must execute the full assurance suite."

    expected = dict.fromkeys(ASSURANCE_JOBS, "success")
    if run_assurance == "false":
        expected = dict.fromkeys(ASSURANCE_JOBS, "skipped")
    else:
        if event_name != "pull_request":
            expected["dependency-review"] = "skipped"
        if event_name == "pull_request" and not same_repository:
            expected["scorecard"] = "skipped"
    failures = [
        f"{job}: expected {result}, got {needs[job].get('result', 'missing')}"
        for job, result in expected.items()
        if needs[job].get("result") != result
    ]
    if failures:
        return False, "; ".join(failures)
    if run_assurance == "false":
        return True, "Documentation-only pull request: all assurance scans explicitly skipped."
    return True, "All required assurance jobs passed; event-specific skips were verified."


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("scope", "check"))
    args = parser.parse_args()
    event_name = os.environ["GITHUB_EVENT_NAME"]
    if args.command == "scope":
        if event_name not in EVENTS:
            raise ValueError(f"Unsupported assurance event: {event_name}")
        paths = changed_paths(
            os.environ["PR_BASE_SHA"], os.environ["PR_HEAD_SHA"],
        ) if event_name == "pull_request" else []
        run_assurance = event_name != "pull_request" or not documentation_only(paths)
        value = str(run_assurance).lower()
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
            output.write(f"run_assurance={value}\n")
        print(f"run_assurance={value}; changed files={len(paths)}")
        return 0

    passed, detail = evaluate_jobs(
        json.loads(os.environ["ASSURANCE_NEEDS"]),
        event_name,
        os.environ["SAME_REPOSITORY"] == "true",
    )
    print(detail)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a", encoding="utf-8") as output:
            output.write(f"Product assurance gate: {'passed' if passed else 'failed'}\n\n{detail}\n")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
