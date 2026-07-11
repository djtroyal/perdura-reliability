# Public research sources used in the Perdura methodology audit

Accessed 2026-07-10. Technical claims were checked against official agency documentation, standards-owner pages, official library documentation, or original research publications. Proprietary standards text not publicly available was not used.

## Statistical reliability and model validation

- NIST/SEMATECH, [Kolmogorov-Smirnov Goodness-of-Fit Test](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35g.htm). The reference states that the theoretical distribution must be fully specified; estimating parameters from the same data invalidates the usual critical region and generally requires simulation or a corrected procedure. Used for F012.
- NIST/SEMATECH, [Maximum Likelihood in Acceleration Models](https://www.itl.nist.gov/div898/handbook/apr/section4/apr422.htm). Describes likelihood-based testing of common-shape and acceleration-model assumptions. Used for F011 and F036-F037.
- Mauchly (1940), [Significance Test for Sphericity of a Normal n-Variate Distribution](https://doi.org/10.1214/aoms/1177731915). Original sphericity test. Used for F028.
- Greenhouse and Geisser (1959), [On Methods in the Analysis of Profile Data](https://doi.org/10.1007/BF02289823). Original conservative degrees-of-freedom adjustment for repeated profiles. Used for F028.
- Huynh and Feldt (1976), [Estimation of the Box Correction for Degrees of Freedom from Sample Data in Randomized Block and Split-Plot Designs](https://doi.org/10.3102/10769986001001069). Original adjusted-epsilon estimator for repeated-measures inference. Used for F028.
- Plackett and Burman (1946), [The Design of Optimum Multifactorial Experiments](https://doi.org/10.1093/biomet/33.4.305). Original orthogonal screening-design construction. Used for F033.
- Turnbull (1976), [The Empirical Distribution Function with Arbitrarily Grouped, Censored and Truncated Data](https://doi.org/10.1111/j.2517-6161.1976.tb01597.x). Original grouped/interval-censoring framework. Used for F044.
- Hurvich and Tsai (1989), [Regression and time series model selection in small samples](https://doi.org/10.1093/biomet/76.2.297). Original AICc small-sample work. Used for F007.
- Nelson (2003), [Recurrent Events Data Analysis for Product Repairs, Disease Recurrences, and Other Applications](https://doi.org/10.1137/1.9780898718454). Primary recurrent-event/MCF reference. Used for F020-F021.
- Lawless and Nadeau (1995), [Some Simple Robust Methods for the Analysis of Recurrent Events](https://doi.org/10.1080/00401706.1995.10484300). Original subject-robust variance framework for recurrent-event mean functions. Used for F021.
- Kijima (1989), [Some Results for Repairable Systems with General Repair](https://doi.org/10.2307/3214319). Original virtual-age Model I/II formulation, including perfect and minimal repair endpoints. Used for F042.
- SciPy, [OptimizeResult](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.OptimizeResult.html). Defines `success`, termination status/message and potentially approximate Hessian information. Used for F009 and F011.

## System safety and human reliability

- U.S. Nuclear Regulatory Commission, [Fault Tree Handbook, NUREG-0492](https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr0492/index). Official fault-tree construction and evaluation reference. Used for F003 and F015-F017.
- U.S. Nuclear Regulatory Commission, [NUREG-1150 Appendix C](https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr1150/v2/sr1150v2appc.pdf). Documents beta-factor common-cause modeling used in the PRA and its all-members common-cause events. Used for F017.
- NIST/SEMATECH, [Confidence intervals for a proportion](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm). Defines Wilson and exact binomial intervals and explains why small-count intervals should not use the symmetric normal approximation. Used for F045.
- U.S. Nuclear Regulatory Commission, [SPAR-H Method, NUREG/CR-6883](https://www.nrc.gov/reading-rm/doc-collections/nuregs/contract/cr6883/index). Includes performance-shaping factors, beta-distribution uncertainty and dependency guidance. Used for F023.
- U.S. Nuclear Regulatory Commission, [ATHEANA, NUREG-1624](https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr1624/index). Defines a structured search for human failure events, unsafe acts, error-forcing contexts and dependencies. Used for F023.

## Quality engineering, measurement and experimentation

- NIST/SEMATECH, [Assessing Process Stability](https://www.itl.nist.gov/div898/handbook/ppc/section4/ppc45.htm). States that capability should not be discussed before process stability is demonstrated. Used for F024 and F030.
- NIST/SEMATECH, [Process Control Techniques](https://www.itl.nist.gov/div898/handbook/pmc/section1/pmc12.htm). Distinguishes Phase-I baseline estimation from Phase-II monitoring. Used for F030.
- NIST/SEMATECH, [Gauge R&R Studies](https://www.itl.nist.gov/div898/handbook/mpc/section4/mpc4.htm) and [Variance Components](https://www.itl.nist.gov/div898/handbook/prc/section4/prc44.htm). The latter notes that REML is generally preferable to method-of-moments estimation and supports component intervals. Used for F029.
- NIST/SEMATECH, [Response Surface Designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri336.htm). Covers curvature, lack-of-fit detection, central composite and Box-Behnken designs. Used for F032 and F049.
- NIST/SEMATECH, [Randomized Block Designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm) and [Blocking Full Factorials](https://www.itl.nist.gov/div898/handbook/pri/section3/pri3333.htm). Defines nuisance blocking, within-block comparisons and treatment/block confounding. Used for F049.
- NIST/SEMATECH, [Response Surface Model Example](https://www.itl.nist.gov/div898/handbook/pri/section4/pri473.htm). Demonstrates full quadratic fitting, residual review and replicated-point lack-of-fit analysis. Used for F049.
- Scheffé (1958), [Experiments with Mixtures](https://doi.org/10.1111/j.2517-6161.1958.tb00299.x). Original mixture-polynomial framework for responses determined by component proportions. Used for F049.

## Prediction standards and physics of failure

- ECSS, [ECSS-Q-ST-30-11C Rev.2 — Derating EEE components](https://ecss.nl/standard/ecss-q-st-30-11c-rev-2-derating-eee-components-23-june-2021/). Standards-owner page for the current public revision, which supersedes Rev.1 and contains technology/application-specific derating rules. Used for F022.
- FIDES, [Reliability methodology](https://www.fides-reliability.org/en/node/5) and [Guide presentation](https://www.fides-reliability.org/en/node/6). The official methodology emphasizes precise mission profiles plus physical, technological, overstress and process factors. Used for F022.
- NASA NEPP/JPL, [Reliability Prediction — Continued Reliance on MIL-HDBK-217?](https://nepp.nasa.gov/files/16365/08_102_4_%20JPL_White.pdf). Public technical assessment of legacy constant-rate prediction limitations and alternatives. Used for F022.
- NASA/CALCE, [Evaluation of FIDES and Physics-of-Failure Reliability Prediction](https://nepp.nasa.gov/docs/papers/2020-NASA-FIDES-CALCE-Report-Univ-MD-Pecht-Das-Gaonkar.pdf). Public comparison of empirical-parts-count and PoF approaches. Used for F022 and F047.
- NASA, [Effect of Stress Ratio on Fatigue-Crack Growth](https://ntrs.nasa.gov/api/citations/19680018001/downloads/19680018001.pdf). Original agency report comparing Paris-type growth with the stress-ratio and toughness-dependent Forman equation. Used for F047.
- NASA, [NASALIFE—Component Fatigue and Creep Life Prediction Program](https://ntrs.nasa.gov/api/citations/20140010774/downloads/20140010774.pdf). Documents the Walker mean-stress formulation, material-calibration needs and its elastic-stress scope. Used for F047.
- NASA, [Probabilistic Prognosis of Non-Planar Fatigue Crack Growth](https://ntrs.nasa.gov/api/citations/20160012453/downloads/20160012453.pdf). Uses Walker's stress-ratio modification of Paris crack growth and propagates empirical-parameter uncertainty. Used for F047.
- NASA, [Re-examination of Cumulative Fatigue Damage Analysis: An Engineering Perspective](https://ntrs.nasa.gov/archive/nasa/casi.ntrs.nasa.gov/19860018208.pdf). Documents nonlinear damage-curve/double-linear alternatives and cautions on complex load histories. Used for F047.

## Markov and phase-type state models

- Pyke (1961), [Markov Renewal Processes: Definitions and Preliminary Properties](https://doi.org/10.1214/aoms/1177704863). Original definitions and preliminary theory for Markov-renewal and semi-Markov processes. Used for F050.
- Hurtado and Richards (2021), [Building mean field ODE models using the generalized linear chain trick and Markov chain theory](https://doi.org/10.1080/17513758.2021.1912418). Derives sequential Erlang and broader phase-type representations from hidden CTMC phases. Used for F050.
- Krak, De Bock, and Siebes (2017), [Imprecise continuous-time Markov chains](https://doi.org/10.1016/j.ijar.2017.06.012). Develops CTMC analysis for uncertain transition-rate assessments and explicitly examines time-homogeneity and Markov assumptions. Used for F050.

## Predictive validation

- scikit-learn, [Cross-validation: evaluating estimator performance](https://scikit-learn.org/stable/modules/cross_validation.html). Official documentation for grouped and other split strategies. Used for F035.
- scikit-learn, [Probability calibration](https://scikit-learn.org/stable/modules/calibration.html). Official documentation for out-of-sample calibration and class-presence requirements. Used for F035.

These sources support method selection and risk characterization. They do not by themselves certify Perdura against any standard; certification would require clause-level traceability, authorized source material where applicable, and independent worked-example review.
