"""Canonical prerequisites cannot be bypassed by diagrams, snapshots, or APIs."""
from copy import deepcopy
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(ROOT / 'gui' / 'backend'))
from reliability.FMEA_readiness import evaluate_fmea_readiness, require_fmea_readiness, architecture_context
from reliability.FMEA import analyze_studies, transition_lifecycle
from reliability.SystemDefinition import propagate_system_definition, validate_system_definition
from reliability.Reliability_program import analyze_reliability_program
from routers.fmea import analyze, readiness
from schemas import FMEAAnalyzeRequest, FMEAReadinessRequest, FMEAStudy
from system_definition_schemas import SystemDefinitionModel


def aircraft():
    model = {'version': 4, 'id': 'aircraft', 'name': 'Aircraft', 'root_instance_id': 'aircraft',
             'modes': [{'id': 'run', 'name': 'Run'}],
             'resources': [{'id': 'power', 'name': 'DC power', 'category': 'energy'}, {'id': 'state', 'name': 'Operational state', 'category': 'state'}, {'id': 'torque', 'name': 'Motor torque', 'category': 'physical'}],
             'definitions': [], 'instances': [], 'interfaces': [], 'function_links': []}
    for ident, name, parent, role, direction, resource in [
        ('aircraft', 'Aircraft', None, 'maintain_state', 'state', 'state'),
        ('propulsion', 'Propulsion', 'aircraft', 'maintain_state', 'state', 'state'),
        ('esps', 'ESPS', 'aircraft', 'source', 'output', 'power'),
        ('motor', 'Motor Controller', 'propulsion', 'transform', 'input', 'power'),
    ]:
        definition = {'role': role, 'action': name + ' function', 'io': [] if role == 'maintain_state' else [{'id': 'io', 'resource_id': resource, 'direction': direction}]}
        if role == 'transform':
            definition['io'].append({'id': 'out', 'resource_id': 'torque', 'direction': 'output'})
        model['definitions'].append({'id': ident, 'name': name, 'kind': 'system' if parent is None else 'subsystem', 'ports': [{'id': 'p', 'name': 'Power', 'interface_type': 'energy', 'direction': direction if direction != 'state' else 'bidirectional'}], 'functions': [{'id': 'fn', 'description': name + ' function', 'mode_ids': ['run'], 'definition': definition}], 'failure_modes': []})
        model['instances'].append({'id': ident, 'definition_id': ident, 'name': name, 'parent_instance_id': parent})
        if parent:
            model['function_links'].append({'id': 'support-' + ident, 'source': {'instance_id': parent, 'function_id': 'fn'}, 'target': {'instance_id': ident, 'function_id': 'fn'}, 'relationship': 'decomposes_to', 'mode_ids': ['run']})
    model['interfaces'] = [{'id': 'power-if', 'name': 'DC power', 'interface_type': 'energy', 'directionality': 'directed', 'source': {'instance_id': 'esps', 'port_id': 'p'}, 'target': {'instance_id': 'motor', 'port_id': 'p'}, 'mode_ids': ['run'], 'transfers': [{'id': 'power-transfer', 'resource_id': 'power', 'kind': 'flow', 'source': {'kind': 'function', 'instance_id': 'esps', 'function_id': 'fn', 'io_id': 'io'}, 'target': {'kind': 'function', 'instance_id': 'motor', 'function_id': 'fn', 'io_id': 'io'}, 'mode_ids': ['run']}]}]
    return SystemDefinitionModel.model_validate(model).model_dump()


