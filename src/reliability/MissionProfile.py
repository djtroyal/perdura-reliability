"""Mission-profile reliability using explicit operating and nonoperating rates.

Each phase is a calendar-time exposure.  ``operating_fraction`` partitions
that exposure between a MIL-HDBK-217F operating prediction and, when the
fraction is below one, a RADC-TR-85-91 nonoperating prediction::

    lambda_service = f_operating lambda_operating
                     + (1 - f_operating) lambda_nonoperating

The two source models are evaluated separately.  This module never derives a
nonoperating rate by multiplying the operating rate by a generic dormant
factor.  A mixed phase therefore requires an explicit RADC environment,
temperature, and power-cycle rate.  Part families are mapped only where the
MIL and RADC taxonomies establish an exact correspondence; otherwise callers
must provide the missing RADC model details through ``nonoperating_params``.

RADC-TR-85-91 Section 4.5 text excludes Space, Flight (``SF``) from the
nonoperating model.  Space phases must consequently be represented as fully
operating here or evaluated with a separately justified nonoperating model.
"""

from __future__ import annotations

import inspect
import math
from collections.abc import Mapping, Sequence
from typing import Any

from reliability.RADC_TR_85_91 import (
    NONOPERATING_ENVIRONMENTS,
    REPORT_EDITION as RADC_REPORT_EDITION,
    UnsupportedRADCModelError,
    predict_nonoperating,
)


FPMH = "failures per 10^6 calendar hours"
SERVICE_EQUATION = (
    "lambda_service = f_operating lambda_operating + "
    "(1-f_operating) lambda_nonoperating"
)


class MissionPhase:
    """A calendar-time phase with an explicit operating exposure fraction.

    Parameters
    ----------
    name : str
        Short phase name.
    duration : float
        Positive calendar duration in hours.
    environment : str
        MIL-HDBK-217F operating environment code.
    temperature : float
        Operating ambient, case, or junction temperature in degrees Celsius;
        it is mapped to the selected part constructor's temperature argument.
    operating_fraction : float
        Fraction of calendar time spent operating, from zero through one.
    nonoperating_environment : str, optional
        RADC-TR-85-91 environment code.  Required when
        ``operating_fraction < 1``.  ``SF`` is deliberately unsupported.
    nonoperating_temperature_c : float, optional
        Nonoperating ambient temperature.  Required for mixed phases even
        when the selected RADC part equation does not use temperature, so the
        exposure contract remains explicit and auditable.
    power_cycles_per_1000_nonoperating_hours : float, optional
        Equipment power-cycle rate during nonoperating exposure.  Required
        for mixed phases; enter zero only when no cycles occur.
    description : str
        Optional longer description.
    """

    def __init__(
        self,
        name: str,
        duration: float,
        environment: str = "GB",
        temperature: float = 40.0,
        operating_fraction: float = 1.0,
        nonoperating_environment: str | None = None,
        nonoperating_temperature_c: float | None = None,
        power_cycles_per_1000_nonoperating_hours: float | None = None,
        description: str = "",
    ):
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name must be a non-empty string")
        duration = _finite(duration, "duration")
        if duration <= 0:
            raise ValueError("duration must be > 0")
        if not isinstance(environment, str) or not environment.strip():
            raise ValueError("environment must be a non-empty string")
        temperature = _finite(temperature, "temperature")
        operating_fraction = _finite(operating_fraction, "operating_fraction")
        if not 0 <= operating_fraction <= 1:
            raise ValueError("operating_fraction must be between 0 and 1")

        if operating_fraction < 1:
            if nonoperating_environment is None:
                raise ValueError(
                    "nonoperating_environment is required when "
                    "operating_fraction is below 1"
                )
            if nonoperating_environment not in NONOPERATING_ENVIRONMENTS:
                raise ValueError(
                    "nonoperating_environment must be a supported "
                    f"RADC-TR-85-91 code; got {nonoperating_environment!r}"
                )
            if nonoperating_temperature_c is None:
                raise ValueError(
                    "nonoperating_temperature_c is required when "
                    "operating_fraction is below 1"
                )
            if power_cycles_per_1000_nonoperating_hours is None:
                raise ValueError(
                    "power_cycles_per_1000_nonoperating_hours is required "
                    "when operating_fraction is below 1"
                )

        if nonoperating_environment is not None:
            if nonoperating_environment not in NONOPERATING_ENVIRONMENTS:
                raise ValueError(
                    "nonoperating_environment must be a supported "
                    f"RADC-TR-85-91 code; got {nonoperating_environment!r}"
                )
        if nonoperating_temperature_c is not None:
            nonoperating_temperature_c = _finite(
                nonoperating_temperature_c, "nonoperating_temperature_c"
            )
        if power_cycles_per_1000_nonoperating_hours is not None:
            power_cycles_per_1000_nonoperating_hours = _finite(
                power_cycles_per_1000_nonoperating_hours,
                "power_cycles_per_1000_nonoperating_hours",
            )
            if power_cycles_per_1000_nonoperating_hours < 0:
                raise ValueError(
                    "power_cycles_per_1000_nonoperating_hours must be >= 0"
                )

        self.name = name.strip()
        self.duration = duration
        self.environment = environment.strip()
        self.temperature = temperature
        self.operating_fraction = operating_fraction
        self.nonoperating_environment = nonoperating_environment
        self.nonoperating_temperature_c = nonoperating_temperature_c
        self.power_cycles_per_1000_nonoperating_hours = (
            power_cycles_per_1000_nonoperating_hours
        )
        self.description = description

    @property
    def nonoperating_fraction(self) -> float:
        """Fraction of this phase spent nonoperating."""
        return 1.0 - self.operating_fraction

    def __repr__(self) -> str:
        return (
            f"MissionPhase({self.name!r}, {self.duration}h, "
            f"env={self.environment!r}, T={self.temperature}°C, "
            f"operating_fraction={self.operating_fraction})"
        )


