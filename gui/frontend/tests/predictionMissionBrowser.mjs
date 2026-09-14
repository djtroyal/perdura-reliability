import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

// Run against a Vite dev/preview server. API responses are deterministic so this
// exercises completed-result invalidation independently of numerical models.
const index = process.argv.indexOf('--base-url')
const baseUrl = index >= 0 ? process.argv[index + 1] : 'http://127.0.0.1:4173'
const browser = await chromium.launch({ headless: true })
let page
try {
  page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.addInitScript(() => localStorage.setItem('perdura-assurance-export-enabled', 'false'))
  await page.route('**/api/**', route => route.abort())
  await page.route('**/api/v1/version?*', route => {
    const headers = route.request().headers()
    const contract = Number(headers['x-perdura-client-api-contract'])
    return route.fulfill({ json: {
      version: headers['x-perdura-client-version'], commit: 'dev', api_contract: contract,
      minimum_client_api_contract: contract, maximum_client_api_contract: contract,
    } })
  })
  const phases = [{ name: 'Operation', duration: 100, environment: 'GB', temperature: 40, operating_fraction: 1 }]
  await page.route('**/api/v1/prediction/mission-profiles', route => route.fulfill({ json: {
    regression: { name: 'Regression Mission', phases, total_duration: 100, n_phases: 1 },
  } }))
  let responseCount = 0
  const requests = []
  await page.route('**/api/v1/prediction/mission-profile', route => {
    requests.push(route.request().postDataJSON())
    responseCount += 1
    return route.fulfill({ json: {
      profile_name: `Completed mission ${responseCount}`, standard: 'MIL-HDBK-217F',
      total_duration: 100, system_failure_rate: 0.1, system_mtbf: 1e7,
      mission_reliability: 0.99999, mission_unreliability: 0.00001,
      phases, part_results: [], warnings: [],
    } })
  })
  await page.goto(`${baseUrl}/?perduraShowcase=1&perduraSeedShowcase=1&module=prediction`)
  await page.locator('[data-perdura-showcase="ready"]').waitFor({ timeout: 60000 })
  const fixture = JSON.parse(await readFile(new URL('../public/website-showcase/prediction.overview.json', import.meta.url), 'utf8'))
  fixture.schemaVersion = 7
  const prediction = fixture.modules.prediction
  const state = prediction._folioWrap
    ? prediction.folios.find(folio => folio.id === prediction.activeId).state : prediction
  Object.assign(state, {
    parts: [{ id: 'mission-part', reference_designators: ['R_MISSION'], category: 'resistor', quantity: 1, params: {} }],
    blocks: [], blockSeq: 0, standard: 'MIL-HDBK-217F', environment: 'GB', vitaGlobal: false,
    result: null, deratingResult: null, deratingEnabled: false,
  })
  await page.route('**/website-showcase/mission-regression.json', route => route.fulfill({ json: fixture }))
  assert.equal(await page.evaluate(() => window.__PERDURA_LOAD_SHOWCASE__('mission-regression')), true)
  await page.getByRole('button', { name: /^Mission Profile/ }).click()
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Regression Mission' }) })
    .selectOption('regression')
  const completed = page.getByText(/^Mission: Completed mission \d+$/)
  const run = async () => {
    await page.getByRole('button', { name: 'Run Mission Profile', exact: true }).click()
    await expect(completed).toBeVisible()
  }
  const scenarios = [
    { name: 'part quantity', change: async () => {
      await page.getByRole('tab', { name: /^Parts List/ }).click()
      await page.locator('#prediction-part-row-0 input[type="number"]').fill('3')
      await page.getByRole('tab', { name: 'Analysis', exact: true }).click()
    } },
    { name: 'global environment', change: () => page.locator('label').filter({ hasText: /^Environment$/ }).locator('..').locator('select').selectOption('GF') },
    { name: 'VITA supplement', change: () => page.getByRole('checkbox', { name: /ANSI\/VITA 51\.1 supplement/ }).check() },
  ]
  for (const scenario of scenarios) {
    await run()
    await scenario.change()
    await expect(completed, `${scenario.name} must clear the completed mission result`).toHaveCount(0)
    console.log(`PASS mission result invalidation: ${scenario.name}`)
  }
  await run()
  assert.equal(requests.at(-1).parts[0].quantity, 3, 'a rerun uses the edited part quantity')
  assert.equal(requests.at(-1).vita_global, true, 'a rerun uses the edited VITA setting')
  // Presentation changes do not alter mission inputs or discard a valid result.
  await page.getByRole('button', { name: /^Mission Profile/ }).click()
  await page.getByRole('button', { name: /^Mission Profile/ }).click()
  await expect(completed).toBeVisible()
  assert.deepEqual(errors, [], 'the mission regression journey must not raise browser exceptions')
  console.log('Prediction mission browser regression passed: quantity, environment, VITA, rerun, presentation toggle')
} catch (error) {
  if (page) console.error('Visible page at failure:', (await page.locator('body').innerText()).slice(0, 6000))
  throw error
} finally {
  await browser.close()
}
