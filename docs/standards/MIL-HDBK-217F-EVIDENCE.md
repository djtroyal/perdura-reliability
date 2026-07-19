# MIL-HDBK-217F source evidence and lineage

This page describes the evidence available for Perdura's MIL-HDBK-217F
implementation. The machine-readable source of truth is the
[evidence catalog](mil-hdbk-217f-evidence.json); its structure is defined by the
[catalog schema](mil-hdbk-217f-evidence.schema.json).

## Current status

| Dimension | Status | Meaning |
|---|---|---|
| Handbook conformance | Verified handbook transcription with disclosed repairs | Calculation parity is scoped to the controlled MIL-HDBK-217F Notice 2 text and does not establish empirical accuracy. |
| Implementation assurance | Verified | The identified mathematical and traceability findings have been remediated and their independent source, boundary, integration, and provenance gates pass. |
| Historical lineage evidence | Partial: **12/38** | Twelve distinct Appendix C technical-basis sources are locally available or pinned to reviewed public copies. Duplicate scans count once. |

These dimensions are intentionally independent. A missing antecedent report
reduces lineage evidence but does not invalidate an unambiguous equation printed
in the governing handbook. A known implementation defect affects assurance even
when the historical source is available.

## Evidence precedence

When sources disagree, Perdura uses this order:

1. The controlled MIL-HDBK-217F Notice 2 text and an enabled ANSI/VITA 51.1 rule.
2. A contemporaneous normative standard referenced by the governing text.
3. A primary Appendix C technical-basis report.
4. A separately labeled primary government-report extension.
5. A later standard, general handbook, toolkit, excerpt, or vendor reference as contextual evidence only.

Later context can reveal ambiguity or terminology drift, but it cannot silently
change a factor printed by the governing edition.

## Appendix C coverage

The available unique sources are:

| Ref. | Technical report | Principal relevance |
|---:|---|---|
| 5 | RADC-TR-77-417 | Cyclic relay, switch, and connector rates |
| 11 | RADC-TR-80-299 | Environmental factors |
| 13 | RADC-TR-80-237 | Magnetic-bubble and charge-coupled memories |
| 15 | RADC-TR-81-318 | Printed wiring and interconnections |
| 17 | RADC-TR-82-172 | Thermal analysis |
| 18 | RADC-TR-83-108 | Critical electronic devices |
| 19 | RADC-TR-85-91 | Nonoperating failure-rate models |
| 21 | RADC-TR-85-229 | Spacecraft-specific prediction procedures |
| 23 | RADC-TR-86-97 | JAN microcircuit package thermal resistance |
| 28 | RADC-TR-88-97 | Discrete semiconductor models |
| 32 | RADC-TR-90-72 | Advanced microcircuit technologies |

The remaining 27 entries are `identified_unavailable`. They remain visible in
the catalog with their handbook identity and applicability so that a future
source can be added without changing the denominator or losing review history.

### Identity findings

- Appendix C entry 30 prints `RADC-TR-89-171` with accession `ADA214601`.
  The accession and actual VHSIC report resolve to **RADC-TR-89-177**. The
  locally supplied `RADC-TR-89-171` is the unrelated Reliability Engineer's
  Toolkit (`ADA215977`) and does not count as Appendix C coverage.
- Entry 21 prints accession `ADA149551`; the reviewed RADC-TR-85-229 report is
  accession `ADA164747`. The report-number and title match, and the conflict is
  retained rather than silently replacing the handbook text.
- Two scans of RADC-TR-83-108 and two scans of RADC-TR-90-72 each count as one
  unique technical source.
- The one-page “SMT Assessment Model” excerpt is not RL-TR-92-197 and does not
  count as acquisition of Appendix C entry 37.

## Newly supplied contextual standards

The five `MIL-STD-883-1` through `MIL-STD-883-5` files form the 16 September
2019 baseline set:

- environmental methods 1000–1999;
- mechanical methods 2000–2999;
- digital electrical tests 3000–3999;
- linear electrical tests 4000–4999; and
- procedures 5000–5999.

They are useful current method and screening context, but they postdate the
governing 1995 Notice 2 by 24 years. `MIL-STD-883L Change 1` (27 June 2025) is
even later and is retained only for modern terminology context. In particular,
modern Classes B and S do not redefine the handbook's historical `B-1`
screening bucket.

MIL-HDBK-338B is guidance-only secondary context. It supports sound
service-life interpretation but is not an Appendix C derivation source.

RADC-TR-85-91 is the primary source for Perdura's separately identified
nonoperating extension. Its factors retain the report's preliminary,
theoretical, and extrapolation caveats; the extension is not represented as
MIL-HDBK-217F calculation content. The full equations, source interpretations,
exact Prediction mapping policy, service-life integration, and fail-closed
boundaries are documented in the
[RADC-TR-85-91 nonoperating reliability methodology](../methodology/radc-tr-85-91-nonoperating.md).

## Metadata-only reference policy

New reference PDFs are reviewed locally but are not committed. Only the two
controlled PDFs that predate this policy remain in Git:

- `MIL-HDBK-217F-Notice2.pdf`
- `AV51DOT1-2013-R2018.pdf`

The catalog commits filenames, cryptographic hashes, identities, review status,
findings, and redistribution classifications. Missing local-only PDFs do not
break a fresh checkout; if one is present, its hash is verified. CI fails if a
new PDF is tracked or the controlled allowlist changes without updating the
policy explicitly.

Run the guard locally with:

```bash
python tools/check_reference_evidence.py
```

The validator checks the ordered 38-entry bibliography, derives the 12/38
coverage value, detects duplicate IDs and files, verifies local hashes, locks
known source corrections, and compares Git's tracked PDFs with the allowlist.
