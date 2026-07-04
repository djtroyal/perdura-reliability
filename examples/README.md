# Example projects

## `demo-project.json`

A ready-to-explore demo project with **input data pre-filled in every module**, so
a new user can load it and immediately run analyses across the whole suite without
typing in or supplying their own datasets.

### How to load it

The demo is bundled into the app and always available:

1. Open the app and click **Open** in the project toolbar (top bar).
2. Under **Examples**, click **"Perdura Demo Project"**.
3. Switch between the module tabs and click each module's **Run / Compute /
   Analyze** button to generate results.

Opening the demo loads it into the current session only — it is never saved over,
so you can edit freely; use **Save** to keep a copy under your own name. You can
also still **Import** this JSON file directly.

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
| Six Sigma — Process Capability | 30 near-normal measurements (Cpk ≈ 1.33) with spec limits 9 / 11 |
| Six Sigma — SPC | A 25-point I-MR series (in control, with a final out-of-control signal) |
| Six Sigma — MSA (Gage R&R) | A 10-part × 3-operator × 2-trial crossed study |
| Six Sigma — DOE | A 3-factor two-level full-factorial design |
| Reliability Allocation | Three subsystems allocated to a 0.95 target (AGREE method) |
| Maintenance | Availability/spares (RAM) plus replacement-policy, PM-interval, cost-forecast and availability-sensitivity inputs |
| Human Reliability | Populated worksheets for THERP, HEART, SLIM, SHERPA, JHEDI, ATHEANA and MERMOS |
| Reliability Testing — RDT | Margin test, exponential χ² demonstration, Bayesian RDT and difference-detection inputs |

### Notes for maintainers

- The file matches the app's import schema (`ExportPayload` in
  `gui/frontend/src/store/project.ts`): top-level `app: "reliability-suite"`,
  `version`, `project`, `units`, `modules`.
- The same content is bundled at `gui/frontend/src/data/demoProject.json` (imported
  by `openDemoProject()` for the Open → Examples entry). Keep the two files in sync.
- Folio-based modules (`alt`, `system`, `faultTree`, `prediction`, `pof`,
  `growth`, `warranty`) are wrapped as `{ _folioWrap: true, activeId, folios:[…] }`;
  the rest are flat module state. `lifeData` keeps its own internal `folios` array.
- RBD components use direct `reliability` values and FTA basic events use direct
  `probability` values, so both diagrams compute on Run without depending on
  distribution-parameter wiring.
