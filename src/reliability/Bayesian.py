"""Bayesian/Weibayes Weibull analysis with explicit shape assumptions.

The default remains fixed-shape Weibayes for compatibility.  Two opt-in
engines propagate uncertainty in the Weibull shape parameter:

* ``sensitivity`` envelopes results over a user-supplied beta range;
* ``bayesian`` combines a truncated-normal beta prior with the Weibull
  likelihood and a scale-invariant prior on ``lambda = eta**(-beta)``.

Reference: Abernethy, R.B., *The New Weibull Handbook*, 5th ed.
"""

from __future__ import annotations

import numpy as np
from scipy.special import logsumexp
from scipy.stats import chi2, truncnorm


def _conditional_fit(times, beta, r, CI):
    sum_tb = float(np.sum(times ** beta))
    if r > 0:
        eta = (sum_tb / r) ** (1.0 / beta)
        alpha_tail = (1.0 - CI) / 2.0
        chi2_upper = chi2.ppf(alpha_tail, df=2 * r)
        eta_upper = ((2.0 * sum_tb / chi2_upper) ** (1.0 / beta)
                     if chi2_upper > 0 else None)
        chi2_lower = chi2.ppf(1.0 - alpha_tail, df=2 * (r + 1))
        eta_lower = (2.0 * sum_tb / chi2_lower) ** (1.0 / beta)
    else:
        eta = None
        eta_upper = None
        chi2_value = chi2.ppf(CI, df=2)
        eta_lower = (sum_tb / (chi2_value / 2.0)) ** (1.0 / beta)
    return {
        "beta": float(beta), "sum_tb": sum_tb, "eta": eta,
        "eta_lower": eta_lower, "eta_upper": eta_upper,
    }


def _sf(t, eta, beta):
    t = np.asarray(t, dtype=float)
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        cumulative_hazard = np.exp(
            np.clip(beta * (np.log(t) - np.log(eta)), -745, 710)
        )
        return np.exp(-cumulative_hazard)


def _bayesian_shape_propagation(times, failure_times, beta, beta_sd,
                                beta_lower, beta_upper, CI,
                                n_beta_samples, seed, x):
    if len(failure_times) == 0:
        raise ValueError(
            "Bayesian beta propagation requires at least one observed failure; "
            "use sensitivity mode for a zero-failure study."
        )
    if beta_sd is None or not np.isfinite(beta_sd) or beta_sd <= 0:
        raise ValueError("beta_sd must be finite and > 0 in bayesian mode.")
    if n_beta_samples < 500:
        raise ValueError("n_beta_samples must be at least 500.")

    lower = (float(beta_lower) if beta_lower is not None
             else max(np.finfo(float).eps, beta - 5 * beta_sd))
    upper = (float(beta_upper) if beta_upper is not None
             else beta + 5 * beta_sd)
    if not 0 < lower < upper or not lower <= beta <= upper:
        raise ValueError("Bayesian beta bounds must be positive and contain beta.")

    rng = np.random.default_rng(seed)
    n_candidates = max(5000, int(n_beta_samples) * 5)
    a = (lower - beta) / beta_sd
    b = (upper - beta) / beta_sd
    candidate_beta = truncnorm.rvs(
        a, b, loc=beta, scale=beta_sd, size=n_candidates,
        random_state=rng,
    )

    log_times = np.log(times)
    failure_log_sum = float(np.sum(np.log(failure_times)))
    r = len(failure_times)
    log_exposure = np.asarray([
        logsumexp(candidate * log_times) for candidate in candidate_beta
    ])
    # Marginal likelihood after integrating lambda=eta^-beta under
    # p(lambda) proportional to 1/lambda. The proposal is the beta prior, so
    # only this likelihood factor is required for importance weights.
    log_weight = (
        r * np.log(candidate_beta)
        + (candidate_beta - 1.0) * failure_log_sum
        - r * log_exposure
    )
    log_weight -= float(np.max(log_weight))
    weight = np.exp(log_weight)
    weight /= np.sum(weight)
    effective_sample_size = float(1.0 / np.sum(weight ** 2))
    if effective_sample_size < max(50.0, 0.01 * n_candidates):
        raise ValueError(
            "Beta importance sampling is degenerate; narrow/recenter the beta "
            "prior or increase its overlap with the data likelihood."
        )

    selected = rng.choice(
        n_candidates, size=int(n_beta_samples), replace=True, p=weight,
    )
    beta_draws = candidate_beta[selected]
    log_exposure_draws = log_exposure[selected]
    unit_gamma = rng.gamma(shape=r, scale=1.0, size=int(n_beta_samples))
    log_eta = (log_exposure_draws - np.log(unit_gamma)) / beta_draws
    eta_draws = np.exp(np.clip(log_eta, -700, 700))

    log_x = np.log(np.asarray(x, dtype=float))[None, :]
    log_hazard = beta_draws[:, None] * (log_x - log_eta[:, None])
    sf_draws = np.exp(-np.exp(np.clip(log_hazard, -745, 710)))
    alpha = (1.0 - CI) / 2.0
    sf_lower, sf_upper = np.quantile(sf_draws, [alpha, 1.0 - alpha], axis=0)
    eta_lower, eta_upper = np.quantile(eta_draws, [alpha, 1.0 - alpha])
    beta_post_lower, beta_post_upper = np.quantile(
        beta_draws, [alpha, 1.0 - alpha]
    )
    return {
        "method": "bayesian_beta_propagation",
        "eta_lower": float(eta_lower),
        "eta_upper": float(eta_upper),
        "beta_lower": float(beta_post_lower),
        "beta_upper": float(beta_post_upper),
        "beta_median": float(np.median(beta_draws)),
        "sf_lower": sf_lower,
        "sf_upper": sf_upper,
        "n_samples": int(n_beta_samples),
        "importance_candidates": n_candidates,
        "importance_effective_sample_size": effective_sample_size,
        "prior": {
            "distribution": "truncated_normal",
            "mean": float(beta),
            "standard_deviation": float(beta_sd),
            "lower": lower,
            "upper": upper,
        },
        "seed": seed,
    }


