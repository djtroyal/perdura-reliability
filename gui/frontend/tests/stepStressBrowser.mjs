import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Mount the production component and exercise its real HTTP payload. Responses
// come from the actual Python core. ASGI validation has separate Python tests.
const root = fileURLToPath(new URL('..', import.meta.url))
const repo = resolve(root, '../..')
const outputIndex = process.argv.indexOf('--output-dir')
const outputDir = resolve(outputIndex < 0 ? join(tmpdir(), 'perdura-step-stress-browser') : process.argv[outputIndex + 1])
await mkdir(outputDir, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-step-stress-vite-'))
const entry = '/__step-stress-browser.tsx'
const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import '/src/index.css'
import { StepStress } from '/src/components/ALT/ALTTestTypes'
import { getProjectState, setModuleState } from '/src/store/project'
window.stepStressHarness = {
  state: () => getProjectState().modules.reliabilityTestingTools?.stepStress,
  legacy: () => {
    const slice = getProjectState().modules.reliabilityTestingTools
    const prior = slice.stepStress
    const { schema, analysis_metadata, ...result } = prior.result
    setModuleState('reliabilityTestingTools', { ...slice, stepStress: { ...prior, result, resultInputSignature: null } })
  },
}
createRoot(document.getElementById('root')).render(<div className="perdura-theme h-screen flex flex-col"><h1>Step-stress browser assurance</h1><StepStress/></div>)
`
const vite = await createServer({
  root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { entries: ['index.html', 'src/components/ALT/ALTTestTypes.tsx'] },
  plugins: [{
    name: 'step-stress-browser-fixture',
    resolveId(id) { if (id === entry) return id },
    load(id) { if (id === entry) return fixture },
    configureServer(server) {
      server.middlewares.use('/__step-stress-browser', async (req, res, next) => {
        if (req.url !== '/' && req.url !== '') return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/__step-stress-browser', `<!doctype html><html lang="en"><head><title>Step-stress assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
      })
    },
  }],
})
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
const calculate = input => JSON.parse(execFileSync(python, ['-c', `
import json,sys
from reliability.Step_stress import fit_step_stress
p=json.load(sys.stdin)
print(json.dumps(fit_step_stress(p['steps'],p['observations'],mode=p['fit_mode'],fixed_exponent=p.get('fixed_exponent'),use_level_stress=p.get('use_level_stress'),CI=p['confidence']),allow_nan=False))
`], { cwd: repo, input: JSON.stringify(input), encoding: 'utf8', timeout: 30000,
  env: { ...process.env, MPLCONFIGDIR: join(tmpdir(), 'perdura-step-stress-mpl') }, maxBuffer: 2_000_000 }))
