"""Tests for the Derating module."""

import pytest

from reliability.Derating import (
    DERATING_RULES,
    NAVSEA_RULES,
    ECSS_RULES,
    DERATING_STANDARDS,
    CATEGORY_ALIASES,
    DeratingResult,
    analyze_derating,
    get_rules_for_category,
    get_rules_for_standard,
    list_categories,
    list_standards,
    make_custom_rules,
    _resolve_category,
)


# ===================================================================
# DERATING_RULES structure
# ===================================================================

class TestDeratingRulesStructure:
    def test_all_categories_present(self):
        expected = {
            'resistor', 'capacitor', 'diode', 'bjt', 'fet',
            'microcircuit', 'thyristor', 'relay', 'switch',
            'connector', 'inductive', 'optoelectronic', 'rotating',
        }
        assert set(DERATING_RULES.keys()) == expected

    def test_each_rule_has_required_keys(self):
        required = {'param', 'desc', 'unit', 'level_I', 'level_II', 'level_III'}
        for cat, rules in DERATING_RULES.items():
            for rule in rules:
                missing = required - set(rule.keys())
                assert not missing, (
                    f"Category '{cat}' rule '{rule.get('param', '?')}' "
                    f"missing keys: {missing}"
                )

    def test_levels_are_monotonic(self):
        """Level I <= Level II <= Level III for every rule."""
        for cat, rules in DERATING_RULES.items():
            for rule in rules:
                assert rule['level_I'] <= rule['level_II'] <= rule['level_III'], (
                    f"{cat}/{rule['param']}: levels not monotonic "
                    f"({rule['level_I']}, {rule['level_II']}, {rule['level_III']})"
                )

    def test_temperature_rules_have_rated(self):
        """Temperature rules (unit='°C') must have a 'rated' key."""
        for cat, rules in DERATING_RULES.items():
            for rule in rules:
                if rule['unit'] == '°C':
                    assert 'rated' in rule, (
                        f"{cat}/{rule['param']}: temperature rule missing 'rated'"
                    )


# ===================================================================
# Category aliases
# ===================================================================

class TestAliases:
    def test_known_aliases(self):
        assert _resolve_category('hf_diode') == 'diode'
        assert _resolve_category('gaas_fet') == 'fet'
        assert _resolve_category('hybrid_microcircuit') == 'microcircuit'
        assert _resolve_category('unijunction') == 'bjt'
        assert _resolve_category('ss_relay') == 'relay'
        assert _resolve_category('circuit_breaker') == 'switch'
        assert _resolve_category('laser') == 'optoelectronic'

    def test_case_insensitive(self):
        assert _resolve_category('Resistor') == 'resistor'
        assert _resolve_category('CAPACITOR') == 'capacitor'
        assert _resolve_category('HF_DIODE') == 'diode'

    def test_direct_category_unchanged(self):
        for cat in DERATING_RULES:
            assert _resolve_category(cat) == cat


# ===================================================================
# analyze_derating — ratio-based parameters
# ===================================================================

class TestAnalyzeDeratingRatio:
    def test_capacitor_voltage_ok(self):
        """Voltage stress 0.45 is within Level I (0.50)."""
        results = analyze_derating('capacitor', {'voltage_stress': 0.45})
        assert len(results) == 1
        r = results[0]
        assert r.parameter == 'voltage_stress'
        assert r.actual_value == 0.45
        assert r.rated_value == 1.0
        assert r.stress_ratio == pytest.approx(0.45)
        assert r.status == 'ok'
        assert r.derating_level == 'I'

    def test_capacitor_voltage_warning_level_II(self):
        """Voltage stress 0.55 exceeds Level I (0.50) but within Level II (0.60)."""
        results = analyze_derating('capacitor', {'voltage_stress': 0.55})
        r = results[0]
        assert r.status == 'warning'
        assert r.derating_level == 'II'

    def test_capacitor_voltage_warning_level_III(self):
        """Voltage stress 0.65 exceeds Level II (0.60) but within Level III (0.70)."""
        results = analyze_derating('capacitor', {'voltage_stress': 0.65})
        r = results[0]
        assert r.status == 'warning'
        assert r.derating_level == 'III'

    def test_capacitor_voltage_exceeds(self):
        """Voltage stress 0.80 exceeds Level III (0.70)."""
        results = analyze_derating('capacitor', {'voltage_stress': 0.80})
        r = results[0]
        assert r.status == 'exceeds'
        assert r.derating_level == 'exceeded'

    def test_boundary_at_level_I(self):
        """Exactly at Level I limit should be 'ok'."""
        results = analyze_derating('resistor', {'power_stress': 0.50})
        assert results[0].status == 'ok'
        assert results[0].derating_level == 'I'

    def test_boundary_at_level_III(self):
        """Exactly at Level III limit should be 'warning'."""
        results = analyze_derating('resistor', {'power_stress': 0.80})
        assert results[0].status == 'warning'
        assert results[0].derating_level == 'III'

    def test_slightly_above_level_III(self):
        """Just above Level III should be 'exceeds'."""
        results = analyze_derating('resistor', {'power_stress': 0.81})
        assert results[0].status == 'exceeds'
        assert results[0].derating_level == 'exceeded'


