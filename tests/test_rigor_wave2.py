"""Tests for the Wave-2 rigor method upgrades — values cross-checked against
scipy or hand-computed references."""

import math

import numpy as np
import pytest
from scipy import stats as ss

from reliability.Nonparametric import KaplanMeier, NelsonAalen
from reliability.Bayesian import weibayes_fit
from reliability.Repairable_systems import CrowAMSAA, MCF_parametric
from reliability.ALT_fitters import Fit_Lognormal_Exponential
from reliability.Reliability_testing import two_proportion_test
from reliability.Markov import MarkovChain, MarkovState, MarkovTransition
from reliability.Hypothesis_tests import (
    one_way_anova, chi_square_gof, chi_square_independence, binomial_test,
    kruskal_wallis, friedman, anova_factorial, two_sample_t, _hedges_g,
)
from reliability.Special_models import Fit_Weibull_DS


# --- KM / NA transformed confidence intervals ---

def test_km_loglog_bands_strictly_inside_unit_interval():
    rng = np.random.default_rng(21)
    f = (100 * rng.weibull(1.5, 25)).tolist()
    km = KaplanMeier(failures=f, right_censored=[150.0] * 5)
    lo = np.asarray(km.results['CI_lower'])
    hi = np.asarray(km.results['CI_upper'])
    s = np.asarray(km.results['SF'])
    inner = (s > 0) & (s < 1)
    # log(-log) bands never clip to exactly 0/1 while S is interior.
    assert np.all(lo[inner] > 0) and np.all(hi[inner] < 1)
    assert np.all(lo <= s + 1e-12) and np.all(s <= hi + 1e-12)


def test_na_log_bands_positive():
    rng = np.random.default_rng(22)
    f = (100 * rng.weibull(1.5, 25)).tolist()
    na = NelsonAalen(failures=f)
    chf = np.asarray(na.results['CHF'][1:])   # skip the t=0 row
    lo = np.asarray(na.results['CI_lower'][1:])
    hi = np.asarray(na.results['CI_upper'][1:])
    assert np.all(lo > 0)                     # log interval keeps H > 0
    assert np.all(lo <= chf) and np.all(chf <= hi)


# --- Weibayes two-sided bounds ---

def test_weibayes_two_sided_uses_alpha_over_2():
    times = np.array([100.0, 200.0, 300.0])
    states = ["F", "F", "S"]
    res = weibayes_fit(list(times), states, beta=2.0, CI=0.90)
    r, beta = 2, 2.0
    sum_tb = float(np.sum(times ** beta))
    lo_exp = (2 * sum_tb / ss.chi2.ppf(0.95, 2 * (r + 1))) ** (1 / beta)
    hi_exp = (2 * sum_tb / ss.chi2.ppf(0.05, 2 * r)) ** (1 / beta)
    assert res["eta_lower"] == pytest.approx(lo_exp)
    assert res["eta_upper"] == pytest.approx(hi_exp)


# --- Crow-AMSAA CvM beta-bar (MIL-HDBK-189 (M-1)/M in both branches) ---

def test_cvm_beta_bar_time_terminated():
    times = [12, 45, 89, 132, 200, 290, 410, 570, 720, 900]
    fit = CrowAMSAA(times=times, T=1000)          # time-terminated, M = n
    n = len(times)
    beta_bar = (n - 1) / n * fit.beta
    i = np.arange(1, n + 1)
    expected = (1 / (12 * n) + np.sum(((np.asarray(times) / 1000.0) ** beta_bar
                                       - (2 * i - 1) / (2 * n)) ** 2))
    assert fit.CvM == pytest.approx(expected)


# --- MCF parametric pooled MLE recovers a known NHPP beta ---

