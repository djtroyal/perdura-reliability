"""
Repairable systems / reliability growth analysis.

Provides the Crow-AMSAA (NHPP power law) model fitted by maximum
likelihood, and the Duane graphical (regression) method, for analysing
reliability growth of repairable systems from cumulative failure times.
"""

import math

import numpy as np
import pandas as pd


def _validate_times(times):
    """Validate and convert cumulative failure times.

    Times must contain at least 2 values, all positive and strictly
    increasing. Returns a float numpy array.
    """
    times = np.asarray(times, dtype=float)
    if times.ndim != 1:
        times = times.ravel()
    if len(times) < 2:
        raise ValueError('At least 2 failure times are required.')
    if np.any(times <= 0):
        raise ValueError('All failure times must be positive.')
    if np.any(np.diff(times) <= 0):
        raise ValueError('Failure times must be strictly increasing '
                         '(cumulative system age at each failure).')
    return times


class CrowAMSAA:
    """Crow-AMSAA (NHPP power law) reliability growth model.

    Fits the non-homogeneous Poisson process power-law model
    N(t) = Lambda * t^beta to the cumulative failure times of a
    repairable system using maximum likelihood estimation.

    Parameters
    ----------
    times : array-like
        Cumulative (system age) failure times, sorted ascending.
    T : float, optional
        Total test time. If None, the test is treated as
        failure-terminated and T = times[-1].
    failure_terminated : bool, optional
        Explicitly mark the test as failure-terminated. If None
        (default) this is inferred: failure-terminated when T is None
        or T equals the last failure time, otherwise time-terminated.

    Attributes
    ----------
    beta : float
        MLE of the shape parameter. beta < 1 indicates reliability
        growth, beta > 1 indicates deterioration.
    Lambda : float
        MLE of the scale parameter (lambda is a reserved word).
    n : int
        Number of failures.
    T : float
        Total test time used in the fit.
    failure_terminated : bool
        Whether the test was failure-terminated.
    growth_rate : float
        1 - beta. Positive means reliability growth.
    cumulative_MTBF : float
        Cumulative MTBF at T: m_c(T) = 1 / (Lambda * T^(beta-1)).
    instantaneous_MTBF : float
        Instantaneous MTBF at T: m_i(T) = 1 / (Lambda * beta * T^(beta-1)).
    instantaneous_failure_intensity : float
        Failure intensity at T: Lambda * beta * T^(beta-1).
    CvM : float
        Cramer-von Mises goodness of fit statistic (lower is better).
    results : pandas.DataFrame
        Summary table with Parameter / Value rows.
    """

    def __init__(self, times, T=None, failure_terminated=None):
        times = _validate_times(times)
        n = len(times)
        t_n = times[-1]

        if T is None:
            T = t_n
            if failure_terminated is None:
                failure_terminated = True
        else:
            T = float(T)
            if T < t_n:
                raise ValueError('T must be >= the largest failure time.')
            if failure_terminated is None:
                failure_terminated = bool(T == t_n)
        if failure_terminated and T != t_n:
            raise ValueError('A failure-terminated test requires T to equal '
                             'the last failure time.')

        if failure_terminated:
            # beta = n / sum(ln(t_n / t_i)) for i = 1..n-1 (last term is 0)
            log_sum = np.sum(np.log(t_n / times[:-1]))
        else:
            # beta = n / sum(ln(T / t_i)) for i = 1..n
            log_sum = np.sum(np.log(T / times))
        if log_sum <= 0:
            raise ValueError('Cannot estimate beta: log-sum is non-positive.')

        beta = n / log_sum
        Lambda = n / T ** beta

        self.times = times
        self.n = n
        self.T = T
        self.failure_terminated = failure_terminated
        self.beta = beta
        self.Lambda = Lambda
        self.growth_rate = 1 - beta
        self.cumulative_MTBF = 1 / (Lambda * T ** (beta - 1))
        self.instantaneous_failure_intensity = Lambda * beta * T ** (beta - 1)
        self.instantaneous_MTBF = 1 / self.instantaneous_failure_intensity

        # Cramer-von Mises goodness of fit statistic. Both branches use the
        # bias-corrected beta_bar = (M-1)/M * beta_hat per MIL-HDBK-189
        # (the unbiased shape estimate enters the CvM statistic in the
        # failure- AND time-terminated cases).
        if failure_terminated:
            M = n - 1
            cvm_times = times[:-1]
        else:
            M = n
            cvm_times = times
        beta_bar = (M - 1) / M * beta if M > 1 else beta
        i = np.arange(1, M + 1)
        self.CvM = (1 / (12 * M)
                    + np.sum(((cvm_times / T) ** beta_bar
                              - (2 * i - 1) / (2 * M)) ** 2))

        # ── Confidence bounds (95%, two-sided) ────────────────────────────
        # Exact chi-square bounds on beta (MIL-HDBK-189): 2nβ/β̂ follows a
        # chi-square with 2n df (time-terminated) or 2(n−1) df
        # (failure-terminated). If the interval excludes 1, the trend is
        # statistically significant.
        from scipy.stats import chi2 as _chi2
        alpha_ci = 0.05
        df = 2 * (n - 1) if failure_terminated else 2 * n
        if df > 0:
            self.beta_lower = beta * _chi2.ppf(alpha_ci / 2, df) / (2 * n)
            self.beta_upper = beta * _chi2.ppf(1 - alpha_ci / 2, df) / (2 * n)
        else:
            self.beta_lower = self.beta_upper = None

        # Poisson-count chi-square bounds on the expected number of failures
        # by T give exact bounds on the cumulative MTBF (T / N-bounds).
        n_lower = _chi2.ppf(alpha_ci / 2, 2 * n) / 2.0
        n_upper = _chi2.ppf(1 - alpha_ci / 2, 2 * n + 2) / 2.0
        self.cumulative_MTBF_lower = T / n_upper if n_upper > 0 else None
        self.cumulative_MTBF_upper = T / n_lower if n_lower > 0 else None
        # First-order bounds on the instantaneous MTBF (m_i = m_c / β with β
        # at its point estimate) — approximate; labelled as such downstream.
        self.instantaneous_MTBF_lower = (
            self.cumulative_MTBF_lower / beta if self.cumulative_MTBF_lower else None)
        self.instantaneous_MTBF_upper = (
            self.cumulative_MTBF_upper / beta if self.cumulative_MTBF_upper else None)
        self.CI = 1 - alpha_ci

        self.results = pd.DataFrame({
            'Parameter': ['Beta', 'Lambda', 'Growth rate',
                          'Instantaneous MTBF at T', 'Cumulative MTBF at T',
                          'Cramer-von Mises statistic'],
            'Value': [self.beta, self.Lambda, self.growth_rate,
                      self.instantaneous_MTBF, self.cumulative_MTBF,
                      self.CvM],
        })

    def expected_failures(self, t):
        """Expected cumulative number of failures N(t) = Lambda * t^beta.

        Parameters
        ----------
        t : float or array-like
            Time(s) at which to evaluate.

        Returns
        -------
        float or numpy.ndarray
        """
        t = np.asarray(t, dtype=float)
        out = self.Lambda * t ** self.beta
        return out.item() if out.ndim == 0 else out

    def MTBF_cumulative(self, t):
        """Cumulative MTBF m_c(t) = 1 / (Lambda * t^(beta-1)).

        Parameters
        ----------
        t : float or array-like
            Time(s) at which to evaluate.

        Returns
        -------
        float or numpy.ndarray
        """
        t = np.asarray(t, dtype=float)
        out = 1 / (self.Lambda * t ** (self.beta - 1))
        return out.item() if out.ndim == 0 else out

    def MTBF_instantaneous(self, t):
        """Instantaneous MTBF m_i(t) = 1 / (Lambda * beta * t^(beta-1)).

        Parameters
        ----------
        t : float or array-like
            Time(s) at which to evaluate.

        Returns
        -------
        float or numpy.ndarray
        """
        t = np.asarray(t, dtype=float)
        out = 1 / (self.Lambda * self.beta * t ** (self.beta - 1))
        return out.item() if out.ndim == 0 else out

    def __repr__(self):
        termination = ('failure-terminated' if self.failure_terminated
                       else 'time-terminated')
        return (f'CrowAMSAA({termination}, n={self.n}, T={self.T:g}, '
                f'beta={self.beta:.4f}, Lambda={self.Lambda:.6g}, '
                f'growth_rate={self.growth_rate:.4f}, '
                f'instantaneous_MTBF={self.instantaneous_MTBF:.4f})')


