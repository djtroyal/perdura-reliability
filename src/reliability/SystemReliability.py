"""
System reliability analysis: Reliability Block Diagrams (RBDs).

Supports series, parallel, k-out-of-n, and network (path-set) configurations.
"""

import numpy as np
from itertools import combinations

from reliability.FaultTree import (
    DEFAULT_MAX_EXACT_STATES,
    ExactEvaluationLimitError,
    exact_probability_from_cut_sets,
)


def exact_network_reliability(adjacency, start, end, component_requirements,
                              variable_probabilities,
                              max_states=DEFAULT_MAX_EXACT_STATES,
                              return_diagnostics=False):
    """Evaluate directed network connectivity by reduced Shannon decomposition.

    ``component_requirements`` maps each fallible component node to the latent
    Boolean success variables that must all be true for that component to be
    available.  Independent RBDs use one variable per component.  A beta-factor
    common-cause group adds the same group-survival variable to every member,
    creating dependence without enumerating source-to-sink paths.

    The acyclic graph is composed into a reduced ordered binary decision
    diagram (ROBDD). Shared downstream components and common-cause variables
    retain one Boolean identity, so structured networks with exponentially
    many explicit path sets can remain compact.
    """
    if max_states < 1:
        raise ValueError("max_states must be at least 1.")

    adjacency = {node: tuple(neighbors) for node, neighbors in adjacency.items()}
    requirements = {
        component: frozenset(required)
        for component, required in component_requirements.items()
    }
    probabilities = {}
    for variable, value in variable_probabilities.items():
        probability = float(value)
        if not np.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise ValueError(
                f"Latent-variable probability for {variable!r} must be finite "
                "and between 0 and 1."
            )
        probabilities[variable] = probability
    referenced = set().union(*requirements.values()) if requirements else set()
    missing = referenced - set(probabilities)
    if missing:
        raise ValueError(
            f"Component requirements reference unknown variables: {sorted(missing, key=str)}"
        )

    # A topological depth gives a stable frontier-friendly variable order.
    all_nodes = (
        set(adjacency)
        | {neighbor for neighbors in adjacency.values() for neighbor in neighbors}
    )
    indegree = {node: 0 for node in all_nodes}
    for neighbors in adjacency.values():
        for neighbor in neighbors:
            indegree[neighbor] = indegree.get(neighbor, 0) + 1
    queue = [node for node, degree in indegree.items() if degree == 0]
    topological = []
    while queue:
        node = min(queue, key=str)
        queue.remove(node)
        topological.append(node)
        for neighbor in adjacency.get(node, ()):
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)
    if len(topological) != len(all_nodes):
        raise ValueError(
            "Exact RBD evaluation requires an acyclic directed diagram; "
            "remove feedback loops or use a state-space model."
        )
    depth = {node: 0 for node in topological}
    for node in topological:
        for neighbor in adjacency.get(node, ()):
            depth[neighbor] = max(depth.get(neighbor, 0), depth[node] + 1)

    insertion_order = {variable: index for index, variable in enumerate(probabilities)}
    variable_depth = {}
    variable_occurrences = {}
    for variable in referenced:
        members = [
            component for component, required in requirements.items()
            if variable in required
        ]
        variable_depth[variable] = min((depth.get(member, 0) for member in members),
                                       default=0)
        variable_occurrences[variable] = len(members)
    ordered_variables = sorted(
        referenced,
        key=lambda variable: (
            variable_depth[variable],
            -variable_occurrences[variable],
            insertion_order.get(variable, len(insertion_order)),
            str(variable),
        ),
    )
    order = {variable: index for index, variable in enumerate(ordered_variables)}

    # ROBDD terminals are 0=False and 1=True. Non-terminal ids index ``nodes``.
    nodes = {}
    unique = {}
    apply_cache = {}
    apply_cache_hits = 0

    def mk(variable_index, low, high):
        if low == high:
            return low
        key = (variable_index, low, high)
        existing = unique.get(key)
        if existing is not None:
            return existing
        if len(nodes) >= max_states:
            raise ExactEvaluationLimitError(
                "Exact RBD evaluation exceeded "
                f"{max_states:,} ROBDD nodes. Simplify/modularize the network "
                "or request a separately labeled simulation."
            )
        node_id = len(nodes) + 2
        nodes[node_id] = key
        unique[key] = node_id
        return node_id

    variable_nodes = {
        variable: mk(order[variable], 0, 1)
        for variable in ordered_variables
    }

    def apply(operator, left, right):
        nonlocal apply_cache_hits
        if operator in {"and", "or"} and left > right:
            left, right = right, left
        key = (operator, left, right)
        if key in apply_cache:
            apply_cache_hits += 1
            return apply_cache[key]

        if operator == "and":
            if left == 0 or right == 0:
                return 0
            if left == 1:
                return right
            if right == 1 or left == right:
                return left
        elif operator == "or":
            if left == 1 or right == 1:
                return 1
            if left == 0:
                return right
            if right == 0 or left == right:
                return left
        else:
            raise ValueError(f"Unsupported BDD operator {operator!r}.")

        left_var = nodes[left][0]
        right_var = nodes[right][0]
        top = min(left_var, right_var)
        if left_var == top:
            _, left_low, left_high = nodes[left]
        else:
            left_low = left_high = left
        if right_var == top:
            _, right_low, right_high = nodes[right]
        else:
            right_low = right_high = right
        low = apply(operator, left_low, right_low)
        high = apply(operator, left_high, right_high)
        result = mk(top, low, high)
        apply_cache[key] = result
        return result

    availability = {}
    for component, required in requirements.items():
        expression = 1
        for variable in sorted(required, key=lambda item: order[item]):
            expression = apply("and", expression, variable_nodes[variable])
        availability[component] = expression

    expression_cache = {}
    visiting = set()

    def connection_expression(node):
        if node == end:
            return 1
        if node in expression_cache:
            return expression_cache[node]
        if node in visiting:
            raise ValueError(
                "Exact RBD evaluation requires an acyclic directed diagram; "
                "remove feedback loops or use a state-space model."
            )
        visiting.add(node)
        expression = 0
        for neighbor in adjacency.get(node, ()):
            branch = connection_expression(neighbor)
            if neighbor in availability:
                branch = apply("and", availability[neighbor], branch)
            expression = apply("or", expression, branch)
        visiting.remove(node)
        expression_cache[node] = expression
        return expression

    root = connection_expression(start)
    probability_cache = {0: 0.0, 1: 1.0}

    def evaluate(node_id):
        if node_id in probability_cache:
            return probability_cache[node_id]
        variable_index, low, high = nodes[node_id]
        variable = ordered_variables[variable_index]
        probability = probabilities[variable]
        value = ((1.0 - probability) * evaluate(low)
                 + probability * evaluate(high))
        probability_cache[node_id] = value
        return value

    reliability = max(0.0, min(1.0, evaluate(root)))
    if not return_diagnostics:
        return reliability
    return reliability, {
        "engine": "reduced_bdd_network_connectivity",
        "exact": True,
        "states_evaluated": len(nodes),
        "cache_hits": apply_cache_hits,
        "terminal_evaluations": 2,
        "variables": len(referenced),
        "components": len(requirements),
        "max_states": max_states,
        "state_limit_reached": False,
        "path_enumeration_used_for_probability": False,
    }


