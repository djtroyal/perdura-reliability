"""Accelerated Life Testing router."""

import asyncio
import json
import logging
import math
import os
import queue
import sys
import threading
import warnings
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from api_contract import stream_error_event, stream_result_event

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
from reliability.Utils import FitConvergenceError, select_best_optimizer_result
from utils import convergence_series
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
logger = logging.getLogger(__name__)


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
    # ValueError → 400 via the global exception handler in main.py
    return one_sample_proportion(req.trials, req.successes, CI=req.CI)


@router.post("/two-proportion-test")
def two_proportion_ep(req: TwoProportionRequest):
    return two_proportion_test(req.trials_1, req.successes_1,
                               req.trials_2, req.successes_2, CI=req.CI)


@router.post("/sample-size-no-failures")
def no_failures_ep(req: NoFailuresRequest):
    return sample_size_no_failures(req.reliability, CI=req.CI,
                                   lifetimes=req.lifetimes,
                                   weibull_shape=req.weibull_shape)


@router.post("/sequential-sampling")
def sequential_sampling_ep(req: SequentialSamplingRequest):
    return sequential_sampling_chart(req.p1, req.p2, req.alpha, req.beta,
                                     max_samples=req.max_samples)


@router.post("/test-planner")
def test_planner_ep(req: TestPlannerRequest):
    return reliability_test_planner(
        MTBF=req.MTBF, test_duration=req.test_duration,
        number_of_failures=req.number_of_failures,
        CI=req.CI, two_sided=req.two_sided)


@router.post("/test-duration")
def test_duration_ep(req: TestDurationRequest):
    return reliability_test_duration(
        req.MTBF_required, req.MTBF_design,
        req.consumer_risk, req.producer_risk)


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
        if not getattr(fit, "fit_eligible", False):
            raise ValueError("The fitted model is not eligible for GoF inference.")
        dist = fit.distribution
        if req.test == "ks":
            res = KS_test(
                dist, failures, CI=req.CI,
                fitter=_FITTER_MAP[req.distribution],
                n_bootstrap=req.n_bootstrap, seed=req.seed,
            )
            res["test"] = "Kolmogorov-Smirnov"
        else:
            res = chi_squared_test(
                dist, failures, bins=req.bins, CI=req.CI,
                fitter=_FITTER_MAP[req.distribution],
                n_bootstrap=req.n_bootstrap, seed=req.seed,
                min_expected=req.min_expected,
            )
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


