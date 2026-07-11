"""Telcordia SR-332 (Issue 4) failure rate prediction.

Implements Method I (Parts Count) and Method II (Parts Stress) from
Telcordia SR-332 for commercial/telecom equipment reliability prediction.

Failure rates are in FPMH (Failures Per Million Hours) for consistency with
the MIL-HDBK-217F module. Internally SR-332 uses FITs (1 FIT = 1e-9/hr = 0.001 FPMH).

Part categories
---------------
- ``IC_Digital``        Integrated circuit, digital logic
- ``IC_Linear``         Integrated circuit, linear/analog
- ``IC_Memory``         Integrated circuit, memory (SRAM/DRAM/Flash)
- ``IC_Microprocessor`` Integrated circuit, microprocessor/MCU
- ``Diode``             Signal, power, zener diodes
- ``Transistor_BJT``    Bipolar junction transistors
- ``Transistor_FET``    MOSFET, JFET field-effect transistors
- ``Resistor``          Film, composition, wirewound, network resistors
- ``Capacitor``         Ceramic, tantalum, aluminum, film, mica capacitors
- ``Inductor``          Fixed inductors / chokes
- ``Transformer``       Signal and power transformers
- ``Relay``             Electromechanical and solid-state relays
- ``Switch``            Toggle / pushbutton / rotary switches
- ``Connector``         Multi-pin connectors (rate per pin)
- ``Crystal``           Quartz crystal oscillators / resonators
- ``Fuse``              Cartridge / blade fuses
- ``PCB``               Printed circuit boards (rate per layer per sq in)
- ``GenericPart``       User-supplied failure rate
- ``SystemFailureRate`` Series-system rollup of a parts list

All temperatures are in degrees Celsius.  Stress ratios are operating /
rated (dimensionless, 0--1).

References: Telcordia SR-332, Issue 4 (March 2016).

Conformance note: the factors here are a screening approximation. Licensed
SR-332 tables, the complete method workflows, and authoritative examples have
not been reproduced. See ``reliability.Standards``.
"""

import math
from typing import Optional

FPMH = "failures per 10^6 hours"

STANDARDS = ('SR-332',)

# ===================================================================
# Telcordia environments (commercial-oriented, simpler than 217F)
# ===================================================================

ENVIRONMENTS = ['GC', 'GF', 'GM', 'CL', 'NU', 'AF', 'AUF']

ENVIRONMENT_DESCRIPTIONS = {
    'GC': 'Ground, Controlled (office/central office)',
    'GF': 'Ground, Fixed (outdoor cabinet, sheltered)',
    'GM': 'Ground, Mobile (vehicle-mounted)',
    'CL': 'Controlled, Laboratory',
    'NU': 'Naval, Unsheltered',
    'AF': 'Airborne, Fighter/Attack',
    'AUF': 'Airborne, Uninhabited Fighter',
}

# Environmental stress factor piE for each environment
PI_E = {
    'GC': 1.0, 'GF': 2.0, 'GM': 5.0, 'CL': 0.5,
    'NU': 4.0, 'AF': 6.0, 'AUF': 8.0,
}

# ===================================================================
# Quality levels
# ===================================================================

QUALITY_LEVELS = ['telcordia', 'commercial_best', 'commercial', 'unknown']

PI_Q = {
    'telcordia': 0.25,       # Telcordia qualified
    'commercial_best': 0.5,  # Commercial, best practices
    'commercial': 1.0,       # Standard commercial
    'unknown': 2.0,          # Unknown provenance
}

# ===================================================================
# Temperature acceleration (Arrhenius)
# ===================================================================

# Default activation energy Ea values by part type (eV)
DEFAULT_EA = {
    'ic_digital': 0.35,
    'ic_linear': 0.35,
    'ic_memory': 0.60,
    'ic_microprocessor': 0.40,
    'discrete_semiconductor': 0.40,
    'diode': 0.31,
    'transistor': 0.40,
    'thyristor': 0.50,
    'optoelectronic': 0.35,
    'resistor': 0.20,
    'capacitor_ceramic': 0.35,
    'capacitor_aluminum': 0.40,
    'capacitor_tantalum': 0.15,
    'capacitor_film': 0.15,
    'inductor': 0.15,
    'transformer': 0.15,
    'relay': 0.25,
    'switch': 0.20,
    'connector': 0.15,
    'crystal': 0.20,
    'fuse': 0.10,
    'pcb': 0.10,
}

