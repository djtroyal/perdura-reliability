# Calibrated uncertainty validation

This note records the seeded validation evidence for backlog item 8 (F011,
F040). It is a regression/coverage check, not a claim of universal coverage
across every distribution, censoring regime, boundary case, or target.

## Implemented engines

- Scalar likelihood-ratio profile intervals for reliability at a mission time,
  life quantiles, median, and mean on eligible standard life-distribution fits.
- Refitted parametric-bootstrap percentile intervals for the same targets. A
  censored study can declare a fixed administrative cutoff, the complete
  planned per-unit schedule, or an independent parametric censor-time model.
  Resampling observed censor times is retained only as an explicitly
  `approximate_unverified` fallback.
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

## Version 2 validation harness

The expansion is implemented as a two-tier-plus-release harness rather than a
single long-running unit test:

```bash
python tools/uncertainty_coverage_matrix.py --tier pr
python tools/uncertainty_coverage_matrix.py --tier nightly --output /tmp/uncertainty-nightly.json
python tools/uncertainty_coverage_matrix.py --tier release --output /tmp/uncertainty-release.json
# Explicit scenario selection is the deterministic sharding interface and
# overrides the tier's representative expensive-method subset.
python tools/uncertainty_coverage_matrix.py --tier release \
  --scenario random_b2_n20_c70 --output /tmp/uncertainty-release-random-c70.json

python tools/run_sparse_selection_matrix.py --profile pr --summary-only
python tools/run_sparse_selection_matrix.py --profile nightly --summary-only \
  --shard-count 4 --shard-index 0 \
  --output /tmp/sparse-selection-nightly-shard-0.json
python tools/run_sparse_selection_matrix.py --profile release --summary-only \
  --shard-count 8 --shard-index 0 \
  --output /tmp/sparse-selection-release-shard-0.json

python tools/hierarchical_degradation_validation.py --profile pr --summary-only \
  --output /tmp/hierarchical-degradation-pr.json
# Run large profiles as scenario shards; repeat with each scenario id.
python tools/hierarchical_degradation_validation.py --profile nightly \
  --scenario-id linear-u10-r3-error_low-hetero_low-censor_50 \
  --summary-only --output /tmp/hierarchical-degradation-shard.json
```

Repeat the sparse nightly command for shard indices 0 through 3 and the release
command for indices 0 through 7, changing the output suffix for each shard.
Cell seeds are independent of sharding, so the artifacts can be compared or
recombined without changing the seed corpus.
The hierarchical factorial is likewise intentionally sharded by scenario: the
full nightly and release configurations imply about 4.8 million and 95.9
million bootstrap refits, respectively, and are not intended as monolithic
serial workstation jobs.

The lifetime configuration is stored in
`tools/uncertainty_coverage_matrix.json`. Each result separates fit
eligibility, interval completion, conditional coverage, and unconditional
coverage. PR and replication-override runs emit only
`functional_guard_only`. Nightly/release support requires both conditional and
unconditional Wilson classifications plus at least 95% interval completion.
The tool records elapsed time, software provenance, and a scenario/stage
`SeedSequence` policy. Expensive nested-bootstrap targets share each refit, and
the default large tiers schedule those methods on a representative subset;
explicit `--scenario` shards can execute every remaining cell.

Censored parametric bootstraps can now reproduce a fixed administrative
cutoff, a complete planned per-unit censoring schedule, or an independently
generated parametric censor-time model. Omitting this contract for censored
data retains the previous empirical resampling only as an
`approximate_unverified` result with explicit warnings. The planned design can
also be declared when the observed sample happened to contain no censored
units, because a bootstrap replicate may still reach the planned censor time.

Bootstrap results expose inferential calibration separately from censor-design
reproduction. Fewer than 100 requested refits or less than 90% successful
refits yields a partial diagnostic rather than a complete interval; fewer than
80% successful refits refuses the calculation. Ordinary plug-in bootstrap and
chi-square profile inference are explicitly unverified/unsupported at detected
nonregular boundaries.

Ordinary chi-square profile intervals are marked unverified or unsupported
when a fitted parameter is on a nonregular boundary. Weakly identified
mixture and competing-risk scenarios report eligibility decisions and
multistart stability as outcomes rather than silently conditioning the study
on successful fits.

This is a prohibition on the *ordinary* Wilks chi-square cutoff, not a decision
that boundary inference is unimportant or permanently out of scope.  The next
supported boundary path should be model-specific:

- when a three-parameter Weibull location estimate is exactly zero, report the
  nested two-parameter Weibull fit for regular scale/shape inference;
- obtain a one-sided location bound or likelihood-ratio test by constrained,
  refitted parametric-bootstrap inversion, reproducing censoring and the
  original fitting constraints in every replicate;
- for mixture weights at zero or one, account for nuisance parameters that are
  unidentified under the boundary model rather than applying a generic
  chi-bar-square shortcut; and
- enable the result only after coverage, type-I error, interval completion, and
  optimizer-boundary behavior pass at the boundary, near the boundary, under
  censoring, and under weak identification.

Until that evidence exists, Perdura fails closed for the boundary interval and
retains the fit/status diagnostics.  A boundary-aware method must be presented
under its own method name; it must never silently reuse the ordinary
`chi_square_1df` profile label.

The statistical basis is the nonstandard likelihood-ratio theory of
[Self and Liang (1987)](https://doi.org/10.1080/01621459.1987.10478472).
Three-parameter Weibull location is especially nonregular because the unknown
location changes the distribution support; see
[Montoya, Díaz-Francés, and Figueroa (2019)](https://doi.org/10.1016/j.apm.2018.11.043).

Sparse validation reports operating-lambda selection probabilities, false
discoveries, missed signals, exact support, independent-test prediction error,
q-budget diagnostics, and base-fit convergence. The PR profile is labeled only
as a deterministic functional guard. Nightly and release profiles attach
Wilson-interval acceptance classifications for null false selection and strong
exact-support recovery; near-boundary signals remain characterization-only.
Null cells are accepted only when the upper 95% Wilson endpoint for selecting
any noise variable is at most 0.10. Strong-signal cells require the lower
endpoint for exact-support recovery to be at least 0.70. Completion is targeted
at 0.95 and reported separately in every cell.
The CLI exits nonzero for a failed guard or deficient Monte Carlo evidence. It
deliberately does not attach ordinary confidence intervals or p-values to
lasso-selected coefficients.

See [Uncertainty coverage validation, version 2](uncertainty-coverage-v2.md)
for the complete methodology and degradation-model migration decision.
