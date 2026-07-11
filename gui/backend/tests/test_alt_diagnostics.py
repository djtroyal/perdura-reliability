"""ALT router diagnostics for range, rank and two-stress identifiability."""

import math
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import alt as A
from schemas import ALTFitRequest, MultiStressRequest


def test_alt_fit_surfaces_use_range_design_and_shape_diagnostics():
    result = A.fit_alt(ALTFitRequest(
        failures=[1000, 900, 1100, 950, 300, 250, 350, 280],
        failure_stress=[350] * 4 + [400] * 4,
        use_level_stress=300,
        models_to_fit=['Weibull_Exponential'],
    ))
    assert result['analysis_diagnostics']['use_stress']['is_extrapolation'] is True
    details = result['model_details']['Weibull_Exponential']
    assert details['stress_design']['rank'] == 2
    assert details['stress_design']['use_level']['leverage_ratio'] > 1
    assert details['physical_constraint']['passed'] is True
    assert details['common_shape']['status'] == 'ok'


def test_alt_fit_rejects_single_stress_level():
    with pytest.raises(HTTPException, match='two distinct'):
        A.fit_alt(ALTFitRequest(
            failures=[10, 11, 12, 13], failure_stress=[100, 100, 100, 100]))


def test_multi_stress_rejects_collinear_design():
    with pytest.raises(HTTPException, match='rank'):
        A.multi_stress(MultiStressRequest(
            failure_times=[1000, 900, 500, 450, 200, 180],
            stress1=[40, 40, 50, 50, 60, 60],
            stress2=[20, 20, 25, 25, 30, 30],
        ))


def test_multi_stress_withholds_physically_reversed_fit():
    s1 = [40, 40, 60, 60, 40, 60, 50, 50]
    s2 = [30, 60, 30, 60, 45, 45, 30, 60]
    # Life increases with stress 1, contrary to increasing_damage.
    life = [math.exp(4 + .03 * a - .02 * b) for a, b in zip(s1, s2)]
    result = A.multi_stress(MultiStressRequest(
        failure_times=life, stress1=s1, stress2=s2,
        stress1_use=30, stress2_use=20,
        stress1_direction='increasing_damage',
        stress2_direction='increasing_damage',
        n_bootstrap=50,
    ))
    assert result['fit_eligible'] is False
    assert 'physical_stress_direction_violated' in result['eligibility_reasons']
    assert result['use_level_life'] is None


def test_multi_stress_reports_convex_hull_leverage_and_bootstrap():
    s1 = [40, 40, 60, 60, 40, 60, 50, 50]
    s2 = [30, 60, 30, 60, 45, 45, 30, 60]
    offsets = [0.02, -0.02, 0.01, -0.01, 0.015, -0.015, 0.005, -0.005]
    life = [math.exp(8 - .03 * a - .02 * b + e) for a, b, e in zip(s1, s2, offsets)]
    result = A.multi_stress(MultiStressRequest(
        failure_times=life, stress1=s1, stress2=s2,
        stress1_use=30, stress2_use=20,
        n_bootstrap=50, seed=9,
    ))
    assert result['fit_eligible'] is True
    assert result['design_diagnostics']['rank'] == 3
    assert result['use_stress_diagnostics']['is_extrapolation'] is True
    assert result['use_stress_diagnostics']['inside_tested_convex_hull'] is False
    assert result['use_stress_diagnostics']['leverage_ratio'] > 1
    assert result['use_life_interval']['status'] == 'ok'
    assert result['use_life_interval']['lower'] < result['use_level_life'] < result['use_life_interval']['upper']
