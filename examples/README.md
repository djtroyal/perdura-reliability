# Example projects

## `demo-project.json`

A ready-to-explore demo project with **input data pre-filled in every module**, so
a new user can load it and immediately run analyses across the whole suite without
typing in or supplying their own datasets.

### How to load it

1. Open the app and look at the project toolbar (top bar).
2. Click **Import → "Everything in file (project)"**.
3. Select `examples/demo-project.json`.
4. Switch between the module tabs and click each module's **Run / Compute /
   Analyze** button to generate results.

> Results are intentionally **not** included — the suite strips computed results on
> export/save, and the point of the demo is to let you press "Run" yourself. Every
> module ships with valid inputs, so each analysis computes on the first click.

### What's included

| Area | Pre-filled with |
|------|-----------------|
| Life Data Analysis | A censored bearing-life dataset (failures + suspensions), all distributions selected, parametric mode |
| Reliability Testing (ALT) | Temperature-accelerated failure times at three stress levels + use-level stress |
| System Modeling — **RBD** | A redundant-pump block diagram (two parallel pumps in series with a controller) |
| System Modeling — **FTA** | A fault tree (top OR gate over an AND of both pumps, plus controller and power-loss events) |
| System Modeling — **Markov** | A 3-state operating/degraded/failed repairable chain with transition rates |
| Failure Rate Prediction | A small controller board: microprocessor, resistors, capacitors (MIL-HDBK-217F) |
| Physics of Failure | An S-N fatigue curve dataset |
| Reliability Growth | A Crow-AMSAA cumulative-failure test sequence |
| Warranty Analysis | A Nevada chart of shipments and field returns |
| Hypothesis Tests | A two-sample t-test on two measurement groups |
| Statistical Modeling | A shared x1/x2/y dataset (drives Descriptive Statistics and Regression & ML) |
| Six Sigma — Process Capability | ~20 near-normal measurements with spec limits |
| Six Sigma — SPC | An I-MR control-chart series |
| Six Sigma — MSA (Gage R&R) | A 5-part × 3-operator × 2-trial study |
| Six Sigma — DOE | A 3-factor two-level full-factorial design |

### Notes for maintainers

- The file matches the app's import schema (`ExportPayload` in
  `gui/frontend/src/store/project.ts`): top-level `app: "reliability-suite"`,
  `version`, `project`, `units`, `modules`.
- Folio-based modules (`alt`, `system`, `faultTree`, `prediction`, `pof`,
  `growth`, `warranty`) are wrapped as `{ _folioWrap: true, activeId, folios:[…] }`;
  the rest are flat module state. `lifeData` keeps its own internal `folios` array.
- RBD components use direct `reliability` values and FTA basic events use direct
  `probability` values, so both diagrams compute on Run without depending on
  distribution-parameter wiring.
