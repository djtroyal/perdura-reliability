"""
Human Reliability Analysis (HRA) methods.

Quantitative human-error-probability (HEP) estimators and structured-worksheet
aggregators for the main first- and second-generation HRA techniques:

  - HEART   — Human Error Assessment and Reduction Technique
  - SPAR-H  — Standardized Plant Analysis Risk - Human
  - THERP   — Technique for Human Error Rate Prediction (+ dependency model)
  - CREAM   — Cognitive Reliability and Error Analysis Method (basic method)
  - SLIM    — Success Likelihood Index Method (SLIM-MAUD)
  - JHEDI   — Justification of Human Error Data Information (screening)
  - SHERPA  — Systematic Human Error Reduction and Prediction Approach (taxonomy)
  - ATHEANA — A Technique for Human Event Analysis (expert triangular estimate)
  - MERMOS  — scenario-based failure aggregation

Reference tables (generic task types, error-producing conditions, performance
shaping factors, common performance conditions) are encoded as module constants.
Values follow the standard published tables (Williams 1988 for HEART;
NUREG/CR-6883 for SPAR-H; NUREG/CR-1278 for THERP; Hollnagel 1998 for CREAM).
"""

import math


def _clamp01(x):
    return max(0.0, min(1.0, float(x)))


# =============================================================================
# HEART — Human Error Assessment and Reduction Technique
# =============================================================================

# Generic Task Types → nominal human unreliability.
HEART_GTT = {
    'A': (0.55, 'Totally unfamiliar, performed at speed with no idea of likely consequences'),
    'B': (0.26, 'Shift/restore system to new or original state on a single attempt without supervision or procedures'),
    'C': (0.16, 'Complex task requiring high level of comprehension and skill'),
    'D': (0.09, 'Fairly simple task performed rapidly or given scant attention'),
    'E': (0.02, 'Routine, highly practised, rapid task involving relatively low level of skill'),
    'F': (0.003, 'Restore/shift system to original or new state following procedures, with some checking'),
    'G': (0.0004, 'Completely familiar, well-designed, highly practised routine task, performed to highest standards'),
    'H': (0.00002, 'Respond correctly to system command even with an augmented/automated supervisory system'),
    'M': (0.03, 'Miscellaneous task for which no description can be found'),
}

# Error Producing Conditions → maximum affect multiplier (Williams).
HEART_EPC = {
    1: (17.0, 'Unfamiliarity with a potentially important but novel situation'),
    2: (11.0, 'Shortage of time available for error detection and correction'),
    3: (10.0, 'Low signal-to-noise ratio'),
    4: (9.0, 'A means of overriding/suppressing information or features that is too easily accessible'),
    5: (8.0, 'No means of conveying spatial and functional information in an easily assimilated form'),
    6: (8.0, "Mismatch between an operator's model of the world and that imagined by the designer"),
    7: (8.0, 'No obvious means of reversing an unintended action'),
    8: (6.0, 'Channel capacity overload from simultaneous presentation of non-redundant information'),
    9: (6.0, 'Need to unlearn a technique and apply one requiring an opposing philosophy'),
    10: (5.5, 'Need to transfer specific knowledge from task to task without loss'),
    11: (5.0, 'Ambiguity in the required performance standards'),
    12: (4.0, 'Mismatch between perceived and real risk'),
    13: (4.0, 'Poor, ambiguous or ill-matched system feedback'),
    14: (4.0, 'No clear, direct and timely confirmation of an intended action from the system'),
    15: (3.0, 'Operator inexperience (e.g. newly qualified but not an expert)'),
    16: (3.0, 'Impoverished quality of information conveyed by procedures and person-to-person interaction'),
    17: (3.0, 'Little or no independent checking or testing of output'),
    18: (2.5, 'A conflict between immediate and long-term objectives'),
    19: (2.5, 'No diversity of information input for veracity checks'),
    20: (2.0, 'Mismatch between the educational achievement of an individual and task requirements'),
    21: (2.0, 'An incentive to use other, more dangerous, procedures'),
    22: (1.8, 'Little opportunity to exercise mind and body outside the immediate confines of the job'),
    23: (1.6, 'Unreliable instrumentation (enough that it is noticed)'),
    24: (1.6, 'A need for absolute judgements beyond the capabilities or experience of an operator'),
    25: (1.6, 'Unclear allocation of function and responsibility'),
    26: (1.4, 'No obvious way to keep track of progress during an activity'),
    27: (1.4, 'A danger that finite physical capabilities will be exceeded'),
    28: (1.4, 'Little or no intrinsic meaning in a task'),
    29: (1.3, 'High-level emotional stress'),
    30: (1.2, 'Evidence of ill-health amongst operatives, especially fever'),
    31: (1.2, 'Low workforce morale'),
    32: (1.15, 'Inconsistency of meaning of displays and procedures'),
    33: (1.1, 'A poor or hostile environment'),
    34: (1.06, 'Prolonged inactivity or highly repetitious cycling of low mental workload'),
    35: (1.03, 'Disruption of normal work-sleep cycles'),
    36: (1.02, 'Task pacing caused by the intervention of others'),
    37: (1.01, 'Additional team members over and above those necessary'),
    38: (1.0, 'Age of personnel performing perceptual tasks'),
}