let browser, release
try {
  await vite.listen()
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  let hold = false
  await page.route('**/api/v1/alt/step-stress/v2', async route => {
    const input = route.request().postDataJSON()
    requests.push(input)
    const result = calculate(input)
    if (hold) await new Promise(resolve => { release = resolve })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
  })
  await page.goto(`${base}/__step-stress-browser`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'Load example data' }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Load example data' }).click()
  await expect(page.getByLabel('Observation 11 clock time', { exact: true })).toHaveValue('385')
  await page.getByRole('button', { name: 'Add row', exact: true }).click()
  await page.getByLabel('Observation 12 clock time', { exact: true }).fill('400')
  await page.getByLabel('Observation 12 status', { exact: true }).selectOption('right_censored')
  await page.getByRole('button', { name: 'Fit model', exact: true }).click()
  await expect(page.getByText('11 failures; 1 right censored.', { exact: false })).toBeVisible({ timeout: 30000 })
  assert.equal(requests[0].schema_version, 2)
  assert.equal(requests[0].observations.filter(row => row.status === 'right_censored').length, 1)
  assert.equal(requests[0].fit_mode, 'joint')
  await expect(page.getByRole('table', { name: '95% profile-likelihood confidence intervals' })).toBeVisible()
  await expect(page.getByText('These results belong to earlier inputs.', { exact: false })).toHaveCount(0)
  const first = await page.evaluate(() => window.stepStressHarness.state().result)
  assert.equal(first.schema, 'perdura.step-stress/v2')
  assert.equal(first.analysis_metadata.engine_revision, 2)
  const firstTime = page.getByLabel('Observation 1 clock time', { exact: true })
  const assertFocusedRowUnobscured = async () => {
    await expect(firstTime).toBeFocused()
    const geometry = await firstTime.evaluate(input => {
      const field = input.getBoundingClientRect()
      const table = input.closest('table')
      const header = table.querySelector('thead').getBoundingClientRect()
      const viewport = table.parentElement.getBoundingClientRect()
      return { fieldTop: field.top, fieldBottom: field.bottom, headerBottom: header.bottom,
        viewportTop: viewport.top, viewportBottom: viewport.bottom }
    })
    assert.ok(geometry.fieldTop >= geometry.viewportTop - 1, 'Focused field is inside the scrolled observation viewport')
    assert.ok(geometry.fieldBottom <= geometry.viewportBottom + 1, 'Focused field is fully visible')
    assert.ok(geometry.headerBottom <= geometry.fieldTop + 1, 'Column headings do not paint over the focused field')
  }
  await page.getByLabel('Observation 12 clock time', { exact: true }).click()
  await firstTime.click()
  await assertFocusedRowUnobscured()
  await expect.poll(() => page.locator('.js-plotly-plot').evaluateAll(plots =>
    plots.filter(plot => plot._fullLayout && plot.data?.length).length)).toBe(2)
  await page.screenshot({ path: join(outputDir, 'step-stress-joint.png'), fullPage: true })
  await page.getByLabel('Acceleration exponent mode').selectOption('fixed_exponent')
  await page.getByLabel('Fixed exponent p', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Fit model', exact: true }).click()
  await expect(page.getByText('Exponent fixed from external evidence.', { exact: false })).toBeVisible({ timeout: 30000 })
  assert.equal(requests[1].fixed_exponent, 2)
  const fixed = await page.evaluate(() => window.stepStressHarness.state().result)
  assert.equal(fixed.exponent_p, 2)
  hold = true
  await page.getByRole('button', { name: 'Fit model', exact: true }).click()
  await expect.poll(() => Boolean(release)).toBe(true)
  await page.getByLabel('Observation 1 clock time', { exact: true }).fill('281')
  await assertFocusedRowUnobscured()
  release()
  await expect(page.getByRole('button', { name: 'Fit model', exact: true })).toBeEnabled()
  assert.deepEqual(await page.evaluate(() => window.stepStressHarness.state().result), fixed)
  await expect(page.getByText('These results belong to earlier inputs.', { exact: false })).toBeVisible()
  await page.evaluate(() => window.stepStressHarness.legacy())
  await expect(page.getByText('Historical heuristic result.', { exact: false })).toBeVisible()
  console.log('Step-stress functional browser checks passed; checking accessibility')
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const blocking = axe.violations.filter(item => ['serious', 'critical'].includes(item.impact))
  await page.screenshot({ path: join(outputDir, 'step-stress.png'), fullPage: true })
  const report = { schema: 'perdura.step-stress-browser/v1', status: errors.length || blocking.length ? 'failed' : 'passed',
    requests: requests.length, checks: ['censored_submission', 'joint_fit_metadata', 'validated_profile_display', 'focused_row_not_obscured', 'fixed_exponent', 'stale_response_rejected', 'historical_result_labeled'],
    errors, blockingViolations: blocking.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })),
    interpretation: 'Production React component with actual Python-core results through intercepted HTTP; API validation is independently tested in Python. Coverage calibration is not asserted.' }
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [])
  assert.deepEqual(blocking.map(item => item.id), [])
  console.log(`Step-stress browser assurance passed: ${outputDir}`)
} finally {
  release?.()
  await browser?.close()
  await vite.close()
  await rm(cacheDir, { recursive: true, force: true })
}
