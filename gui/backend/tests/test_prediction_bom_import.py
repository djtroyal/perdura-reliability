"""Electronic BOM provenance and calculation-exclusion contracts."""

import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parents[1] / "src"))

from routers.prediction import _predict_standard, predict  # noqa: E402
from schemas import (  # noqa: E402
    BOMMappingAssessment,
    BOMSource,
    PredictionPart,
    PredictionRequest,
)


def _mapped_resistor(**updates):
    values = {
        "category": "resistor",
        "name": "R1, R2",
        "reference_designators": ["R1", "R2"],
        "part_number": "RN55D1001F",
        "manufacturer": "Example Manufacturer",
        "supplier": "Example Distributor",
        "supplier_part_number": "DIST-1001",
        "description": "1 kOhm metal film resistor",
        "value": "1k",
        "package_or_footprint": "Axial",
        "quantity": 2,
        "params": {"style": "RN", "quality": "commercial"},
        "bom_source": BOMSource(
            file_name="assembly-bom.xlsx",
            sheet="Main BOM",
            source_row=12,
            imported_at="2026-07-21T12:00:00Z",
        ),
        "bom_mapping": BOMMappingAssessment(
            status="confirmed",
            source="manual",
            target_standard="MIL-HDBK-217F",
            evidence=["User selected resistor."],
        ),
    }
    values.update(updates)
    return PredictionPart(**values)


def test_bom_metadata_round_trips_through_prediction_schema():
    part = _mapped_resistor()
    payload = part.model_dump(mode="json")
    assert payload["reference_designators"] == ["R1", "R2"]
    assert payload["supplier"] == "Example Distributor"
    assert payload["bom_source"]["sheet"] == "Main BOM"
    assert payload["bom_mapping"]["status"] == "confirmed"


@pytest.mark.parametrize("status", ["provisional", "unmapped"])
def test_unconfirmed_bom_mapping_is_excluded_from_mil_total(status):
    confirmed = _mapped_resistor(name="R1", quantity=1)
    excluded = _mapped_resistor(
        name="R2",
        quantity=1000,
        calculation_enabled=False,
        calculation_exclusion_reason="Confirm the imported component mapping.",
        bom_mapping=BOMMappingAssessment(
            status=status,
            source="perdura" if status == "provisional" else "manual",
            target_standard="MIL-HDBK-217F",
            confidence="high" if status == "provisional" else None,
        ),
    )
    baseline = predict(PredictionRequest(environment="GB", parts=[confirmed]))
    result = predict(PredictionRequest(
        environment="GB", parts=[confirmed, excluded]))

    assert result["total_failure_rate"] == baseline["total_failure_rate"]
    assert result["excluded_part_count"] == 1
    assert result["incompatible"] == []
    assert result["excluded_parts"][0]["index"] == 1
    assert result["results"][1]["excluded"] is True
    assert result["results"][1]["mapping_status"] == status
    assert result["results"][1]["total_failure_rate"] == 0
    assert any("excluded" in warning.lower() for warning in result["warnings"])


def test_dnp_line_is_excluded_even_when_mapping_is_confirmed():
    dnp = _mapped_resistor(population_status="dnp", calculation_enabled=True)
    result = predict(PredictionRequest(environment="GB", parts=[dnp]))
    assert result["total_failure_rate"] == 0
    assert result["excluded_part_count"] == 1
    assert result["results"][0]["excluded"] is True
    assert "DNP" in result["results"][0]["error"]


def test_exclusion_contract_also_applies_to_multi_standard_prediction():
    excluded = PredictionPart(
        category="resistor",
        name="R1",
        quantity=10,
        params={},
        calculation_enabled=False,
        bom_mapping=BOMMappingAssessment(
            status="provisional", source="perdura", target_standard="Telcordia"),
    )
    result = _predict_standard("Telcordia", [excluded], "GC")
    assert result["total_failure_rate"] == 0
    assert result["excluded_part_count"] == 1
    assert result["results"][0]["excluded"] is True
