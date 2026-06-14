"""
Repairable systems / reliability growth analysis.

Provides the Crow-AMSAA (NHPP power law) model fitted by maximum
likelihood, and the Duane graphical (regression) method, for analysing
reliability growth of repairable systems from cumulative failure times.
"""

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

        # Cramer-von Mises goodness of fit statistic
        if failure_terminated:
            beta_bar = (n - 1) / n * beta
            M = n - 1
            cvm_times = times[:-1]
        else:
            beta_bar = beta
            M = n
            cvm_times = times
        i = np.arange(1, M + 1)
        self.CvM = (1 / (12 * M)
                    + np.sum(((cvm_times / T) ** beta_bar
                              - (2 * i - 1) / (2 * M)) ** 2))

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
        Instantaneous (demonstrated) MTBF at T: DMTBF_C / (1 - alpha).
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
        self.DMTBF_I = self.DMTBF_C / (1 - alpha)

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
        out = self.A * t ** self.alpha / (1 - self.alpha)
        return out.item() if out.ndim == 0 else out

    def __repr__(self):
        return (f'Duane(n={self.n}, T={self.T:g}, alpha={self.alpha:.4f}, '
                f'A={self.A:.6g}, r_squared={self.r_squared:.4f}, '
                f'DMTBF_I={self.DMTBF_I:.4f})')


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
        Maintenance/renewal assumption. ``0`` (default) = "as good as new"
        (the replacement renews the item, HPP renewal model). ``1`` =
        "as good as old" (minimal repair, Power-Law NHPP).
    t_max : float, optional
        Upper bound of the search range. Defaults to 3 * alpha.
    n_points : int, optional
        Number of grid points used for the search.

    Returns
    -------
    dict
        ``optimal_replacement_time``, ``min_cost`` (cost per unit time at the
        optimum), ``cost_PM_per_unit_time`` (the corrective-only baseline),
        ``time`` and ``cost`` arrays for plotting, and ``q``.
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

    if t_max is None:
        t_max = 3.0 * alpha
    t = np.linspace(t_max / n_points, t_max, n_points)

    if q == 1:
        # As good as old (minimal repair, NHPP): expected number of failures in
        # (0, t] is the cumulative hazard H(t) = (t/alpha)^beta.
        H = (t / alpha) ** beta
        cost_per_time = (cost_PM + cost_CM * H) / t
    else:
        # As good as new (renewal): cost per unit time =
        #   (cost_PM * R(t) + cost_CM * F(t)) / E[min(T, t)]
        # where E[min(T, t)] = integral_0^t R(s) ds.
        R = np.exp(-((t / alpha) ** beta))
        F = 1.0 - R
        dt = t[1] - t[0]
        # Cumulative integral of R from 0 to each t (trapezoidal).
        integral_R = np.cumsum(R) * dt
        integral_R[integral_R <= 0] = np.nan
        cost_per_time = (cost_PM * R + cost_CM * F) / integral_R

    idx = int(np.nanargmin(cost_per_time))
    return {
        'optimal_replacement_time': float(t[idx]),
        'min_cost': float(cost_per_time[idx]),
        # Baseline: always running to failure (corrective only).
        'cost_PM_per_unit_time': float(cost_CM / (alpha)),
        'time': t.tolist(),
        'cost': [None if not np.isfinite(c) else float(c) for c in cost_per_time],
        'q': q,
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

def _mcf_prepare(data):
    """Validate MCF input and split each system into repairs + censoring time.

    ``data`` is a list of per-system event lists. Within each system the
    largest time is treated as the end-of-observation (censoring) time and the
    remaining (smaller) times are repair events.
    """
    if data is None or len(data) < 1:
        raise ValueError('data must contain at least one system.')
    systems = []
    for row in data:
        times = np.asarray(row, dtype=float)
        if times.ndim != 1 or len(times) < 1:
            raise ValueError('Each system must be a non-empty list of times.')
        if np.any(times < 0):
            raise ValueError('All times must be non-negative.')
        censor = float(np.max(times))
        repairs = np.sort(times[times < censor])
        systems.append((repairs, censor))
    return systems


def MCF_nonparametric(data, CI=0.95):
    """Non-parametric Mean Cumulative Function (Nelson estimator).

    Estimates the average cumulative number of recurrences (e.g. repairs) per
    system as a function of time, with confidence bounds. Applicable to
    repairable systems where each recurrence is treated as identical.

    Parameters
    ----------
    data : list of lists
        One list of event times per system. Within each system the largest
        value is taken as the end-of-observation (censoring) time and the
        smaller values are repair times.
    CI : float, optional
        Confidence level for the bounds (default 0.95).

    Returns
    -------
    dict
        ``time``, ``MCF``, ``MCF_lower``, ``MCF_upper`` arrays, plus the
        ``variance`` at each event time.
    """
    from scipy import stats as ss

    systems = _mcf_prepare(data)
    censor_times = np.array([c for _, c in systems], dtype=float)

    # All unique repair times across all systems.
    all_repairs = np.concatenate([r for r, _ in systems]) if any(
        len(r) for r, _ in systems) else np.array([])
    if len(all_repairs) == 0:
        raise ValueError('No repair events found (every system has only a '
                         'censoring time).')
    event_times = np.unique(all_repairs)

    z = float(ss.norm.ppf(1 - (1 - CI) / 2.0))
    mcf = 0.0
    var = 0.0
    times_out, mcf_out, lo_out, hi_out, var_out = [], [], [], [], []

    for tk in event_times:
        # Risk set: systems still under observation at tk (censor >= tk).
        at_risk = int(np.sum(censor_times >= tk))
        if at_risk == 0:
            continue
        # Number of repairs occurring exactly at tk across all systems.
        d = int(sum(int(np.sum(r == tk)) for r, _ in systems))
        increment = d / at_risk
        mcf += increment
        # Pointwise variance via the standard binomial-increment recurrence.
        var += increment * (1 - increment) / at_risk
        sd = np.sqrt(var)
        # Log-transformed bounds keep the MCF bounds positive.
        if mcf > 0 and sd > 0:
            w = np.exp(z * sd / mcf)
            lo, hi = mcf / w, mcf * w
        else:
            lo, hi = mcf, mcf
        times_out.append(float(tk))
        mcf_out.append(float(mcf))
        lo_out.append(float(lo))
        hi_out.append(float(hi))
        var_out.append(float(var))

    return {
        'time': times_out,
        'MCF': mcf_out,
        'MCF_lower': lo_out,
        'MCF_upper': hi_out,
        'variance': var_out,
        'CI': CI,
    }


def MCF_parametric(data, CI=0.95):
    """Parametric (Power-Law) Mean Cumulative Function.

    Fits ``MCF(t) = (t / alpha) ** beta`` to the non-parametric MCF by linear
    regression of ``log(MCF)`` on ``log(t)``. A beta < 1 indicates an improving
    system (repairs becoming less frequent), beta = 1 a constant rate, and
    beta > 1 a worsening system.

    Parameters
    ----------
    data : list of lists
        Same format as :func:`MCF_nonparametric`.
    CI : float, optional
        Confidence level passed through to the non-parametric estimate.

    Returns
    -------
    dict
        ``alpha``, ``beta``, ``r_squared``, the fitted ``time`` / ``MCF``
        arrays, and the underlying non-parametric estimate under ``np``.
    """
    npest = MCF_nonparametric(data, CI=CI)
    t = np.asarray(npest['time'], dtype=float)
    mcf = np.asarray(npest['MCF'], dtype=float)
    mask = (t > 0) & (mcf > 0)
    if np.sum(mask) < 2:
        raise ValueError('Not enough positive MCF points to fit a power law.')
    log_t = np.log(t[mask])
    log_mcf = np.log(mcf[mask])
    # log(MCF) = beta * log(t) - beta * log(alpha)
    beta, intercept = np.polyfit(log_t, log_mcf, 1)
    alpha = float(np.exp(-intercept / beta)) if beta != 0 else np.nan

    pred = beta * log_t + intercept
    ss_res = np.sum((log_mcf - pred) ** 2)
    ss_tot = np.sum((log_mcf - np.mean(log_mcf)) ** 2)
    r_squared = float(1 - ss_res / ss_tot) if ss_tot > 0 else 1.0

    t_fit = np.linspace(t[mask].min(), t[mask].max(), 100)
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
