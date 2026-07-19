"""Source-isolated, fail-closed electrical and thermal derating analysis.

The built-in profiles are not aliases for a generic table.  MIL-STD-975M,
RADC-TR-84-254, and RL-TR-92-11 each retain their own terminology, level
semantics, applicability rules, equations, source locators, and input bag.
The latter two are historical technical reports rather than issued military
standards.  MIL-STD-975M is a canceled, one-level historical standard.

The former synthetic presets bearing MIL/NASA, NAVSEA, and ECSS labels were
removed.  NAVSEA and ECSS remain unavailable until an edition-pinned,
row-traceable implementation is supplied and independently checked.  Custom
three-level rules remain available but make no external conformance claim.
Missing or delegated inputs never count as a pass.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict, dataclass
import json
import math
from typing import Any


DERATING_STANDARDS = {
    "MIL-STD-975M": {
        "name": "MIL-STD-975M Appendix A (historical)",
        "description": (
            "Exact, source-specific Appendix A assessment from the 5 August "
            "1994 issue. This is a one-level profile, not a Level I/II/III "
            "rulebook, and it is not current NASA practice."
        ),
        "available": True,
        "reason": (
            "Historical use only: Notice 3 canceled MIL-STD-975M without "
            "replacement on 5 May 1998. Source-delegated or absent rules fail "
            "closed."
        ),
        "level_mode": "none",
        "historical": True,
        "canceled": True,
    },
    "RADC-TR-84-254": {
        "name": "RADC-TR-84-254 advanced-device guidance (historical)",
        "description": (
            "Exact Tables 1-10 from the December 1984 final technical report. "
            "Levels I/II/III are selected manually; the report's environment "
            "mapping is guidance, not an automatic rule."
        ),
        "available": True,
        "reason": (
            "This report proposed a framework for a future military standard; "
            "it was not itself promulgated as one. Ambiguous or delegated "
            "cases remain not evaluated."
        ),
        "level_mode": "manual_three_level",
        "historical": True,
        "canceled": False,
    },
    "RL-TR-92-11": {
        "name": "RL-TR-92-11 advanced-technology criteria (historical)",
        "description": (
            "Source-specific final-table criteria from the February 1992 "
            "technical report. Criticality Level I/II/III is selected "
            "manually; the report is not an issued military standard."
        ),
        "available": True,
        "reason": (
            "Historical screening use only. Supplier-defined limits, safe-"
            "operating-area checks, contradictory or undefined source rows, "
            "and delegated assembly checks fail closed."
        ),
        "level_mode": "manual_three_level",
        "historical": True,
        "canceled": False,
    },
    "NAVSEA": {
        "name": "NAVSEA TE000-AB-GTP-010 (withdrawn)",
        "description": (
            "No executable TE000-AB-GTP-010 or current NAVSEA SD-18 profile "
            "is implemented."
        ),
        "available": False,
        "reason": (
            "Disabled: the former generic limits were synthetic screening "
            "data, not a clause- and row-traceable NAVSEA implementation."
        ),
        "level_mode": "none",
        "historical": True,
        "canceled": True,
    },
    "ECSS": {
        "name": "ECSS-Q-ST-30-11C Rev.2 (withdrawn)",
        "description": (
            "No executable ECSS-Q-ST-30-11C Rev.2 profile is implemented."
        ),
        "available": False,
        "reason": (
            "Disabled: the former generic limits were synthetic screening "
            "data and omitted ECSS technology, application, mission, "
            "transient, and exception logic."
        ),
        "level_mode": "none",
        "historical": False,
        "canceled": False,
    },
}


class DeratingStandardUnavailableError(ValueError):
    """Raised when a withdrawn or not-yet-verified profile is requested."""


@dataclass(frozen=True)
class SourceDeratingCheck:
    """Normalized check emitted by any source-specific profile."""

    rule_id: str
    parameter: str
    description: str
    actual_value: float | bool | str | None
    allowable_value: float | bool | str | None
    unit: str
    comparison: str
    status: str
    margin: float | None = None
    formula: str | None = None
    substitution: str | None = None
    source: dict[str, Any] | None = None
    notes: tuple[str, ...] = ()
    message: str | None = None


@dataclass(frozen=True)
class SourceDeratingAssessment:
    """Normalized assessment without erasing the selected source's identity."""

    family: str
    subtype: str
    status: str
    checks: tuple[SourceDeratingCheck, ...]
    selected_level: str | None = None
    assumptions: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    traceability: dict[str, Any] | None = None


_CATEGORY_HINTS = {
    "capacitor": ["capacitor"],
    "connector": ["connector", "connector_socket"],
    "crystal": ["crystal", "oscillator"],
    "diode": ["diode", "hf_diode", "thyristor"],
    "filter": ["filter"],
    "inductor": ["inductor_coil"],
    "linear_microcircuit": ["microcircuit"],
    "digital_microcircuit": ["microcircuit", "vhsic_microcircuit", "detailed_cmos"],
    "fuse": ["fuse"],
    "circuit_breaker": ["circuit_breaker"],
    "relay": ["relay", "ss_relay"],
    "resistor": ["resistor"],
    "switch": ["switch"],
    "thermistor": [],
    "transformer": ["transformer"],
    "transistor": ["bjt", "fet", "gaas_fet"],
    "wire_cable": ["connection"],
    "hybrid": ["hybrid_microcircuit"],
    "complex_ic": ["microcircuit", "vhsic_microcircuit", "detailed_cmos"],
    "ram_rom": ["microcircuit"],
    "bubble_memory": ["bubble_memory"],
    "gaas_fet": ["gaas_fet"],
    "microwave_transistor_impatt_gunn": ["hf_power_bjt", "hf_silicon_fet"],
    "varactor_step_recovery_pin_tunnel": ["hf_diode"],
    "silicon_detector_mixer": ["hf_diode"],
    "germanium_detector_mixer": ["hf_diode"],
    "saw": ["saw_device"],
}


