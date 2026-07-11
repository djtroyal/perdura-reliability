"""
Distribution fitters for reliability life data analysis.

Fits probability distributions to failure data with support for
right-censored (suspended) observations. Supports MLE and Rank
Regression (Least Squares) fitting methods.
"""

import numpy as np
import pandas as pd
import os
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from scipy.optimize import minimize, differential_evolution
from scipy import stats as ss

from reliability.Distributions import (
    Weibull_Distribution, Exponential_Distribution, Normal_Distribution,
    Lognormal_Distribution, Gamma_Distribution, Loglogistic_Distribution,
    Beta_Distribution, Gumbel_Distribution,
)
from reliability.Utils import (
    negative_log_likelihood, AICc, BIC, anderson_darling,
    rank_adjustment, median_rank_approximation, xy_transform,
    fisher_information_covariance, parameter_confidence_intervals,
    distribution_confidence_bounds, generate_X_array,
    FitConvergenceError, optimizer_result_diagnostics,
    select_best_optimizer_result,
)


def _mle_fit(dist_class, failures, right_censored, bounds, x0, num_params):
    """Generic MLE fitting using scipy.optimize.minimize.

    The optimization runs in a scaled parameter space (each parameter is
    normalized by the magnitude of its starting value) so that parameters of
    wildly different scales — e.g. a Weibull eta of 50,000 hours next to a
    beta of 3 — share well-conditioned finite-difference gradients and
    stopping tolerances. Without this, L-BFGS-B can terminate early on its
    relative-ftol criterion while still far from the optimum (reporting
    success), which showed up as visibly poor Weibull MLE fits on hour-scale
    data. A Nelder-Mead polish from the gradient solution is always run and
    the better likelihood kept.

    Returns (params, loglik, AICc_val, BIC_val, AD_val).
    """
    failures = np.asarray(failures, dtype=float)
    if right_censored is not None:
        right_censored = np.asarray(right_censored, dtype=float)
    n = len(failures) + (len(right_censored) if right_censored is not None else 0)

    # Per-parameter scale factors from the starting point (never zero).
    scale = np.array([max(abs(v), 1.0) if v != 0 else 1.0 for v in x0], dtype=float)
    u0 = np.asarray(x0, dtype=float) / scale
    u_bounds = [
        ((lo / s) if lo is not None else None, (hi / s) if hi is not None else None)
        for (lo, hi), s in zip(bounds, scale)
    ]

    def neg_ll(u):
        return negative_log_likelihood(u * scale, dist_class, failures, right_censored)

    initial_objective = neg_ll(u0)
    if not np.isfinite(initial_objective):
        raise FitConvergenceError(
            'The likelihood is non-finite at the validated starting point; '
            'the observations may be outside the distribution support.',
            diagnostics=[{
                'converged': False,
                'optimizer': 'preflight',
                'success': False,
                'message': 'nonfinite_initial_objective',
                'objective': None,
                'parameter_values': (u0 * scale).tolist(),
            }],
        )

    candidates = []
    result = minimize(neg_ll, u0, method='L-BFGS-B', bounds=u_bounds)
    candidates.append(('L-BFGS-B', result))
    start = result.x if np.all(np.isfinite(result.x)) else u0
    # Always polish: the gradient-based stop can be premature even when
    # scaled; a simplex refinement of a 1–3 parameter problem is cheap.
    polish = minimize(neg_ll, start, method='Nelder-Mead',
                      bounds=u_bounds,
                      options={'maxiter': 10000, 'xatol': 1e-10, 'fatol': 1e-10})
    candidates.append(('Nelder-Mead', polish))

    try:
        result, diagnostics = select_best_optimizer_result(
            candidates, neg_ll, bounds=u_bounds, parameter_scale=scale,
        )
    except FitConvergenceError:
        fallback = minimize(
            neg_ll, start, method='Powell', bounds=u_bounds,
            options={'maxiter': 10000, 'xtol': 1e-9, 'ftol': 1e-9},
        )
        candidates.append(('Powell', fallback))
        try:
            result, diagnostics = select_best_optimizer_result(
                candidates, neg_ll, bounds=u_bounds, parameter_scale=scale,
            )
        except FitConvergenceError:
            # Preserve a solver-successful, finite solution for diagnostics and
            # plotting, but it remains explicitly non-converged/ineligible and
            # cannot participate in model ranking. This is useful for nearly
            # degenerate samples whose likelihood tends toward a boundary.
            diagnostic_candidates = []
            for method, candidate in candidates:
                candidate_diagnostics = optimizer_result_diagnostics(
                    candidate, method, neg_ll, bounds=u_bounds,
                    parameter_scale=scale,
                )
                if (candidate_diagnostics['success']
                        and candidate_diagnostics['finite_parameters']
                        and candidate_diagnostics['finite_objective']
                        and candidate_diagnostics['gradient_finite']):
                    diagnostic_candidates.append(
                        (candidate, candidate_diagnostics)
                    )
            if not diagnostic_candidates:
                raise
            result, diagnostics = min(
                diagnostic_candidates, key=lambda pair: float(pair[0].fun)
            )
            diagnostics = dict(diagnostics)
            diagnostics['warnings'] = list(diagnostics['warnings']) + [
                'diagnostic_only_not_eligible'
            ]
            diagnostics['attempts'] = [
                optimizer_result_diagnostics(
                    candidate, method, neg_ll, bounds=u_bounds,
                    parameter_scale=scale,
                )
                for method, candidate in candidates
            ]

    params = result.x * scale
    loglik = -result.fun
    aicc = AICc(loglik, num_params, n)
    bic = BIC(loglik, num_params, n)

    try:
        dist = dist_class._from_params(params)
        ad = anderson_darling(failures, dist._cdf, right_censored)
    except Exception:
        ad = np.inf

    return params, loglik, aicc, bic, ad, diagnostics


