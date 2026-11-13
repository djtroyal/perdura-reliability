"""Input/action/output semantics and occurrence ownership are server invariants."""
from copy import deepcopy
from pathlib import Path
import sys

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'src'), str(ROOT / 'gui' / 'backend')]
from reliability.FMEA_readiness import architecture_context, architecture_findings, _local_architecture
from reliability.SystemDefinition import (propagate_system_definition, project_system_definition,
    plan_definition_composition, validate_system_definition)
from system_definition_schemas import SystemDefinitionModel, StructuredFunctionDefinition
from schemas import AIAGVDAFMEAAnalysis


def model():
    return SystemDefinitionModel.model_validate({
        'version': 4, 'id': 'system', 'name': 'System', 'root_instance_id': 'unit',
        'resources': [
            {'id': 'power', 'name': 'Power', 'category': 'energy'},
            {'id': 'torque', 'name': 'Torque', 'category': 'physical'},
        ],
        'definitions': [{'id': 'unit', 'name': 'Unit', 'kind': 'system', 'functions': [
            {'id': 'supply', 'description': 'Supply power', 'definition': {'role': 'source', 'action': 'Supply', 'io': [{'id': 'out', 'resource_id': 'power', 'direction': 'output'}]}},
            {'id': 'drive', 'description': 'Produce torque', 'definition': {'role': 'transform', 'action': 'Drive', 'io': [{'id': 'in', 'resource_id': 'power', 'direction': 'input'}, {'id': 'out', 'resource_id': 'torque', 'direction': 'output'}]}},
            {'id': 'secure', 'description': 'Secure attachment', 'definition': {'role': 'maintain_state', 'action': 'Attachment', 'state_verb': 'secure', 'io': []}},
        ], 'failure_modes': [{'id': 'no-power', 'function_id': 'supply', 'description': 'Power unavailable', 'deviation_id': 'absent'}]}],
        'instances': [{'id': 'unit', 'definition_id': 'unit', 'name': 'Unit'}],
    }).model_dump()


def findings(value, complete=True):
    return architecture_findings(value, architecture_context(value, {'scope_instance_id': value['root_instance_id']}), include_completeness=complete)


def codes(value, complete=True):
    return {item['code'] for item in findings(value, complete)}


def test_three_function_kinds_internal_dependency_and_unconsumed_output():
    value = model()
    assert findings(value) == []
    propagation = propagate_system_definition(value)
    assert propagation['valid']
    assert len(propagation['proposals']) == 1
    assert propagation['proposals'][0]['transition']['kind'] == 'resource_dependency'
    assert propagation['proposals'][0]['transition']['target'] == 'unit::drive'
    assert value['interfaces'] == []


@pytest.mark.parametrize('index,io', [
    (0, []),
    (0, [{'id': 'input', 'resource_id': 'torque', 'direction': 'input'}, {'id': 'out', 'resource_id': 'power', 'direction': 'output'}]),
    (1, [{'id': 'out', 'resource_id': 'torque', 'direction': 'output'}]),
    (1, [{'id': 'in', 'resource_id': 'power', 'direction': 'input'}, {'id': 'out', 'resource_id': 'torque', 'direction': 'output'}, {'id': 'extra', 'resource_id': '', 'direction': 'output'}]),
    (2, [{'id': 'out', 'resource_id': '', 'direction': 'output'}]),
])
def test_incomplete_cardinality_is_serializable_but_not_executable(index, io):
    value = model(); value['definitions'][0]['functions'][index]['definition']['io'] = io
    SystemDefinitionModel.model_validate(value)
    assert 'missing_function_io' in codes(value)
    assert 'missing_function_io' not in codes(value, complete=False)


def test_action_is_authored_and_controlled_verbs_cannot_reenter_contract():
    value = model(); definition = value['definitions'][0]['functions'][1]['definition']
    definition['action'] = 'Perform the engineer-defined nonlinear conversion'
    assert not findings(value)
    definition['action'] = ' '
    assert 'missing_function_action' in codes(value)
    with pytest.raises(ValidationError):
        StructuredFunctionDefinition.model_validate({**definition, 'verb_id': 'function_verb:convert'})
    with pytest.raises(ValidationError):
        StructuredFunctionDefinition.model_validate({'role': 'maintain_state', 'action': 'Secure', 'io': [{'id': 'state', 'resource_id': 'power', 'direction': 'state'}]})


