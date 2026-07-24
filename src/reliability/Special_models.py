"""
Special life-data models built on the Weibull distribution.

These extend the standard single-distribution fitters with models that have
greater shape flexibility or that describe sub-populations:

- ``Fit_Weibull_Mixture``    : p * f1 + (1-p) * f2  (additive mixture)
- ``Fit_Weibull_CR``         : competing risks, SF = SF1 * SF2
- ``Fit_Weibull_DSZI``       : Defective Subpopulation + Zero Inflated
- ``Fit_Weibull_DS``         : DSZI with ZI = 0 (defective subpopulation only)
- ``Fit_Weibull_ZI``         : DSZI with DS = 1 (zero inflated only)
- ``Fit_Weibull_2P_grouped`` : compatibility wrapper for exact-frequency data

All fitters expose ``alpha``/``beta`` style parameters, ``loglik``, ``AICc``,
``BIC`` and a ``results`` DataFrame, mirroring the standard fitters.
"""

import numpy as np
import pandas as pd
from scipy import stats as ss
from scipy.optimize import minimize
from scipy.special import expit

from reliability.Utils import (
    AICc, BIC, numerical_hessian, select_best_optimizer_result,
)


# ── Vectorized Weibull primitives (alpha = scale, beta = shape) ───────────────

def _w_sf(t, alpha, beta):
    return np.exp(_w_logsf(t, alpha, beta))


def _w_logsf(t, alpha, beta):
    with np.errstate(over='ignore', invalid='ignore'):
        return -((t / alpha) ** beta)


def _w_cdf(t, alpha, beta):
    return -np.expm1(_w_logsf(t, alpha, beta))


def _w_logpdf(t, alpha, beta):
    # log f(t) = log(beta/alpha) + (beta-1) log(t/alpha) - (t/alpha)^beta
    z = t / alpha
    with np.errstate(divide='ignore', over='ignore', invalid='ignore'):
        return np.log(beta / alpha) + (beta - 1) * np.log(z) - z ** beta


def _w_pdf(t, alpha, beta):
    return np.exp(_w_logpdf(t, alpha, beta))


def _moment_init(times):
    """Crude method-of-moments Weibull start (alpha, beta) from positive times."""
    times = times[times > 0]
    if len(times) < 2:
        return 1.0, 1.5
    alpha = float(np.median(times)) / (np.log(2) ** (1 / 1.5))
    return max(alpha, 1e-6), 1.5


def _information_condition(neg_ll, params):
    """Condition number of the observed information, or infinity if singular."""
    H = numerical_hessian(neg_ll, np.asarray(params, dtype=float))
    if H is None or np.any(~np.isfinite(H)):
        return np.inf
    try:
        condition = float(np.linalg.cond(H))
    except np.linalg.LinAlgError:
        return np.inf
    return condition if np.isfinite(condition) else np.inf


def _component_separation(alpha1, beta1, alpha2, beta2):
    """Standardized RMS separation of two Weibull log-quantile curves."""
    probabilities = np.array([0.1, 0.5, 0.9])
    log_q = np.log(-np.log1p(-probabilities))
    q1 = np.log(alpha1) + log_q / beta1
    q2 = np.log(alpha2) + log_q / beta2
    pooled_log_sd = np.sqrt(
        0.5 * (np.pi ** 2 / (6 * beta1 ** 2)
               + np.pi ** 2 / (6 * beta2 ** 2))
    )
    return float(np.sqrt(np.mean((q1 - q2) ** 2)) / pooled_log_sd)


def _canonical_components(params, with_weight):
    params = np.asarray(params, dtype=float).copy()
    if (params[0], params[1]) > (params[2], params[3]):
        params[:2], params[2:4] = params[2:4].copy(), params[:2].copy()
        if with_weight:
            params[4] = 1.0 - params[4]
    return params


