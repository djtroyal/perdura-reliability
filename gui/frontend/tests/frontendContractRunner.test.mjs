import assert from 'node:assert/strict'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverContractScripts, junitXml, xmlEscape } from './contractRunnerCore.mjs'

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

console.log('Frontend contract runner contracts passed')
