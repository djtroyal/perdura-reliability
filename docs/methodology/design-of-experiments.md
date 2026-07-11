# Design of experiments

Perdura separates design generation, execution order, planning assumptions and
the response model. A generated run table is not considered analyzable merely
because it has enough rows: its planned model must be identifiable, the run
order and blocks must be traceable, and the completed experiment must be sent
to the model family for which it was designed.

## Versioned design contract

Every generator returns metadata contract version 2 with:

- the generator key and design class;
- factor names, coding and run count;
- the planned analysis model and its terms;
- design-matrix rank, parameter count, residual degrees of freedom and scaled
  condition number;
- bounded null-space alias relations when the planned model is deficient;
- unique/replicated design-point counts and potential pure-error degrees of
  freedom;
- nuisance-block rank/confounding diagnostics;
- randomization scope, seed and the standard-order indices used in execution;
- an optional coefficient-power calculation.

For large screening models, individual null-space relations are capped so the
diagnostic payload cannot grow quadratically; rank, nullity and estimability
remain explicit.

## Blocking and randomization

Perdura's generic blocker assigns nearly equal block sizes while greedily
reducing imbalance in standardized coded factor means. It then checks the model
matrix augmented with reference-coded block effects. If the augmented rank is
smaller than the treatment rank plus the expected block degrees of freedom,
the design reports treatment/block confounding.

This allocator is useful when a nuisance condition such as day, batch or
operator can be held constant within blocks. It is not a substitute for a
defining-contrast block construction in a regular fractional factorial. The
warning remains in the metadata. Run randomization is performed within each
block and records the seed and standard-order permutation. Completed analyses
include block fixed effects; a rank-deficient treatment-plus-block model is
rejected rather than partially fitted.

## Power planning

For the selected coded model, coefficient variance is proportional to the
corresponding diagonal of `(X'X)^(-1)`. Given a planned absolute coefficient
divided by residual standard deviation, Perdura computes two-sided noncentral-t
power for every non-intercept term. It reports the lowest term power in the
current design and searches complete-design replication counts for the first
one meeting the target.

For a two-level factor coded `-1/+1`, the high-minus-low effect is twice its
regression coefficient. The calculation is conditional on the specified model,
independent homoscedastic normal errors, complete-design replication, and no
multiplicity adjustment. It does not estimate an effect size from unobserved
data.

## Factorial screening analysis

Two-level analyses require exactly two finite levels for every factor. Main and
optional two-factor interaction columns are checked for aliases. The regression
includes supplied nuisance blocks, and treatment sums of squares are computed
by dropping each treatment column from the full block-adjusted model. Saturated
unreplicated designs use Lenth's pseudo-standard-error view; replicated designs
use residual inference.

Plackett–Burman contracts plan main effects only. Regular fractions retain their
defining relation and alias structure. A user should confirm screening findings
in a follow-up design when interactions may be active.

## Response-surface analysis

Central composite and Box–Behnken designs fit

`y = b0 + sum(b_i x_i) + sum(b_ii x_i^2) + sum(b_ij x_i x_j) + error`.

The model must be full rank. The quadratic coefficient matrix supplies the
stationary point `x* = -0.5 B^(-1)b`; its eigenvalues classify the point as a
minimum, maximum or saddle. A singular quadratic is reported as a ridge, and a
stationary point outside any tested coded-factor range is flagged as
unsupported extrapolation rather than a validated optimum.

Replicated design points partition residual sum of squares into pure error and
lack of fit. Perdura reports the F test only when both components have degrees
of freedom. With no replication it returns
`unavailable_no_replicated_design_points`.

## Mixture and constrained analysis

Mixture components are validated as nonnegative proportions summing to one.
Following Scheffé, the linear model uses component terms without an intercept;
the quadratic model adds every pair product. Auto mode falls back to the linear
blend model when a constrained design cannot identify all quadratic terms, and
states that fallback.

Predicted minimum and maximum blends are found with the equality constraint
`sum(x_i)=1` and the component lower/upper bounds supplied with an
extreme-vertices design or analysis request. These are conditional polynomial
optima. They should be confirmed experimentally, especially when they lie on a
constraint boundary or when lack-of-fit cannot be tested.
