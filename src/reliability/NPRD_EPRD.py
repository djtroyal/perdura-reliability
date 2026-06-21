"""NPRD / EPRD empirical reliability prediction.

Implements the data-driven (empirical) failure-rate prediction approach of the
Quanterion / RIAC databases:

- **EPRD** (Electronic Parts Reliability Data) -- field-experience failure
  rates for electronic components (capacitors, resistors, diodes,
  transistors, microcircuits, optoelectronics, inductors, relays, connectors,
  switches).
- **NPRD** (Nonelectronic Parts Reliability Data, -2016 / -2023) -- field
  experience failure rates for mechanical, electromechanical and
  nonelectronic parts (motors, pumps, valves, actuators, bearings, gears,
  fans/blowers, batteries, filters, sensors, switches, relays, connectors and
  a generic catch-all).

Unlike the stress-based models (MIL-HDBK-217F, Telcordia, FIDES, 217Plus) the
RIAC databases report *observed* failure rates aggregated from fielded
equipment.  A prediction therefore reduces to a table look-up of a base
failure rate for the part type, adjusted by an environment factor and a
quality / data-quality factor:

.. math::
    \\lambda = \\lambda_{base} \\times \\pi_E \\times \\pi_Q

All failure rates are expressed in **FPMH** (failures per 10^6 hours) for
consistency with the rest of the suite.

The base rates here are representative averages distilled from the published
NPRD-2016 / EPRD-2014 summaries.  They are intended for engineering estimates
and trade studies; for contractual predictions consult the source databases
directly for the specific part, environment and data-source records.

References: Quanterion NPRD-2016 / NPRD-2023, EPRD-2014.
"""

import math
from typing import Optional

FPMH = "failures per 10^6 hours"

STANDARDS = ('NPRD-2023', 'EPRD-2014')

# =====================================================================
# Environments (RIAC operational-environment set; codes mirror the
# MIL-HDBK-217F families so cross-standard mapping stays sensible).
# =====================================================================

ENVIRONMENTS = ['GB', 'GF', 'GM', 'NS', 'NU', 'AIC', 'AIF', 'ARW', 'SF', 'MF', 'CL']

ENVIRONMENT_DESCRIPTIONS = {
    'GB': 'Ground, Benign (controlled environment)',
    'GF': 'Ground, Fixed (sheltered)',
    'GM': 'Ground, Mobile',
    'NS': 'Naval, Sheltered',
    'NU': 'Naval, Unsheltered',
    'AIC': 'Airborne, Inhabited, Cargo',
    'AIF': 'Airborne, Inhabited, Fighter',
    'ARW': 'Airborne, Rotary Wing',
    'SF': 'Space, Flight',
    'MF': 'Missile, Flight',
    'CL': 'Cannon, Launch',
}

# Environment multipliers (relative to Ground Benign = 1.0).  Empirical
# ratios consistent with field-data environment severity.
PI_E = {
    'GB': 1.0, 'GF': 2.5, 'GM': 8.0,
    'NS': 5.0, 'NU': 11.0,
    'AIC': 6.0, 'AIF': 9.0, 'ARW': 13.0,
    'SF': 0.6, 'MF': 16.0, 'CL': 24.0,
}

# =====================================================================
# Quality / data-source confidence levels
# =====================================================================

QUALITY_LEVELS = ['high', 'commercial', 'unknown', 'lower']

PI_Q = {
    'high': 0.5,        # screened / high-reliability sourcing
    'commercial': 1.0,  # standard commercial grade (nominal database value)
    'unknown': 1.5,     # unknown provenance
    'lower': 3.0,       # lower grade / harsh field experience
}


def _check_environment(environment):
    if environment not in ENVIRONMENTS:
        raise ValueError(
            f"environment must be one of {ENVIRONMENTS}, got '{environment}'")


def _check_quality(quality):
    if quality not in QUALITY_LEVELS:
        raise ValueError(
            f"quality must be one of {QUALITY_LEVELS}, got '{quality}'")


# =====================================================================
# Base class
# =====================================================================