def test_mcf_parametric_mle_recovers_beta():
    rng = np.random.default_rng(23)
    beta_true, alpha_true, T = 1.8, 50.0, 300.0
    data = []
    for _ in range(12):
        # Simulate an NHPP power law by inverse-transforming a homogeneous
        # Poisson process: t = alpha * u^(1/beta) with u the HPP event times
        # scaled to the expected count at T.
        n_expected = (T / alpha_true) ** beta_true
        n_events = rng.poisson(n_expected)
        u = np.sort(rng.uniform(0, 1, n_events))
        events = alpha_true * (u * n_expected) ** (1 / beta_true)
        events = events[events < T]
        data.append(list(events))
    res = MCF_parametric(data, observation_ends=[T] * len(data))
    assert res['beta'] == pytest.approx(beta_true, rel=0.15)
    assert res['alpha'] == pytest.approx(alpha_true, rel=0.25)


# --- Lognormal ALT: Arrhenius slope on the median ---

def test_lognormal_alt_recovers_arrhenius_slope():
    rng = np.random.default_rng(24)
    a_true, b_true, sigma = 50.0, 2000.0, 0.3
    stresses = np.repeat([350.0, 400.0, 450.0], 30)
    medians = a_true * np.exp(b_true / stresses)
    lifes = np.exp(rng.normal(np.log(medians), sigma))
    fit = Fit_Lognormal_Exponential(failures=lifes, failure_stress=stresses)
    a_hat, b_hat = fit.life_stress_params
    assert b_hat == pytest.approx(b_true, rel=0.10)   # b IS the Arrhenius slope now
    assert fit.shape == pytest.approx(sigma, rel=0.25)


# --- Two-proportion: exact path for sparse counts ---

def test_two_proportion_fisher_for_small_counts():
    r = two_proportion_test(20, 1, 20, 4)
    assert r["method"] == "fisher-exact"
    table = [[1, 19], [4, 16]]
    _, p_exp = ss.fisher_exact(table)
    assert r["p_value"] == pytest.approx(p_exp)


def test_two_proportion_z_for_large_counts():
    r = two_proportion_test(500, 200, 500, 250)
    assert r["method"] == "pooled-z"
    assert r["z"] is not None


# --- Markov: reducible chain -> None; MUT ---

def _repairable_chain(lam=0.01, mu=0.5):
    mc = MarkovChain()
    mc.add_state(MarkovState('up', 'Up', 'operational'))
    mc.add_state(MarkovState('dn', 'Down', 'failed'))
    mc.add_transition(MarkovTransition('up', 'dn', lam))
    mc.add_transition(MarkovTransition('dn', 'up', mu))
    return mc


def test_markov_steady_state_and_mut():
    mc = _repairable_chain(0.01, 0.5)
    pi = mc.steady_state()
    assert pi is not None
    assert pi[0] == pytest.approx(0.5 / 0.51)         # mu/(lambda+mu)
    # MUT = A/w_f = 1/lambda for the two-state chain; cycle = 1/λ + 1/μ.
    assert mc.mut() == pytest.approx(1 / 0.01)
    assert mc.mtbf() == pytest.approx(1 / 0.01 + 1 / 0.5)


def test_markov_absorbing_chain_limits_and_no_mtbf_swap():
    # A single absorbing class has a legitimate limiting distribution (all
    # mass in the absorbing state) — but mtbf() must be None (no cycles),
    # not silently swapped for the first-passage MTTF.
    mc = MarkovChain()
    mc.add_state(MarkovState('up', 'Up', 'operational'))
    mc.add_state(MarkovState('dn', 'Down', 'failed'))
    mc.add_transition(MarkovTransition('up', 'dn', 0.01))   # no repair
    pi = mc.steady_state()
    assert pi is not None and pi[1] == pytest.approx(1.0)
    assert mc.mtbf() is None
    assert mc.mut() is None


def test_markov_reducible_two_class_chain_returns_none():
    # Two disconnected closed classes → no unique stationary distribution.
    mc = MarkovChain()
    mc.add_state(MarkovState('a1', 'A1', 'operational'))
    mc.add_state(MarkovState('a2', 'A2', 'failed'))
    mc.add_state(MarkovState('b1', 'B1', 'operational'))
    mc.add_state(MarkovState('b2', 'B2', 'failed'))
    mc.add_transition(MarkovTransition('a1', 'a2', 0.1))
    mc.add_transition(MarkovTransition('a2', 'a1', 0.5))
    mc.add_transition(MarkovTransition('b1', 'b2', 0.2))
    mc.add_transition(MarkovTransition('b2', 'b1', 0.4))
    assert mc.steady_state() is None


