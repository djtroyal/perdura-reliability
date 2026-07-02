"""
Statistical Process Control (SPC) -- control chart computations.

Supports the standard Shewhart charts:
  - I-MR    : individuals + moving range
  - Xbar-R  : subgroup mean + range
  - Xbar-S  : subgroup mean + standard deviation
  - p, np   : fraction / number nonconforming (attribute)
  - c, u    : count / count-per-unit (attribute)

Each builder returns a dict with one or more sub-charts; every sub-chart
carries center line (CL), UCL, LCL, plotted points, point indices and a list
of out-of-control violations. Nelson rules 1, 2 (9-pt run), 5 and 6 —
numbered here 1-4 — are evaluated on
each chart (rules 2-4 require zone sigmas, available when sigma is known).

Only numpy is used.
"""

import math
from typing import List, Optional

import numpy as np


# ---------------------------------------------------------------------------
# Control chart constants indexed by subgroup size n
# A2 (Xbar-R), A3 (Xbar-S), D3/D4 (R), B3/B4 (S), d2, E2 (I-MR)
# Source: standard SPC tables (Montgomery, Introduction to SQC).
# ---------------------------------------------------------------------------
_CONST = {
    # n : (A2,   A3,    D3,    D4,    B3,    B4,    d2,    E2)
    2: (1.880, 2.659, 0.000, 3.267, 0.000, 3.267, 1.128, 2.660),
    3: (1.023, 1.954, 0.000, 2.574, 0.000, 2.568, 1.693, 1.772),
    4: (0.729, 1.628, 0.000, 2.282, 0.000, 2.266, 2.059, 1.457),
    5: (0.577, 1.427, 0.000, 2.114, 0.000, 2.089, 2.326, 1.290),
    6: (0.483, 1.287, 0.000, 2.004, 0.030, 1.970, 2.534, 1.184),
    7: (0.419, 1.182, 0.076, 1.924, 0.118, 1.882, 2.704, 1.109),
    8: (0.373, 1.099, 0.136, 1.864, 0.185, 1.815, 2.847, 1.054),
    9: (0.337, 1.032, 0.184, 1.816, 0.239, 1.761, 2.970, 1.010),
    10: (0.308, 0.975, 0.223, 1.777, 0.284, 1.716, 3.078, 0.975),
    11: (0.285, 0.927, 0.256, 1.744, 0.321, 1.679, 3.173, 0.945),
    12: (0.266, 0.886, 0.283, 1.717, 0.354, 1.646, 3.258, 0.921),
    13: (0.249, 0.850, 0.307, 1.693, 0.382, 1.618, 3.336, 0.899),
    14: (0.235, 0.817, 0.328, 1.672, 0.406, 1.594, 3.407, 0.881),
    15: (0.223, 0.789, 0.347, 1.653, 0.428, 1.572, 3.472, 0.864),
    16: (0.212, 0.763, 0.363, 1.637, 0.448, 1.552, 3.532, 0.849),
    17: (0.203, 0.739, 0.378, 1.622, 0.466, 1.534, 3.588, 0.836),
    18: (0.194, 0.718, 0.391, 1.608, 0.482, 1.518, 3.640, 0.824),
    19: (0.187, 0.698, 0.403, 1.597, 0.497, 1.503, 3.689, 0.813),
    20: (0.180, 0.680, 0.415, 1.585, 0.510, 1.490, 3.735, 0.803),
    21: (0.173, 0.663, 0.425, 1.575, 0.523, 1.477, 3.778, 0.794),
    22: (0.167, 0.647, 0.434, 1.566, 0.534, 1.466, 3.819, 0.786),
    23: (0.162, 0.633, 0.443, 1.557, 0.545, 1.455, 3.858, 0.778),
    24: (0.157, 0.619, 0.451, 1.548, 0.555, 1.445, 3.895, 0.770),
    25: (0.153, 0.606, 0.459, 1.541, 0.565, 1.435, 3.931, 0.763),
}