class _RIACPart:
    """Base class for empirical (NPRD/EPRD) part models."""

    category = 'generic'
    family = 'NPRD'          # 'EPRD' or 'NPRD'
    _BASE_RATES: dict = {}    # subtype -> base FPMH (overridden by subclass)
    _subtype_param = 'part_type'

    def __init__(self, part_type, name=None, quantity=1,
                 environment='GB', quality='commercial', **kwargs):
        if quantity < 1 or int(quantity) != quantity:
            raise ValueError("quantity must be a positive integer")
        _check_environment(environment)
        _check_quality(quality)
        if part_type not in self._BASE_RATES:
            raise ValueError(
                f"{self._subtype_param} must be one of "
                f"{list(self._BASE_RATES)}, got '{part_type}'")

        self.name = name or self.__class__.__name__
        self.quantity = int(quantity)
        self.environment = environment
        self.quality = quality
        self.part_type = part_type
        self._pi_factors: dict = {}
        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = self._BASE_RATES[self.part_type]
        pi_e = PI_E[self.environment]
        pi_q = PI_Q[self.quality]
        self._pi_factors = {
            'lambda_base': round(lambda_base, 6),
            'pi_E': round(pi_e, 4),
            'pi_Q': round(pi_q, 4),
        }
        return lambda_base * pi_e * pi_q

    @property
    def failure_rate(self) -> float:
        return self._failure_rate

    @property
    def total_failure_rate(self) -> float:
        return self._failure_rate * self.quantity

    @property
    def pi_factors(self) -> dict:
        return dict(self._pi_factors)

    def __repr__(self):
        return (f"{self.__class__.__name__}(name='{self.name}', "
                f"failure_rate={self.failure_rate:.6f} FPMH, "
                f"quantity={self.quantity})")


# =====================================================================
# EPRD -- Electronic Parts Reliability Data
# =====================================================================


class EPRD_Capacitor(_RIACPart):
    """EPRD empirical failure rate for a capacitor."""
    category = 'eprd_capacitor'
    family = 'EPRD'
    _subtype_param = 'cap_type'
    _BASE_RATES = {
        'ceramic': 0.0010,
        'ceramic_chip': 0.0007,
        'tantalum_solid': 0.0030,
        'tantalum_wet': 0.0050,
        'aluminum_electrolytic': 0.0120,
        'film': 0.0015,
        'mica': 0.0008,
        'glass': 0.0009,
        'variable': 0.0200,
    }

    def __init__(self, cap_type='ceramic', **kwargs):
        super().__init__(part_type=cap_type, **kwargs)


class EPRD_Resistor(_RIACPart):
    """EPRD empirical failure rate for a resistor."""
    category = 'eprd_resistor'
    family = 'EPRD'
    _subtype_param = 'resistor_type'
    _BASE_RATES = {
        'film': 0.0005,
        'composition': 0.0010,
        'wirewound': 0.0030,
        'wirewound_power': 0.0080,
        'network': 0.0015,
        'chip': 0.0004,
        'variable': 0.0200,
        'thermistor': 0.0040,
    }

    def __init__(self, resistor_type='film', **kwargs):
        super().__init__(part_type=resistor_type, **kwargs)


class EPRD_Inductor(_RIACPart):
    """EPRD empirical failure rate for an inductor/transformer."""
    category = 'eprd_inductor'
    family = 'EPRD'
    _subtype_param = 'inductor_type'
    _BASE_RATES = {
        'fixed': 0.0020,
        'rf_coil': 0.0015,
        'power_transformer': 0.0090,
        'pulse_transformer': 0.0040,
        'audio_transformer': 0.0035,
        'choke': 0.0025,
    }

    def __init__(self, inductor_type='fixed', **kwargs):
        super().__init__(part_type=inductor_type, **kwargs)


class EPRD_Diode(_RIACPart):
    """EPRD empirical failure rate for a diode."""
    category = 'eprd_diode'
    family = 'EPRD'
    _subtype_param = 'diode_type'
    _BASE_RATES = {
        'signal': 0.0008,
        'rectifier': 0.0015,
        'zener': 0.0020,
        'schottky': 0.0012,
        'power': 0.0040,
        'transient_suppressor': 0.0030,
    }

    def __init__(self, diode_type='signal', **kwargs):
        super().__init__(part_type=diode_type, **kwargs)


