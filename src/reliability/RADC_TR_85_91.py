"""RADC-TR-85-91 nonoperating reliability prediction models.

This module transcribes the proposed MIL-HDBK-217 nonoperating models in
Appendix A of *Impact of Nonoperating Periods on Equipment Reliability*,
RADC-TR-85-91, May 1985 (AD-A158843).  Rates are failures per million
nonoperating hours (FPMH).

The report is a related government technical report, not part of
MIL-HDBK-217F Notice 2.  Its factors include preliminary, theoretical, and
extrapolated estimates.  A calculated result therefore establishes parity
with the report, not empirical validation for a particular application.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Iterable, Mapping, Sequence


FPMH = "failures per 10^6 nonoperating hours"
CALENDAR_FPMH = "failures per 10^6 calendar hours"
REPORT_EDITION = "RADC-TR-85-91 (May 1985), AD-A158843"


class UnsupportedRADCModelError(ValueError):
    """Raised when the report does not support the requested prediction."""


# Table 4.5-1 and the Appendix A factor tables.  SF is intentionally absent:
# Section 4.5 says every category except Space, Flight was considered for
# nonoperating predictions, despite several Appendix tables printing an SF=1
# placeholder.
NONOPERATING_ENVIRONMENTS = (
    "GB", "GF", "GM", "Mp", "NSB", "NS", "NU", "NH", "NUU", "ARW",
    "AIC", "AIT", "AIB", "AIA", "AIF", "AUC", "AUT", "AUB", "AUA",
    "AUF", "MFF", "MFA", "USL", "ML", "CL",
)

NONOPERATING_ENVIRONMENT_DESCRIPTIONS = {
    "GB": "Ground, Benign",
    "GF": "Ground, Fixed",
    "GM": "Ground, Mobile",
    "Mp": "Manpack",
    "NSB": "Naval, Submarine",
    "NS": "Naval, Sheltered",
    "NU": "Naval, Unsheltered",
    "NH": "Naval, Hydrofoil",
    "NUU": "Naval, Undersea, Unsheltered",
    "ARW": "Airborne, Rotary Wing",
    "AIC": "Airborne, Inhabited, Cargo",
    "AIT": "Airborne, Inhabited, Trainer",
    "AIB": "Airborne, Inhabited, Bomber",
    "AIA": "Airborne, Inhabited, Attack",
    "AIF": "Airborne, Inhabited, Fighter",
    "AUC": "Airborne, Uninhabited, Cargo",
    "AUT": "Airborne, Uninhabited, Trainer",
    "AUB": "Airborne, Uninhabited, Bomber",
    "AUA": "Airborne, Uninhabited, Attack",
    "AUF": "Airborne, Uninhabited, Fighter",
    "MFF": "Missile, Free Flight",
    "MFA": "Airbreathing Missile, Flight",
    "USL": "Undersea, Launch",
    "ML": "Missile, Launch",
    "CL": "Cannon, Launch",
}

_SOURCE_ENVIRONMENTS = (
    "GB", "GF", "GM", "Mp", "NSB", "NS", "NU", "NH", "NUU", "ARW",
    "AIC", "AIT", "AIB", "AIA", "AIF", "AUC", "AUT", "AUB", "AUA",
    "AUF", "SF", "MFF", "MFA", "USL", "ML", "CL",
)

_GENERAL_WARNING = (
    "RADC-TR-85-91 identifies some factors as preliminary, theoretical, or "
    "extrapolated; this result is a report transcription, not empirical "
    "validation for the selected application."
)


@dataclass(frozen=True)
class NonoperatingPrediction:
    """Auditable result returned by every RADC nonoperating calculator."""

    failure_rate: float
    model: str
    factors: Mapping[str, Any]
    traceability: Mapping[str, Any]
    steps: tuple[Mapping[str, Any], ...]
    assumptions: tuple[str, ...]
    warnings: tuple[str, ...]
    inputs: Mapping[str, Any]

    @property
    def nonoperating_failure_rate_fpmh(self) -> float:
        """Explicit rate-basis alias for API and report integrations."""
        return self.failure_rate

    @property
    def unit(self) -> str:
        return FPMH

    @property
    def long_form(self) -> dict[str, Any]:
        return {
            "failure_rate": self.failure_rate,
            "nonoperating_failure_rate_fpmh": self.failure_rate,
            "unit": FPMH,
            "model": self.model,
            "factors": dict(self.factors),
            "traceability": dict(self.traceability),
            "steps": [dict(step) for step in self.steps],
            "assumptions": list(self.assumptions),
            "warnings": list(self.warnings),
            "inputs": dict(self.inputs),
        }


def _canonical(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    normalized = value.strip().lower().replace(",", "").replace("-", "_").replace(" ", "_")
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized


def _choice(value: str, choices: Mapping[str, Any] | Iterable[str], name: str) -> str:
    key = _canonical(value, name)
    options = choices.keys() if isinstance(choices, Mapping) else choices
    if key not in options:
        raise UnsupportedRADCModelError(
            f"{name} must be one of {sorted(options)}, got {value!r}"
        )
    return key


def _environment(environment: str, table: Mapping[str, float | None]) -> float:
    if environment == "SF":
        raise UnsupportedRADCModelError(
            "RADC-TR-85-91 Section 4.5 excludes Space, Flight from the "
            "nonoperating model even though Appendix A prints SF=1 placeholders"
        )
    if environment not in NONOPERATING_ENVIRONMENTS:
        raise UnsupportedRADCModelError(
            f"environment must be one of {list(NONOPERATING_ENVIRONMENTS)}, "
            f"got {environment!r}"
        )
    value = table.get(environment)
    if value is None:
        raise UnsupportedRADCModelError(
            f"the report provides no factor for environment {environment!r} "
            "for this model"
        )
    return float(value)


def _env(values: Sequence[float | None]) -> dict[str, float | None]:
    if len(values) != len(_SOURCE_ENVIRONMENTS):
        raise RuntimeError("RADC environment table must contain 26 entries")
    return dict(zip(_SOURCE_ENVIRONMENTS, values))


def _finite(value: float, name: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _positive(value: float, name: str) -> float:
    result = _finite(value, name)
    if result <= 0:
        raise ValueError(f"{name} must be > 0")
    return result


def _nonnegative(value: float, name: str) -> float:
    result = _finite(value, name)
    if result < 0:
        raise ValueError(f"{name} must be >= 0")
    return result


def _integer(value: int, name: str, *, minimum: int = 0) -> int:
    try:
        converted = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{name} must be an integer >= {minimum}") from None
    if isinstance(value, bool) or converted != value or converted < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return converted


def _bounded(value: float, name: str, lower: float, upper: float) -> float:
    result = _finite(value, name)
    if not lower <= result <= upper:
        raise UnsupportedRADCModelError(
            f"{name}={result:g} is outside the report domain {lower:g}–{upper:g}"
        )
    return result


def _quality(value: str, table: Mapping[str, float], name: str = "quality") -> tuple[str, float]:
    aliases = {_canonical(key, name): key for key in table}
    normalized = _canonical(value, name)
    if normalized not in aliases:
        raise UnsupportedRADCModelError(
            f"{name} must be one of {list(table)}, got {value!r}"
        )
    source_key = aliases[normalized]
    return source_key, float(table[source_key])


def _step(
    symbol: str,
    description: str,
    expression: str,
    substitution: str,
    value: float,
    unit: str = "dimensionless",
) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "description": description,
        "expression": expression,
        "substitution": substitution,
        "value": float(value),
        "unit": unit,
    }


def _result(
    rate: float,
    *,
    model: str,
    section: str,
    pages: str,
    tables: Sequence[str],
    equation: str,
    factors: Mapping[str, Any],
    steps: Sequence[Mapping[str, Any]],
    inputs: Mapping[str, Any],
    assumptions: Sequence[str] = (),
    warnings: Sequence[str] = (),
) -> NonoperatingPrediction:
    rate = _nonnegative(rate, "calculated failure rate")
    return NonoperatingPrediction(
        failure_rate=rate,
        model=model,
        factors=dict(factors),
        traceability={
            "source": REPORT_EDITION,
            "document_number": "RADC-TR-85-91",
            "accession": "AD-A158843",
            "report_section": section,
            "appendix_pages": pages,
            "tables": list(tables),
            "equation": equation,
            "unit": FPMH,
            "authority_role": "related primary nonoperating extension",
            "support_status": "supported",
            "assurance_status": "verified report transcription",
            "conformance_scope": "RADC-TR-85-91 Appendix A; not MIL-HDBK-217F Notice 2",
            "applicability": "nonoperating electronic equipment except satellite applications",
            "source_model_maturity": "mixed empirical, preliminary, theoretical, and extrapolated factors",
        },
        steps=tuple(dict(step) for step in steps),
        assumptions=tuple(assumptions),
        warnings=tuple(dict.fromkeys((*warnings, _GENERAL_WARNING))),
        inputs=dict(inputs),
    )


def _cycling_factor(
    cycles: float, *, threshold: float, coefficient: float, inclusive: bool = False,
) -> float:
    cycles = _bounded(cycles, "power_cycles_per_1000h", 0.0, 50.0)
    below_threshold = cycles <= threshold if inclusive else cycles < threshold
    return 1.0 if below_threshold else 1.0 + coefficient * cycles


def nonoperating_reliability(exposures: Sequence[tuple[float, float]]) -> float:
    """Appendix A §5.2.1 equation (1), ``exp(-sum(lambda_n t_n))``."""
    total = 0.0
    for index, (rate, hours) in enumerate(exposures):
        total += _nonnegative(rate, f"exposures[{index}].rate") * _nonnegative(
            hours, f"exposures[{index}].hours"
        ) / 1_000_000.0
    return math.exp(-total)


def service_life_failure_rate(
    operating_exposures: Sequence[tuple[float, float]],
    nonoperating_exposures: Sequence[tuple[float, float]],
) -> float:
    """Appendix A §5.2.1 equation (2), duty-fraction weighted FPMH."""
    total_rate = 0.0
    total_fraction = 0.0
    for label, exposures in (
        ("operating_exposures", operating_exposures),
        ("nonoperating_exposures", nonoperating_exposures),
    ):
        for index, (fraction, rate) in enumerate(exposures):
            fraction = _nonnegative(fraction, f"{label}[{index}].fraction")
            if fraction > 1:
                raise ValueError(f"{label}[{index}].fraction must be <= 1")
            total_fraction += fraction
            total_rate += fraction * _nonnegative(rate, f"{label}[{index}].rate")
    if not math.isclose(total_fraction, 1.0, rel_tol=0.0, abs_tol=1e-12):
        raise ValueError(f"duty fractions must sum to 1, got {total_fraction:g}")
    return total_rate


def combined_reliability(
    operating_exposures: Sequence[tuple[float, float]],
    nonoperating_exposures: Sequence[tuple[float, float]],
) -> float:
    """Appendix A §5.2.1 equation (3), combined mission reliability."""
    exponent = 0.0
    for label, exposures in (
        ("operating_exposures", operating_exposures),
        ("nonoperating_exposures", nonoperating_exposures),
    ):
        for index, (rate, hours) in enumerate(exposures):
            exponent += _nonnegative(rate, f"{label}[{index}].rate") * _nonnegative(
                hours, f"{label}[{index}].hours"
            ) / 1_000_000.0
    return math.exp(-exponent)


# ---------------------------------------------------------------------------
# Appendix A §5.2.2 — microelectronic devices
# ---------------------------------------------------------------------------

_MICRO_TEMP = {
    "ttl_httl_dtl_ecl": (4813.0, .91, .09),
    "lttl_sttl": (5261.0, .90, .10),
    "lsttl": (5711.0, .89, .11),
    "iil": (6607.0, .86, .14),
    "mnos": (6607.0, .61, .39),
    "pmos": (5711.0, .68, .32),
    "nmos_ccd": (6159.0, .65, .35),
    "cmos_cmos_sos": (7057.0, .58, .42),
    "linear": (4748.0, .50, .50),
}
_MICRO_TECH_ALIASES = {
    "ttl": "ttl_httl_dtl_ecl", "httl": "ttl_httl_dtl_ecl",
    "dtl": "ttl_httl_dtl_ecl", "ecl": "ttl_httl_dtl_ecl",
    "ttl_httl_dtl_ecl": "ttl_httl_dtl_ecl",
    "lttl": "lttl_sttl", "sttl": "lttl_sttl", "lsttl": "lsttl",
    "lttl_sttl": "lttl_sttl",
    "iil": "iil", "mnos": "mnos", "pmos": "pmos", "nmos": "nmos_ccd",
    "ccd": "nmos_ccd", "nmos_ccd": "nmos_ccd", "cmos": "cmos_cmos_sos",
    "cmos_sos": "cmos_cmos_sos", "cmos_cmos_sos": "cmos_cmos_sos",
    "linear": "linear",
}
_MICRO_QUALITY = {"S": .53, "B": 1.0, "B-1": 1.4, "B-2": 2.0,
                  "C": 2.3, "C-1": 2.4, "D": 2.5, "D-1": 8.7}
_MICRO_ENV_HERMETIC = _env([
    1, 2.4, 3.5, 3.2, 3.4, 3.4, 4.5, 4.6, 4.9, 6.3,
    2.4, 2.7, 4.0, 3.4, 4.7, 2.7, 3.4, 5.7, 4.7, 6.7,
    1.0, 3.3, 4.3, 8.0, 9.3, 150,
])
_MICRO_ENV_NONHERMETIC = _env([
    1, 4.0, 6.5, 5.9, 6.2, 6.2, 8.6, 8.9, 9.5, 13,
    4.0, 4.7, 7.6, 6.2, 9.0, 2.7, 3.4, 11, 9.0, 13,
    1.0, 6.0, 8.2, 16, 19, 310,
])


def _micro_temperature(technology: str, temperature_c: float) -> tuple[str, float]:
    normalized = _canonical(technology, "technology")
    tech = _MICRO_TECH_ALIASES.get(normalized)
    if tech is None:
        raise UnsupportedRADCModelError(
            f"technology must be one of {sorted(_MICRO_TECH_ALIASES)}, got {technology!r}"
        )
    temperature = _bounded(temperature_c, "temperature_c", 0.0, 160.0)
    coefficient, k1, k2 = _MICRO_TEMP[tech]
    exponent = -coefficient * (1.0 / (temperature + 273.0) - 1.0 / 298.0)
    return tech, k1 + k2 * math.exp(exponent)


def microelectronic_device(
    device_type: str,
    technology: str,
    package: str,
    quality: str,
    environment: str,
    temperature_c: float,
    power_cycles_per_1000h: float,
    complexity: int | None = None,
) -> NonoperatingPrediction:
    """Sections 5.2.2.1–5.2.2.5 monolithic digital, linear, and memory model."""
    device = _choice(device_type, ("digital", "linear", "memory"), "device_type")
    package_key = _choice(package, ("hermetic", "nonhermetic"), "package")
    tech, pi_nt = _micro_temperature(technology, temperature_c)
    if device == "linear" and tech != "linear":
        raise UnsupportedRADCModelError("linear devices require technology='linear'")
    if device != "linear" and tech == "linear":
        raise UnsupportedRADCModelError("technology='linear' is valid only for linear devices")

    assumptions: list[str] = []
    if device == "digital":
        gates = _integer(complexity, "complexity", minimum=1)  # type: ignore[arg-type]
        lambda_nb = .00029 * gates ** .477 if gates <= 3100 else .014
        complexity_step = _step(
            "lambda_Nb", "gate-count base rate",
            ".00029 N_g^.477 (N_g<=3100); .014 (N_g>3100)",
            f"N_g={gates}", lambda_nb, FPMH,
        )
        model = "monolithic digital microelectronic device"
    elif device == "linear":
        transistors = _integer(complexity, "complexity", minimum=4)  # type: ignore[arg-type]
        if transistors > 1000:
            raise UnsupportedRADCModelError(
                "linear-device transistor count exceeds Table 5.2.2.4-2 maximum of 1000"
            )
        lambda_nb = .00021 * transistors ** .887
        complexity_step = _step(
            "lambda_Nb", "transistor-count base rate", ".00021 N_t^.887",
            f"N_t={transistors}", lambda_nb, FPMH,
        )
        model = "monolithic linear/interface microelectronic device"
    else:
        bipolar_technologies = {
            "ttl_httl_dtl_ecl", "lttl_sttl", "lsttl", "iil",
        }
        lambda_nb = .0034 if tech in bipolar_technologies else .0017
        complexity_step = _step(
            "lambda_Nb", "technology base rate", ".0034 bipolar; .0017 MOS",
            "bipolar" if tech in bipolar_technologies else "MOS", lambda_nb, FPMH,
        )
        model = "monolithic memory device"
        if complexity is not None:
            _integer(complexity, "complexity", minimum=1)
            assumptions.append(
                "The report's memory base rate is technology-based and does not use memory capacity."
            )

    quality_key, pi_nq = _quality(quality, _MICRO_QUALITY)
    pi_ne = _environment(
        environment,
        _MICRO_ENV_HERMETIC if package_key == "hermetic" else _MICRO_ENV_NONHERMETIC,
    )
    cycles = _bounded(power_cycles_per_1000h, "power_cycles_per_1000h", 0, 50)
    coefficient = .031 if device == "linear" else .02
    pi_cyc = _cycling_factor(
        cycles, threshold=1.0, coefficient=coefficient,
    )
    rate = lambda_nb * pi_nt * pi_nq * pi_ne * pi_cyc
    factors = {
        "lambda_Nb": lambda_nb, "pi_NT": pi_nt, "pi_NQ": pi_nq,
        "pi_NE": pi_ne, "pi_cyc": pi_cyc,
    }
    inputs = {
        "device_type": device, "technology": tech, "complexity": complexity,
        "package": package_key, "quality": quality_key, "environment": environment,
        "temperature_c": float(temperature_c),
        "power_cycles_per_1000h": cycles,
    }
    steps = [
        complexity_step,
        _step("pi_NT", "ambient nonoperating temperature factor",
              "K1+K2 exp[-A_n(1/(T+273)-1/298)]", f"technology={tech}, T={temperature_c:g} C", pi_nt),
        _step("pi_NQ", "quality factor", "Table 5.2.2.4-5", quality_key, pi_nq),
        _step("pi_NE", "environment factor", "Table 5.2.2.4-8", f"{environment}, {package_key}", pi_ne),
        _step("pi_cyc", "equipment power-cycling factor", f"1+{coefficient:g}N_c",
              f"N_c={cycles:g}", pi_cyc),
        _step("lambda_N", "nonoperating failure rate", "lambda_Nb pi_NT pi_NQ pi_NE pi_cyc",
              "product of listed factors", rate, FPMH),
    ]
    return _result(
        rate, model=model, section=f"5.2.2.{ {'digital':'1','linear':'2','memory':'3'}[device] }",
        pages="A-5–A-17", tables=("5.2.2.4-1/2", "5.2.2.4-3–8"),
        equation="lambda_N = lambda_Nb pi_NT pi_NQ pi_NE pi_cyc",
        factors=factors, steps=steps, inputs=inputs, assumptions=assumptions,
    )


_HYBRID_QUALITY = {"S": .53, "B": 1.0, "D": 8.6}
_HYBRID_ENV = dict(_MICRO_ENV_HERMETIC)
_HYBRID_ENV["SF"] = 1.3


def hybrid_microcircuit(
    diodes: int,
    transistors: int,
    integrated_circuits: int,
    quality: str,
    environment: str,
) -> NonoperatingPrediction:
    """Section 5.2.2.6 hybrid microcircuit model."""
    nd = _integer(diodes, "diodes")
    nt = _integer(transistors, "transistors")
    nic = _integer(integrated_circuits, "integrated_circuits")
    if nd + nt + nic == 0:
        raise ValueError("the hybrid must contain at least one counted device")
    discriminator = nd + nt + 1.8 * nic
    if math.isclose(discriminator, 12.2, rel_tol=0.0, abs_tol=1e-12):
        raise UnsupportedRADCModelError(
            "Table 5.2.2.6-1 defines cases below and above 12.2 but not exactly 12.2"
        )
    if discriminator < 12.2:
        case, a, b1, b2, b3 = "I", .000817, .45, .45, .81
    else:
        case, a, b1, b2, b3 = "II", .013, .033, .033, .059
    lambda_nb = a * math.exp(b1 * nd + b2 * nt + b3 * nic)
    quality_key, pi_nq = _quality(quality, _HYBRID_QUALITY)
    pi_ne = _environment(environment, _HYBRID_ENV)
    rate = lambda_nb * pi_nq * pi_ne
    factors = {"lambda_Nb": lambda_nb, "pi_NQ": pi_nq, "pi_NE": pi_ne,
               "complexity_case": case}
    inputs = {"diodes": nd, "transistors": nt, "integrated_circuits": nic,
              "quality": quality_key, "environment": environment}
    steps = [
        _step("lambda_Nb", "hybrid base rate", "A exp(b1 N_D+b2 N_T+b3 N_IC)",
              f"case {case}; N_D={nd}, N_T={nt}, N_IC={nic}", lambda_nb, FPMH),
        _step("pi_NQ", "quality factor", "Table 5.2.2.6-2", quality_key, pi_nq),
        _step("pi_NE", "environment factor", "Table 5.2.2.6-3", environment, pi_ne),
        _step("lambda_N", "hybrid nonoperating rate", "lambda_Nb pi_NQ pi_NE",
              "product of listed factors", rate, FPMH),
    ]
    return _result(
        rate, model="hybrid microcircuit", section="5.2.2.6", pages="A-18–A-22",
        tables=("5.2.2.6-1", "5.2.2.6-2", "5.2.2.6-3"),
        equation="lambda_N = lambda_Nb pi_NQ pi_NE", factors=factors,
        steps=steps, inputs=inputs,
        assumptions=("Capacitors, packaged/substrate resistors, substrate, and interconnections are included in the base-rate fit.",),
    )


def magnetic_bubble_memory(
    transfer_gates: int,
    dissipative_control_gates: int,
    major_loops: int,
    functional_minor_loops: int,
    temperature_c: float,
    environment: str,
) -> NonoperatingPrediction:
    """Section 5.2.2.7 two-structure magnetic bubble memory model."""
    transfer = _integer(transfer_gates, "transfer_gates")
    dissipative = _integer(dissipative_control_gates, "dissipative_control_gates")
    major = _integer(major_loops, "major_loops", minimum=1)
    minor = _integer(functional_minor_loops, "functional_minor_loops")
    ng = transfer + dissipative + major
    loops = major + minor
    _, pi_nt = _micro_temperature("nmos", temperature_c)
    pi_ne = _environment(environment, _MICRO_ENV_NONHERMETIC)
    lambda_nb1 = .0015 * ng ** .477
    lambda_n1 = lambda_nb1 * pi_nt * pi_ne
    lambda_n2 = .0089 * loops * pi_nt * pi_ne
    rate = lambda_n1 + lambda_n2
    factors = {
        "N_g": ng, "N_L": loops, "lambda_Nb1": lambda_nb1,
        "pi_NT": pi_nt, "pi_NE": pi_ne, "lambda_N1": lambda_n1,
        "lambda_N2": lambda_n2,
    }
    inputs = {
        "transfer_gates": transfer, "dissipative_control_gates": dissipative,
        "major_loops": major, "functional_minor_loops": minor,
        "temperature_c": float(temperature_c), "environment": environment,
    }
    steps = [
        _step("lambda_Nb1", "control-structure base rate", ".0015 N_g^.477", f"N_g={ng}", lambda_nb1, FPMH),
        _step("lambda_N1", "control-structure rate", "lambda_Nb1 pi_NT pi_NE", "product", lambda_n1, FPMH),
        _step("lambda_N2", "magnetic-memory structure rate", ".0089 N_L pi_NT pi_NE", f"N_L={loops}", lambda_n2, FPMH),
        _step("lambda_N", "bubble-memory rate", "lambda_N1+lambda_N2", "sum", rate, FPMH),
    ]
    return _result(
        rate, model="magnetic bubble memory", section="5.2.2.7", pages="A-23–A-26",
        tables=("5.2.2.4-3", "5.2.2.4-4", "5.2.2.4-8"),
        equation="lambda_N = lambda_Nb1 pi_NT pi_NE + .0089 N_L pi_NT pi_NE",
        factors=factors, steps=steps, inputs=inputs,
        assumptions=("Both structures use the report's NMOS/CCD temperature factor and nonhermetic environment factor.",),
    )


# ---------------------------------------------------------------------------
# Appendix A §5.2.3 — discrete semiconductors
# ---------------------------------------------------------------------------

# part type: (group, base rate, temperature parameter key, cycling family)
_DISCRETE_PARTS = {
    "si_npn": ("I", .00027, "si_npn", "transistor"),
    "si_pnp": ("I", .00027, "si_pnp", "transistor"),
    "ge_pnp": ("I", .00040, "ge_pnp", "transistor"),
    "ge_npn": ("I", .00040, "ge_npn", "transistor"),
    "fet": ("II", .00039, "fet", "transistor"),
    "unijunction": ("III", .0013, "unijunction", "transistor"),
    "si_general_purpose_diode": ("IV", .00017, "si_general_purpose_diode", "diode"),
    "ge_general_purpose_diode": ("IV", .00042, "ge_general_purpose_diode", "diode"),
    "zener_avalanche": ("V", .00040, "zener_avalanche", "diode"),
    "thyristor": ("VI", .00063, "thyristor", "diode"),
    "microwave_detector": ("VII", .0027, "microwave", "diode"),
    "microwave_mixer": ("VII", .0027, "microwave", "diode"),
    "impatt": ("VIII", .0027, "special_microwave", "diode"),
    "gunn": ("VIII", .0027, "special_microwave", "diode"),
    "varactor": ("VIII", .0027, "special_microwave", "diode"),
    "pin": ("VIII", .0027, "special_microwave", "diode"),
    "step_recovery": ("VIII", .0027, "special_microwave", "diode"),
    "tunnel": ("VIII", .0027, "special_microwave", "diode"),
    "microwave_transistor": ("IX", .041, "microwave_transistor", "transistor"),
    "led": ("X", .00016, None, "optoelectronic"),
    "single_isolator": ("X", .00070, None, "optoelectronic"),
    "dual_isolator": ("X", .00089, None, "optoelectronic"),
    "phototransistor": ("X", .00038, None, "optoelectronic"),
    "photodiode": ("X", .00029, None, "optoelectronic"),
    "alpha_numeric_display": ("X", .00025, None, "optoelectronic"),
}

# A_t, T_M, P, maximum tabulated ambient temperature in Table 5.2.3-2/-3.
_DISCRETE_TEMP = {
    "si_npn": (3356.0, 448.0, 10.5, 160.0),
    "si_pnp": (3541.0, 448.0, 14.2, 160.0),
    "ge_pnp": (4403.0, 373.0, 20.8, 90.0),
    "ge_npn": (4482.0, 373.0, 19.0, 90.0),
    "fet": (3423.0, 448.0, 13.8, 130.0),
    "unijunction": (4040.0, 448.0, 13.8, 160.0),
    "si_general_purpose_diode": (4399.0, 448.0, 17.7, 160.0),
    "ge_general_purpose_diode": (5829.0, 373.0, 22.5, 90.0),
    "zener_avalanche": (3061.0, 448.0, 14.0, 160.0),
    "thyristor": (4311.0, 448.0, 9.6, 160.0),
    "microwave": (2738.0, 423.0, 16.6, 135.0),
    "special_microwave": (3423.0, 448.0, 13.8, 160.0),
    "microwave_transistor": (5700.0, 623.0, 20.0, 160.0),
}
_DISCRETE_QUALITY = {
    "JANTXV": .57, "JANTX": 1.0, "JAN": 3.6,
    "Lower, Hermetic": 13.0, "Plastic": 23.0,
}
_DISCRETE_GROUPS = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X")
_DISCRETE_ENV_ROWS = {
    "GB": (1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
    "GF": (5.8, 4.0, 4.0, 3.9, 3.9, 3.9, 6.4, 3.9, 2.0, 2.4),
    "GM": (18, 18, 18, 18, 18, 18, 31, 18, 7.8, 7.8),
    "Mp": (12, 12, 12, 12, 12, 12, 35, 12, 7.4, 7.7),
    "NSB": (9.8, 6.0, 9.3, 4.8, 5.8, 5.8, 8.0, 5.8, 3.6, 3.7),
    "NS": (9.8, 8.6, 9.3, 4.8, 8.7, 8.7, 11, 8.7, 4.7, 5.7),
    "NU": (21, 21, 21, 21, 21, 21, 33, 21, 11, 11),
    "NH": (19, 19, 19, 19, 19, 19, 54, 19, 11, 12),
    "NUU": (20, 20, 20, 20, 20, 20, 58, 20, 12, 13),
    "ARW": (27, 27, 27, 27, 27, 27, 78, 27, 16, 17),
    "AIC": (9.5, 7.5, 9.5, 15, 4.5, 9.5, 30, 4.5, 2.5, 2.5),
    "AIT": (15, 9, 15, 20, 6.5, 15, 40, 6.5, 3.5, 3.5),
    "AIB": (35, 35, 35, 30, 45, 35, 65, 45, 6.0, 5.5),
    "AIA": (20, 30, 20, 25, 25, 20, 50, 25, 3.5, 3.5),
    "AIF": (40, 40, 40, 35, 45, 40, 70, 45, 6.0, 5.5),
    "AUC": (15, 10, 15, 25, 7.5, 15, 50, 7.5, 5.0, 3.0),
    "AUT": (25, 15, 25, 30, 10, 25, 60, 10, 7.0, 5.5),
    "AUB": (60, 55, 60, 50, 70, 60, 105, 70, 10, 8.0),
    "AUA": (35, 50, 35, 40, 40, 35, 80, 40, 7.0, 5.5),
    "AUF": (65, 65, 65, 50, 70, 65, 110, 70, 10, 10),
    "SF": (1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
    "MFF": (12, 12, 12, 12, 12, 12, 36, 12, 7.5, 7.8),
    "MFA": (17, 17, 17, 17, 17, 17, 50, 17, 11, 11),
    "USL": (36, 36, 36, 36, 36, 36, 110, 36, 22, 23),
    "ML": (41, 41, 41, 41, 41, 41, 120, 41, 25, 26),
    "CL": (690, 690, 690, 690, 690, 690, 2000, 690, 250, 450),
}
_DISCRETE_ENV = {
    group: {environment: row[index] for environment, row in _DISCRETE_ENV_ROWS.items()}
    for index, group in enumerate(_DISCRETE_GROUPS)
}


def _discrete_temperature(parameter_key: str, temperature_c: float) -> float:
    at, tm, p, maximum = _DISCRETE_TEMP[parameter_key]
    temperature = _bounded(temperature_c, "temperature_c", 0.0, maximum)
    absolute = temperature + 273.0
    exponent = -at * (1.0 / absolute - 1.0 / 298.0) + (absolute / tm) ** p
    if exponent > 709:
        raise ValueError("discrete temperature-factor exponent exceeds floating-point range")
    return math.exp(exponent)


def discrete_semiconductor(
    part_type: str,
    quality: str,
    environment: str,
    temperature_c: float | None = None,
    power_cycles_per_1000h: float | None = None,
) -> NonoperatingPrediction:
    """Sections 5.2.3.1–5.2.3.2 discrete semiconductor models."""
    part = _choice(part_type, _DISCRETE_PARTS, "part_type")
    group, lambda_nb, temperature_key, family = _DISCRETE_PARTS[part]
    quality_key, pi_nq = _quality(quality, _DISCRETE_QUALITY)
    pi_ne = _environment(environment, _DISCRETE_ENV[group])
    warnings: list[str] = []
    assumptions: list[str] = []

    if family == "optoelectronic":
        pi_nt = 1.0
        pi_cyc = 1.0
        if temperature_c is not None or power_cycles_per_1000h is not None:
            assumptions.append(
                "Section 5.2.3.2 does not apply temperature or equipment-cycling factors to optoelectronic devices."
            )
        equation = "lambda_N = lambda_Nb pi_NE pi_NQ"
    else:
        if temperature_c is None:
            raise ValueError("temperature_c is required for transistor and diode models")
        if power_cycles_per_1000h is None:
            raise ValueError("power_cycles_per_1000h is required for transistor and diode models")
        pi_nt = _discrete_temperature(temperature_key, temperature_c)  # type: ignore[arg-type]
        cycles = _bounded(power_cycles_per_1000h, "power_cycles_per_1000h", 0, 50)
        if family == "transistor":
            pi_cyc = _cycling_factor(cycles, threshold=1.0, coefficient=.050)
        else:
            pi_cyc = _cycling_factor(cycles, threshold=.6, coefficient=.083)
        equation = "lambda_N = lambda_Nb pi_NT pi_NE pi_NQ pi_cyc"
        warnings.append(
            "The implementation evaluates the printed continuous temperature equation. "
            "Table 5.2.3-2/3 entries are rounded and print 1.00 at 25 C even where "
            "the equation evaluates slightly above one."
        )

    rate = lambda_nb * pi_nt * pi_ne * pi_nq * pi_cyc
    factors = {
        "group": group, "lambda_Nb": lambda_nb, "pi_NT": pi_nt,
        "pi_NE": pi_ne, "pi_NQ": pi_nq, "pi_cyc": pi_cyc,
    }
    inputs = {
        "part_type": part, "quality": quality_key, "environment": environment,
        "temperature_c": temperature_c,
        "power_cycles_per_1000h": power_cycles_per_1000h,
    }
    steps = [
        _step("lambda_Nb", "part-type base rate", "Table 5.2.3-1", part, lambda_nb, FPMH),
    ]
    if family != "optoelectronic":
        steps.extend((
            _step("pi_NT", "ambient temperature factor", "exp[-A_t(1/T-1/298)+(T/T_M)^P]",
                  f"T={temperature_c:g} C", pi_nt),
            _step("pi_cyc", "equipment power-cycling factor", "Table 5.2.3-7/8 equation",
                  f"N_c={power_cycles_per_1000h:g}", pi_cyc),
        ))
    steps.extend((
        _step("pi_NE", "environment factor", "Table 5.2.3-5", f"group {group}, {environment}", pi_ne),
        _step("pi_NQ", "quality factor", "Table 5.2.3-6", quality_key, pi_nq),
        _step("lambda_N", "discrete-semiconductor nonoperating rate", equation,
              "product of applicable factors", rate, FPMH),
    ))
    return _result(
        rate, model=f"discrete semiconductor — {part}",
        section="5.2.3.2" if family == "optoelectronic" else "5.2.3.1",
        pages="A-27–A-36", tables=("5.2.3-1", "5.2.3-2–8"), equation=equation,
        factors=factors, steps=steps, inputs=inputs, assumptions=assumptions,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Appendix A §§5.2.4–5.2.5 — tubes and lasers
# ---------------------------------------------------------------------------

_TUBE_BASE = {
    "receiver_triode_tetrode_pentode": .0040,
    "receiver_power_rectifier": .0090,
    "crt": .013,
    "thyratron": .32,
    "vidicon": .049,
    "crossed_field_amplifier": 1.29,
    "pulsed_gridded": 1.03,
    "transmitting_triode_tetrode_pentode": .56,
    "transmitting_under_200kw_200mhz_or_2kw_average": 1.61,
    "twystron": 2.60,
    "magnetron": 1.02,
    "klystron_continuous_wave": 1.20,
    "klystron_low_power": .19,
    "klystron_pulsed": 1.15,
    "twt": .69,
}
_TUBE_ENV = _env([
    1, 3.0, 31, 31, 15, 29, 47, 110, 120, 140,
    6.2, 19, 25, 23, 35, 8.2, 23, 33, 27, 43,
    1, 63, 91, 210, 220, 3600,
])


def tube(tube_type: str, environment: str) -> NonoperatingPrediction:
    """Section 5.2.4 electronic-vacuum and microwave tube model."""
    kind = _choice(tube_type, _TUBE_BASE, "tube_type")
    lambda_nb = _TUBE_BASE[kind]
    pi_ne = _environment(environment, _TUBE_ENV)
    rate = lambda_nb * pi_ne
    factors = {"lambda_Nb": lambda_nb, "pi_NE": pi_ne}
    inputs = {"tube_type": kind, "environment": environment}
    steps = [
        _step("lambda_Nb", "tube base rate", "Table 5.2.4-1", kind, lambda_nb, FPMH),
        _step("pi_NE", "environment factor", "Table 5.2.4-2", environment, pi_ne),
        _step("lambda_N", "tube nonoperating rate", "lambda_Nb pi_NE", "product", rate, FPMH),
    ]
    return _result(
        rate, model=f"tube — {kind}", section="5.2.4", pages="A-37–A-39",
        tables=("5.2.4-1", "5.2.4-2"), equation="lambda_N = lambda_Nb pi_NE",
        factors=factors, steps=steps, inputs=inputs,
    )


_LASER_ENV = _env([
    1, 9.0, 44, 22, 10, 49, 49, 35, 38, 46,
    26, 35, 58, 44, 62, 35, 42, 71, 57, 71,
    1, 21, 29, 69, 71, None,
])
_LASER_TYPES = (
    "helium_neon", "argon_ion", "co2_sealed", "co2_flowing", "solid_state",
)


def laser(
    laser_type: str,
    environment: str,
    active_optical_surfaces: int | None = None,
) -> NonoperatingPrediction:
    """Section 5.2.5 functional-level laser-peculiar-item models."""
    kind = _choice(laser_type, _LASER_TYPES, "laser_type")
    pi_ne = _environment(environment, _LASER_ENV)
    if kind == "helium_neon":
        lambda_nb = .11
        rate = lambda_nb * pi_ne
        equation = "lambda_N = .11 pi_NE"
        surfaces = None
    elif kind == "argon_ion":
        lambda_nb = .61
        rate = lambda_nb * pi_ne
        equation = "lambda_N = .61 pi_NE"
        surfaces = None
    else:
        if active_optical_surfaces is None:
            raise ValueError("active_optical_surfaces is required for this laser model")
        surfaces = _integer(active_optical_surfaces, "active_optical_surfaces", minimum=1)
        if kind == "co2_sealed":
            lambda_nb = .65 + .013 * surfaces
            equation = "lambda_N = (.65 + .013 N_op) pi_NE"
        elif kind == "co2_flowing":
            lambda_nb = .039 * surfaces
            equation = "lambda_N = .039 N_op pi_NE"
        else:
            lambda_nb = .062 + .021 * surfaces
            equation = "lambda_N = (.062 + .021 N_op) pi_NE"
        rate = lambda_nb * pi_ne
    factors = {"lambda_function": lambda_nb, "N_op": surfaces, "pi_NE": pi_ne}
    inputs = {
        "laser_type": kind, "environment": environment,
        "active_optical_surfaces": surfaces,
    }
    steps = [
        _step("lambda_function", "laser functional base contribution", equation.split(" pi_NE")[0],
              f"N_op={surfaces}" if surfaces is not None else kind, lambda_nb, FPMH),
        _step("pi_NE", "environment factor", "Table 5.2.5-1", environment, pi_ne),
        _step("lambda_N", "laser nonoperating rate", equation, "substituted values", rate, FPMH),
    ]
    return _result(
        rate, model=f"laser — {kind}", section="5.2.5", pages="A-40–A-44",
        tables=("5.2.5-1",), equation=equation, factors=factors, steps=steps,
        inputs=inputs,
        assumptions=(
            "The model covers laser-peculiar lasing media, pump, and coupling functions; supporting electronics and mechanical devices are calculated separately.",
        ),
        warnings=(
            "The report developed laser models at the functional rather than piece-part level because available data were insufficient.",
        ),
    )


# ---------------------------------------------------------------------------
# Appendix A §§5.2.6–5.2.7 — resistors and capacitors
# ---------------------------------------------------------------------------

# style: (base rate, environment-family)
_RESISTOR_STYLES = {
    "RC": (.000063, "fixed_composition"),
    "RCR": (.000063, "fixed_composition"),
    "RN": (.00010, "fixed_film"),
    "RD": (.00010, "fixed_film"),
    "RL": (.00010, "fixed_film"),
    "RLR": (.00010, "fixed_film"),
    "RZ": (.00043, "film_network"),
    "RW": (.00057, "fixed_wirewound"),
    "RB": (.00057, "fixed_wirewound"),
    "RBR": (.00057, "fixed_wirewound"),
    "RE": (.00057, "fixed_wirewound"),
    "RWR": (.00057, "fixed_wirewound"),
    "RER": (.00057, "fixed_wirewound"),
    "RTH": (.0027, "thermistor"),
    "RV": (.0052, "variable_nonwirewound"),
    "RJ": (.0052, "variable_nonwirewound"),
    "RVC": (.0052, "variable_nonwirewound"),
    "RQ": (.0052, "variable_nonwirewound"),
    "RJR": (.0052, "variable_nonwirewound"),
    "RA": (.0052, "variable_wirewound"),
    "RP": (.0052, "variable_wirewound"),
    "RR": (.0052, "variable_wirewound"),
    "RT": (.00099, "variable_wirewound"),
    "RK": (.0052, "variable_wirewound"),
    "RTR": (.00099, "variable_wirewound"),
}
_RESISTOR_ENV_FAMILIES = (
    "fixed_composition", "fixed_film", "film_network", "fixed_wirewound",
    "thermistor", "variable_nonwirewound", "variable_wirewound",
)
_RESISTOR_ENV_ROWS = {
    "GB": (1, 1, 1, 1, 1, 1, 1),
    "GF": (2.9, 2.4, 2.4, 2.1, 4.8, 2.5, 2.5),
    "GM": (8.3, 8.3, 7.8, 8.8, 23, 13, 13),
    "Mp": (8.5, 9.9, 8.8, 11, 17, 19, 18),
    "NSB": (4, 4.7, 4.2, 5, 7.9, 7, 7),
    "NS": (5.2, 4.9, 4.7, 5, 14, 7, 7),
    "NU": (12, 15, 14, 15, 17, 17, 14),
    "NH": (13, 16, 14, 17, 25, 29, 29),
    "NUU": (14, 17, 15, 18, 27, 31, 31),
    "ARW": (19, 22, 19, 24, 33, 41, 41),
    "AIC": (3, 3, 2.5, 4.3, 4.3, 12, 5.5),
    "AIT": (3.5, 4.5, 3, 7.3, 7.7, 16, 6.6),
    "AIB": (5, 6.8, 6.5, 12, 19, 24, 9.5),
    "AIA": (3.5, 5.8, 6, 9.7, 15, 22, 8.6),
    "AIF": (6.5, 9.5, 9, 13, 38, 33, 14),
    "AUC": (5, 7.5, 6, 10, 4.6, 19, 6.5),
    "AUT": (7, 11, 6.5, 13, 8.6, 25, 9),
    "AUB": (10, 18, 15, 23, 21, 37, 18),
    "AUA": (7, 13, 15, 18, 17, 32, 13),
    "AUF": (15, 23, 20, 28, 42, 52, 20),
    "SF": (1, 1, 1, 1, 1, 1, 1),
    "MFF": (8.6, 10, 8.9, 11, 15, 19, 20),
    "MFA": (13, 14, 12, 16, 21, 26, 28),
    "USL": (25, 30, 26, 33, 49, 56, 58),
    "ML": (29, 35, 30, 38, 51, 64, 66),
    "CL": (490, 590, 510, 610, 950, 1100, 1100),
}
_RESISTOR_ENV = {
    family: {environment: row[index] for environment, row in _RESISTOR_ENV_ROWS.items()}
    for index, family in enumerate(_RESISTOR_ENV_FAMILIES)
}
_RESISTOR_QUALITY = {
    "S": .15, "R": .28, "P": .52, "M": 1.0, "MIL-SPEC": 2.4, "Lower": 4.4,
}
_RESISTOR_PROHIBITED_VARIABLE_WW = {
    "NU", "AUC", "AUT", "AUB", "AUA", "AUF", "MFF", "MFA", "USL", "ML", "CL",
}


def resistor(
    style: str,
    quality: str,
    environment: str,
    power_cycles_per_1000h: float,
) -> NonoperatingPrediction:
    """Section 5.2.6 resistor model, keyed by the report's MIL style."""
    style_key = style.strip().upper() if isinstance(style, str) else ""
    if style_key not in _RESISTOR_STYLES:
        raise UnsupportedRADCModelError(
            f"style must be one of {sorted(_RESISTOR_STYLES)}, got {style!r}"
        )
    lambda_nb, family = _RESISTOR_STYLES[style_key]
    if style_key in {"RP", "RK"} and environment in _RESISTOR_PROHIBITED_VARIABLE_WW:
        raise UnsupportedRADCModelError(
            f"Table 5.2.6-2 prohibits semiprecision/high-power variable wirewound style {style_key} in {environment}"
        )
    quality_key, pi_nq = _quality(quality, _RESISTOR_QUALITY)
    pi_ne = _environment(environment, _RESISTOR_ENV[family])
    cycles = _bounded(power_cycles_per_1000h, "power_cycles_per_1000h", 0, 50)
    pi_cyc = _cycling_factor(cycles, threshold=.8, coefficient=.063)
    rate = lambda_nb * pi_ne * pi_nq * pi_cyc
    factors = {"lambda_Nb": lambda_nb, "pi_NE": pi_ne, "pi_NQ": pi_nq, "pi_cyc": pi_cyc}
    inputs = {"style": style_key, "quality": quality_key, "environment": environment,
              "power_cycles_per_1000h": cycles}
    steps = [
        _step("lambda_Nb", "resistor base rate", "Table 5.2.6-1", style_key, lambda_nb, FPMH),
        _step("pi_NE", "environment factor", "Table 5.2.6-2", f"{family}, {environment}", pi_ne),
        _step("pi_NQ", "quality factor", "Table 5.2.6-3", quality_key, pi_nq),
        _step("pi_cyc", "equipment power-cycling factor", "1+.063 N_c", f"N_c={cycles:g}", pi_cyc),
        _step("lambda_N", "resistor nonoperating rate", "lambda_Nb pi_NE pi_NQ pi_cyc", "product", rate, FPMH),
    ]
    warnings = ()
    if style_key == "RCR":
        warnings = (
            "The worked-example prose prints .00063, while Table 5.2.6-1 and the example substitution use .000063; the table and substitution are followed.",
        )
    return _result(
        rate, model=f"resistor — {style_key}", section="5.2.6", pages="A-45–A-49",
        tables=("5.2.6-1", "5.2.6-2", "5.2.6-3", "5.2.6-4"),
        equation="lambda_N = lambda_Nb pi_NE pi_NQ pi_cyc", factors=factors,
        steps=steps, inputs=inputs, warnings=warnings,
    )


