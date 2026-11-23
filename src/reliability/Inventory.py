"""End-of-life procurement with explicit condemnation and replenishment models.

Constant-rate independent repair outcomes use Poisson thinning. The event model
retains calendar exposure and simulates Weibull renewal, return pipelines and
independent exponential deterioration of serviceable depot stock. No demand is
silently truncated. Service probability is distinct from estimation confidence.
"""
from __future__ import annotations

import heapq
import math
import numpy as np
from scipy.stats import binom, poisson
from reliability._demand import NegativeBinomialDemand

_MAX_INITIAL_STOCK = 100_000


def _fifo_stock_protects(initial_expiries, events):
    """Serve one fixed event path without observing future deterioration.

    Initial tokens retain prefix IDs across stock choices. Return IDs depend
    only on the fixed event sequence and start above every permitted initial
    ID. The expiry heap only removes items already dead at the current time;
    issues take the earliest FIFO ID among live tokens.

    A larger initial prefix keeps a superset of the smaller scenario's live
    tokens: expirations/returns preserve inclusion, and removing each set's
    minimum preserves it too. Thus shortage-free service is pathwise monotone
    in initial stock and binary inversion remains valid.
    """
    if len(initial_expiries) > _MAX_INITIAL_STOCK:
        raise ValueError('Storage-loss simulation exceeds the initial-stock limit.')
    expiry_heap = [(expiry, token) for token, expiry in enumerate(initial_expiries)]
    heapq.heapify(expiry_heap)
    fifo_heap = list(range(len(initial_expiries)))
    active = set(fifo_heap)
    for event_index, (time, kind, expiry) in enumerate(events):
        while expiry_heap and expiry_heap[0][0] <= time:
            _, token = heapq.heappop(expiry_heap)
            active.discard(token)
        if kind == 0:
            token = _MAX_INITIAL_STOCK + event_index
            if expiry > time:
                active.add(token)
                heapq.heappush(expiry_heap, (expiry, token))
                heapq.heappush(fifo_heap, token)
        else:
            while fifo_heap and fifo_heap[0] not in active:
                heapq.heappop(fifo_heap)
            if not fifo_heap:
                return False
            active.remove(heapq.heappop(fifo_heap))
    return True


def _finite_number(value, label, *, minimum=0., maximum=None, strict_minimum=False):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f'{label} must be a finite number.') from exc
    if (isinstance(value, (bool, np.bool_)) or not math.isfinite(number)
            or (number <= minimum if strict_minimum else number < minimum)
            or (maximum is not None and number > maximum)):
        raise ValueError(f'{label} is outside its valid finite range.')
    return number


def _integer(value, label, *, minimum=0, maximum=None):
    if isinstance(value, (int, np.integer)) and not isinstance(value, (bool, np.bool_)):
        if value < minimum or (maximum is not None and value > maximum):
            raise ValueError(f'{label} is outside its valid range.')
        return int(value)
    number = _finite_number(value, label, minimum=minimum, maximum=maximum)
    if number != int(number):
        raise ValueError(f'{label} must be an integer.')
    return int(number)


