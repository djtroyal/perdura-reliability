# Reliability Program Workflows

## Purpose and scope

Perdura's Reliability Program workspace connects lifecycle records that are
often maintained separately: AIAG–VDA-aligned FMEA, classic FMEA/FMECA,
system-safety hazards, FRACAS,
reliability requirements and evidence, diagnostic testability, and
reliability-centered maintenance (RCM). The implementation is intended to make
engineering assumptions, links, actions, evidence, and decision status visible.
It is **standards-informed**, but it does not by itself establish compliance,
certification, risk acceptance, or technical sufficiency.

Every record has a project-unique ID. Relationships are explicit ID links, so a
field or test failure can point to an existing failure mode and hazard rather
than silently creating a second technical definition. Exported results retain
method status and source context.

## AIAG–VDA-aligned FMEA

### Implementation basis

Perdura implements DFMEA, PFMEA, and FMEA-MSR as an independently engineered
workflow aligned to the *AIAG & VDA FMEA Handbook*, First Edition (2019), with
the English translation errata, version 2 (2020-06-02), applied. Concise
in-product rating guidance is paraphrased rather than copied from the
controlled handbook. Each output identifies:

- method identifier `perdura-aiag-vda-aligned/1`;
- analysis kind and revision;
- selected rating-profile ID, version, approval status, and SHA-256 checksum;
- handbook/errata basis;
- readiness findings and finalization status; and
- the explicit fact that RPN was not calculated.

The workflow supports organization-specific rating descriptions without
changing the Action Priority algorithm. A custom profile must define every
integer rating 1 through 10 on every applicable axis. Approved profiles require
an approver and date, are treated as locked in the interface, and must be
copied to a new version before editing. The API recomputes the profile checksum
and rejects modified content carrying a stale checksum or a custom profile that
claims a reserved built-in identity.

### Seven-step workflow

The guided workspace follows the seven analytical steps:

1. planning and preparation;
2. structure analysis;
3. function analysis;
4. failure analysis;
5. risk analysis;
6. optimization; and
7. results documentation.

Navigation remains iterative. A team can return to structure or functions when
a later rating discussion exposes a missing boundary, interface, requirement,
effect, mode, or cause. Each step receives separate error and advisory counts.
Only finalization is gated; ordinary navigation and editing remain available.
A green readiness indicator means the data-contract checks found no blocking
issue at the last run, not that an external technical review has been
performed.

The Structure Analysis hierarchy and Block/Boundary Diagram are editable views
of the same FMEA model. Function and failure views provide deterministic static
diagrams derived from the editable records. Structure elements retain parent
relationships. Functions link to
the structure element that performs them. Failure chains retain the explicit
direction

\[
\text{effect}\;\longleftarrow\;\text{failure mode}\;\longleftarrow\;\text{cause}.
\]

This prevents a row of prose from obscuring which cause, mode, effect, function,
and structural element are connected.

### Block and boundary diagram

Each FMEA analysis owns one persisted block diagram. Internal diagram blocks
reference Structure Analysis records rather than copying them; adjacent
systems, people/operators, environmental sources, and other external context
are explicit external blocks. The editable boundary identifies the analysis
scope. A block may be placed inside or outside it without changing the
underlying structure hierarchy.

Scope membership and drawing position are intentionally distinct. If an
analyst leaves **Inside analysis boundary** unchecked while the block is
physically drawn inside the boundary, the canvas and report asset mark the
block amber as **Out of scope**. Context blocks intentionally placed outside
the drawn boundary do not receive this mismatch cue. Contained children always
inherit their parent's scope setting; changing or moving a parent updates all
descendants, and a contained child's scope control is read-only.

The diagram may expand a structure block into its direct children. This is
visual containment only: Structure Analysis remains authoritative for
parentage. When a parent is collapsed, every interface whose endpoint belongs
to a hidden child is rendered at the nearest visible collapsed parent. The
interface record remains owned by the child and returns to that child when the
parent is expanded. Interfaces whose two endpoints collapse into the same
parent are internal to that assembly and are hidden until it is expanded.
Equivalent projected interfaces are combined into one compact connector with
an occurrence count; selecting it reveals the underlying records. This
projection changes neither interface semantics nor traceability.

Five persisted density levels adjust block dimensions and layout spacing
together. The minus/plus control in the canvas upper-right applies the next
level and reruns the same hierarchy- and interface-aware layout; it does not
change the FMEA structure or interface records.

Interfaces drawn between block ports are the authoritative Function Analysis
interface records. The diagram supports multiple independent interfaces
between the same pair of blocks and stores each interface's category, direction,
direct/indirect linkage, relationship strength and nature, flow description,
operating condition, and function/requirement links. Perdura uses the common
boundary-diagram abbreviations:

