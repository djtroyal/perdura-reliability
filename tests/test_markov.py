"""Tests for the Markov chain reliability analysis module."""

import math
import numpy as np
import pytest
from reliability.Markov import (
    MarkovState,
    MarkovTransition,
    MarkovChain,
    simple_repairable,
    redundant_standby,
    triple_modular_redundancy,
    EXAMPLE_MODELS,
)


# ---------------------------------------------------------------------------
# State and Transition creation
# ---------------------------------------------------------------------------

class TestMarkovState:
    def test_basic_creation(self):
        s = MarkovState('s0', 'Operating', 'operational', 'System is up')
        assert s.id == 's0'
        assert s.name == 'Operating'
        assert s.state_type == 'operational'
        assert s.description == 'System is up'

    def test_default_values(self):
        s = MarkovState('s1', 'State 1')
        assert s.state_type == 'operational'
        assert s.description == ''


class TestMarkovTransition:
    def test_basic_creation(self):
        t = MarkovTransition('s0', 's1', 0.001, 'failure')
        assert t.from_state == 's0'
        assert t.to_state == 's1'
        assert t.rate == 0.001
        assert t.label == 'failure'

    def test_default_label(self):
        t = MarkovTransition('a', 'b', 0.5)
        assert t.label == ''


# ---------------------------------------------------------------------------
# MarkovChain construction
# ---------------------------------------------------------------------------

class TestChainConstruction:
    def test_add_states(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('a', 'A'))
        mc.add_state(MarkovState('b', 'B', 'failed'))
        assert mc.n_states == 2

    def test_duplicate_state_raises(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('a', 'A'))
        with pytest.raises(ValueError, match="already exists"):
            mc.add_state(MarkovState('a', 'A again'))

    def test_add_transition_unknown_from(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('a', 'A'))
        with pytest.raises(ValueError, match="Unknown state"):
            mc.add_transition(MarkovTransition('x', 'a', 0.1))

    def test_add_transition_unknown_to(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('a', 'A'))
        with pytest.raises(ValueError, match="Unknown state"):
            mc.add_transition(MarkovTransition('a', 'x', 0.1))

    def test_negative_rate_raises(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('a', 'A'))
        mc.add_state(MarkovState('b', 'B'))
        with pytest.raises(ValueError, match="non-negative"):
            mc.add_transition(MarkovTransition('a', 'b', -0.1))

    def test_constructor_with_lists(self):
        states = [MarkovState('a', 'A'), MarkovState('b', 'B', 'failed')]
        trans = [MarkovTransition('a', 'b', 0.01)]
        mc = MarkovChain(states=states, transitions=trans)
        assert mc.n_states == 2
        assert len(mc.transitions) == 1


# ---------------------------------------------------------------------------
# Index properties
# ---------------------------------------------------------------------------

class TestStateIndices:
    @pytest.fixture
    def mc(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('op', 'Operating', 'operational'))
        mc.add_state(MarkovState('deg', 'Degraded', 'degraded'))
        mc.add_state(MarkovState('fail', 'Failed', 'failed'))
        return mc

    def test_operational(self, mc):
        assert mc.operational_indices == [0]

    def test_degraded(self, mc):
        assert mc.degraded_indices == [1]

    def test_failed(self, mc):
        assert mc.failed_indices == [2]

    def test_up(self, mc):
        assert mc.up_indices == [0, 1]

    def test_down(self, mc):
        assert mc.down_indices == [2]


# ---------------------------------------------------------------------------
# Transition matrix Q
# ---------------------------------------------------------------------------

class TestTransitionMatrix:
    def test_two_state(self):
        lam, mu = 0.001, 0.1
        mc = simple_repairable(lam, mu)
        Q = mc.transition_matrix()
        # Shape
        assert Q.shape == (2, 2)
        # Off-diagonal
        assert Q[0, 1] == pytest.approx(lam)
        assert Q[1, 0] == pytest.approx(mu)
        # Row sums must be zero
        for i in range(Q.shape[0]):
            assert Q[i, :].sum() == pytest.approx(0.0, abs=1e-15)

    def test_row_sums_zero_standby(self):
        mc = redundant_standby()
        Q = mc.transition_matrix()
        for i in range(Q.shape[0]):
            assert Q[i, :].sum() == pytest.approx(0.0, abs=1e-15)

    def test_row_sums_zero_tmr(self):
        mc = triple_modular_redundancy()
        Q = mc.transition_matrix()
        for i in range(Q.shape[0]):
            assert Q[i, :].sum() == pytest.approx(0.0, abs=1e-15)


