"""Tests for reliability.Utils."""

import numpy as np
import pytest
from reliability.Utils import (
    median_rank_approximation,
    rank_adjustment,
    AICc,
    BIC,
    FitConvergenceError,
    anderson_darling,
    negative_log_likelihood,
    optimizer_result_diagnostics,
    select_best_optimizer_result,
    xy_transform,
)
from reliability.Distributions import Weibull_Distribution


def test_median_rank_basic():
    ranks = np.array([1, 2, 3])
    mr = median_rank_approximation(ranks, 3)
    assert mr.shape == (3,)
    assert np.all(mr > 0) and np.all(mr < 1)
    assert mr[0] < mr[1] < mr[2]


def test_median_rank_bernard():
    # Bernard's approximation: (j - 0.3) / (n + 0.4)
    ranks = np.array([1, 2, 3, 4, 5])
    n = 5
    expected = (ranks - 0.3) / (n + 0.4)
    result = median_rank_approximation(ranks, n)
    np.testing.assert_allclose(result, expected)


def test_rank_adjustment_no_censored():
    failures = np.array([10.0, 20.0, 30.0])
    ranks, n = rank_adjustment(failures, None)
    assert n == 3
    np.testing.assert_array_equal(ranks, [1, 2, 3])


def test_rank_adjustment_with_censored():
    failures = np.array([10.0, 30.0])
    censored = np.array([20.0])
    ranks, n = rank_adjustment(failures, censored)
    assert n == 3
    assert len(ranks) == 2


def test_aicc_increases_with_params():
    loglik = -100.0
    n = 50
    aic1 = AICc(loglik, 1, n)
    aic2 = AICc(loglik, 2, n)
    assert aic2 > aic1


@pytest.mark.parametrize("n,k", [(3, 2), (2, 2), (1, 2)])
def test_aicc_is_ineligible_when_small_sample_correction_is_undefined(n, k):
    assert np.isinf(AICc(-10.0, k, n))


def test_bic_increases_with_params():
    loglik = -100.0
    n = 50
    bic1 = BIC(loglik, 1, n)
    bic2 = BIC(loglik, 2, n)
    assert bic2 > bic1


def test_negative_log_likelihood_preserves_extreme_tail_contributions():
    params = [1.0, 2.0]

    failure_nll = negative_log_likelihood(
        params, Weibull_Distribution, np.array([100.0])
    )
    expected_failure_nll = 10000.0 - np.log(2.0) - np.log(100.0)
    assert failure_nll == pytest.approx(expected_failure_nll, rel=1e-12)

    censored_nll = negative_log_likelihood(
        params,
        Weibull_Distribution,
        np.array([], dtype=float),
        right_censored=np.array([100.0]),
    )
    assert censored_nll == pytest.approx(10000.0, rel=1e-12)


def test_optimizer_diagnostics_require_success_and_report_boundary_contact():
    from scipy.optimize import OptimizeResult

    objective = lambda x: float((x[0] - 1.0) ** 2)
    result = OptimizeResult(
        x=np.array([0.0]), fun=1.0, success=False, status=1,
        message='iteration limit',
    )
    diagnostics = optimizer_result_diagnostics(
        result, 'test', objective, bounds=[(0.0, None)]
    )
    assert diagnostics['converged'] is False
    assert diagnostics['gradient_finite'] is True
    assert diagnostics['boundary_parameters'] == [0]

    with pytest.raises(FitConvergenceError):
        select_best_optimizer_result(
            [('test', result)], objective, bounds=[(0.0, None)]
        )


def test_anderson_darling_returns_float():
    from scipy.stats import weibull_min
    dist = weibull_min(c=2.0, scale=100.0)
    failures = np.sort(np.array([50.0, 80.0, 100.0, 120.0, 150.0]))
    ad = anderson_darling(failures, dist.cdf)
    assert isinstance(ad, float)
    assert ad >= 0


def test_xy_transform_weibull():
    x_t, y_t, x_lbl, y_lbl = xy_transform('Weibull_2P')
    x = np.array([100.0, 200.0])
    y = np.array([0.3, 0.7])
    assert x_t(x).shape == (2,)
    assert y_t(y).shape == (2,)


def test_xy_transform_normal():
    x_t, y_t, x_lbl, y_lbl = xy_transform('Normal_2P')
    x = np.array([10.0, 20.0])
    y = np.array([0.2, 0.8])
    assert x_t(x).shape == (2,)


def test_xy_transform_unknown_returns_identity():
    # Unknown distributions fall through to identity transforms
    x_t, y_t, x_lbl, y_lbl = xy_transform('Unknown_dist')
    x = np.array([1.0, 2.0])
    np.testing.assert_array_equal(x_t(x), x)


def test_xy_transform_gumbel_min_ev_paper():
    # Gumbel_Distribution is the MINIMUM extreme value form (gumbel_l), whose
    # CDF F = 1 - exp(-exp(z)) linearizes as ln(-ln(1-F)) = z. (The previous
    # transform -ln(-ln F) was the maximum-EV paper — wrong distribution.)
    x_t, y_t, x_lbl, y_lbl = xy_transform('Gumbel_2P')
    z = np.array([-2.0, -0.5, 0.0, 1.0])
    F = 1 - np.exp(-np.exp(z))
    np.testing.assert_allclose(y_t(F), z, rtol=1e-12)
    assert y_lbl == 'ln(-ln(1-F))'
    x = np.array([1.0, 2.0])
    np.testing.assert_array_equal(x_t(x), x)
