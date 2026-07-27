"""Structural controls for the LDA confidence-method inventory."""

import json
from pathlib import Path

from reliability.Fitters import _FITTER_MAP


INVENTORY = (
    Path(__file__).resolve().parents[1]
    / "tools"
    / "lda_confidence_inventory.json"
)


def _load():
    with INVENTORY.open(encoding="utf-8") as handle:
        return json.load(handle)


def test_inventory_covers_every_standard_parametric_fitter_exactly_once():
    inventory = _load()
    models = [item["model"] for item in inventory["standard_parametric"]]

    assert len(models) == len(set(models))
    assert set(models) == set(_FITTER_MAP)


def test_inventory_uses_declared_statuses_and_required_validation_regimes():
    inventory = _load()
    statuses = set(inventory["status_definitions"])
    model_statuses = {
        value
        for item in inventory["standard_parametric"]
        for key, value in item.items()
        if key not in {"model", "location_parameter"}
    }
    special_statuses = {
        item["status"] for item in inventory["special_and_nonparametric"]
    }

    assert model_statuses <= statuses
    assert special_statuses <= statuses
    assert set(inventory["required_validation_regimes"]) >= {
        "small_sample",
        "type_ii_censoring",
        "planned_heterogeneous_censoring",
        "parameter_on_boundary",
        "weak_identification",
        "interval_censoring",
        "sparse_tail_risk_set",
    }
    assert inventory["validation_confidence_levels"] == [0.90, 0.95, 0.99]
    assert inventory["bootstrap"]["minimum_success_fraction"] == 0.95


def test_all_location_families_fail_closed_for_ordinary_automatic_inference():
    inventory = _load()
    location_models = [
        item for item in inventory["standard_parametric"]
        if item["location_parameter"]
    ]

    for item in location_models:
        if item["model"] == "Exponential_2P":
            assert item["complete_mle"] == "exact_primary"
            assert item["type_ii_mle"] == "exact_primary"
            assert item["censored_mle"] == "withheld"
        else:
            assert item["complete_mle"] == "withheld"
            assert item["censored_mle"] == "withheld"
