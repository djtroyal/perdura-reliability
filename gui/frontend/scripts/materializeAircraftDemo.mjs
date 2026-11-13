#!/usr/bin/env node
/** Rebuild linked example views through the same canonical adapters as the app. */
import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adaptAircraftDemo } from './adaptAircraftDemo.mjs'
import { LAYOUT_PROFILES } from '../src/components/shared/adaptiveDiagramLayout.mjs'

let input = ''
for await (const chunk of process.stdin) input += chunk
const demo = JSON.parse(input)
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-aircraft-authoring-'))
const hmr = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname, cacheDir, logLevel: 'silent', appType: 'custom',
  plugins: [{ name: 'aircraft-authoring-ssr', enforce: 'post', config(config) {
    config.optimizeDeps = { ...config.optimizeDeps, noDiscovery: true, include: [] }
  } }],
  server: { middlewareMode: true, ws: { server: hmr } },
})
try {
  const { materializeFmeaAnalysis } = await vite.ssrLoadModule('/src/store/sharedFmeaModel.ts')
  const { systemInputFingerprint, validateProjectSystem } = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const { inspectArchitectureCompleteness } = await vite.ssrLoadModule('/src/store/systemArchitecture.ts')
  const next = adaptAircraftDemo(demo, { materializeFmeaAnalysis, systemInputFingerprint, layoutProfiles: LAYOUT_PROFILES })
  validateProjectSystem(next.modules.systemDefinition.model)
  const findings = inspectArchitectureCompleteness(next.modules.systemDefinition.model)
  if (findings.length) throw new Error(`Aircraft model is incomplete: ${JSON.stringify(findings)}`)
  process.stdout.write(JSON.stringify(next))
} finally {
  await vite.close(); hmr.close()
  await rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
