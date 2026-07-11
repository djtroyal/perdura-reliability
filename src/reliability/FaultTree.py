"""
Fault Tree Analysis (FTA).

Supports AND, OR, and VOTE (k-out-of-n) gates with basic events.
Computes top-event probability, minimal cut sets (MOCUS), and
importance measures (Birnbaum, Fussell-Vesely, RAW, RRW).
"""

import numpy as np
from itertools import combinations
from statistics import NormalDist


DEFAULT_MAX_EXACT_STATES = 250_000


class ExactEvaluationLimitError(ValueError):
    """Exact independent-event evaluation exceeded its configured state limit."""


def _canonical_cut_sets(cut_sets):
    """Return a deterministic minimal tuple representation of cut sets."""
    unique = {frozenset(cs) for cs in cut_sets}
    ordered = sorted(unique, key=lambda cs: (len(cs), tuple(sorted(cs))))
    minimal = []
    for cut_set in ordered:
        if any(existing.issubset(cut_set) for existing in minimal):
            continue
        minimal.append(cut_set)
    return tuple(tuple(sorted(cut_set)) for cut_set in minimal)


def exact_probability_from_cut_sets(cut_sets, events,
                                    max_states=DEFAULT_MAX_EXACT_STATES,
                                    return_diagnostics=False):
    """Evaluate the exact union probability of independent minimal cut sets.

    A reduced Shannon decomposition is used instead of inclusion-exclusion.
    Each memoized state is a monotone DNF represented by its minimal cut sets,
    which is equivalent to constructing a binary decision diagram (BDD). This
    retains exact shared-event semantics without scaling as ``2**n_cut_sets``
    for common structured trees.

    Parameters
    ----------
    cut_sets : iterable[iterable[str]]
        Minimal (or non-minimal) cut sets.
    events : mapping[str, BasicEvent | float]
        Independent basic-event probabilities.
    max_states : int
        Maximum unique non-terminal BDD states before an explicit error is
        raised. The function never substitutes an approximation for an exact
        result.
    return_diagnostics : bool
        If True, return ``(probability, diagnostics)``.  The default preserves
        the historical float return value.
    """
    if max_states < 1:
        raise ValueError("max_states must be at least 1.")

    probabilities = {}
    for name, event in events.items():
        probability = float(getattr(event, 'probability', event))
        if not 0 <= probability <= 1:
            raise ValueError(
                f"Basic-event probability for {name!r} must be between 0 and 1.")
        probabilities[name] = probability

    initial_state = _canonical_cut_sets(cut_sets)
    cache = {}
    states_evaluated = 0
    cache_hits = 0
    terminal_evaluations = 0

    def solve(state):
        nonlocal states_evaluated, cache_hits, terminal_evaluations
        if not state:
            terminal_evaluations += 1
            return 0.0
        if any(len(cut_set) == 0 for cut_set in state):
            terminal_evaluations += 1
            return 1.0
        if state in cache:
            cache_hits += 1
            return cache[state]
        if states_evaluated >= max_states:
            raise ExactEvaluationLimitError(
                "Exact fault-tree evaluation exceeded "
                f"{max_states:,} BDD states. Request a separately labeled "
                "bound or simulation, or simplify/modularize the tree.")
        states_evaluated += 1

        counts = {}
        for cut_set in state:
            for event_name in cut_set:
                if event_name not in probabilities:
                    raise ValueError(
                        f"Cut set references unknown basic event {event_name!r}.")
                counts[event_name] = counts.get(event_name, 0) + 1
        # Branch first on the event shared by the most terms. This is a simple
        # deterministic BDD ordering heuristic that collapses common causes
        # and mirrored events early.
        event_name = max(counts, key=lambda name: (counts[name], name))

        true_sets = []
        false_sets = []
        for cut_set in state:
            current = set(cut_set)
            if event_name in current:
                current.remove(event_name)
                true_sets.append(current)
            else:
                true_sets.append(current)
                false_sets.append(current)

        p_event = probabilities[event_name]
        true_probability = solve(_canonical_cut_sets(true_sets))
        false_probability = solve(_canonical_cut_sets(false_sets))
        result = (p_event * true_probability
                  + (1.0 - p_event) * false_probability)
        result = max(0.0, min(1.0, result))
        cache[state] = result
        return result

    probability = solve(initial_state)
    if not return_diagnostics:
        return probability
    variables = sorted(
        {event_name for cut_set in initial_state for event_name in cut_set},
        key=str,
    )
    return probability, {
        "engine": "reduced_bdd_shannon_dnf",
        "exact": True,
        "states_evaluated": states_evaluated,
        "cache_hits": cache_hits,
        "terminal_evaluations": terminal_evaluations,
        "variables": len(variables),
        "terms": len(initial_state),
        "max_states": max_states,
        "state_limit_reached": False,
    }


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
        # General case: DP for P(at least k of n fail) with unequal probabilities
        # dp[j] = P(exactly j of the first i items fail)
        dp = [0.0] * (n + 1)
        dp[0] = 1.0
        for i in range(n):
            pi = probs[i]
            # Iterate backwards to avoid overwriting values we still need
            for j in range(min(i + 1, n), 0, -1):
                dp[j] = dp[j] * (1.0 - pi) + dp[j - 1] * pi
            dp[0] *= (1.0 - pi)
        return max(0.0, min(1.0, sum(dp[k:])))

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
        self.top_event_probability = self._compute_top_probability()

    def _event_occurrence_counts(self, node=None, counts=None):
        """Count how many times each basic-event name appears in the tree
        structure. A name appearing more than once indicates a repeated /
        mirror / common-cause event that the per-gate independence formula
        would mishandle."""
        if counts is None:
            counts = {}
        if node is None:
            node = self.top_event
        if isinstance(node, BasicEvent):
            counts[node.name] = counts.get(node.name, 0) + 1
            return counts
        for inp in getattr(node, "inputs", []):
            self._event_occurrence_counts(inp, counts)
        return counts

    def _compute_top_probability(self):
        """Top-event probability.

        When every basic event appears exactly once in the tree, the
        recursive per-gate formula is exact and fast, so it is used directly.
        When repeated/mirror events are present (a name occurs more than
        once), that formula double-counts the shared event, so an exact BDD
        evaluation over minimal cut sets is used. If its explicit state limit
        is exceeded, an error is raised; an approximation is never returned
        under the exact ``top_event_probability`` attribute.
        """
        counts = self._event_occurrence_counts()
        has_repeats = any(c > 1 for c in counts.values())
        if not has_repeats:
            return self.top_event.probability_of_occurrence()
        return self._probability_from_cut_sets()

    def _mincut_upper_bound(self):
        """Esary-Proschan min-cut upper bound on the top-event probability."""
        events = self._collect_basic_events()
        prod = 1.0
        for mcs in self.minimal_cut_sets:
            p = float(np.prod([events[e].probability for e in mcs]))
            prod *= (1.0 - min(1.0, p))
        return max(0.0, min(1.0, 1.0 - prod))

    def _probability_from_cut_sets(self):
        """Exact independent-event probability from minimal cut sets via BDD."""
        events = self._collect_basic_events()
        return exact_probability_from_cut_sets(self.minimal_cut_sets, events)

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
        # Conditional evaluations must use the same exact path as the reported
        # top-event probability (inclusion-exclusion when events repeat) — the
        # per-gate formula double-counts shared events and made Birnbaum/RAW/
        # RRW inconsistent with P(top).
        events[event_name].probability = 1.0
        p1 = self._compute_top_probability()
        events[event_name].probability = 0.0
        p0 = self._compute_top_probability()
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

        relevant_probability = exact_probability_from_cut_sets(
            relevant_mcs, events)
        return relevant_probability / p_top

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
        p1 = self._compute_top_probability()
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
        p0 = self._compute_top_probability()
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

    def _simulate_node(self, node, failed_set):
        """Recursively evaluate whether *node* has failed given *failed_set*."""
        if isinstance(node, BasicEvent):
            return node.name in failed_set
        if isinstance(node, AndGate):
            return all(self._simulate_node(inp, failed_set) for inp in node.inputs)
        if isinstance(node, OrGate):
            return any(self._simulate_node(inp, failed_set) for inp in node.inputs)
        if isinstance(node, VoteGate):
            return sum(self._simulate_node(inp, failed_set) for inp in node.inputs) >= node.k
        raise TypeError(f"Unknown node type: {type(node)}")

    def monte_carlo_simulation(self, n_samples=100000, seed=None,
                               confidence_level=0.95):
        """Estimate top-event probability via Monte Carlo simulation.

        A Wilson score interval is reported instead of a symmetric Wald
        interval.  Wilson bounds remain non-degenerate when zero or every
        simulated trial reaches the top event.
        """
        if isinstance(n_samples, bool) or int(n_samples) != n_samples or n_samples < 1:
            raise ValueError("n_samples must be a positive integer.")
        n_samples = int(n_samples)
        confidence_level = float(confidence_level)
        if not 0.0 < confidence_level < 1.0:
            raise ValueError("confidence_level must be between 0 and 1.")
        rng = np.random.default_rng(seed)
        events = self._collect_basic_events()
        event_names = sorted(events.keys())
        event_probs = np.array([events[name].probability for name in event_names])
        failures = 0
        for _ in range(n_samples):
            draws = rng.random(len(event_names))
            failed_set = {name for name, d, p in zip(event_names, draws, event_probs) if d < p}
            if self._simulate_node(self.top_event, failed_set):
                failures += 1
        p_hat = failures / n_samples
        std_error = np.sqrt(p_hat * (1.0 - p_hat) / n_samples)
        alpha = 1.0 - confidence_level
        z = NormalDist().inv_cdf(1.0 - alpha / 2.0)
        z2 = z * z
        denominator = 1.0 + z2 / n_samples
        center = (p_hat + z2 / (2.0 * n_samples)) / denominator
        half_width = (
            z * np.sqrt(
                p_hat * (1.0 - p_hat) / n_samples
                + z2 / (4.0 * n_samples * n_samples)
            ) / denominator
        )
        ci_lower = max(0.0, center - half_width)
        ci_upper = min(1.0, center + half_width)
        if failures == 0:
            ci_lower = 0.0
        if failures == n_samples:
            ci_upper = 1.0
        zero_event_upper_bound = (
            1.0 - alpha ** (1.0 / n_samples) if failures == 0 else None
        )
        return {
            'probability': p_hat,
            'std_error': std_error,
            'ci_lower': ci_lower,
            'ci_upper': ci_upper,
            'n_samples': n_samples,
            'top_event_count': failures,
            'confidence_level': confidence_level,
            'interval_method': 'wilson_score',
            'resolution_limit': 1.0 / n_samples,
            'zero_event_upper_bound': zero_event_upper_bound,
        }

    def __repr__(self):
        return (f"FaultTree(top={self.top_event.name!r}, "
                f"P={self.top_event_probability:.6g}, "
                f"MCS={len(self.minimal_cut_sets)})")
