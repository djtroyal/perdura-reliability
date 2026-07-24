<div align="center">

# Perdura

**Reliability Engineering and Statistics Suite** — an interactive web application for
reliability engineering and statistics, covering life data analysis, accelerated testing,
system reliability, fault trees, physics of failure, hardware and software reliability growth, reliability
allocation, availability/maintainability/spares (RAM), maintenance planning, warranty analysis, statistical
modeling, and a full Six Sigma toolkit.

*perdurare* (Latin) — "to endure, to last"

</div>

## Why Perdura

Reliability work rarely ends with one calculation. A requirement becomes a test
plan; test and field data become fitted models; those models feed system risk,
maintenance, warranty, and design decisions. Perdura keeps that chain in one
project so assumptions, units, source data, uncertainty, and downstream effects
remain visible together.

- **Methods are connected to decisions.** Life distributions, predicted failure
  rates, and system models can be reused across analyses instead of being copied
  into disconnected worksheets. Importance, sensitivity, uncertainty, and
  goodness-of-fit results help distinguish a numerical answer from an adequately
  supported engineering conclusion.
- **Inputs and outputs remain inspectable.** Projects and module exports use
  human- and machine-readable JSON. The source, equations, API contracts, and
  methodology records are available for technical review; reports preserve the
  analysis context from which their tables and plots were produced.
- **Invalid evidence is not treated as a result.** Calculation paths validate
  domains, convergence, identifiability, sample sufficiency, and supported data
  regimes where those checks apply. Unsupported or unstable cases are withheld or
  identified rather than silently converted into ordinary-looking estimates.
- **The workflow is local-first.** The backend is stateless and has no project
  database. Project data remains in the browser and user-controlled files unless
  deliberately exported or sent to a centrally deployed instance. Diff-friendly
  project files can be managed using an organization's existing records and
  version-control practices.
- **Coverage extends across the reliability life cycle.** Perdura combines life
  data, accelerated testing, prediction, RBD/FTA/Markov system models, reliability
  growth, maintenance, degradation, warranty, statistical modeling, Six Sigma,
  demonstration testing, and reporting. The benefit is not module count alone:
  results can be carried into the next engineering question without losing their
  parameterization or provenance.

## Validation, verification, and model assurance

Perdura treats software verification and scientific model assurance as related
but different questions. A passing unit test can show that code behaves as
expected; it cannot, by itself, show that the implemented likelihood is the right
one, that a confidence interval is calibrated under censoring, or that every
required branch of a handbook method is present.

The repository therefore evaluates models along six dimensions defined in the
[model-assurance framework](docs/audit/model-assurance-framework.md):

1. model identity and parameterization;
2. equation and estimator correctness;
3. capability completeness and explicit omissions;
4. statistical calibration of inferential claims;
5. numerical robustness at boundaries and adverse data regimes; and
6. semantic consistency from the calculation engine through the API, interface,
   persistence, plots, exports, and reports.

Evidence is matched to the claim it supports. Depending on the model, that
includes authoritative worked examples and clause/table maps, independently
computed numerical oracles, analytic identities, published reference datasets,
simulation coverage studies, optimizer and identifiability checks, adversarial
inputs, unit-rescaling invariance, and end-to-end contract tests. In particular:

- standards-branded prediction and derating methods disclose the controlled
  edition, implemented clauses, source interpretations, exclusions, and parity
  evidence; see [Standards conformance and evidence tiers](docs/methodology/standards-conformance.md);
- inferential methods distinguish regular asymptotic approximations from
  profile, bootstrap, or model-specific procedures and record regimes that remain
  unsupported; see [Calibrated uncertainty validation](docs/audit/uncertainty-validation.md);
- the methodology audit retains counterexamples, remediation evidence, and
  limitations rather than replacing historical findings with a pass label; and
- every CI run packages structured test results, branch coverage, API contracts,
  reference evidence, platform manifests, logs, and file checksums as described
  in [Build-verification evidence](docs/assurance/BUILD_VERIFICATION.md).

