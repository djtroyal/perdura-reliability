"""Structured values for interactive symbols in prediction equations.

Equation values must come from the calculation result and effective model
inputs, never from scraping the human-readable substitution text.  The
frontend uses these bindings to annotate trusted LaTeX before KaTeX renders
it; symbols without an explicit binding remain ordinary mathematics.
"""

from __future__ import annotations

import inspect
import math
import re
from collections.abc import Mapping, Sequence
from numbers import Real
from typing import Any


FPMH = "failures per 10^6 hours"


# Numeric constructor inputs that appear as variables in model equations.
# The mapping is deliberately explicit because a short symbol such as ``S``
# cannot be inferred safely from a parameter label or a substitution string.
_COMMON_INPUT_SYMBOLS: dict[str, tuple[str, ...]] = {
    "T_junction": ("Tj",),
    "T_ambient": ("TA",),
    "T_hotspot": ("THS",),
    "pins": ("Np",),
    "years_in_production": ("Y",),
    "frequency_mhz": ("f",),
    "frequency_ghz": ("F",),
    "rated_power": ("Pr",),
    "rated_power_watts": ("P",),
    "voltage_stress": ("S",),
}

_CATEGORY_INPUT_SYMBOLS: dict[str, dict[str, tuple[str, ...]]] = {
    "microcircuit": {
        "T_junction": ("Tj",), "pins": ("Np",),
        "years_in_production": ("Y",),
    },
    "vhsic_microcircuit": {
        "die_area_cm2": ("A",), "feature_size_microns": ("Xs",),
        "pins": ("Np",), "esd_threshold_volts": ("VTH",),
        "T_junction": ("Tj",),
    },
    "gaas_microcircuit": {
        "pins": ("Np",), "T_junction": ("Tj",),
        "years_in_production": ("Y",),
    },
    "bubble_memory": {
        "data_rate_ratio": ("D",), "reads_per_write": ("R/W",),
        "T_junction_1": ("Tj1",), "T_junction_2": ("Tj2",),
        "pins": ("Np",), "years_in_production": ("Y",),
    },
    "diode": {"T_junction": ("Tj",), "voltage_stress": ("S",)},
    "hf_diode": {
        "rated_power": ("Pr",), "frequency_ghz": ("F",),
        "T_junction": ("Tj",),
    },
    "bjt": {
        "rated_power": ("Pr",), "frequency_mhz": ("f",),
        "voltage_stress": ("S",), "T_junction": ("Tj",),
    },
    "fet": {
        "rated_power": ("Pr",), "frequency_mhz": ("f",),
        "T_junction": ("Tj",),
    },
    "gaas_fet": {
        "frequency_ghz": ("F",), "rated_power_watts": ("P",),
        "channel_temperature_c": ("Tc",),
    },
    "hf_low_noise_bjt": {
        "rated_power": ("Pr",), "frequency_mhz": ("f",),
        "voltage_stress": ("S",), "T_junction": ("Tj",),
    },
    "hf_power_bjt": {
        "frequency_ghz": ("F",), "rated_power_watts": ("P",),
        "voltage_stress": ("S",), "duty_cycle": ("D",),
        "T_junction": ("Tj",),
    },
    "hf_silicon_fet": {
        "average_power_watts": ("P",), "frequency_mhz": ("f",),
        "T_junction": ("Tj",),
    },
    "thyristor": {
        "rated_current": ("Ir",), "voltage_stress": ("S",),
        "T_junction": ("Tj",),
    },
    "optoelectronic": {"T_junction": ("Tj",)},
    "laser_diode": {
        "T_junction": ("Tj",), "forward_peak_current_amps": ("I",),
        "duty_cycle": ("D",), "output_power_ratio": ("Pr/Ps",),
    },
    "electron_tube": {"years_since_introduction": ("T",)},
    "traveling_wave_tube": {
        "rated_power_watts": ("P",), "frequency_ghz": ("F",),
    },
    "magnetron": {
        "frequency_ghz": ("F",), "output_power_mw": ("P",),
        "radiate_to_filament_ratio": ("R",),
    },
    "sealed_co2_laser": {
        "tube_current_ma": ("I",), "co2_overfill_percent": ("O",),
        "ballast_volume_increase_percent": ("B",),
    },
    "flowing_co2_laser": {"average_output_power_kw": ("P",)},
    "resistor": {
        "power_stress": ("S",), "rated_power": ("P_r",),
        "case_temperature_c": ("T",),
    },
    "capacitor": {
        "capacitance_microfarads": ("C",), "voltage_stress": ("S",),
        "T_ambient": ("T_A",),
        "circuit_resistance_ohm_per_volt": ("R/V",),
    },
    "transformer": {"T_hotspot": ("T_HS",)},
    "inductor_coil": {"T_hotspot": ("T_HS",)},
    "ferrite_bead": {"T_ambient": ("T_A",)},
    "motor": {"T_ambient": ("T_A",), "life_cycle_hours": ("LC",)},
    "synchro_resolver": {"frame_temperature": ("T_F",)},
    "relay": {
        "T_ambient": ("T_A",), "load_stress": ("S",),
        "cycles_per_hour": ("C",),
    },
    "switch": {"load_stress": ("S",), "active_contacts": ("N",)},
    "connector": {
        "T_ambient": ("T_A",), "insert_temperature_rise": ("ΔT",),
        "matings_per_1000_hours": ("K",),
    },
    "connector_socket": {"active_pins": ("N",)},
    "pth_assembly": {
        "automated_pths": ("N1",), "hand_soldered_pths": ("N2",),
        "circuit_planes": ("P",),
    },
    "surface_mount_assembly": {
        "distance_to_neutral_point_mils": ("d",),
        "solder_joint_height_mils": ("h",),
        "cycling_rate_per_hour": ("CR",),
        "temperature_difference": ("ΔT",),
        "design_life_hours": ("LC",),
    },
    "crystal": {"frequency_mhz": ("f",)},
    "oscillator": {"frequency_mhz": ("f",)},
    "mems_oscillator": {
        "T_ambient": ("TA",), "temperature_rise_c": ("ΔT",),
        "pins": ("Np",),
    },
    "lamp": {"rated_voltage": ("Vr",)},
    "detailed_cmos": {
        "evaluation_time_hours": ("t",), "chip_area_cm2": ("A",),
        "feature_size_microns": ("Xs",), "T_junction": ("TJ",),
        "screening_time_hours": ("tscreen",),
        "oxide_field_mv_cm": ("EOX",),
        "metal_current_density_million_a_cm2": ("J",),
        "pins": ("Np",), "esd_threshold_volts": ("VTH",),
    },
    "parts_count": {"years_in_production": ("Y",)},
    "custom": {
        "failure_rate": ("lambda_p",), "eta": ("eta",),
        "beta": ("beta",), "eval_time": ("t",),
    },
    "generic": {"failure_rate": ("lambda_p",)},
}


