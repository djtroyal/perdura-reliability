import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const hmrServer = createHttpServer()
const vite = await createServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const module = await vite.ssrLoadModule('/src/components/shared/InfluenceCues.tsx')
  for (const name of ['InfluenceScope', 'InfluenceSource', 'InfluenceTarget', 'InfluenceOverlay', 'useInfluenceCues']) {
    assert.equal(typeof module[name], 'function', `${name} must remain available to analysis modules`)
  }

  const shared = await readFile(new URL('../src/components/shared/InfluenceCues.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(shared, /store\/project|useModuleState|useFolioState/,
    'influence selection must remain ephemeral and outside saved project/undo state')
  assert.match(shared, /event\.key === 'Escape'/,
    'Escape must clear the active influence cue')
  assert.match(shared, /closest\('\[data-influence-source\],\[data-influence-target\]'\)/,
    'an empty-space click must clear the active influence cue')
  assert.match(shared, /data-export-ignore/,
    'cue overlays must be excluded from exported reports')
  assert.match(shared, /bg-blue-50\/15 ring-1 ring-inset ring-blue-400\/80/,
    'targets must use a subtle overlay that preserves semantic result colors')

  const mappings = [
    ['Process Capability', 'src/components/ProcessCapability/index.tsx', 'capability.lsl'],
    ['MSA', 'src/components/MSA/index.tsx', 'msa.tolerance'],
    ['Hypothesis Tests', 'src/components/Hypothesis/index.tsx', 'hypothesis.alpha'],
    ['Reliability Growth', 'src/components/Growth/index.tsx', 'growth.confidence'],
    ['ALT', 'src/components/ALT/index.tsx', 'alt.useLevel'],
    ['Life Data Analysis', 'src/components/LifeData/index.tsx', 'lda.calc.mission'],
    ['Maintenance', 'src/components/Maintenance/AvailabilitySensitivity.tsx', 'availability.mtbf'],
    ['Reliability Allocation', 'src/components/ReliabilityAllocation/index.tsx', 'allocation.row.'],
    ['Physics of Failure', 'src/components/PhysicsOfFailure/index.tsx', 'pof.uncertainty.confidence'],
  ]
  for (const [label, relative, key] of mappings) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
    assert.match(source, /InfluenceScope/,
      `${label} must own an influence scope`)
    assert.equal(source.includes(key), true,
      `${label} must retain its high-confidence input/result mapping`)
  }

  const prediction = await readFile(
    new URL('../src/components/Prediction/index.tsx', import.meta.url), 'utf8')
  assert.match(prediction, /parameter_impacts/,
    'Failure Rate Prediction must retain its exact backend-provided impact mapping')
  assert.match(prediction, /event\.key === 'Escape'.*setActiveParameter\(null\)/s,
    'Failure Rate Prediction cues must clear with Escape')

  console.log('Input influence cue contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
