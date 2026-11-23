# Diagram-connected system lifecycle methods

The **Lifecycle: renewal, state table and repairable simulation** action in the RBD and Fault Tree editors uses their current component/event identities and resolved adopted distributions. The Markov editor's **Build repairable redundancy** action generates ordinary editable Markov states and transitions. These additions address toolkit audit concepts 1–9, including 8a, without inferring an undocumented proprietary implementation.

## Guided exponential redundancy

`System_models.redundancy_model` builds explicit continuous-time Markov chains. Identical active m-of-n units use healthy-count states, downward rate `i λ`, and upward rate `min(n−i, crews) μ`. Unequal active rates use component bit masks (at most nine units) and an explicitly stated preemptive priority policy: lowest unit number has first access to repair. Identical builders allow at most 60 units. Zero rates are allowed, unreachable states are removed, and a model with no transitions is an absorbing model.

Shared standby pools retain the healthy count and switch condition. Up to m healthy units occupy active positions; others accrue the entered dormant hazard. Active failures that require a transfer either succeed or enter a switch-down state. All healthy units become dormant while the switch is down. Switch restoration uses a separate exponential resource, while unit repairs use the entered crew pool. Assignment of healthy units to positions is instantaneous.

The independent-transfer interpretation applies coverage P to every required transfer. Common initial readiness instead starts in a probability mixture of ready and latent-not-ready states. The latter latent condition is revealed on first demand; restoration produces a ready switch. Those are different models. For no repairs, zero dormant hazard, and `x=m λ t`, the independent reference is

`R(t) = exp(−x) Σ[k=0..n−m] P^k x^k/k!`.

Common readiness replaces every coefficient for k≥1 with P. Its P-once interpretation is not presented as an independent-per-transfer calculation. The corresponding no-repair mean is the sum of the coefficients divided by `m λ`. The active no-repair reference is a binomial survival tail with individual reliability `exp(−λt)` and mean `Σ[i=m..n] 1/(i λ)`. References are labelled separately from the generated repairable model.

Markov analysis carries the initial probability mixture through transient availability, first-passage reliability, and MTTF. A stationary cycle mean, when identifiable, remains `1 / stationary failure frequency`; it is not renamed MTTF. For a 1-of-2 active model with λ=.001 and μ=.01, first-passage MTTF is 6500, while the stationary cycle means are 6100 with one crew and 6050 with two crews.

An adopted constant rate can be selected as an explicit builder snapshot. Its source name and rate appear in the generated assumptions; subsequent source changes require rebuilding that snapshot. Ordinary transition source linking remains available on the resulting canvas.

## Static logic, state tables, and executable expressions

`System_renewal.SystemStructure` compiles RBD connectivity/voting into a BDD and delegates static FTA gate semantics to the existing `FaultTreeAdvanced` compiler. Repeated `component_key` or `eventKey` values denote one component, not independent copies. FTA failure variables are transformed into the same working-state convention as the RBD. Component lifetimes and repair policies are keyed by these identities.

The complete state table is capped at 4096 rows (12 binary components). State ID bit i corresponds to sorted `keys[i]`, with 1 meaning working. Overrides change the lifecycle success rule; they do not modify the original diagram. Changing the component set changes the bit interpretation. The UI retains editable rows but withholds probabilities and exports until edited rules are evaluated again. A positive-unateness check distinguishes coherent success rules from general Boolean occupancy rules.

The state CSV contains every component bit, success flag, and state probability. The Python export contains the actual BDD, SciPy distribution parameters, exposure scaling, and functions `R(t)`, `f(t)`, and `h(t)`. Here `f=−dR/dt` and `h=f/R` use analytic BDD differentiation and component densities. They describe first-failure density and hazard only for coherent initially-working systems with nonnegative lifetimes. For noncoherent logic, R is a point success probability and −R′ need not be a probability density. Raw normal/Gumbel state-probability exports retain their original support; they are not silently clipped or conditioned.

## Whole-system renewal and infinite-horizon means

All components start new, are independent except for repeated identity, and renew together. There are no within-cycle repairs. Let `U(T)=∫[0,T]R(t)dt` and `F(T)=1−R(T)`.

* Fixed scheduled renewal: a failed system waits until T; cycle duration is `T+d`.
* Failure-or-age renewal: renew at failure or age T; expected cycle duration is `U(T)+d`.

For either policy, expected operating time per failure is `U(T)/F(T)`, calendar time per failure is `cycle/F(T)`, failure frequency is `F(T)/cycle`, and availability is `U(T)/cycle`. Restoration downtime d is applied at every renewal. The restricted mean U(T) is reported separately from total `MTTF=∫[0,∞)R(t)dt`.

Integrals use scale-normalized adaptive quadrature. Infinite integration is repeated at a tighter tolerance and checked against numerical error estimates. A failed or inconsistent tail integration withholds MTTF and reports `unresolved_or_infinite`; it does not claim to have proved divergence. Numerical error estimates are not confidence intervals or rigorous tail bounds. Separate component CDF and SF weights preserve very small failure probabilities in renewal ratios. Density/hazard values that are nonfinite at an endpoint, or undefined because survival is zero, are left blank in curve/CSV output rather than replaced with finite values.

