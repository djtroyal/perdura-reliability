"""Finite-horizon renewal and fleet calculations with numerical error bounds.

The renewal equation is solved on upper/lower lattice approximations: rounding
all lifetimes upward gives a lower event-count bound; rounding downward gives
an upper bound. Grids are refined until the requested count tolerance is met.
These are standard independent probability models, not legacy-tool emulation.
"""
from __future__ import annotations

import math
import numpy as np
from scipy.signal import fftconvolve


class RenewalConvergenceError(ValueError):
    """The requested deterministic discretization accuracy was not achieved."""


def _positive(value, label, *, zero=False):
    if isinstance(value, (bool, np.bool_)):
        raise ValueError(f'{label} must be numeric.')
    value = float(value)
    if not np.isfinite(value) or (value < 0 if zero else value <= 0):
        raise ValueError(f'{label} must be finite and {"non-negative" if zero else "positive"}.')
    return value


def _validate_distribution(distribution):
    if not callable(getattr(distribution, '_logsf', None)):
        raise ValueError('A lifetime distribution with stable log-survival is required.')
    support = getattr(getattr(distribution, '_scipy', None), 'support', None)
    if support is None:
        support = getattr(distribution, 'support', None)
    if not callable(support):
        raise ValueError('Renewal lifetimes must declare positive support.')
    lower, _ = support()
    if not np.isfinite(lower) or lower < 0:
        raise ValueError('Renewal lifetimes must have positive support and no mass at zero.')
    at_zero = float(np.asarray(distribution._cdf(np.array([0.])))[0])
    if not np.isfinite(at_zero) or at_zero != 0:
        raise ValueError('Renewal lifetimes must have positive support and no mass at zero.')


def conditional_log_survival(distribution, age, durations):
    """Log P(T > age+d | T > age), preserving deep-tail conditional values."""
    age = _positive(age, 'age', zero=True)
    durations = np.asarray(durations, dtype=float)
    if np.any(~np.isfinite(durations)) or np.any(durations < 0):
        raise ValueError('Durations must be finite and non-negative.')
    name = getattr(distribution, 'name', '')
    if name.startswith('Weibull_'):
        start = max(age - distribution.gamma, 0.)
        elapsed = np.maximum(durations - max(distribution.gamma - age, 0.), 0.)
        with np.errstate(divide='ignore', invalid='ignore', over='ignore', under='ignore'):
            if start == 0:
                log_loss = distribution.beta * (np.log(elapsed) - math.log(distribution.eta))
            else:
                growth = distribution.beta * np.log1p(elapsed / start)
                log_growth = np.where(growth > 50, growth + np.log(-np.expm1(-growth)),
                                      np.log(np.expm1(growth)))
                log_loss = distribution.beta * (math.log(start) - math.log(distribution.eta)) + log_growth
            return -np.exp(log_loss)
    if name.startswith('Exponential_'):
        return -distribution.Lambda * np.maximum(durations - max(distribution.gamma-age, 0.), 0.)
    end = age + durations
    if np.any((durations > 0) & (end == age)):
        raise ValueError('Additional exposure is below the numerical age resolution for this lifetime family.')
    base = float(distribution._logsf(np.array([age]))[0])
    if not np.isfinite(base):
        raise ValueError('The initial age is outside the distribution survival support.')
    log_survival = np.asarray(distribution._logsf(end), dtype=float) - base
    if np.any(np.isnan(log_survival)) or np.any(log_survival > 1e-10):
        raise ValueError('Conditional survival evaluation failed.')
    return np.minimum(log_survival, 0.)


def _renewal_measure(masses):
    """Coefficients of 1/(1-P(z)), using FFT Newton power-series inversion."""
    masses = np.asarray(masses, dtype=float)
    if masses[0] >= 0.9:
        raise RenewalConvergenceError('The grid is too coarse for the lifetime scale.')
    a = -masses.copy()
    a[0] += 1.
    inverse = np.array([1. / a[0]])
    while len(inverse) < len(a):
        size = min(2 * len(inverse), len(a))
        residual = -fftconvolve(a[:size], inverse)[:size]
        residual[0] += 2.
        inverse = fftconvolve(inverse, residual)[:size]
    tolerance = 1e-9 * max(1., float(np.max(inverse)))
    if np.any(~np.isfinite(inverse)) or np.min(inverse) < -tolerance:
        raise RenewalConvergenceError('Renewal convolution lost numerical precision.')
    return np.maximum(inverse, 0.)


