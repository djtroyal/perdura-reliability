"""Physics-of-Failure dimensional, regime, sensitivity and uncertainty tests."""

import math
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import pof as P
from schemas import (
    ArrheniusRequest,
    BlackRequest,
    CoffinMansonRequest,
    CreepRequest,
    DamageRequest,
    EyringRequest,
    FractureRequest,
    HallbergPeckRequest,
    MeanStressRequest,
    NorrisLandzbergRequest,
    PeckRequest,
    SNCurveRequest,
    StressStrainRequest,
    TDDBRequest,
)


@pytest.mark.parametrize(('evaluator', 'req'), [
    (P.sn_curve, SNCurveRequest(
        stress_amplitude=[400, 300, 200], cycles_to_failure=[1e4, 1e5, 1e6])),
    (P.stress_strain, StressStrainRequest(E=200_000, K=1200, n=0.15)),
    (P.creep_life, CreepRequest(
        temperature_C=500, stress_MPa=100, C=20, lmp_coeffs=[25_000, -5])),
    (P.linear_damage, DamageRequest(
        stress_levels=[300], cycles_applied=[100], cycles_to_failure=[1000])),
    (P.fracture, FractureRequest(sigma=100, a=0.001, Y=1.12, K_Ic=50)),
    (P.coffin_manson, CoffinMansonRequest(
        E=200_000, sigma_f=900, b=-0.09, epsilon_f=0.5, c=-0.6)),
    (P.norris_landzberg, NorrisLandzbergRequest()),
    (P.electromigration, BlackRequest()),
    (P.peck, PeckRequest()),
    (P.arrhenius, ArrheniusRequest()),
    (P.eyring, EyringRequest()),
    (P.hallberg_peck, HallbergPeckRequest()),
    (P.tddb, TDDBRequest()),
    (P.mean_stress, MeanStressRequest()),
])
def test_every_endpoint_returns_dimensional_result_contract(evaluator, req):
    result = evaluator(req)
    analysis = result['analysis']
    assert analysis['result_quality'] == 'deterministic_only'
    assert analysis['uncertainty'] is None
    assert analysis['units']
    assert analysis['validity']['assumptions']


def test_sn_curve_rejects_nonphysical_positive_slope():
    with pytest.raises(HTTPException, match='non-negative'):
        P.sn_curve(SNCurveRequest(
            stress_amplitude=[100, 200, 300], cycles_to_failure=[1e4, 1e5, 1e6]))


@pytest.mark.parametrize(('evaluator', 'req', 'message'), [
    (P.stress_strain, StressStrainRequest(E=200_000, K=1200, n=.15, max_stress=-1), 'max_stress'),
    (P.creep_life, CreepRequest(temperature_C=500, stress_MPa=100, lmp_coeffs=[25_000, 5]), 'negative'),
    (P.linear_damage, DamageRequest(stress_levels=[100], cycles_applied=[-1], cycles_to_failure=[10]), 'non-negative'),
    (P.fracture, FractureRequest(sigma=100, a=.001, Y=0, K_Ic=50), 'Geometry factor'),
    (P.coffin_manson, CoffinMansonRequest(E=200_000, sigma_f=900, b=-.1, epsilon_f=.5, c=-.1), 'must differ'),
    (P.norris_landzberg, NorrisLandzbergRequest(Ea=-.1), 'Activation energy'),
    (P.electromigration, BlackRequest(n=0), 'exponent'),
    (P.peck, PeckRequest(RH=101), '100%'),
    (P.arrhenius, ArrheniusRequest(Ea=0), 'Activation energy'),
    (P.hallberg_peck, HallbergPeckRequest(RH_test=101), '100%'),
    (P.tddb, TDDBRequest(gamma=0), 'gamma'),
    (P.mean_stress, MeanStressRequest(Su=300, Sy=350), 'must not exceed'),
])
def test_invalid_physical_regimes_fail_closed(evaluator, req, message):
    with pytest.raises(HTTPException, match=message):
        evaluator(req)


def test_time_unit_is_not_hard_coded_to_hours():
    result = P.electromigration(BlackRequest(time_unit='days'))
    assert result['time_unit'] == 'days'
    assert result['mttf'] > 0
    assert result['mttf_hours'] is None
    assert result['analysis']['units']['MTTF'] == 'days'


