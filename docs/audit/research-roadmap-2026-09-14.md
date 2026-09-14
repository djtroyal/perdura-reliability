# Perdura engineering research and roadmap

## Recommendation and evidence boundaries

Modernize the existing engineering workbench through accessible shared controls,
explicit analysis state, scientific assurance, and measured removal of redundant
work. Preserve familiar module navigation, numerical effort, observations, chart
resolution, exports and precision. Additional model families follow stronger
observation semantics and independent validation of existing estimators.

The published review baseline is GitHub main
`5817b42adce6886e8d3373e9d33edf95f857b9f3`. The six open PRs and their exact
heads are recorded in [the GitHub review](github-review-2026-09-14.md).
Unpublished local remediation and System Definition development are separate
from that baseline. Passing local tests do not establish green hosted checks.
The [implementation record](modernization-release-2026-09-14.md) records the
subsequent changes and their actual validation.

Research covered the 45-PDF supplied reference inventory, selected substantive
sections of the handbooks, seven supplied ReliaSoft technical snapshots, primary
software documentation, current standards catalogs and original statistical
research. Direct access to some ReliaWiki pages was restricted; corresponding
official ReliaSoft reference pages and supplied PDFs supplied the technical text.
Catalog-only access establishes edition and scope, not clause conformance.

## UI, color and accessibility

### Current foundations and gaps

The published application already has 18 module themes, shared components,
focus outlines, chart dash/marker differentiation and an accessibility ratchet.
The design work should build on these foundations. Static inspection found:

- Mouse-only shared table sorting, unnamed cell editors and keyboard-inaccessible
  row deletion. Forward Tab from the last editable cell continually adds rows.
  This is a forward-navigation defect; a WCAG keyboard trap was not established.
- Incomplete tab-to-panel relationships and nested folio interaction semantics.
- A fullscreen plot dialog that declares modality without complete focus entry,
  containment, restoration and background inertness.
- A shared chart wrapper without a required information alternative, although
  individual modules sometimes already supply tables.
- Small typography and broad CSS utility overrides instead of complete semantic
  surface, text, control and state tokens.

The July 2026 accessibility baseline permits 107 affected-node counts over 15
module/rule entries. These are historical allowances, not 107 newly observed
distinct issues. At the review baseline, browser assurance ran the broader ruleset
for four modules and contrast checks for fourteen; full-catalog support already existed.
Automated scans and static review do not establish screen-reader usability.

### Design contract

Use WCAG 2.2 AA as the product acceptance target. The WCAG 3 document dated
September 10, 2026 remains a Working Draft. APG patterns and design systems guide
implementation but do not themselves establish conformance. [W3C WCAG 2.2][wcag],
[WCAG 3 status][wcag3], [APG grid][grid], [tabs][tabs], [dialogs][dialogs].

Extend the theme system with semantic tokens: surfaces, text, decorative/control
borders, actions, focus, selection and status. Keep module identity separate from
status and data encoding. Distinguish saved/unsaved projects from current, stale,
running, invalid and failed calculations. Use text and icons alongside status
color. Fluent's token architecture and Carbon's productive typography are useful
references, not a reason to replace the current component framework. [Fluent
tokens][fluent], [Carbon typography][type], [Carbon tables][tables].

The initial typography contract is 14px-equivalent body/controls and 13px dense
table text, expressed in relative units. Compact/comfortable settings change
spacing and row heights; tabular numerals support comparisons. Essential control
boundaries and text/background pairs must be tested in their rendered states.
Hit targets, spacing exceptions, zoom and focus must be evaluated independently
of font size. [WCAG 2.2][wcag], [USWDS color guidance][uswds].

Native table semantics are the first implementation choice. A spreadsheet grid
would additionally require a complete navigation/editing model; adding ARIA roles
alone would not supply it. Folio actions should use truthful native controls where
there is no single linked content panel. Lazy module tabs use explicit activation;
local inexpensive panels can activate on focus. [APG grid][grid], [APG tabs][tabs].

### Scientific charts

Use categorical colors for unrelated components, sequential maps for ordered
quantities and diverging maps around meaningful reference values. Assign series
styles by stable identity. Retain labels, dashes and markers when series are
sorted or hidden. The existing amber `#e69f00` is approximately 2.25:1 against
white: a color-vision-friendly palette name does not guarantee graphical contrast.

Cividis is supported by research into brightness uniformity and modeled color
vision deficiencies. Scientific Colour Maps supplies versioned alternatives.
Neither source guarantees accessibility for every chart context. Required
information needs descriptions and accessible values; grayscale/CVD simulation
complements manual testing. [Nuñez et al., 2018][cividis], [Scientific Colour
Maps][maps], [WAI complex images][images].

