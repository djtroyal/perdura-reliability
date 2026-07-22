import { readFile } from 'node:fs/promises'

export const CONTRACT_RUNNER_SCRIPT = 'test:contracts'

export async function discoverContractScripts(packagePath) {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  return Object.keys(pkg.scripts ?? {})
    .filter(name => name.startsWith('test:') && name !== CONTRACT_RUNNER_SCRIPT)
    .sort()
}

export function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function junitXml(results) {
  const failures = results.filter(result => result.status === 'failed').length
  const skipped = results.filter(result => result.status === 'skipped').length
  const duration = results.reduce((total, result) => total + result.durationSeconds, 0)
  const cases = results.map(result => {
    const body = result.status === 'failed'
      ? `<failure message="${xmlEscape(`Exit code ${result.exitCode ?? 'unknown'}`)}">${xmlEscape(result.output)}</failure>`
      : result.status === 'skipped' ? '<skipped />' : ''
    return `<testcase classname="frontend.contract" name="${xmlEscape(result.script)}" time="${result.durationSeconds.toFixed(6)}">${body}</testcase>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${results.length}" failures="${failures}" skipped="${skipped}" time="${duration.toFixed(6)}"><testsuite name="Perdura frontend contracts" tests="${results.length}" failures="${failures}" skipped="${skipped}" time="${duration.toFixed(6)}">${cases}</testsuite></testsuites>\n`
}
