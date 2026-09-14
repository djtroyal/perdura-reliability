"""Warranty endpoint precision and uncertainty interpretation regressions."""
import numpy as np
import pytest

from routers.warranty import forecast
from schemas import WarrantyForecastRequest
from reliability.Warranty import fit_grouped_warranty_distribution, forecast_returns


def test_warranty_api_preserves_precision_and_discloses_uncertainty():
    req = WarrantyForecastRequest(
        quantities=[100, 140, 150],
        returns=[[3, 3, 5], [0, 2, 4], [0, 0, 4]],
        distribution='Exponential_1P', n_forecast_periods=3,
        n_parameter_draws=100, seed=41,
    )
    result = forecast(req)
    fitted = fit_grouped_warranty_distribution(
        req.quantities, req.returns, distribution=req.distribution)
    expected, totals = forecast_returns(req.quantities, req.returns, fitted.distribution, 3)
    np.testing.assert_allclose(result['forecast'], expected, rtol=1e-13)
    np.testing.assert_allclose(result['totals'], totals, rtol=1e-13)
    metadata = result['analysis_metadata']
    assert metadata['engine_revision'] == 3
    assert metadata['uncertainty']['kind'] == 'parameter_only_interval_for_conditional_mean'
    assert 'future_count_variation' in metadata['uncertainty']['excludes']
    assert metadata['uncertainty']['requested'] == 100
    assert metadata['uncertainty']['successful'] <= 100
    assert metadata['identifiability'] == 'not_separately_assessed'


def test_warranty_heat_exchanger_published_point_estimate():
    # Tian et al. (2020), heat exchanger example, PDF p.24. The interval
    # likelihood must retain 1, 1, 6 failures and 19,992 survivors at year 3.
    fitted = fit_grouped_warranty_distribution([20000], [[1, 1, 6]])
    assert fitted.params['beta'] == pytest.approx(2.531, abs=0.002)
    assert fitted.params['eta'] == pytest.approx(66.058, abs=0.05)
    # Independently solve analytic likelihood scores using decimal arithmetic.
    # The paper's printed probability 0.00797 differs from its likelihood's
    # stationary solution; do not round the implementation to that printed value.
    from decimal import Decimal as D, localcontext
    with localcontext() as context:
        context.prec = 50

        def score(log_eta, log_beta):
            beta = log_beta.exp()
            survival, d_eta, d_beta = [D(1)], [D(0)], [D(0)]
            for age in (1, 2, 3):
                log_time = D(age).ln() - log_eta
                hazard = (beta * log_time).exp()
                sf = (-hazard).exp()
                survival.append(sf)
                d_eta.append(beta * hazard * sf)
                d_beta.append(-beta * log_time * hazard * sf)
            return [sum(D(n) * (derivative[i - 1] - derivative[i])
                        / (survival[i - 1] - survival[i])
                        for i, n in enumerate((1, 1, 6), 1))
                    + D(19992) * derivative[3] / survival[3]
                    for derivative in (d_eta, d_beta)]

        x, y, step = D(66).ln(), D('2.53').ln(), D('1e-15')
        for _ in range(8):
            a, b = score(x, y)
            aa, cc = [(u - v) / (2 * step) for u, v in
                      zip(score(x + step, y), score(x - step, y))]
            bb, dd = [(u - v) / (2 * step) for u, v in
                      zip(score(x, y + step), score(x, y - step))]
            determinant = aa * dd - bb * cc
            x, y = (x - (dd * a - bb * b) / determinant,
                    y - (-cc * a + aa * b) / determinant)
        eta, beta = x.exp(), y.exp()
        expected = D(1) - (-((D(10) / eta)**beta - (D(3) / eta)**beta)).exp()
    assert fitted.params['eta'] == pytest.approx(float(eta), rel=1e-6)
    assert fitted.params['beta'] == pytest.approx(float(beta), rel=1e-6)
    _, totals = forecast_returns([20000], [[1, 1, 6]], fitted.distribution, 7)
    assert totals.sum() / 19992 == pytest.approx(float(expected), rel=1e-6)
