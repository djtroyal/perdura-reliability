"""Tests for the enhanced Fault Tree backend router (#6, #7, #8, #9)."""

import sys
import math
import pytest
from pathlib import Path

# Make the FastAPI backend importable (router + schemas).
BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

from routers.fault_tree import analyze_fault_tree  # noqa: E402
from schemas import FaultTreeRequest, FTNode, FTEdge, FaultTreeGraph  # noqa: E402


def _node(nid, ntype, **data):
    return FTNode(id=nid, type=ntype, data=data)


def _req(nodes, edges, **kw):
    return FaultTreeRequest(
        nodes=nodes,
        edges=[FTEdge(source=s, target=t) for s, t in edges],
        **kw,
    )


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
