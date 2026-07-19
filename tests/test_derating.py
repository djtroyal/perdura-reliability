"""Fail-closed tests for the derating engine."""

import math

import pytest

import reliability.Derating as derating_module
from reliability.Derating import (
    DERATING_STANDARDS,
    DeratingResult,
    DeratingStandardUnavailableError,
    analyze_derating,
    assess_source_profile,
    get_rules_for_standard,
    list_standards,
    make_custom_rules,
    resolve_source_profile_inputs,
)


def _custom_rules():
    return {
        "resistor": [
            {
                "param": "power_stress",
                "desc": "Power dissipation",
                "unit": "ratio",
                "level_I": 0.4,
                "level_II": 0.5,
                "level_III": 0.7,
            },
            {
                "param": "case_temperature_c",
                "desc": "Case temperature",
                "unit": "°C",
                "level_I": 70,
                "level_II": 85,
                "level_III": 105,
                "rated": 125,
            },
        ]
    }


class TestSourceProfiles:
    def test_synthetic_numerical_tables_were_removed(self):
        assert not hasattr(derating_module, "DERATING_RULES")
        assert not hasattr(derating_module, "NAVSEA_RULES")
        assert not hasattr(derating_module, "ECSS_RULES")
        assert all("rules" not in profile for profile in DERATING_STANDARDS.values())

    def test_registry_distinguishes_executable_and_unavailable_profiles(self):
        assert {
            "MIL-STD-975M", "RADC-TR-84-254", "RL-TR-92-11", "NAVSEA", "ECSS",
        } <= set(
            DERATING_STANDARDS
        )
        assert DERATING_STANDARDS["MIL-STD-975M"]["available"] is True
        assert DERATING_STANDARDS["MIL-STD-975M"]["level_mode"] == "none"
        assert DERATING_STANDARDS["RADC-TR-84-254"]["available"] is True
        assert (
            DERATING_STANDARDS["RADC-TR-84-254"]["level_mode"]
            == "manual_three_level"
        )
        assert DERATING_STANDARDS["RL-TR-92-11"]["available"] is True
        assert (
            DERATING_STANDARDS["RL-TR-92-11"]["level_mode"]
            == "manual_three_level"
        )
        for key in ("NAVSEA", "ECSS"):
            assert DERATING_STANDARDS[key]["available"] is False

    def test_profile_schema_exposes_declarative_automatic_mapping(self):
        profile = next(
            item for item in list_standards()
            if item["key"] == "MIL-STD-975M"
        )
        mapping = profile["profile_schema"]["automatic_mapping"]
        assert any(
            rule["category"] == "resistor" and rule["family"] == "resistor"
            for rule in mapping["family_rules"]
        )
        assert mapping["field_rules"]["resistor"]["actual_power_w"] == {
            "keys": ["rated_power", "power_stress"],
            "transform": "product",
        }

    def test_exact_family_and_identical_fields_are_automatically_reused(self):
        inputs = {
            "actual_current": 0.4,
            "rated_operating_current": 1.0,
            "actual_voltage": 20.0,
            "rated_operating_voltage": 50.0,
            "ambient_temperature_c": 70.0,
        }
        resolution = resolve_source_profile_inputs(
            "MIL-STD-975M", "filter", inputs,
        )
        assert resolution["family"] == "filter"
        assert resolution["family_source"] == "automatic"
        assert resolution["params"] == inputs
        assert resolution["inherited_fields"] == sorted(inputs)

    def test_exact_derived_values_avoid_duplicate_resistor_entry(self):
        resolution = resolve_source_profile_inputs(
            "MIL-STD-975M",
            "resistor",
            {"style": "RM", "rated_power": 0.5, "power_stress": 0.4},
        )
        assert resolution["params"] == {
            "style": "RM",
            "nominal_power_w": 0.5,
            "actual_power_w": pytest.approx(0.2),
        }

    def test_explicit_source_value_overrides_an_automatic_value(self):
        resolution = resolve_source_profile_inputs(
            "MIL-STD-975M",
            "resistor",
            {"style": "RM", "rated_power": 0.5, "power_stress": 0.4},
            {
                "profile": "MIL-STD-975M",
                "family": "resistor",
                "actual_power_w": 0.25,
            },
        )
        assert resolution["params"]["actual_power_w"] == 0.25
        assert "actual_power_w" not in resolution["inherited_fields"]
        assert resolution["explicit_fields"] == ["actual_power_w"]

    def test_ambiguous_family_still_requires_an_explicit_selection(self):
        with pytest.raises(ValueError, match="No exact automatic"):
            resolve_source_profile_inputs(
                "RL-TR-92-11",
                "capacitor",
                {"style": "CK", "T_ambient": 40},
            )

    def test_values_from_another_profile_are_isolated_during_auto_match(self):
        resolution = resolve_source_profile_inputs(
            "RADC-TR-84-254",
            "microcircuit",
            {"device_type": "digital", "technology": "mos", "T_junction": 50},
            {
                "profile": "MIL-STD-975M",
                "family": "digital_microcircuit",
                "junction_temperature_c": 80,
            },
        )
        assert resolution["family"] == "complex_ic"
        assert resolution["params"]["junction_temperature_c"] == 50
        assert resolution["ignored_profile"] == "MIL-STD-975M"

    def test_unscoped_source_values_are_rejected(self):
        with pytest.raises(ValueError, match="no source-profile identity"):
            resolve_source_profile_inputs(
                "MIL-STD-975M", "resistor", {"style": "RM"},
                {"family": "resistor", "actual_power_w": 0.2},
            )
            assert "synthetic screening data" in DERATING_STANDARDS[key]["reason"]

    def test_list_standards_exposes_availability_and_reason(self):
        standards = list_standards()
        assert len(standards) >= 4
        assert all(item["reason"] for item in standards)
        by_key = {item["key"]: item for item in standards}
        assert len(by_key["MIL-STD-975M"]["profile_schema"]["families"]) >= 16
        assert len(by_key["RADC-TR-84-254"]["profile_schema"]["families"]) == 10
        assert len(by_key["RL-TR-92-11"]["profile_schema"]["families"]) >= 10
        assert by_key["NAVSEA"]["profile_schema"] is None

    def test_every_source_numeric_input_has_an_appropriate_increment(self):
        for profile in list_standards():
            schema = profile.get("profile_schema")
            if not profile["available"] or schema is None:
                continue
            numeric_fields = [
                field
                for family in schema["families"]
                for field in family["fields"]
                if field["type"] == "number"
            ]
            assert numeric_fields, profile["key"]
            assert all(field.get("step", 0) > 0 for field in numeric_fields)
            for field in numeric_fields:
                if field.get("unit") == "ratio" or field["key"].endswith("_ratio"):
                    assert field["step"] == pytest.approx(0.01)
                    assert field.get("min") == pytest.approx(0.0)

    def test_source_ui_schema_preserves_application_and_conditional_guidance(self):
        profiles = {item["key"]: item for item in list_standards()}
        mil_families = {
            family["key"]: family
            for family in profiles["MIL-STD-975M"]["profile_schema"]["families"]
        }
        assert mil_families["digital_microcircuit"]["guidance"]
        digital_fields = {
            field["key"]: field
            for field in mil_families["digital_microcircuit"]["fields"]
        }
        assert digital_fields["actual_input_voltage"]["required"] is True
        assert "default" not in digital_fields["actual_input_voltage"]
        assert "Technology is MOS" in digital_fields[
            "clock_frequency_ratio"
        ]["required_when"]

        linear_fields = {
            field["key"]: field
            for field in mil_families["linear_microcircuit"]["fields"]
        }
        op_amp_help = linear_fields["stress_ratios"]["help"]
        assert all(key in op_amp_help for key in (
            "supply_voltage", "power_dissipation", "ac_input_voltage",
            "output_voltage", "output_current", "short_circuit_output_current",
            "actual_input_voltage", "actual_supply_voltage",
        ))

        resistor_fields = {
            field["key"]: field
            for field in mil_families["resistor"]["fields"]
        }
        assert resistor_fields["waveform"] == {
            "key": "waveform",
            "label": "Waveform",
            "type": "select",
            "required": True,
            "options": ["dc", "regular_ac", "pulse", "irregular"],
            "help": resistor_fields["waveform"]["help"],
        }
        assert "never assumes DC" in resistor_fields["waveform"]["help"]
        assert "RCR, RNC, RNR, RNN, or RLR" in resistor_fields[
            "rated_continuous_working_voltage_v"
        ]["required_when"]
        assert "greater than 40×" in resistor_fields[
            "rcr_peak_power_caution_reviewed"
        ]["required_when"]

        radc_hybrid = next(
            family
            for family in profiles["RADC-TR-84-254"]["profile_schema"]["families"]
            if family["key"] == "hybrid"
        )
        case_temperature = next(
            field for field in radc_hybrid["fields"]
            if field["key"] == "case_temperature_c"
        )
        assert case_temperature["required_when"] == "film_construction != none"
        high_reliability = next(
            field for field in radc_hybrid["fields"]
            if field["key"] == "high_reliability_application"
        )
        assert "screening and burn-in" in high_reliability["help"]

    @pytest.mark.parametrize("standard", ["NAVSEA", "ECSS"])
    def test_named_rule_access_fails_closed(self, standard):
        with pytest.raises(
            DeratingStandardUnavailableError,
            match=rf"Derating standard '{standard}' is unavailable",
        ):
            get_rules_for_standard(standard)

    @pytest.mark.parametrize("standard", ["NAVSEA", "ECSS"])
    def test_named_analysis_fails_closed(self, standard):
        with pytest.raises(DeratingStandardUnavailableError, match="unavailable"):
            analyze_derating(
                "resistor",
                {"power_stress": 0.25},
                standard=standard,
            )

    def test_generic_rule_api_cannot_flatten_source_specific_profile(self):
        with pytest.raises(ValueError, match="source-specific"):
            get_rules_for_standard("MIL-STD-975M")
        with pytest.raises(ValueError, match="source-specific"):
            analyze_derating("resistor", {"power_stress": 0.25})

    def test_mil_975m_filter_uses_exact_one_level_source_profile(self):
        result = assess_source_profile(
            "MIL-STD-975M",
            "filter",
            {
                "actual_current": 0.4,
                "rated_operating_current": 1,
                "actual_voltage": 20,
                "rated_operating_voltage": 50,
                "ambient_temperature_c": 70,
            },
        )
        assert result.status == "ok"
        assert len(result.checks) == 3
        assert result.checks[0].rule_id == "975M.A.3.5.current"
        assert result.checks[0].allowable_value == 0.5
        assert result.traceability["standard"] == "MIL-STD-975M"

    def test_mil_975m_adapter_preserves_not_evaluated_vs_numeric_failure(self):
        inputs = {
            "transistor_type": "bipolar",
            "actual_power_w": 1,
            "rated_power_w": 10,
            "actual_current_a": 1,
            "rated_current_a": 10,
            "dc_voltage_v": 1,
            "peak_ac_voltage_v": 0,
            "transient_voltage_v": 0,
            "rated_voltage_v": 10,
            "junction_temperature_c": 25,
            "safe_operating_area_verified": False,
        }
        incomplete = assess_source_profile(
            "MIL-STD-975M", "transistor", inputs,
        )
        assert incomplete.status == "not_evaluated"
        assert any(
            check.status == "not_evaluated" for check in incomplete.checks
        )
        assert all(
            check.status == "ok"
            for check in incomplete.checks
            if check.parameter != "safe_operating_area"
        )

        failed = assess_source_profile(
            "MIL-STD-975M", "transistor",
            inputs | {"actual_power_w": 6},
        )
        assert failed.status == "exceeds"
        assert any(check.status == "exceeds" for check in failed.checks)
        assert any(
            check.status == "not_evaluated" for check in failed.checks
        )

    def test_mil_975m_adapter_preserves_handbook_pulse_checks_and_sources(self):
        result = assess_source_profile(
            "MIL-STD-975M", "resistor", {
                "style": "RNC",
                "nominal_power_w": 1,
                "actual_power_w": .2,
                "ambient_temperature_c": 25,
                "specification_maximum_voltage": 500,
                "actual_voltage": 140,
                "active_element_resistance_ohm": 1000,
                "waveform": "pulse",
                "rated_continuous_working_voltage_v": 100,
                "peak_power_w": 4,
                "low_duty_cycle": True,
                "continuous_overpower_fault_precluded": True,
                "steep_wavefront_compatibility_verified": True,
                "pulse_temperature_rise_acceptable_verified": True,
            },
        )

        assert result.status == "ok"
        by_id = {check.rule_id: check for check in result.checks}
        voltage = by_id["978B.3.3.5.3.RNC.peak_voltage"]
        assert voltage.allowable_value == pytest.approx(140)
        assert voltage.formula == "Vpeak <= 1.4 RCWV"
        assert voltage.source["section"] == "MIL-HDBK-978B, 3.3.5.3"
        assert by_id["975M.A.3.11.RNC.power"].status == "ok"

    def test_mil_975m_rejects_three_level_semantics(self):
        with pytest.raises(ValueError, match="does not define Levels"):
            assess_source_profile(
                "MIL-STD-975M", "filter", {}, selected_level="II"
            )

    def test_radc_profile_requires_manual_level_and_preserves_table_checks(self):
        with pytest.raises(ValueError, match="manual Level"):
            assess_source_profile("RADC-TR-84-254", "ram_rom", {})
        result = assess_source_profile(
            "RADC-TR-84-254",
            "ram_rom",
            {
                "junction_temperature_c": 90,
                "supply_voltage_ratio": 0.7,
                "output_current_ratio": 0.7,
                "high_reliability_application": False,
                "memory_kind": "rom",
                "device_specification_tolerances_verified": True,
            },
            selected_level="II",
        )
        assert result.status == "ok"
        assert len(result.checks) == 5
        assert {check.parameter for check in result.checks} >= {
            "high_reliability_application",
            "device_specification_tolerances_verified",
        }
        table_parameters = {
            "junction_temperature_c", "supply_voltage_ratio", "output_current_ratio",
        }
        assert all(
            "Table 3" in check.source["section"]
            for check in result.checks
            if check.parameter in table_parameters
        )

    def test_rl_profile_preserves_distinct_obligations_and_native_equations(self):
        result = assess_source_profile(
            "RL-TR-92-11",
            "asic_mos_digital",
            {
                "gate_count": 10_000,
                "supply_voltage_v": 1,
                "supplier_min_supply_v": 0,
                "supplier_max_supply_v": 20,
                "frequency_pct_of_max": 0,
                "output_current_pct_of_rated": 0,
                "fanout_pct_of_rated": 0,
                "junction_temperature_c": 25,
                "supplier_max_junction_temperature_c": 150,
                "unused_inputs_terminated": True,
                "supply_transient_filtering_verified": True,
                "digital_design_margins_verified": True,
                "reverse_voltage_avoided": True,
                "aluminum_metallization_used": False,
            },
            selected_level="I",
        )
        assert result.status == "ok"
        assert len({check.rule_id for check in result.checks}) == len(result.checks)
        assert any(check.formula for check in result.checks)
        assert any(check.substitution for check in result.checks)
        assert all(check.source and check.source["section"] for check in result.checks)
        assert any(
            "Table 4-7" in check.source["section"] for check in result.checks
        )
        assert any(
            "report p. 87" in check.source["section"] for check in result.checks
        )

    def test_old_ambiguous_mil_selector_is_not_a_compatibility_alias(self):
        with pytest.raises(ValueError, match="Unknown derating standard"):
            get_rules_for_standard("MIL-STD-975")

    def test_unknown_standard_is_distinct_from_unavailable(self):
        with pytest.raises(ValueError, match="Unknown derating standard"):
            get_rules_for_standard("NOT-A-STANDARD")