def study_for(model, scope='aircraft', mode=None):
    binding = {'version': 1, 'system_model_id': model['id'], 'scope_instance_id': scope}
    if mode:
        binding['mode_id'] = mode
    context = architecture_context(model, binding)
    analysis = {'id': 'study', 'name': 'Aircraft DFMEA', 'kind': 'dfmea', 'system_binding': binding,
                'planning': {'subject': 'Aircraft', 'scope': 'Architecture boundary', 'intent': 'Identify failures', 'team': ['Engineering']},
                'resources': model['resources'], 'structure_nodes': [], 'functions': [], 'interfaces': [], 'failure_chains': []}
    def ref(ident=None, **kw):
        return {'system_model_id': model['id'], **({'instance_id': ident, 'definition_id': ident} if ident else {}), **kw}
    for ident in sorted(context['context_instances']):
        instance = context['instances'][ident]
        analysis['structure_nodes'].append({'id': 'node-' + ident, 'name': instance['name'], 'level': 'system', 'parent_id': 'node-' + instance['parent_instance_id'] if instance.get('parent_instance_id') in context['context_instances'] else None, 'system_definition_ref': ref(ident)})
    for key, fn in context['functions'].items():
        if key not in context['required']:
            continue
        fid = 'fn-' + fn['instance_id']
        analysis['functions'].append({'id': fid, 'structure_node_id': 'node-' + fn['instance_id'], 'description': fn['description'], 'definition': fn['definition'], 'operating_modes': fn.get('mode_ids', []), 'system_definition_ref': ref(fn['instance_id'], function_id=fn['id'])})
        if fn['instance_id'] in context['scope']:
            analysis['failure_chains'].append({'id': 'chain-' + fid, 'function_id': fid, 'cause_structure_node_id': 'node-' + fn['instance_id'], 'effect_function_id': fid, 'failure_mode': 'No intended function', 'cause': 'Element fails', 'effect': 'Required state unavailable', 'severity': 3, 'occurrence': 2, 'detection': 2, 'severity_rationale': 'Loss of this local function has limited system impact.', 'occurrence_rationale': 'Established design and operating history support infrequent occurrence.', 'detection_rationale': 'Independent verification detects this failure before operation.'})
    for edge in context['interfaces']:
        analysis['interfaces'].append({**{field: edge[field] for field in ('id', 'name', 'interface_type', 'directionality', 'flow_description', 'transfers', 'mode_ids')}, 'source_structure_node_id': 'node-' + edge['source']['instance_id'], 'target_structure_node_id': 'node-' + edge['target']['instance_id'], 'system_definition_ref': ref(interface_id=edge['id'])})
    return FMEAStudy.model_validate({'schema_version': 4, 'id': 'study', 'method_profile_id': 'aiag_vda_2019_public', 'model': analysis}).model_dump()


def codes(result):
    return {finding['code'] for finding in result['findings'] if finding['severity'] == 'error'}


def test_complete_cross_level_model_and_cumulative_readiness():
    model = aircraft(); study = study_for(model)
    before = deepcopy((model, study))
    result = evaluate_fmea_readiness(study, model)
    assert result['can_analyze'], result['findings']
    assert all(stage['eligible'] for stage in result['stages'])
    assert (model, study) == before
    assert readiness(FMEAReadinessRequest(study=study, canonical_system=model))['can_analyze']
    assert analyze(FMEAAnalyzeRequest(studies=[study], canonical_system=model))['studies'][0]['study_id'] == 'study'


def test_missing_context_and_direct_api_bypass_fail_with_actionable_findings():
    model = aircraft(); study = study_for(model)
    assert 'missing_canonical_system' in codes(evaluate_fmea_readiness(study))
    with pytest.raises(HTTPException) as exc:
        analyze(FMEAAnalyzeRequest(studies=[study]))
    assert exc.value.status_code == 409
    assert 'missing_canonical_system' in codes(exc.value.detail)
    with pytest.raises(ValueError, match='canonical'):
        analyze_reliability_program(fmea_analyses=[study['model']])


def test_draft_is_serializable_but_cannot_skip_function_stage():
    model = aircraft(); model['definitions'][3]['functions'][0]['definition'] = None
    model['definitions'][3]['functions'][0]['description'] = ''
    model = SystemDefinitionModel.model_validate(model).model_dump()
    study = study_for(model)
    result = evaluate_fmea_readiness(study, model)
    assert 'missing_function_definition' in codes(result)
    assert result['stages'][2]['eligible']
    assert not result['stages'][3]['eligible']
    assert result['stages'][3]['findings'] == []
    with pytest.raises(ValueError):
        require_fmea_readiness(study, model)