def _multistart_stability(candidates, best, with_weight):
    """Parameter spread among solutions within two log-likelihood units."""
    reference = _canonical_components(best.x, with_weight)
    transformed_reference = np.log(reference[:4])
    if with_weight:
        p = np.clip(reference[4], 1e-12, 1 - 1e-12)
        transformed_reference = np.r_[transformed_reference, np.log(p / (1 - p))]

    spreads = []
    near_count = 0
    for _, result in candidates:
        if (not bool(getattr(result, 'success', False))
                or not np.isfinite(getattr(result, 'fun', np.inf))
                or result.fun > best.fun + 2.0):
            continue
        near_count += 1
        params = _canonical_components(result.x, with_weight)
        transformed = np.log(params[:4])
        if with_weight:
            p = np.clip(params[4], 1e-12, 1 - 1e-12)
            transformed = np.r_[transformed, np.log(p / (1 - p))]
        spreads.append(float(np.max(np.abs(transformed - transformed_reference))))

    maximum_spread = max(spreads, default=0.0)
    return {
        'near_optimal_solution_count': near_count,
        'maximum_transformed_parameter_spread': maximum_spread,
        'stable': bool(maximum_spread <= 0.75),
    }


def _set_special_fit_status(fit, diagnostics, identifiable=True,
                            identifiability=None):
    fit.fit_diagnostics = diagnostics
    fit.converged = bool(diagnostics.get('converged', False))
    fit.identifiable = bool(identifiable)
    fit.identifiability_diagnostics = identifiability or {}
    fit.fit_eligible = bool(
        fit.converged and fit.identifiable and np.isfinite(fit.loglik)
    )
    fit.aicc_eligible = bool(fit.fit_eligible and np.isfinite(fit.AICc))
    reasons = []
    if not fit.converged:
        reasons.append('optimizer_not_converged')
    if not fit.identifiable:
        reasons.append('weak_component_identifiability')
    if not np.isfinite(fit.AICc):
        reasons.append('aicc_undefined_for_sample_size')
    fit.eligibility_reasons = reasons
    fit.parameter_ci_method = 'observed_fisher_wald'
    fit.uncertainty_warnings = ['asymptotic_wald_approximation']
    if not identifiable:
        fit.uncertainty_warnings.append('weak_identifiability_invalidates_wald_ci')


def _param_inference(neg_ll, params, kinds, CI):
    """Standard errors and CIs from the observed Fisher information.

    Inverts the numerical Hessian of the custom negative log-likelihood at
    the MLE. Positive parameters get log-transformed bounds (stay > 0);
    probability parameters get logit-transformed bounds (stay in (0,1)).

    Parameters
    ----------
    kinds : sequence of {'pos', 'prob'}
        Transform per parameter.

    Returns
    -------
    (se, lower, upper) : lists of float (NaN where unavailable).
    """
    params = np.asarray(params, dtype=float)
    k = len(params)
    nans = [float('nan')] * k
    cov = None
    for rel_step in (1e-4, 1e-5, 1e-6):
        H = numerical_hessian(neg_ll, params, rel_step=rel_step)
        if H is None:
            continue
        try:
            c = np.linalg.inv(H)
        except np.linalg.LinAlgError:
            continue
        if np.all(np.isfinite(c)) and np.all(np.diag(c) >= 0):
            cov = c
            break
    if cov is None:
        return nans, nans, nans

    z = ss.norm.ppf(1 - (1 - CI) / 2)
    se = np.sqrt(np.diag(cov))
    lower, upper = [], []
    for v, s, kind in zip(params, se, kinds):
        if not np.isfinite(s) or s <= 0:
            lower.append(float('nan'))
            upper.append(float('nan'))
            continue
        if kind == 'prob' and 0 < v < 1:
            g = np.log(v / (1 - v))
            gse = s / (v * (1 - v))
            lower.append(float(expit(g - z * gse)))
            upper.append(float(expit(g + z * gse)))
        elif v > 0:
            gse = s / v
            lower.append(float(v * np.exp(-z * gse)))
            upper.append(float(v * np.exp(z * gse)))
        else:
            lower.append(float(v - z * s))
            upper.append(float(v + z * s))
    return se.tolist(), lower, upper


# ── Weibull Mixture (2 components) ────────────────────────────────────────────

