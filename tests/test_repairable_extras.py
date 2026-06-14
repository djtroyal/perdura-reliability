"""Tests for optimal_replacement_time, ROCOF, and MCF functions."""

import numpy as np
import pytest
from reliability.Repairable_systems import (
    optimal_replacement_time, ROCOF, MCF_nonparametric, MCF_parametric,
)


# ── optimal_replacement_time ─────────────────────────────────────────────────

def test_optimal_replacement_basic():
    res = optimal_replacement_time(cost_PM=1, cost_CM=5,
                                   weibull_alpha=1000, weibull_beta=2.5)
    t = res['optimal_replacement_time']
    assert 0 < t < 3000
    # The optimum cost should be no greater than the cost at any sampled point.
    costs = [c for c in res['cost'] if c is not None]
    assert res['min_cost'] <= min(costs) + 1e-9


def test_optimal_replacement_as_good_as_old():
    res = optimal_replacement_time(cost_PM=1, cost_CM=10,
                                   weibull_alpha=500, weibull_beta=3, q=1)
    assert res['q'] == 1
    assert 0 < res['optimal_replacement_time'] < 1500


def test_optimal_replacement_validation():
    with pytest.raises(ValueError):
        optimal_replacement_time(5, 1, 1000, 2)   # PM >= CM
    with pytest.raises(ValueError):
        optimal_replacement_time(1, 5, 1000, 2, q=2)  # bad q


def test_optimal_replacement_higher_for_higher_beta_separation():
    # A more pronounced wear-out (higher beta) should give a finite optimum
    # noticeably below the characteristic life.
    res = optimal_replacement_time(1, 20, 1000, 4)
    assert res['optimal_replacement_time'] < 1000


# ── ROCOF ────────────────────────────────────────────────────────────────────

def test_rocof_no_trend_constant():
    # Roughly constant inter-arrival times => no significant trend.
    rng = np.random.default_rng(0)
    gaps = rng.uniform(90, 110, size=40)
    res = ROCOF(times_between_failures=gaps)
    assert res['trend'] == 'no trend'
    assert res['ROCOF'] is not None
    assert res['Beta_hat'] is None


def test_rocof_improving_trend():
    # Increasing inter-arrival times => improving system (failures spreading
    # out), which gives a negative Laplace statistic.
    gaps = np.linspace(10, 200, 30)
    res = ROCOF(times_between_failures=gaps)
    assert res['trend'] == 'improving'
    assert res['U'] < -res['z_crit']
    assert res['Beta_hat'] is not None and res['Beta_hat'] < 1


def test_rocof_worsening_trend():
    # Decreasing inter-arrival times => worsening system (failures clustering),
    # which gives a positive Laplace statistic.
    gaps = np.linspace(200, 10, 30)
    res = ROCOF(times_between_failures=gaps)
    assert res['trend'] == 'worsening'
    assert res['U'] > res['z_crit']
    assert res['Beta_hat'] is not None and res['Beta_hat'] > 1


def test_rocof_accepts_failure_times():
    gaps = np.linspace(10, 200, 30)
    cum = np.cumsum(gaps)
    a = ROCOF(times_between_failures=gaps)
    b = ROCOF(failure_times=cum)
    assert np.isclose(a['U'], b['U'])


def test_rocof_requires_one_input():
    with pytest.raises(ValueError):
        ROCOF()
    with pytest.raises(ValueError):
        ROCOF(times_between_failures=[1, 2], failure_times=[1, 2])


# ── MCF ──────────────────────────────────────────────────────────────────────

def _example_mcf_data():
    # Each system: repair times then a final censoring time (the largest value).
    return [
        [5, 10, 15, 17],
        [6, 13, 17],
        [12, 20, 25, 26],
        [4, 9, 13, 17],
    ]


def test_mcf_nonparametric_monotone():
    res = MCF_nonparametric(_example_mcf_data())
    mcf = np.asarray(res['MCF'])
    assert np.all(np.diff(mcf) >= 0)          # non-decreasing
    assert np.all(np.asarray(res['MCF_lower']) <= mcf + 1e-9)
    assert np.all(np.asarray(res['MCF_upper']) >= mcf - 1e-9)


def test_mcf_nonparametric_first_value():
    res = MCF_nonparametric(_example_mcf_data())
    # First repair time is 4 (system 4); at t=4 all 4 systems are at risk,
    # one repair => MCF = 1/4.
    assert np.isclose(res['time'][0], 4)
    assert np.isclose(res['MCF'][0], 0.25)


def test_mcf_parametric_powerlaw():
    res = MCF_parametric(_example_mcf_data())
    assert res['alpha'] > 0
    assert res['beta'] > 0
    assert 0 <= res['r_squared'] <= 1
    assert len(res['time']) == len(res['MCF'])


def test_mcf_requires_repairs():
    with pytest.raises(ValueError):
        MCF_nonparametric([[10], [12]])   # only censoring times, no repairs
