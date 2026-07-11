<div align="center">

# Perdura

**Reliability Engineering and Statistics Suite** — an interactive web application for
reliability engineering and statistics, covering life data analysis, accelerated testing,
system reliability, fault trees, physics of failure, reliability growth, reliability
allocation, availability/maintainability/spares (RAM), maintenance planning, warranty analysis, statistical
modeling, and a full Six Sigma toolkit.

*perdurare* (Latin) — "to endure, to last"

</div>

## Why Perdura

- **One screen, nothing hidden.** Every control for an analysis is visible right where you work —
  no buried settings panels, no configuration you forgot to set (or unset). The only pop-ups are
  quick confirmations for deliberate actions like starting a new project or deleting a saved one.
- **No binaries — transparent, auditable project assets.** Projects and per-module exports are
  written as pretty-printed, human- and machine-readable **JSON**. Nothing is trapped in an opaque
  file format; every input is right there in plain text.
- **No database, no convoluted backend.** The server is stateless — a request comes in, a result
  goes out, nothing is written or stored server-side. Your data lives in your files, not in yet
  another proprietary store you have to back up, migrate, or fear losing. Because Perdura's assets
  are diff-friendly JSON, **you bring your own version control** — Git, SVN, or whatever your team
  already trusts — as the central repository for shared projects and best-practice history. That's
  a workflow you own, using tools built for the job. The IT footprint is tiny, so Perdura deploys
  almost anywhere, scales across a team when you need it to, and stays easy to keep available.
