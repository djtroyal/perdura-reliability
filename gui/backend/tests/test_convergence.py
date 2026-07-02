"""Tests for the Monte-Carlo convergence diagnostic."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest

from utils import convergence_series


def test_convergence_series_shape_and_final_mean():
    rng = np.random.default_rng(1)
    x = rng.normal(10.0, 2.0, 5000)
    c = convergence_series(x)
    assert c is not None
    # Monotone n, capped at 100 points, ends at the full sample size.
    assert c['n'] == sorted(c['n'])
    assert len(c['n']) <= 100
    assert c['n'][-1] == 5000
    # The last running mean equals the overall mean.
    assert c['mean'][-1] == pytest.approx(float(np.mean(x)))
    # Band brackets the mean everywhere.
    for m, lo, hi in zip(c['mean'], c['ci_lower'], c['ci_upper']):
        assert lo <= m <= hi


def test_convergence_band_shrinks_like_sqrt_n():
    rng = np.random.default_rng(2)
    x = rng.normal(0.0, 1.0, 10000)
    c = convergence_series(x)
    early = c['ci_upper'][3] - c['ci_lower'][3]
    late = c['ci_upper'][-1] - c['ci_lower'][-1]
    assert late < early / 3    # width ~ 1/sqrt(n): much narrower by the end


def test_convergence_series_degenerate():
    assert convergence_series([1.0]) is None
    assert convergence_series([]) is None
    # Constant sequence: zero-width band, no NaN.
    c = convergence_series([5.0] * 50)
    assert c['mean'][-1] == pytest.approx(5.0)
    assert c['ci_upper'][-1] == pytest.approx(5.0)


def test_mc_equation_returns_convergence():
    from routers import life_data as LD
    from schemas import MCEquationRequest
    req = MCEquationRequest(
        variables=[{'name': 'A', 'distribution': 'Normal_2P', 'params': {'mu': 100, 'sigma': 10}},
                   {'name': 'B', 'distribution': 'Normal_2P', 'params': {'mu': 50, 'sigma': 5}}],
        equation='A + B', n=2000, seed=42)
    r = LD.mc_equation(req)
    c = r['convergence']
    assert c is not None and c['n'][-1] == r['n_valid']
    assert c['mean'][-1] == pytest.approx(np.mean(r['samples']), rel=1e-6)


def test_cfm_monte_carlo_returns_convergence():
    from routers import life_data as LD
    from schemas import CFMMonteCarloRequest
    req = CFMMonteCarloRequest(
        distribution='Weibull_2P',
        modes=[{'mode': 'wear', 'params': {'eta': 1000, 'beta': 2.5}},
               {'mode': 'fatigue', 'params': {'eta': 1500, 'beta': 3.0}}],
        n_samples=500, seed=7)
    r = LD.cfm_monte_carlo(req)
    c = r['convergence']
    assert c is not None and c['n'][-1] == 500
    assert c['mean'][-1] > 0
