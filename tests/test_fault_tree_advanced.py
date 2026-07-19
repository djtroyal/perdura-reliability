"""Decision-grade contracts for Perdura's static and dynamic FTA engines."""

from __future__ import annotations

import math

import pytest

from reliability.FaultTreeAdvanced import (
    CONSTRAINT_TYPES,
    DYNAMIC_GATE_TYPES,
    DynamicExactIneligible,
    FaultTreeValidationError,
    PASS_THROUGH_TYPES,
    STATIC_GATE_TYPES,
    compile_graph,
    dynamic_exact_eligibility,
    evaluate_dynamic,
    evaluate_dynamic_exact,
    evaluate_static,
)
from reliability.FaultTreeOpenPSA import OpenPSAError, export_openpsa, import_openpsa


def _event(node_id: str, probability: float = 0.1, **data):
    return {
        "id": node_id,
        "type": "basic",
        "data": {"label": node_id, "eventKey": node_id,
                 "probability": probability, **data},
    }


def _static_gate(gate_type: str, *, data=None):
    nodes = [
        {"id": "G", "type": gate_type,
         "data": {"label": gate_type.upper(), **(data or {})}},
        _event("A", 0.2),
        _event("B", 0.3),
    ]
    edges = [
        {"source": "G", "target": "A", "order": 0},
        {"source": "G", "target": "B", "order": 1},
    ]
    graph = compile_graph(nodes, edges)
    return evaluate_static(graph, {"A": 0.2, "B": 0.3})


ALL_GATE_TYPES = sorted(
    STATIC_GATE_TYPES | DYNAMIC_GATE_TYPES | CONSTRAINT_TYPES | PASS_THROUGH_TYPES
)


@pytest.mark.parametrize("gate_type", ALL_GATE_TYPES)
def test_every_supported_gate_type_is_exercised(gate_type):
    """Compile and evaluate a valid model that actually contains each gate type."""
    timed = gate_type in DYNAMIC_GATE_TYPES | CONSTRAINT_TYPES
    event_data = ({"distribution": "exponential", "dist_params": {"lambda": 0.1}}
                  if timed else {})
    a = _event("A", 0.2, **event_data)
    b = _event("B", 0.3, **event_data)

    if gate_type == "fdep":
        nodes = [
            {"id": "TOP", "type": "or", "data": {"label": "TOP"}},
            {"id": "G", "type": "fdep", "data": {"label": "FDEP"}},
            a, b,
        ]
        edges = [
            {"source": "TOP", "target": "B", "order": 0},
            {"source": "G", "target": "A", "role": "trigger", "order": 0},
            {"source": "G", "target": "B", "role": "dependent", "order": 1},
        ]
    elif gate_type == "seq":
        nodes = [
            {"id": "TOP", "type": "and", "data": {"label": "TOP"}},
            {"id": "G", "type": "seq", "data": {"label": "SEQ"}},
            a, b,
        ]
        edges = [
            {"source": "TOP", "target": "A", "order": 0},
            {"source": "TOP", "target": "B", "order": 1},
            {"source": "G", "target": "A", "order": 0},
            {"source": "G", "target": "B", "order": 1},
        ]
    else:
        data = {"label": gate_type.upper()}
        if gate_type == "vote":
            data["k"] = 2
        elif gate_type == "cardinality":
            data.update({"min": 1, "max": 2})
        elif gate_type == "spare":
            data.update({"spare_mode": "cold", "dormancy_factor": 0, "coverage": 1})
        child_ids = ["A"] if gate_type in {"not", "transfer"} else ["A", "B"]
        events = {"A": a, "B": b}
        nodes = [
            {"id": "G", "type": gate_type, "data": data},
            *(events[child_id] for child_id in child_ids),
        ]
        edges = [
            {"source": "G", "target": child_id, "order": order}
            for order, child_id in enumerate(child_ids)
        ]

    graph = compile_graph(nodes, edges)
    assert any(node.type == gate_type for node in graph.nodes.values())
    if timed:
        result = evaluate_dynamic(
            graph,
            5.0,
            {
                "A": {"distribution": "exponential", "dist_params": {"lambda": 0.1}},
                "B": {"distribution": "exponential", "dist_params": {"lambda": 0.1}},
            },
            n_simulations=256,
            seed=417,
            time_grid=[0, 5],
        )
    else:
        result = evaluate_static(graph, {"A": 0.2, "B": 0.3})
    assert math.isfinite(result.top_probability)
    assert 0 <= result.top_probability <= 1


