"""Tests for the DOE module."""

import numpy as np
import pytest

from reliability.DOE import (
    full_factorial_2level,
    fractional_factorial_2level,
    plackett_burman,
    box_behnken,
    central_composite,
    simplex_lattice,
    simplex_centroid,
    extreme_vertices,
    full_factorial_general,
    taguchi,
    map_to_real_units,
    randomize_runs,
)


# ---------------------------------------------------------------------------
# Full factorial 2-level
# ---------------------------------------------------------------------------

def test_full_factorial_2level_run_count():
    res = full_factorial_2level(["A", "B", "C"])
    assert len(res["runs"]) == 8


def test_full_factorial_2level_unique_runs():
    res = full_factorial_2level(["A", "B", "C"])
    tuples = set(tuple(r.values()) for r in res["runs"])
    assert len(tuples) == 8


def test_full_factorial_2level_orthogonal():
    res = full_factorial_2level(["A", "B", "C"])
    coded = res["coded"]
    # Columns sum to 0
    assert np.allclose(coded.sum(axis=0), 0)
    # Pairwise column dot products = 0
    k = coded.shape[1]
    for i in range(k):
        for j in range(i + 1, k):
            dot = float(coded[:, i] @ coded[:, j])
            assert abs(dot) < 1e-10, f"Columns {i} and {j} not orthogonal: dot={dot}"


def test_full_factorial_2level_values():
    """All entries should be ±1."""
    res = full_factorial_2level(["A", "B"])
    assert set(np.unique(res["coded"])) == {-1.0, 1.0}


# ---------------------------------------------------------------------------
# Fractional factorial
# ---------------------------------------------------------------------------

def test_fractional_factorial_half_fraction():
    res = fractional_factorial_2level(["A", "B", "C", "D"], generators=["D=ABC"])
    assert len(res["runs"]) == 8
    assert res["metadata"]["resolution"] == 4


def test_fractional_factorial_generators_parsed():
    res = fractional_factorial_2level(["A", "B", "C", "D"], generators=["D=ABC"])
    assert "D=ABC" in res["metadata"]["generators"]


def test_fractional_factorial_alias_structure():
    res = fractional_factorial_2level(["A", "B", "C", "D"], generators=["D=ABC"])
    alias = res["metadata"]["alias_structure"]
    # Main effect A should be aliased with something
    assert "A" in alias or "BCD" in alias or len(alias) > 0


# ---------------------------------------------------------------------------
# Plackett-Burman
# ---------------------------------------------------------------------------

def test_plackett_burman_11_factors():
    res = plackett_burman(11)
    assert res["coded"].shape == (12, 11)
    assert len(res["runs"]) == 12


def test_plackett_burman_orthogonal():
    res = plackett_burman(11)
    coded = res["coded"]
    # Columns orthogonal
    for i in range(coded.shape[1]):
        for j in range(i + 1, coded.shape[1]):
            dot = float(coded[:, i] @ coded[:, j])
            assert abs(dot) < 1e-9, f"PB12 cols {i},{j} not orthogonal: dot={dot}"


def test_plackett_burman_7_factors():
    res = plackett_burman(7)
    assert res["coded"].shape[1] == 7
    assert res["coded"].shape[0] == 8


def test_plackett_burman_values():
    res = plackett_burman(7)
    assert set(np.unique(res["coded"])) == {-1.0, 1.0}


def test_plackett_burman_declared_capacity_and_large_orthogonality():
    res = plackett_burman(63)
    assert res["coded"].shape == (64, 63)
    np.testing.assert_allclose(res["coded"].T @ res["coded"], 64 * np.eye(63))
    assert res["metadata"]["capacity"] == 63
    assert res["metadata"]["construction"] == "sylvester_hadamard"


def test_plackett_burman_rejects_above_documented_capacity():
    with pytest.raises(ValueError, match="1 to 63"):
        plackett_burman(64)


# ---------------------------------------------------------------------------
# Box-Behnken
# ---------------------------------------------------------------------------

def test_box_behnken_3_factors():
    res = box_behnken(["A", "B", "C"], center_points=3)
    # BBD k=3: 3 blocks * 4 = 12 factorial runs + 3 center points = 15
    assert res["metadata"]["run_count"] == 15
    assert len(res["runs"]) == 15


def test_box_behnken_center_rows():
    res = box_behnken(["A", "B", "C"], center_points=3)
    coded = res["coded"]
    center_rows = np.sum(coded, axis=1)
    n_center = np.sum(np.all(coded == 0, axis=1))
    assert n_center == 3


def test_box_behnken_4_factors():
    res = box_behnken(["A", "B", "C", "D"], center_points=3)
    # 6 pairs * 4 + 3 = 27
    assert res["metadata"]["run_count"] == 27


def test_box_behnken_invalid_k():
    with pytest.raises(ValueError):
        box_behnken(["A", "B"])


# ---------------------------------------------------------------------------
# Central Composite Design
# ---------------------------------------------------------------------------

def test_ccd_rotatable_alpha():
    res = central_composite(["A", "B"], alpha="rotatable", center_points=4)
    alpha = res["metadata"]["alpha"]
    expected = (4.0 ** 0.25)  # 2^2 = 4 factorial runs for k=2
    assert abs(alpha - expected) < 1e-6


def test_ccd_run_count():
    res = central_composite(["A", "B"], alpha="rotatable", center_points=4)
    # k=2: 4 factorial + 4 axial + 4 center = 12
    assert res["metadata"]["run_count"] == 12


