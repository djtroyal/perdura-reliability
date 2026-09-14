"""Independent likelihood, limit and failure-path checks for step-stress v2."""

import math

import numpy as np
import pytest
from scipy import integrate, optimize, stats

from reliability import Step_stress as module
from reliability.Step_stress import StepStressSchedule, fit_step_stress, step_stress_log_likelihood


# ReliaSoft, Time-Varying Stress Models, 11-unit six-stage worked example.
# https://help.reliasoft.com/reference/accelerated_life_testing_data_analysis/alt/time-varying_stress_models.html
VENDOR_STEPS = [dict(stress=s, duration=d) for s, d in zip(
    [2, 3, 4, 5, 6, 7], [250, 100, 20, 10, 10, 10])]
VENDOR_TIMES = [280, 310, 330, 352, 360, 366, 371, 374, 378, 381, 385]
VENDOR_OBSERVATIONS = [dict(time=t, status="failure") for t in VENDOR_TIMES]


def independent_nll(parameters, steps, observations):
    """Raw-parameter clock-time density; no production exposure/fit helpers."""
    eta, beta, exponent = parameters
    if min(eta, beta) <= 0 or exponent < 0:
        return np.inf
    total = 0.0
    for row in observations:
        age, remaining, active_af = 0.0, row["time"], 1.0
        for step in steps:
            af = (step["stress"] / steps[0]["stress"]) ** exponent
            used = min(remaining, step["duration"])
            age += used * af
            remaining -= used
            active_af = af
            if remaining <= 0:
                break
        total -= stats.weibull_min.logpdf(age, beta, scale=eta) + math.log(active_af) if row["status"] == "failure" else stats.weibull_min.logsf(age, beta, scale=eta)
    return total


@pytest.fixture(scope="module")
def vendor_fit():
    return fit_step_stress(VENDOR_STEPS, VENDOR_OBSERVATIONS)


def test_vendor_dataset_matches_independent_full_parameter_likelihood(vendor_fit):
    independent = optimize.minimize(
        lambda x: independent_nll(np.exp(x), VENDOR_STEPS, VENDOR_OBSERVATIONS),
        np.log([1000, 2, 4]), method="Nelder-Mead",
        options={"maxiter": 2000, "xatol": 1e-9, "fatol": 1e-10})
    assert independent.success
    actual = vendor_fit["parameters"]
    assert [actual["eta_reference"], actual["beta"], actual["exponent_p"]] == pytest.approx(np.exp(independent.x), rel=2e-5)
    assert vendor_fit["log_likelihood"] == pytest.approx(-independent.fun, abs=1e-8)
    assert vendor_fit["status"] == "converged"
    assert vendor_fit["analysis_metadata"]["engine_revision"] == 2
    assert actual["exponent_p"] == pytest.approx(3.9984681, rel=2e-6)


def test_profile_endpoints_are_validated_independently(vendor_fit):
    assert vendor_fit["uncertainty"]["status"] == "ok"
    p_ci = vendor_fit["uncertainty"]["intervals"]["exponent_p"]
    for endpoint in (p_ci["lower"], p_ci["upper"]):
        refit = optimize.minimize(
            lambda x: independent_nll([*np.exp(x), endpoint], VENDOR_STEPS, VENDOR_OBSERVATIONS),
            np.log([vendor_fit["parameters"]["eta_reference"], vendor_fit["parameters"]["beta"]]),
            method="Nelder-Mead", options={"maxiter": 2000, "xatol": 1e-9, "fatol": 1e-10})
        assert refit.success
        assert 2 * (refit.fun + vendor_fit["log_likelihood"]) == pytest.approx(stats.chi2.ppf(.95, 1), abs=2e-5)
    for ci in vendor_fit["uncertainty"]["intervals"].values():
        assert ci["lower"] < ci["estimate"] < ci["upper"]
        assert max(ci["lr_residuals"]) < 1e-4


