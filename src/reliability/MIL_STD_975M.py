"""Historical MIL-STD-975M Appendix A parts-derating rules.

This module is a clause- and row-traceable transcription of Appendix A of
MIL-STD-975M (NASA), 5 August 1994.  Notices 1 and 2 did not change Appendix
A; Notice 3 canceled the standard without replacement on 5 May 1998.

The profile is intentionally independent of the three-level Rome Laboratory
Toolkit method and of Perdura's user-defined derating rules.  A successful
assessment establishes parity with this canceled historical NASA rulebook; it
does not establish conformance with current NASA requirements.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal
import inspect
import math
from types import MappingProxyType
from typing import Any, Mapping, Sequence


__all__ = (
    "DOCUMENT_ID", "DOCUMENT_DATE", "DOCUMENT_STATUS", "DOCUMENT_SHA256",
    "MIL_HDBK_978B_SHA256",
    "UnsupportedMILSTD975MError", "SourceLocator", "DeratingCheck",
    "DeratingAssessment", "FAMILY_CATALOG", "CAPACITOR_RULES",
    "INDUCTOR_CLASSES", "LINEAR_MICROCIRCUIT_RULES",
    "DIGITAL_MICROCIRCUIT_RULES", "FUSE_FACTORS",
    "CIRCUIT_BREAKER_FACTORS", "RESISTOR_CURVES", "TRANSFORMER_CLASSES",
    "WIRE_SINGLE_CURRENT_A", "WIRE_INSULATION_FACTORS", "capacitor",
    "connector", "crystal_or_oscillator", "diode", "emi_filter",
    "winding_temperature_rise", "inductor", "linear_microcircuit",
    "digital_microcircuit", "fuse", "circuit_breaker", "relay",
    "resistor_power_factor", "resistor", "switch", "fiber_optic",
    "thermistor", "transformer", "transistor", "wire_and_cable", "assess",
    "profile_schema", "appendices_without_numerical_rules",
)


DOCUMENT_ID = "MIL-STD-975M (NASA)"
DOCUMENT_DATE = "5 August 1994"
DOCUMENT_STATUS = "Canceled without replacement by Notice 3, 5 May 1998"
DOCUMENT_SHA256 = "65c6c329df8f3279573ace3aa6fb9f7690646897a7df2bb288cb468eac7cf15b"
MIL_HDBK_978B_SHA256 = (
    "7ad4d29529fa42b24676fc3e22f178c2d2c099617c15fab15af8db536aa453be"
)

_CANCELLATION_WARNING = (
    "MIL-STD-975M was canceled without replacement on 5 May 1998; this is a "
    "historical Appendix A assessment, not a current NASA conformance claim."
)
_RATING_ASSUMPTION = (
    "Rated values must already reflect the applicable detailed-specification "
    "environmental and operating-condition rating factors required by "
    "Appendix A paragraph 3.0."
)


class UnsupportedMILSTD975MError(ValueError):
    """Raised when MIL-STD-975M supplies no executable rule for a case."""


@dataclass(frozen=True)
class SourceLocator:
    section: str
    title: str
    printed_pages: str
    pdf_pages: str


@dataclass(frozen=True)
class DeratingCheck:
    """One immutable comparison in a MIL-STD-975M assessment."""

    rule_id: str
    description: str
    actual: float | bool | str | None
    allowable: float | bool | str | None
    unit: str
    comparison: str
    passed: bool | None
    margin: float | None
    formula: str
    substitution: str
    source: SourceLocator
    notes: tuple[str, ...] = ()

    @property
    def status(self) -> str:
        if self.passed is True:
            return "pass"
        if self.passed is False:
            return "fail"
        return "not_evaluated"


@dataclass(frozen=True)
class DeratingAssessment:
    """Auditable, immutable result for one Appendix A family."""

    family: str
    subtype: str
    checks: tuple[DeratingCheck, ...]
    source: SourceLocator
    assumptions: tuple[str, ...]
    warnings: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(
            check.passed is True for check in self.checks
        )

    @property
    def status(self) -> str:
        if any(check.passed is False for check in self.checks):
            return "fail"
        if self.passed:
            return "pass"
        return "not_evaluated"

    @property
    def long_form(self) -> dict[str, Any]:
        return {
            "standard": DOCUMENT_ID,
            "edition": DOCUMENT_DATE,
            "document_status": DOCUMENT_STATUS,
            "family": self.family,
            "subtype": self.subtype,
            "status": self.status,
            "source": asdict(self.source),
            "checks": [asdict(check) | {"status": check.status} for check in self.checks],
            "assumptions": list(self.assumptions),
            "warnings": list(self.warnings),
        }


_SOURCES = MappingProxyType({
    "general": SourceLocator("Appendix A, 1.0–3.0", "Standard parts derating", "A.3", "444"),
    "capacitor": SourceLocator("Appendix A, 3.1", "Capacitors", "A.4–A.5", "445–446"),
    "connector": SourceLocator("Appendix A, 3.2", "Connectors", "A.6–A.7", "447–448"),
    "crystal": SourceLocator("Appendix A, 3.3", "Crystals and crystal oscillators", "A.8–A.9", "449–450"),
    "diode": SourceLocator("Appendix A, 3.4", "Diodes", "A.10–A.11", "451–452"),
    "filter": SourceLocator("Appendix A, 3.5", "Filters", "A.12–A.13", "453–454"),
    "inductor": SourceLocator("Appendix A, 3.6", "Inductors", "A.14–A.15", "455–456"),
    "linear_microcircuit": SourceLocator("Appendix A, 3.7", "Linear microcircuits", "A.16–A.17", "457–458"),
    "digital_microcircuit": SourceLocator("Appendix A, 3.8", "Digital microcircuits", "A.18–A.19", "459–460"),
    "protective_device": SourceLocator("Appendix A, 3.9", "Protective devices", "A.20–A.21", "461–462"),
    "relay": SourceLocator("Appendix A, 3.10", "Relays", "A.22–A.23", "463–464"),
    "resistor": SourceLocator("Appendix A, 3.11", "Resistors", "A.24–A.26", "465–467"),
    "switch": SourceLocator("Appendix A, 3.12", "Switches", "A.27–A.28", "468–469"),
    "thermistor": SourceLocator("Appendix A, 3.13", "Thermistors", "A.29–A.30", "470–471"),
    "transformer": SourceLocator("Appendix A, 3.14", "Transformers", "A.31–A.32", "472–473"),
    "transistor": SourceLocator("Appendix A, 3.15", "Transistors", "A.33–A.34", "474–475"),
    "wire_cable": SourceLocator("Appendix A, 3.16", "Wire and cable", "A.35–A.37", "476–478"),
})

_MIL_HDBK_978B_RESISTOR_GENERAL_SOURCE = SourceLocator(
    "MIL-HDBK-978B, 3.1.6.2",
    "Resistors, general — pulsed conditions and intermittent loads",
    "3-12–3-13",
    "158–159",
)
_MIL_HDBK_978B_RCR_PULSE_SOURCE = SourceLocator(
    "MIL-HDBK-978B, 3.2.5.2",
    "Fixed composition resistors — peak voltages and pulsed operation",
    "3-23–3-24",
    "169–170",
)
_MIL_HDBK_978B_FILM_PULSE_SOURCE = SourceLocator(
    "MIL-HDBK-978B, 3.3.5.3",
    "Established-reliability fixed-film resistors — pulse applications",
    "3-31",
    "177",
)

FAMILY_CATALOG = MappingProxyType({
    key: MappingProxyType({
        "section": source.section,
        "printed_pages": source.printed_pages,
        "pdf_pages": source.pdf_pages,
        "executable": key not in {"switch"},
    })
    for key, source in _SOURCES.items()
    if key != "general"
})


def _canonical(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    key = value.strip().lower().replace("-", "_").replace("/", "_").replace(" ", "_")
    while "__" in key:
        key = key.replace("__", "_")
    return key


def _finite(value: float, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be finite and numeric, not boolean")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{name} must be finite") from None
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _boolean(value: bool, name: str) -> bool:
    """Accept only actual booleans for source verification assertions."""
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be a boolean (True or False)")
    return value


def _nonnegative(value: float, name: str) -> float:
    result = _finite(value, name)
    if result < 0:
        raise ValueError(f"{name} must be >= 0")
    return result


def _positive(value: float, name: str) -> float:
    result = _finite(value, name)
    if result <= 0:
        raise ValueError(f"{name} must be > 0")
    return result


def _integer(value: int, name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be an integer >= {minimum}")
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{name} must be an integer >= {minimum}") from None
    if result != value or result < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return result


def _le(
    rule_id: str,
    description: str,
    actual: float,
    allowable: float,
    unit: str,
    formula: str,
    substitution: str,
    source: SourceLocator,
    notes: Sequence[str] = (),
    *,
    strict: bool = False,
) -> DeratingCheck:
    actual = _finite(actual, description)
    allowable = _finite(allowable, f"{description} allowable")
    passed = actual < allowable if strict else actual <= allowable
    margin = allowable - actual
    if passed and margin < 0:
        margin = 0.0
    return DeratingCheck(
        rule_id, description, actual, allowable, unit, "<" if strict else "<=",
        passed, margin, formula, substitution, source, tuple(notes),
    )


def _ge(
    rule_id: str,
    description: str,
    actual: float,
    required: float,
    unit: str,
    formula: str,
    substitution: str,
    source: SourceLocator,
    notes: Sequence[str] = (),
    *,
    strict: bool = False,
) -> DeratingCheck:
    actual = _finite(actual, description)
    required = _finite(required, f"{description} required")
    passed = actual > required if strict else actual >= required
    margin = actual - required
    if passed and margin < 0:
        margin = 0.0
    return DeratingCheck(
        rule_id, description, actual, required, unit, ">" if strict else ">=",
        passed, margin, formula, substitution, source, tuple(notes),
    )


def _not_evaluated(
    rule_id: str,
    description: str,
    *,
    actual: float | bool | str | None,
    allowable: float | bool | str | None,
    unit: str,
    comparison: str,
    formula: str,
    substitution: str,
    source: SourceLocator,
    notes: Sequence[str] = (),
) -> DeratingCheck:
    """Represent a source obligation that cannot yet be adjudicated.

    ``False`` is deliberately not used for a missing verification.  A failed
    numeric limit and an unverified external engineering duty have different
    meanings, and the assessment aggregate must preserve that distinction.
    """
    return DeratingCheck(
        rule_id, description, actual, allowable, unit, comparison, None, None,
        formula, substitution, source, tuple(notes),
    )


def _obligation(
    rule_id: str,
    description: str,
    verified: bool,
    source: SourceLocator,
    *,
    formula: str,
    notes: Sequence[str] = (),
) -> DeratingCheck:
    verified = _boolean(verified, description)
    if verified:
        return DeratingCheck(
            rule_id, description, True, True, "", "is", True, None,
            formula, "verified = True", source, tuple(notes),
        )
    return _not_evaluated(
        rule_id, description, actual=False, allowable=True, unit="",
        comparison="is", formula=formula, substitution="verified = False",
        source=source, notes=notes,
    )


def _assessment(
    family: str,
    subtype: str,
    checks: Sequence[DeratingCheck],
    *,
    assumptions: Sequence[str] = (),
    warnings: Sequence[str] = (),
) -> DeratingAssessment:
    if not checks:
        raise RuntimeError("a supported MIL-STD-975M assessment must contain a check")
    return DeratingAssessment(
        family=family,
        subtype=subtype,
        checks=tuple(checks),
        source=_SOURCES[family],
        assumptions=(_RATING_ASSUMPTION, *tuple(assumptions)),
        warnings=(_CANCELLATION_WARNING, *tuple(warnings)),
    )


@dataclass(frozen=True)
class _CapacitorRule:
    specification: str
    factor_low: float
    maximum_temperature_c: float
    factor_high: float | None = None
    transition_temperature_c: float = 70.0
    specialist_resistance_check: bool = False
    low_voltage_100v_minimum: bool = False


CAPACITOR_RULES = MappingProxyType({
    "CCR": _CapacitorRule("MIL-C-20", .60, 110, low_voltage_100v_minimum=True),
    "CKS": _CapacitorRule("MIL-C-123", .60, 110),
    "CKR": _CapacitorRule("MIL-C-39014", .60, 110, low_voltage_100v_minimum=True),
    "CDR": _CapacitorRule("MIL-C-55681", .60, 110, low_voltage_100v_minimum=True),
    "CYR": _CapacitorRule("MIL-C-23269", .50, 110),
    "CRH": _CapacitorRule("MIL-C-83421", .60, 85),
    "CHS": _CapacitorRule("MIL-C-87217", .60, 85),
    "CLR25": _CapacitorRule("MIL-C-39006/1", .50, 70),
    "CLR27": _CapacitorRule("MIL-C-39006/2", .50, 70),
    "CLR35": _CapacitorRule("MIL-C-39006/3", .50, 70),
    "CLR37": _CapacitorRule("MIL-C-39006/4", .50, 70),
    "CLR79": _CapacitorRule("MIL-C-39006/22", .60, 110, .40),
    "CLR81": _CapacitorRule("MIL-C-39006/25", .60, 110, .40),
    "CSR": _CapacitorRule("MIL-C-39003/1,2", .50, 110, .30, specialist_resistance_check=True),
    "CSS": _CapacitorRule("MIL-C-39003/10", .50, 110, .30, specialist_resistance_check=True),
    "CWR": _CapacitorRule("MIL-C-55365", .50, 110, .30, specialist_resistance_check=True),
})


def capacitor(
    style: str,
    *,
    rated_voltage: float,
    dc_polarizing_voltage: float,
    peak_ac_ripple_voltage: float = 0.0,
    ambient_temperature_c: float,
    effective_circuit_resistance_ohm_per_volt: float | None = None,
    parts_specialist_approved: bool = False,
) -> DeratingAssessment:
    """Assess an Appendix A paragraph 3.1 capacitor."""
    specialist_approved = _boolean(
        parts_specialist_approved, "parts_specialist_approved"
    )
    style_key = str(style).strip().upper()
    if style_key not in CAPACITOR_RULES:
        raise UnsupportedMILSTD975MError(
            f"capacitor style must be one of {sorted(CAPACITOR_RULES)}, got {style!r}"
        )
    rule = CAPACITOR_RULES[style_key]
    rated = _positive(rated_voltage, "rated_voltage")
    dc = _nonnegative(dc_polarizing_voltage, "dc_polarizing_voltage")
    ripple = _nonnegative(peak_ac_ripple_voltage, "peak_ac_ripple_voltage")
    temperature = _finite(ambient_temperature_c, "ambient_temperature_c")
    factor_temperature = min(temperature, rule.maximum_temperature_c)
    if (
        rule.factor_high is None
        or factor_temperature <= rule.transition_temperature_c
    ):
        factor = rule.factor_low
    else:
        span = rule.maximum_temperature_c - rule.transition_temperature_c
        factor = rule.factor_low + (rule.factor_high - rule.factor_low) * (
            factor_temperature - rule.transition_temperature_c
        ) / span

    resistance_ratio: float | None = None
    if rule.specialist_resistance_check:
        if effective_circuit_resistance_ohm_per_volt is not None:
            resistance_ratio = _nonnegative(
                effective_circuit_resistance_ohm_per_volt,
                "effective_circuit_resistance_ohm_per_volt",
            )

    source = _SOURCES["capacitor"]
    stress = dc + ripple
    endpoint_note = (
        (
            "The voltage comparison uses the source curve's maximum-temperature "
            "endpoint for diagnostic context; operation above Tmax is independently "
            "a failed source criterion."
        ),
    ) if temperature > rule.maximum_temperature_c else ()
    checks = [
        _le(
            f"975M.A.3.1.{style_key}.voltage",
            "Peak AC ripple plus DC polarizing voltage",
            stress,
            factor * rated,
            "V",
            "Vstress = VDC + VAC,peak <= f(T) Vrated",
            f"{dc:g} + {ripple:g} <= {factor:g} x {rated:g}",
            source,
            (f"Style {style_key}; {rule.specification}", *endpoint_note),
        ),
        _le(
            f"975M.A.3.1.{style_key}.temperature",
            "Ambient temperature",
            temperature,
            rule.maximum_temperature_c,
            "°C",
            "Tambient <= Tmax",
            f"{temperature:g} <= {rule.maximum_temperature_c:g}",
            source,
        ),
    ]
    if rule.specialist_resistance_check:
        rule_id = f"975M.A.3.1.{style_key}.effective_resistance"
        description = "Effective circuit resistance or parts-specialist approval"
        note = (
            "Below 1 Ω/V is permitted only with documented parts-specialist approval.",
        )
        if resistance_ratio is None:
            checks.append(_not_evaluated(
                rule_id, description, actual=None, allowable=1.0, unit="Ω/V",
                comparison=">= or approved",
                formula="Reffective >= 1 Ω/V or parts-specialist approval",
                substitution="effective circuit resistance was not supplied",
                source=source, notes=note,
            ))
        elif resistance_ratio >= 1 or specialist_approved:
            checks.append(DeratingCheck(
                rule_id, description, resistance_ratio, 1.0, "Ω/V",
                ">= or approved", True, None,
                "Reffective >= 1 Ω/V or parts-specialist approval",
                f"{resistance_ratio:g} Ω/V; approved = {specialist_approved}",
                source, note,
            ))
        else:
            checks.append(_not_evaluated(
                rule_id, description, actual=resistance_ratio, allowable=1.0,
                unit="Ω/V", comparison=">= or approved",
                formula="Reffective >= 1 Ω/V or parts-specialist approval",
                substitution=f"{resistance_ratio:g} < 1; approved = False",
                source=source, notes=note,
            ))
    if rule.low_voltage_100v_minimum and dc < 10:
        checks.append(_ge(
            f"975M.A.3.1.{style_key}.low_voltage_rating",
            "Rated voltage for an application below 10 Vdc",
            rated,
            100,
            "Vdc",
            "Vrated >= 100 Vdc when Vapplication < 10 Vdc",
            f"{rated:g} >= 100",
            source,
        ))
    return _assessment("capacitor", style_key, checks)


def connector(
    *,
    application_voltage: float,
    rated_dwv_sea_level: float,
    ambient_temperature_c: float,
    resistive_heating_rise_c: float,
    insert_temperature_rating_c: float,
) -> DeratingAssessment:
    source = _SOURCES["connector"]
    voltage = _nonnegative(application_voltage, "application_voltage")
    dwv = _positive(rated_dwv_sea_level, "rated_dwv_sea_level")
    ambient = _finite(ambient_temperature_c, "ambient_temperature_c")
    rise = _nonnegative(resistive_heating_rise_c, "resistive_heating_rise_c")
    insert_rating = _finite(insert_temperature_rating_c, "insert_temperature_rating_c")
    required_temperature = ambient + rise + 50
    return _assessment("connector", "connector", (
        _ge(
            "975M.A.3.2.voltage", "Sea-level dielectric-withstanding-voltage rating",
            dwv, 4 * voltage, "V",
            "VDWV,sea-level > Vapplication / 0.25",
            f"{dwv:g} > {voltage:g} / 0.25", source,
            ("Strict comparison follows the wording of the printed worked example.",),
            strict=True,
        ),
        _ge(
            "975M.A.3.2.insert_temperature", "Dielectric insert temperature rating",
            insert_rating, required_temperature, "°C",
            "Tinsert,rated > Tambient + DeltaTohmic + 50°C",
            f"{insert_rating:g} > {ambient:g} + {rise:g} + 50",
            source,
            ("Strict comparison follows the wording of the printed worked example.",),
            strict=True,
        ),
    ))


def crystal_or_oscillator(
    kind: str,
    *,
    actual_crystal_current: float | None = None,
    rated_crystal_current: float | None = None,
    startup_time_critical: bool = False,
    individual_components_verified: bool = False,
) -> DeratingAssessment:
    startup_critical = _boolean(startup_time_critical, "startup_time_critical")
    components_verified = _boolean(
        individual_components_verified, "individual_components_verified"
    )
    key = _canonical(kind, "kind")
    if key in {"crystal", "quartz_crystal"}:
        raise UnsupportedMILSTD975MError(
            "Appendix A 3.3 states that MIL-STD-975M contains no approved crystals"
        )
    if key not in {"oscillator", "crystal_oscillator"}:
        raise UnsupportedMILSTD975MError("kind must be 'crystal' or 'crystal oscillator'")
    factor = .75 if startup_critical else .50
    warning = (
        "The 75% exception is allowed only because startup_time_critical was explicitly set."
        if startup_critical else ""
    )
    source = _SOURCES["crystal"]
    checks: list[DeratingCheck] = []
    if actual_crystal_current is None or rated_crystal_current is None:
        checks.append(_not_evaluated(
            "975M.A.3.3.crystal_current", "Crystal current",
            actual=actual_crystal_current, allowable=None, unit="A",
            comparison="<=", formula="Icrystal <= f Irated",
            substitution="actual and rated crystal current are both required",
            source=source,
        ))
    else:
        actual = _nonnegative(actual_crystal_current, "actual_crystal_current")
        rated = _positive(rated_crystal_current, "rated_crystal_current")
        checks.append(_le(
            "975M.A.3.3.crystal_current", "Crystal current", actual,
            factor * rated, "A", "Icrystal <= f Irated",
            f"{actual:g} <= {factor:g} x {rated:g}", source,
        ))
    checks.append(_obligation(
        "975M.A.3.3.component_derating",
        "Independent derating of every oscillator component",
        components_verified,
        source,
        formula="all individual oscillator components independently derated",
    ))
    return _assessment(
        "crystal", "crystal_oscillator", checks,
        assumptions=(
            ("Individual oscillator components were independently derated.",)
            if components_verified else ()
        ),
        warnings=((warning,) if warning else ()),
    )


_DIODE_TYPES = MappingProxyType({
    "general_purpose": "general",
    "rectifier": "general",
    "switching": "general",
    "pin": "general",
    "schottky": "general",
    "thyristor": "general",
    "varactor": "varactor",
    "voltage_regulator": "voltage_regulator",
    "voltage_reference": "voltage_reference",
    "zener_voltage_suppressor": "zener_voltage_suppressor",
    "bidirectional_voltage_suppressor": "bidirectional_voltage_suppressor",
    "fet_current_regulator": "fet_current_regulator",
})


def _pair(values: Mapping[str, tuple[float, float]], key: str) -> tuple[float, float]:
    if key not in values:
        raise UnsupportedMILSTD975MError(f"required stress pair {key!r} was not supplied")
    pair = values[key]
    if not isinstance(pair, Sequence) or len(pair) != 2:
        raise ValueError(f"{key} must be an (actual, rated) pair")
    return _nonnegative(pair[0], f"{key} actual"), _positive(pair[1], f"{key} rated")


def diode(
    diode_type: str,
    *,
    junction_temperature_c: float,
    stresses: Mapping[str, tuple[float, float]] | None = None,
    zener_current_actual: float | None = None,
    zener_current_maximum: float | None = None,
    zener_current_nominal: float | None = None,
    manufacturer_zener_current: float | None = None,
) -> DeratingAssessment:
    key = _canonical(diode_type, "diode_type")
    if key not in _DIODE_TYPES:
        raise UnsupportedMILSTD975MError(
            f"diode_type must be one of {sorted(_DIODE_TYPES)}, got {diode_type!r}"
        )
    family = _DIODE_TYPES[key]
    if stresses is None:
        data: Mapping[str, tuple[float, float]] = {}
    elif not isinstance(stresses, Mapping):
        raise ValueError("stresses must be a mapping of (actual, rated) pairs")
    else:
        data = stresses
    source = _SOURCES["diode"]
    checks: list[DeratingCheck] = []
    parameters: tuple[tuple[str, float], ...]
    if family == "general":
        parameters = (("piv", .70), ("surge_current", .50), ("forward_current", .50))
    elif family == "varactor":
        parameters = (("power", .50), ("reverse_voltage", .75), ("forward_current", .75))
    elif family in {"zener_voltage_suppressor", "bidirectional_voltage_suppressor"}:
        parameters = (("power_dissipation", .50),)
    elif family == "fet_current_regulator":
        parameters = (("peak_operating_voltage", .80),)
    elif family == "voltage_regulator":
        parameters = (("power", .50),)
    else:
        parameters = ()
    for parameter, factor in parameters:
        if parameter not in data:
            checks.append(_not_evaluated(
                f"975M.A.3.4.{family}.{parameter}",
                parameter.replace("_", " ").title(),
                actual=None, allowable=None, unit="ratio-reference units",
                comparison="<=", formula=f"actual <= {factor:g} rated",
                substitution=f"required stress pair {parameter!r} was not supplied",
                source=source,
            ))
            continue
        actual, rated = _pair(data, parameter)
        checks.append(_le(
            f"975M.A.3.4.{family}.{parameter}", parameter.replace("_", " ").title(),
            actual, factor * rated, "ratio-reference units",
            f"actual <= {factor:g} rated", f"{actual:g} <= {factor:g} x {rated:g}", source,
        ))
    if family == "voltage_regulator":
        if any(value is None for value in (
            zener_current_actual, zener_current_maximum, zener_current_nominal,
        )):
            checks.append(_not_evaluated(
                "975M.A.3.4.voltage_regulator.zener_current", "Zener current",
                actual=zener_current_actual, allowable=None, unit="A",
                comparison="<=", formula="Iz <= 0.5 (Iz,max + Iz,nom)",
                substitution="actual, maximum, and nominal zener currents are required",
                source=source,
            ))
        else:
            actual = _nonnegative(zener_current_actual, "zener_current_actual")
            maximum = _positive(zener_current_maximum, "zener_current_maximum")
            nominal = _nonnegative(zener_current_nominal, "zener_current_nominal")
            checks.append(_le(
                "975M.A.3.4.voltage_regulator.zener_current", "Zener current",
                actual, .5 * (maximum + nominal), "A",
                "Iz <= 0.5 (Iz,max + Iz,nom)",
                f"{actual:g} <= 0.5 x ({maximum:g} + {nominal:g})", source,
            ))
    elif family == "voltage_reference":
        if zener_current_actual is None or manufacturer_zener_current is None:
            checks.append(_not_evaluated(
                "975M.A.3.4.voltage_reference.zener_current",
                "Voltage-reference zener current",
                actual=zener_current_actual, allowable=manufacturer_zener_current,
                unit="A", comparison="=",
                formula="Iz = manufacturer-specified IzT",
                substitution="actual and manufacturer-specified zener currents are required",
                source=source,
            ))
        else:
            actual = _nonnegative(zener_current_actual, "zener_current_actual")
            specified = _positive(
                manufacturer_zener_current, "manufacturer_zener_current"
            )
            checks.extend((
                _le(
                    "975M.A.3.4.voltage_reference.zener_current.upper",
                    "Voltage-reference zener current", actual, specified, "A",
                    "Iz = manufacturer-specified IzT",
                    f"{actual:g} = {specified:g}", source,
                ),
                _ge(
                    "975M.A.3.4.voltage_reference.zener_current.lower",
                    "Voltage-reference zener current", actual, specified, "A",
                    "Iz = manufacturer-specified IzT",
                    f"{actual:g} = {specified:g}", source,
                ),
            ))
    temperature = _finite(junction_temperature_c, "junction_temperature_c")
    checks.append(_le(
        f"975M.A.3.4.{family}.junction_temperature", "Junction temperature",
        temperature, 125, "°C", "Tj <= 125°C", f"{temperature:g} <= 125", source,
    ))
    return _assessment("diode", key, checks)


def emi_filter(
    *,
    actual_current: float,
    rated_operating_current: float,
    actual_voltage: float,
    rated_operating_voltage: float,
    ambient_temperature_c: float,
) -> DeratingAssessment:
    source = _SOURCES["filter"]
    current = _nonnegative(actual_current, "actual_current")
    current_rating = _positive(rated_operating_current, "rated_operating_current")
    voltage = _nonnegative(actual_voltage, "actual_voltage")
    voltage_rating = _positive(rated_operating_voltage, "rated_operating_voltage")
    temperature = _finite(ambient_temperature_c, "ambient_temperature_c")
    note = ("Reference ratings are rated operating values, not absolute maxima.",)
    return _assessment("filter", "all", (
        _le("975M.A.3.5.current", "Operating current", current, .5 * current_rating,
            "A", "I <= 0.5 Irated,operating", f"{current:g} <= 0.5 x {current_rating:g}", source, note),
        _le("975M.A.3.5.voltage", "Operating voltage", voltage, .5 * voltage_rating,
            "V", "V <= 0.5 Vrated,operating", f"{voltage:g} <= 0.5 x {voltage_rating:g}", source, note),
        _le("975M.A.3.5.temperature", "Ambient temperature", temperature, 85,
            "°C", "Tambient <= 85°C", f"{temperature:g} <= 85", source),
    ))


INDUCTOR_CLASSES = MappingProxyType({
    ("MIL_C_39010", "A"): (105.0, 85.0),
    ("MIL_C_39010", "B"): (125.0, 105.0),
    ("MIL_C_39010", "F"): (150.0, 130.0),
    ("MIL_C_15305", "O"): (85.0, 65.0),
    ("MIL_C_15305", "A"): (105.0, 85.0),
    ("MIL_C_15305", "B"): (125.0, 105.0),
})


def winding_temperature_rise(
    hot_resistance: float,
    initial_resistance: float,
    initial_ambient_temperature_c: float,
    shutdown_ambient_temperature_c: float,
) -> float:
    """MIL-T-27 paragraph 4.8.12 copper-resistance rise equation."""
    hot = _positive(hot_resistance, "hot_resistance")
    initial = _positive(initial_resistance, "initial_resistance")
    t = _finite(initial_ambient_temperature_c, "initial_ambient_temperature_c")
    shutdown = _finite(shutdown_ambient_temperature_c, "shutdown_ambient_temperature_c")
    if abs(shutdown - t) > 5:
        raise UnsupportedMILSTD975MError(
            "shutdown ambient temperature must be within 5°C of initial ambient temperature"
        )
    rise = ((hot - initial) / initial) * (t + 234.5) - (shutdown - t)
    if rise < 0:
        raise ValueError(
            "computed winding temperature rise must be >= 0°C; verify the hot/"
            "initial resistance measurements and ambient-temperature correction"
        )
    return rise


def _winding_device(
    family: str,
    subtype: str,
    *,
    maximum_temperature_c: float | None,
    rated_dwv: float,
    application_voltage: float,
    application_current: float | None,
    rated_current: float | None,
    ambient_temperature_c: float,
    hot_resistance: float,
    initial_resistance: float,
    initial_ambient_temperature_c: float,
    shutdown_ambient_temperature_c: float,
    temperature_delegation: str | None = None,
    assumptions: Sequence[str] = (),
    warnings: Sequence[str] = (),
) -> DeratingAssessment:
    source = _SOURCES[family]
    ambient = _finite(ambient_temperature_c, "ambient_temperature_c")
    voltage = _nonnegative(application_voltage, "application_voltage")
    dwv = _positive(rated_dwv, "rated_dwv")
    if (application_current is None) != (rated_current is None):
        raise ValueError("application_current and rated_current must be supplied together")
    current: float | None = None
    current_rating: float | None = None
    if application_current is not None and rated_current is not None:
        current = _nonnegative(application_current, "application_current")
        current_rating = _positive(rated_current, "rated_current")

    rise: float | None
    rise_reason = temperature_delegation
    try:
        rise = winding_temperature_rise(
            hot_resistance, initial_resistance, initial_ambient_temperature_c,
            shutdown_ambient_temperature_c,
        )
    except UnsupportedMILSTD975MError as exc:
        rise = None
        rise_reason = str(exc)

    section = _SOURCES[family].section.split()[-1]
    checks: list[DeratingCheck] = []
    if rise is None or maximum_temperature_c is None:
        checks.append(_not_evaluated(
            f"975M.A.{section}.temperature", "Maximum operating temperature",
            actual=None if rise is None else ambient + rise + 10,
            allowable=maximum_temperature_c, unit="°C", comparison="<=",
            formula="Top = Tambient + DeltaTwinding + 10°C",
            substitution=rise_reason or "source temperature limit was delegated",
            source=source,
        ))
    else:
        operating_temperature = ambient + rise + 10
        checks.append(_le(
            f"975M.A.{section}.temperature",
            "Maximum operating temperature", operating_temperature,
            maximum_temperature_c, "°C",
            "Top = Tambient + DeltaTwinding + 10°C",
            f"{ambient:g} + {rise:g} + 10 <= {maximum_temperature_c:g}", source,
        ))
    checks.append(
        _le(
            f"975M.A.{section}.dwv",
            "Application voltage versus dielectric-withstanding rating",
            voltage, .5 * dwv, "V", "Vapplication <= 0.5 VDWV,rated",
            f"{voltage:g} <= 0.5 x {dwv:g}", source,
        )
    )
    if current is not None and current_rating is not None:
        checks.append(_le(
            f"975M.A.{section}.current",
            "Operating current", current, current_rating, "A",
            "Iapplication <= Irated", f"{current:g} <= {current_rating:g}", source,
            ("Appendix A supplies no current reduction factor; its inductor example uses 100%.",),
        ))
    return _assessment(
        family, subtype, checks, assumptions=assumptions, warnings=warnings,
    )


def inductor(
    specification: str,
    insulation_class: str | None = None,
    *,
    custom_rated_temperature_c: float | None = None,
    rated_dwv: float,
    application_voltage: float,
    application_current: float,
    rated_current: float,
    ambient_temperature_c: float,
    hot_resistance: float,
    initial_resistance: float,
    initial_ambient_temperature_c: float,
    shutdown_ambient_temperature_c: float,
) -> DeratingAssessment:
    spec = _canonical(specification, "specification").upper()
    temperature_delegation = None
    if spec in {"CUSTOM", "CUSTOM_MADE"}:
        rated_temperature = (
            None if custom_rated_temperature_c is None
            else _finite(custom_rated_temperature_c, "custom_rated_temperature_c")
        )
        if rated_temperature is None or not 85 <= rated_temperature <= 130:
            maximum_temperature = None
            temperature_delegation = (
                "custom inductor rated temperature must be within 85–130°C; "
                "this case requires project-parts-engineer guidance"
            )
        else:
            maximum_temperature = .75 * rated_temperature
        subtype = "custom"
        warnings = ((
            "The source-defined custom-device rule multiplies a Celsius value by 0.75."
        ),) if maximum_temperature is not None else (temperature_delegation,)
    else:
        class_key = str(insulation_class).strip().upper()
        key = (spec, class_key)
        if key not in INDUCTOR_CLASSES:
            raise UnsupportedMILSTD975MError(
                f"unsupported inductor specification/class {specification!r}/{insulation_class!r}"
            )
        _, maximum_temperature = INDUCTOR_CLASSES[key]
        subtype = f"{spec}:{class_key}"
        warnings = ()
    return _winding_device(
        "inductor", subtype, maximum_temperature_c=maximum_temperature,
        rated_dwv=rated_dwv, application_voltage=application_voltage,
        application_current=application_current, rated_current=rated_current,
        ambient_temperature_c=ambient_temperature_c,
        hot_resistance=hot_resistance, initial_resistance=initial_resistance,
        initial_ambient_temperature_c=initial_ambient_temperature_c,
        shutdown_ambient_temperature_c=shutdown_ambient_temperature_c,
        temperature_delegation=temperature_delegation,
        assumptions=("A 10°C winding hot-spot allowance is included.",),
        warnings=warnings,
    )


LINEAR_MICROCIRCUIT_RULES = MappingProxyType({
    "operational_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("output_voltage", 1.00),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "differential_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("output_voltage", 1.00),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "comparator": (
        ("supply_voltage", .90), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("open_collector_output_voltage", .90),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "sense_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("open_collector_output_voltage", .90),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "current_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("output_voltage", 1.00),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "voltage_regulator": (
        ("input_output_differential_voltage", .80), ("power_dissipation", .80),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "analog_switch": (
        ("supply_voltage", .90), ("power_dissipation", .80),
        ("output_current", .80),
    ),
})


def linear_microcircuit(
    device_type: str,
    *,
    stress_ratios: Mapping[str, float],
    junction_temperature_c: float,
    actual_input_voltage: float | None = None,
    actual_supply_voltage: float | None = None,
) -> DeratingAssessment:
    """Assess every applicable row of Appendix A paragraph 3.7."""
    key = _canonical(device_type, "device_type")
    aliases = {"op_amp": "operational_amplifier", "diff_amp": "differential_amplifier"}
    key = aliases.get(key, key)
    if key not in LINEAR_MICROCIRCUIT_RULES:
        raise UnsupportedMILSTD975MError(
            f"linear device_type must be one of {sorted(LINEAR_MICROCIRCUIT_RULES)}"
        )
    if not isinstance(stress_ratios, Mapping):
        raise ValueError("stress_ratios must be a mapping")
    source = _SOURCES["linear_microcircuit"]
    checks: list[DeratingCheck] = []
    for parameter, limit in LINEAR_MICROCIRCUIT_RULES[key]:
        if parameter not in stress_ratios:
            checks.append(_not_evaluated(
                f"975M.A.3.7.{key}.{parameter}",
                parameter.replace("_", " ").title(),
                actual=None, allowable=limit, unit="ratio", comparison="<=",
                formula="actual/rated <= table factor",
                substitution=f"required stress ratio {parameter!r} was not supplied",
                source=source,
                notes=(
                    ("Power is relative to rated power at maximum operating temperature.",)
                    if parameter == "power_dissipation" else ()
                ),
            ))
            continue
        ratio = _nonnegative(stress_ratios[parameter], parameter)
        checks.append(_le(
            f"975M.A.3.7.{key}.{parameter}", parameter.replace("_", " ").title(),
            ratio, limit, "ratio", "actual/rated <= table factor",
            f"{ratio:g} <= {limit:g}", source,
            (("Power is relative to rated power at maximum operating temperature.",)
             if parameter == "power_dissipation" else ()),
        ))
    if any(parameter == "ac_input_voltage" for parameter, _ in LINEAR_MICROCIRCUIT_RULES[key]):
        if actual_input_voltage is None or actual_supply_voltage is None:
            checks.append(_not_evaluated(
                f"975M.A.3.7.{key}.input_not_above_supply",
                "Input voltage", actual=actual_input_voltage,
                allowable=actual_supply_voltage, unit="V", comparison="<=",
                formula="Vinput <= Vsupply",
                substitution="actual input and supply voltages are both required",
                source=source,
            ))
        else:
            input_voltage = _nonnegative(
                actual_input_voltage, "actual_input_voltage"
            )
            supply_voltage = _nonnegative(
                actual_supply_voltage, "actual_supply_voltage"
            )
            checks.append(_le(
                f"975M.A.3.7.{key}.input_not_above_supply",
                "Input voltage", input_voltage, supply_voltage, "V",
                "Vinput <= Vsupply",
                f"{input_voltage:g} <= {supply_voltage:g}", source,
            ))
    temperature = _finite(junction_temperature_c, "junction_temperature_c")
    checks.append(_le(
        f"975M.A.3.7.{key}.junction_temperature", "Junction temperature",
        temperature, 100, "°C", "Tj <= 100°C", f"{temperature:g} <= 100", source,
    ))
    return _assessment("linear_microcircuit", key, checks)


DIGITAL_MICROCIRCUIT_RULES = MappingProxyType({
    "bipolar": MappingProxyType({
        "output_current_or_fanout": .80,
        "supply_voltage": None,
        "clock_frequency": None,
        "open_collector_output_voltage": .80,
    }),
    "mos": MappingProxyType({
        "output_current_or_fanout": .80,
        "supply_voltage": None,
        "clock_frequency": .85,
        "open_collector_output_voltage": None,
    }),
    "cmos_4000_ab": MappingProxyType({
        "output_current_or_fanout": .80,
        "supply_voltage": .70,
        "clock_frequency": .85,
        "open_collector_output_voltage": None,
    }),
    "cmos_hc_hct": MappingProxyType({
        "output_current_or_fanout": .80,
        "supply_voltage": .79,
        "clock_frequency": .85,
        "open_collector_output_voltage": None,
    }),
    "cmos_ac_act": MappingProxyType({
        "output_current_or_fanout": .80,
        "supply_voltage": .92,
        "clock_frequency": .85,
        "open_collector_output_voltage": None,
    }),
    "line_driver_receiver": MappingProxyType({
        "output_current_or_fanout": .80,
        "supply_voltage": None,
        "clock_frequency": .80,
        "open_collector_output_voltage": .75,
    }),
    "gate_array_bipolar_mos": MappingProxyType({
        "output_current_or_fanout": .80,
        "supply_voltage": None,
        "clock_frequency": .80,
        "open_collector_output_voltage": .80,
    }),
})


def digital_microcircuit(
    technology: str,
    *,
    output_current_or_fanout_ratio: float,
    supply_voltage_ratio: float,
    junction_temperature_c: float,
    clock_frequency_ratio: float | None = None,
    open_collector_or_drain: bool = False,
    open_collector_output_voltage_ratio: float | None = None,
    ttl_open_collector: bool = False,
    actual_input_voltage: float | None = None,
    actual_supply_voltage: float,
    radiation_environment: bool = False,
    radiation_derating_verified: bool = False,
) -> DeratingAssessment:
    uses_open_output = _boolean(
        open_collector_or_drain, "open_collector_or_drain"
    )
    ttl_open = _boolean(ttl_open_collector, "ttl_open_collector")
    in_radiation_environment = _boolean(
        radiation_environment, "radiation_environment"
    )
    radiation_verified = _boolean(
        radiation_derating_verified, "radiation_derating_verified"
    )
    key = _canonical(technology, "technology")
    aliases = {
        "cmos_4000_a_b": "cmos_4000_ab", "cmos_4000": "cmos_4000_ab",
        "hc_hct": "cmos_hc_hct", "ac_act": "cmos_ac_act",
        "line_drivers_receivers": "line_driver_receiver",
        "gate_array": "gate_array_bipolar_mos",
    }
    key = aliases.get(key, key)
    if key not in DIGITAL_MICROCIRCUIT_RULES:
        raise UnsupportedMILSTD975MError(
            f"digital technology must be one of {sorted(DIGITAL_MICROCIRCUIT_RULES)}"
        )
    rule = DIGITAL_MICROCIRCUIT_RULES[key]
    source = _SOURCES["digital_microcircuit"]
    checks: list[DeratingCheck] = []
    output_ratio = _nonnegative(output_current_or_fanout_ratio, "output_current_or_fanout_ratio")
    checks.append(_le(
        f"975M.A.3.8.{key}.output", "Output current or fanout ratio", output_ratio,
        .80, "ratio", "output/rated <= 0.80", f"{output_ratio:g} <= 0.8", source,
    ))
    supply_ratio = _nonnegative(supply_voltage_ratio, "supply_voltage_ratio")
    supply_limit = rule["supply_voltage"]
    if supply_limit is None:
        checks.append(_le(
            f"975M.A.3.8.{key}.supply", "Supply voltage ratio", supply_ratio,
            1.0, "ratio", "Vsupply/Vabsolute,max < 1",
            f"{supply_ratio:g} < 1", source,
            ("The source gives no smaller numerical supply factor for this technology.",),
            strict=True,
        ))
    else:
        checks.append(_le(
            f"975M.A.3.8.{key}.supply", "Supply voltage ratio", supply_ratio,
            float(supply_limit), "ratio", "Vsupply/Vabsolute,max <= table factor",
            f"{supply_ratio:g} <= {float(supply_limit):g}", source,
        ))
    clock_limit = rule["clock_frequency"]
    if clock_limit is not None:
        if clock_frequency_ratio is None:
            checks.append(_not_evaluated(
                f"975M.A.3.8.{key}.clock", "Clock frequency ratio",
                actual=None, allowable=float(clock_limit), unit="ratio",
                comparison="<=", formula="fclock/frated <= table factor",
                substitution="clock_frequency_ratio was not supplied",
                source=source,
            ))
        else:
            clock_ratio = _nonnegative(
                clock_frequency_ratio, "clock_frequency_ratio"
            )
            checks.append(_le(
                f"975M.A.3.8.{key}.clock", "Clock frequency ratio", clock_ratio,
                float(clock_limit), "ratio", "fclock/frated <= table factor",
                f"{clock_ratio:g} <= {float(clock_limit):g}", source,
            ))
    elif clock_frequency_ratio is not None:
        clock_ratio = _nonnegative(clock_frequency_ratio, "clock_frequency_ratio")
        checks.append(_not_evaluated(
            f"975M.A.3.8.{key}.clock", "Clock frequency ratio",
            actual=clock_ratio, allowable=None, unit="ratio", comparison="N/A",
            formula="no Appendix A clock-frequency rule for this technology",
            substitution=f"clock_frequency_ratio = {clock_ratio:g}", source=source,
        ))
    if uses_open_output:
        open_limit = rule["open_collector_output_voltage"]
        if key == "bipolar" and ttl_open:
            open_limit = .75
        if open_limit is None:
            actual_open = (
                None if open_collector_output_voltage_ratio is None
                else _nonnegative(
                    open_collector_output_voltage_ratio,
                    "open_collector_output_voltage_ratio",
                )
            )
            checks.append(_not_evaluated(
                f"975M.A.3.8.{key}.open_output",
                "Open collector/drain output voltage ratio",
                actual=actual_open, allowable=None, unit="ratio", comparison="N/A",
                formula="no Appendix A open-output rule for this technology",
                substitution=f"technology = {key}", source=source,
            ))
        elif open_collector_output_voltage_ratio is None:
            checks.append(_not_evaluated(
                f"975M.A.3.8.{key}.open_output",
                "Open collector/drain output voltage ratio",
                actual=None, allowable=float(open_limit), unit="ratio",
                comparison="<=", formula="Voutput/Vrated <= table factor",
                substitution="open_collector_output_voltage_ratio was not supplied",
                source=source,
            ))
        else:
            open_ratio = _nonnegative(
                open_collector_output_voltage_ratio,
                "open_collector_output_voltage_ratio",
            )
            checks.append(_le(
                f"975M.A.3.8.{key}.open_output",
                "Open collector/drain output voltage ratio",
                open_ratio, float(open_limit), "ratio",
                "Voutput/Vrated <= table factor",
                f"{open_ratio:g} <= {float(open_limit):g}", source,
            ))
    supply_voltage = _nonnegative(actual_supply_voltage, "actual_supply_voltage")
    if actual_input_voltage is None:
        checks.append(_not_evaluated(
            f"975M.A.3.8.{key}.input_not_above_supply", "Input voltage",
            actual=None, allowable=supply_voltage, unit="V", comparison="<=",
            formula="Vinput <= Vsupply",
            substitution="actual_input_voltage was not supplied", source=source,
        ))
    else:
        input_voltage = _nonnegative(actual_input_voltage, "actual_input_voltage")
        checks.append(_le(
            f"975M.A.3.8.{key}.input_not_above_supply", "Input voltage",
            input_voltage, supply_voltage, "V", "Vinput <= Vsupply",
            f"{input_voltage:g} <= {supply_voltage:g}", source,
        ))
    temperature = _finite(junction_temperature_c, "junction_temperature_c")
    checks.append(_le(
        f"975M.A.3.8.{key}.junction_temperature", "Junction temperature",
        temperature, 100, "°C", "Tj <= 100°C", f"{temperature:g} <= 100", source,
    ))
    if in_radiation_environment:
        checks.append(_obligation(
            f"975M.A.3.8.{key}.radiation_derating",
            "Additional radiation-environment output-current/fanout derating",
            radiation_verified,
            source,
            formula="additional radiation derating independently verified",
        ))
    assumptions = (
        ("Additional radiation derating was independently verified.",)
        if in_radiation_environment and radiation_verified else ()
    )
    return _assessment("digital_microcircuit", key, checks, assumptions=assumptions)


FUSE_FACTORS = MappingProxyType({
    .125: .25,
    .25: .30,
    .375: .35,
    .5: .40,
    .75: .40,
    1.0: .45,
    1.5: .45,
})


def fuse(
    *,
    rated_current: float,
    application_current: float,
    ambient_temperature_c: float,
    pcb_mounted: bool = True,
    conformally_coated: bool = True,
) -> DeratingAssessment:
    is_pcb_mounted = _boolean(pcb_mounted, "pcb_mounted")
    is_conformally_coated = _boolean(
        conformally_coated, "conformally_coated"
    )
    rating = _positive(rated_current, "rated_current")
    actual = _nonnegative(application_current, "application_current")
    temperature = _finite(ambient_temperature_c, "ambient_temperature_c")
    if rating in FUSE_FACTORS:
        base = FUSE_FACTORS[rating]
    elif 2 <= rating <= 15:
        base = .50
    else:
        raise UnsupportedMILSTD975MError(
            "fuse rated_current is outside the Appendix A table (.125–15 A)"
        )
    # The source tabulates decimal factors and an exact 0.005/°C adjustment.
    # Decimal arithmetic prevents a printed boundary such as 4 A at 80°C
    # (0.9 A allowable) from becoming 0.8999999999999999 before comparison.
    temperature_delta = max(temperature - 25, 0)
    factor_decimal = Decimal(str(base)) - Decimal("0.005") * Decimal(
        str(temperature_delta)
    )
    if factor_decimal <= 0:
        raise UnsupportedMILSTD975MError(
            "temperature adjustment produces a nonpositive fuse derating factor"
        )
    allowable_current = float(factor_decimal * Decimal(str(rating)))
    source = _SOURCES["protective_device"]
    checks = [
        _le(
            "975M.A.3.9.fuse.current", "Fuse application current", actual,
            allowable_current, "A",
            "Iapplication <= (f25 - 0.005 max(T-25,0)) Irated",
            f"{actual:g} <= ({base:g} - 0.005 x "
            f"{max(temperature - 25, 0):g}) x {rating:g}",
            source,
            ("Fractional calculated fuse selections must use the next higher standard rating.",),
        ),
        _obligation(
            "975M.A.3.9.fuse.pcb_mounting", "Printed-circuit-board mounting",
            is_pcb_mounted, source,
            formula="fuse is mounted on a printed circuit board",
        ),
        _obligation(
            "975M.A.3.9.fuse.conformal_coating", "Conformal coating",
            is_conformally_coated, source,
            formula="fuse is conformally coated",
        ),
    ]
    assumptions = (
        (
            "The fuse is PCB-mounted and conformally coated; the source factor "
            "includes loss-of-pressure and aging allowance."
        ),
    ) if is_pcb_mounted and is_conformally_coated else ()
    return _assessment(
        "protective_device", "fuse", checks, assumptions=assumptions,
    )


CIRCUIT_BREAKER_FACTORS = MappingProxyType({
    "resistive": .75,
    "capacitive": .75,
    "inductive": .40,
    "motor": .20,
    "filament": .10,
})


def circuit_breaker(
    load_type: str,
    *,
    maximum_rated_resistive_contact_current: float,
    application_current: float,
    specified_maximum_ambient_temperature_c: float,
    application_ambient_temperature_c: float,
    series_resistance_used: bool = False,
    vendor_trip_curve_verified: bool = False,
    thermal_breaker: bool = False,
    thermal_effects_verified: bool = False,
) -> DeratingAssessment:
    has_series_resistance = _boolean(
        series_resistance_used, "series_resistance_used"
    )
    trip_curve_verified = _boolean(
        vendor_trip_curve_verified, "vendor_trip_curve_verified"
    )
    is_thermal = _boolean(thermal_breaker, "thermal_breaker")
    thermal_verified = _boolean(
        thermal_effects_verified, "thermal_effects_verified"
    )
    key = _canonical(load_type, "load_type")
    if key not in CIRCUIT_BREAKER_FACTORS:
        raise UnsupportedMILSTD975MError(
            f"circuit-breaker load_type must be one of {sorted(CIRCUIT_BREAKER_FACTORS)}"
        )
    rating = _positive(
        maximum_rated_resistive_contact_current,
        "maximum_rated_resistive_contact_current",
    )
    current = _nonnegative(application_current, "application_current")
    maximum_temperature = _finite(
        specified_maximum_ambient_temperature_c,
        "specified_maximum_ambient_temperature_c",
    )
    ambient = _finite(application_ambient_temperature_c, "application_ambient_temperature_c")
    factor = CIRCUIT_BREAKER_FACTORS[key]
    source = _SOURCES["protective_device"]
    checks: list[DeratingCheck] = [
        _le(
            f"975M.A.3.9.circuit_breaker.{key}.current", "Circuit-breaker contact current",
            current, factor * rating, "A",
            "Iapplication <= fload Irated,resistive",
            f"{current:g} <= {factor:g} x {rating:g}", source,
        ),
        _le(
            "975M.A.3.9.circuit_breaker.temperature", "Application ambient temperature",
            ambient, maximum_temperature - 20, "°C",
            "Tambient <= Tspecified,max - 20°C",
            f"{ambient:g} <= {maximum_temperature:g} - 20", source,
        ),
    ]
    if key == "capacitive":
        checks.append(_obligation(
            "975M.A.3.9.circuit_breaker.capacitive.series_resistance",
            "Series resistance for a capacitive load", has_series_resistance,
            source, formula="capacitive load includes source-required series resistance",
        ))
    checks.append(_obligation(
        "975M.A.3.9.circuit_breaker.vendor_trip_curve",
        "Applicable vendor trip current/time curve verification",
        trip_curve_verified, source,
        formula="application verified against vendor trip current/time curve",
    ))
    if is_thermal:
        checks.append(_obligation(
            "975M.A.3.9.circuit_breaker.thermal_effects",
            "Thermal-breaker ambient-temperature/trip-time verification",
            thermal_verified, source,
            formula="thermal effects independently verified",
        ))
    assumptions = (
        ("The applicable vendor trip current/time curve was verified.",)
        if trip_curve_verified else ()
    )
    return _assessment(
        "protective_device", f"circuit_breaker:{key}", checks,
        assumptions=assumptions,
    )


def relay(
    *,
    rated_contact_current: float,
    application_contact_current: float,
    ambient_temperature_c: float,
    cycles_per_hour: float,
    load_class: str,
    on_time_seconds: float,
    off_time_seconds: float,
    carry_only: bool = False,
) -> DeratingAssessment:
    """Apply the paragraph 3.10 temperature x rate x load model."""
    is_carry_only = _boolean(carry_only, "carry_only")
    rating = _positive(rated_contact_current, "rated_contact_current")
    actual = _nonnegative(application_contact_current, "application_contact_current")
    temperature = _finite(ambient_temperature_c, "ambient_temperature_c")
    cycles = _nonnegative(cycles_per_hour, "cycles_per_hour")
    on_time = _nonnegative(on_time_seconds, "on_time_seconds")
    off_time = _nonnegative(off_time_seconds, "off_time_seconds")
    if not -65 <= temperature <= 125:
        raise UnsupportedMILSTD975MError(
            "relay ambient temperature is outside the Appendix A range -65–125°C"
        )
    # The printed table uses integer-ended bands.  Half-open intervals preserve
    # those boundaries for continuous numerical inputs without interpolation.
    if temperature < -20:
        temperature_factor = .85
    elif temperature < 40:
        temperature_factor = .90
    elif temperature < 85:
        temperature_factor = .85
    else:
        temperature_factor = .70
    if cycles < 1:
        rate_factor = .85
    elif cycles <= 10:
        rate_factor = .90
    else:
        rate_factor = .85
    load = str(load_class).strip().upper()
    if load == "A":
        load_factor = 1.0
    elif load == "B":
        load_factor = 1.5
    elif load == "C":
        load_factor = .8
    else:
        raise UnsupportedMILSTD975MError("relay load_class must be A, B, or C")
    factor = temperature_factor * rate_factor * load_factor
    warnings = (
        ("Load C is identified by MIL-STD-975M as limited use.",)
        if load == "C" else ()
    )
    source = _SOURCES["relay"]
    checks: list[DeratingCheck] = [_le(
        "975M.A.3.10.contact_current", "Relay contact current", actual,
        factor * rating, "A", "Iderated = Irated T R L",
        f"{actual:g} <= {rating:g} x {temperature_factor:g} x {rate_factor:g} x {load_factor:g}",
        source,
        ("The factor product is not capped at 1.0.",),
    )]
    if load == "A":
        checks.extend((
            _le(
                "975M.A.3.10.load_A.on_time", "Load A on-time at most 0.5 s",
                on_time, .5, "s", "ton <= 0.5 s", f"{on_time:g} <= 0.5",
                source,
            ),
            _ge(
                "975M.A.3.10.load_A.off_time",
                "Load A off-time at least its on-time",
                off_time, on_time, "s", "toff >= ton",
                f"{off_time:g} >= {on_time:g}", source,
            ),
        ))
    elif load == "B":
        checks.extend((
            _obligation(
                "975M.A.3.10.load_B.carry_only", "Load B carry-only service",
                is_carry_only, source, formula="load B is carry-only",
            ),
            _le(
                "975M.A.3.10.load_B.on_time", "Load B on-time at most 300 s",
                on_time, 300, "s", "ton <= 300 s", f"{on_time:g} <= 300",
                source,
            ),
            _ge(
                "975M.A.3.10.load_B.off_time",
                "Load B off-time at least its on-time",
                off_time, on_time, "s", "toff >= ton",
                f"{off_time:g} >= {on_time:g}", source,
            ),
        ))
    return _assessment("relay", f"load_{load}", checks,
        assumptions=(
            "Continuous temperatures use half-open versions of the source's integer-ended bands.",
        ),
        warnings=warnings,
    )


@dataclass(frozen=True)
class _ResistorCurve:
    specification: str
    plateau_factor: float
    plateau_temperature_c: float
    zero_power_temperature_c: float


RESISTOR_CURVES = MappingProxyType({
    "RCR": _ResistorCurve("MIL-R-39008", .60, 70, 110),
    "RNC": _ResistorCurve("MIL-R-55182", .60, 125, 155),
    "RNR": _ResistorCurve("MIL-R-55182", .60, 125, 155),
    "RNN": _ResistorCurve("MIL-R-55182", .60, 125, 155),
    "RLR": _ResistorCurve("MIL-R-39017", .30, 70, 94),
    "RBR": _ResistorCurve("MIL-R-39005", .60, 125, 137),
    "RTR": _ResistorCurve("MIL-R-39015", .60, 85, 125),
    "RWR": _ResistorCurve("MIL-R-39007", .60, 30, 175),
    "RER": _ResistorCurve("MIL-R-39009", .60, 30, 175),
    "RZO": _ResistorCurve("MIL-R-83401", .60, 70, 125),
    "RM": _ResistorCurve("MIL-R-55342", .60, 70, 118),
})


def resistor_power_factor(style: str, ambient_temperature_c: float) -> float:
    """Return the piecewise-linear power factor digitized from A.24–A.25."""
    key = str(style).strip().upper()
    if key not in RESISTOR_CURVES:
        raise UnsupportedMILSTD975MError(
            f"resistor style must be one of {sorted(RESISTOR_CURVES)}, got {style!r}"
        )
    temperature = _finite(ambient_temperature_c, "ambient_temperature_c")
    curve = RESISTOR_CURVES[key]
    if temperature > curve.zero_power_temperature_c:
        raise UnsupportedMILSTD975MError(
            f"{key} ambient temperature exceeds the graph endpoint "
            f"{curve.zero_power_temperature_c:g}°C"
        )
    if temperature <= curve.plateau_temperature_c:
        return curve.plateau_factor
    return curve.plateau_factor * (
        curve.zero_power_temperature_c - temperature
    ) / (
        curve.zero_power_temperature_c - curve.plateau_temperature_c
    )


def resistor(
    style: str,
    *,
    nominal_power_w: float,
    actual_power_w: float,
    ambient_temperature_c: float,
    specification_maximum_voltage: float,
    actual_voltage: float,
    active_element_resistance_ohm: float,
    waveform: str,
    rated_continuous_working_voltage_v: float | None = None,
    peak_power_w: float | None = None,
    low_duty_cycle: bool | None = None,
    continuous_overpower_fault_precluded: bool | None = None,
    steep_wavefront_compatibility_verified: bool | None = None,
    pulse_temperature_rise_acceptable_verified: bool | None = None,
    rcr_peak_power_caution_reviewed: bool | None = None,
) -> DeratingAssessment:
    key = str(style).strip().upper()
    waveform_key = _canonical(waveform, "waveform")
    if waveform_key not in {
        "dc", "regular_ac", "regular_waveform_ac", "pulse", "irregular",
        "irregular_waveform",
    }:
        raise UnsupportedMILSTD975MError(
            "waveform must be 'dc', 'regular_ac', 'pulse', or 'irregular'"
        )
    factor = resistor_power_factor(key, ambient_temperature_c)
    curve = RESISTOR_CURVES[key]
    nominal_power = _positive(nominal_power_w, "nominal_power_w")
    actual_power = _nonnegative(actual_power_w, "actual_power_w")
    rated_voltage = _positive(
        specification_maximum_voltage,
        "specification_maximum_voltage",
    )
    voltage = _nonnegative(actual_voltage, "actual_voltage")
    resistance = _positive(active_element_resistance_ohm, "active_element_resistance_ohm")
    allowed_power = factor * nominal_power
    allowed_voltage = min(.8 * rated_voltage, math.sqrt(allowed_power * resistance))
    source = _SOURCES["resistor"]
    power_check = _le(
        f"975M.A.3.11.{key}.power", "Resistor power", actual_power,
        allowed_power, "W", "Pallowed = f(T) Pnominal",
        f"{actual_power:g} <= {factor:g} x {nominal_power:g}", source,
        (f"{curve.specification}; curve anchors "
         f"({curve.plateau_temperature_c:g}°C, {curve.plateau_factor:g}) and "
         f"({curve.zero_power_temperature_c:g}°C, 0).",),
    )

    if waveform_key in {"dc", "regular_ac", "regular_waveform_ac"}:
        return _assessment("resistor", key, (
            power_check,
            _le(
                f"975M.A.3.11.{key}.voltage", "Resistor applied voltage",
                voltage, allowed_voltage, "V",
                "Vallowed = min(0.8 Vspec,max, sqrt(Pallowed Ractive))",
                f"{voltage:g} <= min(0.8 x {rated_voltage:g}, "
                f"sqrt({allowed_power:g} x {resistance:g}))",
                source,
            ),
        ), assumptions=(
            "The explicitly selected waveform is DC or regular-waveform AC.",
            "Ractive includes only the portion of the element active in the circuit.",
        ))

    general_source = _MIL_HDBK_978B_RESISTOR_GENERAL_SOURCE
    checks: list[DeratingCheck] = [
        power_check,
        _le(
            "978B.3.1.6.2.maximum_voltage",
            "Peak voltage does not exceed the resistor's permissible maximum",
            voltage, rated_voltage, "V",
            "Vpeak <= Vpermissible,max",
            f"{voltage:g} <= {rated_voltage:g}", general_source,
            (
                "The entered specification maximum is used as the general "
                "permissible-maximum-voltage value; subtype pulse limits are "
                "checked independently where MIL-HDBK-978B prints one.",
            ),
        ),
    ]

    for rule_id, description, value, formula in (
        (
            "978B.3.1.6.2.continuous_overpower_fault",
            "Circuit fault cannot apply continuous excessive resistor power",
            continuous_overpower_fault_precluded,
            "continuous excessive power from a circuit fault is precluded",
        ),
        (
            "978B.3.1.6.2.steep_wavefront",
            "Continuous steep-wavefront compatibility is verified",
            steep_wavefront_compatibility_verified,
            "continuous steep wavefronts cause no unexpected trouble",
        ),
        (
            "978B.3.1.6.2.pulse_temperature_rise",
            "Pulse duration and instantaneous temperature rise are acceptable",
            pulse_temperature_rise_acceptable_verified,
            "duty factor, peak power, and pulse duration produce acceptable heating",
        ),
    ):
        if value is None:
            checks.append(_not_evaluated(
                rule_id, description, actual=None, allowable=True, unit="",
                comparison="is", formula=formula, substitution="not supplied",
                source=general_source,
                notes=(
                    "MIL-HDBK-978B states an engineering verification duty "
                    "but does not supply a generic numerical acceptance model.",
                ),
            ))
        else:
            checks.append(_obligation(
                rule_id, description, value, general_source, formula=formula,
                notes=(
                    "A negative or missing external verification remains not "
                    "evaluated; it is not converted into a numerical failure.",
                ),
            ))

    pulse_peak_power = (
        None if peak_power_w is None
        else _nonnegative(peak_power_w, "peak_power_w")
    )
    pulse_rcwv = (
        None if rated_continuous_working_voltage_v is None
        else _positive(
            rated_continuous_working_voltage_v,
            "rated_continuous_working_voltage_v",
        )
    )
    is_low_duty = (
        None if low_duty_cycle is None
        else _boolean(low_duty_cycle, "low_duty_cycle")
    )
    caution_reviewed = (
        None if rcr_peak_power_caution_reviewed is None
        else _boolean(
            rcr_peak_power_caution_reviewed,
            "rcr_peak_power_caution_reviewed",
        )
    )
    is_irregular = waveform_key in {"irregular", "irregular_waveform"}

    if is_irregular:
        checks.append(_not_evaluated(
            "978B.3.1.6.2.irregular_waveform",
            "Irregular-waveform pulse envelope",
            actual=(
                f"Vpeak={voltage:g} V, Ppeak={pulse_peak_power:g} W"
                if pulse_peak_power is not None else f"Vpeak={voltage:g} V"
            ),
            allowable="manufacturer- or application-specific envelope",
            unit="", comparison="within", formula="manufacturer pulse envelope",
            substitution="no generic irregular-waveform envelope is printed",
            source=general_source,
            notes=(
                "MIL-HDBK-978B supplies general engineering duties but no "
                "generic numerical envelope for an irregular waveform.",
            ),
        ))
    elif key == "RCR":
        rcr_source = _MIL_HDBK_978B_RCR_PULSE_SOURCE
        if is_low_duty is True and pulse_rcwv is not None:
            checks.append(_le(
                "978B.3.2.5.2.RCR.peak_voltage",
                "RCR low-duty-cycle pulse peak voltage",
                voltage, 2 * pulse_rcwv, "V", "Vpeak <= 2 RCWV",
                f"{voltage:g} <= 2 x {pulse_rcwv:g}", rcr_source,
            ))
        else:
            checks.append(_not_evaluated(
                "978B.3.2.5.2.RCR.peak_voltage",
                "RCR low-duty-cycle pulse peak voltage",
                actual=voltage, allowable=(
                    None if pulse_rcwv is None
                    else f"2 x {pulse_rcwv:g} V"
                ),
                unit="V", comparison="<=", formula="Vpeak <= 2 RCWV",
                substitution=(
                    "low_duty_cycle and rated_continuous_working_voltage_v "
                    "must both be supplied"
                ), source=rcr_source,
                notes=(
                    "Section 3.2.5.2 states this factor only for low-duty-cycle "
                    "operation; no high-duty numerical factor is inferred.",
                ),
            ))
        peak_ratio = (
            None if pulse_peak_power is None
            else pulse_peak_power / nominal_power
        )
        caution_rule_id = "978B.3.2.5.2.RCR.peak_power_caution"
        caution_notes = (
            "The source prints an approximate 30-to-40-times caution, not a "
            "sharp acceptance limit. Perdura uses 30× only as the conservative "
            "lower edge below which that caution is plainly not triggered; a "
            "passing review check is not a peak-power safety certification.",
        )
        if peak_ratio is None:
            checks.append(_not_evaluated(
                caution_rule_id, "RCR peak-power caution review",
                actual=None, allowable="approximately 30–40 x normal power rating",
                unit="ratio", comparison="engineering caution",
                formula="Ppeak / Pnormal",
                substitution="peak_power_w not supplied", source=rcr_source,
                notes=caution_notes,
            ))
        elif peak_ratio <= 30:
            checks.append(DeratingCheck(
                caution_rule_id, "RCR peak-power caution review",
                peak_ratio, 30.0, "ratio", "<=", True, 30 - peak_ratio,
                "Ppeak / Pnormal <= 30 (conservative non-trigger region)",
                f"{pulse_peak_power:g} / {nominal_power:g} = {peak_ratio:g} <= 30",
                rcr_source, caution_notes,
            ))
        elif peak_ratio <= 40:
            checks.append(_not_evaluated(
                caution_rule_id, "RCR peak-power caution review",
                actual=peak_ratio,
                allowable="approximately 30–40 x normal power rating",
                unit="ratio", comparison="engineering caution",
                formula="Ppeak / Pnormal",
                substitution=(
                    f"{pulse_peak_power:g} / {nominal_power:g} = {peak_ratio:g}"
                ), source=rcr_source,
                notes=(*caution_notes,
                    "A value in the printed approximate 30–40× transition "
                    "cannot be assigned a binary result from this source.",
                ),
            ))
        elif caution_reviewed is True:
            checks.append(DeratingCheck(
                caution_rule_id, "RCR >40× engineering caution review",
                peak_ratio, "explicit engineering review", "ratio",
                "reviewed", True, None, "Ppeak / Pnormal; engineering review",
                f"{pulse_peak_power:g} / {nominal_power:g} = {peak_ratio:g}; "
                "rcr_peak_power_caution_reviewed = True",
                rcr_source, (*caution_notes,
                    "The pass records completion of the handbook's caution "
                    "review; it does not create an unprinted peak-power limit.",
                ),
            ))
        else:
            checks.append(_not_evaluated(
                caution_rule_id, "RCR >40× engineering caution review",
                actual=peak_ratio, allowable="explicit engineering review",
                unit="ratio", comparison="reviewed",
                formula="Ppeak / Pnormal; engineering review",
                substitution=(
                    f"{pulse_peak_power:g} / {nominal_power:g} = {peak_ratio:g}; "
                    f"rcr_peak_power_caution_reviewed = {caution_reviewed}"
                ), source=rcr_source,
                notes=(*caution_notes,
                    "Above the upper edge of the printed approximate range, "
                    "an explicit engineering-caution review is required.",
                ),
            ))
    elif key in {"RNC", "RNR", "RNN", "RLR"}:
        film_source = _MIL_HDBK_978B_FILM_PULSE_SOURCE
        if is_low_duty is True and pulse_rcwv is not None:
            checks.append(_le(
                f"978B.3.3.5.3.{key}.peak_voltage",
                f"{key} low-duty-cycle pulse peak voltage",
                voltage, 1.4 * pulse_rcwv, "V", "Vpeak <= 1.4 RCWV",
                f"{voltage:g} <= 1.4 x {pulse_rcwv:g}", film_source,
            ))
        else:
            checks.append(_not_evaluated(
                f"978B.3.3.5.3.{key}.peak_voltage",
                f"{key} low-duty-cycle pulse peak voltage",
                actual=voltage, allowable=(
                    None if pulse_rcwv is None
                    else f"1.4 x {pulse_rcwv:g} V"
                ),
                unit="V", comparison="<=", formula="Vpeak <= 1.4 RCWV",
                substitution=(
                    "low_duty_cycle and rated_continuous_working_voltage_v "
                    "must both be supplied"
                ), source=film_source,
                notes=(
                    "Section 3.3.5.3 states the voltage factor for low-duty "
                    "pulse circuits; high-duty or appreciable-width cases "
                    "need an application-specific temperature-rise analysis.",
                ),
            ))
        if pulse_peak_power is None:
            checks.append(_not_evaluated(
                f"978B.3.3.5.3.{key}.peak_power",
                f"{key} pulse peak power", actual=None,
                allowable=4 * nominal_power, unit="W", comparison="<=",
                formula="Ppeak <= 4 Pmaximum",
                substitution="peak_power_w not supplied", source=film_source,
            ))
        else:
            checks.append(_le(
                f"978B.3.3.5.3.{key}.peak_power",
                f"{key} pulse peak power", pulse_peak_power,
                4 * nominal_power, "W", "Ppeak <= 4 Pmaximum",
                f"{pulse_peak_power:g} <= 4 x {nominal_power:g}", film_source,
                (
                    "The nominal maximum power rating is used for Pmaximum; "
                    "the independent MIL-STD-975M average-power derating "
                    "check remains in force.",
                ),
            ))
    else:
        checks.append(_not_evaluated(
            f"978B.3.1.6.2.{key}.pulse_envelope",
            f"{key} pulse voltage and peak-power envelope",
            actual=(
                f"Vpeak={voltage:g} V, Ppeak={pulse_peak_power:g} W"
                if pulse_peak_power is not None else f"Vpeak={voltage:g} V"
            ),
            allowable="manufacturer- or application-specific envelope",
            unit="", comparison="within", formula="manufacturer pulse envelope",
            substitution="no exact style-specific envelope is printed in the reviewed sections",
            source=general_source,
            notes=(
                "No RCR or established-reliability fixed-film factor is "
                "borrowed for a different resistor construction.",
            ),
        ))

    return _assessment(
        "resistor", key, checks,
        assumptions=(
            "For pulse and irregular-waveform operation, actual_power_w is "
            "the time-average dissipated power and actual_voltage is the "
            "maximum pulse voltage.",
            "Ractive includes only the portion of the element active in the circuit.",
        ),
        warnings=(
            "MIL-STD-975M Appendix A.24 delegates pulse and irregular-waveform "
            "applications. These checks use only the reviewed MIL-HDBK-978B "
            "Volume I sections and leave qualitative or manufacturer-specific "
            "judgments not evaluated.",
        ),
    )


def switch(*_: Any, **__: Any) -> DeratingAssessment:
    """Fail closed: Appendix A reserves switch pages for future use."""
    raise UnsupportedMILSTD975MError(
        "Appendix A 3.12 contains no approved switches and no numerical switch rule"
    )


def fiber_optic(*_: Any, **__: Any) -> DeratingAssessment:
    """Fail closed: fiber optics are in the document scope but not Appendix A."""
    raise UnsupportedMILSTD975MError(
        "fiber optics/photonics appear in MIL-STD-975M's parts scope but have no Appendix A derating rule"
    )


def thermistor(
    coefficient: str,
    *,
    actual_power_w: float,
    actual_voltage: float,
    resistance_ohm: float,
    rated_power_w: float,
    detailed_specification_power_limit_w: float | None = None,
    dissipation_constant_w_per_c: float | None = None,
    part_temperature_c: float | None = None,
) -> DeratingAssessment:
    key = _canonical(coefficient, "coefficient")
    aliases = {
        "positive": "ptc", "positive_temperature_coefficient": "ptc",
        "negative": "ntc", "negative_temperature_coefficient": "ntc",
    }
    key = aliases.get(key, key)
    if key not in {"ptc", "ntc"}:
        raise UnsupportedMILSTD975MError("coefficient must be PTC or NTC")
    power = _nonnegative(actual_power_w, "actual_power_w")
    voltage = _nonnegative(actual_voltage, "actual_voltage")
    resistance = _positive(resistance_ohm, "resistance_ohm")
    rated_power = _positive(rated_power_w, "rated_power_w")
    source = _SOURCES["thermistor"]
    checks: list[DeratingCheck] = []
    warnings: tuple[str, ...] = ()
    if key == "ptc":
        limit = .5 * rated_power
        if detailed_specification_power_limit_w is not None:
            limit = min(limit, _positive(
                detailed_specification_power_limit_w,
                "detailed_specification_power_limit_w",
            ))
        checks.append(_le(
            "975M.A.3.13.ptc.power", "PTC thermistor power", power, limit, "W",
            "P <= min(0.5 Prated, Pdetailed-spec)", f"{power:g} <= {limit:g}", source,
        ))
    else:
        if dissipation_constant_w_per_c is None:
            checks.append(_not_evaluated(
                "975M.A.3.13.ntc.power", "NTC thermistor self-heat power",
                actual=power, allowable=None, unit="W", comparison="<=",
                formula="P <= 50 delta",
                substitution="dissipation_constant_w_per_c was not supplied",
                source=source,
            ))
        else:
            dissipation = _positive(
                dissipation_constant_w_per_c,
                "dissipation_constant_w_per_c",
            )
            limit = 50 * dissipation
            checks.append(_le(
                "975M.A.3.13.ntc.power", "NTC thermistor self-heat power",
                power, limit, "W", "P <= 50 delta",
                f"{power:g} <= 50 x {dissipation:g}", source,
            ))
        if part_temperature_c is None:
            checks.append(_not_evaluated(
                "975M.A.3.13.ntc.temperature", "NTC thermistor part temperature",
                actual=None, allowable=100, unit="°C", comparison="<=",
                formula="Tpart <= 100°C",
                substitution="part_temperature_c was not supplied", source=source,
            ))
        else:
            temperature = _finite(part_temperature_c, "part_temperature_c")
            checks.append(_le(
                "975M.A.3.13.ntc.temperature", "NTC thermistor part temperature",
                temperature, 100, "°C", "Tpart <= 100°C",
                f"{temperature:g} <= 100", source,
            ))
        warnings = (
            "The scanned graph is internally awkward with the direct 50×-dissipation-constant and 100°C prose caps; the prose and worked example govern.",
        )
    # Footnote (1) calls this 80% of the maximum rating; P is therefore the
    # nameplate rated power, not the already-applied power (which would make
    # the comparison circular) or the independently derated power ceiling.
    voltage_limit = .8 * math.sqrt(rated_power * resistance)
    checks.append(_le(
        f"975M.A.3.13.{key}.voltage", "Thermistor applied voltage", voltage,
        voltage_limit, "V", "Eapplication <= 0.8 sqrt(P R)",
        f"{voltage:g} <= 0.8 sqrt({rated_power:g} x {resistance:g})", source,
    ))
    return _assessment("thermistor", key, checks, warnings=warnings)


TRANSFORMER_CLASSES = MappingProxyType({
    ("MIL_T_27", "Q"): (85.0, 65.0),
    ("MIL_T_27", "R"): (105.0, 85.0),
    ("MIL_T_27", "S"): (130.0, 105.0),
    ("MIL_T_27", "V"): (155.0, 130.0),
    ("MIL_T_27", "T"): (170.0, 155.0),
    ("MIL_T_21038", "Q"): (85.0, 65.0),
    ("MIL_T_21038", "R"): (105.0, 85.0),
    ("MIL_T_21038", "S"): (130.0, 105.0),
    ("MIL_T_21038", "T"): (155.0, 130.0),
    ("MIL_T_21038", "U"): (170.0, 155.0),
})


def transformer(
    specification: str,
    insulation_class: str | None = None,
    *,
    custom_rated_temperature_c: float | None = None,
    rated_dwv: float,
    application_voltage: float,
    ambient_temperature_c: float,
    hot_resistance: float,
    initial_resistance: float,
    initial_ambient_temperature_c: float,
    shutdown_ambient_temperature_c: float,
) -> DeratingAssessment:
    spec = _canonical(specification, "specification").upper()
    temperature_delegation = None
    if spec in {"CUSTOM", "CUSTOM_MADE"}:
        rated_temperature = (
            None if custom_rated_temperature_c is None
            else _finite(custom_rated_temperature_c, "custom_rated_temperature_c")
        )
        if rated_temperature is None or not 85 <= rated_temperature <= 130:
            maximum_temperature = None
            temperature_delegation = (
                "custom transformer rated temperature must be within 85–130°C; "
                "this case requires project-parts-engineer guidance"
            )
        else:
            maximum_temperature = .75 * rated_temperature
        subtype = "custom"
        extra_warning = (
            "The source-defined custom-device rule multiplies a Celsius value by 0.75."
            if maximum_temperature is not None else temperature_delegation
        )
    else:
        class_key = str(insulation_class).strip().upper()
        table_key = (spec, class_key)
        if table_key not in TRANSFORMER_CLASSES:
            raise UnsupportedMILSTD975MError(
                f"unsupported transformer specification/class {specification!r}/{insulation_class!r}"
            )
        _, maximum_temperature = TRANSFORMER_CLASSES[table_key]
        subtype = f"{spec}:{class_key}"
        extra_warning = ""
    warnings = (
        "Criteria prose says operating voltage, but the table and example govern dielectric-withstanding voltage; normal winding voltage is not independently halved.",
    ) + ((extra_warning,) if extra_warning else ())
    return _winding_device(
        "transformer", subtype, maximum_temperature_c=maximum_temperature,
        rated_dwv=rated_dwv, application_voltage=application_voltage,
        application_current=None, rated_current=None,
        ambient_temperature_c=ambient_temperature_c,
        hot_resistance=hot_resistance, initial_resistance=initial_resistance,
        initial_ambient_temperature_c=initial_ambient_temperature_c,
        shutdown_ambient_temperature_c=shutdown_ambient_temperature_c,
        temperature_delegation=temperature_delegation,
        assumptions=(
            "A 10°C winding hot-spot allowance is included.",
            "Frequency and normal winding voltage are not independently derated.",
        ),
        warnings=warnings,
    )


def transistor(
    transistor_type: str,
    *,
    actual_power_w: float,
    rated_power_w: float,
    actual_current_a: float,
    rated_current_a: float,
    dc_voltage_v: float,
    peak_ac_voltage_v: float,
    transient_voltage_v: float,
    rated_voltage_v: float,
    junction_temperature_c: float,
    gate_source_voltage_v: float | None = None,
    rated_gate_source_voltage_v: float | None = None,
    safe_operating_area_verified: bool = False,
) -> DeratingAssessment:
    soa_verified = _boolean(
        safe_operating_area_verified, "safe_operating_area_verified"
    )
    key = _canonical(transistor_type, "transistor_type")
    aliases = {
        "bipolar_general_purpose": "bipolar", "bipolar_switching": "bipolar",
        "bipolar_power": "bipolar", "fet": "jfet",
    }
    key = aliases.get(key, key)
    if key not in {"bipolar", "jfet", "mosfet", "power_mosfet"}:
        raise UnsupportedMILSTD975MError(
            "transistor_type must be bipolar, JFET, MOSFET, or power MOSFET"
        )
    power = _nonnegative(actual_power_w, "actual_power_w")
    power_rating = _positive(rated_power_w, "rated_power_w")
    current = _nonnegative(actual_current_a, "actual_current_a")
    current_rating = _positive(rated_current_a, "rated_current_a")
    dc = _nonnegative(dc_voltage_v, "dc_voltage_v")
    ac = _nonnegative(peak_ac_voltage_v, "peak_ac_voltage_v")
    transient = _nonnegative(transient_voltage_v, "transient_voltage_v")
    voltage_rating = _positive(rated_voltage_v, "rated_voltage_v")
    combined_voltage = dc + ac + transient
    temperature = _finite(junction_temperature_c, "junction_temperature_c")
    source = _SOURCES["transistor"]
    checks: list[DeratingCheck] = [
        _le("975M.A.3.15.power", "Transistor power", power, .5 * power_rating,
            "W", "P <= 0.50 Prated", f"{power:g} <= 0.5 x {power_rating:g}", source),
        _le("975M.A.3.15.current", "Transistor current", current, .75 * current_rating,
            "A", "I <= 0.75 Irated", f"{current:g} <= 0.75 x {current_rating:g}", source),
        _le("975M.A.3.15.voltage", "Worst-case combined transistor voltage",
            combined_voltage, .75 * voltage_rating, "V",
            "VDC + VAC,peak + Vtransient <= 0.75 Vrated",
            f"{dc:g} + {ac:g} + {transient:g} <= 0.75 x {voltage_rating:g}", source),
        _le("975M.A.3.15.junction_temperature", "Junction temperature", temperature,
            125, "°C", "Tj <= 125°C", f"{temperature:g} <= 125", source),
    ]
    if key == "power_mosfet":
        if gate_source_voltage_v is None or rated_gate_source_voltage_v is None:
            checks.append(_not_evaluated(
                "975M.A.3.15.power_mosfet.vgs",
                "Power MOSFET gate-source voltage",
                actual=gate_source_voltage_v, allowable=None, unit="V",
                comparison="<=", formula="VGS <= 0.60 VGS,rated",
                substitution="actual and rated gate-source voltages are both required",
                source=source,
            ))
        else:
            gate = _nonnegative(gate_source_voltage_v, "gate_source_voltage_v")
            gate_rating = _positive(
                rated_gate_source_voltage_v,
                "rated_gate_source_voltage_v",
            )
            checks.append(_le(
                "975M.A.3.15.power_mosfet.vgs",
                "Power MOSFET gate-source voltage",
                gate, .6 * gate_rating, "V", "VGS <= 0.60 VGS,rated",
                f"{gate:g} <= 0.6 x {gate_rating:g}", source,
            ))
    checks.append(_obligation(
        "975M.A.3.15.safe_operating_area",
        "Manufacturer safe-operating-area envelope verification",
        soa_verified, source,
        formula="all operating points lie within the manufacturer SOA envelope",
    ))
    assumptions = (
        ("The manufacturer safe-operating-area envelope was independently verified.",)
        if soa_verified else ()
    )
    return _assessment("transistor", key, checks, assumptions=assumptions)


WIRE_SINGLE_CURRENT_A = MappingProxyType({
    "30": 1.3, "28": 1.8, "26": 2.5, "24": 3.3, "22": 4.5,
    "20": 6.5, "18": 9.2, "16": 13.0, "14": 19.0, "12": 25.0,
    "10": 33.0, "8": 44.0, "6": 60.0, "4": 81.0, "2": 108.0,
    "0": 147.0, "00": 169.0,
})

WIRE_INSULATION_FACTORS = MappingProxyType({
    200: 1.0,
    150: .80,
    135: .70,
    105: .50,
})


def wire_and_cable(
    awg: str | int,
    *,
    application_current_a: float,
    number_of_wires: int,
    insulation_temperature_rating_c: int,
    application_voltage_v: float,
    dielectric_withstanding_voltage_rating_v: float,
    ambient_temperature_c: float = 70.0,
    pressure_torr: float = 1e-6,
    round_single_conductors: bool = True,
    helically_wound_bundle: bool = True,
) -> DeratingAssessment:
    round_conductors = _boolean(
        round_single_conductors, "round_single_conductors"
    )
    helical_bundle = _boolean(
        helically_wound_bundle, "helically_wound_bundle"
    )
    gauge = str(awg).strip()
    if gauge not in WIRE_SINGLE_CURRENT_A:
        raise UnsupportedMILSTD975MError(
            f"AWG must be one of {list(WIRE_SINGLE_CURRENT_A)}, got {awg!r}"
        )
    count = _integer(number_of_wires, "number_of_wires", minimum=1)
    insulation = _integer(
        insulation_temperature_rating_c,
        "insulation_temperature_rating_c",
        minimum=1,
    )
    if insulation not in WIRE_INSULATION_FACTORS:
        raise UnsupportedMILSTD975MError(
            "wire insulation rating must be 105, 135, 150, or 200°C"
        )
    ambient = _finite(ambient_temperature_c, "ambient_temperature_c")
    pressure = _positive(pressure_torr, "pressure_torr")
    if count == 1:
        bundle_factor = 1.0
    elif count <= 15:
        bundle_factor = (29 - count) / 28
    else:
        bundle_factor = .5
    insulation_factor = WIRE_INSULATION_FACTORS[insulation]
    single_current = WIRE_SINGLE_CURRENT_A[gauge]
    allowed_current = single_current * bundle_factor * insulation_factor
    current = _nonnegative(application_current_a, "application_current_a")
    voltage = _nonnegative(application_voltage_v, "application_voltage_v")
    dwv = _positive(
        dielectric_withstanding_voltage_rating_v,
        "dielectric_withstanding_voltage_rating_v",
    )
    source = _SOURCES["wire_cable"]
    ampacity_applicable = (
        ambient == 70
        and 1e-9 <= pressure <= 1e-6
        and round_conductors
        and helical_bundle
    )
    if ampacity_applicable:
        current_check = _le(
            "975M.A.3.16.current", "Wire application current", current,
            allowed_current, "A", "Iallowed = Isw Fbundle Finsulation",
            f"{current:g} <= {single_current:g} x {bundle_factor:g} x {insulation_factor:g}",
            source,
        )
    else:
        current_check = _not_evaluated(
            "975M.A.3.16.current", "Wire application current",
            actual=current, allowable=allowed_current, unit="A", comparison="<=",
            formula="Iallowed = Isw Fbundle Finsulation",
            substitution=(
                f"diagnostic table value: {current:g} <= {single_current:g} x "
                f"{bundle_factor:g} x {insulation_factor:g}; applicability incomplete"
            ),
            source=source,
            notes=(
                "The tabulated ampacity is not adjudicated unless every source applicability condition is satisfied.",
            ),
        )
    checks: list[DeratingCheck] = [
        current_check,
        _ge(
            "975M.A.3.16.dwv", "Wire dielectric-withstanding-voltage rating",
            dwv, 2 * voltage, "V", "VDWV,rated >= 2 Vapplication",
            f"{dwv:g} >= 2 x {voltage:g}", source,
        ),
    ]
    checks.extend((
        DeratingCheck(
            "975M.A.3.16.ampacity_temperature_applicability",
            "Wire-current-table ambient temperature applicability",
            ambient, 70.0, "°C", "==", True if ambient == 70 else None, None,
            "Tambient = 70°C for Appendix A table applicability",
            f"Tambient = {ambient:g}°C", source,
        ),
        DeratingCheck(
            "975M.A.3.16.hard_vacuum_applicability",
            "Wire-current-table hard-vacuum applicability",
            pressure, "10^-9 to 10^-6", "torr", "within",
            True if 1e-9 <= pressure <= 1e-6 else None, None,
            "10^-9 <= pressure <= 10^-6 torr",
            f"pressure = {pressure:g} torr", source,
        ),
        _obligation(
            "975M.A.3.16.round_single_conductors",
            "Round single-conductor construction", round_conductors, source,
            formula="conductors are round and single",
        ),
        _obligation(
            "975M.A.3.16.helical_bundle",
            "Helically wound bundle construction", helical_bundle, source,
            formula="bundle is helically wound",
        ),
    ))
    assumptions = (
        (
            "The conductors are round, single, and helically bundled at +70°C "
            "in hard vacuum."
        ),
    ) if ampacity_applicable else ()
    return _assessment(
        "wire_cable", f"AWG_{gauge}", checks, assumptions=assumptions,
    )


def appendices_without_numerical_rules() -> tuple[str, ...]:
    """Return deliberately unsupported Appendix/scope families."""
    return ("crystal", "switch", "fiber_optic_photonics")


_FAMILY_ALIASES = MappingProxyType({
    "capacitors": "capacitor",
    "connectors": "connector",
    "crystals": "crystal",
    "crystal_oscillator": "crystal",
    "crystal_oscillators": "crystal",
    "diodes": "diode",
    "emi_filter": "filter",
    "filters": "filter",
    "inductors": "inductor",
    "linear_ic": "linear_microcircuit",
    "linear_ics": "linear_microcircuit",
    "digital_ic": "digital_microcircuit",
    "digital_ics": "digital_microcircuit",
    "protective_devices": "protective_device",
    "fuse": "protective_device",
    "fuses": "protective_device",
    "circuit_breaker": "protective_device",
    "circuit_breakers": "protective_device",
    "relays": "relay",
    "resistors": "resistor",
    "switches": "switch",
    "thermistors": "thermistor",
    "transformers": "transformer",
    "transistors": "transistor",
    "wire": "wire_cable",
    "wires": "wire_cable",
    "wire_and_cable": "wire_cable",
    "fiber_optic": "fiber_optic",
    "fiber_optics": "fiber_optic",
    "photonics": "fiber_optic",
})


def assess(family: str, params: Mapping[str, Any]) -> DeratingAssessment:
    """Dispatch one independent MIL-STD-975M Appendix A assessment.

    ``params`` is copied before dispatch, so a caller can retain it as a
    separate, unmodified ``derating_params`` bag.  Protective devices use a
    ``device_type`` value of ``"fuse"`` or ``"circuit_breaker"``.  This
    dispatcher never falls through to Perdura's three-level custom profile.
    """
    if not isinstance(params, Mapping):
        raise ValueError("params must be a mapping")
    requested_key = _canonical(family, "family")
    key = _FAMILY_ALIASES.get(requested_key, requested_key)
    payload = dict(params)

    variant_name = {
        "capacitor": "capacitor",
        "connector": "connector",
        "crystal": "crystal_or_oscillator",
        "diode": "diode",
        "filter": "emi_filter",
        "inductor": "inductor",
        "linear_microcircuit": "linear_microcircuit",
        "digital_microcircuit": "digital_microcircuit",
        "relay": "relay",
        "resistor": "resistor",
        "thermistor": "thermistor",
        "transformer": "transformer",
        "transistor": "transistor",
        "wire_cable": "wire_and_cable",
    }.get(key)
    if variant_name is not None:
        _require_explicit_schema_inputs(variant_name, payload)

    if key == "capacitor":
        return capacitor(**payload)
    if key == "connector":
        return connector(**payload)
    if key == "crystal":
        if "kind" not in payload:
            payload["kind"] = (
                "crystal_oscillator"
                if requested_key in {"crystal_oscillator", "crystal_oscillators"}
                else "crystal"
            )
        return crystal_or_oscillator(**payload)
    if key == "diode":
        return diode(**payload)
    if key == "filter":
        return emi_filter(**payload)
    if key == "inductor":
        return inductor(**payload)
    if key == "linear_microcircuit":
        return linear_microcircuit(**payload)
    if key == "digital_microcircuit":
        return digital_microcircuit(**payload)
    if key == "protective_device":
        implied = (
            requested_key
            if requested_key in {"fuse", "fuses", "circuit_breaker", "circuit_breakers"}
            else None
        )
        device_type = payload.pop("device_type", payload.pop("kind", implied))
        if device_type is None:
            raise UnsupportedMILSTD975MError(
                "protective_device requires device_type 'fuse' or 'circuit_breaker'"
            )
        device_key = _canonical(device_type, "device_type")
        if device_key in {"fuse", "fuses"}:
            _require_explicit_schema_inputs("fuse", payload)
            return fuse(**payload)
        if device_key in {"circuit_breaker", "circuit_breakers", "breaker"}:
            _require_explicit_schema_inputs("circuit_breaker", payload)
            return circuit_breaker(**payload)
        raise UnsupportedMILSTD975MError(
            "protective_device device_type must be 'fuse' or 'circuit_breaker'"
        )
    if key == "relay":
        return relay(**payload)
    if key == "resistor":
        return resistor(**payload)
    if key == "switch":
        return switch(**payload)
    if key == "thermistor":
        return thermistor(**payload)
    if key == "transformer":
        return transformer(**payload)
    if key == "transistor":
        return transistor(**payload)
    if key == "wire_cable":
        return wire_and_cable(**payload)
    if key == "fiber_optic":
        return fiber_optic(**payload)
    raise UnsupportedMILSTD975MError(
        f"family must be one of {sorted(FAMILY_CATALOG)}, got {family!r}"
    )


_SCHEMA_VARIANTS = MappingProxyType({
    "capacitor": (("capacitor", capacitor),),
    "connector": (("connector", connector),),
    "crystal": (("crystal_or_oscillator", crystal_or_oscillator),),
    "diode": (("diode", diode),),
    "filter": (("emi_filter", emi_filter),),
    "inductor": (("inductor", inductor),),
    "linear_microcircuit": (("linear_microcircuit", linear_microcircuit),),
    "digital_microcircuit": (("digital_microcircuit", digital_microcircuit),),
    "protective_device": (("fuse", fuse), ("circuit_breaker", circuit_breaker)),
    "relay": (("relay", relay),),
    "resistor": (("resistor", resistor),),
    "switch": (),
    "thermistor": (("thermistor", thermistor),),
    "transformer": (("transformer", transformer),),
    "transistor": (("transistor", transistor),),
    "wire_cable": (("wire_and_cable", wire_and_cable),),
})

_SCHEMA_CHOICES = MappingProxyType({
    ("capacitor", "style"): tuple(CAPACITOR_RULES),
    ("crystal_or_oscillator", "kind"): ("crystal", "crystal_oscillator"),
    ("diode", "diode_type"): tuple(_DIODE_TYPES),
    ("inductor", "specification"): ("MIL_C_39010", "MIL_C_15305", "CUSTOM"),
    ("inductor", "insulation_class"): ("O", "A", "B", "F"),
    ("linear_microcircuit", "device_type"): tuple(LINEAR_MICROCIRCUIT_RULES),
    ("digital_microcircuit", "technology"): tuple(DIGITAL_MICROCIRCUIT_RULES),
    ("circuit_breaker", "load_type"): tuple(CIRCUIT_BREAKER_FACTORS),
    ("relay", "load_class"): ("A", "B", "C"),
    ("resistor", "style"): tuple(RESISTOR_CURVES),
    ("resistor", "waveform"): ("dc", "regular_ac", "pulse", "irregular"),
    ("thermistor", "coefficient"): ("PTC", "NTC"),
    ("transformer", "specification"): ("MIL_T_27", "MIL_T_21038", "CUSTOM"),
    ("transformer", "insulation_class"): ("Q", "R", "S", "T", "U", "V"),
    ("transistor", "transistor_type"): ("bipolar", "jfet", "mosfet", "power_mosfet"),
    ("wire_and_cable", "awg"): tuple(WIRE_SINGLE_CURRENT_A),
    ("wire_and_cable", "insulation_temperature_rating_c"): tuple(WIRE_INSULATION_FACTORS),
})


# This metadata is deliberately maintained beside the executable functions.
# Function signatures describe transport types, but cannot express the
# subtype-dependent inputs and affirmative verification duties in Appendix A.
# Keep those duties machine-readable so a UI does not present an optional
# Python default as though it were a source-authorized engineering assumption.
_SCHEMA_VARIANT_GUIDANCE: dict[str, dict[str, Any]] = {
    "capacitor": {
        "application": (
            "Use the worst-case DC polarizing voltage plus peak AC ripple. "
            "The rated voltage must already include detailed-specification "
            "environmental and operating-condition rating factors."
        ),
        "verification_obligations": [
            "CSR, CSS, and CWR styles require an effective-circuit-resistance check; below 1 Ω/V requires recorded parts-specialist approval.",
            "For CCR, CKR, or CDR applications below 10 Vdc, the implementation also verifies the 100 Vdc minimum rating.",
        ],
    },
    "connector": {
        "application": "Use sea-level dielectric-withstanding voltage and worst-case insert temperature, including resistive heating.",
        "verification_obligations": [
            "Both printed worked-example comparisons are strict: equality does not pass."
        ],
    },
    "crystal_or_oscillator": {
        "application": "Standalone crystals are not approved by Appendix A; only the crystal-oscillator path is executable.",
        "verification_obligations": [
            "Every component inside the oscillator must be independently derated.",
            "The 75% crystal-current exception requires an explicitly verified startup-time-critical application.",
        ],
    },
    "diode": {
        "application": "Select the exact diode subtype; the required actual/rated stress pairs change with that subtype.",
        "verification_obligations": [
            "Every applicable subtype row must be supplied; omitted stress pairs are not treated as zero."
        ],
    },
    "emi_filter": {
        "application": "Current and voltage ratings are rated operating values, not absolute maximum ratings.",
        "verification_obligations": [],
    },
    "inductor": {
        "application": "Use the winding resistance-rise method and the specification-specific insulation class, or select CUSTOM explicitly.",
        "verification_obligations": [
            "MIL-C-39010 supports classes A, B, and F; MIL-C-15305 supports O, A, and B.",
            "Shutdown ambient must be within 5°C of initial ambient; a 10°C winding hot-spot allowance is added.",
            "A custom rated temperature must be 85–130°C; outside that range is delegated to the project parts engineer.",
        ],
    },
    "linear_microcircuit": {
        "application": "Supply every table row applicable to the selected linear-device subtype as an actual/rated ratio.",
        "verification_obligations": [
            "For subtypes with an AC-input row, actual input voltage and actual supply voltage are also compared directly."
        ],
    },
    "digital_microcircuit": {
        "application": "Technology selects the applicable supply, clock, and open-output rows; input voltage is always compared with supply voltage.",
        "verification_obligations": [
            "Do not infer an absent input voltage as 0 V; both actual input and actual supply voltage are required.",
            "Radiation environments require affirmative verification of any additional output-current/fanout derating.",
        ],
    },
    "fuse": {
        "application": "The tabulated factors apply only from 0.125 A through 15 A and include the stated temperature adjustment.",
        "verification_obligations": [
            "PCB mounting and conformal coating must each be affirmatively verified; otherwise this source model is inapplicable."
        ],
    },
    "circuit_breaker": {
        "application": "The current factor is selected from the actual load type and applied to the maximum rated resistive contact current.",
        "verification_obligations": [
            "The applicable vendor trip current/time curve must be verified.",
            "Capacitive loads require series resistance; thermal breakers require a separate ambient-temperature/trip-time verification.",
        ],
    },
    "relay": {
        "application": "The contact-current limit is the product of temperature, cycle-rate, and load-class factors.",
        "verification_obligations": [
            "Load A requires on-time ≤ 0.5 s and off-time ≥ on-time.",
            "Load B requires carry-only service, on-time ≤ 300 s, and off-time ≥ on-time; load C is limited use.",
        ],
    },
    "resistor": {
        "application": (
            "Select the waveform explicitly. DC and regular AC use Appendix "
            "A.24 directly. Pulse and irregular waveforms retain Appendix "
            "A.24 average-power derating and add only the reviewed, applicable "
            "MIL-HDBK-978B Volume I duties and subtype limits."
        ),
        "verification_obligations": [
            (
                "Active-element resistance must cover only the element portion "
                "active in the circuit."
            ),
            (
                "Pulse/intermittent applications must address permissible "
                "maximum voltage, continuous-overpower faults, average power, "
                "and continuous steep wavefronts."
            ),
            (
                "RCR low-duty pulses use 2× RCWV; RNC/RNR/RNN/RLR use 1.4× "
                "RCWV and a 4× maximum-rating peak-power ceiling."
            ),
            (
                "For the RCR approximate 30–40× caution, ≤30× is outside the "
                "conservative trigger region, 30–40× remains source-ambiguous, "
                "and >40× requires an explicit caution review."
            ),
            (
                "Manufacturer-specific and irregular-waveform envelopes "
                "remain not evaluated."
            ),
        ],
    },
    "thermistor": {
        "application": "Select PTC or NTC; both paths require the nameplate rated power for the voltage limit.",
        "verification_obligations": [
            "NTC additionally requires dissipation constant and part temperature; the prose and worked example govern the ambiguous scanned graph."
        ],
    },
    "transformer": {
        "application": "Use the winding resistance-rise method and the applicable MIL-T-27 or MIL-T-21038 insulation class, or select CUSTOM explicitly.",
        "verification_obligations": [
            "MIL-T-27 supports Q, R, S, V, and T; MIL-T-21038 supports Q, R, S, T, and U.",
            "Shutdown ambient must be within 5°C of initial ambient; a 10°C winding hot-spot allowance is added.",
            "The source table/example use dielectric-withstanding voltage; normal winding voltage and frequency are not independently derated.",
        ],
    },
    "transistor": {
        "application": "Use worst-case combined DC, peak AC, and transient voltage plus power, current, and junction temperature.",
        "verification_obligations": [
            "The manufacturer safe-operating-area envelope must be affirmatively and independently verified.",
            "Power MOSFETs additionally require actual and rated gate-source voltage.",
        ],
    },
    "wire_and_cable": {
        "application": "The ampacity table applies only at +70°C in hard vacuum (10^-9–10^-6 torr) to round single conductors in a helical bundle.",
        "verification_obligations": [
            "Ambient, pressure, conductor construction, and bundle construction must be explicitly confirmed; ribbon/flat or non-helical cases are delegated.",
            "Insulation temperature rating must be exactly 105, 135, 150, or 200°C.",
        ],
    },
}


_SCHEMA_FIELD_GUIDANCE: dict[tuple[str, str], dict[str, Any]] = {
    ("capacitor", "peak_ac_ripple_voltage"): {
        "help": "Enter worst-case peak AC ripple; use 0 only after confirming that no ripple is present.",
    },
    ("capacitor", "effective_circuit_resistance_ohm_per_volt"): {
        "required_when": "Style is CSR, CSS, or CWR.",
        "help": "Effective circuit resistance divided by application voltage, in Ω/V.",
    },
    ("capacitor", "parts_specialist_approved"): {
        "required_when": "Style is CSR, CSS, or CWR and effective circuit resistance is below 1 Ω/V.",
        "help": "Select Yes only when the below-1 Ω/V exception has documented parts-specialist approval.",
    },
    ("crystal_or_oscillator", "actual_crystal_current"): {
        "required_when": "Kind is crystal_oscillator; standalone crystals are unsupported.",
    },
    ("crystal_or_oscillator", "rated_crystal_current"): {
        "required_when": "Kind is crystal_oscillator; standalone crystals are unsupported.",
    },
    ("crystal_or_oscillator", "startup_time_critical"): {
        "help": "Select Yes only for the source's startup-time-critical 75% current exception; otherwise the 50% limit applies.",
    },
    ("crystal_or_oscillator", "individual_components_verified"): {
        "required_when": "Kind is crystal_oscillator; this must be Yes for evaluation.",
        "help": "Affirms that every oscillator component was independently assessed against its applicable derating rule.",
    },
    ("diode", "stresses"): {
        "required_when": "The selected diode subtype has table stress rows (all except voltage_reference).",
        "help": (
            "JSON values are [actual, rated]. Required keys: general-purpose/rectifier/switching/PIN/Schottky/thyristor: "
            "piv, surge_current, forward_current; varactor: power, reverse_voltage, forward_current; "
            "voltage_regulator: power; zener or bidirectional suppressor: power_dissipation; "
            "FET current regulator: peak_operating_voltage. Voltage reference uses the dedicated zener-current fields."
        ),
    },
    ("diode", "zener_current_actual"): {
        "required_when": "Diode Type is voltage_regulator or voltage_reference.",
    },
    ("diode", "zener_current_maximum"): {
        "required_when": "Diode Type is voltage_regulator.",
    },
    ("diode", "zener_current_nominal"): {
        "required_when": "Diode Type is voltage_regulator.",
    },
    ("diode", "manufacturer_zener_current"): {
        "required_when": "Diode Type is voltage_reference.",
    },
    ("inductor", "insulation_class"): {
        "required_when": "Specification is MIL_C_39010 or MIL_C_15305.",
        "help": "Valid pairs: MIL_C_39010 A/B/F; MIL_C_15305 O/A/B.",
    },
    ("inductor", "custom_rated_temperature_c"): {
        "required_when": "Specification is CUSTOM; permitted range is 85–130°C.",
    },
    ("inductor", "shutdown_ambient_temperature_c"): {
        "help": "Must be within 5°C of Initial Ambient Temperature for the resistance-rise method.",
    },
    ("linear_microcircuit", "stress_ratios"): {
        "help": (
            "JSON object of dimensionless actual/rated ratios. Operational-amplifier example with all six required keys: "
            "{\"supply_voltage\":0.80,\"power_dissipation\":0.75,\"ac_input_voltage\":1.00,"
            "\"output_voltage\":1.00,\"output_current\":0.80,\"short_circuit_output_current\":0.90}. "
            "Also enter actual_input_voltage and actual_supply_voltage for that example. Comparator/sense amplifier use "
            "open_collector_output_voltage instead of output_voltage; voltage regulator requires input_output_differential_voltage, "
            "power_dissipation, output_current, short_circuit_output_current; analog switch requires supply_voltage, power_dissipation, output_current."
        ),
    },
    ("linear_microcircuit", "actual_input_voltage"): {
        "required_when": "Device Type is operational_amplifier, differential_amplifier, comparator, sense_amplifier, or current_amplifier.",
    },
    ("linear_microcircuit", "actual_supply_voltage"): {
        "required_when": "Device Type is operational_amplifier, differential_amplifier, comparator, sense_amplifier, or current_amplifier.",
    },
    ("digital_microcircuit", "clock_frequency_ratio"): {
        "required_when": "Technology is MOS, any listed CMOS family, line_driver_receiver, or gate_array_bipolar_mos; bipolar has no clock row.",
    },
    ("digital_microcircuit", "open_collector_or_drain"): {
        "help": "Select Yes only when the application uses an open collector/drain output; unsupported technology/output combinations fail closed.",
    },
    ("digital_microcircuit", "open_collector_output_voltage_ratio"): {
        "required_when": "Open Collector Or Drain is Yes and Technology is bipolar, line_driver_receiver, or gate_array_bipolar_mos.",
    },
    ("digital_microcircuit", "ttl_open_collector"): {
        "required_when": "Technology is bipolar and Open Collector Or Drain is Yes; select Yes for the TTL 75% exception.",
    },
    ("digital_microcircuit", "actual_input_voltage"): {
        "help": "Worst-case input voltage; required because Appendix A checks that input does not exceed supply.",
        "require_explicit": True,
    },
    ("digital_microcircuit", "radiation_environment"): {
        "help": "Explicitly identify whether additional radiation derating applies to this application.",
        "require_explicit": True,
    },
    ("digital_microcircuit", "radiation_derating_verified"): {
        "required_when": "Radiation Environment is Yes; this must be Yes for evaluation.",
    },
    ("fuse", "pcb_mounted"): {
        "help": "This source model applies only when PCB mounting is verified.",
        "require_explicit": True,
    },
    ("fuse", "conformally_coated"): {
        "help": "This source model applies only when conformal coating is verified.",
        "require_explicit": True,
    },
    ("circuit_breaker", "series_resistance_used"): {
        "required_when": "Load Type is capacitive; this must be Yes for evaluation.",
    },
    ("circuit_breaker", "vendor_trip_curve_verified"): {
        "help": "Must be Yes: verify the applicable vendor trip current/time curve.",
        "require_explicit": True,
    },
    ("circuit_breaker", "thermal_breaker"): {
        "help": "Explicitly identify whether the device is a thermal circuit breaker.",
        "require_explicit": True,
    },
    ("circuit_breaker", "thermal_effects_verified"): {
        "required_when": "Thermal Breaker is Yes; this must be Yes for evaluation.",
    },
    ("relay", "load_class"): {
        "help": "A: short switching pulse; B: carry-only; C: other/limited-use load.",
    },
    ("relay", "on_time_seconds"): {
        "help": "Load A requires ≤0.5 s; load B requires ≤300 s.",
    },
    ("relay", "off_time_seconds"): {
        "help": "For load A or B, off-time must be at least the on-time.",
    },
    ("relay", "carry_only"): {
        "required_when": "Load Class is B; this must be Yes for evaluation.",
    },
    ("resistor", "waveform"): {
        "help": (
            "Required engineering selection; Perdura never assumes DC. Pulse "
            "means a defined pulse application, while irregular retains only "
            "the general handbook duties and a not-evaluated manufacturer envelope."
        ),
        "require_explicit": True,
    },
    ("resistor", "actual_power_w"): {
        "help": (
            "For pulse or irregular operation, enter time-average dissipated "
            "power. Peak power is entered separately."
        ),
    },
    ("resistor", "actual_voltage"): {
        "help": (
            "For pulse or irregular operation, enter the maximum pulse voltage."
        ),
    },
    ("resistor", "specification_maximum_voltage"): {
        "help": (
            "The resistor's permissible maximum voltage from its applicable "
            "specification; checked independently of any subtype pulse multiplier."
        ),
    },
    ("resistor", "rated_continuous_working_voltage_v"): {
        "required_when": (
            "Waveform is pulse and Style is RCR, RNC, RNR, RNN, or RLR."
        ),
        "help": "RCWV from the applicable resistor specification, in volts.",
    },
    ("resistor", "peak_power_w"): {
        "required_when": (
            "Waveform is pulse. RNC/RNR/RNN/RLR use the exact 4× ceiling; "
            "RCR displays the non-binary approximately 30–40× caution."
        ),
    },
    ("resistor", "low_duty_cycle"): {
        "required_when": (
            "Waveform is pulse and Style is RCR, RNC, RNR, RNN, or RLR."
        ),
        "help": (
            "The printed RCWV multipliers are limited to low-duty-cycle pulse "
            "applications. No numerical high-duty multiplier is inferred."
        ),
    },
    ("resistor", "continuous_overpower_fault_precluded"): {
        "required_when": "Waveform is pulse or irregular.",
        "help": (
            "Affirm only after verifying that no circuit failure can impose "
            "continuous excessive power on the resistor."
        ),
    },
    ("resistor", "steep_wavefront_compatibility_verified"): {
        "required_when": "Waveform is pulse or irregular.",
        "help": (
            "Affirm only after verifying that repeated steep wavefronts cause "
            "no unexpected resistor behavior."
        ),
    },
    ("resistor", "pulse_temperature_rise_acceptable_verified"): {
        "required_when": "Waveform is pulse or irregular.",
        "help": (
            "Affirm only after an application-specific review of duty factor, "
            "pulse width, peak power, and instantaneous temperature rise."
        ),
    },
    ("resistor", "rcr_peak_power_caution_reviewed"): {
        "required_when": (
            "Waveform is pulse, Style is RCR, and peak power is greater than "
            "40× nominal power."
        ),
        "help": (
            "Affirms completion of the handbook's engineering caution review. "
            "It does not create a numerical peak-power acceptance limit. "
            "Ratios above 30× through 40× remain not evaluated because the "
            "source boundary is approximate."
        ),
    },
    ("thermistor", "detailed_specification_power_limit_w"): {
        "required_when": "Coefficient is PTC and the detailed specification supplies a lower power limit.",
    },
    ("thermistor", "dissipation_constant_w_per_c"): {
        "required_when": "Coefficient is NTC.",
    },
    ("thermistor", "part_temperature_c"): {
        "required_when": "Coefficient is NTC.",
    },
    ("transformer", "insulation_class"): {
        "required_when": "Specification is MIL_T_27 or MIL_T_21038.",
        "help": "Valid pairs: MIL_T_27 Q/R/S/V/T; MIL_T_21038 Q/R/S/T/U.",
    },
    ("transformer", "custom_rated_temperature_c"): {
        "required_when": "Specification is CUSTOM; permitted range is 85–130°C.",
    },
    ("transformer", "shutdown_ambient_temperature_c"): {
        "help": "Must be within 5°C of Initial Ambient Temperature for the resistance-rise method.",
    },
    ("transistor", "gate_source_voltage_v"): {
        "required_when": "Transistor Type is power_mosfet.",
    },
    ("transistor", "rated_gate_source_voltage_v"): {
        "required_when": "Transistor Type is power_mosfet.",
    },
    ("transistor", "safe_operating_area_verified"): {
        "help": "Must be Yes: independently verify the manufacturer safe-operating-area envelope.",
        "require_explicit": True,
    },
    ("wire_and_cable", "ambient_temperature_c"): {
        "help": "The Appendix A ampacity table is defined only at exactly +70°C.",
        "require_explicit": True,
    },
    ("wire_and_cable", "pressure_torr"): {
        "help": "Must be within the table's hard-vacuum range of 10^-9 through 10^-6 torr.",
        "require_explicit": True,
    },
    ("wire_and_cable", "round_single_conductors"): {
        "help": "Must be Yes; ribbon/flat or other conductor constructions are delegated.",
        "require_explicit": True,
    },
    ("wire_and_cable", "helically_wound_bundle"): {
        "help": "Must be Yes; non-helical bundles are delegated.",
        "require_explicit": True,
    },
}


def _require_explicit_schema_inputs(
    variant_name: str,
    payload: Mapping[str, Any],
) -> None:
    """Reject omitted application facts that the source cannot safely infer.

    Direct source functions retain their convenient Python defaults for
    focused equation testing.  The public profile dispatcher, which is used
    by the API, treats an engineering assertion differently from a language
    default: a caller must explicitly provide every ``require_explicit``
    value, including an explicit ``False`` where that is the actual case.
    """
    missing = [
        field_name
        for (candidate_variant, field_name), metadata
        in _SCHEMA_FIELD_GUIDANCE.items()
        if candidate_variant == variant_name
        and metadata.get("require_explicit")
        and (
            field_name not in payload
            or payload[field_name] is None
            or (
                isinstance(payload[field_name], str)
                and not payload[field_name].strip()
            )
        )
    ]
    if missing:
        joined = ", ".join(sorted(missing))
        raise UnsupportedMILSTD975MError(
            f"{variant_name} requires explicit source input(s): {joined}; "
            "no engineering application fact is inferred from a default"
        )


def _field_unit(name: str) -> str | None:
    if name.endswith("_temperature_c") or name.endswith("_rise_c"):
        return "°C"
    if name.endswith("_current_a") or name.endswith("_current"):
        return "A"
    if name.endswith("_voltage_v") or name.endswith("_voltage") or name.endswith("_dwv"):
        return "V"
    if name.endswith("_power_w") or name.endswith("_power_limit_w"):
        return "W"
    if name.endswith("_resistance") or name.endswith("_resistance_ohm"):
        return "Ω"
    if name.endswith("_seconds"):
        return "s"
    if name.endswith("_per_hour"):
        return "cycles/hour"
    if name.endswith("_ratio") or name == "stress_ratios":
        return "ratio"
    if name == "pressure_torr":
        return "torr"
    return None


def _variant_schema(name: str, function: Any) -> dict[str, Any]:
    fields: list[dict[str, Any]] = []
    for parameter in inspect.signature(function).parameters.values():
        if parameter.kind in {parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD}:
            continue
        guidance = _SCHEMA_FIELD_GUIDANCE.get((name, parameter.name), {})
        require_explicit = bool(guidance.get("require_explicit"))
        field: dict[str, Any] = {
            "name": parameter.name,
            "label": parameter.name.replace("_", " ").title(),
            "required": (
                parameter.default is inspect.Parameter.empty or require_explicit
            ),
            "type": str(parameter.annotation),
        }
        if (
            parameter.default is not inspect.Parameter.empty
            and not require_explicit
        ):
            field["default"] = parameter.default
        unit = _field_unit(parameter.name)
        if unit is not None:
            field["unit"] = unit
        choices = _SCHEMA_CHOICES.get((name, parameter.name))
        if choices is not None:
            field["choices"] = list(choices)
        for metadata_key in ("help", "required_when"):
            if guidance.get(metadata_key):
                field[metadata_key] = guidance[metadata_key]
        fields.append(field)
    variant = {"name": name, "fields": fields}
    variant.update(_SCHEMA_VARIANT_GUIDANCE.get(name, {}))
    return variant


def profile_schema() -> dict[str, Any]:
    """Return a fresh, JSON-serializable description of the historical profile."""
    families: dict[str, Any] = {}
    for family, catalog in FAMILY_CATALOG.items():
        source = _SOURCES[family]
        variants = _SCHEMA_VARIANTS[family]
        families[family] = {
            "title": source.title,
            "source": asdict(source),
            "executable": bool(catalog["executable"]),
            "input_variants": [
                _variant_schema(variant_name, function)
                for variant_name, function in variants
            ],
        }
    families["crystal"]["notes"] = [
        "Standalone crystals are not approved; oscillators require component-level verification."
    ]
    families["protective_device"]["selector"] = {
        "name": "device_type", "choices": ["fuse", "circuit_breaker"]
    }
    families["switch"]["notes"] = [
        "Appendix A reserves the switch section for future use and supplies no executable rule."
    ]
    return {
        "profile_id": "MIL_STD_975M",
        "standard": DOCUMENT_ID,
        "edition": DOCUMENT_DATE,
        "document_status": DOCUMENT_STATUS,
        "historical": True,
        "rating_assumption": _RATING_ASSUMPTION,
        "families": families,
        "out_of_appendix_scope": {
            "fiber_optic_photonics": {
                "executable": False,
                "reason": "No Appendix A numerical derating rule is provided.",
            }
        },
    }
