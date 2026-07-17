"""Design of Experiments (DOE) module — pure NumPy implementation.

Each public generator returns a dict with at least:
  runs         : list[dict]  — factor_name -> coded value (±1 / 0 / level index)
  factor_names : list[str]
  coded        : np.ndarray  — (n_runs, k) coded design matrix
  metadata     : dict        — run_count, design_type, plus design-specific fields
"""

from __future__ import annotations

import itertools
import math
from typing import Optional, Union
import numpy as np
from scipy import optimize, stats

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _check_factor_names(factor_names: list[str]) -> None:
    if len(factor_names) < 1:
        raise ValueError("factor_names must have at least 1 element.")


def _coded_to_real(coded_val: float, low: float, high: float) -> float:
    """Map ±1 coded value to real units (linear)."""
    return 0.5 * (high + low) + 0.5 * (high - low) * coded_val


def _runs_from_matrix(matrix: np.ndarray, factor_names: list[str]) -> list[dict]:
    """Convert a coded matrix (n, k) into a list of dicts keyed by factor name."""
    runs = []
    for row in matrix:
        runs.append({name: float(row[i]) for i, name in enumerate(factor_names)})
    return runs


def map_to_real_units(
    runs: list[dict],
    factor_names: list[str],
    low: Optional[list[float]] = None,
    high: Optional[list[float]] = None,
    levels: Optional[list[list[float]]] = None,
) -> list[dict]:
    """Return a new list of runs with real-unit values appended (suffix '_real').

    For 2-level designs, pass low/high lists (same order as factor_names).
    For general factorial, pass levels[i] = list of actual level values for factor i.
    """
    if low is not None and high is not None:
        out = []
        for run in runs:
            r = dict(run)
            for i, name in enumerate(factor_names):
                r[f"{name}_real"] = _coded_to_real(run[name], low[i], high[i])
            out.append(r)
        return out
    if levels is not None:
        out = []
        for run in runs:
            r = dict(run)
            for i, name in enumerate(factor_names):
                idx = int(run[name])
                r[f"{name}_real"] = float(levels[i][idx])
            out.append(r)
        return out
    return runs


def randomize_runs(runs: list[dict], seed: Optional[int] = None) -> list[dict]:
    """Return a randomly shuffled copy of the run list."""
    rng = np.random.default_rng(seed)
    indices = rng.permutation(len(runs)).tolist()
    return [runs[i] for i in indices]


# ---------------------------------------------------------------------------
# SCREENING
# ---------------------------------------------------------------------------

def full_factorial_2level(factor_names: list[str]) -> dict:
    """Full 2^k factorial design with ±1 coding."""
    _check_factor_names(factor_names)
    k = len(factor_names)
    n = 2 ** k
    # Build standard order (MSB = first factor)
    coded = np.array(
        list(itertools.product([-1, 1], repeat=k)), dtype=float
    )
    runs = _runs_from_matrix(coded, factor_names)
    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "metadata": {
            "design_type": "Full 2-level factorial",
            "run_count": n,
            "k": k,
        },
    }


def _parse_generator_string(gen_str: str, basic_factors: list[str]) -> tuple[str, list[str]]:
    """Parse 'D=ABC' -> ('D', ['A','B','C'])."""
    gen_str = gen_str.replace(" ", "")
    if "=" not in gen_str:
        raise ValueError(f"Generator '{gen_str}' must have the form 'D=ABC'.")
    lhs, rhs = gen_str.split("=", 1)
    lhs = lhs.strip().upper()
    interactions = [c.upper() for c in rhs.strip()]
    for f in interactions:
        if f not in basic_factors:
            raise ValueError(
                f"Factor '{f}' in generator '{gen_str}' is not among the basic factors "
                f"{basic_factors}."
            )
    return lhs, interactions


def _word_length(word: list[str]) -> int:
    return len(word)


def _alias_word(word: list[str], generator_map: dict[str, list[str]]) -> list[str]:
    """Apply one generator substitution to expand a word (mod 2)."""
    result = list(word)
    changed = True
    while changed:
        changed = False
        for generated_factor, interaction in generator_map.items():
            if generated_factor in result:
                # replace generated_factor with its interaction (mod 2)
                result.remove(generated_factor)
                for f in interaction:
                    if f in result:
                        result.remove(f)
                    else:
                        result.append(f)
                changed = True
    return sorted(set(result))


def _defining_relation(generator_map: dict[str, list[str]], all_factors: list[str]) -> list[list[str]]:
    """Compute all words in the defining relation (I + generator words + their products)."""
    gen_words = []
    for gf, interaction in generator_map.items():
        word = sorted([gf] + interaction)
        gen_words.append(word)

    # All 2^p - 1 non-empty subsets of generator words -> multiply (mod 2)
    words = []
    p = len(gen_words)
    for mask in range(1, 2 ** p):
        combined: list[str] = []
        for i in range(p):
            if mask & (1 << i):
                combined.extend(gen_words[i])
        # reduce mod 2 (each factor appears even times -> cancel)
        from collections import Counter
        cnt = Counter(combined)
        word = sorted([f for f, c in cnt.items() if c % 2 == 1])
        if word not in words:
            words.append(word)

    return sorted(words, key=len)


def _aliases_for_effect(effect: list[str], def_rel: list[list[str]], all_factors: list[str]) -> list[list[str]]:
    """Return the alias group of an effect using the defining relation."""
    from collections import Counter
    aliases = []
    for word in def_rel:
        combined = effect + word
        cnt = Counter(combined)
        alias = sorted([f for f, c in cnt.items() if c % 2 == 1])
        if alias != effect and alias not in aliases:
            aliases.append(alias)
    return aliases


def fractional_factorial_2level(
    factor_names: list[str],
    generators: Optional[list[str]] = None,
    fraction: Optional[int] = None,
) -> dict:
    """2^(k-p) fractional factorial design.

    Parameters
    ----------
    factor_names : list of all factor names (basic + generated).
    generators   : list of strings like ["D=ABC", "E=ABD"].
                   If omitted, default generators are chosen based on fraction p.
    fraction     : p (number of generators) if generators not provided.
    """
    _check_factor_names(factor_names)
    k = len(factor_names)

    # Default generators table for common fractions (k, p) -> generators
    DEFAULT_GENERATORS: dict[tuple[int, int], list[str]] = {
        (4, 1): ["D=ABC"],
        (5, 1): ["E=ABCD"],
        (5, 2): ["D=AB", "E=AC"],
        (6, 1): ["F=ABCDE"],
        (6, 2): ["E=ABC", "F=BCD"],
        (6, 3): ["D=AB", "E=AC", "F=BC"],
        (7, 1): ["G=ABCDEF"],
        (7, 2): ["F=ABCD", "G=ABDE"],
        (7, 3): ["E=ABC", "F=BCD", "G=ACD"],
        (7, 4): ["D=AB", "E=AC", "F=BC", "G=ABC"],
        (8, 2): ["G=ABCDF", "H=ABCDE"],
        (8, 3): ["F=ABC", "G=ABD", "H=BCDE"],
        (8, 4): ["E=BCD", "F=ACD", "G=ABC", "H=ABD"],
    }

    if generators is None:
        if fraction is None:
            raise ValueError("Provide either generators or fraction (p).")
        p = fraction
        if (k, p) not in DEFAULT_GENERATORS:
            raise ValueError(
                f"No default generators for k={k}, p={p}. Please supply generators explicitly."
            )
        generators = DEFAULT_GENERATORS[(k, p)]

    p = len(generators)
    upper_factor_names = [f.upper() for f in factor_names]
    # Determine basic factors (the first k-p)
    generated_names: list[str] = []
    generator_map: dict[str, list[str]] = {}

    for gen_str in generators:
        lhs, rhs_factors = _parse_generator_string(gen_str, upper_factor_names)
        generated_names.append(lhs)
        generator_map[lhs] = rhs_factors

    basic_names = [f for f in upper_factor_names if f not in generated_names]
    kb = len(basic_names)

    if kb != k - p:
        raise ValueError(
            f"Expected {k-p} basic factors but got {kb} after removing generated factors."
        )

    # Build full factorial in basic factors
    base_coded = np.array(list(itertools.product([-1, 1], repeat=kb)), dtype=float)
    n_runs = 2 ** kb
    idx_map = {name: i for i, name in enumerate(basic_names)}

    # Build full design matrix
    full_coded = np.zeros((n_runs, k), dtype=float)
    for i, name in enumerate(upper_factor_names):
        if name in idx_map:
            full_coded[:, i] = base_coded[:, idx_map[name]]
        else:
            # generated column: product of interacting basic columns
            interaction = generator_map[name]
            col = np.ones(n_runs, dtype=float)
            for bf in interaction:
                col *= base_coded[:, idx_map[bf]]
            full_coded[:, i] = col

    runs = _runs_from_matrix(full_coded, factor_names)

    # Defining relation and resolution
    def_rel = _defining_relation(generator_map, upper_factor_names)
    word_lengths = [len(w) for w in def_rel]
    resolution = min(word_lengths) if word_lengths else k

    def_rel_str = " ".join(["I"] + ["".join(w) for w in def_rel])

    # Alias structure for main effects and 2fi
    alias_structure: dict[str, list[str]] = {}
    for fname in upper_factor_names:
        effect = [fname]
        aliases = _aliases_for_effect(effect, def_rel, upper_factor_names)
        if aliases:
            alias_structure[fname] = ["".join(a) for a in aliases]

    for i, fi in enumerate(upper_factor_names):
        for fj in upper_factor_names[i + 1:]:
            effect = sorted([fi, fj])
            key = "".join(effect)
            aliases = _aliases_for_effect(effect, def_rel, upper_factor_names)
            if aliases:
                alias_structure[key] = ["".join(a) for a in aliases]

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": full_coded,
        "metadata": {
            "design_type": f"Fractional factorial 2^({k}-{p})",
            "run_count": n_runs,
            "k": k,
            "p": p,
            "generators": generators,
            "defining_relation": def_rel_str,
            "resolution": resolution,
            "alias_structure": alias_structure,
        },
    }