K_BOLTZMANN = 8.617e-5  # eV/K

# ===================================================================
# Helper functions
# ===================================================================


def _check_environment(environment):
    if environment not in ENVIRONMENTS:
        raise ValueError(
            f"environment must be one of {ENVIRONMENTS}, got '{environment}'")


def _check_quality(quality):
    if quality not in QUALITY_LEVELS:
        raise ValueError(
            f"quality must be one of {QUALITY_LEVELS}, got '{quality}'")


def _check_stress(value, name):
    if not 0 <= value <= 1:
        raise ValueError(
            f"{name} must be a ratio between 0 and 1, got {value}")


def pi_temperature(Ea: float, T_operating: float,
                   T_ref: float = 40.0) -> float:
    """Arrhenius temperature acceleration factor.

    piT = exp((Ea/k) * (1/T_ref - 1/T_op)) where temperatures are in
    Kelvin.
    """
    T_op_K = T_operating + 273.15
    T_ref_K = T_ref + 273.15
    return math.exp((Ea / K_BOLTZMANN) * (1.0 / T_ref_K - 1.0 / T_op_K))


def pi_stress(stress_ratio: float, exponent: float = 2.0) -> float:
    """Generic stress acceleration factor (Method II).

    piS = (S / S_ref)^n where S is operating stress ratio and S_ref
    is the reference derating point (0.5 = 50 % derated).  The result
    is clamped to [0.5, 5.0].
    """
    if stress_ratio <= 0:
        return 0.5
    return max(0.5, min(5.0, (stress_ratio / 0.5) ** exponent))


def _fit_to_fpmh(fit_value: float) -> float:
    """Convert FITs (failures per 10^9 hours) to FPMH."""
    return fit_value * 0.001


# ===================================================================
# Base class
# ===================================================================


class _TelcordiaPart:
    """Base class for SR-332 parts."""

    category = 'generic'

    def __init__(self, name='', quantity=1, environment='GC',
                 quality='commercial', temperature=40.0, **kwargs):
        if quantity < 1 or int(quantity) != quantity:
            raise ValueError("quantity must be a positive integer")
        self.name = name or self.__class__.__name__
        self.quantity = int(quantity)
        self.environment = environment
        self.quality = quality
        self.temperature = float(temperature)
        _check_environment(environment)
        _check_quality(quality)
        self._failure_rate = 0.0
        self._pi_factors = {}
        self._compute()

    def _compute(self):
        raise NotImplementedError

    @property
    def failure_rate(self):
        """Per-item failure rate in FPMH."""
        return self._failure_rate

    @property
    def total_failure_rate(self):
        """Total failure rate (quantity * per-item rate) in FPMH."""
        return self._failure_rate * self.quantity

    @property
    def pi_factors(self):
        """Dictionary of pi-factor values used in the prediction."""
        return self._pi_factors

    def __repr__(self):
        return (f"{self.__class__.__name__}(name='{self.name}', "
                f"failure_rate={self.failure_rate:.6f} FPMH, "
                f"quantity={self.quantity})")


# ===================================================================
# Integrated Circuits
# ===================================================================

_IC_DIGITAL_COMPLEXITY = {
    'low': 10,        # < 1 000 gates
    'medium': 20,     # 1k - 10k gates
    'high': 40,       # 10k - 100k gates
    'very_high': 80,  # > 100k gates
}


