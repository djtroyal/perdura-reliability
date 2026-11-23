"""Inspectable lifetime adapters: survival matrices, renewal rates and prediction.

Inspection prediction uses a declared Beta prior for first-inspection failure
probability. Shape is fixed in each row. Predictive bounds are Bayesian, with
count variation and parameter uncertainty, not frequentist confidence limits.
"""
import math
import numpy as np
from scipy import stats, special, integrate
from reliability.Life_metrics import weibull_age_replacement_metrics
from reliability.Renewal import conditional_log_survival


def survival_matrix(distribution, ages, durations):
    ages, durations = np.asarray(ages, dtype=float), np.asarray(durations, dtype=float)
    if (ages.ndim != 1 or durations.ndim != 1 or not len(ages) or not len(durations)
            or len(ages) * len(durations) > 2500
            or np.any(~np.isfinite(ages)) or np.any(~np.isfinite(durations))
            or np.any(ages < 0) or np.any(durations < 0)):
        raise ValueError('Supply finite nonnegative age/duration arrays, at most 2500 cells.')
    survival, failure = [], []
    for age in ages:
        logs = conditional_log_survival(distribution, float(age), durations)
        survival.append(np.exp(logs).tolist()); failure.append((-np.expm1(logs)).tolist())
    return {'ages': ages.tolist(), 'durations': durations.tolist(), 'survival': survival, 'failure': failure,
            'negative_support_probability': float(distribution._cdf(np.asarray([0.]))[0]),
            'conditioning': 'Every row is conditional on survival to its current age; columns are additional exposure.'}


def mechanical_equivalent_rate(beta, interval, *, eta=None, percentile_life=None,
                               failure_percentile=.1, corrective_downtime=0., preventive_downtime=0., exposure_basis='time'):
    if (eta is None) == (percentile_life is None):
        raise ValueError('Provide characteristic life or percentile life, exclusively.')
    if not math.isfinite(beta) or beta <= 0 or not 0 < failure_percentile < 1:
        raise ValueError('Shape must be positive and failure percentile between zero and one.')
    if percentile_life is not None:
        if not math.isfinite(percentile_life) or percentile_life <= 0:
            raise ValueError('Percentile life must be finite and positive.')
        eta = math.exp(math.log(percentile_life) - math.log(-math.log1p(-failure_percentile)) / beta)
    if any(not math.isfinite(x) or x < 0 for x in (corrective_downtime, preventive_downtime)):
        raise ValueError('Downtimes must be finite and nonnegative.')
    if exposure_basis not in ('time', 'non_time') or (exposure_basis == 'non_time' and (corrective_downtime or preventive_downtime)):
        raise ValueError('Downtime requires a time-based lifetime model; no cycle/distance-to-clock conversion is assumed.')
    metrics = weibull_age_replacement_metrics(eta, beta, interval)
    cycle = metrics['cycle_operating_time']
    down = metrics['failure_probability'] * corrective_downtime + metrics['survival_probability'] * preventive_downtime
    calendar = cycle + down
    if not math.isfinite(calendar):
        raise ValueError('Calendar cycle is outside numerical range.')
    rate = metrics['cm_per_time']
    calendar_rate = metrics['failure_probability'] / calendar
    return {**metrics, 'eta': eta, 'beta': beta, 'interval': interval,
            'failure_percentile': failure_percentile if percentile_life is not None else None,
            'percentile_life': percentile_life,
            'equivalent_operating_mtbf': 1 / rate if rate > 0 else None,
            'exposure_basis': exposure_basis,
            'calendar_failure_rate': calendar_rate if exposure_basis == 'time' else None,
            'equivalent_calendar_time_between_failures': 1 / calendar_rate if calendar_rate > 0 and exposure_basis == 'time' else None,
            'cycle_calendar_time': calendar if exposure_basis == 'time' else None, 'availability': cycle / calendar if exposure_basis == 'time' else None,
            'assumptions': ['Replace at failure or attained operating age T, whichever comes first; each replacement restores new condition.',
                            'Independent identical renewal cycles; age does not advance during downtime.',
                            'Operating-time failure intensity is F(T)/E[min(X,T)]; it is not instantaneous hazard or minimal-repair intensity.',
                            'Calendar rates include the entered mean corrective/preventive downtimes; no overlapping maintenance.']}


