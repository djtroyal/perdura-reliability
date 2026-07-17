"""Tests for reliability.Repairable_systems (Crow-AMSAA and Duane)."""

import warnings

import numpy as np
import pytest
from reliability.Repairable_systems import CrowAMSAA, CrowAMSAAGrouped, Duane


TIMES = [2.7, 10.3, 12.5, 30.6, 57.0, 61.3, 80.0, 109.5, 125.0, 128.6,
         143.8, 167.9, 229.2, 296.7, 320.6, 328.2, 366.2, 396.8, 421.4,
         438.2, 501.2, 620.0]


# --- Crow-AMSAA, failure-terminated ---

def test_crow_amsaa_failure_terminated_beta_lambda():
    model = CrowAMSAA(times=TIMES)
    times = np.asarray(TIMES)
    n = len(times)
    T = times[-1]

    # independent computation of the MLEs
    beta_expected = n / np.sum(np.log(T / times[:-1]))
    lambda_expected = n / T ** beta_expected

    assert model.failure_terminated is True
    assert model.n == n
    assert model.T == T
    assert model.beta == pytest.approx(beta_expected, rel=1e-12)
    assert model.Lambda == pytest.approx(lambda_expected, rel=1e-12)
    assert model.growth_rate == pytest.approx(1 - beta_expected, rel=1e-12)


def test_crow_amsaa_expected_failures_at_T_equals_n():
    model = CrowAMSAA(times=TIMES)
    # by construction lambda = n / T^beta, so N(T) = n exactly
    assert model.expected_failures(model.T) == pytest.approx(model.n, rel=1e-12)


def test_crow_amsaa_mtbf_relationships():
    model = CrowAMSAA(times=TIMES)
    T = model.T
    assert model.cumulative_MTBF == pytest.approx(
        T / model.expected_failures(T), rel=1e-12)
    assert model.instantaneous_MTBF == pytest.approx(
        model.cumulative_MTBF / model.beta, rel=1e-12)
    assert model.instantaneous_failure_intensity == pytest.approx(
        1 / model.instantaneous_MTBF, rel=1e-12)
    # CvM statistic is computed and positive
    assert model.CvM > 0


def test_crow_amsaa_methods_accept_arrays():
    model = CrowAMSAA(times=TIMES)
    t = np.array([100.0, 300.0, 620.0])
    nf = model.expected_failures(t)
    mc = model.MTBF_cumulative(t)
    mi = model.MTBF_instantaneous(t)
    assert nf.shape == mc.shape == mi.shape == (3,)
    assert isinstance(model.expected_failures(100.0), float)
    # beta < 1 (reliability growth) so instantaneous MTBF > cumulative MTBF
    assert model.beta < 1
    assert np.all(mi > mc)


def test_crow_amsaa_results_dataframe():
    model = CrowAMSAA(times=TIMES)
    assert set(['Parameter', 'Value']) == set(model.results.columns)
    assert 'Beta' in model.results['Parameter'].tolist()
    assert 'CrowAMSAA' in repr(model)


# --- Crow-AMSAA, time-terminated ---

def test_crow_amsaa_time_terminated():
    model = CrowAMSAA(times=TIMES, T=700)
    times = np.asarray(TIMES)
    n = len(times)
    beta_expected = n / np.sum(np.log(700 / times))
    lambda_expected = n / 700 ** beta_expected

    assert model.failure_terminated is False
    assert model.T == 700
    assert model.beta == pytest.approx(beta_expected, rel=1e-12)
    assert model.Lambda == pytest.approx(lambda_expected, rel=1e-12)
    # extending the test time without new failures lowers beta vs the
    # failure-terminated estimate
    ft = CrowAMSAA(times=TIMES)
    assert model.beta != pytest.approx(ft.beta)
    assert model.beta < ft.beta
    assert model.expected_failures(700) == pytest.approx(n, rel=1e-12)


def test_crow_amsaa_supplied_equal_endpoint_does_not_guess_termination():
    time_stopped = CrowAMSAA(times=TIMES, T=TIMES[-1])
    failure_stopped = CrowAMSAA(times=TIMES)

    assert time_stopped.termination == 'time_terminated'
    assert failure_stopped.termination == 'failure_terminated'
    assert time_stopped.beta_interval_df == 2 * len(TIMES)
    assert failure_stopped.beta_interval_df == 2 * (len(TIMES) - 1)


