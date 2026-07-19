"""RADC nonoperating Prediction and mission API contracts.

These tests exercise the router functions through their public Pydantic
request/response boundary.  They deliberately avoid asserting internal table
constants already covered by the RADC model unit tests; the focus here is the
adapter, fail-closed roll-up, service-rate semantics, and removal of the legacy
exposure vocabulary.
"""

import math
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parents[1] / "src"))

from routers.prediction import options, predict, predict_mission_profile  # noqa: E402
from schemas import (  # noqa: E402
    MissionPhaseSchema,
    MissionProfilePredictionRequest,
    PredictionBlock,
    PredictionPart,
    PredictionRequest,
)


def _mixed_block(*, nonoperating_environment="GB", operating_fraction=0.25):
    return PredictionBlock(
        id="assembly",
        name="Assembly",
        operating_fraction=operating_fraction,
        nonoperating_environment=nonoperating_environment,
        nonoperating_temperature_c=25,
        power_cycles_per_1000_nonoperating_hours=1,
    )


def test_options_expose_complete_radc_catalog_without_space_flight():
    catalog = options()
    environments = catalog["nonoperating_environments"]
    codes = [entry["code"] for entry in environments]

    assert codes
    assert len(codes) == len(set(codes))
    assert all(entry["description"] for entry in environments)
    assert "GB" in codes
    assert "SF" not in codes

    models = catalog["nonoperating_models"]
    assert set(models) == {
        "microelectronic_device",
        "hybrid_microcircuit",
        "magnetic_bubble_memory",
        "discrete_semiconductor",
        "tube",
        "laser",
        "resistor",
        "capacitor",
        "inductive_device",
        "rotating_device",
        "relay",
        "switch",
        "connector",
        "pth_assembly",
        "connections",
        "miscellaneous_part",
    }
    assert all(model["section"].startswith("5.2.") for model in models.values())
    assert all(model["required_parameters"] for model in models.values())

    automatic = catalog["nonoperating_automatic_models"]
    assert automatic["resistor"] == {
        "model": "resistor", "input_keys": (),
    }
    assert automatic["microcircuit"]["model"] == "microelectronic_device"


def test_prediction_runs_an_explicit_microelectronic_nonoperating_model():
    result = predict(PredictionRequest(
        environment="GB",
        blocks=[_mixed_block()],
        parts=[PredictionPart(
            category="microcircuit",
            name="Logic IC",
            parent_id="assembly",
            params={
                "device_type": "digital",
                "complexity": 100,
                "quality": "B",
                "package": "hermetic_dip",
            },
            nonoperating_params={
                "model": "microelectronic_device",
                "device_type": "digital",
                "technology": "ttl",
                "complexity": 100,
                "package": "hermetic",
                "quality": "B",
            },
        )],
    ))

    row = result["results"][0]
    nonoperating = row["nonoperating_calculation"]
    expected_service_rate = (
        0.25 * row["operating_failure_rate_fpmh"]
        + 0.75 * row["nonoperating_failure_rate_fpmh"]
    )

    assert result["service_rate_available"] is True
    assert result["rate_time_basis"] == "calendar_hours"
    assert nonoperating["status"] == "supported"
    assert nonoperating["traceability"]["document_number"] == "RADC-TR-85-91"
    assert nonoperating["traceability"]["report_section"] == "5.2.2.1"
    assert nonoperating["inputs"]["technology"] == "ttl_httl_dtl_ecl"
    assert nonoperating["inputs"]["environment"] == "GB"
    assert nonoperating["inputs"]["temperature_c"] == 25
    assert nonoperating["inputs"]["power_cycles_per_1000h"] == 1
    assert row["service_failure_rate_fpmh"] == pytest.approx(
        expected_service_rate, abs=1e-8)
    assert result["service_failure_rate_fpmh"] == pytest.approx(
        expected_service_rate, abs=1e-6)


def test_prediction_fails_closed_when_no_exact_radc_mapping_exists():
    result = predict(PredictionRequest(
        environment="GB",
        blocks=[_mixed_block()],
        parts=[PredictionPart(
            category="generic",
            name="User operating-rate item",
            parent_id="assembly",
            params={"failure_rate": 1.0},
        )],
    ))

    row = result["results"][0]
    nonoperating = row["nonoperating_calculation"]
    assert row["operating_failure_rate_fpmh"] == pytest.approx(1.0)
    assert nonoperating["status"] == "unavailable"
    assert "no exact RADC-TR-85-91 mapping" in nonoperating["reason"]
    assert row["service_failure_rate_fpmh"] is None
    assert row["service_rate_available"] is False
    assert result["service_failure_rate_fpmh"] is None
    assert result["total_failure_rate"] is None
    assert result["mtbf_hours"] is None
    assert result["service_rate_available"] is False
    assert any("unavailable" in warning for warning in result["warnings"])


