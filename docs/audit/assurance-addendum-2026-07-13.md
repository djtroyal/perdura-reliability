# Methodology audit assurance addendum — 2026-07-13

## Disposition of the prior re-audit conclusion

The statement “release gate passed within disclosed scope” in the 2026-07-11
re-audit is retained as a historical result for its original regression scope.  It
must **not** be interpreted as certification that every Perdura model is complete,
mathematically correct, statistically calibrated, or semantically consistent
across the application.

The re-audit primarily checked whether the original findings had been remediated.
That is a useful regression exercise, but it is not a fresh requirements-based
model audit.  The Crow–AMSAA review on 2026-07-13 found material defects outside
that resolution checklist:

- an incorrect failure-terminated Cramér–von Mises shape correction;
- nominal current-MTBF intervals with material undercoverage;
- a pooled power-law estimator that is not the likelihood maximum under unequal
  observation ends;
- ambiguous termination semantics across API paths;
- rejection of tied data used by the governing handbook;
- an unsafe conversion from independent-unit life data to recurrent-event data;
- omission of the handbook grouped interval-count method and required intensity
  diagnostic.

The independent challenge pass then found additional issues that a formula-only
review would also have missed:

- incorrect lower/upper index handling in the time-terminated Crow coefficient
  construction and no direct one-sided current-MTBF bound;
- nonuniform coverage of the handbook grouped coefficient approximation, which
  requires an explicit approximate label and a separate target-profile option;
- misattribution of the reproducible 27-event fixture to MIL-HDBK-189C even
  though that edition states 45 failures while printing only 27 times;
- nullable MCF results that could cross the JSON boundary as NaN, cluster
  bootstrap intervals that could condition on supported resamples, and MCF
  state/report integration that did not preserve the mathematical contract; and
- an assurance record broad enough to let exact-event Crow, grouped Crow, pooled
  parametric NHPP, and non-parametric MCF inherit one another's evidence.

Several existing tests passed because they duplicated the production formula,
tested only one design branch, asserted only positivity/order, or never inventoried
the missing capability.  Test count and regression status therefore cannot be
used as substitutes for independent scientific verification.

## Corrective assurance policy

The [model-assurance framework](model-assurance-framework.md) now governs claims
that a model is verified.  The machine-readable
[`model-assurance-matrix.json`](model-assurance-matrix.json) inventories current
certification state.  Its ordinary gate verifies inventory structure and prevents
unsupported promotion of a model.  Its strict gate represents a global scientific
release claim and intentionally fails while any domain or model is unassessed or
has a material blocker.

Evidence is now procedure-scoped and bidirectionally linked to the claim and
regime it supports. Exact Crow, grouped Crow, pooled parametric NHPP, and
non-parametric MCF are separate records. Coverage certification additionally
requires the release simulation profile, its declared replicate minima, a known
immutable commit, and a clean worktree; a passing PR smoke profile cannot be
promoted to release evidence.

Until each calculation domain has been re-evaluated under this framework, prior
“resolved” labels mean only that the named finding's regression was addressed.
They do not establish absence of other defects.
