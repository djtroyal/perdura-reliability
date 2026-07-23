# Security policy

## Supported releases

Security fixes are made against the current stable Perdura release and the
`main` branch. Older feature releases are not maintained as parallel security
branches. Users should update to the latest release before requesting support
for a suspected vulnerability.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, or
pull request. Use GitHub's **Security → Report a vulnerability** form for this
repository. If private vulnerability reporting is unavailable, email
[djtroyal@gmail.com](mailto:djtroyal@gmail.com) with the subject
`Perdura security report`.

Include, when practical:

- the affected version, deployment mode, and operating system;
- the security impact and conditions required to reproduce it;
- minimal reproduction steps or a proof of concept;
- whether the issue is already public; and
- a safe way to contact you for follow-up.

Reports should receive an acknowledgement within two business days and an
initial severity/scope assessment within seven business days. Remediation time
depends on impact, exploitability, and release risk. Confirmed issues are
coordinated privately until a fix and disclosure are ready. Release notes identify
publicly known vulnerabilities fixed by a release.

## Deployment boundary

Perdura's calculation service does not implement user authentication. A remote
deployment must keep the application port private and place it behind an
authenticated, TLS-terminating reverse proxy with appropriate request-size,
rate, and concurrency controls. CORS is not authentication. See
[the deployment guide](docs/DEPLOYMENT.md#security).

## Assurance claims

Automated security scans, dependency inventories, build attestations, and
verification reports reduce risk but do not prove that an artifact is
vulnerability-free. The current security and performance evidence scope is
documented in
[Security and performance assurance](docs/assurance/SECURITY_PERFORMANCE_ASSURANCE.md).