def test_output_identity_is_unique_but_resource_names_need_not_be():
    value = model()
    duplicate = deepcopy(value['definitions'][0]['functions'][0]); duplicate['id'] = 'second-supply'
    value['definitions'][0]['functions'].append(duplicate)
    assert 'duplicate_resource_owner' in codes(value, complete=False)
    value['resources'].append({'id': 'power-2', 'name': 'Power', 'category': 'energy'})
    value['instances'][0]['function_overrides'] = [{'function_id': 'second-supply', 'resource_bindings': {'out': 'power-2'}}]
    assert not findings(value)


def test_own_output_input_is_rejected_but_feedback_between_distinct_functions_is_valid():
    value = model(); supply = value['definitions'][0]['functions'][0]['definition']
    supply['role'] = 'transform'; supply['io'].append({'id': 'in', 'resource_id': 'power', 'direction': 'input'})
    assert 'self_resource_input' in codes(value, complete=False)
    supply['io'][-1]['resource_id'] = 'torque'
    assert not findings(value)
    assert any(path['termination'] == 'cycle_collapsed' for path in propagate_system_definition(value)['paths'])


def test_occurrence_bindings_preserve_inherited_action_and_original_identity():
    value = model(); before = deepcopy(value['definitions'][0])
    value['instances'][0]['function_overrides'] = [{'function_id': 'supply', 'resource_bindings': {'out': 'power'}}]
    value['definitions'][0]['functions'][0]['definition']['action'] = 'Generate revised power'
    context = architecture_context(value, {'scope_instance_id': 'unit'})
    assert context['functions']['unit::supply']['definition']['action'] == 'Generate revised power'
    assert context['functions']['unit::supply']['definition']['io'][0]['resource_id'] == 'power'
    projected = project_system_definition(value, 'fmea')
    assert projected['projection']['functions'][0]['definition']['action'] == 'Generate revised power'
    assert before['functions'][0]['definition']['action'] == 'Supply'
    value['instances'][0]['function_overrides'][0]['resource_bindings']['missing-io'] = 'power'
    assert 'invalid_resource_binding' in codes(value, complete=False)


def test_external_source_owns_resource_and_survives_process_projection():
    value = model(); value['definitions'][0]['functions'].pop(0); value['definitions'][0]['failure_modes'] = []
    value['externals'] = [{'id': 'grid', 'name': 'Grid', 'ports': [{'id': 'out', 'name': 'Power', 'direction': 'output', 'interface_type': 'energy', 'resource_id': 'power'}]}]
    value['interfaces'] = [{'id': 'feed', 'name': 'Power', 'interface_type': 'energy', 'generated': True, 'source': {'external_id': 'grid'}, 'target': {'instance_id': 'unit'}, 'transfers': [{'id': 'flow', 'kind': 'flow', 'resource_id': 'power', 'source': {'kind': 'external', 'external_id': 'grid', 'port_id': 'out'}, 'target': {'kind': 'function', 'instance_id': 'unit', 'function_id': 'drive', 'io_id': 'in'}}]}]
    assert not findings(value)
    analysis = AIAGVDAFMEAAnalysis.model_validate({'id': 'process', 'name': 'Process', 'kind': 'pfmea', 'resources': value['resources'], 'structure_nodes': [{'id': 'unit', 'name': 'Unit', 'level': 'process_step'}], 'functions': [{'id': f['id'], 'description': f['description'], 'structure_node_id': 'unit', 'definition': f['definition']} for f in value['definitions'][0]['functions']], 'block_diagram': {'nodes': [{'id': 'grid', 'kind': 'external', 'label': 'Grid', 'ports': value['externals'][0]['ports']}]}, 'interfaces': [{'id': 'feed', 'interface_type': 'energy', 'generated': True, 'source_block_id': 'grid', 'target_structure_node_id': 'unit', 'transfers': value['interfaces'][0]['transfers']}]}).model_dump()
    local = _local_architecture(analysis)
    assert local['externals'][0]['ports'][0]['resource_id'] == 'power'
    assert local['interfaces'][0]['generated'] is True
    assert not findings(local)
    value['externals'][0]['ports'][0].pop('resource_id')
    assert {'missing_resource_owner', 'invalid_resource_owner'} <= codes(value)


