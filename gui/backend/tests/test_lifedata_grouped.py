"""Router contract tests for grouped LDA observation models."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'src'))

import pytest
from fastapi import HTTPException

from routers.life_data import (
    fit_grouped_distributions, grouped_distribution_plot, fit_turnbull,
)
from schemas import GroupedLifeFitRequest, GroupedLifePlotRequest, TurnbullRequest


def _frequency_request():
    return GroupedLifeFitRequest(
        observation_model='frequency_exact',
        frequency_observations=[
            {'time': 10, 'state': 'F', 'count': 5},
            {'time': 20, 'state': 'F', 'count': 8},
            {'time': 30, 'state': 'F', 'count': 3},
            {'time': 40, 'state': 'S', 'count': 4},
        ],
        distributions_to_fit=['Weibull_2P', 'Lognormal_2P'],
        CI=0.95,
    )


def test_frequency_fit_uses_standard_fit_response_with_weighted_plots():
    out = fit_grouped_distributions(_frequency_request())
    assert out['observation_model'] == 'frequency_exact'
    assert out['n_failures'] == 16
    assert out['n_censored'] == 4
    assert len(out['results']) == 2
    best = out['best_distribution']
    plot = out['plots'][best]
    assert plot['probability']['scatter_counts'] == [5, 8, 3]
    assert plot['probability']['censored_counts'] == [4]
    assert 'curves' in plot and 'qq' in plot and 'pp' in plot


def test_interval_fit_returns_turnbull_context_and_no_exact_probability_plot():
    req = GroupedLifeFitRequest(
        observation_model='interval_censored',
        interval_observations=[
            {'lower': None, 'upper': 10, 'count': 3},
            {'lower': 10, 'upper': 20, 'count': 4},
            {'lower': 20, 'upper': None, 'count': 2},
        ],
        distributions_to_fit=['Weibull_2P'],
    )
    out = fit_grouped_distributions(req)
    plot = out['plots']['Weibull_2P']
    assert 'probability' not in plot
    assert 'qq' not in plot and 'pp' not in plot
    assert plot['interval']['turnbull']['method'] == 'Turnbull EM NPMLE'
    assert out['empirical']['tail_mass'] == pytest.approx(2 / 9)
    assert out['results'][0]['AD'] is None


def test_interval_threshold_distribution_is_rejected_with_reason():
    req = GroupedLifeFitRequest(
        observation_model='interval_censored',
        interval_observations=[
            {'lower': 0, 'upper': 10, 'count': 3},
            {'lower': 10, 'upper': 20, 'count': 4},
        ],
        distributions_to_fit=['Weibull_3P'],
    )
    with pytest.raises(HTTPException) as exc:
        fit_grouped_distributions(req)
    assert exc.value.status_code == 400
    assert 'weakly identify' in exc.value.detail


def test_malformed_grouped_dataset_is_a_request_error_not_failed_fit_rows():
    req = GroupedLifeFitRequest(
        observation_model='frequency_exact',
        frequency_observations=[
            {'time': 10, 'state': 'F', 'count': 1},
            {'time': 20, 'state': 'S', 'count': 4},
        ],
        distributions_to_fit=['Weibull_2P', 'Lognormal_2P'],
    )
    with pytest.raises(HTTPException) as exc:
        fit_grouped_distributions(req)
    assert exc.value.status_code == 400
    assert 'At least 2 failures' in exc.value.detail


def test_grouped_plot_and_turnbull_endpoints():
    fit_req = _frequency_request()
    plot_req = GroupedLifePlotRequest(
        **fit_req.model_dump(), distribution='Weibull_2P')
    plot = grouped_distribution_plot(plot_req)
    assert plot['distribution'] == 'Weibull_2P'
    assert plot['method'] == 'MLE'

    empirical = fit_turnbull(TurnbullRequest(interval_observations=[
        {'lower': 0, 'upper': 10, 'count': 3},
        {'lower': 10, 'upper': 20, 'count': 4},
        {'lower': 20, 'upper': None, 'count': 2},
    ]))
    assert empirical['converged']
