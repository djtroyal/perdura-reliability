"""Markov Chain reliability analysis.

Supports continuous-time Markov chains (CTMC) for repairable and non-repairable
system reliability modeling.
"""

import numpy as np
from scipy.linalg import expm
from typing import Optional


class MarkovState:
    """A state in the Markov chain."""
    def __init__(self, id: str, name: str, state_type: str = 'operational',
                 description: str = ''):
        # id: unique identifier
        # name: display name
        # state_type: 'operational', 'degraded', or 'failed'
        # description: optional text
        self.id = id
        self.name = name
        self.state_type = state_type  # operational, degraded, failed
        self.description = description


class MarkovTransition:
    """A transition between states."""
    def __init__(self, from_state: str, to_state: str, rate: float,
                 label: str = ''):
        self.from_state = from_state
        self.to_state = to_state
        self.rate = rate  # transition rate (failures/hr or repairs/hr)
        self.label = label


class MarkovChain:
    """Continuous-time Markov chain for reliability analysis.

    Supports both repairable systems (steady-state + transient) and
    non-repairable systems (absorbing state analysis).
    """

    def __init__(self, states: list[MarkovState] = None,
                 transitions: list[MarkovTransition] = None):
        self.states: list[MarkovState] = states or []
        self.transitions: list[MarkovTransition] = transitions or []
        self._state_index: dict[str, int] = {}
        self._rebuild_index()

    def _rebuild_index(self):
        self._state_index = {s.id: i for i, s in enumerate(self.states)}

    def add_state(self, state: MarkovState):
        if state.id in self._state_index:
            raise ValueError(f"State '{state.id}' already exists")
        self._state_index[state.id] = len(self.states)
        self.states.append(state)

    def add_transition(self, transition: MarkovTransition):
        if transition.from_state not in self._state_index:
            raise ValueError(f"Unknown state '{transition.from_state}'")
        if transition.to_state not in self._state_index:
            raise ValueError(f"Unknown state '{transition.to_state}'")
        if transition.rate < 0:
            raise ValueError("Transition rate must be non-negative")
        self.transitions.append(transition)

    @property
    def n_states(self) -> int:
        return len(self.states)

    @property
    def operational_indices(self) -> list[int]:
        """Indices of operational (up) states."""
        return [i for i, s in enumerate(self.states) if s.state_type == 'operational']

    @property
    def degraded_indices(self) -> list[int]:
        return [i for i, s in enumerate(self.states) if s.state_type == 'degraded']

    @property
    def failed_indices(self) -> list[int]:
        return [i for i, s in enumerate(self.states) if s.state_type == 'failed']

    @property
    def up_indices(self) -> list[int]:
        """States where system is UP (operational + degraded)."""
        return [i for i, s in enumerate(self.states)
                if s.state_type in ('operational', 'degraded')]

    @property
    def down_indices(self) -> list[int]:
        """States where system is DOWN (failed)."""
        return self.failed_indices

    def transition_matrix(self) -> np.ndarray:
        """Build the infinitesimal generator matrix Q.

        Q[i,j] = rate from state i to state j (i != j)
        Q[i,i] = -sum of all departure rates from state i
        """
        n = self.n_states
        Q = np.zeros((n, n))
        for t in self.transitions:
            i = self._state_index[t.from_state]
            j = self._state_index[t.to_state]
            Q[i, j] += t.rate
        # Diagonal: negative sum of departure rates
        for i in range(n):
            Q[i, i] = -np.sum(Q[i, :])
        return Q

    def steady_state(self) -> np.ndarray:
        """Compute steady-state probability vector pi.

        Solves piQ = 0 subject to sum(pi_i) = 1 via the SVD null-space of Q^T
        — better conditioned than replacing a balance row for stiff chains
        (lambda << mu), and it lets us verify uniqueness: an irreducible CTMC
        has exactly one zero singular value. Returns None when the chain is
        reducible/absorbing (no unique steady state) instead of a spurious
        clamped vector.
        """
        Q = self.transition_matrix()
        n = self.n_states
        if n == 1:
            return np.array([1.0])

        try:
            _, s, vt = np.linalg.svd(Q.T)
        except np.linalg.LinAlgError:
            return None

        # Zero singular values relative to the largest — one means a unique
        # stationary distribution; more means a reducible chain.
        scale = s[0] if s[0] > 0 else 1.0
        n_zero = int(np.sum(s / scale < 1e-10))
        if n_zero != 1:
            return None

        pi = vt[-1]                      # null-space vector of Q^T
        # The stationary vector of an irreducible CTMC is strictly one-signed;
        # mixed signs mean the null vector is not a probability distribution
        # (an absorbing/reducible structure).
        pi = -pi if pi.sum() < 0 else pi
        if np.any(pi < -1e-9 * np.max(np.abs(pi))):
            return None
        pi = np.maximum(pi, 0.0)
        total = pi.sum()
        if total <= 0:
            return None
        return pi / total

    def transient(self, t: float, initial: np.ndarray = None) -> np.ndarray:
        """State probability vector at time t.

        P(t) = P(0) . exp(Q.t)

        Args:
            t: time point
            initial: initial state probability vector (default: all probability in first state)

        Returns:
            Probability vector at time t
        """
        if initial is None:
            initial = np.zeros(self.n_states)
            initial[0] = 1.0

        Q = self.transition_matrix()
        P_t = initial @ expm(Q * t)
        P_t = np.maximum(P_t, 0.0)
        P_t /= P_t.sum()
        return P_t

    def transient_series(self, times: list[float], initial: np.ndarray = None) -> np.ndarray:
        """State probabilities at multiple time points.

        Returns:
            Array of shape (len(times), n_states)
        """
        if initial is None:
            initial = np.zeros(self.n_states)
            initial[0] = 1.0

        Q = self.transition_matrix()
        results = np.zeros((len(times), self.n_states))
        for k, t in enumerate(times):
            P_t = initial @ expm(Q * t)
            P_t = np.maximum(P_t, 0.0)
            P_t /= P_t.sum()
            results[k] = P_t
        return results

    # --- System Metrics (steady-state) ---

    def availability_ss(self) -> Optional[float]:
        """Steady-state availability A_ss = sum of pi_i for up states."""
        pi = self.steady_state()
        if pi is None:
            return None
        return float(np.sum(pi[self.up_indices]))

    def unavailability_ss(self) -> Optional[float]:
        """Steady-state unavailability U_ss = 1 - A_ss."""
        a = self.availability_ss()
        return None if a is None else 1.0 - a

    # --- System Metrics (time-dependent) ---

    def availability(self, t: float, initial: np.ndarray = None) -> float:
        """Instantaneous availability A(t) = P(system is up at time t)."""
        P = self.transient(t, initial)
        return float(np.sum(P[self.up_indices]))

    def unavailability(self, t: float, initial: np.ndarray = None) -> float:
        return 1.0 - self.availability(t, initial)

    def reliability(self, t: float, initial: np.ndarray = None) -> float:
        """Reliability R(t) = probability of no failure in [0, t].

        Computed by making failed states absorbing (removing repair transitions)
        and computing P(still in up states at t).
        """
        if initial is None:
            initial = np.zeros(self.n_states)
            initial[0] = 1.0

        Q_abs = self._absorbing_generator()
        P_t = initial @ expm(Q_abs * t)
        P_t = np.maximum(P_t, 0.0)
        return float(np.sum(P_t[self.up_indices]))

    def unreliability(self, t: float, initial: np.ndarray = None) -> float:
        return 1.0 - self.reliability(t, initial)

    def reliability_series(self, times: list[float], initial: np.ndarray = None) -> list[float]:
        """R(t) at multiple time points."""
        if initial is None:
            initial = np.zeros(self.n_states)
            initial[0] = 1.0
        Q_abs = self._absorbing_generator()
        result = []
        for t in times:
            P_t = initial @ expm(Q_abs * t)
            P_t = np.maximum(P_t, 0.0)
            result.append(float(np.sum(P_t[self.up_indices])))
        return result

    def _absorbing_generator(self) -> np.ndarray:
        """Generator matrix with failed states made absorbing (no outgoing transitions)."""
        Q = self.transition_matrix()
        failed = set(self.failed_indices)
        for i in failed:
            Q[i, :] = 0.0  # zero out the row => absorbing
        return Q

    def mttf(self) -> Optional[float]:
        """Mean Time To (first) Failure.

        MTTF = -[N_up]^{-1} . 1, where N_up is the upper-left block of
        the absorbing generator restricted to up states.
        """
        up = self.up_indices
        if not up or not self.failed_indices:
            return None
        Q_abs = self._absorbing_generator()
        # Extract the sub-matrix for up states
        N = Q_abs[np.ix_(up, up)]
        try:
            N_inv = np.linalg.inv(N)
            # MTTF starting from first up state
            ones = np.ones(len(up))
            mttf_vec = -N_inv @ ones
            return float(mttf_vec[0])
        except np.linalg.LinAlgError:
            return None

    def mtbf(self) -> Optional[float]:
        """Mean cycle time between failures (for repairable systems).

        1/w_f is the mean full up-down cycle (MUT + MDT). For the mean
        OPERATING time between failures use :meth:`mut`. Returns None for a
        non-repairable chain — the first-passage MTTF is a different quantity
        and is no longer silently substituted here (use :meth:`mttf`).
        """
        ff = self.failure_frequency()
        if ff is None or ff == 0:
            return None
        return 1.0 / ff

    def mut(self) -> Optional[float]:
        """Mean Up Time between failures: MUT = A_ss / w_f.

        The average operating time between successive failures at steady
        state (the quantity most people mean by "MTBF" for a repairable
        system); MUT + MTTR = the full cycle 1/w_f.
        """
        a = self.availability_ss()
        ff = self.failure_frequency()
        if a is None or ff is None or ff == 0:
            return None
        return a / ff

    def mttr(self) -> Optional[float]:
        """Mean Time To Repair.

        MTTR = U_ss / failure_frequency = U_ss . MTBF
        """
        u = self.unavailability_ss()
        ff = self.failure_frequency()
        if u is None or ff is None or ff == 0:
            return None
        return u / ff

    def failure_frequency(self) -> Optional[float]:
        """Steady-state failure frequency (transitions per unit time from up to down).

        w_f = sum over all up->down transitions of pi_i . q_ij
        """
        pi = self.steady_state()
        if pi is None:
            return None
        Q = self.transition_matrix()
        up = set(self.up_indices)
        down = set(self.down_indices)
        freq = 0.0
        for t in self.transitions:
            i = self._state_index[t.from_state]
            j = self._state_index[t.to_state]
            if i in up and j in down:
                freq += pi[i] * t.rate
        return float(freq)

    def repair_frequency(self) -> Optional[float]:
        """Steady-state repair frequency (transitions per unit time from down to up).

        w_r = sum over all down->up transitions of pi_i . q_ij
        At steady state, w_r = w_f.
        """
        pi = self.steady_state()
        if pi is None:
            return None
        up = set(self.up_indices)
        down = set(self.down_indices)
        freq = 0.0
        for t in self.transitions:
            i = self._state_index[t.from_state]
            j = self._state_index[t.to_state]
            if i in down and j in up:
                freq += pi[i] * t.rate
        return float(freq)

    def analyze(self, times: list[float] = None,
                initial: np.ndarray = None) -> dict:
        """Full analysis: steady-state + time-dependent results.

        Returns a dict with:
        - transition_matrix: the Q matrix
        - steady_state: {state_id: probability} or None
        - system_params: {availability_ss, unavailability_ss, mttf, mtbf, mttr,
                          failure_freq, repair_freq}
        - time_dependent: [{time, state_probs: {id: p}, availability, unavailability,
                            reliability, unreliability}] if times provided
        - states: state info list
        - transitions: transition info list
        """
        Q = self.transition_matrix()
        pi = self.steady_state()

        result = {
            'states': [
                {'id': s.id, 'name': s.name, 'type': s.state_type,
                 'description': s.description}
                for s in self.states
            ],
            'transitions': [
                {'from': t.from_state, 'to': t.to_state, 'rate': t.rate,
                 'label': t.label}
                for t in self.transitions
            ],
            'transition_matrix': Q.tolist(),
            'steady_state': (
                {s.id: round(float(pi[i]), 10) for i, s in enumerate(self.states)}
                if pi is not None else None
            ),
            'system_params': {
                'availability_ss': self.availability_ss(),
                'unavailability_ss': self.unavailability_ss(),
                'mttf': self.mttf(),
                'mtbf': self.mtbf(),      # mean full cycle (MUT + MDT)
                'mut': self.mut(),        # mean up time between failures
                'mttr': self.mttr(),
                'failure_frequency': self.failure_frequency(),
                'repair_frequency': self.repair_frequency(),
            },
        }

        if times:
            td = []
            if initial is None:
                initial = np.zeros(self.n_states)
                initial[0] = 1.0

            probs = self.transient_series(times, initial)
            rels = self.reliability_series(times, initial)

            for k, t_val in enumerate(times):
                entry = {
                    'time': t_val,
                    'state_probs': {
                        s.id: round(float(probs[k, i]), 10)
                        for i, s in enumerate(self.states)
                    },
                    'availability': float(np.sum(probs[k][self.up_indices])),
                    'unavailability': float(np.sum(probs[k][self.down_indices])),
                    'reliability': rels[k],
                    'unreliability': 1.0 - rels[k],
                }
                td.append(entry)
            result['time_dependent'] = td

        return result


