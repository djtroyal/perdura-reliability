"""Tests for the math/stats hardening pass: confidence intervals, warnings,
interpretations, and robustness/performance guards."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import numpy as np
import pytest
from fastapi import HTTPException


# --- Hypothesis t-test CIs ---

def test_one_sample_t_ci_brackets_mean():
    from reliability.Hypothesis_tests import one_sample_t
    data = [10.2, 11.5, 9.8, 10.6, 11.1, 9.4, 10.9, 10.3, 11.8, 9.9]
    r = one_sample_t(data, popmean=10)
    assert r["ci_lower"] is not None and r["ci_upper"] is not None
    assert r["ci_lower"] <= r["sample_mean"] <= r["ci_upper"]
    assert r["ci_level"] == pytest.approx(0.95)


def test_two_sample_t_ci_brackets_difference():
    from reliability.Hypothesis_tests import two_sample_t
    a = [10.0, 10.5, 9.8, 10.2, 10.1, 9.9]
    b = [12.0, 12.4, 11.8, 12.1, 12.3, 11.9]
    r = two_sample_t(a, b)
    diff = r["mean_a"] - r["mean_b"]
    assert r["ci_lower"] <= diff <= r["ci_upper"]
    # Clearly separated groups: the CI excludes 0 and the test rejects.
    assert r["ci_upper"] < 0 and r["reject_null"]


def test_paired_t_ci():
    from reliability.Hypothesis_tests import paired_t
    a = [5.1, 5.4, 4.9, 5.2, 5.0]
    b = [4.8, 5.0, 4.7, 4.9, 4.6]
    r = paired_t(a, b)
    assert r["ci_lower"] <= r["mean_diff"] <= r["ci_upper"]


# --- Process capability CIs + normality gate ---

def _cap(data, lsl=None, usl=None):
    from reliability.Process_capability import process_capability
    return process_capability(data, lsl=lsl, usl=usl)


def test_capability_ci_present_and_ordered():
    # CIs attach to Pp/Ppk (overall sigma, where df = n−1 is exact) — the
    # within (range-based) sigma has a smaller effective df, so chi-square /
    # Bissell intervals there would be over-confident.
    rng = np.random.default_rng(3)
    data = rng.normal(50, 2, 100).tolist()
    r = _cap(data, lsl=40, usl=60)
    assert r["Ppk_lower"] is not None and r["Ppk_upper"] is not None
    assert r["Ppk_lower"] < r["Ppk"] < r["Ppk_upper"]
    assert r["Pp_lower"] < r["Pp"] < r["Pp_upper"]


def test_normality_warning_fires_on_skewed_data():
    rng = np.random.default_rng(4)
    skewed = rng.exponential(5, 150).tolist()
    r = _cap(skewed, usl=30)
    assert r["normality"]["normal"] is False
    assert r["normality_warning"] is True
    assert r["normality_note"]


def test_normality_warning_silent_on_normal_data():
    rng = np.random.default_rng(5)
    normal = rng.normal(50, 2, 150).tolist()
    r = _cap(normal, lsl=40, usl=60)
    assert r["normality_warning"] is False
    assert r["normality_note"] is None


# --- Growth: interpretation, CvM verdict, bounds ---

def _growth_fit(times, T=None):
    from routers import growth as G
    from schemas import GrowthRequest
    return G.fit_growth(GrowthRequest(
        times=times, T=T, model="crow_amsaa",
        termination="time" if T is not None else "failure"))


GROWTH_TIMES = [12, 45, 89, 132, 200, 290, 410, 570, 720, 900]


def test_growth_interpretation_and_cvm_verdict():
    r = _growth_fit(GROWTH_TIMES, T=1000)
    assert r["interpretation"]["trend"] == "improving"          # beta < 1
    assert "reliability is growing" in r["interpretation"]["detail"]
    assert r["goodness_of_fit"]["critical_value"] > 0
    assert r["goodness_of_fit"]["decision"] in {"reject", "fail_to_reject"}
    assert "accept" not in r["goodness_of_fit"]["decision_text"].lower()


def test_growth_bounds_bracket_estimates():
    r = _growth_fit(GROWTH_TIMES, T=1000)
    intervals = r["confidence"]["intervals"]
    assert intervals["beta"]["lower"] < r["beta"] < intervals["beta"]["upper"]
    assert (intervals["cumulative_mtbf_at_T"]["lower"]
            < r["mtbf_cumulative"]
            < intervals["cumulative_mtbf_at_T"]["upper"])
    assert (intervals["instantaneous_mtbf_at_T"]["lower"]
            < r["mtbf_instantaneous"]
            < intervals["instantaneous_mtbf_at_T"]["upper"])
    assert r["confidence"]["level"] == pytest.approx(0.95)


def test_growth_duane_interpretation():
    from routers import growth as G
    from schemas import GrowthRequest
    r = G.fit_growth(GrowthRequest(times=GROWTH_TIMES, T=1000, model="duane"))
    assert r["interpretation"]["trend"] in ("improving", "worsening", "constant")


def test_duane_invalid_regime_withholds_instantaneous_mtbf():
    from routers import growth as G
    from schemas import GrowthRequest
    result = G.fit_growth(GrowthRequest(
        times=[100, 101, 102, 103], model="duane"))
    assert result["alpha"] < 0
    assert result["valid_growth_regime"] is False
    assert result["mtbf_instantaneous"] is None
    assert all(value is None for value in result["mtbf_curve"]["instantaneous"])
    assert "withheld" in result["regime_warning"]


def test_mcf_router_requires_and_reports_explicit_censoring():
    from routers import growth as G
    from schemas import MCFRequest
    result = G.mcf(MCFRequest(
        data=[[5, 10], [6]], observation_ends=[10, 10],
        interval_method="log_transformed"))
    estimate = result["nonparametric"]
    assert estimate["time"][-1] == 10
    assert estimate["events_at_time"][-1] == 1
    assert estimate["data_contract"] == "explicit_event_times_and_observation_ends"
    assert result["status"]["nonparametric_interval"] == "available"
    assert result["status"]["parametric_fit"] == "not_requested"
    assert result["trend"]["inferential"] is False
    assert result["trend"]["method"] == "descriptive_two_segment_slope_ratio"
    assert len(result["assumptions"]) >= 3

    with pytest.raises(HTTPException) as caught:
        G.mcf(MCFRequest(data=[[5, 10], [6]]))
    assert caught.value.status_code == 400
    assert "observation_ends" in caught.value.detail


def test_mcf_bootstrap_schema_fails_closed_and_single_system_is_uncertified():
    from routers import growth as G
    from schemas import MCFRequest

    with pytest.raises(ValueError, match="at least 50"):
        MCFRequest(
            data=[[1, 2], [1.5]], observation_ends=[3, 3],
            interval_method="cluster_bootstrap", bootstrap_samples=0)

    result = G.mcf(MCFRequest(
        data=[[1, 2]], observation_ends=[3],
        interval_method="log_transformed"))
    estimate = result["nonparametric"]
    assert estimate["interval_available"] is False
    assert estimate["variance_available"] is False
    assert estimate["MCF_lower"] == [None, None]
    assert estimate["MCF_upper"] == [None, None]


def test_mcf_router_surfaces_parametric_profile_uncertainty_and_status():
    from routers import growth as G
    from schemas import MCFRequest

    result = G.mcf(MCFRequest(
        data=[[1, 2, 4], [1.5, 3]], observation_ends=[5, 6],
        parametric=True, interval_method="log_transformed", CI=0.90))
    parametric = result["parametric"]
    assert parametric["converged"] is True
    assert parametric["beta_lower"] < parametric["beta"] < parametric["beta_upper"]
    assert (parametric["endpoint_MCF_lower"]
            < parametric["endpoint_MCF"]
            < parametric["endpoint_MCF_upper"])
    assert parametric["Lambda"] > 0
    assert result["status"]["parametric_fit"] == "available"
    assert result["status"]["parametric_interval"] == parametric["interval_status"]
    assert any("power-law NHPP" in item for item in result["assumptions"])


# --- Warranty: fitted-parameter bounds surface ---

def test_warranty_params_carry_bounds():
    from routers import warranty as W
    from schemas import WarrantyForecastRequest
    req = WarrantyForecastRequest(
        quantities=[1000, 1200, 1100, 1300, 1250],
        returns=[[5, 8, 12, 15, 18], [None, 4, 9, 13, 16], [None, None, 6, 10, 14],
                 [None, None, None, 7, 11], [None, None, None, None, 5]],
        n_forecast_periods=2, distribution="Weibull_2P")
    r = W.forecast(req)
    p = r["params"]
    assert "eta" in p and "beta" in p
    # The fitter's CIs are no longer discarded.
    assert "eta_lower" in p and "eta_upper" in p
    assert p["eta_lower"] < p["eta"] < p["eta_upper"]


# --- S-N curve robustness ---

def _sn(**kw):
    from routers import pof as P
    from schemas import SNCurveRequest
    base = dict(
        stress_amplitude=[400, 350, 300, 250, 200, 180],
        cycles_to_failure=[1e4, 3e4, 8e4, 3e5, 1e6, 2e6],
    )
    base.update(kw)
    return P.sn_curve(SNCurveRequest(**base))


def test_sn_slope_ci():
    r = _sn()
    assert r["b_se"] is not None and r["b_se"] > 0
    assert r["b_lower"] < r["b"] < r["b_upper"]


def test_sn_extrapolation_warning_fires():
    # 1e7-cycle endurance estimate is outside [1e4, 2e6] -> always warns here;
    # the life query far beyond the data adds a second warning.
    r = _sn(life_query=1e9)
    assert r["extrapolation_warning"] is not None
    assert "outside the fitted" in r["extrapolation_warning"]


def test_sn_in_range_query_no_query_warning():
    r = _sn(life_query=1e5)
    # Only the endurance-limit note may fire; the in-range query itself must not.
    if r["extrapolation_warning"]:
        assert "life query" not in r["extrapolation_warning"]


# --- RBD: path guard + memoized importance still correct ---

def _rbd(nodes, edges):
    from routers import system_reliability as SR
    from schemas import RBDRequest
    return SR.compute_rbd(RBDRequest(nodes=nodes, edges=edges))


def test_rbd_series_parallel_unchanged():
    nodes = [
        {"id": "src", "type": "source"}, {"id": "snk", "type": "sink"},
        {"id": "a", "type": "component", "data": {"label": "A", "reliability": 0.9}},
        {"id": "b", "type": "component", "data": {"label": "B", "reliability": 0.8}},
    ]
    edges = [
        {"source": "src", "target": "a"}, {"source": "a", "target": "snk"},
        {"source": "src", "target": "b"}, {"source": "b", "target": "snk"},
    ]
    r = _rbd(nodes, edges)
    # Parallel pair: 1 - (1-0.9)(1-0.8) = 0.98
    assert r["system_reliability"] == pytest.approx(0.98)
    birnbaums = {c["id"]: c["Birnbaum"] for c in r["importance"]}
    assert birnbaums["a"] == pytest.approx(0.2)    # 1 - R_b
    assert birnbaums["b"] == pytest.approx(0.1)    # 1 - R_a


def test_rbd_series_importance_uses_failure_probability_semantics():
    nodes = [
        {"id": "src", "type": "source"}, {"id": "snk", "type": "sink"},
        {"id": "a", "type": "component", "data": {"label": "A", "reliability": 0.9}},
        {"id": "b", "type": "component", "data": {"label": "B", "reliability": 0.8}},
    ]
    edges = [
        {"source": "src", "target": "a"},
        {"source": "a", "target": "b"},
        {"source": "b", "target": "snk"},
    ]
    r = _rbd(nodes, edges)
    imp = {row["id"]: row for row in r["importance"]}

    assert r["system_reliability"] == pytest.approx(0.72)
    assert imp["a"]["Birnbaum"] == pytest.approx(0.8)
    assert imp["a"]["Criticality"] == pytest.approx(0.8 * 0.1 / 0.28, abs=5e-7)
    assert imp["a"]["RAW"] == pytest.approx(1.0 / 0.28, rel=2e-5)
    assert imp["a"]["RRW"] == pytest.approx(0.28 / 0.2)
    assert imp["b"]["Birnbaum"] == pytest.approx(0.9)
    assert imp["b"]["Criticality"] == pytest.approx(0.9 * 0.2 / 0.28, abs=5e-7)
    assert imp["b"]["RRW"] == pytest.approx(0.28 / 0.1)


def test_rbd_parallel_rrw_reports_unbounded_case():
    nodes = [
        {"id": "src", "type": "source"}, {"id": "snk", "type": "sink"},
        {"id": "a", "type": "component", "data": {"reliability": 0.9}},
        {"id": "b", "type": "component", "data": {"reliability": 0.8}},
    ]
    edges = [
        {"source": "src", "target": "a"}, {"source": "a", "target": "snk"},
        {"source": "src", "target": "b"}, {"source": "b", "target": "snk"},
    ]
    r = _rbd(nodes, edges)
    imp = {row["id"]: row for row in r["importance"]}

    assert imp["a"]["Criticality"] == pytest.approx(1.0)
    assert imp["a"]["RAW"] == pytest.approx(10.0)
    assert imp["a"]["RRW"] is None
    assert imp["a"]["RRW_unbounded"] is True


def test_rbd_bdd_scales_beyond_old_path_count_guard():
    # A 2-wide × k-stage lattice has 2^k paths. This exceeded the former
    # inclusion-exclusion cutoff at 18 paths; graph BDD evaluation is exact.
    k = 10   # 2^10 = 1,024 source-to-sink paths
    nodes = [{"id": "src", "type": "source"}, {"id": "snk", "type": "sink"}]
    edges = []
    prev = ["src"]
    for s in range(k):
        layer = []
        for j in range(2):
            cid = f"c{s}_{j}"
            nodes.append({"id": cid, "type": "component", "data": {"reliability": 0.9}})
            layer.append(cid)
            for p in prev:
                edges.append({"source": p, "target": cid})
        prev = layer
    for p in prev:
        edges.append({"source": p, "target": "snk"})
    result = _rbd(nodes, edges)
    expected = (1.0 - 0.1 ** 2) ** k
    assert result["system_reliability"] == pytest.approx(expected, abs=5e-7)
    assert result["computation"]["engine"] == "reduced_bdd_network_connectivity"
    assert result["computation"]["path_enumeration_used_for_probability"] is False


def test_rbd_beta_factor_common_cause_reduces_parallel_reliability():
    nodes = [
        {"id": "src", "type": "source"},
        {"id": "snk", "type": "sink"},
        {"id": "a", "type": "component", "data": {
            "label": "A", "reliability": 0.9,
            "ccf_group": "G", "ccf_beta": 0.2,
        }},
        {"id": "b", "type": "component", "data": {
            "label": "B", "reliability": 0.9,
            "ccf_group": "G", "ccf_beta": 0.2,
        }},
    ]
    edges = [
        {"source": "src", "target": "a"},
        {"source": "a", "target": "snk"},
        {"source": "src", "target": "b"},
        {"source": "b", "target": "snk"},
    ]
    result = _rbd(nodes, edges)
    q_common = 0.2 * 0.1
    q_individual = (0.1 - q_common) / (1.0 - q_common)
    expected_failure = q_common + (1.0 - q_common) * q_individual ** 2

    assert result["system_unreliability"] == pytest.approx(expected_failure, abs=5e-7)
    assert result["system_reliability"] < 0.99
    assert result["dependency_model"]["model"] == "beta_factor"
    assert any(row["kind"] == "common_cause_survival"
               for row in result["importance"])
