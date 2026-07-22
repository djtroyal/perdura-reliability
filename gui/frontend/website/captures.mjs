/**
 * Source of truth for product screenshots published to perdura-website.
 *
 * A submodule is a persistent primary/secondary analysis tab or tool. Plot
 * modes, model choices within an analysis, cosmetic toggles, and modal wizards
 * are intentionally not separate coverage obligations. Existing curated
 * multi-view captures remain registered as extras.
 */

export const WEBSITE_RESOURCE_SCHEMA = 'perdura.website-resources/v1'
export const VIEWPORT = { width: 2280, height: 1365, deviceScaleFactor: 1 }
export const EMPTY_RESULT_PATTERN = /No results yet|No analysis results|Configure (?:inputs|a design) and click|(?:Enter|Set|Select|Paste) .{0,160}(?:click|run the|compute the|to see)|Analysis failed/i

const shot = (id, module, websiteModule, group, file, title, actions = [], options = {}) => ({
  id, module, websiteModule, group, file, title,
  alt: `${title} in the Perdura reliability engineering suite`, actions,
  frame: 'viewport', required: true, resultRequired: true, primary: false, ...options,
})

const tabShots = (module, websiteModule, group, specs, prefix = []) => specs.map(spec =>
  shot(spec[0], module, websiteModule, group, spec[1], spec[2], [...prefix, ...(spec[3] ?? [])], spec[4] ?? {}))