class TestCustomRuleValidation:
    def test_normalizes_only_category_case_and_whitespace(self):
        rules = make_custom_rules({
            "  HF_DIODE  ": [{
                "param": "voltage_stress",
                "level_I": "0.4",
                "level_II": "0.5",
                "level_III": "0.6",
            }]
        })
        assert set(rules) == {"hf_diode"}
        assert rules["hf_diode"][0]["level_I"] == 0.4

    @pytest.mark.parametrize("rules", [{}, [], None])
    def test_rejects_empty_or_non_mapping_rulebooks(self, rules):
        with pytest.raises(ValueError, match="non-empty mapping"):
            make_custom_rules(rules)

    def test_rejects_empty_category(self):
        with pytest.raises(ValueError, match="category must not be empty"):
            make_custom_rules({" ": [{
                "param": "x", "level_I": 1, "level_II": 2, "level_III": 3,
            }]})

    def test_rejects_empty_category_rules(self):
        with pytest.raises(ValueError, match="at least one rule"):
            make_custom_rules({"resistor": []})

    def test_rejects_non_mapping_rule(self):
        with pytest.raises(ValueError, match="must be a mapping"):
            make_custom_rules({"resistor": ["not a rule"]})

    def test_rejects_missing_required_field(self):
        with pytest.raises(ValueError, match="missing 'level_III'"):
            make_custom_rules({"resistor": [{
                "param": "x", "level_I": 1, "level_II": 2,
            }]})

    @pytest.mark.parametrize("field", ["level_I", "level_II", "level_III"])
    def test_rejects_boolean_rule_limits(self, field):
        rule = {
            "param": "x", "level_I": 0.4, "level_II": 0.5, "level_III": 0.6,
        }
        rule[field] = True
        with pytest.raises(ValueError, match="non-numeric limit"):
            make_custom_rules({"resistor": [rule]})

    @pytest.mark.parametrize("unit", ["C", "percent", "", "kelvin"])
    def test_rejects_unsupported_units(self, unit):
        with pytest.raises(ValueError, match="unsupported unit"):
            make_custom_rules({"resistor": [{
                "param": "temperature",
                "unit": unit,
                "level_I": 70,
                "level_II": 85,
                "level_III": 100,
            }]})

    @pytest.mark.parametrize(
        "limits",
        [
            (0.6, 0.5, 0.7),
            (0.4, 0.8, 0.7),
            (0.4, math.inf, 0.7),
            (0.4, math.nan, 0.7),
        ],
    )
    def test_rejects_nonmonotonic_or_nonfinite_limits(self, limits):
        with pytest.raises(ValueError, match="limits must"):
            make_custom_rules({"resistor": [{
                "param": "power_stress",
                "level_I": limits[0],
                "level_II": limits[1],
                "level_III": limits[2],
            }]})

    @pytest.mark.parametrize("limits", [(-0.1, 0.5, 0.7), (0.4, 0.5, 1.1)])
    def test_ratio_thresholds_are_bounded(self, limits):
        with pytest.raises(ValueError, match="between 0 and 1"):
            make_custom_rules({"resistor": [{
                "param": "power_stress",
                "level_I": limits[0],
                "level_II": limits[1],
                "level_III": limits[2],
            }]})

    def test_rejects_duplicate_parameters(self):
        rule = {
            "param": "power_stress",
            "level_I": 0.4,
            "level_II": 0.5,
            "level_III": 0.7,
        }
        with pytest.raises(ValueError, match="duplicate parameter"):
            make_custom_rules({"resistor": [rule, rule.copy()]})

    @pytest.mark.parametrize("rated", [math.nan, math.inf, "not numeric", True])
    def test_rejects_invalid_rated_value(self, rated):
        with pytest.raises(ValueError, match="rated value must"):
            make_custom_rules({"resistor": [{
                "param": "temperature",
                "unit": "°C",
                "level_I": 70,
                "level_II": 85,
                "level_III": 100,
                "rated": rated,
            }]})

    def test_rejects_rated_temperature_below_level_three(self):
        with pytest.raises(ValueError, match="at least the level_III"):
            make_custom_rules({"resistor": [{
                "param": "temperature",
                "unit": "°C",
                "level_I": 70,
                "level_II": 85,
                "level_III": 100,
                "rated": 90,
            }]})


