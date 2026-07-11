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
import math
import warnings
from concurrent.futures import ThreadPoolExecutor
from scipy.optimize import minimize
from scipy import stats as ss
from reliability.Distributions import (
    Weibull_Distribution, Exponential_Distribution,
    Normal_Distribution, Lognormal_Distribution,
)
from reliability.Utils import (
    AICc, BIC, FitConvergenceError, numerical_hessian,
    select_best_optimizer_result,
)


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
        # The life-stress relation L(S) acts on the MEDIAN life (mu = ln L(S)),
        # the standard Arrhenius-Lognormal parameterization (Meeker-Escobar).
        # Feeding L(S) into mu directly would make the model double-exponential
        # in life, so the fitted "b" would not be the Arrhenius slope.
        'make': lambda scale, shape: Lognormal_Distribution(mu=float(np.log(scale)), sigma=shape),
        'pdf': lambda x, scale, shape: Lognormal_Distribution(mu=float(np.log(scale)), sigma=shape)._pdf(x),
        'sf': lambda x, scale, shape: Lognormal_Distribution(mu=float(np.log(scale)), sigma=shape)._sf(x),
        # scipy lognorm scale parameter IS the median exp(mu) = L(S).
        'logpdf': lambda x, scale, shape: ss.lognorm.logpdf(x, s=shape, scale=scale),
        'logsf': lambda x, scale, shape: ss.lognorm.logsf(x, s=shape, scale=scale),
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


