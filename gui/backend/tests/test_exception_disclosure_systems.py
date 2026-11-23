"""System analysis errors keep diagnostics on the server, including typed errors."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import fault_tree, system_reliability
from reliability.FaultTree import ExactEvaluationLimitError
from reliability.FaultTreeAdvanced import BDDStateLimitError
from reliability.FaultTreeOpenPSA import OpenPSAError


PRIVATE_DETAIL = '/private/operator-home/system-solver-private-sentinel'


@pytest.fixture
def system_client():
    app = FastAPI()
    app.include_router(fault_tree.router, prefix='/fault-tree')
    app.include_router(system_reliability.router, prefix='/system')
    with TestClient(app) as client:
        yield client


def _fail_with(error_type):
    def fail(*_args, **_kwargs):
        raise error_type(PRIVATE_DETAIL)
    return fail


@pytest.mark.parametrize('error_type,status,code', [
    (ValueError, 400, None), (RuntimeError, 500, None),
    (ExactEvaluationLimitError, 422, 'RBD_EXACT_LIMIT'),
])
def test_rbd_http_errors_hide_solver_details(system_client, monkeypatch, caplog, error_type, status, code):
    monkeypatch.setattr(system_reliability, 'exact_directed_rbd_reliability', _fail_with(error_type))
    response = system_client.post('/system/rbd', json={
        'nodes': [
            {'id': 'source', 'type': 'source'},
            {'id': 'component', 'type': 'component', 'data': {'reliability': .9}},
            {'id': 'sink', 'type': 'sink'},
        ],
        'edges': [{'source': 'source', 'target': 'component'}, {'source': 'component', 'target': 'sink'}],
    })
    assert response.status_code == status, response.text
    assert PRIVATE_DETAIL not in response.text
    assert PRIVATE_DETAIL in caplog.text
    if code:
        assert response.json()['detail']['code'] == code


@pytest.mark.parametrize('helper,error_type,code', [
    ('_event_sources', ValueError, 'FAULT_TREE_INPUT'),
    ('evaluate_static', ValueError, 'FAULT_TREE_DEPENDENCY'),
    ('evaluate_static', BDDStateLimitError, 'FAULT_TREE_EXACT_LIMIT'),
])
def test_fault_tree_http_errors_hide_solver_details(system_client, monkeypatch, caplog, helper, error_type, code):
    monkeypatch.setattr(fault_tree, helper, _fail_with(error_type))
    response = system_client.post('/fault-tree/analyze', json={
        'nodes': [
            {'id': 'top', 'type': 'or', 'data': {'label': 'Top'}},
            {'id': 'event', 'type': 'basic', 'data': {'probability': .1}},
        ],
        'edges': [{'source': 'top', 'target': 'event'}],
    })
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == code
    assert PRIVATE_DETAIL not in response.text
    assert PRIVATE_DETAIL in caplog.text


@pytest.mark.parametrize('operation,payload', [
    ('import', {'xml': '<opsa-mef />'}),
    ('export', {'nodes': [], 'edges': []}),
])
def test_openpsa_typed_errors_do_not_make_exception_text_public(
        system_client, monkeypatch, caplog, operation, payload):
    monkeypatch.setattr(fault_tree, f'{operation}_openpsa', _fail_with(OpenPSAError))
    response = system_client.post(f'/fault-tree/openpsa/{operation}', json=payload)
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'OPENPSA_INVALID'
    assert 'OpenPSA' in response.json()['detail']['message']
    assert PRIVATE_DETAIL not in response.text
    assert PRIVATE_DETAIL in caplog.text
