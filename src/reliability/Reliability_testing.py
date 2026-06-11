"""
Reliability demonstration test (RDT) planning.

Implements binomial reliability demonstration test calculators:

- Method 1 (non-parametric): solve the binomial equation
  ``1 - C >= sum_{i=0}^{f} C(n,i) (1-R)^i R^(n-i)`` for the smallest
  sample size n that demonstrates reliability R at confidence C with
  up to f allowable failures.
- Method 2A (parametric, solve samples): use a Weibull distribution with
  known shape beta to translate a reliability requirement at mission time
  into the reliability demonstrated by a shorter (or longer) test time,
  then solve Method 1 at that test reliability.
- Method 2B (parametric, solve test time): given a fixed sample size,
  invert the binomial equation for the demonstrable reliability and map
  it back to the required test duration on the Weibull curve.

Also provides the operating characteristic (OC) curve: the probability of
passing the test as a function of the true reliability.

References: MIL-HDBK-338, NIST/SEMATECH e-Handbook section 8.3.1.
"""

import numpy as np
from scipy import stats as ss


def _validate_common(reliability, CI, failures):
    if not 0 < reliability < 1:
        raise ValueError("reliability must be between 0 and 1 (exclusive)")
    if not 0 < CI < 1:
        raise ValueError("CI must be between 0 and 1 (exclusive)")
    if failures < 0 or int(failures) != failures:
        raise ValueError("failures must be a non-negative integer")


def sample_size_binomial(reliability, CI=0.90, failures=0):
    """Method 1: non-parametric binomial RDT sample size.

    Smallest n such that ``binom.cdf(failures, n, 1-reliability) <= 1-CI``,
    i.e. the test (pass if at most ``failures`` units fail) demonstrates
    ``reliability`` at confidence ``CI``.

    Parameters
    ----------
    reliability : float
        Reliability to demonstrate (0 < R < 1).
    CI : float
        Confidence level (0 < C < 1). Default 0.90.
    failures : int
        Number of allowable test failures. Default 0.

    Returns
    -------
    int
        Required sample size n.
    """
    _validate_common(reliability, CI, failures)
    f = int(failures)
    alpha = 1 - CI
    q = 1 - reliability

    # Zero-failure closed form: R^n <= 1-C
    n0 = int(np.ceil(np.log(alpha) / np.log(reliability)))
    if f == 0:
        return max(n0, 1)

    # binom.cdf(f, n, q) is decreasing in n: bracket then bisect
    lo = max(f + 1, n0)
    hi = lo
    while ss.binom.cdf(f, hi, q) > alpha:
        hi *= 2
        if hi > 1e9:
            raise ValueError("required sample size exceeds 1e9; "
                             "check reliability/CI inputs")
    while lo < hi:
        mid = (lo + hi) // 2
        if ss.binom.cdf(f, mid, q) <= alpha:
            hi = mid
        else:
            lo = mid + 1
    return int(lo)


def weibull_eta_from_requirement(R_rqmt, T_mission, beta):
    """Weibull characteristic life implied by a reliability requirement.

    Solves ``R_rqmt = exp(-(T_mission/eta)^beta)`` for eta.
    """
    if not 0 < R_rqmt < 1:
        raise ValueError("R_rqmt must be between 0 and 1 (exclusive)")
    if T_mission <= 0:
        raise ValueError("T_mission must be > 0")
    if beta <= 0:
        raise ValueError("beta must be > 0")
    return T_mission / (-np.log(R_rqmt)) ** (1.0 / beta)


def parametric_binomial_sample_size(R_rqmt, T_mission, beta, T_test,
                                    CI=0.90, failures=0):
    """Method 2A: parametric binomial RDT — solve for sample size.

    Demonstrating ``R_test`` (the Weibull reliability at ``T_test``) is
    equivalent to demonstrating ``R_rqmt`` at ``T_mission`` provided the
    shape parameter ``beta`` is accurate.

    Returns
    -------
    dict
        ``{'eta': float, 'R_test': float, 'n': int}``
    """
    if T_test <= 0:
        raise ValueError("T_test must be > 0")
    eta = weibull_eta_from_requirement(R_rqmt, T_mission, beta)
    R_test = float(np.exp(-(T_test / eta) ** beta))
    n = sample_size_binomial(R_test, CI=CI, failures=failures)
    return {'eta': float(eta), 'R_test': R_test, 'n': n}


def parametric_binomial_test_time(R_rqmt, T_mission, beta, n,
                                  CI=0.90, failures=0):
    """Method 2B: parametric binomial RDT — solve for test time.

    Given ``n`` samples and ``failures`` allowable failures, the highest
    demonstrable reliability is the exact binomial inversion
    ``R_test = beta.ppf(1-CI, n-f, f+1)`` (for f=0 this is (1-CI)^(1/n)).
    The required test duration is then read off the Weibull curve.

    Returns
    -------
    dict
        ``{'eta': float, 'R_test': float, 'T_test': float}``
    """
    f = int(failures)
    if f < 0 or failures != f:
        raise ValueError("failures must be a non-negative integer")
    if n < f + 1 or int(n) != n:
        raise ValueError("n must be an integer >= failures + 1")
    if not 0 < CI < 1:
        raise ValueError("CI must be between 0 and 1 (exclusive)")
    eta = weibull_eta_from_requirement(R_rqmt, T_mission, beta)
    R_test = float(ss.beta.ppf(1 - CI, int(n) - f, f + 1))
    T_test = float(eta * (-np.log(R_test)) ** (1.0 / beta))
    return {'eta': float(eta), 'R_test': R_test, 'T_test': T_test}


def binomial_oc_curve(n, failures=0, R_values=None, num_points=200):
    """Operating characteristic curve for a binomial RDT.

    P(pass) = P(at most ``failures`` failures in ``n`` trials)
            = ``binom.cdf(failures, n, 1-R_true)``.

    Parameters
    ----------
    n : int
        Sample size.
    failures : int
        Allowable failures.
    R_values : array-like, optional
        True-reliability values. Defaults to an adaptive range covering
        P(pass) from ~0.5% up to 1.

    Returns
    -------
    (ndarray, ndarray)
        (R_values, P_accept)
    """
    f = int(failures)
    n = int(n)
    if n < f + 1:
        raise ValueError("n must be >= failures + 1")
    if R_values is None:
        # Start where P(accept) ~ 0.005 so the curve shows its full sweep
        R_low = float(1 - ss.beta.ppf(0.995, f + 1, n - f))
        R_values = np.linspace(max(0.0, R_low), 1.0, num_points)
    else:
        R_values = np.asarray(R_values, dtype=float)
    P_accept = ss.binom.cdf(f, n, 1 - R_values)
    return R_values, np.asarray(P_accept, dtype=float)
