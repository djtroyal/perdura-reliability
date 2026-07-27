"""Grouped life-data likelihoods shared by LDA and Warranty.

Two observation models are deliberately kept distinct:

``frequency_exact``
    Exact failure and right-censoring times stored once with an integer count.
    This is likelihood-equivalent to expanding each row ``count`` times.

``interval_censored``
    Failure times known only to lie in ``(lower, upper]`` together with left-
    and right-censored groups.  No midpoint substitution is used.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import warnings
from typing import Callable, Iterable

import numpy as np
from scipy import optimize, stats
from scipy.special import expit, logit

from reliability.Distributions import (
    Weibull_Distribution, Exponential_Distribution, Normal_Distribution,
    Lognormal_Distribution, Gamma_Distribution, Loglogistic_Distribution,
    Beta_Distribution, Gumbel_Distribution,
)
from reliability.Utils import (
    AICc, BIC, FitConvergenceError, distribution_confidence_bounds,
    numerical_hessian, select_best_optimizer_result,
)
from reliability.Exponential_inference import (
    exact_exponential_sf_bounds,
    exponential_1p_exact_inference,
    exponential_1p_mle,
    exponential_2p_exact_inference,
    exponential_2p_mle,
)
from reliability.Normal_inference import (
    exact_normal_sf_bounds,
    normal_exact_inference,
)


EXACT_FREQUENCY_DISTRIBUTIONS = (
    'Weibull_2P', 'Weibull_3P', 'Exponential_1P', 'Exponential_2P',
    'Normal_2P', 'Lognormal_2P', 'Lognormal_3P', 'Gamma_2P', 'Gamma_3P',
    'Loglogistic_2P', 'Loglogistic_3P', 'Beta_2P', 'Gumbel_2P',
)

INTERVAL_CENSORED_DISTRIBUTIONS = (
    'Weibull_2P', 'Exponential_1P', 'Normal_2P', 'Lognormal_2P',
    'Gamma_2P', 'Loglogistic_2P', 'Beta_2P', 'Gumbel_2P',
)

INTERVAL_EXCLUDED_DISTRIBUTIONS = {
    'Weibull_3P': 'location/threshold is weakly identified by grouped intervals',
    'Exponential_2P': 'location/threshold is weakly identified by grouped intervals',
    'Lognormal_3P': 'location/threshold is weakly identified by grouped intervals',
    'Gamma_3P': 'location/threshold is weakly identified by grouped intervals',
    'Loglogistic_3P': 'location/threshold is weakly identified by grouped intervals',
}


@dataclass(frozen=True)
class FrequencyObservation:
    time: float
    state: str
    count: int
    id: str = ''


@dataclass(frozen=True)
class IntervalObservation:
    lower: float | None
    upper: float | None
    count: int
    id: str = ''


@dataclass
class _DistributionSpec:
    names: list[str]
    start: np.ndarray
    bounds: list[tuple[float | None, float | None]]
    decode: Callable[[np.ndarray], tuple[object, dict[str, float]]]
    dist_class: type


@dataclass
class GroupedLifeFit:
    distribution_name: str
    params: dict[str, float]
    distribution: object
    theta: np.ndarray
    covariance_theta: np.ndarray | None
    covariance_natural: np.ndarray | None
    loglik: float
    AICc: float
    BIC: float
    AD: float | None
    n: int
    n_failures: int
    n_censored: int
    CI: float
    method: str
    converged: bool
    fit_eligible: bool
    aicc_eligible: bool
    eligibility_reasons: list[str]
    fit_diagnostics: dict
    parameter_ci_method: str
    function_ci_method: str
    uncertainty_warnings: list[str]
    confidence_metadata: dict
    _exact_exponential_inference: dict | None
    _exact_normal_inference: dict | None
    _dist_class: type

    def confidence_bounds(self, xvals, func='SF'):
        """Match the standard fitter interface used by LDA curve builders."""
        if self._exact_normal_inference is not None:
            lower, upper = exact_normal_sf_bounds(
                self._exact_normal_inference, xvals
            )
        elif self._exact_exponential_inference is not None:
            lower, upper = exact_exponential_sf_bounds(
                self._exact_exponential_inference, xvals
            )
        else:
            lower, upper = distribution_confidence_bounds(
                self._dist_class,
                [self.params[name] for name in _parameter_names(self.distribution_name)],
                self.covariance_natural,
                xvals,
                CI=self.CI,
            )
        estimate = self.distribution._sf(np.asarray(xvals, dtype=float))
        if func.upper() == 'CDF':
            estimate = 1.0 - estimate
            if lower is not None:
                lower, upper = 1.0 - upper, 1.0 - lower
        return estimate, lower, upper


def _parameter_names(name: str) -> list[str]:
    return {
        'Weibull_2P': ['eta', 'beta'],
        'Weibull_3P': ['eta', 'beta', 'gamma'],
        'Exponential_1P': ['Lambda'],
        'Exponential_2P': ['Lambda', 'gamma'],
        'Normal_2P': ['mu', 'sigma'],
        'Lognormal_2P': ['mu', 'sigma'],
        'Lognormal_3P': ['mu', 'sigma', 'gamma'],
        'Gamma_2P': ['alpha', 'beta'],
        'Gamma_3P': ['alpha', 'beta', 'gamma'],
        'Loglogistic_2P': ['alpha', 'beta'],
        'Loglogistic_3P': ['alpha', 'beta', 'gamma'],
        'Beta_2P': ['alpha', 'beta'],
        'Gumbel_2P': ['mu', 'sigma'],
    }[name]


def _reliability_distribution(name: str, params: dict[str, float]):
    if name.startswith('Weibull'):
        return Weibull_Distribution(**params)
    if name.startswith('Exponential'):
        return Exponential_Distribution(**params)
    if name == 'Normal_2P':
        return Normal_Distribution(**params)
    if name.startswith('Lognormal'):
        return Lognormal_Distribution(**params)
    if name.startswith('Gamma'):
        return Gamma_Distribution(**params)
    if name.startswith('Loglogistic'):
        return Loglogistic_Distribution(**params)
    if name == 'Beta_2P':
        return Beta_Distribution(**params)
    if name == 'Gumbel_2P':
        return Gumbel_Distribution(**params)
    raise ValueError(f"Unknown distribution '{name}'.")


def _weighted_moments(values: np.ndarray, weights: np.ndarray):
    mean = float(np.average(values, weights=weights))
    variance = float(np.average((values - mean) ** 2, weights=weights))
    sd = max(math.sqrt(max(variance, 0.0)), abs(mean) * 0.05, 1e-3)
    return mean, variance, sd


def grouped_distribution_spec(
    name: str,
    reference_times: np.ndarray,
    reference_weights: np.ndarray,
    *,
    minimum_failure: float | None = None,
    allow_threshold: bool = True,
) -> _DistributionSpec:
    """Create a transformed-parameter distribution specification."""
    supported = (EXACT_FREQUENCY_DISTRIBUTIONS if allow_threshold
                 else INTERVAL_CENSORED_DISTRIBUTIONS)
    if name not in supported:
        reason = INTERVAL_EXCLUDED_DISTRIBUTIONS.get(name)
        detail = f": {reason}" if reason else ''
        raise ValueError(
            f"Distribution {name} is not supported for this observation model{detail}.")

    values = np.asarray(reference_times, dtype=float)
    weights = np.asarray(reference_weights, dtype=float)
    mean, variance, sd = _weighted_moments(values, weights)
    positive = np.maximum(values, np.finfo(float).tiny)
    log_values = np.log(positive)
    log_mean, _, log_sd = _weighted_moments(log_values, weights)
    log_bounds = (-25.0, 25.0)

    def positive_two(
        names: list[str], initial: tuple[float, float], scipy_builder, dist_class,
    ) -> _DistributionSpec:
        start = np.log(np.maximum(initial, 1e-8))

        def decode(theta):
            first, second = np.exp(theta)
            params = {names[0]: float(first), names[1]: float(second)}
            return scipy_builder(first, second), params

        return _DistributionSpec(names, start, [log_bounds, log_bounds], decode, dist_class)

    if name == 'Weibull_2P':
        return positive_two(
            ['eta', 'beta'], (max(mean, 0.1), 1.5),
            lambda eta, beta: stats.weibull_min(c=beta, scale=eta),
            Weibull_Distribution,
        )
    if name == 'Exponential_1P':
        start = np.array([math.log(1.0 / max(mean, 0.1))])

        def decode(theta):
            rate = float(np.exp(theta[0]))
            return stats.expon(scale=1.0 / rate), {'Lambda': rate}

        return _DistributionSpec(['Lambda'], start, [log_bounds], decode,
                                 Exponential_Distribution)
    if name == 'Normal_2P':
        start = np.array([mean, math.log(sd)])

        def decode(theta):
            sigma = float(np.exp(theta[1]))
            return stats.norm(loc=theta[0], scale=sigma), {
                'mu': float(theta[0]), 'sigma': sigma}

        return _DistributionSpec(['mu', 'sigma'], start,
                                 [(None, None), log_bounds], decode,
                                 Normal_Distribution)
    if name == 'Lognormal_2P':
        start = np.array([log_mean, math.log(max(log_sd, 0.2))])

        def decode(theta):
            sigma = float(np.exp(theta[1]))
            return stats.lognorm(s=sigma, scale=np.exp(theta[0])), {
                'mu': float(theta[0]), 'sigma': sigma}

        return _DistributionSpec(['mu', 'sigma'], start,
                                 [(None, None), log_bounds], decode,
                                 Lognormal_Distribution)
    if name == 'Gamma_2P':
        alpha = max(mean ** 2 / max(variance, 1e-6), 0.2)
        scale = max(variance / max(mean, 1e-6), 0.1)
        return positive_two(
            ['alpha', 'beta'], (alpha, scale),
            lambda alpha_, beta_: stats.gamma(a=alpha_, scale=beta_),
            Gamma_Distribution,
        )
    if name == 'Loglogistic_2P':
        return positive_two(
            ['alpha', 'beta'], (max(mean, 0.1), 2.0),
            lambda alpha_, beta_: stats.fisk(c=beta_, scale=alpha_),
            Loglogistic_Distribution,
        )
    if name == 'Beta_2P':
        bounded_mean = min(max(mean, 1e-3), 1 - 1e-3)
        common = max(bounded_mean * (1 - bounded_mean) / max(variance, 1e-5) - 1, 2.0)
        return positive_two(
            ['alpha', 'beta'],
            (max(bounded_mean * common, 0.2), max((1 - bounded_mean) * common, 0.2)),
            lambda alpha_, beta_: stats.beta(a=alpha_, b=beta_),
            Beta_Distribution,
        )
    if name == 'Gumbel_2P':
        start = np.array([mean, math.log(sd)])

        def decode(theta):
            sigma = float(np.exp(theta[1]))
            return stats.gumbel_l(loc=theta[0], scale=sigma), {
                'mu': float(theta[0]), 'sigma': sigma}

        return _DistributionSpec(['mu', 'sigma'], start,
                                 [(None, None), log_bounds], decode,
                                 Gumbel_Distribution)

    if minimum_failure is None or minimum_failure <= 0:
        raise ValueError(f'{name} requires a positive minimum failure time.')
    gamma_max = float(minimum_failure) * 0.999
    gamma_start = logit(0.1)

    def gamma_value(raw):
        return float(gamma_max * expit(raw))

    if name == 'Weibull_3P':
        start = np.array([math.log(max(mean * 0.9, 0.1)), math.log(1.5), gamma_start])

        def decode(theta):
            eta, beta = np.exp(theta[:2]); gamma = gamma_value(theta[2])
            return stats.weibull_min(c=beta, scale=eta, loc=gamma), {
                'eta': float(eta), 'beta': float(beta), 'gamma': gamma}

        dist_class = Weibull_Distribution
        names = ['eta', 'beta', 'gamma']
    elif name == 'Exponential_2P':
        start = np.array([math.log(1.0 / max(mean, 0.1)), gamma_start])

        def decode(theta):
            rate = float(np.exp(theta[0])); gamma = gamma_value(theta[1])
            return stats.expon(scale=1.0 / rate, loc=gamma), {
                'Lambda': rate, 'gamma': gamma}

        dist_class = Exponential_Distribution
        names = ['Lambda', 'gamma']
    elif name == 'Lognormal_3P':
        start = np.array([log_mean, math.log(max(log_sd, 0.2)), gamma_start])

        def decode(theta):
            sigma = float(np.exp(theta[1])); gamma = gamma_value(theta[2])
            return stats.lognorm(s=sigma, scale=np.exp(theta[0]), loc=gamma), {
                'mu': float(theta[0]), 'sigma': sigma, 'gamma': gamma}

        dist_class = Lognormal_Distribution
        names = ['mu', 'sigma', 'gamma']
    elif name == 'Gamma_3P':
        alpha = max(mean ** 2 / max(variance, 1e-6), 0.2)
        scale = max(variance / max(mean, 1e-6), 0.1)
        start = np.array([math.log(alpha), math.log(scale), gamma_start])

        def decode(theta):
            alpha_, beta_ = np.exp(theta[:2]); gamma = gamma_value(theta[2])
            return stats.gamma(a=alpha_, scale=beta_, loc=gamma), {
                'alpha': float(alpha_), 'beta': float(beta_), 'gamma': gamma}

        dist_class = Gamma_Distribution
        names = ['alpha', 'beta', 'gamma']
    elif name == 'Loglogistic_3P':
        start = np.array([math.log(max(mean, 0.1)), math.log(2.0), gamma_start])

        def decode(theta):
            alpha_, beta_ = np.exp(theta[:2]); gamma = gamma_value(theta[2])
            return stats.fisk(c=beta_, scale=alpha_, loc=gamma), {
                'alpha': float(alpha_), 'beta': float(beta_), 'gamma': gamma}

        dist_class = Loglogistic_Distribution
        names = ['alpha', 'beta', 'gamma']
    else:  # pragma: no cover - guarded above
        raise ValueError(f"Unknown distribution '{name}'.")
    return _DistributionSpec(names, start, [log_bounds] * len(start), decode, dist_class)


def log_interval_probability(frozen, lower, upper):
    """Stable ``log(F(upper)-F(lower))`` for finite interval endpoints."""
    log_upper = np.asarray(frozen.logcdf(upper), dtype=float)
    log_lower = np.asarray(frozen.logcdf(lower), dtype=float)
    out = np.empty_like(log_upper)
    lower_zero = np.isneginf(log_lower)
    out[lower_zero] = log_upper[lower_zero]
    regular = ~lower_zero
    gap = log_lower[regular] - log_upper[regular]
    valid = np.isfinite(log_upper[regular]) & (gap < 0)
    regular_out = np.full(np.sum(regular), -np.inf, dtype=float)
    with np.errstate(over='ignore', under='ignore', divide='ignore', invalid='ignore'):
        regular_out[valid] = log_upper[regular][valid] + np.log1p(-np.exp(gap[valid]))
    out[regular] = regular_out
    return out


def validate_frequency_observations(
    observations: Iterable[FrequencyObservation],
) -> list[FrequencyObservation]:
    clean = list(observations)
    if not clean:
        raise ValueError('At least one exact-frequency row is required.')
    for index, row in enumerate(clean):
        if not np.isfinite(row.time) or row.time <= 0:
            raise ValueError(f'Frequency row {index + 1} time must be finite and > 0.')
        if row.state not in ('F', 'S'):
            raise ValueError(f'Frequency row {index + 1} state must be F or S.')
        if isinstance(row.count, bool) or int(row.count) != row.count or row.count <= 0:
            raise ValueError(f'Frequency row {index + 1} count must be a positive integer.')
    if sum(row.count for row in clean if row.state == 'F') < 2:
        raise ValueError('At least 2 failures are required after applying counts.')
    return clean


def validate_interval_observations(
    observations: Iterable[IntervalObservation],
) -> list[IntervalObservation]:
    clean = list(observations)
    if not clean:
        raise ValueError('At least one interval row is required.')
    failure_count = 0
    for index, row in enumerate(clean):
        if isinstance(row.count, bool) or int(row.count) != row.count or row.count <= 0:
            raise ValueError(f'Interval row {index + 1} count must be a positive integer.')
        if row.lower is None and row.upper is None:
            raise ValueError(f'Interval row {index + 1} needs a lower or upper bound.')
        if row.lower is not None and (not np.isfinite(row.lower) or row.lower < 0):
            raise ValueError(f'Interval row {index + 1} lower bound must be finite and >= 0.')
        if row.upper is not None and (not np.isfinite(row.upper) or row.upper <= 0):
            raise ValueError(f'Interval row {index + 1} upper bound must be finite and > 0.')
        if row.lower is not None and row.upper is not None and row.lower >= row.upper:
            raise ValueError(f'Interval row {index + 1} requires lower < upper.')
        if row.upper is not None:
            failure_count += row.count
    if failure_count < 2:
        raise ValueError('At least 2 interval/left-censored failures are required after counts.')
    return clean


def _weighted_ad(failures: np.ndarray, counts: np.ndarray, cdf) -> float:
    order = np.argsort(failures)
    times = failures[order]
    weights = counts[order].astype(int)
    n = int(np.sum(weights))
    values = np.clip(np.asarray(cdf(times), dtype=float), 1e-15, 1 - 1e-15)
    total = 0.0
    start = 1
    for value, count in zip(values, weights):
        end = start + int(count) - 1
        coefficient_f = float(count) * (start + end - 1)
        coefficient_s = float(count) * (2 * n - start - end + 1)
        total += coefficient_f * math.log(float(value))
        total += coefficient_s * math.log1p(-float(value))
        start = end + 1
    return float(-n - total / n)


def _fit_grouped_exact_exponential(
    distribution: str,
    failures: np.ndarray,
    failure_weights: np.ndarray,
    censored: np.ndarray,
    censored_weights: np.ndarray,
    CI: float,
) -> GroupedLifeFit:
    """Analytic exact-frequency fit for exponential families."""
    right_censored = censored if len(censored) else None
    censor_weights = censored_weights if len(censored_weights) else None
    if distribution == "Exponential_1P":
        rate, exposure, r = exponential_1p_mle(
            failures,
            right_censored,
            failure_weights=failure_weights,
            censored_weights=censor_weights,
        )
        natural_params = {"Lambda": rate}
        inference = exponential_1p_exact_inference(
            failures,
            right_censored,
            CI=CI,
            failure_weights=failure_weights,
            censored_weights=censor_weights,
        )
        k = 1
        loglik = r * math.log(rate) - rate * exposure
    else:
        rate, gamma, exposure, r, _ = exponential_2p_mle(
            failures,
            right_censored,
            failure_weights=failure_weights,
            censored_weights=censor_weights,
        )
        natural_params = {"Lambda": rate, "gamma": gamma}
        inference = exponential_2p_exact_inference(
            failures,
            right_censored,
            CI=CI,
            failure_weights=failure_weights,
            censored_weights=censor_weights,
        )
        k = 2
        loglik = r * math.log(rate) - rate * exposure

    distribution_object = _reliability_distribution(distribution, natural_params)
    n_failures = int(np.sum(failure_weights))
    n_censored = int(np.sum(censored_weights)) if len(censored_weights) else 0
    n = n_failures + n_censored
    params = dict(natural_params)
    intervals = inference.get("parameter_intervals", {})
    for name in _parameter_names(distribution):
        lower, upper = intervals.get(name, (math.nan, math.nan))
        params[f"{name}_se"] = math.nan
        params[f"{name}_lower"] = float(lower)
        params[f"{name}_upper"] = float(upper)

    metadata = inference["metadata"]
    available = bool(metadata["available"])
    parameter_method = (
        "exact_chi_square"
        if distribution == "Exponential_1P" and available
        else "exact_chi_square_and_support_bounded_f"
        if available
        else "exact_unavailable"
    )
    function_method = "exact_joint_pivotal" if available else "exact_unavailable"
    uncertainty_warnings = list(metadata.get("warnings", []))
    if not available and metadata.get("reason"):
        uncertainty_warnings.append(
            f"exact_inference_unavailable_{metadata['reason']}"
        )
    diagnostics = {
        "converged": True,
        "optimizer": "analytic_support_boundary_mle",
        "success": True,
        "message": "Closed-form exponential MLE; no numerical optimizer required.",
        "objective": float(-loglik),
        "finite_parameters": True,
        "finite_objective": bool(np.isfinite(loglik)),
        "gradient_finite": None,
        "gradient_norm": None,
        "raw_gradient_norm": None,
        "boundary_parameters": [1] if distribution == "Exponential_2P" else [],
        "parameter_values": list(natural_params.values()),
        "warnings": [],
    }
    aicc = AICc(loglik, k, n)
    aicc_eligible = bool(np.isfinite(aicc))
    eligibility_reasons = (
        [] if aicc_eligible else ["aicc_undefined_for_sample_size"]
    )
    fit = GroupedLifeFit(
        distribution_name=distribution,
        params=params,
        distribution=distribution_object,
        theta=np.asarray(list(natural_params.values()), dtype=float),
        covariance_theta=None,
        covariance_natural=None,
        loglik=float(loglik),
        AICc=aicc,
        BIC=BIC(loglik, k, n),
        AD=(
            _weighted_ad(failures, failure_weights, distribution_object._cdf)
            if n_censored == 0 else None
        ),
        n=n,
        n_failures=n_failures,
        n_censored=n_censored,
        CI=CI,
        method="MLE",
        converged=True,
        fit_eligible=True,
        aicc_eligible=aicc_eligible,
        eligibility_reasons=eligibility_reasons,
        fit_diagnostics=diagnostics,
        parameter_ci_method=parameter_method,
        function_ci_method=function_method,
        uncertainty_warnings=uncertainty_warnings,
        confidence_metadata=metadata,
        _exact_exponential_inference=inference,
        _exact_normal_inference=None,
        _dist_class=Exponential_Distribution,
    )
    for name, value in natural_params.items():
        setattr(fit, name, value)
        setattr(fit, f"{name}_SE", math.nan)
        setattr(fit, f"{name}_lower", params[f"{name}_lower"])
        setattr(fit, f"{name}_upper", params[f"{name}_upper"])
    return fit


def _natural_covariance(spec: _DistributionSpec, theta, objective):
    covariance_theta = None
    for step in (1e-3, 3e-4, 1e-4, 3e-5):
        # Trial perturbations can legitimately leave the finite support of a
        # candidate distribution.  The objective maps those trials to a large
        # finite penalty; suppress only the expected floating-point warnings
        # while probing the observed-information matrix.
        with warnings.catch_warnings(), np.errstate(all='ignore'):
            warnings.simplefilter('ignore', RuntimeWarning)
            hessian = numerical_hessian(objective, theta, rel_step=step)
        if hessian is None:
            continue
        hessian = 0.5 * (hessian + hessian.T)
        try:
            eigenvalues = np.linalg.eigvalsh(hessian)
            condition = float(np.linalg.cond(hessian))
            candidate = np.linalg.inv(hessian)
        except np.linalg.LinAlgError:
            continue
        if (np.all(eigenvalues > 0)
                and np.isfinite(condition)
                and condition <= 1e10
                and candidate.shape == (len(theta), len(theta))
                and np.all(np.isfinite(candidate))
                and np.all(np.linalg.eigvalsh(candidate) > 0)):
            covariance_theta = candidate
            break
    if covariance_theta is None:
        return None, None

    natural_values = np.array(list(spec.decode(theta)[1].values()), dtype=float)
    jacobian = np.zeros((len(natural_values), len(theta)))
    for index in range(len(theta)):
        step = 1e-5 * max(abs(float(theta[index])), 1.0)
        plus = theta.copy(); plus[index] += step
        minus = theta.copy(); minus[index] -= step
        plus_values = np.array(list(spec.decode(plus)[1].values()), dtype=float)
        minus_values = np.array(list(spec.decode(minus)[1].values()), dtype=float)
        jacobian[:, index] = (plus_values - minus_values) / (2 * step)
    natural = jacobian @ covariance_theta @ jacobian.T
    natural = 0.5 * (natural + natural.T)
    if (not np.all(np.isfinite(natural))
            or np.any(np.linalg.eigvalsh(natural) <= 0)):
        natural = None
    return covariance_theta, natural


def fit_grouped_life(
    observation_model: str,
    observations: Iterable[FrequencyObservation | IntervalObservation],
    distribution: str,
    CI: float = 0.95,
) -> GroupedLifeFit:
    """Fit one distribution using a weighted exact or interval likelihood."""
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')

    if observation_model == 'frequency_exact':
        rows = validate_frequency_observations(observations)  # type: ignore[arg-type]
        failures = np.asarray([row.time for row in rows if row.state == 'F'], dtype=float)
        failure_weights = np.asarray([row.count for row in rows if row.state == 'F'], dtype=float)
        censored = np.asarray([row.time for row in rows if row.state == 'S'], dtype=float)
        censored_weights = np.asarray([row.count for row in rows if row.state == 'S'], dtype=float)
        if distribution == 'Beta_2P' and (
            np.any(failures >= 1) or (len(censored) and np.any(censored >= 1))
        ):
            raise ValueError('Beta_2P exact-frequency times must lie strictly between 0 and 1.')
        n_failures = int(np.sum(failure_weights))
        n_censored = int(np.sum(censored_weights)) if len(censored_weights) else 0
        if distribution in ("Exponential_1P", "Exponential_2P"):
            return _fit_grouped_exact_exponential(
                distribution,
                failures,
                failure_weights,
                censored,
                censored_weights,
                CI,
            )
        reference = failures
        reference_weights = failure_weights
        minimum_failure = float(np.min(failures))
        spec = grouped_distribution_spec(
            distribution, reference, reference_weights,
            minimum_failure=minimum_failure, allow_threshold=True,
        )

        def objective(theta):
            try:
                frozen, _ = spec.decode(np.asarray(theta, dtype=float))
                with np.errstate(all='ignore'):
                    loglik = float(np.sum(failure_weights * frozen.logpdf(failures)))
                    if len(censored):
                        loglik += float(np.sum(censored_weights * frozen.logsf(censored)))
                return -loglik if np.isfinite(loglik) else 1e300
            except (ValueError, FloatingPointError, OverflowError):
                return 1e300

    elif observation_model == 'interval_censored':
        rows = validate_interval_observations(observations)  # type: ignore[arg-type]
        finite_failure_rows = [row for row in rows if row.upper is not None]
        # These representative values seed the optimizer only.  The objective,
        # fit statistics, and plot context below always use the full interval
        # probabilities and never treat a midpoint as an observed event.
        midpoints = np.asarray([
            (0.0 if row.lower is None else row.lower) / 2.0 + row.upper / 2.0
            for row in finite_failure_rows
        ], dtype=float)
        failure_weights = np.asarray([row.count for row in finite_failure_rows], dtype=float)
        if distribution == 'Beta_2P' and any(
            (row.lower is not None and row.lower < 0)
            or (row.upper is not None and row.upper > 1)
            for row in rows
        ):
            raise ValueError('Beta_2P interval bounds must lie within [0, 1].')
        spec = grouped_distribution_spec(
            distribution, np.maximum(midpoints, 1e-6), failure_weights,
            allow_threshold=False,
        )

        finite_both = [row for row in rows if row.lower is not None and row.upper is not None]
        left = [row for row in rows if row.lower is None and row.upper is not None]
        right = [row for row in rows if row.lower is not None and row.upper is None]
        lower = np.asarray([row.lower for row in finite_both], dtype=float)
        upper = np.asarray([row.upper for row in finite_both], dtype=float)
        interval_weights = np.asarray([row.count for row in finite_both], dtype=float)
        left_upper = np.asarray([row.upper for row in left], dtype=float)
        left_weights = np.asarray([row.count for row in left], dtype=float)
        right_lower = np.asarray([row.lower for row in right], dtype=float)
        right_weights = np.asarray([row.count for row in right], dtype=float)

        def objective(theta):
            try:
                frozen, _ = spec.decode(np.asarray(theta, dtype=float))
                value = 0.0
                with np.errstate(all='ignore'):
                    if len(lower):
                        terms = log_interval_probability(frozen, lower, upper)
                        if np.any(~np.isfinite(terms)):
                            return 1e300
                        value += float(np.sum(interval_weights * terms))
                    if len(left_upper):
                        terms = np.asarray(frozen.logcdf(left_upper), dtype=float)
                        if np.any(~np.isfinite(terms)):
                            return 1e300
                        value += float(np.sum(left_weights * terms))
                    if len(right_lower):
                        terms = np.asarray(frozen.logsf(right_lower), dtype=float)
                        if np.any(~np.isfinite(terms)):
                            return 1e300
                        value += float(np.sum(right_weights * terms))
                return -value if np.isfinite(value) else 1e300
            except (ValueError, FloatingPointError, OverflowError):
                return 1e300

        n_failures = int(sum(row.count for row in rows if row.upper is not None))
        n_censored = int(sum(row.count for row in rows if row.upper is None))
        failures = np.asarray([], dtype=float)
        failure_weights = np.asarray([], dtype=float)
        censored = np.asarray([], dtype=float)
    else:
        raise ValueError("observation_model must be 'frequency_exact' or 'interval_censored'.")

    rng = np.random.default_rng(2027)
    starts = [spec.start]
    scale = np.maximum(np.abs(spec.start), 1.0)
    for jitter in (0.08, 0.2, 0.45, 0.8):
        starts.append(spec.start + rng.normal(0.0, jitter, len(spec.start)) * scale)
    candidates = []
    for index, start in enumerate(starts):
        result = optimize.minimize(
            objective, start, method='L-BFGS-B', bounds=spec.bounds,
            options={'maxiter': 5000, 'ftol': 1e-12, 'gtol': 1e-8},
        )
        candidates.append((f'L-BFGS-B start {index + 1}', result))
    best_seed = min(candidates, key=lambda pair: float(pair[1].fun))[1]
    polished = optimize.minimize(
        objective, best_seed.x, method='Nelder-Mead', bounds=spec.bounds,
        options={'maxiter': 10000, 'xatol': 1e-9, 'fatol': 1e-9},
    )
    candidates.append(('Nelder-Mead polish', polished))
    best, diagnostics = select_best_optimizer_result(
        candidates, objective, bounds=spec.bounds,
    )
    theta = np.asarray(best.x, dtype=float)
    _, natural_params = spec.decode(theta)
    distribution_object = _reliability_distribution(distribution, natural_params)
    covariance_theta, covariance_natural = _natural_covariance(spec, theta, objective)

    params = dict(natural_params)
    warnings_: list[str] = []
    if covariance_theta is None or covariance_natural is None:
        warnings_.append('observed_information_covariance_unavailable')
    else:
        z = float(stats.norm.ppf(0.5 + CI / 2.0))
        theta_se = np.sqrt(np.diag(covariance_theta))
        natural_se = np.sqrt(np.clip(np.diag(covariance_natural), 0, None))
        for index, name in enumerate(spec.names):
            lower_theta = theta.copy(); lower_theta[index] -= z * theta_se[index]
            upper_theta = theta.copy(); upper_theta[index] += z * theta_se[index]
            lower_value = spec.decode(lower_theta)[1][name]
            upper_value = spec.decode(upper_theta)[1][name]
            params[f'{name}_se'] = float(natural_se[index])
            params[f'{name}_lower'] = float(min(lower_value, upper_value))
            params[f'{name}_upper'] = float(max(lower_value, upper_value))

    n = n_failures + n_censored
    loglik = -float(best.fun)
    k = len(spec.names)
    aicc = AICc(loglik, k, n)
    bic = BIC(loglik, k, n)
    ad = None
    if observation_model == 'frequency_exact' and n_censored == 0:
        ad = _weighted_ad(failures, failure_weights, distribution_object._cdf)
    converged = bool(diagnostics.get('converged', False))
    reasons = []
    if not converged:
        reasons.append('optimizer_not_converged')
    if not np.isfinite(loglik):
        reasons.append('nonfinite_log_likelihood')
    if not np.isfinite(aicc):
        reasons.append('aicc_undefined_for_sample_size')
    fit_eligible = converged and np.isfinite(loglik)
    parameter_ci_method = 'observed_information_transformed_grouped_likelihood'
    function_ci_method = 'delta_method_from_grouped_likelihood_covariance'
    confidence_metadata: dict = {}
    exact_normal = None
    if (
        observation_model == 'frequency_exact'
        and distribution in ('Normal_2P', 'Lognormal_2P')
        and n_censored == 0
    ):
        exact_normal = normal_exact_inference(
            failures,
            CI=CI,
            lognormal=distribution == 'Lognormal_2P',
            weights=failure_weights,
        )
        intervals = exact_normal['parameter_intervals']
        covariance_theta = None
        covariance_natural = None
        for name in spec.names:
            params[f'{name}_se'] = math.nan
            params[f'{name}_lower'] = float(intervals[name][0])
            params[f'{name}_upper'] = float(intervals[name][1])
        parameter_ci_method = 'exact_student_t_and_chi_square'
        function_ci_method = 'exact_noncentral_t_pointwise'
        warnings_ = []
        confidence_metadata = dict(exact_normal['metadata'])
    elif any(name == 'gamma' for name in spec.names):
        covariance_theta = None
        covariance_natural = None
        for name in spec.names:
            params.pop(f'{name}_se', None)
            params.pop(f'{name}_lower', None)
            params.pop(f'{name}_upper', None)
        parameter_ci_method = 'unavailable'
        function_ci_method = 'unavailable'
        warnings_ = [
            'confidence_inference_unavailable_nonregular_location_inference'
        ]
        confidence_metadata = {
            'available': False,
            'reason': 'nonregular_location_inference',
            'sample_design': observation_model,
            'confidence_level': float(CI),
            'estimator': 'MLE',
            'exact': False,
            'band_scope': None,
            'parameter_methods': {},
            'function_method': None,
            'assumptions': [],
            'warnings': list(warnings_),
            'validation_status': 'unsupported',
            'primary': False,
        }
    elif observation_model == 'interval_censored' and distribution == 'Exponential_1P':
        # The exact chi-square pivot implemented for exponential data requires
        # exact complete or Type-II observations.  Do not silently substitute a
        # Wald/delta approximation for inspection-interval data.
        covariance_theta = None
        covariance_natural = None
        for name in spec.names:
            params.pop(f'{name}_se', None)
            params.pop(f'{name}_lower', None)
            params.pop(f'{name}_upper', None)
        parameter_ci_method = 'exact_unavailable'
        function_ci_method = 'exact_unavailable'
        warnings_ = ['exact_inference_unavailable_interval_censored_data']
        confidence_metadata = {
            'available': False,
            'reason': 'interval_censored_data',
            'sample_design': 'interval_censored',
            'confidence_level': float(CI),
            'exact': False,
            'band_scope': None,
            'parameter_methods': {},
            'function_method': None,
            'assumptions': [
                'independent_identically_distributed_exponential_lifetimes',
                'noninformative_censoring',
                'continuous_failure_times',
            ],
            'warnings': [],
        }
    else:
        confidence_metadata = {
            'available': covariance_natural is not None,
            'reason': (
                None if covariance_natural is not None
                else 'covariance_unavailable'
            ),
            'sample_design': observation_model,
            'confidence_level': float(CI),
            'estimator': 'MLE',
            'exact': False,
            'band_scope': (
                'pointwise' if covariance_natural is not None else None
            ),
            'parameter_methods': ({
                name: 'quick_observed_information_wald'
                for name in spec.names
            } if covariance_natural is not None else {}),
            'function_method': (
                'quick_transformed_pointwise_delta'
                if covariance_natural is not None else None
            ),
            'assumptions': [
                'regular_interior_grouped_likelihood',
                'large_sample_normal_approximation',
                'noninformative_censoring',
            ],
            'warnings': list(warnings_) + [
                'asymptotic_wald_delta_approximation'
            ],
            'validation_status': 'quick_asymptotic_opt_in',
            'primary': False,
        }

    fit = GroupedLifeFit(
        distribution_name=distribution,
        params=params,
        distribution=distribution_object,
        theta=theta,
        covariance_theta=covariance_theta,
        covariance_natural=covariance_natural,
        loglik=loglik,
        AICc=aicc,
        BIC=bic,
        AD=ad,
        n=n,
        n_failures=n_failures,
        n_censored=n_censored,
        CI=CI,
        method='MLE',
        converged=converged,
        fit_eligible=bool(fit_eligible),
        aicc_eligible=bool(fit_eligible and np.isfinite(aicc)),
        eligibility_reasons=reasons,
        fit_diagnostics=diagnostics,
        parameter_ci_method=parameter_ci_method,
        function_ci_method=function_ci_method,
        uncertainty_warnings=warnings_,
        confidence_metadata=confidence_metadata,
        _exact_exponential_inference=None,
        _exact_normal_inference=exact_normal,
        _dist_class=spec.dist_class,
    )
    for name in spec.names:
        setattr(fit, name, natural_params[name])
        if f'{name}_lower' in params:
            setattr(fit, f'{name}_lower', params[f'{name}_lower'])
            setattr(fit, f'{name}_upper', params[f'{name}_upper'])
            setattr(fit, f'{name}_SE', params[f'{name}_se'])
    return fit


def weighted_rank_adjustment(
    observations: Iterable[FrequencyObservation],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """Return failure times, count-aware midpoint ranks, counts and total n."""
    rows = validate_frequency_observations(observations)
    grouped: dict[tuple[float, str], int] = {}
    for row in rows:
        grouped[(float(row.time), row.state)] = grouped.get((float(row.time), row.state), 0) + int(row.count)
    ordered = sorted(grouped.items(), key=lambda item: (item[0][0], 0 if item[0][1] == 'F' else 1))
    n = sum(count for _, count in ordered)
    processed = 0
    previous_order = 0.0
    times, ranks, counts = [], [], []
    for (time, state), count in ordered:
        denominator = n - processed + 1.0
        if state == 'F':
            midpoint_count = (count + 1.0) / 2.0
            remaining_mid = (n + 1.0 - previous_order) * (
                denominator - midpoint_count) / denominator
            midpoint_rank = n + 1.0 - remaining_mid
            remaining_end = (n + 1.0 - previous_order) * (
                denominator - count) / denominator
            previous_order = n + 1.0 - remaining_end
            times.append(time); ranks.append(midpoint_rank); counts.append(count)
        processed += count
    return (np.asarray(times, dtype=float), np.asarray(ranks, dtype=float),
            np.asarray(counts, dtype=int), int(n))


def turnbull_estimate(
    observations: Iterable[IntervalObservation],
    *,
    tolerance: float = 1e-10,
    max_iterations: int = 10000,
) -> dict:
    """Turnbull-style EM NPMLE on finite interval endpoints plus tail mass."""
    rows = validate_interval_observations(observations)
    support = np.asarray(sorted({float(row.upper) for row in rows if row.upper is not None}),
                         dtype=float)
    if len(support) == 0:
        raise ValueError('Turnbull estimation requires at least one finite upper bound.')
    masses = np.full(len(support) + 1, 1.0 / (len(support) + 1), dtype=float)
    compatibility = []
    weights = []
    for row in rows:
        lower = -np.inf if row.lower is None else float(row.lower)
        upper = np.inf if row.upper is None else float(row.upper)
        mask = np.zeros(len(support) + 1, dtype=bool)
        mask[:-1] = (support > lower) & (support <= upper)
        mask[-1] = np.isinf(upper)
        if not np.any(mask):
            raise ValueError('Interval configuration has no compatible Turnbull support point.')
        compatibility.append(mask)
        weights.append(int(row.count))
    total = float(sum(weights))
    converged = False
    for iteration in range(1, max_iterations + 1):
        expected = np.zeros_like(masses)
        for mask, weight in zip(compatibility, weights):
            denominator = float(np.sum(masses[mask]))
            if denominator <= 0:
                continue
            expected[mask] += weight * masses[mask] / denominator
        updated = expected / total
        if float(np.max(np.abs(updated - masses))) < tolerance:
            masses = updated
            converged = True
            break
        masses = updated
    cdf = np.cumsum(masses[:-1])
    return {
        'time': support.tolist(),
        'cdf': cdf.tolist(),
        'sf': (1.0 - cdf).tolist(),
        'mass': masses[:-1].tolist(),
        'tail_mass': float(masses[-1]),
        'iterations': iteration,
        'converged': converged,
        'method': 'Turnbull EM NPMLE',
    }


def turnbull_bootstrap(
    observations: Iterable[IntervalObservation],
    *,
    CI: float = 0.95,
    n_bootstrap: int = 499,
    seed: int | None = None,
) -> dict:
    """Observation-pattern bootstrap pointwise bands for the Turnbull NPMLE."""
    rows = validate_interval_observations(observations)
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')
    if not 20 <= int(n_bootstrap) <= 2000 or int(n_bootstrap) != n_bootstrap:
        raise ValueError('n_bootstrap must be an integer from 20 to 2000.')
    base = turnbull_estimate(rows)
    support = np.asarray(base['time'], dtype=float)
    counts = np.asarray([row.count for row in rows], dtype=int)
    total = int(np.sum(counts))
    probabilities = counts / total
    rng = np.random.default_rng(seed)
    cdf_samples = []
    failures = 0
    for _ in range(int(n_bootstrap)):
        sampled_counts = rng.multinomial(total, probabilities)
        sampled_rows = [
            IntervalObservation(
                lower=row.lower,
                upper=row.upper,
                count=int(count),
                id=row.id,
            )
            for row, count in zip(rows, sampled_counts)
            if count > 0
        ]
        try:
            estimate = turnbull_estimate(sampled_rows)
        except ValueError:
            failures += 1
            continue
        candidate_time = np.asarray(estimate['time'], dtype=float)
        candidate_cdf = np.asarray(estimate['cdf'], dtype=float)
        indices = np.searchsorted(candidate_time, support, side='right') - 1
        evaluated = np.where(
            indices >= 0,
            candidate_cdf[np.maximum(indices, 0)],
            0.0,
        )
        cdf_samples.append(evaluated)
    minimum = math.ceil(0.95 * int(n_bootstrap))
    if len(cdf_samples) < minimum:
        raise FitConvergenceError(
            f'Only {len(cdf_samples)}/{n_bootstrap} Turnbull bootstrap '
            'replicates converged.'
        )
    alpha = (1.0 - CI) / 2.0
    sample_array = np.asarray(cdf_samples, dtype=float)
    cdf_lower, cdf_upper = np.quantile(
        sample_array, [alpha, 1.0 - alpha], axis=0
    )
    return {
        **base,
        'cdf_lower': cdf_lower.tolist(),
        'cdf_upper': cdf_upper.tolist(),
        'sf_lower': (1.0 - cdf_upper).tolist(),
        'sf_upper': (1.0 - cdf_lower).tolist(),
        'confidence': {
            'available': True,
            'reason': None,
            'sample_design': 'interval_observation_pattern_bootstrap',
            'confidence_level': float(CI),
            'estimator': 'Turnbull NPMLE',
            'exact': False,
            'band_scope': 'pointwise',
            'parameter_methods': {},
            'function_method': 'observation_pattern_bootstrap_percentile',
            'assumptions': [
                'observed_interval_patterns_represent_the_sampling_process',
                'independent_subjects',
            ],
            'warnings': [],
            'validation_status': 'on_demand_bootstrap',
            'primary': True,
            'n_requested': int(n_bootstrap),
            'n_successful': len(cdf_samples),
            'success_rate': len(cdf_samples) / float(n_bootstrap),
            'seed': seed,
            'failed_replicates': failures,
        },
    }
