# Changelog

All notable Perdura changes are documented here. Releases use stable semantic
versions in the `0.x` series as defined in [VERSIONING.md](VERSIONING.md).

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