def _stress_design_diagnostics(stress_model_name, failure_stress, rc_stress,
                               use_level_stress, is_dual):
    """Rank, conditioning, extrapolation and leverage in model coordinates."""
    observed = np.asarray(failure_stress, dtype=float)
    if rc_stress is not None and len(rc_stress) > 0:
        observed = np.concatenate([observed, np.asarray(rc_stress, dtype=float)], axis=0)
    if is_dual:
        if observed.ndim != 2 or observed.shape[1] != 2:
            raise ValueError('Dual-stress data must have two stress columns.')
        if np.any(~np.isfinite(observed)) or np.any(observed <= 0):
            raise ValueError('All dual-stress values must be finite and > 0.')
        s1, s2 = observed[:, 0], observed[:, 1]
        if stress_model_name == 'Dual_Exponential':
            X = np.column_stack([np.ones(len(observed)), 1.0 / s1, 1.0 / s2])
            transform = lambda u: np.array([1.0, 1.0 / u[0], 1.0 / u[1]])
        elif stress_model_name == 'Power_Exponential':
            X = np.column_stack([np.ones(len(observed)), np.log(s1), 1.0 / s2])
            transform = lambda u: np.array([1.0, np.log(u[0]), 1.0 / u[1]])
        elif stress_model_name == 'Dual_Power':
            X = np.column_stack([np.ones(len(observed)), np.log(s1), np.log(s2)])
            transform = lambda u: np.array([1.0, np.log(u[0]), np.log(u[1])])
        else:
            raise ValueError(f"Unknown dual-stress model '{stress_model_name}'.")
        tested_range = [
            {'minimum': float(np.min(s1)), 'maximum': float(np.max(s1))},
            {'minimum': float(np.min(s2)), 'maximum': float(np.max(s2))},
        ]
        expected_rank = 3
    else:
        observed = observed.reshape(-1)
        if np.any(~np.isfinite(observed)) or np.any(observed <= 0):
            raise ValueError('All stress values must be finite and > 0.')
        if stress_model_name in ('Exponential', 'Eyring'):
            transformed = 1.0 / observed
            transform = lambda u: np.array([1.0, 1.0 / float(u)])
        elif stress_model_name == 'Power':
            transformed = np.log(observed)
            transform = lambda u: np.array([1.0, np.log(float(u))])
        else:
            raise ValueError(f"Unknown stress model '{stress_model_name}'.")
        X = np.column_stack([np.ones(len(observed)), transformed])
        tested_range = [{
            'minimum': float(np.min(observed)), 'maximum': float(np.max(observed)),
        }]
        expected_rank = 2

    # Center/scale non-intercept columns so condition number measures design
    # geometry rather than the arbitrary physical unit magnitude.
    Xs = np.array(X, dtype=float)
    centers = np.zeros(X.shape[1])
    scales = np.ones(X.shape[1])
    for j in range(1, X.shape[1]):
        centers[j] = float(np.mean(X[:, j]))
        scales[j] = float(np.std(X[:, j], ddof=0))
        if scales[j] > 0:
            Xs[:, j] = (X[:, j] - centers[j]) / scales[j]
        else:
            Xs[:, j] = 0.0
    rank = int(np.linalg.matrix_rank(Xs))
    condition = float(np.linalg.cond(Xs)) if rank == expected_rank else float('inf')
    full_rank = rank == expected_rank

    use_diag = None
    if use_level_stress is not None:
        use = (np.asarray(use_level_stress, dtype=float).reshape(-1)
               if is_dual else np.asarray([use_level_stress], dtype=float))
        if len(use) != (2 if is_dual else 1) or np.any(~np.isfinite(use)) or np.any(use <= 0):
            raise ValueError('Use-level stress must be finite and > 0 in every dimension.')
        xu = transform(use if is_dual else float(use[0]))
        xus = np.array(xu, dtype=float)
        for j in range(1, len(xus)):
            xus[j] = ((xus[j] - centers[j]) / scales[j]
                      if scales[j] > 0 else 0.0)
        leverage = float(xus @ np.linalg.pinv(Xs.T @ Xs) @ xus)
        average_leverage = expected_rank / len(Xs)
        positions = []
        distances = []
        for value, bounds in zip(use, tested_range):
            lo, hi = bounds['minimum'], bounds['maximum']
            span = hi - lo
            if value < lo:
                positions.append('below_tested_range')
                distances.append(float((lo - value) / span) if span > 0 else float('inf'))
            elif value > hi:
                positions.append('above_tested_range')
                distances.append(float((value - hi) / span) if span > 0 else float('inf'))
            else:
                positions.append('within_tested_range')
                distances.append(0.0)
        use_diag = {
            'position': (positions[0] if not is_dual else positions),
            'is_extrapolation': any(p != 'within_tested_range' for p in positions),
            'normalized_distance_outside_range': (distances[0] if not is_dual else distances),
            'leverage': leverage,
            'average_training_leverage': average_leverage,
            'leverage_ratio': leverage / average_leverage if average_leverage > 0 else None,
        }

    return {
        'stress_model': stress_model_name,
        'n_observations': int(len(X)),
        'n_unique_stress_combinations': int(len(np.unique(observed, axis=0))),
        'rank': rank,
        'required_rank': expected_rank,
        'full_rank': full_rank,
        'scaled_condition_number': condition,
        'ill_conditioned': (not full_rank) or condition > 1e8,
        'tested_range': tested_range,
        'use_level': use_diag,
    }


