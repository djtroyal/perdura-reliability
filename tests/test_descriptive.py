"""Tests for reliability.Descriptive module."""

import math
import pytest
import numpy as np
from scipy import stats as scipy_stats

from reliability.Descriptive import (
    summary_statistics,
    frequency_table,
    contingency_table,
    run_chart,
    boxplot_stats,
    histogram,
)


# ---------------------------------------------------------------------------
# summary_statistics
# ---------------------------------------------------------------------------

class TestSummaryStatistics:
    DATA = list(range(1, 11))  # [1..10]

    def setup_method(self):
        self.res = summary_statistics({'x': self.DATA})['x']

    def test_n(self):
        assert self.res['n'] == 10

    def test_mean(self):
        assert math.isclose(self.res['mean'], 5.5, rel_tol=1e-9)

    def test_median(self):
        assert math.isclose(self.res['median'], 5.5, rel_tol=1e-9)

    def test_std_sample(self):
        expected = float(np.std(list(range(1, 11)), ddof=1))
        assert math.isclose(self.res['std'], expected, rel_tol=1e-9)

    def test_variance_sample(self):
        expected = float(np.var(list(range(1, 11)), ddof=1))
        assert math.isclose(self.res['variance'], expected, rel_tol=1e-9)

    def test_sem(self):
        expected = float(np.std(list(range(1, 11)), ddof=1) / math.sqrt(10))
        assert math.isclose(self.res['sem'], expected, rel_tol=1e-9)

    def test_min_max(self):
        assert self.res['min'] == 1.0
        assert self.res['max'] == 10.0

    def test_range(self):
        assert math.isclose(self.res['range'], 9.0, rel_tol=1e-9)

    def test_sum(self):
        assert math.isclose(self.res['sum'], 55.0, rel_tol=1e-9)

    def test_quartiles(self):
        arr = np.array(list(range(1, 11)), dtype=float)
        assert math.isclose(self.res['Q1'], float(np.percentile(arr, 25)), rel_tol=1e-9)
        assert math.isclose(self.res['Q2'], float(np.percentile(arr, 50)), rel_tol=1e-9)
        assert math.isclose(self.res['Q3'], float(np.percentile(arr, 75)), rel_tol=1e-9)

    def test_iqr(self):
        arr = np.array(list(range(1, 11)), dtype=float)
        expected_iqr = float(np.percentile(arr, 75) - np.percentile(arr, 25))
        assert math.isclose(self.res['IQR'], expected_iqr, rel_tol=1e-9)

    def test_percentiles(self):
        arr = np.array(list(range(1, 11)), dtype=float)
        assert math.isclose(self.res['p5'], float(np.percentile(arr, 5)), rel_tol=1e-9)
        assert math.isclose(self.res['p95'], float(np.percentile(arr, 95)), rel_tol=1e-9)

    def test_skewness(self):
        arr = np.array(list(range(1, 11)), dtype=float)
        assert math.isclose(self.res['skewness'], float(scipy_stats.skew(arr)), rel_tol=1e-6)

    def test_kurtosis_excess(self):
        arr = np.array(list(range(1, 11)), dtype=float)
        expected = float(scipy_stats.kurtosis(arr, fisher=True))
        assert math.isclose(self.res['kurtosis'], expected, rel_tol=1e-6)

    def test_cv(self):
        arr = np.array(list(range(1, 11)), dtype=float)
        expected = float(np.std(arr, ddof=1) / np.mean(arr))
        assert math.isclose(self.res['coefficient_of_variation'], expected, rel_tol=1e-9)

    def test_mad(self):
        arr = np.array(list(range(1, 11)), dtype=float)
        med = np.median(arr)
        expected = float(np.median(np.abs(arr - med)))
        assert math.isclose(self.res['MAD'], expected, rel_tol=1e-9)

    def test_normality_shapiro_keys(self):
        norm = self.res['normality']
        assert norm['test'] == 'shapiro'
        assert 'stat' in norm
        assert 'p' in norm

    def test_trimmed_mean_present(self):
        assert 'trimmed_mean' in self.res
        assert isinstance(self.res['trimmed_mean'], float)

    def test_mode_present(self):
        # For [1..10] each value appears once; mode is the first/smallest
        assert 'mode' in self.res

    def test_empty_column(self):
        res = summary_statistics({'empty': []})['empty']
        assert res['n'] == 0

    def test_single_value(self):
        res = summary_statistics({'s': [42.0]})['s']
        assert res['n'] == 1
        assert res['mean'] == 42.0

    def test_known_normal(self):
        rng = np.random.default_rng(0)
        data = rng.normal(0, 1, 100).tolist()
        res = summary_statistics({'z': data})['z']
        assert res['n'] == 100
        assert abs(res['mean']) < 0.5   # rough check


