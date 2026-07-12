"""Mission profile-based failure rate calculation.

A mission profile consists of multiple phases, each with its own duration,
environment, temperature, and operating conditions. The mission failure rate
is a time-weighted average of the phase failure rates.

This module is independent of the ``MIL_HDBK_217F`` module at import time;
the MIL-HDBK-217F part classes are only used inside the ``compute_*``
functions at runtime.

Usage
-----
>>> from reliability.MissionProfile import (
...     MissionPhase, MissionProfile, compute_mission_failure_rate,
...     STANDARD_PROFILES,
... )
>>> from reliability.MIL_HDBK_217F import Resistor
>>> profile = STANDARD_PROFILES['ground_fixed']
>>> result = compute_mission_failure_rate(
...     profile, Resistor, {'style': 'RL',
...                          'power_stress': 0.3, 'rated_power': 0.25})
>>> print(f"Mission MTBF: {result['mission_mtbf']:.0f} hours")
"""

import inspect


class MissionPhase:
    """A single phase within a mission profile.

    Parameters
    ----------
    name : str
        Short name for the phase (e.g. 'Cruise', 'Combat').
    duration : float
        Phase duration in hours.
    environment : str
        MIL-HDBK-217F environment code (e.g. 'GB', 'AIF', 'NS').
    temperature : float
        Ambient or junction temperature during this phase (deg C).
    operating : bool
        True if the equipment is operating; False for dormant/storage.
    duty_cycle : float
        Fraction of time the equipment is active within the phase (0-1).
    description : str
        Optional longer description.
    """

    def __init__(self, name: str, duration: float, environment: str = 'GB',
                 temperature: float = 40.0, operating: bool = True,
                 duty_cycle: float = 1.0, description: str = ''):
        self.name = name
        self.duration = duration
        self.environment = environment
        self.temperature = temperature
        self.operating = operating
        self.duty_cycle = duty_cycle
        self.description = description

    def __repr__(self):
        return (f"MissionPhase({self.name!r}, {self.duration}h, "
                f"env={self.environment!r}, T={self.temperature}°C, "
                f"op={self.operating}, dc={self.duty_cycle})")


class MissionProfile:
    """A complete mission profile composed of sequential phases.

    Parameters
    ----------
    name : str
        Profile name.
    phases : list[MissionPhase], optional
        Initial list of phases.
    """

    def __init__(self, name: str = 'Default Mission', phases: list = None):
        self.name = name
        self.phases: list[MissionPhase] = phases or []

    def add_phase(self, phase: MissionPhase):
        """Append a phase to the profile."""
        self.phases.append(phase)

    @property
    def total_duration(self) -> float:
        """Total mission duration in hours."""
        return sum(p.duration for p in self.phases)

    @property
    def operating_duration(self) -> float:
        """Total operating (non-dormant) duration in hours."""
        return sum(p.duration for p in self.phases if p.operating)

    def phase_fractions(self) -> list:
        """Time fraction for each phase."""
        total = self.total_duration
        if total == 0:
            return [0.0] * len(self.phases)
        return [p.duration / total for p in self.phases]

    def __repr__(self):
        return (f"MissionProfile({self.name!r}, {len(self.phases)} phases, "
                f"{self.total_duration}h)")


class MissionCalculationError(ValueError):
    """A part could not be evaluated for a specific mission phase.

    The structured attributes let library and API callers identify the failed
    part/phase without treating an invalid input as a zero failure rate.
    """

    code = 'MISSION_PART_PHASE_CALCULATION_FAILED'

    def __init__(self, part_class, phase, cause):
        self.part_class = getattr(part_class, '__name__', str(part_class))
        self.phase_name = phase.name
        self.error_type = type(cause).__name__
        self.original_message = str(cause)
        self.part_index = None
        self.part_name = None
        super().__init__(
            f"Failed to calculate {self.part_class} during mission phase "
            f"{self.phase_name!r}: {self.original_message}")

    def to_dict(self) -> dict:
        """Return JSON-serializable error details."""
        detail = {
            'code': self.code,
            'part_class': self.part_class,
            'phase_name': self.phase_name,
            'error_type': self.error_type,
            'message': self.original_message,
        }
        if self.part_index is not None:
            detail['part_index'] = self.part_index
        if self.part_name is not None:
            detail['part_name'] = self.part_name
        return detail


