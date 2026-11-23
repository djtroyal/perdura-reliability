"""API regressions for cost MCF and explicit repair-model forecasting."""
import math
import pytest
from fastapi import HTTPException
from routers import maintenance, growth
from schemas import MCFRequest


def test_fleet_endpoint_reports_exact_exponential_and_costs():
    result=maintenance.fleet_forecast(maintenance.FleetForecastRequest(
        dist='exponential',dist_params={'lambda':.1},horizon=3,model='perfect_renewal',cost_per_event=9,
        cohorts=[{'id':'a','count':10,'age':5,'entry_time':0,'exit_time':2}]))
    assert result['total_expected_events']==pytest.approx(2.)
    assert result['total_expected_cost']==pytest.approx(18.)
    assert result['cohorts'][0]['numerical']['method']=='analytic_exponential'
    assert result['probability_no_events'][-1]==pytest.approx(math.exp(-2))


def test_fleet_endpoint_rejects_exit_before_entry():
    with pytest.raises(HTTPException) as exc:
        maintenance.fleet_forecast(maintenance.FleetForecastRequest(
            dist='weibull',dist_params={'alpha':10,'beta':2},horizon=3,
            cohorts=[{'id':'a','count':10,'entry_time':2,'exit_time':1}]))
    assert exc.value.status_code==400


def test_fleet_endpoint_withholds_overflowing_cost_instead_of_emitting_invalid_json():
    with pytest.raises(HTTPException) as exc:
        maintenance.fleet_forecast(maintenance.FleetForecastRequest(
            dist='exponential',dist_params={'lambda':1},horizon=2,model='perfect_renewal',
            cost_per_event=1e308,cohorts=[{'id':'a','count':1}]))
    assert exc.value.status_code==400
    assert 'floating-point range' in exc.value.detail


def test_fleet_scaled_beta_retains_declared_positive_support():
    result=maintenance.fleet_forecast(maintenance.FleetForecastRequest(
        dist='beta',dist_params={'alpha':1,'beta':1,'support_scale':10},horizon=2,
        cohorts=[{'id':'a','count':100}]))
    assert result['total_expected_events']==pytest.approx(20.)


def test_perfect_replacement_api_keeps_explicit_assumption():
    result=maintenance.replacement_policy(maintenance.ReplacementPolicyRequest(
        cost_PM=1,cost_CM=8,weibull_alpha=1200,weibull_beta=3,block_repair_model='perfect'))
    assert result['block_repair_model']=='perfect'
    assert result['block']['finite_optimum']
    assert 'Perfect renewal' in result['maintenance_assumptions']['block']
    assert result['block']['numerical']['cost_lower']


def test_perfect_cost_endpoint_is_finite_horizon():
    result=maintenance.cost_forecast(maintenance.CostForecastRequest(
        policy='block',cost_PM=2,cost_CM=10,weibull_alpha=100,weibull_beta=1,
        horizon=250,interval=100,block_repair_model='perfect'))
    assert result['expected_cm']==pytest.approx(2.5)
    assert result['expected_pm']==2
    assert result['finite_horizon_transients_modeled']


def test_cost_mcf_api_preserves_non_integer_costs_and_censoring():
    request=MCFRequest(measure='cost',records=[
        {'system_id':'a','time':1,'status':'event','cost':12.75},
        {'system_id':'a','time':1,'status':'censor'},
        {'system_id':'b','time':2,'status':'censor'}])
    result=growth.mcf(request)
    assert result['nonparametric']['MCF']==[6.375]
    assert result['nonparametric']['measure']=='cost'
    assert result['nonparametric']['at_risk']==[2]
    request.parametric=True
    with pytest.raises(HTTPException) as exc:
        growth.mcf(request)
    assert exc.value.status_code==400
