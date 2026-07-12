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
