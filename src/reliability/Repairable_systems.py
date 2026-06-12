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