_CAPACITOR_STYLES: dict[str, tuple[float, str]] = {}
for _style in ("CP", "CZ", "CA", "CPV", "CH", "CQ", "CQR", "CHR", "CFR", "CRH"):
    _CAPACITOR_STYLES[_style] = (.0011, "paper_plastic_film")
for _style in ("CM", "CB", "CMR"):
    _CAPACITOR_STYLES[_style] = (.00075, "mica_glass")
for _style in ("CY", "CYR"):
    _CAPACITOR_STYLES[_style] = (.00045, "mica_glass")
for _style in ("CC", "CCR", "CK", "CKR"):
    _CAPACITOR_STYLES[_style] = (.00039, "ceramic")
_CAPACITOR_STYLES.update({
    "CE": (.0064, "aluminum_electrolytic"),
    "CL": (.0064, "tantalum_nonsolid"),
    "CSR": (.00018, "tantalum_solid"),
    "CLR": (.0064, "tantalum_nonsolid"),
    "CU": (.0064, "aluminum_electrolytic"),
    "CV": (.012, "variable"), "CT": (.015, "variable"),
    "PC": (.0038, "variable"), "CG": (.046, "variable"),
})
_CAPACITOR_ENV_FAMILIES = (
    "paper_plastic_film", "mica_glass", "ceramic", "tantalum_solid",
    "tantalum_nonsolid", "aluminum_electrolytic", "variable",
)
_CAPACITOR_ENV_ROWS = {
    "GB": (1, 1, 1, 1, 1, 1, 1),
    "GF": (2.2, 2.1, 2.0, 2.4, 1.4, 2.0, 3.3),
    "GM": (8.3, 8.8, 8.3, 7.8, 10, 12, 9.6),
    "Mp": (9.9, 11, 11, 9.2, 11, 12, 17),
    "NSB": (4.7, 5.0, 5.0, 4.4, 5.0, 5.8, 7.7),
    "NS": (6.3, 5.9, 5.2, 4.9, 6.7, 6.7, 8.2),
    "NU": (14, 15, 15, 13, 15, 13, 18),
    "NH": (15, 16, 16, 14, 16, 19, 25),
    "NUU": (16, 17, 18, 15, 17, 20, 27),
    "ARW": (21, 23, 24, 20, 23, 27, 36),
    "AIC": (3.2, 3.5, 2.7, 2.5, 2.5, 9.5, 5.0),
    "AIT": (4.3, 4.0, 3.3, 2.5, 4.0, 10, 5.3),
    "AIB": (7.0, 8.0, 6.2, 7.0, 6.5, 10, 7.8),
    "AIA": (4.9, 4.0, 5.0, 3.0, 6.0, 10, 7.7),
    "AIF": (9.8, 10, 8.0, 7.5, 10, 15, 13),
    "AUC": (7.6, 15, 6.0, 4.5, 8.5, 28, 20),
    "AUT": (13, 15, 12, 6.0, 15, 30, 38),
    "AUB": (23, 35, 15, 25, 20, 30, 57),
    "AUA": (17, 15, 17, 10, 20, 30, 50),
    "AUF": (33, 40, 30, 30, 40, 40, 85),
    "SF": (1, 1, 1, 1, 1, 1, 1),
    "MFF": (9.9, 11, 11, 9.3, 11, 12, 16),
    "MFA": (13, 15, 15, 13, 15, 17, 22),
    "USL": (23, 31, 32, 27, 31, 36, 47),
    "ML": (33, 36, 36, 31, 36, 41, 54),
    "CL": (560, 610, 610, 510, 610, 690, 930),
}
_CAPACITOR_ENV = {
    family: {environment: row[index] for environment, row in _CAPACITOR_ENV_ROWS.items()}
    for index, family in enumerate(_CAPACITOR_ENV_FAMILIES)
}
_CAPACITOR_QUALITY = {
    "T": .05, "S": .10, "R": .23, "P": .46, "M": 1.0,
    "L": 1.7, "MIL-SPEC": 2.5, "Lower": 5.3,
}


