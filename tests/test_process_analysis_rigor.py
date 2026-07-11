"""Guardrails for capability, Phase-I/II SPC, and Gage R&R topology."""

import numpy as np
import pytest

from reliability.MSA import gage_rr_anova, gage_rr_reml, gage_rr_xbar_r
from reliability.Process_capability import process_capability
from reliability.SPC import control_chart, xbar_r_chart


def test_capability_withholds_decision_when_stability_is_not_demonstrated():
    result = process_capability(
        [9.9, 10.1, 10.0, 10.2, 9.8, 10.05],
        lsl=9.0,
        usl=11.0,
        stability_status="not_assessed",
        bootstrap_samples=0,
    )
    assert result["Cpk"] is not None  # retained as a diagnostic estimate
    assert result["decision_status"] == "withheld"
    assert result["decision_grade"] is False


def test_capability_computed_stability_detects_special_cause():
    result = process_capability(
        [10.0] * 12 + [30.0], lsl=5.0, usl=35.0,
        stability_status="assess", bootstrap_samples=0,
    )
    assert result["stability"]["status"] == "unstable"
    assert result["stability"]["signals"]
    assert result["decision_status"] == "withheld"


def test_nonnormal_capability_reports_seeded_bootstrap_sensitivity():
    rng = np.random.default_rng(2048)
    data = rng.lognormal(mean=1.0, sigma=0.8, size=140)
    result = process_capability(
        data, lsl=0.2, usl=20.0, stability_status="stable",
        bootstrap_samples=60, seed=7,
    )
    sensitivity = result["non_normal"]["sensitivity"]
    assert len(sensitivity["methods"]) >= 3
    assert sensitivity["Ppk_min"] <= sensitivity["Ppk_max"]
    assert any(method["Ppk_bootstrap_ci"] is not None
               for method in sensitivity["methods"])
    assert sensitivity["tail_sufficient"] is False


def test_capability_rejects_unsupported_subgroup_constant():
    with pytest.raises(ValueError, match="supported d2 table"):
        process_capability(range(60), lsl=-1, usl=100, subgroup_size=30)


def test_phase_ii_uses_frozen_limits_from_separate_baseline():
    baseline = [9.8, 10.1, 10.0, 9.9, 10.2, 10.0, 9.85, 10.15]
    monitoring = [12.0, 12.1, 11.9, 12.2]
    result = control_chart(
        "i_mr", monitoring, phase="phase_ii", baseline_data=baseline
    )
    individuals = result["subcharts"][0]
    assert individuals["cl"] == pytest.approx(np.mean(baseline))
    assert individuals["cl"] != pytest.approx(np.mean(monitoring))
    assert individuals["violations"]
    assert result["workflow"]["limits_frozen"] is True


def test_phase_i_candidate_exclusions_are_visible_not_silent():
    result = control_chart(
        "i_mr", [10.0] * 12 + [30.0], phase="phase_i",
        phase_i_remove_signals=True,
    )
    assert result["workflow"]["excluded_points"] == [13]
    assert result["workflow"]["warning"]
    assert 13 not in result["workflow"]["retained_points"]


def test_spc_rejects_unsupported_constants_instead_of_clamping():
    with pytest.raises(ValueError, match="outside the supported SPC constant table"):
        xbar_r_chart([list(range(26)), list(range(1, 27))])


def _unbalanced_crossed_data():
    rng = np.random.default_rng(19)
    parts, operators, measurements = [], [], []
    part_effect = rng.normal(0.0, 1.2, 5)
    for part in range(5):
        for operator, operator_effect in (("A", -0.2), ("B", 0.2)):
            replicates = 3 if (part == 0 and operator == "A") else 2
            for _ in range(replicates):
                parts.append(str(part))
                operators.append(operator)
                measurements.append(10 + part_effect[part] + operator_effect + rng.normal(0, 0.15))
    return parts, operators, measurements


def test_classical_gage_rr_rejects_unbalanced_design():
    parts, operators, measurements = _unbalanced_crossed_data()
    with pytest.raises(ValueError, match="complete, balanced"):
        gage_rr_anova(parts, operators, measurements)
    with pytest.raises(ValueError, match="complete, balanced"):
        gage_rr_xbar_r(parts, operators, measurements)


def test_reml_supports_unbalanced_crossed_design_and_reports_intervals():
    parts, operators, measurements = _unbalanced_crossed_data()
    result = gage_rr_reml(parts, operators, measurements, topology="crossed")
    components = result["variance_components"]
    assert result["optimizer"]["success"] is True
    assert result["design_diagnostics"]["balanced"] is False
    assert components["Total"]["variance"] == pytest.approx(
        components["GRR"]["variance"] + components["Part-to-Part"]["variance"]
    )
    assert components["GRR"]["variance_ci"] is not None
    assert result["identifiability"]["identifiable"] is True


def test_reml_supports_parts_nested_within_operator():
    rng = np.random.default_rng(23)
    parts, operators, measurements = [], [], []
    for operator, op_effect in (("A", -0.3), ("B", 0.3)):
        for part_index in range(3):
            part = f"{operator}{part_index}"
            part_effect = rng.normal(0, 1.0)
            for _ in range(2 + (part_index == 0)):
                parts.append(part)
                operators.append(operator)
                measurements.append(5 + op_effect + part_effect + rng.normal(0, 0.1))
    result = gage_rr_reml(parts, operators, measurements, topology="nested")
    assert result["optimizer"]["success"] is True
    assert result["design_diagnostics"]["valid"] is True
    assert result["topology"] == "nested"
    assert result["variance_components"]["Interaction"]["variance"] == 0.0


def test_reml_rejects_mislabeled_nested_topology():
    parts, operators, measurements = _unbalanced_crossed_data()
    with pytest.raises(ValueError, match="each part to belong to exactly one operator"):
        gage_rr_reml(parts, operators, measurements, topology="nested")
