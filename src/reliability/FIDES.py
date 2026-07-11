"""FIDES Guide 2022 Reliability Prediction.

European reliability prediction methodology combining physics-of-failure
models with manufacturing process quality assessment.

Key concept: lambda = sum_phases(lambda_physical * pi_PM * pi_Process) * (t_phase / t_annual)

Failure rates internally in FIT (1 FIT = 1e-9/hr), converted to FPMH for output
(1 FPMH = 1e-6/hr = 1000 FIT).

This module implements a simplified screening structure inspired by FIDES; it
does not reproduce the complete 2022 tables, Pi Process audit, or official tool
workflow. See ``reliability.Standards``.
"""

import math
from typing import Optional

K_BOLTZMANN = 8.617e-5  # eV/K

# ---------------------------------------------------------------------------
# Process and quality factors
# ---------------------------------------------------------------------------

def pi_process(process_score: float = 50.0) -> float:
    """Process quality factor from FIDES audit score (0-100).
    pi_Process = exp(2.0 * (1.0 - score/100))
    """
    score = max(0.0, min(100.0, process_score))
    return math.exp(2.0 * (1.0 - score / 100.0))


def pi_pm(part_manufacturing: str = 'standard') -> float:
    """Part manufacturing quality factor."""
    return {'high': 0.7, 'standard': 1.0, 'low': 1.5}.get(part_manufacturing, 1.0)


def pi_placement(solder_type: str = 'standard', rework: bool = False) -> float:
    """Placement/soldering quality factor."""
    base = {'lead_free': 1.1, 'standard': 1.0, 'manual': 1.3}.get(solder_type, 1.0)
    return base * (1.3 if rework else 1.0)


def pi_induced(application: str = 'fixed') -> float:
    """Induced factor for vibration/mechanical stress by application."""
    return {
        'fixed': 1.0, 'mobile': 1.5, 'portable': 1.3,
        'airborne': 2.0, 'naval': 1.7, 'space': 0.8,
    }.get(application, 1.0)


def _arrhenius(Ea: float, T: float, T_ref: float = 40.0) -> float:
    T_K = T + 273.15
    T_ref_K = T_ref + 273.15
    if T_K <= 0:
        T_K = 273.15
    return math.exp((Ea / K_BOLTZMANN) * (1.0 / T_ref_K - 1.0 / T_K))


def _thermal_cycling_factor(n_cycles: int = 365, delta_T: float = 20.0,
                             gamma: float = 2.5) -> float:
    if delta_T <= 0 or n_cycles <= 0:
        return 0.0
    return 0.001 * n_cycles * (delta_T / 20.0) ** gamma


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------

class _FIDESPart:
    """Base class for FIDES parts."""
    category = 'generic'

    def __init__(self, name: str = '', quantity: int = 1,
                 temperature: float = 40.0,
                 process_score: float = 50.0,
                 part_manufacturing: str = 'standard',
                 humidity: float = 50.0,
                 vibration_grms: float = 0.5,
                 n_thermal_cycles: int = 365,
                 delta_T: float = 20.0,
                 annual_operating_hours: float = 8760.0,
                 application: str = 'fixed',
                 **kwargs):
        self.name = name
        self.quantity = quantity
        self.temperature = temperature
        self.process_score = process_score
        self.part_manufacturing = part_manufacturing
        self.humidity = humidity
        self.vibration_grms = vibration_grms
        self.n_thermal_cycles = n_thermal_cycles
        self.delta_T = delta_T
        self.annual_operating_hours = annual_operating_hours
        self.application = application
        self._pi_factors = {}
        self._failure_rate = 0.0
        self._compute()

    def _compute(self):
        raise NotImplementedError

    @property
    def failure_rate(self) -> float:
        return self._failure_rate

    @property
    def total_failure_rate(self) -> float:
        return self._failure_rate * self.quantity

    @property
    def pi_factors(self) -> dict:
        return dict(self._pi_factors)


# ---------------------------------------------------------------------------
# Part classes
# ---------------------------------------------------------------------------

