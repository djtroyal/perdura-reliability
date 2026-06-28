"""
Accelerated Life Testing (ALT) data analysis fitters.

Provides 24 ALT fitter classes (6 life-stress models x 4 base distributions)
plus Fit_Everything_ALT for model comparison.

Life-stress models:
- Exponential: L(S) = a * exp(b/S) — Arrhenius equivalent
- Eyring: L(S) = (1/S) * exp(-(a - b/S))
- Power: L(S) = a * S^n — Inverse Power Law
- Dual_Exponential: L(S1,S2) = a * exp(b/S1 + c/S2)
- Power_Exponential: L(S1,S2) = a * S1^n * exp(b/S2)
- Dual_Power: L(S1,S2) = a * S1^b * S2^c

Base distributions: Weibull, Lognormal, Normal, Exponential
"""

import numpy as np
import pandas as pd
import os
import warnings
from concurrent.futures import ThreadPoolExecutor
from scipy.optimize import minimize
from scipy import stats as ss
from reliability.Distributions import (
    Weibull_Distribution, Exponential_Distribution,
    Normal_Distribution, Lognormal_Distribution,
)
from reliability.Utils import AICc, BIC


# ── Life-stress model functions ──────────────────────────────────────────────

def _life_exponential(S, a, b):
    """Arrhenius/Exponential: L(S) = a * exp(b/S)"""
    return a * np.exp(b / S)


def _life_eyring(S, a, b):
    """Eyring: L(S) = (1/S) * exp(-(a - b/S))"""
    return (1.0 / S) * np.exp(-(a - b / S))


def _life_power(S, a, n):
    """Inverse Power Law: L(S) = a * S^n"""
    return a * np.power(S, n)


def _life_dual_exponential(S1, S2, a, b, c):
    """Dual Exponential: L(S1,S2) = a * exp(b/S1 + c/S2)"""
    return a * np.exp(b / S1 + c / S2)


def _life_power_exponential(S1, S2, a, n, b):
    """Power-Exponential: L(S1,S2) = a * S1^n * exp(b/S2)"""
    return a * np.power(S1, n) * np.exp(b / S2)


def _life_dual_power(S1, S2, a, b, c):
    """Dual Power: L(S1,S2) = a * S1^b * S2^c"""
    return a * np.power(S1, b) * np.power(S2, c)


# ── Distribution helpers ────────────────────────────────────────────────────

_DIST_INFO = {
    'Weibull': {
        'class': Weibull_Distribution,
        'scale_param': 'eta',
        'shape_param': 'beta',
        'make': lambda scale, shape: Weibull_Distribution(eta=scale, beta=shape),
        'pdf': lambda x, scale, shape: Weibull_Distribution(eta=scale, beta=shape)._pdf(x),
        'sf': lambda x, scale, shape: Weibull_Distribution(eta=scale, beta=shape)._sf(x),
        # Vectorized log-density/log-survival (scale may be an array of per-point
        # characteristic lives); matches scipy weibull_min(c=beta, scale=eta).
        'logpdf': lambda x, scale, shape: ss.weibull_min.logpdf(x, c=shape, scale=scale),
        'logsf': lambda x, scale, shape: ss.weibull_min.logsf(x, c=shape, scale=scale),
    },
    'Lognormal': {
        'class': Lognormal_Distribution,
        'scale_param': 'mu',
        'shape_param': 'sigma',
        'make': lambda scale, shape: Lognormal_Distribution(mu=scale, sigma=shape),
        'pdf': lambda x, scale, shape: Lognormal_Distribution(mu=scale, sigma=shape)._pdf(x),
        'sf': lambda x, scale, shape: Lognormal_Distribution(mu=scale, sigma=shape)._sf(x),
        # scale is mu (log-scale) → scipy lognorm(s=sigma, scale=exp(mu)).
        'logpdf': lambda x, scale, shape: ss.lognorm.logpdf(x, s=shape, scale=np.exp(scale)),
        'logsf': lambda x, scale, shape: ss.lognorm.logsf(x, s=shape, scale=np.exp(scale)),
    },
    'Normal': {
        'class': Normal_Distribution,
        'scale_param': 'mu',
        'shape_param': 'sigma',
        'make': lambda scale, shape: Normal_Distribution(mu=scale, sigma=shape),
        'pdf': lambda x, scale, shape: Normal_Distribution(mu=scale, sigma=shape)._pdf(x),
        'sf': lambda x, scale, shape: Normal_Distribution(mu=scale, sigma=shape)._sf(x),
        # scale is the mean (loc); shape is sigma.
        'logpdf': lambda x, scale, shape: ss.norm.logpdf(x, loc=scale, scale=shape),
        'logsf': lambda x, scale, shape: ss.norm.logsf(x, loc=scale, scale=shape),
    },
    'Exponential': {
        'class': Exponential_Distribution,
        'scale_param': 'Lambda',
        'shape_param': None,
        'make': lambda scale, shape=None: Exponential_Distribution(Lambda=1.0 / scale),
        'pdf': lambda x, scale, shape=None: Exponential_Distribution(Lambda=1.0 / scale)._pdf(x),
        'sf': lambda x, scale, shape=None: Exponential_Distribution(Lambda=1.0 / scale)._sf(x),
        # scale is the mean life (1/Lambda) → scipy expon(scale=mean).
        'logpdf': lambda x, scale, shape=None: ss.expon.logpdf(x, scale=scale),
        'logsf': lambda x, scale, shape=None: ss.expon.logsf(x, scale=scale),
    },
}


