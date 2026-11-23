# Inference and sequential test design

The Reliability Testing → Test Design workflow stores each tool's inputs and
results in the project's `reliabilityTestingTools` slice. Editing inputs clears
results and invalidates pending responses. The new `/inference-tools` routes use
explicit request models; unsupported fields and nonfinite inputs are rejected.

## Aggregate MTBF

The fixed-exposure model is a homogeneous Poisson process (repairable systems
or replacement testing). For exposure T, failures r and confidence 1−α,
MTBF limits are 2T/χ²(1−α/2,2r+2) and 2T/χ²(α/2,2r). Failure-terminated
exponential tests use 2r degrees of freedom in both denominators. One-sided
limits use α rather than α/2. Rate bounds reverse reciprocal MTBF endpoints.
Zero failures have rate MLE zero, no finite MTBF MLE, and no finite MTBF upper
endpoint. Failure termination requires a positive predeclared failure count.

Exposure groups sum units × duration × operating duty. These rows do not infer
sampling design, replacement behavior, or censoring. Time-truncated finite
nonreplacement lifetime samples are not claimed to have exact Poisson coverage.
Life Data's separate complete/Type-II pivotal inference remains unchanged.

## Binomial and normal intervals

Clopper–Pearson intervals invert beta quantiles at all sample sizes. One-sided
bounds allocate all error to one tail. Defect intervals transform to reliability
by reversing and complementing endpoints. Optional Wilson score intervals are
explicitly selected and labeled; there is no automatic sample-size switch.
Normal summary inference uses the exact Student-t mean pivot when the entered
standard deviation is a sample estimate (n−1 denominator), at every n≥2. Known
population sigma uses a Normal pivot. These formulas require independent,
complete Normal observations, not censored samples.

## Discrete count probabilities

The explorer evaluates PMF, CDF, survival, inclusive interval and acceptance
probabilities using binomial or hypergeometric distributions. Binomial trials
are independent with common defect probability. Hypergeometric sampling is
uniform without replacement from a specified lot with integer defect count.
Acceptance always means at most the entered acceptance count; it is distinct
from the selected probability event. Risk points for finite lots use floor(Np)
for the good quality threshold and ceil(Np) for bad quality and report the
realized fractions. Large-support tables/plots are sampled; numerical event
probabilities still evaluate the full distribution, without replacing it by a
Normal or Poisson approximation. Upper-tail events use survival functions.

## Executed sequential tests

Let A=β/(1−α), B=(1−β)/α, where α is producer risk and β is consumer risk.
Require 0<α,β<1 and α+β<1. Accept good quality at log LR≤log A, reject at
log LR≥log B, and otherwise continue. The first crossing stops the path; later
submitted observations are counted as ignored. At a declared horizon, users
choose either an explicit inconclusive outcome or the more likely simple
hypothesis (LR≤1 accepts, including ties). This terminal rule changes achieved
risks, which must be evaluated under that rule.

For Bernoulli defect probabilities p0<p1, log LR equals
x log(p1/p0)+(n−x)log[(1−p1)/(1−p0)]. Integer acceptance/rejection boundaries
are checked against this original log likelihood to avoid rounding errors.
Finite-horizon operating characteristics and average sample number are computed
by exact probability recursion over still-active defect counts. Expected sample
number sums the probability of remaining active before each inspection.

For exponential good MTBF θ0>bad θ1, log LR equals
r log(θ0/θ1)−T(1/θ1−1/θ0). Acceptance can occur during event-free exposure,
not merely when a failure arrives. At an exact event/acceptance-time tie, the
event is processed first; such ties have probability zero under the continuous
model but can occur in entered rounded data. Failure exposures must strictly
increase and lie within the observed exposure, itself within the plan horizon.

Exponential operating characteristics and expected stopped exposure use seeded
Monte Carlo paths with precisely the same boundaries and terminal rule. Each
probability reports a 95% Clopper–Pearson Monte Carlo interval. The expected
exposure reports Monte Carlo standard error and an approximate 95% mean
interval. These quantify simulation error, not uncertainty in the assumed
exponential model or a guarantee that achieved risks equal nominal risks.
A finite computational event budget fails explicitly instead of silently
truncating paths or changing the requested statistical design.

## Phase growth planning

An instantaneous MTBF anchor m0 at exposure t0 gives
M(t)=m0(t/t0)^α. An initial-phase average input M1 instead converts to
m0=M1/(1−α). The initial phase assumes constant average M1 for t0 exposure;
its endpoint applies this conversion. Later phase failures integrate 1/M(t),
and phase-average MTBF equals phase exposure divided by expected failures.
Endpoint MTBFs are never arithmetically averaged to estimate failures. The
phase table retains the original basis and user-entered provenance. Delayed
corrective-action accounting remains separate from this planned trajectory;
none of these deterministic projections is a fitted confidence statement.

## Verification

`tests/test_inference_tools.py` checks stopping-design reference values,
zero-failure limits, all-n exact binomial endpoints, unknown-variance t pivots,
finite-lot combinatorial sums, tiny upper tails, and SPRT first crossings.
Bernoulli OC/ASN is checked by exhaustive independent path enumeration.
Exponential simulation is checked against an analytic short-horizon case and
seeded time-unit transformations. Growth phase counts are checked by an
independent power-law integral. API contracts check strict validation and
JSON-safe output. Frontend contracts cover parsing, result invalidation
signatures and project-backed state; browser checks exercise actual Python
handlers through the production controls.

References: [NIST MTBF inference](https://www.itl.nist.gov/div898/handbook/apr/section4/apr451.htm),
[NIST proportion intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm),
[NIST mean intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc221.htm).
Sequential boundaries follow the likelihood-ratio derivations above; the tools
do not assert clause-complete military-handbook test-plan certification.

Saved inference results carry their input signature and project units. The UI,
Report Builder and Dashboard use the same freshness check. Changed or unverified
inputs require recalculation; asynchronous results are also bound to their
originating project. Presentation-safe canonical ordering avoids false changes
when JSON object keys are reordered.
