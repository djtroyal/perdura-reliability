"""
Repairable systems / reliability growth analysis.

Provides the Crow-AMSAA (NHPP power law) model fitted by maximum
likelihood, and the Duane graphical (regression) method, for analysing
reliability growth of repairable systems from cumulative failure times.
"""

import math
from functools import lru_cache

import numpy as np
import pandas as pd


def _validate_probability(value, name, *, inclusive_zero=False):
    """Return a finite probability after validating its open-unit range."""
    if isinstance(value, (bool, np.bool_)):
        raise ValueError(f'{name} must be a numeric probability.')
    value = float(value)
    lower_ok = value >= 0 if inclusive_zero else value > 0
    if not np.isfinite(value) or not lower_ok or value >= 1:
        relation = '0 <= value < 1' if inclusive_zero else '0 < value < 1'
        raise ValueError(f'{name} must satisfy {relation}.')
    return value


def _safe_exp(log_value):
    """Exponentiate without emitting overflow/underflow runtime warnings."""
    with np.errstate(over='ignore', under='ignore', invalid='ignore'):
        return np.exp(log_value)


_LOG_FLOAT_MAX = math.log(np.finfo(float).max)
_LOG_FLOAT_MIN_SUBNORMAL = math.log(np.nextafter(0.0, 1.0))


def _representable_positive_from_log(log_value, name, *, reciprocal=False):
    """Convert a positive log-value, failing closed outside float range.

    ``reciprocal=True`` is used for paired MTBF/intensity quantities, where
    both the value and its reciprocal must be finite JSON numbers.  Rescaling
    the user's time unit preserves the dimensionless Crow shape and avoids
    silently returning infinity for otherwise valid but unrepresentable data.
    """
    log_value = float(log_value)
    lower = -_LOG_FLOAT_MAX if reciprocal else _LOG_FLOAT_MIN_SUBNORMAL
    if (not np.isfinite(log_value) or log_value < lower
            or log_value > _LOG_FLOAT_MAX):
        raise ValueError(
            f'{name} is outside the representable floating-point range; '
            'rescale the time unit and refit.')
    value = float(math.exp(log_value))
    if not np.isfinite(value) or value <= 0:
        raise ValueError(
            f'{name} is outside the representable floating-point range; '
            'rescale the time unit and refit.')
    return value


@lru_cache(maxsize=256)
def _failure_terminated_mtbf_factor_quantiles(n, probabilities):
    """Quantiles of current-MTBF/MLE under failure termination."""
    probabilities = tuple(float(value) for value in probabilities)
    if any(not 0 < value < 1 for value in probabilities):
        raise ValueError('MTBF factor probabilities must be between 0 and 1.')

    import warnings

    from scipy.optimize import brentq
    from scipy.special import (
        gammainc, gammaincinv, roots_genlaguerre, roots_legendre,
    )

    order = 192
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        with np.errstate(over='ignore', invalid='ignore'):
            nodes, weights = roots_genlaguerre(order, n - 1)
    weight_sum = np.sum(weights)
    if (np.any(~np.isfinite(nodes)) or np.any(~np.isfinite(weights))
            or not np.isfinite(weight_sum) or weight_sum <= 0):
        uniform_nodes, uniform_weights = roots_legendre(512)
        uniform_probabilities = 0.5 * (uniform_nodes + 1.0)
        nodes = gammaincinv(n, uniform_probabilities)
        weights = 0.5 * uniform_weights
        weight_sum = np.sum(weights)
    weights = weights / weight_sum
    log_nodes = np.log(nodes)

    def product_cdf_log(log_z):
        ratio = _safe_exp(log_z - log_nodes)
        return float(np.dot(weights, gammainc(n - 1, ratio)))

    def product_quantile(probability):
        center = math.log(n * (n - 1))
        low, high = center - 8.0, center + 8.0
        while product_cdf_log(low) > probability:
            low -= 4.0
        while product_cdf_log(high) < probability:
            high += 4.0
        return math.exp(brentq(
            lambda value: product_cdf_log(value) - probability,
            low, high, xtol=1e-12, rtol=1e-12))

    # If R=n^2/(YV), Q_R(p)=n^2/Q_YV(1-p).
    return tuple(
        n ** 2 / product_quantile(1.0 - probability)
        for probability in probabilities)


@lru_cache(maxsize=128)
def _failure_terminated_mtbf_factors(n, CI):
    """Exact factors for current MTBF under failure termination.

    If ``Y = Lambda*T**beta ~ Gamma(n, 1)`` and
    ``V = beta*sum(log(T/t_i)) ~ Gamma(n-1, 1)`` are independent, then
    ``m(T)/m_hat(T) = n**2/(Y*V)``. Product-gamma quantiles are evaluated by
    generalized Gauss-Laguerre quadrature, with a stable probability-integral
    transform quadrature fallback at large shape parameters.
    """
    tail = (1.0 - CI) / 2.0
    return _failure_terminated_mtbf_factor_quantiles(
        n, (tail, 1.0 - tail))


@lru_cache(maxsize=128)
def _time_terminated_mtbf_factor(n, probability, k):
    """One quantile coefficient from Crow's time-terminated construction."""
    from scipy.optimize import brentq
    from scipy.special import gammaln, ive, logsumexp

    n = int(n)
    k = int(k)
    probability = float(probability)
    if n < 2 or k < 1:
        raise ValueError(
            'Time-terminated current-MTBF bounds require at least 2 failures.')
    if not 0 < probability < 1:
        raise ValueError('MTBF factor probability must be between 0 and 1.')

    def H(x):
        j = np.arange(1, k + 1, dtype=float)
        log_terms = (
            (2.0 * j - 1.0) * (math.log(x) - math.log(2.0))
            - gammaln(j) - gammaln(j + 1.0))
        scaled_bessel = float(ive(1, x))
        if scaled_bessel <= 0 or not np.isfinite(scaled_bessel):
            return 1.0 if x < 1.0 else 0.0
        log_h = float(logsumexp(log_terms) - math.log(scaled_bessel) - x)
        return float(_safe_exp(log_h))

    low = 1e-12
    high = max(2.0 * n, 10.0)
    while H(high) > probability:
        high *= 2.0
        if not np.isfinite(high):
            raise ValueError(
                'Could not bracket the Crow time-terminated MTBF factor.')
    root = float(brentq(
        lambda x: H(x) - probability,
        low, high, xtol=1e-12, rtol=1e-12))
    return 4.0 * n ** 2 / root ** 2


@lru_cache(maxsize=128)
def _time_terminated_mtbf_factors(n, CI):
    """Crow's conservative current-MTBF factors for time termination.

    Crow's time-terminated pivot is expressed through

    ``H(x | k) = sum(j=1..k) x**(2j-1) /
    (2**(2j-1) (j-1)! j! I1(x))``.

    The lower factor uses the ``alpha/2`` root with ``k=n``; the upper
    factor uses the ``1-alpha/2`` root with ``k=n-1``.  Both roots map to a
    multiplicative MTBF factor ``4*n**2/x**2``.  The differing ``k`` values
    are essential: they account for the discrete Poisson count and reproduce
    the published Crow tables.
    """
    n = int(n)
    if n < 2:
        raise ValueError(
            'Time-terminated current-MTBF bounds require at least 2 failures.')
    tail = (1.0 - CI) / 2.0
    return (_time_terminated_mtbf_factor(n, tail, n),
            _time_terminated_mtbf_factor(n, 1.0 - tail, n - 1))


def _validate_times(times):
    """Validate and convert cumulative failure times.

    Times must contain at least 2 finite positive values in nondecreasing
    order. Ties are retained because cumulative fleet/test time is commonly
    reported at finite precision (including in the MIL-HDBK-189 examples).
    Returns a one-dimensional float numpy array.
    """
    times = np.asarray(times, dtype=float)
    if times.ndim != 1:
        raise ValueError('Failure times must be one-dimensional.')
    if len(times) < 2:
        raise ValueError('At least 2 failure times are required.')
    if np.any(~np.isfinite(times)) or np.any(times <= 0):
        raise ValueError('All failure times must be finite and positive.')
    if np.any(np.diff(times) < 0):
        raise ValueError('Failure times must be nondecreasing '
                         '(cumulative system age at each failure).')
    return times