def capacitor(
    style: str,
    quality: str,
    environment: str,
    power_cycles_per_1000h: float,
) -> NonoperatingPrediction:
    """Section 5.2.7 capacitor model, keyed by the report's MIL style."""
    style_key = style.strip().upper() if isinstance(style, str) else ""
    if style_key not in _CAPACITOR_STYLES:
        raise UnsupportedRADCModelError(
            f"style must be one of {sorted(_CAPACITOR_STYLES)}, got {style!r}"
        )
    if style_key == "CG" and environment in {"MFF", "MFA", "USL", "ML"}:
        raise UnsupportedRADCModelError(
            f"Table 5.2.7-2 prohibits vacuum/gas style CG capacitors in {environment}"
        )
    lambda_nb, family = _CAPACITOR_STYLES[style_key]
    quality_key, pi_nq = _quality(quality, _CAPACITOR_QUALITY)
    pi_ne = _environment(environment, _CAPACITOR_ENV[family])
    cycles = _bounded(power_cycles_per_1000h, "power_cycles_per_1000h", 0, 50)
    pi_cyc = _cycling_factor(cycles, threshold=.3, coefficient=.16)
    rate = lambda_nb * pi_ne * pi_nq * pi_cyc
    factors = {"lambda_Nb": lambda_nb, "pi_NE": pi_ne, "pi_NQ": pi_nq, "pi_cyc": pi_cyc}
    inputs = {"style": style_key, "quality": quality_key, "environment": environment,
              "power_cycles_per_1000h": cycles}
    steps = [
        _step("lambda_Nb", "capacitor base rate", "Table 5.2.7-1", style_key, lambda_nb, FPMH),
        _step("pi_NE", "environment factor", "Table 5.2.7-2", f"{family}, {environment}", pi_ne),
        _step("pi_NQ", "quality factor", "Table 5.2.7-3", quality_key, pi_nq),
        _step("pi_cyc", "equipment power-cycling factor", "1+.16 N_c", f"N_c={cycles:g}", pi_cyc),
        _step("lambda_N", "capacitor nonoperating rate", "lambda_Nb pi_NE pi_NQ pi_cyc", "product", rate, FPMH),
    ]
    return _result(
        rate, model=f"capacitor — {style_key}", section="5.2.7", pages="A-50–A-54",
        tables=("5.2.7-1", "5.2.7-2", "5.2.7-3", "5.2.7-4"),
        equation="lambda_N = lambda_Nb pi_NE pi_NQ pi_cyc", factors=factors,
        steps=steps, inputs=inputs,
    )


