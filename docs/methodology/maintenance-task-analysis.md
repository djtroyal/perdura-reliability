# Maintenance Task Analysis methodology

## Purpose and implementation status

Perdura Maintenance Task Analysis (MTA) turns maintenance and broader product-
support work into an auditable task inventory, detailed procedure model, and
resource-constrained portfolio forecast. The same schema supports corrective,
preventive, condition-based, inspection, servicing, operations, transport,
packaging, training, logistics, and disposal tasks.

The implementation is a **standards-informed native model**. Its principal
public basis is:

- MIL-HDBK-502B, *Product Support Analysis* (18 April 2025), especially
  Activities C.1.9 (task inventory) and D.1 (task analysis); and
- MIL-STD-3034A, *Reliability-Centered Maintenance (RCM) Process*, for
  task-selection applicability and effectiveness concepts.

MIL-HDBK-502B states that it is guidance and is not to be cited as a
requirement. Perdura therefore does not claim that its JSON/CSV records conform
to a controlled logistics-product-data exchange specification. LSA-018,
LSA-019, and LSA-020 names are useful cross-references for task inventory,
analysis, and narrative content—not an exchange-format conformance claim.

## Record model and traceability

An MTA project contains:

1. a task inventory;
2. reusable personnel/skill and resource catalogs;
3. a portfolio analysis configuration;
4. result and methodology records.

Each task records identity, revision, type, maintenance level, governance
status, criticality, source references, linked RCM decisions, occurrence
model, cost assumptions, hazards, environment, training, validation evidence,
and a conditional directed acyclic graph (DAG) of steps.

A Failure Rate Prediction part, system block, or system total can be published
as a traceable rate snapshot. The task retains the source analysis/entity,
standard, rate basis, represented quantity, link timestamp, and calculated
FPMH. Refresh is explicit: MTA does not silently replace an analyst-reviewed
task when Prediction changes.

Each step records an action verb, object, qualifiers, phase, predecessors,
duration model, execution probability, optional exclusive branch group,
interruptibility, personnel, resources/material, precautions, technical data,
and acceptance criteria. The wording structure follows the task-description
principle of using a clear action, object, and necessary qualifiers.

Governance progresses through:

`draft → reviewed → approved → demonstrated → superseded`

The software does not silently change governance status. A task may be
calculated while draft or reviewed, but the result carries a warning.

## Dependency and deterministic rollups

Task-step IDs must be unique within a task. Every predecessor must exist,
self-dependency is rejected, and a topological sort fails closed when a
directed cycle is present.

For step \(i\), with duration \(d_i\), predecessor set
\(\operatorname{pred}(i)\), earliest start \(ES_i\), and earliest finish
\(EF_i\):

\[
ES_i = \max_{j\in\operatorname{pred}(i)} EF_j,\qquad
EF_i = ES_i+d_i,
\]

where a root step has \(ES_i=0\). Unconstrained task elapsed time is the
critical-path result

\[
T_\text{task}=\max_i EF_i.
\]

Parallel steps can therefore increase labor without adding the same amount to
elapsed time.

For execution probability \(p_i\), role headcount \(n_{ir}\), and engagement
fraction \(e_{ir}\), expected active labor is

\[
H_\text{labor}=\sum_i d_i p_i \sum_r n_{ir}e_{ir}.
\]

Engagement is the fraction of the step duration for which the assigned role is
actively occupied. It prevents a long unattended wait from being treated as
continuous labor.

Per-event cost is separated into:

\[
C_\text{event} =
C_\text{labor}+C_\text{material}+C_\text{resource}
+C_\text{fixed}+C_\text{travel}+C_\text{downtime}.
\]

Labor cost applies each role's loaded hourly rate. Consumable/material cost
uses assigned quantity and the catalog unit cost (or an assignment override).
Renewable resource cost applies quantity, active duration, and the use rate.
Downtime cost applies task elapsed time, affected asset count, and the task
rate when the task takes the asset out of service.

## Duration uncertainty and conditional flow

A step can use:

- a fixed duration;
- a triangular distribution; or
- a beta-PERT distribution.

