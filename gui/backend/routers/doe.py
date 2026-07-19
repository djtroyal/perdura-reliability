"""Design of Experiments (DOE) router — /api/doe"""

import sys
from pathlib import Path

# Bootstrap: add src/ to path so reliability.DOE is importable
_here = Path(__file__).resolve()
_src = _here.parents[3] / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from typing import Any, Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
    design_class_for_key,
    assign_balanced_blocks,
    randomized_run_order,
    replicate_design,
    design_power,
    validated_design_contract,
    analyze_experiment,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Inline Pydantic schemas
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    design: str
    # Common factor spec
    factor_names: Optional[list[str]] = None
    n_factors: Optional[int] = None
    # General factorial
    levels: Optional[list[int]] = None
    # Fractional factorial
    generators: Optional[list[str]] = None
    fraction: Optional[int] = None
    # Optimization
    center_points: Optional[int] = None
    alpha: Optional[Union[str, float]] = None
    # Mixture
    q: Optional[int] = None
    degree: Optional[int] = None
    lower: Optional[list[float]] = None
    upper: Optional[list[float]] = None
    # Taguchi
    taguchi_array: Optional[str] = None
    # Real-unit mapping
    low: Optional[list[float]] = None
    high: Optional[list[float]] = None
    explicit_levels: Optional[list[list[float]]] = None
    # Run order
    randomize: Optional[bool] = False
    seed: Optional[int] = None
    # Blocking and power planning
    n_blocks: int = 1
    block_seed: Optional[int] = None
    standardized_coefficient: Optional[float] = None
    power_alpha: float = 0.05
    target_power: float = 0.80
    # Total independent observations at every design point. One means the
    # generated design is unreplicated.
    replicates: int = Field(1, ge=1, le=100)


def _safe(value: Any) -> Any:
    """Recursively convert numpy types / arrays to Python-native JSON-safe types."""
    import numpy as np
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, dict):
        return {k: _safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_safe(v) for v in value]
    return value


def _ensure_factor_names(factor_names: Optional[list[str]], n_factors: Optional[int], prefix: str = "X") -> list[str]:
    if factor_names:
        return factor_names
    if n_factors and n_factors > 0:
        return [f"{prefix}{i+1}" for i in range(n_factors)]
    raise ValueError("Provide factor_names or n_factors.")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

