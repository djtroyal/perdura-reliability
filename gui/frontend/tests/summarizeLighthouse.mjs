#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const input = resolve(option('--input', 'lighthouse.json'))
const output = resolve(option('--output', 'lighthouse-summary.json'))
const junit = resolve(option('--junit', 'junit-lighthouse.xml'))
const report = JSON.parse(await readFile(input, 'utf8'))
const thresholds = { performance: 0.65, accessibility: 0.85, 'best-practices': 0.85 }
const scores = Object.fromEntries(Object.entries(thresholds).map(([id]) => [id, report.categories[id]?.score ?? null]))
const failures = Object.entries(thresholds)
  .filter(([id, threshold]) => scores[id] == null || scores[id] < threshold)
  .map(([id, threshold]) => ({ id, score: scores[id], threshold }))
const summary = {
  schema: 'perdura.lighthouse-assurance/v1',
  generatedAt: report.fetchTime,
  lighthouseVersion: report.lighthouseVersion,
  requestedUrl: report.requestedUrl,
  finalUrl: report.finalUrl,
  status: failures.length ? 'failed' : 'passed',
  scores,
  thresholds,
  failures,
  metrics: {
    firstContentfulPaintMilliseconds: report.audits['first-contentful-paint']?.numericValue ?? null,
    largestContentfulPaintMilliseconds: report.audits['largest-contentful-paint']?.numericValue ?? null,
    totalBlockingTimeMilliseconds: report.audits['total-blocking-time']?.numericValue ?? null,
    cumulativeLayoutShift: report.audits['cumulative-layout-shift']?.numericValue ?? null,
  },
  interpretation: 'Lighthouse laboratory evidence from the recorded CI environment; scores are not field performance or WCAG conformance.',
}
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`)
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const cases = Object.entries(thresholds).map(([id, threshold]) => {
  const score = scores[id]
  const failed = score == null || score < threshold
  return `<testcase classname="lighthouse" name="${id}" time="0">${failed ? `<failure message="Score ${xml(score)} is below ${threshold}"/>` : ''}<system-out>score=${xml(score)} threshold=${threshold}</system-out></testcase>`
}).join('')
await writeFile(junit, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="lighthouse" tests="3" failures="${failures.length}" errors="0" skipped="0">${cases}</testsuite>\n`)
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (failures.length) process.exitCode = 1
