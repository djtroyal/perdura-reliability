"""217Plus (RIAC) Reliability Prediction Models.

Implements the 217Plus methodology for failure rate prediction,
the modernized successor to MIL-HDBK-217F.

Failure rates in FPMH (Failures Per Million Hours).

This module is a screening proxy, not a conforming implementation of the
licensed 217Plus handbook/database. See ``reliability.Standards``.
"""

import math
from typing import Optional

# ===================================================================
# Constants
# ===================================================================

ENVIRONMENTS = ['GB', 'GF', 'GM', 'NS', 'NU', 'AIC', 'AIF', 'AUC', 'AUF', 'ARW', 'SF', 'MF', 'ML', 'CL']

ENVIRONMENT_DESCRIPTIONS = {
    'GB': 'Ground, Benign',
    'GF': 'Ground, Fixed',
    'GM': 'Ground, Mobile',
    'NS': 'Naval, Sheltered',
    'NU': 'Naval, Unsheltered',
    'AIC': 'Airborne, Inhabited, Cargo',
    'AIF': 'Airborne, Inhabited, Fighter',
    'AUC': 'Airborne, Uninhabited, Cargo',
    'AUF': 'Airborne, Uninhabited, Fighter',
    'ARW': 'Airborne, Rotary Wing',
    'SF': 'Space, Flight',
    'MF': 'Missile, Flight',
    'ML': 'Missile, Launch',
    'CL': 'Cannon, Launch',
}

# 217Plus environment factors (based on RIAC data)
PI_E = {
    'GB': 1.0, 'GF': 2.0, 'GM': 5.0, 'NS': 4.0, 'NU': 6.0,
    'AIC': 4.0, 'AIF': 6.0, 'AUC': 5.0, 'AUF': 8.0, 'ARW': 8.0,
    'SF': 0.5, 'MF': 12.0, 'ML': 16.0, 'CL': 20.0,
}

# Process Grade levels (1=best to 4=worst)
PROCESS_GRADES = {
    1: {'name': 'Best Practice', 'factor': 0.25, 'description': 'Full MIL-spec processes, extensive screening'},
    2: {'name': 'Above Average', 'factor': 0.50, 'description': 'Good commercial practices, some screening'},
    3: {'name': 'Average', 'factor': 1.00, 'description': 'Standard commercial practices'},
    4: {'name': 'Below Average', 'factor': 2.00, 'description': 'Minimal quality controls'},
}

K_BOLTZMANN = 8.617e-5  # eV/K


# ===================================================================
# Helper functions
# ===================================================================

def pi_temperature(Ea, T_operating, T_ref=40.0):
    """Arrhenius temperature acceleration factor.

    Parameters
    ----------
    Ea : float
        Activation energy in eV.
    T_operating : float
        Operating temperature in degrees Celsius.
    T_ref : float
        Reference temperature in degrees Celsius (default 40.0).

    Returns
    -------
    float
        Temperature acceleration factor pi_T.
    """
    T_op_K = T_operating + 273.15
    T_ref_K = T_ref + 273.15
    return math.exp((Ea / K_BOLTZMANN) * (1.0 / T_ref_K - 1.0 / T_op_K))


def pi_process_grade(grade=3):
    """Return process grade multiplier for the given grade level.

    Parameters
    ----------
    grade : int
        Process grade level (1=Best Practice, 2=Above Average,
        3=Average, 4=Below Average).

    Returns
    -------
    float
        Process grade factor.
    """
    return PROCESS_GRADES.get(grade, PROCESS_GRADES[3])['factor']


def pi_duty_cycle(dc=1.0):
    """Duty cycle factor. dc=1.0 for continuous, 0.0 for non-operating."""
    return max(0.1, dc)


def pi_cycling(cycles_per_hour=0.0, base_rate=1.0):
    """Cycling/power-on stress factor."""
    if cycles_per_hour <= 0:
        return 1.0
    return 1.0 + 0.1 * cycles_per_hour


# ===================================================================
# Base class
# ===================================================================