class CrowAMSAA:
    """Crow-AMSAA (NHPP power law) reliability growth model.

    Fits the non-homogeneous Poisson process power-law model
    N(t) = Lambda * t^beta to the cumulative failure times of a
    repairable system using maximum likelihood estimation.

    Parameters
    ----------
    times : array-like
        Cumulative (system age) failure times, sorted ascending.
    T : float, optional
        Total test time. Omitting ``T`` implies a failure-terminated test at
        ``times[-1]``. Supplying ``T`` implies time termination unless
        ``failure_terminated=True`` is also supplied.
    failure_terminated : bool, optional
        Explicitly mark the test as failure-terminated. If None (default),
        termination follows the input contract above; equality between a
        supplied ``T`` and the last failure time is not used to guess intent.

    Attributes
    ----------
    beta : float
        Selected shape estimate (raw MLE by default, or modified MLE).
        beta < 1 indicates reliability growth; beta > 1 deterioration.
    Lambda : float
        Scale paired with the selected shape estimate (lambda is reserved).
    n : int
        Number of failures.
    T : float
        Total test time used in the fit.
    failure_terminated : bool
        Whether the test was failure-terminated.
    growth_rate : float
        1 - beta. Positive means reliability growth.
    cumulative_MTBF : float
        Cumulative MTBF at T: m_c(T) = 1 / (Lambda * T^(beta-1)).
    instantaneous_MTBF : float
        Instantaneous MTBF at T: m_i(T) = 1 / (Lambda * beta * T^(beta-1)).
    instantaneous_failure_intensity : float
        Failure intensity at T: Lambda * beta * T^(beta-1).
    CvM : float
        Cramer-von Mises goodness of fit statistic (lower is better).
    results : pandas.DataFrame
        Summary table with Parameter / Value rows.
    """

    def __init__(self, times, T=None, failure_terminated=None, CI=0.95,
                 estimator='mle'):
        times = _validate_times(times)
        CI = _validate_probability(CI, 'CI')
        if failure_terminated is not None and not isinstance(
                failure_terminated, (bool, np.bool_)):
            raise ValueError('failure_terminated must be True, False, or None.')
        estimator = str(estimator).strip().lower().replace('-', '_')
        if estimator == 'bias_corrected':
            estimator = 'modified_mle'
        if estimator not in {'mle', 'modified_mle'}:
            raise ValueError("estimator must be 'mle' or 'modified_mle'.")
        n = len(times)
        t_n = float(times[-1])

        if T is None:
            if failure_terminated is False:
                raise ValueError(
                    'A time-terminated test requires an explicit total time T.')
            T = t_n
            failure_terminated = True
        else:
            T = float(T)
            if not np.isfinite(T) or T <= 0:
                raise ValueError('T must be finite and positive.')
            if T < t_n:
                raise ValueError('T must be >= the largest failure time.')
            if failure_terminated is None:
                failure_terminated = False
        failure_terminated = bool(failure_terminated)
        if failure_terminated and not math.isclose(
                T, t_n, rel_tol=1e-12, abs_tol=0.0):
            raise ValueError('A failure-terminated test requires T to equal '
                             'the last failure time.')
        if failure_terminated:
            T = t_n

        log_T = math.log(T)
        log_sum = float(np.sum(log_T - np.log(times)))
        if not np.isfinite(log_sum) or log_sum <= 0:
            raise ValueError(
                'Cannot estimate beta: failure times provide no positive '
                'log-time spread before the test end.')
        beta_mle = n / log_sum
        if not np.isfinite(beta_mle) or beta_mle <= 0:
            raise ValueError(
                'Cannot estimate a finite positive beta from these times; '
                'rescale the time unit or provide more numerical separation.')
        if failure_terminated:
            beta_bias_corrected = ((n - 2) / n * beta_mle
                                   if n >= 3 else None)
        else:
            beta_bias_corrected = (n - 1) / n * beta_mle
        if estimator == 'modified_mle' and beta_bias_corrected is None:
            raise ValueError(
                'modified_mle requires at least 3 failures for a '
                'failure-terminated test.')
        log_lambda_mle = math.log(n) - beta_mle * log_T
        lambda_mle = float(_safe_exp(log_lambda_mle))
        if beta_bias_corrected is None:
            log_lambda_bc = lambda_bc = None
        else:
            log_lambda_bc = math.log(n) - beta_bias_corrected * log_T
            lambda_bc = float(_safe_exp(log_lambda_bc))
        beta = beta_mle if estimator == 'mle' else beta_bias_corrected
        log_lambda = (log_lambda_mle if estimator == 'mle'
                      else log_lambda_bc)
        Lambda = float(_safe_exp(log_lambda))

        self.times = times
        self.n = n
        self.T = T
        self.CI = CI
        self.estimator = estimator
        self.failure_terminated = failure_terminated
        self.termination = ('failure_terminated' if failure_terminated
                            else 'time_terminated')
        self.has_tied_times = bool(np.any(np.diff(times) == 0))
        self.beta_mle = beta_mle
        self.beta_bias_corrected = beta_bias_corrected
        self.Lambda_mle = lambda_mle
        self.Lambda_bias_corrected = lambda_bc
        self.log_Lambda_mle = log_lambda_mle
        self.log_Lambda_bias_corrected = log_lambda_bc
        self.beta = float(beta)
        self.Lambda = Lambda
        self.log_Lambda = float(log_lambda)
        self.scale_representable = bool(np.isfinite(Lambda) and Lambda > 0)
        self.growth_rate = 1.0 - self.beta
        self.growth_rate_mle = 1.0 - beta_mle
        self.growth_rate_bias_corrected = (
            1.0 - beta_bias_corrected
            if beta_bias_corrected is not None else None)
        log_n = math.log(n)
        log_cumulative_mtbf = log_T - log_n
        log_instantaneous_mtbf = log_cumulative_mtbf - math.log(self.beta)
        log_instantaneous_mtbf_mle = (
            log_cumulative_mtbf - math.log(beta_mle))
        self.cumulative_MTBF = _representable_positive_from_log(
            log_cumulative_mtbf, 'Cumulative MTBF')
        self.instantaneous_MTBF = _representable_positive_from_log(
            log_instantaneous_mtbf, 'Instantaneous MTBF', reciprocal=True)
        self.instantaneous_failure_intensity = (
            _representable_positive_from_log(
                -log_instantaneous_mtbf, 'Instantaneous failure intensity',
                reciprocal=True))
        self.instantaneous_MTBF_mle = _representable_positive_from_log(
            log_instantaneous_mtbf_mle, 'MLE instantaneous MTBF',
            reciprocal=True)
        self.instantaneous_failure_intensity_mle = (
            _representable_positive_from_log(
                -log_instantaneous_mtbf_mle,
                'MLE instantaneous failure intensity', reciprocal=True))
        if beta_bias_corrected is not None:
            log_instantaneous_mtbf_bc = (
                log_cumulative_mtbf - math.log(beta_bias_corrected))
            self.instantaneous_MTBF_bias_corrected = (
                _representable_positive_from_log(
                    log_instantaneous_mtbf_bc,
                    'Modified-MLE instantaneous MTBF', reciprocal=True))
            self.instantaneous_failure_intensity_bias_corrected = (
                _representable_positive_from_log(
                    -log_instantaneous_mtbf_bc,
                    'Modified-MLE instantaneous failure intensity',
                    reciprocal=True))
        else:
            self.instantaneous_MTBF_bias_corrected = None
            self.instantaneous_failure_intensity_bias_corrected = None

        # CvM always uses the termination-correct modified MLE, independently
        # of the estimator selected for point curves. It is unavailable with
        # only one transformed observation (failure-terminated n=2).
        if failure_terminated:
            M = n - 1
            cvm_times = times[:-1]
        else:
            M = n
            cvm_times = times
        self.cvm_M = M
        self.cvm_beta = beta_bias_corrected
        self.cvm_available = bool(M >= 2 and self.cvm_beta is not None)
        if self.cvm_available:
            i = np.arange(1, M + 1)
            transformed = _safe_exp(
                self.cvm_beta * (np.log(cvm_times) - log_T))
            self.CvM = float(
                1 / (12 * M)
                + np.sum((transformed - (2 * i - 1) / (2 * M)) ** 2))
        else:
            self.CvM = None

        # ── Confidence bounds (configurable level, two-sided) ─────────────
        # Exact chi-square bounds on beta (MIL-HDBK-189): 2nβ/β̂ follows a
        # chi-square with 2n df (time-terminated) or 2(n−1) df
        # (failure-terminated). If the interval excludes 1, the trend is
        # statistically significant.
        from scipy.stats import chi2 as _chi2
        alpha_ci = 1.0 - CI
        beta_df = 2 * (n - 1) if failure_terminated else 2 * n
        self.beta_interval_df = beta_df
        self.beta_lower = float(
            beta_mle * _chi2.ppf(alpha_ci / 2, beta_df) / (2 * n))
        self.beta_upper = float(
            beta_mle * _chi2.ppf(1 - alpha_ci / 2, beta_df) / (2 * n))
        self.growth_rate_lower = 1.0 - self.beta_upper
        self.growth_rate_upper = 1.0 - self.beta_lower
        self.beta_interval_method = 'exact_conditional_chi_square'
        self.beta_CI_method = self.beta_interval_method
        self.growth_rate_interval_method = self.beta_interval_method
        self.Lambda_interval_method = 'not_computed'

        count_lower = _chi2.ppf(alpha_ci / 2, 2 * n) / 2.0
        if failure_terminated:
            count_upper = _chi2.ppf(1 - alpha_ci / 2, 2 * n) / 2.0
            self.cumulative_MTBF_interval_method = (
                'exact_failure_terminated_gamma_pivot')
        else:
            count_upper = _chi2.ppf(
                1 - alpha_ci / 2, 2 * n + 2) / 2.0
            self.cumulative_MTBF_interval_method = (
                'exact_time_terminated_poisson_garwood')
        self.cumulative_MTBF_lower = _representable_positive_from_log(
            log_T - math.log(count_upper), 'Cumulative MTBF lower bound')
        self.cumulative_MTBF_upper = _representable_positive_from_log(
            log_T - math.log(count_lower), 'Cumulative MTBF upper bound')

        self.interval_warnings = []
        if failure_terminated:
            factor_lower, factor_upper = _failure_terminated_mtbf_factors(n, CI)
            one_sided_lower_factor = (
                _failure_terminated_mtbf_factor_quantiles(
                    n, (1.0 - CI,))[0])
            self.instantaneous_MTBF_interval_method = (
                'exact_failure_terminated_independent_gamma_product')
            self.instantaneous_MTBF_interval_status = 'exact'
            self.instantaneous_MTBF_one_sided_lower_method = (
                'exact_failure_terminated_independent_gamma_product')
            self.instantaneous_MTBF_one_sided_lower_status = 'exact'
        else:
            factor_lower, factor_upper = _time_terminated_mtbf_factors(n, CI)
            one_sided_lower_factor = _time_terminated_mtbf_factor(
                n, 1.0 - CI, n)
            self.instantaneous_MTBF_interval_method = (
                'crow_exact_time_terminated_bessel_poisson_mixture')
            self.instantaneous_MTBF_interval_status = (
                'exact_conservative_due_to_discrete_failure_count')
            self.instantaneous_MTBF_one_sided_lower_method = (
                'crow_exact_time_terminated_bessel_poisson_mixture')
            self.instantaneous_MTBF_one_sided_lower_status = (
                'exact_conservative_due_to_discrete_failure_count')
        self.instantaneous_MTBF_lower = _representable_positive_from_log(
            log_instantaneous_mtbf_mle + math.log(factor_lower),
            'Instantaneous MTBF lower bound', reciprocal=True)
        self.instantaneous_MTBF_upper = _representable_positive_from_log(
            log_instantaneous_mtbf_mle + math.log(factor_upper),
            'Instantaneous MTBF upper bound', reciprocal=True)
        self.instantaneous_MTBF_one_sided_lower = (
            _representable_positive_from_log(
                log_instantaneous_mtbf_mle
                + math.log(one_sided_lower_factor),
                'One-sided instantaneous MTBF lower confidence bound',
                reciprocal=True))
        self.instantaneous_MTBF_one_sided_confidence = CI
        self.instantaneous_failure_intensity_lower = (
            _representable_positive_from_log(
                -math.log(self.instantaneous_MTBF_upper),
                'Instantaneous failure-intensity lower bound',
                reciprocal=True))
        self.instantaneous_failure_intensity_upper = (
            _representable_positive_from_log(
                -math.log(self.instantaneous_MTBF_lower),
                'Instantaneous failure-intensity upper bound',
                reciprocal=True))
        self.failure_intensity_lower = self.instantaneous_failure_intensity_lower
        self.failure_intensity_upper = self.instantaneous_failure_intensity_upper
        self.intensity_interval_method = self.instantaneous_MTBF_interval_method
        self.failure_intensity_interval_method = self.intensity_interval_method
        self.interval_methods = {
            'beta': self.beta_interval_method,
            'growth_rate': self.growth_rate_interval_method,
            'cumulative_mtbf': self.cumulative_MTBF_interval_method,
            'instantaneous_mtbf': self.instantaneous_MTBF_interval_method,
            'instantaneous_mtbf_one_sided_lower': (
                self.instantaneous_MTBF_one_sided_lower_method),
            'failure_intensity': self.intensity_interval_method,
        }
        # Exact/pivot intervals are defined from the raw likelihood estimator.
        # Selecting the modified MLE changes displayed curves and point metrics,
        # not the sufficient statistics or the resulting confidence set.
        self.interval_reference_estimator = 'mle'
        self.beta_interval_reference_estimate = self.beta_mle
        self.instantaneous_MTBF_interval_reference_estimate = (
            self.instantaneous_MTBF_mle)
        self.cumulative_MTBF_interval_reference_estimate = (
            self.cumulative_MTBF)

        self.trend_test_statistic = 2.0 * log_sum
        self.trend_test_df = beta_df
        cdf = float(_chi2.cdf(self.trend_test_statistic, beta_df))
        sf = float(_chi2.sf(self.trend_test_statistic, beta_df))
        self.trend_p_value = min(1.0, 2.0 * min(cdf, sf))
        self.trend_significant = bool(self.trend_p_value < alpha_ci)
        self.trend_test_method = 'exact_conditional_chi_square_beta_equals_1'
        self.trend = ('improving' if beta_mle < 1 else
                      'worsening' if beta_mle > 1 else 'constant')

        self.results = pd.DataFrame({
            'Parameter': [
                'Beta', 'Beta (MLE)', 'Beta (modified MLE)',
                'Lambda (selected)', 'Growth rate',
                'Instantaneous MTBF at T', 'Cumulative MTBF at T',
                'Cramer-von Mises statistic', 'Trend p-value'],
            'Value': [
                self.beta, self.beta_mle, self.beta_bias_corrected,
                self.Lambda, self.growth_rate, self.instantaneous_MTBF,
                self.cumulative_MTBF, self.CvM, self.trend_p_value],
        })

    @staticmethod
    def _evaluation_times(t, *, allow_zero):
        values = np.asarray(t, dtype=float)
        if np.any(~np.isfinite(values)):
            raise ValueError('Evaluation times must be finite.')
        if np.any(values < 0) or (not allow_zero and np.any(values == 0)):
            relation = 'non-negative' if allow_zero else 'positive'
            raise ValueError(f'Evaluation times must be {relation}.')
        return values

    @staticmethod
    def _scalar_or_array(values):
        return values.item() if values.ndim == 0 else values

    def expected_failures(self, t):
        """Expected cumulative failures ``M(t)`` evaluated stably."""
        t = self._evaluation_times(t, allow_zero=True)
        with np.errstate(divide='ignore'):
            out = _safe_exp(
                math.log(self.n)
                + self.beta * (np.log(t) - math.log(self.T)))
        out = np.where(t == 0, 0.0, out)
        return self._scalar_or_array(np.asarray(out))

    def failure_intensity(self, t):
        """Rate of occurrence of failures ``rho(t)`` for positive times."""
        t = self._evaluation_times(t, allow_zero=False)
        out = _safe_exp(
            math.log(self.n * self.beta / self.T)
            + (self.beta - 1.0) * (np.log(t) - math.log(self.T)))
        return self._scalar_or_array(np.asarray(out))

    def expected_failures_between(self, start, end):
        """Expected Poisson count in ``(start, end]``."""
        start = self._evaluation_times(start, allow_zero=True)
        end = self._evaluation_times(end, allow_zero=True)
        try:
            start, end = np.broadcast_arrays(start, end)
        except ValueError as exc:
            raise ValueError(
                'start and end must have broadcast-compatible shapes.') from exc
        if np.any(end < start):
            raise ValueError('end must be >= start.')
        # Compute M(end) * {1 - (start/end)^beta} on the log scale. Directly
        # subtracting two large, nearby cumulative means can erase a positive
        # narrow-interval count through cancellation.
        with np.errstate(divide='ignore', invalid='ignore'):
            log_mean_end = (
                math.log(self.n)
                + self.beta * (np.log(end) - math.log(self.T)))
            # log(start/end) = -log1p((end-start)/start); this retains an
            # adjacent-float interval even when log(start) and log(end) round
            # to the same value.
            log_ratio = -self.beta * np.log1p((end - start) / start)
            fraction = -np.expm1(log_ratio)
            fraction = np.where(start == 0, 1.0, fraction)
            log_increment = log_mean_end + np.log(fraction)
        out = _safe_exp(log_increment)
        out = np.where(end == start, 0.0, out)
        return self._scalar_or_array(np.asarray(out))

    def failure_count_probability(self, start, end, count):
        """Plug-in Poisson probability of ``count`` failures in an interval."""
        from scipy.stats import poisson
        if (isinstance(count, (bool, np.bool_))
                or int(count) != count or count < 0):
            raise ValueError('count must be a non-negative integer.')
        mean = float(self.expected_failures_between(start, end))
        if not np.isfinite(mean):
            raise ValueError('The expected interval count is not finite.')
        return float(poisson.pmf(int(count), mean))

    def failure_count_prediction(self, start, end, CI=None):
        """Plug-in Poisson predictive interval; parameter uncertainty omitted."""
        from scipy.stats import poisson
        confidence = self.CI if CI is None else _validate_probability(CI, 'CI')
        mean = float(self.expected_failures_between(start, end))
        if not np.isfinite(mean):
            raise ValueError('The expected interval count is not finite.')
        tail = (1.0 - confidence) / 2.0
        return {
            'mean': mean,
            'lower': int(poisson.ppf(tail, mean)),
            'upper': int(poisson.ppf(1.0 - tail, mean)),
            'CI': confidence,
            'method': 'plug_in_poisson_parameter_uncertainty_not_included',
        }

    def next_event_time_quantile(self, current_time, probability):
        """Conditional quantile of the absolute time of the next NHPP event."""
        current_time = float(self._evaluation_times(
            current_time, allow_zero=True))
        probability = _validate_probability(probability, 'probability')
        current_mean = float(self.expected_failures(current_time))
        target_mean = current_mean - math.log1p(-probability)
        log_time = (math.log(self.T)
                    + (math.log(target_mean) - math.log(self.n)) / self.beta)
        return float(_safe_exp(log_time))

    def MTBF_cumulative(self, t):
        """Cumulative MTBF ``t/M(t)`` for positive times."""
        t = self._evaluation_times(t, allow_zero=False)
        out = _safe_exp(
            math.log(self.T / self.n) + (1.0 - self.beta)
            * (np.log(t) - math.log(self.T)))
        return self._scalar_or_array(np.asarray(out))

    def MTBF_instantaneous(self, t):
        """Instantaneous MTBF, the reciprocal of ``rho(t)``."""
        intensity = np.asarray(self.failure_intensity(t), dtype=float)
        with np.errstate(divide='ignore', invalid='ignore'):
            out = 1.0 / intensity
        return self._scalar_or_array(np.asarray(out))

    def __repr__(self):
        return (f'CrowAMSAA({self.termination.replace("_", "-")}, '
                f'estimator={self.estimator!r}, n={self.n}, T={self.T:g}, '
                f'beta={self.beta:.4f}, Lambda={self.Lambda:.6g}, '
                f'growth_rate={self.growth_rate:.4f}, '
                f'instantaneous_MTBF={self.instantaneous_MTBF:.4f})')