class IC(_FIDESPart):
    """Integrated circuit (digital, analog, memory, microprocessor, FPGA, ASIC)."""
    category = 'ic'

    _BASE_FIT = {
        'digital': 8.0, 'analog': 10.0, 'memory': 20.0,
        'microprocessor': 30.0, 'fpga': 25.0, 'asic': 15.0,
    }
    _EA = {
        'digital': 0.40, 'analog': 0.40, 'memory': 0.60,
        'microprocessor': 0.45, 'fpga': 0.45, 'asic': 0.40,
    }

    def __init__(self, ic_type: str = 'digital', complexity: int = 10000,
                 **kwargs):
        self.ic_type = ic_type
        self.complexity = complexity
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = self._BASE_FIT.get(self.ic_type, 10.0)
        Ea = self._EA.get(self.ic_type, 0.40)

        if self.complexity > 100000:
            cx = 2.0
        elif self.complexity > 10000:
            cx = 1.5
        else:
            cx = 1.0

        pi_t = _arrhenius(Ea, self.temperature)
        pi_tc = 1.0 + _thermal_cycling_factor(self.n_thermal_cycles, self.delta_T)
        pi_rh = 1.0 + 0.005 * max(0.0, self.humidity - 60.0)
        pi_mech = 1.0 + 0.1 * self.vibration_grms
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)
        pi_ind = pi_induced(self.application)

        lambda_fit = base_fit * cx * pi_t * pi_tc * pi_rh * pi_mech
        lambda_fit *= pi_proc * pi_man * pi_ind

        self._failure_rate = lambda_fit / 1000.0  # FIT → FPMH
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'C_complexity': round(cx, 3),
            'pi_T': round(pi_t, 4),
            'pi_TC': round(pi_tc, 4),
            'pi_RH': round(pi_rh, 4),
            'pi_mech': round(pi_mech, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
            'pi_induced': round(pi_ind, 4),
        }


class Discrete(_FIDESPart):
    """Discrete semiconductor (diode, transistor, thyristor)."""
    category = 'discrete'

    _BASE_FIT = {
        'diode': 3.0, 'transistor_npn': 4.0, 'transistor_pnp': 4.0,
        'mosfet': 4.5, 'jfet': 3.5, 'thyristor': 5.0,
        'triac': 5.5, 'optoelectronic': 6.0,
    }
    _EA = {
        'diode': 0.35, 'transistor_npn': 0.40, 'transistor_pnp': 0.40,
        'mosfet': 0.40, 'jfet': 0.35, 'thyristor': 0.50,
        'triac': 0.50, 'optoelectronic': 0.35,
    }

    def __init__(self, sub_type: str = 'diode', voltage_stress: float = 0.5,
                 **kwargs):
        self.sub_type = sub_type
        self.voltage_stress = voltage_stress
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = self._BASE_FIT.get(self.sub_type, 4.0)
        Ea = self._EA.get(self.sub_type, 0.40)

        pi_t = _arrhenius(Ea, self.temperature)
        pi_s = 1.0 + 2.0 * max(0.0, self.voltage_stress - 0.5)
        pi_tc = 1.0 + _thermal_cycling_factor(self.n_thermal_cycles, self.delta_T)
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)
        pi_ind = pi_induced(self.application)

        lambda_fit = base_fit * pi_t * pi_s * pi_tc * pi_proc * pi_man * pi_ind
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'pi_T': round(pi_t, 4),
            'pi_S': round(pi_s, 4),
            'pi_TC': round(pi_tc, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
            'pi_induced': round(pi_ind, 4),
        }


class Passive_Resistor(_FIDESPart):
    """Passive component: resistor."""
    category = 'passive_resistor'

    _BASE_FIT = {'film': 0.5, 'wirewound': 1.5, 'composition': 1.0, 'network': 0.8}

    def __init__(self, resistor_type: str = 'film', power_stress: float = 0.5,
                 **kwargs):
        self.resistor_type = resistor_type
        self.power_stress = power_stress
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = self._BASE_FIT.get(self.resistor_type, 0.5)
        pi_t = _arrhenius(0.20, self.temperature)
        pi_s = 1.0 + 1.5 * max(0.0, self.power_stress - 0.5)
        pi_tc = 1.0 + _thermal_cycling_factor(self.n_thermal_cycles, self.delta_T)
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)

        lambda_fit = base_fit * pi_t * pi_s * pi_tc * pi_proc * pi_man
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'pi_T': round(pi_t, 4),
            'pi_S': round(pi_s, 4),
            'pi_TC': round(pi_tc, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
        }


