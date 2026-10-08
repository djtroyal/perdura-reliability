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
    "candidate-scorecard",
    "container",
    "browser-compatibility",
    "dynamic-and-performance",
)
DOCUMENTATION_FILES = {
    "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md",
}
EVENTS = {"pull_request", "push", "schedule", "workflow_dispatch"}


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
    manual_candidate: bool = False,
) -> tuple[bool, str]:
    if event_name not in EVENTS:
        return False, f"Unsupported assurance event: {event_name}"
    if manual_candidate and event_name != "workflow_dispatch":
        return False, "Candidate Scorecard mode requires a manual branch run."
    if set(needs) != {"scope", *ASSURANCE_JOBS}:
        return False, "The aggregate must receive the scope and every assurance job."
    scope = needs["scope"]
    if scope.get("result") != "success":
        return False, "Assurance scope detection did not succeed."
    run_assurance = scope.get("outputs", {}).get("run_assurance")
    if run_assurance not in {"true", "false"}:
        return False, "Assurance scope detection did not produce a valid decision."
    if run_assurance == "false" and event_name != "pull_request":
        return False, "Main, scheduled and manual runs must execute the full assurance suite."

    expected = dict.fromkeys(ASSURANCE_JOBS, "success")
    expected["candidate-scorecard"] = "skipped"
    if run_assurance == "false":
        expected = dict.fromkeys(ASSURANCE_JOBS, "skipped")
    else:
        if event_name != "pull_request":
            expected["dependency-review"] = "skipped"
        if event_name == "pull_request" and not same_repository:
            expected["scorecard"] = "skipped"
        if manual_candidate:
            expected["scorecard"] = "skipped"
            expected["candidate-scorecard"] = "success"
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
        os.environ.get("SCORECARD_MANUAL_CANDIDATE", "false") == "true",
    )
    print(detail)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a", encoding="utf-8") as output:
            output.write(f"Product assurance gate: {'passed' if passed else 'failed'}\n\n{detail}\n")
            if jobs_file := os.environ.get("ASSURANCE_JOBS_FILE"):
                try:
                    jobs = json.loads(Path(jobs_file).read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    # Optional evidence navigation must not change the verdict
                    # derived from GitHub's required job results above.
                    jobs = []
                    output.write("\nJob links are unavailable; see this workflow's jobs.\n")
                # gh --slurp wraps paginated responses; tolerate a single page
                # too. URLs originate in GitHub's jobs API, never PR input.
                pages = jobs if isinstance(jobs, list) else [jobs]
                output.write("\n| Job | Result | Evidence |\n| --- | --- | --- |\n")
                for page in pages:
                    for job in page.get("jobs", []):
                        if job.get("name") == "Product assurance gate":
                            continue
                        name = str(job["name"]).replace("|", "\\|")
                        result = job.get("conclusion") or job.get("status", "unknown")
                        url = job.get("html_url", "")
                        output.write(f"| {name} | {result} | [Open job]({url}) |\n")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
