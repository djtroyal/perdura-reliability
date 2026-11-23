import math
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prediction_comparison_fixture import comparison_fixture


def test_default_217f_matched_recipes_environment_ratio_oracle():
    fixture = comparison_fixture()
    a, b = [folio['state']['result'] for folio in fixture['folios']]
    assert a['standard'] == b['standard'] == 'MIL-HDBK-217F'
    assert not a.get('excluded_parts') and not b.get('excluded_parts')
    assert all(row.get('error') is None for row in a['results'] + b['results'])
    assert a['total_failure_rate'] > 0
    assert b['total_failure_rate'] > a['total_failure_rate']
    expected_b = 0
    for left, right in zip(a['results'], b['results']):
        assert left['part_id'] == right['part_id']
        assert left['quantity'] == right['quantity']
        # Only environmental pi changes: reconstruct rate B from A and pi_E.
        factors_a, factors_b = left['pi_factors'], right['pi_factors']
        assert factors_a['pi_E'] != factors_b['pi_E']
        expected = left['total_failure_rate'] * factors_b['pi_E'] / factors_a['pi_E']
        assert right['total_failure_rate'] == pytest.approx(expected)
        expected_b += expected
    assert b['total_failure_rate'] == pytest.approx(expected_b)
    rate_ratio = b['total_failure_rate'] / a['total_failure_rate']
    assert b['mtbf_hours'] / a['mtbf_hours'] == pytest.approx(1 / rate_ratio)
    assert math.isfinite(rate_ratio)
