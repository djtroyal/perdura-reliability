"""
Special life-data models built on the Weibull distribution.

These extend the standard single-distribution fitters with models that have
greater shape flexibility or that describe sub-populations:

- ``Fit_Weibull_Mixture``    : p * f1 + (1-p) * f2  (additive mixture)
- ``Fit_Weibull_CR``         : competing risks, SF = SF1 * SF2
- ``Fit_Weibull_DSZI``       : Defective Subpopulation + Zero Inflated
- ``Fit_Weibull_DS``         : DSZI with ZI = 0 (defective subpopulation only)
- ``Fit_Weibull_ZI``         : DSZI with DS = 1 (zero inflated only)
- ``Fit_Weibull_2P_grouped`` : 2P Weibull on grouped (repeated) data

All fitters expose ``alpha``/``beta`` style parameters, ``loglik``, ``AICc``,
``BIC`` and a ``results`` DataFrame, mirroring the standard fitters.
"""

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from reliability.Utils import AICc, BIC


# ── Vectorized Weibull primitives (alpha = scale, beta = shape) ───────────────

def _w_sf(t, alpha, beta):
    return np.exp(-((t / alpha) ** beta))


def _w_cdf(t, alpha, beta):
    return 1.0 - _w_sf(t, alpha, beta)


def _w_logpdf(t, alpha, beta):
    # log f(t) = log(beta/alpha) + (beta-1) log(t/alpha) - (t/alpha)^beta
    z = t / alpha
    return np.log(beta / alpha) + (beta - 1) * np.log(z) - z ** beta


def _w_pdf(t, alpha, beta):
    return np.exp(_w_logpdf(t, alpha, beta))


def _safe_log(x):
    return np.log(np.clip(x, 1e-300, None))


