# Reliability standards and CRE BoK opportunity audit

Date: 2026-07-22
Status: implementation-oriented gap analysis; not a conformance certificate

## Sources reviewed

- local 2018 ASQ Certified Reliability Engineer Body of Knowledge;
- current public 2025 ASQ CRE Body of Knowledge;
- local MIL-HDBK-338B and Rome Laboratory Reliability Engineer's Toolkit;
- local RL-TR-91-180 diagnostic-performance guidance;
- local MIL-HDBK-217F, VITA 51.1, MIL-STD-975M, MIL-STD-883, RADC/Rome
  technical reports, and topic-specific reliability texts;
- public metadata/guidance for IEEE 1633-2016, IEEE 982-2024,
  NASA-STD-8739.8B, NASA-HDBK-2203D, ISO/IEC 25010:2023,
  ISO/IEC 5055:2021, IEC dependability standards, MIL-STD-882E,
  MIL-HDBK-189C, MIL-HDBK-781B, and the NIST/SEMATECH handbook.

Several IEEE/IEC/ISO normative texts are controlled publications. Public
catalog descriptions establish relevance but are not enough to claim clause
conformance.

## Coverage and opportunities

| Capability | Current Perdura coverage | Opportunity | Priority/status |
|---|---|---|---|
| Software reliability growth | Previously absent | Exposure-indexed HPP, Goel–Okumoto, Musa–Okumoto, power-law, delayed S-shaped comparison; diagnostics and release projections | **Implemented in this change**; deeper standards verification pending |
| Reliability-growth management | Crow–AMSAA, Duane, ROCOF, MCF assessment plus anchored target planning and delayed-fix/growth-potential sensitivity | Phase-aware planning and additional NHPP planning laws | **Core planning implemented**; expansion remains |
| FMEA/FMECA | Linked record workflow, ordinal RPN screen, severity override, optional mode criticality, actions and cross-links | Clause-level IEC 60812 verification and richer functional/process variants | **Core implemented**; licensed-standard review pending |
| Hazard/system safety | MIL-STD-882E Table III initial/residual register, mitigation, verification, authority, and FMEA links | Hazard log imports and configurable program category definitions | **Core implemented** |
| FRACAS and corrective action | Closed-loop records, exposure rate/interval, Pareto, effectiveness, recurrence, downtime and FMEA links | Fleet/cohort exposure histories, reliability-change inference, CAPA workflow integrations | **Core implemented** |
| Testability and diagnostics | Weighted FFD/FFI, ambiguity threshold, detecting-test links and undetected-fault list | Dependency matrix, false alarm metrics and fault-insertion demonstration planning | **Core accounting implemented** |
| Reliability requirements/evidence | Requirement objects, completeness/readiness screen, owner/status and evidence IDs | Demonstration-plan compatibility checks and richer evidence repository links | **Core traceability implemented** |
| General probabilistic risk | Equation Monte Carlo in LDA | Correlated inputs, Latin hypercube/QMC, thresholds, convergence and global sensitivity | Medium-high |
| RCM | Consequence/task/interval/rationale workflow linked to FMEA | Full decision logic and quantitative task-effectiveness/cost integration | **Core record workflow implemented** |
| Survival regression | General regression but no censored Cox model | Cox proportional hazards, diagnostics, strata and time-varying extensions | Medium |
| System effectiveness/trade studies | Individual allocation/RAM tools | Joint reliability/availability/maintainability/cost/weight Pareto studies | Medium |
| Supplier and COTS assurance | Parts prediction/component library | Supplier evidence, approved-parts, field-vs-prediction monitoring and obsolescence | Medium |
| Dynamic/shared-load reliability | RBD/FTA/Markov coverage | Shared-load/dynamic RBD profiles and specialized sneak-circuit analysis | Lower/specialized |

## Key findings

1. **Quantitative software reliability was the largest analytical omission.**
   MIL-HDBK-338B devotes §9 to software prediction, estimation, allocation,
   operational testing, and reliability analysis. IEEE 1633 supplies a more
   current lifecycle framework. The new module addresses model-based
   estimation without elevating historical handbook formulas merely because
   they are printed in the handbook.
2. **Perdura is stronger at calculations than closed-loop reliability
   management.** FMEA/FMECA, hazard records, FRACAS, failure review, RCA/CAPA,
   and traceable requirements would connect current analyses to decisions and
   corrective actions.
3. **Growth assessment should be extended into growth planning.** Current
   Crow–AMSAA/MCF results characterize observed recurrence. MIL-HDBK-189C and
   MIL-HDBK-338B also support target planning, delayed corrective action, and
   growth-potential management.
4. **Diagnostic performance is a distinct engineering result.** RL-TR-91-180
   supports explicit FFD/FFI and ambiguity-group analysis. Live fault insertion
   alone should not be presented as exact validation when fault-mode/rate
   uncertainty is unresolved.
5. **The 2025 CRE BoK expands the expected breadth.** Notable additions include
   Cox proportional hazards, RCM, operational profiles, fault injection,
   software/firmware reliability, AI/big-data evidence, cybersecurity risk,
   digital twins, and lifecycle/supplier performance monitoring.

## Recommended delivery sequence

1. Complete validation and standards cross-checking of the new Software
   Reliability Engineering module.
2. Add reliability-growth planning and release/build segmentation.
3. Build integrated FMEA/FMECA, hazard, and FRACAS workflows.
4. Add testability/diagnostics and general probabilistic-risk analyses.
5. Add reliability requirements/evidence, RCM, and supplier assessment.
6. Add censored survival regression and other CRE statistical extensions.

## Implementation disposition

This change implements the product work in the first three delivery stages and
the record-oriented parts of stages 4 and 5; standards validation remains
bounded by the source-access qualifications below:

- Software reliability event/grouped-data likelihoods, candidate comparison,
  diagnostics, uncertainty, operational-profile context, and release projection;
- anchored growth planning plus delayed corrective-action and fix-effectiveness
  sensitivity;
- one Reliability Program workspace covering FMEA/FMECA, hazards, FRACAS,
  requirements/evidence, weighted testability, and RCM;
- typed cross-record link integrity, API contracts, report assets, Help topics,
  methodology records, and demo data.

The following items deliberately remain backlog rather than being represented as
complete: general correlated probabilistic risk, Cox survival regression,
supplier/COTS assurance, advanced diagnostic dependency and false-alarm models,
full RCM decision optimization, release change-point inference, and
clause-by-clause checks against unavailable controlled standards.

Every standards-derived method must store source edition, locator, assumptions,
applicability, implementation status, and verification evidence. Historical or
partially reviewed methods must remain labeled standards-informed, legacy, or
screening as appropriate.

## Controlled references requested

To move from standards-informed behavior to reviewed conformance boundaries,
place licensed copies—when permitted—in `docs/references/`:

- IEEE 1633-2016;
- IEEE 982-2024;
- IEC 62628:2012;
- IEC 60812:2018;
- IEC 60300-1:2024;
- IEC 60300-3-4:2022;
- ISO/IEC 25010:2023; and
- ISO/IEC 5055:2021.

Public NASA, NIST, MIL-HDBK-189C, MIL-HDBK-781B, and MIL-STD-882E material can
be obtained and reviewed without redistribution of controlled texts.
