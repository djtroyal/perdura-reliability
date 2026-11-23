"""Independent renewal/conditional-cohort and monetary MCF regression oracles."""
import numpy as np
import pytest
from scipy import integrate, stats

from reliability.Distributions import Exponential_Distribution, Gamma_Distribution, Weibull_Distribution, Normal_Distribution
from reliability.Renewal import (renewal_count, fleet_forecast, perfect_block_replacement,
                                 perfect_block_cost_forecast, RenewalConvergenceError)
from reliability.Repairable_systems import MCF_nonparametric, replacement_policy_comparison


def test_exponential_perfect_repair_is_exact_poisson_at_any_age():
    times = np.array([0., 1., 4., 12.])
    result = renewal_count(Exponential_Distribution(.2), times, age=10000.)
    np.testing.assert_allclose(result['expected'], times*.2, rtol=1e-15)
    np.testing.assert_array_equal(result['upper'], result['lower'])
    assert result['method'] == 'analytic_exponential'


def test_erlang_two_renewal_matches_closed_form_and_envelope():
    # Erlang-2 renewals count every second event of a Poisson process.
    times = np.linspace(0., 6., 21)
    exact = times / 2 - (-np.expm1(-2*times)) / 4
    result = renewal_count(Gamma_Distribution(alpha=2., beta=1.), times)
    assert np.all(result['lower'] <= exact + 1e-10)
    assert np.all(result['upper'] >= exact - 1e-10)
    np.testing.assert_allclose(result['expected'], exact, atol=1e-5, rtol=5e-4)


def test_delayed_erlang_renewal_matches_independent_quadrature():
    age = 2.
    d = Gamma_Distribution(alpha=2., beta=1.)
    times = np.array([0., .25, 1., 2., 4.])
    ordinary = lambda t: t/2 + np.expm1(-2*t)/4
    expected = np.array([integrate.quad(
        lambda u: stats.gamma.pdf(age+u, 2)/stats.gamma.sf(age, 2)*(1+ordinary(t-u)),0,t,
        epsabs=1e-11,epsrel=1e-11)[0] for t in times])
    result = renewal_count(d, times, age=age)
    assert np.all(result['lower'] <= expected+1e-10)
    assert np.all(result['upper'] >= expected-1e-10)
    np.testing.assert_allclose(result['expected'], expected, rtol=5e-4, atol=1e-5)


def test_renewal_scale_invariance_and_decreasing_hazard():
    times = np.linspace(0,3,11)
    a = renewal_count(Weibull_Distribution(1., .5),times)
    b = renewal_count(Weibull_Distribution(3600., .5),times*3600)
    np.testing.assert_allclose(a['expected'],b['expected'],rtol=1e-10,atol=1e-10)
    assert a['cells'] == b['cells']


def test_numerical_budget_failure_is_explicit():
    with pytest.raises(RenewalConvergenceError):
        renewal_count(Weibull_Distribution(1.,.5),[.1,3.],max_cells=128)
    with pytest.raises(ValueError,match='positive support'):
        renewal_count(Normal_Distribution(1.,1.),[1.])
    # Its CDF at zero underflows to zero, but its mathematical support is R.
    with pytest.raises(ValueError,match='positive support'):
        renewal_count(Normal_Distribution(1000.,1.),[1.])


@pytest.mark.parametrize('model',['first_failure','perfect_renewal','minimal_repair'])
def test_fleet_entries_exits_age_conditioning_and_event_cost(model):
    d=Exponential_Distribution(.1)
    cohorts=[{'id':'old','count':10,'age':30,'entry_time':0,'exit_time':2},
             {'id':'delivery','count':4,'age':0,'entry_time':1,'exit_time':None}]
    result=fleet_forecast(d,cohorts,3,model=model,cost_per_event=7,n_points=7)
    expected=(10+4)*(-np.expm1(-.2)) if model=='first_failure' else 14*.2
    assert result['total_expected_events']==pytest.approx(expected,rel=1e-12)
    assert result['total_expected_cost']==pytest.approx(7*expected)
    assert result['probability_no_events'][-1]==pytest.approx(np.exp(-2.8))
    assert result['active_scheduled_units'][0]==10
    assert result['active_scheduled_units'][result['time'].index(1)]==14
    assert result['active_scheduled_units'][result['time'].index(2)]==4
    assert sum(result['period_events'])==pytest.approx(expected)


def test_deep_tail_first_failure_retains_conditioning():
    result=fleet_forecast(Weibull_Distribution(1,2),[{'id':'tail','count':1,'age':30}],.001)
    assert result['total_expected_events']==pytest.approx(-np.expm1(-(30.001**2-30**2)))


def test_fleet_initial_age_applies_only_to_first_renewal():
    d=Gamma_Distribution(alpha=2,beta=1)
    result=fleet_forecast(d,[{'id':'a','count':3,'age':2}],4,model='perfect_renewal',n_points=11)
    expected=renewal_count(d,np.asarray(result['time']),age=2)
    np.testing.assert_allclose(result['expected_events'],expected['expected']*3)
    assert result['total_expected_events'] > 3


def test_perfect_block_exponential_counts_and_scheduled_endpoint():
    result=perfect_block_cost_forecast(Exponential_Distribution(.01),2,10,250,interval=100)
    assert result['expected_cm']==pytest.approx(2.5)
    assert result['expected_pm']==2
    assert result['total_cost']==pytest.approx(29)
    assert result['cumulative_cost'][result['time'].index(100)]==pytest.approx(12)
    assert result['finite_horizon_transients_modeled'] is True


