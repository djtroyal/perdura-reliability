"""Tests for reliability.SystemReliability."""

import numpy as np
import pytest
from reliability.SystemReliability import (
    SeriesSystem,
    ParallelSystem,
    KofNSystem,
    NetworkSystem,
    exact_network_reliability,
    system_reliability_from_blocks,
)


# --- Series ---

def test_series_two_components():
    s = SeriesSystem([0.9, 0.8])
    assert s.reliability == pytest.approx(0.72)


def test_series_single():
    s = SeriesSystem([0.95])
    assert s.reliability == pytest.approx(0.95)


def test_series_unreliability():
    s = SeriesSystem([0.9, 0.8])
    assert s.unreliability == pytest.approx(1 - 0.72)


def test_series_perfect_components():
    s = SeriesSystem([1.0, 1.0, 1.0])
    assert s.reliability == pytest.approx(1.0)


def test_series_one_failed():
    s = SeriesSystem([0.9, 0.0])
    assert s.reliability == pytest.approx(0.0)


# --- Parallel ---

def test_parallel_two_components():
    p = ParallelSystem([0.9, 0.8])
    assert p.reliability == pytest.approx(1 - 0.1 * 0.2)


def test_parallel_better_than_series():
    comps = [0.8, 0.7]
    s = SeriesSystem(comps)
    p = ParallelSystem(comps)
    assert p.reliability > s.reliability


def test_parallel_single():
    p = ParallelSystem([0.75])
    assert p.reliability == pytest.approx(0.75)


def test_parallel_unreliability():
    p = ParallelSystem([0.9, 0.8])
    assert p.unreliability == pytest.approx(0.02)


# --- KofN ---

def test_1_of_2():
    # 1-of-2 is equivalent to parallel
    k = KofNSystem(1, 2, 0.8)
    p = ParallelSystem([0.8, 0.8])
    assert k.reliability == pytest.approx(p.reliability)


def test_2_of_2():
    # 2-of-2 is equivalent to series
    k = KofNSystem(2, 2, 0.8)
    s = SeriesSystem([0.8, 0.8])
    assert k.reliability == pytest.approx(s.reliability)


def test_2_of_3():
    # P = C(3,2)*0.8^2*0.2 + C(3,3)*0.8^3
    p = 0.8
    expected = 3 * p**2 * (1-p) + p**3
    k = KofNSystem(2, 3, p)
    assert k.reliability == pytest.approx(expected)


def test_kofn_invalid():
    with pytest.raises(ValueError):
        KofNSystem(4, 3, 0.9)


# --- NetworkSystem ---

def test_network_series_path():
    # Single path containing both components = series
    net = NetworkSystem([[0, 1]], [0.9, 0.8])
    assert net.reliability == pytest.approx(0.72)


def test_network_two_parallel_paths():
    # Path 1: component 0, Path 2: component 1 = parallel
    net = NetworkSystem([[0], [1]], [0.9, 0.8])
    assert net.reliability == pytest.approx(1 - 0.1 * 0.2)


def test_network_bridge():
    # 5-component bridge network
    # Minimal paths: {0,3}, {1,4}, {0,2,4}, {1,2,3}
    comps = [0.9, 0.9, 0.9, 0.9, 0.9]
    paths = [{0, 3}, {1, 4}, {0, 2, 4}, {1, 2, 3}]
    net = NetworkSystem(paths, comps)
    assert 0 < net.reliability < 1


def test_network_bdd_matches_path_set_inclusion_exclusion_reference():
    reliabilities = [0.8, 0.7, 0.9, 0.6]
    paths = [{0, 1}, {0, 2}, {2, 3}]
    net = NetworkSystem(paths, reliabilities)

    assert net.reliability == pytest.approx(net._inclusion_exclusion(), abs=1e-12)
    assert net.computation_diagnostics["engine"] == "reduced_bdd_shannon_dnf"


def test_connectivity_bdd_handles_exponentially_many_paths():
    # Two parallel components in each of 20 series stages imply 2**20 paths,
    # but connectivity-state pruning solves the graph without enumerating them.
    adjacency = {"src": ("c0a", "c0b")}
    requirements = {}
    probabilities = {}
    for stage in range(20):
        current = [f"c{stage}a", f"c{stage}b"]
        next_nodes = ([f"c{stage + 1}a", f"c{stage + 1}b"]
                      if stage < 19 else ["snk"])
        for component in current:
            adjacency[component] = tuple(next_nodes)
            variable = f"works:{component}"
            requirements[component] = {variable}
            probabilities[variable] = 0.9

    reliability, diagnostics = exact_network_reliability(
        adjacency, "src", "snk", requirements, probabilities,
        return_diagnostics=True,
    )
    expected = (1.0 - 0.1 ** 2) ** 20
    assert reliability == pytest.approx(expected, rel=1e-12)
    assert diagnostics["path_enumeration_used_for_probability"] is False
    assert diagnostics["states_evaluated"] < 1000


# --- system_reliability_from_blocks ---

def test_blocks_series():
    blocks = {
        'type': 'series',
        'components': [
            {'type': 'component', 'reliability': 0.9},
            {'type': 'component', 'reliability': 0.8},
        ]
    }
    assert system_reliability_from_blocks(blocks) == pytest.approx(0.72)


def test_blocks_parallel():
    blocks = {
        'type': 'parallel',
        'components': [
            {'type': 'component', 'reliability': 0.9},
            {'type': 'component', 'reliability': 0.8},
        ]
    }
    assert system_reliability_from_blocks(blocks) == pytest.approx(1 - 0.1 * 0.2)


def test_blocks_kofn():
    blocks = {
        'type': 'kofn',
        'k': 2,
        'n': 3,
        'sub': {'type': 'component', 'reliability': 0.8}
    }
    p = 0.8
    expected = 3 * p**2 * (1-p) + p**3
    assert system_reliability_from_blocks(blocks) == pytest.approx(expected)


def test_blocks_nested():
    blocks = {
        'type': 'series',
        'components': [
            {
                'type': 'parallel',
                'components': [
                    {'type': 'component', 'reliability': 0.9},
                    {'type': 'component', 'reliability': 0.9},
                ]
            },
            {'type': 'component', 'reliability': 0.95}
        ]
    }
    r_parallel = 1 - 0.1 * 0.1
    expected = r_parallel * 0.95
    assert system_reliability_from_blocks(blocks) == pytest.approx(expected)
