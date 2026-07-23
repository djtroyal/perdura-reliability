"""Physics of Failure router -- stress-based failure analysis calculations."""

import math
import re
from typing import Callable

import numpy as np
from fastapi import APIRouter, HTTPException
from scipy.optimize import brentq
from scipy import stats as ss

from schemas import (
    SNCurveRequest,
    StressStrainRequest,
    CreepRequest,
    DamageRequest,
    FractureRequest,
    CoffinMansonRequest,
    NorrisLandzbergRequest,
    BlackRequest,
    PeckRequest,
    ArrheniusRequest,
    EyringRequest,
    HallbergPeckRequest,
    TDDBRequest,
    MeanStressRequest,
)

router = APIRouter()

# Boltzmann constant (eV/K)
K_BOLTZMANN = 8.617e-5


def _finite(name: str, *values: float) -> None:
    if any(not math.isfinite(float(value)) for value in values):
        raise HTTPException(status_code=400, detail=f"{name} must be finite.")


def _positive(name: str, *values: float, allow_zero: bool = False) -> None:
    _finite(name, *values)
    invalid = any(value < 0 if allow_zero else value <= 0 for value in values)
    if invalid:
        qualifier = "non-negative" if allow_zero else "positive"
        raise HTTPException(status_code=400, detail=f"{name} must be {qualifier}.")


def _exp_checked(log_value: float, quantity: str) -> float:
    """Exponentiate without returning an infinity that looks like a result."""
    _finite(quantity, log_value)
    if log_value > math.log(np.finfo(float).max):
        raise HTTPException(
            status_code=400,
            detail=f"{quantity} overflows for these inputs; check units and calibration constants.",
        )
    if log_value < math.log(np.finfo(float).tiny):
        raise HTTPException(
            status_code=400,
            detail=f"{quantity} underflows for these inputs; check units and calibration constants.",
        )
    return math.exp(log_value)


MetricExtractor = Callable[[dict], float | None]


def _finalize(
    req,
    result: dict,
    evaluator: Callable,
    metrics: dict[str, MetricExtractor],
    *,
    units: dict[str, str],
    assumptions: list[str],
    warnings: list[str] | None = None,
) -> dict:
    """Attach the analysis contract and optionally propagate input uncertainty.

    Deterministic values remain separate from Monte Carlo intervals so a point
    estimate can never be mistaken for an uncertainty bound.
    """
    warnings = list(warnings or [])
    deterministic: dict[str, float] = {}
    for name, extractor in metrics.items():
        try:
            value = extractor(result)
        except (KeyError, IndexError, TypeError, ValueError):
            value = None
        if value is not None and math.isfinite(float(value)):
            deterministic[name] = float(value)

    uncertainty_out = None
    spec = getattr(req, 'uncertainty', None)
    if spec is not None:
        if not spec.relative_sd:
            raise HTTPException(
                status_code=400,
                detail="uncertainty.relative_sd must name at least one scalar input.",
            )
        base = req.model_dump()
        base['uncertainty'] = None
        rng = np.random.default_rng(spec.seed)
        draws: dict[str, np.ndarray] = {}
        locations: dict[str, tuple[str, int | None]] = {}
        for field, cv_raw in spec.relative_sd.items():
            root = field
            index = None
            if field not in base:
                match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]', field)
                if not match or match.group(1) not in base:
                    raise HTTPException(status_code=400, detail=f"Unknown uncertainty field '{field}'.")
                root, index_text = match.groups()
                index = int(index_text)
                sequence = base[root]
                if not isinstance(sequence, list) or index >= len(sequence):
                    raise HTTPException(status_code=400, detail=f"Uncertainty field '{field}' is out of range.")
                value = sequence[index]
            else:
                value = base[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Uncertainty field '{field}' must be a populated scalar numeric input.",
                )
            value = float(value)
            cv = float(cv_raw)
            if not math.isfinite(cv) or cv <= 0 or cv > 5:
                raise HTTPException(
                    status_code=400,
                    detail=f"Relative SD for '{field}' must be finite and in (0, 5].",
                )
            if value > 0:
                sigma_log = math.sqrt(math.log1p(cv * cv))
                mu_log = math.log(value) - 0.5 * sigma_log * sigma_log
                draws[field] = rng.lognormal(mu_log, sigma_log, spec.samples)
            elif value < 0:
                draws[field] = rng.normal(value, abs(value) * cv, spec.samples)
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Relative uncertainty is undefined for zero-valued field '{field}'.",
                )
            locations[field] = (root, index)

        collected = {name: [] for name in metrics}
        accepted = 0
        for i in range(spec.samples):
            sample_data = dict(base)
            for field, values in draws.items():
                root, index = locations[field]
                if index is None:
                    sample_data[root] = float(values[i])
                else:
                    sequence = list(sample_data[root])
                    sequence[index] = float(values[i])
                    sample_data[root] = sequence
            try:
                sample_req = type(req).model_validate(sample_data)
                sample_result = evaluator(sample_req)
            except (HTTPException, ValueError, OverflowError, FloatingPointError):
                continue
            accepted += 1
            for name, extractor in metrics.items():
                try:
                    value = extractor(sample_result)
                    if value is not None and math.isfinite(float(value)):
                        collected[name].append(float(value))
                except (KeyError, IndexError, TypeError, ValueError):
                    pass

        if accepted < max(50, spec.samples // 2):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Only {accepted}/{spec.samples} uncertainty draws satisfied the model domain. "
                    "Reduce input uncertainty or revise the base point."
                ),
            )
        tail = (1.0 - spec.confidence) / 2.0
        summaries = {}
        for name, values in collected.items():
            if len(values) < 50:
                continue
            arr = np.asarray(values, dtype=float)
            summaries[name] = {
                'mean': float(np.mean(arr)),
                'median': float(np.median(arr)),
                'standard_deviation': float(np.std(arr, ddof=1)),
                'lower': float(np.quantile(arr, tail)),
                'upper': float(np.quantile(arr, 1.0 - tail)),
                'valid_draws': int(len(arr)),
                # Keep the response bounded while retaining enough empirical
                # draws for the client to show the propagated distribution.
                'plot_samples': arr[np.linspace(
                    0, len(arr) - 1, min(len(arr), 1000), dtype=int
                )].tolist(),
            }
        uncertainty_out = {
            'method': 'independent_input_monte_carlo',
            'confidence': spec.confidence,
            'requested_draws': spec.samples,
            'accepted_draws': accepted,
            'rejected_draws': spec.samples - accepted,
            'input_relative_sd': dict(spec.relative_sd),
            'sampling': (
                'Positive scalar inputs use mean-preserving lognormal draws; '
                'negative scalar inputs use normal draws. Inputs are independent.'
            ),
            'metrics': summaries,
        }

    result['analysis'] = {
        'result_quality': 'uncertainty_propagated' if uncertainty_out else 'deterministic_only',
        'deterministic': deterministic,
        'uncertainty': uncertainty_out,
        'units': units,
        'validity': {
            'status': 'conditional' if warnings else 'within_screened_domain',
            'assumptions': assumptions,
            'warnings': warnings,
        },
    }
    return result


# ---------------------------------------------------------------------------
# 1. SN (stress-life) curve  -- Basquin's law
# ---------------------------------------------------------------------------