class CrowAMSAAGrouped:
    """Crow-AMSAA MLE for failure counts observed in time intervals.

    Counts are independent Poisson observations with means
    ``Lambda * (end**beta - start**beta)``.  The implementation supports the
    contiguous MIL-HDBK-189 grouped-data contract and non-overlapping observed
    intervals with gaps. Goodness of fit pools adjacent intervals until their
    fitted expected count is at least five.
    """

    def __init__(self, interval_ends, failure_counts, interval_starts=None,
                 CI=0.95, significance=0.10):
        from scipy.optimize import brentq, minimize_scalar
        from scipy.special import gammaln, logsumexp
        from scipy.stats import chi2

        CI = _validate_probability(CI, 'CI')
        significance = _validate_probability(significance, 'significance')
        ends = np.asarray(interval_ends, dtype=float)
        raw_counts = np.asarray(failure_counts, dtype=float)
        if ends.ndim != 1 or raw_counts.ndim != 1 or len(ends) != len(raw_counts):
            raise ValueError(
                'interval_ends and failure_counts must be equal-length '
                'one-dimensional arrays.')
        if len(ends) < 3:
            raise ValueError('Grouped Crow-AMSAA requires at least 3 intervals.')
        if np.any(~np.isfinite(ends)) or np.any(ends <= 0):
            raise ValueError('Interval ends must be finite and positive.')
        if np.any(np.diff(ends) <= 0):
            raise ValueError('Interval ends must be strictly increasing.')
        if (np.any(~np.isfinite(raw_counts)) or np.any(raw_counts < 0)
                or np.any(raw_counts != np.floor(raw_counts))):
            raise ValueError('Failure counts must be non-negative integers.')
        counts = raw_counts.astype(int)
        if np.count_nonzero(counts) < 2:
            raise ValueError('At least 2 intervals must contain failures.')
        if interval_starts is None:
            starts = np.concatenate(([0.0], ends[:-1]))
        else:
            starts = np.asarray(interval_starts, dtype=float)
            if starts.ndim != 1 or len(starts) != len(ends):
                raise ValueError(
                    'interval_starts must have one value per interval end.')
            if np.any(~np.isfinite(starts)) or np.any(starts < 0):
                raise ValueError(
                    'Interval starts must be finite and non-negative.')
            if np.any(np.diff(starts) < 0):
                raise ValueError('Interval starts must be nondecreasing.')
        if np.any(ends <= starts):
            raise ValueError('Every interval end must exceed its start.')
        if np.any(starts[1:] < ends[:-1]):
            raise ValueError('Grouped intervals must not overlap.')

        total = int(np.sum(counts))
        if total < 2:
            raise ValueError('At least 2 total failures are required.')
        log_ends = np.log(ends)

        def log_deltas(beta):
            out = beta * log_ends
            positive = starts > 0
            if np.any(positive):
                log_ratio = np.log(starts[positive]) - log_ends[positive]
                out[positive] += np.log(
                    -np.expm1(beta * log_ratio))
            return out

        log_factorial = float(np.sum(gammaln(counts + 1)))

        def profile_loglik_logbeta(log_beta):
            beta_value = math.exp(log_beta)
            log_delta = log_deltas(beta_value)
            log_total_exposure = float(logsumexp(log_delta))
            return (total * math.log(total) - total
                    - total * log_total_exposure
                    + float(np.dot(counts, log_delta)) - log_factorial)

        fit = minimize_scalar(
            lambda z: -profile_loglik_logbeta(z),
            bounds=(-18.0, 18.0), method='bounded',
            options={'xatol': 1e-12, 'maxiter': 1000})
        if (not fit.success or not np.isfinite(fit.fun)
                or abs(fit.x) > 17.999):
            raise ValueError('Grouped Crow-AMSAA has no stable finite MLE.')
        beta = math.exp(float(fit.x))
        log_delta = log_deltas(beta)
        log_total_exposure = float(logsumexp(log_delta))
        log_lambda = math.log(total) - log_total_exposure
        Lambda = float(_safe_exp(log_lambda))
        expected = np.asarray(_safe_exp(log_lambda + log_delta), dtype=float)

        # Analytic profile score, retained as a numerical audit diagnostic.
        derivative = np.array(log_ends, copy=True)
        positive = starts > 0
        if np.any(positive):
            delta_log = np.log(starts[positive]) - log_ends[positive]
            ratio = np.exp(beta * delta_log)
            derivative[positive] = (
                log_ends[positive]
                - ratio * delta_log / (1.0 - ratio))
        weights = np.exp(log_delta - log_total_exposure)
        profile_score = float(
            np.dot(counts, derivative) - total * np.dot(weights, derivative))

        # Profile-likelihood interval for beta.
        max_loglik = profile_loglik_logbeta(math.log(beta))
        target = max_loglik - 0.5 * float(chi2.ppf(CI, 1))

        def profile_root(z):
            return profile_loglik_logbeta(z) - target

        z_hat = math.log(beta)
        z_low = z_hat - 1.0
        while z_low > -18 and profile_root(z_low) > 0:
            z_low -= 1.0
        z_high = z_hat + 1.0
        while z_high < 18 and profile_root(z_high) > 0:
            z_high += 1.0
        beta_lower = (math.exp(brentq(profile_root, z_low, z_hat))
                      if z_low >= -18 and profile_root(z_low) <= 0 else None)
        beta_upper = (math.exp(brentq(profile_root, z_hat, z_high))
                      if z_high <= 18 and profile_root(z_high) <= 0 else None)

        self.interval_starts = starts
        self.interval_ends = ends
        self.failure_counts = counts
        self.n_intervals = len(ends)
        self.n_failures = total
        self.n = total
        self.T = float(ends[-1])
        self.CI = CI
        self.significance = significance
        self.beta = beta
        self.growth_rate = 1.0 - beta
        self.Lambda = Lambda
        self.log_Lambda = log_lambda
        self.profile_score = profile_score
        self.converged = True
        self.optimizer = 'bounded_profile_likelihood_log_beta'
        self.expected_counts = expected
        self.beta_lower = beta_lower
        self.beta_upper = beta_upper
        self.beta_interval_method = 'profile_likelihood_chi_square_1df'
        self.beta_CI_method = self.beta_interval_method
        self.growth_rate_lower = (
            1.0 - beta_upper if beta_upper is not None else None)
        self.growth_rate_upper = (
            1.0 - beta_lower if beta_lower is not None else None)
        self.growth_rate_interval_method = self.beta_interval_method
        self.Lambda_interval_method = 'not_computed'

        self.instantaneous_failure_intensity_at_end = float(
            self.failure_intensity(self.T))
        self.instantaneous_MTBF_at_end = float(
            1.0 / self.instantaneous_failure_intensity_at_end)
        self.instantaneous_failure_intensity = (
            self.instantaneous_failure_intensity_at_end)
        self.instantaneous_MTBF = self.instantaneous_MTBF_at_end
        final_width = float(ends[-1] - starts[-1])
        self.last_interval_expected_failures = float(expected[-1])
        self.last_interval_average_failure_intensity = float(
            expected[-1] / final_width)
        self.last_interval_average_MTBF = float(
            1.0 / self.last_interval_average_failure_intensity)

        # Enhanced target-profile interval for the final observed interval.
        # For a fixed final-bin mean theta, Lambda=theta/delta_K(beta); beta is
        # then profiled from the full grouped Poisson likelihood. This is kept
        # separate from the handbook's multiplicative Crow approximation.
        def final_mean_target_profile(log_mean):
            def negative_loglik(log_beta):
                beta_value = math.exp(log_beta)
                interval_log_exposure = log_deltas(beta_value)
                relative_log_exposure = (
                    interval_log_exposure - interval_log_exposure[-1])
                total_relative_exposure = float(logsumexp(
                    relative_log_exposure))
                fitted_total = float(_safe_exp(
                    log_mean + total_relative_exposure))
                if not np.isfinite(fitted_total):
                    return math.inf
                value = (
                    total * log_mean
                    + float(np.dot(counts, relative_log_exposure))
                    - fitted_total - log_factorial)
                return -value

            optimum = minimize_scalar(
                negative_loglik, bounds=(-18.0, 18.0), method='bounded',
                options={'xatol': 1e-11, 'maxiter': 1000})
            if not optimum.success or not np.isfinite(optimum.fun):
                return -math.inf
            return -float(optimum.fun)

        log_final_mean = math.log(self.last_interval_expected_failures)
        final_profile_max = final_mean_target_profile(log_final_mean)
        final_profile_target = final_profile_max - 0.5 * float(chi2.ppf(CI, 1))

        def final_mean_profile_root(log_mean):
            return final_mean_target_profile(log_mean) - final_profile_target

        final_mean_lower = final_mean_upper = None
        mean_low = log_final_mean - 1.0
        while mean_low > -745.0 and final_mean_profile_root(mean_low) > 0:
            mean_low -= 1.0
        if final_mean_profile_root(mean_low) <= 0:
            final_mean_lower = float(_safe_exp(brentq(
                final_mean_profile_root, mean_low, log_final_mean,
                xtol=1e-11, rtol=1e-11)))
        mean_high = log_final_mean + 1.0
        while mean_high < 709.0 and final_mean_profile_root(mean_high) > 0:
            mean_high += 1.0
        if final_mean_profile_root(mean_high) <= 0:
            final_mean_upper = float(_safe_exp(brentq(
                final_mean_profile_root, log_final_mean, mean_high,
                xtol=1e-11, rtol=1e-11)))

        self.last_interval_expected_failures_profile_lower = final_mean_lower
        self.last_interval_expected_failures_profile_upper = final_mean_upper
        if final_mean_lower is not None and final_mean_upper is not None:
            self.last_interval_average_failure_intensity_profile_lower = float(
                final_mean_lower / final_width)
            self.last_interval_average_failure_intensity_profile_upper = float(
                final_mean_upper / final_width)
            self.last_interval_average_MTBF_profile_lower = float(
                final_width / final_mean_upper)
            self.last_interval_average_MTBF_profile_upper = float(
                final_width / final_mean_lower)
            self.last_interval_average_MTBF_profile_interval_status = (
                'asymptotic_target_profile_likelihood')
        else:
            self.last_interval_average_failure_intensity_profile_lower = None
            self.last_interval_average_failure_intensity_profile_upper = None
            self.last_interval_average_MTBF_profile_lower = None
            self.last_interval_average_MTBF_profile_upper = None
            self.last_interval_average_MTBF_profile_interval_status = (
                'unavailable_profile_root_not_bracketed')
        self.last_interval_average_MTBF_profile_interval_method = (
            'grouped_poisson_target_profile_likelihood_chi_square_1df')
        self.contiguous_full_exposure = bool(
            starts[0] == 0
            and np.allclose(starts[1:], ends[:-1], rtol=0, atol=0))
        if self.contiguous_full_exposure:
            crow_lower, crow_upper = _time_terminated_mtbf_factors(total, CI)
            crow_one_sided_lower = _time_terminated_mtbf_factor(
                total, 1.0 - CI, total)
            self.last_interval_average_MTBF_lower = float(
                self.last_interval_average_MTBF * crow_lower)
            self.last_interval_average_MTBF_upper = float(
                self.last_interval_average_MTBF * crow_upper)
            self.last_interval_average_MTBF_one_sided_lower = float(
                self.last_interval_average_MTBF * crow_one_sided_lower)
            self.last_interval_average_MTBF_one_sided_confidence = CI
            self.last_interval_average_failure_intensity_lower = float(
                1.0 / self.last_interval_average_MTBF_upper)
            self.last_interval_average_failure_intensity_upper = float(
                1.0 / self.last_interval_average_MTBF_lower)
            self.last_interval_average_MTBF_interval_method = (
                'mil_hdbk_189c_6_2_3_1_2_approximate_crow_'
                'time_terminated_coefficients')
            self.last_interval_average_MTBF_interval_status = (
                'approximate_grouped_handbook_interval')
            self.last_interval_average_MTBF_one_sided_lower_method = (
                'mil_hdbk_189c_6_2_3_1_2_approximate_crow_'
                'time_terminated_coefficient')
            self.last_interval_average_MTBF_one_sided_lower_status = (
                'approximate_grouped_handbook_interval')
        else:
            self.last_interval_average_MTBF_lower = None
            self.last_interval_average_MTBF_upper = None
            self.last_interval_average_failure_intensity_lower = None
            self.last_interval_average_failure_intensity_upper = None
            self.last_interval_average_MTBF_interval_method = (
                'unavailable_outside_contiguous_handbook_grouped_design')
            self.last_interval_average_MTBF_interval_status = 'unavailable'
            self.last_interval_average_MTBF_one_sided_lower = None
            self.last_interval_average_MTBF_one_sided_confidence = CI
            self.last_interval_average_MTBF_one_sided_lower_method = (
                'unavailable_outside_contiguous_handbook_grouped_design')
            self.last_interval_average_MTBF_one_sided_lower_status = (
                'unavailable')
        mean_at_end = float(self.expected_failures(self.T))
        self.cumulative_MTBF = self.T / mean_at_end
        if self.contiguous_full_exposure:
            tail = (1.0 - CI) / 2.0
            mean_lower = chi2.ppf(tail, 2 * total) / 2.0
            mean_upper = chi2.ppf(1.0 - tail, 2 * total + 2) / 2.0
            self.cumulative_MTBF_lower = float(self.T / mean_upper)
            self.cumulative_MTBF_upper = float(self.T / mean_lower)
            self.cumulative_MTBF_interval_method = (
                'exact_time_terminated_poisson_garwood')
        else:
            self.cumulative_MTBF_lower = None
            self.cumulative_MTBF_upper = None
            self.cumulative_MTBF_interval_method = (
                'unavailable_for_gapped_grouped_exposure')

        # These endpoint bands map the beta profile along its profiled-scale
        # ridge. They are useful diagnostics but are not a separately
        # calibrated target-profile interval for intensity.
        if (self.contiguous_full_exposure and beta_lower is not None
                and beta_upper is not None):
            self.instantaneous_failure_intensity_lower = float(
                total * beta_lower / self.T)
            self.instantaneous_failure_intensity_upper = float(
                total * beta_upper / self.T)
            self.instantaneous_MTBF_lower = float(
                1.0 / self.instantaneous_failure_intensity_upper)
            self.instantaneous_MTBF_upper = float(
                1.0 / self.instantaneous_failure_intensity_lower)
            self.intensity_interval_method = (
                'diagnostic_beta_profile_with_profiled_scale')
        else:
            self.instantaneous_failure_intensity_lower = None
            self.instantaneous_failure_intensity_upper = None
            self.instantaneous_MTBF_lower = None
            self.instantaneous_MTBF_upper = None
            self.intensity_interval_method = 'not_computed'
        self.failure_intensity_lower = self.instantaneous_failure_intensity_lower
        self.failure_intensity_upper = self.instantaneous_failure_intensity_upper
        self.failure_intensity_interval_method = self.intensity_interval_method
        self.instantaneous_MTBF_interval_method = self.intensity_interval_method
        self.interval_methods = {
            'beta': self.beta_interval_method,
            'growth_rate': self.growth_rate_interval_method,
            'cumulative_mtbf': self.cumulative_MTBF_interval_method,
            'instantaneous_mtbf': self.instantaneous_MTBF_interval_method,
            'failure_intensity': self.intensity_interval_method,
            'last_interval_average_mtbf': (
                self.last_interval_average_MTBF_interval_method),
            'last_interval_average_mtbf_one_sided_lower': (
                self.last_interval_average_MTBF_one_sided_lower_method),
            'last_interval_average_mtbf_profile': (
                self.last_interval_average_MTBF_profile_interval_method),
        }

        # Adjacent pooling for the handbook chi-square GOF requirement.
        pooled_observed = []
        pooled_expected = []
        pooled_bounds = []
        running_observed = 0
        running_expected = 0.0
        running_start = float(starts[0])
        for index, (observed, fitted) in enumerate(zip(counts, expected)):
            running_observed += int(observed)
            running_expected += float(fitted)
            if running_expected >= 5.0:
                pooled_observed.append(running_observed)
                pooled_expected.append(running_expected)
                pooled_bounds.append((running_start, float(ends[index])))
                if index + 1 < len(ends):
                    running_start = float(starts[index + 1])
                running_observed = 0
                running_expected = 0.0
        if running_expected > 0:
            if pooled_expected:
                pooled_observed[-1] += running_observed
                pooled_expected[-1] += running_expected
                pooled_bounds[-1] = (
                    pooled_bounds[-1][0], float(ends[-1]))
            else:
                pooled_observed.append(running_observed)
                pooled_expected.append(running_expected)
                pooled_bounds.append((running_start, float(ends[-1])))
        self.pooled_observed_counts = np.asarray(pooled_observed, dtype=int)
        self.pooled_expected_counts = np.asarray(pooled_expected, dtype=float)
        self.pooled_interval_bounds = pooled_bounds
        self.gof_pooled_intervals = [
            {
                'start': bounds[0], 'end': bounds[1],
                'observed': int(observed), 'expected': float(fitted),
            }
            for bounds, observed, fitted in zip(
                pooled_bounds, pooled_observed, pooled_expected)
        ]
        self.chi_square_df = len(pooled_expected) - 2
        self.gof_available = bool(
            self.chi_square_df > 0
            and np.all(self.pooled_expected_counts >= 5.0 - 1e-12))
        self.gof_valid = self.gof_available
        if self.gof_available:
            self.chi_square_statistic = float(np.sum(
                (self.pooled_observed_counts - self.pooled_expected_counts) ** 2
                / self.pooled_expected_counts))
            self.chi_square_p_value = float(
                chi2.sf(self.chi_square_statistic, self.chi_square_df))
            self.chi_square_critical = float(
                chi2.ppf(1.0 - significance, self.chi_square_df))
            self.gof_reject = bool(self.chi_square_p_value < significance)
            self.gof_reason = None
            self.gof_status = ('reject' if self.gof_reject
                               else 'fail_to_reject')
        else:
            self.chi_square_statistic = None
            self.chi_square_p_value = None
            self.chi_square_critical = None
            self.gof_reject = None
            self.gof_reason = (
                'At least 3 pooled intervals with expected counts >= 5 are '
                'required for the chi-square goodness-of-fit test.')
            self.gof_status = 'unavailable'

        self.results = pd.DataFrame({
            'Parameter': [
                'Beta', 'Lambda', 'Instantaneous intensity at final time',
                'Instantaneous MTBF at final time',
                'Final-interval average intensity',
                'Final-interval average MTBF',
                'Final-interval average MTBF lower',
                'Final-interval average MTBF upper',
                'Chi-square statistic'],
            'Value': [
                self.beta, self.Lambda,
                self.instantaneous_failure_intensity_at_end,
                self.instantaneous_MTBF_at_end,
                self.last_interval_average_failure_intensity,
                self.last_interval_average_MTBF,
                self.last_interval_average_MTBF_lower,
                self.last_interval_average_MTBF_upper,
                self.chi_square_statistic],
        })

    def expected_failures(self, t):
        values = CrowAMSAA._evaluation_times(t, allow_zero=True)
        with np.errstate(divide='ignore'):
            out = _safe_exp(self.log_Lambda + self.beta * np.log(values))
        out = np.where(values == 0, 0.0, out)
        return CrowAMSAA._scalar_or_array(np.asarray(out))

    def failure_intensity(self, t):
        values = CrowAMSAA._evaluation_times(t, allow_zero=False)
        out = _safe_exp(
            self.log_Lambda + math.log(self.beta)
            + (self.beta - 1.0) * np.log(values))
        return CrowAMSAA._scalar_or_array(np.asarray(out))

    def MTBF_instantaneous(self, t):
        out = 1.0 / np.asarray(self.failure_intensity(t), dtype=float)
        return CrowAMSAA._scalar_or_array(np.asarray(out))

    def __repr__(self):
        return (f'CrowAMSAAGrouped(k={self.n_intervals}, '
                f'n={self.n_failures}, T={self.T:g}, beta={self.beta:.4f}, '
                f'Lambda={self.Lambda:.6g})')