# ===================================================================
# Temperature keyword mapping for MIL-HDBK-217F part classes
# ===================================================================

_TEMP_KWARG_CANDIDATES = (
    'T_junction', 'T_ambient', 'case_temperature_c',
    'channel_temperature_c', 'T_hotspot', 'frame_temperature',
    'T_insert', 'temperature',
)


def _constructor_parameters(part_class) -> dict:
    """Return an inspectable constructor signature, or an empty mapping."""
    try:
        return inspect.signature(part_class.__init__).parameters
    except (TypeError, ValueError):
        return {}


def _prepare_kwargs(part_class, part_params: dict, phase) -> dict:
    """Build the keyword arguments for instantiating *part_class*.

    Injects only inputs explicitly accepted by the part constructor and maps
    phase temperature to that model's actual temperature variable.  This is
    important for the Notice 2 models: for example, resistors use case
    temperature while GaAs FETs use channel temperature.
    """
    kwargs = dict(part_params)
    parameters = _constructor_parameters(part_class)
    if 'environment' in parameters:
        kwargs['environment'] = phase.environment

    temp_kwarg = next(
        (candidate for candidate in _TEMP_KWARG_CANDIDATES if candidate in parameters),
        None,
    )

    # Remove any existing temperature keywords so we don't double-specify
    for key in _TEMP_KWARG_CANDIDATES:
        kwargs.pop(key, None)

    if temp_kwarg is not None:
        kwargs[temp_kwarg] = phase.temperature
    return kwargs


# ===================================================================
# Core computation functions
# ===================================================================

