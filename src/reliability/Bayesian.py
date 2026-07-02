"""
Bayesian Weibull (Weibayes) analysis.

``weibayes_fit`` fits a Weibull distribution under the assumption that the
shape parameter beta is known (fixed), estimating the scale parameter eta
via maximum likelihood from a combination of failure and suspension times.

The approach is sometimes called *Type I Weibayes* when a non-informative
prior is used, yielding a closed-form MLE for eta and chi-squared-based
confidence bounds.

Reference: Abernethy, R.B., "The New Weibull Handbook", 5th ed.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import chi2


def weibayes_fit(
    times: list[float],
    states: list[str],
    beta: float,
    CI: float = 0.95,
) -> dict:
    """Fit a Weibull scale parameter (eta) given a fixed shape (beta).

    Parameters
    ----------
    times:
        All observed times — both failures and suspensions combined.
    states:
        Per-entry state label: ``'F'`` for failure, ``'S'`` for suspension
        (right-censored).  Must be the same length as *times*.
    beta:
        Known (assumed) Weibull shape parameter.
    CI:
        Confidence level, e.g. ``0.95`` for 95 % bounds.

    Returns
    -------
    dict
        Keys: ``beta``, ``eta``, ``eta_lower``, ``eta_upper``, ``r``,
        ``sum_tb``, ``CI``, ``zero_failure``, ``curves``.
    """
    times = np.asarray(times, dtype=float)
    states = [s.upper() for s in states]

    if len(times) != len(states):
        raise ValueError("times and states must have the same length.")
    if np.any(times <= 0):
        raise ValueError("All times must be strictly positive.")
    if not (0 < CI < 1):
        raise ValueError("CI must be strictly between 0 and 1.")

    # ── Core statistics ────────────────────────────────────────────────────────
    r = int(sum(1 for s in states if s == "F"))
    sum_tb = float(np.sum(times ** beta))

    # ── Point estimate and confidence bounds ──────────────────────────────────
    if r > 0:
        # MLE point estimate
        eta = (sum_tb / r) ** (1.0 / beta)

        # Two-sided 100·CI% interval: alpha/2 in each chi-square tail of the
        # Weibayes pivotal 2·Σt^β/η^β ~ χ² (df = 2r for the upper bound,
        # 2(r+1) for the conservative lower bound). Pairing two one-sided
        # CI-level bounds — the previous behavior — gives an effective
        # two-sided coverage of only 2·CI−1 (90% when CI=0.95).
        alpha_tail = (1.0 - CI) / 2.0
        chi2_upper = chi2.ppf(alpha_tail, df=2 * r)
        if chi2_upper > 0:
            eta_upper = (2.0 * sum_tb / chi2_upper) ** (1.0 / beta)
        else:
            eta_upper = None

        chi2_lower = chi2.ppf(1.0 - alpha_tail, df=2 * (r + 1))
        eta_lower = (2.0 * sum_tb / chi2_lower) ** (1.0 / beta)

    else:
        # Zero-failure case — no MLE point estimate.
        eta = None
        eta_upper = None

        # Conservative lower bound on eta (1-sided, confidence = CI).
        # Equivalent to asking: at what eta can we say, with probability CI,
        # the true eta is at least this large?
        chi2_val = chi2.ppf(CI, df=2)
        eta_lower = (sum_tb / (chi2_val / 2.0)) ** (1.0 / beta)

    # ── Curve generation ──────────────────────────────────────────────────────
    x_min = float(np.min(times)) * 0.5
    x_max = float(np.max(times)) * 1.5
    x = np.linspace(x_min, x_max, 300)

    # Central eta for curves (fall back to eta_lower for zero-failure case)
    eta_central = eta if eta is not None else eta_lower

    def _sf(t, eta_val):
        return np.clip(np.exp(-((t / eta_val) ** beta)), 0.0, 1.0)

    def _pdf(t, eta_val):
        sf_val = _sf(t, eta_val)
        return (beta / eta_val) * ((t / eta_val) ** (beta - 1.0)) * sf_val

    def _hf(t, eta_val):
        return (beta / eta_val) * ((t / eta_val) ** (beta - 1.0))

    sf_central = _sf(x, eta_central)
    curves = {
        "x": x.tolist(),
        "sf": sf_central.tolist(),
        "cdf": (1.0 - sf_central).tolist(),
        "pdf": _pdf(x, eta_central).tolist(),
        "hf": _hf(x, eta_central).tolist(),
        # sf_lower uses eta_upper (higher eta → higher SF → optimistic lower failure)
        "sf_lower": (_sf(x, eta_upper) if eta_upper is not None else [None] * 300).tolist() if eta_upper is not None else [None] * 300,
        # sf_upper uses eta_lower (lower eta → lower SF → conservative upper failure)
        "sf_upper": _sf(x, eta_lower).tolist() if eta_lower is not None else [None] * 300,
    }

    return {
        "beta": beta,
        "eta": eta,
        "eta_lower": eta_lower,
        "eta_upper": eta_upper,
        "r": r,
        "sum_tb": sum_tb,
        "CI": CI,
        "zero_failure": r == 0,
        "curves": curves,
    }
