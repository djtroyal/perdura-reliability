"""Independent probability, stopping-rule and design contracts."""
import itertools
import math

import numpy as np
import pytest
from scipy import stats

from reliability.Inference_tools import (
    mtbf_interval, binomial_interval, normal_mean_interval, discrete_probability,
    bernoulli_sprt, exponential_sprt,
)
from reliability.Growth_planning import plan_reliability_growth
from reliability.Reliability_testing import sequential_sampling_chart, one_sample_proportion


def test_mtbf_stopping_design_and_exposure_ledger():
    fixed = mtbf_interval(failures=2, total_exposure=800, confidence=.9)
    stopped = mtbf_interval(failures=2, total_exposure=800, confidence=.9, termination='failure')
    assert fixed['mtbf_lower'] == pytest.approx(127.06896827442834)
    assert stopped['mtbf_lower'] == pytest.approx(168.63888015743993)
    assert fixed['mtbf_upper'] == pytest.approx(2251.228610625704)
    assert stopped['mtbf_upper'] == fixed['mtbf_upper']
    ledger = mtbf_interval(failures=0, exposure_rows=[{'units': 10, 'duration': 100, 'duty': .8}], confidence=.95, sides='lower')
    assert ledger['mtbf_lower'] == pytest.approx(800 / -math.log(.05))
    assert ledger['mtbf_estimate'] is None and ledger['rate_estimate'] == 0
    assert ledger['rate_upper'] == pytest.approx(1 / ledger['mtbf_lower'])
    with pytest.raises(ValueError, match='at least one'):
        mtbf_interval(failures=0, total_exposure=800, termination='failure')
    with pytest.raises(ValueError, match='not both'):
        mtbf_interval(failures=1, total_exposure=800, exposure_rows=[{'duration': 100}])


def test_binomial_sides_orientation_and_no_sample_size_switch():
    result = binomial_interval(trials=20, count=20, sides='lower')
    assert result['lower'] == pytest.approx(.05 ** (1/20))
    two = one_sample_proportion(20, 20)
    assert two['lower'] == pytest.approx(.025 ** (1/20))
    defect = binomial_interval(trials=20, count=0, sides='upper', orientation='defect')
    assert defect['reliability_lower'] == pytest.approx(result['lower'])
    large = binomial_interval(trials=1000, count=1000, sides='lower')
    assert large['method'] == 'clopper_pearson_exact'
    assert large['lower'] == pytest.approx(.05 ** .001)
    with pytest.raises(ValueError, match='integers'):
        one_sample_proportion(3.2, 2)


def test_normal_summary_unknown_variance_always_student_t():
    unknown = normal_mean_interval(mean=100, standard_deviation=10, sample_size=31)
    known = normal_mean_interval(mean=100, standard_deviation=10, sample_size=31, sigma_known=True)
    assert unknown['lower'] == pytest.approx(96.33197038665053)
    assert known['lower'] == pytest.approx(96.47980076595083)
    assert unknown['lower'] < known['lower']
    upper = normal_mean_interval(mean=100, standard_deviation=10, sample_size=31, sides='upper')
    assert upper['lower'] is None
    assert upper['upper'] == pytest.approx(100 + stats.t.ppf(.95,30)*10/math.sqrt(31))


def test_discrete_probabilities_and_hypergeometric_enumeration():
    binomial = discrete_probability(sample_size=30, probability=.05, threshold=2)
    assert binomial['probability'] == pytest.approx(.8121788131469607)
    finite = discrete_probability(sample_size=4, model='hypergeometric', lot_size=10, lot_defects=3, threshold=1)
    expected = sum(math.comb(3,x)*math.comb(7,4-x)/math.comb(10,4) for x in (0,1))
    assert finite['probability_accept'] == pytest.approx(expected)
    assert sum(finite['table']['pmf']) == pytest.approx(1)
    tail = discrete_probability(sample_size=1000, probability=.001, threshold=30, event='at_least')
    assert tail['probability'] > 0  # do not lose the tiny tail via 1-CDF
    assert tail['probability'] == stats.binom.sf(29,1000,.001)
    between = discrete_probability(sample_size=10, probability=.5, threshold=8, upper=10, event='between')
    assert between['probability'] == pytest.approx(sum(math.comb(10,x) for x in range(8,11))/1024)


def test_invalid_sprt_risks_never_make_overlapping_decisions():
    for alpha,beta in ((.8,.8),(.5,.5),(.9,.1)):
        with pytest.raises(ValueError, match='alpha \\+ beta'):
            sequential_sampling_chart(.01,.1,alpha,beta)
        with pytest.raises(ValueError, match='alpha \\+ beta'):
            bernoulli_sprt(good_probability=.01,bad_probability=.1,alpha=alpha,beta=beta)


