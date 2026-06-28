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
from concurrent.futures import ThreadPoolExecutor
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
)


def _mle_fit(dist_class, failures, right_censored, bounds, x0, num_params):
    """Generic MLE fitting using scipy.optimize.minimize.

    Returns (params, loglik, AICc_val, BIC_val, AD_val).
    """
    failures = np.asarray(failures, dtype=float)
    if right_censored is not None:
        right_censored = np.asarray(right_censored, dtype=float)
    n = len(failures) + (len(right_censored) if right_censored is not None else 0)

    def neg_ll(params):
        return negative_log_likelihood(params, dist_class, failures, right_censored)

    # Try L-BFGS-B first, fallback to Nelder-Mead
    result = minimize(neg_ll, x0, method='L-BFGS-B', bounds=bounds)
    if not result.success or np.isnan(result.fun) or np.isinf(result.fun):
        result2 = minimize(neg_ll, x0, method='Nelder-Mead',
                           options={'maxiter': 10000, 'xatol': 1e-10, 'fatol': 1e-10})
        if result2.fun < result.fun or np.isnan(result.fun):
            result = result2

    params = result.x
    loglik = -result.fun
    aicc = AICc(loglik, num_params, n)
    bic = BIC(loglik, num_params, n)

    try:
        dist = dist_class._from_params(params)
        ad = anderson_darling(failures, dist._cdf)
    except Exception:
        ad = np.inf

    return params, loglik, aicc, bic, ad