def heart(gtt, epcs):
    """HEART human error probability.

    Parameters
    ----------
    gtt : str
        Generic task type key (A-H, M).
    epcs : list of dict
        Each ``{'epc_id': int, 'proportion': float in [0,1]}`` — the assessed
        proportion of affect (APOA) for that error-producing condition.

    HEP = nominal · Π[((EPC_max - 1) · proportion) + 1], capped at 1.0.
    """
    gtt = str(gtt).upper()
    if gtt not in HEART_GTT:
        raise ValueError(f"Unknown HEART generic task type '{gtt}'. Use one of {sorted(HEART_GTT)}.")
    nominal = HEART_GTT[gtt][0]
    hep = nominal
    contributions = []
    for e in epcs or []:
        eid = int(e['epc_id'])
        prop = float(e.get('proportion', 0.0))
        if eid not in HEART_EPC:
            raise ValueError(f"Unknown HEART EPC id {eid}.")
        if not (0.0 <= prop <= 1.0):
            raise ValueError('EPC proportion of affect must be between 0 and 1.')
        max_affect = HEART_EPC[eid][0]
        factor = ((max_affect - 1.0) * prop) + 1.0
        hep *= factor
        contributions.append({'epc_id': eid, 'max_affect': max_affect,
                              'proportion': prop, 'factor': factor,
                              'label': HEART_EPC[eid][1]})
    return {
        'hep': _clamp01(hep),
        'nominal': nominal,
        'gtt': gtt,
        'contributions': contributions,
    }


# =============================================================================
# SPAR-H — Standardized Plant Analysis Risk - Human
# =============================================================================

SPARH_NOMINAL = {'diagnosis': 0.01, 'action': 0.001}

