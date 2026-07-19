# System-reliability calculation contract

## Fault-tree model contract

Perdura models nonrepairable mission failure. Repair, restoration, queues, and
steady-state availability belong in Markov Analysis. A fault-tree connection
runs from a gate output to an input. Its `order` and `role` are persisted model
data: canvas position is never used to infer PAND order, the FDEP trigger, an
INHIBIT condition, or a SPARE primary.

Display labels are not event identities. A repeated event exists only when two
nodes carry the same explicit event key, or when a transfer uses shared-reference
mode. This avoids accidental dependence when two engineers happen to use the
same description.

The supported event vocabulary is basic, undeveloped, house, conditioning, and
external events. The gate vocabulary is:

- coherent static logic: AND, OR, K-of-N, and INHIBIT;
- general static logic: cardinality L..H, XOR, NOT, NAND, NOR, IFF, and IMPLY;
- dynamic logic: PAND, POR, and cold/warm/hot SPARE;
- dynamic constraints: FDEP and SEQ; and
- structural transfer/reference nodes.

Validation enforces one causal root, acyclicity, arity, integer vote/cardinality
limits, role counts, repeated-event source consistency, dynamic input types,
spare bounds, and time-model completeness before calculation begins.

## Diagram notation and node documentation

The canvas uses conventional top-down fault-tree silhouettes: a circle for a
basic event, diamond for an undeveloped event, ellipse for a conditioning
event, house outline for a house/external event, domed AND profile, curved
pointed OR profile, added input arc for XOR, output bubble for inverted logic,
hexagonal INHIBIT, and triangular transfer symbol. Voting and priority gates
retain their base AND/OR silhouette and carry the threshold or priority label.
These conventions follow the event and gate families in the NRC *Fault Tree
Handbook* and IEC 61025.

Top and intermediate event boxes are not separate model types. A one-input OR
provides the same pass-through Boolean behavior without a redundant construct.
The canvas recognizes topology and changes only the glyph: a root one-input OR
uses the rectangular top-event shape, while a one-input OR that has a parent
uses the same conventional intermediate-event shape. No role subtitle is added.
OR gates with multiple inputs retain the curved OR glyph. This recognition is
presentation metadata and does not alter the saved Boolean model.

Dynamic and extended Boolean constructs do not all have one universally
adopted fault-tree glyph. Perdura therefore uses a distinct named symbol for
SPARE, FDEP, SEQ, IFF, and IMPLY rather than implying that an application-
specific icon is standardized. Input order and role badges remain part of the
diagram because the silhouette alone cannot encode their full semantics.

`Label / ID` is the primary diagram caption. `Description` is a secondary
diagram caption: explicit line breaks are preserved, wrapping is enabled, and
the font steps down as the estimated line count grows. `Extended Description`
stores engineering rationale, assumptions, references, or other detailed notes
with the node but is intentionally omitted from the diagram.

The left Node Library is a single-column catalog. Common contains Basic,
Undeveloped, House, AND, OR, and K-of-N; all remaining types follow in labeled,
always-visible groups rather than nested menus. A separate collapsed Library
section lists other FTA analyses in the project and adds one as a configured
shared Transfer gate. The Transfer Properties toggle can replace its triangle
with a non-editable, anchored view of the complete referenced analysis and can
collapse it back without copying or changing either model. Existing nodes are edited in the right Properties pane,
including a guarded type conversion. Converting a gate to an event removes
incompatible child connections only after confirmation; gate-to-gate
conversions preserve children and re-establish their semantic roles.

New palette nodes, project-library transfers, standalone annotations, pasted
groups, and mirrored events are inserted within the currently visible canvas.
Placement anticipates the Properties pane opening and applies a small screen-
space stagger to consecutive additions so they remain visible without landing
exactly on one another.

For evaluation, connections are stored from a gate to each input. The canvas
places the arrowhead at the stored source so the visual direction reads from an
initiating event toward its gate and ultimately the top event. Orthogonal,
curved, and straight styles change presentation only. Snap uses the same
20-unit spacing shown by the optional dot grid. Auto Layout assigns
longest-path levels, performs alternating barycentric crossing-reduction
sweeps, and reserves vertical routing channels using measured or
description-aware node sizes. For each direct input group, an odd count places
the middle input on the parent centerline; an even count centers the parent over
the gap between the two middle inputs. It never infers or changes semantic input order.
Copy, Cut, Paste, and repeated-event Mirror operate on nodes without copying
external connections, while multi-node Copy/Cut retains connections whose two
endpoints are selected. Pasted events receive independent event identities and
pasted gates receive fresh type-specific identifiers such as `AND-1`, `OR-1`,
`PAND-1`, or `XFER-1`. Gate IDs are shown separately from descriptive labels;
their prefix identifies the gate type. Project history remains owned by Perdura's
global Undo/Redo controls.

Mirroring an event creates another diagram occurrence with the same event key;
it does not create an independent probability variable. Every occurrence shows
the total shared occurrence count, shares probability/time-model and dependency
edits, and highlights with its siblings. `Detach this occurrence` changes only
the selected occurrence to a fresh event identity. If the detached node owned
the former shared key, the remaining siblings are rekeyed together so their
dependence is preserved. This distinction prevents visually repeated equipment
from being treated as false redundancy.