def test_joint_censored_fit_matches_independent_full_parameter_likelihood():
    # Extend the published failure fixture by a declared synthetic suspension;
    # this is a joint censored oracle, not a published vendor numerical result.
    observations = [*VENDOR_OBSERVATIONS, dict(time=400, status="right_censored")]
    result = fit_step_stress(VENDOR_STEPS, observations, profile=False)
    attempts = [optimize.minimize(
        lambda x: independent_nll(np.exp(x), VENDOR_STEPS, observations),
        np.log(start), method="Nelder-Mead",
        options={"maxiter": 3000, "xatol": 1e-9, "fatol": 1e-10})
        for start in ([400, 8, 1], [1000, 2, 4])]
    assert all(attempt.success for attempt in attempts)
    independent = min(attempts, key=lambda attempt: attempt.fun)
    parameters = result["parameters"]
    assert [parameters["eta_reference"], parameters["beta"], parameters["exponent_p"]] == pytest.approx(np.exp(independent.x), rel=2e-5)
    assert result["log_likelihood"] == pytest.approx(-independent.fun, abs=1e-8)
    assert result["n_failures"] == 11 and result["n_right_censored"] == 1
    assert result["status"] == "converged" and result["fit_mode"] == "joint"


def test_fixed_exponent_constant_stress_reduces_to_censored_weibull():
    failures = [2, 4, 7, 9, 12]
    censored = [6, 10, 14]
    observations = ([dict(time=t, status="failure") for t in failures]
                    + [dict(time=t, status="right_censored") for t in censored])
    result = fit_step_stress([dict(stress=5, duration=15)], observations,
                             mode="fixed_exponent", fixed_exponent=3, profile=False)
    shape, _, scale = stats.weibull_min.fit(stats.CensoredData(uncensored=failures, right=censored), floc=0)
    assert result["parameters"]["beta"] == pytest.approx(shape, rel=2e-5)
    assert result["parameters"]["eta_reference"] == pytest.approx(scale, rel=2e-5)
    assert result["analysis_metadata"]["estimator"] == "MLE_conditional_on_external_exponent"
    assert result["n_right_censored"] == 3


def test_exact_failure_jacobian_and_censoring_have_analytic_exponential_limit():
    steps = [dict(stress=1, duration=10), dict(stress=2, duration=10)]
    obs = [dict(time=5, status="failure"), dict(time=15, status="failure"), dict(time=20, status="right_censored")]
    eta, beta, exponent = 40, 1, 2
    expected = -2 * math.log(eta) + math.log(4) - (5 + 30 + 50) / eta
    assert step_stress_log_likelihood(steps, obs, eta, beta, exponent) == pytest.approx(expected)
    expected_eta_mle = 85 / 2
    estimate = optimize.minimize_scalar(lambda scale: -step_stress_log_likelihood(steps, obs, scale, 1, 2), bounds=(1, 100), method="bounded")
    assert estimate.x == pytest.approx(expected_eta_mle, rel=1e-6)


def test_clock_time_density_integrates_to_failure_probability():
    steps = [dict(stress=1, duration=10), dict(stress=2, duration=10)]
    schedule = StepStressSchedule.from_steps(steps)
    def density(time):
        return math.exp(step_stress_log_likelihood(schedule, [dict(time=time, status="failure")], 60, 1.7, 2))
    mass = integrate.quad(density, 0, 10)[0] + integrate.quad(density, 10, 20)[0]
    assert mass == pytest.approx(-math.expm1(-(50 / 60) ** 1.7), rel=1e-9)


def test_equal_stress_stage_splitting_preserves_fit_and_survival(vendor_fit):
    split = [dict(stress=2, duration=100), dict(stress=2, duration=150), *VENDOR_STEPS[1:]]
    result = fit_step_stress(split, VENDOR_OBSERVATIONS, profile=False)
    assert result["parameters"] == pytest.approx(vendor_fit["parameters"], rel=1e-6)
    assert result["log_likelihood"] == pytest.approx(vendor_fit["log_likelihood"], abs=1e-9)
    schedule = StepStressSchedule.from_steps(VENDOR_STEPS)
    log_age, _ = schedule.exposure([250 - 1e-7, 250, 250 + 1e-7], 4)
    survival = np.exp(-np.exp(2.5 * (log_age - math.log(1000))))
    assert survival[0] == pytest.approx(survival[2], abs=1e-9)