class IC_Digital(_TelcordiaPart):
    """Digital IC (logic, ASIC, FPGA).

    Parameters
    ----------
    complexity : str
        'low' (<1k gates, 10 FIT), 'medium' (1k-10k, 20 FIT),
        'high' (10k-100k, 40 FIT), 'very_high' (>100k, 80 FIT).
    """

    category = 'ic_digital'

    def __init__(self, complexity='medium', **kwargs):
        if complexity not in _IC_DIGITAL_COMPLEXITY:
            raise ValueError(
                f"complexity must be one of "
                f"{list(_IC_DIGITAL_COMPLEXITY)}, got '{complexity}'")
        self.complexity = complexity
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _IC_DIGITAL_COMPLEXITY[self.complexity]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['ic_digital'], self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


_IC_MEMORY_DENSITY = {
    'low': 30,     # < 1 Mb
    'medium': 50,  # 1 - 16 Mb
    'high': 100,   # > 16 Mb
}


class IC_Linear(_TelcordiaPart):
    """Linear / analog IC (op-amps, voltage regulators, etc.).

    Base rate: 15 FIT.
    """

    category = 'ic_linear'

    def _compute(self):
        base_fit = 15
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['ic_linear'], self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


class IC_Memory(_TelcordiaPart):
    """Memory IC (SRAM, DRAM, Flash, EEPROM).

    Parameters
    ----------
    density : str
        'low' (<1Mb, 30 FIT), 'medium' (1-16Mb, 50 FIT),
        'high' (>16Mb, 100 FIT).
    """

    category = 'ic_memory'

    def __init__(self, density='medium', **kwargs):
        if density not in _IC_MEMORY_DENSITY:
            raise ValueError(
                f"density must be one of "
                f"{list(_IC_MEMORY_DENSITY)}, got '{density}'")
        self.density = density
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _IC_MEMORY_DENSITY[self.density]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['ic_memory'], self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


_IC_MICRO_COMPLEXITY = {
    'low': 50,
    'medium': 80,
    'high': 120,
    'very_high': 150,
}


class IC_Microprocessor(_TelcordiaPart):
    """Microprocessor / microcontroller IC.

    Parameters
    ----------
    complexity : str
        'low' (50 FIT), 'medium' (80 FIT), 'high' (120 FIT),
        'very_high' (150 FIT).
    """

    category = 'ic_microprocessor'

    def __init__(self, complexity='medium', **kwargs):
        if complexity not in _IC_MICRO_COMPLEXITY:
            raise ValueError(
                f"complexity must be one of "
                f"{list(_IC_MICRO_COMPLEXITY)}, got '{complexity}'")
        self.complexity = complexity
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _IC_MICRO_COMPLEXITY[self.complexity]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['ic_microprocessor'],
                              self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


# ===================================================================
# Discrete Semiconductors
# ===================================================================

_DIODE_TYPES = {
    'general': 5,
    'signal': 3,
    'power': 8,
    'zener': 10,
}