_SPECIAL_FACTOR_SYMBOLS = {
    "sum_Ni_lambda_ci": "ΣNcλc",
    "T_0": "T0",
    "N_f": "Nf",
    "alpha_SMT": "αSMT",
    "delta_T": "ΔT",
    "lambda_SMT_per_hour": "λSMT",
    "t_million_hours": "t",
    "I_D_mA": "ID",
    "I_SUB_mA": "ISUB",
}

_SPECIAL_FACTOR_UNITS = {
    "T_0": "°C",
    "T_junction": "°C",
    "T_RISE": "°C",
    "delta_T": "°C",
    "CR": "cycles/hour",
    "frequency_mhz": "MHz",
    "frequency_ghz": "GHz",
    "average_power_watts": "W",
    "optical_flux_density_mw_per_cm2": "mW/cm²",
    "bearing_rate_per_hour": "failures/hour",
    "winding_rate_per_hour": "failures/hour",
}


def effective_model_inputs(model_class: type, kwargs: Mapping[str, Any]) -> dict[str, Any]:
    """Return constructor values after applying the model's declared defaults."""
    signature = inspect.signature(model_class)
    bound = signature.bind_partial(**kwargs)
    bound.apply_defaults()
    return {
        name: value for name, value in bound.arguments.items()
        if name not in {"name", "quantity", "multiplier", "standard"}
    }


def _humanize(value: str) -> str:
    value = re.sub(r"_(c|ma|mw|kw|mhz|ghz|cm2|mm|hours?|watts?|volts?)$", "", value, flags=re.I)
    return value.replace("_", " ").strip().capitalize()


