"""Matched GUI-default 217F recipes; real handlers feed frontend assurance."""
from copy import deepcopy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'src'), str(ROOT / 'gui/backend')]
from routers.prediction import predict_system
from system_definition_schemas import SharedSystemPredictionRequest


def comparison_fixture():
    model = {'version': 4, 'id': 'comparison-system', 'name': 'Default passive board', 'root_instance_id': 'root',
             'definitions': [{'id': 'board', 'name': 'Board', 'kind': 'system', 'classification': 'system'},
                             {'id': 'r', 'name': 'Resistor', 'kind': 'piece_part', 'classification': 'piece_part'},
                             {'id': 'c', 'name': 'Capacitor', 'kind': 'piece_part', 'classification': 'piece_part'}],
             'instances': [{'id': 'root', 'name': 'Board', 'definition_id': 'board', 'quantity': 1},
                           {'id': 'r1', 'name': 'Resistors', 'definition_id': 'r', 'parent_instance_id': 'root', 'quantity': 10},
                           {'id': 'c1', 'name': 'Capacitors', 'definition_id': 'c', 'parent_instance_id': 'root', 'quantity': 5}]}
    scenario = {'scenarioVersion': 1, 'standard': 'MIL-HDBK-217F', 'environment': 'GB', 'vitaGlobal': False,
                'partInputs': {'r1': {'category': 'resistor', 'params': {'style': 'RL', 'power_stress': .5,
                    'rated_power': .5, 'case_temperature_c': 40, 'quality': 'commercial'}},
                    'c1': {'category': 'capacitor', 'params': {'style': 'CK', 'capacitance_microfarads': .1,
                        'voltage_stress': .5, 'T_ambient': 40, 'circuit_resistance_ohm_per_volt': 1, 'quality': 'commercial'}}},
                'blockInputs': {}}
    second = deepcopy(scenario)
    second['environment'] = 'GM'
    folios = []
    for index, recipe in enumerate((scenario, second)):
        request = SharedSystemPredictionRequest(model=model, scenario=recipe, source_fingerprint='a' * 64)
        # The browser stamps actual canonical JSON fingerprints, as production does.
        recipe['result'] = predict_system(request)
        folios.append({'id': f'comparison-{index}', 'name': f'{recipe["environment"]} default parts', 'dirty': False, 'state': recipe})
    return {'model': request.model.model_dump(), 'folios': folios}


if __name__ == '__main__':
    print(json.dumps(comparison_fixture(), allow_nan=False))
