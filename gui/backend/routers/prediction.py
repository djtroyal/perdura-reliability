"""Failure rate prediction router (MIL-HDBK-217F / VITA 51.1 / Telcordia / 217Plus / FIDES / NSWC)."""

import logging
import math
import sys
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.MIL_HDBK_217F import (
    ENVIRONMENTS, ENVIRONMENT_DESCRIPTIONS, STANDARDS,
    VITA_PART_CATEGORIES, annotate_vita_result,
    Microcircuit, VHSICMicrocircuit, GaAsMicrocircuit,
    HybridMicrocircuit, SurfaceAcousticWaveDevice, MagneticBubbleMemory,
    Diode, HFDiode, BipolarTransistor, FieldEffectTransistor,
    GaAsFET, UnijunctionTransistor, HFLowNoiseBipolarTransistor,
    HFPowerBipolarTransistor, HighFrequencySiliconFET,
    Thyristor, Optoelectronic, LaserDiode,
    ElectronTube, TravelingWaveTube, Magnetron,
    GasLaser, SealedCO2Laser, FlowingCO2Laser, SolidStateLaser,
    Resistor, Capacitor, Transformer, InductorCoil, FerriteBead,
    Motor, SynchroResolver, ElapsedTimeMeter, Relay, SolidStateRelay,
    Switch, CircuitBreaker,
    Connector, ConnectorSocket, PlatedThroughHoleAssembly,
    SurfaceMountAssembly, Connection,
    Meter, QuartzCrystal, Oscillator, MEMSOscillator, Lamp,
    ElectronicFilter, Fuse,
    MiscellaneousPart, DetailedCMOSMicrocircuit,
    PartsCountPart, PARTS_COUNT_RECIPES, parts_count_catalog,
    CustomPart, GenericPart,
    SystemFailureRate,
)
from reliability.Standards import get_derating_disclosure, get_standard_disclosure
from reliability.RADC_TR_85_91 import (
    NONOPERATING_ENVIRONMENTS,
    NONOPERATING_ENVIRONMENT_DESCRIPTIONS,
    NONOPERATING_MODEL_CATALOG,
)
from routers._prediction_impacts import build_parameter_impacts
from routers._prediction_symbols import (
    add_equation_symbol_bindings,
    effective_model_inputs,
)
from routers._radc_nonoperating import (
    AUTOMATIC_MODEL_INPUTS,
    calculate_nonoperating,
)
from schemas import (
    PredictionRequest, MultiStandardPredictionRequest,
    DeratingRequest, MissionProfilePredictionRequest,
)

router = APIRouter()
logger = logging.getLogger(__name__)

_DERATING_INPUT_MESSAGE = (
    "Derating evaluation could not be completed for this part. Review the "
    "selected source profile and its required inputs."
)
_DERATING_UNAVAILABLE_MESSAGE = (
    "The selected derating standard is unavailable, so this part was not evaluated."
)


def _public_custom_rule_error(exc: Exception) -> str:
    """Map custom-rule failures to authored messages without returning exception text."""
    unsafe = str(exc).lower()
    safe_reasons = (
        ("level_i <= level_ii <= level_iii",
         "limits must satisfy level_I <= level_II <= level_III"),
        ("non-empty mapping", "the rule set must be a non-empty mapping"),
        ("category must not be empty", "the category must not be empty"),
        ("at least one rule", "each category must contain at least one rule"),
        ("non-numeric limit", "all limits must be numeric"),
        ("limits must be finite", "all limits must be finite"),
        ("between 0 and 1", "ratio limits must be between 0 and 1"),
        ("unsupported unit", "units must be either 'ratio' or '°C'"),
    )
    for marker, reason in safe_reasons:
        if marker in unsafe:
            return f"Invalid custom derating rule set: {reason}."
    return "Invalid custom derating rule set. Review its categories, parameters, and limits."


def _public_derating_input_error(
    exc: Exception,
    profile: dict | None,
    family: str | None,
) -> str:
    """Return useful guidance selected only from trusted profile metadata.

    Exception text is used solely to select an authored field identifier or
    message. It is never copied into the API response.
    """
    unsafe = str(exc)
    family_definition = next((
        definition for definition in (profile or {}).get("families", [])
        if definition.get("key") == family
    ), None)
    trusted_fields = sorted({
        str(field.get("key"))
        for field in (family_definition or {}).get("fields", [])
        if field.get("key")
    }, key=len, reverse=True)
    matched_fields = sorted(field for field in trusted_fields if field in unsafe)
    if matched_fields:
        return (
            "Missing or invalid explicit source input(s): "
            f"{', '.join(matched_fields)}."
        )

    safe_reasons = (
        ("source family/model must be selected explicitly",
         "Select the applicable source family or model."),
        ("source-specific derating params must be a mapping",
         "Source-specific derating inputs must use named fields."),
        ("does not define Levels I/II/III",
         "The selected source profile does not use Levels I/II/III."),
        ("params must be a mapping",
         "Derating inputs must use named fields."),
    )
    for marker, reason in safe_reasons:
        if marker in unsafe:
            return reason
    return _DERATING_INPUT_MESSAGE

# ---------------------------------------------------------------------------
# MIL-HDBK-217F part classes
# ---------------------------------------------------------------------------
_PART_CLASSES = {
    "microcircuit": Microcircuit,
    "vhsic_microcircuit": VHSICMicrocircuit,
    "gaas_microcircuit": GaAsMicrocircuit,
    "hybrid_microcircuit": HybridMicrocircuit,
    "saw_device": SurfaceAcousticWaveDevice,
    "bubble_memory": MagneticBubbleMemory,
    "diode": Diode,
    "hf_diode": HFDiode,
    "bjt": BipolarTransistor,
    "fet": FieldEffectTransistor,
    "gaas_fet": GaAsFET,
    "unijunction": UnijunctionTransistor,
    "hf_low_noise_bjt": HFLowNoiseBipolarTransistor,
    "hf_power_bjt": HFPowerBipolarTransistor,
    "hf_silicon_fet": HighFrequencySiliconFET,
    "thyristor": Thyristor,
    "optoelectronic": Optoelectronic,
    "laser_diode": LaserDiode,
    "electron_tube": ElectronTube,
    "traveling_wave_tube": TravelingWaveTube,
    "magnetron": Magnetron,
    "gas_laser": GasLaser,
    "sealed_co2_laser": SealedCO2Laser,
    "flowing_co2_laser": FlowingCO2Laser,
    "solid_state_laser": SolidStateLaser,
    "resistor": Resistor,
    "capacitor": Capacitor,
    "transformer": Transformer,
    "inductor_coil": InductorCoil,
    "ferrite_bead": FerriteBead,
    "motor": Motor,
    "synchro_resolver": SynchroResolver,
    "elapsed_time_meter": ElapsedTimeMeter,
    "relay": Relay,
    "ss_relay": SolidStateRelay,
    "switch": Switch,
    "circuit_breaker": CircuitBreaker,
    "connector": Connector,
    "connector_socket": ConnectorSocket,
    "pth_assembly": PlatedThroughHoleAssembly,
    "surface_mount_assembly": SurfaceMountAssembly,
    "connection": Connection,
    "meter": Meter,
    "crystal": QuartzCrystal,
    "oscillator": Oscillator,
    "mems_oscillator": MEMSOscillator,
    "lamp": Lamp,
    "filter": ElectronicFilter,
    "fuse": Fuse,
    "miscellaneous": MiscellaneousPart,
    "detailed_cmos": DetailedCMOSMicrocircuit,
    "parts_count": PartsCountPart,
    "custom": CustomPart,
    "generic": GenericPart,
}

# Categories with a numerical rule, default, mapping, conversion, or alternate
# method in ANSI/VITA 51.1-2013 (R2018).  The source-of-truth lives beside the
# calculation core so API and UI coverage cannot silently diverge.
_VITA_CATEGORIES = set(VITA_PART_CATEGORIES)


def _clean_part_params(params):
    """Drop empty form values before calling a numerical model constructor.

    Optional number and text controls are represented as an empty string while
    they are being edited in the browser.  Treating that UI sentinel as a model
    value eventually reaches calls such as ``float("")``.  Omission is the
    intended contract: the constructor then receives ``None`` or its documented
    default.  Keep non-empty strings intact because many model choices are
    intentionally string-valued.
    """
    return {
        key: value
        for key, value in params.items()
        if not (isinstance(value, str) and not value.strip())
    }


def _part_exclusion(spec):
    """Return an authored exclusion reason when a BOM line is non-calculable."""
    if not spec.calculation_enabled:
        return (
            spec.calculation_exclusion_reason
            or "This imported BOM line is excluded until its component mapping is confirmed."
        )
    if spec.population_status == "dnp":
        return "This BOM line is marked do-not-populate (DNP)."
    if spec.bom_mapping is not None and spec.bom_mapping.status != "confirmed":
        return "This imported BOM line is excluded until its component mapping is confirmed."
    return None


def _vita_applies(category, params):
    """Return whether A/V51.1 has a rule for this particular line item."""
    params = _clean_part_params(params)
    if category != "parts_count":
        return category in _VITA_CATEGORIES
    if params.get("manufacturer_rate_fpmh") is not None:
        return True
    recipe = PARTS_COUNT_RECIPES.get(params.get("part_type"))
    return recipe is not None and recipe.family in {
        "microcircuit", "non_rf_semiconductor", "hf_diode", "rf_transistor",
    }

