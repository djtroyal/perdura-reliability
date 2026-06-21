"""Failure rate prediction router (MIL-HDBK-217F / VITA 51.1 / Telcordia / 217Plus / FIDES / NSWC)."""

import sys
import math
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.MIL_HDBK_217F import (
    ENVIRONMENTS, ENVIRONMENT_DESCRIPTIONS, STANDARDS,
    Microcircuit, HybridMicrocircuit,
    Diode, HFDiode, BipolarTransistor, FieldEffectTransistor,
    GaAsFET, UnijunctionTransistor,
    Thyristor, Optoelectronic,
    Tube, Laser,
    Resistor, Capacitor, InductiveDevice,
    RotatingDevice, Relay, SolidStateRelay,
    Switch, CircuitBreaker,
    Connector, PCB, Connection,
    Meter, QuartzCrystal, Lamp,
    ElectronicFilter, Fuse,
    MiscellaneousPart,
    CustomPart, GenericPart,
    SystemFailureRate,
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
    "hybrid_microcircuit": HybridMicrocircuit,
    "diode": Diode,
    "hf_diode": HFDiode,
    "bjt": BipolarTransistor,
    "fet": FieldEffectTransistor,
    "gaas_fet": GaAsFET,
    "unijunction": UnijunctionTransistor,
    "thyristor": Thyristor,
    "optoelectronic": Optoelectronic,
    "tube": Tube,
    "laser": Laser,
    "resistor": Resistor,
    "capacitor": Capacitor,
    "inductive": InductiveDevice,
    "rotating": RotatingDevice,
    "relay": Relay,
    "ss_relay": SolidStateRelay,
    "switch": Switch,
    "circuit_breaker": CircuitBreaker,
    "connector": Connector,
    "pcb": PCB,
    "connection": Connection,
    "meter": Meter,
    "crystal": QuartzCrystal,
    "lamp": Lamp,
    "filter": ElectronicFilter,
    "fuse": Fuse,
    "miscellaneous": MiscellaneousPart,
    "custom": CustomPart,
    "generic": GenericPart,
}

_NO_ENV_CATEGORIES = {"custom", "generic"}

# ---------------------------------------------------------------------------
# Lazy-loaded standard modules (avoid import errors if not installed)
# ---------------------------------------------------------------------------
_telcordia_classes = None
_plus217_classes = None
_fides_classes = None
_nswc_classes = None


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
        "standards": list(STANDARDS) + ["Telcordia", "217Plus", "FIDES", "NSWC"],
        "categories": list(_PART_CLASSES),
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
    return standards


@router.post("/predict")
def predict(req: PredictionRequest):
    """MIL-HDBK-217F part stress prediction (original endpoint)."""
    if not req.parts:
        raise HTTPException(status_code=400, detail="At least one part is required.")

    parts = []
    vita_flags = []
    base_parts = []
    for i, spec in enumerate(req.parts):
        cls = _PART_CLASSES.get(spec.category)
        if cls is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown part category '{spec.category}' "
                       f"(part {i + 1}). Valid: {list(_PART_CLASSES)}")
        vita = req.vita_global if spec.apply_vita is None else spec.apply_vita
        kwargs = dict(spec.params)
        kwargs["name"] = spec.name or f"{spec.category} {i + 1}"
        kwargs["quantity"] = spec.quantity
        has_env = spec.category not in _NO_ENV_CATEGORIES
        if has_env:
            kwargs["environment"] = spec.environment or req.environment
            kwargs["standard"] = "VITA-51.1" if vita else "MIL-HDBK-217F"
        try:
            parts.append(cls(**kwargs))
        except TypeError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")
        except ValueError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")
        part_vita = vita and has_env
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

    try:
        system = SystemFailureRate(parts)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    results = system.results
    for row, vita, base in zip(results, vita_flags, base_parts):
        row["vita"] = vita
        if vita and base is not None:
            row["base_pi_factors"] = base.pi_factors
            row["base_failure_rate"] = round(base.failure_rate, 6)
            row["base_total_failure_rate"] = round(base.total_failure_rate, 6)

    return {
        "environment": req.environment,
        "standard": "MIL-HDBK-217F",
        "vita_global": req.vita_global,
        "total_failure_rate": round(system.total_failure_rate, 6),
        "mtbf_hours": (None if system.total_failure_rate == 0
                       else round(system.mtbf, 1)),
        "results": results,
    }


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
    else:
        raise HTTPException(status_code=400,
                            detail=f"Unknown standard '{standard}'. "
                                   f"Valid: MIL-HDBK-217F, Telcordia, 217Plus, FIDES, NSWC")

    parts = []
    for i, spec in enumerate(parts_spec):
        cls = class_map.get(spec.category)
        if cls is None:
            raise HTTPException(
                status_code=400,
                detail=f"Category '{spec.category}' not supported in {standard}. "
                       f"Valid: {list(class_map)}")
        kwargs = dict(spec.params)
        kwargs["name"] = spec.name or f"{spec.category} {i + 1}"
        kwargs["quantity"] = spec.quantity

        if standard == "MIL-HDBK-217F":
            if spec.category not in _NO_ENV_CATEGORIES:
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

        try:
            parts.append(cls(**kwargs))
        except TypeError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i+1} ({kwargs['name']}): {e}")
        except ValueError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i+1} ({kwargs['name']}): {e}")

    total_fr = sum(p.total_failure_rate for p in parts)
    results = []
    for p in parts:
        row = {
            "name": p.name,
            "category": getattr(p, 'category', spec.category),
            "quantity": p.quantity,
            "failure_rate": round(p.failure_rate, 8),
            "total_failure_rate": round(p.total_failure_rate, 8),
            "contribution": round(p.total_failure_rate / total_fr, 6) if total_fr > 0 else 0,
            "pi_factors": p.pi_factors,
        }
        results.append(row)

    return {
        "standard": standard,
        "environment": environment,
        "total_failure_rate": round(total_fr, 6),
        "mtbf_hours": None if total_fr == 0 else round(1e6 / total_fr, 1),
        "results": results,
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
    return list_standards()


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
                spec.category, spec.params,
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
        phase_details = []
        weighted_lambda = 0.0

        for phase in req.phases:
            kwargs = dict(spec.params)
            kwargs["name"] = part_name
            kwargs["quantity"] = spec.quantity

            if standard == "MIL-HDBK-217F" and spec.category not in _NO_ENV_CATEGORIES:
                kwargs["environment"] = phase.environment
            elif standard in ("Telcordia", "217Plus", "NSWC"):
                kwargs["environment"] = phase.environment
            if "temperature" in kwargs or hasattr(cls, '__init__'):
                kwargs["temperature"] = phase.temperature

            dormant_factor = phase.duty_cycle if phase.operating else 0.1
            fraction = phase.duration / total_duration

            try:
                part = cls(**kwargs)
                phase_fr = part.total_failure_rate * dormant_factor
                pi_factors = part.pi_factors
            except (TypeError, ValueError):
                phase_fr = 0.0
                pi_factors = {}

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

    return {
        "standard": standard,
        "profile_name": req.profile_name,
        "total_duration": total_duration,
        "system_failure_rate": round(system_lambda, 6),
        "system_mtbf": round(mission_mtbf, 1) if mission_mtbf else None,
        "mission_reliability": round(mission_reliability, 8),
        "mission_unreliability": round(1.0 - mission_reliability, 8),
        "phases": phase_defs,
        "part_results": part_results,
    }


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
