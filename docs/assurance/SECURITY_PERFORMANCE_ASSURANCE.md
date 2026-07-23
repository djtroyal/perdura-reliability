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
| OSV lock scan | Pull requests and weekly | `uv.lock` and `package-lock.json` vulnerability results | Unsuppressed findings fail |
| CodeQL | Pull requests, `main`, weekly | Python and JavaScript/TypeScript SARIF | Independently required |
| OpenSSF Scorecard | Weekly and on demand | Per-check SARIF and JSON | Informational posture evidence; no aggregate-score quality claim |
| Container scan | Weekly and before release | Trivy vulnerabilities and configuration findings | High/critical findings fail after reviewable suppressions |
| OWASP ZAP | Pull requests, weekly, and on demand | Passive browser scan on pull requests; bounded active OpenAPI scan weekly/on demand against an isolated four-worker instance | Findings follow the checked-in action gate; raw reports are retained |
| Browser accessibility | Pull requests and weekly | axe WCAG-tagged findings on four representative module states | New or enlarged serious/critical findings fail |

Scanner suppressions must be narrow, documented with a reason and expiry/review
date, and retained with the raw report. Scanner absence, cancellation, malformed
output, or missing expected evidence is **incomplete**, never a pass.
The checked-in ZAP rules suppress only intentional caching behavior, known static
bundle signatures, an informational application classification, an unqualified
cross-origin-isolation header, and a scanner-generated request-header finding;
each entry has a review date. Browser defense headers are emitted by both the
application and reference proxy, while HSTS remains a TLS-proxy control.

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

## Accessibility

Automated axe and Lighthouse checks identify detectable WCAG problems. They do
not cover all WCAG 2.2 success criteria. Perdura will claim WCAG 2.2 AA only after
the complete application states in scope receive both automated and manual
evaluation and the conformance claim records its date, pages/states, level, and
exceptions.

The current automated scan has known serious/critical findings. Their types and
maximum affected-node counts are explicit in
[`accessibility-baseline.json`](../../assurance/accessibility-baseline.json),
with an owner and review date. CI permits those findings only at or below their
recorded counts and fails new finding types or increased counts. A matching
baseline therefore means “no regression,” not “accessible” or “WCAG conformant.”

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
