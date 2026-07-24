"""Traceable conformance disclosures for standards-branded calculators.

The registry deliberately separates a document's identity from Perdura's
implementation status.  A familiar standard name is not itself a claim that
every table, rule, or worked example has been reproduced.  Consumers should
use ``conformance_tier`` and ``authoritative_example_validation`` when deciding
whether an output is suitable for screening, design trade studies, or a
contractual deliverable.
"""

from copy import deepcopy


CONFORMANCE_TIERS = {
    "verified": {
        "label": "Verified implementation",
        "meaning": (
            "Clause coverage is mapped and authoritative worked examples pass. "
            "Any exclusions are explicit."
        ),
        "contract_use": "Record project-specific tailoring and verification with the selected standard.",
    },
    "partial": {
        "label": "Partial implementation",
        "meaning": (
            "Selected equations or tables are implemented, but coverage and/or "
            "authoritative worked-example parity is incomplete."
        ),
        "contract_use": "Do not represent the result as fully standard-conforming.",
    },
    "screening": {
        "label": "Screening model",
        "meaning": (
            "The calculator uses simplified or representative factors inspired "
            "by the named source; it is not a conforming implementation."
        ),
        "contract_use": "Use for preliminary trade studies only; verify with the source method or field data.",
    },
    "custom": {
        "label": "User-defined method",
        "meaning": "Rules are supplied by the user and have no standards-conformance claim.",
        "contract_use": "Document rule provenance and obtain project approval before use.",
    },
    "unavailable": {
        "label": "Not implemented",
        "meaning": (
            "No executable calculator is provided under this source label; "
            "the profile is retained only to disclose the missing coverage."
        ),
        "contract_use": "Supply and verify the controlling source, or use a separately documented approved method.",
    },
}


def _entry(*, edition, authority, scope, implementation_scope, exclusions,
           tier, clauses, source_title, source_url, access, example_note,
           example_status="not_completed", examples_passed=0,
           examples_total=0, reviewed_on="2026-07-10"):
    return {
        "edition": edition,
        "authority": authority,
        "method_scope": scope,
        "implementation_scope": implementation_scope,
        "known_exclusions": exclusions,
        "conformance_tier": tier,
        "clause_coverage": clauses,
        "source": {
            "title": source_title,
            "url": source_url,
            "access": access,
        },
        "authoritative_example_validation": {
            "status": example_status,
            "passed": examples_passed,
            "total": examples_total,
            "note": example_note,
        },
        "reviewed_on": reviewed_on,
    }