def _input_unit(name: str) -> str:
    lower = name.lower()
    if lower.startswith("t_") or "temperature" in lower:
        return "°C"
    for suffix, unit in (
        ("_microfarads", "µF"), ("_ohm_per_volt", "Ω/V"),
        ("_million_a_cm2", "10^6 A/cm²"), ("_mw_per_cm2", "mW/cm²"),
        ("_cm2", "cm²"), ("_ghz", "GHz"), ("_mhz", "MHz"),
        ("_kw", "kW"), ("_watts", "W"), ("_volts", "V"),
        ("_amps", "A"), ("_ma", "mA"), ("_hours", "hours"),
        ("_years", "years"), ("_percent", "%"), ("_mils", "mils"),
        ("_microns", "µm"), ("_joules", "J"),
    ):
        if lower.endswith(suffix):
            return unit
    return "dimensionless"


def _factor_symbol(key: str) -> str:
    if key in _SPECIAL_FACTOR_SYMBOLS:
        return _SPECIAL_FACTOR_SYMBOLS[key]
    if key.startswith("lambda_"):
        return "λ" + key.removeprefix("lambda_")
    if key.startswith("pi_"):
        return "π" + key.removeprefix("pi_")
    if key.startswith("alpha_"):
        return "α" + key.removeprefix("alpha_")
    if key.startswith("sigma_"):
        return "σ" + key.removeprefix("sigma_")
    return key.replace("_", "")


def _canonical(symbol: str) -> str:
    return re.sub(
        r"[^a-z0-9]", "",
        symbol.replace("λ", "lambda").replace("π", "pi")
        .replace("α", "alpha").replace("σ", "sigma")
        .replace("Δ", "delta").replace("Σ", "sum").lower(),
    )


def _latex_aliases(symbol: str) -> tuple[str, ...]:
    """Return conservative LaTeX spellings used by model-authored equations."""
    match = re.fullmatch(r"([λπασ])([A-Za-z0-9]+)(.*)", symbol)
    aliases: list[str] = []
    if match:
        command = {
            "λ": r"\lambda", "π": r"\pi", "α": r"\alpha", "σ": r"\sigma",
        }[match.group(1)]
        suffix, tail = match.group(2), match.group(3)
        aliases.extend((f"{command}_{suffix}{tail}", f"{command}_{{{suffix}}}{tail}"))
        if len(suffix) > 1:
            aliases.append(f"{command}_{{\\mathrm{{{suffix}}}}}{tail}")
    elif symbol == "ΣNcλc":
        aliases.extend((r"\sum_iN_i\lambda_{ci}", r"\Sigma N_c\lambda_c"))
    else:
        aliases.append(symbol)
        digit = re.fullmatch(r"([A-Za-z]+)([0-9]+)", symbol)
        if digit:
            aliases.extend((f"{digit.group(1)}_{digit.group(2)}", f"{digit.group(1)}_{{{digit.group(2)}}}"))
    return tuple(dict.fromkeys((symbol, *aliases)))


def _contains_symbol(expression: str, symbol: str) -> bool:
    compact = expression.replace(" ", "")
    for token in _latex_aliases(symbol):
        token = token.replace(" ", "")
        start = 0
        while True:
            index = compact.find(token, start)
            if index < 0:
                break
            before = compact[index - 1] if index else ""
            after_index = index + len(token)
            after = compact[after_index] if after_index < len(compact) else ""
            command_token = token.startswith(("λ", "π", "α", "σ", "Δ", "Σ", "\\"))
            before_continues_name = not command_token and (before.isalpha() or before == "_")
            after_continues_name = (after.isascii() and after.isalpha()) or after == "_"
            if not before_continues_name and not after_continues_name:
                return True
            start = index + 1
    return False


def _numeric_binding(
    *, binding_id: str, symbol: str, value: Any, unit: str,
    label: str, source: str, factor_key: str | None = None,
) -> dict[str, Any] | None:
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    numeric = float(value)
    available = math.isfinite(numeric)
    binding: dict[str, Any] = {
        "id": re.sub(r"[^A-Za-z0-9_-]", "-", binding_id),
        "symbol": symbol,
        "value": numeric if available else None,
        "available": available,
        "unit": unit,
        "label": label,
        "source": source,
    }
    if factor_key is not None:
        binding["factor_key"] = factor_key
    return binding


def _result_symbol(row: Mapping[str, Any], steps: Sequence[Mapping[str, Any]]) -> str:
    equation = str(row.get("traceability", {}).get("equation", ""))
    if equation:
        final_equation = equation.split(";")[-1]
        if "=" in final_equation:
            return final_equation.split("=", 1)[0].strip()
    if steps:
        return str(steps[-1].get("symbol", "λp"))
    return "λp"