def test_physical_flow_is_allowed_and_attachment_has_no_implicit_propagation():
    value = model()
    # Move the consumer to a child occurrence and carry physical torque into it.
    consumer = {'id': 'load', 'description': 'Carry load', 'definition': {'role': 'transform', 'action': 'Carry', 'io': [{'id': 'in', 'resource_id': 'torque', 'direction': 'input'}, {'id': 'out', 'resource_id': 'motion', 'direction': 'output'}]}}
    value['resources'].append({'id': 'motion', 'name': 'Motion', 'category': 'physical'})
    value['definitions'].append({'id': 'load', 'name': 'Load', 'functions': [consumer]})
    value['instances'].append({'id': 'load', 'name': 'Load', 'definition_id': 'load', 'parent_instance_id': 'unit'})
    value['function_links'] = [{'id': 'support', 'source': {'instance_id': 'unit', 'function_id': 'drive'}, 'target': {'instance_id': 'load', 'function_id': 'load'}, 'relationship': 'decomposes_to'}]
    value['interfaces'] = [{'id': 'shaft', 'name': 'Shaft', 'interface_type': 'physical', 'source': {'instance_id': 'unit'}, 'target': {'instance_id': 'load'}, 'transfers': [{'id': 'torque-flow', 'kind': 'flow', 'resource_id': 'torque', 'source': {'kind': 'function', 'instance_id': 'unit', 'function_id': 'drive', 'io_id': 'out'}, 'target': {'kind': 'function', 'instance_id': 'load', 'function_id': 'load', 'io_id': 'in'}}]}]
    assert not findings(value)
    value['definitions'][1]['functions'][0]['definition'] = {'role': 'maintain_state', 'action': 'Shaft attachment', 'io': []}
    value['interfaces'][0]['transfers'] = [{'id': 'attachment', 'kind': 'relation', 'source': {'kind': 'block', 'instance_id': 'unit', 'function_id': 'secure'}, 'target': {'kind': 'block', 'instance_id': 'load', 'function_id': 'load'}}]
    SystemDefinitionModel.model_validate(value)
    assert not findings(value)
    assert not any(p['transition']['target'] == 'load::load' for p in propagate_system_definition(value)['proposals'])
    value['definitions'][0]['failure_modes'] = [{'id': 'loose', 'function_id': 'secure', 'description': 'Attachment lost', 'deviation_id': 'absent'}]
    value['propagation_rules'] = [{'id': 'known-effect', 'interface_id': 'shaft', 'source': {'instance_id': 'unit', 'function_id': 'secure'}, 'target': {'instance_id': 'load', 'function_id': 'load'}, 'action': 'pass_through'}]
    assert any(p['transition']['target'] == 'load::load' for p in propagate_system_definition(value)['proposals'])


def test_composition_proposal_creates_fresh_output_bindings_and_remaps_internal_inputs():
    value = model()
    value['definitions'].append({'id': 'parent', 'name': 'Parent', 'kind': 'system', 'child_slots': [{'id': 'unit-slot', 'definition_id': 'unit', 'name': 'Unit', 'quantity': 1}]})
    value['instances'].append({'id': 'parent', 'name': 'Parent', 'definition_id': 'parent', 'quantity': 1})
    value['instances'][0]['parent_instance_id'] = 'parent'; value['root_instance_id'] = 'parent'
    before = deepcopy(value)
    result = plan_definition_composition(value, 'parent')
    proposal = result['proposals'][0]
    assert proposal['action'] == 'add'
    assert len(proposal['resources']) == 2
    bindings = {item['function_id']: item['resource_bindings'] for item in proposal['instance']['function_overrides']}
    assert bindings['drive']['in'] == bindings['supply']['out'] != 'power'
    assert bindings['drive']['out'] != 'torque'
    value['resources'].extend(proposal['resources']); value['instances'].append(proposal['instance'])
    assert validate_system_definition(value)['valid']
    assert plan_definition_composition(before, 'parent') == result