def _predictive_count_bounds(n_survivors, a, b, exponent, level, cdf_tolerance):
    """Conservative posterior-predictive quantiles with deterministic CDF bounds.

    Integrate over u~Uniform(0,1), p=Beta.ppf(u). Binomial CDF is monotone
    decreasing in u; left/right rectangle sums bracket its exact integral.
    Their width is at most 1/cells, independent of the population size.
    """
    if n_survivors == 0:
        return {'lower': 0, 'upper': 0, 'cdf_error_bound': 0., 'cells': 0}
    cells = 2 ** math.ceil(math.log2(1 / cdf_tolerance))
    u = np.linspace(0, 1, cells + 1)
    p = stats.beta.ppf(u, a, b)
    with np.errstate(divide='ignore', invalid='ignore'):
        q = -np.expm1(exponent * np.log1p(-p))
    q[0], q[-1] = 0., 1.
    if np.any(~np.isfinite(q)) or np.any(np.diff(q) < 0):
        raise ValueError('Posterior probability grid is numerically unresolved.')
    cache = {}
    def bounds(k):
        if k < 0:
            return 0., 0.
        if k >= n_survivors:
            return 1., 1.
        if k not in cache:
            f = stats.binom.cdf(k, n_survivors, q)
            cache[k] = (float(np.sum(f[1:]) / cells), float(np.sum(f[:-1]) / cells))
        return cache[k]
    def quantile(probability, bound_index):
        low, high = -1, n_survivors
        while high - low > 1:
            mid = (low + high) // 2
            if bounds(mid)[bound_index] >= probability:
                high = mid
            else:
                low = mid
        return high
    tail = (1 - level) / 2
    lower, upper = quantile(tail, 1), quantile(1 - tail, 0)
    return {'lower': lower, 'upper': upper, 'cdf_error_bound': 1 / cells, 'cells': cells,
            'lower_tail_probability_upper_bound': bounds(lower - 1)[1],
            'upper_tail_probability_upper_bound': 1 - bounds(upper)[0]}


def _log_beta_survival_moment(a, b, exponent):
    """Log E[(1-p)^k], retaining small loss for large sparse cohorts."""
    if exponent == 1:
        return -math.log1p(a / b)
    raw = float(special.betaln(a, b + exponent) - special.betaln(a, b))
    if raw < -.01:
        return raw
    # Avoid cancellation between two nearly equal log-beta values. Integrate
    # d/db log B(a,b) with a stable large-b digamma difference.
    def difference(u):
        x = b + exponent * u
        ratio = math.log1p(a / x)
        if x >= 8:
            value = ratio + .5 / x * -math.expm1(-ratio)
            for power, coefficient in [(2,1/12),(4,-1/120),(6,1/252),(8,-1/240),(10,1/132),(12,-691/32760)]:
                value += coefficient * x**(-power) * -math.expm1(-power * ratio)
            return value
        if a < 1e-5 * x:
            return float(a * special.polygamma(1,x) + a*a/2 * special.polygamma(2,x) + a**3/6 * special.polygamma(3,x))
        return float(special.digamma(x+a) - special.digamma(x))
    value, _ = integrate.quad(difference, 0, 1, epsabs=1e-15, epsrel=1e-10)
    return -exponent * value


