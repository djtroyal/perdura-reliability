# Software Reliability Engineering methodology

Last reviewed: 2026-07-22

## Purpose and claim boundary

Perdura's Software Reliability Engineering analysis fits failure-occurrence
data indexed by a declared execution or opportunity-for-failure exposure. It
answers questions such as:

- what failure intensity is supported at the end of the observed test;
- whether a growth model is better supported than a constant-intensity
  baseline;
- how many failures the fitted process predicts over additional exposure; and
- what conditional probability of no modeled failure applies to a specified
  future mission.

The implementation is **standards-informed, not certified conformant**. The
complete text of IEEE 1633-2016 and IEEE 982-2024 has not yet been reviewed
against every exposed field. MIL-HDBK-338B §9 is guidance and includes
historical methods whose presence in the handbook does not establish current
validity. Perdura therefore implements independently reviewable likelihoods
and exposes their assumptions instead of claiming that every handbook model is
appropriate.

Software test coverage, static-analysis findings, complexity, and defect
density can be useful assurance evidence. Perdura does not silently convert
them into failure probabilities or MTBF.

## Observation contracts

All exposure values use one declared basis such as execution hours,
transactions, requests, cycles, or another consistently measured opportunity
for failure. Calendar time and execution time are not interchangeable.

### Exact failure-event exposure

Let \(0<t_1\le\dots\le t_n\le T\) be cumulative exposure at observed software
failures and let \(T\) be the complete observation exposure. Ties are accepted
for rounded or batched event records. The NHPP log likelihood is

\[
\ell(\theta)=\sum_{i=1}^{n}\log\lambda(t_i;\theta)-m(T;\theta),
\]

where \(m(t)\) is the mean cumulative failure count and
\(\lambda(t)=dm(t)/dt\) is instantaneous failure intensity. The event-free
exposure between the last failure and \(T\) is part of the likelihood and must
not be discarded.

### Grouped interval counts

For strictly increasing endpoints \(e_j\), with \(e_0=0\) and \(e_J=T\), the
count in \((e_{j-1},e_j]\) is modeled as

\[
N_j\sim\operatorname{Poisson}\left(m(e_j)-m(e_{j-1})\right).
\]

The product of these independent-increment probabilities is maximized
directly. Zero-failure intervals remain in the likelihood. Counts are never
placed at interval midpoints.

## Candidate models

| Model | Mean value \(m(t)\) | Failure intensity | Finite-fault parameter |
|---|---|---|---|
| HPP | \(\lambda t\) | \(\lambda\) | No |
| Goel–Okumoto | \(a(1-e^{-bt})\) | \(ab e^{-bt}\) | \(a\) |
| Musa–Okumoto | \(\theta^{-1}\log(1+\lambda_0\theta t)\) | \(\lambda_0/(1+\lambda_0\theta t)\) | No |
| Power-law NHPP | \(\alpha t^\beta\) | \(\alpha\beta t^{\beta-1}\) | No |
| Delayed S-shaped | \(a\{1-(1+bt)e^{-bt}\}\) | \(ab^2t e^{-bt}\) | \(a\) |

Parameters are optimized on logarithmic scales so positivity is structural.
The optimizer uses multiple starting points. A two-parameter model requires at
least four observed failures to participate in the comparison; smaller cases
remain visible as ineligible. Convergence, information-matrix condition number,
positive-definite curvature, and weak identification are reported.

The HPP is the required no-growth baseline. A lower information criterion for
a growth curve only states relative support within the supplied candidate set.
It does not prove debugging effectiveness or the causal story associated with
the curve.

## Comparison and uncertainty

Perdura reports maximized log likelihood, AIC, AICc, and BIC. AICc is used for
relative weights only when it is defined for every eligible candidate;
otherwise AIC is used. The effective comparison count is the number of
observed failures. Weights are normalized Akaike-style relative evidence
weights, not posterior model probabilities.

The observed information is evaluated in log-parameter coordinates. When its
curvature is positive definite, parameter limits use a normal approximation in
that coordinate system. Derived current-intensity, mission-reliability, and
future-count intervals are propagated by deterministic seeded draws from that
local covariance.

When requested, parametric bootstrap instead:

1. simulates a failure count and conditional event exposures, or grouped
   interval counts, from the fitted NHPP;
2. refits the same model to each replicate; and
3. propagates successful refits into derived quantities and curves.

The response records requested and successful replicate counts. Bootstrap
samples with insufficient simulated failures or failed fits are not treated as
successful evidence.

## Diagnostics

For exact event data observed through \(T\), Perdura conditions on the observed
count and maps each event location to \(m(t_i)/m(T)\). Under an adequate NHPP,
these values are the order statistics of uniform variates, so a
Kolmogorov–Smirnov statistic provides a shape diagnostic while retaining the
event-free tail to \(T\). Because model parameters were estimated from the same
failures, the nominal p-value is labeled diagnostic rather than exactly
calibrated. Tied exact-event exposures trigger a warning because interval counts
are usually the more faithful representation of coarse time resolution.

For grouped data, Perdura reports a Pearson interval-count diagnostic only when
there is at least one residual degree of freedom and every expected count is at
least five. It is labeled asymptotic. Otherwise the test is unavailable rather
than reporting an unstable p-value.

These checks do not detect every material problem. Release/build change points,
operational-profile drift, duplicate failure reports, changes in test oracle,
and imperfect debugging require engineering review and, where appropriate,
separate phases.

## Release projections

For observed endpoint \(T\) and future exposure \(d\),

\[
E[N(T+d)-N(T)]=m(T+d)-m(T)
\]

and the fitted conditional no-failure probability is

\[
R(d\mid T)=\exp[-\{m(T+d)-m(T)\}].
\]

"Mission reliability" in this module means this conditional probability over
the user-entered release mission exposure. It is not a hardware survival
probability and does not include unrepresented field profiles, new code,
configuration changes, common-cause outages, security events, or model-form
uncertainty.

Additional exposure to an intensity target is obtained by numerically solving
\(\lambda(t)=\lambda_{target}\) for a decreasing fitted curve. The returned
point-estimate exposure is withheld when the curve does not reach the target.
When uncertainty draws are available, Perdura separately reports the fraction
whose current intensity already meets the target.

Remaining faults are reported only for Goel–Okumoto and delayed S-shaped
finite-fault models as \(\max(a-m(T),0)\). Other models do not have a finite
fault-total parameter, so the field is explicitly unavailable.

### Operational-profile context

Optional profile rows contain an operation name, observed exposure, observed
failures, and planned mission share. Perdura calculates a separate
constant-rate Poisson estimate and exact chi-square rate interval for each row,
normalizes the planned shares, and reports

\[
E[N_{mission}]=d\sum_j w_j\widehat\lambda_j.
\]

This is displayed as a profile-stratified baseline. It is deliberately not
multiplied into or blended with the aggregate NHPP growth curve. Such a blend
would require a joint stratified growth model and evidence that profile-specific
rates and growth share a defensible structure.

## Verification evidence

Automated tests cover:

- the closed-form HPP maximum-likelihood rate and future-count identity;
- decreasing-intensity discrimination against the HPP baseline;
- direct grouped interval likelihood including a zero-failure terminal bin;
- finite-fault versus infinite-growth output semantics;
- deterministic seeded bootstrap results;
- finite monotone mean curves for every candidate; and
- fail-closed observation contracts.

Further validation remains required before a strict scientific assurance claim:
published worked-example parity for every model, simulation coverage matrices
over small/sparse and weak-identification regimes, operational-profile and
change-point extensions, and an independent full-text standards review.

## References

1. U.S. Department of Defense, *MIL-HDBK-338B, Electronic Reliability Design
   Handbook*, 1998, §9.
2. IEEE Computer Society, *IEEE Std 1633-2016, Recommended Practice on
   Software Reliability*, 2016. Full-text conformance review pending.
3. NIST/SEMATECH, *e-Handbook of Statistical Methods*, Reliability Growth
   sections 8.1.7 and 8.1.9.
4. A. L. Goel and K. Okumoto, “Time-dependent error-detection rate model for
   software reliability and other performance measures,” *IEEE Transactions
   on Reliability*, 1979.
5. J. D. Musa and K. Okumoto, “A logarithmic Poisson execution time model for
   software reliability measurement,” 1984.