def _sylvester_hadamard(n: int) -> np.ndarray:
    """Build n×n Hadamard matrix via Sylvester construction (n must be power of 2)."""
    H = np.array([[1]], dtype=float)
    size = 1
    while size < n:
        H = np.block([[H, H], [H, -H]])
        size *= 2
    return H


def _pb_first_rows() -> dict[int, list[int]]:
    """Hard-coded first rows for cyclic PB designs (from standard tables)."""
    return {
        12: [1, 1, -1, 1, 1, 1, -1, -1, -1, 1, -1],
        20: [1, 1, -1, -1, 1, 1, 1, 1, -1, 1, -1, 1, -1, -1, -1, -1, 1, 1, -1],
        24: [1, 1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, -1, -1, -1, -1],
    }


def plackett_burman(n_factors: int) -> dict:
    """Plackett-Burman design for n_factors factors.

    Uses tabulated cyclic constructions at 12, 20 and 24 runs and Sylvester
    Hadamard constructions at powers of two.  The public contract supports at
    most 63 factors (64 runs); unsupported intermediate run sizes advance to
    the next supported Hadamard order rather than claiming a nonexistent
    cyclic seed.
    """
    if n_factors < 1:
        raise ValueError("n_factors must be >= 1.")
    if n_factors > 63:
        raise ValueError(
            "Plackett-Burman supports 1 to 63 factors (4 to 64 runs).")

    # Determine N
    N = 4
    while N < n_factors + 1:
        N += 4

    # Build the N×(N-1) matrix
    supported_run_sizes = [4, 8, 12, 16, 20, 24, 32, 64]
    if N > 24:
        # Advance to a supported Sylvester-Hadamard order.
        import math
        p = math.ceil(math.log2(N))
        N = 2 ** p

    if N in (4, 8, 16, 32, 64):
        # Sylvester Hadamard
        H = _sylvester_hadamard(N)
        matrix = H[:, 1:]  # drop intercept column; shape (N, N-1)
        construction = "sylvester_hadamard"
    elif N in (12, 20, 24):
        first_rows = _pb_first_rows()
        row0 = np.array(first_rows[N], dtype=float)
        n_cols = N - 1
        # Build by cyclic shifts
        rows = []
        for shift in range(N - 1):
            rows.append(np.roll(row0, shift))
        rows.append(-np.ones(n_cols, dtype=float))  # last row: all -1
        matrix = np.array(rows, dtype=float)  # (N, N-1)
        construction = "tabulated_cyclic"
    else:
        raise ValueError(f"Plackett-Burman design not available for N={N}.")

    if n_factors > matrix.shape[1]:
        raise ValueError(
            f"Requested {n_factors} factors but design only has {matrix.shape[1]} columns."
        )

    coded = matrix[:, :n_factors]
    gram = coded.T @ coded
    if not np.allclose(gram, N * np.eye(n_factors), atol=1e-10):
        raise RuntimeError(
            f"Internal Plackett-Burman construction failed orthogonality at N={N}.")
    factor_names = [f"X{i+1}" for i in range(n_factors)]
    runs = _runs_from_matrix(coded, factor_names)

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "metadata": {
            "design_type": "Plackett-Burman",
            "N": N,
            "run_count": N,
            "n_factors": n_factors,
            "capacity": N - 1,
            "construction": construction,
            "supported_run_sizes": supported_run_sizes,
            "main_effect_columns_orthogonal": True,
        },
    }


# ---------------------------------------------------------------------------
# OPTIMIZATION
# ---------------------------------------------------------------------------

# Standard Box-Behnken designs for k=3..7
# Each entry is a list of (factor_indices_at_±1, all_others_at_0) blocks
_BBD_BLOCKS: dict[int, list[tuple[int, ...]]] = {
    3: [(0, 1), (0, 2), (1, 2)],
    4: [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)],
    5: [(0, 1), (0, 2), (0, 3), (0, 4), (1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)],
    6: [(0, 1), (0, 2), (0, 3), (0, 4), (0, 5), (1, 2), (1, 3), (1, 4), (1, 5),
        (2, 3), (2, 4), (2, 5), (3, 4), (3, 5), (4, 5)],
    7: [(0, 1), (0, 2), (0, 3), (0, 4), (0, 5), (0, 6), (1, 2), (1, 3), (1, 4),
        (1, 5), (1, 6), (2, 3), (2, 4), (2, 5), (2, 6), (3, 4), (3, 5), (3, 6),
        (4, 5), (4, 6), (5, 6)],
}


def box_behnken(factor_names: list[str], center_points: int = 3) -> dict:
    """Box-Behnken design for k=3..7 factors."""
    _check_factor_names(factor_names)
    k = len(factor_names)
    if k < 3 or k > 7:
        raise ValueError("Box-Behnken design is defined for k=3 to 7 factors.")

    blocks = _BBD_BLOCKS[k]
    rows = []
    for pair in blocks:
        # Four corner runs: ±1 on the pair, 0 on all others
        for s1, s2 in [(-1, -1), (-1, 1), (1, -1), (1, 1)]:
            row = np.zeros(k, dtype=float)
            row[pair[0]] = s1
            row[pair[1]] = s2
            rows.append(row)

    # Center points
    for _ in range(center_points):
        rows.append(np.zeros(k, dtype=float))

    coded = np.array(rows, dtype=float)
    runs = _runs_from_matrix(coded, factor_names)

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "metadata": {
            "design_type": "Box-Behnken",
            "k": k,
            "run_count": len(rows),
            "center_points": center_points,
            "factorial_runs": len(blocks) * 4,
        },
    }


def central_composite(
    factor_names: list[str],
    alpha: Union[str, float] = "rotatable",
    center_points: int = 4,
) -> dict:
    """Central Composite Design (CCD).

    alpha : 'rotatable' -> (2^k)^(1/4)
            'orthogonal' -> computed for orthogonality
            'face' -> 1.0
            float -> literal alpha value
    """
    _check_factor_names(factor_names)
    k = len(factor_names)

    # Factorial part (use resolution-V fraction for large k)
    FRACTIONS: dict[int, int] = {6: 1, 7: 1}
    p = FRACTIONS.get(k, 0)
    if p == 0:
        fact_coded = np.array(list(itertools.product([-1, 1], repeat=k)), dtype=float)
    else:
        ff = fractional_factorial_2level(factor_names, fraction=p)
        fact_coded = ff["coded"]

    n_fact = fact_coded.shape[0]

    # Alpha
    if alpha == "rotatable":
        alpha_val = float(n_fact ** 0.25)
    elif alpha == "face":
        alpha_val = 1.0
    elif alpha == "orthogonal":
        # Orthogonal condition: alpha = sqrt(k * sqrt(n_fact) / 2)
        alpha_val = float(np.sqrt(k * np.sqrt(n_fact) / 2.0))
    else:
        alpha_val = float(alpha)  # type: ignore[arg-type]

    # Axial points
    axial_rows = []
    for i in range(k):
        for sign in [-1, 1]:
            row = np.zeros(k, dtype=float)
            row[i] = sign * alpha_val
            axial_rows.append(row)

    axial_coded = np.array(axial_rows, dtype=float)

    # Center points
    center_coded = np.zeros((center_points, k), dtype=float)

    coded = np.vstack([fact_coded, axial_coded, center_coded])
    runs = _runs_from_matrix(coded, factor_names)

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "metadata": {
            "design_type": "Central Composite Design",
            "k": k,
            "alpha": alpha_val,
            "alpha_type": alpha if isinstance(alpha, str) else "custom",
            "run_count": coded.shape[0],
            "factorial_runs": n_fact,
            "axial_runs": 2 * k,
            "center_points": center_points,
            "fraction": p,
        },
    }


# ---------------------------------------------------------------------------
# MIXTURE
# ---------------------------------------------------------------------------

