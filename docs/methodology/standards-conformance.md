# Standards conformance and evidence tiers

Perdura treats a standards-branded calculator name as provenance, not as an automatic conformance claim. Every Prediction result includes a machine-readable `methodology` disclosure with the controlled edition, authority, intended scope, implemented scope, known exclusions, clause coverage, worked-example validation status, and one of these badges:

Implementation conformance, current calculation assurance, and historical
source-lineage coverage are reported separately. The current MIL-HDBK-217F
lineage inventory and its metadata-only source policy are documented in
[MIL-HDBK-217F source evidence](../standards/MIL-HDBK-217F-EVIDENCE.md).

| Tier | Meaning | Permitted claim |
|---|---|---|
| Verified implementation | Clause coverage is mapped and authoritative worked examples pass. | May be described as verified only within the stated scope and exclusions. |
| Partial implementation | Selected equations or tables are implemented, but coverage or authoritative example parity is incomplete. | Must not be described as fully conforming. |
| Screening model | Simplified or representative factors are inspired by the named source. | Preliminary estimates and trade studies only. |
| User-defined method | The rule set is supplied by the user. | No external conformance claim. |
| Not implemented | No executable calculator exists under the source label. | No calculation or standards claim; supply and verify the controlling source first. |

## Current prediction-method status

| Method | Edition represented | Tier | Authoritative worked-example parity | Principal limitation |
|---|---|---|---|---|
| MIL-HDBK-217F | Revision F, Notice 2 (28 February 1995) | Verified | 8/8 printed examples pass | All numerical models in Sections 5–23, all 217 Appendix A rows, and all Appendix B mechanisms are mapped; source conflicts and interpretations remain explicitly disclosed. |
| ANSI/VITA 51.1 | 2013 (R2018) | Verified | 2/2 printed numerical examples pass | All calculation-affecting rules, defaults, mappings, IC extensions, manufacturer conversions, and Appendix F equations are implemented; referenced VITA 51.0/51.2 and RAC methods remain separate external methods. |
| RADC-TR-85-91 | Final Technical Report, May 1985 | Verified | N/A — source has no worked-example suite | Appendix A §§5.2.1–5.2.15 are implemented with equation/table oracles and fail-closed source gaps; satellite use is expressly excluded and the model remains a separately disclosed nonoperating extension. |
| Telcordia SR-332 | Issue 4 (March 2016) | Screening | Not completed | Licensed tables and the complete Methods I/II/III workflows are not reproduced. |
| 217Plus | 2015 Notice 1 | Screening | Not completed | Uses a simplified proxy rather than the licensed failure-mode and process model. |
| FIDES | Guide 2022 Edition A | Screening | Not completed | Does not reproduce the full component tables, Pi Process audit, or official tool workflow. |
| NSWC mechanical | NSWC-98/LE1 basis | Screening | Not completed | Selected component models and several simplified modifiers only. |
| EPRD-2014 | 2014 | Screening | Not completed | Representative averages, not licensed record-level database queries. |
| NPRD-2023 | 2023 | Screening | Not completed | Representative averages, not licensed record-level database queries. |

## Derating-method status

The former generic presets labeled MIL-STD-975/NASA, NAVSEA, and ECSS were
withdrawn because they were synthetic three-level tables rather than
transcriptions of the named sources. No compatibility alias maps the old
`MIL-STD-975` selector to Revision M. The replacement methods below retain
their own input bags, level semantics, applicability rules, source locators,
and unresolved cases; values are never inherited across profiles.

