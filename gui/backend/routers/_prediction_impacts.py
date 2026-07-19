"""Parameter-to-factor dependency metadata for prediction result highlighting.

The prediction models intentionally expose calculation factors separately from
their constructor inputs.  This module records the semantic bridge explicitly;
the UI must not try to infer it from human-readable labels or equation text.
Candidate factor keys are filtered against each computed result so conditional
branches (for example EEPROM cycling or A/V51.1 manufacturer data) never emit
dangling references.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


FactorCandidates = Mapping[str, Sequence[str]]


_COMMON: dict[str, dict[str, tuple[str, ...]]] = {
    "MIL-HDBK-217F": {
        "quality": ("pi_Q",),
        "environment": ("pi_E",),
    },
    "Telcordia": {
        "quality": ("pi_Q",),
        "environment": ("pi_E",),
        "temperature": ("pi_T",),
    },
    "217Plus": {
        "environment": ("pi_E",),
        "temperature": ("pi_T",),
    },
    "FIDES": {
        "temperature": ("pi_T",),
    },
    "NSWC": {
        "environment": ("C_e", "C_cw"),
    },
    "EPRD-2014": {
        "quality": ("pi_Q",),
        "environment": ("pi_E",),
    },
    "NPRD-2023": {
        "quality": ("pi_Q",),
        "environment": ("pi_E",),
    },
}


# Exact parameter names are the API/form keys.  ``*`` means every factor in
# the current result and is reserved for selectors that change the calculation
# model itself (rather than merely one scalar multiplier).
_MIL: dict[str, dict[str, tuple[str, ...]]] = {
    "microcircuit": {
        "device_type": ("C1", "pi_T", "lambda_cyc"),
        "technology": ("C1", "pi_T", "lambda_cyc"),
        "complexity": ("C1", "lambda_cyc", "A1", "B1", "A2", "B2"),
        "pins": ("C2",),
        "package": ("C2",),
        "T_junction": ("pi_T", "lambda_cyc", "B1", "B2"),
        "years_in_production": ("pi_L",),
        "memory_type": ("C1", "lambda_cyc", "A1", "B1", "A2", "B2"),
        "eeprom_technology": ("lambda_cyc", "A1", "B1", "A2", "B2"),
        "programming_cycles": ("lambda_cyc", "A1", "A2"),
        "ecc": ("lambda_cyc", "pi_ECC"),
        "system_lifetime_hours": ("lambda_cyc", "A1", "A2"),
        "c1_override": ("C1",),
        "manufacturer_rate_fpmh": ("lambda_BMFR", "manufacturer_adjustment_factor"),
        "manufacturer_test_junction_temperature_c": ("pi_TMFR", "manufacturer_adjustment_factor"),
        "manufacturer_test_environment": ("pi_EMFR", "manufacturer_adjustment_factor"),
    },
    "vhsic_microcircuit": {
        "part_type": ("lambda_BD", "pi_PT"),
        "manufacturing_process": ("pi_MFG",),
        "die_area_cm2": ("lambda_BD", "pi_CD"),
        "feature_size_microns": ("lambda_BD",),
        "pins": ("lambda_BP", "pi_PT"),
        "package_type": ("lambda_BP", "pi_PT"),
        "hermetic": ("lambda_BP", "pi_PT"),
        "esd_threshold_volts": ("lambda_EOS",),
        "T_junction": ("pi_T",),
    },
    "gaas_microcircuit": {
        "device_type": ("C1", "pi_T", "pi_A"),
        "active_elements": ("C1",),
        "application": ("pi_A",),
        "pins": ("C2",),
        "package": ("C2",),
        "T_junction": ("pi_T",),
        "years_in_production": ("pi_L",),
    },
    "hybrid_microcircuit": {
        "sum_Ni_lambda_ci": ("sum_Ni_lambda_ci",),
        "function": ("pi_F",),
        "years_in_production": ("pi_L",),
    },
    "saw_device": {"screening": ("pi_Q",)},
    "bubble_memory": {
        "dissipative_elements": ("C11", "lambda_1"),
        "memory_bits": ("C21", "C12", "lambda_1", "lambda_2"),
        "chips_per_package": ("C22", "lambda_2"),
        "data_rate_ratio": ("pi_D", "lambda_2"),
        "reads_per_write": ("pi_W", "lambda_1"),
        "seed_generator": ("pi_W", "lambda_1"),
        "T_junction_1": ("pi_T1", "lambda_1"),
        "T_junction_2": ("pi_T2", "lambda_2"),
        "pins": ("C2",),
        "package": ("C2",),
        "years_in_production": ("pi_L",),
    },
    "diode": {
        "diode_type": ("lambda_b", "pi_T", "pi_S"),
        "T_junction": ("pi_T",),
        "voltage_stress": ("pi_S",),
        "contact": ("pi_C",),
        "junctions": ("lambda_b",),
    },
    "hf_diode": {
        "diode_type": ("lambda_b", "pi_T", "pi_A", "pi_R"),
        "application": ("pi_A",),
        "rated_power": ("pi_R",),
        "frequency_ghz": ("lambda_b", "frequency_ghz"),
        "T_junction": ("pi_T",),
    },
    "bjt": {
        "application": ("lambda_b", "pi_A"),
        "rated_power": ("pi_R",),
        "frequency_mhz": ("pi_R", "frequency_mhz"),
        "voltage_stress": ("pi_S",),
        "T_junction": ("pi_T",),
    },
    "fet": {
        "fet_type": ("lambda_b", "pi_T", "pi_A"),
        "application": ("pi_A",),
        "rated_power": ("pi_A",),
        "frequency_mhz": ("frequency_mhz",),
        "T_junction": ("pi_T",),
    },
    "unijunction": {"T_junction": ("pi_T",)},
    "hf_low_noise_bjt": {
        "rated_power": ("pi_R",),
        "frequency_mhz": ("pi_R", "frequency_mhz"),
        "voltage_stress": ("pi_S",),
        "T_junction": ("pi_T",),
    },
    "hf_power_bjt": {
        "frequency_ghz": ("lambda_b",),
        "rated_power_watts": ("lambda_b", "pi_A"),
        "voltage_stress": ("pi_T",),
        "metallization": ("pi_T",),
        "operation": ("pi_A",),
        "duty_cycle": ("pi_A",),
        "matching": ("pi_M",),
        "T_junction": ("pi_T",),
    },
    "gaas_fet": {
        "frequency_ghz": ("lambda_b",),
        "rated_power_watts": ("lambda_b", "pi_A"),
        "operation": ("pi_A",),
        "matching": ("pi_M",),
        "channel_temperature_c": ("pi_T",),
    },
    "hf_silicon_fet": {
        "fet_type": ("lambda_b", "pi_T"),
        "average_power_watts": ("lambda_b", "average_power_watts"),
        "frequency_mhz": ("lambda_b", "frequency_mhz"),
        "T_junction": ("pi_T",),
    },
    "thyristor": {
        "rated_current": ("pi_R",),
        "voltage_stress": ("pi_S",),
        "T_junction": ("pi_T",),
    },
    "optoelectronic": {
        "device": ("lambda_b", "pi_T"),
        "T_junction": ("pi_T",),
        "detector": ("lambda_b",),
        "channels": ("lambda_b",),
        "display_characters": ("lambda_b",),
        "display_logic_chip": ("lambda_b",),
    },
    "laser_diode": {
        "material": ("lambda_b", "pi_T"),
        "T_junction": ("pi_T",),
        "package": ("pi_Q",),
        "forward_peak_current_amps": ("pi_I",),
        "optical_flux_density_mw_per_cm2": ("pi_A", "optical_flux_density_mw_per_cm2"),
        "operation": ("pi_P",),
        "duty_cycle": ("pi_P",),
        "output_power_ratio": ("pi_P",),
    },
    "electron_tube": {
        "tube_type": ("lambda_b",),
        "years_since_introduction": ("pi_L",),
        "frequency": ("lambda_b",),
        "output_power": ("lambda_b",),
    },
    "traveling_wave_tube": {
        "rated_power_watts": ("lambda_b",),
        "frequency_ghz": ("lambda_b",),
    },
    "magnetron": {
        "operation": ("lambda_b", "pi_U"),
        "frequency_ghz": ("lambda_b",),
        "output_power_mw": ("lambda_b",),
        "rated_power_kw": ("pi_U",),
        "radiate_to_filament_ratio": ("pi_U",),
        "construction": ("pi_C",),
    },
    "gas_laser": {"laser_type": ("lambda_MEDIA", "lambda_COUPLING")},
    "sealed_co2_laser": {
        "tube_current_ma": ("lambda_MEDIA",),
        "co2_overfill_percent": ("pi_O",),
        "ballast_volume_increase_percent": ("pi_B",),
        "active_optical_surfaces": ("pi_OS",),
    },
    "flowing_co2_laser": {
        "average_output_power_kw": ("lambda_COUPLING",),
        "active_optical_surfaces": ("pi_OS",),
    },
    "solid_state_laser": {
        "laser_type": ("lambda_MEDIA",),
        "pump_type": ("lambda_PUMP",),
        "pulses_per_second": ("lambda_PUMP", "lambda_MEDIA"),
        "input_energy_joules": ("lambda_PUMP",),
        "lamp_diameter_mm": ("lambda_PUMP",),
        "lamp_arc_length_inches": ("lambda_PUMP",),
        "pulse_width_microseconds": ("lambda_PUMP",),
        "input_power_kw": ("lambda_PUMP",),
        "energy_density_j_cm2": ("lambda_MEDIA",),
        "cooling": ("pi_COOL", "lambda_PUMP"),
        "cleanliness": ("pi_C",),
        "active_optical_surfaces": ("pi_OS",),
    },
    "resistor": {
        "style": ("lambda_b", "pi_T", "pi_S"),
        "power_stress": ("pi_S",),
        "rated_power": ("pi_P",),
        "case_temperature_c": ("pi_T",),
    },
    "capacitor": {
        "style": ("lambda_b", "pi_T", "pi_C", "pi_V", "pi_SR"),
        "capacitance_microfarads": ("pi_C",),
        "voltage_stress": ("pi_V",),
        "T_ambient": ("pi_T",),
        "circuit_resistance_ohm_per_volt": ("pi_SR",),
    },
    "transformer": {
        "transformer_type": ("lambda_b",),
        "T_hotspot": ("pi_T",),
    },
    "inductor_coil": {
        "adjustment": ("lambda_b",),
        "T_hotspot": ("pi_T",),
    },
    "ferrite_bead": {
        "T_ambient": ("pi_T",),
        "quality_basis": ("pi_Q",),
    },
    "motor": {
        "motor_type": ("A", "B"),
        "T_ambient": ("alpha_B", "alpha_W", "lambda_1", "lambda_2"),
        "life_cycle_hours": ("lambda_1", "lambda_2", "bearing_rate_per_hour", "winding_rate_per_hour"),
        "temperature_profile": ("alpha_B", "alpha_W", "lambda_1", "lambda_2", "thermal_basis"),
    },
    "synchro_resolver": {
        "device_type": ("lambda_b",),
        "frame_temperature": ("lambda_b",),
        "frame_size": ("pi_S",),
        "brushes": ("pi_N",),
    },
    "elapsed_time_meter": {
        "drive_type": ("lambda_b",),
        "operating_to_rated_temperature": ("pi_T",),
    },
    "relay": {
        "rated_temperature": ("pi_L",),
        "T_ambient": ("pi_L",),
        "load_type": ("lambda_b", "pi_L"),
        "load_stress": ("pi_L",),
        "contact_form": ("pi_C",),
        "cycles_per_hour": ("pi_CYC",),
        "configuration": ("pi_F",),
    },
    "ss_relay": {"relay_type": ("lambda_b",)},
    "switch": {
        "switch_type": ("lambda_b",),
        "load_type": ("pi_L",),
        "load_stress": ("pi_L",),
        "rated_by_inductive_load": ("pi_L", "rated_by_inductive_load"),
        "active_contacts": ("pi_C",),
    },
    "circuit_breaker": {
        "breaker_type": ("lambda_b",),
        "poles": ("pi_C",),
        "usage": ("pi_U",),
    },
    "connector": {
        "connector_type": ("lambda_b",),
        "T_ambient": ("T_0", "pi_T"),
        "insert_temperature_rise": ("T_0", "pi_T"),
        "matings_per_1000_hours": ("pi_K",),
        "assembly": ("assembly_factor",),
        "vita_use_standard_defaults": ("lambda_b", "pi_Q"),
    },
    "connector_socket": {
        "socket_type": ("lambda_b",),
        "active_pins": ("pi_P",),
    },
    "pth_assembly": {
        "method": ("*",),
        "technology": ("lambda_b", "pi_C"),
        "automated_pths": ("N1", "pi_C"),
        "hand_soldered_pths": ("N2", "pi_C"),
        "circuit_planes": ("pi_C",),
        "laminate": ("*",),
        "temperature_range_c": ("*",),
        "board_thickness_inches": ("*",),
        "drilled_hole_diameter_inches": ("*",),
        "plating_thickness_inches": ("*",),
        "hours_per_thermal_cycle": ("*",),
        "laminate_elastic_modulus_psi": ("*",),
        "laminate_cte_per_c": ("*",),
        "copper_cte_per_c": ("*",),
        "copper_yield_strength_psi": ("*",),
        "copper_elastic_modulus_psi": ("*",),
        "copper_plastic_modulus_psi": ("*",),
        "copper_ductility": ("*",),
        "copper_ultimate_strength_psi": ("*",),
    },
    "surface_mount_assembly": {
        "distance_to_neutral_point_mils": ("strain", "N_f"),
        "solder_joint_height_mils": ("strain", "N_f"),
        "substrate": ("alpha_S", "strain", "N_f"),
        "package": ("alpha_CC", "pi_LC", "strain", "N_f"),
        "lead_configuration": ("pi_LC", "N_f"),
        "equipment_type": ("CR", "alpha_SMT"),
        "cycling_rate_source": ("CR", "alpha_SMT"),
        "cycling_rate_per_hour": ("CR", "alpha_SMT"),
        "temperature_difference_source": ("delta_T", "N_f"),
        "temperature_difference": ("delta_T", "N_f"),
        "thermal_resistance_c_per_watt": ("T_RISE", "N_f"),
        "power_dissipation_watts": ("T_RISE", "N_f"),
        "design_life_hours": ("ECF", "lambda_SMT_per_hour"),
    },
    "connection": {"connection_type": ("lambda_b",)},
    "meter": {
        "application": ("pi_A",),
        "function": ("pi_F",),
    },
    "crystal": {"frequency_mhz": ("lambda_b",)},
    "oscillator": {"frequency_mhz": ("lambda_b",)},
    "mems_oscillator": {
        "T_ambient": ("T_junction", "pi_T"),
        "temperature_rise_c": ("T_junction", "pi_T"),
        "pins": ("C2",),
        "package": ("C2",),
    },
    "lamp": {
        "rated_voltage": ("lambda_b",),
        "utilization_ratio": ("pi_U",),
        "application": ("pi_A",),
    },
    "filter": {"filter_type": ("lambda_b",)},
    "miscellaneous": {
        "part_type": ("*",),
        "fiber_length_km": ("lambda_b",),
        "attenuator_power_stress": ("pi_S",),
        "attenuator_rated_power_watts": ("pi_P",),
        "attenuator_case_temperature_c": ("pi_T",),
        "attenuator_quality": ("pi_Q",),
    },
    "detailed_cmos": {
        "evaluation_time_hours": ("t_million_hours", "lambda_OX", "lambda_MET", "lambda_HC", "lambda_CON", "lambda_PH", "lambda_MIS"),
        "device_type": ("A_TYPE_OX", "A_TYPE_MET", "lambda_OX", "lambda_MET"),
        "chip_area_cm2": ("A", "lambda_OX", "lambda_MET"),
        "feature_size_microns": ("D_OX", "D_MET", "J_MET", "lambda_OX", "lambda_MET"),
        "T_junction": ("A_T_OX", "A_T_MET", "A_T_HC", "A_T_CON", "A_T_MIS", "lambda_OX", "lambda_MET", "lambda_HC", "lambda_CON", "lambda_MIS"),
        "screening_temperature": ("A_T_OX_screen", "A_T_MET_screen", "A_T_HC_screen", "A_T_CON_screen", "A_T_MIS_screen"),
        "screening_time_hours": ("t0_OX", "t0_MET", "t0_HC", "t0_CON", "t0_MIS"),
        "qml": (
            "QML_OX", "QML_MET", "QML_HC",
            "t50_OX", "t50_MET", "t50_HC",
            "lambda_OX", "lambda_MET", "lambda_HC",
        ),
        "oxide_defect_density": ("D_OX", "lambda_OX"),
        "oxide_field_mv_cm": ("A_V_OX", "t50_OX", "lambda_OX"),
        "sigma_oxide": ("sigma_OX", "lambda_OX"),
        "metal_defect_density": ("D_MET", "lambda_MET"),
        "metal_type": ("metal_multiplier", "lambda_MET"),
        "metal_current_density_million_a_cm2": ("J_MET", "t50_MET", "lambda_MET"),
        "sigma_metal": ("sigma_MET", "lambda_MET"),
        "drain_current_ma": ("I_D_mA", "t50_HC", "lambda_HC"),
        "substrate_current_ma": ("I_SUB_mA", "t50_HC", "lambda_HC"),
        "sigma_hot_carrier": ("sigma_HC", "lambda_HC"),
        "pins": ("pi_PT", "lambda_PAC"),
        "package_type": ("pi_PT", "lambda_PAC"),
        "package_material": ("lambda_PAC",),
        "T_ambient": ("t50_PH", "lambda_PH"),
        "relative_humidity": ("relative_humidity_percent", "RH_eff", "t50_PH", "lambda_PH"),
        "humidity_duty_cycle": ("humidity_duty_cycle", "RH_eff", "t50_PH", "lambda_PH"),
        "esd_threshold_volts": ("lambda_ESD",),
    },
    "parts_count": {
        "part_type": ("*",),
        "environment": ("generic_pi_E",),
        "quality": ("pi_Q", "generic_pi_Q"),
        "years_in_production": ("pi_L",),
        "manufacturer_rate_fpmh": ("lambda_MFR", "manufacturer_adjustment_factor"),
        "manufacturer_reference_environment": ("generic_pi_E", "manufacturer_adjustment_factor"),
    },
    "custom": {
        "model": ("*",),
        "failure_rate": ("lambda",),
        "eta": ("eta",),
        "beta": ("beta",),
        "eval_time": ("eval_time",),
    },
    "generic": {"failure_rate": ("lambda",)},
}


_TELCORDIA: dict[str, dict[str, tuple[str, ...]]] = {
    "ic_digital": {"complexity": ("lambda_b_FIT", "lambda_b")},
    "resistor": {"power_stress": ("pi_S",)},
    "capacitor": {"voltage_stress": ("pi_S",)},
    "relay": {"cycles_per_hour": ("pi_CYC",)},
    "connector": {"pins": ("pins", "lambda_b_FIT", "lambda_b")},
    "pcb": {"layers": ("layers", "lambda_b_FIT", "lambda_b")},
}


_PLUS217: dict[str, dict[str, tuple[str, ...]]] = {
    "microcircuit": {"device_type": ("lambda_base", "pi_T")},
    "discrete_semiconductor": {"device_type": ("lambda_base", "pi_T"), "voltage_stress": ("pi_S",)},
    "resistor": {"power_stress": ("pi_S",)},
    "capacitor": {"voltage_stress": ("pi_S",)},
    "relay": {"cycles_per_hour": ("pi_CYC",)},
    "switch": {"cycles_per_hour": ("pi_CYC",)},
    "connector": {"pins": ("lambda_base",)},
    "pcb": {"layers": ("lambda_base",)},
    "rotating": {"device_type": ("lambda_base", "pi_T")},
}


_FIDES: dict[str, dict[str, tuple[str, ...]]] = {
    "ic": {"complexity": ("C_complexity",)},
    "discrete": {"voltage_stress": ("pi_S",)},
    "passive_resistor": {"power_stress": ("pi_S",)},
    "passive_capacitor": {"voltage_stress": ("pi_S",)},
    "connector": {"pins": ("lambda_base_FIT",)},
    "pcb": {"layers": ("lambda_base_FIT",)},
    "relay": {"cycles_per_hour": ("pi_CYC",)},
    "switch": {"cycles_per_hour": ("pi_CYC",)},
    "crystal": {"frequency_mhz": ("lambda_base_FIT",)},
}


_NSWC: dict[str, dict[str, tuple[str, ...]]] = {
    "spring": {
        "spring_type": ("lambda_base",), "material": ("C_m",),
        "wire_diameter_mm": ("C_w",), "coil_diameter_mm": ("C_w",),
        "max_deflection": ("C_s",), "operating_deflection": ("C_s",),
        "temperature": ("C_t",),
    },
    "bearing": {
        "bearing_type": ("lambda_base",), "load_kN": ("C_v",),
        "rated_load_kN": ("C_v",), "speed_rpm": ("C_v",),
        "rated_speed_rpm": ("C_v",), "lubrication": ("C_v",),
        "contamination": ("C_cr",), "temperature": ("C_t",),
    },
    "gear": {
        "gear_type": ("lambda_base",), "material": ("C_mat",),
        "load_factor": ("C_gp",), "speed_factor": ("C_gs",),
        "alignment_factor": ("C_ga",), "lubrication": ("C_gl",),
        "temperature": ("C_gt",),
    },
    "seal": {
        "seal_type": ("lambda_base",), "material": ("C_q",),
        "pressure_psi": ("C_p",), "fluid": ("C_f",),
        "surface_finish": ("C_v",), "temperature": ("C_t",),
    },
    "valve": {
        "valve_type": ("lambda_base",), "fluid": ("C_f",),
        "pressure_psi": ("C_p",), "cycles_per_hour": ("C_s",),
        "temperature": ("C_t",),
    },
    "actuator": {
        "actuator_type": ("lambda_base", "C_f", "C_cp"),
        "pressure_psi": ("C_cp",), "cycles_per_hour": ("C_cp",),
        "temperature": ("C_t",),
    },
    "pump": {
        "pump_type": ("lambda_base",), "flow_factor": ("C_f",),
        "speed_rpm": ("C_f",), "pressure_psi": ("C_cs",),
        "fluid": ("C_w",), "contamination": ("C_w",),
        "temperature": ("C_t",),
    },
    "filter_mech": {
        "filter_type": ("lambda_base",),
        "differential_pressure_factor": ("C_dp",),
        "fluid_factor": ("C_f",), "temperature": ("C_t",),
    },
    "coupling": {
        "coupling_type": ("lambda_base",), "torque_factor": ("C_t",),
        "speed_rpm": ("C_t",), "alignment_factor": ("C_al",),
        "temperature": ("C_temp",),
    },
    "brake_clutch": {
        "device_type": ("lambda_base",), "cycles_per_hour": ("C_f",),
        "temperature": ("C_t",),
    },
    "electric_motor": {
        "motor_type": ("lambda_base",), "power_hp": ("power_factor",),
        "voltage_stress": ("C_v",), "altitude_ft": ("C_alt",),
        "temperature": ("C_t",),
    },
    "belt_chain": {
        "type": ("lambda_base", "C_t"), "load_factor": ("C_l",),
        "speed_rpm": ("C_l",), "temperature": ("C_t",),
    },
    "hydraulic_line": {
        "line_type": ("lambda_base",), "material": ("C_f",),
        "pressure_psi": ("C_p",), "fluid": ("C_f",),
        "n_bends": ("C_b",), "temperature": ("C_t",),
    },
}


_RIAC_TYPE_FIELDS = {
    "EPRD-2014": {
        "eprd_capacitor": "cap_type", "eprd_resistor": "resistor_type",
        "eprd_inductor": "inductor_type", "eprd_diode": "diode_type",
        "eprd_transistor": "transistor_type", "eprd_microcircuit": "ic_type",
        "eprd_optoelectronic": "opto_type", "eprd_relay": "relay_type",
        "eprd_connector": "connector_type", "eprd_switch": "switch_type",
    },
    "NPRD-2023": {
        "nprd_motor": "motor_type", "nprd_pump": "pump_type",
        "nprd_valve": "valve_type", "nprd_actuator": "actuator_type",
        "nprd_bearing": "bearing_type", "nprd_gear": "gear_type",
        "nprd_fan": "fan_type", "nprd_battery": "battery_type",
        "nprd_filter": "filter_type", "nprd_sensor": "sensor_type",
        "nprd_switch": "switch_type", "nprd_relay": "relay_type",
        "nprd_connector": "connector_type", "nprd_generic": "part_class",
    },
}


_CATALOG: dict[str, dict[str, dict[str, tuple[str, ...]]]] = {
    "MIL-HDBK-217F": _MIL,
    "Telcordia": _TELCORDIA,
    "217Plus": _PLUS217,
    "FIDES": _FIDES,
    "NSWC": _NSWC,
}


def _canonical_symbol(value: str) -> str:
    """Canonicalize factor keys and rendered symbols for exact matching."""
    value = str(value).strip()
    prefixes = (
        ("lambda_", "λ"), ("pi_", "π"), ("alpha_", "α"),
        ("sigma_", "σ"), ("delta_", "Δ"),
    )
    lower = value.lower()
    for prefix, replacement in prefixes:
        if lower.startswith(prefix):
            value = replacement + value[len(prefix):]
            break
    return "".join(character.lower() for character in value if character.isalnum())


def _changed_vita_factors(
    factors: Mapping[str, Any],
    base_factors: Mapping[str, Any] | None,
) -> list[str]:
    if base_factors is None:
        return []
    changed: list[str] = []
    for key, value in factors.items():
        if key not in base_factors or base_factors[key] != value:
            changed.append(key)
    return changed


def build_parameter_impacts(
    standard: str,
    category: str,
    factors: Mapping[str, Any] | None,
    calculation_steps: Sequence[Mapping[str, Any]] | None = None,
    base_factors: Mapping[str, Any] | None = None,
) -> dict[str, dict[str, list[Any]]]:
    """Resolve valid direct-factor and direct/downstream-step references."""
    current_factors = dict(factors or {})
    if not current_factors:
        return {}

    candidates: dict[str, tuple[str, ...]] = dict(_COMMON.get(standard, {}))
    candidates.update(_CATALOG.get(standard, {}).get(category, {}))
    type_field = _RIAC_TYPE_FIELDS.get(standard, {}).get(category)
    if type_field:
        candidates[type_field] = ("lambda_base",)

    vita_changed = _changed_vita_factors(current_factors, base_factors)
    if vita_changed:
        candidates["apply_vita"] = tuple(vita_changed)

    steps = list(calculation_steps or [])
    final_step_index = len(steps) - 1 if steps else None
    step_symbols = [_canonical_symbol(step.get("symbol", "")) for step in steps]
    impacts: dict[str, dict[str, list[Any]]] = {}

    for parameter, requested in candidates.items():
        factor_keys = (
            list(current_factors)
            if "*" in requested
            else [key for key in requested if key in current_factors]
        )
        if not factor_keys:
            continue
        factor_symbols = {_canonical_symbol(key) for key in factor_keys}
        direct_steps = [
            index for index, symbol in enumerate(step_symbols)
            if index != final_step_index and symbol in factor_symbols
        ]
        downstream_steps = (
            [final_step_index]
            if final_step_index is not None and final_step_index not in direct_steps
            else []
        )
        impacts[parameter] = {
            "direct_factor_keys": factor_keys,
            "downstream_factor_keys": [],
            "direct_step_indices": direct_steps,
            "downstream_step_indices": downstream_steps,
        }
    return impacts


__all__ = ["build_parameter_impacts"]
