"""API contracts for CTMC disclosure, phase-type dwell times, and uncertainty."""

import pytest
from fastapi import HTTPException


def _request(**overrides):
    from schemas import MarkovRequest

    payload = {
        'states': [
            {
                'id': 'up', 'name': 'Up', 'state_type': 'operational',
                'dwell_model': 'exponential', 'dwell_shape': 1,
            },
            {
                'id': 'down', 'name': 'Down', 'state_type': 'failed',
                'dwell_model': 'exponential', 'dwell_shape': 1,
            },
        ],
        'transitions': [
            {'from_state': 'up', 'to_state': 'down', 'rate': 0.01},
            {'from_state': 'down', 'to_state': 'up', 'rate': 0.1},
        ],
        'times': [0, 10, 100],
        'initial_state': 'up',
        'uncertainty_samples': 40,
        'uncertainty_ci': 0.9,
        'uncertainty_seed': 17,
    }
    payload.update(overrides)
    return MarkovRequest(**payload)


def test_ctmc_response_discloses_assumptions_and_uncertainty_status():
    from routers.markov import analyze

    result = analyze(_request())
    assert result['model_contract']['selected_model'] == 'time_homogeneous_ctmc'
    assert any('memoryless' in item for item in result['model_contract']['assumptions'])
    assert result['parameter_uncertainty']['status'] == 'not_requested'
    assert result['phase_type']['status'] == 'not_applied'
    assert len(result['transition_matrix']) == 2


def test_erlang_router_returns_aggregated_phase_solution_and_ctmc_baseline():
    from routers.markov import analyze

    req = _request(states=[
        {
            'id': 'up', 'name': 'Up', 'state_type': 'operational',
            'dwell_model': 'erlang', 'dwell_shape': 3,
        },
        {
            'id': 'down', 'name': 'Down', 'state_type': 'failed',
            'dwell_model': 'erlang', 'dwell_shape': 2,
        },
    ])
    result = analyze(req)
    assert result['model_contract']['selected_model'] == 'erlang_phase_type'
    assert result['phase_type']['status'] == 'applied'
    assert result['phase_type']['expanded_state_count'] == 5
    assert result['phase_type']['mean_preserving'] is True
    assert set(result['time_dependent'][1]['state_probs']) == {'up', 'down'}
    assert result['ctmc_baseline']['time_dependent']
    assert result['time_dependent'][1]['availability'] != pytest.approx(
        result['ctmc_baseline']['time_dependent'][1]['availability'])
    # The displayed matrix remains the public input-rate CTMC reference.
    assert len(result['transition_matrix']) == 2


def test_rate_cv_produces_seeded_propagated_intervals():
    from routers.markov import analyze

    req = _request(transitions=[
        {
            'from_state': 'up', 'to_state': 'down', 'rate': 0.01,
            'rate_cv': 0.25,
        },
        {
            'from_state': 'down', 'to_state': 'up', 'rate': 0.1,
            'rate_cv': 0.15,
        },
    ])
    first = analyze(req)
    second = analyze(req)
    uncertainty = first['parameter_uncertainty']
    assert uncertainty == second['parameter_uncertainty']
    assert uncertainty['status'] == 'complete'
    assert uncertainty['successful_samples'] == 40
    assert uncertainty['mission_time'] == 100
    assert 'availability_at_mission' in uncertainty['metric_intervals']
    assert len(uncertainty['rate_intervals']) == 2


def test_unknown_initial_state_and_negative_time_are_clear_client_errors():
    from routers.markov import analyze

    with pytest.raises(HTTPException) as exc:
        analyze(_request(initial_state='missing'))
    assert exc.value.status_code == 422
    assert any(issue['code'] == 'UNKNOWN_INITIAL_STATE'
               for issue in exc.value.detail['issues'])

    with pytest.raises(HTTPException) as exc:
        analyze(_request(times=[-1, 0, 1]))
    assert exc.value.status_code == 422
    assert any(issue['code'] == 'INVALID_TIME_GRID'
               for issue in exc.value.detail['issues'])


def test_example_contract_includes_dwell_and_rate_uncertainty_defaults():
    from routers.markov import get_example

    result = get_example('simple_repairable')
    assert result['states'][0]['dwell_model'] == 'exponential'
    assert result['states'][0]['dwell_shape'] == 1
    assert result['transitions'][0]['rate_cv'] == 0
    assert result['transitions'][0]['id'] == 'tr1'


def test_validation_reports_structural_and_interpretation_findings():
    from routers.markov import validate

    req = _request(
        states=[
            {'id': 'up', 'name': 'Up', 'state_type': 'operational'},
            {'id': 'orphan', 'name': 'Orphan', 'state_type': 'degraded',
             'dwell_model': 'erlang', 'dwell_shape': 3},
        ],
        transitions=[
            {'id': 'loop', 'from_state': 'up', 'to_state': 'up', 'rate': 0.1},
            {'id': 'zero', 'from_state': 'up', 'to_state': 'orphan',
             'rate': 0, 'rate_cv': 0.2},
        ],
        times=[0, 2, 1],
    )
    result = validate(req)
    codes = {issue['code'] for issue in result['issues']}

    assert result['valid'] is False
    assert {'SELF_TRANSITION', 'UNSORTED_TIME_GRID'} <= codes
    assert {'NO_FAILED_STATE', 'ZERO_TRANSITION_RATE', 'ZERO_RATE_UNCERTAINTY',
            'UNREACHABLE_STATE', 'ERLANG_ABSORBING_STATE'} <= codes


def test_analyze_preserves_stable_transition_ids_and_validation_summary():
    from routers.markov import analyze

    req = _request(transitions=[
        {'id': 'failure', 'from_state': 'up', 'to_state': 'down', 'rate': 0.01},
        {'id': 'repair', 'from_state': 'down', 'to_state': 'up', 'rate': 0.1},
    ])
    result = analyze(req)

    assert [transition['id'] for transition in result['transitions']] == [
        'failure', 'repair',
    ]
    assert result['validation']['valid'] is True
    assert result['validation']['summary']['initial_state'] == 'up'