class Passive_Capacitor(_FIDESPart):
    """Passive component: capacitor."""
    category = 'passive_capacitor'

    _BASE_FIT = {
        'ceramic_mlcc': 3.0, 'tantalum': 8.0, 'aluminum': 12.0,
        'film': 2.0, 'mica': 1.5,
    }
    _EA = {
        'ceramic_mlcc': 0.35, 'tantalum': 0.15, 'aluminum': 0.40,
        'film': 0.15, 'mica': 0.15,
    }

    def __init__(self, cap_type: str = 'ceramic_mlcc', voltage_stress: float = 0.5,
                 **kwargs):
        self.cap_type = cap_type
        self.voltage_stress = voltage_stress
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = self._BASE_FIT.get(self.cap_type, 3.0)
        Ea = self._EA.get(self.cap_type, 0.35)
        pi_t = _arrhenius(Ea, self.temperature)
        pi_s = 1.0 + 3.0 * max(0.0, self.voltage_stress - 0.5)
        pi_tc = 1.0 + _thermal_cycling_factor(self.n_thermal_cycles, self.delta_T)
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)

        lambda_fit = base_fit * pi_t * pi_s * pi_tc * pi_proc * pi_man
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'pi_T': round(pi_t, 4),
            'pi_S': round(pi_s, 4),
            'pi_TC': round(pi_tc, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
        }


class Passive_Inductor(_FIDESPart):
    """Passive component: inductor/transformer."""
    category = 'passive_inductor'

    _BASE_FIT = {'inductor': 3.0, 'transformer': 6.0}

    def __init__(self, inductor_type: str = 'inductor', **kwargs):
        self.inductor_type = inductor_type
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = self._BASE_FIT.get(self.inductor_type, 3.0)
        pi_t = _arrhenius(0.15, self.temperature)
        pi_tc = 1.0 + _thermal_cycling_factor(self.n_thermal_cycles, self.delta_T)
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)

        lambda_fit = base_fit * pi_t * pi_tc * pi_proc * pi_man
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'pi_T': round(pi_t, 4),
            'pi_TC': round(pi_tc, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
        }


class Connector(_FIDESPart):
    """Connector (circular, rectangular, PCB, RF)."""
    category = 'connector'

    _BASE_FIT_PER_PIN = {
        'circular': 0.5, 'rectangular': 0.4, 'pcb': 0.3, 'rf': 0.8,
    }

    def __init__(self, connector_type: str = 'rectangular', pins: int = 20,
                 **kwargs):
        self.connector_type = connector_type
        self.pins = pins
        super().__init__(**kwargs)

    def _compute(self):
        base_per_pin = self._BASE_FIT_PER_PIN.get(self.connector_type, 0.5)
        base_fit = base_per_pin * self.pins
        pi_t = _arrhenius(0.15, self.temperature)
        pi_mech = 1.0 + 0.2 * self.vibration_grms
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)

        lambda_fit = base_fit * pi_t * pi_mech * pi_proc * pi_man
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': round(base_fit, 2),
            'pi_T': round(pi_t, 4),
            'pi_mech': round(pi_mech, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
        }


class PCB(_FIDESPart):
    """Printed circuit board."""
    category = 'pcb'

    _BASE_FIT_PER_LAYER = {
        'single': 1.0, 'double': 1.5, 'multilayer': 2.0, 'flex': 3.0,
    }

    def __init__(self, pcb_type: str = 'multilayer', layers: int = 4,
                 area_sqcm: float = 100.0, **kwargs):
        self.pcb_type = pcb_type
        self.layers = layers
        self.area_sqcm = area_sqcm
        super().__init__(**kwargs)

    def _compute(self):
        base_per_layer = self._BASE_FIT_PER_LAYER.get(self.pcb_type, 2.0)
        area_factor = max(1.0, (self.area_sqcm / 100.0) ** 0.5)
        base_fit = base_per_layer * self.layers * area_factor
        pi_tc = 1.0 + _thermal_cycling_factor(self.n_thermal_cycles, self.delta_T, 3.0)
        pi_proc = pi_process(self.process_score)

        lambda_fit = base_fit * pi_tc * pi_proc
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': round(base_fit, 2),
            'pi_TC': round(pi_tc, 4),
            'pi_Process': round(pi_proc, 4),
        }