def _ls_fit(dist_name, failures, right_censored, method='RRY'):
    """Rank Regression (Least Squares) fitting.

    Parameters
    ----------
    method : str
        'RRY' (default; regress Y on X, minimizing vertical residuals —
        also accepted as 'LS' for backward compatibility) or
        'RRX' (regress X on Y, minimizing horizontal residuals).

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
        self.method = method

        if method == 'MLE':
            all_data = np.concatenate([failures, right_censored]) if right_censored is not None and len(right_censored) > 0 else failures
            x0 = [np.mean(all_data), 1.5]
            bounds = [(1e-10, None), (1e-10, None)]
            params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
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
            self.AD = anderson_darling(failures, self.distribution._cdf)

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
        self.method = method

        min_fail = np.min(failures)
        gammas = np.linspace(0, min_fail * 0.95, 30)
        best_ll = -np.inf
        best_gamma = 0
        best_eta = np.mean(failures)
        best_beta = 1.5

        for g in gammas:
            shifted_f = failures - g
            shifted_f = shifted_f[shifted_f > 0]
            if len(shifted_f) < 2:
                continue
            shifted_rc = None
            if right_censored is not None and len(right_censored) > 0:
                shifted_rc = right_censored - g
                shifted_rc = shifted_rc[shifted_rc > 0]
                if len(shifted_rc) == 0:
                    shifted_rc = None

            try:
                fit2p = Fit_Weibull_2P(shifted_f, shifted_rc, method=method, show_probability_plot=False)
                if fit2p.loglik > best_ll:
                    best_ll = fit2p.loglik
                    best_gamma = g
                    best_eta = fit2p.eta
                    best_beta = fit2p.beta
            except Exception:
                continue

        x0 = [best_eta, best_beta, best_gamma]
        bounds = [(1e-10, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
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
        else:
            slope, _ = _ls_fit('Exponential_1P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.Lambda = slope
            else:
                self.Lambda = len(failures) / np.sum(failures)

        self.distribution = Exponential_Distribution(Lambda=self.Lambda)
        self.loglik = -negative_log_likelihood([self.Lambda], Exponential_Distribution, failures, right_censored)
        n = len(failures) + (len(right_censored) if right_censored is not None else 0)
        self.AICc = AICc(self.loglik, 1, n)
        self.BIC = BIC(self.loglik, 1, n)
        self.AD = anderson_darling(failures, self.distribution._cdf)
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
        x0 = [1.0 / np.mean(failures), min_fail * 0.5]
        bounds = [(1e-10, None), (0, min_fail * 0.999)]

        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
            Exponential_Distribution, failures, right_censored, bounds, x0, 2)
        self.Lambda, self.gamma = params

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
            params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
                Normal_Distribution, failures, right_censored, bounds, x0, 2)
            self.mu, self.sigma = params
        else:
            slope, intercept = _ls_fit('Normal_2P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.sigma = 1.0 / slope
                self.mu = -intercept / slope
            else:
                self.mu = np.mean(failures)
                self.sigma = np.std(failures, ddof=1)

            self.distribution = Normal_Distribution(mu=self.mu, sigma=self.sigma)
            self.loglik = -negative_log_likelihood([self.mu, self.sigma], Normal_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf)

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
            params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
                Lognormal_Distribution, failures, right_censored, bounds, x0, 2)
            self.mu, self.sigma = params
        else:
            slope, intercept = _ls_fit('Lognormal_2P', failures, right_censored, method)
            if slope is not None and slope > 0:
                self.sigma = 1.0 / slope
                self.mu = -intercept / slope
            else:
                log_f = np.log(failures[failures > 0])
                self.mu = np.mean(log_f)
                self.sigma = np.std(log_f, ddof=1)

            self.distribution = Lognormal_Distribution(mu=self.mu, sigma=self.sigma)
            self.loglik = -negative_log_likelihood([self.mu, self.sigma], Lognormal_Distribution, failures, right_censored)
            n = len(failures) + (len(right_censored) if right_censored is not None else 0)
            self.AICc = AICc(self.loglik, 2, n)
            self.BIC = BIC(self.loglik, 2, n)
            self.AD = anderson_darling(failures, self.distribution._cdf)

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

        min_fail = np.min(failures)
        gammas = np.linspace(0, min_fail * 0.95, 30)
        best_ll = -np.inf
        best_gamma = 0
        best_mu = np.mean(np.log(failures))
        best_sigma = np.std(np.log(failures))

        for g in gammas:
            shifted_f = failures - g
            shifted_f = shifted_f[shifted_f > 0]
            if len(shifted_f) < 2:
                continue
            shifted_rc = None
            if right_censored is not None and len(right_censored) > 0:
                shifted_rc = right_censored - g
                shifted_rc = shifted_rc[shifted_rc > 0]
                if len(shifted_rc) == 0:
                    shifted_rc = None
            try:
                fit2p = Fit_Lognormal_2P(shifted_f, shifted_rc, method=method, show_probability_plot=False)
                if fit2p.loglik > best_ll:
                    best_ll = fit2p.loglik
                    best_gamma = g
                    best_mu = fit2p.mu
                    best_sigma = fit2p.sigma
            except Exception:
                continue

        x0 = [best_mu, best_sigma, best_gamma]
        bounds = [(None, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
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
    """Fit a 2-parameter Gamma distribution."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        mean_f = np.mean(failures)
        var_f = np.var(failures, ddof=1)
        x0 = [max(mean_f ** 2 / var_f, 0.1), max(var_f / mean_f, 0.1)]
        bounds = [(1e-10, None), (1e-10, None)]

        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
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

        min_fail = np.min(failures)
        gammas = np.linspace(0, min_fail * 0.95, 20)
        best_ll = -np.inf
        best_params = [1, 1, 0]

        for g in gammas:
            shifted_f = failures - g
            shifted_f = shifted_f[shifted_f > 0]
            if len(shifted_f) < 2:
                continue
            shifted_rc = None
            if right_censored is not None and len(right_censored) > 0:
                shifted_rc = right_censored - g
                shifted_rc = shifted_rc[shifted_rc > 0]
                if len(shifted_rc) == 0:
                    shifted_rc = None
            try:
                fit2p = Fit_Gamma_2P(shifted_f, shifted_rc, show_probability_plot=False)
                if fit2p.loglik > best_ll:
                    best_ll = fit2p.loglik
                    best_params = [fit2p.alpha, fit2p.beta, g]
            except Exception:
                continue

        x0 = best_params
        bounds = [(1e-10, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
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

        x0 = [np.median(failures), 2.0]
        bounds = [(1e-10, None), (1e-10, None)]

        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
            Loglogistic_Distribution, failures, right_censored, bounds, x0, 2)
        self.alpha, self.beta = params

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

        min_fail = np.min(failures)
        gammas = np.linspace(0, min_fail * 0.95, 20)
        best_ll = -np.inf
        best_params = [np.median(failures), 2.0, 0]

        for g in gammas:
            shifted_f = failures - g
            shifted_f = shifted_f[shifted_f > 0]
            if len(shifted_f) < 2:
                continue
            shifted_rc = None
            if right_censored is not None and len(right_censored) > 0:
                shifted_rc = right_censored - g
                shifted_rc = shifted_rc[shifted_rc > 0]
                if len(shifted_rc) == 0:
                    shifted_rc = None
            try:
                fit2p = Fit_Loglogistic_2P(shifted_f, shifted_rc, show_probability_plot=False)
                if fit2p.loglik > best_ll:
                    best_ll = fit2p.loglik
                    best_params = [fit2p.alpha, fit2p.beta, g]
            except Exception:
                continue

        x0 = best_params
        bounds = [(1e-10, None), (1e-10, None), (0, min_fail * 0.999)]
        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
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
    """Fit a 2-parameter Beta distribution."""

    def __init__(self, failures, right_censored=None, method='MLE', show_probability_plot=False, CI=0.95):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)

        mean_f = np.mean(failures)
        var_f = np.var(failures, ddof=1)
        if var_f == 0:
            var_f = 0.01
        common = mean_f * (1 - mean_f) / var_f - 1
        a0 = max(mean_f * common, 0.5)
        b0 = max((1 - mean_f) * common, 0.5)

        x0 = [a0, b0]
        bounds = [(1e-10, None), (1e-10, None)]

        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
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

        x0 = [np.mean(failures), np.std(failures, ddof=1)]
        bounds = [(None, None), (1e-10, None)]

        params, self.loglik, self.AICc, self.BIC, self.AD = _mle_fit(
            Gumbel_Distribution, failures, right_censored, bounds, x0, 2)
        self.mu, self.sigma = params

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
    """

    def __init__(self, failures, right_censored=None, distributions_to_fit=None,
                 method='MLE', sort_by='AICc', CI=0.95,
                 show_probability_plot=False, show_histogram_plot=False,
                 show_PP_plot=False,
                 show_best_distribution_probability_plot=False):

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
                }
            except Exception:
                return name, None, {
                    'Distribution': name, 'AICc': np.inf, 'BIC': np.inf,
                    'AD': np.inf, 'Log-Likelihood': -np.inf,
                }

        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            workers = min(len(distributions_to_fit), (os.cpu_count() or 4))
            with ThreadPoolExecutor(max_workers=max(workers, 1)) as ex:
                outcomes = list(ex.map(_fit_one, distributions_to_fit))  # preserves order

        fitted = {}
        results_list = []
        for name, fit, row in outcomes:
            if fit is not None:
                fitted[name] = fit
            results_list.append(row)

        self.results = pd.DataFrame(results_list)

        ascending = sort_by != 'loglik'
        col = 'Log-Likelihood' if sort_by == 'loglik' else sort_by
        self.results = self.results.sort_values(by=col, ascending=ascending).reset_index(drop=True)

        best_name = self.results.iloc[0]['Distribution']
        self.best_distribution_name = best_name
        if best_name in fitted:
            self.best_distribution = fitted[best_name].distribution
        else:
            self.best_distribution = None

        self.fitted = fitted

    def __repr__(self):
        return f"Fit_Everything(best={self.best_distribution_name})"
