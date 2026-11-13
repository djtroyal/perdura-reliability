"""Canonical hierarchy/scenario ownership and analytic quantity roll-up oracles."""
from copy import deepcopy
from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(ROOT / 'gui' / 'backend'))
from reliability.SystemDefinition import materialize_prediction_scenario, validate_system_definition
from routers.prediction import predict_system
from system_definition_schemas import SharedSystemPredictionRequest


def fixture():
    def definition(identity, kind):
        return {'id': identity, 'name': identity, 'kind': kind, 'classification': kind}
    def instance(identity, definition_id, parent=None, quantity=1):
        return {'id': identity, 'name': identity, 'definition_id': definition_id,
                'parent_instance_id': parent, 'quantity': quantity}
    model = {'version': 2, 'id': 'project-system', 'name': 'Plant', 'root_instance_id': 'root',
             'definitions': [definition('system', 'system'), definition('assembly', 'assembly'),
                             definition('part', 'piece_part')],
             'instances': [instance('root', 'system'), instance('a', 'assembly', 'root', 2),
                           instance('b', 'assembly', 'a', 5), instance('p0', 'part', 'root'),
                           instance('p1', 'part', 'a', 3), instance('p2', 'part', 'b')]}
    scenario = {'scenarioVersion': 1, 'standard': 'MIL-HDBK-217F', 'environment': 'GB',
                'partInputs': {identity: {'category': 'resistor', 'params': {'style': 'RW', 'quality': 'commercial'},
                    'failure_rate_override_enabled': True, 'failure_rate_override_fpmh': rate}
                    for identity, rate in [('p0', 1), ('p1', 4), ('p2', 6)]}, 'blockInputs': {}}
    return model, scenario


def request(model, scenario):
    return SharedSystemPredictionRequest(model=model, scenario=scenario, source_fingerprint='a' * 64)


def test_canonical_parts_at_all_depths_analytic_rollup_and_stable_identity():
    model, scenario = fixture()
    original = deepcopy((model, scenario))
    result = predict_system(request(model, scenario))
    assert result['total_failure_rate'] == pytest.approx(1 + 2 * (3 * 4 + 5 * 6))
    assert [row['part_id'] for row in result['results']] == ['p0', 'p1', 'p2']
    assert result['source_fingerprint'] == 'a' * 64
    assert len(result['request_sha256']) == 64
    model['instances'].reverse()
    reordered = predict_system(request(model, scenario))
    assert reordered['total_failure_rate'] == result['total_failure_rate']
    assert {row['part_id']: row['failure_rate'] for row in reordered['results']} == {'p0': 1, 'p1': 4, 'p2': 6}
    assert original[1] == scenario


def test_scenario_overrides_are_independent_but_quantities_shared():
    model, scenario = fixture()
    other = deepcopy(scenario)
    other['partInputs']['p1']['failure_rate_override_fpmh'] = 10
    assert predict_system(request(model, other))['total_failure_rate'] == 121
    assert predict_system(request(model, scenario))['total_failure_rate'] == 85
    model['instances'][1]['quantity'] = 3
    assert predict_system(request(model, scenario))['total_failure_rate'] == 127
    assert predict_system(request(model, other))['total_failure_rate'] == 181


def test_profile_requires_explicit_selection_and_resolves_instance_then_scenario():
    model, scenario = fixture()
    profile = {'id': 'mil', 'name': 'MIL', 'domain': 'prediction', 'adapter_id': 'prediction.mil-hdbk-217f',
               'values': {'category': {'kind': 'text', 'value': 'resistor'},
                          'style': {'kind': 'text', 'value': 'RW'},
                          'quality': {'kind': 'text', 'value': 'commercial'},
                          'temperature': {'kind': 'number', 'value': 30, 'unit': '°C'}}}
    model['definitions'][2]['analysis_profiles'] = [profile]
    model['instances'][3]['profile_overrides'] = [{'profile_id': 'mil', 'values': {
        'temperature': {'kind': 'number', 'value': 50, 'unit': '°C'}}}]
    scenario['partInputs']['p0'] = {}
    assert materialize_prediction_scenario(model, scenario)['parts'][0]['calculation_enabled'] is False
    scenario['partInputs']['p0'] = {'profileId': 'mil'}
    resolved = materialize_prediction_scenario(model, scenario)['parts'][0]
    assert resolved['category'] == 'resistor'
    assert resolved['params']['temperature'] == 50
    scenario['partInputs']['p0']['params'] = {'temperature': 70}
    assert materialize_prediction_scenario(model, scenario)['parts'][0]['params']['temperature'] == 70
    scenario['standard'] = 'Telcordia'
    with pytest.raises(ValueError, match='incompatible'):
        materialize_prediction_scenario(model, scenario)


@pytest.mark.parametrize('defect', ['second-root', 'wrong-root', 'root-quantity', 'cycle', 'part-parent', 'missing-item', 'wrong-kind'])
def test_invalid_canonical_structure_or_scenario_is_rejected(defect):
    model, scenario = fixture()
    if defect == 'second-root': model['instances'][1]['parent_instance_id'] = None
    elif defect == 'wrong-root': model['root_instance_id'] = 'a'
    elif defect == 'root-quantity': model['instances'][0]['quantity'] = 2
    elif defect == 'cycle': model['instances'][1]['parent_instance_id'] = 'b'
    elif defect == 'part-parent': model['instances'][1]['parent_instance_id'] = 'p0'
    elif defect == 'missing-item': scenario['partInputs']['deleted'] = {'category': 'resistor'}
    elif defect == 'wrong-kind': scenario['partInputs']['a'] = {'category': 'resistor'}
    with pytest.raises(HTTPException) as exc:
        predict_system(request(model, scenario))
    assert exc.value.status_code == 422


def test_unmapped_and_dnp_parts_are_visible_and_never_silently_counted():
    model, scenario = fixture()
    del scenario['partInputs']['p1']
    model['instances'][5]['source_metadata'] = {'population_status': 'dnp'}
    result = predict_system(request(model, scenario))
    assert result['total_failure_rate'] == 1
    assert result['excluded_part_count'] == 2
    assert {row['part_id'] for row in result['excluded_parts']} == {'p1', 'p2'}
    assert result['warnings']


def test_canonical_metadata_cannot_override_scenario_owned_calculation_inputs():
    model, scenario = fixture()
    model['definitions'][2]['part_metadata'] = {
        'failure_rate_override_fpmh': 999, 'params': {'style': 'invalid'},
        'supplier': 'Approved supplier'}
    model['instances'][4]['source_metadata'] = {'failure_rate_override_fpmh': 999}
    resolved = materialize_prediction_scenario(model, scenario)
    assert resolved['parts'][1]['failure_rate_override_fpmh'] == 4
    assert resolved['parts'][1]['params']['style'] == 'RW'
    assert resolved['parts'][1]['supplier'] == 'Approved supplier'
    assert predict_system(request(model, scenario))['total_failure_rate'] == 85