@pytest.mark.parametrize(
    ("gate_type", "data", "expected"),
    [
        ("and", {}, 0.06),
        ("or", {}, 0.44),
        ("vote", {"k": 2}, 0.06),
        ("cardinality", {"min": 1, "max": 1}, 0.38),
        ("xor", {}, 0.38),
        ("nand", {}, 0.94),
        ("nor", {}, 0.56),
        ("iff", {}, 0.62),
        ("imply", {}, 0.86),
        ("inhibit", {}, 0.06),
    ],
)
def test_static_gate_truth_tables_are_exact(gate_type, data, expected):
    result = _static_gate(gate_type, data=data)
    assert result.top_probability == pytest.approx(expected, abs=1e-14)


def test_not_is_noncoherent_and_has_signed_importance():
    graph = compile_graph(
        [{"id": "G", "type": "not", "data": {"label": "NOT"}},
         _event("A", 0.2)],
        [{"source": "G", "target": "A"}],
    )
    result = evaluate_static(graph, {"A": 0.2})
    assert result.top_probability == pytest.approx(0.8)
    assert graph.coherent is False
    assert result.importance[0]["Birnbaum"] == pytest.approx(-1.0)
    assert result.importance[0]["Fussell-Vesely"] is None


def test_single_input_or_is_a_valid_pass_through_gate():
    graph = compile_graph(
        [{"id": "G", "type": "or", "data": {"label": "Top function"}},
         _event("A", 0.2)],
        [{"source": "G", "target": "A", "order": 0}],
    )
    result = evaluate_static(graph, {"A": 0.2})
    assert result.top_probability == pytest.approx(0.2)
    assert graph.root_id == "G"


def test_noncoherent_conditions_are_disjoint_and_sum_to_exact_probability():
    result = _static_gate("xor")
    assert all(row["kind"] == "disjoint_failure_condition"
               for row in result.conditions)
    assert sum(row["probability"] for row in result.conditions) == pytest.approx(
        result.top_probability)
    assert {tuple(row["required_failed"]) for row in result.conditions} == {
        ("A",), ("B",),
    }


def test_display_labels_do_not_create_shared_event_identity():
    nodes = [
        {"id": "G", "type": "and", "data": {"label": "TOP"}},
        {"id": "A1", "type": "basic", "data": {"label": "Same", "probability": 0.2}},
        {"id": "A2", "type": "basic", "data": {"label": "Same", "probability": 0.2}},
    ]
    graph = compile_graph(nodes, [
        {"source": "G", "target": "A1"},
        {"source": "G", "target": "A2"},
    ])
    result = evaluate_static(graph, {"A1": 0.2, "A2": 0.2})
    assert result.top_probability == pytest.approx(0.04)


def test_invalid_cardinality_and_dynamic_roles_return_structured_validation():
    with pytest.raises(FaultTreeValidationError) as cardinality:
        compile_graph(
            [{"id": "G", "type": "cardinality", "data": {"min": 2, "max": 1}},
             _event("A"), _event("B")],
            [{"source": "G", "target": "A"}, {"source": "G", "target": "B"}],
        )
    assert any(issue["code"] == "CARDINALITY_RANGE"
               for issue in cardinality.value.issues)

    with pytest.raises(FaultTreeValidationError) as fdep:
        compile_graph(
            [{"id": "G", "type": "and", "data": {}},
             {"id": "D", "type": "fdep", "data": {}},
             _event("A", distribution="exponential", dist_params={"lambda": 0.1}),
             _event("B", distribution="exponential", dist_params={"lambda": 0.1})],
            [{"source": "G", "target": "A"}, {"source": "G", "target": "B"},
             {"source": "D", "target": "A", "role": "trigger"},
             {"source": "D", "target": "B", "role": "trigger"}],
        )
    assert any(issue["code"] == "FDEP_ROLES" for issue in fdep.value.issues)


