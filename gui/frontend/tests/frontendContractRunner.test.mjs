import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { mock } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverContractScripts, junitXml, xmlEscape } from './contractRunnerCore.mjs'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = await mkdtemp(join(tmpdir(), 'perdura-contract-runner-'))
const packagePath = join(root, 'package.json')
await writeFile(packagePath, JSON.stringify({ scripts: {
  build: 'vite build',
  'test:z': 'node z.mjs',
  'test:contracts': 'node runner.mjs',
  'test:a': 'node a.mjs',
} }))

assert.deepEqual(await discoverContractScripts(packagePath), ['test:a', 'test:z'])
assert.equal(xmlEscape('<failure token="x">'), '&lt;failure token=&quot;x&quot;&gt;')
const xml = junitXml([
  { script: 'test:pass', status: 'passed', exitCode: 0, durationSeconds: 0.2, output: '' },
  { script: 'test:fail', status: 'failed', exitCode: 1, durationSeconds: 0.3, output: 'bad <value>' },
])
assert.match(xml, /tests="2" failures="1"/)
assert.match(xml, /bad &lt;value&gt;/)
assert.match(xml, /name="test:fail"/)

// Cache removal must wait for server shutdown, and teardown failures must keep
// failing the contract instead of being hidden after its assertions pass.
let releaseClose
let hmrClosed = false
const closing = closeViteTestServer({ close: () => new Promise(resolve => { releaseClose = resolve }) },
  root, { close: () => { hmrClosed = true } })
await fs.access(packagePath)
assert.equal(hmrClosed, false)
releaseClose()
await closing
assert.equal(hmrClosed, true)
await assert.rejects(fs.access(root), { code: 'ENOENT' })

const removalFailure = Object.assign(new Error('persistent cache writer'), { code: 'ENOTEMPTY' })
const remove = mock.method(fs, 'rm', async () => { throw removalFailure })
try {
  hmrClosed = false
  await assert.rejects(closeViteTestServer({ close: async () => {} }, root,
    { close: () => { hmrClosed = true } }), error => error === removalFailure)
  assert.equal(hmrClosed, true, 'HMR shutdown must survive a cache-removal failure')
  assert.equal(remove.mock.callCount(), 1, 'the helper must not add an unbounded retry loop')
  const options = remove.mock.calls[0].arguments[1]
  assert.ok(Number.isInteger(options.maxRetries) && options.maxRetries > 0 && options.maxRetries <= 5)
  assert.ok(options.retryDelay > 0 && options.retryDelay <= 100)

  const closeFailure = new Error('server shutdown failed')
  hmrClosed = false
  await assert.rejects(closeViteTestServer({ close: async () => { throw closeFailure } }, root,
    { close: () => { hmrClosed = true } }), error => error === closeFailure)
  assert.equal(hmrClosed, true, 'HMR must close even if Vite shutdown fails')
  assert.equal(remove.mock.callCount(), 1, 'never remove a cache before successful Vite shutdown')
} finally {
  remove.mock.restore()
}

console.log('Frontend contract runner contracts passed')