def _alt_neg_log_likelihood(params, base_dist_name, life_stress_func, is_dual,
                            failures, failure_stress, right_censored, rc_stress):
    """Generic ALT negative log-likelihood."""
    dist_info = _DIST_INFO[base_dist_name]
    has_shape = dist_info['shape_param'] is not None

    if is_dual:
        n_life_params = 3
    else:
        n_life_params = 2

    life_params = params[:n_life_params]
    shape = params[n_life_params] if has_shape else None

    # A negative/zero shape parameter is invalid for every base distribution.
    if has_shape and (shape <= 0 or not np.isfinite(shape)):
        return np.inf

    LL = 0.0

    # Vectorized log-likelihood: the per-point characteristic life varies with
    # stress, so scipy's broadcasting (array scale parameter) replaces what used
    # to be a Python loop constructing one Distribution object per data point.
    # This is ~50-100x faster and prevents the optimizer from appearing to hang.
    try:
        with np.errstate(all='ignore'):
            if len(failures) > 0:
                if is_dual:
                    scales = life_stress_func(failure_stress[:, 0], failure_stress[:, 1], *life_params)
                else:
                    scales = life_stress_func(failure_stress, *life_params)
                scales = np.asarray(scales, dtype=float)
                if np.any(scales <= 0) or np.any(~np.isfinite(scales)):
                    return np.inf
                logpdf = dist_info['logpdf'](failures, scales, shape)
                if np.any(~np.isfinite(logpdf)):
                    return np.inf
                LL += float(np.sum(logpdf))

            if right_censored is not None and len(right_censored) > 0:
                if is_dual:
                    scales_rc = life_stress_func(rc_stress[:, 0], rc_stress[:, 1], *life_params)
                else:
                    scales_rc = life_stress_func(rc_stress, *life_params)
                scales_rc = np.asarray(scales_rc, dtype=float)
                if np.any(scales_rc <= 0) or np.any(~np.isfinite(scales_rc)):
                    return np.inf
                logsf = dist_info['logsf'](right_censored, scales_rc, shape)
                if np.any(~np.isfinite(logsf)):
                    return np.inf
                LL += float(np.sum(logsf))

    except Exception:
        return np.inf

    if np.isnan(LL) or np.isinf(LL):
        return np.inf
    return -LL