# Temperature constructor-parameter names vary by part class / standard.
# (e.g. MIL-HDBK-217F Microcircuit uses ``T_junction``, Resistor uses
# ``case_temperature_c``; Telcordia/217Plus/FIDES use ``temperature``.)
_TEMP_PARAM_CANDIDATES = (
    "T_junction", "T_ambient", "case_temperature_c",
    "channel_temperature_c", "T_case", "T_hotspot", "frame_temperature",
    "T_insert", "temperature",
)


def _accepts_param(cls, parameter):
    """Whether *cls* explicitly accepts a constructor parameter."""
    import inspect
    try:
        params = inspect.signature(cls.__init__).parameters
    except (ValueError, TypeError):
        return False
    return parameter in params


def _temp_param_for(cls):
    """Return the name of *cls*'s temperature constructor parameter, or None.

    Inspects the constructor signature for a known temperature parameter
    name.  Classes that forward ``**kwargs`` to a base accepting
    ``temperature`` (Telcordia / FIDES / 217Plus) map to ``temperature``.
    """
    import inspect
    try:
        params = inspect.signature(cls.__init__).parameters
    except (ValueError, TypeError):
        return None
    for name in _TEMP_PARAM_CANDIDATES:
        if name in params:
            return name
    if any(p.kind == p.VAR_KEYWORD for p in params.values()):
        return "temperature"
    return None

# ---------------------------------------------------------------------------
# Lazy-loaded standard modules (avoid import errors if not installed)
# ---------------------------------------------------------------------------
_telcordia_classes = None
_plus217_classes = None
_fides_classes = None
_nswc_classes = None
_eprd_classes = None
_nprd_classes = None


def _get_telcordia():
    global _telcordia_classes
    if _telcordia_classes is None:
        from reliability import Telcordia as _tc
        _telcordia_classes = {
            'ic_digital': _tc.IC_Digital,
            'ic_linear': _tc.IC_Linear,
            'ic_memory': _tc.IC_Memory,
            'ic_microprocessor': _tc.IC_Microprocessor,
            'diode': _tc.Diode,
            'transistor_bjt': _tc.Transistor_BJT,
            'transistor_fet': _tc.Transistor_FET,
            'resistor': _tc.Resistor,
            'capacitor': _tc.Capacitor,
            'inductor': _tc.Inductor,
            'transformer': _tc.Transformer,
            'relay': _tc.Relay,
            'switch': _tc.Switch,
            'connector': _tc.Connector,
            'crystal': _tc.Crystal,
            'fuse': _tc.Fuse,
            'pcb': _tc.PCB,
        }
    return _telcordia_classes


def _get_217plus():
    global _plus217_classes
    if _plus217_classes is None:
        from reliability import MIL_HDBK_217Plus as _p
        _plus217_classes = {
            'microcircuit': _p.Microcircuit,
            'discrete_semiconductor': _p.Discrete_Semiconductor,
            'resistor': _p.Resistor,
            'capacitor': _p.Capacitor,
            'inductor': _p.Inductor,
            'relay': _p.Relay,
            'switch': _p.Switch,
            'connector': _p.Connector,
            'pcb': _p.PCB,
            'crystal': _p.Crystal,
            'fuse': _p.Fuse,
            'rotating': _p.Rotating,
        }
    return _plus217_classes


def _get_fides():
    global _fides_classes
    if _fides_classes is None:
        from reliability import FIDES as _f
        _fides_classes = {
            'ic': _f.IC,
            'discrete': _f.Discrete,
            'passive_resistor': _f.Passive_Resistor,
            'passive_capacitor': _f.Passive_Capacitor,
            'passive_inductor': _f.Passive_Inductor,
            'connector': _f.Connector,
            'pcb': _f.PCB,
            'relay': _f.Relay,
            'switch': _f.Switch,
            'crystal': _f.Crystal,
        }
    return _fides_classes


def _get_nswc():
    global _nswc_classes
    if _nswc_classes is None:
        from reliability import NSWC as _n
        _nswc_classes = {
            'spring': _n.Spring,
            'bearing': _n.Bearing,
            'gear': _n.Gear,
            'seal': _n.Seal,
            'valve': _n.Valve,
            'actuator': _n.Actuator,
            'pump': _n.Pump,
            'filter_mech': _n.Filter,
            'coupling': _n.Coupling,
            'brake_clutch': _n.BrakeClutch,
            'electric_motor': _n.ElectricMotor,
            'belt_chain': _n.BeltChain,
            'hydraulic_line': _n.Hydraulic_Pneumatic_Line,
        }
    return _nswc_classes


def _get_eprd():
    global _eprd_classes
    if _eprd_classes is None:
        from reliability import NPRD_EPRD as _r
        _eprd_classes = dict(_r.EPRD_CLASSES)
    return _eprd_classes


def _get_nprd():
    global _nprd_classes
    if _nprd_classes is None:
        from reliability import NPRD_EPRD as _r
        _nprd_classes = dict(_r.NPRD_CLASSES)
    return _nprd_classes


def _standard_environments(standard):
    """Return the environment vocabulary, or None when it is not applicable."""
    if standard in ("MIL-HDBK-217F", "217Plus"):
        return set(ENVIRONMENTS)
    if standard == "Telcordia":
        from reliability.Telcordia import ENVIRONMENTS as environments
        return set(environments)
    if standard == "NSWC":
        from reliability.NSWC import ENVIRONMENTS as environments
        return set(environments)
    if standard in ("EPRD-2014", "NPRD-2023"):
        from reliability.NPRD_EPRD import ENVIRONMENTS as environments
        return set(environments)
    return None


def _prediction_hierarchy_contexts(standard, global_environment, parts_spec, blocks):
    """Validate a block tree and resolve inherited service-life exposure.

    Operating handbook environments and RADC-TR-85-91 nonoperating
    environments are deliberately distinct vocabularies.  This resolver only
    validates the former; the RADC calculation validates the latter against
    its own tables.
    """
    block_by_id = {}
    for block in blocks:
        if block.id in block_by_id:
            raise HTTPException(status_code=400,
                                detail=f"Duplicate System Block id '{block.id}'.")
        if not block.name.strip():
            raise HTTPException(status_code=400,
                                detail=f"System Block '{block.id}' needs a name.")
        block_by_id[block.id] = block

    for block in blocks:
        if block.parent_id is not None and block.parent_id not in block_by_id:
            raise HTTPException(
                status_code=400,
                detail=f"System Block '{block.id}' references missing parent '{block.parent_id}'.",
            )
        if block.parent_id == block.id:
            raise HTTPException(status_code=400,
                                detail=f"System Block '{block.id}' cannot contain itself.")
    for index, part in enumerate(parts_spec):
        if part.parent_id is not None and part.parent_id not in block_by_id:
            raise HTTPException(
                status_code=400,
                detail=f"Part {index + 1} references missing System Block '{part.parent_id}'.",
            )

    allowed_environments = _standard_environments(standard)
    if allowed_environments is not None:
        for label, value in [("global", global_environment), *(
            (f"block '{block.id}' operating", block.environment)
            for block in blocks
        ), *(
            (f"part {index + 1}", part.environment)
            for index, part in enumerate(parts_spec)
        )]:
            if value is not None and value not in allowed_environments:
                choices = ", ".join(sorted(allowed_environments))
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid {label} environment '{value}' for {standard}; choose {choices}.",
                )

    contexts = {}
    visiting = set()

    def resolve(block_id):
        if block_id in contexts:
            return contexts[block_id]
        if block_id in visiting:
            raise HTTPException(status_code=400,
                                detail="System Block hierarchy contains a cycle.")
        visiting.add(block_id)
        block = block_by_id[block_id]
        parent = resolve(block.parent_id) if block.parent_id is not None else {
            "quantity_multiplier": 1,
            "effective_operating_fraction": 1.0,
            "operating_environment": global_environment,
            "explicit_nonoperating_environment": None,
            "explicit_nonoperating_temperature_c": None,
            "explicit_power_cycles_per_1000_nonoperating_hours": None,
        }
        operating = block.environment or parent["operating_environment"]
        nonoperating_environment = (
            block.nonoperating_environment
            or parent["explicit_nonoperating_environment"]
        )
        nonoperating_temperature = (
            block.nonoperating_temperature_c
            if block.nonoperating_temperature_c is not None
            else parent["explicit_nonoperating_temperature_c"]
        )
        power_cycles = (
            block.power_cycles_per_1000_nonoperating_hours
            if block.power_cycles_per_1000_nonoperating_hours is not None
            else parent[
                "explicit_power_cycles_per_1000_nonoperating_hours"]
        )
        if standard == "MIL-HDBK-217F":
            effective_fraction = (
                parent["effective_operating_fraction"]
                * block.operating_fraction
            )
        else:
            if block.operating_fraction < 1:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Nonoperating System Block exposure is available only "
                        "through the RADC-TR-85-91 extension to "
                        "MIL-HDBK-217F."
                    ),
                )
            effective_fraction = 1.0

        if effective_fraction < 1:
            missing = []
            if nonoperating_environment is None:
                missing.append("nonoperating environment")
            if nonoperating_temperature is None:
                missing.append("nonoperating temperature")
            if power_cycles is None:
                missing.append("power cycles per 1,000 nonoperating hours")
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"System Block '{block.id}' has nonoperating exposure "
                        f"but is missing {', '.join(missing)}. Enter an explicit "
                        "zero for the power-cycle rate when no cycles occur."
                    ),
                )
        context = {
            "quantity_multiplier": parent["quantity_multiplier"] * block.quantity,
            "ancestor_quantity_multiplier": parent["quantity_multiplier"],
            "effective_operating_fraction": effective_fraction,
            "operating_environment": operating,
            "explicit_nonoperating_environment": nonoperating_environment,
            "nonoperating_environment": nonoperating_environment,
            "explicit_nonoperating_temperature_c": nonoperating_temperature,
            "nonoperating_temperature_c": nonoperating_temperature,
            "explicit_power_cycles_per_1000_nonoperating_hours": power_cycles,
            "power_cycles_per_1000_nonoperating_hours": power_cycles,
        }
        contexts[block_id] = context
        visiting.remove(block_id)
        return context

    for block in blocks:
        resolve(block.id)

    part_contexts = []
    for part in parts_spec:
        if part.parent_id is None:
            operating = part.environment or global_environment
            part_contexts.append({
                "effective_operating_fraction": 1.0,
                "operating_environment": operating,
                "nonoperating_environment": None,
                "nonoperating_temperature_c": None,
                "power_cycles_per_1000_nonoperating_hours": None,
                "block_quantity_multiplier": 1,
            })
            continue
        block_context = contexts[part.parent_id]
        operating = part.environment or block_context["operating_environment"]
        part_contexts.append({
            "effective_operating_fraction": block_context[
                "effective_operating_fraction"],
            "operating_environment": operating,
            "nonoperating_environment": block_context[
                "nonoperating_environment"],
            "nonoperating_temperature_c": block_context[
                "nonoperating_temperature_c"],
            "power_cycles_per_1000_nonoperating_hours": block_context[
                "power_cycles_per_1000_nonoperating_hours"],
            "block_quantity_multiplier": block_context["quantity_multiplier"],
        })
    return block_by_id, contexts, part_contexts


