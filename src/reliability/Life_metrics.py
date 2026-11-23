"""Distribution-derived life metrics with explicit tail and support semantics."""

import math
import warnings

import numpy as np
from scipy import integrate, optimize, stats
from scipy.special import gammaincc, gammainc, gammaln


_LOG_MAX = math.log(np.finfo(float).max)
_LOG_MIN = math.log(np.nextafter(0., 1.))


def _exp_or_limit(value):
    return math.inf if value > _LOG_MAX else 0. if value < _LOG_MIN else math.exp(value)


def _log_expm1(value):
    if value == 0:
        return -math.inf
    return value + math.log1p(-math.exp(-value)) if value > 50 else math.log(math.expm1(value))


def _conditional_log_survival(distribution, age, end):
    name = getattr(distribution, 'name', '')
    if name.startswith('Weibull_'):
        start = max(age - distribution.gamma, 0.)
        finish = max(end - distribution.gamma, 0.)
        if finish == start:
            return 0.
        if start == 0:
            return -_exp_or_limit(distribution.beta * (math.log(finish) - math.log(distribution.eta)))
        log_a = distribution.beta * (math.log(start) - math.log(distribution.eta))
        power_change = distribution.beta * math.log1p((finish - start) / start)
        return -_exp_or_limit(log_a + _log_expm1(power_change))
    if name.startswith('Exponential_'):
        exposure = max(end - distribution.gamma, 0.) - max(age - distribution.gamma, 0.)
        return -distribution.Lambda * exposure
    log_start, log_end = np.asarray(distribution._logsf([age, end]), dtype=float)
    if not np.isfinite(log_start):
        raise ValueError('Survival to the elapsed age has zero or numerically unresolved probability.')
    if np.isnan(log_end) or log_end > log_start:
        raise ValueError('The model produced invalid conditional survival.')
    return float(log_end - log_start)


def conditional_survival(distribution, age, end):
    """Survival to ``end`` conditional on survival to ``age``.

    Return reliability and failure probability independently, retaining a small
    complementary tail. Conditioning on an impossible survival is rejected.
    """
    if not (math.isfinite(age) and math.isfinite(end) and 0 <= age <= end):
        raise ValueError('Require finite ages with 0 <= elapsed <= mission end.')
    difference = _conditional_log_survival(distribution, age, end)
    return math.exp(difference), -math.expm1(difference)


def remaining_life(distribution, age, reliability):
    """Additional exposure at a conditional reliability target; no renewal.

    Weibull/exponential calculations preserve additional exposure even when it
    is smaller than one ulp of the elapsed age. Other families use a bracketed
    log-survival solve and validate the attained conditional target.
    """
    if not (math.isfinite(age) and age >= 0 and math.isfinite(reliability) and 0 < reliability < 1):
        raise ValueError('Require a finite nonnegative age and reliability in (0, 1).')
    name = getattr(distribution, 'name', '')
    loss = -math.log(reliability)
    if name.startswith('Exponential_'):
        result = max(distribution.gamma - age, 0.) + loss / distribution.Lambda
    elif name.startswith('Weibull_'):
        shifted = max(age - distribution.gamma, 0.)
        if shifted == 0:
            result = max(distribution.gamma - age, 0.) + _exp_or_limit(
                math.log(distribution.eta) + math.log(loss) / distribution.beta)
        else:
            log_a = distribution.beta * (math.log(shifted) - math.log(distribution.eta))
            log_ratio = math.log(loss) - log_a
            increment = float(np.logaddexp(0., log_ratio)) / distribution.beta
            # expm1(increment) ~ exp(log_ratio)/beta if the ratio is too small
            # to form. Keep its logarithm until multiplication by elapsed age.
            log_delta = math.log(shifted) + (
                log_ratio - math.log(distribution.beta) if increment == 0.
                else _log_expm1(increment))
            result = _exp_or_limit(log_delta)
    else:
        initial = float(distribution._logsf([age])[0])
        if not np.isfinite(initial):
            raise ValueError('Survival to the elapsed age has zero or numerically unresolved probability.')
        if initial - loss == initial:
            raise ValueError('The requested remaining-life tail is below the model numerical resolution.')

        def objective(delta):
            return _conditional_log_survival(distribution, age, age + delta) + loss

        median = float(distribution.quantile(.5))
        upper = max(abs(age) * .1, abs(median) if math.isfinite(median) else 1., np.finfo(float).tiny)
        result = None
        for _ in range(1024):
            if objective(upper) <= 0:
                root = optimize.brentq(lambda z: objective(z * upper), 0., 1.,
                                       xtol=np.nextafter(0., 1.), rtol=8 * np.finfo(float).eps,
                                       maxiter=1000)
                result = float(root * upper)
                if abs(objective(result)) > 1e-7 * loss:
                    raise ValueError('Remaining-life calculation could not resolve the requested target.')
                break
            upper *= 2.
            if not math.isfinite(upper):
                break
        else:
            raise ValueError('Could not bracket a finite conditional remaining life.')
        if result is None:
            raise ValueError('Could not bracket a finite conditional remaining life.')
    if not math.isfinite(result) or result <= 0:
        raise ValueError('The requested remaining life is outside the representable positive range.')
    return result


