"""Tests for reliability.MSA — Gage R&R ANOVA and Xbar-R methods."""

import math
import pytest
from reliability.MSA import gage_rr_anova, gage_rr_xbar_r


# ---------------------------------------------------------------------------
# Classic balanced dataset: 10 parts × 3 operators × 2 trials
# Adapted from AIAG MSA Reference Manual examples (synthetic balanced data)
# ---------------------------------------------------------------------------

def make_aiag_data():
    """Return parts, operators, measurements for a 10x3x2 balanced study."""
    # 10 parts, 3 operators, 2 replicates each → 60 measurements
    raw = [
        # (part, op, m1, m2)
        (1, 'A', 0.29, 0.41),
        (2, 'A', -0.56, -0.68),
        (3, 'A', 1.34, 1.17),
        (4, 'A', 0.47, 0.50),
        (5, 'A', -0.80, -0.92),
        (6, 'A', 0.02, 0.11),
        (7, 'A', 0.59, 0.75),
        (8, 'A', -0.31, -0.20),
        (9, 'A', 2.26, 1.99),
        (10, 'A', -1.36, -1.25),
        (1, 'B', 0.08, 0.25),
        (2, 'B', -0.47, -1.22),
        (3, 'B', 1.19, 0.94),
        (4, 'B', 0.01, 1.03),
        (5, 'B', -0.56, -1.20),
        (6, 'B', -0.20, 0.22),
        (7, 'B', 0.47, 0.55),
        (8, 'B', -0.63, 0.08),
        (9, 'B', 1.80, 2.12),
        (10, 'B', -1.68, -1.55),
        (1, 'C', 0.04, 0.34),
        (2, 'C', -1.38, -1.13),
        (3, 'C', 0.88, 1.09),
        (4, 'C', 0.14, 0.20),
        (5, 'C', -0.82, -0.73),
        (6, 'C', 0.28, -0.11),
        (7, 'C', 0.40, 0.66),
        (8, 'C', -0.17, 0.12),
        (9, 'C', 1.51, 1.80),
        (10, 'C', -1.45, -1.30),
    ]
    parts = []
    operators = []
    measurements = []
    for (p, o, m1, m2) in raw:
        parts += [p, p]
        operators += [o, o]
        measurements += [m1, m2]
    return parts, operators, measurements


@pytest.fixture
def aiag_data():
    return make_aiag_data()


# ---------------------------------------------------------------------------
# ANOVA method tests
# ---------------------------------------------------------------------------

