"""Tests for the HRA router (HEART / SPAR-H / THERP / CREAM / SLIM / JHEDI /
SHERPA / ATHEANA / MERMOS)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

from routers import hra as H


# --- HEART ---

def test_heart_nominal_no_epc():
    r = H.heart(H.HeartRequest(gtt='E', epcs=[]))
    assert r['hep'] == pytest.approx(0.02)


def test_heart_epc_multiplier():
    # GTT E (0.02) with EPC1 (max 17) at proportion 0.5 -> 0.02 * (16*0.5+1) = 0.18
    r = H.heart(H.HeartRequest(gtt='E', epcs=[{'epc_id': 1, 'proportion': 0.5}]))
    assert r['hep'] == pytest.approx(0.18)


def test_heart_bad_gtt():
    with pytest.raises(ValueError):
        H.heart(H.HeartRequest(gtt='Z', epcs=[]))


# --- SPAR-H ---

def test_sparh_action_nominal():
    r = H.spar_h(H.SparHRequest(task_type='action', psfs={}))
    assert r['hep'] == pytest.approx(0.001)


def test_sparh_three_negative_applies_correction():
    r = H.spar_h(H.SparHRequest(task_type='action', psfs={
        'stress': 'high', 'complexity': 'moderately_complex', 'experience': 'low'}))
    assert r['n_negative_psfs'] == 3
    assert r['adjustment_applied'] is True
    # corrected HEP = (0.001*12)/(0.001*11+1) ≈ 0.01187, less than raw 0.012
    assert r['hep'] < r['raw_hep']
    assert r['hep'] == pytest.approx((0.001 * 12) / (0.001 * 11 + 1))


def test_sparh_guaranteed_failure():
    r = H.spar_h(H.SparHRequest(task_type='diagnosis', psfs={'available_time': 'inadequate'}))
    assert r['hep'] == 1.0
    assert r['guaranteed_failure'] is True


def test_sparh_context_matrix_complete_dependency():
    r = H.spar_h(H.SparHRequest(task_type='action', psfs={}, dependency={
        'enabled': True,
        'same_crew': True,
        'close_in_time': True,
        'same_location': True,
        'additional_cues': False,
        'failure_number_in_sequence': 2,
    }))
    assert r['independent_hep'] == pytest.approx(0.001)
    assert r['dependency']['level'] == 'complete'
    assert r['hep'] == 1.0


def test_sparh_direct_low_dependency_equation():
    r = H.spar_h(H.SparHRequest(task_type='action', psfs={}, dependency={
        'enabled': True, 'level': 'low', 'failure_number_in_sequence': 2,
        'justification': 'Shared procedure context',
    }))
    assert r['dependency']['source'] == 'analyst assigned'
    assert r['hep'] == pytest.approx((1 + 19 * 0.001) / 20)


def test_sparh_third_failure_has_moderate_minimum():
    r = H.spar_h(H.SparHRequest(task_type='action', psfs={}, dependency={
        'enabled': True, 'level': 'low', 'failure_number_in_sequence': 3,
    }))
    assert r['dependency']['level'] == 'moderate'
    assert r['hep'] == pytest.approx((1 + 6 * 0.001) / 7)
    assert 'sequence-position minimum' in r['dependency']['source']


def test_sparh_beta_uncertainty_preserves_mean_and_worked_shapes():
    u = H.HRA.spar_h_beta_uncertainty(0.3, confidence=0.90)
    assert u['alpha'] == pytest.approx(0.42)
    assert u['beta'] == pytest.approx(0.98)
    assert u['alpha'] / (u['alpha'] + u['beta']) == pytest.approx(0.3)
    assert u['lower'] < u['mean'] < u['upper']


# --- THERP ---

def test_therp_complete_dependency():
    r = H.therp(H.TherpRequest(nominal_hep=0.01, second_hep=0.02, dependency='CD'))
    assert r['conditional_hep'] == 1.0
    assert r['joint_hep'] == pytest.approx(r['adjusted_hep'])


def test_therp_stress_multiplier():
    r = H.therp(H.TherpRequest(nominal_hep=0.01, stress='extremely_high'))
    assert r['hep'] == pytest.approx(0.05)


# --- CREAM ---

def test_cream_all_nominal_is_tactical():
    r = H.cream(H.CreamRequest(cpc_levels={}))
    assert r['control_mode'] == 'tactical'
    assert r['hep_lower'] < r['hep'] < r['hep_upper']


def test_cream_many_reduced_is_scrambled():
    levels = {
        'organisation': 'deficient', 'working_conditions': 'incompatible',
        'mmi_support': 'inappropriate', 'procedures': 'inappropriate',
        'simultaneous_goals': 'more_than_capacity', 'available_time': 'continuously_inadequate',
    }
    r = H.cream(H.CreamRequest(cpc_levels=levels))
    assert r['sum_reduced'] == 6
    assert r['control_mode'] == 'scrambled'


def test_cream_grid_boundaries():
    r = H.cream(H.CreamRequest(cpc_levels={}))
    grid = r['grid']                       # rows improved 0-7, cols reduced 0-9
    assert len(grid) == 8 and len(grid[0]) == 10
    assert grid[4][0] == 'strategic'       # (reduced 0, improved 4)
    assert grid[4][1] == 'tactical'        # (1, 4)
    assert grid[0][5] == 'opportunistic'   # (5, 0)
    assert grid[0][6] == 'scrambled'       # (6, 0)
    assert grid[1][9] is None              # infeasible: reduced+improved > 9
    # The classified point always agrees with the grid cell it falls in.
    assert grid[r['sum_improved']][r['sum_reduced']] == r['control_mode']


# --- CREAM extended ---

def test_cream_extended_nominal_weights():
    r = H.cream_extended(H.CreamExtendedRequest(cpc_levels={}, steps=[
        {'description': 'start pump', 'activity': 'execute', 'failure_type': 'E5'}]))
    assert r['steps'][0]['cfp'] == pytest.approx(0.03)   # nominal E5, all weights 1
    assert r['hep'] == pytest.approx(0.03)


def test_cream_extended_time_pressure_multiplies():
    r = H.cream_extended(H.CreamExtendedRequest(
        cpc_levels={'available_time': 'continuously_inadequate'},
        steps=[{'activity': 'execute', 'failure_type': 'E5'}]))
    assert r['steps'][0]['weight'] == pytest.approx(5.0)
    assert r['steps'][0]['cfp'] == pytest.approx(0.15)


def test_cream_extended_overall_and_dominant():
    r = H.cream_extended(H.CreamExtendedRequest(cpc_levels={}, steps=[
        {'activity': 'diagnose', 'failure_type': 'I1'},
        {'activity': 'execute', 'failure_type': 'E3'}]))
    assert r['hep'] == pytest.approx(1 - (1 - 0.2) * (1 - 5e-4))
    assert r['dominant_step']['failure_type'] == 'I1'


def test_cream_extended_rejects_mismatched_function():
    with pytest.raises(ValueError):
        H.cream_extended(H.CreamExtendedRequest(cpc_levels={}, steps=[
            {'activity': 'observe', 'failure_type': 'E1'}]))   # execution ∉ observe


# --- SLIM ---

def test_slim_calibration():
    # SLI=60; anchors (20,0.1),(80,1e-4) -> a=-0.05,b=0 -> HEP=10^-3
    r = H.slim(H.SlimRequest(
        psfs=[{'weight': 0.5, 'rating': 50}, {'weight': 0.5, 'rating': 70}],
        anchors=[{'sli': 20, 'hep': 0.1}, {'sli': 80, 'hep': 0.0001}]))
    assert r['sli'] == pytest.approx(60.0)
    assert r['hep'] == pytest.approx(0.001, rel=1e-6)


def test_slim_requires_calibration():
    with pytest.raises(ValueError):
        H.slim(H.SlimRequest(psfs=[{'weight': 1, 'rating': 50}]))


# --- JHEDI / SHERPA / ATHEANA / MERMOS ---

def test_jhedi_screening():
    r = H.jhedi(H.JhediRequest(task_category='routine', aggravating_factors=2))
    assert r['hep'] == pytest.approx(0.09)   # 0.01 * 3^2
    assert r['deprecation_warning']


def test_category_screening_is_explicitly_labeled():
    r = H.category_screening(H.JhediRequest(
        task_category='routine', aggravating_factors=1))
    assert r['hep'] == pytest.approx(0.03)
    assert r['result_quality'] == 'screening'
    assert r['method_identity']['not_implemented_method'] == 'JHEDI'
    assert 'legacy_alias' not in r


def test_sherpa_aggregate():
    r = H.sherpa(H.SherpaRequest(rows=[
        {'error_mode': 'action', 'probability': 'M', 'critical': True},
        {'error_mode': 'checking', 'probability': 'L', 'critical': False}]))
    assert r['hep'] == pytest.approx(1 - 0.99 * 0.999)
    assert r['max_critical_probability'] == pytest.approx(0.01)
    assert r['counts_by_mode'] == {'action': 1, 'checking': 1}


def test_error_mode_screening_states_independence_assumption():
    r = H.error_mode_screening(H.SherpaRequest(rows=[
        {'error_mode': 'action', 'probability': 'M', 'critical': False}]))
    assert r['result_quality'] == 'screening'
    assert 'independent' in r['assumption']


def test_atheana_triangular_mean():
    r = H.atheana(H.AtheanaRequest(min_hep=0.001, mode_hep=0.01, max_hep=0.1))
    assert r['hep'] == pytest.approx((0.001 + 0.01 + 0.1) / 3)
    assert r['deprecation_warning']


def test_efc_screen_does_not_claim_atheana():
    r = H.efc_elicitation_screening(H.AtheanaRequest(
        min_hep=0.001, mode_hep=0.01, max_hep=0.1))
    assert r['method_identity']['not_implemented_method'] == 'ATHEANA'
    assert 'structured EFC workflow' in r['warning']
    assert 'full ATHEANA study' in r['warning']


def test_atheana_bad_order():
    with pytest.raises(ValueError):
        H.atheana(H.AtheanaRequest(min_hep=0.1, mode_hep=0.01, max_hep=0.001))


def test_mermos_scenario_sum():
    r = H.mermos(H.MermosRequest(scenarios=[
        {'label': 's1', 'probability': 0.02}, {'label': 's2', 'probability': 0.05}]))
    assert r['hep'] == pytest.approx(0.07)
    assert r['dominant_scenario']['label'] == 's2'


def test_mission_scenario_screen_requires_exclusivity():
    req = H.MermosRequest(scenarios=[{'label': 's1', 'probability': 0.02}])
    with pytest.raises(ValueError, match='mutually exclusive'):
        H.mission_scenario_screening(req)


def test_mission_scenario_screen_rejects_probability_sum_over_one():
    req = H.MermosRequest(mutually_exclusive=True, scenarios=[
        {'label': 's1', 'probability': 0.6},
        {'label': 's2', 'probability': 0.5},
    ])
    with pytest.raises(ValueError, match='sum to <= 1'):
        H.mission_scenario_screening(req)


def test_mission_scenario_screen_valid_sum():
    req = H.MermosRequest(mutually_exclusive=True, scenarios=[
        {'label': 's1', 'probability': 0.02},
        {'label': 's2', 'probability': 0.05},
    ])
    r = H.mission_scenario_screening(req)
    assert r['hep'] == pytest.approx(0.07)
    assert r['mutually_exclusive'] is True
    assert r['method_identity']['not_implemented_method'] == 'MERMOS'