class _ALT_Fitter_Base:
    """Base class for all ALT fitters."""

    def _fit(self, base_dist_name, life_stress_func, is_dual, n_life_params,
             failures, failure_stress, right_censored, rc_stress,
             use_level_stress, x0, bounds):
        dist_info = _DIST_INFO[base_dist_name]
        has_shape = dist_info['shape_param'] is not None
        n_params = n_life_params + (1 if has_shape else 0)

        def neg_ll(params):
            return _alt_neg_log_likelihood(
                params, base_dist_name, life_stress_func, is_dual,
                failures, failure_stress, right_censored, rc_stress)

        best_result = None
        best_fun = np.inf

        for method_name in ['Nelder-Mead', 'L-BFGS-B', 'Powell']:
            try:
                # A generous but bounded iteration budget with convergence
                # tolerances; an un-converging simplex previously ran the full
                # 20000 iterations on every restart, which dominated runtime.
                if method_name == 'L-BFGS-B':
                    opts = {'maxiter': 5000}
                    result = minimize(neg_ll, x0, method=method_name, bounds=bounds, options=opts)
                else:
                    opts = {'maxiter': 5000, 'xatol': 1e-6, 'fatol': 1e-6} \
                        if method_name == 'Nelder-Mead' else {'maxiter': 5000}
                    result = minimize(neg_ll, x0, method=method_name, options=opts)
                if result.fun < best_fun and np.isfinite(result.fun):
                    best_fun = result.fun
                    best_result = result
            except Exception:
                continue

        if best_result is None or not np.isfinite(best_fun):
            for scale in [0.1, 10.0, 0.01, 100.0]:
                x0_perturbed = [v * scale if v != 0 else scale for v in x0]
                try:
                    result = minimize(neg_ll, x0_perturbed, method='Nelder-Mead',
                                      options={'maxiter': 20000})
                    if result.fun < best_fun and np.isfinite(result.fun):
                        best_fun = result.fun
                        best_result = result
                except Exception:
                    continue

        if best_result is None:
            import types
            best_result = types.SimpleNamespace(x=np.array(x0), fun=neg_ll(np.array(x0)))

        result = best_result

        self.params = result.x
        self.loglik = -result.fun
        n_total = len(failures) + (len(right_censored) if right_censored is not None else 0)
        self.AICc = AICc(self.loglik, n_params, n_total)
        self.BIC = BIC(self.loglik, n_params, n_total)

        self.life_stress_params = self.params[:n_life_params]
        self.shape = self.params[n_life_params] if has_shape else None

        # Retain the fitted life-stress relationship so life at an arbitrary
        # stress can be evaluated later (e.g. for life-stress plots).
        self.life_stress_func = life_stress_func
        self.base_dist_name = base_dist_name
        self.is_dual = is_dual

        if use_level_stress is not None:
            if is_dual:
                use_scale = life_stress_func(
                    np.array([use_level_stress[0]]),
                    np.array([use_level_stress[1]]),
                    *self.life_stress_params
                )[0]
            else:
                use_scale = life_stress_func(
                    np.array([use_level_stress]),
                    *self.life_stress_params
                )[0]
            self.distribution_at_use_stress = dist_info['make'](use_scale, self.shape)
        else:
            self.distribution_at_use_stress = None

    def life_at_stress(self, stress):
        """Median life of the fitted distribution at the given stress level(s).

        ``stress`` is a scalar for single-stress models, or a 2-tuple/sequence
        ``(s1, s2)`` for dual-stress models. The distribution scale is evaluated
        through the fitted life-stress relationship and converted to a real
        median life (handling, e.g., Lognormal's log-space ``mu``).
        """
        if self.is_dual:
            scale = self.life_stress_func(
                np.array([stress[0]], dtype=float),
                np.array([stress[1]], dtype=float),
                *self.life_stress_params,
            )[0]
        else:
            scale = self.life_stress_func(
                np.array([stress], dtype=float),
                *self.life_stress_params,
            )[0]
        return float(_DIST_INFO[self.base_dist_name]['make'](scale, self.shape).median)


