"""System lifecycle checks against closed forms and deterministic event calendars."""
import math
import numpy as np
import pytest
from scipy import stats

from reliability.System_models import redundancy_model, redundancy_reference
from reliability.System_renewal import Lifetime, SystemStructure, system_renewal
from reliability.System_simulation import simulate_system


def diagram(count=1, parallel=False, **data):
    nodes = [{"id": "s", "type": "source", "data": {}}, {"id": "z", "type": "sink", "data": {}}]
    nodes += [{"id": f"c{i}", "type": "component", "data": {"distribution": "exponential", "dist_params": {"lambda": .001}, **data}} for i in range(count)]
    paths = [["s", f"c{i}", "z"] for i in range(count)] if parallel else [["s", *[f"c{i}" for i in range(count)], "z"]]
    edges = [{"source": a, "target": b} for path in paths for a, b in zip(path, path[1:])]
    return SystemStructure("rbd", nodes, edges)


def initial_vector(mc, initial):
    return np.array([initial.get(s.id, 0.) for s in mc.states])


@pytest.mark.parametrize("crews,stationary_mean", [(1, 6100.), (2, 6050.)])
def test_active_repair_first_passage_and_stationary_cycle_are_distinct(crews, stationary_mean):
    mc, p, _ = redundancy_model(required=1, total=2, failure_rate=.001, repair_rate=.01, repair_crews=crews)
    assert mc.mttf(initial_vector(mc, p)) == pytest.approx(6500.)
    assert 1 / mc.failure_frequency() == pytest.approx(stationary_mean)


@pytest.mark.parametrize("switching", ["independent", "common"])
@pytest.mark.parametrize("coverage", [0., .5, 1.])
def test_standby_mixture_matches_transfer_count_closed_form(switching, coverage):
    mc, initial, _ = redundancy_model(mode="standby", required=2, total=4, failure_rate=.001,
        repair_rate=0, switch_repair_rate=0, coverage=coverage, switching=switching)
    p = initial_vector(mc, initial)
    reference = redundancy_reference(mode="standby", required=2, total=4, failure_rate=.001,
        time=500, coverage=coverage, switching=switching)
    expected_r = math.exp(-1) * (1 + coverage + (coverage**2 if switching == "independent" else coverage) / 2)
    assert reference["reliability"] == pytest.approx(expected_r)
    assert mc.reliability(500, p) == pytest.approx(expected_r)
    assert mc.mttf(p) == pytest.approx(reference["mttf"])


def test_unequal_no_repair_parallel_first_passage():
    mc, p, _ = redundancy_model(required=1, total=2, failure_rates=[.001, .002], repair_rates=[0, 0])
    expected = 1000 + 500 - 1/.003
    assert mc.mttf(initial_vector(mc, p)) == pytest.approx(expected)
    assert mc.reliability(1000, initial_vector(mc, p)) == pytest.approx(1-(1-math.exp(-1))*(1-math.exp(-2)))


def test_dormant_hazard_reduces_standby_survival_and_zero_rates_absorb():
    zero, p, _ = redundancy_model(failure_rate=0)
    assert len(zero.states) == 1 and not zero.transitions and list(p.values()) == [1]
    ready, p, _ = redundancy_model(mode="standby", repair_rate=0, switch_repair_rate=0)
    dormant, q, _ = redundancy_model(mode="standby", repair_rate=0, switch_repair_rate=0, dormant_rate=.002)
    assert dormant.reliability(1000, initial_vector(dormant, q)) < ready.reliability(1000, initial_vector(ready, p))


def test_whole_system_renewal_keeps_uptime_calendar_and_cycle_metrics_distinct():
    structure = diagram()
    life = structure.lifetimes(1000)
    scheduled = system_renewal(structure, life, 1000, downtime=10)
    age = system_renewal(structure, life, 1000, policy="age", downtime=10)
    uptime = 1000 * -math.expm1(-1)
    assert scheduled["restricted_mean"] == pytest.approx(uptime)
    assert scheduled["mttf"] == pytest.approx(1000)
    assert scheduled["mean_operating_time_per_failure"] == pytest.approx(1000)
    assert scheduled["availability"] == pytest.approx(uptime/1010)
    assert age["availability"] == pytest.approx(uptime/(uptime+10))
    assert scheduled["mean_calendar_time_per_failure"] == pytest.approx(1010/-math.expm1(-1))


