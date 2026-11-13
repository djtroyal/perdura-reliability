# Controlled FMEA Workflows

## Purpose

Perdura's dedicated FMEA module separates failure analysis from the broader
Reliability Program register. The Reliability Program remains the source for
requirements, hazards, FRACAS, testability, and RCM records. FMEA retains typed
links to those records and to analytical evidence elsewhere in the project.

The implementation has five layers:

1. one normalized engineering model for structure, functions, requirements,
   interfaces, failure chains, controls, actions, and evidence;
2. a method profile that supplies method-specific ratings, calculations,
   validation, terminology, and exports;
3. a controlled lifecycle containing revisions, semantic diffs, attestations,
   releases, and integrity verification;
4. controlled family/foundation reuse plus evidence-impact and proposal-only
   engineering guidance; and
5. a project-level failure-flow registry that maintains failure statements
   across levels without turning text similarity into an engineering link.

Worksheets, diagrams, FMES groupings, Control Plans, and Report Builder assets
are projections of the authoritative model. They are not independent copies
that must be reconciled manually.

## Project System Model and focused interfaces

New DFMEA and FMEA-MSR studies use the project's single System Model. Installed
hierarchy, physical interfaces, canonical functions, and linked failure modes
are live projections of that model. System edits from either workspace apply
project-wide; FMEA ratings, effects, causes, controls, actions, requirements, and
evidence remain study-owned. Function and failure edits for an installed item
use occurrence overrides; reusable defaults remain explicitly editable in
System Modeling. Definition descriptions apply to every reuse of a definition.

Study scope and operating mode determine engineering inputs. **Item of focus**
only controls diagram navigation. A focused assembly shows interfaces with
exactly one original endpoint in its subtree, including interfaces attached to
hidden piece parts. Endpoint blocks retain their installed hierarchy and are
shown within their ancestor containers. Collapsed containers and hidden piece
parts route connections through the nearest visible ancestor without changing
the underlying endpoints. Internal and unrelated neighbor-to-neighbor interfaces
are omitted. Bundled connections retain their original endpoint paths and
individually editable records.

Selecting an item in the hierarchy or function analysis establishes focus.
On the canvas, a click inspects and **Focus here** or a double-click drills in.
Breadcrumbs, Back/Up, and the searchable selector support navigation; piece
parts can be explicitly included in that selector. A study boundary does not
clip connections to equipment outside the study. All views use shared system
geometry; focus, expansion, visibility, and viewport preferences are stored
separately and do not invalidate numerical results. Bookmarks and captured
diagram assets retain their focus context.

Functions use the same compact **Inputs → Function → Output** editor in System
Modeling and FMEA. A Transform function has one or more resource inputs, an
authored action, and exactly one output. Source functions have one output and no
inputs. Maintain State functions describe a condition without resource I/O; their
optional verb is Maintain, Secure, Support, Contain, Isolate, or Protect. Function
statements are qualitative definitions, not executable mathematical equations.

Each output Resource has one producing installed function or typed external
terminal. Resource names may repeat: stable producer and resource identities,
shown with their block path, distinguish them. A resource may feed multiple
functions, and outputs need not be consumed. A function cannot consume its own
output; feedback between distinct functions is allowed. Selecting an input
establishes its dependence on that exact producer. Same-block dependencies do
not require block self-loop interfaces. Cross-block inputs require a compatible
resource transfer covering the consumer's applicable modes. Generated routes
are cleaned up when their inputs are removed; authored interface records remain.

Occurrence resource bindings override only I/O resource IDs so repeated blocks
can share authored function descriptions while producing distinct Resources.
Occurrence-only functions and selected failures remain disabled on future
installations unless explicitly enabled there. Copying a subtree creates fresh
output identities and remaps its internal input bindings. Incoming resources retain their explicit external producer identity.
Drawing a connection can establish either a resource flow or a physical relation:
force and torque are physical flows, while attachment or clearance relates blocks
or Maintain State functions without synthetic resource I/O. Physical relations
have no causal failure direction unless an explicit propagation rule establishes
one.