def _apply_prediction_hierarchy(
    *, standard, global_environment, parts_spec, blocks, results,
    nonoperating_results,
):
    """Apply service-life exposure, user overrides, and nested roll-up.

    A missing nonoperating model is never replaced with an operating handbook
    calculation or a blanket multiplier.  The operating result remains
    visible, while the affected service-life roll-up is unavailable unless a
    documented user override supplies the missing rate.
    """
    block_by_id, contexts, part_contexts = _prediction_hierarchy_contexts(
        standard, global_environment, parts_spec, blocks)

    for index, (spec, row, context) in enumerate(zip(parts_spec, results, part_contexts)):
        if row.get("incompatible"):
            continue
        operating_rate = float(row["failure_rate"])
        operating_fraction = float(context["effective_operating_fraction"])
        nonoperating = dict(nonoperating_results.get(index) or {})

        if operating_fraction >= 1.0:
            nonoperating = {
                "status": "not_required",
                "source": "RADC-TR-85-91",
                "failure_rate": None,
                "reason": "The effective operating fraction is 1.0.",
                "warnings": [],
            }
            nonoperating_rate = None
            calculated_rate = operating_rate
            service_available = True
        elif spec.nonoperating_rate_override_enabled:
            nonoperating_rate = float(spec.nonoperating_rate_override_fpmh)
            nonoperating = {
                "status": "user_override",
                "source": spec.nonoperating_rate_source,
                "source_type": spec.nonoperating_rate_source_type,
                "failure_rate": nonoperating_rate,
                "model": "user_supplied_nonoperating_rate",
                "traceability": {
                    "standard": "User-supplied evidence",
                    "section": "Nonoperating-rate override",
                    "model": "Documented user override",
                    "unit": "failures per million nonoperating hours",
                    "source": spec.nonoperating_rate_source,
                    "source_type": spec.nonoperating_rate_source_type,
                },
                "factors": {},
                "steps": [],
                "assumptions": [],
                "warnings": [
                    "The RADC-TR-85-91 model was bypassed by a documented "
                    "user-supplied nonoperating rate."
                ],
            }
            calculated_rate = (
                operating_fraction * operating_rate
                + (1.0 - operating_fraction) * nonoperating_rate
            )
            service_available = True
        elif nonoperating.get("failure_rate") is not None:
            nonoperating_rate = float(nonoperating["failure_rate"])
            calculated_rate = (
                operating_fraction * operating_rate
                + (1.0 - operating_fraction) * nonoperating_rate
            )
            service_available = True
        else:
            nonoperating_rate = None
            calculated_rate = None
            service_available = False

        override_applied = bool(spec.failure_rate_override_enabled)
        effective_rate = (
            float(spec.failure_rate_override_fpmh)
            if override_applied else calculated_rate
        )
        if override_applied:
            service_available = True
        line_total = (
            effective_rate * spec.quantity
            if effective_rate is not None else None
        )
        calculated_line_total = (
            calculated_rate * spec.quantity
            if calculated_rate is not None else None
        )
        expanded_total = (
            line_total * context["block_quantity_multiplier"]
            if line_total is not None else None
        )
        row_warnings = list(row.get("warnings", []))
        row_warnings.extend(nonoperating.get("warnings", []))
        if not service_available:
            row_warnings.append(
                nonoperating.get("reason")
                or "No supported RADC-TR-85-91 nonoperating model is "
                   "available. Supply a documented nonoperating-rate override."
            )
        row.update({
            "parent_id": spec.parent_id,
            "operating_environment": context["operating_environment"],
            "nonoperating_environment": context["nonoperating_environment"],
            "nonoperating_temperature_c": context[
                "nonoperating_temperature_c"],
            "power_cycles_per_1000_nonoperating_hours": context[
                "power_cycles_per_1000_nonoperating_hours"],
            "effective_operating_fraction": round(operating_fraction, 12),
            "operating_failure_rate_fpmh": round(operating_rate, 8),
            "nonoperating_failure_rate_fpmh": (
                round(nonoperating_rate, 8)
                if nonoperating_rate is not None else None
            ),
            "service_failure_rate_fpmh": (
                round(effective_rate, 8)
                if effective_rate is not None else None
            ),
            "rate_time_basis": "calendar_hours",
            "service_rate_available": service_available,
            "operating_calculated_failure_rate": round(operating_rate, 8),
            "nonoperating_calculated_failure_rate": (
                round(nonoperating_rate, 8)
                if nonoperating_rate is not None else None
            ),
            "calculated_failure_rate": (
                round(calculated_rate, 8)
                if calculated_rate is not None else None
            ),
            "calculated_total_failure_rate": (
                round(calculated_line_total, 8)
                if calculated_line_total is not None else None
            ),
            "failure_rate_override_enabled": override_applied,
            "failure_rate_override_fpmh": spec.failure_rate_override_fpmh,
            "override_applied": override_applied,
            # Compatibility aliases used by existing table/report components;
            # their semantics are now explicitly the service-life result.
            "failure_rate": (
                round(effective_rate, 8)
                if effective_rate is not None else None
            ),
            "line_total_failure_rate": (
                round(line_total, 8) if line_total is not None else None
            ),
            "total_failure_rate": (
                round(line_total, 8) if line_total is not None else None
            ),
            "block_quantity_multiplier": context["block_quantity_multiplier"],
            "system_expanded_failure_rate": (
                round(expanded_total, 8)
                if expanded_total is not None else None
            ),
            "nonoperating_calculation": nonoperating,
            "warnings": row_warnings,
            "output_adjustment": {
                "formula": (
                    "lambda_service = f_operating*lambda_operating + "
                    "(1-f_operating)*lambda_nonoperating"
                ),
                "operating_fraction": round(operating_fraction, 12),
                "calculated_failure_rate": (
                    round(calculated_rate, 8)
                    if calculated_rate is not None else None
                ),
                "override_applied": override_applied,
                "override_failure_rate": spec.failure_rate_override_fpmh,
                "effective_failure_rate": (
                    round(effective_rate, 8)
                    if effective_rate is not None else None
                ),
            },
        })

    child_blocks = {block.id: [] for block in blocks}
    direct_parts = {block.id: [] for block in blocks}
    root_parts = []
    root_blocks = []
    for block in blocks:
        if block.parent_id is None:
            root_blocks.append(block.id)
        else:
            child_blocks[block.parent_id].append(block.id)
    for index, spec in enumerate(parts_spec):
        if spec.parent_id is None:
            root_parts.append(index)
        else:
            direct_parts[spec.parent_id].append(index)

    block_results_by_id = {}

    def roll_up(block_id):
        block = block_by_id[block_id]
        operating_subtotal = 0.0
        rolled_subtotal = 0.0
        subtotal_available = True
        for index in direct_parts[block_id]:
            row = results[index]
            if row.get("incompatible"):
                continue
            operating_subtotal += (
                float(row["operating_failure_rate_fpmh"])
                * parts_spec[index].quantity
            )
            if row["line_total_failure_rate"] is None:
                subtotal_available = False
            else:
                rolled_subtotal += float(row["line_total_failure_rate"])
        for child_id in child_blocks[block_id]:
            child = roll_up(child_id)
            child_spec = block_by_id[child_id]
            operating_subtotal += (
                child["operating_handbook_subtotal_failure_rate"]
                * child_spec.quantity
            )
            if child["failure_rate"] is None:
                subtotal_available = False
            else:
                rolled_subtotal += child["failure_rate"] * child_spec.quantity
        override_applied = bool(block.failure_rate_override_enabled)
        effective = (
            float(block.failure_rate_override_fpmh)
            if override_applied
            else rolled_subtotal if subtotal_available else None
        )
        context = contexts[block_id]
        result = {
            "id": block.id,
            "name": block.name,
            "parent_id": block.parent_id,
            "notes": block.notes,
            "quantity": block.quantity,
            "operating_fraction": block.operating_fraction,
            "effective_operating_fraction": round(
                context["effective_operating_fraction"], 12),
            "operating_environment": context["operating_environment"],
            "nonoperating_environment": context["nonoperating_environment"],
            "nonoperating_temperature_c": context[
                "nonoperating_temperature_c"],
            "power_cycles_per_1000_nonoperating_hours": context[
                "power_cycles_per_1000_nonoperating_hours"],
            "operating_handbook_subtotal_failure_rate": round(
                operating_subtotal, 8),
            "handbook_subtotal_failure_rate": round(operating_subtotal, 8),
            "rolled_up_failure_rate": (
                round(rolled_subtotal, 8) if subtotal_available else None
            ),
            "service_rate_available": effective is not None,
            "rate_time_basis": "calendar_hours",
            "failure_rate_override_enabled": override_applied,
            "failure_rate_override_fpmh": block.failure_rate_override_fpmh,
            "override_applied": override_applied,
            "failure_rate": round(effective, 8) if effective is not None else None,
            "service_failure_rate_fpmh": (
                round(effective, 8) if effective is not None else None
            ),
            "total_failure_rate": (
                round(effective * block.quantity, 8)
                if effective is not None else None
            ),
            "system_expanded_failure_rate": (
                round(effective * context["quantity_multiplier"], 8)
                if effective is not None else None
            ),
            "descendant_part_indices": [
                index for index, spec in enumerate(parts_spec)
                if _part_is_within_block(spec.parent_id, block_id, block_by_id)
            ],
        }
        block_results_by_id[block_id] = result
        return result

    for root_id in root_blocks:
        roll_up(root_id)

    def overriding_ancestor(block_id, include_self=True):
        cursor = block_id
        if not include_self and cursor is not None:
            cursor = block_by_id[cursor].parent_id
        while cursor is not None:
            if block_by_id[cursor].failure_rate_override_enabled:
                return cursor
            cursor = block_by_id[cursor].parent_id
        return None

    system_total = 0.0
    system_available = True
    for index in root_parts:
        row = results[index]
        if not row.get("incompatible"):
            if row["line_total_failure_rate"] is None:
                system_available = False
            else:
                system_total += float(row["line_total_failure_rate"])
    for root_id in root_blocks:
        root = block_results_by_id[root_id]
        if root["failure_rate"] is None:
            system_available = False
        else:
            system_total += (
                float(root["failure_rate"])
                * block_by_id[root_id].quantity
            )

    effective_system_total = system_total if system_available else None

    for index, (spec, row) in enumerate(zip(parts_spec, results)):
        if row.get("incompatible"):
            continue
        superseding = overriding_ancestor(spec.parent_id) if spec.parent_id else None
        contribution_rate = (
            0.0 if superseding
            else row["system_expanded_failure_rate"]
        )
        row["superseded_by_block_id"] = superseding
        row["included_in_system_total"] = superseding is None
        row["system_contribution_failure_rate"] = (
            round(float(contribution_rate), 8)
            if contribution_rate is not None else None
        )
        row["contribution"] = (
            round(float(contribution_rate) / system_total, 8)
            if (contribution_rate is not None and system_available
                and system_total > 0) else 0.0
        )

    for block_id, block_result in block_results_by_id.items():
        superseding = overriding_ancestor(block_id, include_self=False)
        contribution_rate = (
            0.0 if superseding
            else block_result["system_expanded_failure_rate"]
        )
        block_result["superseded_by_block_id"] = superseding
        block_result["included_in_system_total"] = superseding is None
        block_result["system_contribution_failure_rate"] = (
            round(float(contribution_rate), 8)
            if contribution_rate is not None else None
        )
        block_result["contribution"] = (
            round(float(contribution_rate) / system_total, 8)
            if (contribution_rate is not None and system_available
                and system_total > 0) else 0.0
        )

    warnings = []
    if not system_available:
        warnings.append(
            "The service-life system rate is unavailable because at least one "
            "included part lacks a supported RADC-TR-85-91 nonoperating model. "
            "Operating handbook results remain available; supply documented "
            "nonoperating-rate overrides for the identified parts."
        )
    return {
        "total_failure_rate": effective_system_total,
        "service_failure_rate_fpmh": effective_system_total,
        "service_rate_available": system_available,
        "rate_time_basis": "calendar_hours",
        "mtbf_hours": (
            round(1e6 / system_total, 1)
            if system_available and system_total > 0 else None
        ),
        "blocks": [block_results_by_id[block.id] for block in blocks],
        "warnings": warnings,
    }