class Duane:
    """Duane reliability growth model (graphical / regression method).

    Regresses log10(cumulative MTBF) on log10(time), where the
    cumulative MTBF at the i-th failure is m_c(t_i) = t_i / i.

    Parameters
    ----------
    times : array-like
        Cumulative (system age) failure times, sorted ascending.
    T : float, optional
        Total test time. If None, T = times[-1].

    Attributes
    ----------
    alpha : float
        Duane growth slope. Positive indicates reliability growth.
    b : float
        Intercept of the regression line (log10 scale).
    A : float
        10**b, so that m_c(t) = A * t^alpha.
    n : int
        Number of failures.
    r_squared : float
        Coefficient of determination of the regression.
    DMTBF_C : float
        Cumulative MTBF at T: A * T^alpha.
    DMTBF_I : float
        Instantaneous (demonstrated) MTBF at T: DMTBF_C / (1 - alpha),
        or None when alpha is outside 0 <= alpha < 1.
    results : pandas.DataFrame
        Summary table with Parameter / Value rows.
    """

    def __init__(self, times, T=None):
        times = _validate_times(times)
        n = len(times)
        if T is None:
            T = times[-1]
        else:
            T = float(T)
            if T < times[-1]:
                raise ValueError('T must be >= the largest failure time.')

        i = np.arange(1, n + 1)
        mc = times / i
        x = np.log10(times)
        y = np.log10(mc)

        alpha, b = np.polyfit(x, y, 1)
        y_hat = b + alpha * x
        ss_res = np.sum((y - y_hat) ** 2)
        ss_tot = np.sum((y - np.mean(y)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

        self.times = times
        self.n = n
        self.T = T
        self.alpha = alpha
        self.b = b
        self.A = 10 ** b
        self.r_squared = r_squared
        self.DMTBF_C = self.A * T ** alpha
        self.valid_growth_regime = bool(0.0 <= alpha < 1.0)
        if self.valid_growth_regime:
            self.DMTBF_I = self.DMTBF_C / (1 - alpha)
            self.regime_warning = None
        else:
            self.DMTBF_I = None
            self.regime_warning = (
                f'Duane instantaneous MTBF is withheld because alpha={alpha:.6g} '
                'is outside the model growth regime 0 <= alpha < 1. Use '
                'Crow-AMSAA and investigate deterioration or change points.'
            )

        self.results = pd.DataFrame({
            'Parameter': ['Alpha (growth slope)', 'A (10^intercept)',
                          'R-squared', 'Instantaneous MTBF at T (DMTBF_I)',
                          'Cumulative MTBF at T (DMTBF_C)'],
            'Value': [self.alpha, self.A, self.r_squared,
                      self.DMTBF_I, self.DMTBF_C],
        })

    def MTBF_cumulative(self, t):
        """Cumulative MTBF m_c(t) = A * t^alpha.

        Parameters
        ----------
        t : float or array-like
            Time(s) at which to evaluate.

        Returns
        -------
        float or numpy.ndarray
        """
        t = np.asarray(t, dtype=float)
        out = self.A * t ** self.alpha
        return out.item() if out.ndim == 0 else out

    def MTBF_instantaneous(self, t):
        """Instantaneous MTBF m_i(t) = A * t^alpha / (1 - alpha).

        Parameters
        ----------
        t : float or array-like
            Time(s) at which to evaluate.

        Returns
        -------
        float or numpy.ndarray
        """
        t = np.asarray(t, dtype=float)
        if not self.valid_growth_regime:
            if t.ndim == 0:
                return None
            return np.full(t.shape, np.nan, dtype=float)
        out = self.A * t ** self.alpha / (1 - self.alpha)
        return out.item() if out.ndim == 0 else out

    def __repr__(self):
        instantaneous = ('withheld' if self.DMTBF_I is None
                         else f'{self.DMTBF_I:.4f}')
        return (f'Duane(n={self.n}, T={self.T:g}, alpha={self.alpha:.4f}, '
                f'A={self.A:.6g}, r_squared={self.r_squared:.4f}, '
                f'DMTBF_I={instantaneous})')


# ── Optimal replacement time ─────────────────────────────────────────────────

def optimal_replacement_time(cost_PM, cost_CM, weibull_alpha, weibull_beta,
                             q=0, t_max=None, n_points=10000):
    """Optimal preventive-maintenance (replacement) interval.

    Balances the cost of scheduled preventive maintenance (PM) against the
    higher cost of unplanned corrective maintenance (CM) after a failure, by
    minimising the long-run cost per unit time as a function of the replacement
    interval ``t``. The underlying failure distribution is Weibull(alpha, beta).

    Parameters
    ----------
    cost_PM : float
        Cost of a preventive (scheduled) replacement. Must be < cost_CM.
    cost_CM : float
        Cost of a corrective (unplanned, post-failure) replacement.
    weibull_alpha : float
        Weibull scale parameter (characteristic life).
    weibull_beta : float
        Weibull shape parameter. Replacement only pays off when beta > 1
        (wear-out); for beta <= 1 there is no finite optimum.
    q : int, optional
        Maintenance/renewal assumption. ``0`` (default) = age replacement:
        replace on failure or at age T, with either event renewing the item.
        ``1`` = block replacement at T with minimal repairs between scheduled
        replacements (Power-Law NHPP).
    t_max : float, optional
        Initial upper bound for the plotted/search range. Defaults to
        3 * alpha. If a finite optimum lies beyond it, the range is expanded
        and this is reported rather than treating the boundary as an optimum.
    n_points : int, optional
        Number of grid points used for the search.

    Returns
    -------
    dict
        ``optimal_replacement_time`` (``None`` for run-to-failure),
        ``decision``, ``finite_optimum``, ``min_cost`` (cost per unit time at
        the decision), the corrective-only baseline, boundary/search
        diagnostics, plotting arrays, and ``q``.
    """
    cost_PM = float(cost_PM)
    cost_CM = float(cost_CM)
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    if cost_PM <= 0 or cost_CM <= 0:
        raise ValueError('Costs must be positive.')
    if cost_PM >= cost_CM:
        raise ValueError('cost_PM must be less than cost_CM (otherwise '
                         'preventive maintenance is never worthwhile).')
    if alpha <= 0 or beta <= 0:
        raise ValueError('weibull_alpha and weibull_beta must be positive.')
    if q not in (0, 1):
        raise ValueError("q must be 0 ('as good as new') or 1 ('as good as old').")
    if n_points < 2:
        raise ValueError('n_points must be at least 2.')
    if t_max is not None and float(t_max) <= 0:
        raise ValueError('t_max must be positive.')

    # Baseline: always running to failure (corrective only) — one corrective
    # replacement per MTTF = alpha * Gamma(1 + 1/beta) on average. (Dividing by
    # alpha alone understates the do-nothing cost whenever beta != 1.)
    mttf = alpha * math.gamma(1.0 + 1.0 / beta)
    corrective_only = float(cost_CM / mttf)
    requested_t_max = float(t_max) if t_max is not None else 3.0 * alpha

    finite_optimum = False
    optimal_time = None
    decision = 'run_to_failure'
    decision_reason = (
        'Weibull beta <= 1 has non-increasing hazard, so scheduled preventive '
        'replacement has no finite cost-rate optimum.'
    )
    search_limit = 1e12 * alpha

    if beta > 1.0:
        if q == 1:
            # C(T) = Cp/T + Cc*T^(beta-1)/alpha^beta has a closed-form minimum.
            candidate = alpha * (cost_PM / (cost_CM * (beta - 1.0))) ** (1.0 / beta)
        else:
            # For age replacement, C'(T)=0 reduces after division by R(T) to
            # (Cc-Cp) h(T) integral_0^T R(s)ds = Cc-(Cc-Cp)R(T).
            # Solve in log(T/alpha) so very small/large candidates remain stable.
            from scipy.optimize import brentq
            from scipy.special import gammainc

            delta_cost = cost_CM - cost_PM

            def stationary_equation(log_x):
                log_z = beta * log_x
                if log_z > math.log(745.0):
                    z = math.inf
                    reliability = 0.0
                    cycle_length = mttf
                else:
                    z = math.exp(log_z)
                    reliability = math.exp(-z)
                    cycle_length = mttf * float(gammainc(1.0 / beta, z))
                log_h_factor = (beta - 1.0) * log_x
                if log_h_factor > 700.0:
                    hazard_times_cycle = math.inf
                else:
                    hazard_times_cycle = (
                        beta / alpha * math.exp(log_h_factor) * cycle_length
                    )
                return (
                    delta_cost * hazard_times_cycle
                    - (cost_CM - delta_cost * reliability)
                )

            log_lo = math.log(np.finfo(float).eps)
            log_hi = math.log(max(requested_t_max / alpha, 1.0))
            log_limit = math.log(1e12)
            while stationary_equation(log_hi) <= 0.0 and log_hi < log_limit:
                log_hi = min(log_hi + math.log(2.0), log_limit)
            if stationary_equation(log_hi) > 0.0:
                candidate = alpha * math.exp(brentq(
                    stationary_equation, log_lo, log_hi, xtol=1e-12, rtol=1e-12
                ))
            else:
                candidate = math.inf

        if math.isfinite(candidate) and 0.0 < candidate <= search_limit:
            finite_optimum = True
            optimal_time = float(candidate)
            decision = 'preventive_replacement'
            decision_reason = 'A finite interior cost-rate minimum was found for beta > 1.'
        else:
            decision_reason = (
                'The cost curve was still decreasing at the qualified search '
                'limit; the boundary is not reported as an optimum. Use the '
                'run-to-failure baseline unless a practical planning bound is supplied.'
            )

    plot_t_max = requested_t_max
    search_expanded = False
    if finite_optimum and optimal_time >= requested_t_max:
        plot_t_max = max(requested_t_max, 1.25 * optimal_time)
        search_expanded = True
    t = np.linspace(plot_t_max / n_points, plot_t_max, n_points)

    if q == 1:
        # Minimal-repair block policy: E[N(T)] = H(T).
        H = (t / alpha) ** beta
        cost_per_time = (cost_PM + cost_CM * H) / t
    else:
        # Renewal age policy, using the analytic truncated Weibull mean rather
        # than a grid-dependent cumulative sum.
        from scipy.special import gammainc
        z = (t / alpha) ** beta
        R = np.exp(-z)
        integral_R = mttf * gammainc(1.0 / beta, z)
        cost_per_time = (cost_PM * R + cost_CM * (1.0 - R)) / integral_R

    if finite_optimum:
        if q == 1:
            z_opt = (optimal_time / alpha) ** beta
            min_cost = (cost_PM + cost_CM * z_opt) / optimal_time
        else:
            from scipy.special import gammainc
            z_opt = (optimal_time / alpha) ** beta
            r_opt = math.exp(-z_opt)
            cycle_opt = mttf * float(gammainc(1.0 / beta, z_opt))
            min_cost = (cost_PM * r_opt + cost_CM * (1.0 - r_opt)) / cycle_opt
    else:
        min_cost = corrective_only

    sampled_idx = int(np.nanargmin(cost_per_time))
    boundary_minimum = not finite_optimum and sampled_idx == len(t) - 1
    return {
        'optimal_replacement_time': optimal_time,
        'min_cost': float(min_cost),
        'corrective_only_cost_rate': corrective_only,
        # Back-compat alias for the old (mislabeled) key.
        'cost_PM_per_unit_time': corrective_only,
        'time': t.tolist(),
        'cost': [None if not np.isfinite(c) else float(c) for c in cost_per_time],
        'q': q,
        'decision': decision,
        'finite_optimum': finite_optimum,
        'decision_reason': decision_reason,
        'boundary_minimum': boundary_minimum,
        'search_expanded': search_expanded,
        'requested_t_max': requested_t_max,
        'evaluated_t_max': float(plot_t_max),
    }


# ── Replacement-policy comparison & maintenance-cost forecast ─────────────────

def _age_metrics(cost_PM, cost_CM, alpha, beta, T, n=4000):
    """Long-run metrics for an AGE replacement policy at interval ``T``.

    Age replacement (Barlow-Proschan): replace on failure or at age ``T``,
    whichever comes first, each renewing the item. Cycle length
    ``E[min(X, T)] = ∫_0^T R(s) ds``; a cycle ends in corrective replacement with
    probability ``F(T)`` and in preventive replacement with probability ``R(T)``.
    """
    T = float(T)
    if T <= 0:
        return None
    from scipy.special import gammainc
    mttf = alpha * math.gamma(1.0 + 1.0 / beta)
    z = (T / alpha) ** beta
    # Exact E[min(X,T)] for Weibull X via the lower incomplete gamma.
    e_cycle = mttf * float(gammainc(1.0 / beta, z))
    if e_cycle <= 0:
        return None
    R_T = float(np.exp(-z))
    F_T = 1.0 - R_T
    return {
        'cost_rate': (cost_PM * R_T + cost_CM * F_T) / e_cycle,
        'pm_per_time': R_T / e_cycle,
        'cm_per_time': F_T / e_cycle,
    }


def _block_metrics(cost_PM, cost_CM, alpha, beta, T):
    """Long-run metrics for a BLOCK (periodic) replacement policy at interval ``T``.

    Preventive replacement every ``T`` regardless of age; failures in between are
    minimally repaired (as good as old), so the expected number of corrective
    events per interval is the cumulative hazard ``H(T) = (T/alpha)^beta``.
    """
    T = float(T)
    if T <= 0:
        return None
    H = (T / alpha) ** beta
    return {
        'cost_rate': (cost_PM + cost_CM * H) / T,
        'pm_per_time': 1.0 / T,
        'cm_per_time': H / T,
    }


def replacement_policy_comparison(cost_PM, cost_CM, weibull_alpha, weibull_beta,
                                  t_max=None, n_points=10000):
    """Compare AGE vs BLOCK preventive-replacement policies for a Weibull item.

    Both policies trade scheduled preventive-maintenance (PM) cost against the
    higher cost of unplanned corrective maintenance (CM). This finds each
    policy's optimal interval and long-run cost per unit time (reusing
    :func:`optimal_replacement_time` — ``q=0`` is age replacement, ``q=1`` is
    block/periodic replacement with minimal repair), and reports the expected
    PM and CM events per unit time at each optimum, the corrective-only
    baseline, and which policy is cheaper.

    Returns
    -------
    dict
        ``age`` and ``block`` sub-dicts (``optimal_time``, ``min_cost``,
        ``pm_per_time``, ``cm_per_time``, ``time``, ``cost``),
        ``corrective_only_cost``, ``mttf`` and ``cheaper_policy``.
    """
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    if float(cost_PM) <= 0 or float(cost_CM) <= 0:
        raise ValueError('Costs must be positive.')
    if alpha <= 0 or beta <= 0:
        raise ValueError('weibull_alpha and weibull_beta must be positive.')

    age = optimal_replacement_time(cost_PM, cost_CM, alpha, beta, q=0,
                                   t_max=t_max, n_points=n_points)
    block = optimal_replacement_time(cost_PM, cost_CM, alpha, beta, q=1,
                                     t_max=t_max, n_points=n_points)
    mttf = alpha * math.gamma(1.0 + 1.0 / beta)
    corrective_only = float(cost_CM) / mttf

    if age['optimal_replacement_time'] is None:
        am = {'pm_per_time': 0.0, 'cm_per_time': 1.0 / mttf}
    else:
        am = _age_metrics(cost_PM, cost_CM, alpha, beta, age['optimal_replacement_time'])
    if block['optimal_replacement_time'] is None:
        # The product-level decision is no scheduled PM. Use the same renewal
        # corrective baseline for a directly comparable policy table.
        bm = {'pm_per_time': 0.0, 'cm_per_time': 1.0 / mttf}
    else:
        bm = _block_metrics(cost_PM, cost_CM, alpha, beta, block['optimal_replacement_time'])

    candidates = [
        (name, result) for name, result in (('age', age), ('block', block))
        if result['finite_optimum']
        and result['min_cost'] < corrective_only * (1.0 - 1e-12)
    ]
    cheaper = min(candidates, key=lambda item: item[1]['min_cost'])[0] if candidates else 'corrective'

    def _policy_payload(result, metrics):
        return {
            'optimal_time': result['optimal_replacement_time'],
            'min_cost': result['min_cost'],
            'pm_per_time': metrics['pm_per_time'] if metrics else None,
            'cm_per_time': metrics['cm_per_time'] if metrics else None,
            'time': result['time'],
            'cost': result['cost'],
            'decision': result['decision'],
            'finite_optimum': result['finite_optimum'],
            'decision_reason': result['decision_reason'],
            'boundary_minimum': result['boundary_minimum'],
            'search_expanded': result['search_expanded'],
        }

    return {
        'age': _policy_payload(age, am),
        'block': _policy_payload(block, bm),
        'corrective_only_cost': corrective_only,
        'mttf': float(mttf),
        'cheaper_policy': cheaper,
        'recommendation': (
            'Run to failure; no finite preventive-replacement interval is cost-optimal.'
            if cheaper == 'corrective'
            else f"Use the {cheaper} preventive-replacement policy."
        ),
        'analysis_basis': 'long_run_renewal_reward_cost_rate',
        'maintenance_assumptions': {
            'age': 'Perfect renewal after failure or scheduled age replacement.',
            'block': 'Minimal repair between perfect scheduled block replacements.',
            'corrective': 'Perfect renewal after each failure.',
        },
    }


def maintenance_cost_forecast(policy, cost_PM, cost_CM, weibull_alpha,
                              weibull_beta, horizon, interval=None, n_points=200):
    """Forecast expected maintenance events and cost over a planning horizon.

    ``policy`` is one of ``'corrective'`` (run-to-failure, renewal),
    ``'age'`` or ``'block'``. For age/block an ``interval`` may be given;
    otherwise that policy's optimal interval is used. Long-run event rates and
    cost per unit time come from the same models as
    :func:`replacement_policy_comparison`; the corrective-only case uses the
    Weibull mean time to failure ``MTTF = alpha·Γ(1 + 1/beta)``.

    Returns
    -------
    dict
        ``policy``, ``interval`` (used), ``expected_pm``, ``expected_cm``,
        ``total_cost``, ``cost_rate``, ``mttf``, and ``time`` /
        ``cumulative_cost`` arrays for plotting.
    """
    policy = str(policy).lower()
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    cost_PM = float(cost_PM)
    cost_CM = float(cost_CM)
    horizon = float(horizon)
    if cost_PM <= 0 or cost_CM <= 0:
        raise ValueError('Costs must be positive.')
    if alpha <= 0 or beta <= 0:
        raise ValueError('weibull_alpha and weibull_beta must be positive.')
    if horizon <= 0:
        raise ValueError('horizon must be positive.')

    mttf = alpha * math.gamma(1.0 + 1.0 / beta)

    if policy == 'corrective':
        cost_rate = cost_CM / mttf
        pm_rate, cm_rate = 0.0, 1.0 / mttf
        used_interval = None
    elif policy == 'age':
        optimum = None if interval else optimal_replacement_time(
            cost_PM, cost_CM, alpha, beta, q=0)
        T = float(interval) if interval else optimum['optimal_replacement_time']
        if T is None:
            cost_rate, pm_rate, cm_rate = cost_CM / mttf, 0.0, 1.0 / mttf
            used_interval = None
        else:
            m = _age_metrics(cost_PM, cost_CM, alpha, beta, T)
            if m is None:
                raise ValueError('interval must be positive.')
            cost_rate, pm_rate, cm_rate = m['cost_rate'], m['pm_per_time'], m['cm_per_time']
            used_interval = T
    elif policy == 'block':
        optimum = None if interval else optimal_replacement_time(
            cost_PM, cost_CM, alpha, beta, q=1)
        T = float(interval) if interval else optimum['optimal_replacement_time']
        if T is None:
            cost_rate, pm_rate, cm_rate = cost_CM / mttf, 0.0, 1.0 / mttf
            used_interval = None
        else:
            m = _block_metrics(cost_PM, cost_CM, alpha, beta, T)
            if m is None:
                raise ValueError('interval must be positive.')
            cost_rate, pm_rate, cm_rate = m['cost_rate'], m['pm_per_time'], m['cm_per_time']
            used_interval = T
    else:
        raise ValueError("policy must be one of 'corrective', 'age', 'block'.")

    t = np.linspace(0.0, horizon, n_points)
    cumulative_cost = cost_rate * t
    return {
        'policy': policy,
        'interval': used_interval,
        'expected_pm': float(pm_rate * horizon),
        'expected_cm': float(cm_rate * horizon),
        'total_cost': float(cost_rate * horizon),
        'cost_rate': float(cost_rate),
        'mttf': float(mttf),
        'time': t.tolist(),
        'cumulative_cost': cumulative_cost.tolist(),
        'analysis_basis': 'long_run_rate_projected_over_finite_horizon',
        'finite_horizon_transients_modeled': False,
        'assumption_note': (
            'Expected event and cost counts are the selected policy long-run '
            'renewal/reward rates multiplied by the horizon. Use the virtual-age '
            'simulation for imperfect repair and finite-horizon uncertainty.'
        ),
    }


def simulate_virtual_age_maintenance(
        weibull_alpha, weibull_beta, horizon, preventive_interval=None,
        repair_effectiveness=0.0, preventive_effectiveness=None,
        cost_CM=0.0, cost_PM=0.0, corrective_downtime=0.0,
        preventive_downtime=0.0, n_simulations=2000, CI=0.95, seed=None,
        n_time_points=101):
    """Finite-horizon Kijima-II virtual-age maintenance simulation.

    The baseline lifetime is Weibull. Immediately before a maintenance action
    the item has virtual age ``v``; immediately after it has ``q*v``. Thus
    ``q=0`` is perfect renewal and ``q=1`` is minimal repair. Corrective and
    preventive effectiveness can differ. The simulation advances calendar
    time through explicit maintenance downtime, so reported availability is a
    finite-horizon result rather than a steady-state rate approximation.
    """
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    horizon = float(horizon)
    q_cm = float(repair_effectiveness)
    q_pm = q_cm if preventive_effectiveness is None else float(preventive_effectiveness)
    cost_CM = float(cost_CM)
    cost_PM = float(cost_PM)
    corrective_downtime = float(corrective_downtime)
    preventive_downtime = float(preventive_downtime)
    CI = float(CI)
    if alpha <= 0 or beta <= 0 or horizon <= 0:
        raise ValueError('weibull_alpha, weibull_beta, and horizon must be positive.')
    if preventive_interval is not None and float(preventive_interval) <= 0:
        raise ValueError('preventive_interval must be positive when supplied.')
    if not 0 <= q_cm <= 1 or not 0 <= q_pm <= 1:
        raise ValueError('Maintenance effectiveness q must be between 0 and 1.')
    if min(cost_CM, cost_PM, corrective_downtime, preventive_downtime) < 0:
        raise ValueError('Costs and downtime values must be non-negative.')
    if isinstance(n_simulations, bool) or int(n_simulations) != n_simulations:
        raise ValueError('n_simulations must be a positive integer.')
    n_simulations = int(n_simulations)
    if not 100 <= n_simulations <= 100_000:
        raise ValueError('n_simulations must be between 100 and 100000.')
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')
    if n_time_points < 2:
        raise ValueError('n_time_points must be at least 2.')

    interval = (None if preventive_interval is None
                else float(preventive_interval))
    rng = np.random.default_rng(seed)
    failures = np.zeros(n_simulations, dtype=int)
    preventive_actions = np.zeros(n_simulations, dtype=int)
    total_cost = np.zeros(n_simulations, dtype=float)
    availability = np.ones(n_simulations, dtype=float)
    downtime_total = np.zeros(n_simulations, dtype=float)
    time_grid = np.linspace(0.0, horizon, int(n_time_points))
    cumulative_failures = np.zeros((n_simulations, len(time_grid)), dtype=float)

    for simulation in range(n_simulations):
        calendar_time = 0.0
        virtual_age = 0.0
        next_pm = interval
        failure_times = []
        downtime = 0.0
        event_guard = 0

        while calendar_time < horizon:
            cumulative_hazard = (virtual_age / alpha) ** beta
            exponential_draw = rng.exponential()
            next_virtual_age = alpha * (
                cumulative_hazard + exponential_draw) ** (1.0 / beta)
            time_to_failure = max(
                next_virtual_age - virtual_age,
                np.finfo(float).eps * max(1.0, alpha),
            )
            failure_calendar_time = calendar_time + time_to_failure

            if (next_pm is not None and next_pm <= failure_calendar_time
                    and next_pm <= horizon):
                operating_time = max(0.0, next_pm - calendar_time)
                virtual_age += operating_time
                calendar_time = next_pm
                preventive_actions[simulation] += 1
                virtual_age = q_pm * virtual_age
                applied_downtime = min(preventive_downtime,
                                       max(0.0, horizon - calendar_time))
                downtime += applied_downtime
                calendar_time += applied_downtime
                while next_pm is not None and next_pm <= calendar_time:
                    next_pm += interval
            elif failure_calendar_time <= horizon:
                calendar_time = failure_calendar_time
                virtual_age = next_virtual_age
                failures[simulation] += 1
                failure_times.append(calendar_time)
                virtual_age = q_cm * virtual_age
                applied_downtime = min(corrective_downtime,
                                       max(0.0, horizon - calendar_time))
                downtime += applied_downtime
                calendar_time += applied_downtime
                while next_pm is not None and next_pm <= calendar_time:
                    next_pm += interval
            else:
                break

            event_guard += 1
            if event_guard > 1_000_000:
                raise RuntimeError(
                    'Virtual-age simulation exceeded one million events in a '
                    'replicate; check the horizon and Weibull parameters.')

        downtime_total[simulation] = downtime
        availability[simulation] = max(0.0, 1.0 - downtime / horizon)
        total_cost[simulation] = (
            failures[simulation] * cost_CM
            + preventive_actions[simulation] * cost_PM
        )
        if failure_times:
            cumulative_failures[simulation] = np.searchsorted(
                failure_times, time_grid, side='right')

    tail = (1.0 - CI) / 2.0

    def summary(values):
        values = np.asarray(values, dtype=float)
        return {
            'mean': float(np.mean(values)),
            'median': float(np.median(values)),
            'lower': float(np.quantile(values, tail)),
            'upper': float(np.quantile(values, 1.0 - tail)),
        }

    return {
        'model': 'kijima_type_ii_virtual_age',
        'analysis_basis': 'finite_horizon_monte_carlo',
        'horizon': horizon,
        'weibull_alpha': alpha,
        'weibull_beta': beta,
        'preventive_interval': interval,
        'repair_effectiveness': q_cm,
        'preventive_effectiveness': q_pm,
        'n_simulations': n_simulations,
        'CI': CI,
        'seed': seed,
        'failures': summary(failures),
        'preventive_actions': summary(preventive_actions),
        'total_cost': summary(total_cost),
        'availability': summary(availability),
        'downtime': summary(downtime_total),
        'curve': {
            'time': time_grid.tolist(),
            'mean_cumulative_failures': np.mean(
                cumulative_failures, axis=0).tolist(),
            'lower_cumulative_failures': np.quantile(
                cumulative_failures, tail, axis=0).tolist(),
            'upper_cumulative_failures': np.quantile(
                cumulative_failures, 1.0 - tail, axis=0).tolist(),
        },
        'assumptions': [
            'Baseline time to failure follows the supplied Weibull model.',
            'Kijima Type II sets post-maintenance virtual age to q times pre-maintenance virtual age.',
            'Preventive actions follow a fixed calendar schedule; downtime suspends aging.',
            'Replicates are independent and parameter uncertainty is not included.',
        ],
    }


# ── Rate of occurrence of failures (ROCOF) ───────────────────────────────────

def ROCOF(times_between_failures=None, failure_times=None, test_end=None,
          CI=0.95):
    """Rate of occurrence of failures with the Laplace trend test.

    Determines whether a repairable system's failure inter-arrival times show a
    statistically significant trend (improving, worsening, or none) using the
    Laplace centroid test, and, where a trend exists, fits a Power-Law NHPP.

    Parameters
    ----------
    times_between_failures : array-like, optional
        Failure inter-arrival times (gaps between successive failures).
    failure_times : array-like, optional
        Cumulative failure times (system ages). Provide this OR
        ``times_between_failures``.
    test_end : float, optional
        Total observation time. If omitted the test is treated as
        failure-terminated (ends at the last failure).
    CI : float, optional
        Confidence level for the two-sided trend test (default 0.95).

    Returns
    -------
    dict
        ``U`` (Laplace statistic), ``z_crit``, ``trend``
        ('improving' | 'worsening' | 'no trend'), ``p_value``, ``ROCOF``
        (constant estimate, when there is no trend), and ``Lambda_hat`` /
        ``Beta_hat`` (Power-Law NHPP parameters, when a trend exists).
    """
    from scipy import stats as ss

    if (times_between_failures is None) == (failure_times is None):
        raise ValueError('Provide exactly one of times_between_failures or '
                         'failure_times.')

    if times_between_failures is not None:
        gaps = np.asarray(times_between_failures, dtype=float)
        if np.any(gaps <= 0):
            raise ValueError('times_between_failures must all be positive.')
        t = np.cumsum(gaps)
    else:
        t = _validate_times(failure_times)

    n = len(t)
    if n < 2:
        raise ValueError('At least 2 failures are required.')

    if test_end is None:
        failure_terminated = True
        T = t[-1]
        event_times = t[:-1]      # last event defines T; exclude from centroid
        m = n - 1
    else:
        failure_terminated = False
        T = float(test_end)
        if T < t[-1]:
            raise ValueError('test_end must be >= the last failure time.')
        event_times = t
        m = n

    if m < 1:
        raise ValueError('Not enough failures for a trend test.')

    # Laplace centroid statistic; ~N(0,1) under a homogeneous Poisson process.
    U = (np.sum(event_times) - m * T / 2.0) / (T * np.sqrt(m / 12.0))
    z_crit = float(ss.norm.ppf(1 - (1 - CI) / 2.0))
    p_value = float(2 * ss.norm.sf(abs(U)))

    out = {
        'U': float(U),
        'z_crit': z_crit,
        'p_value': p_value,
        'CI': CI,
        'n_failures': n,
        'test_end': T,
        'failure_terminated': failure_terminated,
        'ROCOF': None,
        'Lambda_hat': None,
        'Beta_hat': None,
    }

    if abs(U) <= z_crit:
        # No significant trend: ROCOF is constant, estimated as n / T.
        out['trend'] = 'no trend'
        out['ROCOF'] = float(n / T)
    else:
        # Significant trend: fit Power-Law NHPP (same MLE as Crow-AMSAA).
        # U < 0 means the failure inter-arrival times are lengthening (the
        # system is improving / ROCOF decreasing); U > 0 is the reverse.
        out['trend'] = 'improving' if U < 0 else 'worsening'
        if failure_terminated:
            log_sum = np.sum(np.log(T / t[:-1]))
        else:
            log_sum = np.sum(np.log(T / t))
        if log_sum > 0:
            Beta_hat = n / log_sum
            out['Beta_hat'] = float(Beta_hat)
            out['Lambda_hat'] = float(n / T ** Beta_hat)
    return out


# ── Mean Cumulative Function (MCF) ───────────────────────────────────────────

def _mcf_prepare(data=None, observation_ends=None, records=None):
    """Validate recurrent-event histories with explicit censoring semantics.

    Supply either ``data`` (event-time lists) plus one ``observation_ends``
    value per system, or long-form ``records`` containing ``system_id``,
    ``time``, and an explicit ``status`` of ``"event"`` or ``"censor"``.
    A recurrence tied with the observation end is retained and evaluated
    before the unit leaves the risk set.
    """
    if records is not None and (data is not None or observation_ends is not None):
        raise ValueError('Supply either records or data+observation_ends, not both.')

    systems = []
    if records is not None:
        if len(records) < 1:
            raise ValueError('records must contain at least one observation.')
        grouped = {}
        for record in records:
            item = dict(record)
            if 'system_id' not in item or 'time' not in item or 'status' not in item:
                raise ValueError(
                    'Each MCF record requires system_id, time, and status.')
            system_id = str(item['system_id'])
            time = float(item['time'])
            status = str(item['status']).strip().lower()
            if not np.isfinite(time) or time < 0:
                raise ValueError('All event and censor times must be finite and non-negative.')
            if status not in {'event', 'censor'}:
                raise ValueError("MCF record status must be 'event' or 'censor'.")
            history = grouped.setdefault(system_id, {'events': [], 'censors': []})
            if status == 'event':
                raw_count = item.get('count', 1)
                if (isinstance(raw_count, (bool, np.bool_))
                        or not np.isscalar(raw_count)):
                    raise ValueError(
                        'MCF event counts must be positive integers.')
                try:
                    numeric_count = float(raw_count)
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        'MCF event counts must be positive integers.') from exc
                if (not np.isfinite(numeric_count) or numeric_count < 1
                        or numeric_count != math.floor(numeric_count)):
                    raise ValueError('MCF event counts must be positive integers.')
                count = int(numeric_count)
                history['events'].extend([time] * count)
            else:
                history['censors'].append(time)
        for system_id, history in grouped.items():
            if len(history['censors']) != 1:
                raise ValueError(
                    f"System {system_id!r} requires exactly one censor record; "
                    f"found {len(history['censors'])}.")
            censor = history['censors'][0]
            repairs = np.sort(np.asarray(history['events'], dtype=float))
            if len(repairs) and repairs[-1] > censor:
                raise ValueError(
                    f"System {system_id!r} has an event after its censor time.")
            systems.append((repairs, float(censor)))
        return systems

    if data is None or len(data) < 1:
        raise ValueError('data must contain at least one system.')
    if observation_ends is None:
        raise ValueError(
            'observation_ends is required. The last event time is no longer '
            'silently treated as censoring; provide each system end explicitly.')
    if len(observation_ends) != len(data):
        raise ValueError('observation_ends must have one value per system.')

    for index, (row, end) in enumerate(zip(data, observation_ends)):
        repairs = np.asarray(row, dtype=float)
        if repairs.ndim != 1:
            raise ValueError('Each system event history must be one-dimensional.')
        censor = float(end)
        if (not np.isfinite(censor)) or censor < 0:
            raise ValueError('Observation ends must be finite and non-negative.')
        if np.any(~np.isfinite(repairs)) or np.any(repairs < 0):
            raise ValueError('All event times must be finite and non-negative.')
        repairs = np.sort(repairs)
        if len(repairs) and repairs[-1] > censor:
            raise ValueError(
                f'System {index + 1} has an event after its observation end.')
        systems.append((repairs, censor))
    return systems


def _mcf_estimate(systems, event_times=None, include_variance=True):
    """Nelson MCF and Lawless-Nadeau subject-cluster robust variance."""
    n_systems = len(systems)
    censor_times = np.array([censor for _, censor in systems], dtype=float)
    if event_times is None:
        all_repairs = np.concatenate([repairs for repairs, _ in systems]) if any(
            len(repairs) for repairs, _ in systems) else np.array([])
        event_times = np.unique(all_repairs)
    else:
        event_times = np.asarray(event_times, dtype=float)

    mcf = 0.0
    influence = np.zeros(n_systems, dtype=float)
    mcf_out, variance_out, risk_out, event_count_out = [], [], [], []
    for time in event_times:
        at_risk_indicators = (censor_times >= time).astype(float)
        at_risk = int(np.sum(at_risk_indicators))
        if at_risk == 0:
            mcf_out.append(np.nan)
            variance_out.append(np.nan)
            risk_out.append(0)
            event_count_out.append(0)
            continue
        subject_events = np.array([
            int(np.sum(repairs == time)) for repairs, _ in systems
        ], dtype=float)
        events = int(np.sum(subject_events))
        increment = events / at_risk
        mcf += increment
        if include_variance:
            # Subject-cluster influence process for the Nelson estimator.
            # With equal complete follow-up this reduces exactly to the sample
            # variance of subject cumulative counts divided by n.
            influence += (
                subject_events - at_risk_indicators * increment
            ) / at_risk
            variance = (
                n_systems / (n_systems - 1.0) * float(np.sum(influence ** 2))
                if n_systems > 1 else np.nan
            )
        else:
            variance = np.nan
        mcf_out.append(float(mcf))
        variance_out.append(float(variance))
        risk_out.append(at_risk)
        event_count_out.append(events)
    return {
        'time': np.asarray(event_times, dtype=float),
        'MCF': np.asarray(mcf_out, dtype=float),
        'variance': np.asarray(variance_out, dtype=float),
        'at_risk': np.asarray(risk_out, dtype=int),
        'events_at_time': np.asarray(event_count_out, dtype=int),
    }


def MCF_nonparametric(data=None, CI=0.95, observation_ends=None, records=None,
                      interval_method='log_transformed', bootstrap_samples=0,
                      seed=None):
    """Non-parametric Mean Cumulative Function (Nelson estimator).

    Estimates the average cumulative number of recurrences (e.g. repairs) per
    system as a function of time, with confidence bounds. Applicable to
    repairable systems where each recurrence is treated as identical.

    Parameters
    ----------
    data : list of lists
        Event times per system. ``observation_ends`` is mandatory with this
        representation; an event may equal its observation end.
    observation_ends : list of float
        Explicit end-of-observation time for every system in ``data``.
    records : list of mappings, optional
        Long-form alternative with ``system_id``, ``time``, and explicit
        ``status`` (``event`` or ``censor``).
    CI : float, optional
        Confidence level for the bounds (default 0.95).

    Returns
    -------
    dict
        ``time``, ``MCF``, ``MCF_lower``, ``MCF_upper`` arrays, plus the
        ``variance`` at each event time.
    """
    from scipy import stats as ss

    CI = float(CI)
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')
    if interval_method not in {'log_transformed', 'cluster_bootstrap'}:
        raise ValueError(
            "interval_method must be 'log_transformed' or 'cluster_bootstrap'.")
    if isinstance(bootstrap_samples, bool) or int(bootstrap_samples) != bootstrap_samples:
        raise ValueError('bootstrap_samples must be a non-negative integer.')
    bootstrap_samples = int(bootstrap_samples)
    if bootstrap_samples and bootstrap_samples < 50:
        raise ValueError('At least 50 cluster bootstrap samples are required.')
    if interval_method == 'cluster_bootstrap' and bootstrap_samples < 50:
        raise ValueError(
            "interval_method='cluster_bootstrap' requires at least 50 "
            'bootstrap samples.')

    systems = _mcf_prepare(
        data=data, observation_ends=observation_ends, records=records)
    n_systems = len(systems)
    if bootstrap_samples and n_systems < 2:
        raise ValueError(
            'Cluster bootstrap uncertainty requires at least 2 systems.')
    estimate = _mcf_estimate(systems)
    event_times = estimate['time']
    if len(event_times) == 0:
        raise ValueError('No repair events found (every system has only a '
                         'censoring time).')
    z = float(ss.norm.ppf(1 - (1 - CI) / 2.0))
    mcf_values = estimate['MCF']
    standard_errors = np.sqrt(estimate['variance'])
    variance_available = n_systems >= 2
    lower = (np.array(mcf_values, copy=True) if variance_available
             else np.full_like(mcf_values, np.nan))
    upper = (np.array(mcf_values, copy=True) if variance_available
             else np.full_like(mcf_values, np.nan))
    valid = ((mcf_values > 0) & np.isfinite(standard_errors)
             & (standard_errors > 0))
    log_half_width = np.zeros_like(mcf_values)
    log_half_width[valid] = z * standard_errors[valid] / mcf_values[valid]
    lower[valid] = mcf_values[valid] * np.exp(-log_half_width[valid])
    upper[valid] = mcf_values[valid] * np.exp(log_half_width[valid])

    bootstrap = None
    bootstrap_point_available = None
    if bootstrap_samples:
        rng = np.random.default_rng(seed)
        n_systems = len(systems)
        samples = np.full((bootstrap_samples, len(event_times)), np.nan)
        for sample_index in range(bootstrap_samples):
            selected = rng.integers(0, n_systems, size=n_systems)
            resampled = [systems[index] for index in selected]
            samples[sample_index] = _mcf_estimate(
                resampled, event_times=event_times,
                include_variance=False)['MCF']
        valid_replicates = np.sum(np.isfinite(samples), axis=0)
        # Percentile intervals target the unconditional cluster-resampling
        # distribution. Dropping resamples that lose the risk set changes that
        # target, even when only a modest fraction are dropped. Withhold the
        # point unless every requested replicate is defined; a future
        # positive-weight/multiplier bootstrap can avoid this support problem.
        minimum_valid_replicates = bootstrap_samples
        bootstrap_point_available = (
            valid_replicates >= minimum_valid_replicates)
        alpha = 1.0 - CI
        boot_lower = np.full(len(event_times), np.nan)
        boot_upper = np.full(len(event_times), np.nan)
        boot_se = np.full(len(event_times), np.nan)
        for point_index in np.flatnonzero(bootstrap_point_available):
            point_samples = samples[
                np.isfinite(samples[:, point_index]), point_index]
            boot_lower[point_index] = np.quantile(
                point_samples, alpha / 2.0)
            boot_upper[point_index] = np.quantile(
                point_samples, 1.0 - alpha / 2.0)
            boot_se[point_index] = np.std(point_samples, ddof=1)
        bootstrap_status = (
            'available' if np.all(bootstrap_point_available)
            else 'partially_unavailable' if np.any(bootstrap_point_available)
            else 'unavailable')
        bootstrap = {
            'samples': bootstrap_samples,
            'seed': seed,
            'lower': [
                float(value) if np.isfinite(value) else None
                for value in boot_lower],
            'upper': [
                float(value) if np.isfinite(value) else None
                for value in boot_upper],
            'standard_error': [
                float(value) if np.isfinite(value) else None
                for value in boot_se],
            'valid_replicates': valid_replicates.astype(int).tolist(),
            'minimum_valid_replicates': minimum_valid_replicates,
            'point_available': bootstrap_point_available.tolist(),
            'interval_status': bootstrap_status,
            'interval_reason': (
                None if bootstrap_status == 'available' else
                'Bootstrap bounds are withheld wherever any requested '
                'cluster resample loses the observable risk set at that '
                'event time; conditioning on only supported resamples would '
                'change the percentile target.'),
            'resampling_unit': 'system_history_cluster',
            'resampling_target': 'unconditional_cluster_resamples',
        }
        if interval_method == 'cluster_bootstrap':
            lower, upper = boot_lower, boot_upper

    at_risk = estimate['at_risk']
    tail_threshold = max(3, int(math.ceil(0.2 * len(systems))))
    sparse_tail = at_risk < tail_threshold

    if interval_method == 'cluster_bootstrap':
        interval_point_available = bootstrap_point_available
        interval_available = bool(np.all(interval_point_available))
        interval_status = (
            'available' if interval_available
            else 'partially_unavailable' if np.any(interval_point_available)
            else 'unavailable')
        interval_reason = (
            None if interval_available else bootstrap['interval_reason'])
    else:
        interval_point_available = np.isfinite(lower) & np.isfinite(upper)
        interval_available = variance_available
        interval_status = 'available' if variance_available else 'unavailable'
        interval_reason = (
            None if variance_available else
            'At least 2 independent systems are required to estimate '
            'between-system variance and an MCF confidence interval.')

    return {
        'time': event_times.tolist(),
        'MCF': mcf_values.tolist(),
        'MCF_lower': [
            float(value) if np.isfinite(value) else None for value in lower],
        'MCF_upper': [
            float(value) if np.isfinite(value) else None for value in upper],
        'variance': [
            float(value) if np.isfinite(value) else None
            for value in estimate['variance']],
        'standard_error': [
            float(value) if np.isfinite(value) else None
            for value in standard_errors],
        'at_risk': at_risk.tolist(),
        'events_at_time': estimate['events_at_time'].tolist(),
        'CI': CI,
        'variance_method': 'nelson_lawless_nadeau_subject_robust',
        'interval_method': interval_method,
        'bootstrap': bootstrap,
        'n_systems': n_systems,
        'n_events': int(sum(len(repairs) for repairs, _ in systems)),
        'variance_available': variance_available,
        'interval_available': interval_available,
        'interval_point_available': interval_point_available.tolist(),
        'interval_status': interval_status,
        'interval_reason': interval_reason,
        'tail_risk_threshold': tail_threshold,
        'sparse_tail': sparse_tail.tolist(),
        'tail_warning': (
            f'Effective risk set falls below {tail_threshold} systems in the '
            'right tail; interpret tail estimates and intervals cautiously.'
            if np.any(sparse_tail) else None
        ),
        'data_contract': ('explicit_status_records' if records is not None
                          else 'explicit_event_times_and_observation_ends'),
    }


def MCF_parametric(data=None, CI=0.95, observation_ends=None, records=None):
    """Parametric (Power-Law) Mean Cumulative Function.

    Fits ``MCF(t) = (t / alpha) ** beta`` by the pooled NHPP power-law
    maximum likelihood estimator. With unequal system ends ``T_k``, beta is
    the unique root of the profiled likelihood score; the familiar closed
    form ``N / sum(log(T/t_i))`` is used only implicitly when all ends agree.
    (The previous log-log OLS on the non-parametric MCF points is
    heteroscedastic and autocorrelated — the MLE is the standard estimator.)
    A beta < 1 indicates an improving system (repairs becoming less
    frequent), beta = 1 a constant rate, and beta > 1 a worsening system.

    Parameters
    ----------
    data : list of lists
        Event-time lists; pair with explicit ``observation_ends``.
    observation_ends : list of float
        Explicit end-of-observation time for each system.
    records : list of mappings, optional
        Long-form event/censor alternative accepted by
        :func:`MCF_nonparametric`.
    CI : float, optional
        Confidence level passed through to the non-parametric estimate.

    Returns
    -------
    dict
        ``alpha``, ``beta``, ``r_squared`` (descriptive agreement with the
        non-parametric MCF in log-log space), the fitted ``time`` / ``MCF``
        arrays, and the underlying non-parametric estimate under ``np``.
    """
    npest = MCF_nonparametric(
        data=data, observation_ends=observation_ends, CI=CI, records=records)
    systems = _mcf_prepare(
        data=data, observation_ends=observation_ends, records=records)

    from scipy.optimize import brentq, minimize_scalar
    from scipy.special import logsumexp
    from scipy.stats import chi2

    positive_ends = np.asarray(
        [censor for _, censor in systems if censor > 0], dtype=float)
    all_events = np.concatenate(
        [repairs for repairs, _ in systems if len(repairs) > 0])
    if len(all_events) < 2:
        raise ValueError('Not enough repair events to fit a power law.')
    if np.any(all_events <= 0):
        raise ValueError(
            'Power-law MCF fitting requires all event times to be positive.')
    if len(positive_ends) == 0:
        raise ValueError('At least one positive observation end is required.')
    n_events = len(all_events)
    CI = _validate_probability(CI, 'CI')
    sum_log_events = float(np.sum(np.log(all_events)))
    log_ends = np.log(positive_ends)
    reference_time = float(np.max(positive_ends))
    log_reference_time = math.log(reference_time)
    centered_log_ends = log_ends - log_reference_time
    centered_log_event_sum = (
        sum_log_events - n_events * log_reference_time)

    def profile_score(beta_value):
        scaled = beta_value * centered_log_ends
        weights = np.exp(scaled - logsumexp(scaled))
        return (n_events / beta_value + centered_log_event_sum
                - n_events * float(np.dot(weights, centered_log_ends)))

    def relative_profile_loglik(log_beta):
        """Profile log likelihood, with beta-independent terms omitted."""
        beta_value = math.exp(log_beta)
        log_relative_exposure = float(logsumexp(
            beta_value * centered_log_ends))
        return (n_events * log_beta
                + beta_value * centered_log_event_sum
                - n_events * log_relative_exposure)

    low = 1e-12
    high = 1.0
    while profile_score(high) > 0 and high < 1e12:
        high *= 2.0
    if profile_score(high) >= 0:
        raise ValueError('Pooled power-law MCF has no finite beta MLE.')
    beta = float(brentq(profile_score, low, high, xtol=1e-13, rtol=1e-13))
    log_sum_T_beta = float(logsumexp(beta * log_ends))
    log_lambda = math.log(n_events) - log_sum_T_beta
    Lambda = float(_safe_exp(log_lambda))
    log_alpha = -log_lambda / beta
    alpha = float(_safe_exp(log_alpha))
    score_at_solution = float(profile_score(beta))

    # Profile-likelihood uncertainty for beta and the mean cumulative count at
    # the largest observed system age.  Unlike a covariance shortcut, the
    # endpoint interval profiles the shape nuisance parameter jointly with the
    # scale and remains well defined for unequal observation ends.
    cutoff = 0.5 * float(chi2.ppf(CI, 1))
    log_beta_hat = math.log(beta)
    max_profile_loglik = relative_profile_loglik(log_beta_hat)
    target_profile_loglik = max_profile_loglik - cutoff
    log_beta_floor = math.log(1e-12)
    log_beta_ceiling = math.log(1e12)

    def beta_profile_root(log_beta):
        return relative_profile_loglik(log_beta) - target_profile_loglik

    beta_lower = beta_upper = None
    low = log_beta_hat - 1.0
    while low > log_beta_floor and beta_profile_root(low) > 0:
        low -= 1.0
    low = max(low, log_beta_floor)
    if beta_profile_root(low) <= 0:
        beta_lower = float(math.exp(brentq(
            beta_profile_root, low, log_beta_hat,
            xtol=1e-12, rtol=1e-12)))
    high = log_beta_hat + 1.0
    while high < log_beta_ceiling and beta_profile_root(high) > 0:
        high += 1.0
    high = min(high, log_beta_ceiling)
    if beta_profile_root(high) <= 0:
        beta_upper = float(math.exp(brentq(
            beta_profile_root, log_beta_hat, high,
            xtol=1e-12, rtol=1e-12)))

    log_relative_exposure_hat = float(logsumexp(
        beta * centered_log_ends))
    log_endpoint_mcf = math.log(n_events) - log_relative_exposure_hat
    endpoint_mcf = float(_safe_exp(log_endpoint_mcf))

    def endpoint_target_profile(log_mean):
        def negative_loglik(log_beta):
            beta_value = math.exp(log_beta)
            log_relative_exposure = float(logsumexp(
                beta_value * centered_log_ends))
            mean_exposure = float(_safe_exp(
                log_mean + log_relative_exposure))
            if not np.isfinite(mean_exposure):
                return math.inf
            value = (n_events * log_mean + n_events * log_beta
                     + beta_value * centered_log_event_sum
                     - mean_exposure)
            return -value

        optimum = minimize_scalar(
            negative_loglik,
            bounds=(log_beta_floor, log_beta_ceiling),
            method='bounded',
            options={'xatol': 1e-11, 'maxiter': 1000})
        if not optimum.success or not np.isfinite(optimum.fun):
            return -math.inf
        return -float(optimum.fun)

    def endpoint_profile_root(log_mean):
        return (endpoint_target_profile(log_mean)
                - endpoint_target_loglik)

    endpoint_mcf_lower = endpoint_mcf_upper = None
    endpoint_target_loglik = (
        endpoint_target_profile(log_endpoint_mcf) - cutoff)
    endpoint_low = log_endpoint_mcf - 1.0
    while (endpoint_low > -745.0
           and endpoint_profile_root(endpoint_low) > 0):
        endpoint_low -= 1.0
    if endpoint_profile_root(endpoint_low) <= 0:
        endpoint_mcf_lower = float(_safe_exp(brentq(
            endpoint_profile_root, endpoint_low, log_endpoint_mcf,
            xtol=1e-11, rtol=1e-11)))
    endpoint_high = log_endpoint_mcf + 1.0
    while (endpoint_high < 709.0
           and endpoint_profile_root(endpoint_high) > 0):
        endpoint_high += 1.0
    if endpoint_profile_root(endpoint_high) <= 0:
        endpoint_mcf_upper = float(_safe_exp(brentq(
            endpoint_profile_root, log_endpoint_mcf, endpoint_high,
            xtol=1e-11, rtol=1e-11)))

    # Descriptive agreement with the non-parametric MCF (log-log space).
    t = np.asarray(npest['time'], dtype=float)
    mcf = np.asarray(npest['MCF'], dtype=float)
    mask = (t > 0) & (mcf > 0)
    if np.sum(mask) >= 2:
        log_t = np.log(t[mask])
        log_mcf = np.log(mcf[mask])
        pred = log_lambda + beta * log_t
        ss_res = np.sum((log_mcf - pred) ** 2)
        ss_tot = np.sum((log_mcf - np.mean(log_mcf)) ** 2)
        r_squared = float(1 - ss_res / ss_tot) if ss_tot > 0 else 1.0
    else:
        # Fewer than two positive non-parametric MCF points cannot support a
        # descriptive coefficient of determination.  Use JSON-safe null,
        # rather than leaking NaN through API serialization.
        r_squared = None

    min_event = float(np.min(all_events))
    max_end = float(np.max(positive_ends))
    t_fit = np.linspace(min_event, max_end, 100)
    mcf_fit = _safe_exp(log_lambda + beta * np.log(t_fit))

    return {
        'alpha': alpha,
        'log_alpha': float(log_alpha),
        'beta': float(beta),
        'Lambda': Lambda,
        'log_Lambda': float(log_lambda),
        'profile_score': score_at_solution,
        'optimizer': 'brent_profile_score_unequal_observation_ends',
        'converged': True,
        'beta_lower': beta_lower,
        'beta_upper': beta_upper,
        'beta_interval_method': 'profile_likelihood_chi_square_1df',
        'endpoint_time': reference_time,
        'endpoint_MCF': endpoint_mcf,
        'endpoint_MCF_lower': endpoint_mcf_lower,
        'endpoint_MCF_upper': endpoint_mcf_upper,
        'endpoint_MCF_interval_method': (
            'joint_profile_likelihood_lambda_beta_chi_square_1df'),
        'Lambda_interval_method': 'not_computed',
        'alpha_interval_method': 'not_computed',
        'interval_status': (
            'asymptotic_profile_likelihood' if all(
                value is not None for value in (
                    beta_lower, beta_upper,
                    endpoint_mcf_lower, endpoint_mcf_upper))
            else 'partially_unavailable'),
        'r_squared': r_squared,
        'time': t_fit.tolist(),
        'MCF': mcf_fit.tolist(),
        'np': npest,
        'CI': CI,
    }
