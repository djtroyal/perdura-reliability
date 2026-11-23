"""Direct-engine validation and explicit failure of unresolved event paths."""
import math
import numpy as np
import pytest
from reliability.Inventory import lifetime_inventory, _fifo_stock_protects


@pytest.mark.parametrize('change', [
    {'quantity': 1.5}, {'quantity': True}, {'quantity': 0},
    {'duty_cycle': 2}, {'duty_cycle': float('nan')},
    {'repair_probability': -1}, {'repair_probability': 1.1},
    {'failure_rate': -1}, {'failure_rate': float('inf')},
    {'initial_stock': -1}, {'initial_stock': .5},
    {'model': 'other'}, {'dispersion': 0},
    {'include_pipeline': 'false'}, {'lead_mean': 0, 'lead_sd': 1},
    {'cohorts': {}},
    {'cohorts': [{'count': 2}]},
    {'cohorts': [{'count': 1, 'entry': 2, 'exit': 1}]},
    {'cohorts': [{'count': 1, 'age': -1}]},
    {'model': 'weibull', 'weibull_alpha': 1, 'weibull_beta': 0},
])
def test_invalid_physical_inputs_rejected_by_direct_engine(change):
    with pytest.raises(ValueError):
        lifetime_inventory({'quantity': 1, 'failure_rate': .1, **change}, 10, .95, trials=200)


@pytest.mark.parametrize('kwargs', [
    {'horizon': 0}, {'horizon': float('inf')}, {'service': 1},
    {'service': 0}, {'trials': 0}, {'trials': 2.5}, {'seed': -1},
])
def test_invalid_calculation_controls(kwargs):
    with pytest.raises(ValueError):
        lifetime_inventory({'quantity': 1, 'failure_rate': .1}, **{'horizon': 10, 'service': .95, 'trials': 200, **kwargs})


def test_weibull_nonprogress_is_not_silently_counted_or_censored():
    # Unit-scale lifetimes cannot advance a calendar time of 1e20 in binary64.
    item = {'quantity': 1, 'model': 'weibull', 'weibull_alpha': 1, 'weibull_beta': 2,
            'cohorts': [{'count': 1, 'entry': 1e20}]}
    with pytest.raises(ValueError, match='calendar-time resolution'):
        lifetime_inventory(item, 2e20, .95, trials=200)


def test_simulation_rejects_path_budget_before_entering_unit_loop():
    with pytest.raises(ValueError, match='five million'):
        lifetime_inventory({'quantity': 100000, 'model': 'weibull', 'weibull_alpha': 1e100, 'weibull_beta': 2}, 1, .95, trials=200)


def test_direct_inputs_not_mutated_and_calendar_scaling_preserves_seeded_result():
    item = {'quantity': 2, 'failure_rate': .1, 'repair_probability': .8, 'include_pipeline': True, 'lead_mean': 2}
    original = dict(item)
    a = lifetime_inventory(item, 10, .9, trials=200, seed=123)
    b = lifetime_inventory({**item, 'failure_rate': .01, 'lead_mean': 20}, 100, .9, trials=200, seed=123)
    assert item == original
    assert a['required_stock'] == b['required_stock']
    assert a['expected_condemnations'] == b['expected_condemnations']
    assert a['achieved_protection'] == b['achieved_protection']


def test_fifo_does_not_use_future_deterioration_to_select_stock():
    # Both items are alive at t=1. FIFO issues token 0 (expiry 100), leaving
    # token 1 to deteriorate at t=2 and causing a shortage at t=3.
    # Clairvoyant earliest-expiry issue would instead serve both demands.
    events = [(1.,1,None),(3.,1,None)]
    assert not _fifo_stock_protects([100.,2.],events)
    assert _fifo_stock_protects([100.,2.,100.],events)


def test_fifo_return_identity_and_initial_prefix_make_service_monotone():
    rng = np.random.default_rng(321)
    for _ in range(200):
        initial = rng.exponential(5,20).tolist()
        events = [(float(t),1,None) for t in rng.uniform(0,10,8)]
        events += [(float(t),0,float(t+life)) for t,life in zip(rng.uniform(0,10,6),rng.exponential(5,6))]
        events.sort(key=lambda e:(e[0],e[1]))
        protection = [_fifo_stock_protects(initial[:stock],events) for stock in range(21)]
        assert protection == sorted(protection)
    assert _fifo_stock_protects([],[(1.,0,3.),(1.,1,None)])
    assert not _fifo_stock_protects([],[(1.,0,1.),(1.,1,None)])


def test_fifo_matches_memoryless_storage_probability():
    # With two initial spares and demands at 1 and 3, FIFO requires both
    # spares alive at 1 and the unissued spare alive for two more units.
    # P(protection)=exp(-delta*(1+3)), without knowledge of future expiry.
    rng = np.random.default_rng(1234)
    delta, trials = .2, 30000
    events = [(1.,1,None),(3.,1,None)]
    measured = np.mean([_fifo_stock_protects(expiries,events) for expiries in rng.exponential(1/delta,(trials,2))])
    oracle = math.exp(-delta*4)
    assert abs(measured-oracle) < 6*math.sqrt(oracle*(1-oracle)/trials)


def test_fifo_storage_seed_sensitivity_and_calendar_scale_invariance():
    item = {'quantity':3,'failure_rate':.02,'repair_probability':.8,'include_pipeline':True,'lead_mean':5,'storage_failure_rate':.005}
    a = lifetime_inventory(item,100,.95,trials=200,seed=401)
    assert a == lifetime_inventory(item,100,.95,trials=200,seed=401)
    faster = lifetime_inventory({**item,'storage_failure_rate':.02},100,.95,trials=200,seed=401)
    scaled = lifetime_inventory({**item,'failure_rate':.002,'lead_mean':50,'storage_failure_rate':.0005},1000,.95,trials=200,seed=401)
    assert faster['required_stock'] >= a['required_stock']
    assert faster['expected_condemnations'] == a['expected_condemnations']
    assert scaled['required_stock'] == a['required_stock']
    assert scaled['achieved_protection'] == a['achieved_protection']


def test_analytic_stock_never_exceeds_exact_integer_precision(monkeypatch):
    import reliability.Inventory as inventory
    with pytest.raises(ValueError,match='integer precision'):
        lifetime_inventory({'quantity':1,'failure_rate':1},1e300,.95)
    class Unresolved:
        def ppf(self, _):
            return math.nan
    monkeypatch.setattr(inventory,'poisson',lambda _:Unresolved())
    with pytest.raises(ValueError,match='unresolved'):
        lifetime_inventory({'quantity':1,'failure_rate':1},10,.95)


def test_stock_inversion_checks_the_limit_before_rejecting(monkeypatch):
    import reliability.Inventory as inventory
    # A monotone service boundary between the last doubling and the resource
    # limit must still be searched; doubling must not skip valid stock levels.
    monkeypatch.setattr(inventory,'_fifo_stock_protects',lambda initial,events:len(initial)>=90000)
    out = lifetime_inventory({'quantity':1,'failure_rate':1,'storage_failure_rate':.01},100,.95,trials=2,seed=42)
    assert out['required_stock']==90000