# PSF level -> multiplier. 'FAIL' means guaranteed failure (HEP = 1.0).
# Separate columns for diagnosis and action where the standard differs.
SPARH_PSF = {
    'available_time': {
        'diagnosis': {'inadequate': 'FAIL', 'barely_adequate': 10.0, 'nominal': 1.0, 'extra': 0.1, 'expansive': 0.01},
        'action': {'inadequate': 'FAIL', 'barely_adequate': 10.0, 'nominal': 1.0, 'extra': 0.1, 'expansive': 0.01},
    },
    'stress': {
        'diagnosis': {'extreme': 5.0, 'high': 2.0, 'nominal': 1.0},
        'action': {'extreme': 5.0, 'high': 2.0, 'nominal': 1.0},
    },
    'complexity': {
        'diagnosis': {'highly_complex': 5.0, 'moderately_complex': 2.0, 'nominal': 1.0, 'obvious': 0.1},
        'action': {'highly_complex': 5.0, 'moderately_complex': 2.0, 'nominal': 1.0},
    },
    'experience': {
        'diagnosis': {'low': 10.0, 'nominal': 1.0, 'high': 0.5},
        'action': {'low': 3.0, 'nominal': 1.0, 'high': 0.5},
    },
    'procedures': {
        'diagnosis': {'not_available': 50.0, 'incomplete': 20.0, 'available_poor': 5.0, 'nominal': 1.0, 'diagnostic': 0.5},
        'action': {'not_available': 50.0, 'incomplete': 20.0, 'available_poor': 5.0, 'nominal': 1.0},
    },
    'ergonomics': {
        'diagnosis': {'missing_misleading': 50.0, 'poor': 10.0, 'nominal': 1.0, 'good': 0.5},
        'action': {'missing_misleading': 50.0, 'poor': 10.0, 'nominal': 1.0, 'good': 0.5},
    },
    'fitness': {
        'diagnosis': {'unfit': 'FAIL', 'degraded': 5.0, 'nominal': 1.0},
        'action': {'unfit': 'FAIL', 'degraded': 5.0, 'nominal': 1.0},
    },
    'work_processes': {
        'diagnosis': {'poor': 2.0, 'nominal': 1.0, 'good': 0.8},
        'action': {'poor': 2.0, 'nominal': 1.0, 'good': 0.5},
    },
}


def spar_h(task_type, psfs):
    """SPAR-H human error probability.

    Parameters
    ----------
    task_type : str
        'diagnosis' (nominal 0.01) or 'action' (nominal 0.001).
    psfs : dict
        Maps each of the 8 PSF keys to a chosen level key (see SPARH_PSF).
        Missing PSFs default to 'nominal'.

    HEP = nominal · Π(multipliers). When 3 or more PSF multipliers exceed 1, the
    NUREG/CR-6883 adjustment is applied: HEP = (n·Π) / (n·(Π-1) + 1).
    """
    task_type = str(task_type).lower()
    if task_type not in SPARH_NOMINAL:
        raise ValueError("SPAR-H task_type must be 'diagnosis' or 'action'.")
    nominal = SPARH_NOMINAL[task_type]

    product = 1.0
    n_negative = 0
    applied = {}
    guaranteed_fail = False
    for psf_key, table in SPARH_PSF.items():
        level = (psfs or {}).get(psf_key, 'nominal')
        col = table[task_type]
        if level not in col:
            raise ValueError(f"Unknown level '{level}' for SPAR-H PSF '{psf_key}'.")
        mult = col[level]
        applied[psf_key] = {'level': level, 'multiplier': mult}
        if mult == 'FAIL':
            guaranteed_fail = True
            continue
        product *= mult
        if mult > 1.0:
            n_negative += 1

    if guaranteed_fail:
        return {'hep': 1.0, 'nominal': nominal, 'psf_product': None,
                'adjustment_applied': False, 'n_negative_psfs': n_negative,
                'applied': applied, 'guaranteed_failure': True}

    raw = nominal * product
    adjustment = n_negative >= 3
    if adjustment:
        hep = (nominal * product) / (nominal * (product - 1.0) + 1.0)
    else:
        hep = raw
    return {
        'hep': _clamp01(hep),
        'nominal': nominal,
        'psf_product': product,
        'raw_hep': _clamp01(raw),
        'adjustment_applied': adjustment,
        'n_negative_psfs': n_negative,
        'applied': applied,
        'guaranteed_failure': False,
    }


# =============================================================================
# THERP — nominal HEP with PSFs and the dependency model
# =============================================================================

