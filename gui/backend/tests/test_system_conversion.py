"""Exact RBD/FTA conversion contracts."""

import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from routers.system_conversion import fta_to_rbd, rbd_to_fta  # noqa: E402
from routers import system_conversion as system_conversion_router  # noqa: E402
from routers.fault_tree import _analyze  # noqa: E402
from routers.system_reliability import compute_rbd  # noqa: E402
from reliability.FaultTreeAdvanced import BDDStateLimitError  # noqa: E402
from reliability.SystemModelConversion import ModelConversionError  # noqa: E402
from schemas import (  # noqa: E402
    FTAToRBDConversionRequest, FaultTreeRequest, RBDRequest,
    RBDToFTAConversionRequest,
)


def _raise(error):
    def fail(*_args, **_kwargs):
        raise error

    return fail


def _valid_rbd_conversion_request() -> RBDToFTAConversionRequest:
    return RBDToFTAConversionRequest.model_validate({
        "mission_time": 100,
        "nodes": [
            {"id": "source", "type": "source"},
            {"id": "component-a", "type": "component", "data": {
                "label": "Component A", "reliability": 0.9,
            }},
            {"id": "sink", "type": "sink"},
        ],
        "edges": [
            {"source": "source", "target": "component-a"},
            {"source": "component-a", "target": "sink"},
        ],
    })


def _valid_fta_conversion_request() -> FTAToRBDConversionRequest:
    return FTAToRBDConversionRequest.model_validate({
        "exposure_time": 100,
        "nodes": [
            {"id": "top", "type": "or", "data": {"label": "Top event"}},
            {"id": "event-a", "type": "basic", "data": {
                "label": "Event A", "eventKey": "event-a", "probability": 0.1,
            }},
        ],
        "edges": [{"source": "top", "target": "event-a", "order": 0}],
    })


@pytest.mark.parametrize(
    ("direction", "error_kind", "expected_code"),
    [
        ("rbd", "conversion", "DANGLING_EDGE"),
        ("rbd", "bdd", "EQUIVALENCE_LIMIT"),
        ("rbd", "value", "INVALID_RBD"),
        ("fta", "conversion", "DANGLING_EDGE"),
        ("fta", "bdd", "EQUIVALENCE_LIMIT"),
        ("fta", "value", "INVALID_FTA"),
    ],
)
def test_conversion_failures_do_not_expose_exception_text(
    monkeypatch, direction, error_kind, expected_code,
):
    secret = "SECRET database path /srv/private/perdura.db"
    if error_kind == "conversion":
        error = ModelConversionError(
            "DANGLING_EDGE", secret, node_id="component-a",
        )
    elif error_kind == "bdd":
        error = BDDStateLimitError(secret)
    else:
        error = ValueError(secret)

    if direction == "rbd":
        monkeypatch.setattr(
            system_conversion_router, "convert_rbd_to_fta", _raise(error),
        )
        result = rbd_to_fta(_valid_rbd_conversion_request())
    else:
        monkeypatch.setattr(
            system_conversion_router, "convert_fta_to_rbd", _raise(error),
        )
        result = fta_to_rbd(_valid_fta_conversion_request())

    diagnostic = result["diagnostics"][0]
    assert result["convertible"] is False
    assert diagnostic["code"] == expected_code
    assert secret not in repr(result)
    assert "private" not in diagnostic["message"].lower()
    if error_kind == "conversion":
        assert diagnostic["node_id"] == "component-a"


def test_series_rbd_converts_to_exact_or_fault_tree():
    request = RBDToFTAConversionRequest.model_validate({
        "mission_time": 1000,
        "nodes": [
            {"id": "source", "type": "source"}, {"id": "sink", "type": "sink"},
            {"id": "a", "type": "component", "data": {
                "label": "A", "reliability": 0.9,
                "ldaSource": "life-data:f1", "ldaSourceName": "Pump life",
            }},
            {"id": "b", "type": "component", "data": {"label": "B", "reliability": 0.8}},
        ],
        "edges": [
            {"source": "source", "target": "a"},
            {"source": "a", "target": "b"},
            {"source": "b", "target": "sink"},
        ],
    })

    converted = rbd_to_fta(request)
    result = _analyze(FaultTreeRequest.model_validate({
        "nodes": converted["nodes"], "edges": converted["edges"],
        "exposure_time": 1000,
    }))

    assert converted["convertible"] is True
    assert converted["verification"]["equivalent"] is True
    converted_a = next(node for node in converted["nodes"]
                       if node.get("data", {}).get("label") == "A")
    assert converted_a["data"]["ldaFolioId"] == "life-data:f1"
    assert converted_a["data"]["ldaFolioName"] == "Pump life"
    assert result["top_event_probability"] == pytest.approx(1 - 0.9 * 0.8)


