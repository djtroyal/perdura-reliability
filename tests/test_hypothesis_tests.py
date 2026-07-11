"""Tests for Hypothesis_tests module."""
import math
import pytest
import numpy as np
from scipy import stats

from reliability.Hypothesis_tests import (
    one_sample_t,
    two_sample_t,
    paired_t,
    mann_whitney,
    wilcoxon_signed_rank,
    chi_square_gof,
    chi_square_independence,
    binomial_test,
    one_way_anova,
    kruskal_wallis,
    friedman,
    anova_factorial,
    repeated_measures_anova,
    mixed_anova,
)

RNG = np.random.default_rng(42)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def close(a, b, rel=1e-6):
    if a is None or b is None:
        return a == b
    return abs(a - b) <= rel * (abs(b) + 1e-12)


# ---------------------------------------------------------------------------
# 1. one_sample_t
# ---------------------------------------------------------------------------

class TestOneSampleT:
    def setup_method(self):
        self.data = RNG.normal(5, 2, 30).tolist()

    def test_matches_scipy(self):
        arr = np.asarray(self.data)
        res_scipy = stats.ttest_1samp(arr, 5.0)
        res = one_sample_t(self.data, popmean=5.0, alpha=0.05)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))
        assert res["df"] == len(self.data) - 1

    def test_cohens_d_sign(self):
        # Data with mean > popmean → positive d
        data = (RNG.normal(10, 1, 20)).tolist()
        res = one_sample_t(data, popmean=5.0)
        assert res["effect_size"] is not None
        assert res["effect_size"] > 0

    def test_reject_null_flag(self):
        # mean=100 vs popmean=0 → definitely reject
        data = RNG.normal(100, 1, 30).tolist()
        res = one_sample_t(data, popmean=0.0, alpha=0.05)
        assert res["reject_null"] is True

    def test_fail_to_reject(self):
        data = RNG.normal(0, 1, 10).tolist()
        res = one_sample_t(data, popmean=0.0, alpha=0.001)
        assert isinstance(res["reject_null"], bool)

    def test_alternative_less(self):
        res = stats.ttest_1samp(np.asarray(self.data), 5.0, alternative="less")
        r = one_sample_t(self.data, popmean=5.0, alternative="less")
        assert close(r["p_value"], float(res.pvalue))

    def test_raises_too_few(self):
        with pytest.raises(ValueError):
            one_sample_t([1.0], popmean=0.0)


# ---------------------------------------------------------------------------
# 2. two_sample_t
# ---------------------------------------------------------------------------

class TestTwoSampleT:
    def setup_method(self):
        self.a = RNG.normal(5, 2, 25).tolist()
        self.b = RNG.normal(7, 2, 25).tolist()

    def test_welch_matches_scipy(self):
        arr_a, arr_b = np.asarray(self.a), np.asarray(self.b)
        res_scipy = stats.ttest_ind(arr_a, arr_b, equal_var=False)
        res = two_sample_t(self.a, self.b, equal_var=False)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))

    def test_student_matches_scipy(self):
        arr_a, arr_b = np.asarray(self.a), np.asarray(self.b)
        res_scipy = stats.ttest_ind(arr_a, arr_b, equal_var=True)
        res = two_sample_t(self.a, self.b, equal_var=True)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))

    def test_effect_size_present(self):
        res = two_sample_t(self.a, self.b)
        assert res["effect_size"] is not None
        assert abs(res["effect_size"]) > 0

    def test_group_stats_present(self):
        res = two_sample_t(self.a, self.b)
        assert "mean_a" in res and "mean_b" in res
        assert "sd_a" in res and "sd_b" in res

    def test_raises_single_obs(self):
        with pytest.raises(ValueError):
            two_sample_t([1.0], [2.0, 3.0])


# ---------------------------------------------------------------------------
# 3. paired_t
# ---------------------------------------------------------------------------

class TestPairedT:
    def setup_method(self):
        base = RNG.normal(10, 2, 20)
        self.a = base.tolist()
        self.b = (base + RNG.normal(1, 0.5, 20)).tolist()

    def test_matches_scipy(self):
        arr_a, arr_b = np.asarray(self.a), np.asarray(self.b)
        res_scipy = stats.ttest_rel(arr_a, arr_b)
        res = paired_t(self.a, self.b)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))

    def test_raises_unequal_length(self):
        with pytest.raises(ValueError):
            paired_t([1, 2, 3], [1, 2])


# ---------------------------------------------------------------------------
# 4. mann_whitney
# ---------------------------------------------------------------------------