def test_ccd_face_alpha():
    res = central_composite(["A", "B", "C"], alpha="face", center_points=4)
    assert abs(res["metadata"]["alpha"] - 1.0) < 1e-10


def test_ccd_axial_points():
    k = 2
    res = central_composite(["A", "B"], alpha="rotatable", center_points=4)
    assert res["metadata"]["axial_runs"] == 2 * k


# ---------------------------------------------------------------------------
# Simplex lattice
# ---------------------------------------------------------------------------

def test_simplex_lattice_rows_sum_to_1():
    res = simplex_lattice(3, 3)
    coded = res["coded"]
    row_sums = coded.sum(axis=1)
    assert np.allclose(row_sums, 1.0), f"Row sums: {row_sums}"


def test_simplex_lattice_run_count():
    # {3, 3} -> C(3+3-1, 3-1) = C(5,2) = 10
    res = simplex_lattice(3, 3)
    assert res["metadata"]["run_count"] == 10


def test_simplex_lattice_2components():
    res = simplex_lattice(2, 4)
    coded = res["coded"]
    assert np.allclose(coded.sum(axis=1), 1.0)
    # levels: 0, 0.25, 0.5, 0.75, 1.0 -> 5 points
    assert res["metadata"]["run_count"] == 5


# ---------------------------------------------------------------------------
# Simplex centroid
# ---------------------------------------------------------------------------

def test_simplex_centroid_3():
    res = simplex_centroid(3)
    # 2^3 - 1 = 7 points
    assert res["metadata"]["run_count"] == 7
    assert len(res["runs"]) == 7


def test_simplex_centroid_rows_sum_to_1():
    res = simplex_centroid(3)
    coded = res["coded"]
    assert np.allclose(coded.sum(axis=1), 1.0)


def test_simplex_centroid_4():
    res = simplex_centroid(4)
    assert res["metadata"]["run_count"] == 15  # 2^4 - 1


# ---------------------------------------------------------------------------
# Extreme vertices
# ---------------------------------------------------------------------------

def test_extreme_vertices_basic():
    res = extreme_vertices(3, [0.1, 0.1, 0.1], [0.8, 0.8, 0.8])
    coded = res["coded"]
    # All rows sum to 1
    assert np.allclose(coded.sum(axis=1), 1.0)
    assert res["metadata"]["run_count"] > 0


def test_extreme_vertices_bounds():
    lower = [0.2, 0.2, 0.2]
    upper = [0.6, 0.6, 0.6]
    res = extreme_vertices(3, lower, upper)
    coded = res["coded"]
    for i in range(3):
        assert np.all(coded[:, i] >= lower[i] - 1e-9)
        assert np.all(coded[:, i] <= upper[i] + 1e-9)


# ---------------------------------------------------------------------------
# Full factorial general
# ---------------------------------------------------------------------------

def test_full_factorial_general_run_count():
    res = full_factorial_general([2, 3, 2], ["A", "B", "C"])
    assert res["metadata"]["run_count"] == 12
    assert len(res["runs"]) == 12


def test_full_factorial_general_levels():
    res = full_factorial_general([3, 3], ["A", "B"])
    coded = res["coded"]
    # Unique values per column: 0, 1, 2
    assert set(np.unique(coded[:, 0]).astype(int)) == {0, 1, 2}


# ---------------------------------------------------------------------------
# Taguchi
# ---------------------------------------------------------------------------

def test_taguchi_L8_shape():
    res = taguchi("L8")
    assert res["coded"].shape == (8, 7)
    assert len(res["runs"]) == 8


def test_taguchi_L8_orthogonal():
    res = taguchi("L8")
    # Map 1->-1, 2->+1
    coded = res["coded"].copy()
    coded = 2 * coded - 3  # 1->-1, 2->+1
    for i in range(coded.shape[1]):
        for j in range(i + 1, coded.shape[1]):
            dot = float(coded[:, i] @ coded[:, j])
            assert abs(dot) < 1e-9, f"L8 cols {i},{j} not orthogonal: dot={dot}"


def test_taguchi_L9_shape():
    res = taguchi("L9")
    assert res["coded"].shape == (9, 4)


def test_taguchi_L4_shape():
    res = taguchi("L4")
    assert res["coded"].shape == (4, 3)


def test_taguchi_L16_shape():
    res = taguchi("L16")
    assert res["coded"].shape == (16, 15)


def test_taguchi_L27_shape():
    res = taguchi("L27")
    assert res["coded"].shape == (27, 13)


def test_taguchi_invalid():
    with pytest.raises(ValueError):
        taguchi("L99")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def test_map_to_real_units():
    res = full_factorial_2level(["A", "B"])
    real_runs = map_to_real_units(res["runs"], ["A", "B"], low=[10.0, 50.0], high=[20.0, 100.0])
    for run in real_runs:
        assert "A_real" in run
        assert "B_real" in run
        # -1 -> 10, +1 -> 20 for A
        if run["A"] == -1.0:
            assert abs(run["A_real"] - 10.0) < 1e-9
        else:
            assert abs(run["A_real"] - 20.0) < 1e-9


def test_randomize_runs_seeded():
    res = full_factorial_2level(["A", "B", "C"])
    r1 = randomize_runs(res["runs"], seed=42)
    r2 = randomize_runs(res["runs"], seed=42)
    assert r1 == r2


def test_randomize_runs_different_seed():
    res = full_factorial_2level(["A", "B", "C"])
    r1 = randomize_runs(res["runs"], seed=1)
    r2 = randomize_runs(res["runs"], seed=2)
    # Very unlikely to be equal
    assert r1 != r2 or len(r1) == 1