# ---------------------------------------------------------------------------
# frequency_table
# ---------------------------------------------------------------------------

class TestFrequencyTable:
    def test_value_counts_mode(self):
        data = [1, 1, 2, 3, 3, 3]
        res = frequency_table(data)
        assert res['mode'] == 'value_counts'
        counts = res['counts']
        assert 3 in counts  # value 3 appears 3 times

    def test_relative_freq_sums_to_1(self):
        data = [1, 1, 2, 3, 3, 3]
        res = frequency_table(data)
        assert math.isclose(sum(res['relative_freq']), 1.0, rel_tol=1e-9)

    def test_cumulative_ends_at_1(self):
        data = [1, 1, 2, 3, 3, 3]
        res = frequency_table(data)
        assert math.isclose(res['cumulative_freq'][-1], 1.0, rel_tol=1e-9)

    def test_binned_mode(self):
        data = list(range(1, 21))
        res = frequency_table(data, bins=4)
        assert res['mode'] == 'binned'
        assert len(res['counts']) == 4
        assert len(res['bin_edges']) == 5

    def test_binned_counts_sum(self):
        data = list(range(1, 21))
        res = frequency_table(data, bins=5)
        assert sum(res['counts']) == 20

    def test_binned_relative_freq_sums_to_1(self):
        data = list(range(1, 21))
        res = frequency_table(data, bins=5)
        assert math.isclose(sum(res['relative_freq']), 1.0, rel_tol=1e-9)

    def test_categorical_strings(self):
        data = ['a', 'b', 'a', 'c', 'a']
        res = frequency_table(data)
        assert res['mode'] == 'value_counts'
        assert 'a' in res['labels']
        idx = res['labels'].index('a')
        assert res['counts'][idx] == 3


# ---------------------------------------------------------------------------
# contingency_table
# ---------------------------------------------------------------------------

class TestContingencyTable:
    def setup_method(self):
        self.rows = ['A', 'A', 'A', 'B', 'B', 'B', 'A', 'B']
        self.cols = ['X', 'X', 'Y', 'X', 'Y', 'Y', 'Y', 'X']

    def test_shape(self):
        res = contingency_table(self.rows, self.cols)
        assert len(res['row_labels']) == 2
        assert len(res['col_labels']) == 2

    def test_grand_total(self):
        res = contingency_table(self.rows, self.cols)
        assert res['grand_total'] == 8

    def test_row_totals(self):
        res = contingency_table(self.rows, self.cols)
        assert sum(res['row_totals']) == 8

    def test_col_totals(self):
        res = contingency_table(self.rows, self.cols)
        assert sum(res['col_totals']) == 8

    def test_chi2_vs_scipy(self):
        """Chi-square result should match scipy.stats.chi2_contingency directly."""
        import pandas as pd
        from scipy.stats import chi2_contingency
        res = contingency_table(self.rows, self.cols)
        df = pd.DataFrame({'row': self.rows, 'col': self.cols})
        ct = pd.crosstab(df['row'], df['col'])
        chi2_ref, p_ref, dof_ref, _ = chi2_contingency(ct.values)
        assert math.isclose(res['chi2']['chi2'], chi2_ref, rel_tol=1e-9)
        assert math.isclose(res['chi2']['p'], p_ref, rel_tol=1e-9)
        assert res['chi2']['dof'] == dof_ref

    def test_dof(self):
        res = contingency_table(self.rows, self.cols)
        assert res['chi2']['dof'] == 1  # (2-1)*(2-1)

    def test_expected_shape(self):
        res = contingency_table(self.rows, self.cols)
        assert len(res['expected']) == 2
        assert len(res['expected'][0]) == 2

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError):
            contingency_table(['A', 'B'], ['X'])


# ---------------------------------------------------------------------------
# run_chart
# ---------------------------------------------------------------------------