class TestCustomAnalysis:
    @pytest.mark.parametrize(
        ("selected_level", "value", "status"),
        [
            ("I", 0.45, "exceeds"),
            ("II", 0.45, "ok"),
            ("III", 0.65, "ok"),
            ("III", 0.75, "exceeds"),
        ],
    )
    def test_selected_level_determines_pass_fail(
        self, selected_level, value, status,
    ):
        result = analyze_derating(
            "resistor",
            {"power_stress": value},
            custom_rules=_custom_rules(),
            selected_level=selected_level,
        )[0]
        assert result.status == status
        assert result.selected_level == selected_level

    def test_achieved_level_is_separate_from_selected_level(self):
        result = analyze_derating(
            "resistor",
            {"power_stress": 0.6},
            custom_rules=_custom_rules(),
            selected_level="II",
        )[0]
        assert result.status == "exceeds"
        assert result.derating_level == "III"

    def test_selected_level_is_normalized(self):
        result = analyze_derating(
            "resistor",
            {"power_stress": 0.4},
            custom_rules=_custom_rules(),
            selected_level=" i ",
        )[0]
        assert result.selected_level == "I"

    @pytest.mark.parametrize("selected_level", ["", "IV", "1", None])
    def test_rejects_unknown_selected_level(self, selected_level):
        with pytest.raises(ValueError, match="selected_level"):
            analyze_derating(
                "resistor", {},
                custom_rules=_custom_rules(),
                selected_level=selected_level,
            )

    def test_emits_one_result_per_rule_including_missing_inputs(self):
        results = analyze_derating(
            "resistor",
            {"power_stress": 0.3},
            custom_rules=_custom_rules(),
        )
        assert len(results) == 2
        assert results[0].status == "ok"
        assert results[1].status == "not_evaluated"
        assert results[1].actual_value is None
        assert "not evaluated" in results[1].message

    def test_celsius_is_not_reported_as_a_dimensionless_ratio(self):
        result = analyze_derating(
            "resistor",
            {"case_temperature_c": 80},
            custom_rules=_custom_rules(),
        )[1]
        assert result.actual_value == 80
        assert result.rated_value == 125
        assert result.stress_ratio is None

    def test_exact_category_mapping_is_required(self):
        rules = {"diode": [{
            "param": "voltage_stress",
            "level_I": 0.4,
            "level_II": 0.5,
            "level_III": 0.6,
        }]}
        with pytest.raises(ValueError, match="Unknown derating category"):
            analyze_derating(
                "hf_diode", {"voltage_stress": 0.3}, custom_rules=rules,
            )

    @pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
    def test_rejects_nonfinite_actual_values(self, value):
        with pytest.raises(ValueError, match="must be finite"):
            analyze_derating(
                "resistor", {"power_stress": value},
                custom_rules=_custom_rules(),
            )

    def test_rejects_negative_ratio(self):
        with pytest.raises(ValueError, match="non-negative"):
            analyze_derating(
                "resistor", {"power_stress": -0.1},
                custom_rules=_custom_rules(),
            )

    def test_rejects_boolean_actual_value(self):
        with pytest.raises(ValueError, match="must be numeric"):
            analyze_derating(
                "resistor", {"power_stress": True},
                custom_rules=_custom_rules(),
            )

    def test_rejects_non_mapping_params(self):
        with pytest.raises(ValueError, match="params must be a mapping"):
            analyze_derating(
                "resistor", [], custom_rules=_custom_rules(),
            )

    def test_result_is_immutable_and_repr_is_informative(self):
        result = analyze_derating(
            "resistor", {"power_stress": 0.3},
            custom_rules=_custom_rules(),
        )[0]
        assert isinstance(result, DeratingResult)
        assert "power_stress" in repr(result)
        assert "selected_level='II'" in repr(result)
        with pytest.raises((AttributeError, TypeError)):
            result.status = "exceeds"
