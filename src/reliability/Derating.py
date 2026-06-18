"""Derating analysis for electronic components.

Derating means operating components below their maximum rated values to
improve reliability.  Standard derating guidelines (per MIL-STD-975,
NASA PD-EC-1101, NAVSEA TE000-AB-GTP-010) specify maximum allowable
stress ratios for each part category.

Three derating levels are defined:
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

def analyze_derating(category: str, params: dict) -> list:
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

    Returns
    -------
    list[DeratingResult]
        One entry per applicable rule whose parameter appears in *params*.

    Raises
    ------
    ValueError
        If *category* (after alias resolution) is not in DERATING_RULES.

    Examples
    --------
    >>> results = analyze_derating('capacitor', {
    ...     'voltage_stress': 0.45,
    ...     'temperature': 80,
    ... })
    >>> results[0].status
    'ok'
    """
    resolved = _resolve_category(category)
    if resolved not in DERATING_RULES:
        raise ValueError(
            f"Unknown derating category '{category}' "
            f"(resolved to '{resolved}'). "
            f"Valid categories: {sorted(DERATING_RULES.keys())}"
        )

    rules = DERATING_RULES[resolved]
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
