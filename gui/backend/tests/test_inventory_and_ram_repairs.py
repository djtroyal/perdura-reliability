"""Independent probability/optimization checks for toolkit-derived workflows."""
import itertools
import math
import sys
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[3] / 'src')]

import numpy as np
import pytest
from fastapi import HTTPException
from scipy.stats import lognorm, poisson, nbinom
from routers.ram import AvailabilityRequest, MaintainabilityRequest, SparesRequest, availability, maintainability, spares
from routers.inventory import InventoryRequest, plan
from reliability.Inventory import lifetime_inventory
from reliability._demand import NegativeBinomialDemand


def test_availability_uses_one_maintenance_population():
    a = availability(AvailabilityRequest(mtbf=1000, mttr=1, mtbm=100, mean_maint_time=10))
    assert a['operational'] == a['achieved'] == pytest.approx(100/110)
    b = availability(AvailabilityRequest(mtbm=100, mean_maint_time=10, admin_delay=2, logistics_delay=3))
    assert b['operational'] == pytest.approx(100/115)
    assert b['downtime_breakdown']['active_maintenance'] == 10
    incomplete = availability(AvailabilityRequest(mtbf=1000, mttr=1, mtbm=100))
    assert 'operational' not in incomplete
    assert incomplete['operational_unavailable_reason']


def test_frequency_fit_matches_repeated_observations_and_declared_estimator():
    samples = [1., 2., 5.]; weights = [2, 4, 3]
    raw = np.repeat(samples, weights)
    a = maintainability(MaintainabilityRequest(mode='frequency', samples=samples, frequencies=weights))
    b = maintainability(MaintainabilityRequest(mode='data', samples=raw.tolist()))
    assert a['mmax'] == pytest.approx(b['mmax'])
    mu = np.mean(np.log(raw)); sd = np.std(np.log(raw), ddof=1)
    handbook = maintainability(MaintainabilityRequest(mode='frequency', samples=samples, frequencies=weights, estimator='sample_log_sd'))
    assert handbook['mmax'] == pytest.approx(lognorm.ppf(.95, s=sd, scale=math.exp(mu)))
    assert handbook['fitted']['sample_size'] == 9
    assert np.asarray(a['curve']['cdf']) + a['curve']['sf'] == pytest.approx(np.ones(80))
    with pytest.raises(HTTPException):
        maintainability(MaintainabilityRequest(mode='frequency', samples=samples, frequencies=[1, 0, 2]))


def test_mttr_only_exponential_is_explicit():
    r = maintainability(MaintainabilityRequest(mode='exponential', mttr=4, percentile=.95))
    assert r['mmax'] == pytest.approx(-4*math.log(.05))
    assert r['model'] == 'exponential_mttr_approximation'


def test_negative_binomial_preserves_small_failure_probability():
    for size in [1e12,1e20,1e100,1e300]:
        dist = NegativeBinomialDemand(10,size)
        assert dist.ppf(.95) == 15
        assert dist.cdf(15) == pytest.approx(poisson.cdf(15,10),abs=1e-11)
        assert dist.sf(15) == pytest.approx(poisson.sf(15,10),abs=1e-11)
    for mean,size in [(10,2),(.01,30),(1e4,.1)]:
        dist = NegativeBinomialDemand(mean,size)
        assert dist.ppf(.95) == nbinom.ppf(.95,size,size/(size+mean))
        assert dist.cdf([0,3,10]).tolist() == pytest.approx(nbinom.cdf([0,3,10],size,size/(size+mean)))
    for mode in ['period','lifetime']:
        r=plan(InventoryRequest(mode=mode,horizon=10,items=[{'part_number':'A','quantity':1,'failure_rate':1,'model':'negative_binomial','dispersion':1e20}]))
        assert r['rows'][0]['required_stock'] == 15


@pytest.mark.parametrize('model', ['poisson', 'negative_binomial'])
def test_spares_curve_bound_does_not_change_required_quantile(model):
    request = dict(quantity=1000, op_hours=1000, failure_rate=1, confidence=.95, model=model)
    a = spares(SparesRequest(**request, max_spares=50))
    b = spares(SparesRequest(**request, max_spares=10000000, curve_points=11))
    assert len(a['curve']['stock_level']) <= 51
    assert len(b['curve']['stock_level']) <= 11
    assert a['required_spares'] == b['required_spares']
    assert a['achieved_protection'] == b['achieved_protection'] >= .95
    assert b['required_spares'] in b['curve']['stock_level']
    assert b['required_spares']-1 in b['curve']['stock_level']


