"""Reference checks for Weibull burn-in conditional-life calculations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from routers import alt
from schemas import BurnInRequest


def _burn_in(**overrides):
    values = {
        "duration": 20.0,
        "beta": 1.0,
        "eta": 100.0,
        "n_units": 100,
        "acceleration_factor": 1.0,
    }
    values.update(overrides)
    return alt.burn_in(BurnInRequest(**values))


def test_exponential_mean_residual_life_is_memoryless():
    result = _burn_in()
    assert result["post_burn_in_mean_residual_life"] == pytest.approx(100.0)
    assert "post_burn_in_mtbf" not in result


def test_weibull_mean_residual_life_includes_infinite_tail():
    # Closed form for beta=0.5, eta=100 and burn-in age 20 is
    # 2*eta*(1 + sqrt(t/eta)) = 289.442719...
    result = _burn_in(beta=0.5)
    assert result["post_burn_in_mean_residual_life"] == pytest.approx(289.443, abs=5e-4)
    # This deliberately exceeds the plot's 2*eta horizon, proving that the
    # display grid no longer truncates the expectation.
    assert result["post_burn_in_mean_residual_life"] > max(result["reliability_plot"]["time"])


def test_acceleration_factor_sets_equivalent_burn_in_age():
    accelerated = _burn_in(duration=10.0, acceleration_factor=2.0, beta=2.0)
    equivalent = _burn_in(duration=20.0, acceleration_factor=1.0, beta=2.0)
    assert accelerated["effective_burn_in_time"] == equivalent["effective_burn_in_time"]
    assert accelerated["post_burn_in_mean_residual_life"] == pytest.approx(
        equivalent["post_burn_in_mean_residual_life"])
