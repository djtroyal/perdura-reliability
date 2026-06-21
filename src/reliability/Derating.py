"""Derating analysis for electronic components.

Derating means operating components below their maximum rated values to
improve reliability.  Multiple derating standards are supported:

- **MIL-STD-975** (default): US military / NASA derating guidelines.
- **NAVSEA TE000-AB-GTP-010**: US Navy derating standard (tighter on
  temperature and voltage for naval/submarine applications).
- **ESA/ECSS-Q-ST-30-11C**: European Space Agency derating standard for
  space-grade components.
- **Custom**: User-defined derating rules with arbitrary limits.

Three derating levels are defined per standard:
- **Level I** (best practice): tightest limits, used in high-reliability
  space and missile programs.
- **Level II** (standard): standard derating for most military/aerospace
  applications.
- **Level III** (minimum acceptable): minimum derating for benign
  ground environments and cost-constrained designs.

Usage
-----
>>> from reliability.Derating import analyze_derating
>>> results = analyze_derating('capacitor', {
...     'voltage_stress': 0.45,
...     'temperature': 80,
... })
>>> for r in results:
...     print(r.parameter, r.stress_ratio, r.status, r.derating_level)
"""

from dataclasses import dataclass
from copy import deepcopy


# ===================================================================
# Derating rules by part category
# ===================================================================

DERATING_RULES = {
    'resistor': [
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.80},
        {'param': 'voltage_stress', 'desc': 'Applied Voltage', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.70, 'level_III': 0.80},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 85, 'level_II': 100, 'level_III': 125,
         'rated': 125},
    ],
    'capacitor': [
        {'param': 'voltage_stress', 'desc': 'Voltage Stress', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 85, 'level_II': 100, 'level_III': 125, 'rated': 125},
        {'param': 'ripple_current', 'desc': 'Ripple Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
    ],
    'diode': [
        {'param': 'voltage_stress', 'desc': 'Reverse Voltage', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.70, 'level_III': 0.80},
        {'param': 'current_stress', 'desc': 'Forward Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 110, 'level_II': 125, 'level_III': 150, 'rated': 175},
    ],
    'bjt': [
        {'param': 'voltage_stress', 'desc': 'Collector-Emitter Voltage', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.70, 'level_III': 0.80},
        {'param': 'current_stress', 'desc': 'Collector Current', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.70, 'level_III': 0.80},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 110, 'level_II': 125, 'level_III': 150, 'rated': 200},
    ],
    'fet': [
        {'param': 'voltage_stress', 'desc': 'Drain-Source Voltage', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.70, 'level_III': 0.80},
        {'param': 'current_stress', 'desc': 'Drain Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 110, 'level_II': 125, 'level_III': 150, 'rated': 175},
    ],
    'microcircuit': [
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 85, 'level_II': 100, 'level_III': 125, 'rated': 150},
        {'param': 'supply_voltage', 'desc': 'Supply Voltage Tolerance', 'unit': 'ratio',
         'level_I': 0.90, 'level_II': 0.95, 'level_III': 1.00},
        {'param': 'fanout', 'desc': 'Fan-Out Loading', 'unit': 'ratio',
         'level_I': 0.70, 'level_II': 0.80, 'level_III': 0.90},
    ],
    'thyristor': [
        {'param': 'voltage_stress', 'desc': 'Off-State Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'current_stress', 'desc': 'On-State Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 100, 'level_II': 110, 'level_III': 125, 'rated': 150},
    ],
    'relay': [
        {'param': 'contact_current', 'desc': 'Contact Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'contact_voltage', 'desc': 'Contact Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'coil_voltage', 'desc': 'Coil Voltage', 'unit': 'ratio',
         'level_I': 0.85, 'level_II': 0.90, 'level_III': 1.00},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 55, 'level_II': 70, 'level_III': 85, 'rated': 85},
    ],
    'switch': [
        {'param': 'current_stress', 'desc': 'Current Rating', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'voltage_stress', 'desc': 'Voltage Rating', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
    ],
    'connector': [
        {'param': 'current_per_pin', 'desc': 'Current Per Pin', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'voltage_stress', 'desc': 'Voltage Stress', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.80},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 85, 'level_II': 100, 'level_III': 125, 'rated': 125},
    ],
    'inductive': [
        {'param': 'current_stress', 'desc': 'Operating Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'voltage_stress', 'desc': 'Insulation Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.80},
        {'param': 'temperature', 'desc': 'Hotspot Temperature', 'unit': '°C',
         'level_I': 90, 'level_II': 105, 'level_III': 130, 'rated': 155},
    ],
    'optoelectronic': [
        {'param': 'current_stress', 'desc': 'Forward Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
    ],
    'rotating': [
        {'param': 'load_stress', 'desc': 'Mechanical Load', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.75, 'level_III': 0.90},
        {'param': 'temperature', 'desc': 'Winding Temperature', 'unit': '°C',
         'level_I': 85, 'level_II': 105, 'level_III': 130, 'rated': 155},
    ],
}


