import json
import ast
from pathlib import Path

from tools.build_scientific_inventory import build_inventory


def test_inventory_detects_unassessed_new_procedures_and_separates_claims(tmp_path):
    core = tmp_path / 'src/reliability'
    core.mkdir(parents=True)
    (core / 'Model.py').write_text('class Fit:\n    def predict(self):\n        return 1\n')
    audit = tmp_path / 'docs/audit'
    audit.mkdir(parents=True)
    (audit / 'model-assurance-matrix.json').write_text(json.dumps({'models': [{
        'id': 'life.fit', 'status': 'needs_revision',
        'implementation': ['src/reliability/Model.py::Fit'],
        'claims': [{'id': 'point_estimate'}, {'id': 'prediction_interval'}],
    }]}))
    before = build_inventory(tmp_path)
    mapped, unassessed = before['entries']
    assert mapped['assurance_records'][0]['claim_ids'] == ['point_estimate', 'prediction_interval']
    assert unassessed['assessment'] == 'classification_pending'
    assert before['model_inventory_complete'] is False
    (core / 'New.py').write_text('def estimate():\n    return 2\n')
    after = build_inventory(tmp_path)
    assert after['summary']['entries'] == before['summary']['entries'] + 1
    assert after['entries'][-1]['assurance_records'] == []


def test_inventory_hash_changes_for_equation_but_not_line_numbers(tmp_path):
    core = tmp_path / 'src/reliability'
    core.mkdir(parents=True)
    file = core / 'Model.py'
    file.write_text('def survival(t):\n    return 1 - t\n')
    before = build_inventory(tmp_path)['entries'][0]['definition_sha256']
    file.write_text('\n\n# comment\ndef survival(t):\n    return 1 - t\n')
    assert build_inventory(tmp_path)['entries'][0]['definition_sha256'] == before
    file.write_text('def survival(t):\n    return 1 + t\n')
    assert build_inventory(tmp_path)['entries'][0]['definition_sha256'] != before


def test_inventory_includes_each_router_method_and_ignores_private_helpers(tmp_path):
    routers = tmp_path / 'gui/backend/routers'
    routers.mkdir(parents=True)
    (routers / 'life.py').write_text('''
@router.post('/fit')
@router.get('/fit')
def fit(request):
    return request
def _helper():
    pass
''')
    result = build_inventory(tmp_path)
    assert {row['method'] for row in result['entries']} == {'GET', 'POST'}
    assert result['summary']['router_operations'] == 2


def test_new_standard_method_surfaces_map_to_explicit_assurance_procedures():
    inventory = {row['id']: row for row in build_inventory()['entries']}
    expected = {
        'core.Special_models.Fit_Weibull_Partial_CR': 'life_data.composite_weibull_mle',
        'core.Special_models.Fit_Weibull_Bathtub': 'life_data.composite_weibull_mle',
        'core.Special_models.Weibull_Partial_CR.SF': 'life_data.composite_weibull_mle',
        'core.Life_metrics.remaining_life': 'life_data.conditional_life_metrics',
        'core.Life_metrics.interference_probability': 'life_data.stress_strength_interference',
        'core.Process_capability.distribution_specification_tails': 'capability.adopted_distribution_specification_tails',
        'api.capability.POST./spec-tail': 'capability.adopted_distribution_specification_tails',
        'core.Renewal.renewal_count': 'maintenance.delayed_renewal_fleet',
        'api.maintenance.POST./fleet-forecast': 'maintenance.delayed_renewal_fleet',
        'core.Renewal.perfect_block_cost_forecast': 'maintenance.perfect_block_replacement',
        'core.Repairable_systems.MCF_nonparametric': 'growth.mean_cumulative_cost',
    }
    for surface, procedure in expected.items():
        mappings = inventory[surface]['assurance_records']
        assert any(mapping['procedure_id'] == procedure and mapping['claim_ids'] for mapping in mappings)


def test_standard_method_evidence_nodes_exist_and_release_gaps_remain_explicit():
    root = Path(__file__).resolve().parents[1]
    matrix = json.loads((root / 'docs/audit/model-assurance-matrix.json').read_text())
    procedures = {
        'life_data.standard_rank_regression', 'life_data.fixed_shape_weibull',
        'life_data.mixed_censoring_mle', 'life_data.composite_weibull_mle',
        'life_data.conditional_life_metrics', 'life_data.stress_strength_interference',
        'capability.adopted_distribution_specification_tails', 'maintenance.delayed_renewal_fleet',
        'maintenance.perfect_block_replacement', 'growth.mean_cumulative_cost',
    }
    models = {model['id']: model for model in matrix['models']}
    for procedure in procedures:
        model = models[procedure]
        assert model['status'] == 'needs_revision'
        assert model['blockers'] and model['capabilities']['explicit_gaps']
        for evidence in model['evidence']:
            source = (root / evidence['path']).read_text()
            if evidence['path'].endswith('.py'):
                names = {node.name for node in ast.walk(ast.parse(source))
                         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
                assert evidence['node'] in names, (procedure, evidence['node'])
            else:
                assert f"test('{evidence['node']}'" in source, (procedure, evidence['node'])