# These rules describe only exact taxonomy matches.  They are intentionally
# narrower than ``_CATEGORY_HINTS``: hints help a person find candidates,
# whereas an automatic rule must identify one and only one source model from
# information already present in the prediction line item.
_AUTOMATIC_FAMILY_RULES: dict[str, tuple[dict[str, Any], ...]] = {
    "MIL-STD-975M": (
        {"family": "capacitor", "category": "capacitor"},
        {"family": "connector", "category": "connector"},
        {"family": "connector", "category": "connector_socket"},
        {
            "family": "crystal", "category": "crystal",
            "values": {"kind": "crystal"},
        },
        {
            "family": "crystal", "category": "oscillator",
            "values": {"kind": "crystal_oscillator"},
        },
        {"family": "diode", "category": "diode"},
        {"family": "diode", "category": "hf_diode"},
        {
            "family": "diode", "category": "thyristor",
            "values": {"diode_type": "thyristor"},
        },
        {"family": "filter", "category": "filter"},
        {"family": "inductor", "category": "inductor_coil"},
        {
            "family": "linear_microcircuit", "category": "microcircuit",
            "when": {"device_type": ["linear"]},
        },
        {
            "family": "digital_microcircuit", "category": "microcircuit",
            "when": {
                "device_type": ["digital", "pla", "microprocessor", "memory"]
            },
        },
        {"family": "digital_microcircuit", "category": "vhsic_microcircuit"},
        {"family": "digital_microcircuit", "category": "detailed_cmos"},
        {"family": "fuse", "category": "fuse"},
        {"family": "circuit_breaker", "category": "circuit_breaker"},
        {"family": "relay", "category": "relay"},
        {"family": "relay", "category": "ss_relay"},
        {"family": "resistor", "category": "resistor"},
        {"family": "switch", "category": "switch"},
        {"family": "transformer", "category": "transformer"},
        {
            "family": "transistor", "category": "bjt",
            "values": {"transistor_type": "bipolar"},
        },
        {"family": "transistor", "category": "fet"},
        {"family": "wire_cable", "category": "connection"},
    ),
    "RADC-TR-84-254": (
        {"family": "hybrid", "category": "hybrid_microcircuit"},
        {
            "family": "complex_ic", "category": "microcircuit",
            "when": {
                "device_type": ["digital", "linear", "pla", "microprocessor"]
            },
        },
        {"family": "complex_ic", "category": "vhsic_microcircuit"},
        {"family": "complex_ic", "category": "detailed_cmos"},
        {
            "family": "ram_rom", "category": "microcircuit",
            "when": {"device_type": ["memory"]},
        },
        {"family": "bubble_memory", "category": "bubble_memory"},
        {"family": "gaas_fet", "category": "gaas_fet"},
        {
            "family": "microwave_transistor_impatt_gunn",
            "category": "hf_power_bjt",
        },
        {
            "family": "microwave_transistor_impatt_gunn",
            "category": "hf_silicon_fet",
        },
        {
            "family": "varactor_step_recovery_pin_tunnel",
            "category": "hf_diode",
            "when": {"diode_type": ["varactor", "step_recovery", "pin", "tunnel"]},
        },
        {"family": "saw", "category": "saw_device"},
    ),
    "RL-TR-92-11": (
        {
            "family": "asic_mos_digital", "category": "microcircuit",
            "when": {"device_type": ["digital", "pla"], "technology": ["mos"]},
        },
        {
            "family": "asic_mos_linear", "category": "microcircuit",
            "when": {"device_type": ["linear"], "technology": ["mos"]},
        },
        {
            "family": "asic_bipolar_digital", "category": "microcircuit",
            "when": {
                "device_type": ["digital", "pla"], "technology": ["bipolar"]
            },
        },
        {
            "family": "asic_bipolar_linear", "category": "microcircuit",
            "when": {"device_type": ["linear"], "technology": ["bipolar"]},
        },
        {
            "family": "prom_mos_eeprom", "category": "microcircuit",
            "when": {
                "device_type": ["memory"], "technology": ["mos"],
                "memory_type": ["eeprom", "eaprom"],
            },
        },
        {
            "family": "prom_mos_other", "category": "microcircuit",
            "when": {
                "device_type": ["memory"], "technology": ["mos"],
                "memory_type": ["prom", "uvprom"],
            },
        },
        {
            "family": "prom_bipolar", "category": "microcircuit",
            "when": {
                "device_type": ["memory"], "technology": ["bipolar"],
                "memory_type": ["prom", "uvprom"],
            },
        },
        {
            "family": "asic_mos_digital", "category": "detailed_cmos",
            "when": {"device_type": ["logic_custom"]},
        },
        {
            "family": "power_silicon_mosfet", "category": "fet",
            "when": {"fet_type": ["mosfet"], "application": ["power"]},
        },
        {
            "family": "opto_photo_transistor", "category": "optoelectronic",
            "when": {"device": ["phototransistor"]},
        },
        {
            "family": "opto_coupler", "category": "optoelectronic",
            "when": {"device": ["optical_isolator"]},
        },
        {
            "family": "opto_led", "category": "optoelectronic",
            "when": {"device": ["ir_led", "led"]},
        },
        {"family": "opto_injection_laser", "category": "laser_diode"},
        {
            "family": "passive_chip_resistor_rm", "category": "resistor",
            "when": {"style": ["RM"]},
        },
        {
            "family": "passive_chip_capacitor_cdr", "category": "capacitor",
            "when": {"style": ["CDR"]},
        },
        {
            "family": "passive_chip_capacitor_cwr", "category": "capacitor",
            "when": {"style": ["CWR"]},
        },
        {"family": "saw_device", "category": "saw_device"},
    ),
}


