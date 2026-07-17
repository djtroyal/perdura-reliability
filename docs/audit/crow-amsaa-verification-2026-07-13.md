# Crow–AMSAA and repairable-system verification — 2026-07-13

## Disposition

The prior Crow–AMSAA implementation was not complete or sufficiently verified.
This review replaced a finding-resolution check with a clean-sheet procedure
audit covering mathematical requirements, sampling designs, inferential claims,
numerical behavior, and every application integration layer.

The corrected implementation now distinguishes three procedures that must not
share formulas or assurance claims:

1. one repairable system with exact recurrence times;
2. one repairable system observed as grouped interval counts; and
3. multiple repairable systems, represented by a non-parametric MCF or a pooled
   power-law NHPP likelihood with an observation end for each system.

The exact-event and grouped Crow–AMSAA procedures have been corrected and are
covered by independent fixtures, estimating-equation checks, adversarial
contracts, seeded calibration, API contracts, UI contracts, and report-asset
checks. Pooled MCF/NHPP is maintained as a separate procedure and assurance
record. None of this is a global certification of all Perdura calculations:
the strict model-assurance gate intentionally remains closed while other model
domains are unassessed or have unresolved material gaps.

## Why the earlier audit missed these defects

The earlier re-audit answered the narrower question “were the original named
findings resolved?” It did not reconstruct the complete capability inventory or
the mathematical requirements for each stopping design and data representation.
That allowed “all listed findings resolved” to be interpreted too broadly.

The former test suite also had four structural weaknesses:

- some expected values were calculated with the same formula used in production;
- only one stopping-design branch was exercised;
- weak assertions checked finiteness, positivity, or endpoint order rather than
  coverage and scientific meaning; and
- an absent method or output could not fail a test because capabilities were not
  inventoried.

The corrective [model-assurance framework](model-assurance-framework.md) and
machine-readable [assurance matrix](model-assurance-matrix.json) now require
requirements, independent references, numerical and statistical validation,
integration evidence, applicability partitions, and explicit gap accounting.
The default gate checks evidence integrity and prevents unsupported promotion.
The strict gate additionally requires complete inventory and resolved material
gaps, and therefore fails closed at present.

## Mathematical review

### Exact recurrence times

For the power-law NHPP

\[
E\{N(t)\}=\Lambda t^\beta,\qquad
\rho(t)=\Lambda\beta t^{\beta-1},
\]

the raw MLE uses

\[
S=\sum_i\log(T/t_i),\qquad
\widehat\beta=n/S,\qquad
\widehat\Lambda=n/T^{\widehat\beta}.
\]

The audit verified distinct time- and failure-termination contracts. It corrected
the failure-terminated Cramér–von Mises shape correction, made termination an
explicit input instead of inferring it from the final event, retained rounded
tied times with an assumption warning, and separated the selected point estimate
from the raw-MLE statistic used by finite-sample pivots.

Shape limits use the correct design-specific chi-square pivots. Current-MTBF
limits no longer divide a count interval by a plug-in shape. Time-terminated
limits use Crow's Bessel/Poisson-mixture coefficients with the correct lower
\(n\) and upper \(n-1\) indexing. Failure-terminated limits use the exact
product-Gamma pivot. Direct one-sided lower bounds are exposed separately from
two-sided intervals.

### Grouped interval counts

For endpoints \(e_j\) and counts \(f_j\), the implementation maximizes the
full grouped Poisson likelihood with means

\[
\mu_j=\Lambda(e_j^\beta-e_{j-1}^\beta).
\]

It now distinguishes endpoint instantaneous intensity from final-bin average
intensity. The primary final-bin interval profiles the expected final-bin count
and transforms that target to average MTBF. The MIL-HDBK-189C Crow-coefficient
interval is also available, but is explicitly labeled a handbook approximation.
Simulation shows that its coverage is nonuniform with shape and sparse bin
counts; it is not relabeled “exact.” A pooled Pearson diagnostic is withheld
when the expected-count and residual-degree-of-freedom requirements cannot be
met.

### Multiple-system MCF and pooled power-law NHPP

The earlier pooled estimator was not the likelihood maximizer for unequal
observation ends. The corrected profile equation is

\[
\frac{N}{\beta}+\sum_i\log t_i
-N\frac{\sum_kT_k^\beta\log T_k}{\sum_kT_k^\beta}=0,
\qquad
\widehat\Lambda=\frac{N}{\sum_kT_k^{\widehat\beta}}.
\]

Non-parametric MCF uncertainty uses independent system histories as clusters.
One system can provide a point estimate but not between-system robust variance.
Cluster-bootstrap bounds are withheld at a time point if any requested resample
loses its risk-set support, rather than silently conditioning on successful
replicates. JSON contracts use `null` and an explicit status for unavailable
statistics; they do not emit NaN.

## Source review and provenance correction

MIL-HDBK-189C remains the formula authority for the individual-time and grouped
methods. Its section 6.2.2.9 states that the example contains 45 failures and
publishes 45-event estimates, but printed Table VI contains only 27 recurrence
times. Those 27 times are the example printed in MIL-HDBK-189 (1981), Appendix C
and reproduce the 1981 values, not the stated 189C values. The missing 18 times
make the 189C numerical example independently unreproducible from its table.
Perdura now records this discrepancy and cites the 27-event fixture to the 1981
handbook instead of claiming false 189C reproduction.

