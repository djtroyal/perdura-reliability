# Security and performance assurance

Perdura publishes security and performance evidence alongside its existing test,
coverage, model-assurance, and release-provenance records. The purpose is to make
a specific revision reviewable—not to turn scanner output or benchmark scores
into a blanket claim that the product is secure or fast in every environment.

## Current assurance position

- Release archives and verification evidence are produced by GitHub-hosted
  workflows and receive GitHub/Sigstore artifact attestations. GitHub documents
  these attestations as satisfying SLSA v1.0 Build Level 2. Perdura does not yet
  claim Build Level 3.
- CodeQL analyzes Python and JavaScript/TypeScript. The product-assurance job
  adds dependency, container, OpenSSF Scorecard, OWASP ZAP, accessibility, and
  performance records without silently combining unlike findings into one score.
- [`asvs-5.0-scope.json`](asvs-5.0-scope.json) fixes the intended assessment to
  OWASP ASVS 5.0.0 Level 2 and separates application controls from controls
  supplied by the deployment proxy. It is assessment preparation, not an ASVS
  conformance claim.
- The repository uses the NIST SSDF vocabulary to organize secure-development
  evidence: prepare the organization, protect the software, produce well-secured
  software, and respond to vulnerabilities. This is an alignment statement, not
  NIST certification. The versioned mapping is
  [`nist-ssdf-mapping.json`](nist-ssdf-mapping.json).
- The [threat model](THREAT_MODEL.md) states assets, trust boundaries, principal
  flows, current controls, residual risks, and architecture-change triggers.

## Automated security profiles

| Profile | Frequency | Evidence | Release effect |
|---|---|---|---|
| Local assurance policy | Every CI run | Security policy, ASVS tracker integrity, workflow SHA pins, proxy headers, container boundary | Required |
| Dependency review | Pull requests | Newly introduced vulnerable dependencies | Required when GitHub supports the repository feature |
| OSV lock scan | Pull requests, main, weekly and manual | `uv.lock` and `package-lock.json` vulnerability results | Unsuppressed findings fail |
| CodeQL | Pull requests, `main`, weekly | Python and JavaScript/TypeScript SARIF | Independently required |
| OpenSSF Scorecard | Weekly and on demand | Per-check SARIF and JSON | Informational posture evidence; no aggregate-score quality claim |
| Container runtime and scan | Pull requests, main, weekly and manual | Native AMD64/ARM64 startup, calculation, package inventories, SBOMs and Trivy results | Runtime failure or high/critical findings fail |
| OWASP ZAP | Pull requests, main, weekly, and on demand | Passive browser scan on pull requests; bounded active OpenAPI scan on main/weekly/manual against an isolated instance | Findings follow the checked-in action gate; raw reports are retained |
| Browser accessibility | Pull requests, main, weekly and manual | axe WCAG-tagged findings on all 18 module states in Chromium, Firefox and WebKit | New or enlarged serious/critical findings fail |

Scanner suppressions must be narrow, documented with a reason and expiry/review
date, and retained with the raw report. Scanner absence, cancellation, malformed
output, or missing expected evidence is **incomplete**, never a pass.
The checked-in ZAP rules suppress only intentional caching behavior, known static
bundle signatures, an informational application classification, an unqualified
cross-origin-isolation header, and a scanner-generated request-header finding;
each entry has a review date. Browser defense headers are emitted by both the
application and reference proxy, while HSTS remains a TLS-proxy control.

### Scorecard assessment scopes

The pinned Scorecard action accepts pull requests and default-branch runs. Its
validation rejects a manual run on a candidate branch before generating results,
even with publication disabled. Candidate manual runs therefore use the official
Scorecard 5.5.0 CLI (the same engine as the action), verified against its pinned
release SHA256, in a separate job. The publisher job retains the action's required
allowlist of steps and has no shell steps or job environment overrides.

