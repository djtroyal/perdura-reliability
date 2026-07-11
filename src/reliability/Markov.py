"""Markov and phase-type reliability analysis.

The base model is a time-homogeneous continuous-time Markov chain (CTMC).
States may additionally use a mean-preserving Erlang dwell-time model.  Erlang
states are solved exactly through a finite phase-type expansion, so the public
state diagram remains compact while the transient calculation is no longer
memoryless at the public-state level.
"""

import numpy as np
from scipy.linalg import expm
from typing import Optional


_STATE_TYPES = {'operational', 'degraded', 'failed'}
_DWELL_MODELS = {'exponential', 'erlang'}


class MarkovState:
    """A state in the Markov chain."""
    def __init__(self, id: str, name: str, state_type: str = 'operational',
                 description: str = '', dwell_model: str = 'exponential',
                 dwell_shape: int = 1):
        # id: unique identifier
        # name: display name
        # state_type: 'operational', 'degraded', or 'failed'
        # description: optional text
        if not isinstance(id, str) or not id.strip():
            raise ValueError("State id must be a non-empty string")
        if state_type not in _STATE_TYPES:
            raise ValueError(
                "State type must be 'operational', 'degraded', or 'failed'"
            )
        if dwell_model not in _DWELL_MODELS:
            raise ValueError("Dwell model must be 'exponential' or 'erlang'")
        if isinstance(dwell_shape, bool) or int(dwell_shape) != dwell_shape:
            raise ValueError("Erlang dwell shape must be an integer")
        if not 1 <= int(dwell_shape) <= 50:
            raise ValueError("Erlang dwell shape must be between 1 and 50")

        self.id = id
        self.name = name
        self.state_type = state_type  # operational, degraded, failed
        self.description = description
        self.dwell_model = dwell_model
        # Shape is retained when the UI switches models, but exponential states
        # always have an effective shape of one.
        self.dwell_shape = int(dwell_shape)

    @property
    def effective_dwell_shape(self) -> int:
        return self.dwell_shape if self.dwell_model == 'erlang' else 1


class MarkovTransition:
    """A transition between states."""
    def __init__(self, from_state: str, to_state: str, rate: float,
                 label: str = '', rate_cv: float = 0.0):
        self.from_state = from_state
        self.to_state = to_state
        self.rate = float(rate)  # transition rate (failures/hr or repairs/hr)
        self.label = label
        self.rate_cv = float(rate_cv)


