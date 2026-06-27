"""Hypothesis Tests router."""

import sys
import math
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Hypothesis_tests import (
    one_sample_t,
    two_sample_t,
    paired_t,
    mann_whitney,
    wilcoxon_signed_rank,
    chi_square_gof,
    chi_square_independence,
    binomial_test,
    one_way_anova,
    kruskal_wallis,
    friedman,
    anova_factorial,
    repeated_measures_anova,
    mixed_anova,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Float sanitizer — converts nan/inf to None recursively
# ---------------------------------------------------------------------------

from utils import safe as _safe


# ---------------------------------------------------------------------------
# Inline Pydantic schemas
# ---------------------------------------------------------------------------

class RunRequest(BaseModel):
    test: str
    # One-sample
    data: Optional[list[float]] = None
    popmean: Optional[float] = 0.0
    # Two-sample / paired / nonparametric
    group_a: Optional[list[float]] = None
    group_b: Optional[list[float]] = None
    equal_var: Optional[bool] = False
    # k-group
    groups: Optional[list[list[float]]] = None
    # Chi-square GOF
    observed: Optional[list[float]] = None
    expected: Optional[list[float]] = None
    # Chi-square independence
    table: Optional[list[list[float]]] = None
    # Binomial
    successes: Optional[int] = None
    n: Optional[int] = None
    p: Optional[float] = 0.5
    # Common
    alpha: float = 0.05
    alternative: str = "two-sided"


class AnovaRequest(BaseModel):
    response: list[float]
    factors: dict[str, list[str]]
    factor_names: list[str]
    alpha: float = 0.05


class RMAnovaRequest(BaseModel):
    data: list[list[float]]   # shape: subjects x conditions
    alpha: float = 0.05


class MixedAnovaRequest(BaseModel):
    values: list[float]
    subjects: list[str]
    between_factor: list[str]
    within_factor: list[str]
    alpha: float = 0.05


# ---------------------------------------------------------------------------
# Dispatch map for /run
# ---------------------------------------------------------------------------

TEST_DISPATCH = {
    # Parametric
    "one_sample_t": lambda req: one_sample_t(
        req.data, popmean=req.popmean or 0.0, alpha=req.alpha, alternative=req.alternative
    ),
    "two_sample_t": lambda req: two_sample_t(
        req.group_a, req.group_b, alpha=req.alpha,
        equal_var=req.equal_var or False, alternative=req.alternative
    ),
    "paired_t": lambda req: paired_t(
        req.group_a, req.group_b, alpha=req.alpha, alternative=req.alternative
    ),
    # Non-parametric
    "mann_whitney": lambda req: mann_whitney(
        req.group_a, req.group_b, alpha=req.alpha, alternative=req.alternative
    ),
    "wilcoxon_signed_rank": lambda req: wilcoxon_signed_rank(
        req.group_a, req.group_b, alpha=req.alpha, alternative=req.alternative
    ),
    # Chi-square / proportion
    "chi_square_gof": lambda req: chi_square_gof(
        req.observed, expected=req.expected or None, alpha=req.alpha
    ),
    "chi_square_independence": lambda req: chi_square_independence(
        req.table, alpha=req.alpha
    ),
    "binomial_test": lambda req: binomial_test(
        req.successes, req.n, p=req.p or 0.5,
        alpha=req.alpha, alternative=req.alternative
    ),
    # k-group
    "one_way_anova": lambda req: one_way_anova(
        req.groups, alpha=req.alpha
    ),
    "kruskal_wallis": lambda req: kruskal_wallis(
        req.groups, alpha=req.alpha
    ),
    "friedman": lambda req: friedman(
        req.groups, alpha=req.alpha
    ),
}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run")
def run_test(req: RunRequest):
    """
    Dispatch to the appropriate hypothesis test.

    The `test` field selects which test to run. Required payload fields
    vary by test — see the module docstrings.
    """
    handler = TEST_DISPATCH.get(req.test)
    if handler is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown test '{req.test}'. "
                   f"Valid tests: {', '.join(TEST_DISPATCH.keys())}",
        )
    try:
        result = handler(req)
        return _safe(result)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Computation error: {e}")


@router.post("/anova")
def run_anova(req: AnovaRequest):
    """
    Factorial ANOVA (1-, 2-, or 3-way with interactions).

    Provide `response`, `factors` (dict of factor_name → list of level strings),
    and `factor_names` (ordered list of 1–3 factor names to include).
    """
    try:
        result = anova_factorial(
            req.response,
            factors=req.factors,
            factor_names=req.factor_names,
            alpha=req.alpha,
        )
        return _safe(result)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Computation error: {e}")


@router.post("/rm-anova")
def run_rm_anova(req: RMAnovaRequest):
    """
    Repeated-measures ANOVA (one within-subject factor).

    Provide `data` as a 2D list with shape (n_subjects, n_conditions).
    """
    try:
        result = repeated_measures_anova(req.data, alpha=req.alpha)
        return _safe(result)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Computation error: {e}")


@router.post("/mixed-anova")
def run_mixed_anova(req: MixedAnovaRequest):
    """
    Mixed ANOVA (one between + one within factor).

    Provide data in long format: `values`, `subjects`, `between_factor`,
    and `within_factor` (all same length).
    """
    try:
        result = mixed_anova(
            req.values,
            req.subjects,
            req.between_factor,
            req.within_factor,
            alpha=req.alpha,
        )
        return _safe(result)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Computation error: {e}")