def test_crow_amsaa_mil_benchmark_accepts_reported_tie():
    # MIL-HDBK-189 (1981) Appendix C individual-failure-time example (two
    # failures share a reported accumulated time because the source is rounded).
    times = [
        2.6, 16.5, 16.5, 17.0, 21.4, 29.1, 33.3, 56.5, 63.1,
        70.6, 73.0, 77.7, 93.9, 95.5, 98.1, 101.1, 132.0, 142.2,
        147.7, 149.0, 167.2, 190.7, 193.0, 198.7, 251.9, 282.5, 286.1,
    ]
    fit = CrowAMSAA(times, T=300, failure_terminated=False)

    assert fit.has_tied_times is True
    assert fit.beta_mle == pytest.approx(0.7163392623659983)
    assert fit.beta_bias_corrected == pytest.approx(0.689808178574665)
    assert fit.Lambda_mle == pytest.approx(0.45384186137267435)
    assert fit.instantaneous_failure_intensity == pytest.approx(
        0.06447053361293985)
    assert fit.instantaneous_MTBF == pytest.approx(15.510962046687489)
    assert fit.CvM == pytest.approx(0.09106112238623132)


def test_crow_amsaa_modified_mle_matches_nist_benchmark():
    times = [5, 40, 43, 175, 389, 712, 747, 795, 1299, 1478]
    fit = CrowAMSAA(
        times, T=1500, failure_terminated=False, estimator='modified_mle')

    assert fit.estimator == 'modified_mle'
    assert fit.beta_mle == pytest.approx(0.5372288660341876)
    assert fit.beta == pytest.approx(0.4835059794307689)
    # Lambda is recomputed from the unrounded modified beta, rather than from
    # the rounded values printed in the reference example.
    assert fit.Lambda == pytest.approx(0.2913002685663817)
    assert fit.instantaneous_MTBF == pytest.approx(310.234, rel=2e-5)


@pytest.mark.parametrize('failure_terminated', [False, True])
def test_crow_amsaa_exact_intervals_keep_raw_mle_reference_when_modified_selected(
        failure_terminated):
    times = [2.0, 5.0, 9.0, 15.0, 24.0, 40.0]
    T = times[-1] if failure_terminated else 50.0
    raw = CrowAMSAA(
        times, T=T, failure_terminated=failure_terminated,
        estimator='mle', CI=.90)
    modified = CrowAMSAA(
        times, T=T, failure_terminated=failure_terminated,
        estimator='modified_mle', CI=.90)

    assert modified.beta != raw.beta
    assert modified.instantaneous_MTBF != raw.instantaneous_MTBF
    assert modified.beta_lower == pytest.approx(raw.beta_lower)
    assert modified.beta_upper == pytest.approx(raw.beta_upper)
    assert modified.instantaneous_MTBF_lower == pytest.approx(
        raw.instantaneous_MTBF_lower)
    assert modified.instantaneous_MTBF_upper == pytest.approx(
        raw.instantaneous_MTBF_upper)
    assert modified.interval_reference_estimator == 'mle'
    assert modified.beta_interval_reference_estimate == pytest.approx(
        modified.beta_mle)
    assert modified.instantaneous_MTBF_interval_reference_estimate == (
        pytest.approx(modified.instantaneous_MTBF_mle))


def test_crow_amsaa_failure_cvm_uses_termination_correct_unbiasing():
    fit = CrowAMSAA(TIMES)
    n = len(TIMES)
    corrected = (n - 2) / n * fit.beta_mle
    transformed = (np.asarray(TIMES[:-1]) / fit.T) ** corrected
    m = n - 1
    i = np.arange(1, m + 1)
    expected = 1 / (12 * m) + np.sum(
        (transformed - (2 * i - 1) / (2 * m)) ** 2)

    assert fit.cvm_beta == pytest.approx(corrected)
    assert fit.CvM == pytest.approx(expected)
    assert CrowAMSAA([1, 2]).cvm_available is False
    assert CrowAMSAA([1, 2]).CvM is None


