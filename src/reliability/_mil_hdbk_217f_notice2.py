"""Complete MIL-HDBK-217F Notice 2 calculation models.

This module is the clause-level implementation behind
``reliability.MIL_HDBK_217F``.  Values are failure rates per million hours
(FPMH) unless a model explicitly states another intermediate unit.

The implementation follows the supplied 28 February 1995 Notice 2 handbook.
Every calculated part carries machine-readable source, equation, factor, and
substitution metadata so a Perdura result can be audited back to the handbook.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Iterable, Mapping, Sequence

import numpy as np


FPMH = "failures per 10^6 hours"
BOLTZMANN_EV = 8.617e-5
HANDBOOK_EDITION = "MIL-HDBK-217F Notice 2 (28 February 1995)"
VITA_EDITION = "ANSI/VITA 51.1-2013 (R2018)"

PREDICTION_RESULT_CONTEXT = (
    "This prediction result is a planning estimate for relative design "
    "comparison. It is not an observed or calibrated field failure rate "
    "unless supported by representative test or field data."
)

ENVIRONMENTS = [
    "GB", "GF", "GM", "NS", "NU", "AIC", "AIF",
    "AUC", "AUF", "ARW", "SF", "MF", "ML", "CL",
]

ENVIRONMENT_DESCRIPTIONS = {
    "GB": "Ground, Benign",
    "GF": "Ground, Fixed",
    "GM": "Ground, Mobile",
    "NS": "Naval, Sheltered",
    "NU": "Naval, Unsheltered",
    "AIC": "Airborne, Inhabited Cargo",
    "AIF": "Airborne, Inhabited Fighter",
    "AUC": "Airborne, Uninhabited Cargo",
    "AUF": "Airborne, Uninhabited Fighter",
    "ARW": "Airborne, Rotary Wing",
    "SF": "Space, Flight",
    "MF": "Missile, Flight",
    "ML": "Missile, Launch",
    "CL": "Cannon, Launch",
}

STANDARDS = ("MIL-HDBK-217F", "VITA-51.1")

# ANSI/VITA 51.1-2013 (R2018) standard defaults for commercial parts of known
# pedigree.  They are deliberately kept separate from the MIL tables: selecting
# ``VITA-51.1`` means the caller asserts the Appendix C pedigree/counterfeit-
# control prerequisites.  An explicit ``pi_Q`` supplied by the analyst always
# wins because A/V51.1 Recommendation 2-1 prefers known design data to defaults.
VITA_51_1_PI_Q = {
    "microcircuit": {"commercial": 1.0},
    "semiconductor": {"plastic": 1.0, "lower": 1.0, "commercial": 1.0},
    # Retain the family aliases because public callers used them before the
    # complete supplement implementation.
    "diode": {"plastic": 1.0, "lower": 1.0, "commercial": 1.0},
    "transistor": {"plastic": 1.0, "lower": 1.0, "commercial": 1.0},
    "resistor": {"commercial": 1.0},
    "capacitor": {"commercial": 1.0},
    "mechanical_relay": {"commercial": 1.5},
    "solid_state_relay": {"commercial": 1.0},
    "switch": {"lower": 1.0, "commercial": 1.0},
    "connector": {"lower": 1.0, "commercial": 1.0},
    "interconnection": {"lower": 1.0, "commercial": 1.0},
    "meter": {"lower": 1.0, "commercial": 1.0},
    "crystal": {"lower": 1.0, "commercial": 1.0},
    "filter": {"lower": 1.0, "commercial": 1.0},
}

# Rules associated with each Perdura category.  The router uses this map both
# to decide whether a checkbox is meaningful and to attach a clause-level audit
# trail to every supplemented result.
VITA_CATEGORY_RULES: dict[str, tuple[str, ...]] = {
    "microcircuit": (
        "Rule 2.1.2-1", "Rule 2.1.2-2", "Permission 2.1.2-1",
        "Suggestion 2.1.2-1", "Permission 2.1.2-2", "Rule 2.1.2-3",
        "Rule 2.1.2-4", "Rule 2.1.2-5", "Rule 2.1.2-6", "Rule 2.1.2-7",
    ),
    "vhsic_microcircuit": ("Rule 2.1.2-1", "Recommendation 2.1.2-1", "Rule 2.1.2-3"),
    "gaas_microcircuit": ("Rule 2.1.2-1", "Rule 2.1.2-3", "Rule 2.1.2-4"),
    "hybrid_microcircuit": ("Rule 2.1.2-1",),
    "detailed_cmos": ("Rule 2.1.2-1", "Recommendation 2.1.2-1", "Rule 2.1.2-3"),
    "diode": ("Rule 2.1.3-1", "Rule 2.1.3-2"),
    "hf_diode": ("Rule 2.1.3-1",),
    "bjt": ("Rule 2.1.3-1", "Rule 2.1.3-2"),
    "fet": ("Rule 2.1.3-1", "Recommendation 2.1.3-1"),
    "gaas_fet": ("Rule 2.1.3-1",),
    "unijunction": ("Rule 2.1.3-1",),
    "hf_low_noise_bjt": ("Rule 2.1.3-1", "Rule 2.1.3-2"),
    "hf_power_bjt": ("Rule 2.1.3-1", "Rule 2.1.3-2"),
    "hf_silicon_fet": ("Rule 2.1.3-1", "Recommendation 2.1.3-2"),
    "thyristor": ("Rule 2.1.3-1", "Rule 2.1.3-2"),
    "optoelectronic": ("Rule 2.1.3-1",),
    "resistor": ("Rule 2.1.4-1", "Rule 2.1.4-2", "Rule 2.1.4-3"),
    "capacitor": tuple(f"Rule 2.1.5-{i}" for i in range(1, 10)),
    "ferrite_bead": ("Observation 2.1.6.1-1 and associated model direction",),
    "relay": ("Rule 2.1.7-1",),
    "ss_relay": ("Rule 2.1.7-2",),
    "switch": ("Rule 2.1.8-1",),
    "connector": ("Rule 2.1.9-1", "Rule 2.1.9-2", "Rule 2.1.9-3", "Rule 2.1.9-4"),
    "pth_assembly": ("Rule 2.1.10-2", "Recommendation 2.1.10-1", "Permission 2.1.10-1"),
    "surface_mount_assembly": ("Rule 2.1.10-1",),
    "meter": ("Rule 2.1.11-1",),
    "crystal": ("Rule 2.1.12-1",),
    "oscillator": ("Rule 2.1.13-1", "Rule 2.1.13-2"),
    "filter": ("Rule 2.1.14-1",),
    "mems_oscillator": ("Observation 2.1.15.1-1 and Appendix G",),
    "parts_count": ("Rule 2.2.1-1", "Rule 2.2.2-1", "Rule 2.2.2-2", "Rule 2.2.3-1"),
}
VITA_PART_CATEGORIES = tuple(VITA_CATEGORY_RULES)


def _env(values: Sequence[float | None]) -> dict[str, float | None]:
    if len(values) != len(ENVIRONMENTS):
        raise RuntimeError("environment table must have fourteen entries")
    return dict(zip(ENVIRONMENTS, values))


def _check_environment(environment: str) -> None:
    if environment not in ENVIRONMENTS:
        raise ValueError(f"environment must be one of {ENVIRONMENTS}, got {environment!r}")


def _check_standard(standard: str) -> None:
    if standard not in STANDARDS:
        raise ValueError(f"standard must be one of {STANDARDS}, got {standard!r}")


def _choice(value: Any, choices: Mapping | Iterable, name: str) -> Any:
    options = list(choices)
    if value not in options:
        raise ValueError(f"{name} must be one of {options}, got {value!r}")
    return value


def _positive(value: float, name: str) -> float:
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be finite and > 0, got {value!r}")
    return value


def _nonnegative(value: float, name: str) -> float:
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be finite and >= 0, got {value!r}")
    return value


def _ratio(value: float, name: str, *, upper: float = 1.0) -> float:
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= upper:
        raise ValueError(f"{name} must be between 0 and {upper}, got {value!r}")
    return value


def _temperature(value: float, name: str = "temperature") -> float:
    value = float(value)
    if not math.isfinite(value) or value <= -273.0:
        raise ValueError(f"{name} must be finite and above absolute zero")
    return value


def _boolean(value: bool | str | int, name: str) -> bool:
    if isinstance(value, bool):
        return value
    if value in (1, "1", "true", "True", "yes", "on"):
        return True
    if value in (0, "0", "false", "False", "no", "off"):
        return False
    raise ValueError(f"{name} must be a boolean, got {value!r}")


def _lookup_band(table: Sequence[tuple[float, float]], value: float, name: str) -> float:
    value = _positive(value, name)
    for upper, result in table:
        if value <= upper:
            return float(result)
    raise ValueError(f"{name}={value:g} exceeds handbook model limit {table[-1][0]:g}")


def _safe_exp(exponent: float, context: str) -> float:
    if exponent > 709.0:
        raise ValueError(f"{context} exponent exceeds floating-point range; check inputs")
    if exponent < -745.0:
        return 0.0
    return math.exp(exponent)


def arrhenius_pi_T(
    T_junction: float,
    Ea: float,
    scale: float = 1.0,
    T_ref: float = 298.0,
) -> float:
    """Return ``scale·exp[-Ea/k(1/(T+273)-1/Tref)]``."""
    temperature = _temperature(T_junction, "T_junction")
    exponent = -float(Ea) / BOLTZMANN_EV * (
        1.0 / (temperature + 273.0) - 1.0 / float(T_ref)
    )
    return float(scale) * _safe_exp(exponent, "Arrhenius temperature factor")


def _coefficient_pi_T(T_celsius: float, coefficient: float, T_ref: float = 298.0) -> float:
    temperature = _temperature(T_celsius)
    exponent = -float(coefficient) * (
        1.0 / (temperature + 273.0) - 1.0 / float(T_ref)
    )
    return _safe_exp(exponent, "temperature factor")


def _learning_factor(years: float) -> float:
    years = _nonnegative(years, "years_in_production")
    # Section 5.10's table explicitly fixes the endpoints at 2.0 for Y<=.1
    # and 1.0 for Y>=2.0; use the printed equation only between them.
    if years <= .1:
        return 2.0
    if years >= 2.0:
        return 1.0
    return 0.01 * _safe_exp(5.35 - 0.35 * years, "learning factor")


# Sections 5.10--5.12 and 6.14 calculation aids.  These are public because
# the handbook makes junction temperature an input to many part models and
# supplies equations/tables for deriving it when measured values are absent.
DEFAULT_CASE_TEMPERATURE = _env([35, 45, 50, 45, 50, 60, 60, 75, 75, 60, 35, 50, 60, 45])

_MICROCIRCUIT_THETA_JC = {
    "dual_in_line": (11.0, 28.0),
    "flat_package": (10.0, 22.0),
    "chip_carrier": (10.0, 26.0),
    "pin_grid_array": (10.0, 20.0),
    "can": (None, 70.0),
}

SEMICONDUCTOR_THETA_JC = {
    "TO-1": 70, "TO-3": 10, "TO-5": 70, "TO-8": 70, "TO-9": 70,
    "TO-12": 70, "TO-18": 70, "TO-28": 5, "TO-33": 70, "TO-39": 70,
    "TO-41": 10, "TO-44": 70, "TO-46": 70, "TO-52": 70, "TO-53": 5,
    "TO-57": 5, "TO-59": 5, "TO-60": 5, "TO-61": 5, "TO-63": 5,
    "TO-66": 10, "TO-71": 70, "TO-72": 70, "TO-83": 5, "TO-89": 22,
    "TO-92": 70, "TO-94": 5, "TO-99": 70, "TO-126": 5, "TO-127": 5,
    "TO-204": 10, "TO-204AA": 10, "TO-205AD": 70, "TO-205AF": 70,
    "TO-220": 5, "DO-4": 5, "DO-5": 5, "DO-7": 10, "DO-8": 5,
    "DO-9": 5, "DO-13": 10, "DO-14": 5, "DO-29": 10, "DO-35": 10,
    "DO-41": 10, "DO-45": 5, "DO-204MB": 70, "DO-205AB": 5,
    "PA-42A": 70, "PA-42B": 70, "PD-36C": 70, "PD-50": 70,
    "PD-77": 70, "PD-180": 70, "PD-319": 70, "PD-262": 70,
    "PD-975": 70, "PD-280": 70, "PD-216": 70, "PT-2G": 70,
    "PT-6B": 70, "PH-13": 70, "PH-16": 70, "PH-56": 70,
    "PY-58": 70, "PY-373": 70,
}

THERMAL_PROVENANCE_BASES = (
    "handbook_table", "measured", "manufacturer", "detailed_analysis",
)


@dataclass(frozen=True)
class ThermalEstimate:
    """Auditable junction-temperature estimate and optional sensitivity.

    Handbook table values are explicitly marked preliminary.  Low/high
    temperatures are calculated only from analyst-supplied thermal-resistance
    bounds; Perdura does not invent a universal uncertainty interval.
    """

    junction_temperature_c: float
    case_temperature_c: float
    theta_jc_c_per_watt: float
    power_dissipation_watts: float
    thermal_basis: str
    source_note: str | None
    preliminary: bool
    junction_temperature_low_c: float | None = None
    junction_temperature_high_c: float | None = None


def _thermal_estimate(
    *,
    case_temperature: float,
    theta_jc: float,
    power_dissipation_watts: float,
    thermal_basis: str,
    source_note: str | None,
    theta_jc_low: float | None,
    theta_jc_high: float | None,
    maximum_rated_junction_temperature: float | None,
) -> ThermalEstimate:
    _choice(thermal_basis, THERMAL_PROVENANCE_BASES, "thermal_basis")
    if thermal_basis != "handbook_table" and not str(source_note or "").strip():
        raise ValueError(
            "source_note is required for measured, manufacturer, or "
            "detailed-analysis thermal data"
        )
    case = _temperature(case_temperature, "case_temperature")
    theta = _positive(theta_jc, "theta_jc")
    power = _nonnegative(power_dissipation_watts, "power_dissipation_watts")
    estimate = junction_temperature(
        case, theta, power, maximum_rated_junction_temperature,
    )
    low = high = None
    if (theta_jc_low is None) != (theta_jc_high is None):
        raise ValueError("provide both theta_jc_low and theta_jc_high or neither")
    if theta_jc_low is not None and theta_jc_high is not None:
        theta_low = _positive(theta_jc_low, "theta_jc_low")
        theta_high = _positive(theta_jc_high, "theta_jc_high")
        if not theta_low <= theta <= theta_high:
            raise ValueError("thermal-resistance bounds must satisfy low <= base <= high")
        low = junction_temperature(case, theta_low, power)
        high = junction_temperature(case, theta_high, power)
    return ThermalEstimate(
        junction_temperature_c=estimate,
        case_temperature_c=case,
        theta_jc_c_per_watt=theta,
        power_dissipation_watts=power,
        thermal_basis=thermal_basis,
        source_note=str(source_note).strip() if source_note else None,
        preliminary=thermal_basis == "handbook_table",
        junction_temperature_low_c=low,
        junction_temperature_high_c=high,
    )

HYBRID_MATERIALS = {
    # material: (typical thickness, thermal conductivity), in and W/in^2/(C/in)
    "silicon": (.010, 2.20), "gaas": (.0070, .76),
    "gold_eutectic": (.0001, 6.9), "solder": (.0030, 1.3),
    "epoxy_dielectric": (.0035, .0060), "epoxy_conductive": (.0035, .15),
    "thick_film_dielectric": (.0030, .66), "alumina": (.025, .64),
    "beryllium_oxide": (.025, 6.6), "kovar": (.020, .42),
    "aluminum": (.020, 4.6), "copper": (.020, 9.9),
}


def microcircuit_custom_screening_pi_q(total_points: float) -> float:
    """Section 5.10 custom-screening equation ``pi_Q = 2 + 87/P``."""
    return 2.0 + 87.0 / _positive(total_points, "total_points")


def microcircuit_gate_count(transistor_count: float, technology: str) -> float:
    """Section 5.1 gate estimate when only transistor count is known.

    Bipolar and non-CMOS MOS logic use three transistors per gate; CMOS uses
    four.  The returned gate-equivalent count can be supplied to the Section
    5.1 digital complexity table.
    """
    _choice(technology, ("bipolar", "cmos", "other_mos"), "technology")
    divisor = 4.0 if technology == "cmos" else 3.0
    return _positive(transistor_count, "transistor_count") / divisor


def junction_temperature(
    case_temperature: float,
    theta_jc: float,
    power_dissipation_watts: float,
    maximum_rated_junction_temperature: float | None = None,
) -> float:
    """Sections 5.11, 5.12 and 6.14: ``T_J = T_C + theta_JC P``."""
    case = _temperature(case_temperature, "case_temperature")
    resistance = _positive(theta_jc, "theta_jc")
    power = _nonnegative(power_dissipation_watts, "power_dissipation_watts")
    result = case + resistance * power
    if maximum_rated_junction_temperature is not None:
        maximum = _temperature(
            maximum_rated_junction_temperature,
            "maximum_rated_junction_temperature",
        )
        if result > maximum:
            raise ValueError(
                "calculated junction temperature exceeds the device rating; "
                "the MIL-HDBK-217F model is not applicable under overstress"
            )
    return result


def microcircuit_junction_temperature(
    power_dissipation_watts: float, *, case_temperature: float | None = None,
    environment: str | None = None, theta_jc: float | None = None,
    package_type: str | None = None, die_area_mils2: float | None = None,
    maximum_rated_junction_temperature: float | None = None,
    return_details: bool = False, thermal_basis: str | None = None,
    thermal_source_note: str | None = None,
    theta_jc_low: float | None = None, theta_jc_high: float | None = None,
) -> float | ThermalEstimate:
    """Section 5.11 junction temperature using measured or handbook defaults."""
    if case_temperature is None:
        if environment is None:
            raise ValueError("provide case_temperature or environment")
        _check_environment(environment)
        case_temperature = float(DEFAULT_CASE_TEMPERATURE[environment])
    table_theta = theta_jc is None
    if table_theta:
        if package_type is None or die_area_mils2 is None:
            raise ValueError("provide theta_jc or package_type and die_area_mils2")
        _choice(package_type, _MICROCIRCUIT_THETA_JC, "package_type")
        large, small = _MICROCIRCUIT_THETA_JC[package_type]
        theta_jc = large if _nonnegative(die_area_mils2, "die_area_mils2") > 14400 else small
        if theta_jc is None:
            raise ValueError("Section 5.11 gives no large-die default for a can package")
    if not return_details:
        return junction_temperature(
            case_temperature,
            theta_jc,
            power_dissipation_watts,
            maximum_rated_junction_temperature,
        )
    if table_theta:
        if thermal_basis not in (None, "handbook_table"):
            raise ValueError("a handbook package-table theta must use thermal_basis='handbook_table'")
        thermal_basis = "handbook_table"
    elif thermal_basis is None:
        raise ValueError("thermal_basis is required when an explicit theta_jc is used")
    return _thermal_estimate(
        case_temperature=case_temperature,
        theta_jc=theta_jc,
        power_dissipation_watts=power_dissipation_watts,
        thermal_basis=thermal_basis,
        source_note=thermal_source_note,
        theta_jc_low=theta_jc_low,
        theta_jc_high=theta_jc_high,
        maximum_rated_junction_temperature=maximum_rated_junction_temperature,
    )


def semiconductor_junction_temperature(
    power_dissipation_watts: float, *, case_temperature: float | None = None,
    environment: str | None = None, theta_jc: float | None = None,
    package_type: str | None = None,
    maximum_rated_junction_temperature: float | None = None,
    return_details: bool = False, thermal_basis: str | None = None,
    thermal_source_note: str | None = None,
    theta_jc_low: float | None = None, theta_jc_high: float | None = None,
) -> float | ThermalEstimate:
    """Section 6.14 junction temperature using an explicit or table theta.

    There is intentionally no generic 70 °C/W fallback.  A package-table row
    or an explicit thermal resistance with a documented basis is required.
    """
    if case_temperature is None:
        if environment is None:
            raise ValueError("provide case_temperature or environment")
        _check_environment(environment)
        case_temperature = float(DEFAULT_CASE_TEMPERATURE[environment])
    table_theta = theta_jc is None
    if table_theta:
        if package_type is None:
            raise ValueError("provide theta_jc or a Section 6.14 package_type")
        normalized = package_type.upper()
        _choice(normalized, SEMICONDUCTOR_THETA_JC, "package_type")
        theta_jc = float(SEMICONDUCTOR_THETA_JC[normalized])
    if not return_details:
        return junction_temperature(
            case_temperature,
            theta_jc,
            power_dissipation_watts,
            maximum_rated_junction_temperature,
        )
    if table_theta:
        if thermal_basis not in (None, "handbook_table"):
            raise ValueError("a handbook package-table theta must use thermal_basis='handbook_table'")
        thermal_basis = "handbook_table"
    elif thermal_basis is None:
        raise ValueError("thermal_basis is required when an explicit theta_jc is used")
    return _thermal_estimate(
        case_temperature=case_temperature,
        theta_jc=theta_jc,
        power_dissipation_watts=power_dissipation_watts,
        thermal_basis=thermal_basis,
        source_note=thermal_source_note,
        theta_jc_low=theta_jc_low,
        theta_jc_high=theta_jc_high,
        maximum_rated_junction_temperature=maximum_rated_junction_temperature,
    )


def hybrid_die_area(active_wire_terminals: int) -> float:
    """Section 5.12 estimate ``A=[.00278 N + .0417]^2`` square inches."""
    terminals = int(_positive(active_wire_terminals, "active_wire_terminals"))
    return (.00278 * terminals + .0417) ** 2


def hybrid_junction_to_case_thermal_resistance(
    layers: Sequence[str | tuple[float, float]], die_area_sq_inches: float,
) -> float:
    """Section 5.12 ``theta_JC = sum_i[(1/K_i)L_i]/A``.

    Each layer may be a key in :data:`HYBRID_MATERIALS` or an explicit
    ``(thickness_inches, thermal_conductivity)`` pair.
    """
    if not layers:
        raise ValueError("layers must not be empty")
    numerator = 0.0
    for layer in layers:
        if isinstance(layer, str):
            _choice(layer, HYBRID_MATERIALS, "hybrid material")
            thickness, conductivity = HYBRID_MATERIALS[layer]
        else:
            if len(layer) != 2:
                raise ValueError("each explicit layer must be (thickness, conductivity)")
            thickness, conductivity = layer
        numerator += _positive(thickness, "layer thickness") / _positive(conductivity, "thermal conductivity")
    return numerator / _positive(die_area_sq_inches, "die_area_sq_inches")


def hybrid_junction_temperature(
    case_temperature: float, power_dissipation_watts: float, *,
    theta_jc: float | None = None,
    layers: Sequence[str | tuple[float, float]] | None = None,
    die_area_sq_inches: float | None = None,
) -> float:
    """Section 5.12 hybrid die junction-temperature calculation."""
    if theta_jc is None:
        if layers is None or die_area_sq_inches is None:
            raise ValueError("provide theta_jc or both layers and die_area_sq_inches")
        theta_jc = hybrid_junction_to_case_thermal_resistance(layers, die_area_sq_inches)
    return junction_temperature(case_temperature, theta_jc, power_dissipation_watts)


def _step(
    symbol: str,
    description: str,
    expression: str,
    substitution: str,
    value: float | str,
    unit: str = "dimensionless",
    expression_latex: str | None = None,
) -> dict[str, Any]:
    step = {
        "symbol": symbol,
        "description": description,
        "expression": expression,
        "substitution": substitution,
        "value": float(value) if isinstance(value, (int, float)) else value,
        "unit": unit,
    }
    if expression_latex is not None:
        step["expression_latex"] = expression_latex
    return step


class _Part:
    """Base object with calculation and handbook traceability metadata."""

    category = "part"

    def __init__(self, name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        if int(quantity) != quantity or int(quantity) < 1:
            raise ValueError("quantity must be a positive integer")
        multiplier = _positive(multiplier, "multiplier")
        self.name = name or self.__class__.__name__
        self.quantity = int(quantity)
        self.multiplier = multiplier
        self._base_failure_rate = 0.0
        self.pi_factors: dict[str, Any] = {}
        self.traceability: dict[str, Any] = {}
        self.calculation_steps: list[dict[str, Any]] = []
        self.assumptions: list[str] = []
        self.warnings: list[str] = []

    @property
    def failure_rate(self) -> float:
        return self._base_failure_rate * self.multiplier

    @failure_rate.setter
    def failure_rate(self, value: float) -> None:
        value = float(value)
        if not math.isfinite(value) or value < 0:
            raise ValueError("calculated failure rate must be finite and >= 0")
        self._base_failure_rate = value

    @property
    def total_failure_rate(self) -> float:
        return self.failure_rate * self.quantity

    @property
    def long_form(self) -> dict[str, Any]:
        return {
            "traceability": dict(self.traceability),
            "steps": list(self.calculation_steps),
            "assumptions": list(self.assumptions),
            "warnings": list(self.warnings),
            "unmultiplied_failure_rate": self._base_failure_rate,
            "multiplier": self.multiplier,
            "failure_rate": self.failure_rate,
            "quantity": self.quantity,
            "total_failure_rate": self.total_failure_rate,
            "unit": FPMH,
        }

    def _finish(
        self,
        rate: float,
        *,
        section: str,
        pages: str,
        equation: str,
        model: str,
        factors: Mapping[str, Any],
        steps: Sequence[dict[str, Any]],
        assumptions: Sequence[str] = (),
        warnings: Sequence[str] = (),
    ) -> None:
        factor_values = dict(factors)
        quality_basis = factor_values.pop("_quality_basis", None)
        self.pi_factors = factor_values
        self.traceability = {
            "standard": HANDBOOK_EDITION,
            "section": section,
            "handbook_pages": pages,
            "model": model,
            "equation": equation,
            "unit": FPMH,
            "result_context": PREDICTION_RESULT_CONTEXT,
        }
        if quality_basis is not None:
            self.traceability["quality_basis"] = quality_basis
        self.calculation_steps = list(steps)
        self.assumptions = list(assumptions)
        self.warnings = list(warnings)
        self.failure_rate = rate

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}(name={self.name!r}, "
            f"failure_rate={self.failure_rate:.6g} FPMH, quantity={self.quantity})"
        )


def annotate_vita_result(
    part: _Part,
    category: str | None = None,
    *,
    extra_rules: Sequence[str] = (),
    assumptions: Sequence[str] = (),
    warnings: Sequence[str] = (),
) -> _Part:
    """Attach an idempotent A/V51.1 clause trail to a calculated part.

    A/V51.1 is subsidiary to, rather than a replacement for,
    MIL-HDBK-217F Notice 2.  Keeping both source identities in one result is
    important: the handbook supplies the base equation and A/V supplies the
    changed defaults, added table rows, or permitted alternate method.
    """
    category = category or part.category
    existing_rules = tuple(part.traceability.get("supplement_rules", ()))
    rules = list(dict.fromkeys((
        *existing_rules, *VITA_CATEGORY_RULES.get(category, ()), *extra_rules,
    )))
    part.traceability["standard"] = f"{HANDBOOK_EDITION} + {VITA_EDITION}"
    part.traceability["supplement"] = VITA_EDITION
    part.traceability["supplement_rules"] = rules
    part.pi_factors["vita_51_1_applied"] = True
    part.pi_factors["vita_rule_count"] = len(rules)
    pedigree = (
        "A/V51.1 commercial-part defaults assume known pedigree and an "
        "effective counterfeit-parts control plan as described in Appendix C."
    )
    for item in (pedigree, *assumptions):
        if item not in part.assumptions:
            part.assumptions.append(item)
    for item in warnings:
        if item not in part.warnings:
            part.warnings.append(item)
    return part


def vita_manufacturer_microcircuit_rate(
    manufacturer_rate_fpmh: float,
    *,
    pi_T: float,
    pi_E: float,
    manufacturer_pi_T: float,
    manufacturer_pi_E: float,
) -> float:
    """A/V51.1 Permission 2.3.4-1 digital-logic conversion equation.

    ``lambda_p = [1 + (pi_T-pi_TMFR)/pi_TMFR +
    (pi_E-pi_EMFR)/pi_EMFR] lambda_BMFR``.
    """
    rate = _nonnegative(manufacturer_rate_fpmh, "manufacturer_rate_fpmh")
    target_t = _positive(pi_T, "pi_T")
    target_e = _positive(pi_E, "pi_E")
    source_t = _positive(manufacturer_pi_T, "manufacturer_pi_T")
    source_e = _positive(manufacturer_pi_E, "manufacturer_pi_E")
    factor = 1.0 + (target_t - source_t) / source_t + (target_e - source_e) / source_e
    if factor < 0:
        raise ValueError(
            "A/V51.1 manufacturer-data adjustment is negative for these "
            "source/usage factors; use a documented alternate conversion method"
        )
    return rate * factor


def vita_parts_count_manufacturer_rate(
    manufacturer_rate_fpmh: float,
    *,
    target_generic_rate_fpmh: float,
    reference_generic_rate_fpmh: float,
) -> float:
    """A/V51.1 Permission 2.3.4-3 / Appendix H ratio conversion."""
    rate = _nonnegative(manufacturer_rate_fpmh, "manufacturer_rate_fpmh")
    target = _nonnegative(target_generic_rate_fpmh, "target_generic_rate_fpmh")
    reference = _positive(reference_generic_rate_fpmh, "reference_generic_rate_fpmh")
    return rate * target / reference


# ---------------------------------------------------------------------------
# Section 5: microcircuits
# ---------------------------------------------------------------------------

_PI_E_MICROCIRCUIT = _env([0.5, 2, 4, 4, 6, 4, 5, 5, 8, 8, 0.5, 5, 12, 220])
_PI_Q_MICROCIRCUIT = {"S": 0.25, "B": 1.0, "B-1": 2.0, "commercial": 10.0}
MICROCIRCUIT_QUALITY_LABELS = {
    "S": "S — 217F Class-S family (πQ=0.25)",
    "B": "B — 217F Class-B family (πQ=1)",
    "B-1": (
        "B-1 — 217F §1.2.1-compliant non-JAN screening bucket (πQ=2)"
    ),
    "commercial": "Commercial/unknown screening (πQ=10)",
}

_C1_DIGITAL = {
    "bipolar": [(100, .0025), (1000, .0050), (3000, .010), (10000, .020), (30000, .040), (60000, .080)],
    "mos": [(100, .010), (1000, .020), (3000, .040), (10000, .080), (30000, .16), (60000, .29)],
}
_C1_LINEAR = [(100, .010), (300, .020), (1000, .040), (10000, .060)]
_C1_PLA = {
    "bipolar": [(200, .010), (1000, .021), (5000, .042)],
    "mos": [(500, .00085), (1000, .0017), (5000, .0034), (20000, .0068)],
}
_C1_MICROPROCESSOR = {
    "bipolar": [(8, .060), (16, .12), (32, .24)],
    "mos": [(8, .14), (16, .28), (32, .56)],
}
_C1_MEMORY = {
    ("mos", "rom"): [(16384, .00065), (65536, .0013), (262144, .0026), (1048576, .0052)],
    ("mos", "prom"): [(16384, .00085), (65536, .0017), (262144, .0034), (1048576, .0068)],
    ("mos", "uvprom"): [(16384, .00085), (65536, .0017), (262144, .0034), (1048576, .0068)],
    ("mos", "eeprom"): [(16384, .00085), (65536, .0017), (262144, .0034), (1048576, .0068)],
    ("mos", "eaprom"): [(16384, .00085), (65536, .0017), (262144, .0034), (1048576, .0068)],
    ("mos", "dram"): [(16384, .0013), (65536, .0025), (262144, .0050), (1048576, .010)],
    ("mos", "sram"): [(16384, .0078), (65536, .016), (262144, .031), (1048576, .062)],
    ("bipolar", "rom"): [(16384, .0094), (65536, .019), (262144, .038), (1048576, .075)],
    ("bipolar", "prom"): [(16384, .0094), (65536, .019), (262144, .038), (1048576, .075)],
    ("bipolar", "sram"): [(16384, .0052), (65536, .011), (262144, .021), (1048576, .042)],
}

# A/V51.1 Table 2.1.2-1 continues selected Section 5.1 C1 tables.  These
# values are used only when the supplement is active.  Values above the last
# printed A/V band must be supplied explicitly rather than extrapolated.
_VITA_C1_LINEAR = [(100, .010), (300, .020), (1000, .040), (10000, .060), (30000, .080), (60000, .100)]
_VITA_C1_PLA = {
    "bipolar": [(200, .010), (1000, .021), (5000, .042), (10000, .084), (30000, .168), (60000, .336)],
    "mos": [(500, .00085), (1000, .0017), (5000, .0034), (20000, .0068), (30000, .0136), (60000, .0272)],
}
_VITA_C1_MICROPROCESSOR = {
    "bipolar": [(8, .060), (16, .12), (32, .24), (64, .48), (128, .96)],
    "mos": [(8, .14), (16, .28), (32, .56), (64, 1.12), (128, 2.24)],
}
_VITA_MEMORY_EXTENSIONS = {
    ("mos", "rom"): [(4_194_304, .0104), (16_777_216, .0208), (67_108_864, .0416), (268_435_456, .0832)],
    ("mos", "prom"): [(4_194_304, .0136), (16_777_216, .0272), (67_108_864, .0544), (268_435_456, .1088)],
    ("mos", "uvprom"): [(4_194_304, .0136), (16_777_216, .0272), (67_108_864, .0544), (268_435_456, .1088)],
    ("mos", "eeprom"): [(4_194_304, .0136), (16_777_216, .0272), (67_108_864, .0544), (268_435_456, .1088)],
    ("mos", "eaprom"): [(4_194_304, .0136), (16_777_216, .0272), (67_108_864, .0544), (268_435_456, .1088)],
    ("mos", "dram"): [(4_194_304, .020), (16_777_216, .040), (67_108_864, .080), (268_435_456, .160)],
    ("mos", "sram"): [(4_194_304, .124), (16_777_216, .248), (67_108_864, .496), (268_435_456, .992)],
    ("bipolar", "rom"): [(4_194_304, .150), (16_777_216, .300), (67_108_864, .600), (268_435_456, 1.20)],
    ("bipolar", "prom"): [(4_194_304, .150), (16_777_216, .300), (67_108_864, .600), (268_435_456, 1.20)],
    ("bipolar", "sram"): [(4_194_304, .084), (16_777_216, .168), (67_108_864, .336), (268_435_456, .672)],
}
_VITA_C1_MEMORY = {
    key: [*values, *_VITA_MEMORY_EXTENSIONS[key]]
    for key, values in _C1_MEMORY.items()
}
_C2_PACKAGE = {
    "hermetic_dip": (2.8e-4, 1.08),
    "hermetic_pga": (2.8e-4, 1.08),
    "hermetic_smt": (2.8e-4, 1.08),
    "glass_dip": (9.0e-5, 1.51),
    "flatpack": (3.0e-5, 1.82),
    "can": (3.0e-5, 2.01),
    "nonhermetic": (3.6e-4, 1.08),
    "nonhermetic_dip": (3.6e-4, 1.08),
    "nonhermetic_pga": (3.6e-4, 1.08),
    "nonhermetic_smt": (3.6e-4, 1.08),
}

_EEPROM_A1_FLOTOX = [
    (100, .00070), (200, .0014), (500, .0034), (1000, .0068),
    (3000, .020), (7000, .049), (15000, .10), (20000, .14),
    (30000, .20), (100000, .68), (200000, 1.3), (400000, 2.7),
    (500000, 3.4),
]
_EEPROM_A1_TEXTURED = [
    (100, .0097), (200, .014), (500, .023), (1000, .033), (3000, .061),
    (7000, .14), (15000, .30), (20000, .30), (30000, .30),
    (100000, .30), (200000, .30), (400000, .30), (500000, .30),
]
_EEPROM_A2_TEXTURED = [(300000, 0.0), (400000, 1.1), (500000, 2.3)]
_PI_ECC = {"none": 1.0, "hamming": .72, "redundant_cell": .68}


def _micro_pi_q(quality: str, standard: str, override: float | None) -> float:
    _choice(quality, _PI_Q_MICROCIRCUIT, "quality")
    if override is not None:
        return _positive(override, "pi_Q")
    value = _PI_Q_MICROCIRCUIT[quality]
    if standard == "VITA-51.1":
        value = VITA_51_1_PI_Q["microcircuit"].get(quality, value)
    return value


def _micro_quality_basis(
    quality: str, standard: str, override: float | None, effective: float,
) -> str:
    label = MICROCIRCUIT_QUALITY_LABELS[quality]
    if override is not None:
        return f"{label}; analyst-supplied effective πQ={effective:g}"
    if standard == "VITA-51.1" and effective != _PI_Q_MICROCIRCUIT[quality]:
        return (
            f"{label}; A/V51.1 known-pedigree commercial-part rule changes "
            f"the effective πQ to {effective:g}"
        )
    return label


def _micro_pi_l(years: float, standard: str) -> float:
    # A/V51.1 Suggestion 2.1.2-2 says to enter years in production for
    # part-stress calculations.  Its fixed pi_L=1 default is Rule 2.2.2-2 and
    # therefore applies only to the parts-count method.
    return _learning_factor(years)


def _eeprom_cycling_rate(
    *,
    technology: str,
    bits: int,
    programming_cycles: float,
    T_junction: float,
    pi_Q: float,
    ecc: str,
    system_lifetime_hours: float,
) -> tuple[float, dict[str, float], list[dict[str, Any]]]:
    _choice(technology, ("flotox", "textured_poly"), "eeprom_technology")
    _choice(ecc, _PI_ECC, "ecc")
    cycles = _nonnegative(programming_cycles, "programming_cycles")
    if cycles > 500000:
        raise ValueError("programming_cycles exceeds the Section 5.2 model limit of 500,000")
    bits = int(_positive(bits, "bits"))
    lifetime_scale = _positive(system_lifetime_hours, "system_lifetime_hours") / 10000.0
    pi_ecc = _PI_ECC[ecc]
    T = _temperature(T_junction, "T_junction")
    if technology == "flotox":
        # Section 5.2 supplies both the continuous 6.817e-6*C relation and
        # an authoritative tabulation.  The handbook worked example uses the
        # tabulated (.10 for 7K<C<=15K), so predictions follow the table.
        A1 = _lookup_band(_EEPROM_A1_FLOTOX, max(cycles, 1e-300), "programming_cycles") if cycles else 0.0
        A2 = 0.0
        B1 = (bits / 16000.0) ** .5 * _safe_exp(
            -.15 / BOLTZMANN_EV * (1.0 / (T + 273.0) - 1.0 / 333.0),
            "Flotox B1",
        )
        B2 = 0.0
    else:
        A1 = _lookup_band(_EEPROM_A1_TEXTURED, max(cycles, 1e-300), "programming_cycles") if cycles else 0.0
        A2 = _lookup_band(_EEPROM_A2_TEXTURED, max(cycles, 1e-300), "programming_cycles") if cycles else 0.0
        B1 = (bits / 64000.0) ** .25 * _safe_exp(
            -.12 / BOLTZMANN_EV * (1.0 / (T + 273.0) - 1.0 / 303.0),
            "textured-poly B1",
        )
        B2 = (bits / 64000.0) ** .25 * _safe_exp(
            .1 / BOLTZMANN_EV * (1.0 / (T + 273.0) - 1.0 / 303.0),
            "textured-poly B2",
        )
    A1 *= lifetime_scale
    A2 *= lifetime_scale
    rate = (A1 * B1 + A2 * B2 / pi_Q) * pi_ecc
    factors = {"A1": A1, "B1": B1, "A2": A2, "B2": B2, "pi_ECC": pi_ecc}
    steps = [
        _step("A1", "cycling factor", "A1(C)·L/10000", f"C={cycles:g}, L={system_lifetime_hours:g}", A1),
        _step("B1", "size/temperature factor", "technology-specific B1", f"B={bits}, Tj={T:g}°C", B1),
        _step("A2", "high-cycle factor", "A2(C)·L/10000", f"C={cycles:g}, L={system_lifetime_hours:g}", A2),
        _step("B2", "high-cycle size/temperature factor", "technology-specific B2", f"B={bits}, Tj={T:g}°C", B2),
        _step("λcyc", "read/write cycling contribution", "[A1B1+(A2B2)/πQ]πECC", f"[{A1:g}·{B1:g}+({A2:g}·{B2:g})/{pi_Q:g}]·{pi_ecc:g}", rate, FPMH),
    ]
    return rate, factors, steps


class Microcircuit(_Part):
    """Sections 5.1 and 5.2 monolithic IC and memory part-stress model."""

    category = "microcircuit"

    def __init__(
        self,
        device_type: str = "digital",
        technology: str = "mos",
        complexity: int = 1000,
        pins: int = 16,
        package: str = "nonhermetic",
        T_junction: float = 50.0,
        quality: str = "commercial",
        years_in_production: float = 2.0,
        environment: str = "GB",
        standard: str = "MIL-HDBK-217F",
        pi_Q: float | None = None,
        memory_type: str = "rom",
        eeprom_technology: str = "flotox",
        programming_cycles: float = 0.0,
        ecc: str = "none",
        system_lifetime_hours: float = 10000.0,
        c1_override: float | None = None,
        feature_size_nm: float | None = None,
        temperature_rise_used: bool | str | int = False,
        temperature_rise_source: str | None = None,
        manufacturer_rate_fpmh: float | None = None,
        manufacturer_test_junction_temperature_c: float = 55.0,
        manufacturer_test_environment: str = "GB",
        name: str | None = None,
        quantity: int = 1,
        multiplier: float = 1.0,
    ):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment)
        _check_standard(standard)
        _choice(technology, ("mos", "bipolar"), "technology")
        package_requested = package
        if standard == "VITA-51.1" and quality == "commercial":
            # Rule 2.1.2-3: commercial PEM/DIP/PGA/SMT packages use the
            # nonhermetic package equation.
            package = "nonhermetic"
        _choice(package, _C2_PACKAGE, "package")
        complexity = int(_positive(complexity, "complexity"))
        pins = int(_positive(pins, "pins"))
        T_junction = _temperature(T_junction, "T_junction")
        pi_q = _micro_pi_q(quality, standard, pi_Q)
        pi_l = _micro_pi_l(years_in_production, standard)
        explicit_c1 = None if c1_override is None else _positive(c1_override, "c1_override")
        source_used = _boolean(temperature_rise_used, "temperature_rise_used")
        if source_used and not str(temperature_rise_source or "").strip():
            raise ValueError(
                "A/V51.1 Rule 2.1.2-4 requires temperature_rise_source when "
                "a case-to-junction or other temperature-rise calculation is used"
            )
        vita_warnings: list[str] = []
        vita_assumptions: list[str] = []
        model_mapping: dict[str, str] | None = None
        if memory_type == "ccd" and device_type != "memory":
            raise ValueError("CCD requires device_type='memory'")
        if feature_size_nm is not None:
            feature = _positive(feature_size_nm, "feature_size_nm")
            if standard == "VITA-51.1" and feature < 130:
                vita_warnings.append(
                    "Feature size is below 130 nm; A/V51.1 Recommendation "
                    "2.1.2-1 calls for separate VITA 51.2/equivalent EM, TDDB, "
                    "HCI, and NBTI wearout analysis. This random-rate result "
                    "does not include those wearout mechanisms."
                )
        if source_used:
            vita_assumptions.append(
                f"Junction-temperature rise source: {str(temperature_rise_source).strip()}."
            )

        lambda_cyc = 0.0
        cyc_factors: dict[str, float] = {}
        cyc_steps: list[dict[str, Any]] = []
        if device_type == "digital":
            C1 = explicit_c1 if explicit_c1 is not None else _lookup_band(_C1_DIGITAL[technology], complexity, "gate count")
            Ea = .35 if technology == "mos" else .4
            section, pages, descriptor = "5.1", "5-2, 5-12–5-17", "gate/logic array"
        elif device_type == "linear":
            table = _VITA_C1_LINEAR if standard == "VITA-51.1" else _C1_LINEAR
            C1 = explicit_c1 if explicit_c1 is not None else _lookup_band(table, complexity, "transistor count")
            Ea = .65
            section, pages, descriptor = "5.1", "5-2, 5-12–5-17", "linear microcircuit"
        elif device_type in ("pla", "programmable_logic"):
            table = _VITA_C1_PLA[technology] if standard == "VITA-51.1" else _C1_PLA[technology]
            C1 = explicit_c1 if explicit_c1 is not None else _lookup_band(table, complexity, "gate count")
            Ea = .35 if technology == "mos" else .4
            section, pages, descriptor = "5.1", "5-2, 5-12–5-17", "PLA/PAL"
        elif device_type == "microprocessor":
            table = _VITA_C1_MICROPROCESSOR[technology] if standard == "VITA-51.1" else _C1_MICROPROCESSOR[technology]
            C1 = explicit_c1 if explicit_c1 is not None else _lookup_band(table, complexity, "data width")
            Ea = .35 if technology == "mos" else .4
            section, pages, descriptor = "5.1", "5-2, 5-12–5-17", "microprocessor"
        elif device_type == "memory":
            memory_aliases = {"sdram": "dram", "nvsram": "sram", "flash": "eeprom"}
            requested_memory_type = memory_type
            ccd_mapping = memory_type == "ccd"
            if ccd_mapping:
                if technology != "mos":
                    raise ValueError(
                        "CCD memory is supported only as the NMOS dynamic-RAM "
                        "mapping documented by RADC-TR-80-237"
                    )
                memory_type = "dram"
                model_mapping = {
                    "requested_model": "CCD memory",
                    "effective_model": "NMOS dynamic RAM",
                    "source": "RADC-TR-80-237 (July 1980), Section IV.E-F",
                }
                vita_assumptions.append(
                    "RADC-TR-80-237 maps CCD memory to the NMOS dynamic-RAM "
                    "model without changing its coefficients."
                )
                vita_warnings.append(
                    "The CCD mapping was assessed from limited Intel 2416 "
                    "field and Fairchild F464 test data; soft errors are "
                    "explicitly outside this catastrophic/drift failure model."
                )
            elif memory_type in memory_aliases:
                if standard != "VITA-51.1":
                    raise ValueError(
                        "SDRAM, NVSRAM, and Flash mappings are A/V51.1 rules; "
                        "enable A/V51.1 or select the underlying MIL memory type"
                    )
                memory_type = memory_aliases[memory_type]
                vita_assumptions.append(
                    f"A/V51.1 maps {requested_memory_type.upper()} to {memory_type.upper()} for the Section 5 model."
                )
            key = (technology, memory_type)
            # RADC-TR-80-237 supports the then-current NMOS dynamic-RAM model,
            # not A/V51.1's later DRAM complexity continuation.  Other A/V
            # package and quality rules may still apply when requested.
            table_map = (
                _C1_MEMORY if ccd_mapping
                else _VITA_C1_MEMORY if standard == "VITA-51.1"
                else _C1_MEMORY
            )
            _choice(key, table_map, "technology/memory_type combination")
            C1 = explicit_c1 if explicit_c1 is not None else _lookup_band(table_map[key], complexity, "memory size")
            Ea = .6
            descriptor = (
                "CCD memory mapped to NMOS dynamic RAM"
                if ccd_mapping else f"{memory_type.upper()} memory"
            )
            section, pages = "5.2", "5-3–5-6, 5-12–5-17"
            if memory_type == "eeprom":
                lambda_cyc, cyc_factors, cyc_steps = _eeprom_cycling_rate(
                    technology=eeprom_technology,
                    bits=complexity,
                    programming_cycles=programming_cycles,
                    T_junction=T_junction,
                    pi_Q=pi_q,
                    ecc=ecc,
                    system_lifetime_hours=system_lifetime_hours,
                )
        else:
            raise ValueError("device_type must be digital, linear, pla, microprocessor, or memory")

        coefficient, exponent = _C2_PACKAGE[package]
        C2 = coefficient * pins ** exponent
        pi_t = arrhenius_pi_T(T_junction, Ea, scale=.1)
        pi_e = float(_PI_E_MICROCIRCUIT[environment])
        die_term = C1 * pi_t
        package_term = C2 * pi_e
        rate = (die_term + package_term + lambda_cyc) * pi_q * pi_l
        factors = {
            "C1": C1, "pi_T": pi_t, "C2": C2, "pi_E": pi_e,
            "lambda_cyc": lambda_cyc, "pi_Q": pi_q, "pi_L": pi_l,
            "_quality_basis": _micro_quality_basis(quality, standard, pi_Q, pi_q),
            **cyc_factors,
        }
        steps = [
            _step("C1", "die complexity failure rate", "table lookup", f"{descriptor}, complexity={complexity}", C1, FPMH),
            _step("πT", "temperature factor", ".1 exp[-Ea/k(1/(Tj+273)-1/298)]", f"Ea={Ea:g}, Tj={T_junction:g}°C", pi_t),
            _step("C2", "package failure rate", "a·Np^b", f"{coefficient:g}·{pins}^{exponent:g}", C2, FPMH),
            _step("πE", "environment factor", "table lookup", f"environment={environment}", pi_e),
            *cyc_steps,
            _step("πQ", "quality factor", "table/custom lookup", f"quality={quality}", pi_q),
            _step("πL", "learning factor", "max[1,.01 exp(5.35-.35Y)]", f"Y={years_in_production:g}", pi_l),
            _step("λp", "part failure rate", "(C1πT+C2πE+λcyc)πQπL", f"({C1:g}·{pi_t:g}+{C2:g}·{pi_e:g}+{lambda_cyc:g})·{pi_q:g}·{pi_l:g}", rate, FPMH),
        ]
        final_equation = "λp = (C1 πT + C2 πE + λcyc) πQ πL" if device_type == "memory" else "λp = (C1 πT + C2 πE) πQ πL"
        if manufacturer_rate_fpmh is not None and standard == "VITA-51.1":
            if device_type != "digital":
                raise ValueError(
                    "A/V51.1 Permission 2.3.4-1 supplies the direct pi-factor "
                    "manufacturer conversion only for digital logic; use the "
                    "Appendix H parts-count ratio method for another device type"
                )
            _check_environment(manufacturer_test_environment)
            if manufacturer_test_environment != "GB":
                raise ValueError(
                    "A/V51.1 Permission 2.3.4-1 defines the direct digital-logic "
                    "conversion from a Ground Benign manufacturer test condition"
                )
            source_t = arrhenius_pi_T(
                manufacturer_test_junction_temperature_c, Ea, scale=.1
            )
            source_e = float(_PI_E_MICROCIRCUIT[manufacturer_test_environment])
            rate = vita_manufacturer_microcircuit_rate(
                manufacturer_rate_fpmh,
                pi_T=pi_t,
                pi_E=pi_e,
                manufacturer_pi_T=source_t,
                manufacturer_pi_E=source_e,
            )
            factors.update({
                "lambda_BMFR": float(manufacturer_rate_fpmh),
                "pi_TMFR": source_t,
                "pi_EMFR": source_e,
                "manufacturer_adjustment_factor": rate / float(manufacturer_rate_fpmh) if manufacturer_rate_fpmh else 0.0,
            })
            steps.append(_step(
                "λp,MFR", "temperature/environment-adjusted manufacturer rate",
                "[1+(πT-πTMFR)/πTMFR+(πE-πEMFR)/πEMFR]λBMFR",
                f"[1+({pi_t:g}-{source_t:g})/{source_t:g}+({pi_e:g}-{source_e:g})/{source_e:g}]·{float(manufacturer_rate_fpmh):g}",
                rate, FPMH,
            ))
            final_equation = "λp = [1 + (πT-πTMFR)/πTMFR + (πE-πEMFR)/πEMFR] λBMFR"
            vita_assumptions.append(
                "Manufacturer data replace the MIL Section 5 predicted rate under A/V51.1 Permission 2.1.2-2 and are adjusted by Permission 2.3.4-1."
            )
        if explicit_c1 is not None:
            vita_assumptions.append(
                f"C1={explicit_c1:g} was supplied by the analyst; A/V51.1 Rule 2.1.2-2 requires its derivation method in the disclosure."
            )
        if package != package_requested:
            vita_assumptions.append(
                f"Commercial package input {package_requested!r} was replaced by the A/V51.1 nonhermetic default."
            )
        self._finish(
            rate, section=section, pages=pages,
            equation=final_equation,
            model=descriptor, factors=factors, steps=steps,
            assumptions=(("λcyc is zero except for Flotox or textured-poly EEPROMs.",) if device_type == "memory" else ()) + tuple(vita_assumptions),
            warnings=tuple(vita_warnings),
        )
        if standard == "VITA-51.1":
            annotate_vita_result(
                self, self.category,
                extra_rules=(
                    ("Rule 2.3.4-1", "Permission 2.3.4-1")
                    if manufacturer_rate_fpmh is not None else ()
                ),
            )
        if model_mapping is not None:
            self.traceability["model_mapping"] = model_mapping


class VHSICMicrocircuit(_Part):
    """Section 5.3 simplified VHSIC/VHSIC-like/VLSI CMOS model."""

    category = "vhsic_microcircuit"

    def __init__(
        self,
        part_type: str = "logic_custom",
        manufacturing_process: str = "non_qml",
        die_area_cm2: float = .21,
        feature_size_microns: float = 2.0,
        pins: int = 64,
        package_type: str = "dip",
        hermetic: bool = True,
        esd_threshold_volts: float = 0.0,
        T_junction: float = 50.0,
        quality: str = "commercial",
        environment: str = "GB",
        pi_Q: float | None = None,
        standard: str = "MIL-HDBK-217F",
        name: str | None = None,
        quantity: int = 1,
        multiplier: float = 1.0,
    ):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment)
        _check_standard(standard)
        lambda_bd = {"logic_custom": .16, "gate_array_memory": .24}[_choice(part_type, ("logic_custom", "gate_array_memory"), "part_type")]
        pi_mfg = {"qml_qpl": .55, "non_qml": 2.0}[_choice(manufacturing_process, ("qml_qpl", "non_qml"), "manufacturing_process")]
        area = _positive(die_area_cm2, "die_area_cm2")
        feature = _positive(feature_size_microns, "feature_size_microns")
        pins = int(_positive(pins, "pins"))
        pi_cd = (area / .21) * (2.0 / feature) ** 2 * .64 + .36
        pi_t = arrhenius_pi_T(T_junction, .35, scale=.1)
        _choice(package_type, ("dip", "pin_grid_array", "chip_carrier"), "package_type")
        hermetic_requested = _boolean(hermetic, "hermetic")
        hermetic = False if standard == "VITA-51.1" and quality == "commercial" else hermetic_requested
        pi_pt_table = {
            "dip": (1.0, 1.3), "pin_grid_array": (2.2, 2.9), "chip_carrier": (4.7, 6.1),
        }
        pi_pt = pi_pt_table[package_type][0 if hermetic else 1]
        lambda_bp = .0022 + 1.72e-5 * pins
        pi_e = float(_PI_E_MICROCIRCUIT[environment])
        pi_q = _micro_pi_q(quality, standard, pi_Q)
        vth = _nonnegative(esd_threshold_volts, "esd_threshold_volts")
        lambda_eos = -math.log1p(-.00057 * math.exp(-.0002 * vth)) / .00876
        die = lambda_bd * pi_mfg * pi_t * pi_cd
        package = lambda_bp * pi_e * pi_q * pi_pt
        rate = die + package + lambda_eos
        factors = {
            "lambda_BD": lambda_bd, "pi_MFG": pi_mfg, "pi_T": pi_t,
            "pi_CD": pi_cd, "lambda_BP": lambda_bp, "pi_E": pi_e,
            "pi_Q": pi_q, "pi_PT": pi_pt, "lambda_EOS": lambda_eos,
            "_quality_basis": _micro_quality_basis(quality, standard, pi_Q, pi_q),
        }
        steps = [
            _step("λBD", "die base rate", "table lookup", part_type, lambda_bd, FPMH),
            _step("πMFG", "manufacturing factor", "table lookup", manufacturing_process, pi_mfg),
            _step("πT", "die temperature factor", ".1 exp[-.35/k(1/(Tj+273)-1/298)]", f"Tj={T_junction:g}°C", pi_t),
            _step("πCD", "die complexity factor", "(A/.21)(2/Xs)^2(.64)+.36", f"A={area:g}, Xs={feature:g}", pi_cd),
            _step("λBP", "package base rate", ".0022+1.72×10^-5 Np", f"Np={pins}", lambda_bp, FPMH),
            _step("λEOS", "electrical overstress rate", "-ln[1-.00057 exp(-.0002VTH)]/.00876", f"VTH={vth:g} V", lambda_eos, FPMH),
            _step("λp", "part failure rate", "λBDπMFGπTπCD+λBPπEπQπPT+λEOS", f"{die:g}+{package:g}+{lambda_eos:g}", rate, FPMH),
        ]
        warnings = ()
        if standard == "VITA-51.1" and feature < .13:
            warnings = (
                "Feature size is below 130 nm; perform the separate VITA 51.2/equivalent EM, TDDB, HCI, and NBTI wearout assessment recommended by A/V51.1.",
            )
        assumptions = () if hermetic == hermetic_requested else (
            "The commercial package was modeled as nonhermetic under A/V51.1 Rule 2.1.2-3.",
        )
        self._finish(rate, section="5.3", pages="5-7", equation="λp = λBD πMFG πT πCD + λBP πE πQ πPT + λEOS", model="simplified VHSIC CMOS", factors=factors, steps=steps, assumptions=assumptions, warnings=warnings)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class GaAsMicrocircuit(_Part):
    """Section 5.4 GaAs MMIC and digital integrated-circuit model."""

    category = "gaas_microcircuit"

    def __init__(
        self,
        device_type: str = "mmic",
        active_elements: int = 100,
        application: str = "low_noise",
        pins: int = 16,
        package: str = "hermetic_dip",
        T_junction: float = 100.0,
        quality: str = "commercial",
        years_in_production: float = 2.0,
        environment: str = "GB",
        standard: str = "MIL-HDBK-217F",
        pi_Q: float | None = None,
        name: str | None = None,
        quantity: int = 1,
        multiplier: float = 1.0,
    ):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        package_requested = package
        if standard == "VITA-51.1" and quality == "commercial":
            package = "nonhermetic"
        _choice(package, _C2_PACKAGE, "package")
        active_elements = int(_positive(active_elements, "active_elements"))
        if device_type == "mmic":
            C1 = _lookup_band([(100, 4.5), (1000, 7.2)], active_elements, "active_elements")
            _choice(application, ("low_noise", "low_power", "driver", "high_power", "unknown"), "application")
            pi_a = 1.0 if application in ("low_noise", "low_power") else 3.0
            Ea = 1.5
        elif device_type == "digital":
            C1 = _lookup_band([(1000, 25.0), (10000, 51.0)], active_elements, "active_elements")
            pi_a, Ea = 1.0, 1.4
        else:
            raise ValueError("device_type must be 'mmic' or 'digital'")
        coeff, exponent = _C2_PACKAGE[package]
        C2 = coeff * int(_positive(pins, "pins")) ** exponent
        pi_t = arrhenius_pi_T(T_junction, Ea, scale=.1, T_ref=423.0)
        pi_e = float(_PI_E_MICROCIRCUIT[environment])
        pi_l = _micro_pi_l(years_in_production, standard)
        pi_q = _micro_pi_q(quality, standard, pi_Q)
        rate = (C1 * pi_t * pi_a + C2 * pi_e) * pi_l * pi_q
        factors = {
            "C1": C1, "pi_T": pi_t, "pi_A": pi_a, "C2": C2,
            "pi_E": pi_e, "pi_L": pi_l, "pi_Q": pi_q,
            "_quality_basis": _micro_quality_basis(quality, standard, pi_Q, pi_q),
        }
        steps = [
            _step("C1", "die complexity rate", "table lookup", f"{device_type}, {active_elements} elements", C1, FPMH),
            _step("πT", "temperature factor", ".1 exp[-Ea/k(1/(Tj+273)-1/423)]", f"Ea={Ea:g}, Tj={T_junction:g}°C", pi_t),
            _step("πA", "application factor", "table lookup", application, pi_a),
            _step("C2", "package rate", "aNp^b", f"{package}, Np={pins}", C2, FPMH),
            _step("λp", "part failure rate", "[C1πTπA+C2πE]πLπQ", f"[{C1:g}·{pi_t:g}·{pi_a:g}+{C2:g}·{pi_e:g}]·{pi_l:g}·{pi_q:g}", rate, FPMH),
        ]
        assumptions = () if package == package_requested else (
            "The commercial package was modeled as nonhermetic under A/V51.1 Rule 2.1.2-3.",
        )
        self._finish(rate, section="5.4", pages="5-8", equation="λp = [C1 πT πA + C2 πE] πL πQ", model=f"GaAs {device_type}", factors=factors, steps=steps, assumptions=assumptions)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class HybridMicrocircuit(_Part):
    """Section 5.5 hybrid microcircuit summation model."""

    category = "hybrid_microcircuit"

    def __init__(self, sum_Ni_lambda_ci: float = .01,
                 quality: str = "commercial", years_in_production: float = 2.0,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 pi_Q: float | None = None, function: str = "digital",
                 name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        element_sum = _nonnegative(sum_Ni_lambda_ci, "sum_Ni_lambda_ci")
        pi_e = float(_PI_E_MICROCIRCUIT[environment])
        pi_f = {
            "digital": 1.0,
            "video": 1.2,
            "microwave": 2.6,
            "linear": 5.8,
            "power": 21.0,
        }[_choice(
            function,
            ("digital", "video", "microwave", "linear", "power"),
            "function",
        )]
        pi_q = _micro_pi_q(quality, standard, pi_Q)
        pi_l = _micro_pi_l(years_in_production, standard)
        rate = element_sum * (1.0 + .2 * pi_e) * pi_f * pi_q * pi_l
        factors = {
            "sum_Ni_lambda_ci": element_sum, "pi_E": pi_e, "pi_F": pi_f,
            "pi_Q": pi_q, "pi_L": pi_l,
            "_quality_basis": _micro_quality_basis(quality, standard, pi_Q, pi_q),
        }
        steps = [
            _step("ΣNcλc", "sum of component contributions", "Σ Nc λc", f"user sum={element_sum:g}", element_sum, FPMH),
            _step("πF", "hybrid function factor", "Section 5.5 function table", function, pi_f),
            _step("λp", "hybrid failure rate", "[ΣNcλc](1+.2πE)πFπQπL", f"{element_sum:g}(1+.2·{pi_e:g})·{pi_f:g}·{pi_q:g}·{pi_l:g}", rate, FPMH),
        ]
        self._finish(rate, section="5.5", pages="5-9", equation="λp = [Σ Nc λc] (1 + .2 πE) πF πQ πL", model="hybrid microcircuit", factors=factors, steps=steps)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class SurfaceAcousticWaveDevice(_Part):
    """Section 5.6 surface acoustic wave device model."""
    category = "saw_device"

    def __init__(self, screening: str = "commercial", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(screening, ("commercial", "ten_temperature_cycles"), "screening")
        pi_q = .1 if screening == "ten_temperature_cycles" else 1.0
        pi_e = float(_PI_E_MICROCIRCUIT[environment])
        rate = 2.1 * pi_q * pi_e
        factors = {"lambda_b": 2.1, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step("πQ", "screening factor", "Section 5.6 screening table", screening, pi_q),
            _step("λp", "SAW failure rate", "2.1πQπE", f"2.1·{pi_q:g}·{pi_e:g}", rate, FPMH),
        ]
        self._finish(rate, section="5.6", pages="5-10", equation="λp = 2.1 πQ πE", model="surface acoustic wave device", factors=factors, steps=steps)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class MagneticBubbleMemory(_Part):
    """Section 5.7 magnetic bubble memory two-contribution model."""
    category = "bubble_memory"

    def __init__(self, dissipative_elements: int = 100, memory_bits: int = 1024,
                 chips_per_package: int = 1, data_rate_ratio: float = .03,
                 reads_per_write: float = 2154.0, seed_generator: bool = False,
                 T_junction_1: float = 50.0, T_junction_2: float = 50.0,
                 pins: int = 16, package: str = "nonhermetic",
                 environment: str = "GB", quality: str = "commercial",
                 years_in_production: float = 2.0, pi_Q: float | None = None,
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        n1 = int(_positive(dissipative_elements, "dissipative_elements"))
        n2 = int(_positive(memory_bits, "memory_bits"))
        if n1 > 1000:
            raise ValueError("dissipative_elements exceeds the Section 5.7 limit of 1,000 per chip")
        if n2 > 9_000_000:
            raise ValueError("memory_bits exceeds the Section 5.7 limit of 9,000,000")
        nc = int(_positive(chips_per_package, "chips_per_package"))
        D = _ratio(data_rate_ratio, "data_rate_ratio")
        rw = _positive(reads_per_write, "reads_per_write")
        t1 = _temperature(T_junction_1, "T_junction_1")
        t2 = _temperature(T_junction_2, "T_junction_2")
        if not 25 <= t1 <= 175 or not 25 <= t2 <= 175:
            raise ValueError("Section 5.7 junction temperatures must be between 25 and 175°C")
        package_requested = package
        if standard == "VITA-51.1" and quality == "commercial":
            package = "nonhermetic"
        _choice(package, _C2_PACKAGE, "package")
        pins = int(_positive(pins, "pins"))
        coefficient, exponent = _C2_PACKAGE[package]
        C2 = coefficient * pins ** exponent
        C11, C21 = .00095 * n1 ** .40, .0001 * n1 ** .226
        C12, C22 = .00007 * n2 ** .3, .00001 * n2 ** .3
        pi_t1 = arrhenius_pi_T(t1, .8, scale=.1)
        pi_t2 = arrhenius_pi_T(t2, .55, scale=.1)
        pi_w = 1.0 if D <= .03 or rw >= 2154 else 10.0 * D / rw ** .3
        if _boolean(seed_generator, "seed_generator"):
            pi_w = max(1.0, pi_w / 4.0)
        pi_d = .9 * D + .1
        pi_e = float(_PI_E_MICROCIRCUIT[environment])
        pi_q = _micro_pi_q(quality, standard, pi_Q)
        pi_l = _micro_pi_l(years_in_production, standard)
        lambda1 = pi_q * (nc * C11 * pi_t1 * pi_w + (nc * C21 + C2) * pi_e) * pi_d * pi_l
        lambda2 = pi_q * nc * (C12 * pi_t2 + C22 * pi_e) * pi_l
        rate = lambda1 + lambda2
        factors = {
            "C11": C11, "C21": C21, "C12": C12, "C22": C22,
            "C2": C2, "pi_T1": pi_t1, "pi_T2": pi_t2,
            "pi_W": pi_w, "pi_D": pi_d, "pi_E": pi_e, "pi_Q": pi_q,
            "pi_L": pi_l, "lambda_1": lambda1, "lambda_2": lambda2,
            "_quality_basis": _micro_quality_basis(quality, standard, pi_Q, pi_q),
        }
        steps = [
            _step("C2", "package failure rate", "aNp^b", f"{coefficient:g}·{pins}^{exponent:g}", C2, FPMH),
            _step("πW", "write-duty-cycle factor", "10D/(R/W)^.3; Section 5.7 boundary rules", f"D={D:g}, R/W={rw:g}, seed={seed_generator}", pi_w),
            _step("πD", "duty-cycle factor", ".9D+.1", f"D={D:g}", pi_d),
            _step("λ1", "control/detection contribution", "πQ[NcC11πT1πW+(NcC21+C2)πE]πDπL", "substituted from factors", lambda1, FPMH),
            _step("λ2", "memory-storage contribution", "πQNc(C12πT2+C22πE)πL", "substituted from factors", lambda2, FPMH),
            _step("λp", "bubble-memory rate", "λ1+λ2", f"{lambda1:g}+{lambda2:g}", rate, FPMH),
        ]
        assumptions = ["External support microelectronics are excluded and must be modeled separately."]
        if package != package_requested:
            assumptions.append("The commercial package was modeled as nonhermetic under A/V51.1 Rule 2.1.2-3.")
        self._finish(rate, section="5.7", pages="5-11–5-12", equation="λp = λ1 + λ2", model="magnetic bubble memory", factors=factors, steps=steps, assumptions=assumptions)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


# ---------------------------------------------------------------------------
# Section 6: discrete semiconductors
# ---------------------------------------------------------------------------

_PI_E_DISCRETE = _env([1, 6, 9, 9, 19, 13, 29, 20, 43, 24, .5, 14, 32, 320])
_PI_E_HIGH_FREQUENCY = _env([1, 2, 5, 4, 11, 4, 5, 7, 12, 16, .5, 9, 24, 250])
_PI_E_OPTO = _env([1, 2, 8, 5, 12, 4, 6, 6, 8, 17, .5, 9, 24, 450])
_PI_Q_DISCRETE = {"JANTXV": .7, "JANTX": 1.0, "JAN": 2.4, "lower": 5.5, "plastic": 8.0}
_PI_Q_HF = {"JANTXV": .5, "JANTX": 1.0, "JAN": 5.0, "lower": 25.0, "plastic": 50.0}
_PI_Q_HF_SCHOTTKY = {"JANTXV": .5, "JANTX": 1.0, "JAN": 1.8, "lower": 2.5}
_PI_Q_RF_TRANSISTOR = {"JANTXV": .5, "JANTX": 1.0, "JAN": 2.0, "lower": 5.0}


def _semiconductor_quality(
    quality: str,
    table: Mapping[str, float],
    standard: str,
    override: float | None,
    vita_category: str = "transistor",
) -> float:
    _choice(quality, table, "quality")
    if override is not None:
        return _positive(override, "pi_Q")
    value = float(table[quality])
    if standard == "VITA-51.1":
        value = VITA_51_1_PI_Q.get(vita_category, {}).get(quality, value)
    return value


class Diode(_Part):
    """Section 6.1 low-frequency diode model."""
    category = "diode"

    _TYPES = {
        "general_purpose_analog": (.0038, 3091.0, True),
        "general_purpose": (.0038, 3091.0, True),
        "switching": (.0010, 3091.0, True),
        "fast_recovery": (.025, 3091.0, True),
        "fast_recovery_rectifier": (.025, 3091.0, True),
        "power_rectifier": (.0030, 3091.0, True),
        "schottky": (.0030, 3091.0, True),
        "high_voltage_stack": (.0050, 3091.0, True),
        "transient_suppressor": (.0013, 3091.0, False),
        "current_regulator": (.0034, 1925.0, False),
        "voltage_regulator": (.0020, 1925.0, False),
        "zener_regulator": (.0020, 1925.0, False),
        "voltage_reference": (.0020, 1925.0, False),
    }

    def __init__(self, diode_type: str = "general_purpose", T_junction: float = 50.0,
                 voltage_stress: float = .5, contact: str = "bonded",
                 junctions: int = 1, quality: str = "plastic", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", pi_Q: float | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(diode_type, self._TYPES, "diode_type")
        _choice(contact, ("bonded", "spring"), "contact")
        stress = _ratio(voltage_stress, "voltage_stress")
        lambda_b, coefficient, stress_applies = self._TYPES[diode_type]
        if diode_type == "high_voltage_stack":
            lambda_b *= int(_positive(junctions, "junctions"))
        pi_t = _coefficient_pi_T(T_junction, coefficient)
        pi_s = (.054 if stress <= .3 else stress ** 2.43) if stress_applies else 1.0
        pi_c = 1.0 if contact == "bonded" else 2.0
        pi_q = _semiconductor_quality(quality, _PI_Q_DISCRETE, standard, pi_Q, "diode")
        pi_e = float(_PI_E_DISCRETE[environment])
        rate = lambda_b * pi_t * pi_s * pi_c * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_S": pi_s, "pi_C": pi_c, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step("λb", "base failure rate", "table lookup", diode_type, lambda_b, FPMH),
            _step("πT", "temperature factor", f"exp[-{coefficient:g}(1/(Tj+273)-1/298)]", f"Tj={T_junction:g}°C", pi_t),
            _step("πS", "electrical stress factor", ".054 for S≤.3; S^2.43 otherwise", f"S={stress:g}", pi_s),
            _step("πC", "contact construction", "table lookup", contact, pi_c),
            _step("λp", "part failure rate", "λbπTπSπCπQπE", f"{lambda_b:g}·{pi_t:g}·{pi_s:g}·{pi_c:g}·{pi_q:g}·{pi_e:g}", rate, FPMH),
        ]
        self._finish(rate, section="6.1", pages="6-2–6-3", equation="λp = λb πT πS πC πQ πE", model=f"{diode_type} diode", factors=factors, steps=steps)


class HFDiode(_Part):
    """Section 6.2 high-frequency diode model."""
    category = "hf_diode"

    _BASE = {
        "impatt": .22, "gunn": .18, "tunnel": .0023, "back": .0023,
        "tunnel_back": .0023, "pin": .0081, "schottky": .027,
        "point_contact": .027, "mixer": .027, "detector": .027,
        "varactor": .0025, "step_recovery": .0025,
    }

    def __init__(self, diode_type: str = "varactor", application: str = "other",
                 rated_power: float = .5, frequency_ghz: float = 1.0,
                 T_junction: float = 50.0,
                 quality: str = "lower", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", pi_Q: float | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(diode_type, self._BASE, "diode_type")
        _choice(application, ("other", "voltage_control", "multiplier", "oscillator", "mixer", "detector", "amplifier", "switch"), "application")
        frequency = _positive(frequency_ghz, "frequency_ghz")
        if diode_type == "impatt" and frequency > 35:
            raise ValueError("Section 6.2 limits silicon IMPATT diodes to 35 GHz")
        if diode_type in ("schottky", "point_contact", "mixer", "detector") and not .2 <= frequency <= 35:
            raise ValueError("Section 6.2 limits Schottky/point-contact diodes to 0.2–35 GHz")
        lambda_b = self._BASE[diode_type]
        coefficient = 5260.0 if diode_type == "impatt" else 2100.0
        pi_t = _coefficient_pi_T(T_junction, coefficient)
        if diode_type in ("varactor", "step_recovery") and application == "voltage_control":
            pi_a = .5
        elif diode_type in ("varactor", "step_recovery") and application == "multiplier":
            pi_a = 2.5
        else:
            pi_a = 1.0
        power = _positive(rated_power, "rated_power")
        if diode_type == "pin" and power > 3000:
            raise ValueError("Section 6.2 limits the PIN-diode rated-power factor to 3,000 W")
        pi_r = max(.5, .326 * math.log(power) - .25) if diode_type == "pin" else 1.0
        q_table = _PI_Q_HF_SCHOTTKY if diode_type in ("schottky", "point_contact", "mixer", "detector") else _PI_Q_HF
        pi_q = _semiconductor_quality(quality, q_table, standard, pi_Q, "diode")
        pi_e = float(_PI_E_HIGH_FREQUENCY[environment])
        rate = lambda_b * pi_t * pi_a * pi_r * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "frequency_ghz": frequency, "pi_T": pi_t, "pi_A": pi_a, "pi_R": pi_r, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step("λb", "base rate", "table lookup", diode_type, lambda_b, FPMH),
            _step("πT", "temperature factor", f"exp[-{coefficient:g}(1/(Tj+273)-1/298)]", f"Tj={T_junction:g}°C", pi_t),
            _step("πA", "application factor", "table lookup", application, pi_a),
            _step("πR", "PIN rated-power factor", "max[.5,.326 ln(Pr)-.25]", f"Pr={power:g} W", pi_r),
            _step("λp", "part failure rate", "λbπTπAπRπQπE", "product of listed factors", rate, FPMH),
        ]
        self._finish(rate, section="6.2", pages="6-4–6-5", equation="λp = λb πT πA πR πQ πE", model=f"{diode_type} high-frequency diode", factors=factors, steps=steps)


class BipolarTransistor(_Part):
    """Section 6.3 low-frequency bipolar transistor model."""
    category = "bjt"

    def __init__(self, application: str = "switching", rated_power: float = .5,
                 frequency_mhz: float = 100.0,
                 voltage_stress: float = .5, T_junction: float = 50.0,
                 quality: str = "plastic", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", pi_Q: float | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(application, ("linear", "switching"), "application")
        frequency = _positive(frequency_mhz, "frequency_mhz")
        if frequency > 200:
            raise ValueError("Section 6.3 applies only at frequencies at or below 200 MHz")
        power = _positive(rated_power, "rated_power")
        stress = _ratio(voltage_stress, "voltage_stress")
        lambda_b = .00074
        pi_t = _coefficient_pi_T(T_junction, 2114)
        pi_a = 1.5 if application == "linear" else .7
        pi_r = .43 if power <= .1 else power ** .37
        pi_s = .045 * math.exp(3.1 * stress)
        pi_q = _semiconductor_quality(quality, _PI_Q_DISCRETE, standard, pi_Q)
        pi_e = float(_PI_E_DISCRETE[environment])
        rate = lambda_b * pi_t * pi_a * pi_r * pi_s * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "frequency_mhz": frequency, "pi_T": pi_t, "pi_A": pi_a, "pi_R": pi_r, "pi_S": pi_s, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step("πR", "rated-power factor", ".43 if Pr≤.1 W; Pr^.37 otherwise", f"Pr={power:g}", pi_r),
            _step("πS", "voltage-stress factor", ".045 exp(3.1S)", f"S={stress:g}", pi_s),
            _step("λp", "part failure rate", "λbπTπAπRπSπQπE", "product of listed factors", rate, FPMH),
        ]
        self._finish(rate, section="6.3", pages="6-6–6-7", equation="λp = λb πT πA πR πS πQ πE", model="low-frequency bipolar transistor", factors=factors, steps=steps)


class FieldEffectTransistor(_Part):
    """Section 6.4 low-frequency silicon FET model."""
    category = "fet"

    def __init__(self, fet_type: str = "mosfet", application: str = "switching",
                 rated_power: float = .5, frequency_mhz: float = 100.0,
                 T_junction: float = 50.0,
                 quality: str = "plastic", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", pi_Q: float | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(fet_type, ("mosfet", "jfet"), "fet_type")
        _choice(application, ("switching", "linear", "power"), "application")
        frequency = _positive(frequency_mhz, "frequency_mhz")
        if frequency > 400:
            raise ValueError("Section 6.4 applies only at frequencies at or below 400 MHz")
        power = _positive(rated_power, "rated_power")
        if application == "power" and power < 2:
            raise ValueError("Section 6.4 defines the nonlinear power-FET application for rated power at or above 2 W")
        lambda_b = (
            .0012
            if standard == "VITA-51.1" and fet_type == "mosfet"
            else .012 if fet_type == "mosfet" else .0045
        )
        pi_t = _coefficient_pi_T(T_junction, 1925)
        if application == "switching": pi_a = .7
        elif application == "linear": pi_a = 1.5
        elif power < 5: pi_a = 2.0
        elif power < 50: pi_a = 4.0
        elif power < 250: pi_a = 8.0
        else: pi_a = 10.0
        pi_q = _semiconductor_quality(quality, _PI_Q_DISCRETE, standard, pi_Q)
        pi_e = float(_PI_E_DISCRETE[environment])
        rate = lambda_b * pi_t * pi_a * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "frequency_mhz": frequency, "pi_T": pi_t, "pi_A": pi_a, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [_step("πA", "application/rated-power factor", "Section 6.4 table", f"application={application}, Pr={power:g} W", pi_a), _step("λp", "part failure rate", "λbπTπAπQπE", "product of listed factors", rate, FPMH)]
        assumptions = (
            "The A/V51.1 Appendix D recommended low-frequency MOSFET base rate λb=0.0012 FPMH (60% confidence) replaces the Section 6.4 MOSFET base rate.",
        ) if standard == "VITA-51.1" and fet_type == "mosfet" else ()
        self._finish(rate, section="6.4", pages="6-8", equation="λp = λb πT πA πQ πE", model=f"low-frequency {fet_type}", factors=factors, steps=steps, assumptions=assumptions)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class UnijunctionTransistor(_Part):
    """Section 6.5 unijunction transistor model."""
    category = "unijunction"

    def __init__(self, T_junction: float = 50.0, quality: str = "plastic",
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 pi_Q: float | None = None, name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        lambda_b = .0083; pi_t = _coefficient_pi_T(T_junction, 2483)
        pi_q = _semiconductor_quality(quality, _PI_Q_DISCRETE, standard, pi_Q)
        pi_e = float(_PI_E_DISCRETE[environment])
        rate = lambda_b * pi_t * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="6.5", pages="6-9", equation="λp = λb πT πQ πE", model="unijunction transistor", factors=factors, steps=[_step("λp", "part failure rate", "λbπTπQπE", "product of listed factors", rate, FPMH)])


class HFLowNoiseBipolarTransistor(_Part):
    """Section 6.6 low-noise high-frequency bipolar transistor model."""
    category = "hf_low_noise_bjt"

    def __init__(self, rated_power: float = .5, frequency_mhz: float = 1000.0,
                 voltage_stress: float = .5,
                 T_junction: float = 50.0, quality: str = "lower",
                 environment: str = "GB", pi_Q: float | None = None,
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        power = _positive(rated_power, "rated_power"); stress = _ratio(voltage_stress, "voltage_stress")
        frequency = _positive(frequency_mhz, "frequency_mhz")
        if frequency <= 200:
            raise ValueError("Section 6.6 requires frequency above 200 MHz")
        if power >= 1:
            raise ValueError("Section 6.6 requires rated power below 1 W")
        lambda_b = .18; pi_t = _coefficient_pi_T(T_junction, 2114)
        pi_r = .43 if power <= .1 else power ** .37
        pi_s = .045 * math.exp(3.1 * stress)
        pi_q = _semiconductor_quality(quality, _PI_Q_RF_TRANSISTOR, standard, pi_Q)
        pi_e = float(_PI_E_HIGH_FREQUENCY[environment])
        rate = lambda_b * pi_t * pi_r * pi_s * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "frequency_mhz": frequency, "pi_T": pi_t, "pi_R": pi_r, "pi_S": pi_s, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="6.6", pages="6-10–6-11", equation="λp = λb πT πR πS πQ πE", model="low-noise high-frequency bipolar transistor", factors=factors, steps=[_step("λp", "part failure rate", "λbπTπRπSπQπE", "product of listed factors", rate, FPMH)])


class HFPowerBipolarTransistor(_Part):
    """Section 6.7 high-power high-frequency bipolar transistor model."""
    category = "hf_power_bjt"

    def __init__(self, frequency_ghz: float = 1.0, rated_power_watts: float = 10.0,
                 voltage_stress: float = .4, metallization: str = "gold",
                 operation: str = "continuous", duty_cycle: float = .1,
                 matching: str = "input_output", T_junction: float = 100.0,
                 quality: str = "lower", environment: str = "GB",
                 pi_Q: float | None = None, standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        F = _positive(frequency_ghz, "frequency_ghz"); P = _positive(rated_power_watts, "rated_power_watts")
        if F > 5:
            raise ValueError("Section 6.7 base-rate equation is tabulated only through 5 GHz")
        if P < 1:
            raise ValueError("Section 6.7 applies to average output power at or above 1 W")
        maximum_power = 600 if F <= 1 else 300 if F <= 2 else 200 if F <= 3 else 100 if F <= 4 else 50
        if P > maximum_power:
            raise ValueError(
                f"rated_power_watts exceeds the Section 6.7 limit of {maximum_power:g} W at {F:g} GHz"
            )
        S = _ratio(voltage_stress, "voltage_stress", upper=.55)
        _choice(metallization, ("gold", "aluminum"), "metallization")
        _choice(operation, ("continuous", "pulsed"), "operation")
        _choice(matching, ("input_output", "input", "none"), "matching")
        dc = _ratio(duty_cycle, "duty_cycle")
        lambda_b = .032 * math.exp(.354 * F + .00558 * P)
        T = _temperature(T_junction, "T_junction")
        if not 100 <= T <= 200:
            raise ValueError("Section 6.7 junction temperature must be between 100 and 200°C")
        if metallization == "gold":
            temp_exp = _safe_exp(-2903 * (1 / (T + 273) - 1 / 373), "gold metallization πT")
            pi_t = (.1 if S <= .4 else 2 * (S - .35)) * temp_exp
        else:
            temp_exp = _safe_exp(-5794 * (1 / (T + 273) - 1 / 373), "aluminum metallization πT")
            pi_t = (.38 if S <= .4 else 7.55 * (S - .35)) * temp_exp
        duty_percent = min(30.0, max(1.0, 100.0 * dc))
        pi_a = 7.6 if operation == "continuous" else .06 * duty_percent + .40
        pi_m = {"input_output": 1.0, "input": 2.0, "none": 4.0}[matching]
        pi_q = _semiconductor_quality(quality, _PI_Q_RF_TRANSISTOR, standard, pi_Q)
        pi_e = float(_PI_E_HIGH_FREQUENCY[environment])
        rate = lambda_b * pi_t * pi_a * pi_m * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_A": pi_a, "pi_M": pi_m, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step("λb", "frequency/power base rate", ".032 exp(.354F+.00558P)", f"F={F:g} GHz, P={P:g} W", lambda_b, FPMH),
            _step("πT", "metallization temperature/stress factor", "Section 6.7 piecewise equation", f"{metallization}, S={S:g}, Tj={T:g}°C", pi_t),
            _step("πA", "continuous/pulsed factor", "7.6 CW; .06 clamp(duty%, 1, 30)+.40 pulsed", f"{operation}, duty={dc:g}", pi_a),
            _step("λp", "part failure rate", "λbπTπAπMπQπE", "product of listed factors", rate, FPMH),
        ]
        self._finish(rate, section="6.7", pages="6-12–6-13", equation="λp = λb πT πA πM πQ πE", model="high-power high-frequency bipolar transistor", factors=factors, steps=steps)


class GaAsFET(_Part):
    """Section 6.8 high-frequency GaAs FET model."""
    category = "gaas_fet"

    def __init__(self, frequency_ghz: float = 5.0, rated_power_watts: float = .05,
                 operation: str = "low_power", matching: str = "input_output",
                 channel_temperature_c: float = 50.0, quality: str = "lower", environment: str = "GB",
                 pi_Q: float | None = None, standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        F = _positive(frequency_ghz, "frequency_ghz"); P = _positive(rated_power_watts, "rated_power_watts")
        _choice(operation, ("low_power", "pulsed", "continuous"), "operation")
        _choice(matching, ("input_output", "input", "none"), "matching")
        if P < .1 and 1 <= F <= 10:
            lambda_b = .052
        elif .1 <= P <= 6 and 4 <= F <= 10:
            lambda_b = .0093 * math.exp(.429 * F + .486 * P)
        else:
            raise ValueError("frequency/power lies outside Section 6.8 model ranges")
        T = _temperature(channel_temperature_c, "channel_temperature_c")
        pi_t = _safe_exp(-4485 * (1 / (T + 273) - 1 / 298), "GaAs FET πT")
        pi_a = 4.0 if operation == "continuous" else 1.0
        pi_m = {"input_output": 1.0, "input": 2.0, "none": 4.0}[matching]
        pi_q = _semiconductor_quality(quality, _PI_Q_RF_TRANSISTOR, standard, pi_Q)
        pi_e = float(_PI_E_HIGH_FREQUENCY[environment])
        rate = lambda_b * pi_t * pi_a * pi_m * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_A": pi_a, "pi_M": pi_m, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [_step("λb", "frequency/power base rate", ".052 or .0093 exp(.429F+.486P)", f"F={F:g}, P={P:g}", lambda_b, FPMH), _step("λp", "part failure rate", "λbπTπAπMπQπE", "product of listed factors", rate, FPMH)]
        self._finish(rate, section="6.8", pages="6-14–6-15", equation="λp = λb πT πA πM πQ πE", model="high-frequency GaAs FET", factors=factors, steps=steps)


class HighFrequencySiliconFET(_Part):
    """Section 6.9 high-frequency silicon FET model."""
    category = "hf_silicon_fet"

    def __init__(self, fet_type: str = "mosfet", average_power_watts: float = .1,
                 frequency_mhz: float = 1000.0, T_junction: float = 50.0,
                 quality: str = "lower", environment: str = "GB", pi_Q: float | None = None,
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(fet_type, ("mosfet", "jfet"), "fet_type")
        power = _positive(average_power_watts, "average_power_watts")
        frequency = _positive(frequency_mhz, "frequency_mhz")
        if power >= .3:
            raise ValueError("Section 6.9 requires average power below 0.3 W")
        if frequency <= 400:
            raise ValueError("Section 6.9 requires frequency above 400 MHz")
        lambda_b = (
            .006
            if standard == "VITA-51.1" and fet_type == "mosfet"
            else .060 if fet_type == "mosfet" else .023
        )
        pi_t = _coefficient_pi_T(T_junction, 1925)
        pi_q = _semiconductor_quality(quality, _PI_Q_RF_TRANSISTOR, standard, pi_Q)
        pi_e = float(_PI_E_HIGH_FREQUENCY[environment])
        rate = lambda_b * pi_t * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "average_power_watts": power, "frequency_mhz": frequency, "pi_T": pi_t, "pi_Q": pi_q, "pi_E": pi_e}
        assumptions = (
            "The A/V51.1 Appendix D recommended high-frequency MOSFET base rate λb=0.006 FPMH (60% confidence) replaces the Section 6.9 MOSFET base rate.",
        ) if standard == "VITA-51.1" and fet_type == "mosfet" else ()
        self._finish(rate, section="6.9", pages="6-16", equation="λp = λb πT πQ πE", model=f"high-frequency silicon {fet_type}", factors=factors, steps=[_step("λp", "part failure rate", "λbπTπQπE", "product of listed factors", rate, FPMH)], assumptions=assumptions)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class Thyristor(_Part):
    """Section 6.10 thyristor/SCR model."""
    category = "thyristor"

    def __init__(self, rated_current: float = 1.0, voltage_stress: float = .5,
                 T_junction: float = 50.0, quality: str = "plastic",
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 pi_Q: float | None = None, name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        current = _positive(rated_current, "rated_current"); stress = _ratio(voltage_stress, "voltage_stress")
        lambda_b = .0022; pi_t = _coefficient_pi_T(T_junction, 3082)
        pi_r = current ** .4; pi_s = .1 if stress <= .3 else stress ** 1.9
        pi_q = _semiconductor_quality(quality, _PI_Q_DISCRETE, standard, pi_Q)
        pi_e = float(_PI_E_DISCRETE[environment])
        rate = lambda_b * pi_t * pi_r * pi_s * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_R": pi_r, "pi_S": pi_s, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="6.10", pages="6-17", equation="λp = λb πT πR πS πQ πE", model="thyristor/SCR", factors=factors, steps=[_step("λp", "part failure rate", "λbπTπRπSπQπE", "product of listed factors", rate, FPMH)])


class Optoelectronic(_Part):
    """Sections 6.11 and 6.12 optoelectronic and display models."""
    category = "optoelectronic"

    _BASE = {"phototransistor": .0055, "photodiode": .0040, "ir_led": .0013, "led": .00023}
    _ISOLATOR_SINGLE = {"photodiode": .0025, "phototransistor": .013, "darlington": .013, "lsr": .0064}
    _ISOLATOR_DUAL = {"photodiode": .0033, "phototransistor": .017, "darlington": .017, "lsr": .0086}

    def __init__(self, device: str = "led", T_junction: float = 50.0,
                 detector: str = "phototransistor", channels: str = "single",
                 display_characters: int = 1, display_logic_chip: bool = False,
                 quality: str = "plastic", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", pi_Q: float | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        if device in self._BASE:
            lambda_b = self._BASE[device]; section = "6.11"; pages = "6-18–6-19"
        elif device in ("optical_isolator", "optocoupler"):
            _choice(detector, self._ISOLATOR_SINGLE, "detector"); _choice(channels, ("single", "dual"), "channels")
            lambda_b = (self._ISOLATOR_SINGLE if channels == "single" else self._ISOLATOR_DUAL)[detector]
            section = "6.11"; pages = "6-18–6-19"
        elif device in ("segment_display", "alphanumeric_display"):
            C = int(_positive(display_characters, "display_characters"))
            lambda_b = .00043 * C + (.000043 if _boolean(display_logic_chip, "display_logic_chip") else 0.0)
            section = "6.12"; pages = "6-20"
        elif device == "diode_array_display":
            C = int(_positive(display_characters, "display_characters"))
            lambda_b = .00009 + .00017 * C + (.000043 if _boolean(display_logic_chip, "display_logic_chip") else 0.0)
            section = "6.12"; pages = "6-20"
        else:
            raise ValueError("unsupported Section 6.11/6.12 optoelectronic device")
        pi_t = _coefficient_pi_T(T_junction, 2790)
        pi_q = _semiconductor_quality(quality, _PI_Q_DISCRETE, standard, pi_Q, "diode")
        pi_e = float(_PI_E_OPTO[environment])
        rate = lambda_b * pi_t * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section=section, pages=pages, equation="λp = λb πT πQ πE", model=device, factors=factors, steps=[_step("λp", "part failure rate", "λbπTπQπE", "product of listed factors", rate, FPMH)])


class LaserDiode(_Part):
    """Section 6.13 laser diode model."""
    category = "laser_diode"

    def __init__(self, material: str = "gaas_algaas", T_junction: float = 50.0,
                 package: str = "hermetic", forward_peak_current_amps: float = 1.0,
                 optical_flux_density_mw_per_cm2: float = 1.0,
                 operation: str = "continuous", duty_cycle: float = 1.0,
                 output_power_ratio: float = .5, environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(material, ("gaas_algaas", "ingaas_ingaasp"), "material")
        _choice(package, ("hermetic", "nonhermetic_coated", "nonhermetic_uncoated"), "package")
        _choice(operation, ("continuous", "pulsed"), "operation")
        current = _positive(forward_peak_current_amps, "forward_peak_current_amps")
        if current > 25:
            raise ValueError("Section 6.13 limits forward peak current to 25 A")
        flux = _positive(optical_flux_density_mw_per_cm2, "optical_flux_density_mw_per_cm2")
        if flux >= 3:
            raise ValueError("Section 6.13 applies only below 3 MW/cm² optical flux density")
        temperature = _temperature(T_junction, "T_junction")
        if not 25 <= temperature <= 75:
            raise ValueError("Section 6.13 laser-diode junction temperature must be between 25 and 75°C")
        duty = _ratio(duty_cycle, "duty_cycle"); power_ratio = _ratio(output_power_ratio, "output_power_ratio", upper=.95)
        lambda_b = 3.23 if material == "gaas_algaas" else 5.65
        pi_t = _coefficient_pi_T(temperature, 4635)
        pi_q = {"hermetic": 1.0, "nonhermetic_coated": 1.0, "nonhermetic_uncoated": 3.3}[package]
        pi_i = current ** .68
        pi_a = 4.4 if operation == "continuous" else duty ** .5
        pi_p = 1.0 / (2.0 * (1.0 - power_ratio))
        pi_e = float(_PI_E_OPTO[environment])
        rate = lambda_b * pi_t * pi_q * pi_i * pi_a * pi_p * pi_e
        factors = {"lambda_b": lambda_b, "optical_flux_density_mw_per_cm2": flux, "pi_T": pi_t, "pi_Q": pi_q, "pi_I": pi_i, "pi_A": pi_a, "pi_P": pi_p, "pi_E": pi_e}
        steps = [
            _step("πI", "current factor", "I^.68", f"I={current:g}", pi_i),
            _step("πA", "operating mode factor", "4.4 CW; duty^.5 pulsed", f"{operation}, duty={duty:g}", pi_a),
            _step("πP", "power ratio factor", "1/[2(1-Pr/Ps)]", f"Pr/Ps={power_ratio:g}", pi_p),
            _step("λp", "part failure rate", "λbπTπQπIπAπPπE", "product of listed factors", rate, FPMH),
        ]
        self._finish(rate, section="6.13", pages="6-21–6-22", equation="λp = λb πT πQ πI πA πP πE", model="laser diode", factors=factors, steps=steps, assumptions=("Replace the laser when optical output falls to the required-output threshold Pr.",))


# ---------------------------------------------------------------------------
# Section 7: electron tubes
# ---------------------------------------------------------------------------

_PI_E_TUBE = _env([.5, 1, 14, 8, 24, 5, 8, 6, 12, 40, .2, 22, 57, 1000])
_PI_E_TWT = _env([.5, 1.5, 7, 3, 10, 5, 7, 6, 9, 20, .05, 11, 33, 500])
_PI_E_MAGNETRON = _env([1, 2, 4, 15, 47, 10, 16, 12, 23, 80, .5, 43, 133, 2000])

_TUBE_BASE_RATES = {
    "receiver_triode_tetrode_pentode": 5.0,
    "power_rectifier": 10.0,
    "crt": 9.6,
    "thyratron": 50.0,
    "cfa_qk681": 260.0,
    "cfa_sfd261": 150.0,
    "pulsed_gridded_2041": 140.0,
    "pulsed_gridded_6952": 390.0,
    "pulsed_gridded_7835": 140.0,
    "transmitting_triode_within_limits": 75.0,
    "transmitting_tetrode_pentode_within_limits": 100.0,
    "transmitting_limits_exceeded": 250.0,
    "vidicon_antimony_trisulfide": 51.0,
    "vidicon_silicon_diode_array": 48.0,
    "twystron_va144": 850.0,
    "twystron_va145e": 450.0,
    "twystron_va145h": 490.0,
    "twystron_va913a": 230.0,
    "pulsed_klystron_4kmp10000lf": 43.0,
    "pulsed_klystron_8568": 230.0,
    "pulsed_klystron_l3035": 66.0,
    "pulsed_klystron_l3250": 69.0,
    "pulsed_klystron_l3403": 93.0,
    "pulsed_klystron_sac42a": 100.0,
    "pulsed_klystron_va842": 18.0,
    "pulsed_klystron_z5010a": 150.0,
    "pulsed_klystron_zm3038a": 190.0,
    "klystron_low_power": 30.0,
    "cw_klystron_3k3000lq": 9.0,
    "cw_klystron_3k50000lf": 54.0,
    "cw_klystron_3k21000lq": 150.0,
    "cw_klystron_3km300la": 64.0,
    "cw_klystron_3km3000la": 19.0,
    "cw_klystron_3km50000pa": 110.0,
    "cw_klystron_3km50000pa1": 120.0,
    "cw_klystron_3km50000pa2": 150.0,
    "cw_klystron_4k3cc": 610.0,
    "cw_klystron_4k3sk": 29.0,
    "cw_klystron_4k50000lq": 30.0,
    "cw_klystron_4km50lb": 28.0,
    "cw_klystron_4km50lc": 15.0,
    "cw_klystron_4km50sj": 38.0,
    "cw_klystron_4km50sk": 37.0,
    "cw_klystron_4km3000lr": 140.0,
    "cw_klystron_4km50000lq": 79.0,
    "cw_klystron_4km50000lr": 57.0,
    "cw_klystron_4km170000la": 15.0,
    "cw_klystron_8824": 130.0,
    "cw_klystron_8825": 120.0,
    "cw_klystron_8826": 280.0,
    "cw_klystron_va800e": 70.0,
    "cw_klystron_va853": 220.0,
    "cw_klystron_va856b": 65.0,
    "cw_klystron_va888e": 230.0,
}


def _tube_learning_factor(years: float) -> float:
    years = _nonnegative(years, "years_since_introduction")
    if years <= 1.0:
        return 10.0
    if years < 3.0:
        return 10.0 * years ** -2.1
    return 1.0


class ElectronTube(_Part):
    """Section 7.1 tubes other than traveling-wave tubes and magnetrons."""
    category = "electron_tube"

    def __init__(self, tube_type: str = "receiver_triode_tetrode_pentode",
                 years_since_introduction: float = 3.0,
                 frequency: float | None = None, output_power: float | None = None,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        if tube_type == "pulsed_klystron_unlisted":
            F = _positive(frequency if frequency is not None else 1.0, "frequency_ghz")
            P = _positive(output_power if output_power is not None else .1, "peak_output_power_mw")
            if not .2 <= F <= 6 or not .01 <= P <= 25 or P > 490 * F ** -2.95:
                raise ValueError("unlisted pulsed klystron inputs are outside Section 7.1 limits")
            lambda_b = 2.94 * F * P + 16.0
            base_expression = "2.94FP+16"
        elif tube_type == "cw_klystron_unlisted":
            F = _positive(frequency if frequency is not None else 1000.0, "frequency_mhz")
            P = _positive(output_power if output_power is not None else 1.0, "average_output_power_kw")
            if not 300 <= F <= 8000 or not .1 <= P <= 100 or P > 8.0e6 * F ** -1.7:
                raise ValueError("unlisted CW klystron inputs are outside Section 7.1 limits")
            lambda_b = .5 * P + .0046 * F + 29.0
            base_expression = ".5P+.0046F+29"
        else:
            _choice(tube_type, _TUBE_BASE_RATES, "tube_type")
            lambda_b = _TUBE_BASE_RATES[tube_type]
            base_expression = "Section 7.1 tube table"
        pi_l = _tube_learning_factor(years_since_introduction)
        pi_e = float(_PI_E_TUBE[environment])
        rate = lambda_b * pi_l * pi_e
        factors = {"lambda_b": lambda_b, "pi_L": pi_l, "pi_E": pi_e}
        steps = [
            _step("λb", "base rate including random and wearout failures", base_expression, tube_type, lambda_b, FPMH),
            _step("πL", "learning factor", "10 for T≤1; 10T^-2.1 for 1<T<3; 1 for T≥3", f"T={years_since_introduction:g} y", pi_l),
            _step("λp", "tube failure rate", "λbπLπE", f"{lambda_b:g}·{pi_l:g}·{pi_e:g}", rate, FPMH),
        ]
        self._finish(rate, section="7.1", pages="7-1–7-2", equation="λp = λb πL πE", model=tube_type, factors=factors, steps=steps)


class TravelingWaveTube(_Part):
    """Section 7.2 traveling-wave tube model."""
    category = "traveling_wave_tube"

    def __init__(self, rated_power_watts: float = 100.0, frequency_ghz: float = 4.0,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        P = _positive(rated_power_watts, "rated_power_watts"); F = _positive(frequency_ghz, "frequency_ghz")
        if not .001 <= P <= 40000 or not .1 <= F <= 18:
            raise ValueError("traveling-wave tube inputs are outside Section 7.2 limits")
        lambda_b = 11.0 * 1.00001 ** P * 1.1 ** F
        pi_e = float(_PI_E_TWT[environment]); rate = lambda_b * pi_e
        factors = {"lambda_b": lambda_b, "pi_E": pi_e}
        steps = [_step("λb", "power/frequency base rate", "11(1.00001)^P(1.1)^F", f"P={P:g} W, F={F:g} GHz", lambda_b, FPMH), _step("λp", "tube failure rate", "λbπE", f"{lambda_b:g}·{pi_e:g}", rate, FPMH)]
        self._finish(rate, section="7.2", pages="7-3", equation="λp = λb πE", model="traveling-wave tube", factors=factors, steps=steps)


class Magnetron(_Part):
    """Section 7.3 pulsed and continuous-wave magnetron model."""
    category = "magnetron"

    def __init__(self, operation: str = "pulsed", frequency_ghz: float = 1.0,
                 output_power_mw: float = .1, rated_power_kw: float = 1.0,
                 radiate_to_filament_ratio: float = 1.0,
                 construction: str = "coaxial_pulsed", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(operation, ("pulsed", "continuous"), "operation")
        _choice(construction, ("coaxial_pulsed", "conventional_pulsed", "continuous"), "construction")
        if operation == "pulsed":
            if construction == "continuous":
                raise ValueError("Section 7.3 pulsed magnetrons require coaxial or conventional pulsed construction")
            F = _positive(frequency_ghz, "frequency_ghz"); P = _positive(output_power_mw, "output_power_mw")
            if not .1 <= F <= 100 or not .01 <= P <= 5:
                raise ValueError("pulsed magnetron inputs are outside Section 7.3 limits")
            lambda_b = 19.0 * F ** .73 * P ** .20
        else:
            if construction != "continuous":
                raise ValueError("Section 7.3 continuous-wave magnetrons require continuous construction")
            if not 0 < rated_power_kw < 5:
                raise ValueError("continuous magnetron model applies only below 5 kW")
            lambda_b = 18.0
        R = _ratio(radiate_to_filament_ratio, "radiate_to_filament_ratio")
        pi_u = .44 + .56 * R
        pi_c = {"continuous": 1.0, "coaxial_pulsed": 1.0, "conventional_pulsed": 5.4}[construction]
        pi_e = float(_PI_E_MAGNETRON[environment])
        rate = lambda_b * pi_u * pi_c * pi_e
        factors = {"lambda_b": lambda_b, "pi_U": pi_u, "pi_C": pi_c, "pi_E": pi_e}
        steps = [_step("λb", "base rate", "19F^.73P^.20 pulsed; 18 CW", operation, lambda_b, FPMH), _step("πU", "utilization factor", ".44+.56R", f"R={R:g}", pi_u), _step("λp", "magnetron failure rate", "λbπUπCπE", "product of listed factors", rate, FPMH)]
        self._finish(rate, section="7.3", pages="7-4", equation="λp = λb πU πC πE", model=f"{operation} magnetron", factors=factors, steps=steps)


# ---------------------------------------------------------------------------
# Section 8: lasers (laser-peculiar items only)
# ---------------------------------------------------------------------------

_PI_E_LASER = _env([.3, 1, 4, 3, 4, 4, 6, 7, 9, 5, .1, 3, 8, None])
_LASER_SCOPE_ASSUMPTION = (
    "Section 8 rates cover laser-peculiar functions only; model supporting "
    "electronics and mechanical assemblies separately."
)


def _laser_pi_e(environment: str) -> float:
    _check_environment(environment)
    value = _PI_E_LASER[environment]
    if value is None:
        raise ValueError("Section 8 does not provide a Cannon Launch laser environment factor")
    return float(value)


class GasLaser(_Part):
    """Section 8.1 helium-neon, helium-cadmium, and argon laser model."""
    category = "gas_laser"

    def __init__(self, laser_type: str = "helium_neon", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_standard(standard)
        _choice(laser_type, ("helium_neon", "helium_cadmium", "argon"), "laser_type")
        media = {"helium_neon": 84.0, "helium_cadmium": 228.0, "argon": 457.0}[laser_type]
        coupling = 6.0 if laser_type == "argon" else 0.0
        pi_e = _laser_pi_e(environment); rate = media * pi_e + coupling * pi_e
        factors = {"lambda_MEDIA": media, "lambda_COUPLING": coupling, "pi_E": pi_e}
        steps = [_step("λp", "gas laser rate", "λMEDIAπE+λCOUPLINGπE", f"{media:g}·{pi_e:g}+{coupling:g}·{pi_e:g}", rate, FPMH)]
        self._finish(rate, section="8.1", pages="8-2", equation="λp = λMEDIA πE + λCOUPLING πE", model=f"{laser_type} laser", factors=factors, steps=steps, assumptions=(_LASER_SCOPE_ASSUMPTION,))


class SealedCO2Laser(_Part):
    """Section 8.2 sealed continuous-wave CO2 laser model."""
    category = "sealed_co2_laser"

    def __init__(self, tube_current_ma: float = 20.0, co2_overfill_percent: float = 0.0,
                 ballast_volume_increase_percent: float = 0.0, active_optical_surfaces: int = 1,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_standard(standard)
        current = _positive(tube_current_ma, "tube_current_ma")
        if not 10 <= current <= 150:
            raise ValueError("tube_current_ma must be 10–150 for Section 8.2")
        overfill = _ratio(co2_overfill_percent, "co2_overfill_percent", upper=50)
        ballast = _nonnegative(ballast_volume_increase_percent, "ballast_volume_increase_percent")
        surfaces = int(_positive(active_optical_surfaces, "active_optical_surfaces"))
        lambda_media = 69.0 * current - 450.0
        pi_o = 1.0 - .01 * overfill
        pi_b = (1.0 / 3.0) ** (ballast / 100.0)
        pi_e = _laser_pi_e(environment)
        rate = lambda_media * pi_o * pi_b * pi_e + 10.0 * surfaces * pi_e
        factors = {"lambda_MEDIA": lambda_media, "pi_O": pi_o, "pi_B": pi_b, "pi_OS": surfaces, "pi_E": pi_e}
        steps = [_step("λMEDIA", "lasing-media rate", "69I-450", f"I={current:g} mA", lambda_media, FPMH), _step("πO", "CO2 overfill factor", "1-.01(% overfill)", f"{overfill:g}%", pi_o), _step("πB", "ballast factor", "(1/3)^(% volume increase/100)", f"{ballast:g}%", pi_b), _step("λp", "sealed CO2 laser rate", "λMEDIAπOπBπE+10πOSπE", "substituted from listed factors", rate, FPMH)]
        self._finish(rate, section="8.2", pages="8-3", equation="λp = λMEDIA πO πB πE + 10 πOS πE", model="sealed continuous-wave CO2 laser", factors=factors, steps=steps, assumptions=(_LASER_SCOPE_ASSUMPTION,))


class FlowingCO2Laser(_Part):
    """Section 8.3 flowing CO2 laser model."""
    category = "flowing_co2_laser"

    def __init__(self, average_output_power_kw: float = .1, active_optical_surfaces: int = 1,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_standard(standard)
        power = _positive(average_output_power_kw, "average_output_power_kw")
        if not .01 <= power <= 1.0:
            raise ValueError("average_output_power_kw must be .01–1.0 for Section 8.3")
        surfaces = int(_positive(active_optical_surfaces, "active_optical_surfaces"))
        coupling = 300.0 * power; pi_e = _laser_pi_e(environment)
        rate = coupling * surfaces * pi_e
        factors = {"lambda_COUPLING": coupling, "pi_OS": surfaces, "pi_E": pi_e}
        steps = [_step("λCOUPLING", "coupling rate", "300P", f"P={power:g} kW", coupling, FPMH), _step("λp", "flowing CO2 laser rate", "λCOUPLINGπOSπE", f"{coupling:g}·{surfaces}·{pi_e:g}", rate, FPMH)]
        self._finish(rate, section="8.3", pages="8-4", equation="λp = λCOUPLING πOS πE", model="flowing CO2 laser", factors=factors, steps=steps, assumptions=(_LASER_SCOPE_ASSUMPTION,), warnings=("The printed .01-kW table entry (.3) conflicts with the printed equation λCOUPLING=300P (3.0); the implementation follows the equation.",))


class SolidStateLaser(_Part):
    """Section 8.4 Nd:YAG and ruby-rod solid-state laser model."""
    category = "solid_state_laser"

    def __init__(self, laser_type: str = "nd_yag", pump_type: str = "xenon",
                 pulses_per_second: float = 10.0, input_energy_joules: float = 40.0,
                 lamp_diameter_mm: float = 4.0, lamp_arc_length_inches: float = 2.0,
                 pulse_width_microseconds: float = 100.0, input_power_kw: float = 4.0,
                 energy_density_j_cm2: float = 1.0, cooling: str = "liquid",
                 cleanliness: str = "rigorous", active_optical_surfaces: int = 1,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_standard(standard)
        _choice(laser_type, ("nd_yag", "ruby"), "laser_type")
        _choice(pump_type, ("xenon", "krypton"), "pump_type")
        _choice(cooling, ("gas", "liquid"), "cooling")
        _choice(cleanliness, ("rigorous", "minimal_bellows", "minimal_no_bellows"), "cleanliness")
        pps = _positive(pulses_per_second, "pulses_per_second")
        pi_cool = 1.0 if cooling == "gas" else .1
        if pump_type == "xenon":
            energy = max(30.0, _positive(input_energy_joules, "input_energy_joules"))
            diameter = _positive(lamp_diameter_mm, "lamp_diameter_mm")
            length = _positive(lamp_arc_length_inches, "lamp_arc_length_inches")
            width = min(100.0, _positive(pulse_width_microseconds, "pulse_width_microseconds"))
            lambda_pump = 3600.0 * pps * 2000.0 * (energy / (diameter * length * math.sqrt(width))) ** 8.587 * pi_cool
        else:
            power = _positive(input_power_kw, "input_power_kw")
            length = _positive(lamp_arc_length_inches, "lamp_arc_length_inches")
            lambda_pump = 625.0 * 10.0 ** (.9 * power / length) * pi_cool
        if laser_type == "nd_yag":
            lambda_media = 0.0
        else:
            density = _positive(energy_density_j_cm2, "energy_density_j_cm2")
            lambda_media = 3600.0 * pps * 43.5 * density ** 2.52
        pi_c = {"rigorous": 1.0, "minimal_bellows": 30.0, "minimal_no_bellows": 60.0}[cleanliness]
        pi_os = int(_positive(active_optical_surfaces, "active_optical_surfaces"))
        pi_e = _laser_pi_e(environment)
        rate = (lambda_pump + lambda_media + 16.3 * pi_c * pi_os) * pi_e
        factors = {"lambda_PUMP": lambda_pump, "lambda_MEDIA": lambda_media, "pi_C": pi_c, "pi_OS": pi_os, "pi_COOL": pi_cool, "pi_E": pi_e}
        steps = [_step("λPUMP", "flashlamp contribution", "xenon or krypton empirical equation", pump_type, lambda_pump, FPMH), _step("λMEDIA", "rod-media contribution", "0 Nd:YAG; 3600(PPS)43.5F^2.52 ruby", laser_type, lambda_media, FPMH), _step("λp", "solid-state laser rate", "(λPUMP+λMEDIA+16.3πCπOS)πE", "substituted from listed factors", rate, FPMH)]
        self._finish(rate, section="8.4", pages="8-5–8-6", equation="λp = (λPUMP + λMEDIA + 16.3 πC πOS) πE", model=f"{laser_type} solid-state laser", factors=factors, steps=steps, assumptions=(_LASER_SCOPE_ASSUMPTION,))


# ---------------------------------------------------------------------------
# Section 9: resistors
# ---------------------------------------------------------------------------

_PI_E_RESISTOR = _env([1, 4, 16, 12, 42, 18, 23, 31, 43, 63, .5, 37, 87, 1728])
_PI_Q_RESISTOR = {"S": .03, "R": .1, "P": .3, "M": 1.0, "non-ER": 3.0, "commercial": 10.0}

# style: (base rate, temperature-column, stress-column); zero means factor 1.
_RESISTOR_STYLES = {
    "RC": (.0017, 1, 2), "RCR": (.0017, 1, 2),
    "RL": (.0037, 2, 1), "RLR": (.0037, 2, 1),
    "RN": (.0037, 2, 1), "RNR": (.0037, 2, 1), "RM": (.0037, 2, 1),
    "RD": (.0037, 0, 1), "RZ": (.0019, 1, 0),
    "RB": (.0024, 2, 1), "RBR": (.0024, 2, 1),
    "RW": (.0024, 2, 2), "RWR": (.0024, 2, 2),
    "RE": (.0024, 2, 2), "RER": (.0024, 2, 2),
    "RTH": (.0019, 0, 0), "RT": (.0024, 2, 1),
    "RTR": (.0024, 2, 1), "RR": (.0024, 2, 1),
    "RA": (.0024, 1, 1), "RK": (.0024, 1, 1),
    "RP": (.0024, 2, 1), "RJ": (.0037, 2, 1),
    "RJR": (.0037, 2, 1), "RV": (.0037, 2, 1),
    "RQ": (.0037, 1, 1), "RVC": (.0037, 1, 1),
}


class Resistor(_Part):
    """Section 9.1 MIL-style resistor part-stress model."""
    category = "resistor"

    def __init__(self, style: str = "RL", power_stress: float = .5,
                 rated_power: float = .5, case_temperature_c: float = 40.0,
                 quality: str = "commercial", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", pi_Q: float | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        style = style.upper(); _choice(style, _RESISTOR_STYLES, "style")
        stress = _ratio(power_stress, "power_stress")
        power = _positive(rated_power, "rated_power")
        lambda_b, t_col, s_col = _RESISTOR_STYLES[style]
        Ea = {0: None, 1: .2, 2: .08}[t_col]
        case_temperature = _temperature(case_temperature_c, "case_temperature_c")
        pi_t = 1.0 if Ea is None else arrhenius_pi_T(case_temperature, Ea)
        pi_p = power ** .39
        pi_s = 1.0 if s_col == 0 else (.71 * math.exp(1.1 * stress) if s_col == 1 else .54 * math.exp(2.04 * stress))
        _choice(quality, _PI_Q_RESISTOR, "quality")
        if pi_Q is None:
            pi_q = _PI_Q_RESISTOR[quality]
            if standard == "VITA-51.1" and quality == "commercial":
                pi_q = .1 if style in ("RM", "RZ") else 1.0
        else:
            pi_q = _positive(pi_Q, "pi_Q")
        pi_e = float(_PI_E_RESISTOR[environment])
        rate = lambda_b * pi_t * pi_p * pi_s * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_P": pi_p, "pi_S": pi_s, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step(
                "λb", "base failure rate for the selected resistor style",
                "Table 9.1 lookup by resistor style", style, lambda_b, FPMH,
                expression_latex=r"\lambda_b=\operatorname{lookup}_{\mathrm{Table\ 9.1}}(\mathrm{style})",
            ),
            _step(
                "πT", "temperature factor",
                "1 for temperature column 0; otherwise the Arrhenius expression",
                f"column={t_col}, case T={case_temperature:g}°C", pi_t,
                expression_latex=r"\pi_T=\begin{cases}1,&c_T=0\\\exp\!\left[-\dfrac{E_a}{k}\left(\dfrac{1}{T+273}-\dfrac{1}{298}\right)\right],&c_T\in\{1,2\}\end{cases}",
            ),
            _step(
                "πP", "rated-power factor", "Rated power raised to 0.39",
                f"Pr={power:g} W", pi_p,
                expression_latex=r"\pi_P=P_r^{0.39}",
            ),
            _step(
                "πS", "power-stress factor", "Piecewise equation selected by Table 9.1 stress column",
                f"column={s_col}, S={stress:g}", pi_s,
                expression_latex=r"\pi_S=\begin{cases}1,&c_S=0\\0.71\exp(1.1S),&c_S=1\\0.54\exp(2.04S),&c_S=2\end{cases}",
            ),
            _step(
                "πQ", "quality factor", "Table 9.1 quality lookup", f"quality={quality}", pi_q,
                expression_latex=r"\pi_Q=\operatorname{lookup}_{\mathrm{quality}}(Q)",
            ),
            _step(
                "πE", "environment factor", "Table 9.1 environment lookup", f"environment={environment}", pi_e,
                expression_latex=r"\pi_E=\operatorname{lookup}_{\mathrm{environment}}(E)",
            ),
            _step(
                "λp", "resistor failure rate", "Product of the listed factors",
                "product of listed factors", rate, FPMH,
                expression_latex=r"\lambda_p=\lambda_b\pi_T\pi_P\pi_S\pi_Q\pi_E",
            ),
        ]
        self._finish(rate, section="9.1", pages="9-1–9-3", equation="λp = λb πT πP πS πQ πE", model=f"{style} resistor", factors=factors, steps=steps)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


# ---------------------------------------------------------------------------
# Section 10: capacitors
# ---------------------------------------------------------------------------


def capacitor_voltage_stress(
    applied_dc_voltage: float,
    applied_ac_rms_voltage: float,
    rated_dc_voltage: float,
) -> float:
    """Sections 10.1/10.2: ``S=(VDC+√2·VAC,rms)/Vrated``."""
    dc = _nonnegative(applied_dc_voltage, "applied_dc_voltage")
    ac = _nonnegative(applied_ac_rms_voltage, "applied_ac_rms_voltage")
    rated = _positive(rated_dc_voltage, "rated_dc_voltage")
    stress = (dc + math.sqrt(2.0) * ac) / rated
    if stress > 1:
        raise ValueError(
            "operating voltage exceeds rated DC voltage; the MIL-HDBK-217F "
            "capacitor model is not applicable under overstress"
        )
    return stress

_PI_E_CAPACITOR = _env([1, 10, 20, 7, 15, 12, 15, 25, 30, 40, .5, 20, 50, 570])
_PI_Q_CAPACITOR = {"D": .001, "C": .01, "S": .03, "B": .03, "R": .1, "P": .3, "M": 1.0, "L": 1.5, "non-ER": 3.0, "commercial": 10.0}

# style: (lambda_b, piT column, piC column, piV column, piSR applies)
_CAPACITOR_STYLES = {
    "CP": (.00037, 1, 1, 1, False), "CA": (.00037, 1, 1, 1, False),
    "CZ": (.00037, 1, 1, 1, False), "CZR": (.00037, 1, 1, 1, False),
    "CQ": (.00051, 1, 1, 1, False), "CQR": (.00051, 1, 1, 1, False),
    "CH": (.00037, 1, 1, 1, False), "CHR": (.00051, 1, 1, 1, False),
    "CFR": (.00051, 1, 1, 1, False), "CRH": (.00051, 1, 1, 1, False),
    "CM": (.00076, 2, 1, 2, False), "CMR": (.00076, 2, 1, 2, False),
    "CB": (.00076, 2, 1, 2, False), "CY": (.00076, 2, 1, 2, False),
    "CYR": (.00076, 2, 1, 2, False),
    "CK": (.00099, 2, 1, 3, False), "CKR": (.00099, 2, 1, 3, False),
    "CC": (.00099, 2, 1, 3, False), "CCR": (.00099, 2, 1, 3, False),
    "CDR": (.0020, 2, 1, 3, False),
    "CSR": (.00040, 1, 2, 4, True), "CWR": (.00005, 1, 2, 4, True),
    "CL": (.00040, 1, 2, 4, False), "CLR": (.00040, 1, 2, 4, False),
    "CRL": (.00040, 1, 2, 4, False),
    "CU": (.00012, 2, 2, 1, False), "CUR": (.00012, 2, 2, 1, False),
    "CE": (.00012, 2, 2, 1, False),
    "CV": (.0079, 1, 1, 5, False), "PC": (.0060, 2, 1, 5, False),
    "CT": (.0000072, 2, 1, 5, False), "CG": (.0060, 1, 1, 5, False),
}
# A/V51.1 identifies commercial parts similar to MIL-PRF-49470 PS.
# MIL-HDBK-217F has no PS row, so Perdura uses its closest constituent model,
# the horizontally stacked ceramic-chip (CDR) equation, and records that
# interpretation in the result.  Keep it outside the MIL style catalog.
_VITA_CAPACITOR_STYLES = {"PS": (.0020, 2, 1, 3, False)}


def _capacitor_pi_sr(circuit_resistance_ohm_per_volt: float) -> float:
    value = _nonnegative(circuit_resistance_ohm_per_volt, "circuit_resistance_ohm_per_volt")
    if value > .8: return .66
    if value > .6: return 1.0
    if value > .4: return 1.3
    if value > .2: return 2.0
    if value > .1: return 2.7
    return 3.3


class Capacitor(_Part):
    """Section 10.1 MIL-style capacitor part-stress model."""
    category = "capacitor"

    def __init__(self, style: str = "CK", capacitance_microfarads: float = .1,
                 voltage_stress: float = .5, T_ambient: float = 40.0,
                 circuit_resistance_ohm_per_volt: float = 1.0,
                 quality: str = "commercial", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", pi_Q: float | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        style = style.upper(); _choice(style, {**_CAPACITOR_STYLES, **_VITA_CAPACITOR_STYLES}, "style")
        if style == "PS" and standard != "VITA-51.1":
            raise ValueError("PS is an A/V51.1 mapping; enable the supplement or select a MIL-HDBK-217F capacitor style")
        C = _positive(capacitance_microfarads, "capacitance_microfarads")
        stress = _ratio(voltage_stress, "voltage_stress")
        lambda_b, t_col, c_col, v_col, has_sr = (
            _VITA_CAPACITOR_STYLES.get(style) or _CAPACITOR_STYLES[style]
        )
        Ea = .15 if t_col == 1 else .35
        pi_t = arrhenius_pi_T(T_ambient, Ea)
        c_exponent = .09 if c_col == 1 else .23
        pi_c = C ** c_exponent
        pi_v = {
            1: (stress / .6) ** 5 + 1,
            2: (stress / .6) ** 10 + 1,
            3: (stress / .6) ** 3 + 1,
            4: (stress / .6) ** 17 + 1,
            5: (stress / .5) ** 3 + 1,
        }[v_col]
        pi_sr = _capacitor_pi_sr(circuit_resistance_ohm_per_volt) if has_sr else 1.0
        _choice(quality, _PI_Q_CAPACITOR, "quality")
        if pi_Q is None:
            pi_q = _PI_Q_CAPACITOR[quality]
            if standard == "VITA-51.1" and quality == "commercial":
                if style in ("CDR", "PS", "CKR", "CSR", "CLR"):
                    pi_q = .1
                elif style == "CWR":
                    pi_q = .1 if C >= .1 else 1.0
                elif style == "CCR":
                    pi_q = .46
                else:
                    pi_q = 1.0
        else:
            pi_q = _positive(pi_Q, "pi_Q")
        pi_e = float(_PI_E_CAPACITOR[environment])
        rate = lambda_b * pi_t * pi_c * pi_v * pi_sr * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_C": pi_c, "pi_V": pi_v, "pi_SR": pi_sr, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step(
                "λb", "base failure rate for the selected capacitor style",
                "Table 10.1 lookup by capacitor style", style, lambda_b, FPMH,
                expression_latex=r"\lambda_b=\operatorname{lookup}_{\mathrm{Table\ 10.1}}(\mathrm{style})",
            ),
            _step(
                "πT", "temperature factor", "Arrhenius expression selected by Table 10.1 temperature column",
                f"column={t_col}, Ea={Ea:g}", pi_t,
                expression_latex=r"\pi_T=\exp\!\left[-\dfrac{E_a}{k}\left(\dfrac{1}{T_A+273}-\dfrac{1}{298}\right)\right]",
            ),
            _step(
                "πC", "capacitance factor", "Capacitance exponent selected by Table 10.1 column",
                f"C={C:g} µF, column={c_col}", pi_c,
                expression_latex=r"\pi_C=\begin{cases}C^{0.09},&c_C=1\\C^{0.23},&c_C=2\end{cases}",
            ),
            _step(
                "πV", "voltage-stress factor", "Voltage-stress equation selected by Table 10.1 column",
                f"S={stress:g}, column={v_col}", pi_v,
                expression_latex=r"\pi_V=\begin{cases}(S/0.6)^5+1,&c_V=1\\(S/0.6)^{10}+1,&c_V=2\\(S/0.6)^3+1,&c_V=3\\(S/0.6)^{17}+1,&c_V=4\\(S/0.5)^3+1,&c_V=5\end{cases}",
            ),
            _step(
                "πSR", "series-resistance factor", "Table 10.1 series-resistance lookup when applicable",
                f"applies={has_sr}, CR={circuit_resistance_ohm_per_volt:g}", pi_sr,
                expression_latex=r"\pi_{SR}=\begin{cases}\operatorname{lookup}_{\mathrm{Table\ 10.1}}(R/V),&\mathrm{CSR/CWR}\\1,&\mathrm{otherwise}\end{cases}",
            ),
            _step(
                "πQ", "quality factor", "Table 10.1 quality lookup", f"quality={quality}", pi_q,
                expression_latex=r"\pi_Q=\operatorname{lookup}_{\mathrm{quality}}(Q)",
            ),
            _step(
                "πE", "environment factor", "Table 10.1 environment lookup", f"environment={environment}", pi_e,
                expression_latex=r"\pi_E=\operatorname{lookup}_{\mathrm{environment}}(E)",
            ),
            _step(
                "λp", "capacitor failure rate", "Product of the listed factors",
                "product of listed factors", rate, FPMH,
                expression_latex=r"\lambda_p=\lambda_b\pi_T\pi_C\pi_V\pi_{SR}\pi_Q\pi_E",
            ),
        ]
        assumptions: list[str] = []
        warnings: list[str] = []
        if standard == "VITA-51.1" and style == "PS":
            assumptions.append(
                "A/V51.1 names PS quality but MIL-HDBK-217F has no PS equation; the CDR ceramic-chip equation is used for the horizontally stacked PS construction."
            )
        if standard == "VITA-51.1" and multiplier != 1.0:
            assumptions.append(
                f"A multiplier of {multiplier:g} applies a disclosed functional/reliability credit under A/V51.1 Permission 2.1.5-1."
            )
            warnings.append(
                "Verify that the capacitor failure modes excluded by the functional credit cannot cause shorts or other system effects."
            )
        self._finish(rate, section="10.1", pages="10-1–10-6", equation="λp = λb πT πC πV πSR πQ πE", model=f"{style} capacitor", factors=factors, steps=steps, assumptions=assumptions, warnings=warnings)
        if standard == "VITA-51.1":
            annotate_vita_result(
                self, self.category,
                extra_rules=(("Permission 2.1.5-1",) if multiplier != 1.0 else ()),
            )


# ---------------------------------------------------------------------------
# Section 11: inductive devices
# ---------------------------------------------------------------------------

_PI_E_INDUCTIVE = _env([1, 6, 12, 5, 16, 6, 8, 7, 9, 24, .5, 13, 34, 610])


MIL_T27_CASE_RADIATING_AREAS = {
    "AF": 4, "AG": 7, "AH": 11, "AJ": 18, "EB": 21, "EA": 23,
    "FB": 25, "FA": 31, "GB": 33, "GA": 43, "HB": 42, "HA": 53,
    "JB": 58, "JA": 71, "KB": 72, "KA": 84, "LB": 82, "LA": 98,
    "MB": 98, "MA": 115, "NB": 117, "NA": 139, "OA": 146,
}


def inductive_hotspot_temperature(
    ambient_temperature_c: float,
    *,
    environment: str | None = None,
    temperature_rise_c: float | None = None,
    mil_c_39010_slash_sheet: str | None = None,
    power_loss_watts: float | None = None,
    case_area_sq_inches: float | None = None,
    transformer_weight_pounds: float | None = None,
    input_power_watts: float | None = None,
) -> float:
    """Return the Section 11.3 inductive-device hot-spot temperature.

    ``T_HS = T_A + 1.1 ΔT``.  Weight is in pounds.  The input-power method
    uses input power directly; its coefficient already embodies the
    handbook's 80% efficiency assumption.
    """
    ambient = _temperature(ambient_temperature_c, "ambient_temperature_c")
    if environment is not None:
        _check_environment(environment)
    methods = (
        temperature_rise_c is not None,
        mil_c_39010_slash_sheet is not None,
        power_loss_watts is not None and case_area_sq_inches is not None,
        power_loss_watts is not None and transformer_weight_pounds is not None,
        input_power_watts is not None and transformer_weight_pounds is not None,
    )
    if sum(methods) != 1:
        raise ValueError("supply exactly one complete Section 11.3 ΔT method")
    if environment == "SF" and temperature_rise_c is None:
        raise ValueError(
            "Section 11.3 requires a dedicated thermal analysis for space; "
            "do not use a handbook ΔT approximation"
        )

    if temperature_rise_c is not None:
        delta = _nonnegative(temperature_rise_c, "temperature_rise_c")
    elif mil_c_39010_slash_sheet is not None:
        sheet = str(mil_c_39010_slash_sheet).upper().replace("MIL-C-39010/", "")
        low_rise = {"1C", "2C", "3C", "5C", "7C", "9A", "10A", "13", "14"}
        high_rise = {"4C", "6C", "8A", "11", "12"}
        _choice(sheet, low_rise | high_rise, "mil_c_39010_slash_sheet")
        delta = 15.0 if sheet in low_rise else 35.0
    elif power_loss_watts is not None and case_area_sq_inches is not None:
        area = _positive(case_area_sq_inches, "case_area_sq_inches")
        if not 3 <= area <= 150:
            raise ValueError("Section 11.3 equations 2–4 apply to case areas from 3 to 150 in²")
        delta = 125.0 * _nonnegative(power_loss_watts, "power_loss_watts") / area
    elif power_loss_watts is not None:
        delta = 11.5 * _nonnegative(power_loss_watts, "power_loss_watts") / _positive(transformer_weight_pounds, "transformer_weight_pounds") ** .6766
    else:
        delta = 2.1 * _positive(input_power_watts, "input_power_watts") / _positive(transformer_weight_pounds, "transformer_weight_pounds") ** .6766
    return ambient + 1.1 * delta


class Transformer(_Part):
    """Section 11.1 transformer model."""
    category = "transformer"
    _BASE = {"flyback": .0054, "audio": .014, "low_power_pulse": .022, "high_power_pulse": .049, "rf": .13}

    def __init__(self, transformer_type: str = "low_power_pulse", T_hotspot: float = 60.0,
                 quality: str = "lower", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(transformer_type, self._BASE, "transformer_type"); _choice(quality, ("MIL-SPEC", "lower"), "quality")
        lambda_b = self._BASE[transformer_type]; pi_t = arrhenius_pi_T(T_hotspot, .11)
        pi_q = 1.0 if quality == "MIL-SPEC" else 3.0; pi_e = float(_PI_E_INDUCTIVE[environment])
        rate = lambda_b * pi_t * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [_step("πT", "hot-spot temperature factor", "exp[-.11/k(1/(THS+273)-1/298)]", f"THS={T_hotspot:g}°C", pi_t), _step("λp", "transformer failure rate", "λbπTπQπE", "product of listed factors", rate, FPMH)]
        self._finish(rate, section="11.1", pages="11-1–11-2", equation="λp = λb πT πQ πE", model=f"{transformer_type} transformer", factors=factors, steps=steps, assumptions=("Insulation rated temperature is not exceeded for more than 5% of operating time.",))


class InductorCoil(_Part):
    """Section 11.2 inductor/coil model."""
    category = "inductor_coil"

    def __init__(self, adjustment: str = "fixed", T_hotspot: float = 60.0,
                 quality: str = "non-ER", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(adjustment, ("fixed", "variable"), "adjustment")
        q_table = {"S": .03, "R": .1, "P": .3, "M": 1.0, "MIL-SPEC": 1.0, "non-ER": 3.0}
        _choice(quality, q_table, "quality")
        lambda_b = .000030 if adjustment == "fixed" else .000050
        pi_t = arrhenius_pi_T(T_hotspot, .11); pi_q = q_table[quality]; pi_e = float(_PI_E_INDUCTIVE[environment])
        rate = lambda_b * pi_t * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="11.2", pages="11-3", equation="λp = λb πT πQ πE", model=f"{adjustment} inductor/coil", factors=factors, steps=[_step("λp", "coil failure rate", "λbπTπQπE", "product of listed factors", rate, FPMH)])


class FerriteBead(_Part):
    """A/V51.1 §2.1.6.1 mapping of a ferrite bead to Section 11.2."""
    category = "ferrite_bead"

    def __init__(self, T_ambient: float = 40.0,
                 quality_basis: str = "recommended", environment: str = "GB",
                 standard: str = "VITA-51.1", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        if standard != "VITA-51.1":
            raise ValueError("Ferrite beads require the A/V51.1 supplement; MIL-HDBK-217F has no ferrite-bead model")
        _choice(quality_basis, ("recommended", "appendix_a_reproduction"), "quality_basis")
        ambient = _temperature(T_ambient, "T_ambient")
        lambda_b = .00003
        pi_t = arrhenius_pi_T(ambient, .11)
        pi_q = 3.0 if quality_basis == "recommended" else 1.0
        pi_e = float(_PI_E_INDUCTIVE[environment])
        rate = lambda_b * pi_t * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [
            _step("πT", "ambient-temperature factor", "exp[-.11/k(1/(TA+273)-1/298)]", f"TA={ambient:g}°C", pi_t),
            _step("λp", "ferrite-bead mapped rate", "λbπTπQπE", f"{lambda_b:g}·{pi_t:g}·{pi_q:g}·{pi_e:g}", rate, FPMH),
        ]
        self._finish(
            rate, section="11.2 + A/V51.1 2.1.6.1", pages="11-3; A/V page 13",
            equation="λp = .00003 πT πQ πE", model="ferrite bead mapped to fixed inductor",
            factors=factors, steps=steps,
            assumptions=(
                "A/V51.1 directs use of the fixed-inductor model and neglects bead temperature rise.",
                "πQ=3 is the A/V51.1 recommended subsequent-use value; πQ=1 is available only to reproduce the handbook Appendix A row.",
            ),
        )
        annotate_vita_result(self, self.category)


# ---------------------------------------------------------------------------
# Section 12: rotating devices
# ---------------------------------------------------------------------------

_MOTOR_AB = {"general": (1.9, 1.1), "sensor": (.48, .29), "servo": (2.4, 1.7), "stepper": (11.0, 5.4)}
_MOTOR_ECF = [(.10, .13), (.20, .15), (.30, .23), (.40, .31), (.50, .41), (.60, .51), (.70, .61), (.80, .68), (.90, .76), (math.inf, 1.0)]


def _motor_characteristic_lives(T_ambient: float) -> tuple[float, float]:
    T = _temperature(T_ambient, "T_ambient")
    alpha_b = (10 ** (2.534 - 2357 / (T + 273)) + 1 / (10 ** (20 - 4500 / (T + 273)) + 300)) ** -1
    alpha_w = 10 ** (2357 / (T + 273) - 1.83)
    return alpha_b, alpha_w


def _weighted_characteristic_life(profile: Sequence[tuple[float, float]], index: int) -> float:
    hours_total = 0.0; damage = 0.0
    for hours, temperature in profile:
        h = _positive(hours, "profile hours")
        alpha = _motor_characteristic_lives(temperature)[index]
        hours_total += h; damage += h / alpha
    if not hours_total:
        raise ValueError("temperature_profile must not be empty")
    return hours_total / damage


def _effective_cumulative_failure(ratio: float) -> float:
    ratio = _nonnegative(ratio, "life_cycle/characteristic_life")
    for upper, value in _MOTOR_ECF:
        if ratio <= upper: return value
    raise RuntimeError("unreachable")


class Motor(_Part):
    """Section 12.1 sub-one-horsepower motor bearing/winding Weibull model."""
    category = "motor"

    def __init__(self, motor_type: str = "general", T_ambient: float = 50.0,
                 life_cycle_hours: float = 87600.0,
                 temperature_profile: Sequence[tuple[float, float]] | None = None,
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _choice(motor_type, _MOTOR_AB, "motor_type")
        LC = _positive(life_cycle_hours, "life_cycle_hours")
        if temperature_profile is not None:
            profile = [
                (
                    _positive(hours, "profile hours"),
                    _temperature(temperature, "profile temperature"),
                )
                for hours, temperature in temperature_profile
            ]
            if not profile:
                raise ValueError("temperature_profile must not be empty")
            alpha_b = _weighted_characteristic_life(profile, 0)
            alpha_w = _weighted_characteristic_life(profile, 1)
            thermal_basis = "; ".join(
                f"{hours:g} h at {temperature:g}°C"
                for hours, temperature in profile
            )
        else:
            alpha_b, alpha_w = _motor_characteristic_lives(T_ambient)
            thermal_basis = f"TA={T_ambient:g}°C"
        A, B = _MOTOR_AB[motor_type]
        lambda1 = _effective_cumulative_failure(LC / alpha_b)
        lambda2 = _effective_cumulative_failure(LC / alpha_w)
        bearing = lambda1 / (A * alpha_b); winding = lambda2 / (B * alpha_w)
        rate = (bearing + winding) * 1e6
        factors = {"A": A, "B": B, "alpha_B": alpha_b, "alpha_W": alpha_w, "lambda_1": lambda1, "lambda_2": lambda2, "bearing_rate_per_hour": bearing, "winding_rate_per_hour": winding, "thermal_basis": thermal_basis}
        steps = [
            _step("αB", "bearing characteristic life", "Section 12.1 temperature equation/harmonic weighting", thermal_basis, alpha_b, "hours"),
            _step("αW", "winding characteristic life", "10^[2357/(TA+273)-1.83] or harmonic weighting", thermal_basis, alpha_w, "hours"),
            _step("λ1", "bearing effective cumulative failures", "table lookup from LC/αB", f"{LC:g}/{alpha_b:g}", lambda1, "failures"),
            _step("λ2", "winding effective cumulative failures", "table lookup from LC/αW", f"{LC:g}/{alpha_w:g}", lambda2, "failures"),
            _step("λp", "average motor failure rate", "[λ1/(AαB)+λ2/(BαW)]10^6", f"[{lambda1:g}/({A:g}·{alpha_b:g})+{lambda2:g}/({B:g}·{alpha_w:g})]10^6", rate, FPMH),
        ]
        self._finish(rate, section="12.1", pages="12-1–12-3", equation="λp = [λ1/(A αB) + λ2/(B αW)] × 10^6", model=f"{motor_type} motor", factors=factors, steps=steps, assumptions=("Model applies to motors below one horsepower and assumes brush inspection/replacement where applicable.",))


_PI_E_SYNCHRO = _env([1, 2, 12, 7, 18, 4, 6, 16, 25, 26, .5, 14, 36, 680])


class SynchroResolver(_Part):
    """Section 12.2 synchro/resolver model."""
    category = "synchro_resolver"

    def __init__(self, device_type: str = "synchro", frame_temperature: float = 60.0,
                 frame_size: int = 10, brushes: int = 2, environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(device_type, ("synchro", "resolver"), "device_type")
        size = int(_positive(frame_size, "frame_size")); brushes = int(_positive(brushes, "brushes"))
        if brushes > 4: raise ValueError("Section 12.2 brush table supports at most four brushes")
        T = _temperature(frame_temperature, "frame_temperature")
        lambda_b = .00535 * math.exp(((T + 273) / 334) ** 8.5)
        band = 0 if size <= 8 else 1 if size <= 16 else 2
        pi_s = ((2, 1.5, 1), (3, 2.25, 1.5))[device_type == "resolver"][band]
        pi_n = 1.4 if brushes <= 2 else 2.5 if brushes == 3 else 3.2
        pi_e = float(_PI_E_SYNCHRO[environment]); rate = lambda_b * pi_s * pi_n * pi_e
        factors = {"lambda_b": lambda_b, "pi_S": pi_s, "pi_N": pi_n, "pi_E": pi_e}
        steps = [_step("λb", "frame-temperature base rate", ".00535 exp[((TF+273)/334)^8.5]", f"TF={T:g}°C", lambda_b, FPMH), _step("λp", "rotating-device rate", "λbπSπNπE", "product of listed factors", rate, FPMH)]
        self._finish(rate, section="12.2", pages="12-4", equation="λp = λb πS πN πE", model=device_type, factors=factors, steps=steps)


_PI_E_ELAPSED = _env([1, 2, 12, 7, 18, 5, 8, 16, 25, 26, .5, 14, 38, None])


class ElapsedTimeMeter(_Part):
    """Section 12.3 elapsed-time meter model."""
    category = "elapsed_time_meter"

    def __init__(self, drive_type: str = "ac", operating_to_rated_temperature: float = .5,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(drive_type, ("ac", "inverter", "commutator_dc"), "drive_type")
        ratio = _ratio(operating_to_rated_temperature, "operating_to_rated_temperature")
        lambda_b = {"ac": 20.0, "inverter": 30.0, "commutator_dc": 80.0}[drive_type]
        pi_t = .5 if ratio <= .5 else .6 if ratio <= .6 else .8 if ratio <= .8 else 1.0
        pi_e_raw = _PI_E_ELAPSED[environment]
        if pi_e_raw is None: raise ValueError("Section 12.3 does not provide a Cannon Launch factor")
        pi_e = float(pi_e_raw); rate = lambda_b * pi_t * pi_e
        factors = {"lambda_b": lambda_b, "pi_T": pi_t, "pi_E": pi_e}
        self._finish(rate, section="12.3", pages="12-5", equation="λp = λb πT πE", model=f"{drive_type} elapsed-time meter", factors=factors, steps=[_step("λp", "meter failure rate", "λbπTπE", "product of listed factors", rate, FPMH)])


# ---------------------------------------------------------------------------
# Section 13: relays
# ---------------------------------------------------------------------------

_PI_E_RELAY = _env([1, 2, 15, 8, 27, 7, 9, 11, 12, 46, .5, 25, 66, None])
_PI_E_SS_RELAY = _env([1, 3, 12, 6, 17, 12, 19, 21, 32, 23, .4, 12, 33, 590])
_RELAY_PI_Q = {"R": .10, "P": .30, "X": .45, "U": .60, "M": 1.0, "L": 1.5, "MIL-SPEC": 1.5, "commercial": 2.9}
_RELAY_CONTACT_FORM = {"SPST": 1.0, "DPST": 1.5, "SPDT": 1.75, "3PST": 2.0, "4PST": 2.5, "DPDT": 3.0, "3PDT": 4.25, "4PDT": 5.5, "6PDT": 8.0}
_RELAY_PI_F = {
    "signal_dry_armature_long": 4, "signal_dry_reed": 6, "signal_mercury_wetted": 1,
    "signal_magnetic_latching": 4, "signal_balanced_armature": 7, "signal_solenoid": 7,
    "general_armature_long": 3, "general_balanced_armature": 5, "general_solenoid": 6,
    "sensitive_armature": 5, "sensitive_mercury_wetted": 2, "sensitive_magnetic_latching": 6,
    "sensitive_meter_movement": 100, "sensitive_balanced_armature": 10,
    "polarized_armature_short": 10, "polarized_meter_movement": 100,
    "vibrating_dry_reed": 6, "vibrating_mercury_wetted": 1,
    "high_speed_armature": 25, "high_speed_dry_reed": 6,
    "thermal_time_delay_bimetal": 10, "electronic_time_delay": 9,
    "latching_dry_reed": 10, "latching_mercury_wetted": 5, "latching_balanced_armature": 5,
    "high_voltage_vacuum_glass": 20, "high_voltage_vacuum_ceramic": 5,
    "medium_power_armature": 3, "medium_power_mercury_wetted": 1,
    "medium_power_magnetic_latching": 2, "medium_power_mechanical_latching": 3,
    "medium_power_balanced_armature": 2, "medium_power_solenoid": 2,
    "contactor_armature_short": 7, "contactor_mechanical_latching": 12,
    "contactor_balanced_armature": 10, "contactor_solenoid": 5,
}


class Relay(_Part):
    """Section 13.1 mechanical relay model."""
    category = "relay"

    def __init__(self, rated_temperature: int = 125, T_ambient: float = 40.0,
                 load_type: str = "resistive", load_stress: float = .5,
                 contact_form: str = "DPDT", cycles_per_hour: float = 1.0,
                 configuration: str = "general_armature_long", quality: str = "commercial",
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        rated_temperature = int(rated_temperature)
        if rated_temperature not in (85, 125): raise ValueError("rated_temperature must be 85 or 125°C")
        _choice(load_type, ("resistive", "inductive", "lamp"), "load_type")
        _choice(contact_form, _RELAY_CONTACT_FORM, "contact_form"); _choice(configuration, _RELAY_PI_F, "configuration")
        _choice(quality, _RELAY_PI_Q, "quality")
        stress = _ratio(load_stress, "load_stress"); cycles = _nonnegative(cycles_per_hour, "cycles_per_hour")
        ambient = _temperature(T_ambient, "T_ambient")
        if ambient > rated_temperature:
            raise ValueError("relay ambient temperature exceeds its Section 13.1 rated temperature")
        Ea = .19 if rated_temperature == 85 else .17
        lambda_b = .0059 * arrhenius_pi_T(ambient, Ea)
        denominator = {"resistive": .8, "inductive": .4, "lamp": .2}[load_type]
        pi_l = math.exp((stress / denominator) ** 2)
        pi_c = _RELAY_CONTACT_FORM[contact_form]
        if quality == "commercial":
            pi_cyc = 1.0 if cycles < 10 else cycles / 10.0 if cycles <= 1000 else (cycles / 100.0) ** 2
        else:
            pi_cyc = .1 if cycles < 1 else cycles / 10.0
        pi_f = float(_RELAY_PI_F[configuration]); pi_q = _RELAY_PI_Q[quality]
        if standard == "VITA-51.1" and quality == "commercial":
            pi_q = 1.5
        pi_e_raw = _PI_E_RELAY[environment]
        if pi_e_raw is None: raise ValueError("Section 13.1 does not provide a Cannon Launch factor")
        pi_e = float(pi_e_raw)
        rate = lambda_b * pi_l * pi_c * pi_cyc * pi_f * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_L": pi_l, "pi_C": pi_c, "pi_CYC": pi_cyc, "pi_F": pi_f, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [_step("λb", "temperature-dependent base rate", ".0059 exp[-Ea/k(1/(TA+273)-1/298)]", f"Ea={Ea:g}, TA={ambient:g}°C", lambda_b, FPMH), _step("πL", "load factor", "exp[(S/d)^2]", f"d={denominator:g}, S={stress:g}", pi_l), _step("πCYC", "cycling factor", "MIL/commercial piecewise table", f"{cycles:g} cycles/h", pi_cyc), _step("λp", "relay failure rate", "λbπLπCπCYCπFπQπE", "product of listed factors", rate, FPMH)]
        self._finish(rate, section="13.1", pages="13-1–13-2", equation="λp = λb πL πC πCYC πF πQ πE", model="mechanical relay", factors=factors, steps=steps)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class SolidStateRelay(_Part):
    """Section 13.2 default solid-state/time-delay relay model."""
    category = "ss_relay"

    def __init__(self, relay_type: str = "solid_state",
                 quality: str = "commercial", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(relay_type, ("solid_state", "solid_state_time_delay", "hybrid"), "relay_type")
        _choice(quality, ("MIL-SPEC", "commercial"), "quality")
        lambda_b = .029
        pi_q = 1.0 if quality == "MIL-SPEC" or standard == "VITA-51.1" else 1.9
        pi_e = float(_PI_E_SS_RELAY[environment])
        rate = lambda_b * pi_q * pi_e; factors = {"lambda_b": lambda_b, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="13.2", pages="13-3", equation="λp = .029 πQ πE", model=f"{relay_type} relay default", factors=factors, steps=[_step("λp", "default relay failure rate", ".029πQπE", f".029·{pi_q:g}·{pi_e:g}", rate, FPMH)], assumptions=("The handbook prefers summing the device's electronic piece parts when design detail is available.",))
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


# ---------------------------------------------------------------------------
# Section 14: switches and circuit breakers
# ---------------------------------------------------------------------------

_PI_E_SWITCH = _env([1, 3, 18, 8, 29, 10, 18, 13, 22, 46, .5, 25, 67, 1200])
_PI_E_BREAKER = _env([1, 2, 15, 8, 27, 7, 9, 11, 12, 46, .5, 25, 66, None])
_SWITCH_BASE = {"centrifugal": 3.4, "dip": .00012, "limit": 4.3, "liquid": 2.3, "microwave": 1.7, "pressure": 2.8, "pushbutton": .10, "reed": .0010, "rocker": .023, "rotary": .11, "sensitive": .49, "thermal": .031, "thumbwheel": .18, "toggle": .10}


class Switch(_Part):
    """Section 14.1 switch model."""
    category = "switch"

    def __init__(self, switch_type: str = "toggle", load_type: str = "resistive",
                 load_stress: float = .5, active_contacts: int = 1,
                 rated_by_inductive_load: bool | str | int = False,
                 quality: str = "lower", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(switch_type, _SWITCH_BASE, "switch_type"); _choice(load_type, ("resistive", "inductive", "lamp"), "load_type"); _choice(quality, ("MIL-SPEC", "lower"), "quality")
        stress = _ratio(load_stress, "load_stress"); contacts = int(_positive(active_contacts, "active_contacts"))
        lambda_b = _SWITCH_BASE[switch_type]
        inductive_rating = _boolean(rated_by_inductive_load, "rated_by_inductive_load")
        load_factor_type = "resistive" if load_type == "inductive" and inductive_rating else load_type
        denominator = {"resistive": .8, "inductive": .4, "lamp": .2}[load_factor_type]
        pi_l = math.exp((stress / denominator) ** 2)
        pi_c = contacts ** .33 if switch_type in ("toggle", "pushbutton") else 1.0
        pi_q = 1.0 if quality == "MIL-SPEC" or standard == "VITA-51.1" else 2.0
        pi_e = float(_PI_E_SWITCH[environment])
        rate = lambda_b * pi_l * pi_c * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_L": pi_l, "pi_C": pi_c, "pi_Q": pi_q, "pi_E": pi_e, "rated_by_inductive_load": inductive_rating}
        steps = [
            _step("πL", "load-stress factor", "exp[(S/d)^2]", f"load={load_factor_type}, d={denominator:g}, S={stress:g}", pi_l),
            _step("λp", "switch failure rate", "λbπLπCπQπE", "product of listed factors", rate, FPMH),
        ]
        self._finish(rate, section="14.1", pages="14-1–14-2", equation="λp = λb πL πC πQ πE", model=f"{switch_type} switch", factors=factors, steps=steps)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class CircuitBreaker(_Part):
    """Section 14.2 circuit-breaker model."""
    category = "circuit_breaker"

    def __init__(self, breaker_type: str = "magnetic", poles: int = 1,
                 usage: str = "normal", quality: str = "lower",
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(breaker_type, ("magnetic", "thermal", "thermal_magnetic"), "breaker_type")
        poles = int(_positive(poles, "poles"))
        if poles > 4: raise ValueError("Section 14.2 supports one through four poles")
        _choice(usage, ("normal", "power_on_off"), "usage"); _choice(quality, ("MIL-SPEC", "lower"), "quality")
        lambda_b = .34; pi_c = float(poles); pi_u = 1.0 if usage == "normal" else 2.5; pi_q = 1.0 if quality == "MIL-SPEC" else 8.4
        pi_e_raw = _PI_E_BREAKER[environment]
        if pi_e_raw is None: raise ValueError("Section 14.2 does not provide a Cannon Launch factor")
        pi_e = float(pi_e_raw); rate = lambda_b * pi_c * pi_u * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_C": pi_c, "pi_U": pi_u, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="14.2", pages="14-3", equation="λp = .34 πC πU πQ πE", model=f"{breaker_type} circuit breaker", factors=factors, steps=[_step("λp", "breaker failure rate", ".34πCπUπQπE", "product of listed factors", rate, FPMH)])


# ---------------------------------------------------------------------------
# Section 15: connectors and sockets
# ---------------------------------------------------------------------------

_PI_E_CONNECTOR = _env([1, 1, 8, 5, 13, 3, 5, 8, 12, 19, .5, 10, 27, 490])
_PI_E_SOCKET = _env([1, 3, 14, 6, 18, 8, 12, 11, 13, 25, .5, 14, 36, 650])
_CONNECTOR_BASE = {"circular": .0010, "card_edge": .040, "hexagonal": .15, "rack_panel": .021, "rectangular": .046, "rf_coaxial": .00041, "telephone": .0075, "power": .0070, "triaxial": .0036}
_CONTACT_GAUGE_COEFFICIENT = {32: 3.256, 30: 2.856, 28: 2.286, 24: 1.345, 22: .989, 20: .640, 18: .429, 16: .274, 12: .100}


def connector_insert_temperature_rise(current_amperes: float, contact_gauge: int) -> float:
    _choice(contact_gauge, _CONTACT_GAUGE_COEFFICIENT, "contact_gauge")
    return _CONTACT_GAUGE_COEFFICIENT[contact_gauge] * _nonnegative(current_amperes, "current_amperes") ** 1.85


class Connector(_Part):
    """Section 15.1 general connector model for a mated pair."""
    category = "connector"

    def __init__(self, connector_type: str = "circular", T_ambient: float = 40.0,
                 insert_temperature_rise: float = 0.0, matings_per_1000_hours: float = .05,
                 quality: str = "lower", assembly: str = "mated_pair",
                 vita_use_standard_defaults: bool | str | int = True,
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        requested = (connector_type, matings_per_1000_hours, assembly)
        use_vita_defaults = _boolean(vita_use_standard_defaults, "vita_use_standard_defaults")
        if standard == "VITA-51.1" and use_vita_defaults:
            connector_type = "rectangular"
            matings_per_1000_hours = .05
            assembly = "single_half"
        _choice(connector_type, _CONNECTOR_BASE, "connector_type"); _choice(quality, ("MIL-SPEC", "lower"), "quality"); _choice(assembly, ("mated_pair", "single_half"), "assembly")
        rise = _nonnegative(insert_temperature_rise, "insert_temperature_rise"); cycles = _nonnegative(matings_per_1000_hours, "matings_per_1000_hours")
        lambda_b = _CONNECTOR_BASE[connector_type]; T0 = _temperature(T_ambient, "T_ambient") + rise
        pi_t = arrhenius_pi_T(T0, .14)
        pi_k = 1.0 if cycles <= .05 else 1.5 if cycles <= .5 else 2.0 if cycles <= 5 else 3.0 if cycles <= 50 else 4.0
        pi_q = 1.0 if quality == "MIL-SPEC" or standard == "VITA-51.1" else 2.0
        pi_e = float(_PI_E_CONNECTOR[environment])
        rate = lambda_b * pi_t * pi_k * pi_q * pi_e * (.5 if assembly == "single_half" else 1.0)
        factors = {"lambda_b": lambda_b, "T_0": T0, "pi_T": pi_t, "pi_K": pi_k, "pi_Q": pi_q, "pi_E": pi_e, "assembly_factor": .5 if assembly == "single_half" else 1.0}
        steps = [_step("T0", "connector operating temperature", "TA+ΔT", f"{T_ambient:g}+{rise:g}", T0, "°C"), _step("πK", "mating/unmating factor", "Section 15.1 band table", f"{cycles:g} cycles/1000h", pi_k), _step("λp", "connector failure rate", "λbπTπKπQπE", "product of listed factors; halve for one connector", rate, FPMH)]
        assumptions = ()
        if standard == "VITA-51.1" and use_vita_defaults:
            assumptions = (
                "A/V51.1 standard defaults were used for a module/CCA connector: rectangular, single connector, and 0.05 mating cycles per 1000 hours.",
                f"The entered tuple {requested!r} is retained only as audit context; set vita_use_standard_defaults=false when actual connector data are known.",
            )
        self._finish(rate, section="15.1", pages="15-1–15-2", equation="λp = λb πT πK πQ πE", model=f"{connector_type} connector {assembly}", factors=factors, steps=steps, assumptions=assumptions)
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class ConnectorSocket(_Part):
    """Section 15.2 connector socket model."""
    category = "connector_socket"

    def __init__(self, socket_type: str = "dip_sip_chip_pga", active_pins: int = 16,
                 quality: str = "lower", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        base = {"dip_sip_chip_pga": .00064, "relay": .037, "transistor": .0051, "tube_crt": .011}
        _choice(socket_type, base, "socket_type"); _choice(quality, ("MIL-SPEC", "lower"), "quality")
        pins = int(_positive(active_pins, "active_pins")); lambda_b = base[socket_type]
        pi_p = math.exp(((pins - 1) / 10.0) ** .39); pi_q = .3 if quality == "MIL-SPEC" else 1.0; pi_e = float(_PI_E_SOCKET[environment])
        rate = lambda_b * pi_p * pi_q * pi_e; factors = {"lambda_b": lambda_b, "pi_P": pi_p, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="15.2", pages="15-3", equation="λp = λb πP πQ πE", model=f"{socket_type} socket", factors=factors, steps=[_step("πP", "active-pins factor", "exp[((N-1)/10)^.39]", f"N={pins}", pi_p), _step("λp", "socket failure rate", "λbπPπQπE", "product of listed factors", rate, FPMH)])


# ---------------------------------------------------------------------------
# Section 16: interconnection assemblies
# ---------------------------------------------------------------------------

_PI_E_PTH = _env([1, 2, 7, 5, 13, 5, 8, 16, 28, 19, .5, 10, 27, 500])

# A/V51.1 Appendix F, Table 1.  Midpoints are used only for printed ranges;
# callers may supply measured E1/alpha1 values to avoid that default.
VITA_PTH_LAMINATES = {
    "epoxy_aramid": (3.625e6, 10.5e-5),
    "epoxy_glass_fr4_g10": (2.52e6, 7.0e-5),
    "epoxy_quartz": (2.7e6, 6.2e-5),
    "polyimide_aramid": (3.41e6, 8.3e-5),
    "polyimide_glass": (2.84e6, 7.0e-5),
    "polyimide_quartz": (4.0e6, 3.5e-5),
    "ptfe_glass": (.145e6, 26.1e-5),
}


def vita_pth_fatigue(
    *,
    temperature_range_c: float,
    board_thickness_inches: float,
    drilled_hole_diameter_inches: float,
    plating_thickness_inches: float,
    hours_per_thermal_cycle: float,
    laminate: str = "epoxy_glass_fr4_g10",
    laminate_elastic_modulus_psi: float | None = None,
    laminate_cte_per_c: float | None = None,
    copper_cte_per_c: float = 1.8e-5,
    copper_yield_strength_psi: float = 2.5e4,
    copper_elastic_modulus_psi: float = 1.2e7,
    copper_plastic_modulus_psi: float = .1e6,
    copper_ductility: float = .30,
    copper_ultimate_strength_psi: float = 4e4,
) -> dict[str, float | str]:
    """Solve A/V51.1 Appendix F equations 1.2--1.7.

    The denominator printed in Equation 1.2 has dimensions inconsistent with
    both stress and the following strain equation.  Perdura restores the
    series-compliance form of the IPC-TR-579 bilinear barrel-stress model:

    ``sigma = [dalpha*dT + Sy(E2-E2')/(E2 E2')] /
    [1/E2' + A2/(A1 E1)]`` after yield, with the corresponding elastic branch
    below yield.  This is explicitly disclosed in every result.
    """
    _choice(laminate, VITA_PTH_LAMINATES, "laminate")
    default_e1, default_alpha1 = VITA_PTH_LAMINATES[laminate]
    E1 = _positive(
        default_e1 if laminate_elastic_modulus_psi is None else laminate_elastic_modulus_psi,
        "laminate_elastic_modulus_psi",
    )
    alpha1 = _positive(
        default_alpha1 if laminate_cte_per_c is None else laminate_cte_per_c,
        "laminate_cte_per_c",
    )
    alpha2 = _positive(copper_cte_per_c, "copper_cte_per_c")
    delta_t = _positive(temperature_range_c, "temperature_range_c")
    h = _positive(board_thickness_inches, "board_thickness_inches")
    d = _positive(drilled_hole_diameter_inches, "drilled_hole_diameter_inches")
    t = _positive(plating_thickness_inches, "plating_thickness_inches")
    if 2 * t >= d:
        raise ValueError("twice the PTH plating thickness must be less than the drilled diameter")
    hours = _positive(hours_per_thermal_cycle, "hours_per_thermal_cycle")
    sy = _positive(copper_yield_strength_psi, "copper_yield_strength_psi")
    E2 = _positive(copper_elastic_modulus_psi, "copper_elastic_modulus_psi")
    E2p = _positive(copper_plastic_modulus_psi, "copper_plastic_modulus_psi")
    if E2p >= E2:
        raise ValueError("copper_plastic_modulus_psi must be below copper_elastic_modulus_psi")
    ductility = _positive(copper_ductility, "copper_ductility")
    if ductility > 2:
        raise ValueError("copper_ductility must not exceed 2.0")
    su = _positive(copper_ultimate_strength_psi, "copper_ultimate_strength_psi")

    A1 = math.pi / 4.0 * ((h + d) ** 2 - d ** 2)
    A2 = math.pi / 4.0 * (d ** 2 - (d - 2.0 * t) ** 2)
    mismatch = abs(alpha1 - alpha2) * delta_t
    elastic_stress = mismatch / (1.0 / E2 + A2 / (A1 * E1))
    if elastic_stress <= sy:
        stress = elastic_stress
        strain = stress / E2
        branch = "elastic"
    else:
        stress = (
            mismatch + sy * (E2 - E2p) / (E2 * E2p)
        ) / (1.0 / E2p + A2 / (A1 * E1))
        strain = sy / E2 + (stress - sy) / E2p
        branch = "elastic-plastic"
    if strain <= 0:
        raise ValueError("calculated PTH cyclic strain is not positive")

    fatigue_base = math.exp(ductility) / .36

    def predicted_strain(log10_cycles: float) -> float:
        cycles = 10.0 ** log10_cycles
        plastic_term = cycles ** -.6 * ductility ** .75
        elastic_term = .9 * su / E2 * fatigue_base ** (
            .1785 * math.log10(1e5 / cycles)
        )
        return plastic_term + elastic_term

    lo, hi = -6.0, 24.0
    if predicted_strain(lo) < strain or predicted_strain(hi) > strain:
        raise ValueError("PTH fatigue root lies outside the supported 10^-6 to 10^24 cycle search interval")
    for _ in range(160):
        mid = (lo + hi) / 2.0
        if predicted_strain(mid) > strain:
            lo = mid
        else:
            hi = mid
    cycles = 10.0 ** ((lo + hi) / 2.0)
    fpmh = 1e6 / (hours * cycles)
    return {
        "A1": A1,
        "A2": A2,
        "alpha_1": alpha1,
        "alpha_2": alpha2,
        "E1": E1,
        "E2": E2,
        "E2_prime": E2p,
        "sigma": stress,
        "delta_epsilon": strain,
        "N_f": cycles,
        "hours_per_cycle": hours,
        "FPMH": fpmh,
        "constitutive_branch": branch,
    }


class PlatedThroughHoleAssembly(_Part):
    """Section 16.1 interconnection assembly with plated-through holes."""
    category = "pth_assembly"

    def __init__(self, technology: str = "printed_board", automated_pths: int = 100,
                 hand_soldered_pths: int = 0, circuit_planes: int = 2,
                 quality: str = "lower", environment: str = "GB",
                 method: str = "auto", laminate: str = "epoxy_glass_fr4_g10",
                 temperature_range_c: float = 100.0,
                 board_thickness_inches: float = .062,
                 drilled_hole_diameter_inches: float = .020,
                 plating_thickness_inches: float = .001,
                 hours_per_thermal_cycle: float = 24.0,
                 laminate_elastic_modulus_psi: float | None = None,
                 laminate_cte_per_c: float | None = None,
                 copper_cte_per_c: float = 1.8e-5,
                 copper_yield_strength_psi: float = 2.5e4,
                 copper_elastic_modulus_psi: float = 1.2e7,
                 copper_plastic_modulus_psi: float = .1e6,
                 copper_ductility: float = .30,
                 copper_ultimate_strength_psi: float = 4e4,
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(technology, ("printed_board", "discrete_wiring"), "technology"); _choice(quality, ("IPC_level_3", "lower"), "quality")
        _choice(method, ("auto", "handbook", "vita_pof"), "method")
        selected_method = "vita_pof" if method == "auto" and standard == "VITA-51.1" else "handbook" if method == "auto" else method
        if selected_method == "vita_pof" and standard != "VITA-51.1":
            raise ValueError("the Appendix F PTH physics-of-failure method requires A/V51.1")
        if selected_method == "vita_pof":
            result = vita_pth_fatigue(
                temperature_range_c=temperature_range_c,
                board_thickness_inches=board_thickness_inches,
                drilled_hole_diameter_inches=drilled_hole_diameter_inches,
                plating_thickness_inches=plating_thickness_inches,
                hours_per_thermal_cycle=hours_per_thermal_cycle,
                laminate=laminate,
                laminate_elastic_modulus_psi=laminate_elastic_modulus_psi,
                laminate_cte_per_c=laminate_cte_per_c,
                copper_cte_per_c=copper_cte_per_c,
                copper_yield_strength_psi=copper_yield_strength_psi,
                copper_elastic_modulus_psi=copper_elastic_modulus_psi,
                copper_plastic_modulus_psi=copper_plastic_modulus_psi,
                copper_ductility=copper_ductility,
                copper_ultimate_strength_psi=copper_ultimate_strength_psi,
            )
            rate = float(result["FPMH"])
            factors = dict(result)
            steps = [
                _step("A1", "IA area influencing barrel deformation", "π/4[(h+d)^2-d^2]", f"h={board_thickness_inches:g}, d={drilled_hole_diameter_inches:g}", float(result["A1"]), "in²"),
                _step("A2", "PTH barrel area", "π/4[d^2-(d-2t)^2]", f"d={drilled_hole_diameter_inches:g}, t={plating_thickness_inches:g}", float(result["A2"]), "in²"),
                _step("σ", "copper-barrel cyclic stress", "bilinear series-compliance form of Appendix F Eq. 1.2", str(result["constitutive_branch"]), float(result["sigma"]), "psi"),
                _step("Δε", "total cyclic strain range", "σ/E2 (elastic) or Sy/E2+(σ-Sy)/E2'", str(result["constitutive_branch"]), float(result["delta_epsilon"])),
                _step("Nf", "expected cycles to failure", "solve Eq. 1.6 iteratively", f"Δε={float(result['delta_epsilon']):g}", float(result["N_f"]), "cycles"),
                _step("λp", "PTH fatigue failure rate", "10^6/(Hc Nf)", f"10^6/({hours_per_thermal_cycle:g}·{float(result['N_f']):g})", rate, FPMH),
            ]
            self._finish(
                rate, section="A/V51.1 Appendix F", pages="A/V pages 28–30",
                equation="FPMH = 10^6/(Hc Nf), with Nf from the Appendix F strain-life equation",
                model="PTH strain-driven thermal-fatigue physics-of-failure",
                factors=factors, steps=steps,
                assumptions=(
                    "A single representative thermal cycle repeats at the entered hours-per-cycle interval.",
                    "The smallest PTH in the hottest board region should be used; the entered geometry is treated as that controlling PTH.",
                    "Printed laminate-property ranges use their midpoint unless a measured E1 or z-axis CTE is supplied.",
                ),
                warnings=(
                    "A/V51.1 Appendix F Equation 1.2 is dimensionally inconsistent as printed. Perdura restores the IPC-TR-579 series-compliance stress form and applies an explicit elastic/elastic-plastic branch before Equation 1.5.",
                ),
            )
            annotate_vita_result(self, self.category)
            return
        N1 = int(_nonnegative(automated_pths, "automated_pths")); N2 = int(_nonnegative(hand_soldered_pths, "hand_soldered_pths"))
        if N1 + N2 <= 0: raise ValueError("at least one functional PTH is required")
        planes = int(_positive(circuit_planes, "circuit_planes"))
        if not 2 <= planes <= 18: raise ValueError("circuit_planes must be 2–18")
        if technology == "discrete_wiring" and planes != 2:
            raise ValueError("Section 16.1 discrete wiring with electroless PTHs is limited to two circuit levels")
        lambda_b = .000017 if technology == "printed_board" else .00011
        pi_c = .65 * planes ** .63
        pi_q = 1.0 if quality == "IPC_level_3" or standard == "VITA-51.1" else 2.0
        pi_e = float(_PI_E_PTH[environment])
        rate = lambda_b * (N1 * pi_c + N2 * (pi_c + 13.0)) * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "N1": N1, "N2": N2, "pi_C": pi_c, "pi_Q": pi_q, "pi_E": pi_e}
        steps = [_step("πC", "circuit-plane complexity", ".65P^.63", f"P={planes}", pi_c), _step("λp", "PTH assembly rate", "λb[N1πC+N2(πC+13)]πQπE", "substituted from listed factors", rate, FPMH)]
        self._finish(rate, section="16.1", pages="16-1", equation="λp = λb [N1 πC + N2 (πC + 13)] πQ πE", model=f"{technology} PTH assembly", factors=factors, steps=steps)
        if standard == "VITA-51.1":
            annotate_vita_result(
                self, self.category,
                assumptions=(
                    "PTH counts may be limited to active pins only when excluded pins have no circuit-trace connection, per A/V51.1 Permission 2.1.10-1.",
                ),
            )


_SMT_CYCLING_RATE = {"automotive": 1.0, "consumer": .08, "computer": .17, "telecommunications": .0042, "commercial_aircraft": .25, "industrial": .021, "military_ground": .03, "military_aircraft_cargo": .12, "military_aircraft_fighter": .5}
_SMT_PI_LC = {
    "leadless": 1.0, "j_or_s_lead": 150.0, "gull_wing": 5000.0,
    "plastic_bga": 100.0, "ceramic_bga": 50.0,
}
_SMT_ALPHA_CC = {"plastic": 7.0, "ceramic": 6.0}
_SMT_DELTA_T = _env([7, 21, 26, 26, 61, 31, 31, 57, 57, 31, 7, None, None, None])
_SMT_ALPHA_S = {
    "fr4_laminate": 18, "fr4_multilayer": 20, "fr4_multilayer_copper_clad_invar": 11,
    "ceramic_multilayer": 7, "copper_clad_invar": 5, "copper_clad_molybdenum": 5,
    "carbon_fiber_epoxy": 1, "kevlar_fiber": 3, "quartz_fiber": 1, "glass_fiber": 5,
    "epoxy_glass": 15, "polyimide_glass": 13, "polyimide_kevlar": 6,
    "polyimide_quartz": 8, "epoxy_kevlar": 7, "alumina_ceramic": 7,
    "epoxy_aramid": 7, "polyimide_aramid": 6, "epoxy_quartz": 9,
    "fiberglass_teflon": 20, "porcelainized_copper_clad_invar": 7,
    "fiberglass_ceramic": 7,
}


class SurfaceMountAssembly(_Part):
    """Section 16.2 weakest-link thermal-fatigue SMT assembly model."""
    category = "surface_mount_assembly"

    def __init__(self, distance_to_neutral_point_mils: float = 740.0,
                 solder_joint_height_mils: float = 5.0, substrate: str = "epoxy_glass",
                 package: str = "plastic", lead_configuration: str = "leadless",
                 environment: str = "GF", equipment_type: str = "military_ground",
                 cycling_rate_source: str = "table", cycling_rate_per_hour: float = .03,
                 temperature_difference_source: str = "table", temperature_difference: float = 21.0,
                 thermal_resistance_c_per_watt: float = 20.0, power_dissipation_watts: float = .5,
                 design_life_hours: float = 20 * 8760,
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(substrate, _SMT_ALPHA_S, "substrate"); _choice(package, _SMT_ALPHA_CC, "package"); _choice(lead_configuration, _SMT_PI_LC, "lead_configuration"); _choice(equipment_type, _SMT_CYCLING_RATE, "equipment_type")
        if lead_configuration in ("plastic_bga", "ceramic_bga"):
            if standard != "VITA-51.1":
                raise ValueError("plastic/ceramic BGA lead factors are supplied by A/V51.1; enable the supplement")
            expected_package = "plastic" if lead_configuration == "plastic_bga" else "ceramic"
            if package != expected_package:
                raise ValueError(f"{lead_configuration} requires package={expected_package!r}")
        _choice(cycling_rate_source, ("table", "custom"), "cycling_rate_source")
        _choice(temperature_difference_source, ("table", "custom"), "temperature_difference_source")
        d = _positive(distance_to_neutral_point_mils, "distance_to_neutral_point_mils"); h = _positive(solder_joint_height_mils, "solder_joint_height_mils")
        alpha_s = float(_SMT_ALPHA_S[substrate]); alpha_cc = float(_SMT_ALPHA_CC[package]); pi_lc = float(_SMT_PI_LC[lead_configuration])
        delta_t_raw = _SMT_DELTA_T[environment] if temperature_difference_source == "table" else temperature_difference
        if delta_t_raw is None: raise ValueError(f"Section 16.2 has no default ΔT for {environment}; provide temperature_difference")
        delta_t = _positive(delta_t_raw, "temperature_difference")
        cr = _positive(_SMT_CYCLING_RATE[equipment_type] if cycling_rate_source == "table" else cycling_rate_per_hour, "cycling_rate_per_hour")
        t_rise = _nonnegative(thermal_resistance_c_per_watt, "thermal_resistance_c_per_watt") * _nonnegative(power_dissipation_watts, "power_dissipation_watts")
        mismatch = abs(alpha_s * delta_t - alpha_cc * (delta_t + t_rise))
        strain = d / (.65 * h) * mismatch * 1e-6
        if strain <= 0: raise ValueError("thermal-expansion mismatch is zero; Section 16.2 power-law model is undefined")
        N_f = 3.5 * strain ** -2.26 * pi_lc
        alpha_smt = N_f / cr
        life = _positive(design_life_hours, "design_life_hours")
        ecf = _effective_cumulative_failure(life / alpha_smt)
        rate_per_hour = ecf / alpha_smt; rate = rate_per_hour * 1e6
        factors = {"alpha_S": alpha_s, "alpha_CC": alpha_cc, "delta_T": delta_t, "T_RISE": t_rise, "pi_LC": pi_lc, "CR": cr, "strain": strain, "N_f": N_f, "alpha_SMT": alpha_smt, "ECF": ecf, "lambda_SMT_per_hour": rate_per_hour}
        steps = [_step("Nf", "thermal cycles to failure", "3.5[(d/.65h)|αSΔT-αCC(ΔT+TRISE)|10^-6]^-2.26πLC", "substituted from listed factors", N_f, "cycles"), _step("αSMT", "SMT characteristic life", "Nf/CR", f"{N_f:g}/{cr:g}", alpha_smt, "hours"), _step("ECF", "effective cumulative failures", "table lookup from LC/αSMT", f"{life:g}/{alpha_smt:g}", ecf, "failures"), _step("λSMT", "SMT assembly failure rate", "ECF/αSMT × 10^6", f"{ecf:g}/{alpha_smt:g}×10^6", rate, FPMH)]
        self._finish(rate, section="16.2", pages="16-2–16-4", equation="Nf = 3.5[(d/.65h)|αSΔT-αCC(ΔT+TRISE)|10^-6]^-2.26πLC; λSMT = ECF/αSMT", model="surface-mount assembly thermal fatigue", factors=factors, steps=steps, assumptions=("Analyze every SMT component and use the device with the largest absolute strain range as the board's weakest link.", "The result is the board-level SMT assembly contribution and is added once to component and PTH contributions.", "Solder and lead manufacturing defects are outside this wearout model."))
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


# ---------------------------------------------------------------------------
# Sections 17–23
# ---------------------------------------------------------------------------

_PI_E_CONNECTION = _env([1, 2, 7, 4, 11, 4, 6, 6, 8, 16, .5, 9, 24, 420])
_CONNECTION_BASE = {
    "hand_solder_no_wrap": .0013, "hand_solder_wrapped": .000070,
    "crimp": .00026, "weld": .000015, "solderless_wrap": .0000068,
    "clip_termination": .00012, "reflow_solder": .000069,
    "spring_contact": .17, "terminal_block": .062,
}


class Connection(_Part):
    """Section 17.1 single-connection model."""
    category = "connection"

    def __init__(self, connection_type: str = "reflow_solder", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard); _choice(connection_type, _CONNECTION_BASE, "connection_type")
        lambda_b = _CONNECTION_BASE[connection_type]; pi_e = float(_PI_E_CONNECTION[environment]); rate = lambda_b * pi_e
        factors = {"lambda_b": lambda_b, "pi_E": pi_e}
        self._finish(rate, section="17.1", pages="17-1", equation="λp = λb πE", model=f"single {connection_type} connection", factors=factors, steps=[_step("λp", "connection failure rate", "λbπE", f"{lambda_b:g}·{pi_e:g}", rate, FPMH)])


_PI_E_METER = _env([1, 4, 25, 12, 35, 28, 42, 58, 73, 60, 1.1, 60, None, None])


class Meter(_Part):
    """Section 18.1 ruggedized electrical-indicating panel meter model."""
    category = "meter"

    def __init__(self, application: str = "dc", function: str = "ammeter",
                 quality: str = "lower", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(application, ("dc", "ac"), "application"); _choice(function, ("ammeter", "voltmeter", "other"), "function"); _choice(quality, ("MIL-M-10304", "lower"), "quality")
        lambda_b = .090; pi_a = 1.0 if application == "dc" else 1.7; pi_f = 1.0 if function in ("ammeter", "voltmeter") else 2.8
        pi_q = 1.0 if quality == "MIL-M-10304" or standard == "VITA-51.1" else 3.4
        pi_e_raw = _PI_E_METER[environment]
        if pi_e_raw is None: raise ValueError(f"Section 18.1 does not provide a {environment} environment factor")
        pi_e = float(pi_e_raw); rate = lambda_b * pi_a * pi_f * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_A": pi_a, "pi_F": pi_f, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="18.1", pages="18-1", equation="λp = λb πA πF πQ πE", model="panel meter", factors=factors, steps=[_step("λp", "panel-meter failure rate", "λbπAπFπQπE", "product of listed factors", rate, FPMH)])
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


_PI_E_CRYSTAL = _env([1, 3, 10, 6, 16, 12, 17, 22, 28, 23, .5, 13, 32, 500])


class QuartzCrystal(_Part):
    """Section 19.1 quartz crystal unit model."""
    category = "crystal"

    def __init__(self, frequency_mhz: float = 10.0, quality: str = "lower",
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard); _choice(quality, ("MIL-SPEC", "lower"), "quality")
        f = _positive(frequency_mhz, "frequency_mhz"); lambda_b = .013 * f ** .23
        pi_q = 1.0 if quality == "MIL-SPEC" or standard == "VITA-51.1" else 2.1
        pi_e = float(_PI_E_CRYSTAL[environment]); rate = lambda_b * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="19.1", pages="19-1", equation="λp = .013 f^.23 πQ πE", model="quartz crystal", factors=factors, steps=[_step("λb", "frequency base rate", ".013f^.23", f"f={f:g} MHz", lambda_b, FPMH), _step("λp", "crystal failure rate", "λbπQπE", "product of listed factors", rate, FPMH)])
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


class Oscillator(_Part):
    """A/V51.1 §2.1.13 oscillator mapping to Section 19 quartz crystal."""
    category = "oscillator"

    def __init__(self, frequency_mhz: float = 10.0, environment: str = "GB",
                 standard: str = "VITA-51.1", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        if standard != "VITA-51.1":
            raise ValueError("the oscillator-to-quartz-crystal mapping is supplied by A/V51.1")
        frequency = _positive(frequency_mhz, "frequency_mhz")
        lambda_b = .013 * frequency ** .23
        pi_q = 1.0
        pi_e = float(_PI_E_CRYSTAL[environment])
        rate = lambda_b * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(
            rate, section="19.1 + A/V51.1 2.1.13", pages="19-1; A/V pages 14–15",
            equation="λp = .013 f^.23 πQ πE", model="oscillator mapped to quartz crystal",
            factors=factors,
            steps=[
                _step("λb", "quartz-crystal frequency rate", ".013f^.23", f"f={frequency:g} MHz", lambda_b, FPMH),
                _step("λp", "oscillator mapped rate", "λbπQπE", f"{lambda_b:g}·1·{pi_e:g}", rate, FPMH),
            ],
            assumptions=("A/V51.1 Rule 2.1.13-1 maps an oscillator to the MIL miscellaneous/quartz-crystal model.",),
        )
        annotate_vita_result(self, self.category)


class MEMSOscillator(_Part):
    """A/V51.1 Appendix G analog-MOS proxy for a silicon MEMS oscillator."""
    category = "mems_oscillator"

    def __init__(self, T_ambient: float = 20.0, temperature_rise_c: float = 30.0,
                 pins: int = 14, package: str = "hermetic_dip",
                 environment: str = "GB", standard: str = "VITA-51.1",
                 name: str | None = None, quantity: int = 1,
                 multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        if standard != "VITA-51.1":
            raise ValueError("MEMS oscillators require the A/V51.1 Appendix G proxy model")
        _choice(package, _C2_PACKAGE, "package")
        ambient = _temperature(T_ambient, "T_ambient")
        rise = _nonnegative(temperature_rise_c, "temperature_rise_c")
        junction = ambient + rise
        pin_count = int(_positive(pins, "pins"))
        C1 = .01
        coefficient, exponent = _C2_PACKAGE[package]
        C2 = coefficient * pin_count ** exponent
        pi_t = arrhenius_pi_T(junction, .65, scale=.1)
        pi_e = float(_PI_E_MICROCIRCUIT[environment])
        pi_q = 1.0
        pi_l = 1.0
        rate = (C1 * pi_t + C2 * pi_e) * pi_q * pi_l
        factors = {
            "C1": C1, "pi_T": pi_t, "C2": C2, "pi_E": pi_e,
            "pi_Q": pi_q, "pi_L": pi_l, "T_junction": junction,
        }
        steps = [
            _step("Tj", "MEMS proxy junction temperature", "TA+ΔT", f"{ambient:g}+{rise:g}", junction, "°C"),
            _step("πT", "linear-MOS temperature factor", ".1exp[-.65/k(1/(Tj+273)-1/298)]", f"Tj={junction:g}°C", pi_t),
            _step("C2", "package contribution", "aNp^b", f"{coefficient:g}·{pin_count}^{exponent:g}", C2, FPMH),
            _step("λp", "MEMS oscillator proxy rate", "(C1πT+C2πE)πQπL", f"({C1:g}·{pi_t:g}+{C2:g}·{pi_e:g})·1·1", rate, FPMH),
        ]
        self._finish(
            rate, section="5.1 + A/V51.1 Appendix G", pages="5-2–5-3; A/V page 31",
            equation="λp = (C1 πT + C2 πE) πQ πL",
            model="MEMS oscillator as 1–100-transistor analog MOS microcircuit",
            factors=factors, steps=steps,
            assumptions=(
                "The MEMS oscillator is treated as a silicon analog MOS microcircuit; this is an A/V51.1 example proxy, not a MEMS wearout model.",
                "A/V51.1 Appendix G's 30°C temperature rise is configurable and defaults to 30°C; its printed 0.0095 FPMH row is reproduced by the default 20°C ambient / 50°C junction condition.",
            ),
            warnings=(
                "Appendix G prints GB πE=0.05, but its stated 0.0095 FPMH row and Appendix H recomputation require the MIL-HDBK-217F value πE=0.5; Perdura uses 0.5.",
            ),
        )
        annotate_vita_result(self, self.category)


_PI_E_LAMP = _env([1, 2, 3, 3, 4, 4, 4, 5, 6, 5, .7, 4, 6, 27])


class Lamp(_Part):
    """Section 20.1 incandescent lamp model."""
    category = "lamp"

    def __init__(self, rated_voltage: float = 28.0, utilization_ratio: float = 1.0,
                 application: str = "ac", environment: str = "GB",
                 standard: str = "MIL-HDBK-217F", name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard); _choice(application, ("ac", "dc"), "application")
        voltage = _positive(rated_voltage, "rated_voltage"); utilization = _ratio(utilization_ratio, "utilization_ratio")
        lambda_b = .074 * voltage ** 1.29; pi_u = .1 if utilization < .1 else .72 if utilization <= .9 else 1.0; pi_a = 1.0 if application == "ac" else 3.3; pi_e = float(_PI_E_LAMP[environment]); rate = lambda_b * pi_u * pi_a * pi_e
        factors = {"lambda_b": lambda_b, "pi_U": pi_u, "pi_A": pi_a, "pi_E": pi_e}
        self._finish(rate, section="20.1", pages="20-1", equation="λp = λb πU πA πE; λb = .074 Vr^1.29", model="incandescent lamp", factors=factors, steps=[_step("λb", "rated-voltage base rate", ".074Vr^1.29", f"Vr={voltage:g} V", lambda_b, FPMH), _step("λp", "lamp failure rate", "λbπUπAπE", "product of listed factors", rate, FPMH)])


_PI_E_FILTER = _env([1, 2, 6, 4, 9, 7, 9, 11, 13, 11, .8, 7, 15, 120])


class ElectronicFilter(_Part):
    """Section 21.1 non-tunable electronic-filter default model."""
    category = "filter"

    def __init__(self, filter_type: str = "ceramic_ferrite_mil_f_15733", quality: str = "lower",
                 environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        base = {
            "ceramic_ferrite_mil_f_15733": .022,
            "discrete_lc_mil_f_15733": .12,
            "discrete_lc_mil_f_18327_composition_1": .12,
            "discrete_lc_crystal_mil_f_18327_composition_2": .27,
        }
        _choice(filter_type, base, "filter_type"); _choice(quality, ("MIL-SPEC", "lower"), "quality")
        lambda_b = base[filter_type]
        pi_q = 1.0 if quality == "MIL-SPEC" or standard == "VITA-51.1" else 2.9
        pi_e = float(_PI_E_FILTER[environment]); rate = lambda_b * pi_q * pi_e
        factors = {"lambda_b": lambda_b, "pi_Q": pi_q, "pi_E": pi_e}
        self._finish(rate, section="21.1", pages="21-1", equation="λp = λb πQ πE", model=f"{filter_type} filter default", factors=factors, steps=[_step("λp", "filter failure rate", "λbπQπE", "product of listed factors", rate, FPMH)], assumptions=("The handbook prefers summing individual filter piece-part rates when details are available.",))
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


_PI_E_FUSE = _env([1, 2, 8, 5, 11, 9, 12, 15, 18, 16, .9, 10, 21, 230])


class Fuse(_Part):
    """Section 22.1 fuse model."""
    category = "fuse"

    def __init__(self, environment: str = "GB", standard: str = "MIL-HDBK-217F",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        pi_e = float(_PI_E_FUSE[environment]); rate = .010 * pi_e; factors = {"lambda_b": .010, "pi_E": pi_e}
        self._finish(rate, section="22.1", pages="22-1", equation="λp = .010 πE", model="fuse", factors=factors, steps=[_step("λp", "fuse failure rate", ".010πE", f".010·{pi_e:g}", rate, FPMH)])


_PI_E_FERRITE = _env([1, 2, 8, 5, 12, 5, 8, 7, 11, 17, .5, 9, 24, 450])
_PI_E_DUMMY_LOAD = _env([1, 2, 10, 5, 17, 6, 8, 14, 22, 25, .5, 14, 36, 660])


class MiscellaneousPart(_Part):
    """Section 23.1 handbook miscellaneous-part rates."""
    category = "miscellaneous"

    def __init__(self, part_type: str = "neon_lamp", environment: str = "GB",
                 fiber_length_km: float = 1.0, standard: str = "MIL-HDBK-217F",
                 attenuator_power_stress: float = .5,
                 attenuator_rated_power_watts: float = 1.0,
                 attenuator_case_temperature_c: float = 40.0,
                 attenuator_quality: str = "commercial",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        fixed = {"vibrator_60hz": 15.0, "vibrator_120hz": 20.0, "vibrator_400hz": 40.0, "neon_lamp": .20, "single_fiber_connector": .10, "microwave_fixed_element": 0.0, "microwave_variable_element": .10}
        ferrite = {"ferrite_le_100w": .10, "ferrite_gt_100w": .20, "phase_shifter_latching": .10}
        dummy = {"dummy_load_lt_100w": .010, "dummy_load_100_1000w": .030, "dummy_load_gt_1000w": .10, "termination": .030}
        if part_type == "microwave_attenuator":
            attenuator = Resistor(
                style="RD",
                power_stress=attenuator_power_stress,
                rated_power=attenuator_rated_power_watts,
                case_temperature_c=attenuator_case_temperature_c,
                quality=attenuator_quality,
                environment=environment,
                standard=standard,
            )
            self._finish(
                attenuator._base_failure_rate,
                section="23.1 → 9.1",
                pages="23-1; 9-1–9-3",
                equation=attenuator.traceability["equation"],
                model="fixed/variable microwave attenuator (resistor style RD)",
                factors=attenuator.pi_factors,
                steps=attenuator.calculation_steps,
                assumptions=("Section 23.1 explicitly directs fixed and variable microwave attenuators to the Section 9.1 RD resistor model.",),
            )
            return
        if part_type == "single_fiber_cable":
            length = _positive(fiber_length_km, "fiber_length_km"); lambda_b = .1 * length; pi_e = 1.0
        elif part_type in fixed:
            lambda_b = fixed[part_type]; pi_e = 1.0
        elif part_type in ferrite:
            lambda_b = ferrite[part_type]; pi_e = float(_PI_E_FERRITE[environment])
        elif part_type in dummy:
            lambda_b = dummy[part_type]; pi_e = float(_PI_E_DUMMY_LOAD[environment])
        else:
            raise ValueError(f"part_type must be one of {list(fixed) + list(ferrite) + list(dummy) + ['single_fiber_cable', 'microwave_attenuator']}")
        rate = lambda_b * pi_e; factors = {"lambda_b": lambda_b, "pi_E": pi_e}
        warnings = ("Excessive mating/demating cycles can seriously degrade reliability.",) if part_type == "single_fiber_connector" else ()
        self._finish(rate, section="23.1", pages="23-1–23-2", equation="λp = tabulated rate, optionally × πE", model=part_type, factors=factors, steps=[_step("λp", "miscellaneous-part failure rate", "tabulated λb × applicable πE", f"{lambda_b:g}·{pi_e:g}", rate, FPMH)], warnings=warnings)


# ---------------------------------------------------------------------------
# Appendix B: detailed VHSIC/VHSIC-like/VLSI CMOS model
# ---------------------------------------------------------------------------


def _lognormal_rate(time: float, median: float, sigma: float) -> float:
    """Return the handbook's printed lognormal density/rate expression.

    Appendix B inserts this expression directly into its failure-rate sum. It
    is not the ordinary lognormal hazard ``f(t) / S(t)``.
    """
    time = _positive(time, "lognormal time"); median = _positive(median, "lognormal median"); sigma = _positive(sigma, "lognormal sigma")
    return .399 / (time * sigma) * _safe_exp(
        -.5 / sigma ** 2 * (math.log(time) - math.log(median)) ** 2,
        "Appendix B lognormal density",
    )


_APPENDIX_B_QML_FACTORS = {
    "oxide": {False: .5, True: 2.0},
    # Appendix B-3 prints .2 for the QML metallization branch.  Perdura adopts
    # 2.0 as a disclosed engineering correction, consistent with the adjacent
    # oxide/hot-carrier branches and the intended median-life direction of QML.
    "metallization": {False: .5, True: 2.0},
    "hot_carrier": {False: .5, True: 2.0},
}
_APPENDIX_B_PRINTED_METALLIZATION_QML = {False: .5, True: .2}


class DetailedCMOSMicrocircuit(_Part):
    """Appendix B time-dependent detailed CMOS failure-mechanism model."""
    category = "detailed_cmos"

    def __init__(
        self,
        evaluation_time_hours: float = 10000.0,
        device_type: str = "logic_custom",
        chip_area_cm2: float = .21,
        feature_size_microns: float = 2.0,
        T_junction: float = 75.0,
        screening_temperature: float = 125.0,
        screening_time_hours: float = 160.0,
        qml: bool = False,
        oxide_defect_density: float | None = None,
        oxide_field_mv_cm: float = 2.5,
        sigma_oxide: float = 1.0,
        metal_defect_density: float | None = None,
        metal_type: str = "aluminum",
        metal_current_density_million_a_cm2: float = 1.0,
        sigma_metal: float = 1.0,
        drain_current_ma: float | None = None,
        substrate_current_ma: float | None = None,
        sigma_hot_carrier: float = 1.0,
        pins: int = 64,
        package_type: str = "dip",
        package_material: str = "hermetic",
        T_ambient: float = 25.0,
        relative_humidity: float = 50.0,
        humidity_duty_cycle: float = 1.0,
        esd_threshold_volts: float = 1000.0,
        quality: str = "commercial",
        environment: str = "GB",
        pi_Q: float | None = None,
        standard: str = "MIL-HDBK-217F",
        name: str | None = None,
        quantity: int = 1,
        multiplier: float = 1.0,
    ):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(device_type, ("logic_custom", "memory_gate_array"), "device_type")
        _choice(metal_type, ("aluminum", "al_cu_al_si_cu"), "metal_type")
        _choice(package_type, ("dip", "pin_grid_array", "chip_carrier"), "package_type")
        package_material_requested = package_material
        if standard == "VITA-51.1" and quality == "commercial":
            package_material = "plastic"
        _choice(package_material, ("hermetic", "plastic"), "package_material")
        t = _positive(evaluation_time_hours, "evaluation_time_hours") / 1e6
        screen_time = _nonnegative(screening_time_hours, "screening_time_hours") / 1e6
        area = _positive(chip_area_cm2, "chip_area_cm2"); feature = _positive(feature_size_microns, "feature_size_microns")
        TjK = _temperature(T_junction, "T_junction") + 273.0
        TsK = _temperature(screening_temperature, "screening_temperature") + 273.0
        TAK = _temperature(T_ambient, "T_ambient") + 273.0
        qml_enabled = _boolean(qml, "qml")
        qml_ox = _APPENDIX_B_QML_FACTORS["oxide"][qml_enabled]
        qml_met = _APPENDIX_B_QML_FACTORS["metallization"][qml_enabled]
        qml_hc = _APPENDIX_B_QML_FACTORS["hot_carrier"][qml_enabled]
        qml_met_printed = _APPENDIX_B_PRINTED_METALLIZATION_QML[qml_enabled]
        pi_e = float(_PI_E_MICROCIRCUIT[environment]); pi_q = _micro_pi_q(quality, standard, pi_Q)

        # Oxide mechanism (Appendix B-1/B-2).
        d_ox = (2.0 / feature) ** 2 if oxide_defect_density is None else _positive(oxide_defect_density, "oxide_defect_density")
        atype_ox = .77 if device_type == "logic_custom" else 1.23
        at_ox = _safe_exp(-.3 / BOLTZMANN_EV * (1 / TjK - 1 / 298.0), "Appendix B oxide temperature acceleration")
        at_ox_screen = _safe_exp(-.3 / BOLTZMANN_EV * (1 / TsK - 1 / 298.0), "Appendix B oxide screening acceleration")
        t0_ox = screen_time * at_ox_screen
        e_ox = _positive(oxide_field_mv_cm, "oxide_field_mv_cm")
        av_ox = _safe_exp(-.192 * (1 / e_ox - 1 / 2.5), "Appendix B oxide voltage acceleration")
        t50_ox = 1.3e22 * qml_ox / (at_ox * av_ox)
        sigma_ox = _positive(sigma_oxide, "sigma_oxide")
        oxide_early = .0788 * _safe_exp(-7.7 * t0_ox, "Appendix B oxide screening term") * at_ox * _safe_exp(-7.7 * at_ox * t, "Appendix B oxide early-life term")
        oxide_wearout = _lognormal_rate(t + t0_ox, t50_ox, sigma_ox)
        lambda_ox = area * atype_ox / .21 * d_ox * (oxide_early + oxide_wearout)

        # Metallization mechanism (Appendix B-3).
        d_met = (2.0 / feature) ** 2 if metal_defect_density is None else _positive(metal_defect_density, "metal_defect_density")
        atype_met = .88 if device_type == "logic_custom" else 1.12
        at_met = _safe_exp(-.55 / BOLTZMANN_EV * (1 / TjK - 1 / 298.0), "Appendix B metallization temperature acceleration")
        at_met_screen = _safe_exp(-.55 / BOLTZMANN_EV * (1 / TsK - 1 / 298.0), "Appendix B metallization screening acceleration")
        t0_met = screen_time * at_met_screen
        metal_multiplier = 1.0 if metal_type == "aluminum" else 37.5
        J = _positive(metal_current_density_million_a_cm2, "metal_current_density_million_a_cm2")
        t50_met = qml_met * .388 * metal_multiplier / (J ** 2 * at_met)
        t50_met_printed = qml_met_printed * .388 * metal_multiplier / (J ** 2 * at_met)
        sigma_met = _positive(sigma_metal, "sigma_metal")
        metal_early = area * atype_met / .21 * d_met * .00102 * _safe_exp(-1.18 * t0_met, "Appendix B metallization screening term") * at_met * _safe_exp(-1.18 * at_met * t, "Appendix B metallization early-life term")
        metal_wearout = _lognormal_rate(t + t0_met, t50_met, sigma_met)
        lambda_met = metal_early + metal_wearout
        lambda_met_printed = metal_early + _lognormal_rate(
            t + t0_met, t50_met_printed, sigma_met,
        )

        # Hot-carrier mechanism (Appendix B-4).
        at_hc = _safe_exp(.039 / BOLTZMANN_EV * (1 / TjK - 1 / 298.0), "Appendix B hot-carrier temperature acceleration")
        at_hc_screen = _safe_exp(.039 / BOLTZMANN_EV * (1 / TsK - 1 / 298.0), "Appendix B hot-carrier screening acceleration")
        t0_hc = screen_time * at_hc_screen
        drain = 3.5 * _safe_exp(-.00157 * TjK, "Appendix B drain-current relation") if drain_current_ma is None else _positive(drain_current_ma, "drain_current_ma")
        substrate = .0058 * _safe_exp(-.00689 * TjK, "Appendix B substrate-current relation") if substrate_current_ma is None else _positive(substrate_current_ma, "substrate_current_ma")
        t50_hc = qml_hc * 3.74e-5 / (at_hc * drain) * (substrate / drain) ** -2.5
        sigma_hc = _positive(sigma_hot_carrier, "sigma_hot_carrier")
        lambda_hc = _lognormal_rate(t + t0_hc, t50_hc, sigma_hc)

        # Contamination mechanism (Appendix B-4).
        at_con = _safe_exp(-1.0 / BOLTZMANN_EV * (1 / TjK - 1 / 298.0), "Appendix B contamination temperature acceleration")
        at_con_screen = _safe_exp(-1.0 / BOLTZMANN_EV * (1 / TsK - 1 / 298.0), "Appendix B contamination screening acceleration")
        t0_con = screen_time * at_con_screen
        lambda_con = .000022 * _safe_exp(-.0028 * t0_con, "Appendix B contamination screening term") * at_con * _safe_exp(-.0028 * at_con * t, "Appendix B contamination operating term")

        # Package and humidity mechanisms (Appendix B-5).
        pin_count = int(_positive(pins, "pins")); pi_pt = {"dip": 1.0, "pin_grid_array": 2.2, "chip_carrier": 4.7}[package_type]
        lambda_ph = 0.0
        rh_eff = 0.0
        t50_ph = 0.0
        if package_material == "plastic":
            # Appendix B-5 defines RH in percentage points (for example,
            # ``RH = 50`` for 50 percent), not as a 0--1 fraction.
            rh = _positive(relative_humidity, "relative_humidity")
            if rh > 100:
                raise ValueError(
                    "relative_humidity must be in percentage points between "
                    "0 (exclusive) and 100 (inclusive)"
                )
            dc = _ratio(humidity_duty_cycle, "humidity_duty_cycle")
            rh_eff = dc * rh * _safe_exp(
                5230 * (1 / TjK - 1 / TAK),
                "Appendix B effective-humidity temperature adjustment",
            ) + (1 - dc) * rh
            t50_ph = 86e-6 * _safe_exp(
                .2 / BOLTZMANN_EV * (1 / TAK - 1 / 298.0),
                "Appendix B plastic-package ambient-temperature adjustment",
            ) * _safe_exp(
                2.96 / rh_eff,
                "Appendix B plastic-package humidity adjustment",
            )
            lambda_ph = _lognormal_rate(t, t50_ph, .74)
        lambda_pac = (.0024 + 1.85e-5 * pin_count) * pi_e * pi_q * pi_pt + lambda_ph

        # EOS/ESD and miscellaneous mechanisms (Appendix B-6).
        vth = _nonnegative(esd_threshold_volts, "esd_threshold_volts")
        lambda_esd = -math.log1p(-.00057 * _safe_exp(-.0002 * vth, "Appendix B EOS/ESD threshold term")) / .00876
        at_mis = _safe_exp(-.423 / BOLTZMANN_EV * (1 / TjK - 1 / 298.0), "Appendix B miscellaneous temperature acceleration")
        at_mis_screen = _safe_exp(-.423 / BOLTZMANN_EV * (1 / TsK - 1 / 298.0), "Appendix B miscellaneous screening acceleration")
        t0_mis = screen_time * at_mis_screen
        lambda_mis = .01 * _safe_exp(-2.2 * t0_mis, "Appendix B miscellaneous screening term") * at_mis * _safe_exp(-2.2 * at_mis * t, "Appendix B miscellaneous operating term")

        rate = lambda_ox + lambda_met + lambda_hc + lambda_con + lambda_pac + lambda_esd + lambda_mis
        printed_literal_rate = (
            rate - lambda_met + lambda_met_printed
            if qml_enabled else rate
        )
        factors = {
            "t_million_hours": t,
            "A": area,
            "QML_OX": qml_ox,
            "QML_MET": qml_met,
            "QML_HC": qml_hc,
            "D_OX": d_ox,
            "A_TYPE_OX": atype_ox,
            "A_T_OX": at_ox,
            "A_T_OX_screen": at_ox_screen,
            "A_V_OX": av_ox,
            "t0_OX": t0_ox,
            "t50_OX": t50_ox,
            "sigma_OX": sigma_ox,
            "lambda_OX": lambda_ox,
            "D_MET": d_met,
            "A_TYPE_MET": atype_met,
            "A_T_MET": at_met,
            "A_T_MET_screen": at_met_screen,
            "metal_multiplier": metal_multiplier,
            "J_MET": J,
            "t0_MET": t0_met,
            "t50_MET": t50_met,
            "QML_MET_printed": qml_met_printed,
            "t50_MET_printed": t50_met_printed,
            "sigma_MET": sigma_met,
            "lambda_MET": lambda_met,
            "lambda_MET_printed": lambda_met_printed,
            "A_T_HC": at_hc,
            "A_T_HC_screen": at_hc_screen,
            "I_D_mA": drain,
            "I_SUB_mA": substrate,
            "t0_HC": t0_hc,
            "t50_HC": t50_hc,
            "sigma_HC": sigma_hc,
            "lambda_HC": lambda_hc,
            "A_T_CON": at_con,
            "A_T_CON_screen": at_con_screen,
            "t0_CON": t0_con,
            "lambda_CON": lambda_con,
            "relative_humidity_percent": relative_humidity,
            "humidity_duty_cycle": humidity_duty_cycle,
            "RH_eff": rh_eff,
            "t50_PH": t50_ph,
            "lambda_PH": lambda_ph,
            "pi_E": pi_e,
            "pi_Q": pi_q,
            "pi_PT": pi_pt,
            "lambda_PAC": lambda_pac,
            "lambda_ESD": lambda_esd,
            "A_T_MIS": at_mis,
            "A_T_MIS_screen": at_mis_screen,
            "t0_MIS": t0_mis,
            "lambda_MIS": lambda_mis,
            "_quality_basis": _micro_quality_basis(quality, standard, pi_Q, pi_q),
        }
        steps = [
            _step("t", "evaluation time", "hours / 10^6", f"{evaluation_time_hours:g}/10^6", t, "10^6 hours"),
            _step("DOX", "oxide defect density", "(2/Xs)^2 unless measured", f"Xs={feature:g} µm", d_ox),
            _step("ATOX", "oxide operating-temperature acceleration", "exp[-.3/k(1/TJ-1/298)]", f"TJ={TjK:g} K", at_ox),
            _step("AVOX", "oxide-field acceleration", "exp[-.192(1/EOX-1/2.5)]", f"EOX={e_ox:g} MV/cm", av_ox),
            _step("t0OX", "oxide equivalent screen time", "tscreen ATOX(screen)", f"{screen_time:g}·{at_ox_screen:g}", t0_ox, "10^6 hours"),
            _step("QML_OX", "oxide QML factor", "2 if QML; .5 otherwise", f"QML={qml_enabled}", qml_ox),
            _step("t50OX", "oxide median life", "1.3×10^22(QML)/(ATOX AVOX)", f"1.3×10^22·{qml_ox:g}/({at_ox:g}·{av_ox:g})", t50_ox, "10^6 hours"),
            _step("λOX", "oxide mechanism", "(A·ATYPEOX/.21)DOX[.0788e^(-7.7t0)ATOXe^(-7.7ATOXt)+LN(t+t0,t50,σ)]", "Appendix B printed density/rate expression", lambda_ox, FPMH),
            _step("DMET", "metallization defect density", "(2/Xs)^2 unless measured", f"Xs={feature:g} µm", d_met),
            _step("ATMET", "metallization temperature acceleration", "exp[-.55/k(1/TJ-1/298)]", f"TJ={TjK:g} K", at_met),
            _step("t0MET", "metallization equivalent screen time", "tscreen ATMET(screen)", f"{screen_time:g}·{at_met_screen:g}", t0_met, "10^6 hours"),
            _step("QML_MET", "metallization QML factor", "2 adopted if QML; .5 otherwise", f"QML={qml_enabled}", qml_met),
            _step("t50MET", "metallization median life", "QML·.388·MetalType/(J^2 ATMET)", f"{qml_met:g}·.388·{metal_multiplier:g}/({J:g}^2·{at_met:g})", t50_met, "10^6 hours"),
            _step("λMET", "metallization mechanism", "(A·ATYPEMET/.21)DMET·.00102e^(-1.18t0)ATMETe^(-1.18ATMETt)+LN(t+t0,t50,σ)", "Appendix B printed density/rate expression with disclosed QML correction", lambda_met, FPMH),
            _step("ID", "drain current", "3.5e^(-.00157TJ) unless measured", f"TJ={TjK:g} K", drain, "mA"),
            _step("ISUB", "substrate current", ".0058e^(-.00689TJ) unless measured", f"TJ={TjK:g} K", substrate, "mA"),
            _step("QML_HC", "hot-carrier QML factor", "2 if QML; .5 otherwise", f"QML={qml_enabled}", qml_hc),
            _step("t50HC", "hot-carrier median life", "QML·3.74×10^-5/(ATHC ID)·(ISUB/ID)^-2.5", f"QML={qml_hc:g}; substituted from hot-carrier factors", t50_hc, "10^6 hours"),
            _step("λHC", "hot-carrier mechanism", "LN(t+t0HC,t50HC,σHC)", "Appendix B printed density/rate expression", lambda_hc, FPMH),
            _step("λCON", "contamination mechanism", ".000022e^(-.0028t0CON)ATCONe^(-.0028ATCONt)", "substituted from contamination factors", lambda_con, FPMH),
            _step("λPAC", "package contribution", "(.0024+1.85×10^-5 pins)πEπQπPT+λPH", f"pins={pin_count}, material={package_material}", lambda_pac, FPMH),
            _step("λESD", "EOS/ESD contribution", "-ln[1-.00057e^(-.0002VTH)]/.00876", f"VTH={vth:g} V", lambda_esd, FPMH),
            _step("λMIS", "miscellaneous mechanism", ".01e^(-2.2t0)ATMISe^(-2.2ATMIS t)", "operating and screening inputs", lambda_mis, FPMH),
            _step("λp(t)", "detailed CMOS failure rate", "λOX+λMET+λHC+λCON+λPAC+λESD+λMIS", "sum of seven mechanism contributions", rate, FPMH),
        ]
        if package_material == "plastic":
            package_step_index = next(
                index for index, step in enumerate(steps)
                if step["symbol"] == "λPAC"
            )
            steps[package_step_index:package_step_index] = [
                _step("RHeff", "effective relative humidity", "DC·RH·exp[5230(1/TJ-1/TA)]+(1-DC)RH", f"DC={dc:g}, RH={rh:g}%", rh_eff, "%"),
                _step("t50PH", "plastic-package humidity median life", "86×10^-6 exp[(.2/k)(1/TA-1/298)] exp(2.96/RHeff)", f"TA={TAK:g} K, RHeff={rh_eff:g}%", t50_ph, "10^6 hours"),
                _step("λPH", "plastic-package humidity mechanism", "LN(t,t50PH,.74)", "Appendix B printed density/rate expression", lambda_ph, FPMH),
            ]
        assumptions: list[str] = []
        if package_material != package_material_requested:
            assumptions.append(
                "The commercial detailed-CMOS package was modeled as "
                "plastic/nonhermetic under A/V51.1 Rule 2.1.2-3."
            )
        warnings: list[str] = []
        if standard == "VITA-51.1" and feature < .13:
            warnings.append(
                "Feature size is below 130 nm; perform the separate VITA "
                "51.2/equivalent EM, TDDB, HCI, and NBTI wearout assessment "
                "recommended by A/V51.1."
            )
        if qml_enabled:
            warnings.append(
                "Source adjustment: Appendix B-3 prints QML_MET=0.2. "
                "Perdura adopts QML_MET=2.0 as an engineering correction "
                "consistent with the adjacent oxide and hot-carrier QML "
                f"branches. The printed-literal total would be "
                f"{printed_literal_rate:.8g} FPMH for these inputs."
            )
        self._finish(rate, section="Appendix B", pages="B-1–B-6", equation="λp(t) = λOX(t) + λMET(t) + λHC(t) + λCON(t) + λPAC + λESD + λMIS(t)", model="detailed VHSIC/VHSIC-like/VLSI CMOS", factors=factors, steps=steps, assumptions=assumptions, warnings=warnings)
        self.traceability["source_adjustments"] = [{
            "locator": "MIL-HDBK-217F Notice 2, Appendix B-3, metallization equation",
            "printed_value": qml_met_printed,
            "adopted_value": qml_met,
            "active": qml_enabled,
            "printed_literal_metallization_fpmh": lambda_met_printed,
            "adopted_metallization_fpmh": lambda_met,
            "printed_literal_total_fpmh": printed_literal_rate,
            "adopted_total_fpmh": rate,
            "rationale": (
                "The printed 0.2 is treated as an apparent decimal error; "
                "2.0 matches the adjacent QML mechanism factors and the "
                "intended direction of QML in the median-life relation."
            ),
        }]
        if standard == "VITA-51.1": annotate_vita_result(self, self.category)


# ---------------------------------------------------------------------------
# Appendix A: parts-count method
# ---------------------------------------------------------------------------

_PC_TJ = _env([50, 60, 65, 60, 65, 75, 75, 90, 90, 75, 50, 65, 75, 60])
_PC_TA = _env([30, 40, 45, 40, 45, 55, 55, 70, 70, 55, 30, 45, 55, 40])
_PC_NO_QUALITY = {"not_applicable": 1.0}


@dataclass(frozen=True)
class _PartsCountRecipe:
    label: str
    section: str
    family: str
    quality_factors: Mapping[str, float]
    default_quality: str
    factory: Any
    learning_factor: bool = False


PARTS_COUNT_RECIPES: dict[str, _PartsCountRecipe] = {}


def _pc_register(key: str, label: str, section: str, family: str,
                 quality_factors: Mapping[str, float], default_quality: str,
                 factory: Any, learning_factor: bool = False) -> None:
    if key in PARTS_COUNT_RECIPES:
        raise RuntimeError(f"duplicate parts-count key {key}")
    PARTS_COUNT_RECIPES[key] = _PartsCountRecipe(label, section, family, quality_factors, default_quality, factory, learning_factor)


def _pc_static(rate_by_environment: Mapping[str, float], label: str, section: str, environment: str) -> _Part:
    p = _Part(name=label)
    value = float(rate_by_environment[environment])
    p._finish(value, section=section, pages="Appendix A", equation="λg = Appendix A tabulated generic rate", model=label, factors={"lambda_g": value}, steps=[_step("λg", "generic failure rate", "Appendix A lookup", f"environment={environment}", value, FPMH)])
    return p


def _pc_micro_factory(**params: Any):
    return lambda environment: Microcircuit(T_junction=float(_PC_TJ[environment]), environment=environment, quality="B", pi_Q=1.0, years_in_production=2.0, **params)


def _pc_gaas_factory(**params: Any):
    return lambda environment: GaAsMicrocircuit(T_junction=float(_PC_TJ[environment]), environment=environment, quality="B", pi_Q=1.0, years_in_production=2.0, **params)


# A-2/A-3 microcircuit rows.
for technology in ("bipolar", "mos"):
    for device, bands in {
        "digital": [(100, 16, "hermetic_dip"), (1000, 24, "hermetic_dip"), (3000, 40, "hermetic_dip"), (10000, 128, "hermetic_pga"), (30000, 180, "hermetic_pga"), (60000, 224, "hermetic_pga")],
        "linear": [(100, 14, "hermetic_dip"), (300, 18, "hermetic_dip"), (1000, 24, "hermetic_dip"), (10000, 40, "hermetic_dip")],
    }.items():
        for complexity, pins, package in bands:
            key = f"ic_{technology}_{device}_{complexity}"
            _pc_register(key, f"{technology.title()} {device} IC, up to {complexity:g}", "5.1", "microcircuit", _PI_Q_MICROCIRCUIT, "commercial", _pc_micro_factory(device_type=device, technology=technology, complexity=complexity, pins=pins, package=package), True)

for technology, bands in {
    "bipolar": [(200, 16), (1000, 24), (5000, 40)],
    "mos": [(500, 24), (1000, 28), (5000, 28), (20000, 40)],
}.items():
    for complexity, pins in bands:
        _pc_register(f"ic_{technology}_pla_{complexity}", f"{technology.title()} PLA/PAL, up to {complexity:g} gates", "5.1", "microcircuit", _PI_Q_MICROCIRCUIT, "commercial", _pc_micro_factory(device_type="pla", technology=technology, complexity=complexity, pins=pins, package="hermetic_dip"), True)

for technology in ("bipolar", "mos"):
    for bits, pins, package in ((8, 40, "hermetic_dip"), (16, 64, "hermetic_pga"), (32, 128, "hermetic_pga")):
        _pc_register(f"ic_{technology}_microprocessor_{bits}", f"{technology.title()} microprocessor, up to {bits} bits", "5.1", "microcircuit", _PI_Q_MICROCIRCUIT, "commercial", _pc_micro_factory(device_type="microprocessor", technology=technology, complexity=bits, pins=pins, package=package), True)

_memory_pins = {
    ("mos", "rom"): (24, 28, 28, 40), ("mos", "prom"): (24, 28, 28, 40),
    ("mos", "dram"): (18, 20, 24, 28), ("mos", "sram"): (18, 20, 24, 28),
    ("bipolar", "rom"): (24, 28, 28, 40), ("bipolar", "prom"): (24, 28, 28, 40),
    ("bipolar", "sram"): (24, 28, 28, 40),
}
for (technology, memory_type), pin_values in _memory_pins.items():
    for bits, pins in zip((16384, 65536, 262144, 1048576), pin_values):
        _pc_register(f"ic_{technology}_{memory_type}_{bits}", f"{technology.title()} {memory_type.upper()}, up to {bits:g} bits", "5.2", "microcircuit", _PI_Q_MICROCIRCUIT, "commercial", _pc_micro_factory(device_type="memory", technology=technology, memory_type=memory_type, complexity=bits, pins=pins, package="hermetic_dip"), True)

for device_type, bands in {"mmic": [(100, 8), (1000, 16)], "digital": [(1000, 36), (10000, 64)]}.items():
    for elements, pins in bands:
        _pc_register(f"ic_gaas_{device_type}_{elements}", f"GaAs {device_type.upper()}, up to {elements:g} elements", "5.4", "microcircuit", _PI_Q_MICROCIRCUIT, "commercial", _pc_gaas_factory(device_type=device_type, active_elements=elements, pins=pins, package="hermetic_dip", application="low_noise"), True)


# A-5/A-6 discrete semiconductor rows.
def _pc_discrete(cls: Any, **params: Any):
    return lambda environment: cls(T_junction=float(_PC_TJ[environment]), environment=environment, pi_Q=1.0, **params)


for key, label, diode_type in (
    ("diode_general", "General-purpose analog diode", "general_purpose"),
    ("diode_switching", "Switching diode", "switching"),
    ("diode_fast_recovery", "Fast-recovery power rectifier", "fast_recovery"),
    ("diode_power_rectifier", "Power rectifier/Schottky power diode", "power_rectifier"),
    ("diode_transient_suppressor", "Transient suppressor/varistor", "transient_suppressor"),
    ("diode_voltage_reference", "Voltage reference/regulator", "voltage_reference"),
    ("diode_current_regulator", "Current regulator diode", "current_regulator"),
):
    stress = .7 if diode_type in ("general_purpose", "switching", "fast_recovery", "power_rectifier") else .5
    _pc_register(key, label, "6.1", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(Diode, diode_type=diode_type, voltage_stress=stress, contact="bonded", quality="JANTX"))

for key, label, diode_type, application, power, qmap in (
    ("hf_diode_impatt", "Silicon IMPATT diode", "impatt", "other", 1, _PI_Q_HF),
    ("hf_diode_gunn", "Gunn/bulk-effect diode", "gunn", "other", 1, _PI_Q_HF),
    ("hf_diode_tunnel", "Tunnel/back diode", "tunnel", "other", 1, _PI_Q_HF),
    ("hf_diode_pin", "PIN diode", "pin", "other", 1000, _PI_Q_HF),
    ("hf_diode_schottky", "Schottky barrier/point-contact diode", "schottky", "other", 1, _PI_Q_HF_SCHOTTKY),
    ("hf_diode_varactor", "Varactor diode", "varactor", "multiplier", 1, _PI_Q_HF),
):
    _pc_register(key, label, "6.2", "hf_diode", qmap, list(qmap)[-1], _pc_discrete(HFDiode, diode_type=diode_type, application=application, rated_power=power, quality="JANTX"))

_pc_register("thyristor", "Thyristor/SCR", "6.10", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(Thyristor, rated_current=1, voltage_stress=.7, quality="JANTX"))
_pc_register("bjt_small_signal", "NPN/PNP transistor below 200 MHz", "6.3", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(BipolarTransistor, application="switching", rated_power=.5, voltage_stress=.5, quality="JANTX"))
_pc_register("bjt_power", "Power NPN/PNP transistor below 200 MHz", "6.3", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(BipolarTransistor, application="linear", rated_power=100, voltage_stress=.8, quality="JANTX"))
_pc_register("fet_silicon_lf", "Silicon FET at or below 400 MHz", "6.4", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(FieldEffectTransistor, fet_type="mosfet", application="switching", rated_power=.5, quality="JANTX"))
_pc_register("fet_silicon_hf", "Silicon FET above 400 MHz", "6.9", "rf_transistor", _PI_Q_RF_TRANSISTOR, "lower", _pc_discrete(HighFrequencySiliconFET, fet_type="mosfet", quality="JANTX"))

def _pc_gaas_fet(power: float, operation: str):
    return lambda environment: GaAsFET(frequency_ghz=5, rated_power_watts=power, operation=operation, matching="input_output", channel_temperature_c=float(_PC_TJ[environment]), quality="JANTX", environment=environment, pi_Q=1.0)


_pc_register("gaas_fet_low_power", "GaAs FET below 100 mW", "6.8", "rf_transistor", _PI_Q_RF_TRANSISTOR, "lower", _pc_gaas_fet(.05, "low_power"))
_pc_register("gaas_fet_power", "GaAs FET at or above 100 mW", "6.8", "rf_transistor", _PI_Q_RF_TRANSISTOR, "lower", _pc_gaas_fet(1, "pulsed"))
_pc_register("unijunction", "Unijunction transistor", "6.5", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(UnijunctionTransistor, quality="JANTX"))
_pc_register("rf_bjt_low_noise", "RF low-noise bipolar transistor", "6.6", "rf_transistor", _PI_Q_RF_TRANSISTOR, "lower", _pc_discrete(HFLowNoiseBipolarTransistor, rated_power=.5, voltage_stress=.7, quality="JANTX"))

def _pc_rf_power(environment: str):
    return HFPowerBipolarTransistor(frequency_ghz=1, rated_power_watts=100, voltage_stress=.45, metallization="gold", operation="pulsed", duty_cycle=.2, matching="input_output", T_junction=130, quality="JANTX", environment=environment, pi_Q=1.0)


_pc_register("rf_bjt_power", "RF power bipolar transistor", "6.7", "rf_transistor", _PI_Q_RF_TRANSISTOR, "lower", _pc_rf_power)
_pc_register("opto_photodetector", "Photodetector", "6.11", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(Optoelectronic, device="phototransistor", quality="JANTX"))
_pc_register("opto_isolator", "Opto-isolator", "6.11", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(Optoelectronic, device="optical_isolator", detector="phototransistor", channels="single", quality="JANTX"))
_pc_register("opto_emitter", "LED emitter", "6.11", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(Optoelectronic, device="led", quality="JANTX"))
_pc_register("opto_display", "Seven-character segment display", "6.12", "non_rf_semiconductor", _PI_Q_DISCRETE, "plastic", _pc_discrete(Optoelectronic, device="segment_display", display_characters=7, quality="JANTX"))

def _pc_laser_diode(material: str):
    return lambda environment: LaserDiode(material=material, T_junction=min(max(float(_PC_TJ[environment]), 25.0), 75.0), package="hermetic", forward_peak_current_amps=.5, operation="pulsed", duty_cycle=.6, output_power_ratio=.5, environment=environment)


_pc_register("laser_diode_gaas", "GaAs/AlGaAs laser diode", "6.13", "laser_diode", {"hermetic": 1, "nonhermetic_coated": 1, "nonhermetic_uncoated": 3.3}, "hermetic", _pc_laser_diode("gaas_algaas"))
_pc_register("laser_diode_ingaas", "InGaAs/InGaAsP laser diode", "6.13", "laser_diode", {"hermetic": 1, "nonhermetic_coated": 1, "nonhermetic_uncoated": 3.3}, "hermetic", _pc_laser_diode("ingaas_ingaasp"))


# A-7 resistor rows and A-8 capacitor rows.
for style in _RESISTOR_STYLES:
    rated_power = 8.0 if style in ("RD", "RW", "RWR") else 40.0 if style in ("RE", "RER") else .5
    _pc_register(f"resistor_{style.lower()}", f"{style} resistor", "9.1", "resistor", _PI_Q_RESISTOR, "commercial", lambda environment, s=style, p=rated_power: Resistor(style=s, power_stress=.5, rated_power=p, case_temperature_c=float(_PC_TA[environment]), quality="M", environment=environment, pi_Q=1.0))

_PC_CAPACITANCE = {}
for style in ("CP", "CA", "CZ", "CZR", "CQ", "CQR", "CH", "CHR", "CFR", "CRH"): _PC_CAPACITANCE[style] = 3.0
for style in ("CM", "CMR", "CB"): _PC_CAPACITANCE[style] = .003
# Appendix A-8's low-resolution scan can make this entry look like ``20``.
# The printed generic rates for all seven rows independently reconcile to
# 2.0 uF (and do not reconcile to 20 uF), which is therefore the value used.
for style in ("CYR", "CY", "CK", "CKR", "CC", "CCR", "CDR"): _PC_CAPACITANCE[style] = 2.0
_PC_CAPACITANCE.update({"CSR": 150.0, "CWR": 50.0, "CLR": 1000.0, "CL": 1000.0, "CRL": 1000.0, "CU": 6000.0, "CUR": 6000.0, "CE": 6000.0, "CV": .00006, "PC": .00006, "CT": .00006, "CG": .00006})
for style in (s for s in _CAPACITOR_STYLES if s != "PS"):
    _pc_register(f"capacitor_{style.lower()}", f"{style} capacitor", "10.1", "capacitor", _PI_Q_CAPACITOR, "commercial", lambda environment, s=style: Capacitor(style=s, capacitance_microfarads=_PC_CAPACITANCE[s], voltage_stress=.4, T_ambient=float(_PC_TA[environment]), circuit_resistance_ohm_per_volt=.7, quality="M", environment=environment, pi_Q=1.0))


# A-9/A-10 inductive, electromechanical, interconnect, and miscellaneous rows.
_PC_SWITCHING_TRANSFORMER = _env([
    .00061, .0042, .0090, .0035, .012, .0051, .0067,
    .0070, .0090, .020, .00031, .0097, .029, .43,
])
_pc_register(
    "transformer_switching",
    "Switching transformer (MIL-T-21038)",
    "A-9 / 11.1",
    "inductive",
    {"established_reliability": .25, "MIL-SPEC": 1, "non-MIL": 3},
    "non-MIL",
    # Appendix A-9 prints this as its own generic-rate row.  Its values do
    # not reconcile with any Section 11.1 transformer base-rate category,
    # including low-power pulse, so the parts-count method must use A-9
    # directly while Transformer remains faithful to the part-stress table.
    lambda environment: _pc_static(
        _PC_SWITCHING_TRANSFORMER,
        "switching transformer (Appendix A printed generic rate)",
        "A-9 / 11.1",
        environment,
    ),
)
for key, label, kind in (("transformer_flyback", "Flyback transformer", "flyback"), ("transformer_audio", "Audio transformer", "audio"), ("transformer_low_power", "Low-power pulse transformer", "low_power_pulse"), ("transformer_power", "High-power transformer", "high_power_pulse"), ("transformer_rf", "RF transformer", "rf")):
    _pc_register(key, label, "11.1", "inductive", {"established_reliability": .25, "MIL-SPEC": 1, "non-MIL": 3}, "non-MIL", lambda environment, k=kind: Transformer(transformer_type=k, T_hotspot=float(_PC_TA[environment]), quality="MIL-SPEC", environment=environment))
for adjustment in ("fixed", "variable"):
    _pc_register(f"coil_{adjustment}", f"{adjustment.title()} inductor/coil", "11.2", "inductive", {"established_reliability": .25, "MIL-SPEC": 1, "non-MIL": 3}, "non-MIL", lambda environment, a=adjustment: InductorCoil(adjustment=a, T_hotspot=float(_PC_TA[environment]), quality="M", environment=environment))

for motor_type in _MOTOR_AB:
    _pc_register(f"motor_{motor_type}", f"{motor_type.title()} motor", "12.1", "rotating", _PC_NO_QUALITY, "not_applicable", lambda environment, m=motor_type: Motor(motor_type=m, T_ambient=float(_PC_TA[environment]), life_cycle_hours=87600))
for device_type in ("synchro", "resolver"):
    _pc_register(device_type, device_type.title(), "12.2", "rotating", _PC_NO_QUALITY, "not_applicable", lambda environment, d=device_type: SynchroResolver(device_type=d, frame_temperature=float(_PC_TA[environment]), frame_size=10, brushes=3, environment=environment))
for drive in ("ac", "inverter", "commutator_dc"):
    _pc_register(f"elapsed_time_{drive}", f"{drive} elapsed-time meter", "12.3", "rotating", _PC_NO_QUALITY, "not_applicable", lambda environment, d=drive: ElapsedTimeMeter(drive_type=d, operating_to_rated_temperature=.5, environment=environment))

for key, label, config in (("relay_general", "General-purpose balanced-armature relay", "general_balanced_armature"), ("relay_sensitive", "Sensitive balanced-armature relay", "sensitive_balanced_armature"), ("relay_dry_reed", "Dry-reed relay", "signal_dry_reed"), ("relay_thermal", "Thermal bi-metal relay", "thermal_time_delay_bimetal"), ("relay_magnetic_latching", "Magnetic-latching balanced-armature relay", "latching_balanced_armature"), ("relay_contactor", "High-current solenoid contactor", "contactor_solenoid")):
    _pc_register(key, label, "13.1", "mechanical_relay", {"established_reliability": .6, "MIL-SPEC": 1.5, "non-MIL": 2.9}, "non-MIL", lambda environment, c=config: Relay(rated_temperature=125, T_ambient=float(_PC_TA[environment]), load_type="resistive", load_stress=.5, contact_form="SPST", cycles_per_hour=10, configuration=c, quality="M", environment=environment))
_pc_register("relay_solid_state", "Solid-state relay", "13.2", "solid_state_relay", {"MIL-SPEC": 1, "non-MIL": 1.9}, "non-MIL", lambda environment: SolidStateRelay(quality="MIL-SPEC", environment=environment))

for switch_type in ("dip", "limit", "microwave", "pushbutton", "reed", "rocker", "rotary", "sensitive", "thermal", "thumbwheel", "toggle"):
    _pc_register(f"switch_{switch_type}", f"{switch_type.title()} switch", "14.1", "switch", {"MIL-SPEC": 1, "non-MIL": 2}, "non-MIL", lambda environment, s=switch_type: Switch(switch_type=s, load_type="resistive", load_stress=0, active_contacts=1, quality="MIL-SPEC", environment=environment))
_pc_register("circuit_breaker", "Circuit breaker", "14.2", "circuit_breaker", {"MIL-SPEC": 1, "non-MIL": 8.4}, "non-MIL", lambda environment: CircuitBreaker(poles=2, usage="normal", quality="MIL-SPEC", environment=environment))

for connector_type in ("circular", "card_edge", "hexagonal", "rack_panel", "rectangular", "rf_coaxial", "telephone"):
    _pc_register(f"connector_{connector_type}", f"{connector_type.title()} connector", "15.1", "connector", {"MIL-SPEC": 1, "non-MIL": 2}, "non-MIL", lambda environment, c=connector_type: Connector(connector_type=c, T_ambient=float(_PC_TA[environment]), insert_temperature_rise=0, matings_per_1000_hours=.05, quality="MIL-SPEC", environment=environment))
_pc_register("socket_ic", "IC socket (DIP/SIP/PGA)", "15.2", "socket", {"MIL-SPEC": .3, "non-MIL": 1}, "non-MIL", lambda environment: ConnectorSocket(socket_type="dip_sip_chip_pga", active_pins=40, quality="lower", environment=environment))
_pc_register("pth_board", "Plated-through-hole circuit board", "16.1", "pth", {"MIL-SPEC": 1, "non-MIL": 2}, "non-MIL", lambda environment: PlatedThroughHoleAssembly(technology="printed_board", automated_pths=1000, hand_soldered_pths=0, circuit_planes=3, quality="IPC_level_3", environment=environment))

_PC_SMT_GENERIC = _env([.0025, .37, 1.8, 1.8, 42, 6.1, 6.1, 35, 35, 6.1, .0025, .11, .11, .11])
_pc_register("smt_board", "Surface-mount technology circuit board", "16.2", "smt", _PC_NO_QUALITY, "not_applicable", lambda environment: _pc_static(_PC_SMT_GENERIC, "SMT circuit board", "16.2", environment))

for connection_type in _CONNECTION_BASE:
    _pc_register(f"connection_{connection_type}", f"{connection_type} connection", "17.1", "connection", _PC_NO_QUALITY, "not_applicable", lambda environment, c=connection_type: Connection(connection_type=c, environment=environment))
for application in ("dc", "ac"):
    _pc_register(f"panel_meter_{application}", f"{application.upper()} ammeter/voltmeter", "18.1", "meter", {"MIL-SPEC": 1, "non-MIL": 3.4}, "non-MIL", lambda environment, a=application: Meter(application=a, function="ammeter", quality="MIL-M-10304", environment=environment))
_pc_register("quartz_crystal", "Quartz crystal, 50 MHz", "19.1", "crystal", {"MIL-SPEC": 1, "non-MIL": 2.1}, "non-MIL", lambda environment: QuartzCrystal(frequency_mhz=50, quality="MIL-SPEC", environment=environment))
for application in ("ac", "dc"):
    _pc_register(f"lamp_{application}", f"Incandescent {application.upper()} lamp", "20.1", "lamp", _PC_NO_QUALITY, "not_applicable", lambda environment, a=application: Lamp(rated_voltage=28, utilization_ratio=.5, application=a, environment=environment))
for key, filter_type in (
    ("ceramic_ferrite", "ceramic_ferrite_mil_f_15733"),
    ("discrete_lc", "discrete_lc_mil_f_15733"),
    ("discrete_lc_crystal", "discrete_lc_crystal_mil_f_18327_composition_2"),
):
    _pc_register(f"filter_{key}", f"{key} electronic filter", "21.1", "filter", {"MIL-SPEC": 1, "non-MIL": 2.9}, "non-MIL", lambda environment, f=filter_type: ElectronicFilter(filter_type=f, quality="MIL-SPEC", environment=environment))
_pc_register("fuse", "Fuse", "22.1", "fuse", _PC_NO_QUALITY, "not_applicable", lambda environment: Fuse(environment=environment))


class PartsCountPart(_Part):
    """Appendix A generic-rate lookup and quality/learning adjustment."""
    category = "parts_count"

    def __init__(self, part_type: str, environment: str = "GB",
                 quality: str | float | None = None, years_in_production: float = 2.0,
                 standard: str = "MIL-HDBK-217F",
                 manufacturer_rate_fpmh: float | None = None,
                 manufacturer_reference_environment: str = "GB",
                 name: str | None = None, quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _check_environment(environment); _check_standard(standard)
        _choice(part_type, PARTS_COUNT_RECIPES, "part_type")
        recipe = PARTS_COUNT_RECIPES[part_type]
        generic_part = recipe.factory(environment)
        lambda_g = generic_part.failure_rate
        quality_key = recipe.default_quality if quality is None else quality
        if isinstance(quality_key, (int, float)):
            pi_q = _positive(float(quality_key), "quality factor")
        else:
            _choice(quality_key, recipe.quality_factors, "quality")
            pi_q = float(recipe.quality_factors[quality_key])
            if (
                standard == "VITA-51.1"
                and recipe.family in ("microcircuit", "non_rf_semiconductor", "hf_diode", "rf_transistor")
                and quality_key in ("commercial", "plastic", "lower", "non-MIL")
            ):
                pi_q = 1.0
        pi_l = (
            1.0
            if standard == "VITA-51.1" and recipe.family == "microcircuit"
            else _learning_factor(years_in_production) if recipe.learning_factor else 1.0
        )
        rate = lambda_g * pi_q * pi_l
        factors = {
            "lambda_g": lambda_g,
            "pi_Q": pi_q,
            "pi_L": pi_l,
            **{
                f"generic_{key}": value
                for key, value in generic_part.pi_factors.items()
            },
        }
        if recipe.family == "microcircuit":
            if isinstance(quality_key, str) and quality_key in _PI_Q_MICROCIRCUIT:
                factors["_quality_basis"] = _micro_quality_basis(
                    quality_key, standard, None, pi_q,
                )
            else:
                factors["_quality_basis"] = (
                    f"Analyst-supplied Appendix A microcircuit πQ={pi_q:g}"
                )
        steps = [
            _step("λg", "Appendix A generic failure rate", "part-stress equation evaluated with Appendix A defaults", f"part_type={part_type}, environment={environment}", lambda_g, FPMH),
            _step("πQ", "parts-count quality factor", "Appendix A quality table", str(quality_key), pi_q),
            _step("πL", "microcircuit learning factor", "max/min bounded .01 exp(5.35-.35Y)", f"Y={years_in_production:g}", pi_l),
            _step("NiλgπQπL", "line-item unit rate", "λgπQπL", f"{lambda_g:g}·{pi_q:g}·{pi_l:g}", rate, FPMH),
        ]
        assumptions = ["Generic-rate inputs use the explicit Appendix A default recipe for this row."]
        if manufacturer_rate_fpmh is not None:
            if standard != "VITA-51.1":
                raise ValueError("parts-count manufacturer-rate conversion requires A/V51.1")
            _check_environment(manufacturer_reference_environment)
            reference_generic = recipe.factory(manufacturer_reference_environment).failure_rate
            rate = vita_parts_count_manufacturer_rate(
                manufacturer_rate_fpmh,
                target_generic_rate_fpmh=lambda_g,
                reference_generic_rate_fpmh=reference_generic,
            )
            factors.update({
                "lambda_BMFR": float(manufacturer_rate_fpmh),
                "lambda_g_reference": reference_generic,
                "manufacturer_ratio": lambda_g / reference_generic,
            })
            steps.append(_step(
                "λp,MFR", "Appendix H manufacturer-rate conversion",
                "λBMFR·λg,target/λg,reference",
                f"{float(manufacturer_rate_fpmh):g}·{lambda_g:g}/{reference_generic:g}",
                rate, FPMH,
            ))
            assumptions.append(
                f"Manufacturer rate is referenced to the {manufacturer_reference_environment} Appendix A condition and replaces λgπQπL after ratio conversion."
            )
        self._finish(rate, section="Appendix A", pages="A-1–A-13", equation="λEQUIP = Σ Ni (λg πQ)i; apply πL to microcircuits", model=recipe.label, factors=factors, steps=steps, assumptions=assumptions)
        if standard == "VITA-51.1" and (
            recipe.family in ("microcircuit", "non_rf_semiconductor", "hf_diode", "rf_transistor")
            or manufacturer_rate_fpmh is not None
        ):
            annotate_vita_result(
                self, self.category,
                extra_rules=(
                    ("Rule 2.3.4-1", "Permission 2.3.4-3")
                    if manufacturer_rate_fpmh is not None else ()
                ),
            )


def parts_count_catalog() -> list[dict[str, Any]]:
    """Return every implemented Appendix A catalog row and quality option."""
    return [
        {
            "key": key,
            "label": recipe.label,
            "section": recipe.section,
            "family": recipe.family,
            "quality_options": list(recipe.quality_factors),
            "quality_factors": dict(recipe.quality_factors),
            "default_quality": recipe.default_quality,
            "learning_factor": recipe.learning_factor,
        }
        for key, recipe in PARTS_COUNT_RECIPES.items()
    ]


# ---------------------------------------------------------------------------
# User-supplied rates and system roll-up
# ---------------------------------------------------------------------------


class CustomPart(_Part):
    """User-defined exponential or Weibull-average failure-rate model."""
    category = "custom"

    def __init__(self, model: str = "exponential", failure_rate: float | None = None,
                 eta: float | None = None, beta: float | None = None,
                 eval_time: float | None = None, name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        _choice(model, ("exponential", "weibull"), "model")
        if model == "exponential":
            if failure_rate is None: raise ValueError("failure_rate is required for the exponential model")
            rate = _nonnegative(failure_rate, "failure_rate")
            equation = "λp = user-supplied constant rate"
            factors = {"model": model, "lambda": rate}
        else:
            eta_value = _positive(eta if eta is not None else 0, "eta")
            beta_value = _positive(beta if beta is not None else 0, "beta")
            time = _positive(eval_time if eval_time is not None else 0, "eval_time")
            rate = 1e6 * (time / eta_value) ** beta_value / time
            equation = "λavg = 10^6 (t/η)^β / t"
            factors = {"model": model, "eta": eta_value, "beta": beta_value, "eval_time": time}
        self._finish(rate, section="user model", pages="not applicable", equation=equation, model=f"user {model}", factors=factors, steps=[_step("λp", "user-defined rate", equation, str(factors), rate, FPMH)])


class GenericPart(_Part):
    """A line item with a directly supplied failure rate in FPMH."""
    category = "generic"

    def __init__(self, failure_rate: float, name: str | None = None,
                 quantity: int = 1, multiplier: float = 1.0):
        super().__init__(name, quantity, multiplier)
        rate = _nonnegative(failure_rate, "failure_rate")
        self._finish(rate, section="user data", pages="not applicable", equation="λp = supplied rate", model="generic supplied-rate part", factors={"lambda": rate}, steps=[_step("λp", "supplied rate", "λp = supplied rate", f"λ={rate:g}", rate, FPMH)])


class SystemFailureRate:
    """Series-system sum for part-stress or parts-count line items."""

    def __init__(self, parts: Sequence[_Part]):
        if not parts: raise ValueError("parts list must not be empty")
        if any(not isinstance(part, _Part) for part in parts): raise TypeError("all parts must be MIL-HDBK-217F part objects")
        self.parts = list(parts)
        self.total_failure_rate = float(sum(part.total_failure_rate for part in self.parts))
        self.mtbf = math.inf if self.total_failure_rate == 0 else 1e6 / self.total_failure_rate

    def reliability(self, t_hours: float | Sequence[float]) -> float | np.ndarray:
        t = np.asarray(t_hours, dtype=float)
        if np.any(t < 0): raise ValueError("t_hours must be >= 0")
        result = np.exp(-self.total_failure_rate * t / 1e6)
        return float(result) if result.ndim == 0 else result

    @property
    def results(self) -> list[dict[str, Any]]:
        rows = []
        for part in self.parts:
            contribution = part.total_failure_rate / self.total_failure_rate if self.total_failure_rate else 0.0
            rows.append({
                "name": part.name, "category": part.category,
                "quantity": part.quantity, "multiplier": part.multiplier,
                "failure_rate": part.failure_rate,
                "total_failure_rate": part.total_failure_rate,
                "contribution": contribution,
                "pi_factors": part.pi_factors,
                "traceability": part.traceability,
                "calculation_steps": part.calculation_steps,
                "assumptions": part.assumptions,
                "warnings": part.warnings,
            })
        return rows

    def __repr__(self) -> str:
        return f"SystemFailureRate(total={self.total_failure_rate:.6g} FPMH, MTBF={self.mtbf:.6g} h, parts={len(self.parts)})"


class PartsCountPrediction(SystemFailureRate):
    """Appendix A equipment roll-up: ``Σ Ni(λgπQ)i``."""

    def __init__(self, parts: Sequence[PartsCountPart]):
        if any(not isinstance(part, PartsCountPart) for part in parts):
            raise TypeError("PartsCountPrediction accepts PartsCountPart line items")
        super().__init__(parts)


__all__ = [
    "FPMH", "BOLTZMANN_EV", "HANDBOOK_EDITION", "VITA_EDITION", "ENVIRONMENTS",
    "ENVIRONMENT_DESCRIPTIONS", "STANDARDS", "VITA_51_1_PI_Q",
    "PREDICTION_RESULT_CONTEXT", "MICROCIRCUIT_QUALITY_LABELS",
    "VITA_CATEGORY_RULES", "VITA_PART_CATEGORIES", "VITA_PTH_LAMINATES",
    "DEFAULT_CASE_TEMPERATURE", "SEMICONDUCTOR_THETA_JC", "HYBRID_MATERIALS",
    "THERMAL_PROVENANCE_BASES", "ThermalEstimate",
    "MIL_T27_CASE_RADIATING_AREAS",
    "arrhenius_pi_T", "microcircuit_custom_screening_pi_q",
    "microcircuit_gate_count",
    "junction_temperature", "microcircuit_junction_temperature",
    "semiconductor_junction_temperature", "hybrid_die_area",
    "hybrid_junction_to_case_thermal_resistance",
    "hybrid_junction_temperature", "inductive_hotspot_temperature",
    "capacitor_voltage_stress", "connector_insert_temperature_rise",
    "annotate_vita_result", "vita_manufacturer_microcircuit_rate",
    "vita_parts_count_manufacturer_rate", "vita_pth_fatigue",
    "Microcircuit", "VHSICMicrocircuit", "GaAsMicrocircuit",
    "HybridMicrocircuit", "SurfaceAcousticWaveDevice", "MagneticBubbleMemory",
    "Diode", "HFDiode", "BipolarTransistor", "FieldEffectTransistor",
    "UnijunctionTransistor", "HFLowNoiseBipolarTransistor",
    "HFPowerBipolarTransistor", "GaAsFET", "HighFrequencySiliconFET",
    "Thyristor", "Optoelectronic", "LaserDiode", "ElectronTube",
    "TravelingWaveTube", "Magnetron", "GasLaser", "SealedCO2Laser",
    "FlowingCO2Laser", "SolidStateLaser", "Resistor", "Capacitor",
    "Transformer", "InductorCoil", "FerriteBead", "Motor", "SynchroResolver",
    "ElapsedTimeMeter", "Relay", "SolidStateRelay", "Switch",
    "CircuitBreaker", "Connector", "ConnectorSocket",
    "PlatedThroughHoleAssembly", "SurfaceMountAssembly", "Connection",
    "Meter", "QuartzCrystal", "Oscillator", "MEMSOscillator", "Lamp", "ElectronicFilter", "Fuse",
    "MiscellaneousPart", "DetailedCMOSMicrocircuit", "PartsCountPart",
    "PartsCountPrediction", "PARTS_COUNT_RECIPES", "parts_count_catalog",
    "CustomPart", "GenericPart", "SystemFailureRate",
]