def _moment_init(times):
    """Crude method-of-moments Weibull start (alpha, beta) from positive times."""
    times = times[times > 0]
    if len(times) < 2:
        return 1.0, 1.5
    alpha = float(np.median(times)) / (np.log(2) ** (1 / 1.5))
    return max(alpha, 1e-6), 1.5


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

        def neg_ll(p):
            alpha1, beta1, alpha2, beta2, prop = p
            if min(alpha1, beta1, alpha2, beta2) <= 0 or not (0 < prop < 1):
                return np.inf
            pdf = prop * _w_pdf(failures, alpha1, beta1) + (1 - prop) * _w_pdf(failures, alpha2, beta2)
            ll = np.sum(_safe_log(pdf))
            if rc is not None and len(rc) > 0:
                sf_mix = prop * _w_sf(rc, alpha1, beta1) + (1 - prop) * _w_sf(rc, alpha2, beta2)
                ll += np.sum(_safe_log(sf_mix))
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
        best = None
        for x0 in starts:
            res = minimize(neg_ll, x0, method='Nelder-Mead',
                           options={'maxiter': 10000, 'xatol': 1e-8, 'fatol': 1e-8})
            res_b = minimize(neg_ll, res.x, method='L-BFGS-B', bounds=bounds)
            cand = res_b if res_b.fun < res.fun else res
            if best is None or cand.fun < best.fun:
                best = cand

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
        self.results = pd.DataFrame({
            'Parameter': ['Alpha 1', 'Beta 1', 'Alpha 2', 'Beta 2', 'Proportion 1'],
            'Value': [self.alpha_1, self.beta_1, self.alpha_2, self.beta_2, self.proportion_1],
        })

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

        a0, b0 = _moment_init(failures)
        x0 = [a0 * 1.3, max(b0, 1.2), a0 * 0.7, max(b0, 1.2)]

        def neg_ll(p):
            alpha1, beta1, alpha2, beta2 = p
            if min(p) <= 0:
                return np.inf
            sf1f, sf2f = _w_sf(failures, alpha1, beta1), _w_sf(failures, alpha2, beta2)
            pdf = (_w_pdf(failures, alpha1, beta1) * sf2f
                   + _w_pdf(failures, alpha2, beta2) * sf1f)
            ll = np.sum(_safe_log(pdf))
            if rc is not None and len(rc) > 0:
                ll += np.sum(_safe_log(_w_sf(rc, alpha1, beta1) * _w_sf(rc, alpha2, beta2)))
            return -ll if np.isfinite(ll) else np.inf

        bounds = [(1e-6, None)] * 4
        res = minimize(neg_ll, x0, method='Nelder-Mead',
                       options={'maxiter': 10000, 'xatol': 1e-8, 'fatol': 1e-8})
        res_b = minimize(neg_ll, res.x, method='L-BFGS-B', bounds=bounds)
        best = res_b if res_b.fun < res.fun else res

        self.alpha_1, self.beta_1, self.alpha_2, self.beta_2 = best.x
        if self.alpha_1 > self.alpha_2:
            self.alpha_1, self.alpha_2 = self.alpha_2, self.alpha_1
            self.beta_1, self.beta_2 = self.beta_2, self.beta_1

        self.loglik = -best.fun
        n = len(failures) + (len(rc) if rc is not None else 0)
        self.AICc = AICc(self.loglik, 4, n)
        self.BIC = BIC(self.loglik, 4, n)
        self.results = pd.DataFrame({
            'Parameter': ['Alpha 1', 'Beta 1', 'Alpha 2', 'Beta 2'],
            'Value': [self.alpha_1, self.beta_1, self.alpha_2, self.beta_2],
        })

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
                ll += np.sum(_safe_log((DS_ - ZI_) * _w_pdf(pos, alpha, beta)))
            if rc is not None and len(rc) > 0:
                sf = 1.0 - (ZI_ + (DS_ - ZI_) * _w_cdf(rc, alpha, beta))
                ll += np.sum(_safe_log(sf))
            return -ll if np.isfinite(ll) else np.inf

        res = minimize(neg_ll, x0, method='Nelder-Mead',
                       options={'maxiter': 10000, 'xatol': 1e-9, 'fatol': 1e-9})
        alpha, beta, DS_, ZI_ = unpack(res.x)
        self.alpha, self.beta = alpha, beta
        self.DS = float(np.clip(DS_, 0, 1))
        self.ZI = float(np.clip(ZI_, 0, 1))

        self.loglik = -res.fun
        k = 2 + ('DS' in idx) + ('ZI' in idx)
        self.AICc = AICc(self.loglik, k, n_total)
        self.BIC = BIC(self.loglik, k, n_total)
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta', 'DS', 'ZI'],
            'Value': [self.alpha, self.beta, self.DS, self.ZI],
        })

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
    """2-parameter Weibull fit for grouped (repeated) data.

    Equivalent to ``Fit_Weibull_2P`` but each observation carries an integer
    quantity, so identical times are supplied once with a count rather than
    repeated. The log-likelihood is weighted by the quantities, which is far
    more efficient for large data sets with many repeated values.

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
        f = np.asarray(failures, dtype=float)
        fq = np.asarray(failure_quantities, dtype=float)
        if len(f) != len(fq):
            raise ValueError('failures and failure_quantities must be the same length.')
        if np.any(f <= 0):
            raise ValueError('All failure times must be > 0.')
        if np.any(fq <= 0):
            raise ValueError('All quantities must be positive.')
        if right_censored is not None and len(right_censored) > 0:
            rc = np.asarray(right_censored, dtype=float)
            rcq = (np.asarray(right_censored_quantities, dtype=float)
                   if right_censored_quantities is not None
                   else np.ones_like(rc))
            if len(rc) != len(rcq):
                raise ValueError('right_censored and right_censored_quantities must match.')
        else:
            rc, rcq = None, None

        n = float(np.sum(fq) + (np.sum(rcq) if rcq is not None else 0))
        mean0 = float(np.sum(f * fq) / np.sum(fq))
        x0 = [mean0, 1.5]

        def neg_ll(p):
            alpha, beta = p
            if alpha <= 0 or beta <= 0:
                return np.inf
            ll = np.sum(fq * _w_logpdf(f, alpha, beta))
            if rc is not None:
                ll += np.sum(rcq * _safe_log(_w_sf(rc, alpha, beta)))
            return -ll if np.isfinite(ll) else np.inf

        res = minimize(neg_ll, x0, method='Nelder-Mead',
                       options={'maxiter': 10000, 'xatol': 1e-10, 'fatol': 1e-10})
        res_b = minimize(neg_ll, res.x, method='L-BFGS-B',
                         bounds=[(1e-10, None), (1e-10, None)])
        best = res_b if res_b.fun < res.fun else res

        self.alpha, self.beta = best.x
        self.eta = self.alpha  # alias for parity with Fit_Weibull_2P
        self.loglik = -best.fun
        self.AICc = AICc(self.loglik, 2, n)
        self.BIC = BIC(self.loglik, 2, n)
        self.n = n
        self.results = pd.DataFrame({
            'Parameter': ['Alpha', 'Beta'],
            'Value': [self.alpha, self.beta],
        })

    def SF(self, t):
        return _w_sf(np.asarray(t, dtype=float), self.alpha, self.beta)

    def CDF(self, t):
        return _w_cdf(np.asarray(t, dtype=float), self.alpha, self.beta)

    def __repr__(self):
        return f"Fit_Weibull_2P_grouped(alpha={self.alpha:.4f}, beta={self.beta:.4f})"
