# System-reliability calculation contract

## Static fault trees

Perdura's static coherent fault-tree solver supports basic events, AND, OR,
K-of-N vote, repeated/mirrored events, and transfer gates. Exact probability is
computed from the minimal-cut-set Boolean function by memoized Shannon
decomposition (`reduced_bdd_shannon_dnf`). A configured state limit raises an
explicit error; it never changes an exact result into a bound or simulation.

PAND is disabled because occurrence order cannot be recovered from marginal
event probabilities. XOR and NOT are also disabled because the current
minimal-cut-set and importance workflow assumes a coherent monotone structure
function. Existing diagrams retain these nodes for editing, but analysis
returns a validation error instead of treating PAND as AND or collapsing
XOR/NOT subtrees into synthetic independent events.

## Beta-factor common cause

A basic event or RBD component can be assigned a common-cause group and a beta
factor. Every group is represented by independent latent member failures plus
one shared shock that fails all group members. For requested member marginal
failure probability \(q\),

\[
q_{\mathrm{CCF}} = \beta q,
\qquad
q_{\mathrm{ind}} = \frac{q-q_{\mathrm{CCF}}}{1-q_{\mathrm{CCF}}}.
\]

This probability-level parameterization preserves the requested marginal
exactly:

\[
q = 1-(1-q_{\mathrm{CCF}})(1-q_{\mathrm{ind}}).
\]

The beta-factor model requires at least two exchangeable group members with
equal marginal failure probabilities. The model includes one all-members
shock. It does not include partial-group multiplicities from MGL/alpha-factor
models, uncertainty in beta, repair, load sharing, or conditional environment
states. These limitations and the active dependency assumption are returned in
every FTA and RBD result.

The implementation follows the standard beta-factor interpretation in which
the common-cause contribution is the total failure measure multiplied by beta,
as described in the NRC's [NUREG-1150 common-cause analysis](https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr1150/v2/sr1150v2appc.pdf).

## Reliability block diagrams

RBD probability is evaluated directly from directed graph connectivity with a
reduced ordered binary decision diagram (`reduced_bdd_network_connectivity`).
Explicit path enumeration is used only to populate the bounded path-list display
and cannot truncate the reported probability. The exact engine currently
requires an acyclic directed RBD; feedback and repair loops belong in a Markov,
semi-Markov, or other state-space model.

Under beta-factor dependence, a component is available only when its latent
component-specific survival variable and its group's shared survival variable
are both true. Importance measures condition these latent variables, and
common-cause survival receives its own importance row.

## Monte Carlo intervals

Fault-tree simulation reports a two-sided Wilson score interval, not a Wald
interval. Wilson bounds remain non-degenerate when the observed top-event count
is zero or equals the number of trials. For zero observed events, the result
also includes the exact one-sided binomial upper bound

\[
p_U = 1-\alpha^{1/n},
\]

plus the raw simulation resolution \(1/n\). See the NIST/SEMATECH
[confidence intervals for a proportion](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
