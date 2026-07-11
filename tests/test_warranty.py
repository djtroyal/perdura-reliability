"""Tests for reliability.Warranty (Nevada chart conversion + forecasting)."""

import numpy as np
import pytest
from reliability.Warranty import (
    nevada_to_life_data, nevada_to_grouped_life_data,
    fit_grouped_warranty_distribution, forecast_returns,
    forecast_parameter_interval,
)
from reliability.Fitters import Fit_Weibull_2P


@pytest.fixture
def reliawiki_chart():
    """ReliaWiki warranty example: Jun/Jul/Aug shipments, Jul/Aug/Sep returns."""
    quantities = [100, 140, 150]
    returns = [
        [3, 3, 5],
        [0, 2, 4],
        [0, 0, 4],
    ]
    return quantities, returns


# --- nevada_to_life_data ---

def test_total_failures(reliawiki_chart):
    failures, _ = nevada_to_life_data(*reliawiki_chart)
    assert len(failures) == 21


def test_failure_ages(reliawiki_chart):
    failures, _ = nevada_to_life_data(*reliawiki_chart)
    # lot 0: 3 units age 1, 3 units age 2, 5 units age 3
    # lot 1: 2 units age 1, 4 units age 2
    # lot 2: 4 units age 1
    counts = {age: int(np.sum(failures == age)) for age in (1, 2, 3)}
    assert counts[1] == 3 + 2 + 4
    assert counts[2] == 3 + 4
    assert counts[3] == 5


def test_suspensions(reliawiki_chart):
    _, right_censored = nevada_to_life_data(*reliawiki_chart)
    # lot 0: 89 units at age 3; lot 1: 134 at age 2; lot 2: 146 at age 1
    assert len(right_censored) == 89 + 134 + 146
    assert int(np.sum(right_censored == 3)) == 89
    assert int(np.sum(right_censored == 2)) == 134
    assert int(np.sum(right_censored == 1)) == 146


def test_none_cells_treated_as_zero():
    failures, right_censored = nevada_to_life_data(
        [100, 140], [[3, 3], [None, 2]])
    assert len(failures) == 8
    assert len(right_censored) == (100 - 6) + (140 - 2)


def test_returns_exceeding_quantity_raises():
    with pytest.raises(ValueError):
        nevada_to_life_data([5], [[10]])


def test_negative_returns_raises():
    with pytest.raises(ValueError):
        nevada_to_life_data([100, 100], [[3, -1], [0, 2]])


def test_negative_quantity_raises():
    with pytest.raises(ValueError):
        nevada_to_life_data([-5], [[0]])


def test_row_count_mismatch_raises():
    with pytest.raises(ValueError):
        nevada_to_life_data([100, 100], [[3, 3]])


def test_invalid_cell_raises():
    # returns[1][0] is calendar period 1, not after ship period 1
    with pytest.raises(ValueError):
        nevada_to_life_data([100, 100], [[3, 3], [1, 2]])


def test_fractional_counts_are_preserved_and_never_rounded():
    grouped = nevada_to_grouped_life_data([10.5], [[1.25, 2.5]])
    assert grouped["n_failures"] == pytest.approx(3.75)
    assert grouped["n_censored"] == pytest.approx(6.75)
    assert grouped["interval_failures"][0] == {
        "lower": 0.0, "upper": 1.0, "count": 1.25,
        "ship_lot": 0, "return_period": 1,
    }
    with pytest.raises(ValueError, match="integral counts"):
        nevada_to_life_data([10.5], [[1.25, 2.5]])


def test_grouped_weibull_fit_uses_interval_likelihood(reliawiki_chart):
    fit = fit_grouped_warranty_distribution(
        *reliawiki_chart, distribution="Weibull_2P")
    assert fit.converged
    assert fit.params["eta"] > 0 and fit.params["beta"] > 0
    assert np.isfinite(fit.loglik)
    forecast, totals = forecast_returns(
        *reliawiki_chart, fit.distribution, n_forecast_periods=3)
    assert forecast.shape == (3, 3)
    assert np.all(totals >= 0)


def test_grouped_forecast_parameter_interval_is_seeded(reliawiki_chart):
    fit = fit_grouped_warranty_distribution(*reliawiki_chart)
    interval = forecast_parameter_interval(
        *reliawiki_chart, fit, 2, n_draws=100, CI=0.90, seed=44)
    repeat = forecast_parameter_interval(
        *reliawiki_chart, fit, 2, n_draws=100, CI=0.90, seed=44)
    assert interval == repeat
    assert interval["status"] == "ok"
    assert np.all(np.asarray(interval["lower"]) <= np.asarray(interval["upper"]))


# --- forecast_returns ---

def test_forecast_returns(reliawiki_chart):
    quantities, returns = reliawiki_chart
    failures, right_censored = nevada_to_life_data(quantities, returns)
    fit = Fit_Weibull_2P(failures=failures, right_censored=right_censored,
                         show_probability_plot=False)

    forecast, totals = forecast_returns(quantities, returns,
                                        fit.distribution, 3)

    assert forecast.shape == (3, 3)
    assert np.all(forecast >= 0)
    np.testing.assert_allclose(totals, forecast.sum(axis=0))

    # Each lot's period-1 forecast must be below its surviving count
    surviving = [89, 134, 146]
    for i in range(3):
        assert forecast[i, 0] < surviving[i]


def test_forecast_invalid_periods(reliawiki_chart):
    quantities, returns = reliawiki_chart
    failures, right_censored = nevada_to_life_data(quantities, returns)
    fit = Fit_Weibull_2P(failures=failures, right_censored=right_censored,
                         show_probability_plot=False)
    with pytest.raises(ValueError):
        forecast_returns(quantities, returns, fit.distribution, 0)
