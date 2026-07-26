"""Tests for the lazy per-distribution plot payload (/life-data/plot) and the
slimmed /life-data/fit response (plots for the best distribution only)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import numpy as np
import pytest
from fastapi import HTTPException

from routers.life_data import (
    fit_distributions, single_distribution_plot,
)
from schemas import LifeDataFitRequest, SingleDistPlotRequest


def _failures():
    rng = np.random.default_rng(50)
    return (100 * rng.weibull(2.0, 25)).tolist()


def test_fit_ships_plots_for_best_distribution_only():
    out = fit_distributions(LifeDataFitRequest(failures=_failures()))
    best = out["best_distribution"]
    assert list(out["plots"].keys()) == [best]
    # The results table still covers every fitted distribution.
    assert len(out["results"]) > 1
    plot = out["plots"][best]
    assert "probability" in plot and "curves" in plot and "qq" in plot


def test_single_distribution_plot_matches_fit_shape():
    failures = _failures()
    out = single_distribution_plot(SingleDistPlotRequest(
        failures=failures, distribution="Lognormal_2P"))
    assert out["distribution"] == "Lognormal_2P"
    plot = out["plot"]
    assert "probability" in plot and "curves" in plot
    assert len(plot["curves"]["x"]) == len(plot["curves"]["sf"])
    assert len(plot["qq"]["theoretical"]) == len(failures)


def test_single_distribution_plot_consistent_with_fit_payload():
    # The lazily fetched payload must equal what /fit produces for the same
    # distribution (same fitter, same helper).
    failures = _failures()
    fit_out = fit_distributions(LifeDataFitRequest(
        failures=failures, distributions_to_fit=["Weibull_2P"]))
    lazy_out = single_distribution_plot(SingleDistPlotRequest(
        failures=failures, distribution="Weibull_2P"))
    a = fit_out["plots"]["Weibull_2P"]["curves"]["sf"]
    b = lazy_out["plot"]["curves"]["sf"]
    assert a == pytest.approx(b)


def test_single_distribution_plot_unknown_name_400():
    with pytest.raises(HTTPException) as exc:
        single_distribution_plot(SingleDistPlotRequest(
            failures=_failures(), distribution="Nope_2P"))
    assert exc.value.status_code == 400


def test_exponential_plot_exposes_exact_simultaneous_band_metadata():
    failures = [10.0, 14.0, 20.0, 25.0]
    censored = [25.0, 25.0]
    fit_out = fit_distributions(LifeDataFitRequest(
        failures=failures,
        right_censored=censored,
        distributions_to_fit=["Exponential_2P"],
        CI=0.95,
    ))
    row = fit_out["results"][0]
    plot = fit_out["plots"]["Exponential_2P"]
    assert row["confidence"]["available"] is True
    assert row["confidence"]["sample_design"] == "type_ii"
    assert row["confidence"]["band_scope"] == "simultaneous"
    assert plot["confidence"] == row["confidence"]
    assert len(plot["probability"]["line_lower"]) > 0
    assert len(plot["curves"]["sf_lower"]) > 0


def test_exponential_plot_exposes_unsupported_censoring_reason():
    out = single_distribution_plot(SingleDistPlotRequest(
        failures=[10.0, 14.0, 20.0, 25.0],
        right_censored=[16.0, 25.0],
        distribution="Exponential_2P",
        CI=0.95,
    ))
    plot = out["plot"]
    assert plot["confidence"]["available"] is False
    assert plot["confidence"]["reason"] == "arbitrary_right_censoring"
    assert "line_lower" not in plot["probability"]
    assert "sf_lower" not in plot["curves"]
