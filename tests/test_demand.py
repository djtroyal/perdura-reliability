"""NB tail/inverse-CDF checks across dispersion and extreme complementary tails."""
import numpy as np
import pytest
from scipy.stats import nbinom, poisson
from reliability._demand import NegativeBinomialDemand


@pytest.mark.parametrize('mean', [.0001, .1, 10, 1000])
@pytest.mark.parametrize('size', [.05, 1, 3, 1000])
def test_nb_matches_scipy_in_well_resolved_parameter_region(mean,size):
    actual = NegativeBinomialDemand(mean,size)
    oracle = nbinom(size,size/(size+mean))
    for p in [1e-8,.1,.5,.95,1-1e-8]:
        q = actual.ppf(p)
        oracle_q = int(oracle.ppf(p))
        # SciPy's inverse can choose the next integer at an exact CDF boundary
        # (e.g. size=mean=1000 has CDF(999)=1/2 by beta symmetry).
        assert q == oracle_q or (abs(q-oracle_q)==1 and abs(oracle.cdf(min(q,oracle_q))-p)<2e-14)
        assert actual.cdf(q) >= p-1e-15
        assert actual.cdf(q-1) < p+1e-15
    x = np.array([0,1,3,10,100])
    assert actual.cdf(x) == pytest.approx(oracle.cdf(x),abs=1e-11)
    assert actual.sf(x) == pytest.approx(oracle.sf(x),abs=1e-11)


@pytest.mark.parametrize('size',[1e20,1e100,1e300])
def test_large_shape_retains_tiny_direct_upper_tail(size):
    actual = NegativeBinomialDemand(10,size)
    for k in [0,15,50,100]:
        assert actual.cdf(k) == pytest.approx(poisson.cdf(k,10),abs=1e-11)
        assert actual.sf(k) == pytest.approx(poisson.sf(k,10),rel=3e-10,abs=0)


def test_zero_mean_tiny_mean_and_geometric_distribution():
    actual = NegativeBinomialDemand(0,1)
    assert actual.ppf(.99)==0 and actual.cdf(0)==1 and actual.sf(0)==0
    assert NegativeBinomialDemand(1e-300,1e300).sf(0) == pytest.approx(1e-300,rel=1e-12,abs=0)
    assert NegativeBinomialDemand(1000,1000).ppf(.5) == 999
    actual = NegativeBinomialDemand(1e6,1)
    for k in [0,100,1000000]:
        log_survival = -(k+1)*np.log1p(1e-6)
        assert actual.sf(k) == pytest.approx(np.exp(log_survival),rel=1e-12)
        assert actual.cdf(k) == pytest.approx(-np.expm1(log_survival),rel=1e-12)


def test_unresolved_tail_or_integer_precision_is_rejected():
    with pytest.raises(ValueError,match='integer precision'):
        NegativeBinomialDemand(1e17,1).ppf(.95)
    with pytest.raises(ValueError):
        NegativeBinomialDemand(float('inf'),1)