def mean_remaining_life(distribution, age):
    """E[T-age | T>age], distinct from a conditional quantile.

    Weibull and exponential use analytic scaled-tail formulas. Other supported
    distributions integrate conditional survival to the end of their support.
    A divergent model mean remains infinite rather than a truncated estimate.
    """
    if not math.isfinite(age) or age < 0:
        raise ValueError('Elapsed age must be finite and nonnegative.')
    name = getattr(distribution, 'name', '')
    if name.startswith('Exponential_'):
        return max(distribution.gamma - age, 0.) + 1. / distribution.Lambda
    if name.startswith('Weibull_'):
        eta, beta = distribution.eta, distribution.beta
        shifted = max(age - distribution.gamma, 0.)
        if shifted == 0:
            return max(distribution.gamma - age, 0.) + _exp_or_limit(math.log(eta) + gammaln(1 + 1 / beta))
        a = 1. / beta
        log_z = beta * (math.log(shifted) - math.log(eta))
        z = _exp_or_limit(log_z)
        upper = float(gammaincc(a, z))
        if upper > 0:
            log_value = math.log(eta) - math.log(beta) + gammaln(a) + math.log(upper) + z
        else:
            # Scaled upper incomplete gamma, asymptotic after its regularized
            # value underflows. This preserves age increments below one ulp.
            term = total = 1.
            for k in range(1, 100):
                term *= (a - k) / z
                total += term
                if abs(term) <= abs(total) * 1e-14:
                    break
            if total <= 0:
                raise ValueError('Mean remaining life is numerically unresolved.')
            log_value = math.log(eta) - math.log(beta) + (a - 1.) * log_z + math.log(total)
        return _exp_or_limit(log_value)
    # Validate conditioning even when the unconditional mean is infinite.
    _conditional_log_survival(distribution, age, age)
    if np.isposinf(distribution.mean) or (name.startswith('Loglogistic_') and distribution.beta <= 1):
        return math.inf
    scale = remaining_life(distribution, age, .5)
    def integrand(x):
        return math.exp(_conditional_log_survival(distribution, age, age + scale * x))
    with warnings.catch_warnings():
        warnings.simplefilter('error', integrate.IntegrationWarning)
        try:
            value, error = integrate.quad(integrand, 0., math.inf, epsabs=1e-9, epsrel=1e-8, limit=250)
        except integrate.IntegrationWarning as exc:
            raise ValueError('Mean remaining life integral did not converge.') from exc
    if not math.isfinite(value) or value <= 0 or error > 1e-6 * value:
        raise ValueError('Mean remaining life integral is numerically unresolved.')
    return scale * value


