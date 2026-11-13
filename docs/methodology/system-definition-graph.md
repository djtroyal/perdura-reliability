# System Definition graph architecture

Perdura System Definition is the canonical engineering model for system blocks,
installed instances, interfaces, functions, functional failures, operating
modes, piece parts, and reviewed propagation assertions. Each project has exactly
one model and one System root with quantity one. Assemblies and piece parts can
be edited from System Definition or Failure Rate Prediction; both edit the same
installed instances. System Definition hides piece parts by default, while
Prediction displays them at every indenture level.

Prediction folios are scenarios over this hierarchy, with independent standards,
profile selections, environmental settings and model-specific overrides. They
store maps keyed by canonical instance ID, not copies of parts or assemblies.
DFMEA and FMEA-MSR use live projections of the canonical physical hierarchy,
functions and interfaces. Their ratings, controls and actions remain
analysis-owned. PFMEA keeps its process hierarchy with explicit equipment links.
RBD, FTA and Markov retain independent analytical topology and link to canonical
entities; success topology, gates, distributions and numerical overrides remain
analysis-owned.

## Storage decision

System model version 4 is a portable JSON property graph inside project
schema 11. FMEA studies use schema version 4. Older alpha projects, studies,
libraries, and workbook contracts are rejected; there is no automatic migration. The singleton lives in `modules.systemDefinition`; Prediction scenario
format 1 stores `partInputs` and `blockInputs` under each folio. Scenario exports
and bound FMEA/Program module exports include the canonical System Definition
companion. Import rejects copied legacy
hierarchies and missing or duplicate scenario identities, and a module import
cannot replace a different populated shared system. The
calculation layer builds indexed maps and adjacency lists for graph traversal,
validation, impact analysis, and functional-failure propagation. This gives the
application graph semantics without introducing a deployment service or making
project files dependent on a database vendor.

Neo4j is not justified for the current embedded, offline-capable application:
the model sizes are bounded, transactions are project-local, and Perdura must
continue to export a complete auditable project as one artifact. A separate
graph database would add authentication, backup, migration, availability, and
Community/Enterprise deployment concerns without improving the present
workflows. Reconsider it only if collaborative multi-user editing, cross-project
federation, or graph sizes exceed the indexed in-memory implementation.

## Model and inheritance rules

- A block definition is reusable and versioned. It may declare child slots,
  ports, functions, failure modes, common typed properties, and versioned
  analysis profiles.
- An installed block instance provides placement, quantity, reference
  designators, operating-mode applicability, and explicit overrides.
- Prediction profile selection is explicit per scenario and must match the
  selected standard and operating mode. Resolution applies definition values,
  instance profile overrides, then scenario-local overrides. Missing, disabled
  or incompatible profiles cannot silently supply calculation inputs.
- Quantity stays grouped by default. An analysis may request an exploded
  projection, which receives stable piece identities and must be reviewed.
- Reusable-definition changes produce a composition plan. Adds, updates, and
  removals are never silently applied; referenced or non-leaf removals are
  blocked for engineering review.

## Structured functions, resources, and diagrams

Resources have stable IDs, names, categories, and optional quantity and unit
metadata. The shared System Modeling/FMEA editor presents Inputs → Function →
Output. A Transform function has one or more input Resources, an authored action,
and exactly one output Resource. A Source has no inputs and one output. A
Maintain State function describes a condition, such as secure attachment,
without resource I/O. It optionally uses Maintain, Secure, Support, Contain,
Isolate, or Protect; ordinary actions do not require a controlled verb.

Every output Resource belongs to one producing installed function or external
terminal and may supply several consumers. Names may repeat; selectors display
block path, function, and resource to distinguish identities. Input selection
drills through the installed hierarchy one level at a time to the producing
function and its output. It opens at the block being defined so its immediate
children are the first choices. Breadcrumbs and Back retain access to the rest of
the system; blocks without eligible local or descendant outputs start at the
system level. Functions defined at an assembly level are selectable
alongside its child blocks; external sources have a separate entry. Inputs reference
those exact outputs, and outputs may remain unused. A function cannot consume
its own output, but feedback between distinct functions is valid. Selecting an
input establishes its dependency and a compatible cross-block resource transfer;
ambiguous routes require a focused selection. Same-block dependencies do not
create block self-loops. Removing an input cleans up its generated transfer;
manually authored interface records remain.

Occurrence `resource_bindings` specialize only I/O resource IDs, preserving
inherited actions. New installations and copies receive fresh output identities;
subtree copies remap internal inputs while preserving incoming producer identity.
Functions and failures added on an installed block use `default_enabled: false`
on the reusable definition and an explicit enabled override on the selected
occurrence. Thus later installations do not inherit occurrence-only additions.
Reusable definition records default to enabled. Resource-only overrides inherit
the definition's enablement rather than activating private records.