def test_nonlinear_damage_q_one_reduces_to_miner():
    result = P.linear_damage(DamageRequest(
        stress_levels=[300, 200], cycles_applied=[100, 100],
        cycles_to_failure=[1000, 2000], damage_exponents=[1, 1]))
    assert result['nonlinear_damage']['damage'] == pytest.approx(result['total_damage'])
    assert result['nonlinear_damage']['sequence_effect'] == pytest.approx(0)


def test_nonlinear_damage_exposes_sequence_sensitivity():
    result = P.linear_damage(DamageRequest(
        stress_levels=[300, 200], cycles_applied=[100, 100],
        cycles_to_failure=[1000, 2000], damage_exponents=[0.8, 1.2]))
    nonlinear = result['nonlinear_damage']
    assert nonlinear['damage'] != pytest.approx(nonlinear['reverse_order_damage'])
    assert len(result['model_comparison']) == 2


def test_paris_m_two_matches_analytic_integral():
    request = FractureRequest(
        sigma=50, a=.001, Y=1.0, K_Ic=50, C=1e-10, m=2,
        a_initial=.001, delta_sigma=100, stress_ratio=0,
    )
    result = P.fracture(request)
    a_end = result['growth_critical_crack_length'] * (1 - 1e-8)
    expected = math.log(a_end / request.a_initial) / (
        request.C * (request.Y * request.delta_sigma) ** 2 * math.pi)
    assert result['cycles_to_critical'] == pytest.approx(expected, rel=2e-4)


def test_crack_growth_models_are_compared_with_separate_constants():
    result = P.fracture(FractureRequest(
        sigma=50, a=.001, Y=1.0, K_Ic=50, C=1e-10, m=3,
        a_initial=.001, delta_sigma=100, stress_ratio=.1,
        walker_C=2e-10, walker_m=3, walker_gamma=.5,
        forman_C=1e-9, forman_m=3,
    ))
    assert set(result['crack_growth_models']) == {'paris', 'walker', 'forman'}
    assert all(row['cycles_to_critical'] > 0 for row in result['crack_growth_models'].values())


def test_mean_stress_comparison_matches_reference_equations():
    result = P.mean_stress(MeanStressRequest(
        method='gerber', sigma_a=100, sigma_m=150, Se=200, Su=500, Sy=350))
    factors = {row['method']: row['factor_of_safety'] for row in result['model_comparison']}
    assert factors['goodman'] == pytest.approx(1 / (100 / 200 + 150 / 500))
    assert factors['soderberg'] == pytest.approx(1 / (100 / 200 + 150 / 350))
    A = 100 / 200
    B = (150 / 500) ** 2
    assert factors['gerber'] == pytest.approx((-A + math.sqrt(A * A + 4 * B)) / (2 * B))
    assert result['factor_of_safety'] == factors['gerber']


def test_uncertainty_is_separate_seeded_and_supports_list_elements():
    result = P.linear_damage(DamageRequest(
        stress_levels=[300, 200], cycles_applied=[100, 100],
        cycles_to_failure=[1000, 2000],
        uncertainty={
            'relative_sd': {'cycles_to_failure[0]': .10},
            'samples': 200, 'confidence': .90, 'seed': 7,
        },
    ))
    analysis = result['analysis']
    assert analysis['result_quality'] == 'uncertainty_propagated'
    interval = analysis['uncertainty']['metrics']['miner_damage']
    assert interval['lower'] < result['total_damage'] < interval['upper']
    assert analysis['deterministic']['miner_damage'] == pytest.approx(result['total_damage'])


def test_uncertainty_rejects_unknown_or_zero_relative_fields():
    with pytest.raises(HTTPException, match='Unknown uncertainty field'):
        P.arrhenius(ArrheniusRequest(uncertainty={
            'relative_sd': {'not_a_field': .1}, 'samples': 200,
        }))
    with pytest.raises(HTTPException, match='undefined for zero'):
        P.eyring(EyringRequest(uncertainty={
            'relative_sd': {'n': .1}, 'samples': 200,
        }))