class MissionProfile:
    """A complete mission profile composed of sequential phases."""

    def __init__(self, name: str = "Default Mission", phases: list | None = None):
        self.name = name
        self.phases: list[MissionPhase] = list(phases or [])

    def add_phase(self, phase: MissionPhase) -> None:
        """Append a validated phase to the profile."""
        if not isinstance(phase, MissionPhase):
            raise TypeError("phase must be a MissionPhase")
        self.phases.append(phase)

    @property
    def total_duration(self) -> float:
        """Total calendar duration in hours."""
        return sum(phase.duration for phase in self.phases)

    @property
    def operating_duration(self) -> float:
        """Total operating exposure in hours."""
        return sum(
            phase.duration * phase.operating_fraction for phase in self.phases
        )

    @property
    def nonoperating_duration(self) -> float:
        """Total nonoperating exposure in hours."""
        return self.total_duration - self.operating_duration

    def phase_fractions(self) -> list[float]:
        """Calendar-time fraction represented by each phase."""
        total = self.total_duration
        if total == 0:
            return []
        return [phase.duration / total for phase in self.phases]

    def __repr__(self) -> str:
        return (
            f"MissionProfile({self.name!r}, {len(self.phases)} phases, "
            f"{self.total_duration}h)"
        )


class MissionCalculationError(ValueError):
    """A part could not be evaluated for a specific mission phase."""

    code = "MISSION_PART_PHASE_CALCULATION_FAILED"

    def __init__(self, part_class: Any, phase: MissionPhase, cause: Exception,
                 *, stage: str):
        self.part_class = getattr(part_class, "__name__", str(part_class))
        self.phase_name = phase.name
        self.stage = stage
        self.error_type = type(cause).__name__
        self.original_message = str(cause)
        self.part_index: int | None = None
        self.part_name: str | None = None
        super().__init__(
            f"Failed to calculate {stage} rate for {self.part_class} during "
            f"mission phase {self.phase_name!r}: {self.original_message}"
        )

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serializable error details."""
        detail: dict[str, Any] = {
            "code": self.code,
            "part_class": self.part_class,
            "phase_name": self.phase_name,
            "stage": self.stage,
            "error_type": self.error_type,
            "message": self.original_message,
        }
        if self.part_index is not None:
            detail["part_index"] = self.part_index
        if self.part_name is not None:
            detail["part_name"] = self.part_name
        return detail


def _finite(value: float, name: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{name} must be finite") from None
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


# ---------------------------------------------------------------------------
# MIL-HDBK-217F operating-model preparation
# ---------------------------------------------------------------------------

_TEMP_KWARG_CANDIDATES = (
    "T_junction",
    "T_ambient",
    "case_temperature_c",
    "channel_temperature_c",
    "T_hotspot",
    "frame_temperature",
    "T_insert",
    "temperature",
)


def _constructor_parameters(part_class: Any) -> Mapping[str, inspect.Parameter]:
    try:
        return inspect.signature(part_class.__init__).parameters
    except (TypeError, ValueError):
        return {}


def _prepare_operating_kwargs(
    part_class: Any, part_params: Mapping[str, Any], phase: MissionPhase
) -> dict[str, Any]:
    """Map the phase exposure only to arguments accepted by the part model."""
    kwargs = dict(part_params)
    parameters = _constructor_parameters(part_class)
    if "environment" in parameters:
        kwargs["environment"] = phase.environment

    temperature_kwarg = next(
        (name for name in _TEMP_KWARG_CANDIDATES if name in parameters), None
    )
    for name in _TEMP_KWARG_CANDIDATES:
        kwargs.pop(name, None)
    if temperature_kwarg is not None:
        kwargs[temperature_kwarg] = phase.temperature
    return kwargs


# ---------------------------------------------------------------------------
# Exact MIL-to-RADC part mapping
# ---------------------------------------------------------------------------

_MISSING = object()


def _required(values: Mapping[str, Any], key: str, reason: str) -> Any:
    value = values.get(key, _MISSING)
    if value is _MISSING or value is None or value == "":
        raise UnsupportedRADCModelError(
            f"{reason}; provide nonoperating_params.{key} or choose an "
            "explicit RADC model"
        )
    return value


def _radc_package(value: Any, overrides: Mapping[str, Any]) -> str:
    if overrides.get("package"):
        return str(overrides["package"])
    package = str(value or "")
    if package.startswith("nonhermetic"):
        return "nonhermetic"
    if package in {
        "hermetic_dip",
        "hermetic_pga",
        "hermetic_smt",
        "glass_dip",
        "flatpack",
        "can",
    }:
        return "hermetic"
    raise UnsupportedRADCModelError(
        "the operating package does not establish RADC hermeticity; provide "
        "nonoperating_params.package as 'hermetic' or 'nonhermetic'"
    )


def _radc_quality(
    value: Any,
    mapping: Mapping[str, str],
    overrides: Mapping[str, Any],
    family: str,
) -> str:
    if overrides.get("quality"):
        return str(overrides["quality"])
    key = str(value or "")
    if key in mapping:
        return mapping[key]
    raise UnsupportedRADCModelError(
        f"the operating {family} quality {key!r} has no exact RADC quality "
        "mapping; provide nonoperating_params.quality"
    )


def _inject_phase_context(
    model: str, values: dict[str, Any], phase: MissionPhase
) -> None:
    """Inject only the exposure variables defined by the selected RADC model."""
    environment_models = {
        "microelectronic_device",
        "hybrid_microcircuit",
        "magnetic_bubble_memory",
        "discrete_semiconductor",
        "tube",
        "laser",
        "resistor",
        "capacitor",
        "inductive_device",
        "relay",
        "switch",
        "connector",
        "pth_assembly",
        "connections",
        "miscellaneous_part",
    }
    temperature_models = {
        "microelectronic_device",
        "magnetic_bubble_memory",
        "discrete_semiconductor",
    }
    cycling_models = {
        "microelectronic_device",
        "discrete_semiconductor",
        "resistor",
        "capacitor",
        "inductive_device",
        "miscellaneous_part",
    }
    if model in environment_models:
        values.setdefault("environment", phase.nonoperating_environment)
    if model in temperature_models:
        values.setdefault("temperature_c", phase.nonoperating_temperature_c)
    if model in cycling_models:
        values.setdefault(
            "power_cycles_per_1000h",
            phase.power_cycles_per_1000_nonoperating_hours,
        )


def _automatic_radc_request(
    part_class: Any,
    part_params: Mapping[str, Any],
    phase: MissionPhase,
    overrides: Mapping[str, Any],
) -> tuple[str, dict[str, Any], str]:
    """Return an exact RADC model request or fail without guessing."""
    category = getattr(part_class, "category", None)
    params = dict(part_params)
    extra = dict(overrides)
    environment = phase.nonoperating_environment
    temperature = phase.nonoperating_temperature_c
    cycles = phase.power_cycles_per_1000_nonoperating_hours

    if category == "microcircuit":
        raw_device = str(params.get("device_type", "digital"))
        if raw_device == "linear":
            device, technology = "linear", extra.get("technology", "linear")
        elif raw_device == "memory":
            device = "memory"
            technology = (
                "ccd"
                if params.get("memory_type") == "ccd"
                else _required(
                    extra,
                    "technology",
                    "generic MOS/bipolar does not identify the report's memory technology",
                )
            )
        elif raw_device in {
            "digital", "pla", "programmable_logic", "microprocessor"
        }:
            device = "digital"
            technology = _required(
                extra,
                "technology",
                "generic MOS/bipolar does not identify the report's digital technology",
            )
        else:
            raise UnsupportedRADCModelError(
                f"microcircuit device type {raw_device!r} is outside "
                "RADC Sections 5.2.2.1–5.2.2.5"
            )
        quality = _radc_quality(
            params.get("quality"),
            {"S": "S", "B": "B", "B-1": "B-1"},
            extra,
            "microcircuit",
        )
        return "microelectronic_device", {
            "device_type": device,
            "technology": technology,
            "complexity": params.get("complexity", 1000),
            "package": _radc_package(params.get("package", "nonhermetic"), extra),
            "quality": quality,
            "environment": environment,
            "temperature_c": temperature,
            "power_cycles_per_1000h": cycles,
        }, f"{category} -> RADC {device} microelectronic device"

    if category == "hybrid_microcircuit":
        quality = _radc_quality(
            params.get("quality"), {"S": "S", "B": "B"}, extra, "hybrid"
        )
        return "hybrid_microcircuit", {
            "diodes": _required(
                extra, "diodes", "the operating aggregate omits hybrid device counts"
            ),
            "transistors": _required(
                extra, "transistors", "the operating aggregate omits hybrid device counts"
            ),
            "integrated_circuits": _required(
                extra,
                "integrated_circuits",
                "the operating aggregate omits hybrid device counts",
            ),
            "quality": quality,
            "environment": environment,
        }, "hybrid_microcircuit -> RADC counted-device hybrid"

    if category == "bubble_memory":
        return "magnetic_bubble_memory", {
            "transfer_gates": _required(
                extra,
                "transfer_gates",
                "the operating model omits the RADC gate decomposition",
            ),
            "dissipative_control_gates": _required(
                extra,
                "dissipative_control_gates",
                "the operating model omits the RADC gate decomposition",
            ),
            "major_loops": _required(
                extra,
                "major_loops",
                "the operating model omits the RADC loop decomposition",
            ),
            "functional_minor_loops": _required(
                extra,
                "functional_minor_loops",
                "the operating model omits the RADC loop decomposition",
            ),
            "temperature_c": temperature,
            "environment": environment,
        }, "bubble_memory -> RADC two-structure bubble-memory model"

    discrete_quality = {
        "JANTXV": "JANTXV",
        "JANTX": "JANTX",
        "JAN": "JAN",
        "lower": "Lower, Hermetic",
        "plastic": "Plastic",
    }
    if category in {
        "diode",
        "bjt",
        "fet",
        "unijunction",
        "hf_diode",
        "hf_low_noise_bjt",
        "hf_power_bjt",
        "thyristor",
        "optoelectronic",
    }:
        part_type: str | None = None
        if category == "fet":
            part_type = "fet"
        elif category == "unijunction":
            part_type = "unijunction"
        elif category == "thyristor":
            part_type = "thyristor"
        elif category in {"hf_low_noise_bjt", "hf_power_bjt"}:
            part_type = "microwave_transistor"
        elif category == "hf_diode":
            diode_type = str(params.get("diode_type", ""))
            if diode_type in {
                "impatt", "gunn", "varactor", "pin", "step_recovery", "tunnel"
            }:
                part_type = diode_type
            elif params.get("application") in {"detector", "mixer"}:
                part_type = f"microwave_{params['application']}"
        elif category == "optoelectronic":
            device = str(params.get("device", "led"))
            if device in {"led", "ir_led"}:
                part_type = "led"
            elif device in {"phototransistor", "photodiode"}:
                part_type = device
            elif device == "optical_isolator":
                part_type = (
                    "dual_isolator"
                    if params.get("channels") == "dual"
                    else "single_isolator"
                )
            elif device == "alphanumeric_display":
                part_type = "alpha_numeric_display"
        part_type = str(extra.get("part_type") or part_type or "")
        if not part_type:
            raise UnsupportedRADCModelError(
                f"{category} lacks the material/polarity/subtype required by "
                "RADC Table 5.2.3-1; provide nonoperating_params.part_type"
            )
        quality = _radc_quality(
            params.get("quality", "plastic"),
            discrete_quality,
            extra,
            "discrete semiconductor",
        )
        return "discrete_semiconductor", {
            "part_type": part_type,
            "quality": quality,
            "environment": environment,
            "temperature_c": temperature,
            "power_cycles_per_1000h": cycles,
        }, f"{category} -> RADC discrete semiconductor {part_type}"

    if category in {"electron_tube", "traveling_wave_tube", "magnetron"}:
        if category == "traveling_wave_tube":
            tube_type = "twt"
        elif category == "magnetron":
            tube_type = "magnetron"
        else:
            raw = str(params.get("tube_type", "receiver_triode_tetrode_pentode"))
            if raw == "power_rectifier":
                tube_type = "receiver_power_rectifier"
            elif raw.startswith("vidicon_"):
                tube_type = "vidicon"
            elif raw.startswith("cfa_"):
                tube_type = "crossed_field_amplifier"
            elif raw.startswith("pulsed_gridded_"):
                tube_type = "pulsed_gridded"
            elif raw.startswith("twystron_"):
                tube_type = "twystron"
            elif raw.startswith("pulsed_klystron_"):
                tube_type = "klystron_pulsed"
            elif raw.startswith("cw_klystron_"):
                tube_type = "klystron_continuous_wave"
            else:
                tube_type = str(extra.get("tube_type") or raw)
        return "tube", {
            "tube_type": tube_type,
            "environment": environment,
        }, f"{category} -> RADC tube {tube_type}"

    if category in {
        "gas_laser", "sealed_co2_laser", "flowing_co2_laser", "solid_state_laser"
    }:
        if category == "gas_laser":
            raw = params.get("laser_type", "helium_neon")
            laser_type = "argon_ion" if raw == "argon" else raw
            if laser_type not in {"helium_neon", "argon_ion"}:
                raise UnsupportedRADCModelError(
                    f"gas-laser type {raw!r} is not tabulated in RADC Section 5.2.5"
                )
        else:
            laser_type = {
                "sealed_co2_laser": "co2_sealed",
                "flowing_co2_laser": "co2_flowing",
                "solid_state_laser": "solid_state",
            }[category]
        values: dict[str, Any] = {
            "laser_type": laser_type,
            "environment": environment,
        }
        if laser_type in {"co2_sealed", "co2_flowing", "solid_state"}:
            values["active_optical_surfaces"] = params.get(
                "active_optical_surfaces", 1
            )
        return "laser", values, f"{category} -> RADC functional laser {laser_type}"

    if category == "resistor":
        quality = _radc_quality(
            params.get("quality", "commercial"),
            {
                "S": "S", "R": "R", "P": "P", "M": "M",
                "non-ER": "MIL-SPEC", "commercial": "Lower",
            },
            extra,
            "resistor",
        )
        return "resistor", {
            "style": params.get("style", "RL"),
            "quality": quality,
            "environment": environment,
            "power_cycles_per_1000h": cycles,
        }, "resistor style -> RADC Section 5.2.6"

    if category == "capacitor":
        quality = _radc_quality(
            params.get("quality", "commercial"),
            {
                "S": "S", "R": "R", "P": "P", "M": "M", "L": "L",
                "non-ER": "MIL-SPEC", "commercial": "Lower",
            },
            extra,
            "capacitor",
        )
        return "capacitor", {
            "style": params.get("style", "CK"),
            "quality": quality,
            "environment": environment,
            "power_cycles_per_1000h": cycles,
        }, "capacitor style -> RADC Section 5.2.7"

    if category in {"transformer", "inductor_coil"}:
        if category == "transformer":
            part_type = {
                "audio": "audio_transformer",
                "low_power_pulse": "low_power_pulse_transformer",
                "high_power_pulse": "high_power_pulse_transformer",
                "rf": "if_rf_discriminator_transformer",
            }.get(str(params.get("transformer_type", "low_power_pulse")), "power_transformer")
            quality_mapping = {"MIL-SPEC": "MIL-SPEC", "lower": "Lower"}
        else:
            part_type = "rf_coil_fixed_variable"
            quality_mapping = {
                "S": "S", "R": "R", "P": "P", "M": "M",
                "MIL-SPEC": "MIL-SPEC", "non-ER": "Lower",
            }
        quality = _radc_quality(
            params.get("quality"), quality_mapping, extra, "inductive device"
        )
        return "inductive_device", {
            "part_type": extra.get("part_type", part_type),
            "quality": quality,
            "environment": environment,
            "power_cycles_per_1000h": cycles,
        }, f"{category} -> RADC inductive device"

    if category in {"motor", "synchro_resolver", "elapsed_time_meter"}:
        part_type = {
            "motor": "motor",
            "elapsed_time_meter": "elapsed_time_meter",
            "synchro_resolver": str(params.get("device_type", "synchro")),
        }[category]
        return "rotating_device", {
            "part_type": part_type
        }, f"{category} -> RADC rotating-device average"

    if category == "relay":
        quality = _radc_quality(
            params.get("quality", "commercial"),
            {
                "R": "Established Reliability", "P": "Established Reliability",
                "X": "Established Reliability", "U": "Established Reliability",
                "M": "Established Reliability", "L": "Established Reliability",
                "MIL-SPEC": "MIL-SPEC", "commercial": "Lower",
            },
            extra,
            "relay",
        )
        return "relay", {
            "package_type": _required(
                extra,
                "package_type",
                "the operating relay model does not identify hermeticity",
            ),
            "contact_voltage_mv": _required(
                extra,
                "contact_voltage_mv",
                "the operating relay model does not contain contact voltage",
            ),
            "quality": quality,
            "environment": environment,
        }, "relay -> RADC contact-voltage model"

    if category == "switch":
        quality = _radc_quality(
            params.get("quality", "lower"),
            {"MIL-SPEC": "MIL-SPEC", "lower": "Lower"},
            extra,
            "switch",
        )
        return "switch", {
            "contact_voltage_mv": _required(
                extra,
                "contact_voltage_mv",
                "the operating switch model does not contain contact voltage",
            ),
            "quality": quality,
            "environment": environment,
        }, "switch -> RADC contact-voltage model"

    if category == "connector":
        connector_type = {
            "circular": "circular",
            "rf_coaxial": "coaxial",
            "power": "power",
            "rack_panel": "rack_and_panel",
            "card_edge": "printed_wiring_board",
        }.get(str(params.get("connector_type", "circular")))
        connector_type = str(extra.get("connector_type") or connector_type or "")
        if not connector_type:
            raise UnsupportedRADCModelError(
                "the connector construction is not one of the five RADC table "
                "types; provide nonoperating_params.connector_type"
            )
        return "connector", {
            "connector_type": connector_type,
            "environment": environment,
        }, f"connector -> RADC {connector_type}"

    if category == "pth_assembly":
        technology = str(params.get("technology", "printed_board"))
        if technology == "discrete_wiring":
            radc_technology = "discrete_wiring_electroless_deposited_pth"
        elif technology == "printed_board":
            planes = int(params.get("circuit_planes", 2))
            radc_technology = (
                "double_sided_soldered_printed_wiring"
                if planes == 2
                else "multilayer_soldered_printed_wiring"
                if planes > 2
                else ""
            )
        else:
            radc_technology = ""
        radc_technology = str(extra.get("technology") or radc_technology)
        if not radc_technology:
            raise UnsupportedRADCModelError(
                "the PTH technology cannot be mapped to RADC Table 5.2.13-1"
            )
        functional_pths = int(params.get("automated_pths", 100)) + int(
            params.get("hand_soldered_pths", 0)
        )
        return "pth_assembly", {
            "technology": radc_technology,
            "functional_pths": extra.get("functional_pths", functional_pths),
            "environment": environment,
        }, "PTH assembly -> RADC functional-PTH model"

    if category == "connection":
        connection_type = {
            "hand_solder_no_wrap": "hand_solder",
            "hand_solder_wrapped": "wrapped_and_soldered",
            "crimp": "crimp",
            "weld": "weld",
            "solderless_wrap": "solderless_wrap",
            "clip_termination": "clip_termination",
            "reflow_solder": "reflow_solder",
        }.get(str(params.get("connection_type", "reflow_solder")))
        connection_type = str(extra.get("connection_type") or connection_type or "")
        if not connection_type:
            raise UnsupportedRADCModelError(
                "the connection type is not tabulated in RADC Section 5.2.14"
            )
        return "connections", {
            "connection_counts": {connection_type: 1},
            "environment": environment,
        }, f"connection -> RADC {connection_type}"

    miscellaneous = {
        "crystal": "quartz_crystal",
        "fuse": "fuse",
        "meter": "meter",
        "circuit_breaker": "circuit_breaker",
    }
    if category in miscellaneous or category in {"miscellaneous", "lamp"}:
        part_type = str(
            extra.get("part_type")
            or miscellaneous.get(category)
            or (params.get("part_type") if category == "miscellaneous" else "")
            or ""
        )
        if not part_type:
            raise UnsupportedRADCModelError(
                f"{category} requires nonoperating_params.part_type from "
                "RADC Table 5.2.15-1"
            )
        values: dict[str, Any] = {"part_type": part_type}
        if part_type == "fiber_optic_cable":
            values["fiber_length_km"] = extra.get(
                "fiber_length_km", params.get("fiber_length_km", 1.0)
            )
        if part_type == "attenuator":
            values.update({
                "quality": _required(
                    extra,
                    "quality",
                    "attenuator delegates to the RD resistor quality table",
                ),
                "environment": environment,
                "power_cycles_per_1000h": cycles,
            })
        return "miscellaneous_part", values, (
            f"{category} -> RADC miscellaneous {part_type}"
        )

    raise UnsupportedRADCModelError(
        f"MIL-HDBK-217F category {category!r} has no exact "
        "RADC-TR-85-91 mapping"
    )


def _predict_nonoperating_phase(
    part_class: Any,
    part_params: Mapping[str, Any],
    phase: MissionPhase,
    nonoperating_params: Mapping[str, Any] | None,
) -> tuple[Any, str]:
    values = dict(nonoperating_params or {})
    explicit_model = values.pop("model", None)
    if explicit_model:
        model = str(explicit_model)
        _inject_phase_context(model, values, phase)
        mapping = f"explicit RADC model {model}"
    else:
        model, values, mapping = _automatic_radc_request(
            part_class, part_params, phase, values
        )
    return predict_nonoperating(model, **values), mapping


# ---------------------------------------------------------------------------
# Core calculations
# ---------------------------------------------------------------------------

def compute_mission_failure_rate(
    profile: MissionProfile,
    part_class: Any,
    part_params: Mapping[str, Any],
    *,
    nonoperating_params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Calculate one part's operating/nonoperating service-life prediction.

    ``nonoperating_params`` can supply missing exact mapping inputs (for
    example ``{"part_type": "si_npn"}`` for a bipolar transistor).  A
    ``model`` key selects a RADC calculator explicitly; phase exposure values
    are injected only when that calculator defines them.

    Returned phase rates are all part-total rates, including quantity.  The
    operating rate includes the MIL part model's configured multiplier.  The
    RADC report rate is multiplied by quantity but does not inherit an
    operating-model multiplier.
    """
    if not profile.phases:
        raise ValueError("Mission profile has no phases")
    if not isinstance(part_params, Mapping):
        raise TypeError("part_params must be a mapping")

    total_time = profile.total_duration
    operating_contribution = 0.0
    nonoperating_contribution = 0.0
    service_weighted_sum = 0.0
    cumulative_hazard = 0.0
    phase_results: list[dict[str, Any]] = []

    for phase in profile.phases:
        try:
            part = part_class(
                **_prepare_operating_kwargs(part_class, part_params, phase)
            )
        except (TypeError, ValueError) as exc:
            raise MissionCalculationError(
                part_class, phase, exc, stage="operating"
            ) from exc

        operating_piece_rate = float(part.failure_rate)
        operating_total_rate = float(part.total_failure_rate)
        quantity = int(part.quantity)
        nonoperating_piece_rate: float | None = None
        nonoperating_total_rate: float | None = None
        nonoperating_calculation: dict[str, Any] = {
            "status": "not_applicable",
            "reason": "operating_fraction is 1",
        }

        if phase.nonoperating_fraction > 0:
            try:
                radc_result, mapping = _predict_nonoperating_phase(
                    part_class,
                    part_params,
                    phase,
                    nonoperating_params,
                )
            except (TypeError, ValueError) as exc:
                raise MissionCalculationError(
                    part_class, phase, exc, stage="nonoperating"
                ) from exc
            nonoperating_piece_rate = float(radc_result.failure_rate)
            nonoperating_total_rate = nonoperating_piece_rate * quantity
            nonoperating_calculation = radc_result.long_form
            nonoperating_calculation["status"] = "supported"
            nonoperating_calculation["model_mapping"] = mapping

        service_rate = phase.operating_fraction * operating_total_rate
        operating_phase_contribution = (
            phase.operating_fraction * operating_total_rate
        )
        nonoperating_phase_contribution = 0.0
        if nonoperating_total_rate is not None:
            nonoperating_phase_contribution = (
                phase.nonoperating_fraction * nonoperating_total_rate
            )
            service_rate += nonoperating_phase_contribution

        mission_fraction = phase.duration / total_time
        weighted_operating = operating_phase_contribution * mission_fraction
        weighted_nonoperating = nonoperating_phase_contribution * mission_fraction
        weighted_service = service_rate * mission_fraction
        operating_contribution += weighted_operating
        nonoperating_contribution += weighted_nonoperating
        service_weighted_sum += weighted_service
        cumulative_hazard += service_rate * phase.duration / 1_000_000.0

        phase_results.append({
            "phase_name": phase.name,
            "duration_hours": phase.duration,
            "mission_time_fraction": round(mission_fraction, 10),
            "operating_environment": phase.environment,
            "operating_temperature_c": phase.temperature,
            "operating_fraction": phase.operating_fraction,
            "nonoperating_fraction": phase.nonoperating_fraction,
            "nonoperating_environment": phase.nonoperating_environment,
            "nonoperating_temperature_c": phase.nonoperating_temperature_c,
            "power_cycles_per_1000_nonoperating_hours": (
                phase.power_cycles_per_1000_nonoperating_hours
            ),
            "quantity": quantity,
            "operating_piece_part_failure_rate_fpmh": round(
                operating_piece_rate, 10
            ),
            "operating_total_failure_rate_fpmh": round(
                operating_total_rate, 10
            ),
            "nonoperating_piece_part_failure_rate_fpmh": (
                round(nonoperating_piece_rate, 10)
                if nonoperating_piece_rate is not None
                else None
            ),
            "nonoperating_total_failure_rate_fpmh": (
                round(nonoperating_total_rate, 10)
                if nonoperating_total_rate is not None
                else None
            ),
            "service_failure_rate_fpmh": round(service_rate, 10),
            "mission_weighted_operating_contribution_fpmh": round(
                weighted_operating, 10
            ),
            "mission_weighted_nonoperating_contribution_fpmh": round(
                weighted_nonoperating, 10
            ),
            "mission_weighted_service_contribution_fpmh": round(
                weighted_service, 10
            ),
            "operating_calculation": dict(part.long_form),
            "nonoperating_calculation": nonoperating_calculation,
            "service_calculation": {
                "equation": SERVICE_EQUATION,
                "unit": FPMH,
                "time_basis": "calendar-time phase",
                "operating_fraction": phase.operating_fraction,
                "nonoperating_fraction": phase.nonoperating_fraction,
            },
        })

    mission_service_rate = service_weighted_sum
    mission_mtbf = (
        1.0 / (mission_service_rate * 1e-6)
        if mission_service_rate > 0
        else None
    )
    mission_reliability = math.exp(-cumulative_hazard)

    return {
        "mission_name": profile.name,
        "mission_operating_rate_contribution_fpmh": round(
            operating_contribution, 10
        ),
        "mission_nonoperating_rate_contribution_fpmh": round(
            nonoperating_contribution, 10
        ),
        "mission_service_failure_rate_fpmh": round(mission_service_rate, 10),
        "mission_service_mtbf_hours": (
            round(mission_mtbf, 1) if mission_mtbf is not None else None
        ),
        "mission_reliability": round(mission_reliability, 10),
        "mission_unreliability": round(1.0 - mission_reliability, 10),
        "total_duration_hours": total_time,
        "operating_duration_hours": profile.operating_duration,
        "nonoperating_duration_hours": profile.nonoperating_duration,
        "n_phases": len(profile.phases),
        "phase_results": phase_results,
        "traceability": {
            "operating_model": "MIL-HDBK-217F Notice 2 part-stress prediction",
            "nonoperating_model": RADC_REPORT_EDITION,
            "service_life_equation": SERVICE_EQUATION,
            "rate_unit": FPMH,
            "time_basis": "calendar time",
            "applicability_note": (
                "RADC-TR-85-91 is a related nonoperating extension, not a "
                "chapter of MIL-HDBK-217F Notice 2; its Section 4.5 textual "
                "scope excludes Space, Flight."
            ),
        },
    }


