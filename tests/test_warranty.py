"""Tests for reliability.Warranty (Nevada chart conversion + forecasting)."""

import numpy as np
import pytest
from reliability.Warranty import (
    nevada_to_life_data, nevada_to_grouped_life_data,
    fit_grouped_warranty_distribution, forecast_returns,
    forecast_parameter_interval,
)
from reliability.Fitters import Fit_Weibull_2P
from reliability.Distributions import (
    Exponential_Distribution, Weibull_Distribution, Normal_Distribution,
    Beta_Distribution,
)
from reliability.Warranty import conditional_interval_probabilities


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


def test_fractional_sparse_chart_has_stable_observed_information():
    quantities = [100.5, 120.0]
    returns = [[2.25, 3.5], [None, 1.75]]
    fit = fit_grouped_warranty_distribution(quantities, returns)

    assert fit.converged
    assert fit.covariance_theta is not None
    assert np.all(np.linalg.eigvalsh(fit.covariance_theta) > 0)
    interval = forecast_parameter_interval(
        quantities, returns, fit, 2, n_draws=100, seed=12)
    assert interval["status"] == "ok"


def test_grouped_warranty_tail_fit_matches_analytic_exponential_mle():
    fitted = fit_grouped_warranty_distribution(
        [101], [[100] + [0] * 39 + [1]], distribution='Exponential_1P')
    rate = np.log1p(101 / 40)
    expected_loglik = 101 * np.log(-np.expm1(-rate)) - 40 * rate
    assert fitted.converged
    assert fitted.params['Lambda'] == pytest.approx(rate, rel=1e-6)
    assert fitted.loglik == pytest.approx(expected_loglik, abs=1e-8)


def test_grouped_warranty_rejects_invalid_likelihood_plateau(monkeypatch):
    monkeypatch.setattr(
        'reliability.Warranty._log_interval_probability',
        lambda frozen, lower, upper: np.full_like(lower, -np.inf))
    with pytest.raises(ValueError, match='did not converge'):
        fit_grouped_warranty_distribution([3], [[3]], distribution='Exponential_1P')


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


@pytest.mark.parametrize('age', [1, 50, 1000])
def test_forecast_exponential_memorylessness_in_extreme_tail(age):
    forecast, totals = forecast_returns(
        [1], [[0] * age], Exponential_Distribution(Lambda=1), 4)
    expected = np.exp(-np.arange(4)) * -np.expm1(-1)
    np.testing.assert_allclose(totals, expected, rtol=1e-13)
    np.testing.assert_allclose(forecast[0], expected, rtol=1e-13)
    assert totals.sum() == pytest.approx(-np.expm1(-4), abs=1e-14)


def test_forecast_weibull_matches_conditional_hazard_integrals():
    ages = np.array([100.0, 100.01, 100.1, 101.0])
    distribution = Weibull_Distribution(eta=2, beta=2)
    actual = conditional_interval_probabilities(distribution, ages)
    hazard_increments = (ages**2 - ages[0]**2) / 4
    expected = np.exp(-hazard_increments[:-1]) * -np.expm1(
        -np.diff(hazard_increments))
    np.testing.assert_allclose(actual, expected, rtol=1e-10)


def test_conditional_probability_bins_conserve_mass_and_match_central_cdf():
    distribution = Normal_Distribution(mu=20, sigma=3)
    ages = np.array([18.0, 19.0, 21.0, 25.0])
    bins = conditional_interval_probabilities(distribution, ages)
    expected = np.diff(distribution._cdf(ages)) / distribution._sf(ages[0])
    np.testing.assert_allclose(bins, expected, rtol=1e-13)
    whole = conditional_interval_probabilities(distribution, ages[[0, -1]])
    assert bins.sum() == pytest.approx(whole[0], rel=1e-13)


def test_conditional_probabilities_handle_support_end_without_nan():
    distribution = Beta_Distribution(alpha=2, beta=3)
    bins = conditional_interval_probabilities(distribution, [0.5, 1, 2])
    np.testing.assert_allclose(bins, [1, 0], atol=0)
    with pytest.raises(ValueError, match='condition on survival'):
        conditional_interval_probabilities(distribution, [1, 2])


def test_cdf_only_distribution_cannot_silently_lose_tail():
    class CDFOnly:
        def _cdf(self, x):
            return -np.expm1(-np.asarray(x))

    with pytest.raises(ValueError, match='stable _logsf'):
        forecast_returns([1], [[0] * 50], CDFOnly(), 1)


def test_grouped_adapter_preserves_log_survival_in_extreme_tail():
    from scipy.stats import expon
    from reliability.Warranty import _CDFAdapter
    _, totals = forecast_returns([1], [[0] * 1000], _CDFAdapter(expon()), 1)
    assert totals[0] == pytest.approx(-np.expm1(-1), rel=1e-13)