def _part_is_within_block(parent_id, block_id, block_by_id):
    seen = set()
    cursor = parent_id
    while cursor is not None and cursor not in seen:
        if cursor == block_id:
            return True
        seen.add(cursor)
        cursor = block_by_id[cursor].parent_id
    return False


# ---------------------------------------------------------------------------
# Standard endpoints
# ---------------------------------------------------------------------------

@router.get("/options")
def options():
    return {
        "environments": [
            {"code": e, "description": ENVIRONMENT_DESCRIPTIONS[e]}
            for e in ENVIRONMENTS
        ],
        "nonoperating_environments": [
            {
                "code": environment,
                "description": NONOPERATING_ENVIRONMENT_DESCRIPTIONS[
                    environment],
            }
            for environment in NONOPERATING_ENVIRONMENTS
        ],
        "nonoperating_models": NONOPERATING_MODEL_CATALOG,
        "nonoperating_automatic_models": AUTOMATIC_MODEL_INPUTS,
        "standards": list(STANDARDS) + ["Telcordia", "217Plus", "FIDES", "NSWC",
                                        "NPRD-2023", "EPRD-2014"],
        "categories": list(_PART_CLASSES),
    }


@router.get("/parts-count-catalog")
def get_parts_count_catalog():
    """Return every Appendix A line-item recipe and its quality choices."""
    return {
        "standard": "MIL-HDBK-217F Notice 2",
        "method": "Appendix A parts count",
        "parts": parts_count_catalog(),
    }


@router.get("/standards")
def list_standards():
    """List all supported prediction standards and their categories."""
    standards = {
        "MIL-HDBK-217F": {
            "name": "MIL-HDBK-217F Notice 2",
            "description": "US Military standard for electronic equipment reliability prediction",
            "categories": list(_PART_CLASSES),
        },
    }
    try:
        standards["Telcordia"] = {
            "name": "Telcordia SR-332 Issue 4",
            "description": "Telecommunications industry reliability prediction",
            "categories": list(_get_telcordia()),
        }
    except Exception:
        pass
    try:
        standards["217Plus"] = {
            "name": "217Plus (RIAC)",
            "description": "Modernized successor to MIL-HDBK-217F with process grade factors",
            "categories": list(_get_217plus()),
        }
    except Exception:
        pass
    try:
        standards["FIDES"] = {
            "name": "FIDES Guide 2022",
            "description": "European physics-of-failure methodology with process assessment",
            "categories": list(_get_fides()),
        }
    except Exception:
        pass
    try:
        standards["NSWC"] = {
            "name": "NSWC-98/LE1",
            "description": "Mechanical equipment reliability prediction (springs, bearings, gears, seals, etc.)",
            "categories": list(_get_nswc()),
        }
    except Exception:
        pass
    try:
        standards["EPRD-2014"] = {
            "name": "EPRD-2014 (Quanterion/RIAC)",
            "description": "Empirical field-experience failure rates for electronic parts",
            "categories": list(_get_eprd()),
        }
    except Exception:
        pass
    try:
        standards["NPRD-2023"] = {
            "name": "NPRD-2023 (Quanterion/RIAC)",
            "description": "Empirical field-experience failure rates for nonelectronic/mechanical parts",
            "categories": list(_get_nprd()),
        }
    except Exception:
        pass
    for standard_id, info in standards.items():
        disclosure = get_standard_disclosure(standard_id)
        info["methodology"] = disclosure
        info["conformance_tier"] = disclosure["conformance_tier"]
        info["conformance_label"] = disclosure["tier_definition"]["label"]
    # VITA is a supplement selected within the 217F workflow rather than a
    # standalone multi-standard model, but it still needs its own disclosure.
    vita = get_standard_disclosure("VITA-51.1")
    standards["VITA-51.1"] = {
        "name": "ANSI/VITA 51.1-2013 (R2018) supplement",
        "description": "Complete A/V51.1 R2018 defaults, mappings, conversions, and alternate PTH method",
        "categories": sorted(_VITA_CATEGORIES),
        "methodology": vita,
        "conformance_tier": vita["conformance_tier"],
        "conformance_label": vita["tier_definition"]["label"],
    }
    return standards


