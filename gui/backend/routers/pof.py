"""Physics of Failure router -- stress-based failure analysis calculations."""

import math

import numpy as np
from fastapi import APIRouter, HTTPException
from scipy.optimize import brentq

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
)

router = APIRouter()

# Boltzmann constant (eV/K)
K_BOLTZMANN = 8.617e-5


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


# ---------------------------------------------------------------------------
# 6. Coffin-Manson low-cycle fatigue (strain-life)
# ---------------------------------------------------------------------------

@router.post("/coffin-manson")
def coffin_manson(req: CoffinMansonRequest):
    if req.E <= 0:
        raise HTTPException(status_code=400, detail="Young's modulus E must be positive.")
    if req.sigma_f <= 0:
        raise HTTPException(status_code=400, detail="Fatigue strength coefficient sigma_f' must be positive.")
    if req.epsilon_f <= 0:
        raise HTTPException(status_code=400, detail="Fatigue ductility coefficient epsilon_f' must be positive.")
    if req.b >= 0 or req.c >= 0:
        raise HTTPException(status_code=400, detail="Exponents b and c must be negative.")

    # Strain-life curve: Delta_eps/2 = (sigma_f'/E)(2N)^b + eps_f'(2N)^c
    reversals = np.logspace(1, 8, 100)  # 2N
    strain_elastic = (req.sigma_f / req.E) * reversals ** req.b
    strain_plastic = req.epsilon_f * reversals ** req.c
    strain_total = strain_elastic + strain_plastic

    # Transition life: elastic = plastic
    # (sigma_f'/E)(2N)^b = eps_f'(2N)^c  ->  2N_t = (eps_f' * E / sigma_f')^(1/(b-c))
    transition_reversals = (req.epsilon_f * req.E / req.sigma_f) ** (1.0 / (req.b - req.c))
    transition_strain = (req.sigma_f / req.E) * transition_reversals ** req.b

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

    return {
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


# ---------------------------------------------------------------------------
# 7. Norris-Landzberg solder-joint thermal fatigue
# ---------------------------------------------------------------------------

@router.post("/norris-landzberg")
def norris_landzberg(req: NorrisLandzbergRequest):
    if req.dT_use <= 0 or req.dT_test <= 0:
        raise HTTPException(status_code=400, detail="Thermal cycle ranges must be positive.")
    if req.f_use <= 0 or req.f_test <= 0:
        raise HTTPException(status_code=400, detail="Cycling frequencies must be positive.")

    T_max_use_K = req.T_max_use + 273.15
    T_max_test_K = req.T_max_test + 273.15
    if T_max_use_K <= 0 or T_max_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")

    factor_dT = (req.dT_test / req.dT_use) ** req.n
    factor_freq = (req.f_use / req.f_test) ** req.m
    factor_temp = math.exp(req.Ea / K_BOLTZMANN * (1.0 / T_max_use_K - 1.0 / T_max_test_K))
    af = factor_dT * factor_freq * factor_temp

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

    return result


# ---------------------------------------------------------------------------
# 8. Black's equation -- electromigration
# ---------------------------------------------------------------------------

@router.post("/electromigration")
def electromigration(req: BlackRequest):
    if req.A <= 0:
        raise HTTPException(status_code=400, detail="Constant A must be positive.")
    if req.J <= 0:
        raise HTTPException(status_code=400, detail="Current density J must be positive.")

    T_K = req.T + 273.15
    if T_K <= 0:
        raise HTTPException(status_code=400, detail="Temperature must be above absolute zero.")

    mttf = req.A * req.J ** (-req.n) * math.exp(req.Ea / (K_BOLTZMANN * T_K))

    # MTTF vs temperature (25-150 deg C) at the given J
    temp_C = np.linspace(25, 150, 100)
    temp_K = temp_C + 273.15
    mttf_vs_T = req.A * req.J ** (-req.n) * np.exp(req.Ea / (K_BOLTZMANN * temp_K))

    # MTTF vs current density (J/10 to 10*J, log-spaced) at the given T
    j_arr = np.logspace(math.log10(req.J) - 1, math.log10(req.J) + 1, 100)
    mttf_vs_J = req.A * j_arr ** (-req.n) * math.exp(req.Ea / (K_BOLTZMANN * T_K))

    return {
        "mttf_hours": mttf,
        "temperature_K": T_K,
        "curve_temperature": {
            "temperature_C": temp_C.tolist(),
            "mttf_hours": mttf_vs_T.tolist(),
        },
        "curve_current_density": {
            "J": j_arr.tolist(),
            "mttf_hours": mttf_vs_J.tolist(),
        },
    }


# ---------------------------------------------------------------------------
# 9. Peck's temperature-humidity model
# ---------------------------------------------------------------------------

@router.post("/peck")
def peck(req: PeckRequest):
    if req.A <= 0:
        raise HTTPException(status_code=400, detail="Constant A must be positive.")
    if req.RH <= 0:
        raise HTTPException(status_code=400, detail="Relative humidity must be positive.")

    T_K = req.T + 273.15
    if T_K <= 0:
        raise HTTPException(status_code=400, detail="Temperature must be above absolute zero.")

    ttf_test = req.A * req.RH ** (-req.n) * math.exp(req.Ea / (K_BOLTZMANN * T_K))

    result: dict = {
        "ttf_test_hours": ttf_test,
        "temperature_K": T_K,
    }

    # Acceleration factor vs use conditions
    # AF = TTF_use / TTF_test = (RH_use/RH_test)^(-n) * exp(Ea/k * (1/T_use - 1/T_test))
    # AF > 1 when test conditions are harsher (higher RH, higher T).
    if req.RH_use is not None and req.T_use is not None:
        if req.RH_use <= 0:
            raise HTTPException(status_code=400, detail="RH_use must be positive.")
        T_use_K = req.T_use + 273.15
        if T_use_K <= 0:
            raise HTTPException(status_code=400, detail="T_use must be above absolute zero.")
        af = (req.RH_use / req.RH) ** (-req.n) * math.exp(
            req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_K)
        )
        result["acceleration_factor"] = af
        result["ttf_use_hours"] = af * ttf_test

    # TTF vs RH curve (40-100%) at the given test temperature
    rh_arr = np.linspace(40, 100, 100)
    ttf_arr = req.A * rh_arr ** (-req.n) * math.exp(req.Ea / (K_BOLTZMANN * T_K))
    result["curve"] = {
        "RH": rh_arr.tolist(),
        "ttf_hours": ttf_arr.tolist(),
    }

    return result


