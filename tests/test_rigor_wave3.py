"""Tests for the Wave-3 rigor enhancements — DOE analysis, regression
diagnostics, non-normal capability, descriptive Q-Q, special-model CIs,
life-data Q-Q/P-P, and ALT use-level life CIs."""

import math

import numpy as np
import pytest
from scipy import stats as ss

from reliability.DOE import full_factorial_2level, analyze_factorial
from reliability.Regression import linear_regression, ridge_regression
from reliability.Process_capability import process_capability
from reliability.Descriptive import qq_plot
from reliability.Special_models import Fit_Weibull_Mixture, Fit_Weibull_2P_grouped
from reliability.ALT_fitters import Fit_Weibull_Exponential


@pytest.fixture(scope="class")
def factorial_analysis():
    design = full_factorial_2level(['A', 'B', 'C'])
    runs = design['runs']
    # y = 10 + 3A - 2B + 1.5AB (C inert) -> effects 6, -4, 3, 0
    y = [10 + 3 * r['A'] - 2 * r['B'] + 1.5 * r['A'] * r['B'] for r in runs]
    return analyze_factorial(runs, y, ['A', 'B', 'C'])


@pytest.fixture(scope="class")
def regression_fit():
    rng = np.random.default_rng(31)
    x = rng.uniform(0, 10, 50)
    y = 1.0 + 2.0 * x + rng.normal(0, 1, 50)
    return linear_regression(x.reshape(-1, 1), y, ['x'])


@pytest.fixture(scope="class")
def alt_use_level_fit():
    rng = np.random.default_rng(39)
    a, b, beta = 40.0, 1800.0, 2.5
    stresses = np.repeat([350.0, 400.0, 450.0], 25)
    eta = a * np.exp(b / stresses)
    lifes = eta * rng.weibull(beta, len(stresses))
    return Fit_Weibull_Exponential(
        failures=lifes, failure_stress=stresses, use_level_stress=300.0)


# --- 3m: DOE factorial analysis ---

class TestAnalyzeFactorial:
    def test_effects_recovered(self, factorial_analysis):
        eff = {e['term']: e['effect'] for e in factorial_analysis['effects']}
        assert eff['A'] == pytest.approx(6.0)
        assert eff['B'] == pytest.approx(-4.0)
        assert eff['A:B'] == pytest.approx(3.0)
        assert eff['C'] == pytest.approx(0.0, abs=1e-9)

    def test_effect_is_twice_coefficient(self, factorial_analysis):
        for e in factorial_analysis['effects']:
            assert e['effect'] == pytest.approx(2 * e['coefficient'])

    def test_pct_contribution_sums_to_100(self, factorial_analysis):
        total = sum(e['pct_contribution'] for e in factorial_analysis['effects'])
        assert total == pytest.approx(100.0)

    def test_lenth_flags_active_effects(self, factorial_analysis):
        sig = {e['term']: e['significant_lenth'] for e in factorial_analysis['effects']}
        assert sig['A'] and sig['B']
        assert not sig['C']

    def test_half_normal_sorted_ascending(self, factorial_analysis):
        hn = factorial_analysis['half_normal']
        assert list(hn['abs_effect']) == sorted(hn['abs_effect'])
        # Blom-style half-normal quantiles are positive and increasing.
        assert all(q >= 0 for q in hn['quantile'])
        assert list(hn['quantile']) == sorted(hn['quantile'])

    def test_main_effects_means(self, factorial_analysis):
        me = factorial_analysis['main_effects']['A']
        # mean at A=+1 minus mean at A=-1 equals the A effect.
        means = dict(zip(me['levels'], me['means']))
        assert means[1] - means[-1] == pytest.approx(6.0)

    def test_exactly_saturated_design_uses_lenth(self):
        # 2^2 with interaction: 4 runs, 4 parameters -> 0 residual df.
        design = full_factorial_2level(['A', 'B'])
        runs = design['runs']
        y = [10 + 3 * r['A'] - 2 * r['B'] for r in runs]
        out = analyze_factorial(runs, y, ['A', 'B'])
        assert out['saturated'] is True
        assert out['r2'] == pytest.approx(1.0)
        eff = {e['term']: e['effect'] for e in out['effects']}
        assert eff['A'] == pytest.approx(6.0)
        assert eff['B'] == pytest.approx(-4.0)
        assert all(e['p_value'] is None for e in out['effects'])

    def test_three_level_factor_is_not_silently_recoded(self):
        runs = [
            {'A': 0, 'B': -1}, {'A': 1, 'B': -1}, {'A': 2, 'B': -1},
            {'A': 0, 'B': 1}, {'A': 1, 'B': 1}, {'A': 2, 'B': 1},
        ]
        with pytest.raises(ValueError, match="exactly 2 levels"):
            analyze_factorial(runs, [1, 2, 3, 2, 3, 4], ['A', 'B'])