@router.post("/sn-curve")
def sn_curve(req: SNCurveRequest):
    if len(req.stress_amplitude) != len(req.cycles_to_failure):
        raise HTTPException(
            status_code=400,
            detail="stress_amplitude and cycles_to_failure must have the same length.",
        )
    if len(req.stress_amplitude) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 data points are required for fitting.",
        )

    S = np.asarray(req.stress_amplitude, dtype=float)
    N = np.asarray(req.cycles_to_failure, dtype=float)

    _positive("All stress amplitudes", *S)
    _positive("All cycles to failure", *N)
    if np.unique(N).size < 2:
        raise HTTPException(status_code=400, detail="At least two distinct cycle values are required.")

    # Basquin fit: log10(S) = b * log10(N) + log10(A)
    log_N = np.log10(N)
    log_S = np.log10(S)
    coeffs = np.polyfit(log_N, log_S, 1)  # [b, log10(A)]
    b = float(coeffs[0])
    A = _exp_checked(math.log(10.0) * float(coeffs[1]), 'Basquin intercept A')
    _finite("Fitted Basquin parameters", A, b)
    if b >= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "The fitted Basquin exponent is non-negative, so stress does not decrease "
                "with fatigue life. The data are outside the stress-life model regime."
            ),
        )

    # R-squared (None — not 0 — when ss_tot is 0: a constant-stress dataset is
    # degenerate, not a worst-possible fit).
    S_pred = np.asarray([
        _exp_checked(math.log(10.0) * value, 'fitted Basquin stress')
        for value in np.polyval(coeffs, log_N)
    ])
    ss_res = float(np.sum((S - S_pred) ** 2))
    ss_tot = float(np.sum((S - np.mean(S)) ** 2))
    r_squared = (1.0 - ss_res / ss_tot) if ss_tot != 0 else None

    # Standard error and 95% CI on the fitted slope b from the regression
    # residuals in log-log space (the slope drives every extrapolation).
    b_se = b_lower = b_upper = None
    n_pts = len(N)
    if n_pts > 2:
        resid = log_S - np.polyval(coeffs, log_N)
        sxx = float(np.sum((log_N - np.mean(log_N)) ** 2))
        if sxx > 0:
            s2 = float(np.sum(resid ** 2)) / (n_pts - 2)
            b_se = float(np.sqrt(s2 / sxx))
            t_crit = float(ss.t.ppf(0.975, n_pts - 2))
            b_lower, b_upper = b - t_crit * b_se, b + t_crit * b_se

    # Endurance limit estimate at N = 1e7
    endurance_limit = _exp_checked(math.log(A) + b * math.log(1e7), 'endurance-limit estimate')
    n_min_data, n_max_data = float(np.min(N)), float(np.max(N))
    # Fatigue extrapolation beyond the fitted cycle range is a classic
    # over-reach — flag every prediction made outside [min(N), max(N)].
    warnings_list = []
    if not (n_min_data <= 1e7 <= n_max_data):
        warnings_list.append(
            f"The endurance-limit estimate extrapolates to 10^7 cycles, outside the fitted "
            f"data range [{n_min_data:.3g}, {n_max_data:.3g}].")

    # Fitted curve (100 log-spaced points)
    curve_n = np.logspace(np.log10(n_min_data), np.log10(n_max_data * 10), 100)
    curve_s = np.asarray([
        _exp_checked(math.log(A) + b * math.log(value), 'Basquin curve stress')
        for value in curve_n
    ])

    # Optional predictions
    prediction = {}
    if req.stress_query is not None:
        _positive("stress_query", req.stress_query)
        # N = (S / A)^(1/b)
        if b == 0:
            raise HTTPException(status_code=400, detail="Slope b is zero; cannot predict life.")
        predicted_life = _exp_checked(
            math.log(req.stress_query / A) / b, 'Basquin predicted life')
        prediction["cycles"] = predicted_life
        if not (n_min_data <= predicted_life <= n_max_data):
            warnings_list.append(
                f"The predicted life ({predicted_life:.3g} cycles) lies outside the fitted "
                f"data range [{n_min_data:.3g}, {n_max_data:.3g}] — treat as an extrapolation.")
    if req.life_query is not None:
        _positive("life_query", req.life_query)
        predicted_stress = _exp_checked(
            math.log(A) + b * math.log(req.life_query), 'Basquin predicted stress')
        prediction["stress"] = float(predicted_stress)
        if not (n_min_data <= req.life_query <= n_max_data):
            warnings_list.append(
                f"The life query ({req.life_query:.3g} cycles) lies outside the fitted "
                f"data range [{n_min_data:.3g}, {n_max_data:.3g}] — treat as an extrapolation.")

    result = {
        "A": A,
        "b": b,
        "b_se": b_se,
        "b_lower": b_lower,
        "b_upper": b_upper,
        "endurance_limit": endurance_limit,
        "r_squared": r_squared,
        "extrapolation_warning": (" ".join(warnings_list) if warnings_list else None),
        "curve": {
            "n": curve_n.tolist(),
            "s": curve_s.tolist(),
        },
        "prediction": prediction if prediction else None,
    }
    return _finalize(
        req, result, sn_curve,
        {
            'basquin_A': lambda r: r['A'],
            'basquin_b': lambda r: r['b'],
            'endurance_limit': lambda r: r['endurance_limit'],
            'predicted_cycles': lambda r: (r.get('prediction') or {}).get('cycles'),
            'predicted_stress': lambda r: (r.get('prediction') or {}).get('stress'),
        },
        units={'stress': 'MPa', 'life': 'cycles', 'A': 'MPa·cycles^(-b)', 'b': 'dimensionless'},
        assumptions=[
            'Constant-amplitude uniaxial stress-life behavior follows one Basquin power law.',
            'Stress inputs and predictions use the same MPa convention; life is measured in cycles.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 2. Stress-strain (Ramberg-Osgood)
# ---------------------------------------------------------------------------

@router.post("/stress-strain")
def stress_strain(req: StressStrainRequest):
    _positive("Young's modulus E", req.E)
    _positive("Strength coefficient K", req.K)
    _positive("Strain hardening exponent n", req.n)
    if req.sigma_y is not None:
        _positive("Yield stress sigma_y", req.sigma_y)

    max_stress = req.max_stress if req.max_stress is not None else 1.5 * req.K
    _positive("max_stress", max_stress)
    sigma = np.linspace(0, max_stress, 200)

    strain_elastic = sigma / req.E
    strain_plastic = (sigma / req.K) ** (1.0 / req.n)
    strain_total = strain_elastic + strain_plastic
    if np.any(~np.isfinite(strain_total)):
        raise HTTPException(status_code=400, detail="Ramberg-Osgood strain overflows; check K, n and stress units.")

    warnings_list = []
    if req.sigma_y is None:
        warnings_list.append(
            'No yield stress was supplied, so the requested stress range cannot be screened against yielding.')
    elif max_stress > req.sigma_y:
        warnings_list.append(
            'The plotted range exceeds the supplied yield stress; confirm that the fitted cyclic Ramberg-Osgood constants apply in this plastic regime.')
    result = {
        "stress": sigma.tolist(),
        "strain_elastic": strain_elastic.tolist(),
        "strain_plastic": strain_plastic.tolist(),
        "strain_total": strain_total.tolist(),
        "E": req.E,
        "K": req.K,
        "n": req.n,
        "max_total_strain": float(strain_total[-1]),
    }
    return _finalize(
        req, result, stress_strain,
        {'max_total_strain': lambda r: r['max_total_strain']},
        units={'E': 'MPa', 'K': 'MPa', 'stress': 'MPa', 'strain': 'dimensionless'},
        assumptions=[
            'E, K, yield stress and plotted stress use one consistent MPa basis.',
            'The uniaxial Ramberg-Osgood relation and supplied material constants are valid over the plotted range.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 3. Creep life -- Larson-Miller parameter
# ---------------------------------------------------------------------------

@router.post("/creep-life")
def creep_life(req: CreepRequest):
    _positive("Stress", req.stress_MPa)
    _finite("Temperature", req.temperature_C)
    _positive("Larson-Miller constant C", req.C)
    if len(req.lmp_coeffs) != 2:
        raise HTTPException(
            status_code=400,
            detail="lmp_coeffs must contain exactly [a, b].",
        )
    _finite("Larson-Miller coefficients", *req.lmp_coeffs)

    T_K = req.temperature_C + 273.15
    if T_K <= 0:
        raise HTTPException(status_code=400, detail="Temperature must be above absolute zero.")
    if req.lmp_coeffs[1] >= 0:
        raise HTTPException(
            status_code=400,
            detail="The LMP stress coefficient b must be negative so rupture life decreases with stress.",
        )
    lmp = req.lmp_coeffs[0] + req.lmp_coeffs[1] * math.log10(req.stress_MPa)
    _finite("Larson-Miller parameter", lmp)
    time_to_rupture = _exp_checked(
        math.log(10.0) * (lmp / T_K - req.C), 'time to rupture')

    # Curve: time vs temperature at the given stress
    temp_C = np.linspace(300, 800, 100)
    temp_K = temp_C + 273.15
    time_values = np.asarray([
        _exp_checked(math.log(10.0) * (lmp / tk - req.C), 'creep curve time')
        for tk in temp_K
    ])

    result = {
        "lmp": lmp,
        "temperature_K": T_K,
        "time_to_rupture": time_to_rupture,
        "time_unit": req.time_unit,
        "time_to_rupture_hours": time_to_rupture if req.time_unit == 'hours' else None,
        "curve": {
            "temperature_C": temp_C.tolist(),
            "time": time_values.tolist(),
            "time_unit": req.time_unit,
            "time_hours": time_values.tolist() if req.time_unit == 'hours' else None,
        },
    }
    return _finalize(
        req, result, creep_life,
        {'time_to_rupture': lambda r: r['time_to_rupture']},
        units={
            'temperature_input': '°C', 'temperature_equation': 'K', 'stress': 'MPa',
            'rupture_time': req.time_unit, 'LMP': f'K·(log10 {req.time_unit})',
        },
        assumptions=[
            f'The fitted Larson-Miller C and coefficients were calibrated with stress in MPa and time in {req.time_unit}.',
            'One creep mechanism and one stress-LMP relationship remain valid at the requested temperature and stress.',
        ],
        warnings=[
            'No calibration temperature/stress domain was supplied; this result cannot detect extrapolation beyond the source rupture data.'
        ],
    )


# ---------------------------------------------------------------------------
# 4. Linear damage accumulation -- Miner's rule
# ---------------------------------------------------------------------------

@router.post("/linear-damage")
def linear_damage(req: DamageRequest):
    n_levels = len(req.stress_levels)
    if len(req.cycles_applied) != n_levels or len(req.cycles_to_failure) != n_levels:
        raise HTTPException(
            status_code=400,
            detail="stress_levels, cycles_applied, and cycles_to_failure must have the same length.",
        )
    if n_levels == 0:
        raise HTTPException(status_code=400, detail="At least one stress level is required.")

    _positive("stress_levels", *req.stress_levels)
    _positive("cycles_applied", *req.cycles_applied, allow_zero=True)
    _positive("cycles_to_failure", *req.cycles_to_failure)

    damage_fractions = []
    for n_i, N_i in zip(req.cycles_applied, req.cycles_to_failure):
        damage_fractions.append(n_i / N_i)

    total_damage = sum(damage_fractions)
    comparison = [{
        'model': 'Palmgren-Miner linear',
        'damage': total_damage,
        'failed': total_damage >= 1.0,
        'sequence_sensitive': False,
    }]
    nonlinear = None
    if req.damage_exponents is not None:
        if len(req.damage_exponents) != n_levels:
            raise HTTPException(
                status_code=400,
                detail="damage_exponents must have one value per load block.",
            )
        _positive("damage_exponents", *req.damage_exponents)

        def accumulate(fractions, exponents):
            damage = 0.0
            path = []
            for fraction, exponent in zip(fractions, exponents):
                equivalent_fraction = 0.0 if damage == 0 else damage ** (1.0 / exponent)
                base_fraction = equivalent_fraction + fraction
                damage = 0.0 if base_fraction == 0 else _exp_checked(
                    exponent * math.log(base_fraction), 'nonlinear cumulative damage')
                path.append(damage)
            return damage, path

        nonlinear_damage, nonlinear_path = accumulate(
            damage_fractions, req.damage_exponents)
        reverse_damage, _ = accumulate(
            list(reversed(damage_fractions)), list(reversed(req.damage_exponents)))
        nonlinear = {
            'model': 'nonlinear damage-curve sensitivity',
            'damage': nonlinear_damage,
            'damage_path': nonlinear_path,
            'reverse_order_damage': reverse_damage,
            'sequence_effect': nonlinear_damage - reverse_damage,
            'damage_exponents': list(req.damage_exponents),
            'failed': nonlinear_damage >= 1.0,
            'sequence_sensitive': True,
        }
        comparison.append(nonlinear)

    result = {
        "damage_fractions": damage_fractions,
        "total_damage": total_damage,
        "remaining_life_fraction": max(0.0, 1.0 - total_damage),
        "failed": total_damage >= 1.0,
        "nonlinear_damage": nonlinear,
        "model_comparison": comparison,
    }
    warnings_list = [
        "Miner's rule ignores load order, interaction, overload retardation and a fatigue limit."
    ]
    if nonlinear is not None:
        warnings_list.append(
            'The nonlinear damage-curve exponents are analyst-supplied sensitivity parameters, not fitted material constants or calibrated uncertainty bounds.')
    return _finalize(
        req, result, linear_damage,
        {
            'miner_damage': lambda r: r['total_damage'],
            'nonlinear_damage': lambda r: (r.get('nonlinear_damage') or {}).get('damage'),
        },
        units={'stress': 'analyst-selected consistent unit', 'cycles': 'cycles', 'damage': 'dimensionless'},
        assumptions=[
            'Each cycles-to-failure value corresponds to its stress level, material, environment and load definition.',
            'Rows are evaluated in the entered load-block order.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 5. Fracture mechanics -- LEFM + Paris law crack growth
# ---------------------------------------------------------------------------

@router.post("/fracture")
def fracture(req: FractureRequest):
    _positive("Crack length a", req.a)
    _positive("Applied stress sigma", req.sigma)
    _positive("Geometry factor Y", req.Y)
    _positive("Fracture toughness K_Ic", req.K_Ic)
    if req.yield_strength is not None:
        _positive("yield_strength", req.yield_strength)
    if req.remaining_ligament is not None:
        _positive("remaining_ligament", req.remaining_ligament)

    K_I = req.Y * req.sigma * math.sqrt(math.pi * req.a)
    critical = K_I >= req.K_Ic
    critical_crack_length = (req.K_Ic / (req.Y * req.sigma)) ** 2 / math.pi
    _finite("Fracture-mechanics outputs", K_I, critical_crack_length)

    result: dict = {
        "K_I": K_I,
        "K_Ic": req.K_Ic,
        "critical": critical,
        "critical_crack_length": critical_crack_length,
    }
    warnings_list = []
    if req.yield_strength is None:
        warnings_list.append(
            'Yield strength was not supplied, so small-scale yielding and LEFM validity were not checked.')
    else:
        plastic_zone = (K_I / req.yield_strength) ** 2 / (2.0 * math.pi)
        result['plane_stress_plastic_zone'] = plastic_zone
        limiting_dimension = min(req.a, req.remaining_ligament) if req.remaining_ligament else req.a
        result['lefm_screen_passed'] = plastic_zone <= 0.1 * limiting_dimension
        if not result['lefm_screen_passed']:
            warnings_list.append(
                'The plane-stress plastic-zone estimate exceeds 10% of the screened crack/ligament dimension; LEFM may be invalid.')

    # Fatigue crack growth (Paris law) if delta_sigma provided
    if req.delta_sigma is not None:
        _positive("delta_sigma", req.delta_sigma)
        _positive("Paris coefficient C", req.C)
        _positive("Paris exponent m", req.m)
        a_init = req.a_initial if req.a_initial is not None else req.a
        _positive("Initial crack length", a_init)
        has_walker = req.walker_C is not None or req.walker_m is not None
        has_forman = req.forman_C is not None or req.forman_m is not None
        if has_walker and (req.walker_C is None or req.walker_m is None):
            raise HTTPException(status_code=400, detail="Provide both walker_C and walker_m.")
        if has_forman and (req.forman_C is None or req.forman_m is None):
            raise HTTPException(status_code=400, detail="Provide both forman_C and forman_m.")
        if (has_walker or has_forman) and req.stress_ratio is None:
            raise HTTPException(status_code=400, detail="stress_ratio is required for Walker or Forman growth.")
        R = 0.0 if req.stress_ratio is None else req.stress_ratio
        _finite("stress_ratio", R)
        if not -1.0 < R < 1.0:
            raise HTTPException(status_code=400, detail="stress_ratio must be between -1 and 1 (exclusive).")
        sigma_max = req.delta_sigma / (1.0 - R)
        a_crit = (req.K_Ic / (req.Y * sigma_max)) ** 2 / math.pi
        result['growth_critical_crack_length'] = a_crit
        result['cyclic_max_stress'] = sigma_max

        if a_init >= a_crit:
            raise HTTPException(
                status_code=400,
                detail="Initial crack length must be less than critical crack length.",
            )
        # Stop just below instability; Forman's denominator is zero at Kmax=K_Ic.
        # Geometric spacing resolves the steep 1/a-like integrand near a small
        # initial flaw far better than an equally sized linear grid.
        a_arr = np.geomspace(a_init, a_crit * (1.0 - 1e-8), 600)
        delta_K = req.Y * req.delta_sigma * np.sqrt(np.pi * a_arr)
        da = np.diff(a_arr)

        def integrate_rate(rate):
            if np.any(~np.isfinite(rate)) or np.any(rate <= 0):
                raise HTTPException(status_code=400, detail="Crack-growth rate is non-finite or non-positive; check model constants and units.")
            inv_rate = 1.0 / rate
            avg = 0.5 * (inv_rate[:-1] + inv_rate[1:])
            return np.concatenate(([0.0], np.cumsum(avg * da)))

        models = {}
        paris_cycles = integrate_rate(req.C * delta_K ** req.m)
        models['paris'] = {
            'cycles_to_critical': float(paris_cycles[-1]),
            'curve': {'a': a_arr.tolist(), 'cycles': paris_cycles.tolist()},
            'C': req.C, 'm': req.m,
        }
        result['crack_growth_curve'] = models['paris']['curve']
        result['cycles_to_critical'] = models['paris']['cycles_to_critical']

        if has_walker:
            _positive("Walker coefficient and exponent", req.walker_C, req.walker_m)
            _finite("walker_gamma", req.walker_gamma)
            if not 0.0 <= req.walker_gamma <= 1.0:
                raise HTTPException(status_code=400, detail="walker_gamma must be between 0 and 1.")
            effective_delta_k = delta_K / ((1.0 - R) ** (1.0 - req.walker_gamma))
            walker_cycles = integrate_rate(req.walker_C * effective_delta_k ** req.walker_m)
            models['walker'] = {
                'cycles_to_critical': float(walker_cycles[-1]),
                'curve': {'a': a_arr.tolist(), 'cycles': walker_cycles.tolist()},
                'C': req.walker_C, 'm': req.walker_m, 'gamma': req.walker_gamma, 'R': R,
            }

        if has_forman:
            _positive("Forman coefficient and exponent", req.forman_C, req.forman_m)
            denominator = (1.0 - R) * req.K_Ic - delta_K
            if np.any(denominator <= 0):
                raise HTTPException(status_code=400, detail="Forman denominator reaches zero before the integration limit.")
            forman_cycles = integrate_rate(req.forman_C * delta_K ** req.forman_m / denominator)
            models['forman'] = {
                'cycles_to_critical': float(forman_cycles[-1]),
                'curve': {'a': a_arr.tolist(), 'cycles': forman_cycles.tolist()},
                'C': req.forman_C, 'm': req.forman_m, 'R': R,
            }
        result['crack_growth_models'] = models
        if len(models) == 1:
            warnings_list.append(
                'Paris growth omits threshold, stress-ratio and near-fracture effects; add separately calibrated Walker/Forman constants for model sensitivity.')
        else:
            warnings_list.append(
                'Paris, Walker and Forman coefficients have model- and unit-specific calibration; compare only constants fitted to compatible crack-growth data.')

    return _finalize(
        req, result, fracture,
        {
            'stress_intensity': lambda r: r['K_I'],
            'critical_crack_length': lambda r: r['critical_crack_length'],
            'paris_cycles_to_critical': lambda r: r.get('cycles_to_critical'),
            'walker_cycles_to_critical': lambda r: (r.get('crack_growth_models') or {}).get('walker', {}).get('cycles_to_critical'),
            'forman_cycles_to_critical': lambda r: (r.get('crack_growth_models') or {}).get('forman', {}).get('cycles_to_critical'),
        },
        units={
            'stress': 'MPa', 'crack_length': 'm', 'stress_intensity': 'MPa√m',
            'crack_growth': 'm/cycle; C units depend on the selected growth law and m',
        },
        assumptions=[
            'Mode-I linear-elastic fracture mechanics, a constant geometry factor and compatible MPa/m units apply.',
            'Crack-growth loads are constant amplitude and model coefficients were fitted in the displayed unit system.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 6. Coffin-Manson low-cycle fatigue (strain-life)
# ---------------------------------------------------------------------------

@router.post("/coffin-manson")
def coffin_manson(req: CoffinMansonRequest):
    _positive("Young's modulus E", req.E)
    _positive("Fatigue strength coefficient sigma_f'", req.sigma_f)
    _positive("Fatigue ductility coefficient epsilon_f'", req.epsilon_f)
    _finite("Coffin-Manson exponents", req.b, req.c)
    if req.b >= 0 or req.c >= 0:
        raise HTTPException(status_code=400, detail="Exponents b and c must be negative.")
    if math.isclose(req.b, req.c, rel_tol=0.0, abs_tol=1e-12):
        raise HTTPException(status_code=400, detail="Exponents b and c must differ to define a transition life.")

    # Strain-life curve: Delta_eps/2 = (sigma_f'/E)(2N)^b + eps_f'(2N)^c
    reversals = np.logspace(1, 8, 100)  # 2N
    strain_elastic = (req.sigma_f / req.E) * reversals ** req.b
    strain_plastic = req.epsilon_f * reversals ** req.c
    strain_total = strain_elastic + strain_plastic

    # Transition life: elastic = plastic
    # (sigma_f'/E)(2N)^b = eps_f'(2N)^c  ->  2N_t = (eps_f' * E / sigma_f')^(1/(b-c))
    transition_reversals = (req.epsilon_f * req.E / req.sigma_f) ** (1.0 / (req.b - req.c))
    transition_strain = (req.sigma_f / req.E) * transition_reversals ** req.b
    _positive("Coffin-Manson transition outputs", transition_reversals, transition_strain)
    if np.any(~np.isfinite(strain_total)):
        raise HTTPException(status_code=400, detail="Coffin-Manson curve overflows; check coefficient units and exponents.")

    prediction = None
    if req.strain_query is not None:
        if req.strain_query <= 0:
            raise HTTPException(status_code=400, detail="strain_query must be positive.")

        def f(log_2n: float) -> float:
            two_n = 10.0 ** log_2n
            return (
                (req.sigma_f / req.E) * two_n ** req.b
                + req.epsilon_f * two_n ** req.c
                - req.strain_query
            )

        lo, hi = 0.0, 8.0
        if f(lo) * f(hi) > 0:
            raise HTTPException(
                status_code=400,
                detail="strain_query is outside the solvable range (2N in [1e0, 1e8]).",
            )
        log_2n_sol = brentq(f, lo, hi)
        reversals_sol = 10.0 ** log_2n_sol
        prediction = {
            "strain_amplitude": req.strain_query,
            "reversals": float(reversals_sol),
            "cycles": float(reversals_sol / 2.0),
        }

    result = {
        "transition_reversals": float(transition_reversals),
        "transition_cycles": float(transition_reversals / 2.0),
        "transition_strain": float(transition_strain),
        "curve": {
            "reversals": reversals.tolist(),
            "strain_elastic": strain_elastic.tolist(),
            "strain_plastic": strain_plastic.tolist(),
            "strain_total": strain_total.tolist(),
        },
        "prediction": prediction,
    }
    warnings_list = [
        'No mean-stress, surface, size, notch, temperature or multiaxial correction is included.'
    ]
    return _finalize(
        req, result, coffin_manson,
        {
            'transition_cycles': lambda r: r['transition_cycles'],
            'predicted_cycles': lambda r: (r.get('prediction') or {}).get('cycles'),
        },
        units={'E': 'MPa', 'sigma_f': 'MPa', 'strain': 'dimensionless', 'life': 'cycles'},
        assumptions=[
            'Material constants use strain amplitude and reversals (2N), with E and sigma_f in MPa.',
            'One uniaxial constant-amplitude strain-life relationship applies over the queried range.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 7. Norris-Landzberg solder-joint thermal fatigue
# ---------------------------------------------------------------------------

@router.post("/norris-landzberg")
def norris_landzberg(req: NorrisLandzbergRequest):
    _positive("Thermal cycle ranges", req.dT_use, req.dT_test)
    _positive("Cycling frequencies", req.f_use, req.f_test)
    _positive("Norris-Landzberg exponents", req.n, req.m)
    _positive("Activation energy Ea", req.Ea, allow_zero=True)
    if req.cycles_test is not None:
        _positive("cycles_test", req.cycles_test)

    T_max_use_K = req.T_max_use + 273.15
    T_max_test_K = req.T_max_test + 273.15
    if T_max_use_K <= 0 or T_max_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")

    factor_dT = (req.dT_test / req.dT_use) ** req.n
    factor_freq = (req.f_use / req.f_test) ** req.m
    factor_temp = _exp_checked(
        req.Ea / K_BOLTZMANN * (1.0 / T_max_use_K - 1.0 / T_max_test_K),
        'Norris-Landzberg temperature factor')
    af = factor_dT * factor_freq * factor_temp
    _positive("Norris-Landzberg acceleration factor", af)

    result = {
        "acceleration_factor": af,
        "factor_dT": factor_dT,
        "factor_frequency": factor_freq,
        "factor_temperature": factor_temp,
        "T_max_use_K": T_max_use_K,
        "T_max_test_K": T_max_test_K,
    }
    if req.cycles_test is not None:
        result["cycles_field"] = af * req.cycles_test
        _positive("Predicted field cycles", result["cycles_field"])

    warnings_list = []
    if req.dT_test <= req.dT_use:
        warnings_list.append('Test thermal range is not greater than the use range.')
    if req.T_max_test <= req.T_max_use:
        warnings_list.append('Test maximum temperature is not greater than the use maximum temperature.')
    if af <= 1:
        warnings_list.append('The combined acceleration factor is not greater than one; the stated test is not accelerated under these inputs.')
    return _finalize(
        req, result, norris_landzberg,
        {
            'acceleration_factor': lambda r: r['acceleration_factor'],
            'field_cycles': lambda r: r.get('cycles_field'),
        },
        units={
            'temperature_range': '°C or K difference', 'absolute_temperature_input': '°C',
            'absolute_temperature_equation': 'K', 'frequency': 'cycles/day',
            'activation_energy': 'eV', 'life': 'cycles',
        },
        assumptions=[
            'Use and test failures share the same solder-joint fatigue mechanism and package/material construction.',
            'Thermal ranges and cycling frequencies use identical units in numerator and denominator.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 8. Black's equation -- electromigration
# ---------------------------------------------------------------------------

@router.post("/electromigration")
def electromigration(req: BlackRequest):
    _positive("Constant A", req.A)
    _positive("Current density J", req.J)
    _positive("Current-density exponent n", req.n)
    _positive("Activation energy Ea", req.Ea, allow_zero=True)

    T_K = req.T + 273.15
    if T_K <= 0:
        raise HTTPException(status_code=400, detail="Temperature must be above absolute zero.")

    log_mttf = math.log(req.A) - req.n * math.log(req.J) + req.Ea / (K_BOLTZMANN * T_K)
    mttf = _exp_checked(log_mttf, 'electromigration MTTF')

    # MTTF vs temperature (25-150 deg C) at the given J
    temp_C = np.linspace(25, 150, 100)
    temp_K = temp_C + 273.15
    mttf_vs_T = np.asarray([
        _exp_checked(math.log(req.A) - req.n * math.log(req.J) + req.Ea / (K_BOLTZMANN * tk), 'electromigration curve MTTF')
        for tk in temp_K
    ])

    # MTTF vs current density (J/10 to 10*J, log-spaced) at the given T
    j_arr = np.logspace(math.log10(req.J) - 1, math.log10(req.J) + 1, 100)
    mttf_vs_J = np.asarray([
        _exp_checked(math.log(req.A) - req.n * math.log(j) + req.Ea / (K_BOLTZMANN * T_K), 'electromigration curve MTTF')
        for j in j_arr
    ])

    result = {
        "mttf": mttf,
        "time_unit": req.time_unit,
        "mttf_hours": mttf if req.time_unit == 'hours' else None,
        "temperature_K": T_K,
        "curve_temperature": {
            "temperature_C": temp_C.tolist(),
            "mttf": mttf_vs_T.tolist(),
            "mttf_hours": mttf_vs_T.tolist() if req.time_unit == 'hours' else None,
        },
        "curve_current_density": {
            "J": j_arr.tolist(),
            "mttf": mttf_vs_J.tolist(),
            "mttf_hours": mttf_vs_J.tolist() if req.time_unit == 'hours' else None,
        },
    }
    return _finalize(
        req, result, electromigration,
        {'mttf': lambda r: r['mttf']},
        units={
            'current_density': 'A/cm²', 'temperature_input': '°C',
            'temperature_equation': 'K', 'activation_energy': 'eV', 'MTTF': req.time_unit,
            'A': f'{req.time_unit}·(A/cm²)^{req.n:g}',
        },
        assumptions=[
            "Black's equation constants were calibrated for J in A/cm² and the selected time unit.",
            'The same electromigration mechanism and microstructure apply at the requested condition.',
        ],
        warnings=[
            'A deterministic Black-law MTTF is a characteristic life, not a population reliability or confidence bound.'
        ],
    )


# ---------------------------------------------------------------------------
# 9. Peck's temperature-humidity model
# ---------------------------------------------------------------------------

@router.post("/peck")
def peck(req: PeckRequest):
    _positive("Constant A", req.A)
    _positive("Relative humidity", req.RH)
    if req.RH > 100:
        raise HTTPException(status_code=400, detail="Relative humidity RH must not exceed 100%.")
    _positive("Humidity exponent n", req.n)
    _positive("Activation energy Ea", req.Ea, allow_zero=True)
    if (req.RH_use is None) != (req.T_use is None):
        raise HTTPException(status_code=400, detail="Provide both RH_use and T_use, or neither.")

    T_K = req.T + 273.15
    if T_K <= 0:
        raise HTTPException(status_code=400, detail="Temperature must be above absolute zero.")

    ttf_test = _exp_checked(
        math.log(req.A) - req.n * math.log(req.RH) + req.Ea / (K_BOLTZMANN * T_K),
        'Peck test life')

    result: dict = {
        "ttf_test_hours": ttf_test,
        "temperature_K": T_K,
    }

    # Acceleration factor vs use conditions
    # AF = TTF_use / TTF_test = (RH_use/RH_test)^(-n) * exp(Ea/k * (1/T_use - 1/T_test))
    # AF > 1 when test conditions are harsher (higher RH, higher T).
    if req.RH_use is not None and req.T_use is not None:
        _positive("RH_use", req.RH_use)
        if req.RH_use > 100:
            raise HTTPException(status_code=400, detail="RH_use must not exceed 100%.")
        T_use_K = req.T_use + 273.15
        if T_use_K <= 0:
            raise HTTPException(status_code=400, detail="T_use must be above absolute zero.")
        af = (req.RH_use / req.RH) ** (-req.n) * _exp_checked(
            req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_K),
            'Peck temperature acceleration factor')
        _positive("Peck acceleration factor", af)
        result["acceleration_factor"] = af
        use_life = _exp_checked(math.log(af) + math.log(ttf_test), 'Peck use life')
        result["ttf_use"] = use_life
        result["ttf_use_hours"] = use_life if req.time_unit == 'hours' else None

    # TTF vs RH curve (40-100%) at the given test temperature
    rh_arr = np.linspace(40, 100, 100)
    ttf_arr = np.asarray([
        _exp_checked(math.log(req.A) - req.n * math.log(rh) + req.Ea / (K_BOLTZMANN * T_K), 'Peck curve life')
        for rh in rh_arr
    ])
    result["curve"] = {
        "RH": rh_arr.tolist(),
        "ttf": ttf_arr.tolist(),
        "ttf_hours": ttf_arr.tolist() if req.time_unit == 'hours' else None,
    }
    result['ttf_test'] = ttf_test
    result['time_unit'] = req.time_unit
    result['ttf_test_hours'] = ttf_test if req.time_unit == 'hours' else None
    warnings_list = []
    if result.get('acceleration_factor', 2.0) <= 1:
        warnings_list.append('The stated test condition is not accelerated relative to use under this model.')
    warnings_list.append(
        'Relative humidity is entered as percent (for example 85), so A must be calibrated to that convention and selected time unit.')
    return _finalize(
        req, result, peck,
        {
            'test_life': lambda r: r['ttf_test'],
            'acceleration_factor': lambda r: r.get('acceleration_factor'),
            'use_life': lambda r: r.get('ttf_use'),
        },
        units={
            'relative_humidity': 'percent', 'temperature_input': '°C',
            'temperature_equation': 'K', 'activation_energy': 'eV', 'life': req.time_unit,
        },
        assumptions=[
            'A and n were calibrated with RH expressed in percent and life in the selected unit.',
            'Use and test share one humidity-temperature failure mechanism without condensation or a mechanism transition.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 10. Arrhenius thermal acceleration
# ---------------------------------------------------------------------------

@router.post("/arrhenius")
def arrhenius(req: ArrheniusRequest):
    # Ea is a signed *apparent* activation energy in this calculator.  Most
    # thermally activated mechanisms have Ea > 0, but inverse-temperature
    # mechanisms (including some hot-carrier degradation regimes) are fitted
    # with Ea < 0.  Ea == 0 is also a valid temperature-neutral limiting case.
    _finite("Apparent activation energy Ea", req.Ea)
    if req.life_test is not None:
        _positive("life_test", req.life_test)
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")
    af = _exp_checked(
        req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K),
        'Arrhenius acceleration factor')

    if math.isclose(af, 1.0, rel_tol=1e-12, abs_tol=1e-15):
        test_severity = 'equivalent'
    elif af > 1.0:
        test_severity = 'more_damaging'
    else:
        test_severity = 'less_damaging'

    if req.Ea > 0:
        temperature_response = 'higher_temperature_increases_modeled_rate'
    elif req.Ea < 0:
        temperature_response = 'higher_temperature_decreases_modeled_rate'
    else:
        temperature_response = 'temperature_neutral'

    result: dict = {
        "acceleration_factor": af,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
        "temperature_response": temperature_response,
        "test_severity": test_severity,
    }
    if req.life_test is not None:
        result["life_use"] = _exp_checked(
            math.log(af) + math.log(req.life_test), 'Arrhenius use life')
        result["life_unit"] = req.life_unit
        result["life_use_hours"] = result["life_use"] if req.life_unit == 'hours' else None

    # Plot a local temperature range that contains both entered conditions.
    # This works for ordinary hot acceleration and inverse-temperature models
    # whose accelerated condition can be colder than use.
    span = max(abs(req.T_test - req.T_use), 20.0)
    padding = max(10.0, 0.15 * span)
    curve_start = max(-273.14, min(req.T_use, req.T_test) - padding)
    curve_end = max(req.T_use, req.T_test) + padding
    t_test_C = np.linspace(curve_start, curve_end, 100)
    t_test_K = t_test_C + 273.15
    af_arr = np.asarray([
        _exp_checked(req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / tk), 'Arrhenius curve AF')
        for tk in t_test_K
    ])
    result["curve"] = {
        "T_test_C": t_test_C.tolist(),
        "af": af_arr.tolist(),
    }

    warnings_list = [
        'A two-condition Arrhenius calculation does not validate the apparent activation energy or detect a mechanism change.'
    ]
    if req.Ea < 0:
        warnings_list.append(
            'Negative apparent activation energy reverses the usual temperature response: '
            'modeled failure rate decreases as temperature increases. Confirm that the signed '
            'value and inverse-temperature regime are supported for this specific mechanism and technology.'
        )
    elif req.Ea == 0:
        warnings_list.append(
            'Ea is zero, so this model predicts no temperature dependence and AF = 1 for every temperature pair.'
        )
    if test_severity == 'less_damaging':
        warnings_list.append(
            'The entered test condition is less damaging than the use condition under this model (AF < 1); '
            'the result is a deceleration factor, not an accelerated-test multiplier.'
        )
    elif test_severity == 'equivalent':
        warnings_list.append(
            'The entered test and use conditions are equivalent under this model (AF = 1); no acceleration is present.'
        )

    return _finalize(
        req, result, arrhenius,
        {
            'acceleration_factor': lambda r: r['acceleration_factor'],
            'use_life': lambda r: r.get('life_use'),
        },
        units={
            'temperature_input': '°C', 'temperature_equation': 'K',
            'activation_energy': 'eV', 'life': req.life_unit,
        },
        assumptions=[
            'Use and test share one failure mechanism and the same signed apparent activation energy over the stated range.',
            'AF is defined as modeled rate_test / rate_use, equivalently life_use / life_test, and scales the selected test-life unit without changing it.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 11. Eyring thermal acceleration (Arrhenius generalised with T^n term)
# ---------------------------------------------------------------------------

@router.post("/eyring")
def eyring(req: EyringRequest):
    """Eyring model acceleration factor.

    AF = (T_test/T_use)^n * exp(Ea/k * (1/T_use - 1/T_test))

    Reduces to Arrhenius when n = 0. The (T_test/T_use)^n pre-factor captures
    the temperature dependence of the reaction-rate pre-exponential term.
    """
    _positive("Activation energy Ea", req.Ea, allow_zero=True)
    _finite("Eyring temperature exponent n", req.n)
    if req.life_test is not None:
        _positive("life_test", req.life_test)
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")
    if req.T_test <= req.T_use:
        raise HTTPException(
            status_code=400,
            detail="Test temperature must be greater than use temperature.",
        )

    log_pre = req.n * math.log(T_test_K / T_use_K)
    pre = _exp_checked(log_pre, 'Eyring temperature pre-factor')
    af = _exp_checked(
        log_pre + req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K),
        'Eyring acceleration factor')

    result: dict = {
        "acceleration_factor": af,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
    }
    if req.life_test is not None:
        result["life_use"] = _exp_checked(
            math.log(af) + math.log(req.life_test), 'Eyring use life')
        result["life_unit"] = req.life_unit
        result["life_use_hours"] = result["life_use"] if req.life_unit == 'hours' else None

    # AF vs test temperature curve (T_use + 10 ... 200 deg C)
    curve_end = max(200.0, req.T_test, req.T_use + 20.0)
    t_test_C = np.linspace(req.T_use + min(10.0, (curve_end - req.T_use) / 2.0), curve_end, 100)
    t_test_K = t_test_C + 273.15
    af_arr = np.asarray([
        _exp_checked(
            req.n * math.log(tk / T_use_K)
            + req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / tk),
            'Eyring curve acceleration factor')
        for tk in t_test_K
    ])
    result["curve"] = {
        "T_test_C": t_test_C.tolist(),
        "af": af_arr.tolist(),
    }

    warnings_list = []
    if af <= 1:
        warnings_list.append('The combined Eyring acceleration factor is not greater than one despite the higher test temperature.')
    warnings_list.append(
        'Ea and the temperature pre-exponent must be estimated from a design with enough distinct temperatures; this calculator does not establish identifiability.')
    return _finalize(
        req, result, eyring,
        {
            'acceleration_factor': lambda r: r['acceleration_factor'],
            'use_life': lambda r: r.get('life_use'),
        },
        units={
            'temperature_input': '°C', 'temperature_equation': 'K',
            'activation_energy': 'eV', 'life': req.life_unit,
        },
        assumptions=[
            'Use and test share one mechanism and one Eyring parameterization over the temperature range.',
            'The T^n pre-factor uses absolute Kelvin temperatures.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 12. Hallberg-Peck temperature-humidity acceleration factor
# ---------------------------------------------------------------------------

@router.post("/hallberg-peck")
def hallberg_peck(req: HallbergPeckRequest):
    """Hallberg-Peck temperature-humidity acceleration factor.

    AF = (RH_test/RH_use)^n * exp(Ea/k * (1/T_use - 1/T_test))

    Equivalent in form to Peck's model written as an AF between two
    temperature-humidity conditions; n is typically ~3 and Ea ~0.9 eV.
    """
    _positive("Relative humidity values", req.RH_use, req.RH_test)
    if req.RH_use > 100 or req.RH_test > 100:
        raise HTTPException(status_code=400, detail="Relative humidity values must not exceed 100%.")
    _positive("Humidity exponent n", req.n)
    _positive("Activation energy Ea", req.Ea, allow_zero=True)
    if req.life_test is not None:
        _positive("life_test", req.life_test)
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")

    factor_rh = _exp_checked(
        req.n * math.log(req.RH_test / req.RH_use), 'Hallberg-Peck humidity factor')
    factor_temp = _exp_checked(
        req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K),
        'Hallberg-Peck temperature factor')
    af = factor_rh * factor_temp
    _positive("Hallberg-Peck acceleration factor", af)

    result: dict = {
        "acceleration_factor": af,
        "factor_humidity": factor_rh,
        "factor_temperature": factor_temp,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
    }
    if req.life_test is not None:
        result["life_use"] = _exp_checked(
            math.log(af) + math.log(req.life_test), 'Hallberg-Peck use life')
        result["life_unit"] = req.life_unit
        result["life_use_hours"] = result["life_use"] if req.life_unit == 'hours' else None

    # AF vs use RH curve (20-90%) at the given use/test temperatures
    rh_arr = np.linspace(20, 90, 100)
    af_arr = np.asarray([
        _exp_checked(
            req.n * math.log(req.RH_test / rh) + math.log(factor_temp),
            'Hallberg-Peck curve acceleration factor')
        for rh in rh_arr
    ])
    result["curve"] = {
        "RH_use": rh_arr.tolist(),
        "af": af_arr.tolist(),
    }

    warnings_list = []
    if af <= 1:
        warnings_list.append('The combined humidity-temperature factor is not greater than one; the stated test is not accelerated.')
    warnings_list.append('The model does not cover condensation, bias-voltage effects or humidity-driven mechanism transitions.')
    return _finalize(
        req, result, hallberg_peck,
        {
            'acceleration_factor': lambda r: r['acceleration_factor'],
            'use_life': lambda r: r.get('life_use'),
        },
        units={
            'relative_humidity': 'percent', 'temperature_input': '°C',
            'temperature_equation': 'K', 'activation_energy': 'eV', 'life': req.life_unit,
        },
        assumptions=[
            'RH is expressed consistently as percent in both conditions.',
            'Use and test share one humidity-temperature failure mechanism.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 13. Time-Dependent Dielectric Breakdown (TDDB) -- E and 1/E models
# ---------------------------------------------------------------------------

@router.post("/tddb")
def tddb(req: TDDBRequest):
    """TDDB acceleration factor for oxide breakdown.

    E-model (thermochemical):   TTF ~ exp(-gamma * E) * exp(Ea/kT)
        AF = exp(gamma * (E_test - E_use)) * exp(Ea/k * (1/T_use - 1/T_test))
    1/E-model (anode hole inj.): TTF ~ exp(gamma / E) * exp(Ea/kT)
        AF = exp(gamma * (1/E_use - 1/E_test)) * exp(Ea/k * (1/T_use - 1/T_test))

    gamma is the field acceleration parameter, E the oxide electric field
    (MV/cm). AF = TTF_use / TTF_test (>1 when test stress is harsher).
    """
    _positive("Electric fields", req.E_use, req.E_test)
    _positive("Field acceleration parameter gamma", req.gamma)
    _positive("Activation energy Ea", req.Ea, allow_zero=True)
    if req.life_test is not None:
        _positive("life_test", req.life_test)
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")

    model = req.model.strip()
    if model == "E":
        factor_field = _exp_checked(
            req.gamma * (req.E_test - req.E_use), 'TDDB E-model field factor')
    elif model in ("1/E", "1E", "inv-E"):
        model = "1/E"
        factor_field = _exp_checked(
            req.gamma * (1.0 / req.E_use - 1.0 / req.E_test), 'TDDB 1/E-model field factor')
    else:
        raise HTTPException(status_code=400, detail="model must be 'E' or '1/E'.")

    factor_temp = _exp_checked(
        req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K),
        'TDDB temperature factor')
    af = factor_field * factor_temp
    _positive("TDDB acceleration factor", af)

    result: dict = {
        "model": model,
        "acceleration_factor": af,
        "factor_field": factor_field,
        "factor_temperature": factor_temp,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
    }
    if req.life_test is not None:
        result["life_use"] = _exp_checked(
            math.log(af) + math.log(req.life_test), 'TDDB use life')
        result["life_unit"] = req.life_unit
        result["life_use_hours"] = result["life_use"] if req.life_unit == 'hours' else None

    # AF vs use field curve at the given temperatures
    e_arr = np.linspace(max(1e-6, min(req.E_use, req.E_test) * 0.5), max(req.E_use, req.E_test), 100)
    if model == "E":
        field_arr = np.asarray([
            _exp_checked(req.gamma * (req.E_test - e), 'TDDB curve field factor') for e in e_arr
        ])
    else:
        field_arr = np.asarray([
            _exp_checked(req.gamma * (1.0 / e - 1.0 / req.E_test), 'TDDB curve field factor') for e in e_arr
        ])
    af_arr = np.asarray([
        _exp_checked(math.log(field) + math.log(factor_temp), 'TDDB curve acceleration factor')
        for field in field_arr
    ])
    result["curve"] = {
        "E_use": e_arr.tolist(),
        "af": af_arr.tolist(),
    }

    warnings_list = []
    if af <= 1:
        warnings_list.append('The combined TDDB factor is not greater than one; the stated test is not accelerated.')
    warnings_list.append(
        'E and 1/E laws represent competing empirical extrapolations; mechanism, oxide technology and calibrated field range must support the chosen law.')
    return _finalize(
        req, result, tddb,
        {
            'acceleration_factor': lambda r: r['acceleration_factor'],
            'use_life': lambda r: r.get('life_use'),
        },
        units={
            'electric_field': 'MV/cm', 'temperature_input': '°C',
            'temperature_equation': 'K', 'activation_energy': 'eV',
            'gamma': 'cm/MV for E; MV/cm for 1/E', 'life': req.life_unit,
        },
        assumptions=[
            'Use and test share one oxide-breakdown mechanism and technology.',
            'The selected E or 1/E law and gamma were calibrated in MV/cm over a relevant field range.',
        ],
        warnings=warnings_list,
    )


# ---------------------------------------------------------------------------
# 14. Mean-stress correction -- modified Goodman / Soderberg / Gerber
# ---------------------------------------------------------------------------

@router.post("/mean-stress")
def mean_stress(req: MeanStressRequest):
    """Goodman / Soderberg / Gerber fatigue mean-stress sensitivity.

    Both criteria express the safe combination of alternating stress (sigma_a)
    and mean stress (sigma_m) as a straight failure line on the sigma_m-sigma_a
    diagram, scaled by the factor of safety n:

        Modified Goodman:  sigma_a/Se + sigma_m/Su = 1/n
        Soderberg:         sigma_a/Se + sigma_m/Sy = 1/n

    where Se is the fully-reversed endurance/fatigue limit, Su the ultimate
    tensile strength and Sy the yield strength. The factor of safety is the
    reciprocal of the left-hand side; n >= 1 is safe. The failure line runs
    from (0, Se) on the sigma_a axis to (S_intercept, 0) on the sigma_m axis,
    where S_intercept = Su (Goodman) or Sy (Soderberg).
    """
    method = req.method.strip().lower()
    if method not in ("goodman", "soderberg", "gerber"):
        raise HTTPException(status_code=400, detail="method must be 'goodman', 'soderberg', or 'gerber'.")
    _positive("Endurance limit Se", req.Se)
    _positive("Ultimate strength Su", req.Su)
    _positive("Yield strength Sy", req.Sy)
    _finite("Operating stresses", req.sigma_a, req.sigma_m)
    if req.sigma_a < 0 or req.sigma_m < 0:
        raise HTTPException(
            status_code=400,
            detail="This comparison is limited to non-negative alternating and tensile mean stresses.",
        )
    if req.Sy > req.Su:
        raise HTTPException(status_code=400, detail="Yield strength Sy must not exceed ultimate strength Su.")
    if req.Se > req.Su:
        raise HTTPException(status_code=400, detail="Endurance limit Se must not exceed ultimate strength Su.")

    def linear_factor(intercept):
        inverse = req.sigma_a / req.Se + req.sigma_m / intercept
        return float('inf') if inverse == 0 else 1.0 / inverse

    def gerber_factor():
        # Scaling both applied stresses by n gives B*n^2 + A*n - 1 = 0.
        A = req.sigma_a / req.Se
        B = (req.sigma_m / req.Su) ** 2
        if A == 0 and B == 0:
            return float('inf')
        if B == 0:
            return 1.0 / A
        return (-A + math.sqrt(A * A + 4.0 * B)) / (2.0 * B)

    curves = {}
    comparison = []
    for name, intercept, label in (
        ('goodman', req.Su, 'Su'), ('soderberg', req.Sy, 'Sy'), ('gerber', req.Su, 'Su')
    ):
        factor = gerber_factor() if name == 'gerber' else linear_factor(intercept)
        line_m = np.linspace(0.0, intercept, 100)
        if name == 'gerber':
            line_a = req.Se * (1.0 - (line_m / req.Su) ** 2)
        else:
            line_a = req.Se * (1.0 - line_m / intercept)
        curves[name] = {'sigma_m': line_m.tolist(), 'sigma_a': line_a.tolist()}
        comparison.append({
            'method': name,
            'factor_of_safety': factor,
            'safe': factor >= 1.0,
            'strength_label': label,
            'strength_intercept': intercept,
        })

    selected = next(row for row in comparison if row['method'] == method)
    finite_factors = [row['factor_of_safety'] for row in comparison if math.isfinite(row['factor_of_safety'])]
    warnings_list = [
        'Goodman, Soderberg and Gerber are alternative empirical mean-stress criteria, not confidence bounds.'
    ]
    if finite_factors and min(finite_factors) < 1.0 <= max(finite_factors):
        warnings_list.append(
            'The criteria disagree on the pass/fail decision; material-specific fatigue data or a more appropriate model is required.')

    result = {
        "method": method,
        "factor_of_safety": selected['factor_of_safety'],
        "safe": selected['safe'],
        "Se": req.Se,
        "strength_label": selected['strength_label'],
        "strength_intercept": selected['strength_intercept'],
        "operating_point": {"sigma_m": req.sigma_m, "sigma_a": req.sigma_a},
        "failure_line": curves[method],
        "model_comparison": comparison,
        "failure_lines": curves,
    }
    return _finalize(
        req, result, mean_stress,
        {
            'selected_factor_of_safety': lambda r: r['factor_of_safety'],
            'goodman_factor_of_safety': lambda r: next(x['factor_of_safety'] for x in r['model_comparison'] if x['method'] == 'goodman'),
            'soderberg_factor_of_safety': lambda r: next(x['factor_of_safety'] for x in r['model_comparison'] if x['method'] == 'soderberg'),
            'gerber_factor_of_safety': lambda r: next(x['factor_of_safety'] for x in r['model_comparison'] if x['method'] == 'gerber'),
        },
        units={'all_stresses_and_strengths': 'MPa', 'factor_of_safety': 'dimensionless'},
        assumptions=[
            'All stresses and strengths use the same MPa basis and nominal (not local notch) values unless consistently corrected.',
            'The comparison is limited to tensile mean stress and uniaxial high-cycle fatigue.',
        ],
        warnings=warnings_list,
    )
