"""Statistical Process Control (SPC) router -- control charts."""

import sys
import math
from pathlib import Path
from typing import List, Optional, Union, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.SPC import control_chart

router = APIRouter()


# ---------------------------------------------------------------------------
# Inline Pydantic schema
# ---------------------------------------------------------------------------

class ChartRequest(BaseModel):
    chart: Literal["i_mr", "xbar_r", "xbar_s", "p", "np", "c", "u"]
    # Flat list of values (i_mr / p / np / c / u) OR list of subgroups (xbar_*)
    data: Union[List[float], List[List[float]]]
    sizes: Optional[List[float]] = None


# ---------------------------------------------------------------------------
# Sanitizer
# ---------------------------------------------------------------------------

from utils import safe as _safe


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/chart")
def chart(req: ChartRequest):
    """
    Compute a control chart. For Xbar-R/S, `data` is a list of subgroups;
    otherwise a flat list of values/counts. `sizes` supplies subgroup or
    inspection sizes for p, np and u charts.
    """
    try:
        result = control_chart(req.chart, req.data, req.sizes)
    except (ValueError, IndexError, ZeroDivisionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _safe(result)
