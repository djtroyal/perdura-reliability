"""State-of-the-art RBD validation, time-model, and exactness contracts."""

import math
import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from routers.system_reliability import compute_rbd, validate_rbd  # noqa: E402
from schemas import RBDRequest  # noqa: E402


def request(nodes, edges, **options):
    return RBDRequest.model_validate({"nodes": nodes, "edges": edges, **options})


def series_nodes(*component_data):
    nodes = [
        {"id": "source", "type": "source", "data": {"label": "Source"}},
        {"id": "sink", "type": "sink", "data": {"label": "Sink"}},
    ]
    edges = []
    previous = "source"
    for index, data in enumerate(component_data, start=1):
        component_id = f"c{index}"
        nodes.append({"id": component_id, "type": "component", "data": data})
        edges.append({"id": f"e{index}a", "source": previous, "target": component_id})
        previous = component_id
    edges.append({"id": "e-sink", "source": previous, "target": "sink"})
    return nodes, edges


def issue_codes(response):
    return {issue["code"] for issue in response["issues"]}


def test_validation_reports_actionable_terminal_cycle_and_path_errors():
    nodes, edges = series_nodes({"label": "A", "reliability": 0.9})
    edges.extend([
        {"id": "bad-source", "source": "c1", "target": "source"},
        {"id": "bad-sink", "source": "sink", "target": "c1"},
    ])
    result = validate_rbd(request(nodes, edges))

    assert result["valid"] is False
    assert {"SOURCE_HAS_INPUT", "SINK_HAS_OUTPUT", "CAUSAL_CYCLE"} <= issue_codes(result)


def test_validation_identifies_disconnected_and_incomplete_blocks():
    nodes, edges = series_nodes({"label": "Connected", "reliability": 0.9})
    nodes.append({"id": "orphan", "type": "component", "data": {"label": "Orphan", "reliability": 0.8}})
    result = validate_rbd(request(nodes, edges))

    assert result["valid"] is False
    orphan_issues = [issue for issue in result["issues"] if issue.get("node_id") == "orphan"]
    assert {issue["code"] for issue in orphan_issues} == {"INCOMPLETE_COMPONENT", "OFF_PATH_COMPONENT"}


def test_validation_warns_that_direct_terminal_connection_is_perfect_bypass():
    nodes, edges = series_nodes({"label": "A", "reliability": 0.9})
    edges.append({"id": "bypass", "source": "source", "target": "sink"})
    result = validate_rbd(request(nodes, edges))

    assert result["valid"] is True
    assert "PERFECT_BYPASS" in issue_codes(result)


def test_parametric_series_curve_is_monotone_and_matches_endpoint_result():
    nodes, edges = series_nodes(
        {"label": "A", "distribution": "exponential", "dist_params": {"lambda": 0.001}, "mission_time": 1000},
        {"label": "B", "distribution": "exponential", "dist_params": {"lambda": 0.002}, "mission_time": 1000},
    )
    result = compute_rbd(request(nodes, edges, mission_time=1000, time_points=51))
    curve = result["time_curve"]

    assert len(curve) == 51
    assert curve[0]["reliability"] == pytest.approx(1.0)
    assert curve[-1]["reliability"] == pytest.approx(
        result["system_reliability"], abs=5e-7)
    assert result["system_reliability"] == pytest.approx(math.exp(-3), abs=5e-7)
    assert all(left["reliability"] >= right["reliability"] for left, right in zip(curve, curve[1:]))
    assert 0 < result["restricted_mean_survival_time"] < 1000


def test_parametric_blocks_inherit_system_mission_time():
    nodes, edges = series_nodes(
        {"label": "A", "distribution": "exponential", "dist_params": {"lambda": 0.001}},
        {"label": "B", "distribution": "exponential", "dist_params": {"lambda": 0.002}},
    )

    result = compute_rbd(request(nodes, edges, mission_time=1000, time_points=11))

    assert result["system_reliability"] == pytest.approx(math.exp(-3), abs=5e-7)
    assert result["time_curve"][-1]["reliability"] == pytest.approx(
        result["system_reliability"], abs=5e-7)


