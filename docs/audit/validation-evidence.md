# Perdura methodology audit — validation evidence

Generated: 2026-07-10

This file records the independently recomputed probes used in the audit. The probes call the current public Python functions or API-router functions, then compare their outputs with dimensional identities, analytic special cases, or direct reference calculations. They are evidence for the audit, not a replacement test suite.

## Baseline

- `pytest -q`: **946 passed** in 52.74 seconds.
- Warnings: seven numerical warnings, including invalid operations during ALT optimization and a divide-by-zero power evaluation in a three-parameter Weibull path.
- Reviewed surface: 295 public core classes/functions in 32 `src/reliability` modules; 114 calculation endpoints in 21 router domains; 28,607 Python source lines across those locations.

## Independently recomputed probes

| Finding | Probe | Current result | Reference result | Basis |
|---|---|---:|---:|---|
| F001 | One MIL-HDBK-217F resistor, 0.02881996 FPMH, 1000 h mission | MTBF 34.7 h; R = 0 | MTBF 34,698,174.46 h; R = 0.9999711805 | Convert FPMH to failures/hour before `1/lambda` and `exp(-lambda*t)` |
| F002 | Exponential RDT: MTBF 500, T=10,000, one-sided 90% lower bound | 0 allowable failures | 13 allowable failures; count 14 gives lower bound 496.8201 | Direct enumeration of `2T / chi2.ppf(0.9, 2f+2) >= 500` |
| F003 | 21 minimal cut sets `{A,B_i}`, all basic-event probabilities 0.1 | 0.1902721318 | 0.0890581011 | Exact identity `P(A and any B_i)=0.1*(1-0.9^21)` |
| F004 | Three 10-unit steps at stresses 1, 2, 4; p=2; failures at cumulative times 21 and 25 | Equivalent times 36 and 100 | 66 and 130 | Cumulative exposure sums every completed step: `10*1 + 10*4 + current*16` |
| F007 | `AICc(loglik=-10,k=5,n=4)` | 30 (ordinary AIC) | Undefined/ineligible because `n-k-1=-2` | Published AICc denominator |
| F008 | Weibull eta=1, beta=2 at t=30 and t=100 | h=0 at both; H=690.7755 at both | h=60/H=900; h=200/H=10,000 | Analytic Weibull `h=beta*t^(beta-1)` and `H=t^beta` |
| F014 | AGREE target 0.9; equal complexity; importance 0.5 and 1.0 | Achieved 0.8538149682 | Target should be conserved at 0.9 | Product check on allocated subsystem reliabilities |
| F015 | Two-component series RBD, R=[0.9,0.8], first component | Criticality 1.0 | 0.2857142857 | Failure criticality `Birnbaum*q_i/Q_system` |
| F018 | Exponential eta=100 after burn-in time 20 | Mean residual life 86.467 | 100 | Exponential memoryless property; current quadrature stops at `2*eta` |
| F019 | Age replacement, beta=0.7, alpha=100, PM=1, CM=5 | Finite optimum 300; cost 0.0454613 | Run-to-failure; cost 0.0395000 | Finite grid boundary is worse than corrective-only baseline |
| F019 | Age replacement, beta=1, same costs | Finite optimum 300; cost 0.0505315 | Run-to-failure; cost 0.05 | Constant hazard has no improving finite age-replacement interval |
| F025 | OLS with two duplicate predictors plus intercept | Rank 2 for 3 parameters; returns coefficients and p=0 | Inferential fit is rank deficient | Direct matrix-rank calculation |
| F027 | Mann-Whitney with A=[10,11], B=[0,1] | Rank-biserial effect -1 | +1 under A-minus-B direction | All A observations exceed all B observations |
| F039 | Weibayes survival band at an interior grid point | `sf_lower` 0.7167; central 0.3585; `sf_upper` 0.0913 | Semantic lower 0.0913; upper 0.7167 | Survival increases monotonically with eta |

## Test adequacy examples

Two existing tests demonstrate why audit confidence is not inferred from pass/fail status alone:

- `tests/test_mission_profile.py:374-389` recomputes system reliability using the same unconverted FPMH value, so it verifies implementation consistency while preserving the unit error.
- `tests/test_weibayes.py:199-209` explicitly asserts `sf_upper <= sf <= sf_lower`, preserving reversed field names.

The reliability-test planner test checks only that the solved failure count is an integer; it does not check the maximum passing boundary (`tests/test_reliability_testing_extras.py:51-60`).

## Reproduction environment

- Repository branch: `agent/pof-wizard-latex-lda-compare`
- Python environment: repository `.venv`
- Probe import path: `PYTHONPATH=src:gui/backend`
- External calculations: SciPy chi-square quantiles and direct analytic formulas shown above

Exact floating-point values are preserved in the report snapshot. Results can vary only in insignificant trailing digits across compatible NumPy/SciPy versions.