# --- Hypothesis-test upgrades ---

def test_tukey_hsd_matches_studentized_range():
    rng = np.random.default_rng(25)
    groups = [list(rng.normal(m, 1, 12)) for m in (10, 10.5, 13)]
    r = one_way_anova(groups)
    assert r["posthoc_method"] == "Tukey HSD"
    row = r["pairwise_tukey"][0]     # groups 0 vs 1
    k, df_w = r["k"], r["df"]["within"]
    ms_w = r["ms_within"]
    se = math.sqrt(ms_w / 2 * (1 / 12 + 1 / 12))
    q = abs(row["mean_diff"]) / se
    assert row["p_value_tukey"] == pytest.approx(float(ss.studentized_range.sf(q, k, df_w)), rel=1e-6)


def test_chi_square_gof_ddof_and_warning():
    r = chi_square_gof([18, 22, 20, 25, 15], ddof=2)
    assert r["df"] == 2          # k-1-ddof = 5-1-2
    r2 = chi_square_gof([3, 4, 3])   # tiny expecteds
    assert r2["warning"] is not None


def test_cramers_v_from_uncorrected_chi2():
    table = [[10, 20], [30, 40]]
    r = chi_square_independence(table)
    chi2_unc, _, _, _ = ss.chi2_contingency(np.asarray(table), correction=False)
    v_exp = math.sqrt(chi2_unc / (100 * 1))
    assert r["effect_size"] == pytest.approx(v_exp)


def test_hedges_g_correction_factor():
    assert _hedges_g(1.0, 20) == pytest.approx(1 - 3 / 71)
    r = two_sample_t([1, 2, 3, 4], [3, 4, 5, 6])
    assert r["effect_size_name"] == "Hedges' g"
    assert abs(r["effect_size"]) < abs(r["cohens_d"])   # correction shrinks


def test_binomial_clopper_pearson_ci():
    r = binomial_test(42, 100)
    ci = ss.binomtest(42, 100, 0.5).proportion_ci(confidence_level=0.95, method="exact")
    assert r["ci_lower"] == pytest.approx(float(ci.low))
    assert r["ci_upper"] == pytest.approx(float(ci.high))


def test_nonparametric_effect_sizes():
    rng = np.random.default_rng(26)
    groups = [list(rng.normal(m, 1, 10)) for m in (0, 1, 3)]
    kw = kruskal_wallis(groups)
    n, k = 30, 3
    assert kw["effect_size"] == pytest.approx((kw["statistic"] - k + 1) / (n - k))
    fr = friedman([list(rng.normal(m, 1, 8)) for m in (0, 1, 3)])
    assert fr["effect_size"] == pytest.approx(fr["statistic"] / (8 * 2))


def test_factorial_omnibus_and_type2_unbalanced():
    # Unbalanced 2x2 with a strong A effect.
    response = [10, 11, 10.5, 20, 21, 20.5, 19.5, 10.2, 20.8]
    A = ['a1', 'a1', 'a1', 'a2', 'a2', 'a2', 'a2', 'a1', 'a2']
    B = ['b1', 'b2', 'b1', 'b1', 'b2', 'b1', 'b2', 'b2', 'b1']
    r = anova_factorial(response, {'A': A, 'B': B}, ['A', 'B'])
    assert "Type II" in r["balance_note"]
    # Top-level statistic is now the omnibus model F, and A is significant.
    assert r["statistic"] is not None and r["reject_null"]
    a_row = next(row for row in r["anova_table"] if row["source"] == 'A')
    assert a_row["significant"]


# --- DS guard (moved here since the mixture/DS upgrades landed in this wave) ---

def test_ds_unidentifiable_without_suspensions():
    with pytest.raises(ValueError):
        Fit_Weibull_DS(failures=[10, 20, 30, 40, 50])