## Software and performance

### Confirmed redundant work

Closed bookmark menus subscribe to global edits and enumerate assets through 27
module extractors. A permanently mounted closed provenance modal serializes the
ledger; ledger capacity reaches 10,000 entries. Some store snapshot selectors
serialize unchanged history or parse saved-project maps. The plot wrapper builds
a new configuration object and callbacks during surrounding UI updates.

Eliminate closed-panel derivation, return stable immutable subscription snapshots,
and memoize Plotly configuration by semantic dependencies. These changes remove
unnecessary work without changing calculations. Actual latency gains require
before/after evidence. [React external stores][store], [React Profiler][profiler],
[Plotly function reference][plotly], [Plotly UI revision][uirevision].

Cache identity must include the relevant project generation, source slice,
markup/runtime revisions and units or engine revision. Undo, import, replacement,
storage events and source edits must invalidate their affected entries. Reopening
a panel must show current data. Never mutate trace arrays merely to suppress a
library update or retain all hidden charts without a memory bound.

### Measurement and later opportunities

The existing CI performance command uses three repetitions without a baseline,
so its implemented comparison limits are inactive. A finite aggregate checksum
does not establish numerical parity. Python allocation tracing omits much native
and browser memory. The default k6 workload, one user and five iterations, is a
smoke check rather than evidence of capacity or tail latency.

Compare identical workload harnesses and record source/dependency identity, CPU,
RAM, native thread settings, cold/warm state and raw observations. Include large
BOM edits, multiple populated folios, histories, autosave, chart interactions,
mixed-duration requests, cancellation and reports. Preserve complete numerical
payloads and diagnostics. Existing median-time and Python-memory limits are 10%
and 15%; confirm noisy comparisons under the documented controlled profile.
INP at or below 200ms at the 75th percentile is a useful responsiveness objective,
with laboratory and field claims distinguished. [INP guidance][inp].

Later experiments include incremental persistence/IndexedDB, bounded fit-artifact
reuse, response serialization/hashing reuse, cooperative cancellation and unified
CPU admission. Web Storage is synchronous; IndexedDB requires migration and
durability contracts. Multiple server workers, Python thread pools and native
BLAS threads may oversubscribe cores. Measure combinations rather than assuming
more workers are faster. [Web Storage][storage], [IndexedDB][indexeddb],
[Starlette thread pools][threads], [SciPy parallel execution][scipy].

## Reliability engineering

### Scientific assurance is the first domain investment

The existing assurance matrix starts with five detailed procedure records and
19 of 21 domains marked `not_assessed`. Its explicit incomplete-inventory flag
prevents global certification. This is an evidence gap, not proof that unassessed
methods are mathematically wrong. The implementation adds a conservative public
surface inventory, separately mapping callable methods to output claims. It must
not equate an endpoint or a discovered class with all of its scientific regimes.

Use separate evidence for equations, numerical behavior, statistical calibration
and end-to-end integration. Point estimates, pointwise intervals, simultaneous
bands, predictive distributions and decision rules require different claims.
Simulation needs a stated data-generating process and stopping/censoring design;
its Monte Carlo precision must be reported. [Morris, White and Crowther,
2019][ademp].

This direction accords with lifecycle dependability guidance and objectives-based
reliability practice. The current ASQ body of knowledge includes data management,
testing, system integration, maintainability, suppliers and corrective action.
[IEC 60300-1:2024][iec], [ASQ CRE body of knowledge][asq], [NASA R&M][nasa].

### Existing capabilities and priorities

| Area | Existing capability | Next priority |
|---|---|---|
| Life data | Exact/grouped/censored likelihoods, Turnbull, mixtures and competing models | Delayed entry and wider design-specific uncertainty evidence |
| ALT | Joint constant-stress fitting and physical acceleration laws | Joint cumulative-exposure step-stress likelihood |
| Degradation | Correlated nonlinear mixed effects, measurement likelihood, quadrature and refit bootstrap | Add stress to the joint model; validate first-passage predictions |
| Repairable systems | Crow–AMSAA, grouped growth, MCF, unequal exposure and Kijima-II simulation | Observation starts/gaps and data-connected recurrent forecasts |
| Warranty | Interval-preserving Nevada fits, conditional cohort means, parameter-only intervals | Stable tails, then calibrated future-count prediction |
| Test design | Binomial/exponential/Bayesian methods, OC curves and sequential boundaries | Stopping-rule provenance and independent risk calibration |
| RBD/FTA/Markov | Exact and simulation methods, initial states, dependency/importance analysis | Consistent assumptions and uncertainty across linked analyses |
| Physics of failure | Fatigue, crack growth, thermal and other physical models | Runout-aware fatigue-life likelihoods |
| Programs | FMEA, FRACAS, requirements, testability, RCM and maintenance analysis | Exposure-linked evidence and verified corrective-action effectiveness |

