"""Stable integer demand tails without rounding an almost-unit NB probability."""
import math
import numpy as np
from scipy.special import betainc, betaincc, betaln


class NegativeBinomialDemand:
    """Mean/size NB tails evaluated on the smaller beta-function argument.

    CDF(k)=I_p(size,k+1)=1-I_q(k+1,size). Computing q directly
    preserves finite demand when p would round to exactly one. Integer inversion
    uses these same tails, not a differently rounded scipy.stats parameter.
    """
    def __init__(self, mean, size):
        self.mean, self.size = float(mean), float(size)
        if not math.isfinite(self.mean) or self.mean < 0 or not math.isfinite(self.size) or self.size <= 0:
            raise ValueError("Negative-binomial mean must be finite/nonnegative and size finite/positive.")
        ratio = min(self.mean, self.size) / max(self.mean, self.size)
        self.small = ratio / (1+ratio)
        self.use_q = self.mean <= self.size
        if self.use_q:
            self.log_p0 = -self.mean if ratio == 0 else -self.size * math.log1p(ratio)
            self.log_q = math.log(self.mean) - math.log(self.size) - math.log1p(ratio) if self.mean else -math.inf
            self.q = self.small
            self.rq = self.mean / (1+ratio)
        else:
            self.log_p0 = self.size * (math.log(self.size)-math.log(self.mean)-math.log1p(ratio))
            self.log_q = -math.log1p(ratio)
            self.q = 1-self.small
            self.rq = self.size / (1+ratio)

    def _recurrent_tail(self, k, complement):
        """Exact NB PMF recurrence when the beta implementation is unresolved.

        Both tails are summed in their own direction. A geometric remainder
        bound controls upper-tail truncation; an iteration limit rejects an
        unresolved calculation instead of changing its probability model.
        """
        if k == 0:
            return -math.expm1(self.log_p0) if complement else math.exp(self.log_p0)
        j = int(k)+1 if complement else int(k)
        log_pmf = -float(betaln(self.size,j+1)) - math.log(self.size+j) + self.log_p0 + j*self.log_q
        term = math.exp(log_pmf)
        total = term
        for _ in range(200000):
            if complement:
                ratio = (self.rq + j*self.q)/(j+1)
                next_term = term*ratio
                # Ratios decrease towards q for size>=1, increase for size<1.
                ratio_bound = max(ratio,self.q)
                if ratio_bound < 1 and next_term/(1-ratio_bound) <= max(total*2e-14, np.nextafter(0.,1.)):
                    return min(1.,total)
                term = next_term
                j += 1
            else:
                if j == 0:
                    return min(1.,total)
                term *= j/(self.rq+(j-1)*self.q)
                j -= 1
            total += term
            if not math.isfinite(total):
                break
        raise ValueError('Negative-binomial tail recurrence exceeded its precision/work limit.')

    def _tail(self, stock, complement):
        k = np.floor(np.asarray(stock, dtype=float))
        if self.mean == 0:
            out = np.where(k >= 0, 0. if complement else 1., 1. if complement else 0.)
        else:
            a, b = (np.maximum(k+1, 1), self.size) if self.use_q else (self.size, np.maximum(k+1, 1))
            function = betainc if self.use_q == complement else betaincc
            out = np.where(k < 0, 1. if complement else 0., function(a,b,self.small))
            unresolved = (~np.isfinite(out) | (self.small == 0)) & (k >= 0)
            if np.any(unresolved):
                out = np.array(out, copy=True)
                other_function = betaincc if function is betainc else betainc
                opposite = other_function(a,b,self.small)
                for index in np.ndindex(k.shape):
                    if unresolved[index]:
                        other = float(np.asarray(opposite)[index])
                        out[index] = 1-other if math.isfinite(other) and other <= .5 else self._recurrent_tail(k[index],complement)
        if not np.all(np.isfinite(out)):
            raise ValueError("Negative-binomial tail cannot be resolved at these parameters.")
        return float(out) if np.ndim(out) == 0 else out

    def cdf(self, stock):
        return self._tail(stock, False)

    def sf(self, stock):
        return self._tail(stock, True)

    def ppf(self, probability):
        if not 0 < probability < 1:
            raise ValueError("Service probability must lie strictly between zero and one.")
        if self.mean == 0:
            return 0
        limit = 2**53-1
        if self.mean > limit:
            raise ValueError("Required stock exceeds exact integer precision.")
        low, high = -1, max(1, math.ceil(self.mean))
        reached = lambda k: self.cdf(k) >= probability if probability <= .5 else self.sf(k) <= 1-probability
        while not reached(high):
            low, high = high, min(limit, high*2)
            if low == high:
                raise ValueError("Required stock exceeds exact integer precision.")
        while high-low > 1:
            middle = (low+high)//2
            if reached(middle):
                high = middle
            else:
                low = middle
        return high