class EPRD_Transistor(_RIACPart):
    """EPRD empirical failure rate for a transistor."""
    category = 'eprd_transistor'
    family = 'EPRD'
    _subtype_param = 'transistor_type'
    _BASE_RATES = {
        'bjt_signal': 0.0015,
        'bjt_power': 0.0060,
        'fet_signal': 0.0018,
        'fet_power': 0.0070,
        'mosfet': 0.0050,
        'igbt': 0.0090,
    }

    def __init__(self, transistor_type='bjt_signal', **kwargs):
        super().__init__(part_type=transistor_type, **kwargs)


class EPRD_Microcircuit(_RIACPart):
    """EPRD empirical failure rate for an integrated circuit."""
    category = 'eprd_microcircuit'
    family = 'EPRD'
    _subtype_param = 'ic_type'
    _BASE_RATES = {
        'digital_logic': 0.0050,
        'linear': 0.0060,
        'memory': 0.0150,
        'microprocessor': 0.0250,
        'mixed_signal': 0.0120,
        'fpga': 0.0300,
        'hybrid': 0.0400,
    }

    def __init__(self, ic_type='digital_logic', **kwargs):
        super().__init__(part_type=ic_type, **kwargs)


class EPRD_Optoelectronic(_RIACPart):
    """EPRD empirical failure rate for an optoelectronic device."""
    category = 'eprd_optoelectronic'
    family = 'EPRD'
    _subtype_param = 'opto_type'
    _BASE_RATES = {
        'led': 0.0030,
        'photodiode': 0.0040,
        'phototransistor': 0.0050,
        'optocoupler': 0.0080,
        'laser_diode': 0.0250,
        'display': 0.0200,
    }

    def __init__(self, opto_type='led', **kwargs):
        super().__init__(part_type=opto_type, **kwargs)


class EPRD_Relay(_RIACPart):
    """EPRD empirical failure rate for a relay."""
    category = 'eprd_relay'
    family = 'EPRD'
    _subtype_param = 'relay_type'
    _BASE_RATES = {
        'general_purpose': 0.0400,
        'signal': 0.0250,
        'power': 0.0700,
        'latching': 0.0350,
        'solid_state': 0.0150,
        'time_delay': 0.0600,
    }

    def __init__(self, relay_type='general_purpose', **kwargs):
        super().__init__(part_type=relay_type, **kwargs)


class EPRD_Connector(_RIACPart):
    """EPRD empirical failure rate for a connector."""
    category = 'eprd_connector'
    family = 'EPRD'
    _subtype_param = 'connector_type'
    _BASE_RATES = {
        'circular': 0.0050,
        'rectangular': 0.0060,
        'rf_coaxial': 0.0040,
        'pcb_edge': 0.0030,
        'ribbon': 0.0035,
        'ic_socket': 0.0070,
        'power': 0.0090,
    }

    def __init__(self, connector_type='circular', **kwargs):
        super().__init__(part_type=connector_type, **kwargs)


class EPRD_Switch(_RIACPart):
    """EPRD empirical failure rate for a switch."""
    category = 'eprd_switch'
    family = 'EPRD'
    _subtype_param = 'switch_type'
    _BASE_RATES = {
        'toggle': 0.0150,
        'pushbutton': 0.0200,
        'rotary': 0.0300,
        'slide': 0.0180,
        'dip': 0.0100,
        'thumbwheel': 0.0400,
        'sensitive': 0.0250,
    }

    def __init__(self, switch_type='toggle', **kwargs):
        super().__init__(part_type=switch_type, **kwargs)


# =====================================================================
# NPRD -- Nonelectronic Parts Reliability Data
# =====================================================================


class NPRD_Motor(_RIACPart):
    """NPRD empirical failure rate for an electric motor."""
    category = 'nprd_motor'
    family = 'NPRD'
    _subtype_param = 'motor_type'
    _BASE_RATES = {
        'ac_induction': 1.50,
        'ac_synchronous': 1.80,
        'dc_brushed': 4.00,
        'dc_brushless': 1.20,
        'stepper': 0.90,
        'servo': 2.50,
        'gearmotor': 3.00,
    }

    def __init__(self, motor_type='ac_induction', **kwargs):
        super().__init__(part_type=motor_type, **kwargs)


