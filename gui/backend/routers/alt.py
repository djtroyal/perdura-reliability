"""Accelerated Life Testing router."""

import math
import sys
import warnings
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.ALT_fitters import Fit_Everything_ALT, ALL_SINGLE_STRESS_NAMES
from reliability.Reliability_testing import (
    sample_size_binomial, parametric_binomial_sample_size,
    parametric_binomial_test_time, binomial_oc_curve,
    one_sample_proportion, two_proportion_test, sample_size_no_failures,
    sequential_sampling_chart, reliability_test_planner,
    reliability_test_duration, chi_squared_test, KS_test,
)
from reliability.Fitters import (
    _FITTER_MAP, Fit_Weibull_2P, Fit_Normal_2P, Fit_Lognormal_2P,
    Fit_Exponential_1P, Fit_Gumbel_2P,
)
from schemas import (
    ALTFitRequest, SampleSizeRequest, AccelerationFactorRequest,
    OneSampleProportionRequest, TwoProportionRequest, NoFailuresRequest,
    SequentialSamplingRequest, TestPlannerRequest, TestDurationRequest,
    GoodnessOfFitRequest, PassProbRequest,
    StepStressRequest, HALTRequest, MarginTestRequest, MultiStressRequest,
    DegradationRequest, DestructiveDegradationRequest,
    ESSRequest, HASSRequest, BurnInRequest,
    ExpChiSquaredRDTRequest, BayesianRDTRequest, ExpectedFailureTimesRequest,
    DifferenceDetectionRequest, TestSimulationRequest,
)

router = APIRouter()


def _poisson_pass_prob(lam: float, c: int) -> float:
    """P(X <= c) where X ~ Poisson(lam). Returns a float in [0, 1]."""
    if lam <= 0.0:
        return 1.0
    if c < 0:
        return 0.0
    try:
        from scipy.stats import poisson as _poisson
        result = float(_poisson.cdf(c, lam))
    except ImportError:
        # Manual Poisson CDF sum
        exp_neg_lam = math.exp(-lam)
        total = 0.0
        power = 1.0
        for k in range(c + 1):
            if k > 0:
                power *= lam / k
            total += exp_neg_lam * power
        result = total
    # Guard against floating-point drift outside [0, 1]
    return max(0.0, min(1.0, result))


@router.post("/pass-probability")
def pass_probability(req: PassProbRequest):
    """Probability of passing a Poisson-model reliability demonstration test."""
    if req.test_duration <= 0:
        raise HTTPException(status_code=400, detail="test_duration must be > 0.")
    if req.true_mtbf <= 0:
        raise HTTPException(status_code=400, detail="true_mtbf must be > 0.")
    if req.allowable_failures < 0:
        raise HTTPException(status_code=400, detail="allowable_failures must be >= 0.")

    lam = req.test_duration / req.true_mtbf
    p_pass = _poisson_pass_prob(lam, req.allowable_failures)

    oc_curve = None
    if req.oc_mtbf_min is not None and req.oc_mtbf_max is not None:
        if req.oc_mtbf_min <= 0 or req.oc_mtbf_max <= 0:
            raise HTTPException(status_code=400, detail="OC curve MTBF bounds must be > 0.")
        mtbf_vals = np.linspace(req.oc_mtbf_min, req.oc_mtbf_max, max(2, req.oc_points))
        p_pass_vals = []
        for m in mtbf_vals:
            lam_i = req.test_duration / float(m)
            p_i = _poisson_pass_prob(lam_i, req.allowable_failures)
            p_pass_vals.append(p_i if math.isfinite(p_i) else None)
        oc_curve = {
            "mtbf": mtbf_vals.tolist(),
            "p_pass": p_pass_vals,
        }

    return {
        "test_duration": req.test_duration,
        "allowable_failures": req.allowable_failures,
        "true_mtbf": req.true_mtbf,
        "lambda": lam,
        "p_pass": p_pass,
        "oc_curve": oc_curve,
    }


@router.post("/one-sample-proportion")
def one_sample_proportion_ep(req: OneSampleProportionRequest):
    try:
        return one_sample_proportion(req.trials, req.successes, CI=req.CI)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/two-proportion-test")
def two_proportion_ep(req: TwoProportionRequest):
    try:
        return two_proportion_test(req.trials_1, req.successes_1,
                                   req.trials_2, req.successes_2, CI=req.CI)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sample-size-no-failures")
def no_failures_ep(req: NoFailuresRequest):
    try:
        return sample_size_no_failures(req.reliability, CI=req.CI,
                                       lifetimes=req.lifetimes,
                                       weibull_shape=req.weibull_shape)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sequential-sampling")
def sequential_sampling_ep(req: SequentialSamplingRequest):
    try:
        return sequential_sampling_chart(req.p1, req.p2, req.alpha, req.beta,
                                         max_samples=req.max_samples)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/test-planner")
def test_planner_ep(req: TestPlannerRequest):
    try:
        return reliability_test_planner(
            MTBF=req.MTBF, test_duration=req.test_duration,
            number_of_failures=req.number_of_failures,
            CI=req.CI, two_sided=req.two_sided)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/test-duration")
def test_duration_ep(req: TestDurationRequest):
    try:
        return reliability_test_duration(
            req.MTBF_required, req.MTBF_design,
            req.consumer_risk, req.producer_risk)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/goodness-of-fit")
