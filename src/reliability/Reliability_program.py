"""Reliability-program workflow calculations and integrity checks.

The objects here support FMEA/FMECA, MIL-STD-882E-style hazard risk,
FRACAS, requirement traceability, testability, and RCM records. Ordinal
products such as RPN are explicitly screening aids, not calibrated risk.
"""

from __future__ import annotations

from collections import Counter
import math
from typing import Iterable

from scipy.stats import chi2

from reliability.AIAG_VDA_FMEA import analyze_aiag_vda_fmea


# MIL-STD-882E Table III risk assessment matrix. Tuple is (risk index, level).
_HAZARD_MATRIX = {
    "A": {"I": (1, "high"), "II": (3, "high"), "III": (7, "serious"), "IV": (13, "medium")},
    "B": {"I": (2, "high"), "II": (5, "high"), "III": (9, "serious"), "IV": (16, "medium")},
    "C": {"I": (4, "high"), "II": (6, "serious"), "III": (11, "medium"), "IV": (18, "low")},
    "D": {"I": (8, "serious"), "II": (10, "medium"), "III": (14, "medium"), "IV": (19, "low")},
    "E": {"I": (12, "medium"), "II": (15, "medium"), "III": (17, "low"), "IV": (20, "low")},
    "F": {"I": (0, "eliminated"), "II": (0, "eliminated"), "III": (0, "eliminated"), "IV": (0, "eliminated")},
}


def _risk(probability: str, severity: str) -> dict:
    probability = str(probability).upper()
    severity = str(severity).upper()
    if probability not in _HAZARD_MATRIX or severity not in _HAZARD_MATRIX[probability]:
        raise ValueError("Hazard probability must be A–F and severity must be I–IV.")
    index, level = _HAZARD_MATRIX[probability][severity]
    return {"probability": probability, "severity": severity,
            "risk_index": index, "risk_level": level}


def analyze_fmea(rows: Iterable[dict], *, medium_rpn: int = 100,
                 high_rpn: int = 200) -> dict:
    if not 0 < medium_rpn < high_rpn:
        raise ValueError("FMEA RPN thresholds must satisfy 0 < medium < high.")
    output = []
    for raw in rows:
        severity = int(raw["severity"])
        occurrence = int(raw["occurrence"])
        detection = int(raw["detection"])
        if any(not 1 <= value <= 10 for value in (severity, occurrence, detection)):
            raise ValueError("FMEA severity, occurrence, and detection must be integers from 1 to 10.")
        rpn = severity * occurrence * detection
        band = "high" if rpn >= high_rpn else "medium" if rpn >= medium_rpn else "low"
        if severity >= 9 and band != "high":
            band = "severity_override"
        rate = raw.get("failure_rate")
        ratio = raw.get("mode_ratio")
        effect = raw.get("effect_probability")
        mission = raw.get("mission_time")
        criticality = None
        if any(value is not None for value in (rate, ratio, effect, mission)):
            if any(value is None for value in (rate, ratio, effect, mission)):
                raise ValueError(
                    "FMECA criticality requires failure_rate, mode_ratio, "
                    "effect_probability, and mission_time together.")
            rate, ratio, effect, mission = map(float, (rate, ratio, effect, mission))
            if (not all(math.isfinite(value) for value in (rate, ratio, effect, mission))
                    or rate < 0 or not 0 <= ratio <= 1
                    or not 0 <= effect <= 1 or mission <= 0):
                raise ValueError(
                    "FMECA criticality requires finite rate >= 0, mode ratio and "
                    "effect probability in [0, 1], and mission time > 0.")
            criticality = rate * ratio * effect * mission
        output.append({**raw, "rpn": rpn, "screening_band": band,
                       "mode_criticality": criticality})
    ordered = sorted(output, key=lambda row: (-row["severity"], -row["rpn"], str(row.get("id", ""))))
    return {
        "rows": output,
        "ranked_ids": [row.get("id") for row in ordered],
        "summary": {
            "total": len(output),
            "open_actions": sum(str(row.get("action_status", "open")).lower() not in {"closed", "verified"} for row in output),
            "high_or_severity_override": sum(row["screening_band"] in {"high", "severity_override"} for row in output),
            "criticality_available": sum(row["mode_criticality"] is not None for row in output),
            "total_mode_criticality": sum(
                row["mode_criticality"] or 0.0 for row in output),
        },
        "rpn_policy": {
            "method": "ordinal_product_screening",
            "medium_threshold": medium_rpn, "high_threshold": high_rpn,
            "severity_override": "severity >= 9",
            "warning": "RPN ranks records from ordinal inputs; use consequence and evidence fields for risk decisions.",
        },
    }