A function on an installed child supports an active function on its immediate
parent through an occurrence-qualified `decomposes_to` link. A sole eligible
parent is inferred; ambiguity leaves a compact Supports picker. Support must
cover every applicable operating mode. Reusing a definition never substitutes
another occurrence's allocation. Reparenting or disabling a function retains
analysis records as an incomplete draft until repaired.

An interface retains its actual installed endpoints. A resource flow explicitly
pairs an output with an input; bidirectional flow requires transfers in both
directions. Physical force and torque can flow as Resources. Physical attachment
and clearance relations instead reference blocks or Maintain State functions,
without synthetic Resources or I/O. External flows use persisted typed terminals
with a producer Resource on output terminals. A connection with no transfer is
an incomplete draft. Failure suggestions remain optional and never manufacture
causes, effects, ratings, or evidence.

Functions & Failures places collapsed Input dependencies beneath each authored
input. Expanding them shows short entries naming the supplying installed block or external terminal
and its output Resource, for example Electrical Power System · Protected
high-voltage DC power. The list follows that particular input's producer chain
within the selected block and stops at its boundary. It does not mix in another
input's suppliers or unrelated descendant requirements. These read-only entries
do not add authored I/O; Source and Maintain State functions retain their existing
input rules. Each operating mode is traversed independently before an All modes
summary is combined, preventing impossible cross-mode paths. The physical FMEA
editor uses the same presentation with its study's bound mode and canonical
function IDs.

The L1 system is the implicit canvas boundary. L2 assemblies are initially
collapsed; their children remain indentured inside them. Revealing a descendant
also reveals and expands its ancestor path. Tree visibility controls hide views,
not architecture records. Show all, Hide all and Invert operate on explicit
non-piece-part selections. Required parents remain contextual containers without
selecting their own interfaces; a partial selection is indicated with a dash.
Inverting twice restores the selection without changing placement or collapse.
An interface crossing an assembly boundary is exposed
on that assembly when its child endpoint is collapsed, while retaining the original
interface and endpoint identity. Internal connections do not become boundary
interfaces. System Modeling and FMEA share placement; focus, collapse, visibility,
and pan/zoom do not change semantic analysis inputs. Collapse all systems folds
expanded containers in the current diagram without moving or resizing blocks.

Interface type and resource filters select complete interface records before
collapsed connections are grouped. A resource match retains every transfer on the
matching interface. The optional Only connected blocks view retains matching
endpoints and their ancestor paths, including assemblies with internal matches;
the active FMEA focus always remains available. Filters do not delete records or
move blocks. They are remembered separately for the master diagram and each FMEA
study. Selected block connections can show Input suppliers, Output recipients,
or both. These choices follow valid resource transfers across the selected
block's boundary, including descendant connections when an assembly is collapsed.
The resource and direction must match the same transfer. Unrelated blocks are
hidden while the selected block and required parent containers remain visible.
Choosing All blocks restores the ordinary Only connected blocks preference.
Sidebar width is remembered across shared interface canvases. Visibility and
filtering preserve existing propagation and analysis results.

## Propagation assurance

The propagation service traverses functional dependencies and explicit resource
transfers pairing one output with one input. Same-block resource consumption
supplies an internal dependency. Generated cross-block dependency summaries do
not create a second causal path alongside their transfer. Physical relations
create no causal direction unless an explicit propagation rule establishes one.
An interface never creates every possible source/target function pairing.
`decomposes_to` links express immediate-parent functional support and never
create causal failure propagation. Default pass-through behavior and authored
transform/stop rules create explainable proposals, not accepted engineering
truth. An engineer's decision is stored as a propagation assertion with the
source model fingerprint, mode applicability, rationale, and evidence links.
Accepted assertions are reused on subsequent traces; changed inputs make the
derived proposal reviewable again.

Path and depth limits bound enumeration of highly connected architectures. The
pending route frontier is bounded by the requested path budget, and one path is
reserved for each later source failure when the budget permits. Complete results
retain their deterministic breadth-first ordering. A limited result carries an
explicit warning, identifies sources with incomplete paths or no exploration,
and must not be treated as a complete fault map. Selecting fewer source failures
or increasing the limits allows additional paths to be examined.

Canonical structural edits invalidate Prediction scenarios and linked analyses.
Deletion removes scenario overrides for the deleted instance but preserves
independent analytical nodes as visibly broken references. Users must relink,
detach or remove these references before the affected calculation can proceed.
Completed responses are accepted only for their captured project, scenario and
canonical-system input context; retained old outputs remain historical.

Each reviewed downstream projection includes canonical entity checksums in a binding.
Impact analysis compares those checksums with the current model and reports
added, modified, and removed entities before an analysis is refreshed.

## Scope

The vocabulary is inspired by MBSE and SysML concepts—definition versus usage,
ports, interfaces, allocation, modes, and traceability—but Perdura does not
claim SysML compliance or interchange support. Requirements, verification
cases, parametric constraint solving, and formal SysML serialization remain
future extensions.
