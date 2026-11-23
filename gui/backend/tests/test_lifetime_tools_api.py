"""Request boundaries and end-to-end numerical responses for lifetime tools."""
import math
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from routers import life_tools, life_data, alt
from schemas import CalculatorRequest, BurnInRequest


def test_calculator_and_burn_in_share_conditional_mean():
    calc = life_data.calculate_metrics(CalculatorRequest(distribution='Weibull_2P',params={'eta':13,'beta':2},elapsed=6.5,reliability_target=.5))
    burn = alt.burn_in(BurnInRequest(eta=13,beta=2,duration=6.5,n_units=100,acceleration_factor=1))
    assert calc['mean_remaining_life'] == pytest.approx(7.093337689945608)
    assert calc['conditional_mean_age'] == pytest.approx(13.593337689945608)
    assert calc['remaining_life'] != calc['mean_remaining_life']
    assert burn['post_burn_in_mean_residual_life'] == round(calc['mean_remaining_life'],3)


def test_matrix_linked_scaled_beta_and_small_tails():
    result = life_tools.matrix(life_tools.SurvivalMatrixRequest(distribution='beta',params={'alpha':1,'beta':1,'support_scale':10},ages=[8],durations=[1]))
    assert result['survival'][0][0] == pytest.approx(.5)
    result = life_tools.matrix(life_tools.SurvivalMatrixRequest(distribution='Exponential_1P',params={'Lambda':1e-20},ages=[0],durations=[1]))
    assert result['failure'][0][0] == pytest.approx(1e-20,abs=0)
    with pytest.raises(HTTPException):
        life_tools.matrix(life_tools.SurvivalMatrixRequest(params={'eta':1,'beta':2},ages=[-1],durations=[1]))


def test_mechanical_api_exposure_semantics_and_input_boundaries():
    result=life_tools.mechanical(life_tools.MechanicalRateRequest(beta=2,eta=1e12,interval=1))
    assert result['cm_per_time'] == pytest.approx(1e-24,rel=1e-12,abs=0)
    assert result['exposure_basis']=='time'
    with pytest.raises(HTTPException):
        life_tools.mechanical(life_tools.MechanicalRateRequest(beta=2,eta=10,percentile_life=5,interval=1))
    with pytest.raises(ValidationError):
        life_tools.InspectionPredictionRequest(n=True,failures=0,first_age=1,second_age=2,betas=[2])


def test_predictive_api_labels_parameter_and_count_uncertainty():
    result=life_tools.inspection(life_tools.InspectionPredictionRequest(n=20,failures=0,first_age=1,second_age=2,betas=[1]))
    assert result['rows'][0]['predictive_interval']['upper']>0
    assert result['prior']['parameter']=='p1=P(first failure by t1)'
    assert result['interval_kind']=='conservative_equal_tailed_bayesian_posterior_predictive'
    with pytest.raises(HTTPException, match='outside floating-point range'):
        life_tools.inspection(life_tools.InspectionPredictionRequest(n=100,failures=1,first_age=1,second_age=2,betas=[.0001]))
