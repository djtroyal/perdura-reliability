"""Router contracts for statistical-semantics backlog item 20."""

import numpy as np
import pytest
from fastapi import HTTPException


def test_mann_whitney_router_defines_group_a_direction():
    from routers.hypothesis import RunRequest, run_test

    result = run_test(RunRequest(
        test="mann_whitney", group_a=[10, 11, 12], group_b=[1, 2, 3]))
    assert result["effect_size"] == pytest.approx(1.0)
    assert "group_a" in result["effect_size_direction"]


def test_repeated_measures_router_exposes_sphericity_corrections():
    from routers.hypothesis import RMAnovaRequest, run_rm_anova

    rng = np.random.default_rng(809)
    data = rng.normal(size=(70, 4)) * np.array([0.2, 1.0, 3.0, 8.0])
    result = run_rm_anova(RMAnovaRequest(data=data.tolist()))
    assert result["sphericity"]["reject_sphericity"] is True
    assert result["inference_basis"] == "greenhouse_geisser"
    assert result["corrections"]["huynh_feldt"]["p_value"] is not None


def test_mixed_router_handles_unequal_group_sizes_with_reml():
    from routers.hypothesis import MixedAnovaRequest, run_mixed_anova

    rng = np.random.default_rng(810)
    values, subjects, between, within = [], [], [], []
    for group, size in (("control", 4), ("treatment", 6)):
        for subject_index in range(size):
            subject = f"{group}-{subject_index}"
            subject_effect = rng.normal(0, 0.5)
            for condition_index, condition in enumerate(("pre", "mid", "post")):
                values.append(float(
                    subject_effect + condition_index + (group == "treatment") * 1.5
                    + rng.normal(0, 0.2)))
                subjects.append(subject)
                between.append(group)
                within.append(condition)
    result = run_mixed_anova(MixedAnovaRequest(
        values=values, subjects=subjects, between_factor=between,
        within_factor=within))
    assert result["model"]["estimation"].startswith("REML")
    assert sorted(result["model"]["group_sizes"].values()) == [4, 6]


def test_doe_router_rejects_three_level_input_and_reports_pb_capacity():
    from routers.doe import AnalyzeRequest, GenerateRequest, analyze, generate_design

    runs = [
        {"A": 0, "B": -1}, {"A": 1, "B": -1}, {"A": 2, "B": -1},
        {"A": 0, "B": 1}, {"A": 1, "B": 1}, {"A": 2, "B": 1},
    ]
    with pytest.raises(HTTPException) as exc:
        analyze(AnalyzeRequest(
            factor_names=["A", "B"], runs=runs,
            responses=[1, 2, 3, 2, 3, 4]))
    assert exc.value.status_code == 400
    assert "exactly 2 levels" in exc.value.detail

    pb = generate_design(GenerateRequest(design="plackett_burman", n_factors=63))
    assert pb["metadata"]["capacity"] == 63
    assert len(pb["runs"]) == 64


def test_warranty_router_preserves_fractional_group_weights():
    from routers.warranty import forecast
    from schemas import WarrantyForecastRequest

    result = forecast(WarrantyForecastRequest(
        quantities=[100.5, 120.0],
        returns=[[2.25, 3.5], [None, 1.75]],
        distribution="Weibull_2P", n_forecast_periods=2,
        n_parameter_draws=100, seed=12,
    ))
    assert result["observation_model"] == "period_grouped_interval_censored"
    assert result["n_failures"] == pytest.approx(7.5)
    assert result["legacy_exact_age_expansion_available"] is False
    assert result["failures"] == []
    assert result["fit"]["method"] == "weighted_grouped_interval_censored_MLE"
    assert result["forecast_interval"]["status"] == "ok"


def test_weibayes_router_contract_v2_orders_survival_bounds():
    from routers.life_data import weibayes
    from schemas import WeibayesRequest

    result = weibayes(WeibayesRequest(
        failures=[100, 150, 200, 250], right_censored=[175], beta=2.0))
    lower = np.asarray(result["curves"]["sf_lower"])
    central = np.asarray(result["curves"]["sf"])
    upper = np.asarray(result["curves"]["sf_upper"])
    assert result["response_contract_version"] == 2
    assert np.all(lower <= central)
    assert np.all(central <= upper)
