# Exact Exponential Confidence Inference

## Purpose

Perdura uses finite-sample pivotal inference for the one- and two-parameter
exponential life models when the observations are either complete or produced
by conventional Type-II censoring. This replaces the observed-information
Wald approximation for these models and, for the shifted model, avoids applying
a Hessian method to a nonregular support-boundary parameter.

The implementation distinguishes:

- a marginal confidence interval for each parameter;
- a simultaneous confidence band for the entire CDF or survival curve; and
- a calibrated scalar interval for one selected reliability or life quantity.

Those are different inferential objects. The plotted exponential band is
explicitly labeled *simultaneous*.

## Observation-design classification

Let \(r\) be the number of failures and \(n\) the total number of units.

- A sample is **complete** when it has no suspensions.
- A sample is **Type II** when every surviving unit is suspended at the final
  observed failure time.
- Other right-censoring patterns, and inspection-interval observations, are
  outside this exact implementation.

The Type-II comparison uses a strict scale-aware floating-point tolerance.
Perdura does not silently replace an unavailable exact interval with a
Wald/delta or bootstrap interval. It reports the reason in the fit metadata and
beside the plot.

Exact-frequency grouped rows use their integer counts as replication weights;
the observations are not approximated by row midpoints. Repeated exact times
produce a warning because ties can indicate measurement rounding under a
continuous-time model.

## Exponential-1P

For

\[
R(t)=\exp(-\lambda t), \qquad \lambda>0,
\]

define total time on test

\[
T=\sum_{i=1}^{r}t_i+\sum_{j=1}^{n-r}c_j.
\]

The maximum-likelihood estimate is

\[
\widehat\lambda=\frac{r}{T}.
\]

For complete or Type-II data,

\[
2\lambda T\sim\chi^2_{2r}.
\]

The \(100C\%\) equal-tail interval is therefore

\[
\left[
\frac{\chi^2_{(1-C)/2,\,2r}}{2T},
\frac{\chi^2_{(1+C)/2,\,2r}}{2T}
\right].
\]

Because every point of \(R(t)\) is monotone in the same single parameter,
transforming the two rate endpoints gives a simultaneous \(100C\%\) band:

\[
R_L(t)=\exp(-\lambda_Ut),\qquad
R_U(t)=\exp(-\lambda_Lt).
\]

## Exponential-2P

For the shifted model

\[
R(t)=
\begin{cases}
1,&t\le\gamma,\\
\exp[-\lambda(t-\gamma)],&t>\gamma,
\end{cases}
\qquad \lambda>0,\quad\gamma\ge0,
\]

let

\[
m=t_{(1)},\qquad
E=\sum_{i=1}^{r}(t_i-m)+\sum_{j=1}^{n-r}(c_j-m).
\]

Under complete and conventional Type-II sampling, all \(c_j\ge m\). The
support-boundary MLE is

\[
\widehat\gamma=m,\qquad
\widehat\lambda=\frac{r}{E}.
\]

Perdura evaluates this solution directly. It does not move the threshold to an
artificial fraction below the first failure to make a numerical Hessian
available.

The independent pivots are

\[
B=2\lambda E\sim\chi^2_{2(r-1)}
\]

and

\[
A=2n\lambda(m-\gamma)\sim\chi^2_2.
\]

The exact marginal rate interval is

\[
\lambda\in
\left[
\frac{\chi^2_{(1-C)/2,\,2(r-1)}}{2E},
\frac{\chi^2_{(1+C)/2,\,2(r-1)}}{2E}
\right].
\]

With the nonnegative-threshold constraint, the exact support-bounded location
interval is

\[
\gamma\in
\left[
\max\left\{0,\,
m-\frac{E F_{C;\,2,\,2(r-1)}}{n(r-1)}
\right\},
m
\right].
\]

These are pivotal intervals, so Perdura leaves the standard-error cells blank
instead of displaying a Wald standard error.

## Simultaneous two-parameter curve band

For requested joint coverage \(C\), Perdura uses transparent equal product
allocation

\[
c=\sqrt C.
\]

It retains

\[
0\le A\le\chi^2_{c,2}
\]

and the central-\(c\) interval for \(B\). Independence gives the joint
parameter set exact coverage \(c^2=C\). This is an exact construction; it is
not presented as the minimum-area member of the possible exact confidence
sets.

Let \([\lambda_J^L,\lambda_J^U]\) be the rate projection of this set and define

\[
k=\frac{\chi^2_{c,2}}{2n},\qquad
\gamma_L(\lambda)=\max\left(0,m-\frac{k}{\lambda}\right).
\]

The upper survival envelope is

\[
R_U(t)=
\begin{cases}
1,&t\le m,\\
\exp[-\lambda_J^L(t-m)],&t>m.
\end{cases}
\]

The lower envelope is

\[
R_L(t)=
\exp\left[
-\max_{\lambda\in[\lambda_J^L,\lambda_J^U]}
\lambda\max\{t-\gamma_L(\lambda),0\}
\right].
\]

The maximization is piecewise linear. Perdura evaluates the two rate endpoints
and the single transition \(\lambda=k/m\), when that transition lies inside the
rate interval. It does not use a plotting-grid optimizer, so the result is
deterministic and independent of plot resolution. CDF bounds are the exact
complements:

\[
F_L(t)=1-R_U(t),\qquad F_U(t)=1-R_L(t).
\]

No corresponding exact PDF or hazard band is implied or displayed.

## Availability and reporting

At least two failures and positive adjusted exposure are required. Fit and plot
responses record:

- availability and unavailable-reason code;
- complete, Type-II, or unsupported design classification;
- parameter-specific methods;
- exact/approximate status and simultaneous/pointwise scope;
- assumptions and tie/rounding warnings.

The same metadata travels with exported results, plot snapshots, and Report
Builder assets through their normal serialized analysis payload.

## Verification

Automated tests cover closed-form reference calculations, MLE boundary
behavior, CDF/SF complementarity, confidence-level monotonicity, grouped-count
equivalence, unsupported censoring, deterministic tails, API serialization,
and seeded small-sample whole-curve coverage for complete and Type-II designs.

## References

- NIST/SEMATECH, [Constant repair rate (HPP/exponential)
  model](https://www.itl.nist.gov/div898/handbook/apr/section4/apr451.htm).
  This documents total-time-on-test exponential estimation and chi-square
  confidence inference; its fixed-time test formulas have a different
  censoring scope and should not be substituted for the complete/Type-II
  pivots above.
- A. J. Hayter, “Confidence Bands for the Reliability Function of a
  Two-Parameter Exponential Model,” *Journal of Quality Technology*, 44(2),
  155–160 (2012),
  [doi:10.1080/00224065.2012.11917890](https://doi.org/10.1080/00224065.2012.11917890).
  The paper establishes exact whole-curve confidence bands from exact
  two-parameter confidence sets for complete and Type-II censored samples.