def simplex_lattice(q: int, degree: int) -> dict:
    """Simplex-lattice design {q, m}: all x_i = 0, 1/m, 2/m, ..., 1 summing to 1."""
    if q < 2:
        raise ValueError("q (number of components) must be >= 2.")
    if degree < 1:
        raise ValueError("degree (m) must be >= 1.")

    m = degree
    # All non-negative integer solutions to sum = m, divide by m
    compositions = []
    for combo in itertools.product(range(m + 1), repeat=q):
        if sum(combo) == m:
            compositions.append(tuple(c / m for c in combo))

    factor_names = [f"X{i+1}" for i in range(q)]
    coded = np.array(compositions, dtype=float)
    runs = []
    for row in coded:
        runs.append({factor_names[i]: float(row[i]) for i in range(q)})

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "metadata": {
            "design_type": f"Simplex-lattice {{{q},{m}}}",
            "q": q,
            "degree": degree,
            "run_count": len(compositions),
        },
    }


def simplex_centroid(q: int) -> dict:
    """Simplex-centroid design: centroids of all 2^q - 1 non-empty subsets."""
    if q < 2:
        raise ValueError("q (number of components) must be >= 2.")

    factor_names = [f"X{i+1}" for i in range(q)]
    points = []
    for size in range(1, q + 1):
        for subset in itertools.combinations(range(q), size):
            row = np.zeros(q, dtype=float)
            for idx in subset:
                row[idx] = 1.0 / size
            points.append(row)

    coded = np.array(points, dtype=float)
    runs = []
    for row in coded:
        runs.append({factor_names[i]: float(row[i]) for i in range(q)})

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "metadata": {
            "design_type": "Simplex-centroid",
            "q": q,
            "run_count": len(points),
            "n_subsets": 2 ** q - 1,
        },
    }


def extreme_vertices(q: int, lower: list[float], upper: list[float]) -> dict:
    """Extreme vertices design for a constrained mixture simplex.

    Enumerates vertices of the region:
        sum(x_i) = 1,  lower[i] <= x_i <= upper[i]

    Uses a McLean-Anderson style approach: generate all corners of the
    [lower, upper] box that satisfy sum=1, then check feasibility.
    Falls back to a discretization approach if direct enumeration fails.
    """
    if len(lower) != q or len(upper) != q:
        raise ValueError("lower and upper must each have length q.")
    for i in range(q):
        if lower[i] < 0 or upper[i] > 1 or lower[i] >= upper[i]:
            raise ValueError(
                f"Constraint violated for component {i+1}: "
                f"require 0 <= lower < upper <= 1."
            )
    if sum(lower) > 1.0 + 1e-9:
        raise ValueError("Sum of lower bounds exceeds 1 — no feasible region.")
    if sum(upper) < 1.0 - 1e-9:
        raise ValueError("Sum of upper bounds is less than 1 — no feasible region.")

    factor_names = [f"X{i+1}" for i in range(q)]

    # Strategy: iterate over all 2^q corners of the box
    # For each corner, try to project onto sum=1 by adjusting one variable
    # More robustly: use iterative constraint satisfaction

    vertices = []
    tol = 1e-9

    # Generate candidate vertices by fixing q-1 components to their bounds
    # and solving for the last one to make sum=1
    for mask in itertools.product(*[[0, 1]] * q):
        # mask[i]=0 -> lower[i], mask[i]=1 -> upper[i]
        for free_idx in range(q):
            point = np.array(
                [upper[i] if mask[i] == 1 else lower[i] for i in range(q)], dtype=float
            )
            total_others = float(np.sum(point)) - point[free_idx]
            free_val = 1.0 - total_others
            if lower[free_idx] - tol <= free_val <= upper[free_idx] + tol:
                point[free_idx] = np.clip(free_val, lower[free_idx], upper[free_idx])
                if abs(np.sum(point) - 1.0) < 1e-8:
                    # Check all bounds
                    feasible = all(
                        lower[j] - tol <= point[j] <= upper[j] + tol
                        for j in range(q)
                    )
                    if feasible:
                        point = np.clip(point, lower, upper)
                        # Dedup
                        is_dup = False
                        for v in vertices:
                            if np.max(np.abs(v - point)) < 1e-6:
                                is_dup = True
                                break
                        if not is_dup:
                            vertices.append(point.copy())

    if len(vertices) == 0:
        raise ValueError(
            "No extreme vertices found with the given constraints. "
            "Check that sum(lower) <= 1 <= sum(upper)."
        )

    coded = np.array(vertices, dtype=float)
    centroid = np.mean(coded, axis=0)

    runs = []
    for row in coded:
        runs.append({factor_names[i]: float(row[i]) for i in range(q)})

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "metadata": {
            "design_type": "Extreme vertices",
            "q": q,
            "run_count": len(vertices),
            "lower": lower,
            "upper": upper,
            "centroid": centroid.tolist(),
        },
    }


# ---------------------------------------------------------------------------
# FULL FACTORIAL (general)
# ---------------------------------------------------------------------------

def full_factorial_general(
    levels: list[int],
    factor_names: list[str],
) -> dict:
    """General full factorial: cartesian product of all level combinations.

    levels[i] = number of levels for factor i (uses 0-based index coding).
    """
    if len(levels) != len(factor_names):
        raise ValueError("levels and factor_names must have the same length.")
    for i, lv in enumerate(levels):
        if lv < 2:
            raise ValueError(f"Factor {factor_names[i]} must have at least 2 levels.")

    # Cartesian product of 0..levels[i]-1 for each factor
    all_levels = [list(range(lv)) for lv in levels]
    runs_list = list(itertools.product(*all_levels))

    coded = np.array(runs_list, dtype=float)
    runs = []
    for row in coded:
        runs.append({factor_names[i]: float(row[i]) for i in range(len(factor_names))})

    # Also compute normalized coded values in [-1, 1]
    coded_normalized = np.zeros_like(coded)
    for i, lv in enumerate(levels):
        if lv == 1:
            coded_normalized[:, i] = 0.0
        else:
            coded_normalized[:, i] = 2.0 * coded[:, i] / (lv - 1) - 1.0

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": coded,
        "coded_normalized": coded_normalized,
        "metadata": {
            "design_type": "Full factorial (general)",
            "levels": levels,
            "run_count": len(runs_list),
            "k": len(factor_names),
        },
    }


# ---------------------------------------------------------------------------
# ROBUST (Taguchi orthogonal arrays)
# ---------------------------------------------------------------------------

# Hard-coded standard Taguchi orthogonal arrays (integer coding, 1-based levels)

_TAGUCHI_ARRAYS: dict[str, dict] = {
    "L4": {
        "matrix": np.array([
            [1, 1, 1],
            [1, 2, 2],
            [2, 1, 2],
            [2, 2, 1],
        ], dtype=int),
        "runs": 4,
        "columns": 3,
        "levels": 2,
    },
    "L8": {
        "matrix": np.array([
            [1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 2, 2, 2, 2],
            [1, 2, 2, 1, 1, 2, 2],
            [1, 2, 2, 2, 2, 1, 1],
            [2, 1, 2, 1, 2, 1, 2],
            [2, 1, 2, 2, 1, 2, 1],
            [2, 2, 1, 1, 2, 2, 1],
            [2, 2, 1, 2, 1, 1, 2],
        ], dtype=int),
        "runs": 8,
        "columns": 7,
        "levels": 2,
    },
    "L9": {
        "matrix": np.array([
            [1, 1, 1, 1],
            [1, 2, 2, 2],
            [1, 3, 3, 3],
            [2, 1, 2, 3],
            [2, 2, 3, 1],
            [2, 3, 1, 2],
            [3, 1, 3, 2],
            [3, 2, 1, 3],
            [3, 3, 2, 1],
        ], dtype=int),
        "runs": 9,
        "columns": 4,
        "levels": 3,
    },
    "L12": {
        "matrix": np.array([
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
            [1, 1, 2, 2, 2, 1, 1, 1, 2, 2, 2],
            [1, 2, 1, 2, 2, 1, 2, 2, 1, 1, 2],
            [1, 2, 2, 1, 2, 2, 1, 2, 1, 2, 1],
            [1, 2, 2, 2, 1, 2, 2, 1, 2, 1, 1],
            [2, 1, 2, 2, 1, 1, 2, 2, 1, 2, 1],
            [2, 1, 2, 1, 2, 2, 2, 1, 1, 1, 2],  # corrected
            [2, 1, 1, 2, 2, 2, 1, 2, 2, 1, 1],
            [2, 2, 2, 1, 1, 1, 1, 2, 2, 1, 2],  # corrected
            [2, 2, 1, 2, 1, 2, 1, 1, 1, 2, 2],
            [2, 2, 1, 1, 2, 1, 2, 1, 2, 2, 1],
        ], dtype=int),
        "runs": 12,
        "columns": 11,
        "levels": 2,
    },
    "L16": {
        "matrix": None,  # generated below
        "runs": 16,
        "columns": 15,
        "levels": 2,
    },
    "L18": {
        "matrix": np.array([
            [1, 1, 1, 1, 1, 1, 1, 1],
            [1, 1, 2, 2, 2, 2, 2, 2],
            [1, 1, 3, 3, 3, 3, 3, 3],
            [1, 2, 1, 1, 2, 2, 3, 3],
            [1, 2, 2, 2, 3, 3, 1, 1],
            [1, 2, 3, 3, 1, 1, 2, 2],
            [1, 3, 1, 2, 1, 3, 2, 3],
            [1, 3, 2, 3, 2, 1, 3, 1],
            [1, 3, 3, 1, 3, 2, 1, 2],
            [2, 1, 1, 3, 3, 2, 2, 1],
            [2, 1, 2, 1, 1, 3, 3, 2],
            [2, 1, 3, 2, 2, 1, 1, 3],
            [2, 2, 1, 2, 3, 1, 3, 2],
            [2, 2, 2, 3, 1, 2, 1, 3],
            [2, 2, 3, 1, 2, 3, 2, 1],
            [2, 3, 1, 3, 2, 3, 1, 2],
            [2, 3, 2, 1, 3, 1, 2, 3],
            [2, 3, 3, 2, 1, 2, 3, 1],
        ], dtype=int),
        "runs": 18,
        "columns": 8,
        "levels": "mixed (1x2-level, 7x3-level)",
    },
    "L27": {
        "matrix": None,  # generated below
        "runs": 27,
        "columns": 13,
        "levels": 3,
    },
}


