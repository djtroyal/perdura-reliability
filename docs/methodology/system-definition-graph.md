# System Definition graph architecture

Perdura System Definition is the canonical engineering model for system blocks,
installed instances, interfaces, functions, functional failures, operating
modes, and reviewed propagation assertions. Downstream Failure Rate Prediction,
FMEA, RBD, FTA, and Markov analyses are linked projections of this model. They
retain ownership only of analysis-specific decisions such as ratings, controls,
success topology, gates, distributions, and numerical overrides.

## Storage decision

Version 2 remains a portable JSON property graph inside the project file. The
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
- Analysis profile resolution is deterministic: definition value, then instance
  override, then analysis-local override. Provenance is returned for each value.
- Quantity stays grouped by default. An analysis may request an exploded
  projection, which receives stable piece identities and must be reviewed.
- Reusable-definition changes produce a composition plan. Adds, updates, and
  removals are never silently applied; referenced or non-leaf removals are
  blocked for engineering review.

## Propagation assurance

The propagation service traverses explicit function dependencies and
interface-to-function mappings. Default pass-through behavior and authored
transform/stop rules create explainable proposals, not accepted engineering
truth. An engineer's decision is stored as a propagation assertion with the
source model fingerprint, mode applicability, rationale, and evidence links.
Accepted assertions are reused on subsequent traces; changed inputs make the
derived proposal reviewable again.

Each downstream projection includes canonical entity checksums in a binding.
Impact analysis compares those checksums with the current model and reports
added, modified, and removed entities before an analysis is refreshed.

## Scope

The vocabulary is inspired by MBSE and SysML concepts—definition versus usage,
ports, interfaces, allocation, modes, and traceability—but Perdura does not
claim SysML compliance or interchange support. Requirements, verification
cases, parametric constraint solving, and formal SysML serialization remain
future extensions.