# ---------------------------------------------------------------------------
# 10. Arrhenius thermal acceleration
# ---------------------------------------------------------------------------

@router.post("/arrhenius")
def arrhenius(req: ArrheniusRequest):
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")
    if req.T_test <= req.T_use:
        raise HTTPException(
            status_code=400,
            detail="Test temperature must be greater than use temperature.",
        )

    af = math.exp(req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K))

    result: dict = {
        "acceleration_factor": af,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
    }
    if req.life_test is not None:
        result["life_use_hours"] = af * req.life_test

    # AF vs test temperature curve (T_use + 10 ... 200 deg C)
    t_test_C = np.linspace(req.T_use + 10, 200, 100)
    t_test_K = t_test_C + 273.15
    af_arr = np.exp(req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / t_test_K))
    result["curve"] = {
        "T_test_C": t_test_C.tolist(),
        "af": af_arr.tolist(),
    }

    return result


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
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")
    if req.T_test <= req.T_use:
        raise HTTPException(
            status_code=400,
            detail="Test temperature must be greater than use temperature.",
        )

    pre = (T_test_K / T_use_K) ** req.n
    af = pre * math.exp(req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K))

    result: dict = {
        "acceleration_factor": af,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
    }
    if req.life_test is not None:
        result["life_use_hours"] = af * req.life_test

    # AF vs test temperature curve (T_use + 10 ... 200 deg C)
    t_test_C = np.linspace(req.T_use + 10, 200, 100)
    t_test_K = t_test_C + 273.15
    af_arr = (t_test_K / T_use_K) ** req.n * np.exp(
        req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / t_test_K)
    )
    result["curve"] = {
        "T_test_C": t_test_C.tolist(),
        "af": af_arr.tolist(),
    }

    return result


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
    if req.RH_use <= 0 or req.RH_test <= 0:
        raise HTTPException(status_code=400, detail="Relative humidity values must be positive.")
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")

    factor_rh = (req.RH_test / req.RH_use) ** req.n
    factor_temp = math.exp(req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K))
    af = factor_rh * factor_temp

    result: dict = {
        "acceleration_factor": af,
        "factor_humidity": factor_rh,
        "factor_temperature": factor_temp,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
    }
    if req.life_test is not None:
        result["life_use_hours"] = af * req.life_test

    # AF vs use RH curve (20-90%) at the given use/test temperatures
    rh_arr = np.linspace(20, 90, 100)
    af_arr = (req.RH_test / rh_arr) ** req.n * factor_temp
    result["curve"] = {
        "RH_use": rh_arr.tolist(),
        "af": af_arr.tolist(),
    }

    return result


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
    if req.E_use <= 0 or req.E_test <= 0:
        raise HTTPException(status_code=400, detail="Electric fields must be positive.")
    T_use_K = req.T_use + 273.15
    T_test_K = req.T_test + 273.15
    if T_use_K <= 0 or T_test_K <= 0:
        raise HTTPException(status_code=400, detail="Temperatures must be above absolute zero.")

    model = req.model.strip()
    if model == "E":
        factor_field = math.exp(req.gamma * (req.E_test - req.E_use))
    elif model in ("1/E", "1E", "inv-E"):
        model = "1/E"
        factor_field = math.exp(req.gamma * (1.0 / req.E_use - 1.0 / req.E_test))
    else:
        raise HTTPException(status_code=400, detail="model must be 'E' or '1/E'.")

    factor_temp = math.exp(req.Ea / K_BOLTZMANN * (1.0 / T_use_K - 1.0 / T_test_K))
    af = factor_field * factor_temp

    result: dict = {
        "model": model,
        "acceleration_factor": af,
        "factor_field": factor_field,
        "factor_temperature": factor_temp,
        "T_use_K": T_use_K,
        "T_test_K": T_test_K,
    }
    if req.life_test is not None:
        result["life_use_hours"] = af * req.life_test

    # AF vs use field curve at the given temperatures
    e_arr = np.linspace(max(0.5, req.E_use * 0.5), req.E_test, 100)
    if model == "E":
        field_arr = np.exp(req.gamma * (req.E_test - e_arr))
    else:
        field_arr = np.exp(req.gamma * (1.0 / e_arr - 1.0 / req.E_test))
    af_arr = field_arr * factor_temp
    result["curve"] = {
        "E_use": e_arr.tolist(),
        "af": af_arr.tolist(),
    }

    return result
