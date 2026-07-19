"""API contracts for model-aware DOE generation and analysis."""

import pytest


@pytest.mark.parametrize("case", [
    {"design": "full_factorial_2level", "factor_names": ["A", "B"]},
    {"design": "fractional_factorial_2level", "factor_names": ["A", "B", "C", "D"],
     "generators": ["D=ABC"]},
    {"design": "plackett_burman", "n_factors": 7},
    {"design": "box_behnken", "factor_names": ["A", "B", "C"]},
    {"design": "central_composite", "factor_names": ["A", "B"]},
    {"design": "simplex_lattice", "q": 3, "degree": 2},
    {"design": "simplex_centroid", "q": 3},
    {"design": "extreme_vertices", "q": 3,
     "lower": [0.1, 0.1, 0.1], "upper": [0.8, 0.8, 0.8]},
    {"design": "full_factorial_general", "factor_names": ["A", "B"],
     "levels": [3, 2]},
    {"design": "taguchi", "taguchi_array": "L8", "factor_names": ["A", "B"]},
])
def test_every_generator_uses_common_metadata_contract(case):
    from routers.doe import GenerateRequest, generate_design

    result = generate_design(GenerateRequest(
        **case, standardized_coefficient=0.5, replicates=2))
    metadata = result["metadata"]
    assert metadata["contract_version"] == 2
    assert metadata["generator_key"] == case["design"]
    assert metadata["design_class"]
    assert metadata["analysis_model"]
    assert "design_diagnostics" in metadata
    assert "randomization" in metadata
    assert "blocking" in metadata
    assert "power_analysis" in metadata
    assert metadata["replicates"] == 2
    assert len(result["runs"]) == 2 * metadata["base_run_count"]
    assert set(result["columns"]["Replicate"]) == {1, 2}


def test_generate_returns_versioned_diagnostics_blocks_and_power():
    from routers.doe import GenerateRequest, generate_design

    result = generate_design(GenerateRequest(
        design="central_composite", factor_names=["A", "B"],
        center_points=5, n_blocks=2, randomize=True, seed=19,
        standardized_coefficient=0.5,
    ))
    metadata = result["metadata"]
    assert metadata["contract_version"] == 2
    assert metadata["design_class"] == "response_surface"
    assert metadata["design_diagnostics"]["full_rank"]
    assert metadata["blocking"]["n_blocks"] == 2
    assert metadata["randomization"]["enabled"] is True
    assert metadata["power_analysis"]["target_power"] == pytest.approx(0.8)
    assert set(result["columns"]["Block"]) == {1, 2}


def test_generate_and_analyze_complete_design_replicates():
    from routers.doe import AnalyzeRequest, GenerateRequest, analyze, generate_design

    design = generate_design(GenerateRequest(
        design="full_factorial_2level", factor_names=["A", "B"],
        replicates=3, randomize=True, seed=31,
        standardized_coefficient=0.5,
    ))
    assert len(design["runs"]) == 12
    assert set(design["columns"]["Replicate"]) == {1, 2, 3}
    assert design["metadata"]["base_run_count"] == 4
    assert design["metadata"]["replicates"] == 3
    assert design["metadata"]["run_count"] == 12
    assert design["metadata"]["design_diagnostics"]["replicated_runs"] == 8
    assert design["metadata"]["power_analysis"]["current_design"]["replicates"] == 3

    responses = [
        10 + 2 * run["A"] - run["B"] + 0.1 * (run["Replicate"] - 2)
        for run in design["runs"]
    ]
    result = analyze(AnalyzeRequest(
        factor_names=design["factor_names"], runs=design["runs"],
        responses=responses, metadata=design["metadata"],
    ))
    assert result["n_runs"] == 12
    assert result["design_diagnostics"]["residual_df"] == 8
    assert result["lack_of_fit"]["pure_error_df"] == 8
    assert result["lack_of_fit"]["status"] == "unavailable_no_lack_of_fit_degrees_of_freedom"
    assert all(effect["p_value"] is not None for effect in result["effects"])
    assert result["lenth"] is None


def test_response_surface_endpoint_uses_quadratic_model_and_blocks():
    from routers.doe import AnalyzeRequest, GenerateRequest, analyze, generate_design

    design = generate_design(GenerateRequest(
        design="central_composite", factor_names=["A", "B"],
        center_points=5, n_blocks=2, seed=5))
    responses = [
        10 + 2 * run["A"] - 3 * run["B"] - run["A"] ** 2
        - 2 * run["B"] ** 2 + 0.5 * run["A"] * run["B"]
        + 4 * (run["Block"] == 2)
        for run in design["runs"]
    ]
    result = analyze(AnalyzeRequest(
        factor_names=["A", "B"], runs=design["runs"], responses=responses,
        metadata=design["metadata"]))
    assert result["analysis_type"] == "response_surface"
    assert result["stationary_point"]["classification"] == "maximum"
    block_term = next(row for row in result["terms"] if row["term"].startswith("Block"))
    assert abs(block_term["coefficient"]) == pytest.approx(4.0)


def test_mixture_endpoint_fits_scheffe_model_with_bounds():
    from routers.doe import AnalyzeRequest, GenerateRequest, analyze, generate_design

    design = generate_design(GenerateRequest(
        design="simplex_centroid", q=3,
        factor_names=["Resin", "Filler", "Binder"]))
    responses = [
        2 * run["Resin"] + 4 * run["Filler"] + 3 * run["Binder"]
        + 5 * run["Resin"] * run["Filler"]
        for run in design["runs"]
    ]
    result = analyze(AnalyzeRequest(
        factor_names=design["factor_names"], runs=design["runs"],
        responses=responses, metadata=design["metadata"],
        constraints={"lower": [0.1, 0.1, 0.1], "upper": [0.8, 0.8, 0.8]}))
    assert result["analysis_type"] == "mixture"
    assert result["model"] == "scheffe_quadratic"
    composition = result["mixture_optimum"]["maximum"]["composition"]
    assert sum(composition.values()) == pytest.approx(1.0)