# ---------------------------------------------------------------------------
# Steady-state solution
# ---------------------------------------------------------------------------

class TestSteadyState:
    def test_two_state_analytic(self):
        """For Op <-> Failed: pi_op = mu/(lam+mu), pi_f = lam/(lam+mu)."""
        lam, mu = 0.002, 0.05
        mc = simple_repairable(lam, mu)
        pi = mc.steady_state()
        assert pi is not None
        expected_op = mu / (lam + mu)
        expected_f = lam / (lam + mu)
        assert pi[0] == pytest.approx(expected_op, rel=1e-9)
        assert pi[1] == pytest.approx(expected_f, rel=1e-9)

    def test_sums_to_one(self):
        mc = redundant_standby()
        pi = mc.steady_state()
        assert pi is not None
        assert pi.sum() == pytest.approx(1.0, abs=1e-12)

    def test_all_non_negative(self):
        mc = triple_modular_redundancy()
        pi = mc.steady_state()
        assert pi is not None
        assert np.all(pi >= 0)

    def test_pi_Q_equals_zero(self):
        """Verify pi . Q = 0 (fundamental CTMC equation)."""
        mc = redundant_standby(0.005, 0.08)
        Q = mc.transition_matrix()
        pi = mc.steady_state()
        assert pi is not None
        product = pi @ Q
        np.testing.assert_allclose(product, 0.0, atol=1e-12)


# ---------------------------------------------------------------------------
# Availability (steady-state)
# ---------------------------------------------------------------------------

class TestSteadyStateAvailability:
    def test_two_state_availability(self):
        lam, mu = 0.001, 0.1
        mc = simple_repairable(lam, mu)
        a = mc.availability_ss()
        expected = mu / (lam + mu)
        assert a == pytest.approx(expected, rel=1e-9)

    def test_unavailability_complement(self):
        mc = simple_repairable(0.002, 0.05)
        a = mc.availability_ss()
        u = mc.unavailability_ss()
        assert a + u == pytest.approx(1.0, abs=1e-12)


# ---------------------------------------------------------------------------
# Transient analysis
# ---------------------------------------------------------------------------

class TestTransient:
    def test_initial_condition(self):
        mc = simple_repairable()
        P0 = mc.transient(0.0)
        assert P0[0] == pytest.approx(1.0, abs=1e-12)
        assert P0[1] == pytest.approx(0.0, abs=1e-12)

    def test_approaches_steady_state(self):
        """After long enough time, transient should converge to steady state."""
        lam, mu = 0.01, 0.1
        mc = simple_repairable(lam, mu)
        pi = mc.steady_state()
        P_long = mc.transient(100000.0)
        np.testing.assert_allclose(P_long, pi, atol=1e-6)

    def test_custom_initial(self):
        mc = simple_repairable()
        init = np.array([0.0, 1.0])  # start in failed state
        P = mc.transient(0.0, initial=init)
        assert P[1] == pytest.approx(1.0, abs=1e-12)

    def test_series_shape(self):
        mc = simple_repairable()
        times = [0, 100, 500, 1000, 5000]
        result = mc.transient_series(times)
        assert result.shape == (5, 2)

    def test_series_row_sums(self):
        mc = redundant_standby()
        times = [0, 10, 100, 1000]
        result = mc.transient_series(times)
        for k in range(len(times)):
            assert result[k].sum() == pytest.approx(1.0, abs=1e-10)


# ---------------------------------------------------------------------------
# Availability (time-dependent)
# ---------------------------------------------------------------------------

class TestTimeDependentAvailability:
    def test_initial_availability(self):
        mc = simple_repairable()
        assert mc.availability(0.0) == pytest.approx(1.0, abs=1e-12)

    def test_unavailability_complement(self):
        mc = simple_repairable()
        t = 500.0
        assert mc.availability(t) + mc.unavailability(t) == pytest.approx(1.0, abs=1e-12)


# ---------------------------------------------------------------------------
# Reliability R(t)
# ---------------------------------------------------------------------------

