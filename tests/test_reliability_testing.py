"""Tests for Reliability_testing (binomial RDT sample-size planning)."""

import numpy as np
import pytest
from scipy import stats as ss

from reliability.Reliability_testing import (
    sample_size_binomial, weibull_eta_from_requirement,
    parametric_binomial_sample_size, parametric_binomial_test_time,
    binomial_oc_curve,
)


class TestSampleSizeBinomial:
    def test_textbook_zero_failure_values(self):
        # n = ceil(ln(1-C)/ln(R)) — classic success-run values
        assert sample_size_binomial(0.90, CI=0.90, failures=0) == 22
        assert sample_size_binomial(0.95, CI=0.95, failures=0) == 59
        assert sample_size_binomial(0.99, CI=0.95, failures=0) == 299

    def test_one_failure_known_value(self):
        # R=0.9, C=0.9, f=1 -> 38 (binomial sum at 38 is 0.0952 <= 0.1; 37 fails)
        assert sample_size_binomial(0.90, CI=0.90, failures=1) == 38

    def test_constraint_holds_at_n_and_fails_below(self):
        for f in (0, 1, 2, 5):
            n = sample_size_binomial(0.85, CI=0.92, failures=f)
            q = 0.15
            assert ss.binom.cdf(f, n, q) <= 1 - 0.92 + 1e-12
            assert ss.binom.cdf(f, n - 1, q) > 1 - 0.92

    def test_more_failures_needs_more_samples(self):
        ns = [sample_size_binomial(0.9, CI=0.9, failures=f) for f in range(5)]
        assert all(b > a for a, b in zip(ns, ns[1:]))

    def test_validation(self):
        with pytest.raises(ValueError):
            sample_size_binomial(1.0, CI=0.9)
        with pytest.raises(ValueError):
            sample_size_binomial(0.9, CI=0.0)
        with pytest.raises(ValueError):
            sample_size_binomial(0.9, failures=-1)
        with pytest.raises(ValueError):
            sample_size_binomial(0.9, failures=1.5)


class TestWeibullEta:
    def test_known_eta(self):
        # eta = T / (-ln R)^(1/beta): 2000 / sqrt(-ln 0.8) = 4233.85...
        eta = weibull_eta_from_requirement(0.8, 2000, 2.0)
        assert eta == pytest.approx(4233.85, rel=1e-4)

    def test_reliability_recovered_at_mission_time(self):
        eta = weibull_eta_from_requirement(0.8, 2000, 2.0)
        assert np.exp(-(2000 / eta) ** 2.0) == pytest.approx(0.8, rel=1e-12)

    def test_validation(self):
        with pytest.raises(ValueError):
            weibull_eta_from_requirement(0.8, -5, 2.0)
        with pytest.raises(ValueError):
            weibull_eta_from_requirement(0.8, 2000, 0)


class TestParametricSampleSize:
    def test_reference_worked_example(self):
        # Reliability Analytics Toolkit defaults: R=0.8 @ 2000 h, beta=2,
        # C=90%, T_test=1500 h  ->  R_test ~ 0.8820, n = 19
        out = parametric_binomial_sample_size(
            R_rqmt=0.8, T_mission=2000, beta=2.0, T_test=1500,
            CI=0.90, failures=0)
        assert out['eta'] == pytest.approx(4233.85, rel=1e-4)
        assert out['R_test'] == pytest.approx(0.8820, abs=2e-4)
        assert out['n'] == 19

    def test_longer_test_needs_fewer_samples(self):
        short = parametric_binomial_sample_size(0.8, 2000, 2.0, 1000, CI=0.9)
        long = parametric_binomial_sample_size(0.8, 2000, 2.0, 3000, CI=0.9)
        assert long['n'] < short['n']

    def test_test_at_mission_time_matches_method1(self):
        # T_test == T_mission -> R_test == R_rqmt -> n equals Method 1
        out = parametric_binomial_sample_size(0.9, 1000, 1.7, 1000, CI=0.9)
        assert out['R_test'] == pytest.approx(0.9, rel=1e-12)
        assert out['n'] == sample_size_binomial(0.9, CI=0.9)


class TestParametricTestTime:
    def test_zero_failure_closed_form(self):
        # f=0: R_test = (1-C)^(1/n)
        out = parametric_binomial_test_time(0.8, 2000, 2.0, n=19, CI=0.90)
        assert out['R_test'] == pytest.approx(0.1 ** (1 / 19), rel=1e-10)
        assert out['T_test'] == pytest.approx(1473.7, rel=1e-3)

    def test_round_trip_with_method_2a(self):
        # 2A with T_test=1500 gives n=19; 2B with n=19 must require <= 1500 h
        out_a = parametric_binomial_sample_size(0.8, 2000, 2.0, 1500, CI=0.9)
        out_b = parametric_binomial_test_time(0.8, 2000, 2.0, out_a['n'], CI=0.9)
        assert out_b['T_test'] <= 1500 + 1e-9
        # And one fewer sample would need more time than is available
        out_b18 = parametric_binomial_test_time(0.8, 2000, 2.0, out_a['n'] - 1, CI=0.9)
        assert out_b18['T_test'] > 1500

    def test_more_samples_less_time(self):
        t = [parametric_binomial_test_time(0.85, 500, 1.5, n, CI=0.9)['T_test']
             for n in (10, 20, 40)]
        assert t[0] > t[1] > t[2]

    def test_validation(self):
        with pytest.raises(ValueError):
            parametric_binomial_test_time(0.8, 2000, 2.0, n=2, failures=2)
        with pytest.raises(ValueError):
            parametric_binomial_test_time(0.8, 2000, 2.0, n=10, CI=1.0)


class TestOCCurve:
    def test_monotone_increasing_in_reliability(self):
        R, P = binomial_oc_curve(n=22, failures=0)
        assert np.all(np.diff(P) >= -1e-12)
        assert P[-1] == pytest.approx(1.0)

    def test_p_accept_at_demonstrated_R_is_alpha(self):
        # At the demonstrated reliability the pass probability equals 1-C
        n = sample_size_binomial(0.9, CI=0.9, failures=2)
        R, P = binomial_oc_curve(n=n, failures=2, R_values=np.array([0.9]))
        assert P[0] <= 0.10 + 1e-9
        # ...and only just (n is the smallest such sample size)
        _, P_prev = binomial_oc_curve(n=n - 1, failures=2, R_values=np.array([0.9]))
        assert P_prev[0] > 0.10

    def test_custom_r_values_passthrough(self):
        Rv = np.array([0.7, 0.8, 0.9])
        R, P = binomial_oc_curve(n=30, failures=1, R_values=Rv)
        np.testing.assert_array_equal(R, Rv)
        expected = ss.binom.cdf(1, 30, 1 - Rv)
        np.testing.assert_allclose(P, expected, rtol=1e-12)

    def test_validation(self):
        with pytest.raises(ValueError):
            binomial_oc_curve(n=2, failures=2)