def compute_mission_failure_rate(profile: MissionProfile,
                                  part_class, part_params: dict,
                                  base_environment: str = 'GB') -> dict:
    """Compute the effective failure rate across a mission profile.

    For each phase, instantiates the part with the phase's environment and
    temperature, gets its failure rate, then computes the time-weighted
    average.

    Parameters
    ----------
    profile : MissionProfile
        Mission profile with one or more phases.
    part_class
        A MIL-HDBK-217F part class (e.g. ``Resistor``, ``Capacitor``).
    part_params : dict
        Part parameters (excluding environment and temperature, which
        come from the phase).
    base_environment : str
        Fallback environment code if a phase has no environment set.

    Returns
    -------
    dict
        Keys:

        - ``mission_failure_rate``: time-weighted average lambda (FPMH)
        - ``mission_mtbf``: 1 / lambda_mission (hours)
        - ``mission_reliability``: R = exp(-lambda * duration) over mission
        - ``mission_unreliability``: 1 - R
        - ``total_duration``: total mission hours
        - ``operating_duration``: operating-only hours
        - ``n_phases``: number of phases
        - ``phase_results``: list of per-phase detail dicts

    Raises
    ------
    ValueError
        If *profile* has no phases or has no positive total duration.
    MissionCalculationError
        If the part cannot be evaluated for any phase. The error identifies
        the part class, phase, original exception type, and message.
    """
    import math

    if not profile.phases:
        raise ValueError("Mission profile has no phases")

    phase_results = []
    weighted_sum = 0.0
    total_time = profile.total_duration
    if total_time <= 0:
        raise ValueError("Mission profile total duration must be > 0")

    for phase in profile.phases:
        kwargs = _prepare_kwargs(part_class, part_params, phase)
        if not phase.environment:
            kwargs['environment'] = base_environment

        if not phase.operating:
            # Non-operating: typical dormant factor is ~0.1 of operating rate
            dormant_factor = 0.1
        else:
            dormant_factor = phase.duty_cycle

        try:
            part = part_class(**kwargs)
            phase_lambda = part.failure_rate * part.quantity * dormant_factor
            phase_total_lambda = part.total_failure_rate * dormant_factor
            pi_factors = part.pi_factors
        except (TypeError, ValueError) as exc:
            raise MissionCalculationError(part_class, phase, exc) from exc

        fraction = phase.duration / total_time if total_time > 0 else 0
        weighted_sum += phase_total_lambda * fraction

        phase_results.append({
            'phase_name': phase.name,
            'duration': phase.duration,
            'environment': phase.environment,
            'temperature': phase.temperature,
            'operating': phase.operating,
            'duty_cycle': phase.duty_cycle,
            'failure_rate': round(phase_lambda, 8),
            'total_failure_rate': round(phase_total_lambda, 8),
            'pi_factors': pi_factors,
            'fraction': round(fraction, 6),
            'weighted_contribution': round(phase_total_lambda * fraction, 8),
        })

    mission_lambda = weighted_sum  # FPMH (failures per 10^6 hours)
    # Convert FPMH to failures/hour for MTBF and reliability
    lambda_per_hour = mission_lambda * 1e-6
    mission_mtbf = 1.0 / lambda_per_hour if lambda_per_hour > 0 else None
    mission_reliability = (math.exp(-lambda_per_hour * total_time)
                           if lambda_per_hour > 0 else 1.0)

    return {
        'mission_name': profile.name,
        'mission_failure_rate': round(mission_lambda, 8),  # FPMH
        'mission_mtbf': round(mission_mtbf, 1) if mission_mtbf else None,
        'mission_reliability': round(mission_reliability, 8),
        'mission_unreliability': round(1.0 - mission_reliability, 8),
        'total_duration': total_time,
        'operating_duration': profile.operating_duration,
        'n_phases': len(profile.phases),
        'phase_results': phase_results,
    }


def compute_system_mission_rate(profile: MissionProfile,
                                 parts: list,
                                 base_environment: str = 'GB') -> dict:
    """Compute mission failure rate for an entire system (multiple parts).

    Assumes a series reliability model: the system fails when any part
    fails, so system lambda = sum of part lambdas.

    Parameters
    ----------
    profile : MissionProfile
        Mission profile.
    parts : list[tuple]
        List of ``(part_class, part_params_dict)`` tuples.
    base_environment : str
        Fallback environment code.

    Returns
    -------
    dict
        Keys:

        - ``system_failure_rate``: sum of part mission failure rates (FPMH)
        - ``system_mtbf``: 1 / system lambda after converting FPMH to 1/hour
        - ``system_reliability``: R = exp(-lambda_sys * duration), with lambda
          expressed in failures/hour
        - ``system_unreliability``: 1 - R
        - ``total_duration``: mission duration
        - ``n_parts``: number of parts
        - ``part_results``: list of per-part result dicts
    """
    import math

    part_results = []
    system_lambda = 0.0

    for i, (cls, params) in enumerate(parts):
        try:
            result = compute_mission_failure_rate(
                profile, cls, params, base_environment)
        except MissionCalculationError as exc:
            exc.part_index = i
            exc.part_name = params.get('name', f'Part {i+1}')
            raise
        result['part_index'] = i
        result['part_name'] = params.get('name', f'Part {i+1}')
        part_results.append(result)
        system_lambda += result['mission_failure_rate']

    total_time = profile.total_duration
    # Component predictions are in failures per million hours (FPMH). Convert
    # the summed system rate exactly once before applying time-domain formulas.
    lambda_per_hour = system_lambda * 1e-6
    system_mtbf = 1.0 / lambda_per_hour if lambda_per_hour > 0 else None
    system_reliability = (math.exp(-lambda_per_hour * total_time)
                          if lambda_per_hour > 0 else 1.0)

    return {
        'mission_name': profile.name,
        'system_failure_rate': round(system_lambda, 8),
        'system_mtbf': round(system_mtbf, 1) if system_mtbf else None,
        'system_reliability': round(system_reliability, 8),
        'system_unreliability': round(1.0 - system_reliability, 8),
        'total_duration': total_time,
        'n_parts': len(parts),
        'part_results': part_results,
    }


