# PR #238 hosted-check remediation

The first hosted run evaluated publication head
`dc1d037e33e7b2bfeccdbd2de34dd2782a26163b`. Its failures are distinct from the
historical local evidence attached to the modernization release.

## Container security

[The container job](https://github.com/djtroyal/perdura-reliability/actions/runs/34866812817/job/104052646070)
reported two HIGH vulnerabilities in the base image's `libpcre2-8-0` version
`10.42-1`: CVE-2026-86145 and CVE-2026-89161. The aggregate product assurance gate
correctly failed because the container job failed. The successful SARIF upload
check was evidence publication, not a clean vulnerability scan.

Debian identifies `10.42-1+deb12u1` as the Bookworm security fix for
[CVE-2026-86145](https://security-tracker.debian.org/tracker/CVE-2026-86145) and
[CVE-2026-89161](https://security-tracker.debian.org/tracker/CVE-2026-89161).
The official `python:3.13.14-slim-bookworm` tag still resolves to the pinned image
digest. The Dockerfile therefore installs that exact package revision from the
Debian repositories, without changing the interpreter or application lock.
The existing HIGH/CRITICAL scan and aggregate gate remain enforced.

The local Docker daemon was unavailable, so the rebuilt image and vulnerability
result require the next hosted container run. The local product-assurance and
aggregate-gate tests passed: 58 tests.

## Scientific performance comparison

[Python 3.13](https://github.com/djtroyal/perdura-reliability/actions/runs/34866811266/job/104052651684)
passed 2,137 library tests and 509 backend tests, then failed the scientific
performance comparison. The verification-evidence publisher subsequently failed
because that evidence contained regressions. Python 3.11, 3.12 and 3.14 passed.
The frontend, dynamic browser assurance, CodeQL, OSV, dependency review, and all
five locked release-environment jobs also passed on the original publication head.

The first comparison measured each revision in one separate process with three
timed repetitions. Its observations were:

| Workload | Base median | Candidate median | Change | Recorded interpretation |
| --- | ---: | ---: | ---: | --- |
| Weibull MLE, 250 observations | 85.891748 ms | 94.920856 ms | +10.5122% | Exceeded the 10% timing gate |
| Four-distribution comparison | 242.292574 ms | 278.790745 ms | +15.0637% | Exceeded the 10% timing gate |
| Distribution vector, 100,000 points | 2.900814 ms | 4.674001 ms | +61.1272% | Inconclusive: candidate CV 7.12% |
| Descriptive summary, 10,000 values | 3.955618 ms | 3.666526 ms | -7.3084% | Below the regression threshold |

All four result checksums matched. The source-package origins, workload harness,
Python 3.13.15, installed scientific libraries and `uv.lock` matched the required
comparison contract. Within-process CV was below 5% for the two failed fit cases,
but that does not measure variation between independent processes or order bias.

A bounded execution trace of the two fit workloads reached
`Distributions.py`, `Fitters.py` and `Utils.py`; those files are byte-identical to
the PR base. The additional `Step_stress` package import occurs before the
warm-up and timed observations. Its module initialization adds definitions; it
does not replace those kernels or alter thread settings. This narrows the
investigation without proving the observed timing differences are solely noise.

The revised protocol uses fixed base/candidate/candidate/base process blocks and
pools all six observations per revision. It retains raw blocks, actual process
IDs, import provenance and checksums. Both pooled CVs must remain at or below
5% for a timing regression conclusion. The timing limit stays 10%; the Python
allocation limit stays 15% and still fails independently of timing noise.
Deterministic checksum differences or incompatible environments prevent a clean
comparison and fail the command; noisy timing is explicitly inconclusive, with
skipped JUnit cases. No retry or best-run selection is performed.

Targeted tests cover process order, complete sample retention, deterministic
process drift, stable material regressions, allocation regressions despite
timing noise, source selection, incompatible context/checksum handling, and
consistent JSON/JUnit conclusions. New hosted measurements remain necessary;
the original failed observations are not overwritten or relabeled as passing.

Local validation passed all 20 focused performance-evidence tests and actionlint.
A real four-process comparison of the same source exercised both failing fit
workloads, retained matching checksums, and reported timing noise as inconclusive.
That smoke run overlapped the focused tests and is not controlled timing evidence.

Local validation passed 20 targeted performance-runner tests and actionlint.
A same-source A/A protocol smoke completed four distinct interpreter processes
for the two fit workloads, retained matching checksums, and marked both timing
comparisons inconclusive under concurrent test load. That exercise validates
the reporting flow; it is not a controlled no-regression measurement or a
replacement for the next hosted base/candidate comparison.