class TestReliability:
    def test_r_at_zero_is_one(self):
        mc = simple_repairable()
        assert mc.reliability(0.0) == pytest.approx(1.0, abs=1e-12)

    def test_monotone_decreasing(self):
        mc = simple_repairable(0.01, 0.1)
        times = [0, 10, 50, 100, 500, 1000]
        rels = mc.reliability_series(times)
        for i in range(len(rels) - 1):
            assert rels[i] >= rels[i + 1] - 1e-12, \
                f"R(t) not monotone decreasing at index {i}: {rels[i]} < {rels[i+1]}"

    def test_two_state_exponential(self):
        """For a simple system R(t) = exp(-lam*t)."""
        lam = 0.005
        mc = simple_repairable(lam, 0.1)
        for t in [10, 50, 100, 200]:
            expected = np.exp(-lam * t)
            assert mc.reliability(t) == pytest.approx(expected, rel=1e-6)

    def test_unreliability_complement(self):
        mc = simple_repairable()
        t = 500.0
        assert mc.reliability(t) + mc.unreliability(t) == pytest.approx(1.0, abs=1e-12)

    def test_series_length(self):
        mc = redundant_standby()
        times = [0, 100, 500]
        rels = mc.reliability_series(times)
        assert len(rels) == 3


# ---------------------------------------------------------------------------
# MTTF
# ---------------------------------------------------------------------------

class TestMTTF:
    def test_two_state_mttf(self):
        """For simple system: MTTF = 1/lambda."""
        lam = 0.002
        mc = simple_repairable(lam, 0.1)
        mttf = mc.mttf()
        assert mttf == pytest.approx(1.0 / lam, rel=1e-9)

    def test_standby_mttf(self):
        """Standby system should have higher MTTF than single unit."""
        lam = 0.001
        mc_single = simple_repairable(lam, 0.0001)  # very slow repair
        mc_standby = redundant_standby(lam, 0.0001)
        mttf_single = mc_single.mttf()
        mttf_standby = mc_standby.mttf()
        assert mttf_standby > mttf_single

    def test_no_failed_states(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('a', 'A', 'operational'))
        assert mc.mttf() is None


# ---------------------------------------------------------------------------
# MTBF and MTTR
# ---------------------------------------------------------------------------

class TestMTBF_MTTR:
    def test_two_state_mtbf(self):
        """MTBF = (lam+mu) / (lam * mu) = 1/lam + 1/mu for two-state system.
        Actually MTBF = 1/failure_frequency.
        failure_frequency = pi_op * lam = mu/(lam+mu) * lam
        So MTBF = (lam+mu)/(mu*lam)
        """
        lam, mu = 0.001, 0.1
        mc = simple_repairable(lam, mu)
        mtbf = mc.mtbf()
        expected = (lam + mu) / (mu * lam)
        assert mtbf == pytest.approx(expected, rel=1e-6)

    def test_two_state_mttr(self):
        """MTTR = U_ss / failure_frequency.
        U_ss = lam/(lam+mu), ff = lam*mu/(lam+mu)
        MTTR = lam/(lam+mu) / (lam*mu/(lam+mu)) = 1/mu
        """
        lam, mu = 0.001, 0.1
        mc = simple_repairable(lam, mu)
        mttr = mc.mttr()
        expected = 1.0 / mu
        assert mttr == pytest.approx(expected, rel=1e-6)

    def test_mtbf_positive(self):
        mc = redundant_standby()
        assert mc.mtbf() > 0

    def test_mttr_positive(self):
        mc = redundant_standby()
        assert mc.mttr() > 0


# ---------------------------------------------------------------------------
# Failure and Repair frequency
# ---------------------------------------------------------------------------

class TestFrequencies:
    def test_failure_repair_equal_at_ss(self):
        """At steady state, failure frequency == repair frequency."""
        mc = redundant_standby(0.003, 0.07)
        ff = mc.failure_frequency()
        rf = mc.repair_frequency()
        assert ff == pytest.approx(rf, rel=1e-6)

    def test_failure_freq_positive(self):
        mc = simple_repairable()
        assert mc.failure_frequency() > 0


# ---------------------------------------------------------------------------
# Example models
# ---------------------------------------------------------------------------