def test_scope_ignores_unrelated_sibling_functions_but_validates_boundary_and_ancestors():
    model = aircraft()
    model['definitions'][2]['functions'].append({'id': 'unrelated', 'description': 'Draft unrelated function', 'mode_ids': [], 'definition': None})
    result = evaluate_fmea_readiness(study_for(model, 'motor'), model)
    assert result['can_analyze'], result['findings']
    model['function_links'] = [link for link in model['function_links'] if link['id'] != 'support-propulsion']
    assert 'missing_parent_support' in codes(evaluate_fmea_readiness(study_for(model, 'motor'), model))


def test_modes_reparenting_and_disabled_parent_support_invalidate():
    model = aircraft(); model['modes'].append({'id': 'maintenance', 'name': 'Maintenance'})
    model['definitions'][3]['functions'][0]['mode_ids'] = []
    result = evaluate_fmea_readiness(study_for(model, 'motor'), model)
    assert 'incomplete_parent_mode_coverage' in codes(result)
    model = aircraft(); model['instances'][3]['parent_instance_id'] = 'esps'
    assert 'invalid_parent_support' in codes(evaluate_fmea_readiness(study_for(model), model))
    model = aircraft(); model['instances'][1]['function_overrides'] = [{'function_id': 'fn', 'enabled': False}]
    assert 'invalid_parent_support' in codes(evaluate_fmea_readiness(study_for(model), model))


def test_transfer_requires_exact_resource_direction_and_endpoint_pairing():
    model = aircraft(); transfer = model['interfaces'][0]['transfers'][0]
    transfer['target']['instance_id'] = 'propulsion'
    result = evaluate_fmea_readiness(study_for(model), model)
    assert {'invalid_transfer_endpoint', 'unpaired_function_io'} <= codes(result)
    model = aircraft(); model['interfaces'][0]['transfers'] = []
    assert {'incomplete_interface_transfer', 'unpaired_function_io'} <= codes(evaluate_fmea_readiness(study_for(model), model))


def test_layout_does_not_change_fingerprint_but_resources_do():
    model = aircraft(); study = study_for(model)
    first = evaluate_fmea_readiness(study, model)['semantic_fingerprint']
    model['diagrams'] = [{'id': 'view', 'name': 'Diagram', 'hidden_instance_ids': ['motor'], 'nodes': []}]
    study['model']['block_diagram']['viewport']['zoom'] = 2
    assert evaluate_fmea_readiness(study, model)['semantic_fingerprint'] == first
    model['resources'][0]['name'] = '28 V DC power'
    assert evaluate_fmea_readiness(study, model)['semantic_fingerprint'] != first


def test_edited_or_missing_snapshots_cannot_replace_canonical_model():
    model = aircraft(); study = study_for(model)
    study['model']['functions'][0]['description'] = 'Changed copied statement'
    assert 'canonical_snapshot_mismatch' in codes(evaluate_fmea_readiness(study, model))
    study = study_for(model); study['model']['interfaces'] = []
    assert 'canonical_snapshot_mismatch' in codes(evaluate_fmea_readiness(study, model))


def test_prediction_only_parts_exempt_until_included_or_connected():
    model = aircraft()
    model['definitions'].append({'id': 'resistor', 'name': 'Resistor', 'kind': 'piece_part', 'functions': []})
    model['instances'].append({'id': 'r1', 'definition_id': 'resistor', 'parent_instance_id': 'motor'})
    assert evaluate_fmea_readiness(study_for(model), model)['can_analyze']
    study = study_for(model); study['model']['system_binding']['included_piece_part_ids'] = ['r1']
    assert 'missing_function_coverage' in codes(evaluate_fmea_readiness(study, model))


def test_no_decomposition_or_cartesian_causal_propagation():
    model = aircraft()
    model['definitions'][2]['failure_modes'] = [{'id': 'fail', 'function_id': 'fn', 'description': 'No power', 'deviation_id': 'absent', 'mode_ids': ['run']}]
    model['interfaces'][0]['source_function_ids'] = ['fn']
    model['interfaces'][0]['target_function_ids'] = ['fn']
    result = propagate_system_definition(model)
    assert result['valid'], result['issues']
    transitions = [proposal['transition'] for proposal in result['proposals']]
    assert all(t['kind'] == 'interface' for t in transitions)
    assert len(transitions) == 1
    model['interfaces'][0]['transfers'] = []
    assert not propagate_system_definition(model)['proposals']