def test_disabled_occurrence_functions_do_not_claim_outputs():
    value = model()
    value['instances'].append({'id': 'spare', 'name': 'Spare', 'definition_id': 'unit', 'parent_instance_id': 'unit', 'function_overrides': [{'function_id': ident, 'enabled': False} for ident in ('supply', 'drive', 'secure')]})
    assert validate_system_definition(value)['valid']
    value['instances'][1]['function_overrides'][0]['enabled'] = True
    assert 'duplicate_resource_owner' in codes(value, complete=False)


def test_duplicate_external_resource_owners_are_invalid_even_before_connection():
    value = model()
    value['resources'].append({'id': 'grid-power', 'name': 'Grid power', 'category': 'energy'})
    value['externals'] = [{'id': ident, 'name': ident, 'ports': [{'id': 'out', 'name': 'Power', 'interface_type': 'energy', 'direction': 'output', 'resource_id': 'grid-power'}]} for ident in ('grid-a', 'grid-b')]
    assert 'duplicate_resource_owner' in codes(value, complete=False)
    value['externals'][1]['ports'][0]['resource_id'] = 'missing'
    assert 'missing_resource' in codes(value, complete=False)


def test_resource_propagation_assertions_reference_existing_derived_transition():
    value = model()
    result = propagate_system_definition(value)
    proposal = result['proposals'][0]
    value['propagation_assertions'] = [{'id': 'accepted-flow', 'source_failure_mode_id': 'unit::no-power', 'source_node_id': 'unit::supply::absent', 'target_node_id': 'unit::drive::absent', 'transition_id': proposal['transition']['id'], 'result_deviation_id': 'absent', 'status': 'accepted'}]
    assert validate_system_definition(value)['valid']
    value['definitions'][0]['functions'][1]['definition']['io'][0]['resource_id'] = ''
    assert any(finding['code'] == 'missing_assertion_transition' for finding in validate_system_definition(value)['issues'])


def test_process_interface_modes_survive_schema_and_architecture_roundtrip():
    value = model()
    analysis = AIAGVDAFMEAAnalysis.model_validate({'id': 'process', 'name': 'Process', 'kind': 'pfmea', 'resources': value['resources'], 'structure_nodes': [{'id': 'unit', 'name': 'Unit', 'level': 'process_step'}], 'functions': [{'id': f['id'], 'description': f['description'], 'structure_node_id': 'unit', 'definition': f['definition'], 'operating_modes': ['run']} for f in value['definitions'][0]['functions']], 'interfaces': [{'id': 'relation', 'interface_type': 'physical', 'source_structure_node_id': 'unit', 'external_target': 'Mount', 'mode_ids': ['run'], 'transfers': []}]}).model_dump()
    local = _local_architecture(analysis)
    assert local['interfaces'][0]['mode_ids'] == ['run']
    assert local['modes'] == [{'id': 'run'}]


def test_generated_dependencies_do_not_duplicate_cross_block_resource_propagation():
    value = model()
    consumer = value['definitions'][0]['functions'].pop(1)
    value['definitions'].append({'id': 'drive', 'name': 'Drive', 'functions': [consumer]})
    value['instances'].append({'id': 'drive', 'name': 'Drive', 'definition_id': 'drive', 'parent_instance_id': 'unit'})
    value['function_links'] = [
        {'id': 'allocated', 'relationship': 'decomposes_to', 'source': {'instance_id': 'unit', 'function_id': 'supply'}, 'target': {'instance_id': 'drive', 'function_id': 'drive'}},
        {'id': 'generated-dependency', 'generated': True, 'relationship': 'provides_input', 'source': {'instance_id': 'unit', 'function_id': 'supply'}, 'target': {'instance_id': 'drive', 'function_id': 'drive'}},
    ]
    value['interfaces'] = [{'id': 'feed', 'name': 'Power', 'interface_type': 'energy', 'source': {'instance_id': 'unit'}, 'target': {'instance_id': 'drive'}, 'transfers': [{'id': 'power-flow', 'kind': 'flow', 'resource_id': 'power', 'source': {'kind': 'function', 'instance_id': 'unit', 'function_id': 'supply', 'io_id': 'out'}, 'target': {'kind': 'function', 'instance_id': 'drive', 'function_id': 'drive', 'io_id': 'in'}}]}]
    assert not findings(value)
    result = propagate_system_definition(value)
    assert len(result['proposals']) == 1
    assert result['proposals'][0]['transition']['kind'] == 'interface'
    value['interfaces'] = []
    assert not propagate_system_definition(value)['proposals']