Every active child function must support an immediate-parent function in each
applicable mode. The editor infers an allocation only when one eligible parent
function exists; otherwise it presents a focused selection. Decomposition is
allocation, not causal failure propagation. Failure suggestions are optional
records nested under their function. Selecting a suggestion never fabricates
causes, effects, ratings, or supporting evidence. Incomplete definitions remain
savable drafts and are reported on the affected function.

The shared canvas offers Curved (default), Orthogonal, and Straight connectors.
Routing avoids block interiors, including the source and target. Straight uses
a direct segment when clear and a safe detour when another block intervenes.
The inspector opens and closes from the same toolbar icon. System Modeling uses
the canvas as the top-level system boundary; internal assembly containers retain
their hierarchy.

PFMEA retains its process hierarchy, functions, and process interfaces. Process
steps can link to installed equipment, including multiple steps using the same
item. **View linked interfaces** opens the physical equipment view without
replacing the process structure.

Physical studies require canonical references; independent physical structures
and legacy Prediction imports are not promoted into executable studies. Project
schema 12, System Model contract 4, and FMEA study schema 4 reject older alpha
formats without migration. PFMEA remains process-owned with explicit physical
equipment links. Missing sources retain analysis work and block dependent steps
until repaired or explicitly removed. Revisions and releases are immutable.

## Cumulative prerequisite enforcement

`POST /fmea/readiness` accepts a study and its canonical model context, rating
profiles, and program requirements. It returns a semantic fingerprint, findings
with step/record/path addresses, per-step `complete` and `eligible` states, and
`can_analyze`/`can_release`. A stage is eligible only when preceding stages have
no errors. Drafts may be saved; progress cannot be marked complete manually.

1. Planning requires a supported method configuration. Subject, scope narrative,
   intent, and responsible team are optional context; missing details generate
   suggestions and do not block authoring, calculation, or release. The canonical
   study scope is still required under Structure.
2. Structure requires a valid named hierarchy, canonical scope, and ancestor
   context. Physical snapshots must match canonical identities and statements.
3. Function analysis requires block coverage, complete actions and required I/O,
   unique output ownership, connected resource inputs, and immediate-parent
   support across modes. Maintain State functions need no resource I/O.
4. Failure analysis requires coverage of studied functions, a complete
   cause–mode–effect chain, a cause function or element reference, and an affected
   function or structured stakeholder/system effect context.
5. Risk analysis requires valid ratings under an approved profile and a documented
   basis for every applicable rating axis. Default values alone are incomplete.
6. Optimization applies action disposition, completion, evidence, and control
   plan rules.
7. Documentation/release applies evidence, failure-flow, and governance checks.

Only study functions, referenced boundary functions, and their ancestor support
chains are prerequisites. Unrelated peer functions and sibling drafts do not
block the study. Prediction-only piece parts are exempt until explicitly included
or used as actual interface endpoints. Hiding a symbol does not change this scope.

Calculation requires steps 1–5. Review, approval, and release require the later
applicable gates as well. The backend independently checks prerequisites and
rebuilds physical projections; direct API calls cannot bypass UI gating.
Invalidated downstream records remain available read-only until their
prerequisites are repaired. Display-only changes do not invalidate readiness.

## Method profiles and claims

Every method profile has an ID, edition, capabilities, implementation status,
reference status, and SHA-256 checksum. The module currently exposes:

| Profile | Current status | Consequence |
|---|---|---|
| AIAG–VDA FMEA | Executable preview alignment | Seven-step DFMEA, PFMEA, and FMEA-MSR analysis is available. The profile remains visibly marked Preview until it passes the controlled-source, behavior, performance, accessibility, and integrity gates. Exact conformance still requires review against an authorized handbook and applicable customer rules. |
| SAE J1739_202605 | Reference-gated | Visible for planning; calculation and release are blocked. |
| IEC 60812:2018 | Reference-gated | Visible for planning; calculation and release are blocked. |
| MIL-STD-1629A | Reference-gated | Visible for planning; calculation and release are blocked. |
| ISO 26262:2018 FMEDA | Reference-gated | Generic accounting is available, but ISO-specific classification and target claims are blocked. |
| IEC 61508:2010 FMEDA | Reference-gated | Generic accounting is available, but IEC-specific classification and target claims are blocked. |

