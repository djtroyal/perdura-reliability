"""Tests for reliability.Descriptive module."""

import math
from inspect import signature
from types import SimpleNamespace
import warnings
import pytest
import numpy as np
from scipy import stats as scipy_stats
import reliability.Descriptive as descriptive_module

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
        # Bias-corrected G1 (matches Minitab/Excel), per the rigor pass.
        arr = np.array(list(range(1, 11)), dtype=float)
        assert math.isclose(self.res['skewness'], float(scipy_stats.skew(arr, bias=False)), rel_tol=1e-6)

    def test_kurtosis_excess(self):
        # Bias-corrected G2 (matches Minitab/Excel), per the rigor pass.
        arr = np.array(list(range(1, 11)), dtype=float)
        expected = float(scipy_stats.kurtosis(arr, fisher=True, bias=False))
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


def _expected_normal_ad_critical(n):
    # SciPy changed its normal-reference table in 1.17, independently of this
    # adapter. Select the historical oracle through the installed public API,
    # without consulting the production capability flag or returned result.
    if 'method' in signature(scipy_stats.anderson).parameters:
        return float(np.round(0.752 / (1 + 0.75 / n + 2.25 / n**2), 3))
    return float(np.round(0.787 / (1 + 4 / n - 25 / n**2), 3))


