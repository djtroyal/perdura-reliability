"""Interval-censored degradation life-fit tests."""

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException


BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

from routers.alt import (  # noqa: E402
    _fit_interval_censored_life_distribution,
    degradation,
)
from routers import alt as alt_router  # noqa: E402
from schemas import DegradationRequest  # noqa: E402


def test_interval_censored_weibull_recovers_seeded_population():
    rng = np.random.default_rng(123)
    lives = rng.weibull(2.0, size=300) * 100.0
    intervals = []
    right_censored = []
    for life in lives:
        if life > 150:
            right_censored.append(150.0)
        else:
            lower = np.floor(life / 10.0) * 10.0
            intervals.append((lower, lower + 10.0))

    result = _fit_interval_censored_life_distribution(
        exact_failures=[],
        intervals=intervals,
        right_censored=right_censored,
        dist_name="Weibull_2P",
    )

    assert result["fit_method"] == "interval_censored_mle"
    assert result["observation_counts"]["total"] == len(lives)
    assert result["observation_counts"]["interval"] == len(intervals)
    assert result["observation_counts"]["right_censored"] == len(right_censored)
    assert result["params"]["alpha"] == pytest.approx(100.0, rel=0.15)
    assert result["params"]["beta"] == pytest.approx(2.0, rel=0.25)


def _degradation_request():
    data = {
        "U1": ([0, 10, 20], [0, 3, 7]),
        "U2": ([0, 10, 20], [0, 4, 9]),
        # Moves away from an upper failure threshold: survive through t=20.
        "U3": ([0, 10, 20], [2, 1.5, 1]),
        # Threshold is first observed crossed between t=10 and t=20.
        "U4": ([0, 10, 20], [1, 6, 12]),
    }
    unit_ids = []
    times = []
    measurements = []
    for unit_id, (unit_times, unit_measurements) in data.items():
        for time, measurement in zip(unit_times, unit_measurements):
            unit_ids.append(unit_id)
            times.append(time)
            measurements.append(measurement)
    return DegradationRequest(
        unit_ids=unit_ids,
        times=times,
        measurements=measurements,
        threshold=10,
        threshold_direction="above",
        degradation_model="linear",
        life_distribution="Weibull_2P",
        ci=0.90,
    )


def test_degradation_uses_one_likelihood_term_per_unit_and_retains_censoring():
    result = degradation(_degradation_request())

    summary = result["life_data_summary"]
    assert summary == {
        "exact": 2,
        "interval": 1,
        "right_censored": 1,
        "total_units_used": 4,
        "units_dropped": 0,
        "interval_sources": {"observed_threshold_crossing": 1},
    }
    assert result["distribution_fit_error"] is None
    assert result["distribution_fit"]["observation_counts"]["total"] == 4
    assert result["projection_uncertainty"]["method"] == "delta_method"
    assert result["projection_uncertainty"]["likelihood_role"] == "display_only"
    assert result["projection_uncertainty"]["intervals_available"] >= 2

    by_unit = {row["unit_id"]: row for row in result["unit_table"]}
    assert by_unit["U3"]["life_observation"] == "right_censored"
    assert by_unit["U3"]["censor_time"] == 20.0
    assert by_unit["U4"]["life_observation"] == "interval_censored"
    assert by_unit["U4"]["interval_source"] == "observed_threshold_crossing"
    assert by_unit["U4"]["inspection_lower"] == 10.0
    assert by_unit["U4"]["inspection_upper"] == 20.0
    for unit_id in ("U1", "U2"):
        assert by_unit[unit_id]["life_observation"] == "projected_exact"
        assert by_unit[unit_id]["projection_lower"] is not None
        assert by_unit[unit_id]["projection_upper"] is not None
        assert by_unit[unit_id]["inspection_lower"] is None
        assert by_unit[unit_id]["inspection_upper"] is None


def test_degradation_distribution_failure_does_not_expose_exception_details(
        monkeypatch):
    def fail_fit(*_args, **_kwargs):
        raise ValueError("sensitive-internal-life-fit-detail")

    monkeypatch.setattr(
        alt_router, "_fit_interval_censored_life_distribution", fail_fit)

    result = degradation(_degradation_request())

    assert result["distribution_fit"] is None
    assert result["distribution_fit_error"] == (
        "The requested life distribution could not be fitted to the "
        "projected observations."
    )
    assert "sensitive-internal-life-fit-detail" not in str(result)


def test_degradation_rejects_duplicate_unit_times():
    request = _degradation_request()
    request.times[1] = request.times[0]
    with pytest.raises(HTTPException) as caught:
        degradation(request)
    assert caught.value.status_code == 400
    assert "unique, strictly increasing" in caught.value.detail
