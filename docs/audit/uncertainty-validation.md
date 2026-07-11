# Calibrated uncertainty validation

This note records the seeded validation evidence for backlog item 8 (F011,
F040). It is a regression/coverage check, not a claim of universal coverage
across every distribution, censoring regime, boundary case, or target.

## Implemented engines

- Scalar likelihood-ratio profile intervals for reliability at a mission time,
  life quantiles, median, and mean on eligible standard life-distribution fits.
- Refitted parametric-bootstrap percentile intervals for the same targets. For
  censored samples, censoring times are resampled from the observed censor-time
  empirical distribution and this assumption is returned in diagnostics.
- Refitted reliability bootstrap intervals for identifiable two-component
  Weibull mixture and competing-risk fits.
- Weibayes beta-range sensitivity envelopes and Bayesian beta propagation. The
  Bayesian option uses a truncated-normal beta prior, integrates the Weibull
  rate parameter under a scale-invariant prior for beta weighting, and samples
  its conditional gamma posterior.
- Existing observed-Fisher/Wald and delta-method intervals remain available and
  are explicitly labeled as asymptotic approximations.

## Seeded profile-likelihood coverage study

Study configuration:

- Data generator: Weibull 2P, eta = 100, beta = 2.
- Target: R(100) = exp(-1).
- Replicates: 50, using seeds 1000 through 1049.
- Observations per replicate: 50 complete failure times.
- Nominal interval: 90%.
- Fit: Weibull 2P maximum likelihood; every replicate must pass convergence and
  eligibility checks before interval evaluation.

Observed results:

| Metric | Profile likelihood | Wald/delta reference |
|---|---:|---:|
| Eligible fits | 50 / 50 | 50 / 50 |
| Complete intervals | 50 / 50 | 50 / 50 |
| Empirical coverage | 0.94 | 0.94 |
| Mean interval width | 0.17696 | 0.17668 |

The profile engine therefore clears the seeded gross-undercoverage guard and
all intervals completed. The close result in this regular complete-sample case
is expected; the profile/bootstrap methods are primarily valuable for smaller,
censored, skewed, boundary, and weakly identified cases where the asymptotic
Wald approximation is less trustworthy. Future validation should expand this
matrix to those regimes and increase Monte Carlo replication before making a
distribution-wide coverage claim.