class TestSummaryNormalityCompatibility:
    """Keep the existing normality contract across SciPy's result transition."""

    @pytest.mark.parametrize('n, expected_test', [(5000, 'shapiro'), (5001, 'anderson')])
    def test_sample_size_boundary_without_future_warning(self, n, expected_test):
        data = np.random.default_rng(20261009).normal(size=n)
        with warnings.catch_warnings():
            warnings.simplefilter('error', FutureWarning)
            result = summary_statistics({'x': data})['x']['normality']

        assert result['test'] == expected_test
        assert math.isfinite(result['stat'])
        if expected_test == 'anderson':
            assert set(result) == {'test', 'stat', 'critical_5pct', 'p'}
            assert result['critical_5pct'] == _expected_normal_ad_critical(n)
            assert result['p'] is None
        else:
            assert set(result) == {'test', 'stat', 'p'}
            assert 0 <= result['p'] <= 1

    @pytest.mark.parametrize('distribution, expected_statistic', [
        ('normal', 0.2849191172344945),
        ('exponential', 263.34797391011034),
    ])
    def test_fixed_samples_preserve_legacy_ad_statistic_and_critical_value(
        self, distribution, expected_statistic,
    ):
        # Frozen complete-sample EDF statistics for seed 20261009, n=6001.
        # Independently checked using math.fsum over the ordered normal log-CDF
        # and reversed log-survival values, fitting mean and sample SD (ddof=1).
        # The critical-value oracle preserves the installed SciPy table and
        # n-correction. No deprecated SciPy call is used as an oracle.
        rng = np.random.default_rng(20261009)
        data = getattr(rng, distribution)(size=6001)
        with warnings.catch_warnings():
            warnings.simplefilter('error', FutureWarning)
            result = summary_statistics({'x': data})['x']['normality']

        assert result['test'] == 'anderson'
        assert result['stat'] == pytest.approx(expected_statistic, rel=2e-12, abs=2e-10)
        assert result['critical_5pct'] == _expected_normal_ad_critical(len(data))
        assert result['p'] is None
        assert (result['stat'] > result['critical_5pct']) == (distribution == 'exponential')

    @pytest.mark.parametrize('n', [5000, 5001])
    def test_normality_uses_finite_count_and_preserves_filtered_data(self, n):
        clean = np.random.default_rng(20261009).normal(size=n).tolist()
        dirty = clean[:2500] + [None, np.nan, np.inf, -np.inf] + clean[2500:]
        with warnings.catch_warnings():
            warnings.simplefilter('error', FutureWarning)
            result = summary_statistics({'clean': clean, 'dirty': dirty})

        assert result['dirty']['n'] == n
        assert result['dirty'] == result['clean']

    @pytest.mark.parametrize('scale, shift', [(3.5, -8.0), (-2.0, 7.0)])
    def test_ad_is_location_scale_and_reflection_invariant(self, scale, shift):
        data = np.random.default_rng(20261009).exponential(size=6001)
        with warnings.catch_warnings():
            warnings.simplefilter('error', FutureWarning)
            result = summary_statistics({'original': data, 'transformed': scale * data + shift})

        original = result['original']['normality']
        transformed = result['transformed']['normality']
        assert transformed['stat'] == pytest.approx(original['stat'], rel=2e-12, abs=2e-10)
        assert transformed['critical_5pct'] == original['critical_5pct']
        assert transformed['p'] is None

    def test_modern_result_needs_no_deprecated_critical_value_attributes(self, monkeypatch):
        calls = []

        def modern_anderson(values, dist, *, method):
            calls.append((len(values), dist, method))
            return SimpleNamespace(statistic=1.25, pvalue=0.01)

        monkeypatch.setattr(descriptive_module, '_ANDERSON_SUPPORTS_METHOD', True)
        monkeypatch.setattr(descriptive_module.stats, 'anderson', modern_anderson)

        result = descriptive_module._anderson_normality(np.arange(5001, dtype=float))

        assert calls == [(5001, 'norm', 'interpolate')]
        assert result == {'test': 'anderson', 'stat': 1.25, 'critical_5pct': 0.752, 'p': None}

    def test_legacy_signature_and_significance_level_lookup(self, monkeypatch):
        calls = []

        def legacy_anderson(values, dist):
            # No method keyword and deliberately reordered significance levels.
            calls.append((len(values), dist))
            return SimpleNamespace(
                statistic=0.5,
                significance_level=np.array([1.0, 5.0, 15.0, 2.5, 10.0]),
                critical_values=np.array([1.035, 0.731, 0.561, 0.873, 0.631]),
            )

        monkeypatch.setattr(descriptive_module, '_ANDERSON_SUPPORTS_METHOD', False)
        monkeypatch.setattr(descriptive_module.stats, 'anderson', legacy_anderson)

        result = descriptive_module._anderson_normality(np.arange(5001, dtype=float))

        assert calls == [(5001, 'norm')]
        assert result == {'test': 'anderson', 'stat': 0.5, 'critical_5pct': 0.731, 'p': None}

    def test_modern_calculation_error_is_not_retried_as_a_legacy_call(self, monkeypatch):
        calls = []

        def broken_anderson(values, dist, *, method):
            calls.append(method)
            raise TypeError('calculation failed inside the selected method')

        monkeypatch.setattr(descriptive_module, '_ANDERSON_SUPPORTS_METHOD', True)
        monkeypatch.setattr(descriptive_module.stats, 'anderson', broken_anderson)

        with pytest.raises(TypeError, match='calculation failed inside'):
            descriptive_module._anderson_normality(np.arange(5001, dtype=float))
        assert calls == ['interpolate']

    @pytest.mark.parametrize('n', [3, 5000, 5001])
    def test_constant_sample_preserves_existing_undefined_ad_behavior(self, n):
        # Degenerate-data runtime warnings are an existing, separate behavior;
        # this adapter must remove the FutureWarning without inventing AD
        # inference or changing the existing Shapiro result for constant data.
        with warnings.catch_warnings(record=True):
            warnings.simplefilter('always')
            warnings.simplefilter('error', FutureWarning)
            result = summary_statistics({'x': np.ones(n)})['x']['normality']

        if n > 5000:
            assert result['test'] == 'anderson'
            assert math.isnan(result['stat'])
            assert result['critical_5pct'] == _expected_normal_ad_critical(n)
            assert result['p'] is None
        else:
            assert result == {'test': 'shapiro', 'stat': 1.0, 'p': 1.0}

    @pytest.mark.parametrize('data', [[42.0], [41.0, 42.0]])
    def test_insufficient_sample_preserves_undefined_shapiro_result(self, data):
        result = summary_statistics({'x': data})['x']['normality']

        assert result['test'] == 'shapiro'
        assert math.isnan(result['stat'])
        assert math.isnan(result['p'])
        assert 'critical_5pct' not in result

    def test_all_nonfinite_values_preserve_empty_column_result(self):
        assert summary_statistics({'x': [None, np.nan, np.inf, -np.inf]}) == {
            'x': {'n': 0, 'error': 'No finite values'},
        }


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

    def test_failure_does_not_expose_exception_details(self, monkeypatch):
        def fail_test(_observed):
            raise RuntimeError('sensitive-internal-contingency-detail')

        monkeypatch.setattr(
            descriptive_module.stats, 'chi2_contingency', fail_test)

        result = contingency_table(self.rows, self.cols)

        assert result['chi2']['error'] == (
            'Chi-square test unavailable for this contingency table.')
        assert 'sensitive-internal-contingency-detail' not in str(result)


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