Coherent success, all-working initial success, and an unsuccessful all-failed state are required. A component exposure override scales lifetime age relative to the diagram mission time. Zero exposure produces no failures. Positive-support exponential, Weibull, lognormal, gamma, loglogistic, and scaled beta lives are supported. Real-support life models require an explicit positive-time conditioning choice in DES; the renewal workflow rejects them rather than applying an unstated initial-time policy.

## Repairable discrete-event simulation

`System_simulation.simulate_system` uses the actual static RBD/FTA success rule. It starts every component new and working. Independent service/lifetime draws use NumPy child seed streams, one per replication. Successful corrective service and PM renew the component perfectly. Unsuccessful corrective restoration places another corrective job in the queue. No sampled duration is clipped to zero.

The calendar model ages every working component during system downtime. The operating model pauses all working-component failure clocks while the system is unsuccessful. Repairs, supplies, and PM always use calendar time. PM is scheduled on a fixed calendar grid and is skipped when the component is already down. A deferred corrective job becomes eligible at the next PM visit. These clock policies are explicit and do not model standby activation, load sharing, or virtual-age repair.

Eligible jobs use nonpreemptive FIFO scheduling. A job reserves its entire concurrent crew demand for its service duration. A stock-blocked job does not prevent another eligible job from using spare capacity. A corrective job consumes a spare token at service start; one token arrives after its replenishment lead time. Lead zero replenishes immediately. Zero initial stock and no external deliveries prevent repair. PM does not consume spare tokens. The supply convention is a component-specific base-stock token model, not a general supply-chain inventory optimizer.

Simultaneous events are processed as supply arrivals, restorations, PM, failures, then dispatch. Component IDs determine stable order within a stage. The system's up/down transition is evaluated once per batch. Critical failures require an up-to-down batch and a successful system immediately before its failure stage; a PM-caused outage is not relabelled critical because another component fails at the same time. Outage counts include PM. The measurement interval is `[warmup,warmup+horizon)`; events exactly at the right endpoint are excluded, and its plotted value is the left limit.

Results are as-new or post-warmup **finite-horizon estimates**. Warmup alone does not establish stationarity. Availability, event counts, crew utilization and average waits use independent-replication Student-t mean intervals. Availability/utilization interval endpoints are bounded to [0,1]. Operating time per critical failure is a ratio of summed uptime to summed counts, with a paired-replication bootstrap interval when every bootstrap resample identifies the ratio. Zero observed critical failures does not establish an infinite mean. These intervals quantify Monte Carlo error, not lifetime-parameter uncertainty. Queue wait is the average of per-replication mean waits for jobs started in measurement, with zero for a replication without service starts.

The first replication's event log is bounded and exports separately. Requests allow 20–5000 replications, 64 components, and 0–64 crew capacity. A per-replication/total event budget fails explicitly without returning a partial point estimate. Dynamic FTA gates, mission-only beta-factor common cause, and unexpanded linked subsystem/transfer analyses fail clearly because their mission-point output does not define repair clocks. The existing dynamic FTA mission analysis remains available.

## Maintenance task reuse and provenance

Each simulation component can import an eligible corrective task from Maintenance Task Analysis. The import retains a positive fixed single-step duration, project-unit conversion from hours, one fully engaged qualified personnel role, catalog capacity, and concurrent headcount. Source task/revision/role data are recorded, and subsequent source changes block simulation until reimport. Jobs remain failure-triggered and use FIFO rather than task criticality priorities; imported task occurrence frequency and economic cost fields are explicitly outside this simulation's service definition.

The importer rejects multi-step precedence, conditional branches, PERT/triangular task duration uncertainty, multiple skills, partial engagement, shift calendars, planned personnel outages, additional tools/stock resources, multi-asset effects, and superseded tasks. Such tasks remain in Maintenance Task Analysis; none of those constraints is silently flattened. All imported jobs must share one qualified crew pool. Manual service distributions additionally support exponential, Weibull, lognormal, gamma, positively-conditioned normal, and deterministic durations.

Lifecycle settings/results persist inside their owning RBD/FTA folio. A shared semantic signature checks topology, identities, exposures, life parameters and current adopted source fingerprints. A separate canonical settings signature covers renewal/simulation policies, durations, resources, clocks, seed and replication settings; imported or programmatically edited settings cannot retain a current-result claim without recalculation. Recalculating after a source/settings change discards other historical outputs instead of restamping them as current. Source/task edits mark historical results in reports and dashboards. Delayed responses cannot overwrite a changed diagram, source or settings; closed/unmounted dialogs discard responses. JSON, CSV and Python downloads use the application artifact exporter and its assurance manifest. Reports navigate back to the owning analysis's lifecycle panel.

Verification is focused rather than a blanket certification: closed-form active/standby references; rare-event renewal; infinite-tail/refinement failures; repeated identity; FTA/RBD equivalence; deterministic PM/crew/spare/clock calendars; independent exponential finite-horizon occupation; mixture request boundaries; source/task freshness; and real browser workflows backed by Python handlers are covered in `tests/test_system_lifecycle.py`, `gui/backend/tests/test_system_tools_api.py`, and the frontend `systemLifecycle*` checks.