def goodness_of_fit_ep(req: GoodnessOfFitRequest):
    """Fit the chosen distribution, then run a chi-squared or KS GoF test."""
    if req.distribution not in _FITTER_MAP:
        raise HTTPException(status_code=400,
                            detail=f"Unknown distribution '{req.distribution}'.")
    failures = np.asarray(req.failures, dtype=float)
    if len(failures) < 5:
        raise HTTPException(status_code=400,
                            detail="At least 5 failures are required.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fit = _FITTER_MAP[req.distribution](failures=failures)
        dist = fit.distribution
        if req.test == "ks":
            res = KS_test(dist, failures, CI=req.CI)
            res["test"] = "Kolmogorov-Smirnov"
        else:
            res = chi_squared_test(dist, failures, CI=req.CI)
            res["test"] = "Chi-squared"
        res["distribution"] = req.distribution
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _build_life_stress_plot(model, s_range, obs_stress, obs_life, use_level_stress):
    """Build life-stress plot data (model line + observed scatter + use level)
    for a single fitted ALT model. Returns None if the model can't be evaluated."""
    try:
        line_life = []
        for s in s_range:
            try:
                line_life.append(float(model.life_at_stress(float(s))))
            except Exception:
                line_life.append(None)

        use_level_life = None
        if use_level_stress is not None:
            try:
                use_level_life = float(model.life_at_stress(float(use_level_stress)))
            except Exception:
                use_level_life = None

        return {
            "line_stress": s_range.tolist(),
            "line_life": line_life,
            "scatter_stress": obs_stress,
            "scatter_life": obs_life,
            "use_level_stress": use_level_stress,
            "use_level_life": use_level_life,
        }
    except Exception:
        return None


@router.post("/fit")
def fit_alt(req: ALTFitRequest):
    failures = np.asarray(req.failures, dtype=float)
    stresses = np.asarray(req.failure_stress, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None
    rc_stress = np.asarray(req.right_censored_stress, dtype=float) if req.right_censored_stress else None

    if len(failures) < 4:
        raise HTTPException(status_code=400, detail="At least 4 failure times required for ALT.")

    if len(failures) != len(stresses):
        raise HTTPException(status_code=400,
                            detail="failures and failure_stress must have the same length.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fe = Fit_Everything_ALT(
                failures=failures,
                failure_stress=stresses,
                right_censored=rc,
                right_censored_stress=rc_stress,
                use_level_stress=req.use_level_stress,
                models_to_fit=req.models_to_fit,
                sort_by=req.sort_by,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    results = []
    for _, row in fe.results.iterrows():
        entry = {k: (None if (isinstance(v, float) and np.isinf(v)) else
                     (round(v, 4) if isinstance(v, float) else v))
                 for k, v in row.items()}
        results.append(entry)

    # Life-stress plot data for every successfully-fitted model, so the user can
    # click through the results table and inspect each model's fit (the best
    # model is also surfaced singly for backwards compatibility).
    life_stress_plots = {}
    life_stress_plot = None
    fitted = getattr(fe, "fitted", None) or {}
    if fitted:
        unique_stresses = np.unique(stresses)
        lo = float(unique_stresses.min()) * 0.8
        hi = float(unique_stresses.max()) * 1.2
        # Extend the range toward the use-level stress (typically below the
        # tested range) so the extrapolation to it is visible on the plot.
        if req.use_level_stress is not None:
            lo = min(lo, float(req.use_level_stress) * 0.95)
            hi = max(hi, float(req.use_level_stress) * 1.05)
        s_range = np.linspace(lo, hi, 100)

        # Observed median lives per stress level (shared by every model's plot).
        obs_stress = []
        obs_life = []
        for s in unique_stresses:
            mask = stresses == s
            obs_stress.append(float(s))
            obs_life.append(float(np.median(failures[mask])))

        for name, model in fitted.items():
            life_stress_plots[name] = _build_life_stress_plot(
                model, s_range, obs_stress, obs_life, req.use_level_stress)

        life_stress_plot = life_stress_plots.get(fe.best_model_name)

    return {
        "results": results,
        "best_model": fe.best_model_name,
        "life_stress_plot": life_stress_plot,
        "life_stress_plots": life_stress_plots,
        "available_models": list(ALL_SINGLE_STRESS_NAMES),
    }


@router.get("/models")
def list_models():
    return {"models": list(ALL_SINGLE_STRESS_NAMES)}


@router.post("/sample-size")
def sample_size(req: SampleSizeRequest):
    """Binomial reliability demonstration test planner.

    Method 1 (nonparametric) solves the binomial equation for sample size.
    Method 2A/2B use a Weibull shape parameter to trade test time against
    samples; both report eta and the reliability demonstrated at test time.
    """
    parametric = req.method in ("parametric_samples", "parametric_time")
    if parametric and (req.mission_time is None or req.beta is None):
        raise HTTPException(status_code=400,
                            detail="mission_time and beta are required for parametric methods.")

    try:
        out = {"method": req.method, "failures": req.failures,
               "R": req.R, "CI": req.CI,
               "n": None, "test_time": None, "eta": None, "R_test": None}

        if req.method == "nonparametric":
            out["n"] = sample_size_binomial(req.R, CI=req.CI, failures=req.failures)
            oc_n, demonstrated_R = out["n"], req.R
        elif req.method == "parametric_samples":
            if req.test_time is None:
                raise ValueError("test_time is required for Method 2A.")
            res = parametric_binomial_sample_size(
                req.R, req.mission_time, req.beta, req.test_time,
                CI=req.CI, failures=req.failures)
            out.update(n=res["n"], eta=round(res["eta"], 4),
                       R_test=round(res["R_test"], 6))
            oc_n, demonstrated_R = res["n"], res["R_test"]
        elif req.method == "parametric_time":
            if req.n is None:
                raise ValueError("n is required for Method 2B.")
            res = parametric_binomial_test_time(
                req.R, req.mission_time, req.beta, req.n,
                CI=req.CI, failures=req.failures)
            out.update(n=req.n, test_time=round(res["T_test"], 4),
                       eta=round(res["eta"], 4), R_test=round(res["R_test"], 6))
            oc_n, demonstrated_R = req.n, res["R_test"]
        else:
            raise ValueError(f"Unknown method: '{req.method}'")

        if req.options_table:
            rows = []
            for f in range(16):
                row = {"f": f}
                try:
                    if req.method == "nonparametric":
                        row["n"] = sample_size_binomial(req.R, CI=req.CI, failures=f)
                    elif req.method == "parametric_samples":
                        row["n"] = parametric_binomial_sample_size(
                            req.R, req.mission_time, req.beta, req.test_time,
                            CI=req.CI, failures=f)["n"]
                    else:  # parametric_time: fixed n, vary f (needs n > f)
                        if req.n >= f + 1:
                            row["test_time"] = round(parametric_binomial_test_time(
                                req.R, req.mission_time, req.beta, req.n,
                                CI=req.CI, failures=f)["T_test"], 2)
                        else:
                            row["test_time"] = None
                except ValueError:
                    row["n" if req.method != "parametric_time" else "test_time"] = None
                rows.append(row)
            out["options_table"] = rows

        if req.oc_curve:
            R_vals, P_acc = binomial_oc_curve(oc_n, failures=req.failures)
            out["oc_curve"] = {
                "R": np.round(R_vals, 6).tolist(),
                "P_accept": np.round(P_acc, 6).tolist(),
                "R_demonstrated": round(float(demonstrated_R), 6),
                "alpha": round(1 - req.CI, 6),
            }

        return out
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/acceleration-factor")
def acceleration_factor(req: AccelerationFactorRequest):
    """Compute acceleration factor between test and use stress levels."""
    model = req.model.lower()
    s_test = req.stress_test
    s_use = req.stress_use

    if model == "arrhenius":
        Ea = float(req.params.get("Ea", 0.7))
        k = 8.617e-5
        T_test = s_test + 273.15
        T_use = s_use + 273.15
        if T_test <= 0 or T_use <= 0:
            raise HTTPException(status_code=400, detail="Temperatures must be > -273.15°C.")
        AF = float(np.exp((Ea / k) * (1.0 / T_use - 1.0 / T_test)))
    elif model == "inverse_power":
        n = float(req.params.get("n", 2))
        if s_use <= 0:
            raise HTTPException(status_code=400, detail="Use stress must be > 0.")
        AF = float((s_test / s_use) ** n)
    elif model == "eyring":
        A = float(req.params.get("A", 1))
        T_test = s_test + 273.15
        T_use = s_use + 273.15
        if T_test <= 0 or T_use <= 0:
            raise HTTPException(status_code=400, detail="Temperatures must be > -273.15°C.")
        AF = float(np.exp(A * (1.0 / T_use - 1.0 / T_test)))
    elif model == "coffin_manson":
        # Thermal-cycling fatigue: stress = thermal cycle range ΔT.
        n = float(req.params.get("n", 2.0))
        if s_use <= 0:
            raise HTTPException(status_code=400, detail="Use ΔT must be > 0.")
        AF = float((s_test / s_use) ** n)
    elif model == "peck":
        # Temperature-Humidity (Peck): stress_test/use are temperatures (°C).
        k = 8.617e-5
        n = float(req.params.get("n", 2.7))
        Ea = float(req.params.get("Ea", 0.79))
        RH_test = float(req.params.get("RH_test", 85.0))
        RH_use = float(req.params.get("RH_use", 40.0))
        T_test = s_test + 273.15
        T_use = s_use + 273.15
        if T_test <= 0 or T_use <= 0 or RH_use <= 0:
            raise HTTPException(status_code=400, detail="Invalid temperature/humidity inputs.")
        AF = float((RH_test / RH_use) ** n * np.exp((Ea / k) * (1.0 / T_use - 1.0 / T_test)))
    elif model == "norris_landzberg":
        # Solder-joint thermal cycling: stress_test/use are cycle ranges ΔT.
        k = 8.617e-5
        n = float(req.params.get("n", 1.9))
        m = float(req.params.get("m", 1.0 / 3.0))
        Ea = float(req.params.get("Ea", 0.122))
        f_test = float(req.params.get("f_test", 48.0))
        f_use = float(req.params.get("f_use", 2.0))
        Tmax_test = float(req.params.get("Tmax_test", 100.0)) + 273.15
        Tmax_use = float(req.params.get("Tmax_use", 60.0)) + 273.15
        if s_use <= 0 or f_test <= 0 or Tmax_use <= 0 or Tmax_test <= 0:
            raise HTTPException(status_code=400, detail="Invalid Norris-Landzberg inputs.")
        AF = float((s_test / s_use) ** n * (f_use / f_test) ** m
                   * np.exp((Ea / k) * (1.0 / Tmax_use - 1.0 / Tmax_test)))
    elif model == "black":
        # Electromigration (Black's equation): stress_test/use are temperatures (°C).
        k = 8.617e-5
        n = float(req.params.get("n", 2.0))
        Ea = float(req.params.get("Ea", 0.7))
        J_test = float(req.params.get("J_test", 2.0))
        J_use = float(req.params.get("J_use", 1.0))
        T_test = s_test + 273.15
        T_use = s_use + 273.15
        if T_test <= 0 or T_use <= 0 or J_use <= 0:
            raise HTTPException(status_code=400, detail="Invalid temperature/current-density inputs.")
        AF = float((J_test / J_use) ** n * np.exp((Ea / k) * (1.0 / T_use - 1.0 / T_test)))
    else:
        raise HTTPException(status_code=400,
                            detail=f"Unknown model '{model}'. Use: arrhenius, inverse_power, "
                                   "eyring, coffin_manson, peck, norris_landzberg, black.")

    return {
        "model": model,
        "stress_test": s_test,
        "stress_use": s_use,
        "acceleration_factor": round(AF, 4),
    }


# ---------------------------------------------------------------------------
# Life-distribution fitting helper (shared by degradation analysis)
# ---------------------------------------------------------------------------

# Candidate life distributions tried in "Best_Fit" (auto-select) mode, ranked
# by AICc — the same family the LDA module compares.
_DEG_DIST_CANDIDATES = [
    "Weibull_2P", "Weibull_3P", "Normal_2P", "Lognormal_2P", "Lognormal_3P",
    "Exponential_1P", "Gumbel_2P", "Gamma_2P", "Loglogistic_2P",
]


def _life_dist_params(fit, dist_name):
    """Map a fitted distribution's attributes to a flat parameter dict."""
    if dist_name in ("Normal_2P", "Lognormal_2P", "Lognormal_3P", "Gumbel_2P"):
        p = {"mu": float(fit.mu), "sigma": float(fit.sigma)}
    elif dist_name in ("Exponential_1P", "Exponential_2P"):
        p = {"Lambda": float(fit.Lambda)}
    elif dist_name in ("Gamma_2P", "Gamma_3P", "Loglogistic_2P", "Loglogistic_3P"):
        p = {"alpha": float(fit.alpha), "beta": float(fit.beta)}
    else:  # Weibull_2P / Weibull_3P
        p = {"alpha": float(fit.eta), "beta": float(fit.beta)}
    if dist_name.endswith("3P") and getattr(fit, "gamma", None) is not None:
        p["gamma"] = float(fit.gamma)
    return p


def _life_dist_gof(fit):
    """Extract goodness-of-fit metrics (AICc, BIC, AD, LogLik) from a fit."""
    out = {}
    for key, attr in (("AICc", "AICc"), ("BIC", "BIC"),
                      ("AD", "AD"), ("LogLik", "loglik")):
        v = getattr(fit, attr, None)
        out[key] = (round(float(v), 4)
                    if v is not None and np.isfinite(v) else None)
    return out


def _fit_life_distribution(times, dist_name, reliability_time=None,
                           right_censored=None):
    """Fit a life distribution to projected failure (and suspension) times.

    ``dist_name`` may be a specific distribution (e.g. "Weibull_2P") or
    "Best_Fit" / "auto" to fit every candidate distribution and select the one
    with the lowest AICc. Returns a dict with the fitted parameters, curve
    data, summary percentiles (mean, median, B10, B50) and goodness-of-fit
    metrics. In Best_Fit mode a ranked ``comparison`` list is included. When
    ``reliability_time`` is given, also returns R(t) and F(t). Raises
    ValueError on bad input.
    """
    arr = np.asarray([t for t in times if t is not None and np.isfinite(t) and t > 0],
                     dtype=float)
    if len(arr) < 2:
        raise ValueError("Need at least 2 valid projected failure times to fit a distribution.")
    rc = None
    if right_censored:
        rc = np.asarray([t for t in right_censored if t is not None and np.isfinite(t) and t > 0],
                        dtype=float)
        if len(rc) == 0:
            rc = None

    auto = dist_name in ("Best_Fit", "auto")
    candidates = _DEG_DIST_CANDIDATES if auto else [dist_name]

    fitted = []  # list of (name, fit)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for name in candidates:
            fitter = _FITTER_MAP.get(name)
            if fitter is None:
                continue
            try:
                fit = fitter(failures=arr, right_censored=rc,
                             show_probability_plot=False)
                # Touch the params so a bad fit raises here, not later.
                _life_dist_params(fit, name)
                fitted.append((name, fit))
            except Exception:
                continue

    if not fitted:
        raise ValueError("Could not fit any life distribution to the projected times.")

    def _aicc(f):
        v = getattr(f, "AICc", None)
        return float(v) if (v is not None and np.isfinite(v)) else float("inf")

    fitted.sort(key=lambda nf: _aicc(nf[1]))
    best_name, fit = fitted[0]
    params = _life_dist_params(fit, best_name)
    dist = fit.distribution

    xmax = float(arr.max()) * 1.5
    xs = np.linspace(max(1e-6, float(arr.min()) * 0.3), xmax, 200)
    pdf = dist.PDF(xvals=xs, show_plot=False)
    cdf = dist.CDF(xvals=xs, show_plot=False)

    def _pct(p):
        """Time by which fraction p of the population has failed (inverse CDF)."""
        try:
            return float(dist.quantile(p))
        except Exception:
            return None

    summary = {
        "mean": float(dist.mean),
        "median": _pct(0.5),
        "B10": _pct(0.10),
        "B50": _pct(0.50),
    }
    out = {
        "distribution": best_name,
        "params": params,
        "curve_x": xs.tolist(),
        "pdf": np.asarray(pdf, dtype=float).tolist(),
        "cdf": np.asarray(cdf, dtype=float).tolist(),
        "summary": summary,
        "gof": _life_dist_gof(fit),
    }
    if auto:
        out["comparison"] = [
            {"distribution": name, **_life_dist_gof(f)} for name, f in fitted
        ]
    if reliability_time is not None and reliability_time > 0:
        try:
            R = float(dist.SF(xvals=np.asarray([reliability_time]))[0])
            out["reliability"] = {"time": reliability_time,
                                  "R": max(0.0, min(1.0, R)),
                                  "F": max(0.0, min(1.0, 1.0 - R))}
        except Exception:
            pass
    return out


# ---------------------------------------------------------------------------
# Degradation-model registry (shared by non-destructive analysis)
# ---------------------------------------------------------------------------
# Following the ReliaSoft reference, the linearisable models are fitted by
# ordinary least squares on the transformed variables (e.g. ln(y) vs x), which
# both matches the reference point estimates and supplies the LS covariance
# used for the extrapolated-interval (delta-method) bounds. Gompertz has no
# clean linear form and is fitted nonlinearly.
#
# Each linearisable model exposes:
#   tx(x)     transform of time used in the regression
#   ty(y)     transform of the measurement used in the regression
#   ty_inv(v) inverse of ty (to map the fitted line back to measurement space)
#   tx_inv(g) inverse of tx (to map a transformed crossing point to a time)
#   ab(slope, intercept) -> (a, b) in the reference parameterisation
#   xpos      whether time must be > 0 (log/inverse transforms)

_LINEARISABLE = {
    "linear": dict(  # y = a x + b
        tx=lambda x: x, ty=lambda y: y, ty_inv=lambda v: v, tx_inv=lambda g: g,
        ab=lambda s, i: (s, i), xpos=False),
    "exponential": dict(  # y = b e^(a x)
        tx=lambda x: x, ty=lambda y: np.log(y), ty_inv=lambda v: np.exp(v),
        tx_inv=lambda g: g, ab=lambda s, i: (s, math.exp(i)), xpos=False),
    "power": dict(  # y = b x^a
        tx=lambda x: np.log(np.maximum(x, 1e-12)), ty=lambda y: np.log(y),
        ty_inv=lambda v: np.exp(v), tx_inv=lambda g: math.exp(g),
        ab=lambda s, i: (s, math.exp(i)), xpos=True),
    "logarithmic": dict(  # y = a ln(x) + b
        tx=lambda x: np.log(np.maximum(x, 1e-12)), ty=lambda y: y, ty_inv=lambda v: v,
        tx_inv=lambda g: math.exp(g), ab=lambda s, i: (s, i), xpos=True),
    "lloyd_lipow": dict(  # y = a - b/x  ->  y = intercept + slope*(1/x), b=-slope
        tx=lambda x: 1.0 / np.maximum(x, 1e-12), ty=lambda y: y, ty_inv=lambda v: v,
        tx_inv=lambda g: (1.0 / g if g != 0 else None),
        ab=lambda s, i: (i, -s), xpos=True),
}


def _fit_degradation_unit(t, y, thr, model_name):
    """Fit a single unit's degradation path and project the failure time.

    Returns dict with predict (callable), t_fail, r2, se_tfail, a, b (None on
    failure). Linearisable models use OLS on transformed variables; Gompertz
    uses nonlinear least squares.
    """
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)

    if model_name == "gompertz":
        return _fit_gompertz_unit(t, y, thr)

    spec = _LINEARISABLE.get(model_name)
    if spec is None or len(t) < 2:
        return None
    try:
        if spec["xpos"]:
            mask = t > 0
            t, y = t[mask], y[mask]
            if len(t) < 2:
                return None
        TX = np.asarray(spec["tx"](t), dtype=float)
        TY = np.asarray(spec["ty"](y), dtype=float)
        if not (np.all(np.isfinite(TX)) and np.all(np.isfinite(TY))):
            return None
        coeffs, cov = np.polyfit(TX, TY, 1, cov=True)  # [slope, intercept]
        slope, intercept = float(coeffs[0]), float(coeffs[1])
        if slope == 0:
            return None

        def predict(x):
            xv = np.asarray(x, dtype=float)
            return spec["ty_inv"](slope * np.asarray(spec["tx"](xv)) + intercept)

        Y0 = float(spec["ty"](np.asarray([thr]))[0])
        g = (Y0 - intercept) / slope          # crossing point in tx-space
        tf = spec["tx_inv"](g)
        t_fail = float(tf) if (tf is not None and np.isfinite(tf) and tf > 0) else None

        # r² in the original measurement space.
        yhat = np.asarray(predict(t), dtype=float)
        ss_res = float(np.sum((y - yhat) ** 2))
        ss_tot = float(np.sum((y - np.mean(y)) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0

        # Delta-method SE on t_fail using the LS covariance of (slope, intercept).
        se = None
        if t_fail is not None and np.all(np.isfinite(cov)):
            # g = (Y0 - intercept)/slope
            dg_dslope = -(Y0 - intercept) / (slope ** 2)
            dg_dintercept = -1.0 / slope
            J = np.array([dg_dslope, dg_dintercept])
            var_g = float(J @ cov @ J)
            # t_fail = tx_inv(g); chain rule for dt/dg.
            eps = 1e-6 * (abs(g) + 1e-6)
            tu, td = spec["tx_inv"](g + eps), spec["tx_inv"](g - eps)
            if tu is not None and td is not None and np.isfinite(tu) and np.isfinite(td):
                dtf_dg = (tu - td) / (2.0 * eps)
                var = (dtf_dg ** 2) * var_g
                if np.isfinite(var) and var >= 0:
                    se = math.sqrt(var)

        a, b = spec["ab"](slope, intercept)
        return {"predict": predict, "t_fail": t_fail, "r2": r2, "se": se,
                "a": float(a), "b": float(b)}
    except Exception:
        return None


def _fit_gompertz_unit(t, y, thr):
    """Nonlinear fit of the Gompertz model y = a·b^(c^x) for one unit."""
    from scipy.optimize import curve_fit

    if len(t) < 3:
        return None

    def f(x, a, b, c):
        return a * np.power(np.maximum(b, 1e-12), np.power(np.maximum(c, 1e-12), x))

    def solve(p, level):
        a, b, c = p
        try:
            if a == 0 or b <= 0 or c <= 0 or c == 1:
                return None
            inner = math.log(level / a) / math.log(b)
            if inner <= 0:
                return None
            return math.log(inner) / math.log(c)
        except Exception:
            return None

    try:
        a0 = float(np.max(y)) * 1.05 if np.mean(np.diff(y)) >= 0 else float(np.min(y)) * 0.95
        popt, pcov = curve_fit(f, t, y, p0=[a0 or 1.0, 0.5, 0.9], maxfev=20000)
        predict = lambda x: f(np.asarray(x, dtype=float), *popt)
        tf = solve(popt, thr)
        t_fail = float(tf) if (tf is not None and np.isfinite(tf) and tf > 0) else None
        yhat = np.asarray(predict(t), dtype=float)
        ss_res = float(np.sum((y - yhat) ** 2))
        ss_tot = float(np.sum((y - np.mean(y)) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
        se = None
        if t_fail is not None and np.all(np.isfinite(pcov)):
            grad = np.zeros(3); ok = True
            for k in range(3):
                step = 1e-4 * (abs(popt[k]) + 1e-6)
                pu, pd = popt.copy(), popt.copy()
                pu[k] += step; pd[k] -= step
                tu, td = solve(pu, thr), solve(pd, thr)
                if tu is None or td is None:
                    ok = False; break
                grad[k] = (tu - td) / (2.0 * step)
            if ok:
                var = float(grad @ pcov @ grad)
                if np.isfinite(var) and var >= 0:
                    se = math.sqrt(var)
        return {"predict": predict, "t_fail": t_fail, "r2": r2, "se": se,
                "a": float(popt[0]), "b": float(popt[1]), "c": float(popt[2])}
    except Exception:
        return None


@router.post("/degradation")
def degradation(req: DegradationRequest):
    """Non-destructive degradation: fit per-unit paths, project failure times."""
    from scipy.stats import norm

    n = len(req.times)
    if not (len(req.unit_ids) == len(req.measurements) == n) or n < 2:
        raise HTTPException(status_code=400,
                            detail="unit_ids, times and measurements must be equal-length (>=2).")

    if req.degradation_model not in _LINEARISABLE and req.degradation_model != "gompertz":
        raise HTTPException(status_code=400,
                            detail=f"Unknown degradation model '{req.degradation_model}'.")

    # Group measurements by unit, preserving order.
    groups: dict = {}
    for uid, t, m in zip(req.unit_ids, req.times, req.measurements):
        groups.setdefault(str(uid), {"t": [], "m": []})
        groups[str(uid)]["t"].append(float(t))
        groups[str(uid)]["m"].append(float(m))

    thr = req.threshold
    z = float(norm.ppf(1.0 - (1.0 - req.ci) / 2.0))

    paths = []
    projected = []           # point estimates of failure time
    lower_times = []         # for extrapolated-interval suspensions
    upper_times = []
    unit_table = []
    for uid, g in groups.items():
        fit = _fit_degradation_unit(g["t"], g["m"], thr, req.degradation_model)
        path = {"unit_id": uid, "t": g["t"], "m": g["m"], "fit_t": None, "fit_m": None}
        if fit is not None:
            t_fail, r2, se = fit["t_fail"], fit["r2"], fit["se"]
            tmax = max(g["t"]) if g["t"] else 1.0
            extend_to = max(tmax, t_fail if t_fail else tmax) * 1.05
            xs = np.linspace(min(g["t"]), extend_to, 50)
            path["fit_t"] = xs.tolist()
            path["fit_m"] = np.asarray(fit["predict"](xs), dtype=float).tolist()
            lo = up = None
            if t_fail is not None:
                projected.append(t_fail)
                if se is not None and se > 0:
                    lo = max(1e-9, t_fail - z * se)
                    up = t_fail + z * se
                    lower_times.append(lo)
                    upper_times.append(up)
            unit_table.append({
                "unit_id": uid,
                "projected_failure": (round(t_fail, 4) if t_fail else None),
                "lower": (round(lo, 4) if lo else None),
                "upper": (round(up, 4) if up else None),
                "a": round(fit["a"], 6), "b": round(fit["b"], 6),
                "r2": round(r2, 4),
            })
        else:
            unit_table.append({"unit_id": uid, "projected_failure": None,
                               "lower": None, "upper": None,
                               "a": None, "b": None, "r2": None})
        paths.append(path)

    dist_fit = None
    if len(projected) >= 2:
        try:
            # With extrapolated intervals, the lower bounds act as suspensions
            # and the upper bounds as failures, widening the life-time fit to
            # reflect parameter uncertainty in the extrapolation.
            rc = lower_times if (req.use_extrapolated_intervals and lower_times) else None
            fail_times = (upper_times if (req.use_extrapolated_intervals and upper_times)
                          else projected)
            dist_fit = _fit_life_distribution(
                fail_times, req.life_distribution,
                reliability_time=req.reliability_time, right_censored=rc)
        except ValueError:
            dist_fit = None

    return {
        "paths": paths,
        "threshold": thr,
        "threshold_direction": req.threshold_direction,
        "degradation_model": req.degradation_model,
        "projected_failure_times": [round(p, 4) for p in projected],
        "distribution_fit": dist_fit,
        "unit_table": unit_table,
        "use_extrapolated_intervals": req.use_extrapolated_intervals,
        "ci": req.ci,
    }


# ---------------------------------------------------------------------------
# Destructive degradation analysis — distribution-of-measurement MLE
# ---------------------------------------------------------------------------
# The measurement at each time follows a distribution whose (log-)location
# parameter changes with time per a degradation model, while the shape stays
# constant (analogous to ALTA with time as the "stress"). Parameters are
# estimated jointly by MLE.

def _destructive_location_fn(model_name):
    """Return loc(params, t) for the degradation models supported destructively."""
    funcs = {
        "linear": lambda p, t: p[0] * t + p[1],
        "exponential": lambda p, t: p[1] * np.exp(p[0] * t),
        "power": lambda p, t: p[1] * np.power(np.maximum(t, 1e-12), p[0]),
        "logarithm": lambda p, t: p[0] * np.log(np.maximum(t, 1e-12)) + p[1],
        "logarithmic": lambda p, t: p[0] * np.log(np.maximum(t, 1e-12)) + p[1],
        "lloyd_lipow": lambda p, t: p[0] - p[1] / np.maximum(t, 1e-12),
    }
    return funcs.get(model_name)


@router.post("/degradation-destructive")
def degradation_destructive(req: DestructiveDegradationRequest):
    """Destructive degradation: MLE of measurement distribution vs time."""
    from scipy.optimize import minimize
    from scipy import stats

    t = np.asarray(req.times, dtype=float)
    y = np.asarray(req.measurements, dtype=float)
    if len(t) != len(y) or len(t) < 4:
        raise HTTPException(status_code=400,
                            detail="times and measurements must be equal-length (>=4).")

    loc_fn = _destructive_location_fn(req.degradation_model)
    if loc_fn is None:
        raise HTTPException(status_code=400,
                            detail=f"Unknown degradation model '{req.degradation_model}'.")
    dist = req.measurement_distribution
    log_location = dist in ("Weibull", "Exponential", "Lognormal")

    # Initial guess for the model parameters by regressing the (log-)location
    # surrogate on the appropriate transform of time, then a sensible shape.
    ybase = np.log(np.maximum(y, 1e-9)) if log_location else y
    ymean = float(np.mean(ybase))
    if req.degradation_model == "linear":
        a0, b0 = np.polyfit(t, ybase, 1)
        mp0 = [float(a0), float(b0)]
    elif req.degradation_model in ("logarithm", "logarithmic"):
        a0, b0 = np.polyfit(np.log(np.maximum(t, 1e-9)), ybase, 1)
        mp0 = [float(a0), float(b0)]
    elif req.degradation_model == "exponential":  # loc = b * e^(a t)
        slope = (ybase[-1] - ybase[0]) / (t[-1] - t[0] + 1e-9)
        mp0 = [float(slope / (abs(ymean) + 1.0)), ymean]
    elif req.degradation_model == "power":        # loc = b * t^a
        a0, lnb = np.polyfit(np.log(np.maximum(t, 1e-9)), ybase, 1)
        mp0 = [float(a0), float(ymean)]
    else:  # lloyd_lipow: loc = a - b/t
        slope, a0 = np.polyfit(1.0 / np.maximum(t, 1e-9), ybase, 1)
        mp0 = [float(a0), float(-slope)]
    mp0 = [0.0 if not np.isfinite(v) else v for v in mp0]

    resid = ybase - np.poly1d(np.polyfit(t, ybase, 1))(t)
    shape0 = max(1e-3, float(np.std(resid, ddof=1)))
    if not np.isfinite(shape0) or shape0 == 0:
        shape0 = max(1e-3, abs(ymean) * 0.1)

    def neg_loglik(params):
        if dist == "Exponential":
            mp = params
        else:
            mp = params[:-1]
            shape = params[-1]
            if shape <= 0:
                return 1e12
        loc = loc_fn(mp, t)
        with np.errstate(all="ignore"):
            try:
                if dist == "Normal":
                    ll = stats.norm.logpdf(y, loc=loc, scale=shape)
                elif dist == "Gumbel":  # smallest extreme value
                    ll = stats.gumbel_l.logpdf(y, loc=loc, scale=shape)
                elif dist == "Lognormal":  # loc is the log-location (mu')
                    ll = stats.lognorm.logpdf(y, s=shape, scale=np.exp(loc))
                elif dist == "Weibull":   # loc is ln(eta)
                    ll = stats.weibull_min.logpdf(y, c=shape, scale=np.exp(loc))
                elif dist == "Exponential":  # loc is ln(MTTF)
                    mtbf = np.exp(loc)
                    ll = stats.expon.logpdf(y, scale=np.maximum(mtbf, 1e-12))
                else:
                    return 1e12
            except Exception:
                return 1e12
        s = -float(np.sum(ll))
        return s if np.isfinite(s) else 1e12

    x0 = list(mp0) if dist == "Exponential" else list(mp0) + [shape0]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        best = None
        for method in ("Nelder-Mead", "Powell"):
            try:
                r = minimize(neg_loglik, x0, method=method,
                             options={"maxiter": 20000, "xatol": 1e-8, "fatol": 1e-8})
                if best is None or r.fun < best.fun:
                    best = r
            except Exception:
                continue
    if best is None or not np.isfinite(best.fun):
        raise HTTPException(status_code=500, detail="MLE failed to converge.")

    params = best.x
    if dist == "Exponential":
        mp = params; shape = None
    else:
        mp = params[:-1]; shape = float(params[-1])

    Dcrit = req.threshold
    increasing = req.threshold_direction == "above"

    def RF_at(time):
        """Return (R, F) at a time using the fitted measurement distribution."""
        loc = float(loc_fn(mp, np.asarray([float(time)]))[0])
        with np.errstate(all="ignore"):
            if dist == "Normal":
                cdf = float(stats.norm.cdf(Dcrit, loc=loc, scale=shape))
            elif dist == "Gumbel":
                cdf = float(stats.gumbel_l.cdf(Dcrit, loc=loc, scale=shape))
            elif dist == "Lognormal":
                cdf = float(stats.lognorm.cdf(Dcrit, s=shape, scale=math.exp(loc)))
            elif dist == "Weibull":
                cdf = float(stats.weibull_min.cdf(Dcrit, c=shape, scale=math.exp(loc)))
            else:  # Exponential
                cdf = float(stats.expon.cdf(Dcrit, scale=max(math.exp(loc), 1e-12)))
        # F = probability of failure. Fail when measurement exceeds D_crit
        # (increasing) -> F = P(x > Dcrit) = 1 - cdf; else F = P(x < Dcrit) = cdf.
        F = (1.0 - cdf) if increasing else cdf
        F = max(0.0, min(1.0, F))
        return 1.0 - F, F

    # Degradation curve (median path) and per-time imposed-pdf envelopes.
    tmax = float(t.max()) * 1.4
    xs = np.linspace(max(1e-6, float(t.min()) * 0.2), tmax, 120)
    loc_curve = loc_fn(mp, xs)
    if log_location:
        median_curve = np.exp(loc_curve)
    else:
        median_curve = loc_curve

    # Reliability curve over time.
    rel_t = np.linspace(max(1e-6, float(t.min()) * 0.2), tmax, 80)
    rel_R = np.array([RF_at(tt)[0] for tt in rel_t])

    model_params = {f"p{i}": float(v) for i, v in enumerate(mp)}
    if req.degradation_model in ("linear", "logarithm", "logarithmic"):
        model_params = {"a": float(mp[0]), "b": float(mp[1])}
    elif req.degradation_model in ("exponential", "power"):
        model_params = {"a": float(mp[0]), "b": float(mp[1])}
    elif req.degradation_model == "lloyd_lipow":
        model_params = {"a": float(mp[0]), "b": float(mp[1])}

    out = {
        "measurement_distribution": dist,
        "degradation_model": req.degradation_model,
        "threshold": Dcrit,
        "threshold_direction": req.threshold_direction,
        "model_params": model_params,
        "shape": shape,
        "shape_label": ("beta" if dist == "Weibull" else
                        "sigma" if dist in ("Normal", "Gumbel") else
                        "sigma_prime" if dist == "Lognormal" else None),
        "loglik": -float(best.fun),
        "scatter": {"t": t.tolist(), "y": y.tolist()},
        "degradation_curve": {"t": xs.tolist(), "median": np.asarray(median_curve, dtype=float).tolist()},
        "reliability_curve": {"t": rel_t.tolist(), "R": rel_R.tolist()},
    }
    if req.reliability_time is not None and req.reliability_time > 0:
        R, F = RF_at(req.reliability_time)
        out["reliability"] = {"time": req.reliability_time, "R": R, "F": F}
    return out


# ---------------------------------------------------------------------------
# Step-Stress ALT — cumulative exposure model
# ---------------------------------------------------------------------------

@router.post("/step-stress")
def step_stress(req: StepStressRequest):
    """Step-stress ALT via the cumulative-exposure (Nelson) model.

    Each step has a stress and duration. Failures observed at their step's
    stress are converted to an equivalent time at a reference (lowest) stress
    using a log-linear life-stress relationship, then a life distribution is
    fitted to those equivalent times.
    """
    steps = req.steps
    if not steps or len(steps) < 2:
        raise HTTPException(status_code=400, detail="At least 2 steps are required.")
    ft = np.asarray(req.failure_times, dtype=float)
    sf = np.asarray(req.stress_at_failure, dtype=float)
    if len(ft) != len(sf) or len(ft) < 2:
        raise HTTPException(status_code=400,
                            detail="failure_times and stress_at_failure must be equal-length (>=2).")

    stresses = [float(s["stress"]) for s in steps]
    durations = [float(s["duration"]) for s in steps]
    ref_stress = min(stresses)

    # Acceleration factor between a stress and the reference, using an
    # inverse-power style relationship AF = (S/S_ref)^p with p estimated from
    # the spread of observed lives across stress levels (fallback p=2).
    uniq = np.unique(sf)
    p = 2.0
    if len(uniq) >= 2:
        med = np.array([np.median(ft[sf == s]) for s in uniq])
        with np.errstate(all="ignore"):
            ls = np.log(uniq / ref_stress)
            lm = np.log(med / med.max())
            denom = float(np.sum(ls * ls))
            if denom > 1e-9:
                p = float(abs(np.sum(ls * lm) / denom))
    if not np.isfinite(p) or p <= 0:
        p = 2.0

    def af(s):
        return (s / ref_stress) ** p if s > 0 else 1.0

    # Cumulative-exposure: equivalent time at reference stress.
    # Time accumulated in prior steps plus time-in-current-step, each scaled
    # by the step's acceleration factor.
    cum_start = {}
    acc = 0.0
    for s, d in zip(stresses, durations):
        cum_start[s] = acc
        acc += d

    equiv = []
    for t, s in zip(ft, sf):
        # equivalent time = AF(s) * (failure time measured within its step window)
        # Approximate the within-step time as t minus the start of that step.
        step_start = cum_start.get(float(s), 0.0)
        in_step = max(0.0, t - step_start)
        prior = step_start  # already-elapsed real time at lower steps
        # Convert prior real-time at the reference baseline (already ref) + accelerated in-step
        equiv.append(prior + af(float(s)) * in_step)
    equiv = np.asarray(equiv, dtype=float)

    dist_map = {"Weibull": "Weibull_2P", "Normal": "Normal_2P", "Lognormal": "Lognormal_2P"}
    dist_name = dist_map.get(req.distribution, "Weibull_2P")
    try:
        fit = _fit_life_distribution(equiv.tolist(), dist_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Cumulative-failure step plot.
    order = np.argsort(ft)
    sorted_t = ft[order]
    cum = np.arange(1, len(sorted_t) + 1) / len(sorted_t)
    step_boundaries = list(np.cumsum(durations)[:-1])

    return {
        "exponent_p": round(p, 4),
        "ref_stress": ref_stress,
        "equivalent_times": [round(float(x), 4) for x in equiv],
        "distribution_fit": fit,
        "cumulative_plot": {
            "time": sorted_t.tolist(),
            "cum_fraction": cum.tolist(),
            "step_boundaries": step_boundaries,
        },
        "use_level_stress": req.use_level_stress,
    }


# ---------------------------------------------------------------------------
# HALT — operating / destruct margin determination
# ---------------------------------------------------------------------------

@router.post("/halt")
def halt(req: HALTRequest):
    """Find operating and destruct limits / margins from a HALT step search."""
    levels = np.asarray(req.stress_levels, dtype=float)
    outcomes = [o.lower() for o in req.outcomes]
    if len(levels) != len(outcomes) or len(levels) == 0:
        raise HTTPException(status_code=400,
                            detail="stress_levels and outcomes must be equal-length and non-empty.")

    order = np.argsort(levels)
    levels = levels[order]
    outcomes = [outcomes[i] for i in order]

    operating_limit = None   # first anomaly
    destruct_limit = None     # first hard fail
    for lvl, out in zip(levels, outcomes):
        if out in ("anomaly", "degraded") and operating_limit is None:
            operating_limit = float(lvl)
        if out in ("fail", "destruct") and destruct_limit is None:
            destruct_limit = float(lvl)
    # If a hard failure occurred without a prior anomaly, treat it as the operating limit too.
    if operating_limit is None and destruct_limit is not None:
        operating_limit = destruct_limit

    op_margin = None
    destruct_margin = None
    if req.spec_max is not None:
        if operating_limit is not None:
            op_margin = round(operating_limit - req.spec_max, 4)
        if destruct_limit is not None:
            destruct_margin = round(destruct_limit - req.spec_max, 4)

    return {
        "stress_type": req.stress_type,
        "operating_limit": operating_limit,
        "destruct_limit": destruct_limit,
        "spec_min": req.spec_min,
        "spec_max": req.spec_max,
        "operating_margin": op_margin,
        "destruct_margin": destruct_margin,
        "capability_plot": {
            "levels": levels.tolist(),
            "outcomes": outcomes,
        },
    }


# ---------------------------------------------------------------------------
# Margin Test — reliability demonstration beyond spec
# ---------------------------------------------------------------------------

@router.post("/margin-test")
def margin_test(req: MarginTestRequest):
    """Demonstrate reliability at spec conditions from an over-stress test."""
    from scipy.stats import beta as _beta

    if req.n_units <= 0 or req.n_failures < 0 or req.n_failures > req.n_units:
        raise HTTPException(status_code=400, detail="Invalid unit/failure counts.")
    if req.test_duration <= 0:
        raise HTTPException(status_code=400, detail="test_duration must be > 0.")

    af = req.acceleration_factor
    if af is None:
        # Fall back to a simple inverse-power ratio with exponent 1.
        af = (req.test_stress / req.spec_stress) if req.spec_stress > 0 else 1.0
    if af <= 0:
        raise HTTPException(status_code=400, detail="acceleration_factor must be > 0.")

    # Equivalent demonstrated time at spec conditions.
    equiv_time = req.test_duration * af

    # Lower confidence bound on reliability via Clopper-Pearson (beta) for the
    # demonstrated mission = equivalent test exposure.
    f = req.n_failures
    n = req.n_units
    alpha = 1.0 - req.confidence
    if f == 0:
        r_lower = alpha ** (1.0 / n)
    else:
        r_lower = float(_beta.ppf(alpha, n - f, f + 1))
    r_point = (n - f) / n

    # MTBF estimate at spec (exponential approximation).
    total_equiv = n * equiv_time
    mtbf_spec = total_equiv / f if f > 0 else None

    return {
        "acceleration_factor": round(float(af), 4),
        "equivalent_time_at_spec": round(float(equiv_time), 4),
        "demonstrated_reliability": round(r_point, 5),
        "reliability_lower_bound": round(r_lower, 5),
        "confidence": req.confidence,
        "mtbf_at_spec": (round(mtbf_spec, 2) if mtbf_spec else None),
        "margin_ratio": round(req.test_stress / req.spec_stress, 4) if req.spec_stress > 0 else None,
    }


# ---------------------------------------------------------------------------
# Multi-Stress ALT — two simultaneous stress variables
# ---------------------------------------------------------------------------

@router.post("/multi-stress")
def multi_stress(req: MultiStressRequest):
    """Per-combination statistics and use-condition interpolation for 2 stresses."""
    ft = np.asarray(req.failure_times, dtype=float)
    s1 = np.asarray(req.stress1, dtype=float)
    s2 = np.asarray(req.stress2, dtype=float)
    if not (len(ft) == len(s1) == len(s2)) or len(ft) < 3:
        raise HTTPException(status_code=400,
                            detail="failure_times, stress1, stress2 must be equal-length (>=3).")

    # Per stress-combination summary.
    combos = {}
    for t, a, b in zip(ft, s1, s2):
        key = (float(a), float(b))
        combos.setdefault(key, []).append(float(t))
    combo_table = []
    for (a, b), times in sorted(combos.items()):
        combo_table.append({
            "stress1": a, "stress2": b, "n": len(times),
            "median_life": round(float(np.median(times)), 4),
            "mean_life": round(float(np.mean(times)), 4),
        })

    # Fit log(life) = c0 + c1*s1 + c2*s2 (multiple linear regression) and
    # extrapolate to use conditions.
    use_life = None
    coeffs = None
    with np.errstate(all="ignore"):
        try:
            X = np.column_stack([np.ones_like(s1), s1, s2])
            y = np.log(ft)
            beta_hat, *_ = np.linalg.lstsq(X, y, rcond=None)
            coeffs = beta_hat.tolist()
            if req.stress1_use is not None and req.stress2_use is not None:
                pred = beta_hat[0] + beta_hat[1] * req.stress1_use + beta_hat[2] * req.stress2_use
                use_life = float(np.exp(pred))
        except Exception:
            pass

    return {
        "stress1_label": req.stress1_label,
        "stress2_label": req.stress2_label,
        "combo_table": combo_table,
        "scatter": {
            "stress1": s1.tolist(), "stress2": s2.tolist(), "life": ft.tolist(),
        },
        "regression_coeffs": coeffs,
        "use_level_life": (round(use_life, 4) if use_life else None),
        "stress1_use": req.stress1_use,
        "stress2_use": req.stress2_use,
    }


# ---------------------------------------------------------------------------
# Stress screening — ESS / HASS / Burn-in
# ---------------------------------------------------------------------------

def _thermal_ss(delta_t, cycles):
    """Thermal-cycling screening strength (fraction of latent defects precipitated)."""
    if delta_t is None or cycles is None or delta_t <= 0 or cycles <= 0:
        return 0.0
    return float(1.0 - math.exp(-0.0017 * (delta_t ** 1.9) * cycles))


def _vibration_ss(grms, minutes):
    """Random-vibration screening strength."""
    if grms is None or minutes is None or grms <= 0 or minutes <= 0:
        return 0.0
    hours = minutes / 60.0
    return float(1.0 - math.exp(-0.0046 * (grms ** 1.71) * hours))


@router.post("/ess")
def ess(req: ESSRequest):
    """Environmental Stress Screening profile development."""
    if not (0.0 <= req.defect_rate <= 1.0):
        raise HTTPException(status_code=400, detail="defect_rate must be in [0, 1].")
    if not (0.0 < req.target_screening_strength < 1.0):
        raise HTTPException(status_code=400, detail="target_screening_strength must be in (0, 1).")

    st = req.screening_type
    curve_x, curve_y, x_label = [], [], ""
    achieved = 0.0
    required = None

    if st == "thermal":
        x_label = "Number of cycles"
        cycles = req.num_cycles or 10
        achieved = _thermal_ss(req.temp_range, cycles)
        # Solve required cycles for the target SS.
        if req.temp_range and req.temp_range > 0:
            required = math.log(1.0 - req.target_screening_strength) / (-0.0017 * (req.temp_range ** 1.9))
            required = max(1.0, required)
        xs = np.linspace(1, max(cycles, (required or cycles)) * 1.5, 60)
        curve_x = xs.tolist()
        curve_y = [_thermal_ss(req.temp_range, c) for c in xs]
    elif st == "vibration":
        x_label = "Duration (minutes)"
        dur = req.vib_duration or 10.0
        achieved = _vibration_ss(req.grms, dur)
        if req.grms and req.grms > 0:
            hours = math.log(1.0 - req.target_screening_strength) / (-0.0046 * (req.grms ** 1.71))
            required = max(1.0, hours * 60.0)
        xs = np.linspace(1, max(dur, (required or dur)) * 1.5, 60)
        curve_x = xs.tolist()
        curve_y = [_vibration_ss(req.grms, m) for m in xs]
    else:  # combined
        x_label = "Number of thermal cycles"
        cycles = req.num_cycles or 10
        ss_t = _thermal_ss(req.temp_range, cycles)
        ss_v = _vibration_ss(req.grms, req.vib_duration)
        achieved = 1.0 - (1.0 - ss_t) * (1.0 - ss_v)
        xs = np.linspace(1, cycles * 2 + 1, 60)
        curve_x = xs.tolist()
        curve_y = [1.0 - (1.0 - _thermal_ss(req.temp_range, c)) * (1.0 - ss_v) for c in xs]

    residual_defect = req.defect_rate * (1.0 - achieved)
    detected = req.defect_rate * achieved

    return {
        "screening_type": st,
        "screening_strength": round(achieved, 5),
        "required": (round(required, 2) if required is not None else None),
        "required_label": x_label,
        "detected_defect_fraction": round(detected, 6),
        "residual_defect_fraction": round(residual_defect, 6),
        "curve": {"x": curve_x, "y": curve_y, "x_label": x_label,
                  "target": req.target_screening_strength},
    }


@router.post("/hass")
def hass(req: HASSRequest):
    """Highly Accelerated Stress Screening: precipitation + detection screens."""
    # Precipitation screen: stress midway between operating and destruct limits.
    precip_temp_low = (req.op_temp_low + req.destruct_temp_low) / 2.0
    precip_temp_high = (req.op_temp_high + req.destruct_temp_high) / 2.0
    precip_dt = precip_temp_high - precip_temp_low
    precip_vib = (req.op_vib + req.destruct_vib) / 2.0

    # Required thermal cycles to hit the target precipitation strength.
    if precip_dt > 0 and 0.0 < req.target_precip_ss < 1.0:
        req_cycles = math.log(1.0 - req.target_precip_ss) / (-0.0017 * (precip_dt ** 1.9))
        req_cycles = max(1.0, req_cycles)
    else:
        req_cycles = None
    precip_ss = _thermal_ss(precip_dt, req_cycles) if req_cycles else 0.0

    # Detection screen at operating limits.
    op_dt = req.op_temp_high - req.op_temp_low
    prob_detect = 1.0 - math.exp(-req.detection_duration / req.use_mtbf) if req.use_mtbf > 0 else 0.0

    return {
        "precipitation_screen": {
            "temp_low": round(precip_temp_low, 2),
            "temp_high": round(precip_temp_high, 2),
            "delta_t": round(precip_dt, 2),
            "vibration": round(precip_vib, 2),
            "required_cycles": (round(req_cycles, 1) if req_cycles else None),
            "screening_strength": round(precip_ss, 5),
        },
        "detection_screen": {
            "temp_low": req.op_temp_low,
            "temp_high": req.op_temp_high,
            "delta_t": round(op_dt, 2),
            "vibration": req.op_vib,
            "duration": req.detection_duration,
            "probability_of_detection": round(prob_detect, 5),
        },
        "stress_levels": {
            "operating": [req.op_temp_low, req.op_temp_high, req.op_vib],
            "precipitation": [precip_temp_low, precip_temp_high, precip_vib],
            "destruct": [req.destruct_temp_low, req.destruct_temp_high, req.destruct_vib],
        },
    }


@router.post("/burn-in")
def burn_in(req: BurnInRequest):
    """Burn-in test design to screen infant-mortality (Weibull, beta < 1)."""
    if req.eta <= 0 or req.beta <= 0 or req.n_units <= 0 or req.duration <= 0:
        raise HTTPException(status_code=400, detail="eta, beta, n_units, duration must be > 0.")

    af = req.acceleration_factor if req.acceleration_factor and req.acceleration_factor > 0 else 1.0
    t_eff = req.duration * af

    def sf(t):
        return math.exp(-((t / req.eta) ** req.beta))

    p_survive = sf(t_eff)
    expected_failures = req.n_units * (1.0 - p_survive)

    # Reliability curves before vs after burn-in (conditional on survival).
    tmax = req.eta * 2.0
    xs = np.linspace(0, tmax, 200)
    r_before = np.array([sf(t) for t in xs])
    r_after = np.array([sf(t + t_eff) / p_survive if p_survive > 0 else 0.0 for t in xs])

    def haz(t):
        if t <= 0:
            return 0.0
        return (req.beta / req.eta) * ((t / req.eta) ** (req.beta - 1.0))

    h_before = np.array([haz(t) for t in xs])
    h_after = np.array([haz(t + t_eff) for t in xs])

    # Post burn-in MTBF (numeric integral of conditional reliability).
    _trapz = getattr(np, "trapezoid", None) or np.trapz
    mtbf_after = float(_trapz(r_after, xs))

    return {
        "effective_burn_in_time": round(t_eff, 3),
        "survival_probability": round(p_survive, 5),
        "expected_failures": round(expected_failures, 3),
        "post_burn_in_mtbf": round(mtbf_after, 3),
        "reliability_plot": {
            "time": xs.tolist(),
            "before": r_before.tolist(),
            "after": r_after.tolist(),
        },
        "hazard_plot": {
            "time": xs.tolist(),
            "before": h_before.tolist(),
            "after": h_after.tolist(),
        },
    }


# ===========================================================================
# Reliability Demonstration Testing (RDT) — Reliability Test Design reference
# ===========================================================================

def _weibull_eta_from_metric(metric_value, beta, metric):
    """Solve Weibull eta from a B10 life or mean life."""
    from scipy.special import gamma as _gamma
    if metric == "mean":
        return metric_value / _gamma(1.0 + 1.0 / beta)
    # B10: t = eta * (-ln(0.9))**(1/beta)
    return metric_value / ((-math.log(0.9)) ** (1.0 / beta))


def _quantile_from_rank(rank, distribution, beta, eta):
    """Inverse CDF (time) at the given cumulative probability `rank`."""
    from scipy.stats import norm, lognorm
    rank = min(max(rank, 1e-9), 1 - 1e-9)
    if distribution == "Normal":
        return float(norm.ppf(rank, loc=eta, scale=beta))
    if distribution == "Lognormal":
        return float(lognorm.ppf(rank, s=beta, scale=math.exp(eta)))
    if distribution == "Exponential":
        return float(-eta * math.log(1.0 - rank))   # eta = MTTF
    # Weibull
    return float(eta * (-math.log(1.0 - rank)) ** (1.0 / beta))


@router.post("/rdt/exponential-chi-squared")
def rdt_exponential_chi_squared(req: ExpChiSquaredRDTRequest):
    """Exponential (constant failure rate) chi-squared demonstration test.

    Ta = (t_demo / -ln(R)) * chi2(1-CL; 2f+2) / 2  (reliability metric)
    Ta = MTTF * chi2(1-CL; 2f+2) / 2               (MTTF metric)
    """
    from scipy.stats import chi2

    if not (0.0 < req.confidence < 1.0):
        raise HTTPException(status_code=400, detail="confidence must be in (0, 1).")
    f = max(0, int(req.failures))
    chi2_val = float(chi2.ppf(req.confidence, 2 * f + 2))

    if req.metric == "mttf":
        if req.mttf <= 0:
            raise HTTPException(status_code=400, detail="mttf must be > 0.")
        Ta = req.mttf * chi2_val / 2.0
        mttf_demo = req.mttf
    else:
        if not (0.0 < req.reliability < 1.0) or req.demo_time <= 0:
            raise HTTPException(status_code=400,
                                detail="reliability must be in (0,1) and demo_time > 0.")
        mttf_demo = req.demo_time / (-math.log(req.reliability))
        Ta = mttf_demo * chi2_val / 2.0

    out = {
        "metric": req.metric, "confidence": req.confidence, "failures": f,
        "chi_squared": round(chi2_val, 6),
        "accumulated_test_time": round(Ta, 4),
        "implied_mttf": round(mttf_demo, 4),
    }
    if req.solve_for == "sample_size":
        if not req.test_time or req.test_time <= 0:
            raise HTTPException(status_code=400, detail="test_time required to solve sample_size.")
        out["test_time"] = req.test_time
        out["sample_size"] = int(math.ceil(Ta / req.test_time))
    else:  # test_time per unit
        n = req.n if req.n and req.n > 0 else 1
        out["sample_size"] = n
        out["test_time"] = round(Ta / n, 4)
    return out


def _bayes_prior_params(req: BayesianRDTRequest):
    """Compute (alpha0, beta0, E_R0, Var_R0) from the chosen prior source."""
    if req.prior_source == "subsystem":
        subs = req.subsystems or []
        if not subs:
            raise HTTPException(status_code=400, detail="subsystems required for subsystem prior.")
        E_list, V_list = [], []
        for s in subs:
            n_i = float(s["n"]); r_i = float(s["r"])
            E_i = (n_i - r_i) / (n_i + 1.0)
            V_i = ((n_i - r_i) * (r_i + 1.0)) / ((n_i + 1.0) ** 2 * (n_i + 2.0))
            E_list.append(E_i); V_list.append(V_i)
        E_R0 = 1.0
        for e in E_list:
            E_R0 *= e
        prod_e2v = 1.0
        prod_e2 = 1.0
        for e, v in zip(E_list, V_list):
            prod_e2v *= (e * e + v)
            prod_e2 *= (e * e)
        Var_R0 = prod_e2v - prod_e2
    else:  # expert
        if req.worst is None or req.likely is None or req.best is None:
            raise HTTPException(status_code=400,
                                detail="worst/likely/best reliabilities required for expert prior.")
        a, b, c = req.worst, req.likely, req.best
        E_R0 = (a + 4.0 * b + c) / 6.0
        Var_R0 = ((c - a) / 6.0) ** 2

    if Var_R0 <= 0:
        raise HTTPException(status_code=400, detail="Prior variance must be positive.")
    factor = (E_R0 - E_R0 ** 2) / Var_R0 - 1.0
    alpha0 = E_R0 * factor
    beta0 = (1.0 - E_R0) * factor
    return alpha0, beta0, E_R0, Var_R0


@router.post("/rdt/bayesian")
def rdt_bayesian(req: BayesianRDTRequest):
    """Non-parametric Bayesian reliability demonstration test (beta prior)."""
    from scipy.stats import beta as _beta

    alpha0, beta0, E_R0, Var_R0 = _bayes_prior_params(req)
    r = max(0, int(req.failures))
    out = {
        "prior_source": req.prior_source,
        "E_R0": round(E_R0, 6), "Var_R0": round(Var_R0, 8),
        "alpha0": round(alpha0, 6), "beta0": round(beta0, 6),
        "solve_for": req.solve_for, "failures": r,
    }

    def demonstrated_R(n):
        s = n - r
        a = alpha0 + s
        b = beta0 + r
        return float(_beta.ppf(1.0 - req.confidence, a, b)), a, b

    if req.solve_for == "reliability":
        if not req.n or req.n <= r:
            raise HTTPException(status_code=400, detail="n must be > failures.")
        R, a, b = demonstrated_R(req.n)
        out.update(n=req.n, confidence=req.confidence,
                   reliability=round(R, 6), posterior_alpha=round(a, 6),
                   posterior_beta=round(b, 6))
    elif req.solve_for == "confidence":
        if not req.n or req.n <= r:
            raise HTTPException(status_code=400, detail="n must be > failures.")
        s = req.n - r
        a = alpha0 + s
        b = beta0 + r
        # 1 - CL = I_R(alpha, beta)  ->  CL = 1 - betacdf(R; alpha, beta)
        CL = 1.0 - float(_beta.cdf(req.reliability, a, b))
        out.update(n=req.n, reliability=req.reliability,
                   confidence=round(CL, 6), posterior_alpha=round(a, 6),
                   posterior_beta=round(b, 6))
    else:  # sample_size
        target_R = req.reliability
        n = r + 1
        found = None
        while n <= r + 100000:
            R, _, _ = demonstrated_R(n)
            if R >= target_R:
                found = n
                break
            n += 1
        if found is None:
            raise HTTPException(status_code=400, detail="Could not find a sample size; check inputs.")
        out.update(reliability=target_R, confidence=req.confidence, sample_size=found)
    return out


@router.post("/rdt/expected-failure-times")
def rdt_expected_failure_times(req: ExpectedFailureTimesRequest):
    """Expected ordered failure times with confidence bounds (median ranks)."""
    from scipy.stats import beta as _beta

    n = int(req.n)
    if n < 1 or n > 1000:
        raise HTTPException(status_code=400, detail="n must be between 1 and 1000.")
    if not (0.0 < req.confidence < 1.0):
        raise HTTPException(status_code=400, detail="confidence must be in (0, 1).")
    lo_p = (1.0 - req.confidence) / 2.0
    hi_p = 1.0 - lo_p

    rows = []
    for i in range(1, n + 1):
        mr = float(_beta.ppf(0.5, i, n - i + 1))
        lr = float(_beta.ppf(lo_p, i, n - i + 1))
        ur = float(_beta.ppf(hi_p, i, n - i + 1))
        rows.append({
            "order": i,
            "low": round(_quantile_from_rank(lr, req.distribution, req.beta, req.eta), 4),
            "median": round(_quantile_from_rank(mr, req.distribution, req.beta, req.eta), 4),
            "high": round(_quantile_from_rank(ur, req.distribution, req.beta, req.eta), 4),
        })
    return {
        "n": n, "distribution": req.distribution, "beta": req.beta, "eta": req.eta,
        "confidence": req.confidence, "rows": rows,
    }


def _weibull_blife_ci(failures, rc, p, CI):
    """Fit Weibull_2P and return (B-life, lower, upper) for unreliability p."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = Fit_Weibull_2P(failures=np.asarray(failures, dtype=float),
                             right_censored=(np.asarray(rc, dtype=float) if rc else None),
                             show_probability_plot=False, CI=CI)
    eta, beta = float(fit.eta), float(fit.beta)
    k = -math.log(1.0 - p)
    t_p = eta * k ** (1.0 / beta)
    cov = getattr(fit, "covariance_matrix", None)  # order: [eta, beta]
    if cov is None or not np.all(np.isfinite(cov)):
        return t_p, None, None
    # ln(t_p) = ln(eta) + (1/beta) ln(k)
    d_eta = 1.0 / eta
    d_beta = -(1.0 / beta ** 2) * math.log(k)
    J = np.array([d_eta, d_beta])
    var_ln = float(J @ cov @ J)
    if not np.isfinite(var_ln) or var_ln < 0:
        return t_p, None, None
    from scipy.stats import norm
    z = float(norm.ppf(1.0 - (1.0 - CI) / 2.0))
    se = math.sqrt(var_ln)
    return t_p, t_p * math.exp(-z * se), t_p * math.exp(z * se)


@router.post("/rdt/difference-detection-matrix")
def rdt_difference_detection(req: DifferenceDetectionRequest):
    """Difference detection matrix: can a B10/mean difference be detected?"""
    from scipy.stats import beta as _beta

    test_times = sorted([t for t in req.test_times if t > 0])
    if not test_times:
        raise HTTPException(status_code=400, detail="At least one test time is required.")

    # Build the metric axis.
    vals = []
    v = req.metric_min
    while v <= req.metric_max + 1e-9:
        vals.append(round(v, 6))
        v += req.metric_increment
    if len(vals) < 1:
        raise HTTPException(status_code=400, detail="Invalid metric range.")

    p = 0.10  # B10

    def median_failure_times(metric_value, beta, n):
        eta = _weibull_eta_from_metric(metric_value, beta, req.metric if req.metric == "mean" else "B10")
        times = []
        for i in range(1, n + 1):
            mr = float(_beta.ppf(0.5, i, n - i + 1))
            times.append(eta * (-math.log(1.0 - mr)) ** (1.0 / beta))
        return times

    def metric_ci(metric_value, beta, n, T):
        """Censor median failure times at T, fit Weibull, return (val, lo, hi)."""
        times = median_failure_times(metric_value, beta, n)
        fails = [t for t in times if t <= T]
        susp = [T for t in times if t > T]
        if len(fails) < 2:
            return None
        if req.metric == "mean":
            # Mean-life bounds via B-life proxy is non-trivial; use B10 spacing
            # scaled — but for the matrix we compare overlap, so use B10 bounds.
            return _weibull_blife_ci(fails, susp, p, req.confidence)
        return _weibull_blife_ci(fails, susp, p, req.confidence)

    # Each cell holds the SHORTEST test duration (hours) at which the two
    # designs' metric confidence intervals stop overlapping (0 = the difference
    # cannot be detected with any of the supplied test durations).
    matrix = []
    detail_cells = {}
    for m2 in vals:               # rows = design 2
        row = []
        for m1 in vals:           # cols = design 1
            cell = 0
            for T in test_times:  # ascending -> first hit is the shortest
                c1 = metric_ci(m1, req.design1_beta, req.design1_n, T)
                c2 = metric_ci(m2, req.design2_beta, req.design2_n, T)
                if not c1 or not c2 or c1[1] is None or c2[1] is None:
                    continue
                # non-overlapping CIs -> detectable
                if c1[2] < c2[1] or c2[2] < c1[1]:
                    cell = T
                    detail_cells[f"{m1}|{m2}"] = {
                        "test_time": T,
                        "design1": {"value": round(c1[0], 3), "lower": round(c1[1], 3), "upper": round(c1[2], 3)},
                        "design2": {"value": round(c2[0], 3), "lower": round(c2[1], 3), "upper": round(c2[2], 3)},
                    }
                    break
            row.append(cell)
        matrix.append(row)

    return {
        "metric": req.metric, "confidence": req.confidence,
        "design1_beta": req.design1_beta, "design2_beta": req.design2_beta,
        "values": vals, "test_times": test_times,
        "matrix": matrix, "details": detail_cells,
    }


@router.post("/test-simulation")
def test_simulation(req: TestSimulationRequest):
    """Monte-Carlo simulation of a reliability test design."""
    rng = np.random.default_rng(req.seed)
    n = int(req.n)
    if n < 2 or req.num_simulations < 10:
        raise HTTPException(status_code=400, detail="Need n>=2 and num_simulations>=10.")

    def sample(size):
        if req.distribution == "Normal":
            return rng.normal(req.eta, req.beta, size)
        if req.distribution == "Lognormal":
            return rng.lognormal(req.eta, req.beta, size)
        if req.distribution == "Exponential":
            return rng.exponential(req.eta, size)
        return req.eta * rng.weibull(req.beta, size)   # Weibull

    estimates = []
    n_sims = int(min(req.num_simulations, 5000))
    for _ in range(n_sims):
        data = np.abs(sample(n))
        rc = None
        fails = data
        if req.test_duration and req.test_duration > 0:
            mask = data <= req.test_duration
            fails = data[mask]
            rc = np.full(int((~mask).sum()), req.test_duration)
            if len(fails) < 2:
                continue
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                fit = Fit_Weibull_2P(failures=fails,
                                     right_censored=(rc if rc is not None and len(rc) else None),
                                     show_probability_plot=False)
            dist = fit.distribution
            if req.metric == "B10":
                est = float(dist.quantile(0.10))
            else:  # reliability at target_time
                est = float(dist.SF(xvals=np.asarray([req.target_time]))[0])
        except Exception:
            continue
        if np.isfinite(est):
            estimates.append(est)

    if len(estimates) < 5:
        raise HTTPException(status_code=500, detail="Simulation produced too few valid fits.")
    arr = np.asarray(estimates, dtype=float)
    lo = float(np.percentile(arr, 100 * (1.0 - 0.9) / 2.0))
    hi = float(np.percentile(arr, 100 * (1.0 - (1.0 - 0.9) / 2.0)))
    prob_meet = None
    if req.target_value is not None:
        if req.metric == "reliability":
            prob_meet = float(np.mean(arr >= req.target_value))
        else:
            prob_meet = float(np.mean(arr >= req.target_value))
    # histogram
    counts, edges = np.histogram(arr, bins=min(30, max(10, len(arr) // 20)))
    return {
        "metric": req.metric, "n_valid": len(estimates), "num_simulations": n_sims,
        "mean": round(float(np.mean(arr)), 6),
        "median": round(float(np.median(arr)), 6),
        "std": round(float(np.std(arr, ddof=1)), 6),
        "p5": round(lo, 6), "p95": round(hi, 6),
        "prob_meet_target": (round(prob_meet, 4) if prob_meet is not None else None),
        "target_value": req.target_value,
        "histogram": {"counts": counts.tolist(), "edges": edges.tolist()},
    }