def _finalize_fit_status(fit):
    """Attach convergence and information-criterion eligibility metadata."""
    diagnostics = getattr(fit, 'fit_diagnostics', None)
    if diagnostics is None:
        values = np.asarray(fit.results['Value'], dtype=float)
        converged = bool(np.all(np.isfinite(values)) and np.isfinite(fit.loglik))
        diagnostics = {
            'converged': converged,
            'optimizer': 'analytic_or_rank_regression',
            'success': converged,
            'message': 'No numerical optimizer was required.',
            'objective': float(-fit.loglik) if np.isfinite(fit.loglik) else None,
            'finite_parameters': bool(np.all(np.isfinite(values))),
            'finite_objective': bool(np.isfinite(fit.loglik)),
            'gradient_finite': None,
            'gradient_norm': None,
            'raw_gradient_norm': None,
            'boundary_parameters': [],
            'parameter_values': values.tolist(),
            'warnings': [],
        }
        fit.fit_diagnostics = diagnostics

    fit.converged = bool(diagnostics.get('converged', False))
    fit.fit_eligible = bool(fit.converged and np.isfinite(fit.loglik))
    fit.aicc_eligible = bool(fit.fit_eligible and np.isfinite(fit.AICc))
    reasons = []
    if not fit.converged:
        reasons.append('optimizer_not_converged')
    if not np.isfinite(fit.loglik):
        reasons.append('nonfinite_log_likelihood')
    if not np.isfinite(fit.AICc):
        reasons.append('aicc_undefined_for_sample_size')
    fit.eligibility_reasons = reasons


def _ls_fit(dist_name, failures, right_censored, method='RRY', force_origin=False):
    """Rank Regression (Least Squares) fitting.

    Parameters
    ----------
    method : str
        'RRY' (default; regress Y on X, minimizing vertical residuals —
        also accepted as 'LS' for backward compatibility) or
        'RRX' (regress X on Y, minimizing horizontal residuals).
    force_origin : bool
        Regress through the origin (intercept fixed at 0). Required by
        1-parameter papers such as the Exponential_1P line -ln(1-F) = λt,
        where a free intercept has no model counterpart and biases the slope.

    Returns (slope, intercept) in the linearized space.
    """
    failures = np.sort(np.asarray(failures, dtype=float))
    adj_ranks, n = rank_adjustment(failures, right_censored)
    F = median_rank_approximation(adj_ranks, n)
    F = np.clip(F, 1e-10, 1 - 1e-10)

    x_transform, y_transform, _, _ = xy_transform(dist_name)

    x = x_transform(failures)
    y = y_transform(F)

    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]

    if len(x) < 2:
        return None, None

    if force_origin:
        if method == 'RRX':
            m = np.sum(x * y) / np.sum(y * y)  # x = m*y through origin
            if m == 0:
                return None, None
            return 1.0 / m, 0.0
        denom = np.sum(x * x)
        if denom == 0:
            return None, None
        return np.sum(x * y) / denom, 0.0

    if method == 'RRX':
        # x = m*y + c  ->  y = (x - c)/m
        m, c, _, _, _ = ss.linregress(y, x)
        if m == 0:
            return None, None
        slope = 1.0 / m
        intercept = -c / m
    else:  # RRY / LS
        slope, intercept, _, _, _ = ss.linregress(x, y)
    return slope, intercept