def _const(n: int):
    if n in _CONST:
        return _CONST[n]
    if n < 2:
        return _CONST[2]
    return _CONST[25]


# ---------------------------------------------------------------------------
# Nelson run rules (rule 2 uses the 9-point run of the Nelson set)
# ---------------------------------------------------------------------------

def _western_electric(points, cl, ucl, lcl, sigma=None):
    """
    Evaluate the Nelson run rules on a point series. Returns a list of
    violation dicts {index, value, rule, description}. Rule 1 always; rules
    2-4 only when a per-point sigma (scalar or array) is supplied so that
    1-/2-sigma zones can be drawn.
    """
    pts = np.asarray(points, dtype=float)
    m = pts.size
    viols = []

    ucl_a = np.asarray(ucl, dtype=float) if np.ndim(ucl) else np.full(m, ucl, float)
    lcl_a = np.asarray(lcl, dtype=float) if np.ndim(lcl) else np.full(m, lcl, float)
    cl_a = np.asarray(cl, dtype=float) if np.ndim(cl) else np.full(m, cl, float)

    # Rule 1: any point beyond 3-sigma control limits.
    for i in range(m):
        if pts[i] > ucl_a[i] or pts[i] < lcl_a[i]:
            viols.append({
                "index": i, "value": float(pts[i]), "rule": 1,
                "description": "Point beyond 3-sigma control limits",
            })

    if sigma is None:
        return _dedupe(viols)

    sig = np.asarray(sigma, dtype=float) if np.ndim(sigma) else np.full(m, sigma, float)
    # Standardized distance from center (signed) in sigma units.
    z = np.where(sig > 0, (pts - cl_a) / sig, 0.0)

    # Rule 2: 9 points in a row on the same side of the center line.
    run = 0
    sign = 0
    for i in range(m):
        s = 1 if pts[i] > cl_a[i] else (-1 if pts[i] < cl_a[i] else 0)
        if s != 0 and s == sign:
            run += 1
        else:
            sign = s
            run = 1 if s != 0 else 0
        if run >= 9:
            for j in range(i - 8, i + 1):
                viols.append({
                    "index": j, "value": float(pts[j]), "rule": 2,
                    "description": "9 points in a row on one side of center",
                })

    # Rule 3 (Nelson 5): 2 of 3 consecutive points beyond 2-sigma (same side).
    # The pattern is flagged at the window's last point whether or not that
    # particular point is in the zone — requiring the terminal point beyond
    # 2-sigma under-reported patterns completed by an earlier member.
    for i in range(2, m):
        window = z[i - 2:i + 1]
        for side in (1, -1):
            if np.sum(window * side > 2) >= 2:
                viols.append({
                    "index": i, "value": float(pts[i]), "rule": 3,
                    "description": "2 of 3 points beyond 2-sigma (same side)",
                })

    # Rule 4 (Nelson 6): 4 of 5 consecutive points beyond 1-sigma (same side).
    for i in range(4, m):
        window = z[i - 4:i + 1]
        for side in (1, -1):
            if np.sum(window * side > 1) >= 4:
                viols.append({
                    "index": i, "value": float(pts[i]), "rule": 4,
                    "description": "4 of 5 points beyond 1-sigma (same side)",
                })

    return _dedupe(viols)


def _dedupe(viols):
    seen = set()
    out = []
    for v in sorted(viols, key=lambda d: (d["index"], d["rule"])):
        key = (v["index"], v["rule"])
        if key not in seen:
            seen.add(key)
            out.append(v)
    return out


def _chart(name, points, cl, ucl, lcl, sigma=None, labels=None):
    pts = [float(p) for p in points]
    return {
        "name": name,
        "points": pts,
        "indices": list(range(len(pts))),
        "labels": labels if labels is not None else list(range(1, len(pts) + 1)),
        "cl": cl if np.ndim(cl) == 0 else [float(c) for c in cl],
        "ucl": ucl if np.ndim(ucl) == 0 else [float(c) for c in ucl],
        "lcl": lcl if np.ndim(lcl) == 0 else [float(c) for c in lcl],
        "violations": _western_electric(points, cl, ucl, lcl, sigma),
    }