def _compute_initial_guess_single(stress_model_name, mean_life, mean_stress,
                                  all_stresses, all_failures, base_dist_name='Weibull'):
    """Compute data-driven initial guesses for single-stress ALT models.

    For the Lognormal base distribution the life-stress model predicts ``mu``
    (the mean of log-life), not the life itself, so the per-stress lives are
    transformed into log-space before solving for the life-stress parameters.
    Without this the initial ``mu`` is on the order of the raw life (thousands),
    implying a median of ``exp(life)`` and leaving the optimizer to crawl back
    from an astronomically wrong point (the cause of multi-minute "hangs").
    """
    log_scale = (base_dist_name == 'Lognormal')
    all_failures = np.log(all_failures) if log_scale else all_failures
    mean_life = np.log(mean_life) if log_scale else mean_life

    unique_stresses = np.unique(all_stresses)
    if len(unique_stresses) >= 2:
        mean_lives = []
        for s in unique_stresses:
            mask = all_stresses == s
            mean_lives.append(np.mean(all_failures[mask]))
        mean_lives = np.array(mean_lives)

        s1, s2 = unique_stresses[0], unique_stresses[-1]
        l1, l2 = mean_lives[0], mean_lives[-1]
    else:
        s1, s2 = mean_stress * 0.8, mean_stress * 1.2
        l1, l2 = mean_life * 1.2, mean_life * 0.8

    l1 = max(l1, 1e-10)
    l2 = max(l2, 1e-10)

    if stress_model_name == 'Exponential':
        if s1 != s2:
            b = (np.log(l1) - np.log(l2)) / (1/s1 - 1/s2)
            a = l1 / np.exp(b / s1)
        else:
            a, b = mean_life, 1.0
        return [max(a, 1e-10), b]
    elif stress_model_name == 'Eyring':
        if s1 != s2:
            b = (np.log(l1 * s1) - np.log(l2 * s2)) / (1/s1 - 1/s2)
            a = -(np.log(l1 * s1) - b / s1)
        else:
            a, b = 0.0, 1.0
        return [a, b]
    elif stress_model_name == 'Power':
        if s1 != s2 and s1 > 0 and s2 > 0:
            n = (np.log(l1) - np.log(l2)) / (np.log(s1) - np.log(s2))
            a = l1 / (s1 ** n)
        else:
            a, n = mean_life, -1.0
        return [max(a, 1e-10), n]
    else:
        return [1.0, 1.0]


def _compute_initial_guess_dual(stress_model_name, mean_life, mean_s1, mean_s2):
    """Compute initial guesses for dual-stress ALT models."""
    if stress_model_name == 'Dual_Exponential':
        return [max(mean_life * 0.01, 1e-10), mean_s1 * 0.1, mean_s2 * 0.1]
    elif stress_model_name == 'Power_Exponential':
        return [max(mean_life * 0.01, 1e-10), -1.0, mean_s2 * 0.1]
    elif stress_model_name == 'Dual_Power':
        return [max(mean_life, 1e-10), -1.0, -1.0]
    else:
        return [1.0, 1.0, 1.0]


def _make_single_stress_alt_fitter(base_dist_name, stress_model_name, life_stress_func):
    """Factory function to create single-stress ALT fitter classes."""

    class _Fitter(_ALT_Fitter_Base):
        __doc__ = f"Fit {base_dist_name}-{stress_model_name} ALT model."

        def __init__(self, failures, failure_stress, right_censored=None,
                     right_censored_stress=None, use_level_stress=None,
                     show_probability_plot=False):
            failures = np.asarray(failures, dtype=float)
            failure_stress = np.asarray(failure_stress, dtype=float)

            if right_censored is not None:
                right_censored = np.asarray(right_censored, dtype=float)
                right_censored_stress = np.asarray(right_censored_stress, dtype=float)
            else:
                right_censored = np.array([], dtype=float)
                right_censored_stress = np.array([], dtype=float)

            dist_info = _DIST_INFO[base_dist_name]
            has_shape = dist_info['shape_param'] is not None

            mean_life = np.mean(failures)
            mean_stress = np.mean(failure_stress)
            x0 = _compute_initial_guess_single(
                stress_model_name, mean_life, mean_stress, failure_stress, failures,
                base_dist_name)
            bounds = [(None, None), (None, None)]
            if has_shape:
                x0.append(2.0)
                bounds.append((1e-10, None))

            rc = right_censored if len(right_censored) > 0 else None
            rc_s = right_censored_stress if len(right_censored_stress) > 0 else None

            self._fit(base_dist_name, life_stress_func, False, 2,
                      failures, failure_stress, rc, rc_s,
                      use_level_stress, x0, bounds)

            self.a = self.life_stress_params[0]
            self.b = self.life_stress_params[1]

        def __repr__(self):
            shape_str = f", shape={self.shape:.4f}" if self.shape is not None else ""
            return f"Fit_{base_dist_name}_{stress_model_name}(a={self.a:.4f}, b={self.b:.4f}{shape_str})"

    _Fitter.__name__ = f"Fit_{base_dist_name}_{stress_model_name}"
    _Fitter.__qualname__ = f"Fit_{base_dist_name}_{stress_model_name}"
    return _Fitter


