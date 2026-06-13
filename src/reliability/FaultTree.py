"""
Fault Tree Analysis (FTA).

Supports AND, OR, and VOTE (k-out-of-n) gates with basic events.
Computes top-event probability, minimal cut sets (MOCUS), and
importance measures (Birnbaum, Fussell-Vesely, RAW, RRW).
"""

import numpy as np
from itertools import combinations


# ---------------------------------------------------------------------------
# Gate / Event nodes
# ---------------------------------------------------------------------------

class BasicEvent:
    """A leaf node representing a basic failure event.

    Parameters
    ----------
    name : str
        Identifier for this event.
    probability : float
        Probability of occurrence (0..1).
    """

    def __init__(self, name, probability):
        self.name = name
        self.probability = float(probability)

    def probability_of_occurrence(self):
        return self.probability

    def get_minimal_cut_sets(self):
        """Return minimal cut sets — single-element set containing this event."""
        return [{self.name}]

    def __repr__(self):
        return f"BasicEvent({self.name!r}, p={self.probability})"


class AndGate:
    """AND gate — fails when ALL inputs fail.

    Parameters
    ----------
    name : str
        Identifier.
    inputs : list
        Child nodes (BasicEvent or gate objects).
    """

    def __init__(self, name, inputs):
        self.name = name
        self.inputs = list(inputs)

    def probability_of_occurrence(self):
        return float(np.prod([inp.probability_of_occurrence() for inp in self.inputs]))

    def get_minimal_cut_sets(self):
        """AND of children: cartesian product of each child's cut sets."""
        result = [set()]
        for inp in self.inputs:
            child_sets = inp.get_minimal_cut_sets()
            result = [a | b for a in result for b in child_sets]
        return _minimize_cut_sets(result)

    def __repr__(self):
        return f"AndGate({self.name!r}, inputs={len(self.inputs)})"


class OrGate:
    """OR gate — fails when ANY input fails.

    Parameters
    ----------
    name : str
        Identifier.
    inputs : list
        Child nodes.
    """

    def __init__(self, name, inputs):
        self.name = name
        self.inputs = list(inputs)

    def probability_of_occurrence(self):
        # Rare-event approximation: P ≈ 1 - prod(1 - P_i)
        unreliabilities = [inp.probability_of_occurrence() for inp in self.inputs]
        return 1.0 - float(np.prod([1.0 - u for u in unreliabilities]))

    def get_minimal_cut_sets(self):
        """OR of children: union of each child's cut sets."""
        result = []
        for inp in self.inputs:
            result.extend(inp.get_minimal_cut_sets())
        return _minimize_cut_sets(result)

    def __repr__(self):
        return f"OrGate({self.name!r}, inputs={len(self.inputs)})"


class VoteGate:
    """K-out-of-N vote gate — fails when at least k of n inputs fail.

    Parameters
    ----------
    name : str
        Identifier.
    k : int
        Minimum number of inputs that must fail.
    inputs : list
        Child nodes (all treated as identical for cut-set generation).
    """

    def __init__(self, name, k, inputs):
        self.name = name
        self.k = k
        self.inputs = list(inputs)

    def probability_of_occurrence(self):
        """Exact binomial probability (assumes identical input probabilities)."""
        from math import comb
        n = len(self.inputs)
        k = self.k
        # Use per-input probabilities if available (general case)
        probs = [inp.probability_of_occurrence() for inp in self.inputs]
        # If all equal, use binomial; otherwise inclusion-exclusion
        if len(set(round(p, 12) for p in probs)) == 1:
            p = probs[0]
            q = 1.0 - p
            return sum(comb(n, j) * (p ** j) * (q ** (n - j)) for j in range(k, n + 1))
        # General case via inclusion-exclusion over combinations that fail
        result = 0.0
        for combo in combinations(range(n), k):
            # Probability that exactly these k (at minimum) fail
            # Use inclusion-exclusion: P(at least k fail)
            pass
        # Fallback: sum over all subsets of size >= k
        total = 0.0
        for size in range(k, n + 1):
            for combo in combinations(range(n), size):
                sign = (-1) ** (size - k)  # inclusion-exclusion
                total += sign * float(np.prod([probs[i] for i in combo]))
        return max(0.0, min(1.0, total))

    def get_minimal_cut_sets(self):
        """Vote gate cut sets: all combinations of k inputs."""
        child_sets_list = [inp.get_minimal_cut_sets() for inp in self.inputs]
        result = []
        for combo in combinations(range(len(self.inputs)), self.k):
            # AND of selected inputs
            and_result = [set()]
            for idx in combo:
                and_result = [a | b for a in and_result for b in child_sets_list[idx]]
            result.extend(and_result)
        return _minimize_cut_sets(result)

    def __repr__(self):
        return f"VoteGate({self.name!r}, k={self.k}, n={len(self.inputs)})"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _minimize_cut_sets(cut_sets):
    """Remove supersets from a list of cut sets."""
    cut_sets = [frozenset(cs) for cs in cut_sets]
    minimal = []
    for cs in cut_sets:
        dominated = False
        for other in cut_sets:
            if other != cs and other.issubset(cs):
                dominated = True
                break
        if not dominated and cs not in minimal:
            minimal.append(cs)
    return [set(cs) for cs in minimal]


