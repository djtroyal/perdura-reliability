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
        "contract_use": "Review project-specific tailoring and independent verification before use.",
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
    "MIL-STD-975-derating": _entry(
        edition="MIL-STD-975M / historical NASA EEE parts guidance",
        authority="NASA",
        scope="EEE parts selection, screening, qualification, and derating guidance.",
        implementation_scope="Generic three-level component stress limits labeled with a MIL-STD-975/NASA basis.",
        exclusions="Rules are not traced row-by-row to a controlled edition and are not a complete parts-program implementation.",
        tier="screening",
        clauses=["Representative derating limits; clause map pending"],
        source_title="MIL-STD-975 historical EEE parts guidance",
        source_url="https://standards.nasa.gov/",
        access="public standards catalog",
        example_note="No controlled-document example or table-parity suite has been completed.",
    ),
    "NAVSEA-derating": _entry(
        edition="NAVSEA TE000-AB-GTP-010 (edition not independently verified)",
        authority="Naval Sea Systems Command",
        scope="Navy electronic-parts derating guidance.",
        implementation_scope="Generic three-level naval derating limits.",
        exclusions="Controlled-edition provenance, clause mapping, and official table parity are incomplete.",
        tier="screening",
        clauses=["Representative derating limits; clause map pending"],
        source_title="NAVSEA parts derating guidance",
        source_url=None,
        access="controlled/source access not established",
        example_note="No authoritative worked-example or table-parity suite has been completed.",
    ),
    "ECSS-derating": _entry(
        edition="ECSS-Q-ST-30-11C (edition/date not independently verified)",
        authority="European Cooperation for Space Standardization",
        scope="Space-product EEE component derating guidance.",
        implementation_scope="Generic three-level space-grade derating limits.",
        exclusions="Clause mapping, component-specific exceptions, and official table parity are incomplete.",
        tier="screening",
        clauses=["Representative derating limits; clause map pending"],
        source_title="ECSS standards portal",
        source_url="https://ecss.nl/standards/",
        access="public standards portal",
        example_note="No authoritative worked-example or table-parity suite has been completed.",
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
    "MIL-STD-975": "MIL-STD-975-derating",
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
