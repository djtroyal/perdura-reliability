import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'

const frontendRoot = resolve(new URL('..', import.meta.url).pathname)
const hmrServer = createHttpServer()
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-artifact-vite-'))
const vite = await createServer({
  cacheDir,
  root: frontendRoot,
  appType: 'custom',
  plugins: [ssrOnlyVitePlugin()],
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
  assert.equal(vite.config.optimizeDeps.noDiscovery, true)
  assert.deepEqual(vite.config.optimizeDeps.include, [])
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

  // Diagram layout is persisted, but must not change scientific fingerprints
  // or invalidate a result. A later scientific edit must still fail closed.
  for (const moduleKey of ['system', 'markov']) {
    project.newProject('Layout provenance ' + moduleKey)
    const initial = moduleKey === 'system' ? {
      nodes:[{id:'a',type:'component',position:{x:10,y:20},data:{reliability:.9,_sourceFingerprint:'source-a'}}],
      edges:[],missionTime:'1000',density:'comfortable',
    } : {states:[{id:'a',name:'Up',state_type:'operational'}],transitions:[],initialState:'a',tMax:1000,
      positions:{a:{x:10,y:20}},canvasNodes:[],density:'comfortable',_sourceFingerprint:'source-a'}
    project.setModuleState(moduleKey,{_folioWrap:true,activeId:'a',folios:[{id:'a',name:'A',state:initial}]})
    const calculated = {...initial,result:{value:1}}
    project.writeFolioState(moduleKey,'a',calculated)
    const limit=Date.now()+5000
    while (!project.getProjectState().analysisRuns.length && Date.now()<limit) await new Promise(resolve=>setTimeout(resolve,20))
    const sourcesBefore=await project.artifactSources(moduleKey,'a')
    assert.equal(sourcesBefore[0]?.current,true)
    const presented={...calculated,density:'expanded',layoutOptions:{mode:'expanded',preserveGateOrder:false,preserveEventOrder:true,optimizeLabelGeometry:true},
      positions:{a:{x:400,y:500}},annotations:[{id:'note',position:{x:300,y:300}}],
      ...(moduleKey==='system'?{nodes:[{...initial.nodes[0],position:{x:400,y:500},measured:{width:200,height:150},data:{...initial.nodes[0].data,displayDensity:'expanded'}}]}:{canvasNodes:[{id:'a',position:{x:400,y:500}}]})}
    project.writeFolioState(moduleKey,'a',presented)
    assert.equal(project.getProjectState().modules[moduleKey].folios[0].dirty,false)
    const sourcesAfter=await project.artifactSources(moduleKey,'a')
    assert.equal(sourcesAfter[0].inputSha256,sourcesBefore[0].inputSha256)
    assert.equal(sourcesAfter[0].current,true,'layout must retain current artifact provenance')
    assert.equal(project.buildExport(undefined,false).modules[moduleKey].folios[0].state.layoutOptions.mode,'expanded','input-only exports retain presentation')
    const changed=moduleKey==='system'?{...presented,missionTime:'2000'}:{...presented,tMax:2000}
    project.writeFolioState(moduleKey,'a',changed)
    assert.equal(project.getProjectState().modules[moduleKey].folios[0].dirty,true)
    assert.equal((await project.artifactSources(moduleKey,'a'))[0].current,false)
    project.writeFolioState(moduleKey,'a',{...changed,density:'compact'})
    assert.equal(project.getProjectState().modules[moduleKey].folios[0].dirty,true,'layout must not clear pre-existing staleness')
    assert.equal(project.inputsChanged(presented,{...presented,_sourceFingerprint:'source-b'},moduleKey),true,'source fingerprints remain scientific inputs')
  }
  for (const moduleKey of ['systemDefinition','reliabilityProgram']) {
    const before={model:{id:'s',definitions:[{id:'a',name:'Assembly'}],diagrams:[{nodes:[{id:'a',x:0,y:0}]}]},
      analyses:[{id:'a',interfaces:[{id:'ab',source:'a',target:'b'}],block_diagram:{density:'comfortable',nodes:[]}}]}
    const after=structuredClone(before);after.model.diagrams[0].nodes[0].x=200;after.analyses[0].block_diagram.density='expanded'
    assert.equal(project.inputsChanged(before,after,moduleKey),false)
    const changed=structuredClone(after);changed.analyses[0].interfaces[0].target='c'
    assert.equal(project.inputsChanged(before,changed,moduleKey),true)
  }

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

    // Switch projects while the real export broker awaits WebCrypto. Neither
    // the prepared download nor its ledger entry may land in the new project.
    globalThis.localStorage = { getItem: () => 'true' }
    project.newProject('Artifact checksum origin')
    const originalDigest = crypto.subtle.digest
    let releaseDigest
    let enteredDigest
    const digestGate = new Promise(resolve => { releaseDigest = resolve })
    const digestStarted = new Promise(resolve => { enteredDigest = resolve })
    crypto.subtle.digest = async (...args) => {
      enteredDigest()
      await digestGate
      return originalDigest.apply(crypto.subtle, args)
    }
    try {
      const pending = artifact.downloadArtifact(new Uint8Array([1, 2, 3]),
        'origin.bin', 'application/octet-stream', { kind: 'test-race', sources: [] })
      await digestStarted
      project.newProject('New project during checksum')
      releaseDigest()
      await assert.rejects(pending, /project changed.*Restart/s)
      assert.equal(downloadedNames.length, urls.length, 'a switched project must cancel the download')
      assert.deepEqual(project.getProjectState().exportLedger, [], 'the new project must not inherit an export record')
    } finally {
      releaseDigest()
      crypto.subtle.digest = originalDigest
    }
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
  await closeViteTestServer(vite, cacheDir, hmrServer)
}
