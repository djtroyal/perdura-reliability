import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve } from 'node:path'
import { createServer } from 'vite'

const frontendRoot = resolve(new URL('..', import.meta.url).pathname)
const hmrServer = createHttpServer()
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-artifact-vite-'))
const vite = await createServer({
  cacheDir,
  root: frontendRoot,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
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
  // The coalesced write also awaits WebCrypto; wait for the observable record,
  // not a timing assumption that races dependency scanning on a busy runner.
  const deadline = Date.now() + 5_000
  while (project.getProjectState().analysisRuns.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const payload = project.buildExport(undefined, true)
  assert.match(payload.identity.projectId, /^prj-/)
  assert.equal(payload.analysisRuns.length, 1)
  assert.equal(payload.analysisRuns[0].method, 'Crow-AMSAA')
  assert.match(payload.analysisRuns[0].fingerprintSha256, /^[0-9a-f]{64}$/)
  assert.ok(Array.isArray(payload.exportLedger))

  // Exercise the real download broker with networking unavailable, as under
  // the deployed connect-src 'self' CSP. Compare bytes to the platform decoder.
  const artifact = await vite.ssrLoadModule('/src/store/artifactExport.ts')
  const originals = { fetch: globalThis.fetch, document: globalThis.document,
    localStorage: globalThis.localStorage, createObjectURL: URL.createObjectURL }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>μ ± 95% + # 中文</text></svg>'
  const urls = [
    `data:image/svg+xml,${encodeURIComponent(svg)}`,
    `data:image/svg+xml;charset=utf-8,${svg.replace('#', '%23')}`,
    `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 0, 255, 128]).toString('base64')}`,
    'data:application/octet-stream,%00%FF%80%25+%2B%ZZ#ignored-fragment',
    'data:image/png;BASE64,AA%2B%2FAA%3D%3D',
  ]
  const expected = await Promise.all(urls.map(async url =>
    new Uint8Array(await (await originals.fetch(url)).arrayBuffer())))
  const blobs = []
  const downloadedNames = []
  let networkCalls = 0
  globalThis.fetch = async () => { networkCalls++; throw new Error('CSP blocks network access') }
  globalThis.localStorage = { getItem: () => 'false' }
  globalThis.document = { createElement: () => {
    const anchor = { click: () => downloadedNames.push(anchor.download) }
    return anchor
  } }
  URL.createObjectURL = blob => { blobs.push(blob); return originals.createObjectURL(blob) }
  try {
    for (let index = 0; index < urls.length; index++) {
      assert.equal(await artifact.downloadDataUrlArtifact(urls[index], `image-${index}.bin`,
        'application/octet-stream', { kind: 'test' }), null)
      assert.deepEqual(new Uint8Array(await blobs[index].arrayBuffer()), expected[index])
    }
    assert.equal(networkCalls, 0, 'image export must not perform a fetch')
    assert.equal(downloadedNames.length, urls.length)
    await assert.rejects(artifact.downloadDataUrlArtifact('https://example.com/image.svg',
      'image.svg', 'image/svg+xml', { kind: 'test' }), /valid data URL/)
    await assert.rejects(artifact.downloadDataUrlArtifact('data:image/png;base64,!',
      'image.png', 'image/png', { kind: 'test' }))
    assert.equal(blobs.length, urls.length, 'invalid image data must not download')
  } finally {
    globalThis.fetch = originals.fetch
    globalThis.document = originals.document
    globalThis.localStorage = originals.localStorage
    URL.createObjectURL = originals.createObjectURL
  }

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
  await rm(cacheDir, { recursive: true, force: true })
  hmrServer.close()
}
