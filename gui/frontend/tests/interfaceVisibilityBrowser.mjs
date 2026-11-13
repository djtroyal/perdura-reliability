/** Aircraft display controls preserve canonical architecture, placement and calculated results. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const argument = process.argv.indexOf('--output-dir')
const output = resolve(argument < 0 ? join(tmpdir(), 'perdura-interface-visibility') : process.argv[argument + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-visibility-vite-'))
const entry = '/__interface_visibility.tsx'
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client'; import '/src/index.css'
import SystemDefinition from '/src/components/SystemDefinition'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import {ToastViewport} from '/src/components/shared/toast'
import * as project from '/src/store/project'
import demo from '/src/data/demoProject.json'
await project.hydrateProjectStorage(); project.newProject('Interface display regression')
const system=structuredClone(demo.modules.systemDefinition)
system.view='architecture'; system.selectedInstanceId='propulsion'
system.propagation={fingerprint:'display-result-sentinel',paths:[],proposals:[],nodes:[],edges:[]}
project.setModuleState('systemDefinition',system)
window.interfaceDisplay={snapshot:()=>project.getProjectState().modules.systemDefinition}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'systemDefinition',moduleLabel:'System Modeling'}}>
<div className="perdura-theme flex h-screen min-h-0 flex-col"><SystemDefinition/></div><ToastViewport/></ReportAssetScopeProvider></KeyboardShortcutProvider>)
`
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'interface-visibility-browser',
    resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
    configureServer(server) { server.middlewares.use('/__interface_visibility', async (req, res, next) => {
      if (!['', '/'].includes(req.url?.split('?')[0])) return next()
      res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__interface_visibility',
        `<!doctype html><html lang="en"><head><title>Interface display controls</title></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`))
    }) },
  }] })
let browser, page
const checks = [], errors = []
const snapshot = () => page.evaluate(() => window.interfaceDisplay.snapshot())
const architecture = model => { const { diagrams, ...canonical } = model; return canonical }
const node = id => page.locator(`.react-flow__node[data-id="system-instance:${id}"]`)
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' })).newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__interface_visibility`)
  const library = page.getByRole('complementary', { name: 'Diagram library' })
  await expect(library).toBeVisible({ timeout: 90000 })
  const hierarchy = page.getByRole('group', { name: 'Hierarchy visibility', exact: true })
  const original = await snapshot()
  await expect(node('propulsion')).toHaveCount(1)
  await hierarchy.getByRole('button', { name: 'Hide all', exact: true }).click()
  await expect(node('propulsion')).toHaveCount(0)
  const hidden = await snapshot()
  await hierarchy.getByRole('button', { name: 'Invert', exact: true }).click()
  await expect(node('propulsion')).toHaveCount(1)
  await hierarchy.getByRole('button', { name: 'Invert', exact: true }).click()
  await expect(node('propulsion')).toHaveCount(0)
  assert.deepEqual((await snapshot()).model.diagrams[0].hidden_instance_ids, hidden.model.diagrams[0].hidden_instance_ids)
  assert.deepEqual((await snapshot()).model.diagrams[0].nodes, original.model.diagrams[0].nodes)
  await hierarchy.getByRole('button', { name: 'Show all', exact: true }).click()
  await library.getByRole('button', { name: 'Diagram visibility for Propulsion System', exact: true }).click()
  await library.getByRole('button', { name: 'Diagram visibility for Left Motor Inverter', exact: true }).click()
  await expect(node('inverter-left')).toHaveCount(1)
  await expect(library.getByRole('button', { name: 'Diagram visibility for Propulsion System', exact: true })).toHaveAttribute('aria-pressed', 'mixed')
  const mixed = await snapshot()
  assert.ok(mixed.model.diagrams[0].hidden_instance_ids.includes('propulsion'))
  await hierarchy.getByRole('button', { name: 'Invert', exact: true }).click()
  await hierarchy.getByRole('button', { name: 'Invert', exact: true }).click()
  assert.deepEqual((await snapshot()).model.diagrams, mixed.model.diagrams)
  checks.push('All-level inversion is reversible, retains contextual parents, and preserves placement/collapse')
  await hierarchy.getByRole('button', { name: 'Show all', exact: true }).click()
  const beforeFilters = await snapshot()
  await library.getByText(/^Interface types ·/).click()
  await library.getByRole('button', { name: 'No types', exact: true }).click()
  await library.getByRole('checkbox', { name: 'Energy', exact: true }).check()
  await library.getByText('Installed hierarchy', { exact: true }).click()
  const resource = beforeFilters.model.resources.find(item => item.name === 'Protected high-voltage DC power')
  const expected = beforeFilters.model.interfaces.filter(item => item.interface_type === 'energy'
    && item.transfers.some(transfer => transfer.kind === 'flow' && transfer.resource_id === resource.id)).length
  await library.getByText(/^Resource ·/).click()
  await library.getByRole('searchbox', { name: 'Find a diagram resource' }).fill('Protected high-voltage')
  await library.getByRole('radio', { name: resource.name, exact: true }).check()
  await expect(library.getByRole('searchbox', { name: 'Find a diagram resource' })).toBeHidden()
  await expect(library.getByRole('status')).toHaveText(`${expected} of ${beforeFilters.model.interfaces.length} interfaces match`)
  await expect(node('landing-gear')).toHaveCount(1)
  await library.getByRole('checkbox', { name: 'Only connected blocks' }).check()
  await expect(node('landing-gear')).toHaveCount(0)
  assert.deepEqual((await snapshot()).model, beforeFilters.model, 'Type/resource/connected filters do not change project data')
  checks.push('Type and resource filters compose; connected-only is optional and leaves the model unchanged')
  await page.getByRole('button', { name: 'Functions & Failures', exact: true }).click()
  await page.getByRole('button', { name: 'Interfaces', exact: true }).click()
  await expect(library.getByRole('checkbox', { name: 'Only connected blocks' })).toBeChecked()
  await expect(library.getByText(`Resource · ${resource.name}`, { exact: true })).toBeVisible()
  const separator = page.getByRole('separator', { name: 'Resize diagram library' })
  await separator.focus(); await page.keyboard.press('End'); await expect(separator).toHaveAttribute('aria-valuenow', '440')
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await expect(separator).toHaveAttribute('aria-valuenow', '256')
  const clipped = await library.locator('span.whitespace-normal').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent))
  assert.deepEqual(clipped, [], 'Hierarchy names wrap at narrow pane widths')
  await library.getByRole('button', { name: 'Hide diagram library' }).click()
  await page.getByRole('button', { name: 'Show diagram library' }).click()
  await expect(separator).toHaveAttribute('aria-valuenow', '256')
  await library.getByRole('button', { name: 'Reset filters' }).click()
  await expect(library.getByRole('checkbox', { name: 'Only connected blocks' })).not.toBeChecked()
  await expect(node('landing-gear')).toHaveCount(1)
  const installedHierarchy = page.getByRole('group', { name: 'Installed hierarchy', exact: true })
  await installedHierarchy.getByRole('button', { name: /^Propulsion System L2$/ }).click()
  const direction = library.getByRole('combobox', { name: 'Selected block connections' })
  const beforeDirection = await snapshot()
  const inSubtree = (id, rootId) => {
    const visited = new Set()
    while (id && !visited.has(id)) {
      if (id === rootId) return true
      visited.add(id); id = beforeDirection.model.instances.find(item => item.id === id)?.parent_instance_id
    }
    return false
  }
  const countDirection = (rootId, kind) => beforeDirection.model.interfaces.filter(item => item.transfers?.some(flow => {
    if (flow.kind !== 'flow') return false
    const source = inSubtree(flow.source.instance_id, rootId), target = inSubtree(flow.target.instance_id, rootId)
    return source !== target && (kind === 'suppliers' ? target : source)
  })).length
  await direction.selectOption('suppliers')
  await expect(library.getByRole('status')).toHaveText(`${countDirection('propulsion', 'suppliers')} of ${beforeDirection.model.interfaces.length} interfaces match`)
  await expect(node('propulsion')).toHaveCount(1)
  await expect(node('electrical-power')).toHaveCount(1)
  await expect(node('landing-gear')).toHaveCount(0)
  await expect(library.getByRole('checkbox', { name: 'Only connected blocks' })).toBeChecked()
  await expect(library.getByRole('checkbox', { name: 'Only connected blocks' })).toBeDisabled()
  await direction.selectOption('recipients')
  await expect(library.getByRole('status')).toHaveText(`${countDirection('propulsion', 'recipients')} of ${beforeDirection.model.interfaces.length} interfaces match`)
  await expect(node('propulsion')).toHaveCount(1)
  await direction.selectOption('suppliers')
  const beforeCollapse = await snapshot()
  await page.getByRole('button', { name: 'Collapse all systems', exact: true }).click()
  await expect(node('inverter-left')).toHaveCount(0)
  await expect(node('propulsion')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Collapse all systems', exact: true })).toBeDisabled()
  await expect(library.getByRole('status')).toHaveText(`${countDirection('propulsion', 'suppliers')} of ${beforeDirection.model.interfaces.length} interfaces match`)
  const afterCollapse = await snapshot()
  const geometry = model => model.diagrams[0].nodes.map(({ expanded, ...placement }) => placement)
  assert.deepEqual(geometry(afterCollapse.model), geometry(beforeCollapse.model), 'Collapse all preserves manual placement and hidden nodes')
  assert.deepEqual(afterCollapse.model.diagrams[0].hidden_instance_ids, beforeCollapse.model.diagrams[0].hidden_instance_ids)
  assert.deepEqual(architecture(afterCollapse.model), architecture(beforeDirection.model))
  await installedHierarchy.getByRole('button', { name: /^Electrical Power System L2$/ }).click()
  await expect(direction).toHaveValue('suppliers')
  await expect(library.getByRole('status')).toHaveText(`${countDirection('electrical-power', 'suppliers')} of ${beforeDirection.model.interfaces.length} interfaces match`)
  await expect(node('electrical-power')).toHaveCount(1)
  await library.getByRole('button', { name: 'Reset filters' }).click()
  checks.push('Supplier/recipient filters follow the selected system and inherited resource direction; Collapse all preserves geometry and filter results')
  await page.locator('.react-flow__controls-fitview').click()
  await node('electrical-power').getByRole('button', { name: 'Expand Electrical Power System', exact: true }).click()
  await expect.poll(async () => (await snapshot()).model.diagrams[0].nodes.find(item => item.instance_id === 'electrical-power').expanded).toBe(true)
  await library.getByRole('button', { name: 'Diagram visibility for Electrical Power System', exact: true }).click()
  await expect(node('electrical-power')).toHaveCount(0)
  const hiddenExpanded = await snapshot()
  await expect(page.getByRole('button', { name: 'Collapse all systems', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Collapse all systems', exact: true }).click()
  const hiddenCollapsed = await snapshot()
  assert.equal(hiddenCollapsed.model.diagrams[0].nodes.find(item => item.instance_id === 'electrical-power').expanded, false,
    'Master Collapse all also closes hierarchy-hidden systems')
  assert.deepEqual(geometry(hiddenCollapsed.model), geometry(hiddenExpanded.model), 'Closing hidden systems preserves all coordinates and sizes')
  assert.deepEqual(hiddenCollapsed.model.diagrams[0].hidden_instance_ids, hiddenExpanded.model.diagrams[0].hidden_instance_ids,
    'Collapse all cannot alter hierarchy visibility selections')
  assert.deepEqual(architecture(hiddenCollapsed.model), architecture(hiddenExpanded.model))
  await hierarchy.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(node('electrical-power')).toHaveCount(1)
  await expect(node('electrical-power').getByRole('button', { name: 'Expand Electrical Power System', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Collapse all systems', exact: true })).toBeDisabled()
  checks.push('Master Collapse all closes hierarchy-hidden expanded systems without revealing them or changing geometry; Show all keeps them collapsed')
  const accessibility = await new AxeBuilder({ page }).include('aside[aria-label="Diagram library"]').analyze()
  assert.deepEqual(accessibility.violations, [], JSON.stringify(accessibility.violations, null, 2))
  await page.screenshot({ path: join(output, 'aircraft-interface-controls.png') })
  checks.push('Filters and pane width persist across tabs; labels wrap; controls pass keyboard and accessibility checks')
  const final = await snapshot()
  assert.deepEqual(architecture(final.model), architecture(original.model))
  assert.deepEqual(final.propagation, original.propagation)
  assert.deepEqual(errors, [])
  checks.push('Canonical functions, resources, interfaces and propagation results survive all display changes')
  await writeFile(join(output, 'interface-visibility.json'), JSON.stringify({ checks, errors }, null, 2) + '\n')
  console.log(JSON.stringify({ checks: checks.length, errors, output }))
} catch (error) {
  await writeFile(join(output, 'errors.json'), JSON.stringify({ errors, message: String(error) }, null, 2) + '\n')
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