- **Fully transparent source.** The complete source is available to read and audit — every formula,
  algorithm, and statistical method is there for you to inspect and verify, not hidden behind a
  black box. (See the [License](#license) for usage terms.)
- **Lightweight and fast.** Small footprint, minimal overhead, no bloat. Charts load on demand and
  module state is kept in memory, so jumping between modules and analyses is virtually instant —
  no waiting, no spinners between clicks. Everything you need and nothing you don't.
- **No compromise on capability.** You still get everything the heavyweight, expensive suites do:
  advanced statistical methods with confidence intervals and goodness-of-fit throughout, Monte-Carlo
  simulation with live convergence monitoring, machine-learning and neural-network models, and
  drag-and-drop canvas diagramming (Reliability Block Diagrams, Fault Trees, Markov state models).
- **Local-first and team-ready.** Your data stays in your browser (localStorage) and never leaves
  your machine unless you export it; the app runs from essentially anywhere. Cross-module linking
  keeps a fitted distribution or a predicted failure rate in sync across the tools that use it;
  multi-folio / multi-tab analyses come with side-by-side **Compare** views; results are unit-aware
  (with value conversion, not just relabeling); and the **Report Builder** assembles PDF or
  interactive-HTML reports from any module. Methods follow the standard references
  (MIL-HDBK-189/217F, ISO 22514-4, AIAG MSA, Meeker–Escobar, Kalbfleisch–Prentice).

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
- **Special-distribution models** — Weibull mixture, competing risks, defective-subpopulation /
  zero-inflated (DSZI), and grouped data — now report parameter **confidence intervals** (from the
  observed Fisher information) in the parameter table
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

- Python 3.10+
- Node.js 20+ and npm (CI and the Docker image build on Node 24 LTS)

### Install & run

```bash
# 1. Backend Python environment
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r gui/backend/requirements.txt

# 2. Front-end dependencies
cd gui/frontend && npm install && cd ../..

# 3. Launch the app — API on :8000, web UI on :5173
bash gui/start.sh
```

Then open **http://localhost:5173** in your browser.

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
- **Reliability Growth** — Crow-AMSAA (NHPP power law) and regime-guarded Duane fitting; explicit event/censor MCF histories, Nelson estimates with effective risk counts, subject-robust log intervals or complete-system cluster bootstrap, and parametric power-law MCF comparison
- **Warranty Analysis** — full-width Nevada Chart data entry; period returns remain weighted interval-censored groups, the selected distribution is fitted by grouped MLE, and per-lot/period forecasts include conditional parameter-uncertainty intervals
- **Reliability Allocation** — top-down allocation of a system reliability/MTBF target across series subsystems by Equal, ARINC, AGREE, or Feasibility-of-effort; one-click import of the parts list (system BOM) and predicted failure rates from a Failure-Rate Prediction folio (block- or part-level) for ARINC; results table, allocated-reliability bar chart, and a meets-target badge
- **Maintenance** — steady-state availability and lognormal maintainability; Poisson, overdispersed negative-binomial, or renewal/replenishment-pipeline spares with common shocks and simulation bands; age-vs-block long-run replacement policies; perfect-renewal MFOP; explicit long-run cost projections; finite-horizon Kijima-II imperfect-maintenance simulation with uncertainty; and availability sensitivity
- **Human Reliability Analysis (HRA)** — quantitative THERP, HEART, SPAR-H, CREAM and SLIM-MAUD calculators plus clearly labeled category-factor, error-mode, EFC-elicitation and mission-scenario screens; the Overview preserves each result's scope
- **Markov Models** — build a time-homogeneous CTMC or mean-preserving Erlang phase-type state model; inspect the model assumptions, compare non-memoryless transient curves with their CTMC baseline, propagate user-entered transition-rate CVs, and solve for steady-state availability, MTBF, MTTF, mean up time (MUT), MTTR, and time-dependent state probabilities; transition rates can be linked from a fitted Life Data distribution. See the [Markov methodology](docs/methodology/markov-models.md).
- **Cross-module linking** — define an RBD block, fault-tree basic event, Markov transition rate, or allocation/maintenance input from a fitted Life Data distribution or a predicted failure rate, kept in sync on re-run
- **Statistical Modeling** — a combined workspace over one shared dataset, with multiple independent **Analysis tabs** (each keeps its own data and results; closing the last tab spawns a fresh blank one) and a **stale-results indicator** (an amber tab asterisk plus an in-pane banner offering to re-run whenever the data changes after computing):
  - **Descriptive Statistics** — summary statistics, frequency and contingency tables, run charts, box plots, histograms, violin and raincloud plots, scatter-matrix, correlation heatmap, normal QQ plot, and ECDF; Ctrl/⌘-click tabs to display several plots simultaneously
  - **Regression & ML** — linear, polynomial, ridge, lasso, elastic net, and logistic regression plus tree/ensemble, SVM/KNN and neural-net models, with fit statistics, **residual diagnostics** (studentized residuals, Cook's distance, normal Q-Q, Shapiro–Wilk, Durbin–Watson), plain-English interpretation, single-point prediction, and batch scoring (paste/upload rows, download predictions as CSV)
- **Hypothesis Tests** — t-tests, factorial/repeated/mixed ANOVA, chi-square, non-parametric and binomial tests; repeated measures report Mauchly plus GG/HF corrections, mixed designs use explicit REML repeated covariance, and Mann–Whitney effect direction is defined as group A relative to group B
- **Six Sigma** — a container module bundling stability-gated Process Capability, topology-validated classical/REML Gage R&R, explicit Phase-I/II SPC, and model-aware Design of Experiments: versioned rank/alias metadata, reproducible randomization, nuisance blocking, noncentral-t power planning, factorial effects, pure-error lack-of-fit, quadratic response surfaces, and constrained Scheffé mixture analysis; Predictive Analytics includes tree, ensemble, SVM/KNN and neural-network models. See the [process-analysis](docs/methodology/process-analysis.md) and [DOE methodology](docs/methodology/design-of-experiments.md).
- **Component/Event Library** — shared library in the RBD and FTA sidebars; auto-populated from LDA folios and prediction parts/groups; items snapshot a manual value, an LDA folio's fitted distribution, or a prediction part/group λ, and link to selected nodes by evaluating R (or 1−R) at a mission time
- **Projects** — named projects spanning all modules, with the project name shown in a prominent header field; **Save** and **Open** named projects directly in the browser (localStorage); project-level **units** (hours, days, weeks, months, years, cycles, km, miles) selected in the header and reflected on tables, results, and plot axes — switching between compatible units (e.g. hours↔days) offers to **convert** the existing time-valued inputs, not just relabel; import/export the whole project or a single module's data as JSON (exports are named meaningfully, prefixed with the project name and module); module state persists across tab switches and survives browser refresh (saved to localStorage)
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
