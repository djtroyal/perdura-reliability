"""Failure rate prediction router (MIL-HDBK-217F / VITA 51.1 / Telcordia / 217Plus / FIDES / NSWC)."""

import sys
import math
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
from routers._prediction_impacts import build_parameter_impacts
from routers._prediction_symbols import (
    add_equation_symbol_bindings,
    effective_model_inputs,
)
from schemas import (
    PredictionRequest, MultiStandardPredictionRequest,
    DeratingRequest, MissionProfilePredictionRequest,
)

router = APIRouter()

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
    """Validate a block tree and resolve inherited exposure/quantity context."""
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
            (f"block '{block.id}' dormant", block.dormant_environment)
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
            "effective_duty_cycle": 1.0,
            "operating_environment": global_environment,
            "explicit_dormant_environment": None,
        }
        operating = block.environment or parent["operating_environment"]
        explicit_dormant = (
            block.dormant_environment
            or parent["explicit_dormant_environment"]
        )
        context = {
            "quantity_multiplier": parent["quantity_multiplier"] * block.quantity,
            "ancestor_quantity_multiplier": parent["quantity_multiplier"],
            # FIDES exposure is already represented by its process/mission
            # model.  A simple operating/dormant duty blend would double-count
            # exposure, so only structural quantity/override controls apply.
            "effective_duty_cycle": (
                1.0 if standard == "FIDES"
                else parent["effective_duty_cycle"] * block.duty_cycle
            ),
            "operating_environment": operating,
            "explicit_dormant_environment": explicit_dormant,
            "dormant_environment": explicit_dormant or operating,
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
                "effective_duty_cycle": 1.0,
                "operating_environment": operating,
                "dormant_environment": operating,
                "block_quantity_multiplier": 1,
            })
            continue
        block_context = contexts[part.parent_id]
        operating = part.environment or block_context["operating_environment"]
        part_contexts.append({
            "effective_duty_cycle": block_context["effective_duty_cycle"],
            "operating_environment": operating,
            "dormant_environment": (
                block_context["explicit_dormant_environment"] or operating
            ),
            "block_quantity_multiplier": block_context["quantity_multiplier"],
        })
    return block_by_id, contexts, part_contexts