### First scientific corrections

Warranty conditional probabilities were computed by subtracting CDF values near
one. With a rate-one exponential lifetime and one survivor aged 50, the next
period forecast was zero instead of `1-exp(-1) = 0.6321205588285577`. The stable
identity for `(a,b]` conditional on survival to `c` is:

`exp(logS(a)-logS(c)) * -expm1(logS(b)-logS(a))`.

Use a stable survival interface; a CDF-only fallback cannot reconstruct lost tail
probabilities. Tests include memorylessness after unconditional survival has
underflowed, bin-mass conservation and bounded-support conditioning.

The heat-exchanger likelihood printed by Tian et al. (PDF p.24) was also checked
with an independent 50-digit decimal score-equation solution. It gives scale
66.0220855369, shape 2.53086625733 and conditional year-3-to-10 failure probability
0.007991008679. The publication reports scale 66.058 and probability 0.00797.
The regression retains both the published-data provenance and the independently
solved likelihood, rather than changing numerical output to match the discrepancy.

Existing step-stress inference groups cumulative failure-time medians by failure
stress to estimate an exponent, takes its absolute value and falls back to two.
Those observations have survived previous stress stages. Replace this heuristic
with joint Weibull 2P/inverse-power estimation for a shared schedule and exact or
right-censored units. Include the time-transformation Jacobian for failures and
survival terms for censored units. Fixed-exponent scenarios remain explicitly
labeled external assumptions. [ReliaSoft time-varying stresses][step], [NIST
maximum likelihood][mle].

### Subsequent releases

1. Add delayed entry and observation windows. Entry zero must reproduce current
   behavior; lifetime likelihoods condition on entry, while MCF risk sets contain
   only observed systems. Keep calendar time, attained age and operating exposure
   distinct.
2. Add future-count warranty prediction, beginning with known-parameter cohort
   distributions and independent convolution. Parameter-aware within-sample
   prediction needs coverage calibration; adding random counts to local-normal
   parameter draws is not sufficient. Preserve multinomial dependence across
   periods and distinguish first returns from recurrent claims. [Tian et al.][warranty].
3. Add Aalen–Johansen cause-specific incidence alongside independent competing
   failure models. Survival plus observed cause probabilities must sum to one;
   censoring other causes in a standalone KM complement does not estimate this
   incidence. [Survival multistate reference][compete].
4. Extend the existing joint degradation model with stress-dependent rates and
   a justified measurement model. Projected crossing confidence limits are not
   observed interval-censored failures. [Meeker, Escobar and Lu, 1998][degradation].
5. Add exact failures and right-censored runouts to fatigue-life estimation;
   avoid silently inverting regression in the opposite response direction.
6. Add proper Gamma–Poisson updating with prior provenance, sensitivity and
   negative-binomial predictive counts. Lot hierarchy requires comparable groups
   and defensible exchangeability assumptions. [NIST Bayesian updating][bayes].
7. Link exposure-aware FRACAS and effectiveness review to requirements, system
   analysis, RCM and maintenance decisions. Records of closure and complete
   fields do not by themselves establish corrective-action effectiveness.

These are subsequent releases, not claims that the current release implements
the new models. Richer common-cause models, repair-effect estimation, spare-parts
optimization, supplier hierarchies and licensed prediction standards require
their own data and validation contracts.

### Handbook and edition interpretation

The supplied Rome Laboratory toolkit distinguishes mission/logistics reliability
(printed pp.11–12), gives prediction completeness checks (p.85), and specifies
field/test evidence prerequisites including exposure, population, failure
definition, reporting and environmental similarity (p.86). MIL-HDBK-338B
sections 12.4–12.5 emphasize lifecycle tailoring and coordination; its cover says
guidance only. Neither should be used to imply current regulatory certification.

The local VITA 51.1 R2018, pp.6–8, standardizes MIL-HDBK-217F Notice 2 inputs
within its scope and distinguishes engineering-judgment, field and test sources.
VITA now lists 51.1 S2025. Edition review does not justify silently substituting
formulas. IEC 60300-3-10:2025 updates maintainability guidance; IEC TR 63162:2025
provides reference-condition failure-rate material. Full licensed content must
be reviewed before implementation or conformance claims. [VITA catalog][vita],
[IEC maintainability][maint], [IEC reference rates][rates].