# ===================================================================
# Pre-defined mission profiles for common applications
# ===================================================================

STANDARD_PROFILES = {
    'ground_fixed': MissionProfile('Ground Fixed', [
        MissionPhase('Continuous Operation', 8760, 'GB', 40.0, True, 1.0),
    ]),
    'ground_mobile': MissionProfile('Ground Mobile', [
        MissionPhase('Transport', 200, 'GM', 50.0, False, 0.0,
                     'Vehicle transport'),
        MissionPhase('Setup', 100, 'GF', 35.0, True, 0.5,
                     'System setup and checkout'),
        MissionPhase('Operation', 6000, 'GF', 40.0, True, 1.0,
                     'Normal operation'),
        MissionPhase('Standby', 2460, 'GF', 25.0, True, 0.1,
                     'Powered standby'),
    ]),
    'airborne_fighter': MissionProfile('Airborne Fighter', [
        MissionPhase('Pre-Flight', 0.5, 'GF', 30.0, True, 0.5,
                     'Ground power-up and BIT'),
        MissionPhase('Takeoff', 0.1, 'AIF', 45.0, True, 1.0,
                     'Takeoff and climb'),
        MissionPhase('Cruise', 1.0, 'AIF', 35.0, True, 0.8,
                     'Transit to mission area'),
        MissionPhase('Combat', 0.5, 'AIF', 55.0, True, 1.0,
                     'High-performance maneuvering'),
        MissionPhase('Return', 1.0, 'AIF', 35.0, True, 0.8,
                     'Return transit'),
        MissionPhase('Landing', 0.1, 'AIF', 40.0, True, 1.0,
                     'Approach and landing'),
        MissionPhase('Post-Flight', 0.3, 'GF', 35.0, True, 0.3,
                     'Shutdown and post-flight'),
    ]),
    'naval_surface': MissionProfile('Naval Surface Ship', [
        MissionPhase('In Port', 2000, 'NS', 30.0, True, 0.3,
                     'Docked, minimal systems'),
        MissionPhase('Transit', 3000, 'NS', 35.0, True, 0.8,
                     'Underway transit'),
        MissionPhase('Operations', 3000, 'NS', 40.0, True, 1.0,
                     'At-sea operations'),
        MissionPhase('Battle Stations', 200, 'NS', 50.0, True, 1.0,
                     'Full combat readiness'),
    ]),
    'space_leo': MissionProfile('Space (LEO)', [
        MissionPhase('Launch', 0.25, 'SF', 60.0, True, 1.0,
                     'Launch and ascent'),
        MissionPhase('Orbit Sunlit', 4380, 'SF', 50.0, True, 1.0,
                     'Sunlit orbital phase'),
        MissionPhase('Orbit Eclipse', 4380, 'SF', -20.0, True, 0.8,
                     'Eclipse orbital phase'),
    ]),
    'automotive': MissionProfile('Automotive', [
        MissionPhase('Engine Start', 50, 'GM', 25.0, True, 1.0,
                     'Cold/hot start'),
        MissionPhase('City Driving', 3000, 'GM', 55.0, True, 0.6,
                     'Urban stop-and-go'),
        MissionPhase('Highway Driving', 2000, 'GM', 65.0, True, 0.9,
                     'Highway cruising'),
        MissionPhase('Parked', 3710, 'GM', 30.0, False, 0.0,
                     'Vehicle off, parked'),
    ]),
}