def _merge_results(n_parts, valid_indices, computed, skipped):
    """Interleave computed result rows with placeholder rows for skipped parts,
    preserving the original part ordering so the UI keeps row ↔ result
    alignment. `skipped` maps a part index to its {name, category, error}."""
    by_index = dict(zip(valid_indices, computed))
    out = []
    for i in range(n_parts):
        if i in by_index:
            out.append(by_index[i])
        else:
            info = skipped.get(i, {})
            out.append({
                "name": info.get("name", ""),
                "category": info.get("category", ""),
                "quantity": 0,
                "failure_rate": 0.0,
                "total_failure_rate": 0.0,
                "contribution": 0.0,
                "pi_factors": {},
                "incompatible": True,
                "excluded": bool(info.get("excluded")),
                "mapping_status": info.get("mapping_status"),
                "error": info.get("error", "Could not be computed."),
            })
    return out


@router.post("/predict")
def predict(req: PredictionRequest):
    """MIL-HDBK-217F part stress prediction (original endpoint)."""
    if not req.parts and not any(
            block.failure_rate_override_enabled for block in req.blocks):
        raise HTTPException(
            status_code=400,
            detail="Add at least one part or an enabled System Block override.",
        )

    # Build the list of computable parts, but never abort the whole prediction
    # because one line item is unsupported or misconfigured: incompatible parts
    # are recorded and surfaced per-row so the user sees exactly what failed
    # while the rest of the system is still computed (#3).
    _, _, part_contexts = _prediction_hierarchy_contexts(
        "MIL-HDBK-217F", req.environment, req.parts, req.blocks)
    parts = []                 # successfully instantiated operating parts
    valid_indices = []         # their positions in req.parts
    vita_flags = []            # parallel to `parts`
    base_parts = []            # parallel to `parts`
    model_inputs = []          # effective constructor values, parallel to `parts`
    skipped = {}               # index -> {name, category, error}

    for i, (spec, exposure) in enumerate(zip(req.parts, part_contexts)):
        name = spec.name or f"{spec.category} {i + 1}"
        exclusion = _part_exclusion(spec)
        if exclusion:
            skipped[i] = {
                "name": name, "category": spec.category,
                "error": exclusion, "excluded": True,
                "mapping_status": (
                    spec.bom_mapping.status if spec.bom_mapping else None),
            }
            continue
        cls = _PART_CLASSES.get(spec.category)
        if cls is None:
            skipped[i] = {"name": name, "category": spec.category,
                          "error": f"Part category '{spec.category}' is not "
                                   f"supported by MIL-HDBK-217F."}
            continue
        vita = req.vita_global if spec.apply_vita is None else spec.apply_vita
        vita_applicable = _vita_applies(spec.category, spec.params)
        kwargs = _clean_part_params(spec.params)
        kwargs["name"] = name
        kwargs["quantity"] = spec.quantity
        has_env = _accepts_param(cls, "environment")
        supports_standard = _accepts_param(cls, "standard")
        if has_env:
            kwargs["environment"] = exposure["operating_environment"]
        if supports_standard:
            kwargs["standard"] = (
                "VITA-51.1" if vita and vita_applicable
                else "MIL-HDBK-217F"
            )
        try:
            part = cls(**kwargs)
        except (TypeError, ValueError) as e:
            skipped[i] = {"name": name, "category": spec.category, "error": str(e)}
            continue
        if vita and vita_applicable:
            annotate_vita_result(part, spec.category)
        parts.append(part)
        valid_indices.append(i)
        model_inputs.append(effective_model_inputs(cls, kwargs))
        part_vita = vita and vita_applicable
        vita_flags.append(part_vita)
        if part_vita:
            base_kwargs = dict(kwargs)
            base_kwargs["standard"] = "MIL-HDBK-217F"
            try:
                base_parts.append(cls(**base_kwargs))
            except (TypeError, ValueError):
                base_parts.append(None)
        else:
            base_parts.append(None)

    computed = []
    total_failure_rate = 0.0
    mtbf_hours = None
    nonoperating_by_index = {}
    if parts:
        # ValueError → 400 via the global exception handler in main.py
        system = SystemFailureRate(parts)
        computed = system.results
        for row, vita, base, inputs in zip(computed, vita_flags, base_parts, model_inputs):
            row["vita"] = vita
            if vita and base is not None:
                row["base_pi_factors"] = base.pi_factors
                row["base_failure_rate"] = round(base.failure_rate, 6)
                row["base_total_failure_rate"] = round(base.total_failure_rate, 6)
            row["parameter_impacts"] = build_parameter_impacts(
                "MIL-HDBK-217F",
                row["category"],
                row.get("pi_factors"),
                row.get("calculation_steps"),
                row.get("base_pi_factors"),
            )
            add_equation_symbol_bindings(
                row, category=row["category"], effective_inputs=inputs,
            )
        for index in valid_indices:
            context = part_contexts[index]
            if context["effective_operating_fraction"] < 1:
                nonoperating_by_index[index] = calculate_nonoperating(
                    req.parts[index], context)
    # Re-assemble results positionally (placeholder row for each skipped part)
    # so the front-end can keep row ↔ result alignment and highlight failures.
    results = _merge_results(len(req.parts), valid_indices, computed, skipped)
    hierarchy = _apply_prediction_hierarchy(
        standard="MIL-HDBK-217F",
        global_environment=req.environment,
        parts_spec=req.parts,
        blocks=req.blocks,
        results=results,
        nonoperating_results=nonoperating_by_index,
    )
    total_failure_rate = hierarchy["total_failure_rate"]
    mtbf_hours = hierarchy["mtbf_hours"]

    response = {
        "environment": req.environment,
        "standard": "MIL-HDBK-217F",
        "vita_global": req.vita_global,
        "total_failure_rate": (
            round(total_failure_rate, 6)
            if total_failure_rate is not None else None
        ),
        "service_failure_rate_fpmh": (
            round(total_failure_rate, 6)
            if total_failure_rate is not None else None
        ),
        "service_rate_available": hierarchy["service_rate_available"],
        "rate_time_basis": "calendar_hours",
        "mtbf_hours": mtbf_hours,
        "results": results,
        "blocks": hierarchy["blocks"],
        "incompatible": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
            if not info.get("excluded")
        ],
        "excluded_parts": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
            if info.get("excluded")
        ],
        "excluded_part_count": sum(
            1 for info in skipped.values() if info.get("excluded")),
        "methodology": get_standard_disclosure("MIL-HDBK-217F"),
        "warnings": list(hierarchy["warnings"]),
        "result_context": (
            "MIL-HDBK-217F provides the operating planning estimate. When "
            "operating exposure is below 100%, the calendar-time service rate "
            "uses the separately identified RADC-TR-85-91 nonoperating "
            "extension; it is not a field-rate forecast without representative "
            "test or field evidence."
        ),
    }
    excluded_count = response["excluded_part_count"]
    if excluded_count:
        response["warnings"].append(
            f"{excluded_count} part line(s) were excluded from the prediction "
            "because they are disabled, unconfirmed, or DNP."
        )
    methodology_supplements = []
    if any(
        context["effective_operating_fraction"] < 1
        for context in part_contexts
    ):
        methodology_supplements.append(
            get_standard_disclosure("RADC-TR-85-91"))
    if any(vita_flags):
        methodology_supplements.append(get_standard_disclosure("VITA-51.1"))
        vita_wearout_categories = {"pth_assembly", "surface_mount_assembly"}
        if any(
            flag and req.parts[index].category in vita_wearout_categories
            for index, flag in zip(valid_indices, vita_flags)
        ) and any(
            req.parts[index].category not in vita_wearout_categories
            for index in valid_indices
        ):
            response["warnings"].append(
                "A/V51.1 Rule 2.3.5-1 permits combining wearout/physics-of-failure "
                "and random-rate models only using the ANSI/VITA 51.2 mixing "
                "method. This roll-up is an arithmetic rate sum and must not be "
                "represented as a compliant mixed-method MTBF without that analysis."
            )
    if methodology_supplements:
        response["methodology_supplements"] = methodology_supplements
    return response


# ---------------------------------------------------------------------------
# Multi-standard prediction
# ---------------------------------------------------------------------------

