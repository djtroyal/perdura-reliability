"""Router-level tests for the Wave-3 rigor enhancements."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import numpy as np
import pytest
from fastapi import HTTPException


# --- /doe/analyze ---

def _make_design_and_responses():
    from reliability.DOE import full_factorial_2level
    design = full_factorial_2level(['A', 'B', 'C'])
    runs = design['runs']
    y = [10 + 3 * r['A'] - 2 * r['B'] + 1.5 * r['A'] * r['B'] for r in runs]
    return runs, y


def test_doe_analyze_endpoint():
    from routers.doe import analyze, AnalyzeRequest
    runs, y = _make_design_and_responses()
    out = analyze(AnalyzeRequest(factor_names=['A', 'B', 'C'], runs=runs, responses=y))
    eff = {e['term']: e['effect'] for e in out['effects']}
    assert eff['A'] == pytest.approx(6.0)
    assert eff['A:B'] == pytest.approx(3.0)
    assert 'half_normal' in out and 'main_effects' in out


def test_doe_analyze_length_mismatch_400():
    from routers.doe import analyze, AnalyzeRequest
    runs, y = _make_design_and_responses()
    with pytest.raises(HTTPException) as exc:
        analyze(AnalyzeRequest(factor_names=['A', 'B', 'C'], runs=runs, responses=y[:-1]))
    assert exc.value.status_code == 400


def test_doe_generate_returns_factor_names():
    from routers.doe import generate_design, GenerateRequest
    out = generate_design(GenerateRequest(design='full_factorial_2level',
                                          factor_names=['A', 'B']))
    assert out['factor_names'] == ['A', 'B']


# --- /descriptive/qq ---

def test_descriptive_qq_endpoint():
    from routers.descriptive import qq, QQRequest
    rng = np.random.default_rng(41)
    out = qq(QQRequest(values=list(rng.normal(0, 1, 30))))
    assert len(out['theoretical']) == 30 == len(out['sample'])
    assert out['line']['slope'] > 0
    assert out['shapiro_p'] is not None


# --- /life-data/fit includes Q-Q / P-P coordinates ---

def test_life_data_fit_includes_qq_pp():
    from routers.life_data import fit_distributions, LifeDataFitRequest
    rng = np.random.default_rng(42)
    failures = (100 * rng.weibull(2.0, 25)).tolist()
    out = fit_distributions(LifeDataFitRequest(
        failures=failures, distributions_to_fit=['Weibull_2P']))
    plot = out['plots']['Weibull_2P']
    assert 'qq' in plot and 'pp' in plot
    assert len(plot['qq']['theoretical']) == 25
    pp = plot['pp']
    assert all(0 <= v <= 1 for v in pp['empirical'])
    assert all(0 <= v <= 1 for v in pp['fitted'])
    # A good fit keeps P-P points near the diagonal.
    diffs = [abs(a - b) for a, b in zip(pp['empirical'], pp['fitted'])]
    assert max(diffs) < 0.35


# --- /capability includes non-normal block ---

def test_capability_non_normal_block():
    from routers.capability import analyze as cap_analyze, CapabilityRequest
    rng = np.random.default_rng(43)
    data = list(rng.lognormal(1.0, 0.6, 200))
    out = cap_analyze(CapabilityRequest(data=data, lsl=0.5, usl=15.0))
    assert out['non_normal'] is not None
    assert out['non_normal']['Ppk'] is not None


# --- regression /fit includes diagnostics ---

def test_regression_fit_includes_diagnostics():
    from routers.regression import fit_regression, FitRequest
    rng = np.random.default_rng(44)
    x = list(rng.uniform(0, 10, 40))
    y = [1 + 2 * v + float(rng.normal(0, 1)) for v in x]
    out = fit_regression(FitRequest(model='linear', data={'x': x, 'y': y},
                                    y='y', x=['x']))
    d = out['diagnostics']
    assert len(d['std_residuals']) == 40
    assert d['leverage'] is not None
    assert d['qq']['theoretical'][0] < 0


# --- /life-data/special includes parameter CIs ---

def test_special_model_params_carry_cis():
    from routers.life_data import fit_special_model, SpecialModelRequest
    rng = np.random.default_rng(45)
    f = np.concatenate([50 * rng.weibull(2.0, 40),
                        300 * rng.weibull(3.0, 40)]).tolist()
    out = fit_special_model(SpecialModelRequest(model='mixture', failures=f))
    p0 = out['params'][0]
    assert 'lower_ci' in p0 and 'upper_ci' in p0
    assert p0['lower_ci'] < p0['value'] < p0['upper_ci']


# --- /alt fit reports use-level life CI ---

def test_alt_fit_reports_use_level_ci():
    from routers.alt import fit_alt, ALTFitRequest
    rng = np.random.default_rng(46)
    stresses = np.repeat([350.0, 400.0, 450.0], 20)
    eta = 40 * np.exp(1800 / stresses)
    lifes = (eta * rng.weibull(2.5, len(stresses))).tolist()
    out = fit_alt(ALTFitRequest(
        failures=lifes, failure_stress=list(stresses),
        use_level_stress=300.0, models_to_fit=['Weibull_Exponential']))
    d = out['model_details']['Weibull_Exponential']
    assert d['life_b50_lower'] is not None and d['life_b50_upper'] is not None
    assert d['life_b50_lower'] < d['life_b50'] < d['life_b50_upper']
