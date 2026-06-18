"""NSWC-98/LE1 Mechanical Reliability Prediction.

Handbook of Reliability Prediction Procedures for Mechanical Equipment.
Implements failure rate models for mechanical components based on
physical stress, wear, and environmental factors.

Failure rates in FPMH (Failures Per Million Hours) for consistency
with the electronic prediction modules.
"""

import math
from typing import Optional


ENVIRONMENTS = ['indoor', 'outdoor', 'naval', 'airborne', 'missile', 'space']
ENVIRONMENT_DESCRIPTIONS = {
    'indoor': 'Indoor, controlled environment',
    'outdoor': 'Outdoor, ground-based',
    'naval': 'Naval/marine environment',
    'airborne': 'Airborne platform',
    'missile': 'Missile/launch vehicle',
    'space': 'Space/satellite',
}

PI_E_MECH = {
    'indoor': 1.0,
    'outdoor': 2.0,
    'naval': 3.0,
    'airborne': 4.0,
    'missile': 8.0,
    'space': 0.5,
}

# Boltzmann constant in eV/K for Arrhenius models
_BOLTZMANN_EV = 8.617e-5

# Reference temperature for Arrhenius models (25 deg C in Kelvin)
_T_REF_K = 298.15


def _check_environment(environment: str) -> None:
    if environment not in ENVIRONMENTS:
        raise ValueError(
            f"environment must be one of {ENVIRONMENTS}, got '{environment}'"
        )


def _check_positive(value: float, name: str) -> None:
    if value <= 0:
        raise ValueError(f"{name} must be positive, got {value}")


def _arrhenius_factor(temperature_c: float, Ea: float = 0.5) -> float:
    """Arrhenius-style temperature acceleration factor for metals.

    Parameters
    ----------
    temperature_c : float
        Operating temperature in degrees Celsius.
    Ea : float
        Activation energy in eV (default 0.5 eV typical for metals).

    Returns
    -------
    float
        Temperature correction factor, 1.0 at 25 deg C.
    """
    T_op = temperature_c + 273.15
    return math.exp(-Ea / _BOLTZMANN_EV * (1.0 / T_op - 1.0 / _T_REF_K))


def _linear_temp_factor(temperature_c: float, T_ref: float = 25.0,
                        slope: float = 0.01) -> float:
    """Linear temperature derating factor.

    Returns max(1.0, 1 + slope * (T - T_ref)).
    """
    return max(1.0, 1.0 + slope * (temperature_c - T_ref))


def _pressure_power_factor(pressure: float, p_ref: float,
                           exponent: float = 1.5) -> float:
    """Power-law pressure factor: (P / P_ref)^exponent, floored at 1.0."""
    if p_ref <= 0:
        return 1.0
    ratio = pressure / p_ref
    return max(1.0, ratio ** exponent)


# =====================================================================
# Base class for all NSWC-98/LE1 mechanical parts
# =====================================================================

class _MechPart:
    """Base class for NSWC-98/LE1 mechanical part models."""

    category = 'mechanical'

    def __init__(self, name: Optional[str] = None, quantity: int = 1,
                 environment: str = 'indoor'):
        if quantity < 1 or int(quantity) != quantity:
            raise ValueError("quantity must be a positive integer")
        _check_environment(environment)
        self.name = name or self.__class__.__name__
        self.quantity = int(quantity)
        self.environment = environment
        self._pi_factors: dict = {}
        self._failure_rate: float = 0.0

    def _compute(self) -> float:
        """Compute and return the single-unit failure rate in FPMH.

        Subclasses override this method. The base implementation returns
        the stored rate.
        """
        return self._failure_rate

    @property
    def failure_rate(self) -> float:
        """Single-unit failure rate in FPMH."""
        return self._failure_rate

    @property
    def total_failure_rate(self) -> float:
        """Failure rate times quantity."""
        return self._failure_rate * self.quantity

    @property
    def pi_factors(self) -> dict:
        """Dictionary of correction factor names to values."""
        return dict(self._pi_factors)

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}(name='{self.name}', "
            f"failure_rate={self.failure_rate:.6f} FPMH, "
            f"quantity={self.quantity})"
        )


# =====================================================================
# Chapter 4 -- Springs
# =====================================================================

_SPRING_BASE_RATES = {
    'compression': 0.2,
    'extension': 0.3,
    'torsion': 0.4,
    'leaf': 0.5,
    'belleville': 0.25,
}

_SPRING_MATERIAL_FACTORS = {
    'steel': 1.0,
    'stainless': 1.2,
    'bronze': 1.5,
    'inconel': 0.8,
}


