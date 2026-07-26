# LDA confidence-interval audit and remediation

**Audit date:** 2026-07-26
**Scope:** all Life Data Analysis parameter intervals, plotted distribution
bounds, scalar uncertainty calculations, grouped observations, special models,
nonparametric estimators, Turnbull, and Weibayes.

## Executive result

The audit found that the previous implementation applied observed-information
Wald and delta approximations too broadly, did not preserve the selected
estimator during bootstrap refits, and could report numerical intervals after
nonregular or weakly identified fits. Those paths have been corrected.

Perdura now prefers exact finite-sample inference where implemented, provides
an estimator-matched on-demand uncertainty package for regular fits, exposes
quick asymptotic results only by explicit opt-in, and withholds numerical
inference for unsupported boundary and weak-identification regimes. Every
result carries structured method and scope metadata.

This audit establishes implementation completeness and truthful method
classification. It does not assert universal nominal coverage. Empirical
coverage remains a per-family, per-design validation obligation.

## Findings and disposition

| Finding | Risk | Resolution |
|---|---|---|
| A numerical Hessian was treated as usable whenever it could be inverted. | Indefinite or nearly singular information could produce plausible-looking but meaningless intervals. | Compute in natural/log parameter coordinates as appropriate; require finite SPD information/covariance and condition number at most \(10^{10}\); fail closed otherwise. |
| Negative delta variances could be clipped to zero. | A numerical failure could become a falsely precise band. | Reject materially negative or nonfinite variances; use adaptive one-sided derivatives only when a boundary prevents central differences. |
| Rank-regression fits inherited generic confidence calculations and bootstrap refits used MLE. | The interval described a different estimator than the displayed fit. | Automatic RRX/RRY intervals are withheld; the uncertainty package refits the same rank estimator in every replicate. |
| Generic Wald/delta output was displayed as the normal/default answer. | Users could mistake a large-sample approximation for calibrated primary inference. | Label it `quick_*`, mark `primary:false`, hide parameter endpoints and curve bands by default, and add a single reveal control. |
| Normal and Lognormal complete samples did not use their exact pivots. | Unnecessary finite-sample approximation, especially at small \(n\). | Added exact Student-\(t\) \(\mu\), chi-square \(\sigma\), and noncentral-\(t\) pointwise CDF/SF inference, including exact-frequency weights. |
| Shifted Exponential inference used regular machinery at a support boundary. | Ordinary Hessian/Wilks assumptions do not hold for \(\gamma\). | Added analytic support-boundary MLE and exact complete/Type-II pivots for both parameters plus a simultaneous curve band. |
| Ordinary likelihood-ratio comparisons and contours included nonregular 3P/support-changing models. | Chi-square reference distributions were not justified. | Suppress ordinary comparison inference for these model pairs and report a reason instead. |
| Three-parameter Weibull, Lognormal, Gamma, and Loglogistic fits reported or invited ordinary intervals. | Unknown location changes support; regular Wald/profile/bootstrap theory is invalid. | Remove numeric parameter/curve intervals and reject generic profile/bootstrap requests with `nonregular_location_inference`. |
| Mixture, competing-risk, and DSZI fits could retain Wald intervals despite weak identification or a probability boundary. | Local curvature understates uncertainty or is undefined. | Clear automatic intervals; require an eligible multistart fit and a full refitted bootstrap; withhold at detected boundaries. |
| Bootstrap completion rules tolerated material refit attrition. | Conditioning on successful refits can bias interval endpoints. | Require at least 95% eligible refits and disclose requested/successful counts, failure reasons, runtime warnings, and seed. |
| Censored bootstrap sampling did not always reproduce the study design. | Coverage referred to an accidental censor-time model. | Support fixed administrative, per-unit planned, conventional Type-II, and independent parametric censoring plans; label empirical resampling approximate. |
| Weibayes used inconsistent degrees of freedom for the two-sided fixed-shape interval. | Equal-tail endpoints did not arise from one stated pivot. | Use \(2r\) on both endpoints for complete/Type-II data; withhold the exact two-sided interval for arbitrary censoring; retain one-sided zero-failure logic. |
| Interval-censored Turnbull output lacked a refitted uncertainty path. | The NPMLE curve had no dataset-context uncertainty. | Add an observation-pattern multinomial bootstrap and pointwise CDF/SF bands with the same 95% completion gate. |
| KM/NA bounds lacked enough semantics to distinguish pointwise, asymptotic, and tail-sensitive output. | Late-curve bands could be overinterpreted. | Add structured confidence metadata and sparse-tail risk-set warnings. |
| API and plot payloads used inconsistent confidence vocabulary. | Exports and UI could lose method provenance. | Standardize availability, reason, estimator, exactness, band scope, parameter/function methods, assumptions, validation status, and primary-display fields. |
| There was no completeness control tying all fitters to a reviewed confidence decision. | A new fitter could silently inherit generic behavior. | Add a machine-readable inventory and structural tests that require every standard fitter exactly once. |

## Verification performed

Automated tests cover:

- exact Normal/Lognormal formulas and log-transform equivalence;
- exact Exponential parameter and curve inference;
- complete, Type-II, arbitrary-censoring, grouped-count, and rank-estimator
  decisions;
- covariance rejection and fail-closed paths;
- matched MLE and rank bootstrap packages;
- nonregular 3P and weak-identification refusals;
- Weibayes standard and zero-failure cases;
- API method/scope serialization; and
- inventory completeness across every standard fitter.

The PR-tier Monte Carlo suite remains a deterministic functional guard.
Nightly/release coverage output must be retained as verification evidence
before making a coverage claim for a particular family, confidence level,
sample size, censoring design, and target.

## Remaining qualified limitations

- Generic two-parameter Weibull, Gamma, Loglogistic, Beta, Gumbel, and censored
  Normal/Lognormal quick intervals remain asymptotic and opt-in.
- A model-specific boundary-aware method is not yet certified for
  Weibull-3P, Lognormal-3P, Gamma-3P, or Loglogistic-3P.
- Turnbull observation-pattern bootstrap assumes the observed inspection
  patterns represent the sampling process.
- KM/NA bands are pointwise and asymptotic; simultaneous nonparametric bands
  are not implemented.
- Model-selection uncertainty is not included when choosing a fitted family.

These limitations are now surfaced as metadata or unavailable reasons rather
than hidden behind numerical endpoints.
