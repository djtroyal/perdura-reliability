/** Real App navigation, persisted display preferences, and distribution labels. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const argument = process.argv.indexOf('--output-dir')
const output = resolve(argument < 0 ? join(tmpdir(), 'perdura-display-preferences') : process.argv[argument + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-display-preferences-vite-'))
const appRoute = '/__display_preferences_app.tsx'
const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
const installed = new Map(demo.modules.systemDefinition.model.instances.map(item => [item.id, item]))
const installedLevel = id => installed.get(id)?.parent_instance_id
  ? 1 + installedLevel(installed.get(id).parent_instance_id) : 1
const processorLabel = `Select Microprocessor, level ${installedLevel('demo-part-1')}`
const lifeFolio = {
  ...demo.modules.lifeData.folios[0],
  rows: demo.modules.lifeData.folios[0].rows.slice(0, 4),
  selectedDists: ['Weibull_2P', 'Normal_2P'],
  result: null, setDist: null, adoptedDistribution: null,
}
const otherFolio = { ...lifeFolio, id: 'other-dataset', name: 'Independent pressure dataset', quantity: { kind: 'pressure', unit: 'MPa' } }
const fixture = {
  projectName: 'Display preferences regression', identity: { projectId: 'display-preferences-project' },
  units: 'hours', analysisRuns: [], exportLedger: [], lastSavedAt: '2026-10-13T00:00:00.000Z',
  modules: {
    systemDefinition: { ...demo.modules.systemDefinition, view: 'structure', structureCollapsedIds: [] },
    lifeData: { ...demo.modules.lifeData, folios: [lifeFolio, otherFolio], activeId: lifeFolio.id, folioSeq: 2 },
  },
}

const vite = await createServer({
  root, cacheDir, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{
    name: 'display-preferences-assurance',
    resolveId(id) { if (id === appRoute) return id },
    load(id) {
      if (id === appRoute) return `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import '/src/index.css'
        import App from '/src/App.tsx'
        import { KeyboardShortcutProvider } from '/src/components/shared/KeyboardShortcuts'
        createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><App /></KeyboardShortcutProvider>)
      `
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0]
        if (!['/__display_preferences', '/__display_preferences_seed'].includes(path)) return next()
        const script = path === '/__display_preferences' ? `<script type="module" src="${appRoute}"></script>` : ''
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml(path, `<!doctype html><html lang="en"><head><title>Display preferences assurance</title></head><body><div id="root"></div>${script}</body></html>`))
      })
    },
  }],
})

let browser
let page
const errors = []
const checks = []
const fitRequests = []

async function projectSnapshot() {
  return page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    const state = project.getProjectState()
    return {
      modules: state.modules, analysisRuns: state.analysisRuns,
      dirty: project.isDirty(), history: project.getUndoRedoHistory(),
    }
  })
}

async function openSystem() {
  await page.getByRole('tab', { name: 'System Modeling', exact: true }).click()
  await page.getByRole('tab', { name: 'System Definition', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Show piece parts', exact: true })).toBeVisible({ timeout: 90000 })
}

try {
  await vite.listen()
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    if (new URL(route.request().url()).pathname.endsWith('/life-data/fit/stream')) {
      fitRequests.push(route.request().postDataJSON())
      // Only the outgoing contract is under test; do not invent numerical fits.
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson',
        body: JSON.stringify({ type: 'error', error: { message: 'Display-label test captured the fit request.' } }) + '\n' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('https://api.github.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }))
  await page.goto(`${origin}/__display_preferences_seed`)
  await page.evaluate(async source => {
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    const persistence = new ProjectPersistence()
    await persistence.save('session', source)
    await persistence.markMigrationComplete()
  }, fixture)
  await page.goto(`${origin}/__display_preferences`)
  await expect(page.getByRole('tab', { name: 'System Modeling', exact: true })).toBeVisible({ timeout: 90000 })
  await openSystem()
  const showParts = page.getByRole('checkbox', { name: 'Show piece parts', exact: true })
  await expect(showParts).not.toBeChecked()
  await expect(page.getByRole('button', { name: processorLabel, exact: true })).toHaveCount(0)
  const before = await projectSnapshot()
  assert.equal(before.dirty, false)
  await showParts.focus()
  await page.keyboard.press('Space')
  await expect(showParts).toBeChecked()
  await expect(page.getByRole('button', { name: processorLabel, exact: true })).toBeVisible()
  assert.deepEqual(await projectSnapshot(), before, 'Display preferences must not alter project data, dirty state, analytical runs, or undo history')
  await page.getByRole('tab', { name: 'Dashboard', exact: true }).click()
  await expect(showParts).toHaveCount(0)
  await openSystem()
  await expect(showParts).toBeChecked()
  await expect(page.getByRole('button', { name: processorLabel, exact: true })).toBeVisible()
  assert.deepEqual(await projectSnapshot(), before)
  await page.reload()
  await expect(page.getByRole('tab', { name: 'System Modeling', exact: true })).toBeVisible({ timeout: 90000 })
  await openSystem()
  await expect(showParts).toBeChecked()
  assert.deepEqual(await projectSnapshot(), before)
  checks.push('Piece-part visibility survives top-level navigation and reload without changing project data, dirty state, analyses, or undo history')

  await page.getByRole('tab', { name: 'RBD', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'RBD', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Dashboard', exact: true }).click()
  await page.getByRole('button', { name: 'System Definition', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'System Definition', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(showParts).toBeChecked()
  checks.push('Dashboard System Definition action opens its intended subtab even when System Modeling last showed RBD')

  await page.getByRole('tab', { name: 'Life Data Analysis', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dataset units: hours', exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.getByRole('combobox', { name: /density/i })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Dataset unit', exact: true })).toHaveCount(0)
  const projectUnits = page.getByRole('combobox', { name: 'Project units', exact: true })
  await expect(projectUnits).toHaveValue('hours')
  assert.deepEqual(await projectUnits.locator('option').allTextContents(),
    ['hours', 'days', 'weeks', 'months', 'years', 'cycles', 'km', 'miles'])
  await projectUnits.selectOption('days')
  await expect(page.getByRole('heading', { name: 'Convert existing values from hours to days?', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(projectUnits).toHaveValue('hours')

  const datasetBefore = await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    return project.getProjectState().modules.lifeData
  })
  await page.locator('[data-lda-dataset-toolbar]').getByRole('button', { name: 'Dataset units: hours', exact: true }).click()
  const datasetUnitsDialog = page.getByRole('dialog', { name: 'Dataset units', exact: true })
  await expect(datasetUnitsDialog).toContainText('Using the project default.')
  await expect(datasetUnitsDialog).toContainText('changing this does not rescale observations')
  await expect(datasetUnitsDialog).toContainText('Refit after correcting units.')
  await page.getByRole('combobox', { name: 'Dataset unit', exact: true }).selectOption('days')
  await expect(datasetUnitsDialog).toContainText('Assigned to this dataset.')
  await expect(page.getByRole('button', { name: 'Dataset units: days', exact: true })).toBeVisible()
  const unitsAxe = await new AxeBuilder({ page }).include('[role="dialog"][aria-label="Dataset units"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(unitsAxe.violations, [])
  await page.screenshot({ path: join(output, 'dataset-units.png') })
  await page.getByRole('tab', { name: 'Life Data Analysis', exact: true }).click()
  await expect(datasetUnitsDialog).toHaveCount(0)
  const datasetAfter = await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    const state = project.getProjectState()
    return { units: state.units, lifeData: state.modules.lifeData }
  })
  assert.equal(datasetAfter.units, 'hours')
  assert.deepEqual(datasetAfter.lifeData.folios[0].quantity, { kind: 'time', unit: 'days' })
  assert.deepEqual(datasetAfter.lifeData.folios[0].rows, datasetBefore.folios[0].rows)
  assert.deepEqual(datasetAfter.lifeData.folios[1], datasetBefore.folios[1])
  await projectUnits.selectOption('weeks')
  await page.getByRole('button', { name: 'Convert values', exact: true }).click()
  await expect(projectUnits).toHaveValue('weeks')
  const converted = await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    return project.getProjectState().modules.lifeData
  })
  assert.deepEqual(converted.folios[0].quantity, { kind: 'time', unit: 'days' })
  assert.deepEqual(converted.folios[0].rows, datasetBefore.folios[0].rows)
  assert.deepEqual(converted.folios[1], datasetBefore.folios[1])
  checks.push('Project units display a simple native unit selector; dataset units retain their dismissible editor, conversion confirmation, and independent values')

  await expect(page.getByRole('button', { name: /^Add (grouped )?row$/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Life Data editor', exact: true }).click()
  const expanded = page.locator('[data-life-data-workspace]')
  await expect(expanded).toBeVisible()
  await expect(expanded.getByRole('region', { name: 'Life Data editor', exact: true })).toBeVisible()
  await expect(expanded.locator('.js-plotly-plot')).toHaveCount(0)
  const firstTime = expanded.locator('tbody tr').first().locator('input[inputmode="decimal"]')
  await firstTime.fill('19.830')
  await page.screenshot({ path: join(output, 'expanded-life-data-editor.png') })
  await page.getByRole('button', { name: 'Collapse Life Data editor', exact: true }).click()
  await expect(expanded).toHaveCount(0)
  const editor = page.getByRole('region', { name: 'Life Data editor', exact: true })
  await expect(editor.locator('tbody tr').first().locator('input[inputmode="decimal"]')).toHaveValue('19.830')
  const rowCount = await editor.locator('tbody tr').count()
  await editor.locator('tbody tr').last().locator('input[inputmode="decimal"]').fill('99')
  await expect(editor.locator('tbody tr')).toHaveCount(rowCount + 1)
  await expect(editor.locator('tbody tr').last().locator('input[inputmode="decimal"]')).toHaveValue('')
  await expect.poll(() => page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    return project.getProjectState().modules.lifeData.folios[0].rows.some(row => row.time === '99')
  })).toBe(true)
  checks.push('Life Data expands into its own editing workspace, edits survive collapse, and entering the last row creates another blank entry without Add row buttons')

  const distributions = page.getByRole('group', { name: 'Distributions to fit', exact: true })
  await expect(distributions).toBeVisible({ timeout: 90000 })
  assert.ok(!(await distributions.innerText()).includes('_'), 'Distribution labels must not expose raw identifiers')
  await expect(distributions.getByRole('checkbox', { name: 'Weibull (2-parameter)', exact: true })).toBeChecked()
  await expect(distributions.getByRole('checkbox', { name: 'Normal (2-parameter)', exact: true })).toBeChecked()
  await expect(distributions.getByRole('checkbox', { name: 'Exponential (1-parameter)', exact: true })).toBeVisible()
  const normal = distributions.getByRole('checkbox', { name: 'Normal (2-parameter)', exact: true })
  await normal.focus()
  await page.keyboard.press('Space')
  await expect(normal).not.toBeChecked()
  assert.deepEqual(await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    return project.getProjectState().modules.lifeData.folios[0].selectedDists
  }), ['Weibull_2P'], 'Friendly labels must preserve raw identifiers in the project')
  const axe = await new AxeBuilder({ page }).include('[aria-label="Distributions to fit"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(axe.violations, [], 'The distribution picker must pass scoped accessibility checks')
  const bounds = await distributions.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    overflow: element.scrollWidth > element.clientWidth,
  }))
  assert.ok(bounds.width <= 340, 'Exercise the actual narrow LDA sidebar')
  assert.equal(bounds.overflow, false, 'Friendly labels must fit the LDA sidebar without horizontal overflow')
  await distributions.screenshot({ path: join(output, 'distribution-picker.png') })
  await page.screenshot({ path: join(output, 'life-data-display.png') })
  await page.getByRole('button', { name: 'Run Analysis', exact: true }).click()
  await expect.poll(() => fitRequests.length).toBe(1)
  assert.deepEqual(fitRequests[0].distributions_to_fit, ['Weibull_2P'])
  assert.equal(fitRequests[0].method, 'MLE')
  await expect(page.getByRole('button', { name: 'Run Analysis', exact: true })).toBeEnabled()
  checks.push('LDA distribution picker uses friendly accessible names, supports keyboard selection, fits the sidebar, and retains API identifiers')

  assert.deepEqual(errors, [])
  await writeFile(join(output, 'browser.json'), JSON.stringify({ status: 'passed', checks }, null, 2) + '\n')
  console.log('PASS display preferences: tab navigation, reload, clean project state, friendly distribution labels, keyboard access, and fit payload')
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, checks }, null, 2) + '\n')
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
