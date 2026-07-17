# Uncertainty coverage validation, version 2

## Decision and scope

Perdura uses a two-tier validation strategy for calibrated uncertainty.
Deterministic PR tests protect API and numerical invariants, while the larger
nightly/release matrix estimates repeated-sampling performance.  A passing PR
test is not itself evidence that an interval has nominal coverage.

The first expansion concentrates on failure regimes that invalidate regular
observed-Fisher/Wald arguments:

- small complete samples and skewed Weibull populations;
- administrative, planned per-unit, and independently random right censoring;
- a location parameter on or near its boundary;
- overlapping, collapsed, or low-weight mixture components; and
- sparse selections close to their detection boundary.

All matrix summaries include fit eligibility and interval completion.  Coverage
conditional on successful fits is reported separately from unconditional
coverage; failed or ineligible replicates are never silently removed from the
denominator.

## Lifetime interval matrix

The core study uses nominal 90% intervals and the following generators:

| Regime | Generator | Sample sizes | Targets |
|---|---|---|---|
| Small/skewed | Weibull 2P, shape 0.7, 2, or 5 | 10, 20, 50 | R(eta), B10, tail R=0.95 |
| Censored | Weibull 2P, shape 0.7 or 2; fixed, heterogeneous schedules, or independent censoring | 20, 50 | R(eta), B10, tail R=0.95 |
| Boundary | Weibull 3P, gamma=0 or 0.02 eta | 20, 50 | R(gamma+eta), B10, tail R=0.95 |
| Breadth | Lognormal, log-SD 0.5 or 1.5 | 10, 30 | R(exp(mu))=0.5, B10, tail R=0.95 |

The right-censoring generator is part of the statistical design.  A calibrated
parametric bootstrap therefore requires one of these explicit contracts:

1. one fixed administrative cutoff;
2. the planned censor time for every experimental unit; or
3. a declared independent parametric censor-time distribution.

Resampling only the censor times observed among censored units is retained as
an explicitly approximate fallback.  Those observed times generally are not a
sample from the original censor-time distribution.

The matrix compares fast Wald/delta intervals, ordinary scalar profile
likelihood, and refitted percentile bootstrap. No boundary-aware interval is
currently implemented. A regular chi-square likelihood-ratio cutoff is not
certified at a parameter boundary, and the ordinary plug-in bootstrap is marked
`nonregular_boundary_unverified` there. This follows the nonregular likelihood
results of Self and Liang, *JASA* 82 (1987), 605-610,
<https://doi.org/10.1080/01621459.1987.10478472>, and the bootstrap-boundary
counterexample of Andrews, *Econometrica* 68 (2000), 399-405,
<https://doi.org/10.1111/1468-0262.00114>.

For each simulated dataset, all scalar bootstrap targets are evaluated from one
shared stream of simulated datasets and refits. This both preserves paired
comparisons and avoids repeating the same fit for R(eta), B10, and tail
reliability. Fewer than 100 requested refits, or less than 90% successful
refits, produces a `partial_diagnostic` interval rather than a complete one;
less than 80% successful refits refuses the interval entirely.

## Weak identification and sparse selection

Mixture and competing-risk studies include a clearly separated reference, an
overlapping pair, a 5% component, exact component collapse, and an overlapping
case with 50% administrative censoring.  Required outcomes are false
eligibility, false ineligibility, multistart disagreement, interval completion,
and coverage conditional on an identifiable fit.  Refusing inference is the
correct outcome for a genuinely unidentified replicate.

For lasso and elastic net, numerical convergence and a stricter-tolerance refit
are necessary but not sufficient evidence of reproducible selection.  Perdura
therefore uses complementary half-sample pairs over a regularization path.  It
selects one operating lambda whose empirical mean base-selection size `q` fits
the configured budget, then reports per-variable selection frequencies at that
single lambda.  The default budget solves
`q^2 / ((2*pi_threshold - 1)*p) <= 1`.  That expression substitutes observed
`q` and finite-pair selection-frequency estimates, so Perdura calls it a
plug-in PFER diagnostic and never a formal false-selection bound.  Stable
support is withheld if the q budget is unavailable or any base fit fails to
converge.

This path-calibrated selector is separate from the full-sample lasso/elastic-net
fit at the user-entered `alpha`; its stable support must not be interpreted as a
confidence statement about those displayed coefficients.  The validation
matrix varies `(n, p)`, predictor correlation, null/non-null support, and signal
strength relative to `sigma*sqrt(2*log(p)/n)`.  Its PR seed corpus is a
functional guard only.  Larger profiles classify null false selection and
strong exact-support recovery with Wilson intervals, while weak signals remain
characterization-only; cells are deterministically shardable for practical
nightly and release execution.

This is selection uncertainty, not post-selection coefficient inference.
Ordinary refit or bootstrap confidence intervals are not attached to selected
coefficients.  Relevant method references are:

- Meinshausen and Buhlmann, stability selection,
  <https://doi.org/10.1111/j.1467-9868.2010.00740.x>;