def test_generated_same_block_link_is_a_single_causal_transition():
    value = model()
    value['function_links'] = [{'id': 'generated-dependency', 'generated': True, 'relationship': 'provides_input', 'source': {'instance_id': 'unit', 'function_id': 'supply'}, 'target': {'instance_id': 'unit', 'function_id': 'drive'}}]
    result = propagate_system_definition(value)
    assert len(result['proposals']) == 1
    assert result['proposals'][0]['transition']['id'] == 'generated-dependency'
    value['definitions'][0]['functions'][1]['definition']['io'][0]['resource_id'] = ''
    assert not propagate_system_definition(value)['proposals']


def test_occurrence_only_functions_and_failures_stay_disabled_on_future_installations():
    value = model()
    for function in value['definitions'][0]['functions'][:2]:
        function['default_enabled'] = False
    value['definitions'][0]['failure_modes'][0]['default_enabled'] = False
    value['instances'][0]['function_overrides'] = [{'function_id': name, 'enabled': True} for name in ('supply', 'drive')]
    value['instances'][0]['failure_mode_overrides'] = [{'failure_mode_id': 'no-power', 'enabled': True}]
    value['resources'].append({'id': 'unused-spare-output', 'name': 'Power', 'category': 'energy'})
    value['instances'].append({'id': 'spare', 'name': 'Spare', 'definition_id': 'unit', 'parent_instance_id': 'unit', 'function_overrides': [{'function_id': 'supply', 'resource_bindings': {'out': 'unused-spare-output'}}]})
    parsed = SystemDefinitionModel.model_validate(value).model_dump()
    assert validate_system_definition(parsed)['valid']
    functions = architecture_context(parsed, {'scope_instance_id': 'unit'})['functions']
    assert 'unit::supply' in functions and 'unit::drive' in functions
    assert 'spare::supply' not in functions and 'spare::drive' not in functions
    projected = project_system_definition(parsed, 'fmea')['projection']
    assert len(projected['failure_modes']) == 1
    assert projected['failure_modes'][0]['system_ref']['instance_id'] == 'unit'
    assert propagate_system_definition(parsed)['coverage']['source_failure_modes'] == 1


def test_recreating_moved_composition_slot_does_not_reuse_occurrence_resources():
    value = model()
    value['definitions'].append({'id': 'parent', 'name': 'Parent', 'kind': 'system', 'child_slots': [{'id': 'unit-slot', 'definition_id': 'unit', 'name': 'Unit', 'quantity': 1}]})
    value['instances'].append({'id': 'parent', 'name': 'Parent', 'definition_id': 'parent', 'quantity': 1})
    value['instances'][0]['parent_instance_id'] = 'parent'; value['root_instance_id'] = 'parent'
    first = plan_definition_composition(value, 'parent')['proposals'][0]
    value['resources'].extend(first['resources'])
    moved = deepcopy(first['instance']); moved['parent_instance_id'] = 'unit'
    value['instances'].append(moved)
    second = plan_definition_composition(value, 'parent')['proposals'][0]
    assert second['instance']['id'] != moved['id']
    assert not ({item['id'] for item in first['resources']} & {item['id'] for item in second['resources']})
    assert second == plan_definition_composition(value, 'parent')['proposals'][0]
    value['instances'].append(second['instance']); value['resources'].extend(second['resources'])
    assert validate_system_definition(value)['valid']