def _build_l16() -> np.ndarray:
    """Build L16 via Sylvester Hadamard (mapped 1/2 from ±1)."""
    H = _sylvester_hadamard(16)
    coded = H[:, 1:]  # (16, 15)
    return ((coded + 1) / 2 + 1).astype(int)  # map -1->1, +1->2


def _build_l27() -> np.ndarray:
    """Build L27 (3^13 OA) using the standard GF(3) construction."""
    # 13 columns OA(27,13,3,2) — use the standard structure
    # Basic factors: 3 columns x1,x2,x3 in GF(3)
    rows = list(itertools.product([0, 1, 2], repeat=3))  # 27 rows
    arr = np.array(rows, dtype=int)  # (27, 3)
    # Generate additional columns as interactions in GF(3)
    interaction_defs = [
        (0, 1),    # x1*x2
        (0, 1, 1), # x1*x2^2
        (0, 2),    # x1*x3
        (0, 2, 2), # x1*x3^2
        (1, 2),    # x2*x3
        (1, 2, 2), # x2*x3^2
        (0, 1, 2), # x1*x2*x3
    ]
    # Build full 13-column array
    cols = [arr[:, 0], arr[:, 1], arr[:, 2]]
    # Additional columns by modular arithmetic
    additional = [
        (arr[:, 0] + arr[:, 1]) % 3,
        (arr[:, 0] + 2 * arr[:, 1]) % 3,
        (arr[:, 0] + arr[:, 2]) % 3,
        (arr[:, 0] + 2 * arr[:, 2]) % 3,
        (arr[:, 1] + arr[:, 2]) % 3,
        (arr[:, 1] + 2 * arr[:, 2]) % 3,
        (arr[:, 0] + arr[:, 1] + arr[:, 2]) % 3,
        (arr[:, 0] + arr[:, 1] + 2 * arr[:, 2]) % 3,
        (arr[:, 0] + 2 * arr[:, 1] + arr[:, 2]) % 3,
        (arr[:, 0] + 2 * arr[:, 1] + 2 * arr[:, 2]) % 3,
    ]
    for col in additional:
        cols.append(col)
    result = np.column_stack(cols[:13]) + 1  # 1-based
    return result.astype(int)


# Populate L16 and L27
_TAGUCHI_ARRAYS["L16"]["matrix"] = _build_l16()
_TAGUCHI_ARRAYS["L27"]["matrix"] = _build_l27()


def taguchi(array_name: str) -> dict:
    """Return the standard Taguchi orthogonal array.

    Supported: 'L4', 'L8', 'L9', 'L12', 'L16', 'L18', 'L27'.
    """
    key = array_name.upper()
    if key not in _TAGUCHI_ARRAYS:
        raise ValueError(
            f"Unknown Taguchi array '{array_name}'. "
            f"Supported: {list(_TAGUCHI_ARRAYS.keys())}."
        )

    info = _TAGUCHI_ARRAYS[key]
    matrix = info["matrix"]
    n_runs, n_cols = matrix.shape
    factor_names = [f"C{i+1}" for i in range(n_cols)]

    runs = []
    for row in matrix:
        runs.append({factor_names[i]: int(row[i]) for i in range(n_cols)})

    return {
        "runs": runs,
        "factor_names": factor_names,
        "coded": matrix.astype(float),
        "metadata": {
            "design_type": f"Taguchi {key}",
            "array_name": key,
            "run_count": n_runs,
            "columns": n_cols,
            "levels": info["levels"],
        },
    }


# ---------------------------------------------------------------------------
# Analysis of a completed (2-level) factorial experiment
# ---------------------------------------------------------------------------