This rigor improves decision usefulness in practical ways. Model-ineligible fits
are not ranked alongside valid candidates; uncertainty is attached to the
quantity being used; sensitivity and importance results expose the assumptions
driving a recommendation; and an exported result can be traced to its project,
analysis inputs, software revision, and build evidence. Optional verification
packages add deterministic SHA-256 integrity checks and analysis fingerprints;
see [Artifact provenance and verification](docs/assurance/ARTIFACT_PROVENANCE.md).

The scope is deliberately stated conservatively. Several standards
implementations are verified within documented boundaries, and CI verifies the
software revision and evidence it exercised. The strict whole-product scientific
assurance gate remains closed while the complete model inventory and required
claim-by-regime evidence are unfinished. These records support review and change
control; they are not regulatory certification, independent validation, or a
substitute for suitability assessment in the intended application.

### Security, supply chain, and performance evidence

The same evidence discipline is applied to the software delivery path. CI runs
CodeQL, dependency-change review, OSV dependency scanning, Trivy container
scanning, OWASP ZAP against an isolated full-stack instance, OpenSSF Scorecard,
and locally testable hardening controls. Third-party workflow actions are pinned
to immutable commits. These tools provide complementary findings; Perdura does
not turn their unlike outputs into a single security score or claim that a clean
scan proves the absence of vulnerabilities.

Every release includes release-specific CycloneDX 1.6 and SPDX 2.3 SBOMs that
inventory the locked Python and frontend dependencies and bind them to the exact
platform archive. GitHub/Sigstore attestations bind both the release artifacts
and SPDX SBOMs to the hosted build. This supports SLSA v1.0 Build Level 2; Perdura
does not claim Build Level 3.

Deterministic scientific workloads, ASV history support, k6 API profiles,
Playwright/axe journeys, and Lighthouse lab measurements provide performance and
browser-quality evidence. Variable hosted-runner results are regression signals,
not advertised throughput. Existing accessibility findings are explicitly
baselined and ratcheted so CI rejects new or enlarged serious/critical findings;
that mechanism is not a WCAG conformance claim. See
[Security and performance assurance](docs/assurance/SECURITY_PERFORMANCE_ASSURANCE.md),
the [security policy](SECURITY.md), and the
[build-verification evidence guide](docs/assurance/BUILD_VERIFICATION.md).

## Modules

### Life Data Analysis
- 13 distribution fitters: Weibull (2P/3P), Exponential (1P/2P), Normal, Lognormal (2P/3P), Gamma (2P/3P), Loglogistic (2P/3P), Beta, Gumbel
- MLE, RRX (Rank Regression on X), and RRY (Rank Regression on Y) fitting
- Support for right-censored (suspended) data
- `Fit_Everything` — fits all distributions and ranks by AICc, BIC, or AD
- Goodness-of-fit metrics: AICc, BIC, Anderson-Darling
- Confidence intervals on every fitted parameter (observed Fisher information) and
  confidence bounds on the reliability/CDF/SF curves (delta method); configurable `CI` level
- Per-fit **Q-Q and P-P plots** (observed vs. fitted) alongside the probability plot, for a direct
  read on fit quality
- **Special-distribution models** — Weibull mixture, competing risks, and defective-subpopulation /
  zero-inflated (DSZI) models report parameter **confidence intervals** (from the observed Fisher
  information) in the parameter table
- **Grouped observation formats** — exact-time frequency rows use count-weighted likelihoods for all
  13 parametric families; inspection intervals use true interval-censored likelihoods for the
  supported two-parameter families and a Turnbull nonparametric overlay, without midpoint substitution
- **Monte-Carlo convergence monitoring** — when sampling (e.g. the Monte-Carlo equation and
  competing-failure-mode tools), a running-mean plot with a 95% band shows whether enough
  iterations were run

### Non-Parametric Estimators
- Kaplan-Meier survival estimator with Greenwood confidence intervals
- Nelson-Aalen cumulative hazard estimator

