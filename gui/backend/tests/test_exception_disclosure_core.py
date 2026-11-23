"""Production HTTP boundaries keep exception diagnostics in server logs."""

import importlib.util
import json
from pathlib import Path
import sys

import pytest
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from routers import inference_tools, life_data, prediction, predictive
import project_api
from api_catalog import public_routes
from public_validation import PublicValidationError

PRIVATE_DETAIL = '/srv/private/operator-home/internal-error-sentinel'
PRIVATE_CAUSE = 'internal-library-cause-sentinel'


def fail_private(*_args, **_kwargs):
    try:
        raise OSError(PRIVATE_CAUSE)
    except OSError as exc:
        raise ValueError(PRIVATE_DETAIL) from exc


@pytest.fixture(scope='module')
def production_client(tmp_path_factory):
    static = tmp_path_factory.mktemp('error-boundary-static')
    (static / 'assets').mkdir()
    (static / 'index.html').write_text('<html>test</html>')
    spec = importlib.util.spec_from_file_location('perdura_error_disclosure_app', BACKEND / 'main.py')
    module = importlib.util.module_from_spec(spec)
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv('PERDURA_STATIC_DIR', str(static))
        spec.loader.exec_module(module)

    @module.app.post('/api/v1/_test/custom-validator')
    def validator_failure():
        raise RequestValidationError([{
            'type': 'value_error', 'loc': ('body', 'sample'),
            'msg': f'Value error, {PRIVATE_DETAIL}',
            'input': PRIVATE_DETAIL, 'ctx': {'error': ValueError(PRIVATE_DETAIL)},
        }])

    with TestClient(module.app, raise_server_exceptions=False, headers={
        'X-Perdura-Client-API-Contract': '1', 'X-Request-ID': 'exception-disclosure-test',
    }) as client:
        yield client, module


def assert_private_diagnostics_absent(response):
    assert PRIVATE_DETAIL not in response.text
    assert PRIVATE_CAUSE not in response.text
    assert 'Traceback' not in response.text


def test_production_global_value_error_is_safe(production_client, monkeypatch, caplog):
    client, module = production_client
    monkeypatch.setattr(module.inference_tools, 'mtbf_interval', fail_private)
    response = client.post('/api/v1/inference-tools/mtbf-interval', json={
        'failures': 1, 'total_exposure': 100.,
    })
    assert response.status_code == 400
    assert response.json()['error']['code'] == 'invalid_model_input'
    assert_private_diagnostics_absent(response)
    assert PRIVATE_DETAIL in caplog.text and PRIVATE_CAUSE in caplog.text


def test_production_global_value_error_preserves_reviewed_guidance(production_client, monkeypatch):
    client, module = production_client

    def reviewed_validation(*_args, **_kwargs):
        raise PublicValidationError('Select a positive total exposure for this analysis.')

    monkeypatch.setattr(module.inference_tools, 'mtbf_interval', reviewed_validation)
    response = client.post('/api/v1/inference-tools/mtbf-interval', json={
        'failures': 1, 'total_exposure': 100.,
    })
    assert response.status_code == 400
    assert response.json()['error']['message'] == 'Select a positive total exposure for this analysis.'


@pytest.mark.parametrize('stream', [False, True])
def test_production_fit_http_and_stream_errors_are_safe(production_client, monkeypatch, caplog, stream):
    client, module = production_client
    monkeypatch.setattr(module.life_data.Fit_Everything, '__init__', fail_private)
    response = client.post('/api/v1/life-data/fit' + ('/stream' if stream else ''), json={
        'failures': [1., 2., 3., 4.], 'distributions_to_fit': ['Weibull_2P'],
    })
    assert response.status_code == (200 if stream else 500)
    if stream:
        events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        assert events[-1]['type'] == 'error'
        assert events[-1]['status'] == 500
    else:
        assert response.json()['error']['code'] == 'request_error'
    assert_private_diagnostics_absent(response)
    assert PRIVATE_DETAIL in caplog.text and PRIVATE_CAUSE in caplog.text


