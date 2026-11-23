# Composite lifetime models and distribution-derived calculations

These are independently implemented probability models. They do not reproduce
proprietary WinSmith/SuperSMITH estimators, corrections, or forecasting methods.

## Susceptible fraction with common risks

Write `A_i(t) = (t/alpha_i)^beta_i`, with positive scales and shapes, and let
`u` be the fraction susceptible to an additional independent risk.

- Partial competing risks: `R(t) = exp(-A_2(t)) * [1-u+u*exp(-A_1(t))]`.
- Three-risk composite: `R(t) = exp(-A_2(t)-A_3(t)) * [1-u+u*exp(-A_1(t))]`.

These follow directly by conditioning on susceptibility and multiplying the
independent common-risk survivals. `u=0` removes the susceptible risk; `u=1`
gives ordinary competing risks. The three-risk model can produce a bathtub
hazard, but its parameterization does not guarantee that shape.

Fits maximize the exact/right-censored log likelihood after normalizing time.
Deterministic multistart optimization uses positive-parameter and fraction
transforms with declared finite search bounds. Boundary solutions, weak
effective susceptible counts, disagreements among near-optimal starts, and
ill-conditioned dimensionless observed information prevent an eligible fit.
Common risks in the three-risk model have an exchangeable labeling convention.

Parameter and function confidence intervals are withheld: these mixture-like
models can be nonregular, and neither optimizer convergence nor a finite Hessian
establishes calibrated uncertainty. Their fit diagnostics are not a proof of
global optimality or practical identifiability for every dataset.

## Conditional survival and remaining life

Conditional survival over additional exposure `d` at age `a` is
`R(a+d)/R(a)`. Remaining life solves that expression for a requested reliability.
This is additional exposure for a surviving item, without a repair or renewal.
Shifted supports retain their threshold. Impossible conditioning is rejected.

Weibull calculations use the cumulative-hazard difference, evaluated with
logarithms and `expm1`/`log1p`; exponential calculations use exposure directly.
This retains a tiny positive remaining exposure even when it is smaller than
one floating-point step of the elapsed age. Other distributions use log-survival
and a bracketed solve, with a check of the attained conditional target.

## Independent stress-strength interference

For independent stress `X` and strength `Y`, failure probability is
`P(X>Y) = E[F_Y(X)]`; reliability is evaluated independently as `P(Y>X)`.
The implemented distributions are continuous, so equality has zero mass.
Equivalent physical units are converted before comparing the random variables.

Normal differences, equal-shift lognormal ratios, and equal-shape/equal-shift
Weibull comparisons have analytic reductions. Other pairs integrate over
probability space, separately using lower quantiles and inverse survival
quantiles. Distribution support and quantile landmarks split small tail
intervals before normalized quadrature. Both complementary probabilities are
computed so a small reliability is not lost by subtracting failure probability
from one. An unresolved overlapping-support tail is an explicit calculation
failure, rather than a reported zero risk.

Quadrature error estimates are numerical estimates, not statistical confidence
bounds or interval-arithmetic certificates. These calculations treat the input
distributions as fixed; they do not propagate fitted-parameter uncertainty or
stress-strength dependence.

## Adopted-model specification tails

For fixed lower and upper limits, below-limit PPM is `1e6*F(LSL)` and above-limit
PPM is `1e6*R(USL)`. An omitted limit contributes zero. The upper tail uses the
survival function directly, retaining probabilities that `1-F(USL)` can lose.
The source dataset's physical quantity and unit govern the specification limits.

This calculation uses an explicitly adopted, current dataset distribution. It
does not refit measurement rows, establish process stability, or propagate
parameter uncertainty. Every newly calculated result saves its adopted model,
source identity, limits, and engine revision. Source/limit/engine changes mark
the retained output historical in the module, Dashboard, and report metadata.
Missing calculation provenance is unverified and is never upgraded on import.

## Evidence and assurance scope

Independent algebra, reduction identities, density integration, unit conversion,
rare-tail oracles, likelihood checks, and API/provenance tests are recorded in
the model-assurance matrix. Those regression checks do not certify untested
parameter regimes or an immutable release. The matrix retains the outstanding
calibration and complete-integration requirements explicitly.
