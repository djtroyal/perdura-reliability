"""Joint hierarchical degradation and induced-life inference contracts."""

import math
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException
from pydantic import ValidationError


BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

import routers.alt as alt_router  # noqa: E402
from schemas import DegradationRequest  # noqa: E402


def _simulated_request(*, model="linear", n_bootstrap=0, seed=7):
    rng = np.random.default_rng(12 if model == "linear" else 8)
    times = np.asarray([0.0, 6.0, 12.0])
    unit_ids = []
    observation_times = []
    measurements = []
    if model == "linear":
        mean = np.asarray([1.0, math.log(0.75)])
        covariance = np.asarray([[0.09, 0.0], [0.0, 0.01]])
        threshold = 12.0
        residual_sigma = 0.12
    else:
        mean = np.asarray([math.log(2.0), math.log(0.08)])
        covariance = np.asarray([[0.01, 0.0], [0.0, 0.01]])
        threshold = 15.0
        residual_sigma = 0.025

    effects = rng.multivariate_normal(mean, covariance, size=8)
    for index, (intercept, log_slope) in enumerate(effects):
        response = intercept + np.exp(log_slope) * times
        response += rng.normal(0.0, residual_sigma, len(times))
        values = response if model == "linear" else np.exp(response)
        unit_ids.extend([f"U{index}"] * len(times))
        observation_times.extend(times.tolist())
        measurements.extend(values.tolist())
    return DegradationRequest(
        unit_ids=unit_ids,
        times=observation_times,
        measurements=measurements,
        threshold=threshold,
        threshold_direction="above",
        degradation_model=model,
        analysis_method="hierarchical_nlme",
        reliability_time=15.0,
        ci=0.90,
        n_monte_carlo=1000,
        n_bootstrap=n_bootstrap,
        seed=seed,
    )


