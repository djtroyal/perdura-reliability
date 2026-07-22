# Perdura threat model

This is the repository-level threat model for Perdura's desktop/local use and
reference remote deployment. It identifies design boundaries and review targets;
it is not a penetration-test report or a statement that every listed threat has
been eliminated.

## Assets and security objectives

| Asset | Confidentiality | Integrity | Availability |
|---|---|---|---|
| Project inputs and engineering results | Organization-dependent; potentially sensitive | High—changes can alter engineering decisions | Medium to high |
| Exported reports and verification packages | Organization-dependent | High—hashes and provenance must continue to match | Medium |
| Calculation service and scientific code | Public source; runtime configuration may be sensitive | High—wrong code or dependencies can change results | High for a shared deployment |
| Release archives, SBOMs, and build evidence | Public | High—must remain attributable to the intended build | Medium |
| Proxy credentials and identity-provider tokens | High | High | High |

## Actors and assumptions

- A legitimate engineer may import malformed or unexpectedly large data by
  mistake; imported files are therefore untrusted even when the user is trusted.
- An unauthenticated network actor may reach the proxy. The reference deployment
  assumes that the proxy terminates TLS and authenticates every route before the
  request reaches Perdura.
- An authenticated but untrusted user of a shared deployment can submit
  computationally expensive requests. Perdura has no in-application tenant or
  authorization boundary.
- A dependency or CI credential can be compromised. Immutable action references,
  locked dependencies, scanning, attestations, and SBOMs reduce or expose this
  risk but do not remove it.
- The browser, host OS, reverse proxy, identity provider, GitHub, and Sigstore are
  external trust dependencies and require their own administration and review.

## Trust boundaries and principal flows

1. **Local browser boundary.** Project state is held in browser storage and
   user-selected files. Other users or processes with access to the same browser
   profile can access that state.
2. **Browser-to-service boundary.** JSON calculation requests cross the HTTP
   boundary. In a remote deployment, TLS, authentication, request-size limits,
   throttling, and access logs belong to the proxy/identity platform.
3. **Import boundary.** JSON, CSV, XLSX, XML, images, and ZIP verification bundles
   enter parsers. Extension checks alone are not a security decision; parsers and
   resource bounds are reviewed per format.
4. **Export boundary.** Results leave as files or verification ZIPs. Checksums
   detect later alteration but do not authenticate a locally generated artifact.
5. **Build boundary.** Source and locked dependencies enter hosted CI; platform
   archives, dependency manifests, SBOMs, verification records, and attestations
   leave it.

## Threats, controls, and open work

| Threat | Current controls/evidence | Residual risk or required deployment control |
|---|---|---|
| Spoofed user or cross-tenant access | Reference Caddy basic authentication; optional SSO pattern | Perdura itself has no authentication, authorization, tenant isolation, or session policy. Never publish the app port. |
| Result or project tampering | Canonical analysis fingerprints; export SHA-256 manifests; hosted artifact attestations | Local manifests are not signatures. Controlled users must preserve release evidence and apply their own records/access controls. |
| Malicious imported content | Structured parsers, safe report-link protocols, non-executable model interchange | Complete ASVS file-handling review, archive/XML resource-bound testing, and format-specific fuzzing remain open. |
| Internal error disclosure | Correlation IDs and generic unexpected-error responses | Validation errors intentionally contain field context; proxy/platform error pages require deployment review. |
| Calculation denial of service | Unpublished application port, multi-worker service, 100 MB reference-proxy body limit, k6 profiles | CPU-heavy endpoints need deployment-specific concurrency/rate limits and capacity qualification. |
| Browser script/content injection | React escaping, sanitized report links, reference CSP | CSP permits inline styles and blob workers for current UI libraries. Imported/rendered content remains an ASVS review target. |
| Vulnerable dependency or container | Frozen locks, dependency review, OSV, CodeQL, Trivy, Dependabot inputs, SBOMs | Scanner coverage and advisory data are incomplete; findings need triage, remediation records, and release decisions. |
| Compromised build workflow | Least-privilege job permissions, full-SHA action pins, GitHub/Sigstore attestations | Repository rules, maintainer account protection, runner/platform trust, and consumer verification are externally administered. |
| Misleading assurance claim | Machine-readable scope/limitations and fail-closed verification semantics | Independent ASVS assessment and penetration test have not yet been completed. |

## Review triggers

Review this model when adding a server-side database, user accounts or tenants,
new import/archive formats, plugins or user-executable code, outbound network
calls, a new deployment topology, a material cryptographic/signing feature, or a
new privileged CI/release integration. Security-relevant architecture changes
should update the ASVS and SSDF mappings and retain the review with the affected
revision.
