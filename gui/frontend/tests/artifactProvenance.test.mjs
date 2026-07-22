import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { createServer } from 'vite'

const frontendRoot = resolve(new URL('..', import.meta.url).pathname)
const hmrServer = createHttpServer()
const vite = await createServer({
  root: frontendRoot,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

async function sourceFiles(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (['.ts', '.tsx'].includes(extname(path))) files.push(path)
  }
  return files
}

try {
  const provenance = await vite.ssrLoadModule('/src/store/provenance.ts')
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  assert.equal(provenance.canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}')
  assert.equal(await provenance.hashCanonicalJson({ b: [2, 1], a: -0 }),
    await provenance.hashCanonicalJson({ a: 0, b: [2, 1] }),
    'semantically identical JSON-safe inputs must have deterministic hashes')

  project.newProject('Trace contract')
  project.setModuleState('growth', { method: 'Crow-AMSAA', input: 7, result: { beta: 0.8 } })
  await new Promise(resolve => setTimeout(resolve, 300))
  const payload = project.buildExport(undefined, true)
  assert.match(payload.identity.projectId, /^prj-/)
  assert.equal(payload.analysisRuns.length, 1)
  assert.equal(payload.analysisRuns[0].method, 'Crow-AMSAA')
  assert.match(payload.analysisRuns[0].fingerprintSha256, /^[0-9a-f]{64}$/)
  assert.ok(Array.isArray(payload.exportLedger))

  const src = resolve(frontendRoot, 'src')
  const bypasses = []
  for (const file of await sourceFiles(src)) {
    const rel = relative(src, file)
    if (rel === 'store/artifactExport.ts' || rel === 'components/easteregg/SkiGame.tsx') continue
    const text = await readFile(file, 'utf8')
    for (const pattern of [/\.download\s*=/, /Plotly\s*\.\s*downloadImage\s*\(/, /URL\s*\.\s*createObjectURL\s*\(/]) {
      if (pattern.test(text)) bypasses.push(`${rel}: ${pattern}`)
    }
  }
  assert.deepEqual(bypasses, [], 'exports must use the provenance-aware download broker')
  console.log('artifact provenance contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