def test_hierarchical_linear_recovers_population_without_second_life_fit(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError("hierarchical analysis must not fit projected life rows")

    monkeypatch.setattr(alt_router, "_fit_life_distribution", forbidden)
    monkeypatch.setattr(
        alt_router, "_fit_interval_censored_life_distribution", forbidden)

    request = _simulated_request()
    result = alt_router.degradation(request)
    fit = result["hierarchical_fit"]

    assert result["analysis_method"] == "hierarchical_nlme"
    assert result["distribution_fit"] is None
    assert result["distribution_fit_error"] is None
    assert fit["converged"] is True
    assert fit["population_parameters"]["mean_intercept"] == pytest.approx(1.0, abs=0.5)
    assert fit["population_parameters"]["median_slope_magnitude"] == pytest.approx(
        0.75, rel=0.25)
    assert fit["life_distribution"]["summary"]["B50"] == pytest.approx(
        (12.0 - 1.0) / 0.75, rel=0.30)
    assert fit["life_distribution"]["reliability"]["time"] == 15.0
    assert len(fit["life_distribution"]["curve_x"]) == 121
    assert len(result["paths"]) == 8
    assert fit["inference_status"] == "eligible"

    response_scale = max(
        float(np.std(request.measurements)),
        float(np.ptp(request.measurements)) / 4.0,
        1e-8,
    )
    expected_data_log_likelihood = (
        fit["log_likelihood_standardized"]
        - len(request.measurements) * math.log(response_scale)
    )
    assert fit["log_likelihood_response_scale"] == pytest.approx(
        expected_data_log_likelihood)
    assert fit["log_likelihood_data_scale"] == pytest.approx(
        expected_data_log_likelihood)
    assert fit["log_likelihood"] == pytest.approx(expected_data_log_likelihood)
    assert fit["AIC"] == pytest.approx(12 - 2 * expected_data_log_likelihood)
    assert fit["BIC"] == pytest.approx(
        math.log(8) * 6 - 2 * expected_data_log_likelihood)
    assert fit["BIC_sample_size"] == {
        "value": 8, "unit": "independent_units"}
    assert fit["diagnostics"]["projected_gradient_norm"] is not None
    assert fit["diagnostics"]["bound_contacts"] == []
    assert fit["diagnostics"]["quadrature_check"]["acceptable"] is True

    summary = result["life_data_summary"]
    assert summary["exact"] == summary["interval"] == summary["right_censored"] == 0
    assert summary["longitudinal_measurements"] == 24
    assert summary["likelihood"] == "joint_longitudinal_measurement"
    assert result["projection_uncertainty"]["likelihood_role"] == (
        "no_separate_life_likelihood")
    assert all(row["life_observation"] == "joint_longitudinal_measurements"
               for row in result["unit_table"])


def test_hierarchical_exponential_recovers_log_scale_model():
    request = _simulated_request(model="exponential")
    result = alt_router.degradation(request)
    fit = result["hierarchical_fit"]

    assert fit["response_scale"] == "log_measurement"
    assert fit["converged"] is True
    assert fit["population_parameters"]["mean_intercept"] == pytest.approx(
        math.log(2.0), abs=0.30)
    assert fit["population_parameters"]["median_slope_magnitude"] == pytest.approx(
        0.08, rel=0.30)
    assert fit["life_distribution"]["summary"]["B50"] == pytest.approx(
        math.log(15.0 / 2.0) / 0.08, rel=0.30)
    assert all(value > 0 for path in result["paths"] for value in path["fit_m"])
    logged = np.log(np.asarray(request.measurements))
    response_scale = max(float(np.std(logged)), float(np.ptp(logged)) / 4.0, 1e-8)
    expected_response_log_likelihood = (
        fit["log_likelihood_standardized"]
        - len(logged) * math.log(response_scale)
    )
    assert fit["log_likelihood_response_scale"] == pytest.approx(
        expected_response_log_likelihood)
    assert fit["log_likelihood_data_scale"] == pytest.approx(
        expected_response_log_likelihood - float(np.sum(logged)))
    if not fit["fit_eligible"]:
        assert fit["inference_status"] == "diagnostic_only"
        assert fit["uncertainty"]["diagnostics"]["status"] == "diagnostic_only"


def _standardized_linear_fit():
    request = _simulated_request()
    raw = np.asarray(request.measurements, dtype=float)
    center = float(np.median(raw))
    scale = max(float(np.std(raw)), float(np.ptp(raw)) / 4.0, 1e-8)
    units = []
    for unit_id in sorted(set(request.unit_ids)):
        mask = np.asarray(request.unit_ids) == unit_id
        units.append({
            "id": unit_id,
            "t": np.asarray(request.times)[mask],
            "y": (raw[mask] - center) / scale,
        })
    fitted = alt_router._fit_hierarchical_nlme(units, 1.0)
    assert fitted["fit_eligible"] is True
    return units, fitted, center, scale


def test_hierarchical_bootstrap_contract_and_independent_seed_stream(monkeypatch):
    units, fitted, center, scale = _standardized_linear_fit()
    calls = []

    def eligible_refit(_units, _direction, **kwargs):
        calls.append(kwargs)
        return fitted

    monkeypatch.setattr(alt_router, "_fit_hierarchical_nlme", eligible_refit)
    first_request = _simulated_request(n_bootstrap=20, seed=7)
    second_request = first_request.model_copy(update={"n_monte_carlo": 2000})
    first = alt_router._hierarchical_parametric_bootstrap(
        units, fitted, (12.0 - center) / scale, 1.0, center, scale,
        first_request, np.random.SeedSequence(99))
    second = alt_router._hierarchical_parametric_bootstrap(
        units, fitted, (12.0 - center) / scale, 1.0, center, scale,
        second_request, np.random.SeedSequence(99))

    assert first == second
    assert first["diagnostics"]["requested"] == 20
    assert first["diagnostics"]["successful"] == 20
    assert first["diagnostics"]["status"] == "partial"
    assert (
        "bootstrap_replication_count_below_100_has_unstable_percentile_endpoints"
        in first["diagnostics"]["warnings"]
    )
    assert first["diagnostics"]["refit_outcomes"]["eligible"] == 20
    assert all(call["n_starts"] == 3 and call["maxiter"] == 350
               for call in calls)
    assert first["summary_intervals"]["B10"][0] < first["summary_intervals"]["B10"][1]


def test_hierarchical_bootstrap_rejects_ineligible_refits(monkeypatch):
    units, fitted, center, scale = _standardized_linear_fit()
    ineligible = dict(fitted)
    ineligible["fit_eligible"] = False
    ineligible["diagnostics"] = dict(fitted["diagnostics"])
    ineligible["diagnostics"]["identifiability_warnings"] = [
        "random_effect_correlation_near_boundary"]
    monkeypatch.setattr(
        alt_router, "_fit_hierarchical_nlme",
        lambda *_args, **_kwargs: ineligible)
    request = _simulated_request(n_bootstrap=20)
    result = alt_router._hierarchical_parametric_bootstrap(
        units, fitted, (12.0 - center) / scale, 1.0, center, scale,
        request, np.random.SeedSequence(99))

    assert result["diagnostics"]["status"] == "failed"
    assert result["diagnostics"]["successful"] == 0
    assert result["diagnostics"]["refit_outcomes"]["ineligible_boundary"] == 20
    assert result["parameter_intervals"] == {}

    base_ineligible = dict(fitted)
    base_ineligible["fit_eligible"] = False
    suppressed = alt_router._hierarchical_parametric_bootstrap(
        units, base_ineligible, (12.0 - center) / scale, 1.0, center, scale,
        request, np.random.SeedSequence(99))
    assert suppressed["diagnostics"]["status"] == "diagnostic_only"
    assert suppressed["diagnostics"]["refit_outcomes"][
        "skipped_base_fit_ineligible"] == 20
    assert suppressed["summary_intervals"] == {}


def test_hierarchical_bootstrap_size_is_zero_or_at_least_twenty():
    with pytest.raises(ValidationError, match=r"0 \(disabled\) or at least 20"):
        _simulated_request(n_bootstrap=19)
    default_confidence = DegradationRequest(
        unit_ids=["A", "A"], times=[0.0, 1.0], measurements=[1.0, 2.0],
        threshold=3.0, n_bootstrap=0)
    assert default_confidence.ci == 0.95


def test_hierarchical_nonconvergence_fails_closed(monkeypatch):
    monkeypatch.setattr(
        alt_router, "_fit_hierarchical_nlme",
        lambda *_args, **_kwargs: {"converged": False, "diagnostics": {"reason": "test"}},
    )
    with pytest.raises(HTTPException) as exc_info:
        alt_router.degradation(_simulated_request())
    assert exc_info.value.status_code == 422
    assert "did not converge" in exc_info.value.detail["message"]


def test_hierarchical_rejects_unsupported_or_nonpositive_exponential_data():
    unsupported = _simulated_request()
    unsupported.degradation_model = "power"
    with pytest.raises(HTTPException, match="linear and exponential"):
        alt_router.degradation(unsupported)

    nonpositive = _simulated_request(model="exponential")
    nonpositive.measurements[0] = 0.0
    with pytest.raises(HTTPException, match="positive threshold and measurements"):
        alt_router.degradation(nonpositive)
