"""Authored schema guidance stays actionable without exposing library errors."""
import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, model_validator

from api_contract import validation_error_response
from public_validation import PublicValidationError
from routers import growth, life_data, system_reliability
from schemas import GrowthRequest


PRIVATE_DETAIL = '/private/operator-home/validator-detail-sentinel'
PRIVATE_CAUSE = 'private-validator-cause-sentinel'


@pytest.fixture
def validation_client():
    app = FastAPI()
    app.add_exception_handler(RequestValidationError, validation_error_response)
    app.include_router(growth.router, prefix='/growth')
    app.include_router(life_data.router, prefix='/life-data')
    app.include_router(system_reliability.router, prefix='/system')

    class UnexpectedValidationRequest(BaseModel):
        value: int

        @model_validator(mode='after')
        def validate_value(self):
            try:
                raise OSError(PRIVATE_CAUSE)
            except OSError as exc:
                raise ValueError(PRIVATE_DETAIL) from exc

    @app.post('/unexpected-validator')
    def unexpected_validator(request: UnexpectedValidationRequest):
        pytest.fail('invalid request reached its endpoint')

    with TestClient(app) as client:
        yield client


def _issue(response):
    assert response.status_code == 422, response.text
    error = response.json()['error']
    assert error['code'] == 'request_validation_error'
    assert error['issues'][0]['type'] == 'value_error'
    assert error['issues'][0]['path'] == 'body'
    return error['issues'][0]


def test_growth_http_retains_authored_missing_termination_time(validation_client):
    response = validation_client.post('/growth/fit', json={
        'times': [1, 2], 'termination': 'time',
    })
    assert _issue(response)['message'] == 'A time-terminated analysis requires T.'


def test_ssi_http_retains_authored_quantity_compatibility(validation_client):
    response = validation_client.post('/life-data/stress-strength', json={
        'stress_distribution': 'Normal_2P', 'stress_params': {'mu': 5, 'sigma': 1},
        'strength_distribution': 'Normal_2P', 'strength_params': {'mu': 10, 'sigma': 1},
        'stress_quantity': {'kind': 'pressure', 'unit': 'Pa'},
        'strength_quantity': {'kind': 'force', 'unit': 'N'},
    })
    assert _issue(response)['message'] == 'Stress and strength must have compatible quantities.'


def test_unexpected_validator_error_and_cause_stay_private(validation_client):
    response = validation_client.post('/unexpected-validator', json={'value': 1})
    assert _issue(response)['message'] == 'Value is invalid for this field or selected model.'
    assert PRIVATE_DETAIL not in response.text
    assert PRIVATE_CAUSE not in response.text
    assert 'Traceback' not in response.text
    assert 'ctx' not in response.text


def test_public_validation_error_keeps_value_error_compatibility():
    error = PublicValidationError('A time-terminated analysis requires T.')
    assert isinstance(error, ValueError)
    assert str(error) == error.public_message == 'A time-terminated analysis requires T.'


def test_authored_template_formats_only_explicit_public_context():
    error = PublicValidationError('Node {node} requires at least {count} samples; limit={limit:g}.',
                                  node='pump-1', count=2, limit=0.95)
    assert error.public_message == 'Node pump-1 requires at least 2 samples; limit=0.95.'


@pytest.mark.parametrize('context', [ValueError(PRIVATE_DETAIL), OSError(PRIVATE_CAUSE), object(), ['pump-1']])
def test_public_template_rejects_exception_and_nonprimitive_context(context):
    with pytest.raises(TypeError, match='primitive strings or numbers'):
        PublicValidationError('Node {node} needs an exposure.', node=context)


def test_public_template_rejects_string_subclasses_with_custom_formatting():
    class PrivateFormat(str):
        def __format__(self, _spec):
            pytest.fail('unreviewed custom formatter must not run')

    with pytest.raises(TypeError, match='primitive strings or numbers'):
        PublicValidationError('Node {node} needs an exposure.', node=PrivateFormat('pump-1'))


def test_rbd_http_retains_reviewed_missing_node_context(validation_client):
    response = validation_client.post('/system/rbd', json={
        'nodes': [{'id': 'left-pump', 'type': 'component', 'data': {
            'distribution': 'weibull', 'dist_params': {'alpha': 100, 'beta': 2},
        }}],
        'edges': [],
    })
    assert _issue(response)['message'] == (
        'distribution life models require a positive system mission_time '
        'or an explicit component mission_time override; missing for left-pump')


def test_schema_and_helper_messages_are_explicitly_public():
    with pytest.raises(ValueError) as failure:
        GrowthRequest(times=[1, 2], termination='time')
    issue = failure.value.errors()[0]
    assert isinstance(issue['ctx']['error'], PublicValidationError)
    assert issue['ctx']['error'].public_message == 'A time-terminated analysis requires T.'
