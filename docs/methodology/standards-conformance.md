# Standards conformance and evidence tiers

Perdura treats a standards-branded calculator name as provenance, not as an automatic conformance claim. Every Prediction result includes a machine-readable `methodology` disclosure with the controlled edition, authority, intended scope, implemented scope, known exclusions, clause coverage, worked-example validation status, and one of these badges:

| Tier | Meaning | Permitted claim |
|---|---|---|
| Verified implementation | Clause coverage is mapped and authoritative worked examples pass. | May be described as verified only within the stated scope and exclusions. |
| Partial implementation | Selected equations or tables are implemented, but coverage or authoritative example parity is incomplete. | Must not be described as fully conforming. |
| Screening model | Simplified or representative factors are inspired by the named source. | Preliminary estimates and trade studies only. |
| User-defined method | The rule set is supplied by the user. | No external conformance claim. |

## Current prediction-method status

| Method | Edition represented | Tier | Authoritative worked-example parity | Principal limitation |
|---|---|---|---|---|
| MIL-HDBK-217F | Revision F, Notice 2 (28 February 1995) | Partial | Not completed | Broad Sections 5–23 mapping exists, but selected categories/tables are simplified and full page-level parity is not certified. |
| ANSI/VITA 51.1 | 2013, stabilized 2025 | Partial | Not completed | Only selected quality-factor and learning-factor adjustments are implemented. |
| Telcordia SR-332 | Issue 4 (March 2016) | Screening | Not completed | Licensed tables and the complete Methods I/II/III workflows are not reproduced. |
| 217Plus | 2015 Notice 1 | Screening | Not completed | Uses a simplified proxy rather than the licensed failure-mode and process model. |
| FIDES | Guide 2022 Edition A | Screening | Not completed | Does not reproduce the full component tables, Pi Process audit, or official tool workflow. |
| NSWC mechanical | NSWC-98/LE1 basis | Screening | Not completed | Selected component models and several simplified modifiers only. |
| EPRD-2014 | 2014 | Screening | Not completed | Representative averages, not licensed record-level database queries. |
| NPRD-2023 | 2023 | Screening | Not completed | Representative averages, not licensed record-level database queries. |

The derating rulebooks labeled MIL-STD-975/NASA, NAVSEA, and ECSS are also screening models until their limits are traced row-by-row to a controlled edition and pass an authoritative table/example suite.

## Sources and review rule

- MIL-HDBK-217F identity and revision status: DLA ASSIST document record.
- ANSI/VITA 51.1 identity and scope: official VITA Standards catalog and Reliability Community FAQ.
- FIDES identity and edition: official FIDES Guide portal.
- Commercial Telcordia, 217Plus, EPRD, and NPRD material requires licensed-source validation before a stronger badge is possible.

A tier may be promoted to **Verified implementation** only when the repository records: (1) controlled edition and clause/table mapping, (2) all exclusions, (3) authoritative worked examples with expected values and tolerances, and (4) passing automated parity tests. Ordinary unit tests or agreement with internally generated examples do not count as authoritative parity.