Publication metadata is not treated as a substitute for normative source
content. This avoids producing a plausible-looking but unverifiable profile.
An exact profile must be cross-checked against an authorized source, captured
as independent decision tables and worked examples, and regression-tested
before its status can change.

## Qualitative model

The existing seven-step workspace remains the main editor:

1. planning and preparation;
2. structure analysis;
3. function analysis;
4. failure analysis;
5. risk analysis;
6. optimization; and
7. results documentation.

DFMEA and PFMEA use the selected controlled \(S/O/D\) Action Priority mapping.
FMEA-MSR uses its separate \(S/F/M\) mapping. Action Priority is an ordinal
action-screening result:

\[
AP_{DF/PF}=\mathcal A_{SOD}(S,O,D), \qquad
AP_{MSR}=\mathcal A_{SFM}(S,F,M).
\]

It is not a probability, expected loss, acceptance criterion, or calibrated
risk magnitude. Rating rationales and linked evidence carry the engineering
basis. The implementation exhaustively tests all \(10^3\) combinations for
each mapping.

The detailed seven-step behavior, diagrams, function analysis, vocabulary,
Control Plan synchronization, and workbook interchange are described in
[Reliability Program Workflows](reliability-program-workflows.md). That
document records the original implementation history; the dedicated FMEA
module is now the owning workspace.

Cause records retain a human-readable governing statement and may additionally
store an affected-item noun, mechanism verb, and link to an applicable
lower-level Structure Analysis node. The noun remains free text when no
structure item applies, and the structure link is validated within the same
FMEA. These fields improve terminology consistency and traceability without
preventing a justified free-text cause statement.

## Failure hierarchy and cross-analysis flow

The Failure Flow Manager implements the two standard hierarchy relationships:

\[
\operatorname{Mode}(L_h)=\operatorname{Effect}(L_l), \qquad
\operatorname{Cause}(L_h)=\operatorname{Mode}(L_l),
\]

where \(L_h\) is a higher system or process level and \(L_l\) is its explicitly
mapped lower level. The equality is an identity of the controlled failure
statement, not a fuzzy-text inference. A linked statement has one stable ID,
version, origin, and text. Editing that statement in an editable working
analysis updates every bound draft endpoint atomically. Released, superseded,
and retired analyses retain their embedded snapshot.

Within one analysis, the function hierarchy can propose a parent/child flow.
Across analyses or folios, an analyst first declares:

- the parent and child DFMEA or PFMEA analyses;
- the mapped parent and child functions; and
- the specific source and target failure records.

Cross-analysis links are permitted only between matching DFMEA or matching
PFMEA kinds. FMEA-MSR retains its separate semantic relationship to a source
DFMEA and is not silently treated as a structural decomposition. Exact text
matches may rank proposals, but never create a link.

Each confirmed relationship stores:

- the canonical statement ID;
- source and target folio, analysis, chain, and role;
- the governing higher-mode-to-lower-effect or
  higher-cause-to-lower-mode rule;
- the explicit analysis-relation ID when it crosses analyses;
- source and target revisions;
- active or detached status; and
- timestamped link, edit, merge, mapping, and detach history.

The validator rejects reversed roles, cycles, self-links, missing endpoints,
unknown statements, text divergence, invalid analysis relations, and
cross-kind flows. A revision mismatch is a warning while the owner remains a
draft and a blocking error after it enters a controlled review state. Coverage
findings identify mapped parent modes or causes that still lack a confirmed
lower-level link.

The controlled revision hash includes the complete relevant failure-flow
snapshot and endpoint metadata. The XLSX workbook exports dedicated statement,
edge, endpoint, analysis-map, and history sheets; importing those sheets merges
records by stable ID and preserves unrelated project links. Report Builder
exposes both summary coverage and link-level traceability tables.

