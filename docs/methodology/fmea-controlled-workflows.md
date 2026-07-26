# Controlled FMEA Workflows

## Purpose

Perdura's dedicated FMEA module separates failure analysis from the broader
Reliability Program register. The Reliability Program remains the source for
requirements, hazards, FRACAS, testability, and RCM records. FMEA retains typed
links to those records and to analytical evidence elsewhere in the project.

The implementation has four layers:

1. one normalized engineering model for structure, functions, requirements,
   interfaces, failure chains, controls, actions, and evidence;
2. a method profile that supplies method-specific ratings, calculations,
   validation, terminology, and exports; and
3. a controlled lifecycle containing revisions, semantic diffs, attestations,
   releases, and integrity verification.
4. controlled family/foundation reuse plus evidence-impact and proposal-only
   engineering guidance.

Worksheets, diagrams, FMES groupings, Control Plans, and Report Builder assets
are projections of the authoritative model. They are not independent copies
that must be reconciled manually.

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
prior revision hash.
Capturing unchanged content is rejected. Semantic comparison addresses list
records by stable ID, so harmless row reordering does not appear as an
engineering change.

A release is available only from an approved, current revision. It reruns
model, evidence, method-profile, flow-down, governance, and FMEDA validation.
It is blocked by any error and requires at least one approving approver
attestation.
The release manifest includes:

- study, revision, method, and rating-profile identity;
- engineering-content SHA-256;
- software version and commit;
- release time and findings;
- attestations and their assurance mode;
- the engineering snapshot, method and rating profiles, issue index, FMEDA
  metrics and uncertainty, requirements checksum, and lifecycle event; and
- a SHA-256 over the manifest itself.

Local mode records a named attestation and explicitly labels the identity as
not authenticated. Hosted deployments may supply an authenticated identity
provider and subject. Authentication identifies the approver; it does not
replace technical review.

Released content is immutable. Editing after release creates a new draft.
Verification recomputes both hashes and checks the study identity.

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
- non-mutating, explicitly cited rating proposals.

Standards-conformance test matrices must be added separately for each profile
when the applicable authorized references are available.