def analyze_factorial(runs: list[dict], responses: list[float],
                      factor_names: list[str],
                      include_interactions: bool = True) -> dict:
    """Analyze a completed factorial experiment.

    Fits the linear effects model (mains + optional 2-way interactions) to the
    coded design by OLS and returns everything a practitioner expects from a
    factorial analysis: per-term effects (2x the coded coefficient),
    %contribution, Lenth's pseudo-standard-error margin for unreplicated
    designs, half-normal plot coordinates, main-effects and interaction plot
    data, and the regression fit (R^2, per-term p-values when residual df
    exist, residuals/fitted for diagnostics).

    Parameters
    ----------
    runs : list of dict
        One dict per run mapping factor name -> coded level (as produced by
        the design generators; levels are recoded to [-1, 1] if needed).
    responses : list of float
        Measured response per run (same order as runs).
    factor_names : list of str
        Factors to include.
    include_interactions : bool
        Include all 2-way interactions (default True).
    """
    from itertools import combinations
    from reliability.Regression import linear_regression
    from scipy import stats as _ss

    y = np.asarray(responses, dtype=float)
    n = len(runs)
    if len(y) != n:
        raise ValueError('responses must have one value per run.')
    if n < 3:
        raise ValueError('At least 3 runs are required for analysis.')
    if np.any(~np.isfinite(y)):
        raise ValueError('All responses must be finite.')
    if not factor_names or len(set(factor_names)) != len(factor_names):
        raise ValueError('factor_names must be non-empty and unique.')

    # This is specifically a two-level factorial analysis.  Do not silently
    # collapse a three-level factor to endpoints: that changes the design
    # class and the fitted model.
    cols = {}
    factor_levels = {}
    for f in factor_names:
        if any(f not in run for run in runs):
            raise ValueError(f"Factor '{f}' is missing from one or more runs.")
        v = np.asarray([float(r[f]) for r in runs], dtype=float)
        if np.any(~np.isfinite(v)):
            raise ValueError(f"Factor '{f}' contains a non-finite level.")
        levels = np.unique(v)
        if len(levels) != 2:
            raise ValueError(
                f"Two-level factorial analysis requires exactly 2 levels for "
                f"factor '{f}'; found {len(levels)}. Use a general categorical "
                "or response-surface analysis for multi-level factors.")
        lo, hi = float(levels[0]), float(levels[1])
        cols[f] = 2.0 * (v - lo) / (hi - lo) - 1.0
        factor_levels[f] = {"low": lo, "high": hi}

    terms = [(f,) for f in factor_names]
    if include_interactions and len(factor_names) >= 2:
        terms += [tuple(c) for c in combinations(factor_names, 2)]

    X = np.column_stack([np.prod([cols[f] for f in t], axis=0) for t in terms])
    names = [':'.join(t) for t in terms]

    # Drop aliased (duplicate) interaction columns — in fractional designs an
    # interaction can be identical (or opposite) to a main-effect column.
    keep, seen = [], []
    for j in range(X.shape[1]):
        c = X[:, j]
        aliased = any(np.allclose(c, s) or np.allclose(c, -s) for s in seen)
        if not aliased:
            keep.append(j)
            seen.append(c)
    dropped = [names[j] for j in range(X.shape[1]) if j not in keep]
    X = X[:, keep]
    names = [names[j] for j in keep]
    treatment_count = len(names)
    treatment_names = list(names)

    # Generated designs may carry a nuisance block assignment. Include block
    # fixed effects in the fitted model so treatment inference is adjusted for
    # block shifts. The first block is the reference level.
    block_values = [run.get('Block') for run in runs]
    block_levels = (sorted({value for value in block_values
                            if value is not None})
                    if all(value is not None for value in block_values) else [])
    block_names = []
    for level in block_levels[1:]:
        column = np.asarray([float(value == level) for value in block_values])
        block_name = f'Block[{level}]'
        if any(np.allclose(column, seen_col) or np.allclose(column, -seen_col)
               for seen_col in seen):
            dropped.append(block_name)
            continue
        X = np.column_stack([X, column])
        names.append(block_name)
        block_names.append(block_name)
        seen.append(column)

    full_matrix = np.column_stack([np.ones(n), X])
    if np.linalg.matrix_rank(full_matrix) < full_matrix.shape[1]:
        raise ValueError(
            'Treatment and block terms are linearly dependent; revise the '
            'block assignment or reduce the treatment model.')

    saturated = (n - 1 - X.shape[1]) <= 0
    if saturated and X.shape[1] >= n:
        raise ValueError('More model terms than runs — reduce the model '
                         '(e.g. exclude interactions).')

    if saturated:
        # Exactly saturated (0 residual df): OLS interpolates the data, so
        # solve directly — linear_regression would refuse (no df for its
        # inference), and significance falls to Lenth's method below.
        Xd = np.column_stack([np.ones(n), X])
        beta_all, *_ = np.linalg.lstsq(Xd, y, rcond=None)
        fitted_sat = Xd @ beta_all
        reg = {
            'coefficients': beta_all[1:].tolist(),
            'intercept': float(beta_all[0]),
            'p_values': None,
            'r2': 1.0,
            'adj_r2': None,
            'residuals': (y - fitted_sat).tolist(),
            'fitted': fitted_sat.tolist(),
        }
    else:
        reg = linear_regression(X, y, feature_names=names)

    all_coefs = np.asarray(reg['coefficients'], dtype=float)
    coefs = all_coefs[:treatment_count]
    effects = 2.0 * coefs  # classical effect = 2*beta for +/-1 coding
    # Drop-one partial sums of squares remain valid when nuisance blocks make
    # the treatment columns non-orthogonal.
    full_sse = float(np.sum((y - np.asarray(reg['fitted'], dtype=float)) ** 2))
    ss_terms = []
    for column_index in range(treatment_count):
        reduced = np.delete(full_matrix, column_index + 1, axis=1)
        reduced_beta, *_ = np.linalg.lstsq(reduced, y, rcond=None)
        reduced_sse = float(np.sum((y - reduced @ reduced_beta) ** 2))
        ss_terms.append(max(0.0, reduced_sse - full_sse))
    ss_terms = np.asarray(ss_terms, dtype=float)
    ss_total = float(np.sum((y - np.mean(y)) ** 2))
    pct = 100.0 * ss_terms / ss_total if ss_total > 0 else np.zeros_like(ss_terms)

    # Lenth's method for unreplicated designs: PSE and the margin of error.
    abs_eff = np.abs(effects)
    s0 = 1.5 * float(np.median(abs_eff)) if len(abs_eff) else 0.0
    trimmed = abs_eff[abs_eff <= 2.5 * s0] if s0 > 0 else abs_eff
    pse = 1.5 * float(np.median(trimmed)) if len(trimmed) else None
    lenth = None
    if pse and pse > 0:
        d = max(len(effects) / 3.0, 1.0)
        me = float(_ss.t.ppf(0.975, d) * pse)
        lenth = {'pse': pse, 'margin_of_error': me}

    # Half-normal plot coordinates: ordered |effect| vs half-normal quantiles.
    order = np.argsort(abs_eff)
    m = len(abs_eff)
    hn_q = _ss.norm.ppf(0.5 + 0.5 * (np.arange(1, m + 1) - 0.5) / m)
    half_normal = {
        'abs_effect': [float(abs_eff[i]) for i in order],
        'quantile': [float(q) for q in hn_q],
        'term': [treatment_names[i] for i in order],
    }

    # Main-effects plot data: mean response at each coded level.
    main_effects = {}
    for f in factor_names:
        levels = sorted(set(np.round(cols[f], 10)))
        main_effects[f] = {
            'levels': [float(l) for l in levels],
            'means': [float(np.mean(y[np.isclose(cols[f], l)])) for l in levels],
        }

    # Interaction plot data: mean response per (level_i, level_j) cell.
    interactions = []
    if include_interactions:
        for f1, f2 in combinations(factor_names, 2):
            l1 = sorted(set(np.round(cols[f1], 10)))
            l2 = sorted(set(np.round(cols[f2], 10)))
            series = []
            for b in l2:
                means = []
                for a in l1:
                    mask = np.isclose(cols[f1], a) & np.isclose(cols[f2], b)
                    means.append(float(np.mean(y[mask])) if mask.any() else None)
                series.append({'level': float(b), 'means': means})
            interactions.append({'factor_x': f1, 'factor_trace': f2,
                                 'x_levels': [float(a) for a in l1],
                                 'series': series})

    effect_rows = []
    for i, name in enumerate(treatment_names):
        effect_rows.append({
            'term': name,
            'effect': float(effects[i]),
            'coefficient': float(coefs[i]),
            'ss': float(ss_terms[i]),
            'pct_contribution': float(pct[i]),
            'p_value': (None if saturated else
                        (float(reg['p_values'][i]) if reg.get('p_values') is not None else None)),
            'significant_lenth': (bool(abs_eff[i] > lenth['margin_of_error'])
                                  if lenth else None),
        })
    effect_rows.sort(key=lambda r: abs(r['effect']), reverse=True)
    block_effects = []
    for offset, name in enumerate(block_names, start=treatment_count):
        block_effects.append({
            'term': name,
            'coefficient': float(all_coefs[offset]),
            'p_value': (None if saturated else
                        (float(reg['p_values'][offset])
                         if reg.get('p_values') is not None else None)),
        })

    return {
        'effects': effect_rows,
        'aliased_terms_dropped': dropped,
        'r2': reg['r2'],
        'adj_r2': reg['adj_r2'],
        'saturated': saturated,
        'lenth': lenth,
        'half_normal': half_normal,
        'main_effects': main_effects,
        'interactions': interactions,
        'residuals': reg['residuals'],
        'fitted': reg['fitted'],
        'n_runs': n,
        'design_class': 'two_level_factorial',
        'factor_levels': factor_levels,
        'block_effects': block_effects,
        'block_adjusted': len(block_levels) > 1,
    }


# ---------------------------------------------------------------------------
# Validated design contract, planning diagnostics and model-aware analysis
# ---------------------------------------------------------------------------

_DESIGN_CLASS_BY_KEY = {
    'full_factorial_2level': 'screening',
    'fractional_factorial_2level': 'screening',
    'plackett_burman': 'screening',
    'box_behnken': 'response_surface',
    'central_composite': 'response_surface',
    'simplex_lattice': 'mixture',
    'simplex_centroid': 'mixture',
    'extreme_vertices': 'mixture',
    'full_factorial_general': 'general_factorial',
    'taguchi': 'robust_array',
}


def design_class_for_key(design_key: str) -> str:
    """Return the analysis class associated with a generator key."""
    key = str(design_key).strip().lower().replace('-', '_').replace(' ', '_')
    if key not in _DESIGN_CLASS_BY_KEY:
        raise ValueError(f"Unknown DOE design key '{design_key}'.")
    return _DESIGN_CLASS_BY_KEY[key]


def _design_model_matrix(
    coded: np.ndarray,
    factor_names: list[str],
    design_class: str,
    model: str = 'auto',
) -> tuple[np.ndarray, list[str], str]:
    """Construct the planned analysis matrix for a DOE design class."""
    matrix = np.asarray(coded, dtype=float)
    if matrix.ndim != 2 or matrix.shape[1] != len(factor_names):
        raise ValueError('coded matrix columns must match factor_names.')
    if np.any(~np.isfinite(matrix)):
        raise ValueError('coded design values must all be finite.')
    n, k = matrix.shape
    requested = str(model).lower()

    # Mixture models must remain in the Scheffé basis even when callers use
    # the convenient ``quadratic`` label (for example design diagnostics).
    # Testing ``requested == 'quadratic'`` first incorrectly added an
    # intercept and pure-square terms, which are aliased under sum(x_i)=1 and
    # falsely reported valid simplex designs as rank deficient.
    if design_class == 'mixture':
        # Scheffé models omit the intercept because component proportions sum
        # to one. Auto prefers quadratic and callers may fall back to linear
        # when the constrained design cannot identify all blend terms.
        columns = [matrix[:, i] for i in range(k)]
        names = list(factor_names)
        if requested not in ('linear', 'scheffe_linear'):
            for i, j in itertools.combinations(range(k), 2):
                columns.append(matrix[:, i] * matrix[:, j])
                names.append(f'{factor_names[i]}:{factor_names[j]}')
            selected = 'scheffe_quadratic'
        else:
            selected = 'scheffe_linear'
    elif design_class == 'response_surface' or requested == 'quadratic':
        columns = [np.ones(n)]
        names = ['Intercept']
        columns.extend(matrix[:, i] for i in range(k))
        names.extend(factor_names)
        columns.extend(matrix[:, i] ** 2 for i in range(k))
        names.extend(f'{name}^2' for name in factor_names)
        for i, j in itertools.combinations(range(k), 2):
            columns.append(matrix[:, i] * matrix[:, j])
            names.append(f'{factor_names[i]}:{factor_names[j]}')
        selected = 'full_quadratic'
    elif requested in ('factorial_2fi', 'two_factor_interactions'):
        columns = [np.ones(n)]
        names = ['Intercept']
        columns.extend(matrix[:, i] for i in range(k))
        names.extend(factor_names)
        for i, j in itertools.combinations(range(k), 2):
            columns.append(matrix[:, i] * matrix[:, j])
            names.append(f'{factor_names[i]}:{factor_names[j]}')
        selected = 'factorial_main_plus_2fi'
    elif design_class in ('general_factorial', 'robust_array'):
        columns = [np.ones(n)]
        names = ['Intercept']
        for factor_index, factor_name in enumerate(factor_names):
            levels = np.unique(matrix[:, factor_index])
            for level in levels[1:]:
                columns.append((matrix[:, factor_index] == level).astype(float))
                names.append(f'{factor_name}[{float(level):g}]')
        selected = 'categorical_main_effects'
    else:
        columns = [np.ones(n)]
        names = ['Intercept']
        columns.extend(matrix[:, i] for i in range(k))
        names.extend(factor_names)
        selected = 'linear_main_effects'
    return np.column_stack(columns), names, selected