| Selector | Source and level semantics | Executable coverage | Mandatory fail-closed boundaries |
|---|---|---|---|
| MIL-STD-975M Appendix A (historical) | Canceled NASA military standard, 5 August 1994; one rule set, no Levels I-III | All 16 Appendix A commodity sections, including exact tables, piecewise curves, simultaneous stresses, winding-rise, relay/fuse/thermistor, and wire-bundle algorithms; reviewed MIL-HDBK-978B general/RCR/fixed-film pulse duties and limits implement the Appendix A.24 delegation | Switches and standalone crystals have no numerical rule; fiber optics are outside Appendix A; irregular, high-duty, approximate-caution, manufacturer-specific, and several other vendor/project-engineer cases remain not evaluated |
| RADC-TR-84-254 (historical report) | December 1984 proposed framework, not an issued standard; Level I/II/III is a manual criticality decision | Exact advanced-device Tables 1-10; thermal research models are excluded from acceptance decisions | Established/constituent part dependencies remain explicit; Table 10's `dB` unit and exactly 500 MHz branch are unresolved |
| RL-TR-92-11 (historical report) | February 1992 extension guidance, not an issued standard; Level I/II/III is manual | Direct final criteria for ASIC/VHSIC, microprocessors, PROM, MIMIC, power/RF devices, optoelectronics, chip passives, and SAW; the MIL-STD-198E chip-capacitor cross-reference is resolved into source-located advisory coverage checks while RL's 60% AC-plus-DC rule remains mandatory | MOS-linear complexity contradiction, exactly 500 MHz, supplier limits, SOA/thermal-curve verification, and unsupported hybrid deposited-film resistors |
| NAVSEA | Unavailable; TE000-AB-GTP-010 not implemented | None | Requires an edition-pinned copy (the September 1985 RL lineage source and/or a separately labeled March 1999 Rev. 2), a complete clause/row map, and table-oracle tests; public SD-18 is separate |
| ECSS | Unavailable; ECSS-Q-ST-30-11C Rev.2 not implemented | None | Requires complete Rev.2 conditional technology, temperature, duration, transient, exception, and tailoring logic |
| Custom | User-defined three-level maximum rules | Supplied project rulebook only | Project provenance, units, applicability, approval, and validation remain the user's responsibility |

The local Rome Laboratory Reliability Engineer's Toolkit and MIL-HDBK-338B
remain historical cross-checks; they are not silently treated as any enabled
profile. The findings, public-source inventory, exact documents still
requested, and promotion gates are recorded in the
[derating standards audit](derating-standards-audit.md).

## Sources and review rule

- MIL-HDBK-217F identity and revision status: controlled local Notice 2 PDF and DLA ASSIST document record. The clause matrix and evidence are in [MIL-HDBK-217F Notice 2 implementation coverage](../standards/MIL-HDBK-217F-NOTICE-2-COVERAGE.md).
- ANSI/VITA 51.1 identity and scope: controlled local R2018 PDF. The equations, rule map, source repairs, and evidence are documented in [MIL-HDBK-217F Notice 2 and ANSI/VITA 51.1 methodology](mil-hdbk-217f-vita-51-1.md).
- RADC-TR-85-91 identity and scope: reviewed local government report AD-A158843, retained metadata-only. Its equations, mapping policy, source interpretations, service-life integration, and limitations are documented in the [RADC-TR-85-91 nonoperating reliability methodology](radc-tr-85-91-nonoperating.md); its role and lineage are recorded in the [MIL-HDBK-217F source evidence catalog](../standards/MIL-HDBK-217F-EVIDENCE.md).
- Historical operational derating: reviewed local MIL-STD-975M with Notices 1-3, RADC-TR-84-254/ADA153744, and RL-TR-92-11/ADA253334, plus pinned reviewed public MIL-HDBK-978B Volume I and MIL-STD-198E base/notice copies for the Appendix A.24 resistor and RL chip-capacitor delegations. Their identities, hashes, rule boundaries, source defects, missing lineage, and remaining requests are recorded in the [derating standards audit](derating-standards-audit.md) and evidence catalog.
- FIDES identity and edition: official FIDES Guide portal.
- Commercial Telcordia, 217Plus, EPRD, and NPRD material requires licensed-source validation before a stronger badge is possible.

A tier may be promoted to **Verified implementation** only when the repository records: (1) controlled edition and clause/table mapping, (2) all exclusions, (3) authoritative worked examples with expected values and tolerances when the source provides them, or independent equation/table oracles when it does not, and (4) passing automated parity tests. Ordinary unit tests or agreement with internally generated examples do not count as authoritative parity.
