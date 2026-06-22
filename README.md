<div align="center">

# Perdura

**Reliability Engineering and Statistics Suite** — an interactive web application for
reliability engineering and statistics, covering life data analysis, accelerated testing,
system reliability, fault trees, physics of failure, reliability growth,
warranty analysis, statistical modeling, and a full Six Sigma toolkit.

*perdurare* (Latin) — "to endure, to last"

</div>

## Modules

### Life Data Analysis
- 13 distribution fitters: Weibull (2P/3P), Exponential (1P/2P), Normal, Lognormal (2P/3P), Gamma (2P/3P), Loglogistic (2P/3P), Beta, Gumbel
- MLE, RRX (Rank Regression on X), and RRY (Rank Regression on Y) fitting
- Support for right-censored (suspended) data
- `Fit_Everything` — fits all distributions and ranks by AICc, BIC, or AD
- Goodness-of-fit metrics: AICc, BIC, Anderson-Darling
- Confidence intervals on every fitted parameter (observed Fisher information) and
  confidence bounds on the reliability/CDF/SF curves (delta method); configurable `CI` level

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

### Reliability Growth
- Crow-AMSAA (NHPP power law) model with MLE estimation
- Duane graphical (regression) method
- Growth rate, cumulative and instantaneous MTBF, Cramer-von Mises goodness of fit
- Support for failure-terminated and time-terminated tests

### Warranty Data Analysis
- Nevada Chart format: convert shipment/return matrices to life data (failures + right-censored)
- Warranty return forecasting using conditional CDF increments from any fitted distribution

### Stress-Strength Interference
- Probability of failure P = ∫ f_stress(x) · F_strength(x) dx via numerical integration
- Supports all distribution types for both stress and strength

---

## Getting Started

Perdura is a web application: a FastAPI backend serves the analyses and a React
front end provides the interactive UI. The included start script launches both.

### Prerequisites

- Python 3.10+
- Node.js 18+ and npm

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

---

## Features
- **Life Data Analysis** — tabular data entry (ID / Time / State columns, Tab adds rows), CSV import and spreadsheet paste; multiple **folios** (sub-tabs) for independent analyses with a **Compare Folios** view (likelihood-ratio test + likelihood contour plots overlaid at multiple confidence levels, plus folio-vs-folio stress-strength interference using each folio's fitted distribution); enter data, specify a distribution by its parameters, or generate Monte Carlo samples; MLE/RRX/RRY fitting with manual confidence level entry, per-parameter CI tables, shaded confidence bands, and plots that update instantly when clicking through fitted distributions; Kaplan-Meier / Nelson-Aalen estimators; set-distribution selection; quick reliability calculator (R/F/f/h at time t); stress-strength interference tool
- **Accelerated Life Testing** — input failures and stress levels, select ALT models, view ranked results and an interactive life-stress plot; consolidated Test Planner: check non-parametric for Method 1, or fill in either available test time (solves samples) or sample size (solves test time) for the parametric Weibull methods, with options table and OC curve; acceleration factor calculator (Arrhenius, IPL, Eyring)
- **Failure Rate Prediction** — system hierarchy with **System Blocks** as nestable containers for piece parts (and other blocks), rendered as an indented, collapsible parts list with per-block λ subtotals; JSON import/export; all MIL-HDBK-217F part categories plus custom exponential/Weibull parts and per-part multipliers; inline part detail/edit panel with pi-factor breakdown; base method is always MIL-HDBK-217F with the ANSI/VITA 51.1 COTS supplement applied globally or overridden per part; contribution pie chart
- **System Reliability (RBD)** — drag-and-drop canvas: place component nodes, connect Source → components → Sink, edit reliabilities; computes system reliability, minimal path sets, and importance measures (Birnbaum, Criticality, RAW, RRW); auto-layout
- **Fault Tree Analysis** — drag-and-drop canvas: place AND/OR/VOTE/PAND/XOR/NOT/Transfer gates and basic events with SVG shapes, connect parent → child; computes top-event probability, minimal cut sets (click to highlight on diagram), and importance measures; auto-layout
- **Physics of Failure** — S-N curve fitting (Basquin's law), Ramberg-Osgood stress-strain curves, Larson-Miller creep life prediction, Miner's rule linear damage accumulation, LEFM fracture mechanics with Paris law crack growth, Coffin-Manson strain-life (low-cycle fatigue), Norris-Landzberg solder-joint thermal fatigue, Black's equation electromigration, Peck's temperature-humidity model, and Arrhenius thermal acceleration
- **Reliability Growth** — Crow-AMSAA (NHPP power law) and Duane model fitting from cumulative failure times entered manually or pulled from a Life Data folio; results summary with growth rate, cumulative and instantaneous MTBF; cumulative failures and MTBF vs time plots
- **Warranty Analysis** — full-width Nevada Chart data entry (editable upper-triangular shipment/return matrix with add/remove rows and columns); converts to life data; fits a distribution and forecasts expected future warranty returns per lot and period; forecast table and bar chart
- **Statistical Modeling** — a combined workspace over one shared dataset, with multiple independent **Analysis tabs** (each keeps its own data and results; closing the last tab spawns a fresh blank one) and a **stale-results indicator** (an amber tab asterisk plus an in-pane banner offering to re-run whenever the data changes after computing):
  - **Descriptive Statistics** — summary statistics, frequency and contingency tables, run charts, box plots, histograms, violin and raincloud plots, scatter-matrix, correlation heatmap, normal QQ plot, and ECDF; Ctrl/⌘-click tabs to display several plots simultaneously
  - **Regression & ML** — linear, polynomial, ridge, lasso, elastic net, and logistic regression plus tree/ensemble, SVM/KNN and neural-net models, with fit statistics, diagnostics, plain-English interpretation, single-point prediction, and batch scoring (paste/upload rows, download predictions as CSV)
- **Hypothesis Tests** — t-tests (one-sample, two-sample, paired), one-/two-/repeated-measures and mixed ANOVA, chi-square (independence and goodness-of-fit), non-parametric tests (Mann-Whitney, Wilcoxon, Kruskal-Wallis, Friedman), binomial, and normality tests — each with a plain-English interpretation
- **Six Sigma** — a container module bundling Process Capability (Cp/Cpk/Pp/Ppk), MSA / Gage R&R, SPC control charts (I-MR, Xbar-R/S, p, np, c, u with Western Electric rules), Design of Experiments, and Predictive Analytics (decision tree, random forest, gradient boosting, SVM, KNN, AdaBoost, neural network, and CHAID); results include plain-English interpretation
- **Component/Event Library** — shared library in the RBD and FTA sidebars; auto-populated from LDA folios and prediction parts/groups; items snapshot a manual value, an LDA folio's fitted distribution, or a prediction part/group λ, and link to selected nodes by evaluating R (or 1−R) at a mission time
- **Projects** — named projects spanning all modules, with the project name shown in a prominent header field; **Save** and **Open** named projects directly in the browser (localStorage); project-level **time units** (hours, days, cycles, …) selected in the header and reflected on tables, results, and plot axes; import/export the whole project or a single module's data as JSON (exports are named meaningfully, prefixed with the project name and module); module state persists across tab switches and survives browser refresh (saved to localStorage)
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