def test_parallel_mttf_weibull_and_rare_event_ratio():
    parallel = diagram(2, parallel=True)
    parallel_result = system_renewal(parallel, parallel.lifetimes(1000), 1000)
    assert parallel_result["mttf"] == pytest.approx(1500)
    last = parallel_result["curve"][-1]
    density = 2 * .001 * math.exp(-1) * (1-math.exp(-1))
    assert last["density"] == pytest.approx(density)
    assert last["hazard"] == pytest.approx(density/(2*math.exp(-1)-math.exp(-2)))
    weibull = diagram(distribution="weibull", dist_params={"alpha": 2., "beta": .5})
    assert system_renewal(weibull, weibull.lifetimes(1), 1)["mttf"] == pytest.approx(4, rel=1e-7)
    tiny = diagram(dist_params={"lambda": 1e-20})
    result = system_renewal(tiny, tiny.lifetimes(1), 1, include_mttf=False)
    assert result["failure_probability"] == pytest.approx(1e-20, rel=1e-12, abs=0)
    assert result["mean_operating_time_per_failure"] == pytest.approx(1e20)


def test_divergent_mean_withheld_without_renaming_restricted_mean():
    heavy = diagram(distribution="loglogistic", dist_params={"alpha": 1., "beta": .8})
    result = system_renewal(heavy, heavy.lifetimes(1), 1)
    assert result["restricted_mean"] > 0
    assert result["mttf"] is None and result["mttf_status"] == "unresolved_or_infinite"


def test_zero_exposure_is_failure_free_and_infinite_mean_unresolved():
    structure = diagram(mission_time=0)
    life = structure.lifetimes(1000)
    assert math.isinf(life["c0"].sample(np.random.default_rng(1)))
    result = system_renewal(structure, life, 10)
    assert result["reliability"] == 1 and result["restricted_mean"] == pytest.approx(10)
    assert result["mttf"] is None


def test_repeated_identity_and_state_override_coherence():
    repeated = diagram(2, component_key="same")
    table = repeated.state_table({"same": .9})
    assert len(table["rows"]) == 2 and table["success_probability"] == pytest.approx(.9)
    base = diagram(2)
    changed = SystemStructure("rbd", base.nodes, base.edges, {"0": True})
    assert not changed.coherent
    assert changed.state_table({"c0": .9, "c1": .8})["success_probability"] == pytest.approx(.74)
    with pytest.raises(ValueError, match="coherent"):
        system_renewal(changed, changed.lifetimes(1000), 1000)
    with pytest.raises(ValueError, match="above"):
        diagram(13).state_table({f"c{i}": .9 for i in range(13)})


def test_static_fta_matches_series_rbd_and_repeated_event_identity():
    nodes = [{"id": "top", "type": "or", "data": {}},
             {"id": "a", "type": "basic", "data": {"eventKey": "shared"}},
             {"id": "b", "type": "basic", "data": {"eventKey": "shared"}}]
    fta = SystemStructure("fta", nodes, [{"source": "top", "target": "a"}, {"source": "top", "target": "b"}])
    assert fta.keys == ["shared"]
    assert fta.probability({"shared": .9}) == pytest.approx(.9)
    assert fta.succeeds({"shared": True}) and not fta.succeeds({"shared": False})


def fixed(value):
    return {"distribution": "deterministic", "params": {"value": value}}


def deterministic(structure, lives, policies, **options):
    return simulate_system(structure, {key: Lifetime("deterministic", {"value": lives[key]}) for key in structure.keys},
                           policies, replications=20, **options)


def test_deterministic_fifo_queue_and_calendar_vs_operating_clocks():
    structure = diagram(2)
    policies = {key: {"repair": fixed(10)} for key in structure.keys}
    calendar = deterministic(structure, {"c0": 2, "c1": 3}, policies, horizon=8)
    operating = deterministic(structure, {"c0": 2, "c1": 3}, policies, horizon=8, clock="operating")
    assert calendar["component_failures"]["mean"] == 2
    assert operating["component_failures"]["mean"] == 1
    assert calendar["availability"]["mean"] == operating["availability"]["mean"] == .25
    queue = deterministic(structure, {"c0": 1, "c1": 1}, {key: {"repair": fixed(2)} for key in structure.keys}, horizon=5)
    starts = [(event["component"], event["time"]) for event in queue["events"] if event["event"] == "corrective_start"]
    assert starts == [("c0", 1), ("c1", 3)]
    assert queue["availability"]["mean"] == pytest.approx(.2)


def test_pm_deferred_repair_and_tie_policy():
    structure = diagram()
    pm = deterministic(structure, {"c0": 100}, {"c0": {"pm_interval": 3, "pm_duration": fixed(1)}}, horizon=10)
    assert pm["availability"]["mean"] == pytest.approx(.7)
    assert pm["critical_failure_count"] == 0 and pm["system_outages"]["mean"] == 3
    deferred = deterministic(structure, {"c0": 2}, {"c0": {"pm_interval": 5, "defer_repair": True, "repair": fixed(1)}}, horizon=10)
    assert deferred["availability"]["mean"] == pytest.approx(.4)
    ties = deterministic(structure, {"c0": 3}, {"c0": {"pm_interval": 3, "pm_duration": fixed(1)}}, horizon=6)
    assert ties["component_failures"]["mean"] == 0