class Relay(_FIDESPart):
    """Relay (electromagnetic, solid state, reed)."""
    category = 'relay'

    _BASE_FIT = {'electromagnetic': 100.0, 'solid_state': 50.0, 'reed': 30.0}

    def __init__(self, relay_type: str = 'electromagnetic',
                 cycles_per_hour: float = 1.0, **kwargs):
        self.relay_type = relay_type
        self.cycles_per_hour = cycles_per_hour
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = self._BASE_FIT.get(self.relay_type, 100.0)
        pi_t = _arrhenius(0.25, self.temperature)
        pi_cyc = max(1.0, self.cycles_per_hour / 1.0)
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)

        lambda_fit = base_fit * pi_t * pi_cyc * pi_proc * pi_man
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'pi_T': round(pi_t, 4),
            'pi_CYC': round(pi_cyc, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
        }


class Switch(_FIDESPart):
    """Switch."""
    category = 'switch'

    _BASE_FIT = {
        'toggle': 50.0, 'pushbutton': 40.0, 'rotary': 60.0,
        'rocker': 45.0, 'dip': 30.0,
    }

    def __init__(self, switch_type: str = 'toggle',
                 cycles_per_hour: float = 1.0, **kwargs):
        self.switch_type = switch_type
        self.cycles_per_hour = cycles_per_hour
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = self._BASE_FIT.get(self.switch_type, 50.0)
        pi_cyc = max(1.0, self.cycles_per_hour / 1.0)
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)

        lambda_fit = base_fit * pi_cyc * pi_proc * pi_man
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'pi_CYC': round(pi_cyc, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
        }


class Crystal(_FIDESPart):
    """Quartz crystal oscillator."""
    category = 'crystal'

    def __init__(self, frequency_mhz: float = 10.0, **kwargs):
        self.frequency_mhz = frequency_mhz
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = 10.0
        pi_t = _arrhenius(0.20, self.temperature)
        pi_proc = pi_process(self.process_score)
        pi_man = pi_pm(self.part_manufacturing)

        lambda_fit = base_fit * pi_t * pi_proc * pi_man
        self._failure_rate = lambda_fit / 1000.0
        self._pi_factors = {
            'lambda_base_FIT': base_fit,
            'pi_T': round(pi_t, 4),
            'pi_Process': round(pi_proc, 4),
            'pi_PM': round(pi_man, 4),
        }


# ---------------------------------------------------------------------------
# FIDES Mission Profile support
# ---------------------------------------------------------------------------

class FIDESMissionPhase:
    """A single phase within a FIDES mission profile."""

    def __init__(self, name: str, duration_hours: float,
                 temperature: float = 40.0, humidity: float = 50.0,
                 vibration_grms: float = 0.5,
                 n_thermal_cycles: int = 0, delta_T: float = 0.0,
                 on_off_cycles: int = 0, operating: bool = True,
                 description: str = ''):
        self.name = name
        self.duration_hours = duration_hours
        self.temperature = temperature
        self.humidity = humidity
        self.vibration_grms = vibration_grms
        self.n_thermal_cycles = n_thermal_cycles
        self.delta_T = delta_T
        self.on_off_cycles = on_off_cycles
        self.operating = operating
        self.description = description


class FIDESMissionProfile:
    """Complete FIDES mission profile (annual)."""

    def __init__(self, name: str = 'Default', phases: list = None):
        self.name = name
        self.phases: list[FIDESMissionPhase] = phases or []

    def add_phase(self, phase: FIDESMissionPhase):
        self.phases.append(phase)

    @property
    def total_hours(self) -> float:
        return sum(p.duration_hours for p in self.phases)