class Diode(_TelcordiaPart):
    """Signal, power, or zener diode.

    Parameters
    ----------
    diode_type : str
        'general' (5 FIT), 'signal' (3 FIT), 'power' (8 FIT),
        'zener' (10 FIT).
    voltage_stress : float
        Ratio of applied voltage to rated voltage (0--1).
    """

    category = 'diode'

    def __init__(self, diode_type='general', voltage_stress=0.5, **kwargs):
        if diode_type not in _DIODE_TYPES:
            raise ValueError(
                f"diode_type must be one of {list(_DIODE_TYPES)}, "
                f"got '{diode_type}'")
        _check_stress(voltage_stress, 'voltage_stress')
        self.diode_type = diode_type
        self.voltage_stress = float(voltage_stress)
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _DIODE_TYPES[self.diode_type]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['diode'], self.temperature)
        pi_s = pi_stress(self.voltage_stress, exponent=2.0)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
            'pi_S': round(pi_s, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t * pi_s


_BJT_TYPES = {
    'signal': 10,
    'power': 20,
}


class Transistor_BJT(_TelcordiaPart):
    """Bipolar junction transistor.

    Parameters
    ----------
    transistor_type : str
        'signal' (10 FIT) or 'power' (20 FIT).
    power_stress : float
        Ratio of operating power to rated power (0--1).
    """

    category = 'transistor_bjt'

    def __init__(self, transistor_type='signal', power_stress=0.5, **kwargs):
        if transistor_type not in _BJT_TYPES:
            raise ValueError(
                f"transistor_type must be one of {list(_BJT_TYPES)}, "
                f"got '{transistor_type}'")
        _check_stress(power_stress, 'power_stress')
        self.transistor_type = transistor_type
        self.power_stress = float(power_stress)
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _BJT_TYPES[self.transistor_type]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['transistor'], self.temperature)
        pi_s = pi_stress(self.power_stress, exponent=2.0)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
            'pi_S': round(pi_s, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t * pi_s


_FET_TYPES = {
    'signal_mosfet': 8,
    'power_mosfet': 15,
    'jfet': 12,
}


class Transistor_FET(_TelcordiaPart):
    """Field-effect transistor (MOSFET or JFET).

    Parameters
    ----------
    fet_type : str
        'signal_mosfet' (8 FIT), 'power_mosfet' (15 FIT),
        'jfet' (12 FIT).
    """

    category = 'transistor_fet'

    def __init__(self, fet_type='signal_mosfet', **kwargs):
        if fet_type not in _FET_TYPES:
            raise ValueError(
                f"fet_type must be one of {list(_FET_TYPES)}, "
                f"got '{fet_type}'")
        self.fet_type = fet_type
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _FET_TYPES[self.fet_type]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['transistor'], self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


# ===================================================================
# Passives
# ===================================================================

_RESISTOR_TYPES = {
    'film': 1,
    'composition': 3,
    'wirewound': 5,
    'network': 2,
}


class Resistor(_TelcordiaPart):
    """Fixed resistor.

    Parameters
    ----------
    resistor_type : str
        'film' (1 FIT), 'composition' (3 FIT), 'wirewound' (5 FIT),
        'network' (2 FIT).
    power_stress : float
        Ratio of operating power to rated power (0--1).
    """

    category = 'resistor'

    def __init__(self, resistor_type='film', power_stress=0.5, **kwargs):
        if resistor_type not in _RESISTOR_TYPES:
            raise ValueError(
                f"resistor_type must be one of {list(_RESISTOR_TYPES)}, "
                f"got '{resistor_type}'")
        _check_stress(power_stress, 'power_stress')
        self.resistor_type = resistor_type
        self.power_stress = float(power_stress)
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _RESISTOR_TYPES[self.resistor_type]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['resistor'], self.temperature)
        pi_s = pi_stress(self.power_stress, exponent=2.0)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
            'pi_S': round(pi_s, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t * pi_s


_CAPACITOR_TYPES = {
    'ceramic': 5,
    'tantalum_solid': 10,
    'aluminum': 20,
    'film': 3,
    'mica': 2,
}


class Capacitor(_TelcordiaPart):
    """Fixed capacitor.

    Parameters
    ----------
    capacitor_type : str
        'ceramic' (5 FIT), 'tantalum_solid' (10 FIT),
        'aluminum' (20 FIT), 'film' (3 FIT), 'mica' (2 FIT).
    voltage_stress : float
        Ratio of applied voltage to rated voltage (0--1).
    """

    category = 'capacitor'

    def __init__(self, capacitor_type='ceramic', voltage_stress=0.5,
                 **kwargs):
        if capacitor_type not in _CAPACITOR_TYPES:
            raise ValueError(
                f"capacitor_type must be one of {list(_CAPACITOR_TYPES)}, "
                f"got '{capacitor_type}'")
        _check_stress(voltage_stress, 'voltage_stress')
        self.capacitor_type = capacitor_type
        self.voltage_stress = float(voltage_stress)
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _CAPACITOR_TYPES[self.capacitor_type]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        # Select the appropriate Ea for the capacitor technology
        ea_key = {
            'ceramic': 'capacitor_ceramic',
            'tantalum_solid': 'capacitor_tantalum',
            'aluminum': 'capacitor_aluminum',
            'film': 'capacitor_film',
            'mica': 'capacitor_film',  # mica uses same Ea as film
        }[self.capacitor_type]
        pi_t = pi_temperature(DEFAULT_EA[ea_key], self.temperature)
        pi_s = pi_stress(self.voltage_stress, exponent=2.0)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
            'pi_S': round(pi_s, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t * pi_s


# ===================================================================
# Magnetics
# ===================================================================


class Inductor(_TelcordiaPart):
    """Fixed inductor / choke.

    Base rate: 5 FIT.
    """

    category = 'inductor'

    def _compute(self):
        base_fit = 5
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['inductor'], self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


_TRANSFORMER_TYPES = {
    'signal': 10,
    'power': 20,
}


class Transformer(_TelcordiaPart):
    """Signal or power transformer.

    Parameters
    ----------
    transformer_type : str
        'signal' (10 FIT) or 'power' (20 FIT).
    """

    category = 'transformer'

    def __init__(self, transformer_type='signal', **kwargs):
        if transformer_type not in _TRANSFORMER_TYPES:
            raise ValueError(
                f"transformer_type must be one of "
                f"{list(_TRANSFORMER_TYPES)}, got '{transformer_type}'")
        self.transformer_type = transformer_type
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _TRANSFORMER_TYPES[self.transformer_type]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['transformer'], self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


# ===================================================================
# Electromechanical
# ===================================================================

_RELAY_TYPES = {
    'general_purpose': 100,
    'solid_state': 50,
}


class Relay(_TelcordiaPart):
    """Relay (electromechanical or solid-state).

    Parameters
    ----------
    relay_type : str
        'general_purpose' (100 FIT) or 'solid_state' (50 FIT).
    cycling_rate : float
        Cycling-rate factor piCYC.  1.0 for <= 1 cycle/hr,
        proportional above that (e.g. 10 for 10 cycles/hr).
    """

    category = 'relay'

    def __init__(self, relay_type='general_purpose', cycling_rate=1.0,
                 **kwargs):
        if relay_type not in _RELAY_TYPES:
            raise ValueError(
                f"relay_type must be one of {list(_RELAY_TYPES)}, "
                f"got '{relay_type}'")
        if cycling_rate <= 0:
            raise ValueError("cycling_rate must be > 0")
        self.relay_type = relay_type
        self.cycling_rate = float(cycling_rate)
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = _RELAY_TYPES[self.relay_type]
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['relay'], self.temperature)
        pi_cyc = max(1.0, self.cycling_rate)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
            'pi_CYC': round(pi_cyc, 4),
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t * pi_cyc


class Switch(_TelcordiaPart):
    """Toggle, pushbutton, or rotary switch.

    Base rate: 50 FIT.  Factors: piQ, piE only (temperature is not a
    major driver for mechanical switches at commercial stress levels).
    """

    category = 'switch'

    def _compute(self):
        base_fit = 50
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
        }
        self._failure_rate = base_fpmh * pi_q * pi_e


