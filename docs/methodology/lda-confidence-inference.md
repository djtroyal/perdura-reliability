# Life-data confidence inference

## Purpose and reporting policy

Life-data estimates, parameter intervals, and distribution-function bands are
different statistical objects. Perdura reports the estimator, observation
design, method, scope, assumptions, and availability of each uncertainty
result. A pointwise interval at one time is never described as a simultaneous
whole-curve band, and a Bayesian credible interval is never relabeled as a
frequentist confidence interval.

The application uses this priority order:

1. finite-sample pivotal inference when a supported exact design applies;
2. an on-demand estimator-matched profile or refitted bootstrap package for
   regular models;
3. observed-information Wald/delta results only as an explicitly selected
   quick approximation; and
4. no numerical interval when the implemented theory does not justify one.

The machine-readable policy is
[`tools/lda_confidence_inventory.json`](../../tools/lda_confidence_inventory.json).
It covers every standard fitter plus grouped, special, nonparametric, Turnbull,
and Weibayes paths. A structural test fails if a standard fitter is added
without an inventory decision.

## Exact complete-sample Normal and Lognormal inference

For independent \(X_i\sim N(\mu,\sigma^2)\), let

\[
\bar X=\frac{1}{n}\sum_i X_i,\qquad
S^2=\frac{1}{n-1}\sum_i(X_i-\bar X)^2,\qquad \nu=n-1.
\]

The exact marginal intervals are

\[
\mu\in\bar X\pm t_{1-\alpha/2,\nu}\frac{S}{\sqrt n}
\]

and

\[
\sigma\in\left[
\sqrt{\frac{\nu S^2}{\chi^2_{1-\alpha/2,\nu}}},
\sqrt{\frac{\nu S^2}{\chi^2_{\alpha/2,\nu}}}
\right].
\]

At a fixed \(x\), the statistic

\[
T_x=\frac{\sqrt n(\bar X-x)}{S}
\]

has a noncentral-\(t\) distribution with noncentrality
\(\delta=\sqrt n(\mu-x)/\sigma\). Perdura numerically inverts that CDF for an
exact pointwise interval on \(\delta\), then maps the endpoints through
\(\Phi(\delta/\sqrt n)\) to bound \(R(x)\). These bounds are pointwise, not
simultaneous.

For Lognormal-2P, the same calculations are applied to \(Y_i=\log X_i\).
Exact-frequency grouped observations use their positive integer counts as
replication weights and produce the same result as expanded data. Censoring,
rank regression, and three-parameter thresholds do not use these pivots.

## Exact Exponential inference

Exponential-1P and Exponential-2P use finite-sample chi-square and
support-location pivots for complete and conventional Type-II samples. The
result includes exact marginal parameter intervals and a simultaneous
CDF/survival band. Arbitrary right censoring and interval censoring fail closed
for this exact path. The derivation and design classifier are documented in
[Exact Exponential Confidence Inference](exponential-exact-inference.md).

## Regular maximum-likelihood models

For a regular interior maximum-likelihood fit with parameter vector
\(\widehat\theta\), the quick covariance approximation is

\[
\widehat{\operatorname{Cov}}(\widehat\theta)
=\left[-\frac{\partial^2\ell(\theta)}
{\partial\theta\,\partial\theta^\mathsf T}
\bigg|_{\widehat\theta}\right]^{-1}.
\]

Positive parameters are differentiated in log coordinates. Perdura accepts
the covariance only when the transformed observed-information matrix is
finite, symmetric positive definite, invertible, and has condition number no
greater than \(10^{10}\). Invalid Hessians are not repaired by taking absolute
eigenvalues, clipping negative variances, or silently substituting zeros.

For a scalar function \(g(\theta)\), the quick pointwise approximation is

\[
\operatorname{Var}\{g(\widehat\theta)\}\approx
\nabla g(\widehat\theta)^\mathsf T
\widehat{\operatorname{Cov}}(\widehat\theta)
\nabla g(\widehat\theta).
\]

Adaptive one-sided numerical derivatives are used when a central difference
would cross a parameter boundary. Reliability endpoints are transformed on a
bounded scale and positive life quantities on a log scale. The interface
labels these results `quick_observed_fisher_wald` and
`quick_transformed_pointwise_delta`, hides them by default, and requires the
user to reveal them.

## Profile likelihood and matched refitting

For regular MLE models, a scalar profile interval contains values \(q\) for
which

\[
2\{\ell(\widehat\theta)-\ell(\widehat\theta_q)\}
\le \chi^2_{1,C},
\]