def _common_shape_diagnostic(base_dist_name, failures, failure_stress,
                             right_censored=None, rc_stress=None):
    """Likelihood-ratio diagnostic for a common shape/dispersion by stress.

    Group locations/scales are free under both hypotheses, so the comparison
    isolates the common-shape assumption from the chosen life-stress curve.
    The chi-square calibration is asymptotic and is labeled accordingly.
    """
    if base_dist_name == 'Exponential':
        return {
            'status': 'not_applicable', 'reason': 'exponential_has_fixed_shape',
            'reject_common_shape': False,
        }
    failures = np.asarray(failures, dtype=float)
    fs = np.asarray(failure_stress, dtype=float)
    rc = np.asarray(right_censored if right_censored is not None else [], dtype=float)
    rcs = np.asarray(rc_stress if rc_stress is not None else [], dtype=float)
    all_stress = np.concatenate([fs, rcs], axis=0) if len(rcs) else fs.copy()
    unique, inverse = np.unique(all_stress, axis=0, return_inverse=True)
    k = len(unique)
    failure_group = inverse[:len(failures)]
    rc_group = inverse[len(failures):]
    failures_per_group = np.bincount(failure_group, minlength=k)
    if k < 2 or np.any(failures_per_group < 2):
        return {
            'status': 'insufficient_data',
            'reason': 'need_at_least_two_failures_in_each_of_two_stress_groups',
            'groups': int(k),
            'failures_per_group': failures_per_group.tolist(),
            'reject_common_shape': False,
        }

    group_centers = []
    for g in range(k):
        values = failures[failure_group == g]
        group_centers.append(max(float(np.median(values)), 1e-12))

    if base_dist_name == 'Normal':
        initial_locations = np.asarray(group_centers)
        pooled_sigma = max(float(np.std(failures, ddof=1)), np.mean(failures) * .05, 1e-6)
        null_x0 = np.r_[initial_locations, math.log(pooled_sigma)]
        alt_x0 = np.r_[initial_locations, np.full(k, math.log(pooled_sigma))]
    else:
        initial_scales = np.log(np.asarray(group_centers))
        if base_dist_name == 'Weibull':
            initial_shape = math.log(2.0)
        else:
            log_sd = float(np.std(np.log(failures), ddof=1))
            initial_shape = math.log(max(log_sd, 0.2))
        null_x0 = np.r_[initial_scales, initial_shape]
        alt_x0 = np.r_[initial_scales, np.full(k, initial_shape)]

    info = _DIST_INFO[base_dist_name]

    def objective(theta, separate):
        if base_dist_name == 'Normal':
            group_scale = np.asarray(theta[:k])
        else:
            group_scale = np.exp(np.asarray(theta[:k]))
        shape_theta = np.asarray(theta[k:])
        group_shape = np.exp(shape_theta if separate else np.repeat(shape_theta[0], k))
        total = 0.0
        for g in range(k):
            f = failures[failure_group == g]
            shape = group_shape[g]
            lp = info['logpdf'](f, group_scale[g], shape)
            if np.any(~np.isfinite(lp)):
                return np.inf
            total -= float(np.sum(lp))
            if len(rc):
                cens = rc[rc_group == g]
                if len(cens):
                    ls = info['logsf'](cens, group_scale[g], shape)
                    if np.any(~np.isfinite(ls)):
                        return np.inf
                    total -= float(np.sum(ls))
        return total

    null = minimize(lambda x: objective(x, False), null_x0, method='L-BFGS-B')
    alt = minimize(lambda x: objective(x, True), alt_x0, method='L-BFGS-B')
    if not (null.success and alt.success and np.isfinite(null.fun) and np.isfinite(alt.fun)):
        return {
            'status': 'inconclusive', 'reason': 'shape_likelihood_optimization_failed',
            'reject_common_shape': False,
        }
    statistic = max(0.0, 2.0 * (float(null.fun) - float(alt.fun)))
    df = k - 1
    p_value = float(ss.chi2.sf(statistic, df))
    return {
        'status': 'ok',
        'null_hypothesis': 'common_shape_or_dispersion_across_stress_groups',
        'statistic': statistic,
        'degrees_of_freedom': df,
        'p_value': p_value,
        'reject_common_shape': p_value < 0.05,
        'calibration': 'asymptotic_likelihood_ratio',
        'groups': int(k),
        'failures_per_group': failures_per_group.tolist(),
        'interpretation': (
            'Rejection is evidence against a common shape/dispersion and may signal '
            'a mechanism or variability change; non-rejection does not prove a common mechanism.'
        ),
    }


