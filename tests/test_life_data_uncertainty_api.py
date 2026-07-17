"""Life Data calibrated-uncertainty and Weibayes API contracts."""

import sys
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError


BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

from routers.life_data import calibrated_uncertainty, weibayes  # noqa: E402
from schemas import (  # noqa: E402
    CensoringDesignRequest, UncertaintyRequest, WeibayesRequest,
)


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
    assert result["interval"]["inferential_calibration_status"] == (
        "asymptotic_chi_square"
    )
    assert result["interval"]["censoring_design_status"] == "not_applicable"
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


def test_bootstrap_endpoint_reproduces_declared_administrative_censoring():
    latent = 100 * np.random.default_rng(713).weibull(2.0, 45)
    cutoff = 90.0
    result = calibrated_uncertainty(UncertaintyRequest(
        distribution="Weibull_2P",
        failures=latent[latent <= cutoff].tolist(),
        right_censored=[cutoff] * int(np.sum(latent > cutoff)),
        target="reliability",
        target_value=100.0,
        method="parametric_bootstrap",
        CI=0.90,
        n_bootstrap=20,
        seed=17,
        censoring_design=CensoringDesignRequest(
            type="fixed_administrative", time=cutoff),
    ))

    interval = result["interval"]
    assert interval["calibration_status"] == "design_reproduced"
    assert interval["censoring_design"] == {
        "type": "fixed_administrative",
        "calibration_status": "design_reproduced",
        "assumption": (
            "Every bootstrap unit is administratively censored at the "
            "declared fixed time."
        ),
        "time": cutoff,
    }
    assert interval["uncertainty_warnings"] == [
        "bootstrap_replication_count_below_100_has_unstable_percentile_endpoints"
    ]
    assert interval["inferential_calibration_status"] == (
        "parametric_bootstrap_low_replication_unverified"
    )
    assert interval["censoring_design_status"] == "design_reproduced"


def test_uncertainty_schema_rejects_ambiguous_designs_and_unbounded_work():
    with pytest.raises(ValidationError, match="accepts only the time field"):
        CensoringDesignRequest(
            type="fixed_administrative", time=100.0, times=[100.0],
        )

    with pytest.raises(ValidationError):
        UncertaintyRequest(
            distribution="Weibull_2P",
            failures=[10.0, 20.0],
            target="reliability",
            target_value=100.0,
            method="parametric_bootstrap",
            n_bootstrap=2001,
        )
