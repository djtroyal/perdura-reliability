# Perdura methodology remediation backlog

Generated: 2026-07-10

This backlog converts the methodology audit into implementation work. Priority reflects decision impact, probability of user exposure, and whether a flaw can silently produce a plausible result. Effort is an engineering estimate, not a schedule commitment.

## Release gates

- Treat P0 outputs as **not decision-grade** until corrected and independently checked.
- For every changed mathematical result, add an analytic identity, a published worked example, and an adversarial boundary test.
- Preserve old response keys only when their semantics remain valid. For corrected units or reversed meanings, version the response or provide a time-bounded compatibility alias with a visible warning.
- Every numerical optimizer must return convergence, boundary, identifiability and uncertainty diagnostics through a shared result contract.
- A standards-branded calculator may be labeled conforming only after edition/clause traceability and authoritative example parity are documented.

## P0 — correctness blockers

| Order | Work item | Findings | Effort | Definition of done |
|---:|---|---|---|---|
| 1 | Correct system mission-rate units and fail-closed input handling | F001, F006 | S | Convert FPMH exactly once; one-part system equals per-part MTBF/R; invalid parts return structured errors; migrate the existing self-consistency test. |
| 2 | Replace the RDT failure-count search | F002 | S | Return the maximum passing integer; prove monotonicity in code comments; tests cover zero, interior, boundary and infeasible cases. |
| 3 | Restore truthful fault-tree method semantics | F003 | M | `exact` is exact or unavailable; bounds and simulation have distinct labels/status; shared-event 21-cut-set case matches 0.0890581011. |
| 4 | Reimplement step-stress cumulative exposure | F004 | M | Sum all prior accelerated exposure; validate two- and multi-step worked examples; reject non-monotone/duplicate step definitions that make mapping ambiguous. |
| 5 | Remove the pseudo interval-censored degradation fit | F005 | L | Implement a true interval likelihood or separate projection uncertainty; retain non-crossing units as censored; simulation recovers known lifetime parameters without duplication bias. |

## P1 — numerical and inferential integrity

| Order | Work item | Findings | Effort | Definition of done |
|---:|---|---|---|---|
| 6 | Build a shared log-domain distribution and likelihood layer | F008, F010 | L | Use analytic/log-domain SF, PDF, hazard and CHF; extreme-tail identities remain finite/accurate; no probability clipping inside optimization except documented guarded transforms. |
| 7 | Make model eligibility and optimizer status first-class | F007, F009, F038 | L | Invalid AICc is ineligible; fits require successful termination and finite diagnostics; mixtures expose component collapse and multi-start stability. |
| 8 | Add calibrated uncertainty engines | F011, F040 | L | Profile likelihood and parametric bootstrap are available for key life/reliability targets; beta uncertainty can be propagated; coverage is checked by simulation. |
| 9 | Replace fitted-parameter goodness-of-fit p-values | F012, F013 | M | Parametric bootstrap refits each replicate; sparse chi-square cases merge bins or decline inference; reports describe the null and calibration method. |
| 10 | Correct allocation and importance semantics | F014, F015 | M | AGREE conserves the target under the cited formulation; RBD labels/formulas match standard Birnbaum, criticality, RAW and RRW reference networks. |
| 11 | Correct burn-in and replacement decisions | F018, F019 | M | Mean residual life uses an analytic/adaptive infinite-tail calculation; beta<=1 returns run-to-failure; grid-boundary solutions are never called optima without expansion and baseline dominance. |
| 12 | Add regression and predictive validation guardrails | F025, F034, F035, F048 | L | Rank deficiency blocks inference; preprocessing is split-safe; group/time/stratified evaluation is selectable; convergence, calibration and nested-selection diagnostics are reported. |
| 13 | Establish standards-conformance tiers | F022 | XL | Each prediction/derating model has edition, clause/table provenance, supported scope, example parity and a `conforming/partial/screening` badge; unsupported branded claims are renamed. |

## P2 — model adequacy and workflow upgrades

| Order | Work item | Findings | Effort | Definition of done |
|---:|---|---|---|---|
| 14 | Add dynamic/dependent and scalable system reliability | F016, F017, F045, F046 | XL | PAND has order-aware semantics or is disabled; common-cause models are available; BDD/ZBDD exact results match enumeration; rare-event intervals remain non-degenerate. |
| 15 | Modernize repairable-system and maintenance analysis | F020, F021, F041, F042, F043 | XL | Event/censor status is explicit; Nelson MCF variance is benchmarked; invalid Duane regimes are withheld; virtual-age and stochastic spares simulations include uncertainty. |
| 16 | Add process-analysis preconditions and robust alternatives | F024, F029, F030, F031 | XL | Capability requires stability status; Phase I and II are separate; Gage R&R validates topology and supports REML; nonnormal capability reports bootstrap sensitivity. |
| 17 | Make HRA method names and workflows defensible | F023 | XL | Screening heuristics are renamed; at least SPAR-H includes PSFs, dependency and beta uncertainty; ATHEANA/MERMOS labels are reserved for implemented workflows. |
| 18 | Add PoF dimensional safety and model sensitivity | F026, F047 | XL | Every endpoint validates units/signs/regimes; deterministic and uncertainty outputs are distinct; alternative fatigue/crack-growth/damage models can be compared over shared inputs. |
| 19 | Harden ALT extrapolation and identifiability | F036, F037 | L | Use-stress range, mechanism/common-shape and design-rank diagnostics are visible; physical constraints and profile/bootstrap extrapolation intervals are available. |
| 20 | Correct remaining statistical semantics | F027, F028, F032, F033, F039, F044 | L | Effect direction, sphericity, DOE level validation, PB capacity, semantic Weibayes field names and warranty censoring each have reference tests. |

## P3 — portfolio expansion

| Order | Work item | Findings | Effort | Definition of done |
|---:|---|---|---|---|
| 21 | Extend DOE planning and analysis | F049 | XL | Design metadata, power, randomization, blocking, alias/lack-of-fit diagnostics and response-surface/mixture/constrained designs share one validated contract. |
| 22 | Add non-memoryless transition models | F050 | L | Markov results display CTMC assumptions and uncertainty; semi-Markov or phase-type alternatives are available for non-exponential dwell times. |

## Cross-cutting validation program

1. Create a versioned **golden-method corpus**: analytic special cases, public handbook examples and seeded simulation recovery cases.
2. Add property tests for dimensional consistency, monotonicity, probability bounds, label ordering and equivalent parameterizations.
3. Run simulation coverage studies for every confidence interval and hypothesis-test path; publish nominal versus empirical coverage.
4. Add metamorphic tests: swapping group order flips signed effects; duplicating units changes exposure but not units; equivalent series/parallel representations agree; changing time units leaves dimensionless reliability unchanged.
5. Add a result-quality banner (`validated`, `approximate`, `screening`, `insufficient-data`, `non-converged`) so the UI cannot flatten unlike evidence into equally precise cards.

## Suggested ownership sequence

- Reliability/statistics core: items 2, 6–12, 15, 19–20.
- System safety/modeling: items 3–5 and 14.
- Prediction standards/PoF: items 1, 13 and 18.
- Quality engineering/experimentation: items 16 and 21.
- Human factors: item 17 with a qualified HRA subject-matter reviewer.
- Platform/UI: result-quality contract and compatibility migrations across all items.