# ===================================================================
# analyze_derating — temperature parameters
# ===================================================================

class TestAnalyzeDeratingTemperature:
    def test_resistor_temp_ok(self):
        """T=70°C is within Level I (85°C)."""
        results = analyze_derating('resistor', {'temperature': 70})
        r = results[0]
        assert r.parameter == 'temperature'
        assert r.actual_value == 70
        assert r.rated_value == 125  # rated max
        assert r.stress_ratio == pytest.approx(70 / 125, rel=1e-4)
        assert r.status == 'ok'
        assert r.derating_level == 'I'

    def test_resistor_temp_warning_level_II(self):
        """T=90°C exceeds Level I (85) but within Level II (100)."""
        results = analyze_derating('resistor', {'temperature': 90})
        r = results[0]
        assert r.status == 'warning'
        assert r.derating_level == 'II'

    def test_resistor_temp_warning_level_III(self):
        """T=110°C exceeds Level II (100) but within Level III (125)."""
        results = analyze_derating('resistor', {'temperature': 110})
        r = results[0]
        assert r.status == 'warning'
        assert r.derating_level == 'III'

    def test_resistor_temp_exceeds(self):
        """T=130°C exceeds Level III (125)."""
        results = analyze_derating('resistor', {'temperature': 130})
        r = results[0]
        assert r.status == 'exceeds'
        assert r.derating_level == 'exceeded'

    def test_diode_junction_temp(self):
        """Junction temp 100°C is within Level I (110°C) for diodes."""
        results = analyze_derating('diode', {'junction_temp': 100})
        r = results[0]
        assert r.parameter == 'junction_temp'
        assert r.status == 'ok'
        assert r.rated_value == 175


# ===================================================================
# Multiple parameters
# ===================================================================

class TestMultipleParameters:
    def test_resistor_multiple_params(self):
        """All three resistor parameters provided."""
        results = analyze_derating('resistor', {
            'power_stress': 0.40,
            'voltage_stress': 0.55,
            'temperature': 90,
        })
        assert len(results) == 3
        params = {r.parameter: r for r in results}
        assert params['power_stress'].status == 'ok'
        assert params['voltage_stress'].status == 'ok'  # 0.55 < 0.60
        assert params['temperature'].status == 'warning'  # 90 > 85

    def test_only_provided_params_checked(self):
        """Parameters not in params dict should not appear in results."""
        results = analyze_derating('resistor', {'power_stress': 0.3})
        assert len(results) == 1
        assert results[0].parameter == 'power_stress'

    def test_empty_params(self):
        """No matching parameters should return empty list."""
        results = analyze_derating('resistor', {'irrelevant': 0.5})
        assert results == []


# ===================================================================
# Aliases in analyze_derating
# ===================================================================

class TestAliasAnalysis:
    def test_hf_diode_uses_diode_rules(self):
        results_alias = analyze_derating('hf_diode', {'voltage_stress': 0.55})
        results_direct = analyze_derating('diode', {'voltage_stress': 0.55})
        assert len(results_alias) == len(results_direct)
        assert results_alias[0].level_I_limit == results_direct[0].level_I_limit

    def test_laser_uses_optoelectronic_rules(self):
        results = analyze_derating('laser', {'current_stress': 0.45})
        assert results[0].status == 'ok'

    def test_circuit_breaker_uses_switch_rules(self):
        results = analyze_derating('circuit_breaker', {'current_stress': 0.70})
        assert results[0].status == 'warning'  # 0.70 > 0.60 but <= 0.75


# ===================================================================
# Error handling
# ===================================================================

class TestErrorHandling:
    def test_unknown_category_raises(self):
        with pytest.raises(ValueError, match="Unknown derating category"):
            analyze_derating('unicorn', {'voltage_stress': 0.5})

    def test_get_rules_unknown_raises(self):
        with pytest.raises(ValueError, match="Unknown derating category"):
            get_rules_for_category('nonexistent')


# ===================================================================
# Utility functions
# ===================================================================

class TestUtilities:
    def test_get_rules_for_category(self):
        rules = get_rules_for_category('resistor')
        assert len(rules) == 3
        assert rules[0]['param'] == 'power_stress'

    def test_get_rules_for_alias(self):
        rules = get_rules_for_category('laser')
        assert rules == DERATING_RULES['optoelectronic']

    def test_list_categories_includes_all(self):
        cats = list_categories()
        # Must include all base categories
        for cat in DERATING_RULES:
            assert cat in cats
        # Must include all aliases
        for alias in CATEGORY_ALIASES:
            assert alias in cats


# ===================================================================
# DeratingResult dataclass
# ===================================================================