def _run_alt_fit(req: ALTFitRequest, bootstrap_progress_callback=None):
    failures = np.asarray(req.failures, dtype=float)
    stresses = np.asarray(req.failure_stress, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None
    rc_stress = np.asarray(req.right_censored_stress, dtype=float) if req.right_censored_stress else None

    if len(failures) < 4:
        raise HTTPException(status_code=400, detail="At least 4 failure times required for ALT.")

    if len(failures) != len(stresses):
        raise HTTPException(status_code=400,
                            detail="failures and failure_stress must have the same length.")
    if np.any(~np.isfinite(failures)) or np.any(failures <= 0):
        raise HTTPException(status_code=400, detail="All failure times must be finite and > 0.")
    if np.any(~np.isfinite(stresses)) or np.any(stresses <= 0):
        raise HTTPException(status_code=400, detail="All failure stresses must be finite and > 0.")
    if len(np.unique(stresses)) < 2:
        raise HTTPException(status_code=400, detail="ALT fitting requires at least two distinct stress levels.")
    if req.use_level_stress is not None and (
            not np.isfinite(req.use_level_stress) or req.use_level_stress <= 0):
        raise HTTPException(status_code=400, detail="use_level_stress must be finite and > 0.")
    if (rc is None) != (rc_stress is None):
        raise HTTPException(
            status_code=400,
            detail="Provide both right_censored and right_censored_stress, or neither.")
    if rc is not None:
        if len(rc) != len(rc_stress):
            raise HTTPException(status_code=400, detail="Censored times and stresses must have equal length.")
        if np.any(~np.isfinite(rc)) or np.any(rc <= 0):
            raise HTTPException(status_code=400, detail="All censored times must be finite and > 0.")
        if np.any(~np.isfinite(rc_stress)) or np.any(rc_stress <= 0):
            raise HTTPException(status_code=400, detail="All censored stresses must be finite and > 0.")

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
        entry = {}
        for k, v in row.items():
            if k == "Diagnostics":
                continue
            if k == "Eligibility Reasons":
                entry[k] = ", ".join(v) if v else ""
            elif isinstance(v, (float, np.floating)):
                entry[k] = None if not np.isfinite(v) else round(float(v), 4)
            elif isinstance(v, (bool, np.bool_)):
                entry[k] = bool(v)
            else:
                entry[k] = v
        entry["Status"] = "Eligible" if entry.get("Fit Eligible") else "Ineligible"
        results.append(entry)

    model_diagnostics = {}
    for name, model in (getattr(fe, 'fitted', None) or {}).items():
        model_diagnostics[name] = {
            'optimizer': getattr(model, 'fit_diagnostics', None),
            'stress_design': getattr(model, 'stress_design_diagnostics', None),
            'physical_constraint': getattr(model, 'physical_constraint_diagnostic', None),
            'common_shape': getattr(model, 'common_shape_diagnostic', None),
        }

    # Life-stress plot data for every successfully-fitted model, so the user can
    # click through the results table and inspect each model's fit.
    life_stress_plots = {}
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

    # Per-model parameters and life metrics at the use-level stress, for the
    # tabular results panel (life at use stress, B10/B50/mean, model params).
    shape_label = {"Weibull": "β", "Lognormal": "σ", "Normal": "σ",
                   "Exponential": None}

    def _r(v):
        try:
            v = float(v)
            return round(v, 6) if np.isfinite(v) else None
        except (TypeError, ValueError):
            return None

    model_details = {}
    bootstrap_by_model = {}
    if (req.uncertainty_method == 'parametric_bootstrap'
            and req.use_level_stress is not None and fe.best_model is not None):
        try:
            bootstrap_by_model[fe.best_model_name] = fe.best_model.parametric_bootstrap_use_life(
                n_bootstrap=req.n_bootstrap, CI=req.uncertainty_CI, seed=req.seed,
                progress_callback=bootstrap_progress_callback)
        except Exception as exc:
            bootstrap_by_model[fe.best_model_name] = {
                'method': 'parametric_bootstrap_refit', 'status': 'failed',
                'reason': str(exc), 'requested': req.n_bootstrap,
                'successful': 0, 'failed': req.n_bootstrap,
                'CI': req.uncertainty_CI, 'lower': None, 'upper': None,
            }
    for name, model in fitted.items():
        d = {
            "a": _r(getattr(model, "a", None)),
            "b": _r(getattr(model, "b", None)),
            "c": _r(getattr(model, "c", None)),
            "shape": _r(getattr(model, "shape", None)),
            "shape_label": shape_label.get(getattr(model, "base_dist_name", None)),
            "use_level_stress": req.use_level_stress,
            "life_b10": None,
            "life_b50": None,
            "life_mean": None,
        }
        dus = getattr(model, "distribution_at_use_stress", None)
        if dus is not None:
            try:
                d["life_b10"] = _r(dus.quantile(0.10))
                d["life_b50"] = _r(dus.median)
                d["life_mean"] = _r(dus.mean)
            except Exception:
                pass
        # Delta-method CI on the use-level median life (from the observed
        # Fisher information of the ALT fit).
        d["life_b50_lower"] = _r(getattr(model, "use_level_life_lower", None))
        d["life_b50_upper"] = _r(getattr(model, "use_level_life_upper", None))
        d["delta_interval"] = {
            'method': 'observed_fisher_delta_log_life',
            'status': ('available' if d['life_b50_lower'] is not None else 'unavailable'),
            'CI': getattr(model, 'use_level_CI', 0.95),
            'lower': d['life_b50_lower'], 'upper': d['life_b50_upper'],
            'warning': 'Fast local approximation; may be unreliable near bounds or under weak extrapolation identifiability.',
        }
        d["bootstrap_interval"] = bootstrap_by_model.get(name)
        d["stress_design"] = getattr(model, 'stress_design_diagnostics', None)
        d["physical_constraint"] = getattr(model, 'physical_constraint_diagnostic', None)
        d["common_shape"] = getattr(model, 'common_shape_diagnostic', None)
        model_details[name] = d

    tested_min, tested_max = float(np.min(stresses)), float(np.max(stresses))
    use_summary = None
    if req.use_level_stress is not None:
        if req.use_level_stress < tested_min:
            position = 'below_tested_range'
        elif req.use_level_stress > tested_max:
            position = 'above_tested_range'
        else:
            position = 'within_tested_range'
        use_summary = {
            'stress': req.use_level_stress,
            'position': position,
            'is_extrapolation': position != 'within_tested_range',
            'tested_minimum': tested_min,
            'tested_maximum': tested_max,
        }

    return {
        "results": results,
        "best_model": fe.best_model_name,
        "life_stress_plots": life_stress_plots,
        "model_details": model_details,
        "model_diagnostics": model_diagnostics,
        "analysis_diagnostics": {
            'tested_stress_range': {'minimum': tested_min, 'maximum': tested_max},
            'use_stress': use_summary,
            'common_shape_scope': (
                'An asymptotic likelihood-ratio diagnostic; rejection is evidence against '
                'common variability/mechanism, while non-rejection means no difference was detected.'),
            'physical_direction_assumption': 'Larger entered stress is more damaging and must decrease life.',
            'uncertainty_method_requested': req.uncertainty_method,
        },
        "available_models": list(ALL_SINGLE_STRESS_NAMES),
    }


@router.post("/fit")
def fit_alt(req: ALTFitRequest):
    return _run_alt_fit(req)


@router.post("/fit/stream", response_class=StreamingResponse, responses={
    200: {"content": {"application/x-ndjson": {"schema": {"type": "string"}}}},
})
def fit_alt_stream(req: ALTFitRequest, request: Request):
    """ALT result stream with live progress for parametric bootstrap refits."""
    total = req.n_bootstrap if req.uncertainty_method == "parametric_bootstrap" else 1
    rid = getattr(request.state, "request_id", "")

    async def gen():
        event_queue: queue.Queue = queue.Queue()

        def progress(done, total_):
            event_queue.put({"type": "progress", "done": done, "total": total_})

        def work():
            try:
                payload = _run_alt_fit(
                    req,
                    bootstrap_progress_callback=(
                        progress if req.uncertainty_method == "parametric_bootstrap" else None
                    ),
                )
                event_queue.put(stream_result_event(payload))
            except HTTPException as exc:
                event_queue.put(stream_error_event(
                    exc.detail, request_id_value=rid, status=exc.status_code,
                ))
            except BaseException:  # pragma: no cover - terminal worker guard
                logging.getLogger(__name__).exception("Unexpected ALT stream failure.")
                event_queue.put(stream_error_event(
                    "The analysis failed. Use the request ID when reporting this error.",
                    request_id_value=rid,
                ))

        worker = threading.Thread(target=work, daemon=True)
        worker.start()
        yield json.dumps({"type": "start", "total": total}) + "\n"
        while True:
            try:
                item = event_queue.get_nowait()
            except queue.Empty:
                if not worker.is_alive():
                    item = stream_error_event(
                        "ALT worker exited without a terminal event.",
                        request_id_value=rid,
                    )
                else:
                    await asyncio.sleep(0.025)
                    continue
            yield json.dumps(item) + "\n"
            if item["type"] in ("result", "error"):
                worker.join(timeout=1.0)
                return

    return StreamingResponse(
        gen(), media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


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

        # Requirement-vs-reliability and sample-size/test-time tradeoff curves
        # (parametric methods only). When the options table is shown, draw one
        # curve per allowable-failure count; otherwise just the selected count.
        if req.curves and parametric:
            f_list = list(range(6)) if req.options_table else [req.failures]

            # (1) Requirement vs target reliability R: required sample size
            #     (Method 2A) or required test time (Method 2B) as R varies.
            R_grid = np.linspace(0.50, 0.99, 40)
            req_curves = []
            for f in f_list:
                ys = []
                for rv in R_grid:
                    try:
                        if req.method == "parametric_samples":
                            ys.append(parametric_binomial_sample_size(
                                float(rv), req.mission_time, req.beta, req.test_time,
                                CI=req.CI, failures=f)["n"])
                        elif req.n is not None and req.n >= f + 1:
                            ys.append(round(parametric_binomial_test_time(
                                float(rv), req.mission_time, req.beta, req.n,
                                CI=req.CI, failures=f)["T_test"], 4))
                        else:
                            ys.append(None)
                    except Exception:
                        ys.append(None)
                req_curves.append({"f": f, "values": ys})
            out["requirement_curve"] = {
                "R": np.round(R_grid, 6).tolist(),
                "y_label": ("Required sample size" if req.method == "parametric_samples"
                            else "Required test time"),
                "curves": req_curves,
            }

            # (2) Sample-size / test-time tradeoff: required sample size vs the
            #     test time per unit, for the target R/CI.
            t_anchor = req.test_time if req.test_time else (req.mission_time or 1.0)
            t_grid = np.linspace(0.25 * t_anchor, 3.0 * t_anchor, 40)
            trade_curves = []
            for f in f_list:
                ns = []
                for t in t_grid:
                    try:
                        ns.append(parametric_binomial_sample_size(
                            req.R, req.mission_time, req.beta, float(t),
                            CI=req.CI, failures=f)["n"])
                    except Exception:
                        ns.append(None)
                trade_curves.append({"f": f, "n": ns})
            out["tradeoff_curve"] = {
                "test_time": np.round(t_grid, 4).tolist(),
                "curves": trade_curves,
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
    out["converged"] = bool(getattr(fit, "converged", False))
    out["fit_eligible"] = bool(getattr(fit, "fit_eligible", False))
    out["aicc_eligible"] = bool(getattr(fit, "aicc_eligible", False))
    out["eligibility_reasons"] = list(
        getattr(fit, "eligibility_reasons", [])
    )
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
                if getattr(fit, "fit_eligible", False):
                    fitted.append((name, fit))
            except Exception:
                continue

    if not fitted:
        raise ValueError("Could not fit any life distribution to the projected times.")

    def _aicc(f):
        v = getattr(f, "AICc", None)
        return float(v) if (v is not None and np.isfinite(v)) else float("inf")

    if auto:
        fitted = [nf for nf in fitted if getattr(nf[1], "aicc_eligible", False)]
        if not fitted:
            raise ValueError(
                "No candidate has a defined AICc for this sample size; "
                "select a specific distribution or provide more observations."
            )

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


def _fit_interval_censored_life_distribution(
        exact_failures, intervals, right_censored, dist_name,
        reliability_time=None):
    """Fit a life distribution with exact, interval, and right-censored data.

    Each unit contributes exactly one likelihood term: ``f(t)`` for an exact
    projected failure, ``F(upper)-F(lower)`` for an interval-censored failure,
    or ``S(t)`` for a unit known to survive through its last observation.
    """
    from scipy import stats
    from scipy.optimize import minimize
    from scipy.special import expit

    exact = np.asarray(exact_failures or [], dtype=float)
    rc = np.asarray(right_censored or [], dtype=float)
    interval_array = np.asarray(intervals or [], dtype=float)
    if interval_array.size == 0:
        interval_array = np.empty((0, 2), dtype=float)
    else:
        interval_array = interval_array.reshape(-1, 2)

    if (np.any(~np.isfinite(exact)) or np.any(exact <= 0)
            or np.any(~np.isfinite(rc)) or np.any(rc <= 0)):
        raise ValueError("Exact and right-censored life times must be finite and > 0.")
    if (np.any(~np.isfinite(interval_array))
            or np.any(interval_array[:, 0] < 0)
            or np.any(interval_array[:, 1] <= interval_array[:, 0])):
        raise ValueError(
            "Every interval-censored observation must satisfy 0 <= lower < upper.")
    if len(exact) + len(interval_array) < 2:
        raise ValueError(
            "Need at least 2 exact or interval-censored failures to fit a distribution.")

    all_times = np.concatenate((
        exact,
        interval_array.ravel(),
        rc,
    ))
    positive_times = all_times[all_times > 0]
    scale_reference = max(float(np.median(positive_times)), 1e-6)
    max_time = max(float(np.max(positive_times)), scale_reference)
    min_failure_bound = min(
        [float(v) for v in exact]
        + [float(v) for v in interval_array[:, 1]])
    gamma_ceiling = max(0.0, min_failure_bound * (1.0 - 1e-9))
    min_scale = max(scale_reference * 1e-6, 1e-12)
    max_scale = max(max_time * 1e3, min_scale * 10)
    log_scale_bounds = (math.log(min_scale), math.log(max_scale))
    log_shape_bounds = (math.log(0.05), math.log(100.0))

    def configuration(name):
        """Return (start, bounds, shape-index, decoder) for one family."""
        if name in ("Weibull_2P", "Weibull_3P"):
            start = [math.log(scale_reference), math.log(2.0)]
            bounds = [log_scale_bounds, log_shape_bounds]
            if name.endswith("3P"):
                if gamma_ceiling <= 0:
                    raise ValueError("A positive location range is unavailable for a 3P fit.")
                start.append(-8.0)
                bounds.append((-20.0, 20.0))

            def decode(theta):
                eta, beta = math.exp(theta[0]), math.exp(theta[1])
                gamma = (gamma_ceiling * float(expit(theta[2]))
                         if len(theta) == 3 else 0.0)
                frozen = stats.weibull_min(c=beta, scale=eta, loc=gamma)
                params = {"alpha": eta, "beta": beta}
                if len(theta) == 3:
                    params["gamma"] = gamma
                return frozen, params
            return start, bounds, 1, decode

        if name in ("Lognormal_2P", "Lognormal_3P"):
            logged = np.log(np.maximum(positive_times, 1e-12))
            sigma0 = max(float(np.std(logged)), 0.25)
            start = [float(np.mean(logged)), math.log(sigma0)]
            bounds = [
                (math.log(min_scale) - 10.0, math.log(max_scale) + 10.0),
                log_shape_bounds,
            ]
            if name.endswith("3P"):
                if gamma_ceiling <= 0:
                    raise ValueError("A positive location range is unavailable for a 3P fit.")
                start.append(-8.0)
                bounds.append((-20.0, 20.0))

            def decode(theta):
                mu, sigma = float(theta[0]), math.exp(theta[1])
                gamma = (gamma_ceiling * float(expit(theta[2]))
                         if len(theta) == 3 else 0.0)
                frozen = stats.lognorm(
                    s=sigma, scale=math.exp(mu), loc=gamma)
                params = {"mu": mu, "sigma": sigma}
                if len(theta) == 3:
                    params["gamma"] = gamma
                return frozen, params
            return start, bounds, 1, decode

        if name == "Exponential_1P":
            start = [math.log(scale_reference)]
            bounds = [log_scale_bounds]

            def decode(theta):
                mean = math.exp(theta[0])
                return stats.expon(scale=mean), {"Lambda": 1.0 / mean}
            return start, bounds, None, decode

        if name == "Normal_2P":
            sigma0 = max(float(np.std(positive_times)), scale_reference * 0.1)
            start = [float(np.mean(positive_times)), math.log(sigma0)]
            bounds = [(-10.0 * max_time, 10.0 * max_time), log_scale_bounds]

            def decode(theta):
                mu, sigma = float(theta[0]), math.exp(theta[1])
                return stats.norm(loc=mu, scale=sigma), {"mu": mu, "sigma": sigma}
            return start, bounds, 1, decode

        if name == "Gumbel_2P":
            sigma0 = max(float(np.std(positive_times)), scale_reference * 0.1)
            start = [float(np.mean(positive_times)), math.log(sigma0)]
            bounds = [(-10.0 * max_time, 10.0 * max_time), log_scale_bounds]

            def decode(theta):
                mu, sigma = float(theta[0]), math.exp(theta[1])
                return (stats.gumbel_l(loc=mu, scale=sigma),
                        {"mu": mu, "sigma": sigma})
            return start, bounds, 1, decode

        if name == "Gamma_2P":
            start = [math.log(2.0), math.log(scale_reference / 2.0)]
            bounds = [log_shape_bounds, log_scale_bounds]

            def decode(theta):
                alpha, beta = math.exp(theta[0]), math.exp(theta[1])
                return (stats.gamma(a=alpha, scale=beta),
                        {"alpha": alpha, "beta": beta})
            return start, bounds, 0, decode

        if name == "Loglogistic_2P":
            start = [math.log(scale_reference), math.log(2.0)]
            bounds = [log_scale_bounds, log_shape_bounds]

            def decode(theta):
                alpha, beta = math.exp(theta[0]), math.exp(theta[1])
                return (stats.fisk(c=beta, scale=alpha),
                        {"alpha": alpha, "beta": beta})
            return start, bounds, 1, decode

        raise ValueError(f"Interval-censored fitting is unavailable for {name!r}.")

    def log_difference(log_larger, log_smaller):
        if not np.isfinite(log_larger):
            return log_larger
        if np.isneginf(log_smaller):
            return log_larger
        if log_smaller >= log_larger:
            return -np.inf
        return log_larger + math.log1p(-math.exp(log_smaller - log_larger))

    def interval_log_probabilities(frozen):
        """Vectorized log(F(upper)-F(lower)) with tail-stable fallback."""
        if len(interval_array) == 0:
            return np.empty(0, dtype=float)
        lower = interval_array[:, 0]
        upper = interval_array[:, 1]
        with np.errstate(all="ignore"):
            cdf_probability = frozen.cdf(upper) - frozen.cdf(lower)
            sf_probability = frozen.sf(lower) - frozen.sf(upper)
            probability = np.maximum(cdf_probability, sf_probability)
            output = np.log(probability)
        unstable = ~np.isfinite(output)
        if np.any(unstable):
            for index in np.flatnonzero(unstable):
                cdf_form = log_difference(
                    float(frozen.logcdf(upper[index])),
                    float(frozen.logcdf(lower[index])))
                sf_form = log_difference(
                    float(frozen.logsf(lower[index])),
                    float(frozen.logsf(upper[index])))
                finite = [v for v in (cdf_form, sf_form) if np.isfinite(v)]
                output[index] = max(finite) if finite else -np.inf
        return output

    auto = dist_name in ("Best_Fit", "auto")
    candidates = _DEG_DIST_CANDIDATES if auto else [dist_name]
    fitted = []
    n_observations = len(exact) + len(interval_array) + len(rc)

    for name in candidates:
        try:
            start, bounds, shape_index, decode = configuration(name)
        except ValueError:
            continue

        def negative_log_likelihood(theta):
            try:
                frozen, _ = decode(theta)
                contributions = []
                if len(exact):
                    contributions.extend(
                        np.asarray(frozen.logpdf(exact), dtype=float).tolist())
                if len(rc):
                    contributions.extend(
                        np.asarray(frozen.logsf(rc), dtype=float).tolist())
                contributions.extend(interval_log_probabilities(frozen).tolist())
                if not contributions or not np.all(np.isfinite(contributions)):
                    return 1e100
                value = -float(np.sum(contributions))
                return value if np.isfinite(value) else 1e100
            except (FloatingPointError, OverflowError, ValueError):
                return 1e100

        starts = [np.asarray(start, dtype=float)]
        if shape_index is not None:
            for shape in (0.7, 1.2, 3.0, 8.0):
                candidate_start = np.asarray(start, dtype=float).copy()
                candidate_start[shape_index] = math.log(shape)
                starts.append(candidate_start)
        if name.endswith("3P"):
            for location_logit in (-12.0, -4.0, 0.0):
                candidate_start = np.asarray(start, dtype=float).copy()
                candidate_start[-1] = location_logit
                starts.append(candidate_start)

        optimizer_candidates = []
        optimizer_diagnostics = None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            for method in ("L-BFGS-B", "Powell"):
                for candidate_start in starts:
                    options = ({"maxiter": 5000, "ftol": 1e-12}
                               if method == "L-BFGS-B"
                               else {"maxiter": 5000, "xtol": 1e-9,
                                     "ftol": 1e-9})
                    try:
                        result = minimize(
                            negative_log_likelihood, candidate_start,
                            method=method, bounds=bounds, options=options)
                    except Exception:
                        continue
                    if np.isfinite(result.fun) and result.fun < 1e99:
                        optimizer_candidates.append((method, result))
                # Multi-start L-BFGS-B is the normal path. Powell is retained
                # only as a fallback when every gradient-based start fails.
                try:
                    best, optimizer_diagnostics = select_best_optimizer_result(
                        optimizer_candidates, negative_log_likelihood,
                        bounds=bounds,
                    )
                    break
                except FitConvergenceError:
                    continue
        if optimizer_diagnostics is None:
            continue

        frozen, params = decode(best.x)
        k = len(best.x)
        loglik = -float(best.fun)
        aic = 2 * k - 2 * loglik
        aicc = (aic + 2 * k * (k + 1) / (n_observations - k - 1)
                if n_observations > k + 1 else None)
        bic = k * math.log(n_observations) - 2 * loglik
        fitted.append({
            "distribution": name,
            "frozen": frozen,
            "params": params,
            "loglik": loglik,
            "AICc": aicc,
            "BIC": bic,
            "AD": None,
            "optimizer": str(best.message),
            "fit_diagnostics": optimizer_diagnostics,
            "converged": True,
            "fit_eligible": True,
            "aicc_eligible": aicc is not None,
        })

    if not fitted:
        raise ValueError(
            "Could not fit an interval-censored life distribution to the unit data.")

    if auto:
        fitted = [result for result in fitted if result["aicc_eligible"]]
        if not fitted:
            raise ValueError(
                "No interval-censored candidate has a defined AICc for this "
                "sample size; select a specific distribution or add units."
            )

    def ranking_value(result):
        return result["AICc"] if result["AICc"] is not None else result["BIC"]

    fitted.sort(key=ranking_value)
    best = fitted[0]
    frozen = best["frozen"]
    observed_max = max_time
    try:
        q99 = float(frozen.ppf(0.99))
    except Exception:
        q99 = observed_max * 1.5
    xmax = max(observed_max * 1.5,
               q99 if np.isfinite(q99) else observed_max * 1.5)
    xmin = max(1e-9, float(np.min(positive_times)) * 0.3)
    xs = np.linspace(xmin, xmax, 200)

    def finite_or_none(value):
        value = float(value)
        return value if np.isfinite(value) else None

    def percentile(probability):
        try:
            return finite_or_none(frozen.ppf(probability))
        except Exception:
            return None

    out = {
        "distribution": best["distribution"],
        "params": {key: float(value) for key, value in best["params"].items()},
        "curve_x": xs.tolist(),
        "pdf": np.asarray(frozen.pdf(xs), dtype=float).tolist(),
        "cdf": np.asarray(frozen.cdf(xs), dtype=float).tolist(),
        "summary": {
            "mean": finite_or_none(frozen.mean()),
            "median": percentile(0.5),
            "B10": percentile(0.10),
            "B50": percentile(0.50),
        },
        "gof": {
            "AICc": (round(best["AICc"], 4)
                      if best["AICc"] is not None else None),
            "BIC": round(best["BIC"], 4),
            "AD": None,
            "LogLik": round(best["loglik"], 4),
        },
        "fit_method": "interval_censored_mle",
        "converged": True,
        "fit_eligible": True,
        "aicc_eligible": bool(best["aicc_eligible"]),
        "fit_diagnostics": best["fit_diagnostics"],
        "observation_counts": {
            "exact": int(len(exact)),
            "interval": int(len(interval_array)),
            "right_censored": int(len(rc)),
            "total": int(n_observations),
        },
    }
    if auto:
        out["comparison"] = [
            {
                "distribution": result["distribution"],
                "AICc": (round(result["AICc"], 4)
                          if result["AICc"] is not None else None),
                "BIC": round(result["BIC"], 4),
                "AD": None,
                "LogLik": round(result["loglik"], 4),
                "converged": True,
                "fit_eligible": True,
                "aicc_eligible": bool(result["aicc_eligible"]),
                "fit_diagnostics": result["fit_diagnostics"],
            }
            for result in fitted
        ]
    if reliability_time is not None and reliability_time > 0:
        R = float(frozen.sf(reliability_time))
        if np.isfinite(R):
            R = max(0.0, min(1.0, R))
            out["reliability"] = {
                "time": reliability_time, "R": R, "F": 1.0 - R}
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


# ---------------------------------------------------------------------------
# Joint hierarchical degradation model
# ---------------------------------------------------------------------------

def _hierarchical_quadrature(n_points=5):
    """Return a normalized two-dimensional Gauss-Hermite rule for N(0, I)."""
    from scipy.special import roots_hermitenorm

    nodes, weights = roots_hermitenorm(n_points)
    z = np.asarray([(x, y) for x in nodes for y in nodes], dtype=float)
    w = np.asarray([wx * wy for wx in weights for wy in weights], dtype=float)
    return z, np.log(w) - math.log(2.0 * math.pi)


def _hierarchical_unpack(params):
    """Decode the unconstrained population parameter vector."""
    mu_intercept, mu_log_slope, log_sd_intercept, log_sd_log_slope, rho_z, log_sigma = (
        np.asarray(params, dtype=float)
    )
    sd_intercept = math.exp(float(log_sd_intercept))
    sd_log_slope = math.exp(float(log_sd_log_slope))
    rho = math.tanh(float(rho_z))
    sigma = math.exp(float(log_sigma))
    covariance = np.asarray([
        [sd_intercept ** 2, rho * sd_intercept * sd_log_slope],
        [rho * sd_intercept * sd_log_slope, sd_log_slope ** 2],
    ])
    chol = np.asarray([
        [sd_intercept, 0.0],
        [rho * sd_log_slope, sd_log_slope * math.sqrt(max(1.0 - rho ** 2, 1e-12))],
    ])
    return {
        "mean": np.asarray([mu_intercept, mu_log_slope]),
        "sd_intercept": sd_intercept,
        "sd_log_slope": sd_log_slope,
        "rho": rho,
        "sigma": sigma,
        "covariance": covariance,
        "chol": chol,
    }


def _hierarchical_unit_mode(unit, decoded, direction_sign):
    """Conditional random-effect mode and curvature for adaptive quadrature."""
    times = unit["t"]
    response = unit["y"]
    sigma2 = decoded["sigma"] ** 2
    chol = decoded["chol"]

    design = np.column_stack((times, np.ones(len(times))))
    raw_slope, raw_intercept = np.linalg.lstsq(design, response, rcond=None)[0]
    slope_floor = max(float(np.std(response))
                      / max(float(np.ptp(times)), 1e-6) * 1e-4, 1e-9)
    initial_effect = np.asarray([
        raw_intercept,
        math.log(max(direction_sign * float(raw_slope), slope_floor)),
    ])
    try:
        z = np.linalg.solve(chol, initial_effect - decoded["mean"])
        z = np.clip(z, -6.0, 6.0)
    except np.linalg.LinAlgError:
        z = np.zeros(2)

    def evaluate(value):
        effect = decoded["mean"] + chol @ value
        slope_term = direction_sign * math.exp(float(np.clip(effect[1], -50, 50))) * times
        residual = response - effect[0] - slope_term
        objective = 0.5 * float(value @ value) + 0.5 * float(residual @ residual) / sigma2
        gradient_effect = -np.asarray([
            np.sum(residual), np.sum(residual * slope_term),
        ]) / sigma2
        hessian_effect = np.asarray([
            [len(times), np.sum(slope_term)],
            [np.sum(slope_term), np.sum(slope_term ** 2 - residual * slope_term)],
        ]) / sigma2
        gradient = value + chol.T @ gradient_effect
        hessian = np.eye(2) + chol.T @ hessian_effect @ chol
        return objective, gradient, hessian

    for _ in range(12):
        objective, gradient, hessian = evaluate(z)
        eigen_min = float(np.min(np.linalg.eigvalsh(hessian)))
        if eigen_min <= 1e-7:
            hessian = hessian + np.eye(2) * (1e-6 - eigen_min)
        try:
            step = np.linalg.solve(hessian, gradient)
        except np.linalg.LinAlgError:
            break
        if np.linalg.norm(step) < 1e-7:
            break
        if np.linalg.norm(step) > 3.0:
            step *= 3.0 / np.linalg.norm(step)
        accepted = False
        for shrink in (1.0, 0.5, 0.25, 0.1, 0.05):
            candidate = z - shrink * step
            candidate_objective, _, _ = evaluate(candidate)
            if candidate_objective < objective:
                z = candidate
                accepted = True
                break
        if not accepted:
            break

    _, _, hessian = evaluate(z)
    eigen_min = float(np.min(np.linalg.eigvalsh(hessian)))
    if eigen_min <= 1e-8:
        hessian = hessian + np.eye(2) * (1e-7 - eigen_min)
    return z, hessian


def _hierarchical_nll(params, units, direction_sign, nodes, log_weights):
    """Adaptive-quadrature marginal negative log likelihood."""
    from scipy.special import logsumexp

    try:
        decoded = _hierarchical_unpack(params)
        sigma = decoded["sigma"]
        if not (np.isfinite(sigma) and sigma > 0):
            return 1e100
        constant = math.log(2.0 * math.pi) + 2.0 * math.log(sigma)
        total = 0.0
        with np.errstate(over="ignore", invalid="ignore"):
            for unit in units:
                mode, hessian = _hierarchical_unit_mode(unit, decoded, direction_sign)
                adaptive_chol = np.linalg.cholesky(np.linalg.inv(hessian))
                z_points = mode + nodes @ adaptive_chol.T
                effects = decoded["mean"] + z_points @ decoded["chol"].T
                intercept = effects[:, 0]
                slope = direction_sign * np.exp(np.clip(effects[:, 1], -50.0, 50.0))
                predicted = intercept[:, None] + slope[:, None] * unit["t"][None, :]
                residual = unit["y"][None, :] - predicted
                conditional = -0.5 * (
                    len(unit["t"]) * constant
                    + np.sum((residual / sigma) ** 2, axis=1)
                )
                adjustment = (
                    conditional
                    - 0.5 * np.sum(z_points ** 2, axis=1)
                    + 0.5 * np.sum(nodes ** 2, axis=1)
                )
                marginal = (
                    float(np.sum(np.log(np.diag(adaptive_chol))))
                    + float(logsumexp(adjustment + log_weights))
                )
                if not np.isfinite(marginal):
                    return 1e100
                total += marginal
        return -total if np.isfinite(total) else 1e100
    except (ArithmeticError, FloatingPointError, ValueError):
        return 1e100


def _hierarchical_initial_values(units, direction_sign):
    """Construct scale-aware starting values and optimizer bounds."""
    all_y = np.concatenate([unit["y"] for unit in units])
    all_t = np.concatenate([unit["t"] for unit in units])
    time_span = max(float(np.max(all_t) - np.min(all_t)), 1e-6)
    response_scale = max(float(np.std(all_y)), 0.1)
    slope_floor = max(response_scale / time_span * 1e-4, 1e-9)

    intercepts = []
    log_slopes = []
    residuals = []
    for unit in units:
        design = np.column_stack((unit["t"], np.ones(len(unit["t"]))))
        slope, intercept = np.linalg.lstsq(design, unit["y"], rcond=None)[0]
        magnitude = max(direction_sign * float(slope), slope_floor)
        intercepts.append(float(intercept))
        log_slopes.append(math.log(magnitude))
        residuals.extend((unit["y"] - (slope * unit["t"] + intercept)).tolist())

    mu_intercept = float(np.median(intercepts))
    mu_log_slope = float(np.median(log_slopes))
    sd_intercept = max(float(np.std(intercepts, ddof=1)) if len(intercepts) > 1 else 0.0,
                       0.08 * response_scale, 1e-3)
    sd_log_slope = max(float(np.std(log_slopes, ddof=1)) if len(log_slopes) > 1 else 0.0,
                       0.12)
    residual_sigma = max(float(np.sqrt(np.mean(np.square(residuals)))) if residuals else 0.0,
                         0.03 * response_scale, 1e-3)
    x0 = np.asarray([
        mu_intercept, mu_log_slope, math.log(sd_intercept),
        math.log(sd_log_slope), 0.0, math.log(residual_sigma),
    ])

    slope_reference = max(response_scale / time_span, slope_floor)
    y_min, y_max = float(np.min(all_y)), float(np.max(all_y))
    bounds = [
        (y_min - 5.0 * response_scale, y_max + 5.0 * response_scale),
        (math.log(slope_reference) - 10.0, math.log(slope_reference) + 10.0),
        (math.log(1e-4), math.log(5.0 * response_scale)),
        (math.log(1e-3), math.log(3.0)),
        (-3.0, 3.0),
        (math.log(1e-5), math.log(5.0 * response_scale)),
    ]
    return x0, bounds


def _fit_hierarchical_nlme(units, direction_sign, *, initial=None,
                           n_starts=3, maxiter=350):
    """Fit the joint repeated-measurement model by quadrature marginal MLE."""
    from scipy.optimize import minimize

    nodes, log_weights = _hierarchical_quadrature(5)
    default_start, bounds = _hierarchical_initial_values(units, direction_sign)
    if initial is not None:
        start = np.asarray(initial, dtype=float)
        start = np.asarray([
            min(max(value, lower + 1e-8), upper - 1e-8)
            for value, (lower, upper) in zip(start, bounds)
        ])
    else:
        start = default_start

    offsets = [
        np.zeros(6),
        np.asarray([0.0, 0.15, 0.20, -0.15, 0.35, 0.05]),
        np.asarray([0.0, -0.15, -0.15, 0.20, -0.35, -0.05]),
    ]
    results = []
    objective = lambda p: _hierarchical_nll(
        p, units, direction_sign, nodes, log_weights)
    for offset in offsets[:max(1, n_starts)]:
        candidate = np.asarray([
            min(max(value, lower + 1e-8), upper - 1e-8)
            for value, (lower, upper) in zip(start + offset, bounds)
        ])
        result = minimize(
            objective, candidate, method="L-BFGS-B", bounds=bounds,
            options={"maxiter": maxiter, "ftol": 1e-9, "gtol": 1e-6},
        )
        if np.isfinite(getattr(result, "fun", np.inf)):
            results.append(result)
    if not results:
        raise ValueError("Hierarchical degradation optimization produced no finite fit.")

    best = min(results, key=lambda result: float(result.fun))
    decoded = _hierarchical_unpack(best.x)
    n_observations = sum(len(unit["t"]) for unit in units)
    parameter_names = [
        "mean_intercept", "mean_log_slope", "log_sd_intercept",
        "log_sd_log_slope", "atanh_correlation", "log_residual_sigma",
    ]
    warnings_out = []
    finite_solution = bool(
        np.isfinite(best.fun) and np.all(np.isfinite(np.asarray(best.x, dtype=float))))
    gradient = np.asarray(getattr(best, "jac", np.full(6, np.nan)), dtype=float)
    gradient_finite = bool(gradient.shape == (6,) and np.all(np.isfinite(gradient)))
    projected_gradient = gradient.copy()
    bound_contacts = []
    for index, (value, (lower, upper)) in enumerate(zip(best.x, bounds)):
        tolerance = 1e-6 * max(abs(value), abs(lower), abs(upper), 1.0)
        at_lower = value <= lower + tolerance
        at_upper = value >= upper - tolerance
        if at_lower or at_upper:
            bound_contacts.append({
                "parameter": parameter_names[index],
                "side": "lower" if at_lower else "upper",
                "value": float(value),
                "bound": float(lower if at_lower else upper),
            })
        if gradient_finite:
            if at_lower and gradient[index] >= 0:
                projected_gradient[index] = 0.0
            elif at_upper and gradient[index] <= 0:
                projected_gradient[index] = 0.0
    projected_gradient_raw = (
        float(np.linalg.norm(projected_gradient, ord=np.inf))
        if gradient_finite else None)
    projected_gradient_norm = (
        projected_gradient_raw / max(1.0, abs(float(best.fun)))
        if projected_gradient_raw is not None else None)
    gradient_tolerance = 1e-4
    gradient_acceptable = bool(
        projected_gradient_norm is not None
        and projected_gradient_norm <= gradient_tolerance)
    optimizer_converged = bool(
        best.success and finite_solution and gradient_finite and gradient_acceptable)
    if not optimizer_converged:
        warnings_out.append("optimizer_did_not_converge")
    if not gradient_finite:
        warnings_out.append("optimizer_gradient_is_not_finite")
    elif not gradient_acceptable:
        warnings_out.append("large_projected_gradient")
    if bound_contacts:
        warnings_out.append("parameter_on_optimizer_bound")
    if len(units) < 6:
        warnings_out.append("fewer_than_six_units_limits_random_effect_identification")
    if decoded["sd_intercept"] <= 2e-4:
        warnings_out.append("random_intercept_variance_at_boundary")
    if decoded["sd_log_slope"] <= 2e-3:
        warnings_out.append("random_log_slope_variance_at_boundary")
    if abs(decoded["rho"]) >= 0.98:
        warnings_out.append("random_effect_correlation_near_boundary")

    condition_number = None
    try:
        inverse_information = np.asarray(best.hess_inv.todense(), dtype=float)
        condition_number = float(np.linalg.cond(inverse_information))
        if not np.isfinite(condition_number):
            condition_number = None
        elif condition_number > 1e12:
            warnings_out.append("optimizer_inverse_hessian_is_ill_conditioned")
    except (AttributeError, ValueError, np.linalg.LinAlgError):
        condition_number = None

    quadrature_nll_5 = float(best.fun)
    nodes_9, log_weights_9 = _hierarchical_quadrature(9)
    quadrature_nll_9 = float(_hierarchical_nll(
        best.x, units, direction_sign, nodes_9, log_weights_9))
    quadrature_delta = abs(quadrature_nll_9 - quadrature_nll_5)
    quadrature_tolerance = max(1e-3, 1e-4 * len(units))
    quadrature_acceptable = bool(
        np.isfinite(quadrature_nll_9)
        and quadrature_delta <= quadrature_tolerance)
    if not quadrature_acceptable:
        warnings_out.append("adaptive_quadrature_order_is_not_stable")

    fit_eligible = bool(
        optimizer_converged
        and len(units) >= 6
        and not bound_contacts
        and "random_intercept_variance_at_boundary" not in warnings_out
        and "random_log_slope_variance_at_boundary" not in warnings_out
        and "random_effect_correlation_near_boundary" not in warnings_out
        and "optimizer_inverse_hessian_is_ill_conditioned" not in warnings_out
        and quadrature_acceptable
    )
    return {
        "params": np.asarray(best.x, dtype=float),
        "decoded": decoded,
        "nodes": nodes,
        "log_weights": log_weights,
        "converged": optimizer_converged,
        "fit_eligible": fit_eligible,
        "log_likelihood": -float(best.fun),
        "diagnostics": {
            "optimizer": "L-BFGS-B",
            "optimizer_message": str(best.message),
            "optimizer_status": int(best.status),
            "optimizer_success": bool(best.success),
            "iterations": int(getattr(best, "nit", 0)),
            "function_evaluations": int(getattr(best, "nfev", 0)),
            "starts_attempted": len(results),
            "quadrature_points_per_dimension": 5,
            "quadrature": "adaptive_gauss_hermite",
            "n_units": len(units),
            "n_observations": n_observations,
            "optimizer_inverse_hessian_condition_number": condition_number,
            "projected_gradient_norm": projected_gradient_norm,
            "projected_gradient_raw_norm": projected_gradient_raw,
            "projected_gradient_tolerance": gradient_tolerance,
            "bound_contacts": bound_contacts,
            "quadrature_check": {
                "nll_5_point": quadrature_nll_5,
                "nll_9_point": quadrature_nll_9,
                "absolute_delta": quadrature_delta,
                "tolerance": quadrature_tolerance,
                "acceptable": quadrature_acceptable,
            },
            "identifiability_warnings": warnings_out,
        },
    }


def _hierarchical_output_parameters(params, response_center, response_scale):
    """Convert standardized fit parameters back to the model response scale."""
    decoded = _hierarchical_unpack(params)
    mean_intercept = response_center + response_scale * decoded["mean"][0]
    mean_log_slope = math.log(response_scale) + decoded["mean"][1]
    sd_intercept = response_scale * decoded["sd_intercept"]
    sd_log_slope = decoded["sd_log_slope"]
    covariance = np.asarray([
        [sd_intercept ** 2, decoded["rho"] * sd_intercept * sd_log_slope],
        [decoded["rho"] * sd_intercept * sd_log_slope, sd_log_slope ** 2],
    ])
    return {
        "mean_intercept": float(mean_intercept),
        "mean_log_slope": float(mean_log_slope),
        "median_slope_magnitude": float(math.exp(np.clip(mean_log_slope, -700, 700))),
        "sd_intercept": float(sd_intercept),
        "sd_log_slope": float(sd_log_slope),
        "correlation": float(decoded["rho"]),
        "covariance": covariance,
        "residual_sigma": float(response_scale * decoded["sigma"]),
    }


def _hierarchical_life_distribution(params, threshold, direction_sign, n_samples,
                                    rng, reliability_time=None):
    """Monte Carlo first-passage distribution induced by population effects."""
    decoded = _hierarchical_unpack(params)
    effects = rng.multivariate_normal(
        decoded["mean"], decoded["covariance"], size=n_samples)
    intercept = effects[:, 0]
    slope_magnitude = np.exp(np.clip(effects[:, 1], -700.0, 700.0))
    safe_margin = direction_sign * (threshold - intercept)
    lives = np.zeros(n_samples, dtype=float)
    safe = safe_margin > 0
    lives[safe] = safe_margin[safe] / slope_magnitude[safe]
    lives = np.nan_to_num(lives, nan=0.0, posinf=np.finfo(float).max)

    percentiles = np.quantile(lives, [0.01, 0.10, 0.50, 0.90])
    quantiles = {
        "B1": float(percentiles[0]),
        "B10": float(percentiles[1]),
        "B50": float(percentiles[2]),
        "B90": float(percentiles[3]),
    }
    upper = float(np.quantile(lives, 0.995))
    if reliability_time is not None and reliability_time > upper:
        upper = float(reliability_time)
    upper = max(upper, 1e-9)
    curve_x = np.linspace(0.0, upper, 121)
    sorted_lives = np.sort(lives)
    cdf = np.searchsorted(sorted_lives, curve_x, side="right") / n_samples
    reliability = None
    if reliability_time is not None:
        reliability_value = float(np.mean(lives > reliability_time))
        reliability = {
            "time": float(reliability_time),
            "R": reliability_value,
            "F": 1.0 - reliability_value,
        }
    return {
        "type": "induced_first_passage",
        "n_monte_carlo": int(n_samples),
        "summary": {
            "mean": float(np.mean(lives)),
            "B10": quantiles["B10"],
            "B50": quantiles["B50"],
        },
        "quantiles": quantiles,
        "curve_x": curve_x.tolist(),
        "cdf": cdf.tolist(),
        "survival": (1.0 - cdf).tolist(),
        "reliability": reliability,
    }


def _hierarchical_percentile_intervals(records, confidence):
    if len(records) < 2:
        return {}
    lower = 100.0 * (1.0 - confidence) / 2.0
    upper = 100.0 - lower
    keys = records[0].keys()
    return {
        key: [float(np.percentile([record[key] for record in records], lower)),
              float(np.percentile([record[key] for record in records], upper))]
        for key in keys
    }


def _hierarchical_parametric_bootstrap(units, fitted, threshold, direction_sign,
                                       response_center, response_scale, request,
                                       seed_sequence):
    """Refit simulated repeated-measurement datasets; never create life rows."""
    requested = int(request.n_bootstrap)
    bootstrap_mc = 5000
    outcome_counts = {
        "eligible": 0,
        "nonconverged": 0,
        "ineligible_boundary": 0,
        "ineligible_quadrature": 0,
        "ineligible_identifiability": 0,
        "simulation_or_refit_error": 0,
        "skipped_base_fit_ineligible": 0,
    }
    base = {
        "method": "parametric_bootstrap",
        "confidence_level": float(request.ci),
        "parameter_intervals": {},
        "summary_intervals": {},
        "reliability_interval": None,
        "diagnostics": {
            "requested": requested,
            "successful": 0,
            "failed": 0,
            "status": "not_requested" if requested == 0 else "running",
            "seed": request.seed,
            "warnings": [],
            "refit_outcomes": outcome_counts,
            "minimum_accepted_refits": (
                max(2, math.ceil(0.8 * requested)) if requested else 0),
            "life_monte_carlo_draws_per_refit": bootstrap_mc,
            "rng_stream_policy": (
                "independent_seedsequence_streams_per_bootstrap_replicate_"
                "and_life_evaluation"),
        },
    }
    if not fitted["fit_eligible"]:
        outcome_counts["skipped_base_fit_ineligible"] = requested
        base["diagnostics"]["status"] = "diagnostic_only"
        base["diagnostics"]["warnings"].append(
            "bootstrap_suppressed_because_base_fit_is_ineligible")
        return base
    if requested == 0:
        return base

    if requested < 100:
        base["diagnostics"]["warnings"].append(
            "bootstrap_replication_count_below_100_has_unstable_percentile_endpoints")

    decoded = fitted["decoded"]
    parameter_records = []
    summary_records = []
    reliability_records = []
    # Keep bootstrap functional evaluation independent of the point-estimate
    # Monte Carlo setting and of every other bootstrap replicate.
    replicate_sequences = seed_sequence.spawn(requested)
    for replicate_sequence in replicate_sequences:
        simulation_sequence, life_sequence = replicate_sequence.spawn(2)
        simulation_rng = np.random.default_rng(simulation_sequence)
        life_rng = np.random.default_rng(life_sequence)
        random_effects = simulation_rng.multivariate_normal(
            decoded["mean"], decoded["covariance"], size=len(units))
        simulated_units = []
        for unit, effect in zip(units, random_effects):
            mean = effect[0] + direction_sign * math.exp(
                float(np.clip(effect[1], -50.0, 50.0))) * unit["t"]
            simulated_units.append({
                "id": unit["id"],
                "t": unit["t"],
                "y": mean + simulation_rng.normal(
                    0.0, decoded["sigma"], len(unit["t"])),
            })
        try:
            refit = _fit_hierarchical_nlme(
                simulated_units, direction_sign, initial=fitted["params"],
                n_starts=3, maxiter=350)
            if not refit["converged"]:
                outcome_counts["nonconverged"] += 1
                continue
            if not refit["fit_eligible"]:
                refit_warnings = set(
                    refit["diagnostics"]["identifiability_warnings"])
                if ("parameter_on_optimizer_bound" in refit_warnings
                        or "random_intercept_variance_at_boundary" in refit_warnings
                        or "random_log_slope_variance_at_boundary" in refit_warnings
                        or "random_effect_correlation_near_boundary" in refit_warnings):
                    outcome_counts["ineligible_boundary"] += 1
                elif "adaptive_quadrature_order_is_not_stable" in refit_warnings:
                    outcome_counts["ineligible_quadrature"] += 1
                else:
                    outcome_counts["ineligible_identifiability"] += 1
                continue
            converted = _hierarchical_output_parameters(
                refit["params"], response_center, response_scale)
            parameter_record = {
                "mean_intercept": converted["mean_intercept"],
                "mean_log_slope": converted["mean_log_slope"],
                "sd_intercept": converted["sd_intercept"],
                "sd_log_slope": converted["sd_log_slope"],
                "correlation": converted["correlation"],
                "residual_sigma": converted["residual_sigma"],
            }
            life = _hierarchical_life_distribution(
                refit["params"], threshold, direction_sign, bootstrap_mc, life_rng,
                reliability_time=request.reliability_time)
            summary_record = {
                "mean": life["summary"]["mean"],
                "B10": life["summary"]["B10"],
                "B50": life["summary"]["B50"],
            }
            parameter_records.append(parameter_record)
            summary_records.append(summary_record)
            if life["reliability"] is not None:
                reliability_records.append(life["reliability"]["R"])
            outcome_counts["eligible"] += 1
        except (ArithmeticError, ValueError, np.linalg.LinAlgError):
            outcome_counts["simulation_or_refit_error"] += 1
            continue

    successful = len(parameter_records)
    base["diagnostics"]["successful"] = successful
    base["diagnostics"]["failed"] = requested - successful
    minimum_accepted = base["diagnostics"]["minimum_accepted_refits"]
    intervals_exist = successful >= 2
    if successful == requested and intervals_exist and requested >= 100:
        base["diagnostics"]["status"] = "complete"
    elif successful >= minimum_accepted and intervals_exist:
        base["diagnostics"]["status"] = "partial"
        if successful < requested:
            base["diagnostics"]["warnings"].append("some_bootstrap_refits_failed")
        if successful < 20:
            base["diagnostics"]["warnings"].append(
                "fewer_than_20_eligible_refits_interval_is_diagnostic")
    else:
        base["diagnostics"]["status"] = "failed"
        base["diagnostics"]["warnings"].append(
            "too_few_successful_refits_for_percentile_intervals")
        return base

    base["parameter_intervals"] = _hierarchical_percentile_intervals(
        parameter_records, request.ci)
    base["summary_intervals"] = _hierarchical_percentile_intervals(
        summary_records, request.ci)
    if len(reliability_records) >= 2:
        tail = 100.0 * (1.0 - request.ci) / 2.0
        base["reliability_interval"] = [
            float(np.percentile(reliability_records, tail)),
            float(np.percentile(reliability_records, 100.0 - tail)),
        ]
    return base


def _hierarchical_posterior_effect(unit, fitted, direction_sign):
    """Empirical-Bayes posterior mean effects for display-only subject paths."""
    from scipy.special import logsumexp

    decoded = fitted["decoded"]
    mode, hessian = _hierarchical_unit_mode(unit, decoded, direction_sign)
    adaptive_chol = np.linalg.cholesky(np.linalg.inv(hessian))
    z_points = mode + fitted["nodes"] @ adaptive_chol.T
    effects = decoded["mean"] + z_points @ decoded["chol"].T
    slopes = direction_sign * np.exp(np.clip(effects[:, 1], -50.0, 50.0))
    predicted = effects[:, 0, None] + slopes[:, None] * unit["t"][None, :]
    residual = unit["y"][None, :] - predicted
    conditional = -0.5 * (
        len(unit["t"]) * (math.log(2.0 * math.pi) + 2.0 * math.log(decoded["sigma"]))
        + np.sum((residual / decoded["sigma"]) ** 2, axis=1)
    )
    log_posterior = (
        fitted["log_weights"] + conditional
        - 0.5 * np.sum(z_points ** 2, axis=1)
        + 0.5 * np.sum(fitted["nodes"] ** 2, axis=1)
    )
    weights = np.exp(log_posterior - logsumexp(log_posterior))
    return np.sum(weights[:, None] * effects, axis=0)


def _hierarchical_degradation(req, groups):
    """Joint threshold-first degradation analysis for linear/exponential paths."""
    if req.degradation_model not in ("linear", "exponential"):
        raise HTTPException(
            status_code=400,
            detail="hierarchical_nlme currently supports linear and exponential degradation models.",
        )
    direction_sign = 1.0 if req.threshold_direction == "above" else -1.0
    if req.degradation_model == "exponential":
        if req.threshold <= 0 or np.any(np.asarray(req.measurements) <= 0):
            raise HTTPException(
                status_code=400,
                detail="Exponential hierarchical degradation requires a positive threshold and measurements.",
            )
        transform = np.log
        inverse = np.exp
        response_scale_name = "log_measurement"
    else:
        transform = lambda values: np.asarray(values, dtype=float)
        inverse = lambda values: np.asarray(values, dtype=float)
        response_scale_name = "measurement"

    prepared = []
    ordered_groups = []
    for uid, group in groups.items():
        order = np.argsort(np.asarray(group["t"], dtype=float))
        times = np.asarray(group["t"], dtype=float)[order]
        measurements = np.asarray(group["m"], dtype=float)[order]
        if len(times) < 2:
            raise HTTPException(
                status_code=400,
                detail=f"Unit {uid!r} needs at least two measurements for hierarchical analysis.",
            )
        if np.any(times < 0) or np.any(np.diff(times) <= 0):
            raise HTTPException(
                status_code=400,
                detail=(f"Unit {uid!r} must have unique, strictly increasing "
                        "non-negative measurement times."),
            )
        if times[-1] <= 0:
            raise HTTPException(
                status_code=400, detail=f"Unit {uid!r} must be observed beyond time 0.")
        ordered_groups.append((uid, times, measurements))
        prepared.append({"id": uid, "t": times, "raw_y": transform(measurements)})
    if len(prepared) < 4:
        raise HTTPException(
            status_code=400,
            detail="Hierarchical degradation requires at least four independently measured units.",
        )

    all_response = np.concatenate([unit["raw_y"] for unit in prepared])
    response_center = float(np.median(all_response))
    response_scale = max(float(np.std(all_response)),
                         float(np.ptp(all_response)) / 4.0, 1e-8)
    threshold_response = float(transform(np.asarray([req.threshold]))[0])
    threshold_standardized = (threshold_response - response_center) / response_scale
    units = [{
        "id": unit["id"], "t": unit["t"],
        "y": (unit["raw_y"] - response_center) / response_scale,
    } for unit in prepared]

    try:
        fitted = _fit_hierarchical_nlme(units, direction_sign)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not fitted["converged"]:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Hierarchical degradation optimization did not converge.",
                "diagnostics": fitted["diagnostics"],
            },
        )

    root_seed_sequence = np.random.SeedSequence(req.seed)
    life_seed_sequence, bootstrap_seed_sequence = root_seed_sequence.spawn(2)
    life_rng = np.random.default_rng(life_seed_sequence)
    life_distribution = _hierarchical_life_distribution(
        fitted["params"], threshold_standardized, direction_sign,
        req.n_monte_carlo, life_rng, reliability_time=req.reliability_time)
    bootstrap = _hierarchical_parametric_bootstrap(
        units, fitted, threshold_standardized, direction_sign,
        response_center, response_scale, req, bootstrap_seed_sequence)
    converted = _hierarchical_output_parameters(
        fitted["params"], response_center, response_scale)

    paths = []
    unit_table = []
    projected = []
    observed_crossings = 0
    for (uid, times, measurements), unit in zip(ordered_groups, units):
        effect = _hierarchical_posterior_effect(unit, fitted, direction_sign)
        signed_slope_std = direction_sign * math.exp(float(np.clip(effect[1], -50, 50)))
        t_failure = direction_sign * (threshold_standardized - effect[0])
        t_failure = (float(t_failure / abs(signed_slope_std))
                     if t_failure > 0 else 0.0)
        projected.append(t_failure)
        t_max = float(times[-1])
        display_failure = min(t_failure, max(t_max * 5.0, t_max + 1.0))
        fit_times = np.linspace(float(times[0]), max(t_max, display_failure) * 1.05, 60)
        fitted_standardized = effect[0] + signed_slope_std * fit_times
        fitted_response = response_center + response_scale * fitted_standardized
        fitted_measurements = inverse(fitted_response)
        observed_flags = ((measurements >= req.threshold)
                          if req.threshold_direction == "above"
                          else (measurements <= req.threshold))
        inspection_lower = inspection_upper = None
        if np.any(observed_flags):
            first = int(np.flatnonzero(observed_flags)[0])
            inspection_upper = float(times[first])
            inspection_lower = float(times[first - 1]) if first > 0 else 0.0
            observed_crossings += 1
        predicted_observed = inverse(
            response_center + response_scale
            * (effect[0] + signed_slope_std * times))
        ss_res = float(np.sum((measurements - predicted_observed) ** 2))
        ss_tot = float(np.sum((measurements - np.mean(measurements)) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
        intercept_response = response_center + response_scale * effect[0]
        log_slope_response = math.log(response_scale) + effect[1]
        if req.degradation_model == "exponential":
            a_value = direction_sign * math.exp(float(np.clip(log_slope_response, -700, 700)))
            b_value = math.exp(float(np.clip(intercept_response, -700, 700)))
        else:
            a_value = direction_sign * math.exp(float(np.clip(log_slope_response, -700, 700)))
            b_value = intercept_response
        paths.append({
            "unit_id": uid,
            "t": times.tolist(),
            "m": measurements.tolist(),
            "fit_t": fit_times.tolist(),
            "fit_m": np.asarray(fitted_measurements, dtype=float).tolist(),
        })
        unit_table.append({
            "unit_id": uid,
            "projected_failure": round(t_failure, 4),
            "projection_lower": None,
            "projection_upper": None,
            "inspection_lower": (round(inspection_lower, 4)
                                 if inspection_lower is not None else None),
            "inspection_upper": (round(inspection_upper, 4)
                                 if inspection_upper is not None else None),
            "censor_time": None,
            "life_observation": "joint_longitudinal_measurements",
            "interval_source": ("observed_threshold_crossing_display_only"
                                if inspection_upper is not None else None),
            "a": round(a_value, 6),
            "b": round(b_value, 6),
            "r2": round(r2, 4),
        })

    n_observations = sum(len(unit["t"]) for unit in units)
    parameter_count = 6
    standardized_log_likelihood = fitted["log_likelihood"]
    standardization_jacobian = -n_observations * math.log(response_scale)
    response_scale_log_likelihood = (
        standardized_log_likelihood + standardization_jacobian)
    transform_jacobian = (
        -float(np.sum(np.log(np.asarray(req.measurements, dtype=float))))
        if req.degradation_model == "exponential" else 0.0)
    data_scale_log_likelihood = response_scale_log_likelihood + transform_jacobian
    hierarchical_fit = {
        "model": req.degradation_model,
        "response_scale": response_scale_name,
        "converged": fitted["converged"],
        "fit_eligible": fitted["fit_eligible"],
        "population_parameters": {
            "mean_intercept": converted["mean_intercept"],
            "mean_log_slope": converted["mean_log_slope"],
            "median_slope_magnitude": converted["median_slope_magnitude"],
        },
        "random_effects": {
            "sd_intercept": converted["sd_intercept"],
            "sd_log_slope": converted["sd_log_slope"],
            "correlation": converted["correlation"],
            "covariance": converted["covariance"].tolist(),
        },
        "residual_sigma": converted["residual_sigma"],
        "inference_status": (
            "eligible" if fitted["fit_eligible"] else "diagnostic_only"),
        "log_likelihood": data_scale_log_likelihood,
        "log_likelihood_data_scale": data_scale_log_likelihood,
        "log_likelihood_response_scale": response_scale_log_likelihood,
        "log_likelihood_standardized": standardized_log_likelihood,
        "likelihood_scale": "raw_measurement",
        "likelihood_jacobians": {
            "response_standardization": standardization_jacobian,
            "log_transform": transform_jacobian,
        },
        "AIC": 2.0 * parameter_count - 2.0 * data_scale_log_likelihood,
        "BIC": math.log(len(units)) * parameter_count - 2.0 * data_scale_log_likelihood,
        "BIC_sample_size": {
            "value": len(units),
            "unit": "independent_units",
        },
        "life_distribution": life_distribution,
        "uncertainty": bootstrap,
        "diagnostics": fitted["diagnostics"],
    }
    return {
        "analysis_method": "hierarchical_nlme",
        "paths": paths,
        "threshold": req.threshold,
        "threshold_direction": req.threshold_direction,
        "degradation_model": req.degradation_model,
        "projected_failure_times": [round(value, 4) for value in projected],
        "distribution_fit": None,
        "distribution_fit_error": None,
        "hierarchical_fit": hierarchical_fit,
        "life_data_summary": {
            "exact": 0,
            "interval": 0,
            "right_censored": 0,
            "total_units_used": len(units),
            "units_dropped": 0,
            "interval_sources": {
                "observed_threshold_crossing_display_only": observed_crossings,
            },
            "longitudinal_measurements": n_observations,
            "likelihood": "joint_longitudinal_measurement",
        },
        "projection_uncertainty": {
            "method": "hierarchical_parametric_bootstrap",
            "confidence_level": req.ci,
            "intervals_available": len(bootstrap["summary_intervals"]),
            "likelihood_role": "no_separate_life_likelihood",
        },
        "unit_table": unit_table,
    }


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
    if req.threshold_direction not in ("above", "below"):
        raise HTTPException(
            status_code=400, detail="threshold_direction must be 'above' or 'below'.")
    if not 0 < req.ci < 1:
        raise HTTPException(status_code=400, detail="ci must be between 0 and 1.")
    if req.reliability_time is not None and req.reliability_time < 0:
        raise HTTPException(status_code=400, detail="reliability_time must be non-negative.")
    if not (np.isfinite(req.threshold)
            and np.all(np.isfinite(req.times))
            and np.all(np.isfinite(req.measurements))):
        raise HTTPException(
            status_code=400,
            detail="threshold, times, and measurements must all be finite.")

    # Group measurements by unit, preserving order.
    groups: dict = {}
    for uid, t, m in zip(req.unit_ids, req.times, req.measurements):
        groups.setdefault(str(uid), {"t": [], "m": []})
        groups[str(uid)]["t"].append(float(t))
        groups[str(uid)]["m"].append(float(m))

    if req.analysis_method == "hierarchical_nlme":
        return _hierarchical_degradation(req, groups)

    thr = req.threshold
    z = float(norm.ppf(1.0 - (1.0 - req.ci) / 2.0))

    paths = []
    projected = []           # per-path point projections (display only)
    exact_failures = []      # one likelihood contribution per unit
    interval_observations = []
    right_censored = []
    interval_source_counts = {"observed_threshold_crossing": 0}
    projection_intervals_available = 0
    unit_table = []
    for uid, g in groups.items():
        order = np.argsort(np.asarray(g["t"], dtype=float))
        observed_t = np.asarray(g["t"], dtype=float)[order]
        observed_m = np.asarray(g["m"], dtype=float)[order]
        if np.any(observed_t < 0) or np.any(np.diff(observed_t) <= 0):
            raise HTTPException(
                status_code=400,
                detail=(f"Unit {uid!r} must have unique, strictly increasing "
                        "non-negative measurement times."))
        if observed_t[-1] <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Unit {uid!r} must be observed beyond time 0.")

        failed_flags = ((observed_m >= thr) if req.threshold_direction == "above"
                        else (observed_m <= thr))
        observed_interval = None
        if np.any(failed_flags):
            first_failed = int(np.flatnonzero(failed_flags)[0])
            upper = float(observed_t[first_failed])
            lower = (float(observed_t[first_failed - 1])
                     if first_failed > 0 else 0.0)
            if upper > lower:
                observed_interval = (lower, upper)

        fit = _fit_degradation_unit(
            observed_t, observed_m, thr, req.degradation_model)
        path = {"unit_id": uid, "t": observed_t.tolist(),
                "m": observed_m.tolist(), "fit_t": None, "fit_m": None}
        tmax = float(observed_t[-1])
        life_observation = "unusable"
        interval_source = None
        censor_time = None
        inspection_lo = inspection_up = None
        projection_lo = projection_up = None
        t_fail = None
        if fit is not None:
            t_fail, r2, se = fit["t_fail"], fit["r2"], fit["se"]
            extend_to = max(tmax, t_fail if t_fail else tmax) * 1.05
            xs = np.linspace(float(observed_t[0]), extend_to, 50)
            path["fit_t"] = xs.tolist()
            path["fit_m"] = np.asarray(fit["predict"](xs), dtype=float).tolist()

            # A projected crossing is usable only when the fitted path moves
            # toward the declared failure direction. A unit still observed as
            # safe cannot be assigned a projected failure before its last
            # observation.
            horizon = max(tmax - float(observed_t[0]), 1.0)
            now_and_future = np.asarray(
                fit["predict"](np.asarray([tmax, tmax + horizon])), dtype=float)
            trend_toward_failure = (
                now_and_future[1] > now_and_future[0]
                if req.threshold_direction == "above"
                else now_and_future[1] < now_and_future[0])
            if (observed_interval is None
                    and (not trend_toward_failure
                         or t_fail is None or t_fail <= tmax)):
                t_fail = None
            if t_fail is not None:
                projected.append(t_fail)
                if observed_interval is None and se is not None and se > 0:
                    projection_lo = max(tmax, 1e-9, t_fail - z * se)
                    projection_up = t_fail + z * se
                    if projection_up > projection_lo:
                        projection_intervals_available += 1
                    else:
                        projection_lo = projection_up = None
        else:
            r2 = None
            se = None

        # Prefer an actual inspection interval when the threshold was observed
        # to be crossed. Otherwise use one projected point failure or one
        # right-censored term at the unit's last confirmed safe observation.
        # A delta-method interval around an extrapolated crossing is parameter
        # uncertainty, not a known censoring interval, and is display-only.
        if observed_interval is not None:
            inspection_lo, inspection_up = observed_interval
            interval_observations.append(observed_interval)
            interval_source_counts["observed_threshold_crossing"] += 1
            life_observation = "interval_censored"
            interval_source = "observed_threshold_crossing"
        elif t_fail is not None:
            exact_failures.append(t_fail)
            life_observation = "projected_exact"
        else:
            right_censored.append(tmax)
            censor_time = tmax
            life_observation = "right_censored"

        unit_table.append({
            "unit_id": uid,
            "projected_failure": (round(t_fail, 4) if t_fail else None),
            "projection_lower": (round(projection_lo, 4)
                                 if projection_lo is not None else None),
            "projection_upper": (round(projection_up, 4)
                                 if projection_up is not None else None),
            "inspection_lower": (round(inspection_lo, 4)
                                 if inspection_lo is not None else None),
            "inspection_upper": (round(inspection_up, 4)
                                 if inspection_up is not None else None),
            "censor_time": (round(censor_time, 4)
                            if censor_time is not None else None),
            "life_observation": life_observation,
            "interval_source": interval_source,
            "a": (round(fit["a"], 6) if fit is not None else None),
            "b": (round(fit["b"], 6) if fit is not None else None),
            "r2": (round(r2, 4) if r2 is not None else None),
        })
        paths.append(path)

    dist_fit = None
    dist_fit_error = None
    if len(exact_failures) + len(interval_observations) >= 2:
        try:
            if interval_observations:
                dist_fit = _fit_interval_censored_life_distribution(
                    exact_failures, interval_observations, right_censored,
                    req.life_distribution,
                    reliability_time=req.reliability_time)
            else:
                dist_fit = _fit_life_distribution(
                    exact_failures, req.life_distribution,
                    reliability_time=req.reliability_time,
                    right_censored=right_censored)
                dist_fit["fit_method"] = "projected_point_mle"
                dist_fit["observation_counts"] = {
                    "exact": len(exact_failures),
                    "interval": 0,
                    "right_censored": len(right_censored),
                    "total": len(exact_failures) + len(right_censored),
                }
        except ValueError:
            logger.info(
                "Projected life-distribution fit was ineligible.",
                exc_info=True,
            )
            dist_fit_error = (
                "The requested life distribution could not be fitted to the "
                "projected observations."
            )

    total_life_observations = (
        len(exact_failures) + len(interval_observations) + len(right_censored))

    return {
        "analysis_method": "per_unit_delta",
        "paths": paths,
        "threshold": thr,
        "threshold_direction": req.threshold_direction,
        "degradation_model": req.degradation_model,
        "projected_failure_times": [round(p, 4) for p in projected],
        "distribution_fit": dist_fit,
        "distribution_fit_error": dist_fit_error,
        "hierarchical_fit": None,
        "life_data_summary": {
            "exact": len(exact_failures),
            "interval": len(interval_observations),
            "right_censored": len(right_censored),
            "total_units_used": total_life_observations,
            "units_dropped": len(groups) - total_life_observations,
            "interval_sources": interval_source_counts,
        },
        "projection_uncertainty": {
            "method": "delta_method",
            "confidence_level": req.ci,
            "intervals_available": projection_intervals_available,
            "likelihood_role": "display_only",
        },
        "unit_table": unit_table,
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

    # Fit candidate measurement families against the same joint degradation
    # likelihood. This is intentionally not a fit to pooled measurements: the
    # location changes with time, so each candidate must re-estimate the
    # degradation path and its common shape/scale parameter together.
    if req.measurement_distribution in ("Best_Fit", "auto"):
        comparisons = []
        fitted = []
        for candidate in ("Normal", "Lognormal", "Weibull", "Gumbel", "Exponential"):
            try:
                candidate_req = req.model_copy(
                    update={"measurement_distribution": candidate},
                )
                candidate_result = degradation_destructive(candidate_req)
                gof = candidate_result["gof"]
                row = {
                    "distribution": candidate,
                    **gof,
                    "fit_eligible": True,
                    "status": "Eligible",
                }
                comparisons.append(row)
                fitted.append(candidate_result)
            except HTTPException as exc:
                detail = exc.detail
                if isinstance(detail, dict):
                    detail = detail.get("message") or detail.get("code") or str(detail)
                comparisons.append({
                    "distribution": candidate,
                    "AIC": None,
                    "AICc": None,
                    "BIC": None,
                    "LogLik": None,
                    "fit_eligible": False,
                    "status": "Ineligible",
                    "reason": str(detail),
                })
            except Exception:
                logger.exception(
                    "Unexpected destructive degradation fit failure for %s",
                    candidate,
                )
                comparisons.append({
                    "distribution": candidate,
                    "AIC": None,
                    "AICc": None,
                    "BIC": None,
                    "LogLik": None,
                    "fit_eligible": False,
                    "status": "Ineligible",
                    "reason": "Fit failed unexpectedly.",
                })
        if not fitted:
            raise HTTPException(
                status_code=422,
                detail="No candidate measurement distribution produced an eligible fit.",
            )
        # Do not mix AICc and AIC scores in a single ranking. AICc is used only
        # when it is defined for every eligible candidate; otherwise all
        # candidates are compared on ordinary AIC.
        use_aicc = all(result["gof"]["AICc"] is not None for result in fitted)
        criterion_name = "AICc" if use_aicc else "AIC"
        fitted.sort(key=lambda result: float(result["gof"][criterion_name]))
        selected = fitted[0]
        comparisons.sort(key=lambda row: (
            not row["fit_eligible"],
            float("inf") if row[criterion_name] is None else row[criterion_name],
        ))
        return {
            **selected,
            "measurement_distribution_selection": criterion_name,
            "distribution_comparison": comparisons,
        }

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
    bounds = ([(None, None)] * len(x0) if dist == "Exponential"
              else [(None, None)] * (len(x0) - 1) + [(1e-10, None)])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        candidates = []
        for method in ("Nelder-Mead", "Powell"):
            try:
                r = minimize(neg_loglik, x0, method=method, bounds=bounds,
                             options={"maxiter": 20000, "xatol": 1e-8, "fatol": 1e-8})
                candidates.append((method, r))
            except Exception:
                continue
    try:
        best, fit_diagnostics = select_best_optimizer_result(
            candidates, neg_loglik, bounds=bounds,
        )
    except FitConvergenceError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "optimizer_not_converged",
                "message": "Degradation MLE failed the convergence checks.",
                "diagnostics": exc.diagnostics,
            },
        )

    if not np.isfinite(best.fun) or float(best.fun) >= 1e11:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "measurement_distribution_support_mismatch",
                "message": (
                    f"{dist} could not assign a finite likelihood to the "
                    "measurements under the fitted degradation path."
                ),
            },
        )

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
        "converged": True,
        "fit_eligible": True,
        "fit_diagnostics": fit_diagnostics,
        "scatter": {"t": t.tolist(), "y": y.tolist()},
        "degradation_curve": {"t": xs.tolist(), "median": np.asarray(median_curve, dtype=float).tolist()},
        "reliability_curve": {"t": rel_t.tolist(), "R": rel_R.tolist()},
    }
    n_obs = len(y)
    n_params = len(params)
    loglik = out["loglik"]
    aic = 2.0 * n_params - 2.0 * loglik
    aicc = (aic + (2.0 * n_params * (n_params + 1)) / (n_obs - n_params - 1)
            if n_obs > n_params + 1 else None)
    out["gof"] = {
        "AIC": float(aic),
        "AICc": float(aicc) if aicc is not None else None,
        "BIC": float(n_params * math.log(n_obs) - 2.0 * loglik),
        "LogLik": float(loglik),
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
    if any(not np.isfinite(s) or s <= 0 for s in stresses):
        raise HTTPException(status_code=400,
                            detail="Every step stress must be finite and > 0.")
    if any(not np.isfinite(d) or d <= 0 for d in durations):
        raise HTTPException(status_code=400,
                            detail="Every step duration must be finite and > 0.")
    if any(next_stress <= stress
           for stress, next_stress in zip(stresses, stresses[1:])):
        raise HTTPException(
            status_code=400,
            detail="Step stresses must be strictly increasing in application order.")
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

    # Cumulative-exposure: equivalent time at reference stress. Every completed
    # step contributes its duration multiplied by that step's acceleration
    # factor; the active step contributes only its elapsed portion. Raw clock
    # time determines the active step, while stress_at_failure is an explicit
    # consistency check on the supplied data.
    raw_starts = np.concatenate(([0.0], np.cumsum(durations)[:-1]))
    raw_ends = np.cumsum(durations)
    acceleration_factors = np.asarray([af(s) for s in stresses], dtype=float)
    equivalent_starts = np.concatenate((
        [0.0], np.cumsum(np.asarray(durations[:-1])
                         * acceleration_factors[:-1])))
    total_duration = float(raw_ends[-1])

    equiv = []
    for observation_index, (t, supplied_stress) in enumerate(zip(ft, sf)):
        if not np.isfinite(t) or t <= 0 or t > total_duration:
            raise HTTPException(
                status_code=400,
                detail=(f"failure_times[{observation_index}] must be within "
                        f"(0, {total_duration:g}]."))
        # Intervals are (start, end], so a failure exactly at a transition is
        # attributed to the step that just completed.
        step_index = int(np.searchsorted(raw_ends, t, side="left"))
        expected_stress = stresses[step_index]
        if not np.isclose(supplied_stress, expected_stress,
                          rtol=1e-9, atol=1e-12):
            raise HTTPException(
                status_code=400,
                detail=(f"stress_at_failure[{observation_index}] is "
                        f"{supplied_stress:g}, but cumulative failure time "
                        f"{t:g} lies in the {expected_stress:g} stress step."))
        in_step = t - raw_starts[step_index]
        equivalent_time = (equivalent_starts[step_index]
                           + acceleration_factors[step_index] * in_step)
        equiv.append(float(equivalent_time))
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
        "step_exposure": [
            {
                "stress": stress,
                "duration": duration,
                "raw_start": float(raw_start),
                "raw_end": float(raw_end),
                "acceleration_factor": round(float(factor), 8),
                "equivalent_start": round(float(equivalent_start), 8),
                "equivalent_end": round(
                    float(equivalent_start + factor * duration), 8),
            }
            for stress, duration, raw_start, raw_end, factor, equivalent_start
            in zip(stresses, durations, raw_starts, raw_ends,
                   acceleration_factors, equivalent_starts)
        ],
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
    """Rank-checked two-stress log-life model with extrapolation diagnostics."""
    from scipy import stats
    from scipy.spatial import Delaunay, QhullError

    ft = np.asarray(req.failure_times, dtype=float)
    s1 = np.asarray(req.stress1, dtype=float)
    s2 = np.asarray(req.stress2, dtype=float)
    if not (len(ft) == len(s1) == len(s2)) or len(ft) < 4:
        raise HTTPException(status_code=400,
                            detail="failure_times, stress1, stress2 must be equal-length (>=4).")
    if np.any(~np.isfinite(ft)) or np.any(ft <= 0):
        raise HTTPException(status_code=400, detail="All failure times must be finite and > 0.")
    if np.any(~np.isfinite(s1)) or np.any(~np.isfinite(s2)):
        raise HTTPException(status_code=400, detail="All stress values must be finite.")
    if (req.stress1_use is None) != (req.stress2_use is None):
        raise HTTPException(status_code=400, detail="Provide both use stresses, or neither.")
    if req.stress1_use is not None and not (
            np.isfinite(req.stress1_use) and np.isfinite(req.stress2_use)):
        raise HTTPException(status_code=400, detail="Use stresses must be finite.")

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

    # Fit in standardized stress coordinates so rank/conditioning are unit
    # invariant, then transform coefficients back to the displayed raw units.
    mean1, mean2 = float(np.mean(s1)), float(np.mean(s2))
    sd1, sd2 = float(np.std(s1)), float(np.std(s2))
    z1 = (s1 - mean1) / sd1 if sd1 > 0 else np.zeros_like(s1)
    z2 = (s2 - mean2) / sd2 if sd2 > 0 else np.zeros_like(s2)
    Xs = np.column_stack([np.ones_like(s1), z1, z2])
    rank = int(np.linalg.matrix_rank(Xs))
    condition = float(np.linalg.cond(Xs)) if rank == 3 else float('inf')
    if rank < 3:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The two-stress design has rank {rank}/3. Use at least three "
                "non-collinear stress combinations; varying both stresses together is confounded."
            ),
        )
    if condition > 1e8:
        raise HTTPException(
            status_code=400,
            detail=f"The scaled two-stress design is ill-conditioned ({condition:.3g}).",
        )
    y = np.log(ft)
    beta_scaled, *_ = np.linalg.lstsq(Xs, y, rcond=None)
    raw_b1 = beta_scaled[1] / sd1
    raw_b2 = beta_scaled[2] / sd2
    raw_intercept = beta_scaled[0] - raw_b1 * mean1 - raw_b2 * mean2
    coeffs = [float(raw_intercept), float(raw_b1), float(raw_b2)]

    expected_signs = [
        -1 if req.stress1_direction == 'increasing_damage' else 1,
        -1 if req.stress2_direction == 'increasing_damage' else 1,
    ]
    sign_pass = [
        raw_b1 * expected_signs[0] > 0,
        raw_b2 * expected_signs[1] > 0,
    ]
    physical = {
        'passed': all(sign_pass),
        'stress1': {
            'direction': req.stress1_direction, 'coefficient': float(raw_b1),
            'passed': bool(sign_pass[0]),
        },
        'stress2': {
            'direction': req.stress2_direction, 'coefficient': float(raw_b2),
            'passed': bool(sign_pass[1]),
        },
    }

    # Brown-Forsythe/Levene diagnostic on log-life residual dispersion across
    # replicated stress combinations. It is unavailable for unreplicated cells.
    replicated = []
    for a, b in sorted(combos):
        values = np.log(np.asarray(combos[(a, b)], dtype=float))
        if len(values) >= 2:
            replicated.append(values)
    if len(replicated) >= 2:
        deviations = [np.abs(values - np.median(values)) for values in replicated]
        has_within_group_variation = any(
            not np.allclose(values, values[0], rtol=1e-12, atol=1e-15)
            for values in deviations
        )
        if has_within_group_variation:
            lev_stat, lev_p = stats.levene(*replicated, center='median')
        else:
            lev_stat, lev_p = float('nan'), float('nan')
        if np.isfinite(lev_stat) and np.isfinite(lev_p):
            common_dispersion = {
                'status': 'ok', 'test': 'Brown-Forsythe (median-centered Levene)',
                'null_hypothesis': 'equal_log_life_dispersion_across_stress_combinations',
                'statistic': float(lev_stat), 'p_value': float(lev_p),
                'reject_common_dispersion': bool(lev_p < 0.05),
                'interpretation': (
                    'Rejection may indicate changing variability or mechanism; '
                    'non-rejection means the diagnostic detected no dispersion change.'),
            }
        else:
            common_dispersion = {
                'status': 'insufficient_variation',
                'test': 'Brown-Forsythe (median-centered Levene)',
                'reason': 'within_combination_absolute_deviations_are_constant',
                'reject_common_dispersion': False,
            }
    else:
        common_dispersion = {
            'status': 'insufficient_data',
            'reason': 'need_at_least_two_replicated_stress_combinations',
            'reject_common_dispersion': False,
        }

    fit_eligible = physical['passed'] and not common_dispersion.get('reject_common_dispersion', False)
    reasons = []
    if not physical['passed']:
        reasons.append('physical_stress_direction_violated')
    if common_dispersion.get('reject_common_dispersion'):
        reasons.append('common_dispersion_rejected')

    use_life = None
    use_diagnostic = None
    bootstrap = None
    if req.stress1_use is not None:
        use_z = np.array([
            1.0, (req.stress1_use - mean1) / sd1,
            (req.stress2_use - mean2) / sd2,
        ])
        leverage = float(use_z @ np.linalg.inv(Xs.T @ Xs) @ use_z)
        leverage_ratio = leverage / (3.0 / len(ft))
        points = np.unique(np.column_stack([s1, s2]), axis=0)
        try:
            simplex = Delaunay(points).find_simplex(
                np.array([[req.stress1_use, req.stress2_use]]))[0]
            inside_hull = bool(simplex >= 0)
        except QhullError:
            inside_hull = False
        positions = [
            ('below_tested_range' if req.stress1_use < np.min(s1)
             else 'above_tested_range' if req.stress1_use > np.max(s1)
             else 'within_tested_range'),
            ('below_tested_range' if req.stress2_use < np.min(s2)
             else 'above_tested_range' if req.stress2_use > np.max(s2)
             else 'within_tested_range'),
        ]
        use_diagnostic = {
            'positions': positions,
            'inside_tested_convex_hull': inside_hull,
            'is_extrapolation': not inside_hull,
            'leverage': leverage,
            'average_training_leverage': 3.0 / len(ft),
            'leverage_ratio': leverage_ratio,
            'tested_ranges': [
                {'minimum': float(np.min(s1)), 'maximum': float(np.max(s1))},
                {'minimum': float(np.min(s2)), 'maximum': float(np.max(s2))},
            ],
        }
        if fit_eligible:
            pred = float(use_z @ beta_scaled)
            if pred > math.log(np.finfo(float).max):
                raise HTTPException(status_code=400, detail="Use-level life overflows; extrapolation is unsupported.")
            use_life = float(np.exp(pred))

            residual = y - Xs @ beta_scaled
            sigma = math.sqrt(float(residual @ residual) / (len(ft) - 3))
            rng = np.random.default_rng(req.seed)
            estimates = []
            for _ in range(req.n_bootstrap):
                y_star = Xs @ beta_scaled + rng.normal(0.0, sigma, len(ft))
                b_star, *_ = np.linalg.lstsq(Xs, y_star, rcond=None)
                value = float(use_z @ b_star)
                if value < math.log(np.finfo(float).max):
                    estimates.append(float(np.exp(value)))
            tail = (1.0 - req.CI) / 2.0
            bootstrap = {
                'method': 'parametric_loglife_regression_bootstrap',
                'status': 'ok' if len(estimates) >= req.n_bootstrap // 2 else 'insufficient_refits',
                'CI': req.CI, 'requested': req.n_bootstrap,
                'successful': len(estimates), 'failed': req.n_bootstrap - len(estimates),
                'lower': float(np.quantile(estimates, tail)) if estimates else None,
                'upper': float(np.quantile(estimates, 1.0 - tail)) if estimates else None,
                'median': float(np.median(estimates)) if estimates else None,
                'conditional_on': 'loglinear_model_normal_residuals_and_fixed_stress_design',
            }

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
        "fit_eligible": fit_eligible,
        "eligibility_reasons": reasons,
        "design_diagnostics": {
            'rank': rank, 'required_rank': 3, 'full_rank': True,
            'scaled_condition_number': condition,
            'n_unique_stress_combinations': len(combos),
        },
        "physical_constraint": physical,
        "common_dispersion": common_dispersion,
        "use_stress_diagnostics": use_diagnostic,
        "use_life_interval": bootstrap,
        "result_quality": ('extrapolated_with_interval' if use_life is not None and use_diagnostic['is_extrapolation']
                           else 'interpolated_with_interval' if use_life is not None
                           else 'ineligible' if not fit_eligible else 'fit_only'),
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

    burn_in_cumulative_hazard = (t_eff / req.eta) ** req.beta
    p_survive = math.exp(-burn_in_cumulative_hazard)
    expected_failures = req.n_units * (1.0 - p_survive)

    # Reliability curves before vs after burn-in (conditional on survival).
    tmax = req.eta * 2.0
    xs = np.linspace(0, tmax, 200)
    r_before = np.array([sf(t) for t in xs])
    # Evaluate conditional survival directly in the log domain.  Dividing two
    # tiny survival probabilities loses the curve after a long burn-in.
    r_after = np.array([
        math.exp(burn_in_cumulative_hazard - (((t + t_eff) / req.eta) ** req.beta))
        for t in xs
    ])

    def haz(t):
        if t <= 0:
            return 0.0
        return (req.beta / req.eta) * ((t / req.eta) ** (req.beta - 1.0))

    h_before = np.array([haz(t) for t in xs])
    h_after = np.array([haz(t + t_eff) for t in xs])

    # Mean residual life after burn-in:
    #   E[X-t | X>t] = integral_t^infinity S(u)du / S(t)
    # For Weibull lifetimes this is an upper-incomplete-gamma expression.  It
    # includes the full infinite tail; the plotted 0..2*eta window is only a
    # visualisation range and must not truncate this expectation.
    from scipy.special import gammaincc, gammaln
    a = 1.0 / req.beta
    upper_regularized = float(gammaincc(a, burn_in_cumulative_hazard))
    if upper_regularized > 0.0:
        log_mrl = (
            math.log(req.eta / req.beta)
            + float(gammaln(a))
            + math.log(upper_regularized)
            + burn_in_cumulative_hazard
        )
        mean_residual_life = math.exp(log_mrl)
    else:
        # gammaincc can underflow for an extreme cumulative hazard.  The first
        # terms of exp(z) * Gamma(a, z) provide the correct scaled tail there.
        z = burn_in_cumulative_hazard
        terms = 1.0
        term = 1.0
        for k in range(1, 12):
            term *= (a - k) / z
            terms += term
            if abs(term) <= abs(terms) * 1e-14:
                break
        log_mrl = math.log(req.eta / req.beta) + (a - 1.0) * math.log(z) + math.log(terms)
        mean_residual_life = math.exp(log_mrl)

    return {
        "effective_burn_in_time": round(t_eff, 3),
        "survival_probability": round(p_survive, 5),
        "expected_failures": round(expected_failures, 3),
        "post_burn_in_mean_residual_life": round(mean_residual_life, 3),
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

    # scipy's beta.ppf is fully vectorized over the order statistics — three
    # array calls instead of 3n scalar Python<->C round-trips.
    i = np.arange(1, n + 1)
    a, b = i, n - i + 1
    mr = _beta.ppf(0.5, a, b)
    lr = _beta.ppf(lo_p, a, b)
    ur = _beta.ppf(hi_p, a, b)
    rows = [
        {
            "order": int(k + 1),
            "low": round(_quantile_from_rank(float(lr[k]), req.distribution, req.beta, req.eta), 4),
            "median": round(_quantile_from_rank(float(mr[k]), req.distribution, req.beta, req.eta), 4),
            "high": round(_quantile_from_rank(float(ur[k]), req.distribution, req.beta, req.eta), 4),
        }
        for k in range(n)
    ]
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
        i = np.arange(1, n + 1)
        mr = _beta.ppf(0.5, i, n - i + 1)          # vectorized median ranks
        return (eta * (-np.log(1.0 - mr)) ** (1.0 / beta)).tolist()

    def metric_ci(metric_value, beta, n, T):
        """Censor median failure times at T, fit Weibull, return (val, lo, hi)."""
        times = median_failure_times(metric_value, beta, n)
        fails = [t for t in times if t <= T]
        susp = [T for t in times if t > T]
        if len(fails) < 2:
            return None
        # For both B10 and mean metrics the matrix compares CI overlap, so the
        # B-life bounds are the comparison basis.
        return _weibull_blife_ci(fails, susp, p, req.confidence)

    # metric_ci depends only on (metric value, design, T) — never on the cell
    # pairing — so precompute each design's CIs once per (value, T) instead of
    # refitting inside the V x V cell loop (a factor-V reduction in MLE fits),
    # and run the independent fits in parallel.
    ci_jobs = ([("d1", m, T, req.design1_beta, req.design1_n) for m in vals for T in test_times]
               + [("d2", m, T, req.design2_beta, req.design2_n) for m in vals for T in test_times])

    def _run_job(job):
        tag, m, T, beta, n = job
        return (tag, m, T), metric_ci(m, beta, n, T)

    workers = min(len(ci_jobs), (os.cpu_count() or 4))
    with ThreadPoolExecutor(max_workers=max(workers, 1)) as ex:
        ci_cache = dict(ex.map(_run_job, ci_jobs))

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
                c1 = ci_cache[("d1", m1, T)]
                c2 = ci_cache[("d2", m2, T)]
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

    def _weibull_mle_fast(fails, rc=None):
        """Lean Weibull 2P MLE via the 1-D profile-likelihood equation.

        Under Type-I censoring the MLE reduces to solving
        g(b) = mean(ln t_f) + 1/b - sum(t^b ln t)/sum(t^b) = 0 for the shape
        (sums over failures + suspensions, mean over failures only), with the
        scale following in closed form. Identical estimates to the full 2-D
        optimization but orders of magnitude faster — the Monte-Carlo loop
        only needs point estimates, not CIs or a Hessian.
        """
        from scipy.optimize import brentq
        f = np.asarray(fails, dtype=float)
        t = f if rc is None or len(rc) == 0 else np.concatenate([f, rc])
        r = len(f)
        mean_lf = float(np.mean(np.log(f)))
        lt = np.log(t)

        def g(b):
            tb = t ** b
            return mean_lf + 1.0 / b - float(np.sum(tb * lt) / np.sum(tb))

        lo_b, hi_b = 0.05, 20.0
        while g(hi_b) > 0 and hi_b < 500:
            hi_b *= 2
        while g(lo_b) < 0 and lo_b > 1e-4:
            lo_b /= 2
        beta = brentq(g, lo_b, hi_b, xtol=1e-10)
        eta = (float(np.sum(t ** beta)) / r) ** (1.0 / beta)
        return eta, beta

    def _fit_one(data):
        """Fit one simulated sample; returns the metric estimate or None."""
        rc = None
        fails = data
        if req.test_duration and req.test_duration > 0:
            mask = data <= req.test_duration
            fails = data[mask]
            rc = np.full(int((~mask).sum()), req.test_duration)
            if len(fails) < 2:
                return None
        try:
            eta, beta = _weibull_mle_fast(fails, rc)
            if req.metric == "B10":
                est = eta * (-math.log(0.9)) ** (1.0 / beta)
            else:  # reliability at target_time
                est = math.exp(-((req.target_time / eta) ** beta))
        except Exception:
            return None
        return est if np.isfinite(est) else None

    # Batched loop with early exit: stop once the running-mean 95% band is
    # within 0.2% of the mean — the convergence plot shows the user exactly
    # where it stopped.
    estimates = []
    n_sims = int(min(req.num_simulations, 5000))
    batch_size = 250
    n_run = 0
    early_stopped = False
    while n_run < n_sims:
        size = min(batch_size, n_sims - n_run)
        for _ in range(size):
            est = _fit_one(np.abs(sample(n)))
            if est is not None:
                estimates.append(est)
        n_run += size
        if n_run >= 1000 and len(estimates) >= 500 and n_run < n_sims:
            a = np.asarray(estimates, dtype=float)
            mean = float(np.mean(a))
            half = 1.96 * float(np.std(a, ddof=1)) / math.sqrt(len(a))
            if mean != 0 and half / abs(mean) < 0.002:
                early_stopped = True
                break

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
        "metric": req.metric, "n_valid": len(estimates), "num_simulations": n_run,
        "early_stopped": early_stopped,
        "mean": round(float(np.mean(arr)), 6),
        "median": round(float(np.median(arr)), 6),
        "std": round(float(np.std(arr, ddof=1)), 6),
        "p5": round(lo, 6), "p95": round(hi, 6),
        "prob_meet_target": (round(prob_meet, 4) if prob_meet is not None else None),
        "target_value": req.target_value,
        "histogram": {"counts": counts.tolist(), "edges": edges.tolist()},
        # Running mean of the per-simulation estimates, in simulation order —
        # shows whether num_simulations was sufficient.
        "convergence": convergence_series(arr),
    }
