# Reliability Analytics Toolkit implementation

The additions and repairs recommended by the
[comparison audit](reliability-toolkit-comparison-2026-11-21.html) are implemented
in Perdura. Existing stronger methods are retained. No proprietary WinSmith
method is implemented.

## Where to find the additions

| Workspace | Added capability |
|---|---|
| Markov → Build repairable redundancy | Active m-of-n and pooled standby models, unequal active rates, repair capacity, dormant failures, switching dependence and initial state mixtures. Generated chains remain editable. |
| RBD / FTA → Lifecycle | Whole-system scheduled or age renewal, restricted and total mean life, R(t)/f(t)/h(t), bounded editable state tables, CSV and executable Python exports. |
| RBD / FTA → Lifecycle → Simulation | Repairable static-success system simulation with calendar/operating clocks, PM, queues, concurrent crew demand, repair yield, spare supply, warmup, repeatable seeds, replication intervals and event logs. Eligible maintenance tasks can supply repair definitions and personnel. |
| Reliability Testing → Test Design & Planning | Field exposure ledger and MTBF intervals; normal summary inference; one-/two-sided success or defect intervals; binomial and finite-lot hypergeometric probabilities and acceptance. |
| Reliability Testing → Sequential testing | Bernoulli and exponential observed paths, first-crossing decisions, integer boundaries, explicit truncation, OC and expected sample count/duration with achieved-risk checks. |
| Reliability Growth → Planning | Initial-phase average or instantaneous anchors and phase tables based on integrated failure intensity. |
| Maintenance → Inventory Planning | Canonical installed BOM import, common-PN pooling, period/lifetime purchases, repair yields, depot stock, retirement, optional pipelines and storage losses, joint service targets, costs and bounded minimum-cost allocation. |
| Maintenance → Lifetime Tools | Age-duration conditional survival matrices, heatmap/table/CSV, Lp-to-Weibull-scale conversion, mechanical equivalent rates, inspection-count calibration and Bayesian posterior predictive future failures with shape/prior sensitivity. |
| Life Data → distribution calculators | Shared conditional mean remaining life in both calculators, exponential mean/MTBF input alias, and explicit Normal negative-support information. |
| Prediction → Scenario Comparison | Paired conditions on the same canonical BOM, rate/MTBF ratios, per-part factor changes, method/edition checks and current recipe provenance. |
| Help → Reference library | Local PDF page search with edition, physical page, verified hash, official source records and reproducible examples. |

New numerical outputs have saved report assets. Report navigation returns to the
owning analysis. Input, unit, source and imported-task changes invalidate the
relevant outputs; diagram movement and view-only changes preserve them.
Long-running responses cannot populate another project or overwrite changed
inputs. Dimensional project changes convert inputs and require recalculation.

## Five existing defects corrected

1. **Operational availability:** MTBM is paired with mean active maintenance;
   MTBF is paired with corrective MTTR. Incomplete maintenance pairs are withheld.
2. **Maintainability entry:** trailing separators are ignored, every invalid
   observation is rejected, and frequency rows retain their counts. MLE and
   handbook sample-log-SD estimators are explicit. Completion/exceedance plots,
   probability tables and a named MTTR-only exponential approximation are available.
3. **Sequential risks:** alpha + beta must be below one, preventing overlapping
   accept/reject regions. Observed paths stop at their first decision.
4. **Spares display:** plotting uses a bounded grid independent of the exact
   stock quantile. Achieved protection is evaluated directly at integer stock.
5. **Age-replacement precision:** tiny Weibull failure probabilities use stable
   `expm1` evaluation instead of cancellation-prone subtraction.

Additional boundary checks preserve nonzero negative-binomial demand at extreme
dispersion, reject undeclared event models, align instantaneous return conventions,
and stop simulations explicitly at their numerical/resource limits.

## Method boundaries

The new repairable-system simulator accepts static Boolean success logic.
Unsupported dynamic gates, unspecified common-cause clocks and unexpanded linked
analyses are rejected; the existing dynamic FTA analysis remains available.
Maintenance-task imports preserve a supported single-step service definition and
qualified crew requirement; incompatible precedence, shifts and resource networks
are rejected rather than flattened.

Inspection-count intervals are **Bayesian posterior predictive** intervals under
the stated prior and fixed shape. Simulation intervals describe Monte Carlo
uncertainty conditional on supplied parameters. Quadrature diagnostics describe
numerical accuracy. These are distinct from frequentist parameter confidence.

Inventory minimum-cost allocation proves an optimum within the explicitly chosen
stock limits for analytic Poisson/negative-binomial demand. Independent-product
joint protection requires declared independence; otherwise a union bound is used.

Reference search includes a packaged Python PDF reader and metadata catalog.
Installed applications use `PERDURA_REFERENCE_DIRECTORY` for supplied PDFs;
missing documents are shown as not installed. PDF files are not added to release
packages by this feature.

## Verification and maintenance

The broad backend/core regression run passed 947 tests. The subsequent affected
suite passed 188 tests; these counts overlap. Additional demand and reference
regressions cover extreme tails, real PDF extraction and packaged metadata.
The final prepublication library run passed all 2,603 tests, including demo
registration and provenance checks for the new persisted workflows.
All 82 frontend contract suites passed. Actual Python-backed browser journeys cover new tools,
source freshness, task reuse, saved reports, exports, persistence and units.

The production build and wheel build succeed. Wheel inspection checks the new
engines/routers, PDF-reader requirement, metadata, and absence of bundled PDFs.
Generated demonstration and website analysis fixtures are recomputed through the
current application. The scientific surface inventory records the new procedures
without claiming blanket scientific certification.

`product-assurance.yml` runs six new browser workflows in a separate required job,
with retained screenshots and reports. Mathematical/API checks remain in pytest;
new frontend contracts are registered with `npm run test:contracts`.

Method details:

- [System lifecycle](../methodology/system-lifecycle.md)
- [Inference and sequential testing](../methodology/inference-tools.md)
- [Inventory and RAM](../methodology/inventory-and-ram.md)
- [Lifetime planning](../methodology/lifetime-planning-tools.md)
- [Prediction comparison](../methodology/prediction-scenario-comparison.md)
- [Reference search](../methodology/reference-library-search.md)
