"""Backend contract tests for complete Crow-AMSAA inference and plotting data."""

import math
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError
from scipy.stats import gamma as gamma_distribution

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from routers import growth as growth_router  # noqa: E402
from schemas import GrowthRequest  # noqa: E402


NIST_EVENTS = [5, 40, 43, 175, 389, 712, 747, 795, 1299, 1478]


def _fit(**updates):
    payload = {
        "times": NIST_EVENTS,
        "T": 1500,
        "termination": "time",
        "model": "crow_amsaa",
    }
    payload.update(updates)
    return growth_router.fit_growth(GrowthRequest(**payload))


def test_explicit_termination_does_not_infer_failure_from_equal_endpoint():
    events = [5, 10, 20, 40]
    with pytest.raises(ValidationError, match="explicit termination"):
        GrowthRequest(times=events, T=40)
    explicit_time = growth_router.fit_growth(GrowthRequest(
        times=events, T=40, termination="time"))
    explicit_failure = growth_router.fit_growth(GrowthRequest(
        times=events, T=40, termination="failure"))

    assert explicit_time["termination"] == "time"
    assert explicit_failure["termination"] == "failure"
    # The raw MLE happens to be identical because the last log term is zero;
    # the observation design still changes the pivot degrees of freedom and
    # the termination-specific modified estimate.
    assert explicit_time["trend_test"]["degrees_of_freedom"] == 8
    assert explicit_failure["trend_test"]["degrees_of_freedom"] == 6
    assert explicit_time["parameter_sets"]["modified_mle"]["beta"] != pytest.approx(
        explicit_failure["parameter_sets"]["modified_mle"]["beta"])


def test_nist_raw_and_modified_estimators_are_both_exposed():
    mle = _fit(estimator="mle")
    modified = _fit(estimator="modified_mle")

    assert mle["beta"] == pytest.approx(0.5372288660341876, rel=1e-11)
    assert mle["parameter_sets"]["mle"]["beta"] == pytest.approx(mle["beta"])
    assert mle["parameter_sets"]["modified_mle"]["beta"] == pytest.approx(
        0.4835059794307689, rel=1e-11)
    assert modified["estimator"] == "modified_mle"
    assert modified["parameter_sets"]["curves_use"] == "modified_mle"
    assert modified["beta"] == pytest.approx(0.4835059794307689, rel=1e-11)
    assert modified["mtbf_instantaneous"] == pytest.approx(
        310.2340123623597, rel=1e-10)
    beta_interval = modified["confidence"]["intervals"]["beta"]
    assert beta_interval["estimate"] == pytest.approx(modified["beta"])
    assert beta_interval["reported_estimate_basis"] == "selected_modified_mle"
    assert beta_interval["interval_reference_estimate"] == pytest.approx(
        mle["beta"])
    assert beta_interval["interval_reference_basis"] == (
        "raw_mle_interval_statistic")
    mtbf_interval = modified["confidence"]["intervals"][
        "instantaneous_mtbf_at_T"]
    assert mtbf_interval["estimate"] == pytest.approx(
        modified["mtbf_instantaneous"])
    assert mtbf_interval["interval_reference_estimate"] == pytest.approx(
        mle["mtbf_instantaneous"])
    mtbf_lcb = modified["confidence"]["one_sided_bounds"][
        "instantaneous_mtbf_at_T_lower"]
    assert mtbf_lcb["estimate"] == pytest.approx(
        modified["mtbf_instantaneous"])
    assert mtbf_lcb["reported_estimate_basis"] == "selected_modified_mle"
    assert mtbf_lcb["interval_reference_estimate"] == pytest.approx(
        mle["mtbf_instantaneous"])
    assert mtbf_lcb["interval_reference_basis"] == (
        "raw_mle_interval_statistic")
    # The plotted model must use the selected parameterization.
    assert modified["model_curve"]["n"][-1] == pytest.approx(10.0)
    assert modified["model_curve"]["n"] != mle["model_curve"]["n"]