class TestMannWhitney:
    def setup_method(self):
        self.a = RNG.normal(0, 1, 20).tolist()
        self.b = RNG.normal(1, 1, 20).tolist()

    def test_matches_scipy(self):
        arr_a, arr_b = np.asarray(self.a), np.asarray(self.b)
        res_scipy = stats.mannwhitneyu(arr_a, arr_b, alternative="two-sided")
        res = mann_whitney(self.a, self.b)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))

    def test_rank_biserial_range(self):
        res = mann_whitney(self.a, self.b)
        assert res["effect_size"] is not None
        assert -1.0 <= res["effect_size"] <= 1.0

    def test_rank_biserial_direction_and_swap_invariance(self):
        high = [10, 11, 12]
        low = [1, 2, 3]
        forward = mann_whitney(high, low)
        reverse = mann_whitney(low, high)
        assert forward["effect_size"] == pytest.approx(1.0)
        assert reverse["effect_size"] == pytest.approx(-1.0)
        assert forward["effect_size"] == pytest.approx(-reverse["effect_size"])
        assert "group_a" in forward["effect_size_direction"]


# ---------------------------------------------------------------------------
# 5. wilcoxon_signed_rank
# ---------------------------------------------------------------------------

class TestWilcoxon:
    def setup_method(self):
        base = RNG.normal(5, 1, 15)
        self.a = base.tolist()
        self.b = (base + 0.5).tolist()

    def test_matches_scipy(self):
        arr_a, arr_b = np.asarray(self.a), np.asarray(self.b)
        res_scipy = stats.wilcoxon(arr_a, arr_b, alternative="two-sided")
        res = wilcoxon_signed_rank(self.a, self.b)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))

    def test_raises_unequal_length(self):
        with pytest.raises(ValueError):
            wilcoxon_signed_rank([1, 2], [1, 2, 3])


# ---------------------------------------------------------------------------
# 6. chi_square_gof
# ---------------------------------------------------------------------------

class TestChiSquareGOF:
    def test_uniform_expected(self):
        obs = [20, 18, 22, 19, 21]
        res_scipy = stats.chisquare(obs)
        res = chi_square_gof(obs)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))
        assert res["df"] == len(obs) - 1

    def test_with_expected(self):
        obs = [10, 20, 30]
        exp = [15, 15, 30]
        res_scipy = stats.chisquare(obs, f_exp=exp)
        res = chi_square_gof(obs, expected=exp)
        assert close(res["statistic"], float(res_scipy.statistic))

    def test_raises_too_few(self):
        with pytest.raises(ValueError):
            chi_square_gof([10])


# ---------------------------------------------------------------------------
# 7. chi_square_independence
# ---------------------------------------------------------------------------

class TestChiSquareIndependence:
    def test_matches_scipy(self):
        table = [[10, 20], [30, 40]]
        res_scipy = stats.chi2_contingency(table)
        res = chi_square_independence(table)
        assert close(res["statistic"], float(res_scipy.statistic))
        assert close(res["p_value"], float(res_scipy.pvalue))
        assert res["df"] == float(res_scipy.dof)

    def test_cramers_v_range(self):
        table = [[50, 10], [10, 50]]
        res = chi_square_independence(table)
        assert 0.0 <= res["effect_size"] <= 1.0

    def test_raises_wrong_ndim(self):
        with pytest.raises(ValueError):
            chi_square_independence([1, 2, 3])


# ---------------------------------------------------------------------------
# 8. binomial_test
# ---------------------------------------------------------------------------

class TestBinomialTest:
    def test_matches_scipy(self):
        res_scipy = stats.binomtest(8, 20, 0.5)
        res = binomial_test(8, 20, 0.5)
        assert close(res["p_value"], float(res_scipy.pvalue))

    def test_reject_null(self):
        # 19/20 successes vs p=0.5 → reject
        res = binomial_test(19, 20, 0.5, alpha=0.05)
        assert res["reject_null"] is True

    def test_raises_bad_inputs(self):
        with pytest.raises(ValueError):
            binomial_test(5, 0, 0.5)
        with pytest.raises(ValueError):
            binomial_test(25, 20, 0.5)


# ---------------------------------------------------------------------------
# 9. one_way_anova
# ---------------------------------------------------------------------------

class TestOneWayANOVA:
    def setup_method(self):
        self.g1 = RNG.normal(10, 2, 20).tolist()
        self.g2 = RNG.normal(12, 2, 20).tolist()
        self.g3 = RNG.normal(14, 2, 20).tolist()

    def test_f_equals_scipy(self):
        f_scipy, p_scipy = stats.f_oneway(
            np.asarray(self.g1), np.asarray(self.g2), np.asarray(self.g3)
        )
        res = one_way_anova([self.g1, self.g2, self.g3])
        assert close(res["statistic"], float(f_scipy))
        assert close(res["p_value"], float(p_scipy))

    def test_ss_decomposition(self):
        res = one_way_anova([self.g1, self.g2, self.g3])
        ss_bet = res["ss_between"]
        ss_wit = res["ss_within"]
        ss_tot = res["ss_total"]
        assert close(ss_bet + ss_wit, ss_tot, rel=1e-5)

    def test_eta_squared_range(self):
        res = one_way_anova([self.g1, self.g2, self.g3])
        assert 0.0 <= res["effect_size"] <= 1.0

    def test_pairwise_length(self):
        res = one_way_anova([self.g1, self.g2, self.g3])
        # 3 choose 2 = 3 pairs
        assert len(res["pairwise_bonferroni"]) == 3

    def test_raises_single_group(self):
        with pytest.raises(ValueError):
            one_way_anova([self.g1])


