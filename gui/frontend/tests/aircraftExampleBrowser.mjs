/** Load the real bundled example through the App menu, then browse L1–L4. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const argument = process.argv.indexOf('--output-dir')
const output = resolve(argument < 0 ? join(tmpdir(), 'perdura-aircraft-example') : process.argv[argument + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-aircraft-example-vite-'))
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
let browser, page
const errors = [], checks = []
const node = id => page.locator(`.react-flow__node[data-id="system-instance:${id}"]`)
const snapshot = () => page.evaluate(async () => {
  const { getProjectState } = await import('/src/store/project.ts')
  return getProjectState().modules.systemDefinition
})
const settledViewport = () => page.evaluate(async () => {
  let previous = '', stable = 0
  for (let frame = 0; frame < 120; frame++) {
    await new Promise(resolve => requestAnimationFrame(resolve))
    const current = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? ''
    stable = current === previous ? stable + 1 : 0
    previous = current
    if (frame >= 30 && stable >= 5) return
  }
  throw new Error('Aircraft diagram viewport did not settle')
})

try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1800, height: 1120 }, reducedMotion: 'reduce' })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(90000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    status: new URL(route.request().url()).pathname.endsWith('/fmea/readiness') ? 503 : 200,
    contentType: 'application/json',
    body: new URL(route.request().url()).pathname.endsWith('/version')
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
  await expect.poll(async () => {
    const system = await snapshot()
    return system?.model?.instances.find(item => item.id === system.model.root_instance_id)?.name
  }).toBe('Aircraft')
  const original = await snapshot()
  const model = original.model
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const ancestry = item => item.parent_instance_id ? [...ancestry(instances.get(item.parent_instance_id)), item] : [item]
  const assertNoOverlappingPeers = async blockInstances => {
    const rectangles = await page.locator('.react-flow__node').evaluateAll((elements, mapping) => elements.flatMap(element => {
      const instanceId = mapping[element.getAttribute('data-id')]
      if (!instanceId) return []
      const box = element.getBoundingClientRect()
      return [{ instanceId, x: box.x, y: box.y, width: box.width, height: box.height }]
    }), blockInstances)
    for (let left = 0; left < rectangles.length; left++) for (let right = left + 1; right < rectangles.length; right++) {
      const a = rectangles[left], b = rectangles[right]
      if (ancestry(instances.get(a.instanceId)).some(item => item.id === b.instanceId)
        || ancestry(instances.get(b.instanceId)).some(item => item.id === a.instanceId)) continue
      assert.ok(!(a.x + 2 < b.x + b.width && a.x + a.width > b.x + 2
        && a.y + 2 < b.y + b.height && a.y + a.height > b.y + 2),
      `${instances.get(a.instanceId).name} and ${instances.get(b.instanceId).name} must not overlap`)
    }
  }
  const path = model.instances.map(ancestry).find(items => items.length === 4
    && items.every(item => definitions.get(item.definition_id)?.kind !== 'piece_part'))
  assert.ok(path, 'Example contains a real L1–L4 system path')
  checks.push('Open → Examples loads the Aircraft project through the real import path')

  await page.getByRole('tab', { name: 'System Modeling', exact: true }).click()
  await page.getByRole('tab', { name: 'System Definition', exact: true }).click()
  await page.getByRole('button', { name: 'Structure', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Show piece parts', exact: true })).not.toBeChecked()
  for (const item of path.slice(0, -1)) {
    const row = page.locator(`[data-system-instance="${item.id}"]`)
    const expand = row.getByRole('button', { name: `Expand ${item.name}`, exact: true })
    if (await expand.count()) await expand.click()
  }
  const component = path.at(-1)
  await page.locator(`[data-system-instance="${component.id}"]`).getByRole('button', { name: `Select ${component.name}, level 4`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Installed name', exact: true })).toHaveValue(component.name)
  await page.screenshot({ path: join(output, 'aircraft-structure-l4.png') })
  checks.push(`Structure expands and inspects ${path.map(item => item.name).join(' → ')}`)

  await page.getByRole('button', { name: 'Interfaces', exact: true }).click()
  const installed = page.getByRole('group', { name: 'Installed hierarchy', exact: true })
  await expect(installed).toBeVisible()
  const l2 = model.instances.filter(item => item.parent_instance_id === model.root_instance_id)
  for (const system of l2) await expect(node(system.id)).toBeVisible()
  for (const item of model.instances.filter(item => ancestry(item).length > 2)) await expect(node(item.id)).toHaveCount(0)
  await expect(page.locator('.react-flow__edge').first()).toBeVisible()
  await page.getByTitle('Fit the complete diagram in view', { exact: true }).click()
  await settledViewport()
  await page.screenshot({ path: join(output, 'aircraft-interfaces-overview.png') })
  checks.push('Interfaces initially shows collapsed major systems with connected resources and hides deep internal detail')

  for (const item of path.slice(1, -1)) {
    await node(item.id).getByRole('button', { name: `Expand ${item.name}`, exact: true }).click()
    await expect(node(item.id)).toBeVisible()
  }
  await expect(node(component.id)).toBeVisible()
  await page.getByTitle('Fit the complete diagram in view', { exact: true }).click()
  await settledViewport()
  await page.screenshot({ path: join(output, 'aircraft-interfaces-l4.png') })
  await assertNoOverlappingPeers(Object.fromEntries(model.instances.map(item => [`system-instance:${item.id}`, item.id])))
  checks.push('Diagram expansion exposes L3 and L4 components inside their actual parent containers')
  const accessibility = await new AxeBuilder({ page }).include('[aria-label="Installed hierarchy"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  assert.deepEqual(accessibility.violations, [])
  const after = (await snapshot()).model
  for (const key of ['instances', 'definitions', 'resources', 'interfaces', 'externals', 'function_links'])
    assert.deepEqual(after[key], model[key], `Browsing must retain canonical ${key}`)
  await page.getByRole('tab', { name: 'FMEA', exact: true }).click()
  await page.getByRole('button', { name: /Structure analysis/, exact: false }).click()
  await page.getByRole('button', { name: 'Block diagram', exact: true }).click()
  await page.getByRole('combobox', { name: 'Item of focus', exact: true }).selectOption('b1')
  await page.getByTitle('Fit the complete diagram in view', { exact: true }).click()
  await settledViewport()
  await page.screenshot({ path: join(output, 'aircraft-fmea-controller-focus.png') })
  await page.getByRole('button', { name: 'Expand diagram to full screen', exact: true }).click()
  await page.getByRole('button', { name: 'Restore diagram', exact: true }).waitFor()
  await page.getByTitle('Fit the complete diagram in view', { exact: true }).click()
  await settledViewport()
  await page.screenshot({ path: join(output, 'aircraft-fmea-controller-fullscreen.png') })
  const fmeaBlocks = await page.evaluate(async () => {
    const state = (await import('/src/store/project.ts')).getProjectState().modules.fmea
    const study = state.folios.find(item => item.id === state.activeId).state.analyses.find(item => item.id === 'DFMEA-DEMO')
    const structures = new Map(study.structure_nodes.map(item => [item.id, item.system_definition_ref?.instance_id]))
    return Object.fromEntries(study.block_diagram.nodes.flatMap(item => structures.has(item.structure_node_id)
      ? [[item.id, structures.get(item.structure_node_id)]] : []))
  })
  await assertNoOverlappingPeers(fmeaBlocks)
  const focusId = Object.entries(fmeaBlocks).find(([, instanceId]) => instanceId === 'b1')[0]
  const focusBounds = await page.locator(`.react-flow__node[data-id="${focusId}"]`).boundingBox()
  const canvasBounds = await page.locator('.react-flow').boundingBox()
  assert.ok(focusBounds.x >= canvasBounds.x && focusBounds.y >= canvasBounds.y
    && focusBounds.x + focusBounds.width <= canvasBounds.x + canvasBounds.width
    && focusBounds.y + focusBounds.height <= canvasBounds.y + canvasBounds.height,
  'Fit keeps the FMEA item of focus inside the visible canvas')
  checks.push('The bundled hydraulic-controller FMEA opens the shared aircraft diagram at its installed item of focus')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'aircraft-example.json'), JSON.stringify({ checks, errors, instances: model.instances.length,
    path: path.map(item => ({ id: item.id, name: item.name })), accessibilityViolations: accessibility.violations.length }, null, 2) + '\n')
  console.log(JSON.stringify({ checks: checks.length, instances: model.instances.length, errors, output }))
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