def weibayes_fit(
    times: list[float],
    states: list[str],
    beta: float,
    CI: float = 0.95,
    uncertainty_method: str = "fixed",
    beta_lower: float | None = None,
    beta_upper: float | None = None,
    beta_sd: float | None = None,
    n_beta_samples: int = 4000,
    seed: int | None = None,
) -> dict:
    """Fit Weibull scale with fixed, sensitivity, or uncertain beta.

    ``uncertainty_method='fixed'`` reproduces conventional fixed-beta
    Weibayes. ``'sensitivity'`` requires ``beta_lower`` and ``beta_upper``.
    ``'bayesian'`` requires ``beta_sd`` and at least one observed failure.
    """
    times = np.asarray(times, dtype=float)
    states = [s.upper() for s in states]
    beta = float(beta)
    method = str(uncertainty_method).lower()

    if len(times) != len(states):
        raise ValueError("times and states must have the same length.")
    if len(times) == 0 or np.any(~np.isfinite(times)) or np.any(times <= 0):
        raise ValueError("All times must be finite and strictly positive.")
    if any(state not in ("F", "S") for state in states):
        raise ValueError("Every state must be 'F' (failure) or 'S' (suspension).")
    if not np.isfinite(beta) or beta <= 0:
        raise ValueError("beta must be finite and > 0.")
    if not 0 < CI < 1:
        raise ValueError("CI must be strictly between 0 and 1.")
    if method not in ("fixed", "sensitivity", "bayesian"):
        raise ValueError("uncertainty_method must be fixed, sensitivity, or bayesian.")

    failure_mask = np.asarray([state == "F" for state in states])
    failure_times = times[failure_mask]
    r = int(np.sum(failure_mask))
    conditional = _conditional_fit(times, beta, r, CI)

    x = np.linspace(float(np.min(times)) * 0.5,
                    float(np.max(times)) * 1.5, 300)
    eta_central = (conditional["eta"] if conditional["eta"] is not None
                   else conditional["eta_lower"])
    sf_central = _sf(x, eta_central, beta)
    pdf = (beta / eta_central) * ((x / eta_central) ** (beta - 1.0)) * sf_central
    hazard = (beta / eta_central) * ((x / eta_central) ** (beta - 1.0))

    # Response contract v2: curve bounds are named by their ordinate, not by
    # which eta endpoint generated them.  Explicit legacy names preserve a
    # migration path for consumers that depended on the former reversal.
    semantic_sf_lower = (_sf(x, conditional["eta_lower"], beta)
                         if conditional["eta_lower"] is not None
                         else [None] * len(x))
    semantic_sf_upper = (_sf(x, conditional["eta_upper"], beta)
                         if conditional["eta_upper"] is not None
                         else [None] * len(x))
    legacy_sf_lower = semantic_sf_upper
    legacy_sf_upper = semantic_sf_lower

    propagation = None
    if method == "sensitivity":
        if beta_lower is None or beta_upper is None:
            raise ValueError(
                "beta_lower and beta_upper are required in sensitivity mode."
            )
        beta_lower = float(beta_lower)
        beta_upper = float(beta_upper)
        if not 0 < beta_lower <= beta <= beta_upper or beta_lower == beta_upper:
            raise ValueError(
                "Sensitivity beta bounds must be positive, distinct, and contain beta."
            )
        beta_grid = np.linspace(beta_lower, beta_upper, 101)
        conditional_grid = [
            _conditional_fit(times, candidate, r, CI)
            for candidate in beta_grid
        ]
        eta_lowers = np.asarray([item["eta_lower"] for item in conditional_grid])
        eta_uppers = [item["eta_upper"] for item in conditional_grid]
        semantic_lower = np.min(np.vstack([
            _sf(x, item["eta_lower"], item["beta"])
            for item in conditional_grid
        ]), axis=0)
        if all(value is not None for value in eta_uppers):
            semantic_upper = np.max(np.vstack([
                _sf(x, item["eta_upper"], item["beta"])
                for item in conditional_grid
            ]), axis=0)
            eta_propagated_upper = float(max(eta_uppers))
        else:
            semantic_upper = np.ones_like(x)
            eta_propagated_upper = None
        propagation = {
            "method": "beta_sensitivity_envelope",
            "eta_lower": float(np.min(eta_lowers)),
            "eta_upper": eta_propagated_upper,
            "beta_lower": beta_lower,
            "beta_upper": beta_upper,
            "sf_lower": semantic_lower,
            "sf_upper": semantic_upper,
            "grid_size": len(beta_grid),
        }
    elif method == "bayesian":
        propagation = _bayesian_shape_propagation(
            times, failure_times, beta, beta_sd, beta_lower, beta_upper,
            CI, n_beta_samples, seed, x,
        )

    curves = {
        "x": x.tolist(),
        "sf": sf_central.tolist(),
        "cdf": (1.0 - sf_central).tolist(),
        "pdf": np.asarray(pdf).tolist(),
        "hf": np.asarray(hazard).tolist(),
        "sf_lower": (semantic_sf_lower.tolist()
                     if isinstance(semantic_sf_lower, np.ndarray)
                     else semantic_sf_lower),
        "sf_upper": (semantic_sf_upper.tolist()
                     if isinstance(semantic_sf_upper, np.ndarray)
                     else semantic_sf_upper),
        "sf_legacy_lower_was_optimistic": (
            legacy_sf_lower.tolist()
            if isinstance(legacy_sf_lower, np.ndarray) else legacy_sf_lower),
        "sf_legacy_upper_was_conservative": (
            legacy_sf_upper.tolist()
            if isinstance(legacy_sf_upper, np.ndarray) else legacy_sf_upper),
        "sf_propagated_lower": (propagation["sf_lower"].tolist()
                                if propagation is not None else None),
        "sf_propagated_upper": (propagation["sf_upper"].tolist()
                                if propagation is not None else None),
    }

    return {
        "beta": beta,
        "eta": conditional["eta"],
        "eta_lower": conditional["eta_lower"],
        "eta_upper": conditional["eta_upper"],
        "r": r,
        "sum_tb": conditional["sum_tb"],
        "CI": CI,
        "zero_failure": r == 0,
        "beta_assumption": "fixed" if method == "fixed" else "uncertain",
        "uncertainty_method": method,
        "conditional_interval_method": "fixed_beta_chi_square",
        "response_contract_version": 2,
        "migration_note": (
            "curves.sf_lower <= curves.sf <= curves.sf_upper in v2; "
            "explicit sf_legacy_* fields reproduce the pre-v2 reversed names"
        ),
        "eta_propagated_lower": (propagation["eta_lower"]
                                 if propagation is not None else None),
        "eta_propagated_upper": (propagation["eta_upper"]
                                 if propagation is not None else None),
        "beta_uncertainty": ({key: value for key, value in propagation.items()
                              if key not in ("sf_lower", "sf_upper")}
                             if propagation is not None else None),
        "curves": curves,
    }