class NPRD_Pump(_RIACPart):
    """NPRD empirical failure rate for a pump."""
    category = 'nprd_pump'
    family = 'NPRD'
    _subtype_param = 'pump_type'
    _BASE_RATES = {
        'centrifugal': 6.00,
        'gear': 8.00,
        'piston': 10.00,
        'vane': 7.00,
        'diaphragm': 5.00,
        'peristaltic': 4.00,
    }

    def __init__(self, pump_type='centrifugal', **kwargs):
        super().__init__(part_type=pump_type, **kwargs)


class NPRD_Valve(_RIACPart):
    """NPRD empirical failure rate for a valve."""
    category = 'nprd_valve'
    family = 'NPRD'
    _subtype_param = 'valve_type'
    _BASE_RATES = {
        'ball': 1.50,
        'gate': 2.00,
        'globe': 2.20,
        'butterfly': 1.80,
        'check': 1.20,
        'relief': 3.00,
        'solenoid': 4.50,
        'needle': 2.50,
    }

    def __init__(self, valve_type='ball', **kwargs):
        super().__init__(part_type=valve_type, **kwargs)


class NPRD_Actuator(_RIACPart):
    """NPRD empirical failure rate for an actuator."""
    category = 'nprd_actuator'
    family = 'NPRD'
    _subtype_param = 'actuator_type'
    _BASE_RATES = {
        'hydraulic': 5.00,
        'pneumatic': 4.00,
        'electric_linear': 3.50,
        'electric_rotary': 3.00,
        'solenoid': 4.50,
    }

    def __init__(self, actuator_type='hydraulic', **kwargs):
        super().__init__(part_type=actuator_type, **kwargs)


class NPRD_Bearing(_RIACPart):
    """NPRD empirical failure rate for a bearing."""
    category = 'nprd_bearing'
    family = 'NPRD'
    _subtype_param = 'bearing_type'
    _BASE_RATES = {
        'ball': 1.00,
        'roller': 1.20,
        'needle': 1.50,
        'journal': 2.50,
        'sleeve': 3.00,
        'thrust': 1.80,
    }

    def __init__(self, bearing_type='ball', **kwargs):
        super().__init__(part_type=bearing_type, **kwargs)


class NPRD_Gear(_RIACPart):
    """NPRD empirical failure rate for a gear."""
    category = 'nprd_gear'
    family = 'NPRD'
    _subtype_param = 'gear_type'
    _BASE_RATES = {
        'spur': 0.50,
        'helical': 0.60,
        'bevel': 0.80,
        'worm': 1.20,
        'planetary': 1.50,
    }

    def __init__(self, gear_type='spur', **kwargs):
        super().__init__(part_type=gear_type, **kwargs)


class NPRD_Fan(_RIACPart):
    """NPRD empirical failure rate for a fan/blower."""
    category = 'nprd_fan'
    family = 'NPRD'
    _subtype_param = 'fan_type'
    _BASE_RATES = {
        'axial': 3.00,
        'centrifugal': 3.50,
        'blower': 4.00,
        'muffin': 2.50,
    }

    def __init__(self, fan_type='axial', **kwargs):
        super().__init__(part_type=fan_type, **kwargs)


class NPRD_Battery(_RIACPart):
    """NPRD empirical failure rate for a battery."""
    category = 'nprd_battery'
    family = 'NPRD'
    _subtype_param = 'battery_type'
    _BASE_RATES = {
        'lead_acid': 2.00,
        'nicd': 1.50,
        'nimh': 1.40,
        'lithium_ion': 1.00,
        'lithium_primary': 0.80,
        'alkaline': 0.60,
    }

    def __init__(self, battery_type='lithium_ion', **kwargs):
        super().__init__(part_type=battery_type, **kwargs)


class NPRD_Filter(_RIACPart):
    """NPRD empirical failure rate for a mechanical filter."""
    category = 'nprd_filter'
    family = 'NPRD'
    _subtype_param = 'filter_type'
    _BASE_RATES = {
        'hydraulic': 1.50,
        'fuel': 1.80,
        'air': 1.20,
        'oil': 1.40,
        'water': 1.00,
    }

    def __init__(self, filter_type='hydraulic', **kwargs):
        super().__init__(part_type=filter_type, **kwargs)