def _predict_standard(standard: str, parts_spec, environment: str, blocks=None,
                      process_grade: int = 3, process_score: float = 50.0,
                      part_manufacturing: str = 'standard'):
    """Instantiate parts for a given standard and compute system failure rate."""

    if standard == "MIL-HDBK-217F":
        class_map = _PART_CLASSES
    elif standard == "Telcordia":
        class_map = _get_telcordia()
    elif standard == "217Plus":
        class_map = _get_217plus()
    elif standard == "FIDES":
        class_map = _get_fides()
    elif standard == "NSWC":
        class_map = _get_nswc()
    elif standard == "EPRD-2014":
        class_map = _get_eprd()
    elif standard == "NPRD-2023":
        class_map = _get_nprd()
    else:
        raise HTTPException(status_code=400,
                            detail=f"Unknown standard '{standard}'. "
                                   f"Valid: MIL-HDBK-217F, Telcordia, 217Plus, FIDES, "
                                   f"NSWC, EPRD-2014, NPRD-2023")

    # Parts whose category is unsupported by this standard (or that fail to
    # instantiate) are recorded and surfaced per-row rather than aborting the
    # whole prediction (#3). The rest of the system is still computed.
    blocks = blocks or []
    _, _, part_contexts = _prediction_hierarchy_contexts(
        standard, environment, parts_spec, blocks)
    parts = []
    model_inputs = []
    valid_indices = []
    skipped = {}
    for i, (spec, exposure) in enumerate(zip(parts_spec, part_contexts)):
        name = spec.name or f"{spec.category} {i + 1}"
        exclusion = _part_exclusion(spec)
        if exclusion:
            skipped[i] = {
                "name": name, "category": spec.category,
                "error": exclusion, "excluded": True,
                "mapping_status": (
                    spec.bom_mapping.status if spec.bom_mapping else None),
            }
            continue
        cls = class_map.get(spec.category)
        if cls is None:
            skipped[i] = {"name": name, "category": spec.category,
                          "error": f"Part category '{spec.category}' is not "
                                   f"supported by {standard}."}
            continue
        kwargs = _clean_part_params(spec.params)
        kwargs["name"] = name
        kwargs["quantity"] = spec.quantity

        if standard == "MIL-HDBK-217F":
            if _accepts_param(cls, "environment"):
                kwargs["environment"] = exposure["operating_environment"]
        elif standard == "Telcordia":
            kwargs["environment"] = exposure["operating_environment"]
        elif standard == "217Plus":
            kwargs["environment"] = exposure["operating_environment"]
            kwargs["process_grade"] = process_grade
        elif standard == "FIDES":
            kwargs["process_score"] = process_score
            kwargs["part_manufacturing"] = part_manufacturing
        elif standard == "NSWC":
            kwargs["environment"] = exposure["operating_environment"]
        elif standard in ("EPRD-2014", "NPRD-2023"):
            kwargs["environment"] = exposure["operating_environment"]

        try:
            part = cls(**kwargs)
            parts.append(part)
            model_inputs.append(effective_model_inputs(cls, kwargs))
            valid_indices.append(i)
        except (TypeError, ValueError) as e:
            skipped[i] = {"name": name, "category": spec.category, "error": str(e)}

    total_fr = sum(p.total_failure_rate for p in parts)
    computed = []

    def result_row(p, inputs):
        row = {
            "name": p.name,
            "category": getattr(p, 'category', ''),
            "quantity": p.quantity,
            "failure_rate": round(p.failure_rate, 8),
            "total_failure_rate": round(p.total_failure_rate, 8),
            "contribution": round(p.total_failure_rate / total_fr, 6) if total_fr > 0 else 0,
            "pi_factors": p.pi_factors,
            "traceability": getattr(p, "traceability", {}),
            "calculation_steps": getattr(p, "calculation_steps", []),
            "assumptions": getattr(p, "assumptions", []),
            "warnings": getattr(p, "warnings", []),
        }
        row["parameter_impacts"] = build_parameter_impacts(
            standard,
            row["category"],
            row["pi_factors"],
            row["calculation_steps"],
        )
        add_equation_symbol_bindings(
            row, category=row["category"], effective_inputs=inputs,
        )
        return row

    for p, inputs in zip(parts, model_inputs):
        computed.append(result_row(p, inputs))

    results = _merge_results(len(parts_spec), valid_indices, computed, skipped)
    nonoperating_by_index = {}
    if standard == "MIL-HDBK-217F":
        for index in valid_indices:
            context = part_contexts[index]
            if context["effective_operating_fraction"] < 1:
                nonoperating_by_index[index] = calculate_nonoperating(
                    parts_spec[index], context)
    hierarchy = _apply_prediction_hierarchy(
        standard=standard,
        global_environment=environment,
        parts_spec=parts_spec,
        blocks=blocks,
        results=results,
        nonoperating_results=nonoperating_by_index,
    )
    total_fr = hierarchy["total_failure_rate"]

    response = {
        "standard": standard,
        "environment": environment,
        "total_failure_rate": (
            round(total_fr, 6) if total_fr is not None else None
        ),
        "service_failure_rate_fpmh": (
            round(total_fr, 6) if total_fr is not None else None
        ),
        "service_rate_available": hierarchy["service_rate_available"],
        "rate_time_basis": "calendar_hours",
        "mtbf_hours": hierarchy["mtbf_hours"],
        "results": results,
        "blocks": hierarchy["blocks"],
        "incompatible": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
            if not info.get("excluded")
        ],
        "excluded_parts": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
            if info.get("excluded")
        ],
        "excluded_part_count": sum(
            1 for info in skipped.values() if info.get("excluded")),
        "methodology": get_standard_disclosure(standard),
        "warnings": hierarchy["warnings"],
        "result_context": (
            "Operating handbook predictions and any separately identified "
            "RADC-TR-85-91 nonoperating rates are combined only as a "
            "calendar-time planning estimate."
        ),
    }
    excluded_count = response["excluded_part_count"]
    if excluded_count:
        response["warnings"].append(
            f"{excluded_count} part line(s) were excluded from the prediction "
            "because they are disabled, unconfirmed, or DNP."
        )
    if (standard == "MIL-HDBK-217F" and any(
            context["effective_operating_fraction"] < 1
            for context in part_contexts)):
        response["methodology_supplements"] = [
            get_standard_disclosure("RADC-TR-85-91")]
    return response


@router.post("/predict-standard")
def predict_standard(req: MultiStandardPredictionRequest):
    """Prediction using any supported standard."""
    if not req.parts and not any(
            block.failure_rate_override_enabled for block in req.blocks):
        raise HTTPException(
            status_code=400,
            detail="Add at least one part or an enabled System Block override.",
        )

    return _predict_standard(
        req.standard, req.parts, req.environment, req.blocks,
        req.process_grade, req.process_score, req.part_manufacturing,
    )


# ---------------------------------------------------------------------------
# Derating analysis
# ---------------------------------------------------------------------------

@router.get("/derating-standards")
def get_derating_standards():
    """List available derating standards."""
    try:
        from reliability.Derating import list_standards
    except ImportError:
        raise HTTPException(status_code=501,
                            detail="Derating module not available")
    standards = list_standards()
    for info in standards:
        disclosure = get_derating_disclosure(info["key"])
        info["methodology"] = disclosure
        info["conformance_tier"] = disclosure["conformance_tier"]
        info["conformance_label"] = disclosure["tier_definition"]["label"]
    return standards


