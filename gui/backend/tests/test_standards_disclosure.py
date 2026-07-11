"""Router contracts for standards provenance and conformance tiers."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from routers.prediction import (  # noqa: E402
    analyze_derating,
    get_derating_standards,
    list_standards,
    predict,
    predict_mission_profile,
)
from schemas import (  # noqa: E402
    DeratingRequest,
    MissionPhaseSchema,
    MissionProfilePredictionRequest,
    PredictionPart,
    PredictionRequest,
)


def _assert_methodology(disclosure, expected_id):
    assert disclosure["standard_id"] == expected_id
    assert disclosure["edition"]
    assert disclosure["implementation_scope"]
    assert disclosure["known_exclusions"]
    assert disclosure["conformance_tier"] in {"verified", "partial", "screening", "custom"}
    assert disclosure["tier_definition"]["label"]
    assert "status" in disclosure["authoritative_example_validation"]


def test_prediction_standard_options_expose_methodology():
    standards = list_standards()
    expected = {
        "MIL-HDBK-217F",
        "VITA-51.1",
        "Telcordia",
        "217Plus",
        "FIDES",
        "NSWC",
        "EPRD-2014",
        "NPRD-2023",
    }
    assert expected <= set(standards)
    for standard_id in expected:
        item = standards[standard_id]
        _assert_methodology(item["methodology"], standard_id)
        assert item["conformance_tier"] == item["methodology"]["conformance_tier"]
        assert item["conformance_label"] == item["methodology"]["tier_definition"]["label"]


def test_prediction_result_discloses_base_method_and_vita_supplement():
    result = predict(
        PredictionRequest(
            environment="GB",
            vita_global=True,
            parts=[PredictionPart(category="microcircuit", params={})],
        )
    )

    _assert_methodology(result["methodology"], "MIL-HDBK-217F")
    assert len(result["methodology_supplements"]) == 1
    _assert_methodology(result["methodology_supplements"][0], "VITA-51.1")


def test_derating_options_and_result_expose_methodology():
    standards = get_derating_standards()
    assert standards
    for item in standards:
        _assert_methodology(item["methodology"], item["methodology"]["standard_id"])

    result = analyze_derating(
        DeratingRequest(
            standard="MIL-STD-975",
            parts=[PredictionPart(category="resistor", params={})],
        )
    )
    _assert_methodology(result["methodology"], "MIL-STD-975-derating")


def test_mission_result_exposes_methodology():
    result = predict_mission_profile(
        MissionProfilePredictionRequest(
            standard="MIL-HDBK-217F",
            phases=[MissionPhaseSchema(name="Nominal", duration=100.0)],
            parts=[PredictionPart(category="microcircuit", params={})],
        )
    )
    _assert_methodology(result["methodology"], "MIL-HDBK-217F")