For optimistic \(a\), most-likely \(m\), and pessimistic \(b\), Perdura
requires \(0\le a\le m\le b\). The triangular mean is

\[
E[D]=\frac{a+m+b}{3}.
\]

The beta-PERT implementation uses shape parameters

\[
\alpha=1+4\frac{m-a}{b-a},\qquad
\beta=1+4\left(1-\frac{m-a}{b-a}\right),
\]

scaled to \([a,b]\), giving

\[
E[D]=\frac{a+4m+b}{6}.
\]

An ordinary conditional step executes independently with its configured
probability. Steps sharing a nonblank branch-group ID are mutually exclusive:
one member is sampled by cumulative probability and the group may select no
member if its probabilities sum to less than one. A group sum above one is
rejected.

Dependencies remain structural even when a predecessor branch is inactive.
The inactive step consumes zero time/resources, allowing downstream joins to
remain explicit and reviewable.

## Occurrence models

The task frequency model may be:

- manual occurrences per period;
- calendar interval;
- usage interval with annual operating hours;
- explicit event times;
- Poisson arrivals with per-asset-hour rate, population, and duty cycle; or
- Weibull/exponential renewal arrivals for each asset.

Failure Rate Prediction links use the Poisson model. The imported FPMH value
is converted by

\[
\lambda_{\mathrm{h}^{-1}}=\frac{\lambda_{\mathrm{FPMH}}}{10^6}.
\]

When Prediction supplies a service/calendar-hour rate, MTA fixes duty cycle to
one because operating and dormant exposure are already combined. Otherwise,
the imported operating-hour rate retains an explicit duty-cycle multiplier.
Part-group and block totals already include their represented quantities, so
the linked MTA occurrence population is one; multiplying by quantity again
would double-count failure demand. Selecting both a parent block and its
descendants likewise represents overlapping demand and is warned in the
import interface.

Early/late tolerances define arrival, due, and latest-completion times. A
manual fractional expected count is converted to an integer by randomized
rounding in each replication. An interval equal to zero produces no work; it
is not silently replaced with a default.

## Resource calendars

Personnel roles are renewable pools with qualified headcount and loaded labor
rate. A role can also declare bounded off-shift overtime capacity and a labor-
rate multiplier. Overtime is used only when the portfolio explicitly permits
it; planned outages still override that capacity. Tools, test equipment,
facilities, support equipment, and transport are
renewable capacity pools. Spares, repair parts, consumables, material, and PPE
are nonrenewable demand/cost items in the current scheduling model.

A renewable pool may define weekday/start/end shift rows. No shift rows means
continuous availability. A shift can reduce capacity below the catalog
capacity. Planned outages replace capacity over an absolute horizon interval.

The time grid has user-selected width \(\Delta t\). A duration is conservatively
rounded upward to an integer number of slots:

\[
n_i=\left\lceil\frac{d_i}{\Delta t}\right\rceil.
\]

Reducing \(\Delta t\) reduces discretization error but increases memory and run
time. Perdura rejects a portfolio above 200,000 time slots and caps generated
jobs and Monte Carlo replications. It also bounds the product of referenced
renewable pools and time slots before allocating calendar arrays.

Consumable quantity-on-hand and replenishment lead fields are retained in the
catalog for provisioning handoff and reporting. The current scheduler reports
demand and cost but does not simulate replenishment stock balance; use
Maintenance Spares for probabilistic stockout protection.

## Scheduling algorithm

Every replication:

1. generates task occurrences;
2. samples exclusive/ordinary conditional steps and uncertain durations;
3. releases each job at its arrival;
4. identifies steps whose predecessors are complete;
5. finds the earliest slot sequence satisfying personnel and renewable-
   resource capacity;
6. selects the next candidate by:
   - earliest feasible start,
   - descending criticality/priority,
   - earliest due time,
   - earliest arrival, then
   - stable job and step IDs;
7. reserves resources and repeats until all feasible work is scheduled.

An interruptible step may pause across unavailable shift slots. A
noninterruptible step requires consecutive feasible slots. Work is
non-preemptive: a later high-priority event does not displace work already
reserved.