def test_old_and_missing_schema_contracts_are_rejected():
    model = aircraft(); study = study_for(model)
    for version in (1, 2, 3):
        with pytest.raises(ValidationError):
            SystemDefinitionModel.model_validate({**model, 'version': version})
        with pytest.raises(ValidationError):
            FMEAStudy.model_validate({**study, 'schema_version': version})
    model.pop('version'); study.pop('schema_version')
    with pytest.raises(ValidationError): SystemDefinitionModel.model_validate(model)
    with pytest.raises(ValidationError): FMEAStudy.model_validate(study)


def test_approval_checks_prerequisites_even_with_attestation():
    model = aircraft(); study = study_for(model)
    study['lifecycle_status'] = 'in_review'
    study['method_profile_id'] = 'iec_60812_2018'
    with pytest.raises(ValueError, match='not enabled'):
        transition_lifecycle(study, canonical_system=model, target_status='approved', actor='Reviewer', rationale='Reviewed', attestations=[{'role': 'approver', 'decision': 'approved'}])


def test_shared_aircraft_fixture_matches_frontend_completeness_contract():
    import json
    from reliability.FMEA_readiness import architecture_findings
    fixture = json.loads((ROOT / 'gui/frontend/tests/fixtures/aircraftArchitecture.json').read_text())
    assert architecture_findings(fixture, architecture_context(fixture, {'scope_instance_id': fixture['root_instance_id']})) == []



def test_bidirectional_and_symmetric_relations_require_explicit_compatible_transfers():
    model = aircraft(); model['interfaces'][0]['directionality'] = 'bidirectional'
    assert 'incompatible_transfer_direction' in codes(evaluate_fmea_readiness(study_for(model), model))
    model = aircraft(); model['interfaces'][0]['transfers'][0]['kind'] = 'relation'
    with pytest.raises(ValidationError):
        SystemDefinitionModel.model_validate(model)
    model = aircraft(); model['modes'].append({'id': 'maintenance', 'name': 'Maintenance'})
    model['interfaces'][0]['mode_ids'] = []
    assert 'incomplete_transfer_mode_coverage' in codes(evaluate_fmea_readiness(study_for(model), model))


def test_reparent_and_disable_are_saved_drafts_without_discarding_allocations():
    model = aircraft(); model['instances'][3]['parent_instance_id'] = 'esps'
    assert validate_system_definition(model)['valid']
    assert 'invalid_parent_support' in codes(evaluate_fmea_readiness(study_for(model), model))
    model = aircraft(); model['instances'][3]['function_overrides'] = [{'function_id': 'fn', 'enabled': False}]
    assert validate_system_definition(model)['valid']
    assert not evaluate_fmea_readiness(study_for(model), model)['can_analyze']
    assert model['interfaces'][0]['transfers'][0]['target']['function_id'] == 'fn'


def test_process_model_is_independent_and_equipment_links_are_context_only():
    analysis = {'id': 'process', 'name': 'Assembly process', 'kind': 'pfmea',
                'planning': {'subject': 'Assembly', 'scope': 'Assembly station', 'intent': 'Prevent defects', 'team': ['Manufacturing']},
                'resources': [{'id': 'integrity', 'name': 'Assembly integrity', 'category': 'state'}],
                'structure_nodes': [{'id': 'step', 'name': 'Assemble controller', 'level': 'process_step'}],
                'functions': [{'id': 'fn', 'structure_node_id': 'step', 'description': 'Regulate assembly integrity', 'definition': {'role': 'maintain_state', 'action': 'Operational integrity', 'io': []}}],
                'failure_chains': [{'id': 'fc', 'function_id': 'fn', 'cause_structure_node_id': 'step', 'effect_function_id': 'fn', 'failure_mode': 'Assembly loose', 'cause': 'Incorrect torque', 'effect': 'Assembly integrity lost', 'severity': 3, 'occurrence': 2, 'detection': 2, 'severity_rationale': 'Assembly integrity loss has limited local impact.', 'occurrence_rationale': 'Qualified torque process limits occurrence.', 'detection_rationale': 'In-station torque verification detects the defect.'}]}
    study = FMEAStudy.model_validate({'schema_version': 4, 'id': 'process', 'method_profile_id': 'aiag_vda_2019_public', 'model': analysis}).model_dump()
    assert evaluate_fmea_readiness(study)['can_analyze']
    model = aircraft()
    study['model']['structure_nodes'][0]['system_definition_ref'] = {'system_model_id': model['id'], 'instance_id': 'motor'}
    assert 'missing_equipment_reference' in codes(evaluate_fmea_readiness(study))
    before = deepcopy(study)
    assert evaluate_fmea_readiness(study, model)['can_analyze']
    assert study == before