def _exponential_dynamic(gate_type: str, lambda_a=0.1, lambda_b=0.2):
    nodes = [
        {"id": "G", "type": gate_type, "data": {"label": gate_type.upper()}},
        _event("A", distribution="exponential", dist_params={"lambda": lambda_a}),
        _event("B", distribution="exponential", dist_params={"lambda": lambda_b}),
    ]
    edges = [
        {"source": "G", "target": "A", "order": 0},
        {"source": "G", "target": "B", "order": 1},
    ]
    models = {
        "A": {"distribution": "exponential", "dist_params": {"lambda": lambda_a}},
        "B": {"distribution": "exponential", "dist_params": {"lambda": lambda_b}},
    }
    return compile_graph(nodes, edges), models


def test_exact_pand_matches_closed_form_and_preserves_order():
    graph, models = _exponential_dynamic("pand")
    result = evaluate_dynamic_exact(graph, 5.0, models, time_grid=[0, 5])
    expected = ((1 - math.exp(-0.2 * 5))
                - 0.2 / 0.3 * (1 - math.exp(-0.3 * 5)))
    assert result.top_probability == pytest.approx(expected, abs=1e-12)
    assert result.sequences[0]["events"] == ["A", "B"]
    assert result.diagnostics["engine"] == "ordered_failure_ctmc"
    assert result.diagnostics["exact"] is True


def test_exact_por_matches_competing_risk_closed_form():
    graph, models = _exponential_dynamic("por")
    result = evaluate_dynamic_exact(graph, 5.0, models, time_grid=[0, 5])
    expected = 0.1 / 0.3 * (1 - math.exp(-0.3 * 5))
    assert result.top_probability == pytest.approx(expected, abs=1e-12)


def test_exact_dynamic_fails_closed_outside_eligibility_class():
    graph, models = _exponential_dynamic("spare")
    eligibility = dynamic_exact_eligibility(graph, models)
    assert eligibility["eligible"] is False
    assert any("SPARE" in reason for reason in eligibility["reasons"])
    with pytest.raises(DynamicExactIneligible):
        evaluate_dynamic_exact(graph, 5.0, models)


@pytest.mark.parametrize("construct", ["spare", "seq"])
def test_spare_and_sequence_match_two_stage_erlang(construct):
    rate = 0.2
    if construct == "spare":
        graph, models = _exponential_dynamic("spare", rate, rate)
    else:
        nodes = [
            {"id": "G", "type": "and", "data": {"label": "TOP"}},
            {"id": "S", "type": "seq", "data": {"label": "SEQ"}},
            _event("A", distribution="exponential", dist_params={"lambda": rate}),
            _event("B", distribution="exponential", dist_params={"lambda": rate}),
        ]
        graph = compile_graph(nodes, [
            {"source": "G", "target": "A"}, {"source": "G", "target": "B"},
            {"source": "S", "target": "A", "order": 0},
            {"source": "S", "target": "B", "order": 1},
        ])
        models = {
            "A": {"distribution": "exponential", "dist_params": {"lambda": rate}},
            "B": {"distribution": "exponential", "dist_params": {"lambda": rate}},
        }
    result = evaluate_dynamic(
        graph, 5.0, models, n_simulations=30_000, seed=917,
        time_grid=[0, 5],
    )
    expected = 1 - math.exp(-rate * 5) * (1 + rate * 5)
    assert result.top_probability == pytest.approx(expected, abs=0.012)


def test_fdep_forces_declared_dependent_at_trigger_time():
    nodes = [
        {"id": "G", "type": "or", "data": {"label": "TOP"}},
        {"id": "D", "type": "fdep", "data": {"label": "FDEP"}},
        _event("A", distribution="exponential", dist_params={"lambda": 0.1}),
        _event("B", distribution="exponential", dist_params={"lambda": 0.001}),
    ]
    graph = compile_graph(nodes, [
        {"source": "G", "target": "B"},
        {"source": "D", "target": "A", "role": "trigger", "order": 0},
        {"source": "D", "target": "B", "role": "dependent", "order": 1},
    ])
    models = {
        "A": {"distribution": "exponential", "dist_params": {"lambda": 0.1}},
        "B": {"distribution": "exponential", "dist_params": {"lambda": 0.001}},
    }
    result = evaluate_dynamic(
        graph, 5.0, models, n_simulations=30_000, seed=11,
        time_grid=[0, 5],
    )
    assert result.top_probability == pytest.approx(1 - math.exp(-0.5), abs=0.012)