def _make_dual_stress_alt_fitter(base_dist_name, stress_model_name, life_stress_func):
    """Factory function to create dual-stress ALT fitter classes."""

    class _Fitter(_ALT_Fitter_Base):
        __doc__ = f"Fit {base_dist_name}-{stress_model_name} ALT model (dual stress)."

        def __init__(self, failures, failure_stress_1, failure_stress_2,
                     right_censored=None, right_censored_stress_1=None,
                     right_censored_stress_2=None, use_level_stress=None,
                     show_probability_plot=False):
            failures = np.asarray(failures, dtype=float)
            failure_stress = np.column_stack([
                np.asarray(failure_stress_1, dtype=float),
                np.asarray(failure_stress_2, dtype=float),
            ])

            if right_censored is not None:
                right_censored = np.asarray(right_censored, dtype=float)
                rc_stress = np.column_stack([
                    np.asarray(right_censored_stress_1, dtype=float),
                    np.asarray(right_censored_stress_2, dtype=float),
                ])
            else:
                right_censored = np.array([], dtype=float)
                rc_stress = np.empty((0, 2), dtype=float)

            dist_info = _DIST_INFO[base_dist_name]
            has_shape = dist_info['shape_param'] is not None

            mean_life = np.mean(failures)
            mean_s1 = np.mean(failure_stress_1)
            mean_s2 = np.mean(failure_stress_2)
            x0 = _compute_initial_guess_dual(
                stress_model_name, mean_life, mean_s1, mean_s2)
            bounds = [(None, None), (None, None), (None, None)]
            if has_shape:
                x0.append(2.0)
                bounds.append((1e-10, None))

            rc = right_censored if len(right_censored) > 0 else None
            rc_s = rc_stress if len(rc_stress) > 0 else None

            self._fit(base_dist_name, life_stress_func, True, 3,
                      failures, failure_stress, rc, rc_s,
                      use_level_stress, x0, bounds)

            self.a = self.life_stress_params[0]
            self.b = self.life_stress_params[1]
            self.c = self.life_stress_params[2]

        def __repr__(self):
            shape_str = f", shape={self.shape:.4f}" if self.shape is not None else ""
            return (f"Fit_{base_dist_name}_{stress_model_name}"
                    f"(a={self.a:.4f}, b={self.b:.4f}, c={self.c:.4f}{shape_str})")

    _Fitter.__name__ = f"Fit_{base_dist_name}_{stress_model_name}"
    _Fitter.__qualname__ = f"Fit_{base_dist_name}_{stress_model_name}"
    return _Fitter


# ── Generate all 24 ALT fitter classes ──────────────────────────────────────

_SINGLE_STRESS_MODELS = {
    'Exponential': _life_exponential,
    'Eyring': _life_eyring,
    'Power': _life_power,
}

_DUAL_STRESS_MODELS = {
    'Dual_Exponential': _life_dual_exponential,
    'Power_Exponential': _life_power_exponential,
    'Dual_Power': _life_dual_power,
}

_BASE_DISTS = ['Weibull', 'Lognormal', 'Normal', 'Exponential']

