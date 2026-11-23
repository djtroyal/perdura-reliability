"""Exception diagnostics remain server-side across analysis API families."""

import importlib
from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# Invoke the actual router and request model; replace only the failing analysis
# dependency. This catches disclosures in HTTP errors that successful fits miss.
CASES = [
    ('allocation', '/allocate', 'allocate',
     {'target_reliability': .9, 'subsystems': [{}]}, 'AllocationError', 400, 'subsystem weights'),
    ('allocation', '/allocate', 'allocate',
     {'target_reliability': .9, 'subsystems': [{}]}, 'RuntimeError', 500, 'allocation'),
    ('capability', '/analyze', 'process_capability',
     {'data': [1., 2., 3.], 'lsl': 0., 'usl': 4.}, 'ValueError', 400, 'specification limits'),
    ('doe', '/generate', 'full_factorial_2level',
     {'design': 'full_factorial_2level', 'n_factors': 2}, 'ValueError', 400, 'factor count'),
    ('doe', '/generate', 'full_factorial_2level',
     {'design': 'full_factorial_2level', 'n_factors': 2}, 'RuntimeError', 500, 'experiment design'),
    ('doe', '/analyze', 'analyze_experiment',
     {'factor_names': ['A'], 'runs': [{'A': -1}, {'A': 1}], 'responses': [1., 2.]},
     '_TwoLevelFactorError', 400, 'exactly 2 levels'),
    ('growth', '/fit', 'CrowAMSAA',
     {'times': [1., 2., 4.], 'T': 10., 'termination': 'time'}, 'ValueError', 400, 'censoring limits'),
    ('growth', '/fit', 'CrowAMSAA',
     {'times': [1., 2., 4.], 'T': 10., 'termination': 'time'}, 'RuntimeError', 500, 'growth fitting'),
    ('hypothesis', '/run', 'one_sample_t',
     {'test': 'one_sample_t', 'data': [1., 2., 3.]}, 'ValueError', 400, 'sample sizes'),
    ('hypothesis', '/run', 'one_sample_t',
     {'test': 'one_sample_t', 'data': [1., 2., 3.]}, 'RuntimeError', 500, 'hypothesis test'),
    ('inventory', '/plan', 'lifetime_inventory',
     {'items': [{'part_number': 'P1', 'quantity': 1, 'failure_rate': .01}],
      'mode': 'lifetime', 'horizon': 100.}, 'ValueError', 422, 'cohort timing'),
    ('life_tools', '/mechanical-rate', 'mechanical_equivalent_rate',
     {'beta': 2., 'eta': 100., 'interval': 10.}, 'ValueError', 400, 'exposure basis'),
    ('msa', '/gage-rr', 'gage_rr_anova',
     {'parts': ['P1', 'P1'], 'operators': ['O1', 'O1'], 'measurements': [1., 2.]},
     'RuntimeError', 400, 'part/operator assignments'),
    ('ram', '/spares', 'NegativeBinomialDemand',
     {'quantity': 1, 'op_hours': 100., 'failure_rate': .01, 'model': 'negative_binomial'},
     'ValueError', 422, 'positive dispersion'),
    ('regression', '/fit', 'linear_regression',
     {'model': 'linear', 'data': {'x': [1., 2., 3.], 'y': [2., 4., 6.]},
      'x': ['x'], 'y': 'y'}, 'ValueError', 400, 'matching column lengths'),
    ('regression', '/fit', 'linear_regression',
     {'model': 'linear', 'data': {'x': [1., 2., 3.], 'y': [2., 4., 6.]},
      'x': ['x'], 'y': 'y'}, '_RankDeficientError', 400, 'Rank-deficient'),
    ('spc', '/chart', 'control_chart',
     {'chart': 'i_mr', 'data': [1., 2., 3.]}, 'ValueError', 400, 'subgroup sizes'),
    ('system_tools', '/redundancy', 'redundancy_model',
     {}, 'KeyError', 422, 'required/total units'),
    ('warranty', '/convert', 'nevada_to_grouped_life_data',
     {'quantities': [10.], 'returns': [[1.]]}, 'ValueError', 400, 'cohort/period alignment'),
    ('warranty', '/convert', 'nevada_to_grouped_life_data',
     {'quantities': [10.], 'returns': [[1.]]}, 'RuntimeError', 500, 'warranty chart'),
]