def test_lifetime_poisson_thinning_and_existing_stock():
    item = {'part_number': 'P1', 'quantity': 100, 'failure_rate': 1/50000, 'repair_probability': .8, 'initial_stock': 3, 'unit_cost': 10}
    r = plan(InventoryRequest(mode='lifetime', horizon=43800, items=[item]))
    row = r['rows'][0]
    assert row['expected_condemnations'] == pytest.approx(17.52)
    assert row['required_stock'] == 25
    assert row['purchase_quantity'] == 22
    assert r['purchase_cost'] == 220
    assert poisson.cdf(24,17.52) < .95 <= row['achieved_protection']


def test_pooled_parts_match_combined_quantity_and_reject_conflicts():
    a = {'part_number': 'same', 'quantity': 5, 'failure_rate': .001, 'source_ids': ['a']}
    b = {**a, 'quantity': 7, 'source_ids': ['b']}
    pooled = plan(InventoryRequest(items=[a,b], horizon=100))
    single = plan(InventoryRequest(items=[{**a,'quantity':12}], horizon=100))
    assert pooled['rows'][0]['required_stock'] == single['rows'][0]['required_stock']
    assert pooled['rows'][0]['source_ids'] == ['a','b']
    with pytest.raises(HTTPException, match='Conflicting'):
        plan(InventoryRequest(items=[a,{**b,'failure_rate':.002}], horizon=100))


def test_period_inventory_never_substitutes_an_undeclared_event_model():
    item = {'part_number': 'A', 'quantity': 1, 'failure_rate': .01}
    with pytest.raises(HTTPException, match='does not define event times'):
        plan(InventoryRequest(items=[{**item, 'model': 'negative_binomial', 'include_pipeline': True}], horizon=100))
    with pytest.raises(HTTPException, match='Lifetime procurement'):
        plan(InventoryRequest(items=[{**item, 'repair_probability': .8}], horizon=100))


def test_instantaneous_returns_require_no_pipeline_stock():
    item = {'part_number': 'A', 'quantity': 1, 'failure_rate': 1, 'include_pipeline': True, 'lead_mean': 0}
    period = plan(InventoryRequest(items=[item], horizon=5, simulations=200))
    lifetime = plan(InventoryRequest(items=[{**item,'repair_probability':1}], horizon=5, mode='lifetime', simulations=200))
    assert period['rows'][0]['required_stock'] == lifetime['rows'][0]['required_stock'] == 0


def test_cohort_retirement_exposure_and_repair_extremes():
    item = {'quantity': 10, 'failure_rate': .02, 'cohorts': [{'count': 10,'entry':10,'exit':30,'age':100}]}
    r = lifetime_inventory(item,100,.95)
    assert r['exposure'] == 200
    assert r['expected_condemnations'] == 4
    assert lifetime_inventory({**item,'repair_probability':1},100,.95)['required_stock'] == 0


def test_seeded_pipeline_and_storage_sensitivity():
    item = {'quantity':3,'failure_rate':.01,'repair_probability':.8,'include_pipeline':True,'lead_mean':10,'lead_sd':2}
    a = lifetime_inventory(item,100,.9,trials=250,seed=4)
    assert a == lifetime_inventory(item,100,.9,trials=250,seed=4)
    b = lifetime_inventory({**item,'storage_failure_rate':.015},100,.9,trials=250,seed=4)
    assert b['expected_condemnations'] == a['expected_condemnations']
    assert b['required_stock'] >= a['required_stock']
    assert a['stock_interval']['lower'] <= a['required_stock'] <= a['stock_interval']['upper']


def test_weibull_exponential_limit_matches_poisson_count_quantile():
    a = lifetime_inventory({'quantity':10,'model':'weibull','failure_rate':.01,'weibull_alpha':100,'weibull_beta':1},100,.9,trials=1500,seed=2026)
    expected = int(poisson.ppf(.9,10))
    assert a['stock_interval']['lower'] <= expected <= a['stock_interval']['upper']


@pytest.mark.parametrize('dependence', ['independent','unspecified'])
def test_joint_minimum_cost_matches_exhaustive_integer_search(dependence):
    req = InventoryRequest(items=[{'part_number':'A','quantity':1,'failure_rate':2,'unit_cost':100}, {'part_number':'B','quantity':1,'failure_rate':4,'unit_cost':1}],
        horizon=1, target='joint',service_probability=.9, dependence=dependence, allocation='minimum_cost', maximum_stock=15)
    r = plan(req)
    def feasible(a,b):
        p,q=poisson.cdf(a,2),poisson.cdf(b,4)
        return (p*q if dependence=='independent' else p+q-1) >= .9
    optimum = min(100*a+b for a,b in itertools.product(range(16),repeat=2) if feasible(a,b))
    assert r['purchase_cost'] == optimum
    assert r['optimization']['optimality_gap'] == 0
    assert (r['joint_protection'] if dependence=='independent' else r['joint_protection_lower_bound']) >= .9