def add_equation_symbol_bindings(
    row: dict[str, Any], *, category: str,
    effective_inputs: Mapping[str, Any] | None = None,
) -> None:
    """Attach equation-local symbol/value metadata to a prediction row."""
    steps: list[dict[str, Any]] = row.get("calculation_steps") or []
    factors = row.get("pi_factors") or {}

    step_by_canonical = {
        _canonical(str(step.get("symbol", ""))): step for step in steps
    }
    candidates: list[dict[str, Any]] = []

    for key, value in factors.items():
        symbol = _factor_symbol(str(key))
        step = step_by_canonical.get(_canonical(symbol))
        unit = str(step.get("unit", "dimensionless")) if step else _SPECIAL_FACTOR_UNITS.get(
            str(key),
            FPMH if str(key).startswith("lambda_") or str(key) in {"C1", "C2"}
            else "dimensionless",
        )
        label = str(step.get("description")) if step else _humanize(str(key))
        binding = _numeric_binding(
            binding_id=f"factor-{key}", symbol=symbol, value=value,
            unit=unit, label=label, source="factor", factor_key=str(key),
        )
        if binding:
            candidates.append(binding)

    factor_by_canonical = {
        _canonical(binding["symbol"]): binding for binding in candidates
        if binding["source"] == "factor"
    }
    last_index = len(steps) - 1
    for index, step in enumerate(steps):
        symbol = str(step.get("symbol", ""))
        if _canonical(symbol) in factor_by_canonical:
            continue
        binding = _numeric_binding(
            binding_id=f"step-{index}-{symbol}", symbol=symbol,
            value=step.get("value"), unit=str(step.get("unit", "dimensionless")),
            label=str(step.get("description", "Calculated value")),
            source="result" if index == last_index else "intermediate",
        )
        if binding:
            candidates.append(binding)

    result_symbol = _result_symbol(row, steps)
    result_binding = _numeric_binding(
        binding_id="result-failure-rate", symbol=result_symbol,
        value=row.get("failure_rate"), unit=FPMH,
        label="Predicted part failure rate", source="result",
    )
    if result_binding:
        candidates = [
            binding for binding in candidates
            if _canonical(binding["symbol"]) != _canonical(result_symbol)
        ]
        candidates.append(result_binding)

    input_specs = dict(_COMMON_INPUT_SYMBOLS)
    input_specs.update(_CATEGORY_INPUT_SYMBOLS.get(category, {}))
    for name, value in (effective_inputs or {}).items():
        for symbol_index, symbol in enumerate(input_specs.get(name, ())):
            binding = _numeric_binding(
                binding_id=f"input-{name}-{symbol_index}", symbol=symbol,
                value=value, unit=_input_unit(name), label=_humanize(name),
                source="input",
            )
            if binding:
                candidates.append(binding)

    # Prefer result, factor, and intermediate values over an input alias when
    # two sources intentionally use the same displayed symbol.
    priority = {"result": 0, "factor": 1, "intermediate": 2, "input": 3}
    candidates.sort(key=lambda item: priority[item["source"]])
    unique_candidates: list[dict[str, Any]] = []
    seen_symbols: set[str] = set()
    for binding in candidates:
        canonical = _canonical(binding["symbol"])
        if canonical and canonical not in seen_symbols:
            seen_symbols.add(canonical)
            unique_candidates.append(binding)

    trace = row.get("traceability") or {}
    trace_expression = str(trace.get("equation", ""))
    if trace_expression:
        selected = [
            binding for binding in unique_candidates
            if _contains_symbol(trace_expression, binding["symbol"])
        ]
        if result_binding and all(binding["id"] != result_binding["id"] for binding in selected):
            selected.insert(0, result_binding)
        trace["symbol_bindings"] = selected

    for index, step in enumerate(steps):
        expression = str(step.get("expression_latex") or step.get("expression") or "")
        selected = [
            binding for binding in unique_candidates
            if _contains_symbol(expression, binding["symbol"])
        ]
        own_symbol = str(step.get("symbol", ""))
        own = next(
            (binding for binding in unique_candidates
             if _canonical(binding["symbol"]) == _canonical(own_symbol)),
            None,
        )
        if own and all(binding["id"] != own["id"] for binding in selected):
            selected.insert(0, own)
        step["symbol_bindings"] = selected