THERP_STRESS = {'very_low': 2.0, 'optimal': 1.0, 'moderately_high': 2.0, 'extremely_high': 5.0}
THERP_EXPERIENCE = {'skilled': 1.0, 'novice': 2.0}
# Conditional HEP given dependency level, as a function of the basic HEP N.
THERP_DEPENDENCY = {
    'ZD': lambda n: n,
    'LD': lambda n: (1.0 + 19.0 * n) / 20.0,
    'MD': lambda n: (1.0 + 6.0 * n) / 7.0,
    'HD': lambda n: (1.0 + n) / 2.0,
    'CD': lambda n: 1.0,
}


def therp(nominal_hep, stress='optimal', experience='skilled',
          second_hep=None, dependency='ZD'):
    """THERP adjusted HEP plus the two-task dependency model.

    The single-task HEP is nominal · stress · experience (capped at 1). If a
    ``second_hep`` and ``dependency`` level are supplied, the conditional HEP of
    the second task given the first is computed with the standard dependency
    equations, and the joint HEP of the pair is HEP1 · conditional_HEP2.
    """
    nominal_hep = float(nominal_hep)
    if not (0.0 <= nominal_hep <= 1.0):
        raise ValueError('nominal_hep must be between 0 and 1.')
    if stress not in THERP_STRESS:
        raise ValueError(f"Unknown THERP stress level '{stress}'.")
    if experience not in THERP_EXPERIENCE:
        raise ValueError(f"Unknown THERP experience level '{experience}'.")
    adjusted = _clamp01(nominal_hep * THERP_STRESS[stress] * THERP_EXPERIENCE[experience])

    out = {
        'hep': adjusted,
        'adjusted_hep': adjusted,
        'nominal_hep': nominal_hep,
        'stress_multiplier': THERP_STRESS[stress],
        'experience_multiplier': THERP_EXPERIENCE[experience],
        'conditional_hep': None,
        'joint_hep': None,
        'dependency': None,
    }
    if second_hep is not None:
        dep = str(dependency).upper()
        if dep not in THERP_DEPENDENCY:
            raise ValueError("dependency must be one of ZD, LD, MD, HD, CD.")
        n2 = float(second_hep)
        if not (0.0 <= n2 <= 1.0):
            raise ValueError('second_hep must be between 0 and 1.')
        cond = _clamp01(THERP_DEPENDENCY[dep](n2))
        out['conditional_hep'] = cond
        out['joint_hep'] = _clamp01(adjusted * cond)
        out['dependency'] = dep
    return out


# =============================================================================
# CREAM — basic method (control mode from Common Performance Conditions)
# =============================================================================

# Each CPC level maps to an expected effect on performance reliability:
# 'improved', 'not_significant', or 'reduced'.
CREAM_CPC = {
    'organisation': {'very_efficient': 'improved', 'efficient': 'not_significant', 'inefficient': 'reduced', 'deficient': 'reduced'},
    'working_conditions': {'advantageous': 'improved', 'compatible': 'not_significant', 'incompatible': 'reduced'},
    'mmi_support': {'supportive': 'improved', 'adequate': 'not_significant', 'tolerable': 'not_significant', 'inappropriate': 'reduced'},
    'procedures': {'appropriate': 'improved', 'acceptable': 'not_significant', 'inappropriate': 'reduced'},
    'simultaneous_goals': {'fewer_than_capacity': 'not_significant', 'matching_capacity': 'not_significant', 'more_than_capacity': 'reduced'},
    'available_time': {'adequate': 'improved', 'temporarily_inadequate': 'not_significant', 'continuously_inadequate': 'reduced'},
    'time_of_day': {'day_adjusted': 'not_significant', 'night_unadjusted': 'reduced'},
    'training_experience': {'adequate_high_experience': 'improved', 'adequate_limited_experience': 'not_significant', 'inadequate': 'reduced'},
    'crew_collaboration': {'very_efficient': 'improved', 'efficient': 'not_significant', 'inefficient': 'not_significant', 'deficient': 'reduced'},
}