## Evidence model

An evidence link identifies:

- the exact target semantic record;
- source module, analysis, record, and revision;
- evidence kind and narrowly stated claim;
- checksum and locator, when available;
- capture timestamp; and
- stale status;
- source units and mission context for quantitative claims; and
- an optional explicit rating criterion/value when a controlled source itself
  states a rating.

The validator reports unknown targets, unknown FMEDA evidence, stale links,
quantitative evidence without units, and internal sources without a revision
or baseline checksum. Evidence-impact analysis compares captured source
identity, revision, and checksum against the current project and identifies
every affected FMEA record without rewriting it. A valid link establishes
traceability to the declared source. It does not establish the source's
technical quality. AI-generated suggestions are never evidence.

## PFMEA process, DVP&R, and characteristic flow-down

The Process & Verification view adds controlled records that do not belong in
an unstructured worksheet note:

- PFMEA process steps have an ordinal display sequence, operation/inspection/
  transport/storage/delay type, optional structure allocation, predecessor
  links, and product/process characteristics;
- DVP&R rows link an objective, method, level, sample or exposure, acceptance
  criteria, owner, and status to requirements, failure chains, and evidence;
  and
- special characteristics flow from requirements and failure chains into
  process steps and PFMEA Control Plan rows.

The validator rejects unknown references, process self-links and cycles,
completed verification without result evidence, and approved special
characteristics without requirement and failure-chain traceability. Display
sequence is not used as the semantic process graph; predecessor IDs are.

## FMEDA accounting

An FMEDA source declares one failure rate \(\lambda_s\), optional lower and
upper bounds, exposure fraction \(e_s\), mission duration,
allocation-complete status, and evidence. Failure-mode rows reference that
source and declare a mutually exclusive fraction \(\alpha_i\),
classification, diagnostic coverage \(DC_i\), dependent-failure fraction
\(d_i\), intervals, and common-cause group. Keeping the rate on the source
prevents the same component rate from being copied into several rows and
double-counted. The allocated mode rate is

\[
\lambda_i=\lambda_s e_s\alpha_i.
\]

For single-point and residual classifications, the generic residual and
detected partitions are

\[
r_i=d_i+(1-d_i)(1-DC_i),
\]

\[
\lambda_{i,res}=\lambda_i r_i,\qquad
\lambda_{i,DD}=\lambda_i(1-r_i).
\]

For a source marked allocation-complete, allocation must satisfy

\[
\sum_{i\in s}\alpha_i=1.
\]

Values above one are always errors because they double-count a source. Values
below one are reported as unclassified; they are errors for complete sources
and warnings for deliberately incomplete drafts. Unclassified rate is retained
in conservative residual denominators rather than silently disappearing.

Perdura reports transparent method-neutral summaries over the source-rate
denominator:

\[
SFF=\frac{\lambda_S+\lambda_{DD}}{\lambda_{\mathrm{source}}},
\]

\[
DC=\frac{\lambda_{DD}}
{\lambda_{DD}+\lambda_{\mathrm{single/residual}}},
\]

\[
SPFM=1-\frac{\lambda_{\mathrm{single/residual}}}
{\lambda_{\mathrm{source}}},
\]

\[
LFM=1-\frac{\lambda_{\mathrm{multiple,latent}}}
{\lambda_{\mathrm{multiple,detected}}+
 \lambda_{\mathrm{multiple,latent}}}.
\]

Perdura also reports residual rate per hour, lower/upper residual bounds,
per-source sensitivity, common-cause group totals, and mission residual
probability

\[
P_{\mathrm{res}}(T)=1-\exp\left(
  -\sum_s \lambda_{s,\mathrm{res}}T_s
\right).
\]

This is transparent method-neutral accounting, not an ISO 26262 PMHF result.
Exact SPFM, LFM, PMHF, SFF, architectural constraints, dependent-failure
treatment, diagnostic/proof-test interval rules, and targets must come from a
verified method profile.

