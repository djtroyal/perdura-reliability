"""Exact, fail-closed mapping from Prediction parts to RADC-TR-85-91.

The operating MIL-HDBK-217F models and the 1985 nonoperating report do not
share a one-to-one taxonomy.  This adapter maps only information that is
semantically explicit.  Missing technology, construction, or quality detail
returns an auditable unavailable result instead of guessing.
"""

from __future__ import annotations

from typing import Any, Mapping

from reliability.RADC_TR_85_91 import (
    REPORT_EDITION,
    UnsupportedRADCModelError,
    predict_nonoperating,
)


_MISSING = object()


# UI/API metadata for the exact automatic mappings implemented below.  Keeping
# this catalog beside the adapter prevents zero-extra-input families (for
# example an RL resistor) from being mislabeled as unsupported by clients.
AUTOMATIC_MODEL_INPUTS: Mapping[str, Mapping[str, Any]] = {
    "microcircuit": {"model": "microelectronic_device", "input_keys": ("technology", "package", "quality")},
    "hybrid_microcircuit": {"model": "hybrid_microcircuit", "input_keys": ("diodes", "transistors", "integrated_circuits", "quality")},
    "bubble_memory": {"model": "magnetic_bubble_memory", "input_keys": ("transfer_gates", "dissipative_control_gates", "major_loops", "functional_minor_loops")},
    **{category: {"model": "discrete_semiconductor", "input_keys": ("part_type", "quality")} for category in (
        "diode", "bjt", "fet", "unijunction", "hf_diode",
        "hf_low_noise_bjt", "hf_power_bjt", "thyristor", "optoelectronic",
    )},
    **{category: {"model": "tube", "input_keys": ()} for category in (
        "electron_tube", "traveling_wave_tube", "magnetron",
    )},
    **{category: {"model": "laser", "input_keys": ()} for category in (
        "gas_laser", "sealed_co2_laser", "flowing_co2_laser", "solid_state_laser",
    )},
    "resistor": {"model": "resistor", "input_keys": ()},
    "capacitor": {"model": "capacitor", "input_keys": ()},
    "transformer": {"model": "inductive_device", "input_keys": ()},
    "inductor_coil": {"model": "inductive_device", "input_keys": ()},
    "motor": {"model": "rotating_device", "input_keys": ()},
    "synchro_resolver": {"model": "rotating_device", "input_keys": ()},
    "elapsed_time_meter": {"model": "rotating_device", "input_keys": ()},
    "relay": {"model": "relay", "input_keys": ("package_type", "contact_voltage_mv", "quality")},
    "switch": {"model": "switch", "input_keys": ("contact_voltage_mv", "quality")},
    "connector": {"model": "connector", "input_keys": ("connector_type",)},
    "pth_assembly": {"model": "pth_assembly", "input_keys": ("technology", "functional_pths")},
    "connection": {"model": "connections", "input_keys": ("connection_counts",)},
    **{category: {"model": "miscellaneous_part", "input_keys": ()} for category in (
        "crystal", "fuse", "meter", "circuit_breaker",
    )},
    "miscellaneous": {"model": "miscellaneous_part", "input_keys": ("part_type", "fiber_length_km", "quality")},
    "lamp": {"model": "miscellaneous_part", "input_keys": ("part_type",)},
}


def _required(values: Mapping[str, Any], key: str, reason: str) -> Any:
    value = values.get(key, _MISSING)
    if value is _MISSING or value is None or value == "":
        raise UnsupportedRADCModelError(
            f"{reason}; provide nonoperating_params.{key} or a documented "
            "nonoperating-rate override"
        )
    return value


def _package(value: Any, overrides: Mapping[str, Any]) -> str:
    if overrides.get("package"):
        return str(overrides["package"])
    package = str(value or "")
    if package.startswith("nonhermetic"):
        return "nonhermetic"
    if package in {
        "hermetic_dip", "hermetic_pga", "hermetic_smt", "glass_dip",
        "flatpack", "can",
    }:
        return "hermetic"
    raise UnsupportedRADCModelError(
        "RADC hermeticity cannot be mapped from the operating package; provide "
        "nonoperating_params.package as 'hermetic' or 'nonhermetic'"
    )


