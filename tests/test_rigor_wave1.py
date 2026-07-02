"""Tests for the Wave-1 rigor fixes: values hand-computed or cross-checked
against the named references."""

import math

import numpy as np
import pytest

from reliability.Repairable_systems import optimal_replacement_time
from reliability.MSA import _k1, _k2, _k3
from reliability.FaultTree import FaultTree, BasicEvent, AndGate, OrGate
from reliability.Fitters import Fit_Weibull_2P, Fit_Everything
from reliability.Utils import anderson_darling


# --- 2a: corrective-only baseline uses MTTF, not alpha ---

def test_corrective_baseline_uses_mttf():
    res = optimal_replacement_time(cost_PM=1, cost_CM=5,
                                   weibull_alpha=1000, weibull_beta=2.5)
    mttf = 1000 * math.gamma(1 + 1 / 2.5)      # ≈ 887.3
    assert res['corrective_only_cost_rate'] == pytest.approx(5 / mttf)
    # Back-compat alias carries the corrected value.
    assert res['cost_PM_per_unit_time'] == pytest.approx(5 / mttf)
    # For a wear-out item the optimal policy must beat run-to-failure.
    assert res['min_cost'] < res['corrective_only_cost_rate']


# --- 3a: MSA K2/K3 use the single-range d2* (g=1) constants ---

def test_msa_k_constants_match_aiag():
    assert _k2(2) == pytest.approx(1 / 1.41, rel=1e-3)   # 0.7071 per AIAG
    assert _k2(3) == pytest.approx(1 / 1.91, rel=1e-3)
    assert _k3(10) == pytest.approx(1 / 3.18, rel=1e-3)
    # K1 (averaged ranges) stays on the asymptotic d2 table.
    assert _k1(2) == pytest.approx(1 / 1.128, rel=1e-3)
    assert _k1(3) == pytest.approx(1 / 1.693, rel=1e-3)


# --- 2b: fault-tree importance consistent with exact I-E under shared events ---

def test_fta_importance_exact_with_shared_event():
    # TOP = OR(AND(A,B), AND(A,C)) with A shared between both gates.
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    c = BasicEvent('C', 0.3)
    top = OrGate('TOP', [AndGate('G1', [a, b]), AndGate('G2', [a, c])])
    ft = FaultTree(top)

    # Exact: P(top) = P(A)·(P(B)+P(C)−P(B)P(C)) = 0.1·0.44 = 0.044
    assert ft.top_event_probability == pytest.approx(0.044)
    # Birnbaum(A) = P(top|A=1) − P(top|A=0) = 0.44 − 0 = 0.44
    assert ft.birnbaum_importance('A') == pytest.approx(0.44)
    # RAW(A) = P(top|A=1)/P(top) = 0.44/0.044 = 10
    assert ft.raw_importance('A') == pytest.approx(10.0)
    # RRW(A) = P(top)/P(top|A=0) → infinity (A is a single point of failure)
    assert ft.rrw_importance('A') == float('inf')
    # Birnbaum(B) = P(A)·(1−P(C)) = 0.1·0.7 = 0.07
    assert ft.birnbaum_importance('B') == pytest.approx(0.07)


# --- 1a: Anderson-Darling suppressed under censoring ---

def test_ad_none_under_censoring():
    rng = np.random.default_rng(11)
    fails = (1000 * rng.weibull(2.0, 30)).tolist()
    fit = Fit_Weibull_2P(failures=fails, right_censored=[2000.0, 2000.0])
    assert fit.AD is None
    # Complete sample still gets a finite AD.
    fit2 = Fit_Weibull_2P(failures=fails)
    assert fit2.AD is not None and np.isfinite(fit2.AD)


def test_ad_helper_contract():
    assert anderson_darling([1, 2, 3], lambda x: np.clip(x / 4, 0, 1),
                            right_censored=[5.0]) is None


def test_fit_everything_ad_sort_falls_back_when_censored():
    rng = np.random.default_rng(12)
    fails = (1000 * rng.weibull(2.0, 25)).tolist()
    fe = Fit_Everything(failures=fails, right_censored=[1800.0, 1900.0],
                        sort_by='AD', show_probability_plot=False,
                        show_histogram_plot=False)
    # AD is None everywhere → ranking falls back to AICc without crashing,
    # and the winner equals the AICc winner.
    fe2 = Fit_Everything(failures=fails, right_censored=[1800.0, 1900.0],
                         sort_by='AICc', show_probability_plot=False,
                         show_histogram_plot=False)
    assert fe.best_distribution_name == fe2.best_distribution_name
    assert all(v is None or (isinstance(v, float) and np.isnan(v))
               for v in fe.results['AD'].tolist())