def _lattice_count(distribution, age, horizon, cells):
    h = horizon / cells
    edges = np.arange(cells + 2, dtype=float) * h
    F = np.asarray(distribution._cdf(edges), dtype=float)
    if np.any(~np.isfinite(F)) or np.any(np.diff(F) < -1e-12):
        raise ValueError('Lifetime CDF is invalid on the renewal grid.')
    mass = np.maximum(np.diff(F), 0.)
    lower_mass = np.r_[0., mass[:cells]]
    upper_mass = mass[:cells + 1]
    lower_U = np.cumsum(_renewal_measure(lower_mass))
    upper_U = np.cumsum(_renewal_measure(upper_mass))
    G = -np.expm1(conditional_log_survival(distribution, age, edges))
    delayed_mass = np.maximum(np.diff(G), 0.)
    lower = fftconvolve(np.r_[0., delayed_mass[:cells]], lower_U)[:cells + 1]
    upper = fftconvolve(delayed_mass[:cells + 1], upper_U)[:cells + 1]
    # FFT roundoff is tiny relative to the discretization envelope. Extend the
    # envelope outward rather than reporting an inverted or negative bound.
    pad = 128 * np.finfo(float).eps * max(1., float(np.max(upper))) * (1 + math.log2(cells))
    lower = np.maximum.accumulate(np.maximum(lower - pad, 0.))
    upper = np.maximum.accumulate(np.maximum(upper + pad, lower))
    return lower, upper, h


def renewal_count(distribution, times, *, age=0., rtol=5e-4, atol=1e-5,
                  max_cells=262144):
    """Expected renewals for an item surviving to ``age`` at time zero.

    After its first failure the item receives an independent new lifetime.
    Returned lower/upper arrays bound the deterministic lattice discretization,
    not statistical uncertainty. A result is never returned with an unmet
    tolerance. Exponential renewal is evaluated analytically.
    """
    _validate_distribution(distribution)
    age = _positive(age, 'age', zero=True)
    rtol = _positive(rtol, 'rtol')
    atol = _positive(atol, 'atol')
    if rtol > .01 or atol > .01:
        raise ValueError('Renewal tolerances must not exceed 0.01.')
    if isinstance(max_cells, bool) or int(max_cells) != max_cells or not 128 <= max_cells <= 262144:
        raise ValueError('max_cells must be an integer from 128 to 262144.')
    times = np.asarray(times, dtype=float)
    if times.ndim != 1 or len(times) == 0 or np.any(~np.isfinite(times)) or np.any(times < 0):
        raise ValueError('times must be a non-empty vector of finite non-negative values.')
    conditional_log_survival(distribution, age, np.array([0.]))
    horizon = float(np.max(times))
    if horizon == 0:
        count = np.zeros_like(times)
        return {'expected': count, 'lower': count.copy(), 'upper': count.copy(),
                'cells': 0, 'step': 0., 'method': 'zero_horizon', 'converged': True}
    exponential_rate = None
    if getattr(distribution, 'name', '') == 'Exponential_1P':
        exponential_rate = distribution.Lambda
    elif getattr(distribution, 'name', '') == 'Weibull_2P' and distribution.beta == 1:
        exponential_rate = 1. / distribution.eta
    if exponential_rate is not None:
        count = times * exponential_rate
        return {'expected': count, 'lower': count.copy(), 'upper': count.copy(),
                'cells': 0, 'step': 0., 'method': 'analytic_exponential', 'converged': True}
    cells = 128
    while cells <= max_cells:
        try:
            lower_grid, upper_grid, step = _lattice_count(distribution, age, horizon, cells)
            coordinates = times / step
            # Snap only floating-point representations of exact grid points.
            nearest = np.rint(coordinates)
            coordinates = np.where(np.abs(coordinates-nearest) < 1e-10, nearest, coordinates)
            lo_index = np.clip(np.floor(coordinates).astype(int), 0, cells)
            hi_index = np.clip(np.ceil(coordinates).astype(int), 0, cells)
            lower, upper = lower_grid[lo_index], upper_grid[hi_index]
            lower = np.where(times == 0, 0., lower)
            upper = np.where(times == 0, 0., upper)
            if np.all(upper - lower <= 2 * (atol + rtol * np.maximum(upper, 1e-12))):
                return {'expected': (lower + upper) / 2, 'lower': lower, 'upper': upper,
                        'cells': cells, 'step': step,
                        'method': 'bounded_lattice_renewal', 'converged': True}
        except RenewalConvergenceError:
            pass
        cells *= 2
    raise RenewalConvergenceError(
        'Renewal count did not meet the requested discretization tolerance; '
        'shorten the horizon, request a less stringent explicit tolerance, '
        'or increase max_cells if below the 262144-cell limit.')