def test_component_mission_time_is_an_explicit_scaled_exposure_override():
    nodes, edges = series_nodes(
        {"label": "A", "distribution": "exponential", "dist_params": {"lambda": 0.001},
         "mission_time": 500},
    )

    result = compute_rbd(request(nodes, edges, mission_time=1000, time_points=3))

    assert result["system_reliability"] == pytest.approx(math.exp(-0.5), abs=5e-7)
    assert result["time_curve"][0]["reliability"] == pytest.approx(1.0)
    assert result["time_curve"][1]["reliability"] == pytest.approx(math.exp(-0.25))
    assert result["time_curve"][-1]["reliability"] == pytest.approx(
        result["system_reliability"], abs=5e-7)


def test_direct_probability_model_explains_why_time_curve_is_unavailable():
    nodes, edges = series_nodes({"label": "A", "reliability": 0.9})
    result = compute_rbd(request(nodes, edges, mission_time=1000))

    assert result["time_curve"] == []
    assert result["restricted_mean_survival_time"] is None
    reason = result["time_curve_unavailable_reason"]
    assert "System mission time t = 1000 is active" in reason
    assert "Assign a life distribution to A" in reason
    assert "Set a system mission time" not in reason


def test_curve_guidance_only_requests_mission_time_when_life_models_are_complete():
    nodes, edges = series_nodes(
        {"label": "A", "distribution": "exponential", "dist_params": {"lambda": 0.001},
         "mission_time": 500},
    )

    result = compute_rbd(request(nodes, edges))

    assert result["time_curve"] == []
    assert result["time_curve_unavailable_reason"] == (
        "Set a system mission time to calculate R(t)."
    )


def test_parallel_exact_probability_and_importance_remain_correct():
    nodes = [
        {"id": "source", "type": "source"},
        {"id": "sink", "type": "sink"},
        {"id": "a", "type": "component", "data": {"label": "A", "reliability": 0.9}},
        {"id": "b", "type": "component", "data": {"label": "B", "reliability": 0.8}},
    ]
    edges = [
        {"source": "source", "target": "a"}, {"source": "a", "target": "sink"},
        {"source": "source", "target": "b"}, {"source": "b", "target": "sink"},
    ]
    result = compute_rbd(request(nodes, edges))

    assert result["system_reliability"] == pytest.approx(0.98)
    assert result["computation"]["exact"] is True
    assert result["computation"]["path_enumeration_used_for_probability"] is False
    importance = {item["id"]: item for item in result["importance"]}
    assert importance["a"]["Birnbaum"] == pytest.approx(0.2)
    assert importance["b"]["Birnbaum"] == pytest.approx(0.1)
    assert result["path_node_ids"] == [["a"], ["b"]]


def test_k_out_of_n_voting_supports_heterogeneous_parallel_blocks_exactly():
    nodes = [
        {"id": "source", "type": "source"},
        {"id": "sink", "type": "sink"},
        {"id": "a", "type": "component", "data": {"label": "A", "reliability": 0.9}},
        {"id": "b", "type": "component", "data": {"label": "B", "reliability": 0.8}},
        {"id": "c", "type": "component", "data": {"label": "C", "reliability": 0.7}},
        {"id": "vote", "type": "kofn", "data": {"label": "Channel vote", "k": 2}},
    ]
    edges = []
    for member in ("a", "b", "c"):
        edges.extend([
            {"id": f"in-{member}", "source": "source", "target": member},
            {"id": f"out-{member}", "source": member, "target": "vote"},
        ])
    edges.append({"id": "vote-sink", "source": "vote", "target": "sink"})

    result = compute_rbd(request(nodes, edges))

    # P(at least two survive) for independent, non-identical members.
    expected = 0.9 * 0.8 + 0.9 * 0.7 + 0.8 * 0.7 - 2 * 0.9 * 0.8 * 0.7
    assert result["system_reliability"] == pytest.approx(expected)
    assert result["computation"]["threshold_groups"] == 1
    assert result["voting_groups"] == [{
        "id": "vote", "label": "Channel vote", "k": 2, "n": 3,
        "member_ids": ["a", "b", "c"], "member_labels": ["A", "B", "C"],
    }]
    assert len(result["path_sets"]) == 3
    assert {tuple(path) for path in result["path_node_ids"]} == {
        ("a", "b", "vote"), ("a", "c", "vote"), ("b", "c", "vote"),
    }
    assert all("vote-sink" in edge_ids for edge_ids in result["path_edge_ids"])
    assert any(formula["label"] == "K-out-of-n voting" for formula in result["formulas"])


