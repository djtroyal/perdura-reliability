import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

try {
  const memory = await vite.ssrLoadModule(
    '/src/components/shared/useRememberedTab.ts')

  memory.clearRememberedTabs()
  assert.equal(
    memory.readRememberedTab('system-modeling', 'rbd', ['rbd', 'fta', 'markov']),
    'rbd',
  )
  memory.rememberTab('system-modeling', 'markov')
  assert.equal(
    memory.readRememberedTab('system-modeling', 'rbd', ['rbd', 'fta', 'markov']),
    'markov',
  )
  // Removed/renamed tabs must not strand the UI on an invalid remembered id.
  memory.rememberTab('system-modeling', 'obsolete')
  assert.equal(
    memory.readRememberedTab('system-modeling', 'rbd', ['rbd', 'fta', 'markov']),
    'rbd',
  )

  const rememberedSources = [
    ['src/components/SystemModeling/index.tsx', "'system-modeling'"],
    ['src/components/DataAnalysis/index.tsx', "'data-analysis'"],
    ['src/components/SixSigma/index.tsx', "'six-sigma'"],
    ['src/components/Growth/index.tsx', "'growth'"],
    ['src/components/Maintenance/index.tsx', 'rememberKey="maintenance"'],
    ['src/components/HRA/index.tsx', 'rememberKey="hra"'],
  ]
  for (const [relative, marker] of rememberedSources) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
    assert.equal(source.includes(marker), true, `${relative} must remember its active subtab`)
  }

  const folioBar = await readFile(
    new URL('../src/components/shared/FolioBar.tsx', import.meta.url), 'utf8')
  const dataAnalysis = await readFile(
    new URL('../src/components/DataAnalysis/index.tsx', import.meta.url), 'utf8')
  const lifeData = await readFile(
    new URL('../src/components/LifeData/index.tsx', import.meta.url), 'utf8')
  for (const [name, source] of [
    ['shared analysis tabs', folioBar],
    ['Statistical Modeling tabs', dataAnalysis],
    ['Life Data Analysis tabs', lifeData],
  ]) {
    assert.match(source, /onAuxClick=/, `${name} must handle auxiliary clicks`)
    assert.match(source, /button !== 1/, `${name} must reserve close for the middle button`)
  }
  assert.match(lifeData, /LDA_SPLIT_WARNING_THRESHOLD = 10/,
    'LDA must define the large ID-split warning threshold explicitly')
  assert.match(lifeData, /ids\.size > LDA_SPLIT_WARNING_THRESHOLD[\s\S]*?window\.confirm/,
    'LDA must warn before splitting more than ten IDs into analyses')

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const projectName = app.indexOf('title="Project name"')
  const projectUnits = app.indexOf('<ProjectUnitsSelect />')
  assert.ok(projectName >= 0 && projectUnits > projectName,
    'Project units must render immediately after the project name field')

  const projectBar = await readFile(
    new URL('../src/components/shared/ProjectBar.tsx', import.meta.url), 'utf8')
  assert.match(projectBar, /history\.undo\.length > 1/,
    'Undo history selector must appear only when multiple steps exist')
  assert.match(projectBar, /undoSteps\(item\.steps\)/,
    'Undo history selections must support atomic multi-step travel')
  assert.match(projectBar, /history\.redo\.length > 1/,
    'Redo history selector must appear only when multiple steps exist')
  assert.match(projectBar, /redoSteps\(item\.steps\)/,
    'Redo history selections must support atomic multi-step travel')

  const project = await vite.ssrLoadModule('/src/store/project.ts')
  project.newProject('History contract')
  project.setModuleState('__historyContract', { first: 1 })
  project.setModuleState('__historyContract', { first: 1, second: 2 })
  assert.deepEqual(project.getUndoHistory().map(item => item.steps), [1, 2],
    'History must be listed from the next action through older actions')
  project.undoSteps(2)
  assert.equal(project.getProjectState().modules.__historyContract, undefined,
    'Selecting an older undo entry must restore its complete snapshot')
  assert.deepEqual(project.getRedoHistory().map(item => item.steps), [1, 2],
    'A multi-step undo must retain every step for redo')
  project.redoSteps(2)
  assert.deepEqual(project.getProjectState().modules.__historyContract, { first: 1, second: 2 },
    'Selecting an older redo entry must atomically restore all selected changes')
  project.newProject('Conversion folio contract')
  const firstConvertedId = project.createFolioState('faultTree', 'Converted Model', {
    nodes: [{ id: 'top', type: 'or' }], edges: [],
  })
  let converted = project.getProjectState().modules.faultTree
  assert.equal(converted.folios.length, 1,
    'creating the first converted analysis must not leave an empty placeholder folio')
  assert.equal(converted.activeId, firstConvertedId,
    'the newly converted analysis must become active')
  project.createFolioState('faultTree', 'Converted Model', { nodes: [], edges: [] })
  converted = project.getProjectState().modules.faultTree
  assert.deepEqual(converted.folios.map(folio => folio.name), [
    'Converted Model', 'Converted Model (2)',
  ], 'converted analyses must receive deterministic unique names')
  project.undo()
  assert.equal(project.getProjectState().modules.faultTree.folios.length, 1,
    'one Undo must remove one atomically created converted analysis')
  project.newProject()

  console.log('Navigation persistence and analysis-tab interaction contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