def fleet_forecast(distribution, cohorts, horizon, *, model='first_failure',
                   cost_per_event=0., n_points=101, rtol=5e-4, atol=1e-5):
    """Expected fleet events/costs for declared ages, entries and retirements.

    Cohort ages are ages at entry. Every item is known to be surviving at that
    age; exit removes it from future exposure, not from past event totals.
    First-failure units leave risk after failure. Renewal/minimal-repair units
    return immediately with zero repair downtime. Cohorts share one model.
    """
    _validate_distribution(distribution)
    horizon = _positive(horizon, 'horizon')
    cost = _positive(cost_per_event, 'cost_per_event', zero=True)
    if model not in {'first_failure', 'perfect_renewal', 'minimal_repair'}:
        raise ValueError('Unknown fleet repair model.')
    if isinstance(n_points, bool) or int(n_points) != n_points or not 2 <= n_points <= 1001:
        raise ValueError('n_points must be an integer from 2 to 1001.')
    if not cohorts or len(cohorts) > 200:
        raise ValueError('Supply 1 to 200 fleet cohorts.')
    clean = []
    ids = set()
    for i, item in enumerate(cohorts):
        item = dict(item)
        key = str(item.get('id', i + 1)).strip()
        if not key or key in ids:
            raise ValueError('Cohort identifiers must be nonempty and unique.')
        ids.add(key)
        raw_count = item.get('count', 0)
        count = _positive(raw_count, 'cohort count')
        if int(count) != count or count > 1e9:
            raise ValueError('Cohort count must be a positive integer no greater than 1e9.')
        age = _positive(item.get('age', 0), 'cohort age', zero=True)
        entry = _positive(item.get('entry_time', 0), 'entry_time', zero=True)
        exit_time = item.get('exit_time')
        exit_time = horizon if exit_time is None else _positive(exit_time, 'exit_time')
        if exit_time <= entry or entry > horizon:
            raise ValueError('Cohort entry must be within the horizon and precede exit.')
        clean.append((key, int(count), age, entry, min(exit_time, horizon)))
    time = np.unique(np.r_[np.linspace(0., horizon, int(n_points)),
                            [x for _, _, _, entry, end in clean for x in (entry, end)]])
    expected = np.zeros_like(time)
    lower = np.zeros_like(time)
    upper = np.zeros_like(time)
    log_no_events = np.zeros_like(time)
    active = np.zeros_like(time)
    summaries = []
    for key, count, age, entry, end in clean:
        duration = np.maximum(0., np.minimum(time, end) - entry)
        log_R = conditional_log_survival(distribution, age, duration)
        log_no_events += count * log_R
        active += count * ((time >= entry) & (time < end))
        if model == 'perfect_renewal':
            result = renewal_count(distribution, duration, age=age, rtol=rtol, atol=atol)
            values, low, high = result['expected'], result['lower'], result['upper']
            numerical = {k: result[k] for k in ('method', 'cells', 'step', 'converged')}
        else:
            values = -np.expm1(log_R) if model == 'first_failure' else -log_R
            low, high = values.copy(), values.copy()
            numerical = {'method': 'analytic_conditional_survival', 'converged': True, 'cells': 0, 'step': 0.}
        if np.any(~np.isfinite(values)):
            raise ValueError('Expected event counts exceed the representable model support.')
        with np.errstate(over='ignore', invalid='ignore'):
            expected += count * values
            lower += count * low
            upper += count * high
            monetary_upper = cost * upper
        if np.any(~np.isfinite(upper)) or np.any(~np.isfinite(monetary_upper)):
            raise ValueError('Fleet event counts or costs exceed floating-point range; rescale the cost basis or shorten the horizon.')
        summaries.append({'id': key, 'count': count, 'age': age, 'entry_time': entry,
                          'exit_time': end, 'expected_events': float(count * values[-1]),
                          'expected_cost': float(cost * count * values[-1]),
                          'numerical': numerical})
    return {'model': model, 'time': time.tolist(), 'expected_events': expected.tolist(),
            'expected_events_lower': lower.tolist(), 'expected_events_upper': upper.tolist(),
            'expected_cost': (cost * expected).tolist(),
            'expected_cost_lower': (cost * lower).tolist(),
            'expected_cost_upper': (cost * upper).tolist(),
            'period_events': np.r_[0., np.diff(expected)].tolist(),
            'probability_no_events': np.exp(log_no_events).tolist(),
            'log_probability_no_events': [float(v) if np.isfinite(v) else None for v in log_no_events],
            'active_scheduled_units': active.astype(int).tolist(), 'cohorts': summaries,
            'total_expected_events': float(expected[-1]), 'total_expected_cost': float(cost * expected[-1]),
            'numerical': {'bounds': 'deterministic_discretization_not_confidence',
                          'relative_tolerance': rtol, 'absolute_tolerance_per_item': atol,
                          'maximum_count_half_width': float(np.max((upper-lower)/2)),
                          'converged': True},
            'assumptions': ['Independent units sharing the selected positive lifetime distribution.',
                            'Cohort age is age at entry, conditional on survival to that age.',
                            'Retirement is scheduled independently of failures; no repair downtime.',
                            'Perfect renewal resets age after every event; minimal repair retains age.']}