def test_cause_and_effect_text_alone_cannot_satisfy_traceability():
    model = aircraft(); study = study_for(model)
    chain = study['model']['failure_chains'][0]
    chain['cause_structure_node_id'] = None; chain['effect_function_id'] = None
    assert {'missing_cause_traceability', 'missing_effect_traceability'} <= codes(evaluate_fmea_readiness(study, model))
    chain['cause_function_id'] = chain['function_id']
    chain['effect_contexts'] = [{'id': 'context', 'context': 'Aircraft', 'description': 'Operational availability lost', 'severity': 3}]
    assert evaluate_fmea_readiness(study, model)['can_analyze']


def test_revision_architecture_context_rejects_semantic_drift_but_not_layout():
    from reliability.FMEA import create_revision
    model = aircraft(); study = study_for(model)
    study['revisions'].append(create_revision(study, canonical_system=model, created_by='Engineer', change_summary='Baseline'))
    assert study['revisions'][0]['canonical_system'] == model
    model['diagrams'] = [{'id': 'view', 'name': 'View', 'nodes': []}]
    assert transition_lifecycle(study, canonical_system=model, target_status='in_review', actor='Engineer', rationale='Ready')['lifecycle_status'] == 'in_review'
    model['resources'][0]['name'] = 'New power resource definition'
    with pytest.raises(ValueError, match='canonical architecture context'):
        transition_lifecycle(study, canonical_system=model, target_status='in_review', actor='Engineer', rationale='Ready')


def test_instance_mode_applicability_limits_function_support_obligations():
    model = aircraft(); model['modes'].append({'id': 'maintenance', 'name': 'Maintenance'})
    model['instances'][3]['mode_ids'] = ['run']
    model['definitions'][3]['functions'][0]['mode_ids'] = []
    result = evaluate_fmea_readiness(study_for(model, 'motor'), model)
    assert result['can_analyze'], result['findings']


def test_missing_action_and_missing_system_root_cannot_pass():
    model = aircraft(); model['definitions'][3]['functions'][0]['definition']['action'] = ''
    assert 'missing_function_action' in codes(evaluate_fmea_readiness(study_for(model), model))
    model = aircraft(); model['root_instance_id'] = None
    assert 'invalid_hierarchy' in codes(evaluate_fmea_readiness(study_for(model), model))


def test_copied_snapshot_cannot_change_endpoint_or_support_relationships():
    model = aircraft(); study = study_for(model)
    derived = require_fmea_readiness(study, model)
    assert len(derived['model']['function_links']) == 3
    derived['model']['function_links'][0]['relationship'] = 'supports'
    assert 'canonical_snapshot_mismatch' in codes(evaluate_fmea_readiness(derived, model))
    study['model']['interfaces'][0]['source_structure_node_id'] = 'node-propulsion'
    assert 'canonical_snapshot_mismatch' in codes(evaluate_fmea_readiness(study, model))


@pytest.mark.parametrize('collection', ['structure_nodes', 'functions', 'interfaces'])
def test_duplicate_canonical_mapping_is_rejected(collection):
    model = aircraft(); study = study_for(model)
    copied = deepcopy(study['model'][collection][0]); copied['id'] += '-duplicate'
    study['model'][collection].append(copied)
    assert 'canonical_snapshot_mismatch' in codes(evaluate_fmea_readiness(study, model))


def test_required_boundary_functions_cannot_be_omitted_from_snapshot():
    model = aircraft(); study = study_for(model, 'motor')
    study['model']['functions'] = [fn for fn in study['model']['functions'] if fn['id'] != 'fn-esps']
    assert 'canonical_snapshot_mismatch' in codes(evaluate_fmea_readiness(study, model))


