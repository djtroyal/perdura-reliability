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
from scipy.optimize import minimize, brentq
from scipy.special import expit, logit, xlogy, logsumexp

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
    """Condition in dimensionless local log coordinates, not physical units.

    Every supplied parameter is positive (including free mixture weights).
    Evaluating at ``params * exp(delta)`` with delta=0 makes a scale change
    such as hours -> seconds an additive likelihood constant.  Taking the
    condition of a raw dimensional Hessian incorrectly penalizes that change.
    The final simplex weight remains enforced by the caller's likelihood.
    """
    params = np.asarray(params, dtype=float)
    if np.any(~np.isfinite(params)) or np.any(params <= 0):
        return np.inf
    H = numerical_hessian(lambda delta: neg_ll(params * np.exp(delta)),
                          np.zeros(len(params)))
    if H is None or np.any(~np.isfinite(H)):
        return np.inf
    try:
        eigenvalues = np.linalg.eigvalsh((H + H.T) * 0.5)
        if eigenvalues[0] <= 0:
            return np.inf
        condition = float(eigenvalues[-1] / eigenvalues[0])
    except np.linalg.LinAlgError:
        return np.inf
    return condition if np.isfinite(condition) else np.inf


class Weibull_Partial_CR:
    """A susceptible Weibull risk plus an independent common Weibull risk.

    R(t) = exp(-A2(t)) * (1-u + u*exp(-A1(t))).  The susceptible
    fraction u is a population fraction, not an additive-mixture weight for
    two mutually exclusive lifetimes.  At u=0 only the common risk remains;
    at u=1 the model is an ordinary two-risk series system.
    """

    def __init__(self, alpha_1, beta_1, alpha_2, beta_2,
                 susceptible_fraction, *, alpha_3=None, beta_3=None):
        pairs = [(alpha_1, beta_1), (alpha_2, beta_2)]
        if alpha_3 is not None or beta_3 is not None:
            if alpha_3 is None or beta_3 is None:
                raise ValueError('Both parameters of the third risk are required.')
            pairs.append((alpha_3, beta_3))
        if any(not np.isfinite(v) or v <= 0 for pair in pairs for v in pair):
            raise ValueError('Weibull scales and shapes must be finite and positive.')
        if not np.isfinite(susceptible_fraction) or not 0 <= susceptible_fraction <= 1:
            raise ValueError('susceptible_fraction must be in [0, 1].')
        self.risks = tuple((float(a), float(b)) for a, b in pairs)
        self.susceptible_fraction = float(susceptible_fraction)
        for i, (alpha, beta) in enumerate(self.risks, 1):
            setattr(self, f'alpha_{i}', alpha)
            setattr(self, f'beta_{i}', beta)

    def _parts(self, t):
        t = np.asarray(t, dtype=float)
        hazards, cumulative = [], []
        for alpha, beta in self.risks:
            with np.errstate(over='ignore', invalid='ignore', divide='ignore'):
                z = np.maximum(t, 0) / alpha
                cumulative.append(z ** beta)
                hazards.append(np.log(beta) - np.log(alpha) + xlogy(beta - 1, z))
        u = self.susceptible_fraction
        if u == 0:
            batch = np.zeros_like(t)
            susceptible_hazard = np.full_like(t, -np.inf)
        elif u == 1:
            batch = -cumulative[0]
            susceptible_hazard = hazards[0]
        else:
            # log(1-u*(1-exp(-A))) retains both the exact origin and tiny
            # early-life failure probabilities without subtracting two ones.
            batch = np.log1p(u * np.expm1(-cumulative[0]))
            with np.errstate(invalid='ignore'):
                susceptible_hazard = (np.log(u) - cumulative[0] - batch
                                      + hazards[0])
            # A vanished susceptible tail contributes no survivor hazard.
            susceptible_hazard = np.where(np.isposinf(cumulative[0]),
                                          -np.inf, susceptible_hazard)
        log_r = batch - np.sum(cumulative[1:], axis=0)
        log_h = logsumexp(np.stack([susceptible_hazard, *hazards[1:]]), axis=0)
        return t, log_r, log_h

    def logSF(self, t):
        t, log_r, _ = self._parts(t)
        return np.where(t < 0, 0.0, log_r)

    def SF(self, t):
        return np.exp(self.logSF(t))

    def CDF(self, t):
        return -np.expm1(self.logSF(t))

    def logPDF(self, t):
        t, log_r, log_h = self._parts(t)
        with np.errstate(invalid='ignore'):
            value = log_r + log_h
        return np.where((t < 0) | np.isneginf(log_r), -np.inf, value)

    def PDF(self, t):
        return np.exp(self.logPDF(t))

    def HF(self, t):
        t, _, log_h = self._parts(t)
        with np.errstate(over='ignore'):
            return np.where(t < 0, 0.0, np.exp(log_h))

    _sf = SF
    _cdf = CDF
    _pdf = PDF
    _logsf = logSF
    _logpdf = logPDF
    _hf = HF

    def quantile(self, q):
        values = np.asarray(q, dtype=float)
        if np.any(~np.isfinite(values)) or np.any((values < 0) | (values > 1)):
            raise ValueError('Quantiles require probabilities in [0, 1].')
        # Solve for dimensionless time to retain relative accuracy in any unit.
        scale = min(a for a, _ in self.risks[1:])
        def solve(p):
            if p == 0:
                return 0.0
            if p == 1:
                return np.inf
            target = np.log1p(-p)
            upper = 1.0
            for _ in range(1024):
                if float(self.logSF(upper * scale)) <= target:
                    break
                upper *= 2.0
            else:
                raise ValueError('Could not bracket the composite-model quantile.')
            return scale * brentq(lambda z: float(self.logSF(z * scale)) - target,
                                  0.0, upper, xtol=np.nextafter(0.0, 1.0),
                                  rtol=8 * np.finfo(float).eps)
        result = np.array([solve(float(p)) for p in values.ravel()]).reshape(values.shape)
        return float(result) if result.ndim == 0 else result

    def random_samples(self, n, seed=None):
        rng = np.random.default_rng(seed)
        common = np.minimum.reduce([
            a * rng.weibull(b, size=n) for a, b in self.risks[1:]])
        susceptible = rng.random(n) < self.susceptible_fraction
        a, b = self.risks[0]
        optional = np.where(susceptible, a * rng.weibull(b, size=n), np.inf)
        return np.minimum(common, optional)