def test_dynamic_tree_rejects_point_probabilities_without_time_models():
    with pytest.raises(FaultTreeValidationError) as caught:
        compile_graph(
            [{"id": "G", "type": "pand", "data": {}}, _event("A"), _event("B")],
            [{"source": "G", "target": "A"}, {"source": "G", "target": "B"}],
        )
    assert sum(issue["code"] == "DYNAMIC_TIME_MODEL_REQUIRED"
               for issue in caught.value.issues) == 2


def test_sequence_cycles_and_shared_spare_resources_fail_closed():
    timed_a = _event("A", distribution="exponential", dist_params={"lambda": 0.1})
    timed_b = _event("B", distribution="exponential", dist_params={"lambda": 0.1})
    with pytest.raises(FaultTreeValidationError) as sequence:
        compile_graph(
            [{"id": "TOP", "type": "or", "data": {}},
             {"id": "S1", "type": "seq", "data": {}},
             {"id": "S2", "type": "seq", "data": {}}, timed_a, timed_b],
            [{"source": "TOP", "target": "A"},
             {"source": "S1", "target": "A", "order": 0},
             {"source": "S1", "target": "B", "order": 1},
             {"source": "S2", "target": "B", "order": 0},
             {"source": "S2", "target": "A", "order": 1}],
        )
    assert any(issue["code"] == "SEQ_CYCLE" for issue in sequence.value.issues)

    with pytest.raises(FaultTreeValidationError) as spare:
        compile_graph(
            [{"id": "TOP", "type": "or", "data": {}},
             {"id": "P1", "type": "spare", "data": {}},
             {"id": "P2", "type": "spare", "data": {}},
             timed_a, timed_b,
             _event("C", distribution="exponential", dist_params={"lambda": 0.1})],
            [{"source": "TOP", "target": "P1"}, {"source": "TOP", "target": "P2"},
             {"source": "P1", "target": "A"}, {"source": "P1", "target": "B"},
             {"source": "P2", "target": "C"}, {"source": "P2", "target": "B"}],
        )
    assert any(issue["code"] == "SHARED_SPARE_RESOURCE"
               for issue in spare.value.issues)


def test_openpsa_round_trip_preserves_static_probability():
    nodes = [
        {"id": "TOP", "type": "or", "data": {"label": "TOP"}},
        _event("A", 0.1), _event("B", 0.2),
    ]
    edges = [{"source": "TOP", "target": "A"},
             {"source": "TOP", "target": "B"}]
    exported = export_openpsa(nodes, edges, tree_name="Example")
    imported = import_openpsa(exported["xml"])
    graph = compile_graph(imported["nodes"], imported["edges"])
    probabilities = {
        node["data"]["eventKey"]: node["data"]["probability"]
        for node in imported["nodes"] if node["type"] == "basic"
    }
    result = evaluate_static(graph, probabilities)
    assert result.top_probability == pytest.approx(0.28)
    assert imported["top_event"] == "TOP"


@pytest.mark.parametrize("declaration", [
    '<!DOCTYPE opsa-mef SYSTEM "file:///etc/passwd">',
    '<!ENTITY xxe SYSTEM "file:///etc/passwd">',
])
def test_openpsa_rejects_dtd_and_entity_declarations(declaration):
    with pytest.raises(OpenPSAError) as caught:
        import_openpsa(f'{declaration}<opsa-mef/>')
    assert caught.value.code == "OPENPSA_UNSAFE_XML"


def test_openpsa_incomplete_source_is_visible_and_cannot_be_silent():
    imported = import_openpsa("""
      <opsa-mef><define-fault-tree name="T">
        <define-gate name="TOP"><basic-event name="A"/></define-gate>
        <define-basic-event name="A"><parameter name="q_A"/></define-basic-event>
      </define-fault-tree></opsa-mef>
    """)
    event = next(node for node in imported["nodes"] if node["type"] == "basic")
    assert event["data"]["sourceIncomplete"] is True
    assert event["data"]["probability"] == 0.0
    assert any(warning["code"] == "OPENPSA_SOURCE_INCOMPLETE"
               for warning in imported["warnings"])
