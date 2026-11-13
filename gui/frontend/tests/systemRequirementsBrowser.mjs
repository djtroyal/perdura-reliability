/** Canonical requirements authoring, evidence review, presentation immunity, and round-trip export. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const arg = process.argv.indexOf('--output-dir')
const output = resolve(arg < 0 ? join(tmpdir(), 'perdura-system-requirements') : process.argv[arg + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-system-requirements-vite-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
let browser, page
const errors = [], checks = []
let failure
const startedAt = Date.now()
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const workspace = () => page.getByRole('region', { name: 'Requirements and verification', exact: true })
const evaluation = () => page.evaluate(async () => {
  const store = await import('/src/store/project.ts')
  const helper = await import('/src/store/systemRequirements.ts')
  const sources = await import('/src/store/systemVerificationState.ts')
  const model = store.getProjectState().modules.systemDefinition.model
  return helper.evaluateSystemRequirements(model, sources.verificationSourcesForProject(store.getProjectState()))
})
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage()
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(90000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    status: 200, contentType: 'application/json', body: new URL(route.request().url()).pathname.endsWith('/version')
      ? JSON.stringify({ api_contract: 1, minimum_client_api_contract: 1, maximum_client_api_contract: 1 })
      : /\/fmea\/(method|rating)-profiles$/.test(new URL(route.request().url()).pathname) ? '[]' : '{}' }))
  await page.route('https://api.github.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/`)
  await page.getByRole('button', { name: 'Open a saved project', exact: true }).waitFor({ timeout: 90000 })
  const exampleName = await page.evaluate(async () => (await import('/src/store/project.ts')).DEMO_PROJECT_NAME)
  await page.getByRole('button', { name: 'Open a saved project', exact: true }).click()
  await page.getByText(exampleName, { exact: true }).click()
  const discard = page.getByRole('button', { name: 'Discard & continue', exact: true })
  if (await discard.isVisible()) await discard.click()
  await page.getByRole('tab', { name: 'System Modeling', exact: true }).click()
  await page.getByRole('tab', { name: 'System Definition', exact: true }).click()
  await page.getByRole('button', { name: 'Requirements & Verification', exact: true }).click()
  await workspace().getByRole('button', { name: 'New', exact: true }).click()
  await expect(workspace().getByRole('button', { name: 'Delete draft', exact: true })).toBeEnabled()
  await workspace().getByRole('button', { name: 'Delete draft', exact: true }).click()
  await workspace().getByRole('button', { name: 'New', exact: true }).click()
  await workspace().getByRole('textbox', { name: 'Requirement statement', exact: true }).fill('The command path shall reach the installed controller.')
  await workspace().getByRole('textbox', { name: 'Requirement acceptance criteria', exact: true }).fill('Trace one uninterrupted command path to the installed controller.')
  await workspace().getByRole('combobox', { name: 'Requirement lifecycle' }).selectOption('active')
  await workspace().getByRole('combobox', { name: 'Allocate to system block' }).selectOption('aircraft')
  await workspace().getByRole('button', { name: 'Allocate', exact: true }).first().click()
  await workspace().getByRole('textbox', { name: 'Search requirements' }).fill('command path shall reach')
  await expect(workspace().getByRole('list', { name: 'System requirements' }).getByRole('listitem')).toHaveCount(1)
  await workspace().getByRole('textbox', { name: 'Search requirements' }).fill('')
  await workspace().getByRole('combobox', { name: 'Requirement scope', exact: true }).selectOption('selected')
  await workspace().getByRole('combobox', { name: 'Requirement scope block' }).selectOption('motor-left')
  await expect(workspace().getByRole('list', { name: 'System requirements' }).getByText('The command path shall reach the installed controller.', { exact: true })).toHaveCount(0)
  await workspace().getByRole('combobox', { name: 'Requirement scope block' }).selectOption('aircraft')
  await expect(workspace().getByRole('textbox', { name: 'Requirement statement', exact: true })).toHaveValue('The command path shall reach the installed controller.')
  await workspace().getByRole('combobox', { name: 'Requirement scope', exact: true }).selectOption('all')
  checks.push('Requirement search and selected installed-branch filtering preserve the whole-project record')
  await workspace().getByRole('button', { name: 'Add verification case', exact: true }).click()
  const caseEditor = workspace().getByRole('group', { name: /^Verification case VER-/ })
  await caseEditor.getByRole('button', { name: 'Delete case', exact: true }).click()
  await expect(caseEditor).toHaveCount(0)
  await workspace().getByRole('button', { name: 'Add verification case', exact: true }).click()
  await caseEditor.getByRole('textbox', { name: 'Verification objective', exact: true }).fill('Inspect the command path')
  await caseEditor.getByRole('combobox', { name: 'Verification method', exact: true }).selectOption('inspection')
  await caseEditor.getByRole('combobox', { name: 'Assessment outcome', exact: true }).selectOption('pass')
  await caseEditor.getByRole('textbox', { name: 'Reviewing engineer', exact: true }).fill('Review Engineer')
  await caseEditor.getByRole('textbox', { name: 'Evidence assessment', exact: true }).fill('The reviewed drawing traces the command path to its controller.')
  await caseEditor.getByRole('button', { name: 'Record review', exact: true }).click()
  let result = await evaluation()
  const createdCaseId = await page.evaluate(async () => (await import('/src/store/project.ts')).getProjectState().modules.systemDefinition.model.verification_cases.find(item => item.objective === 'Inspect the command path').id)
  const newCase = result.cases.find(item => item.id === createdCaseId)
  assert.ok(newCase.issues.some(issue => issue.code === 'missing_evidence'), 'Incomplete case cannot be passed by choosing Pass and clicking review')
  await caseEditor.getByRole('button', { name: 'Add evidence', exact: true }).click()
  await caseEditor.getByRole('textbox', { name: 'Evidence claim', exact: true }).fill('Drawing trace confirms the command path.')
  await caseEditor.getByRole('textbox', { name: 'Evidence location', exact: true }).fill('drawing://command-path/001')
  await caseEditor.getByRole('textbox', { name: 'Evidence revision', exact: true }).fill('C')
  await caseEditor.getByRole('textbox', { name: 'Evidence checksum', exact: true }).fill('a'.repeat(64))
  result = await evaluation()
  const readyCase = result.cases.find(item => item.id === newCase.id)
  assert.equal(readyCase.status, 'unreviewed', 'Evidence attachment alone does not verify')
  await caseEditor.getByRole('button', { name: 'Record review', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await evaluation()).cases.find(item => item.id === newCase.id)?.status).toBe('passed')
  await expect(caseEditor.getByRole('button', { name: 'Delete case', exact: true })).toHaveCount(0)
  const record = await page.evaluate(async () => {
    const model = (await import('/src/store/project.ts')).getProjectState().modules.systemDefinition.model
    return model.verification_cases.find(item => item.objective === 'Inspect the command path')
  })
  const requirementId = record.requirement_ids[0]
  checks.push('Draft authoring, stable allocation, incomplete-review gate, explicit evidence assessment, and keyboard review')
  await caseEditor.getByRole('button', { name: 'Detach evidence', exact: true }).click()
  await expect.poll(async () => (await evaluation()).cases.find(item => item.id === record.id)?.status).toBe('stale')
  await caseEditor.getByRole('combobox', { name: 'Evidence source', exact: true }).selectOption(`evidence:${record.evidence_link_ids[0]}`)
  await caseEditor.getByRole('button', { name: 'Add evidence', exact: true }).click()
  await expect.poll(async () => (await evaluation()).cases.find(item => item.id === record.id)?.status).toBe('passed')
  checks.push('Evidence can be detached and reused by stable identity without duplicating source records')

  const a11y = await new AxeBuilder({ page }).include('[aria-label="Requirements and verification"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  assert.deepEqual(a11y.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [])
  await page.screenshot({ path: join(output, 'requirements-verification.png') })
  await workspace().getByRole('textbox', { name: 'Requirement statement', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'requirements-overview.png') })
  checks.push('Requirements workspace passes WCAG 2.2 AA axe checks')

  await page.evaluate(async () => {
    const shared = await import('/src/store/sharedSystem.ts')
    const state = shared.currentProjectSystem()
    shared.commitProjectSystem({ ...state, model: { ...state.model, diagrams: state.model.diagrams.map(diagram => ({ ...diagram,
      nodes: diagram.nodes.map(node => ({ ...node, x: node.x + 123 })) })) } }, 'test-layout-only')
  })
  assert.equal((await evaluation()).cases.find(item => item.id === record.id).status, 'passed')
  await workspace().getByRole('textbox', { name: 'Requirement acceptance criteria', exact: true }).fill('Trace and inspect both redundant command paths.')
  assert.equal((await evaluation()).cases.find(item => item.id === record.id).status, 'stale')
  checks.push('Diagram motion preserves verification; changed acceptance criteria invalidate the affected review')

  const roundTrip = await page.evaluate(async ({ requirementId, caseId }) => {
    const store = await import('/src/store/project.ts')
    const assets = (await import('/src/store/assetExtractors.ts')).enumerateAssets().filter(item => item.module === 'systemDefinition')
    const payload = JSON.parse(JSON.stringify(store.buildExport(undefined, true)))
    store.importPayload(payload)
    const model = store.getProjectState().modules.systemDefinition.model
    return { requirement: model.requirements.find(item => item.id === requirementId), review: model.verification_cases.find(item => item.id === caseId),
      assets: assets.map(item => ({ label: item.label, source: item.source, data: item.getData() })) }
  }, { requirementId, caseId: record.id })
  assert.equal(roundTrip.requirement.id, requirementId)
  assert.equal(roundTrip.review.reviewed_by, 'Review Engineer')
  assert.equal(roundTrip.review.reviewed_fingerprint, record.reviewed_fingerprint)
  assert.ok(roundTrip.assets.some(asset => asset.label === 'Requirements Traceability' && asset.data.tableRows.some(row => row[0] === requirementId && row.at(-1) === 'stale')))
  assert.ok(roundTrip.assets.every(asset => asset.source.view === 'requirements'))
  assert.ok(roundTrip.assets.every(asset => asset.source.tab === 'system-modeling' && asset.source.sub === 'definition'))
  await page.getByRole('button', { name: 'Structure', exact: true }).click()
  await page.evaluate(async () => {
    const asset = (await import('/src/store/assetExtractors.ts')).enumerateAssets().find(item => item.module === 'systemDefinition')
    ;(await import('/src/store/bookmarks.ts')).requestBookmarkNavigation(asset.source, asset.label)
  })
  await expect(workspace()).toBeVisible()
  checks.push('Full project export/import preserves IDs, review history, and traceability report assets with current stale status')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'browser.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  failure = error
  await writeFile(join(output, 'browser.json'), JSON.stringify({ status: 'failed', checks, errors, failure: String(error.stack ?? error) }, null, 2))
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error('Browser errors:', errors); throw error
} finally {
  const cases = checks.map(check => `<testcase classname="system-requirements-browser" name="${xml(check)}"/>`)
  if (failure) cases.push(`<testcase classname="system-requirements-browser" name="Complete requirements workflow"><failure message="${xml(failure.message ?? failure)}">${xml(failure.stack ?? failure)}</failure></testcase>`)
  await writeFile(join(output, 'junit-system-requirements.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="system-requirements-browser" tests="${cases.length}" failures="${failure ? 1 : 0}" errors="0" skipped="0" time="${((Date.now() - startedAt) / 1000).toFixed(3)}">${cases.join('')}</testsuite>\n`)
  await browser?.close(); await closeViteTestServer(vite, cacheDir)
}