The candidate job must generate four valid reports: JSON and SARIF for the exact
checked-out candidate (`--local`), and JSON and SARIF for the repository's default
branch and governance (`--repo`). These scopes have separate artifact names and
SARIF categories; `scopes.json` records candidate commit, actual event/ref, tool
digest and policy digest. The local scope has the same file-based coverage as the
action on a pull request. Repository governance evidence is explicitly labelled
as default-branch evidence. A single `--commit` scan cannot replace both because
Scorecard filters that mode to commit-based checks. No GitHub event/ref is spoofed.

Both SARIF reports use an exact copy of the pinned action's Apache-2.0 policy at
`assurance/scorecard-policy.yml`. Generation failures, malformed reports or a
missing selected Scorecard job fail the aggregate. Only the action on supported
events publishes to scorecard.dev; the manual candidate retains and uploads both
scopes to GitHub without asserting that candidate results describe the default
branch. Upstream behavior is documented in the pinned
[action options](https://github.com/ossf/scorecard-action/blob/2d1146689b8cda280b9bc96326124645441f03bc/options/options.go)
and [publication restrictions](https://github.com/ossf/scorecard-action/blob/2d1146689b8cda280b9bc96326124645441f03bc/README.md#workflow-restrictions).

### Pull-request aggregate and activation

The workflow starts on every pull request targeting `main`, including
documentation changes, and publishes the stable `Product assurance gate` check.
The scope job uses the complete Git diff, including both paths of a rename.
Only root README, changelog, contributing and code-of-conduct Markdown files,
and Markdown under `docs/` outside `docs/assurance/`, may skip the scan jobs.
Security policies, assurance documentation, unknown paths, and empty diffs run
the full suite. Main pushes, scheduled and manual runs always run the full suite.

The aggregate requires successful scope detection and every applicable job.
It fails on failures, cancellations, missing results, or unexpected skips.
Dependency review is skipped outside pull requests; Scorecard is skipped on
fork pull requests because it needs repository-scoped publication permissions.
Documentation-only pull requests report their skipped scans explicitly and do
not claim to have produced new scanner evidence.

Branch protection is a separate deployment step: first observe this check on a
code pull request and a documentation-only pull request, verify failure
propagation, and obtain a successful full scan on the deployed workflow. Then
require `Product assurance gate` in repository settings. Do not require the
individual conditionally skipped jobs. Merely adding the aggregate to source
does not change branch protection or establish a successful external scan.

Dependency review rejects newly introduced vulnerabilities; OSV inspects the
complete locked dependency graph. A dependency PR can therefore pass review
while inheriting an OSV failure. The aggregate summary links the original jobs,
including architecture/browser matrix failures, rather than interpreting every
downstream red check as an independent defect. Optional job-link retrieval does
not change the verdict from required job results.

Full active API assurance is required on the final replacement-PR commit before
merging dependency/security or major renderer migrations. Dispatch the workflow
on that branch, check the run's head SHA against the PR, and retain its reports.
The normal PR run includes bounded HTTP regressions even when active scanning
is deferred to this explicit full run.

The active API profile uses `assurance/zap-api.context` and
`assurance/zap_api_hooks.py` to restrict scanning to localhost API routes and
send the supported client-contract header. Unknown API routes remain in scope.
The HTML documentation pages and non-API application are covered by the
separate browser/passive profile. No API error or content-type rule is globally
suppressed. Relevant alert request/response messages are retained to reproduce
future failures. Scan duration and per-rule bounds remain unchanged.

### Container source maintenance

All three external image sources in the Dockerfile use immutable
multi-platform digests. The Node 26 builder, Python 3.13.14 runtime, and uv
0.11.29 installer are pinned independently;
each index includes Linux AMD64 and ARM64. Dependabot checks Docker references
weekly so tag rebuilds and new versions have a review path.

Review Python and uv version updates together with their exact declarations in
`pyproject.toml`, the lockfile and CI. A registry-verified digest proves image
identity and platform availability, not vulnerability remediation. Before
release, build and scan both runtime architectures and verify application
health against those images. Trivy explicitly limits SARIF severities to the
configured HIGH/CRITICAL gate; OSV continues to fail on unsuppressed findings.

The Python base must match `.python-version`; Docker disables uv interpreter
downloads and installs against `/usr/local/bin/python`. Tests execute the final
unprivileged image, checking interpreter version, native imports, HTTP health,
the built UI and a known numerical calculation. This evidence is distinct from
the checkout-based API/browser suite.

Live Debian security repositories can remove superseded package revisions.
The PCRE2 and Perl security step installs supported Bookworm updates and verifies a
minimum patched version instead of requiring a disappearing exact apt revision.
CI records the resulting Debian package inventory and complete image SBOM.
The digest-pinned base plus application lock does not make live apt updates
bit-for-bit reproducible; retained package evidence identifies what was shipped.

### File-input inventory

Perdura accepts project/module JSON, tabular CSV, electronic BOM CSV/XLSX,
report-builder PNG/JPEG/WebP images, OpenPSA fault-tree XML, and verification ZIP
packages. Client-side selection is not treated as a security boundary. Each
format must be checked for a permitted extension and parsed as the expected
content type; XML/ZIP handling must reject external entities, traversal, excessive
expansion, and unsafe members where applicable. Remote deployments must enforce a
request-body limit at the proxy appropriate to their approved project sizes.
The reference Caddy deployment applies a 100 MB outer bound; this is not a
recommendation that every deployment needs to accept files that large.

## Performance methodology

Performance results have two uses and are deliberately separated:

1. **Regression evidence** detects a change relative to an earlier build.
2. **Reference-platform evidence** describes measured behavior on one controlled
   host. It is the only profile suitable for public numerical claims.

The Python workload suite measures deterministic scientific kernels and fitting
paths. ASV can retain histories across revisions. k6 exercises health and a
representative calculation endpoint using smoke, average-load, stress,
spike, and soak profiles. Playwright records a user journey, while Lighthouse
provides lab measurements for loading, accessibility, and browser best practices.

Reference results require a dedicated Linux x86-64 host constrained to four
logical CPUs and 8 GiB RAM. Every record includes the CPU model, OS, Python,
browser/tool versions, commit, dependency-lock hashes, workload hash, warm-up
policy, repeat count, and raw observations. Results from variable GitHub-hosted
runners are regression diagnostics and are not advertised as product throughput.

Promotion of a reference result requires five stable runs with coefficient of
variation at or below 5%. When an accepted baseline is supplied, the runner
flags a median scientific-workload regression above 10% or peak Python-memory
regression above 15%. API p95 uses its separately recorded k6 threshold. Absolute
service targets remain deployment requirements; ISO/IEC 25023 supplies
measurement terminology but does not supply universal passing values.

PR CI measures the exact base SHA and candidate scientific source using
`--compare-source-root` with the **same candidate workload harness and interpreter**.
Four fresh processes run in a fixed base/candidate/candidate/base order. This
counterbalances order and exposes variation between processes instead of relying
on one short sample from each revision. The runner checks
the imported `reliability` package path. It compares only matching workload and
runner hashes, workload selection, repeat/warm-up protocol, Python runtime
dependency closure, installed scientific libraries, CPU/affinity, OS, and native
thread pools. The runtime projection starts at the editable Perdura package and
its `app` extra, follows every transitive dependency and selected extra, and
retains all locked platform/Python variants, sources, artifacts/hashes, dependency
markers and lock metadata. It excludes development/release dependency groups and
packages reachable only through those groups. A package shared with runtime
remains included. Missing or ambiguous dependency evidence fails closed.

Exact runtime-projection equality is required; a changed runtime version,
artifact, source or dependency remains incompatible. Development/release-only
updates can therefore compare the two scientific sources under the same runtime
without skipping any workload or relaxing numerical, timing or memory gates.
The complete `uv.lock` hash remains in provenance for every process block, even
when those full hashes differ. Comparison protocols `v3` (single process) and
`v4` (A/B/B/A) identify this policy; old-protocol records are incompatible.
Push runs without a supplied baseline report `comparison.status=unavailable`;
they establish smoke execution only. Incompatible or absent records never
produce a percentage improvement or a passing comparison. Use
`--require-comparison` when a stable comparison is mandatory.

Each process performs one warm-up, three timed repetitions, and one separate
Python-allocation measurement per workload. Each revision therefore has six
timing observations across two processes; all observations, process IDs, source
origins and allocation peaks remain in the report. Timing statistics use the
pooled observations, while allocation comparisons use each revision's largest
observed peak. There are no retries, discarded blocks or best-run selection.
The six observations represent two independent interpreters per revision. The
CV limit is a variability screen, not a significance test; fixed ordering reduces
linear drift but cannot eliminate effects from nonlinear host load.
Timing comparisons with either pooled coefficient of variation above 5% are
`inconclusive` and require a controlled
repeat with at least five observations; they do not establish an improvement or
regression. A Python-allocation regression still fails independently of timing
noise. Inconclusive timings remain explicitly skipped in JUnit; a successful
diagnostic job does not convert them into a clean performance comparison.
Context or checksum incompatibility marks the report and cases inconclusive
and exits nonzero. The normalized deterministic workload checksum must match
across all four blocks within relative tolerance `1e-10` and absolute tolerance
`1e-12`. This is a smoke sentinel, not a numerical-parity oracle: existing
scientific/reference tests retain their full tolerances, precision, simulation
counts, confidence methods, and warning/eligibility checks.

The first frontend performance batch removes unnecessary work while retaining
the storage format, active-tab lifetime, calculations, and full chart data:

| Derived value | Cache and lifecycle contract |
| --- | --- |
| History labels | One immutable snapshot per history revision; new fields, undo/redo and project replacement invalidate it. Closed menus subscribe only to inexpensive counts. |
| Provenance ledger | One snapshot per pair of immutable ledger-array identities. Closed dialogs unsubscribe from the ledger while keeping local verification state. |
| Unsaved labels | One snapshot per actual dirty-target change; successful save/reset clears it. |
| Saved-project parsing | At most two parsed records keyed by complete stored bytes. Every read checks current storage, so cross-tab writes, migration and backup recovery are observed. Writers copy the map; a failed write cannot change cached saved data. |
| Results menu | Asset enumeration is mounted only while open and reads current assets immediately on reopening. No cross-module or scientific-result cache is introduced. |
| Plotly configuration | Memoized by semantic configuration, data topology, layout reset callback, fullscreen callback and event kinds. Stable event bridges read the latest callbacks; adding/removing event kinds reconciles subscriptions. |

`npm run test:performance-store --prefix gui/frontend` exercises snapshot
invalidation and storage failure behavior. `npm run assurance:performance
--prefix gui/frontend` uses real React and the installed react-plotly factory
with a small Plotly API stub. It requires zero closed-panel derivations during
20 editor writes, zero extra `Plotly.react` calls when opening/closing tool
panels, current callback closures, and necessary updates for data/layout/config
changes. This is deterministic call-count evidence, not a rendering-speed
benchmark. The separate production Plotly browser journey validates real plots,
interaction and export behavior. IndexedDB migration, retained tabs, worker
topology and scientific fit caches remain later measured experiments.

## Accessibility

Automated axe and Lighthouse checks identify detectable WCAG problems. They do
not cover all WCAG 2.2 success criteria. Perdura will claim WCAG 2.2 AA only after
the complete application states in scope receive both automated and manual
evaluation and the conformance claim records its date, pages/states, level, and
exceptions.

The historical serious/critical allowances have been removed from
[`accessibility-baseline.json`](../../assurance/accessibility-baseline.json).
The default browser gate applies the selected complete WCAG ruleset to all 18
top-level modules and fails any serious or critical finding in those journeys.
The empty baseline remains owned and dated. These sampled automated checks do
not establish accessibility or WCAG conformance for every application state.

## Independent assessment package

An independent assessor should receive the exact release artifacts and
attestations, verification bundle, SBOMs (with runtime and build relationships
kept distinct), deployment configuration, OpenAPI
document, ASVS tracker, threat/boundary description, scanner reports, supported
version policy, and test credentials for an isolated deployment. The public
deliverable should identify assessor, scope, release/commit, dates, methodology,
severity scheme, unresolved findings, remediation status, and retest outcome.
Raw exploit details remain private until coordinated disclosure is safe.

No independent penetration test has yet been recorded by this repository.