def test_production_prediction_partial_failure_is_safe(production_client, monkeypatch, caplog):
    client, module = production_client
    monkeypatch.setitem(module.prediction._PART_CLASSES, 'resistor', fail_private)
    response = client.post('/api/v1/prediction/predict', json={
        'parts': [{'name': 'R1', 'category': 'resistor', 'params': {}}],
    })
    assert response.status_code == 200
    assert_private_diagnostics_absent(response)
    assert 'required prediction parameters' in response.text
    assert PRIVATE_DETAIL in caplog.text


def test_production_prediction_choice_guidance_omits_rejected_value(production_client):
    client, _ = production_client
    response = client.post('/api/v1/prediction/mission-profile', json={
        'profile_name': 'Choice validation', 'standard': 'MIL-HDBK-217F',
        'phases': [{'name': 'Operation', 'duration': 100, 'environment': 'GB', 'temperature': 40}],
        'parts': [{'name': 'R1', 'category': 'resistor', 'params': {'style': PRIVATE_DETAIL}}],
    })
    assert response.status_code == 422
    assert 'style must be one of' in response.json()['error']['message']
    assert_private_diagnostics_absent(response)


def test_production_predictive_failure_is_safe(production_client, monkeypatch, caplog):
    client, module = production_client
    monkeypatch.setattr(module.predictive, '_build_matrix', fail_private)
    response = client.post('/api/v1/predictive/fit', json={
        'model': 'decision_tree', 'task': 'regression',
        'data': {'x': [1., 2., 3., 4.], 'y': [2., 4., 6., 8.]},
        'target': 'y', 'features': ['x'],
    })
    assert response.status_code == 400
    assert_private_diagnostics_absent(response)
    assert 'validation settings' in response.json()['error']['message']
    assert PRIVATE_DETAIL in caplog.text


def project_payload(module):
    return {
        'project': {
            'app': 'Perdura', 'subtitle': 'Reliability Engineering and Statistics Suite',
            'website': 'https://perdurareliability.com', 'schemaVersion': module.PROJECT_SCHEMA_VERSION,
            'createdWith': {'version': module.APP_VERSION, 'commit': module.APP_COMMIT, 'builtAt': 'dev'},
            'engineRevisions': {'life-data': 1}, 'project': 'Exception boundary', 'units': 'hours',
            'exported': '2026-11-23T00:00:00Z', 'identity': {'projectId': 'error-boundary-project'},
            'analysisRuns': [], 'exportLedger': [], 'modules': {},
        },
        'analyses': [{
            'id': 'metrics', 'operation_id': 'post_life_data_calculate',
            'input': {'distribution': 'Exponential_1P', 'params': {'Lambda': .2}, 'mission_end': 3.},
        }],
    }


def test_production_project_validation_failure_is_safe(production_client, monkeypatch, caplog):
    client, module = production_client
    endpoint = next(route.endpoint for route in public_routes(module.app)
                    if route.path == '/api/v1/projects/validate')
    monkeypatch.setitem(endpoint.__globals__, '_validate_route_input', fail_private)
    response = client.post('/api/v1/projects/validate', json=project_payload(module))
    assert response.status_code == 200
    assert response.json()['valid'] is False
    assert any(issue['code'] == 'invalid_analysis_input' for issue in response.json()['issues'])
    assert_private_diagnostics_absent(response)
    assert PRIVATE_DETAIL in caplog.text


def test_production_project_recipe_failure_does_not_echo_pydantic_input(production_client, caplog):
    client, module = production_client
    payload = project_payload(module)
    payload['analyses'] = []
    payload['project']['modules'] = {'apiRuns': [{'id': PRIVATE_DETAIL}]}
    response = client.post('/api/v1/projects/validate', json=payload)
    assert response.status_code == 400
    assert response.json()['error']['code'] == 'invalid_project_recipe'
    assert_private_diagnostics_absent(response)
    # Pydantic shortens long input reprs in text logs; the server retains the
    # original structured validation error in the exception record.
    logged = next(record.exc_info[1] for record in caplog.records if record.exc_info)
    assert logged.errors()[0]['input']['id'] == PRIVATE_DETAIL


def test_production_custom_validation_message_does_not_echo_exception(production_client):
    client, _ = production_client
    response = client.post('/api/v1/_test/custom-validator')
    assert response.status_code == 422
    issue = response.json()['error']['issues'][0]
    assert issue['path'] == 'body.sample'
    assert issue['type'] == 'value_error'
    assert_private_diagnostics_absent(response)