# ---------------------------------------------------------------------------
# Variables charts
# ---------------------------------------------------------------------------

def i_mr_chart(values: List[float]):
    """Individuals (I) and Moving Range (MR) charts."""
    x = np.asarray([float(v) for v in values], dtype=float)
    if x.size < 2:
        raise ValueError("I-MR needs at least 2 observations.")
    mr = np.abs(np.diff(x))
    mr_bar = float(np.mean(mr))
    d2 = _CONST[2][6]
    sigma = mr_bar / d2 if mr_bar > 0 else float(np.std(x, ddof=1))
    xbar = float(np.mean(x))

    i_ucl = xbar + 3 * sigma
    i_lcl = xbar - 3 * sigma
    d4 = _CONST[2][3]
    d3 = _CONST[2][2]
    mr_ucl = d4 * mr_bar
    mr_lcl = d3 * mr_bar

    return {
        "chart": "i_mr",
        "sigma": sigma,
        "subcharts": [
            _chart("Individuals", x, xbar, i_ucl, i_lcl, sigma),
            # MR is one shorter; its first plotted point corresponds to obs 2.
            _chart("Moving Range", mr, mr_bar, mr_ucl, mr_lcl,
                   labels=list(range(2, len(x) + 1))),
        ],
    }


def _subgroups(data):
    rows = [np.asarray([float(v) for v in g], dtype=float) for g in data]
    sizes = {len(r) for r in rows}
    if len(sizes) != 1:
        raise ValueError("Xbar charts require equal subgroup sizes.")
    n = rows[0].size
    if n < 2:
        raise ValueError("Subgroup size must be >= 2.")
    return rows, n


def xbar_r_chart(data: List[List[float]]):
    """Xbar-R chart for subgrouped data (equal subgroup sizes)."""
    rows, n = _subgroups(data)
    A2, A3, D3, D4, B3, B4, d2, E2 = _const(n)
    means = np.array([r.mean() for r in rows])
    ranges = np.array([r.max() - r.min() for r in rows])
    xbarbar = float(means.mean())
    rbar = float(ranges.mean())
    sigma = rbar / d2 if rbar > 0 else 0.0

    x_ucl = xbarbar + A2 * rbar
    x_lcl = xbarbar - A2 * rbar
    r_ucl = D4 * rbar
    r_lcl = D3 * rbar

    return {
        "chart": "xbar_r",
        "sigma_subgroup_mean": sigma / math.sqrt(n) if n else 0.0,
        "subcharts": [
            _chart("Xbar", means, xbarbar, x_ucl, x_lcl, sigma / math.sqrt(n)),
            _chart("Range", ranges, rbar, r_ucl, r_lcl),
        ],
    }


def xbar_s_chart(data: List[List[float]]):
    """Xbar-S chart for subgrouped data (equal subgroup sizes)."""
    rows, n = _subgroups(data)
    A2, A3, D3, D4, B3, B4, d2, E2 = _const(n)
    means = np.array([r.mean() for r in rows])
    stds = np.array([r.std(ddof=1) for r in rows])
    xbarbar = float(means.mean())
    sbar = float(stds.mean())
    # c4 derived from B3/B4 not needed; use sbar for limits directly.
    x_ucl = xbarbar + A3 * sbar
    x_lcl = xbarbar - A3 * sbar
    s_ucl = B4 * sbar
    s_lcl = B3 * sbar

    return {
        "chart": "xbar_s",
        "subcharts": [
            _chart("Xbar", means, xbarbar, x_ucl, x_lcl, A3 * sbar / 3.0),
            _chart("StdDev", stds, sbar, s_ucl, s_lcl),
        ],
    }


# ---------------------------------------------------------------------------
# Attribute charts
# ---------------------------------------------------------------------------