def test_spares_and_unsuccessful_restoration():
    structure = diagram()
    one = deterministic(structure, {"c0": 1}, {"c0": {"repair": fixed(1), "spares": 1, "supply_lead_time": 100}}, horizon=6)
    assert one["availability"]["mean"] == pytest.approx(1/3)
    none = deterministic(structure, {"c0": 1}, {"c0": {"repair": fixed(1), "spares": 0}}, horizon=6)
    failed = deterministic(structure, {"c0": 1}, {"c0": {"repair": fixed(1), "repair_yield": 0}}, horizon=6)
    assert none["availability"]["mean"] == failed["availability"]["mean"] == pytest.approx(1/6)
    assert any(event["event"] == "restoration_unsuccessful" for event in failed["events"])


def test_exponential_des_matches_independent_finite_horizon_occupation_formula():
    structure = diagram()
    result = simulate_system(structure, structure.lifetimes(1000), {"c0": {"repair": {"distribution": "exponential", "params": {"mean": 100}}}},
                             horizon=10000, replications=1000, seed=375, confidence=.99)
    rate, repair = .001, .01
    stationary = repair/(rate+repair)
    exact = stationary + (1-stationary)*(-math.expm1(-(rate+repair)*10000))/(10000*(rate+repair))
    assert result["availability"]["lower"] < exact < result["availability"]["upper"]
    assert result["mean_operating_time_per_critical_failure"] == pytest.approx(1000, rel=.04)
    assert result["analysis_basis"] == "as_new_finite_horizon"


def test_seed_reproducibility_no_negative_clipping_and_event_budget():
    structure = diagram()
    first = simulate_system(structure, structure.lifetimes(1000), {}, horizon=100, replications=20, seed=7)
    second = simulate_system(structure, structure.lifetimes(1000), {}, horizon=100, replications=20, seed=7)
    assert first == second
    with pytest.raises(ValueError, match="conditioning"):
        Lifetime("normal", {"mu": 1., "sigma": 1.})
    positive = Lifetime("normal", {"mu": 1., "sigma": 1.}, condition_positive=True)
    rng = np.random.default_rng(12)
    assert all(positive.sample(rng) > 0 for _ in range(50))
    with pytest.raises(ValueError, match="budget exceeded"):
        deterministic(structure, {"c0": 1}, {"c0": {"repair": fixed(1)}}, horizon=10, max_events=1)


def test_concurrent_crew_demand_reserves_people_for_whole_service():
    structure = diagram(2)
    policies = {key: {"repair": fixed(2), "crew_demand": 2, "crew_role_id": "technician"} for key in structure.keys}
    result = deterministic(structure, {"c0": 1, "c1": 1}, policies, repair_crews=3, horizon=5)
    assert result["availability"]["mean"] == pytest.approx(.2)
    assert result["crew_utilization"]["mean"] == pytest.approx(8/15)
    assert [(e["time"], e["crews_busy"]) for e in result["events"] if e["event"] == "corrective_start"] == [(1,2),(3,2)]
    policies["c1"]["crew_role_id"] = "different-skill"
    with pytest.raises(ValueError, match="qualified crew"):
        deterministic(structure, {"c0": 1, "c1": 1}, policies, repair_crews=3, horizon=5)


def test_pm_outage_is_not_reclassified_by_unrelated_simultaneous_failure():
    structure = diagram(2)
    result = deterministic(structure, {"c0": 1, "c1": 1}, {"c0": {"pm_interval": 1, "pm_duration": fixed(1)}}, horizon=1.5)
    assert result["system_outages"]["mean"] == 1
    assert result["component_failures"]["mean"] == 1
    assert result["critical_failure_count"] == 0


def test_tail_refinement_failure_withholds_first_infinite_integral(monkeypatch):
    from reliability import System_renewal as module
    calls = 0
    original = module.integrate.quad
    def imperfect(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            return 1., 1.
        return original(*args, **kwargs)
    monkeypatch.setattr(module.integrate, "quad", imperfect)
    structure = diagram()
    result = system_renewal(structure, structure.lifetimes(1000), 1000)
    assert result["mttf"] is None and result["numerical"]["mttf_error_estimate"] is None
    assert result["mttf_status"] == "unresolved_or_infinite"