def compute_fides_prediction(parts: list[_FIDESPart],
                              mission_profile: FIDESMissionProfile = None,
                              process_score: float = 50.0) -> dict:
    """Compute FIDES prediction for a set of parts.

    If a mission profile is provided, the failure rate is computed per-phase
    and weighted by phase duration. Otherwise uses the part's own parameters.
    """
    if mission_profile and mission_profile.phases:
        total_hours = mission_profile.total_hours
        if total_hours <= 0:
            total_hours = 8760.0

        part_results = []
        system_lambda = 0.0

        for part in parts:
            phase_lambdas = []
            for phase in mission_profile.phases:
                kwargs = {
                    'name': part.name,
                    'quantity': part.quantity,
                    'temperature': phase.temperature,
                    'process_score': process_score,
                    'part_manufacturing': part.part_manufacturing,
                    'humidity': phase.humidity,
                    'vibration_grms': phase.vibration_grms,
                    'n_thermal_cycles': phase.n_thermal_cycles,
                    'delta_T': phase.delta_T,
                    'application': part.application,
                }
                for attr in ('ic_type', 'complexity', 'sub_type', 'voltage_stress',
                             'resistor_type', 'power_stress', 'cap_type',
                             'inductor_type', 'connector_type', 'pins',
                             'pcb_type', 'layers', 'area_sqcm',
                             'relay_type', 'cycles_per_hour', 'switch_type',
                             'frequency_mhz'):
                    if hasattr(part, attr):
                        kwargs[attr] = getattr(part, attr)

                try:
                    phase_part = part.__class__(**kwargs)
                    dormant = 1.0 if phase.operating else 0.1
                    phase_fr = phase_part.total_failure_rate * dormant
                except (TypeError, ValueError):
                    phase_fr = 0.0

                weight = phase.duration_hours / total_hours
                phase_lambdas.append({
                    'phase': phase.name,
                    'failure_rate': round(phase_fr, 8),
                    'weight': round(weight, 6),
                    'weighted': round(phase_fr * weight, 8),
                })

            weighted_fr = sum(pl['weighted'] for pl in phase_lambdas)
            system_lambda += weighted_fr
            part_results.append({
                'name': part.name,
                'category': part.category,
                'quantity': part.quantity,
                'mission_failure_rate': round(weighted_fr, 8),
                'phases': phase_lambdas,
            })

        mtbf = 1e6 / system_lambda if system_lambda > 0 else None
        return {
            'mission_name': mission_profile.name,
            'process_score': process_score,
            'system_failure_rate': round(system_lambda, 6),
            'system_mtbf': round(mtbf, 1) if mtbf else None,
            'total_hours': total_hours,
            'part_results': part_results,
        }
    else:
        total_fr = sum(p.total_failure_rate for p in parts)
        mtbf = 1e6 / total_fr if total_fr > 0 else None
        results = []
        for p in parts:
            results.append({
                'name': p.name,
                'category': p.category,
                'quantity': p.quantity,
                'failure_rate': round(p.failure_rate, 8),
                'total_failure_rate': round(p.total_failure_rate, 8),
                'contribution': round(p.total_failure_rate / total_fr, 6) if total_fr > 0 else 0,
                'pi_factors': p.pi_factors,
            })
        return {
            'process_score': process_score,
            'system_failure_rate': round(total_fr, 6),
            'system_mtbf': round(mtbf, 1) if mtbf else None,
            'results': results,
        }


# ---------------------------------------------------------------------------
# System failure rate
# ---------------------------------------------------------------------------

class SystemFailureRate:
    """Sum of part failure rates (series model)."""

    def __init__(self, parts: list[_FIDESPart]):
        if not parts:
            raise ValueError("At least one part is required")
        self.parts = parts
        self._total = sum(p.total_failure_rate for p in parts)

    @property
    def total_failure_rate(self) -> float:
        return self._total

    @property
    def mtbf(self) -> float:
        if self._total <= 0:
            return float('inf')
        return 1e6 / self._total

    @property
    def results(self) -> list[dict]:
        out = []
        for p in self.parts:
            out.append({
                'name': p.name,
                'category': p.category,
                'quantity': p.quantity,
                'failure_rate': round(p.failure_rate, 8),
                'total_failure_rate': round(p.total_failure_rate, 8),
                'contribution': (round(p.total_failure_rate / self._total, 6)
                                 if self._total > 0 else 0),
                'pi_factors': p.pi_factors,
            })
        return out