def compute_system_mission_rate(
    profile: MissionProfile,
    parts: Sequence[tuple[Any, Mapping[str, Any]] | tuple[
        Any, Mapping[str, Any], Mapping[str, Any]
    ]],
) -> dict[str, Any]:
    """Calculate a series-system mission prediction.

    Each entry is ``(part_class, operating_params)`` or
    ``(part_class, operating_params, nonoperating_params)``.  The third item
    supplies RADC mapping/model details when automatic exact mapping is not
    possible.
    """
    part_results: list[dict[str, Any]] = []
    system_operating = 0.0
    system_nonoperating = 0.0
    system_service = 0.0

    for index, specification in enumerate(parts):
        if len(specification) == 2:
            part_class, params = specification
            radc_params = None
        elif len(specification) == 3:
            part_class, params, radc_params = specification
        else:
            raise ValueError(
                "each parts entry must contain part_class, operating_params, "
                "and optionally nonoperating_params"
            )
        try:
            result = compute_mission_failure_rate(
                profile,
                part_class,
                params,
                nonoperating_params=radc_params,
            )
        except MissionCalculationError as exc:
            exc.part_index = index
            exc.part_name = str(params.get("name", f"Part {index + 1}"))
            raise
        result["part_index"] = index
        result["part_name"] = str(params.get("name", f"Part {index + 1}"))
        part_results.append(result)
        system_operating += result["mission_operating_rate_contribution_fpmh"]
        system_nonoperating += result[
            "mission_nonoperating_rate_contribution_fpmh"
        ]
        system_service += result["mission_service_failure_rate_fpmh"]

    total_time = profile.total_duration
    system_mtbf = 1.0 / (system_service * 1e-6) if system_service > 0 else None
    system_reliability = math.exp(-system_service * 1e-6 * total_time)

    return {
        "mission_name": profile.name,
        "system_operating_rate_contribution_fpmh": round(system_operating, 10),
        "system_nonoperating_rate_contribution_fpmh": round(
            system_nonoperating, 10
        ),
        "system_service_failure_rate_fpmh": round(system_service, 10),
        "system_service_mtbf_hours": (
            round(system_mtbf, 1) if system_mtbf is not None else None
        ),
        "system_reliability": round(system_reliability, 10),
        "system_unreliability": round(1.0 - system_reliability, 10),
        "total_duration_hours": total_time,
        "n_parts": len(parts),
        "part_results": part_results,
        "traceability": {
            "system_model": "series sum of part service-life rates",
            "service_life_equation": SERVICE_EQUATION,
            "rate_unit": FPMH,
            "time_basis": "calendar time",
        },
    }


