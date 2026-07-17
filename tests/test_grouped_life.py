"""Mathematical validation for generalized grouped life-data likelihoods."""

import numpy as np
import pytest

from reliability.Distributions import (
    Beta_Distribution, Exponential_Distribution, Gamma_Distribution,
    Gumbel_Distribution, Loglogistic_Distribution, Lognormal_Distribution,
    Normal_Distribution, Weibull_Distribution,
)
from reliability.Fitters import _FITTER_MAP
from reliability.Grouped_life import (
    EXACT_FREQUENCY_DISTRIBUTIONS, INTERVAL_CENSORED_DISTRIBUTIONS,
    FrequencyObservation,
    IntervalObservation,
    fit_grouped_life,
    log_interval_probability,
    turnbull_estimate,
    weighted_rank_adjustment,
)


SAMPLE_DISTRIBUTIONS = {
    'Weibull_2P': Weibull_Distribution(eta=80, beta=2),
    'Weibull_3P': Weibull_Distribution(eta=80, beta=2, gamma=5),
    'Exponential_1P': Exponential_Distribution(Lambda=0.02),
    'Exponential_2P': Exponential_Distribution(Lambda=0.02, gamma=5),
    'Normal_2P': Normal_Distribution(mu=100, sigma=12),
    'Lognormal_2P': Lognormal_Distribution(mu=4, sigma=0.3),
    'Lognormal_3P': Lognormal_Distribution(mu=4, sigma=0.3, gamma=5),
    'Gamma_2P': Gamma_Distribution(alpha=3, beta=20),
    'Gamma_3P': Gamma_Distribution(alpha=3, beta=20, gamma=5),
    'Loglogistic_2P': Loglogistic_Distribution(alpha=80, beta=3),
    'Loglogistic_3P': Loglogistic_Distribution(alpha=80, beta=3, gamma=5),
    'Beta_2P': Beta_Distribution(alpha=2, beta=5),
    'Gumbel_2P': Gumbel_Distribution(mu=200, sigma=10),
}


@pytest.mark.parametrize('distribution', EXACT_FREQUENCY_DISTRIBUTIONS)
def test_exact_frequency_matches_expanded_mle(distribution):
    generated = np.asarray(
        SAMPLE_DISTRIBUTIONS[distribution].random_samples(
            32, seed=400 + list(EXACT_FREQUENCY_DISTRIBUTIONS).index(distribution)),
        dtype=float,
    )
    generated = np.round(generated, 5)
    expanded = np.repeat(generated, 2)
    times, counts = np.unique(expanded, return_counts=True)
    observations = [
        FrequencyObservation(float(time), 'F', int(count))
        for time, count in zip(times, counts)
    ]

    grouped = fit_grouped_life(
        'frequency_exact', observations, distribution, CI=0.95)
    standard = _FITTER_MAP[distribution](
        failures=expanded, method='MLE', show_probability_plot=False, CI=0.95)

    assert grouped.fit_eligible
    assert grouped.loglik == pytest.approx(float(standard.loglik), abs=2e-4)
    assert grouped.AICc == pytest.approx(float(standard.AICc), abs=5e-4)
    assert grouped.BIC == pytest.approx(float(standard.BIC), abs=5e-4)


def test_frequency_rows_and_duplicate_rows_are_likelihood_equivalent():
    grouped = [
        FrequencyObservation(10, 'F', 5),
        FrequencyObservation(20, 'F', 8),
        FrequencyObservation(30, 'S', 4),
    ]
    split = [
        FrequencyObservation(10, 'F', 2),
        FrequencyObservation(10, 'F', 3),
        FrequencyObservation(20, 'F', 3),
        FrequencyObservation(20, 'F', 5),
        FrequencyObservation(30, 'S', 4),
    ]
    first = fit_grouped_life('frequency_exact', grouped, 'Weibull_2P')
    second = fit_grouped_life('frequency_exact', split, 'Weibull_2P')
    assert first.loglik == pytest.approx(second.loglik, abs=1e-8)
    assert first.params['eta'] == pytest.approx(second.params['eta'], rel=1e-7)
    assert first.params['beta'] == pytest.approx(second.params['beta'], rel=1e-7)