def analyze_hazards(rows: Iterable[dict]) -> dict:
    output = []
    for raw in rows:
        initial = _risk(raw["initial_probability"], raw["initial_severity"])
        residual = _risk(raw["residual_probability"], raw["residual_severity"])
        worsened = (residual["risk_index"] != 0 and initial["risk_index"] != 0
                    and residual["risk_index"] < initial["risk_index"])
        output.append({**raw, "initial_risk": initial, "residual_risk": residual,
                       "risk_reduced": residual["risk_index"] == 0
                       or (initial["risk_index"] != 0 and residual["risk_index"] > initial["risk_index"]),
                       "risk_worsened": worsened})
    return {
        "rows": output,
        "summary": {
            "total": len(output),
            "initial_high_or_serious": sum(row["initial_risk"]["risk_level"] in {"high", "serious"} for row in output),
            "residual_high_or_serious": sum(row["residual_risk"]["risk_level"] in {"high", "serious"} for row in output),
            "unaccepted": sum(str(row.get("acceptance_status", "pending")).lower() not in {"accepted", "closed"} for row in output),
            "worsened": sum(row["risk_worsened"] for row in output),
        },
        "method": "MIL-STD-882E Table III risk assessment matrix",
        "warning": "Risk index is an ordinal matrix category. Record the supporting evidence and acceptance authority with the decision.",
    }


def analyze_fracas(rows: Iterable[dict], *, total_exposure: float | None = None,
                   CI: float = 0.95) -> dict:
    records = list(rows)
    if not 0 < CI < 1:
        raise ValueError("FRACAS confidence must be strictly between 0 and 1.")
    count = len(records)
    open_count = sum(str(row.get("status", "open")).lower() not in {"closed", "verified"} for row in records)
    verified = sum(bool(row.get("effectiveness_verified", False)) for row in records)
    recurrence = sum(bool(row.get("recurrence", False)) for row in records)
    modes = Counter(str(row.get("failure_mode", "Unspecified")).strip() or "Unspecified" for row in records)
    systems = Counter(str(row.get("system", "Unspecified")).strip() or "Unspecified" for row in records)
    rate = mtbf = lower = upper = None
    if total_exposure is not None:
        exposure = float(total_exposure)
        if not math.isfinite(exposure) or exposure <= 0:
            raise ValueError("FRACAS total_exposure must be positive and finite.")
        rate = count / exposure
        mtbf = exposure / count if count else None
        tail = (1.0 - CI) / 2.0
        lower = 0.0 if count == 0 else float(0.5 * chi2.ppf(tail, 2 * count) / exposure)
        upper = float(0.5 * chi2.ppf(1.0 - tail, 2 * (count + 1)) / exposure)
    return {
        "summary": {
            "records": count, "open": open_count, "closed": count - open_count,
            "effectiveness_verified": verified, "recurrences": recurrence,
            "closure_fraction": (count - open_count) / count if count else None,
            "verification_fraction": verified / count if count else None,
            "total_downtime": sum(float(row.get("downtime", 0) or 0) for row in records),
        },
        "exposure_metrics": {
            "total_exposure": total_exposure, "event_rate": rate, "mtbf": mtbf,
            "rate_lower": lower, "rate_upper": upper, "confidence_level": CI,
        },
        "pareto_failure_modes": [{"name": key, "count": value} for key, value in modes.most_common()],
        "pareto_systems": [{"name": key, "count": value} for key, value in systems.most_common()],
        "warning": "FRACAS rate uses the supplied aggregate exposure. Interpret changes alongside reporting and detection practices.",
    }


