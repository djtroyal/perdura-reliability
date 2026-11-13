/** Real IndexedDB round trips and portable canonical companions, including calculation freshness. */
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-fmea-persistence-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'shared-fmea-persistence-page', configureServer(server) {
    server.middlewares.use('/__fmea_persistence', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__fmea_persistence',
        '<!doctype html><html lang="en"><head><title>FMEA persistence assurance</title></head><body>FMEA persistence assurance</body></html>'))
    })
  } }],
})
let browser
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__fmea_persistence`)
  const result = await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    const system = await import('/src/store/sharedSystemModel.ts')
    const shared = await import('/src/store/sharedFmeaModel.ts')
    const editor = await import('/src/components/ReliabilityProgram/fmeaModel.ts')
    await project.hydrateProjectStorage()
    const check = (condition, message) => { if (!condition) throw new Error(message) }
    const canonical = value => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
    const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
    const differences = (before, after, path = '') => {
      if (same(before, after)) return []
      if (!before || !after || typeof before !== 'object' || typeof after !== 'object')
        return [`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`]
      return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .flatMap(key => differences(before[key], after[key], `${path}.${key}`))
    }
    const systemState = system.createProjectSystem('Pump system')
    const definition = systemState.model.definitions[0]
    definition.functions = [{ id: 'supply', description: 'Supply pressure', function_type: 'primary', mode_ids: [] }]
    definition.failure_modes = [{ id: 'no-pressure', function_id: 'supply', description: 'No pressure', deviation_id: 'absent', mode_ids: [] }]
    const analysis = shared.bindFmeaAnalysis(systemState.model, editor.createFmeaAnalysis('dfmea', 1))
    analysis.failure_chains[0].severity = 9
    analysis.failure_chains[0].remarks = 'Reviewed engineering assessment'
    const historical = { engineering_snapshot: { model: structuredClone(analysis), assessment: 'Released source' },
      content_sha256: 'f'.repeat(64) }
    const governance = { [analysis.id]: { evidenceLinks: [{ id: 'evidence', entity_id: analysis.failure_chains[0].id,
      claim: 'Bench test', locator: 'TEST-1' }], releases: [historical], revisions: [structuredClone(historical)] } }
    const outcomes = []
    for (const moduleKey of ['fmea', 'reliabilityProgram']) {
      const field = moduleKey === 'fmea' ? 'analyses' : 'aiagAnalyses'
      const initial = { [field]: [structuredClone(analysis)], governance: structuredClone(governance),
        view: 'analysis', workspaceView: 'guided', step: 1, structureView: 'hierarchy', functionVisualView: 'tree',
        pDiagramId: '', activeId: analysis.id, fmeaMode: 'aiag', fmeaStep: 1, fmeaStructureView: 'hierarchy',
        fmeaFunctionVisualView: 'tree', fmeaPDiagramId: '', activeFmeaId: analysis.id, fmeaWorkspaceView: 'guided',
        sourceSystemFingerprint: undefined, result: null }
      project.newProject(`Portable ${moduleKey}`)
      project.writeModuleSlices({ systemDefinition: structuredClone(systemState),
        [moduleKey]: { _folioWrap: true, activeId: 'folio', folios: [{ id: 'folio', name: 'Assessment', state: initial }] } })
      const folio = () => project.getProjectState().modules[moduleKey].folios[0]
      const pending = project.beginFolioRequest(moduleKey, 'folio', initial)
      const presentation = structuredClone(initial)
      Object.assign(presentation, { view: 'documentation', workspaceView: 'worksheet', step: 5, structureView: 'diagram',
        functionVisualView: 'interfaces', pDiagramId: 'selected', activeId: 'selected', fmeaMode: 'classic', fmeaStep: 6,
        fmeaStructureView: 'diagram', fmeaFunctionVisualView: 'coverage', fmeaPDiagramId: 'selected',
        activeFmeaId: 'selected', fmeaWorkspaceView: 'control_plan' })
      const diagram = presentation[field][0].block_diagram
      diagram.viewport = { x: 80, y: 20, zoom: 1.8 }
      diagram.nodes[0].x += 200
      diagram.nodes[0].width += 80
      diagram.nodes[0].expanded = true
      presentation[field][0].structure_nodes[0].source_ref.imported_at = '2026-10-20T12:00:00Z'
      project.writeFolioState(moduleKey, 'folio', presentation)
      check(pending.isCurrent(), `${moduleKey}: view/layout/source bookkeeping must not cancel analysis`)
      check(pending.commit(current => ({ ...current, result: { marker: 'calculated', inputId: analysis.id },
        sourceSystemFingerprint: shared.fmeaSemanticFingerprint(systemState.model, current[field]), canonicalDependencies: undefined })),
      `${moduleKey}: calculated result should commit`)
      pending.finish()
      check(folio().dirty === false, `${moduleKey}: stamping successful calculation provenance must not mark itself dirty`)
      const calculated = structuredClone(folio().state)
      const geometry = structuredClone(calculated)
      geometry[field][0].block_diagram.nodes[0].y += 100
      project.writeFolioState(moduleKey, 'folio', geometry)
      check(folio().dirty === false, `${moduleKey}: geometry must not stale a calculated result`)
      check(!project.inputsChanged(calculated, { ...calculated, sourceSystemFingerprint: 'updated',
        canonicalDependencies: { status: 'stale', message: 'source bookkeeping' } }, moduleKey),
      `${moduleKey}: canonical dependency metadata is not analysis input`)
      const boundary = structuredClone(geometry)
      boundary[field][0].block_diagram.nodes[0].inside_boundary = false
      check(project.inputsChanged(geometry, boundary, moduleKey), `${moduleKey}: boundary membership remains engineering input`)
      const assessment = structuredClone(geometry)
      assessment[field][0].failure_chains[0].severity = 7
      check(project.inputsChanged(geometry, assessment, moduleKey), `${moduleKey}: ratings remain engineering input`)
      const evidence = structuredClone(geometry)
      evidence.governance[analysis.id].evidenceLinks[0].claim = 'Updated verification'
      check(project.inputsChanged(geometry, evidence, moduleKey), `${moduleKey}: governance evidence remains engineering input`)
      const engineeringRequest = project.beginFolioRequest(moduleKey, 'folio', geometry)
      project.writeFolioState(moduleKey, 'folio', assessment)
      check(!engineeringRequest.isCurrent(), `${moduleKey}: changed ratings cancel a pending analysis`)
      check(folio().dirty === true, `${moduleKey}: changed ratings stale saved calculations`)
      engineeringRequest.finish()
      project.writeFolioState(moduleKey, 'folio', geometry)
      const refreshed = project.beginFolioRequest(moduleKey, 'folio', geometry)
      check(refreshed.commit(current => ({ ...current, result: { ...current.result, marker: 'recalculated' } })), 'refresh failed')
      refreshed.finish()
      const savedState = structuredClone(folio().state)
      const name = `Named ${moduleKey}`
      check(await project.saveNamedProject(name), `${moduleKey}: named save failed`)
      project.newProject('Temporary project')
      check(await project.openNamedProject(name), `${moduleKey}: named open failed`)
      const savedInputs = { ...savedState }
      delete savedInputs.result
      check(same(folio().state, savedInputs), `${moduleKey}: named save/open must preserve binding, annotations, geometry and snapshots: ${differences(savedInputs, folio().state).slice(0, 20).join('; ')}`)
      check(same(folio().state.governance, governance), `${moduleKey}: controlled historical snapshots must remain unchanged`)
      // Browser persistence keeps ordinary module inputs. Explicit snapshot
      // exports additionally retain evaluated results, which remain optional.
      project.writeFolioState(moduleKey, 'folio', savedState)
      check(project.moduleSlices(moduleKey).includes('systemDefinition'), `${moduleKey}: module slices must include canonical companion`)
      const portable = JSON.parse(JSON.stringify(project.buildExport([moduleKey], true)))
      check(same(portable.modules.systemDefinition, systemState), `${moduleKey}: module export must contain exact canonical model`)
      const inputOnly = project.buildExport([moduleKey], false)
      check(inputOnly.modules[moduleKey].folios[0].state.result === undefined, `${moduleKey}: inputs-only export removes results`)
      check(same(inputOnly.modules[moduleKey].folios[0].state.governance, governance), `${moduleKey}: inputs-only export retains controlled snapshots`)
      project.newProject('Portable destination')
      const destinationId = project.getProjectState().identity.projectId
      project.importPayload(portable, moduleKey)
      check(project.getProjectState().identity.projectId === destinationId, `${moduleKey}: module import must retain destination identity`)
      check(same(folio().state, savedState), `${moduleKey}: portable JSON round trip must preserve working and historical data`)
      project.setModuleState('growth', { input: 'Unrelated module' })
      project.importPayload(portable, moduleKey)
      check(project.getProjectState().modules.growth.input === 'Unrelated module', `${moduleKey}: module import preserves other analyses`)
      const existing = project.getProjectState()
      const missing = structuredClone(portable)
      delete missing.modules.systemDefinition
      let message = ''
      try { project.importPayload(missing, moduleKey) } catch (error) { message = error.message }
      check(message.includes('companion'), `${moduleKey}: missing canonical companion must fail explicitly`)
      check(project.getProjectState() === existing, `${moduleKey}: missing companion import must be atomic`)
      const conflicting = structuredClone(portable)
      conflicting.modules.systemDefinition.model.id = 'foreign-model'
      let conflict = ''
      try { project.importPayload(conflicting, moduleKey) } catch (error) { conflict = error.message }
      check(conflict.includes('different shared system'), `${moduleKey}: populated project must reject foreign canonical identity`)
      check(project.getProjectState() === existing, `${moduleKey}: conflicting identity import must be atomic`)
      const edited = structuredClone(portable)
      edited.modules.systemDefinition.model.definitions[0].functions[0].description = 'Changed shared pressure'
      conflict = ''
      try { project.importPayload(edited, moduleKey) } catch (error) { conflict = error.message }
      check(conflict.includes('different shared system'), `${moduleKey}: same identity with changed engineering inputs must also fail`)
      check(project.getProjectState() === existing, `${moduleKey}: conflicting shared inputs import must be atomic`)
      project.importPayload(edited)
      check(project.getProjectState().modules.systemDefinition.model.definitions[0].functions[0].description === 'Changed shared pressure',
        `${moduleKey}: opening the whole project still replaces its canonical model`)
      check(same(folio().state.governance, governance), `${moduleKey}: whole-project import preserves immutable snapshots`)
      outcomes.push(moduleKey)
    }
    return outcomes
  })
  assert.deepEqual(result, ['fmea', 'reliabilityProgram'])
  assert.deepEqual(errors, [])
  console.log('Shared FMEA/Program IndexedDB persistence, portable companions and calculation freshness passed.')
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