def p_chart(counts: List[float], sizes: List[float]):
    """p-chart: fraction nonconforming, supports variable subgroup sizes."""
    d = np.asarray([float(c) for c in counts], dtype=float)
    n = np.asarray([float(s) for s in sizes], dtype=float)
    if d.size != n.size:
        raise ValueError("counts and sizes must have the same length.")
    pbar = float(d.sum() / n.sum())
    p = d / n
    sigma = np.sqrt(pbar * (1 - pbar) / n)
    ucl = np.minimum(1.0, pbar + 3 * sigma)
    lcl = np.maximum(0.0, pbar - 3 * sigma)
    return {
        "chart": "p",
        "center": pbar,
        "subcharts": [_chart("p (fraction nonconforming)", p, pbar, ucl, lcl, sigma)],
    }


def np_chart(counts: List[float], n: float):
    """np-chart: number nonconforming, constant subgroup size n."""
    d = np.asarray([float(c) for c in counts], dtype=float)
    n = float(n)
    pbar = float(d.sum() / (n * d.size))
    npbar = n * pbar
    sigma = math.sqrt(npbar * (1 - pbar)) if 0 < pbar < 1 else 0.0
    ucl = npbar + 3 * sigma
    lcl = max(0.0, npbar - 3 * sigma)
    return {
        "chart": "np",
        "center": npbar,
        "subcharts": [_chart("np (count nonconforming)", d, npbar, ucl, lcl, sigma)],
    }


def c_chart(counts: List[float]):
    """c-chart: count of defects per unit, constant area of opportunity."""
    c = np.asarray([float(v) for v in counts], dtype=float)
    cbar = float(c.mean())
    sigma = math.sqrt(cbar) if cbar > 0 else 0.0
    ucl = cbar + 3 * sigma
    lcl = max(0.0, cbar - 3 * sigma)
    return {
        "chart": "c",
        "center": cbar,
        "subcharts": [_chart("c (defect count)", c, cbar, ucl, lcl, sigma)],
    }


def u_chart(counts: List[float], sizes: List[float]):
    """u-chart: defects per unit, supports variable inspection sizes."""
    c = np.asarray([float(v) for v in counts], dtype=float)
    n = np.asarray([float(s) for s in sizes], dtype=float)
    if c.size != n.size:
        raise ValueError("counts and sizes must have the same length.")
    ubar = float(c.sum() / n.sum())
    u = c / n
    sigma = np.sqrt(ubar / n)
    ucl = ubar + 3 * sigma
    lcl = np.maximum(0.0, ubar - 3 * sigma)
    return {
        "chart": "u",
        "center": ubar,
        "subcharts": [_chart("u (defects per unit)", u, ubar, ucl, lcl, sigma)],
    }


def control_chart(chart: str, data, sizes: Optional[List[float]] = None):
    """
    Dispatch a control-chart computation by name.

    Parameters
    ----------
    chart : one of 'i_mr','xbar_r','xbar_s','p','np','c','u'
    data  : for variables charts a flat list (I-MR) or list-of-subgroups
            (Xbar-R/S); for attribute charts a flat list of counts.
    sizes : subgroup / inspection sizes for p, np, u charts. np may take a
            single int; p and u take a per-point list.
    """
    chart = chart.lower()
    if chart == "i_mr":
        return i_mr_chart(data)
    if chart == "xbar_r":
        return xbar_r_chart(data)
    if chart == "xbar_s":
        return xbar_s_chart(data)
    if chart == "p":
        if sizes is None:
            raise ValueError("p-chart requires subgroup sizes.")
        return p_chart(data, sizes)
    if chart == "np":
        if sizes is None:
            raise ValueError("np-chart requires a subgroup size.")
        n = sizes[0] if isinstance(sizes, (list, tuple)) else sizes
        return np_chart(data, n)
    if chart == "c":
        return c_chart(data)
    if chart == "u":
        if sizes is None:
            raise ValueError("u-chart requires inspection sizes.")
        return u_chart(data, sizes)
    raise ValueError(f"Unknown chart type: {chart}")
