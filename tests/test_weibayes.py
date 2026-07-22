"""Tests for the Weibayes (Bayesian Weibull) fitter."""

import numpy as np
import pytest
from scipy.stats import chi2

from reliability.Bayesian import weibayes_fit


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sum_tb(times, beta):
    return sum(t ** beta for t in times)


@pytest.fixture(scope="class")
def standard_result():
    return weibayes_fit(
        [100.0, 150.0, 200.0, 250.0, 300.0, 175.0, 225.0],
        ["F"] * 5 + ["S"] * 2,
        beta=2.5,
        CI=0.95,
    )


@pytest.fixture(scope="class")
def zero_failure_result():
    return weibayes_fit(
        [500.0, 600.0, 700.0],
        ["S", "S", "S"],
        beta=1.5,
        CI=0.90,
    )


@pytest.fixture(scope="class")
def curve_result():
    return weibayes_fit(
        [100.0, 150.0, 200.0, 250.0, 300.0, 175.0, 225.0],
        ["F"] * 5 + ["S"] * 2,
        beta=2.5,
        CI=0.95,
    )


@pytest.fixture(scope="class")
def zero_failure_curve_result():
    return weibayes_fit(
        [500.0, 600.0, 700.0], ["S", "S", "S"], beta=1.5, CI=0.90)


# ── Standard case (r > 0) ────────────────────────────────────────────────────

class TestStandardCase:
    """Weibayes with observed failures and suspensions."""

    failures = [100.0, 150.0, 200.0, 250.0, 300.0]
    suspensions = [175.0, 225.0]
    all_times = failures + suspensions
    all_states = ["F"] * 5 + ["S"] * 2
    beta = 2.5
    CI = 0.95

    def test_r_equals_five(self, standard_result):
        assert standard_result["r"] == 5

    def test_sum_tb(self, standard_result):
        expected_sum_tb = _sum_tb(self.all_times, self.beta)
        assert abs(standard_result["sum_tb"] - expected_sum_tb) / expected_sum_tb < 1e-9

    def test_eta_point_estimate(self, standard_result):
        expected_sum_tb = _sum_tb(self.all_times, self.beta)
        eta_expected = (expected_sum_tb / 5) ** (1.0 / self.beta)
        assert standard_result["eta"] is not None
        rel_err = abs(standard_result["eta"] - eta_expected) / eta_expected
        assert rel_err < 1e-3, f"eta relative error {rel_err:.2e} exceeds 0.1%"

    def test_zero_failure_flag(self, standard_result):
        assert standard_result["zero_failure"] is False

    def test_ci_ordering(self, standard_result):
        """Lower CI bound < point estimate < upper CI bound."""
        assert standard_result["eta_lower"] < standard_result["eta"] < standard_result["eta_upper"], (
            f"Expected eta_lower={standard_result['eta_lower']:.4f} < "
            f"eta={standard_result['eta']:.4f} < "
            f"eta_upper={standard_result['eta_upper']:.4f}"
        )

    def test_beta_stored(self, standard_result):
        assert standard_result["beta"] == self.beta

    def test_ci_stored(self, standard_result):
        assert standard_result["CI"] == self.CI

    def test_eta_lower_formula(self, standard_result):
        """Verify eta_lower against manual chi2 calculation (two-sided:
        alpha/2 in each tail, per the rigor pass)."""
        sum_tb = _sum_tb(self.all_times, self.beta)
        r = 5
        alpha_tail = (1.0 - self.CI) / 2.0
        chi2_lower = chi2.ppf(1.0 - alpha_tail, df=2 * (r + 1))
        eta_lower_expected = (2.0 * sum_tb / chi2_lower) ** (1.0 / self.beta)
        rel_err = abs(standard_result["eta_lower"] - eta_lower_expected) / eta_lower_expected
        assert rel_err < 1e-9

    def test_eta_upper_formula(self, standard_result):
        """Verify eta_upper against manual chi2 calculation (two-sided:
        alpha/2 in each tail, per the rigor pass)."""
        sum_tb = _sum_tb(self.all_times, self.beta)
        r = 5
        alpha_tail = (1.0 - self.CI) / 2.0
        chi2_upper = chi2.ppf(alpha_tail, df=2 * r)
        eta_upper_expected = (2.0 * sum_tb / chi2_upper) ** (1.0 / self.beta)
        rel_err = abs(standard_result["eta_upper"] - eta_upper_expected) / eta_upper_expected
        assert rel_err < 1e-9


# ── Zero-failure case (r == 0) ───────────────────────────────────────────────

class TestZeroFailureCase:
    """Weibayes with no failures — conservative bound only."""

    suspensions = [500.0, 600.0, 700.0]
    states = ["S", "S", "S"]
    beta = 1.5
    CI = 0.90

    def test_eta_is_none(self, zero_failure_result):
        assert zero_failure_result["eta"] is None

    def test_zero_failure_flag(self, zero_failure_result):
        assert zero_failure_result["zero_failure"] is True

    def test_r_is_zero(self, zero_failure_result):
        assert zero_failure_result["r"] == 0

    def test_eta_lower_positive(self, zero_failure_result):
        assert zero_failure_result["eta_lower"] is not None
        assert zero_failure_result["eta_lower"] > 0

    def test_eta_upper_is_none(self, zero_failure_result):
        assert zero_failure_result["eta_upper"] is None

    def test_eta_lower_formula(self, zero_failure_result):
        """Verify eta_lower (conservative bound) against manual calculation."""
        sum_tb = _sum_tb(self.suspensions, self.beta)
        chi2_val = chi2.ppf(self.CI, df=2)
        eta_expected = (sum_tb / (chi2_val / 2.0)) ** (1.0 / self.beta)
        assert zero_failure_result["eta_lower"] is not None
        rel_err = abs(zero_failure_result["eta_lower"] - eta_expected) / eta_expected
        assert rel_err < 1e-3, f"eta_lower relative error {rel_err:.2e} exceeds 0.1%"