def test_pfmea_independent_top_level_process_steps_are_valid():
    model = aircraft(); study = study_for(model)
    analysis = study['model']; analysis['kind'] = 'pfmea'; analysis['system_binding'] = None
    analysis['structure_nodes'] = [dict(node, parent_id=None, level='process_step', system_definition_ref=None) for node in analysis['structure_nodes']]
    analysis['functions'] = [dict(fn, system_definition_ref=None, definition={'role': 'maintain_state', 'action': 'Operational integrity', 'io': []}) for fn in analysis['functions']]
    analysis['interfaces'] = []
    result = evaluate_fmea_readiness(study)
    assert result['can_analyze'], result['findings']


def test_unselected_resource_is_a_serializable_function_draft():
    from reliability.FMEA import create_revision
    model = aircraft()
    model['definitions'][3]['functions'][0]['definition']['io'].append({'id': 'draft-io', 'resource_id': '', 'direction': 'input'})
    model = SystemDefinitionModel.model_validate(model).model_dump()
    study = study_for(model)
    assert not [finding for finding in validate_system_definition(model)['issues'] if finding['severity'] == 'error']
    assert 'missing_resource' in codes(readiness(FMEAReadinessRequest(study=study, canonical_system=model)))
    revision = create_revision(study, canonical_system=model, created_by='Engineer', change_summary='Save function draft')
    assert revision['canonical_system']['definitions'][3]['functions'][0]['definition']['io'][-1]['resource_id'] == ''
    model['definitions'][3]['functions'][0]['definition']['io'][-1]['resource_id'] = 'nonexistent-resource'
    assert 'missing_resource' in {item['code'] for item in validate_system_definition(model)['issues']}


def test_mode_specific_transfer_cannot_satisfy_a_different_selected_mode():
    model = aircraft(); model['modes'].append({'id': 'standby', 'name': 'Standby'})
    model['interfaces'][0]['transfers'][0]['mode_ids'] = ['standby']
    study = study_for(model); study['model']['system_binding']['mode_id'] = 'run'
    result = evaluate_fmea_readiness(study, model)
    assert not result['can_analyze']
    assert {'unpaired_function_io', 'incomplete_interface_transfer'} <= codes(result)


def test_selected_mode_ignores_peer_functions_for_other_mode_transfers():
    model = aircraft(); model['modes'].append({'id': 'standby', 'name': 'Standby'})
    second = deepcopy(model['definitions'][2]['functions'][0]); second['id'] = 'standby-source'; second['mode_ids'] = ['standby']
    model['definitions'][2]['functions'].append(second)
    transfer = deepcopy(model['interfaces'][0]['transfers'][0]); transfer['id'] = 'standby-transfer'; transfer['mode_ids'] = ['standby']; transfer['source']['function_id'] = 'standby-source'
    model['interfaces'][0]['transfers'].append(transfer)
    study = study_for(model, 'motor', 'run')
    # Materialize the selected-mode snapshot, dropping the unrelated inactive peer.
    study['model']['functions'] = [fn for fn in study['model']['functions'] if fn['system_definition_ref']['function_id'] != 'standby-source']
    result = evaluate_fmea_readiness(study, model)
    assert result['can_analyze'], result['findings']


def test_typed_ports_cannot_disagree_with_function_io_or_interface_terminals():
    model = aircraft()
    source = model['definitions'][2]
    source['ports'].append({'id': 'other', 'name': 'Alternate', 'interface_type': 'energy', 'direction': 'output'})
    source['functions'][0]['definition']['io'][0]['port_id'] = 'other'
    assert 'transfer_endpoint_mismatch' in codes(evaluate_fmea_readiness(study_for(model), model))
    source['functions'][0]['definition']['io'][0]['port_id'] = 'p'
    source['ports'][0]['direction'] = 'input'
    assert 'incompatible_function_port' in codes(evaluate_fmea_readiness(study_for(model), model))
    source['ports'][0]['direction'] = 'output'; source['ports'][0]['interface_type'] = 'information'
    assert 'incompatible_function_port' in codes(evaluate_fmea_readiness(study_for(model), model))


