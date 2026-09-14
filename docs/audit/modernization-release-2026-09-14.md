# Engineering modernization implementation record

This candidate implements the first release of the engineering modernization
roadmap: accessible shared UI, removal of redundant frontend work, stable warranty
tail forecasts, joint step-stress inference, and procedure-specific assurance.
The supporting [research report](research-roadmap-2026-09-14.md) covers the wider
software and reliability engineering opportunities and sources.

## Baseline and scope

The GitHub review covers main commit
`5817b42adce6886e8d3373e9d33edf95f857b9f3` and the six PR heads documented in
[the GitHub review](github-review-2026-09-14.md). Implementation uses the existing
local candidate at HEAD `007203cf21c6ae21bc6f8269e1e99c5d2d83dc87` while preserving
its substantial uncommitted feature development. Existing remediation is recorded
separately in [the earlier implementation audit](review-remediation-2026-09-14.md).
The publication branch is `agent/engineering-modernization-2026-09-14`, based on
the reviewed GitHub main. It contains the integrated System Definition feature
and the remediation described here. It was prepared in an isolated checkout;
the original workspace and its uncommitted work remain intact. The attached
local evidence predates publication and is not a hosted CI attestation.

The subsequent releases remain roadmap work: delayed-entry life models,
future-count warranty prediction, Aalen–Johansen competing-risk estimates,
accelerated degradation, fatigue runouts, Gamma–Poisson demonstration testing,
and lifecycle evidence. This candidate does not claim their implementation.

## Interface and accessibility

Shared tokens define surface, text, control boundaries, selection, focus, and
status, with relative typography and browser-local compact/comfortable density.
Density affects presentation and persists independently of the engineering
project. Calculation staleness uses a visible “Recalculate” label, separate from
the project's saved/unsaved state.

Shared and affected module tables have named editors/actions and native keyboard
sorting controls. Forward Tab permits leaving data entry; row creation remains
an explicit action. Folio and report selectors use native pressed buttons with
sibling close actions. They preserve keyboard switching, rename, close and new
analysis behavior without nesting controls. Linked tabs identify their panels;
lazy top-level module tabs support manual keyboard activation.

Dialogs manage focus entry, containment, restoration and background inertness,
including nested dialogs and fullscreen charts. System Definition uses a semantic
disclosure table, and collapsing a parent actually hides its descendants.

Chart alternatives expose supplied values in paginated native tables. Axis titles,
units and supplied uncertainty settings accompany them. These values are not
estimates from pixels: histogram bins, smoothing and other visual transformations
may differ from the supplied inputs and are identified as such. Figure data,
resolution, calculation effort and downloadable precision are preserved.

Actual browser checks also found two presentation/export defects: charts retained
their previous width after a narrow-viewport resize, and backend-served SVG
downloads tried to fetch a generated `data:` URL forbidden by `connect-src 'self'`.
Charts now opt into resize handling by default, with an explicit override. Image
exports decode local bytes without a network request and show failures as alerts.
The security policy is preserved. Byte-for-byte decoding tests and real browser
exports exercise that path.

The default axe gate now checks the selected WCAG A/AA rules across all 18
top-level modules. The optional visual smoke mode explicitly reports its narrower
coverage. The checks are samples of application states; automated success does
not establish WCAG conformance or screen-reader usability.
The final sampled scan found zero violations. All 15 historical allowance
signatures have been removed, so serious/critical regressions fail the gate.

## Performance

Closed Results/bookmark, history and provenance panels no longer trigger their
expensive derived-data work on unrelated project edits. History, dirty and ledger
selectors return stable snapshots. Saved-project parsing uses a bounded cache
that respects storage changes and failed writes. Plotly configuration is stable
when its semantic inputs are unchanged; current event callbacks remain active.

An instrumented browser exercised actual React and the installed react-plotly
factory with a lightweight Plotly API stub. Twenty edits while panels were closed
produced **zero asset, history or ledger derivations**. Opening and closing chart
palette/download controls produced **zero extra Plotly.react calls**. Real figure
data/layout/configuration changes still updated the figure, and changed callbacks
and hover subscriptions remained correct. This is direct work-count evidence,
not a rendering-speed or GPU-performance claim.