def perfect_block_replacement(distribution, cost_PM, cost_CM, *, t_max=None, n_points=401):
    """Numerically bounded perfect-renewal periodic replacement cost curve."""
    _validate_distribution(distribution)
    pm, cm = _positive(cost_PM, 'cost_PM'), _positive(cost_CM, 'cost_CM')
    mean = float(distribution.mean)
    if not np.isfinite(mean) or mean <= 0:
        raise ValueError('Block-policy comparison requires a finite positive mean life.')
    maximum = _positive(t_max, 't_max') if t_max is not None else 5 * mean
    known_decreasing_hazard = (getattr(distribution, 'name', '') == 'Exponential_1P'
                              or (getattr(distribution, 'name', '') == 'Weibull_2P'
                                  and distribution.beta <= 1.))
    if known_decreasing_hazard:
        # For these DFR/constant-hazard lifetime families m(t)/t >= 1/E[T].
        # Positive scheduled replacement cost cannot beat corrective renewal.
        return {'optimal_replacement_time': None, 'min_cost': cm / mean,
                'time': [], 'cost': [], 'finite_optimum': False,
                'boundary_minimum': False, 'search_expanded': False,
                'decision': 'run_to_failure',
                'decision_reason': 'Constant or decreasing Weibull hazard gives no benefit from scheduled replacement.',
                'expected_cm_per_block': None,
                'numerical': {'method': 'decreasing_hazard_no_pm', 'cells': 0,
                              'interval_grid_step': None, 'cost_lower': [], 'cost_upper': []}}
    # Candidate intervals are in units of mean life, so unit conversion cannot
    # change the optimum. Boundary minima are never declared finite optima.
    expanded = False
    for _ in range(4):
        times = np.linspace(maximum / n_points, maximum, n_points)
        result = renewal_count(distribution, times)
        costs = (pm + cm * result['expected']) / times
        low_cost = (pm + cm * result['lower']) / times
        high_cost = (pm + cm * result['upper']) / times
        index = int(np.argmin(costs))
        if index < len(times) - 1 or t_max is not None:
            break
        maximum *= 2
        expanded = True
    if 0 < index < len(times)-1:
        times = np.unique(np.r_[times, np.linspace(times[index-1], times[index+1], 81)])
        result = renewal_count(distribution, times)
        costs = (pm + cm * result['expected']) / times
        low_cost = (pm + cm * result['lower']) / times
        high_cost = (pm + cm * result['upper']) / times
        index = int(np.argmin(costs))
    baseline = cm / mean
    finite = bool(0 < index < len(times)-1 and high_cost[index] < baseline)
    return {'optimal_replacement_time': float(times[index]) if finite else None,
            'min_cost': float(costs[index]) if finite else baseline,
            'candidate_cost_lower': float(low_cost[index]),
            'candidate_cost_upper': float(high_cost[index]),
            'time': times.tolist(), 'cost': costs.tolist(),
            'finite_optimum': finite, 'boundary_minimum': index in (0,len(times)-1),
            'search_expanded': expanded,
            'decision': 'preventive_replacement' if finite else 'withheld',
            'decision_reason': ('Interior numerical minimum beats the corrective-renewal baseline.' if finite else
                                'Block-policy recommendation withheld: no interior interval is demonstrated cheaper than corrective renewal in the evaluated range.'),
            'expected_cm_per_block': float(result['expected'][index]) if finite else None,
            'numerical': {'method': result['method'], 'cells': result['cells'],
                          'interval_grid_step': float(max(times[index]-times[max(0,index-1)], times[min(len(times)-1,index+1)]-times[index])),
                          'cost_lower': low_cost.tolist(), 'cost_upper': high_cost.tolist()}}