STANDARD_DISCLOSURES = {
    "MIL-HDBK-217F": _entry(
        edition="Revision F, Notice 2 (28 February 1995)",
        authority="U.S. Department of Defense / Naval Sea Systems Command",
        scope="Part-stress electronic-equipment reliability prediction; handbook guidance, not a contractual requirement by itself.",
        implementation_scope=(
            "Every numerical part-stress model in Sections 5-23, the Section "
            "5/6/10/11 calculation aids, all 217 Appendix A parts-count rows, "
            "and all seven Appendix B CMOS mechanisms, with clause/page, "
            "factor, substitution, assumption, warning, and unit traceability."
        ),
        exclusions=(
            "No numerical model exclusions within Sections 5-23 or Appendices "
            "A-B. Sections 1-4 are narrative guidance rather than additional "
            "calculation models. Printed source conflicts and adopted "
            "interpretations are enumerated in the repository coverage matrix; "
            "project tailoring and independent design verification remain required."
        ),
        tier="verified",
        clauses=[
            "Sections 5-23: all printed part-stress models and calculation aids",
            "Appendix A: all 217 distinct generic parts-count rows",
            "Appendix B: oxide, metallization, hot-carrier, contamination, package/humidity, EOS/ESD, and miscellaneous mechanisms",
        ],
        source_title="ASSIST MIL-HDBK-217 document record",
        source_url="https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=53939",
        access="controlled local Notice 2 PDF plus public document record",
        example_note=(
            "Eight printed handbook worked examples pass, supplemented by "
            "all-row/style tests, independent Appendix B recomputation, and "
            "piecewise-boundary tests. See docs/standards/"
            "MIL-HDBK-217F-NOTICE-2-COVERAGE.md."
        ),
        example_status="passed",
        examples_passed=8,
        examples_total=8,
        reviewed_on="2026-07-11",
    ),
    "VITA-51.1": _entry(
        edition="ANSI/VITA 51.1-2013 (R2018)",
        authority="VITA Standards Organization / ANSI",
        scope="Defaults and adjustment methods used with MIL-HDBK-217F Notice 2; it is a subsidiary specification, not a revision of 217F.",
        implementation_scope=(
            "All calculation-affecting R2018 rules, standard defaults, quality "
            "exceptions, IC complexity extensions and memory mappings, MOSFET "
            "recommendations, ferrite/oscillator/MEMS mappings, BGA factors, "
            "Appendix F PTH fatigue equations, and manufacturer-data conversion "
            "methods. Narrative pedigree, disclosure, wearout, and model-mixing "
            "requirements are emitted as assumptions or warnings."
        ),
        exclusions=(
            "A/V51.1 points to external VITA 51.0 disclosure forms, VITA 51.2 "
            "wearout models, and RAC Toolkit conversion factors; those separate "
            "documents are not reproduced. MEMS hybrids have no numerical model "
            "in A/V51.1. Field/manufacturer evidence remains the analyst's input."
        ),
        tier="verified",
        clauses=[
            "2.1: all parts-stress rules, defaults, mappings, and recommendations",
            "2.2: parts-count commercial microcircuit/discrete defaults",
            "2.3: manufacturer-data conversions and mixing/disclosure safeguards",
            "Appendices C-I: pedigree controls, MOSFET/CWR rationale, PTH fatigue, MEMS example, conversion example, and wearout cautions",
        ],
        source_title="Controlled ANSI/VITA 51.1-2013 (R2018) reference",
        source_url=None,
        access="controlled local copyrighted PDF",
        example_note=(
            "Appendix G's MEMS/Appendix-A row and Appendix H's manufacturer-data "
            "conversion are reproduced, with documented source inconsistencies; "
            "rule/table boundary tests cover every numerical adjustment."
        ),
        example_status="passed",
        examples_passed=2,
        examples_total=2,
        reviewed_on="2026-07-11",
    ),
    "RADC-TR-85-91": _entry(
        edition="Final Technical Report, May 1985 (AD-A158843)",
        authority="Rome Air Development Center, U.S. Air Force Systems Command",
        scope=(
            "Component-level nonoperating failure-rate models and equations "
            "for combining operating and nonoperating exposure."
        ),
        implementation_scope=(
            "Appendix A Sections 5.2.1 through 5.2.15: reliability and "
            "service-life equations plus microelectronics, hybrids, magnetic "
            "bubble memories, discrete semiconductors, tubes, lasers, "
            "resistors, capacitors, inductive and rotating devices, relays, "
            "switches, connectors, PTH assemblies, connections, and "
            "miscellaneous parts. Every result carries report-section, page, "
            "table, equation, maturity, assumption, warning, and unit metadata."
        ),
        exclusions=(
            "Section 4.5 excludes satellite applications, so printed SF "
            "placeholder factors are rejected. Undefined exact boundaries "
            "(hybrid discriminator 12.2 and relay/switch contact voltage 50 mV) "
            "and missing family/environment table cells fail closed. The "
            "time-varying spacecraft procedure in RADC-TR-85-229 is separate."
        ),
        tier="verified",
        clauses=[
            "5.2.1: nonoperating, service-life, and combined reliability equations",
            "5.2.2-5.2.5: active electronic devices and lasers",
            "5.2.6-5.2.11: passive and electromechanical devices",
            "5.2.12-5.2.15: connectors, interconnections, and miscellaneous parts",
        ],
        source_title="RADC-TR-85-91, Impact of Nonoperating Periods on Equipment Reliability",
        source_url=None,
        access="reviewed local public-domain government report; metadata-only in Git",
        example_note=(
            "The report contains no authoritative worked-example suite. "
            "Independent equation, table, boundary, environment, dispatcher, "
            "and traceability tests cover every implemented family."
        ),
        example_status="not_applicable",
        examples_passed=0,
        examples_total=0,
        reviewed_on="2026-07-18",
    ),
    "Telcordia": _entry(
        edition="Telcordia SR-332, Issue 4 (March 2016)",
        authority="Telcordia / Ericsson",
        scope="Reliability prediction procedure for commercial telecommunications electronic equipment.",
        implementation_scope="Simplified parts-count/stress-style factors for common component families.",
        exclusions="Licensed SR-332 tables, Methods I/II/III workflow, field-data updating, and official examples are not reproduced in full.",
        tier="screening",
        clauses=["Method concepts only; licensed table and clause parity not established"],
        source_title="Telcordia SR-332 Issue 4",
        source_url="https://telecom-info.njdepot.ericsson.net/",
        access="licensed/copyrighted",
        example_note="Official worked-example parity cannot be claimed without licensed reference validation.",
    ),
    "217Plus": _entry(
        edition="217Plus:2015, Notice 1 (Quanterion/RIAC)",
        authority="Quanterion Solutions / RIAC",
        scope="System and component reliability prediction incorporating process and environmental contributors.",
        implementation_scope="Simplified component base-rate, environment, temperature, duty-cycle, and process-grade factors.",
        exclusions="The licensed handbook database, full failure-mode model, process assessment, and official examples are not reproduced.",
        tier="screening",
        clauses=["Simplified proxy; no clause-level parity claim"],
        source_title="Quanterion 217Plus resources",
        source_url="https://www.quanterion.com/",
        access="commercial/licensed",
        example_note="No authoritative 217Plus worked-example parity suite has been completed.",
    ),
    "FIDES": _entry(
        edition="FIDES Guide 2022, Edition A (English release July 2023)",
        authority="IMdR FIDES working group",
        scope="Reliability methodology for electronic components and systems using physical, mission-profile, and process factors.",
        implementation_scope="High-level physical/process factor structure for selected component families and mission phases.",
        exclusions="The complete 2022 component tables, Pi Process audit, induced-factor workflow, and FIDES LAB/ExperTool parity are not implemented.",
        tier="screening",
        clauses=["High-level model structure only; 2022 guide clause/table map pending"],
        source_title="FIDES Guide 2022 Edition A",
        source_url="https://www.fides-reliability.org/en/node/612",
        access="official guide; account may be required",
        example_note="Results have not been cross-validated against official 2022 FIDES LAB examples.",
    ),
    "NSWC": _entry(
        edition="NSWC-98/LE1 (September 1998); NSWC-11 is a later handbook revision",
        authority="Naval Surface Warfare Center, Carderock Division",
        scope="Reliability prediction procedures for mechanical equipment by component and failure mechanism.",
        implementation_scope="Selected spring, bearing, gear, seal, valve, actuator, pump, and related mechanical component models.",
        exclusions="Several modification factors are explicitly simplified; the full handbook component set and validation examples are absent.",
        tier="screening",
        clauses=["Selected component chapters 4-17; simplified modifiers are identified in source code"],
        source_title="Handbook of Reliability Prediction Procedures for Mechanical Equipment",
        source_url="https://everyspec.com/USN/NSWC/NSWC-11_RELIABILITY_HDBK_MAY2011_55322/",
        access="public secondary mirror of government handbook",
        example_note="No authoritative NSWC worked-example parity suite has been completed.",
    ),
    "EPRD-2014": _entry(
        edition="EPRD-2014",
        authority="Quanterion Solutions / RIAC",
        scope="Electronic-parts field-experience reliability data.",
        implementation_scope="Representative aggregate base rates adjusted by generic environment and quality multipliers.",
        exclusions="No licensed record-level database lookup, source-population filters, confidence bounds, or official table parity.",
        tier="screening",
        clauses=["Representative summary-rate proxy; not a record-level EPRD implementation"],
        source_title="EPRD-2014 front material",
        source_url="https://www.quanterion.com/wp-content/uploads/2015/09/Front-Material-for-PDF-Viewer-EPRD.pdf",
        access="commercial database; front material public",
        example_note="Representative rates are not validated as exact EPRD table extracts.",
    ),
    "NPRD-2023": _entry(
        edition="NPRD-2023",
        authority="Quanterion Solutions / RIAC",
        scope="Nonelectronic-parts field-experience reliability data.",
        implementation_scope="Representative aggregate base rates adjusted by generic environment and quality multipliers.",
        exclusions="No licensed record-level database lookup, source-population filters, confidence bounds, or official table parity.",
        tier="screening",
        clauses=["Representative summary-rate proxy; not a record-level NPRD implementation"],
        source_title="NPRD-2023 part descriptions",
        source_url="https://www.quanterion.com/wp-content/uploads/2023/11/NPRD-2023-Part-Descriptions.pdf",
        access="commercial database; part descriptions public",
        example_note="Representative rates are not validated as exact NPRD table extracts.",
    ),
    "MIL-STD-975M-derating": _entry(
        edition=(
            "MIL-STD-975M (5 August 1994), Appendix A, through Notice 2; "
            "canceled without replacement by Notice 3 (5 May 1998)"
        ),
        authority="NASA",
        scope=(
            "Historical EEE-parts selection, screening, qualification, and "
            "application guidance. MIL-STD-975M was canceled on 5 May 1998."
        ),
        implementation_scope=(
            "Dedicated single-level historical Appendix A rules for all 16 "
            "printed commodity sections, including style-specific tables, "
            "temperature curves, simultaneous-stress checks, winding-rise, "
            "relay, fuse, resistor, thermistor, and wire/bundle algorithms. "
            "The Appendix A.24 pulse delegation includes reviewed "
            "MIL-HDBK-978B general duties, RCR low-duty peak voltage, and "
            "established-reliability fixed-film peak voltage/power limits. "
            "Every numerical result retains a rule identifier and page locator."
        ),
        exclusions=(
            "The source itself supplies no numerical switch or standalone-"
            "crystal rule and omits fiber-optic criteria. MIL-HDBK-978B leaves "
            "irregular, high-duty, approximate-caution, and manufacturer-"
            "specific pulse judgments without a generic acceptance equation; "
            "those paths remain not evaluated unless their explicit review "
            "duty is completed. Several other edge cases likewise require "
            "manufacturer or project engineering data. "
            "This canceled profile is not current NASA practice."
        ),
        tier="verified",
        clauses=[
            "Appendix A 1.0-3.0 governing semantics",
            "Appendix A 3.1-3.16, printed A.4-A.37",
            "MIL-HDBK-978B Volume I 3.1.6.2, 3.2.5.2, and 3.3.5.3",
            "Notices 1-3 document-status and change-impact review",
        ],
        source_title="DLA ASSIST record for canceled MIL-STD-975",
        source_url="https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=36072",
        access=(
            "reviewed local public-source MIL-STD-975M scans plus a pinned "
            "reviewed public MIL-HDBK-978B copy and official document record"
        ),
        example_note=(
            "All Appendix A worked examples with executable numerical content "
            "are locked as regression oracles; the source's small inductor "
            "arithmetic discrepancy is disclosed and the governing formula is used."
        ),
        example_status="passed",
        examples_passed=16,
        examples_total=16,
        reviewed_on="2026-07-18",
    ),
    "RADC-TR-84-254-derating": _entry(
        edition="RADC-TR-84-254 / ADA153744, Final Technical Report (December 1984)",
        authority="Rome Air Development Center",
        scope="Historical advanced-device derating research and proposed military-standard framework.",
        implementation_scope=(
            "Exact manual Level I/II/III evaluation of advanced-device Tables "
            "1-9 and the unambiguous branches of Table 10, with source locators "
            "and the explicit quality, technology, transient, thermal, ESD, "
            "constituent, and support-device application controls in §§2.1-2.6."
        ),
        exclusions=(
            "This contractor report was not a promulgated standard. Established "
            "parts and hybrid constituents still depend on AFSC Pamphlet 800-27 "
            "and RADC-TR-82-177. The ambiguous Table 10 unit and exact 500 MHz "
            "boundary fail closed. Thermal research models are not used for a "
            "derating acceptance decision."
        ),
        tier="partial",
        clauses=["Sections 2.1-2.6, Tables 1-10"],
        source_title="RADC-TR-84-254, Reliability Derating Procedures",
        source_url="https://apps.dtic.mil/sti/citations/ADA153744",
        access="reviewed local public-source scan",
        example_note=(
            "All table cells and boundaries are covered by a separate, "
            "document-hashed source oracle; application-prose obligations have "
            "boundary and missing-input tests. The report does not supply ten "
            "authoritative worked examples."
        ),
        reviewed_on="2026-07-18",
    ),
    "RL-TR-92-11-derating": _entry(
        edition="RL-TR-92-11 / ADA253334, Final Technical Report (February 1992)",
        authority="Rome Laboratory",
        scope=(
            "Historical advanced-technology component-derating research and "
            "final criticality-level criteria."
        ),
        implementation_scope=(
            "Dedicated manual Level I/II/III evaluation of every directly "
            "executable final criterion in Tables 4-7, 4-11, 4-15, 5-3, "
            "6-4, 6-7, 6-9, 7-3, 8-2, 9-2, and 10-2, with row-level source "
            "locators, formulas, substitutions, and the explicit application "
            "obligations on report pp. 87, 96, 117, 126, 130, 134, and 135. "
            "The report p. 134 MIL-STD-198E capacitor cross-reference is "
            "expanded into granular, source-located advisory coverage checks "
            "without mislabeling nonmandatory guidance as a hard limit."
        ),
        exclusions=(
            "This final technical report was not a promulgated military "
            "standard. Intermediate reliability-model derivations and "
            "Appendix B software are not acceptance rules and are not "
            "automated. Supplier limits, power-device SOA, thermal cycling, "
            "the Figure 4-34 low-temperature/duration ambiguity, documented RF "
            "voltage/power exceptions, the contradictory MOS-linear >10,000 "
            "transistor row, SAW at exactly 500 MHz, and hybrid deposited-film "
            "resistors remain not "
            "evaluated unless a cited source supplies an unambiguous rule."
        ),
        tier="partial",
        clauses=[
            "Tables 4-7, 4-11, 4-15, and 5-3",
            "Tables 6-4, 6-7, 6-9, and 7-3",
            "Tables 8-2, 9-2, and 10-2",
            "Application notes, report pp. 87, 96, 117, 126, 130, 134-135",
            "MIL-STD-198E foreword, §6.5, §703.1, §903.1, and Notices 1-3",
        ],
        source_title="RL-TR-92-11, Advanced Technology Component Derating",
        source_url="https://apps.dtic.mil/sti/citations/ADA253334",
        access=(
            "reviewed local RL-TR-92-11 public-source scan plus reviewed, "
            "metadata-only official/public MIL-STD-198E base and Notices 1-3"
        ),
        example_note=(
            "Every transcribed final-table cell is compared with a separate "
            "document-hashed oracle fixture, and application-note boundaries "
            "known ambiguous/delegated cases, and imported capacitor-advisory "
            "coverage have regression tests; the report does not "
            "provide a complete set of authoritative worked examples."
        ),
        reviewed_on="2026-07-18",
    ),
    "NAVSEA-derating": _entry(
        edition=(
            "Unavailable built-in profile; former label referenced "
            "NAVSEA TE000-AB-GTP-010 without pinning the September 1985 "
            "lineage issue or March 1999 Revision 2"
        ),
        authority="Naval Sea Systems Command",
        scope="Navy electronic-parts derating guidance.",
        implementation_scope=(
            "No TE000-AB-GTP-010 rulebook is implemented. The former synthetic "
            "three-level table was withdrawn because it had no clause or row "
            "provenance."
        ),
        exclusions=(
            "All TE000-AB-GTP-010 requirements and revision-specific limits "
            "are unavailable. NAVSEA's public SD-18 material is a separate, "
            "technology-specific source and does not validate the withdrawn "
            "table."
        ),
        tier="unavailable",
        clauses=["No implemented clauses or tables; former profile withdrawn"],
        source_title="NAVSEA SD-18 parts guidance portal",
        source_url=(
            "https://www.navsea.navy.mil/Home/Warfare-Centers/"
            "NSWC-Crane/Resources/SD-18/"
        ),
        access=(
            "public official companion guidance; neither the September 1985 "
            "lineage source nor March 1999 Revision 2 has been supplied locally"
        ),
        example_note=(
            "No calculation is available under this label and no controlled "
            "table-parity suite has been completed."
        ),
        reviewed_on="2026-07-18",
    ),
    "ECSS-derating": _entry(
        edition=(
            "Unavailable built-in profile; target source is "
            "ECSS-Q-ST-30-11C Rev.2 (23 June 2021)"
        ),
        authority="European Cooperation for Space Standardization",
        scope="Space-product EEE component derating guidance.",
        implementation_scope=(
            "No ECSS derating rulebook is implemented. The former synthetic "
            "three-level table was withdrawn because ECSS Rev.2 instead uses "
            "technology- and application-specific requirements."
        ),
        exclusions=(
            "All Rev.2 load-ratio tables, temperature and mission-duration "
            "conditions, transients, exceptions, notes, and tailoring rules "
            "are unavailable until they are mapped and validated row-by-row."
        ),
        tier="unavailable",
        clauses=["No implemented clauses or tables; former profile withdrawn"],
        source_title="ECSS-Q-ST-30-11C Rev.2 official standard record",
        source_url=(
            "https://ecss.nl/standard/ecss-q-st-30-11c-rev-2-"
            "derating-eee-components-23-june-2021/"
        ),
        access=(
            "public official source; source is not stored locally and has not "
            "been transcribed into Perdura"
        ),
        example_note=(
            "No calculation is available under this label and no controlled "
            "table-parity suite has been completed."
        ),
        reviewed_on="2026-07-18",
    ),
    "Custom-derating": _entry(
        edition="User supplied",
        authority="User",
        scope="Project-specific derating rules.",
        implementation_scope="Applies the supplied threshold table.",
        exclusions="No external standards-conformance claim.",
        tier="custom",
        clauses=["User-defined"],
        source_title="User-provided rule set",
        source_url=None,
        access="project record",
        example_note="Validation is the user's responsibility.",
    ),
}


DERATING_DISCLOSURE_IDS = {
    "MIL-STD-975M": "MIL-STD-975M-derating",
    "RADC-TR-84-254": "RADC-TR-84-254-derating",
    "RL-TR-92-11": "RL-TR-92-11-derating",
    "NAVSEA": "NAVSEA-derating",
    "ECSS": "ECSS-derating",
    "Custom": "Custom-derating",
}


def get_standard_disclosure(standard_id: str) -> dict:
    """Return a detached disclosure with its human-readable tier definition."""
    if standard_id not in STANDARD_DISCLOSURES:
        raise KeyError(f"No conformance disclosure registered for '{standard_id}'.")
    result = deepcopy(STANDARD_DISCLOSURES[standard_id])
    result["standard_id"] = standard_id
    result["tier_definition"] = deepcopy(CONFORMANCE_TIERS[result["conformance_tier"]])
    result["full_conformance_claimed"] = result["conformance_tier"] == "verified"
    return result


def get_derating_disclosure(standard_id: str) -> dict:
    return get_standard_disclosure(DERATING_DISCLOSURE_IDS[standard_id])


def list_standard_disclosures() -> dict:
    return {key: get_standard_disclosure(key) for key in STANDARD_DISCLOSURES}
