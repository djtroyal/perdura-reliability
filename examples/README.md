# Example projects

## `demo-project.json`

A ready-to-explore demo project with **input data pre-filled across the suite**.
Load it to explore the architecture and run statistical and reliability examples
without supplying your own datasets. FMEA studies are drafts: their remaining
failure and risk-analysis prerequisites are shown in the analysis workspace.

The shared System Model is a fictional twin-electric **Aircraft**, with eight L2
systems: propulsion, electrical power, flight controls, avionics, hydraulics,
landing gear, airframe, and thermal/environmental systems. Each branch continues
through L3 subsystems to L4 components. Expand the structure or Interfaces diagram
to explore the lower levels; the diagram initially shows the collapsed L2 systems.
Functions, resources, interfaces, and parent-function support are defined across
the hierarchy. The original redundant pumps and controller are part of Hydraulics.

Architecture terminology draws on the [FAA aircraft systems handbook](https://www.faa.gov/regulationspolicies/handbooksmanuals/aviation/phak/chapter-7-aircraft-systems)
and [NASA electric-aircraft research](https://www.nasa.gov/directorates/armd/x-57-technical-papers/).
The example is illustrative; its numerical assumptions and analysis ratings are
training inputs, not aircraft qualification or certification evidence.

### How to load it

The demo is bundled into the app and always available:

1. Open the app and click **Open** in the project toolbar (top bar).
2. Under **Examples**, click **"Perdura Demo Project"**.
3. Switch between the module tabs and click each module's **Run / Compute /
   Analyze** button to generate results.

Opening the demo loads it into the current session only — it is never saved over,
so you can edit freely; use **Save** to keep a copy under your own name. You can
also still **Import** this JSON file directly.

Most examples contain inputs ready for **Run / Compute / Analyze**. A few retain
small calculated results to demonstrate linked analyses, including the essential
backup-power RBD. Changing analysis inputs requires a fresh calculation.

### What's included

| Area | Pre-filled with |
|------|-----------------|
| Life Data Analysis | A censored bearing-life dataset (failures + suspensions), all distributions selected, parametric mode |
| Reliability Testing (ALT) | Temperature-accelerated failure times at three stress levels + use-level stress |
| System Modeling — **System Definition** | Shared Aircraft architecture through L4, with resource functions and interfaces |
| System Modeling — **RBD** | Aircraft hydraulic supply (two parallel pumps in series with a controller), plus essential backup power |
| System Modeling — **FTA** | Aircraft hydraulic pressure loss (both pumps, controller, or power loss), plus independent gate-logic examples |
| System Modeling — **Markov** | A 3-state operating/degraded/failed repairable chain with transition rates |
| Failure Rate Prediction | Hydraulic controller board ground qualification example: microprocessor, resistors, capacitors (MIL-HDBK-217F); original GF/GB assumptions retained |
| FMEA | Draft hydraulic controller DFMEA, assembly PFMEA, and monitoring supplement, linked to the shared architecture |
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
  `gui/frontend/src/store/project.ts`): top-level `app: "Perdura"`, subtitle,
  website,
  `schemaVersion`, `createdWith`, `engineRevisions`, `project`, `units`, `modules`.
- The same content is bundled at `gui/frontend/src/data/demoProject.json` (imported
  by `openDemoProject()` for the Open → Examples entry). Keep the two files in sync.
- To regenerate both copies, install frontend dependencies and run
  `python tools/refresh_demo_project.py --write --check`. The Aircraft model is
  authored in `tools/build_aircraft_demo_model.py`; linked analyses are rebuilt
  through the application's canonical adapters by
  `gui/frontend/scripts/materializeAircraftDemo.mjs`. The generated manifest
  checks source and artifact fingerprints with `--check` in Python-only CI.
- Folio-based modules (`alt`, `system`, `faultTree`, `prediction`, `pof`,
  `growth`, `warranty`) are wrapped as `{ _folioWrap: true, activeId, folios:[…] }`;
  the rest are flat module state. `lifeData` keeps its own internal `folios` array.
- RBD components use direct `reliability` values and FTA basic events use direct
  `probability` values, so both diagrams compute on Run without depending on
  distribution-parameter wiring.
