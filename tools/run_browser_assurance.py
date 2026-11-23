#!/usr/bin/env python3
"""Run every declared browser suite, retaining failures and bounded evidence."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "assurance/browser-suites.json"
FRONTEND = ROOT / "gui/frontend"
SCRIPT = re.compile(r"assurance:[a-z][a-z0-9-]*\Z")


def load_registry(path: Path, package_path: Path) -> dict:
    registry = json.loads(path.read_text(encoding="utf-8"))
    package = json.loads(package_path.read_text(encoding="utf-8"))
    if registry.get("schemaVersion") != 1 or not isinstance(registry.get("groups"), dict):
        raise ValueError("Unsupported browser suite registry.")
    declared: set[str] = set()
    for group, suites in registry["groups"].items():
        if not re.fullmatch(r"[a-z][a-z0-9-]*", group) or not isinstance(suites, list) or not suites:
            raise ValueError(f"Invalid or empty browser suite group: {group}")
        for suite in suites:
            script, timeout = suite.get("script", ""), suite.get("timeoutSeconds")
            if not SCRIPT.fullmatch(script) or script in declared:
                raise ValueError(f"Invalid or duplicate browser suite: {script}")
            if type(timeout) is not int or not 1 <= timeout <= 1200:
                raise ValueError(f"Browser suite timeout must be 1–1200 seconds: {script}")
            declared.add(script)
    external = registry.get("externallyManaged", {})
    aliases = registry.get("aliases", {})
    if not isinstance(external, dict) or not isinstance(aliases, dict):
        raise ValueError("External suites and aliases must be explicit mappings.")
    for script, owner in external.items():
        if not SCRIPT.fullmatch(script) or script in declared or not isinstance(owner, str) or not owner.strip():
            raise ValueError(f"Invalid external browser suite ownership: {script}")
        declared.add(script)
    for script, target in aliases.items():
        if not SCRIPT.fullmatch(script) or script in declared or target not in declared:
            raise ValueError(f"Invalid browser suite alias: {script}")
        declared.add(script)
    available = {script for script in package.get("scripts", {}) if script.startswith("assurance:")}
    if declared != available:
        raise ValueError(
            f"Browser suite coverage differs from package scripts; "
            f"unregistered={sorted(available - declared)}, missing={sorted(declared - available)}"
        )
    return registry


def terminate_process_group(process: subprocess.Popen) -> None:
    """Reap npm and its browser/server descendants before another suite starts."""
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        # A shell/npm parent may exit before its child servers. Kill the group
        # even after the parent has exited, so leaked listeners cannot poison
        # the next independent suite.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        # Signal delivery is asynchronous. Wait for descendants to relinquish
        # sockets before the next suite can bind them. Orphan zombies may keep
        # the process group visible until the runner's PID 1 reaps them, hence
        # the bounded wait rather than an unbounded group-existence loop.
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.01)
    elif process.poll() is None:
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=10)
    process.wait(timeout=5)


def run_command(command: list[str], *, cwd: Path, env: dict[str, str],
                stdout_path: Path, stderr_path: Path, timeout_seconds: int) -> dict:
    started = time.monotonic()
    process = None
    status, returncode, detail = "failed", None, ""
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        try:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stdout,
                                       stderr=stderr, start_new_session=os.name == "posix")
            try:
                returncode = process.wait(timeout=timeout_seconds)
                status = "passed" if returncode == 0 else "failed"
                if returncode:
                    detail = f"Command exited with status {returncode}."
            except subprocess.TimeoutExpired:
                status = "timed_out"
                detail = f"Suite exceeded its {timeout_seconds}-second limit."
        except OSError as exc:
            detail = f"Could not start suite: {exc}"
        finally:
            if process is not None:
                terminate_process_group(process)
    return {"status": status, "returncode": returncode, "detail": detail,
            "durationSeconds": round(time.monotonic() - started, 3)}


def write_evidence(report: dict, output: Path) -> None:
    (output / "browser-suites.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    root = ET.Element("testsuites")
    suite = ET.SubElement(root, "testsuite", name=f"browser-{report['group']}",
                         tests=str(len(report["suites"])),
                         failures=str(sum(item["status"] != "passed" for item in report["suites"])))
    for result in report["suites"]:
        case = ET.SubElement(suite, "testcase", classname=f"browser.{report['group']}",
                             name=result["script"], time=str(result.get("durationSeconds", 0)))
        if result["status"] != "passed":
            ET.SubElement(case, "failure", type=result["status"],
                          message=result.get("detail", "Suite did not complete.")).text = (
                f"stdout: {result['stdout']}\nstderr: {result['stderr']}"
            )
        ET.SubElement(case, "system-out").text = f"Evidence directory: {result['output']}"
    ET.ElementTree(root).write(output / "junit-browser-suites.xml", encoding="utf-8", xml_declaration=True)


def run_group(registry: dict, group: str, output: Path, *, frontend: Path = FRONTEND,
              execute=run_command) -> dict:
    if group not in registry["groups"]:
        raise ValueError(f"Unknown browser suite group: {group}")
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    planned = registry["groups"][group]
    results = []
    for suite in planned:
        name = suite["script"].removeprefix("assurance:")
        # Reusing --output-dir must never make a failed new run appear to have
        # screenshots or passing result JSON left by an earlier invocation.
        directory = Path(tempfile.mkdtemp(prefix=f"{name}-", dir=output))
        results.append({**suite, "status": "not_run", "detail": "Suite has not run.",
                        "output": str(directory), "stdout": str(directory / "stdout.log"),
                        "stderr": str(directory / "stderr.log")})
    report = {"schema": "perdura.browser-suites/v1", "group": group,
              "createdAt": datetime.now(timezone.utc).isoformat(), "status": "incomplete",
              "expectedSuites": [suite["script"] for suite in planned], "suites": results}
    write_evidence(report, output)
    try:
        for result in results:
            command = ["npm.cmd" if os.name == "nt" else "npm", "run", result["script"],
                       "--", "--output-dir", result["output"]]
            print(f"Running {result['script']} (limit {result['timeoutSeconds']}s)", flush=True)
            result.update(status="running", detail="Suite is running.")
            write_evidence(report, output)
            try:
                result.update(execute(command, cwd=frontend, env=dict(os.environ),
                                      stdout_path=Path(result["stdout"]), stderr_path=Path(result["stderr"]),
                                      timeout_seconds=result["timeoutSeconds"]))
            except KeyboardInterrupt:
                result.update(status="interrupted", detail="Suite was interrupted before completion.")
                raise
            print(f"{result['status'].upper()}: {result['script']}; {result['detail']}", flush=True)
            write_evidence(report, output)
        report["status"] = "passed" if all(r["status"] == "passed" for r in results) else "failed"
    finally:
        write_evidence(report, output)
        if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
            with Path(summary).open("a", encoding="utf-8") as file:
                file.write(f"\n### Browser suites: {group}\n\n| Suite | Result | Seconds |\n| --- | --- | --- |\n")
                for result in results:
                    file.write(f"| {result['script']} | {result['status']} | {result.get('durationSeconds', 0)} |\n")
                file.write(f"\nEvidence: `{output}`. All declared suites must pass.\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        registry = load_registry(args.registry, FRONTEND / "package.json")
        if args.validate_only:
            print("Browser suite registry covers every assurance script.")
            return 0
        if not args.group or not args.output_dir:
            parser.error("--group and --output-dir are required unless --validate-only is used")
        return 0 if run_group(registry, args.group, args.output_dir)["status"] == "passed" else 1
    except (OSError, ValueError) as exc:
        print(f"Browser assurance configuration failed: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Browser assurance interrupted; unfinished suites remain incomplete.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