def _mixed_phase(
    name: str,
    duration: float,
    environment: str,
    temperature: float,
    operating_fraction: float,
    description: str,
) -> MissionPhase:
    """Build a preset mixed phase with an explicit zero-cycle assumption."""
    return MissionPhase(
        name=name,
        duration=duration,
        environment=environment,
        temperature=temperature,
        operating_fraction=operating_fraction,
        nonoperating_environment=environment,
        nonoperating_temperature_c=temperature,
        power_cycles_per_1000_nonoperating_hours=0.0,
        description=description,
    )


# These profiles are examples, not application-specific qualification.  Mixed
# phases state a zero power-cycle-rate assumption rather than silently
# inventing a cycling rate.  Users should replace it with their actual rate.
STANDARD_PROFILES = {
    "ground_fixed": MissionProfile("Ground Fixed", [
        MissionPhase(
            name="Continuous Operation",
            duration=8760,
            environment="GB",
            temperature=40.0,
            operating_fraction=1.0,
        ),
    ]),
    "ground_mobile": MissionProfile("Ground Mobile", [
        _mixed_phase("Transport", 200, "GM", 50.0, 0.0, "Vehicle transport"),
        _mixed_phase("Setup", 100, "GF", 35.0, 0.5, "System setup and checkout"),
        MissionPhase(
            name="Operation",
            duration=6000,
            environment="GF",
            temperature=40.0,
            operating_fraction=1.0,
            description="Normal operation",
        ),
        _mixed_phase("Standby", 2460, "GF", 25.0, 0.1, "Powered standby"),
    ]),
    "airborne_fighter": MissionProfile("Airborne Fighter", [
        _mixed_phase("Pre-Flight", 0.5, "GF", 30.0, 0.5, "Ground power-up and BIT"),
        MissionPhase(
            name="Takeoff", duration=0.1, environment="AIF", temperature=45.0,
            operating_fraction=1.0, description="Takeoff and climb",
        ),
        _mixed_phase("Cruise", 1.0, "AIF", 35.0, 0.8, "Transit to mission area"),
        MissionPhase(
            name="Combat", duration=0.5, environment="AIF", temperature=55.0,
            operating_fraction=1.0, description="High-performance maneuvering",
        ),
        _mixed_phase("Return", 1.0, "AIF", 35.0, 0.8, "Return transit"),
        MissionPhase(
            name="Landing", duration=0.1, environment="AIF", temperature=40.0,
            operating_fraction=1.0, description="Approach and landing",
        ),
        _mixed_phase("Post-Flight", 0.3, "GF", 35.0, 0.3, "Shutdown and post-flight"),
    ]),
    "naval_surface": MissionProfile("Naval Surface Ship", [
        _mixed_phase("In Port", 2000, "NS", 30.0, 0.3, "Docked, minimal systems"),
        _mixed_phase("Transit", 3000, "NS", 35.0, 0.8, "Underway transit"),
        MissionPhase(
            name="Operations", duration=3000, environment="NS", temperature=40.0,
            operating_fraction=1.0, description="At-sea operations",
        ),
        MissionPhase(
            name="Battle Stations", duration=200, environment="NS", temperature=50.0,
            operating_fraction=1.0, description="Full combat readiness",
        ),
    ]),
    "space_leo": MissionProfile("Space (LEO)", [
        MissionPhase(
            name="Launch", duration=0.25, environment="SF", temperature=60.0,
            operating_fraction=1.0, description="Launch and ascent",
        ),
        MissionPhase(
            name="Orbit Sunlit", duration=4380, environment="SF", temperature=50.0,
            operating_fraction=1.0, description="Sunlit orbital phase",
        ),
        MissionPhase(
            name="Orbit Eclipse", duration=4380, environment="SF", temperature=-20.0,
            operating_fraction=1.0,
            description=(
                "Eclipse orbital phase; represented as operating because "
                "RADC-TR-85-91 excludes SF nonoperating predictions"
            ),
        ),
    ]),
    "automotive": MissionProfile("Automotive", [
        MissionPhase(
            name="Engine Start", duration=50, environment="GM", temperature=25.0,
            operating_fraction=1.0, description="Cold/hot start",
        ),
        _mixed_phase("City Driving", 3000, "GM", 55.0, 0.6, "Urban stop-and-go"),
        _mixed_phase("Highway Driving", 2000, "GM", 65.0, 0.9, "Highway cruising"),
        _mixed_phase("Parked", 3710, "GM", 30.0, 0.0, "Vehicle off, parked"),
    ]),
}


__all__ = [
    "MissionPhase",
    "MissionProfile",
    "MissionCalculationError",
    "compute_mission_failure_rate",
    "compute_system_mission_rate",
    "STANDARD_PROFILES",
]