# --- 3n: regression diagnostics ---

class TestRegressionDiagnostics:
    def test_leverage_sums_to_n_params(self, regression_fit):
        assert sum(regression_fit['diagnostics']['leverage']) == pytest.approx(2.0)

    def test_studentized_residuals_standardized(self, regression_fit):
        r = np.asarray(regression_fit['diagnostics']['std_residuals'])
        assert abs(np.mean(r)) < 0.2
        assert np.std(r) == pytest.approx(1.0, abs=0.2)

    def test_qq_coordinates(self, regression_fit):
        qq = regression_fit['diagnostics']['qq']
        n = regression_fit['n']
        assert len(qq['theoretical']) == n == len(qq['sample'])
        # Blom positions: first theoretical quantile
        expected_first = ss.norm.ppf((1 - 0.375) / (n + 0.25))
        assert qq['theoretical'][0] == pytest.approx(expected_first)
        assert list(qq['sample']) == sorted(qq['sample'])

    def test_shapiro_and_dw_present(self, regression_fit):
        d = regression_fit['diagnostics']
        assert d['shapiro_p'] is not None and 0 <= d['shapiro_p'] <= 1
        assert d['durbin_watson'] is not None and 0 < d['durbin_watson'] < 4

    def test_cooks_distance_nonnegative(self, regression_fit):
        cd = regression_fit['diagnostics']['cooks_d']
        assert cd is not None and all(v >= 0 for v in cd)

    def test_ridge_diagnostics_without_leverage(self):
        rng = np.random.default_rng(32)
        x = rng.uniform(0, 5, 30)
        y = 2 * x + rng.normal(0, 0.5, 30)
        r = ridge_regression(x.reshape(-1, 1), y, 1.0, ['x'])
        d = r['diagnostics']
        assert d['leverage'] is None and d['cooks_d'] is None
        assert len(d['std_residuals']) == 30


# --- 3o: non-normal capability ---

class TestNonNormalCapability:
    def test_percentile_indices_for_lognormal_data(self):
        rng = np.random.default_rng(33)
        x = rng.lognormal(1.0, 0.6, 300)
        r = process_capability(x, lsl=0.5, usl=15.0)
        nn = r['non_normal']
        assert r['normality_warning'] is True and nn is not None
        p_lo, p_med, p_hi = (float(v) for v in
                             np.percentile(np.asarray(x), [0.135, 50, 99.865]))
        assert nn['Pp'] == pytest.approx((15.0 - 0.5) / (p_hi - p_lo))
        expected_ppk = min((15.0 - p_med) / (p_hi - p_med),
                           (p_med - 0.5) / (p_med - p_lo))
        assert nn['Ppk'] == pytest.approx(expected_ppk)

    def test_boxcox_suggests_log_for_lognormal(self):
        rng = np.random.default_rng(34)
        x = rng.lognormal(2.0, 0.5, 200)
        r = process_capability(x, lsl=1.0, usl=40.0)
        bc = r['non_normal']['boxcox']
        assert bc is not None
        assert bc['lambda_rounded'] == 0.0 and bc['transform'] == 'log(x)'
        assert bc['restores_normality'] is True

    def test_normal_data_has_no_non_normal_block(self):
        rng = np.random.default_rng(35)
        x = rng.normal(10, 1, 200)
        r = process_capability(x, lsl=7, usl=13)
        assert r['non_normal'] is None


