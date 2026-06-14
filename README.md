<div align="center">

# Perdura

**Reliability Engineering Suite** — a fully-featured Python reliability
engineering library with an interactive web GUI.

*perdurare* (Latin) — "to endure, to last"

</div>

## Modules

### Life Data Analysis (`reliability.Fitters`)
- 13 distribution fitters: Weibull (2P/3P), Exponential (1P/2P), Normal, Lognormal (2P/3P), Gamma (2P/3P), Loglogistic (2P/3P), Beta, Gumbel
- MLE, RRX (Rank Regression on X), and RRY (Rank Regression on Y) fitting
- Support for right-censored (suspended) data
- `Fit_Everything` — fits all distributions and ranks by AICc, BIC, or AD
- Goodness-of-fit metrics: AICc, BIC, Anderson-Darling
- Confidence intervals on every fitted parameter (observed Fisher information) and
  confidence bounds on the reliability/CDF/SF curves (delta method); configurable `CI` level

### Non-Parametric Estimators (`reliability.Nonparametric`)
- Kaplan-Meier survival estimator with Greenwood confidence intervals
- Nelson-Aalen cumulative hazard estimator

### Probability Plotting (`reliability.Probability_plotting`)
- Linearized probability plots for all supported distributions
- Supports censored data via rank adjustment (Bernard's approximation)

### Accelerated Life Testing (`reliability.ALT_fitters`)
- 24 ALT fitter classes: 6 life-stress models × 4 base distributions
- Life-stress models: Exponential (Arrhenius), Eyring, Power (IPL), Dual_Exponential, Power_Exponential, Dual_Power
- `Fit_Everything_ALT` — fits all applicable models and ranks by AICc or BIC

### System Reliability (`reliability.SystemReliability`)
- Series, Parallel, K-of-N, and Network (path-set) RBD configurations
- Nested block builder via `system_reliability_from_blocks`

### Fault Tree Analysis (`reliability.FaultTree`)
- AND, OR, and VOTE (k-of-n) gates with basic events
- MOCUS minimal cut set computation
- Importance measures: Birnbaum, Fussell-Vesely, RAW, RRW

### Failure Rate Prediction (`reliability.MIL_HDBK_217F`)
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

### Reliability Demonstration Testing (`reliability.Reliability_testing`)
- Binomial RDT sample size (Method 1) and parametric Weibull test planning
  (Methods 2A/2B), with operating characteristic curves

### Reliability Growth (`reliability.Repairable_systems`)
- Crow-AMSAA (NHPP power law) model with MLE estimation
- Duane graphical (regression) method
- Growth rate, cumulative and instantaneous MTBF, Cramer-von Mises goodness of fit
- Support for failure-terminated and time-terminated tests

### Warranty Data Analysis (`reliability.Warranty`)
- Nevada Chart format: convert shipment/return matrices to life data (failures + right-censored)
- Warranty return forecasting using conditional CDF increments from any fitted distribution

### Stress-Strength Interference
- Probability of failure P = ∫ f_stress(x) · F_strength(x) dx via numerical integration
- Supports all distribution types for both stress and strength

---

## Installation

Requires Python 3.10+.

```bash
# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install the library
pip install -e .

# Install with dev dependencies (for running tests)
pip install -e ".[dev]"
```

---

## Quick Start

```python
from reliability.Fitters import Fit_Weibull_2P, Fit_Everything
from reliability.Nonparametric import KaplanMeier
from reliability.SystemReliability import SeriesSystem, ParallelSystem
from reliability.FaultTree import BasicEvent, OrGate, FaultTree
import numpy as np

# Fit a Weibull distribution
failures = np.array([55, 92, 110, 145, 180, 220, 260])
fit = Fit_Weibull_2P(failures=failures, CI=0.95)
print(fit)  # Fit_Weibull_2P(alpha=..., beta=...)

# Confidence intervals on the parameters and bounds on the survival function
print(fit.results)                       # adds Standard Error / Lower CI / Upper CI columns
print(fit.alpha_lower, fit.alpha_upper)  # 95% CI for alpha
x, sf_lower, sf_upper = fit.confidence_bounds(func='SF')

# Fit all distributions and rank
fe = Fit_Everything(failures=failures)
print(fe.best_distribution_name)

# Kaplan-Meier
km = KaplanMeier(failures=failures)
print(km.results)

# Series system
s = SeriesSystem([0.99, 0.97, 0.95])
print(f"System reliability: {s.reliability:.4f}")

# Fault tree
a = BasicEvent("Pump A fails", 0.01)
b = BasicEvent("Pump B fails", 0.02)
top = OrGate("System failure", [a, b])
ft = FaultTree(top)
print(f"Top event probability: {ft.top_event_probability:.4f}")
print(f"Minimal cut sets: {ft.minimal_cut_sets}")
```

---

## Running Tests

```bash
# All tests except slow ALT tests (~13 seconds)
.venv/bin/python -m pytest tests/ --ignore=tests/test_alt_fitters.py -q

# Full test suite including ALT (~15 minutes)
.venv/bin/python -m pytest tests/ -q
```

---

## Web GUI

An interactive web GUI is included, built with FastAPI + React.

### Features
- **Life Data Analysis** — tabular data entry (ID / Time / State columns, Tab adds rows), CSV import and spreadsheet paste; multiple **folios** (sub-tabs) for independent analyses with a **Compare Folios** view (likelihood-ratio test + likelihood contour plots overlaid at multiple confidence levels, plus folio-vs-folio stress-strength interference using each folio's fitted distribution); enter data, specify a distribution by its parameters, or generate Monte Carlo samples; MLE/RRX/RRY fitting with manual confidence level entry, per-parameter CI tables, shaded confidence bands, and plots that update instantly when clicking through fitted distributions; Kaplan-Meier / Nelson-Aalen estimators; set-distribution selection; quick reliability calculator (R/F/f/h at time t); stress-strength interference tool
- **Accelerated Life Testing** — input failures and stress levels, select ALT models, view ranked results and an interactive life-stress plot; consolidated Test Planner: check non-parametric for Method 1, or fill in either available test time (solves samples) or sample size (solves test time) for the parametric Weibull methods, with options table and OC curve; acceleration factor calculator (Arrhenius, IPL, Eyring)
- **Failure Rate Prediction** — system hierarchy with **System Blocks** as nestable containers for piece parts (and other blocks), rendered as an indented, collapsible parts list with per-block λ subtotals; JSON import/export; all MIL-HDBK-217F part categories plus custom exponential/Weibull parts and per-part multipliers; inline part detail/edit panel with pi-factor breakdown; base method is always MIL-HDBK-217F with the ANSI/VITA 51.1 COTS supplement applied globally or overridden per part; contribution pie chart
- **System Reliability (RBD)** — drag-and-drop canvas: place component nodes, connect Source → components → Sink, edit reliabilities; computes system reliability, minimal path sets, and importance measures (Birnbaum, Criticality, RAW, RRW); auto-layout
- **Fault Tree Analysis** — drag-and-drop canvas: place AND/OR/VOTE/PAND/XOR/NOT/Transfer gates and basic events with SVG shapes, connect parent → child; computes top-event probability, minimal cut sets (click to highlight on diagram), and importance measures; auto-layout
- **Physics of Failure** — S-N curve fitting (Basquin's law), Ramberg-Osgood stress-strain curves, Larson-Miller creep life prediction, Miner's rule linear damage accumulation, LEFM fracture mechanics with Paris law crack growth, Coffin-Manson strain-life (low-cycle fatigue), Norris-Landzberg solder-joint thermal fatigue, Black's equation electromigration, Peck's temperature-humidity model, and Arrhenius thermal acceleration
- **Reliability Growth** — Crow-AMSAA (NHPP power law) and Duane model fitting from cumulative failure times entered manually or pulled from a Life Data folio; results summary with growth rate, cumulative and instantaneous MTBF; cumulative failures and MTBF vs time plots
- **Warranty Analysis** — full-width Nevada Chart data entry (editable upper-triangular shipment/return matrix with add/remove rows and columns); converts to life data; fits a distribution and forecasts expected future warranty returns per lot and period; forecast table and bar chart
- **Component/Event Library** — shared library in the RBD and FTA sidebars; auto-populated from LDA folios and prediction parts/groups; items snapshot a manual value, an LDA folio's fitted distribution, or a prediction part/group λ, and link to selected nodes by evaluating R (or 1−R) at a mission time
- **Projects** — named projects spanning all modules; project-level **time units** (hours, days, cycles, …) selected in the header and reflected on tables, results, and plot axes; import/export the whole project or a single module's data as JSON from the header bar; module state persists across tab switches and survives browser refresh (saved to localStorage)
- Export results as CSV

### Prerequisites

- Node.js 18+ and npm
- Python virtual environment with library installed (see Installation above)

### Running

```bash
bash gui/start.sh
```

Then open **http://localhost:5173** in your browser.

The start script launches:
- FastAPI backend on `http://localhost:8000`
- Vite dev server on `http://localhost:5173`

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
