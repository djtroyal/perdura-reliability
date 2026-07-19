"""Tests for the enhanced Fault Tree backend router (#6, #7, #8, #9)."""

import sys
import json
import math
import pytest
from pathlib import Path

# Make the FastAPI backend importable (router + schemas).
BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

from routers.fault_tree import analyze_fault_tree, validate_fault_tree  # noqa: E402
from schemas import FaultTreeRequest, FTNode, FTEdge, FaultTreeGraph  # noqa: E402
from reliability.FaultTree import (  # noqa: E402
    ExactEvaluationLimitError,
    exact_probability_from_cut_sets,
)


def _node(nid, ntype, **data):
    return FTNode(id=nid, type=ntype, data=data)


def _req(nodes, edges, **kw):
    return FaultTreeRequest(
        nodes=nodes,
        edges=[FTEdge(source=s, target=t) for s, t in edges],
        **kw,
    )


@pytest.mark.parametrize("relative_path", [
    "gui/frontend/src/data/demoProject.json",
    "examples/demo-project.json",
])
def test_demo_project_fault_tree_examples_are_current_and_valid(relative_path):
    root = Path(__file__).resolve().parents[1]
    demo = json.loads((root / relative_path).read_text(encoding="utf-8"))
    wrapper = demo["modules"]["faultTree"]
    expected = {
        "Example — Simple OR",
        "Example — 2-of-3 Voting",
        "Example — PAND Sequence",
        "Example — Cold Standby",
        "Example — Functional Dependency",
    }
    assert expected.issubset({folio["name"] for folio in wrapper["folios"]})
    for folio in wrapper["folios"]:
        state = folio["state"]
        assert all(node["type"] not in {"top", "intermediate"}
                   for node in state["nodes"])
        gate_ids = [node["data"].get("gateId") for node in state["nodes"]
                    if node["type"] not in {
                        "basic", "undeveloped", "house", "conditioning", "external"
                    }]
        assert gate_ids and all(gate_ids)
        assert len(gate_ids) == len(set(gate_ids))
        edge_payloads = []
        for edge in state["edges"]:
            semantic = edge.get("data", {})
            edge_payloads.append({
                "id": edge.get("id"),
                "source": edge["source"],
                "target": edge["target"],
                "role": semantic.get("role"),
                "order": semantic.get("order"),
            })
        response = validate_fault_tree(FaultTreeRequest(
            nodes=state["nodes"],
            edges=edge_payloads,
            exposure_time=float(state["exposureTime"]),
            engine=state.get("engine", "auto"),
        ))
        assert response["valid"], (folio["name"], response["issues"])


# --- #8 repeated / mirror event identity --------------------------------------

def test_mirror_event_shared_in_cut_sets():
    """Two basic nodes sharing an eventKey are ONE event in cut-set logic."""
    # TOP = OR(AND(A, Amirror), B) where A and Amirror share eventKey 'A'.
    nodes = [
        _node("top", "or", label="TOP"),
        _node("g1", "and", label="G1"),
        _node("a1", "basic", label="A1", eventKey="A", probability=0.1),
        _node("a2", "basic", label="A2", eventKey="A", probability=0.1),
        _node("b", "basic", label="B", probability=0.2),
    ]
    edges = [("top", "g1"), ("top", "b"), ("g1", "a1"), ("g1", "a2")]
    res = analyze_fault_tree(_req(nodes, edges, methods=["exact"]))
    mcs = res["minimal_cut_sets"]
    # AND(A, A) collapses to {A}; so MCS should be {A} and {B}, NOT {A,A}.
    assert {"A"} == set(mcs[0]) or {"A"} in [set(m) for m in mcs]
    flat = [set(m) for m in mcs]
    assert {"A"} in flat
    assert {"B"} in flat
    # No cut set should contain the same event twice (size stays 1).
    assert all(len(m) == 1 for m in mcs)


def test_mirror_event_not_double_counted_probability():
    """An event repeated under an AND must not be squared."""
    nodes = [
        _node("g1", "and", label="G1"),
        _node("a1", "basic", label="A1", eventKey="A", probability=0.3),
        _node("a2", "basic", label="A2", eventKey="A", probability=0.3),
    ]
    edges = [("g1", "a1"), ("g1", "a2")]
    res = analyze_fault_tree(_req(nodes, edges, methods=["exact"]))
    # A AND A == A, so P(TOP) == P(A) == 0.3, not 0.09.
    assert res["top_event_probability"] == pytest.approx(0.3, rel=1e-9)