The Node Library's minus/plus controls step the diagram through five label and
spacing levels: Dense, Compact, Comfortable, Spacious, and Expanded. Each step
changes node width, typography, wrapping estimates, and Auto Layout spacing as
one coordinated presentation setting. Event/gate ID visibility is likewise a
presentation option. Gate IDs are assigned automatically, remain read-only,
and use a fixed prefix that identifies the gate type.
Free-text notes and targeted callouts are persisted with the analysis but are
excluded from graph validation and probability calculations; their leader
lines dynamically select the nearest opposing sides of the callout and the
referenced node's label card as either item moves. They are diagram annotations,
not logical connections. Annotation shape, color, and fill opacity are
presentation properties; a callout leader inherits its annotation color and
opacity. Selecting an annotation exposes free horizontal and vertical resize
handles; its stored dimensions are included in project persistence and diagram
exports.

## Static ROBDD evaluation

Every static tree—coherent or non-coherent—is compiled into one reduced ordered
binary decision diagram (ROBDD). Shannon reduction preserves repeated events,
overlapping paths, complement logic, and common latent causes without assuming
independence between gate inputs. Terminal probability recursion is

\[
P(v)=(1-q_i)P(v_{low})+q_iP(v_{high}).
\]

The reported exact top-event probability and every node probability come from
that representation. A configured BDD node limit raises an explicit error; it
never changes an exact result into a bound or simulation.

For a coherent structure, positive ROBDD paths are absorbed into true minimal
cut sets. For a non-coherent structure, Perdura instead reports disjoint ROBDD
failure conditions with both required-failed and required-successful literals. Calling
the latter “cut sets” would discard necessary complement conditions.

Signed Birnbaum importance is \(P(TOP\mid X_i=1)-P(TOP\mid X_i=0)\).
Fussell–Vesely is withheld for non-coherent trees; RAW and RRW are shown with an
explicit non-coherent interpretation warning. Rare-event sums and min-cut upper
bounds are supplementary coherent-tree comparisons, never the exact engine.

## Dynamic event-time evaluation

A dynamic tree requires a time-to-failure model for every stochastic event.
A point probability at one mission time contains no occurrence order. Perdura
offers an explicit, user-initiated constant-hazard conversion

\[
\lambda=-\frac{\ln(1-p_t)}{t},
\]

and records the assumption; conversion is never automatic.

An event-level exposure override \(\tau_i\) is interpreted as effective event
age at the global mission time \(T\). The calendar clock is scaled linearly by
\(\tau_i/T\), so the mission-point probability remains \(F_i(\tau_i)\) and
ordered events are compared on one calendar axis. A curve is withheld when no
global mission time exists to define that scaling.

Auto first tests exact eligibility. Independent, unshifted exponential event
clocks with event-input PAND/POR gates are represented by an ordered-failure
continuous-time Markov chain. Its states retain the ordered tuple of occurred
events, the generator contains each remaining event rate, and

\[
\mathbf p(t)=\mathbf p(0)e^{Qt},\qquad
P_{TOP}(t)=\mathbf p(t)\mathbf 1_{TOP}.
\]

The exact engine is bounded by a declared state limit. SPARE, FDEP, SEQ,
shifted or non-exponential clocks, and dynamic common-cause groups currently
fall outside that proven state representation. Exact mode fails closed with
specific reasons; Auto sends those models to chronological Monte Carlo.

Chronological simulation samples one failure threshold per unique event key and
then applies the declared semantics per trial:

- PAND requires all input failures in the saved order;
- POR occurs when the priority input precedes every blocker;
- SPARE accumulates dormant effective age before activation, applies the saved
  coverage probability, and progresses through ordered spare resources;
- FDEP moves each dependent occurrence time to its trigger time; and
- SEQ activates each event clock after its predecessor occurs.

Inclusive/exclusive tie policy is explicit. It matters for simultaneous house
or FDEP events; independent continuous clocks tie with probability zero. The
result includes a probability-versus-time curve, Wilson interval, raw top-event
count, resolution \(1/N\), a one-sided zero-event upper bound when applicable,
and observed chronological sequences. A simulated result is never labeled
exact.

## OpenPSA interoperability

Perdura imports and exports the static fault-tree portion of the OpenPSA Model
Exchange Format. Imports accept named gate/basic/house definitions, nested core
Boolean formulae, at-least and cardinality gates, choose and disclose an
ambiguous top gate, and visibly mark unresolved probability expressions with a
zero placeholder that is prohibited from analysis until the user supplies a
source. DTD and entity declarations are rejected, as are excessive XML element
count and nesting depth.

Exports validate the graph first, emit one definition for each repeated event,
and expand NAND, NOR, XOR, IFF, IMPLY, and INHIBIT into portable core Boolean
expressions. Dynamic, dependency, or unexpanded transfer constructs are rejected
because a static exchange cannot preserve their semantics. A distribution-based
event is exported as its displayed mission-probability snapshot with a warning.

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

