#!/usr/bin/env node

import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const baseUrl = option('--base-url', 'http://127.0.0.1:8000')
const outputPath = resolve(option('--output', 'browser-assurance.json'))
const junitPath = resolve(option('--junit', 'junit-browser-assurance.xml'))
const defaultBaseline = fileURLToPath(new URL('../../../assurance/accessibility-baseline.json', import.meta.url))
const baselinePath = resolve(option('--baseline', defaultBaseline))
const modules = ['dashboard', 'life-data', 'prediction', 'system-modeling']
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
if (baseline.schema !== 'perdura.accessibility-baseline/v1') {
  throw new Error(`Unsupported accessibility baseline schema in ${baselinePath}`)
}
const allowances = new Map(baseline.entries.map(item => [
  `${item.module}:${item.id}:${item.impact}`,
  item.max_node_count,
]))

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  reducedMotion: 'reduce',
})
const cases = []

try {
  for (const moduleId of modules) {
    const page = await context.newPage()
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, route => route.abort())
    const started = performance.now()
    const response = await page.goto(
      `${baseUrl}/?perduraShowcase=1&module=${encodeURIComponent(moduleId)}`,
      { waitUntil: 'domcontentloaded', timeout: 60_000 },
    )
    await page.locator('[data-perdura-showcase="ready"]').waitFor({ timeout: 60_000 })
    await page.waitForTimeout(250)
    const readyMilliseconds = performance.now() - started
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0]
      return entry ? {
        domContentLoadedMilliseconds: entry.domContentLoadedEventEnd,
        loadMilliseconds: entry.loadEventEnd,
        transferBytes: entry.transferSize,
        decodedBodyBytes: entry.decodedBodySize,
      } : null
    })
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const blocking = axe.violations.filter(item => ['critical', 'serious'].includes(item.impact))
    const unbaselined = blocking.filter(item => {
      const allowance = allowances.get(`${moduleId}:${item.id}:${item.impact}`)
      return allowance == null || item.nodes.length > allowance
    })
    cases.push({
      id: moduleId,
      status: response?.ok() && unbaselined.length === 0 ? 'passed' : 'failed',
      httpStatus: response?.status() ?? null,
      readyMilliseconds,
      navigation,
      knownBlockingFindingCount: blocking.length - unbaselined.length,
      unbaselinedBlockingFindingCount: unbaselined.length,
      unbaselinedViolations: unbaselined.map(item => ({
        id: item.id,
        impact: item.impact,
        nodeCount: item.nodes.length,
        allowedNodeCount: allowances.get(`${moduleId}:${item.id}:${item.impact}`) ?? 0,
      })),
      violations: axe.violations.map(item => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        helpUrl: item.helpUrl,
        nodeCount: item.nodes.length,
        targets: item.nodes.flatMap(node => node.target.map(target => String(target))).slice(0, 20),
      })),
    })
    await page.close()
  }
} finally {
  await browser.close()
}

const failures = cases.filter(item => item.status === 'failed')
const knownFindingCount = cases.reduce((sum, item) => sum + item.knownBlockingFindingCount, 0)
const report = {
  schema: 'perdura.browser-assurance/v1',
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'failed' : knownFindingCount ? 'passed_with_known_findings' : 'passed',
  commit: process.env.GITHUB_SHA || 'unknown',
  baseUrl,
  viewport: { width: 1440, height: 900 },
  wcagTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
  baseline: {
    path: baselinePath,
    capturedAt: baseline.captured_at,
    reviewBy: baseline.review_by,
    knownBlockingFindingCount: knownFindingCount,
    interpretation: baseline.policy,
  },
  cases,
  interpretation: 'Automated axe coverage does not establish WCAG conformance; manual evaluation remains required.',
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)

const testcases = cases.map(item => {
  const detail = JSON.stringify({
    unbaselined: item.unbaselinedViolations,
    allViolations: item.violations,
  })
  const failure = item.status === 'failed'
    ? `<failure message="New or enlarged critical/serious accessibility finding">${xml(detail)}</failure>`
    : ''
  return `<testcase classname="browser-assurance" name="${xml(item.id)}" time="${(item.readyMilliseconds / 1000).toFixed(6)}">${failure}<system-out>${xml(detail)}</system-out></testcase>`
}).join('')
await writeFile(junitPath,
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="browser-assurance" tests="${cases.length}" failures="${failures.length}" errors="0" skipped="0">${testcases}</testsuite>\n`)

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failures.length) process.exitCode = 1
