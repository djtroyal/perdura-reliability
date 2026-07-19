"""Source-specific operational derating checks from RADC-TR-84-254.

This module transcribes Tables 1--10 and exposes the accompanying application
controls in Sections 2.1.2--2.6 of *Reliability Derating Procedures*,
RADC-TR-84-254, December 1984 (AD-A153744).  The source is a final technical
report whose stated deliverable was a framework for a future military
standard.  It is not an issued military standard.  Consequently, this module
provides a historically traceable screening profile and makes no standards-
conformance claim.

The profile is deliberately fail closed.  A missing applicable input produces
``not_evaluated`` rather than a pass.  Undefined or ambiguous source regimes
(notably Table 10 at exactly 500 MHz and its unreferenced ``dB`` input-power
unit) likewise cannot pass.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import math
from types import MappingProxyType
from typing import Any, Mapping


REPORT_EDITION = (
    "RADC-TR-84-254, Reliability Derating Procedures "
    "(December 1984), AD-A153744"
)
REPORT_STATUS = (
    "Final Technical Report and proposed military-standard framework; "
    "not an issued military standard"
)
DOCUMENT_SHA256 = "0c0b17d09e0eb1a5126efa05afc6e33562ae22201382b3ce1191e163f69dea0d"

PROFILE_METADATA: dict[str, Any] = {
    "profile_id": "RADC-TR-84-254",
    "title": "Reliability Derating Procedures",
    "edition": "December 1984",
    "accession": "AD-A153744",
    "performing_organization": "Martin Marietta Aerospace",
    "monitoring_organization": "Rome Air Development Center",
    "source_type": "Final Technical Report",
    "source_status": REPORT_STATUS,
    "document_sha256": DOCUMENT_SHA256,
    "implementation_status": (
        "verified source-specific historical screening profile with explicit "
        "application-prose coverage"
    ),
    "conformance_claim": False,
    "conformance_scope": (
        "RADC-TR-84-254 Tables 1-10 and the explicit application controls in "
        "Sections 2.1.2-2.6; no MIL standard conformance claim"
    ),
    "delegated_scope": (
        "Supplier/device-specific limits, AFSC Pamphlet 800-27 constituent "
        "checks, and process/design-control evidence remain external attestations."
    ),
    "level_selection": {
        "mode": "manual",
        "levels": {
            "I": "maximum derating for the most critical applications",
            "II": "mission-degrading or economically unjustifiable repair consequences",
            "III": "less-critical, quickly and economically repairable equipment",
        },
        "environment_guidance": {
            "ground": "III",
            "flight": "II",
            "space": "I",
        },
        "guidance_status": (
            "Section 2.1.3 calls the environment mapping guidance only; program "
            "criticality and objectives may dictate another manually selected level."
        ),
    },
}

_GENERAL_WARNING = (
    "RADC-TR-84-254 is a historical final technical report developed as a "
    "framework for a future military standard; this screening result is not a "
    "claim of compliance with an issued military standard."
)


class UnsupportedRADC84254ModelError(ValueError):
    """Raised when the requested source regime has no supported interpretation."""


@dataclass(frozen=True)
class RADC84254Check:
    """One auditable Table 1--10 screening check."""

    parameter: str
    description: str
    actual_value: float | bool | str | None
    selected_limit: float | bool | str | None
    unit: str
    comparison: str
    status: str
    message: str
    source_locator: str

    @property
    def passed(self) -> bool:
        """Return true only for an affirmatively evaluated passing check."""
        return self.status == "ok"

    @property
    def long_form(self) -> dict[str, Any]:
        return {
            "parameter": self.parameter,
            "description": self.description,
            "actual_value": self.actual_value,
            "selected_limit": self.selected_limit,
            "unit": self.unit,
            "comparison": self.comparison,
            "status": self.status,
            "message": self.message,
            "source_locator": self.source_locator,
        }


@dataclass(frozen=True)
class RADC84254Result:
    """Aggregate source-specific result for one device model."""

    model: str
    display_name: str
    selected_level: str | None
    status: str
    checks: tuple[RADC84254Check, ...]
    traceability: Mapping[str, Any]
    warnings: tuple[str, ...]
    inputs: Mapping[str, Any]

    @property
    def passed(self) -> bool:
        """Return true only when every applicable check was evaluated and passed."""
        return self.status == "ok"

    @property
    def compliance_status(self) -> str:
        """Report violations independently of whether coverage is complete."""
        if any(check.status == "exceeds" for check in self.checks):
            return "exceeds"
        return "within_evaluated_limits"

    @property
    def coverage_status(self) -> str:
        """Report whether every applicable table/delegated check was evaluated."""
        if any(check.status == "not_evaluated" for check in self.checks):
            return "incomplete"
        return "complete"

    @property
    def long_form(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "display_name": self.display_name,
            "selected_level": self.selected_level,
            "status": self.status,
            "compliance_status": self.compliance_status,
            "coverage_status": self.coverage_status,
            "passed": self.passed,
            "checks": [check.long_form for check in self.checks],
            "traceability": dict(self.traceability),
            "warnings": list(self.warnings),
            "inputs": dict(self.inputs),
        }


_LEVELS = ("I", "II", "III")

_MODEL_CATALOG: dict[str, dict[str, Any]] = {
    "hybrid": {
        "display_name": "Hybrid device",
        "section": "2.2",
        "table": "Table 1",
        "report_page": "5",
        "pdf_page": 16,
        "limits": {
            "junction_temperature_c": {"I": 85.0, "II": 100.0, "III": 110.0},
            "thick_film_power_density_w_per_in2": {
                "I": 50.0, "II": 50.0, "III": 50.0,
            },
            "thin_film_power_density_w_per_in2": {
                "I": 40.0, "II": 40.0, "III": 40.0,
            },
        },
        "inputs": {
            "junction_temperature_c": {"type": "number", "unit": "°C", "required": True},
            "film_construction": {
                "type": "choice", "choices": ["none", "thick", "thin", "both"],
                "required": True,
            },
            "case_temperature_c": {
                "type": "number", "unit": "°C", "required_when": "film_construction != none",
            },
            "thick_film_power_density_w_per_in2": {
                "type": "number", "unit": "W/in²",
                "required_when": "film_construction in (thick, both)",
            },
            "thin_film_power_density_w_per_in2": {
                "type": "number", "unit": "W/in²",
                "required_when": "film_construction in (thin, both)",
            },
            "constituent_checks_complete": {"type": "boolean", "required": True},
            "constituent_checks_passed": {"type": "boolean", "required": True},
        },
    },
    "complex_ic": {
        "display_name": "Complex integrated circuit (LSI/VHSIC/VLSI/microprocessor)",
        "section": "2.3",
        "table": "Table 2",
        "report_page": "6",
        "pdf_page": 17,
        "limits": {
            "junction_temperature_c": {"I": 85.0, "II": 100.0, "III": 125.0},
            "supply_voltage_ratio": {"I": 0.75, "II": 0.80, "III": 0.85},
            "output_current_ratio": {"I": 0.70, "II": 0.75, "III": 0.80},
            "fan_out_ratio": {
                "bipolar": {"I": 0.70, "II": 0.75, "III": 0.80},
                "mos": {"I": 0.80, "II": 0.80, "III": 0.90},
            },
            "operating_frequency_ratio": {
                "bipolar": {"I": 0.75, "II": 0.80, "III": 0.90},
                "mos": {"I": 0.80, "II": 0.80, "III": 0.80},
            },
        },
        "inputs": {
            "technology": {
                "type": "choice", "choices": ["bipolar", "mos", "cmos"],
                "required_when": "digital is true",
            },
            "digital": {"type": "boolean", "required": True},
            "junction_temperature_c": {"type": "number", "unit": "°C", "required": True},
            "supply_voltage_ratio": {"type": "number", "unit": "ratio", "required": True},
            "output_current_ratio": {"type": "number", "unit": "ratio", "required": True},
            "fan_out_ratio": {
                "type": "number", "unit": "ratio", "required_when": "digital is true",
            },
            "operating_frequency_ratio": {
                "type": "number", "unit": "ratio", "required_when": "digital is true",
            },
        },
    },
    "ram_rom": {
        "display_name": "RAM or ROM memory device",
        "section": "2.4",
        "table": "Table 3",
        "report_page": "7",
        "pdf_page": 18,
        "limits": {
            "junction_temperature_c": {"I": 85.0, "II": 100.0, "III": 125.0},
            "supply_voltage_ratio": {"I": 0.75, "II": 0.80, "III": 0.85},
            "output_current_ratio": {"I": 0.70, "II": 0.75, "III": 0.80},
        },
        "inputs": {
            "junction_temperature_c": {"type": "number", "unit": "°C", "required": True},
            "supply_voltage_ratio": {"type": "number", "unit": "ratio", "required": True},
            "output_current_ratio": {"type": "number", "unit": "ratio", "required": True},
        },
    },
    "bubble_memory": {
        "display_name": "Bubble memory",
        "section": "2.4",
        "table": "Table 4",
        "report_page": "7",
        "pdf_page": 18,
        "limits": {
            "ambient_operating_temperature_c": {"I": 85.0, "II": 85.0, "III": 85.0},
        },
        "inputs": {
            "ambient_operating_temperature_c": {
                "type": "number", "unit": "°C", "required": True,
            },
            "support_device_checks_complete": {"type": "boolean", "required": True},
            "support_device_checks_passed": {"type": "boolean", "required": True},
        },
    },
    "gaas_fet": {
        "display_name": "GaAs FET",
        "section": "2.5.1",
        "table": "Table 5",
        "report_page": "8",
        "pdf_page": 19,
        "limits": {},
        "inputs": {},
    },
    "microwave_transistor_impatt_gunn": {
        "display_name": "Microwave transistor, IMPATT diode, or Gunn diode",
        "section": "2.5.2",
        "table": "Table 6",
        "report_page": "9",
        "pdf_page": 20,
        "limits": {},
        "inputs": {},
    },
    "varactor_step_recovery_pin_tunnel": {
        "display_name": "Varactor, step-recovery, PIN, or tunnel diode",
        "section": "2.5.3",
        "table": "Table 7",
        "report_page": "10",
        "pdf_page": 21,
        "limits": {},
        "inputs": {},
    },
    "silicon_detector_mixer": {
        "display_name": "Silicon detector or mixer (Schottky)",
        "section": "2.5.4",
        "table": "Table 8",
        "report_page": "10",
        "pdf_page": 21,
        "limits": {},
        "inputs": {},
    },
    "germanium_detector_mixer": {
        "display_name": "Germanium detector or mixer",
        "section": "2.5.4",
        "table": "Table 9",
        "report_page": "10",
        "pdf_page": 21,
        "limits": {},
        "inputs": {},
    },
    "saw": {
        "display_name": "Surface acoustic wave (SAW) device",
        "section": "2.6",
        "table": "Table 10",
        "report_page": "12",
        "pdf_page": 23,
        "limits": {
            "input_power": {"frequency_mhz_gt_500": 13.0, "frequency_mhz_lt_500": 18.0},
            "operating_temperature_c": 125.0,
        },
        "inputs": {
            "center_frequency_mhz": {"type": "number", "unit": "MHz", "required": True},
            "input_power": {"type": "number", "unit": "source prints dB", "required": True},
            "input_power_unit": {"type": "string", "required": True},
            "operating_temperature_c": {"type": "number", "unit": "°C", "required": True},
        },
    },
}

_MICROWAVE_INPUTS = {
    "junction_temperature_c": {"type": "number", "unit": "°C", "required": True},
    "power_dissipation_ratio": {"type": "number", "unit": "ratio", "required": True},
    "breakdown_voltage_ratio": {"type": "number", "unit": "ratio", "required": True},
}
_MICROWAVE_LIMITS_HIGH = {
    "junction_temperature_c": {"I": 95.0, "II": 105.0, "III": 125.0},
    "power_dissipation_ratio": {"I": 0.50, "II": 0.60, "III": 0.70},
    "breakdown_voltage_ratio": {"I": 0.60, "II": 0.70, "III": 0.70},
}
_MICROWAVE_LIMITS_LOW = {
    "junction_temperature_c": {"I": 95.0, "II": 105.0, "III": 125.0},
    "power_dissipation_ratio": {"I": 0.50, "II": 0.60, "III": 0.70},
    "breakdown_voltage_ratio": {"I": 0.70, "II": 0.70, "III": 0.70},
}
for _model in ("gaas_fet", "microwave_transistor_impatt_gunn"):
    _MODEL_CATALOG[_model]["limits"] = deepcopy(_MICROWAVE_LIMITS_HIGH)
    _MODEL_CATALOG[_model]["inputs"] = deepcopy(_MICROWAVE_INPUTS)
for _model in ("varactor_step_recovery_pin_tunnel", "silicon_detector_mixer"):
    _MODEL_CATALOG[_model]["limits"] = deepcopy(_MICROWAVE_LIMITS_LOW)
    _MODEL_CATALOG[_model]["inputs"] = deepcopy(_MICROWAVE_INPUTS)
_MODEL_CATALOG["germanium_detector_mixer"]["limits"] = {
    "junction_temperature_c": {"I": 75.0, "II": 90.0, "III": 105.0},
    "power_dissipation_ratio": {"I": 0.50, "II": 0.60, "III": 0.70},
    "breakdown_voltage_ratio": {"I": 0.70, "II": 0.70, "III": 0.70},
}
_MODEL_CATALOG["germanium_detector_mixer"]["inputs"] = deepcopy(_MICROWAVE_INPUTS)


_COMMON_APPLICATION_INPUTS: dict[str, dict[str, Any]] = {
    "high_reliability_application": {
        "type": "boolean",
        "required": True,
        "help": (
            "Declare whether Section 2.1.2's high-reliability screening and "
            "burn-in recommendation applies."
        ),
    },
    "quality_screening_verified": {
        "type": "boolean",
        "required_when": "high_reliability_application is true",
        "help": (
            "Affirm full lot testing and screening, including burn-in, for a "
            "high-reliability application."
        ),
    },
}

_APPLICATION_INPUTS_BY_MODEL: dict[str, dict[str, dict[str, Any]]] = {
    "hybrid": {
        "supply_voltage_control_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm design controls for supply-voltage deviations and shifted bias points.",
        },
        "esd_handling_controls_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm ESD handling precautions such as grounding.",
        },
    },
    "complex_ic": {
        "signal_noise_and_supply_controls_verified": {
            "type": "boolean",
            "required": True,
            "help": (
                "Affirm design precautions that minimize signal-line noise and "
                "control supply-voltage deviations."
            ),
        },
    },
    "ram_rom": {
        "memory_kind": {
            "type": "choice",
            "choices": ["rom", "static_ram", "dynamic_ram"],
            "required": True,
            "help": "Select the memory kind so the dynamic-RAM refresh obligation is explicit.",
        },
        "device_specification_tolerances_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm application tolerances were set from the device specification.",
        },
        "dynamic_ram_refresh_verified": {
            "type": "boolean",
            "required_when": "memory_kind is dynamic_ram",
            "help": "Affirm the dynamic RAM is refreshed and recycled as required.",
        },
    },
    "bubble_memory": {
        "device_specification_tolerances_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm application tolerances were set from the device specification.",
        },
    },
    "microwave_transistor_impatt_gunn": {
        "recommended_voltage_limits_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm all supplier-recommended voltage limits are not surpassed.",
        },
    },
    "silicon_detector_mixer": {
        "transient_esd_safeguards_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm safeguards against circuit transients and electrostatic discharge.",
        },
    },
    "germanium_detector_mixer": {
        "transient_esd_safeguards_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm safeguards against circuit transients and electrostatic discharge.",
        },
    },
    "saw": {
        "surrounding_thermal_stability_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm surrounding devices do not create an unstable thermal environment.",
        },
        "frequency_stability_control_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm the required SAW frequency stability is controlled over the application.",
        },
        "esd_stress_controls_verified": {
            "type": "boolean",
            "required": True,
            "help": "Affirm design controls minimize electrostatic-discharge stress.",
        },
    },
}

for _definition in _MODEL_CATALOG.values():
    _definition["inputs"].update(deepcopy(_COMMON_APPLICATION_INPUTS))
for _application_model, _application_inputs in _APPLICATION_INPUTS_BY_MODEL.items():
    _MODEL_CATALOG[_application_model]["inputs"].update(deepcopy(_application_inputs))

SUPPORTED_MODELS = tuple(_MODEL_CATALOG)


def get_profile_metadata() -> dict[str, Any]:
    """Return profile identity, source status, and manual level guidance."""
    return deepcopy(PROFILE_METADATA)


def get_model_catalog() -> dict[str, dict[str, Any]]:
    """Return all ten source models, exact limits, schemas, and locators."""
    return deepcopy(_MODEL_CATALOG)


def get_input_schema(model: str) -> dict[str, Any]:
    """Return the input contract and traceable limits for one source model."""
    key = _model_key(model)
    definition = deepcopy(_MODEL_CATALOG[key])
    definition["model"] = key
    definition["selected_level"] = {
        "required": key != "saw",
        "choices": list(_LEVELS) if key != "saw" else [],
        "note": (
            "Select manually; Section 2.1.3 environment mappings are guidance only."
            if key != "saw"
            else "Not applicable: Section 2.6 explicitly excludes Levels I-III."
        ),
    }
    return definition


def _canonical(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    result = value.strip().lower().replace("-", "_").replace(" ", "_")
    while "__" in result:
        result = result.replace("__", "_")
    return result


def _model_key(model: str) -> str:
    key = _canonical(model, "model")
    if key not in _MODEL_CATALOG:
        raise UnsupportedRADC84254ModelError(
            f"model must be one of {list(SUPPORTED_MODELS)}, got {model!r}"
        )
    return key


def _level(selected_level: str | None, *, model: str) -> str | None:
    if model == "saw":
        if selected_level is not None:
            raise UnsupportedRADC84254ModelError(
                "RADC-TR-84-254 Section 2.6 says Levels I-III do not apply "
                "to SAW devices; selected_level must be None"
            )
        return None
    if selected_level is None:
        raise UnsupportedRADC84254ModelError(
            "selected_level is required and must be chosen manually as I, II, or III"
        )
    level = str(selected_level).strip().upper()
    if level not in _LEVELS:
        raise UnsupportedRADC84254ModelError(
            "selected_level must be chosen manually as I, II, or III"
        )
    return level


def _number(
    params: Mapping[str, Any], name: str, *, nonnegative: bool = False,
) -> float | None:
    if name not in params or params[name] is None or params[name] == "":
        return None
    if isinstance(params[name], bool):
        raise ValueError(f"parameter '{name}' must be numeric, not boolean")
    try:
        value = float(params[name])
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"parameter '{name}' must be numeric") from exc
    if not math.isfinite(value):
        raise ValueError(f"parameter '{name}' must be finite")
    if nonnegative and value < 0.0:
        raise ValueError(f"parameter '{name}' must be non-negative")
    return value


def _boolean(params: Mapping[str, Any], name: str) -> bool | None:
    if name not in params or params[name] is None or params[name] == "":
        return None
    if not isinstance(params[name], bool):
        raise ValueError(f"parameter '{name}' must be boolean")
    return params[name]


def _choice(
    params: Mapping[str, Any], name: str, choices: tuple[str, ...],
) -> str | None:
    if name not in params or params[name] is None or params[name] == "":
        return None
    key = _canonical(params[name], name)
    if key not in choices:
        raise UnsupportedRADC84254ModelError(
            f"{name} must be one of {list(choices)}, got {params[name]!r}"
        )
    return key


def _locator(definition: Mapping[str, Any], suffix: str = "") -> str:
    locator = (
        f"RADC-TR-84-254 §{definition['section']}, {definition['table']}, "
        f"report p. {definition['report_page']} (PDF p. {definition['pdf_page']})"
    )
    return f"{locator}{suffix}"


def _numeric_max_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    limit: float | None,
    unit: str,
    locator: str,
    strict: bool = False,
    nonnegative: bool = False,
    unavailable_message: str | None = None,
) -> RADC84254Check:
    actual = _number(params, parameter, nonnegative=nonnegative)
    comparison = "<" if strict else "≤"
    if actual is None or limit is None:
        reason = unavailable_message or f"No value was supplied for '{parameter}'."
        return RADC84254Check(
            parameter=parameter,
            description=description,
            actual_value=actual,
            selected_limit=limit,
            unit=unit,
            comparison=comparison,
            status="not_evaluated",
            message=f"{reason} The source check was not evaluated.",
            source_locator=locator,
        )
    passed = actual < limit if strict else actual <= limit
    status = "ok" if passed else "exceeds"
    phrase = "meets" if passed else "does not meet"
    return RADC84254Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=limit,
        unit=unit,
        comparison=comparison,
        status=status,
        message=(
            f"{description} ({actual:g} {unit}) {phrase} the source limit "
            f"({comparison} {limit:g} {unit})."
        ),
        source_locator=locator,
    )


def _obligation_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    locator: str,
    false_status: str,
) -> RADC84254Check:
    actual = _boolean(params, parameter)
    if actual is None:
        return RADC84254Check(
            parameter=parameter,
            description=description,
            actual_value=None,
            selected_limit=True,
            unit="boolean",
            comparison="is true",
            status="not_evaluated",
            message=(
                f"No affirmative value was supplied for '{parameter}'; "
                "the dependent source requirement was not evaluated."
            ),
            source_locator=locator,
        )
    status = "ok" if actual else false_status
    return RADC84254Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=True,
        unit="boolean",
        comparison="is true",
        status=status,
        message=(
            f"{description} is affirmatively satisfied."
            if actual
            else f"{description} is not affirmatively satisfied."
        ),
        source_locator=locator,
    )


def _boolean_declaration_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    locator: str,
) -> RADC84254Check:
    """Require an explicit true/false applicability declaration."""
    actual = _boolean(params, parameter)
    if actual is None:
        return RADC84254Check(
            parameter=parameter,
            description=description,
            actual_value=None,
            selected_limit="true or false",
            unit="boolean",
            comparison="is declared",
            status="not_evaluated",
            message=(
                f"No explicit value was supplied for '{parameter}'; application "
                "of the source guidance could not be determined."
            ),
            source_locator=locator,
        )
    return RADC84254Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit="true or false",
        unit="boolean",
        comparison="is declared",
        status="ok",
        message=f"{description} was explicitly declared as {actual}.",
        source_locator=locator,
    )


def _aggregate(checks: list[RADC84254Check]) -> str:
    if any(check.status == "exceeds" for check in checks):
        return "exceeds"
    if any(check.status == "not_evaluated" for check in checks):
        return "not_evaluated"
    return "ok"


def _traceability(model: str, definition: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "source": REPORT_EDITION,
        "document_number": "RADC-TR-84-254",
        "accession": "AD-A153744",
        "document_sha256": DOCUMENT_SHA256,
        "report_status": REPORT_STATUS,
        "report_section": definition["section"],
        "table": definition["table"],
        "report_page": definition["report_page"],
        "pdf_page": definition["pdf_page"],
        "source_locator": _locator(definition),
        "authority_role": "related historical primary derating research report",
        "support_status": "supported source-specific historical screening",
        "assurance_status": (
            "verified Tables 1-10 transcription with explicit application-prose "
            "checks and warnings"
        ),
        "conformance_scope": PROFILE_METADATA["conformance_scope"],
        "level_selection": "manual; environment mapping is guidance only",
        "model": model,
    }


def _result(
    model: str,
    selected_level: str | None,
    params: Mapping[str, Any],
    checks: list[RADC84254Check],
    warnings: list[str] | None = None,
) -> RADC84254Result:
    definition = _MODEL_CATALOG[model]
    return RADC84254Result(
        model=model,
        display_name=definition["display_name"],
        selected_level=selected_level,
        status=_aggregate(checks),
        checks=tuple(checks),
        traceability=MappingProxyType(_traceability(model, definition)),
        warnings=tuple(dict.fromkeys((*((warnings or [])), _GENERAL_WARNING))),
        inputs=MappingProxyType(dict(params)),
    )


def _application_prose_checks(
    model: str,
    params: Mapping[str, Any],
) -> tuple[list[RADC84254Check], list[str]]:
    """Evaluate explicit application controls that accompany Tables 1--10."""
    quality_locator = (
        "RADC-TR-84-254 §2.1.2, report pp. 3-4 (PDF pp. 14-15)"
    )
    checks = [_boolean_declaration_check(
        params,
        parameter="high_reliability_application",
        description="High-reliability application applicability",
        locator=quality_locator,
    )]
    high_reliability = _boolean(params, "high_reliability_application")
    if high_reliability:
        checks.append(_obligation_check(
            params,
            parameter="quality_screening_verified",
            description=(
                "Parts are fully tested and screened, including burn-in, for the "
                "high-reliability application"
            ),
            locator=quality_locator,
            false_status="exceeds",
        ))

    warnings: list[str] = [
        "Section 2.1.2 says derating cannot compensate for a part-quality level "
        "below that required by the application."
    ]

    if model == "hybrid":
        locator = "RADC-TR-84-254 §2.2 Application, report p. 4 (PDF p. 15)"
        checks.extend((
            _obligation_check(
                params,
                parameter="supply_voltage_control_verified",
                description=(
                    "Hybrid supply-voltage deviations and resulting bias shifts are "
                    "controlled by design"
                ),
                locator=locator,
                false_status="exceeds",
            ),
            _obligation_check(
                params,
                parameter="esd_handling_controls_verified",
                description="Hybrid ESD handling precautions, such as grounding, are in place",
                locator=locator,
                false_status="exceeds",
            ),
        ))
        warnings.append(
            "Hybrid supply-voltage deviations can shift bias points and, with thermal "
            "effects, cause erratic performance; some hybrids are ESD-susceptible."
        )
    elif model == "complex_ic":
        locator = "RADC-TR-84-254 §2.3 Application, report p. 5 (PDF p. 16)"
        checks.append(_obligation_check(
            params,
            parameter="signal_noise_and_supply_controls_verified",
            description=(
                "Complex-IC design precautions minimize signal-line noise and control "
                "supply-voltage deviations"
            ),
            locator=locator,
            false_status="exceeds",
        ))
        technology = _choice(params, "technology", ("bipolar", "mos", "cmos"))
        if technology in {"mos", "cmos"}:
            warnings.append(
                "The report identifies MOS/CMOS complex devices as highly sensitive "
                "to electrostatic-discharge damage from signal-line noise."
            )
        if technology == "bipolar":
            warnings.append(
                "The report warns that bipolar supply deviations can shift bias points "
                "and combine with thermal effects."
            )
        if technology == "cmos":
            warnings.append(
                "The report specifically identifies parasitic bipolar latch-up as a "
                "CMOS hazard."
            )
        if technology is None:
            warnings.append(
                "Technology was not needed for a non-digital Table 2 row; retain the "
                "report's MOS/CMOS ESD, bipolar bias-shift, and CMOS latch-up hazards "
                "when selecting design controls."
            )
    elif model == "ram_rom":
        locator = "RADC-TR-84-254 §2.4 Application, report p. 7 (PDF p. 18)"
        memory_kind = _choice(
            params, "memory_kind", ("rom", "static_ram", "dynamic_ram")
        )
        if memory_kind is None:
            checks.append(RADC84254Check(
                parameter="memory_kind",
                description="RAM/ROM application kind",
                actual_value=None,
                selected_limit="rom, static_ram, or dynamic_ram",
                unit="choice",
                comparison="is selected",
                status="not_evaluated",
                message=(
                    "No memory_kind was supplied; the dynamic-RAM refresh obligation "
                    "could not be evaluated."
                ),
                source_locator=locator,
            ))
        checks.append(_obligation_check(
            params,
            parameter="device_specification_tolerances_verified",
            description="Memory application tolerances are set from the device specification",
            locator=locator,
            false_status="exceeds",
        ))
        if memory_kind == "dynamic_ram":
            checks.append(_obligation_check(
                params,
                parameter="dynamic_ram_refresh_verified",
                description="Dynamic RAM refresh and recycle requirements are satisfied",
                locator=locator,
                false_status="exceeds",
            ))
        warnings.extend((
            "MOS memory high-voltage capability falls rapidly as device dimensions shrink.",
            "Bipolar memory use remains constrained by current drain and power dissipation.",
        ))
    elif model == "bubble_memory":
        locator = "RADC-TR-84-254 §2.4 Application, report p. 7 (PDF p. 18)"
        checks.append(_obligation_check(
            params,
            parameter="device_specification_tolerances_verified",
            description=(
                "Bubble-memory application tolerances are set from the device specification"
            ),
            locator=locator,
            false_status="exceeds",
        ))
    elif model == "gaas_fet":
        warnings.append(
            "Section 2.5.1 identifies switching transients and electrostatic discharge "
            "as GaAs-FET damage hazards (report p. 8 / PDF p. 19)."
        )
    elif model == "microwave_transistor_impatt_gunn":
        locator = "RADC-TR-84-254 §2.5.2 Application, report p. 9 (PDF p. 20)"
        checks.append(_obligation_check(
            params,
            parameter="recommended_voltage_limits_verified",
            description="Supplier-recommended microwave-device voltage levels are not surpassed",
            locator=locator,
            false_status="exceeds",
        ))
        warnings.append(
            "These high-electrical-stress devices can operate near maximum power; the "
            "source calls applied voltage a major correct-operation concern."
        )
    elif model == "varactor_step_recovery_pin_tunnel":
        warnings.append(
            "Section 2.5.3 says these low-power devices should not see unusually large "
            "power stress and that high junction temperature is destructive; the Table 7 "
            "power and temperature checks are the report's numeric controls."
        )
    elif model in {"silicon_detector_mixer", "germanium_detector_mixer"}:
        locator = "RADC-TR-84-254 §2.5.4 Application, report p. 9 (PDF p. 20)"
        checks.append(_obligation_check(
            params,
            parameter="transient_esd_safeguards_verified",
            description="Detector/mixer safeguards against circuit transients and ESD are in place",
            locator=locator,
            false_status="exceeds",
        ))
        warnings.append(
            "The report identifies circuit transients and electrostatic discharge as "
            "detector/mixer diode-burnout hazards."
        )
    elif model == "saw":
        locator = "RADC-TR-84-254 §2.6 Application, report p. 11 (PDF p. 22)"
        checks.extend((
            _obligation_check(
                params,
                parameter="surrounding_thermal_stability_verified",
                description=(
                    "Surrounding devices do not create an unstable SAW thermal environment"
                ),
                locator=locator,
                false_status="exceeds",
            ),
            _obligation_check(
                params,
                parameter="frequency_stability_control_verified",
                description="Required SAW frequency stability is controlled",
                locator=locator,
                false_status="exceeds",
            ),
            _obligation_check(
                params,
                parameter="esd_stress_controls_verified",
                description="SAW electrostatic-discharge stress is minimized by design",
                locator=locator,
                false_status="exceeds",
            ),
        ))
        warnings.append(
            "SAW heat generation is minimal, so surrounding-device and ambient conditions "
            "govern operating temperature."
        )
    return checks, warnings


def _evaluate_hybrid(
    params: Mapping[str, Any], level: str,
) -> tuple[list[RADC84254Check], list[str]]:
    definition = _MODEL_CATALOG["hybrid"]
    limits = definition["limits"]
    locator = _locator(definition)
    checks = [
        _numeric_max_check(
            params,
            parameter="junction_temperature_c",
            description="Maximum junction temperature",
            limit=limits["junction_temperature_c"][level],
            unit="°C",
            locator=locator,
        )
    ]
    construction = _choice(
        params, "film_construction", ("none", "thick", "thin", "both")
    )
    if construction is None:
        checks.append(RADC84254Check(
            parameter="film_construction",
            description="Applicable film construction declaration",
            actual_value=None,
            selected_limit="none, thick, thin, or both",
            unit="choice",
            comparison="is declared",
            status="not_evaluated",
            message=(
                "The report says a hybrid may use thick or thin film; applicability "
                "was not declared, so its film-density requirements were not evaluated."
            ),
            source_locator=locator,
        ))
    elif construction != "none":
        case_temperature = _number(params, "case_temperature_c")
        constructions = (
            ("thick",) if construction == "thick"
            else ("thin",) if construction == "thin"
            else ("thick", "thin")
        )
        for film in constructions:
            parameter = f"{film}_film_power_density_w_per_in2"
            base_limit = limits[parameter][level]
            adjusted_limit = (
                None
                if case_temperature is None
                else base_limit - max(case_temperature - 100.0, 0.0)
            )
            checks.append(_numeric_max_check(
                params,
                parameter=parameter,
                description=f"{film.title()}-film power density",
                limit=adjusted_limit,
                unit="W/in²",
                locator=f"{locator}, note below Table 1",
                strict=True,
                nonnegative=True,
                unavailable_message=(
                    "No case_temperature_c was supplied, so the Table 1 "
                    "above-100 °C adjustment cannot be determined."
                    if case_temperature is None
                    else None
                ),
            ))
    checks.extend((
        _obligation_check(
            params,
            parameter="constituent_checks_complete",
            description=(
                "Every individual element/device in the hybrid was checked under "
                "the separately referenced AFSC Pamphlet 800-27 guidelines"
            ),
            locator=f"{locator}, paragraph immediately above Table 1",
            false_status="not_evaluated",
        ),
        _obligation_check(
            params,
            parameter="constituent_checks_passed",
            description="All applicable individual hybrid constituent checks passed",
            locator=f"{locator}, paragraph immediately above Table 1",
            false_status="exceeds",
        ),
    ))
    warnings = [
        "Table 1 requires separate derating of every constituent element/device "
        "under AFSC Pamphlet 800-27; the two affirmative constituent inputs are "
        "required because that referenced rulebook is outside this table profile."
    ]
    return checks, warnings


def _evaluate_complex_ic(
    params: Mapping[str, Any], level: str,
) -> tuple[list[RADC84254Check], list[str]]:
    definition = _MODEL_CATALOG["complex_ic"]
    limits = definition["limits"]
    locator = _locator(definition)
    checks = [
        _numeric_max_check(
            params, parameter="junction_temperature_c",
            description="Maximum junction temperature",
            limit=limits["junction_temperature_c"][level], unit="°C", locator=locator,
        ),
        _numeric_max_check(
            params, parameter="supply_voltage_ratio",
            description="Supply voltage as a fraction of rated value",
            limit=limits["supply_voltage_ratio"][level], unit="ratio", locator=locator,
            nonnegative=True,
        ),
        _numeric_max_check(
            params, parameter="output_current_ratio",
            description="Output current as a fraction of rated value",
            limit=limits["output_current_ratio"][level], unit="ratio", locator=locator,
            nonnegative=True,
        ),
    ]
    technology = _choice(params, "technology", ("bipolar", "mos", "cmos"))
    digital = _boolean(params, "digital")
    warnings = [
        "The Table 2 title prints LSI twice; the surrounding section explicitly "
        "scopes the fourth group as VLSI.",
        "A later basis narrative prints a 110 °C Level III value, but this profile "
        "uses the normative Table 2 value of 125 °C.",
    ]
    if digital is True and technology is None:
        checks.append(RADC84254Check(
            parameter="technology",
            description="Technology row for digital fan-out/frequency limits",
            actual_value=None,
            selected_limit="bipolar, mos, or cmos",
            unit="choice",
            comparison="is selected",
            status="not_evaluated",
            message="No technology was supplied; technology-dependent rows were not evaluated.",
            source_locator=locator,
        ))
    if digital is None:
        checks.append(RADC84254Check(
            parameter="digital",
            description="Applicability of the digital-only rows",
            actual_value=None,
            selected_limit=True,
            unit="boolean",
            comparison="is declared",
            status="not_evaluated",
            message="Digital applicability was not declared; digital-only rows were not evaluated.",
            source_locator=locator,
        ))
    elif digital and technology is not None:
        row = "mos" if technology == "cmos" else technology
        checks.extend((
            _numeric_max_check(
                params, parameter="fan_out_ratio",
                description=f"Digital fan-out ({row.upper()} row)",
                limit=limits["fan_out_ratio"][row][level], unit="ratio", locator=locator,
                nonnegative=True,
            ),
            _numeric_max_check(
                params, parameter="operating_frequency_ratio",
                description=f"Digital operating frequency ({row.upper()} row)",
                limit=limits["operating_frequency_ratio"][row][level],
                unit="ratio", locator=locator, nonnegative=True,
            ),
        ))
        if technology == "cmos":
            warnings.append(
                "Table 2 labels the non-bipolar fan-out/frequency row 'MOS'. "
                "Applying that row to CMOS follows the section's stated CMOS scope; "
                "the source does not print a separate CMOS row."
            )
    supply = _number(params, "supply_voltage_ratio", nonnegative=True)
    if supply is not None and supply < 0.75:
        warnings.append(
            "Table 2 note: designing below 75% of rated supply voltage may place "
            "the device below its recommended operating voltage."
        )
    return checks, warnings


def _evaluate_plain_limits(
    model: str, params: Mapping[str, Any], level: str,
) -> tuple[list[RADC84254Check], list[str]]:
    definition = _MODEL_CATALOG[model]
    limits = definition["limits"]
    locator = _locator(definition)
    descriptions = {
        "junction_temperature_c": "Maximum junction temperature",
        "ambient_operating_temperature_c": "Maximum ambient operating temperature",
        "supply_voltage_ratio": "Supply voltage as a fraction of rated value",
        "output_current_ratio": "Output current as a fraction of rated value",
        "power_dissipation_ratio": "Power dissipation as a fraction of rated value",
        "breakdown_voltage_ratio": "Breakdown voltage as a fraction of rated value",
    }
    checks: list[RADC84254Check] = []
    for parameter, by_level in limits.items():
        checks.append(_numeric_max_check(
            params,
            parameter=parameter,
            description=descriptions[parameter],
            limit=by_level[level],
            unit="°C" if parameter.endswith("temperature_c") else "ratio",
            locator=locator,
            nonnegative=parameter.endswith("_ratio"),
        ))
    warnings: list[str] = []
    if model == "bubble_memory":
        checks.extend((
            _obligation_check(
                params,
                parameter="support_device_checks_complete",
                description="All external support microelectronic devices were checked",
                locator=f"{locator}, paragraph immediately above Table 3",
                false_status="not_evaluated",
            ),
            _obligation_check(
                params,
                parameter="support_device_checks_passed",
                description="All applicable external support-device checks passed",
                locator=f"{locator}, paragraph immediately above Table 3",
                false_status="exceeds",
            ),
        ))
        warnings.append(
            "Section 2.4 requires the external support microelectronic devices to "
            "be checked separately; Table 4 alone is not a complete bubble-memory pass."
        )
    if model == "germanium_detector_mixer":
        warnings.append(
            "Section 2.5.4 states that germanium devices are not recommended for use; "
            "Table 9 limits are retained only because the report nevertheless prints them."
        )
    return checks, warnings


def _evaluate_saw(
    params: Mapping[str, Any],
) -> tuple[list[RADC84254Check], list[str]]:
    definition = _MODEL_CATALOG["saw"]
    locator = _locator(definition)
    frequency = _number(params, "center_frequency_mhz", nonnegative=True)
    power = _number(params, "input_power")
    unit = None
    if "input_power_unit" in params and params["input_power_unit"] not in (None, ""):
        if not isinstance(params["input_power_unit"], str):
            raise ValueError("parameter 'input_power_unit' must be a string")
        unit = params["input_power_unit"].strip()

    if frequency is None:
        branch_limit = None
        branch_message = "No center_frequency_mhz was supplied."
    elif frequency == 500.0:
        branch_limit = None
        branch_message = (
            "Table 10 defines only <500 MHz and >500 MHz branches; exactly "
            "500 MHz is undefined."
        )
    elif not 50.0 <= frequency <= 2000.0:
        branch_limit = None
        branch_message = (
            "The frequency is outside Section 2.6's reported nominal 50 MHz to "
            "about 2 GHz SAW range."
        )
    else:
        branch_limit = 13.0 if frequency > 500.0 else 18.0
        branch_message = (
            "Table 10 prints input power in unreferenced dB.  Because dB is a "
            "relative quantity and the report supplies no reference, its numerical "
            "threshold cannot be applied as an absolute power limit."
        )

    missing = []
    if power is None:
        missing.append("input_power")
    if unit is None:
        missing.append("input_power_unit")
    if missing:
        branch_message = (
            f"No value was supplied for {', '.join(missing)}. " + branch_message
        )
    elif unit.lower() != "db":
        branch_message += (
            f" The supplied unit {unit!r} is not the report's printed 'dB'; "
            "substituting dBm or another absolute unit would alter the source."
        )

    checks = [RADC84254Check(
        parameter="input_power",
        description="Input-power limit for the applicable center-frequency branch",
        actual_value=power,
        selected_limit=branch_limit,
        unit=unit or "source prints dB",
        comparison="source maximum (unresolved)",
        status="not_evaluated",
        message=f"{branch_message} The input-power check was not evaluated.",
        source_locator=locator,
    )]
    checks.append(_numeric_max_check(
        params,
        parameter="operating_temperature_c",
        description="Maximum operating temperature",
        limit=125.0,
        unit="°C",
        locator=locator,
    ))
    warnings = [
        "Section 2.6 explicitly says Levels I-III do not apply to SAW devices.",
        "Table 10's exactly-500-MHz branch is undefined and its input-power unit "
        "is unreferenced dB; neither ambiguity is silently resolved by this profile.",
    ]
    return checks, warnings


def analyze_radc_tr_84_254(
    model: str,
    params: Mapping[str, Any],
    *,
    selected_level: str | None = None,
) -> RADC84254Result:
    """Evaluate one device against its exact RADC-TR-84-254 table rows.

    ``selected_level`` is mandatory for Tables 1--9 and must be chosen manually.
    It must be omitted for Table 10 because the source explicitly says the three
    levels do not apply to SAW devices.  Missing applicable values yield a
    ``not_evaluated`` result; they never count as a pass.
    """
    key = _model_key(model)
    if not isinstance(params, Mapping):
        raise ValueError("params must be a mapping")
    level = _level(selected_level, model=key)

    if key == "hybrid":
        checks, warnings = _evaluate_hybrid(params, level)  # type: ignore[arg-type]
    elif key == "complex_ic":
        checks, warnings = _evaluate_complex_ic(params, level)  # type: ignore[arg-type]
    elif key == "saw":
        checks, warnings = _evaluate_saw(params)
    else:
        checks, warnings = _evaluate_plain_limits(key, params, level)  # type: ignore[arg-type]
    application_checks, application_warnings = _application_prose_checks(key, params)
    checks.extend(application_checks)
    warnings.extend(application_warnings)
    return _result(key, level, params, checks, warnings)


def assess(
    device_type: str,
    params: Mapping[str, Any],
    level: str | None = None,
) -> RADC84254Result:
    """Generic dispatcher for API integrations using a ``derating_params`` bag."""
    return analyze_radc_tr_84_254(
        device_type, params, selected_level=level,
    )


# Short, discoverable alias for callers already operating inside this module.
analyze_derating = analyze_radc_tr_84_254