def test_k_out_of_n_validation_accepts_two_or_more_subsystem_inputs_but_checks_k():
    nodes = [
        {"id": "source", "type": "source"},
        {"id": "sink", "type": "sink"},
        {"id": "a", "type": "component", "data": {"reliability": 0.9}},
        {"id": "b", "type": "component", "data": {"reliability": 0.8}},
        {"id": "vote", "type": "kofn", "data": {"k": 3}},
    ]
    edges = [
        {"source": "source", "target": "a"},
        {"source": "a", "target": "vote"},
        {"source": "source", "target": "b"},
        {"source": "b", "target": "vote"},
        {"source": "vote", "target": "sink"},
    ]

    result = validate_rbd(request(nodes, edges))

    assert result["valid"] is False
    assert issue_codes(result) >= {"KOFN_THRESHOLD"}
    assert "KOFN_MEMBER_COUNT" not in issue_codes(result)


def test_k_out_of_n_counts_complete_upstream_subsystem_outcomes():
    nodes = [
        {"id": "source", "type": "source"}, {"id": "sink", "type": "sink"},
        {"id": "a1", "type": "component", "data": {"reliability": 0.9}},
        {"id": "a2", "type": "component", "data": {"reliability": 0.8}},
        {"id": "b1", "type": "component", "data": {"reliability": 0.7}},
        {"id": "b2", "type": "component", "data": {"reliability": 0.6}},
        {"id": "vote", "type": "kofn", "data": {"label": "Subsystem vote", "k": 2}},
    ]
    edges = [
        {"id": "s-a1", "source": "source", "target": "a1"},
        {"id": "a1-a2", "source": "a1", "target": "a2"},
        {"id": "a2-v", "source": "a2", "target": "vote"},
        {"id": "s-b1", "source": "source", "target": "b1"},
        {"id": "b1-b2", "source": "b1", "target": "b2"},
        {"id": "b2-v", "source": "b2", "target": "vote"},
        {"id": "v-t", "source": "vote", "target": "sink"},
    ]

    validation = validate_rbd(request(nodes, edges))
    result = compute_rbd(request(nodes, edges))

    assert validation["valid"] is True
    assert result["system_reliability"] == pytest.approx(0.9 * 0.8 * 0.7 * 0.6)
    assert result["voting_groups"][0]["member_ids"] == ["a2", "b2"]
    assert result["computation"]["engine"] == "reduced_bdd_network_connectivity"
    assert result["computation"]["formulation"] == "forward_reachability"


def test_mirrored_occurrences_share_one_exact_survival_variable():
    nodes = [
        {"id": "source", "type": "source"},
        {"id": "sink", "type": "sink"},
        {"id": "a1", "type": "component", "data": {
            "label": "Shared valve", "component_key": "VALVE-1", "reliability": 0.9}},
        {"id": "a2", "type": "component", "data": {
            "label": "Shared valve", "component_key": "VALVE-1", "reliability": 0.9}},
    ]
    edges = [
        {"source": "source", "target": "a1"}, {"source": "a1", "target": "sink"},
        {"source": "source", "target": "a2"}, {"source": "a2", "target": "sink"},
    ]
    result = compute_rbd(request(nodes, edges))

    # Two diagram paths do not manufacture redundancy: both occurrences are
    # the same physical success variable.
    assert result["system_reliability"] == pytest.approx(0.9)
    assert len(result["importance"]) == 1
    assert result["importance"][0]["id"] == "VALVE-1"
    assert result["importance"][0]["node_ids"] == ["a1", "a2"]
    assert all(component["mirrored"] for component in result["components"])


def test_inconsistent_mirror_models_fail_validation():
    nodes = [
        {"id": "source", "type": "source"}, {"id": "sink", "type": "sink"},
        {"id": "a1", "type": "component", "data": {
            "label": "Shared valve", "component_key": "VALVE-1", "reliability": 0.9}},
        {"id": "a2", "type": "component", "data": {
            "label": "Shared valve", "component_key": "VALVE-1", "reliability": 0.8}},
    ]
    edges = [
        {"source": "source", "target": "a1"}, {"source": "a1", "target": "sink"},
        {"source": "source", "target": "a2"}, {"source": "a2", "target": "sink"},
    ]
    result = validate_rbd(request(nodes, edges))

    assert result["valid"] is False
    assert "INCONSISTENT_MIRROR_MODEL" in issue_codes(result)
