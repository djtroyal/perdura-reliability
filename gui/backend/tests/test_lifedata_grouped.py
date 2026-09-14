"""Router contract tests for grouped LDA observation models."""

import sys
from importlib import import_module
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'src'))

import pytest
from fastapi import HTTPException

# Resolve one module identity: source and installed package bridges can expose
# both qualified router names when this suite is collected independently.
life_data = import_module('routers.life_data')
fit_grouped_distributions = life_data.fit_grouped_distributions
grouped_distribution_plot = life_data.grouped_distribution_plot
fit_turnbull = life_data.fit_turnbull
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
    assert exc.value.detail == life_data._GROUPED_INPUT_ERROR


def test_grouped_candidate_failure_does_not_expose_exception_text(monkeypatch):
    secret = 'internal stack detail /srv/private/model.py:417'

    def fail_fit(*_args, **_kwargs):
        raise RuntimeError(secret)

    monkeypatch.setattr(life_data, 'fit_grouped_life', fail_fit)
    req = _frequency_request()
    req.distributions_to_fit = ['Weibull_2P']

    out = fit_grouped_distributions(req)

    assert out['results'][0]['eligibility_reasons'] == ['fit_failed']
    assert out['results'][0]['diagnostics'] is None
    assert secret not in str(out)


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


def test_turnbull_unconverged_base_is_a_controlled_request_error():
    req = TurnbullRequest(interval_observations=[
        {'lower': 0, 'upper': 2, 'count': 1},
        {'lower': 1, 'upper': 3, 'count': 10000},
        {'lower': 2, 'upper': None, 'count': 1},
    ], n_bootstrap=20, seed=1)
    with pytest.raises(HTTPException) as exc:
        fit_turnbull(req)
    assert exc.value.status_code == 400
    assert exc.value.detail == (
        'Turnbull estimation did not converge; confidence bands are unavailable.')


def test_turnbull_bootstrap_failure_does_not_expose_internal_details(monkeypatch):
    import reliability.Grouped_life as grouped

    def failed_bootstrap(*args, **kwargs):
        raise life_data.FitConvergenceError('internal solver detail /private/run')

    monkeypatch.setattr(grouped, 'turnbull_bootstrap', failed_bootstrap)
    req = TurnbullRequest(interval_observations=[
        {'lower': 0, 'upper': 10, 'count': 3},
        {'lower': 10, 'upper': 20, 'count': 4},
    ], n_bootstrap=20)
    with pytest.raises(HTTPException) as exc:
        fit_turnbull(req)
    assert exc.value.status_code == 400
    assert 'confidence bands are unavailable' in exc.value.detail
    assert '/private/run' not in exc.value.detail


def test_grouped_exponential_exact_frequency_serializes_exact_metadata():
    req = GroupedLifeFitRequest(
        observation_model='frequency_exact',
        frequency_observations=[
            {'time': 10, 'state': 'F', 'count': 2},
            {'time': 20, 'state': 'F', 'count': 2},
            {'time': 20, 'state': 'S', 'count': 1},
        ],
        distributions_to_fit=['Exponential_2P'],
        CI=0.95,
    )
    out = fit_grouped_distributions(req)
    row = out['results'][0]
    plot = out['plots']['Exponential_2P']
    assert row['confidence']['available'] is True
    assert row['confidence']['sample_design'] == 'type_ii'
    assert row['parameter_ci_method'] == (
        'exact_chi_square_and_support_bounded_f'
    )
    assert plot['confidence']['band_scope'] == 'simultaneous'
    assert row['params']['Lambda_se'] is None
    assert 'continuous_time_ties_or_rounding' in row['uncertainty_warnings']


def test_interval_exponential_reports_exact_inference_unavailable():
    req = GroupedLifeFitRequest(
        observation_model='interval_censored',
        interval_observations=[
            {'lower': 0, 'upper': 10, 'count': 3},
            {'lower': 10, 'upper': 20, 'count': 4},
            {'lower': 20, 'upper': None, 'count': 2},
        ],
        distributions_to_fit=['Exponential_1P'],
    )
    out = fit_grouped_distributions(req)
    row = out['results'][0]
    assert row['confidence']['available'] is False
    assert row['confidence']['reason'] == 'interval_censored_data'
    assert row['parameter_ci_method'] == 'exact_unavailable'
    assert 'Lambda_lower' not in row['params']
    assert 'sf_lower' not in out['plots']['Exponential_1P']['curves']