def _profile_gamma(fit_2p, failures, right_censored, min_fail, n_coarse=12):
    """Profile-likelihood location-shift (gamma) search for the 3P fitters.

    ``fit_2p(shifted_failures, shifted_rc)`` must return a fitted 2P object
    with a ``.loglik`` attribute. A coarse scan brackets the optimum, then a
    bounded 1-D ``minimize_scalar`` polishes it — the 3P likelihood is very
    flat in gamma near min(failures), where a fixed grid is unreliable.

    Returns ``(best_gamma, best_2p_fit)``; the fit is None if every
    evaluation failed.
    """
    from scipy.optimize import minimize_scalar

    cache = {}

    def profile_nll(g):
        g = float(g)
        if g in cache:
            return cache[g][0]
        shifted_f = failures - g
        shifted_f = shifted_f[shifted_f > 0]
        nll, fit = np.inf, None
        if len(shifted_f) >= 2:
            shifted_rc = None
            if right_censored is not None and len(right_censored) > 0:
                src = right_censored - g
                src = src[src > 0]
                shifted_rc = src if len(src) > 0 else None
            try:
                fit = fit_2p(shifted_f, shifted_rc)
                nll = -fit.loglik
            except Exception:
                nll, fit = np.inf, None
        cache[g] = (nll, fit)
        return nll

    gammas = np.linspace(0.0, min_fail * 0.98, n_coarse)
    vals = np.array([profile_nll(g) for g in gammas])
    if not np.isfinite(vals).any():
        return 0.0, None
    i = int(np.nanargmin(vals))
    lo = float(gammas[max(i - 1, 0)])
    hi = float(gammas[min(i + 1, len(gammas) - 1)])
    if hi <= lo:
        hi = min(min_fail * 0.99, lo + max(min_fail * 0.01, 1e-9))
    try:
        res = minimize_scalar(profile_nll, bounds=(lo, hi), method='bounded',
                              options={'xatol': max(min_fail * 1e-5, 1e-12)})
        candidates = ([float(res.x)]
                      if bool(res.success) and np.isfinite(res.fun) else [])
    except Exception:
        candidates = []
    candidates.append(float(gammas[i]))
    best_g = min(candidates, key=profile_nll)
    return best_g, cache[float(best_g)][1]


class _FitResultMixin:
    """Shared confidence-interval machinery for all distribution fitters.

    Provides parameter confidence intervals (from the observed Fisher
    information) and confidence bounds on the survival/CDF functions
    (delta method). Mixed into every ``Fit_*`` class.
    """

    def _attach_cis(self, dist_class, params, param_names, positive_mask,
                    failures, right_censored, CI):
        """Compute and attach parameter CIs and store data for function bounds.

        Sets ``self.covariance_matrix``, ``self.CI``, per-parameter
        ``{name}_SE/_lower/_upper`` attributes, and augments ``self.results``
        with Standard Error / Lower CI / Upper CI columns.
        """
        self.CI = CI
        self._ci_dist_class = dist_class
        self._ci_params = np.asarray(params, dtype=float)
        self._ci_param_names = list(param_names)
        self._ci_positive_mask = list(positive_mask)
        self._ci_failures = failures
        self._ci_right_censored = right_censored

        cov = fisher_information_covariance(params, dist_class, failures, right_censored)
        self.covariance_matrix = cov

        ci = parameter_confidence_intervals(params, cov, positive_mask, CI)
        se, lower, upper = ci['se'], ci['lower'], ci['upper']

        for name, s, lo, hi in zip(param_names, se, lower, upper):
            setattr(self, f"{name}_SE", float(s))
            setattr(self, f"{name}_lower", float(lo))
            setattr(self, f"{name}_upper", float(hi))

        # Augment results table (rows are already in param_names order)
        if hasattr(self, 'results') and len(self.results) == len(param_names):
            self.results['Standard Error'] = se
            self.results['Lower CI'] = lower
            self.results['Upper CI'] = upper
            self.results['CI Method'] = 'observed_fisher_wald'
        self.parameter_ci_method = 'observed_fisher_wald'
        self.function_ci_method = 'delta_method_plotting_scale'
        self.uncertainty_warnings = ['asymptotic_wald_delta_approximation']
        if cov is None:
            self.uncertainty_warnings.append('covariance_unavailable')
        _finalize_fit_status(self)

    def confidence_bounds(self, xvals=None, func='SF'):
        """Confidence bounds on the survival ('SF') or cumulative ('CDF') function.

        Parameters
        ----------
        xvals : array-like, optional
            Times at which to evaluate. Defaults to an auto-generated range.
        func : str
            'SF' (default) or 'CDF'.

        Returns
        -------
        (x, lower, upper)
            ``lower``/``upper`` are None if the covariance was unavailable.
        """
        x = generate_X_array(self.distribution, xvals)
        sf_lower, sf_upper = distribution_confidence_bounds(
            self._ci_dist_class, self._ci_params, self.covariance_matrix, x, self.CI)
        if sf_lower is None:
            return x, None, None
        if func.upper() == 'CDF':
            return x, 1 - sf_upper, 1 - sf_lower
        return x, sf_lower, sf_upper

    def profile_likelihood_interval(self, target='reliability', value=None,
                                    CI=None):
        """Calibrated likelihood-ratio interval for a scalar target."""
        from reliability.Uncertainty import profile_likelihood_interval
        return profile_likelihood_interval(
            self, target=target, value=value, CI=CI,
        )

    def parametric_bootstrap_interval(self, target='reliability', value=None,
                                      CI=None, n_bootstrap=200, seed=None,
                                      return_samples=False):
        """Refitted parametric-bootstrap percentile interval."""
        from reliability.Uncertainty import parametric_bootstrap_interval
        return parametric_bootstrap_interval(
            self, target=target, value=value, CI=CI,
            n_bootstrap=n_bootstrap, seed=seed,
            return_samples=return_samples,
        )


