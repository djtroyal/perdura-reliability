# Repairable-system and maintenance calculation contract

## Recurrent-event data and the MCF

Mean Cumulative Function input never infers censoring from the largest event.
Use either event-time histories plus a separate observation end for every
system, or long-form records whose status is explicitly `event` or `censor`.
An event tied with a system's observation end is counted while that system is
still in the risk set.

For distinct event time \(t_j\), with \(Y_j\) systems still observed and
\(d_j\) events, the Nelson estimate is

\[
\widehat M(t)=\sum_{t_j\le t}\frac{d_j}{Y_j}.
\]

Per-system influence contributions are accumulated as

\[
\widehat\phi_i(t)=\sum_{t_j\le t}
\frac{dN_i(t_j)-Y_i(t_j)d_j/Y_j}{Y_j},
\]

and the subject-cluster robust variance is

\[
\widehat{\operatorname{Var}}\{\widehat M(t)\}
=\frac{n}{n-1}\sum_i\widehat\phi_i(t)^2.
\]

With complete equal follow-up, this reduces to the sample variance of the
systems' cumulative counts divided by \(n\), which is an automated reference
test. Pointwise log-transformed intervals are the fast default. A cluster
bootstrap that resamples complete system histories is also available and
requires at least 50 replicates. Selecting bootstrap intervals without those
replicates fails closed instead of silently returning log-transformed bounds.
At each event time, percentile bounds are reported only when every requested
cluster resample retains an observable risk set there. Dropping unsupported
resamples would condition on survival of the risk set and change the bootstrap
target, so such points are explicitly withheld pending a positive-weight or
multiplier-bootstrap implementation.
At least two independent systems are required to estimate between-system
variance; for one history, the point estimate remains available but variance
and confidence bounds are explicitly unavailable. Every result exposes the
effective risk count; sparse right-tail points are flagged.
The formulation follows Nelson's repair-data MCF and the robust recurrent-event
variance approach of Lawless and Nadeau ([DOI 10.1080/00401706.1995.10484300](https://doi.org/10.1080/00401706.1995.10484300)).

For multiple systems sharing a power-law MCF but having unequal observation
ends \(T_k\), the pooled parametric fit uses the recurrent-event likelihood,
not a regression on the non-parametric MCF. With \(N\) total events at times
\(t_i\), its profiled shape equation is

\[
\frac{N}{\beta}+\sum_i\log t_i
-N\frac{\sum_k T_k^\beta\log T_k}{\sum_k T_k^\beta}=0,
\qquad
\widehat\Lambda=\frac{N}{\sum_k T_k^{\widehat\beta}}.
\]

The reported confidence level drives profile-likelihood intervals for
\(\beta\) and for the MCF at the largest observed system age; these intervals
jointly profile the nuisance scale and are labeled asymptotic. Scale and
\(\alpha=\Lambda^{-1/\beta}\) intervals are explicitly marked not computed,
rather than implying that the confidence level applies to them.

## Growth-model regime

### Crow-AMSAA model and data contract

Crow-AMSAA is the power-law non-homogeneous Poisson process (NHPP)

\[
\Theta(t)=\operatorname{E}\{N(t)\}=\Lambda t^\beta,
\qquad
\rho(t)=\frac{d\Theta(t)}{dt}=\Lambda\beta t^{\beta-1}.
\]

Its instantaneous and cumulative-average MTBF functions are, respectively,

\[
m_i(t)=\rho(t)^{-1},
\qquad
m_c(t)=\frac{t}{\Theta(t)}
      =\left(\Lambda t^{\beta-1}\right)^{-1}.
\]

Thus \(\beta<1\) is decreasing intensity (growth), \(\beta=1\) is a
homogeneous Poisson process, and \(\beta>1\) is increasing intensity
(deterioration). These are recurrence-process quantities, not a lifetime
hazard fitted to independent components. Perdura therefore does not import
ordinary Life Data Analysis failure ages into Crow-AMSAA. Exact input must be
one accumulated repairable-system event history. For multiple systems with
separate age clocks or unequal observation ends, use the pooled parametric MCF
likelihood with explicit per-system ends; do not concatenate independent ages
or reinterpret independent component lifetimes as recurrences.

Termination is explicit because it is a sampling-design property. A
time-terminated test stops at a fixed \(T\); a failure-terminated test stops at
the final recurrence \(T=t_n\). Equality between a supplied \(T\) and the last
event is not used to guess the design. Rounded tied events are retained, but a
warning explains that exact ties have probability zero in an ideal
continuous-time NHPP and may affect goodness-of-fit.

### Exact-event estimation

For \(n\) exact cumulative event times, define

\[
S=\sum_i\log(T/t_i),
\]

where the final zero term may be included when \(T=t_n\). The raw maximum
likelihood estimates are

\[
\widehat\beta_{\mathrm{MLE}}=\frac{n}{S},
\qquad
\widehat\Lambda_{\mathrm{MLE}}
  =\frac{n}{T^{\widehat\beta_{\mathrm{MLE}}}}.
\]

Perdura also exposes a small-sample bias-corrected, or modified, estimate:

\[
\widetilde\beta=
\begin{cases}
(n-1)/S, & \text{time terminated},\\
(n-2)/S, & \text{failure terminated},
\end{cases}
\qquad
\widetilde\Lambda=\frac{n}{T^{\widetilde\beta}}.
\]

The user selects which parameter set drives curves and endpoint metrics; both
sets remain visible. The raw set is the likelihood maximizer. The modified set
reduces shape bias and is unavailable when the failure count is too small for
its correction. The shape used by the goodness-of-fit statistic is prescribed
by that test and is independent of this display selection.

The finite-sample pivots below are constructed from the raw likelihood
statistics. Selecting the modified estimate does not recenter or otherwise
alter those confidence sets. Perdura therefore reports both the selected point
estimate and the raw-MLE interval-reference estimate and basis; this prevents a
modified point from being mistaken for the statistic used by an exact pivot.

The exact chi-square shape pivot differs by termination design:

\[
2\beta S\sim
\begin{cases}
\chi^2_{2n}, & \text{time terminated},\\
\chi^2_{2(n-1)}, & \text{failure terminated}.
\end{cases}
\]

Every returned interval names its construction. In particular, Perdura does
not create an instantaneous-MTBF interval by dividing a count interval by a
plug-in shape estimate. For a time-terminated test, Perdura implements Crow's
finite-sample construction. Define

\[
H(x\mid k)=\frac{1}{I_1(x)}
\sum_{j=1}^{k}
\frac{x^{2j-1}}{2^{2j-1}(j-1)!j!},
\]

where \(I_1\) is the modified Bessel function. With
\(a=(1-\gamma)/2\), solve

\[
H(x_L\mid n)=a,
\qquad
H(x_U\mid n-1)=1-a,
\]

and form

\[
L_{n,\gamma}=\frac{4n^2}{x_L^2},
\qquad
U_{n,\gamma}=\frac{4n^2}{x_U^2}.
\]

The current-MTBF interval is
\([L_{n,\gamma}\widehat m_{\rm MLE}(T),
U_{n,\gamma}\widehat m_{\rm MLE}(T)]\). The \(n\) versus \(n-1\)
indexing is essential and reproduces the published Crow/NASA tables; for
example, \(n=23\) and 80% confidence gives factors 0.6762 and 1.5744. The
interval is labeled exact/conservative because the Poisson event count is
discrete. Seeded calibration varies both that count and the event times.
The coefficient implementation is independently checked against Tables 1A–1C
of [NASA TM-103511](https://ntrs.nasa.gov/api/citations/19900018782/downloads/19900018782.pdf),
which reproduce and extend the Crow time-terminated tables.

The 27-event individual-time numeric fixture (β=0.716339 and
Λ=0.453842) is sourced to MIL-HDBK-189 (13 February 1981), Appendix C.
It is not presented as a reproduction of MIL-HDBK-189C 6.2.2.9. That later
section says its example has 45 failures and publishes 45-event results, while
its printed Table VI contains only the same 27 times. The missing 18 event
times make the stated 189C result independently unreproducible from the table;
189C remains the formula authority, and the validation artifact records this
source discrepancy explicitly.

For a one-sided lower current-MTBF confidence bound at confidence
\(\gamma\), Perdura solves \(H(x\mid n)=1-\gamma\) directly and multiplies
the raw-MLE current MTBF by \(4n^2/x^2\). A 90% one-sided lower bound therefore
equals the lower endpoint of an 80% two-sided interval, but is stored and
labeled with its actual one-sided confidence semantics.

For a failure-terminated test, Perdura uses an exact finite-sample pivot. If

\[
Y=\Lambda T^\beta\sim\operatorname{Gamma}(n,1),\qquad
V=\beta\sum_i\log(T/t_i)\sim\operatorname{Gamma}(n-1,1),
\]

then \(Y\) and \(V\) are independent and

\[
\frac{m(T)}{\widehat m_{\mathrm{MLE}}(T)}=\frac{n^2}{YV}.
\]

Perdura evaluates the product-Gamma quantiles with generalized
Gauss-Laguerre quadrature and a probability-integral-transform quadrature
fallback at large shape parameters. The beta pivot above and this
failure-terminated current-MTBF pivot are exact under the stated NHPP and
stopping assumptions; “exact” describes the finite-sample pivot, whose
quantiles are evaluated numerically.
The failure-terminated one-sided lower bound uses the
\((1-\gamma)\)-quantile of \(n^2/(YV)\) directly.

### Grouped interval counts

Grouped input supplies endpoints \(0=e_0<e_1<\cdots<e_K=T\) and counts
\(f_j\) observed in \((e_{j-1},e_j]\). The independent interval means are

\[
\mu_j=\Lambda\left(e_j^\beta-e_{j-1}^\beta\right),
\]

and Perdura maximizes the grouped Poisson log likelihood

\[
\ell(\Lambda,\beta)
=\sum_{j=1}^K\{f_j\log\mu_j-\mu_j-\log(f_j!)\}.
\]

The nonlinear profile equation for \(\beta\) is solved numerically; grouped
data are always time terminated and currently use the likelihood estimator.
At the end of the test, the instantaneous quantities remain \(\rho(T)\) and
\(1/\rho(T)\). The fitted average intensity and MTBF for the final interval are

\[
\bar\rho_K=
\frac{\widehat\Lambda(T^{\widehat\beta}
  -e_{K-1}^{\widehat\beta})}{T-e_{K-1}},
\qquad
\bar m_K=\bar\rho_K^{-1}.
\]

These interval averages are reported separately and must not be described as
instantaneous endpoint intensity or MTBF.

For the primary final-interval uncertainty result, let
\(\theta=\mu_K\) be the expected final-bin failure count and define

\[
\Lambda(\theta,\beta)
=\frac{\theta}{T^\beta-e_{K-1}^\beta}.
\]

Perdura profiles the full grouped Poisson likelihood over \(\beta\) for each
fixed \(\theta\). If
\(\ell_p(\theta)=\max_\beta
\ell\{\Lambda(\theta,\beta),\beta\}), the target-profile confidence set is

\[
2\{\ell_p(\widehat\theta)-\ell_p(\theta)\}
\le \chi^2_{1,\gamma}.
\]

Its endpoints are transformed monotonically to
\(\bar\rho_K=\theta/(T-e_{K-1})\) and
\(\bar m_K=(T-e_{K-1})/\theta\). This is an asymptotic one-degree-of-freedom
profile-likelihood interval for the stated final-bin target, and is the primary
grouped final-interval result.

MIL-HDBK-189C 6.2.3.1.2 applies the same Crow coefficients to the final-group
average MTBF. For the contiguous handbook design, Perdura therefore reports

\[
L_{F,\gamma}\widehat M_K
\le M_K \le
U_{F,\gamma}\widehat M_K,
\]

where \(F\) is the total grouped failure count. This grouped-data use is
explicitly labeled approximate, as it is in the handbook. It is withheld for
the extended gapped-exposure input because that design is outside the stated
handbook construction. The separate endpoint instantaneous band remains a
beta-profile diagnostic and is not substituted for the final-group interval.
Its one-sided lower form uses the direct \(H(x\mid F)=1-\gamma\) coefficient
and retains the same approximate label. Seeded calibration evaluates the
handbook approximation and the target-profile alternative separately because
the approximation's coverage varies with shape and sparse final-bin counts;
the validation gate does not promote it to an exact claim.

### Model checks and projections

For exact events, Cramér-von Mises goodness-of-fit uses the prescribed
bias-corrected transformed times and published MIL-HDBK-189 critical values.
The separate power-law trend test uses
\(Q=2\sum_i\log(T/t_i)\) with \(2n\) degrees of freedom for time termination
or \(2(n-1)\) for failure termination under the homogeneous-Poisson null. Its
improving and worsening one-sided p-values are respectively the upper and
lower chi-square tails. The reported test direction follows the smaller of
those two tails; it is not inferred from the selected raw or modified point
estimate, which may disagree in weak small-sample cases.
For grouped counts, Pearson chi-square compares observed with expected
interval counts; adjacent intervals may be pooled to meet the expected-count
rule. A result is stated as “reject” or “fail to reject.” Failure to reject is
not evidence that the power-law NHPP is true, and no pass/verified badge is
derived from it. The observed cumulative process and unconnected observed
interval intensities are plotted against fitted cumulative, interval-average,
and instantaneous curves to reveal phase changes or local lack of fit.

Optional continuation results condition on the fitted parameter set. The
future count increment over \((T,T+h]\) is Poisson with mean

\[
\widehat\Lambda\{(T+h)^{\widehat\beta}-T^{\widehat\beta}\}.
\]

Future-event quantiles use the corresponding gamma increment on the transformed
NHPP scale. These projections include future process variation but hold
\((\Lambda,\beta)\) fixed: parameter uncertainty, future corrective actions,
and phase changes are not included.

The implementation follows the individual-time and grouped-data RGTMC
formulations in [MIL-HDBK-189C](https://www.dote.osd.mil/Portals/97/docs/TEMPGuide/MIL-HDBK-189C.pdf).

### Duane output

Duane remains a descriptive log-log regression. Its instantaneous MTBF
transformation divides cumulative MTBF by \(1-\alpha\), so Perdura reports it
only in the intended growth regime \(0\le\alpha<1\). Outside that range, the
cumulative fit remains visible but instantaneous MTBF is withheld and the
result recommends Crow-AMSAA plus a deterioration/change-point investigation.

## Imperfect maintenance

The virtual-age endpoint is a finite-calendar-horizon Monte Carlo model using
Kijima Type II. If \(v^-\) is virtual age immediately before maintenance,

\[
v^+ = qv^-,\qquad 0\le q\le1,
\]

where \(q=0\) is perfect renewal and \(q=1\) is minimal repair. Corrective and
preventive actions can use different \(q\), cost, and downtime. Failure times
are sampled conditionally from the supplied Weibull baseline; downtime
suspends aging. Counts, cost, downtime, availability, and cumulative failures
include Monte Carlo intervals. This is Kijima's Model II definition from
[Some results for repairable systems with general repair](https://doi.org/10.2307/3214319).

The older policy optimizer remains a long-run renewal/reward calculation, and
the cost forecast remains a projection of that long-run rate over a requested
horizon. Their responses now state this explicitly and direct imperfect or
transient questions to virtual-age simulation.

## Spares demand and replenishment

Three scopes are intentionally distinct:

1. Poisson: independent constant-rate period demand, with no returns.
2. Negative binomial: overdispersed aggregate period demand, with variance
   \(\mu+\mu^2/k\), still without returns.
3. Renewal pipeline: finite-horizon simulation of exponential or Weibull
   renewal demand, lognormal/fixed replenishment turnaround, and optional
   compound-Poisson common shocks.

The simulated stock requirement is the target quantile of maximum concurrent
outstanding demand. The protection curve carries Wilson simulation bands, and
the discrete required-stock quantile carries a Monte Carlo bootstrap interval.
This is an inventory-risk model, not a full repair-shop queue: capacity limits,
priority classes, condemnation yield, cannibalization, and multi-echelon
logistics remain outside its scope.