class MarkovChain:
    """Continuous-time Markov chain for reliability analysis.

    Supports both repairable systems (steady-state + transient) and
    non-repairable systems (absorbing state analysis).
    """

    def __init__(self, states: list[MarkovState] = None,
                 transitions: list[MarkovTransition] = None):
        self.states: list[MarkovState] = []
        self.transitions: list[MarkovTransition] = []
        self._state_index: dict[str, int] = {}
        for state in states or []:
            self.add_state(state)
        for transition in transitions or []:
            self.add_transition(transition)

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
        if transition.from_state == transition.to_state:
            raise ValueError(
                "Self-transitions do not change CTMC state; remove the loop or "
                "represent the event with a distinct state"
            )
        if not np.isfinite(transition.rate) or transition.rate < 0:
            raise ValueError("Transition rate must be finite and non-negative")
        if not np.isfinite(transition.rate_cv) or transition.rate_cv < 0:
            raise ValueError("Transition-rate CV must be finite and non-negative")
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

    def _validated_initial(self, initial: np.ndarray = None) -> np.ndarray:
        """Return a validated probability vector without silently rescaling it."""
        if self.n_states == 0:
            raise ValueError("At least one state is required")
        if initial is None:
            result = np.zeros(self.n_states)
            result[0] = 1.0
            return result
        result = np.asarray(initial, dtype=float)
        if result.shape != (self.n_states,):
            raise ValueError(
                f"Initial probabilities must contain {self.n_states} values"
            )
        if not np.all(np.isfinite(result)) or np.any(result < 0):
            raise ValueError("Initial probabilities must be finite and non-negative")
        if not np.isclose(result.sum(), 1.0, rtol=0.0, atol=1e-10):
            raise ValueError("Initial probabilities must sum to one")
        return result

    @staticmethod
    def _validated_times(times: list[float]) -> list[float]:
        result = [float(t) for t in times]
        if not all(np.isfinite(t) and t >= 0 for t in result):
            raise ValueError("Analysis times must be finite and non-negative")
        return result

    def _departure_rates(self) -> np.ndarray:
        rates = np.zeros(self.n_states)
        for transition in self.transitions:
            rates[self._state_index[transition.from_state]] += transition.rate
        return rates

    def phase_type_expansion(self) -> tuple['MarkovChain', dict[str, list[str]], dict]:
        """Expand public states into mean-preserving Erlang phase chains.

        If state ``i`` has total departure rate ``q_i`` and Erlang shape ``k``,
        the hidden phases advance at rate ``k*q_i``.  Departure from the final
        phase to destination ``j`` occurs at rate ``k*q_ij``.  Consequently the
        public-state holding time is Erlang(k, k*q_i), with the original mean
        ``1/q_i`` and original destination probability ``q_ij/q_i``.

        Returns the expanded CTMC, a public-state-to-phase mapping, and a
        serialisable diagnostic payload.
        """
        departures = self._departure_rates()
        expanded = MarkovChain()
        mapping: dict[str, list[str]] = {}
        effective_shapes: dict[str, int] = {}
        state_details: list[dict] = []

        for i, state in enumerate(self.states):
            requested_shape = state.effective_dwell_shape
            effective_shape = requested_shape if departures[i] > 0 else 1
            effective_shapes[state.id] = effective_shape
            phase_ids = []
            for phase in range(effective_shape):
                phase_id = f"__pt_{i}_{phase + 1}"
                phase_ids.append(phase_id)
                phase_suffix = (
                    f" [phase {phase + 1}/{effective_shape}]"
                    if effective_shape > 1 else ""
                )
                expanded.add_state(MarkovState(
                    phase_id,
                    f"{state.name}{phase_suffix}",
                    state.state_type,
                    state.description,
                ))
            mapping[state.id] = phase_ids
            state_details.append({
                'state_id': state.id,
                'requested_model': state.dwell_model,
                'requested_shape': requested_shape,
                'effective_shape': effective_shape,
                'total_exit_rate': float(departures[i]),
                'mean_dwell_time': (
                    float(1.0 / departures[i]) if departures[i] > 0 else None
                ),
                'dwell_time_cv': (
                    float(1.0 / np.sqrt(effective_shape))
                    if departures[i] > 0 else None
                ),
                'absorbing': bool(departures[i] == 0),
            })

        # Hidden sequential phases.
        for i, state in enumerate(self.states):
            phase_ids = mapping[state.id]
            k = effective_shapes[state.id]
            if departures[i] <= 0 or k <= 1:
                continue
            phase_rate = k * departures[i]
            for phase in range(k - 1):
                expanded.add_transition(MarkovTransition(
                    phase_ids[phase], phase_ids[phase + 1], phase_rate,
                    'Erlang phase progression',
                ))

        # The final phase uses the original embedded destination probabilities.
        for transition in self.transitions:
            from_index = self._state_index[transition.from_state]
            k = effective_shapes[transition.from_state]
            expanded.add_transition(MarkovTransition(
                mapping[transition.from_state][-1],
                mapping[transition.to_state][0],
                k * transition.rate,
                transition.label,
                transition.rate_cv,
            ))

        diagnostics = {
            'family': 'Erlang phase-type',
            'mean_preserving': True,
            'expanded_state_count': expanded.n_states,
            'public_state_count': self.n_states,
            'state_mapping': mapping,
            'state_dwell_models': state_details,
        }
        return expanded, mapping, diagnostics

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
        t = self._validated_times([t])[0]
        initial = self._validated_initial(initial)

        Q = self.transition_matrix()
        P_t = initial @ expm(Q * t)
        P_t = np.maximum(P_t, 0.0)
        total = P_t.sum()
        if not np.isfinite(total) or total <= 0:
            raise ValueError("Transient solver produced invalid probabilities")
        P_t /= total
        return P_t

    def transient_series(self, times: list[float], initial: np.ndarray = None) -> np.ndarray:
        """State probabilities at multiple time points.

        Returns:
            Array of shape (len(times), n_states)
        """
        times = self._validated_times(times)
        initial = self._validated_initial(initial)

        Q = self.transition_matrix()
        results = np.zeros((len(times), self.n_states))
        for k, t in enumerate(times):
            P_t = initial @ expm(Q * t)
            P_t = np.maximum(P_t, 0.0)
            total = P_t.sum()
            if not np.isfinite(total) or total <= 0:
                raise ValueError("Transient solver produced invalid probabilities")
            P_t /= total
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
        t = self._validated_times([t])[0]
        initial = self._validated_initial(initial)

        Q_abs = self._absorbing_generator()
        P_t = initial @ expm(Q_abs * t)
        P_t = np.maximum(P_t, 0.0)
        return float(np.clip(np.sum(P_t[self.up_indices]), 0.0, 1.0))

    def unreliability(self, t: float, initial: np.ndarray = None) -> float:
        return 1.0 - self.reliability(t, initial)

    def reliability_series(self, times: list[float], initial: np.ndarray = None) -> list[float]:
        """R(t) at multiple time points."""
        times = self._validated_times(times)
        initial = self._validated_initial(initial)
        Q_abs = self._absorbing_generator()
        result = []
        for t in times:
            P_t = initial @ expm(Q_abs * t)
            P_t = np.maximum(P_t, 0.0)
            result.append(float(np.clip(np.sum(P_t[self.up_indices]), 0.0, 1.0)))
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
            # MTTF starting from first up state
            ones = np.ones(len(up))
            mttf_vec = np.linalg.solve(-N, ones)
            value = float(mttf_vec[0])
            return value if np.isfinite(value) and value >= 0 else None
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

    def _state_payload(self) -> list[dict]:
        return [
            {
                'id': state.id,
                'name': state.name,
                'type': state.state_type,
                'description': state.description,
                'dwell_model': state.dwell_model,
                'dwell_shape': state.effective_dwell_shape,
            }
            for state in self.states
        ]

    def _transition_payload(self) -> list[dict]:
        return [
            {
                'from': transition.from_state,
                'to': transition.to_state,
                'rate': transition.rate,
                'label': transition.label,
                'rate_cv': transition.rate_cv,
            }
            for transition in self.transitions
        ]

    def _system_parameters(self, pi: np.ndarray = None) -> dict:
        """Calculate the public summary with one stationary solve."""
        if pi is None:
            pi = self.steady_state()
        availability = (
            float(np.sum(pi[self.up_indices])) if pi is not None else None
        )
        unavailability = None if availability is None else 1.0 - availability

        failure_frequency = None
        repair_frequency = None
        if pi is not None:
            failure_frequency = 0.0
            repair_frequency = 0.0
            up = set(self.up_indices)
            down = set(self.down_indices)
            for transition in self.transitions:
                i = self._state_index[transition.from_state]
                j = self._state_index[transition.to_state]
                flow = float(pi[i] * transition.rate)
                if i in up and j in down:
                    failure_frequency += flow
                if i in down and j in up:
                    repair_frequency += flow

        mtbf = (
            1.0 / failure_frequency
            if failure_frequency is not None and failure_frequency > 0 else None
        )
        mut = (
            availability / failure_frequency
            if availability is not None and failure_frequency is not None
            and failure_frequency > 0 else None
        )
        mttr = (
            unavailability / failure_frequency
            if unavailability is not None and failure_frequency is not None
            and failure_frequency > 0 else None
        )
        return {
            'availability_ss': availability,
            'unavailability_ss': unavailability,
            'mttf': self.mttf(),
            'mtbf': mtbf,
            'mut': mut,
            'mttr': mttr,
            'failure_frequency': failure_frequency,
            'repair_frequency': repair_frequency,
        }

    def _model_contract(self, selected_model: str) -> dict:
        departures = self._departure_rates()
        warnings = []
        for i, state in enumerate(self.states):
            if state.dwell_model == 'erlang' and departures[i] == 0:
                warnings.append(
                    f"State '{state.name}' is absorbing, so its Erlang dwell "
                    "setting has no effect."
                )

        if selected_model == 'erlang_phase_type':
            assumptions = [
                "Transition intensities and Erlang phase rates are constant over time.",
                "Each public-state dwell clock starts at phase 1 on entry.",
                "Destination probabilities are independent of dwell age and equal to the input-rate proportions.",
                "Hidden Erlang phases are sequential and have equal phase rates; public states are mutually exclusive and exhaustive.",
            ]
            dwell_interpretation = (
                "An Erlang(k, kq) holding time replaces the exponential clock "
                "for selected states, preserving mean 1/q and giving CV 1/sqrt(k)."
            )
        else:
            assumptions = [
                "Transition rates are constant over time (time-homogeneous CTMC).",
                "State holding times are exponential and memoryless.",
                "Competing outgoing transitions act independently; their rates add.",
                "The current state contains all information needed for future evolution, and states are mutually exclusive and exhaustive.",
            ]
            dwell_interpretation = (
                "For state i, the mean holding time is 1/sum(q_ij) and the "
                "holding-time CV is 1."
            )

        return {
            'contract_version': 2,
            'selected_model': selected_model,
            'display_name': (
                'Erlang phase-type dwell model'
                if selected_model == 'erlang_phase_type'
                else 'Time-homogeneous CTMC'
            ),
            'assumptions': assumptions,
            'dwell_time_interpretation': dwell_interpretation,
            'warnings': warnings,
            'uncertainty_interpretation': (
                "Nominal results condition on the entered rates. Any reported "
                "Monte Carlo interval is a propagated input-uncertainty interval, "
                "not a confidence interval inferred from event data."
            ),
        }

    def _analyze_ctmc(self, times: list[float] = None,
                      initial: np.ndarray = None) -> dict:
        """Solve this chain as a CTMC without applying public dwell models."""
        Q = self.transition_matrix()
        pi = self.steady_state()
        result = {
            'states': self._state_payload(),
            'transitions': self._transition_payload(),
            'transition_matrix': Q.tolist(),
            'steady_state': (
                {state.id: float(pi[i])
                 for i, state in enumerate(self.states)}
                if pi is not None else None
            ),
            'system_params': self._system_parameters(pi),
        }

        if times is not None and len(times) > 0:
            times = self._validated_times(times)
            initial = self._validated_initial(initial)
            probs = self.transient_series(times, initial)
            reliabilities = self.reliability_series(times, initial)
            result['time_dependent'] = [
                {
                    'time': time,
                    'state_probs': {
                        state.id: float(probs[k, i])
                        for i, state in enumerate(self.states)
                    },
                    'availability': float(np.clip(
                        np.sum(probs[k][self.up_indices]), 0.0, 1.0
                    )),
                    'unavailability': float(np.clip(
                        np.sum(probs[k][self.down_indices]), 0.0, 1.0
                    )),
                    'reliability': reliabilities[k],
                    'unreliability': 1.0 - reliabilities[k],
                }
                for k, time in enumerate(times)
            ]
        return result

    def _phase_initial(self, initial: np.ndarray,
                       expanded: 'MarkovChain',
                       mapping: dict[str, list[str]]) -> np.ndarray:
        public_initial = self._validated_initial(initial)
        expanded_initial = np.zeros(expanded.n_states)
        for i, state in enumerate(self.states):
            expanded_initial[expanded._state_index[mapping[state.id][0]]] = public_initial[i]
        return expanded_initial

    def _analyze_phase_type(self, times: list[float] = None,
                            initial: np.ndarray = None,
                            include_baseline: bool = True) -> dict:
        expanded, mapping, phase_diagnostics = self.phase_type_expansion()
        expanded_initial = self._phase_initial(initial, expanded, mapping)
        selected = expanded._analyze_ctmc(times, expanded_initial)

        selected['states'] = self._state_payload()
        selected['transitions'] = self._transition_payload()
        # A public-state generator does not exist for non-memoryless holding
        # times. Return the input-rate CTMC reference matrix and disclose this.
        selected['transition_matrix'] = self.transition_matrix().tolist()
        if selected['steady_state'] is not None:
            phase_pi = selected['steady_state']
            selected['steady_state'] = {
                state.id: sum(phase_pi[phase] for phase in mapping[state.id])
                for state in self.states
            }

        for entry in selected.get('time_dependent', []):
            phase_probs = entry['state_probs']
            entry['state_probs'] = {
                state.id: sum(phase_probs[phase] for phase in mapping[state.id])
                for state in self.states
            }

        selected['model_contract'] = self._model_contract('erlang_phase_type')
        selected['phase_type'] = {
            'status': 'applied',
            **phase_diagnostics,
            'solver': 'exact finite-state CTMC phase expansion',
            'matrix_note': (
                "transition_matrix is the public input-rate CTMC reference; "
                "the selected transient solution uses the disclosed hidden phases."
            ),
        }

        if include_baseline:
            baseline = self._analyze_ctmc(times, initial)
            selected['ctmc_baseline'] = {
                'model': 'time_homogeneous_ctmc',
                'system_params': baseline['system_params'],
                'steady_state': baseline['steady_state'],
                'time_dependent': baseline.get('time_dependent'),
                'comparison_note': (
                    "The baseline uses the same mean departure rates with "
                    "exponential, memoryless public-state dwell times."
                ),
            }
        return selected

    def analyze(self, times: list[float] = None,
                initial: np.ndarray = None,
                use_dwell_models: bool = True,
                include_baseline: bool = True) -> dict:
        """Run nominal steady-state and transient reliability analysis.

        Erlang state dwell settings are applied by default. Set
        ``use_dwell_models=False`` to force the input-rate CTMC reference model.
        """
        use_phase_type = use_dwell_models and any(
            state.effective_dwell_shape > 1 for state in self.states
        )
        if use_phase_type:
            return self._analyze_phase_type(times, initial, include_baseline)

        result = self._analyze_ctmc(times, initial)
        result['model_contract'] = self._model_contract('time_homogeneous_ctmc')
        result['phase_type'] = {
            'status': 'not_applied',
            'family': 'Erlang phase-type',
            'reason': 'All effective public-state dwell shapes are one.',
            'expanded_state_count': self.n_states,
            'public_state_count': self.n_states,
        }
        return result

    def analyze_rate_uncertainty(self, mission_time: float = None,
                                 initial: np.ndarray = None,
                                 n_samples: int = 500,
                                 ci: float = 0.90,
                                 seed: int = None) -> dict:
        """Propagate independent transition-rate uncertainty by Monte Carlo.

        Each positive rate with ``rate_cv > 0`` is sampled from a lognormal
        distribution parameterised to retain the entered rate as its mean.
        This is scenario/parameter uncertainty propagation; it does not infer
        rate uncertainty from event data.
        """
        if (isinstance(n_samples, bool) or int(n_samples) != n_samples
                or not 20 <= int(n_samples) <= 10000):
            raise ValueError("Uncertainty samples must be between 20 and 10000")
        if not np.isfinite(ci) or not 0 < ci < 1:
            raise ValueError("Uncertainty interval level must be between 0 and 1")
        if mission_time is not None:
            mission_time = self._validated_times([mission_time])[0]
        initial = self._validated_initial(initial)

        uncertain = [
            i for i, transition in enumerate(self.transitions)
            if transition.rate > 0 and transition.rate_cv > 0
        ]
        zero_rate_cv = [
            i for i, transition in enumerate(self.transitions)
            if transition.rate == 0 and transition.rate_cv > 0
        ]
        if not uncertain:
            return {
                'status': 'not_requested',
                'reason': 'No positive transition has a non-zero rate CV.',
                'warnings': (
                    ["CV settings on zero rates have no effect."] if zero_rate_cv else []
                ),
            }

        rng = np.random.default_rng(seed)
        n_samples = int(n_samples)
        sampled_rates = np.tile(
            np.array([transition.rate for transition in self.transitions], dtype=float),
            (n_samples, 1),
        )
        for index in uncertain:
            transition = self.transitions[index]
            sigma = np.sqrt(np.log1p(transition.rate_cv ** 2))
            log_mean = np.log(transition.rate) - 0.5 * sigma ** 2
            sampled_rates[:, index] = rng.lognormal(log_mean, sigma, n_samples)

        metric_names = [
            'availability_ss', 'unavailability_ss', 'mttf', 'mtbf', 'mut',
            'mttr', 'failure_frequency', 'repair_frequency',
        ]
        collected: dict[str, list[float]] = {name: [] for name in metric_names}
        collected['availability_at_mission'] = []
        collected['reliability_at_mission'] = []
        successful = 0

        for row in sampled_rates:
            try:
                sampled = MarkovChain(
                    states=[
                        MarkovState(
                            state.id, state.name, state.state_type,
                            state.description, state.dwell_model, state.dwell_shape,
                        )
                        for state in self.states
                    ],
                    transitions=[
                        MarkovTransition(
                            transition.from_state, transition.to_state, row[i],
                            transition.label, transition.rate_cv,
                        )
                        for i, transition in enumerate(self.transitions)
                    ],
                )
                sample_times = [mission_time] if mission_time is not None else None
                result = sampled.analyze(
                    sample_times, initial, include_baseline=False
                )
                for name in metric_names:
                    value = result['system_params'].get(name)
                    if value is not None and np.isfinite(value):
                        collected[name].append(float(value))
                if sample_times:
                    endpoint = result['time_dependent'][-1]
                    collected['availability_at_mission'].append(
                        float(endpoint['availability'])
                    )
                    collected['reliability_at_mission'].append(
                        float(endpoint['reliability'])
                    )
                successful += 1
            except (ValueError, np.linalg.LinAlgError, FloatingPointError):
                continue

        lower_q = (1.0 - ci) / 2.0
        upper_q = 1.0 - lower_q

        def interval(values: list[float]) -> Optional[dict]:
            if not values:
                return None
            values_array = np.asarray(values)
            return {
                'lower': float(np.quantile(values_array, lower_q)),
                'median': float(np.quantile(values_array, 0.5)),
                'upper': float(np.quantile(values_array, upper_q)),
                'successful': len(values),
            }

        metric_intervals = {
            name: summary
            for name in collected
            if (summary := interval(collected[name])) is not None
        }
        rate_intervals = []
        for index in uncertain:
            transition = self.transitions[index]
            values = sampled_rates[:, index]
            rate_intervals.append({
                'transition_index': index,
                'from': transition.from_state,
                'to': transition.to_state,
                'input_mean': transition.rate,
                'input_cv': transition.rate_cv,
                'lower': float(np.quantile(values, lower_q)),
                'median': float(np.quantile(values, 0.5)),
                'upper': float(np.quantile(values, upper_q)),
            })

        warnings = []
        if zero_rate_cv:
            warnings.append("CV settings on zero rates have no effect.")
        if successful < n_samples:
            warnings.append(
                f"{n_samples - successful} samples failed numerical validation "
                "and were excluded."
            )
        return {
            'status': 'complete' if successful == n_samples else 'partial',
            'method': 'independent mean-preserving lognormal rate sampling',
            'interpretation': (
                "Intervals describe propagated uncertainty under the entered "
                "rate CVs and independence assumption; they are not event-data "
                "confidence intervals."
            ),
            'CI': ci,
            'requested_samples': n_samples,
            'successful_samples': successful,
            'seed': seed,
            'mission_time': mission_time,
            'metric_intervals': metric_intervals,
            'rate_intervals': rate_intervals,
            'warnings': warnings,
        }


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