@router.post("/generate")
def generate_design(req: GenerateRequest):
    """Generate a DOE design and return runs, columns dict, and metadata."""
    try:
        design_key = req.design.strip().lower().replace("-", "_").replace(" ", "_")

        result = None

        # --- SCREENING ---
        if design_key == "full_factorial_2level":
            names = _ensure_factor_names(req.factor_names, req.n_factors, "X")
            result = full_factorial_2level(names)

        elif design_key == "fractional_factorial_2level":
            names = _ensure_factor_names(req.factor_names, req.n_factors, "X")
            result = fractional_factorial_2level(
                names,
                generators=req.generators,
                fraction=req.fraction,
            )

        elif design_key == "plackett_burman":
            n = req.n_factors or (len(req.factor_names) if req.factor_names else None)
            if n is None:
                raise ValueError("Provide n_factors for Plackett-Burman.")
            result = plackett_burman(n)
            # Trim to requested factor count and rename if factor_names provided
            if req.factor_names:
                k = min(len(req.factor_names), len(result["factor_names"]))
                result["factor_names"] = req.factor_names[:k]
                result["coded"] = result["coded"][:, :k]
                result["runs"] = [
                    {req.factor_names[i]: run[f"X{i+1}"] for i in range(k)}
                    for run in result["runs"]
                ]

        # --- OPTIMIZATION ---
        elif design_key == "box_behnken":
            names = _ensure_factor_names(req.factor_names, req.n_factors, "X")
            cp = req.center_points if req.center_points is not None else 3
            result = box_behnken(names, center_points=cp)

        elif design_key == "central_composite":
            names = _ensure_factor_names(req.factor_names, req.n_factors, "X")
            cp = req.center_points if req.center_points is not None else 4
            alpha = req.alpha if req.alpha is not None else "rotatable"
            result = central_composite(names, alpha=alpha, center_points=cp)

        # --- MIXTURE ---
        elif design_key == "simplex_lattice":
            q = req.q
            if q is None and req.factor_names:
                q = len(req.factor_names)
            if q is None:
                raise ValueError("Provide q (number of mixture components).")
            m = req.degree
            if m is None:
                raise ValueError("Provide degree (m) for simplex lattice.")
            result = simplex_lattice(q, m)

        elif design_key == "simplex_centroid":
            q = req.q
            if q is None and req.factor_names:
                q = len(req.factor_names)
            if q is None:
                raise ValueError("Provide q (number of mixture components).")
            result = simplex_centroid(q)

        elif design_key == "extreme_vertices":
            q = req.q
            if q is None and req.factor_names:
                q = len(req.factor_names)
            if q is None:
                raise ValueError("Provide q (number of mixture components).")
            lower = req.lower
            upper = req.upper
            if lower is None or upper is None:
                raise ValueError("Provide lower and upper bounds for extreme_vertices.")
            result = extreme_vertices(q, lower, upper)

        # --- FULL FACTORIAL GENERAL ---
        elif design_key == "full_factorial_general":
            names = _ensure_factor_names(req.factor_names, req.n_factors, "X")
            if req.levels is None:
                raise ValueError("Provide levels list for full_factorial_general.")
            if len(req.levels) != len(names):
                raise ValueError("levels and factor_names must have the same length.")
            result = full_factorial_general(req.levels, names)

        # --- ROBUST (Taguchi) ---
        elif design_key == "taguchi":
            array_name = req.taguchi_array
            if array_name is None:
                raise ValueError("Provide taguchi_array (e.g. 'L8').")
            result = taguchi(array_name)
            # Optionally rename/subset columns to match factor_names
            if req.factor_names:
                k = min(len(req.factor_names), len(result["factor_names"]))
                old_names = result["factor_names"][:k]
                new_names = req.factor_names[:k]
                result["coded"] = result["coded"][:, :k]
                result["runs"] = [
                    {new_names[i]: run[old_names[i]] for i in range(k)}
                    for run in result["runs"]
                ]
                result["factor_names"] = new_names

        else:
            raise ValueError(
                f"Unknown design '{req.design}'. Valid keys: full_factorial_2level, "
                "fractional_factorial_2level, plackett_burman, box_behnken, "
                "central_composite, simplex_lattice, simplex_centroid, "
                "extreme_vertices, full_factorial_general, taguchi."
            )

        runs = result["runs"]
        factor_names = result["factor_names"]
        coded = result["coded"]
        metadata = result.get("metadata", {})

        # Mixture generators use generic X names internally; apply requested
        # component names before building the common contract.
        if (design_class_for_key(design_key) == "mixture" and req.factor_names):
            if len(req.factor_names) != len(factor_names):
                raise ValueError("factor_names must contain one name per mixture component.")
            old_names = list(factor_names)
            factor_names = list(req.factor_names)
            runs = [
                {factor_names[i]: run[old_names[i]] for i in range(len(factor_names))}
                for run in runs
            ]

        # --- Real-unit mapping ---
        if req.low is not None and req.high is not None:
            low = req.low
            high = req.high
            # Align to factor count
            k = len(factor_names)
            if len(low) < k:
                low = low + [0.0] * (k - len(low))
            if len(high) < k:
                high = high + [1.0] * (k - len(high))
            runs = map_to_real_units(runs, factor_names, low=low[:k], high=high[:k])

        elif req.explicit_levels is not None:
            runs = map_to_real_units(runs, factor_names, levels=req.explicit_levels)

        reserved_names = {'block', 'replicate'}
        conflicting = [name for name in factor_names
                       if str(name).strip().lower() in reserved_names]
        if conflicting:
            raise ValueError(
                'Factor names Block and Replicate are reserved DOE columns.')

        # Replicate the complete design before blocking and run-order
        # randomization. Each returned row remains an independent observation
        # for pure-error and lack-of-fit estimation during analysis.
        base_run_count = len(runs)
        base_coded = coded.copy()
        coded, runs = replicate_design(coded, runs, req.replicates)

        # --- Blocking and randomization provenance ---
        block_seed = req.block_seed if req.block_seed is not None else req.seed
        blocks, blocking = assign_balanced_blocks(
            coded, req.n_blocks, seed=block_seed)
        runs = [dict(run, Block=blocks[index]) for index, run in enumerate(runs)]
        order, randomization = randomized_run_order(
            blocks, bool(req.randomize), seed=req.seed)
        runs = [runs[index] for index in order]

        metadata = validated_design_contract(
            coded, factor_names, design_key, metadata=metadata,
            blocks=blocks,
            power_effect=None,
            alpha=req.power_alpha, target_power=req.target_power,
        )
        if req.standardized_coefficient is not None:
            design_class = design_class_for_key(design_key)
            power_model = (
                'quadratic' if design_class == 'response_surface'
                else 'auto' if design_class == 'mixture'
                else 'linear'
            )
            power_plan = design_power(
                base_coded, factor_names, design_class,
                standardized_coefficient=req.standardized_coefficient,
                alpha=req.power_alpha, target_power=req.target_power,
                model=power_model,
            )
            selected_power = design_power(
                coded, factor_names, design_class,
                standardized_coefficient=req.standardized_coefficient,
                alpha=req.power_alpha, target_power=req.target_power,
                model=power_model,
            )['current_design']
            if selected_power is not None:
                selected_power = {
                    **selected_power,
                    'replicates': req.replicates,
                }
            power_plan['current_design'] = selected_power
            power_plan['selected_replicates'] = req.replicates
            metadata['power_analysis'] = power_plan
        metadata["blocking"] = blocking
        metadata["randomization"] = randomization
        metadata["replicates"] = req.replicates
        metadata["base_run_count"] = base_run_count
        metadata["analysis_constraints"] = {
            "lower": req.lower, "upper": req.upper,
        } if req.lower is not None and req.upper is not None else None

        # Build columns dict (factor -> list of values)
        columns: dict[str, list] = {}
        if runs:
            for key in runs[0].keys():
                columns[key] = [run[key] for run in runs]

        return {
            "columns": _safe(columns),
            "runs": _safe(runs),
            "factor_names": _safe(factor_names),
            "metadata": _safe(metadata),
        }

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}")


