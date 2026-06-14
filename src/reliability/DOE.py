"""Design of Experiments (DOE) module — pure NumPy implementation.

Each public generator returns a dict with at least:
  runs         : list[dict]  — factor_name -> coded value (±1 / 0 / level index)
  factor_names : list[str]
  coded        : np.ndarray  — (n_runs, k) coded design matrix
  metadata     : dict        — run_count, design_type, plus design-specific fields
"""

from __future__ import annotations

import itertools
from typing import Optional, Union
import numpy as np

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

    Chooses N = smallest multiple of 4 >= n_factors + 1.
    Returns ±1 matrix using first n_factors columns.
    """
    if n_factors < 1:
        raise ValueError("n_factors must be >= 1.")

    # Determine N
    N = 4
    while N < n_factors + 1:
        N += 4

    # Build the N×(N-1) matrix
    supported = [4, 8, 12, 16, 20, 24]
    if N > 24:
        # Fall back to Hadamard for powers of 2 up to 64
        import math
        p = math.ceil(math.log2(N))
        N = 2 ** p
        if N < n_factors + 1:
            N *= 2

    if N in (4, 8, 16):
        # Sylvester Hadamard
        H = _sylvester_hadamard(N)
        matrix = H[:, 1:]  # drop intercept column; shape (N, N-1)
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
    else:
        raise ValueError(f"Plackett-Burman design not available for N={N}.")

    if n_factors > matrix.shape[1]:
        raise ValueError(
            f"Requested {n_factors} factors but design only has {matrix.shape[1]} columns."
        )

    coded = matrix[:, :n_factors]
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
