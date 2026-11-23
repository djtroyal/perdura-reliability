# Prediction scenario comparison

Prediction’s Compare Scenarios tab pairs two existing calculated recipes on the current canonical bill of materials. It does not calculate or calibrate a new prediction model. A and B can be swapped; selection is saved in the project’s `predictionComparison` slice.

For aggregate rates in failures per million calendar hours, rate ratio = λB/λA; MTBF ratio = (10⁶/λB)/(10⁶/λA) = λA/λB; rate difference = λB−λA. Zero denominators and ratios of unbounded MTBFs are undefined. Backend output precision limits displayed ratios. These are planning comparisons, not confidence intervals or measured field performance. Existing method warnings and source disclosures remain visible.

The comparison requires current system fingerprints and canonical identity, a recipe fingerprint recorded at successful calculation, a request checksum, nonnegative finite rates on the calendar-hour basis, and matching standard, edition, source and scope. Part identities, categories and quantities must match, with no excluded or incompatible lines. Per-part equations and handbook sections must share a source. Dirty, missing, legacy unstamped or mismatched results display the specific correction needed and no ratios. Presentation preferences do not change the recipe stamp.

The view reports expanded per-part contributions, changed factors and recipe inputs, source equations, quality assumptions, warnings, and both request and system checksums. Factor ratios must be interpreted with their equations; they are not independent statistical effects.

Validation uses actual shared-system prediction handlers with GUI defaults for ten RL resistors and five CK capacitors in GB and GM environments. Environmental factors change by 16 and 20 respectively, and the aggregate ratio lies between them. Python reconstructs candidate contributions from baseline contributions and environment factors. Frontend contracts verify inverse ratios, reversal, attribution and eleven provenance failure paths. Browser assurance checks rendering, selection after remount and refusal of stale calculations. This verifies the comparison workflow, not full handbook conformance.

The fixture generator is `gui/backend/tests/prediction_comparison_fixture.py`; the checked JSON fixture should be refreshed if defaults or calculation outputs change. Tests are `gui/backend/tests/test_prediction_comparison.py`, `gui/frontend/tests/predictionComparison.test.mjs` and `gui/frontend/tests/predictionComparisonBrowser.mjs`.
