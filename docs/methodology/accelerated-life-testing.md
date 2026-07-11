# Accelerated-life-test inference

Perdura treats an accelerated-life projection as conditional on three distinct
claims: the stress design identifies the fitted coefficients, their direction is
physically plausible, and the same lifetime distribution family and failure
mechanism remain applicable from test to use conditions. A successful numerical
optimizer does not establish those claims.

## Stress-design diagnostics

Rank and condition diagnostics are computed on the coordinates used by each
life-stress law, not on the raw stress labels. Examples include `1 / S` for an
Arrhenius-style single stress, `log(S)` for an inverse-power law, and an
intercept plus both transformed stress coordinates for a dual-stress model.
The non-intercept columns are centered and scaled before the condition number is
computed. Rank deficiency or severe ill-conditioning makes a model ineligible.

The fitted acceleration direction is also checked. Perdura constrains the
coefficients so that increasing an accelerating stress decreases characteristic
life under the model's parameterization. These constraints encode the direction
selected by the model, not universal physics; a stress whose harmful direction
is reversed must be transformed or modeled accordingly. The generic
multi-stress tool therefore asks for each stress direction explicitly.

## Common variability diagnostic

For Weibull, lognormal and normal ALT fits, a likelihood-ratio diagnostic
compares a common-shape/common-dispersion model with one allowing that parameter
to vary by stress group. Each hypothesis retains group-specific location or
scale, so the comparison is directed at variability rather than the acceleration
curve. At least two failures per group are required.

Rejection is evidence against a common variability structure and may indicate a
failure-mechanism change, so the corresponding fitted family is not used for
ranking or life projection. Non-rejection is only an absence of detected
conflict: sparse tests can have little power, and engineering failure-mode review
is still required. The exponential model has no separately estimated shape and
therefore cannot supply this diagnostic.

The generic two-stress regression uses a Brown-Forsythe/Levene check across
replicated stress combinations as a related diagnostic. It is reported as
inconclusive when replication is insufficient.

## Interpolation, extrapolation and leverage

For a single stress, Perdura reports whether the requested use stress lies below,
within or above the tested range in transformed design space. For two stresses,
it additionally checks whether the use point lies in the convex hull of tested
stress combinations. A point can be outside that hull even when each coordinate
is individually within its tested range.

Prediction leverage is

`h_use = x_use^T (X^T X)^(-1) x_use`.

Perdura reports it relative to the average training leverage, `p / n`. A larger
ratio means the use prediction is more remote from information supplied by the
test design. It is a design diagnostic, not a probability or a universal
acceptance threshold.

## Use-life intervals

The delta interval propagates the local parameter covariance through the fitted
use-life function. It is quick, but its local-normal approximation can be poor
for nonlinear and remote extrapolations.

The optional parametric bootstrap simulates lifetime data from the selected
model at the original stresses, retains the original censoring times, re-fits
every replicate, and forms a percentile interval from successful use-life
estimates. This captures nonlinearity and refit instability better than the delta
approximation. It remains conditional on the selected model, fixed test design,
censoring mechanism, physical-direction parameterization and unchanged failure
mechanism; it does not include model-selection uncertainty.

The implementation follows the likelihood-based acceleration-model checks
described in the NIST/SEMATECH Engineering Statistics Handbook. These diagnostics
and intervals improve qualification of an ALT result but do not validate a
failure mechanism without supporting engineering evidence.