# ---------------------------------------------------------------------------
# Analysis of a completed factorial experiment
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    factor_names: list[str]
    runs: list[dict]                 # per-run {factor: coded/real level}
    responses: list[float]           # measured response per run
    include_interactions: bool = True
    design_class: str = "screening"
    model: str = "auto"
    metadata: Optional[dict] = None
    constraints: Optional[dict] = None


@router.post("/analyze")
def analyze(req: AnalyzeRequest):
    """Analyze a completed factorial experiment: effects, %contribution,
    Lenth significance, half-normal coordinates, main-effects and interaction
    plot data, and the regression fit."""
    if len(req.responses) != len(req.runs):
        raise HTTPException(status_code=400,
                            detail="Provide exactly one response per run.")
    try:
        design_class = req.design_class
        if req.metadata and req.metadata.get("design_class"):
            design_class = str(req.metadata["design_class"])
        constraints = req.constraints
        if constraints is None and req.metadata:
            constraints = req.metadata.get("analysis_constraints")
        analysis_model = req.model
        if analysis_model == "auto" and req.metadata:
            planned = str(req.metadata.get("analysis_model", "auto"))
            analysis_model = {
                "linear_main_effects": "linear",
                "factorial_main_plus_2fi": "factorial_2fi",
                "full_quadratic": "quadratic",
                "scheffe_linear": "linear",
                "scheffe_quadratic": "auto",
            }.get(planned, "auto")
        res = analyze_experiment(
            req.runs, req.responses, req.factor_names,
            design_class=design_class,
            model=("linear" if not req.include_interactions else analysis_model),
            constraints=constraints,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _safe(res)