def perfect_block_cost_forecast(distribution, cost_PM, cost_CM, horizon, *, interval=None, n_points=201):
    """Finite-horizon block replacement, renewing after each failure and PM."""
    _validate_distribution(distribution)
    pm, cm = _positive(cost_PM, 'cost_PM'), _positive(cost_CM, 'cost_CM')
    horizon = _positive(horizon, 'horizon')
    if interval is None:
        policy = perfect_block_replacement(distribution, pm, cm)
        if policy['decision'] == 'withheld':
            raise ValueError('Automatic block interval is unresolved. Supply an explicit interval or use the fleet forecast for corrective renewal.')
        interval = policy['optimal_replacement_time']
    if interval is None:
        time = np.linspace(0., horizon, n_points)
        renewal = renewal_count(distribution, time)
        scheduled = np.zeros_like(time)
        expected_cm, lower, upper = renewal['expected'], renewal['lower'], renewal['upper']
    else:
        interval = _positive(interval, 'interval')
        horizon_ratio = horizon / interval
        if abs(horizon_ratio - round(horizon_ratio)) < 1e-10:
            horizon_ratio = round(horizon_ratio)
        scheduled_count = int(math.floor(horizon_ratio))
        if scheduled_count > 10000:
            raise ValueError('Too many scheduled replacements; use a shorter horizon.')
        schedules = np.minimum(np.arange(1, scheduled_count+1, dtype=float) * interval, horizon)
        time = np.unique(np.r_[np.linspace(0., horizon, n_points), schedules])
        ratios = time / interval
        ratios = np.where(np.abs(ratios-np.rint(ratios)) < 1e-10, np.rint(ratios), ratios)
        scheduled = np.floor(ratios)
        remainder = np.maximum(time - scheduled * interval, 0.)
        renewal = renewal_count(distribution, np.r_[interval, remainder])
        expected_cm = scheduled * renewal['expected'][0] + renewal['expected'][1:]
        lower = scheduled * renewal['lower'][0] + renewal['lower'][1:]
        upper = scheduled * renewal['upper'][0] + renewal['upper'][1:]
    cost = pm * scheduled + cm * expected_cm
    return {'policy': 'block', 'block_repair_model': 'perfect', 'interval': interval,
            'expected_pm': float(scheduled[-1]), 'expected_cm': float(expected_cm[-1]),
            'expected_cm_lower': float(lower[-1]), 'expected_cm_upper': float(upper[-1]),
            'total_cost': float(cost[-1]), 'cost_rate': float(cost[-1]/horizon),
            'mttf': float(distribution.mean), 'time': time.tolist(),
            'cumulative_cost': cost.tolist(),
            'cumulative_cost_lower': (pm*scheduled+cm*lower).tolist(),
            'cumulative_cost_upper': (pm*scheduled+cm*upper).tolist(),
            'analysis_basis': 'finite_horizon_perfect_renewal_block_replacement',
            'finite_horizon_transients_modeled': True,
            'assumption_note': 'Failures and scheduled replacements restore the item to new condition; repairs take zero time.',
            'numerical': {'method': renewal['method'], 'cells': renewal['cells'],
                          'bounds': 'deterministic_discretization_not_confidence', 'converged': True}}
