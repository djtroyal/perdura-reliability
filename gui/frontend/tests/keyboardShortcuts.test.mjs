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
  const core = await vite.ssrLoadModule('/src/components/shared/shortcutCore.ts')
  const event = (overrides = {}) => ({
    key: 'Enter', code: 'Enter', ctrlKey: true, metaKey: false,
    altKey: false, shiftKey: false, ...overrides,
  })
  assert.equal(core.matchesShortcut(event(), { key: 'Enter', mod: true }), true)
  assert.equal(core.matchesShortcut(event({ altKey: true }), { key: 'Enter', mod: true }), false)
  assert.equal(core.matchesShortcut(event({ key: '[', code: 'BracketLeft', ctrlKey: false, altKey: true }), { code: 'BracketLeft', alt: true }), true)
  assert.equal(core.formatShortcut({ key: 'Enter', mod: true }, false), 'Ctrl+Enter')
  assert.equal(core.adjacentTabId(['a', 'b', 'c'], 'a', 'ArrowLeft'), 'c')
  assert.equal(core.adjacentTabId(['a', 'b', 'c'], 'c', 'ArrowRight'), 'a')
  assert.equal(core.adjacentTabId(['a', 'b', 'c'], 'b', 'Home'), 'a')

  const framework = await readFile(new URL('../src/components/shared/KeyboardShortcuts.tsx', import.meta.url), 'utf8')
  assert.match(framework, /app\.command-palette/)
  assert.match(framework, /analysis\.run-active/)
  assert.match(framework, /aria-modal="true"/)
  assert.match(framework, /isEditableTarget/)

  const primarySources = [
    'src/components/LifeData/index.tsx',
    'src/components/ALT/toolkit.tsx',
    'src/components/SystemReliability/index.tsx',
    'src/components/FaultTree/index.tsx',
    'src/components/Markov/index.tsx',
    'src/components/ReliabilityAllocation/index.tsx',
    'src/components/Prediction/index.tsx',
    'src/components/PhysicsOfFailure/index.tsx',
    'src/components/Growth/index.tsx',
    'src/components/Growth/RepairableTools.tsx',
    'src/components/Warranty/index.tsx',
    'src/components/Hypothesis/index.tsx',
    'src/components/Descriptive/index.tsx',
    'src/components/DataModeling/Enhanced.tsx',
    'src/components/ProcessCapability/index.tsx',
    'src/components/MSA/index.tsx',
    'src/components/SPC/index.tsx',
    'src/components/DOE/index.tsx',
    'src/components/DOE/AnalyzePanel.tsx',
  ]
  for (const relative of primarySources) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
    assert.match(source, /data-shortcut-primary/, `${relative} must expose its primary calculation`)
  }

  for (const relative of [
    'src/components/SystemReliability/index.tsx',
    'src/components/FaultTree/index.tsx',
    'src/components/Markov/index.tsx',
  ]) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
    assert.match(source, /useShortcuts\(\[/, `${relative} must use the central shortcut registry`)
    assert.doesNotMatch(source, /addEventListener\(['"]keydown/, `${relative} must not install a competing keyboard listener`)
    assert.match(source, /auto-layout/)
    assert.match(source, /select-all/)
  }

  const help = await readFile(new URL('../src/components/help/HelpCenter.tsx', import.meta.url), 'utf8')
  assert.match(help, /Keyboard shortcuts/)
  console.log('Keyboard shortcut registry, module coverage, and canvas contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