This is a transparent bounded discrete-event/list-scheduling model. It is not
an optimizer and does not claim that the generated schedule is globally
minimum-cost or minimum-lateness.

## Portfolio outputs

Each replication reports:

- generated, completed, late, and backlog jobs;
- scheduled and unscheduled active steps;
- labor, material, renewable-resource, fixed, travel, downtime, and total cost;
- asset downtime burden;
- approximate asset availability, when population is supplied;
- personnel/resource utilization; and
- task-level event, labor, cost, lateness, backlog, and downtime metrics.

If population \(N\), horizon \(H\), and total affected asset-hours of downtime
\(D\) are available, the reported burden estimate is

\[
\widehat A = \max\left(0,\,1-\frac{D}{NH}\right).
\]

This is not a state-dependent availability model. Use RBD/FTA/Markov analysis
when system structure, degraded states, standby logic, or repair dependencies
must be modeled directly.

For Monte Carlo values \(X_1,\ldots,X_B\), Perdura reports the arithmetic mean
and equal-tail empirical interval:

\[
\left[
Q_{(1-c)/2}(X),\;Q_{1-(1-c)/2}(X)
\right].
\]

The interval describes simulation variation under fixed input assumptions. It
does not incorporate uncertainty in source failure-rate parameters, calendar
accuracy, cost estimates, or modeling choices unless the user represents that
uncertainty explicitly.

Disabling the Monte Carlo ensemble runs one reproducible seeded scheduling
scenario; it does not estimate an uncertainty interval. The separate
deterministic task rollup continues to use mean duration and probability-
weighted labor/cost for planning context.

## RCM guided recommendation

The Reliability Program RCM worksheet evaluates failure visibility,
consequence, age relationship, condition detectability, and declared task
applicability/effectiveness:

- hidden failures favor applicable/effective failure-finding; otherwise
  redesign/risk treatment is indicated;
- detectable potential-failure conditions favor on-condition work;
- age-related behavior supports scheduled restoration or discard;
- non-age-related operational/non-operational consequences can support
  run-to-failure;
- safety/environmental consequences without a supported proactive task
  indicate redesign.

The recommendation is guidance, not an autonomous maintenance decision.
Analysts can override it, but a rationale is required. Interval-directed work
requires an interval, and selected proactive work is incomplete until
applicability and effectiveness are declared.

Publishing RCM work into MTA creates a revision-linked draft task. It does not
create a live hidden dependency.

## Reproducibility and reporting

A successful result contains:

- a canonical SHA-256 digest of the complete task, catalog, and portfolio
  input snapshot;
- method title and implementation status;
- method version;
- standards basis;
- scheduler and uncertainty description;
- assumptions and warnings;
- simulation count, confidence, and seed; and
- a canonical SHA-256 digest of the result.

MTA tables and plots are available as Report Builder assets and can be
bookmarked or snapshotted using the standard Perdura result controls.

## Verification matrix

Automated tests cover:

- serial and parallel critical-path rollups;
- labor, material, renewable-resource, fixed-event, travel, downtime, and
  total-cost uncertainty-interval reconciliation;
- missing/duplicate IDs and cyclic dependencies;
- seeded beta-PERT reproducibility and nonzero interval width;
- resource contention and serialized completion;
- repeated pool-assignment aggregation and planned-outage enforcement;
- Failure Rate Prediction FPMH conversion, calendar-rate normalization, and
  explicit override preservation;
- controlled vocabulary/API contracts;
- RCM guided recommendations and override-rationale findings; and
- deterministic result hashing.

Future extensions should add named-person roster constraints, richer overtime
and fatigue policies, multi-echelon travel/logistics queues, dependent uncertainties,
inventory/replenishment state inside the portfolio scheduler, schedule
optimization alternatives, and direct controlled-exchange adapters when
licensed schemas and validation fixtures are available.

## References

- U.S. Department of Defense, **MIL-HDBK-502B, Product Support Analysis**,
  18 April 2025. Public handbook; guidance only.
  <https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=201462>
- U.S. Department of Defense, **MIL-STD-3034A, Reliability-Centered
  Maintenance (RCM) Process**, 29 April 2014; Notice 2 validation,
  27 March 2024.
  <https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=277649>
