"""Deterministic workloads shared by Perdura's benchmark runners."""

from __future__ import annotations

import numpy as np

from reliability.Descriptive import summary_statistics
from reliability.Distributions import Weibull_Distribution
from reliability.Fitters import Fit_Everything, Fit_Weibull_2P


def _weibull_quantiles(count: int, *, eta: float = 1250.0, beta: float = 2.4) -> np.ndarray:
    probabilities = (np.arange(count, dtype=float) + 0.5) / count
    return eta * (-np.log1p(-probabilities)) ** (1.0 / beta)


def distribution_vector() -> float:
    """Evaluate a large vector through a production distribution kernel."""
    x = np.linspace(0.01, 5000.0, 100_000)
    values = Weibull_Distribution(eta=1250.0, beta=2.4)._cdf(x)
    return float(values[-1] + values[50_000])


def descriptive_large() -> float:
    """Compute the complete descriptive-statistics result for 10k values."""
    x = np.linspace(0.0, 200.0, 10_000) + np.sin(np.linspace(0.0, 60.0, 10_000))
    result = summary_statistics({"measurement": x.tolist()})["measurement"]
    return float(result["mean"] + result["std"] + result["p95"])


def weibull_fit() -> float:
    """Fit a censored Weibull MLE and its production confidence intervals."""
    failures = _weibull_quantiles(220)
    censored = np.linspace(800.0, 2200.0, 30)
    fit = Fit_Weibull_2P(
        failures=failures,
        right_censored=censored,
        method="MLE",
        show_probability_plot=False,
        CI=0.95,
    )
    return float(fit.eta + fit.beta + fit.loglik)


def distribution_comparison() -> float:
    """Exercise representative multi-model selection and eligibility logic."""
    failures = _weibull_quantiles(120)
    fit = Fit_Everything(
        failures=failures,
        distributions_to_fit=[
            "Weibull_2P", "Lognormal_2P", "Gamma_2P", "Exponential_1P",
        ],
        method="MLE",
        sort_by="BIC",
        CI=0.95,
    )
    return float(len(fit.results) + fit.results["BIC"].replace([np.inf, -np.inf], np.nan).min())


WORKLOADS = {
    "distribution-vector-100k": distribution_vector,
    "descriptive-summary-10k": descriptive_large,
    "weibull-mle-250-observations": weibull_fit,
    "distribution-comparison-4-candidates": distribution_comparison,
}