Independent numeric checks also use NIST's power-law-process example and Crow
coefficient values published in NASA TM-103511. Synthetic unequal-exposure MCF
checks are labeled estimating-equation evidence, not published benchmarks.

## Findings and resolutions

| Finding | Resolution |
| --- | --- |
| Wrong failure-terminated goodness-of-fit correction | Use the prescribed termination-specific statistic and calibrate every published significance column. |
| Incorrect current-MTBF intervals | Use Crow coefficients for time termination and an exact product-Gamma pivot for failure termination. |
| No direct one-sided current-MTBF lower bound | Implement and label direct one-sided pivots separately from two-sided limits. |
| Pooled unequal-exposure estimator was not an MLE | Solve the recurrent-event likelihood profile score and verify the score independently. |
| Termination semantics inferred or ambiguous | Require explicit time/failure termination and validate the corresponding observation contract. |
| Rounded ties rejected | Retain them, expose their presence, and warn about the continuous-time assumption. |
| Independent lifetime ages could be misused as recurrences | Remove that conversion and direct multiple-system histories to MCF input. |
| Grouped Crow–AMSAA missing | Add full grouped-Poisson MLE, final-bin targets, GOF, plots, help, persistence, and report output. |
| Instantaneous and interval-average quantities conflated | Return both under distinct names and definitions. |
| Modified estimate could appear to center exact limits | Return the selected point estimate and raw-MLE interval reference explicitly. |
| Invalid/unsupported numerical results could appear ordinary | Fail closed with availability, reason, convergence, assumption, and approximation status. |
| MCF unavailable values could serialize as NaN | Use nullable fields and pointwise availability/status contracts. |
| Bootstrap could drop unsupported resamples | Require every requested cluster resample to support a point or withhold that point's interval. |
| Source example was misattributed to MIL-HDBK-189C | Cite the reproducible 27-event values to MIL-HDBK-189 (1981) and disclose the 189C table inconsistency. |

## Validation design

The validator separates evidence by kind:

- literal values from independently published worked examples;
- independently recomputed likelihood scores and analytic identities;
- unit-equivariance, extreme-scale, minimum-sample, invalid-input, and
  representability tests;
- seeded coverage by stopping design, sample size, and shape;
- null size and alternative power for goodness-of-fit/trend procedures; and
- API, persistence, frontend contract, plot, help, and report-asset tests.

The PR profile is a deterministic functional guard and is not allowed to claim
coverage certification. A release run requires the configured simulation counts,
successful coverage cells, a known clean commit, and a clean worktree. The
release command exits nonzero when those certification conditions are not met.

### Verification executed for this review

- full library suite: 1,437 tests passed;
- backend suite: 302 tests passed;
- frontend: production TypeScript/Vite build plus plot-markup, Growth, and MCF
  contract suites passed;
- PR validation profile: all 20 published checks, four independent estimating-
  equation checks, 12 numerical contracts, three MCF numerical contracts, 12
  exact-event coverage cells, six grouped coverage cells, ten CvM calibration
  cells, and four trend size/power cells passed; and
- assurance inventory: the ordinary structural gate passed with zero errors;
  the strict global gate returned nonzero because the model inventory is
  incomplete and all four repairable-system procedure records remain
  `needs_revision`.

The PR validation artifact correctly reports `certification_eligible: false`:
it uses the smoke-profile replicate counts and the review worktree is dirty.
That status is evidence that the release-claim guard is functioning, not a
failed mathematical check.

## Boundary inference clarification

“Ordinary chi-square profile intervals at an exact parameter boundary are
unsupported” means that Perdura refuses to apply the regular one-degree-of-
freedom Wilks cutoff where its assumptions fail. It does **not** mean boundary
inference should never be supported.

Boundary inference should be added under a separate, model-specific contract.
For a three-parameter Weibull at location zero, Perdura should report the nested
two-parameter fit for regular scale/shape inference and use a constrained,
refitted parametric-bootstrap likelihood-ratio inversion for a one-sided location
bound or test. For mixture weights at zero or one, the method must account for
nuisance parameters that are unidentified under the boundary model. A generic
50:50 chi-bar-square substitution is not justified automatically for either the
support-dependent Weibull case or unidentified mixture components.

Until boundary, near-boundary, censoring, and weak-identification calibration
passes, withholding the ordinary interval is the statistically correct behavior.
The fit, boundary status, and nested-model alternative remain visible.

## Remaining disposition

- The assurance matrix must continue to keep exact Crow–AMSAA, grouped
  Crow–AMSAA, parametric pooled NHPP, and non-parametric MCF as separate
  procedures with separate evidence and gaps.
- A clean, full release-profile coverage artifact is required before a release
  certification claim. A passing PR-profile run is only a functional guard.
- The global strict assurance gate remains intentionally failing until every
  calculation domain is inventoried and all material blockers are resolved.
- Boundary-aware lifetime and mixture inference is a recommended follow-on; the
  ordinary chi-square boundary interval must remain disabled.