def test_configurable_inference_metadata_and_handbook_trend_test():
    result = _fit(CI=.90, gof_significance=.05)

    assert result["confidence"]["level"] == pytest.approx(.90)
    beta_interval = result["confidence"]["intervals"]["beta"]
    assert beta_interval["lower"] < result["beta"] < beta_interval["upper"]
    intensity_interval = result["confidence"]["intervals"][
        "instantaneous_failure_intensity_at_T"]
    assert intensity_interval["available"] is True
    assert intensity_interval["method"] == (
        "crow_exact_time_terminated_bessel_poisson_mixture")
    assert intensity_interval["coverage_status"] == (
        "exact_under_model_conservative")
    mtbf_lcb = result["confidence"]["one_sided_bounds"][
        "instantaneous_mtbf_at_T_lower"]
    equivalent_two_sided = _fit(CI=.80)["confidence"]["intervals"][
        "instantaneous_mtbf_at_T"]
    assert mtbf_lcb["side"] == "lower"
    assert mtbf_lcb["confidence_level"] == pytest.approx(.90)
    assert mtbf_lcb["bound"] == pytest.approx(
        equivalent_two_sided["lower"])
    assert mtbf_lcb["coverage_status"] == (
        "exact_under_model_conservative")
    assert "instantaneous_mtbf_at_T_lower" not in result["confidence"][
        "intervals"]

    trend = result["trend_test"]
    assert trend["method"].startswith("Military Handbook")
    assert trend["statistic"] == pytest.approx(37.228081483483166)
    assert trend["degrees_of_freedom"] == 20
    assert trend["p_value_improving"] == pytest.approx(0.01098635711579664)
    assert trend["p_value_two_sided"] == pytest.approx(0.02197271423159328)
    assert trend["decision"] == "reject"

    gof = result["goodness_of_fit"]
    assert gof["significance"] == pytest.approx(.05)
    assert gof["decision"] in {"reject", "fail_to_reject"}
    assert "accept" not in gof["decision_text"].lower()

    legacy_aliases = {
        "CvM", "cvm_critical", "beta_lower", "beta_upper",
        "mtbf_cumulative_lower", "mtbf_cumulative_upper",
        "mtbf_instantaneous_lower", "mtbf_instantaneous_upper", "ci_level",
        "failure_terminated", "termination_inferred",
    }
    assert legacy_aliases.isdisjoint(result)


def test_cvm_critical_values_interpolate_sample_size_and_reject_bad_alpha():
    assert growth_router._cvm_critical(45, .05) == pytest.approx(.219)
    assert growth_router._cvm_critical(150, .10) == pytest.approx(.173)
    assert growth_router._cvm_critical(2, .01) == pytest.approx(.186)
    assert growth_router._cvm_critical(45, .01) == pytest.approx(.33)
    assert _fit(gof_significance=.01)["goodness_of_fit"][
        "critical_value"] == pytest.approx(.32)
    with pytest.raises(ValueError, match="significance"):
        growth_router._cvm_critical(10, .025)


def test_trend_direction_and_directional_p_value_use_the_same_null_tail():
    T = 100.0
    # Sum log(T/t_i)=4.5, so raw beta=5/4.5>1 while the time-terminated
    # modified beta=4/4.5<1.  This is the small-sample disagreement that used
    # to make the displayed direction contradict its directional p-value.
    events = [T * math.exp(-gap) for gap in (1.3, 1.1, .9, .7, .5)]
    result = growth_router.fit_growth(GrowthRequest(
        times=events, T=T, termination="time", estimator="modified_mle"))
    trend = result["trend_test"]

    assert result["beta"] < 1
    assert result["parameter_sets"]["mle"]["beta"] > 1
    assert trend["observed_direction"] == "worsening"
    assert trend["directional_p_value"] == pytest.approx(
        trend["p_value_worsening"])
    assert trend["directional_p_value"] == pytest.approx(min(
        trend["p_value_improving"], trend["p_value_worsening"]))
    assert trend["shape_for_direction"] == pytest.approx(
        result["parameter_sets"]["mle"]["beta"])
    assert trend["direction_basis"] == (
        "smaller one-sided chi-square null tail")