# ---------------------------------------------------------------------------
# Appendix A §§5.2.8–5.2.12 — inductive, rotating, relays, switches, connectors
# ---------------------------------------------------------------------------

_INDUCTIVE_TYPES = {
    "audio_transformer": (.000055, "transformer"),
    "power_transformer": (.00028, "transformer"),
    "high_power_pulse_transformer": (.00028, "transformer"),
    "low_power_pulse_transformer": (.000055, "transformer"),
    "if_rf_discriminator_transformer": (.00028, "transformer"),
    "rf_coil_fixed_variable": (.00015, "coil"),
    "rf_coil_molded_er": (.00015, "coil"),
}
_INDUCTIVE_QUALITY = {
    "S": .06, "R": .15, "P": .38, "M": 1.0, "MIL-SPEC": 3.1, "Lower": 11.0,
}
_INDUCTIVE_ENV_TRANSFORMER = _env([
    1, 5.7, 12, 11, 5.1, 5.7, 14, 16, 18, 24,
    4.5, 6, 6, 6, 9, 6.5, 6.5, 7.5, 7.5, 10,
    1, 11, 15, 32, 36, 310,
])
_INDUCTIVE_ENV_COIL = _env([
    1, 3.6, 12, 11, 5.1, 5.7, 14, 16, 18, 24,
    4, 4.5, 5.5, 4.5, 9, 5, 6.5, 7.5, 6.5, 10,
    1, 11, 15, 32, 36, 610,
])


