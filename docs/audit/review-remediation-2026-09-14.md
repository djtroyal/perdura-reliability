# Code and pull-request review remediation — 2026-09-14

These changes implement the review findings in the existing working tree,
including integration with the in-progress System Definition feature. They do
not merge the reviewed GitHub pull requests or change repository protection.

This document describes **local remediation and local validation only**. The
primary review baseline is GitHub main at
`5817b42adce6886e8d3373e9d33edf95f857b9f3` and the six open PR heads recorded in
[the separate GitHub review](github-review-2026-09-14.md). Their dispositions
remain unchanged by the passing local tests below. The System Definition
duplicate-label and packaged-startup findings belong to the pre-existing local
feature, which is absent from that main commit.

## Implemented changes

- **Project isolation:** full imports replace the module set; partial imports
  retain their merge semantics. Prediction, mission and derating requests are
  tied to their originating project generation, folio and inputs. Delayed
  provenance hashing cannot append records to a replacement project. Immediate
  derating reruns use the same current snapshot for payload and response guard.
  Input edits also clear completed transient mission results.
- **Numerical results:** grouped interval likelihoods use stable tail
  subtraction; grouped and warranty fits reject invalid-objective plateaus.
  Turnbull confidence bands require converged base and bootstrap fits, with
  controlled API errors. Markov MTTF follows the initial distribution and
  reachable states; direct transient/reliability methods honor Erlang dwell
  models. Saved-result revisions advance for affected calculation engines.
- **Model imports and execution:** ONNX policy validation covers nested graphs,
  domains, functions, tensor attributes and external data before runtime
  creation. Runtime-incompatible imports return validation errors. Project
  calculations run in the worker pool, keeping the API event loop responsive.
- **System Definition integration:** repeated labels remain ambiguous rather
  than becoming arbitrarily linked on the third duplicate. Source and packaged
  backend bootstraps expose the new schema module consistently.
- **Dependencies and Plotly:** incorporates the reviewed changes from PRs
  #227, #229, #232, #234, #236 and #237. The React wrapper uses its public ESM
  factory and explicit Plotly types. The scoped MapLibre exception excludes map
  runtime code from the application bundle. Chart and ZIP HTML exports share
  validation and reject unsupported map content.
- **Assurance:** immutable action updates, refreshed multi-platform container
  digests and Docker dependency monitoring accompany a stable aggregate check
  that rejects failed, cancelled, missing or unexpectedly skipped jobs. The
  Trivy SARIF severity limit and bounded ZAP scans remain enabled. Plotly browser
  journeys run in the dynamic assurance job.
- **Examples:** seven affected completed-analysis fixtures were recalculated
  through the API. The other 76 fixture files were preserved; all 83 fixture
  index checksums were checked. The seeder accepts multiple explicit refresh
  IDs with `--resume`.

## Validation and release limits

Local validation passed:

- 2,585 Python tests, including numerical, API and fresh-process source/wheel
  backend startup regressions.
- All 41 frontend contract suites (40 in the aggregate run, with the corrected
  prediction-request suite subsequently passing its focused rerun).
- Production frontend compilation and bundling; `npm audit` reported zero
  vulnerabilities in the resolved dependency tree.
- Cartesian, WebGL 3D and Sankey browser journeys: resizing, SVG/HTML downloads
  and reopening each HTML export; Cartesian zoom/reset, notes and annotation
  preservation also passed with no uncaught browser errors.
- Production mission browser regression: quantity, environment and VITA edits
  clear old results; reruns transmit updated inputs and presentation changes
  preserve valid results. This regression runs in the dynamic assurance job.
- Five workflows checked with actionlint 1.7.12; 12/12 local assurance controls;
  API contract checks covering 26 modules and 176 operations with no issues;
  version/schema and locked-runtime checks.
- Application wheel built and installed into an isolated target. Its health,
  frontend HTML and referenced JavaScript returned HTTP 200. Wheel runtime
  identity reported the expected Python 3.13.14 and application 0.8.1. All seven
  recalculated fixtures served by the final wheel match their source bytes.

Container builds and image scans require a working Docker daemon, which was
unavailable locally. Hosted CodeQL, OSV, Scorecard, Trivy and ZAP results remain
release requirements. Activate the aggregate in branch protection only after
the deployed workflow demonstrates its successful and failure paths, as
described in [Security and performance assurance](../assurance/SECURITY_PERFORMANCE_ASSURANCE.md).

Interactive HTML exports still reference the separate full Plotly 3.7.0 CDN
runtime. The local npm audit and MapLibre override do not establish that this
external runtime is patched. Its scope and removal conditions are documented
in [Dependency management](../DEPENDENCY_MANAGEMENT.md#frontend-plotly-dependency-exception).
