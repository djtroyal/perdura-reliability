// Companion user-manual content for each module, shown by the Help drawer.
// Content is structured (not free markdown) so it renders consistently:
// each module has an overview and a list of sections; a section has a heading
// and a list of items, where an item is either a paragraph (string) or a
// labelled bullet ({ term, def }).

export type HelpItem = string | { term: string; def: string }

export interface HelpSection {
  heading: string
  items: HelpItem[]
}

export interface ModuleHelp {
  title: string
  overview: string
  sections: HelpSection[]
}

export const HELP_CONTENT: Record<string, ModuleHelp> = {
  lifeData: {
    title: 'Life Data Analysis',
    overview:
      'Fit probability distributions to times-to-failure (with optional right-censored / suspended units) to estimate reliability, failure rates and life percentiles.',
    sections: [
      {
        heading: 'Workflow',
        items: [
          'Unsure which analysis mode fits your data? Click "Analysis wizard — help me choose" above the mode buttons: it walks from your data situation (zero failures? censoring? mixed populations?) to the right mode and method.',
          'Enter failure times (and any suspensions) in the data grid, or generate a Monte-Carlo sample from a chosen distribution. Use "User equation" mode to combine multiple input distributions via a formula (e.g. Y = A + B + C) for probabilistic design.',
          'Pick a distribution (or "Fit Everything" to rank them by goodness-of-fit) and a fitting method (MLE or least squares).',
          'Choose a confidence level; fitted parameters and curves are reported with confidence bounds.',
          'Read results on the probability plot, the PDF/CDF/SF/HF curves, or the stacked Quad View.',
          'After fitting two or more distributions, click "Compare fits" to superimpose every PDF, CDF, SF, or HF on a common time axis; use the color-coded checkboxes to turn individual fits on or off. "Dataset context" overlays an observed-failure histogram/rug (PDF), unconnected Kaplan-Meier failure points (CDF/SF), or event rugs (HF).',
        ],
      },
      {
        heading: 'Analysis Modes',
        items: [
          { term: 'Parametric', def: 'Fit one or more parametric distributions (Weibull, Normal, Lognormal, etc.) to the data.' },
          { term: 'Non-Parametric', def: 'Kaplan-Meier or Nelson-Aalen survival estimation — no distribution assumption required.' },
          { term: 'Special', def: 'Weibull mixture, competing risks, defective subpopulation, and zero-inflated models.' },
          { term: 'Weibayes', def: 'Weibull scale analysis with fixed β, β-range sensitivity, or Bayesian β uncertainty propagation; fixed-β mode supports zero failures. Survival bounds use semantic ordering (lower ≤ central ≤ upper).' },
          { term: 'CFM (Competing Failure Modes)', def: 'Separate analysis per failure mode using the ID column. Each mode is fitted individually with other modes\' failures treated as suspensions. System reliability = product of per-mode reliabilities.' },
          { term: 'S-S (Stress-Strength)', def: 'Enter stress and strength distributions with parameters, compute P(failure) = P(stress > strength) via numerical integration, and visualize the interference diagram.' },
        ],
      },
      {
        heading: 'Inputs',
        items: [
          { term: 'Failures', def: 'Exact times at which units failed.' },
          { term: 'Right-censored (suspensions)', def: 'Units still operating when observation ended; they contribute partial information.' },
          { term: 'ID column', def: 'Optional identifier for each row. In CFM mode, this defines the failure mode group.' },
          { term: 'Method', def: 'Use MLE when observations are censored because it uses each suspension through the likelihood. RRX/RRY are mainly for small complete samples or reproducing a legacy probability-plot fit; they are not a remedy for heavy or uneven censoring.' },
          { term: 'CI', def: 'Confidence level (e.g. 95%) for parameter and curve bounds.' },
          { term: 'Observation format', def: 'Individual stores one exact failure or suspension per row. Frequency stores repeated exact observations as time, state, and a positive integer count. Intervals stores inspection groups as (lower, upper] with a count; blank lower means left-censored and blank upper means right-censored.' },
          { term: 'Exact-time frequency likelihood', def: 'Available for every LDA parametric distribution. Each row count weights the exact failure-density or suspension-survival likelihood exactly as if the row had been repeated, without expanding the dataset. Grouped formats use MLE; RRX/RRY are intentionally disabled.' },
          { term: 'Inspection-interval likelihood', def: 'Uses the probability F(upper) − F(lower), not an assumed midpoint. Two-parameter Weibull, Exponential, Normal, Lognormal, Gamma, Loglogistic, Beta, and Gumbel models are available. Threshold/location variants are excluded because grouped intervals weakly identify the threshold; Beta bounds must stay within [0, 1].' },
          { term: 'Turnbull estimate', def: 'The nonparametric maximum-likelihood estimate for interval-censored observations. Perdura overlays it on CDF/SF plots as dataset context. Exact-time probability, Q-Q, P-P, histogram, and Anderson–Darling diagnostics are not reported for interval data because the event times are not observed.' },
          { term: 'User equation (MC)', def: 'Define multiple random variables (each with its own distribution), combine them via an arithmetic equation, and generate Monte Carlo samples of the output. Supports operators (+, -, *, /, **) and functions (sqrt, exp, log, sin, cos, pow, min, max, abs). Use "Import from analysis" to auto-fill a variable\'s distribution from a fitted analysis.' },
        ],
      },
      {
        heading: 'Reading the results',
        items: [
          { term: 'Probability plot', def: 'Points should fall along the fitted line if the distribution fits. Enable "Show suspensions" to mark each right-censored time with a triangle icon along the x-axis.' },
          { term: 'Multiple plots', def: 'Ctrl/⌘-click the plot view tabs (Probability, PDF, CDF, SF, HF) to display several at once; plain click shows just one.' },
          { term: 'Stale results', def: 'If you change the data after fitting, an amber asterisk appears on the analysis tab and a banner offers to re-run, so results are never silently out of date.' },
          { term: 'AICc / BIC', def: 'Lower is better; used to compare candidate distributions.' },
          { term: 'B-life (e.g. B10)', def: 'Time by which a given fraction (10%) of the population is expected to fail.' },
          { term: 'Confidence bands', def: 'Wider bands mean more uncertainty (small samples, heavy censoring).' },
          { term: 'Calibrated scalar interval', def: 'A confidence interval for one derived quantity from the fitted model—either reliability at a chosen time or a life quantile such as B10. It is not a simultaneous band for the whole curve. Profile likelihood re-fits nuisance parameters at candidate values and reports an endpoint only after the likelihood-ratio and equality constraint are verified. Parametric bootstrap repeatedly simulates and re-fits the study. Inferential calibration and reproduction of the censoring design are reported separately. Declare the planned censoring design even if every observed unit happened to fail first; resampling only observed censor times is approximate. Fewer than 100 bootstrap draws or under 90% successful refits is shown only as a partial diagnostic, and boundary plug-in bootstrap is unverified.' },
        ],
      },
    ],
  },

  alt: {
    title: 'Reliability Testing',
    overview:
      'A suite for planning and analyzing reliability tests, organized into four areas: Accelerated Life Testing, Reliability Demonstration (RDT), Test Design & Planning, and Degradation & Screening.',
    sections: [
      {
        heading: 'Accelerated Life Testing',
        items: [
          'Not sure which of the ~24 tools you need? Click "Test navigator" in the view bar: answer what you\'re trying to do (analyze accelerated data, demonstrate a target, plan a test, degradation, screening) and it opens the right tool with a rationale.',
          'Life-stress model fitting (Arrhenius, Eyring, inverse power law, etc.) to extrapolate from elevated stress to use conditions.',
          'Before using a life projection, check the tested-stress range, transformed design rank and condition number, physical coefficient direction, and the common-shape diagnostic. A rejected common-shape assumption makes that model ineligible; non-rejection is not proof that the failure mechanism is unchanged.',
          'Use stress outside the tested range (or outside the tested two-stress convex hull) is extrapolation. The leverage ratio indicates how far the use prediction is from the information in the test design.',
          'Delta intervals are a fast local approximation. Parametric-bootstrap intervals simulate and re-fit the selected model while retaining the stress and censoring design; both remain conditional on the selected model and common-mechanism assumption.',
          'Acceleration factor calculator, plus step/sequential-stress, multi-stress, HALT, and margin tests.',
        ],
      },
      {
        heading: 'Reliability Demonstration (RDT)',
        items: [
          'Parametric Binomial — demonstrate reliability at a time, assuming a distribution and shape; solve for sample size or test time.',
          'Non-Parametric Binomial — distribution-free / one-shot demonstration; solve sample size, reliability, or confidence.',
          'Exponential Chi-Squared — accumulated test time for a constant-failure-rate demonstration (with a plain-language summary of what it demonstrates).',
          'Non-Parametric Bayesian — fold in a prior from expert opinion or subsystem tests; the prior → posterior belief is shown as overlaid Beta curves.',
        ],
      },
      {
        heading: 'Test Design & Planning',
        items: [
          'Expected Failure Times plot — when each ordered failure is expected for a planned sample size.',
          'Difference Detection — a heatmap (and matrix) of the test duration needed to distinguish two designs’ B10/mean life; click a cell for the detail.',
          'Monte-Carlo Simulation of a test design, plus exponential planners, sequential sampling, and proportion / goodness-of-fit tools.',
        ],
      },
      {
        heading: 'Degradation & Screening',
        items: [
          'Degradation (wear-to-failure) testing — non-destructive and destructive; inputs are saved with the project.',
          'For repeated non-destructive measurements, the hierarchical population model pools unit paths and directly induces the threshold first-passage life distribution. It currently supports linear and exponential paths and propagates population uncertainty with refitted parametric bootstrap. First passage is defined on the latent monotone path: residual error is treated as measurement noise, not damage-bearing stochastic process variation. Ineligible population fits remain diagnostic-only, and fewer than 100 bootstrap refits is labeled partial.',
          'The per-unit delta method remains a screening option. It fits projected crossing times to a chosen life distribution, while clearly separating display-only projection bounds from actual censoring intervals.',
          'ESS, HASS, and burn-in screen design.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'Acceleration factor', def: 'How many times faster failures accrue at test stress vs use stress.' },
          { term: 'Demonstrated reliability', def: 'The reliability you can claim at the stated confidence given the test outcome.' },
        ],
      },
    ],
  },

  systemModeling: {
    title: 'System Modeling',
    overview:
      'Build reliability block diagrams, fault trees, and state-space models to roll component behavior up to a system-level prediction.',
    sections: [
      {
        heading: 'Workflow',
        items: [
          'Drag blocks/gates onto the canvas and connect them to express series, parallel, k-out-of-n or gated logic.',
          'Assign each basic block a reliability or a distribution + mission time.',
          'Compute system reliability, importance measures and (for fault trees) minimal cut sets.',
        ],
      },
      {
        heading: 'Linking to other modules',
        items: [
          'A block, basic event, or Markov transition rate can be defined from a fitted Life Data distribution or a predicted failure rate (Failure Rate Prediction) — pick the source from the dropdown and it stays in sync on re-run.',
          'Markov rates accept constant-rate (exponential) sources, since a continuous-time Markov chain assumes constant transition rates.',
        ],
      },
      {
        heading: 'Markov dwell models & uncertainty',
        items: [
          'The default time-homogeneous CTMC assumes constant transition rates and exponential, memoryless time in every state. The System results tab lists the full model assumptions.',
          'Choose Erlang phase-type dwell time on a state when its chance of leaving depends on time already spent there. Shape k uses k hidden sequential phases, preserves the input mean dwell time, and has dwell-time CV = 1/√k.',
          'For an Erlang analysis, gray CTMC-baseline curves are overlaid on A(t) / R(t) so the transient effect of the dwell model is visible. The matrix tab remains the public input-rate CTMC reference because a non-memoryless public-state process has no single CTMC generator.',
          'Enter a rate CV on any transition to propagate independent, mean-preserving lognormal rate uncertainty. Reported intervals reflect those entered assumptions; they are not confidence intervals estimated from event data.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'Series path', def: 'All blocks must work; system reliability is the product — the weakest block dominates.' },
          { term: 'Parallel/redundant path', def: 'Only one branch must work; redundancy raises reliability.' },
          { term: 'Minimal cut set', def: 'A smallest combination of failures that fails the system; small cut sets are high-risk.' },
          { term: 'Birnbaum / importance', def: 'How much a component contributes to system failure — prioritize improvements there.' },
          { term: 'Availability vs reliability', def: 'Availability allows repair and asks whether the system is up at time t. Reliability asks whether it has avoided its first failed state through time t.' },
          { term: 'Erlang shape k', def: 'The number of equal-rate hidden phases in a public state. k = 1 is exponential; larger k makes dwell time less variable while retaining its mean.' },
        ],
      },
    ],
  },

  prediction: {
    title: 'Failure Rate Prediction',
    overview:
      'Predict component and system failure rates (FPMH) using standards-based handbook methods, with explicit operating, nonoperating, and calendar-time service-life results where the RADC extension applies.',
    sections: [
      {
        heading: 'Standards',
        items: [
          { term: 'MIL-HDBK-217F', def: 'Notice 2 part-stress and parts-count models for electronic equipment. Results expose the exact clause, equation, factors, substitutions, assumptions, and source adjustments.' },
          { term: 'RADC-TR-85-91', def: 'A separate 1985 government technical-report extension that supplies nonoperating component models. It is not part of MIL-HDBK-217F and several factors are preliminary, theoretical, or extrapolated.' },
          { term: 'MIL-STD-883 context', def: 'The supplied 2019 method volumes and 2025 change help explain screening terminology, but they are later than MIL-HDBK-217F Notice 2 and do not establish exact historical-edition parity. B-1 remains a handbook-specific screening bucket, not a modern product class.' },
          { term: 'A/V51.1 R2018 checkbox', def: 'Applies ANSI/VITA 51.1-2013 (R2018) as a subsidiary specification: commercial known-pedigree quality defaults, IC complexity extensions and memory mappings, MOSFET base-rate recommendations, connector defaults, BGA factors, manufacturer-data conversions, and the recommended PTH fatigue method. Checking it asserts the Appendix C known-pedigree and counterfeit-control prerequisites.' },
          { term: 'Telcordia SR-332', def: 'Commercial/telecom electronics.' },
          { term: '217Plus / FIDES', def: 'Modern stress + process-grade methodologies.' },
          { term: 'NSWC-98/LE1', def: 'Mechanical parts (bearings, springs, valves, …).' },
          { term: 'EPRD-2014 / NPRD-2023', def: 'Empirical (field-data) failure rates for electronic and nonelectronic parts.' },
        ],
      },
      {
        heading: 'Workflow',
        items: [
          'Pick a standard, then drag components from the standard-specific Component Library into the parts list. The library can be collapsed to free up space.',
          'Set each part’s parameters, environment and quantity.',
          'Use System Blocks for repeated subassemblies and steady-state exposure. A block can define quantity, operating fraction, separate operating and nonoperating environments, nonoperating temperature, power-cycle rate, and notes; nested operating fractions multiply.',
          'When operating fraction is below one, review the RADC-TR-85-91 result and source warnings for every affected part. Perdura does not reuse the operating model or apply a generic percentage reduction.',
          'Enable a part or block failure-rate override only when justified user data should replace the effective output. Perdura keeps the standards-based calculation, factors and equations alongside the override.',
          'Use the separate nonoperating-rate override when qualified evidence describes only the nonoperating state. Record its source type and citation; it enters the service-life weighting equation without replacing the operating handbook result.',
          'If A/V51.1 is checked, replace standard defaults with actual stress, thermal, package, or supplier data when known. Connector inputs include an explicit switch for retaining known actual values instead of the A/V module/CCA defaults.',
          'Read the system failure rate (FPMH) and MTBF; use Derating and Mission Profile tools for stress and phased-mission analysis.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'Incompatible parts', def: 'If a part type isn’t supported by the selected standard (or is misconfigured), the rest of the system is still computed; the unsupported parts are highlighted in red in the parts list and excluded from the totals.' },
          { term: 'FPMH', def: 'Failures per million hours; system FPMH is the sum over parts.' },
          { term: 'MTBF', def: '1e6 / FPMH (hours) — only meaningful for constant-rate (exponential) assumptions.' },
          { term: 'Contribution', def: 'Each part’s share of the total — target the largest contributors first.' },
          { term: 'Service-life rate', def: 'For supported MIL predictions, Perdura calculates λservice = fop·λoperating + (1−fop)·λnonoperating. The result is failures per million calendar hours. The nonoperating rate comes from RADC-TR-85-91 or a documented override, never from the operating model.' },
          { term: 'Unavailable service rate', def: 'If an included part has nonoperating exposure but no exact RADC family or documented override, its operating result remains visible while the affected service-life block and system totals are unavailable.' },
          { term: 'Failure-rate override', def: 'A toggled override is a final per-piece or per-block-instance FPMH value. Quantity is applied afterward. A block override replaces its descendant roll-up in the system total, but descendant handbook calculations remain visible for audit. An override-only block can also represent a vendor-rated or otherwise externally characterized black-box subassembly.' },
          { term: 'Mission Profile boundary', def: 'System Block exposure applies to the steady-state prediction. Mission Profile independently applies operating fractions and nonoperating conditions within each named phase.' },
          { term: 'Space Flight boundary', def: 'MIL-HDBK-217F SF is a constant-rate operating environment factor. RADC-TR-85-91 excludes satellite nonoperating use, and Perdura does not present SF as a time-varying spacecraft mission model.' },
          { term: 'A/V PTH method', def: 'With Method = auto, checking A/V51.1 selects the Appendix F plated-through-hole strain/fatigue solver; unchecked uses MIL §16.1. The result reports geometry, stress, strain, cycles to failure, and the source-equation repair.' },
          { term: 'Sub-130 nm ICs', def: 'A/V51.1 recommends a separate VITA 51.2/equivalent wearout assessment for electromigration, TDDB, hot-carrier injection, and NBTI. The constant random-rate result does not replace that assessment.' },
        ],
      },
      {
        heading: 'Reuse elsewhere',
        items: [
          'The parts list (system BOM) and its predicted failure rates can be imported into Reliability Allocation (ARINC method) — at part or sub-assembly-block granularity.',
        ],
      },
    ],
  },

  pof: {
    title: 'Physics of Failure',
    overview:
      'Apply physics-of-failure and stress models with explicit input units, physical-domain checks, validity assumptions and optional independent-input uncertainty propagation. Model-sensitivity views keep competing laws separate from statistical confidence bounds.',
    sections: [
      {
        heading: 'Choosing a model',
        items: [
          'Click "Model wizard — help me choose" to start from the dominant stress or failure mechanism, then select the engineering question that matches your inputs. Applying the recommendation opens the corresponding calculator.',
          'The equation card above the inputs shows the active model in typeset mathematical notation; temperatures in acceleration equations are evaluated in kelvin.',
          'Open "Input uncertainty propagation" to select populated scalar inputs (or individual fatigue-data/load-block values), assign a common relative standard deviation and report a separate 90% Monte Carlo interval. Positive inputs use mean-preserving lognormal draws; signed inputs use normal draws; inputs are independent.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'Acceleration factor', def: 'Ratio of life at use vs test conditions for the chosen mechanism.' },
          { term: 'Activation energy (Ea)', def: 'Higher Ea means stronger temperature sensitivity.' },
          { term: "Miner's rule damage", def: 'Linear life fractions sum to 1 at predicted failure. It ignores load order; optional analyst-supplied nonlinear exponents show an explicitly labeled sequence-sensitivity alternative.' },
          { term: 'Crack-growth sensitivity', def: 'Compare Paris, Walker and Forman curves over the same geometry and loading only when each law has separately calibrated, unit-compatible C/m constants.' },
          { term: 'Mean-stress sensitivity', def: 'Goodman, Soderberg and Gerber factors of safety are shown together. Their spread is model sensitivity, not a confidence interval.' },
          { term: 'Validity banner', def: 'Every result states its unit basis, assumptions, warnings and whether it is deterministic-only or includes propagated input uncertainty.' },
        ],
      },
    ],
  },

  growth: {
    title: 'Reliability Growth',
    overview:
      'Fit repairable-system recurrence histories with Crow-AMSAA (power-law NHPP), or use Duane as a descriptive log-log growth plot. Exact events and grouped interval counts have distinct likelihood and goodness-of-fit contracts.',
    sections: [
      {
        heading: 'Data and stopping design',
        items: [
          { term: 'Exact event times', def: 'Enter cumulative recurrence times for one repairable-system test history. Independent unit lifetimes from Life Data Analysis are not valid Crow-AMSAA recurrence input.' },
          { term: 'Grouped counts', def: 'Enter the number of recurrent failures in each interval (previous endpoint, endpoint]. Grouped analyses are time-terminated at the final endpoint, use the interval-count likelihood, and require failures in at least two intervals to identify the trend.' },
          { term: 'Time termination', def: 'Testing stops at a fixed accumulated time T chosen by design; T is required even when the last failure happens to equal it.' },
          { term: 'Failure termination', def: 'Testing stops on the final observed recurrence. Leave T blank or set it equal to that final event. The stopping design changes bias corrections and exact pivots.' },
        ],
      },
      {
        heading: 'Estimation and inference',
        items: [
          { term: 'Raw MLE', def: 'Maximizes the power-law NHPP likelihood. It is the default and is shown alongside the modified estimate.' },
          { term: 'Bias-corrected / modified MLE', def: 'Applies the termination-specific small-sample correction to β, then re-estimates Λ so the expected count at T matches the observed count. Select it to drive the reported curves and endpoint metrics.' },
          { term: 'Confidence intervals', def: 'Each interval reports its own method and coverage status. When modified MLE is selected, the reported point and curves use that estimate while the exact confidence pivots retain their raw-MLE reference statistic; both values and bases are shown. The β chi-square pivot is exact under the stated NHPP stopping design. Current-MTBF limits use an exact independent-Gamma product pivot for failure termination and the Crow time-terminated Bessel/Poisson-mixture construction, which is exact under the model and can be conservative because the failure count is discrete.' },
          { term: 'One-sided lower confidence bound', def: 'A direct one-tail lower bound on current MTBF at the selected confidence. It is reported separately from the two-sided interval because a 95% one-sided lower bound is not the lower endpoint of a 95% two-sided interval. The table identifies the method, coverage status, selected point estimate, and raw-MLE reference statistic.' },
          { term: 'Exact-event GOF', def: 'The Cramér-von Mises test uses its prescribed bias-corrected shape and the published MIL-HDBK-189 table at α = 0.01, 0.05, 0.10, 0.15, or 0.20. “Fail to reject” does not establish that the model is true.' },
          { term: 'Grouped GOF', def: 'Pearson chi-square compares observed and fitted interval counts. Adjacent intervals may be pooled to satisfy expected-count rules; the pooled groups are shown with the result, and insufficient degrees of freedom make the test unavailable.' },
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'Growth slope (β)', def: 'β < 1 indicates improving reliability (failure intensity decreasing).' },
          { term: 'Instantaneous MTBF', def: 'Current endpoint MTBF 1/ρ(T), distinct from cumulative average MTBF and from the fitted average MTBF over a grouped interval.' },
          { term: 'Grouped final-interval MTBF', def: 'The reciprocal of expected failures divided by final-interval duration. It is not the instantaneous endpoint MTBF. The primary two-sided interval profiles the grouped Poisson likelihood for this target. The MIL-HDBK-189C grouped Crow-coefficient approximation and its direct one-tail lower confidence bound are shown separately and explicitly labeled approximate.' },
          { term: 'Observed intensity plot', def: 'Interval failure counts divided by interval duration are shown as unconnected points against the fitted interval averages and continuous instantaneous intensity.' },
          { term: 'Conditional projection', def: 'Future event-time and count predictions include NHPP process variation while holding fitted parameters fixed; they do not include parameter uncertainty or future design changes.' },
          { term: 'Crow-AMSAA trend test', def: 'The exact-event Military Handbook power-law process test evaluates the homogeneous-Poisson null β = 1 and reports two-sided plus directional p-values. Its displayed direction follows the smaller one-sided chi-square null tail; the selected point-estimator trend is a separate model interpretation and can differ in weak small-sample cases.' },
          { term: 'ROCOF Laplace trend test', def: 'The separate ROCOF view uses the Laplace test to assess whether recurrence times are trending or stationary.' },
        ],
      },
      {
        heading: 'Mean cumulative function (multiple systems)',
        items: [
          { term: 'Explicit censoring', def: 'Enter one system per row as “event times | observation end.” Eventless systems are valid contributors to the risk set, and an event tied at the endpoint is counted before censoring.' },
          { term: 'Nelson MCF', def: 'Estimates the population mean cumulative recurrence count without imposing a process shape. Log-transformed bounds use subject-cluster robust variance; the cluster bootstrap resamples complete system histories.' },
          { term: 'Per-time availability', def: 'Bounds may be withheld at individual event times when variance cannot be estimated or too few bootstrap replicates retain an observable risk set. Review the point table and sparse-tail warning instead of treating missing bounds as zero-width intervals.' },
          { term: 'Power-law MCF', def: 'The optional pooled NHPP fit estimates MCF(t) = Λt^β across systems with explicit, possibly unequal observation ends. The β and endpoint-MCF bounds are profile-likelihood intervals; Λ and α currently have point estimates only.' },
          { term: 'Shape indicator', def: 'The green/red two-segment slope indicator is descriptive only—not a hypothesis test. For the optional power-law model, compare the β profile interval with 1: values below 1 indicate decreasing recurrence intensity and values above 1 increasing intensity.' },
        ],
      },
      {
        heading: 'Model checks and limitations',
        items: [
          'Review engineering change history and the observed-versus-fitted cumulative and intensity plots. A single power law can hide phase changes or reliability jumps.',
          'Rounded tied event times are retained with a warning because an ideal continuous-time NHPP assigns zero probability to exact ties.',
          'Crow-AMSAA assumes minimal repair within a modeled phase and independent NHPP increments. It is not an independent-lifetime distribution and does not model imperfect repair or delayed corrective-action effects.',
        ],
      },
    ],
  },

  reliabilityAllocation: {
    title: 'Reliability Allocation',
    overview:
      'Top-down apportionment of a system reliability (or MTBF) target across the subsystems of a series system — the design-phase counterpart to the bottom-up RBD roll-up.',
    sections: [
      {
        heading: 'Methods',
        items: [
          { term: 'Equal', def: 'Every subsystem gets the same reliability, Rᵢ = R_sys^(1/n).' },
          { term: 'ARINC', def: 'Split the allowable failure rate proportional to each subsystem’s current/predicted failure rate.' },
          { term: 'AGREE', def: 'Weight by complexity (module count) and importance/utilisation.' },
          { term: 'Feasibility of effort', def: 'Weight by how hard each subsystem is to improve (1–10).' },
        ],
      },
      {
        heading: 'Workflow',
        items: [
          'Set the system target (reliability at the mission time, or an MTBF) and pick a method; the table columns adapt to the method.',
          'For ARINC, import the parts list and predicted failure rates directly from a Failure-Rate Prediction analysis (block- or part-level) instead of typing them.',
          'A badge confirms whether the product of the allocated reliabilities meets the system target.',
        ],
      },
    ],
  },

  maintenance: {
    title: 'Maintenance',
    overview:
      'Availability, maintainability & spares plus maintenance planning for repairable systems: steady-state availability from MTBF/MTTR and delays, lognormal repair-time roll-up, analytic or simulated replenishment-pipeline spares, long-run preventive-replacement policies, perfect-renewal MFOP, cost-rate projections, finite-horizon Kijima-II virtual-age simulation, and availability sensitivity. (For state-based, degraded-mode availability use Markov under System Modeling.)',
    sections: [
      {
        heading: 'Availability, Maintainability & Spares',
        items: [
          { term: 'Inherent (Ai) / Operational (Ao)', def: 'Ai = MTBF/(MTBF+MTTR) (repair only); Ao = uptime/(uptime+MDT) where MDT = MTTR + admin + logistics delay. A breakdown bar shows where availability is lost.' },
          { term: 'Mct / Mmax', def: 'Mean and percentile (e.g. 95th) corrective maintenance time from a lognormal repair-time model or fitted repair samples.' },
          { term: 'Spares provisioning', def: 'Choose constant-rate Poisson, overdispersed negative-binomial, or finite-horizon renewal/pipeline simulation with stochastic replenishment and common shocks.' },
        ],
      },
      {
        heading: 'Replacement Policy (age vs block)',
        items: [
          'Balances preventive-maintenance (PM) cost against the higher cost of unplanned corrective maintenance (CM) to find the lowest cost per unit time. Only worthwhile for wear-out (β > 1).',
          { term: 'Age replacement', def: 'Replace on failure or at age T, whichever comes first — each renews the item.' },
          { term: 'Block replacement', def: 'Replace every T regardless of age; failures in between are minimally repaired. Simpler to schedule but replaces some near-new items.' },
          'The tool reports each policy’s optimal interval, cost/unit time, and expected PM & CM events, and flags the cheaper policy.',
        ],
      },
      {
        heading: 'PM Interval (MFOP)',
        items: [
          'Finds the preventive-maintenance interval that keeps reliability at or above a target. With as-good-as-new PM, reliability sawtooths between 1 and the target — the interval is the Maintenance-Free Operating Period (MFOP).',
        ],
      },
      {
        heading: 'Cost Forecast & Availability Sensitivity',
        items: [
          { term: 'Cost forecast', def: 'Expected PM/CM events and total cost over a planning horizon under a chosen policy (corrective / age / block), with a cumulative-cost curve.' },
          { term: 'Availability sensitivity', def: 'A tornado of how much MTBF/MTTR and the admin/logistics delays move operational availability, plus a solve-for-target (the MTTR or max downtime needed to hit a target Ao).' },
        ],
      },
      {
        heading: 'Tip',
        items: [
          'Fit a Weibull in Life Data first, then link it here so α/β stay in sync. All times use the project units.',
        ],
      },
    ],
  },

  hra: {
    title: 'Human Reliability Analysis',
    overview:
      'Estimate or screen the human error probability (HEP) of a task. Published quantitative methods are separated from local screening heuristics so the tool name does not imply unsupported methodological rigor. The Overview compares numeric outputs while preserving that distinction.',
    sections: [
      {
        heading: 'Quantitative methods',
        items: [
          'Unsure which tool fits? Click "Method wizard" (top-right): it routes from your purpose, task framing, and available inputs, and states when only a screening workflow is available.',
          { term: 'THERP', def: 'Adjust a nominal HEP by stress and experience, and combine two subtasks with the dependency model (ZD…CD).' },
          { term: 'HEART', def: 'Generic task type × the error-producing conditions that apply, each weighted by an assessed proportion of affect.' },
          { term: 'SPAR-H', def: 'Diagnosis/action nominal HEP × 8 performance shaping factors, the ≥3-negative-PSF correction and 1×10⁻⁵ cutoff, optional Part-IV dependency from crew/time/location/cues, and beta-approximated uncertainty around the final mean HEP.' },
          { term: 'CREAM (basic)', def: 'Rate the 9 common performance conditions → control mode (Strategic/Tactical/Opportunistic/Scrambled), shown on the control-mode diagram with its HEP interval.' },
          { term: 'CREAM (extended)', def: 'Task steps → cognitive activity → credible failure type; nominal Cognitive Failure Probabilities weighted by the CPC factors per cognitive function, combined into a task HEP.' },
          { term: 'SLIM-MAUD', def: 'Weight and rate PSFs into a Success Likelihood Index, calibrated to HEP with two anchor tasks.' },
        ],
      },
      {
        heading: 'Screening worksheets',
        items: [
          { term: 'EFC elicitation screen', def: 'Documents an unsafe action and error-forcing context, then summarizes one triangular expert judgment. It is not ATHEANA: the structured search, dependency analysis, multidisciplinary review and consensus workflow are not implemented.' },
          { term: 'Error-mode screen', def: 'Uses a SHERPA-inspired Action/Checking/Retrieval/Communication/Selection taxonomy with local L/M/H anchors. The aggregation assumes independent rows and is not a complete SHERPA workflow.' },
          { term: 'Mission-scenario screen', def: 'Adds analyst-supplied failure probabilities only after confirming scenarios are mutually exclusive and sum to no more than one. It is not a MERMOS implementation.' },
          { term: 'Category-factor screen', def: 'An uncalibrated task-category anchor × fixed aggravating-factor multiplier for prioritization. It is not JHEDI or a validated conservative bound.' },
        ],
      },
      {
        heading: 'Tip',
        items: [
          'HEPs are dimensionless probabilities. Differences among tools are not uncertainty bounds: their task definitions, evidence and assumptions differ, and screening outputs are not interchangeable with decision-grade estimates.',
        ],
      },
    ],
  },

  warranty: {
    title: 'Warranty Analysis',
    overview:
      'Fit period-grouped warranty return data with a weighted interval-censored likelihood and forecast future returns without rounding aggregate counts.',
    sections: [
      {
        heading: 'Workflow',
        items: [
          'Enter shipment quantities per period and the upper-triangular returns matrix (returns can only occur after shipment).',
          'A return reported at age a is retained in the interval (a−1, a]; units still in service are right-censored at the lot’s current age.',
          'The selected distribution is fitted by grouped maximum likelihood. Forecast bars include a parameter-uncertainty interval conditional on that distribution; future claim-count variation and model-selection uncertainty are not included.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'Forecast returns', def: 'Expected future claims given the fitted life distribution and units still in service.' },
          { term: 'Right-censored weight', def: 'Shipped units not yet returned. Counts remain grouped weights and are not expanded into pseudo-observations.' },
          { term: 'Grouped observations', def: 'Period returns remain weighted interval-censored observations; Perdura does not expand them into exact-age pseudo-observations.' },
        ],
      },
    ],
  },

  hypothesis: {
    title: 'Hypothesis Tests',
    overview:
      'Classical statistical tests (t-tests, ANOVA, proportions, chi-square, normality, variance) with plain-English conclusions.',
    sections: [
      {
        heading: 'Data entry',
        items: [
          'Don\'t know which test to use? Click "Test wizard — help me choose": it asks what you\'re comparing (one sample / two groups / several / counts), whether data are paired, and how normal they look — then selects the right test with its assumptions.',
          'Type/paste values, or use Import CSV on the tabular fields (group, factorial, repeated-measures, contingency) to load a CSV/TSV file.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'p-value', def: 'Probability of data this extreme if the null hypothesis were true; small p (< α) ⇒ reject the null.' },
          { term: 'Significance level α', def: 'Your false-positive tolerance (commonly 0.05).' },
          { term: 'Confidence interval', def: 'Plausible range for the true effect; if it excludes the null value, the result is significant.' },
          { term: 'Mann–Whitney effect direction', def: 'Positive rank-biserial correlation means group A tends to be larger than group B; swapping groups reverses the sign.' },
          { term: 'Repeated-measures sphericity', def: 'Mauchly’s diagnostic and Greenhouse–Geisser / Huynh–Feldt epsilons are reported. Perdura selects Greenhouse–Geisser degrees of freedom when Mauchly rejects sphericity.' },
          { term: 'Mixed model', def: 'Complete repeated profiles use a pooled REML within-subject covariance and Wald tests. Unequal between-group subject counts are supported; covariance fallbacks and denominator-df approximation are explicit.' },
          'Statistical significance is not practical importance — also judge the effect size.',
        ],
      },
    ],
  },

  dataAnalysis: {
    title: 'Statistical Modeling',
    overview:
      'A combined workspace for descriptive statistics and Regression & ML over a single shared dataset. Enter data once, then summarize, visualize and model it.',
    sections: [
      {
        heading: 'Working with analyses',
        items: [
          'Run several independent analyses side by side using the Analysis tabs; each keeps its own dataset and results. Closing the last tab spawns a fresh blank one.',
          { term: 'Stale indicator', def: 'When you change the data after computing results, the tab shows an amber asterisk and a banner offers to re-run — so results are never silently out of date.' },
          { term: 'Shared dataset', def: 'Descriptive Statistics and Regression & ML read the same dataset; enter it once. Both tabs offer the same "Generate column" tools — fill a column from a formula over the other columns or with random draws from a distribution.' },
          { term: 'Import CSV', def: 'Load a CSV/TSV file straight into the data grid (headers become columns); spreadsheet paste also works.' },
        ],
      },
      {
        heading: 'Descriptive Statistics',
        items: [
          'Tables/charts: summary statistics, histogram, boxplot, violin, raincloud, run chart, frequency and contingency tables.',
          'Multi-variable plots: scatter matrix, correlation heatmap, normal QQ plot, and ECDF.',
          'Ctrl/⌘-click tabs to show several plots at once; plain click shows just one.',
          { term: 'Variable to analyze', def: 'The histogram, boxplot, run chart and QQ plot act on a single column — pick it from the "Variable to analyze" selector in the left panel.' },
          { term: 'Export a plot', def: 'Hover any plot and use its toolbar (top-right) to download a PNG, an SVG vector, or a standalone interactive HTML copy.' },
          { term: 'Mean vs median', def: 'A large gap signals skew or outliers.' },
          { term: 'Std. dev. / IQR', def: 'Spread of the data; IQR is robust to outliers.' },
          { term: 'Skewness / kurtosis', def: 'Asymmetry and tail-heaviness relative to a normal distribution.' },
        ],
      },
      {
        heading: 'Regression & ML',
        items: [
          'Use the Prepare → Compare & tune → Diagnose → Finalize & predict workflow. Choose the target, features available at prediction time, task, missing-data policy, validation structure, and candidate models.',
          'All leaderboard values are generated from outer validation folds. Preprocessing and hyperparameter selection occur only inside the corresponding training data, so classical and machine-learning models are compared on the same out-of-sample basis.',
          { term: 'Tuning budgets', def: 'Quick uses 3 outer × 3 inner folds with up to 12 parameter candidates; Standard uses 5 × 3 with up to 24; Thorough uses 5 × 5 with up to 50. Smaller datasets may support fewer folds.' },
          { term: 'Validation structure', def: 'Auto uses stratified folds for classification and shuffled folds for regression. Group keeps repeated entities together. Time uses forward-chaining splits and never trains on later rows to predict earlier rows.' },
          { term: 'Missing predictors', def: 'Imputation and missingness indicators are learned within each training fold. Drop removes incomplete predictor rows. Rows with a missing target are always excluded and counted.' },
          { term: 'Metric interval', def: 'Uncertainty around validation metrics uses stratified resampling for classification, cluster resampling for groups, moving-block resampling for time data, and ordinary row resampling otherwise.' },
          { term: 'Probability calibration', def: 'For binary classification, sigmoid or adequately supported isotonic calibration is estimated from inner held-out probabilities. Reliability diagrams and proper probability scores remain outer-fold diagnostics.' },
          { term: 'Decision costs', def: 'Define false-positive and false-negative costs to select a binary decision threshold. Threshold selection occurs on inner predictions and is evaluated only on outer folds.' },
          { term: 'Threshold sensitivity', def: 'The Diagnose view plots each outer training fold’s inner-validation score across candidate thresholds. The dashed reference is the median diagnostic threshold; finalization recomputes the deployed policy from full-development-data inner predictions.' },
          { term: 'Permutation importance', def: 'Reports the held-out score decrease after disrupting each raw feature. It works across model families but is descriptive—not causal—and correlated features can divide or mask importance.' },
          { term: 'Partial dependence / ICE', def: 'Shows average and individual model response as a numeric feature changes. Correlated predictors can make some displayed combinations unrealistic, so Perdura reports correlation warnings.' },
          { term: 'Prediction interval', def: 'Regression bands use a cross-validated held-out residual quantile. Random-row analyses receive an approximate exchangeable-row interpretation; group/time bands are explicitly labeled empirical rather than given a formal coverage claim.' },
          { term: 'Finalize', def: 'Creates an immutable project model asset with its training snapshot, data fingerprint, schema, parameters, validation evidence, dependency versions, and model card. Saved assets remain selectable after later comparison runs; editing the live dataset never silently refits one.' },
          { term: 'ONNX export', def: 'Supported fitted pipelines are converted and prediction-parity checked before export. CHAID uses a safe native JSON tree. Perdura does not import pickle or joblib model files.' },
          { term: 'Model-card export', def: 'The model-card JSON records purpose, schema, evidence, settings, versions and artifact metadata, but deliberately omits executable bytes and training rows. A full project snapshot is the explicit way to transfer the complete asset.' },
          { term: 'Prediction', def: 'Score a single set of inputs or paste many rows into a finalized model. Download predictions, probabilities, and available regression intervals as CSV.' },
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'R²', def: 'Fraction of variance explained (regression); higher is better.' },
          { term: 'Coefficient p-value', def: 'Whether a predictor is significantly related to the target.' },
          { term: 'Accuracy / F1 / ROC AUC', def: 'Classification quality; F1 balances precision and recall, AUC is threshold-independent.' },
          { term: 'Odds ratio (logistic)', def: 'Multiplicative change in odds of the positive class per unit predictor.' },
        ],
      },
    ],
  },

  sixSigma: {
    title: 'Six Sigma',
    overview:
      'Process-quality tools: process capability (Cp/Cpk), measurement systems analysis (Gage R&R), statistical process control (SPC) charts, and design of experiments (DOE).',
    sections: [
      {
        heading: 'Interpretation',
        items: [
          { term: 'Cp / Cpk', def: 'Diagnostic capability estimates; a capability decision is withheld until Phase-I stability is demonstrated.' },
          { term: 'Nonnormal sensitivity', def: 'Compares empirical, robust-quantile, fitted-distribution and Box-Cox Ppk, with bootstrap intervals and tail-data warnings.' },
          { term: 'Gage R&R %', def: 'Measurement variation as a share of total. Classical methods require a balanced crossed design; REML supports validated unbalanced or nested topology.' },
          { term: 'Phase I / Phase II', def: 'Phase I establishes a reviewed baseline; Phase II evaluates new points against limits frozen from that separate baseline.' },
        ],
      },
      {
        heading: 'Design of Experiments',
        items: [
          'Not sure which design to use? Click "Design wizard — help me choose" at the top of the DOE sidebar: answer a few questions (goal, number of factors, budget/constraints) and it recommends an appropriate design with a rationale, run count, cautions, and alternatives — then generates it.',
          { term: 'Screening', def: 'Full/fractional factorials and Plackett-Burman find the vital few factors. Two-level analysis rejects factors with any other level count. PB uses verified orthogonal constructions for 1–63 factors (4–64 runs).' },
          { term: 'Validated design contract', def: 'Every generator reports its design class, planned model, matrix rank/condition, estimability, replication/pure-error capacity, aliases, coding, blocking and reproducible run-order provenance.' },
          { term: 'Power plan', def: 'Uses a noncentral-t calculation for a specified coded coefficient divided by residual σ. It reports current per-term power and the complete-design replication count needed to reach the target; it assumes independent homoscedastic normal errors.' },
          { term: 'Blocking', def: 'Generic nuisance blocks are balanced over coded factors and included as fixed effects in analysis. Always inspect the reported block/treatment confounding diagnostic; generic allocation is not a regular-fraction defining-contrast construction.' },
          { term: 'Optimization', def: 'Central Composite and Box-Behnken responses fit a full quadratic surface. The result includes term inference, pure-error lack-of-fit, and a stationary point classified as a minimum, maximum, saddle or ridge—and flags points outside the tested range.' },
          { term: 'Mixture', def: 'Simplex lattice/centroid and extreme-vertices responses use linear or quadratic Scheffé blending models (no intercept because proportions sum to 100%), then optimize predictions inside the supplied component bounds.' },
          { term: 'Lack of fit', def: 'Separates residual error into pure error among replicated design points and model lack-of-fit. Without replicated points, Perdura explicitly declines this test.' },
          { term: 'Robust (Taguchi)', def: 'Orthogonal arrays study many factors in few balanced runs to reduce sensitivity to noise.' },
        ],
      },
    ],
  },
  reportBuilder: {
    title: 'Report Builder',
    overview:
      'Compose professional reports from your analysis results. All project assets — plots, tables, and key metrics — are automatically enumerated from every module. Manage multiple reports with tabs, configure headers and footers, and export as PDF or interactive HTML.',
    sections: [
      {
        heading: 'Multiple Reports',
        items: [
          'The tab bar at the top lets you manage multiple reports in the same project.',
          'Click a tab to switch reports. Click "+" to create a new report.',
          'Double-click a tab to rename the report. Right-click or use the "x" button to delete a report.',
          '"Export All" exports every report as a separate PDF.',
          'Templates save and load per-report (the active report).',
        ],
      },
      {
        heading: 'Project Assets',
        items: [
          'All analysis results (plots, summary tables, key metrics) are automatically discovered from every module in the project.',
          'Assets are grouped by module and then by analysis tab in the left sidebar; each group is collapsible and remembers its state. Expand a group and click any asset to add it to the report.',
          'Assets are gathered across all analysis tabs, not just the active one.',
          'Click the refresh icon to re-scan the project for new or updated results.',
          'The "Refresh live data" link at the bottom of the report updates all asset-backed blocks with the latest data.',
        ],
      },
      {
        heading: 'Page Format',
        items: [
          { term: 'Orientation', def: 'Portrait or landscape. The on-screen page preview and both exports follow your choice.' },
          { term: 'Page size', def: 'A4, Letter, Legal, or A3.' },
          { term: 'Margins', def: 'Adjustable page margin (mm), applied to the PDF, the HTML print layout, and the preview.' },
        ],
      },
      {
        heading: 'Header & Footer',
        items: [
          'Enable custom headers and/or footers for each report from the collapsible panel in the sidebar.',
          'Each has left, center, and right text fields. Use tokens: {date}, {page}, {pages}.',
          'Choose a date format (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY) and font size.',
          'Headers and footers appear on every page of the PDF export and in the preview canvas.',
        ],
      },
      {
        heading: 'Building the Report',
        items: [
          { term: 'Heading', def: 'A section header with selectable level (H1/H2/H3). Click the level buttons to resize.' },
          { term: 'Text', def: 'A free-form text paragraph. Supports multi-line input.' },
          { term: 'Metrics', def: 'A key-value card showing summary statistics from an analysis (e.g. system reliability, MTBF).' },
          { term: 'Divider', def: 'A horizontal rule to separate sections.' },
          { term: 'Page Break', def: 'Forces a new page in the PDF export.' },
          'Drag blocks by the grip handle to reorder. Hover over a block to reveal the delete button.',
          'Click the label of a plot, table, or metrics block to rename it inline.',
        ],
      },
      {
        heading: 'Templates',
        items: [
          'Save the current report structure as a reusable template.',
          'Export templates as JSON files to share with colleagues.',
          'Import a previously exported template to restore a report layout.',
        ],
      },
    ],
  },
}