- **P** — physical connection;
- **E** — energy transfer;
- **I** — information or data;
- **M** — material transfer;
- **H** — human-machine interaction; and
- **C** — clearance or other indirect spatial relationship.

Direct interfaces use solid lines and indirect or clearance relationships use
dashed lines. Arrowheads communicate directed or bidirectional flow; non-directional
relationships omit them. Specified relationship strength is encoded by
connector weight and a text badge. Specified beneficial, harmful, or mixed
nature is shown with explicit `+`, `−`, or `±` badges; unspecified relationship
attributes are omitted. These visual conventions do not infer physics or risk—
the analyst remains responsible for the recorded interface meaning.
External-to-external connections are rejected because an FMEA interface must
involve at least one item within the analyzed structure.

Diagram nodes, hierarchy expansion state, visual containment, boundary
geometry, viewport, and interface metadata round-trip through the native FMEA
workbook. Report Builder reproduces the current expanded/collapsed diagram and
the same projected-interface rules, while the Interface Register continues to
list every child-owned record.

### Function Analysis model

Step 3 is stored as a relational engineering model rather than a single
free-text requirement beside each function:

- each function is allocated to one structure element and classified as
  primary, supporting, interface, monitoring, or system response;
- directed function links record decomposition, dependency, input, enablement,
  monitoring, and response relationships;
- functional requirements have their own stable IDs, measure, target/unit,
  acceptance criterion, operating condition, source, owner, verification
  method, evidence references, and special-characteristic context;
- a many-to-many correlation record connects functions to requirements with a
  documented weak, medium, or strong allocation;
- directional interfaces identify source and destination diagram blocks, what
  flows, the applicable condition, and the participating functions and
  requirements; and
- a P-diagram is centered on one primary function and categorizes signal
  inputs, intended outputs, control factors, noise factors, and error states.

This permits one requirement to constrain several functions and one function
to satisfy several requirements without duplicating text. Correlation strength
is descriptive—it is not used as a probability, weighting, or risk score.

Requirements may be local to the FMEA or linked to the Reliability Program
requirement register. A linked requirement is a controlled snapshot. Perdura
stores a SHA-256 checksum of the selected source fields, compares that snapshot
with the current program record, and reports `in_sync`, `stale`,
`missing_source`, or `unbaselined`. Refresh is an explicit user action so a
changed source cannot silently rewrite a reviewed FMEA.

The Function Analysis editor and its Function Tree, Inputs & Interfaces,
P-diagram, and Correlation & Coverage views share one transient selection
context. Selecting a record in either pane highlights its matching or allocated
records in the other pane and, when necessary, opens the relevant editor group.
This is presentation state only and does not alter the analysis model.

Managed Structure Analysis snapshots retain the source Prediction analysis and
entity IDs. Their link controls navigate to that analysis and select the
originating system, system block, or part without changing the stored snapshot.

The engine checks IDs and references, rejects function-decomposition cycles,
requires a correlated requirement for every primary function, and requires a
function at the DFMEA focus element or PFMEA process step. It also checks
interface endpoints, P-diagram references/categories, and method-specific
expectations: PFMEA process functions should identify a product/process
characteristic, while FMEA-MSR should declare both monitoring and
system-response functions.

Coverage is evaluated at every structure element:

\[
\text{structure}\rightarrow\text{function}
\rightarrow\{\text{requirement},\text{interface}\}
\rightarrow\text{failure chain}.
\]

The coverage table reports the IDs found at each stage and names gaps. This is
a graph-completeness check against the records supplied; it cannot prove that
the engineering team discovered every relevant function, boundary
interaction, requirement, noise factor, or failure mechanism.

Four deterministic views support review without introducing a second editable
canvas model:

1. the function tree overlays allocated functions on the product/process
   hierarchy;
2. the interface-flow view separates external and internal directional flows;
3. the conventional P-diagram arranges inputs, outputs, controls, noises, and
   error states around the selected function; and
4. the correlation/coverage view combines a QFD-like allocation matrix with
   traceability gaps and requirement-source status.

### DFMEA and PFMEA Action Priority

DFMEA and PFMEA use severity \(S\), occurrence \(O\), and detection \(D\), each
an integer from 1 through 10. Perdura evaluates the handbook lookup as the
total discrete function

\[
AP_{DF/PF}=\mathcal{A}_{SOD}(S,O,D),
\qquad
\mathcal{A}_{SOD}:\{1,\ldots,10\}^3\rightarrow\{H,M,L\}.
\]

