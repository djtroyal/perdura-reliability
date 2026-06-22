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
          'Enter failure times (and any suspensions) in the data grid, or generate a Monte-Carlo sample from a chosen distribution.',
          'Pick a distribution (or "Fit Everything" to rank them by goodness-of-fit) and a fitting method (MLE or least squares).',
          'Choose a confidence level; fitted parameters and curves are reported with confidence bounds.',
          'Read results on the probability plot, the PDF/CDF/SF/HF curves, or the stacked Quad View.',
        ],
      },
      {
        heading: 'Inputs',
        items: [
          { term: 'Failures', def: 'Exact times at which units failed.' },
          { term: 'Right-censored (suspensions)', def: 'Units still operating when observation ended; they contribute partial information.' },
          { term: 'Method', def: 'MLE is the default and rigorous; least squares (rank regression) is useful for small or heavily censored samples.' },
          { term: 'CI', def: 'Confidence level (e.g. 95%) for parameter and curve bounds.' },
        ],
      },
      {
        heading: 'Reading the results',
        items: [
          { term: 'Probability plot', def: 'Points should fall along the fitted line if the distribution fits. Enable "Show suspensions" to mark each right-censored time with a triangle icon along the x-axis.' },
          { term: 'Multiple plots', def: 'Ctrl/⌘-click the plot view tabs (Probability, PDF, CDF, SF, HF) to display several at once; plain click shows just one.' },
          { term: 'Stale results', def: 'If you change the data after fitting, an amber asterisk appears on the folio tab and a banner offers to re-run, so results are never silently out of date.' },
          { term: 'AICc / BIC', def: 'Lower is better; used to compare candidate distributions.' },
          { term: 'B-life (e.g. B10)', def: 'Time by which a given fraction (10%) of the population is expected to fail.' },
          { term: 'Confidence bands', def: 'Wider bands mean more uncertainty (small samples, heavy censoring).' },
        ],
      },
    ],
  },

  alt: {
    title: 'Reliability Testing',
    overview:
      'Plan and analyze reliability demonstration tests and accelerated life tests (ALT): sample sizes, test duration, success/failure demonstration, and life-stress models.',
    sections: [
      {
        heading: 'What you can do',
        items: [
          'Demonstration test design (zero/limited-failure plans) for a reliability/confidence target.',
          'Accelerated life test fitting (Arrhenius, Eyring, inverse power law, etc.) to extrapolate from elevated stress to use conditions.',
          'Operating characteristic (OC) curves and pass-probability analysis.',
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
      'Build reliability block diagrams (RBD) and fault trees to roll component reliabilities up to a system-level prediction.',
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
        heading: 'Interpretation',
        items: [
          { term: 'Series path', def: 'All blocks must work; system reliability is the product — the weakest block dominates.' },
          { term: 'Parallel/redundant path', def: 'Only one branch must work; redundancy raises reliability.' },
          { term: 'Minimal cut set', def: 'A smallest combination of failures that fails the system; small cut sets are high-risk.' },
          { term: 'Birnbaum / importance', def: 'How much a component contributes to system failure — prioritize improvements there.' },
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
          { term: 'MIL-HDBK-217F', def: 'Stress-based model for military/aerospace electronics (with optional VITA 51.1).' },
          { term: 'Telcordia SR-332', def: 'Commercial/telecom electronics.' },
          { term: '217Plus / FIDES', def: 'Modern stress + process-grade methodologies.' },
          { term: 'NSWC-98/LE1', def: 'Mechanical parts (bearings, springs, valves, …).' },
          { term: 'EPRD-2014 / NPRD-2023', def: 'Empirical (field-data) failure rates for electronic and nonelectronic parts.' },
        ],
      },
      {
        heading: 'Workflow',
        items: [
          'Pick a standard, then drag components from the standard-specific Component Library into the parts list.',
          'Set each part’s parameters, environment and quantity.',
          'Read the system failure rate (FPMH) and MTBF; use Derating and Mission Profile tools for stress and phased-mission analysis.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'FPMH', def: 'Failures per million hours; system FPMH is the sum over parts.' },
          { term: 'MTBF', def: '1e6 / FPMH (hours) — only meaningful for constant-rate (exponential) assumptions.' },
          { term: 'Contribution', def: 'Each part’s share of the total — target the largest contributors first.' },
        ],
      },
    ],
  },

  pof: {
    title: 'Physics of Failure',
    overview:
      'Apply physics-of-failure and stress models (Arrhenius, Coffin-Manson, Black, Peck, Paris law, S-N fatigue, creep, etc.) to predict wear-out and damage accumulation.',
    sections: [
      {
        heading: 'Interpretation',
        items: [
          { term: 'Acceleration factor', def: 'Ratio of life at use vs test conditions for the chosen mechanism.' },
          { term: 'Activation energy (Ea)', def: 'Higher Ea means stronger temperature sensitivity.' },
          { term: "Miner's rule damage", def: 'Damage sums to 1 at failure; >1 predicts failure.' },
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
        ],
      },
    ],
  },

  warranty: {
    title: 'Warranty Analysis',
    overview:
      'Convert warranty return data (Nevada chart of shipments vs returns) into life data, fit a distribution, and forecast future returns.',
    sections: [
      {
        heading: 'Workflow',
        items: [
          'Enter shipment quantities per period and the upper-triangular returns matrix (returns can only occur after shipment).',
          'Convert to failure/suspension times, then forecast returns for future periods.',
        ],
      },
      {
        heading: 'Interpretation',
        items: [
          { term: 'Forecast returns', def: 'Expected future claims given the fitted life distribution and units still in service.' },
          { term: 'Suspensions', def: 'Shipped units not yet returned — censored survivors that inform the fit.' },
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
        heading: 'Interpretation',
        items: [
          { term: 'p-value', def: 'Probability of data this extreme if the null hypothesis were true; small p (< α) ⇒ reject the null.' },
          { term: 'Significance level α', def: 'Your false-positive tolerance (commonly 0.05).' },
          { term: 'Confidence interval', def: 'Plausible range for the true effect; if it excludes the null value, the result is significant.' },
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
          'Run several independent analyses side by side using the Analysis tabs (folios); each keeps its own dataset and results. Closing the last tab spawns a fresh blank one.',
          { term: 'Stale indicator', def: 'When you change the data after computing results, the tab shows an amber asterisk and a banner offers to re-run — so results are never silently out of date.' },
          { term: 'Shared dataset', def: 'Descriptive Statistics and Regression & ML read the same dataset; enter it once.' },
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
          { term: 'Cp / Cpk', def: 'Capability vs spec width; Cpk also accounts for centering. ≥ 1.33 is commonly required.' },
          { term: 'Gage R&R %', def: 'Measurement variation as a share of total; < 10% is good, > 30% unacceptable.' },
          { term: 'Out-of-control points', def: 'SPC rule violations indicating special-cause variation to investigate.' },
        ],
      },
    ],
  },
}