class TestExampleModels:
    def test_simple_repairable_returns_chain(self):
        mc = simple_repairable()
        assert isinstance(mc, MarkovChain)
        assert mc.n_states == 2
        assert len(mc.transitions) == 2

    def test_standby_returns_chain(self):
        mc = redundant_standby()
        assert isinstance(mc, MarkovChain)
        assert mc.n_states == 3

    def test_tmr_returns_chain(self):
        mc = triple_modular_redundancy()
        assert isinstance(mc, MarkovChain)
        assert mc.n_states == 3

    def test_example_models_dict(self):
        assert 'simple_repairable' in EXAMPLE_MODELS
        assert 'standby_redundancy' in EXAMPLE_MODELS
        assert 'tmr' in EXAMPLE_MODELS

    def test_example_builders_callable(self):
        for key, info in EXAMPLE_MODELS.items():
            mc = info['builder']()
            assert isinstance(mc, MarkovChain)
            assert mc.n_states >= 2

    def test_all_examples_have_valid_ss(self):
        for key, info in EXAMPLE_MODELS.items():
            mc = info['builder']()
            pi = mc.steady_state()
            assert pi is not None, f"{key} has no steady state"
            assert pi.sum() == pytest.approx(1.0, abs=1e-10)


# ---------------------------------------------------------------------------
# Full analyze() method
# ---------------------------------------------------------------------------

class TestAnalyze:
    def test_keys_present(self):
        mc = simple_repairable()
        result = mc.analyze()
        assert 'states' in result
        assert 'transitions' in result
        assert 'transition_matrix' in result
        assert 'steady_state' in result
        assert 'system_params' in result

    def test_system_params_keys(self):
        mc = simple_repairable()
        result = mc.analyze()
        params = result['system_params']
        for key in ['availability_ss', 'unavailability_ss', 'mttf', 'mtbf',
                     'mttr', 'failure_frequency', 'repair_frequency']:
            assert key in params, f"Missing key: {key}"

    def test_with_times(self):
        mc = simple_repairable()
        times = [0, 100, 500, 1000]
        result = mc.analyze(times=times)
        assert 'time_dependent' in result
        assert len(result['time_dependent']) == 4
        entry = result['time_dependent'][0]
        assert 'time' in entry
        assert 'state_probs' in entry
        assert 'availability' in entry
        assert 'unavailability' in entry
        assert 'reliability' in entry
        assert 'unreliability' in entry

    def test_without_times_no_td(self):
        mc = simple_repairable()
        result = mc.analyze()
        assert 'time_dependent' not in result

    def test_steady_state_ids(self):
        mc = simple_repairable()
        result = mc.analyze()
        ss = result['steady_state']
        assert 'op' in ss
        assert 'failed' in ss

    def test_state_info(self):
        mc = simple_repairable()
        result = mc.analyze()
        assert len(result['states']) == 2
        assert result['states'][0]['id'] == 'op'

    def test_transition_info(self):
        mc = simple_repairable()
        result = mc.analyze()
        assert len(result['transitions']) == 2

    def test_transition_matrix_shape(self):
        mc = triple_modular_redundancy()
        result = mc.analyze()
        Q = result['transition_matrix']
        assert len(Q) == 3
        assert len(Q[0]) == 3

    def test_analyze_all_examples(self):
        """Run analyze on each example model and verify completeness."""
        for key, info in EXAMPLE_MODELS.items():
            mc = info['builder']()
            result = mc.analyze(times=[0, 100, 1000])
            assert result['steady_state'] is not None
            assert result['system_params']['availability_ss'] is not None
            assert len(result['time_dependent']) == 3


# ---------------------------------------------------------------------------
# Model contract, Erlang phase-type dwell times, and rate uncertainty
# ---------------------------------------------------------------------------

class TestMarkovModelContract:
    def test_ctmc_contract_discloses_memoryless_assumption(self):
        result = simple_repairable().analyze(times=[0, 100])
        contract = result['model_contract']
        assert contract['selected_model'] == 'time_homogeneous_ctmc'
        assert any('memoryless' in item for item in contract['assumptions'])
        assert result['phase_type']['status'] == 'not_applied'

    def test_self_transition_is_rejected(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('up', 'Up'))
        with pytest.raises(ValueError, match='Self-transitions'):
            mc.add_transition(MarkovTransition('up', 'up', 0.1))

    def test_invalid_time_and_initial_probabilities_are_rejected(self):
        mc = simple_repairable()
        with pytest.raises(ValueError, match='non-negative'):
            mc.analyze(times=[-1])
        with pytest.raises(ValueError, match='sum to one'):
            mc.transient(1, np.array([0.2, 0.2]))