def test_grouped_handbook_benchmark_and_plot_context():
    result = growth_router.fit_growth(GrowthRequest(
        data_mode="grouped",
        times=[],
        grouped_endpoints=[20, 40, 60, 80, 100],
        grouped_counts=[13, 16, 5, 8, 7],
        termination="time",
        model="crow_amsaa",
        CI=.95,
        gof_significance=.10,
    ))

    assert result["data_mode"] == "grouped"
    assert result["termination"] == "time"
    assert result["beta"] == pytest.approx(.7528508868, rel=3e-8)
    assert result["Lambda"] == pytest.approx(1.5293056974, rel=1e-7)
    assert result["interval_context"]["expected_count"] == pytest.approx([
        14.58733284, 9.99406590, 8.77483836, 8.06635677, 7.57740613,
    ], rel=1e-7)
    # The endpoint intensity is not the final interval's fitted average.
    assert result["instantaneous_failure_intensity"] == pytest.approx(
        .3688969, rel=2e-7)
    assert result["mtbf_instantaneous"] == pytest.approx(2.710784, rel=2e-7)
    assert result["interval_context"]["fitted_average_intensity"][-1] == pytest.approx(
        .3788703, rel=2e-7)
    final_interval = result["grouped_final_interval"]
    assert final_interval["average_mtbf"] == pytest.approx(2.6394256, rel=2e-7)
    profile_interval = final_interval["target_profile"][
        "average_mtbf_interval"]
    handbook_interval = final_interval["handbook_approximate"][
        "average_mtbf_interval"]
    assert profile_interval["available"] is True
    assert (profile_interval["lower"]
            < final_interval["average_mtbf"]
            < profile_interval["upper"])
    assert profile_interval["coverage_status"] == (
        "asymptotic_target_profile_likelihood")
    assert handbook_interval["available"] is True
    assert handbook_interval["coverage_status"] == (
        "approximate_grouped_handbook")
    handbook_lcb = final_interval["handbook_approximate"][
        "average_mtbf_one_sided_lower_bound"]
    assert handbook_lcb["side"] == "lower"
    assert handbook_lcb["confidence_level"] == pytest.approx(.95)
    assert handbook_lcb["bound"] < final_interval["average_mtbf"]
    assert handbook_lcb["coverage_status"] == (
        "approximate_grouped_handbook")
    assert handbook_lcb["interval_reference_basis"] == (
        "grouped_mle_handbook_crow_coefficient_reference")
    assert profile_interval["method"] != handbook_interval["method"]
    confidence_intervals = result["confidence"]["intervals"]
    assert "final_interval_average_mtbf_target_profile" in confidence_intervals
    assert ("final_interval_average_mtbf_handbook_approximate"
            in confidence_intervals)
    assert "final_interval_average_mtbf" not in confidence_intervals
    assert result["scatter"]["n"] == [13, 29, 34, 42, 49]
    assert len(result["intensity_curve"]["t"]) == len(
        result["intensity_curve"]["instantaneous"])
    gof = result["goodness_of_fit"]
    assert gof["method"].startswith("Pearson chi-square")
    assert gof["degrees_of_freedom"] == 3
    assert len(gof["pooled_intervals"]) == 5
    assert gof["decision"] in {"reject", "fail_to_reject"}
    assert result["confidence"]["intervals"][
        "instantaneous_mtbf_at_T"]["coverage_status"] == (
            "diagnostic_not_target_calibrated")


def test_prediction_is_conditional_nhpp_continuation_not_frozen_hpp():
    horizon = 500
    order = 2
    probability = .80
    result = _fit(
        prediction_horizon=horizon,
        prediction_failure_count=order,
        prediction_probability=probability,
    )
    prediction = result["prediction"]
    expected = result["Lambda"] * (
        (result["T"] + horizon) ** result["beta"]
        - result["T"] ** result["beta"])
    expected_event_time = (
        result["T"] ** result["beta"]
        + gamma_distribution.ppf(probability, a=order) / result["Lambda"]
    ) ** (1 / result["beta"])

    assert prediction["parameter_uncertainty_included"] is False
    assert prediction["horizon"]["expected_failures"] == pytest.approx(expected)
    assert prediction["horizon"]["probability_no_failures"] == pytest.approx(
        math.exp(-expected))
    assert prediction["future_event"]["absolute_time"] == pytest.approx(
        expected_event_time)


def test_plot_and_prediction_math_is_invariant_to_extreme_time_units():
    scale = 1e100
    base = _fit(prediction_horizon=500)
    scaled = growth_router.fit_growth(GrowthRequest(
        times=[time * scale for time in NIST_EVENTS],
        T=1500 * scale,
        termination="time",
        prediction_horizon=500 * scale,
    ))

    assert scaled["beta"] == pytest.approx(base["beta"], rel=1e-12)
    assert scaled["model_curve"]["n"] == pytest.approx(
        base["model_curve"]["n"], rel=1e-11)
    assert scaled["mtbf_instantaneous"] / scale == pytest.approx(
        base["mtbf_instantaneous"], rel=1e-11)
    assert scaled["prediction"]["horizon"]["expected_failures"] == pytest.approx(
        base["prediction"]["horizon"]["expected_failures"], rel=1e-11)
    assert (scaled["prediction"]["future_event"]["absolute_time"] / scale
            == pytest.approx(
                base["prediction"]["future_event"]["absolute_time"], rel=1e-11))