def analyze_requirements(rows: Iterable[dict]) -> dict:
    records = list(rows)
    required = (
        "id", "statement", "measure", "target", "confidence",
        "mission_profile", "failure_definition", "verification_method", "owner",
    )
    detail = []
    for row in records:
        missing = [field for field in required if str(row.get(field, "")).strip() == ""]
        evidence = row.get("evidence_ids", []) or []
        status = str(row.get("status", "draft")).lower()
        detail.append({"id": row.get("id"), "missing_fields": missing,
                       "evidence_count": len(evidence), "status": status,
                       "verification_ready": not missing and bool(evidence)
                       and status in {"verified", "accepted"}})
    return {
        "rows": detail,
        "summary": {
            "total": len(records),
            "complete_definitions": sum(not row["missing_fields"] for row in detail),
            "with_evidence": sum(row["evidence_count"] > 0 for row in detail),
            "verification_ready": sum(row["verification_ready"] for row in detail),
        },
        "warning": "Traceability measures record completeness; assess evidence quality and acceptance in the linked review.",
    }


def analyze_testability(faults: Iterable[dict], *, isolation_threshold: int = 1) -> dict:
    records = list(faults)
    if isolation_threshold < 1:
        raise ValueError("isolation_threshold must be at least 1.")
    weights = [float(row.get("weight", 0)) for row in records]
    ambiguities = [int(row.get("ambiguity_group_size", 0)) for row in records]
    total = sum(weights)
    if (total <= 0 or any(not math.isfinite(value) or value < 0 for value in weights)
            or any(value < 1 for value in ambiguities)):
        raise ValueError(
            "Testability faults require finite non-negative weights with a "
            "positive total and ambiguity-group sizes of at least 1.")
    detected = sum(float(row["weight"]) for row in records if bool(row.get("detected", False)))
    isolated = sum(float(row["weight"]) for row in records
                   if bool(row.get("detected", False))
                   and int(row.get("ambiguity_group_size", 0)) <= isolation_threshold)
    rows = [{**row, "isolation_eligible": bool(row.get("detected", False))
             and int(row.get("ambiguity_group_size", 0)) <= isolation_threshold}
            for row in records]
    return {
        "rows": rows,
        "summary": {
            "faults": len(records), "total_weight": total,
            "fraction_faults_detected": detected / total,
            "fraction_faults_isolated": isolated / total,
            "isolation_threshold": isolation_threshold,
            "undetected_fault_ids": [row.get("id") for row in records if not bool(row.get("detected", False))],
        },
        "method": "weighted FFD/FFI fault-universe accounting",
        "warning": "Coverage reflects the declared fault universe, weights, diagnostic model, and ambiguity groups.",
    }


def analyze_rcm(rows: Iterable[dict]) -> dict:
    records = list(rows)
    consequence = Counter(str(row.get("consequence", "unclassified")).lower() for row in records)
    task = Counter(str(row.get("task_type", "undecided")).lower() for row in records)
    unresolved = [row.get("id") for row in records
                  if str(row.get("decision_status", "open")).lower() not in {"approved", "closed"}]
    return {
        "summary": {"items": len(records), "unresolved": len(unresolved),
                    "with_interval": sum(row.get("task_interval") not in {None, ""} for row in records)},
        "consequences": dict(consequence), "tasks": dict(task),
        "unresolved_ids": unresolved,
        "warning": "Confirm each RCM task against the asset context, failure behavior, and effectiveness evidence.",
    }