def _alias_relations(X: np.ndarray, names: list[str], rank: int) -> list[dict]:
    """Readable null-space relations for a rank-deficient model matrix."""
    if rank == X.shape[1]:
        return []
    nullity = int(X.shape[1] - rank)
    if X.shape[1] > 200:
        return [{
            'status': 'summary_only', 'nullity': nullity,
            'meaning': (
                'Model has more than 200 columns; individual null-space '
                'relations are omitted to keep the result bounded.'),
        }]
    _, _, vt = np.linalg.svd(X, full_matrices=True)
    relations = []
    for vector in vt[rank:rank + 20]:
        scale = float(np.max(np.abs(vector)))
        if scale <= 0:
            continue
        normalized = vector / scale
        terms = [
            {'term': names[i], 'coefficient': float(value)}
            for i, value in enumerate(normalized) if abs(value) >= 1e-7
        ]
        relations.append({'relation': terms, 'meaning': 'linear combination equals zero'})
    if nullity > len(relations):
        relations.append({
            'status': 'truncated', 'nullity': nullity,
            'relations_returned': len(relations),
        })
    return relations


def design_diagnostics(
    coded: np.ndarray,
    factor_names: list[str],
    design_class: str,
    model: str = 'auto',
    blocks: Optional[list[int]] = None,
) -> dict:
    """Rank, conditioning, replication and block-confounding diagnostics."""
    X, names, selected_model = _design_model_matrix(
        coded, factor_names, design_class, model=model)
    if (design_class == 'mixture' and str(model).lower() == 'auto'
            and np.linalg.matrix_rank(X) < X.shape[1]):
        X, names, selected_model = _design_model_matrix(
            coded, factor_names, design_class, model='linear')
    rank = int(np.linalg.matrix_rank(X))
    singular = np.linalg.svd(X, compute_uv=False)
    positive = singular[singular > np.max(singular) * np.finfo(float).eps]
    condition = (float(np.max(positive) / np.min(positive))
                 if len(positive) and rank == X.shape[1] else float('inf'))
    unique_points = int(len(np.unique(np.asarray(coded, dtype=float), axis=0)))
    result = {
        'model': selected_model,
        'model_terms': names,
        'n_runs': int(X.shape[0]),
        'n_parameters': int(X.shape[1]),
        'rank': rank,
        'full_rank': rank == X.shape[1],
        'residual_df': int(X.shape[0] - rank),
        'condition_number': condition if np.isfinite(condition) else None,
        'n_unique_design_points': unique_points,
        'replicated_runs': int(X.shape[0] - unique_points),
        'pure_error_df_available': int(X.shape[0] - unique_points),
        'alias_relations': _alias_relations(X, names, rank),
        'estimable': rank == X.shape[1],
    }

    if blocks is not None:
        block_values = np.asarray(blocks)
        if len(block_values) != X.shape[0]:
            raise ValueError('blocks must contain one assignment per run.')
        levels = list(dict.fromkeys(block_values.tolist()))
        block_columns = [
            (block_values == level).astype(float) for level in levels[1:]]
        if block_columns:
            augmented = np.column_stack([X, *block_columns])
            augmented_rank = int(np.linalg.matrix_rank(augmented))
        else:
            augmented = X
            augmented_rank = rank
        expected_rank = rank + len(block_columns)
        result['blocking'] = {
            'n_blocks': len(levels),
            'block_sizes': {str(level): int(np.sum(block_values == level))
                            for level in levels},
            'augmented_rank': augmented_rank,
            'expected_augmented_rank': expected_rank,
            'block_effects_estimable': augmented_rank == expected_rank,
            'treatment_rank_preserved': int(np.linalg.matrix_rank(X)) == rank,
            'confounded_with_treatment_model': augmented_rank < expected_rank,
            'alias_relations': _alias_relations(
                augmented, names + [f'Block[{level}]' for level in levels[1:]],
                augmented_rank),
        }
    else:
        result['blocking'] = {
            'n_blocks': 1, 'block_sizes': {'1': int(X.shape[0])},
            'block_effects_estimable': True,
            'confounded_with_treatment_model': False,
        }
    return result