class TestRunChart:
    def test_basic_keys(self):
        data = [1, 5, 2, 6, 3, 7, 4, 8]
        res = run_chart(data)
        for key in ('sequence', 'median', 'n', 'n_runs', 'expected_runs', 'longest_run', 'runs_test'):
            assert key in res

    def test_n(self):
        data = [1.0, 2.0, 3.0]
        res = run_chart(data)
        assert res['n'] == 3

    def test_alternating_sequence(self):
        """Perfect alternating series: 1,5,1,5,1,5 should have many runs."""
        data = [1, 5, 1, 5, 1, 5]
        res = run_chart(data)
        assert res['n_runs'] >= 5

    def test_one_run(self):
        """All above/below median with no ties should yield at least 1 run."""
        # median([1,2,3,4,5,6])=3.5; 1,2,3 below, 4,5,6 above -> 2 runs
        data = [1, 2, 3, 4, 5, 6]
        res = run_chart(data)
        assert res['n_runs'] >= 1

    def test_sequence_returned(self):
        data = [2.0, 4.0, 6.0]
        res = run_chart(data)
        assert res['sequence'] == [2.0, 4.0, 6.0]

    def test_z_and_p_present(self):
        data = list(range(1, 21))
        res = run_chart(data)
        assert 'z' in res['runs_test']
        assert 'p' in res['runs_test']

    def test_too_few_values_raises(self):
        with pytest.raises(ValueError):
            run_chart([1.0])

    def test_n_above_n_below(self):
        data = [1, 2, 3, 4, 5, 6, 7, 8]
        res = run_chart(data)
        assert res['n_above'] + res['n_below'] <= res['n']


# ---------------------------------------------------------------------------
# boxplot_stats
# ---------------------------------------------------------------------------

class TestBoxplotStats:
    def test_known_values(self):
        data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        res = boxplot_stats(data)
        assert math.isclose(res['median'], 5.5, rel_tol=1e-9)
        assert res['min'] == 1.0
        assert res['max'] == 10.0

    def test_quartiles(self):
        arr = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float)
        res = boxplot_stats(arr.tolist())
        assert math.isclose(res['Q1'], float(np.percentile(arr, 25)), rel_tol=1e-9)
        assert math.isclose(res['Q3'], float(np.percentile(arr, 75)), rel_tol=1e-9)

    def test_outlier_detected(self):
        data = [1, 2, 3, 4, 5, 100]
        res = boxplot_stats(data)
        assert 100 in res['outliers']

    def test_no_outliers(self):
        data = [1, 2, 3, 4, 5]
        res = boxplot_stats(data)
        assert res['outliers'] == []

    def test_iqr(self):
        arr = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float)
        res = boxplot_stats(arr.tolist())
        expected_iqr = float(np.percentile(arr, 75) - np.percentile(arr, 25))
        assert math.isclose(res['iqr'], expected_iqr, rel_tol=1e-9)

    def test_whisker_low_ge_min(self):
        data = [1, 2, 3, 4, 5, 100]
        res = boxplot_stats(data)
        assert res['whisker_low'] >= res['min']

    def test_whisker_high_le_max_non_outlier(self):
        data = [1, 2, 3, 4, 5, 100]
        res = boxplot_stats(data)
        # whisker_high should be bounded to max non-outlier
        assert res['whisker_high'] < 100

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            boxplot_stats([])


# ---------------------------------------------------------------------------
# histogram
# ---------------------------------------------------------------------------

class TestHistogram:
    def test_bin_edges_length(self):
        data = list(range(1, 11))
        res = histogram(data, bins=4)
        assert len(res['bin_edges']) == len(res['counts']) + 1

    def test_counts_sum(self):
        data = list(range(1, 11))
        res = histogram(data, bins=5)
        assert sum(res['counts']) == 10

    def test_default_bins_fd(self):
        """Default bins should not error and produce at least 1 bin."""
        data = list(range(1, 21))
        res = histogram(data)
        assert len(res['counts']) >= 1

    def test_single_bin(self):
        data = [1.0, 2.0, 3.0]
        res = histogram(data, bins=1)
        assert res['counts'] == [3]

    def test_matches_numpy(self):
        data = list(range(1, 11))
        res = histogram(data, bins=5)
        counts_np, edges_np = np.histogram(data, bins=5)
        assert res['counts'] == counts_np.tolist()
        for a, b in zip(res['bin_edges'], edges_np.tolist()):
            assert math.isclose(a, b, rel_tol=1e-9)

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            histogram([])
