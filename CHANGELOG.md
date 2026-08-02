# Changelog

All notable Perdura changes are documented here. Releases use stable semantic
versions in the `0.x` series as defined in [VERSIONING.md](VERSIONING.md).

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
