# Artifact provenance and verification

Perdura can package every downloaded project, report, plot, diagram, table, or
model artifact with a machine-readable provenance manifest. Enable **Export →
Verification package**. The browser downloads one `*.perdura.zip` containing:

1. the artifact in its original format; and
2. `<artifact-name>.perdura.json`, conforming to
   [`artifact-manifest.schema.json`](artifact-manifest.schema.json).

The manifest records the exact artifact byte length and SHA-256 digest, a stable
artifact ID, the project's UUID and optional controlled identity fields, the
Perdura version/commit/build evidence link, and the latest completed analysis
fingerprints relevant to the export. Project files also retain the bounded
analysis-run and export ledgers.

## Assurance claim

This is **checksum integrity and traceability**, not producer authentication.
Anyone who can alter an artifact can also generate a new checksum. The manifest
therefore always declares `authenticityEstablished: false`; regulatory use must
not describe it as a digital signature. A future signing profile can add
authenticity without changing this checksum-only claim.

Release builds link their source commit to the consolidated CI verification
report and record that report's SHA-256. Development builds are labeled as such.
An inconsistent frontend/backend build identity blocks verified packaging.

## Verification

In the application, choose **Export → Provenance & verify…** and select the
`*.perdura.zip` file. Perdura reports integrity, traceability, and authenticity
as separate properties.

The dependency-free command-line verifier is suitable for archived evidence or
independent review:

```text
python tools/verify_perdura_artifact.py result.pdf.perdura.zip
python tools/verify_perdura_artifact.py result.pdf result.pdf.perdura.json --json
```

Exit status is `0` for a valid package, `1` for an integrity/manifest failure,
and `2` for an unreadable or malformed package. Use `--verification-report`
with a downloaded CI `verification-report.json` to cross-check the report digest
declared by a release build.

## Analysis fingerprints

When a calculation replaces a result, Perdura records SHA-256 hashes over
canonical JSON representations of its inputs and results, together with the
calculation-engine revision. Closely spaced result writes are coalesced into one
completed run. The export manifest links to the latest run for each included
analysis and indicates whether its stored input fingerprint is current.

Canonicalization recursively sorts object keys, normalizes negative zero, rejects
non-finite numbers and cycles, and represents typed arrays as byte arrays. This
provides deterministic hashes for Perdura's JSON-safe analysis state; it does not
claim conformance for arbitrary non-JSON JavaScript values.

## Operational notes

- Keep the complete ZIP; extracting and renaming files does not change the
  artifact hash, but separating the sidecar makes later review less convenient.
- Record controlled project identity before the final export.
- Preserve the linked CI verification report with regulated submissions when
  practical, because hosted workflow artifacts can have finite retention.
- Re-export after changing analysis inputs. A manifest can identify an older run
  as non-current even when its artifact bytes remain intact.