def test_bernoulli_integer_boundaries_and_first_crossing():
    result = bernoulli_sprt(good_probability=.01,bad_probability=.1,horizon=50, outcomes=[1,1,0,0])
    row = result['boundaries'][49]
    assert row['accept_at_most'] == 1 and row['reject_at_least'] == 4
    assert result['decision'] == 'reject' and result['stopping_time'] == 2
    assert result['ignored_observations'] == 2
    assert len(result['trace']) == 2


@pytest.mark.parametrize('terminal',['inconclusive','likelihood_ratio'])
def test_bernoulli_exact_oc_matches_exhaustive_paths(terminal):
    p0,p1,alpha,beta,N = .1,.7,.2,.2,6
    plan = bernoulli_sprt(good_probability=p0,bad_probability=p1,alpha=alpha,beta=beta,horizon=N,terminal_rule=terminal,oc_points=3)
    A,B = beta/(1-alpha),(1-beta)/alpha
    for p in [p0,p1]:
        total = {'accept':0.,'reject':0.,'inconclusive':0.}
        mean = 0.
        for path in itertools.product([0,1],repeat=N):
            weight = p**sum(path)*(1-p)**(N-sum(path))
            likelihood = 1.
            decision = 'inconclusive'
            for n,x in enumerate(path,1):
                likelihood *= p1/p0 if x else (1-p1)/(1-p0)
                if likelihood <= A: decision='accept';break
                if likelihood >= B: decision='reject';break
            if decision == 'inconclusive' and terminal == 'likelihood_ratio':
                decision = 'accept' if likelihood <= 1 else 'reject'
            total[decision] += weight
            mean += n*weight
        row = next(row for row in plan['oc_curve'] if row['true_value']==p)
        assert row['probability_accept'] == pytest.approx(total['accept'])
        assert row['probability_reject'] == pytest.approx(total['reject'])
        assert row['probability_inconclusive'] == pytest.approx(total['inconclusive'])
        assert row['expected_duration'] == pytest.approx(mean)


def test_exponential_continuous_acceptance_first_event_rejection_and_truncation():
    args = dict(good_mtbf=1000,bad_mtbf=100,alpha=.1,beta=.1,horizon=1000,simulations=200,oc_points=3)
    crossing = math.log(9)/(.01-.001)
    accepted = exponential_sprt(**args, observed_exposure=800, failure_times=[400,600])
    assert accepted['decision']=='accept' and accepted['stopping_time']==pytest.approx(crossing)
    assert accepted['ignored_observations']==2
    rejected = exponential_sprt(**args,observed_exposure=800,failure_times=[1,5])
    assert rejected['decision']=='reject' and rejected['stopping_time']==1
    assert rejected['ignored_observations']==1
    truncated = exponential_sprt(**{**args,'horizon':10},observed_exposure=10)
    assert truncated['decision']=='inconclusive'
    forced = exponential_sprt(**{**args,'horizon':10},observed_exposure=10,terminal_rule='likelihood_ratio')
    assert forced['decision']=='accept'


def test_exponential_oc_known_short_horizon_and_unit_scaling():
    args = dict(good_mtbf=1000,bad_mtbf=100,alpha=.1,beta=.1,horizon=10,
                simulations=10000,oc_points=3,seed=27,terminal_rule='likelihood_ratio')
    plan = exponential_sprt(**args)
    # Here every event before horizon crosses rejection; no event accepts at horizon.
    for row in plan['oc_curve']:
        theta=row['true_value']
        expected=math.exp(-10/theta)
        assert abs(row['probability_accept']-expected) < .02
        assert row['expected_duration'] == pytest.approx(theta * -math.expm1(-10/theta), abs=.2)
        assert row['probability_inconclusive']==0
    converted=exponential_sprt(**{**args,'good_mtbf':1,'bad_mtbf':.1,'horizon':.01})
    for left,right in zip(plan['oc_curve'],converted['oc_curve']):
        assert left['probability_accept']==right['probability_accept']
        assert left['expected_duration']/1000==pytest.approx(right['expected_duration'])


def test_growth_phase_average_conversion_and_integrated_failures():
    plan=plan_reliability_growth(current_test_time=1000,current_mtbf=50,target_mtbf=110,growth_rate=.23,
        baseline_basis='initial_phase_average',phase_durations=[1500,2500,2000,3000],provenance='Independent test plan')
    assert plan['baseline']['instantaneous_mtbf']==pytest.approx(50/.77)
    assert plan['trajectory']['planned_end_mtbf']==pytest.approx(110.27556184816521)
    assert plan['phase_table'][-1]['cumulative_expected_failures']==pytest.approx(20*10**.77)
    phase2=plan['phase_table'][1]
    expected=20*((2.5)**.77-1)
    assert phase2['expected_failures']==pytest.approx(expected)
    assert phase2['average_mtbf']==pytest.approx(1500/expected)
    assert plan['baseline']['provenance']=='Independent test plan'