def inductive_device(
    part_type: str,
    quality: str,
    environment: str,
    power_cycles_per_1000h: float,
) -> NonoperatingPrediction:
    """Section 5.2.8 transformer and RF-coil model."""
    kind = _choice(part_type, _INDUCTIVE_TYPES, "part_type")
    lambda_nb, family = _INDUCTIVE_TYPES[kind]
    quality_key, pi_nq = _quality(quality, _INDUCTIVE_QUALITY)
    if family == "transformer" and quality_key in {"S", "R", "P", "M"}:
        raise UnsupportedRADCModelError(
            "Table 5.2.8-2 limits S/R/P/M quality levels to coils"
        )
    pi_ne = _environment(
        environment,
        _INDUCTIVE_ENV_TRANSFORMER if family == "transformer" else _INDUCTIVE_ENV_COIL,
    )
    cycles = _bounded(power_cycles_per_1000h, "power_cycles_per_1000h", 0, 50)
    if family == "transformer":
        pi_cyc = _cycling_factor(cycles, threshold=.05, coefficient=.75, inclusive=True)
        cycle_equation = "1+.75 N_c"
    else:
        pi_cyc = _cycling_factor(cycles, threshold=.1, coefficient=.38, inclusive=True)
        cycle_equation = "1+.38 N_c"
    rate = lambda_nb * pi_nq * pi_ne * pi_cyc
    factors = {"lambda_Nb": lambda_nb, "pi_NQ": pi_nq, "pi_NE": pi_ne, "pi_cyc": pi_cyc}
    inputs = {"part_type": kind, "quality": quality_key, "environment": environment,
              "power_cycles_per_1000h": cycles}
    steps = [
        _step("lambda_Nb", "inductive-device base rate", "Table 5.2.8-1", kind, lambda_nb, FPMH),
        _step("pi_NQ", "quality factor", "Table 5.2.8-2", quality_key, pi_nq),
        _step("pi_NE", "environment factor", "Table 5.2.8-3", f"{family}, {environment}", pi_ne),
        _step("pi_cyc", "equipment power-cycling factor", cycle_equation, f"N_c={cycles:g}", pi_cyc),
        _step("lambda_N", "inductive-device nonoperating rate", "lambda_Nb pi_NQ pi_NE pi_cyc", "product", rate, FPMH),
    ]
    warnings = ()
    if kind == "power_transformer" and environment == "GF":
        warnings = (
            "The worked-example prose names pi_NE=5.1, but Table 5.2.8-3 and the example's numerical product use 5.7; the table and product are followed.",
        )
    return _result(
        rate, model=f"inductive device — {kind}", section="5.2.8", pages="A-55–A-59",
        tables=("5.2.8-1", "5.2.8-2", "5.2.8-3", "5.2.8-4/5"),
        equation="lambda_N = lambda_Nb pi_NQ pi_NE pi_cyc", factors=factors,
        steps=steps, inputs=inputs, warnings=warnings,
    )


