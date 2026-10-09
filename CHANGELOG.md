# Changelog

All notable Perdura changes are documented here. Releases use stable semantic
versions in the `0.x` series as defined in [VERSIONING.md](VERSIONING.md).

## Unreleased

### Fixed

- Removed the SciPy 1.17 Anderson–Darling deprecation warning for descriptive
  statistics with more than 5,000 finite values. The existing statistic, 5%
  critical value, and display are preserved, including compatibility with older
  supported SciPy versions.

## 0.8.2

This release includes feature and analytical changes since 0.8.1, including
project schema 7. Review the compatibility and analytical notes when upgrading.

### Added

- System Definition workflows for hierarchical system models, validation,
  traceability, and linked reliability analyses.
- Plotly 4.1.2 figure JSON downloads, including optional verification packages
  that preserve figure data, view state, frames, and the Plotly version.
- Chart data tables, compact/comfortable display density, clearer recalculation
  indicators, and expanded keyboard and focus support across shared controls.

### Changed

- Improved chart resizing, fullscreen behavior, accessible dialogs and tables,
  and browser compatibility recovery. Upgraded Tailwind to version 4 while
  preserving the established palette and control appearance.
- Removed redundant chart updates and closed-panel calculations without
  reducing scientific precision, simulation effort, or chart resolution.
- Made Sankey ordering deterministic and strengthened PNG, SVG, HTML, PDF,
  project, and verification-package export coverage.
- Isolated project imports and asynchronous results, hardened ONNX model
  validation, and moved project calculations off the API event loop.
- Refreshed frontend, Python, container, and CI dependencies; corrected API
  routing errors and strengthened simulation request validation and diagnostics.
- Repaired Product assurance security scans, added Firefox/WebKit and native
  ARM64 coverage, and retained strict numerical and performance checks.
- Consolidated release evidence, dependency manifests, SBOMs, and scientific
  reports into one verification bundle alongside the wheel and Linux archive.

### Analytical changes

- Added joint Weibull cumulative-exposure step-stress inference with an estimated
  or fixed inverse-power exponent, right censoring, and eligible asymptotic
  profile-likelihood intervals. The previous heuristic remains explicitly
  identified as a legacy method.
- Added single-predictor cubic B-spline regression with Ridge regularization,
  fold-fitted preprocessing and tuning, out-of-fold validation, and explicit
  linear extrapolation beyond the fitted predictor range.
- Stabilized conditional warranty forecasts and grouped lifetime interval
  probabilities in extreme tails; rejected invalid grouped-fit optima.
- Required converged base and bootstrap estimates for Turnbull confidence bands.
- Corrected Markov mean time to first failure to respect the initial state
  distribution and reachable states, and applied configured dwell models to
  direct transient and reliability calculations.
- Advanced result-engine revisions for Life Data, Reliability Testing tools,
  System Definition, and Markov to 2, and Warranty to 3. Imported results from
  older revisions must be recalculated; compatible inputs are retained.

### Compatibility

- New project exports use schema 7. Schema 6 exports remain importable; older
  schemas are rejected. Existing schema 6 browser data is copied into the new
  isolated workspace on first use when it is empty, preserving the old keys.
  Export a backup before upgrading.
- Supported browsers are Chrome/Edge 111+, Firefox 128+, and Safari 16.4+.
- Custom Python lifetime adapters passed to `Warranty.forecast_returns` must
  provide a stable `_logsf`; CDF-only adapters are rejected. Saved spline assets
  require rebuilding and do not yet support ONNX export.
- The supported application installation uses Python 3.13.14 through `uv tool`;
  Linux x86-64 archives and Linux x86-64/ARM64 containers remain available.
- Scientific assurance is procedure-specific. The model inventory remains
  incomplete; passing automated tests does not certify every analytical method
  or establish full accessibility conformance.

## 0.8.1

### Changed

- Replaced direct unsigned macOS and Windows application bundles with a tested,
  cross-platform `uv tool` installation from PyPI.
- Added a local `perdura` launcher and `perdura doctor` installation identity,
  with the built browser interface included in the Python application wheel.
- Retained the Linux x86-64 standalone archive and added a public GHCR image
  manifest for Linux x86-64 and ARM64.
- Extended CI and release evidence to validate the application wheel on Linux,
  Windows, and both Intel and Apple Silicon macOS runners and to bind the OCI
  container digest to the release.
- PyPI publication uses GitHub OIDC Trusted Publishing; no long-lived package
  repository secret is used.

### Analytical changes

- None. This patch changes packaging and delivery only; project schema and
  analytical engine revisions are unchanged.

## 0.8.0

### Added

- A complete Maintenance Task Analysis workflow linking predicted failures,
  task-frequency and duration uncertainty, resource constraints, representative
  schedules, utilization, and cost results.
- Software Reliability analysis and planning models, with diagnostics,
  uncertainty, operational-profile context, and release projections.
- State-of-the-art AIAG-VDA FMEA workflows covering structure, function,
  failure, risk, optimization, documentation, controlled terminology,
  failure-flow governance, block diagrams, and Failure Rate Prediction links.
- Exact and bootstrap-aware Life Data confidence inference, including
  Exponential-2P confidence bounds, interval-method eligibility reporting, and
  a machine-readable confidence-method inventory.
- Expanded Failure Rate Prediction contribution views, engineering-canvas
  annotations and assets, bookmarking, report snapshots, and API coverage.

### Changed

- Project schema 6 records the expanded FMEA, software-reliability, and
  maintenance-analysis state without legacy project-file compatibility.
- System-modeling canvases, Failure Rate Prediction, FMEA, Help, reports, and
  shared visual controls received substantial usability and resilience updates.
- The frontend now uses React 19, and source/CI coverage includes Python 3.14.
- Dependency, CodeQL, container, performance, release-evidence, and
  companion-website checks were refreshed and hardened.

### Analytical changes

- Life Data confidence intervals now select and disclose distribution-appropriate
  exact, profile-likelihood, asymptotic, or bootstrap methods; unsupported
  parameter regimes are reported explicitly rather than silently approximated.
- New Maintenance Task Analysis calculations propagate task-frequency,
  duration, resource, schedule, and cost uncertainty.
- New software-reliability models support exposure-based growth, comparison,
  diagnostics, and planning calculations.
- FMEA calculations and governance now implement AIAG-VDA-aligned action
  priority, traceable failure chains, controlled cross-level propagation, and
  readiness validation.

## 0.7.0

### Added

- Canonical release-version tooling, build diagnostics, explicit project-file
  schema metadata, and per-analysis result-engine revisions.
- Optional single-download verification packages for every export, with exact
  artifact SHA-256, project/build identity, analysis-run fingerprints, an
  in-application verifier, and a dependency-free command-line verifier.
- Controlled project identity fields and bounded analysis/export trace ledgers.

### Changed

- Project exports use schema version 3. Unsupported schemas now fail closed;
  saved results produced by a different engine revision are discarded and must
  be recalculated.
- The release binary now embeds the SHA-256 and workflow link for its
  consolidated CI verification report.
- Restored a stable flex-height chain around the LDA plot so the Plotly canvas
  remains visible after post-render layout updates.

### Analytical changes

- None. Current analytical engine revisions begin at 1.

## 0.6.0

- Previous Perdura milestone. See the Git history and GitHub release notes for
  the complete historical change inventory.