export const captures = [
  shot('dashboard.overview', 'dashboard', 'dashboard', 'Project', 'dashboard.png', 'Project dashboard', [], { primary: true, resultRequired: false }),

  ...tabShots('life-data', 'life-data-analysis', 'Life Data Analysis', [
    ['life-data.parametric', 'lda-parametric.png', 'Parametric distribution fitting', ['parametric'], { primary: true }],
    ['life-data.nonparametric', 'lda-non-param.png', 'Non-parametric life data analysis', ['nonparametric']],
    ['life-data.special', 'lda-special-models.png', 'Special lifetime models', ['special']],
    ['life-data.weibayes', 'lda-weibayes.png', 'Weibayes fixed-shape analysis', ['weibayes']],
    ['life-data.cfm', 'lda-competing-failure-modes.png', 'Competing failure modes', ['cfm']],
    ['life-data.stress-strength', 'lda-s-s.png', 'Stress–strength interference', ['stressstrength']],
    ['life-data.compare', 'lda-compare-analyses.png', 'Compare life-data analyses', ['compare'], { resultRequired: false }],
  ]),

  ...tabShots('alt', 'accelerated-life-testing', 'Accelerated Life Testing', [
    ['alt.model', 'alt-life-stress.png', 'Life–stress modeling', ['model'], { primary: true }],
    ['alt.acceleration', 'alt-acceleration-factor.png', 'Acceleration-factor calculator', ['accel']],
    ['alt.step-stress', 'alt-step-sequential-stress.png', 'Step and sequential stress testing', ['step'], { seedExample: true }],
    ['alt.multi-stress', 'alt-multi-stress.png', 'Multi-stress testing', ['multi'], { seedExample: true }],
    ['alt.halt', 'alt-halt.png', 'HALT planning', ['halt'], { seedExample: true }],
    ['alt.margin', 'alt-margin-test.png', 'Reliability margin testing', ['margin'], { seedExample: true }],
  ], ['alt']),

  ...tabShots('alt', 'more-tools', 'Reliability Demonstration Testing', [
    ['rdt.parametric', 'reliability-testing-rdt-parametric-binomial.png', 'Parametric binomial demonstration', ['parametric'], { primary: true }],
    ['rdt.nonparametric', 'reliability-testing-rdt-non-parametric-binomial.png', 'Non-parametric binomial demonstration', ['nonparametric']],
    ['rdt.chi-squared', 'reliability-testing-rdt-exponential-chi-squared.png', 'Exponential chi-squared demonstration', ['chisquared']],
    ['rdt.bayesian', 'reliability-testing-rdt-non-parametric-bayesian.png', 'Non-parametric Bayesian demonstration', ['bayesian']],
  ], ['rdt']),

  ...tabShots('alt', 'more-tools', 'Test Design and Planning', [
    ['test.expected', 'alt-test-design-and-planning-expected-failure-times.png', 'Expected failure-time planning', ['expected']],
    ['test.difference', 'reliability-testing-test-design-and-planning-difference-detection-matrix.png', 'Difference-detection matrix', ['difference']],
    ['test.simulation', 'reliability-testing-test-design-and-planning-simulation.png', 'Reliability-test simulation', ['simulation']],
    ['test.exponential', 'reliability-testing-test-design-and-planning-exponential.png', 'Exponential test planner', ['exp-planner']],
    ['test.duration', 'reliability-testing-test-design-and-planning-duration.png', 'Test-duration planning', ['duration']],
    ['test.zero-failure', 'reliability-testing-test-design-and-planning-zero-failure.png', 'Zero-failure sample size', ['no-failures']],
    ['test.sequential', 'reliability-testing-test-design-and-planning-sequential-sampling.png', 'Sequential sampling', ['sequential']],
    ['test.one-proportion', 'reliability-testing-test-design-and-planning-one-proportion.png', 'One-sample proportion planning', ['one-proportion']],
    ['test.two-proportion', 'reliability-testing-test-design-and-planning-two-proportion.png', 'Two-proportion comparison', ['two-proportion']],
    ['test.goodness-of-fit', 'reliability-testing-test-design-and-planning-goodness-of-fit.png', 'Distribution goodness-of-fit planning', ['gof'], {
      seedActions: [{ fill: 'textarea:visible', value: '34, 38, 41, 44, 47, 49, 52, 54, 57, 59, 62, 64, 67, 70, 73, 76, 79, 83, 87, 91, 96, 101, 107, 114, 122, 131, 141, 153, 168, 186' }],
    }],
  ], ['design']),

  ...tabShots('alt', 'degradation-analysis', 'Degradation and Screening', [
    ['degradation.nondestructive', 'reliability-degradation-and-screening-non-destructive.png', 'Non-destructive degradation analysis', ['degradation', 'nondestructive'], { primary: true }],
    ['degradation.destructive', 'reliability-degradation-and-screening-destructive.png', 'Destructive degradation analysis', ['degradation', 'destructive'], { seedExample: true }],
    ['degradation.ess', 'reliability-degradation-and-screening-ess.png', 'Environmental stress screening', ['ess']],
    ['degradation.hass', 'reliability-degradation-and-screening-hass.png', 'Highly accelerated stress screening', ['hass']],
    ['degradation.burn-in', 'reliability-degradation-and-screening-burn-in-design.png', 'Burn-in test design', ['burn-in']],
  ], ['degradation']),

  ...tabShots('system-modeling', 'system-reliability-rbd', 'System Modeling', [
    ['system.rbd', 'system-modeling-rbd.png', 'Reliability block diagram', ['rbd'], { primary: true, resultRequired: false }],
  ]),
  ...tabShots('system-modeling', 'fault-tree-analysis', 'System Modeling', [
    ['system.fta', 'system-modeling-fta.png', 'Fault tree analysis', ['fta'], { primary: true, resultRequired: false }],
  ]),
  ...tabShots('system-modeling', 'markov-models', 'System Modeling', [
    ['system.markov', 'system-modeling-markov-analysis.png', 'Markov state-space analysis', ['markov'], { primary: true, resultRequired: false }],
  ]),

  shot('allocation.overview', 'allocation', 'reliability-allocation', 'Allocation', 'reliability-allocation.png', 'Reliability allocation', [], { primary: true }),
  shot('prediction.overview', 'prediction', 'failure-rate-prediction', 'Prediction', 'failure-rate-prediction.png', 'MIL-HDBK-217F failure-rate prediction', [], { primary: true }),

  ...tabShots('pof', 'physics-of-failure', 'Thermal and Temperature', [
    ['pof.arrhenius', 'pof-arrhenius.png', 'Arrhenius acceleration model', ['arrhenius'], { primary: true }],
    ['pof.eyring', 'pof-eyring.png', 'Eyring acceleration model', ['eyring']],
  ]),
  ...tabShots('pof', 'physics-of-failure', 'Thermal Cycling and Fatigue', [
    ['pof.coffin-manson', 'pof-coffin-manson.png', 'Coffin–Manson strain-life model', ['coffin-manson']],
    ['pof.norris-landzberg', 'pof-norris-landzberg.png', 'Norris–Landzberg solder-fatigue model', ['norris-landzberg']],
    ['pof.sn', 'pof-s-n-curve.png', 'S–N fatigue curve', ['sn']],
    ['pof.damage', 'pof-miners-rule.png', "Miner's cumulative-damage rule", ['damage'], { seedExample: true }],
    ['pof.mean-stress', 'pof-mean-stress-correction.png', 'Mean-stress correction', ['mean-stress']],
  ]),
  ...tabShots('pof', 'physics-of-failure', 'Humidity', [
    ['pof.peck', 'pof-peck.png', 'Peck temperature-humidity model', ['peck']],
    ['pof.hallberg-peck', 'pof-hallberg-peck.png', 'Hallberg–Peck acceleration model', ['hallberg-peck']],
  ]),
  ...tabShots('pof', 'physics-of-failure', 'Electrical', [
    ['pof.electromigration', 'pof-electromigration.png', 'Electromigration model', ['electromigration']],
    ['pof.tddb', 'pof-tddb.png', 'Time-dependent dielectric breakdown', ['tddb']],
  ]),
  ...tabShots('pof', 'physics-of-failure', 'Mechanical and Creep', [
    ['pof.creep', 'pof-creep-life.png', 'Creep-life model', ['creep']],
    ['pof.fracture', 'pof-fracture-mechanics.png', 'Fracture-mechanics model', ['fracture']],
    ['pof.stress-strain', 'pof-stress-strain.png', 'Stress–strain model', ['stress-strain']],
  ]),

  ...tabShots('growth', 'reliability-growth', 'Growth and Repairable Systems', [
    ['growth.crow', 'reliability-growth-crow-amsaa.png', 'Crow–AMSAA reliability growth', [
      'growth',
      { select: '[data-showcase-control="growth-model"]', value: 'crow-amsaa' },
    ], { primary: true }],
    ['growth.duane', 'reliability-growth-duane.png', 'Duane reliability growth', [
      'growth',
      { select: '[data-showcase-control="growth-model"]', value: 'duane' },
    ]],
    ['growth.rocof', 'reliability-growth-rocof.png', 'Rate-of-occurrence-of-failures analysis', ['rocof']],
    ['growth.mcf', 'reliability-growth-mcf.png', 'Mean cumulative function', ['mcf']],
  ]),

  ...tabShots('maintenance', 'maintenance-availability', 'Maintenance', [
    ['maintenance.availability', 'maintenance-availability.png', 'Availability modeling', ['availability'], { primary: true }],
    ['maintenance.maintainability', 'maintenance-maintainability.png', 'Maintainability analysis', ['maintainability']],
    ['maintenance.spares', 'maintenance-spares.png', 'Spare-parts provisioning', ['spares']],
    ['maintenance.replacement', 'maintenance-replacement-policy.png', 'Replacement-policy optimization', ['replacement']],
    ['maintenance.pm', 'maintenance-pm-interval.png', 'Preventive-maintenance interval', ['pm-interval']],
    ['maintenance.cost', 'maintenance-cost-forecast.png', 'Maintenance cost forecast', ['cost-forecast']],
    ['maintenance.virtual-age', 'maintenance-virtual-age.png', 'Virtual-age maintenance simulation', ['virtual-age']],
    ['maintenance.sensitivity', 'maintenance-avail-sensitivity.png', 'Availability sensitivity analysis', ['availability-sensitivity']],
  ]),

  ...tabShots('hra', 'human-reliability', 'Human Reliability', [
    ['hra.overview', 'hra-overview.png', 'Human reliability overview', ['overview'], { primary: true, resultRequired: false }],
    ['hra.therp', 'hra-therp.png', 'THERP analysis', ['therp']],
    ['hra.heart', 'hra-heart.png', 'HEART analysis', ['heart']],
    ['hra.spar-h', 'hra-spar-h.png', 'SPAR-H analysis', ['spar-h']],
    ['hra.cream', 'hra-cream.png', 'CREAM analysis', ['cream']],
    ['hra.cream-extended', 'hra-cream-extended.png', 'Extended CREAM analysis', ['cream-extended']],
    ['hra.slim', 'hra-slim-maud.png', 'SLIM-MAUD analysis', ['slim']],
    ['hra.atheana', 'hra-atheana.png', 'ATHEANA elicitation', ['atheana']],
    ['hra.jhedi', 'hra-jhedi.png', 'JHEDI category screening', ['jhedi']],
    ['hra.sherpa', 'hra-sherpa.png', 'SHERPA error-mode screening', ['sherpa']],
    ['hra.mermos', 'hra-mermos.png', 'MERMOS mission scenarios', ['mermos'], {
      seedActions: [{ click: 'input[type="checkbox"]:visible' }],
    }],
  ]),

  shot('warranty.overview', 'warranty', 'warranty-analysis', 'Warranty', 'warranty-analysis.png', 'Warranty return analysis and forecasting', [], { primary: true }),

  ...tabShots('hypothesis', 'statistical-modeling', 'Hypothesis Tests', [
    ['hypothesis.parametric', 'hypothesis-tests-parametric.png', 'Parametric hypothesis tests', ['parametric'], { seedExample: true }],
    ['hypothesis.nonparametric', 'hypothesis-tests-nonparametric.png', 'Non-parametric hypothesis tests', ['nonparametric'], { seedExample: true }],
    ['hypothesis.anova', 'hypothesis-tests-anova.png', 'ANOVA and post-hoc analysis', ['anova'], { seedExample: true }],
    ['hypothesis.proportion', 'hypothesis-tests-proportion.png', 'Proportion and contingency tests', ['proportion'], { seedExample: true }],
  ]),

  ...tabShots('data-analysis', 'statistical-modeling', 'Descriptive Statistics', [
    ['descriptive.box-violin', 'statistical-modeling-descriptive-boxplot-violin.png', 'Boxplot and violin plots', ['descriptive', 'boxplot', { tab: 'violin', modifiers: ['Control'] }], { skipRun: true, fixtureFirst: true, fixtureModules: ['dataAnalysisData', 'descriptive'] }],
    ['descriptive.correlation-qq', 'statistical-modeling-descriptive-correlation-qq-plot.png', 'Correlation and Q–Q plots', ['descriptive', 'correlation', { tab: 'qq', modifiers: ['Control'] }], { skipRun: true, skipFixture: true, fixtureModules: ['dataAnalysisData', 'descriptive'] }],
    ['descriptive.ecdf-run', 'statistical-modeling-descriptive-ecdf-run-chart.png', 'ECDF and run chart', ['descriptive', 'ecdf', { tab: 'runchart', modifiers: ['Control'] }], { fixtureFirst: true }],
    ['descriptive.rain-scatter', 'statistical-modeling-descriptive-raincloud-scatter-matrix.png', 'Raincloud and scatter-matrix plots', ['descriptive', 'raincloud', { tab: 'scatter', modifiers: ['Control'] }], { skipRun: true, skipFixture: true, fixtureModules: ['dataAnalysisData', 'descriptive'] }],
  ]),
  shot('modeling.workflow', 'data-analysis', 'statistical-modeling', 'Regression and ML', 'statistical-modeling-regression-ml.png', 'Regression and machine-learning workflow', ['modeling'], { primary: true }),

  ...tabShots('six-sigma', 'six-sigma', 'Six Sigma', [
    ['six-sigma.capability', 'six-sigma-process-capability.png', 'Process capability analysis', ['capability'], { primary: true }],
    ['six-sigma.msa', 'six-sigma-msa.png', 'Measurement systems analysis', ['msa']],
    ['six-sigma.spc', 'six-sigma-spc.png', 'Statistical process control', ['spc']],
    ['six-sigma.doe', 'six-sigma-doe.png', 'Design of experiments', ['doe'], { skipFixture: true }],
  ]),

  shot('report-builder.overview', 'report-builder', 'report-builder', 'Reporting', 'report-builder.png', 'Report Builder', [], { primary: true, resultRequired: false }),
]

export function validateCaptureRegistry(items = captures) {
  const issues = []
  for (const field of ['id', 'file']) {
    const values = items.map(item => item[field])
    for (const value of new Set(values)) {
      if (values.filter(candidate => candidate === value).length > 1) issues.push(`duplicate ${field}: ${value}`)
    }
  }
  for (const item of items) {
    if (!/^[a-z0-9][a-z0-9.-]+$/.test(item.id)) issues.push(`invalid id: ${item.id}`)
    if (!/^[a-z0-9][a-z0-9-]+\.png$/.test(item.file)) issues.push(`invalid filename: ${item.file}`)
    if (!item.module || !item.websiteModule || !item.group || !item.title || !item.alt) issues.push(`incomplete metadata: ${item.id}`)
  }
  return issues
}

const issues = validateCaptureRegistry()
if (issues.length) throw new Error(`Invalid website capture registry:\n${issues.join('\n')}`)