_ROTATING_RATES = {"motor": .045, "synchro": .14, "resolver": .14,
                   "elapsed_time_meter": 1.2}


def rotating_device(part_type: str) -> NonoperatingPrediction:
    """Section 5.2.9 average rates for sub-horsepower rotating devices."""
    kind = _choice(part_type, _ROTATING_RATES, "part_type")
    rate = _ROTATING_RATES[kind]
    factors = {"lambda_N": rate}
    inputs = {"part_type": kind}
    steps = [_step("lambda_N", "average nonoperating failure rate", "Table 5.2.9-1", kind, rate, FPMH)]
    return _result(
        rate, model=f"rotating device — {kind}", section="5.2.9", pages="A-60",
        tables=("5.2.9-1",), equation="lambda_N = tabulated average rate",
        factors=factors, steps=steps, inputs=inputs,
        assumptions=("The motor entry applies only to AC or DC motors rated below one horsepower.",),
    )


_RELAY_QUALITY = {"Established Reliability": .46, "MIL-SPEC": 1.0, "Lower": 4.2}
_RELAY_ENV = _env([
    1, 2.3, 8.2, 21, 8.0, 8.0, 14, 32, 34, 46,
    5.5, 6, 10, 7.5, 10, 8.0, 9.0, 15, 10, 15,
    1, 21, 29, 62, 71, None,
])


