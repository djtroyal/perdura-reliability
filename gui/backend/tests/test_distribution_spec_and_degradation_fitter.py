"""Direct-distribution and degradation measurement-family contracts."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from routers.alt import degradation_destructive
from routers.life_data import spec_curves
from schemas import DestructiveDegradationRequest, SpecCurvesRequest


def test_specified_distribution_returns_reusable_parameters():
    result = spec_curves(SpecCurvesRequest(
        distribution="Weibull_2P",
        params={"eta": 125.0, "beta": 2.4},
    ))

    assert result["distribution"] == "Weibull_2P"
    assert result["params"] == {"eta": 125.0, "beta": 2.4}
    assert len(result["curves"]["x"]) == 300
    assert result["stats"]["median"] > 0


def _destructive_request(distribution: str) -> DestructiveDegradationRequest:
    # Positive measurements across four inspection times keep every candidate
    # family in its support while still providing within-time dispersion.
    return DestructiveDegradationRequest(
        times=[1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4],
        measurements=[97, 101, 99, 92, 95, 94, 87, 91, 89, 83, 86, 84],
        threshold=75,
        threshold_direction="below",
        degradation_model="linear",
        measurement_distribution=distribution,
        reliability_time=5,
    )


def test_fixed_destructive_measurement_fit_reports_information_criteria():
    result = degradation_destructive(_destructive_request("Normal"))

    assert result["measurement_distribution"] == "Normal"
    assert result["fit_eligible"] is True
    assert result["gof"]["LogLik"] == pytest.approx(result["loglik"])
    assert result["gof"]["AIC"] > 0
    assert result["gof"]["BIC"] > 0


def test_destructive_best_fit_compares_joint_measurement_models():
    result = degradation_destructive(_destructive_request("Best_Fit"))

    comparison = result["distribution_comparison"]
    assert len(comparison) == 5
    assert result["measurement_distribution"] in {
        row["distribution"] for row in comparison if row["fit_eligible"]
    }
    assert result["measurement_distribution_selection"] in {"AICc", "AIC"}
    eligible_scores = [
        row["AICc"] if row["AICc"] is not None else row["AIC"]
        for row in comparison if row["fit_eligible"]
    ]
    selected = next(row for row in comparison
                    if row["distribution"] == result["measurement_distribution"])
    selected_score = selected["AICc"] if selected["AICc"] is not None else selected["AIC"]
    assert selected_score == pytest.approx(min(eligible_scores))
