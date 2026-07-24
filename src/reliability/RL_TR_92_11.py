"""Source-isolated derating criteria from RL-TR-92-11.

This module transcribes the directly executable final criteria in Tables
4-7, 4-11, 4-15, 5-3, 6-4, 6-7, 6-9, 7-3, 8-2, 9-2, and 10-2 of
*Advanced Technology Component Derating*, RL-TR-92-11, February 1992
(AD-A253334).  RL-TR-92-11 is a historical final technical report, not an
issued military standard, so a passing result is a source-specific screening
result and not a standards-conformance claim.

The implementation is deliberately fail closed.  Missing supplier limits,
unverified safe-operating-area obligations, undefined source boundaries, and
unsupported source regimes never count as passes.  The reliability-model
derivations used by the report to develop the final tables are intentionally
not automated here; only the published final criteria and their explicit
application obligations are executable.  The MIL-STD-198E capacitor
cross-reference is decomposed into source-located advisory coverage checks;
because that standard labels its application information nonmandatory, those
checks never masquerade as hard-limit failures.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation
import math
from types import MappingProxyType
from typing import Any, Mapping


__all__ = (
    "DOCUMENT_ID",
    "DOCUMENT_TITLE",
    "DOCUMENT_DATE",
    "DOCUMENT_STATUS",
    "DOCUMENT_SHA256",
    "MIL_STD_198E_SOURCE_HASHES",
    "PROFILE_METADATA",
    "SUPPORTED_MODELS",
    "UnsupportedRLTR9211ModelError",
    "RLTR9211Check",
    "RLTR9211Result",
    "get_profile_metadata",
    "get_model_catalog",
    "get_input_schema",
    "profile_schema",
    "assess",
)


DOCUMENT_ID = "RL-TR-92-11"
DOCUMENT_TITLE = "Advanced Technology Component Derating"
DOCUMENT_DATE = "February 1992"
DOCUMENT_STATUS = "Final technical report; not an issued military standard"
DOCUMENT_SHA256 = "1dfb5dd71a0503a72cdfe19bafc4777bf0216e0f32855e05d44e8dfec09d9625"
MIL_STD_198E_SOURCE_HASHES = MappingProxyType({
    "base": "ab159381fbc2cecf249088252ca9e5d8c5afb88b00f7fdfee9810d15d6192a77",
    "notice_1": "a2631090385bd78f3f7a9a7c22c571158ecf48240d39fed5d1417daeac6c3d0d",
    "notice_2": "789b3ad07f521a60d2d9180a1d5fd553784c6697c2abbea83217d658aa358642",
    "notice_3": "9a8a838d8a90f169596fe936d3e37239b182788cfc6815b25188e40f9c57f13a",
})

_LEVELS = ("I", "II", "III")
_GENERAL_WARNING = (
    "RL-TR-92-11 is a historical final technical report, not an issued "
    "military standard; this result is source-specific screening rather than "
    "a standards-conformance claim."
)
_LEVEL_WARNING = (
    "Criticality Level I, II, or III must be selected manually; this module "
    "does not infer a level from environment or mission labels."
)

PROFILE_METADATA: dict[str, Any] = {
    "profile_id": DOCUMENT_ID,
    "title": DOCUMENT_TITLE,
    "edition": DOCUMENT_DATE,
    "accession": "AD-A253334",
    "source_type": "Final Technical Report",
    "source_status": DOCUMENT_STATUS,
    "document_sha256": DOCUMENT_SHA256,
    "implementation_status": "verified final-table historical screening profile",
    "conformance_claim": False,
    "conformance_scope": (
        "Directly executable final criteria in RL-TR-92-11 Tables 4-7, 4-11, "
        "4-15, 5-3, 6-4, 6-7, 6-9, 7-3, 8-2, 9-2, and 10-2, together with "
        "the explicit application obligations on report pp. 87, 96, 117, "
        "126, 130, 134, and 135"
    ),
    "excluded_scope": (
        "Intermediate reliability-model derivations, suspect derivation tables, "
        "and graphical on-off-cycle interpolation are not automated."
    ),
    "reviewed_cross_references": {
        "MIL-STD-198E": {
            "scope": (
                "Foreword, general capacitor application guidance §6.5, "
                "CWR §703.1, CDR §903.1 as superseded by Notice 2, and "
                "Notices 1–3"
            ),
            "source_sha256": dict(MIL_STD_198E_SOURCE_HASHES),
            "status": (
                "canceled by Notice 3 on 14 July 1999; information preserved "
                "in guidance-only MIL-HDBK-198"
            ),
        },
    },
    "level_selection": {
        "mode": "manual",
        "levels": ["I", "II", "III"],
    },
}


class UnsupportedRLTR9211ModelError(ValueError):
    """Raised when a requested model or source interpretation is unsupported."""


@dataclass(frozen=True)
class RLTR9211Check:
    """One immutable, row-traceable RL-TR-92-11 check."""

    parameter: str
    description: str
    actual_value: float | bool | str | None
    selected_limit: float | bool | str | None
    unit: str
    comparison: str
    status: str
    message: str
    source_locator: str
    formula: str | None = None
    substitution: str | None = None

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
            "formula": self.formula,
            "substitution": self.substitution,
        }


@dataclass(frozen=True)
class RLTR9211Result:
    """Immutable aggregate result for one source model and manual level."""

    model: str
    display_name: str
    selected_level: str
    status: str
    checks: tuple[RLTR9211Check, ...]
    traceability: Mapping[str, Any]
    warnings: tuple[str, ...]
    inputs: Mapping[str, Any]

    @property
    def passed(self) -> bool:
        """Return true only when every applicable source check passed."""
        return self.status == "ok"

    @property
    def assessment_complete(self) -> bool:
        """Return true when no applicable item remains unknown or unsupported."""
        return self.status in {"ok", "exceeds"}

    @property
    def compliance_status(self) -> str:
        """Report evaluated violations independently of source coverage."""
        if any(check.status == "exceeds" for check in self.checks):
            return "exceeds"
        return "within_evaluated_limits"

    @property
    def coverage_status(self) -> str:
        """Report whether every applicable rule or advisory was resolved."""
        if any(
            check.status in {"not_evaluated", "unsupported"}
            for check in self.checks
        ):
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
            "assessment_complete": self.assessment_complete,
            "screening_outcome": "pass" if self.passed else "not_passed",
            "conformance_claim": False,
            "checks": [check.long_form for check in self.checks],
            "traceability": dict(self.traceability),
            "warnings": list(self.warnings),
            "inputs": dict(self.inputs),
        }


def _levels(level_i: float, level_ii: float, level_iii: float) -> dict[str, float]:
    return {"I": float(level_i), "II": float(level_ii), "III": float(level_iii)}


def _number_field(
    unit: str,
    *,
    required: bool = True,
    minimum: float | None = 0.0,
    step: float | None = None,
    help_text: str | None = None,
    required_when: str | None = None,
) -> dict[str, Any]:
    field: dict[str, Any] = {"type": "number", "unit": unit, "required": required}
    if minimum is not None:
        field["min"] = minimum
    if step is None:
        if unit == "°C":
            step = 1.0
        elif "%" in unit:
            step = 0.1
        elif unit == "ratio":
            step = 0.01
        elif unit in {"count", "bits", "gates", "transistors", "cycles"}:
            step = 1.0
        else:
            step = 0.01
    field["step"] = step
    if help_text:
        field["help"] = help_text
    if required_when:
        field["required_when"] = required_when
    return field


def _integer_field(*, minimum: int = 0, help_text: str | None = None) -> dict[str, Any]:
    field = _number_field("count", minimum=float(minimum), step=1.0, help_text=help_text)
    field["integer"] = True
    return field


def _boolean_field(
    help_text: str,
    *,
    required: bool = True,
    required_when: str | None = None,
) -> dict[str, Any]:
    field: dict[str, Any] = {
        "type": "boolean",
        "required": required,
        "help": help_text,
    }
    if required_when:
        field["required_when"] = required_when
    return field


def _source(
    section: str,
    table: str,
    report_page: str,
    pdf_page: int,
) -> dict[str, Any]:
    return {
        "section": section,
        "table": table,
        "report_page": report_page,
        "pdf_page": pdf_page,
    }


_SUPPLY_FIELDS = {
    "supply_voltage_v": _number_field("V"),
    "supplier_min_supply_v": _number_field(
        "V", help_text="Supplier-specified minimum usable supply voltage."
    ),
    "supplier_max_supply_v": _number_field(
        "V", help_text="Supplier-specified maximum usable supply voltage."
    ),
}
_BIPOLAR_SUPPLY_FIELDS = {
    **_SUPPLY_FIELDS,
    "supply_tolerance_pct": _number_field(
        "%", help_text="Worst-case positive or negative supply tolerance magnitude."
    ),
}
_DIGITAL_FIELDS = {
    "frequency_pct_of_max": _number_field("% of specified maximum"),
    "output_current_pct_of_rated": _number_field("% of rated"),
    "fanout_pct_of_rated": _number_field("% of rated"),
}
_T_J_FIELDS = {
    "junction_temperature_c": _number_field("°C", minimum=None),
    "supplier_max_junction_temperature_c": _number_field(
        "°C",
        minimum=None,
        help_text="Supplier-specified maximum junction temperature.",
    ),
}

_CURRENT_DENSITY_FIELDS = {
    "aluminum_metallization_used": _boolean_field(
        "Select Yes when either internal circuitry or an output driver uses "
        "aluminum-based metallization. RL-TR-92-11's current-density rule "
        "applies only in that case."
    ),
    "current_density_a_per_cm2": _number_field(
        "A/cm²",
        required=False,
        help_text=(
            "Worst-case current density across internal operation and output "
            "drivers. Required for aluminum-based metallization."
        ),
        required_when="aluminum_metallization_used is true",
    ),
    "current_density_duration_hours": _number_field(
        "hours",
        required=False,
        step=1.0,
        help_text=(
            "Required service duration for the current-density decision. "
            "Figure 4-34 is explicitly a 10,000-hour curve; other durations "
            "have no executable conversion in the report."
        ),
        required_when="aluminum_metallization_used is true",
    ),
}

_DIGITAL_APPLICATION_FIELDS = {
    "unused_inputs_terminated": _boolean_field(
        "Affirm that unused digital inputs are connected to a supply voltage or ground."
    ),
    "supply_transient_filtering_verified": _boolean_field(
        "Affirm that supply filtering is provided to reject transients."
    ),
    "digital_design_margins_verified": _boolean_field(
        "Affirm design allowances of +100% input leakage, -20% fan-out, and "
        "-10% frequency, plus conservative treatment of hold and propagation delays."
    ),
    "reverse_voltage_avoided": _boolean_field(
        "Affirm that the circuit cannot apply reverse voltage to device leads."
    ),
    **_CURRENT_DENSITY_FIELDS,
}

_LINEAR_APPLICATION_FIELDS = {
    "linear_performance_envelope_verified": _boolean_field(
        "Affirm that the unique linear device remains within its performance "
        "envelope for every operating condition."
    ),
    "linear_design_margins_verified": _boolean_field(
        "Affirm design allowances of -20% gain and +50% offset voltages and currents."
    ),
    "reverse_voltage_avoided": _boolean_field(
        "Affirm that the circuit cannot apply reverse voltage to device leads."
    ),
    **_CURRENT_DENSITY_FIELDS,
}

def _entry(
    display_name: str,
    category_hints: list[str],
    source: dict[str, Any],
    inputs: dict[str, Any],
    limits: dict[str, Any],
    *,
    executable: bool = True,
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "display_name": display_name,
        "category_hints": category_hints,
        "source": source,
        "inputs": inputs,
        "limits": limits,
        "executable": executable,
        "reason": reason,
    }


_ASIC_SOURCE = _source("4.1", "Table 4-7", "54", 62)
_MICROPROCESSOR_SOURCE = _source("4.2", "Table 4-11", "74", 82)
_PROM_SOURCE = _source("4.3", "Table 4-15", "86", 94)
_MIMIC_SOURCE = _source("5.0", "Table 5-3", "95", 103)
_POWER_BIPOLAR_SOURCE = _source("6.1", "Table 6-4", "104", 112)
_POWER_GAAS_SOURCE = _source("6.2", "Table 6-7", "113", 121)
_POWER_MOS_SOURCE = _source("6.3", "Table 6-9", "116", 124)
_RF_SOURCE = _source("7.0", "Table 7-3", "125", 133)
_OPTO_SOURCE = _source("8.0", "Table 8-2", "129", 137)
_PASSIVE_SOURCE = _source("9.0", "Table 9-2", "133", 141)
_SAW_SOURCE = _source("10.0", "Table 10-2", "137", 145)

_MIL198_COMMON_CAPACITOR_FIELDS = {
    "transient_voltage_present": _boolean_field(
        "Declare whether the capacitor sees any short-duration voltage "
        "transient beyond the entered DC bias and peak AC component."
    ),
    "maximum_applied_peak_voltage_including_transients_pct_of_rated": _number_field(
        "% of rated",
        required=False,
        help_text=(
            "Maximum instantaneous applied-voltage magnitude, including DC, "
            "AC, and short-duration transients. MIL-STD-198E treats this as "
            "guidance rather than a mandatory requirement."
        ),
        required_when="transient_voltage_present is true",
    ),
    "ac_or_pulse_service": _boolean_field(
        "Declare whether the application includes AC or pulse service. A "
        "nonzero peak AC input requires Yes."
    ),
    "special_ac_pulse_rating_and_test_evidence_verified": _boolean_field(
        "Confirm that application-specific AC/pulse ratings or test evidence "
        "were reviewed; most historical military capacitor specifications did "
        "not cover that service.",
        required=False,
        required_when="ac_or_pulse_service is true",
    ),
    "peak_charge_discharge_current_and_time_constant_reviewed": _boolean_field(
        "Confirm review of peak charge/discharge current and the circuit time constant."
    ),
    "internal_heating_and_ambient_reviewed": _boolean_field(
        "Confirm review of capacitor internal heating together with worst-case ambient temperature."
    ),
    "environmental_conditions_reviewed": _boolean_field(
        "Confirm review of the applicable storage and operating environments."
    ),
    "insulation_resistance_at_temperature_reviewed": _boolean_field(
        "Confirm review of insulation resistance at the applicable temperature."
    ),
}


_DEVICE_CATALOG: dict[str, dict[str, Any]] = {
    "asic_mos_digital": _entry(
        "ASIC/VHSIC — MOS digital",
        ["microcircuit", "vhsic_microcircuit", "detailed_cmos"],
        _ASIC_SOURCE,
        {
            "gate_count": _integer_field(minimum=1),
            **_SUPPLY_FIELDS,
            **_DIGITAL_FIELDS,
            **_T_J_FIELDS,
            **_DIGITAL_APPLICATION_FIELDS,
        },
        {
            "supply_voltage_formula": {
                "I": "129/G^0.320", "II": "173/G^0.347", "III": "157/G^0.323",
            },
            "frequency_pct_of_max": _levels(80, 80, 80),
            "output_current_pct_of_rated": _levels(70, 75, 80),
            "fanout_pct_of_rated": _levels(80, 80, 90),
            "junction_temperature_c": _levels(80, 121, 125),
            "maximum_gate_count": _levels(60000, 60000, 60000),
        },
    ),
    "asic_mos_linear": _entry(
        "ASIC/VHSIC — MOS linear",
        ["microcircuit", "vhsic_microcircuit", "detailed_cmos"],
        _ASIC_SOURCE,
        {
            "transistor_count": _integer_field(minimum=1),
            **_SUPPLY_FIELDS,
            "input_voltage_pct_of_rated": _number_field("% of rated"),
            **_DIGITAL_FIELDS,
            **_T_J_FIELDS,
            **_LINEAR_APPLICATION_FIELDS,
        },
        {
            "supply_voltage_formula": {
                "I": "200/TR^0.315", "II": "189/TR^0.311", "III": "210/TR^0.347",
            },
            "input_voltage_pct_of_rated": _levels(60, 70, 70),
            "frequency_pct_of_max": _levels(80, 80, 80),
            "output_current_pct_of_rated": _levels(70, 75, 80),
            "fanout_pct_of_rated": _levels(80, 80, 90),
            "junction_temperature_c": _levels(83, 109, 125),
            "maximum_transistor_count": _levels(10000, 10000, 10000),
        },
    ),
    "asic_bipolar_digital": _entry(
        "ASIC/VHSIC — bipolar digital",
        ["microcircuit", "vhsic_microcircuit"],
        _ASIC_SOURCE,
        {
            "gate_count": _integer_field(minimum=1),
            **_BIPOLAR_SUPPLY_FIELDS,
            **_DIGITAL_FIELDS,
            **_T_J_FIELDS,
            **_DIGITAL_APPLICATION_FIELDS,
        },
        {
            "supply_tolerance_pct": _levels(3, 5, 5),
            "frequency_pct_of_max": _levels(75, 80, 90),
            "output_current_pct_of_rated": _levels(70, 75, 80),
            "fanout_pct_of_rated": _levels(70, 75, 80),
            "junction_temperature_c": _levels(72, 85, 125),
            "maximum_gate_count": _levels(60000, 26000, 60000),
        },
    ),
    "asic_bipolar_linear": _entry(
        "ASIC/VHSIC — bipolar linear",
        ["microcircuit", "vhsic_microcircuit"],
        _ASIC_SOURCE,
        {
            "transistor_count": _integer_field(minimum=1),
            **_BIPOLAR_SUPPLY_FIELDS,
            "input_voltage_pct_of_rated": _number_field("% of rated"),
            **_DIGITAL_FIELDS,
            **_T_J_FIELDS,
            **_LINEAR_APPLICATION_FIELDS,
        },
        {
            "supply_tolerance_pct": _levels(3, 5, 5),
            "input_voltage_pct_of_rated": _levels(60, 70, 70),
            "frequency_pct_of_max": _levels(75, 80, 90),
            "output_current_pct_of_rated": _levels(70, 75, 80),
            "fanout_pct_of_rated": _levels(70, 75, 80),
            "junction_temperature_c": _levels(83, 109, 125),
            "maximum_transistor_count": _levels(10000, 10000, 10000),
        },
    ),
}


def _microprocessor_entry(technology: str, width: int) -> dict[str, Any]:
    mos = technology == "mos"
    inputs: dict[str, Any] = {}
    if mos and width in {16, 32}:
        inputs["gate_count"] = _integer_field(minimum=1)
    if not mos and width == 16:
        inputs["gate_count"] = _integer_field(minimum=1)
    inputs.update(_SUPPLY_FIELDS if mos else _BIPOLAR_SUPPLY_FIELDS)
    inputs.update(_DIGITAL_FIELDS)
    inputs.update(_T_J_FIELDS)
    inputs.update(_DIGITAL_APPLICATION_FIELDS)
    if mos:
        supply: Any = (
            _levels(10, 11, 13)
            if width == 8
            else {
                "I": "606/G^0.440", "II": "760/G^0.462", "III": "698/G^0.438",
            }
            if width == 16
            else {
                "I": "642/G^0.442", "II": "627/G^0.448", "III": "696/G^0.438",
            }
        )
        temperatures = {
            8: _levels(120, 125, 125),
            16: _levels(90, 125, 125),
            32: _levels(60, 101, 125),
        }[width]
        limits = {
            "supply_voltage": supply,
            "frequency_pct_of_max": _levels(80, 80, 80),
            "output_current_pct_of_rated": _levels(70, 75, 80),
            "fanout_pct_of_rated": _levels(80, 80, 90),
            "junction_temperature_c": temperatures,
            "maximum_gate_count": None,
        }
    else:
        temperatures = {
            8: _levels(80, 85, 125),
            16: _levels(70, 70, 125),
            32: _levels(55, 56, 120),
        }[width]
        maximum_gates: Any = _levels(26000, 26000, 26000) if width == 16 else None
        limits = {
            "supply_tolerance_pct": _levels(3, 5, 5),
            "frequency_pct_of_max": _levels(75, 80, 90),
            "output_current_pct_of_rated": _levels(70, 75, 80),
            "fanout_pct_of_rated": _levels(70, 75, 80),
            "junction_temperature_c": temperatures,
            "maximum_gate_count": maximum_gates,
        }
    return _entry(
        f"{width}-bit {technology.upper()} microprocessor",
        ["microcircuit", "vhsic_microcircuit", "detailed_cmos"],
        _MICROPROCESSOR_SOURCE,
        inputs,
        limits,
    )


for _technology in ("mos", "bipolar"):
    for _width in (8, 16, 32):
        _DEVICE_CATALOG[f"microprocessor_{_technology}_{_width}bit"] = (
            _microprocessor_entry(_technology, _width)
        )


def _prom_entry(kind: str) -> dict[str, Any]:
    mos = kind != "bipolar"
    inputs: dict[str, Any] = {"bit_count": _integer_field(minimum=1)}
    inputs.update(_SUPPLY_FIELDS if mos else _BIPOLAR_SUPPLY_FIELDS)
    inputs.update({
        "frequency_pct_of_max": _number_field("% of specified maximum"),
        "output_current_pct_of_rated": _number_field("% of rated"),
        **_T_J_FIELDS,
        **_DIGITAL_APPLICATION_FIELDS,
    })
    if kind == "mos_eeprom":
        inputs.update({
            "write_cycles": _integer_field(minimum=0),
            "supplier_max_write_cycles": _integer_field(
                minimum=0,
                help_text="Supplier-specified maximum write-cycle rating.",
            ),
        })
    limits: dict[str, Any] = {
        "frequency_pct_of_max": _levels(80, 80, 90) if mos else _levels(80, 90, 90),
        "output_current_pct_of_rated": _levels(70, 75, 80),
        "junction_temperature_c": _levels(125, 125, 125),
        "maximum_bit_count": _levels(1_000_000, 1_000_000, 1_000_000),
    }
    if kind == "mos_eeprom":
        limits.update({
            "supply_voltage_formula": {
                "I": "65.2/B^0.183", "II": "85.3/B^0.199", "III": "85.3/B^0.178",
            },
            "write_cycles_formula": {
                "I": "1.26e8/B^0.660", "II": "6.94e7/B^0.470", "III": "300000",
            },
        })
    elif kind == "mos_other":
        limits["supply_voltage_formula"] = {
            "I": "66/B^0.178", "II": "71.1/B^0.176", "III": "83.3/B^0.175",
        }
    else:
        limits["supply_tolerance_pct"] = _levels(3, 5, 5)
    names = {
        "mos_eeprom": "MOS electrically erasable PROM (EEPROM)",
        "mos_other": "MOS PROM (non-EEPROM)",
        "bipolar": "Bipolar PROM",
    }
    return _entry(
        names[kind], ["microcircuit"], _PROM_SOURCE, inputs, limits,
    )


for _prom_kind in ("mos_eeprom", "mos_other", "bipolar"):
    _DEVICE_CATALOG[f"prom_{_prom_kind}"] = _prom_entry(_prom_kind)


_DEVICE_CATALOG["mimic_gaas"] = _entry(
    "GaAs MIMIC",
    ["gaas_fet", "hybrid_microcircuit"],
    _MIMIC_SOURCE,
    {
        "active_element_count": _integer_field(minimum=1),
        "passive_element_count": _integer_field(minimum=0),
        "channel_temperature_c": _number_field("°C", minimum=None),
        "supplier_max_channel_temperature_c": _number_field(
            "°C", minimum=None, help_text="Supplier-specified maximum channel temperature."
        ),
        "inert_package_cavity_verified": _boolean_field(
            "Affirm that the internal MIMIC package cavity environment is kept inert."
        ),
        "electrical_test_overstress_controls_verified": _boolean_field(
            "Affirm that electrical-test precautions prevent latent overstress damage."
        ),
    },
    {
        "channel_temperature_c": {
            "active_le_100_passive_le_10": _levels(95, 130, 150),
            "active_gt_100_passive_le_10": _levels(95, 130, 150),
            "active_le_100_passive_gt_10": _levels(90, 130, 150),
            "active_gt_100_passive_gt_10": _levels(90, 125, 150),
        }
    },
)


_POWER_COMMON_INPUTS = {
    "power_dissipation_pct_of_rated": _number_field("% of rated"),
    "breakdown_voltage_pct_of_rated": _number_field("% of rated"),
    "supplier_soa_verified": _boolean_field(
        "Affirm that the supplier SOA, adjusted for junction/channel temperature, "
        "is not exceeded under any transient condition."
    ),
    "thermal_cycle_profile_verified": _boolean_field(
        "Affirm that on-off temperature cycles satisfy the source Figure 6-4 limit."
    ),
    "power_design_margins_verified": _boolean_field(
        "Affirm application allowances of ±10% gain for screened devices or "
        "±20% for unscreened devices, +100% leakage current, +20% switching "
        "time, and ±15% saturation voltage."
    ),
}
_DEVICE_CATALOG.update({
    "power_silicon_bipolar": _entry(
        "Silicon bipolar power transistor",
        ["bjt", "power_bjt"],
        _POWER_BIPOLAR_SOURCE,
        {
            "junction_temperature_c": _number_field("°C", minimum=None),
            **_POWER_COMMON_INPUTS,
            "soa_vce_pct_of_rated": _number_field("% of rated VCE"),
            "soa_ic_pct_of_rated": _number_field("% of rated IC"),
        },
        {
            "junction_temperature_c": _levels(95, 125, 135),
            "power_dissipation_pct_of_rated": _levels(50, 60, 70),
            "soa_vce_pct_of_rated": _levels(70, 75, 80),
            "soa_ic_pct_of_rated": _levels(60, 65, 70),
            "breakdown_voltage_pct_of_rated": _levels(65, 85, 90),
        },
    ),
    "power_gaas_mesfet": _entry(
        "GaAs power MESFET",
        ["gaas_fet"],
        _POWER_GAAS_SOURCE,
        {
            "channel_temperature_c": _number_field("°C", minimum=None),
            **_POWER_COMMON_INPUTS,
        },
        {
            "channel_temperature_c": _levels(85, 100, 125),
            "power_dissipation_pct_of_rated": _levels(50, 60, 70),
            "breakdown_voltage_pct_of_rated": _levels(60, 70, 70),
        },
    ),
    "power_silicon_mosfet": _entry(
        "Silicon power MOSFET",
        ["fet"],
        _POWER_MOS_SOURCE,
        {
            "junction_temperature_c": _number_field("°C", minimum=None),
            **_POWER_COMMON_INPUTS,
        },
        {
            "junction_temperature_c": _levels(95, 120, 140),
            "power_dissipation_pct_of_rated": _levels(50, 65, 75),
            "breakdown_voltage_pct_of_rated": _levels(60, 70, 75),
        },
    ),
})


_RF_COMMON_INPUTS = {
    "power_dissipation_pct_of_rated": _number_field("% of rated"),
    "breakdown_voltage_pct_of_rated": _number_field("% of rated"),
    "thermal_cycle_profile_verified": _boolean_field(
        "Affirm that on-off temperature cycles satisfy Figure 6-4. This remains "
        "applicable even when Section 7 application note 4 permits a documented "
        "design-required voltage or power exception."
    ),
    "power_design_margins_verified": _boolean_field(
        "Affirm application allowances of ±10% gain for screened devices or "
        "±20% for unscreened devices, +100% leakage current, +20% switching "
        "time, and ±15% saturation voltage."
    ),
    "rf_table_limit_exception_documented": _boolean_field(
        "Select Yes only when the design requires exceeding a Table 7-3 voltage "
        "or power limit and the exception has an engineering disposition. The "
        "report provides no alternate numeric acceptance limit, so an exception "
        "remains not evaluated rather than passing.",
        required=False,
    ),
}


def _rf_entry(technology: str, *, multitransistor: bool) -> dict[str, Any]:
    inputs: dict[str, Any]
    limits: dict[str, Any]
    if technology == "silicon_bipolar":
        inputs = {
            "junction_temperature_c": _number_field("°C", minimum=None),
            **_RF_COMMON_INPUTS,
            "soa_vce_pct_of_rated": _number_field("% of rated VCE"),
            "soa_ic_pct_of_rated": _number_field("% of rated IC"),
        }
        limits = {
            "junction_temperature_c": _levels(95, 125, 135),
            "power_dissipation_pct_of_rated": _levels(50, 60, 70),
            "soa_vce_pct_of_rated": _levels(70, 70, 70),
            "soa_ic_pct_of_rated": _levels(60, 60, 60),
            "breakdown_voltage_pct_of_rated": _levels(65, 85, 90),
        }
        label = "Silicon bipolar RF pulse transistor"
        hints = ["hf_power_bjt"]
    else:
        inputs = {
            "channel_temperature_c": _number_field("°C", minimum=None),
            **_RF_COMMON_INPUTS,
        }
        limits = {
            "channel_temperature_c": _levels(85, 100, 125),
            "power_dissipation_pct_of_rated": _levels(50, 60, 70),
            "breakdown_voltage_pct_of_rated": _levels(60, 70, 70),
        }
        label = "GaAs RF pulse MESFET"
        hints = ["gaas_fet"]
    if multitransistor:
        label = label.replace("transistor", "multitransistor package")
    return _entry(label, hints, _RF_SOURCE, inputs, limits)


for _rf_technology in ("silicon_bipolar", "gaas_mesfet"):
    _DEVICE_CATALOG[f"rf_{_rf_technology}"] = _rf_entry(
        _rf_technology, multitransistor=False,
    )
    _DEVICE_CATALOG[f"rf_multitransistor_{_rf_technology}"] = _rf_entry(
        _rf_technology, multitransistor=True,
    )


def _opto_entry(
    display_name: str,
    limits: dict[str, dict[str, float]],
    *,
    application_inputs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    inputs = {
        parameter: _number_field("% of rated")
        for parameter in limits
    }
    inputs.update(application_inputs or {})
    return _entry(display_name, ["optoelectronic"], _OPTO_SOURCE, inputs, limits)


_DEVICE_CATALOG.update({
    "opto_photo_transistor": _opto_entry(
        "Photo transistor",
        {"junction_temperature_pct_of_rated": _levels(55, 70, 80)},
    ),
    "opto_avalanche_photodiode": _opto_entry(
        "Avalanche photodiode (APD)",
        {"junction_temperature_pct_of_rated": _levels(55, 70, 80)},
        application_inputs={
            "gain_margin_db": _number_field(
                "dB", help_text="Available APD gain margin; the report requires 3 dB."
            ),
        },
    ),
    "opto_pin_photodiode": _opto_entry(
        "PIN photodiode",
        {
            "junction_temperature_pct_of_rated": _levels(55, 70, 80),
            "reverse_voltage_pct_of_rated": _levels(70, 70, 70),
        },
    ),
    "opto_coupler": _opto_entry(
        "Optocoupler",
        {"junction_temperature_pct_of_rated": _levels(55, 70, 80)},
        application_inputs={
            "ctr_degradation_allowance_pct": _number_field(
                "%",
                help_text=(
                    "Current-transfer-ratio degradation allowed over service life; "
                    "the report specifies 15%."
                ),
            ),
            "drive_current_above_turn_on_verified": _boolean_field(
                "Affirm that input drive current is well above the turn-on point."
            ),
        },
    ),
    "opto_injection_laser": _opto_entry(
        "Injection laser diode",
        {
            "junction_temperature_pct_of_rated": _levels(55, 70, 75),
            "optical_power_pct_of_rated": _levels(50, 60, 70),
        },
        application_inputs={
            "optical_power_margin_db": _number_field(
                "dB", help_text="Output-power margin; the report requires 3 dB."
            ),
            "current_pulse_protection_verified": _boolean_field(
                "Affirm that the ILD power supply eliminates current pulses capable "
                "of catastrophic facet damage."
            ),
            "optical_power_monitored_controlled": _boolean_field(
                "Affirm that temperature-dependent optical output is monitored and "
                "controlled to prevent excess facet power."
            ),
            "sio2_glassivated": _boolean_field(
                "Select Yes for SiO2-glassivated devices; those devices require a "
                "verified hermetic seal."
            ),
            "hermetic_seal_integrity_verified": _boolean_field(
                "Affirm that package hermetic-seal integrity is maintained.",
                required=False,
                required_when="sio2_glassivated is true",
            ),
        },
    ),
    "opto_led": _opto_entry(
        "Light-emitting diode (LED)",
        {
            "junction_temperature_pct_of_rated": _levels(55, 70, 75),
            "average_forward_current_pct_of_rated": _levels(50, 65, 75),
        },
        application_inputs={
            "current_limiting_verified": _boolean_field(
                "Affirm that LED current limiting is provided, for example by a series resistor."
            ),
            "rectified_ac_drive": _boolean_field(
                "Select Yes if half-wave or full-wave rectified AC drives the LED; "
                "the report does not recommend that drive method."
            ),
            "peak_forward_current_pct_of_dc_max": _number_field(
                "% of allowable DC maximum",
                required=False,
                help_text=(
                    "Required for rectified-AC drive; the peak must never exceed "
                    "100% of the allowable DC current maximum."
                ),
                required_when="rectified_ac_drive is true",
            ),
        },
    ),
    "passive_chip_resistor_rm": _entry(
        "RM thick/thin-film chip resistor",
        ["resistor"],
        _PASSIVE_SOURCE,
        {
            "operating_temperature_pct_of_rated": _number_field("% of rated"),
            "power_dissipation_pct_of_rated": _number_field("% of rated"),
            "voltage_pct_of_rated": _number_field("% of rated"),
            "resistance_shift_tolerance_pct": _number_field(
                "%", help_text="Design tolerance for resistance shift; minimum 2%."
            ),
            "film_temperature_c": _number_field("°C", minimum=None),
            "voltage_stress_v_per_mil": _number_field("V/mil"),
            "power_density_w_per_in2": _number_field("W/in²"),
            "low_noise_application": _boolean_field(
                "Select Yes when trimming controls are required for a low-noise application."
            ),
            "proper_trimming_verified": _boolean_field(
                "Affirm proper trimming controls for the low-noise application.",
                required=False,
                required_when="low_noise_application is true",
            ),
            "resistor_stacking_avoided": _boolean_field(
                "Affirm that resistor stacking is avoided."
            ),
            "pulse_application": _boolean_field(
                "Select Yes when the resistor carries pulses."
            ),
            "pulse_average_power_basis_verified": _boolean_field(
                "Affirm that average pulse power was calculated from pulse magnitude, "
                "duration, and repetition frequency and used for power derating.",
                required=False,
                required_when="pulse_application is true",
            ),
            "pulse_voltage_magnitude_basis_verified": _boolean_field(
                "Affirm that pulse magnitude was used for voltage derating.",
                required=False,
                required_when="pulse_application is true",
            ),
            "operating_frequency_mhz": _number_field("MHz"),
            "high_frequency_effective_resistance_accounted": _boolean_field(
                "Affirm that reduced effective resistance from shunt capacitance is "
                "accounted for above 200 MHz.",
                required=False,
                required_when="operating_frequency_mhz > 200",
            ),
        },
        {
            "operating_temperature_pct_of_rated": _levels(80, 80, 80),
            "power_dissipation_pct_of_rated": _levels(50, 50, 50),
            "voltage_pct_of_rated": _levels(75, 75, 75),
        },
    ),
    "passive_chip_capacitor_cdr": _entry(
        "CDR ceramic chip capacitor",
        ["capacitor"],
        _PASSIVE_SOURCE,
        {
            "operating_temperature_pct_of_rated": _number_field("% of rated"),
            "dc_voltage_pct_of_rated": _number_field("% of rated"),
            "peak_ac_voltage_pct_of_rated": _number_field("% of rated"),
            **_MIL198_COMMON_CAPACITOR_FIELDS,
            "cdr_dielectric_environment_effects_reviewed": _boolean_field(
                "Confirm review of temperature, shelf-aging, electric-field, "
                "humidity, and organic-contamination effects on the ceramic dielectric."
            ),
            "cdr_pure_silver_termination": _boolean_field(
                "Declare whether the CDR construction has a pure-silver termination."
            ),
            "simultaneous_high_humidity_and_dc": _boolean_field(
                "Declare whether high humidity and DC bias can occur simultaneously."
            ),
            "cdr_silver_migration_mitigation_documented": _boolean_field(
                "Document a reviewed silver-migration mitigation when pure "
                "silver, high humidity, and DC bias coincide. The source's "
                "example alloy/solder recipes are not mandatory acceptance values.",
                required=False,
                required_when=(
                    "cdr_pure_silver_termination and "
                    "simultaneous_high_humidity_and_dc are true"
                ),
            ),
            "cdr_substrate_cte_compatibility_reviewed": _boolean_field(
                "Confirm review of substrate thermal-expansion compatibility, "
                "mounting thermal shock, and their effect on voltage/temperature limits."
            ),
            "design_tolerance_pct": _number_field(
                "%", help_text="Ceramic capacitor design tolerance; minimum ±12%."
            ),
        },
        {
            "operating_temperature_pct_of_rated": _levels(85, 85, 85),
            "dc_voltage_pct_of_rated": _levels(60, 60, 60),
        },
    ),
    "passive_chip_capacitor_cwr": _entry(
        "CWR solid-tantalum chip capacitor",
        ["capacitor"],
        _PASSIVE_SOURCE,
        {
            "operating_temperature_c": _number_field("°C", minimum=None),
            "dc_voltage_pct_of_rated": _number_field("% of rated"),
            "peak_ac_voltage_pct_of_rated": _number_field("% of rated"),
            **_MIL198_COMMON_CAPACITOR_FIELDS,
            "cwr_ac_component_small_relative_to_dc_attested": _boolean_field(
                "When AC is present, attest that it is small relative to the DC "
                "rating. MIL-STD-198E gives no numerical threshold.",
                required=False,
                required_when="peak_ac_voltage_pct_of_rated > 0",
            ),
            "cwr_supplemental_moisture_protection_available": _boolean_field(
                "Declare whether supplemental moisture protection is available, "
                "as assumed by the historical CWR intended-use guidance."
            ),
            "design_tolerance_pct": _number_field(
                "%", help_text="Tantalum capacitor design tolerance; minimum ±8%."
            ),
        },
        {
            "operating_temperature_c": _levels(85, 85, 85),
            "dc_voltage_pct_of_rated": _levels(60, 60, 60),
        },
    ),
    "hybrid_deposited_film_resistor": _entry(
        "Hybrid deposited-film resistor",
        ["resistor", "hybrid_microcircuit"],
        _PASSIVE_SOURCE,
        {},
        {},
        executable=False,
        reason=(
            "Section 9 states that no stress-failure information was identified, "
            "so no derating guidelines could be developed."
        ),
    ),
    "saw_device": _entry(
        "Surface acoustic wave (SAW) device",
        ["saw_device"],
        _SAW_SOURCE,
        {
            "frequency_mhz": _number_field("MHz"),
            "input_power_dbm": _number_field("dBm", minimum=None),
            "operating_temperature_c": _number_field("°C", minimum=None),
            "hermetic_package_integrity_verified": _boolean_field(
                "Affirm that hermetic-package integrity is maintained."
            ),
            "shock_below_rated_max_verified": _boolean_field(
                "Affirm that the design does not subject the SAW device to its "
                "rated maximum shock."
            ),
            "vibration_below_rated_max_verified": _boolean_field(
                "Affirm that the design does not subject the SAW device to its "
                "rated maximum vibration."
            ),
            "temperature_cycle_below_rated_max_verified": _boolean_field(
                "Affirm that the design does not subject the SAW device to its "
                "rated maximum temperature cycling."
            ),
        },
        {
            "input_power_dbm": {
                "frequency_below_500_mhz": _levels(18, 18, 18),
                "frequency_above_500_mhz": _levels(13, 13, 13),
            },
            "operating_temperature_c": _levels(125, 125, 125),
        },
    ),
})


SUPPORTED_MODELS = tuple(_DEVICE_CATALOG)


_ALIASES = {
    "saw": "saw_device",
    "mimic": "mimic_gaas",
    "prom_eeprom": "prom_mos_eeprom",
    "prom_mos": "prom_mos_other",
    "hybrid_film_resistor": "hybrid_deposited_film_resistor",
}


def get_profile_metadata() -> dict[str, Any]:
    """Return a defensive copy of source identity and profile scope metadata."""
    return deepcopy(PROFILE_METADATA)


def get_model_catalog() -> dict[str, dict[str, Any]]:
    """Return a defensive copy of model limits, schemas, and source locators."""
    return deepcopy(_DEVICE_CATALOG)


def _canonical(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    key = value.strip().lower().replace("-", "_").replace("/", "_").replace(" ", "_")
    while "__" in key:
        key = key.replace("__", "_")
    return key


def _model_key(model: str) -> str:
    key = _canonical(model, "device_type")
    key = _ALIASES.get(key, key)
    if key not in _DEVICE_CATALOG:
        raise UnsupportedRLTR9211ModelError(
            f"device_type must be one of {list(SUPPORTED_MODELS)}, got {model!r}"
        )
    return key


def _selected_level(level: str | int | None) -> str:
    if level is None:
        raise UnsupportedRLTR9211ModelError(
            "level is required and must be selected manually as I, II, or III"
        )
    if isinstance(level, bool):
        raise UnsupportedRLTR9211ModelError(
            "level must be selected manually as I, II, or III"
        )
    aliases = {1: "I", 2: "II", 3: "III", "1": "I", "2": "II", "3": "III"}
    normalized = aliases.get(level, str(level).strip().upper())
    if normalized not in _LEVELS:
        raise UnsupportedRLTR9211ModelError(
            "level must be selected manually as I, II, or III"
        )
    return normalized


def get_input_schema(model: str) -> dict[str, Any]:
    """Return one JSON-serializable input contract with table traceability."""
    key = _model_key(model)
    definition = deepcopy(_DEVICE_CATALOG[key])
    definition["model"] = key
    definition["selected_level"] = {
        "required": True,
        "choices": list(_LEVELS),
        "note": "Select the report criticality level manually.",
    }
    return definition


def _humanize(value: str) -> str:
    replacements = {
        "pct": "%",
        "dbm": "dBm",
        "mhz": "MHz",
        "soa": "SOA",
        "vce": "VCE",
        "ic": "IC",
        "gaas": "GaAs",
        "mos": "MOS",
    }
    words = value.split("_")
    return " ".join(replacements.get(word, word.title()) for word in words)


def profile_schema() -> dict[str, Any]:
    """Return a UI-normalized, fresh schema for every report device model."""
    families: list[dict[str, Any]] = []
    for key, definition in _DEVICE_CATALOG.items():
        fields: list[dict[str, Any]] = []
        for name, input_definition in definition["inputs"].items():
            field_type = (
                "boolean"
                if input_definition["type"] == "boolean"
                else "select"
                if input_definition["type"] == "choice"
                else "number"
                if input_definition["type"] == "number"
                else "text"
            )
            field: dict[str, Any] = {
                "key": name,
                "label": _humanize(name),
                "type": field_type,
                "required": bool(input_definition.get("required")),
            }
            if input_definition.get("unit"):
                field["unit"] = input_definition["unit"]
            if input_definition.get("choices"):
                field["options"] = list(input_definition["choices"])
            if input_definition.get("help"):
                field["help"] = input_definition["help"]
            if input_definition.get("min") is not None:
                field["min"] = input_definition["min"]
            if input_definition.get("max") is not None:
                field["max"] = input_definition["max"]
            if input_definition.get("step") is not None:
                field["step"] = input_definition["step"]
            if input_definition.get("required_when"):
                field["required_when"] = input_definition["required_when"]
            fields.append(field)
        source = definition["source"]
        families.append({
            "key": key,
            "label": definition["display_name"],
            "category_hints": list(definition["category_hints"]),
            "fields": fields,
            "source": (
                f"{DOCUMENT_ID} §{source['section']}, {source['table']}, "
                f"report p. {source['report_page']} (PDF p. {source['pdf_page']})"
            ),
            "executable": bool(definition["executable"]),
            "reason": definition.get("reason"),
        })
    return {
        "profile_id": DOCUMENT_ID,
        "historical": True,
        "families": families,
    }


def _number(
    params: Mapping[str, Any],
    name: str,
    *,
    nonnegative: bool = False,
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
    if nonnegative and value < 0:
        raise ValueError(f"parameter '{name}' must be non-negative")
    return value


def _integer(
    params: Mapping[str, Any],
    name: str,
    *,
    minimum: int,
) -> int | None:
    if name not in params or params[name] is None or params[name] == "":
        return None
    raw = params[name]
    if isinstance(raw, bool):
        raise ValueError(f"parameter '{name}' must be an integer >= {minimum}")
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError, AttributeError) as exc:
        raise ValueError(f"parameter '{name}' must be an integer >= {minimum}") from exc
    if not value.is_finite() or value != value.to_integral_value() or value < minimum:
        raise ValueError(f"parameter '{name}' must be an integer >= {minimum}")
    return int(value)


def _boolean(params: Mapping[str, Any], name: str) -> bool | None:
    if name not in params or params[name] is None or params[name] == "":
        return None
    if not isinstance(params[name], bool):
        raise ValueError(f"parameter '{name}' must be boolean")
    return params[name]


def _locator(model: str, row: str, *, note: str | None = None) -> str:
    source = _DEVICE_CATALOG[model]["source"]
    locator = (
        f"{DOCUMENT_ID} §{source['section']}, {source['table']}, row '{row}', "
        f"report p. {source['report_page']} (PDF p. {source['pdf_page']})"
    )
    return f"{locator}; {note}" if note else locator


def _mil198_locator(section: str, printed_pages: str, topic: str) -> str:
    return (
        f"MIL-STD-198E §{section}, {topic}, printed p. {printed_pages}; "
        "application guidance is nonmandatory per foreword p. iii"
    )


def _missing_check(
    *,
    parameter: str,
    description: str,
    selected_limit: float | bool | str | None,
    unit: str,
    comparison: str,
    locator: str,
    reason: str | None = None,
    formula: str | None = None,
    substitution: str | None = None,
) -> RLTR9211Check:
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=None,
        selected_limit=selected_limit,
        unit=unit,
        comparison=comparison,
        status="not_evaluated",
        message=(
            reason
            or f"No value was supplied for '{parameter}'; the source check was not evaluated."
        ),
        source_locator=locator,
        formula=formula,
        substitution=substitution,
    )


def _max_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    limit: float | None,
    unit: str,
    locator: str,
    formula: str | None = None,
    substitution: str | None = None,
    unavailable_reason: str | None = None,
    nonnegative: bool = True,
) -> RLTR9211Check:
    actual = _number(params, parameter, nonnegative=nonnegative)
    if actual is None or limit is None:
        return RLTR9211Check(
            parameter=parameter,
            description=description,
            actual_value=actual,
            selected_limit=limit,
            unit=unit,
            comparison="≤",
            status="not_evaluated",
            message=(
                unavailable_reason
                or f"No value was supplied for '{parameter}'; the source check was not evaluated."
            ),
            source_locator=locator,
            formula=formula,
            substitution=substitution,
        )
    passed = actual <= limit
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=limit,
        unit=unit,
        comparison="≤",
        status="ok" if passed else "exceeds",
        message=(
            f"{description} ({actual:g} {unit}) {'meets' if passed else 'exceeds'} "
            f"the source maximum (≤ {limit:g} {unit})."
        ),
        source_locator=locator,
        formula=formula,
        substitution=substitution,
    )


def _derived_bound_check(
    *,
    parameter: str,
    description: str,
    actual: float | None,
    limit: float | None,
    comparison: str,
    unit: str,
    locator: str,
    unavailable_reason: str | None = None,
    formula: str | None = None,
    substitution: str | None = None,
) -> RLTR9211Check:
    if actual is None or limit is None:
        return RLTR9211Check(
            parameter=parameter,
            description=description,
            actual_value=actual,
            selected_limit=limit,
            unit=unit,
            comparison=comparison,
            status="not_evaluated",
            message=(
                unavailable_reason
                or f"The inputs needed for '{parameter}' were not supplied; the source check was not evaluated."
            ),
            source_locator=locator,
            formula=formula,
            substitution=substitution,
        )
    if comparison == "≥":
        passed = actual >= limit
    elif comparison == "≤":
        passed = actual <= limit
    else:  # pragma: no cover - internal invariant
        raise AssertionError(f"unsupported comparison {comparison!r}")
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=limit,
        unit=unit,
        comparison=comparison,
        status="ok" if passed else "exceeds",
        message=(
            f"{description} ({actual:g} {unit}) "
            f"{'meets' if passed else 'does not meet'} the source/supplier bound "
            f"({comparison} {limit:g} {unit})."
        ),
        source_locator=locator,
        formula=formula,
        substitution=substitution,
    )


def _strict_max_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    limit: float,
    unit: str,
    locator: str,
) -> RLTR9211Check:
    actual = _number(params, parameter, nonnegative=unit != "°C")
    if actual is None:
        return _missing_check(
            parameter=parameter,
            description=description,
            selected_limit=limit,
            unit=unit,
            comparison="<",
            locator=locator,
        )
    passed = actual < limit
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=limit,
        unit=unit,
        comparison="<",
        status="ok" if passed else "exceeds",
        message=(
            f"{description} ({actual:g} {unit}) {'meets' if passed else 'does not meet'} "
            f"the source's strict bound (< {limit:g} {unit})."
        ),
        source_locator=locator,
    )


def _integer_max_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    limit: float | None,
    locator: str,
    formula: str | None = None,
    substitution: str | None = None,
    unavailable_reason: str | None = None,
) -> RLTR9211Check:
    actual = _integer(params, parameter, minimum=0)
    if actual is None or limit is None:
        return _missing_check(
            parameter=parameter,
            description=description,
            selected_limit=limit,
            unit="cycles",
            comparison="≤",
            locator=locator,
            reason=unavailable_reason,
            formula=formula,
            substitution=substitution,
        )
    passed = actual <= limit
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=limit,
        unit="cycles",
        comparison="≤",
        status="ok" if passed else "exceeds",
        message=(
            f"{description} ({actual} cycles) {'meets' if passed else 'exceeds'} "
            f"the source maximum (≤ {limit:g} cycles)."
        ),
        source_locator=locator,
        formula=formula,
        substitution=substitution,
    )


def _obligation_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    locator: str,
) -> RLTR9211Check:
    actual = _boolean(params, parameter)
    if actual is None:
        return _missing_check(
            parameter=parameter,
            description=description,
            selected_limit=True,
            unit="boolean",
            comparison="is true",
            locator=locator,
            reason=(
                f"No affirmative value was supplied for '{parameter}'; the "
                "delegated source obligation remains unverified."
            ),
        )
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=True,
        unit="boolean",
        comparison="is true",
        status="ok" if actual else "exceeds",
        message=(
            f"{description} is affirmatively verified."
            if actual
            else f"{description} is not verified; the assessment fails closed."
        ),
        source_locator=locator,
    )


def _advisory_review_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    locator: str,
) -> RLTR9211Check:
    """Record imported guidance without turning it into a mandatory limit."""
    actual = _boolean(params, parameter)
    if actual is True:
        return RLTR9211Check(
            parameter=parameter,
            description=description,
            actual_value=True,
            selected_limit=True,
            unit="advisory review",
            comparison="is documented",
            status="ok",
            message=f"{description} is documented.",
            source_locator=locator,
        )
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=True,
        unit="advisory review",
        comparison="is documented",
        status="not_evaluated",
        message=(
            f"{description} is not documented; imported MIL-STD-198E guidance "
            "remains unresolved but is not reported as a mandatory-limit failure."
        ),
        source_locator=locator,
    )


def _advisory_declaration_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    locator: str,
) -> tuple[bool | None, RLTR9211Check]:
    """Require an explicit applicability fact for nonmandatory guidance."""
    actual = _boolean(params, parameter)
    if actual is None:
        return None, RLTR9211Check(
            parameter=parameter,
            description=description,
            actual_value=None,
            selected_limit="yes or no",
            unit="applicability",
            comparison="is declared",
            status="not_evaluated",
            message=(
                f"'{parameter}' must be declared before the imported guidance "
                "can be assessed."
            ),
            source_locator=locator,
        )
    return actual, RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit="yes or no",
        unit="applicability",
        comparison="is declared",
        status="ok",
        message=f"{description} was explicitly declared as {actual}.",
        source_locator=locator,
    )


def _advisory_max_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    limit: float,
    unit: str,
    locator: str,
    formula: str,
) -> RLTR9211Check:
    actual = _number(params, parameter, nonnegative=True)
    if actual is None:
        return _missing_check(
            parameter=parameter,
            description=description,
            selected_limit=limit,
            unit=unit,
            comparison="≤ (advisory)",
            locator=locator,
            reason=(
                f"No value was supplied for '{parameter}'; the imported "
                "MIL-STD-198E guidance was not evaluated."
            ),
            formula=formula,
        )
    reviewed = actual <= limit
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=limit,
        unit=unit,
        comparison="≤ (advisory)",
        status="ok" if reviewed else "not_evaluated",
        message=(
            f"{description} ({actual:g} {unit}) is within the historical "
            f"guidance value (≤ {limit:g} {unit})."
            if reviewed
            else f"{description} ({actual:g} {unit}) is above the historical "
            f"guidance value (≤ {limit:g} {unit}); resolve with qualified "
            "application evidence. This advisory is not a mandatory-limit failure."
        ),
        source_locator=locator,
        formula=formula,
        substitution=f"{actual:g} <= {limit:g}",
    )


def _unsupported_check(
    *,
    parameter: str,
    description: str,
    actual: float | bool | str | None,
    message: str,
    locator: str,
) -> RLTR9211Check:
    return RLTR9211Check(
        parameter=parameter,
        description=description,
        actual_value=actual,
        selected_limit=None,
        unit="source regime",
        comparison="is defined",
        status="unsupported",
        message=message,
        source_locator=locator,
    )


def _aggregate(checks: list[RLTR9211Check]) -> str:
    if any(check.status == "exceeds" for check in checks):
        return "exceeds"
    if any(check.status == "unsupported" for check in checks):
        return "unsupported"
    if any(check.status == "not_evaluated" for check in checks):
        return "not_evaluated"
    return "ok"


def _traceability(model: str) -> Mapping[str, Any]:
    definition = _DEVICE_CATALOG[model]
    source = definition["source"]
    traceability: dict[str, Any] = {
        "source": f"{DOCUMENT_ID}, {DOCUMENT_TITLE} ({DOCUMENT_DATE}), AD-A253334",
        "document_number": DOCUMENT_ID,
        "accession": "AD-A253334",
        "report_status": DOCUMENT_STATUS,
        "report_section": source["section"],
        "table": source["table"],
        "report_page": source["report_page"],
        "pdf_page": source["pdf_page"],
        "model": model,
        "support_status": (
            "supported final-table screening"
            if definition["executable"]
            else "unsupported by source"
        ),
        "conformance_scope": PROFILE_METADATA["conformance_scope"],
        "level_selection": "manual",
    }
    if model in {"passive_chip_capacitor_cdr", "passive_chip_capacitor_cwr"}:
        traceability["reviewed_cross_reference"] = {
            "document": "MIL-STD-198E with Notices 1–3",
            "source_sha256": dict(MIL_STD_198E_SOURCE_HASHES),
            "semantics": "nonmandatory application guidance",
        }
    return MappingProxyType(traceability)


def _result(
    model: str,
    level: str,
    params: Mapping[str, Any],
    checks: list[RLTR9211Check],
    warnings: list[str] | None = None,
) -> RLTR9211Result:
    return RLTR9211Result(
        model=model,
        display_name=_DEVICE_CATALOG[model]["display_name"],
        selected_level=level,
        status=_aggregate(checks),
        checks=tuple(checks),
        traceability=_traceability(model),
        warnings=tuple(dict.fromkeys((*((warnings or [])), _LEVEL_WARNING, _GENERAL_WARNING))),
        inputs=MappingProxyType(dict(params)),
    )


_DESCRIPTIONS = {
    "frequency_pct_of_max": "Operating frequency",
    "output_current_pct_of_rated": "Output current",
    "fanout_pct_of_rated": "Fan-out loading",
    "input_voltage_pct_of_rated": "Input voltage",
    "junction_temperature_c": "Maximum junction temperature",
    "channel_temperature_c": "Maximum channel temperature",
    "power_dissipation_pct_of_rated": "Power dissipation",
    "soa_vce_pct_of_rated": "Safe-operating-area collector-emitter voltage",
    "soa_ic_pct_of_rated": "Safe-operating-area collector current",
    "breakdown_voltage_pct_of_rated": "Breakdown voltage",
    "junction_temperature_pct_of_rated": "Junction temperature",
    "reverse_voltage_pct_of_rated": "Reverse voltage",
    "optical_power_pct_of_rated": "Optical output power",
    "average_forward_current_pct_of_rated": "Average forward current",
    "operating_temperature_pct_of_rated": "Maximum operating temperature",
    "operating_temperature_c": "Maximum operating temperature",
    "dc_voltage_pct_of_rated": "DC voltage",
    "voltage_pct_of_rated": "Voltage",
}


def _application_locator(report_page: int, title: str) -> str:
    return (
        f"{DOCUMENT_ID}, {title}, report p. {report_page} "
        f"(PDF p. {report_page + 8})"
    )


def _required_applicability_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    locator: str,
) -> tuple[bool | None, RLTR9211Check | None]:
    value = _boolean(params, parameter)
    if value is not None:
        return value, None
    return None, _missing_check(
        parameter=parameter,
        description=description,
        selected_limit="yes or no",
        unit="applicability",
        comparison="is declared",
        locator=locator,
        reason=(
            f"'{parameter}' must be declared so the conditional application note "
            "can be evaluated."
        ),
    )


def _microcircuit_application_checks(
    model: str,
    params: Mapping[str, Any],
    *,
    digital: bool,
    mos: bool,
) -> tuple[list[RLTR9211Check], list[str]]:
    locator = _application_locator(87, "§4.4 Microcircuit Application Notes")
    checks: list[RLTR9211Check] = []
    if digital:
        for parameter, description in (
            ("unused_inputs_terminated", "Unused digital inputs are tied to supply or ground"),
            ("supply_transient_filtering_verified", "Supply transient filtering is provided"),
            (
                "digital_design_margins_verified",
                "Digital leakage, fan-out, frequency, and timing margins are applied",
            ),
            ("reverse_voltage_avoided", "Reverse voltage on device leads is prevented"),
        ):
            checks.append(_obligation_check(
                params,
                parameter=parameter,
                description=description,
                locator=locator,
            ))
    else:
        for parameter, description in (
            (
                "linear_performance_envelope_verified",
                "The linear device remains within its performance envelope",
            ),
            (
                "linear_design_margins_verified",
                "Linear gain and offset-voltage/current margins are applied",
            ),
            ("reverse_voltage_avoided", "Reverse voltage on device leads is prevented"),
        ):
            checks.append(_obligation_check(
                params,
                parameter=parameter,
                description=description,
                locator=locator,
            ))
    applicable, applicability_check = _required_applicability_check(
        params,
        parameter="aluminum_metallization_used",
        description="Aluminum-metallization current-density applicability",
        locator=locator,
    )
    if applicability_check is not None:
        checks.append(applicability_check)
    if applicable:
        temperature = _number(params, "junction_temperature_c")
        duration = _number(params, "current_density_duration_hours", nonnegative=True)
        if temperature is None or temperature <= 0:
            checks.append(_unsupported_check(
                parameter="junction_temperature_c",
                description="Current-density equation temperature domain",
                actual=temperature,
                message=(
                    "The printed T^1.67 equation requires a positive Celsius "
                    "temperature; no transformation for T ≤ 0 °C is supplied."
                ),
                locator=f"{locator}; Figure 4-34, report p. 88 (PDF p. 96)",
            ))
        else:
            equation_limit = 366e6 / (temperature ** 1.67)
            limit = min(equation_limit, 5e5)
            checks.append(_max_check(
                params,
                parameter="current_density_a_per_cm2",
                description="Aluminum-metallization current density",
                limit=limit,
                unit="A/cm²",
                locator=f"{locator}; Figure 4-34, report p. 88 (PDF p. 96)",
                formula="min(366e6/T_C^1.67, 5e5)",
                substitution=(
                    f"min(366e6/{temperature:g}^1.67, 5e5) = {limit:.12g} A/cm²"
                ),
            ))
            crossover_c = (366e6 / 5e5) ** (1.0 / 1.67)
            if temperature < crossover_c:
                checks.append(_unsupported_check(
                    parameter="junction_temperature_c",
                    description="Figure 4-34 low-temperature source consistency",
                    actual=temperature,
                    message=(
                        "Below approximately 51.913 °C, the plotted Figure 4-34 "
                        "curve exceeds 0.5 MA/cm² while the accompanying prose says "
                        "to use 5E5 A/cm² or the equation, whichever is smaller. "
                        "The conservative 5E5 A/cm² cap is checked, but the source "
                        "contradiction prevents an affirmative screening pass."
                    ),
                    locator=f"{locator}; Figure 4-34, report p. 88 (PDF p. 96)",
                ))
        if duration is None:
            checks.append(_missing_check(
                parameter="current_density_duration_hours",
                description="Current-density curve service duration",
                selected_limit=10_000,
                unit="hours",
                comparison="=",
                locator=f"{locator}; Figure 4-34, report p. 88 (PDF p. 96)",
            ))
        elif duration != 10_000:
            checks.append(_unsupported_check(
                parameter="current_density_duration_hours",
                description="Current-density curve service duration",
                actual=duration,
                message=(
                    "Figure 4-34 is a 10,000-hour curve. RL-TR-92-11 supplies no "
                    "duration conversion, so another required duration needs an "
                    "external engineering disposition."
                ),
                locator=f"{locator}; Figure 4-34, report p. 88 (PDF p. 96)",
            ))
        else:
            checks.append(RLTR9211Check(
                parameter="current_density_duration_hours",
                description="Current-density curve service duration",
                actual_value=duration,
                selected_limit=10_000,
                unit="hours",
                comparison="=",
                status="ok",
                message="The requested duration matches the 10,000-hour source curve.",
                source_locator=f"{locator}; Figure 4-34, report p. 88 (PDF p. 96)",
            ))
    warnings = [
        "Section 4.4 identifies ESD sensitivity and notes that heat sinking may "
        "be needed to maintain the independently checked junction-temperature limit."
    ]
    if applicable:
        warnings.append(
            "The current-density equation is converted from Figure 4-34's MA/cm² "
            "ordinate to A/cm² (366e6/T_C^1.67) and conservatively capped at the "
            "prose value of 5e5 A/cm². Low-temperature graph/prose disagreement "
            "is emitted as a separate unsupported check."
        )
    if mos:
        warnings.append(
            "Section 4.4 specifically cautions that MOS inputs can be damaged by "
            "lead shorting during assembly and that fast transients can cause latch-up."
        )
    return checks, warnings


def _plain_limit_checks(
    model: str,
    params: Mapping[str, Any],
    level: str,
    *,
    include: tuple[str, ...] | None = None,
    exclude: tuple[str, ...] = (),
) -> list[RLTR9211Check]:
    definition = _DEVICE_CATALOG[model]
    names = include or tuple(definition["inputs"])
    checks: list[RLTR9211Check] = []
    for parameter in names:
        if parameter in exclude or parameter not in definition["limits"]:
            continue
        level_limits = definition["limits"][parameter]
        if not isinstance(level_limits, Mapping) or level not in level_limits:
            continue
        unit = definition["inputs"][parameter].get("unit", "")
        checks.append(_max_check(
            params,
            parameter=parameter,
            description=_DESCRIPTIONS.get(parameter, _humanize(parameter)),
            limit=float(level_limits[level]),
            unit=unit,
            locator=_locator(model, _DESCRIPTIONS.get(parameter, _humanize(parameter))),
            nonnegative=unit != "°C",
        ))
    return checks


def _count_check(
    model: str,
    params: Mapping[str, Any],
    level: str,
    *,
    parameter: str,
    maximum_key: str,
    row: str,
) -> RLTR9211Check:
    count = _integer(params, parameter, minimum=1)
    maximums = _DEVICE_CATALOG[model]["limits"][maximum_key]
    limit = int(maximums[level])
    locator = _locator(model, row)
    if count is None:
        return _missing_check(
            parameter=parameter,
            description=row,
            selected_limit=limit,
            unit="count",
            comparison="≤",
            locator=locator,
        )
    passed = count <= limit
    return RLTR9211Check(
        parameter=parameter,
        description=row,
        actual_value=count,
        selected_limit=limit,
        unit="count",
        comparison="≤",
        status="ok" if passed else "exceeds",
        message=(
            f"{row} ({count}) {'meets' if passed else 'exceeds'} the source "
            f"maximum (≤ {limit})."
        ),
        source_locator=locator,
    )


_SUPPLY_EQUATIONS: dict[str, dict[str, tuple[float, float, str, str]]] = {
    "asic_mos_digital": {
        "I": (129.0, 0.320, "gate_count", "129/G^0.320"),
        "II": (173.0, 0.347, "gate_count", "173/G^0.347"),
        "III": (157.0, 0.323, "gate_count", "157/G^0.323"),
    },
    "asic_mos_linear": {
        "I": (200.0, 0.315, "transistor_count", "200/TR^0.315"),
        "II": (189.0, 0.311, "transistor_count", "189/TR^0.311"),
        "III": (210.0, 0.347, "transistor_count", "210/TR^0.347"),
    },
    "microprocessor_mos_16bit": {
        "I": (606.0, 0.440, "gate_count", "606/G^0.440"),
        "II": (760.0, 0.462, "gate_count", "760/G^0.462"),
        "III": (698.0, 0.438, "gate_count", "698/G^0.438"),
    },
    "microprocessor_mos_32bit": {
        "I": (642.0, 0.442, "gate_count", "642/G^0.442"),
        "II": (627.0, 0.448, "gate_count", "627/G^0.448"),
        "III": (696.0, 0.438, "gate_count", "696/G^0.438"),
    },
    "prom_mos_eeprom": {
        "I": (65.2, 0.183, "bit_count", "65.2/B^0.183"),
        "II": (85.3, 0.199, "bit_count", "85.3/B^0.199"),
        "III": (85.3, 0.178, "bit_count", "85.3/B^0.178"),
    },
    "prom_mos_other": {
        "I": (66.0, 0.178, "bit_count", "66/B^0.178"),
        "II": (71.1, 0.176, "bit_count", "71.1/B^0.176"),
        "III": (83.3, 0.175, "bit_count", "83.3/B^0.175"),
    },
}


def _supply_formula_limit(
    model: str,
    params: Mapping[str, Any],
    level: str,
    *,
    in_domain: bool,
) -> tuple[float | None, str | None, str | None]:
    if model == "microprocessor_mos_8bit":
        limit = _DEVICE_CATALOG[model]["limits"]["supply_voltage"][level]
        return float(limit), "table value", f"Level {level}: {float(limit):g} V"
    coefficient, exponent, variable, formula = _SUPPLY_EQUATIONS[model][level]
    count = _integer(params, variable, minimum=1)
    if count is None or not in_domain:
        return None, formula, None
    limit = coefficient / (count ** exponent)
    symbol = "TR" if variable == "transistor_count" else "B" if variable == "bit_count" else "G"
    return limit, formula, f"{coefficient:g}/{symbol}^{exponent:g} at {symbol}={count} = {limit:.12g} V"


def _mos_supply_checks(
    model: str,
    params: Mapping[str, Any],
    level: str,
    *,
    formula_limit: float | None,
    formula: str | None,
    substitution: str | None,
    unavailable_reason: str | None = None,
) -> list[RLTR9211Check]:
    locator = _locator(
        model,
        "Supply voltage",
        note="supplier minimum/maximum footnote applies",
    )
    checks = [_max_check(
        params,
        parameter="supply_voltage_v",
        description="Applied supply voltage",
        limit=formula_limit,
        unit="V",
        locator=locator,
        formula=formula,
        substitution=substitution,
        unavailable_reason=unavailable_reason,
    )]
    actual = _number(params, "supply_voltage_v", nonnegative=True)
    supplier_min = _number(params, "supplier_min_supply_v", nonnegative=True)
    supplier_max = _number(params, "supplier_max_supply_v", nonnegative=True)
    if supplier_min is not None and supplier_max is not None and supplier_min > supplier_max:
        raise ValueError("supplier_min_supply_v must be <= supplier_max_supply_v")
    checks.extend((
        _derived_bound_check(
            parameter="supply_voltage_v",
            description="Applied supply voltage versus supplier minimum",
            actual=actual,
            limit=supplier_min,
            comparison="≥",
            unit="V",
            locator=locator,
            unavailable_reason=(
                "Supplier minimum supply voltage is required by the table footnote; "
                "the supplier-window check was not evaluated."
                if supplier_min is None else None
            ),
        ),
        _derived_bound_check(
            parameter="supply_voltage_v",
            description="Applied supply voltage versus supplier maximum",
            actual=actual,
            limit=supplier_max,
            comparison="≤",
            unit="V",
            locator=locator,
            unavailable_reason=(
                "Supplier maximum supply voltage is required by the table footnote; "
                "the supplier-window check was not evaluated."
                if supplier_max is None else None
            ),
        ),
        _derived_bound_check(
            parameter="calculated_supply_voltage_limit_v",
            description="Calculated report limit versus supplier minimum",
            actual=formula_limit,
            limit=supplier_min,
            comparison="≥",
            unit="V",
            locator=locator,
            unavailable_reason=(
                "The calculated report limit and supplier minimum are both required "
                "to determine whether a feasible supply-voltage window exists."
            ),
        ),
    ))
    return checks


def _bipolar_supply_checks(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> list[RLTR9211Check]:
    tolerance_limit = float(_DEVICE_CATALOG[model]["limits"]["supply_tolerance_pct"][level])
    locator = _locator(
        model,
        "Supply-voltage tolerance",
        note="supplier minimum/maximum footnote applies",
    )
    checks = [_max_check(
        params,
        parameter="supply_tolerance_pct",
        description="Worst-case supply-voltage tolerance magnitude",
        limit=tolerance_limit,
        unit="%",
        locator=locator,
    )]
    nominal = _number(params, "supply_voltage_v", nonnegative=True)
    tolerance = _number(params, "supply_tolerance_pct", nonnegative=True)
    supplier_min = _number(params, "supplier_min_supply_v", nonnegative=True)
    supplier_max = _number(params, "supplier_max_supply_v", nonnegative=True)
    if supplier_min is not None and supplier_max is not None and supplier_min > supplier_max:
        raise ValueError("supplier_min_supply_v must be <= supplier_max_supply_v")
    low = None if nominal is None or tolerance is None else nominal * (1.0 - tolerance / 100.0)
    high = None if nominal is None or tolerance is None else nominal * (1.0 + tolerance / 100.0)
    checks.extend((
        _derived_bound_check(
            parameter="supply_voltage_v",
            description="Worst-case low supply versus supplier minimum",
            actual=low,
            limit=supplier_min,
            comparison="≥",
            unit="V",
            locator=locator,
            unavailable_reason=(
                "Nominal supply voltage, tolerance, and supplier minimum are required "
                "to verify the complete low-side supply window."
            ),
        ),
        _derived_bound_check(
            parameter="supply_voltage_v",
            description="Worst-case high supply versus supplier maximum",
            actual=high,
            limit=supplier_max,
            comparison="≤",
            unit="V",
            locator=locator,
            unavailable_reason=(
                "Nominal supply voltage, tolerance, and supplier maximum are required "
                "to verify the complete high-side supply window."
            ),
        ),
    ))
    return checks


def _supplier_temperature_check(
    model: str,
    params: Mapping[str, Any],
    *,
    temperature_parameter: str,
    supplier_parameter: str,
) -> RLTR9211Check:
    actual = _number(params, temperature_parameter)
    supplier_limit = _number(params, supplier_parameter)
    row = (
        "Junction temperature"
        if temperature_parameter == "junction_temperature_c"
        else "Channel temperature"
    )
    locator = _locator(model, row, note="supplier maximum-temperature footnote applies")
    return _derived_bound_check(
        parameter=temperature_parameter,
        description=f"{row} versus supplier maximum",
        actual=actual,
        limit=supplier_limit,
        comparison="≤",
        unit="°C",
        locator=locator,
        unavailable_reason=(
            f"'{supplier_parameter}' is required by the table footnote; the "
            "supplier temperature check was not evaluated."
            if supplier_limit is None else None
        ),
    )


def _evaluate_asic(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    mos = model.startswith("asic_mos")
    digital = model.endswith("digital")
    count_parameter = "gate_count" if digital else "transistor_count"
    maximum_key = "maximum_gate_count" if digital else "maximum_transistor_count"
    count = _integer(params, count_parameter, minimum=1)
    maximum = int(_DEVICE_CATALOG[model]["limits"][maximum_key][level])
    warnings: list[str] = []
    if model == "asic_mos_linear" and level == "III" and count is not None and count > 10_000:
        checks = [_unsupported_check(
            parameter="transistor_count",
            description="Maximum MOS-linear transistor count",
            actual=count,
            message=(
                "Table 4-7 prints a 10,000-transistor maximum at Level III, while "
                "Appendix A-1 prints 60,000.  The source contradiction is not "
                "silently resolved; MOS-linear cases above 10,000 remain unsupported."
            ),
            locator=(
                f"{_locator(model, 'Maximum number of transistors')}; conflicting "
                "Appendix A, p. A-1 (PDF p. 169)"
            ),
        )]
        in_domain = False
        warnings.append(
            "MOS-linear Level III above 10,000 transistors is source-ambiguous: "
            "Table 4-7 and Appendix A-1 disagree."
        )
    else:
        checks = [_count_check(
            model,
            params,
            level,
            parameter=count_parameter,
            maximum_key=maximum_key,
            row="Maximum number of gates" if digital else "Maximum number of transistors",
        )]
        in_domain = count is not None and count <= maximum
    if mos:
        formula_limit, formula, substitution = _supply_formula_limit(
            model, params, level, in_domain=in_domain,
        )
        checks.extend(_mos_supply_checks(
            model,
            params,
            level,
            formula_limit=formula_limit,
            formula=formula,
            substitution=substitution,
            unavailable_reason=(
                f"The supply-voltage equation is not evaluated outside the published "
                f"{maximum}-count domain."
                if count is not None and not in_domain else None
            ),
        ))
    else:
        checks.extend(_bipolar_supply_checks(model, params, level))
    checks.extend(_plain_limit_checks(
        model,
        params,
        level,
        include=(
            "input_voltage_pct_of_rated",
            "frequency_pct_of_max",
            "output_current_pct_of_rated",
            "fanout_pct_of_rated",
            "junction_temperature_c",
        ),
    ))
    checks.append(_supplier_temperature_check(
        model,
        params,
        temperature_parameter="junction_temperature_c",
        supplier_parameter="supplier_max_junction_temperature_c",
    ))
    application_checks, application_warnings = _microcircuit_application_checks(
        model,
        params,
        digital=digital,
        mos=mos,
    )
    checks.extend(application_checks)
    warnings.extend(application_warnings)
    return checks, warnings


def _evaluate_microprocessor(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    technology = "mos" if "_mos_" in model else "bipolar"
    width = int(model.rsplit("_", 1)[-1].removesuffix("bit"))
    checks: list[RLTR9211Check] = []
    in_domain = True
    if technology == "mos":
        if width in {16, 32}:
            in_domain = _integer(params, "gate_count", minimum=1) is not None
        formula_limit, formula, substitution = _supply_formula_limit(
            model, params, level, in_domain=in_domain,
        )
        checks.extend(_mos_supply_checks(
            model,
            params,
            level,
            formula_limit=formula_limit,
            formula=formula,
            substitution=substitution,
        ))
    else:
        if width == 16:
            checks.append(_count_check(
                model,
                params,
                level,
                parameter="gate_count",
                maximum_key="maximum_gate_count",
                row="Maximum number of gates",
            ))
        checks.extend(_bipolar_supply_checks(model, params, level))
    checks.extend(_plain_limit_checks(
        model,
        params,
        level,
        include=(
            "frequency_pct_of_max",
            "output_current_pct_of_rated",
            "fanout_pct_of_rated",
            "junction_temperature_c",
        ),
    ))
    checks.append(_supplier_temperature_check(
        model,
        params,
        temperature_parameter="junction_temperature_c",
        supplier_parameter="supplier_max_junction_temperature_c",
    ))
    application_checks, warnings = _microcircuit_application_checks(
        model,
        params,
        digital=True,
        mos=technology == "mos",
    )
    checks.extend(application_checks)
    return checks, warnings


def _write_cycle_limit(level: str, bit_count: int) -> tuple[float, str, str]:
    if level == "I":
        limit = 1.26e8 / (bit_count ** 0.660)
        return limit, "1.26e8/B^0.660", f"1.26e8/{bit_count}^0.660 = {limit:.12g}"
    if level == "II":
        limit = 6.94e7 / (bit_count ** 0.470)
        return limit, "6.94e7/B^0.470", f"6.94e7/{bit_count}^0.470 = {limit:.12g}"
    return 300_000.0, "300000", "Level III table value = 300000"


def _evaluate_prom(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    bit_count = _integer(params, "bit_count", minimum=1)
    checks = [_count_check(
        model,
        params,
        level,
        parameter="bit_count",
        maximum_key="maximum_bit_count",
        row="Maximum number of bits",
    )]
    in_domain = bit_count is not None and bit_count <= 1_000_000
    if model.startswith("prom_mos"):
        formula_limit, formula, substitution = _supply_formula_limit(
            model, params, level, in_domain=in_domain,
        )
        checks.extend(_mos_supply_checks(
            model,
            params,
            level,
            formula_limit=formula_limit,
            formula=formula,
            substitution=substitution,
            unavailable_reason=(
                "The supply-voltage equation is not evaluated above the published "
                "1,000,000-bit maximum."
                if bit_count is not None and not in_domain else None
            ),
        ))
    else:
        checks.extend(_bipolar_supply_checks(model, params, level))
    checks.extend(_plain_limit_checks(
        model,
        params,
        level,
        include=(
            "frequency_pct_of_max",
            "output_current_pct_of_rated",
            "junction_temperature_c",
        ),
    ))
    checks.append(_supplier_temperature_check(
        model,
        params,
        temperature_parameter="junction_temperature_c",
        supplier_parameter="supplier_max_junction_temperature_c",
    ))
    if model == "prom_mos_eeprom":
        if bit_count is None or not in_domain:
            write_limit = None
            write_formula = _DEVICE_CATALOG[model]["limits"]["write_cycles_formula"][level]
            write_substitution = None
        else:
            write_limit, write_formula, write_substitution = _write_cycle_limit(level, bit_count)
        checks.append(_integer_max_check(
            params,
            parameter="write_cycles",
            description="EEPROM write cycles",
            limit=write_limit,
            locator=_locator(model, "Number of write cycles"),
            formula=write_formula,
            substitution=write_substitution,
            unavailable_reason=(
                "The write-cycle equation is not evaluated outside the published "
                "bit-count domain."
                if bit_count is not None and not in_domain else None
            ),
        ))
        writes = _integer(params, "write_cycles", minimum=0)
        supplier_write_limit = _integer(params, "supplier_max_write_cycles", minimum=0)
        checks.append(_derived_bound_check(
            parameter="write_cycles",
            description="EEPROM write cycles versus supplier maximum",
            actual=writes,
            limit=supplier_write_limit,
            comparison="≤",
            unit="cycles",
            locator=_locator(
                model,
                "Number of write cycles",
                note="supplier maximum-write-cycle footnote applies",
            ),
            unavailable_reason=(
                "The supplier maximum write-cycle rating is required by the table "
                "footnote; the supplier check was not evaluated."
                if supplier_write_limit is None else None
            ),
        ))
    application_checks, warnings = _microcircuit_application_checks(
        model,
        params,
        digital=True,
        mos=model.startswith("prom_mos"),
    )
    checks.extend(application_checks)
    return checks, warnings


def _evaluate_mimic(
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    model = "mimic_gaas"
    active = _integer(params, "active_element_count", minimum=1)
    passive = _integer(params, "passive_element_count", minimum=0)
    row_key: str | None = None
    if active is not None and passive is not None:
        row_key = (
            f"active_{'le_100' if active <= 100 else 'gt_100'}_"
            f"passive_{'le_10' if passive <= 10 else 'gt_10'}"
        )
    table_limit = (
        None
        if row_key is None
        else float(_DEVICE_CATALOG[model]["limits"]["channel_temperature_c"][row_key][level])
    )
    checks = [_max_check(
        params,
        parameter="channel_temperature_c",
        description="Maximum channel temperature",
        limit=table_limit,
        unit="°C",
        locator=_locator(model, "Maximum channel temperature"),
        unavailable_reason=(
            "Both active_element_count and passive_element_count are required to "
            "select the Table 5-3 row."
            if row_key is None else None
        ),
        nonnegative=False,
    )]
    checks.append(_supplier_temperature_check(
        model,
        params,
        temperature_parameter="channel_temperature_c",
        supplier_parameter="supplier_max_channel_temperature_c",
    ))
    locator = _application_locator(96, "MIMIC Application Notes")
    checks.extend((
        _obligation_check(
            params,
            parameter="inert_package_cavity_verified",
            description="The internal MIMIC package-cavity environment is kept inert",
            locator=locator,
        ),
        _obligation_check(
            params,
            parameter="electrical_test_overstress_controls_verified",
            description="Electrical-test precautions prevent latent overstress failure",
            locator=locator,
        ),
    ))
    return checks, []


def _power_obligations(
    model: str,
    params: Mapping[str, Any],
    *,
    multitransistor: bool,
) -> list[RLTR9211Check]:
    if model.startswith("power_"):
        base_locator = (
            f"{DOCUMENT_ID} §6.4, Power Transistor Application Notes 4-5, "
            "report p. 117 (PDF p. 125)"
        )
        checks = [_obligation_check(
            params,
            parameter="supplier_soa_verified",
            description=(
                "Temperature-adjusted supplier safe operating area is not exceeded "
                "under any transient condition"
            ),
            locator=base_locator,
        )]
    else:
        base_locator = (
            f"{DOCUMENT_ID} §7 Application Notes 2 and 5, report p. 126 "
            "(PDF p. 134); Figure 6-4, report p. 118 (PDF p. 126)"
        )
        checks = []
    checks.extend([
        _obligation_check(
            params,
            parameter="thermal_cycle_profile_verified",
            description="On-off temperature cycles satisfy the Figure 6-4 limit",
            locator=base_locator,
        ),
        _obligation_check(
            params,
            parameter="power_design_margins_verified",
            description=(
                "Gain, leakage-current, switching-time, and saturation-voltage "
                "application margins are applied"
            ),
            locator=base_locator,
        ),
    ])
    return checks


def _evaluate_power_or_rf(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    checks = _plain_limit_checks(model, params, level)
    multitransistor = model.startswith("rf_multitransistor_")
    checks.extend(_power_obligations(model, params, multitransistor=multitransistor))
    if model.startswith("power_"):
        warnings = [
            "Section 6.4 notes ESD sensitivity and that heat sinks may be needed. "
            "The supplier SOA remains an external verification rather than a "
            "reconstructed generic curve."
        ]
    else:
        exception_documented = _boolean(params, "rf_table_limit_exception_documented")
        if exception_documented:
            exception_parameters = {
                "power_dissipation_pct_of_rated",
                "breakdown_voltage_pct_of_rated",
                "soa_vce_pct_of_rated",
            }
            checks = [
                replace(
                    check,
                    status="not_evaluated",
                    message=(
                        f"{check.message} Section 7 application note 4 permits a "
                        "design-required voltage or power departure, and an external "
                        "engineering disposition was declared. Because the report "
                        "supplies no alternate numeric limit, this departure remains "
                        "not evaluated and is not counted as a pass."
                    ),
                    source_locator=(
                        f"{check.source_locator}; §7 Application Note 4, report p. 126 "
                        "(PDF p. 134)"
                    ),
                )
                if check.parameter in exception_parameters and check.status == "exceeds"
                else check
                for check in checks
            ]
        warnings = [
            "Section 7 application note 4 allows a documented design-required "
            "departure from voltage or power limits, but always requires the "
            "junction/channel-temperature limit. It does not import Section 6's "
            "supplier-SOA obligation; silicon Table 7-3 SOA-current remains enforced.",
            "RF devices may be ESD-sensitive and may need heat sinking."
        ]
    if multitransistor:
        warnings.append(
            "Section 7 applies the single-transistor criteria to multitransistor "
            "packages. Its die-attach example recommends heightened assembly and "
            "thermal scrutiny as guidance rather than a separate mandatory acceptance gate."
        )
    return checks, warnings


def _evaluate_plain(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    return _plain_limit_checks(model, params, level), []


def _minimum_numeric_check(
    params: Mapping[str, Any],
    *,
    parameter: str,
    description: str,
    minimum: float,
    unit: str,
    locator: str,
) -> RLTR9211Check:
    return _derived_bound_check(
        parameter=parameter,
        description=description,
        actual=_number(params, parameter, nonnegative=True),
        limit=minimum,
        comparison="≥",
        unit=unit,
        locator=locator,
    )


def _evaluate_opto(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    checks = _plain_limit_checks(model, params, level)
    locator = _application_locator(130, "Opto-electronic Device Application Notes")
    warnings: list[str] = []
    if model == "opto_avalanche_photodiode":
        checks.append(_minimum_numeric_check(
            params,
            parameter="gain_margin_db",
            description="APD gain-degradation margin",
            minimum=3,
            unit="dB",
            locator=locator,
        ))
    elif model == "opto_coupler":
        checks.extend((
            _minimum_numeric_check(
                params,
                parameter="ctr_degradation_allowance_pct",
                description="Optocoupler service-life CTR degradation allowance",
                minimum=15,
                unit="%",
                locator=locator,
            ),
            _obligation_check(
                params,
                parameter="drive_current_above_turn_on_verified",
                description="Optocoupler drive current is well above turn-on",
                locator=locator,
            ),
        ))
        warnings.append(
            "The report notes that external bypassing may be needed to suppress "
            "damaging internal oscillation in very-high-gain optocouplers."
        )
    elif model == "opto_injection_laser":
        checks.extend((
            _minimum_numeric_check(
                params,
                parameter="optical_power_margin_db",
                description="ILD optical-output degradation margin",
                minimum=3,
                unit="dB",
                locator=locator,
            ),
            _obligation_check(
                params,
                parameter="current_pulse_protection_verified",
                description="ILD current-pulse facet-damage protection is provided",
                locator=locator,
            ),
            _obligation_check(
                params,
                parameter="optical_power_monitored_controlled",
                description="ILD optical output is temperature-aware, monitored, and controlled",
                locator=locator,
            ),
        ))
        glassivated, applicability_check = _required_applicability_check(
            params,
            parameter="sio2_glassivated",
            description="SiO2-glassivation hermetic-seal applicability",
            locator=locator,
        )
        if applicability_check is not None:
            checks.append(applicability_check)
        elif glassivated:
            checks.append(_obligation_check(
                params,
                parameter="hermetic_seal_integrity_verified",
                description="SiO2-glassivated ILD package hermetic seal is maintained",
                locator=locator,
            ))
        warnings.append(
            "Thermal/mechanical shock and vibration can grow dark-line defects; "
            "the report identifies stress screening as an available control but "
            "does not make it a universal acceptance gate."
        )
    elif model == "opto_led":
        checks.append(_obligation_check(
            params,
            parameter="current_limiting_verified",
            description="LED current limiting is provided",
            locator=locator,
        ))
        rectified, applicability_check = _required_applicability_check(
            params,
            parameter="rectified_ac_drive",
            description="Rectified-AC LED-drive applicability",
            locator=locator,
        )
        if applicability_check is not None:
            checks.append(applicability_check)
        elif rectified:
            checks.append(_max_check(
                params,
                parameter="peak_forward_current_pct_of_dc_max",
                description="Rectified-AC peak LED current",
                limit=100,
                unit="% of allowable DC maximum",
                locator=locator,
            ))
            warnings.append(
                "RL-TR-92-11 does not recommend half- or full-wave rectified-AC "
                "LED drive, even when its hard peak-current ceiling is met."
            )
    return checks, warnings


def _evaluate_passive(
    model: str,
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    checks = _plain_limit_checks(model, params, level)
    locator = _application_locator(134, "Passive Device Application Notes")
    if model == "passive_chip_resistor_rm":
        checks.extend((
            _minimum_numeric_check(
                params,
                parameter="resistance_shift_tolerance_pct",
                description="Allowed resistance-value shift",
                minimum=2,
                unit="%",
                locator=locator,
            ),
            _strict_max_check(
                params,
                parameter="film_temperature_c",
                description="Chip-resistor film temperature",
                limit=150,
                unit="°C",
                locator=locator,
            ),
            _strict_max_check(
                params,
                parameter="voltage_stress_v_per_mil",
                description="Chip-resistor voltage stress",
                limit=2,
                unit="V/mil",
                locator=locator,
            ),
            _strict_max_check(
                params,
                parameter="power_density_w_per_in2",
                description="Chip-resistor power density",
                limit=200,
                unit="W/in²",
                locator=locator,
            ),
            _obligation_check(
                params,
                parameter="resistor_stacking_avoided",
                description="Resistor stacking is avoided",
                locator=locator,
            ),
        ))
        for selector, selector_description, obligation, obligation_description in (
            (
                "low_noise_application",
                "Low-noise trimming applicability",
                "proper_trimming_verified",
                "Proper trimming prevents latent failure in the low-noise application",
            ),
            (
                "pulse_application",
                "Pulse-application derating applicability",
                "pulse_average_power_basis_verified",
                "Average power from pulse magnitude, duration, and repetition frequency "
                "is used for power derating",
            ),
        ):
            applicable, applicability_check = _required_applicability_check(
                params,
                parameter=selector,
                description=selector_description,
                locator=locator,
            )
            if applicability_check is not None:
                checks.append(applicability_check)
            elif applicable:
                checks.append(_obligation_check(
                    params,
                    parameter=obligation,
                    description=obligation_description,
                    locator=locator,
                ))
                if selector == "pulse_application":
                    checks.append(_obligation_check(
                        params,
                        parameter="pulse_voltage_magnitude_basis_verified",
                        description="Pulse magnitude is used for voltage derating",
                        locator=locator,
                    ))
        frequency = _number(params, "operating_frequency_mhz", nonnegative=True)
        if frequency is None:
            checks.append(_missing_check(
                parameter="operating_frequency_mhz",
                description="High-frequency effective-resistance applicability",
                selected_limit=200,
                unit="MHz",
                comparison="threshold is known",
                locator=locator,
            ))
        elif frequency > 200:
            checks.append(_obligation_check(
                params,
                parameter="high_frequency_effective_resistance_accounted",
                description="Reduced effective resistance above 200 MHz is accounted for",
                locator=locator,
            ))
        return checks, ["RL-TR-92-11 identifies RM chip resistors as ESD-sensitive."]

    dc = _number(params, "dc_voltage_pct_of_rated", nonnegative=True)
    peak_ac = _number(params, "peak_ac_voltage_pct_of_rated", nonnegative=True)
    combined = None if dc is None or peak_ac is None else dc + peak_ac
    limit = float(_DEVICE_CATALOG[model]["limits"]["dc_voltage_pct_of_rated"][level])
    checks.extend((
        _derived_bound_check(
            parameter="combined_peak_ac_plus_dc_voltage_pct_of_rated",
            description="Peak AC voltage plus DC bias",
            actual=combined,
            limit=limit,
            comparison="≤",
            unit="% of rated",
            locator=locator,
            formula="VAC,peak + VDC <= Vderated,max",
            substitution=(
                None if combined is None else f"{peak_ac:g} + {dc:g} = {combined:g}% ≤ {limit:g}%"
            ),
        ),
        _minimum_numeric_check(
            params,
            parameter="design_tolerance_pct",
            description="Capacitor design tolerance allowance",
            minimum=12 if model == "passive_chip_capacitor_cdr" else 8,
            unit="%",
            locator=locator,
        ),
    ))

    voltage_locator = _mil198_locator(
        "6.5(d)", "15–16", "peak applied voltage and transients",
    )
    transient_present, transient_declaration = _advisory_declaration_check(
        params,
        parameter="transient_voltage_present",
        description="Short-duration voltage-transient applicability",
        locator=voltage_locator,
    )
    checks.append(transient_declaration)
    supplied_peak_including_transients = _number(
        params,
        "maximum_applied_peak_voltage_including_transients_pct_of_rated",
        nonnegative=True,
    )
    if transient_present or supplied_peak_including_transients is not None:
        checks.append(_advisory_max_check(
            params,
            parameter=(
                "maximum_applied_peak_voltage_including_transients_pct_of_rated"
            ),
            description="Maximum applied peak voltage including transients",
            limit=100,
            unit="% of rated",
            locator=voltage_locator,
            formula="Vpeak,total <= Vrated",
        ))

    ac_pulse_locator = _mil198_locator(
        "6.5(w)", "17", "special ratings/tests for AC and pulse service",
    )
    ac_or_pulse, ac_pulse_declaration = _advisory_declaration_check(
        params,
        parameter="ac_or_pulse_service",
        description="AC- or pulse-service applicability",
        locator=ac_pulse_locator,
    )
    checks.append(ac_pulse_declaration)
    if peak_ac is not None and peak_ac > 0 and ac_or_pulse is False:
        checks.append(RLTR9211Check(
            parameter="ac_or_pulse_service",
            description="AC-service declaration agrees with the entered peak AC voltage",
            actual_value=False,
            selected_limit=True,
            unit="applicability",
            comparison="is consistent",
            status="not_evaluated",
            message=(
                "peak_ac_voltage_pct_of_rated is nonzero, so AC service cannot "
                "be declared false; correct the applicability input."
            ),
            source_locator=ac_pulse_locator,
        ))
    elif ac_or_pulse:
        checks.append(_advisory_review_check(
            params,
            parameter="special_ac_pulse_rating_and_test_evidence_verified",
            description="Application-specific AC/pulse rating or test evidence review",
            locator=ac_pulse_locator,
        ))

    for parameter, description, section, pages, topic in (
        (
            "peak_charge_discharge_current_and_time_constant_reviewed",
            "Peak charge/discharge current and circuit time constant review",
            "6.5(h)", "16", "charge/discharge current",
        ),
        (
            "internal_heating_and_ambient_reviewed",
            "Internal heating and worst-case ambient review",
            "6.5(i)", "16", "internal heating and ambient temperature",
        ),
        (
            "environmental_conditions_reviewed",
            "Storage and operating environment review",
            "6.5(k)", "17", "environmental conditions",
        ),
        (
            "insulation_resistance_at_temperature_reviewed",
            "Insulation resistance at temperature review",
            "6.5(l)", "17", "insulation resistance",
        ),
    ):
        checks.append(_advisory_review_check(
            params,
            parameter=parameter,
            description=description,
            locator=_mil198_locator(section, pages, topic),
        ))

    if model == "passive_chip_capacitor_cdr":
        cdr_locator = _mil198_locator(
            "903.1", "903.1",
            "CDR application information as superseded by Notice 2",
        )
        checks.append(_advisory_review_check(
            params,
            parameter="cdr_dielectric_environment_effects_reviewed",
            description=(
                "CDR dielectric temperature, aging, field, humidity, and "
                "contamination effects review"
            ),
            locator=cdr_locator,
        ))
        pure_silver, pure_silver_check = _advisory_declaration_check(
            params,
            parameter="cdr_pure_silver_termination",
            description="Pure-silver CDR termination applicability",
            locator=cdr_locator,
        )
        humid_dc, humid_dc_check = _advisory_declaration_check(
            params,
            parameter="simultaneous_high_humidity_and_dc",
            description="Simultaneous high-humidity and DC-bias applicability",
            locator=cdr_locator,
        )
        checks.extend((pure_silver_check, humid_dc_check))
        if pure_silver and humid_dc:
            checks.append(_advisory_review_check(
                params,
                parameter="cdr_silver_migration_mitigation_documented",
                description="CDR silver-migration mitigation review",
                locator=cdr_locator,
            ))
        checks.append(_advisory_review_check(
            params,
            parameter="cdr_substrate_cte_compatibility_reviewed",
            description="CDR substrate CTE and mounting thermal-shock review",
            locator=cdr_locator,
        ))
    else:
        cwr_locator = _mil198_locator(
            "703.1", "703.1", "CWR intended-use application information",
        )
        if peak_ac is not None and peak_ac > 0:
            checks.append(_advisory_review_check(
                params,
                parameter="cwr_ac_component_small_relative_to_dc_attested",
                description="CWR AC component is small relative to its DC rating",
                locator=cwr_locator,
            ))
        checks.append(_advisory_review_check(
            params,
            parameter="cwr_supplemental_moisture_protection_available",
            description="CWR supplemental moisture protection availability",
            locator=cwr_locator,
        ))

    return checks, [
        "RL-TR-92-11 says MIL-STD-198E precautions should be followed, but "
        "MIL-STD-198E identifies its application information as nonmandatory "
        "guidance. Imported precautions therefore affect coverage and warnings, "
        "not mandatory-limit compliance.",
        "MIL-STD-198E was canceled by Notice 3 on 14 July 1999; its information "
        "was preserved in guidance-only MIL-HDBK-198.",
        *(
            (
                "MIL-STD-198E's approximate 55%-at-125°C CWR point is not "
                "interpolated: RL-TR-92-11 already imposes the stricter 85°C "
                "temperature ceiling and 60% voltage limit.",
            )
            if model == "passive_chip_capacitor_cwr" else ()
        ),
    ]


def _evaluate_saw(
    params: Mapping[str, Any],
    level: str,
) -> tuple[list[RLTR9211Check], list[str]]:
    model = "saw_device"
    frequency = _number(params, "frequency_mhz", nonnegative=True)
    checks: list[RLTR9211Check] = []
    locator = _locator(model, "Input power")
    if frequency is None:
        checks.append(_missing_check(
            parameter="input_power_dbm",
            description="Maximum input power",
            selected_limit=None,
            unit="dBm",
            comparison="≤",
            locator=locator,
            reason="frequency_mhz is required to select the Table 10-2 input-power row.",
        ))
    elif frequency == 500.0:
        checks.append(_unsupported_check(
            parameter="frequency_mhz",
            description="SAW input-power frequency regime",
            actual=frequency,
            message=(
                "Table 10-2 defines input power only below and above 500 MHz; "
                "exactly 500 MHz is undefined and is not assigned to either row."
            ),
            locator=locator,
        ))
    else:
        regime = (
            "frequency_below_500_mhz"
            if frequency < 500.0
            else "frequency_above_500_mhz"
        )
        limit = float(_DEVICE_CATALOG[model]["limits"]["input_power_dbm"][regime][level])
        checks.append(_max_check(
            params,
            parameter="input_power_dbm",
            description="Maximum input power",
            limit=limit,
            unit="dBm",
            locator=locator,
            nonnegative=False,
        ))
    checks.extend(_plain_limit_checks(
        model,
        params,
        level,
        include=("operating_temperature_c",),
    ))
    application_locator = _application_locator(135, "SAW Device Application Notes")
    checks.extend(
        _obligation_check(
            params,
            parameter=parameter,
            description=description,
            locator=application_locator,
        )
        for parameter, description in (
            (
                "hermetic_package_integrity_verified",
                "SAW hermetic-package integrity is maintained",
            ),
            (
                "shock_below_rated_max_verified",
                "SAW shock remains below the rated maximum",
            ),
            (
                "vibration_below_rated_max_verified",
                "SAW vibration remains below the rated maximum",
            ),
            (
                "temperature_cycle_below_rated_max_verified",
                "SAW temperature cycling remains below the rated maximum",
            ),
        )
    )
    return checks, [
        "Table 10-2 uses strict frequency branches (<500 MHz and >500 MHz); "
        "the exact 500 MHz boundary is intentionally left unsupported.",
        "Report p. 135 also identifies possible SAW ESD sensitivity."
    ]


def _evaluate_unsupported_hybrid(
    params: Mapping[str, Any],
) -> tuple[list[RLTR9211Check], list[str]]:
    model = "hybrid_deposited_film_resistor"
    reason = _DEVICE_CATALOG[model]["reason"]
    return [
        _unsupported_check(
            parameter="device_type",
            description="Hybrid deposited-film resistor derating criteria",
            actual=model,
            message=reason,
            locator=(
                f"{DOCUMENT_ID} §9.0, report p. 131 (PDF p. 139); "
                "Table 9-2, report p. 133 (PDF p. 141) contains no row"
            ),
        )
    ], [reason]


def assess(
    device_type: str,
    params: Mapping[str, Any],
    level: str | int | None,
) -> RLTR9211Result:
    """Assess one device against a manually selected final-table level.

    Missing or delegated inputs are represented by ``not_evaluated`` checks;
    source contradictions and absent source rules are represented by
    ``unsupported`` checks.  Neither state can produce a passing result.
    """
    model = _model_key(device_type)
    if not isinstance(params, Mapping):
        raise ValueError("params must be a mapping")
    selected = _selected_level(level)

    if model.startswith("asic_"):
        checks, warnings = _evaluate_asic(model, params, selected)
    elif model.startswith("microprocessor_"):
        checks, warnings = _evaluate_microprocessor(model, params, selected)
    elif model.startswith("prom_"):
        checks, warnings = _evaluate_prom(model, params, selected)
    elif model == "mimic_gaas":
        checks, warnings = _evaluate_mimic(params, selected)
    elif model.startswith("power_") or model.startswith("rf_"):
        checks, warnings = _evaluate_power_or_rf(model, params, selected)
    elif model.startswith("opto_"):
        checks, warnings = _evaluate_opto(model, params, selected)
    elif model.startswith("passive_chip_"):
        checks, warnings = _evaluate_passive(model, params, selected)
    elif model == "saw_device":
        checks, warnings = _evaluate_saw(params, selected)
    elif model == "hybrid_deposited_film_resistor":
        checks, warnings = _evaluate_unsupported_hybrid(params)
    else:
        checks, warnings = _evaluate_plain(model, params, selected)
    return _result(model, selected, params, checks, warnings)
