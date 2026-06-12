"""Physics of Failure router -- stress-based failure analysis calculations."""

import math

import numpy as np
from fastapi import APIRouter, HTTPException

from schemas import (
    SNCurveRequest,
    StressStrainRequest,
    CreepRequest,
    DamageRequest,
    FractureRequest,
)

router = APIRouter()


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

    if np.any(S <= 0) or np.any(N <= 0):
        raise HTTPException(
            status_code=400,
            detail="All stress and cycle values must be positive.",
        )

    # Basquin fit: log10(S) = b * log10(N) + log10(A)
    log_N = np.log10(N)
    log_S = np.log10(S)
    coeffs = np.polyfit(log_N, log_S, 1)  # [b, log10(A)]
    b = float(coeffs[0])
    A = float(10 ** coeffs[1])

    # R-squared
    S_pred = 10 ** np.polyval(coeffs, log_N)
    ss_res = float(np.sum((S - S_pred) ** 2))
    ss_tot = float(np.sum((S - np.mean(S)) ** 2))
    r_squared = 1.0 - ss_res / ss_tot if ss_tot != 0 else 0.0

    # Endurance limit estimate at N = 1e7
    endurance_limit = float(A * (1e7 ** b))

    # Fitted curve (100 log-spaced points)
    n_min = float(np.min(N))
    n_max = float(np.max(N)) * 10
    curve_n = np.logspace(np.log10(n_min), np.log10(n_max), 100)
    curve_s = A * curve_n ** b

    # Optional predictions
    prediction = {}
    if req.stress_query is not None:
        # N = (S / A)^(1/b)
        if b == 0:
            raise HTTPException(status_code=400, detail="Slope b is zero; cannot predict life.")
        predicted_life = (req.stress_query / A) ** (1.0 / b)
        prediction["cycles"] = float(predicted_life)
    if req.life_query is not None:
        predicted_stress = A * (req.life_query ** b)
        prediction["stress"] = float(predicted_stress)

    return {
        "A": A,
        "b": b,
        "endurance_limit": endurance_limit,
        "r_squared": r_squared,
        "curve": {
            "n": curve_n.tolist(),
            "s": curve_s.tolist(),
        },
        "prediction": prediction if prediction else None,
    }


# ---------------------------------------------------------------------------
# 2. Stress-strain (Ramberg-Osgood)
# ---------------------------------------------------------------------------

@router.post("/stress-strain")
def stress_strain(req: StressStrainRequest):
    if req.E <= 0:
        raise HTTPException(status_code=400, detail="Young's modulus E must be positive.")
    if req.K <= 0:
        raise HTTPException(status_code=400, detail="Strength coefficient K must be positive.")
    if req.n <= 0:
        raise HTTPException(status_code=400, detail="Strain hardening exponent n must be positive.")

    max_stress = req.max_stress if req.max_stress is not None else 1.5 * req.K
    sigma = np.linspace(0, max_stress, 200)

    strain_elastic = sigma / req.E
    strain_plastic = (sigma / req.K) ** (1.0 / req.n)
    strain_total = strain_elastic + strain_plastic

    return {
        "stress": sigma.tolist(),
        "strain_elastic": strain_elastic.tolist(),
        "strain_plastic": strain_plastic.tolist(),
        "strain_total": strain_total.tolist(),
        "E": req.E,
        "K": req.K,
        "n": req.n,
    }


# ---------------------------------------------------------------------------
# 3. Creep life -- Larson-Miller parameter
# ---------------------------------------------------------------------------

@router.post("/creep-life")
def creep_life(req: CreepRequest):
    if req.stress_MPa <= 0:
        raise HTTPException(status_code=400, detail="Stress must be positive.")
    if len(req.lmp_coeffs) < 2:
        raise HTTPException(
            status_code=400,
            detail="lmp_coeffs must have at least 2 elements [a, b].",
        )

    T_K = req.temperature_C + 273.15
    lmp = req.lmp_coeffs[0] + req.lmp_coeffs[1] * math.log10(req.stress_MPa)
    time_to_rupture = 10.0 ** (lmp / T_K - req.C)

    # Curve: time vs temperature at the given stress
    temp_C = np.linspace(300, 800, 100)
    temp_K = temp_C + 273.15
    time_hours = 10.0 ** (lmp / temp_K - req.C)

    return {
        "lmp": lmp,
        "temperature_K": T_K,
        "time_to_rupture_hours": time_to_rupture,
        "curve": {
            "temperature_C": temp_C.tolist(),
            "time_hours": time_hours.tolist(),
        },
    }


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

    damage_fractions = []
    for n_i, N_i in zip(req.cycles_applied, req.cycles_to_failure):
        if N_i <= 0:
            raise HTTPException(status_code=400, detail="cycles_to_failure values must be positive.")
        damage_fractions.append(n_i / N_i)

    total_damage = sum(damage_fractions)

    return {
        "damage_fractions": damage_fractions,
        "total_damage": total_damage,
        "remaining_life_fraction": max(0.0, 1.0 - total_damage),
        "failed": total_damage >= 1.0,
    }


# ---------------------------------------------------------------------------
# 5. Fracture mechanics -- LEFM + Paris law crack growth
# ---------------------------------------------------------------------------

@router.post("/fracture")
def fracture(req: FractureRequest):
    if req.a <= 0:
        raise HTTPException(status_code=400, detail="Crack length a must be positive.")
    if req.sigma <= 0:
        raise HTTPException(status_code=400, detail="Applied stress sigma must be positive.")

    K_I = req.Y * req.sigma * math.sqrt(math.pi * req.a)
    critical = K_I >= req.K_Ic
    critical_crack_length = (req.K_Ic / (req.Y * req.sigma)) ** 2 / math.pi

    result: dict = {
        "K_I": K_I,
        "K_Ic": req.K_Ic,
        "critical": critical,
        "critical_crack_length": critical_crack_length,
    }

    # Fatigue crack growth (Paris law) if delta_sigma provided
    if req.delta_sigma is not None:
        a_init = req.a_initial if req.a_initial is not None else req.a
        a_crit = critical_crack_length

        if a_init >= a_crit:
            raise HTTPException(
                status_code=400,
                detail="Initial crack length must be less than critical crack length.",
            )
        if a_init <= 0:
            raise HTTPException(
                status_code=400,
                detail="Initial crack length must be positive.",
            )

        a_arr = np.linspace(a_init, a_crit, 200)
        delta_K = req.Y * req.delta_sigma * np.sqrt(np.pi * a_arr)
        da_dN = req.C * delta_K ** req.m

        # Numerical integration: dN = da / (da/dN)
        # Use cumulative trapezoid: cycles = integral of 1/(da/dN) da
        da = np.diff(a_arr)
        integrand = 1.0 / da_dN
        # Trapezoidal rule for cumulative integral
        avg_integrand = 0.5 * (integrand[:-1] + integrand[1:])
        cum_cycles = np.concatenate(([0.0], np.cumsum(avg_integrand * da)))

        result["crack_growth_curve"] = {
            "a": a_arr.tolist(),
            "cycles": cum_cycles.tolist(),
        }

    return result
