# Markov and phase-type reliability models

## Model contract

Perdura's default state-space calculation is a finite, time-homogeneous
continuous-time Markov chain (CTMC). For public states \(i\ne j\), the entered
transition intensity is \(q_{ij}\), and the generator is

\[
Q_{ij}=q_{ij}, \qquad Q_{ii}=-\sum_{j\ne i}q_{ij}.
\]

Given a row-vector initial distribution \(p(0)\), transient state probabilities
are

\[
p(t)=p(0)\exp(Qt).
\]

This model assumes constant rates, mutually exclusive and exhaustive states,
and that the current state contains all information needed for future
evolution. The holding time in state \(i\) is exponential with total rate
\(q_i=\sum_{j\ne i}q_{ij}\), mean \(1/q_i\), and coefficient of variation one.
Thus, elapsed time already spent in the state does not change its departure
risk. The result panel states these assumptions rather than leaving them
implicit.

Self-transitions are rejected because they do not change the observed CTMC
state. If a nominal self-event changes aging, renewal, or risk, represent it as
a distinct state or use a model that explicitly includes that event history.

## Erlang phase-type dwell times

A public state can instead use an Erlang dwell model with integer shape
\(k\ge 2\). Perdura expands that state into \(k\) sequential hidden CTMC phases.
Each phase advances at rate \(kq_i\), and the last phase enters destination
\(j\) at rate \(kq_{ij}\). The public-state holding time is therefore

\[
T_i\sim\operatorname{Erlang}(k,kq_i),\qquad
E[T_i]=\frac{1}{q_i},\qquad
\operatorname{CV}(T_i)=\frac{1}{\sqrt{k}}.
\]

The construction preserves both the input mean holding time and embedded
destination probabilities \(q_{ij}/q_i\). It is solved exactly as a finite CTMC
over hidden phases, then phase probabilities are aggregated back to the public
states. Entering a public state always starts its clock at phase one.

The public input-rate matrix remains visible as a CTMC reference; a
non-memoryless process over only the public states has no single CTMC generator.
Perdura also returns the exponential CTMC baseline and overlays its transient
availability and reliability curves. Because the Erlang construction preserves
mean holding times and destination probabilities, many long-run mean metrics
can coincide even when mission-time curves differ materially.

This is a deliberately bounded phase-type option, not a general semi-Markov
solver. It does not cover dwell-time CV above one, arbitrary Weibull/lognormal
holding times, age-dependent destination probabilities, time-varying rates, or
dependence between state clocks. General semi-Markov processes are the broader
model family for those cases.

## Reliability, availability, and mean metrics

Instantaneous availability sums the probability of operational and degraded
states. Reliability instead makes all failed states absorbing and computes the
probability of avoiding first failure through time \(t\). Repairs therefore
affect availability but not reliability after the first failed-state entry.

When a unique stationary distribution exists, Perdura solves

\[
\pi Q=0,\qquad \sum_i\pi_i=1
\]

using an SVD null space and reports steady-state availability. Reducible chains
do not receive a spurious unique steady-state result. Failure frequency is the
stationary flow from up states to failed states. Mean cycle time (labelled MTBF),
mean up time (MUT), and MTTR are derived from that flow. MTTF is a first-passage
mean from the first up state and is not substituted for repairable-system MTBF.

## Transition-rate uncertainty

Each transition can be assigned an input coefficient of variation \(c\). For a
positive nominal rate \(q\), Perdura's optional Monte Carlo propagation samples
an independent, mean-preserving lognormal input:

\[
\sigma_{\log}^2=\log(1+c^2),\qquad
\mu_{\log}=\log(q)-\frac{\sigma_{\log}^2}{2}.
\]

The entered rate is therefore the sampling mean. Each draw reruns the selected
CTMC or phase-type model. Equal-tail quantiles are reported for steady-state
metrics and for availability and reliability at the final requested mission
time. A seed makes the calculation reproducible.

These are propagated parameter-uncertainty intervals conditional on the
entered CVs, lognormal family, and independence assumption. They are not
confidence or credible intervals inferred from transition-event data. Correlated
rates, interval-valued rates, posterior sampling, or data-based rate estimation
require a separately specified uncertainty model.

## Primary references

- Pyke, R. (1961), [Markov Renewal Processes: Definitions and Preliminary
  Properties](https://doi.org/10.1214/aoms/1177704863), *Annals of Mathematical
  Statistics* 32(4), 1231–1242. Defines Markov-renewal and semi-Markov processes.
- Hurtado, P. J. and Richards, C. (2021), [Building mean field ODE models using
  the generalized linear chain trick and Markov chain
  theory](https://doi.org/10.1080/17513758.2021.1912418), *Journal of Biological
  Dynamics* 15(sup1), S248–S272. Derives sequential Erlang and general
  phase-type representations from CTMC phases.
- Krak, T., De Bock, J., and Siebes, A. (2017), [Imprecise continuous-time
  Markov chains](https://doi.org/10.1016/j.ijar.2017.06.012), *International
  Journal of Approximate Reasoning* 88, 452–528. Develops CTMC analysis when
  exact transition-rate assessments are not warranted.
