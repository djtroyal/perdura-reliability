"""Specification tails keep the selected distribution and rare probabilities."""
import pytest
from scipy.stats import norm, lognorm, beta
from fastapi import HTTPException
from pydantic import ValidationError
from routers.capability import SpecificationTailRequest, specification_tails


@pytest.mark.parametrize('name,params,lsl,usl,expected', [
    ('Normal_2P', {'mu': 0., 'sigma': 1.}, None, 9., norm.sf(9.)),
    ('Lognormal_2P', {'mu': 1., 'sigma': .6}, .2, 12., lognorm.cdf(.2, .6, scale=2.718281828459045) + lognorm.sf(12., .6, scale=2.718281828459045)),
    ('Beta_2P', {'alpha': 2., 'beta': 5.}, -.1, 1.1, 0.),
    ('Weibull_3P', {'eta': 10., 'beta': 2., 'gamma': 4.}, 2., None, 0.),
])
def test_direct_model_tails(name, params, lsl, usl, expected):
    result = specification_tails(SpecificationTailRequest(distribution=name, params=params, lsl=lsl, usl=usl))
    assert result['probability_total'] == pytest.approx(expected, rel=1e-12, abs=1e-30)
    assert result['total'] == pytest.approx(expected * 1e6, rel=1e-12, abs=1e-30)
    assert result['parameter_uncertainty_included'] is False


def test_bad_limits_or_parameters_rejected():
    for params, limits in [({'mu': 0., 'sigma': 1.}, {}), ({'mu': 0., 'sigma': 1.}, {'lsl': 4., 'usl': 2.}), ({'mu': 0., 'sigma': -1.}, {'usl': 2.})]:
        with pytest.raises(HTTPException):
            specification_tails(SpecificationTailRequest(distribution='Normal_2P', params=params, **limits))
    with pytest.raises(ValidationError):
        SpecificationTailRequest(distribution='Normal_2P', params={'mu': float('nan'), 'sigma': 1.}, usl=2.)