class TestDeratingResult:
    def test_fields(self):
        r = DeratingResult(
            parameter='voltage_stress',
            actual_value=0.45,
            rated_value=1.0,
            stress_ratio=0.45,
            level_I_limit=0.50,
            level_II_limit=0.60,
            level_III_limit=0.70,
            status='ok',
            derating_level='I',
        )
        assert r.parameter == 'voltage_stress'
        assert r.actual_value == 0.45
        assert r.stress_ratio == 0.45
        assert r.status == 'ok'
        assert r.derating_level == 'I'

    def test_repr(self):
        r = DeratingResult('voltage_stress', 0.45, 1.0, 0.45,
                           0.50, 0.60, 0.70, 'ok', 'I')
        text = repr(r)
        assert 'voltage_stress' in text
        assert 'ok' in text


# ===================================================================
# Multi-standard derating
# ===================================================================

class TestMultiStandard:
    def test_standards_registry_has_three(self):
        assert 'MIL-STD-975' in DERATING_STANDARDS
        assert 'NAVSEA' in DERATING_STANDARDS
        assert 'ECSS' in DERATING_STANDARDS

    def test_navsea_rules_structure(self):
        for cat, rules in NAVSEA_RULES.items():
            for rule in rules:
                assert 'param' in rule
                assert 'level_I' in rule
                assert rule['level_I'] <= rule['level_II'] <= rule['level_III']

    def test_ecss_rules_structure(self):
        for cat, rules in ECSS_RULES.items():
            for rule in rules:
                assert 'param' in rule
                assert 'level_I' in rule
                assert rule['level_I'] <= rule['level_II'] <= rule['level_III']

    def test_get_rules_for_standard(self):
        assert get_rules_for_standard('MIL-STD-975') is DERATING_RULES
        assert get_rules_for_standard('NAVSEA') is NAVSEA_RULES
        assert get_rules_for_standard('ECSS') is ECSS_RULES

    def test_get_rules_unknown_standard_raises(self):
        with pytest.raises(ValueError, match="Unknown derating standard"):
            get_rules_for_standard('NONEXISTENT')

    def test_list_standards(self):
        stds = list_standards()
        assert len(stds) == 3
        keys = [s['key'] for s in stds]
        assert 'MIL-STD-975' in keys
        assert 'NAVSEA' in keys
        assert 'ECSS' in keys

    def test_analyze_with_navsea(self):
        results = analyze_derating('resistor', {'power_stress': 0.35}, standard='NAVSEA')
        assert len(results) >= 1
        assert results[0].level_I_limit == NAVSEA_RULES['resistor'][0]['level_I']

    def test_analyze_with_ecss(self):
        results = analyze_derating('capacitor', {'voltage_stress': 0.3}, standard='ECSS')
        assert len(results) >= 1
        assert results[0].level_I_limit == ECSS_RULES['capacitor'][0]['level_I']

    def test_different_standards_give_different_limits(self):
        mil = analyze_derating('resistor', {'power_stress': 0.45}, standard='MIL-STD-975')
        nav = analyze_derating('resistor', {'power_stress': 0.45}, standard='NAVSEA')
        assert mil[0].level_I_limit != nav[0].level_I_limit or mil[0].level_II_limit != nav[0].level_II_limit

    def test_default_standard_is_mil(self):
        default_res = analyze_derating('resistor', {'power_stress': 0.35})
        mil_res = analyze_derating('resistor', {'power_stress': 0.35}, standard='MIL-STD-975')
        assert default_res[0].level_I_limit == mil_res[0].level_I_limit


# ===================================================================
# Custom derating rules
# ===================================================================

class TestCustomRules:
    def test_make_custom_rules(self):
        overrides = {
            'resistor': [
                {'param': 'power_stress', 'desc': 'Power', 'unit': 'ratio',
                 'level_I': 0.40, 'level_II': 0.50, 'level_III': 0.60},
            ]
        }
        rules = make_custom_rules(overrides)
        assert 'resistor' in rules
        assert rules['resistor'][0]['level_I'] == 0.40

    def test_analyze_with_custom_rules(self):
        custom = make_custom_rules({
            'resistor': [
                {'param': 'power_stress', 'desc': 'Power', 'unit': 'ratio',
                 'level_I': 0.30, 'level_II': 0.40, 'level_III': 0.50},
            ]
        })
        results = analyze_derating('resistor', {'power_stress': 0.35}, custom_rules=custom)
        assert len(results) == 1
        assert results[0].level_I_limit == 0.30
        assert results[0].status == 'warning'

    def test_custom_rules_override_standard(self):
        custom = make_custom_rules({
            'resistor': [
                {'param': 'power_stress', 'desc': 'Power', 'unit': 'ratio',
                 'level_I': 0.99, 'level_II': 0.995, 'level_III': 0.999},
            ]
        })
        results = analyze_derating('resistor', {'power_stress': 0.5},
                                   standard='NAVSEA', custom_rules=custom)
        assert results[0].level_I_limit == 0.99
        assert results[0].status == 'ok'

    def test_custom_category_not_found(self):
        custom = make_custom_rules({'resistor': [
            {'param': 'power_stress', 'level_I': 0.5, 'level_II': 0.6, 'level_III': 0.7}
        ]})
        with pytest.raises(ValueError):
            analyze_derating('capacitor', {'voltage_stress': 0.5}, custom_rules=custom)
