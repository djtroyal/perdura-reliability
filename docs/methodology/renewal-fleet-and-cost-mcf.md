# Renewal forecasts, fleet cohorts, and cost MCF

These independently specified standard probability models do not implement proprietary WinSmith/SuperSMITH forecasting corrections or calibrations.

## Event models

For a unit known to survive to age `a`, let `R` be lifetime survival and `t` additional exposure.

- **First failure:** `E[N(t)] = 1 - R(a+t)/R(a)`. Each unit contributes at most one event.
- **Minimal repair:** `E[N(t)] = H(a+t)-H(a)`, where `H=-log(R)`. Repair restores function without resetting age: an NHPP with the lifetime hazard as intensity.
- **Perfect renewal:** the first waiting time has survival `R(a+t)/R(a)`; later waiting times are independent new lifetimes.

Repairs take zero time. Unshifted exponential lifetimes reduce both repair models exactly to `lambda*t`, independently of initial age. Conditional calculations use log survival; Weibull/exponential calculations preserve additional exposure smaller than one floating-point step of the initial age.

The ordinary renewal equation is `m(t)=F(t)+integral_0^t m(t-u)dF(u)`. For the conditional first-life CDF `G_a`, delayed renewal is `m_a(t)=G_a(t)+integral_0^t m(t-u)dG_a(u)`.

## Numerical bounds

`reliability.Renewal` evaluates lower and upper lattice models. Rounding every lifetime upward to a grid multiple gives a lower count; rounding downward gives an upper count. The conditional first waiting time uses the same rule. Coupled sequences bound every renewal epoch and hence the expected event count.

The lower lattice has zero mass at grid index zero. The upper lattice may have zero-length waits, whose geometric sum is included. A grid whose zero mass reaches 0.9 is rejected and refined. FFT Newton inversion computes the renewal-measure generating function `1/(1-P(z))`. A roundoff allowance expands the envelope outward. These are discretization bounds computed in floating point, not formal interval-arithmetic certificates.

Queries between grid points use the earlier lower count and later upper count. Grids double from 128 to at most 262,144 cells. The midpoint estimate is accepted only when every requested count has half-width at most `atol+rtol*upper`. Defaults: `atol=1e-5` events per item and `rtol=5e-4`. An unmet budget produces a controlled convergence error. Zero horizons and unshifted exponential lifetimes use exact expressions.

These bounds are **not statistical confidence intervals**. They exclude fitted-parameter uncertainty and random variation in future counts. Validation uses the Erlang-2 closed form, Gamma convolution sums for other integer shapes, delayed-life quadrature, exponential reductions, and unit rescaling.

## Fleet semantics

Cohorts have unique identifiers, positive integer counts, ages at entry, entry times, and optional scheduled exit times. Entry/exit use the forecast clock; age is exposure already accumulated by each surviving unit at entry. Empty exit means retention through the horizon. Separate rows represent partial retirements.

Exposure is `max(0,min(time,exit)-entry)`. Past event totals remain after retirement. Scheduled active units count entry inclusively and exit exclusively; this is scheduled population, not an expected survivor count. Future deliveries are explicit cohorts. Counts, period increments, costs, and the independent fleet's probability of no events are distinct outputs. The latter is the product of conditional survivals, evaluated through their log sum, not clipped expected counts.

All cohorts share a lifetime distribution and constant cost per event. Different distributions or price bases require separate forecasts. Retirement is independent of failures. There is no repair downtime or resource constraint in this calculation.

## Perfect-renewal block replacement

Scheduled replacement every `T` and replacement at each failure both reset the item to new condition. Long-run cost is `(C_PM+C_CM*m(T))/T`. The pre-existing minimal-repair block policy instead uses `H(T)`; requests and results now retain that explicit repair choice.

Policy comparison searches a dimensionless interval grid, refines an interior candidate, and reports grid resolution and numerical cost bounds. Endpoint minima are not called finite optima; a candidate's upper numerical cost must beat the corrective-renewal baseline. This is a numerical search, not an analytic global-optimum certificate. Neighboring time-grid points are not reported as confidence or error bounds on optimum time. Unshifted Weibull shapes at or below one and unshifted exponential lifetimes have no beneficial finite scheduled-replacement interval with positive PM cost and return that analytical decision directly.

If the numerical search does not establish an interior candidate cheaper than corrective renewal, it withholds the recommendation instead of asserting that run-to-failure is globally optimal. An automatic cost forecast also withholds an unresolved interval; an explicit interval can still be evaluated.

Finite-horizon cost uses `k*m(T)+m(t-k*T)` failures, where `k=floor(t/T)`. Scheduled PM at an exact endpoint is included. Numerical lower/upper renewal counts propagate to costs. The pre-existing age/minimal-repair cost tool remains labeled as a long-run-rate projection.

## Monetary MCF

Each event has a finite nonnegative **per-event** cost; a count multiplies that mark. Censor rows declare observation ends. Endpoint events contribute before censoring, and zero-event systems remain at risk. For subject costs `dC_ij` and risk set size `Y_j`, the MCF increment is `sum_i(dC_ij)/Y_j`.

The subject-cluster influence process uses monetary increments directly. Equal complete follow-up reduces to the mean subject total and the between-subject sample variance divided by system count. Bootstrap resamples whole subject histories, including costs and censoring. Bounds are withheld where any requested resample loses the observable risk set. Currency conversion scales means/intervals linearly and variance quadratically. The optional count-NHPP fit is disabled for monetary marks.

## Sources

- [NTNU lifetime analysis: recurrent events and repairable systems](https://bo.folk.ntnu.no/TMA4275/2020v/TMA4275-Slides14-2020.pdf), perfect and minimal repair definitions.
- [Leemis, Topics in Survival Analysis](https://www.math.wm.edu/~leemis/otext6.pdf), renewal and NHPP models.
- `SUPERSMITH_IMPLEMENTATION_REFERENCE.md`, standard equations in sections 3.6, 3.9, and 7.4. Proprietary forecasting methods remain outside scope.