@router.post("/derating")
def analyze_derating(req: DeratingRequest):
    """Analyze derating status for a set of parts."""
    try:
        from reliability.Derating import (
            DeratingStandardUnavailableError,
            analyze_derating as _analyze,
            assess_source_profile,
            list_standards as _list_derating_standards,
            make_custom_rules,
            resolve_source_profile_inputs,
        )
    except ImportError:
        raise HTTPException(status_code=501,
                            detail="Derating module not available")

    standard_profiles = {
        item["key"]: item for item in _list_derating_standards()
    }
    valid_standards = set(standard_profiles)
    valid_standards.add("Custom")
    if req.standard not in valid_standards:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unknown derating profile '{req.standard}'. Valid profiles: "
                f"{', '.join(sorted(valid_standards))}."
            ),
        )

    custom = None
    request_error = None
    if req.standard == "Custom":
        if req.derating_level is None:
            raise HTTPException(
                status_code=422,
                detail="Custom derating requires a selected Level I, II, or III.",
            )
        if not req.custom_rules:
            request_error = (
                "Custom derating requires at least one rule. No parameter was "
                "evaluated."
            )
        else:
            try:
                custom = make_custom_rules(req.custom_rules)
            except (KeyError, TypeError, ValueError) as exc:
                logger.info("Rejected an invalid custom derating rule set.", exc_info=True)
                raise HTTPException(
                    status_code=422,
                    detail=_public_custom_rule_error(exc),
                ) from exc
    elif req.custom_rules is not None:
        raise HTTPException(
            status_code=422,
            detail="custom_rules may only be supplied when standard is Custom.",
        )
    else:
        profile = standard_profiles[req.standard]
        if profile["available"]:
            if profile["level_mode"] == "none" and req.derating_level is not None:
                raise HTTPException(
                    status_code=422,
                    detail=f"{req.standard} does not define Levels I/II/III.",
                )
            level_not_applicable_to_all = (
                req.standard == "RADC-TR-84-254"
                and bool(req.parts)
                and all(
                    part.derating_params.get("profile") == req.standard
                    and part.derating_params.get("family") == "saw"
                    for part in req.parts
                )
            )
            if (profile["level_mode"] == "manual_three_level"
                    and req.derating_level is None
                    and not level_not_applicable_to_all):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"{req.standard} requires a manual Level I, II, or III "
                        "selection."
                    ),
                )
        else:
            request_error = (
                f"Derating standard '{req.standard}' is unavailable. "
                f"{profile['reason']}"
            )

    results = []
    for i, spec in enumerate(req.parts):
        part_name = spec.name or f"{spec.category} {i + 1}"
        analysis_error = _part_exclusion(spec) or request_error
        derating_results = []
        source_assessment = None
        input_resolution = None
        mapping_warnings = []
        requested_family = (
            spec.derating_params.get("family")
            if req.standard != "Custom" else None
        )
        if analysis_error is None:
            try:
                if req.standard == "Custom":
                    derating_results = _analyze(
                        spec.category,
                        _clean_part_params(spec.params),
                        standard=req.standard,
                        custom_rules=custom,
                        selected_level=req.derating_level,
                    )
                else:
                    input_resolution = resolve_source_profile_inputs(
                        req.standard,
                        spec.category,
                        _clean_part_params(spec.params),
                        spec.derating_params,
                    )
                    source_params = input_resolution["params"]
                    requested_family = input_resolution["family"]
                    source_assessment = assess_source_profile(
                        req.standard,
                        requested_family,
                        source_params,
                        selected_level=req.derating_level,
                    )
                    derating_results = list(source_assessment.checks)
                    family_definitions = (
                        (standard_profiles[req.standard]
                        .get("profile_schema") or {})
                        .get("families", [])
                    )
                    family_definition = next((
                        definition for definition in family_definitions
                        if definition.get("key") == requested_family
                    ), None)
                    category_hints = (
                        family_definition.get("category_hints", [])
                        if family_definition else []
                    )
                    if category_hints and spec.category not in category_hints:
                        mapping_warnings.append(
                            f"Source family '{requested_family}' is not a usual "
                            f"mapping for prediction category '{spec.category}'. "
                            "The explicit selection was retained; verify its "
                            "applicability."
                        )
                    if input_resolution["family_source"] == "automatic":
                        mapping_warnings.append(
                            f"Exact automatic source-family match: "
                            f"{requested_family}."
                        )
                    if input_resolution.get("ignored_profile"):
                        mapping_warnings.append(
                            "Saved inputs for "
                            f"{input_resolution['ignored_profile']} were kept "
                            f"isolated and were not used by {req.standard}."
                        )
            except DeratingStandardUnavailableError as exc:
                logger.info("Derating source profile was unavailable.", exc_info=True)
                analysis_error = _DERATING_UNAVAILABLE_MESSAGE
            except (TypeError, ValueError) as exc:
                # Unknown/custom-unmapped part categories are an explicit
                # coverage outcome, never a successful empty analysis.
                logger.info("Derating evaluation rejected part inputs.", exc_info=True)
                analysis_error = _public_derating_input_error(
                    exc,
                    (standard_profiles.get(req.standard) or {}).get("profile_schema"),
                    requested_family,
                )

        part_result = {
            "name": part_name,
            "category": spec.category,
            "derating": [],
            "overall_status": "not_evaluated",
            "coverage": {
                "evaluated": 0,
                # A failed preflight/evaluator invocation is one incomplete
                # required assessment, not a misleading successful-looking
                # 0/0 check set.
                "required": len(derating_results) if derating_results else int(
                    analysis_error is not None
                ),
                "complete": False,
            },
            "message": analysis_error,
            "family": (
                source_assessment.family
                if source_assessment is not None else requested_family
            ),
            "subtype": (
                source_assessment.subtype if source_assessment is not None else None
            ),
            "selected_level": (
                source_assessment.selected_level
                if source_assessment is not None else req.derating_level
            ),
            "assumptions": (
                list(source_assessment.assumptions)
                if source_assessment is not None else []
            ),
            "warnings": (
                (
                    list(source_assessment.warnings) + mapping_warnings
                    if source_assessment is not None else mapping_warnings
                )
            ),
            "traceability": (
                source_assessment.traceability
                if source_assessment is not None else None
            ),
            "input_resolution": (
                {
                    key: value for key, value in input_resolution.items()
                    if key != "params"
                }
                if input_resolution is not None else None
            ),
        }

        evaluated = 0
        has_exceedance = False
        has_missing = bool(analysis_error)
        for dr in derating_results:
            if req.standard == "Custom":
                entry = {
                    "parameter": dr.parameter,
                    "description": dr.description,
                    "unit": dr.unit,
                    "actual_value": dr.actual_value,
                    "rated_value": dr.rated_value,
                    "stress_ratio": round(dr.stress_ratio, 4) if dr.stress_ratio is not None else None,
                    "level_I": dr.level_I_limit,
                    "level_II": dr.level_II_limit,
                    "level_III": dr.level_III_limit,
                    "selected_level": dr.selected_level,
                    "selected_limit": dr.selected_limit,
                    "status": dr.status,
                    "derating_level": dr.derating_level,
                    "message": dr.message,
                }
            else:
                entry = {
                    "rule_id": dr.rule_id,
                    "parameter": dr.parameter,
                    "description": dr.description,
                    "unit": dr.unit,
                    "actual_value": dr.actual_value,
                    "allowable_value": dr.allowable_value,
                    "comparison": dr.comparison,
                    "margin": dr.margin,
                    "formula": dr.formula,
                    "substitution": dr.substitution,
                    "source": dr.source,
                    "notes": list(dr.notes),
                    "selected_level": source_assessment.selected_level,
                    "selected_limit": dr.allowable_value,
                    "status": dr.status,
                    "derating_level": None,
                    "message": dr.message,
                }
            part_result["derating"].append(entry)
            if dr.status == "exceeds":
                evaluated += 1
                has_exceedance = True
            elif dr.status == "ok":
                evaluated += 1
            else:
                has_missing = True

        required = len(derating_results) if derating_results else int(
            analysis_error is not None
        )
        complete = required > 0 and evaluated == required and not analysis_error
        part_result["coverage"] = {
            "evaluated": evaluated,
            "required": required,
            "complete": complete,
        }
        if has_exceedance:
            part_result["overall_status"] = "exceeds"
        elif complete and not has_missing:
            part_result["overall_status"] = "ok"
        else:
            part_result["overall_status"] = "not_evaluated"
            if part_result["message"] is None:
                part_result["message"] = (
                    f"Only {evaluated} of {required} required derating parameter(s) "
                    "were evaluated. Missing inputs never count as a pass."
                )
        results.append(part_result)

    summary = {
        "ok": sum(1 for r in results if r["overall_status"] == "ok"),
        "exceeds": sum(1 for r in results if r["overall_status"] == "exceeds"),
        "not_evaluated": sum(
            1 for r in results if r["overall_status"] == "not_evaluated"
        ),
    }

    response_level = req.derating_level
    if (req.standard == "RADC-TR-84-254" and results and all(
        result["selected_level"] is None for result in results
    )):
        response_level = None

    return {
        "standard": req.standard,
        "derating_level": response_level,
        "summary": summary,
        "results": results,
        "methodology": get_derating_disclosure(req.standard),
    }


# ---------------------------------------------------------------------------
# Mission profile prediction
# ---------------------------------------------------------------------------