def test_documented_nonoperating_override_restores_the_service_rollup():
    result = predict(PredictionRequest(
        environment="GB",
        blocks=[_mixed_block()],
        parts=[PredictionPart(
            category="generic",
            parent_id="assembly",
            params={"failure_rate": 1.0},
            nonoperating_rate_override_enabled=True,
            nonoperating_rate_override_fpmh=0.4,
            nonoperating_rate_source_type="measured",
            nonoperating_rate_source="Qualification report QR-17",
        )],
    ))

    row = result["results"][0]
    nonoperating = row["nonoperating_calculation"]
    assert nonoperating["status"] == "user_override"
    assert nonoperating["source_type"] == "measured"
    assert nonoperating["source"] == "Qualification report QR-17"
    assert nonoperating["traceability"]["standard"] == "User-supplied evidence"
    assert row["nonoperating_failure_rate_fpmh"] == pytest.approx(0.4)
    assert row["service_failure_rate_fpmh"] == pytest.approx(0.55)
    assert result["service_failure_rate_fpmh"] == pytest.approx(0.55)
    assert result["service_rate_available"] is True


def test_space_flight_is_rejected_by_the_radc_extension():
    result = predict(PredictionRequest(
        environment="GB",
        blocks=[_mixed_block(nonoperating_environment="SF")],
        parts=[PredictionPart(
            category="resistor",
            parent_id="assembly",
            params={"style": "RW", "quality": "commercial"},
        )],
    ))

    row = result["results"][0]
    nonoperating = row["nonoperating_calculation"]
    assert nonoperating["status"] == "unavailable"
    assert "excludes Space, Flight" in nonoperating["reason"]
    assert row["operating_failure_rate_fpmh"] > 0
    assert row["service_failure_rate_fpmh"] is None
    assert result["service_rate_available"] is False


def test_mission_profile_weights_calendar_service_rates_by_phase_duration():
    result = predict_mission_profile(MissionProfilePredictionRequest(
        profile_name="Operating and storage",
        standard="MIL-HDBK-217F",
        phases=[
            MissionPhaseSchema(
                name="Operating",
                duration=100,
                operating_fraction=1,
            ),
            MissionPhaseSchema(
                name="Storage",
                duration=300,
                operating_fraction=0,
                nonoperating_environment="GB",
                nonoperating_temperature_c=25,
                power_cycles_per_1000_nonoperating_hours=0,
            ),
        ],
        parts=[PredictionPart(
            category="generic",
            params={"failure_rate": 1.0},
            nonoperating_rate_override_enabled=True,
            nonoperating_rate_override_fpmh=0.2,
            nonoperating_rate_source_type="measured",
            nonoperating_rate_source="Storage test ST-4",
        )],
    ))

    phases = result["part_results"][0]["phases"]
    assert result["total_duration"] == pytest.approx(400)
    assert [phase["fraction"] for phase in phases] == pytest.approx([0.25, 0.75])
    assert [phase["weighted_contribution"] for phase in phases] == pytest.approx(
        [0.25, 0.15])
    assert result["system_failure_rate"] == pytest.approx(0.4)
    assert result["system_mtbf"] == pytest.approx(2_500_000)
    assert result["mission_reliability"] == pytest.approx(
        math.exp(-0.4 * 400 / 1e6), abs=1e-8)
    assert result["rate_time_basis"] == "calendar_hours"
    assert result["service_rate_available"] is True


def test_non_mil_mission_rejects_mixed_operating_exposure_at_the_schema_boundary():
    with pytest.raises(ValidationError, match="available only through"):
        MissionProfilePredictionRequest.model_validate({
            "profile_name": "Invalid Telcordia storage profile",
            "standard": "Telcordia",
            "phases": [{
                "name": "Storage",
                "duration": 100,
                "operating_fraction": 0.5,
                "nonoperating_environment": "GB",
                "nonoperating_temperature_c": 25,
                "power_cycles_per_1000_nonoperating_hours": 0,
            }],
            "parts": [{"category": "resistor", "params": {}}],
        })


@pytest.mark.parametrize("legacy_field", ["duty_cycle", "dormant_environment"])
def test_prediction_block_rejects_legacy_exposure_fields(legacy_field):
    payload = {"id": "block", "name": "Block", legacy_field: 0.5}
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        PredictionBlock.model_validate(payload)


@pytest.mark.parametrize(
    "legacy_field,legacy_value",
    [
        ("operating", False),
        ("duty_cycle", 0.5),
        ("dormant_environment", "GB"),
    ],
)
def test_mission_phase_rejects_legacy_exposure_fields(
    legacy_field, legacy_value,
):
    payload = {
        "name": "Legacy phase",
        "duration": 100,
        legacy_field: legacy_value,
    }
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        MissionPhaseSchema.model_validate(payload)


def test_public_schemas_do_not_advertise_legacy_exposure_fields():
    block_fields = PredictionBlock.model_json_schema()["properties"]
    phase_fields = MissionPhaseSchema.model_json_schema()["properties"]

    assert "operating_fraction" in block_fields
    assert "nonoperating_environment" in block_fields
    assert "duty_cycle" not in block_fields
    assert "dormant_environment" not in block_fields

    assert "operating_fraction" in phase_fields
    assert "nonoperating_environment" in phase_fields
    assert "operating" not in phase_fields
    assert "duty_cycle" not in phase_fields
    assert "dormant_environment" not in phase_fields
