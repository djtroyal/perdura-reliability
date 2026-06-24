"""Life Data Analysis router."""

import ast
import sys
import warnings
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Fitters import (
    Fit_Everything, _FITTER_MAP, ALL_FITTER_NAMES,
    Fit_Weibull_2P, Fit_Weibull_3P,
    Fit_Exponential_1P, Fit_Exponential_2P,
    Fit_Normal_2P, Fit_Lognormal_2P, Fit_Lognormal_3P,
    Fit_Gamma_2P, Fit_Loglogistic_2P, Fit_Beta_2P, Fit_Gumbel_2P,
)
from reliability.Nonparametric import KaplanMeier, NelsonAalen
from reliability.Utils import xy_transform, negative_log_likelihood
from reliability.Distributions import (
    Weibull_Distribution, Exponential_Distribution, Normal_Distribution,
    Lognormal_Distribution, Gamma_Distribution, Loglogistic_Distribution,
    Beta_Distribution, Gumbel_Distribution,
)
from scipy import stats as ss
from reliability.Special_models import (
    Fit_Weibull_Mixture, Fit_Weibull_CR, Fit_Weibull_DSZI,
    Fit_Weibull_DS, Fit_Weibull_ZI, Fit_Weibull_2P_grouped,
)
from schemas import (
    LifeDataFitRequest, NonparametricRequest,
    GenerateRequest, MCEquationRequest, SpecCurvesRequest, CompareRequest,
    EvaluateRequest, StressStrengthRequest, SpecialModelRequest, CalculatorRequest,
    WeibayesRequest, CompetingFailureModesRequest,
)

# distribution name -> (Distribution class, ordered parameter names)
_DIST_SPECS = {
    'Weibull_2P': (Weibull_Distribution, ['eta', 'beta']),
    'Weibull_3P': (Weibull_Distribution, ['eta', 'beta', 'gamma']),
    'Exponential_1P': (Exponential_Distribution, ['Lambda']),
    'Exponential_2P': (Exponential_Distribution, ['Lambda', 'gamma']),
    'Normal_2P': (Normal_Distribution, ['mu', 'sigma']),
    'Lognormal_2P': (Lognormal_Distribution, ['mu', 'sigma']),
    'Lognormal_3P': (Lognormal_Distribution, ['mu', 'sigma', 'gamma']),
    'Gamma_2P': (Gamma_Distribution, ['alpha', 'beta']),
    'Gamma_3P': (Gamma_Distribution, ['alpha', 'beta', 'gamma']),
    'Loglogistic_2P': (Loglogistic_Distribution, ['alpha', 'beta']),
    'Loglogistic_3P': (Loglogistic_Distribution, ['alpha', 'beta', 'gamma']),
    'Beta_2P': (Beta_Distribution, ['alpha', 'beta']),
    'Gumbel_2P': (Gumbel_Distribution, ['mu', 'sigma']),
}


def _build_distribution(name: str, params: dict):
    if name not in _DIST_SPECS:
        raise HTTPException(status_code=400,
                            detail=f"Unknown distribution '{name}'. "
                                   f"Available: {list(_DIST_SPECS)}")
    cls, param_names = _DIST_SPECS[name]
    missing = [p for p in param_names if p not in params and p != 'gamma']
    if missing:
        raise HTTPException(status_code=400,
                            detail=f"Missing parameters for {name}: {missing}")
    kwargs = {p: float(params[p]) for p in param_names if p in params}
    try:
        return cls(**kwargs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

router = APIRouter()

# --- Safe equation evaluator for MC equation-based simulation ---

_MATH_FUNCS = {
    'sqrt': np.sqrt, 'cbrt': np.cbrt, 'abs': np.abs,
    'exp': np.exp, 'log': np.log, 'log2': np.log2, 'log10': np.log10,
    'sin': np.sin, 'cos': np.cos, 'tan': np.tan,
    'asin': np.arcsin, 'acos': np.arccos, 'atan': np.arctan,
    'ceil': np.ceil, 'floor': np.floor,
    'pow': np.power, 'min': np.minimum, 'max': np.maximum,
}
_MATH_CONSTS = {'pi': np.pi, 'e': np.e}
_ALLOWED_NAMES = set(_MATH_FUNCS) | set(_MATH_CONSTS)

_ALLOWED_NODE_TYPES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name,
    ast.Call, ast.Load,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.UAdd, ast.USub,
)


def _validate_equation(equation: str, var_names: set[str]):
    """Parse and validate an equation string against a strict AST whitelist."""
    try:
        tree = ast.parse(equation, mode='eval')
    except SyntaxError as exc:
        raise ValueError(f"Syntax error in equation: {exc}")

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODE_TYPES):
            raise ValueError(
                f"Disallowed expression element: {type(node).__name__}. "
                "Only arithmetic operators, numeric constants, variable names, "
                "and whitelisted math functions are permitted."
            )
        if isinstance(node, ast.Name) and node.id not in (var_names | _ALLOWED_NAMES):
            raise ValueError(
                f"Unknown name '{node.id}'. "
                f"Available variables: {sorted(var_names)}. "
                f"Available functions: {sorted(_MATH_FUNCS)}."
            )
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Only simple function calls are allowed (no method calls).")
            if node.func.id not in _MATH_FUNCS:
                raise ValueError(
                    f"Unknown function '{node.func.id}'. "
                    f"Available: {sorted(_MATH_FUNCS)}."
                )
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            raise ValueError("Only numeric constants are allowed in equations.")


def _eval_equation_vectorized(equation: str, var_arrays: dict[str, np.ndarray]) -> np.ndarray:
    """Evaluate a validated equation over numpy arrays."""
    namespace = {'__builtins__': {}}
    namespace.update(_MATH_FUNCS)
    namespace.update(_MATH_CONSTS)
    namespace.update(var_arrays)
    code = compile(equation, '<equation>', 'eval')
    return np.asarray(eval(code, namespace), dtype=float)