# --- #7 calculation methods ---------------------------------------------------

def test_three_methods_agree_on_simple_or_tree():
    """For independent single-event cut sets the three methods are close;
    exact equals 1-prod(1-p_i) here, and rare-event is the first-order bound."""
    nodes = [
        _node("top", "or", label="TOP"),
        _node("a", "basic", label="A", probability=0.01),
        _node("b", "basic", label="B", probability=0.02),
    ]
    edges = [("top", "a"), ("top", "b")]
    res = analyze_fault_tree(_req(
        nodes, edges, methods=["exact", "rare_event", "min_cut_upper_bound"]))
    m = res["methods"]
    exact = 1 - 0.99 * 0.98
    assert m["exact"] == pytest.approx(exact, rel=1e-9)
    assert m["min_cut_upper_bound"] == pytest.approx(exact, rel=1e-9)
    assert m["rare_event"] == pytest.approx(0.01 + 0.02, rel=1e-9)
    # All three within a small tolerance for small probabilities.
    assert abs(m["exact"] - m["rare_event"]) < 1e-3


def test_methods_ordering_bounds():
    """rare_event >= exact and min_cut_upper_bound >= exact (classic bounds)."""
    nodes = [
        _node("top", "or", label="TOP"),
        _node("a", "basic", label="A", probability=0.2),
        _node("b", "basic", label="B", probability=0.3),
        _node("c", "basic", label="C", probability=0.1),
    ]
    edges = [("top", "a"), ("top", "b"), ("top", "c")]
    res = analyze_fault_tree(_req(
        nodes, edges, methods=["exact", "rare_event", "min_cut_upper_bound"]))
    m = res["methods"]
    assert m["rare_event"] >= m["exact"] - 1e-12
    assert m["min_cut_upper_bound"] >= m["exact"] - 1e-12


def test_exact_method_remains_exact_beyond_twenty_shared_cut_sets():
    """A structured 21-cut-set tree must not silently return its upper bound."""
    nodes = [_node("top", "or", label="TOP")]
    edges = []
    for i in range(21):
        gate = f"g{i}"
        a_node = f"a{i}"
        b_node = f"b{i}"
        nodes.extend([
            _node(gate, "and", label=gate),
            _node(a_node, "basic", label="A", eventKey="A", probability=0.1),
            _node(b_node, "basic", label=f"B{i}", probability=0.1),
        ])
        edges.extend([
            ("top", gate),
            (gate, a_node),
            (gate, b_node),
        ])

    result = analyze_fault_tree(_req(
        nodes, edges, methods=["exact", "min_cut_upper_bound"]))
    expected = 0.1 * (1.0 - 0.9 ** 21)

    assert result["methods"]["exact"] == pytest.approx(expected, rel=1e-10)
    assert result["top_event_probability"] == pytest.approx(expected, rel=1e-10)
    assert result["methods"]["min_cut_upper_bound"] > expected * 2


def test_exact_evaluator_never_falls_back_when_state_limit_is_hit():
    events = {"A": 0.1, "B": 0.2}
    with pytest.raises(ExactEvaluationLimitError, match="BDD states"):
        exact_probability_from_cut_sets(
            [{"A"}, {"B"}], events, max_states=1)


def test_exact_bdd_matches_bruteforce_event_state_enumeration():
    cut_sets = [{"A", "B"}, {"A", "C"}, {"B", "D"}]
    events = {"A": 0.17, "B": 0.23, "C": 0.31, "D": 0.11}

    expected = 0.0
    names = sorted(events)
    for mask in range(1 << len(names)):
        failed = {name for i, name in enumerate(names) if mask & (1 << i)}
        state_probability = 1.0
        for name in names:
            state_probability *= (events[name] if name in failed
                                  else 1.0 - events[name])
        if any(cut_set.issubset(failed) for cut_set in cut_sets):
            expected += state_probability

    assert exact_probability_from_cut_sets(
        cut_sets, events) == pytest.approx(expected, rel=1e-12)


