import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../src/components/Prediction/index.tsx', import.meta.url),
  'utf8',
)
const partsTableSource = await readFile(
  new URL('../src/components/Prediction/partsTable.tsx', import.meta.url),
  'utf8',
)

assert.match(source, /ref=\{mainContentRef\} className=\{`flex flex-1 flex-col overflow-y-auto/,
  'the prediction workspace must remain an ordered scroll container')
assert.match(source, /ref=\{resultsRef\} className="order-\[-10\] mb-6"/,
  'detailed results must render before the component library and parts list')
assert.doesNotMatch(source, /data-testid="prediction-results-summary"/,
  'the redundant Prediction Results summary card must remain removed')
const summaryCardsIndex = source.indexOf('data-testid="prediction-summary-cards"')
assert.ok(summaryCardsIndex >= 0, 'the four primary summary cards must be identifiable')
for (const marker of ['{result.methodology &&', '{result.warnings?.map', 'Prediction context:', 'result.incompatible.length']) {
  assert.ok(summaryCardsIndex < source.indexOf(marker), `summary cards must precede ${marker}`)
}
assert.match(source, /mainContentRef\.current\?\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/,
  'a successful calculation must reveal the top result area')

assert.match(source, /data-testid="prediction-view-tabs"/,
  'Analysis and Parts List must be dedicated Prediction sub-tabs')
assert.match(source, /setWorkspaceView\('analysis'\)/,
  'the Analysis sub-tab must be directly selectable')
assert.match(source, /setWorkspaceView\('parts'\)/,
  'the Parts List sub-tab must be directly selectable')
assert.match(source, /workspaceView === 'analysis' \? \(/,
  'the left pane must switch between analysis and Parts List tools')
assert.match(source, /workspaceView === 'parts' \? \(/,
  'the center pane must switch between Parts List contents and analysis results')
assert.doesNotMatch(source, /prediction-parts-window|aria-modal="true"/,
  'the Parts List must not use a floating dialog')

assert.match(source, /navigateToProblemPart\(problem\.index\)/,
  'incompatible-part warnings must link to the affected part')
assert.match(partsTableSource, /id=\{`prediction-part-row-\$\{i\}`\}/,
  'each Parts List row must expose a stable navigation target')
assert.match(source, /row\?\.scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/,
  'problem-part navigation must reveal the selected row')
assert.match(source,
  /contributionChartIsWide =[\s\S]*?contributionChartMode === 'pareto' \|\| contributionChartMode === 'sankey'[\s\S]*?contributionChartIsWide && hasContributionResults \? 'lg:col-span-2'/,
  'the reliability plot must use the full row for wide Pareto and Sankey views')
assert.match(source, /data-testid="prediction-parts-filters"/,
  'the Parts List must expose its filter toolbar')
assert.match(source, /aria-label="Quick search Parts List"/,
  'the Parts List must expose an accessible quick-search field')
assert.match(source, /PARTS_STATUS_FILTERS\.map/,
  'the Parts List must expose the operational status filters')
assert.match(source, /sortHeader\('reference_designator', 'Reference Designator'\).*sortHeader\('part_number', 'Part Number'\).*sortHeader\('category', 'Category'\)/s,
  'RefDes and Part Number must remain distinct Parts List columns')
assert.match(source, /aria-label="Failure-rate contribution grouping"[\s\S]*?<option value="reference_designator">By RefDes<\/option>[\s\S]*?<option value="part_number">By Part Number<\/option>[\s\S]*?<option value="part_category">By Part Category<\/option>/,
  'every contribution view must let users choose RefDes, part-number, or part-category grouping')
assert.match(source, /<option value="sankey">View: Sankey<\/option>/,
  'Failure Rate Prediction must expose the Sankey contribution view')
assert.match(source, /aria-label="Sankey failure-rate percentage cutoff"/,
  'the Sankey view must expose a user-selectable failure-rate percentage cutoff')
assert.match(partsTableSource, /p\.reference_designators\?\.length[\s\S]*p\.part_number \|\| '—'/,
  'part rows must render RefDes and Part Number in separate cells')
assert.match(source, /aria-sort=\{direction \?\? 'none'\}/,
  'sortable Parts List headers must expose their active direction')
assert.match(source, /current\.direction === 'ascending' \? 'descending' : 'ascending'/,
  'clicking an active header must toggle its sort direction')
assert.match(source, /if \(leftValue == null\) return 1[\s\S]*if \(rightValue == null\) return -1/,
  'missing values must remain at the end of either sort direction')
assert.match(source, /if \(child\.kind === 'block'\)[\s\S]*walk\(child\.block\.id, depth \+ 1\)/,
  'sorting must move each System Block with its preserved child hierarchy')
assert.doesNotMatch(source, />Imported BOM mapping</,
  'the standalone BOM mapping scorecard must remain hidden')
assert.match(source, />Mapping evidence and rule identity</,
  'mapping evidence must remain available in collapsed provenance details')
assert.match(source, />Imported mapping needs confirmation</,
  'unresolved imported mappings must retain a compact actionable control')

console.log('Prediction workspace layout contracts passed')