# ---------------------------------------------------------------------------
# 10. kruskal_wallis
# ---------------------------------------------------------------------------

class TestKruskalWallis:
    def test_matches_scipy(self):
        g1 = RNG.normal(0, 1, 15).tolist()
        g2 = RNG.normal(1, 1, 15).tolist()
        h_scipy, p_scipy = stats.kruskal(np.asarray(g1), np.asarray(g2))
        res = kruskal_wallis([g1, g2])
        assert close(res["statistic"], float(h_scipy))
        assert close(res["p_value"], float(p_scipy))


# ---------------------------------------------------------------------------
# 11. friedman
# ---------------------------------------------------------------------------

class TestFriedman:
    def test_matches_scipy(self):
        g1 = RNG.normal(0, 1, 10).tolist()
        g2 = RNG.normal(1, 1, 10).tolist()
        g3 = RNG.normal(2, 1, 10).tolist()
        chi2_scipy, p_scipy = stats.friedmanchisquare(
            np.asarray(g1), np.asarray(g2), np.asarray(g3)
        )
        res = friedman([g1, g2, g3])
        assert close(res["statistic"], float(chi2_scipy))
        assert close(res["p_value"], float(p_scipy))

    def test_raises_unequal_lengths(self):
        with pytest.raises(ValueError):
            friedman([[1, 2, 3], [1, 2]])


# ---------------------------------------------------------------------------
# 12. anova_factorial
# ---------------------------------------------------------------------------

class TestAnovaFactorial:
    def _balanced_2way_data(self):
        """Small balanced 2x2 design."""
        RNG2 = np.random.default_rng(99)
        response = []
        A_col = []
        B_col = []
        for a in ["a1", "a2"]:
            for b in ["b1", "b2"]:
                n = 5
                mu = (2 if a == "a2" else 0) + (3 if b == "b2" else 0)
                vals = RNG2.normal(mu, 1, n).tolist()
                response.extend(vals)
                A_col.extend([a] * n)
                B_col.extend([b] * n)
        return response, {"A": A_col, "B": B_col}

    def test_1way_f_matches_scipy(self):
        # One-way factorial ANOVA should match f_oneway
        g1 = RNG.normal(0, 1, 8).tolist()
        g2 = RNG.normal(2, 1, 8).tolist()
        response = g1 + g2
        factors = {"grp": ["g1"] * 8 + ["g2"] * 8}
        res = anova_factorial(response, factors, ["grp"])
        f_scipy, _ = stats.f_oneway(np.asarray(g1), np.asarray(g2))
        assert close(res["statistic"], float(f_scipy), rel=1e-4)

    def test_2way_ss_sum_to_total(self):
        response, factors = self._balanced_2way_data()
        res = anova_factorial(response, factors, ["A", "B"])
        table = res["anova_table"]
        total_row = [r for r in table if r["source"] == "Total"][0]
        residual_row = [r for r in table if r["source"] == "Residual"][0]
        factor_rows = [r for r in table if r["source"] not in ("Total", "Residual")]
        sum_ss = sum(r["SS"] for r in factor_rows) + residual_row["SS"]
        assert close(sum_ss, total_row["SS"], rel=1e-4)

    def test_2way_sensible_f(self):
        """B effect is large (mean diff=3), A effect is moderate (diff=2)."""
        response, factors = self._balanced_2way_data()
        res = anova_factorial(response, factors, ["A", "B"])
        b_row = next(r for r in res["anova_table"] if r["source"] == "B")
        assert b_row["F"] is not None and b_row["F"] > 1.0

    def test_3way_table_has_interaction(self):
        RNG3 = np.random.default_rng(7)
        n = 2
        response, A_col, B_col, C_col = [], [], [], []
        for a in ["a1", "a2"]:
            for b in ["b1", "b2"]:
                for c in ["c1", "c2"]:
                    vals = RNG3.normal(1, 0.5, n).tolist()
                    response.extend(vals)
                    A_col.extend([a] * n)
                    B_col.extend([b] * n)
                    C_col.extend([c] * n)
        res = anova_factorial(response, {"A": A_col, "B": B_col, "C": C_col}, ["A", "B", "C"])
        sources = [r["source"] for r in res["anova_table"]]
        assert "A:B:C" in sources
        assert "A:B" in sources
        assert "A:C" in sources
        assert "B:C" in sources

    def test_raises_bad_factor(self):
        with pytest.raises(ValueError):
            anova_factorial([1, 2], {"A": ["a", "b"]}, ["missing_factor"])


