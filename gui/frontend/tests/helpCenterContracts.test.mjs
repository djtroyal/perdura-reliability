import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import katex from 'katex'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

const qualify = (moduleId, ids) => ids.map(id => `${moduleId}.${id}`)

try {
  const catalog = await vite.ssrLoadModule('/src/components/help/catalog.ts')
  const search = await vite.ssrLoadModule('/src/components/help/search.ts')
  const glossaryText = await vite.ssrLoadModule('/src/components/help/GlossaryText.tsx')
  const helpCenter = await vite.ssrLoadModule('/src/components/help/HelpCenter.tsx')
  const legacy = await vite.ssrLoadModule('/src/components/help/content/adaptLegacy.ts')
  const operations = await vite.ssrLoadModule('/src/components/help/content/operations.ts')
  const reliability = await vite.ssrLoadModule('/src/components/help/content/reliability.ts')
  const statistics = await vite.ssrLoadModule('/src/components/help/content/statistics.ts')

  const {
    HELP_BIBLIOGRAPHY: bibliography,
    HELP_GLOSSARY: glossary,
    HELP_MODULES: modules,
    HELP_TOPICS: topics,
    HELP_TOPIC_BY_ID: topicById,
  } = catalog

  assert.equal(modules.length, 15, 'every Perdura module must be represented')
  assert.equal(new Set(modules.map(module => module.id)).size, modules.length,
    'module IDs must be unique')
  assert.equal(new Set(topics.map(topic => topic.id)).size, topics.length,
    'catalog topic IDs must be unique')
  assert.equal(new Set(bibliography.map(entry => entry.id)).size, bibliography.length,
    'bibliography IDs must be unique')
  assert.equal(new Set(glossary.map(entry => entry.id)).size, glossary.length,
    'glossary IDs must be unique')
  assert.ok(glossary.length >= 35, 'the shared glossary should be substantial')

  const rawTopics = [
    ...legacy.LEGACY_OVERVIEW_TOPICS,
    ...operations.OPERATIONS_HELP_TOPICS,
    ...reliability.RELIABILITY_HELP_TOPICS,
    ...statistics.STATISTICS_HELP_TOPICS,
  ]
  const duplicateAuthoredIds = rawTopics.map(topic => topic.id)
    .filter((id, index, all) => all.indexOf(id) !== index)
  assert.deepEqual(duplicateAuthoredIds, [], 'authored topic IDs must not collide')

  const moduleIds = new Set(modules.map(module => module.id))
  const bibliographyIds = new Set(bibliography.map(entry => entry.id))
  for (const module of modules) {
    assert.ok(topicById.has(module.overviewTopicId),
      `${module.id} is missing its overview topic`)
  }

  let equationCount = 0
  let exampleCount = 0
  for (const topic of topics) {
    assert.ok(moduleIds.has(topic.moduleId), `${topic.id} has an unknown module`)
    assert.ok(topic.title.trim() && topic.summary.trim() && topic.basics.purpose.trim(),
      `${topic.id} is missing its basics-first introduction`)
    assert.ok(topic.sections.length > 0, `${topic.id} has no progressive sections`)
    assert.equal(new Set(topic.sections.map(section => section.id)).size,
      topic.sections.length, `${topic.id} has duplicate section IDs`)
    const depths = new Set(topic.sections.map(section => section.depth))
    if (!topic.id.endsWith('.overview')) {
      assert.ok(depths.has('practice'), `${topic.id} is missing practical guidance`)
      assert.ok(depths.has('interpretation'), `${topic.id} is missing interpretation guidance`)
      assert.ok(depths.size >= 2, `${topic.id} does not progressively disclose detail`)
    }
    let hasExample = false
    for (const section of topic.sections) {
      assert.ok(section.title.trim() && section.blocks.length,
        `${topic.id}/${section.id} is empty`)
      for (const block of section.blocks) {
        for (const citation of block.citations ?? []) {
          assert.ok(bibliographyIds.has(citation.id),
            `${topic.id} cites missing source ${citation.id}`)
        }
        if (block.type === 'equation') {
          equationCount += 1
          assert.doesNotThrow(() => katex.renderToString(block.latex, {
            displayMode: true, throwOnError: true, strict: false,
          }), `${topic.id} contains invalid KaTeX: ${block.latex}`)
        }
        if (block.type === 'example') {
          hasExample = true
          exampleCount += 1
          assert.ok(block.scenario.trim() && block.steps.length && block.result.trim(),
            `${topic.id} has an incomplete example`)
        }
      }
    }
    if (topic.exampleKind && topic.exampleKind !== 'none' && !topic.id.endsWith('.overview')) {
      assert.ok(hasExample, `${topic.id} promises an example but does not provide one`)
    }
    for (const relatedId of topic.related ?? []) {
      assert.ok(topicById.has(relatedId), `${topic.id} links to missing topic ${relatedId}`)
    }
  }
  assert.ok(equationCount >= 150, 'the manual should render its mathematical content')
  assert.ok(exampleCount >= 150, 'the manual should include substantial worked guidance')

  for (const entry of glossary) {
    assert.ok(entry.term.trim() && entry.short.trim(), `${entry.id} is incomplete`)
    for (const citation of entry.citations ?? []) {
      assert.ok(bibliographyIds.has(citation.id),
        `${entry.id} cites missing source ${citation.id}`)
    }
    for (const topicId of entry.relatedTopics ?? []) {
      assert.ok(topicById.has(topicId), `${entry.id} links to missing topic ${topicId}`)
    }
  }
  for (const entry of bibliography) {
    assert.ok(entry.author.trim() && entry.title.trim(), `${entry.id} is incomplete`)
    if (entry.url) assert.doesNotThrow(() => new URL(entry.url), `${entry.id} has an invalid URL`)
  }

  // This is intentionally coupled to the user-visible catalogs. Adding a new
  // analysis without Help causes a loud contract failure instead of silent drift.
  const requiredTopics = [
    ...modules.map(module => module.overviewTopicId),
    ...qualify('dashboard', [
      'project-files', 'recent-projects', 'analysis-status', 'unsaved-changes',
      'plot-interactions', 'help-center',
    ]),
    ...qualify('lifeData', [
      'parametric', 'nonparametric', 'special', 'weibayes', 'cfm', 'stress-strength',
      'weibull-2p', 'weibull-3p', 'exponential-1p', 'exponential-2p',
      'normal-2p', 'lognormal-2p', 'lognormal-3p', 'gamma-2p', 'gamma-3p',
      'loglogistic-2p', 'loglogistic-3p', 'beta-2p', 'gumbel-2p',
      'weibull-mixture', 'competing-risks', 'dszi', 'defective-subpopulation',
      'zero-inflated', 'observation-individual', 'observation-frequency',
      'observation-interval', 'kaplan-meier', 'nelson-aalen', 'turnbull',
      'monte-carlo', 'compare-analyses', 'distribution-spec',
      'calibrated-intervals', 'fit-everything',
    ]),
    ...qualify('alt', [
      'life-stress-models',
      ...['weibull', 'normal', 'lognormal', 'exponential'].flatMap(life =>
        ['exponential', 'eyring', 'power'].map(stress => `life-stress-${life}-${stress}`)),
      'acceleration-arrhenius', 'acceleration-inverse-power', 'acceleration-eyring',
      'acceleration-coffin-manson', 'acceleration-peck',
      'acceleration-norris-landzberg', 'acceleration-black',
      'step-stress', 'multi-stress', 'halt', 'margin-test',
      'rdt-parametric', 'rdt-nonparametric', 'rdt-chisquared', 'rdt-bayesian',
      'expected-failure-times', 'difference-detection', 'test-simulation',
      'exponential-planner', 'test-duration', 'zero-failure-sample-size', 'sprt',
      'one-proportion', 'two-proportion', 'goodness-of-fit',
      'degradation-nondestructive', 'degradation-destructive', 'ess', 'hass', 'burn-in',
    ]),
    ...qualify('systemModeling', ['rbd', 'fault-tree', 'markov']),
    ...qualify('reliabilityAllocation', ['equal', 'arinc', 'agree', 'feasibility']),
    ...qualify('prediction', [
      'mil-hdbk-217f', 'telcordia-sr332', '217plus', 'fides', 'nswc-98-le1',
      'eprd-2014', 'nprd-2023', 'part-stress', 'parts-count', 'vita-51-1',
      'system-blocks', 'overrides', 'derating', 'mission-profile',
    ]),
    ...qualify('pof', [
      'arrhenius', 'eyring', 'coffin-manson', 'norris-landzberg', 'sn', 'damage',
      'mean-stress', 'peck', 'hallberg-peck', 'electromigration', 'tddb',
      'creep', 'fracture', 'stress-strain',
    ]),
    ...qualify('growth', ['crow-amsaa', 'duane', 'rocof', 'mcf']),
    ...qualify('maintenance', [
      'availability', 'maintainability', 'spares', 'replacement', 'pm-interval',
      'cost-forecast', 'virtual-age', 'availability-sensitivity',
    ]),
    ...qualify('hra', [
      'overview', 'therp', 'heart', 'spar-h', 'cream', 'cream-extended', 'slim',
      'atheana', 'jhedi', 'sherpa', 'mermos',
    ]),
    ...qualify('warranty', [
      'workflow', 'weibull-2p', 'lognormal-2p', 'normal-2p', 'exponential-1p',
      'gamma-2p', 'loglogistic-2p', 'gumbel-2p',
    ]),
    ...qualify('hypothesis', [
      'test_selection', 'one_sample_t', 'two_sample_t', 'paired_t', 'mann_whitney',
      'wilcoxon_signed_rank', 'kruskal_wallis', 'friedman', 'one_way_anova',
      'factorial_anova', 'rm_anova', 'mixed_anova', 'chi_square_gof',
      'chi_square_independence', 'binomial_test',
    ]),
    ...qualify('dataAnalysis', [
      'descriptive', 'modeling', 'summary', 'histogram', 'boxplot', 'violin',
      'raincloud', 'scatter', 'correlation', 'qq', 'ecdf', 'runchart',
      'frequency', 'contingency', 'regression_ml_workflow', 'validation',
      'calibration', 'finalization', 'prediction', 'linear', 'logistic', 'ridge',
      'lasso', 'elastic_net', 'polynomial', 'decision_tree', 'chaid',
      'random_forest', 'gradient_boosting', 'hist_gradient_boosting', 'adaboost',
      'svm', 'knn', 'mlp',
    ]),
    ...qualify('sixSigma', [
      'capability', 'msa', 'spc', 'doe', 'msa_anova', 'msa_xbar_r', 'msa_reml',
      'spc_i_mr', 'spc_xbar_r', 'spc_xbar_s', 'spc_p', 'spc_np', 'spc_c', 'spc_u',
      'doe_full_factorial_2level', 'doe_fractional_factorial_2level',
      'doe_plackett_burman', 'doe_box_behnken', 'doe_central_composite',
      'doe_simplex_lattice', 'doe_simplex_centroid', 'doe_extreme_vertices',
      'doe_full_factorial_general', 'doe_taguchi', 'doe_analysis', 'doe_power',
      'doe_blocking',
    ]),
    ...qualify('reportBuilder', ['workflow', 'assets', 'blocks', 'templates', 'export']),
  ]
  for (const id of requiredTopics) assert.ok(topicById.has(id), `required Help topic missing: ${id}`)

  const find = (query, activeModule) => search.searchHelp(
    query, topics, glossary, modules, activeModule)
  assert.ok(find('Crow AMSA', 'growth').some(result => result.topicId === 'growth.crow-amsaa'),
    'fuzzy model-name search should find Crow-AMSAA')
  assert.ok(find('calibrated scalar interval', 'lifeData')
    .some(result => result.topicId === 'lifeData.calibrated-intervals'),
  'deep analysis concepts should be searchable')
  assert.ok(find('hazard rate').some(result => result.kind === 'glossary'),
    'glossary definitions should be searchable')
  assert.ok(find('Norris Landzberg').some(result => result.topicId?.includes('norris-landzberg')),
    'equation/model content should be searchable')

  const sampleEntry = glossary.find(entry => /^[A-Za-z]/.test(entry.term))
  assert.ok(sampleEntry)
  const segments = glossaryText.segmentGlossaryText(
    `Review the ${sampleEntry.term} before interpreting this result.`, glossary)
  assert.ok(segments.some(segment => segment.entry?.id === sampleEntry.id),
    'article text should link recognized glossary terms')
  assert.ok(!glossaryText.segmentGlossaryText('CV and β depend on context.', glossary)
    .some(segment => segment.entry),
  'ambiguous abbreviations and parameter symbols must not be auto-linked')

  const rendered = renderToStaticMarkup(createElement(helpCenter.default, {
    open: true,
    onClose: () => {},
    activeModule: 'growth',
    contextualTopicId: 'growth.crow-amsaa',
  }))
  assert.match(rendered, /Help Center/)
  assert.match(rendered, /Search all Help/)
  assert.match(rendered, /Crow.?AMSAA/)
  assert.match(rendered, /Glossary A.?Z/)

  console.log(`help-center contracts passed (${topics.length} topics, ${equationCount} equations, ${exampleCount} examples, ${glossary.length} glossary terms)`)
} finally {
  await vite.close()
}
