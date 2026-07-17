# Statistical-semantics migrations

This note records public result-shape and inference changes made for audit
findings F027, F028, F032, F033, F039 and F044.

## Mann–Whitney direction

SciPy reports the Mann–Whitney statistic for the first supplied sample. Perdura
therefore defines rank-biserial correlation as

`r_rb = 2 U_A / (n_A n_B) - 1`.

A positive value means group A tends to be larger than group B. Swapping the
groups negates the effect and leaves the two-sided p-value unchanged. The API
now returns `effect_size_direction` with this definition.

## Repeated and mixed measures

One-factor repeated-measures ANOVA computes Mauchly's statistic in an
orthonormal contrast space. It reports Greenhouse–Geisser, Huynh–Feldt and
lower-bound epsilon estimates and the corrected degrees of freedom and p-value
for each. With two conditions sphericity is automatic. When Mauchly rejects at
the requested alpha, the top-level p-value uses the Greenhouse–Geisser
correction; `p_value_uncorrected` remains available.

The mixed-design endpoint no longer presents approximate split-plot sums of
squares for unequal group sizes. It fits the full between-by-within cell-means
model, estimates a common within-subject covariance from the pooled residual
cross-product (the REML estimate for that model), and tests equal-weight
marginal contrasts with explicitly labeled Wald-F denominator-df
approximations. An unstructured covariance is preferred. If it is not
identifiable or well-conditioned, a positive-definite compound-symmetry
fallback and warning are returned. Every subject must have one observation at
every within-factor level.

## Two-level DOE and Plackett–Burman

`analyze_factorial` is a two-level analysis contract. Every named factor must
have exactly two finite levels; multi-level factors are rejected instead of
being silently mapped by their extrema. The returned `factor_levels` records
the low/high mapping.

Plackett–Burman generation now advertises only the constructions it validates:
tabulated cyclic designs at 12, 20 and 24 runs and Sylvester-Hadamard designs at
4, 8, 16, 32 and 64 runs. Requests support 1–63 factors, advance to the next
available construction, and verify the generated main-effect Gram matrix is
`N I` before returning it.

## Weibayes survival bounds

The Weibayes response guarantees `sf_lower <= sf <= sf_upper` wherever both
bounds exist. Earlier fields had their names reversed because they were labeled
by eta endpoints instead of survival ordinates; those obsolete aliases are no
longer exposed. A zero-failure analysis has only a lower reliability curve, so
its semantic upper curve contains nulls.

## Period-grouped warranty returns

A Nevada-chart claim recorded at integer age `a` is an interval-censored event
in `(a-1, a]`, not an exact event at `a`. Perdura's warranty fit now maximizes

`sum_j count_j log(F(upper_j)-F(lower_j)) + sum_k censored_k log(S(time_k))`.

Counts remain floating-point weights. They are never rounded or expanded, and
units still in service remain grouped right-censored observations. The
compatibility exact-age arrays are populated only for integral counts, are
explicitly labeled legacy, and are not used in fitting.

Forecast intervals draw model parameters from the local optimizer covariance
and recompute conditional expected returns. They quantify selected-model
parameter uncertainty only; future process-count variation, reporting lag and
model-selection uncertainty remain excluded and are stated in the response.

## LDA grouped life observations

Life Data Analysis now separates three observation contracts instead of using
a Weibull-only “grouped” switch:

- `individual`: one exact failure or right-censoring time per row;
- `frequency_exact`: a distinct exact time, failure/suspension state, and
  positive integer count per row; and
- `interval_censored`: a lower bound, upper bound, and positive integer count,
  where a missing lower bound is left censoring and a missing upper bound is
  right censoring.

For exact-frequency rows, the parametric log likelihood is

\[
\ell(\theta)=
\sum_{i\in\mathcal F} c_i\log f(t_i;\theta)
+\sum_{i\in\mathcal S} c_i\log S(t_i;\theta).
\]

This is algebraically identical to expanding each row `c_i` times, but the
implementation never expands the data. It supports all 13 LDA distribution
families. AICc and BIC use the effective sample size
\(n=\sum_i c_i\). Probability, Q-Q, and P-P points use count-aware midpoint
ranks; marker size and hover text preserve the counts. Anderson–Darling is
reported only for uncensored exact-frequency observations. Because this is a
likelihood contract, MLE is mandatory and rank-regression controls are disabled.

For inspection intervals, the log likelihood is

\[
\ell(\theta)=
\sum_{i\in\mathcal I}c_i\log\!\left[F(U_i;\theta)-F(L_i;\theta)\right]
+\sum_{i\in\mathcal L}c_i\log F(U_i;\theta)
+\sum_{i\in\mathcal R}c_i\log S(L_i;\theta).
\]

The CDF difference is evaluated in log space for numerical stability. No
interval midpoint is treated as an observed failure. Weibull 2P, Exponential
1P, Normal 2P, Lognormal 2P, Gamma 2P, Loglogistic 2P, Beta 2P, and Gumbel 2P
are enabled. Threshold/location variants are deliberately excluded because a
free threshold is weakly identified by grouped inspection intervals; Beta
bounds must lie in `[0, 1]`.

Interval data receive a Turnbull EM nonparametric maximum-likelihood estimate
as empirical CDF/SF context. Exact-time probability plots, Q-Q/P-P plots,
histograms, and Anderson–Darling statistics are withheld rather than generated
from invented midpoints. Parametric confidence intervals use the transformed
observed-information covariance from the grouped likelihood, and plotted
function bounds use its delta-method propagation.
