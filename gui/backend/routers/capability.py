"""Process Capability router."""

import sys
import math
from pathlib import Path
from typing import List, Optional, Literal

from fastapi import APIRouter, HTTPException
from api_contract import public_error_message
from pydantic import BaseModel, ConfigDict

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Process_capability import process_capability, distribution_specification_tails
from reliability.Distributions import DISTRIBUTION_CLASSES

router = APIRouter()


# ---------------------------------------------------------------------------
# Inline Pydantic schema
# ---------------------------------------------------------------------------

class CapabilityRequest(BaseModel):
    data: List[float]
    lsl: Optional[float] = None
    usl: Optional[float] = None
    target: Optional[float] = None
    subgroup_size: int = 1
    n_bins: Optional[int] = None
    stability_status: Literal["assess", "stable", "unstable", "not_assessed"] = "assess"
    bootstrap_samples: int = 200
    bootstrap_confidence: float = 0.95
    seed: Optional[int] = 12345


class SpecificationTailRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    distribution: str
    params: dict[str, float]
    lsl: Optional[float] = None
    usl: Optional[float] = None


# ---------------------------------------------------------------------------
# Sanitizer
# ---------------------------------------------------------------------------

from utils import safe as _safe


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/analyze")
def analyze(req: CapabilityRequest):
    """Run a process-capability study (Cp/Cpk/Pp/Ppk/Cpm, DPMO, histogram)."""
    try:
        result = process_capability(
            data=req.data,
            lsl=req.lsl,
            usl=req.usl,
            target=req.target,
            subgroup_size=req.subgroup_size,
            n_bins=req.n_bins,
            stability_status=req.stability_status,
            bootstrap_samples=req.bootstrap_samples,
            bootstrap_confidence=req.bootstrap_confidence,
            seed=req.seed,
        )
    except (ValueError, FloatingPointError) as exc:
        raise HTTPException(status_code=400, detail=public_error_message(exc, message='Process capability could not be calculated. Check the observations, specification limits, subgroup size, and bootstrap settings.')) from exc
    return _safe(result)


@router.post('/spec-tail')
def specification_tails(req: SpecificationTailRequest):
    """Evaluate specification PPM from any supported adopted LDA distribution."""
    try:
        cls = DISTRIBUTION_CLASSES.get(req.distribution)
        if cls is None:
            raise ValueError('Unsupported specification-tail distribution.')
        # Constructors validate support parameters; forbid a hidden threshold
        # when the selected model is explicitly two/one parameter.
        if req.params.get('gamma', 0) != 0 and req.distribution.endswith(('_2P', '_1P')) \
                and req.distribution != 'Exponential_2P':
            raise ValueError('A threshold requires a shifted distribution family.')
        distribution = cls(**req.params)
        result = distribution_specification_tails(distribution, req.lsl, req.usl)
    except (ValueError, TypeError, FloatingPointError) as exc:
        raise HTTPException(status_code=400, detail=public_error_message(exc, message='Specification tails could not be calculated. Check the distribution parameters and ordered specification limits.')) from exc
    return {**result, 'distribution': req.distribution, 'params': dict(req.params)}
