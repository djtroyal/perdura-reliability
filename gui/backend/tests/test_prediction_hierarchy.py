"""System Block duty-cycle, quantity, and override contracts."""

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parents[1] / "src"))

from routers.prediction import _predict_standard, predict  # noqa: E402
from schemas import PredictionBlock, PredictionPart, PredictionRequest  # noqa: E402


def _resistor(**kwargs):
    return PredictionPart(category="resistor", params={"style": "RW"}, **kwargs)


def test_piece_override_replaces_only_effective_output():
    baseline = predict(PredictionRequest(
        environment="GB", parts=[_resistor(quantity=2)]))
    overridden = predict(PredictionRequest(
        environment="GB",
        parts=[_resistor(
            quantity=2,
            failure_rate_override_enabled=True,
            failure_rate_override_fpmh=0.25,
        )],
    ))
    row = overridden["results"][0]
    assert row["calculated_failure_rate"] == pytest.approx(
        baseline["results"][0]["failure_rate"])
    assert row["failure_rate"] == pytest.approx(0.25)
    assert row["total_failure_rate"] == pytest.approx(0.5)
    assert overridden["total_failure_rate"] == pytest.approx(0.5)
    assert row["traceability"]["equation"]
    assert row["calculation_steps"]


def test_disabled_piece_override_is_retained_but_ignored():
    result = predict(PredictionRequest(
        environment="GB",
        parts=[_resistor(
            failure_rate_override_enabled=False,
            failure_rate_override_fpmh=999.0,
        )],
    ))
    row = result["results"][0]
    assert row["override_applied"] is False
    assert row["failure_rate"] == pytest.approx(row["calculated_failure_rate"])
    assert row["failure_rate_override_fpmh"] == 999.0


def test_block_duty_cycle_weights_operating_and_dormant_environments():
    active = predict(PredictionRequest(
        environment="GM", parts=[_resistor()]))["results"][0]["failure_rate"]
    dormant = predict(PredictionRequest(
        environment="GB", parts=[_resistor()]))["results"][0]["failure_rate"]
    result = predict(PredictionRequest(
        environment="GM",
        blocks=[PredictionBlock(
            id="power", name="Power", duty_cycle=0.25,
            environment="GM", dormant_environment="GB",
        )],
        parts=[_resistor(parent_id="power")],
    ))
    row = result["results"][0]
    assert row["effective_duty_cycle"] == pytest.approx(0.25)
    assert row["operating_calculated_failure_rate"] == pytest.approx(active)
    assert row["dormant_calculated_failure_rate"] == pytest.approx(dormant)
    assert row["calculated_failure_rate"] == pytest.approx(
        0.25 * active + 0.75 * dormant)
    assert row["dormant_calculation"]["environment"] == "GB"


def test_nested_block_quantities_compound_after_piece_override():
    result = predict(PredictionRequest(
        environment="GB",
        blocks=[
            PredictionBlock(id="system", name="System", quantity=2, duty_cycle=0.5),
            PredictionBlock(
                id="card", name="Card", parent_id="system",
                quantity=3, duty_cycle=0.5,
            ),
        ],
        parts=[_resistor(
            parent_id="card", quantity=4,
            failure_rate_override_enabled=True,
            failure_rate_override_fpmh=0.1,
        )],
    ))
    row = result["results"][0]
    blocks = {block["id"]: block for block in result["blocks"]}
    assert row["effective_duty_cycle"] == pytest.approx(0.25)
    assert row["block_quantity_multiplier"] == 6
    assert row["system_expanded_failure_rate"] == pytest.approx(2.4)
    assert blocks["card"]["rolled_up_failure_rate"] == pytest.approx(0.4)
    assert blocks["system"]["rolled_up_failure_rate"] == pytest.approx(1.2)
    assert result["total_failure_rate"] == pytest.approx(2.4)


def test_block_override_replaces_descendants_without_erasing_their_calculation():
    result = predict(PredictionRequest(
        environment="GB",
        blocks=[PredictionBlock(
            id="card", name="Card", quantity=2,
            failure_rate_override_enabled=True,
            failure_rate_override_fpmh=0.7,
        )],
        parts=[_resistor(
            parent_id="card", quantity=4,
            failure_rate_override_enabled=True,
            failure_rate_override_fpmh=0.1,
        )],
    ))
    row = result["results"][0]
    block = result["blocks"][0]
    assert block["rolled_up_failure_rate"] == pytest.approx(0.4)
    assert block["failure_rate"] == pytest.approx(0.7)
    assert result["total_failure_rate"] == pytest.approx(1.4)
    assert row["superseded_by_block_id"] == "card"
    assert row["included_in_system_total"] is False
    assert row["system_contribution_failure_rate"] == 0
    assert row["calculated_failure_rate"] > 0


