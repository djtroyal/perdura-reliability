# Standard lifetime fitting and observation conventions

These methods implement standard statistical definitions. They do not reproduce
proprietary WinSmith/SuperSMITH corrections or assert executable compatibility.

## Plotting positions

The independent `rank_method` setting is saved with the fit, used by probability
plots and rank regression, and preserved in every matched bootstrap refit. MLE
does not use plotting positions to define its likelihood.

For complete data, let `j` be the ordered failure index and `n` the sample size:

| Setting | Probability |
|---|---|
| `benard` | `(j − 0.3)/(n + 0.4)` |
| `exact_median` | Beta(`j`, `n + 1 − j`) median |
| `mean` | `j/(n + 1)` |
| `hazen` | `(j − 0.5)/n` |
| `blom` | `(j − 3/8)/(n + 1/4)` |
| `kaplan_meier` | Post-event product-limit failure CDF |

With right censoring, the first five methods apply these formulas to the
existing mean-order adjusted ranks. This is an explicitly chosen fractional-rank
extension; the beta median is exact for complete samples, not a claim of exact
censored-sample median ranks. These schemes assign consecutive ranks to tied
failures, and failures precede withdrawals at the same time.

Kaplan–Meier instead gives all failures at a tied time the same post-event CDF.
Tied withdrawals remain in the event risk set. A terminal CDF of one remains
one; transformed regression and probability plots omit that infinite ordinate
rather than replacing it by an arbitrary near-one value. Rank regression needs
at least two distinct finite plotting points. RRX fits X on Y; RRY fits Y on X.
The historical `LS` alias resolves to and reports `RRY`.

## Mixed observations

`MixedLifeObservation` carries an explicit kind, positive integer replication
count, and only the applicable time/bounds. Each independent observation
contributes to the same log-likelihood:

- exact failure at `t`: `count × log f(t)`;
- right censor at `t`: `count × log R(t)`;
- left censor by `u`: `count × log F(u)`;
- interval failure `(l,u]`: `count × log[F(u) − F(l)]`.

Interval mass uses the better-conditioned CDF or survival tail in log space.
Exact events contribute densities and are never replaced by narrow intervals.
Interval midpoints are optimizer starting values only. Counts are retained
without expanding observations. Repeated inspections of the same unit must be
collapsed to its final observation interval before fitting; rows are not an
independent repeated-measures model.

If a mixed-schema study contains only exact failures and right censoring, it
uses the existing weighted exact-frequency engine and its applicable inference.
Genuinely mixed studies use the same regular-family restriction as interval
fits. Shifted models are excluded. Exact Exponential confidence pivots are
withheld for interval/left-censored observations; supported regular families
retain explicitly qualified, opt-in information-matrix approximations.

## Validation and units

All public standard fitters reject all-right-censored samples, non-finite or
non-vector observations, invalid confidence levels and unknown estimator or rank
names before optimization. Numerical convergence does not justify an ordinary
all-censored fit; fixed-shape Weibayes provides the separate zero-failure bound.

Fixed-shape Weibayes computes the normalized power sum with log-sum-exp. Scale
estimates and bounds are transformed back in log space. Censoring design is
classified using normalized original exposure, preserving order without
overflow or unit-dependent tie tolerances. `sum_tb` is unavailable when that
intermediate quantity cannot be represented as a positive finite float;
`log_sum_tb` records its logarithm. A representable fitted scale remains usable.

`tests/test_standard_life_methods.py` checks independent rank formulas, tie
conventions, matched refits, unit transformations, joint mixed-likelihood
optimization and exact-data reductions. These are mathematical regression
checks, not comparisons with captured outputs from proprietary software.