# ---------------------------------------------------------------------------
# FaultTree analysis class
# ---------------------------------------------------------------------------

class FaultTree:
    """Fault Tree Analysis wrapper.

    Parameters
    ----------
    top_event : gate or BasicEvent
        The root node of the fault tree.

    Attributes
    ----------
    top_event_probability : float
    minimal_cut_sets : list of set
    """

    def __init__(self, top_event):
        self.top_event = top_event
        self.minimal_cut_sets = top_event.get_minimal_cut_sets()
        self.top_event_probability = self._probability_from_cut_sets()

    def _probability_from_cut_sets(self):
        """Compute top-event probability from minimal cut sets via
        inclusion-exclusion. This is exact and handles shared/repeated
        basic events correctly (unlike the per-gate formula which assumes
        independence between branches)."""
        events = self._collect_basic_events()
        mcs = self.minimal_cut_sets
        if not mcs:
            return 0.0
        n = len(mcs)
        if n > 20:
            return self.top_event.probability_of_occurrence()
        total = 0.0
        for size in range(1, n + 1):
            sign = (-1) ** (size + 1)
            for combo in combinations(range(n), size):
                union_events = frozenset().union(*[mcs[i] for i in combo])
                prob = float(np.prod([events[e].probability for e in union_events]))
                total += sign * prob
        return max(0.0, min(1.0, total))

    def _collect_basic_events(self, node=None):
        """Return dict {name: BasicEvent} for all basic events in tree."""
        if node is None:
            node = self.top_event
        if isinstance(node, BasicEvent):
            return {node.name: node}
        events = {}
        for inp in node.inputs:
            events.update(self._collect_basic_events(inp))
        return events

    def birnbaum_importance(self, event_name):
        """Structural Birnbaum importance of a basic event.

        I_B = P(top | event=1) - P(top | event=0)
        """
        events = self._collect_basic_events()
        if event_name not in events:
            raise ValueError(f"Event {event_name!r} not found in tree")
        original = events[event_name].probability
        events[event_name].probability = 1.0
        p1 = self.top_event.probability_of_occurrence()
        events[event_name].probability = 0.0
        p0 = self.top_event.probability_of_occurrence()
        events[event_name].probability = original
        return p1 - p0

    def fussell_vesely_importance(self, event_name):
        """Fussell-Vesely importance.

        FV = P(at least one MCS containing event fails) / P(top)
        """
        p_top = self.top_event_probability
        if p_top == 0:
            return 0.0
        events = self._collect_basic_events()

        # P(union of MCS that contain the event)
        relevant_mcs = [mcs for mcs in self.minimal_cut_sets if event_name in mcs]
        if not relevant_mcs:
            return 0.0

        # Inclusion-exclusion over relevant MCS
        def mcs_prob(mcs):
            return float(np.prod([events[e].probability for e in mcs]))

        total = 0.0
        n = len(relevant_mcs)
        for size in range(1, n + 1):
            sign = (-1) ** (size + 1)
            for combo in combinations(range(n), size):
                union = frozenset().union(*[relevant_mcs[i] for i in combo])
                total += sign * mcs_prob(union)

        return total / p_top

    def raw_importance(self, event_name):
        """Risk Achievement Worth: P(top | event=1) / P(top)."""
        events = self._collect_basic_events()
        if event_name not in events:
            raise ValueError(f"Event {event_name!r} not found in tree")
        p_top = self.top_event_probability
        if p_top == 0:
            return float('inf')
        original = events[event_name].probability
        events[event_name].probability = 1.0
        p1 = self.top_event.probability_of_occurrence()
        events[event_name].probability = original
        return p1 / p_top

    def rrw_importance(self, event_name):
        """Risk Reduction Worth: P(top) / P(top | event=0)."""
        events = self._collect_basic_events()
        if event_name not in events:
            raise ValueError(f"Event {event_name!r} not found in tree")
        p_top = self.top_event_probability
        original = events[event_name].probability
        events[event_name].probability = 0.0
        p0 = self.top_event.probability_of_occurrence()
        events[event_name].probability = original
        if p0 == 0:
            return float('inf')
        return p_top / p0

    def importance_table(self):
        """Return dict of all importance measures for all basic events."""
        events = self._collect_basic_events()
        table = {}
        for name in events:
            table[name] = {
                'Birnbaum': self.birnbaum_importance(name),
                'Fussell-Vesely': self.fussell_vesely_importance(name),
                'RAW': self.raw_importance(name),
                'RRW': self.rrw_importance(name),
            }
        return table

    def __repr__(self):
        return (f"FaultTree(top={self.top_event.name!r}, "
                f"P={self.top_event_probability:.6g}, "
                f"MCS={len(self.minimal_cut_sets)})")