def weibull_age_replacement_metrics(eta, beta, interval):
    """Renew on failure or attained age T; long-run rates per operating time."""
    if any(not math.isfinite(v) or v <= 0 for v in (eta, beta, interval)):
        raise ValueError('Scale, shape and replacement age must be finite and positive.')
    log_z = beta * (math.log(interval) - math.log(eta))
    z = _exp_or_limit(log_z)
    failure = -math.expm1(-z)
    survival = math.exp(-z)
    log_mean = math.log(eta) + float(gammaln(1 + 1 / beta))
    if z < 1e-5:
        # Integral_0^T exp[-(t/eta)^beta]dt, scaled by T. Avoid incomplete
        # gamma underflow and retain tiny corrective-event probabilities.
        cycle = interval * (1 - z / (beta + 1) + z*z / (2*(2*beta + 1)))
    else:
        regularized = float(gammainc(1 / beta, z))
        if regularized > 0:
            cycle = _exp_or_limit(log_mean + math.log(regularized))
        else:
            # Large gamma shape can underflow P(a,z) despite a finite product.
            normalized, error = integrate.quad(lambda u: math.exp(-z * u**beta), 0., 1., epsabs=1e-12, epsrel=1e-10)
            if error > 1e-7 * normalized:
                raise ValueError('Replacement cycle integral is numerically unresolved.')
            cycle = interval * normalized
    if not math.isfinite(cycle) or cycle <= 0:
        raise ValueError('Replacement cycle mean is outside numerical range.')
    return {'cycle_operating_time': cycle, 'failure_probability': failure,
            'survival_probability': survival, 'cm_per_time': failure / cycle,
            'pm_per_time': survival / cycle, 'mttf': _exp_or_limit(log_mean)}


def _analytic_result(log_failure, log_reliability, method):
    return {'probability_of_failure': math.exp(log_failure),
            'reliability': math.exp(log_reliability),
            'log_probability_of_failure': log_failure if math.isfinite(log_failure) else None,
            'log_reliability': log_reliability if math.isfinite(log_reliability) else None,
            'integration_error': 0., 'reliability_integration_error': 0., 'method': method}


def _probability_integral(primary, other, primary_scale, other_scale):
    """E[F_other(X_primary)] split into lower and survival quantiles.

    Direct inverse-survival evaluation keeps upper quantiles that would be
    rounded away by ppf(1-q). Transitions are split into independent normalized
    subintervals, so a 1e-20 probability interval is not discarded as a tiny
    perturbation of [0,1].
    """
    frozen = primary._scipy
    other_frozen = other._scipy
    log_ratio = math.log(other_scale) - math.log(primary_scale)

    def scaled(value, log_factor):
        if value == 0 or not math.isfinite(value):
            return value
        return math.copysign(_exp_or_limit(math.log(abs(value)) + log_factor), value)

    quantile_probs = [1e-100, 1e-30, 1e-15, 1e-10, 1e-6, .001, .01, .1, .5]
    landmarks = [other_frozen.ppf(0.), other_frozen.isf(0.)]
    landmarks.extend(other_frozen.ppf(q) for q in quantile_probs)
    landmarks.extend(other_frozen.isf(q) for q in quantile_probs)
    total, total_error = 0., 0.
    for upper_half in (False, True):
        probability = frozen.sf if upper_half else frozen.cdf
        inverse = frozen.isf if upper_half else frozen.ppf
        points = {0., .5}
        for landmark in landmarks:
            # Infinite support endpoints legitimately produce zero/one tails;
            # some SciPy families reach these through log(0) internally.
            with np.errstate(divide='ignore', over='ignore', invalid='ignore'):
                q = float(probability(scaled(float(landmark), log_ratio)))
            if math.isfinite(q) and 0 < q < .5:
                points.add(q)
        ordered = sorted(points)
        for left, right in zip(ordered[:-1], ordered[1:]):
            width = right - left
            def integrand(z):
                q = left + width * z
                x = scaled(float(inverse(q)), -log_ratio)
                return float(other_frozen.cdf(x))
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', integrate.IntegrationWarning)
                value, error = integrate.quad(integrand, 0., 1., epsabs=0., epsrel=1e-9, limit=150)
            if not math.isfinite(value) or not math.isfinite(error):
                raise ValueError('Interference integration produced an unresolved probability interval.')
            total += width * value
            total_error += width * error
    return total, total_error