class Duane:
    """Duane reliability growth model (graphical / regression method).

    Regresses log10(cumulative MTBF) on log10(time), where the
    cumulative MTBF at the i-th failure is m_c(t_i) = t_i / i.

    Parameters
    ----------
    times : array-like
        Cumulative (system age) failure times, sorted ascending.
    T : float, optional
        Total test time. If None, T = times[-1].

    Attributes
    ----------
    alpha : float
        Duane growth slope. Positive indicates reliability growth.
    b : float
        Intercept of the regression line (log10 scale).
    A : float
        10**b, so that m_c(t) = A * t^alpha.
    n : int
        Number of failures.
    r_squared : float
        Coefficient of determination of the regression.
    DMTBF_C : float
        Cumulative MTBF at T: A * T^alpha.
    DMTBF_I : float
        Instantaneous (demonstrated) MTBF at T: DMTBF_C / (1 - alpha),
        or None when alpha is outside 0 <= alpha < 1.
    results : pandas.DataFrame
        Summary table with Parameter / Value rows.
    """

    def __init__(self, times, T=None):
        times = _validate_times(times)
        n = len(times)
        if T is None:
            T = times[-1]
        else:
            T = float(T)
            if T < times[-1]:
                raise ValueError('T must be >= the largest failure time.')

        i = np.arange(1, n + 1)
        mc = times / i
        x = np.log10(times)
        y = np.log10(mc)

        alpha, b = np.polyfit(x, y, 1)
        y_hat = b + alpha * x
        ss_res = np.sum((y - y_hat) ** 2)
        ss_tot = np.sum((y - np.mean(y)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

        self.times = times
        self.n = n
        self.T = T
        self.alpha = alpha
        self.b = b
        self.A = 10 ** b
        self.r_squared = r_squared
        self.DMTBF_C = self.A * T ** alpha
        self.valid_growth_regime = bool(0.0 <= alpha < 1.0)
        if self.valid_growth_regime:
            self.DMTBF_I = self.DMTBF_C / (1 - alpha)
            self.regime_warning = None
        else:
            self.DMTBF_I = None
            self.regime_warning = (
                f'Duane instantaneous MTBF is withheld because alpha={alpha:.6g} '
                'is outside the model growth regime 0 <= alpha < 1. Use '
                'Crow-AMSAA and investigate deterioration or change points.'
            )

        self.results = pd.DataFrame({
            'Parameter': ['Alpha (growth slope)', 'A (10^intercept)',
                          'R-squared', 'Instantaneous MTBF at T (DMTBF_I)',
                          'Cumulative MTBF at T (DMTBF_C)'],
            'Value': [self.alpha, self.A, self.r_squared,
                      self.DMTBF_I, self.DMTBF_C],
        })

    def MTBF_cumulative(self, t):
        """Cumulative MTBF m_c(t) = A * t^alpha.

        Parameters
        ----------
        t : float or array-like
            Time(s) at which to evaluate.

        Returns
        -------
        float or numpy.ndarray
        """
        t = np.asarray(t, dtype=float)
        out = self.A * t ** self.alpha
        return out.item() if out.ndim == 0 else out

    def MTBF_instantaneous(self, t):
        """Instantaneous MTBF m_i(t) = A * t^alpha / (1 - alpha).

        Parameters
        ----------
        t : float or array-like
            Time(s) at which to evaluate.

        Returns
        -------
        float or numpy.ndarray
        """
        t = np.asarray(t, dtype=float)
        if not self.valid_growth_regime:
            if t.ndim == 0:
                return None
            return np.full(t.shape, np.nan, dtype=float)
        out = self.A * t ** self.alpha / (1 - self.alpha)
        return out.item() if out.ndim == 0 else out

    def __repr__(self):
        instantaneous = ('withheld' if self.DMTBF_I is None
                         else f'{self.DMTBF_I:.4f}')
        return (f'Duane(n={self.n}, T={self.T:g}, alpha={self.alpha:.4f}, '
                f'A={self.A:.6g}, r_squared={self.r_squared:.4f}, '
                f'DMTBF_I={instantaneous})')


# ── Optimal replacement time ─────────────────────────────────────────────────

def optimal_replacement_time(cost_PM, cost_CM, weibull_alpha, weibull_beta,
                             q=0, t_max=None, n_points=10000):
    """Optimal preventive-maintenance (replacement) interval.

    Balances the cost of scheduled preventive maintenance (PM) against the
    higher cost of unplanned corrective maintenance (CM) after a failure, by
    minimising the long-run cost per unit time as a function of the replacement
    interval ``t``. The underlying failure distribution is Weibull(alpha, beta).

    Parameters
    ----------
    cost_PM : float
        Cost of a preventive (scheduled) replacement. Must be < cost_CM.
    cost_CM : float
        Cost of a corrective (unplanned, post-failure) replacement.
    weibull_alpha : float
        Weibull scale parameter (characteristic life).
    weibull_beta : float
        Weibull shape parameter. Replacement only pays off when beta > 1
        (wear-out); for beta <= 1 there is no finite optimum.
    q : int, optional
        Maintenance/renewal assumption. ``0`` (default) = age replacement:
        replace on failure or at age T, with either event renewing the item.
        ``1`` = block replacement at T with minimal repairs between scheduled
        replacements (Power-Law NHPP).
    t_max : float, optional
        Initial upper bound for the plotted/search range. Defaults to
        3 * alpha. If a finite optimum lies beyond it, the range is expanded
        and this is reported rather than treating the boundary as an optimum.
    n_points : int, optional
        Number of grid points used for the search.

    Returns
    -------
    dict
        ``optimal_replacement_time`` (``None`` for run-to-failure),
        ``decision``, ``finite_optimum``, ``min_cost`` (cost per unit time at
        the decision), the corrective-only baseline, boundary/search
        diagnostics, plotting arrays, and ``q``.
    """
    cost_PM = float(cost_PM)
    cost_CM = float(cost_CM)
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    if cost_PM <= 0 or cost_CM <= 0:
        raise ValueError('Costs must be positive.')
    if cost_PM >= cost_CM:
        raise ValueError('cost_PM must be less than cost_CM (otherwise '
                         'preventive maintenance is never worthwhile).')
    if alpha <= 0 or beta <= 0:
        raise ValueError('weibull_alpha and weibull_beta must be positive.')
    if q not in (0, 1):
        raise ValueError("q must be 0 ('as good as new') or 1 ('as good as old').")
    if n_points < 2:
        raise ValueError('n_points must be at least 2.')
    if t_max is not None and float(t_max) <= 0:
        raise ValueError('t_max must be positive.')

    # Baseline: always running to failure (corrective only) — one corrective
    # replacement per MTTF = alpha * Gamma(1 + 1/beta) on average. (Dividing by
    # alpha alone understates the do-nothing cost whenever beta != 1.)
    mttf = alpha * math.gamma(1.0 + 1.0 / beta)
    corrective_only = float(cost_CM / mttf)
    requested_t_max = float(t_max) if t_max is not None else 3.0 * alpha

    finite_optimum = False
    optimal_time = None
    decision = 'run_to_failure'
    decision_reason = (
        'Weibull beta <= 1 has non-increasing hazard, so scheduled preventive '
        'replacement has no finite cost-rate optimum.'
    )
    search_limit = 1e12 * alpha

    if beta > 1.0:
        if q == 1:
            # C(T) = Cp/T + Cc*T^(beta-1)/alpha^beta has a closed-form minimum.
            candidate = alpha * (cost_PM / (cost_CM * (beta - 1.0))) ** (1.0 / beta)
        else:
            # For age replacement, C'(T)=0 reduces after division by R(T) to
            # (Cc-Cp) h(T) integral_0^T R(s)ds = Cc-(Cc-Cp)R(T).
            # Solve in log(T/alpha) so very small/large candidates remain stable.
            from scipy.optimize import brentq
            from scipy.special import gammainc

            delta_cost = cost_CM - cost_PM

            def stationary_equation(log_x):
                log_z = beta * log_x
                if log_z > math.log(745.0):
                    z = math.inf
                    reliability = 0.0
                    cycle_length = mttf
                else:
                    z = math.exp(log_z)
                    reliability = math.exp(-z)
                    cycle_length = mttf * float(gammainc(1.0 / beta, z))
                log_h_factor = (beta - 1.0) * log_x
                if log_h_factor > 700.0:
                    hazard_times_cycle = math.inf
                else:
                    hazard_times_cycle = (
                        beta / alpha * math.exp(log_h_factor) * cycle_length
                    )
                return (
                    delta_cost * hazard_times_cycle
                    - (cost_CM - delta_cost * reliability)
                )

            log_lo = math.log(np.finfo(float).eps)
            log_hi = math.log(max(requested_t_max / alpha, 1.0))
            log_limit = math.log(1e12)
            while stationary_equation(log_hi) <= 0.0 and log_hi < log_limit:
                log_hi = min(log_hi + math.log(2.0), log_limit)
            if stationary_equation(log_hi) > 0.0:
                candidate = alpha * math.exp(brentq(
                    stationary_equation, log_lo, log_hi, xtol=1e-12, rtol=1e-12
                ))
            else:
                candidate = math.inf

        if math.isfinite(candidate) and 0.0 < candidate <= search_limit:
            finite_optimum = True
            optimal_time = float(candidate)
            decision = 'preventive_replacement'
            decision_reason = 'A finite interior cost-rate minimum was found for beta > 1.'
        else:
            decision_reason = (
                'The cost curve was still decreasing at the qualified search '
                'limit; the boundary is not reported as an optimum. Use the '
                'run-to-failure baseline unless a practical planning bound is supplied.'
            )

    plot_t_max = requested_t_max
    search_expanded = False
    if finite_optimum and optimal_time >= requested_t_max:
        plot_t_max = max(requested_t_max, 1.25 * optimal_time)
        search_expanded = True
    t = np.linspace(plot_t_max / n_points, plot_t_max, n_points)

    if q == 1:
        # Minimal-repair block policy: E[N(T)] = H(T).
        H = (t / alpha) ** beta
        cost_per_time = (cost_PM + cost_CM * H) / t
    else:
        # Renewal age policy, using the analytic truncated Weibull mean rather
        # than a grid-dependent cumulative sum.
        from scipy.special import gammainc
        z = (t / alpha) ** beta
        R = np.exp(-z)
        integral_R = mttf * gammainc(1.0 / beta, z)
        cost_per_time = (cost_PM * R + cost_CM * (1.0 - R)) / integral_R

    if finite_optimum:
        if q == 1:
            z_opt = (optimal_time / alpha) ** beta
            min_cost = (cost_PM + cost_CM * z_opt) / optimal_time
        else:
            from scipy.special import gammainc
            z_opt = (optimal_time / alpha) ** beta
            r_opt = math.exp(-z_opt)
            cycle_opt = mttf * float(gammainc(1.0 / beta, z_opt))
            min_cost = (cost_PM * r_opt + cost_CM * (1.0 - r_opt)) / cycle_opt
    else:
        min_cost = corrective_only

    sampled_idx = int(np.nanargmin(cost_per_time))
    boundary_minimum = not finite_optimum and sampled_idx == len(t) - 1
    return {
        'optimal_replacement_time': optimal_time,
        'min_cost': float(min_cost),
        'corrective_only_cost_rate': corrective_only,
        # Back-compat alias for the old (mislabeled) key.
        'cost_PM_per_unit_time': corrective_only,
        'time': t.tolist(),
        'cost': [None if not np.isfinite(c) else float(c) for c in cost_per_time],
        'q': q,
        'decision': decision,
        'finite_optimum': finite_optimum,
        'decision_reason': decision_reason,
        'boundary_minimum': boundary_minimum,
        'search_expanded': search_expanded,
        'requested_t_max': requested_t_max,
        'evaluated_t_max': float(plot_t_max),
    }


# ── Replacement-policy comparison & maintenance-cost forecast ─────────────────

def _age_metrics(cost_PM, cost_CM, alpha, beta, T, n=4000):
    """Long-run metrics for an AGE replacement policy at interval ``T``.

    Age replacement (Barlow-Proschan): replace on failure or at age ``T``,
    whichever comes first, each renewing the item. Cycle length
    ``E[min(X, T)] = ∫_0^T R(s) ds``; a cycle ends in corrective replacement with
    probability ``F(T)`` and in preventive replacement with probability ``R(T)``.
    """
    T = float(T)
    if T <= 0:
        return None
    from scipy.special import gammainc
    mttf = alpha * math.gamma(1.0 + 1.0 / beta)
    z = (T / alpha) ** beta
    # Exact E[min(X,T)] for Weibull X via the lower incomplete gamma.
    e_cycle = mttf * float(gammainc(1.0 / beta, z))
    if e_cycle <= 0:
        return None
    R_T = float(np.exp(-z))
    F_T = 1.0 - R_T
    return {
        'cost_rate': (cost_PM * R_T + cost_CM * F_T) / e_cycle,
        'pm_per_time': R_T / e_cycle,
        'cm_per_time': F_T / e_cycle,
    }


def _block_metrics(cost_PM, cost_CM, alpha, beta, T):
    """Long-run metrics for a BLOCK (periodic) replacement policy at interval ``T``.

    Preventive replacement every ``T`` regardless of age; failures in between are
    minimally repaired (as good as old), so the expected number of corrective
    events per interval is the cumulative hazard ``H(T) = (T/alpha)^beta``.
    """
    T = float(T)
    if T <= 0:
        return None
    H = (T / alpha) ** beta
    return {
        'cost_rate': (cost_PM + cost_CM * H) / T,
        'pm_per_time': 1.0 / T,
        'cm_per_time': H / T,
    }


def replacement_policy_comparison(cost_PM, cost_CM, weibull_alpha, weibull_beta,
                                  t_max=None, n_points=10000):
    """Compare AGE vs BLOCK preventive-replacement policies for a Weibull item.

    Both policies trade scheduled preventive-maintenance (PM) cost against the
    higher cost of unplanned corrective maintenance (CM). This finds each
    policy's optimal interval and long-run cost per unit time (reusing
    :func:`optimal_replacement_time` — ``q=0`` is age replacement, ``q=1`` is
    block/periodic replacement with minimal repair), and reports the expected
    PM and CM events per unit time at each optimum, the corrective-only
    baseline, and which policy is cheaper.

    Returns
    -------
    dict
        ``age`` and ``block`` sub-dicts (``optimal_time``, ``min_cost``,
        ``pm_per_time``, ``cm_per_time``, ``time``, ``cost``),
        ``corrective_only_cost``, ``mttf`` and ``cheaper_policy``.
    """
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    if float(cost_PM) <= 0 or float(cost_CM) <= 0:
        raise ValueError('Costs must be positive.')
    if alpha <= 0 or beta <= 0:
        raise ValueError('weibull_alpha and weibull_beta must be positive.')

    age = optimal_replacement_time(cost_PM, cost_CM, alpha, beta, q=0,
                                   t_max=t_max, n_points=n_points)
    block = optimal_replacement_time(cost_PM, cost_CM, alpha, beta, q=1,
                                     t_max=t_max, n_points=n_points)
    mttf = alpha * math.gamma(1.0 + 1.0 / beta)
    corrective_only = float(cost_CM) / mttf

    if age['optimal_replacement_time'] is None:
        am = {'pm_per_time': 0.0, 'cm_per_time': 1.0 / mttf}
    else:
        am = _age_metrics(cost_PM, cost_CM, alpha, beta, age['optimal_replacement_time'])
    if block['optimal_replacement_time'] is None:
        # The product-level decision is no scheduled PM. Use the same renewal
        # corrective baseline for a directly comparable policy table.
        bm = {'pm_per_time': 0.0, 'cm_per_time': 1.0 / mttf}
    else:
        bm = _block_metrics(cost_PM, cost_CM, alpha, beta, block['optimal_replacement_time'])

    candidates = [
        (name, result) for name, result in (('age', age), ('block', block))
        if result['finite_optimum']
        and result['min_cost'] < corrective_only * (1.0 - 1e-12)
    ]
    cheaper = min(candidates, key=lambda item: item[1]['min_cost'])[0] if candidates else 'corrective'

    def _policy_payload(result, metrics):
        return {
            'optimal_time': result['optimal_replacement_time'],
            'min_cost': result['min_cost'],
            'pm_per_time': metrics['pm_per_time'] if metrics else None,
            'cm_per_time': metrics['cm_per_time'] if metrics else None,
            'time': result['time'],
            'cost': result['cost'],
            'decision': result['decision'],
            'finite_optimum': result['finite_optimum'],
            'decision_reason': result['decision_reason'],
            'boundary_minimum': result['boundary_minimum'],
            'search_expanded': result['search_expanded'],
        }

    return {
        'age': _policy_payload(age, am),
        'block': _policy_payload(block, bm),
        'corrective_only_cost': corrective_only,
        'mttf': float(mttf),
        'cheaper_policy': cheaper,
        'recommendation': (
            'Run to failure; no finite preventive-replacement interval is cost-optimal.'
            if cheaper == 'corrective'
            else f"Use the {cheaper} preventive-replacement policy."
        ),
        'analysis_basis': 'long_run_renewal_reward_cost_rate',
        'maintenance_assumptions': {
            'age': 'Perfect renewal after failure or scheduled age replacement.',
            'block': 'Minimal repair between perfect scheduled block replacements.',
            'corrective': 'Perfect renewal after each failure.',
        },
    }


def maintenance_cost_forecast(policy, cost_PM, cost_CM, weibull_alpha,
                              weibull_beta, horizon, interval=None, n_points=200):
    """Forecast expected maintenance events and cost over a planning horizon.

    ``policy`` is one of ``'corrective'`` (run-to-failure, renewal),
    ``'age'`` or ``'block'``. For age/block an ``interval`` may be given;
    otherwise that policy's optimal interval is used. Long-run event rates and
    cost per unit time come from the same models as
    :func:`replacement_policy_comparison`; the corrective-only case uses the
    Weibull mean time to failure ``MTTF = alpha·Γ(1 + 1/beta)``.

    Returns
    -------
    dict
        ``policy``, ``interval`` (used), ``expected_pm``, ``expected_cm``,
        ``total_cost``, ``cost_rate``, ``mttf``, and ``time`` /
        ``cumulative_cost`` arrays for plotting.
    """
    policy = str(policy).lower()
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    cost_PM = float(cost_PM)
    cost_CM = float(cost_CM)
    horizon = float(horizon)
    if cost_PM <= 0 or cost_CM <= 0:
        raise ValueError('Costs must be positive.')
    if alpha <= 0 or beta <= 0:
        raise ValueError('weibull_alpha and weibull_beta must be positive.')
    if horizon <= 0:
        raise ValueError('horizon must be positive.')

    mttf = alpha * math.gamma(1.0 + 1.0 / beta)

    if policy == 'corrective':
        cost_rate = cost_CM / mttf
        pm_rate, cm_rate = 0.0, 1.0 / mttf
        used_interval = None
    elif policy == 'age':
        optimum = None if interval else optimal_replacement_time(
            cost_PM, cost_CM, alpha, beta, q=0)
        T = float(interval) if interval else optimum['optimal_replacement_time']
        if T is None:
            cost_rate, pm_rate, cm_rate = cost_CM / mttf, 0.0, 1.0 / mttf
            used_interval = None
        else:
            m = _age_metrics(cost_PM, cost_CM, alpha, beta, T)
            if m is None:
                raise ValueError('interval must be positive.')
            cost_rate, pm_rate, cm_rate = m['cost_rate'], m['pm_per_time'], m['cm_per_time']
            used_interval = T
    elif policy == 'block':
        optimum = None if interval else optimal_replacement_time(
            cost_PM, cost_CM, alpha, beta, q=1)
        T = float(interval) if interval else optimum['optimal_replacement_time']
        if T is None:
            cost_rate, pm_rate, cm_rate = cost_CM / mttf, 0.0, 1.0 / mttf
            used_interval = None
        else:
            m = _block_metrics(cost_PM, cost_CM, alpha, beta, T)
            if m is None:
                raise ValueError('interval must be positive.')
            cost_rate, pm_rate, cm_rate = m['cost_rate'], m['pm_per_time'], m['cm_per_time']
            used_interval = T
    else:
        raise ValueError("policy must be one of 'corrective', 'age', 'block'.")

    t = np.linspace(0.0, horizon, n_points)
    cumulative_cost = cost_rate * t
    return {
        'policy': policy,
        'interval': used_interval,
        'expected_pm': float(pm_rate * horizon),
        'expected_cm': float(cm_rate * horizon),
        'total_cost': float(cost_rate * horizon),
        'cost_rate': float(cost_rate),
        'mttf': float(mttf),
        'time': t.tolist(),
        'cumulative_cost': cumulative_cost.tolist(),
        'analysis_basis': 'long_run_rate_projected_over_finite_horizon',
        'finite_horizon_transients_modeled': False,
        'assumption_note': (
            'Expected event and cost counts are the selected policy long-run '
            'renewal/reward rates multiplied by the horizon. Use the virtual-age '
            'simulation for imperfect repair and finite-horizon uncertainty.'
        ),
    }


def simulate_virtual_age_maintenance(
        weibull_alpha, weibull_beta, horizon, preventive_interval=None,
        repair_effectiveness=0.0, preventive_effectiveness=None,
        cost_CM=0.0, cost_PM=0.0, corrective_downtime=0.0,
        preventive_downtime=0.0, n_simulations=2000, CI=0.95, seed=None,
        n_time_points=101):
    """Finite-horizon Kijima-II virtual-age maintenance simulation.

    The baseline lifetime is Weibull. Immediately before a maintenance action
    the item has virtual age ``v``; immediately after it has ``q*v``. Thus
    ``q=0`` is perfect renewal and ``q=1`` is minimal repair. Corrective and
    preventive effectiveness can differ. The simulation advances calendar
    time through explicit maintenance downtime, so reported availability is a
    finite-horizon result rather than a steady-state rate approximation.
    """
    alpha = float(weibull_alpha)
    beta = float(weibull_beta)
    horizon = float(horizon)
    q_cm = float(repair_effectiveness)
    q_pm = q_cm if preventive_effectiveness is None else float(preventive_effectiveness)
    cost_CM = float(cost_CM)
    cost_PM = float(cost_PM)
    corrective_downtime = float(corrective_downtime)
    preventive_downtime = float(preventive_downtime)
    CI = float(CI)
    if alpha <= 0 or beta <= 0 or horizon <= 0:
        raise ValueError('weibull_alpha, weibull_beta, and horizon must be positive.')
    if preventive_interval is not None and float(preventive_interval) <= 0:
        raise ValueError('preventive_interval must be positive when supplied.')
    if not 0 <= q_cm <= 1 or not 0 <= q_pm <= 1:
        raise ValueError('Maintenance effectiveness q must be between 0 and 1.')
    if min(cost_CM, cost_PM, corrective_downtime, preventive_downtime) < 0:
        raise ValueError('Costs and downtime values must be non-negative.')
    if isinstance(n_simulations, bool) or int(n_simulations) != n_simulations:
        raise ValueError('n_simulations must be a positive integer.')
    n_simulations = int(n_simulations)
    if not 100 <= n_simulations <= 100_000:
        raise ValueError('n_simulations must be between 100 and 100000.')
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')
    if n_time_points < 2:
        raise ValueError('n_time_points must be at least 2.')

    interval = (None if preventive_interval is None
                else float(preventive_interval))
    rng = np.random.default_rng(seed)
    failures = np.zeros(n_simulations, dtype=int)
    preventive_actions = np.zeros(n_simulations, dtype=int)
    total_cost = np.zeros(n_simulations, dtype=float)
    availability = np.ones(n_simulations, dtype=float)
    downtime_total = np.zeros(n_simulations, dtype=float)
    time_grid = np.linspace(0.0, horizon, int(n_time_points))
    cumulative_failures = np.zeros((n_simulations, len(time_grid)), dtype=float)

    for simulation in range(n_simulations):
        calendar_time = 0.0
        virtual_age = 0.0
        next_pm = interval
        failure_times = []
        downtime = 0.0
        event_guard = 0

        while calendar_time < horizon:
            cumulative_hazard = (virtual_age / alpha) ** beta
            exponential_draw = rng.exponential()
            next_virtual_age = alpha * (
                cumulative_hazard + exponential_draw) ** (1.0 / beta)
            time_to_failure = max(
                next_virtual_age - virtual_age,
                np.finfo(float).eps * max(1.0, alpha),
            )
            failure_calendar_time = calendar_time + time_to_failure

            if (next_pm is not None and next_pm <= failure_calendar_time
                    and next_pm <= horizon):
                operating_time = max(0.0, next_pm - calendar_time)
                virtual_age += operating_time
                calendar_time = next_pm
                preventive_actions[simulation] += 1
                virtual_age = q_pm * virtual_age
                applied_downtime = min(preventive_downtime,
                                       max(0.0, horizon - calendar_time))
                downtime += applied_downtime
                calendar_time += applied_downtime
                while next_pm is not None and next_pm <= calendar_time:
                    next_pm += interval
            elif failure_calendar_time <= horizon:
                calendar_time = failure_calendar_time
                virtual_age = next_virtual_age
                failures[simulation] += 1
                failure_times.append(calendar_time)
                virtual_age = q_cm * virtual_age
                applied_downtime = min(corrective_downtime,
                                       max(0.0, horizon - calendar_time))
                downtime += applied_downtime
                calendar_time += applied_downtime
                while next_pm is not None and next_pm <= calendar_time:
                    next_pm += interval
            else:
                break

            event_guard += 1
            if event_guard > 1_000_000:
                raise RuntimeError(
                    'Virtual-age simulation exceeded one million events in a '
                    'replicate; check the horizon and Weibull parameters.')

        downtime_total[simulation] = downtime
        availability[simulation] = max(0.0, 1.0 - downtime / horizon)
        total_cost[simulation] = (
            failures[simulation] * cost_CM
            + preventive_actions[simulation] * cost_PM
        )
        if failure_times:
            cumulative_failures[simulation] = np.searchsorted(
                failure_times, time_grid, side='right')

    tail = (1.0 - CI) / 2.0

    def summary(values):
        values = np.asarray(values, dtype=float)
        return {
            'mean': float(np.mean(values)),
            'median': float(np.median(values)),
            'lower': float(np.quantile(values, tail)),
            'upper': float(np.quantile(values, 1.0 - tail)),
        }

    return {
        'model': 'kijima_type_ii_virtual_age',
        'analysis_basis': 'finite_horizon_monte_carlo',
        'horizon': horizon,
        'weibull_alpha': alpha,
        'weibull_beta': beta,
        'preventive_interval': interval,
        'repair_effectiveness': q_cm,
        'preventive_effectiveness': q_pm,
        'n_simulations': n_simulations,
        'CI': CI,
        'seed': seed,
        'failures': summary(failures),
        'preventive_actions': summary(preventive_actions),
        'total_cost': summary(total_cost),
        'availability': summary(availability),
        'downtime': summary(downtime_total),
        'curve': {
            'time': time_grid.tolist(),
            'mean_cumulative_failures': np.mean(
                cumulative_failures, axis=0).tolist(),
            'lower_cumulative_failures': np.quantile(
                cumulative_failures, tail, axis=0).tolist(),
            'upper_cumulative_failures': np.quantile(
                cumulative_failures, 1.0 - tail, axis=0).tolist(),
        },
        'assumptions': [
            'Baseline time to failure follows the supplied Weibull model.',
            'Kijima Type II sets post-maintenance virtual age to q times pre-maintenance virtual age.',
            'Preventive actions follow a fixed calendar schedule; downtime suspends aging.',
            'Replicates are independent and parameter uncertainty is not included.',
        ],
    }


# ── Rate of occurrence of failures (ROCOF) ───────────────────────────────────

def ROCOF(times_between_failures=None, failure_times=None, test_end=None,
          CI=0.95):
    """Rate of occurrence of failures with the Laplace trend test.

    Determines whether a repairable system's failure inter-arrival times show a
    statistically significant trend (improving, worsening, or none) using the
    Laplace centroid test, and, where a trend exists, fits a Power-Law NHPP.

    Parameters
    ----------
    times_between_failures : array-like, optional
        Failure inter-arrival times (gaps between successive failures).
    failure_times : array-like, optional
        Cumulative failure times (system ages). Provide this OR
        ``times_between_failures``.
    test_end : float, optional
        Total observation time. If omitted the test is treated as
        failure-terminated (ends at the last failure).
    CI : float, optional
        Confidence level for the two-sided trend test (default 0.95).

    Returns
    -------
    dict
        ``U`` (Laplace statistic), ``z_crit``, ``trend``
        ('improving' | 'worsening' | 'no trend'), ``p_value``, ``ROCOF``
        (constant estimate, when there is no trend), and ``Lambda_hat`` /
        ``Beta_hat`` (Power-Law NHPP parameters, when a trend exists).
    """
    from scipy import stats as ss

    if (times_between_failures is None) == (failure_times is None):
        raise ValueError('Provide exactly one of times_between_failures or '
                         'failure_times.')

    if times_between_failures is not None:
        gaps = np.asarray(times_between_failures, dtype=float)
        if np.any(gaps <= 0):
            raise ValueError('times_between_failures must all be positive.')
        t = np.cumsum(gaps)
    else:
        t = _validate_times(failure_times)

    n = len(t)
    if n < 2:
        raise ValueError('At least 2 failures are required.')

    if test_end is None:
        failure_terminated = True
        T = t[-1]
        event_times = t[:-1]      # last event defines T; exclude from centroid
        m = n - 1
    else:
        failure_terminated = False
        T = float(test_end)
        if T < t[-1]:
            raise ValueError('test_end must be >= the last failure time.')
        event_times = t
        m = n

    if m < 1:
        raise ValueError('Not enough failures for a trend test.')

    # Laplace centroid statistic; ~N(0,1) under a homogeneous Poisson process.
    U = (np.sum(event_times) - m * T / 2.0) / (T * np.sqrt(m / 12.0))
    z_crit = float(ss.norm.ppf(1 - (1 - CI) / 2.0))
    p_value = float(2 * ss.norm.sf(abs(U)))

    out = {
        'U': float(U),
        'z_crit': z_crit,
        'p_value': p_value,
        'CI': CI,
        'n_failures': n,
        'test_end': T,
        'failure_terminated': failure_terminated,
        'ROCOF': None,
        'Lambda_hat': None,
        'Beta_hat': None,
    }

    if abs(U) <= z_crit:
        # No significant trend: ROCOF is constant, estimated as n / T.
        out['trend'] = 'no trend'
        out['ROCOF'] = float(n / T)
    else:
        # Significant trend: fit Power-Law NHPP (same MLE as Crow-AMSAA).
        # U < 0 means the failure inter-arrival times are lengthening (the
        # system is improving / ROCOF decreasing); U > 0 is the reverse.
        out['trend'] = 'improving' if U < 0 else 'worsening'
        if failure_terminated:
            log_sum = np.sum(np.log(T / t[:-1]))
        else:
            log_sum = np.sum(np.log(T / t))
        if log_sum > 0:
            Beta_hat = n / log_sum
            out['Beta_hat'] = float(Beta_hat)
            out['Lambda_hat'] = float(n / T ** Beta_hat)
    return out


# ── Mean Cumulative Function (MCF) ───────────────────────────────────────────

def _mcf_prepare(data=None, observation_ends=None, records=None):
    """Validate recurrent-event histories with explicit censoring semantics.

    Supply either ``data`` (event-time lists) plus one ``observation_ends``
    value per system, or long-form ``records`` containing ``system_id``,
    ``time``, and an explicit ``status`` of ``"event"`` or ``"censor"``.
    A recurrence tied with the observation end is retained and evaluated
    before the unit leaves the risk set.
    """
    if records is not None and (data is not None or observation_ends is not None):
        raise ValueError('Supply either records or data+observation_ends, not both.')

    systems = []
    if records is not None:
        if len(records) < 1:
            raise ValueError('records must contain at least one observation.')
        grouped = {}
        for record in records:
            item = dict(record)
            if 'system_id' not in item or 'time' not in item or 'status' not in item:
                raise ValueError(
                    'Each MCF record requires system_id, time, and status.')
            system_id = str(item['system_id'])
            time = float(item['time'])
            status = str(item['status']).strip().lower()
            if not np.isfinite(time) or time < 0:
                raise ValueError('All event and censor times must be finite and non-negative.')
            if status not in {'event', 'censor'}:
                raise ValueError("MCF record status must be 'event' or 'censor'.")
            history = grouped.setdefault(system_id, {'events': [], 'censors': []})
            if status == 'event':
                count = int(item.get('count', 1))
                if count < 1:
                    raise ValueError('MCF event counts must be positive integers.')
                history['events'].extend([time] * count)
            else:
                history['censors'].append(time)
        for system_id, history in grouped.items():
            if len(history['censors']) != 1:
                raise ValueError(
                    f"System {system_id!r} requires exactly one censor record; "
                    f"found {len(history['censors'])}.")
            censor = history['censors'][0]
            repairs = np.sort(np.asarray(history['events'], dtype=float))
            if len(repairs) and repairs[-1] > censor:
                raise ValueError(
                    f"System {system_id!r} has an event after its censor time.")
            systems.append((repairs, float(censor)))
        return systems

    if data is None or len(data) < 1:
        raise ValueError('data must contain at least one system.')
    if observation_ends is None:
        raise ValueError(
            'observation_ends is required. The last event time is no longer '
            'silently treated as censoring; provide each system end explicitly.')
    if len(observation_ends) != len(data):
        raise ValueError('observation_ends must have one value per system.')

    for index, (row, end) in enumerate(zip(data, observation_ends)):
        repairs = np.asarray(row, dtype=float)
        if repairs.ndim != 1:
            raise ValueError('Each system event history must be one-dimensional.')
        censor = float(end)
        if (not np.isfinite(censor)) or censor < 0:
            raise ValueError('Observation ends must be finite and non-negative.')
        if np.any(~np.isfinite(repairs)) or np.any(repairs < 0):
            raise ValueError('All event times must be finite and non-negative.')
        repairs = np.sort(repairs)
        if len(repairs) and repairs[-1] > censor:
            raise ValueError(
                f'System {index + 1} has an event after its observation end.')
        systems.append((repairs, censor))
    return systems


def _mcf_estimate(systems, event_times=None, include_variance=True):
    """Nelson MCF and Lawless-Nadeau subject-cluster robust variance."""
    n_systems = len(systems)
    censor_times = np.array([censor for _, censor in systems], dtype=float)
    if event_times is None:
        all_repairs = np.concatenate([repairs for repairs, _ in systems]) if any(
            len(repairs) for repairs, _ in systems) else np.array([])
        event_times = np.unique(all_repairs)
    else:
        event_times = np.asarray(event_times, dtype=float)

    mcf = 0.0
    influence = np.zeros(n_systems, dtype=float)
    mcf_out, variance_out, risk_out, event_count_out = [], [], [], []
    for time in event_times:
        at_risk_indicators = (censor_times >= time).astype(float)
        at_risk = int(np.sum(at_risk_indicators))
        if at_risk == 0:
            mcf_out.append(np.nan)
            variance_out.append(np.nan)
            risk_out.append(0)
            event_count_out.append(0)
            continue
        subject_events = np.array([
            int(np.sum(repairs == time)) for repairs, _ in systems
        ], dtype=float)
        events = int(np.sum(subject_events))
        increment = events / at_risk
        mcf += increment
        if include_variance:
            # Subject-cluster influence process for the Nelson estimator.
            # With equal complete follow-up this reduces exactly to the sample
            # variance of subject cumulative counts divided by n.
            influence += (
                subject_events - at_risk_indicators * increment
            ) / at_risk
            variance = (
                n_systems / (n_systems - 1.0) * float(np.sum(influence ** 2))
                if n_systems > 1 else np.nan
            )
        else:
            variance = np.nan
        mcf_out.append(float(mcf))
        variance_out.append(float(variance))
        risk_out.append(at_risk)
        event_count_out.append(events)
    return {
        'time': np.asarray(event_times, dtype=float),
        'MCF': np.asarray(mcf_out, dtype=float),
        'variance': np.asarray(variance_out, dtype=float),
        'at_risk': np.asarray(risk_out, dtype=int),
        'events_at_time': np.asarray(event_count_out, dtype=int),
    }


def MCF_nonparametric(data=None, CI=0.95, observation_ends=None, records=None,
                      interval_method='log_transformed', bootstrap_samples=0,
                      seed=None):
    """Non-parametric Mean Cumulative Function (Nelson estimator).

    Estimates the average cumulative number of recurrences (e.g. repairs) per
    system as a function of time, with confidence bounds. Applicable to
    repairable systems where each recurrence is treated as identical.

    Parameters
    ----------
    data : list of lists
        Event times per system. ``observation_ends`` is mandatory with this
        representation; an event may equal its observation end.
    observation_ends : list of float
        Explicit end-of-observation time for every system in ``data``.
    records : list of mappings, optional
        Long-form alternative with ``system_id``, ``time``, and explicit
        ``status`` (``event`` or ``censor``).
    CI : float, optional
        Confidence level for the bounds (default 0.95).

    Returns
    -------
    dict
        ``time``, ``MCF``, ``MCF_lower``, ``MCF_upper`` arrays, plus the
        ``variance`` at each event time.
    """
    from scipy import stats as ss

    CI = float(CI)
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')
    if interval_method not in {'log_transformed', 'cluster_bootstrap'}:
        raise ValueError(
            "interval_method must be 'log_transformed' or 'cluster_bootstrap'.")
    if isinstance(bootstrap_samples, bool) or int(bootstrap_samples) != bootstrap_samples:
        raise ValueError('bootstrap_samples must be a non-negative integer.')
    bootstrap_samples = int(bootstrap_samples)
    if bootstrap_samples and bootstrap_samples < 50:
        raise ValueError('At least 50 cluster bootstrap samples are required.')

    systems = _mcf_prepare(
        data=data, observation_ends=observation_ends, records=records)
    estimate = _mcf_estimate(systems)
    event_times = estimate['time']
    if len(event_times) == 0:
        raise ValueError('No repair events found (every system has only a '
                         'censoring time).')
    z = float(ss.norm.ppf(1 - (1 - CI) / 2.0))
    mcf_values = estimate['MCF']
    standard_errors = np.sqrt(estimate['variance'])
    lower = np.array(mcf_values, copy=True)
    upper = np.array(mcf_values, copy=True)
    valid = ((mcf_values > 0) & np.isfinite(standard_errors)
             & (standard_errors > 0))
    log_half_width = np.zeros_like(mcf_values)
    log_half_width[valid] = z * standard_errors[valid] / mcf_values[valid]
    lower[valid] = mcf_values[valid] * np.exp(-log_half_width[valid])
    upper[valid] = mcf_values[valid] * np.exp(log_half_width[valid])

    bootstrap = None
    if bootstrap_samples:
        rng = np.random.default_rng(seed)
        n_systems = len(systems)
        samples = np.full((bootstrap_samples, len(event_times)), np.nan)
        for sample_index in range(bootstrap_samples):
            selected = rng.integers(0, n_systems, size=n_systems)
            resampled = [systems[index] for index in selected]
            samples[sample_index] = _mcf_estimate(
                resampled, event_times=event_times,
                include_variance=False)['MCF']
        alpha = 1.0 - CI
        with np.errstate(invalid='ignore'):
            boot_lower = np.nanquantile(samples, alpha / 2.0, axis=0)
            boot_upper = np.nanquantile(samples, 1.0 - alpha / 2.0, axis=0)
            boot_se = np.nanstd(samples, axis=0, ddof=1)
        valid_replicates = np.sum(np.isfinite(samples), axis=0)
        bootstrap = {
            'samples': bootstrap_samples,
            'seed': seed,
            'lower': boot_lower.tolist(),
            'upper': boot_upper.tolist(),
            'standard_error': boot_se.tolist(),
            'valid_replicates': valid_replicates.astype(int).tolist(),
            'resampling_unit': 'system_history_cluster',
        }
        if interval_method == 'cluster_bootstrap':
            lower, upper = boot_lower, boot_upper

    at_risk = estimate['at_risk']
    tail_threshold = max(3, int(math.ceil(0.2 * len(systems))))
    sparse_tail = at_risk < tail_threshold

    return {
        'time': event_times.tolist(),
        'MCF': mcf_values.tolist(),
        'MCF_lower': lower.tolist(),
        'MCF_upper': upper.tolist(),
        'variance': estimate['variance'].tolist(),
        'standard_error': standard_errors.tolist(),
        'at_risk': at_risk.tolist(),
        'events_at_time': estimate['events_at_time'].tolist(),
        'CI': CI,
        'variance_method': 'nelson_lawless_nadeau_subject_robust',
        'interval_method': interval_method,
        'bootstrap': bootstrap,
        'n_systems': len(systems),
        'n_events': int(sum(len(repairs) for repairs, _ in systems)),
        'tail_risk_threshold': tail_threshold,
        'sparse_tail': sparse_tail.tolist(),
        'tail_warning': (
            f'Effective risk set falls below {tail_threshold} systems in the '
            'right tail; interpret tail estimates and intervals cautiously.'
            if np.any(sparse_tail) else None
        ),
        'data_contract': ('explicit_status_records' if records is not None
                          else 'explicit_event_times_and_observation_ends'),
    }


def MCF_parametric(data=None, CI=0.95, observation_ends=None, records=None):
    """Parametric (Power-Law) Mean Cumulative Function.

    Fits ``MCF(t) = (t / alpha) ** beta`` by the pooled NHPP power-law
    **maximum likelihood** estimator across all systems (the multi-system
    Crow-AMSAA MLE): ``beta = N / sum_k sum_i ln(T_k / t_ki)`` and alpha such
    that the expected events per system at the censoring times equal N.
    (The previous log-log OLS on the non-parametric MCF points is
    heteroscedastic and autocorrelated — the MLE is the standard estimator.)
    A beta < 1 indicates an improving system (repairs becoming less
    frequent), beta = 1 a constant rate, and beta > 1 a worsening system.

    Parameters
    ----------
    data : list of lists
        Event-time lists; pair with explicit ``observation_ends``.
    observation_ends : list of float
        Explicit end-of-observation time for each system.
    records : list of mappings, optional
        Long-form event/censor alternative accepted by
        :func:`MCF_nonparametric`.
    CI : float, optional
        Confidence level passed through to the non-parametric estimate.

    Returns
    -------
    dict
        ``alpha``, ``beta``, ``r_squared`` (descriptive agreement with the
        non-parametric MCF in log-log space), the fitted ``time`` / ``MCF``
        arrays, and the underlying non-parametric estimate under ``np``.
    """
    npest = MCF_nonparametric(
        data=data, observation_ends=observation_ends, CI=CI, records=records)
    systems = _mcf_prepare(
        data=data, observation_ends=observation_ends, records=records)

    # Pooled NHPP power-law MLE (time-terminated per system at T_k).
    log_sum = 0.0
    n_events = 0
    for repairs, censor in systems:
        pos = repairs[repairs > 0]
        if censor <= 0:
            continue
        n_events += len(pos)
        if len(pos) > 0:
            log_sum += float(np.sum(np.log(censor / pos)))
    if n_events < 2 or log_sum <= 0:
        raise ValueError('Not enough repair events to fit a power law.')
    beta = n_events / log_sum
    sum_T_beta = float(np.sum([c ** beta for _, c in systems if c > 0]))
    # E[events per system] at the censor times: sum_k (T_k/alpha)^beta = N
    alpha = float((sum_T_beta / n_events) ** (1.0 / beta))

    # Descriptive agreement with the non-parametric MCF (log-log space).
    t = np.asarray(npest['time'], dtype=float)
    mcf = np.asarray(npest['MCF'], dtype=float)
    mask = (t > 0) & (mcf > 0)
    if np.sum(mask) >= 2:
        log_t = np.log(t[mask])
        log_mcf = np.log(mcf[mask])
        pred = beta * (log_t - np.log(alpha))
        ss_res = np.sum((log_mcf - pred) ** 2)
        ss_tot = np.sum((log_mcf - np.mean(log_mcf)) ** 2)
        r_squared = float(1 - ss_res / ss_tot) if ss_tot > 0 else 1.0
    else:
        r_squared = np.nan

    t_pos = t[mask] if np.sum(mask) >= 2 else np.array([alpha * 0.1, alpha])
    t_fit = np.linspace(float(t_pos.min()), float(t_pos.max()), 100)
    mcf_fit = (t_fit / alpha) ** beta

    return {
        'alpha': alpha,
        'beta': float(beta),
        'r_squared': r_squared,
        'time': t_fit.tolist(),
        'MCF': mcf_fit.tolist(),
        'np': npest,
        'CI': CI,
    }