class Fit_Weibull_2P(_FitResultMixin):
    """Fit a 2-parameter Weibull distribution to data.

    Parameters
    ----------
    failures : array-like
        Failure times.
    right_censored : array-like, optional
        Suspension times.
    method : str, optional
        'MLE' (default), 'RRY' (rank regression on Y), or 'RRX' (rank regression on X).
    show_probability_plot : bool, optional
        Whether to show a probability plot (default False).
    """

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)
        self.method = method  # the method actually used (all branches honor it)

        if method == 'MLE':
            all_data = np.concatenate([failures, right_censored]) if right_censored is not None and len(right_censored) > 0 else failures
            x0 = [np.mean(all_data), 1.5]
            bounds = [(1e-10, None), (1e-10, None)]
            params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
                Weibull_Distribution, failures, right_censored, bounds, x0, 2)
            self.eta, self.beta = params
        else:
            slope, intercept = _ls_fit('Weibull_2P', failures, right_censored, method)
            self.beta = slope
            self.eta = np.exp(-intercept / slope)
            self.distribution = Weibull_Distribution(eta=self.eta, beta=self.beta)
            self.loglik = -negative_log_likelihood([self.eta, self.beta], Weibull_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf, right_censored)

        self.distribution = Weibull_Distribution(eta=self.eta, beta=self.beta)
        self.results = pd.DataFrame({
            'Parameter': ['Eta', 'Beta'],
            'Value': [self.eta, self.beta]
        })
        self._attach_cis(Weibull_Distribution, [self.eta, self.beta],
                         ['eta', 'beta'], [True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Weibull_2P(eta={self.eta:.4f}, beta={self.beta:.4f})"


class Fit_Weibull_3P(_FitResultMixin):
    """Fit a 3-parameter Weibull distribution using profile likelihood for gamma."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)
        # The profile search may seed from an LS 2P fit, but the returned
        # parameters always come from the final full MLE below.
        self.method = 'MLE'

        min_fail = np.min(failures)
        best_gamma, fit2p = _profile_gamma(
            lambda f, rc: Fit_Weibull_2P(f, rc, method=method, show_probability_plot=False),
            failures, right_censored, min_fail)
        best_eta = fit2p.eta if fit2p is not None else float(np.mean(failures))
        best_beta = fit2p.beta if fit2p is not None else 1.5

        x0 = [best_eta, best_beta, best_gamma]
        bounds = [(1e-10, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
            Weibull_Distribution, failures, right_censored, bounds, x0, 3)
        self.eta, self.beta, self.gamma = params

        self.distribution = Weibull_Distribution(eta=self.eta, beta=self.beta, gamma=self.gamma)
        self.results = pd.DataFrame({
            'Parameter': ['Eta', 'Beta', 'Gamma'],
            'Value': [self.eta, self.beta, self.gamma]
        })
        self._attach_cis(Weibull_Distribution, [self.eta, self.beta, self.gamma],
                         ['eta', 'beta', 'gamma'], [True, True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Weibull_3P(eta={self.eta:.4f}, beta={self.beta:.4f}, gamma={self.gamma:.4f})"


class Fit_Exponential_1P(_FitResultMixin):
    """Fit a 1-parameter Exponential distribution."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        if method == 'MLE':
            total_time = np.sum(failures)
            if right_censored is not None and len(right_censored) > 0:
                total_time += np.sum(right_censored)
            self.Lambda = len(failures) / total_time
            self.method = 'MLE'
        else:
            # The 1P paper -ln(1-F) = λt has no intercept term, so the
            # regression is forced through the origin.
            slope, _ = _ls_fit('Exponential_1P', failures, right_censored,
                               method, force_origin=True)
            if slope is not None and slope > 0:
                self.Lambda = slope
                self.method = method
            else:
                self.Lambda = len(failures) / np.sum(failures)
                self.method = 'MLE'

        self.distribution = Exponential_Distribution(Lambda=self.Lambda)
        self.loglik = -negative_log_likelihood([self.Lambda], Exponential_Distribution, failures, right_censored)
        n = len(failures) + (len(right_censored) if right_censored is not None else 0)
        self.AICc = AICc(self.loglik, 1, n)
        self.BIC = BIC(self.loglik, 1, n)
        self.AD = anderson_darling(failures, self.distribution._cdf, right_censored)
        self.results = pd.DataFrame({
            'Parameter': ['Lambda'],
            'Value': [self.Lambda]
        })
        self._attach_cis(Exponential_Distribution, [self.Lambda],
                         ['Lambda'], [True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Exponential_1P(Lambda={self.Lambda:.6f})"


class Fit_Exponential_2P(_FitResultMixin):
    """Fit a 2-parameter Exponential distribution (with location shift)."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        min_fail = np.min(failures)
        self.Lambda = self.gamma = None
        self.method = 'MLE'

        if method != 'MLE':
            # Paper: -ln(1-F) = λt - λγ  ->  Lambda = slope, gamma = -c/slope.
            slope, intercept = _ls_fit('Exponential_2P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.Lambda = slope
                self.gamma = float(np.clip(-intercept / slope, 0, min_fail * 0.999))
                self.method = method

        if self.Lambda is None:
            x0 = [1.0 / np.mean(failures), min_fail * 0.5]
            bounds = [(1e-10, None), (0, min_fail * 0.999)]
            params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
                Exponential_Distribution, failures, right_censored, bounds, x0, 2)
            self.Lambda, self.gamma = params
        else:
            self.distribution = Exponential_Distribution(Lambda=self.Lambda, gamma=self.gamma)
            self.loglik = -negative_log_likelihood([self.Lambda, self.gamma],
                                                   Exponential_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf, right_censored)

        self.distribution = Exponential_Distribution(Lambda=self.Lambda, gamma=self.gamma)
        self.results = pd.DataFrame({
            'Parameter': ['Lambda', 'Gamma'],
            'Value': [self.Lambda, self.gamma]
        })
        self._attach_cis(Exponential_Distribution, [self.Lambda, self.gamma],
                         ['Lambda', 'gamma'], [True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Exponential_2P(Lambda={self.Lambda:.6f}, gamma={self.gamma:.4f})"


class Fit_Normal_2P(_FitResultMixin):
    """Fit a Normal distribution."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        if method == 'MLE':
            x0 = [np.mean(failures), np.std(failures, ddof=1)]
            bounds = [(None, None), (1e-10, None)]
            params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
                Normal_Distribution, failures, right_censored, bounds, x0, 2)
            self.mu, self.sigma = params
            self.method = 'MLE'
        else:
            slope, intercept = _ls_fit('Normal_2P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.sigma = 1.0 / slope
                self.mu = -intercept / slope
                self.method = method
            else:
                self.mu = np.mean(failures)
                self.sigma = np.std(failures, ddof=1)
                self.method = 'MLE'

            self.distribution = Normal_Distribution(mu=self.mu, sigma=self.sigma)
            self.loglik = -negative_log_likelihood([self.mu, self.sigma], Normal_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf, right_censored)

        self.distribution = Normal_Distribution(mu=self.mu, sigma=self.sigma)
        self.results = pd.DataFrame({
            'Parameter': ['Mu', 'Sigma'],
            'Value': [self.mu, self.sigma]
        })
        self._attach_cis(Normal_Distribution, [self.mu, self.sigma],
                         ['mu', 'sigma'], [False, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Normal_2P(mu={self.mu:.4f}, sigma={self.sigma:.4f})"


class Fit_Lognormal_2P(_FitResultMixin):
    """Fit a 2-parameter Lognormal distribution."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        if method == 'MLE':
            log_f = np.log(failures[failures > 0])
            x0 = [np.mean(log_f), np.std(log_f, ddof=1)]
            bounds = [(None, None), (1e-10, None)]
            params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
                Lognormal_Distribution, failures, right_censored, bounds, x0, 2)
            self.mu, self.sigma = params
            self.method = 'MLE'
        else:
            slope, intercept = _ls_fit('Lognormal_2P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.sigma = 1.0 / slope
                self.mu = -intercept / slope
                self.method = method
            else:
                log_f = np.log(failures[failures > 0])
                self.mu = np.mean(log_f)
                self.sigma = np.std(log_f, ddof=1)
                self.method = 'MLE'

            self.distribution = Lognormal_Distribution(mu=self.mu, sigma=self.sigma)
            self.loglik = -negative_log_likelihood([self.mu, self.sigma], Lognormal_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf, right_censored)

        self.distribution = Lognormal_Distribution(mu=self.mu, sigma=self.sigma)
        self.results = pd.DataFrame({
            'Parameter': ['Mu', 'Sigma'],
            'Value': [self.mu, self.sigma]
        })
        self._attach_cis(Lognormal_Distribution, [self.mu, self.sigma],
                         ['mu', 'sigma'], [False, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Lognormal_2P(mu={self.mu:.4f}, sigma={self.sigma:.4f})"


class Fit_Lognormal_3P(_FitResultMixin):
    """Fit a 3-parameter Lognormal distribution using profile likelihood for gamma."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        self.method = 'MLE'  # final parameters always come from the full MLE
        min_fail = np.min(failures)
        best_gamma, fit2p = _profile_gamma(
            lambda f, rc: Fit_Lognormal_2P(f, rc, method=method, show_probability_plot=False),
            failures, right_censored, min_fail)
        best_mu = fit2p.mu if fit2p is not None else float(np.mean(np.log(failures)))
        best_sigma = fit2p.sigma if fit2p is not None else float(np.std(np.log(failures)))

        x0 = [best_mu, best_sigma, best_gamma]
        bounds = [(None, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
            Lognormal_Distribution, failures, right_censored, bounds, x0, 3)
        self.mu, self.sigma, self.gamma = params

        self.distribution = Lognormal_Distribution(mu=self.mu, sigma=self.sigma, gamma=self.gamma)
        self.results = pd.DataFrame({
            'Parameter': ['Mu', 'Sigma', 'Gamma'],
            'Value': [self.mu, self.sigma, self.gamma]
        })
        self._attach_cis(Lognormal_Distribution, [self.mu, self.sigma, self.gamma],
                         ['mu', 'sigma', 'gamma'], [False, True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Lognormal_3P(mu={self.mu:.4f}, sigma={self.sigma:.4f}, gamma={self.gamma:.4f})"


class Fit_Gamma_2P(_FitResultMixin):
    """Fit a 2-parameter Gamma distribution.

    Always fitted by MLE: the Gamma CDF has no exact linearizing
    probability paper, so rank regression (RRX/RRY) is not available and a
    requested LS method falls back to MLE (reported via ``self.method``).
    """

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)
        self.method = 'MLE'

        mean_f = np.mean(failures)
        var_f = np.var(failures, ddof=1)
        x0 = [max(mean_f ** 2 / var_f, 0.1), max(var_f / mean_f, 0.1)]
        bounds = [(1e-10, None), (1e-10, None)]

        params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
            Gamma_Distribution, failures, right_censored, bounds, x0, 2)
        self.alpha, self.beta = params

        self.distribution = Gamma_Distribution(alpha=self.alpha, beta=self.beta)
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta'],
            'Value': [self.alpha, self.beta]
        })
        self._attach_cis(Gamma_Distribution, [self.alpha, self.beta],
                         ['alpha', 'beta'], [True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Gamma_2P(alpha={self.alpha:.4f}, beta={self.beta:.4f})"


class Fit_Gamma_3P(_FitResultMixin):
    """Fit a 3-parameter Gamma distribution using profile likelihood for gamma."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        self.method = 'MLE'  # final parameters always come from the full MLE
        min_fail = np.min(failures)
        best_gamma, fit2p = _profile_gamma(
            lambda f, rc: Fit_Gamma_2P(f, rc, show_probability_plot=False),
            failures, right_censored, min_fail)
        x0 = ([fit2p.alpha, fit2p.beta, best_gamma] if fit2p is not None
              else [1.0, 1.0, best_gamma])
        bounds = [(1e-10, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
            Gamma_Distribution, failures, right_censored, bounds, x0, 3)
        self.alpha, self.beta, self.gamma = params

        self.distribution = Gamma_Distribution(alpha=self.alpha, beta=self.beta, gamma=self.gamma)
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta', 'Gamma'],
            'Value': [self.alpha, self.beta, self.gamma]
        })
        self._attach_cis(Gamma_Distribution, [self.alpha, self.beta, self.gamma],
                         ['alpha', 'beta', 'gamma'], [True, True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Gamma_3P(alpha={self.alpha:.4f}, beta={self.beta:.4f}, gamma={self.gamma:.4f})"


class Fit_Loglogistic_2P(_FitResultMixin):
    """Fit a 2-parameter Log-logistic distribution."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        self.alpha = self.beta = None
        self.method = 'MLE'

        if method != 'MLE':
            # Logit paper: ln(F/(1-F)) = β·ln t - β·ln α.
            slope, intercept = _ls_fit('Loglogistic_2P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.beta = slope
                self.alpha = float(np.exp(-intercept / slope))
                self.method = method

        if self.alpha is None:
            x0 = [np.median(failures), 2.0]
            bounds = [(1e-10, None), (1e-10, None)]
            params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
                Loglogistic_Distribution, failures, right_censored, bounds, x0, 2)
            self.alpha, self.beta = params
        else:
            self.distribution = Loglogistic_Distribution(alpha=self.alpha, beta=self.beta)
            self.loglik = -negative_log_likelihood([self.alpha, self.beta],
                                                   Loglogistic_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf, right_censored)

        self.distribution = Loglogistic_Distribution(alpha=self.alpha, beta=self.beta)
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta'],
            'Value': [self.alpha, self.beta]
        })
        self._attach_cis(Loglogistic_Distribution, [self.alpha, self.beta],
                         ['alpha', 'beta'], [True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Loglogistic_2P(alpha={self.alpha:.4f}, beta={self.beta:.4f})"


class Fit_Loglogistic_3P(_FitResultMixin):
    """Fit a 3-parameter Log-logistic distribution using profile likelihood for gamma."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        self.method = 'MLE'  # final parameters always come from the full MLE
        min_fail = np.min(failures)
        best_gamma, fit2p = _profile_gamma(
            lambda f, rc: Fit_Loglogistic_2P(f, rc, show_probability_plot=False),
            failures, right_censored, min_fail)
        x0 = ([fit2p.alpha, fit2p.beta, best_gamma] if fit2p is not None
              else [float(np.median(failures)), 2.0, best_gamma])
        bounds = [(1e-10, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
            Loglogistic_Distribution, failures, right_censored, bounds, x0, 3)
        self.alpha, self.beta, self.gamma = params

        self.distribution = Loglogistic_Distribution(alpha=self.alpha, beta=self.beta, gamma=self.gamma)
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta', 'Gamma'],
            'Value': [self.alpha, self.beta, self.gamma]
        })
        self._attach_cis(Loglogistic_Distribution, [self.alpha, self.beta, self.gamma],
                         ['alpha', 'beta', 'gamma'], [True, True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Loglogistic_3P(alpha={self.alpha:.4f}, beta={self.beta:.4f}, gamma={self.gamma:.4f})"


class Fit_Beta_2P(_FitResultMixin):
    """Fit a 2-parameter Beta distribution.

    Always fitted by MLE: the Beta CDF has no exact linearizing probability
    paper, so rank regression (RRX/RRY) is not available and a requested LS
    method falls back to MLE (reported via ``self.method``).
    """

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)
        self.method = 'MLE'

        mean_f = np.mean(failures)
        var_f = np.var(failures, ddof=1)
        if var_f == 0:
            var_f = 0.01
        common = mean_f * (1 - mean_f) / var_f - 1
        a0 = max(mean_f * common, 0.5)
        b0 = max((1 - mean_f) * common, 0.5)

        x0 = [a0, b0]
        bounds = [(1e-10, None), (1e-10, None)]

        params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
            Beta_Distribution, failures, right_censored, bounds, x0, 2)
        self.alpha, self.beta = params

        self.distribution = Beta_Distribution(alpha=self.alpha, beta=self.beta)
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta'],
            'Value': [self.alpha, self.beta]
        })
        self._attach_cis(Beta_Distribution, [self.alpha, self.beta],
                         ['alpha', 'beta'], [True, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Beta_2P(alpha={self.alpha:.4f}, beta={self.beta:.4f})"


class Fit_Gumbel_2P(_FitResultMixin):
    """Fit a 2-parameter Gumbel distribution (minimum extreme value)."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        self.mu = self.sigma = None
        self.method = 'MLE'

        if method != 'MLE':
            # Min-EV paper: ln(-ln(1-F)) = (t - mu)/sigma.
            slope, intercept = _ls_fit('Gumbel_2P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.sigma = 1.0 / slope
                self.mu = -intercept / slope
                self.method = method

        if self.mu is None:
            x0 = [np.mean(failures), np.std(failures, ddof=1)]
            bounds = [(None, None), (1e-10, None)]
            params, self.loglik, self.AICc, self.BIC, self.AD, self.fit_diagnostics = _mle_fit(
                Gumbel_Distribution, failures, right_censored, bounds, x0, 2)
            self.mu, self.sigma = params
        else:
            self.distribution = Gumbel_Distribution(mu=self.mu, sigma=self.sigma)
            self.loglik = -negative_log_likelihood([self.mu, self.sigma],
                                                   Gumbel_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf, right_censored)

        self.distribution = Gumbel_Distribution(mu=self.mu, sigma=self.sigma)
        self.results = pd.DataFrame({
            'Parameter': ['Mu', 'Sigma'],
            'Value': [self.mu, self.sigma]
        })
        self._attach_cis(Gumbel_Distribution, [self.mu, self.sigma],
                         ['mu', 'sigma'], [False, True], failures, right_censored, CI)

    def __repr__(self):
        return f"Fit_Gumbel_2P(mu={self.mu:.4f}, sigma={self.sigma:.4f})"


# Mapping from distribution name to fitter class
_FITTER_MAP = {
    'Weibull_2P': Fit_Weibull_2P,
    'Weibull_3P': Fit_Weibull_3P,
    'Exponential_1P': Fit_Exponential_1P,
    'Exponential_2P': Fit_Exponential_2P,
    'Normal_2P': Fit_Normal_2P,
    'Lognormal_2P': Fit_Lognormal_2P,
    'Lognormal_3P': Fit_Lognormal_3P,
    'Gamma_2P': Fit_Gamma_2P,
    'Gamma_3P': Fit_Gamma_3P,
    'Loglogistic_2P': Fit_Loglogistic_2P,
    'Loglogistic_3P': Fit_Loglogistic_3P,
    'Beta_2P': Fit_Beta_2P,
    'Gumbel_2P': Fit_Gumbel_2P,
}

ALL_FITTER_NAMES = list(_FITTER_MAP.keys())


class Fit_Everything:
    """Fit all (or selected) distributions and rank by goodness-of-fit.

    Parameters
    ----------
    failures : array-like
        Failure times.
    right_censored : array-like, optional
        Suspension (right-censored) times.
    distributions_to_fit : list of str, optional
        Distribution names to try. Default is all 13 variants.
    method : str, optional
        'MLE' (default), 'RRY' (rank regression on Y), or 'RRX' (rank regression on X).
    sort_by : str, optional
        Metric to sort by: 'AICc' (default), 'BIC', 'AD', 'loglik'.
    progress_callback : callable, optional
        Called as ``progress_callback(done, total, name)`` each time a
        distribution finishes fitting (``name`` is the distribution that just
        completed). Exceptions raised by the callback are ignored.
    """

    def __init__(self, failures, right_censored=None, distributions_to_fit=None,
                 method='MLE', sort_by='AICc', CI=0.95,
                 show_probability_plot=False, show_histogram_plot=False,
                 show_PP_plot=False,
                 show_best_distribution_probability_plot=False,
                 progress_callback=None):
        # The show_* arguments are accepted for API compatibility with the
        # original `reliability` package but are intentionally no-ops here:
        # all plotting is done by the GUI from the returned results.

        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        if distributions_to_fit is None:
            distributions_to_fit = list(ALL_FITTER_NAMES)

        for name in distributions_to_fit:
            if name not in _FITTER_MAP:
                raise ValueError(f"Unknown distribution: '{name}'. Available: {ALL_FITTER_NAMES}")

        self.CI = CI

        # Each distribution is fitted independently, so run them concurrently.
        # NumPy/SciPy release the GIL during the heavy native routines, so threads
        # give real speed-up without process-pool serialization overhead. Warnings
        # are suppressed once here (the global filter is inherited by the workers —
        # warnings.catch_warnings() is not thread-safe to enter per-fit).
        def _fit_one(name):
            fitter_cls = _FITTER_MAP[name]
            try:
                fit = fitter_cls(failures=failures, right_censored=right_censored,
                                 method=method, show_probability_plot=False, CI=CI)
                return name, fit, {
                    'Distribution': name, 'AICc': fit.AICc, 'BIC': fit.BIC,
                    'AD': fit.AD, 'Log-Likelihood': fit.loglik,
                    'Method': getattr(fit, 'method', method),
                    'Converged': fit.converged,
                    'Fit Eligible': fit.fit_eligible,
                    'AICc Eligible': fit.aicc_eligible,
                    'Eligibility Reasons': list(fit.eligibility_reasons),
                    'Diagnostics': fit.fit_diagnostics,
                }
            except Exception as exc:
                diagnostics = (exc.diagnostics if isinstance(exc, FitConvergenceError)
                               else None)
                attempted_method = ('MLE' if name in {
                    'Weibull_3P', 'Lognormal_3P', 'Gamma_2P', 'Gamma_3P',
                    'Loglogistic_3P', 'Beta_2P',
                } else method)
                return name, None, {
                    'Distribution': name, 'AICc': np.inf, 'BIC': np.inf,
                    'AD': None, 'Log-Likelihood': -np.inf,
                    'Method': attempted_method,
                    'Converged': False, 'Fit Eligible': False,
                    'AICc Eligible': False,
                    'Eligibility Reasons': ['fit_failed'],
                    'Diagnostics': diagnostics,
                }

        total = len(distributions_to_fit)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            workers = min(total, (os.cpu_count() or 4))
            with ThreadPoolExecutor(max_workers=max(workers, 1)) as ex:
                futures = {name: ex.submit(_fit_one, name)
                           for name in distributions_to_fit}
                if progress_callback is not None:
                    # Report on the single thread iterating completions, so
                    # `done` is monotonic without locking.
                    done = 0
                    for fut in as_completed(futures.values()):
                        done += 1
                        try:
                            progress_callback(done, total, fut.result()[0])
                        except Exception:
                            pass  # a broken callback must not kill the fit
                outcomes = [futures[name].result()
                            for name in distributions_to_fit]  # preserves order

        fitted = {}
        results_list = []
        for name, fit, row in outcomes:
            if fit is not None:
                fitted[name] = fit
            results_list.append(row)

        self.results = pd.DataFrame(results_list)

        ascending = sort_by != 'loglik'
        col = 'Log-Likelihood' if sort_by == 'loglik' else sort_by
        # AD is None for censored samples (the complete-sample statistic is
        # invalid there); coerce for sorting so Nones sink to the bottom, and
        # fall back to AICc ordering when AD is unavailable everywhere.
        sort_key = pd.to_numeric(self.results[col], errors='coerce')
        if (col == 'AD'
                and not np.isfinite(sort_key.to_numpy(dtype=float)).any()):
            col, sort_key = 'AICc', pd.to_numeric(self.results['AICc'], errors='coerce')
        if col == 'AICc':
            metric_eligible = self.results['AICc Eligible'].astype(bool)
        else:
            metric_eligible = self.results['Fit Eligible'].astype(bool) & sort_key.notna()
        ineligible_value = np.inf if ascending else -np.inf
        sort_key = sort_key.where(metric_eligible, ineligible_value)
        self.results = (self.results.assign(_k=sort_key, _eligible=metric_eligible)
                        .sort_values(by='_k', ascending=ascending, na_position='last')
                        .drop(columns='_k').reset_index(drop=True))

        eligible_rows = self.results[self.results['_eligible']]
        best_name = (eligible_rows.iloc[0]['Distribution']
                     if len(eligible_rows) > 0 else None)
        self.best_distribution_name = best_name
        if best_name in fitted:
            self.best_distribution = fitted[best_name].distribution
        else:
            self.best_distribution = None

        self.results = self.results.drop(columns='_eligible')
        self.fitted = fitted

    def __repr__(self):
        return f"Fit_Everything(best={self.best_distribution_name})"