def test_exact_bdd_reports_computational_diagnostics():
    probability, diagnostics = exact_probability_from_cut_sets(
        [{"A", "B"}, {"A", "C"}],
        {"A": 0.1, "B": 0.2, "C": 0.3},
        return_diagnostics=True,
    )
    assert probability == pytest.approx(0.1 * (1 - 0.8 * 0.7))
    assert diagnostics["engine"] == "reduced_bdd_shannon_dnf"
    assert diagnostics["exact"] is True
    assert diagnostics["states_evaluated"] > 0
    assert diagnostics["variables"] == 3


def test_noncoherent_xor_is_evaluated_exactly():
    nodes = [
        _node("top", "xor", label="TOP"),
        _node("a", "basic", label="A", probability=0.1),
        _node("b", "basic", label="B", probability=0.2),
    ]
    edges = [("top", "a"), ("top", "b")]
    result = analyze_fault_tree(_req(nodes, edges, methods=["exact"]))
    assert result["analysis_kind"] == "static_noncoherent"
    assert result["top_event_probability"] == pytest.approx(0.26)
    assert result["minimal_cut_sets"] == []
    assert len(result["failure_conditions"]) == 2


def test_event_exposure_override_scales_static_time_curve_to_mission_point():
    nodes = [
        _node("top", "or", label="TOP"),
        _node("a", "basic", label="A", distribution="exponential",
              dist_params={"lambda": 0.01}, exposure_time=50),
        _node("b", "basic", label="B", distribution="exponential",
              dist_params={"lambda": 0.02}),
    ]
    result = analyze_fault_tree(_req(
        nodes, [("top", "a"), ("top", "b")], exposure_time=100))
    q_a = 1 - math.exp(-0.01 * 50)
    q_b = 1 - math.exp(-0.02 * 100)
    expected = 1 - (1 - q_a) * (1 - q_b)
    assert result["top_event_probability"] == pytest.approx(expected)
    assert result["time_curve"][-1]["time"] == 100
    assert result["time_curve"][-1]["probability"] == pytest.approx(expected)


def test_event_exposure_override_scales_exact_dynamic_calendar_rate():
    nodes = [
        _node("top", "pand", label="TOP"),
        _node("a", "basic", label="A", distribution="exponential",
              dist_params={"lambda": 0.001}, exposure_time=500),
        _node("b", "basic", label="B", distribution="exponential",
              dist_params={"lambda": 0.001}),
    ]
    request = FaultTreeRequest(
        nodes=nodes,
        edges=[FTEdge(source="top", target="a", order=0),
               FTEdge(source="top", target="b", order=1)],
        exposure_time=1000,
    )
    result = analyze_fault_tree(request)
    rate_a, rate_b, mission = 0.0005, 0.001, 1000
    expected = ((1 - math.exp(-rate_b * mission))
                - rate_b / (rate_a + rate_b)
                * (1 - math.exp(-(rate_a + rate_b) * mission)))
    assert result["top_event_probability"] == pytest.approx(expected)
    assert result["computation"]["exact_engine"]["engine"] == "ordered_failure_ctmc"


def test_beta_factor_common_cause_is_exact_and_preserves_marginals():
    nodes = [
        _node("top", "and", label="TOP"),
        _node("a", "basic", label="A", probability=0.1,
              ccf_group="redundant", ccf_beta=0.2),
        _node("b", "basic", label="B", probability=0.1,
              ccf_group="redundant", ccf_beta=0.2),
    ]
    result = analyze_fault_tree(_req(
        nodes, [("top", "a"), ("top", "b")], methods=["exact"]))

    q_common = 0.2 * 0.1
    q_individual = (0.1 - q_common) / (1.0 - q_common)
    expected = q_common + (1.0 - q_common) * q_individual ** 2
    assert result["top_event_probability"] == pytest.approx(expected, rel=1e-10)
    assert result["top_event_probability"] > 0.01
    assert result["dependency_model"]["model"] == "beta_factor"
    assert result["dependency_model"]["groups"][0]["members"] == ["A", "B"]
    assert result["computation"]["exact_engine"]["exact"] is True


# --- #6 formulas --------------------------------------------------------------