def test_censoring_uses_risk_sets_for_display():
    result = fit_step_stress([dict(stress=1, duration=10)],
                             [dict(time=2, status="failure"), dict(time=3, status="right_censored"),
                              dict(time=5, status="failure"), dict(time=6, status="right_censored")],
                             mode="fixed_exponent", fixed_exponent=0, profile=False)
    assert result["cumulative_plot"]["cum_fraction"] == pytest.approx([.25, .625])


@pytest.mark.parametrize("steps,observations,kwargs,match", [
    ([dict(stress=1, duration=10)], [dict(time=2, status="failure"), dict(time=3, status="failure")], {}, "unidentified"),
    (VENDOR_STEPS, [dict(time=0, status="failure"), dict(time=300, status="failure")], {}, "within"),
    (VENDOR_STEPS, [dict(time=401, status="failure"), dict(time=300, status="failure")], {}, "within"),
    (VENDOR_STEPS, [dict(time=300, status="interval"), dict(time=320, status="failure")], {}, "status"),
    (VENDOR_STEPS, VENDOR_OBSERVATIONS, {"mode": "fixed_exponent"}, "requires"),
    (VENDOR_STEPS, VENDOR_OBSERVATIONS, {"fixed_exponent": 2}, "Do not supply"),
    (VENDOR_STEPS, VENDOR_OBSERVATIONS, {"use_level_stress": -1}, "Use-level"),
    (VENDOR_STEPS, [dict(time=300, status="failure", unit_id="same"), dict(time=320, status="failure", unit_id="same")], {}, "unique"),
    (VENDOR_STEPS, [dict(time=280, status="failure", stress_at_observation=2), dict(time=320, status="failure")], {}, "disagrees"),
])
def test_invalid_or_unidentified_designs_are_explicit(steps, observations, kwargs, match):
    with pytest.raises(ValueError, match=match):
        fit_step_stress(steps, observations, profile=False, **kwargs)


def test_failed_nuisance_optimizer_never_manufactures_profile_endpoint(monkeypatch):
    original = module.optimize.minimize
    def fail_profiles(*args, **kwargs):
        if getattr(kwargs.get("jac"), "__name__", "") == "gradient":
            return optimize.OptimizeResult(success=False, fun=1e100, x=args[1])
        return original(*args, **kwargs)
    monkeypatch.setattr(module.optimize, "minimize", fail_profiles)
    result = fit_step_stress(VENDOR_STEPS, VENDOR_OBSERVATIONS)
    assert result["uncertainty"]["status"] == "incomplete"
    for interval in result["uncertainty"]["intervals"].values():
        assert interval["lower"] is None and interval["upper"] is None
        assert interval["endpoint_reasons"] == ["nuisance_optimizer_failed"] * 2


def test_joint_boundary_fit_withholds_ordinary_profile_intervals():
    # A late stress rise with survivors supports p=0 under the nonnegative law.
    obs = [dict(time=t, status="failure") for t in [1, 2, 3, 4, 7]]
    obs += [dict(time=20, status="right_censored") for _ in range(10)]
    result = fit_step_stress([dict(stress=1, duration=10), dict(stress=2, duration=10)], obs)
    assert result["status"] == "boundary"
    assert result["exponent_p"] == pytest.approx(0, abs=1e-5)
    assert result["uncertainty"]["status"] == "unavailable"
    assert result["uncertainty"]["reason"] == "exponent_on_physical_boundary"


def test_equal_initial_stages_do_not_manufacture_stress_information():
    steps = [dict(stress=1, duration=10), dict(stress=1, duration=10), dict(stress=2, duration=10)]
    observations = [dict(time=t, status="failure") for t in (12, 15, 20)]
    with pytest.raises(ValueError, match="unidentified"):
        fit_step_stress(steps, observations, profile=False)


def test_zero_exponent_does_not_overflow_extreme_stress_ratios():
    schedule = StepStressSchedule.from_steps([dict(stress=1e-300, duration=10), dict(stress=1e300, duration=10)])
    log_age, log_af = schedule.exposure([5, 15], 0)
    assert log_age == pytest.approx(np.log([5, 15]))
    assert log_af == pytest.approx([0, 0])