# Control mode -> (lower, upper) HEP interval (Hollnagel COCOM).
CREAM_CONTROL_MODES = {
    'strategic': (0.5e-5, 1.0e-2),
    'tactical': (1.0e-3, 1.0e-1),
    'opportunistic': (1.0e-2, 0.5),
    'scrambled': (1.0e-1, 1.0),
}


def _cream_control_mode(reduced, improved):
    """Classify the control mode from the counts of CPCs reducing/improving
    reliability. A transparent discretization of Hollnagel's control-mode chart:
    all-nominal (0,0) falls in Tactical (the normal control mode)."""
    if reduced <= 1 and improved >= 3:
        return 'strategic'
    if reduced <= 2:
        return 'tactical'
    if reduced <= 5:
        return 'opportunistic'
    return 'scrambled'


def cream(cpc_levels):
    """CREAM basic-method control mode and HEP interval.

    Parameters
    ----------
    cpc_levels : dict
        Maps each of the 9 CPC keys to a chosen level key (see CREAM_CPC).
        Missing CPCs are treated as 'not_significant'.
    """
    reduced = improved = 0
    effects = {}
    for cpc_key, table in CREAM_CPC.items():
        level = (cpc_levels or {}).get(cpc_key)
        if level is None:
            effect = 'not_significant'
        elif level in table:
            effect = table[level]
        else:
            raise ValueError(f"Unknown level '{level}' for CREAM CPC '{cpc_key}'.")
        effects[cpc_key] = effect
        if effect == 'reduced':
            reduced += 1
        elif effect == 'improved':
            improved += 1

    mode = _cream_control_mode(reduced, improved)
    lo, hi = CREAM_CONTROL_MODES[mode]
    point = math.sqrt(lo * hi)   # geometric mean of the interval
    return {
        'hep': point,
        'control_mode': mode,
        'hep_lower': lo,
        'hep_upper': hi,
        'sum_reduced': reduced,
        'sum_improved': improved,
        'effects': effects,
    }


# =============================================================================
# SLIM — Success Likelihood Index Method (SLIM-MAUD)
# =============================================================================

def slim(psfs, anchors=None, a=None, b=None):
    """SLIM-MAUD human error probability.

    SLI = Σ(normalized_weight · rating). HEP = 10^(a·SLI + b), where the
    calibration constants come either directly (``a``, ``b``) or from two anchor
    tasks with known SLI and HEP: ``anchors=[{'sli':.., 'hep':..}, {..}]``.
    """
    if not psfs:
        raise ValueError('Provide at least one PSF with a weight and rating.')
    total_w = 0.0
    sli = 0.0
    for p in psfs:
        w = float(p['weight'])
        r = float(p['rating'])
        if w < 0:
            raise ValueError('PSF weights must be non-negative.')
        total_w += w
        sli += w * r
    if total_w <= 0:
        raise ValueError('The sum of PSF weights must be positive.')
    sli /= total_w   # normalized success likelihood index

    if a is None or b is None:
        if not anchors or len(anchors) != 2:
            raise ValueError('Provide calibration a & b, or exactly two anchor tasks.')
        s1, h1 = float(anchors[0]['sli']), float(anchors[0]['hep'])
        s2, h2 = float(anchors[1]['sli']), float(anchors[1]['hep'])
        if s1 == s2:
            raise ValueError('The two calibration anchors must have different SLI values.')
        if not (0 < h1 < 1 and 0 < h2 < 1):
            raise ValueError('Anchor HEPs must be between 0 and 1 (exclusive).')
        a = (math.log10(h2) - math.log10(h1)) / (s2 - s1)
        b = math.log10(h1) - a * s1

    hep = 10.0 ** (a * sli + b)
    return {'hep': _clamp01(hep), 'sli': sli, 'a': a, 'b': b}


# =============================================================================
# JHEDI — screening estimate (HEART-derived)
# =============================================================================

JHEDI_BASE = {
    'simple': 0.001, 'routine': 0.01, 'complex': 0.1, 'unfamiliar': 0.3,
}


