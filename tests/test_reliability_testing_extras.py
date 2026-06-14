"""Tests for the extended reliability testing functions."""

import numpy as np
import pytest
from reliability.Reliability_testing import (
    one_sample_proportion, two_proportion_test, sample_size_no_failures,
    sequential_sampling_chart, reliability_test_planner,
    reliability_test_duration, chi_squared_test, KS_test,
)
from reliability.Distributions import Weibull_Distribution, Normal_Distribution


def test_one_sample_proportion():
    r = one_sample_proportion(trials=20, successes=20)
    assert r['proportion'] == 1.0
    assert r['upper'] == 1.0
    assert 0 < r['lower'] < 1
    r2 = one_sample_proportion(trials=100, successes=95)
    assert r2['lower'] < 0.95 < r2['upper']


def test_two_proportion_test():
    # Clearly different proportions
    r = two_proportion_test(100, 90, 100, 60)
    assert r['different'] is True
    assert r['p_value'] < 0.05
    # Similar proportions
    r2 = two_proportion_test(100, 90, 100, 88)
    assert r2['different'] is False


def test_sample_size_no_failures():
    # Classic success-run: R=0.9, CI=0.9 -> n = ln(0.1)/ln(0.9) ~ 22
    r = sample_size_no_failures(reliability=0.9, CI=0.9)
    assert r['n'] == 22
    # Testing longer (more lifetimes) reduces required n
    r2 = sample_size_no_failures(reliability=0.9, CI=0.9, lifetimes=2, weibull_shape=2)
    assert r2['n'] < r['n']


def test_sequential_sampling_chart():
    r = sequential_sampling_chart(p1=0.01, p2=0.10, alpha=0.05, beta=0.10)
    assert r['slope'] > 0
    assert len(r['n']) == 100
    # Rejection line is always above acceptance line
    for a, rej in zip(r['acceptance_line'], r['rejection_line']):
        if a is not None:
            assert rej > a


def test_reliability_test_planner_solves_each():
    # Solve MTBF from duration + failures
    r = reliability_test_planner(test_duration=10000, number_of_failures=5, CI=0.9)
    assert r['MTBF'] > 0
    # Round-trip: solving duration from that MTBF + failures recovers duration
    r2 = reliability_test_planner(MTBF=r['MTBF'], number_of_failures=5, CI=0.9)
    assert np.isclose(r2['test_duration'], 10000, rtol=1e-6)
    # Solve number_of_failures
    r3 = reliability_test_planner(MTBF=500, test_duration=10000, CI=0.9)
    assert isinstance(r3['number_of_failures'], int)


def test_reliability_test_planner_validation():
    with pytest.raises(ValueError):
        reliability_test_planner(MTBF=500, CI=0.9)  # only one provided


def test_reliability_test_duration():
    r = reliability_test_duration(MTBF_required=100, MTBF_design=200,
                                  consumer_risk=0.1, producer_risk=0.1)
    assert r['test_duration'] > 0
    assert r['number_of_failures'] >= 0


def test_chi_squared_test_accepts_good_fit():
    data = Weibull_Distribution(eta=100, beta=2).random_samples(200, seed=0)
    dist = Weibull_Distribution(eta=100, beta=2)
    r = chi_squared_test(dist, data)
    assert r['hypothesis'] == 'accept'
    assert r['statistic'] >= 0


def test_chi_squared_test_rejects_bad_fit():
    data = Weibull_Distribution(eta=100, beta=2).random_samples(200, seed=1)
    wrong = Normal_Distribution(mu=500, sigma=10)
    r = chi_squared_test(wrong, data)
    assert r['hypothesis'] == 'reject'


def test_ks_test_accepts_good_fit():
    data = Weibull_Distribution(eta=100, beta=2).random_samples(200, seed=2)
    dist = Weibull_Distribution(eta=100, beta=2)
    r = KS_test(dist, data)
    assert r['hypothesis'] == 'accept'
    assert 0 <= r['statistic'] <= 1


def test_ks_test_rejects_bad_fit():
    data = Weibull_Distribution(eta=100, beta=2).random_samples(200, seed=3)
    wrong = Weibull_Distribution(eta=500, beta=2)
    r = KS_test(wrong, data)
    assert r['hypothesis'] == 'reject'