def _safe(v, ndigits: int = 6):
    """Round to a JSON-friendly float, mapping non-finite values to None."""
    if v is None:
        return None
    v = float(v)
    if not np.isfinite(v):
        return None
    return round(v, ndigits)


def _dist_params(fit, name: str) -> dict:
    """Extract fitted parameters and their confidence intervals as a flat dict."""
    params = {}
    for attr in ('eta', 'alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda', 'alpha_1', 'alpha_2'):
        if hasattr(fit, attr):
            val = getattr(fit, attr)
            if val is not None:
                params[attr] = _safe(val)
                if hasattr(fit, f"{attr}_lower"):
                    params[f"{attr}_lower"] = _safe(getattr(fit, f"{attr}_lower"))
                if hasattr(fit, f"{attr}_upper"):
                    params[f"{attr}_upper"] = _safe(getattr(fit, f"{attr}_upper"))
                if hasattr(fit, f"{attr}_SE"):
                    params[f"{attr}_se"] = _safe(getattr(fit, f"{attr}_SE"))
    return params


def _distribution_curves(fit, failures: np.ndarray) -> dict:
    """Generate PDF, CDF, SF, HF curves plus SF/CDF confidence bands."""
    dist = fit.distribution
    lo = failures.min() * 0.5
    hi = failures.max() * 1.5
    x = np.linspace(max(lo, 1e-6), hi, 300)

    # Some distributions have support constraints
    if hasattr(dist, 'gamma') and dist.gamma is not None:
        x = x[x > dist.gamma]
    if len(x) == 0:
        return {}

    out = {
        "x": x.tolist(),
        "pdf": dist._pdf(x).tolist(),
        "cdf": dist._cdf(x).tolist(),
        "sf": dist._sf(x).tolist(),
        "hf": dist._hf(x).tolist(),
    }

    # Confidence bands on the survival and cumulative functions
    try:
        _, sf_lo, sf_hi = fit.confidence_bounds(xvals=x, func='SF')
        if sf_lo is not None:
            out["sf_lower"] = sf_lo.tolist()
            out["sf_upper"] = sf_hi.tolist()
            out["cdf_lower"] = (1 - sf_hi).tolist()
            out["cdf_upper"] = (1 - sf_lo).tolist()
    except Exception:
        pass

    return out


def _probability_plot_data(fit, name: str, failures: np.ndarray,
                           right_censored) -> dict:
    """Return probability plot scatter + fitted line data."""
    from reliability.Utils import rank_adjustment, median_rank_approximation

    rc = np.asarray(right_censored, dtype=float) if right_censored else None
    adj_ranks, n = rank_adjustment(failures, rc)
    median_ranks = median_rank_approximation(adj_ranks, n)
    sorted_f = np.sort(failures)
    median_ranks = np.clip(median_ranks, 1e-10, 1 - 1e-10)

    x_transform, y_transform, x_label, y_label = xy_transform(name)
    x_pts = x_transform(sorted_f).tolist()
    y_pts = y_transform(median_ranks).tolist()

    # Fitted line
    x_line_raw = np.linspace(sorted_f.min() * 0.8, sorted_f.max() * 1.2, 200)
    x_line_raw = x_line_raw[x_line_raw > 0]
    cdf_vals = np.clip(fit.distribution._cdf(x_line_raw), 1e-10, 1 - 1e-10)
    x_line = x_transform(x_line_raw).tolist()
    y_line = y_transform(cdf_vals).tolist()

    out = {
        "scatter_x": x_pts,
        "scatter_y": y_pts,
        "line_x": x_line,
        "line_y": y_line,
        "line_x_raw": x_line_raw.tolist(),
        "x_label": x_label,
        "y_label": y_label,
    }

    # Confidence band on the fitted line (mapped onto the linearized axis)
    try:
        _, sf_lo, sf_hi = fit.confidence_bounds(xvals=x_line_raw, func='SF')
        if sf_lo is not None:
            cdf_lo = np.clip(1 - sf_hi, 1e-10, 1 - 1e-10)
            cdf_hi = np.clip(1 - sf_lo, 1e-10, 1 - 1e-10)
            out["line_lower"] = y_transform(cdf_lo).tolist()
            out["line_upper"] = y_transform(cdf_hi).tolist()
    except Exception:
        pass

    return out