def relay(
    package_type: str,
    contact_voltage_mv: float,
    quality: str,
    environment: str,
) -> NonoperatingPrediction:
    """Section 5.2.10 relay model."""
    package = _choice(package_type, ("hermetic", "nonhermetic"), "package_type")
    voltage = _nonnegative(contact_voltage_mv, "contact_voltage_mv")
    if package == "hermetic":
        lambda_nb = .0004
        voltage_band = "any"
    elif voltage < 50:
        lambda_nb = .010
        voltage_band = "<50 mV"
    elif voltage > 50:
        lambda_nb = .002
        voltage_band = ">50 mV"
    else:
        raise UnsupportedRADCModelError(
            "Table 5.2.10-1 defines contact voltage below and above 50 mV but not exactly 50 mV"
        )
    quality_key, pi_nq = _quality(quality, _RELAY_QUALITY)
    pi_ne = _environment(environment, _RELAY_ENV)
    rate = lambda_nb * pi_nq * pi_ne
    factors = {"lambda_Nb": lambda_nb, "pi_NQ": pi_nq, "pi_NE": pi_ne}
    inputs = {"package_type": package, "contact_voltage_mv": voltage,
              "quality": quality_key, "environment": environment}
    steps = [
        _step("lambda_Nb", "relay base rate", "Table 5.2.10-1", f"{package}, {voltage_band}", lambda_nb, FPMH),
        _step("pi_NQ", "quality factor", "Table 5.2.10-2", quality_key, pi_nq),
        _step("pi_NE", "environment factor", "Table 5.2.10-3", environment, pi_ne),
        _step("lambda_N", "relay nonoperating rate", "lambda_Nb pi_NQ pi_NE", "product", rate, FPMH),
    ]
    return _result(
        rate, model="relay", section="5.2.10", pages="A-61–A-62",
        tables=("5.2.10-1", "5.2.10-2", "5.2.10-3"),
        equation="lambda_N = lambda_Nb pi_NQ pi_NE", factors=factors,
        steps=steps, inputs=inputs,
        warnings=("The environment-table heading is misprinted as Table 5.2.5-1; the section text identifies it as Table 5.2.10-3.",),
    )


_SWITCH_QUALITY = _RELAY_QUALITY
_SWITCH_ENV = _env([
    1, 2.9, 13, 21, 7.9, 7.9, 18, 32, 34, 41,
    7.2, 7.2, 14, 14, 18, 9, 9, 18, 18, 23,
    1, 19, 26, 63, 64, 1200,
])


def switch(contact_voltage_mv: float, quality: str, environment: str) -> NonoperatingPrediction:
    """Section 5.2.11 switch model."""
    voltage = _nonnegative(contact_voltage_mv, "contact_voltage_mv")
    if voltage < 50:
        lambda_nb, voltage_band = .030, "<50 mV"
    elif voltage > 50:
        lambda_nb, voltage_band = .006, ">50 mV"
    else:
        raise UnsupportedRADCModelError(
            "Table 5.2.11-1 defines contact voltage below and above 50 mV but not exactly 50 mV"
        )
    quality_key, pi_nq = _quality(quality, _SWITCH_QUALITY)
    pi_ne = _environment(environment, _SWITCH_ENV)
    rate = lambda_nb * pi_nq * pi_ne
    factors = {"lambda_Nb": lambda_nb, "pi_NQ": pi_nq, "pi_NE": pi_ne}
    inputs = {"contact_voltage_mv": voltage, "quality": quality_key, "environment": environment}
    steps = [
        _step("lambda_Nb", "switch base rate", "Table 5.2.11-1", voltage_band, lambda_nb, FPMH),
        _step("pi_NQ", "quality factor", "Table 5.2.11-2", quality_key, pi_nq),
        _step("pi_NE", "environment factor", "Table 5.2.11-3", environment, pi_ne),
        _step("lambda_N", "switch nonoperating rate", "lambda_Nb pi_NQ pi_NE", "product", rate, FPMH),
    ]
    return _result(
        rate, model="switch", section="5.2.11", pages="A-63–A-64",
        tables=("5.2.11-1", "5.2.11-2", "5.2.11-3"),
        equation="lambda_N = lambda_Nb pi_NQ pi_NE", factors=factors,
        steps=steps, inputs=inputs,
    )


_CONNECTOR_BASE = {
    "circular": .00044, "coaxial": .00044, "power": .00044,
    "rack_and_panel": .0029, "printed_wiring_board": .0029,
}
_CONNECTOR_ENV = _env([
    1, 2.3, 8.3, 8.5, 4.1, 5.5, 13, 13, 14, 19,
    2.8, 4.8, 7.0, 5.3, 11, 4.3, 15, 9.8, 8.0, 15,
    1, 8.5, 12, 25, 29, 490,
])


def connector(connector_type: str, environment: str) -> NonoperatingPrediction:
    """Section 5.2.12 connector model."""
    kind = _choice(connector_type, _CONNECTOR_BASE, "connector_type")
    lambda_nb = _CONNECTOR_BASE[kind]
    pi_ne = _environment(environment, _CONNECTOR_ENV)
    rate = lambda_nb * pi_ne
    factors = {"lambda_Nb": lambda_nb, "pi_NE": pi_ne}
    inputs = {"connector_type": kind, "environment": environment}
    steps = [
        _step("lambda_Nb", "connector base rate", "Table 5.2.12-1", kind, lambda_nb, FPMH),
        _step("pi_NE", "environment factor", "Table 5.2.12-2", environment, pi_ne),
        _step("lambda_N", "connector nonoperating rate", "lambda_Nb pi_NE", "product", rate, FPMH),
    ]
    return _result(
        rate, model=f"connector — {kind}", section="5.2.12", pages="A-65–A-66",
        tables=("5.2.12-1", "5.2.12-2"), equation="lambda_N = lambda_Nb pi_NE",
        factors=factors, steps=steps, inputs=inputs,
    )


# ---------------------------------------------------------------------------
# Appendix A §§5.2.13–5.2.15 — interconnections and miscellaneous parts
# ---------------------------------------------------------------------------

_PTH_BASE = {
    "double_sided_soldered_printed_wiring": .0000014,
    "multilayer_soldered_printed_wiring": .0000028,
    "discrete_wiring_electroless_deposited_pth": .0000089,
}
_PTH_ENV = _env([
    1, 2.3, 6.9, 6.9, 4.1, 5.3, 11, 13, 14, 17,
    2.3, 4.1, 7.2, 5.0, 9.0, 5.4, 11, 18, 14, 25,
    1, 7.8, 11, 25, 26, 500,
])


def pth_assembly(
    technology: str,
    functional_pths: int,
    environment: str,
) -> NonoperatingPrediction:
    """Section 5.2.13 interconnection assembly model with functional PTHs."""
    kind = _choice(technology, _PTH_BASE, "technology")
    count = _integer(functional_pths, "functional_pths", minimum=1)
    lambda_nb = _PTH_BASE[kind]
    pi_ne = _environment(environment, _PTH_ENV)
    rate = lambda_nb * count * pi_ne
    factors = {"lambda_Nb": lambda_nb, "N_PTH": count, "pi_NE": pi_ne}
    inputs = {"technology": kind, "functional_pths": count, "environment": environment}
    steps = [
        _step("lambda_Nb", "PTH base rate", "Table 5.2.13-1", kind, lambda_nb, FPMH),
        _step("N_PTH", "functional plated-through-hole count", "count", str(count), count),
        _step("pi_NE", "environment factor", "Table 5.2.13-2", environment, pi_ne),
        _step("lambda_N", "assembly nonoperating rate", "lambda_Nb N_PTH pi_NE", "product", rate, FPMH),
    ]
    return _result(
        rate, model=f"PTH interconnection assembly — {kind}", section="5.2.13",
        pages="A-67–A-68", tables=("5.2.13-1", "5.2.13-2"),
        equation="lambda_N = lambda_Nb N_PTH pi_NE", factors=factors,
        steps=steps, inputs=inputs,
        assumptions=("functional_pths includes nonsoldered functional via holes, as required by the report.",),
    )


_CONNECTION_BASE = {
    "hand_solder": .000089,
    "crimp": .000013,
    "weld": .0000017,
    "solderless_wrap": .00000012,
    "wrapped_and_soldered": .0000048,
    "clip_termination": .0000041,
    "reflow_solder": .0000024,
}
_CONNECTION_ENV = _env([
    1, 2.1, 6.6, 7.3, 3.5, 4.4, 8.9, 11, 12, 14,
    2.3, 4.1, 5.0, 4.5, 6.8, 2.7, 5.4, 6.8, 6.3, 8.6,
    1, 6.6, 9.0, 22, 23, 420,
])


def connections(
    connection_counts: Mapping[str, int],
    environment: str,
) -> NonoperatingPrediction:
    """Section 5.2.14 rollup for assemblies without PTHs."""
    if not isinstance(connection_counts, Mapping) or not connection_counts:
        raise ValueError("connection_counts must be a non-empty mapping")
    normalized: dict[str, int] = {}
    contributions: dict[str, float] = {}
    for raw_type, raw_count in connection_counts.items():
        kind = _choice(raw_type, _CONNECTION_BASE, "connection type")
        if kind in normalized:
            raise ValueError(f"duplicate normalized connection type {kind!r}")
        count = _integer(raw_count, f"connection_counts[{raw_type!r}]")
        normalized[kind] = count
        contributions[kind] = count * _CONNECTION_BASE[kind]
    if sum(normalized.values()) < 1:
        raise ValueError("connection_counts must include at least one connection")
    subtotal = sum(contributions.values())
    pi_ne = _environment(environment, _CONNECTION_ENV)
    rate = pi_ne * subtotal
    factors = {"pi_NE": pi_ne, "base_rate_sum": subtotal,
               "connection_contributions": contributions}
    inputs = {"connection_counts": normalized, "environment": environment}
    steps: list[Mapping[str, Any]] = []
    for kind, contribution in contributions.items():
        steps.append(_step(
            f"N_{kind} lambda_Nb", f"{kind} contribution", "N_i lambda_Nbi",
            f"{normalized[kind]} x {_CONNECTION_BASE[kind]:g}", contribution, FPMH,
        ))
    steps.extend((
        _step("pi_NE", "environment factor", "Table 5.2.14-2", environment, pi_ne),
        _step("lambda_N", "connections nonoperating rate", "pi_NE sum_i(N_i lambda_Nbi)",
              "environment factor times contribution sum", rate, FPMH),
    ))
    return _result(
        rate, model="connections", section="5.2.14", pages="A-69–A-71",
        tables=("5.2.14-1", "5.2.14-2"),
        equation="lambda_N = pi_NE sum_i(N_i lambda_Nbi)", factors=factors,
        steps=steps, inputs=inputs,
        assumptions=("The report treats the structure supporting connections and parts as having zero nonoperating rate.",),
    )


