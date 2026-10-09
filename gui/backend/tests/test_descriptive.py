"""HTTP contracts for large-sample descriptive normality results."""

from __future__ import annotations

import importlib.util
import inspect
import json
from pathlib import Path
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import stats


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parents[1] / "src"))

pytestmark = pytest.mark.filterwarnings("error::FutureWarning")

# SciPy 1.13–1.16 uses a different normal critical-value table/correction
# from 1.17+. Pin each era's existing result for n=5001 independently of the
# production helper; the public method parameter identifies the newer API.
CRITICAL_5PCT_5001 = (
    0.752 if "method" in inspect.signature(stats.anderson).parameters else 0.786
)


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """Exercise production routing independently of a frontend build."""
    static_dir = tmp_path_factory.mktemp("descriptive-frontend")
    (static_dir / "assets").mkdir()
    (static_dir / "index.html").write_text("<html>Perdura test frontend</html>")
    spec = importlib.util.spec_from_file_location(
        "perdura_descriptive_test_app", BACKEND / "main.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("PERDURA_STATIC_DIR", str(static_dir))
        spec.loader.exec_module(module)
    with TestClient(module.app, headers={
        "X-Perdura-Client-API-Contract": "1",
    }) as test_client:
        yield test_client


def test_large_sample_preserves_anderson_result_without_future_warning(client):
    response = client.post("/api/v1/descriptive/summary", json={
        "columns": {"uniform": np.linspace(-3.0, 3.0, 5001).tolist()},
    })

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    result = response.json()
    json.dumps(result, allow_nan=False)
    assert result["uniform"]["n"] == 5001
    # Recorded from SciPy's legacy normal Anderson-Darling calculation before
    # migrating its API; the public response must retain the same statistic and
    # three-decimal 5% critical value, with no new p-value interpretation.
    assert result["uniform"]["normality"] == {
        "test": "anderson",
        "stat": pytest.approx(55.573111166535455, rel=1e-12, abs=1e-12),
        "critical_5pct": CRITICAL_5PCT_5001,
        "p": None,
    }


def test_constant_large_sample_keeps_nonfinite_statistics_json_null(client):
    response = client.post("/api/v1/descriptive/summary", json={
        "columns": {"constant": [0.0] * 5001},
    })

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    result = response.json()
    json.dumps(result, allow_nan=False)
    column = result["constant"]
    assert column["n"] == 5001
    assert column["mean"] == column["variance"] == column["std"] == 0.0
    assert column["skewness"] is None
    assert column["kurtosis"] is None
    assert column["coefficient_of_variation"] is None
    assert column["normality"] == {
        "test": "anderson",
        "stat": None,
        "critical_5pct": CRITICAL_5PCT_5001,
        "p": None,
    }
