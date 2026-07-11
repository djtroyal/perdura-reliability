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
bootstrap that resamples complete system histories is also available. Every
result exposes the effective risk count; sparse right-tail points are flagged.
The formulation follows Nelson's repair-data MCF and the robust recurrent-event
variance approach of Lawless and Nadeau ([DOI 10.1080/00401706.1995.10484300](https://doi.org/10.1080/00401706.1995.10484300)).

## Growth-model regime

Crow-AMSAA remains the likelihood-based NHPP growth model. Duane is a graphical
log-log regression. Its instantaneous MTBF transformation divides cumulative
MTBF by \(1-\alpha\), so Perdura reports it only in the intended growth regime
\(0\le\alpha<1\). Outside that range, the cumulative fit remains visible but
instantaneous MTBF is withheld and the result recommends Crow-AMSAA plus a
deterioration/change-point investigation.

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
