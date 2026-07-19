"""Validated DOE planning and model-aware analysis contract."""

import numpy as np
import pytest

from reliability.DOE import (
    full_factorial_2level,
    central_composite,
    simplex_centroid,
    assign_balanced_blocks,
    randomized_run_order,
    replicate_design,
    validated_design_contract,
    design_power,
    analyze_experiment,
)


def test_replicate_design_repeats_points_and_preserves_independent_rows():
    design = full_factorial_2level(["A", "B"])
    coded, runs = replicate_design(design["coded"], design["runs"], 3)

    assert coded.shape == (12, 2)
    assert [run["Replicate"] for run in runs] == [1] * 4 + [2] * 4 + [3] * 4
    np.testing.assert_array_equal(coded[:4], design["coded"])
    np.testing.assert_array_equal(coded[8:], design["coded"])
    assert runs[0]["A"] == runs[4]["A"] == runs[8]["A"]


@pytest.mark.parametrize("replicates", [0, -1, 1.5, True])
def test_replicate_design_rejects_invalid_counts(replicates):
    design = full_factorial_2level(["A", "B"])
    with pytest.raises(ValueError, match="positive integer"):
        replicate_design(design["coded"], design["runs"], replicates)


def test_contract_reports_rank_replication_blocks_and_power():
    design = central_composite(["A", "B"], center_points=5)
    blocks, blocking = assign_balanced_blocks(design["coded"], 2, seed=17)
    contract = validated_design_contract(
        design["coded"], design["factor_names"], "central_composite",
        metadata=design["metadata"], blocks=blocks, power_effect=0.5,
    )
    diagnostics = contract["design_diagnostics"]
    assert contract["contract_version"] == 2
    assert contract["design_class"] == "response_surface"
    assert diagnostics["full_rank"]
    assert diagnostics["replicated_runs"] == 4
    assert diagnostics["blocking"]["n_blocks"] == 2
    assert not diagnostics["blocking"]["confounded_with_treatment_model"]
    assert contract["power_analysis"]["minimum_replicates_for_target"] is not None
    assert sorted(blocking["block_sizes"].values()) == [6, 7]


def test_block_and_randomization_are_seeded_and_within_block():
    design = full_factorial_2level(["A", "B", "C"])
    first, _ = assign_balanced_blocks(design["coded"], 2, seed=7)
    second, _ = assign_balanced_blocks(design["coded"], 2, seed=7)
    assert first == second
    assert sorted(np.bincount(first)[1:].tolist()) == [4, 4]
    order, metadata = randomized_run_order(first, True, seed=22)
    repeat, _ = randomized_run_order(first, True, seed=22)
    assert order == repeat
    ordered_blocks = [first[index] for index in order]
    assert ordered_blocks == sorted(ordered_blocks)
    assert metadata["scope"] == "within_block"


def test_power_increases_with_standardized_coefficient():
    design = full_factorial_2level(["A", "B", "C"])
    small = design_power(
        design["coded"], design["factor_names"], "screening",
        standardized_coefficient=0.25, model="linear")
    large = design_power(
        design["coded"], design["factor_names"], "screening",
        standardized_coefficient=1.0, model="linear")
    assert (large["current_design"]["minimum_term_power"]
            > small["current_design"]["minimum_term_power"])
    assert (large["minimum_replicates_for_target"]
            <= small["minimum_replicates_for_target"])


def _replicated_ccd(cubic=False):
    design = central_composite(["A", "B"], center_points=3)
    runs, responses = [], []
    for run_index, run in enumerate(design["runs"]):
        for replicate, noise in enumerate((-0.02, 0.02)):
            row = dict(run, Block=1)
            x, z = row["A"], row["B"]
            response = 10 + 2 * x - 3 * z - x ** 2 - 2 * z ** 2 + 0.5 * x * z
            if cubic:
                response += 2.5 * x ** 3
            runs.append(row)
            responses.append(response + noise * (1 + run_index % 2))
    return runs, responses


def test_response_surface_recovers_stationary_point_and_lack_of_fit():
    runs, responses = _replicated_ccd(cubic=False)
    result = analyze_experiment(
        runs, responses, ["A", "B"], design_class="response_surface")
    assert result["analysis_type"] == "response_surface"
    assert result["r2"] > 0.999
    np.testing.assert_allclose(
        result["stationary_point"]["coordinates"],
        [0.8387096774, -0.6451612903], atol=0.02)
    assert result["stationary_point"]["classification"] == "maximum"
    assert result["lack_of_fit"]["status"] == "ok"
    assert result["lack_of_fit"]["p_value"] > 0.05


def test_response_surface_lack_of_fit_detects_omitted_cubic_term():
    runs, responses = _replicated_ccd(cubic=True)
    result = analyze_experiment(
        runs, responses, ["A", "B"], design_class="response_surface")
    assert result["lack_of_fit"]["status"] == "ok"
    assert result["lack_of_fit"]["p_value"] < 0.001


def test_scheffe_mixture_fit_and_constrained_optimum():
    design = simplex_centroid(3)
    runs = [dict(run, Block=1) for run in design["runs"]]
    responses = [
        2 * run["X1"] + 4 * run["X2"] + 3 * run["X3"]
        + 5 * run["X1"] * run["X2"]
        for run in runs
    ]
    bounds = {"lower": [0.1, 0.1, 0.1], "upper": [0.8, 0.8, 0.8]}
    result = analyze_experiment(
        runs, responses, design["factor_names"], design_class="mixture",
        constraints=bounds)
    assert result["model"] == "scheffe_quadratic"
    assert result["r2"] == pytest.approx(1.0)
    maximum = result["mixture_optimum"]["maximum"]["composition"]
    assert sum(maximum.values()) == pytest.approx(1.0)
    assert all(0.1 - 1e-8 <= value <= 0.8 + 1e-8
               for value in maximum.values())


def test_factorial_analysis_adjusts_for_large_block_shift():
    design = full_factorial_2level(["A", "B", "C"])
    blocks, _ = assign_balanced_blocks(design["coded"], 2, seed=4)
    runs = [dict(run, Block=blocks[index])
            for index, run in enumerate(design["runs"])]
    responses = [10 + 3 * run["A"] + 50 * (run["Block"] == 2)
                 for run in runs]
    result = analyze_experiment(
        runs, responses, design["factor_names"], design_class="screening",
        model="factorial_2fi")
    effects = {row["term"]: row["effect"] for row in result["effects"]}
    assert effects["A"] == pytest.approx(6.0)
    assert result["block_adjusted"] is True
    assert result["block_effects"]
