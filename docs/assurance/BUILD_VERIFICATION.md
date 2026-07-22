# Perdura build-verification evidence

Perdura publishes automated verification evidence for every pull request,
successful or failed `main` build, and release. The evidence is intended to
make the exact software revision, environment, tests, scientific checks, and
released files reviewable without reconstructing them from transient console
logs.

## Published records

Every CI run produces a GitHub job summary and a 90-day
`Perdura-CI-evidence-<commit>-<run>-<attempt>` artifact containing:

- `verification-report.html`, a self-contained printable review document;
- `verification-report.json`, the canonical
  `perdura.build-verification/v1` machine record;
- the JUnit XML for every Python and frontend test suite;
- Cobertura XML, JSON, and navigable HTML Python branch coverage;
- the exact versioned OpenAPI document and a fail-closed, module-by-module API
  contract matrix covering stable operation IDs, response schemas, standard
  errors, progress streams, and project-run eligibility;
- validation results, platform manifests, redacted command logs, and the
  model/reference assurance snapshots used by that run;
- locally observable product-hardening results and a deterministic scientific
  performance smoke record, each with machine-readable JSON and JUnit output; and
- `SHA256SUMS`, which binds every file in the evidence package.

The HTML report lists every test identity, duration, result, and available
failure detail. The workflow summary deliberately remains shorter so a failed
check is readable from the Actions page.

Each GitHub Release additionally carries:

- `Perdura-<version>-verification-evidence.zip` and its SHA-256 checksum;
- a standalone release-verification HTML and JSON report;
- the three platform dependency/environment manifests;
- platform-specific CycloneDX 1.6 and SPDX 2.3 SBOMs; and
- the release-profile Crow-AMSAA validation record.

The release report records the SHA-256 digest and size of each Linux, Windows,
and macOS archive. Binary archives are not duplicated inside the evidence ZIP.
GitHub artifact attestations bind the released archives, dependency manifests,
SBOMs, scientific record, and evidence ZIP to the originating workflow and
commit. Separate SBOM attestations associate each platform archive with its SPDX
document.
When a validly configured release attempt fails after CI evidence exists, the
workflow still attempts to publish a 90-day incomplete/failed release-evidence
artifact. It never creates a GitHub Release from that non-passing record.

## Result semantics

The report conclusion is intentionally fail-closed:

- `passed` means every expected component is present and reports success;
- `failed` means a command or test explicitly failed; and
- `incomplete` means required evidence was missing, cancelled, malformed, or
  contradictory, even when no explicit test failure was available.

CI publishes evidence before enforcing that conclusion. A failing test
therefore still leaves an inspectable report, while a report-generation gap
cannot be interpreted as a pass.

Python 3.11 is the canonical branch-coverage environment. Python 3.12 remains
an independent compatibility run. Coverage is compared with the most recent
available successful `main` report but is currently informational; no
percentage is represented as a scientifically justified quality threshold.
The reports distinguish executable-line coverage from branch coverage and
also preserve coverage.py's combined line-and-branch percentage. These three
metrics have different denominators and must not be treated as interchangeable.

## Audit and retention policy

Ordinary GitHub Actions evidence is retained for 90 days. Release evidence is
attached to the corresponding GitHub Release and remains available until that
release asset is deliberately removed. Organizations using Perdura in a
controlled process should mirror the release bundle, attestation, source
revision, and acceptance decision into their own immutable records system in
accordance with their retention policy.

Verify an attested artifact with:

```bash
gh attestation verify <artifact> --repo djtroyal/perdura-reliability
```

Then compare the artifact and evidence bundle against their published
SHA-256 manifests.

## Scope and limitations

The consolidated conclusion covers automated unit, backend, frontend-contract,
build, platform compatibility, scientific/model-assurance, reference-evidence,
release-environment, locally observable hardening, and scientific performance
smoke checks. CodeQL, dependency review, OSV, OpenSSF Scorecard, Trivy, OWASP
ZAP, axe, Lighthouse, and k6 remain separately controlled security/performance
records. Their results are retained but are not silently folded into the
scientific verification conclusion.

Automated evidence supports verification and audit review. It is not
regulatory certification, independent validation, proof of suitability for a
particular safety function, or proof that every requirement has complete test
coverage. The applicable organization remains responsible for requirements,
review approvals, validation in the intended use environment, change control,
risk management, and records retention.
