"""Public regression-router coverage for sparse support stability."""

import numpy as np
import pytest
from fastapi import HTTPException


def test_lasso_router_exposes_selection_stability_without_post_selection_ci():
    from routers.regression import FitRequest, fit_regression

    rng = np.random.default_rng(713)
    x1 = rng.normal(size=90)
    x2 = rng.normal(size=90)
    noise = rng.normal(0.0, 0.15, size=90)
    result = fit_regression(FitRequest(
        model="lasso",
        data={"y": 3.0 * x1 + noise, "x1": x1, "x2": x2},
        y="y",
        x=["x1", "x2"],
        alpha=0.5,
        stability_selection=True,
        stability_pairs=3,
        stability_lambdas=4,
        stability_threshold=0.75,
        stability_seed=29,
    ))

    stability = result["selection_stability"]
    assert stability["method"] == "complementary_pairs_stability_selection"
    assert "x1" in stability["selected_support"]
    assert stability["reproducibility"]["n_pairs"] == 3
    assert stability["convergence"]["all_fits_converged"] is True
    assert stability["support_eligible"] is True
    assert stability["selection_scope"].endswith("not_the_full_sample_alpha_fit")
    assert stability["selection_size_control"]["formal_error_bound"] is False
    assert "pfer_upper_bound" not in repr(stability)
    assert "confidence intervals" in stability["inference_note"]
    assert "conf_int" not in stability


def test_elastic_net_stability_rejects_ridge_equivalent_l1_ratio():
    from routers.regression import FitRequest, fit_regression

    x = np.arange(12, dtype=float)
    request = FitRequest(
        model="elastic_net",
        data={"y": 1.0 + 2.0 * x, "x": x},
        y="y",
        x=["x"],
        l1_ratio=0.0,
        stability_selection=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        fit_regression(request)
    assert exc_info.value.status_code == 400
    assert "unavailable when l1_ratio=0" in exc_info.value.detail


def test_stability_router_rejects_oversized_synchronous_work_request():
    from routers.regression import FitRequest, fit_regression

    predictors = [f"x{index}" for index in range(501)]
    data = {name: [0.0, 1.0, 2.0, 3.0] for name in predictors}
    data["y"] = [0.0, 1.0, 2.0, 3.0]
    request = FitRequest(
        model="lasso", data=data, y="y", x=predictors,
        stability_selection=True, stability_pairs=50, stability_lambdas=20,
    )

    with pytest.raises(HTTPException) as exc_info:
        fit_regression(request)
    assert exc_info.value.status_code == 400
    assert "too large for an interactive fit" in exc_info.value.detail
