"""Tests for reliability.FaultTree."""

import numpy as np
import pytest
from reliability.FaultTree import BasicEvent, AndGate, OrGate, VoteGate, FaultTree


# --- BasicEvent ---

def test_basic_event_probability():
    e = BasicEvent('A', 0.1)
    assert e.probability_of_occurrence() == pytest.approx(0.1)


def test_basic_event_cut_set():
    e = BasicEvent('A', 0.1)
    mcs = e.get_minimal_cut_sets()
    assert len(mcs) == 1
    assert mcs[0] == {'A'}


# --- AndGate ---

def test_and_gate_probability():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    gate = AndGate('G1', [a, b])
    assert gate.probability_of_occurrence() == pytest.approx(0.02)


def test_and_gate_cut_sets():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    gate = AndGate('G1', [a, b])
    mcs = gate.get_minimal_cut_sets()
    assert len(mcs) == 1
    assert mcs[0] == {'A', 'B'}


def test_and_gate_three_inputs():
    inputs = [BasicEvent(name, 0.1) for name in ['A', 'B', 'C']]
    gate = AndGate('G', inputs)
    assert gate.probability_of_occurrence() == pytest.approx(0.001)


# --- OrGate ---

def test_or_gate_probability():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    gate = OrGate('G1', [a, b])
    assert gate.probability_of_occurrence() == pytest.approx(1 - 0.9 * 0.8)


def test_or_gate_cut_sets():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    gate = OrGate('G1', [a, b])
    mcs = gate.get_minimal_cut_sets()
    assert len(mcs) == 2
    names = {frozenset(cs) for cs in mcs}
    assert frozenset({'A'}) in names
    assert frozenset({'B'}) in names


# --- VoteGate ---

def test_vote_gate_1_of_2():
    a = BasicEvent('A', 0.8)
    b = BasicEvent('B', 0.8)
    gate = VoteGate('G', k=1, inputs=[a, b])
    or_gate = OrGate('G2', [a, b])
    assert gate.probability_of_occurrence() == pytest.approx(
        or_gate.probability_of_occurrence(), rel=1e-6)


def test_vote_gate_2_of_2():
    a = BasicEvent('A', 0.8)
    b = BasicEvent('B', 0.8)
    gate = VoteGate('G', k=2, inputs=[a, b])
    and_gate = AndGate('G2', [a, b])
    assert gate.probability_of_occurrence() == pytest.approx(
        and_gate.probability_of_occurrence(), rel=1e-6)


def test_vote_gate_cut_sets_2_of_3():
    inputs = [BasicEvent(name, 0.1) for name in ['A', 'B', 'C']]
    gate = VoteGate('G', k=2, inputs=inputs)
    mcs = gate.get_minimal_cut_sets()
    assert len(mcs) == 3  # {A,B}, {A,C}, {B,C}


# --- FaultTree ---

def test_fault_tree_simple_or():
    a = BasicEvent('A', 0.01)
    b = BasicEvent('B', 0.02)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    assert ft.top_event_probability == pytest.approx(1 - 0.99 * 0.98)
    assert len(ft.minimal_cut_sets) == 2


def test_fault_tree_simple_and():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = AndGate('TOP', [a, b])
    ft = FaultTree(top)
    assert ft.top_event_probability == pytest.approx(0.02)
    assert len(ft.minimal_cut_sets) == 1


def test_fault_tree_nested():
    # TOP = OR(AND(A,B), C)
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.1)
    c = BasicEvent('C', 0.05)
    and_gate = AndGate('G1', [a, b])
    top = OrGate('TOP', [and_gate, c])
    ft = FaultTree(top)
    mcs_names = [frozenset(cs) for cs in ft.minimal_cut_sets]
    assert frozenset({'A', 'B'}) in mcs_names
    assert frozenset({'C'}) in mcs_names


def test_birnbaum_importance():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    ib_a = ft.birnbaum_importance('A')
    assert 0 <= ib_a <= 1


def test_birnbaum_importance_and_gate():
    # In AND gate, IB = P(B) since I_B(A) = P(system fails | A=1) - P(system fails | A=0)
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.3)
    top = AndGate('TOP', [a, b])
    ft = FaultTree(top)
    ib_a = ft.birnbaum_importance('A')
    assert ib_a == pytest.approx(b.probability, rel=1e-9)


def test_fussell_vesely_importance():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    fv = ft.fussell_vesely_importance('A')
    assert 0 <= fv <= 1


def test_raw_importance():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    raw = ft.raw_importance('A')
    assert raw >= 1.0  # RAW >= 1 always


def test_rrw_importance():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    rrw = ft.rrw_importance('A')
    assert rrw >= 1.0  # RRW >= 1 always


def test_importance_table():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    table = ft.importance_table()
    assert 'A' in table
    assert 'B' in table
    assert set(table['A'].keys()) == {'Birnbaum', 'Fussell-Vesely', 'RAW', 'RRW'}


def test_unknown_event_raises():
    a = BasicEvent('A', 0.1)
    top = OrGate('TOP', [a])
    ft = FaultTree(top)
    with pytest.raises(ValueError):
        ft.birnbaum_importance('X')


# --- VoteGate heterogeneous probabilities ---

def test_vote_gate_heterogeneous_2_of_3():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    c = BasicEvent('C', 0.3)
    gate = VoteGate('G', k=2, inputs=[a, b, c])
    # Hand-calculated:
    # P(exactly 2 fail) = 0.1*0.2*0.7 + 0.1*0.8*0.3 + 0.9*0.2*0.3 = 0.092
    # P(exactly 3 fail) = 0.1*0.2*0.3 = 0.006
    # P(at least 2 fail) = 0.098
    assert gate.probability_of_occurrence() == pytest.approx(0.098, rel=1e-9)


# --- Monte Carlo simulation ---

def test_monte_carlo_returns_expected_keys():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    result = ft.monte_carlo_simulation(n_samples=10000, seed=42)
    assert set(result.keys()) == {'probability', 'std_error', 'ci_lower', 'ci_upper', 'n_samples'}
    assert result['n_samples'] == 10000
    expected = 1 - 0.9 * 0.8  # 0.28
    assert result['probability'] == pytest.approx(expected, abs=0.03)
    assert result['ci_lower'] <= result['probability'] <= result['ci_upper']


def test_monte_carlo_reproducible_with_seed():
    a = BasicEvent('A', 0.1)
    b = BasicEvent('B', 0.2)
    top = OrGate('TOP', [a, b])
    ft = FaultTree(top)
    r1 = ft.monte_carlo_simulation(n_samples=5000, seed=123)
    r2 = ft.monte_carlo_simulation(n_samples=5000, seed=123)
    assert r1['probability'] == r2['probability']
    assert r1['std_error'] == r2['std_error']