def test_override_only_block_can_represent_a_black_box_subassembly():
    result = predict(PredictionRequest(
        environment="GB",
        blocks=[PredictionBlock(
            id="vendor-unit", name="Vendor unit", quantity=4,
            failure_rate_override_enabled=True,
            failure_rate_override_fpmh=0.75,
        )],
        parts=[],
    ))
    assert result["results"] == []
    assert result["blocks"][0]["rolled_up_failure_rate"] == 0
    assert result["blocks"][0]["failure_rate"] == pytest.approx(0.75)
    assert result["total_failure_rate"] == pytest.approx(3.0)


def test_block_cycles_are_rejected():
    request = PredictionRequest(
        environment="GB",
        blocks=[
            PredictionBlock(id="a", name="A", parent_id="b"),
            PredictionBlock(id="b", name="B", parent_id="a"),
        ],
        parts=[_resistor(parent_id="a")],
    )
    with pytest.raises(HTTPException, match="cycle") as exc:
        predict(request)
    assert exc.value.status_code == 400


def test_enabled_overrides_require_a_value_and_quantities_are_positive():
    with pytest.raises(ValidationError, match="failure_rate_override_fpmh"):
        _resistor(failure_rate_override_enabled=True)
    with pytest.raises(ValidationError):
        _resistor(quantity=0)
    with pytest.raises(ValidationError, match="failure_rate_override_fpmh"):
        PredictionBlock(
            id="card", name="Card", failure_rate_override_enabled=True)


def test_missing_parent_and_invalid_part_environment_are_rejected():
    with pytest.raises(HTTPException, match="missing System Block"):
        predict(PredictionRequest(
            environment="GB", parts=[_resistor(parent_id="missing")]))
    with pytest.raises(HTTPException, match="Invalid part 1 environment"):
        predict(PredictionRequest(
            environment="GB", parts=[_resistor(environment="not-an-environment")]))


def test_dormant_environment_defaults_to_the_effective_operating_environment():
    result = predict(PredictionRequest(
        environment="GM",
        blocks=[PredictionBlock(id="card", name="Card", duty_cycle=0.2)],
        parts=[_resistor(parent_id="card", environment="GF")],
    ))
    row = result["results"][0]
    assert row["operating_environment"] == "GF"
    assert row["dormant_environment"] == "GF"
    assert row["operating_calculated_failure_rate"] == pytest.approx(
        row["dormant_calculated_failure_rate"])
    assert row["calculated_failure_rate"] == pytest.approx(
        row["operating_calculated_failure_rate"])


def test_non_mil_environment_weighting_uses_the_selected_standard_model():
    result = _predict_standard(
        "Telcordia",
        [PredictionPart(
            category="resistor", parent_id="card",
            params={"power_stress": 0.5, "quality": "commercial", "temperature": 40},
        )],
        "GC",
        [PredictionBlock(
            id="card", name="Card", duty_cycle=0.25,
            environment="GF", dormant_environment="GC",
        )],
    )
    row = result["results"][0]
    assert row["operating_environment"] == "GF"
    assert row["dormant_environment"] == "GC"
    assert row["calculated_failure_rate"] == pytest.approx(
        0.25 * row["operating_calculated_failure_rate"]
        + 0.75 * row["dormant_calculated_failure_rate"]
    )


def test_fides_ignores_simple_duty_weighting_but_applies_quantity_and_override():
    result = _predict_standard(
        "FIDES",
        [PredictionPart(
            category="passive_resistor", parent_id="card", quantity=3,
            params={"power_stress": 0.5, "temperature": 40},
            failure_rate_override_enabled=True,
            failure_rate_override_fpmh=0.2,
        )],
        "GB",
        [PredictionBlock(
            id="card", name="Card", quantity=2, duty_cycle=0.1,
            environment="GF", dormant_environment="GM",
        )],
    )
    row = result["results"][0]
    assert row["effective_duty_cycle"] == 1.0
    assert row["failure_rate"] == pytest.approx(0.2)
    assert result["total_failure_rate"] == pytest.approx(1.2)
    assert any("not applicable" in warning for warning in result["warnings"])