The public analysis entry point first applies a graph contract. It requires
exactly one source and sink, at least one component, unique node identities,
valid non-duplicate connections, no self-loop or directed cycle, no incoming
connection to the source, no outgoing connection from the sink, and both an
input and output for every block. Every component must be reachable from the
source and able to reach the sink. A direct source-to-sink edge is reported as
a perfect-bypass warning because it makes system reliability one. Blocking
findings are returned as structured issues tied to the affected node or edge;
the exact evaluator is not invoked until they are resolved.

The editor follows directed success flow. A normal connection leaves the
right-side output of a source/block and terminates at the left-side input of a
block/sink. Orthogonal, curved, and straight routing are presentation choices
only. Auto Layout assigns longest-path ranks and performs repeated barycentric
ordering passes before vertically centering each rank. Block density, visible
IDs, color, snap-to-grid, notes, and targeted callouts are persisted
presentation metadata and never enter validation or probability evaluation.
Annotations can be freely resized; a targeted callout dynamically selects the
nearest opposing anchors as either object moves. Multi-selection Copy/Cut
preserves edges whose two endpoints are included. Diagram export deliberately
omits editor-only background grids and the overview minimap.

Other RBD analyses in the same project appear in a transfer-style library and
can be inserted as linked subsystem blocks before they have been evaluated.
On Analyze, Perdura walks this analysis-dependency graph recursively, evaluates
leaf analyses first, persists their refreshed results, substitutes each current
subsystem \(R_{sys}\) into its parent block, and finally evaluates the requested
top-level analysis. Stale dependencies are recalculated automatically. Missing
or circular references fail closed. A linked block is a mission-point snapshot
at the referenced analysis horizon; it does not invent a parent-level survival
curve.

Mirrored RBD blocks are multiple diagram occurrences of one logical component,
identified by a shared `component_key`. The ROBDD maps every occurrence to the
same latent survival variable, so placing one physical item on two paths cannot
manufacture false redundancy. Model edits propagate across occurrences and
importance is reported once with every occurrence ID. `Make this occurrence
independent` assigns only the selected block a new logical identity. Backend
validation independently rejects mirrored occurrences whose probability/life
model, mission time, or common-cause definition disagrees.

Canvas keyboard handling is scoped to the focused RBD editor and ignores form
controls. It supports Delete/Backspace, Ctrl/Cmd+C/X/V, Ctrl/Cmd+A, Escape,
Ctrl/Cmd+Shift+M for Mirror, and Ctrl/Cmd+Shift+L for Auto Layout. Source and
sink terminals remain protected from keyboard deletion.

For independent components, familiar series and parallel special cases are

\[
R_{series}=\prod_i R_i,
\qquad
R_{parallel}=1-\prod_i(1-R_i).
\]

The general network quantity is evaluated without assuming disjoint paths:

\[
R_{sys}=\Pr\{\text{a functioning source-to-sink path exists}\}.
\]

A block may supply a direct mission reliability or a supported parametric life
distribution. A parametric block inherits the system mission time unless it has
an explicit component exposure-time override. During a system time curve, that
override advances proportionally and reaches its specified exposure at the
system mission endpoint. This preserves (R_i(0)=1) while supporting blocks
with different duty or exposure. If every block is parametric, Perdura
reevaluates the complete exact graph on an evenly spaced
time grid from zero through the mission horizon and reports

\[
\operatorname{RMST}(\tau)=\int_0^\tau R_{sys}(t)\,dt,
\]

using trapezoidal numerical integration. This restricted mean is area only
through \(\tau\); it is not unrestricted mean time to failure. A direct
probability does not define a survival curve, so mixed/direct models return an
explicit time-curve-unavailable reason instead of inventing a hazard model.

Under beta-factor dependence, a component is available only when its latent
component-specific survival variable and its group's shared survival variable
are both true. Importance measures condition these latent variables, and
common-cause survival receives its own importance row.

Importance is calculated by exact conditional reevaluation of each modeled
survival variable \(X_i\):

\[
I_B(i)=R_{sys}(X_i=1)-R_{sys}(X_i=0),
\]

\[
I_C(i)=\frac{I_B(i)\,[1-R_i]}{1-R_{sys}},\qquad
RAW_i=\frac{Q_{sys}(X_i=0)}{Q_{sys}},\qquad
RRW_i=\frac{Q_{sys}}{Q_{sys}(X_i=1)}.
\]

An infinite RRW is represented explicitly when perfecting a variable removes
all modeled system risk. Under beta-factor common cause, \(R_i\) in these
relations is the conditioned latent-variable survival probability rather than
the requested component marginal; the result labels that distinction.

The analysis result and Report Builder assets include system metrics, the
time curve when eligible, explanatory success paths, component and common-cause
importance, formulas, assumptions, warnings, and exact-engine diagnostics.
The implementation and terminology are aligned with IEC 61078:2016,
*Reliability block diagrams*, while the ROBDD is the authoritative numerical
engine for the supported directed acyclic model class.

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