def inspection_failure_prediction(n, failures, first_age, second_age, betas, *, level=.95,
                                  prior_alpha=.5, prior_beta=.5, cdf_tolerance=5e-4,
                                  prior_sensitivity=True):
    if (isinstance(n, bool) or int(n) != n or not 1 <= n <= 1_000_000_000
            or isinstance(failures, bool) or int(failures) != failures or not 0 <= failures <= n):
        raise ValueError('Require integer population N>=1 and failures 0<=X<=N.')
    if not (math.isfinite(first_age) and math.isfinite(second_age) and 0 < first_age < second_age):
        raise ValueError('Inspection ages must be finite with 0<t1<t2.')
    if (not 0 < level < 1 or not 1/65536 <= cdf_tolerance <= .005
            or any(not math.isfinite(x) or x <= 0 for x in (prior_alpha, prior_beta))):
        raise ValueError('Invalid predictive level, prior or numerical tolerance.')
    if not 1 <= len(betas) <= 12 or any(not math.isfinite(x) or x <= 0 for x in betas):
        raise ValueError('Supply 1 to 12 finite positive Weibull shapes.')
    n, failures = int(n), int(failures)
    survivors = n - failures
    a, b = failures + prior_alpha, survivors + prior_beta
    rows = []
    for beta in betas:
        log_ratio = beta * math.log(second_age / first_age)
        if log_ratio > 700:
            raise ValueError('Inspection horizon/shape is outside numerical range.')
        exponent = math.expm1(log_ratio)
        eta = None
        if 0 < failures < n:
            log_eta = math.log(first_age) - math.log(-math.log1p(-failures/n)) / beta
            if not math.log(np.nextafter(0., 1.)) <= log_eta <= math.log(np.finfo(float).max):
                raise ValueError('The fitted Weibull scale is outside floating-point range; revise the fixed shape or exposure units.')
            eta = math.exp(log_eta)
        plugin_probability = -math.expm1(exponent * math.log1p(-failures/n)) if failures < n else 1.
        log_moment = _log_beta_survival_moment(a, b, exponent)
        predictive_mean = survivors * -math.expm1(min(log_moment, 0.))
        interval = _predictive_count_bounds(survivors, a, b, exponent, level, cdf_tolerance)
        row = {'beta': beta, 'eta_mle': eta, 'expected_additional_failures_mle': survivors * plugin_probability,
               'posterior_predictive_mean': predictive_mean, 'predictive_interval': interval,
               'posterior_alpha': a, 'posterior_beta': b}
        if prior_sensitivity:
            row['prior_sensitivity'] = []
            for label, pa, pb in [('Jeffreys', .5, .5), ('Uniform', 1., 1.)]:
                sa, sb = failures + pa, survivors + pb
                mean = survivors * -math.expm1(min(_log_beta_survival_moment(sa, sb, exponent), 0.))
                row['prior_sensitivity'].append({'prior': label, 'alpha': pa, 'beta': pb,
                    'mean': mean, **_predictive_count_bounds(survivors, sa, sb, exponent, level, cdf_tolerance)})
        rows.append(row)
    return {'population': n, 'observed_failures': failures, 'survivors': survivors,
            'first_age': first_age, 'second_age': second_age, 'level': level, 'rows': rows,
            'prior': {'alpha': prior_alpha, 'beta': prior_beta, 'parameter': 'p1=P(first failure by t1)'},
            'interval_kind': 'conservative_equal_tailed_bayesian_posterior_predictive',
            'numerical_method': 'monotone_uniform_quantile_rectangle_bounds',
            'boundary_note': ('No finite interior scale MLE; posterior prediction remains available under the declared prior.' if failures in (0,n) else None),
            'assumptions': ['Independent identical first-failure lifetimes; failed units are removed, not replaced.',
                            'Weibull shape is fixed separately in each sensitivity row; rows are not probability-weighted shape uncertainty.',
                            'Initial observation is the count failed by t1, not exact failure times.',
                            'Intervals include conditional future binomial count variation and posterior uncertainty in p1.',
                            'Credible prediction under the declared prior; no claim of nominal frequentist coverage.'],
            'sources': [{'title': 'Nordman and Meeker, Weibull prediction intervals (comparison context)', 'url': 'https://doi.org/10.1198/004017002753398191'},
                        {'title': 'NIST: Weibull distribution', 'url': 'https://www.itl.nist.gov/div898/handbook/apr/section1/apr162.htm'},
                        {'title': 'SciPy: beta-binomial predictive mixture', 'url': 'https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.betabinom.html'}]}