def test_crow_amsaa_exact_failure_terminated_mtbf_interval_factors():
    # Handbook factor check (n=26, two-sided 95%).
    times = np.geomspace(1, 1000, 26)
    fit = CrowAMSAA(times)
    assert (fit.instantaneous_MTBF_lower / fit.instantaneous_MTBF_mle
            == pytest.approx(0.6333100346074767, rel=2e-10))
    assert (fit.instantaneous_MTBF_upper / fit.instantaneous_MTBF_mle
            == pytest.approx(1.919328277802955, rel=2e-10))
    assert fit.instantaneous_MTBF_interval_status == 'exact'
    assert 'gamma_product' in fit.instantaneous_MTBF_interval_method


def test_crow_amsaa_time_terminated_mtbf_factors_match_crow_table():
    # NASA TM-103511 Table 1B / Crow time-terminated coefficients:
    # n=23 and 80% two-sided confidence gives L=.6762 and U=1.5744.
    times = [
        .2, 4.2, 4.5, 5.0, 5.4, 6.1, 7.9, 14.8, 19.2, 48.6,
        85.8, 108.9, 127.2, 129.8, 150.1, 159.7, 227.4, 244.7,
        262.7, 315.3, 329.6, 404.3, 486.2,
    ]
    fit = CrowAMSAA(
        times, T=500.0, failure_terminated=False, CI=0.80)

    assert (fit.instantaneous_MTBF_lower / fit.instantaneous_MTBF_mle
            == pytest.approx(0.6761942617196254))
    assert (fit.instantaneous_MTBF_upper / fit.instantaneous_MTBF_mle
            == pytest.approx(1.5744289897315853))
    # The published worked example rounds the point estimate and bounds to
    # 52.7 and [35.6, 82.9], respectively.
    assert fit.instantaneous_MTBF_lower == pytest.approx(35.6, abs=0.05)
    assert fit.instantaneous_MTBF_upper == pytest.approx(82.9, abs=0.05)
    assert fit.instantaneous_MTBF_interval_status.startswith(
        'exact_conservative')
    assert 'bessel_poisson' in fit.instantaneous_MTBF_interval_method


def test_crow_amsaa_second_nasa_time_coefficient_fixture():
    # NASA TM-103511 Table 1C: n=27, two-sided 90% coefficients.
    fit = CrowAMSAA(
        np.geomspace(1.0, 900.0, 27), T=1000.0,
        failure_terminated=False, CI=.90)

    assert (fit.instantaneous_MTBF_lower / fit.instantaneous_MTBF_mle
            == pytest.approx(0.6361466995958958))
    assert (fit.instantaneous_MTBF_upper / fit.instantaneous_MTBF_mle
            == pytest.approx(1.681786373378117))


@pytest.mark.parametrize('failure_terminated', [False, True])
def test_crow_amsaa_one_sided_current_mtbf_lcb_uses_direct_exact_tail(
        failure_terminated):
    times = np.geomspace(1.0, 100.0, 8)
    endpoint = 120.0 if not failure_terminated else times[-1]
    one_sided = CrowAMSAA(
        times, T=endpoint, failure_terminated=failure_terminated, CI=.90)
    equivalent_two_sided = CrowAMSAA(
        times, T=endpoint, failure_terminated=failure_terminated, CI=.80)

    assert one_sided.instantaneous_MTBF_one_sided_lower == pytest.approx(
        equivalent_two_sided.instantaneous_MTBF_lower)
    assert one_sided.instantaneous_MTBF_one_sided_confidence == .90
    assert one_sided.instantaneous_MTBF_one_sided_lower_status.startswith(
        'exact')


def test_crow_amsaa_exact_failure_interval_is_stable_at_large_n():
    # Generalized-Laguerre weights overflow at large Gamma shapes; the
    # probability-integral-transform quadrature must remain warning-free.
    with warnings.catch_warnings():
        warnings.simplefilter('error', RuntimeWarning)
        fit = CrowAMSAA(np.geomspace(1.0, 1000.0, 500))

    assert np.isfinite(fit.instantaneous_MTBF_lower)
    assert np.isfinite(fit.instantaneous_MTBF_upper)
    assert (fit.instantaneous_MTBF_lower
            < fit.instantaneous_MTBF_mle
            < fit.instantaneous_MTBF_upper)