def test_formulas_returned():
    nodes = [
        _node("top", "or", label="TOP"),
        _node("g1", "and", label="G1"),
        _node("a", "basic", label="A", probability=0.1),
        _node("b", "basic", label="B", probability=0.1),
        _node("c", "basic", label="C", probability=0.05),
    ]
    edges = [("top", "g1"), ("top", "c"), ("g1", "a"), ("g1", "b")]
    res = analyze_fault_tree(_req(nodes, edges))
    f = res["formulas"]
    assert "AND" in f["boolean_expression"]
    assert "OR" in f["boolean_expression"]
    assert f["probability_expression"].startswith("P(TOP)")
    # One cut set is {A,B} -> product P(A) * P(B); another is {C}.
    cut_formulas = {tuple(c["events"]): c for c in f["cut_sets"]}
    ab = cut_formulas[("A", "B")]
    assert ab["formula"] == "P(A) * P(B)"
    assert ab["value"] == pytest.approx(0.01, rel=1e-9)


# --- #9 transfer gate expansion -----------------------------------------------

def test_transfer_gate_expansion():
    """A Transfer gate substitutes the referenced tree's top event."""
    # Sub-tree S: OR(X, Y)
    sub = FaultTreeGraph(
        nodes=[
            _node("s_top", "or", label="S_TOP"),
            _node("x", "basic", label="X", probability=0.1),
            _node("y", "basic", label="Y", probability=0.2),
        ],
        edges=[FTEdge(source="s_top", target="x"),
               FTEdge(source="s_top", target="y")],
    )
    # Main tree: AND(Z, TRANSFER->S)
    nodes = [
        _node("top", "and", label="TOP"),
        _node("z", "basic", label="Z", probability=0.5),
        _node("xfer", "transfer", label="XFER", transferTo="S"),
    ]
    edges = [("top", "z"), ("top", "xfer")]
    res = analyze_fault_tree(_req(
        nodes, edges, methods=["exact"], trees={"S": sub}, tree_id="main"))
    # Cut sets of TOP = AND(Z, OR(X,Y)) = {Z,X}, {Z,Y}. Events pulled in via the
    # transfer gate are namespaced with their referenced-tree provenance so they
    # cannot collide with the parent tree's (independently-numbered) events (#1).
    flat = [set(m) for m in res["minimal_cut_sets"]]
    assert len(flat) == 2
    assert all("Z" in cs for cs in flat)
    xfer_events = sorted(e for cs in flat for e in cs if e != "Z")
    assert any(e.endswith("X") for e in xfer_events)
    assert any(e.endswith("Y") for e in xfer_events)
    assert all(e.startswith("XFER") for e in xfer_events)
    # Exact P = P(Z) * P(OR(X,Y)) = 0.5 * (1 - 0.9*0.8) = 0.5 * 0.28 = 0.14
    assert res["top_event_probability"] == pytest.approx(0.14, rel=1e-6)


def test_unknown_transfer_target_uses_friendly_analysis_name():
    nodes = [_node(
        "xfer", "transfer", label="Cooling subsystem transfer",
        transferTo="fmrr8jusf0", transferToName="Cooling Subsystem FTA",
    )]
    with pytest.raises(Exception) as exc:
        analyze_fault_tree(_req(nodes, []))
    message = str(exc.value)
    assert "Cooling Subsystem FTA" in message
    assert "unknown tree 'fmrr8jusf0'" not in message


def test_transfer_cycle_detected():
    a = FaultTreeGraph(
        nodes=[_node("a_top", "transfer", label="A_T", transferTo="B")],
        edges=[],
    )
    b = FaultTreeGraph(
        nodes=[_node("b_top", "transfer", label="B_T", transferTo="A")],
        edges=[],
    )
    nodes = [_node("top", "transfer", label="TOP", transferTo="A")]
    with pytest.raises(Exception) as exc:
        analyze_fault_tree(_req(nodes, [], trees={"A": a, "B": b}, tree_id="main"))
    assert "cycle" in str(exc.value).lower()


# --- sanitization -------------------------------------------------------------

def test_non_finite_floats_sanitized():
    """RAW/RRW can be infinite; the response must contain only finite floats
    or None (valid JSON)."""
    nodes = [
        _node("top", "and", label="TOP"),
        _node("a", "basic", label="A", probability=0.1),
        _node("b", "basic", label="B", probability=0.2),
    ]
    edges = [("top", "a"), ("top", "b")]
    res = analyze_fault_tree(_req(nodes, edges))

    def check(x):
        if isinstance(x, float):
            assert math.isfinite(x)
        elif isinstance(x, dict):
            for v in x.values():
                check(v)
        elif isinstance(x, list):
            for v in x:
                check(v)

    check(res)