class Fit_Weibull_Mixture:
    """Mixture of two Weibull distributions.

    The mixture PDF is ``p * f1(t) + (1 - p) * f2(t)`` where ``f1`` and ``f2``
    are Weibull densities and ``p`` (``proportion_1``) is the weight of the
    first component (the proportions sum to 1). Mixtures are useful when the
    data contains two distinct failure populations producing a bimodal or
    heavily skewed life distribution.

    Parameters
    ----------
    failures : array-like
        Failure times (must be > 0).
    right_censored : array-like, optional
        Suspension times.
    CI : float, optional
        Confidence level (retained for API parity; not used for bounds here).
    """

    def __init__(self, failures, right_censored=None, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if np.any(failures <= 0):
            raise ValueError('Weibull mixture requires all failures > 0.')
        if len(failures) < 4:
            raise ValueError('At least 4 failures are required for a 2-component mixture.')
        rc = np.asarray(right_censored, dtype=float) if right_censored is not None else None
        self._bootstrap_failures = failures.copy()
        self._bootstrap_right_censored = (
            rc.copy() if rc is not None else np.array([], dtype=float)
        )

        def neg_ll(p):
            alpha1, beta1, alpha2, beta2, prop = p
            if min(alpha1, beta1, alpha2, beta2) <= 0 or not (0 < prop < 1):
                return np.inf
            log_prop = np.log(prop)
            log_other = np.log1p(-prop)
            logpdf = np.logaddexp(
                log_prop + _w_logpdf(failures, alpha1, beta1),
                log_other + _w_logpdf(failures, alpha2, beta2),
            )
            ll = np.sum(logpdf)
            if rc is not None and len(rc) > 0:
                logsf = np.logaddexp(
                    log_prop + _w_logsf(rc, alpha1, beta1),
                    log_other + _w_logsf(rc, alpha2, beta2),
                )
                ll += np.sum(logsf)
            return -ll if np.isfinite(ll) else np.inf

        # Multi-start MLE: mixture likelihoods are multimodal, so a single
        # deterministic start can silently settle in a poor local optimum.
        # Vary the split point and starting proportion; keep the best loglik.
        sf = np.sort(failures)
        n_f = len(sf)
        starts = []
        for frac, prop0 in ((0.5, 0.5), (0.3, 0.3), (0.7, 0.7), (0.4, 0.5), (0.6, 0.5)):
            mid = max(2, min(n_f - 2, int(round(n_f * frac))))
            a1, b1 = _moment_init(sf[:mid])
            a2, b2 = _moment_init(sf[mid:])
            starts.append([a1, b1, a2, b2, prop0])

        bounds = [(1e-6, None), (1e-6, None), (1e-6, None), (1e-6, None), (1e-4, 1 - 1e-4)]
        candidates = []
        for x0 in starts:
            res = minimize(neg_ll, x0, method='Nelder-Mead',
                           bounds=bounds,
                           options={'maxiter': 10000, 'xatol': 1e-8, 'fatol': 1e-8})
            candidates.append(('Nelder-Mead', res))
            res_b = minimize(neg_ll, res.x, method='L-BFGS-B', bounds=bounds)
            candidates.append(('L-BFGS-B', res_b))

        best, optimizer_diagnostics = select_best_optimizer_result(
            candidates, neg_ll, bounds=bounds,
        )

        self.alpha_1, self.beta_1, self.alpha_2, self.beta_2, self.proportion_1 = best.x
        # Order components lexicographically on (alpha, beta) — ordering on
        # scale alone is unstable when the components share a scale.
        if (self.alpha_1, self.beta_1) > (self.alpha_2, self.beta_2):
            self.alpha_1, self.alpha_2 = self.alpha_2, self.alpha_1
            self.beta_1, self.beta_2 = self.beta_2, self.beta_1
            self.proportion_1 = 1 - self.proportion_1
        self.proportion_2 = 1 - self.proportion_1

        self.loglik = -best.fun
        n = len(failures) + (len(rc) if rc is not None else 0)
        self.AICc = AICc(self.loglik, 5, n)
        self.BIC = BIC(self.loglik, 5, n)
        # neg_ll is symmetric under component swap, so evaluating the Hessian
        # at the reordered parameter vector is valid.
        theta = [self.alpha_1, self.beta_1, self.alpha_2, self.beta_2, self.proportion_1]
        se, lo, hi = _param_inference(neg_ll, theta,
                                      ['pos', 'pos', 'pos', 'pos', 'prob'], CI)
        self.CI = CI
        self.results = pd.DataFrame({
            'Parameter': ['Alpha 1', 'Beta 1', 'Alpha 2', 'Beta 2', 'Proportion 1'],
            'Value': [self.alpha_1, self.beta_1, self.alpha_2, self.beta_2, self.proportion_1],
            'Std_Error': se,
            'Lower_CI': lo,
            'Upper_CI': hi,
        })

        separation = _component_separation(
            self.alpha_1, self.beta_1, self.alpha_2, self.beta_2,
        )
        minimum_weight = float(min(self.proportion_1, self.proportion_2))
        minimum_effective_count = float(n * minimum_weight)
        stability = _multistart_stability(candidates, best, with_weight=True)
        information_condition = _information_condition(neg_ll, theta)
        identifiable = bool(
            minimum_weight >= 0.05
            and minimum_effective_count >= 2.0
            and separation >= 0.25
            and stability['stable']
            and information_condition < 1e12
        )
        identifiability = {
            'identifiable': identifiable,
            'minimum_component_weight': minimum_weight,
            'minimum_effective_count': minimum_effective_count,
            'standardized_component_separation': separation,
            'information_condition': (information_condition
                                      if np.isfinite(information_condition) else None),
            'multistart': stability,
            'thresholds': {
                'minimum_component_weight': 0.05,
                'minimum_effective_count': 2.0,
                'minimum_standardized_separation': 0.25,
                'maximum_information_condition': 1e12,
            },
            'recommendation': (None if identifiable else
                               'Prefer a single Weibull or collect more data '
                               'before interpreting subpopulation parameters.'),
        }
        _set_special_fit_status(
            self, optimizer_diagnostics, identifiable, identifiability,
        )

    def SF(self, t):
        t = np.asarray(t, dtype=float)
        return (self.proportion_1 * _w_sf(t, self.alpha_1, self.beta_1)
                + self.proportion_2 * _w_sf(t, self.alpha_2, self.beta_2))

    def CDF(self, t):
        return 1.0 - self.SF(t)

    def PDF(self, t):
        t = np.asarray(t, dtype=float)
        return (self.proportion_1 * _w_pdf(t, self.alpha_1, self.beta_1)
                + self.proportion_2 * _w_pdf(t, self.alpha_2, self.beta_2))

    def __repr__(self):
        return (f"Fit_Weibull_Mixture(alpha_1={self.alpha_1:.4f}, beta_1={self.beta_1:.4f}, "
                f"alpha_2={self.alpha_2:.4f}, beta_2={self.beta_2:.4f}, "
                f"proportion_1={self.proportion_1:.4f})")

    def parametric_bootstrap_interval(self, target='reliability', value=None,
                                      CI=None, n_bootstrap=200, seed=None,
                                      return_samples=False, progress_callback=None,
                                      censoring_design=None):
        from reliability.Uncertainty import special_model_bootstrap_interval
        return special_model_bootstrap_interval(
            self, target=target, value=value, CI=CI,
            n_bootstrap=n_bootstrap, seed=seed,
            return_samples=return_samples,
            progress_callback=progress_callback,
            censoring_design=censoring_design,
        )


# ── Weibull Competing Risks ───────────────────────────────────────────────────

class Fit_Weibull_CR:
    """Competing-risks model of two Weibull failure modes.

    Two failure modes "compete" to end the item's life, so the system survives
    only if both modes survive: ``SF(t) = SF1(t) * SF2(t)``. Unlike a mixture,
    the survival functions are multiplied (a series-system reliability), giving
    ``CDF = 1 - SF1*SF2`` and ``PDF = f1*SF2 + f2*SF1``.

    Parameters
    ----------
    failures : array-like
        Failure times (must be > 0).
    right_censored : array-like, optional
        Suspension times.
    CI : float, optional
        Confidence level (API parity).
    """

    def __init__(self, failures, right_censored=None, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if np.any(failures <= 0):
            raise ValueError('Weibull competing risks requires all failures > 0.')
        if len(failures) < 4:
            raise ValueError('At least 4 failures are required.')
        rc = np.asarray(right_censored, dtype=float) if right_censored is not None else None
        self._bootstrap_failures = failures.copy()
        self._bootstrap_right_censored = (
            rc.copy() if rc is not None else np.array([], dtype=float)
        )

        a0, b0 = _moment_init(failures)

        def neg_ll(p):
            alpha1, beta1, alpha2, beta2 = p
            if min(p) <= 0:
                return np.inf
            logsf1 = _w_logsf(failures, alpha1, beta1)
            logsf2 = _w_logsf(failures, alpha2, beta2)
            logpdf = np.logaddexp(
                _w_logpdf(failures, alpha1, beta1) + logsf2,
                _w_logpdf(failures, alpha2, beta2) + logsf1,
            )
            ll = np.sum(logpdf)
            if rc is not None and len(rc) > 0:
                ll += np.sum(
                    _w_logsf(rc, alpha1, beta1)
                    + _w_logsf(rc, alpha2, beta2)
                )
            return -ll if np.isfinite(ll) else np.inf

        bounds = [(1e-6, None)] * 4
        starts = [
            [a0 * 1.3, max(b0, 1.2), a0 * 0.7, max(b0, 1.2)],
            [a0 * 0.6, max(b0 * 0.8, 0.5), a0 * 2.0, max(b0 * 1.4, 0.5)],
            [a0 * 2.0, max(b0 * 1.4, 0.5), a0 * 0.6, max(b0 * 0.8, 0.5)],
        ]
        candidates = []
        for x0 in starts:
            res = minimize(
                neg_ll, x0, method='Nelder-Mead', bounds=bounds,
                options={'maxiter': 10000, 'xatol': 1e-8, 'fatol': 1e-8},
            )
            candidates.append(('Nelder-Mead', res))
            res_b = minimize(neg_ll, res.x, method='L-BFGS-B', bounds=bounds)
            candidates.append(('L-BFGS-B', res_b))
        best, optimizer_diagnostics = select_best_optimizer_result(
            candidates, neg_ll, bounds=bounds,
        )

        self.alpha_1, self.beta_1, self.alpha_2, self.beta_2 = best.x
        if self.alpha_1 > self.alpha_2:
            self.alpha_1, self.alpha_2 = self.alpha_2, self.alpha_1
            self.beta_1, self.beta_2 = self.beta_2, self.beta_1

        self.loglik = -best.fun
        n = len(failures) + (len(rc) if rc is not None else 0)
        self.AICc = AICc(self.loglik, 4, n)
        self.BIC = BIC(self.loglik, 4, n)
        theta = [self.alpha_1, self.beta_1, self.alpha_2, self.beta_2]
        se, lo, hi = _param_inference(neg_ll, theta, ['pos'] * 4, CI)
        self.CI = CI
        self.results = pd.DataFrame({
            'Parameter': ['Alpha 1', 'Beta 1', 'Alpha 2', 'Beta 2'],
            'Value': [self.alpha_1, self.beta_1, self.alpha_2, self.beta_2],
            'Std_Error': se,
            'Lower_CI': lo,
            'Upper_CI': hi,
        })

        separation = _component_separation(
            self.alpha_1, self.beta_1, self.alpha_2, self.beta_2,
        )
        stability = _multistart_stability(candidates, best, with_weight=False)
        information_condition = _information_condition(neg_ll, theta)
        identifiable = bool(
            separation >= 0.25
            and stability['stable']
            and information_condition < 1e12
        )
        identifiability = {
            'identifiable': identifiable,
            'standardized_component_separation': separation,
            'information_condition': (information_condition
                                      if np.isfinite(information_condition) else None),
            'multistart': stability,
            'thresholds': {
                'minimum_standardized_separation': 0.25,
                'maximum_information_condition': 1e12,
            },
            'recommendation': (None if identifiable else
                               'Use cause labels or a simpler model before '
                               'interpreting competing-mode parameters.'),
        }
        _set_special_fit_status(
            self, optimizer_diagnostics, identifiable, identifiability,
        )

    def SF(self, t):
        t = np.asarray(t, dtype=float)
        return _w_sf(t, self.alpha_1, self.beta_1) * _w_sf(t, self.alpha_2, self.beta_2)

    def CDF(self, t):
        return 1.0 - self.SF(t)

    def PDF(self, t):
        t = np.asarray(t, dtype=float)
        sf1, sf2 = _w_sf(t, self.alpha_1, self.beta_1), _w_sf(t, self.alpha_2, self.beta_2)
        return _w_pdf(t, self.alpha_1, self.beta_1) * sf2 + _w_pdf(t, self.alpha_2, self.beta_2) * sf1

    def __repr__(self):
        return (f"Fit_Weibull_CR(alpha_1={self.alpha_1:.4f}, beta_1={self.beta_1:.4f}, "
                f"alpha_2={self.alpha_2:.4f}, beta_2={self.beta_2:.4f})")

    def parametric_bootstrap_interval(self, target='reliability', value=None,
                                      CI=None, n_bootstrap=200, seed=None,
                                      return_samples=False, progress_callback=None,
                                      censoring_design=None):
        from reliability.Uncertainty import special_model_bootstrap_interval
        return special_model_bootstrap_interval(
            self, target=target, value=value, CI=CI,
            n_bootstrap=n_bootstrap, seed=seed,
            return_samples=return_samples,
            progress_callback=progress_callback,
            censoring_design=censoring_design,
        )


# ── Weibull DSZI (Defective Subpopulation / Zero Inflated) ────────────────────

class Fit_Weibull_DSZI:
    """Defective-Subpopulation Zero-Inflated Weibull model.

    Combines two effects:

    - **Defective Subpopulation (DS)** — only a fraction ``DS`` of the
      population will ever fail; the CDF asymptotes to ``DS < 1`` and the rest
      are effectively immortal (right-censored at the end of observation).
    - **Zero Inflated (ZI)** — a fraction ``ZI`` of the population is
      "dead on arrival" with a failure time of 0, so the CDF starts at ``ZI``.

    The CDF is ``ZI + (DS - ZI) * F_weibull(t)`` for ``t > 0`` (with a point
    mass ``ZI`` at ``t = 0``), requiring ``0 <= ZI <= DS <= 1``. Setting
    ``ZI = 0`` gives a pure DS model; setting ``DS = 1`` gives a pure ZI model.

    Parameters
    ----------
    failures : array-like
        Failure times. Times equal to 0 are treated as zero-inflated
        (dead-on-arrival) observations.
    right_censored : array-like, optional
        Suspension times.
    DS : float, optional
        Fix the defective-subpopulation fraction (else estimated).
    ZI : float, optional
        Fix the zero-inflated fraction (else estimated).
    CI : float, optional
        Confidence level (API parity).
    """

    def __init__(self, failures, right_censored=None, DS=None, ZI=None, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if np.any(failures < 0):
            raise ValueError('Failure times must be >= 0.')
        rc = np.asarray(right_censored, dtype=float) if right_censored is not None else None

        zeros = failures[failures == 0]
        pos = failures[failures > 0]
        if len(pos) < 2:
            raise ValueError('At least 2 positive failure times are required.')
        n_total = len(failures) + (len(rc) if rc is not None else 0)

        # Identifiability guard: with no suspensions (and no zeros) the
        # likelihood is monotone increasing in DS, so a free DS just pins at
        # its upper bound — a ~99% "defective subpopulation" artifact, not an
        # estimate. DS is only identified by survivors.
        if (DS is None and (rc is None or len(rc) == 0) and len(zeros) == 0):
            raise ValueError(
                'The defective-subpopulation fraction (DS) is not identifiable '
                'without right-censored (surviving) units — every unit failed, '
                'so the data cannot distinguish DS from 1. Add suspensions or '
                'fix DS explicitly.')

        fix_DS, fix_ZI = DS, ZI
        a0, b0 = _moment_init(pos)
        # Empirical fractions for initial guesses.
        zi0 = (len(zeros) / n_total) if fix_ZI is None else fix_ZI
        ds0 = fix_DS if fix_DS is not None else min(0.99, max(zi0 + 0.5,
              (len(pos) + len(zeros)) / n_total))
        x0, idx = [a0, b0], {}
        if fix_DS is None:
            idx['DS'] = len(x0); x0.append(max(min(ds0, 0.99), 0.01))
        if fix_ZI is None:
            idx['ZI'] = len(x0); x0.append(max(min(zi0, 0.5), 1e-4))

        def unpack(p):
            alpha, beta = p[0], p[1]
            DS_ = p[idx['DS']] if 'DS' in idx else fix_DS
            ZI_ = p[idx['ZI']] if 'ZI' in idx else fix_ZI
            return alpha, beta, DS_, ZI_

        def neg_ll(p):
            alpha, beta, DS_, ZI_ = unpack(p)
            if alpha <= 0 or beta <= 0:
                return np.inf
            if not (0 <= ZI_ <= DS_ <= 1):
                return np.inf
            ll = 0.0
            if len(zeros) > 0:
                if ZI_ <= 0:
                    return np.inf
                ll += len(zeros) * np.log(ZI_)
            if len(pos) > 0:
                # density of the continuous part: (DS - ZI) * f_weibull
                susceptible = DS_ - ZI_
                if susceptible <= 0:
                    return np.inf
                ll += len(pos) * np.log(susceptible)
                ll += np.sum(_w_logpdf(pos, alpha, beta))
            if rc is not None and len(rc) > 0:
                susceptible = DS_ - ZI_
                log_immortal = np.log1p(-DS_) if DS_ < 1 else -np.inf
                log_susceptible = np.log(susceptible) if susceptible > 0 else -np.inf
                logsf = np.logaddexp(
                    log_immortal,
                    log_susceptible + _w_logsf(rc, alpha, beta),
                )
                ll += np.sum(logsf)
            return -ll if np.isfinite(ll) else np.inf

        bounds = [(1e-10, None), (1e-10, None)]
        bounds.extend([(0.0, 1.0)] * (len(x0) - 2))
        res = minimize(
            neg_ll, x0, method='Nelder-Mead', bounds=bounds,
            options={'maxiter': 10000, 'xatol': 1e-9, 'fatol': 1e-9},
        )
        res_b = minimize(neg_ll, res.x, method='L-BFGS-B', bounds=bounds)
        best, optimizer_diagnostics = select_best_optimizer_result(
            [('Nelder-Mead', res), ('L-BFGS-B', res_b)],
            neg_ll, bounds=bounds,
        )
        alpha, beta, DS_, ZI_ = unpack(best.x)
        self.alpha, self.beta = alpha, beta
        self.DS = float(np.clip(DS_, 0, 1))
        self.ZI = float(np.clip(ZI_, 0, 1))

        self.loglik = -best.fun
        k = 2 + ('DS' in idx) + ('ZI' in idx)
        self.AICc = AICc(self.loglik, k, n_total)
        self.BIC = BIC(self.loglik, k, n_total)
        # Inference over the FREE parameters only; fixed DS/ZI get NaN rows.
        kinds = ['pos', 'pos'] + ['prob'] * (len(best.x) - 2)
        se_f, lo_f, hi_f = _param_inference(neg_ll, best.x, kinds, CI)
        nan = float('nan')
        se = [se_f[0], se_f[1],
              se_f[idx['DS']] if 'DS' in idx else nan,
              se_f[idx['ZI']] if 'ZI' in idx else nan]
        lo = [lo_f[0], lo_f[1],
              lo_f[idx['DS']] if 'DS' in idx else nan,
              lo_f[idx['ZI']] if 'ZI' in idx else nan]
        hi = [hi_f[0], hi_f[1],
              hi_f[idx['DS']] if 'DS' in idx else nan,
              hi_f[idx['ZI']] if 'ZI' in idx else nan]
        self.CI = CI
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta', 'DS', 'ZI'],
            'Value': [self.alpha, self.beta, self.DS, self.ZI],
            'Std_Error': se,
            'Lower_CI': lo,
            'Upper_CI': hi,
        })
        _set_special_fit_status(self, optimizer_diagnostics)

    def CDF(self, t):
        t = np.asarray(t, dtype=float)
        out = self.ZI + (self.DS - self.ZI) * _w_cdf(t, self.alpha, self.beta)
        out = np.where(t <= 0, self.ZI, out)
        return out

    def SF(self, t):
        return 1.0 - self.CDF(t)

    def __repr__(self):
        return (f"Fit_Weibull_DSZI(alpha={self.alpha:.4f}, beta={self.beta:.4f}, "
                f"DS={self.DS:.4f}, ZI={self.ZI:.4f})")


def Fit_Weibull_DS(failures, right_censored=None, CI=0.95):
    """Defective-Subpopulation Weibull (DSZI with ZI = 0)."""
    return Fit_Weibull_DSZI(failures, right_censored=right_censored, ZI=0.0, CI=CI)


def Fit_Weibull_ZI(failures, right_censored=None, CI=0.95):
    """Zero-Inflated Weibull (DSZI with DS = 1)."""
    return Fit_Weibull_DSZI(failures, right_censored=right_censored, DS=1.0, CI=CI)


# ── Grouped (repeated) 2P Weibull ─────────────────────────────────────────────

class Fit_Weibull_2P_grouped:
    """Compatibility wrapper for an exact-frequency 2P Weibull fit.

    LDA uses :func:`reliability.Grouped_life.fit_grouped_life` directly.  This
    class retains the established Python API while delegating to that same
    generalized likelihood engine, so it cannot diverge from LDA's result.

    Parameters
    ----------
    failures : array-like
        Distinct failure times.
    failure_quantities : array-like
        Count of failures at each corresponding time.
    right_censored : array-like, optional
        Distinct suspension times.
    right_censored_quantities : array-like, optional
        Count of suspensions at each corresponding time.
    CI : float, optional
        Confidence level (API parity).
    """

    def __init__(self, failures, failure_quantities, right_censored=None,
                 right_censored_quantities=None, CI=0.95):
        from reliability.Grouped_life import (
            FrequencyObservation, fit_grouped_life,
        )

        f = np.asarray(failures, dtype=float)
        fq = np.asarray(failure_quantities, dtype=float)
        if len(f) != len(fq):
            raise ValueError('failures and failure_quantities must be the same length.')
        if right_censored is not None and len(right_censored) > 0:
            rc = np.asarray(right_censored, dtype=float)
            rcq = (np.asarray(right_censored_quantities, dtype=float)
                   if right_censored_quantities is not None
                   else np.ones_like(rc))
            if len(rc) != len(rcq):
                raise ValueError('right_censored and right_censored_quantities must match.')
        else:
            rc, rcq = np.asarray([], dtype=float), np.asarray([], dtype=float)

        observations = [
            FrequencyObservation(time=float(time), state='F', count=float(count))
            for time, count in zip(f, fq)
        ]
        observations.extend(
            FrequencyObservation(time=float(time), state='S', count=float(count))
            for time, count in zip(rc, rcq)
        )
        fit = fit_grouped_life(
            'frequency_exact', observations, 'Weibull_2P', CI=CI,
        )

        self._grouped_fit = fit
        self.alpha = self.eta = fit.params['eta']
        self.beta = fit.params['beta']
        self.loglik = fit.loglik
        self.AICc = fit.AICc
        self.BIC = fit.BIC
        self.n = fit.n
        self.CI = CI
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta'],
            'Value': [self.alpha, self.beta],
            'Std_Error': [fit.params.get('eta_se', np.nan),
                          fit.params.get('beta_se', np.nan)],
            'Lower_CI': [fit.params.get('eta_lower', np.nan),
                         fit.params.get('beta_lower', np.nan)],
            'Upper_CI': [fit.params.get('eta_upper', np.nan),
                         fit.params.get('beta_upper', np.nan)],
        })
        self.fit_diagnostics = fit.fit_diagnostics
        self.converged = fit.converged
        self.identifiable = True
        self.identifiability_diagnostics = {}
        self.fit_eligible = fit.fit_eligible
        self.aicc_eligible = fit.aicc_eligible
        self.eligibility_reasons = fit.eligibility_reasons
        self.parameter_ci_method = fit.parameter_ci_method
        self.function_ci_method = fit.function_ci_method
        self.uncertainty_warnings = fit.uncertainty_warnings

    def SF(self, t):
        return self._grouped_fit.distribution._sf(np.asarray(t, dtype=float))

    def CDF(self, t):
        return self._grouped_fit.distribution._cdf(np.asarray(t, dtype=float))

    def confidence_bounds(self, xvals, func='SF'):
        return self._grouped_fit.confidence_bounds(xvals, func=func)

    def __repr__(self):
        return f"Fit_Weibull_2P_grouped(alpha={self.alpha:.4f}, beta={self.beta:.4f})"
