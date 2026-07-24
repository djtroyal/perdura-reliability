import math

import pytest

from reliability.Growth_planning import plan_reliability_growth


def test_anchored_power_law_reaches_requested_target():
    result = plan_reliability_growth(
        current_test_time=100,
        current_mtbf=50,
        target_mtbf=100,
        growth_rate=0.5,
    )
    trajectory = result["trajectory"]
    assert trajectory["test_time_at_target"] == pytest.approx(400)
    assert trajectory["additional_test_time_to_target"] == pytest.approx(300)
    assert trajectory["planned_end_mtbf"] == pytest.approx(100)
    # Integral of 1 / (50 * sqrt(t/100)) from 100 to 400.
    assert trajectory["expected_failures_to_planned_end"] == pytest.approx(4)


def test_planned_horizon_reports_target_shortfall_without_rewriting_target():
    result = plan_reliability_growth(
        current_test_time=100, current_mtbf=50, target_mtbf=100,
        growth_rate=0.5, planned_additional_test_time=100,
    )["trajectory"]
    assert result["planned_end_time"] == 200
    assert result["planned_end_mtbf"] == pytest.approx(50 * math.sqrt(2))
    assert result["target_met_at_planned_end"] is False


def test_delayed_fix_projection_preserves_unaddressed_rate_and_fef_bounds():
    projection = plan_reliability_growth(
        current_test_time=100, current_mtbf=50, target_mtbf=100,
        growth_rate=0.5, unaddressed_failure_rate=0.002,
        corrective_actions=[
            {"name": "A", "baseline_failure_rate": 0.01,
             "planned_fix_time": 150, "effectiveness": 0.6,
             "effectiveness_lower": 0.4, "effectiveness_upper": 0.8},
            {"name": "B", "baseline_failure_rate": 0.005,
             "planned_fix_time": 200, "effectiveness": 0.5},
        ],
    )["corrective_action_projection"]
    assert projection["initial_failure_rate"] == pytest.approx(0.017)
    assert projection["growth_potential_failure_rate"] == pytest.approx(0.0085)
    assert projection["growth_potential_mtbf"] == pytest.approx(1 / 0.0085)
    assert projection["growth_potential_mtbf_lower"] < projection["growth_potential_mtbf"]
    assert projection["growth_potential_mtbf_upper"] > projection["growth_potential_mtbf"]


def test_invalid_growth_plans_fail_closed():
    with pytest.raises(ValueError, match="strictly between"):
        plan_reliability_growth(
            current_test_time=100, current_mtbf=50, target_mtbf=100,
            growth_rate=1,
        )
    with pytest.raises(ValueError, match="cannot precede"):
        plan_reliability_growth(
            current_test_time=100, current_mtbf=50, target_mtbf=100,
            growth_rate=0.5,
            corrective_actions=[{"baseline_failure_rate": 0.1,
                                 "planned_fix_time": 90, "effectiveness": 0.5}],
        )