def test_nested_vote_fta_converts_to_generalized_rbd_without_expansion():
    nodes = [{"id": "top", "type": "vote", "data": {"label": "2 fail", "k": 2}}]
    edges = []
    for branch in range(3):
        gate = f"g{branch}"
        nodes.append({"id": gate, "type": "or", "data": {"label": gate}})
        edges.append({"source": "top", "target": gate, "order": branch})
        for item in range(2):
            event = f"e{branch}{item}"
            nodes.append({"id": event, "type": "basic", "data": {
                "label": event, "eventKey": event, "probability": 0.1,
            }})
            edges.append({"source": gate, "target": event, "order": item})
    converted = fta_to_rbd(FTAToRBDConversionRequest.model_validate({
        "nodes": nodes, "edges": edges, "exposure_time": 1000,
    }))

    assert converted["convertible"] is True
    assert converted["verification"]["equivalent"] is True
    votes = [node for node in converted["nodes"] if node["type"] == "kofn"]
    assert any(node["data"]["k"] == 2 for node in votes)
    assert converted["summary"]["target_nodes"] < 20
    result = compute_rbd(RBDRequest.model_validate({
        "nodes": converted["nodes"], "edges": converted["edges"],
        "mission_time": 1000,
    }))
    assert 0 <= result["system_reliability"] <= 1


@pytest.mark.parametrize(
    ("gate", "data"),
    [
        ("or", {}),
        ("and", {}),
        ("inhibit", {}),
        ("vote", {"k": 2}),
        ("cardinality", {"min": 2, "max": 3}),
    ],
)
def test_every_static_coherent_gate_converts_to_equivalent_rbd(gate, data):
    event_types = ["basic", "conditioning", "external"]
    arity = 2 if gate == "inhibit" else 3
    nodes = [{"id": "top", "type": gate, "data": {"label": gate, **data}}]
    edges = []
    for index in range(arity):
        event_id = f"e{index}"
        nodes.append({
            "id": event_id,
            "type": event_types[index],
            "data": {"label": event_id, "eventKey": event_id,
                     "probability": 0.1 + 0.1 * index,
                     **({"ldaFolioId": "life-data:f2",
                         "ldaFolioName": "Valve life"} if index == 0 else {})},
        })
        edge = {"source": "top", "target": event_id, "order": index}
        if gate == "inhibit":
            edge["role"] = "primary" if index == 0 else "condition"
        edges.append(edge)

    source = _analyze(FaultTreeRequest.model_validate({
        "nodes": nodes, "edges": edges, "exposure_time": 1000,
    }))
    converted = fta_to_rbd(FTAToRBDConversionRequest.model_validate({
        "nodes": nodes, "edges": edges, "exposure_time": 1000,
    }))
    target = compute_rbd(RBDRequest.model_validate({
        "nodes": converted["nodes"], "edges": converted["edges"],
        "mission_time": 1000,
    }))

    assert converted["convertible"] is True
    assert converted["verification"]["equivalent"] is True
    converted_event = next(node for node in converted["nodes"]
                           if node.get("data", {}).get("sourceNodeId") == "e0")
    assert converted_event["data"]["ldaSource"] == "life-data:f2"
    assert converted_event["data"]["ldaSourceName"] == "Valve life"
    assert target["system_unreliability"] == pytest.approx(
        source["top_event_probability"], abs=1e-12)


@pytest.mark.parametrize(("house_state", "expected_reliability"), [
    (False, 0.9),
    (True, 0.0),
])
def test_house_event_constants_are_preserved(house_state, expected_reliability):
    nodes = [
        {"id": "top", "type": "or", "data": {"label": "top"}},
        {"id": "event", "type": "undeveloped",
         "data": {"label": "event", "probability": 0.1}},
        {"id": "house", "type": "house",
         "data": {"label": "house", "state": house_state}},
    ]
    edges = [
        {"source": "top", "target": "event", "order": 0},
        {"source": "top", "target": "house", "order": 1},
    ]
    converted = fta_to_rbd(FTAToRBDConversionRequest.model_validate({
        "nodes": nodes, "edges": edges,
    }))
    target = compute_rbd(RBDRequest.model_validate({
        "nodes": converted["nodes"], "edges": converted["edges"],
    }))

    assert target["system_reliability"] == pytest.approx(expected_reliability)