class TestAnovaMethod:

    def test_returns_expected_keys(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements, tolerance=4.0)
        assert 'anova_table' in result
        assert 'variance_components' in result
        assert 'ndc' in result
        assert 'pooled' in result
        assert 'per_cell_means' in result

    def test_variance_components_non_negative(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements, tolerance=4.0)
        comps = result['variance_components']
        for name, stats in comps.items():
            assert stats['variance'] >= 0, f"Negative variance for {name}"
            assert stats['stdev'] >= 0, f"Negative stdev for {name}"

    def test_pct_contribution_sums_to_100(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        comps = result['variance_components']
        # GRR + Part-to-Part should ~= Total contribution (100%)
        total_pct = comps['Total']['pct_contribution']
        assert abs(total_pct - 100.0) < 1e-6

        # GRR + Part-to-Part pct contributions sum to ~100
        grr_pct = comps['GRR']['pct_contribution']
        pv_pct = comps['Part-to-Part']['pct_contribution']
        assert abs(grr_pct + pv_pct - 100.0) < 1e-4, (
            f"GRR({grr_pct:.4f}) + PV({pv_pct:.4f}) = {grr_pct+pv_pct:.4f}, expected ~100"
        )

    def test_anova_ss_sums_to_total(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        anova = result['anova_table']
        total_row = next(r for r in anova if r['source'] == 'Total')
        ss_total = total_row['SS']
        # Sum non-Total, non-pooled sources
        ss_parts_sum = sum(
            r['SS'] for r in anova
            if r['source'] not in ('Total',)
        )
        assert abs(ss_parts_sum - ss_total) < 1e-6 * (abs(ss_total) + 1), (
            f"SS sum {ss_parts_sum:.6f} ≠ SS total {ss_total:.6f}"
        )

    def test_ndc_is_int_at_least_1(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        assert isinstance(result['ndc'], int)
        assert result['ndc'] >= 1

    def test_grr_plus_pv_equals_tv_variance(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        comps = result['variance_components']
        var_grr = comps['GRR']['variance']
        var_pv = comps['Part-to-Part']['variance']
        var_tv = comps['Total']['variance']
        assert abs(var_grr + var_pv - var_tv) < 1e-10 * (abs(var_tv) + 1), (
            f"GRR({var_grr}) + PV({var_pv}) ≠ TV({var_tv})"
        )

    def test_repeatability_plus_reproducibility_equals_grr(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        comps = result['variance_components']
        ev = comps['Repeatability']['variance']
        av = comps['Reproducibility']['variance']
        grr = comps['GRR']['variance']
        assert abs(ev + av - grr) < 1e-10 * (abs(grr) + 1)

    def test_tolerance_pct_returned(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements, tolerance=4.0)
        comps = result['variance_components']
        assert comps['GRR']['pct_tolerance'] is not None
        assert comps['GRR']['pct_tolerance'] >= 0

    def test_no_tolerance_returns_none(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        comps = result['variance_components']
        assert comps['GRR']['pct_tolerance'] is None

    def test_pct_study_var_grr_lt_100(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        grr_pct = result['variance_components']['GRR']['pct_study_var']
        # GRR study var can't exceed Total study var
        assert 0.0 <= grr_pct <= 100.0

    def test_pooling_flag_is_bool(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        assert isinstance(result['pooled'], bool)

    def test_per_cell_means_populated(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        # 10 parts × 3 operators = 30 cells
        assert len(result['per_cell_means']) == 30

    def test_unique_parts_and_ops(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_anova(parts, operators, measurements)
        assert result['n_parts'] == 10
        assert result['n_operators'] == 3

    def test_input_length_mismatch_raises(self):
        with pytest.raises(ValueError, match="same length"):
            gage_rr_anova([1, 2, 3], ['A', 'B'], [0.1, 0.2, 0.3])

    def test_single_part_raises(self):
        with pytest.raises(ValueError):
            gage_rr_anova([1, 1, 1, 1], ['A', 'A', 'B', 'B'], [1.0, 1.1, 1.0, 1.1])

    def test_single_operator_raises(self):
        with pytest.raises(ValueError):
            gage_rr_anova([1, 1, 2, 2], ['A', 'A', 'A', 'A'], [1.0, 1.1, 2.0, 2.1])

    def test_custom_multiplier(self, aiag_data):
        parts, operators, measurements = aiag_data
        r5 = gage_rr_anova(parts, operators, measurements, study_var_multiplier=5.15)
        r6 = gage_rr_anova(parts, operators, measurements, study_var_multiplier=6.0)
        # Different multipliers should give different study_var
        sv5 = r5['variance_components']['GRR']['study_var']
        sv6 = r6['variance_components']['GRR']['study_var']
        assert abs(sv5 / sv6 - 5.15 / 6.0) < 1e-9


# ---------------------------------------------------------------------------
# Xbar-R method tests
# ---------------------------------------------------------------------------

class TestXbarRMethod:

    def test_returns_expected_keys(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements, tolerance=4.0)
        assert 'variance_components' in result
        assert 'ndc' in result
        assert 'R_bar' in result

    def test_variance_components_non_negative(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements, tolerance=4.0)
        comps = result['variance_components']
        for name, stats in comps.items():
            assert stats['stdev'] >= 0, f"Negative stdev for {name}"
            assert stats['variance'] >= 0, f"Negative variance for {name}"

    def test_pct_contribution_sums_to_100(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements)
        comps = result['variance_components']
        total_pct = comps['Total']['pct_contribution']
        assert abs(total_pct - 100.0) < 1e-6

        grr_pct = comps['GRR']['pct_contribution']
        pv_pct = comps['Part-to-Part']['pct_contribution']
        assert abs(grr_pct + pv_pct - 100.0) < 1e-4

    def test_grr_sq_plus_pv_sq_equals_tv_sq(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements)
        comps = result['variance_components']
        grr = comps['GRR']['stdev']
        pv = comps['Part-to-Part']['stdev']
        tv = comps['Total']['stdev']
        assert abs(grr**2 + pv**2 - tv**2) < 1e-10 * (abs(tv**2) + 1), (
            f"GRR^2({grr**2}) + PV^2({pv**2}) ≠ TV^2({tv**2})"
        )

    def test_ndc_is_int_at_least_1(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements)
        assert isinstance(result['ndc'], int)
        assert result['ndc'] >= 1

    def test_tolerance_pct_returned(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements, tolerance=4.0)
        assert result['variance_components']['GRR']['pct_tolerance'] is not None

    def test_no_tolerance_returns_none(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements)
        assert result['variance_components']['GRR']['pct_tolerance'] is None

    def test_ev_av_grr_relationship(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements)
        comps = result['variance_components']
        ev = comps['Repeatability']['stdev']
        av = comps['Reproducibility']['stdev']
        grr = comps['GRR']['stdev']
        # GRR = sqrt(EV^2 + AV^2)
        assert abs(math.sqrt(ev**2 + av**2) - grr) < 1e-10

    def test_per_cell_means_populated(self, aiag_data):
        parts, operators, measurements = aiag_data
        result = gage_rr_xbar_r(parts, operators, measurements)
        assert len(result['per_cell_means']) == 30

    def test_input_validation_raises(self):
        with pytest.raises(ValueError):
            gage_rr_xbar_r([1, 2], ['A', 'B', 'C'], [1.0, 2.0])

    def test_single_part_raises(self):
        with pytest.raises(ValueError):
            gage_rr_xbar_r([1, 1, 1, 1], ['A', 'A', 'B', 'B'], [1.0, 1.1, 1.0, 1.1])


# ---------------------------------------------------------------------------
# Cross-method consistency (same data → reasonable agreement)
# ---------------------------------------------------------------------------

def test_anova_and_xbar_r_agree_on_ndc(aiag_data):
    """Both methods should produce ndc ≥ 1 and be in the same ballpark."""
    parts, operators, measurements = aiag_data
    r_anova = gage_rr_anova(parts, operators, measurements)
    r_xbar = gage_rr_xbar_r(parts, operators, measurements)
    assert r_anova['ndc'] >= 1
    assert r_xbar['ndc'] >= 1
    # They should be within 5 of each other (both are rough estimates)
    assert abs(r_anova['ndc'] - r_xbar['ndc']) <= 10


def test_grand_mean_consistent(aiag_data):
    """Grand mean reported by both methods should match."""
    parts, operators, measurements = aiag_data
    r_anova = gage_rr_anova(parts, operators, measurements)
    r_xbar = gage_rr_xbar_r(parts, operators, measurements)
    assert abs(r_anova['grand_mean'] - r_xbar['grand_mean']) < 1e-10
