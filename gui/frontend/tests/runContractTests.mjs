import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverContractScripts, junitXml } from './contractRunnerCore.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output-dir')
const outputDir = resolve(frontendRoot, outputIndex >= 0 ? args[outputIndex + 1] : 'test-evidence/frontend')
if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output-dir requires a path')

await mkdir(resolve(outputDir, 'logs'), { recursive: true })
const scripts = await discoverContractScripts(resolve(frontendRoot, 'package.json'))
const results = []

for (const script of scripts) {
  const started = performance.now()
  const proc = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '--silent', script], {
    cwd: frontendRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: 20 * 1024 * 1024,
  })
  const output = [proc.stdout, proc.stderr, proc.error?.stack].filter(Boolean).join('\n').trim()
  const status = proc.status === 0 ? 'passed' : 'failed'
  const durationSeconds = (performance.now() - started) / 1000
  const result = { script, status, exitCode: proc.status, signal: proc.signal, durationSeconds, output }
  results.push(result)
  await writeFile(resolve(outputDir, 'logs', `${script.replaceAll(':', '-')}.log`), `${output}\n`, 'utf8')
  process.stdout.write(`${status === 'passed' ? 'PASS' : 'FAIL'} ${script} (${durationSeconds.toFixed(2)}s)\n`)
  if (status === 'failed' && output) process.stdout.write(`${output}\n`)
}

const totals = {
  total: results.length,
  passed: results.filter(result => result.status === 'passed').length,
  failed: results.filter(result => result.status === 'failed').length,
  durationSeconds: results.reduce((total, result) => total + result.durationSeconds, 0),
}
await writeFile(resolve(outputDir, 'frontend-contracts.json'), `${JSON.stringify({
  schema: 'perdura.frontend-contract-results/v1',
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  totals,
  results,
}, null, 2)}\n`, 'utf8')
await writeFile(resolve(outputDir, 'junit-frontend.xml'), junitXml(results), 'utf8')

process.stdout.write(`Frontend contracts: ${totals.passed}/${totals.total} passed.\n`)
process.exitCode = totals.failed > 0 ? 1 : 0
