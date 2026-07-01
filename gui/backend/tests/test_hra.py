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


def test_sherpa_aggregate():
    r = H.sherpa(H.SherpaRequest(rows=[
        {'error_mode': 'action', 'probability': 'M', 'critical': True},
        {'error_mode': 'checking', 'probability': 'L', 'critical': False}]))
    assert r['hep'] == pytest.approx(1 - 0.99 * 0.999)
    assert r['max_critical_probability'] == pytest.approx(0.01)
    assert r['counts_by_mode'] == {'action': 1, 'checking': 1}


def test_atheana_triangular_mean():
    r = H.atheana(H.AtheanaRequest(min_hep=0.001, mode_hep=0.01, max_hep=0.1))
    assert r['hep'] == pytest.approx((0.001 + 0.01 + 0.1) / 3)


def test_atheana_bad_order():
    with pytest.raises(ValueError):
        H.atheana(H.AtheanaRequest(min_hep=0.1, mode_hep=0.01, max_hep=0.001))


def test_mermos_scenario_sum():
    r = H.mermos(H.MermosRequest(scenarios=[
        {'label': 's1', 'probability': 0.02}, {'label': 's2', 'probability': 0.05}]))
    assert r['hep'] == pytest.approx(0.07)
    assert r['dominant_scenario']['label'] == 's2'