_MISC_RATES = {
    "vibrator": 3.3,
    "quartz_crystal": .039,
    "fuse": .0014,
    "neon_lamp": .029,
    "incandescent_lamp": .11,
    "single_fiber_optic_connector": .014,
    "meter": 1.4,
    "circuit_breaker": .29,
    "microwave_fixed_element": 0.0,
    "microwave_variable_element": .014,
    "microwave_ferrite_device": .043,
    "dummy_load": .011,
    "termination": .010,
}
_MISC_TYPES = (*_MISC_RATES, "fiber_optic_cable", "attenuator")


def miscellaneous_part(
    part_type: str,
    *,
    fiber_length_km: float = 1.0,
    environment: str | None = None,
    quality: str | None = None,
    power_cycles_per_1000h: float | None = None,
) -> NonoperatingPrediction:
    """Section 5.2.15 average miscellaneous-part rates and footnotes."""
    kind = _choice(part_type, _MISC_TYPES, "part_type")
    warnings: tuple[str, ...] = ()
    assumptions: tuple[str, ...] = ()
    if kind == "attenuator":
        if environment is None or quality is None or power_cycles_per_1000h is None:
            raise ValueError(
                "attenuator requires environment, quality, and power_cycles_per_1000h for the Style RD resistor model"
            )
        delegated = resistor("RD", quality, environment, power_cycles_per_1000h)
        rate = delegated.failure_rate
        factors = {"delegated_model": "Section 5.2.6 Style RD", **dict(delegated.factors)}
        inputs = {"part_type": kind, "environment": environment, "quality": quality,
                  "power_cycles_per_1000h": power_cycles_per_1000h}
        steps = tuple(delegated.steps)
        warnings = ("Table 5.2.15-1 directs attenuators to the Section 5.2.6 Style RD resistor calculation.",)
        tables = ("5.2.15-1 footnote", "5.2.6-1–4")
        equation = "Section 5.2.6 Style RD resistor model"
    elif kind == "fiber_optic_cable":
        length = _positive(fiber_length_km, "fiber_length_km")
        rate = .014 * length
        factors = {"lambda_per_fiber_km": .014, "fiber_length_km": length}
        inputs = {"part_type": kind, "fiber_length_km": length}
        steps = (_step("lambda_N", "single-fiber cable rate", ".014 L", f"L={length:g} km", rate, FPMH),)
        tables = ("5.2.15-1",)
        equation = "lambda_N = .014 L"
        assumptions = ("The table applies to single-fiber cable types only.",)
    else:
        rate = _MISC_RATES[kind]
        factors = {"lambda_N": rate}
        inputs = {"part_type": kind}
        steps = (_step("lambda_N", "average miscellaneous-part rate", "Table 5.2.15-1", kind, rate, FPMH),)
        tables = ("5.2.15-1",)
        equation = "lambda_N = tabulated average rate"
        if kind == "microwave_fixed_element":
            assumptions = (
                "The table describes fixed directional couplers, fixed stubs, and fixed cavities as negligible; the numerical contribution is represented as zero.",
            )
    return _result(
        rate, model=f"miscellaneous part — {kind}", section="5.2.15", pages="A-72",
        tables=tables, equation=equation, factors=factors, steps=steps,
        inputs=inputs, assumptions=assumptions, warnings=warnings,
    )


_PREDICTORS = {
    "microelectronic_device": microelectronic_device,
    "hybrid_microcircuit": hybrid_microcircuit,
    "magnetic_bubble_memory": magnetic_bubble_memory,
    "discrete_semiconductor": discrete_semiconductor,
    "tube": tube,
    "laser": laser,
    "resistor": resistor,
    "capacitor": capacitor,
    "inductive_device": inductive_device,
    "rotating_device": rotating_device,
    "relay": relay,
    "switch": switch,
    "connector": connector,
    "pth_assembly": pth_assembly,
    "connections": connections,
    "miscellaneous_part": miscellaneous_part,
}

NONOPERATING_MODEL_CATALOG: Mapping[str, Mapping[str, Any]] = {
    "microelectronic_device": {
        "section": "5.2.2.1–5.2.2.5",
        "required_parameters": (
            "device_type", "technology", "package", "quality", "environment",
            "temperature_c", "power_cycles_per_1000h",
        ),
        "conditional_parameters": {"complexity": "required for digital and linear devices"},
        "choices": {
            "device_type": ("digital", "linear", "memory"),
            "technology": tuple(sorted(_MICRO_TECH_ALIASES)),
            "package": ("hermetic", "nonhermetic"),
            "quality": tuple(_MICRO_QUALITY),
        },
    },
    "hybrid_microcircuit": {
        "section": "5.2.2.6",
        "required_parameters": ("diodes", "transistors", "integrated_circuits", "quality", "environment"),
        "choices": {"quality": tuple(_HYBRID_QUALITY)},
    },
    "magnetic_bubble_memory": {
        "section": "5.2.2.7",
        "required_parameters": (
            "transfer_gates", "dissipative_control_gates", "major_loops",
            "functional_minor_loops", "temperature_c", "environment",
        ),
    },
    "discrete_semiconductor": {
        "section": "5.2.3",
        "required_parameters": ("part_type", "quality", "environment"),
        "conditional_parameters": {
            "temperature_c": "required except for Group X optoelectronics",
            "power_cycles_per_1000h": "required except for Group X optoelectronics",
        },
        "choices": {"part_type": tuple(_DISCRETE_PARTS), "quality": tuple(_DISCRETE_QUALITY)},
    },
    "tube": {
        "section": "5.2.4", "required_parameters": ("tube_type", "environment"),
        "choices": {"tube_type": tuple(_TUBE_BASE)},
    },
    "laser": {
        "section": "5.2.5", "required_parameters": ("laser_type", "environment"),
        "conditional_parameters": {"active_optical_surfaces": "required for CO2 and solid-state lasers"},
        "choices": {"laser_type": _LASER_TYPES},
    },
    "resistor": {
        "section": "5.2.6",
        "required_parameters": ("style", "quality", "environment", "power_cycles_per_1000h"),
        "choices": {"style": tuple(_RESISTOR_STYLES), "quality": tuple(_RESISTOR_QUALITY)},
    },
    "capacitor": {
        "section": "5.2.7",
        "required_parameters": ("style", "quality", "environment", "power_cycles_per_1000h"),
        "choices": {"style": tuple(_CAPACITOR_STYLES), "quality": tuple(_CAPACITOR_QUALITY)},
    },
    "inductive_device": {
        "section": "5.2.8",
        "required_parameters": ("part_type", "quality", "environment", "power_cycles_per_1000h"),
        "choices": {"part_type": tuple(_INDUCTIVE_TYPES), "quality": tuple(_INDUCTIVE_QUALITY)},
    },
    "rotating_device": {
        "section": "5.2.9", "required_parameters": ("part_type",),
        "choices": {"part_type": tuple(_ROTATING_RATES)},
    },
    "relay": {
        "section": "5.2.10",
        "required_parameters": ("package_type", "contact_voltage_mv", "quality", "environment"),
        "choices": {"package_type": ("hermetic", "nonhermetic"), "quality": tuple(_RELAY_QUALITY)},
    },
    "switch": {
        "section": "5.2.11",
        "required_parameters": ("contact_voltage_mv", "quality", "environment"),
        "choices": {"quality": tuple(_SWITCH_QUALITY)},
    },
    "connector": {
        "section": "5.2.12", "required_parameters": ("connector_type", "environment"),
        "choices": {"connector_type": tuple(_CONNECTOR_BASE)},
    },
    "pth_assembly": {
        "section": "5.2.13", "required_parameters": ("technology", "functional_pths", "environment"),
        "choices": {"technology": tuple(_PTH_BASE)},
    },
    "connections": {
        "section": "5.2.14", "required_parameters": ("connection_counts", "environment"),
        "choices": {"connection_type": tuple(_CONNECTION_BASE)},
    },
    "miscellaneous_part": {
        "section": "5.2.15", "required_parameters": ("part_type",),
        "conditional_parameters": {
            "fiber_length_km": "used for fiber_optic_cable",
            "environment/quality/power_cycles_per_1000h": "required for attenuator",
        },
        "choices": {"part_type": _MISC_TYPES},
    },
}


def predict_nonoperating(model: str, **parameters: Any) -> NonoperatingPrediction:
    """Dispatch to an Appendix A calculator by its stable model identifier."""
    model_key = _choice(model, _PREDICTORS, "model")
    return _PREDICTORS[model_key](**parameters)


__all__ = [
    "FPMH", "CALENDAR_FPMH", "REPORT_EDITION",
    "NONOPERATING_ENVIRONMENTS", "NONOPERATING_ENVIRONMENT_DESCRIPTIONS",
    "NONOPERATING_MODEL_CATALOG",
    "UnsupportedRADCModelError", "NonoperatingPrediction",
    "nonoperating_reliability", "service_life_failure_rate", "combined_reliability",
    "microelectronic_device", "hybrid_microcircuit", "magnetic_bubble_memory",
    "discrete_semiconductor", "tube", "laser", "resistor", "capacitor",
    "inductive_device", "rotating_device", "relay", "switch", "connector",
    "pth_assembly", "connections", "miscellaneous_part", "predict_nonoperating",
]
