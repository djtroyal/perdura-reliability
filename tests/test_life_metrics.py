"""Analytic independent oracles for conditional life and interference tails."""
import math
import numpy as np
import pytest
from scipy import stats

from reliability.Distributions import (
    Weibull_Distribution, Exponential_Distribution, Normal_Distribution,
    Lognormal_Distribution, Beta_Distribution, Gamma_Distribution,
)
from reliability.Life_metrics import (
    conditional_survival, remaining_life, interference_probability,
)


def test_reference_conditional_remaining_life():
    assert remaining_life(Weibull_Distribution(72., 2.6), 24., .95) == pytest.approx(6.673097508738255, rel=1e-13)


@pytest.mark.parametrize('scale', [1e-30, 1., 3600., 1e30])
def test_remaining_life_and_conditional_survival_scale_invariant(scale):
    d = Weibull_Distribution(72. * scale, 2.6)
    delta = remaining_life(d, 24. * scale, .95)
    assert delta / scale == pytest.approx(6.673097508738255, rel=2e-13)
    r, f = conditional_survival(d, 24. * scale, 24. * scale + delta)
    assert r == pytest.approx(.95, rel=1e-13)
    assert f == pytest.approx(.05, rel=1e-12)


def test_conditional_survival_beyond_underflow_and_small_complement():
    d = Weibull_Distribution(1., 2.)
    r, f = conditional_survival(d, 30., 30.001)
    assert r == pytest.approx(.9417635918201327, rel=1e-12)
    assert f == pytest.approx(.05823640817986729, rel=1e-11)
    r, f = conditional_survival(Exponential_Distribution(1e-20), 0., 1.)
    assert r == 1.
    assert f == pytest.approx(1e-20, rel=1e-14)


def test_remaining_life_retains_delta_smaller_than_ulp_of_age():
    d = Weibull_Distribution(1., 4.)
    age = 1e30
    delta = remaining_life(d, age, .95)
    # At extreme cumulative hazard this reduces to -log(R)/h(age).
    assert delta == pytest.approx(-math.log(.95) / (4 * age ** 3), rel=1e-12)
    assert age + delta == age


def test_shift_and_bounded_support_semantics():
    assert remaining_life(Exponential_Distribution(.2, gamma=5.), 2., .9) == pytest.approx(3. - math.log(.9) / .2)
    assert conditional_survival(Weibull_Distribution(10., .5, gamma=5.), 1., 4.) == (1., -0.)
    d = Beta_Distribution(1., 1.)
    assert remaining_life(d, .9, .8) == pytest.approx(.02, rel=1e-12)
    assert conditional_survival(d, .9, 1.) == (0., 1.)
    with pytest.raises(ValueError, match='zero'):
        conditional_survival(d, 1., 1.)
    with pytest.raises(ValueError):
        remaining_life(d, 1., .8)


@pytest.mark.parametrize('offset', [9., -9., 40., -40.])
def test_normal_interference_resolves_both_tails(offset):
    result = interference_probability(Normal_Distribution(0., 1.), Normal_Distribution(offset, 1.))
    assert result['probability_of_failure'] == pytest.approx(stats.norm.sf(offset / math.sqrt(2)), rel=1e-13, abs=0.)
    assert result['reliability'] == pytest.approx(stats.norm.cdf(offset / math.sqrt(2)), rel=1e-13, abs=0.)
    assert result['log_probability_of_failure'] == pytest.approx(stats.norm.logsf(offset / math.sqrt(2)))


@pytest.mark.parametrize('factor', [1e-20, 1e20])
def test_general_exponential_interference_relative_tail_accuracy(factor):
    # P(Exp(rate1) > Exp(rate2)) = rate2/(rate1+rate2).
    result = interference_probability(Exponential_Distribution(1.), Exponential_Distribution(factor))
    assert result['probability_of_failure'] == pytest.approx(factor / (1. + factor), rel=2e-7, abs=0.)
    assert result['reliability'] == pytest.approx(1. / (1. + factor), rel=2e-7, abs=0.)


def test_probability_integral_resolves_narrow_bounded_support():
    d = Beta_Distribution(1., 1.)
    result = interference_probability(d, d, stress_scale=1000.)
    assert result['probability_of_failure'] == pytest.approx(.9995, rel=1e-12)
    assert result['reliability'] == pytest.approx(.0005, rel=1e-12)
    opposite = interference_probability(d, d, strength_scale=1000.)
    assert opposite['probability_of_failure'] == pytest.approx(.0005, rel=1e-12)


def test_lognormal_and_weibull_analytic_invariance():
    result = interference_probability(Lognormal_Distribution(0., .5), Lognormal_Distribution(10., .5))
    assert result['probability_of_failure'] == pytest.approx(stats.norm.sf(10 / math.sqrt(.5)), rel=1e-13, abs=0.)
    a = Weibull_Distribution(3., 2.)
    b = Weibull_Distribution(7., 2.)
    assert interference_probability(a, b)['probability_of_failure'] == pytest.approx(9/58)
    assert interference_probability(a, Weibull_Distribution(7000., 2.), strength_scale=.001)['probability_of_failure'] == pytest.approx(9/58)


def test_disjoint_support_and_invalid_inputs():
    result = interference_probability(Beta_Distribution(2., 3.), Exponential_Distribution(1., gamma=2.))
    assert result['probability_of_failure'] == 0
    assert result['method'] == 'disjoint_support'
    with pytest.raises(ValueError):
        interference_probability(Beta_Distribution(2., 3.), Beta_Distribution(2., 3.), stress_scale=0.)
    with pytest.raises(ValueError):
        conditional_survival(Weibull_Distribution(1., 2.), 5., 4.)


def test_unresolved_general_tail_is_not_reported_as_zero_risk():
    # These overlapping positive supports have nonzero risk below binary64
    # range. There is no analytic special case in the generic quadrature path.
    with pytest.raises(ValueError, match='resolve'):
        interference_probability(Gamma_Distribution(2., 1.), Gamma_Distribution(2., 1e200))