## Supplied technical source register

The following locators identify the reviewed PDF snapshot pages. These vendor
snapshots are methodological references, not issued standards editions. Existing
reference licensing and Git-ignore rules remain in force.

| File under `docs/references/` | Reviewed technical sections |
|---|---|
| `Parameter Estimation.pdf` | pp.21–25 censored likelihood/MLE limitations; pp.26–28 Bayesian estimation |
| `Competing Failure Modes Analysis.pdf` | pp.1–4 model/example; p.11 independence |
| `The Mixed Weibull Distribution.pdf` | pp.1–5 population mixtures; pp.6–8 estimation/uncertainty |
| `Degradation Data Analysis.pdf` | pp.1–6 path extrapolation; pp.8–10 destructive degradation |
| `Reliability Test Design.pdf` | pp.4–11 binomial/exponential; pp.12–19 Bayesian; pp.24–29 detection/simulation |
| `Weibull++ SimuMatic.pdf` | pp.1–3 sampling, censoring and estimation |
| `Risk Analysis and Probabilistic Design with Monte Carlo Simulation.pdf` | pp.1–5 input/output uncertainty propagation |
| `Rome_Laboratory_Reliability_Engineers_Toolkit.pdf` | printed pp.11–12 and 85–86 (PDF pp.19–20 and 93–94) |
| `MILHDBK338B.pdf` | cover, foreword and §§12.4–12.5 |
| `AV51DOT1-2013-R2018.pdf` | pp.6–8, scope and source-quality distinctions |

Vendor recipes receive the same scrutiny as code. Simulation always depends on
assumptions, and projected parameter-confidence intervals are not observed
inspection intervals. Preserve scientific meaning when sources use simplified
wording. [ReliaSoft test design][rdt], [ReliaSoft degradation][relia-degradation].

[wcag]: https://www.w3.org/TR/2024/REC-WCAG22-20241212/
[wcag3]: https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/
[grid]: https://www.w3.org/WAI/ARIA/apg/patterns/grid/
[tabs]: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
[dialogs]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[fluent]: https://fluent2.microsoft.design/design-tokens/
[type]: https://carbondesignsystem.com/elements/typography/type-sets/
[tables]: https://carbondesignsystem.com/components/data-table/usage/
[uswds]: https://designsystem.digital.gov/design-tokens/color/overview/
[cividis]: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0199239
[maps]: https://www.fabiocrameri.ch/colourmaps/
[images]: https://www.w3.org/WAI/tutorials/images/complex/
[store]: https://react.dev/reference/react/useSyncExternalStore
[profiler]: https://react.dev/reference/react/Profiler
[plotly]: https://plotly.com/javascript/plotlyjs-function-reference/
[uirevision]: https://plotly.com/javascript/uirevision/
[inp]: https://web.dev/articles/inp
[storage]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
[indexeddb]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
[threads]: https://starlette.dev/threadpool/
[scipy]: https://docs.scipy.org/doc/scipy-1.17.0/tutorial/parallel_execution.html
[ademp]: https://discovery.ucl.ac.uk/id/eprint/10066118/1/2019%20-%20Morris%20-%20simulation%20studies%20tutorial%20-%20stat%20med.pdf
[iec]: https://webstore.iec.ch/en/publication/66489
[asq]: https://www.asq.org/cert/resource/pdf/certification/2025-CRE-BoK.pdf
[nasa]: https://sma.nasa.gov/sma-disciplines/reliability-and-maintainability
[step]: https://help.reliasoft.com/reference/accelerated_life_testing_data_analysis/alt/time-varying_stress_models.html
[mle]: https://www.itl.nist.gov/div898/handbook/apr/section4/apr412.htm
[warranty]: https://arxiv.org/pdf/2007.08648
[compete]: https://cran.r-project.org/web/packages/survival/vignettes/compete.pdf
[degradation]: https://www.stat.cmu.edu/technometrics/90-00/vol-40-02/v4002089.pdf
[bayes]: https://www.itl.nist.gov/div898/handbook/apr/section4/apr46.htm
[vita]: https://vita.com/Standards
[maint]: https://webstore.iec.ch/en/publication/65334
[rates]: https://webstore.iec.ch/en/publication/63563
[rdt]: https://help.reliasoft.com/reference/life_data_analysis/lda/reliability_test_design.html
[relia-degradation]: https://help.reliasoft.com/reference/life_data_analysis/lda/degradation_data_analysis.html
