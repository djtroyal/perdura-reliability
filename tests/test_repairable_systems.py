"""Tests for reliability.Repairable_systems (Crow-AMSAA and Duane)."""

import numpy as np
import pytest
from reliability.Repairable_systems import CrowAMSAA, Duane


TIMES = [2.7, 10.3, 12.5, 30.6, 57.0, 61.3, 80.0, 109.5, 125.0, 128.6,
         143.8, 167.9, 229.2, 296.7, 320.6, 328.2, 366.2, 396.8, 421.4,
         438.2, 501.2, 620.0]


# --- Crow-AMSAA, failure-terminated ---

def test_crow_amsaa_failure_terminated_beta_lambda():
    model = CrowAMSAA(times=TIMES)
    times = np.asarray(TIMES)
    n = len(times)
    T = times[-1]

    # independent computation of the MLEs
    beta_expected = n / np.sum(np.log(T / times[:-1]))
    lambda_expected = n / T ** beta_expected

    assert model.failure_terminated is True
    assert model.n == n
    assert model.T == T
    assert model.beta == pytest.approx(beta_expected, rel=1e-12)
    assert model.Lambda == pytest.approx(lambda_expected, rel=1e-12)
    assert model.growth_rate == pytest.approx(1 - beta_expected, rel=1e-12)


def test_crow_amsaa_expected_failures_at_T_equals_n():
    model = CrowAMSAA(times=TIMES)
    # by construction lambda = n / T^beta, so N(T) = n exactly
    assert model.expected_failures(model.T) == pytest.approx(model.n, rel=1e-12)


def test_crow_amsaa_mtbf_relationships():
    model = CrowAMSAA(times=TIMES)
    T = model.T
    assert model.cumulative_MTBF == pytest.approx(
        T / model.expected_failures(T), rel=1e-12)
    assert model.instantaneous_MTBF == pytest.approx(
        model.cumulative_MTBF / model.beta, rel=1e-12)
    assert model.instantaneous_failure_intensity == pytest.approx(
        1 / model.instantaneous_MTBF, rel=1e-12)
    # CvM statistic is computed and positive
    assert model.CvM > 0


def test_crow_amsaa_methods_accept_arrays():
    model = CrowAMSAA(times=TIMES)
    t = np.array([100.0, 300.0, 620.0])
    nf = model.expected_failures(t)
    mc = model.MTBF_cumulative(t)
    mi = model.MTBF_instantaneous(t)
    assert nf.shape == mc.shape == mi.shape == (3,)
    assert isinstance(model.expected_failures(100.0), float)
    # beta < 1 (reliability growth) so instantaneous MTBF > cumulative MTBF
    assert model.beta < 1
    assert np.all(mi > mc)


def test_crow_amsaa_results_dataframe():
    model = CrowAMSAA(times=TIMES)
    assert set(['Parameter', 'Value']) == set(model.results.columns)
    assert 'Beta' in model.results['Parameter'].tolist()
    assert 'CrowAMSAA' in repr(model)


# --- Crow-AMSAA, time-terminated ---

def test_crow_amsaa_time_terminated():
    model = CrowAMSAA(times=TIMES, T=700)
    times = np.asarray(TIMES)
    n = len(times)
    beta_expected = n / np.sum(np.log(700 / times))
    lambda_expected = n / 700 ** beta_expected

    assert model.failure_terminated is False
    assert model.T == 700
    assert model.beta == pytest.approx(beta_expected, rel=1e-12)
    assert model.Lambda == pytest.approx(lambda_expected, rel=1e-12)
    # extending the test time without new failures lowers beta vs the
    # failure-terminated estimate
    ft = CrowAMSAA(times=TIMES)
    assert model.beta != pytest.approx(ft.beta)
    assert model.beta < ft.beta
    assert model.expected_failures(700) == pytest.approx(n, rel=1e-12)


# --- Duane ---

def test_duane_fit():
    model = Duane(times=TIMES)
    assert model.n == len(TIMES)
    assert 0 < model.alpha < 1
    assert model.r_squared > 0.5
    assert model.A == pytest.approx(10 ** model.b, rel=1e-12)


def test_duane_mtbf_at_T():
    model = Duane(times=TIMES)
    T = model.T
    assert model.DMTBF_C == pytest.approx(model.MTBF_cumulative(T), rel=1e-12)
    assert model.DMTBF_I == pytest.approx(model.MTBF_instantaneous(T), rel=1e-12)
    # with positive growth (alpha > 0), instantaneous MTBF > cumulative MTBF
    assert model.MTBF_instantaneous(T) > model.MTBF_cumulative(T)


def test_duane_results_dataframe():
    model = Duane(times=TIMES)
    assert set(['Parameter', 'Value']) == set(model.results.columns)
    assert 'Duane' in repr(model)


# --- Validation ---

def test_empty_times_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[])
    with pytest.raises(ValueError):
        Duane(times=[])


def test_single_failure_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[10.0])


def test_non_increasing_times_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[10, 20, 15, 30])
    with pytest.raises(ValueError):
        Duane(times=[10, 20, 20, 30])


def test_negative_times_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[-5, 10, 20])


def test_T_less_than_max_time_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[10, 20, 30], T=25)
    with pytest.raises(ValueError):
        Duane(times=[10, 20, 30], T=25)
