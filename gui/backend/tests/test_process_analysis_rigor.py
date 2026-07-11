"""Router contracts for stability-gated process analysis."""

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))


def test_capability_router_always_returns_stability_decision():
    from routers.capability import CapabilityRequest, analyze

    result = analyze(CapabilityRequest(
        data=[10.0] * 12 + [30.0], lsl=5.0, usl=35.0,
        stability_status="assess", bootstrap_samples=0,
    ))
    assert result["decision_status"] == "withheld"
    assert result["stability"]["signals"]


def test_spc_router_phase_ii_freezes_baseline_limits():
    from routers.spc import ChartRequest, chart

    baseline = [9.8, 10.1, 10.0, 9.9, 10.2, 10.0]
    result = chart(ChartRequest(
        chart="i_mr", data=[12.0, 12.1, 11.9], phase="phase_ii",
        baseline_data=baseline,
    ))
    assert result["workflow"]["limits_frozen"] is True
    assert result["subcharts"][0]["cl"] == pytest.approx(np.mean(baseline))


def test_msa_router_reml_accepts_unbalanced_crossed_study():
    from routers.msa import GageRRRequest, gage_rr

    rng = np.random.default_rng(91)
    parts, operators, measurements = [], [], []
    for part in range(4):
        part_effect = rng.normal(0, 1)
        for operator in ("A", "B"):
            for _ in range(3 if (part == 0 and operator == "A") else 2):
                parts.append(str(part)); operators.append(operator)
                measurements.append(10 + part_effect + (operator == "B") * 0.2 + rng.normal(0, 0.1))
    result = gage_rr(GageRRRequest(
        parts=parts, operators=operators, measurements=measurements,
        method="reml", topology="crossed",
    ))
    assert result["method"] == "REML"
    assert result["design_diagnostics"]["balanced"] is False
    assert result["optimizer"]["success"] is True


def test_msa_router_rejects_nested_data_with_classical_method():
    from routers.msa import GageRRRequest, gage_rr

    with pytest.raises(HTTPException) as exc:
        gage_rr(GageRRRequest(
            parts=["A1", "A1", "A2", "A2", "B1", "B1", "B2", "B2"],
            operators=["A", "A", "A", "A", "B", "B", "B", "B"],
            measurements=[1.0, 1.1, 2.0, 2.1, 1.4, 1.5, 2.4, 2.5],
            method="anova", topology="nested",
        ))
    assert exc.value.status_code == 400
    assert "REML" in exc.value.detail