def _mapped_quality(
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


def _context_parameters(model: str, values: dict[str, Any], context: Mapping[str, Any]) -> None:
    """Inject only source-defined exposure variables into an explicit model."""
    environment_models = {
        "microelectronic_device", "hybrid_microcircuit",
        "magnetic_bubble_memory", "discrete_semiconductor", "tube", "laser",
        "resistor", "capacitor", "inductive_device", "relay", "switch",
        "connector", "pth_assembly", "connections", "miscellaneous_part",
    }
    temperature_models = {
        "microelectronic_device", "magnetic_bubble_memory",
        "discrete_semiconductor",
    }
    cycling_models = {
        "microelectronic_device", "discrete_semiconductor", "resistor",
        "capacitor", "inductive_device", "miscellaneous_part",
    }
    if model in environment_models:
        values.setdefault("environment", context["nonoperating_environment"])
    if model in temperature_models:
        values.setdefault("temperature_c", context["nonoperating_temperature_c"])
    if model in cycling_models:
        values.setdefault(
            "power_cycles_per_1000h",
            context["power_cycles_per_1000_nonoperating_hours"],
        )


def _automatic_model(spec: Any, context: Mapping[str, Any]) -> tuple[str, dict[str, Any], str]:
    category = spec.category
    params = dict(spec.params or {})
    extra = dict(spec.nonoperating_params or {})
    environment = context["nonoperating_environment"]
    temperature = context["nonoperating_temperature_c"]
    cycles = context["power_cycles_per_1000_nonoperating_hours"]

    if category == "microcircuit":
        raw_device = str(params.get("device_type", ""))
        if raw_device == "linear":
            device, technology = "linear", extra.get("technology", "linear")
        elif raw_device == "memory":
            device = "memory"
            technology = (
                "ccd" if params.get("memory_type") == "ccd"
                else _required(
                    extra, "technology",
                    "generic MOS/bipolar does not identify the report's memory technology",
                )
            )
        elif raw_device in {"digital", "pla", "microprocessor"}:
            device = "digital"
            technology = _required(
                extra, "technology",
                "generic MOS/bipolar does not identify the report's digital technology",
            )
        else:
            raise UnsupportedRADCModelError(
                f"microcircuit device type {raw_device!r} is outside Sections 5.2.2.1–5.2.2.5"
            )
        quality = _mapped_quality(
            params.get("quality"), {"S": "S", "B": "B", "B-1": "B-1"},
            extra, "microcircuit",
        )
        return "microelectronic_device", {
            "device_type": device,
            "technology": technology,
            "complexity": params.get("complexity"),
            "package": _package(params.get("package"), extra),
            "quality": quality,
            "environment": environment,
            "temperature_c": temperature,
            "power_cycles_per_1000h": cycles,
        }, f"{category} -> RADC {device} microelectronic device"

    if category == "hybrid_microcircuit":
        quality = _mapped_quality(
            params.get("quality"), {"S": "S", "B": "B"}, extra, "hybrid",
        )
        return "hybrid_microcircuit", {
            "diodes": _required(extra, "diodes", "the operating aggregate omits hybrid device counts"),
            "transistors": _required(extra, "transistors", "the operating aggregate omits hybrid device counts"),
            "integrated_circuits": _required(extra, "integrated_circuits", "the operating aggregate omits hybrid device counts"),
            "quality": quality,
            "environment": environment,
        }, "hybrid_microcircuit -> RADC counted-device hybrid"

    if category == "bubble_memory":
        return "magnetic_bubble_memory", {
            "transfer_gates": _required(extra, "transfer_gates", "the operating model omits the RADC gate decomposition"),
            "dissipative_control_gates": _required(extra, "dissipative_control_gates", "the operating model omits the RADC gate decomposition"),
            "major_loops": _required(extra, "major_loops", "the operating model omits the RADC loop decomposition"),
            "functional_minor_loops": _required(extra, "functional_minor_loops", "the operating model omits the RADC loop decomposition"),
            "temperature_c": temperature,
            "environment": environment,
        }, "bubble_memory -> RADC two-structure bubble-memory model"

    discrete_quality = {
        "JANTXV": "JANTXV", "JANTX": "JANTX", "JAN": "JAN",
        "lower": "Lower, Hermetic", "plastic": "Plastic",
    }
    if category in {
        "diode", "bjt", "fet", "unijunction", "hf_diode",
        "hf_low_noise_bjt", "hf_power_bjt", "thyristor", "optoelectronic",
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
            if diode_type in {"impatt", "gunn", "varactor", "pin", "step_recovery", "tunnel"}:
                part_type = diode_type
            elif params.get("application") in {"detector", "mixer"}:
                part_type = f"microwave_{params['application']}"
        elif category == "optoelectronic":
            device = str(params.get("device", ""))
            if device in {"led", "ir_led"}:
                part_type = "led"
            elif device in {"phototransistor", "photodiode"}:
                part_type = device
            elif device == "optical_isolator":
                part_type = "dual_isolator" if params.get("channels") == "dual" else "single_isolator"
            elif device == "alphanumeric_display":
                part_type = "alpha_numeric_display"
        part_type = str(extra.get("part_type") or part_type or "")
        if not part_type:
            raise UnsupportedRADCModelError(
                f"{category} lacks the material/polarity/subtype required by Table 5.2.3-1; "
                "provide nonoperating_params.part_type"
            )
        quality = _mapped_quality(
            params.get("quality"), discrete_quality, extra, "discrete semiconductor",
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
            raw = str(params.get("tube_type", ""))
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
        return "tube", {"tube_type": tube_type, "environment": environment}, f"{category} -> RADC tube {tube_type}"

    if category in {"gas_laser", "sealed_co2_laser", "flowing_co2_laser", "solid_state_laser"}:
        if category == "gas_laser":
            raw = params.get("laser_type")
            laser_type = "argon_ion" if raw == "argon" else raw
            if laser_type not in {"helium_neon", "argon_ion"}:
                raise UnsupportedRADCModelError(
                    f"gas-laser type {raw!r} is not tabulated in Section 5.2.5"
                )
        else:
            laser_type = {
                "sealed_co2_laser": "co2_sealed",
                "flowing_co2_laser": "co2_flowing",
                "solid_state_laser": "solid_state",
            }[category]
        values: dict[str, Any] = {"laser_type": laser_type, "environment": environment}
        if laser_type in {"co2_sealed", "co2_flowing", "solid_state"}:
            values["active_optical_surfaces"] = params.get("active_optical_surfaces")
        return "laser", values, f"{category} -> RADC functional laser {laser_type}"

    if category == "resistor":
        quality = _mapped_quality(
            params.get("quality"), {
                "S": "S", "R": "R", "P": "P", "M": "M",
                "non-ER": "MIL-SPEC", "commercial": "Lower",
            }, extra, "resistor",
        )
        return "resistor", {
            "style": params.get("style"), "quality": quality,
            "environment": environment, "power_cycles_per_1000h": cycles,
        }, "resistor style -> RADC Section 5.2.6"

    if category == "capacitor":
        quality = _mapped_quality(
            params.get("quality"), {
                "S": "S", "R": "R", "P": "P", "M": "M", "L": "L",
                "non-ER": "MIL-SPEC", "commercial": "Lower",
            }, extra, "capacitor",
        )
        return "capacitor", {
            "style": params.get("style"), "quality": quality,
            "environment": environment, "power_cycles_per_1000h": cycles,
        }, "capacitor style -> RADC Section 5.2.7"

    if category in {"transformer", "inductor_coil"}:
        if category == "transformer":
            part_type = {
                "audio": "audio_transformer",
                "low_power_pulse": "low_power_pulse_transformer",
                "high_power_pulse": "high_power_pulse_transformer",
                "rf": "if_rf_discriminator_transformer",
            }.get(str(params.get("transformer_type")), "power_transformer")
            quality_map = {"MIL-SPEC": "MIL-SPEC", "lower": "Lower"}
        else:
            part_type = "rf_coil_fixed_variable"
            quality_map = {
                "S": "S", "R": "R", "P": "P", "M": "M",
                "MIL-SPEC": "MIL-SPEC", "non-ER": "Lower",
            }
        quality = _mapped_quality(params.get("quality"), quality_map, extra, "inductive device")
        return "inductive_device", {
            "part_type": extra.get("part_type", part_type), "quality": quality,
            "environment": environment, "power_cycles_per_1000h": cycles,
        }, f"{category} -> RADC inductive device"

    if category in {"motor", "synchro_resolver", "elapsed_time_meter"}:
        part_type = {
            "motor": "motor", "elapsed_time_meter": "elapsed_time_meter",
            "synchro_resolver": str(params.get("device_type", "synchro")),
        }[category]
        return "rotating_device", {"part_type": part_type}, f"{category} -> RADC rotating-device average"

    if category == "relay":
        quality = _mapped_quality(
            params.get("quality"), {
                "R": "Established Reliability", "P": "Established Reliability",
                "X": "Established Reliability", "U": "Established Reliability",
                "M": "Established Reliability", "L": "Established Reliability",
                "MIL-SPEC": "MIL-SPEC", "commercial": "Lower",
            }, extra, "relay",
        )
        return "relay", {
            "package_type": _required(extra, "package_type", "the operating relay model does not identify hermeticity"),
            "contact_voltage_mv": _required(extra, "contact_voltage_mv", "the operating relay model does not contain contact voltage"),
            "quality": quality, "environment": environment,
        }, "relay -> RADC contact-voltage model"

    if category == "switch":
        quality = _mapped_quality(
            params.get("quality"), {"MIL-SPEC": "MIL-SPEC", "lower": "Lower"},
            extra, "switch",
        )
        return "switch", {
            "contact_voltage_mv": _required(extra, "contact_voltage_mv", "the operating switch model does not contain contact voltage"),
            "quality": quality, "environment": environment,
        }, "switch -> RADC contact-voltage model"

    if category == "connector":
        connector_type = {
            "circular": "circular", "rf_coaxial": "coaxial", "power": "power",
            "rack_panel": "rack_and_panel", "card_edge": "printed_wiring_board",
        }.get(str(params.get("connector_type")))
        connector_type = str(extra.get("connector_type") or connector_type or "")
        if not connector_type:
            raise UnsupportedRADCModelError(
                "the connector construction is not one of the five RADC table types; "
                "provide nonoperating_params.connector_type"
            )
        return "connector", {"connector_type": connector_type, "environment": environment}, f"connector -> RADC {connector_type}"

    if category == "pth_assembly":
        technology = str(params.get("technology"))
        if technology == "discrete_wiring":
            radc_technology = "discrete_wiring_electroless_deposited_pth"
        elif technology == "printed_board":
            planes = int(params.get("circuit_planes", 0))
            radc_technology = (
                "double_sided_soldered_printed_wiring" if planes == 2
                else "multilayer_soldered_printed_wiring" if planes > 2 else ""
            )
        else:
            radc_technology = ""
        radc_technology = str(extra.get("technology") or radc_technology)
        if not radc_technology:
            raise UnsupportedRADCModelError("the PTH technology cannot be mapped to Table 5.2.13-1")
        functional = int(params.get("automated_pths", 0)) + int(params.get("hand_soldered_pths", 0))
        return "pth_assembly", {
            "technology": radc_technology,
            "functional_pths": extra.get("functional_pths", functional),
            "environment": environment,
        }, "PTH assembly -> RADC functional-PTH model"

    if category == "connection":
        connection_type = {
            "hand_solder_no_wrap": "hand_solder",
            "hand_solder_wrapped": "wrapped_and_soldered",
            "crimp": "crimp", "weld": "weld",
            "solderless_wrap": "solderless_wrap",
            "clip_termination": "clip_termination",
            "reflow_solder": "reflow_solder",
        }.get(str(params.get("connection_type")))
        connection_type = str(extra.get("connection_type") or connection_type or "")
        if not connection_type:
            raise UnsupportedRADCModelError("the connection type is not tabulated in Section 5.2.14")
        return "connections", {
            "connection_counts": extra.get(
                "connection_counts", {connection_type: 1}),
            "environment": environment,
        }, f"connection -> RADC {connection_type}"

    miscellaneous = {
        "crystal": "quartz_crystal", "fuse": "fuse", "meter": "meter",
        "circuit_breaker": "circuit_breaker",
    }
    if category in miscellaneous or category == "miscellaneous" or category == "lamp":
        part_type = str(
            extra.get("part_type")
            or miscellaneous.get(category)
            or ""
        )
        if not part_type:
            raise UnsupportedRADCModelError(
                f"{category} requires nonoperating_params.part_type from Table 5.2.15-1"
            )
        values = {"part_type": part_type}
        if part_type == "fiber_optic_cable":
            values["fiber_length_km"] = extra.get("fiber_length_km", 1)
        if part_type == "attenuator":
            values.update({
                "quality": _required(extra, "quality", "attenuator delegates to the RD resistor quality table"),
                "environment": environment,
                "power_cycles_per_1000h": cycles,
            })
        return "miscellaneous_part", values, f"{category} -> RADC miscellaneous {part_type}"

    raise UnsupportedRADCModelError(
        f"Prediction category {category!r} has no exact RADC-TR-85-91 mapping"
    )


def calculate_nonoperating(spec: Any, context: Mapping[str, Any]) -> dict[str, Any]:
    """Return a JSON-ready supported or unavailable nonoperating result."""
    try:
        explicit = dict(spec.nonoperating_params or {})
        model = explicit.pop("model", None)
        if model:
            model = str(model)
            _context_parameters(model, explicit, context)
            parameters = explicit
            mapping = f"explicit RADC model {model}"
        else:
            model, parameters, mapping = _automatic_model(spec, context)
        prediction = predict_nonoperating(model, **parameters)
        result = prediction.long_form
        traceability = dict(result.get("traceability", {}))
        traceability.update({
            "standard": REPORT_EDITION,
            "requested_category": spec.category,
            "model_mapping": mapping,
            "model": prediction.model,
        })
        result.update({
            "status": "supported",
            "source": REPORT_EDITION,
            "traceability": traceability,
        })
        return result
    except (UnsupportedRADCModelError, ValueError, TypeError) as exc:
        return {
            "status": "unavailable",
            "source": REPORT_EDITION,
            "failure_rate": None,
            "model": (spec.nonoperating_params or {}).get("model"),
            "reason": str(exc),
            "factors": {},
            "steps": [],
            "assumptions": [],
            "warnings": [],
            "inputs": dict(spec.nonoperating_params or {}),
            "traceability": {
                "standard": REPORT_EDITION,
                "requested_category": spec.category,
                "support_status": "unavailable",
            },
        }


__all__ = ["AUTOMATIC_MODEL_INPUTS", "calculate_nonoperating"]