## Reuse and engineering guidance

Foundation and family items contain normalized model collections,
applicability metadata, tags, a version, release state, and SHA-256. Only
released items can be instantiated. Instantiation rekeys every semantic record
and internal reference, rejects collisions, and stores the source item ID,
version, checksum, and complete ID map. Updating a library does not silently
rewrite existing studies; it produces a reviewable engineering change.

The local guidance engine is deterministic and cannot make changes. It may
identify missing rating rationales and propose a rating only when linked
evidence explicitly provides the rating dimension and value. Every proposal
includes its target, path, current and proposed value, rationale, and
evidence-link IDs. The analyst must accept it. Guidance cannot become evidence,
approve a record, transition lifecycle state, or create a release.

## Revisions, diffs, and releases

A controlled revision embeds and hashes canonical engineering content:

- schema version and study ID;
- method-profile ID;
- authoritative FMEA model;
- evidence links and FMEDA records;
- process flow, verification, and special-characteristic flow-down;
- review findings, assignments, and change requests; and
- saved views and controlled reuse records.

Object keys are sorted before serialization and the UTF-8 bytes are hashed with
SHA-256. Revision metadata stores the complete snapshot, content hash, and the
prior revision hash. Physical revisions also capture the canonical System Model
and a hash of the study’s semantic architecture dependency closure. Review,
approval, and release require that closure to match the current architecture;
unrelated branches and diagram placement do not change it.
Capturing unchanged study and architecture content is rejected. Semantic comparison addresses list
records by stable ID, so harmless row reordering does not appear as an
engineering change.

A release is available only from an approved, current revision. It reruns
model, evidence, method-profile, flow-down, governance, and FMEDA validation.
It is blocked by any error and requires at least one approving approver
attestation.
The release manifest includes:

- study, revision, method, and rating-profile identity;
- engineering-content SHA-256 and canonical architecture context SHA-256;
- software version and commit;
- release time and findings;
- attestations and their assurance mode;
- the engineering snapshot and canonical System Model, method and rating profiles, issue index, FMEDA
  metrics and uncertainty, requirements checksum, and lifecycle event; and
- a SHA-256 over the manifest itself.

Local mode records a named attestation and explicitly labels the identity as
not authenticated. Hosted deployments may supply an authenticated identity
provider and subject. Authentication identifies the approver; it does not
replace technical review.

Released content is immutable. Editing after release creates a new draft.
Verification recomputes the content, manifest, and self-contained canonical
context hashes and checks the study identity.

## Performance and limits

The API contracts allow up to 10,000 failure chains, FMEDA sources/modes, and
controlled records and 50,000 function/requirement or evidence links per study.
Validation and evidence integrity passes are linear in the supplied records.
The consolidated worksheet filters once, indexes results by stable ID, and
renders bounded 50/100/250-row pages rather than mounting the complete
enterprise-scale table.

## Verification

The current automated evidence covers:

- exhaustive Action Priority domains;
- model/reference integrity and readiness checks;
- deterministic method-profile checksums;
- stable ID-based semantic diffs;
- evidence dangling/stale/baseline findings;
- FMEDA source conservation, allocation boundaries, uncertainty, exposure,
  dependency, mission probability, sensitivity, and common-cause grouping;
- content-addressed revisions with embedded snapshots;
- release approval gates; and
- release content, snapshot, and manifest verification after tampering;
- lifecycle transition gates;
- evidence-impact behavior;
- library rekeying and traceability; and
- non-mutating, explicitly cited rating proposals;
- canonical mode/effect and cause/mode identity propagation;
- cross-analysis function-mapping enforcement;
- hierarchy cycle, reversed-role, missing-endpoint, text-divergence, and stale
  revision findings;
- content-hash sensitivity to failure-flow changes; and
- workbook and Report Builder failure-flow traceability contracts.

Standards-conformance test matrices must be added separately for each profile
when the applicable authorized references are available.
