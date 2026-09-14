# Step-stress cumulative-exposure inference

The version 2 procedure fits a Weibull 2P lifetime and an inverse-power
acceleration law by maximum likelihood from clock-time observations. It is
available in `reliability.Step_stress.fit_step_stress` and
`POST /api/v1/alt/step-stress/v2`. The calculation revision is 2; the implementation
identifier is `step-stress-v2.1`.

## Scope and assumptions

- Independent units enter at clock time zero and share a recorded,
  piecewise-constant, nondecreasing stress schedule.
- Every unit contributes one exact failure or right-censored observation.
  Censoring must be non-informative conditional on the design.
- Stress is positive on a ratio scale. Temperature must be absolute if an
  inverse-power temperature law is physically justified. Converting Celsius
  to Kelvin does not itself validate this law for a mechanism.
- Weibull shape is common across stresses. Acceleration is nonnegative.
- Damage accumulates through equivalent exposure; there is no recovery,
  mechanism transition, or additional effect of stress sequence.

Interval censoring, delayed entry, per-unit schedules, decreasing stresses,
multiple stress variables and other distributions are outside this version's
contract. Unsupported fields and models are rejected, not substituted.

## Likelihood and estimation

Let the first stress be the reference, and define

\[
 AF(s;p)=(s/s_{ref})^p,\qquad
 A(t;p)=\int_0^t AF(s(u);p)du.
\]

For baseline Weibull scale eta and shape beta, an exact clock-time failure
contributes `log f_Weibull(A(t)) + log AF(s(t))`; a right-censored unit contributes
`log S_Weibull(A(c))`. The density Jacobian is retained when estimating p.
Stage intervals use `(start, end]`. Survival is continuous at a stage boundary;
the density can change when the acceleration factor changes.

For d failures, scale is eliminated analytically during point estimation:

\[
 \log\hat\eta(\beta,p)=
 \frac{\operatorname{logsumexp}_i(\beta\log A(t_i;p))-\log d}{\beta}.
\]

The sum includes failures and censored units. The remaining optimization uses
multiple starting values and analytic gradients. Log exposure is evaluated
with log-sum-exp to avoid overflowing acceleration factors. Invalid likelihood
penalties are never eligible optima. Shape and exponent have numerical search
limits; estimates reaching artificial limits are rejected. The p=0 physical
boundary is reported separately, with ordinary profile inference withheld.

`joint` mode estimates scale, shape and p. `fixed_exponent` mode estimates scale
and shape conditional on an externally supplied p; uncertainty in that external
value is not propagated. The latter also permits the constant-stress reduction.
An uninformative joint stress design is rejected, and an interior optimum must
have positive, sufficiently conditioned observed information.

## Uncertainty and outputs

Parameter intervals use the asymptotic chi-square(1) likelihood-ratio cutoff.
Every reported endpoint must have a successful nuisance optimization and a
validated LR crossing. Failed optimization is never converted into a crossing.
Intervals with missing endpoints have an explicit incomplete status. A physical
boundary fit does not receive an ordinary interior-model interval.

These are pointwise confidence intervals conditional on the physical model,
common shape, schedule and censoring assumptions. Validated LR endpoints are
not evidence of finite-sample coverage calibration. Coverage over sparse-event
and censoring regimes remains unassessed. Model-selection and future-count
uncertainty are excluded. Use-stress derived-target intervals are not yet
computed and are labeled accordingly.

The empirical schedule plot uses Kaplan–Meier risk sets, retaining censored
units until their observation ends. It is not failures divided by sample size.
Use-level life estimates are explicitly flagged outside the observed stress
range. The response includes `analysis_metadata` with the estimand, observation
design, estimator, assumptions, convergence, identifiability, uncertainty,
sources and engine revision.

The old `/api/v1/alt/step-stress` route remains a tagged legacy heuristic for
compatibility. Its median-derived exponent is not joint likelihood inference.
Saved results without a version 2 schema remain inspectable in the UI with a
historical-result label; they are not silently restamped as current evidence.

## Validation evidence

`tests/test_step_stress.py` contains independent raw-parameter likelihood
optimization, censored constant-stress reduction against SciPy, the analytic
exponential limit, clock-density integration, equal-stage splitting,
transition continuity, risk-set checks, boundary behavior and injected failed
profile optimizers. The ReliaSoft 11-unit example is used as a published data
fixture; its fit is checked against an independent full-parameter optimizer,
not claimed as an independent vendor numerical result.

The example gives eta approximately 1176.85038, beta 2.67828811, p 3.99846810 and
log likelihood -48.8888208813. Independent nuisance refits validate the reported
p interval's LR endpoints. The exponential fixture has equivalent ages 5, 30
and 50, two failures, and one censor; with beta=1 and fixed p=2 its scale MLE is
85/2 = 42.5.

`gui/backend/tests/test_step_stress_v2.py` exercises ASGI request validation,
serialization, unsupported-model rejection and explicit fit failures.
`gui/frontend/tests/reliabilityTestingState.test.mjs` verifies legacy inputs,
censored rows, fixed-exponent mode and incomplete-input rejection.

## Sources

- [ReliaSoft, Time-Varying Stress Models](https://help.reliasoft.com/reference/accelerated_life_testing_data_analysis/alt/time-varying_stress_models.html), cumulative-exposure derivation and 11-unit worked example, accessed 2026-09-14.
- [ReliaSoft, Cumulative Damage General Loglinear](https://help.reliasoft.com/reference/accelerated_life_testing_data_analysis/alt/cumulative_damage_general_loglinear.html), likelihood contributions for failures and suspensions, accessed 2026-09-14.
- [NIST/SEMATECH, Accelerated Life Test Data Analysis](https://www.itl.nist.gov/div898/handbook/apr/section4/apr422.htm), joint lifetime/stress-law estimation and common-shape assumptions.