# --- Pre-built example models ---

def simple_repairable(lambda_val: float = 0.001, mu_val: float = 0.1) -> MarkovChain:
    """Two-state repairable system: Operating <-> Failed."""
    mc = MarkovChain()
    mc.add_state(MarkovState('op', 'Operating', 'operational'))
    mc.add_state(MarkovState('failed', 'Failed', 'failed'))
    mc.add_transition(MarkovTransition('op', 'failed', lambda_val, f'lambda={lambda_val}'))
    mc.add_transition(MarkovTransition('failed', 'op', mu_val, f'mu={mu_val}'))
    return mc


def redundant_standby(lambda_val: float = 0.001, mu_val: float = 0.05) -> MarkovChain:
    """Standby redundancy: 2 units, 1 active + 1 standby, single repair crew."""
    mc = MarkovChain()
    mc.add_state(MarkovState('s0', 'Both OK (1 active, 1 standby)', 'operational'))
    mc.add_state(MarkovState('s1', 'One failed, one active', 'degraded'))
    mc.add_state(MarkovState('s2', 'Both failed', 'failed'))
    mc.add_transition(MarkovTransition('s0', 's1', lambda_val, f'lambda={lambda_val}'))
    mc.add_transition(MarkovTransition('s1', 's0', mu_val, f'mu={mu_val}'))
    mc.add_transition(MarkovTransition('s1', 's2', lambda_val, f'lambda={lambda_val}'))
    mc.add_transition(MarkovTransition('s2', 's1', mu_val, f'mu={mu_val}'))
    return mc