# ===================================================================
# NAVSEA TE000-AB-GTP-010 — tighter limits for naval applications
# ===================================================================

NAVSEA_RULES = {
    'resistor': [
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.70},
        {'param': 'voltage_stress', 'desc': 'Applied Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 105, 'rated': 125},
    ],
    'capacitor': [
        {'param': 'voltage_stress', 'desc': 'Voltage Stress', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 105, 'rated': 125},
        {'param': 'ripple_current', 'desc': 'Ripple Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
    ],
    'diode': [
        {'param': 'voltage_stress', 'desc': 'Reverse Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'current_stress', 'desc': 'Forward Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 100, 'level_II': 110, 'level_III': 135, 'rated': 175},
    ],
    'bjt': [
        {'param': 'voltage_stress', 'desc': 'Collector-Emitter Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'current_stress', 'desc': 'Collector Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 100, 'level_II': 110, 'level_III': 135, 'rated': 200},
    ],
    'fet': [
        {'param': 'voltage_stress', 'desc': 'Drain-Source Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'current_stress', 'desc': 'Drain Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 100, 'level_II': 110, 'level_III': 135, 'rated': 175},
    ],
    'microcircuit': [
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 110, 'rated': 150},
        {'param': 'supply_voltage', 'desc': 'Supply Voltage Tolerance', 'unit': 'ratio',
         'level_I': 0.85, 'level_II': 0.90, 'level_III': 0.95},
        {'param': 'fanout', 'desc': 'Fan-Out Loading', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.70, 'level_III': 0.80},
    ],
    'thyristor': [
        {'param': 'voltage_stress', 'desc': 'Off-State Voltage', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'current_stress', 'desc': 'On-State Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 90, 'level_II': 100, 'level_III': 115, 'rated': 150},
    ],
    'relay': [
        {'param': 'contact_current', 'desc': 'Contact Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'contact_voltage', 'desc': 'Contact Voltage', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'coil_voltage', 'desc': 'Coil Voltage', 'unit': 'ratio',
         'level_I': 0.80, 'level_II': 0.85, 'level_III': 0.95},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 50, 'level_II': 60, 'level_III': 75, 'rated': 85},
    ],
    'switch': [
        {'param': 'current_stress', 'desc': 'Current Rating', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'voltage_stress', 'desc': 'Voltage Rating', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
    ],
    'connector': [
        {'param': 'current_per_pin', 'desc': 'Current Per Pin', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'voltage_stress', 'desc': 'Voltage Stress', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.70},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 105, 'rated': 125},
    ],
    'inductive': [
        {'param': 'current_stress', 'desc': 'Operating Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'voltage_stress', 'desc': 'Insulation Voltage', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.70},
        {'param': 'temperature', 'desc': 'Hotspot Temperature', 'unit': '°C',
         'level_I': 80, 'level_II': 95, 'level_III': 120, 'rated': 155},
    ],
    'optoelectronic': [
        {'param': 'current_stress', 'desc': 'Forward Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.65},
    ],
    'rotating': [
        {'param': 'load_stress', 'desc': 'Mechanical Load', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.65, 'level_III': 0.80},
        {'param': 'temperature', 'desc': 'Winding Temperature', 'unit': '°C',
         'level_I': 75, 'level_II': 90, 'level_III': 115, 'rated': 155},
    ],
}

# ===================================================================
# ESA/ECSS-Q-ST-30-11C — European Space Agency derating for space
# ===================================================================

ECSS_RULES = {
    'resistor': [
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'voltage_stress', 'desc': 'Applied Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 100, 'rated': 125},
    ],
    'capacitor': [
        {'param': 'voltage_stress', 'desc': 'Voltage Stress', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 100, 'rated': 125},
        {'param': 'ripple_current', 'desc': 'Ripple Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
    ],
    'diode': [
        {'param': 'voltage_stress', 'desc': 'Reverse Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'current_stress', 'desc': 'Forward Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 90, 'level_II': 100, 'level_III': 120, 'rated': 175},
    ],
    'bjt': [
        {'param': 'voltage_stress', 'desc': 'Collector-Emitter Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'current_stress', 'desc': 'Collector Current', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 90, 'level_II': 100, 'level_III': 125, 'rated': 200},
    ],
    'fet': [
        {'param': 'voltage_stress', 'desc': 'Drain-Source Voltage', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.70},
        {'param': 'current_stress', 'desc': 'Drain Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 90, 'level_II': 100, 'level_III': 125, 'rated': 175},
    ],
    'microcircuit': [
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 100, 'rated': 150},
        {'param': 'supply_voltage', 'desc': 'Supply Voltage Tolerance', 'unit': 'ratio',
         'level_I': 0.85, 'level_II': 0.90, 'level_III': 0.95},
        {'param': 'fanout', 'desc': 'Fan-Out Loading', 'unit': 'ratio',
         'level_I': 0.60, 'level_II': 0.70, 'level_III': 0.80},
    ],
    'thyristor': [
        {'param': 'voltage_stress', 'desc': 'Off-State Voltage', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'current_stress', 'desc': 'On-State Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'junction_temp', 'desc': 'Junction Temperature', 'unit': '°C',
         'level_I': 80, 'level_II': 90, 'level_III': 110, 'rated': 150},
    ],
    'relay': [
        {'param': 'contact_current', 'desc': 'Contact Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'contact_voltage', 'desc': 'Contact Voltage', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'coil_voltage', 'desc': 'Coil Voltage', 'unit': 'ratio',
         'level_I': 0.80, 'level_II': 0.85, 'level_III': 0.90},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 50, 'level_II': 60, 'level_III': 70, 'rated': 85},
    ],
    'switch': [
        {'param': 'current_stress', 'desc': 'Current Rating', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'voltage_stress', 'desc': 'Voltage Rating', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
    ],
    'connector': [
        {'param': 'current_per_pin', 'desc': 'Current Per Pin', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'voltage_stress', 'desc': 'Voltage Stress', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'temperature', 'desc': 'Ambient Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 100, 'rated': 125},
    ],
    'inductive': [
        {'param': 'current_stress', 'desc': 'Operating Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'voltage_stress', 'desc': 'Insulation Voltage', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'temperature', 'desc': 'Hotspot Temperature', 'unit': '°C',
         'level_I': 75, 'level_II': 90, 'level_III': 110, 'rated': 155},
    ],
    'optoelectronic': [
        {'param': 'current_stress', 'desc': 'Forward Current', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
        {'param': 'power_stress', 'desc': 'Power Dissipation', 'unit': 'ratio',
         'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
    ],
    'rotating': [
        {'param': 'load_stress', 'desc': 'Mechanical Load', 'unit': 'ratio',
         'level_I': 0.50, 'level_II': 0.60, 'level_III': 0.75},
        {'param': 'temperature', 'desc': 'Winding Temperature', 'unit': '°C',
         'level_I': 70, 'level_II': 85, 'level_III': 110, 'rated': 155},
    ],
}

# ===================================================================
# All standards registry
# ===================================================================

DERATING_STANDARDS = {
    'MIL-STD-975': {
        'name': 'MIL-STD-975 / NASA',
        'description': 'US Military and NASA derating guidelines',
        'rules': DERATING_RULES,
    },
    'NAVSEA': {
        'name': 'NAVSEA TE000-AB-GTP-010',
        'description': 'US Navy derating standard for naval/submarine applications',
        'rules': NAVSEA_RULES,
    },
    'ECSS': {
        'name': 'ESA/ECSS-Q-ST-30-11C',
        'description': 'European Space Agency derating for space-grade components',
        'rules': ECSS_RULES,
    },
}


def get_rules_for_standard(standard: str) -> dict:
    """Return the rules dict for a given standard name."""
    if standard in DERATING_STANDARDS:
        return DERATING_STANDARDS[standard]['rules']
    raise ValueError(
        f"Unknown derating standard '{standard}'. "
        f"Valid: {sorted(DERATING_STANDARDS.keys())}")


def list_standards() -> list:
    """Return info about all available derating standards."""
    return [
        {'key': k, 'name': v['name'], 'description': v['description']}
        for k, v in DERATING_STANDARDS.items()
    ]


def make_custom_rules(overrides: dict) -> dict:
    """Create a custom rule set from user-defined overrides.

    Parameters
    ----------
    overrides : dict
        Maps category -> list of rule dicts, each with keys:
        param, desc, unit ('ratio' or '°C'), level_I, level_II, level_III,
        and optionally 'rated' for temperature parameters.

    Returns
    -------
    dict
        A rule-set dict usable as the ``custom_rules`` argument to
        ``analyze_derating``.
    """
    rules = {}
    for cat, cat_rules in overrides.items():
        validated = []
        for r in cat_rules:
            entry = {
                'param': str(r['param']),
                'desc': str(r.get('desc', r['param'])),
                'unit': str(r.get('unit', 'ratio')),
                'level_I': float(r['level_I']),
                'level_II': float(r['level_II']),
                'level_III': float(r['level_III']),
            }
            if 'rated' in r:
                entry['rated'] = float(r['rated'])
            validated.append(entry)
        rules[cat.lower()] = validated
    return rules


# ===================================================================
# Category aliases
# ===================================================================

CATEGORY_ALIASES = {
    'hf_diode': 'diode',
    'gaas_fet': 'fet',
    'hybrid_microcircuit': 'microcircuit',
    'unijunction': 'bjt',
    'ss_relay': 'relay',
    'circuit_breaker': 'switch',
    'laser': 'optoelectronic',
}


def _resolve_category(category: str) -> str:
    """Resolve a category name, following aliases."""
    cat = category.lower()
    return CATEGORY_ALIASES.get(cat, cat)


# ===================================================================
# DeratingResult
# ===================================================================

@dataclass
class DeratingResult:
    """Result of a derating check for a single parameter."""

    parameter: str
    actual_value: float
    rated_value: float
    stress_ratio: float
    level_I_limit: float
    level_II_limit: float
    level_III_limit: float
    status: str          # 'ok' | 'warning' | 'exceeds'
    derating_level: str  # 'I' | 'II' | 'III' | 'exceeded'

    def __repr__(self):
        return (f"DeratingResult({self.parameter}: ratio={self.stress_ratio:.3f}, "
                f"status={self.status!r}, level={self.derating_level!r})")


# ===================================================================
# Analysis function
# ===================================================================

def analyze_derating(category: str, params: dict, *,
                     standard: str = 'MIL-STD-975',
                     custom_rules: dict | None = None) -> list:
    """Analyze derating for a component against standard rules.

    Parameters
    ----------
    category : str
        Part category (e.g. 'resistor', 'capacitor', 'diode', 'bjt',
        'fet', 'microcircuit', etc.).  Aliases like 'hf_diode' and
        'laser' are accepted.
    params : dict
        Component operating parameters.  For ratio-based parameters
        (voltage_stress, power_stress, current_stress, etc.) the value
        must be a dimensionless stress ratio between 0 and 1.  For
        temperature parameters (unit = '°C') the value is an absolute
        temperature in degrees Celsius.
    standard : str
        Derating standard to use: 'MIL-STD-975', 'NAVSEA', or 'ECSS'.
        Ignored when *custom_rules* is provided.
    custom_rules : dict or None
        A custom rule-set dict (as returned by ``make_custom_rules``).
        When provided, *standard* is ignored and these rules are used
        instead.

    Returns
    -------
    list[DeratingResult]
        One entry per applicable rule whose parameter appears in *params*.

    Raises
    ------
    ValueError
        If *category* (after alias resolution) is not in the rule set.

    Examples
    --------
    >>> results = analyze_derating('capacitor', {
    ...     'voltage_stress': 0.45,
    ...     'temperature': 80,
    ... })
    >>> results[0].status
    'ok'
    """
    if custom_rules is not None:
        rulebook = custom_rules
    else:
        rulebook = get_rules_for_standard(standard)

    resolved = _resolve_category(category)
    if resolved not in rulebook:
        raise ValueError(
            f"Unknown derating category '{category}' "
            f"(resolved to '{resolved}'). "
            f"Valid categories: {sorted(rulebook.keys())}"
        )

    rules = rulebook[resolved]
    results = []

    for rule in rules:
        param_name = rule['param']
        if param_name not in params:
            continue

        actual = float(params[param_name])

        if rule['unit'] == '°C':
            # Absolute temperature comparison
            rated = float(rule.get('rated', rule['level_III']))
            # Compute stress ratio as fraction of rated temperature
            if rated != 0:
                stress_ratio = actual / rated
            else:
                stress_ratio = 0.0
            # For temperature, compare actual value against absolute limits
            lim_I = rule['level_I']
            lim_II = rule['level_II']
            lim_III = rule['level_III']

            if actual <= lim_I:
                status = 'ok'
                derating_level = 'I'
            elif actual <= lim_II:
                status = 'warning'
                derating_level = 'II'
            elif actual <= lim_III:
                status = 'warning'
                derating_level = 'III'
            else:
                status = 'exceeds'
                derating_level = 'exceeded'
        else:
            # Ratio-based comparison
            rated = 1.0  # stress ratio is already actual/rated
            stress_ratio = actual
            lim_I = rule['level_I']
            lim_II = rule['level_II']
            lim_III = rule['level_III']

            if stress_ratio <= lim_I:
                status = 'ok'
                derating_level = 'I'
            elif stress_ratio <= lim_II:
                status = 'warning'
                derating_level = 'II'
            elif stress_ratio <= lim_III:
                status = 'warning'
                derating_level = 'III'
            else:
                status = 'exceeds'
                derating_level = 'exceeded'

        results.append(DeratingResult(
            parameter=param_name,
            actual_value=actual,
            rated_value=rated,
            stress_ratio=round(stress_ratio, 6),
            level_I_limit=lim_I,
            level_II_limit=lim_II,
            level_III_limit=lim_III,
            status=status,
            derating_level=derating_level,
        ))

    return results


def get_rules_for_category(category: str) -> list:
    """Return the derating rules for a category (resolving aliases).

    Parameters
    ----------
    category : str
        Part category or alias.

    Returns
    -------
    list[dict]
        The list of rule dicts from ``DERATING_RULES``.

    Raises
    ------
    ValueError
        If the category is unknown.
    """
    resolved = _resolve_category(category)
    if resolved not in DERATING_RULES:
        raise ValueError(
            f"Unknown derating category '{category}' "
            f"(resolved to '{resolved}'). "
            f"Valid categories: {sorted(DERATING_RULES.keys())}"
        )
    return DERATING_RULES[resolved]


def list_categories() -> list:
    """Return all supported derating categories (including aliases)."""
    cats = sorted(DERATING_RULES.keys())
    aliases = sorted(CATEGORY_ALIASES.keys())
    return cats + aliases