def test_crow_amsaa_failure_cumulative_interval_uses_gamma_pivot():
    from scipy.stats import chi2

    fit = CrowAMSAA(TIMES, CI=0.90)
    n = len(TIMES)
    assert fit.cumulative_MTBF_lower == pytest.approx(
        fit.T / (chi2.ppf(0.95, 2 * n) / 2))
    assert fit.cumulative_MTBF_upper == pytest.approx(
        fit.T / (chi2.ppf(0.05, 2 * n) / 2))
    assert 'failure_terminated_gamma' in fit.cumulative_MTBF_interval_method


def test_crow_amsaa_stable_extreme_shape_and_projection_helpers():
    fit = CrowAMSAA([100, 100.000001, 100.000002])
    assert fit.Lambda == 0.0  # dimensioned scale underflows, log scale remains
    assert np.isfinite(fit.log_Lambda)
    assert fit.expected_failures(fit.T) == pytest.approx(3)
    assert np.isfinite(fit.instantaneous_MTBF)
    assert fit.failure_intensity(fit.T) == pytest.approx(
        1 / fit.instantaneous_MTBF)
    prediction = fit.failure_count_prediction(fit.T, fit.T * 1.00000001)
    assert prediction['lower'] <= prediction['upper']
    assert fit.next_event_time_quantile(fit.T, 0.5) > fit.T


def test_crow_amsaa_unrepresentable_endpoint_metrics_fail_closed_without_warning():
    with warnings.catch_warnings():
        warnings.simplefilter('error', RuntimeWarning)
        with pytest.raises(ValueError, match='rescale the time unit'):
            CrowAMSAA(
                [np.nextafter(0.0, 1.0), 1e308], T=1e308,
                failure_terminated=False)


def test_crow_amsaa_narrow_interval_mean_avoids_cumulative_cancellation():
    fit = CrowAMSAA(
        [1e-100, 1e-90], T=1.0, failure_terminated=False)
    start = 1e10
    end = np.nextafter(start, np.inf)

    # The two cumulative means round to the same float, but their model-based
    # increment is positive and representable when evaluated with expm1.
    assert fit.expected_failures(end) == fit.expected_failures(start)
    increment = fit.expected_failures_between(start, end)
    assert np.isfinite(increment)
    assert increment > 0


def test_crow_amsaa_rejects_nonfinite_and_ambiguous_time_termination():
    with pytest.raises(ValueError, match='finite'):
        CrowAMSAA([1, np.nan, 3])
    with pytest.raises(ValueError, match='finite'):
        CrowAMSAA([1, 2, 3], T=np.nan)
    with pytest.raises(ValueError, match='explicit total time'):
        CrowAMSAA([1, 2, 3], failure_terminated=False)


def test_crow_amsaa_grouped_mil_benchmark_and_gof():
    fit = CrowAMSAAGrouped(
        interval_ends=[20, 40, 60, 80, 100],
        failure_counts=[13, 16, 5, 8, 7],
    )

    assert fit.beta == pytest.approx(0.75285088677, rel=5e-8)
    assert fit.Lambda == pytest.approx(1.5293056974, rel=1e-7)
    assert fit.expected_counts == pytest.approx(
        [14.58733262, 9.99406591, 8.77483841, 8.06635685, 7.57740622],
        rel=2e-7)
    assert fit.instantaneous_failure_intensity_at_end == pytest.approx(
        0.3688969345, rel=1e-7)
    assert fit.instantaneous_MTBF_at_end == pytest.approx(2.71078425, rel=1e-7)
    assert fit.last_interval_average_failure_intensity == pytest.approx(
        0.3788703109, rel=1e-7)
    assert fit.last_interval_average_MTBF == pytest.approx(2.63942561, rel=1e-7)
    assert fit.last_interval_average_MTBF_lower == pytest.approx(
        fit.last_interval_average_MTBF * 0.673653094473246, rel=2e-10)
    assert fit.last_interval_average_MTBF_upper == pytest.approx(
        fit.last_interval_average_MTBF * 1.551392254753944, rel=2e-10)
    assert fit.last_interval_average_MTBF_interval_status == (
        'approximate_grouped_handbook_interval')
    assert '6_2_3_1_2' in fit.last_interval_average_MTBF_interval_method
    assert (fit.last_interval_average_MTBF_profile_lower
            < fit.last_interval_average_MTBF
            < fit.last_interval_average_MTBF_profile_upper)
    assert fit.last_interval_average_MTBF_profile_interval_status == (
        'asymptotic_target_profile_likelihood')
    assert 'target_profile' in (
        fit.last_interval_average_MTBF_profile_interval_method)
    assert fit.gof_available is True
    assert fit.chi_square_df == 3
    assert abs(fit.profile_score) < 2e-6

    equivalent_two_sided = CrowAMSAAGrouped(
        interval_ends=[20, 40, 60, 80, 100],
        failure_counts=[13, 16, 5, 8, 7], CI=.90)
    assert fit.last_interval_average_MTBF_one_sided_lower == pytest.approx(
        equivalent_two_sided.last_interval_average_MTBF_lower)
    assert fit.last_interval_average_MTBF_one_sided_lower_status == (
        'approximate_grouped_handbook_interval')