The implementation covers all 1,000 possible triples. It uses grouped,
explicit conditions equivalent to the published Action Priority table; it does
not multiply the ratings, interpolate between cells, or infer an unlisted
combination. High, Medium, and Low mean priority for further review and action.
They are not probabilities or cardinal risk bands.

A High AP chain requires either at least one action or a documented no-action
disposition before finalization. A Medium AP chain without either receives an
advisory. Prevention, detection, design, and process actions retain an owner,
target and completion dates, lifecycle status, decision rationale, and
effectiveness-evidence IDs.

Post-action AP is calculated only when all three post-action ratings are
present:

\[
AP'_{DF/PF}=\mathcal{A}_{SOD}(S',O',D').
\]

A changed severity requires a rationale explaining how the effect itself
changed. A post-action rating entered before a completed action and linked
effectiveness evidence is flagged as preliminary.

### FMEA-MSR

FMEA-MSR uses severity \(S\), frequency \(F\), and monitoring \(M\):

\[
AP_{MSR}=\mathcal{A}_{SFM}(S,F,M),
\qquad
\mathcal{A}_{SFM}:\{1,\ldots,10\}^3\rightarrow\{H,M,L\}.
\]

This is a separate complete 1,000-cell mapping. Occurrence and detection are
not accepted as substitutes. MSR records also retain the monitoring system,
system response, safe state, response time, and fault-tolerant interval.

An FMEA-MSR is linked to a DFMEA by default. Perdura stores the source DFMEA
revision and flags the supplement when that revision changes. A standalone
MSR remains possible, but its scope requires an explicit justification. This
keeps service-monitoring analysis connected to its design basis without
silently updating a reviewed revision.

### Foundation copies and revision traceability

An existing analysis can be used as a foundation. Perdura makes a detached
working copy and records the source analysis ID, source revision, and SHA-256
checksum. The source is not a live parent: later edits do not overwrite the
copy. Completed action evidence and post-action ratings are cleared in the
new working revision so prior effectiveness conclusions are not represented as
new evidence.

### PFMEA-linked Control Plan

For each PFMEA failure chain, Perdura derives a proposed Control Plan row from
the linked process step, function/characteristic, specification, cause, current
prevention/detection controls, action owners, and special-characteristic
context. The engine compares that proposal with the accepted row and reports
one of:

- `missing`: no linked Control Plan row exists;
- `different`: one or more derived fields changed; or
- `in_sync`: the compared fields agree.

Changes are never applied silently. The user reviews the field-level diff and
accepts it explicitly. Sampling size, sampling frequency, and reaction plan
remain explicit Control Plan decisions and are preserved when a proposal
updates an existing row. Accepted rows retain the PFMEA source revision.

### Worksheet interchange and reports

The consolidated failure worksheet can be imported from CSV or XLSX. Header
aliases provide an initial mapping, but the user confirms or changes every
mapped field; effect, failure mode, cause, and the method-specific ratings are
required. Imported ratings and rationales remain reviewable before
finalization.

Native XLSX export is a multi-sheet interchange package containing the FMEA
Worksheet, Structure, Functions, Requirements, Correlations, Function Links,
Interfaces, P-Diagrams, and Control Plan. On re-import, Perdura recognizes
these named sheets, previews their row counts, and replaces only the sections
present in the workbook after explicit confirmation. Failure chains are
preserved during Function Analysis import and continue to use the separate
mapped worksheet flow. List-valued cells use JSON arrays on export; edited
workbooks may also use comma-, semicolon-, pipe-, or line-delimited values.

Report Builder assets include an AIAG–VDA program summary and, for every
analysis, the Function Analysis summary, static function tree, correlation
table, interface register, coverage table, each P-diagram, consolidated
worksheet, method/readiness record, and PFMEA Control Plan when present. These
assets retain the analysis ID/revision, profile checksum, Action Priority,
issues, action state, and method version.

## Classic FMEA and FMECA

Classic FMEA/FMECA remains a separate selectable profile for programs that
intentionally require the earlier RPN or mode-criticality workflow. Its results
are not mixed into an AIAG–VDA worksheet.

For severity \(S\), occurrence \(O\), and detection \(D\) scores from 1 through
10, the screening value is

\[
RPN=SOD.
\]

RPN is an ordinal prioritization device. It is not a probability, expected loss,
or cardinal risk measure, and a ratio of two RPN values has no calibrated
meaning. Perdura therefore applies an independent severity override for scores
of 9 or 10 and publishes the configured RPN thresholds in the result.

When failure rate \(\lambda_p\), mode ratio \(\alpha_m\), conditional effect
probability \(\beta_m\), and mission time \(t\) are all supplied, mode
criticality is