class NPRD_Sensor(_RIACPart):
    """NPRD empirical failure rate for a sensor/transducer."""
    category = 'nprd_sensor'
    family = 'NPRD'
    _subtype_param = 'sensor_type'
    _BASE_RATES = {
        'temperature': 0.80,
        'pressure': 1.50,
        'flow': 2.00,
        'position': 1.20,
        'proximity': 1.00,
        'accelerometer': 1.30,
        'level': 1.60,
    }

    def __init__(self, sensor_type='pressure', **kwargs):
        super().__init__(part_type=sensor_type, **kwargs)


class NPRD_Switch(_RIACPart):
    """NPRD empirical failure rate for an electromechanical switch."""
    category = 'nprd_switch'
    family = 'NPRD'
    _subtype_param = 'switch_type'
    _BASE_RATES = {
        'toggle': 0.30,
        'pushbutton': 0.40,
        'limit': 0.60,
        'pressure': 0.80,
        'rotary': 0.70,
        'micro': 0.50,
    }

    def __init__(self, switch_type='toggle', **kwargs):
        super().__init__(part_type=switch_type, **kwargs)


class NPRD_Relay(_RIACPart):
    """NPRD empirical failure rate for an electromechanical relay."""
    category = 'nprd_relay'
    family = 'NPRD'
    _subtype_param = 'relay_type'
    _BASE_RATES = {
        'general_purpose': 0.50,
        'power': 0.90,
        'contactor': 1.50,
        'latching': 0.60,
        'time_delay': 0.80,
    }

    def __init__(self, relay_type='general_purpose', **kwargs):
        super().__init__(part_type=relay_type, **kwargs)


class NPRD_Connector(_RIACPart):
    """NPRD empirical failure rate for a mechanical/power connector."""
    category = 'nprd_connector'
    family = 'NPRD'
    _subtype_param = 'connector_type'
    _BASE_RATES = {
        'circular': 0.30,
        'rectangular': 0.35,
        'power': 0.50,
        'fluid_coupling': 0.80,
        'backshell': 0.20,
    }

    def __init__(self, connector_type='circular', **kwargs):
        super().__init__(part_type=connector_type, **kwargs)


class NPRD_Generic(_RIACPart):
    """NPRD generic / miscellaneous nonelectronic part."""
    category = 'nprd_generic'
    family = 'NPRD'
    _subtype_param = 'part_class'
    _BASE_RATES = {
        'mechanical_assembly': 2.00,
        'electromechanical': 3.00,
        'heater': 1.50,
        'clutch_brake': 2.50,
        'belt_chain': 3.50,
        'coupling': 1.00,
        'spring': 0.20,
        'seal_gasket': 0.50,
        'hose_line': 0.80,
        'circuit_breaker': 0.60,
        'lamp': 5.00,
        'fuse': 0.10,
    }

    def __init__(self, part_class='mechanical_assembly', **kwargs):
        super().__init__(part_type=part_class, **kwargs)


# =====================================================================
# Registries (used by the GUI backend class maps)
# =====================================================================

EPRD_CLASSES = {
    'eprd_capacitor': EPRD_Capacitor,
    'eprd_resistor': EPRD_Resistor,
    'eprd_inductor': EPRD_Inductor,
    'eprd_diode': EPRD_Diode,
    'eprd_transistor': EPRD_Transistor,
    'eprd_microcircuit': EPRD_Microcircuit,
    'eprd_optoelectronic': EPRD_Optoelectronic,
    'eprd_relay': EPRD_Relay,
    'eprd_connector': EPRD_Connector,
    'eprd_switch': EPRD_Switch,
}

NPRD_CLASSES = {
    'nprd_motor': NPRD_Motor,
    'nprd_pump': NPRD_Pump,
    'nprd_valve': NPRD_Valve,
    'nprd_actuator': NPRD_Actuator,
    'nprd_bearing': NPRD_Bearing,
    'nprd_gear': NPRD_Gear,
    'nprd_fan': NPRD_Fan,
    'nprd_battery': NPRD_Battery,
    'nprd_filter': NPRD_Filter,
    'nprd_sensor': NPRD_Sensor,
    'nprd_switch': NPRD_Switch,
    'nprd_relay': NPRD_Relay,
    'nprd_connector': NPRD_Connector,
    'nprd_generic': NPRD_Generic,
}