def _apply_prediction_hierarchy(
    *, standard, global_environment, parts_spec, blocks, results, dormant_results,
):
    """Apply duty weighting, user overrides, nested quantities, and block roll-up."""
    block_by_id, contexts, part_contexts = _prediction_hierarchy_contexts(
        standard, global_environment, parts_spec, blocks)

    for index, (spec, row, context) in enumerate(zip(parts_spec, results, part_contexts)):
        if row.get("incompatible"):
            continue
        dormant_row = dormant_results.get(index, row)
        operating_rate = float(row["failure_rate"])
        dormant_rate = float(dormant_row["failure_rate"])
        duty = float(context["effective_duty_cycle"])
        calculated_rate = duty * operating_rate + (1.0 - duty) * dormant_rate
        override_applied = bool(spec.failure_rate_override_enabled)
        effective_rate = (
            float(spec.failure_rate_override_fpmh)
            if override_applied else calculated_rate
        )
        line_total = effective_rate * spec.quantity
        calculated_line_total = calculated_rate * spec.quantity
        expanded_total = line_total * context["block_quantity_multiplier"]
        row.update({
            "parent_id": spec.parent_id,
            "operating_environment": context["operating_environment"],
            "dormant_environment": context["dormant_environment"],
            "effective_duty_cycle": round(duty, 12),
            "operating_calculated_failure_rate": round(operating_rate, 8),
            "dormant_calculated_failure_rate": round(dormant_rate, 8),
            "calculated_failure_rate": round(calculated_rate, 8),
            "calculated_total_failure_rate": round(calculated_line_total, 8),
            "failure_rate_override_enabled": override_applied,
            "failure_rate_override_fpmh": spec.failure_rate_override_fpmh,
            "override_applied": override_applied,
            "failure_rate": round(effective_rate, 8),
            "line_total_failure_rate": round(line_total, 8),
            "total_failure_rate": round(line_total, 8),
            "block_quantity_multiplier": context["block_quantity_multiplier"],
            "system_expanded_failure_rate": round(expanded_total, 8),
            "dormant_calculation": {
                "environment": context["dormant_environment"],
                "failure_rate": round(dormant_rate, 8),
                "pi_factors": dormant_row.get("pi_factors", {}),
                "traceability": dormant_row.get("traceability", {}),
                "calculation_steps": dormant_row.get("calculation_steps", []),
                "assumptions": dormant_row.get("assumptions", []),
                "warnings": dormant_row.get("warnings", []),
            },
            "output_adjustment": {
                "formula": "lambda_calc = D*lambda_operating + (1-D)*lambda_dormant",
                "calculated_failure_rate": round(calculated_rate, 8),
                "override_applied": override_applied,
                "override_failure_rate": spec.failure_rate_override_fpmh,
                "effective_failure_rate": round(effective_rate, 8),
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
        handbook_subtotal = 0.0
        rolled_subtotal = 0.0
        for index in direct_parts[block_id]:
            row = results[index]
            if row.get("incompatible"):
                continue
            handbook_subtotal += float(row["calculated_total_failure_rate"])
            rolled_subtotal += float(row["line_total_failure_rate"])
        for child_id in child_blocks[block_id]:
            child = roll_up(child_id)
            child_spec = block_by_id[child_id]
            handbook_subtotal += child["handbook_subtotal_failure_rate"] * child_spec.quantity
            rolled_subtotal += child["failure_rate"] * child_spec.quantity
        override_applied = bool(block.failure_rate_override_enabled)
        effective = (
            float(block.failure_rate_override_fpmh)
            if override_applied else rolled_subtotal
        )
        context = contexts[block_id]
        result = {
            "id": block.id,
            "name": block.name,
            "parent_id": block.parent_id,
            "notes": block.notes,
            "quantity": block.quantity,
            "duty_cycle": block.duty_cycle,
            "effective_duty_cycle": round(context["effective_duty_cycle"], 12),
            "operating_environment": context["operating_environment"],
            "dormant_environment": context["dormant_environment"],
            "handbook_subtotal_failure_rate": round(handbook_subtotal, 8),
            "rolled_up_failure_rate": round(rolled_subtotal, 8),
            "failure_rate_override_enabled": override_applied,
            "failure_rate_override_fpmh": block.failure_rate_override_fpmh,
            "override_applied": override_applied,
            "failure_rate": round(effective, 8),
            "total_failure_rate": round(effective * block.quantity, 8),
            "system_expanded_failure_rate": round(
                effective * context["quantity_multiplier"], 8),
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
    for index in root_parts:
        row = results[index]
        if not row.get("incompatible"):
            system_total += float(row["line_total_failure_rate"])
    for root_id in root_blocks:
        root = block_results_by_id[root_id]
        system_total += float(root["failure_rate"]) * block_by_id[root_id].quantity

    for index, (spec, row) in enumerate(zip(parts_spec, results)):
        if row.get("incompatible"):
            continue
        superseding = overriding_ancestor(spec.parent_id) if spec.parent_id else None
        contribution_rate = (
            0.0 if superseding else float(row["system_expanded_failure_rate"])
        )
        row["superseded_by_block_id"] = superseding
        row["included_in_system_total"] = superseding is None
        row["system_contribution_failure_rate"] = round(contribution_rate, 8)
        row["contribution"] = round(
            contribution_rate / system_total, 8) if system_total > 0 else 0.0

    for block_id, block_result in block_results_by_id.items():
        superseding = overriding_ancestor(block_id, include_self=False)
        contribution_rate = (
            0.0 if superseding
            else float(block_result["system_expanded_failure_rate"])
        )
        block_result["superseded_by_block_id"] = superseding
        block_result["included_in_system_total"] = superseding is None
        block_result["system_contribution_failure_rate"] = round(contribution_rate, 8)
        block_result["contribution"] = round(
            contribution_rate / system_total, 8) if system_total > 0 else 0.0

    warnings = []
    if standard == "FIDES" and any(
        block.duty_cycle < 1
        or block.environment is not None
        or block.dormant_environment is not None
        for block in blocks
    ):
        warnings.append(
            "System Block operating/dormant environment weighting is not applicable "
            "to the FIDES process model; block quantity and failure-rate overrides "
            "remain effective."
        )
    return {
        "total_failure_rate": system_total,
        "mtbf_hours": None if system_total == 0 else round(1e6 / system_total, 1),
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
    dormant_parts = []         # same models evaluated in dormant environments
    valid_indices = []         # their positions in req.parts
    vita_flags = []            # parallel to `parts`
    base_parts = []            # parallel to `parts`
    model_inputs = []          # effective constructor values, parallel to `parts`
    dormant_model_inputs = []  # constructor values for dormant evaluations
    skipped = {}               # index -> {name, category, error}

    for i, (spec, exposure) in enumerate(zip(req.parts, part_contexts)):
        name = spec.name or f"{spec.category} {i + 1}"
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
        dormant_part = part
        dormant_kwargs = kwargs
        if (has_env
                and exposure["dormant_environment"] != exposure["operating_environment"]):
            dormant_kwargs = dict(kwargs)
            dormant_kwargs["environment"] = exposure["dormant_environment"]
            try:
                dormant_part = cls(**dormant_kwargs)
                if vita and vita_applicable:
                    annotate_vita_result(dormant_part, spec.category)
            except (TypeError, ValueError) as e:
                skipped[i] = {
                    "name": name,
                    "category": spec.category,
                    "error": f"Dormant-environment calculation failed: {e}",
                }
                continue
        parts.append(part)
        dormant_parts.append(dormant_part)
        valid_indices.append(i)
        model_inputs.append(effective_model_inputs(cls, kwargs))
        dormant_model_inputs.append(effective_model_inputs(cls, dormant_kwargs))
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
    dormant_by_index = {}
    if parts:
        # ValueError → 400 via the global exception handler in main.py
        system = SystemFailureRate(parts)
        computed = system.results
        dormant_computed = SystemFailureRate(dormant_parts).results
        for dormant_row, inputs in zip(dormant_computed, dormant_model_inputs):
            add_equation_symbol_bindings(
                dormant_row,
                category=dormant_row["category"],
                effective_inputs=inputs,
            )
        dormant_by_index = dict(zip(valid_indices, dormant_computed))
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
    # Re-assemble results positionally (placeholder row for each skipped part)
    # so the front-end can keep row ↔ result alignment and highlight failures.
    results = _merge_results(len(req.parts), valid_indices, computed, skipped)
    hierarchy = _apply_prediction_hierarchy(
        standard="MIL-HDBK-217F",
        global_environment=req.environment,
        parts_spec=req.parts,
        blocks=req.blocks,
        results=results,
        dormant_results=dormant_by_index,
    )
    total_failure_rate = hierarchy["total_failure_rate"]
    mtbf_hours = hierarchy["mtbf_hours"]

    response = {
        "environment": req.environment,
        "standard": "MIL-HDBK-217F",
        "vita_global": req.vita_global,
        "total_failure_rate": round(total_failure_rate, 6),
        "mtbf_hours": mtbf_hours,
        "results": results,
        "blocks": hierarchy["blocks"],
        "incompatible": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
        ],
        "methodology": get_standard_disclosure("MIL-HDBK-217F"),
        "warnings": list(hierarchy["warnings"]),
    }
    if any(vita_flags):
        response["methodology_supplements"] = [get_standard_disclosure("VITA-51.1")]
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
    dormant_parts = []
    model_inputs = []
    dormant_model_inputs = []
    valid_indices = []
    skipped = {}
    for i, (spec, exposure) in enumerate(zip(parts_spec, part_contexts)):
        name = spec.name or f"{spec.category} {i + 1}"
        cls = class_map.get(spec.category)
        if cls is None:
            skipped[i] = {"name": name, "category": spec.category,
                          "error": f"Part category '{spec.category}' is not "
                                   f"supported by {standard}."}
            continue
        kwargs = _clean_part_params(spec.params)
        kwargs["name"] = name
        kwargs["quantity"] = spec.quantity

        environment_applicable = standard != "FIDES"
        if standard == "MIL-HDBK-217F":
            if _accepts_param(cls, "environment"):
                kwargs["environment"] = exposure["operating_environment"]
            else:
                environment_applicable = False
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
            dormant_part = part
            dormant_kwargs = kwargs
            if (environment_applicable
                    and exposure["dormant_environment"] != exposure["operating_environment"]):
                dormant_kwargs = dict(kwargs)
                dormant_kwargs["environment"] = exposure["dormant_environment"]
                dormant_part = cls(**dormant_kwargs)
            parts.append(part)
            dormant_parts.append(dormant_part)
            model_inputs.append(effective_model_inputs(cls, kwargs))
            dormant_model_inputs.append(effective_model_inputs(cls, dormant_kwargs))
            valid_indices.append(i)
        except (TypeError, ValueError) as e:
            skipped[i] = {"name": name, "category": spec.category, "error": str(e)}

    total_fr = sum(p.total_failure_rate for p in parts)
    computed = []
    dormant_computed = []

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

    for p, dormant_part, inputs, dormant_inputs in zip(
            parts, dormant_parts, model_inputs, dormant_model_inputs):
        computed.append(result_row(p, inputs))
        dormant_computed.append(result_row(dormant_part, dormant_inputs))

    results = _merge_results(len(parts_spec), valid_indices, computed, skipped)
    dormant_by_index = dict(zip(valid_indices, dormant_computed))
    hierarchy = _apply_prediction_hierarchy(
        standard=standard,
        global_environment=environment,
        parts_spec=parts_spec,
        blocks=blocks,
        results=results,
        dormant_results=dormant_by_index,
    )
    total_fr = hierarchy["total_failure_rate"]

    return {
        "standard": standard,
        "environment": environment,
        "total_failure_rate": round(total_fr, 6),
        "mtbf_hours": hierarchy["mtbf_hours"],
        "results": results,
        "blocks": hierarchy["blocks"],
        "incompatible": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
        ],
        "methodology": get_standard_disclosure(standard),
        "warnings": hierarchy["warnings"],
    }


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
            analyze_derating as _analyze,
            make_custom_rules,
        )
    except ImportError:
        raise HTTPException(status_code=501,
                            detail="Derating module not available")

    custom = None
    if req.standard == "Custom" and req.custom_rules:
        custom = make_custom_rules(req.custom_rules)

    results = []
    for i, spec in enumerate(req.parts):
        part_name = spec.name or f"{spec.category} {i + 1}"
        try:
            derating_results = _analyze(
                spec.category, _clean_part_params(spec.params),
                standard=req.standard,
                custom_rules=custom,
            )
        except Exception:
            derating_results = []

        part_result = {
            "name": part_name,
            "category": spec.category,
            "derating": [],
            "overall_status": "ok",
        }

        worst = "ok"
        for dr in derating_results:
            entry = {
                "parameter": dr.parameter,
                "description": dr.parameter,
                "actual_value": dr.actual_value,
                "rated_value": dr.rated_value,
                "stress_ratio": round(dr.stress_ratio, 4) if dr.stress_ratio is not None else None,
                "level_I": dr.level_I_limit,
                "level_II": dr.level_II_limit,
                "level_III": dr.level_III_limit,
                "status": dr.status,
                "derating_level": dr.derating_level,
            }
            part_result["derating"].append(entry)
            if dr.status == "exceeds":
                worst = "exceeds"
            elif dr.status == "warning" and worst != "exceeds":
                worst = "warning"

        part_result["overall_status"] = worst
        results.append(part_result)

    summary = {
        "ok": sum(1 for r in results if r["overall_status"] == "ok"),
        "warning": sum(1 for r in results if r["overall_status"] == "warning"),
        "exceeds": sum(1 for r in results if r["overall_status"] == "exceeds"),
    }

    return {
        "standard": req.standard,
        "derating_level": req.derating_level,
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
            "operating": p.operating,
            "duty_cycle": p.duty_cycle,
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

    for pi, spec in enumerate(req.parts):
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

            dormant_factor = phase.duty_cycle if phase.operating else 0.1
            fraction = phase.duration / total_duration

            try:
                part = cls(**kwargs)
                if part_vita:
                    annotate_vita_result(part, spec.category)
                phase_fr = part.total_failure_rate * dormant_factor
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

            contribution = phase_fr * fraction
            weighted_lambda += contribution

            phase_details.append({
                "phase_name": phase.name,
                "duration": phase.duration,
                "environment": phase.environment,
                "temperature": phase.temperature,
                "operating": phase.operating,
                "duty_cycle": phase.duty_cycle,
                "failure_rate": round(phase_fr, 8),
                "fraction": round(fraction, 6),
                "weighted_contribution": round(contribution, 8),
                "pi_factors": pi_factors,
                "error": None,
            })

        system_lambda += weighted_lambda
        part_results.append({
            "name": part_name,
            "category": spec.category,
            "quantity": spec.quantity,
            "mission_failure_rate": round(weighted_lambda, 8),
            "phases": phase_details,
        })

    mission_mtbf = 1e6 / system_lambda if system_lambda > 0 else None
    mission_reliability = math.exp(-system_lambda * total_duration / 1e6) if system_lambda > 0 else 1.0

    response = {
        "standard": standard,
        "profile_name": req.profile_name,
        "total_duration": total_duration,
        "system_failure_rate": round(system_lambda, 6),
        "system_mtbf": round(mission_mtbf, 1) if mission_mtbf else None,
        "mission_reliability": round(mission_reliability, 8),
        "mission_unreliability": round(1.0 - mission_reliability, 8),
        "phases": phase_defs,
        "part_results": part_results,
        "methodology": get_standard_disclosure(standard),
        "warnings": [],
    }
    vita_specs = [
        spec for spec in req.parts
        if standard == "MIL-HDBK-217F"
        and (req.vita_global if spec.apply_vita is None else spec.apply_vita)
        and _vita_applies(spec.category, spec.params)
    ]
    if vita_specs:
        response["methodology_supplements"] = [get_standard_disclosure("VITA-51.1")]
        wearout = {"pth_assembly", "surface_mount_assembly"}
        if any(spec.category in wearout for spec in vita_specs) and any(
            spec.category not in wearout for spec in req.parts
        ):
            response["warnings"].append(
                "A/V51.1 Rule 2.3.5-1 requires the ANSI/VITA 51.2 mixing "
                "method before combining wearout/physics-of-failure and random "
                "rates into a compliant mission MTBF."
            )
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
                        "operating": p.operating,
                        "duty_cycle": p.duty_cycle,
                        "description": p.description,
                    }
                    for p in mp.phases
                ],
            }
            for key, mp in STANDARD_PROFILES.items()
        }
    except ImportError:
        return {}