# ===================================================================
# Interconnects
# ===================================================================


class Connector(_TelcordiaPart):
    """Multi-pin connector.

    Base rate: 2 FIT per contact pair (pin).  Total base rate is
    2 * pins FIT.

    Parameters
    ----------
    pins : int
        Number of contact pairs.
    """

    category = 'connector'

    def __init__(self, pins=10, **kwargs):
        if pins < 1:
            raise ValueError("pins must be >= 1")
        self.pins = int(pins)
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = 2 * self.pins
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        pi_t = pi_temperature(DEFAULT_EA['connector'], self.temperature)
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'pi_T': round(pi_t, 6),
            'pins': self.pins,
        }
        self._failure_rate = base_fpmh * pi_q * pi_e * pi_t


class Crystal(_TelcordiaPart):
    """Quartz crystal oscillator / resonator.

    Base rate: 20 FIT.
    """

    category = 'crystal'

    def _compute(self):
        base_fit = 20
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
        }
        self._failure_rate = base_fpmh * pi_q * pi_e


class Fuse(_TelcordiaPart):
    """Cartridge or blade fuse.

    Base rate: 10 FIT.  Only piE is applied (quality is not a
    differentiator for fuses).
    """

    category = 'fuse'

    def _compute(self):
        base_fit = 10
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_e = PI_E[self.environment]
        self._pi_factors = {
            'lambda_b_FIT': base_fit,
            'lambda_b': round(base_fpmh, 6),
            'pi_E': pi_e,
        }
        self._failure_rate = base_fpmh * pi_e