### Probability Plotting
- Linearized probability plots for all supported distributions
- Supports censored data via rank adjustment (Bernard's approximation)

### Accelerated Life Testing
- 24 ALT fitter classes: 6 life-stress models × 4 base distributions
- Life-stress models: Exponential (Arrhenius), Eyring, Power (IPL), Dual_Exponential, Power_Exponential, Dual_Power
- `Fit_Everything_ALT` — fits all applicable models and ranks by AICc or BIC
- Use-level median-life projection with separate **delta-method** and refitted
  **parametric-bootstrap** intervals
- Visible tested-range/leverage, transformed design-rank/condition,
  physical-direction, common-shape/common-dispersion, and two-stress convex-hull diagnostics
- Monte-Carlo **test-design simulation** — repeatedly simulates the planned test to show the
  sampling distribution of the estimated metric, with a convergence plot

### System Reliability
- Series, Parallel, K-of-N, and Network (path-set) RBD configurations
- Nested block builder via `system_reliability_from_blocks`

### Fault Tree Analysis
- AND, OR, and VOTE (k-of-n) gates with basic events
- MOCUS minimal cut set computation
- Importance measures: Birnbaum, Fussell-Vesely, RAW, RRW

### Failure Rate Prediction
- Part stress analysis per MIL-HDBK-217F Notice 2 covering all major part
  categories: microcircuits, diodes, BJTs, FETs, thyristors, optoelectronics,
  resistors, capacitors, transformers/inductors, relays, switches, connectors,
  connections, rotating devices, crystals, lamps, filters, and fuses
- `CustomPart` for user-defined constant (exponential) or Weibull failure
  models; `GenericPart` for vendor/field data
- Per-part `multiplier` (e.g. failure-mode ratio); every π factor overridable
- All 14 MIL-HDBK-217F environments (GB … CL), quality levels, and π-factor
  breakdowns
- ANSI/VITA 51.1 supplement applying COTS quality-factor adjustments
- `SystemFailureRate` rollup: system λ (FPMH), MTBF, mission reliability R(t)

### Reliability Demonstration Testing
- Binomial RDT sample size (Method 1) and parametric Weibull test planning
  (Methods 2A/2B), with operating characteristic curves

### Reliability Growth & Repairable Systems
- Crow-AMSAA (NHPP power law) model with MLE estimation
- Duane graphical (regression) method
- Growth rate, cumulative and instantaneous MTBF, Cramer-von Mises goodness of fit
- Support for failure-terminated and time-terminated tests
- Repairable-system tools: ROCOF / Laplace trend test and mean cumulative function (MCF)
  (preventive-replacement optimisation now lives in the Maintenance module)

### Software Reliability Engineering
- Fits exposure-indexed software failure events or grouped interval counts with
  a constant-intensity HPP baseline, Goel–Okumoto, Musa–Okumoto, power-law NHPP,
  and delayed S-shaped models
- Reports convergence and eligibility, likelihood/AIC/AICc/BIC comparison,
  weak-identification warnings, and model-specific goodness-of-fit diagnostics
- Projects current failure intensity, expected future failures, conditional
  release-mission reliability, and additional exposure to an intensity target
- Provides asymptotic log-parameter propagation or seeded parametric-bootstrap
  refits, while limiting remaining-fault estimates to finite-fault models
- See the [Software Reliability Engineering methodology](docs/methodology/software-reliability-engineering.md)
  and [standards opportunity audit](docs/audit/reliability-standards-opportunity-audit-2026-07-22.md)

### Reliability Program
- Provides AIAG–VDA-aligned DFMEA, PFMEA, and FMEA-MSR with an iterative
  seven-step workflow; relational Function Analysis with function trees,
  directional interfaces, P-diagrams, requirement correlations and coverage;
  static structure/function/failure diagrams; full S/O/D and S/F/M Action
  Priority lookup; controlled rating profiles; revision/checksum traceability;
  and no RPN
- Links PFMEA to a reviewable Control Plan diff, supports traceable foundation
  copies, and imports/exports mapped CSV plus multi-sheet XLSX Function
  Analysis workbooks; the earlier RPN/FMECA method remains available as a
  separate Classic profile
- Connects FMEA records, MIL-STD-882E hazard risk, FRACAS, measurable reliability
  requirements, diagnostic testability, and RCM decisions using project-unique
  record IDs
- Keeps RPN explicitly ordinal, preserves initial and residual hazard risk, and
  requires complete rate inputs before calculating FMECA mode criticality
- Provides exact exposure-based Poisson intervals for FRACAS and weighted FFD/FFI
  coverage for a declared diagnostic fault universe
- Publishes its registers, summaries, and Pareto plot as Report Builder assets
- See the [Reliability Program methodology](docs/methodology/reliability-program-workflows.md)

### Maintenance
- Availability, maintainability & spares (formerly the RAM module, now folded in): inherent/
  achieved/operational availability with a downtime-breakdown bar; lognormal repair-time roll-up
  (Mct, Mmax); Poisson spare-parts provisioning with a protection-vs-stock curve
- Replacement-policy comparison: age vs block (periodic) preventive replacement — optimal
  interval and cost per unit time for each, expected PM & CM events, and the cheaper policy;
  balances preventive (PM) vs corrective (CM) cost for a Weibull item
- PM interval for a reliability target (Maintenance-Free Operating Period, MFOP): the service
  interval that keeps reliability at or above a chosen level, with a sawtooth reliability curve
- Maintenance-cost forecast over a planning horizon: expected PM/CM events and total cost under
  a chosen policy (corrective / age / block), with a cumulative-cost curve
- Availability sensitivity: a tornado of how MTBF/MTTR and admin/logistics delays move
  operational availability, plus a solve-for-target (required MTTR / max downtime for a target Ao)
- Weibull α/β can be pulled from a fitted Life Data distribution

### Human Reliability Analysis (HRA)
- Estimate or screen the human error probability (HEP) of a task, with an Overview that identifies
  each numeric output as a quantitative method result or a screening heuristic
- Quantitative calculators: **THERP** (nominal HEP + stress/experience + the dependency model),
  **HEART** (generic task type × error-producing conditions), **SPAR-H** (8 performance shaping
  factors, ≥3-negative correction, formal dependency and beta uncertainty), **CREAM** basic method
  (common performance conditions → control mode → HEP interval), and **SLIM-MAUD**
  (Success Likelihood Index calibrated to HEP)
- Explicitly scoped screens: an uncalibrated **category-factor** heuristic, a **SHERPA-inspired
  error-mode** worksheet with local likelihood anchors, an **error-forcing-context elicitation**
  summary (not full ATHEANA), and a mutually-exclusive **mission-scenario** sum (not MERMOS)
- CREAM ships both the basic method and an **extended CREAM** engine (cognitive-activity steps ×
  cognitive-function-failure probabilities), with a control-mode chart that renders the precise
  CPC region polygons

### Reliability Allocation
- Top-down apportionment of a system reliability/MTBF target across series subsystems
- Methods: Equal, ARINC (by failure rate), AGREE (by complexity/utilisation), Feasibility of effort
- ARINC failure rates can be imported directly from a Failure-Rate Prediction parts list
  (system BOM), at part or sub-assembly-block granularity

### Markov Models (State-Space)
- Continuous-time Markov chain (CTMC) modelling of repairable systems as states and transition rates
- Explicit CTMC model contract covering constant rates, exponential/memoryless state dwell times,
  competing transitions, and state sufficiency
- Mean-preserving Erlang phase-type dwell times for non-memoryless public states, with an
  exponential CTMC baseline overlaid for transient-model sensitivity
- Independent lognormal transition-rate uncertainty propagation from user-entered rate CVs
- Steady-state solution: availability / unavailability, plus MTBF, mean time to failure (MTTF),
  mean up time (MUT), and MTTR from the state occupancies
- Time-dependent state-probability evolution
- Transition rates can be linked from a fitted Life Data distribution and stay in sync on re-run

### Degradation Analysis
- Non-destructive (repeated-measure path extrapolation to a failure threshold) and destructive
  (location-parameter-vs-time MLE) degradation models

### Warranty Data Analysis
- Weighted grouped interval-censored MLE for period-level Nevada-chart returns;
  aggregate counts are preserved without rounding or exact-age substitution
- Conditional-CDF return forecasting with parameter-only uncertainty intervals

### Stress-Strength Interference
- Probability of failure P = ∫ f_stress(x) · F_strength(x) dx via numerical integration
- Supports all distribution types for both stress and strength

---

## Getting Started

Perdura is a web application: a FastAPI backend serves the analyses and a React
front end provides the interactive UI. The included start script launches both.

### Prerequisites

- Python 3.11 or 3.12
- [uv](https://docs.astral.sh/uv/) 0.11.29
- Node.js 24 and npm

### Install & run

```bash
# 1. Exact Python environment from the checked-in cross-platform lock
uv sync --locked --extra app --group dev

# 2. Exact front-end dependencies
npm ci --prefix gui/frontend

# 3. Launch the app — API on :8000, web UI on :5173
bash gui/start.sh
```

Then open **http://localhost:5173** in your browser.

`uv` creates `.venv` automatically. Perdura's source requirements describe
required APIs, while `uv.lock` records the exact packages used by CI and binary
releases. See the [dependency-management policy](docs/DEPENDENCY_MANAGEMENT.md)
before changing or refreshing dependencies.

### Perdura API

The same calculation engines used by the interface are available through the
stateless, versioned HTTP API at `http://localhost:8000/api/v1`. Start with:

- **Interactive API:** http://localhost:8000/api/v1/docs
- **Reference view:** http://localhost:8000/api/v1/redoc
- **OpenAPI document:** http://localhost:8000/api/v1/openapi.json
- **Module and analysis catalog:** http://localhost:8000/api/v1/catalog

Every calculation-bearing Perdura module is represented in the catalog. Each
entry supplies a stable operation ID, method, path, optional progress-stream
path, and whether the operation can be included in a stateless project run.
CI also publishes the exact OpenAPI document and a module-by-module API contract
matrix in the build-verification evidence bundle, alongside the backend contract
test results.

```bash
# Service/build identity
curl -sS http://localhost:8000/api/v1/health

# Evaluate a Weibull model at a mission time
curl -sS http://localhost:8000/api/v1/life-data/calculate \
  -H 'Content-Type: application/json' \
  -d '{
    "distribution": "Weibull_2P",
    "params": {"eta": 1000, "beta": 2},
    "mission_end": 500
  }'

# Compare software reliability-growth models using complete test exposure
curl -sS http://localhost:8000/api/v1/software-reliability/fit \
  -H 'Content-Type: application/json' \
  -d '{
    "event_times": [5, 12, 20, 31, 48, 70, 100, 140, 190, 250, 330, 430],
    "observation_end": 500,
    "prediction_horizon": 100,
    "mission_duration": 50,
    "target_failure_intensity": 0.01,
    "models": ["hpp", "goel_okumoto", "musa_okumoto", "power_law", "delayed_s"]
  }'
```

Python integrations can use any ordinary HTTP client; Perdura does not require
or maintain a separate SDK:

```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/life-data/calculate",
    json={
        "distribution": "Weibull_2P",
        "params": {"eta": 1000, "beta": 2},
        "mission_end": 500,
    },
    timeout=60,
)
response.raise_for_status()
print(response.json())
print("result SHA-256:", response.headers["X-Perdura-Content-SHA256"])
```

Successful responses identify the API version, Perdura version, source commit,
request ID, and (for complete non-streaming bodies) content SHA-256 in headers.
Rejected requests use one error shape containing `error.code`, `error.message`,
`error.issues`, and `error.request_id`.

Long calculations expose an adjacent `/stream` operation where shown in the
catalog. It returns newline-delimited JSON (`application/x-ndjson`) with
`start`, `progress`, and terminal `result` or `error` records:

```python
import json
import requests

with requests.post(stream_url, json=payload, stream=True, timeout=300) as response:
    response.raise_for_status()
    for line in response.iter_lines():
        if line:
            event = json.loads(line)
            print(event["type"], event)
```

For multi-analysis automation, submit a current Perdura project plus explicit
catalog operation IDs to:

- `POST /api/v1/projects/validate`
- `POST /api/v1/projects/run`
- `POST /api/v1/projects/run/stream`
- `POST /api/v1/projects/export`

Run items have an `id`, `operation_id`, `input`, and optional `depends_on`,
`module_key`, and `analysis_name`. A downstream input may use
`{"$result": "upstream-id", "pointer": "/field"}` to insert a prior result.
Independent analyses continue after a failure; dependents are marked blocked.
The export operation returns one ZIP containing the updated project, per-run
JSON, available tabular CSV, and a checksum/provenance manifest. Rendered PDF,
PNG, SVG, and interactive HTML remain UI exports.

The API stores no project or job state. Perdura has no built-in API-key system:
use it directly only on localhost, or place the complete application behind an
authenticated TLS reverse proxy/VPN. CORS is not authentication. Browser
origins requiring cross-origin access can be configured with the comma-separated
`PERDURA_CORS_ORIGINS` environment variable.

### Deploy centrally (self-hosted)

Perdura can also be hosted once on a server so a whole team connects from their
own browsers — no per-user installs. Because the backend is stateless (each
user's data lives in their own browser) and serves the built UI and the API on a
single origin, one container behind a TLS-terminating, authenticating reverse
proxy is all you need:

```bash
cp .env.example .env      # set your domain + a reverse-proxy password hash
docker compose up -d --build
```

The browser and server negotiate an explicit API-contract range before
calculations are enabled. Every browser request identifies its frontend
contract and every response identifies the server contract and accepted client
range. An open or cached tab is stopped with a reload explanation if a deployment
introduces an incompatible contract; a compatible build difference produces a
non-blocking reload notice. The server sends the SPA entry document with
`no-store` caching while retaining immutable caching for Vite's content-hashed
assets, so a reload obtains one internally consistent frontend build. Do not
remove or rewrite `X-Perdura-Client-API-Contract` or the server's
`X-Perdura-API-Contract` compatibility headers at the reverse proxy.

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full guide (TLS,
authentication, scaling, SSO, an nginx alternative, and a Docker-free path).

> Note: the app itself has no built-in authentication, so a central deployment
> must sit behind the provided proxy (or a VPN / network allowlist).

---

## Features
- **Life Data Analysis** — tabular data entry (ID / Time / State columns, Tab adds rows), CSV import and spreadsheet paste; multiple **folios** (sub-tabs) for independent analyses with a **Compare Folios** view (likelihood-ratio test + likelihood contour plots overlaid at multiple confidence levels, plus folio-vs-folio stress-strength interference using each folio's fitted distribution); enter data, specify a distribution by its parameters, or generate Monte Carlo samples; MLE/RRX/RRY fitting with manual confidence level entry, per-parameter CI tables, shaded confidence bands, and plots that update instantly when clicking through fitted distributions; Kaplan-Meier / Nelson-Aalen estimators; set-distribution selection; quick reliability calculator (R/F/f/h at time t); stress-strength interference tool
- **Accelerated Life Testing** — input failures and stress levels, select ALT models, view ranked results and an interactive life-stress plot; consolidated Test Planner: check non-parametric for Method 1, or fill in either available test time (solves samples) or sample size (solves test time) for the parametric Weibull methods, with options table and OC curve; acceleration factor calculator (Arrhenius, IPL, Eyring)
- **Failure Rate Prediction** — system hierarchy with **System Blocks** as nestable containers for piece parts (and other blocks), rendered as an indented, collapsible parts list with per-block λ subtotals; JSON import/export; all MIL-HDBK-217F part categories plus custom exponential/Weibull parts and per-part multipliers; inline part detail/edit panel with pi-factor breakdown; base method is always MIL-HDBK-217F with the ANSI/VITA 51.1 COTS supplement applied globally or overridden per part; contribution pie chart
- **System Reliability (RBD)** — drag-and-drop canvas: place component nodes, connect Source → components → Sink, edit reliabilities; computes system reliability, minimal path sets, and importance measures (Birnbaum, Criticality, RAW, RRW); auto-layout
- **Fault Tree Analysis** — drag-and-drop static coherent FTA with AND/OR/VOTE/Transfer gates, repeated events, exact reduced-BDD probability, beta-factor common-cause groups, minimal cut sets, importance measures, and Wilson simulation intervals. PAND/XOR/NOT nodes remain readable in legacy diagrams but are explicitly disabled until order-aware/non-coherent solvers are available.
- **Reliability Block Diagrams** — exact directed-network ROBDD evaluation without path enumeration, beta-factor common-cause groups, bounded path-set display, and dependency-aware latent-variable importance diagnostics
- **Physics of Failure** — dimension/regime-validated Basquin, Ramberg-Osgood, Larson-Miller, Coffin-Manson, Norris-Landzberg, Black, Peck, Arrhenius/Eyring, humidity and TDDB calculators; optional independent-input Monte Carlo intervals; Miner/nonlinear sequence-damage, Paris/Walker/Forman crack-growth and Goodman/Soderberg/Gerber mean-stress sensitivity comparisons
- **Reliability Growth** — Crow-AMSAA (NHPP power law) and regime-guarded Duane fitting; explicit event/censor MCF histories, Nelson estimates with effective risk counts, subject-robust log intervals or complete-system cluster bootstrap, and parametric power-law MCF comparison. See the [repairable-system methodology](docs/methodology/repairable-maintenance.md) and [Crow-AMSAA verification report](docs/audit/crow-amsaa-verification-2026-07-13.md).
- **Software Reliability Engineering** — event-time and grouped-count NHPP comparison with HPP, Goel–Okumoto, Musa–Okumoto, power-law, and delayed S-shaped candidates; model eligibility, diagnostics, uncertainty, operational-profile context, and release-mission projections. See the [software-reliability methodology](docs/methodology/software-reliability-engineering.md).
- **Reliability Program** — AIAG–VDA-aligned DFMEA/PFMEA/FMEA-MSR with seven-step guidance, Action Priority, controlled profiles, diagrams, PFMEA-linked Control Plans, worksheet interchange, and revision provenance; plus a separate Classic FMEA/FMECA profile and linked hazard, FRACAS, requirement/evidence, diagnostic-testability, and RCM registers. See the [reliability-program methodology](docs/methodology/reliability-program-workflows.md).
- **Warranty Analysis** — full-width Nevada Chart data entry; period returns remain weighted interval-censored groups, the selected distribution is fitted by grouped MLE, and per-lot/period forecasts include conditional parameter-uncertainty intervals
- **Reliability Allocation** — top-down allocation of a system reliability/MTBF target across series subsystems by Equal, ARINC, AGREE, or Feasibility-of-effort; one-click import of the parts list (system BOM) and predicted failure rates from a Failure-Rate Prediction folio (block- or part-level) for ARINC; results table, allocated-reliability bar chart, and a meets-target badge
- **Maintenance** — steady-state availability and lognormal maintainability; Poisson, overdispersed negative-binomial, or renewal/replenishment-pipeline spares with common shocks and simulation bands; age-vs-block long-run replacement policies; perfect-renewal MFOP; explicit long-run cost projections; finite-horizon Kijima-II imperfect-maintenance simulation with uncertainty; and availability sensitivity
- **Human Reliability Analysis (HRA)** — quantitative THERP, HEART, SPAR-H, CREAM and SLIM-MAUD calculators plus clearly labeled category-factor, error-mode, EFC-elicitation and mission-scenario screens; the Overview preserves each result's scope
- **Markov Models** — build a time-homogeneous CTMC or mean-preserving Erlang phase-type state model; inspect the model assumptions, compare non-memoryless transient curves with their CTMC baseline, propagate user-entered transition-rate CVs, and solve for steady-state availability, MTBF, MTTF, mean up time (MUT), MTTR, and time-dependent state probabilities; transition rates can be linked from a fitted Life Data distribution. See the [Markov methodology](docs/methodology/markov-models.md).
- **Cross-module linking** — define an RBD block, fault-tree basic event, Markov transition rate, or allocation/maintenance input from a fitted Life Data distribution or a predicted failure rate, kept in sync on re-run
- **Statistical Modeling** — a combined workspace over one shared dataset, with multiple independent **Analysis tabs** (each keeps its own data and results; closing the last tab spawns a fresh blank one) and a **stale-results indicator** (an amber tab asterisk plus an in-pane banner offering to re-run whenever the data changes after computing):
  - **Descriptive Statistics** — summary statistics, frequency and contingency tables, run charts, box plots, histograms, violin and raincloud plots, scatter-matrix, correlation heatmap, normal QQ plot, and ECDF; Ctrl/⌘-click tabs to display several plots simultaneously
- **Regression & ML** — a decision-grade supervised-modeling workflow with fold-safe imputation and categorical encoding, nested random/stratified/group/time validation, bounded guided AutoML, calibrated probabilities, cost-sensitive binary thresholds, resampled metric intervals, held-out permutation importance, partial-dependence/ICE diagnostics, regression prediction bands, immutable project model assets, single/batch scoring, JSON model cards, and parity-checked ONNX export where supported. Classical coefficient inference remains available separately from out-of-sample model comparison. See the [Regression & ML methodology](docs/methodology/regression-and-machine-learning.md).
- **Hypothesis Tests** — t-tests, factorial/repeated/mixed ANOVA, chi-square, non-parametric and binomial tests; repeated measures report Mauchly plus GG/HF corrections, mixed designs use explicit REML repeated covariance, and Mann–Whitney effect direction is defined as group A relative to group B
- **Six Sigma** — a container module bundling stability-gated Process Capability, topology-validated classical/REML Gage R&R, explicit Phase-I/II SPC, and model-aware Design of Experiments: versioned rank/alias metadata, reproducible randomization, nuisance blocking, noncentral-t power planning, factorial effects, pure-error lack-of-fit, quadratic response surfaces, and constrained Scheffé mixture analysis; Predictive Analytics includes tree, ensemble, SVM/KNN and neural-network models. See the [process-analysis](docs/methodology/process-analysis.md) and [DOE methodology](docs/methodology/design-of-experiments.md).
- **Component/Event Library** — shared library in the RBD and FTA sidebars; auto-populated from LDA folios and prediction parts/groups; items snapshot a manual value, an LDA folio's fitted distribution, or a prediction part/group λ, and link to selected nodes by evaluating R (or 1−R) at a mission time
- **Projects** — named projects spanning all modules, with the project name shown in a prominent header field; **Save** and **Open** named projects directly in the browser (localStorage); project-level **units** (hours, days, weeks, months, years, cycles, km, miles) selected in the header and reflected on tables, results, and plot axes — switching between compatible units (e.g. hours↔days) offers to **convert** the existing time-valued inputs, not just relabel; import/export the whole project or a single module's data as JSON (exports are named meaningfully, prefixed with the project name and module, and identify `app: "Perdura"`, its subtitle, website, schema, version, commit, and build timestamp); module state persists across tab switches and survives browser refresh (saved to localStorage)
- **Report Builder** — compose professional reports from analysis results across all modules; capture plots from any module via the toolbar icon; add headings, text paragraphs, dividers and page breaks; drag blocks to reorder; export as PDF (high-resolution, paginated) or interactive HTML (Plotly charts remain zoomable/hoverable); save/load/export/import report templates
- Export results as CSV

### CSV Format

Upload CSVs with two columns:

| value | type |
|-------|------|
| 100   | F    |
| 150   | F    |
| 200   | S    |

`type`: `F` = failure, `S` = suspension (right-censored). If the `type` column is omitted, all rows are treated as failures.

Other modules that take tabular data — Statistical Modeling (Descriptive / Regression & ML), MSA, and Hypothesis Tests — also accept **CSV/TSV file import** (delimiter auto-detected) alongside manual entry and spreadsheet paste.

### Companion website resources

The Perdura frontend build owns and can regenerate the complete PNG screenshot
inventory consumed by `perdurareliability.com`:

```bash
npm run website:resources --prefix gui/frontend
```

The deterministic bundle contains the complete registered module and analysis inventory, an accessible
metadata manifest, reviewed results-bearing fixtures, per-file SHA-256 hashes, build provenance, an HTML review
sheet, and an informative visual-difference report. Pull requests validate the
full inventory and reject results views that still show an empty or failed
analysis; successful `main` builds can open or update a rolling resource
PR in `perdura-website`. See [Companion Website Resources](docs/website-resources.md)
for local prerequisites, artifact layout, validation rules, and GitHub App
configuration.

---

## License

Perdura is released under the **[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)**:
free for personal, academic, and other non-commercial use; **commercial use
requires a separate paid license**. See [LICENSE](LICENSE) for the full terms.

Author: **Derek Taylor** — commercial licensing: djtroyal@gmail.com

## Acknowledgments

Perdura uses resources from the open-source
[reliability](https://reliability.readthedocs.io/) Python library by Matthew
Reid (MIT License):

> Reid, M. (2022). *Reliability – a Python library for reliability engineering*
> (Version 0.8.2) [Python]. Available from
> <https://pypi.org/project/reliability/>.
> [doi:10.5281/zenodo.3938000](https://doi.org/10.5281/zenodo.3938000)
