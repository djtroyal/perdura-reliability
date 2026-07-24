import math

import pytest

from reliability.Reliability_program import (
    analyze_fmea, analyze_fracas, analyze_hazards, analyze_reliability_program,
    analyze_requirements, analyze_testability, analyze_traceability,
)


def test_fmea_rpn_is_explicit_ordinal_screen_and_criticality_is_optional():
    result = analyze_fmea([
        {"id": "FM-1", "severity": 10, "occurrence": 2, "detection": 2,
         "action_status": "open"},
        {"id": "FM-2", "severity": 6, "occurrence": 5, "detection": 5,
         "failure_rate": 0.01, "mode_ratio": 0.2,
         "effect_probability": 1.0, "mission_time": 100,
         "action_status": "verified"},
    ])
    assert result["rows"][0]["rpn"] == 40
    assert result["rows"][0]["screening_band"] == "severity_override"
    assert result["rows"][1]["mode_criticality"] == pytest.approx(0.2)
    assert result["rpn_policy"]["method"] == "ordinal_product_screening"


def test_mil_std_882e_matrix_and_residual_direction():
    result = analyze_hazards([{
        "id": "HZ-1", "initial_probability": "A", "initial_severity": "I",
        "residual_probability": "D", "residual_severity": "III",
        "acceptance_status": "pending",
    }])
    row = result["rows"][0]
    assert row["initial_risk"] == {"probability": "A", "severity": "I", "risk_index": 1, "risk_level": "high"}
    assert row["residual_risk"]["risk_index"] == 14
    assert row["risk_reduced"] is True
    assert result["summary"]["unaccepted"] == 1


def test_fracas_rate_retains_zero_failure_upper_bound():
    result = analyze_fracas([], total_exposure=1000, CI=0.95)
    assert result["exposure_metrics"]["event_rate"] == 0
    assert result["exposure_metrics"]["rate_lower"] == 0
    assert result["exposure_metrics"]["rate_upper"] > 0
    assert result["exposure_metrics"]["mtbf"] is None


def test_weighted_testability_metrics_use_declared_fault_universe():
    result = analyze_testability([
        {"id": "F1", "weight": 0.5, "detected": True, "ambiguity_group_size": 1},
        {"id": "F2", "weight": 0.3, "detected": True, "ambiguity_group_size": 2},
        {"id": "F3", "weight": 0.2, "detected": False, "ambiguity_group_size": 3},
    ], isolation_threshold=1)
    assert result["summary"]["fraction_faults_detected"] == pytest.approx(0.8)
    assert result["summary"]["fraction_faults_isolated"] == pytest.approx(0.5)
    assert result["summary"]["undetected_fault_ids"] == ["F3"]


def test_requirement_traceability_does_not_equate_completeness_with_acceptance():
    result = analyze_requirements([{
        "id": "REQ-1", "statement": "R >= 0.99", "measure": "R(100)",
        "target": "0.99", "verification_method": "LDA", "owner": "A",
        "confidence": "0.90", "mission_profile": "100 hour mission",
        "failure_definition": "loss of required function",
        "status": "verified", "evidence_ids": [],
    }])
    assert result["summary"]["complete_definitions"] == 1
    assert result["summary"]["verification_ready"] == 0


def test_program_integrates_workflows_without_flattening_method_status():
    result = analyze_reliability_program()
    assert result["fmea"]["summary"]["total"] == 0
    assert result["testability"] is None
    assert result["standards_context"]["status"] == "standards_informed_workflow"


def test_partial_fmeca_criticality_input_fails_closed():
    with pytest.raises(ValueError, match="requires"):
        analyze_fmea([{"id": "FM", "severity": 5, "occurrence": 5,
                       "detection": 5, "failure_rate": 0.1}])


def test_traceability_reports_unknown_and_nonreciprocal_links_separately():
    result = analyze_traceability(
        fmea=[{"id": "FM-1", "linked_hazard_ids": ["HZ-1", "HZ-MISSING"],
               "linked_fracas_ids": []}],
        hazards=[{"id": "HZ-1", "linked_fmea_ids": []}],
        fracas=[], rcm=[],
    )
    assert result["summary"] == {
        "links": 2, "resolved_links": 1, "unknown_references": 1,
        "missing_reciprocal_links": 1, "issues": 2,
    }
    assert {issue["code"] for issue in result["issues"]} == {
        "unknown_reference", "missing_reciprocal_link",
    }