def assign_balanced_blocks(
    coded: np.ndarray,
    n_blocks: int,
    seed: Optional[int] = None,
) -> tuple[list[int], dict]:
    """Assign near-balanced blocks while minimizing coded-factor imbalance.

    This is a generic nuisance-block allocator, not a claim of a classical
    defining-contrast block construction. Rank/confounding is checked after
    assignment and returned through :func:`design_diagnostics`.
    """
    matrix = np.asarray(coded, dtype=float)
    n_runs = len(matrix)
    n_blocks = int(n_blocks)
    if n_blocks < 1 or n_blocks > n_runs:
        raise ValueError('n_blocks must be between 1 and the number of runs.')
    if n_blocks == 1:
        return [1] * n_runs, {
            'method': 'single_block', 'seed': seed, 'n_blocks': 1,
            'block_sizes': {'1': n_runs},
        }
    capacities = np.full(n_blocks, n_runs // n_blocks, dtype=int)
    capacities[:n_runs % n_blocks] += 1
    rng = np.random.default_rng(seed)
    order = rng.permutation(n_runs)
    assignments = np.zeros(n_runs, dtype=int)
    sizes = np.zeros(n_blocks, dtype=int)
    sums = np.zeros((n_blocks, matrix.shape[1]), dtype=float)
    scale = np.std(matrix, axis=0, ddof=0)
    scale[scale <= 1e-12] = 1.0
    standardized = (matrix - np.mean(matrix, axis=0)) / scale
    for run_index in order:
        candidates = np.flatnonzero(sizes < capacities)
        scores = []
        for block_index in candidates:
            new_size = sizes[block_index] + 1
            imbalance = np.sum(
                ((sums[block_index] + standardized[run_index]) / new_size) ** 2)
            fill_penalty = sizes[block_index] / capacities[block_index]
            scores.append(float(imbalance + 1e-6 * fill_penalty))
        best_score = min(scores)
        tied = candidates[np.isclose(scores, best_score, rtol=1e-10, atol=1e-12)]
        selected = int(rng.choice(tied))
        assignments[run_index] = selected + 1
        sizes[selected] += 1
        sums[selected] += standardized[run_index]
    return assignments.tolist(), {
        'method': 'greedy_coded_balance', 'seed': seed,
        'n_blocks': n_blocks,
        'block_sizes': {str(i + 1): int(size) for i, size in enumerate(sizes)},
        'maximum_standardized_factor_mean_imbalance': float(np.max(np.abs(
            sums / np.maximum(sizes[:, None], 1)))),
        'warning': (
            'Generic balanced allocation; inspect block-confounding diagnostics. '
            'It is not a defining-contrast construction for a regular fraction.'),
    }


def randomized_run_order(
    blocks: list[int], randomize: bool, seed: Optional[int] = None,
) -> tuple[list[int], dict]:
    """Return standard-order indices, randomized within each nuisance block."""
    block_values = np.asarray(blocks, dtype=int)
    rng = np.random.default_rng(seed)
    order = []
    for block in sorted(np.unique(block_values)):
        indices = np.flatnonzero(block_values == block)
        if randomize:
            indices = rng.permutation(indices)
        order.extend(int(index) for index in indices)
    return order, {
        'enabled': bool(randomize), 'seed': seed,
        'scope': 'within_block' if len(np.unique(block_values)) > 1 else 'all_runs',
        'grouped_by_block': len(np.unique(block_values)) > 1,
        'standard_order_indices': order,
    }


def design_power(
    coded: np.ndarray,
    factor_names: list[str],
    design_class: str,
    standardized_coefficient: float = 0.5,
    alpha: float = 0.05,
    target_power: float = 0.8,
    model: str = 'auto',
    max_replicates: int = 50,
) -> dict:
    """Noncentral-t power for planned coded-model coefficients.

    ``standardized_coefficient`` is the absolute model coefficient divided by
    residual sigma. It is not a standardized two-level mean difference (which
    equals twice the coded coefficient).
    """
    effect = float(standardized_coefficient)
    if not np.isfinite(effect) or effect <= 0:
        raise ValueError('standardized_coefficient must be finite and > 0.')
    if not 0 < alpha < 1 or not 0 < target_power < 1:
        raise ValueError('alpha and target_power must be between 0 and 1.')
    X, names, selected_model = _design_model_matrix(
        coded, factor_names, design_class, model=model)
    if (design_class == 'mixture' and str(model).lower() == 'auto'
            and np.linalg.matrix_rank(X) < X.shape[1]):
        X, names, selected_model = _design_model_matrix(
            coded, factor_names, design_class, model='linear')
    base_rank = int(np.linalg.matrix_rank(X))
    estimable = base_rank == X.shape[1]
    focus = [index for index, name in enumerate(names) if name != 'Intercept']

    def at_replicates(replicates):
        repeated = np.tile(X, (replicates, 1))
        rank = int(np.linalg.matrix_rank(repeated))
        df = repeated.shape[0] - rank
        if rank < repeated.shape[1] or df <= 0:
            return None
        inverse = np.linalg.inv(repeated.T @ repeated)
        critical = float(stats.t.ppf(1.0 - alpha / 2.0, df))
        rows = []
        for index in focus:
            standard_error_over_sigma = math.sqrt(float(inverse[index, index]))
            noncentrality = effect / standard_error_over_sigma
            power = float(
                stats.nct.cdf(-critical, df, noncentrality)
                + stats.nct.sf(critical, df, noncentrality))
            rows.append({
                'term': names[index], 'power': power,
                'noncentrality': noncentrality,
            })
        return {'replicates': replicates, 'residual_df': int(df), 'terms': rows,
                'minimum_term_power': min(row['power'] for row in rows) if rows else None}

    current = at_replicates(1) if estimable else None
    required = None
    if estimable:
        for replicates in range(1, int(max_replicates) + 1):
            candidate = at_replicates(replicates)
            if (candidate is not None and candidate['minimum_term_power'] is not None
                    and candidate['minimum_term_power'] >= target_power):
                required = candidate
                break
    return {
        'method': 'noncentral_t_coded_coefficient',
        'model': selected_model,
        'standardized_coefficient': effect,
        'alpha': alpha, 'target_power': target_power,
        'design_estimable': estimable,
        'current_design': current,
        'minimum_replicates_for_target': (
            required['replicates'] if required is not None else None),
        'target_design': required,
        'max_replicates_searched': int(max_replicates),
        'assumptions': [
            'independent homoscedastic normal errors',
            'specified coded-model coefficient divided by residual sigma',
            'replicates repeat the complete design',
            'no multiplicity adjustment across terms',
        ],
    }


def validated_design_contract(
    coded: np.ndarray,
    factor_names: list[str],
    design_key: str,
    metadata: Optional[dict] = None,
    blocks: Optional[list[int]] = None,
    power_effect: Optional[float] = None,
    alpha: float = 0.05,
    target_power: float = 0.8,
) -> dict:
    """Common versioned metadata contract for every DOE generator."""
    design_class = design_class_for_key(design_key)
    default_model = (
        'quadratic' if design_class == 'response_surface'
        else 'linear' if design_key == 'extreme_vertices'
        else 'auto' if design_class == 'mixture'
        else 'linear' if design_key == 'plackett_burman'
        else 'factorial_2fi' if design_class == 'screening'
        else 'linear')
    diagnostics = design_diagnostics(
        coded, factor_names, design_class, model=default_model, blocks=blocks)
    contract = dict(metadata or {})
    contract.update({
        'contract_version': 2,
        'generator_key': design_key,
        'design_class': design_class,
        'factor_names': list(factor_names),
        'run_count': int(len(coded)),
        'analysis_model': diagnostics['model'],
        'design_diagnostics': diagnostics,
        'coding': (
            'mixture_proportions_sum_to_one' if design_class == 'mixture'
            else 'coded_numeric'),
    })
    if power_effect is not None:
        power_model = ('quadratic' if design_class == 'response_surface'
                       else 'auto' if design_class == 'mixture' else 'linear')
        contract['power_analysis'] = design_power(
            coded, factor_names, design_class,
            standardized_coefficient=power_effect, alpha=alpha,
            target_power=target_power, model=power_model)
    else:
        contract['power_analysis'] = None
    return contract


def _lack_of_fit(
    coded: np.ndarray, y: np.ndarray, fitted: np.ndarray, model_rank: int,
    block_labels: Optional[list[int]] = None,
) -> dict:
    """Partition residual error into lack-of-fit and pure error."""
    matrix = np.asarray(coded, dtype=float)
    if block_labels is not None and len(block_labels) != len(matrix):
        raise ValueError('block_labels must contain one value per run.')
    keys = [
        tuple(np.round(row, 12)) + (
            (block_labels[index],) if block_labels is not None else ())
        for index, row in enumerate(matrix)
    ]
    groups = {}
    for index, key in enumerate(keys):
        groups.setdefault(key, []).append(index)
    pure_error_ss = 0.0
    for indices in groups.values():
        values = y[indices]
        pure_error_ss += float(np.sum((values - np.mean(values)) ** 2))
    pure_error_df = int(len(y) - len(groups))
    residual_ss = float(np.sum((y - fitted) ** 2))
    lack_ss = max(0.0, residual_ss - pure_error_ss)
    lack_df = int(len(groups) - model_rank)
    if pure_error_df > 0 and lack_df > 0 and pure_error_ss > 0:
        statistic = (lack_ss / lack_df) / (pure_error_ss / pure_error_df)
        p_value = float(stats.f.sf(statistic, lack_df, pure_error_df))
        status = 'ok'
    elif pure_error_df == 0:
        statistic = p_value = None
        status = 'unavailable_no_replicated_design_points'
    elif lack_df <= 0:
        statistic = p_value = None
        status = 'unavailable_no_lack_of_fit_degrees_of_freedom'
    else:
        statistic = 0.0 if lack_ss == 0 else None
        p_value = 1.0 if lack_ss == 0 else None
        status = 'zero_pure_error' if lack_ss > 0 else 'exact_replicates'
    return {
        'status': status, 'F': statistic, 'p_value': p_value,
        'lack_of_fit_ss': lack_ss, 'lack_of_fit_df': lack_df,
        'pure_error_ss': pure_error_ss, 'pure_error_df': pure_error_df,
        'residual_ss': residual_ss, 'n_unique_design_points': len(groups),
        'interpretation': (
            'A small p-value indicates the selected polynomial/blending model '
            'does not explain variation among replicated design points.'),
    }


def _fit_doe_linear_model(X: np.ndarray, names: list[str], y: np.ndarray) -> dict:
    rank = int(np.linalg.matrix_rank(X))
    if rank < X.shape[1]:
        raise ValueError(
            f"Selected DOE model is rank deficient ({rank}/{X.shape[1]}). "
            'Use a lower-order model or augment the design.')
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    fitted = X @ beta
    residuals = y - fitted
    residual_ss = float(residuals @ residuals)
    total_ss = float(np.sum((y - np.mean(y)) ** 2))
    residual_df = int(len(y) - rank)
    if residual_df > 0:
        mse = residual_ss / residual_df
        covariance = mse * np.linalg.inv(X.T @ X)
        se = np.sqrt(np.clip(np.diag(covariance), 0, None))
        t_value = np.divide(beta, se, out=np.full_like(beta, np.nan), where=se > 0)
        p_value = 2.0 * stats.t.sf(np.abs(t_value), residual_df)
    else:
        mse = None
        se = np.full(len(beta), np.nan)
        t_value = np.full(len(beta), np.nan)
        p_value = np.full(len(beta), np.nan)
    r2 = 1.0 - residual_ss / total_ss if total_ss > 0 else 1.0
    adjusted = (1.0 - (1.0 - r2) * (len(y) - 1) / residual_df
                if residual_df > 0 else None)
    terms = [{
        'term': name, 'coefficient': float(beta[index]),
        'standard_error': (float(se[index]) if np.isfinite(se[index]) else None),
        't_value': (float(t_value[index]) if np.isfinite(t_value[index]) else None),
        'p_value': (float(p_value[index]) if np.isfinite(p_value[index]) else None),
    } for index, name in enumerate(names)]
    return {
        'coefficients': beta, 'terms': terms, 'fitted': fitted,
        'residuals': residuals, 'rank': rank, 'residual_df': residual_df,
        'mse': mse, 'r2': float(r2), 'adj_r2': adjusted,
    }


def _append_block_effects(
    X: np.ndarray, names: list[str], runs: list[dict],
) -> tuple[np.ndarray, list[str], int, list[int]]:
    """Append reference-coded nuisance blocks to a treatment model matrix."""
    block_labels = [int(run.get('Block', 1)) for run in runs]
    levels = sorted(set(block_labels))
    treatment_count = X.shape[1]
    columns = [X]
    extended_names = list(names)
    for level in levels[1:]:
        columns.append(np.asarray(block_labels) == level)
        extended_names.append(f'Block[{level}]')
    return np.column_stack(columns), extended_names, treatment_count, block_labels


def analyze_response_surface(
    runs: list[dict], responses: list[float], factor_names: list[str],
) -> dict:
    """Fit and qualify a full second-order response-surface model."""
    coded = np.asarray(
        [[float(run[name]) for name in factor_names] for run in runs], dtype=float)
    y = np.asarray(responses, dtype=float)
    X, names, model = _design_model_matrix(
        coded, factor_names, 'response_surface', model='quadratic')
    X, names, treatment_count, block_labels = _append_block_effects(
        X, names, runs)
    fit = _fit_doe_linear_model(X, names, y)
    k = len(factor_names)
    treatment_beta = fit['coefficients'][:treatment_count]
    linear = treatment_beta[1:1 + k]
    quadratic = np.zeros((k, k), dtype=float)
    cursor = 1 + k
    for index in range(k):
        quadratic[index, index] = treatment_beta[cursor]
        cursor += 1
    for i, j in itertools.combinations(range(k), 2):
        quadratic[i, j] = quadratic[j, i] = treatment_beta[cursor] / 2.0
        cursor += 1
    eigenvalues = np.linalg.eigvalsh(quadratic)
    if np.linalg.matrix_rank(quadratic) == k:
        stationary = -0.5 * np.linalg.solve(quadratic, linear)
        stationary_prediction = float(
            treatment_beta[0] + linear @ stationary
            + stationary @ quadratic @ stationary)
        ranges = [(float(np.min(coded[:, i])), float(np.max(coded[:, i])))
                  for i in range(k)]
        inside = all(lo <= value <= hi for value, (lo, hi) in zip(stationary, ranges))
        if np.all(eigenvalues > 0):
            classification = 'minimum'
        elif np.all(eigenvalues < 0):
            classification = 'maximum'
        else:
            classification = 'saddle'
        stationary_result = {
            'status': 'ok', 'coordinates': stationary.tolist(),
            'predicted_response': stationary_prediction,
            'classification': classification,
            'quadratic_eigenvalues': eigenvalues.tolist(),
            'inside_tested_factor_ranges': bool(inside),
            'tested_ranges': [{'factor': factor_names[i], 'low': ranges[i][0],
                               'high': ranges[i][1]} for i in range(k)],
        }
    else:
        stationary_result = {
            'status': 'ridge_or_singular_quadratic', 'coordinates': None,
            'quadratic_eigenvalues': eigenvalues.tolist(),
        }
    diagnostics = design_diagnostics(
        coded, factor_names, 'response_surface', model='quadratic',
        blocks=[int(run.get('Block', 1)) for run in runs])
    return {
        'analysis_type': 'response_surface', 'model': model,
        'terms': fit['terms'], 'effects': [],
        'r2': fit['r2'], 'adj_r2': fit['adj_r2'],
        'residuals': fit['residuals'].tolist(),
        'fitted': fit['fitted'].tolist(), 'n_runs': len(y),
        'residual_df': fit['residual_df'],
        'lack_of_fit': _lack_of_fit(
            coded, y, fit['fitted'], fit['rank'], block_labels),
        'stationary_point': stationary_result,
        'design_diagnostics': diagnostics,
        'aliased_terms_dropped': [], 'saturated': fit['residual_df'] == 0,
        'lenth': None, 'half_normal': {'abs_effect': [], 'quantile': [], 'term': []},
        'main_effects': {}, 'interactions': [],
    }


def _mixture_optimum(
    beta: np.ndarray, factor_names: list[str], model: str,
    lower: list[float], upper: list[float], starts: np.ndarray,
    maximize: bool,
) -> dict:
    q = len(factor_names)

    def row(point):
        values = list(point)
        if model == 'scheffe_quadratic':
            values.extend(point[i] * point[j]
                          for i, j in itertools.combinations(range(q), 2))
        return np.asarray(values, dtype=float)

    def objective(point):
        prediction = float(row(point) @ beta)
        return -prediction if maximize else prediction

    candidates = []
    constraints = {'type': 'eq', 'fun': lambda point: float(np.sum(point) - 1.0)}
    for start in starts:
        result = optimize.minimize(
            objective, start, method='SLSQP', bounds=list(zip(lower, upper)),
            constraints=constraints, options={'maxiter': 2000, 'ftol': 1e-12})
        if result.success and np.all(np.isfinite(result.x)):
            candidates.append(result)
    if not candidates:
        return {'status': 'optimization_failed', 'coordinates': None}
    best = min(candidates, key=lambda result: result.fun)
    prediction = -float(best.fun) if maximize else float(best.fun)
    return {
        'status': 'ok', 'coordinates': best.x.tolist(),
        'composition': {name: float(best.x[i]) for i, name in enumerate(factor_names)},
        'predicted_response': prediction,
    }


def analyze_mixture(
    runs: list[dict], responses: list[float], factor_names: list[str],
    model: str = 'auto', constraints: Optional[dict] = None,
) -> dict:
    """Fit a Scheffé mixture model and optimize within supplied bounds."""
    coded = np.asarray(
        [[float(run[name]) for name in factor_names] for run in runs], dtype=float)
    if np.any(coded < -1e-10) or not np.allclose(np.sum(coded, axis=1), 1.0, atol=1e-8):
        raise ValueError('Mixture rows must be non-negative proportions summing to 1.')
    y = np.asarray(responses, dtype=float)
    requested = str(model).lower()
    X, names, selected = _design_model_matrix(
        coded, factor_names, 'mixture', model=requested)
    fallback_warning = None
    if np.linalg.matrix_rank(X) < X.shape[1] and requested == 'auto':
        X, names, selected = _design_model_matrix(
            coded, factor_names, 'mixture', model='linear')
        fallback_warning = (
            'The quadratic Scheffé model was not estimable; analysis fell back '
            'to the linear blending model.')
    X, names, treatment_count, block_labels = _append_block_effects(
        X, names, runs)
    fit = _fit_doe_linear_model(X, names, y)
    q = len(factor_names)
    lower = list((constraints or {}).get('lower', [0.0] * q))
    upper = list((constraints or {}).get('upper', [1.0] * q))
    if len(lower) != q or len(upper) != q:
        raise ValueError('Mixture lower/upper constraints must match factor count.')
    centroid = np.mean(coded, axis=0)
    starts = np.vstack([coded, centroid])
    optimum = {
        'minimum': _mixture_optimum(
            fit['coefficients'][:treatment_count], factor_names, selected,
            lower, upper, starts, False),
        'maximum': _mixture_optimum(
            fit['coefficients'][:treatment_count], factor_names, selected,
            lower, upper, starts, True),
        'bounds': {'lower': lower, 'upper': upper},
        'conditional_on': selected,
    }
    diagnostics = design_diagnostics(
        coded, factor_names, 'mixture', model=(
            'linear' if selected == 'scheffe_linear' else 'quadratic'),
        blocks=[int(run.get('Block', 1)) for run in runs])
    warnings_list = [fallback_warning] if fallback_warning else []
    return {
        'analysis_type': 'mixture', 'model': selected,
        'terms': fit['terms'], 'effects': [],
        'r2': fit['r2'], 'adj_r2': fit['adj_r2'],
        'residuals': fit['residuals'].tolist(),
        'fitted': fit['fitted'].tolist(), 'n_runs': len(y),
        'residual_df': fit['residual_df'],
        'lack_of_fit': _lack_of_fit(
            coded, y, fit['fitted'], fit['rank'], block_labels),
        'mixture_optimum': optimum,
        'design_diagnostics': diagnostics,
        'warnings': warnings_list,
        'aliased_terms_dropped': [], 'saturated': fit['residual_df'] == 0,
        'lenth': None, 'half_normal': {'abs_effect': [], 'quantile': [], 'term': []},
        'main_effects': {}, 'interactions': [],
    }


def analyze_experiment(
    runs: list[dict], responses: list[float], factor_names: list[str],
    design_class: str = 'screening', model: str = 'auto',
    constraints: Optional[dict] = None,
) -> dict:
    """Dispatch a completed design to its matching analysis model."""
    if len(runs) != len(responses):
        raise ValueError('responses must have one value per run.')
    if design_class == 'response_surface':
        return analyze_response_surface(runs, responses, factor_names)
    if design_class == 'mixture':
        return analyze_mixture(
            runs, responses, factor_names, model=model, constraints=constraints)
    result = analyze_factorial(
        runs, responses, factor_names, include_interactions=(model != 'linear'))
    coded = np.asarray(
        [[float(run[name]) for name in factor_names] for run in runs], dtype=float)
    fitted = np.asarray(result['fitted'], dtype=float)
    rank = len(responses) - (0 if result['saturated'] else max(
        0, len(responses) - 1 - len(result['effects'])))
    result.update({
        'analysis_type': 'two_level_factorial',
        'model': 'factorial_main_plus_2fi' if model != 'linear' else 'linear_main_effects',
        'terms': [{
            'term': row['term'], 'coefficient': row['coefficient'],
            'standard_error': None, 't_value': None, 'p_value': row['p_value'],
        } for row in result['effects']],
        'lack_of_fit': _lack_of_fit(coded, np.asarray(responses, dtype=float),
                                    fitted, min(rank, len(responses)),
                                    [int(run.get('Block', 1)) for run in runs]),
        'design_diagnostics': design_diagnostics(
            coded, factor_names, 'screening',
            model=('factorial_2fi' if model != 'linear' else 'linear'),
            blocks=[int(run.get('Block', 1)) for run in runs]),
        'warnings': [],
    })
    return result