class SeriesSystem:
    """System where all components must function.

    Parameters
    ----------
    component_reliabilities : array-like
        Reliability (probability of functioning) of each component.
    """

    def __init__(self, component_reliabilities):
        self.component_reliabilities = np.asarray(component_reliabilities, dtype=float)
        self.reliability = float(np.prod(self.component_reliabilities))
        self.unreliability = 1.0 - self.reliability

    def __repr__(self):
        return (f"SeriesSystem(n={len(self.component_reliabilities)}, "
                f"R={self.reliability:.6f})")


class ParallelSystem:
    """System where at least one component must function.

    Parameters
    ----------
    component_reliabilities : array-like
        Reliability (probability of functioning) of each component.
    """

    def __init__(self, component_reliabilities):
        self.component_reliabilities = np.asarray(component_reliabilities, dtype=float)
        unreliabilities = 1.0 - self.component_reliabilities
        self.unreliability = float(np.prod(unreliabilities))
        self.reliability = 1.0 - self.unreliability

    def __repr__(self):
        return (f"ParallelSystem(n={len(self.component_reliabilities)}, "
                f"R={self.reliability:.6f})")


class KofNSystem:
    """K-out-of-N system (majority vote / redundancy).

    At least k of n identical components must function.

    Parameters
    ----------
    k : int
        Minimum number of components required.
    n : int
        Total number of components.
    component_reliability : float
        Reliability of each (identical) component.
    """

    def __init__(self, k, n, component_reliability):
        if k > n:
            raise ValueError("k cannot exceed n")
        self.k = k
        self.n = n
        self.component_reliability = float(component_reliability)
        p = self.component_reliability
        q = 1.0 - p

        # Sum of binomial terms for exactly j successes, j = k..n
        reliability = 0.0
        from math import comb
        for j in range(k, n + 1):
            reliability += comb(n, j) * (p ** j) * (q ** (n - j))
        self.reliability = reliability
        self.unreliability = 1.0 - reliability

    def __repr__(self):
        return (f"KofNSystem(k={self.k}, n={self.n}, "
                f"R_component={self.component_reliability:.4f}, "
                f"R={self.reliability:.6f})")