def analyze_traceability(*, fmea: Iterable[dict], hazards: Iterable[dict],
                         fracas: Iterable[dict], rcm: Iterable[dict]) -> dict:
    """Check typed links without assuming that an unlinked record is invalid."""
    fmea, hazards, fracas, rcm = map(list, (fmea, hazards, fracas, rcm))
    groups = {
        "fmea": {str(row.get("id")) for row in fmea},
        "hazards": {str(row.get("id")) for row in hazards},
        "fracas": {str(row.get("id")) for row in fracas},
        "rcm": {str(row.get("id")) for row in rcm},
    }
    records = {
        "fmea": list(fmea), "hazards": list(hazards),
        "fracas": list(fracas), "rcm": list(rcm),
    }
    specifications = (
        ("fmea", "linked_hazard_ids", "hazards"),
        ("fmea", "linked_fracas_ids", "fracas"),
        ("hazards", "linked_fmea_ids", "fmea"),
        ("fracas", "linked_fmea_ids", "fmea"),
        ("rcm", "linked_fmea_ids", "fmea"),
    )
    issues = []
    total_links = resolved_links = 0
    for source_group, field, target_group in specifications:
        for row in records[source_group]:
            for target_id in row.get(field, []) or []:
                total_links += 1
                target_id = str(target_id)
                if target_id in groups[target_group]:
                    resolved_links += 1
                else:
                    issues.append({
                        "code": "unknown_reference", "source_id": row.get("id"),
                        "field": field, "target_id": target_id,
                        "expected_record_type": target_group,
                    })
    reciprocal_pairs = (
        ("fmea", "linked_hazard_ids", "hazards", "linked_fmea_ids"),
        ("fmea", "linked_fracas_ids", "fracas", "linked_fmea_ids"),
    )
    indexes = {name: {str(row.get("id")): row for row in rows}
               for name, rows in records.items()}
    for source_group, source_field, target_group, target_field in reciprocal_pairs:
        for source in records[source_group]:
            for target_id in source.get(source_field, []) or []:
                target = indexes[target_group].get(str(target_id))
                if target is not None and str(source.get("id")) not in {
                        str(value) for value in target.get(target_field, []) or []}:
                    issues.append({
                        "code": "missing_reciprocal_link",
                        "source_id": source.get("id"), "field": source_field,
                        "target_id": str(target_id),
                        "expected_reciprocal_field": target_field,
                    })
    unknown = sum(issue["code"] == "unknown_reference" for issue in issues)
    reciprocal = sum(issue["code"] == "missing_reciprocal_link" for issue in issues)
    return {
        "summary": {
            "links": total_links, "resolved_links": resolved_links,
            "unknown_references": unknown,
            "missing_reciprocal_links": reciprocal,
            "issues": len(issues),
        },
        "issues": issues,
        "warning": "Link integrity covers identifier resolution and reciprocal links; review the technical consistency of linked records together.",
    }


def analyze_reliability_program(*, fmea=(), hazards=(), fracas=(), requirements=(),
                                testability_faults=(), rcm=(), total_exposure=None,
                                CI=0.95, isolation_threshold=1,
                                medium_rpn=100, high_rpn=200,
                                fmea_analyses=(), rating_profiles=()) -> dict:
    fmea, hazards, fracas = list(fmea), list(hazards), list(fracas)
    requirements, testability_faults, rcm = (
        list(requirements), list(testability_faults), list(rcm))
    return {
        "fmea": analyze_fmea(fmea, medium_rpn=medium_rpn, high_rpn=high_rpn),
        "aiag_vda_fmea": analyze_aiag_vda_fmea(
            fmea_analyses, rating_profiles=rating_profiles,
            program_requirements=requirements),
        "hazards": analyze_hazards(hazards),
        "fracas": analyze_fracas(fracas, total_exposure=total_exposure, CI=CI),
        "requirements": analyze_requirements(requirements),
        "testability": analyze_testability(testability_faults, isolation_threshold=isolation_threshold)
        if testability_faults else None,
        "rcm": analyze_rcm(rcm),
        "traceability": analyze_traceability(
            fmea=fmea, hazards=hazards, fracas=fracas, rcm=rcm),
        "standards_context": {
            "status": "standards_informed_workflow",
            "references": ["AIAG & VDA FMEA Handbook, First Edition (2019)",
                           "AIAG & VDA FMEA Handbook English Errata v2 (2020)",
                           "IEC 60812:2018 (full-text verification pending)",
                           "MIL-STD-882E Change 1", "MIL-HDBK-338B",
                           "RL-TR-91-180"],
        },
    }


__all__ = [
    "analyze_fmea", "analyze_hazards", "analyze_fracas",
    "analyze_requirements", "analyze_testability", "analyze_rcm",
    "analyze_traceability",
    "analyze_reliability_program",
]
