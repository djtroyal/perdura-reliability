# Human reliability methodology

Perdura separates published HRA methods from local screening heuristics. A numeric probability alone does not make a worksheet an implementation of a named method, and outputs from tools with different task definitions and evidence bases are not interchangeable estimates of model uncertainty.

## SPAR-H scope

The implementation follows the at-power diagnosis/action worksheets in U.S. NRC [NUREG/CR-6883](https://www.nrc.gov/reading-rm/doc-collections/nuregs/contract/cr6883/index):

- diagnosis and action nominal HEPs;
- the eight performance-shaping-factor (PSF) tables;
- the multiple-negative-PSF adjustment and minimum HEP cutoff of `1e-5`;
- Part IV formal dependency; and
- a mean-preserving beta approximation to constrained-noninformative (CNI) uncertainty around the final mean HEP.

For an independent HEP `p`, the dependency equations are:

| Level | Conditional HEP |
|---|---:|
| Zero | `p` |
| Low | `(1 + 19p) / 20` |
| Moderate | `(1 + 6p) / 7` |
| High | `(1 + p) / 2` |
| Complete | `1` |

The dependency level can be derived from the published crew/time/location/additional-cues matrix or assigned directly with a documented justification. Sequence-position rules impose at least moderate dependency for the third failure and high dependency for the fourth or later failure.

The beta approximation preserves the final HEP as its mean. For beta shape `alpha`, `beta = alpha(1 - p) / p`. Unless an authorized `alpha` is supplied, Perdura linearly interpolates a digitization of Figure 2-6 in NUREG/CR-6883 and identifies that provenance in the result. At the report's worked point `p = 0.3`, the shapes are `alpha = 0.42` and `beta = 0.98`. This interval represents uncertainty around the final mean HEP; uncertainty in discrete PSF threshold assignments is not modeled separately.

PSFs overlap conceptually. The multiplier calculation cannot establish that each adverse observation is independent evidence, so analysts must avoid counting the same contextual cause under multiple PSFs without justification.

## Screening worksheets

Four legacy labels overstated the implemented scope. Saved project keys and API compatibility routes remain, but the UI uses accurate names and the compatibility responses carry warnings.

- **Category-factor screen:** local category anchors multiplied by a fixed factor for each aggravating condition. It is uncalibrated, is not a JHEDI implementation, and is not guaranteed conservative.
- **Error-mode likelihood screen:** a SHERPA-inspired error taxonomy with local low/medium/high anchors. Its probability aggregation assumes independent rows; it is not the full SHERPA task-analysis and reduction workflow.
- **EFC elicitation screen:** documents an unsafe action, an error-forcing context and one triangular judgment. The mean `(minimum + mode + maximum) / 3` is not an ATHEANA result, and the endpoints are not calibrated confidence limits. Full ATHEANA requires the structured search, dependency treatment, multidisciplinary analysis and consensus process described in NRC [NUREG-1624](https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr1624/index) and the [NUREG-1880 user guide](https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr1880/index.html).
- **Mission-scenario screen:** an arithmetic sum allowed only when the analyst confirms scenarios are mutually exclusive, compatible unconditional probabilities, and total no more than one. It is not a MERMOS implementation and does not establish scenario completeness.

The old `/jhedi`, `/sherpa`, `/atheana`, and `/mermos` API routes remain compatibility aliases. New integrations should use `/category-screening`, `/error-mode-screening`, `/efc-elicitation-screening`, and `/mission-scenario-screening`.