def triple_modular_redundancy(lambda_val: float = 0.001, mu_val: float = 0.02) -> MarkovChain:
    """TMR (Triple Modular Redundancy) with repair."""
    mc = MarkovChain()
    mc.add_state(MarkovState('s3', '3 of 3 operational', 'operational'))
    mc.add_state(MarkovState('s2', '2 of 3 operational', 'degraded'))
    mc.add_state(MarkovState('s1', '1 of 3 operational (system failed)', 'failed'))
    mc.add_transition(MarkovTransition('s3', 's2', 3 * lambda_val, f'3lambda={3*lambda_val}'))
    mc.add_transition(MarkovTransition('s2', 's3', mu_val, f'mu={mu_val}'))
    mc.add_transition(MarkovTransition('s2', 's1', 2 * lambda_val, f'2lambda={2*lambda_val}'))
    mc.add_transition(MarkovTransition('s1', 's2', mu_val, f'mu={mu_val}'))
    return mc


EXAMPLE_MODELS = {
    'simple_repairable': {
        'name': 'Simple Repairable System',
        'description': 'Two-state model: Operating <-> Failed with constant failure and repair rates.',
        'builder': simple_repairable,
        'default_params': {'lambda': 0.001, 'mu': 0.1},
    },
    'standby_redundancy': {
        'name': 'Standby Redundancy (1+1)',
        'description': 'Two units in standby configuration with single repair crew.',
        'builder': redundant_standby,
        'default_params': {'lambda': 0.001, 'mu': 0.05},
    },
    'tmr': {
        'name': 'Triple Modular Redundancy',
        'description': '2-of-3 voting redundancy with repair capability.',
        'builder': triple_modular_redundancy,
        'default_params': {'lambda': 0.001, 'mu': 0.02},
    },
}
