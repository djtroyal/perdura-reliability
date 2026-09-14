"""Imported executable models must obey the policy at every graph depth."""

import base64
import hashlib
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routers import modeling as M

onnx = pytest.importorskip("onnx")
ort = pytest.importorskip("onnxruntime")
h = onnx.helper
T = onnx.TensorProto


def scan_model(operator="Identity"):
    body = h.make_graph(
        [h.make_node(operator, ["xi"], ["yi"])], "body",
        [h.make_tensor_value_info("xi", T.FLOAT, [1])],
        [h.make_tensor_value_info("yi", T.FLOAT, [1])],
    )
    graph = h.make_graph(
        [h.make_node("Scan", ["X"], ["Y"], body=body, num_scan_inputs=1)], "scan",
        [h.make_tensor_value_info("X", T.FLOAT, [None, 1])],
        [h.make_tensor_value_info("Y", T.FLOAT, [None, 1])],
    )
    return h.make_model(graph, opset_imports=[h.make_opsetid("", 17)], ir_version=10)


def artifact(model):
    payload = model.SerializeToString()
    return {"bytes_base64": base64.b64encode(payload).decode(),
            "sha256": hashlib.sha256(payload).hexdigest()}


def body_of(model):
    return next(attr.g for attr in model.graph.node[0].attribute if attr.name == "body")


def external_tensor():
    tensor = h.make_tensor("external", T.FLOAT, [1], [1.0])
    tensor.ClearField("float_data")
    tensor.data_location = T.EXTERNAL
    tensor.external_data.add(key="location", value="untrusted-data.bin")
    return tensor


def test_supported_nested_graph_can_execute():
    _, session = M._validated_onnx(artifact(scan_model()))
    values = np.array([[1.0], [2.0]], dtype=np.float32)
    np.testing.assert_array_equal(session.run(None, {"X": values})[0], values)


@pytest.mark.parametrize("kind", [
    "operator", "domain", "initializer", "tensor_attribute", "sparse_initializer",
    "sparse_attribute", "functions", "training", "opset_domain", "aggregate_nodes",
])
def test_nested_import_rejections_happen_before_runtime(monkeypatch, kind):
    model = scan_model("Neg" if kind == "operator" else "Identity")
    body = body_of(model)
    if kind == "domain":
        body.node[0].domain = "untrusted.domain"
    elif kind == "initializer":
        body.initializer.append(external_tensor())
    elif kind == "tensor_attribute":
        body.node[0].attribute.append(h.make_attribute("value", external_tensor()))
    elif kind in {"sparse_initializer", "sparse_attribute"}:
        sparse = h.make_sparse_tensor(
            external_tensor(), h.make_tensor("indices", T.INT64, [1], [0]), [1],
        )
        if kind == "sparse_initializer":
            body.sparse_initializer.append(sparse)
        else:
            body.node[0].attribute.append(h.make_attribute("value", sparse))
    elif kind == "functions":
        model.functions.append(h.make_function(
            "untrusted.domain", "Identity", ["x"], ["y"],
            [h.make_node("Neg", ["x"], ["y"])], [h.make_opsetid("", 17)],
        ))
    elif kind == "training":
        model.training_info.add()
    elif kind == "opset_domain":
        model.opset_import.append(h.make_opsetid("untrusted.domain", 1))
    elif kind == "aggregate_nodes":
        # Root and body each fit separately; the complete model does not.
        monkeypatch.setattr(M, "_MAX_ONNX_NODES", 1)

    def unexpected_runtime(*args, **kwargs):
        pytest.fail("Rejected models must never reach ONNX Runtime")

    monkeypatch.setattr(ort, "InferenceSession", unexpected_runtime)
    with pytest.raises(ValueError, match="ONNX"):
        M._validated_onnx(artifact(model))


def test_malformed_model_returns_validation_error():
    payload = b"not an ONNX protobuf"
    with pytest.raises(ValueError, match="not a valid supported model"):
        M._validated_onnx({
            "bytes_base64": base64.b64encode(payload).decode(),
            "sha256": hashlib.sha256(payload).hexdigest(),
        })


def test_runtime_shape_rejection_is_a_client_validation_error():
    graph = h.make_graph(
        [h.make_node("MatMul", ["X", "weights"], ["Y"])], "incompatible-shapes",
        [h.make_tensor_value_info("X", T.FLOAT, [None, 2])],
        [h.make_tensor_value_info("Y", T.FLOAT, [None, 1])],
        initializer=[h.make_tensor("weights", T.FLOAT, [3, 1], [1.0, 2.0, 3.0])],
    )
    model = h.make_model(graph, opset_imports=[h.make_opsetid("", 17)], ir_version=10)
    onnx.checker.check_model(model)
    with pytest.raises(ValueError, match="supported CPU runtime"):
        M._validated_onnx(artifact(model))