def interference_probability(stress, strength, stress_scale=1., strength_scale=1.):
    """Independent P(stress > strength), resolving both complementary tails."""
    if any(not math.isfinite(v) or v <= 0 for v in (stress_scale, strength_scale)):
        raise ValueError('Distribution unit scales must be finite and positive.')
    if stress.name == 'Normal_2P' and strength.name == 'Normal_2P':
        sd = math.hypot(stress.sigma * stress_scale, strength.sigma * strength_scale)
        z = (strength.mu * strength_scale - stress.mu * stress_scale) / sd
        if math.isnan(z):
            raise ValueError('Scaled Normal parameters exceed the numerical range.')
        return _analytic_result(float(stats.norm.logsf(z)), float(stats.norm.logcdf(z)), 'analytic_normal_difference')
    if (stress.name.startswith('Lognormal_') and strength.name.startswith('Lognormal_')
            and stress.gamma * stress_scale == strength.gamma * strength_scale):
        z = (strength.mu + math.log(strength_scale) - stress.mu - math.log(stress_scale)) / math.hypot(stress.sigma, strength.sigma)
        return _analytic_result(float(stats.norm.logsf(z)), float(stats.norm.logcdf(z)), 'analytic_lognormal_ratio')
    if (stress.name.startswith('Weibull_') and strength.name.startswith('Weibull_')
            and stress.beta == strength.beta
            and stress.gamma * stress_scale == strength.gamma * strength_scale):
        odds = stress.beta * (math.log(stress.eta) + math.log(stress_scale)
                              - math.log(strength.eta) - math.log(strength_scale))
        return _analytic_result(-float(np.logaddexp(0., -odds)), -float(np.logaddexp(0., odds)), 'analytic_common_shape_weibull')

    a, b = stress._scipy.support()
    c, d = strength._scipy.support()
    if b * stress_scale <= c * strength_scale:
        return {'probability_of_failure': 0., 'reliability': 1.,
                'log_probability_of_failure': None, 'log_reliability': 0.,
                'integration_error': 0., 'reliability_integration_error': 0., 'method': 'disjoint_support'}
    if a * stress_scale >= d * strength_scale:
        return {'probability_of_failure': 1., 'reliability': 0.,
                'log_probability_of_failure': 0., 'log_reliability': None,
                'integration_error': 0., 'reliability_integration_error': 0., 'method': 'disjoint_support'}

    failure, failure_error = _probability_integral(stress, strength, stress_scale, strength_scale)
    reliability, reliability_error = _probability_integral(strength, stress, strength_scale, stress_scale)
    for value, error in ((failure, failure_error), (reliability, reliability_error)):
        if value <= 0 or not math.isfinite(value) or error > value * 1e-7:
            raise ValueError('Interference integration could not resolve a complementary probability tail.')
    if abs(failure + reliability - 1.) > max(1e-8, 8 * (failure_error + reliability_error)):
        raise ValueError('Independent interference integrals did not conserve probability.')
    # Preserve whichever tail is smaller; form only the larger complement.
    if failure <= reliability:
        reliability = 1. - failure
    else:
        failure = 1. - reliability
    return {'probability_of_failure': failure, 'reliability': reliability,
            'log_probability_of_failure': math.log(failure) if failure < .5 else math.log1p(-reliability),
            'log_reliability': math.log(reliability) if reliability < .5 else math.log1p(-failure),
            'integration_error': float(failure_error),
            'reliability_integration_error': float(reliability_error),
            'method': 'adaptive_complementary_probability_integrals'}