- Shah and Samworth, complementary-pairs stability selection,
  <https://doi.org/10.1111/j.1467-9868.2011.01034.x>;
- Lee et al., exact post-selection inference,
  <https://doi.org/10.1214/15-AOS1371>; and
- Javanmard and Montanari, debiased high-dimensional inference,
  <https://jmlr.org/papers/v15/javanmard14a.html>.

## Hierarchical degradation destination

The per-unit delta calculation is a two-stage screening approximation.  It
fits each unit separately, linearizes the crossing-time transformation, and
then fits a second life distribution to projected crossing points.  It cannot
pool weak individual paths, fully propagate population heterogeneity, or
account for uncertainty introduced by both stages.

The replacement model is a nonlinear mixed-effects degradation process

```
Y_ij = g(t_ij; theta, b_i) + epsilon_ij,
b_i ~ N(0, D),
epsilon_ij ~ N(0, sigma^2),
```

with population failure time

```
T_i = inf { t : g(t; theta, b_i) crosses the fixed failure threshold }.
```

The distribution of `T_i` is induced by the fitted random-effects population.
It is evaluated by Monte Carlo and its parameter uncertainty is propagated by
a refitted parametric bootstrap.  Measurement-derived crossings are not added
again as event-likelihood terms, because that would count the same evidence
twice.  A separate shared-parameter longitudinal/survival model is reserved for
applications where observed failure is not completely defined by the measured
threshold.

This first passage is defined on the latent monotone degradation path
`g(t; theta, b_i)`. The residual term is treated as measurement error, not as
stochastic process variation that itself triggers failure. Applications where
short-term noise or diffusion is physically damage-bearing require a stochastic
process or joint longitudinal/event model instead.

The initial supported paths are linear and exponential.  Other path families
remain on the delta screening route until they pass parameter-recovery,
coverage, convergence, and extrapolation tests.  The design follows the
nonlinear mixed-effects/first-crossing framework of Lu and Meeker,
*Technometrics* 35 (1993), 161-174,
<https://doi.org/10.1080/00401706.1993.10485038>.

The implementation reports both the standardized-response likelihood used by
the numerical optimizer and the Jacobian-adjusted raw-data likelihood used for
AIC and BIC.  Because the integrated marginal likelihood factorizes over
independent units, the primary BIC sample size is the unit count rather than
the repeated-reading count.  Bootstrap inference is withheld when the base fit
fails the convergence, boundary, projected-gradient, identifiability, or
quadrature-order checks.
Fewer than 100 requested hierarchical refits, or material refit attrition,
produces a partial diagnostic interval; such intervals are recorded but excluded
from coverage certification.

The degradation validation generator stops each scheduled path at its first
observed threshold crossing; paths with no crossing by the common horizon are
right censored.  The configuration label `censor_0` is operational rather than
literal: it uses the 99.999th population-life percentile, making residual
censoring negligible for the configured sample sizes while retaining a finite
follow-up time.  Coverage output separates unconditional, available-interval,
and eligible-fit denominators.

The full factorial bootstrap profiles are deliberately too large for a single
serial workstation run: nightly contains about 4.8 million refits and release
about 95.9 million.  Run them as scenario shards, for example one process per
scenario with repeated `--scenario-id <id>` invocations, retain each JSON
artifact, and aggregate only after every shard records matching configuration,
seed policy, and software provenance.  The PR profile is the routine functional
guard; a monolithic nightly or release invocation is not the recommended
execution path.

## Operating criteria

- PR tests use a fixed seed corpus and assert reproducibility, finite and
  ordered bounds, truthful diagnostics, and correct refusal behavior. Every PR
  and replication-override result is labeled `functional_guard_only`; it cannot
  emit a coverage-support conclusion.
- Nightly studies default to 250 outer replicates per cell.
- Release confirmation uses 2,000 outer replicates for analytic/profile
  methods and 1,000 outer replicates with 999 refits for bootstrap methods.
- The default nightly/release configuration runs expensive profile and nested
  bootstrap methods on a declared representative scenario subset. Pass
  `--scenario <id>` to run or shard any other configured cell; explicit
  scenario selection overrides the representative subset.
- Conditional and unconditional coverage receive separate Wilson
  classifications. A method is supported only when both lower endpoints exceed
  nominal minus 0.03 and interval completion is at least 95%.
- A method is deficient when the corresponding upper endpoint is below nominal
  minus 0.05; intermediate results are inconclusive.
- Any cell below 95% completion is labeled `insufficient_completion`, even when
  coverage conditional on successful intervals appears adequate. Stressed
  regimes publish the failure and completion rates rather than hiding them.

Every run records its configuration, seed policy, software version, elapsed
time, conditional and unconditional denominators, and machine-readable cell
results. Scenario/stage-specific NumPy `SeedSequence` streams prevent accidental
seed-range overlap while retaining the same outer dataset across methods and
targets for paired comparisons.