@pytest.mark.parametrize('module_name,path,dependency,payload,error_name,status,guidance', CASES,
                         ids=[f'{case[0]}-{case[4]}' for case in CASES])
def test_analysis_http_errors_hide_exception_and_cause(
        monkeypatch, caplog, module_name, path, dependency, payload, error_name, status, guidance):
    module = importlib.import_module(f'routers.{module_name}')
    error_type = (getattr(module, error_name) if hasattr(module, error_name)
                  else getattr(importlib.import_module('builtins'), error_name))
    private_detail = '/private/operator-home/private-analysis-error-sentinel'
    private_cause = 'private-analysis-cause-sentinel'

    def failing_analysis(*_args, **_kwargs):
        try:
            raise OSError(private_cause)
        except OSError as exc:
            raise error_type(private_detail) from exc

    monkeypatch.setattr(module, dependency, failing_analysis)
    app = FastAPI()
    app.include_router(module.router)
    with TestClient(app) as client:
        response = client.post(path, json=payload)
    assert response.status_code == status, response.text
    assert guidance in response.json()['detail']
    assert private_detail not in response.text
    assert private_cause not in response.text
    assert private_detail in caplog.text
    assert private_cause in caplog.text


def test_inventory_preserves_authored_mode_validation_message():
    from routers import inventory

    app = FastAPI()
    app.include_router(inventory.router)
    with TestClient(app) as client:
        response = client.post('/plan', json={
            'items': [{'part_number': 'P1', 'quantity': 1, 'failure_rate': .01,
                       'repair_probability': .5}],
            'mode': 'period', 'horizon': 100.,
        })
    assert response.status_code == 422
    assert response.json()['detail'] == (
        'Cohort, repair-yield and storage-loss models require Lifetime procurement mode.')


@pytest.mark.parametrize('family', ['lifetime', 'system'])
@pytest.mark.parametrize('known_code', [True, False])
def test_coded_domain_errors_never_echo_mutable_exception_text(
        monkeypatch, caplog, family, known_code):
    from routers import life_tools, system_tools

    private_detail = '/private/operator-home/private-coded-error-sentinel'
    if family == 'lifetime':
        module = life_tools
        error = life_tools._LifetimeInputError('scale_out_of_range')
        dependency, path = 'mechanical_equivalent_rate', '/mechanical-rate'
        payload, status = {'beta': 2., 'eta': 100., 'interval': 10.}, 400
        guidance = 'outside floating-point range' if known_code else 'lifetime calculation'
    else:
        module = system_tools
        error = system_tools._SystemLifecycleInputError('dynamic_fta')
        dependency, path = '_structure', '/simulate'
        payload = {'diagram': {'nodes': [{'id': 'root'}], 'edges': []}}
        status = 422
        guidance = 'dynamic SPARE/PAND/SEQ/FDEP' if known_code else 'system simulation'
    # A known type is not permission to copy its message, including when its
    # code is invalid or an internal caller has supplied unexpected details.
    error.args = (private_detail,)
    if not known_code:
        error.code = 'unrecognized-private-code'

    def fail(*_args, **_kwargs):
        raise error

    monkeypatch.setattr(module, dependency, fail)
    app = FastAPI()
    app.include_router(module.router)
    with TestClient(app) as client:
        response = client.post(path, json=payload)
    assert response.status_code == status, response.text
    assert guidance in response.json()['detail']
    assert private_detail not in response.text
    assert 'unrecognized-private-code' not in response.text
    assert private_detail in caplog.text