def jhedi(task_category, aggravating_factors=0, factor_multiplier=3.0):
    """JHEDI screening HEP: a base rate per task category multiplied by a factor
    for each aggravating condition present. A conservative screening estimate."""
    task_category = str(task_category).lower()
    if task_category not in JHEDI_BASE:
        raise ValueError(f"Unknown JHEDI task category '{task_category}'. Use one of {sorted(JHEDI_BASE)}.")
    n = int(aggravating_factors)
    if n < 0:
        raise ValueError('aggravating_factors must be >= 0.')
    base = JHEDI_BASE[task_category]
    hep = base * (float(factor_multiplier) ** n)
    return {'hep': _clamp01(hep), 'base': base, 'aggravating_factors': n}


# =============================================================================
# SHERPA — error-taxonomy worksheet aggregation
# =============================================================================

SHERPA_PROB = {'L': 0.001, 'M': 0.01, 'H': 0.1}


def sherpa(rows):
    """Aggregate a SHERPA worksheet.

    Each row: ``{'error_mode': str, 'probability': 'L'|'M'|'H', 'critical': bool}``.
    Maps L/M/H to 0.001/0.01/0.1. Returns the overall probability of at least one
    error (1 - Π(1-p)), the worst critical-item probability, and counts by error
    mode.
    """
    if not rows:
        raise ValueError('Provide at least one SHERPA error row.')
    prod_success = 1.0
    max_critical = 0.0
    by_mode = {}
    detailed = []
    for row in rows:
        pk = str(row.get('probability', 'M')).upper()
        if pk not in SHERPA_PROB:
            raise ValueError("SHERPA probability must be 'L', 'M' or 'H'.")
        p = SHERPA_PROB[pk]
        crit = bool(row.get('critical', False))
        mode = str(row.get('error_mode', 'unspecified'))
        prod_success *= (1.0 - p)
        if crit:
            max_critical = max(max_critical, p)
        by_mode[mode] = by_mode.get(mode, 0) + 1
        detailed.append({'error_mode': mode, 'probability': p, 'critical': crit})
    overall = 1.0 - prod_success
    return {
        'hep': _clamp01(overall),
        'overall_error_probability': _clamp01(overall),
        'max_critical_probability': max_critical,
        'counts_by_mode': by_mode,
        'rows': detailed,
    }


# =============================================================================
# ATHEANA — expert triangular estimate
# =============================================================================

def atheana(min_hep, mode_hep, max_hep):
    """ATHEANA elicited HEP as the mean of a triangular expert estimate
    (min + mode + max) / 3."""
    lo, md, hi = float(min_hep), float(mode_hep), float(max_hep)
    if not (0.0 <= lo <= md <= hi <= 1.0):
        raise ValueError('Require 0 <= min <= mode <= max <= 1.')
    mean = (lo + md + hi) / 3.0
    return {'hep': mean, 'min': lo, 'mode': md, 'max': hi}


# =============================================================================
# MERMOS — scenario-based failure aggregation
# =============================================================================

def mermos(scenarios):
    """Aggregate MERMOS failure scenarios: total failure probability = Σ p
    (bounded at 1), with the dominant scenario identified."""
    if not scenarios:
        raise ValueError('Provide at least one failure scenario.')
    total = 0.0
    dominant = None
    detailed = []
    for sc in scenarios:
        p = float(sc.get('probability', 0.0))
        if not (0.0 <= p <= 1.0):
            raise ValueError('Scenario probabilities must be between 0 and 1.')
        label = str(sc.get('label', 'scenario'))
        total += p
        detailed.append({'label': label, 'probability': p})
        if dominant is None or p > dominant['probability']:
            dominant = {'label': label, 'probability': p}
    return {
        'hep': _clamp01(total),
        'total_failure_probability': _clamp01(total),
        'dominant_scenario': dominant,
        'scenarios': detailed,
    }