\[
C_m=\lambda_p\alpha_m\beta_m t.
\]

Partial criticality input is rejected because silently substituting a rate,
ratio, effect probability, or exposure would change the meaning of the result.

The workflow structure follows the concerns identified in IEC 60812:2018 and
MIL-HDBK-338B. A full licensed copy of IEC 60812 is still required before any
claim of clause-by-clause conformance can be evaluated.

## Hazard risk

Initial and residual probability categories A through F and severity categories
I through IV are mapped using MIL-STD-882E, Change 1, Table III. The output
retains the matrix risk index and qualitative level. Index 0 represents an
eliminated hazard; otherwise a larger index is generally a lower ordinal risk
category.

Risk indexes must not be averaged, added, or multiplied. A residual cell records
an engineering assessment after mitigation; it is not proof that the mitigation
was implemented or effective. Perdura therefore records mitigation,
verification, acceptance status, and acceptance authority separately and flags
residual risk that worsens.

## FRACAS

FRACAS records distinguish symptom, failure mode, root cause, corrective action,
closure, effectiveness verification, and recurrence. Pareto counts describe the
observed records and can be affected by reporting, detection, deduplication, or
fleet composition.

If aggregate exposure \(T\) covers the same population and interval as \(n\)
records, the descriptive event rate and MTBF are

\[
\widehat\lambda=\frac{n}{T},\qquad \widehat{MTBF}=\frac{T}{n}.
\]

The two-sided exact Poisson rate interval at confidence \(1-\alpha\) is

\[
\lambda_L=\frac{\chi^2_{2n,\alpha/2}}{2T},\qquad
\lambda_U=\frac{\chi^2_{2(n+1),1-\alpha/2}}{2T},
\]

with a zero lower bound when \(n=0\). Exposure is optional; no rate is emitted
when its basis is unavailable.

## Reliability requirements and evidence

The requirements view checks that each record identifies a statement, measure,
target, verification method, and owner, while retaining confidence, mission,
failure-definition, status, and evidence fields. “Verification ready” requires a
complete core definition, linked evidence, and an accepted or verified status.
This is a traceability screen, not an assessment that the requirement or evidence
is statistically adequate.

## Diagnostic testability

For a declared fault universe with non-negative weights \(w_i\), detected
indicator \(D_i\), ambiguity-group size \(A_i\), and isolation threshold \(k\),
Perdura calculates

\[
FFD=\frac{\sum_iw_i I(D_i)}{\sum_iw_i},\qquad
FFI_k=\frac{\sum_iw_i I(D_i\land A_i\le k)}{\sum_iw_i}.
\]

These metrics are conditional on the entered universe, weights, diagnostic
model, configuration, and test evidence. They cannot establish that the fault
universe is complete. The concepts are informed by RL-TR-91-180 and
MIL-HDBK-338B.

## RCM decisions

RCM records connect an item and function to functional failure, failure mode,
consequence, selected task, interval, rationale, status, and FMEA links. Perdura
reports disposition counts and unresolved IDs. It deliberately does not infer
that a scheduled task is applicable or effective from its label or interval;
that decision depends on failure behavior, consequence, evidence, and program
authority.

## Validation

The calculation library exhaustively evaluates every S/O/D and S/F/M input
combination and verifies transition boundaries in the grouped Action Priority
rules. Workflow tests cover high-priority disposition, post-action
effectiveness, structure cycles and links, stale MSR sources, profile
checksums, PFMEA Control Plan diffs, and the absence of RPN in AIAG results.
Classic validation continues to cover the RPN severity override and optional
criticality. API contract tests verify schema separation, rating-profile
discovery, links, and standards metadata. Frontend contracts cover worksheet
column detection, import conversion, Control Plan proposal merging,
persistence, and Report Builder assets.

The AIAG–VDA output identifies itself as aligned and independently implemented;
organization/customer-specific requirements and formal approval remain part of
the project process. Classic FMEA/FMECA retains
`standards_informed_workflow` until the pending IEC 60812 clause-level review is
completed.

## References

- AIAG and VDA QMC, *AIAG & VDA FMEA Handbook*, First Edition, 2019.
- AIAG and VDA QMC, *AIAG & VDA FMEA Handbook—English Translation Errata
  Sheet*, Version 2, 2020-06-02.
- Quality-One International, “AIAG & VDA FMEA Handbook and Method Overview.”
- IEC 60812:2018, *Failure modes and effects analysis (FMEA and FMECA)*.
- MIL-HDBK-338B, *Electronic Reliability Design Handbook*.
- MIL-STD-882E, Change 1, *Standard Practice: System Safety*.