# ---------------------------------------------------------------------------
# 13. repeated_measures_anova
# ---------------------------------------------------------------------------

class TestRepeatedMeasuresANOVA:
    def test_basic_structure(self):
        # 10 subjects x 3 conditions
        mat = RNG.normal(0, 1, (10, 3)).tolist()
        res = repeated_measures_anova(mat)
        assert "anova_table" in res
        assert res["n_subjects"] == 10
        assert res["n_conditions"] == 3
        sources = [r["source"] for r in res["anova_table"]]
        assert "Conditions" in sources
        assert "Subjects" in sources
        assert "Error" in sources
        assert "Total" in sources

    def test_ss_decomposition(self):
        mat = RNG.normal(0, 1, (8, 4)).tolist()
        res = repeated_measures_anova(mat)
        table = {r["source"]: r for r in res["anova_table"]}
        parts = table["Conditions"]["SS"] + table["Subjects"]["SS"] + table["Error"]["SS"]
        total = table["Total"]["SS"]
        assert close(parts, total, rel=1e-5)

    def test_f_positive(self):
        # Conditions with real effect
        mat = np.column_stack([
            RNG.normal(0, 1, 20),
            RNG.normal(3, 1, 20),
            RNG.normal(6, 1, 20),
        ]).tolist()
        res = repeated_measures_anova(mat)
        assert res["statistic"] is not None and res["statistic"] > 0

    def test_sphericity_diagnostic_and_greenhouse_geisser_selection(self):
        rng = np.random.default_rng(808)
        # Strongly unequal contrast variances violate sphericity.
        mat = rng.normal(size=(80, 4)) * np.array([0.2, 1.0, 3.0, 8.0])
        res = repeated_measures_anova(mat.tolist())
        assert res["sphericity"]["reject_sphericity"] is True
        assert 1 / 3 <= res["sphericity"]["epsilon_greenhouse_geisser"] < 1
        assert res["inference_basis"] == "greenhouse_geisser"
        assert res["df"]["conditions"] < res["df_uncorrected"]["conditions"]

    def test_raises_wrong_shape(self):
        with pytest.raises(ValueError):
            repeated_measures_anova([[1, 2, 3]])  # only 1 subject


# ---------------------------------------------------------------------------
# 14. mixed_anova
# ---------------------------------------------------------------------------

class TestMixedANOVA:
    def _build_data(self):
        """Balanced 2 between-groups x 3 within-conditions, 5 subjects per group."""
        RNG_m = np.random.default_rng(123)
        values, subjects, between, within = [], [], [], []
        sid = 0
        for grp in ["ctrl", "treat"]:
            for _ in range(5):
                for cond in ["pre", "mid", "post"]:
                    mu = (2 if grp == "treat" else 0) + ({"pre": 0, "mid": 1, "post": 2}[cond])
                    values.append(float(RNG_m.normal(mu, 0.5)))
                    subjects.append(f"s{sid}")
                    between.append(grp)
                    within.append(cond)
                sid += 1
        return values, subjects, between, within

    def test_basic_keys(self):
        v, s, b, w = self._build_data()
        res = mixed_anova(v, s, b, w)
        assert "between_factor" in res
        assert "within_factor" in res
        assert "interaction" in res
        assert "anova_table" in res

    def test_f_values_positive(self):
        v, s, b, w = self._build_data()
        res = mixed_anova(v, s, b, w)
        assert res["between_factor"]["F"] is not None
        assert res["within_factor"]["F"] is not None
        assert res["within_factor"]["F"] > 0

    def test_reml_covariance_contract(self):
        v, s, b, w = self._build_data()
        res = mixed_anova(v, s, b, w)
        assert res["model"]["estimation"].startswith("REML")
        covariance = np.asarray(res["model"]["repeated_covariance"])
        assert covariance.shape == (3, 3)
        assert np.all(np.linalg.eigvalsh(covariance) > 0)
        assert res["between_factor"]["df_den"] == 8

    def test_unequal_group_sizes_use_reml_instead_of_approximate_ss(self):
        v, s, b, w = self._build_data()
        keep = [subject != "s0" for subject in s]
        res = mixed_anova(
            [value for value, use in zip(v, keep) if use],
            [subject for subject, use in zip(s, keep) if use],
            [group for group, use in zip(b, keep) if use],
            [condition for condition, use in zip(w, keep) if use],
        )
        assert "unequal subject counts handled" in res["balance_note"]
        assert sorted(res["model"]["group_sizes"].values()) == [4, 5]
        assert res["within_factor"]["p_value"] is not None