def test_interval_context_preserves_adjacent_float_expected_count():
    base = 1e16
    adjacent = float(np.nextafter(base, math.inf))
    result = growth_router.fit_growth(GrowthRequest(
        times=[1.0, base, adjacent], T=2 * base, termination="time"))

    index = result["interval_context"]["interval_end"].index(adjacent)
    assert result["interval_context"]["expected_count"][index] > 0


def test_missing_core_interval_contract_fails_closed_without_synthetic_bounds():
    class CoreWithoutBounds:
        n = 5
        T = 100.0
        beta = 0.8
        Lambda = 0.1
        growth_rate = 0.2
        instantaneous_failure_intensity = 0.04
        instantaneous_MTBF = 25.0
        cumulative_MTBF = 20.0

    confidence = growth_router._confidence_metadata(CoreWithoutBounds(), .95)
    for key in (
        "instantaneous_failure_intensity_at_T",
        "cumulative_mtbf_at_T",
        "instantaneous_mtbf_at_T",
    ):
        assert confidence["intervals"][key]["available"] is False
        assert confidence["intervals"][key]["coverage_status"] == "unavailable"


def test_unrepresentable_scale_is_json_safe_and_log_scale_is_retained():
    scale = 1e300
    result = growth_router.fit_growth(GrowthRequest(
        times=[.8 * scale, .9 * scale, .95 * scale],
        T=scale,
        termination="time",
    ))

    assert result["Lambda"] is None
    assert result["scale_representable"] is False
    assert result["confidence"]["intervals"]["Lambda"]["estimate"] is None
    assert result["confidence"]["intervals"]["Lambda"][
        "coverage_status"] == "unavailable"
    assert math.isfinite(result["log_Lambda"])
    assert all(math.isfinite(value) for value in result["model_curve"]["n"])
    json.dumps(result, allow_nan=False)


def test_ties_are_retained_with_context_warning_and_aggregated_intervals():
    result = growth_router.fit_growth(GrowthRequest(
        times=[5, 16.5, 16.5, 30, 50], T=60, termination="time"))
    assert result["scatter"]["t"].count(16.5) == 2
    tied_index = result["interval_context"]["interval_end"].index(16.5)
    assert result["interval_context"]["observed_count"][tied_index] == 2
    assert any("Tied event times" in warning
               for warning in result["diagnostics"]["warnings"])


def test_failure_terminated_uses_exact_product_interval_not_profile_approximation():
    failure_result = growth_router.fit_growth(GrowthRequest(
        times=[5, 12, 22, 38, 60], termination="failure"))
    interval = failure_result["confidence"]["intervals"][
        "instantaneous_mtbf_at_T"]

    assert interval["method"] == "exact_failure_terminated_independent_gamma_product"
    assert interval["status"] == "exact"
    assert interval["coverage_status"] == "exact_under_model"
    assert not failure_result["confidence"]["warnings"]

    time_result = growth_router.fit_growth(GrowthRequest(
        times=[5, 12, 22, 38, 60], T=70, termination="time"))
    time_interval = time_result["confidence"]["intervals"][
        "instantaneous_mtbf_at_T"]
    assert time_interval["method"] == (
        "crow_exact_time_terminated_bessel_poisson_mixture")
    assert time_interval["status"] == (
        "exact_conservative_due_to_discrete_failure_count")
    assert time_interval["coverage_status"] == (
        "exact_under_model_conservative")


@pytest.mark.parametrize("payload, phrase", [
    ({"times": [2, 1]}, "non-decreasing"),
    ({"data_mode": "grouped", "grouped_endpoints": [10, 20],
      "grouped_counts": [1, 2]}, "at least 3"),
    ({"data_mode": "grouped", "grouped_endpoints": [10, 20, 30],
      "grouped_counts": [1, -1, 2]}, "cannot be negative"),
    ({"data_mode": "grouped", "grouped_endpoints": [10, 20, 30],
      "grouped_counts": [2, 0, 0]}, "at least 2 intervals"),
    ({"times": [1, 2], "T": 3, "termination": "failure"},
     "final failure time"),
])
def test_growth_schema_rejects_ambiguous_or_invalid_designs(payload, phrase):
    with pytest.raises(ValidationError, match=phrase):
        GrowthRequest(**payload)