where \(\widehat\theta_q\) maximizes the likelihood subject to
\(g(\theta)=q\). Parameter profiles and curve targets are evaluated from the
same fitted likelihood and reject incomplete endpoint searches.

The on-demand uncertainty package uses one shared refit stream for all plotted
times. MLE parameter endpoints use likelihood profiles; MLE curve bounds use
refitted percentile bootstrap values. RRX and RRY fits use the same rank
estimator in every bootstrap refit for both parameters and curves. A rank fit
is never assigned an MLE profile interval.

The default is 499 refits. A result requires at least 95% eligible refits.
Complete data are resampled from the fitted model. Censored studies reproduce a
declared fixed administrative time, planned per-unit schedule, conventional
Type-II rule, or independent parametric censoring model. When the design is
unknown, empirical censor-time resampling is labeled approximate rather than
calibrated. Seeds are derived deterministically from the analysis data, model,
estimator, confidence, and plotting grid unless supplied explicitly.

## Nonregular and weakly identified models

Unknown-location Weibull-3P, Lognormal-3P, Gamma-3P, and Loglogistic-3P models
change the support of the likelihood. Ordinary Wald, Wilks
\(\chi^2_1\)-profile, and plug-in percentile-bootstrap claims are therefore
withheld. Exponential-2P is handled only by its separate exact pivotal path.

Weibull mixtures, competing risks, and DSZI models can become unidentified
when components collapse, mixture weights or probabilities reach a boundary,
or multistart fits disagree. Automatic Wald intervals are removed. An
identifiable fit may request a full refitted bootstrap; an ineligible or
boundary fit retains diagnostics but no numerical interval.

This refusal is intentional. Returning narrow numbers from an indefinite or
ill-conditioned Hessian would disguise a failure of the inference assumptions.

## Grouped and nonparametric observations

Exact-frequency grouped likelihoods retain counts rather than expanding rows
in the API or replacing them with unweighted points. Complete Normal,
Lognormal, and Exponential cases use their exact pivots. Other regular grouped
MLE fits expose only opt-in observed-information/delta approximations.
Three-parameter grouped fits fail closed.

Interval-censored parametric fits use interval probabilities

\[
P(L_i<X_i\le U_i)=F(U_i)-F(L_i)
\]

in a numerically stable likelihood. Midpoints are used only as optimizer
starting values. Turnbull NPMLE uncertainty uses a multinomial bootstrap of
the observed inspection-interval patterns and returns pointwise percentile
bands after at least 95% successful refits.

Kaplan–Meier and Nelson–Aalen intervals are pointwise asymptotic results.
Metadata includes a sparse-tail warning and the minimum risk set so late-curve
precision is not inferred from the line alone.

## Weibayes

With fixed Weibull shape \(\beta\), the transformed exposure has an
exponential/Poisson form. Complete and conventional Type-II samples use the
exact conditional chi-square pivot with \(2r\) degrees of freedom. A
zero-failure sample yields a one-sided bound. Arbitrary right censoring retains
the point estimate but withholds the two-sided exact interval.

When \(\beta\) is assigned a prior and marginalized, the output is explicitly a
posterior credible interval. A beta-range envelope without an exact observation
design is labeled sensitivity analysis, not confidence.

## Validation

The validation matrix separates deterministic PR guards from empirical
coverage claims. Nightly and release cells report fit eligibility, interval
completion, conditional coverage, unconditional coverage, Monte Carlo Wilson
intervals, and software provenance. Planned confidence levels are 90%, 95%,
and 99%; required regimes include small samples, several censoring designs,
boundaries, weak identification, rank estimation, grouped observations, and
sparse nonparametric tails.

The current executable lifetime matrix is
[`tools/uncertainty_coverage_matrix.json`](../../tools/uncertainty_coverage_matrix.json).
Unsupported cells remain visible in the inventory rather than being omitted.

## References

- Meeker and Escobar, *Statistical Methods for Reliability Data*, Wiley,
  1998.
- Lawless, *Statistical Models and Methods for Lifetime Data*, second
  edition, Wiley, 2003.
- Self and Liang, “Asymptotic Properties of Maximum Likelihood Estimators and
  Likelihood Ratio Tests under Nonstandard Conditions,” *JASA* 82 (1987),
  605–610, <https://doi.org/10.1080/01621459.1987.10478472>.
- Andrews, “Inconsistency of the Bootstrap when a Parameter is on the Boundary
  of the Parameter Space,” *Econometrica* 68 (2000), 399–405,
  <https://doi.org/10.1111/1468-0262.00114>.
- Turnbull, “The Empirical Distribution Function with Arbitrarily Grouped,
  Censored and Truncated Data,” *JRSS B* 38 (1976), 290–295.
