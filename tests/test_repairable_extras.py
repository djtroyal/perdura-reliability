"""Tests for optimal_replacement_time, ROCOF, and MCF functions."""

import json
import math

import numpy as np
import pytest
from reliability.Repairable_systems import (
    optimal_replacement_time, ROCOF, MCF_nonparametric, MCF_parametric,
    replacement_policy_comparison, maintenance_cost_forecast,
    simulate_virtual_age_maintenance,
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


@pytest.mark.parametrize("beta", [0.7, 1.0])
def test_nonincreasing_hazard_returns_run_to_failure(beta):
    res = optimal_replacement_time(1, 5, 100, beta)
    expected = 5 / (100 * math.gamma(1 + 1 / beta))
    assert res['optimal_replacement_time'] is None
    assert res['finite_optimum'] is False
    assert res['decision'] == 'run_to_failure'
    assert res['min_cost'] == pytest.approx(expected)
    assert res['boundary_minimum'] is True


def test_search_range_expands_instead_of_claiming_boundary_optimum():
    res = optimal_replacement_time(1, 5, 1000, 2.5, t_max=100)
    assert res['finite_optimum'] is True
    assert res['boundary_minimum'] is False
    assert res['search_expanded'] is True
    assert res['optimal_replacement_time'] == pytest.approx(493.04696, rel=1e-6)
    assert res['evaluated_t_max'] > res['optimal_replacement_time']


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


def test_policy_comparison_recommends_corrective_for_beta_below_one():
    c = replacement_policy_comparison(1, 5, 100, 0.7)
    assert c['cheaper_policy'] == 'corrective'
    assert c['age']['optimal_time'] is None
    assert c['block']['optimal_time'] is None
    assert c['age']['pm_per_time'] == 0
    assert c['age']['min_cost'] == pytest.approx(c['corrective_only_cost'])


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


def test_cost_forecast_uses_corrective_policy_when_no_finite_age_optimum():
    f = maintenance_cost_forecast('age', 1, 5, 100, 0.7, horizon=1000)
    assert f['interval'] is None
    assert f['expected_pm'] == 0
    assert f['cost_rate'] == pytest.approx(5 / f['mttf'])


def test_cost_forecast_validation():
    with pytest.raises(ValueError):
        maintenance_cost_forecast('bogus', 1, 5, 1000, 2.5, horizon=100)
    with pytest.raises(ValueError):
        maintenance_cost_forecast('age', 1, 5, 1000, 2.5, horizon=-1)


# ── Kijima virtual-age simulation ───────────────────────────────────────────

def test_virtual_age_extremes_match_expected_direction_for_wearout():
    common = dict(
        weibull_alpha=100, weibull_beta=2.0, horizon=400,
        n_simulations=4000, seed=17,
    )
    perfect = simulate_virtual_age_maintenance(
        repair_effectiveness=0.0, **common)
    minimal = simulate_virtual_age_maintenance(
        repair_effectiveness=1.0, **common)

    assert perfect['failures']['mean'] < minimal['failures']['mean']
    # Minimal repair of a Weibull baseline is the power-law NHPP special case.
    assert minimal['failures']['mean'] == pytest.approx((400 / 100) ** 2, rel=0.04)


def test_virtual_age_simulation_reports_finite_horizon_uncertainty():
    result = simulate_virtual_age_maintenance(
        weibull_alpha=200, weibull_beta=2.5, horizon=1000,
        preventive_interval=150, repair_effectiveness=0.6,
        preventive_effectiveness=0.2, cost_CM=100, cost_PM=20,
        corrective_downtime=4, preventive_downtime=1,
        n_simulations=500, seed=5,
    )
    assert result['model'] == 'kijima_type_ii_virtual_age'
    assert result['analysis_basis'] == 'finite_horizon_monte_carlo'
    assert result['failures']['lower'] <= result['failures']['mean'] <= result['failures']['upper']
    assert result['availability']['lower'] <= result['availability']['mean'] <= result['availability']['upper']
    assert result['curve']['mean_cumulative_failures'][-1] == pytest.approx(
        result['failures']['mean'])


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
    # Event histories and observation ends are deliberately separate.
    return [
        [5, 10, 15],
        [6, 13],
        [12, 20, 25],
        [4, 9, 13],
    ]


def _example_mcf_ends():
    return [17, 17, 26, 17]


def test_mcf_nonparametric_monotone():
    res = MCF_nonparametric(_example_mcf_data(), observation_ends=_example_mcf_ends())
    mcf = np.asarray(res['MCF'])
    assert np.all(np.diff(mcf) >= 0)          # non-decreasing
    assert np.all(np.asarray(res['MCF_lower']) <= mcf + 1e-9)
    assert np.all(np.asarray(res['MCF_upper']) >= mcf - 1e-9)


def test_mcf_nonparametric_first_value():
    res = MCF_nonparametric(_example_mcf_data(), observation_ends=_example_mcf_ends())
    # First repair time is 4 (system 4); at t=4 all 4 systems are at risk,
    # one repair => MCF = 1/4.
    assert np.isclose(res['time'][0], 4)
    assert np.isclose(res['MCF'][0], 0.25)


def test_mcf_parametric_powerlaw():
    res = MCF_parametric(_example_mcf_data(), observation_ends=_example_mcf_ends())
    assert res['alpha'] > 0
    assert res['beta'] > 0
    assert 0 <= res['r_squared'] <= 1
    assert len(res['time']) == len(res['MCF'])


def test_mcf_parametric_unequal_observation_ends_uses_pooled_nhpp_mle():
    # The old equal-end shortcut gives the wrong likelihood when system
    # exposure ends differ.  These values independently solve the profiled
    # pooled NHPP score for six events and ends of 4 and 100.
    res = MCF_parametric(
        data=[[0.5, 1.0, 1.5, 2.0, 3.0], [50.0]],
        observation_ends=[4.0, 100.0],
    )

    assert res['beta'] == pytest.approx(0.3443837165829551)
    assert res['Lambda'] == pytest.approx(0.923671862338532)
    assert res['alpha'] == pytest.approx(1.2592951066203242)
    assert abs(res['profile_score']) < 1e-11
    assert res['converged'] is True
    assert 'unequal_observation_ends' in res['optimizer']


def test_mcf_parametric_ci_profiles_beta_and_endpoint_mean():
    res = MCF_parametric(
        data=[[0.5, 1.0, 1.5, 2.0, 3.0], [50.0]],
        observation_ends=[4.0, 100.0],
        CI=0.90,
    )

    assert res['beta_lower'] < res['beta'] < res['beta_upper']
    assert (res['endpoint_MCF_lower']
            < res['endpoint_MCF']
            < res['endpoint_MCF_upper'])
    assert res['endpoint_time'] == 100.0
    assert res['endpoint_MCF'] == pytest.approx(
        res['Lambda'] * res['endpoint_time'] ** res['beta'])
    assert res['interval_status'] == 'asymptotic_profile_likelihood'
    assert res['CI'] == 0.90


def test_mcf_parametric_undefined_r_squared_is_json_safe_null():
    result = MCF_parametric(
        data=[[1.0, 1.0]], observation_ends=[2.0])

    assert result['r_squared'] is None
    json.dumps(result, allow_nan=False)


def test_mcf_requires_repairs():
    with pytest.raises(ValueError):
        MCF_nonparametric([[], []], observation_ends=[10, 12])


def test_mcf_requires_explicit_observation_ends():
    with pytest.raises(ValueError, match='observation_ends is required'):
        MCF_nonparametric([[5, 10], [6]])


def test_mcf_event_tied_at_observation_end_is_retained():
    result = MCF_nonparametric([[5, 10], [6]], observation_ends=[10, 10])

    assert result['time'][-1] == 10
    assert result['events_at_time'][-1] == 1
    assert result['at_risk'][-1] == 2
    assert result['MCF'][-1] == pytest.approx(1.5)


def test_mcf_long_form_status_records_are_supported():
    records = [
        {'system_id': 'A', 'time': 5, 'status': 'event'},
        {'system_id': 'A', 'time': 10, 'status': 'event'},
        {'system_id': 'A', 'time': 10, 'status': 'censor'},
        {'system_id': 'B', 'time': 6, 'status': 'event'},
        {'system_id': 'B', 'time': 10, 'status': 'censor'},
    ]
    result = MCF_nonparametric(records=records)
    assert result['MCF'][-1] == pytest.approx(1.5)
    assert result['n_events'] == 3


def test_mcf_long_form_rejects_fractional_event_counts():
    records = [
        {'system_id': 'A', 'time': 5, 'status': 'event', 'count': 1.5},
        {'system_id': 'A', 'time': 10, 'status': 'censor'},
    ]
    with pytest.raises(ValueError, match='positive integers'):
        MCF_nonparametric(records=records)


def test_mcf_robust_variance_matches_complete_followup_sample_mean():
    # At t=5 the subject cumulative counts are [2, 1, 0]. Their sample-mean
    # variance is sample_variance / n = 1 / 3.
    result = MCF_nonparametric(
        [[1, 5], [5], []], observation_ends=[10, 10, 10])
    index = result['time'].index(5.0)

    assert result['MCF'][index] == pytest.approx(1.0)
    assert result['variance'][index] == pytest.approx(1.0 / 3.0)
    assert result['variance_method'] == 'nelson_lawless_nadeau_subject_robust'


def test_mcf_cluster_bootstrap_is_system_level_and_reproducible():
    kwargs = dict(
        data=_example_mcf_data(), observation_ends=_example_mcf_ends(),
        interval_method='cluster_bootstrap', bootstrap_samples=100, seed=42,
    )
    first = MCF_nonparametric(**kwargs)
    second = MCF_nonparametric(**kwargs)

    assert first['MCF_lower'] == second['MCF_lower']
    assert first['bootstrap']['resampling_unit'] == 'system_history_cluster'
    assert min(first['bootstrap']['valid_replicates']) > 0


def test_mcf_cluster_bootstrap_withholds_late_bound_without_enough_risk_sets():
    result = MCF_nonparametric(
        data=[[], [], [], [], [10.0]],
        observation_ends=[1.0, 1.0, 1.0, 1.0, 12.0],
        interval_method='cluster_bootstrap', bootstrap_samples=100, seed=7,
    )

    assert result['bootstrap']['valid_replicates'][0] < 100
    assert result['bootstrap']['minimum_valid_replicates'] == 100
    assert result['bootstrap']['point_available'] == [False]
    assert result['bootstrap']['lower'] == [None]
    assert result['bootstrap']['upper'] == [None]
    assert result['MCF_lower'] == [None]
    assert result['MCF_upper'] == [None]
    assert result['interval_available'] is False
    assert result['interval_status'] == 'unavailable'
    assert 'observable risk set' in result['interval_reason']
    assert result['bootstrap']['resampling_target'] == (
        'unconditional_cluster_resamples')
    json.dumps(result, allow_nan=False)


def test_mcf_cluster_bootstrap_mode_requires_samples():
    with pytest.raises(ValueError, match='requires at least 50'):
        MCF_nonparametric(
            _example_mcf_data(), observation_ends=_example_mcf_ends(),
            interval_method='cluster_bootstrap', bootstrap_samples=0,
        )


def test_mcf_single_system_marks_variance_and_interval_unavailable():
    result = MCF_nonparametric([[1.0, 2.0]], observation_ends=[3.0])

    assert result['MCF'] == [1.0, 2.0]
    assert result['variance'] == [None, None]
    assert result['standard_error'] == [None, None]
    assert result['MCF_lower'] == [None, None]
    assert result['MCF_upper'] == [None, None]
    assert result['variance_available'] is False
    assert result['interval_available'] is False
    assert result['interval_status'] == 'unavailable'
    assert 'At least 2 independent systems' in result['interval_reason']

    with pytest.raises(ValueError, match='at least 2 systems'):
        MCF_nonparametric(
            [[1.0, 2.0]], observation_ends=[3.0],
            interval_method='cluster_bootstrap', bootstrap_samples=50,
        )