class PCB(_TelcordiaPart):
    """Printed circuit board.

    Base rate: 1 FIT per layer per square inch (simplified model).

    Parameters
    ----------
    layers : int
        Number of copper layers.
    area_sqin : float
        Board area in square inches.
    """

    category = 'pcb'

    def __init__(self, layers=4, area_sqin=20.0, **kwargs):
        if layers < 1:
            raise ValueError("layers must be >= 1")
        if area_sqin <= 0:
            raise ValueError("area_sqin must be > 0")
        self.layers = int(layers)
        self.area_sqin = float(area_sqin)
        super().__init__(**kwargs)

    def _compute(self):
        base_fit = 1 * self.layers * self.area_sqin
        base_fpmh = _fit_to_fpmh(base_fit)
        pi_q = PI_Q[self.quality]
        pi_e = PI_E[self.environment]
        self._pi_factors = {
            'lambda_b_FIT': round(base_fit, 4),
            'lambda_b': round(base_fpmh, 6),
            'pi_Q': pi_q, 'pi_E': pi_e,
            'layers': self.layers,
            'area_sqin': self.area_sqin,
        }
        self._failure_rate = base_fpmh * pi_q * pi_e


# ===================================================================
# Generic part and system rollup
# ===================================================================


class GenericPart(_TelcordiaPart):
    """A part with a user-supplied failure rate in FPMH."""

    category = 'generic'

    def __init__(self, failure_rate, name='', quantity=1, **kwargs):
        if failure_rate < 0:
            raise ValueError("failure_rate must be >= 0")
        self._user_failure_rate = float(failure_rate)
        # GenericPart does not use environment/quality/temperature,
        # so provide safe defaults and skip validation in super.
        super().__init__(name=name, quantity=quantity,
                         environment='GC', quality='commercial',
                         temperature=40.0)

    def _compute(self):
        self._failure_rate = self._user_failure_rate
        self._pi_factors = {}


class SystemFailureRate:
    """Series-system rollup of a SR-332 parts list.

    Attributes
    ----------
    total_failure_rate : float
        Sum of part failure rates x quantities, FPMH.
    mtbf : float
        Mean time between failures, hours (1e6 / total_failure_rate).
    """

    def __init__(self, parts):
        if not parts:
            raise ValueError("parts list must not be empty")
        self.parts = list(parts)
        self.total_failure_rate = float(
            sum(p.total_failure_rate for p in self.parts))
        self.mtbf = (math.inf if self.total_failure_rate == 0
                     else 1e6 / self.total_failure_rate)

    def reliability(self, t_hours):
        """Mission reliability R(t) = exp(-lambda * t).

        Parameters
        ----------
        t_hours : float
            Mission time in hours.

        Returns
        -------
        float
            Reliability at time t.
        """
        return math.exp(-self.total_failure_rate * t_hours / 1e6)

    @property
    def results(self):
        """Per-part breakdown with contribution fractions."""
        rows = []
        for p in self.parts:
            contribution = (p.total_failure_rate / self.total_failure_rate
                            if self.total_failure_rate > 0 else 0.0)
            rows.append({
                'name': p.name, 'category': p.category,
                'quantity': p.quantity,
                'failure_rate': round(p.failure_rate, 6),
                'total_failure_rate': round(p.total_failure_rate, 6),
                'contribution': round(contribution, 4),
                'pi_factors': p.pi_factors,
            })
        return rows

    def __repr__(self):
        return (f"SystemFailureRate(total={self.total_failure_rate:.4f} FPMH, "
                f"MTBF={self.mtbf:.1f} h, parts={len(self.parts)})")