class Weibull_Bathtub(Weibull_Partial_CR):
    """Three-risk model: one susceptible risk and two common Weibull risks.

    R(t) = exp(-A2-A3) * (1-u+u*exp(-A1)).  Six free Weibull parameters
    and one population fraction are supported.  A bathtub-shaped hazard is
    possible, but is not asserted for every parameter combination.
    """

    def __init__(self, alpha_1, beta_1, alpha_2, beta_2, alpha_3, beta_3,
                 susceptible_fraction):
        super().__init__(alpha_1, beta_1, alpha_2, beta_2, susceptible_fraction,
                         alpha_3=alpha_3, beta_3=beta_3)


class _FitCompositeWeibull:
    """Independent normalized multistart MLE; no legacy proprietary recipe."""
    _risk_count = 2

    def __init__(self, failures, right_censored=None, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        rc = np.asarray([] if right_censored is None else right_censored, dtype=float)
        k = 2 * self._risk_count + 1
        if (failures.ndim != 1 or rc.ndim != 1 or len(failures) < k
                or np.any(~np.isfinite(failures)) or np.any(failures <= 0)
                or np.any(~np.isfinite(rc)) or np.any(rc <= 0)):
            raise ValueError(f'This composite model requires at least {k} finite '
                             'positive failures and finite positive suspensions.')
        if not np.isfinite(CI) or not 0 < CI < 1:
            raise ValueError('CI must be strictly between zero and one.')
        scale = float(np.median(failures))
        x, censored = failures / scale, rc / scale
        # The finite, declared normalized search region prevents degeneracy
        # from being mistaken for a meaningful interior component estimate.
        bounds = [bound for _ in range(self._risk_count)
                  for bound in [(-14.0, 14.0), (np.log(.05), np.log(100.0))]]
        bounds += [(logit(.001), logit(.999))]

        def decode(theta, unit_scale=1.0):
            values = np.exp(theta[:-1]).reshape(self._risk_count, 2)
            params = {key: float(value * unit_scale if name == 'alpha' else value)
                      for i, pair in enumerate(values, 1)
                      for name, value in zip(('alpha', 'beta'), pair)
                      for key in [f'{name}_{i}']}
            params['susceptible_fraction'] = float(expit(theta[-1]))
            cls = Weibull_Partial_CR if self._risk_count == 2 else Weibull_Bathtub
            return cls(**params), params

        def objective(theta):
            dist, _ = decode(theta)
            logpdf = dist.logPDF(x)
            logsf = dist.logSF(censored)
            value = -float(np.sum(logpdf) + np.sum(logsf))
            return value if np.isfinite(value) else 1e100

        candidates = []
        for infant_shape, common_shape in ((.55, 2.5), (1.2, 3.5), (2.5, 1.1)):
            for fraction in (.25, .65):
                pairs = [(.35, infant_shape), (1.5, common_shape)]
                if self._risk_count == 3:
                    pairs = [(.25, infant_shape), (2.5, .9), (1.8, common_shape)]
                start = np.r_[np.log(np.asarray(pairs).ravel()), logit(fraction)]
                result = minimize(objective, start, method='L-BFGS-B', bounds=bounds,
                                  options={'maxiter': 1600, 'ftol': 1e-12, 'gtol': 1e-6})
                candidates.append(('L-BFGS-B', result))
        for _, preliminary in sorted(candidates, key=lambda item: item[1].fun)[:2]:
            result = minimize(objective, preliminary.x, method='Nelder-Mead',
                              bounds=bounds, options={'maxiter': 6000,
                                                     'xatol': 1e-7, 'fatol': 1e-9})
            candidates.append(('Nelder-Mead', result))
        best, diagnostics = select_best_optimizer_result(candidates, objective, bounds=bounds)
        theta = best.x.copy()
        # Only the common risks are exchangeable; keep susceptible identity.
        def canonical(v):
            v = np.array(v, copy=True)
            if self._risk_count == 3 and tuple(v[2:4]) > tuple(v[4:6]):
                v[2:4], v[4:6] = v[4:6].copy(), v[2:4].copy()
            return v
        theta = canonical(theta)
        self.distribution, self.params = decode(theta, scale)
        for name, value in self.params.items():
            setattr(self, name, value)
        self.CI = float(CI)
        self.loglik = -float(best.fun) - len(failures) * np.log(scale)
        self.AICc, self.BIC = AICc(self.loglik, k, len(failures) + len(rc)), BIC(self.loglik, k, len(failures) + len(rc))
        self._bootstrap_failures, self._bootstrap_right_censored = failures.copy(), rc.copy()
        self.results = pd.DataFrame({'Parameter': list(self.params), 'Value': list(self.params.values())})
        hessian = numerical_hessian(lambda delta: objective(theta + delta), np.zeros(k))
        eigenvalues = (np.linalg.eigvalsh(hessian) if hessian is not None
                       and np.all(np.isfinite(hessian)) else np.array([-1.0]))
        condition = (float(eigenvalues[-1] / eigenvalues[0])
                     if eigenvalues[0] > 0 else np.inf)
        near = [canonical(result.x) for _, result in candidates if result.success
                and np.isfinite(result.fun) and result.fun <= best.fun + 1e-4]
        spread = max((float(np.max(np.abs(v - theta))) for v in near), default=np.inf)
        boundary = any(min(abs(value - lo), abs(value - hi)) < 1e-4
                       for value, (lo, hi) in zip(theta, bounds))
        fraction = self.susceptible_fraction
        identifiable = bool(not boundary and .05 < fraction < .95
                            and condition < 1e8 and spread < .75
                            and len(failures) * min(fraction, 1 - fraction) >= 5)
        diagnostics.update({'normalization_scale': scale, 'objective': -self.loglik,
                            'search_coordinates': 'log(scale/median), log(shape), logit(fraction)',
                            'search_bounds': [list(b) for b in bounds]})
        identification = {'identifiable': identifiable,
                          'information_condition': condition if np.isfinite(condition) else None,
                          'information_coordinates': 'dimensionless_log_parameters',
                          'near_optimal_solution_count': len(near),
                          'maximum_transformed_parameter_spread': spread,
                          'at_search_boundary': boundary,
                          'recommendation': None if identifiable else
                          'Use a simpler model or cause-labelled data before interpreting individual risks.'}
        _set_special_fit_status(self, diagnostics, identifiable, identification)
        # This new composite likelihood has no qualified finite-sample
        # bootstrap implementation yet. Do not advertise ordinary Wald or
        # generic mixture bootstrap intervals as justified for this model.
        self.parameter_ci_method = self.function_ci_method = 'unavailable_nonregular_composite_model'
        self.uncertainty_warnings = ['composite_model_uncertainty_not_calibrated']
        self.confidence_metadata.update({'reason': 'composite_model_uncertainty_not_calibrated',
                                         'validation_status': 'withheld',
                                         'warnings': list(self.uncertainty_warnings)})
        self.results['CI Method'] = self.parameter_ci_method

    def SF(self, t): return self.distribution.SF(t)
    def CDF(self, t): return self.distribution.CDF(t)
    def PDF(self, t): return self.distribution.PDF(t)
    def HF(self, t): return self.distribution.HF(t)
    def logSF(self, t): return self.distribution.logSF(t)
    def logPDF(self, t): return self.distribution.logPDF(t)
    def quantile(self, q): return self.distribution.quantile(q)


class Fit_Weibull_Partial_CR(_FitCompositeWeibull):
    """Five-parameter susceptible-plus-common-risk censored MLE."""
    _risk_count = 2


class Fit_Weibull_Bathtub(_FitCompositeWeibull):
    """Seven-parameter susceptible-plus-two-common-risks censored MLE."""
    _risk_count = 3


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
    reason = (
        'weak_component_identifiability'
        if not identifiable
        else 'calibrated_bootstrap_required'
    )
    fit.parameter_ci_method = 'unavailable_requires_refitted_bootstrap'
    fit.function_ci_method = 'unavailable_requires_refitted_bootstrap'
    fit.uncertainty_warnings = [f'confidence_inference_unavailable_{reason}']
    # Do not leave numerical Wald values in the primary result after a fit has
    # failed its identifiability checks. Even eligible special models require
    # the refitted bootstrap because their likelihood geometry is not reliably
    # summarized by a local Hessian.
    if hasattr(fit, 'results'):
        for column in ('Std_Error', 'Standard Error', 'Lower_CI', 'Lower CI',
                       'Upper_CI', 'Upper CI'):
            if column in fit.results:
                fit.results[column] = np.nan
        fit.results['CI Method'] = 'unavailable_requires_refitted_bootstrap'
    fit.confidence_metadata = {
        'available': False,
        'reason': reason,
        'sample_design': (
            'complete'
            if len(getattr(fit, '_bootstrap_right_censored', [])) == 0
            else 'right_censored'
        ),
        'confidence_level': float(getattr(fit, 'CI', 0.95)),
        'estimator': 'MLE',
        'exact': False,
        'band_scope': None,
        'parameter_methods': {},
        'function_method': None,
        'assumptions': [],
        'warnings': list(fit.uncertainty_warnings),
        'validation_status': 'on_demand_bootstrap_required',
        'primary': False,
    }


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
            and information_condition < 1e10
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
                'maximum_information_condition': 1e10,
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
                                      CI=None, n_bootstrap=499, seed=None,
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
            and information_condition < 1e10
        )
        identifiability = {
            'identifiable': identifiable,
            'standardized_component_separation': separation,
            'information_condition': (information_condition
                                      if np.isfinite(information_condition) else None),
            'multistart': stability,
            'thresholds': {
                'minimum_standardized_separation': 0.25,
                'maximum_information_condition': 1e10,
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
                                      CI=None, n_bootstrap=499, seed=None,
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
        free_probability_boundary = []
        tolerance = 1e-6
        if 'DS' in idx and (
            self.DS <= tolerance or self.DS >= 1.0 - tolerance
        ):
            free_probability_boundary.append('DS')
        if 'ZI' in idx and (
            self.ZI <= tolerance or self.ZI >= 1.0 - tolerance
        ):
            free_probability_boundary.append('ZI')
        if ('DS' in idx or 'ZI' in idx) and self.DS - self.ZI <= tolerance:
            free_probability_boundary.append('DS_minus_ZI')
        identifiable = not free_probability_boundary
        _set_special_fit_status(
            self,
            optimizer_diagnostics,
            identifiable=identifiable,
            identifiability={
                'identifiable': identifiable,
                'free_probability_boundary': free_probability_boundary,
                'recommendation': (
                    None if identifiable else
                    'Treat the boundary probability as fixed or collect data '
                    'that identify the susceptible fraction.'
                ),
            },
        )

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
