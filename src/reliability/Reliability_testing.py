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


# ── Proportion tests ─────────────────────────────────────────────────────────

def one_sample_proportion(trials, successes, CI=0.95):
    """Exact (Clopper-Pearson) confidence interval for a proportion.

    Given a reliability demonstration where ``successes`` of ``trials`` units
    pass, returns the two-sided exact confidence interval for the underlying
    success probability (reliability).

    Parameters
    ----------
    trials : int
        Total number of units tested.
    successes : int
        Number of units that passed (0 <= successes <= trials).
    CI : float
        Confidence level (default 0.95).

    Returns
    -------
    dict
        ``proportion`` (point estimate), ``lower``, ``upper``, ``trials``,
        ``successes``.
    """
    n, x = int(trials), int(successes)
    if n <= 0:
        raise ValueError("trials must be > 0")
    if not 0 <= x <= n:
        raise ValueError("successes must be between 0 and trials")
    alpha = 1 - CI
    lower = 0.0 if x == 0 else float(ss.beta.ppf(alpha / 2, x, n - x + 1))
    upper = 1.0 if x == n else float(ss.beta.ppf(1 - alpha / 2, x + 1, n - x))
    return {
        "proportion": x / n,
        "lower": lower,
        "upper": upper,
        "trials": n,
        "successes": x,
        "CI": CI,
    }


def two_proportion_test(trials_1, successes_1, trials_2, successes_2, CI=0.95):
    """Two-sided z-test comparing two independent proportions.

    Tests the null hypothesis that two samples share the same underlying
    success probability (e.g. comparing the reliability of two designs).

    Returns
    -------
    dict
        ``p1``, ``p2``, ``difference``, ``z``, ``p_value``, and ``different``
        (True if the proportions differ significantly at the given CI).
    """
    n1, x1, n2, x2 = int(trials_1), int(successes_1), int(trials_2), int(successes_2)
    for n, x in ((n1, x1), (n2, x2)):
        if n <= 0:
            raise ValueError("trials must be > 0")
        if not 0 <= x <= n:
            raise ValueError("successes must be between 0 and trials")
    p1, p2 = x1 / n1, x2 / n2
    p_pool = (x1 + x2) / (n1 + n2)
    se = np.sqrt(p_pool * (1 - p_pool) * (1 / n1 + 1 / n2))
    z = 0.0 if se == 0 else (p1 - p2) / se
    p_value = float(2 * ss.norm.sf(abs(z)))
    return {
        "p1": p1, "p2": p2, "difference": p1 - p2,
        "z": float(z), "p_value": p_value,
        "different": bool(p_value < 1 - CI),
        "CI": CI,
    }


def sample_size_no_failures(reliability, CI=0.95, lifetimes=1.0, weibull_shape=1.0):
    """Sample size for a zero-failure reliability demonstration test.

    Uses the success-run theorem generalised to a Weibull lifetime: with no
    allowable failures, the number of units required to demonstrate
    ``reliability`` at confidence ``CI`` when each unit is tested for
    ``lifetimes`` mission-lives (Weibull shape ``weibull_shape``).

    Returns
    -------
    dict
        ``n`` (required sample size) and the inputs.
    """
    if not 0 < reliability < 1:
        raise ValueError("reliability must be between 0 and 1 (exclusive)")
    if not 0 < CI < 1:
        raise ValueError("CI must be between 0 and 1 (exclusive)")
    if lifetimes <= 0 or weibull_shape <= 0:
        raise ValueError("lifetimes and weibull_shape must be > 0")
    n = np.log(1 - CI) / (lifetimes ** weibull_shape * np.log(reliability))
    return {
        "n": int(np.ceil(n)),
        "reliability": reliability, "CI": CI,
        "lifetimes": lifetimes, "weibull_shape": weibull_shape,
    }


# ── Sequential sampling (Wald SPRT) ──────────────────────────────────────────