class Spring(_MechPart):
    r"""Mechanical spring (NSWC-98/LE1 Chapter 4).

    .. math::
        \lambda = \lambda_{base} \times C_s \times C_m \times C_t
                  \times C_w \times C_e

    Parameters
    ----------
    spring_type : str
        One of 'compression', 'extension', 'torsion', 'leaf', 'belleville'.
    material : str
        One of 'steel', 'stainless', 'bronze', 'inconel'.
    wire_diameter_mm : float
        Wire or strip diameter in millimetres.
    coil_diameter_mm : float
        Mean coil diameter in millimetres.
    n_active_coils : int
        Number of active coils.
    max_deflection : float
        Maximum allowable deflection (any consistent unit).
    operating_deflection : float
        Operating deflection (same unit as max_deflection).
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'spring'

    def __init__(self, spring_type: str = 'compression',
                 material: str = 'steel',
                 wire_diameter_mm: float = 2.0,
                 coil_diameter_mm: float = 20.0,
                 n_active_coils: int = 8,
                 max_deflection: float = 10.0,
                 operating_deflection: float = 5.0,
                 temperature: float = 25.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if spring_type not in _SPRING_BASE_RATES:
            raise ValueError(
                f"spring_type must be one of {list(_SPRING_BASE_RATES)}, "
                f"got '{spring_type}'"
            )
        if material not in _SPRING_MATERIAL_FACTORS:
            raise ValueError(
                f"material must be one of {list(_SPRING_MATERIAL_FACTORS)}, "
                f"got '{material}'"
            )
        _check_positive(wire_diameter_mm, 'wire_diameter_mm')
        _check_positive(coil_diameter_mm, 'coil_diameter_mm')
        _check_positive(max_deflection, 'max_deflection')
        if operating_deflection < 0:
            raise ValueError("operating_deflection must be >= 0")
        if operating_deflection > max_deflection:
            raise ValueError(
                "operating_deflection must not exceed max_deflection"
            )

        self.spring_type = spring_type
        self.material = material
        self.wire_diameter_mm = wire_diameter_mm
        self.coil_diameter_mm = coil_diameter_mm
        self.n_active_coils = n_active_coils
        self.max_deflection = max_deflection
        self.operating_deflection = operating_deflection
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _SPRING_BASE_RATES[self.spring_type]

        # C_s -- stress correction factor based on deflection ratio
        deflection_ratio = self.operating_deflection / self.max_deflection
        # Power-law stress model: higher deflection ratio -> higher stress
        C_s = max(1.0, (deflection_ratio / 0.5) ** 3.0)

        # C_m -- material factor
        C_m = _SPRING_MATERIAL_FACTORS[self.material]

        # C_t -- temperature factor (Arrhenius for metallic fatigue)
        C_t = _arrhenius_factor(self.temperature, Ea=0.5)

        # C_w -- Wahl correction factor for coil springs
        C = self.coil_diameter_mm / self.wire_diameter_mm
        if C <= 1.0:
            C = 1.01  # prevent division by zero
        C_w = (4.0 * C - 1.0) / (4.0 * C - 4.0) + 0.615 / C

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_s': round(C_s, 6),
            'C_m': round(C_m, 4),
            'C_t': round(C_t, 6),
            'C_w': round(C_w, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_s * C_m * C_t * C_w * C_e


# =====================================================================
# Chapter 5 -- Bearings
# =====================================================================

_BEARING_BASE_RATES = {
    'ball': 1.0,
    'roller_cylindrical': 0.8,
    'roller_spherical': 0.8,
    'roller_tapered': 0.8,
    'needle': 0.8,
    'journal': 2.0,
    'sleeve': 5.0,
}

_BEARING_CONTAMINATION = {
    'clean': 1.0,
    'moderate': 1.5,
    'dirty': 3.0,
}

_BEARING_LUBRICATION = {
    'oil': 1.0,
    'grease': 1.3,
    'dry': 3.0,
}

# Water/corrosion factor by environment for bearings
_BEARING_WATER_CORROSION = {
    'indoor': 1.0,
    'outdoor': 1.2,
    'naval': 2.0,
    'airborne': 1.1,
    'missile': 1.0,
    'space': 0.8,
}


class Bearing(_MechPart):
    r"""Rolling-element or plain bearing (NSWC-98/LE1 Chapter 5).

    .. math::
        \lambda = \lambda_{base} \times C_v \times C_{cr}
                  \times C_{cw} \times C_t \times C_e

    Parameters
    ----------
    bearing_type : str
        One of 'ball', 'roller_cylindrical', 'roller_spherical',
        'roller_tapered', 'needle', 'journal', 'sleeve'.
    load_kN : float
        Applied radial load in kilonewtons.
    rated_load_kN : float
        Basic dynamic load rating in kilonewtons.
    speed_rpm : float
        Operating speed in RPM.
    rated_speed_rpm : float
        Rated (reference) speed in RPM.
    lubrication : str
        One of 'oil', 'grease', 'dry'.
    contamination : str
        One of 'clean', 'moderate', 'dirty'.
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'bearing'

    def __init__(self, bearing_type: str = 'ball',
                 load_kN: float = 5.0,
                 rated_load_kN: float = 20.0,
                 speed_rpm: float = 1500.0,
                 rated_speed_rpm: float = 5000.0,
                 lubrication: str = 'oil',
                 contamination: str = 'clean',
                 temperature: float = 40.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if bearing_type not in _BEARING_BASE_RATES:
            raise ValueError(
                f"bearing_type must be one of {list(_BEARING_BASE_RATES)}, "
                f"got '{bearing_type}'"
            )
        if lubrication not in _BEARING_LUBRICATION:
            raise ValueError(
                f"lubrication must be one of {list(_BEARING_LUBRICATION)}, "
                f"got '{lubrication}'"
            )
        if contamination not in _BEARING_CONTAMINATION:
            raise ValueError(
                f"contamination must be one of {list(_BEARING_CONTAMINATION)}, "
                f"got '{contamination}'"
            )
        _check_positive(rated_load_kN, 'rated_load_kN')
        _check_positive(rated_speed_rpm, 'rated_speed_rpm')

        self.bearing_type = bearing_type
        self.load_kN = load_kN
        self.rated_load_kN = rated_load_kN
        self.speed_rpm = speed_rpm
        self.rated_speed_rpm = rated_speed_rpm
        self.lubrication = lubrication
        self.contamination = contamination
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _BEARING_BASE_RATES[self.bearing_type]

        # C_v -- load/speed life factor
        # For rolling bearings: L10 life model -> (P/C)^3 * (n/n_rated)
        load_ratio = self.load_kN / self.rated_load_kN
        speed_ratio = self.speed_rpm / self.rated_speed_rpm
        C_v = max(1.0, (load_ratio ** 3.0) * speed_ratio)
        # Lubrication factor influences C_v for plain bearings
        C_v *= _BEARING_LUBRICATION[self.lubrication]

        # C_cr -- contamination/reliability factor
        C_cr = _BEARING_CONTAMINATION[self.contamination]

        # C_cw -- water/corrosion factor
        C_cw = _BEARING_WATER_CORROSION[self.environment]

        # C_t -- temperature factor (Arrhenius, 0.4 eV for bearing steels)
        C_t = _arrhenius_factor(self.temperature, Ea=0.4)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_v': round(C_v, 6),
            'C_cr': round(C_cr, 4),
            'C_cw': round(C_cw, 4),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_v * C_cr * C_cw * C_t * C_e


# =====================================================================
# Chapter 6 -- Gears
# =====================================================================

_GEAR_BASE_RATES = {
    'spur': 0.5,
    'helical': 0.3,
    'bevel': 0.8,
    'worm': 1.0,
    'planetary': 0.4,
}

_GEAR_MATERIAL_FACTORS = {
    'steel': 1.0,
    'stainless': 1.1,
    'cast_iron': 1.4,
    'bronze': 1.8,
    'plastic': 2.5,
}


class Gear(_MechPart):
    r"""Gear (NSWC-98/LE1 Chapter 6).

    .. math::
        \lambda = \lambda_{base} \times C_{gs} \times C_{gp}
                  \times C_{ga} \times C_{gl} \times C_{gt} \times C_e

    Parameters
    ----------
    gear_type : str
        One of 'spur', 'helical', 'bevel', 'worm', 'planetary'.
    material : str
        One of 'steel', 'stainless', 'cast_iron', 'bronze', 'plastic'.
    load_factor : float
        Load (power) factor relative to rated (0-10 typical, 1.0 = nominal).
    speed_factor : float
        Speed factor relative to rated (0-10 typical, 1.0 = nominal).
    alignment_factor : float
        Misalignment factor (1.0 = perfect, higher = worse).
    lubrication : str
        One of 'oil_bath', 'splash', 'grease', 'dry'.
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'gear'

    _LUBRICATION = {
        'oil_bath': 1.0,
        'splash': 1.2,
        'grease': 1.5,
        'dry': 3.0,
    }

    def __init__(self, gear_type: str = 'spur',
                 material: str = 'steel',
                 load_factor: float = 1.0,
                 speed_factor: float = 1.0,
                 alignment_factor: float = 1.0,
                 lubrication: str = 'oil_bath',
                 temperature: float = 40.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if gear_type not in _GEAR_BASE_RATES:
            raise ValueError(
                f"gear_type must be one of {list(_GEAR_BASE_RATES)}, "
                f"got '{gear_type}'"
            )
        if material not in _GEAR_MATERIAL_FACTORS:
            raise ValueError(
                f"material must be one of {list(_GEAR_MATERIAL_FACTORS)}, "
                f"got '{material}'"
            )
        if lubrication not in self._LUBRICATION:
            raise ValueError(
                f"lubrication must be one of {list(self._LUBRICATION)}, "
                f"got '{lubrication}'"
            )

        self.gear_type = gear_type
        self.material = material
        self.load_factor = load_factor
        self.speed_factor = speed_factor
        self.alignment_factor = alignment_factor
        self.lubrication = lubrication
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _GEAR_BASE_RATES[self.gear_type]

        # C_gs -- speed factor (power law on speed ratio)
        C_gs = max(1.0, self.speed_factor ** 1.5)

        # C_gp -- load (power) factor (power law on load ratio)
        C_gp = max(1.0, self.load_factor ** 2.0)

        # C_ga -- misalignment factor
        C_ga = max(1.0, self.alignment_factor)

        # C_gl -- lubrication quality factor
        C_gl = self._LUBRICATION[self.lubrication]

        # C_gt -- temperature factor (Arrhenius for gear steels)
        C_gt = _arrhenius_factor(self.temperature, Ea=0.5)

        # Material effect applied as multiplier on base rate
        C_mat = _GEAR_MATERIAL_FACTORS[self.material]

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_gs': round(C_gs, 6),
            'C_gp': round(C_gp, 6),
            'C_ga': round(C_ga, 6),
            'C_gl': round(C_gl, 4),
            'C_gt': round(C_gt, 6),
            'C_mat': round(C_mat, 4),
            'C_e': round(C_e, 4),
        }
        return (lambda_base * C_gs * C_gp * C_ga * C_gl * C_gt
                * C_mat * C_e)


# =====================================================================
# Chapter 7 -- Seals
# =====================================================================

_SEAL_BASE_RATES = {
    'o_ring': 0.5,
    'lip': 1.0,
    'mechanical': 2.0,
    'gasket': 0.2,
    'labyrinth': 0.8,
}

_SEAL_MATERIAL_FACTORS = {
    'nitrile': 1.0,
    'viton': 0.8,
    'silicone': 1.3,
    'ptfe': 0.6,
    'epdm': 1.1,
}

_SEAL_FLUID_FACTORS = {
    'oil': 1.0,
    'water': 1.5,
    'air': 0.8,
    'gas': 1.0,
    'chemical': 2.5,
}


class Seal(_MechPart):
    r"""Seal or gasket (NSWC-98/LE1 Chapter 7).

    .. math::
        \lambda = \lambda_{base} \times C_p \times C_q \times C_{dl}
                  \times C_f \times C_v \times C_t \times C_e

    Parameters
    ----------
    seal_type : str
        One of 'o_ring', 'lip', 'mechanical', 'gasket', 'labyrinth'.
    material : str
        One of 'nitrile', 'viton', 'silicone', 'ptfe', 'epdm'.
    pressure_psi : float
        Operating pressure in PSI.
    fluid : str
        One of 'oil', 'water', 'air', 'gas', 'chemical'.
    surface_finish : float
        Surface finish factor (1.0 = nominal, higher = rougher).
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'seal'

    def __init__(self, seal_type: str = 'o_ring',
                 material: str = 'nitrile',
                 pressure_psi: float = 100.0,
                 fluid: str = 'oil',
                 surface_finish: float = 1.0,
                 temperature: float = 25.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if seal_type not in _SEAL_BASE_RATES:
            raise ValueError(
                f"seal_type must be one of {list(_SEAL_BASE_RATES)}, "
                f"got '{seal_type}'"
            )
        if material not in _SEAL_MATERIAL_FACTORS:
            raise ValueError(
                f"material must be one of {list(_SEAL_MATERIAL_FACTORS)}, "
                f"got '{material}'"
            )
        if fluid not in _SEAL_FLUID_FACTORS:
            raise ValueError(
                f"fluid must be one of {list(_SEAL_FLUID_FACTORS)}, "
                f"got '{fluid}'"
            )

        self.seal_type = seal_type
        self.material = material
        self.pressure_psi = pressure_psi
        self.fluid = fluid
        self.surface_finish = surface_finish
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _SEAL_BASE_RATES[self.seal_type]

        # C_p -- pressure factor (power-law, reference 100 PSI)
        C_p = _pressure_power_factor(self.pressure_psi, p_ref=100.0,
                                     exponent=1.5)

        # C_q -- allowable leakage factor (simplified: use material
        # quality to approximate; tighter-sealing materials score lower)
        C_q = _SEAL_MATERIAL_FACTORS[self.material]

        # C_dl -- dynamic/static duty factor (rolled into material)
        C_dl = 1.0

        # C_f -- fluid compatibility factor
        C_f = _SEAL_FLUID_FACTORS[self.fluid]

        # C_v -- surface finish / velocity factor
        C_v = max(1.0, self.surface_finish)

        # C_t -- temperature factor
        # Elastomers degrade faster; use lower activation energy
        C_t = _arrhenius_factor(self.temperature, Ea=0.3)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_p': round(C_p, 6),
            'C_q': round(C_q, 4),
            'C_dl': round(C_dl, 4),
            'C_f': round(C_f, 4),
            'C_v': round(C_v, 6),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_p * C_q * C_dl * C_f * C_v * C_t * C_e


# =====================================================================
# Chapter 9 -- Valves
# =====================================================================

_VALVE_BASE_RATES = {
    'ball': 1.0,
    'gate': 0.8,
    'globe': 1.2,
    'butterfly': 0.9,
    'check': 1.5,
    'relief': 2.0,
    'solenoid': 3.0,
    'pneumatic': 2.5,
}

_VALVE_FLUID_FACTORS = {
    'oil': 1.0,
    'water': 1.2,
    'air': 0.8,
    'gas': 1.0,
    'steam': 1.8,
    'chemical': 2.5,
}


class Valve(_MechPart):
    r"""Valve (NSWC-98/LE1 Chapter 9).

    .. math::
        \lambda = \lambda_{base} \times C_f \times C_s \times C_p
                  \times C_t \times C_e

    Parameters
    ----------
    valve_type : str
        One of 'ball', 'gate', 'globe', 'butterfly', 'check',
        'relief', 'solenoid', 'pneumatic'.
    fluid : str
        One of 'oil', 'water', 'air', 'gas', 'steam', 'chemical'.
    pressure_psi : float
        Operating pressure in PSI.
    temperature : float
        Operating temperature in degrees Celsius.
    cycles_per_hour : float
        Number of valve actuations per hour.
    """

    category = 'valve'

    def __init__(self, valve_type: str = 'ball',
                 fluid: str = 'oil',
                 pressure_psi: float = 100.0,
                 temperature: float = 25.0,
                 cycles_per_hour: float = 1.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if valve_type not in _VALVE_BASE_RATES:
            raise ValueError(
                f"valve_type must be one of {list(_VALVE_BASE_RATES)}, "
                f"got '{valve_type}'"
            )
        if fluid not in _VALVE_FLUID_FACTORS:
            raise ValueError(
                f"fluid must be one of {list(_VALVE_FLUID_FACTORS)}, "
                f"got '{fluid}'"
            )

        self.valve_type = valve_type
        self.fluid = fluid
        self.pressure_psi = pressure_psi
        self.temperature = temperature
        self.cycles_per_hour = cycles_per_hour

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _VALVE_BASE_RATES[self.valve_type]

        # C_f -- fluid factor
        C_f = _VALVE_FLUID_FACTORS[self.fluid]

        # C_s -- seat stress / cycling factor
        # Wear increases with cycling; reference = 1 cycle/hr
        C_s = max(1.0, self.cycles_per_hour ** 0.5)

        # C_p -- pressure factor (power-law, reference 200 PSI)
        C_p = _pressure_power_factor(self.pressure_psi, p_ref=200.0,
                                     exponent=1.5)

        # C_t -- temperature factor
        C_t = _arrhenius_factor(self.temperature, Ea=0.4)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_f': round(C_f, 4),
            'C_s': round(C_s, 6),
            'C_p': round(C_p, 6),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_f * C_s * C_p * C_t * C_e


# =====================================================================
# Chapter 10 -- Actuators
# =====================================================================

_ACTUATOR_BASE_RATES = {
    'hydraulic': 5.0,
    'pneumatic': 3.0,
    'electric_linear': 2.0,
    'electric_rotary': 1.5,
}


class Actuator(_MechPart):
    r"""Actuator (NSWC-98/LE1 Chapter 10).

    .. math::
        \lambda = \lambda_{base} \times C_{cp} \times C_f
                  \times C_t \times C_e

    Parameters
    ----------
    actuator_type : str
        One of 'hydraulic', 'pneumatic', 'electric_linear',
        'electric_rotary'.
    pressure_psi : float
        Operating pressure in PSI (hydraulic/pneumatic).
    cycles_per_hour : float
        Number of actuations per hour.
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'actuator'

    def __init__(self, actuator_type: str = 'hydraulic',
                 pressure_psi: float = 1000.0,
                 cycles_per_hour: float = 10.0,
                 temperature: float = 40.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if actuator_type not in _ACTUATOR_BASE_RATES:
            raise ValueError(
                f"actuator_type must be one of "
                f"{list(_ACTUATOR_BASE_RATES)}, got '{actuator_type}'"
            )

        self.actuator_type = actuator_type
        self.pressure_psi = pressure_psi
        self.cycles_per_hour = cycles_per_hour
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _ACTUATOR_BASE_RATES[self.actuator_type]

        # C_cp -- cycling/pressure factor
        # Combines cycle wear and pressure stress
        cycle_factor = max(1.0, (self.cycles_per_hour / 10.0) ** 0.6)
        if self.actuator_type in ('hydraulic', 'pneumatic'):
            pressure_factor = _pressure_power_factor(
                self.pressure_psi, p_ref=1000.0, exponent=1.5
            )
        else:
            pressure_factor = 1.0
        C_cp = cycle_factor * pressure_factor

        # C_f -- fluid/contamination factor (simplified)
        C_f = 1.0
        if self.actuator_type == 'hydraulic':
            C_f = 1.2  # hydraulic fluid contamination baseline
        elif self.actuator_type == 'pneumatic':
            C_f = 1.1  # moisture in compressed air

        # C_t -- temperature factor
        C_t = _arrhenius_factor(self.temperature, Ea=0.4)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_cp': round(C_cp, 6),
            'C_f': round(C_f, 4),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_cp * C_f * C_t * C_e


# =====================================================================
# Chapter 11 -- Pumps
# =====================================================================

_PUMP_BASE_RATES = {
    'centrifugal': 3.0,
    'piston': 8.0,
    'gear': 5.0,
    'vane': 6.0,
    'diaphragm': 2.0,
    'peristaltic': 4.0,
}

_PUMP_FLUID_FACTORS = {
    'oil': 1.0,
    'water': 1.3,
    'air': 0.7,
    'gas': 0.9,
    'chemical': 2.0,
    'slurry': 3.0,
}

_PUMP_CONTAMINATION = {
    'clean': 1.0,
    'moderate': 1.5,
    'dirty': 2.5,
}


class Pump(_MechPart):
    r"""Pump (NSWC-98/LE1 Chapter 11).

    .. math::
        \lambda = \lambda_{base} \times C_f \times C_w \times C_{cs}
                  \times C_t \times C_e

    Parameters
    ----------
    pump_type : str
        One of 'centrifugal', 'piston', 'gear', 'vane', 'diaphragm',
        'peristaltic'.
    flow_factor : float
        Ratio of operating flow to rated flow (1.0 = nominal).
    speed_rpm : float
        Operating speed in RPM.
    pressure_psi : float
        Operating discharge pressure in PSI.
    fluid : str
        One of 'oil', 'water', 'air', 'gas', 'chemical', 'slurry'.
    temperature : float
        Operating temperature in degrees Celsius.
    contamination : str
        One of 'clean', 'moderate', 'dirty'.
    """

    category = 'pump'

    def __init__(self, pump_type: str = 'centrifugal',
                 flow_factor: float = 1.0,
                 speed_rpm: float = 1800.0,
                 pressure_psi: float = 100.0,
                 fluid: str = 'water',
                 temperature: float = 30.0,
                 contamination: str = 'clean',
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if pump_type not in _PUMP_BASE_RATES:
            raise ValueError(
                f"pump_type must be one of {list(_PUMP_BASE_RATES)}, "
                f"got '{pump_type}'"
            )
        if fluid not in _PUMP_FLUID_FACTORS:
            raise ValueError(
                f"fluid must be one of {list(_PUMP_FLUID_FACTORS)}, "
                f"got '{fluid}'"
            )
        if contamination not in _PUMP_CONTAMINATION:
            raise ValueError(
                f"contamination must be one of "
                f"{list(_PUMP_CONTAMINATION)}, got '{contamination}'"
            )

        self.pump_type = pump_type
        self.flow_factor = flow_factor
        self.speed_rpm = speed_rpm
        self.pressure_psi = pressure_psi
        self.fluid = fluid
        self.temperature = temperature
        self.contamination = contamination

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _PUMP_BASE_RATES[self.pump_type]

        # C_f -- flow/speed factor
        # Higher flow or speed increases wear proportionally
        flow_speed = max(1.0, self.flow_factor) * max(
            1.0, (self.speed_rpm / 1800.0) ** 1.2
        )
        C_f = max(1.0, flow_speed)

        # C_w -- fluid/contaminant factor
        C_w = (_PUMP_FLUID_FACTORS[self.fluid]
               * _PUMP_CONTAMINATION[self.contamination])

        # C_cs -- pressure/cycle stress factor
        C_cs = _pressure_power_factor(self.pressure_psi, p_ref=100.0,
                                      exponent=1.0)

        # C_t -- temperature factor
        C_t = _arrhenius_factor(self.temperature, Ea=0.4)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_f': round(C_f, 6),
            'C_w': round(C_w, 6),
            'C_cs': round(C_cs, 6),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_f * C_w * C_cs * C_t * C_e


# =====================================================================
# Chapter 12 -- Filters
# =====================================================================

_FILTER_BASE_RATES = {
    'hydraulic': 2.0,
    'fuel': 1.5,
    'air': 0.5,
    'water': 1.0,
}


class Filter(_MechPart):
    r"""Filter (NSWC-98/LE1 Chapter 12).

    .. math::
        \lambda = \lambda_{base} \times C_{dp} \times C_f \times C_e

    Parameters
    ----------
    filter_type : str
        One of 'hydraulic', 'fuel', 'air', 'water'.
    differential_pressure_factor : float
        Ratio of operating differential pressure to rated (1.0 = nominal).
    fluid_factor : float
        Fluid aggressiveness multiplier (1.0 = benign).
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'filter'

    def __init__(self, filter_type: str = 'hydraulic',
                 differential_pressure_factor: float = 1.0,
                 fluid_factor: float = 1.0,
                 temperature: float = 30.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if filter_type not in _FILTER_BASE_RATES:
            raise ValueError(
                f"filter_type must be one of {list(_FILTER_BASE_RATES)}, "
                f"got '{filter_type}'"
            )

        self.filter_type = filter_type
        self.differential_pressure_factor = differential_pressure_factor
        self.fluid_factor = fluid_factor
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _FILTER_BASE_RATES[self.filter_type]

        # C_dp -- differential pressure factor
        C_dp = max(1.0, self.differential_pressure_factor ** 1.5)

        # C_f -- fluid aggressiveness factor
        C_f = max(1.0, self.fluid_factor)

        # Temperature factor (linear model for filter media)
        C_t = _linear_temp_factor(self.temperature, T_ref=25.0,
                                  slope=0.005)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_dp': round(C_dp, 6),
            'C_f': round(C_f, 6),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_dp * C_f * C_t * C_e


# =====================================================================
# Chapter 13 -- Couplings
# =====================================================================

_COUPLING_BASE_RATES = {
    'rigid': 0.3,
    'flexible': 0.5,
    'fluid': 2.0,
    'gear': 1.0,
    'universal': 1.5,
}


class Coupling(_MechPart):
    r"""Shaft coupling (NSWC-98/LE1 Chapter 13).

    .. math::
        \lambda = \lambda_{base} \times C_t \times C_{al} \times C_e

    Parameters
    ----------
    coupling_type : str
        One of 'rigid', 'flexible', 'fluid', 'gear', 'universal'.
    torque_factor : float
        Ratio of operating torque to rated torque (1.0 = nominal).
    alignment_factor : float
        Misalignment factor (1.0 = perfect alignment, higher = worse).
    speed_rpm : float
        Operating speed in RPM.
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'coupling'

    def __init__(self, coupling_type: str = 'flexible',
                 torque_factor: float = 1.0,
                 alignment_factor: float = 1.0,
                 speed_rpm: float = 1800.0,
                 temperature: float = 40.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if coupling_type not in _COUPLING_BASE_RATES:
            raise ValueError(
                f"coupling_type must be one of "
                f"{list(_COUPLING_BASE_RATES)}, got '{coupling_type}'"
            )

        self.coupling_type = coupling_type
        self.torque_factor = torque_factor
        self.alignment_factor = alignment_factor
        self.speed_rpm = speed_rpm
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _COUPLING_BASE_RATES[self.coupling_type]

        # C_t -- torque/speed combined stress factor
        torque_stress = max(1.0, self.torque_factor ** 2.0)
        speed_stress = max(1.0, (self.speed_rpm / 1800.0) ** 1.0)
        C_t = torque_stress * speed_stress

        # C_al -- alignment factor
        C_al = max(1.0, self.alignment_factor)

        # C_temp -- temperature factor
        C_temp = _arrhenius_factor(self.temperature, Ea=0.4)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_t': round(C_t, 6),
            'C_al': round(C_al, 6),
            'C_temp': round(C_temp, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_t * C_al * C_temp * C_e


# =====================================================================
# Chapter 14 -- Brakes and Clutches
# =====================================================================

_BRAKE_CLUTCH_BASE_RATES = {
    'drum_brake': 2.0,
    'disc_brake': 1.5,
    'band_brake': 3.0,
    'friction_clutch': 4.0,
    'magnetic_clutch': 2.5,
}


class BrakeClutch(_MechPart):
    r"""Brake or clutch (NSWC-98/LE1 Chapter 14).

    .. math::
        \lambda = \lambda_{base} \times C_f \times C_t \times C_e

    Parameters
    ----------
    device_type : str
        One of 'drum_brake', 'disc_brake', 'band_brake',
        'friction_clutch', 'magnetic_clutch'.
    cycles_per_hour : float
        Number of engagements per hour.
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'brake_clutch'

    def __init__(self, device_type: str = 'disc_brake',
                 cycles_per_hour: float = 10.0,
                 temperature: float = 60.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if device_type not in _BRAKE_CLUTCH_BASE_RATES:
            raise ValueError(
                f"device_type must be one of "
                f"{list(_BRAKE_CLUTCH_BASE_RATES)}, got '{device_type}'"
            )

        self.device_type = device_type
        self.cycles_per_hour = cycles_per_hour
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _BRAKE_CLUTCH_BASE_RATES[self.device_type]

        # C_f -- cycling/friction wear factor
        # Wear is proportional to number of engagements
        C_f = max(1.0, (self.cycles_per_hour / 10.0) ** 0.7)

        # C_t -- temperature factor
        # Friction surfaces degrade faster at elevated temperatures
        C_t = _arrhenius_factor(self.temperature, Ea=0.5)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_f': round(C_f, 6),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_f * C_t * C_e


# =====================================================================
# Chapter 15 -- Electric Motors (mechanical failure modes)
# =====================================================================

_MOTOR_BASE_RATES = {
    'ac_induction': 2.0,
    'ac_synchronous': 2.5,
    'dc_brushed': 5.0,
    'dc_brushless': 1.5,
    'stepper': 3.0,
}


class ElectricMotor(_MechPart):
    r"""Electric motor mechanical failure modes (NSWC-98/LE1 Chapter 15).

    Covers bearing wear, winding insulation degradation, brush wear,
    and vibration-induced failures -- the mechanical failure modes only.

    .. math::
        \lambda = \lambda_{base} \times C_t \times C_v \times C_{alt}
                  \times C_e

    Parameters
    ----------
    motor_type : str
        One of 'ac_induction', 'ac_synchronous', 'dc_brushed',
        'dc_brushless', 'stepper'.
    power_hp : float
        Rated motor power in horsepower.
    voltage_stress : float
        Ratio of operating voltage to rated voltage (0 to 1+).
    altitude_ft : float
        Operating altitude in feet above sea level.
    temperature : float
        Operating (ambient) temperature in degrees Celsius.
    """

    category = 'electric_motor'

    def __init__(self, motor_type: str = 'ac_induction',
                 power_hp: float = 1.0,
                 voltage_stress: float = 1.0,
                 altitude_ft: float = 0.0,
                 temperature: float = 40.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if motor_type not in _MOTOR_BASE_RATES:
            raise ValueError(
                f"motor_type must be one of {list(_MOTOR_BASE_RATES)}, "
                f"got '{motor_type}'"
            )
        _check_positive(power_hp, 'power_hp')

        self.motor_type = motor_type
        self.power_hp = power_hp
        self.voltage_stress = voltage_stress
        self.altitude_ft = altitude_ft
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _MOTOR_BASE_RATES[self.motor_type]

        # Scale base rate by power (larger motors have more failure modes)
        power_factor = max(1.0, self.power_hp ** 0.25)

        # C_t -- temperature factor (Arrhenius, insulation class)
        C_t = _arrhenius_factor(self.temperature, Ea=0.5)

        # C_v -- voltage stress factor
        # Over-voltage accelerates insulation degradation
        if self.voltage_stress <= 1.0:
            C_v = 1.0
        else:
            C_v = self.voltage_stress ** 3.0

        # C_alt -- altitude derating factor
        # Reduced air density impairs cooling above 3300 ft
        if self.altitude_ft <= 3300.0:
            C_alt = 1.0
        else:
            # Derating: roughly 1% per 330 ft above 3300 ft
            C_alt = 1.0 + (self.altitude_ft - 3300.0) / 33000.0

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'power_factor': round(power_factor, 6),
            'C_t': round(C_t, 6),
            'C_v': round(C_v, 6),
            'C_alt': round(C_alt, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * power_factor * C_t * C_v * C_alt * C_e


# =====================================================================
# Chapter 16 -- Belts and Chains
# =====================================================================

_BELT_CHAIN_BASE_RATES = {
    'v_belt': 3.0,
    'timing_belt': 2.0,
    'flat_belt': 4.0,
    'roller_chain': 2.5,
    'silent_chain': 2.0,
}


class BeltChain(_MechPart):
    r"""Belt or chain drive (NSWC-98/LE1 Chapter 16).

    .. math::
        \lambda = \lambda_{base} \times C_l \times C_t \times C_e

    Parameters
    ----------
    type : str
        One of 'v_belt', 'timing_belt', 'flat_belt', 'roller_chain',
        'silent_chain'.
    load_factor : float
        Ratio of operating load/tension to rated (1.0 = nominal).
    speed_rpm : float
        Operating speed in RPM.
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'belt_chain'

    def __init__(self, type: str = 'v_belt',
                 load_factor: float = 1.0,
                 speed_rpm: float = 1800.0,
                 temperature: float = 30.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if type not in _BELT_CHAIN_BASE_RATES:
            raise ValueError(
                f"type must be one of {list(_BELT_CHAIN_BASE_RATES)}, "
                f"got '{type}'"
            )

        self.belt_chain_type = type
        self.load_factor = load_factor
        self.speed_rpm = speed_rpm
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _BELT_CHAIN_BASE_RATES[self.belt_chain_type]

        # C_l -- load/speed combined factor
        load_stress = max(1.0, self.load_factor ** 2.0)
        speed_stress = max(1.0, (self.speed_rpm / 1800.0) ** 1.5)
        C_l = load_stress * speed_stress

        # C_t -- temperature factor
        # Belts (rubber/polymer) use lower Ea; chains (metal) higher
        if self.belt_chain_type in ('roller_chain', 'silent_chain'):
            C_t = _arrhenius_factor(self.temperature, Ea=0.4)
        else:
            C_t = _arrhenius_factor(self.temperature, Ea=0.3)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_l': round(C_l, 6),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_l * C_t * C_e


# =====================================================================
# Chapter 17 -- Hydraulic and Pneumatic Lines
# =====================================================================

_LINE_BASE_RATES = {
    'rigid_pipe': 0.2,
    'flexible_hose': 1.0,
    'tubing': 0.3,
    'fitting': 0.5,
}

_LINE_MATERIAL_FACTORS = {
    'steel': 1.0,
    'stainless': 0.9,
    'aluminum': 1.2,
    'copper': 1.1,
    'rubber': 1.5,
    'ptfe': 0.8,
}

_LINE_FLUID_FACTORS = {
    'oil': 1.0,
    'water': 1.2,
    'air': 0.8,
    'gas': 1.0,
    'hydraulic_fluid': 1.0,
    'fuel': 1.3,
}


class Hydraulic_Pneumatic_Line(_MechPart):
    r"""Hydraulic or pneumatic line (NSWC-98/LE1 Chapter 17).

    .. math::
        \lambda = \lambda_{base} \times C_p \times C_f \times C_b
                  \times C_e

    Parameters
    ----------
    line_type : str
        One of 'rigid_pipe', 'flexible_hose', 'tubing', 'fitting'.
    material : str
        One of 'steel', 'stainless', 'aluminum', 'copper', 'rubber',
        'ptfe'.
    pressure_psi : float
        Operating pressure in PSI.
    fluid : str
        One of 'oil', 'water', 'air', 'gas', 'hydraulic_fluid', 'fuel'.
    n_bends : int
        Number of bends in the line.
    temperature : float
        Operating temperature in degrees Celsius.
    """

    category = 'hydraulic_pneumatic_line'

    def __init__(self, line_type: str = 'rigid_pipe',
                 material: str = 'steel',
                 pressure_psi: float = 500.0,
                 fluid: str = 'hydraulic_fluid',
                 n_bends: int = 0,
                 temperature: float = 40.0,
                 name: Optional[str] = None,
                 quantity: int = 1,
                 environment: str = 'indoor'):
        super().__init__(name=name, quantity=quantity, environment=environment)

        if line_type not in _LINE_BASE_RATES:
            raise ValueError(
                f"line_type must be one of {list(_LINE_BASE_RATES)}, "
                f"got '{line_type}'"
            )
        if material not in _LINE_MATERIAL_FACTORS:
            raise ValueError(
                f"material must be one of {list(_LINE_MATERIAL_FACTORS)}, "
                f"got '{material}'"
            )
        if fluid not in _LINE_FLUID_FACTORS:
            raise ValueError(
                f"fluid must be one of {list(_LINE_FLUID_FACTORS)}, "
                f"got '{fluid}'"
            )
        if n_bends < 0:
            raise ValueError("n_bends must be >= 0")

        self.line_type = line_type
        self.material = material
        self.pressure_psi = pressure_psi
        self.fluid = fluid
        self.n_bends = n_bends
        self.temperature = temperature

        self._failure_rate = self._compute()

    def _compute(self) -> float:
        lambda_base = _LINE_BASE_RATES[self.line_type]

        # C_p -- pressure factor (power-law, reference 500 PSI for lines)
        C_p = _pressure_power_factor(self.pressure_psi, p_ref=500.0,
                                     exponent=1.5)

        # C_f -- fluid compatibility and material factor
        C_f = (_LINE_FLUID_FACTORS[self.fluid]
               * _LINE_MATERIAL_FACTORS[self.material])

        # C_b -- bend/flex fatigue factor
        # Each bend is a stress concentration point
        C_b = 1.0 + 0.05 * self.n_bends

        # Temperature factor
        C_t = _arrhenius_factor(self.temperature, Ea=0.3)

        # C_e -- environmental factor
        C_e = PI_E_MECH[self.environment]

        self._pi_factors = {
            'lambda_base': round(lambda_base, 4),
            'C_p': round(C_p, 6),
            'C_f': round(C_f, 6),
            'C_b': round(C_b, 4),
            'C_t': round(C_t, 6),
            'C_e': round(C_e, 4),
        }
        return lambda_base * C_p * C_f * C_b * C_t * C_e


# =====================================================================
# System-level roll-up
# =====================================================================

class SystemFailureRate:
    """Series-system rollup of an NSWC-98/LE1 mechanical parts list.

    Attributes
    ----------
    total_failure_rate : float
        Sum of part failure rates times quantities, in FPMH.
    mtbf : float
        Mean time between failures, in hours (1e6 / total_failure_rate).
    """

    def __init__(self, parts):
        if not parts:
            raise ValueError("parts list must not be empty")
        self.parts = list(parts)
        self.total_failure_rate = float(
            sum(p.total_failure_rate for p in self.parts)
        )
        self.mtbf = (math.inf if self.total_failure_rate == 0
                     else 1e6 / self.total_failure_rate)

    def reliability(self, t_hours: float) -> float:
        """Mission reliability R(t) = exp(-lambda * t).

        Parameters
        ----------
        t_hours : float
            Mission time in hours.

        Returns
        -------
        float
            Probability of survival over the mission time.
        """
        return math.exp(-self.total_failure_rate * t_hours / 1e6)

    @property
    def results(self) -> list:
        """Per-part breakdown with contribution percentages."""
        rows = []
        for p in self.parts:
            contribution = (
                p.total_failure_rate / self.total_failure_rate
                if self.total_failure_rate > 0 else 0.0
            )
            rows.append({
                'name': p.name,
                'category': p.category,
                'quantity': p.quantity,
                'failure_rate': round(p.failure_rate, 6),
                'total_failure_rate': round(p.total_failure_rate, 6),
                'contribution': round(contribution, 4),
                'pi_factors': p.pi_factors,
            })
        return rows

    def __repr__(self) -> str:
        return (
            f"SystemFailureRate(total={self.total_failure_rate:.4f} FPMH, "
            f"MTBF={self.mtbf:.1f} h, parts={len(self.parts)})"
        )