@router.post("/mission-profile")
def predict_mission_profile(req: MissionProfilePredictionRequest):
    """Calculate failure rate across a mission profile."""
    if not req.phases:
        raise HTTPException(status_code=400, detail="At least one mission phase is required.")
    if not req.parts:
        raise HTTPException(status_code=400, detail="At least one part is required.")

    phase_defs = [
        {
            "name": p.name,
            "duration": p.duration,
            "environment": p.environment,
            "temperature": p.temperature,
            "operating_fraction": p.operating_fraction,
            "nonoperating_environment": p.nonoperating_environment,
            "nonoperating_temperature_c": p.nonoperating_temperature_c,
            "power_cycles_per_1000_nonoperating_hours": (
                p.power_cycles_per_1000_nonoperating_hours
            ),
        }
        for p in req.phases
    ]
    total_duration = sum(p.duration for p in req.phases)
    if total_duration <= 0:
        raise HTTPException(status_code=400, detail="Total mission duration must be > 0.")

    standard = req.standard

    if standard == "MIL-HDBK-217F":
        class_map = _PART_CLASSES
    elif standard == "Telcordia":
        class_map = _get_telcordia()
    elif standard == "217Plus":
        class_map = _get_217plus()
    elif standard == "FIDES":
        class_map = _get_fides()
    elif standard == "NSWC":
        class_map = _get_nswc()
    elif standard == "EPRD-2014":
        class_map = _get_eprd()
    elif standard == "NPRD-2023":
        class_map = _get_nprd()
    else:
        raise HTTPException(status_code=400, detail=f"Unknown standard '{standard}'.")

    part_results = []
    system_lambda = 0.0
    system_available = True

    for pi, spec in enumerate(req.parts):
        exclusion = _part_exclusion(spec)
        if exclusion:
            part_results.append({
                "name": spec.name or f"{spec.category or 'unmapped'} {pi + 1}",
                "category": spec.category,
                "quantity": spec.quantity,
                "mission_failure_rate": None,
                "service_rate_available": False,
                "excluded": True,
                "error": exclusion,
                "phases": [],
            })
            continue
        cls = class_map.get(spec.category)
        if cls is None:
            raise HTTPException(
                status_code=400,
                detail=f"Category '{spec.category}' not supported in {standard}.")

        part_name = spec.name or f"{spec.category} {pi + 1}"
        part_vita = (
            standard == "MIL-HDBK-217F"
            and (req.vita_global if spec.apply_vita is None else spec.apply_vita)
            and _vita_applies(spec.category, spec.params)
        )
        phase_details = []
        weighted_lambda = 0.0
        part_available = True
        temp_param = _temp_param_for(cls)

        for phase_index, phase in enumerate(req.phases):
            kwargs = _clean_part_params(spec.params)
            kwargs["name"] = part_name
            kwargs["quantity"] = spec.quantity

            if standard == "MIL-HDBK-217F" and _accepts_param(cls, "environment"):
                kwargs["environment"] = phase.environment
            elif standard in ("Telcordia", "217Plus", "NSWC", "EPRD-2014", "NPRD-2023"):
                kwargs["environment"] = phase.environment
            # Override the part's temperature with this phase's temperature,
            # using whatever parameter name the part class actually accepts.
            if temp_param is not None:
                kwargs[temp_param] = phase.temperature
            if standard == "MIL-HDBK-217F" and _accepts_param(cls, "standard"):
                kwargs["standard"] = "VITA-51.1" if part_vita else "MIL-HDBK-217F"

            fraction = phase.duration / total_duration

            try:
                part = cls(**kwargs)
                if part_vita:
                    annotate_vita_result(part, spec.category)
                operating_rate = float(part.total_failure_rate)
                pi_factors = part.pi_factors
            except (TypeError, ValueError) as e:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "MISSION_PART_PHASE_CALCULATION_FAILED",
                        "standard": standard,
                        "part_index": pi,
                        "part_name": part_name,
                        "category": spec.category,
                        "phase_index": phase_index,
                        "phase_name": phase.name,
                        "error_type": type(e).__name__,
                        "message": str(e),
                    },
                ) from e

            nonoperating = {
                "status": "not_required",
                "source": "RADC-TR-85-91",
                "failure_rate": None,
                "reason": "The phase operating fraction is 1.0.",
                "warnings": [],
            }
            nonoperating_rate = None
            if phase.operating_fraction < 1:
                context = {
                    "nonoperating_environment": phase.nonoperating_environment,
                    "nonoperating_temperature_c": phase.nonoperating_temperature_c,
                    "power_cycles_per_1000_nonoperating_hours": (
                        phase.power_cycles_per_1000_nonoperating_hours
                    ),
                }
                if spec.nonoperating_rate_override_enabled:
                    nonoperating_rate = (
                        float(spec.nonoperating_rate_override_fpmh)
                        * spec.quantity
                    )
                    nonoperating = {
                        "status": "user_override",
                        "source": spec.nonoperating_rate_source,
                        "source_type": spec.nonoperating_rate_source_type,
                        "failure_rate": nonoperating_rate,
                        "model": "user_supplied_nonoperating_rate",
                        "factors": {},
                        "steps": [],
                        "assumptions": [],
                        "warnings": [
                            "The RADC-TR-85-91 model was bypassed by a "
                            "documented user-supplied nonoperating rate."
                        ],
                        "traceability": {
                            "standard": "User-supplied evidence",
                            "section": "Nonoperating-rate override",
                            "model": "Documented user override",
                            "unit": "failures per million nonoperating hours",
                            "source": spec.nonoperating_rate_source,
                            "source_type": spec.nonoperating_rate_source_type,
                        },
                    }
                else:
                    nonoperating = calculate_nonoperating(spec, context)
                    if nonoperating.get("failure_rate") is not None:
                        nonoperating_rate = (
                            float(nonoperating["failure_rate"])
                            * spec.quantity
                        )

            if phase.operating_fraction >= 1:
                phase_rate = operating_rate
            elif nonoperating_rate is not None:
                phase_rate = (
                    phase.operating_fraction * operating_rate
                    + (1.0 - phase.operating_fraction) * nonoperating_rate
                )
            else:
                phase_rate = None

            if spec.failure_rate_override_enabled:
                phase_rate = float(spec.failure_rate_override_fpmh) * spec.quantity

            contribution = (
                phase_rate * fraction if phase_rate is not None else None
            )
            if contribution is None:
                part_available = False
            else:
                weighted_lambda += contribution

            phase_details.append({
                "phase_name": phase.name,
                "duration": phase.duration,
                "environment": phase.environment,
                "temperature": phase.temperature,
                "operating_fraction": phase.operating_fraction,
                "nonoperating_environment": phase.nonoperating_environment,
                "nonoperating_temperature_c": phase.nonoperating_temperature_c,
                "power_cycles_per_1000_nonoperating_hours": (
                    phase.power_cycles_per_1000_nonoperating_hours
                ),
                "operating_failure_rate_fpmh": round(operating_rate, 8),
                "nonoperating_failure_rate_fpmh": (
                    round(nonoperating_rate, 8)
                    if nonoperating_rate is not None else None
                ),
                "service_failure_rate_fpmh": (
                    round(phase_rate, 8) if phase_rate is not None else None
                ),
                "failure_rate": (
                    round(phase_rate, 8) if phase_rate is not None else None
                ),
                "nonoperating_calculation": nonoperating,
                "fraction": round(fraction, 6),
                "weighted_contribution": (
                    round(contribution, 8)
                    if contribution is not None else None
                ),
                "pi_factors": pi_factors,
                "error": (
                    None if phase_rate is not None
                    else nonoperating.get("reason", "Nonoperating rate unavailable")
                ),
            })

        if not part_available:
            system_available = False
        else:
            system_lambda += weighted_lambda
        part_results.append({
            "name": part_name,
            "category": spec.category,
            "quantity": spec.quantity,
            "mission_failure_rate": (
                round(weighted_lambda, 8) if part_available else None
            ),
            "service_rate_available": part_available,
            "phases": phase_details,
        })

    mission_mtbf = (
        1e6 / system_lambda
        if system_available and system_lambda > 0 else None
    )
    mission_reliability = (
        math.exp(-system_lambda * total_duration / 1e6)
        if system_available and system_lambda > 0
        else 1.0 if system_available else None
    )

    response = {
        "standard": standard,
        "profile_name": req.profile_name,
        "total_duration": total_duration,
        "system_failure_rate": (
            round(system_lambda, 6) if system_available else None
        ),
        "service_rate_available": system_available,
        "rate_time_basis": "calendar_hours",
        "system_mtbf": round(mission_mtbf, 1) if mission_mtbf else None,
        "mission_reliability": (
            round(mission_reliability, 8)
            if mission_reliability is not None else None
        ),
        "mission_unreliability": (
            round(1.0 - mission_reliability, 8)
            if mission_reliability is not None else None
        ),
        "phases": phase_defs,
        "part_results": part_results,
        "methodology": get_standard_disclosure(standard),
        "warnings": ([] if system_available else [
            "The mission service rate is unavailable because at least one "
            "part/phase lacks a supported RADC-TR-85-91 nonoperating model. "
            "Operating phase calculations remain visible."
        ]),
        "result_context": (
            "Mission rates are duration-weighted calendar-time planning "
            "estimates. Nonoperating exposure uses RADC-TR-85-91 as a "
            "separately disclosed extension to the operating standard."
        ),
    }
    excluded_mission_parts = sum(
        1 for part_result in part_results if part_result.get("excluded"))
    if excluded_mission_parts:
        response["warnings"].append(
            f"{excluded_mission_parts} part line(s) were excluded from the "
            "mission prediction because they are disabled, unconfirmed, or DNP."
        )
    methodology_supplements = []
    if any(phase.operating_fraction < 1 for phase in req.phases):
        methodology_supplements.append(
            get_standard_disclosure("RADC-TR-85-91"))
    vita_specs = [
        spec for spec in req.parts
        if _part_exclusion(spec) is None
        and standard == "MIL-HDBK-217F"
        and (req.vita_global if spec.apply_vita is None else spec.apply_vita)
        and _vita_applies(spec.category, spec.params)
    ]
    if vita_specs:
        methodology_supplements.append(get_standard_disclosure("VITA-51.1"))
        wearout = {"pth_assembly", "surface_mount_assembly"}
        if any(spec.category in wearout for spec in vita_specs) and any(
            spec.category not in wearout for spec in req.parts
        ):
            response["warnings"].append(
                "A/V51.1 Rule 2.3.5-1 requires the ANSI/VITA 51.2 mixing "
                "method before combining wearout/physics-of-failure and random "
                "rates into a compliant mission MTBF."
            )
    if methodology_supplements:
        response["methodology_supplements"] = methodology_supplements
    return response


@router.get("/mission-profiles")
def list_mission_profiles():
    """List available pre-defined mission profiles."""
    try:
        from reliability.MissionProfile import STANDARD_PROFILES
        return {
            key: {
                "name": mp.name,
                "total_duration": mp.total_duration,
                "n_phases": len(mp.phases),
                "phases": [
                    {
                        "name": p.name,
                        "duration": p.duration,
                        "environment": p.environment,
                        "temperature": p.temperature,
                        "operating_fraction": p.operating_fraction,
                        "nonoperating_environment": p.nonoperating_environment,
                        "nonoperating_temperature_c": p.nonoperating_temperature_c,
                        "power_cycles_per_1000_nonoperating_hours": (
                            p.power_cycles_per_1000_nonoperating_hours
                        ),
                        "description": p.description,
                    }
                    for p in mp.phases
                ],
            }
            for key, mp in STANDARD_PROFILES.items()
        }
    except ImportError:
        return {}
