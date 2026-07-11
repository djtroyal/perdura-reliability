# Process analysis: stability, capability, SPC, and Gage R&R

Perdura separates three questions that should not be collapsed into one calculation:

1. Is the process statistically stable?
2. If it is stable, is its predictable output capable relative to the specification?
3. Is the measurement system adequate to distinguish part-to-part variation?

The implementation follows the NIST/SEMATECH distinction between Phase-I baseline estimation and Phase-II monitoring and its requirement to establish stability before interpreting capability.

## Capability stability gate

Every capability result has an explicit `stability` object and a `decision_status`:

- `assess` computes a Phase-I I-MR assessment for individuals or an Xbar-R assessment for rational subgroups.
- `stable` and `unstable` record a user-supplied status without pretending it was inferred from the entered sample.
- `not_assessed` withholds a capability conclusion.

Cp, Cpk, Pp, and Ppk remain available as diagnostic estimates when stability is not demonstrated, but `decision_status` is `withheld` and the UI does not label the process capable. A supplied `stable` status should be supported by a separately reviewed control-chart study.

Subgroup constants are tabulated only for sizes 2 through 25. Unsupported sizes now fail closed; they are not silently mapped to the nearest table row.

## Phase I and Phase II control charts

Phase I estimates a candidate center and limits from historical data. Optional iterative screening identifies Rule-1 candidates and re-estimates a candidate baseline. Every excluded point and iteration is returned. These points are not automatic deletions: an assignable cause must be investigated and documented before the revised baseline is approved.

Phase II requires a separate `baseline_data` series. Center and dispersion are estimated only from that baseline and remain frozen while monitoring observations are evaluated. For p and u charts, the baseline rate stays fixed while the binomial or Poisson limits adapt to each new inspection size.

Counts, sample sizes, and table-supported subgroup sizes are validated before limits are calculated. The legacy `single` computation remains available in the Python API for compatibility, but the GUI and HTTP API default to an explicit Phase-I workflow.

## Nonnormal capability sensitivity

A Shapiro-Wilk rejection triggers a sensitivity analysis rather than a hard switch to one estimator. Perdura compares:

- empirical 0.135%, 50%, and 99.865% quantiles;
- Harrell-Davis robust quantiles;
- the best-AIC positive-support lognormal, Weibull, or gamma fit when the data permit it; and
- a Box-Cox transformed-normal model when all observations are positive.

Ppk is recomputed in nonparametric bootstrap samples for every eligible method. The response reports per-method intervals, the range across methods, bootstrap success counts, and the expected number of observations in each 0.135% tail. Fewer than five expected observations per tail is explicitly marked insufficient for stable empirical-tail inference. The fitted-distribution interval is conditional on the distribution selected from the original sample; it does not include model-selection uncertainty.

## Gage R&R topology and estimation

Classical ANOVA and Average-and-Range calculations require a complete, balanced, replicated crossed design: the same parts must be measured by every operator with equal replication. They now reject missing, unequal, nested, or unreplicated cells instead of applying balanced formulas to an incompatible design. Negative method-of-moments components are still constrained to zero but the unconstrained value and truncation are returned.

The REML method supports:

- unbalanced or incomplete replicated crossed designs with random part, operator, part-by-operator, and repeatability components; and
- nested designs in which each part belongs to one operator, with random operator, part-within-operator, and repeatability components.

REML maximizes the Gaussian restricted likelihood with non-negative variance parameters on a log scale and multiple optimizer starts. The response includes convergence, boundary, covariance-component rank, and observed-information interval diagnostics. Wald intervals on log variance can be asymmetric or very wide near a boundary; a boundary flag should be treated as evidence that the corresponding component is weakly resolved, not proof that its physical value is exactly zero.

## References

- [NIST/SEMATECH: Assessing Process Stability](https://www.itl.nist.gov/div898/handbook/ppc/section4/ppc45.htm)
- [NIST/SEMATECH: Process Control Techniques](https://www.itl.nist.gov/div898/handbook/pmc/section1/pmc12.htm)
- [NIST/SEMATECH: Gauge R&R Studies](https://www.itl.nist.gov/div898/handbook/mpc/section4/mpc4.htm)
- [NIST/SEMATECH: Variance Components](https://www.itl.nist.gov/div898/handbook/prc/section4/prc44.htm)