def sequential_sampling_chart(p1, p2, alpha, beta, max_samples=100):
    """Wald sequential probability ratio test (SPRT) accept/reject boundaries.

    Builds the acceptance and rejection boundary lines for a sequential
    binomial test discriminating between an acceptable fraction-defective
    ``p1`` (with producer's risk ``alpha``) and an unacceptable fraction
    ``p2`` (with consumer's risk ``beta``).

    Returns
    -------
    dict
        ``n`` (sample numbers), ``acceptance_line`` and ``rejection_line``
        (cumulative-defective boundaries), and the line parameters
        ``slope``, ``intercept_accept``, ``intercept_reject``.
    """
    if not (0 < p1 < p2 < 1):
        raise ValueError("Require 0 < p1 < p2 < 1.")
    if not (0 < alpha < 1 and 0 < beta < 1):
        raise ValueError("alpha and beta must be between 0 and 1.")
    g1 = np.log(p2 / p1)
    g2 = np.log((1 - p1) / (1 - p2))
    s = g2 / (g1 + g2)
    h_a = np.log((1 - alpha) / beta) / (g1 + g2)   # acceptance intercept
    h_r = np.log((1 - beta) / alpha) / (g1 + g2)   # rejection intercept
    n = np.arange(1, int(max_samples) + 1)
    acceptance = s * n - h_a
    rejection = s * n + h_r
    return {
        "n": n.tolist(),
        # Acceptance numbers below 0 are not meaningful (cannot accept yet).
        "acceptance_line": [None if v < 0 else float(v) for v in acceptance],
        "rejection_line": [float(v) for v in rejection],
        "slope": float(s),
        "intercept_accept": float(-h_a),
        "intercept_reject": float(h_r),
    }


# ── Exponential RDT planner (chi-squared) ────────────────────────────────────

def reliability_test_planner(MTBF=None, test_duration=None,
                             number_of_failures=None, CI=0.90,
                             two_sided=False):
    """Exponential reliability demonstration test planner.

    For a constant-failure-rate (exponential) test the one-sided lower
    confidence bound on the MTBF is ``2 * T / chi2.ppf(CI, 2f + 2)`` where
    ``T`` is the total test time and ``f`` the number of failures. Provide
    exactly two of ``MTBF`` / ``test_duration`` / ``number_of_failures`` and
    the third is solved for.

    Returns
    -------
    dict
        ``MTBF``, ``test_duration``, ``number_of_failures``, ``CI``.
    """
    provided = [MTBF is not None, test_duration is not None,
                number_of_failures is not None]
    if sum(provided) != 2:
        raise ValueError("Provide exactly two of MTBF, test_duration, "
                         "number_of_failures.")
    if not 0 < CI < 1:
        raise ValueError("CI must be between 0 and 1.")
    conf = (1 - (1 - CI) / 2) if two_sided else CI

    def chi2_factor(f):
        return ss.chi2.ppf(conf, 2 * f + 2)

    if MTBF is None:
        f = int(number_of_failures)
        MTBF = 2 * test_duration / chi2_factor(f)
    elif test_duration is None:
        f = int(number_of_failures)
        test_duration = MTBF * chi2_factor(f) / 2
    else:
        # Solve for the smallest integer number of failures consistent with
        # the required MTBF lower bound over the given test duration.
        f = 0
        while 2 * test_duration / chi2_factor(f) < MTBF:
            f += 1
            if f > 100000:
                raise ValueError("number_of_failures exceeds 1e5; check inputs.")
        number_of_failures = f
    return {
        "MTBF": float(MTBF),
        "test_duration": float(test_duration),
        "number_of_failures": int(number_of_failures),
        "CI": CI,
    }