class NetworkSystem:
    """General independent-component network RBD using minimal path sets.

    Parameters
    ----------
    path_sets : list of list/set
        Each inner list is a minimal path set — a set of component indices
        whose simultaneous functioning guarantees system success.
    component_reliabilities : array-like
        Reliability of component i at index i.

    max_states : int
        Maximum reduced-BDD states.  Exceeding the limit raises explicitly;
        an approximation is never substituted for the exact result.

    Notes
    -----
    The union of minimal path sets is evaluated with memoized Shannon
    decomposition (a reduced BDD over the path-set DNF).  This avoids the
    ``2**n_paths`` inclusion-exclusion expansion and remains exact for shared
    components.
    """

    def __init__(self, path_sets, component_reliabilities,
                 max_states=DEFAULT_MAX_EXACT_STATES):
        self.path_sets = [frozenset(p) for p in path_sets]
        self.component_reliabilities = np.asarray(component_reliabilities, dtype=float)
        if self.component_reliabilities.ndim != 1:
            raise ValueError("component_reliabilities must be one-dimensional.")
        if not np.all(np.isfinite(self.component_reliabilities)):
            raise ValueError("component reliabilities must be finite.")
        if np.any((self.component_reliabilities < 0.0)
                  | (self.component_reliabilities > 1.0)):
            raise ValueError("component reliabilities must be between 0 and 1.")
        n_components = len(self.component_reliabilities)
        for path in self.path_sets:
            for component in path:
                if (isinstance(component, bool)
                        or not isinstance(component, (int, np.integer))
                        or not 0 <= int(component) < n_components):
                    raise ValueError(
                        f"Path set references invalid component index {component!r}."
                    )

        probabilities = {
            index: reliability
            for index, reliability in enumerate(self.component_reliabilities)
        }
        self.reliability, self.computation_diagnostics = (
            exact_probability_from_cut_sets(
                self.path_sets,
                probabilities,
                max_states=max_states,
                return_diagnostics=True,
            )
        )
        self.unreliability = 1.0 - self.reliability

    def _path_prob(self, path):
        """Probability that all components in path function."""
        return float(np.prod(self.component_reliabilities[list(path)]))

    def _union_prob(self, paths):
        """P(A1 ∪ A2 ∪ ... ∪ Ak) via inclusion-exclusion."""
        n = len(paths)
        total = 0.0
        for size in range(1, n + 1):
            sign = (-1) ** (size + 1)
            for combo in combinations(range(n), size):
                union_path = frozenset().union(*[paths[i] for i in combo])
                total += sign * self._path_prob(union_path)
        return total

    def _inclusion_exclusion(self):
        """Reference evaluator retained for small-case validation tests."""
        return self._union_prob(self.path_sets)

    def __repr__(self):
        return (f"NetworkSystem(paths={len(self.path_sets)}, "
                f"components={len(self.component_reliabilities)}, "
                f"R={self.reliability:.6f})")


def system_reliability_from_blocks(blocks):
    """Compute system reliability from a nested block description.

    Parameters
    ----------
    blocks : dict
        Nested description of the system. Format::

            {'type': 'series'|'parallel'|'kofn'|'component',
             'components': [...],   # for series/parallel
             'k': int,              # for kofn
             'n': int,              # for kofn
             'reliability': float,  # for component
             'sub': dict}           # for kofn (single subsystem)

    Returns
    -------
    float
        System reliability.
    """
    btype = blocks.get('type', 'component')

    if btype == 'component':
        return float(blocks['reliability'])

    elif btype == 'series':
        sub_reliabilities = [system_reliability_from_blocks(c)
                             for c in blocks['components']]
        return float(np.prod(sub_reliabilities))

    elif btype == 'parallel':
        sub_unreliabilities = [1.0 - system_reliability_from_blocks(c)
                               for c in blocks['components']]
        return 1.0 - float(np.prod(sub_unreliabilities))

    elif btype == 'kofn':
        k = blocks['k']
        n = blocks['n']
        sub_r = system_reliability_from_blocks(blocks['sub'])
        sys = KofNSystem(k, n, sub_r)
        return sys.reliability

    else:
        raise ValueError(f"Unknown block type: {btype!r}")