@pytest.mark.parametrize('kind,axes', [
    ('dfmea', ('severity', 'occurrence', 'detection')),
    ('pfmea', ('severity', 'occurrence', 'detection')),
    ('fmea_msr', ('severity', 'frequency', 'monitoring')),
])
def test_default_ratings_require_explicit_assessment_before_controlled_progression(kind, axes):
    from reliability.AIAG_VDA_FMEA import _evaluate_chain
    from reliability.FMEA_readiness import FMEAPrerequisiteError
    model = aircraft(); study = study_for(model)
    study['model']['kind'] = kind
    for chain in study['model']['failure_chains']:
        if kind == 'fmea_msr':
            chain['occurrence'] = chain['detection'] = None
        for axis in axes:
            chain[axis] = 5
            chain[axis + '_rationale'] = '   '
    result = evaluate_fmea_readiness(study, model)
    missing = [item for item in result['findings'] if item['code'] == 'missing_rating_rationale']
    assert {item['field'] for item in missing} == {axis + '_rationale' for axis in axes}
    assert all(item['step'] == 5 and item['severity'] == 'error' for item in missing)
    assert not result['stages'][4]['complete']
    assert not result['stages'][5]['eligible']
    assert not result['can_analyze'] and not result['can_release']
    with pytest.raises(FMEAPrerequisiteError):
        require_fmea_readiness(study, model)
    with pytest.raises(HTTPException) as rejected:
        analyze(FMEAAnalyzeRequest(studies=[study], canonical_system=model))
    assert rejected.value.status_code == 409
    assert 'missing_rating_rationale' in codes(rejected.value.detail)
    # The standalone numerical evaluator retains its existing warning contract.
    standalone = []
    _evaluate_chain(kind, study['model']['failure_chains'][0], standalone)
    assert all(item['severity'] == 'warning' for item in standalone if item['code'] == 'missing_rating_rationale')
    for chain in study['model']['failure_chains']:
        for axis in axes:
            chain[axis + '_rationale'] = f'Engineering assessment basis for {axis} recorded against the approved rating table.'
    assert evaluate_fmea_readiness(study, model)['stages'][4]['complete']


def test_descriptive_planning_fields_are_advisory_through_controlled_release():
    from reliability.FMEA import create_revision, create_release
    model = aircraft(); study = study_for(model)
    study['model']['planning'].update(subject='', scope='', intent='', team=['   '])
    result = evaluate_fmea_readiness(study, model)
    advisory = [item for item in result['findings'] if item['code'] in {'missing_subject', 'missing_scope', 'missing_intent', 'missing_team'}]
    assert len(advisory) == 4
    assert all(item['step'] == 1 and item['severity'] == 'warning' for item in advisory)
    assert result['stages'][0]['complete'] and result['stages'][1]['eligible']
    assert result['can_analyze'] and result['can_release']
    evaluated = analyze(FMEAAnalyzeRequest(studies=[study], canonical_system=model))['studies'][0]
    assert evaluated['release_ready']
    assert evaluated['analysis']['finalization_ready']
    study['revisions'] = [create_revision(study, canonical_system=model, created_by='Reviewer', change_summary='Assess canonical engineering model')]
    study = transition_lifecycle(study, canonical_system=model, target_status='in_review', actor='Reviewer', rationale='Review architecture and risks')
    attestation = {'id': 'approval', 'role': 'approver', 'decision': 'approved', 'name': 'Reviewer', 'statement': 'Engineering assessment verified', 'timestamp': '2026-10-14T00:00:00Z', 'identity_assurance': 'named_local'}
    study = transition_lifecycle(study, canonical_system=model, target_status='approved', actor='Reviewer', rationale='Accept engineering assessment', attestations=[attestation])
    manifest = create_release(study, canonical_system=model, rating_profiles=[], program_requirements=[], software_version='test', software_commit='test', attestations=[attestation])
    assert manifest['lifecycle_status'] == 'released'
    assert manifest['engineering_snapshot']['model']['planning']['subject'] == ''
    broken = deepcopy(study); broken['model']['system_binding']['scope_instance_id'] = 'missing-instance'
    assert 'missing_scope' in codes(evaluate_fmea_readiness(broken, model))
    broken = deepcopy(study); broken['model']['failure_chains'][0]['severity_rationale'] = ''
    assert not evaluate_fmea_readiness(broken, model)['can_analyze']