# ── Curve generation ─────────────────────────────────────────────────────────

class TestCurves:
    """Verify the curves dict is complete and internally consistent."""

    def test_curve_keys_present(self, curve_result):
        expected_keys = {"x", "sf", "cdf", "pdf", "hf", "sf_lower", "sf_upper"}
        assert expected_keys.issubset(curve_result["curves"].keys())

    def test_curve_lengths(self, curve_result):
        curves = curve_result["curves"]
        n = len(curves["x"])
        assert n == 300
        for key in ("sf", "cdf", "pdf", "hf", "sf_lower", "sf_upper"):
            assert len(curves[key]) == 300, f"curves['{key}'] has wrong length"

    def test_sf_bounded(self, curve_result):
        sf = np.array(curve_result["curves"]["sf"])
        assert np.all(sf >= 0.0) and np.all(sf <= 1.0)

    def test_cdf_is_complement_of_sf(self, curve_result):
        sf = np.array(curve_result["curves"]["sf"])
        cdf = np.array(curve_result["curves"]["cdf"])
        assert np.allclose(sf + cdf, 1.0, atol=1e-12)

    def test_sf_monotone_decreasing(self, curve_result):
        sf = np.array(curve_result["curves"]["sf"])
        assert np.all(np.diff(sf) <= 1e-9), "SF should be non-increasing"

    def test_pdf_non_negative(self, curve_result):
        pdf = np.array(curve_result["curves"]["pdf"])
        assert np.all(pdf >= 0.0)

    def test_hf_non_negative(self, curve_result):
        hf = np.array(curve_result["curves"]["hf"])
        assert np.all(hf >= 0.0)

    def test_x_range(self, curve_result):
        """x should span from 0.5 * min_time to 1.5 * max_time."""
        x = np.array(curve_result["curves"]["x"])
        times = [100.0, 150.0, 200.0, 250.0, 300.0, 175.0, 225.0]
        assert abs(x[0] - min(times) * 0.5) < 1e-6
        assert abs(x[-1] - max(times) * 1.5) < 1e-6

    def test_sf_lower_bounded(self, curve_result):
        sf_lower = np.array(curve_result["curves"]["sf_lower"])
        assert np.all(sf_lower >= 0.0) and np.all(sf_lower <= 1.0)

    def test_sf_upper_bounded(self, curve_result):
        sf_upper = np.array(curve_result["curves"]["sf_upper"])
        assert np.all(sf_upper >= 0.0) and np.all(sf_upper <= 1.0)

    def test_ci_band_ordering(self, curve_result):
        """Bounds are named by their survival ordinate."""
        sf_central = np.array(curve_result["curves"]["sf"])
        sf_upper = np.array(curve_result["curves"]["sf_upper"])
        sf_lower = np.array(curve_result["curves"]["sf_lower"])
        assert np.all(sf_lower <= sf_central + 1e-9)
        assert np.all(sf_central <= sf_upper + 1e-9)
        assert "sf_legacy_lower_was_optimistic" not in curve_result["curves"]
        assert "sf_legacy_upper_was_conservative" not in curve_result["curves"]
        assert "response_contract_version" not in curve_result
        assert "migration_note" not in curve_result


# ── Zero-failure curve generation ────────────────────────────────────────────

class TestZeroFailureCurves:
    """Curves should still be generated for the zero-failure case."""

    def test_curves_present(self, zero_failure_curve_result):
        assert "curves" in zero_failure_curve_result

    def test_curve_length(self, zero_failure_curve_result):
        assert len(zero_failure_curve_result["curves"]["x"]) == 300

    def test_sf_bounded(self, zero_failure_curve_result):
        sf = np.array(zero_failure_curve_result["curves"]["sf"])
        assert np.all(sf >= 0.0) and np.all(sf <= 1.0)

    def test_sf_upper_present(self, zero_failure_curve_result):
        # A zero-failure study has only a lower reliability bound; no upper
        # finite confidence curve is identified.
        sf_upper = zero_failure_curve_result["curves"]["sf_upper"]
        assert sf_upper is not None
        assert len(sf_upper) == 300
        assert all(value is None for value in sf_upper)


# ── Input validation ─────────────────────────────────────────────────────────

class TestInputValidation:
    def test_mismatched_lengths(self):
        with pytest.raises(ValueError, match="same length"):
            weibayes_fit([100, 200], ["F"], beta=2.0)

    def test_non_positive_time(self):
        with pytest.raises(ValueError, match="strictly positive"):
            weibayes_fit([0, 100], ["F", "S"], beta=2.0)

    def test_invalid_ci(self):
        with pytest.raises(ValueError, match="CI must"):
            weibayes_fit([100], ["F"], beta=2.0, CI=1.5)