# --- 3p: descriptive Q-Q ---

class TestDescriptiveQQ:
    def test_blom_positions_and_robust_line(self):
        rng = np.random.default_rng(36)
        x = rng.normal(5, 2, 40)
        r = qq_plot(x)
        n = 40
        assert r['theoretical'][0] == pytest.approx(
            float(ss.norm.ppf((1 - 0.375) / (n + 0.25))))
        # Quartile line through the (theoretical, sample) quartile pairs
        q1s, q3s = np.percentile(np.sort(x), [25, 75])
        q1t, q3t = ss.norm.ppf([0.25, 0.75])
        assert r['line']['slope'] == pytest.approx((q3s - q1s) / (q3t - q1t))
        # For normal data the slope approximates sigma
        assert r['line']['slope'] == pytest.approx(2.0, rel=0.35)

    def test_raises_below_three_points(self):
        with pytest.raises(ValueError):
            qq_plot([1.0, 2.0])


# --- 1k: special-model parameter CIs ---

class TestSpecialModelCIs:
    def test_mixture_cis_cover_true_params(self):
        rng = np.random.default_rng(37)
        f1 = 50 * rng.weibull(2.0, 60)
        f2 = 300 * rng.weibull(3.0, 60)
        fit = Fit_Weibull_Mixture(failures=np.concatenate([f1, f2]))
        res = fit.results.set_index('Parameter')
        for name, true_val in [('Alpha 1', 50.0), ('Beta 1', 2.0),
                               ('Alpha 2', 300.0), ('Beta 2', 3.0),
                               ('Proportion 1', 0.5)]:
            lo = res.loc[name, 'Lower_CI']
            hi = res.loc[name, 'Upper_CI']
            assert lo < hi
            assert lo < true_val < hi, f"{name}: [{lo}, {hi}] misses {true_val}"

    def test_proportion_ci_inside_unit_interval(self):
        rng = np.random.default_rng(38)
        f = np.concatenate([40 * rng.weibull(2, 30), 200 * rng.weibull(3, 30)])
        fit = Fit_Weibull_Mixture(failures=f)
        row = fit.results.set_index('Parameter').loc['Proportion 1']
        assert 0 < row['Lower_CI'] < row['Upper_CI'] < 1

    def test_grouped_cis_positive_and_ordered(self):
        fit = Fit_Weibull_2P_grouped(
            failures=[100, 200, 300, 400], failure_quantities=[5, 8, 6, 3],
            right_censored=[450], right_censored_quantities=[4])
        res = fit.results
        assert (res['Lower_CI'] > 0).all()
        assert (res['Lower_CI'] < res['Value']).all()
        assert (res['Value'] < res['Upper_CI']).all()


# --- 2k: ALT use-level life CI ---

class TestALTUseLevelCI:
    def test_ci_covers_true_median(self, alt_use_level_fit):
        true_median = 40.0 * math.exp(1800.0 / 300.0) * math.log(2) ** (1 / 2.5)
        assert alt_use_level_fit.use_level_life_lower < true_median < alt_use_level_fit.use_level_life_upper

    def test_ci_ordering_and_positivity(self, alt_use_level_fit):
        assert 0 < alt_use_level_fit.use_level_life_lower < alt_use_level_fit.use_level_life < alt_use_level_fit.use_level_life_upper

    def test_median_matches_distribution(self, alt_use_level_fit):
        assert alt_use_level_fit.use_level_life == pytest.approx(
            float(alt_use_level_fit.distribution_at_use_stress.median))

    def test_no_use_stress_no_ci(self):
        rng = np.random.default_rng(40)
        stresses = np.repeat([350.0, 450.0], 15)
        lifes = 40 * np.exp(1800 / stresses) * rng.weibull(2.0, 30)
        f = Fit_Weibull_Exponential(failures=lifes, failure_stress=stresses)
        assert f.use_level_life is None
        assert f.use_level_life_lower is None
