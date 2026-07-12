"""Validated probability evaluation shared by FTA and RBD routers."""

import math

from scipy import special, stats

from schemas import validate_distribution_params


def distribution_cdf(distribution: str, params: dict, time: float) -> float:
    """Evaluate a supported CDF from already-validated or raw parameters.

    Validation is deliberately repeated at this computation boundary so direct
    calls cannot bypass the public request schema and trigger a silent default.
    """
    p = validate_distribution_params(distribution, params)
    t = float(time)
    if not math.isfinite(t) or t < 0:
        raise ValueError("evaluation time must be finite and non-negative")

    if distribution == "exponential":
        value = stats.expon.cdf(t, loc=p["gamma"], scale=1.0 / p["lambda"])
    elif distribution == "weibull":
        value = stats.weibull_min.cdf(
            t, c=p["beta"], loc=p["gamma"], scale=p["alpha"])
    elif distribution == "normal":
        value = special.ndtr((t - p["mu"]) / p["sigma"])
    elif distribution == "lognormal":
        shifted = t - p["gamma"]
        value = (0.0 if shifted <= 0 else
                 special.ndtr((math.log(shifted) - p["mu"]) / p["sigma"]))
    elif distribution == "gamma":
        value = stats.gamma.cdf(
            t, a=p["alpha"], loc=p["gamma"], scale=p["beta"])
    elif distribution == "loglogistic":
        value = stats.fisk.cdf(
            t, c=p["beta"], loc=p["gamma"], scale=p["alpha"])
    elif distribution == "gumbel":
        value = stats.gumbel_l.cdf(t, loc=p["mu"], scale=p["sigma"])
    elif distribution == "beta":
        value = stats.beta.cdf(min(1.0, max(0.0, t)), p["alpha"], p["beta"])
    else:  # pragma: no cover - schema validation owns this branch
        raise ValueError(f"unsupported distribution: {distribution!r}")

    value = float(value)
    if not math.isfinite(value):
        raise ValueError("distribution evaluation produced a non-finite probability")
    if value < -1e-12 or value > 1.0 + 1e-12:
        raise ValueError("distribution evaluation produced a probability outside [0, 1]")
    return min(1.0, max(0.0, value))
