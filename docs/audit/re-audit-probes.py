"""Reproducible numerical probes for the 2026-07-11 Perdura re-audit.

The probes intentionally use analytic identities, direct probability formulas,
or public API contracts rather than recomputing an implementation with itself.
Run from the repository root with::

    PYTHONPATH=src:gui/backend .venv/bin/python docs/audit/re-audit-probes.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import sys

import numpy as np
from pydantic import ValidationError
from scipy import stats


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "gui" / "backend"))

from reliability.Allocation import allocate  # noqa: E402
from reliability.Bayesian import weibayes_fit  # noqa: E402
from reliability.Dependencies import beta_factor_decomposition  # noqa: E402
from reliability.Distributions import Weibull_Distribution  # noqa: E402
from reliability.FaultTree import exact_probability_from_cut_sets  # noqa: E402
from reliability.Hypothesis_tests import mann_whitney  # noqa: E402
from reliability.MIL_HDBK_217F import Resistor  # noqa: E402
from reliability.MissionProfile import (  # noqa: E402
    MissionCalculationError,
    MissionPhase,
    MissionProfile,
    compute_system_mission_rate,
)
from reliability.Regression import lasso_regression, linear_regression  # noqa: E402
from reliability.Reliability_testing import reliability_test_planner  # noqa: E402
from reliability.Repairable_systems import optimal_replacement_time  # noqa: E402
from reliability.Utils import AICc  # noqa: E402
from routers.alt import burn_in, degradation, step_stress  # noqa: E402
from routers.system_reliability import compute_rbd  # noqa: E402
from schemas import (  # noqa: E402
    BurnInRequest,
    DegradationRequest,
    FaultTreeRequest,
    RBDRequest,
    StepStressRequest,
)


def _same(actual: float, expected: float, *, rtol: float = 1e-9,
          atol: float = 1e-12) -> bool:
    return bool(np.isclose(actual, expected, rtol=rtol, atol=atol))


def _record(rows: list[dict], finding: str, probe: str, current,
            reference, passed: bool, basis: str, note: str = "") -> None:
    rows.append({
        "finding": finding,
        "probe": probe,
        "current": current,
        "reference": reference,
        "result": "pass" if passed else "residual",
        "basis": basis,
        "note": note,
    })


def run() -> list[dict]:
    rows: list[dict] = []

    profile = MissionProfile("probe", [MissionPhase("operate", 1000, "GB", 40)])
    params = {"style": "RL", "power_stress": 0.3, "rated_power": 0.25}
    mission = compute_system_mission_rate(profile, [(Resistor, params)])
    rate = mission["system_failure_rate"]
    expected_mtbf = 1.0 / (rate * 1e-6)
    expected_reliability = math.exp(-rate * 1e-6 * profile.total_duration)
    _record(
        rows, "F001", "One-part system FPMH conversion",
        {"rate_fpmh": rate, "mtbf_h": mission["system_mtbf"],
         "reliability_1000h": mission["system_reliability"]},
        {"mtbf_h": expected_mtbf, "reliability_1000h": expected_reliability},
        _same(mission["system_mtbf"], expected_mtbf, atol=0.11)
        and _same(mission["system_reliability"], expected_reliability, rtol=1e-7),
        "Convert FPMH to failures/hour exactly once.",
    )

    try:
        compute_system_mission_rate(
            profile, [(Resistor, {"name": "bad resistor", "style": "invalid"})])
    except MissionCalculationError as exc:
        detail = exc.to_dict()
        passed = detail.get("part_index") == 0 and detail.get("part_name") == "bad resistor"
        current = detail
    else:
        passed = False
        current = "no error"
    _record(
        rows, "F006", "Invalid mission part fails closed",
        current, "Structured error identifying the invalid part", passed,
        "Invalid parts must not contribute a silent zero rate.",
    )

    rdt = reliability_test_planner(MTBF=500, test_duration=10_000, CI=0.9)
    failures = rdt["number_of_failures"]
    passing = 20_000 / stats.chi2.ppf(0.9, 2 * failures + 2)
    next_bound = 20_000 / stats.chi2.ppf(0.9, 2 * (failures + 1) + 2)
    _record(
        rows, "F002", "Maximum passing exponential RDT failure count",
        {"allowable_failures": failures, "bound_at_f": passing,
         "bound_at_f_plus_1": next_bound},
        {"allowable_failures": 13, "pass_condition": ">=500",
         "next_condition": "<500"},
        failures == 13 and passing >= 500 and next_bound < 500,
        "Direct enumeration of the monotone chi-square lower bound.",
    )

    cut_sets = [{"A", f"B{i}"} for i in range(21)]
    probabilities = {"A": 0.1, **{f"B{i}": 0.1 for i in range(21)}}
    exact = exact_probability_from_cut_sets(cut_sets, probabilities)
    expected_exact = 0.1 * (1.0 - 0.9 ** 21)
    cut_bound = 1.0 - np.prod([1.0 - 0.01] * 21)
    _record(
        rows, "F003", "Twenty-one shared-event cut sets",
        {"exact": exact, "separate_cut_set_bound": cut_bound},
        expected_exact, _same(exact, expected_exact, rtol=1e-10),
        "P(A and any B_i) = P(A)[1-product P(not B_i)].",
    )

    step = step_stress(StepStressRequest(
        steps=[{"stress": 1, "duration": 10},
               {"stress": 2, "duration": 10},
               {"stress": 4, "duration": 10}],
        failure_times=[21, 25], stress_at_failure=[4, 4],
        distribution="Weibull",
    ))
    _record(
        rows, "F004", "Three-step cumulative exposure",
        step["equivalent_times"], [66.0, 130.0],
        bool(np.allclose(step["equivalent_times"], [66.0, 130.0])),
        "Sum every completed duration times its acceleration factor.",
    )

    degradation_request = DegradationRequest(
        unit_ids=["U1", "U1", "U1", "U2", "U2", "U2",
                  "U3", "U3", "U3", "U4", "U4", "U4"],
        times=[0, 10, 20] * 4,
        measurements=[0, 3, 7, 0, 4, 9, 2, 1.5, 1, 1, 6, 12],
        threshold=10, threshold_direction="above", degradation_model="linear",
        life_distribution="Weibull_2P", ci=0.90,
    )
    degradation_result = degradation(degradation_request)
    summary = degradation_result["life_data_summary"]
    _record(
        rows, "F005", "One likelihood contribution per degradation unit",
        summary,
        {"total_units_used": 4, "right_censored": 1,
         "observed_crossing_intervals": 1},
        summary["total_units_used"] == 4
        and summary["right_censored"] == 1
        and summary["interval_sources"]["observed_threshold_crossing"] == 1,
        "An observed crossing interval contributes F(U)-F(L); a non-crossing unit contributes S(C).",
    )
    projection = degradation_result["projection_uncertainty"]
    projected_as_interval = (
        summary["interval"]
        - summary["interval_sources"]["observed_threshold_crossing"]
    )
    _record(
        rows, "F005", "Projection uncertainty kept separate from censoring",
        {"projection_intervals_in_likelihood": projected_as_interval,
         "projection_intervals_available": projection["intervals_available"],
         "likelihood_role": projection["likelihood_role"]},
        {"projection_intervals_in_likelihood": 0,
         "likelihood_role": "display_only"},
        projected_as_interval == 0
        and projection["likelihood_role"] == "display_only",
        "A confidence interval around a fitted crossing time is not an observed failure interval.",
    )

    aicc = AICc(-10.0, 5, 4)
    _record(
        rows, "F007", "Undefined AICc is ineligible",
        "infinity" if np.isinf(aicc) else aicc, "infinity/undefined",
        bool(np.isinf(aicc)), "AICc is undefined when n-k-1 <= 0.",
    )

    weibull = Weibull_Distribution(eta=1, beta=2)
    hazard = float(np.asarray(weibull.HF([100]))[0])
    cumulative_hazard = float(np.asarray(weibull.CHF([100]))[0])
    _record(
        rows, "F008", "Extreme-tail Weibull hazard identity",
        {"hazard": hazard, "cumulative_hazard": cumulative_hazard},
        {"hazard": 200.0, "cumulative_hazard": 10_000.0},
        _same(hazard, 200.0) and _same(cumulative_hazard, 10_000.0),
        "For eta=1,beta=2: h(t)=2t and H(t)=t^2.",
    )

    agree = allocate([
        {"name": "A", "complexity": 10, "importance": 0.5},
        {"name": "B", "complexity": 30, "importance": 1.0},
    ], method="agree", target_reliability=0.9, mission_time=100.0)
    _record(
        rows, "F014", "AGREE target conservation",
        agree["achieved_reliability"], 0.9,
        _same(agree["achieved_reliability"], 0.9, rtol=1e-12),
        "The product of series subsystem allocations must equal the system target.",
    )

    rbd = compute_rbd(RBDRequest(
        nodes=[
            {"id": "src", "type": "source"},
            {"id": "snk", "type": "sink"},
            {"id": "a", "type": "component", "data": {"reliability": 0.9}},
            {"id": "b", "type": "component", "data": {"reliability": 0.8}},
        ],
        edges=[{"source": "src", "target": "a"},
               {"source": "a", "target": "b"},
               {"source": "b", "target": "snk"}],
    ))
    first_importance = {row["id"]: row for row in rbd["importance"]}["a"]
    expected_criticality = 0.8 * 0.1 / 0.28
    _record(
        rows, "F015", "Series-RBD failure criticality",
        first_importance["Criticality"], expected_criticality,
        _same(first_importance["Criticality"], expected_criticality, atol=5e-7),
        "Criticality = Birnbaum * component unreliability / system unreliability.",
    )

    dependency = beta_factor_decomposition(
        {"A": 0.1, "B": 0.1},
        {"A": {"group": "G", "beta": 0.2},
         "B": {"group": "G", "beta": 0.2}},
    )
    reconstructed = dependency["diagnostics"]["groups"][0][
        "reconstructed_marginal_probabilities"]
    _record(
        rows, "F017", "Beta-factor decomposition preserves marginals",
        reconstructed, [0.1, 0.1], bool(np.allclose(reconstructed, [0.1, 0.1])),
        "Shared-shock and independent terms must reconstruct each entered marginal.",
        "This validates the implemented exchangeable all-members-shock scope, not arbitrary dependence.",
    )

    burn = burn_in(BurnInRequest(
        duration=20, beta=1, eta=100, n_units=100, acceleration_factor=1,
    ))
    _record(
        rows, "F018", "Exponential post-burn-in mean residual life",
        burn["post_burn_in_mean_residual_life"], 100.0,
        _same(burn["post_burn_in_mean_residual_life"], 100.0),
        "The exponential distribution is memoryless.",
    )

    replacement = optimal_replacement_time(1, 5, 100, 0.7)
    expected_corrective = 5 / (100 * math.gamma(1 + 1 / 0.7))
    _record(
        rows, "F019", "Non-increasing hazard replacement decision",
        {"decision": replacement["decision"],
         "optimal_time": replacement["optimal_replacement_time"],
         "cost": replacement["min_cost"]},
        {"decision": "run_to_failure", "optimal_time": None,
         "cost": expected_corrective},
        replacement["decision"] == "run_to_failure"
        and replacement["optimal_replacement_time"] is None
        and _same(replacement["min_cost"], expected_corrective),
        "A Weibull beta <= 1 has no improving finite age-replacement optimum.",
    )

    duplicate_x = np.column_stack([np.arange(1.0, 6.0), np.arange(1.0, 6.0)])
    try:
        linear_regression(duplicate_x, np.arange(1.0, 6.0), ["x", "x_copy"])
    except ValueError as exc:
        rank_rejected = "rank" in str(exc).lower()
        rank_current = str(exc)
    else:
        rank_rejected = False
        rank_current = "ordinary inference returned"
    _record(
        rows, "F025", "Rank-deficient OLS design",
        rank_current, "Inference rejected as non-identifiable", rank_rejected,
        "Duplicate predictors make the design rank smaller than its parameter count.",
    )

    mann = mann_whitney([10, 11], [0, 1])
    _record(
        rows, "F027", "Mann-Whitney effect direction",
        mann["effect_size"], 1.0, _same(mann["effect_size"], 1.0),
        "Every group-A observation exceeds every group-B observation.",
    )

    weibayes = weibayes_fit(
        [100, 150, 200, 250, 300, 175, 225],
        ["F", "F", "F", "F", "F", "S", "S"], beta=2.5, CI=0.95,
    )
    lower = np.asarray(weibayes["curves"]["sf_lower"], dtype=float)
    central = np.asarray(weibayes["curves"]["sf"], dtype=float)
    upper = np.asarray(weibayes["curves"]["sf_upper"], dtype=float)
    ordered = bool(np.all(lower <= central + 1e-12)
                   and np.all(central <= upper + 1e-12))
    semantic_names_only = (
        "response_contract_version" not in weibayes
        and "migration_note" not in weibayes
        and not any(name.startswith("sf_legacy_")
                    for name in weibayes["curves"])
    )
    _record(
        rows, "F039", "Weibayes survival-band semantics",
        {"semantic_names_only": semantic_names_only,
         "lower_le_central_le_upper": ordered},
        {"semantic_names_only": True, "lower_le_central_le_upper": True},
        semantic_names_only and ordered,
        "Survival bounds are named by survival ordinate, not eta endpoint.",
    )

    x = np.column_stack([np.arange(20.0), np.arange(20.0) + 1e-8])
    y = 2 * x[:, 0] + np.sin(x[:, 0])
    sparse = lasso_regression(x, y, alpha=0.1,
                              feature_names=["x1", "x2"])
    required = ("objective", "optimality_checked", "kkt_residual",
                "kkt_tolerance", "active_set_stable",
                "active_set_stability")
    missing = [name for name in required if name not in sparse]
    sparse_optimal = (
        not missing
        and sparse["optimality_checked"] is True
        and sparse["converged"] is True
        and sparse["kkt_residual"] <= sparse["kkt_tolerance"]
        and sparse["active_set_stability"]["comparison_converged"] is True
    )
    _record(
        rows, "F048", "Sparse-regression optimality and active-set diagnostics",
        {"converged": sparse["converged"], "missing_fields": missing,
         "kkt_residual": sparse.get("kkt_residual"),
         "kkt_tolerance": sparse.get("kkt_tolerance"),
         "active_set_stable": sparse.get("active_set_stable")},
        {"missing_fields": [], "optimality_checked": True,
         "kkt_within_tolerance": True,
         "stricter_tolerance_refit_converged": True},
        sparse_optimal,
        "A small coordinate update should be followed by an objective/KKT or dual-gap check; active-set stability must be explicit.",
    )

    validation_errors = {}
    try:
        RBDRequest(
            nodes=[
                {"id": "src", "type": "source"},
                {"id": "snk", "type": "sink"},
                {"id": "bad", "type": "component",
                 "data": {"reliability": "not-a-probability"}},
            ],
            edges=[{"source": "src", "target": "bad"},
                   {"source": "bad", "target": "snk"}],
        )
    except ValidationError as exc:
        validation_errors["rbd"] = exc.errors()[0]["type"]
    try:
        FaultTreeRequest(
            nodes=[{
                "id": "bad", "type": "basic",
                "data": {
                    "label": "invalid Weibull",
                    "distribution": "weibull",
                    "dist_params": {"alpha": -1, "beta": 2},
                    "exposure_time": 100,
                },
            }],
            edges=[], methods=["exact"],
        )
    except ValidationError as exc:
        validation_errors["fta"] = exc.errors()[0]["type"]
    failed_closed = set(validation_errors) == {"rbd", "fta"}
    _record(
        rows, "F051", "Malformed FTA/RBD probability inputs fail closed",
        validation_errors, "Structured validation errors; no substituted probability",
        failed_closed,
        "Invalid probability/distribution inputs must not be replaced by plausible defaults.",
    )

    return rows


if __name__ == "__main__":
    print(json.dumps(run(), indent=2, sort_keys=True))