def test_perfect_block_count_uses_renewal_not_cumulative_hazard():
    d=Gamma_Distribution(alpha=2,beta=1)
    expected_per_block=1 + np.expm1(-4)/4
    result=perfect_block_cost_forecast(d,1,8,6,interval=2)
    assert result['expected_cm']==pytest.approx(3*expected_per_block,rel=5e-4)
    assert result['expected_cm_lower'] <= 3*expected_per_block <= result['expected_cm_upper']


def test_perfect_block_optimum_is_interior_cost_qualified_and_scale_invariant():
    a=replacement_policy_comparison(1,8,1200,3,block_repair_model='perfect')
    b=replacement_policy_comparison(1,8,1200*3600,3,block_repair_model='perfect')
    assert a['block']['finite_optimum']
    assert a['block']['min_cost']<a['corrective_only_cost']
    assert b['block']['optimal_time']/3600==pytest.approx(a['block']['optimal_time'])
    assert b['block']['min_cost']*3600==pytest.approx(a['block']['min_cost'])
    assert perfect_block_replacement(Exponential_Distribution(.01),1,8)['finite_optimum'] is False


def _cost_records(scale=1):
    return [{'system_id':'a','time':1,'status':'event','cost':10*scale},
            {'system_id':'b','time':1,'status':'event','cost':30*scale},
            {'system_id':'a','time':2,'status':'censor'},
            {'system_id':'b','time':2,'status':'censor'}]


def test_cost_mcf_equals_subject_mean_and_cluster_variance():
    result=MCF_nonparametric(records=_cost_records(),measure='cost')
    assert result['MCF']==[20.]
    assert result['variance']==[100.]
    assert result['total_observed_cost']==40
    assert result['n_events']==2
    assert result['estimand']=='mean_cumulative_cost_per_system'


def test_cost_currency_scaling_preserves_cluster_bootstrap():
    a=MCF_nonparametric(records=_cost_records(),measure='cost',interval_method='cluster_bootstrap',bootstrap_samples=100,seed=7)
    b=MCF_nonparametric(records=_cost_records(.01),measure='cost',interval_method='cluster_bootstrap',bootstrap_samples=100,seed=7)
    np.testing.assert_allclose(np.asarray(a['MCF'])*.01,b['MCF'])
    np.testing.assert_allclose(np.asarray(a['variance'])*.0001,b['variance'])
    np.testing.assert_allclose(np.asarray(a['MCF_lower'])*.01,b['MCF_lower'])
    np.testing.assert_allclose(np.asarray(a['MCF_upper'])*.01,b['MCF_upper'])


def test_cost_mcf_endpoint_and_zero_event_systems_are_retained():
    records=[{'system_id':'a','time':2,'status':'event','cost':25.5,'count':2},
             {'system_id':'a','time':2,'status':'censor'}, {'system_id':'b','time':2,'status':'censor'}]
    result=MCF_nonparametric(records=records,measure='cost')
    assert result['MCF']==[25.5]
    assert result['at_risk']==[2]
    assert result['n_events']==2
    assert result['total_observed_cost']==51.
    assert MCF_nonparametric(records=records)['MCF']==[1.]


@pytest.mark.parametrize('bad',[None,-1,float('nan'),float('inf')])
def test_cost_mcf_requires_valid_explicit_cost(bad):
    records=_cost_records();records[0]['cost']=bad
    with pytest.raises(ValueError,match='cost'):
        MCF_nonparametric(records=records,measure='cost')


@pytest.mark.parametrize('shape',[3,4,7])
def test_erlang_shapes_bound_independent_convolution_sum(shape):
    # The kth renewal time is Gamma(k*shape, 1), a separate exact identity.
    times=np.array([0.,.3,1.,3.,6.,12.])
    exact=np.sum(stats.gamma.cdf(times[None,:], a=shape*np.arange(1,100)[:,None]),axis=0)
    result=renewal_count(Gamma_Distribution(alpha=shape,beta=1),times)
    assert np.all(result['lower']<=exact+1e-9)
    assert np.all(result['upper']>=exact-1e-9)


def test_decimal_block_endpoint_does_not_drop_final_scheduled_replacement():
    result=perfect_block_cost_forecast(Exponential_Distribution(1),2,10,.3,interval=.1)
    assert result['expected_pm']==3
    assert result['total_cost']==pytest.approx(9.)


def test_conditioning_preserves_sub_ulp_additional_exposure():
    from reliability.Renewal import conditional_log_survival
    value=conditional_log_survival(Weibull_Distribution(1,2),1e8,np.array([1e-10]))[0]
    assert value==pytest.approx(-.02,rel=1e-13)
    assert conditional_log_survival(Exponential_Distribution(.2),1e8,np.array([1e-10]))[0]==pytest.approx(-2e-11)


def test_decreasing_hazard_block_policy_does_not_search_an_infinite_optimum():
    result=perfect_block_replacement(Weibull_Distribution(72,.5),1,8)
    assert not result['finite_optimum']
    assert result['decision']=='run_to_failure'
    assert result['search_expanded'] is False


def test_boundary_block_candidate_withholds_unsupported_policy_decision():
    # A short user search range excludes the actual interior optimum.
    result=perfect_block_replacement(Gamma_Distribution(alpha=2,beta=1),1,8,t_max=.01)
    assert result['decision']=='withheld'
    assert result['optimal_replacement_time'] is None
    assert result['boundary_minimum']
    assert result['candidate_cost_lower'] < result['candidate_cost_upper']
    assert 'optimal_time_lower' not in result
    comparison=replacement_policy_comparison(1,8,1200,3,t_max=1,block_repair_model='perfect')
    assert comparison['cheaper_policy']=='undetermined'
    assert comparison['block']['decision']=='withheld'