Scientific performance CI runs the same candidate workload harness against the
exact PR base and candidate sources. It verifies source origin, workload protocol,
dependencies and environment before comparison. Missing/incompatible or noisy
measurements are reported explicitly; no kernel speedup is claimed here. Numerical
tolerances, observations, simulation counts and chart resolution were not reduced
to obtain the frontend work reductions.

## Warranty

Conditional first-return probabilities now use log survival:

```text
P(a < T <= b | T > c)
  = exp(log S(a) - log S(c)) * -expm1(log S(b) - log S(a)).
```

This avoids subtracting two CDF values already rounded to one. Impossible or
unresolved conditioning survival produces an explicit error. Grouped lifetime
adapters supply log survival; a custom CDF-only adapter must provide that stable
operation before it can be used for forecasting.

The API preserves numerical precision and reports the estimand, observation
assumptions, estimator, convergence, engine revision and interval semantics.
Existing intervals reflect parameter uncertainty in the conditional mean. They
exclude future-count variation and model-selection uncertainty; the interface
states that limitation. Invalidated, replaced or unmounted analyses cannot accept
a stale asynchronous result. Warranty calculation revision advances to **3**.

Independent checks cover exponential memorylessness through age 1,000, Weibull
hazard-integral identities, central-region agreement, probability mass
conservation and bounded support. The heat-exchanger data in the published
warranty example were independently solved using 50-digit Decimal score equations.
The source's rounded estimates/probability are not exactly mutually consistent;
the test preserves the published comparison and records the independently solved
MLE rather than forcing the implementation to match a rounded discrepancy.

## Step-stress

The versioned `/alt/step-stress/v2` method jointly fits a Weibull 2P cumulative
exposure model and inverse-power acceleration exponent. It includes the exact
failure-time Jacobian and right-censored survival contributions. It also supports
an explicitly fixed exponent. The legacy endpoint remains identified as a
heuristic, and retained legacy results receive an explicit historical label.
Imports continue to invalidate computed caches with incompatible engine revisions.

The current scope is a common nondecreasing schedule on a positive ratio-scale
stress, time-zero entry, common Weibull shape and independent right censoring.
Changing mechanisms, separate unit schedules, interval censoring, delayed entry
and stress decreases are outside this version. The interface distinguishes fixed
and jointly estimated exponents and records the inputs that produced a result.

Optimization uses multiple starts, validates convergence and identifiability,
and checks nuisance optimization and likelihood-ratio residuals for profile
endpoints. A boundary exponent of zero withholds ordinary profile intervals.
Successful intervals are **asymptotic pointwise profile intervals**; coverage has
not been calibrated across sparse or heavily censored designs.

The independent full-parameter likelihood fit of the ReliaSoft example gives
reference-scale eta **1176.8503848**, beta **2.6782881099**, exponent
**3.9984680973**, and log likelihood **−48.8888208813182**. Other checks cover
clock-time density integration, the analytic exponential limit, independent
censored Weibull fitting at constant stress, equal-stage splitting, profile
endpoint refitting, optimizer failure and extreme stress ratios. See
[the exact method and tolerances](../methodology/step-stress.md).

The method identifier is `step-stress-v2.1`; the Reliability Testing tools
calculation revision advances to **2**. Revisions apply to the whole tools slice,
so an older imported project can require rerunning other Reliability Testing
tools as well; inputs are retained. All affected computed showcase fixtures were
recomputed through the actual application/API. Input-only demo revision updates
reject relabeling historical computed outputs. Finer procedure-level cache
revisions are a subsequent improvement.

## Scientific assurance

The generated scientific surface catalog contains **797 entries**: 627 public
core definitions/methods and 170 statically declared router operations. Eighteen
entries map explicitly to the ten procedure-level assurance records. Unmapped
entries remain marked for classification. Discovery includes public helpers and
does not imply that there are 627 scientifically validated models.