def reliability_test_duration(MTBF_required, MTBF_design,
                              consumer_risk, producer_risk,
                              max_failures=200):
    """Fixed-length exponential test duration meeting both risks.

    Finds the smallest number of allowable failures and corresponding test
    duration (in time units) such that a fixed-length exponential test
    accepts a design with true MTBF ``MTBF_design`` with at least
    ``1 - producer_risk`` probability while accepting a design at the
    ``MTBF_required`` threshold with at most ``consumer_risk`` probability.

    Returns
    -------
    dict
        ``test_duration``, ``number_of_failures`` (allowable), and the inputs.
    """
    if MTBF_design <= MTBF_required:
        raise ValueError("MTBF_design must exceed MTBF_required.")
    if not (0 < consumer_risk < 1 and 0 < producer_risk < 1):
        raise ValueError("Risks must be between 0 and 1.")

    best = None
    for f in range(0, int(max_failures) + 1):
        # Smallest mean (expected failures at MTBF_required) with
        # P(N <= f) <= consumer_risk  =>  use the chi-squared inverse.
        mu_required = ss.chi2.ppf(1 - consumer_risk, 2 * f + 2) / 2.0
        T = mu_required * MTBF_required
        # Producer's risk check at the design MTBF.
        mu_design = T / MTBF_design
        prod = float(ss.poisson.sf(f, mu_design))  # P(reject) = P(N > f)
        if prod <= producer_risk:
            best = {"test_duration": float(T), "number_of_failures": int(f)}
            break
    if best is None:
        raise ValueError("No solution within max_failures; relax the risks "
                         "or increase the discrimination ratio.")
    best.update(MTBF_required=MTBF_required, MTBF_design=MTBF_design,
                consumer_risk=consumer_risk, producer_risk=producer_risk)
    return best


# ── Goodness-of-fit tests ────────────────────────────────────────────────────

def chi_squared_test(distribution, failures, bins=None, CI=0.95):
    """Chi-squared goodness-of-fit test for a fitted distribution.

    Parameters
    ----------
    distribution : object
        A distribution exposing ``_cdf(x)`` and ``num_params``.
    failures : array-like
        Observed failure times.
    bins : int, optional
        Number of bins (default: Sturges' rule).
    CI : float
        Confidence level for the critical value (default 0.95).

    Returns
    -------
    dict
        ``statistic``, ``critical_value``, ``p_value``, ``bins``, ``df``,
        and ``hypothesis`` ('accept' if the fit is adequate).
    """
    x = np.sort(np.asarray(failures, dtype=float))
    n = len(x)
    if n < 5:
        raise ValueError("At least 5 failures are required for a chi-squared test.")
    if bins is None:
        bins = max(3, int(np.ceil(1 + np.log2(n))))  # Sturges' rule

    # Equal-probability bin edges from the fitted distribution, so each bin has
    # the same expected count n/bins (standard chi-squared GoF construction).
    if hasattr(distribution, "quantile"):
        inner = [float(distribution.quantile(q))
                 for q in np.linspace(0, 1, bins + 1)[1:-1]]
        edges = np.array([-np.inf, *inner, np.inf])
        expected = np.full(bins, n / bins)
    else:
        edges = np.linspace(x.min(), x.max(), bins + 1)
        cdf_edges = distribution._cdf(edges)
        cdf_edges[0], cdf_edges[-1] = 0.0, 1.0
        expected = n * np.diff(cdf_edges)
    expected = np.clip(expected, 1e-9, None)

    observed, _ = np.histogram(x, bins=edges)

    statistic = float(np.sum((observed - expected) ** 2 / expected))
    n_params = int(getattr(distribution, "num_params", 2))
    df = max(1, bins - 1 - n_params)
    critical = float(ss.chi2.ppf(CI, df))
    p_value = float(ss.chi2.sf(statistic, df))
    return {
        "statistic": statistic,
        "critical_value": critical,
        "p_value": p_value,
        "bins": int(bins),
        "df": int(df),
        "hypothesis": "accept" if statistic < critical else "reject",
        "CI": CI,
    }


def KS_test(distribution, failures, CI=0.95):
    """Kolmogorov-Smirnov goodness-of-fit test for a fitted distribution.

    Compares the empirical CDF of the data with the fitted distribution's CDF.

    Returns
    -------
    dict
        ``statistic`` (max CDF distance), ``critical_value``, ``p_value``,
        and ``hypothesis`` ('accept' if the fit is adequate).
    """
    x = np.sort(np.asarray(failures, dtype=float))
    n = len(x)
    if n < 5:
        raise ValueError("At least 5 failures are required for a KS test.")
    statistic, p_value = ss.kstest(x, distribution._cdf)
    # Asymptotic critical value for the two-sided KS test.
    c_alpha = np.sqrt(-0.5 * np.log((1 - CI) / 2))
    critical = float(c_alpha / np.sqrt(n))
    return {
        "statistic": float(statistic),
        "critical_value": critical,
        "p_value": float(p_value),
        "hypothesis": "accept" if statistic < critical else "reject",
        "CI": CI,
    }