# --- Duane ---

def test_duane_fit():
    model = Duane(times=TIMES)
    assert model.n == len(TIMES)
    assert 0 < model.alpha < 1
    assert model.r_squared > 0.5
    assert model.A == pytest.approx(10 ** model.b, rel=1e-12)


def test_duane_mtbf_at_T():
    model = Duane(times=TIMES)
    T = model.T
    assert model.DMTBF_C == pytest.approx(model.MTBF_cumulative(T), rel=1e-12)
    assert model.DMTBF_I == pytest.approx(model.MTBF_instantaneous(T), rel=1e-12)
    # with positive growth (alpha > 0), instantaneous MTBF > cumulative MTBF
    assert model.MTBF_instantaneous(T) > model.MTBF_cumulative(T)


def test_duane_results_dataframe():
    model = Duane(times=TIMES)
    assert set(['Parameter', 'Value']) == set(model.results.columns)
    assert 'Duane' in repr(model)


def test_duane_withholds_instantaneous_mtbf_outside_growth_regime():
    model = Duane(times=[100, 101, 102, 103])

    assert model.alpha < 0
    assert model.valid_growth_regime is False
    assert model.DMTBF_I is None
    assert model.MTBF_instantaneous(200) is None
    assert 'withheld' in model.regime_warning


# --- Validation ---

def test_empty_times_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[])
    with pytest.raises(ValueError):
        Duane(times=[])


def test_single_failure_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[10.0])


def test_descending_times_raise_but_reported_ties_are_accepted():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[10, 20, 15, 30])
    fit = CrowAMSAA(times=[10, 20, 20, 30])
    assert fit.has_tied_times is True
    assert np.isfinite(Duane(times=[10, 20, 20, 30]).alpha)


def test_negative_times_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[-5, 10, 20])


def test_T_less_than_max_time_raises():
    with pytest.raises(ValueError):
        CrowAMSAA(times=[10, 20, 30], T=25)
    with pytest.raises(ValueError):
        Duane(times=[10, 20, 30], T=25)


def test_crow_release_certification_eligibility_fails_closed_on_provenance_and_actual_work():
    from tools.crow_amsaa_validation import _certification_eligibility

    kwargs = {
        'profile': 'release',
        'replicates': 20_000,
        'passed': True,
        'git_sha': '0123456789abcdef0123456789abcdef01234567',
        'git_dirty': False,
        'coverage': [{'replicates_completed': 20_000}] * 12,
        'grouped_coverage': [{'replicates_completed': 2_000}] * 6,
        'cvm': [{'replicates': 5_000}] * 10,
        'trend_power': [{'replicates': 2_000}] * 4,
    }
    eligible, reasons = _certification_eligibility(**kwargs)
    assert eligible is True
    assert reasons == []

    kwargs['git_dirty'] = True
    kwargs['coverage'] = [{'replicates_completed': 100}] * 12
    eligible, reasons = _certification_eligibility(**kwargs)
    assert eligible is False
    assert 'git worktree is dirty' in reasons
    assert any('insufficient actual replicates' in reason
               for reason in reasons)


def test_crow_validation_cli_release_requires_certification_eligibility(monkeypatch):
    from tools import crow_amsaa_validation as validation

    report = {'passed': True, 'certification_eligible': False}
    monkeypatch.setattr(validation, 'run', lambda *args, **kwargs: report)
    assert validation.main(['--profile', 'release']) == 1
    assert validation.main(['--profile', 'pr']) == 0
