import json

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