# A field rule is included only when the prediction input and the source input
# have the same physical meaning and compatible units.  No ambient/case,
# total/DC voltage, or similarly tempting-but-different substitutions belong
# here.  Values supplied explicitly in ``derating_params`` take precedence.
_AUTOMATIC_FIELD_RULES: dict[str, dict[str, dict[str, dict[str, Any]]]] = {
    "MIL-STD-975M": {
        "capacitor": {
            "ambient_temperature_c": {"keys": ["T_ambient"]},
            "effective_circuit_resistance_ohm_per_volt": {
                "keys": ["circuit_resistance_ohm_per_volt"]
            },
        },
        "connector": {
            "ambient_temperature_c": {"keys": ["T_ambient"]},
            "resistive_heating_rise_c": {"keys": ["insert_temperature_rise"]},
        },
        "diode": {
            "junction_temperature_c": {"keys": ["T_junction"]},
            "diode_type": {
                "keys": ["diode_type"],
                "value_map": {
                    "general_purpose_analog": "general_purpose",
                    "power_rectifier": "rectifier",
                    "switching": "switching",
                    "pin": "pin",
                    "schottky": "schottky",
                    "varactor": "varactor",
                    "voltage_regulator": "voltage_regulator",
                    "voltage_reference": "voltage_reference",
                },
            },
        },
        "linear_microcircuit": {
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "digital_microcircuit": {
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "relay": {
            "ambient_temperature_c": {"keys": ["T_ambient"]},
        },
        "resistor": {
            "nominal_power_w": {"keys": ["rated_power"]},
            "actual_power_w": {
                "keys": ["rated_power", "power_stress"],
                "transform": "product",
            },
        },
        "transistor": {
            "junction_temperature_c": {"keys": ["T_junction"]},
            "transistor_type": {"keys": ["fet_type"]},
        },
    },
    "RADC-TR-84-254": {
        "hybrid": {"junction_temperature_c": {"keys": ["T_junction"]}},
        "complex_ic": {"junction_temperature_c": {"keys": ["T_junction"]}},
        "ram_rom": {"junction_temperature_c": {"keys": ["T_junction"]}},
        "gaas_fet": {"junction_temperature_c": {"keys": ["T_junction"]}},
        "microwave_transistor_impatt_gunn": {
            "junction_temperature_c": {"keys": ["T_junction"]},
            "breakdown_voltage_ratio": {"keys": ["voltage_stress"]},
        },
        "varactor_step_recovery_pin_tunnel": {
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
    },
    "RL-TR-92-11": {
        "asic_mos_digital": {
            "gate_count": {"keys": ["complexity"]},
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "asic_mos_linear": {
            "transistor_count": {"keys": ["complexity"]},
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "asic_bipolar_digital": {
            "gate_count": {"keys": ["complexity"]},
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "asic_bipolar_linear": {
            "transistor_count": {"keys": ["complexity"]},
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "prom_mos_eeprom": {
            "bit_count": {"keys": ["complexity"]},
            "write_cycles": {"keys": ["programming_cycles"]},
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "prom_mos_other": {
            "bit_count": {"keys": ["complexity"]},
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "prom_bipolar": {
            "bit_count": {"keys": ["complexity"]},
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "power_silicon_mosfet": {
            "junction_temperature_c": {"keys": ["T_junction"]},
        },
        "opto_injection_laser": {
            "optical_power_pct_of_rated": {
                "keys": ["output_power_ratio"],
                "transform": "ratio_to_percent",
            },
        },
        "passive_chip_resistor_rm": {
            "power_dissipation_pct_of_rated": {
                "keys": ["power_stress"],
                "transform": "ratio_to_percent",
            },
            "operating_frequency_mhz": {"keys": ["frequency_mhz"]},
        },
        "passive_chip_capacitor_cwr": {
            "operating_temperature_c": {"keys": ["T_ambient"]},
        },
    },
}


def _humanize(value: str) -> str:
    return value.replace("_", " ").strip().title()


def _mil_field(field: dict[str, Any]) -> dict[str, Any]:
    """Convert the introspected MIL input contract to the UI schema."""
    annotation = str(field.get("type", ""))
    choices = field.get("choices")
    if choices is not None:
        field_type = "select"
    elif "Mapping" in annotation:
        field_type = "text"
    elif "bool" in annotation:
        field_type = "boolean"
    elif "float" in annotation or "int" in annotation:
        field_type = "number"
    else:
        field_type = "text"
    result: dict[str, Any] = {
        "key": field["name"],
        "label": field.get("label") or _humanize(field["name"]),
        "type": field_type,
        "required": bool(field.get("required")),
    }
    if choices is not None:
        result["options"] = [str(value) for value in choices]
    if field.get("unit"):
        result["unit"] = field["unit"]
    if field.get("default") is not None:
        result["default"] = field["default"]
    if field.get("required_when"):
        result["required_when"] = str(field["required_when"])
    if field.get("help"):
        result["help"] = str(field["help"])
    if field_type == "number":
        unit = field.get("unit")
        name = str(field["name"])
        if unit == "ratio" or name.endswith("_ratio"):
            result.update({"min": 0.0, "step": 0.01})
        elif unit == "°C":
            result["step"] = 1.0
        elif unit == "cycles/hour":
            result.update({"min": 0.0, "step": 0.01})
        elif "int" in annotation:
            result.update({"min": 0.0, "step": 1.0})
        else:
            result.update({"min": 0.0, "step": 0.01})
    if "Mapping" in annotation:
        if field.get("help"):
            pass
        elif field["name"] == "stress_ratios":
            result["help"] = (
                "Enter a JSON object of source stress names to dimensionless "
                "actual/rated ratios. Required keys depend on Device Type; "
                "for an operational amplifier, for example, use "
                '{"supply_voltage":0.60,"power_dissipation":0.30,'
                '"ac_input_voltage":0.50,"output_voltage":0.40,'
                '"output_current":0.50,"short_circuit_output_current":0.80}; '
                "also supply actual_input_voltage and actual_supply_voltage."
            )
        else:
            result["help"] = (
                "Enter a JSON object using the source stress names. Each "
                "value is [actual, rated], for example "
                '{"piv":[50,100],"surge_current":[1,3],"forward_current":[0.5,1]}.'
            )
    return result


def _mil975_profile_schema() -> dict[str, Any]:
    from reliability.MIL_STD_975M import profile_schema

    raw = profile_schema()
    families: list[dict[str, Any]] = []
    for key, definition in raw["families"].items():
        variants = definition.get("input_variants", [])
        if key == "protective_device":
            for variant in variants:
                variant_key = (
                    "circuit_breaker"
                    if variant["name"] == "circuit_breaker"
                    else "fuse"
                )
                families.append({
                    "key": variant_key,
                    "label": _humanize(variant_key),
                    "category_hints": _CATEGORY_HINTS.get(variant_key, []),
                    "fields": [_mil_field(field) for field in variant["fields"]],
                    "source": definition["source"]["section"],
                    "executable": True,
                    "guidance": [
                        item for item in (
                            variant.get("application"),
                            *variant.get("verification_obligations", []),
                        ) if item
                    ],
                })
            continue
        fields = (
            [_mil_field(field) for field in variants[0]["fields"]]
            if variants else []
        )
        notes = definition.get("notes", [])
        families.append({
            "key": key,
            "label": definition.get("title") or _humanize(key),
            "category_hints": _CATEGORY_HINTS.get(key, []),
            "fields": fields,
            "source": definition["source"]["section"],
            "executable": bool(definition.get("executable")),
            "reason": " ".join(notes) or None,
            "guidance": (
                [
                    item for item in (
                        variants[0].get("application"),
                        *variants[0].get("verification_obligations", []),
                    ) if item
                ] if variants else []
            ),
        })
    out_of_scope = raw.get("out_of_appendix_scope", {})
    for key, definition in out_of_scope.items():
        families.append({
            "key": key,
            "label": _humanize(key),
            "category_hints": [],
            "fields": [],
            "source": "MIL-STD-975M scope; outside Appendix A",
            "executable": False,
            "reason": definition.get("reason"),
        })
    return {"families": families}


def _radc84254_profile_schema() -> dict[str, Any]:
    from reliability.RADC_TR_84_254 import get_model_catalog

    families: list[dict[str, Any]] = []
    for key, definition in get_model_catalog().items():
        fields: list[dict[str, Any]] = []
        for name, input_definition in definition["inputs"].items():
            source_type = input_definition.get("type", "string")
            field_type = {
                "choice": "select",
                "boolean": "boolean",
                "number": "number",
            }.get(source_type, "text")
            field: dict[str, Any] = {
                "key": name,
                "label": _humanize(name),
                "type": field_type,
                "required": bool(input_definition.get("required")),
            }
            if input_definition.get("choices"):
                field["options"] = [str(value) for value in input_definition["choices"]]
            if input_definition.get("unit"):
                field["unit"] = input_definition["unit"]
            if input_definition.get("required_when"):
                field["required_when"] = str(input_definition["required_when"])
            if input_definition.get("help"):
                field["help"] = str(input_definition["help"])
            if field_type == "number":
                unit = input_definition.get("unit")
                if unit == "ratio" or name.endswith("_ratio"):
                    field.update({"min": 0.0, "step": 0.01})
                elif unit == "°C":
                    field["step"] = 1.0
                else:
                    field.update({"min": 0.0, "step": 0.01})
            fields.append(field)
        families.append({
            "key": key,
            "label": definition["display_name"],
            "category_hints": _CATEGORY_HINTS.get(key, []),
            "fields": fields,
            "source": (
                f"RADC-TR-84-254 §{definition['section']}, "
                f"{definition['table']}"
            ),
            "executable": True,
            "reason": (
                "Levels do not apply; the source leaves exactly 500 MHz and "
                "the printed absolute-power unit unresolved."
                if key == "saw" else None
            ),
        })
    return {"families": families}


def _base_profile_schema(standard: str) -> dict[str, Any] | None:
    if standard == "MIL-STD-975M":
        return _mil975_profile_schema()
    if standard == "RADC-TR-84-254":
        return _radc84254_profile_schema()
    if standard == "RL-TR-92-11":
        try:
            from reliability.RL_TR_92_11 import profile_schema
        except ImportError:
            return None
        return profile_schema()
    return None


def _profile_schema(standard: str) -> dict[str, Any] | None:
    """Return the source schema plus its exact prediction-input mappings."""
    schema = _base_profile_schema(standard)
    if schema is None:
        return None
    schema["automatic_mapping"] = {
        "family_rules": deepcopy(_AUTOMATIC_FAMILY_RULES.get(standard, ())),
        "field_rules": deepcopy(_AUTOMATIC_FIELD_RULES.get(standard, {})),
    }
    return schema


def _automatic_family_match(
    standard: str,
    category: str,
    prediction_params: dict[str, Any],
) -> tuple[str | None, dict[str, Any]]:
    """Resolve one exact source family and any rule-defined constant inputs."""
    matches: list[dict[str, Any]] = []
    for rule in _AUTOMATIC_FAMILY_RULES.get(standard, ()):
        if rule["category"] != category:
            continue
        conditions = rule.get("when", {})
        if all(prediction_params.get(key) in accepted
               for key, accepted in conditions.items()):
            matches.append(rule)
    families = {str(rule["family"]) for rule in matches}
    if len(families) != 1:
        return None, {}
    family = next(iter(families))
    values: dict[str, Any] = {}
    for rule in matches:
        if rule["family"] == family:
            values.update(rule.get("values", {}))
    return family, values


def _mapped_prediction_value(
    rule: dict[str, Any],
    prediction_params: dict[str, Any],
) -> tuple[bool, Any]:
    keys = list(rule.get("keys", ()))
    if not keys or any(key not in prediction_params for key in keys):
        return False, None
    values = [prediction_params[key] for key in keys]
    if any(value is None or (isinstance(value, str) and not value.strip())
           for value in values):
        return False, None
    transform = rule.get("transform", "identity")
    try:
        if transform == "product":
            value = math.prod(float(item) for item in values)
        elif transform == "ratio_to_percent":
            value = 100.0 * float(values[0])
        elif transform == "identity":
            value = values[0]
        else:  # pragma: no cover - guarded by the repository-owned rule table
            raise RuntimeError(f"unknown automatic input transform {transform!r}")
    except (TypeError, ValueError, OverflowError):
        return False, None
    value_map = rule.get("value_map")
    if value_map is not None:
        if value not in value_map:
            return False, None
        value = value_map[value]
    return True, value


def resolve_source_profile_inputs(
    standard: str,
    category: str,
    prediction_params: dict[str, Any],
    derating_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve exact family and reusable values for a prediction line item.

    Explicit source inputs override automatically reused prediction inputs.
    An input bag carrying a different profile is rejected, and an unscoped
    nonempty bag is rejected so stale values can never leak across profiles.
    """
    if not isinstance(prediction_params, dict):
        raise TypeError("prediction params must be a mapping")
    source = dict(derating_params or {})
    input_profile = source.pop("profile", None)
    ignored_profile = None
    if input_profile is not None and input_profile != standard:
        # The component stores one source-specific override bag.  When the
        # global profile changes, preserve that bag in project state but do
        # not read any of it into the newly selected source model.
        ignored_profile = input_profile
        source = {}
    explicit_family = source.pop("family", None)
    if input_profile is None and (explicit_family is not None or source):
        raise ValueError(
            "saved derating values have no source-profile identity; clear "
            "them or select their source profile explicitly"
        )

    automatic_family, fixed_values = _automatic_family_match(
        standard, category, prediction_params)
    family = explicit_family or automatic_family
    if not family:
        raise ValueError(
            f"No exact automatic {standard} source-family match is available "
            f"for prediction category {category!r}. Select the source family; "
            "Perdura will still reuse every compatible prediction input."
        )

    schema = _base_profile_schema(standard) or {"families": []}
    family_definition = next((
        item for item in schema.get("families", [])
        if item.get("key") == family
    ), None)
    if family_definition is None:
        raise ValueError(f"unknown {standard} source family {family!r}")
    target_fields = {
        field["key"]: field for field in family_definition.get("fields", [])
    }

    resolved: dict[str, Any] = {}
    inherited_fields: list[str] = []
    for key, value in fixed_values.items():
        if key in target_fields:
            resolved[key] = value
            inherited_fields.append(key)

    # Identically named fields are reusable only when the target schema
    # accepts the value.  This prevents a same-named but incompatible enum
    # from turning an automatic convenience into a silent model change.
    for key, field in target_fields.items():
        if key not in prediction_params:
            continue
        value = prediction_params[key]
        options = field.get("options")
        if options is not None and str(value) not in options:
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        resolved[key] = value
        inherited_fields.append(key)

    field_rules = _AUTOMATIC_FIELD_RULES.get(standard, {}).get(family, {})
    for target, rule in field_rules.items():
        if target not in target_fields:
            continue
        available, value = _mapped_prediction_value(rule, prediction_params)
        if not available:
            continue
        options = target_fields[target].get("options")
        if options is not None and str(value) not in options:
            continue
        resolved[target] = value
        inherited_fields.append(target)

    explicit_fields = sorted(source)
    resolved.update(source)
    return {
        "family": family,
        "params": resolved,
        "family_source": "explicit" if explicit_family else "automatic",
        "inherited_fields": sorted(set(inherited_fields) - set(explicit_fields)),
        "explicit_fields": explicit_fields,
        "ignored_profile": ignored_profile,
    }


def get_rules_for_standard(standard: str) -> dict[str, list[dict[str, Any]]]:
    """Reject requests to collapse a source-specific profile to generic rows."""
    if standard not in DERATING_STANDARDS:
        raise ValueError(
            f"Unknown derating standard '{standard}'. "
            f"Valid: {sorted(DERATING_STANDARDS)}"
        )
    profile = DERATING_STANDARDS[standard]
    if profile["available"]:
        raise ValueError(
            f"Derating profile '{standard}' is source-specific and cannot be "
            "represented by a generic three-level rulebook. Use "
            "assess_source_profile() with its dedicated input schema."
        )
    raise DeratingStandardUnavailableError(
        f"Derating standard '{standard}' is unavailable. "
        f"{profile['reason']} Provide validated custom_rules instead."
    )


def list_standards() -> list[dict[str, Any]]:
    """Return named profiles with explicit availability and reason."""
    standards: list[dict[str, Any]] = []
    for key, profile in DERATING_STANDARDS.items():
        info = deepcopy(profile)
        info.update({
            "key": key,
            "profile_schema": _profile_schema(key) if profile["available"] else None,
        })
        standards.append(info)
    return standards


def _decode_source_params(
    standard: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Decode only source-schema transport types; never borrow model inputs."""
    clean = {
        key: value
        for key, value in params.items()
        if value is not None and not (isinstance(value, str) and not value.strip())
    }
    if standard == "MIL-STD-975M":
        for key in ("stresses", "stress_ratios"):
            value = clean.get(key)
            if isinstance(value, str):
                try:
                    decoded = json.loads(value)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"{key} must be a valid JSON object: {exc.msg}"
                    ) from exc
                if not isinstance(decoded, dict):
                    raise ValueError(f"{key} must be a JSON object")
                clean[key] = decoded
        if "insulation_temperature_rating_c" in clean:
            try:
                clean["insulation_temperature_rating_c"] = int(
                    clean["insulation_temperature_rating_c"]
                )
            except (TypeError, ValueError, OverflowError) as exc:
                raise ValueError(
                    "insulation_temperature_rating_c must be an integer"
                ) from exc
    return clean


def _numeric_margin(
    actual: Any,
    allowable: Any,
    comparison: str,
) -> float | None:
    if isinstance(actual, bool) or isinstance(allowable, bool):
        return None
    if not isinstance(actual, (int, float)) or not isinstance(allowable, (int, float)):
        return None
    if comparison in {">", ">=", "≥"}:
        return float(actual) - float(allowable)
    if comparison in {"<", "<=", "≤"}:
        return float(allowable) - float(actual)
    return None


def _normalize_mil975(native: Any) -> SourceDeratingAssessment:
    normalized_checks: list[SourceDeratingCheck] = []
    for check in native.checks:
        status = {
            "pass": "ok",
            "fail": "exceeds",
            "not_evaluated": "not_evaluated",
        }.get(check.status, "not_evaluated")
        if status == "ok":
            message = f"{check.description} meets the source criterion."
        elif status == "exceeds":
            message = f"{check.description} exceeds the source criterion."
        else:
            message = (
                f"{check.description} could not be evaluated until the "
                "source prerequisite is satisfied or verified."
            )
        normalized_checks.append(SourceDeratingCheck(
            rule_id=check.rule_id,
            parameter=check.rule_id.rsplit(".", 1)[-1],
            description=check.description,
            actual_value=check.actual,
            allowable_value=check.allowable,
            unit=check.unit,
            comparison=check.comparison,
            status=status,
            margin=check.margin,
            formula=check.formula,
            substitution=check.substitution,
            source=asdict(check.source),
            notes=tuple(check.notes),
            message=message,
        ))
    checks = tuple(normalized_checks)
    assessment_status = {
        "pass": "ok",
        "fail": "exceeds",
        "not_evaluated": "not_evaluated",
    }.get(native.status, "not_evaluated")
    return SourceDeratingAssessment(
        family=native.family,
        subtype=native.subtype,
        status=assessment_status,
        checks=checks,
        selected_level=None,
        assumptions=tuple(native.assumptions),
        warnings=tuple(native.warnings),
        traceability={
            "standard": "MIL-STD-975M",
            "source": asdict(native.source),
        },
    )


def _normalize_report_result(native: Any, *, profile_id: str) -> SourceDeratingAssessment:
    """Normalize RADC/RL report result objects without altering their rules."""
    normalized: list[SourceDeratingCheck] = []
    for index, check in enumerate(native.checks, start=1):
        parameter = str(getattr(check, "parameter", f"check_{index}"))
        actual = getattr(check, "actual_value", None)
        allowable = getattr(check, "selected_limit", None)
        comparison = str(getattr(check, "comparison", ""))
        locator = getattr(check, "source_locator", None)
        raw_status = str(getattr(check, "status", "not_evaluated"))
        status = (
            raw_status
            if raw_status in {"ok", "exceeds", "not_evaluated"}
            else "not_evaluated"
        )
        normalized.append(SourceDeratingCheck(
            # A source can impose several distinct obligations on the same
            # input (for example nominal, minimum, and maximum supply checks).
            # Preserve a stable row-order discriminator so rule identifiers
            # remain unique within an assessment.
            rule_id=f"{profile_id}.{native.model}.{index:02d}.{parameter}",
            parameter=parameter,
            description=str(getattr(check, "description", parameter)),
            actual_value=actual,
            allowable_value=allowable,
            unit=str(getattr(check, "unit", "")),
            comparison=comparison,
            status=status,
            margin=_numeric_margin(actual, allowable, comparison),
            formula=(
                getattr(check, "formula", None)
                or (f"{parameter} {comparison} source limit" if comparison else None)
            ),
            substitution=(
                getattr(check, "substitution", None)
                or (
                    f"{actual} {comparison} {allowable}"
                    if actual is not None and allowable is not None and comparison else None
                )
            ),
            source={"title": profile_id, "section": locator} if locator else None,
            notes=tuple(getattr(check, "notes", ()) or ()),
            message=getattr(check, "message", None),
        ))
    traceability = dict(getattr(native, "traceability", {}) or {})
    raw_result_status = str(native.status)
    result_status = (
        raw_result_status
        if raw_result_status in {"ok", "exceeds", "not_evaluated"}
        else "not_evaluated"
    )
    return SourceDeratingAssessment(
        family=str(native.model),
        subtype=str(getattr(native, "display_name", native.model)),
        status=result_status,
        checks=tuple(normalized),
        selected_level=getattr(native, "selected_level", None),
        assumptions=tuple(getattr(native, "assumptions", ()) or ()),
        warnings=tuple(getattr(native, "warnings", ()) or ()),
        traceability=traceability,
    )


def assess_source_profile(
    standard: str,
    family: str,
    params: dict[str, Any],
    *,
    selected_level: str | None = None,
) -> SourceDeratingAssessment:
    """Evaluate one part using only the selected source profile and input bag."""
    if standard not in DERATING_STANDARDS:
        raise ValueError(
            f"Unknown derating standard '{standard}'. "
            f"Valid: {sorted(DERATING_STANDARDS)}"
        )
    profile = DERATING_STANDARDS[standard]
    if not profile["available"]:
        raise DeratingStandardUnavailableError(
            f"Derating standard '{standard}' is unavailable. {profile['reason']}"
        )
    if not isinstance(params, dict):
        raise ValueError("source-specific derating params must be a mapping")
    if not isinstance(family, str) or not family.strip():
        raise ValueError("a source family/model must be selected explicitly")
    level_mode = profile["level_mode"]
    if level_mode == "none" and selected_level is not None:
        raise ValueError(f"{standard} does not define Levels I/II/III")
    if level_mode == "manual_three_level" and selected_level is None and family != "saw":
        raise ValueError(
            f"{standard} requires a manual Level I, II, or III selection"
        )

    payload = _decode_source_params(standard, params)
    if standard == "MIL-STD-975M":
        from reliability.MIL_STD_975M import assess

        return _normalize_mil975(assess(family, payload))
    if standard == "RADC-TR-84-254":
        from reliability.RADC_TR_84_254 import assess

        native = assess(
            family,
            payload,
            None if family == "saw" else selected_level,
        )
        return _normalize_report_result(native, profile_id=standard)
    if standard == "RL-TR-92-11":
        from reliability.RL_TR_92_11 import assess

        native = assess(family, payload, selected_level)
        return _normalize_report_result(native, profile_id=standard)
    raise AssertionError(f"available profile {standard!r} has no dispatcher")


def make_custom_rules(
    overrides: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    """Validate a user-defined three-level maximum-limit rulebook.

    Each rule requires ``param`` and monotonically nondecreasing
    ``level_I``, ``level_II``, and ``level_III`` maximum limits.  Supported
    units are ``ratio`` and absolute ``°C``.  Broad category aliases are not
    applied: the category identifier must match the analyzed part category so
    that technology distinctions cannot be silently erased.
    """
    if not isinstance(overrides, dict) or not overrides:
        raise ValueError("custom rule set must be a non-empty mapping")

    rules: dict[str, list[dict[str, Any]]] = {}
    for raw_category, raw_rules in overrides.items():
        category = str(raw_category).strip().lower()
        if not category:
            raise ValueError("custom rule category must not be empty")
        if category in rules:
            raise ValueError(f"duplicate custom category '{category}'")
        if not isinstance(raw_rules, list) or not raw_rules:
            raise ValueError(
                f"custom category '{category}' must contain at least one rule"
            )

        validated: list[dict[str, Any]] = []
        seen_params: set[str] = set()
        for index, raw_rule in enumerate(raw_rules):
            if not isinstance(raw_rule, dict):
                raise ValueError(
                    f"custom rule {category}[{index}] must be a mapping"
                )
            raw_limits = (
                raw_rule.get("level_I"),
                raw_rule.get("level_II"),
                raw_rule.get("level_III"),
            )
            if any(isinstance(value, bool) for value in raw_limits):
                raise ValueError(
                    f"custom rule {category}[{index}] has a non-numeric limit"
                )
            try:
                parameter = str(raw_rule["param"]).strip()
                level_i = float(raw_rule["level_I"])
                level_ii = float(raw_rule["level_II"])
                level_iii = float(raw_rule["level_III"])
            except KeyError as exc:
                raise ValueError(
                    f"custom rule {category}[{index}] is missing "
                    f"{exc.args[0]!r}"
                ) from exc
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"custom rule {category}[{index}] has a non-numeric limit"
                ) from exc

            if not parameter:
                raise ValueError(
                    f"custom rule {category}[{index}] parameter must not be empty"
                )
            if parameter in seen_params:
                raise ValueError(
                    f"custom category '{category}' contains duplicate parameter "
                    f"'{parameter}'"
                )
            seen_params.add(parameter)

            unit = str(raw_rule.get("unit", "ratio")).strip()
            if unit not in {"ratio", "°C"}:
                raise ValueError(
                    f"custom rule {category}/{parameter} has unsupported unit "
                    f"{unit!r}; expected 'ratio' or '°C'"
                )

            limits = (level_i, level_ii, level_iii)
            if not all(math.isfinite(value) for value in limits):
                raise ValueError(
                    f"custom rule {category}/{parameter} limits must be finite"
                )
            if not level_i <= level_ii <= level_iii:
                raise ValueError(
                    f"custom rule {category}/{parameter} limits must satisfy "
                    "level_I <= level_II <= level_III"
                )
            if unit == "ratio" and not all(
                0.0 <= value <= 1.0 for value in limits
            ):
                raise ValueError(
                    f"custom rule {category}/{parameter} ratio limits must be "
                    "between 0 and 1"
                )

            rule: dict[str, Any] = {
                "param": parameter,
                "desc": (
                    str(raw_rule.get("desc", parameter)).strip() or parameter
                ),
                "unit": unit,
                "level_I": level_i,
                "level_II": level_ii,
                "level_III": level_iii,
            }
            if "rated" in raw_rule:
                if isinstance(raw_rule["rated"], bool):
                    raise ValueError(
                        f"custom rule {category}/{parameter} rated value must "
                        "be numeric"
                    )
                try:
                    rated = float(raw_rule["rated"])
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        f"custom rule {category}/{parameter} rated value must "
                        "be numeric"
                    ) from exc
                if not math.isfinite(rated):
                    raise ValueError(
                        f"custom rule {category}/{parameter} rated value must "
                        "be finite"
                    )
                if unit == "°C" and rated < level_iii:
                    raise ValueError(
                        f"custom rule {category}/{parameter} rated temperature "
                        "must be at least the level_III limit"
                    )
                rule["rated"] = rated
            validated.append(rule)
        rules[category] = validated
    return rules


@dataclass(frozen=True)
class DeratingResult:
    """Result of one custom derating rule check."""

    parameter: str
    description: str
    unit: str
    actual_value: float | None
    rated_value: float | None
    stress_ratio: float | None
    level_I_limit: float
    level_II_limit: float
    level_III_limit: float
    selected_level: str
    selected_limit: float
    status: str
    derating_level: str | None
    message: str

    def __repr__(self) -> str:
        value = (
            f"{self.actual_value:g} {self.unit}"
            if self.actual_value is not None
            else "not-evaluated"
        )
        return (
            f"DeratingResult({self.parameter}: value={value}, "
            f"status={self.status!r}, selected_level={self.selected_level!r})"
        )


def analyze_derating(
    category: str,
    params: dict[str, Any],
    *,
    standard: str = "MIL-STD-975M",
    custom_rules: dict[str, Any] | None = None,
    selected_level: str = "II",
) -> list[DeratingResult]:
    """Analyze a part against validated Custom maximum-limit rules.

    ``status`` is ``ok`` only when the actual value meets the selected level's
    maximum.  Missing rule inputs return ``not_evaluated``.  The separately
    reported ``derating_level`` is the tightest threshold met.
    """
    level = str(selected_level).strip().upper()
    if level not in {"I", "II", "III"}:
        raise ValueError("selected_level must be 'I', 'II', or 'III'")
    if not isinstance(params, dict):
        raise ValueError("params must be a mapping")

    if custom_rules is None:
        get_rules_for_standard(standard)
        raise AssertionError("unreachable")
    rulebook = make_custom_rules(custom_rules)

    normalized_category = str(category).strip().lower()
    if normalized_category not in rulebook:
        raise ValueError(
            f"Unknown derating category '{category}'. "
            f"Valid custom categories: {sorted(rulebook)}"
        )

    results: list[DeratingResult] = []
    for rule in rulebook[normalized_category]:
        parameter = rule["param"]
        unit = rule["unit"]
        limits = {
            "I": rule["level_I"],
            "II": rule["level_II"],
            "III": rule["level_III"],
        }
        selected_limit = limits[level]
        rated = 1.0 if unit == "ratio" else rule.get("rated")

        if parameter not in params or params[parameter] is None:
            results.append(DeratingResult(
                parameter=parameter,
                description=rule["desc"],
                unit=unit,
                actual_value=None,
                rated_value=rated,
                stress_ratio=None,
                level_I_limit=limits["I"],
                level_II_limit=limits["II"],
                level_III_limit=limits["III"],
                selected_level=level,
                selected_limit=selected_limit,
                status="not_evaluated",
                derating_level=None,
                message=(
                    f"No value was supplied for '{parameter}'; the rule was "
                    "not evaluated."
                ),
            ))
            continue

        if isinstance(params[parameter], bool):
            raise ValueError(f"parameter '{parameter}' must be numeric")
        try:
            actual = float(params[parameter])
        except (TypeError, ValueError) as exc:
            raise ValueError(f"parameter '{parameter}' must be numeric") from exc
        if not math.isfinite(actual):
            raise ValueError(f"parameter '{parameter}' must be finite")
        if unit == "ratio" and actual < 0.0:
            raise ValueError(
                f"ratio parameter '{parameter}' must be non-negative"
            )

        if actual <= limits["I"]:
            achieved_level = "I"
        elif actual <= limits["II"]:
            achieved_level = "II"
        elif actual <= limits["III"]:
            achieved_level = "III"
        else:
            achieved_level = "exceeded"

        status = "ok" if actual <= selected_limit else "exceeds"
        comparison = "is within" if status == "ok" else "exceeds"
        results.append(DeratingResult(
            parameter=parameter,
            description=rule["desc"],
            unit=unit,
            actual_value=actual,
            rated_value=rated,
            # Celsius is an offset scale; actual_C/rated_C is not a valid ratio.
            stress_ratio=actual if unit == "ratio" else None,
            level_I_limit=limits["I"],
            level_II_limit=limits["II"],
            level_III_limit=limits["III"],
            selected_level=level,
            selected_limit=selected_limit,
            status=status,
            derating_level=achieved_level,
            message=(
                f"{rule['desc']} ({actual:g} {unit}) {comparison} the selected "
                f"Level {level} maximum ({selected_limit:g} {unit})."
            ),
        ))
    return results
