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
          { term: 'Method', def: 'MLE is the default and rigorous; least squares (rank regression) is useful for small or heavily censored samples.' },
          { term: 'CI', def: 'Confidence level (e.g. 95%) for parameter and curve bounds.' },
          { term: 'Grouped data', def: 'In Parametric mode with Weibull 2P selected, enable the "Grouped data" checkbox to fit a grouped Weibull 2P model where each distinct failure time represents a group.' },
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
          { term: 'Calibrated scalar interval', def: 'A confidence interval for one derived quantity from the fitted model—either reliability at a chosen time or a life quantile such as B10. It is not a simultaneous band for the whole curve. Profile likelihood re-fits nuisance parameters at candidate values; parametric bootstrap repeatedly simulates and re-fits datasets to calibrate sampling uncertainty.' },
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
          'Projected failure times are fitted to a life distribution; choose a specific distribution or "Best fit" to auto-select by AICc with a full ranking table.',
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
      'Predict component and system failure rates (FPMH) using standards-based handbook methods, then optionally apply derating and mission-profile analysis.',
    sections: [
      {
        heading: 'Standards',
        items: [
          { term: 'MIL-HDBK-217F', def: 'Notice 2 part-stress and parts-count models for electronic equipment. Results expose the exact clause, equation, factors, substitutions, assumptions, and source adjustments.' },
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
      'Track and project reliability improvement during development using Crow-AMSAA (NHPP) and Duane models, plus repairable-system trend tests.',
    sections: [
      {
        heading: 'Interpretation',
        items: [
          { term: 'Growth slope (β)', def: 'β < 1 indicates improving reliability (failure intensity decreasing).' },
          { term: 'Instantaneous MTBF', def: 'Current MTBF at the end of the test, vs the cumulative average.' },
          { term: 'Laplace trend test', def: 'Detects whether times-between-failures are trending (improving/degrading) or stationary.' },
          { term: 'Optimal replacement', def: 'Finds the preventive-replacement interval that minimizes cost per unit time; the Weibull α/β can be pulled from a fitted Life Data distribution.' },
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
          'Choose a target and features, pick a model — classical regression (linear, polynomial, ridge, lasso, elastic net, logistic), trees/ensembles, SVM/KNN, neural net; incompatible models are greyed out.',
          'Generate columns from a distribution or a formula (e.g. x2 = x1 * 2); set the confidence level for inference.',
          'Fit one model or "Fit all compatible" and compare them interactively.',
          { term: 'Prediction', def: 'Score a single set of inputs, or paste/upload many rows for batch scoring and download the predictions as CSV.' },
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
