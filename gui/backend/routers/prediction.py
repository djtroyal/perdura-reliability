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
    if not req.parts:
        raise HTTPException(status_code=400, detail="At least one part is required.")

    # Build the list of computable parts, but never abort the whole prediction
    # because one line item is unsupported or misconfigured: incompatible parts
    # are recorded and surfaced per-row so the user sees exactly what failed
    # while the rest of the system is still computed (#3).
    parts = []                 # successfully instantiated parts
    valid_indices = []         # their positions in req.parts
    vita_flags = []            # parallel to `parts`
    base_parts = []            # parallel to `parts`
    model_inputs = []          # effective constructor values, parallel to `parts`
    skipped = {}               # index -> {name, category, error}

    for i, spec in enumerate(req.parts):
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
            kwargs["environment"] = spec.environment or req.environment
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
        total_failure_rate = system.total_failure_rate
        mtbf_hours = None if total_failure_rate == 0 else round(system.mtbf, 1)

    # Re-assemble results positionally (placeholder row for each skipped part)
    # so the front-end can keep row ↔ result alignment and highlight failures.
    results = _merge_results(len(req.parts), valid_indices, computed, skipped)

    response = {
        "environment": req.environment,
        "standard": "MIL-HDBK-217F",
        "vita_global": req.vita_global,
        "total_failure_rate": round(total_failure_rate, 6),
        "mtbf_hours": mtbf_hours,
        "results": results,
        "incompatible": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
        ],
        "methodology": get_standard_disclosure("MIL-HDBK-217F"),
        "warnings": [],
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

def _predict_standard(standard: str, parts_spec, environment: str,
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
    parts = []
    model_inputs = []
    valid_indices = []
    skipped = {}
    for i, spec in enumerate(parts_spec):
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

        if standard == "MIL-HDBK-217F":
            if _accepts_param(cls, "environment"):
                kwargs["environment"] = spec.environment or environment
        elif standard == "Telcordia":
            kwargs["environment"] = spec.environment or environment
        elif standard == "217Plus":
            kwargs["environment"] = spec.environment or environment
            kwargs["process_grade"] = process_grade
        elif standard == "FIDES":
            kwargs["process_score"] = process_score
            kwargs["part_manufacturing"] = part_manufacturing
        elif standard == "NSWC":
            kwargs["environment"] = spec.environment or environment
        elif standard in ("EPRD-2014", "NPRD-2023"):
            kwargs["environment"] = spec.environment or environment

        try:
            part = cls(**kwargs)
            parts.append(part)
            model_inputs.append(effective_model_inputs(cls, kwargs))
            valid_indices.append(i)
        except (TypeError, ValueError) as e:
            skipped[i] = {"name": name, "category": spec.category, "error": str(e)}

    total_fr = sum(p.total_failure_rate for p in parts)
    computed = []
    for p, inputs in zip(parts, model_inputs):
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
        computed.append(row)

    results = _merge_results(len(parts_spec), valid_indices, computed, skipped)

    return {
        "standard": standard,
        "environment": environment,
        "total_failure_rate": round(total_fr, 6),
        "mtbf_hours": None if total_fr == 0 else round(1e6 / total_fr, 1),
        "results": results,
        "incompatible": [
            {"index": idx, **info} for idx, info in sorted(skipped.items())
        ],
        "methodology": get_standard_disclosure(standard),
    }


@router.post("/predict-standard")
def predict_standard(req: MultiStandardPredictionRequest):
    """Prediction using any supported standard."""
    if not req.parts:
        raise HTTPException(status_code=400, detail="At least one part is required.")

    return _predict_standard(
        req.standard, req.parts, req.environment,
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