class _ALT_Fitter_Base:
    """Base class for all ALT fitters."""

    def _fit(self, base_dist_name, stress_model_name, life_stress_func, is_dual, n_life_params,
             failures, failure_stress, right_censored, rc_stress,
             use_level_stress, x0, bounds):
        dist_info = _DIST_INFO[base_dist_name]
        has_shape = dist_info['shape_param'] is not None
        n_params = n_life_params + (1 if has_shape else 0)

        self.stress_design_diagnostics = _stress_design_diagnostics(
            stress_model_name, failure_stress, rc_stress,
            use_level_stress, is_dual)
        if not self.stress_design_diagnostics['full_rank']:
            raise ValueError(
                f"Stress design rank {self.stress_design_diagnostics['rank']} is below "
                f"the {self.stress_design_diagnostics['required_rank']} parameters required "
                f"by {stress_model_name}."
            )
        if self.stress_design_diagnostics['ill_conditioned']:
            raise ValueError(
                f"Stress design is ill-conditioned (scaled condition number "
                f"{self.stress_design_diagnostics['scaled_condition_number']:.3g})."
            )

        def neg_ll(params):
            return _alt_neg_log_likelihood(
                params, base_dist_name, life_stress_func, is_dual,
                failures, failure_stress, right_censored, rc_stress)

        # Optimize in a dimensionless parameter space. ALT coefficients often
        # differ by six or more orders of magnitude (for example a≈0.002 and
        # b≈4,500), which otherwise makes both termination and gradients
        # misleading.
        parameter_scale = np.asarray([
            max(abs(v), 1e-3) if v != 0 else 1.0 for v in x0
        ], dtype=float)
        u0 = np.asarray(x0, dtype=float) / parameter_scale
        u_bounds = [
            ((lo / s) if lo is not None else None,
             (hi / s) if hi is not None else None)
            for (lo, hi), s in zip(bounds, parameter_scale)
        ]

        def scaled_neg_ll(u):
            return neg_ll(np.asarray(u, dtype=float) * parameter_scale)

        candidates = []

        for method_name in ['Nelder-Mead', 'L-BFGS-B', 'Powell']:
            try:
                # A generous but bounded iteration budget with convergence
                # tolerances; an un-converging simplex previously ran the full
                # 20000 iterations on every restart, which dominated runtime.
                if method_name == 'L-BFGS-B':
                    opts = {'maxiter': 5000}
                    result = minimize(scaled_neg_ll, u0, method=method_name,
                                      bounds=u_bounds, options=opts)
                else:
                    opts = {'maxiter': 5000, 'xatol': 1e-6, 'fatol': 1e-6} \
                        if method_name == 'Nelder-Mead' else {'maxiter': 5000}
                    result = minimize(
                        scaled_neg_ll, u0, method=method_name,
                        bounds=u_bounds, options=opts,
                    )
                candidates.append((method_name, result))
            except Exception:
                continue

        try:
            result, diagnostics = select_best_optimizer_result(
                candidates, scaled_neg_ll, bounds=u_bounds,
                parameter_scale=parameter_scale,
            )
        except FitConvergenceError:
            for restart_factor in [0.1, 10.0, 0.01, 100.0]:
                x0_perturbed = np.asarray(
                    [v * restart_factor if v != 0 else restart_factor for v in x0],
                    dtype=float,
                ) / parameter_scale
                try:
                    result = minimize(scaled_neg_ll, x0_perturbed,
                                      method='Nelder-Mead', bounds=u_bounds,
                                      options={'maxiter': 10000})
                    candidates.append(
                        (f'Nelder-Mead restart {restart_factor:g}', result)
                    )
                except Exception:
                    continue
            result, diagnostics = select_best_optimizer_result(
                candidates, scaled_neg_ll, bounds=u_bounds,
                parameter_scale=parameter_scale,
            )

        self.params = np.asarray(result.x, dtype=float) * parameter_scale
        self.loglik = -result.fun
        n_total = len(failures) + (len(right_censored) if right_censored is not None else 0)
        self.AICc = AICc(self.loglik, n_params, n_total)
        self.BIC = BIC(self.loglik, n_params, n_total)
        self.fit_diagnostics = diagnostics
        self.converged = bool(diagnostics['converged'])
        self.fit_eligible = bool(
            self.converged and np.isfinite(self.loglik)
            and self.stress_design_diagnostics['full_rank']
            and not self.stress_design_diagnostics['ill_conditioned'])
        self.eligibility_reasons = []
        if not self.converged:
            self.eligibility_reasons.append('optimizer_not_converged')
        if not np.isfinite(self.AICc):
            self.eligibility_reasons.append('aicc_undefined_for_sample_size')

        self.life_stress_params = self.params[:n_life_params]
        self.shape = self.params[n_life_params] if has_shape else None

        # Retain the fitted life-stress relationship so life at an arbitrary
        # stress can be evaluated later (e.g. for life-stress plots).
        self.life_stress_func = life_stress_func
        self.base_dist_name = base_dist_name
        self.stress_model_name = stress_model_name
        self.is_dual = is_dual
        self.use_level_stress = use_level_stress
        self._failures = np.asarray(failures, dtype=float)
        self._failure_stress = np.asarray(failure_stress, dtype=float)
        self._right_censored = (None if right_censored is None
                                else np.asarray(right_censored, dtype=float))
        self._rc_stress = (None if rc_stress is None
                           else np.asarray(rc_stress, dtype=float))
        self.common_shape_diagnostic = None

        # Bounds encode the damaging-stress direction. Verify explicitly so a
        # future optimizer/bounds change cannot silently reverse acceleration.
        if is_dual:
            if stress_model_name == 'Dual_Exponential':
                physical = self.life_stress_params[1] > 0 and self.life_stress_params[2] > 0
                expected = 'b > 0 and c > 0'
            elif stress_model_name == 'Power_Exponential':
                physical = self.life_stress_params[1] < 0 and self.life_stress_params[2] > 0
                expected = 'power exponent < 0 and exponential coefficient > 0'
            else:
                physical = self.life_stress_params[1] < 0 and self.life_stress_params[2] < 0
                expected = 'both power exponents < 0'
        else:
            if stress_model_name in ('Exponential', 'Eyring'):
                physical = self.life_stress_params[1] > 0
                expected = 'b > 0'
            else:
                physical = self.life_stress_params[1] < 0
                expected = 'power exponent < 0'
        self.physical_constraint_diagnostic = {
            'passed': bool(physical), 'expected': expected,
            'assumption': 'larger stress is more damaging and decreases life',
        }
        if not physical:
            self.fit_eligible = False
            self.eligibility_reasons.append('physical_stress_direction_violated')
        self.aicc_eligible = bool(self.fit_eligible and np.isfinite(self.AICc))

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

        # --- Use-level life CI (delta method on log median life) ---
        # One Hessian evaluation of the fitted nll gives the parameter
        # covariance; the gradient of ln(median at use stress) then maps it
        # to a CI that stays positive.
        self.covariance = None
        self.use_level_life = None
        self.use_level_life_lower = None
        self.use_level_life_upper = None
        self.use_level_life_se = None
        self.use_level_CI = 0.95
        if self.distribution_at_use_stress is not None:
            median = float(self.distribution_at_use_stress.median)
            self.use_level_life = median
            for rel_step in (1e-4, 1e-5, 1e-6):
                H = numerical_hessian(neg_ll, self.params, rel_step=rel_step)
                if H is None:
                    continue
                try:
                    cov = np.linalg.inv(H)
                except np.linalg.LinAlgError:
                    continue
                if np.all(np.isfinite(cov)) and np.all(np.diag(cov) >= 0):
                    self.covariance = cov
                    break

            if self.covariance is not None and median > 0:
                def _log_median_at(theta):
                    lp = theta[:n_life_params]
                    sh = theta[n_life_params] if has_shape else None
                    if is_dual:
                        sc = life_stress_func(np.array([use_level_stress[0]]),
                                              np.array([use_level_stress[1]]), *lp)[0]
                    else:
                        sc = life_stress_func(np.array([use_level_stress]), *lp)[0]
                    if not np.isfinite(sc) or sc <= 0:
                        return np.nan
                    m = dist_info['make'](sc, sh).median
                    return np.log(m) if m > 0 else np.nan

                grad = np.zeros(len(self.params))
                ok = True
                for i in range(len(self.params)):
                    h = max(abs(self.params[i]), 1.0) * 1e-5
                    tp = np.array(self.params, dtype=float)
                    tm = tp.copy()
                    tp[i] += h
                    tm[i] -= h
                    fp, fm = _log_median_at(tp), _log_median_at(tm)
                    if not (np.isfinite(fp) and np.isfinite(fm)):
                        ok = False
                        break
                    grad[i] = (fp - fm) / (2.0 * h)
                if ok:
                    var_ln = float(grad @ self.covariance @ grad)
                    if np.isfinite(var_ln) and var_ln >= 0:
                        se_ln = np.sqrt(var_ln)
                        z = ss.norm.ppf(1 - (1 - self.use_level_CI) / 2)
                        self.use_level_life_lower = median * float(np.exp(-z * se_ln))
                        self.use_level_life_upper = median * float(np.exp(z * se_ln))
                        self.use_level_life_se = median * se_ln

    def apply_common_shape_diagnostic(self, diagnostic):
        self.common_shape_diagnostic = diagnostic
        if diagnostic and diagnostic.get('status') == 'ok' \
                and diagnostic.get('reject_common_shape'):
            self.fit_eligible = False
            if 'common_shape_rejected' not in self.eligibility_reasons:
                self.eligibility_reasons.append('common_shape_rejected')
        self.aicc_eligible = bool(self.fit_eligible and np.isfinite(self.AICc))

    def _sample_lives_at_stress(self, stress, rng):
        if self.is_dual:
            scales = self.life_stress_func(
                stress[:, 0], stress[:, 1], *self.life_stress_params)
        else:
            scales = self.life_stress_func(stress, *self.life_stress_params)
        scales = np.asarray(scales, dtype=float)
        if np.any(~np.isfinite(scales)) or np.any(scales <= 0):
            raise ValueError('Non-finite fitted life scale during bootstrap.')
        size = len(scales)
        if self.base_dist_name == 'Weibull':
            values = ss.weibull_min.rvs(c=self.shape, scale=scales,
                                        size=size, random_state=rng)
        elif self.base_dist_name == 'Lognormal':
            values = ss.lognorm.rvs(s=self.shape, scale=scales,
                                    size=size, random_state=rng)
        elif self.base_dist_name == 'Normal':
            values = ss.norm.rvs(loc=scales, scale=self.shape,
                                 size=size, random_state=rng)
            # Lifetime is positive. Resample negative Normal draws from the
            # fitted (untruncated) model, then reject a replicate if needed.
            for _ in range(20):
                bad = values <= 0
                if not np.any(bad):
                    break
                values[bad] = ss.norm.rvs(
                    loc=scales[bad], scale=self.shape,
                    size=int(np.sum(bad)), random_state=rng)
            if np.any(values <= 0):
                raise ValueError('Normal bootstrap generated non-positive lives.')
        else:
            values = ss.expon.rvs(scale=scales, size=size, random_state=rng)
        return np.asarray(values, dtype=float)

    def parametric_bootstrap_use_life(self, n_bootstrap=200, CI=0.95, seed=None):
        """Refit parametric replicates and return a percentile interval at use.

        Complete-failure rows remain complete. Right-censored rows retain their
        original censoring time and may fail before it in a simulated replicate.
        This is conditional on the selected model and fixed stress/censor design.
        """
        n_bootstrap = int(n_bootstrap)
        if self.use_level_stress is None:
            raise ValueError('A use-level stress is required for bootstrap uncertainty.')
        if n_bootstrap < 20:
            raise ValueError('n_bootstrap must be at least 20.')
        if not 0 < CI < 1:
            raise ValueError('CI must be between 0 and 1.')
        rng = np.random.default_rng(seed)
        estimates = []
        for _ in range(n_bootstrap):
            try:
                generated_failures = self._sample_lives_at_stress(
                    self._failure_stress, rng).tolist()
                generated_stress = self._failure_stress.tolist()
                generated_rc = []
                generated_rc_stress = []
                if self._right_censored is not None and len(self._right_censored):
                    latent = self._sample_lives_at_stress(self._rc_stress, rng)
                    for life, censor, stress in zip(
                            latent, self._right_censored, self._rc_stress):
                        if life <= censor:
                            generated_failures.append(float(life))
                            generated_stress.append(stress.tolist() if self.is_dual else float(stress))
                        else:
                            generated_rc.append(float(censor))
                            generated_rc_stress.append(stress.tolist() if self.is_dual else float(stress))
                cls = type(self)
                if self.is_dual:
                    fs = np.asarray(generated_stress, dtype=float)
                    rcs = np.asarray(generated_rc_stress, dtype=float) if generated_rc else None
                    refit = cls(
                        failures=generated_failures,
                        failure_stress_1=fs[:, 0], failure_stress_2=fs[:, 1],
                        right_censored=generated_rc or None,
                        right_censored_stress_1=(rcs[:, 0] if rcs is not None else None),
                        right_censored_stress_2=(rcs[:, 1] if rcs is not None else None),
                        use_level_stress=self.use_level_stress,
                    )
                else:
                    refit = cls(
                        failures=generated_failures,
                        failure_stress=generated_stress,
                        right_censored=generated_rc or None,
                        right_censored_stress=generated_rc_stress or None,
                        use_level_stress=self.use_level_stress,
                    )
                estimate = refit.use_level_life
                if refit.fit_eligible and estimate is not None and np.isfinite(estimate) and estimate > 0:
                    estimates.append(float(estimate))
            except Exception:
                continue
        minimum_success = max(20, n_bootstrap // 2)
        if len(estimates) < minimum_success:
            return {
                'method': 'parametric_bootstrap_refit', 'status': 'insufficient_refits',
                'requested': n_bootstrap, 'successful': len(estimates),
                'failed': n_bootstrap - len(estimates), 'CI': CI,
                'lower': None, 'upper': None, 'median': None,
            }
        tail = (1.0 - CI) / 2.0
        arr = np.asarray(estimates)
        return {
            'method': 'parametric_bootstrap_refit', 'status': 'ok',
            'requested': n_bootstrap, 'successful': len(estimates),
            'failed': n_bootstrap - len(estimates), 'CI': CI,
            'lower': float(np.quantile(arr, tail)),
            'upper': float(np.quantile(arr, 1.0 - tail)),
            'median': float(np.median(arr)),
            'conditional_on': 'selected_model_and_fixed_stress_censor_design',
        }

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

    For every base distribution — including Lognormal, whose life-stress
    relation now acts on the median life — the model predicts a real
    (positive) life, so the raw per-stress mean lives seed the parameters.
    """
    all_failures = np.asarray(all_failures, dtype=float)

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
            if stress_model_name in ('Exponential', 'Power'):
                bounds[0] = (1e-10, None)
            if stress_model_name in ('Exponential', 'Eyring'):
                x0[1] = max(abs(x0[1]), 1e-8)
                bounds[1] = (1e-12, None)
            else:  # inverse-power life must decrease as damaging stress rises
                x0[1] = min(-abs(x0[1]), -1e-8)
                bounds[1] = (None, -1e-12)
            if has_shape:
                x0.append(2.0)
                bounds.append((1e-10, None))

            rc = right_censored if len(right_censored) > 0 else None
            rc_s = right_censored_stress if len(right_censored_stress) > 0 else None

            self._fit(base_dist_name, stress_model_name, life_stress_func, False, 2,
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
            bounds = [(1e-10, None), (None, None), (None, None)]
            if stress_model_name == 'Dual_Exponential':
                x0[1], x0[2] = max(abs(x0[1]), 1e-8), max(abs(x0[2]), 1e-8)
                bounds[1], bounds[2] = (1e-12, None), (1e-12, None)
            elif stress_model_name == 'Power_Exponential':
                x0[1], x0[2] = min(-abs(x0[1]), -1e-8), max(abs(x0[2]), 1e-8)
                bounds[1], bounds[2] = (None, -1e-12), (1e-12, None)
            else:
                x0[1], x0[2] = min(-abs(x0[1]), -1e-8), min(-abs(x0[2]), -1e-8)
                bounds[1], bounds[2] = (None, -1e-12), (None, -1e-12)
            if has_shape:
                x0.append(2.0)
                bounds.append((1e-10, None))

            rc = right_censored if len(right_censored) > 0 else None
            rc_s = rc_stress if len(rc_stress) > 0 else None

            self._fit(base_dist_name, stress_model_name, life_stress_func, True, 3,
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

        common_shape_by_base = {}
        for base_name in sorted({name.split('_', 1)[0] for name in models_to_fit}):
            try:
                common_shape_by_base[base_name] = _common_shape_diagnostic(
                    base_name, failures, failure_stress,
                    right_censored=right_censored,
                    rc_stress=right_censored_stress,
                )
            except Exception as exc:
                common_shape_by_base[base_name] = {
                    'status': 'inconclusive', 'reason': str(exc),
                    'reject_common_shape': False,
                }

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
                base_dist_name = name.split('_', 1)[0]
                fit.apply_common_shape_diagnostic(
                    common_shape_by_base.get(base_dist_name))
                design = fit.stress_design_diagnostics
                use_diag = design.get('use_level') or {}
                common_shape = fit.common_shape_diagnostic or {}
                return name, fit, {
                    'Model': name, 'AICc': fit.AICc, 'BIC': fit.BIC, 'Log-Likelihood': fit.loglik,
                    'Converged': fit.converged,
                    'Fit Eligible': fit.fit_eligible,
                    'AICc Eligible': fit.aicc_eligible,
                    'Eligibility Reasons': list(fit.eligibility_reasons),
                    'Diagnostics': fit.fit_diagnostics,
                    'Design Rank': design['rank'],
                    'Required Rank': design['required_rank'],
                    'Design Condition': design['scaled_condition_number'],
                    'Design Identifiable': design['full_rank'] and not design['ill_conditioned'],
                    'Physical Direction': fit.physical_constraint_diagnostic['passed'],
                    'Use Stress Position': use_diag.get('position'),
                    'Use Extrapolation': use_diag.get('is_extrapolation'),
                    'Extrapolation Distance': use_diag.get('normalized_distance_outside_range'),
                    'Use Leverage Ratio': use_diag.get('leverage_ratio'),
                    'Common Shape Status': common_shape.get('status'),
                    'Common Shape p-value': common_shape.get('p_value'),
                    'Common Shape Rejected': common_shape.get('reject_common_shape'),
                }
            except Exception as exc:
                return name, None, {
                    'Model': name, 'AICc': np.inf, 'BIC': np.inf, 'Log-Likelihood': -np.inf,
                    'Converged': False, 'Fit Eligible': False,
                    'AICc Eligible': False,
                    'Eligibility Reasons': ['fit_failed'],
                    'Diagnostics': (exc.diagnostics
                                    if isinstance(exc, FitConvergenceError) else None),
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
        if self.results.empty:
            self.best_model_name = None
            self.best_model = None
            self.fitted = fitted
            return
        ascending = sort_by != 'loglik'
        col = 'Log-Likelihood' if sort_by == 'loglik' else sort_by
        metric_eligible = (self.results['AICc Eligible'].astype(bool)
                           if col == 'AICc'
                           else self.results['Fit Eligible'].astype(bool))
        sort_key = pd.to_numeric(self.results[col], errors='coerce')
        ineligible_value = np.inf if ascending else -np.inf
        sort_key = sort_key.where(metric_eligible, ineligible_value)
        self.results = (self.results.assign(_sort_key=sort_key,
                                            _eligible=metric_eligible)
                        .sort_values(by='_sort_key', ascending=ascending)
                        .drop(columns='_sort_key').reset_index(drop=True))

        if len(self.results) > 0:
            eligible_rows = self.results[self.results['_eligible']]
            best_name = (eligible_rows.iloc[0]['Model']
                         if len(eligible_rows) > 0 else None)
            self.best_model_name = best_name
            self.best_model = fitted.get(best_name, None)
        else:
            self.best_model_name = None
            self.best_model = None

        self.results = self.results.drop(columns='_eligible')
        self.fitted = fitted

    def __repr__(self):
        return f"Fit_Everything_ALT(best={self.best_model_name})"
