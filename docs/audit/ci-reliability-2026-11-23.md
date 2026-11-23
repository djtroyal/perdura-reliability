# Recurring PR check failures: causes and prevention

The investigation sampled the latest 100 Actions runs on November 23, including
55 CI/Product assurance runs from November 13–23. At that snapshot, 33 succeeded,
11 failed, nine were cancelled and two were running. Cancelled, superseded runs
are not counted as failed tests.

## Repeated causes

| Cause | Evidence | Prevention |
|---|---|---|
| Entire npm lockfile treated as changed demo authoring code | Three CI runs produced 12 duplicate Python failures plus three aggregate failures. [Representative failure](https://github.com/djtroyal/perdura-reliability/actions/runs/43645388146/job/132601927393). | Separate reviewed source/artifact hashes from recorded dependency provenance. Required preflight runs the real generator under candidate dependencies and requires byte-identical demo output. |
| Exported Plotly script lacked integrity protection; crawl discovery varied | Three assurance runs found rule 90003, while others missed the lazy-loaded chunk. [Representative failure](https://github.com/djtroyal/perdura-reliability/actions/runs/44123821116/job/134182135156). | Build-derived SRI and tamper rejection test; seed every built JS/CSS asset through ZAP, verify served bytes, retain coverage and require an empty passive queue. |
| Browser assertions coupled to obsolete presentation copy | [PR #294](https://github.com/djtroyal/perdura-reliability/actions/runs/45215622901/job/137836024762) calculated remaining life successfully but waited for an old label. | Stable result identifiers, independent numeric assertions at multiple reliability targets, response-based calculation readiness and failure traces. |
| Isolated Python image version bumps violate the qualified runtime | [PR #290](https://github.com/djtroyal/perdura-reliability/pull/290) replaced 3.13.14 with unsupported 3.15.2. | Dependabot continues image digest refreshes; Python/uv semantic version changes require coordinated runtime, lockfile and release qualification. Existing policy and vulnerability checks remain required. |
| One browser failure skipped unrelated later suites and security scans | The dynamic job ran browser checks, Lighthouse, k6 and ZAP as one success-dependent chain. | Four independent browser groups, a separate required security job, and independent performance steps. The runner attempts every suite in its group, retains per-suite logs/JSON/JUnit, cleans up descendant processes and fails on any incomplete or unsuccessful suite. |

The preflight also checks website fixture provenance before the Python matrix.
It reports the source failure once instead of repeating it across Python versions.
The verification report requires the preflight evidence; skipped matrix work
cannot produce a successful aggregate.

The first hosted run with deterministic coverage fetched and hash-verified all
107 built script/style assets and confirmed an empty passive queue. It found one
additional missing integrity attribute on the exported report's KaTeX stylesheet,
which previous crawls had missed. The stylesheet now uses a build-derived hash,
and the real report-package browser check validates every external script and
stylesheet against its installed bytes. Rule 90003 remains enabled.
All 38 registered browser suites and the independent
performance job passed that run.

The exact package/lockfile changes from PR #292 were also applied to an isolated
copy of this branch and installed with `npm ci`. Real generation qualification
passed with `dependencyEnvironmentChanged: true`; both demos reproduced the
reviewed SHA-256 `9ce01cba18b2996bcf081135428a8995c106de4b36ba136bc68be3b2884d2a36`.
The website contract passed all 94 capture definitions. The two demo files and
committed manifest remained byte-identical; no provenance was restamped.

## Failures that should remain failures

- The scheduled November 17 OSV finding for `picomatch` was a dependency finding,
  not a transient network error.
- A historical missing macOS ARM64 artifact followed an abandoned release job;
  verification correctly rejected missing platform coverage.
- A historical verification-only failure used unsettled GitHub job metadata.
  The existing bounded metadata polling already addresses this; it is retained.
- No evidence supported blanket test retries, weaker vulnerability thresholds,
  removal of numerical checks, or broad new ZAP suppressions.

## Reproduction and maintenance

After installing locked Python and frontend dependencies:

```sh
python tools/run_browser_assurance.py --validate-only
python tools/refresh_demo_project.py --check-generated --evidence /tmp/demo-generation.json
npm run test:website-resources --prefix gui/frontend
python tools/run_browser_assurance.py --group analysis --output-dir /tmp/browser-analysis
```

The registry covers all 38 standalone browser suites and explicitly identifies
four commands owned by other workflow steps. New `assurance:*` scripts must be
registered or preflight fails. Every group is required by the assurance gate,
whose summary links to the originating failed step.

`--check-generated` does not modify demos or restamp dependency provenance.
If candidate dependencies alter generated output, regenerate and review the
artifacts deliberately. Changed calculation inputs require regenerating affected
website fixtures through the real application, not merely replacing checksums.

The ZAP hook uses the documented packaged-scan lifecycle with `--autooff` and
does not filter findings. It verifies the complete candidate asset inventory
before allowing a successful coverage claim. See the
[ZAP baseline documentation](https://www.zaproxy.org/docs/docker/baseline-scan/)
and [Dependabot configuration reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#ignore).