def _validated_inputs(item, horizon, service, trials, seed):
    """Keep direct Python calls subject to the same physical input constraints."""
    if not isinstance(item, dict):
        raise ValueError('Inventory item must be a dictionary.')
    item = dict(item)
    item['quantity'] = _integer(item.get('quantity'), 'Installed quantity', minimum=1)
    item['initial_stock'] = _integer(item.get('initial_stock', 0), 'Initial stock')
    item['failure_rate'] = _finite_number(item.get('failure_rate', 0), 'Failure rate')
    item['duty_cycle'] = _finite_number(item.get('duty_cycle', 1), 'Operating duty', maximum=1)
    item['repair_probability'] = _finite_number(item.get('repair_probability', 0), 'Repair probability', maximum=1)
    item['storage_failure_rate'] = _finite_number(item.get('storage_failure_rate', 0), 'Storage failure rate')
    item['lead_mean'] = _finite_number(item.get('lead_mean', 0), 'Return mean')
    item['lead_sd'] = _finite_number(item.get('lead_sd', 0), 'Return standard deviation')
    if item['lead_mean'] == 0 and item['lead_sd'] > 0:
        raise ValueError('A zero mean return time requires zero standard deviation.')
    if not isinstance(item.get('include_pipeline', False), (bool, np.bool_)):
        raise ValueError('Include pipeline must be a boolean.')
    item['model'] = item.get('model', 'poisson')
    if item['model'] not in ('poisson', 'negative_binomial', 'weibull'):
        raise ValueError('Demand model must be poisson, negative_binomial or weibull.')
    item['dispersion'] = _finite_number(item.get('dispersion', 10), 'Dispersion', strict_minimum=True)
    if item['model'] == 'weibull':
        item['weibull_alpha'] = _finite_number(item.get('weibull_alpha'), 'Weibull scale', strict_minimum=True)
        item['weibull_beta'] = _finite_number(item.get('weibull_beta'), 'Weibull shape', strict_minimum=True)
    cohorts = item.get('cohorts', [])
    if not isinstance(cohorts, (list, tuple)) or len(cohorts) > 1000:
        raise ValueError('Supply at most 1,000 inventory cohorts.')
    checked = []
    for cohort in cohorts:
        if not isinstance(cohort, dict):
            raise ValueError('Each cohort must be a dictionary.')
        count = _integer(cohort.get('count'), 'Cohort count', minimum=1)
        age = _finite_number(cohort.get('age', 0), 'Cohort age')
        entry = _finite_number(cohort.get('entry', 0), 'Cohort entry')
        end = cohort.get('exit')
        if end is not None:
            end = _finite_number(end, 'Cohort retirement', minimum=entry)
        checked.append({'count': count, 'age': age, 'entry': entry, 'exit': end})
    if checked and sum(c['count'] for c in checked) != item['quantity']:
        raise ValueError('Cohort counts must sum to the installed quantity.')
    item['cohorts'] = checked
    horizon = _finite_number(horizon, 'Horizon', strict_minimum=True)
    service = _finite_number(service, 'Service probability', maximum=1, strict_minimum=True)
    if service == 1:
        raise ValueError('Service probability must be strictly below one.')
    trials = _integer(trials, 'Simulation trials', minimum=2, maximum=10000)
    seed = _integer(seed, 'Seed')
    return item, horizon, service, trials, seed


def _quantile_interval(ordered, probability):
    n = len(ordered)
    lo = int(binom.ppf(.025, n, probability))
    hi = int(binom.ppf(.975, n, probability)) + 1
    return {"lower": int(ordered[lo - 1]) if lo else 0,
            "upper": int(ordered[hi - 1]) if hi <= n else None,
            "method": "distribution_free_order_statistics", "confidence": .95}


