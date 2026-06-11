"""Life Data Analysis router."""

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
from schemas import (
    LifeDataFitRequest, NonparametricRequest,
    GenerateRequest, SpecCurvesRequest, CompareRequest, EvaluateRequest,
)

# distribution name -> (Distribution class, ordered parameter names)
_DIST_SPECS = {
    'Weibull_2P': (Weibull_Distribution, ['alpha', 'beta']),
    'Weibull_3P': (Weibull_Distribution, ['alpha', 'beta', 'gamma']),
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
    for attr in ('alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda', 'alpha_1', 'alpha_2'):
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


@router.post("/evaluate")
def evaluate_distribution(req: EvaluateRequest):
    """SF/CDF of a specified distribution at time t (library links)."""
    if req.t < 0:
        raise HTTPException(status_code=400, detail="t must be >= 0.")
    dist = _build_distribution(req.distribution, req.params)
    x = np.asarray([req.t], dtype=float)
    sf = float(np.clip(dist._sf(x)[0], 0.0, 1.0))
    return {
        "distribution": req.distribution,
        "t": req.t,
        "sf": round(sf, 8),
        "cdf": round(1.0 - sf, 8),
    }


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


@router.post("/compare")
def compare_folios(req: CompareRequest):
    """Compare folios: per-folio fits, likelihood-ratio test, and
    likelihood contours (2-parameter distributions only)."""
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
