# Inventory and RAM methods

This implements the inventory and RAM recommendations in the
[toolkit comparison](../audit/reliability-toolkit-comparison-2026-11-21.html).
Calculations use public probability models; toolkit outputs are comparison
examples, not implementation dependencies.

## Availability and maintainability

Operational availability uses a matched maintenance population:

- All maintenance: `Ao = MTBM / (MTBM + M + administrative + logistics)`.
- Corrective maintenance only: `Ao = MTBF / (MTBF + MTTR + administrative + logistics)`.

Supplying either MTBM or mean active maintenance selects the all-maintenance
basis and requires both. An incomplete pair does not fall back to corrective
repair time. Delays must refer to that same event population and must not overlap.
Thus MTBM=100, M=10 and zero delays gives both Aa and Ao equal to 100/110,
regardless of a different corrective-only MTTR.

Lognormal repair fitting uses log durations. The default is weighted maximum
likelihood, with variance divisor `sum(frequency)`; the named handbook
sample-log-SD option uses `sum(frequency)-1`. Frequency rows are equivalent to
repeated observations without expanding them in memory. Every observation must
be finite and positive, and every frequency a positive integer. Empty separators
are ignored; invalid tokens are reported, never silently discarded. The MTTR-only
model is an explicit exponential approximation. Completion `M(t)` and exceedance
`1-M(t)` views share the same fitted model. A duration percentile is not a
confidence bound on that percentile.

## Period provisioning

Poisson and negative-binomial sizing retains the exact inverse CDF. A separate,
bounded stock grid controls plotting work and does not change the answer. The
required stock and the stock immediately below it are retained when they lie
inside the requested display range. Service probability is evaluated directly at
the selected integer stock, including already-owned inventory.

## BOM and lifetime procurement

Prediction import uses the canonical installed hierarchy, including multiplicity
of all ancestors. Rates are calendar-equivalent failures per million hours from
the selected scenario; their operating duty is already included. Imported duty
therefore starts at one. Source identity, system fingerprint and prediction input
state accompany the snapshot. A changed source requires a refresh or explicit
detachment to manual inputs.

Rows pool by part number. Duplicate part numbers must agree on model, repair,
stock and cost assumptions. Existing stock is one depot pool, not an installed
quantity to be summed for every occurrence. Distinct assumptions require distinct
inventory classes. A missing part number uses the installed instance identity.

For cohorts with count `N_j`, entry `e_j`, retirement `r_j`, horizon `H`, and duty
`d`, operating exposure is
`E = d * sum(N_j * max(0, min(H,r_j)-e_j))`.
For constant failure rate lambda and independent successful repair probability p,
permanent replacements follow `Poisson(lambda * E * (1-p))`. Negative-binomial
thinning preserves its size parameter and scales its mean by `1-p`. Required
stock is the smallest integer whose CDF reaches the service target; purchases
subtract existing depot stock, with a floor at zero.

Example: 100 units, 1/50,000 failures/hour, 43,800 hours, p=0.8 gives 17.52 expected
condemnations and 25 spares for 95% protection. Three existing spares leave 22
purchases. Multiplying a failure-count quantile by `1-p` is not used.

The optional event model adds Weibull renewal, return pipelines and depot losses.
The first Weibull lifetime conditions on current operating age; replacements are
as good as new. Calendar duty converts remaining operating life to event time.
Retirement stops installed demand, with no automatic salvage credit. Repair
outcomes are independent Bernoulli draws. Return durations are deterministic or
lognormal with the specified mean/SD. Depot deterioration is independent
exponential aging while stored. Live stock is issued FIFO, using arrival order
and an initial-stock tie order fixed independently of deterioration times.
Future sampled deterioration times are never used to choose an item. A return at the exact
time of demand is processed first. Supply is sized to prevent shortages along the
assumed continuously served demand path. This is a procurement calculation, not
a system availability simulation with backorders.

Separate seeded random streams preserve demand and repair outcomes when storage
assumptions change. Event and stock resource limits reject the calculation rather
than returning a truncated answer. Negative-binomial totals do not specify event
times and are rejected for pipeline/storage simulation. Input repair probabilities
and rates are treated as supplied parameters, not estimated without evidence.

## Joint service and procurement cost

