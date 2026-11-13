/** Each authored input shows a compact read-only supplier/resource summary in the actual Aircraft workspaces. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const arg = process.argv.indexOf('--output-dir')
const output = resolve(arg < 0 ? join(tmpdir(), 'perdura-input-suppliers') : process.argv[arg + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-input-suppliers-vite-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
let browser, page
const errors = [], checks = []
const snapshot = () => page.evaluate(async () => {
  const project = (await import('/src/store/project.ts')).getProjectState()
  return { model: project.modules.systemDefinition.model,
    study: project.modules.fmea.folios.flatMap(item => item.state.analyses).find(item => item.id === 'DFMEA-DEMO') }
})
const editor = () => page.getByRole('region', { name: 'Installed functions and failures', exact: true })
const suppliers = (container, number) => container.getByRole('list', { name: `Suppliers for input ${number}`, exact: true, includeHidden: true })
const dependencies = (container, number) => container.locator(`summary[aria-label="Input ${number} dependencies"]`)
const assertSimplified = async container => {
  await expect(container.getByRole('region', { name: /Inherited function inputs|Supporting function requirements/ })).toHaveCount(0)
  await expect(container.getByText(/\d+ direct · \d+ inherited|Other descendant requirements/)).toHaveCount(0)
  await expect(container.locator('[aria-label^="Suppliers for input"] button, [aria-label^="Suppliers for input"] a, [aria-label^="Suppliers for input"] summary')).toHaveCount(0)
}
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  page = await (await browser.newContext({ viewport: { width: 1660, height: 1080 }, reducedMotion: 'reduce' })).newPage()
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(90000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    status: new URL(route.request().url()).pathname.endsWith('/fmea/readiness') ? 503 : 200,
    contentType: 'application/json', body: new URL(route.request().url()).pathname.endsWith('/version')
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
  await expect.poll(() => page.evaluate(async () =>
    (await import('/src/store/project.ts')).getProjectState().modules.systemDefinition?.model?.root_instance_id)).toBe('aircraft')
  const original = await snapshot()
  await page.getByRole('tab', { name: 'System Modeling', exact: true }).click()
  await page.getByRole('tab', { name: 'System Definition', exact: true }).click()
  await page.getByRole('button', { name: 'Functions & Failures', exact: true }).click()
  await page.getByRole('button', { name: 'Left Propulsion Channel L3', exact: true }).click()
  await editor().getByRole('button', { name: /Deliver controlled left propulsion thrust/ }).click()
  const input1 = editor().getByRole('button', { name: 'Input 1', exact: true })
  await expect(input1).toContainText('Left propeller thrust')
  await expect(input1).toContainText('Left Propeller Assembly')
  await expect(input1).not.toContainText('Aircraft ›')
  await expect(suppliers(editor(), 1)).toBeHidden()
  await page.screenshot({ path: join(output, 'propulsion-input-dependencies-collapsed.png') })
  await input1.click()
  const picker = page.getByRole('dialog', { name: 'Choose input resource', exact: true })
  await expect(picker.getByRole('button', { name: 'Left Propeller Assembly', exact: true })).toBeVisible()
  await expect(picker.getByRole('button', { name: 'Electrical Power System', exact: true })).toHaveCount(0)
  await expect(picker.getByRole('button', { name: 'Use Left propeller thrust', exact: true })).toHaveCount(0)
  await page.screenshot({ path: join(output, 'propulsion-input-selection-children.png') })
  await picker.getByRole('button', { name: 'Propulsion System', exact: true }).click()
  await expect(picker.getByRole('button', { name: 'Use Net propulsive thrust', exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'Left Propulsion Channel', exact: true }).click()
  await picker.getByRole('button', { name: 'Left Propeller Assembly', exact: true }).click()
  await expect(picker.getByRole('button', { name: 'Use Left propeller thrust', exact: true })).toBeVisible()
  const pickerAccessibility = await new AxeBuilder({ page }).include('[role="dialog"][aria-label="Choose input resource"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  assert.deepEqual(pickerAccessibility.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [])
  await page.screenshot({ path: join(output, 'propulsion-input-selection.png') })
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(input1).toBeFocused()
  await input1.click()
  await expect(picker.getByRole('button', { name: 'Left Propeller Assembly', exact: true })).toBeVisible()
  await expect(picker.getByRole('button', { name: 'Use Left propeller thrust', exact: true })).toHaveCount(0)
  await picker.getByRole('button', { name: 'Aircraft', exact: true }).click()
  await expect(picker.getByRole('button', { name: 'Electrical Power System', exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'External sources', exact: true }).click()
  await picker.getByRole('button', { name: 'Ambient Atmosphere', exact: true }).click()
  await expect(picker.getByRole('button', { name: 'Use Ambient airflow', exact: true })).toBeVisible()
  await editor().getByRole('textbox', { name: 'Function action', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(input1).toContainText('Left propeller thrust')
  checks.push('Input selection opens at the current block’s immediate children on every reopening, with breadcrumbs to ancestor outputs and external sources, and Escape/outside dismissal')
  await dependencies(editor(), 1).click()
  const expectedPropulsion = [
    'Ambient Atmosphere · Ambient airflow',
    'Electrical Power System · Protected high-voltage DC power',
    'Flight Command Computer · Aircraft control demands',
    'Thermal and Environmental System · Aircraft equipment coolant supply',
  ]
  assert.deepEqual((await suppliers(editor(), 1).getByRole('listitem').allTextContents()).sort(), expectedPropulsion.sort())
  await expect(suppliers(editor(), 1)).not.toContainText('Aircraft ›')
  const fieldBox = await input1.boundingBox(), contextBox = await suppliers(editor(), 1).boundingBox()
  assert.ok(contextBox.y >= fieldBox.y + fieldBox.height, 'Supplier context appears immediately below its input picker')
  await assertSimplified(editor())
  const a11y = await new AxeBuilder({ page }).include('[aria-label="Installed functions and failures"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  assert.deepEqual(a11y.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [])
  await page.screenshot({ path: join(output, 'propulsion-input-suppliers.png') })
  checks.push('Input dependencies start collapsed and expand to four concise supplier/output-resource lines without the old inheritance panels or trace controls')

  await page.getByRole('combobox', { name: 'Operating mode', exact: true }).selectOption('ground')
  const expectedGround = await page.evaluate(async () => {
    const state = (await import('/src/store/project.ts')).getProjectState().modules.systemDefinition
    const result = (await import('/src/store/inheritedFunctionInputs.ts')).projectFunctionInputSuppliers(state.model,
      { instanceId: 'propulsion-left', functionId: 'perform', modeId: 'ground' })
    return (result['in-propeller-left-perform'] ?? []).map(row => `${row.supplierLabel} · ${row.resourceName}`).sort()
  })
  assert.deepEqual((await suppliers(editor(), 1).getByRole('listitem').allTextContents()).sort(), expectedGround)
  checks.push('The compact supplier list follows the selected System Modeling operating mode')

  await page.getByRole('tab', { name: 'FMEA', exact: true }).click()
  await page.getByRole('button', { name: /Function analysis/ }).click()
  const current = await snapshot()
  const controllerFn = current.study.functions.find(fn => fn.system_definition_ref?.instance_id === 'b1' && fn.system_definition_ref?.function_id === 'DFN-3')
  const controller = page.locator(`[data-context-kind="function"][data-context-id="${controllerFn.id}"]`)
  await controller.getByRole('button', { name: controllerFn.description, exact: true }).click()
  await controller.getByRole('button', { name: 'Input 1', exact: true }).click()
  await expect(picker.getByRole('button', { name: 'Controller Power Connector', exact: true })).toBeVisible()
  await expect(picker.getByRole('button', { name: 'Electrical Power System', exact: true })).toHaveCount(0)
  await page.screenshot({ path: join(output, 'fmea-input-selection-children.png') })
  await page.keyboard.press('Escape')
  await expect(suppliers(controller, 1)).toBeHidden()
  await expect(suppliers(controller, 2)).toBeHidden()
  await dependencies(controller, 1).click()
  await dependencies(controller, 2).click()
  assert.deepEqual(await suppliers(controller, 1).getByRole('listitem').allTextContents(), ['Electrical Power System · Essential 28 V DC power'])
  assert.deepEqual((await suppliers(controller, 2).getByRole('listitem').allTextContents()).sort(), [
    'Electrical Power System · Essential 28 V DC power', 'Hydraulic Delivery Manifold · Manifold hydraulic pressure',
  ].sort())
  await expect(page.getByRole('combobox', { name: 'FMEA system operating mode', exact: true })).toHaveValue('')
  await assertSimplified(controller)
  const canonicalExpected = await page.evaluate(async () => {
    const project = (await import('/src/store/project.ts')).getProjectState()
    const model = project.modules.systemDefinition.model
    const study = project.modules.fmea.folios.flatMap(item => item.state.analyses).find(item => item.id === 'DFMEA-DEMO')
    return (await import('/src/store/inheritedFunctionInputs.ts')).projectFunctionInputSuppliers(model,
      { instanceId: 'b1', functionId: 'DFN-3', modeId: study.system_binding.mode_id })
  })
  assert.deepEqual((await suppliers(controller, 2).getByRole('listitem').allTextContents()).sort(), canonicalExpected['pressure-in'].map(row => `${row.supplierLabel} · ${row.resourceName}`).sort())
  await page.screenshot({ path: join(output, 'fmea-input-suppliers.png') })
  checks.push('Physical FMEA shows distinct suppliers for each authored input using canonical references and its own study mode')

  const final = await snapshot()
  for (const key of ['instances', 'definitions', 'resources', 'interfaces', 'externals', 'function_links'])
    assert.deepEqual(final.model[key], original.model[key], `Reading input context must preserve canonical ${key}`)
  assert.deepEqual(final.study.system_binding, original.study.system_binding)
  assert.deepEqual(final.study.functions, original.study.functions)
  checks.push('Viewing supplier context preserves all canonical inputs, resources, interfaces, and FMEA functions/binding')
  await page.getByRole('tab', { name: 'System Modeling', exact: true }).click()
  await editor().getByRole('button', { name: /Deliver controlled left propulsion thrust/ }).click()
  await dependencies(editor(), 1).click()
  await expect(suppliers(editor(), 1)).toBeVisible()
  const replacement = await page.evaluate(async () => {
    const model = (await import('/src/store/project.ts')).getProjectState().modules.systemDefinition.model
    return (await import('/src/store/functionResourceFlows.ts')).availableFunctionInputs(model,
      { instanceId: 'propulsion-left', functionId: 'perform' }).find(option => option.resource.id === 'resource-motor-left-perform')
  })
  assert.ok(replacement)
  await editor().getByRole('button', { name: 'Input 1', exact: true }).click()
  const currentBlockIndex = replacement.path.findIndex(part => part.id === 'propulsion-left')
  assert.ok(currentBlockIndex >= 0)
  for (const part of replacement.path.slice(currentBlockIndex + 1)) await picker.getByRole('button', { name: part.label, exact: true }).click()
  await picker.getByRole('button', { name: `Use ${replacement.resource.name}`, exact: true }).click()
  await expect(editor().getByRole('button', { name: 'Input 1', exact: true })).toContainText(replacement.resource.name)
  await expect(suppliers(editor(), 1)).toBeHidden()
  checks.push('Choosing a different function output updates the input and resets its dependency details to collapsed')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'browser.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error('Browser errors:', errors); throw error
} finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
