"""Independent equations and numerical invariants for composite risk models."""
import numpy as np
import pytest
from scipy.integrate import quad

from reliability.Special_models import (
    Weibull_Partial_CR, Weibull_Bathtub, Fit_Weibull_Partial_CR,
    Fit_Weibull_Bathtub, Fit_Weibull_Mixture, _information_condition,
)


@pytest.mark.parametrize('fraction', [0., .25, 1.])
def test_partial_competing_risks_matches_population_equation(fraction):
    d = Weibull_Partial_CR(3., .6, 10., 2., fraction)
    t = np.array([0., .01, 1., 5., 20.])
    a, b = (t / 3.) ** .6, (t / 10.) ** 2
    expected = np.exp(-b) * (1 - fraction + fraction * np.exp(-a))
    np.testing.assert_allclose(d.SF(t), expected, rtol=2e-15)
    assert d.CDF(0.) == 0
    assert d.CDF(-1.) == 0
    np.testing.assert_allclose(d.CDF(t), -np.expm1(d.logSF(t)))
    if fraction == 0:
        assert d.HF(0.) == 0
    else:
        assert np.isposinf(d.HF(0.))


def test_bathtub_population_density_and_tail_roundtrips():
    d = Weibull_Bathtub(2., .6, 80., 1., 20., 3., .3)
    t = np.geomspace(.01, 60, 100)
    expected_r = np.exp(-t / 80 - (t / 20) ** 3) * (.7 + .3 * np.exp(-(t / 2) ** .6))
    np.testing.assert_allclose(d.SF(t), expected_r, rtol=1e-14)
    # Differentiate independent survival instead of restating the PDF code.
    eps = t * 1e-5
    numeric_pdf = (d.SF(t - eps) - d.SF(t + eps)) / (2 * eps)
    np.testing.assert_allclose(d.PDF(t), numeric_pdf, rtol=2e-7, atol=1e-13)
    assert quad(lambda x: float(d.PDF(x)), 0, np.inf, epsabs=1e-9)[0] == pytest.approx(1., abs=2e-9)
    q = np.array([1e-12, .01, .5, .95, 1 - 1e-10])
    np.testing.assert_allclose(d.CDF(d.quantile(q)), q, rtol=2e-12, atol=1e-15)
    assert np.isfinite(d.logSF(1e4))
    assert d.SF(1e4) == 0.
    assert np.isfinite(d.HF(1e4))


def test_information_condition_is_dimensionless():
    # A physically scaled quadratic likelihood has the same log-coordinate information.
    def model(unit):
        return lambda p: ((p[0] / unit - 2.) ** 2 + 3 * (p[1] - 4.) ** 2)
    a = _information_condition(model(1.), [2., 4.])
    b = _information_condition(model(3600.), [7200., 4.])
    assert a == pytest.approx(b, rel=1e-7)
    assert np.isinf(_information_condition(lambda p: -(p[0] - 1.) ** 2, [1.]))


def test_real_mixture_eligibility_survives_hours_to_seconds():
    rng = np.random.default_rng(6327)
    x = np.r_[rng.weibull(3., 80) * 10, rng.weibull(4., 120) * 100]
    a, b = Fit_Weibull_Mixture(x), Fit_Weibull_Mixture(x * 3600)
    assert a.fit_eligible and b.fit_eligible
    np.testing.assert_allclose(a.SF([10., 60., 120.]), b.SF(np.array([10., 60., 120.]) * 3600), rtol=1e-6)
    assert a.identifiability_diagnostics['information_condition'] == pytest.approx(
        b.identifiability_diagnostics['information_condition'], rel=.002)


@pytest.mark.parametrize('fit_class,distribution', [
    (Fit_Weibull_Partial_CR, Weibull_Partial_CR(3., .7, 20., 3., .3)),
    (Fit_Weibull_Bathtub, Weibull_Bathtub(3., .7, 80., 1., 20., 3., .3)),
])
def test_composite_fit_censored_likelihood_and_inference_contract(fit_class, distribution):
    # Deterministic quantiles cover the population without noisy recovery assertions.
    sample = distribution.quantile((np.arange(240) + .5) / 240)
    cutoff = float(np.quantile(sample, .85))
    failures, censored = sample[sample <= cutoff], np.full(np.sum(sample > cutoff), cutoff)
    fit = fit_class(failures, right_censored=censored)
    assert fit.converged
    # Derive density by differentiating the population survival, independently
    # of the distribution's own PDF/logPDF implementation.
    p = fit.params
    def population_terms(t):
        susceptible = (t / p['alpha_1']) ** p['beta_1']
        common = (t / p['alpha_2']) ** p['beta_2']
        common_hazard = p['beta_2'] * common / t
        if 'alpha_3' in p:
            third = (t / p['alpha_3']) ** p['beta_3']
            common += third
            common_hazard += p['beta_3'] * third / t
        u = p['susceptible_fraction']
        log_population = np.log1p(-u + u * np.exp(-susceptible))
        log_survival = -common + log_population
        log_density = -common + np.logaddexp(
            np.log(common_hazard) + log_population,
            np.log(u) - susceptible + np.log(p['beta_1'] * susceptible / t))
        return log_survival, log_density
    expected_ll = np.sum(population_terms(failures)[1]) + np.sum(population_terms(censored)[0])
    assert fit.loglik == pytest.approx(expected_ll, rel=1e-10)
    np.testing.assert_allclose(fit.SF([2., 8., 16.]), distribution.SF([2., 8., 16.]), atol=.045)
    assert fit.confidence_metadata['available'] is False
    assert fit.parameter_ci_method == 'unavailable_nonregular_composite_model'
    assert 'proprietary' not in fit.confidence_metadata['reason']
    assert len(fit.fit_diagnostics['attempts']) >= 8


def test_composite_fit_unit_scaling():
    distribution = Weibull_Partial_CR(3., .7, 20., 3., .3)
    sample = distribution.quantile((np.arange(80) + .5) / 80)
    a = Fit_Weibull_Partial_CR(sample)
    b = Fit_Weibull_Partial_CR(sample * 3600)
    assert a.fit_eligible == b.fit_eligible
    np.testing.assert_allclose(a.SF([2., 8., 16.]), b.SF(np.array([2., 8., 16.]) * 3600), rtol=5e-5)
    assert b.loglik == pytest.approx(a.loglik - len(sample) * np.log(3600), abs=1e-5)


@pytest.mark.parametrize('bad', [[], [0., 1., 2., 3., 4.], [1., 2., 3., 4., np.nan]])
def test_composite_invalid_data_rejected(bad):
    with pytest.raises(ValueError):
        Fit_Weibull_Partial_CR(bad)