Per-PN targets are distinct from a target for every PN together. With declared
independence, joint protection is the product of marginal probabilities. With
unspecified dependence, the reported conservative lower bound is
`max(0,1-sum(1-P_i))`. Equal allocation uses equal log risk or equal union-bound
risk, respectively.

Optional minimum-purchase-cost allocation uses a binary integer program over
each PN's explicit bounded stock choices. One stock level per PN is selected;
the independent `sum(-log(P_i))` or union-bound `sum(1-P_i)` constraint enforces
the target. Costs subtract existing stock. Only analytic Poisson/negative-binomial
cases are eligible. The result is called optimal only when the solver proves
optimality within the displayed stock bounds and a full-precision postcheck
confirms service. An insufficient bound or unresolved solve returns an error.
The optimizer does not imply that every PN meets the earlier equal-risk allocation.

## Simulation uncertainty and evidence

Simulated required-stock intervals use binomial order-statistic coverage for the
population quantile. Protection intervals use the simultaneous DKW empirical-CDF
band, `epsilon=sqrt(log(2/alpha)/(2*n))`, so they remain valid when stock is selected
from the same trials. Joint intervals use a Bonferroni allocation across PN bands.
These quantify Monte Carlo uncertainty conditional on supplied model parameters;
they are not reliability-parameter confidence or predictive intervals.

DKW reference: [CMU empirical-distribution lecture, section 13.2, page 13-3](https://stat.cmu.edu/~siva/teaching/700/lec13.pdf).
Implementation references: [SciPy Poisson](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.poisson.html),
[negative binomial](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.nbinom.html),
and [mixed-integer optimization](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html).

Executable evidence is in `gui/backend/tests/test_inventory_and_ram_repairs.py`,
`gui/frontend/tests/repairTimeInput.test.mjs`, `toolkitIntegration.test.mjs`, and
`inventoryRamBrowser.mjs`. Checks include analytic thinning, zero/all repair,
retirement exposure, duplicate-PN conflict rejection, simulation seed/storage
sensitivity, the exponential renewal limit and exhaustive verification of a
small cost-allocation problem under both dependence assumptions.

Direct `lifetime_inventory` calls validate finite physical inputs, integer quantities and stock, probability bounds, cohort ordering and cohort totals as well as the API. Simulations reject a Weibull event that cannot advance the calendar clock in floating-point arithmetic. They also bound initialization to five million unit/trial paths, each trial to 100,000 events, and total events to five million; these conditions return an error rather than a truncated demand forecast. Direct-engine regression checks are in `tests/test_inventory.py`, including seeded calendar-unit scaling and unchanged caller inputs.

Negative-binomial demand uses the smaller complementary beta-function argument, with direct CDF/SF inversion. If the library cannot resolve a beta tail at extreme dispersion, a same-model probability-mass recurrence sums that tail with a geometric remainder bound and an explicit work limit. It does not substitute a Poisson model. This retains, for example, a mean demand of 10 at dispersion 10^300, including small upper-tail probabilities. `tests/test_demand.py` checks a broad SciPy parameter grid, the geometric special case, tiny means and the large-dispersion Poisson limit.

Saved Inventory Planning and Lifetime Tools results carry input signatures. Reports and Dashboard compare those signatures, units and linked-source identities; historical imported results without that evidence are marked unverified until recalculated. Presentation-only changes retain current status. Lifetime report navigation selects the saved view without deleting a result. These contracts are checked in `toolkitFreshness.test.mjs` and `lifetimeToolsBrowser.mjs`.

FIFO stock inversion shares the same sampled initial-item prefix and fixed return tokens across stock choices. Return IDs follow every permitted initial token, and are stable across those choices. Expiry events only remove stock already deteriorated; a separate FIFO queue selects live items. A larger initial stock therefore retains a superset of the smaller scenario's live tokens after every return, expiry and issue. This establishes the pathwise monotonicity needed for binary stock inversion without using knowledge of future deterioration. With two initial spares, exponential deterioration rate delta, and demands at times 1 and 3, FIFO protection is exp(-4 delta); choosing the item that will deteriorate first would give an optimistically different probability. The regression suite includes this analytic check, a deterministic counterexample, stable-seed sensitivity and calendar-unit invariance.

Analytic lifetime stock sizing rejects nonfinite inverse-CDF results and quantities above 2^53−1 rather than returning integers that cannot be represented exactly in the API.