class TestErlangPhaseType:
    @staticmethod
    def erlang_failure_chain(shape=3, rate=0.2):
        mc = MarkovChain()
        mc.add_state(MarkovState(
            'up', 'Up', 'operational', dwell_model='erlang',
            dwell_shape=shape,
        ))
        mc.add_state(MarkovState('failed', 'Failed', 'failed'))
        mc.add_transition(MarkovTransition('up', 'failed', rate))
        return mc

    def test_phase_expansion_preserves_mean_and_embedded_destination(self):
        mc = self.erlang_failure_chain(shape=4, rate=0.25)
        expanded, mapping, diagnostics = mc.phase_type_expansion()
        assert expanded.n_states == 5
        assert len(mapping['up']) == 4
        assert len(mapping['failed']) == 1
        np.testing.assert_allclose(
            expanded.transition_matrix().sum(axis=1), 0.0, atol=1e-14)
        up_details = diagnostics['state_dwell_models'][0]
        assert up_details['mean_dwell_time'] == pytest.approx(4.0)
        assert up_details['dwell_time_cv'] == pytest.approx(0.5)

    def test_erlang_reliability_matches_closed_form(self):
        shape, rate, time = 3, 0.2, 4.0
        mc = self.erlang_failure_chain(shape, rate)
        result = mc.analyze(times=[time])
        z = shape * rate * time
        expected = np.exp(-z) * sum(z ** j / math.factorial(j) for j in range(shape))
        assert result['time_dependent'][0]['reliability'] == pytest.approx(
            expected, rel=1e-10)
        assert result['system_params']['mttf'] == pytest.approx(1 / rate)
        assert result['model_contract']['selected_model'] == 'erlang_phase_type'
        assert result['phase_type']['expanded_state_count'] == shape + 1
        assert result['ctmc_baseline']['time_dependent'][0]['reliability'] == pytest.approx(
            np.exp(-rate * time), rel=1e-10)
        assert result['time_dependent'][0]['reliability'] != pytest.approx(
            result['ctmc_baseline']['time_dependent'][0]['reliability'])

    def test_public_probabilities_are_aggregated_and_sum_to_one(self):
        mc = self.erlang_failure_chain(shape=5, rate=0.05)
        result = mc.analyze(times=[0, 2, 20, 100])
        for row in result['time_dependent']:
            assert set(row['state_probs']) == {'up', 'failed'}
            assert sum(row['state_probs'].values()) == pytest.approx(1.0, abs=1e-9)

    def test_mean_preserving_repair_chain_has_same_stationary_occupancy(self):
        mc = MarkovChain()
        mc.add_state(MarkovState(
            'up', 'Up', 'operational', dwell_model='erlang', dwell_shape=4))
        mc.add_state(MarkovState(
            'down', 'Down', 'failed', dwell_model='erlang', dwell_shape=2))
        mc.add_transition(MarkovTransition('up', 'down', 0.02))
        mc.add_transition(MarkovTransition('down', 'up', 0.2))
        selected = mc.analyze(times=[10])
        baseline = mc.analyze(times=[10], use_dwell_models=False)
        assert selected['steady_state']['up'] == pytest.approx(
            baseline['steady_state']['up'], abs=1e-9)
        assert selected['time_dependent'][0]['availability'] != pytest.approx(
            baseline['time_dependent'][0]['availability'])


class TestMarkovRateUncertainty:
    def test_no_rate_cv_returns_explicit_not_requested_status(self):
        result = simple_repairable().analyze_rate_uncertainty(
            mission_time=100, n_samples=40, seed=1)
        assert result['status'] == 'not_requested'

    def test_seeded_lognormal_rate_propagation_is_reproducible(self):
        mc = MarkovChain()
        mc.add_state(MarkovState('up', 'Up', 'operational'))
        mc.add_state(MarkovState('down', 'Down', 'failed'))
        mc.add_transition(MarkovTransition('up', 'down', 0.01, rate_cv=0.25))
        mc.add_transition(MarkovTransition('down', 'up', 0.1, rate_cv=0.10))
        first = mc.analyze_rate_uncertainty(
            mission_time=50, n_samples=80, ci=0.90, seed=71)
        second = mc.analyze_rate_uncertainty(
            mission_time=50, n_samples=80, ci=0.90, seed=71)
        assert first == second
        assert first['status'] == 'complete'
        assert first['successful_samples'] == 80
        assert first['method'].startswith('independent mean-preserving lognormal')
        for key in ('availability_ss', 'mttf', 'reliability_at_mission'):
            interval = first['metric_intervals'][key]
            assert interval['lower'] <= interval['median'] <= interval['upper']
        assert len(first['rate_intervals']) == 2
        assert first['rate_intervals'][0]['lower'] < first['rate_intervals'][0]['upper']