def test_weighted_midrank_uses_counts_without_expansion():
    times, ranks, counts, n = weighted_rank_adjustment([
        FrequencyObservation(10, 'F', 5),
        FrequencyObservation(20, 'S', 3),
        FrequencyObservation(30, 'F', 2),
    ])
    assert times.tolist() == [10, 30]
    assert counts.tolist() == [5, 2]
    assert n == 10
    # These are the mean rank-adjusted orders of five expanded failures at 10
    # (orders 1..5) and two at 30 (orders 7 and 9 after three suspensions).
    assert ranks.tolist() == pytest.approx([3.0, 8.0])


def test_stable_interval_probability_matches_direct_probability():
    frozen = Weibull_Distribution(eta=100, beta=2)._scipy
    lower = np.array([0.0, 50.0, 100.0])
    upper = np.array([50.0, 100.0, 150.0])
    expected = np.log(frozen.cdf(upper) - frozen.cdf(lower))
    assert log_interval_probability(frozen, lower, upper) == pytest.approx(expected)


def test_interval_weibull_recovers_seeded_parameters_from_inspection_counts():
    rng = np.random.default_rng(611)
    lives = 120 * rng.weibull(2.2, 1200)
    censor_time = 200.0
    edges = np.arange(0.0, censor_time + 20.0, 20.0)
    observations = []
    for lower, upper in zip(edges[:-1], edges[1:]):
        count = int(np.sum((lives > lower) & (lives <= upper)))
        if count:
            observations.append(IntervalObservation(lower, upper, count))
    survivors = int(np.sum(lives > censor_time))
    if survivors:
        observations.append(IntervalObservation(censor_time, None, survivors))

    fit = fit_grouped_life(
        'interval_censored', observations, 'Weibull_2P', CI=0.95)

    assert fit.fit_eligible
    assert fit.params['eta'] == pytest.approx(120, rel=0.08)
    assert fit.params['beta'] == pytest.approx(2.2, rel=0.12)
    assert fit.AD is None


@pytest.mark.parametrize('distribution', INTERVAL_CENSORED_DISTRIBUTIONS)
def test_interval_counts_are_likelihood_weights_for_every_supported_family(distribution):
    if distribution == 'Beta_2P':
        grouped = [
            IntervalObservation(None, 0.2, 3),
            IntervalObservation(0.2, 0.5, 6),
            IntervalObservation(0.5, 0.8, 4),
            IntervalObservation(0.8, None, 2),
        ]
    else:
        grouped = [
            IntervalObservation(None, 10, 3),
            IntervalObservation(10, 20, 6),
            IntervalObservation(20, 40, 4),
            IntervalObservation(40, None, 2),
        ]
    split = []
    for row in grouped:
        first = row.count // 2
        if first:
            split.append(IntervalObservation(row.lower, row.upper, first))
        split.append(IntervalObservation(row.lower, row.upper, row.count - first))

    combined_fit = fit_grouped_life(
        'interval_censored', grouped, distribution)
    split_fit = fit_grouped_life(
        'interval_censored', split, distribution)

    assert combined_fit.fit_eligible
    assert split_fit.fit_eligible
    assert combined_fit.n == split_fit.n == 15
    assert combined_fit.loglik == pytest.approx(split_fit.loglik, abs=1e-7)
    for parameter in combined_fit.params:
        if parameter.endswith(('_se', '_lower', '_upper')):
            continue
        assert combined_fit.params[parameter] == pytest.approx(
            split_fit.params[parameter], rel=1e-7, abs=1e-8)


def test_interval_threshold_family_and_beta_support_are_validated():
    observations = [
        IntervalObservation(0, 0.5, 5),
        IntervalObservation(0.5, 1.0, 5),
    ]
    with pytest.raises(ValueError, match='weakly identified'):
        fit_grouped_life('interval_censored', observations, 'Weibull_3P')
    with pytest.raises(ValueError, match=r'within \[0, 1\]'):
        fit_grouped_life(
            'interval_censored',
            [IntervalObservation(0, 2, 5), IntervalObservation(2, 3, 5)],
            'Beta_2P',
        )


def test_turnbull_estimate_preserves_interval_counts_and_tail_mass():
    estimate = turnbull_estimate([
        IntervalObservation(None, 10, 3),
        IntervalObservation(10, 20, 4),
        IntervalObservation(20, None, 2),
    ])
    assert estimate['converged']
    assert estimate['time'] == [10.0, 20.0]
    assert estimate['cdf'] == pytest.approx([3 / 9, 7 / 9])
    assert estimate['tail_mass'] == pytest.approx(2 / 9)
