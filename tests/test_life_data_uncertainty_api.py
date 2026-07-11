"""Life Data calibrated-uncertainty and Weibayes API contracts."""

import sys
from pathlib import Path

import numpy as np


BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

from routers.life_data import calibrated_uncertainty, weibayes  # noqa: E402
from schemas import UncertaintyRequest, WeibayesRequest  # noqa: E402


def test_profile_interval_endpoint_exposes_method_and_reference_warning():
    failures = (100 * np.random.default_rng(31).weibull(2.0, 50)).tolist()
    result = calibrated_uncertainty(UncertaintyRequest(
        distribution="Weibull_2P",
        failures=failures,
        target="reliability",
        target_value=100.0,
        method="profile_likelihood",
        CI=0.90,
    ))

    assert result["interval"]["complete"] is True
    assert result["interval"]["lower"] < result["interval"]["upper"]
    assert result["reference_interval"]["parameter_method"] == "observed_fisher_wald"
    assert "asymptotic_wald_delta_approximation" in result["reference_interval"]["warnings"]


def test_weibayes_endpoint_propagates_beta_sensitivity():
    result = weibayes(WeibayesRequest(
        failures=[100, 150, 200, 250, 300],
        right_censored=[175, 225],
        beta=2.5,
        CI=0.90,
        uncertainty_method="sensitivity",
        beta_lower=2.0,
        beta_upper=3.0,
    ))

    assert result["beta_assumption"] == "uncertain"
    assert result["eta_propagated_lower"] < result["eta_propagated_upper"]
    lower = np.asarray(result["curves"]["sf_propagated_lower"])
    upper = np.asarray(result["curves"]["sf_propagated_upper"])
    assert np.all(lower <= upper)