CI checks the catalog against current AST definitions and route declarations.
Definition fingerprints detect changed code independently of source line shifts.
Explicit procedure mappings distinguish equations, numerical checks, calibration
and integration. New records cover conditional warranty returns, grouped warranty
and life estimation, Turnbull bootstrap eligibility, and joint step-stress.

The assurance matrix deliberately retains `needs_revision` and
`model_inventory_complete: false`. Release calibration, clause-level method
completeness, and complete persistence/plot/export/report evidence are separate
requirements. Catalog generation and passing unit tests cannot certify them.

## Validation record

| Validation | Result |
|---|---|
| Full core and backend suite | 2,632 passed in 368.52 seconds |
| Step-stress focused suites | 34 passed across runs, including the independent joint censored oracle and final edge-case regressions |
| Warranty, independent API oracle and scientific discovery | 30 passed |
| Performance and product assurance contracts | 69 passed |
| Demo/example refresh contracts | 20 passed |
| Production TypeScript/Vite build | Passed; existing bundle-size warnings remain |
| Frontend contracts | 42/42 passed |
| Final focused scientific/product/performance regression suite | 64 passed |
| Shared UI browser journeys | Passed, including actual module/Life Data keyboard behavior, real Plotly fullscreen and scoped axe |
| Shared-component reflow | Passed at 640×450 and 320×225 with local table scrolling; this is not full-module zoom conformance |
| Full 18-module WCAG rule scan | 18/18 passed, zero violations; baseline contains no allowances |
| Instrumented frontend performance | Passed; zero redundant work in the exercised scenarios |
| Step-stress browser | Seven functional journeys passed, including scroll/focus geometry; no serious/critical axe findings |
| Prediction mission browser | Input invalidation, rerun and presentation-state regression passed |
| Real Plotly rendering and exports | Cartesian, scatter3d and Sankey passed resize/render, SVG and HTML downloads, and downloaded-HTML execution; zero uncaught errors |
| Final export and fixture checks | Byte-preservation/provenance and visible-error contracts passed; 11 demo-revision checks and 89 website capture checks passed |
| Saved showcase consistency | All 83 hashes and demo hash valid; no stale computed engine modules; 19 affected fixtures recomputed in this release |
| Model matrix validation and scientific inventory | Passed; incomplete assurance remains explicit |
| Workflow syntax | actionlint passed |

Counts overlap where focused suites are subsets of the full suite; they must not
be added as distinct tests. The full Python suite ran outside the sandbox because
thread-backed ASGI tests stalled inside its process restrictions. Browser checks
also required an unrestricted local browser/server process. These are local
candidate results, not immutable hosted release evidence.

Portable evidence is retained in [the evidence directory](evidence/modernization-2026-09-14/):
[validation summary](evidence/modernization-2026-09-14/validation-summary.json),
[full browser scan](evidence/modernization-2026-09-14/browser-assurance.json),
[shared UI journeys](evidence/modernization-2026-09-14/shared-ui.json),
[performance work counts](evidence/modernization-2026-09-14/frontend-performance.json),
and [step-stress browser](evidence/modernization-2026-09-14/step-stress-browser.json).
The [real Plotly browser report](evidence/modernization-2026-09-14/plotly-browser.json)
records rendering interactions and downloadable byte counts.
Its [downloaded examples and hashes](evidence/modernization-2026-09-14/plotly/exports.json)
and the [final candidate source fingerprints](evidence/modernization-2026-09-14/source-fingerprints.json)
are retained for inspection. A final targeted provenance rerun replaced a flaky
fixed delay with a bounded wait for the actual completed record and passed.
Screenshots show exercised fixtures and states; they are not visual-conformance
claims for every complete module.

## Remaining release qualification

Manual NVDA/VoiceOver, broader assistive-technology and actual device testing,
full model coverage calibration, and hosted security/container/CI evidence remain
outstanding. No local test result is presented as a green GitHub check. The wider
roadmap remains prioritized in the research report, with source, observation and
uncertainty requirements attached to each proposed method.
