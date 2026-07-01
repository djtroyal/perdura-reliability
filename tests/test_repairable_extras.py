"""Tests for optimal_replacement_time, ROCOF, and MCF functions."""

import numpy as np
import pytest
from reliability.Repairable_systems import (
    optimal_replacement_time, ROCOF, MCF_nonparametric, MCF_parametric,
    replacement_policy_comparison, maintenance_cost_forecast,
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


# ── replacement_policy_comparison ────────────────────────────────────────────

def test_policy_comparison_structure_and_optima():
    c = replacement_policy_comparison(cost_PM=1, cost_CM=5,
                                      weibull_alpha=1000, weibull_beta=2.5)
    for pol in ('age', 'block'):
        assert 0 < c[pol]['optimal_time'] < 3000
        assert c[pol]['min_cost'] > 0
        assert c[pol]['pm_per_time'] > 0
        assert c[pol]['cm_per_time'] > 0
    # Age matches the standalone q=0 optimum it wraps.
    ref = optimal_replacement_time(1, 5, 1000, 2.5, q=0)
    assert np.isclose(c['age']['optimal_time'], ref['optimal_replacement_time'])
    # Both preventive policies beat run-to-failure for a wear-out item.
    assert c['age']['min_cost'] < c['corrective_only_cost']
    assert c['block']['min_cost'] < c['corrective_only_cost']
    assert c['cheaper_policy'] in ('age', 'block')
    assert c['cheaper_policy'] == ('age' if c['age']['min_cost'] <= c['block']['min_cost'] else 'block')


def test_policy_comparison_validation():
    with pytest.raises(ValueError):
        replacement_policy_comparison(-1, 5, 1000, 2)      # bad cost
    with pytest.raises(ValueError):
        replacement_policy_comparison(1, 5, -1000, 2)      # bad alpha


# ── maintenance_cost_forecast ────────────────────────────────────────────────

def test_cost_forecast_reconciles_with_rate():
    f = maintenance_cost_forecast('block', 1, 5, 1000, 2.5, horizon=10000)
    # total_cost == cost_rate * horizon, and the curve ends at total_cost.
    assert np.isclose(f['total_cost'], f['cost_rate'] * 10000)
    assert np.isclose(f['cumulative_cost'][-1], f['total_cost'])
    assert f['interval'] and f['interval'] > 0
    assert f['expected_pm'] > 0 and f['expected_cm'] > 0


def test_cost_forecast_corrective_has_no_pm():
    f = maintenance_cost_forecast('corrective', 1, 5, 1000, 2.5, horizon=5000)
    assert f['interval'] is None
    assert f['expected_pm'] == 0
    # corrective CM count ~ horizon / MTTF
    assert np.isclose(f['expected_cm'], 5000 / f['mttf'])


def test_cost_forecast_age_cheaper_than_corrective():
    age = maintenance_cost_forecast('age', 1, 5, 1000, 2.5, horizon=10000)
    corr = maintenance_cost_forecast('corrective', 1, 5, 1000, 2.5, horizon=10000)
    assert age['total_cost'] < corr['total_cost']


def test_cost_forecast_custom_interval():
    f = maintenance_cost_forecast('age', 1, 5, 1000, 2.5, horizon=10000, interval=300)
    assert np.isclose(f['interval'], 300)


def test_cost_forecast_validation():
    with pytest.raises(ValueError):
        maintenance_cost_forecast('bogus', 1, 5, 1000, 2.5, horizon=100)
    with pytest.raises(ValueError):
        maintenance_cost_forecast('age', 1, 5, 1000, 2.5, horizon=-1)


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