Fit_Weibull_Exponential = _make_single_stress_alt_fitter('Weibull', 'Exponential', _life_exponential)
Fit_Weibull_Eyring = _make_single_stress_alt_fitter('Weibull', 'Eyring', _life_eyring)
Fit_Weibull_Power = _make_single_stress_alt_fitter('Weibull', 'Power', _life_power)
Fit_Lognormal_Exponential = _make_single_stress_alt_fitter('Lognormal', 'Exponential', _life_exponential)
Fit_Lognormal_Eyring = _make_single_stress_alt_fitter('Lognormal', 'Eyring', _life_eyring)
Fit_Lognormal_Power = _make_single_stress_alt_fitter('Lognormal', 'Power', _life_power)
Fit_Normal_Exponential = _make_single_stress_alt_fitter('Normal', 'Exponential', _life_exponential)
Fit_Normal_Eyring = _make_single_stress_alt_fitter('Normal', 'Eyring', _life_eyring)
Fit_Normal_Power = _make_single_stress_alt_fitter('Normal', 'Power', _life_power)
Fit_Exponential_Exponential = _make_single_stress_alt_fitter('Exponential', 'Exponential', _life_exponential)
Fit_Exponential_Eyring = _make_single_stress_alt_fitter('Exponential', 'Eyring', _life_eyring)
Fit_Exponential_Power = _make_single_stress_alt_fitter('Exponential', 'Power', _life_power)

Fit_Weibull_Dual_Exponential = _make_dual_stress_alt_fitter('Weibull', 'Dual_Exponential', _life_dual_exponential)
Fit_Weibull_Power_Exponential = _make_dual_stress_alt_fitter('Weibull', 'Power_Exponential', _life_power_exponential)
Fit_Weibull_Dual_Power = _make_dual_stress_alt_fitter('Weibull', 'Dual_Power', _life_dual_power)
Fit_Lognormal_Dual_Exponential = _make_dual_stress_alt_fitter('Lognormal', 'Dual_Exponential', _life_dual_exponential)
Fit_Lognormal_Power_Exponential = _make_dual_stress_alt_fitter('Lognormal', 'Power_Exponential', _life_power_exponential)
Fit_Lognormal_Dual_Power = _make_dual_stress_alt_fitter('Lognormal', 'Dual_Power', _life_dual_power)
Fit_Normal_Dual_Exponential = _make_dual_stress_alt_fitter('Normal', 'Dual_Exponential', _life_dual_exponential)
Fit_Normal_Power_Exponential = _make_dual_stress_alt_fitter('Normal', 'Power_Exponential', _life_power_exponential)
Fit_Normal_Dual_Power = _make_dual_stress_alt_fitter('Normal', 'Dual_Power', _life_dual_power)
Fit_Exponential_Dual_Exponential = _make_dual_stress_alt_fitter('Exponential', 'Dual_Exponential', _life_dual_exponential)
Fit_Exponential_Power_Exponential = _make_dual_stress_alt_fitter('Exponential', 'Power_Exponential', _life_power_exponential)
Fit_Exponential_Dual_Power = _make_dual_stress_alt_fitter('Exponential', 'Dual_Power', _life_dual_power)


# ── Mappings for Fit_Everything_ALT ─────────────────────────────────────────

_SINGLE_STRESS_FITTERS = {
    'Weibull_Exponential': Fit_Weibull_Exponential,
    'Weibull_Eyring': Fit_Weibull_Eyring,
    'Weibull_Power': Fit_Weibull_Power,
    'Lognormal_Exponential': Fit_Lognormal_Exponential,
    'Lognormal_Eyring': Fit_Lognormal_Eyring,
    'Lognormal_Power': Fit_Lognormal_Power,
    'Normal_Exponential': Fit_Normal_Exponential,
    'Normal_Eyring': Fit_Normal_Eyring,
    'Normal_Power': Fit_Normal_Power,
    'Exponential_Exponential': Fit_Exponential_Exponential,
    'Exponential_Eyring': Fit_Exponential_Eyring,
    'Exponential_Power': Fit_Exponential_Power,
}

_DUAL_STRESS_FITTERS = {
    'Weibull_Dual_Exponential': Fit_Weibull_Dual_Exponential,
    'Weibull_Power_Exponential': Fit_Weibull_Power_Exponential,
    'Weibull_Dual_Power': Fit_Weibull_Dual_Power,
    'Lognormal_Dual_Exponential': Fit_Lognormal_Dual_Exponential,
    'Lognormal_Power_Exponential': Fit_Lognormal_Power_Exponential,
    'Lognormal_Dual_Power': Fit_Lognormal_Dual_Power,
    'Normal_Dual_Exponential': Fit_Normal_Dual_Exponential,
    'Normal_Power_Exponential': Fit_Normal_Power_Exponential,
    'Normal_Dual_Power': Fit_Normal_Dual_Power,
    'Exponential_Dual_Exponential': Fit_Exponential_Dual_Exponential,
    'Exponential_Power_Exponential': Fit_Exponential_Power_Exponential,
    'Exponential_Dual_Power': Fit_Exponential_Dual_Power,
}

