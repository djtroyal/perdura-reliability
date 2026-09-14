# GitHub main and open-PR review — 2026-09-14

## Baselines and evidence

The primary baseline is GitHub main at
[`5817b42adce6886e8d3373e9d33edf95f857b9f3`](https://github.com/djtroyal/perdura-reliability/commit/5817b42adce6886e8d3373e9d33edf95f857b9f3).
The GitHub API confirmed that commit and all six open PR heads on September 14.
All PRs remain open and conflict-free, with no submitted reviews. Conflict-free
status does not establish that a PR is ready to merge.

The local checkout is based on `007203cf21c6ae21bc6f8269e1e99c5d2d83dc87`,
with pre-existing uncommitted development and the subsequently authorized
remediation. At the committed level, local HEAD differs from GitHub main only
in the frontend manifest and lockfile. The uncommitted working tree is a
separate candidate and was not used to declare a GitHub defect fixed.

This attribution pass reused the earlier code review and reproductions,
verified their locations in the pinned Git objects, and refreshed GitHub
checks and protection settings. It did not rerun the complete test suite on
each remote commit. The 2,585 passing Python tests, 41 frontend contract suites,
browser checks and installed-wheel checks apply to the **local candidate**;
see [local remediation and validation](review-remediation-2026-09-14.md).

## Findings on GitHub main

P1 means a correctness or validation-boundary issue to address before release;
P2 means an important follow-up. These priorities are distinct from advisory
severity ratings.

1. **P1 — Full project imports retain unrelated modules under a new identity
   and unit system.** The importer starts with
   [the existing module map](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/frontend/src/store/project.ts#L1748),
   replaces only supplied keys, then
   [adopts imported units and marks the project clean](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/frontend/src/store/project.ts#L1819).
   Reproduction: populate Warranty in an hours project, then fully import a days
   project containing only Growth. Warranty survives without conversion under
   the new project identity and units. Full imports must replace the module
   set; only explicit partial imports should merge.

2. **P1 — Delayed Prediction results can overwrite another folio or project.**
   [The calculation awaits its response and then calls an unguarded setter](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/frontend/src/components/Prediction/index.tsx#L2826),
   whose [destination is the currently active folio](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/frontend/src/store/project.ts#L1183).
   Start in A and switch to B, replace the project, or edit inputs before the
   response arrives: old results can become attached to the new inputs and
   appear clean. Bind responses to project generation, folio, input snapshot
   and request order. Mission and derating paths need the same lifetime rules.

3. **P1 — Grouped life and warranty fitting can report invalid likelihoods as
   converged fits.** [Interval probability subtraction](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/src/reliability/Grouped_life.py#L367)
   loses upper-tail mass: a unit exponential interval `(40,41]` returns
   `-inf`, rather than approximately `-40.4586751454`. The fitter converts
   this into a finite `1e300` penalty that
   [candidate selection can accept](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/src/reliability/Grouped_life.py#L708).
   With 100 failures in `(0,1]` and one in `(40,41]`, the exponential fit
   returns rate `1.1160220994`, converged, with log likelihood `-1e300`;
   the analytic MLE is `1.2598804363`.
   [Warranty shares the likelihood and eligibility problem](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/src/reliability/Warranty.py#L233).
   Use stable CDF/survival-tail subtraction and exclude invalid-objective
   candidates, even when an optimizer reports success.

4. **P1 — Markov MTTF ignores the selected initial distribution.**
   [MTTF selects the first up state](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/src/reliability/Markov.py#L419).
   For Up → Degraded at rate 0.01 and Degraded → Failed at rate 1, starting
   in Up, Degraded or Failed always reports 101, although the correct values
   are 101, 1 and 0. Reliability curves use the chosen initial state, producing
   contradictory outputs. Propagate initial probabilities through MTTF,
   summaries, phase expansion, uncertainty and the
   [API time-grid selection](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/backend/routers/markov.py#L250).

5. **P1 — ONNX validation checks only the top-level graph.**
   [Operator, node-count and external-data checks](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/backend/routers/modeling.py#L2206)
   omit nested graphs and tensor attributes; domains and local functions are
   not constrained. An allowed Scan can contain an unexamined body. The
   checksum verifies consistency with the supplied model card, not trust.
   Recursively validate the complete model before constructing its CPU runtime,
   and return controlled validation errors for malformed or incompatible
   models. This finding establishes a policy bypass, not arbitrary-code
   execution.

6. **P2 — Turnbull confidence bands count unconverged estimates as successes.**
   [The bootstrap checks exceptions rather than convergence](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/src/reliability/Grouped_life.py#L1049).
   With intervals `(0,2] × 1`, `(1,3] × 10000`, and `(2,∞) × 1`, the
   base fit exhausts 10,000 iterations. For 20 replicates and seed 1, only
   eight converge, yet bands are reported with 20 successful replicates.
   Require a converged base and apply the existing 95% bootstrap-success
   threshold to converged replicates.

7. **P2 — Direct Markov methods ignore Erlang dwell models.**
   [Direct transient/reliability calculations](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/src/reliability/Markov.py#L313)
   use the unexpanded exponential generator, whereas
   [analyze() applies dwell models](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/src/reliability/Markov.py#L742).
   An Erlang-shape-3 up state departing at rate 0.2 gives direct reliability
   at time 4 of `0.4493289641`, versus `0.5697087467` from analysis.
   Make the default semantics agree and expose the exponential baseline
   explicitly when needed.

8. **P2 — Delayed provenance can cross project boundaries.**
   [The 180ms capture timer and asynchronous hash completion](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/frontend/src/store/project.ts#L1532)
   read or append to live project state. Replacing the project during either
   delay can attribute an old calculation to the new project. Capture origin
   identity, generation and analysis name before scheduling, then verify the
   origin again before appending.

9. **P2 — Project calculations block their worker's event loop.**
   [The async dispatcher directly invokes synchronous numerical endpoints](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/backend/project_api.py#L289).
   An expensive calculation prevents that worker from servicing unrelated
   requests or delivering stream updates until it finishes. Use the framework
   worker pool while retaining dependency ordering. The local regression
   verifies a health request completes during an in-flight calculation.

## Shared dependency and assurance findings

Main retains [MapLibre 4.7.1 in its lockfile](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/gui/frontend/package-lock.json#L5395).
[GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579)
is rated critical and identifies 6.4.1 as the first patched release. The
dependency finding is established; exploitability through Perdura's custom
non-map bundle is not established by the scanner. The local scoped override
and bundle guard are distinct from the full Plotly CDN runtime used in HTML
exports, which remains an explicitly documented limitation.

Main's [September 8 assurance run](https://github.com/djtroyal/perdura-reliability/actions/runs/34220956149)
failed OSV and the container scan; dynamic assurance was cancelled. Older
green PR checks are not evidence against later-published advisories.
The [Trivy SARIF step](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/.github/workflows/product-assurance.yml#L143)
requests HIGH/CRITICAL but omits `limit-severities-for-sarif`. Correcting that
scope is necessary; it does not itself remediate real qualifying findings.

Live branch protection requires 12 CI/CodeQL contexts, including frontend,
Python, lock/evidence and selected platform checks. It does not require OSV,
container or dynamic assurance. The active main ruleset adds pull-request,
deletion and force-push protections, without an assurance status requirement.
Add a stable aggregate that fails on missing, failed, cancelled or unexpectedly
skipped jobs. Replace the current workflow-level path filter with an explicit
documentation-scope decision so the aggregate is always reported. Activate it
in repository settings only after its hosted success and failure paths work.

Further maintenance improvements are immutable digests for the
[Node and uv container sources](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/Dockerfile#L11),
Docker dependency monitoring, and explicit
[active ZAP duration limits](https://github.com/djtroyal/perdura-reliability/blob/5817b42adce6886e8d3373e9d33edf95f857b9f3/.github/workflows/product-assurance.yml#L245).
The local implementations have not yet established green hosted scans or
changed GitHub protection.

## All open pull requests

| PR and reviewed head | Disposition based on GitHub evidence |
|---|---|
| [#234 selector-parser](https://github.com/djtroyal/perdura-reliability/pull/234), `f919a73962e02c37ba3a5ba406451f422a106915` | Prioritize the 6.1.2 → 6.1.4 security patch. September 3 functional, packaging, platform, OSV and dynamic checks passed; [container failed](https://github.com/djtroyal/perdura-reliability/actions/runs/33723479288/job/100547319668). Refresh security checks before merging. |
| [#232 React DOM types](https://github.com/djtroyal/perdura-reliability/pull/232), `b03a181d231e36f1c960908bc6b8779a0218bc8b` | Low-risk candidate after shared assurance repair. No specific defect identified in the types-only patch. August 29 checks passed except [container](https://github.com/djtroyal/perdura-reliability/actions/runs/33232481674/job/99047581429); rerun against current advisories. |
| [#229 setup-uv v10](https://github.com/djtroyal/perdura-reliability/pull/229), `74f95f87cc933a8db80f56957aa25beb7a9de761` | Candidate after shared assurance repair. Eight immutable references change while uv remains 0.11.29. Python 3.11–3.14, five platforms, frontend and dynamic checks passed; [container scan failed](https://github.com/djtroyal/perdura-reliability/actions/runs/31863241608/job/94960070689). No demonstrated v10 compatibility regression. |
| [#237 frontend dependency group](https://github.com/djtroyal/perdura-reliability/pull/237), `e5d05b53a093849fec328b1c1802d01498df532e` | Retain, incorporate security fixes, and rescan. Functional, platform and dynamic checks passed September 12. [OSV fails on retained MapLibre 4.7.1 and selector-parser 6.1.2](https://github.com/djtroyal/perdura-reliability/actions/runs/34671602577/job/103493858887); container also fails. These vulnerable dependencies already exist on main. |
| [#236 action group](https://github.com/djtroyal/perdura-reliability/pull/236), `6289da08fdd70d95c8e50bb7962ee4f6006f4c48` | Request changes. [Four Python jobs fail two old-SHA assertions](https://github.com/djtroyal/perdura-reliability/actions/runs/33943299645/job/101244721366), with consequential verification-publication failure. Update tests to verify immutable references and actual OSV/SBOM contracts. Frontend/platform checks pass; shared OSV/container failures remain separate. |
| [#227 react-plotly v4](https://github.com/djtroyal/perdura-reliability/pull/227), `5a61716dc12ee337e42a07f8a193a1fde33405fb` | Block the dependency-only upgrade. [Frontend logs show seven TypeScript errors and an unexported factory.js path](https://github.com/djtroyal/perdura-reliability/actions/runs/31863025814/job/94959519512). Require the full import/type/interoperability migration and browser checks. [Container fails during build](https://github.com/djtroyal/perdura-reliability/actions/runs/31863025944/job/94959519559), before Trivy; downstream wheel/platform failures are consequences. |

## Separate assessment of local work

The uncommitted System Definition feature does not exist on the pinned main
commit or these dependency PRs. Two findings belong specifically to that local
development:

- Duplicate-label migration could reinsert a third or fifth duplicate after
  deleting the second, producing arbitrary links. Local remediation uses a
  permanent ambiguity set, with behavioral coverage for one through five
  matching labels.
- Its new router imported `system_definition_schemas` without a packaged
  import alias. The installed wheel failed at startup although checkout tests
  passed. Local remediation adds source/wheel aliases, fresh-process tests and
  successful installed-wheel startup checks.

The immediate derating rerun issue was caught and corrected during local
request-guard integration; it is not attributed to the published PRs. The
completed mission-result invalidation improvement also has a passing production
browser regression. Seven examples were genuinely recalculated after numerical
engine revisions, preserving the other 76 fixture files.

## Recommended delivery and enhancements

1. Publish the main correctness and validation fixes as focused, reviewable
   changes, with their reproductions and saved-result revision changes.
2. Reconcile the frontend dependency PRs into a consistent reviewed lockfile:
   retain the selector-parser fix, address MapLibre within the supported plot
   scope, and include the complete Plotly wrapper migration. Rerun current
   dependency and browser checks on that exact candidate.
3. Land action-test and assurance repairs, obtain hosted scanner/container
   evidence, then activate the aggregate gate. Local lint or npm audit cannot
   substitute for image scans and hosted checks.
4. Review and deliver System Definition separately, retaining migration,
   duplicate-identity and packaged-startup coverage.

Beyond these fixes, extend request-origin guards to other asynchronous analysis
pages, add explicit cancellation/time budgets for expensive project/model
execution, and favor analytic numerical oracles and real browser journeys over
source-string assertions. Treat the separate CDN export runtime as its own
dependency boundary with a tracked replacement or update strategy.
