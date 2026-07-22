# Perdura versioning and compatibility

Perdura uses stable `MAJOR.MINOR.PATCH` releases. While the application is in
the `0.x` series, ordinary feature milestones increment `MINOR`; `PATCH` is
reserved for narrow corrections that do not intentionally change analytical
interpretation. A future `1.0.0` will mark the first long-term compatibility
commitment.

## Release classes

- Increment `MINOR` for user-facing features, project-file schema changes,
  analytical methods, model defaults, or intended changes to calculated output.
- Increment `PATCH` for contained bug, packaging, documentation, or security
  corrections with no intended change to the meaning of an analysis.
- Every analytical change must be called out under **Analytical changes** in
  `CHANGELOG.md` and increment the affected result-engine revision in
  `gui/frontend/src/version.ts`. This forces saved outputs to be recalculated
  while retaining compatible inputs.

Only stable `vX.Y.Z` tags are published. Perdura does not currently publish
prerelease channels or maintain legacy dependency/release branches.

## Canonical release procedure

`pyproject.toml` is the human-facing canonical declaration. Change every
derived declaration with one command:

```bash
python tools/bump_version.py 0.7.0
python tools/check_version_consistency.py --expected 0.7.0
```

Commit the bump and changelog on the release PR. After it merges to `main`, tag
that exact commit with the immutable tag `v0.7.0` and push the tag. The release
workflow tests the tagged source and automatically publishes versioned desktop
archives and dependency manifests.

## Project files and calculated results

Application version, project schema, and analytical engine revisions are
independent:

- `schemaVersion` defines the shape and meaning of a project file. Perdura
  accepts only its current schema. There are deliberately no compatibility
  migrations for older project formats; an unsupported file fails with a clear
  version error instead of being interpreted approximately.
- `createdWith` records the Perdura version, source commit, and build timestamp
  that created an export. It is diagnostic metadata, not a compatibility rule.
- `identity`, `analysisRuns`, and `exportLedger` preserve project identity and
  bounded trace records. Schema 3 introduced these fields.
- `engineRevisions` identifies the implementation used for saved computed
  results. A mismatch keeps compatible inputs but discards the affected saved
  results and tells the user to recalculate.

Increment the project schema only for an incompatible project-file change.
Increment only the affected engine revision when inputs remain compatible but
the result algorithm, equations, assumptions, or defaults change.

## Exported artifact identity

The Export menu's **Verification package** toggle wraps an artifact and its
SHA-256 manifest into one `.perdura.zip`. Release manifests identify the exact
source commit and consolidated CI verification-report digest. This profile is
checksum-only: it supports integrity and traceability but intentionally makes no
digital-signature or producer-authenticity claim. See
[`docs/assurance/ARTIFACT_PROVENANCE.md`](docs/assurance/ARTIFACT_PROVENANCE.md).