class _Part217Plus:
    """Base class for 217Plus parts."""

    category = 'part'

    def __init__(self, name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        if quantity < 1 or int(quantity) != quantity:
            raise ValueError("quantity must be a positive integer")
        if environment not in ENVIRONMENTS:
            raise ValueError(f"environment must be one of {ENVIRONMENTS}, got '{environment}'")
        if process_grade not in PROCESS_GRADES:
            raise ValueError(f"process_grade must be 1, 2, 3, or 4, got {process_grade}")
        if not 0.0 <= duty_cycle <= 1.0:
            raise ValueError(f"duty_cycle must be between 0 and 1, got {duty_cycle}")

        self.name = name or self.__class__.__name__
        self.quantity = int(quantity)
        self.environment = environment
        self.temperature = float(temperature)
        self.process_grade = int(process_grade)
        self.duty_cycle = float(duty_cycle)
        self._base_failure_rate = 0.0
        self.pi_factors = {}

    @property
    def failure_rate(self):
        return self._base_failure_rate

    @failure_rate.setter
    def failure_rate(self, value):
        self._base_failure_rate = float(value)

    @property
    def total_failure_rate(self):
        return self.failure_rate * self.quantity

    def __repr__(self):
        return (f"{self.__class__.__name__}(name='{self.name}', "
                f"failure_rate={self.failure_rate:.6f} FPMH, "
                f"quantity={self.quantity})")


# ===================================================================
# Part classes
# ===================================================================

# --- Microcircuit ---

_MICROCIRCUIT_BASE_RATES = {
    'digital': 0.010,
    'linear': 0.008,
    'memory': 0.012,
    'microprocessor': 0.015,
    'fpga': 0.020,
}

_MICROCIRCUIT_EA = {
    'digital': 0.35,
    'linear': 0.60,
    'memory': 0.40,
    'microprocessor': 0.45,
    'fpga': 0.35,
}


class Microcircuit(_Part217Plus):
    """217Plus microcircuit prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG * pi_DC

    where:
        lambda_base = field-data-derived base rate for the device type
        pi_T = Arrhenius temperature factor using device-specific Ea
        pi_E = environment factor
        pi_PG = process grade factor
        pi_DC = duty cycle factor

    Parameters
    ----------
    device_type : str
        One of 'digital', 'linear', 'memory', 'microprocessor', 'fpga'.
    complexity : int
        Gate/transistor count (informational; stored but does not affect
        the simplified 217Plus base rate).
    package : str
        Package type, e.g. 'nonhermetic', 'hermetic' (informational).
    technology : str
        Technology node, e.g. 'cmos', 'bipolar' (informational).
    """

    category = 'microcircuit'

    def __init__(self, device_type='digital', complexity=1000,
                 package='nonhermetic', technology='cmos',
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if device_type not in _MICROCIRCUIT_BASE_RATES:
            raise ValueError(
                f"device_type must be one of {list(_MICROCIRCUIT_BASE_RATES)}, "
                f"got '{device_type}'")
        if complexity < 1:
            raise ValueError(f"complexity must be >= 1, got {complexity}")

        self.device_type = device_type
        self.complexity = int(complexity)
        self.package = package
        self.technology = technology

        lambda_base = _MICROCIRCUIT_BASE_RATES[device_type]
        Ea = _MICROCIRCUIT_EA[device_type]

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)
        pi_DC = pi_duty_cycle(self.duty_cycle)

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
            'pi_DC': round(pi_DC, 6),
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG * pi_DC


# --- Discrete Semiconductor ---

_SEMICONDUCTOR_BASE_RATES = {
    'diode': 0.003,
    'bjt': 0.005,
    'mosfet': 0.004,
    'jfet': 0.003,
    'thyristor': 0.008,
    'optoelectronic': 0.010,
}

_SEMICONDUCTOR_EA = {
    'diode': 0.31,
    'bjt': 0.50,
    'mosfet': 0.40,
    'jfet': 0.35,
    'thyristor': 0.45,
    'optoelectronic': 0.38,
}


class Discrete_Semiconductor(_Part217Plus):
    """217Plus discrete semiconductor prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG * pi_S

    where:
        lambda_base = field-data-derived base rate for the sub-type
        pi_T = Arrhenius temperature factor using sub-type-specific Ea
        pi_E = environment factor
        pi_PG = process grade factor
        pi_S = voltage stress factor (V_stress^2 if > 0.3, else 0.09)

    Note: No duty cycle factor -- semiconductors are always on when
    the system is powered.

    Parameters
    ----------
    sub_type : str
        One of 'diode', 'bjt', 'mosfet', 'jfet', 'thyristor',
        'optoelectronic'.
    voltage_stress : float
        Ratio of operating voltage to rated voltage (0-1, default 0.5).
    """

    category = 'semiconductor'

    def __init__(self, sub_type='diode', voltage_stress=0.5,
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if sub_type not in _SEMICONDUCTOR_BASE_RATES:
            raise ValueError(
                f"sub_type must be one of {list(_SEMICONDUCTOR_BASE_RATES)}, "
                f"got '{sub_type}'")
        if not 0.0 <= voltage_stress <= 1.0:
            raise ValueError(
                f"voltage_stress must be between 0 and 1, got {voltage_stress}")

        self.sub_type = sub_type
        self.voltage_stress = float(voltage_stress)

        lambda_base = _SEMICONDUCTOR_BASE_RATES[sub_type]
        Ea = _SEMICONDUCTOR_EA[sub_type]

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)
        pi_S = voltage_stress ** 2 if voltage_stress > 0.3 else 0.09

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
            'pi_S': round(pi_S, 6),
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG * pi_S


# --- Resistor ---

_RESISTOR_BASE_RATES = {
    'film': 0.0005,
    'composition': 0.001,
    'wirewound': 0.002,
    'network': 0.0008,
}


class Resistor(_Part217Plus):
    """217Plus resistor prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG * pi_S

    where:
        lambda_base = field-data-derived base rate for the style
        pi_T = Arrhenius temperature factor (Ea = 0.20 for all styles)
        pi_E = environment factor
        pi_PG = process grade factor
        pi_S = power stress factor = 0.5 * exp(2.0 * power_stress)

    Parameters
    ----------
    style : str
        One of 'film', 'composition', 'wirewound', 'network'.
    power_stress : float
        Ratio of operating power to rated power (0-1, default 0.5).
    """

    category = 'resistor'

    def __init__(self, style='film', power_stress=0.5,
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if style not in _RESISTOR_BASE_RATES:
            raise ValueError(
                f"style must be one of {list(_RESISTOR_BASE_RATES)}, "
                f"got '{style}'")
        if not 0.0 <= power_stress <= 1.0:
            raise ValueError(
                f"power_stress must be between 0 and 1, got {power_stress}")

        self.style = style
        self.power_stress = float(power_stress)

        lambda_base = _RESISTOR_BASE_RATES[style]
        Ea = 0.20

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)
        pi_S = 0.5 * math.exp(2.0 * power_stress)

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
            'pi_S': round(pi_S, 6),
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG * pi_S


# --- Capacitor ---

_CAPACITOR_BASE_RATES = {
    'ceramic': 0.002,
    'tantalum': 0.005,
    'aluminum_electrolytic': 0.010,
    'film': 0.001,
    'mica': 0.001,
}

_CAPACITOR_EA = {
    'ceramic': 0.35,
    'tantalum': 0.15,
    'aluminum_electrolytic': 0.40,
    'film': 0.20,
    'mica': 0.25,
}


class Capacitor(_Part217Plus):
    """217Plus capacitor prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG * pi_S

    where:
        lambda_base = field-data-derived base rate for the style
        pi_T = Arrhenius temperature factor using style-specific Ea
        pi_E = environment factor
        pi_PG = process grade factor
        pi_S = voltage stress factor = (voltage_stress / 0.6)^3 + 1.0

    Parameters
    ----------
    style : str
        One of 'ceramic', 'tantalum', 'aluminum_electrolytic', 'film',
        'mica'.
    voltage_stress : float
        Ratio of operating voltage to rated voltage (0-1, default 0.5).
    """

    category = 'capacitor'

    def __init__(self, style='ceramic', voltage_stress=0.5,
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if style not in _CAPACITOR_BASE_RATES:
            raise ValueError(
                f"style must be one of {list(_CAPACITOR_BASE_RATES)}, "
                f"got '{style}'")
        if not 0.0 <= voltage_stress <= 1.0:
            raise ValueError(
                f"voltage_stress must be between 0 and 1, got {voltage_stress}")

        self.style = style
        self.voltage_stress = float(voltage_stress)

        lambda_base = _CAPACITOR_BASE_RATES[style]
        Ea = _CAPACITOR_EA[style]

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)
        pi_S = (voltage_stress / 0.6) ** 3 + 1.0

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
            'pi_S': round(pi_S, 6),
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG * pi_S


# --- Inductor ---

_INDUCTOR_BASE_RATES = {
    'inductor': 0.003,
    'transformer': 0.005,
}


class Inductor(_Part217Plus):
    """217Plus inductor/transformer prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG

    where:
        lambda_base = field-data-derived base rate for the device type
        pi_T = Arrhenius temperature factor (Ea = 0.15)
        pi_E = environment factor
        pi_PG = process grade factor

    Parameters
    ----------
    device : str
        One of 'inductor', 'transformer'.
    """

    category = 'inductor'

    def __init__(self, device='inductor',
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if device not in _INDUCTOR_BASE_RATES:
            raise ValueError(
                f"device must be one of {list(_INDUCTOR_BASE_RATES)}, "
                f"got '{device}'")

        self.device = device

        lambda_base = _INDUCTOR_BASE_RATES[device]
        Ea = 0.15

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG


# --- Relay ---

class Relay(_Part217Plus):
    """217Plus relay prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG * pi_CYC

    where:
        lambda_base = 0.050 FPMH
        pi_T = Arrhenius temperature factor (Ea = 0.15)
        pi_E = environment factor
        pi_PG = process grade factor
        pi_CYC = cycling stress factor

    Parameters
    ----------
    cycles_per_hour : float
        Average number of relay actuations per hour (default 0.0).
    """

    category = 'relay'

    def __init__(self, cycles_per_hour=0.0,
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if cycles_per_hour < 0:
            raise ValueError(
                f"cycles_per_hour must be >= 0, got {cycles_per_hour}")

        self.cycles_per_hour = float(cycles_per_hour)

        lambda_base = 0.050
        Ea = 0.15

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)
        pi_CYC = pi_cycling(cycles_per_hour)

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
            'pi_CYC': round(pi_CYC, 6),
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG * pi_CYC


# --- Switch ---

class Switch(_Part217Plus):
    """217Plus switch prediction.

    lambda_p = lambda_base * pi_E * pi_PG * pi_CYC

    where:
        lambda_base = 0.020 FPMH
        pi_E = environment factor
        pi_PG = process grade factor
        pi_CYC = cycling stress factor

    Note: No temperature factor for switches.

    Parameters
    ----------
    cycles_per_hour : float
        Average number of switch actuations per hour (default 0.0).
    """

    category = 'switch'

    def __init__(self, cycles_per_hour=0.0,
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if cycles_per_hour < 0:
            raise ValueError(
                f"cycles_per_hour must be >= 0, got {cycles_per_hour}")

        self.cycles_per_hour = float(cycles_per_hour)

        lambda_base = 0.020

        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)
        pi_CYC = pi_cycling(cycles_per_hour)

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_E': pi_env,
            'pi_PG': pi_PG,
            'pi_CYC': round(pi_CYC, 6),
        }
        self.failure_rate = lambda_base * pi_env * pi_PG * pi_CYC


# --- Connector ---

class Connector(_Part217Plus):
    """217Plus connector prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG

    where:
        lambda_base = 0.001 * pins (FPMH)
        pi_T = Arrhenius temperature factor (Ea = 0.10)
        pi_E = environment factor
        pi_PG = process grade factor

    Parameters
    ----------
    pins : int
        Number of connector pins (default 10).
    """

    category = 'connector'

    def __init__(self, pins=10,
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if pins < 1 or int(pins) != pins:
            raise ValueError(f"pins must be a positive integer, got {pins}")

        self.pins = int(pins)

        lambda_base = 0.001 * self.pins
        Ea = 0.10

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)

        self.pi_factors = {
            'lambda_base': round(lambda_base, 6),
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG


# --- PCB ---

class PCB(_Part217Plus):
    """217Plus printed circuit board prediction.

    lambda_p = lambda_base * pi_E * pi_PG

    where:
        lambda_base = 0.001 * layers * complexity_factor (FPMH)
        pi_E = environment factor
        pi_PG = process grade factor

    Note: No temperature factor for PCBs.

    Parameters
    ----------
    layers : int
        Number of board layers (default 4).
    complexity_factor : float
        Complexity multiplier (default 1.0).
    """

    category = 'pcb'

    def __init__(self, layers=4, complexity_factor=1.0,
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if layers < 1 or int(layers) != layers:
            raise ValueError(f"layers must be a positive integer, got {layers}")
        if complexity_factor <= 0:
            raise ValueError(
                f"complexity_factor must be > 0, got {complexity_factor}")

        self.layers = int(layers)
        self.complexity_factor = float(complexity_factor)

        lambda_base = 0.001 * self.layers * self.complexity_factor

        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)

        self.pi_factors = {
            'lambda_base': round(lambda_base, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
        }
        self.failure_rate = lambda_base * pi_env * pi_PG


# --- Crystal ---

class Crystal(_Part217Plus):
    """217Plus quartz crystal prediction.

    lambda_p = lambda_base * pi_E * pi_PG

    where:
        lambda_base = 0.005 FPMH
        pi_E = environment factor
        pi_PG = process grade factor

    Note: No temperature factor for crystals.
    """

    category = 'crystal'

    def __init__(self, name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        lambda_base = 0.005

        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_E': pi_env,
            'pi_PG': pi_PG,
        }
        self.failure_rate = lambda_base * pi_env * pi_PG


# --- Fuse ---

class Fuse(_Part217Plus):
    """217Plus fuse prediction.

    lambda_p = lambda_base * pi_E

    where:
        lambda_base = 0.005 FPMH
        pi_E = environment factor

    Note: Only environment factor applies to fuses.
    """

    category = 'fuse'

    def __init__(self, name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        lambda_base = 0.005

        pi_env = PI_E[self.environment]

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_E': pi_env,
        }
        self.failure_rate = lambda_base * pi_env


# --- Rotating ---

_ROTATING_BASE_RATES = {
    'motor': 2.0,
    'fan_blower': 1.0,
}


class Rotating(_Part217Plus):
    """217Plus rotating device (motor/fan) prediction.

    lambda_p = lambda_base * pi_T * pi_E * pi_PG

    where:
        lambda_base = field-data-derived base rate for the device type
        pi_T = Arrhenius temperature factor (Ea = 0.20)
        pi_E = environment factor
        pi_PG = process grade factor

    Parameters
    ----------
    device : str
        One of 'motor', 'fan_blower'.
    """

    category = 'rotating'

    def __init__(self, device='motor',
                 name=None, quantity=1, environment='GB',
                 temperature=40.0, process_grade=3, duty_cycle=1.0, **kwargs):
        super().__init__(name=name, quantity=quantity, environment=environment,
                         temperature=temperature, process_grade=process_grade,
                         duty_cycle=duty_cycle, **kwargs)

        if device not in _ROTATING_BASE_RATES:
            raise ValueError(
                f"device must be one of {list(_ROTATING_BASE_RATES)}, "
                f"got '{device}'")

        self.device = device

        lambda_base = _ROTATING_BASE_RATES[device]
        Ea = 0.20

        pi_T = pi_temperature(Ea, self.temperature)
        pi_env = PI_E[self.environment]
        pi_PG = pi_process_grade(self.process_grade)

        self.pi_factors = {
            'lambda_base': lambda_base,
            'pi_T': round(pi_T, 6),
            'pi_E': pi_env,
            'pi_PG': pi_PG,
        }
        self.failure_rate = lambda_base * pi_T * pi_env * pi_PG


# ===================================================================
# System rollup
# ===================================================================

class SystemFailureRate:
    """Series-system rollup of a 217Plus parts list."""

    def __init__(self, parts):
        if not parts:
            raise ValueError("parts list must not be empty")
        self.parts = list(parts)
        self.total_failure_rate = float(
            sum(p.total_failure_rate for p in self.parts))
        self.mtbf = (float('inf') if self.total_failure_rate == 0
                     else 1e6 / self.total_failure_rate)

    def reliability(self, t_hours):
        """Mission reliability R(t) = exp(-lambda * t)."""
        return math.exp(-self.total_failure_rate * t_hours / 1e6)

    @property
    def results(self):
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