@router.post("/fit")
def fit_distributions(req: LifeDataFitRequest):
    failures = np.asarray(req.failures, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None

    if len(failures) < 2:
        raise HTTPException(status_code=400, detail="At least 2 failure times required.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fe = Fit_Everything(
                failures=failures,
                right_censored=rc,
                distributions_to_fit=req.distributions_to_fit,
                method=req.method,
                CI=req.CI,
                show_probability_plot=False,
                show_histogram_plot=False,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Build results rows
    results = []
    for _, row in fe.results.iterrows():
        dist_name = row["Distribution"]
        entry = {
            "Distribution": dist_name,
            "AICc": None if np.isinf(row["AICc"]) else round(float(row["AICc"]), 4),
            "BIC": None if np.isinf(row["BIC"]) else round(float(row["BIC"]), 4),
            "AD": None if np.isinf(row["AD"]) else round(float(row["AD"]), 4),
            "LogLik": round(float(row["Log-Likelihood"]), 4),
        }
        if dist_name in fe.fitted:
            entry["params"] = _dist_params(fe.fitted[dist_name], dist_name)
        results.append(entry)

    # Plot data for every fitted distribution (enables instant switching)
    best_name = fe.best_distribution_name
    plots: dict = {}
    for dist_name, fit in fe.fitted.items():
        if fit and fit.distribution:
            try:
                plots[dist_name] = {
                    "probability": _probability_plot_data(
                        fit, dist_name, failures, req.right_censored),
                    "curves": _distribution_curves(fit, failures),
                }
            except Exception:
                pass

    return {
        "results": results,
        "best_distribution": best_name,
        "plots": plots,
        "CI": req.CI,
        "available_distributions": list(ALL_FITTER_NAMES),
    }


@router.post("/nonparametric")
def nonparametric(req: NonparametricRequest):
    failures = np.asarray(req.failures, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None

    if len(failures) < 1:
        raise HTTPException(status_code=400, detail="At least 1 failure time required.")

    try:
        if req.method == "KM":
            est = KaplanMeier(failures, right_censored=rc, CI=req.CI)
            df = est.results
            return {
                "method": "Kaplan-Meier",
                "time": df["time"].tolist(),
                "SF": df["SF"].tolist(),
                "CI_lower": df["CI_lower"].tolist(),
                "CI_upper": df["CI_upper"].tolist(),
            }
        else:
            est = NelsonAalen(failures, right_censored=rc, CI=req.CI)
            df = est.results
            return {
                "method": "Nelson-Aalen",
                "time": df["time"].tolist(),
                "CHF": df["CHF"].tolist(),
                "SF": df["SF"].tolist(),
                "CI_lower": df["CI_lower"].tolist(),
                "CI_upper": df["CI_upper"].tolist(),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/distributions")
def list_distributions():
    return {"distributions": list(ALL_FITTER_NAMES)}


@router.post("/generate")
def generate_samples(req: GenerateRequest):
    """Monte Carlo random samples from a specified distribution."""
    if req.n < 1 or req.n > 100000:
        raise HTTPException(status_code=400, detail="n must be between 1 and 100000.")
    dist = _build_distribution(req.distribution, req.params)
    samples = np.asarray(dist.random_samples(req.n, seed=req.seed), dtype=float)
    return {
        "distribution": req.distribution,
        "samples": [round(float(s), 6) for s in samples],
    }


@router.post("/mc-equation")
def mc_equation(req: MCEquationRequest):
    """Equation-based Monte Carlo: combine multiple random variables via a formula."""
    if req.n < 1 or req.n > 100000:
        raise HTTPException(status_code=400, detail="n must be between 1 and 100,000.")
    if len(req.variables) < 1 or len(req.variables) > 20:
        raise HTTPException(status_code=400, detail="Provide 1–20 variables.")

    var_names = set()
    for v in req.variables:
        if not v.name.isidentifier():
            raise HTTPException(status_code=400, detail=f"'{v.name}' is not a valid identifier.")
        if v.name in _ALLOWED_NAMES:
            raise HTTPException(
                status_code=400,
                detail=f"Variable name '{v.name}' conflicts with a built-in function/constant.",
            )
        if v.name in var_names:
            raise HTTPException(status_code=400, detail=f"Duplicate variable name '{v.name}'.")
        var_names.add(v.name)

    try:
        _validate_equation(req.equation, var_names)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    rng = np.random.default_rng(req.seed)
    var_arrays: dict[str, np.ndarray] = {}
    var_stats = []
    for v in req.variables:
        dist = _build_distribution(v.distribution, v.params)
        sub_seed = int(rng.integers(0, 2**31))
        samples = np.asarray(dist.random_samples(req.n, seed=sub_seed), dtype=float)
        var_arrays[v.name] = samples
        var_stats.append({
            "name": v.name,
            "distribution": v.distribution,
            "stats": {"mean": round(float(np.nanmean(samples)), 6),
                      "std": round(float(np.nanstd(samples)), 6)},
        })

    try:
        result = _eval_equation_vectorized(req.equation, var_arrays)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Equation evaluation failed: {exc}")

    finite_mask = np.isfinite(result)
    n_valid = int(finite_mask.sum())
    n_invalid = int((~finite_mask).sum())
    if n_valid == 0:
        raise HTTPException(
            status_code=400,
            detail="All computed samples are NaN or Inf — check the equation for domain errors.",
        )
    valid = result[finite_mask]

    percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
    pvals = np.percentile(valid, percentiles)
    stats = {
        "mean": round(float(np.mean(valid)), 6),
        "std": round(float(np.std(valid)), 6),
        "min": round(float(np.min(valid)), 6),
        "max": round(float(np.max(valid)), 6),
    }
    for p, pv in zip(percentiles, pvals):
        stats[f"p{p}"] = round(float(pv), 6)

    n_bins = min(max(int(np.sqrt(n_valid)), 10), 100)
    counts, edges = np.histogram(valid, bins=n_bins)

    return {
        "samples": [round(float(s), 6) for s in valid],
        "n_total": req.n,
        "n_valid": n_valid,
        "n_invalid": n_invalid,
        "stats": stats,
        "histogram": {
            "counts": counts.tolist(),
            "edges": [round(float(e), 6) for e in edges],
        },
        "variables": var_stats,
    }


@router.post("/evaluate")
def evaluate_distribution(req: EvaluateRequest):
    """SF/CDF/PDF/HF of a specified distribution at time t."""
    if req.t < 0:
        raise HTTPException(status_code=400, detail="t must be >= 0.")
    dist = _build_distribution(req.distribution, req.params)
    x = np.asarray([req.t], dtype=float)
    sf = float(np.clip(dist._sf(x)[0], 0.0, 1.0))
    pdf = float(np.nan_to_num(dist._pdf(x)[0]))
    hf = float(np.nan_to_num(dist._hf(x)[0], posinf=0))
    return {
        "distribution": req.distribution,
        "t": req.t,
        "sf": round(sf, 8),
        "cdf": round(1.0 - sf, 8),
        "pdf": round(pdf, 8),
        "hf": round(hf, 8),
    }


@router.post("/calculate")
def calculate_metrics(req: CalculatorRequest):
    """Comprehensive life metrics for a specified distribution.

    Returns reliability/probability of failure and failure rate at the mission
    end time, conditional reliability/probability given an elapsed time, the
    mean life, the reliable life for a target reliability, and the BX% life.
    """
    dist = _build_distribution(req.distribution, req.params)

    def at(t):
        x = np.asarray([float(t)], dtype=float)
        return float(np.clip(dist._sf(x)[0], 0.0, 1.0))

    out: dict = {"distribution": req.distribution}

    # Mean life (always available).
    try:
        out["mean_life"] = _safe(float(dist.mean), 6)
    except Exception:
        out["mean_life"] = None

    if req.mission_end is not None and req.mission_end >= 0:
        x = np.asarray([float(req.mission_end)], dtype=float)
        sf = at(req.mission_end)
        out["reliability"] = round(sf, 8)
        out["prob_failure"] = round(1.0 - sf, 8)
        out["pdf"] = _safe(float(np.nan_to_num(dist._pdf(x)[0])), 8)
        out["failure_rate"] = _safe(float(np.nan_to_num(dist._hf(x)[0], posinf=0)), 8)

        # Conditional reliability given survival to `elapsed`.
        if req.elapsed is not None and req.elapsed >= 0:
            sf_elapsed = at(req.elapsed)
            if sf_elapsed > 0 and req.mission_end >= req.elapsed:
                cr = min(1.0, sf / sf_elapsed)
                out["conditional_reliability"] = round(cr, 8)
                out["conditional_prob_failure"] = round(1.0 - cr, 8)
            else:
                out["conditional_reliability"] = None
                out["conditional_prob_failure"] = None

    # Reliable life: time at which reliability = target (CDF = 1 - target).
    if req.reliability_target is not None and 0 < req.reliability_target < 1:
        try:
            out["reliable_life"] = _safe(float(dist.quantile(1.0 - req.reliability_target)), 6)
        except Exception:
            out["reliable_life"] = None

    # BX% life: time by which X% have failed (CDF = X/100).
    if req.bx_percent is not None and 0 < req.bx_percent < 100:
        try:
            out["bx_life"] = _safe(float(dist.quantile(req.bx_percent / 100.0)), 6)
            out["bx_percent"] = req.bx_percent
        except Exception:
            out["bx_life"] = None

    return out


@router.post("/spec-curves")
def spec_curves(req: SpecCurvesRequest):
    """PDF/CDF/SF/HF curves for a user-specified distribution (no data)."""
    dist = _build_distribution(req.distribution, req.params)
    lo = float(dist.quantile(0.001))
    hi = float(dist.quantile(0.999))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        raise HTTPException(status_code=400, detail="Could not determine a plotting range.")
    x = np.linspace(lo, hi, 300)
    return {
        "distribution": req.distribution,
        "curves": {
            "x": x.tolist(),
            "pdf": np.nan_to_num(dist._pdf(x)).tolist(),
            "cdf": np.nan_to_num(dist._cdf(x)).tolist(),
            "sf": np.nan_to_num(dist._sf(x)).tolist(),
            "hf": np.nan_to_num(dist._hf(x), posinf=0).tolist(),
        },
        "stats": {
            "mean": _safe(dist.mean),
            "median": _safe(dist.median),
            "std": _safe(dist.standard_deviation),
        },
    }


def _contour_grid(fit, dist_class, param_names, failures, rc, CI, n_grid=60):
    """NLL grid around the MLE for a 2-parameter likelihood contour."""
    p = np.asarray(fit._ci_params, dtype=float)
    cov = fit.covariance_matrix
    se = (np.sqrt(np.abs(np.diag(cov))) if cov is not None
          else np.abs(p) * 0.3)
    se = np.where(np.isfinite(se) & (se > 0), se, np.abs(p) * 0.3 + 1e-6)

    spans = 4.5 * se
    x_lo, x_hi = p[0] - spans[0], p[0] + spans[0]
    y_lo, y_hi = p[1] - spans[1], p[1] + spans[1]
    # Positive parameters stay positive (mu may be negative)
    if param_names[0] != 'mu':
        x_lo = max(x_lo, p[0] * 0.05)
    if param_names[1] != 'mu':
        y_lo = max(y_lo, p[1] * 0.05)

    xs = np.linspace(x_lo, x_hi, n_grid)
    ys = np.linspace(y_lo, y_hi, n_grid)
    z = np.empty((n_grid, n_grid))
    for j, yv in enumerate(ys):
        for i, xv in enumerate(xs):
            try:
                z[j, i] = negative_log_likelihood([xv, yv], dist_class, failures, rc)
            except Exception:
                z[j, i] = np.inf
    z[~np.isfinite(z)] = np.nan

    nll_mle = -fit.loglik
    level = nll_mle + ss.chi2.ppf(CI, df=2) / 2.0
    return {
        "x_name": param_names[0],
        "y_name": param_names[1],
        "x": xs.tolist(),
        "y": ys.tolist(),
        "nll": [[None if np.isnan(v) else round(float(v), 6) for v in row]
                for row in z],
        "level": round(float(level), 6),
        "point": [_safe(p[0]), _safe(p[1])],
    }


def _compare_extras(fit, failures: np.ndarray) -> dict:
    """Per-folio fitted curves plus P-P and Q-Q comparison points."""
    dist = fit.distribution
    sorted_f = np.sort(failures)
    n = len(sorted_f)
    # Blom plotting positions for the empirical probabilities.
    emp_p = (np.arange(1, n + 1) - 0.375) / (n + 0.25)

    out: dict = {}
    # Fitted function curves over a sensible range.
    lo = max(sorted_f.min() * 0.5, 1e-6)
    hi = sorted_f.max() * 1.5
    x = np.linspace(lo, hi, 200)
    try:
        out["curves"] = {
            "x": x.tolist(),
            "pdf": np.nan_to_num(dist._pdf(x)).tolist(),
            "cdf": np.nan_to_num(dist._cdf(x)).tolist(),
            "sf": np.nan_to_num(dist._sf(x)).tolist(),
            "hf": np.nan_to_num(dist._hf(x), posinf=0).tolist(),
        }
    except Exception:
        out["curves"] = None
    # P-P: theoretical CDF vs empirical CDF at the ordered failures.
    try:
        theo_cdf = np.clip(dist._cdf(sorted_f), 0, 1)
        out["pp"] = {"theoretical": theo_cdf.tolist(), "empirical": emp_p.tolist()}
    except Exception:
        out["pp"] = None
    # Q-Q: theoretical quantiles vs ordered failure times.
    try:
        theo_q = dist.quantile(emp_p)
        out["qq"] = {"theoretical": np.asarray(theo_q, dtype=float).tolist(),
                     "empirical": sorted_f.tolist()}
    except Exception:
        out["qq"] = None
    return out


@router.post("/compare")
def compare_folios(req: CompareRequest):
    """Compare folios: per-folio fits, likelihood-ratio test, likelihood
    contours (2-parameter distributions only), and per-folio curves + P-P/Q-Q
    comparison data."""
    if len(req.folios) < 2:
        raise HTTPException(status_code=400, detail="At least 2 folios are required.")
    if req.distribution not in _FITTER_MAP:
        raise HTTPException(status_code=400,
                            detail=f"Unknown distribution '{req.distribution}'.")
    if req.distribution not in _DIST_SPECS:
        raise HTTPException(status_code=400,
                            detail=f"Unsupported distribution '{req.distribution}'.")

    dist_class, param_names = _DIST_SPECS[req.distribution]
    fitter = _FITTER_MAP[req.distribution]

    folio_results = []
    all_failures, all_rc = [], []
    sum_separate_loglik = 0.0
    for folio in req.folios:
        failures = np.asarray(folio.failures, dtype=float)
        rc = (np.asarray(folio.right_censored, dtype=float)
              if folio.right_censored else None)
        if len(failures) < 2:
            raise HTTPException(
                status_code=400,
                detail=f"Folio '{folio.name}' needs at least 2 failure times.")
        all_failures.append(failures)
        if rc is not None:
            all_rc.append(rc)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                fit = fitter(failures=failures, right_censored=rc, CI=req.CI)
        except Exception as e:
            raise HTTPException(status_code=500,
                                detail=f"Fit failed for folio '{folio.name}': {e}")
        sum_separate_loglik += float(fit.loglik)

        entry = {
            "name": folio.name,
            "n_failures": int(len(failures)),
            "n_censored": int(len(rc)) if rc is not None else 0,
            "log_likelihood": _safe(fit.loglik, 4),
            "AICc": _safe(fit.AICc, 4),
            "params": _dist_params(fit, req.distribution),
            "contour": None,
        }
        if len(param_names) == 2:
            try:
                entry["contour"] = _contour_grid(
                    fit, dist_class, param_names, failures, rc, req.CI)
            except Exception:
                pass
        try:
            entry.update(_compare_extras(fit, failures))
        except Exception:
            pass
        folio_results.append(entry)

    # Likelihood-ratio test: common model vs separate models
    lr_test = None
    try:
        pooled_f = np.concatenate(all_failures)
        pooled_rc = np.concatenate(all_rc) if all_rc else None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            pooled_fit = fitter(failures=pooled_f, right_censored=pooled_rc, CI=req.CI)
        k = len(param_names)
        df = k * (len(req.folios) - 1)
        stat = 2.0 * (sum_separate_loglik - float(pooled_fit.loglik))
        stat = max(stat, 0.0)
        p_value = float(ss.chi2.sf(stat, df))
        alpha = 1 - req.CI
        lr_test = {
            "statistic": round(stat, 4),
            "df": df,
            "p_value": round(p_value, 6),
            "pooled_log_likelihood": _safe(pooled_fit.loglik, 4),
            "separate_log_likelihood": round(sum_separate_loglik, 4),
            "alpha": round(alpha, 4),
            "different": bool(p_value < alpha),
        }
    except HTTPException:
        raise
    except Exception:
        pass

    return {
        "distribution": req.distribution,
        "CI": req.CI,
        "param_names": param_names,
        "folios": folio_results,
        "lr_test": lr_test,
    }


@router.post("/stress-strength")
def stress_strength(req: StressStrengthRequest):
    """Stress-Strength interference: P(stress > strength)."""
    from scipy import integrate

    stress_dist = _build_distribution(req.stress_distribution, req.stress_params)
    strength_dist = _build_distribution(req.strength_distribution, req.strength_params)

    lo = min(float(stress_dist.quantile(1e-6)), float(strength_dist.quantile(1e-6)))
    hi = max(float(stress_dist.quantile(1 - 1e-6)), float(strength_dist.quantile(1 - 1e-6)))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        raise HTTPException(status_code=400, detail="Could not determine integration range.")

    p_failure, _ = integrate.quad(
        lambda t: float(stress_dist._pdf(np.array([t]))[0])
                  * float(strength_dist._cdf(np.array([t]))[0]),
        lo, hi, limit=200,
    )
    p_failure = float(np.clip(p_failure, 0, 1))

    # Narrower range for display curves (keeps the plot readable)
    plot_lo = min(float(stress_dist.quantile(0.001)), float(strength_dist.quantile(0.001)))
    plot_hi = max(float(stress_dist.quantile(0.999)), float(strength_dist.quantile(0.999)))
    x = np.linspace(plot_lo, plot_hi, 400)
    return {
        "probability_of_failure": round(p_failure, 8),
        "reliability": round(1 - p_failure, 8),
        "curves": {
            "x": x.tolist(),
            "stress_pdf": stress_dist._pdf(x).tolist(),
            "strength_pdf": strength_dist._pdf(x).tolist(),
        },
    }


def _fit_weibull_mixture_n(failures, rc, n_sub, CI):
    """Fit an N-subpopulation mixed Weibull via MLE (EM-like optimization).

    Parameters per subpopulation: eta_i, beta_i, proportion_i (last proportion
    is 1 - sum of others).  Total free parameters = 3*n_sub - 1.
    """
    from scipy.optimize import minimize
    from reliability.Utils import AICc as _AICc, BIC as _BIC
    from reliability.Special_models import _moment_init, _w_pdf, _w_sf, _safe_log
    import pandas as pd

    if len(failures) < 2 * n_sub:
        raise ValueError(f"At least {2 * n_sub} failures required for {n_sub}-component mixture.")

    sf = np.sort(failures)
    chunk = len(sf) // n_sub

    # Initial guesses: split sorted data into n_sub chunks
    x0 = []
    for i in range(n_sub):
        seg = sf[i * chunk : (i + 1) * chunk] if i < n_sub - 1 else sf[i * chunk:]
        a, b = _moment_init(seg)
        x0.extend([a, b])
    # Proportions for first (n_sub - 1) components
    for _ in range(n_sub - 1):
        x0.append(1.0 / n_sub)

    n_params = 2 * n_sub + (n_sub - 1)

    def _unpack(p):
        etas = [p[2 * i] for i in range(n_sub)]
        betas = [p[2 * i + 1] for i in range(n_sub)]
        props = list(p[2 * n_sub:])
        props.append(1.0 - sum(props))
        return etas, betas, props

    def neg_ll(p):
        etas, betas, props = _unpack(p)
        if any(e <= 0 for e in etas) or any(b <= 0 for b in betas):
            return np.inf
        if any(rho <= 0 or rho >= 1 for rho in props):
            return np.inf
        if abs(sum(props) - 1.0) > 1e-6:
            return np.inf

        pdf_mix = np.zeros_like(failures)
        for i in range(n_sub):
            pdf_mix += props[i] * _w_pdf(failures, etas[i], betas[i])
        ll = np.sum(_safe_log(pdf_mix))

        if rc is not None and len(rc) > 0:
            sf_mix = np.zeros_like(rc)
            for i in range(n_sub):
                sf_mix += props[i] * _w_sf(rc, etas[i], betas[i])
            ll += np.sum(_safe_log(sf_mix))

        return -ll if np.isfinite(ll) else np.inf

    # Bounds
    bounds = []
    for _ in range(n_sub):
        bounds.extend([(1e-6, None), (1e-6, None)])  # eta, beta
    for _ in range(n_sub - 1):
        bounds.append((1e-4, 1 - 1e-4))  # proportions

    res1 = minimize(neg_ll, x0, method='Nelder-Mead',
                    options={'maxiter': 20000, 'xatol': 1e-8, 'fatol': 1e-8})
    res2 = minimize(neg_ll, res1.x, method='L-BFGS-B', bounds=bounds)
    best = res2 if res2.fun < res1.fun else res1

    etas, betas, props = _unpack(best.x)

    # Sort components by eta for stable ordering
    order = sorted(range(n_sub), key=lambda i: etas[i])
    etas = [etas[i] for i in order]
    betas = [betas[i] for i in order]
    props = [props[i] for i in order]

    loglik = -best.fun
    n_total = len(failures) + (len(rc) if rc is not None else 0)
    aicc = _AICc(loglik, n_params, n_total)
    bic = _BIC(loglik, n_params, n_total)

    param_names = []
    param_values = []
    for i in range(n_sub):
        idx = i + 1
        param_names.extend([f'Alpha {idx}', f'Beta {idx}', f'Proportion {idx}'])
        param_values.extend([etas[i], betas[i], props[i]])

    results_df = pd.DataFrame({'Parameter': param_names, 'Value': param_values})

    class _MixtureResult:
        pass
    fit = _MixtureResult()
    fit.loglik = loglik
    fit.AICc = aicc
    fit.BIC = bic
    fit.results = results_df
    fit._etas = etas
    fit._betas = betas
    fit._props = props
    fit._n_sub = n_sub

    def SF(t):
        t = np.asarray(t, dtype=float)
        out = np.zeros_like(t)
        for i in range(n_sub):
            out += props[i] * _w_sf(t, etas[i], betas[i])
        return out

    def CDF(t):
        return 1.0 - SF(t)

    def PDF(t):
        t = np.asarray(t, dtype=float)
        out = np.zeros_like(t)
        for i in range(n_sub):
            out += props[i] * _w_pdf(t, etas[i], betas[i])
        return out

    def HF(t):
        p = PDF(t)
        s = SF(t)
        return np.where(s > 0, p / s, 0.0)

    fit.SF = SF
    fit.CDF = CDF
    fit.PDF = PDF
    fit.HF = HF

    return fit


@router.post("/special")
def fit_special_model(req: SpecialModelRequest):
    """Fit a special Weibull model and return parameters + SF/CDF/PDF curves."""
    failures = np.asarray(req.failures, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None
    model = req.model.lower()

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if model == "mixture":
                n_sub = max(2, min(4, req.n_subpopulations))
                if n_sub == 2:
                    fit = Fit_Weibull_Mixture(failures=failures, right_censored=rc, CI=req.CI)
                else:
                    fit = _fit_weibull_mixture_n(failures, rc, n_sub, req.CI)
            elif model in ("competing_risks", "cr"):
                fit = Fit_Weibull_CR(failures=failures, right_censored=rc, CI=req.CI)
            elif model == "dszi":
                fit = Fit_Weibull_DSZI(failures=failures, right_censored=rc, CI=req.CI)
            elif model == "ds":
                fit = Fit_Weibull_DS(failures=failures, right_censored=rc, CI=req.CI)
            elif model == "zi":
                fit = Fit_Weibull_ZI(failures=failures, right_censored=rc, CI=req.CI)
            elif model == "grouped":
                if not req.failure_quantities:
                    raise HTTPException(status_code=400,
                                        detail="grouped model requires failure_quantities.")
                fit = Fit_Weibull_2P_grouped(
                    failures=failures, failure_quantities=req.failure_quantities,
                    right_censored=rc, right_censored_quantities=req.right_censored_quantities,
                    CI=req.CI)
            else:
                raise HTTPException(status_code=400, detail=f"Unknown model '{req.model}'.")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    params = [{"name": str(p), "value": _safe(v)}
              for p, v in zip(fit.results["Parameter"], fit.results["Value"])]

    # Build display curves over a sensible x-range.
    pos = failures[failures > 0]
    hi = float(pos.max()) * 1.4 if len(pos) else 100.0
    x = np.linspace(max(hi / 500, 1e-3), hi, 300)
    curves = {"x": x.tolist()}
    try:
        if hasattr(fit, "SF"):
            curves["sf"] = np.asarray(fit.SF(x), dtype=float).tolist()
        if hasattr(fit, "CDF"):
            curves["cdf"] = np.asarray(fit.CDF(x), dtype=float).tolist()
        if hasattr(fit, "PDF"):
            curves["pdf"] = np.asarray(fit.PDF(x), dtype=float).tolist()
        if hasattr(fit, "HF"):
            curves["hf"] = np.asarray(fit.HF(x), dtype=float).tolist()
    except Exception:
        pass

    # For mixture models, include per-subpopulation curves
    sub_curves = None
    if model == "mixture":
        from reliability.Special_models import _w_pdf, _w_sf
        n_sub = getattr(fit, '_n_sub', 2)
        if n_sub == 2:
            etas = [fit.alpha_1, fit.alpha_2]
            betas = [fit.beta_1, fit.beta_2]
            props = [fit.proportion_1, fit.proportion_2]
        else:
            etas = fit._etas
            betas = fit._betas
            props = fit._props
        sub_curves = []
        for i in range(n_sub):
            sc = {
                "eta": _safe(etas[i]),
                "beta": _safe(betas[i]),
                "proportion": _safe(props[i]),
                "sf": np.asarray(_w_sf(x, etas[i], betas[i]), dtype=float).tolist(),
                "pdf": np.asarray(_w_pdf(x, etas[i], betas[i]), dtype=float).tolist(),
                "cdf": np.asarray(1.0 - _w_sf(x, etas[i], betas[i]), dtype=float).tolist(),
            }
            sub_curves.append(sc)

    result = {
        "model": model,
        "params": params,
        "loglik": _safe(getattr(fit, "loglik", None), 4),
        "AICc": _safe(getattr(fit, "AICc", None), 4),
        "BIC": _safe(getattr(fit, "BIC", None), 4),
        "curves": curves,
    }
    if sub_curves is not None:
        result["sub_curves"] = sub_curves
    return result


@router.post("/weibayes")
def weibayes(req: WeibayesRequest):
    """Weibayes fit: given a fixed beta, compute MLE of eta (and CI bounds).

    Supports both the standard case (r >= 1 failures) and the zero-failure
    case (r == 0), where a conservative lower bound on eta is returned instead.
    """
    from reliability.Bayesian import weibayes_fit

    failures = req.failures or []
    rc = req.right_censored or []
    if req.beta <= 0:
        raise HTTPException(status_code=400, detail="beta must be > 0.")
    if not (0 < req.CI < 1):
        raise HTTPException(status_code=400, detail="CI must be between 0 and 1.")

    all_times = [float(t) for t in failures] + [float(t) for t in rc]
    all_states = ['F'] * len(failures) + ['S'] * len(rc)

    if not all_times:
        raise HTTPException(status_code=400, detail="At least one time value required.")
    if any(t <= 0 for t in all_times):
        raise HTTPException(status_code=400, detail="All times must be > 0.")

    try:
        result = weibayes_fit(all_times, all_states, beta=req.beta, CI=req.CI)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    def _safe_list(lst):
        if lst is None:
            return None
        return [_safe(v, 6) if v is not None else None for v in lst]

    curves = result.get("curves", {})

    # Build a probability plot (scatter of failure median ranks + fitted line +
    # CI band) so the Weibayes view matches the parametric probability plot.
    prob_plot = None
    eta = result["eta"]
    beta = result["beta"]
    eta_lo = result["eta_lower"]
    eta_hi = result["eta_upper"]
    fail_times = [float(t) for t in failures]
    if eta and beta and len(fail_times) >= 2:
        class _WeibayesFit:
            """Minimal fit-like wrapper for the probability-plot helper."""
            distribution = Weibull_Distribution(eta=eta, beta=beta)

            def confidence_bounds(self, xvals=None, func="SF"):
                x = np.asarray(xvals, dtype=float)
                if not eta_lo or not eta_hi:
                    return x, None, None
                # Beta fixed: lower eta -> lower SF, upper eta -> higher SF.
                sf_lo = np.exp(-((x / eta_lo) ** beta))
                sf_hi = np.exp(-((x / eta_hi) ** beta))
                return x, sf_lo, sf_hi

        try:
            prob_plot = _probability_plot_data(
                _WeibayesFit(), "Weibull_2P",
                np.asarray(fail_times, dtype=float),
                [float(t) for t in rc] if rc else None,
            )
        except Exception:
            prob_plot = None

    return {
        "beta": _safe(result["beta"], 6),
        "eta": _safe(result["eta"], 6),
        "eta_lower": _safe(result["eta_lower"], 6),
        "eta_upper": _safe(result["eta_upper"], 6),
        "r": result["r"],
        "n_total": len(all_times),
        "sum_tb": _safe(result["sum_tb"], 6),
        "CI": req.CI,
        "zero_failure": result["zero_failure"],
        "probability": prob_plot,
        "curves": {
            "x": _safe_list(curves.get("x")),
            "sf": _safe_list(curves.get("sf")),
            "cdf": _safe_list(curves.get("cdf")),
            "pdf": _safe_list(curves.get("pdf")),
            "hf": _safe_list(curves.get("hf")),
            "sf_lower": _safe_list(curves.get("sf_lower")),
            "sf_upper": _safe_list(curves.get("sf_upper")),
            # CDF band is the complement of the SF band (swap lower/upper).
            "cdf_lower": _safe_list(
                [None if v is None else 1 - v for v in curves["sf_upper"]]
                if curves.get("sf_upper") else None),
            "cdf_upper": _safe_list(
                [None if v is None else 1 - v for v in curves["sf_lower"]]
                if curves.get("sf_lower") else None),
        },
    }


# ---------------------------------------------------------------------------
# Competing Failure Modes
# ---------------------------------------------------------------------------

# Map distribution name → fitter class
_CFM_FITTER = {
    'Weibull_2P': Fit_Weibull_2P,
    'Weibull_3P': Fit_Weibull_3P,
    'Exponential_1P': Fit_Exponential_1P,
    'Exponential_2P': Fit_Exponential_2P,
    'Normal_2P': Fit_Normal_2P,
    'Lognormal_2P': Fit_Lognormal_2P,
    'Lognormal_3P': Fit_Lognormal_3P,
    'Gamma_2P': Fit_Gamma_2P,
    'Loglogistic_2P': Fit_Loglogistic_2P,
    'Beta_2P': Fit_Beta_2P,
    'Gumbel_2P': Fit_Gumbel_2P,
}


@router.post("/competing-failure-modes")
def competing_failure_modes(req: CompetingFailureModesRequest):
    """Competing Failure Modes analysis.

    For each failure mode:
    - That mode's failures are treated as failures
    - All other modes' failures are treated as suspensions (right-censored)
    - Original suspensions are included as suspensions for ALL modes

    System reliability = product of per-mode reliabilities.
    """
    if req.distribution not in _CFM_FITTER:
        raise HTTPException(status_code=400,
                            detail=f"Distribution '{req.distribution}' not supported for CFM. "
                                   f"Available: {list(_CFM_FITTER)}")

    # Separate items into failures and suspensions
    all_failures = []  # (time, mode)
    all_suspensions = []  # time
    for item in req.items:
        if item.time <= 0:
            continue
        if item.state.upper() == 'S':
            all_suspensions.append(item.time)
        else:
            all_failures.append((item.time, item.mode))

    # Identify unique modes
    modes = sorted(set(m for _, m in all_failures))
    if len(modes) < 2:
        raise HTTPException(status_code=400,
                            detail="At least 2 distinct failure modes required for CFM analysis.")

    fitter_cls = _CFM_FITTER[req.distribution]
    dist_name = req.distribution

    mode_results = []
    mode_fits = {}  # mode -> fit object (for system reliability calc)

    for mode in modes:
        # This mode's failures
        mode_failures = np.array([t for t, m in all_failures if m == mode], dtype=float)
        # Other modes' failures become suspensions
        other_failures = np.array([t for t, m in all_failures if m != mode], dtype=float)
        mode_rc = np.concatenate([other_failures, np.array(all_suspensions, dtype=float)]) \
            if len(other_failures) > 0 or len(all_suspensions) > 0 else None
        if mode_rc is not None and len(mode_rc) == 0:
            mode_rc = None

        if len(mode_failures) < 2:
            mode_results.append({
                "mode": mode,
                "n_failures": len(mode_failures),
                "n_suspensions": len(mode_rc) if mode_rc is not None else 0,
                "error": f"Mode '{mode}' has fewer than 2 failures — cannot fit.",
                "params": {},
                "gof": {},
                "probability_plot": None,
                "curves": None,
            })
            continue

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                fit = fitter_cls(
                    failures=mode_failures,
                    right_censored=mode_rc,
                    method=req.method,
                    CI=req.CI,
                    show_probability_plot=False,
                )
        except Exception as e:
            mode_results.append({
                "mode": mode,
                "n_failures": len(mode_failures),
                "n_suspensions": len(mode_rc) if mode_rc is not None else 0,
                "error": str(e),
                "params": {},
                "gof": {},
                "probability_plot": None,
                "curves": None,
            })
            continue

        mode_fits[mode] = fit
        params = _dist_params(fit, dist_name)

        # GoF metrics
        gof = {}
        for attr in ('AICc', 'BIC', 'AD', 'loglik', 'loglik2'):
            if hasattr(fit, attr):
                v = getattr(fit, attr)
                gof[attr] = _safe(v)

        # Probability plot
        try:
            prob_plot = _probability_plot_data(fit, dist_name, mode_failures,
                                              mode_rc.tolist() if mode_rc is not None else None)
        except Exception:
            prob_plot = None

        # Curves
        try:
            curves = _distribution_curves(fit, mode_failures)
        except Exception:
            curves = None

        mode_results.append({
            "mode": mode,
            "n_failures": int(len(mode_failures)),
            "n_suspensions": int(len(mode_rc)) if mode_rc is not None else 0,
            "params": params,
            "gof": gof,
            "probability_plot": prob_plot,
            "curves": curves,
        })

    # --- System reliability: product of per-mode SFs ---
    system_curves = None
    system_reliability_at_t = None
    if len(mode_fits) >= 2:
        try:
            all_times = np.array([t for t, _ in all_failures] + all_suspensions, dtype=float)
            lo = all_times.min() * 0.5
            hi = all_times.max() * 1.5
            x = np.linspace(max(lo, 1e-6), hi, 300)

            system_sf = np.ones_like(x)
            mode_sf_curves = {}
            for mode, fit in mode_fits.items():
                sf_vals = fit.distribution._sf(x)
                system_sf *= sf_vals
                mode_sf_curves[mode] = sf_vals.tolist()

            system_curves = {
                "x": x.tolist(),
                "system_sf": system_sf.tolist(),
                "system_cdf": (1 - system_sf).tolist(),
                "mode_sf": mode_sf_curves,
            }

            if req.reliability_time is not None and req.reliability_time > 0:
                t_val = np.array([req.reliability_time])
                sys_r = 1.0
                mode_r = {}
                for mode, fit in mode_fits.items():
                    r_mode = float(fit.distribution._sf(t_val)[0])
                    mode_r[mode] = _safe(r_mode)
                    sys_r *= r_mode
                system_reliability_at_t = {
                    "time": req.reliability_time,
                    "system_reliability": _safe(sys_r),
                    "system_unreliability": _safe(1 - sys_r),
                    "mode_reliability": mode_r,
                }
        except Exception:
            pass

    return {
        "distribution": dist_name,
        "method": req.method,
        "CI": req.CI,
        "modes": mode_results,
        "system_curves": system_curves,
        "system_reliability_at_t": system_reliability_at_t,
    }
