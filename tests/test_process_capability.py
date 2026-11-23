"""Known-answer tests for process capability."""

import numpy as np
import pytest

from reliability.Process_capability import process_capability, distribution_specification_tails
from reliability.Distributions import Exponential_Distribution


@pytest.mark.parametrize('scale', [1e-30, 1., 3600., 1e30])
def test_adopted_tail_ppm_matches_exponential_identity_across_units(scale):
    # exp(-60) is lost by subtracting its CDF from one; direct survival must
    # retain it. The oracle does not call either distribution tail method.
    result = distribution_specification_tails(Exponential_Distribution(2 / scale), usl=30 * scale)
    expected = np.exp(-60.)
    assert result['probability_above_usl'] == pytest.approx(expected, rel=1e-13, abs=0.)
    assert result['total'] == pytest.approx(expected * 1e6, rel=1e-13, abs=0.)
    assert result['probability_below_lsl'] == 0.
    assert result['parameter_uncertainty_included'] is False


def test_centered_cp_equals_cpk():
    # Symmetric data centered at the spec midpoint => Cp ~ Cpk.
    rng = np.random.default_rng(0)
    data = rng.normal(100, 1, 5000)
    data = data - data.mean() + 100  # force exact centering
    r = process_capability(data, lsl=94, usl=106)
    assert r["Cp"] is not None and r["Cpk"] is not None
    assert abs(r["Cp"] - r["Cpk"]) < 0.05


def test_offcenter_reduces_cpk():
    rng = np.random.default_rng(1)
    data = rng.normal(103, 1, 5000)  # shifted toward the USL
    r = process_capability(data, lsl=94, usl=106)
    assert r["Cpk"] < r["Cp"]
    # Cpu (toward USL) should be the binding (smaller) side.
    assert r["Cpu"] < r["Cpl"]
    assert abs(r["Cpk"] - r["Cpu"]) < 1e-9


def test_known_cp_value():
    # Construct data with std ~ 1, spec width 12 => Cp ~ 12/(6*1) = 2.
    rng = np.random.default_rng(2)
    data = rng.normal(50, 1, 20000)
    r = process_capability(data, lsl=44, usl=56)
    assert abs(r["Cp"] - 2.0) < 0.1


def test_one_sided_usl():
    data = np.random.default_rng(3).normal(10, 1, 1000)
    r = process_capability(data, usl=13)
    assert r["Cp"] is None
    assert r["Cpu"] is not None
    assert r["Cpl"] is None
    # Cpk equals Cpu for a one-sided upper spec.
    assert abs(r["Cpk"] - r["Cpu"]) < 1e-9


def test_one_sided_lsl():
    data = np.random.default_rng(4).normal(10, 1, 1000)
    r = process_capability(data, lsl=7)
    assert r["Cpl"] is not None
    assert r["Cpu"] is None
    assert abs(r["Cpk"] - r["Cpl"]) < 1e-9


def test_cpm_with_target():
    rng = np.random.default_rng(5)
    data = rng.normal(100, 1, 2000)
    r = process_capability(data, lsl=94, usl=106, target=100)
    assert r["Cpm"] is not None and r["Cpm"] > 0


def test_ppm_and_histogram_present():
    data = np.random.default_rng(6).normal(0, 1, 500)
    r = process_capability(data, lsl=-3, usl=3)
    assert set(r["ppm_within"]) == {"below_lsl", "above_usl", "total"}
    assert r["ppm_within"]["total"] >= 0
    assert len(r["histogram"]["counts"]) == len(r["histogram"]["bin_centers"])
    assert r["normality"]["test"] == "shapiro"


def test_requires_a_spec_limit():
    with pytest.raises(ValueError):
        process_capability([1, 2, 3, 4], None, None)