ALL_SINGLE_STRESS_NAMES = list(_SINGLE_STRESS_FITTERS.keys())
ALL_DUAL_STRESS_NAMES = list(_DUAL_STRESS_FITTERS.keys())
ALL_ALT_NAMES = ALL_SINGLE_STRESS_NAMES + ALL_DUAL_STRESS_NAMES


class Fit_Everything_ALT:
    """Fit all (or selected) ALT models and rank by goodness-of-fit."""

    def __init__(self, failures, failure_stress, right_censored=None,
                 right_censored_stress=None, use_level_stress=None,
                 models_to_fit=None, sort_by='AICc'):

        failures = np.asarray(failures, dtype=float)
        failure_stress = np.asarray(failure_stress, dtype=float)
        is_dual = failure_stress.ndim == 2 and failure_stress.shape[1] == 2

        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)
            right_censored_stress = np.asarray(right_censored_stress, dtype=float)

        if models_to_fit is None:
            if is_dual:
                models_to_fit = list(ALL_DUAL_STRESS_NAMES)
            else:
                models_to_fit = list(ALL_SINGLE_STRESS_NAMES)

        # Each model is fitted independently → run them concurrently. NumPy/SciPy
        # release the GIL in the native routines, so threads parallelize without
        # process-pool overhead. Warnings are suppressed once here (inherited by
        # the workers; catch_warnings() is not thread-safe to enter per-fit).
        def _fit_one(name):
            try:
                if name in _SINGLE_STRESS_FITTERS and not is_dual:
                    fitter_cls = _SINGLE_STRESS_FITTERS[name]
                    fit = fitter_cls(
                        failures=failures,
                        failure_stress=failure_stress,
                        right_censored=right_censored,
                        right_censored_stress=right_censored_stress,
                        use_level_stress=use_level_stress,
                    )
                elif name in _DUAL_STRESS_FITTERS and is_dual:
                    fitter_cls = _DUAL_STRESS_FITTERS[name]
                    fit = fitter_cls(
                        failures=failures,
                        failure_stress_1=failure_stress[:, 0],
                        failure_stress_2=failure_stress[:, 1],
                        right_censored=right_censored,
                        right_censored_stress_1=right_censored_stress[:, 0] if right_censored_stress is not None else None,
                        right_censored_stress_2=right_censored_stress[:, 1] if right_censored_stress is not None else None,
                        use_level_stress=use_level_stress,
                    )
                else:
                    return name, None, None  # not applicable to this stress type → skip
                return name, fit, {
                    'Model': name, 'AICc': fit.AICc, 'BIC': fit.BIC, 'Log-Likelihood': fit.loglik,
                }
            except Exception:
                return name, None, {
                    'Model': name, 'AICc': np.inf, 'BIC': np.inf, 'Log-Likelihood': -np.inf,
                }

        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            workers = min(len(models_to_fit), (os.cpu_count() or 4))
            with ThreadPoolExecutor(max_workers=max(workers, 1)) as ex:
                outcomes = list(ex.map(_fit_one, models_to_fit))  # preserves order

        results_list = []
        fitted = {}
        for name, fit, row in outcomes:
            if fit is not None:
                fitted[name] = fit
            if row is not None:
                results_list.append(row)

        self.results = pd.DataFrame(results_list)
        ascending = sort_by != 'loglik'
        col = 'Log-Likelihood' if sort_by == 'loglik' else sort_by
        self.results = self.results.sort_values(by=col, ascending=ascending).reset_index(drop=True)

        if len(self.results) > 0:
            best_name = self.results.iloc[0]['Model']
            self.best_model_name = best_name
            self.best_model = fitted.get(best_name, None)
        else:
            self.best_model_name = None
            self.best_model = None

        self.fitted = fitted

    def __repr__(self):
        return f"Fit_Everything_ALT(best={self.best_model_name})"