def test_transfer_reference_is_expanded_before_exact_conversion():
    converted = fta_to_rbd(FTAToRBDConversionRequest.model_validate({
        "tree_id": "parent",
        "nodes": [{
            "id": "transfer", "type": "transfer",
            "data": {"label": "Reusable tree", "transferTo": "child",
                     "transferToName": "Reusable tree"},
        }],
        "edges": [],
        "trees": {
            "child": {
                "nodes": [{
                    "id": "child-event", "type": "basic",
                    "data": {"label": "Child event", "probability": 0.2},
                }],
                "edges": [],
            },
        },
    }))
    target = compute_rbd(RBDRequest.model_validate({
        "nodes": converted["nodes"], "edges": converted["edges"],
    }))

    assert converted["convertible"] is True
    assert any(warning["code"] == "TRANSFERS_EXPANDED"
               for warning in converted["warnings"])
    assert target["system_reliability"] == pytest.approx(0.8)


def test_linked_rbd_analysis_is_expanded_before_conversion():
    converted = rbd_to_fta(RBDToFTAConversionRequest.model_validate({
        "source_analysis_id": "parent",
        "nodes": [
            {"id": "source", "type": "source"},
            {"id": "sink", "type": "sink"},
            {"id": "linked", "type": "component", "data": {
                "label": "Reusable subsystem", "reliability": 0.99,
                "linkedAnalysisId": "child", "linkedAnalysisName": "Child RBD",
            }},
        ],
        "edges": [
            {"source": "source", "target": "linked"},
            {"source": "linked", "target": "sink"},
        ],
        "analyses": {
            "child": {
                "nodes": [
                    {"id": "source", "type": "source"},
                    {"id": "sink", "type": "sink"},
                    {"id": "a", "type": "component",
                     "data": {"label": "A", "reliability": 0.9}},
                    {"id": "b", "type": "component",
                     "data": {"label": "B", "reliability": 0.8}},
                ],
                "edges": [
                    {"source": "source", "target": "a"},
                    {"source": "a", "target": "b"},
                    {"source": "b", "target": "sink"},
                ],
            },
        },
    }))
    target = _analyze(FaultTreeRequest.model_validate({
        "nodes": converted["nodes"], "edges": converted["edges"],
    }))

    assert converted["convertible"] is True
    assert any(warning["code"] == "REFERENCES_EXPANDED"
               for warning in converted["warnings"])
    assert target["top_event_probability"] == pytest.approx(1 - 0.9 * 0.8)


def test_common_cause_numeric_semantics_survive_rbd_to_fta_conversion():
    payload = {
        "nodes": [
            {"id": "source", "type": "source"},
            {"id": "sink", "type": "sink"},
            {"id": "a", "type": "component", "data": {
                "label": "A", "reliability": 0.9,
                "ccf_group": "power", "ccf_beta": 0.2,
            }},
            {"id": "b", "type": "component", "data": {
                "label": "B", "reliability": 0.9,
                "ccf_group": "power", "ccf_beta": 0.2,
            }},
        ],
        "edges": [
            {"source": "source", "target": "a"},
            {"source": "source", "target": "b"},
            {"source": "a", "target": "sink"},
            {"source": "b", "target": "sink"},
        ],
    }
    source = compute_rbd(RBDRequest.model_validate(payload))
    converted = rbd_to_fta(RBDToFTAConversionRequest.model_validate(payload))
    target = _analyze(FaultTreeRequest.model_validate({
        "nodes": converted["nodes"], "edges": converted["edges"],
    }))

    assert target["top_event_probability"] == pytest.approx(
        source["system_unreliability"], abs=5e-7)


@pytest.mark.parametrize("gate", ["not", "xor", "pand", "spare"])
def test_noncoherent_and_dynamic_gates_fail_closed(gate):
    arity = 1 if gate == "not" else 2
    nodes = [{"id": "top", "type": gate, "data": {"label": gate}}]
    edges = []
    for index in range(arity):
        nodes.append({"id": f"e{index}", "type": "basic", "data": {
            "probability": 0.1,
            **({"distribution": "exponential", "dist_params": {"lambda": 0.001}}
               if gate in {"pand", "spare"} else {}),
        }})
        # Distribution inputs may not also carry a direct probability.
        if gate in {"pand", "spare"}:
            nodes[-1]["data"].pop("probability")
        edges.append({"source": "top", "target": f"e{index}", "order": index,
                      "role": "primary" if gate == "spare" and index == 0
                      else "spare" if gate == "spare" else "input"})
    converted = fta_to_rbd(FTAToRBDConversionRequest.model_validate({
        "nodes": nodes, "edges": edges, "exposure_time": 1000,
    }))

    assert converted["convertible"] is False
    assert converted["diagnostics"][0]["code"] in {
        "NON_COHERENT_FTA_NOT_CONVERTIBLE", "DYNAMIC_FTA_NOT_CONVERTIBLE",
    }