def lifetime_inventory(item: dict, horizon: float, service: float, *, trials=2000, seed=42):
    """Return stock/purchase requirements for one pooled PN in calendar units.

    Known-rate analytic cases are exact. Simulation intervals describe numerical
    sampling uncertainty, not uncertainty in supplied reliability/repair inputs.
    Cohort counts include installed hierarchy multiplicity. Operating duty scales
    exposure; a first Weibull failure conditions on the attained operating age.
    """
    item, horizon, service, trials, seed = _validated_inputs(item, horizon, service, trials, seed)
    rate = float(item.get("failure_rate", 0))
    duty = float(item.get("duty_cycle", 1))
    repair = float(item.get("repair_probability", 0))
    model = item.get("model", "poisson")
    cohorts = item.get("cohorts") or [{"count": item["quantity"], "age": 0, "entry": 0, "exit": None}]
    initial = int(item.get("initial_stock", 0))
    pipeline = bool(item.get("include_pipeline", False))
    storage_rate = float(item.get("storage_failure_rate", 0))
    exposure = sum(c["count"] * max(0., min(horizon, c.get("exit") if c.get("exit") is not None else horizon) - c.get("entry", 0)) for c in cohorts) * duty
    mu = rate * exposure * (1 - repair)
    if not math.isfinite(mu) or not math.isfinite(exposure):
        raise ValueError("Exposure exceeds the supported numerical range.")
    if model in ("poisson", "negative_binomial") and not pipeline and storage_rate == 0:
        if mu > 2**53-1:
            raise ValueError('Required stock exceeds exact integer precision.')
        if model == "poisson":
            dist = poisson(mu)
        else:
            size = float(item.get("dispersion", 10))
            dist = NegativeBinomialDemand(mu, size)
        quantile = dist.ppf(service)
        if not math.isfinite(quantile) or not 0 <= quantile <= 2**53-1:
            raise ValueError('Required stock is unresolved or exceeds exact integer precision.')
        required = int(quantile)
        protection = float(dist.cdf(required))
        return {"method": "poisson_thinning" if model == "poisson" else "negative_binomial_thinning",
                "required_stock": required, "purchase_quantity": max(0, required - initial),
                "expected_condemnations": mu, "achieved_protection": float(dist.cdf(max(initial, required))),
                "sizing_protection": protection, "protection_interval": None, "stock_interval": None,
                "exposure": exposure, "simulation_trials": 0,
                "assumptions": ["Independent repair outcomes with the specified probability.",
                                "Repair-pipeline shortages and storage losses are excluded."]}
    if model == "negative_binomial":
        raise ValueError("Negative-binomial period demand does not define event times. Choose Poisson or Weibull for pipeline/storage simulation.")
    eta = item.get("weibull_alpha")
    beta = item.get("weibull_beta")
    if model == "weibull" and (eta is None or beta is None or eta <= 0 or beta <= 0):
        raise ValueError("Positive Weibull scale and shape are required.")
    if model == 'weibull' and duty > 0:
        active_units = sum(c['count'] for c in cohorts
                           if min(horizon, c.get('exit') if c.get('exit') is not None else horizon) > c.get('entry', 0))
        if active_units * trials > 5_000_000:
            raise ValueError('Weibull simulation exceeds five million unit/trial paths; reduce quantity or trials.')
    lead_mean = float(item.get("lead_mean", 0)); lead_sd = float(item.get("lead_sd", 0))
    if lead_mean == 0 and lead_sd > 0:
        raise ValueError("A zero mean return time requires zero standard deviation.")
    # Log-space coefficient of variation avoids overflow for large SD/mean.
    lead_sigma = math.sqrt(float(np.logaddexp(0., 2*(math.log(lead_sd)-math.log(lead_mean))))) if lead_mean and lead_sd else 0
    lead_mu = math.log(lead_mean) - lead_sigma ** 2 / 2 if lead_mean else 0
    root = np.random.SeedSequence(seed)
    required_samples = []; condemned_samples = []
    total_events = 0
    for trial_seed in root.spawn(trials):
        demand_seed, repair_seed, lead_seed, shelf_seed = trial_seed.spawn(4)
        rng = np.random.default_rng(demand_seed)
        repair_rng = np.random.default_rng(repair_seed)
        lead_rng = np.random.default_rng(lead_seed)
        initial_shelf_seed, return_shelf_seed = shelf_seed.spawn(2)
        return_shelf_rng = np.random.default_rng(return_shelf_seed)
        failures = []
        for cohort in cohorts:
            start = max(0., float(cohort.get("entry", 0)))
            end = min(horizon, cohort.get("exit") if cohort.get("exit") is not None else horizon)
            if end <= start or duty == 0:
                continue
            count = int(cohort["count"])
            if model == "poisson":
                mean = count * rate * (end - start) * duty
                if mean > 100_000:
                    raise ValueError("The event model exceeds 100,000 expected events per cohort/trial; use analytic sizing or shorter horizons.")
                n = int(rng.poisson(mean))
                if len(failures) + n > 100_000:
                    raise ValueError('Event limit exceeded; no partial demand estimate is returned.')
                failures.extend(rng.uniform(start, end, n).tolist())
            else:
                age = float(cohort.get("age", 0))
                for _ in range(count):
                    e = float(rng.exponential())
                    # log1p avoids cancellation for small additional life at large age.
                    try:
                        if age > 0:
                            z = (age / eta) ** beta
                            gap = age * math.expm1(math.log1p(e / z) / beta) if z else eta * e ** (1 / beta)
                        else:
                            gap = eta * e ** (1 / beta)
                    except OverflowError as exc:
                        raise ValueError('Weibull conditional lifetime exceeds numerical range; rescale exposure or revise the shape.') from exc
                    time = start + gap / duty
                    if not math.isfinite(time) and not math.isinf(time):
                        raise ValueError('Weibull event time could not be resolved numerically.')
                    if time <= start:
                        raise ValueError('Weibull additional life is below calendar-time resolution; rescale exposure units.')
                    while time <= end:
                        failures.append(time)
                        if len(failures) > 100_000:
                            raise ValueError("Event limit exceeded; no partial demand estimate is returned.")
                        next_time = time + eta * float(rng.weibull(beta)) / duty
                        if math.isnan(next_time) or next_time <= time:
                            raise ValueError('Weibull renewal did not advance calendar time; rescale exposure units.')
                        time = next_time
        total_events += len(failures)
        if total_events > 5_000_000:
            raise ValueError("Total event limit exceeded; reduce trials/horizon or use analytic sizing.")
        events = []; condemned = 0
        for time in failures:
            restored = repair_rng.random() < repair
            if not restored:
                condemned += 1
            if not pipeline and restored:
                continue
            events.append((time, 1, None))
            if restored:
                lead = float(lead_rng.lognormal(lead_mu, lead_sigma)) if lead_sd else lead_mean
                return_time = time + lead
                if return_time <= horizon:
                    expiry = return_time + float(return_shelf_rng.exponential(1 / storage_rate)) if storage_rate else math.inf
                    events.append((return_time, 0, expiry))
        events.sort(key=lambda e: (e[0], e[1]))  # returns before demands at an exact tie
        outstanding = peak = 0
        for _, kind, _ in events:
            outstanding += 1 if kind else -1
            peak = max(peak, outstanding)
        if storage_rate and events:
            lifetimes = []
            shelf_rng = np.random.default_rng(initial_shelf_seed)
            def protects(stock):
                if stock > _MAX_INITIAL_STOCK:
                    raise ValueError("Storage losses require more than 100,000 initial spares in a trial; revise the stocking policy.")
                if stock > len(lifetimes):
                    lifetimes.extend(shelf_rng.exponential(1 / storage_rate, stock - len(lifetimes)).tolist())
                return _fifo_stock_protects(lifetimes[:stock], events)
            low, high = 0, max(1, peak)
            while not protects(high):
                if high == _MAX_INITIAL_STOCK:
                    raise ValueError('Storage losses exceed the 100,000 initial-spares limit in a trial; revise the stocking policy.')
                low, high = high, min(_MAX_INITIAL_STOCK,high * 2)
            while high - low > 1:
                mid = (low + high) // 2
                if protects(mid): high = mid
                else: low = mid
            peak = 0 if protects(0) else high
        required_samples.append(peak); condemned_samples.append(condemned)
    ordered = np.sort(required_samples)
    required = int(ordered[max(0, math.ceil(service * trials) - 1)])
    actual_stock = max(initial, required)
    achieved = float(np.mean(ordered <= actual_stock))
    # Simultaneous empirical-CDF coverage remains valid after selecting stock
    # from these trials. Pointwise intervals need not survive that selection.
    half = math.sqrt(math.log(2/.05)/(2*trials))
    return {"method": "renewal_inventory_simulation", "required_stock": required,
            "purchase_quantity": max(0, required-initial), "expected_condemnations": float(np.mean(condemned_samples)),
            "achieved_protection": achieved, "protection_interval": {"lower": max(0., achieved-half), "upper": min(1., achieved+half), "confidence": .95, "method": "dkw_uniform_monte_carlo"},
            "stock_interval": _quantile_interval(ordered, service), "exposure": exposure,
            "simulation_trials": trials, "seed": seed,
            "assumptions": ["Independent unit renewal, repair outcomes, return times and depot deterioration.",
                            "Depot deterioration is exponential in calendar time; live stock is issued FIFO without knowing future deterioration times.",
                            "Retirement stops installed-unit demand; salvage is not credited.",
                            "Intervals describe Monte Carlo uncertainty, conditional on supplied model parameters."]}
