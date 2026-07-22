#!/usr/bin/env node

import { chromium } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { zipSync } from 'fflate'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdir, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  captures, EMPTY_RESULT_PATTERN, VIEWPORT, WEBSITE_RESOURCE_SCHEMA,
} from './captures.mjs'
import { withTransientCaptureRetry } from './capture-retry.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '..')
const root = resolve(frontend, '..', '..')
const args = process.argv.slice(2)
const option = (name, fallback = null) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
// CLI paths are repository-root relative even though npm executes this script
// with gui/frontend as the process working directory.
const outDir = resolve(root, option('--output', 'build/website-resources'))
const baselineDir = option('--baseline') ? resolve(root, option('--baseline')) : null
const baseUrl = option('--base-url', 'http://127.0.0.1:4173')
const screenshotsDir = resolve(outDir, 'screenshots')
const diffsDir = resolve(outDir, 'diffs')
const failuresDir = resolve(outDir, 'failures')
const demoPath = resolve(frontend, 'src', 'data', 'demoProject.json')
const fixtureIndexPath = resolve(frontend, 'public', 'website-showcase', 'index.json')
const packageJson = JSON.parse(await readFile(resolve(frontend, 'package.json'), 'utf8'))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))

await rm(outDir, { recursive: true, force: true })
await Promise.all([screenshotsDir, diffsDir, failuresDir].map(path => mkdir(path, { recursive: true })))

let preview = null
if (!option('--base-url')) {
  preview = spawn(
    resolve(frontend, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'),
    ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { cwd: frontend, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  let previewExit = null
  preview.stdout.on('data', data => { output += data })
  preview.stderr.on('data', data => { output += data })
  preview.on('error', error => { output += `\n${error.stack ?? error}`; previewExit = 'spawn-error' })
  preview.on('exit', code => { previewExit = code })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) break
    } catch { /* server is still starting */ }
    if (previewExit != null || attempt === 79) throw new Error(`Vite preview did not start.\n${output}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
}

const launchContext = async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce',
  })
  return { browser, context }
}
let { browser, context } = await launchContext()

const records = []
const differences = []
const warnings = []

async function applyAction(page, action) {
  const command = typeof action === 'string' ? { tab: action } : action
  if (command.tab) {
    const locator = page.locator(`[data-tab-id="${command.tab}"]:visible`).last()
    await locator.waitFor({ state: 'visible', timeout: 15_000 })
    await locator.scrollIntoViewIfNeeded()
    await locator.click({ modifiers: command.modifiers ?? [] })
  } else if (command.select) {
    await page.locator(command.select).selectOption(command.value)
  } else if (command.click) {
    await page.locator(command.click).click()
  } else {
    throw new Error(`Unsupported capture action: ${JSON.stringify(command)}`)
  }
  await page.waitForTimeout(120)
}

async function loadShowcaseFixture(page, captureId) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForFunction(() => typeof window.__PERDURA_LOAD_SHOWCASE__ === 'function')
      return await page.evaluate(id => window.__PERDURA_LOAD_SHOWCASE__?.(id), captureId)
    } catch (error) {
      lastError = error
      if (!/Execution context was destroyed|navigation/i.test(String(error))) throw error
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.locator('[data-perdura-showcase="ready"]').waitFor({ timeout: 30_000 })
    }
  }
  throw lastError
}

async function renderCapturePage(capture) {
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.route('**/api/v1/version', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      version: packageJson.version, commit: process.env.GITHUB_SHA ?? 'website-capture', built_at: 'capture',
    }),
  }))
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, route => route.abort())
  try {
    const url = `${baseUrl}/?perduraShowcase=1&module=${encodeURIComponent(capture.module)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.locator('[data-perdura-showcase="ready"]').waitFor({ timeout: 30_000 })
    await page.addStyleTag({ content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      [data-perdura-showcase] { scroll-behavior: auto !important; }
    ` })
    if (capture.resultRequired && capture.fixtureFirst) {
      const loaded = await loadShowcaseFixture(page, capture.fixtureId ?? capture.id)
      if (!loaded) throw new Error(`${capture.id}: completed-analysis fixture did not load`)
      await page.waitForTimeout(250)
    }
    for (const action of capture.actions) await applyAction(page, action)
    if (capture.resultRequired && !capture.skipFixture && !capture.fixtureFirst) {
      const loaded = await loadShowcaseFixture(page, capture.fixtureId ?? capture.id)
      if (!loaded) throw new Error(`${capture.id}: completed-analysis fixture did not load`)
      await page.waitForTimeout(250)
    }
    await page.evaluate(async () => { await document.fonts?.ready })
    await page.waitForTimeout(350)
    if (await page.getByText('Something went wrong', { exact: false }).count()) {
      throw new Error(`${capture.id}: an application error boundary is visible`)
    }
    if (capture.resultRequired) {
      const emptyMessages = page.getByText(EMPTY_RESULT_PATTERN)
      for (let index = 0; index < await emptyMessages.count(); index += 1) {
        const message = emptyMessages.nth(index)
        if (await message.isVisible().catch(() => false)) {
          throw new Error(`${capture.id}: completed-analysis capture still shows: ${(await message.innerText()).trim()}`)
        }
      }
    }
    const target = resolve(screenshotsDir, capture.file)
    const screenshotOptions = { path: target, animations: 'disabled', caret: 'hide' }
    if (capture.frame === 'viewport') await page.screenshot(screenshotOptions)
    else await page.locator(capture.frame.selector).screenshot(screenshotOptions)
    return consoleErrors
  } catch (error) {
    await page.screenshot({ path: resolve(failuresDir, `${capture.id}.png`), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await page.close()
  }
}

function pngQuality(data, capture) {
  const image = PNG.sync.read(data)
  if (image.width < 320 || image.height < 240) throw new Error(`${capture.id}: PNG is implausibly small`)
  let samples = 0
  let sum = 0
  let sumSquares = 0
  const stride = Math.max(1, Math.floor((image.width * image.height) / 20_000))
  for (let pixel = 0; pixel < image.width * image.height; pixel += stride) {
    const index = pixel * 4
    const value = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3
    sum += value
    sumSquares += value * value
    samples += 1
  }
  const variance = sumSquares / samples - (sum / samples) ** 2
  if (variance < 8) throw new Error(`${capture.id}: PNG appears blank (variance ${variance.toFixed(2)})`)
  return { width: image.width, height: image.height, variance }
}

async function compareBaseline(record, currentData) {
  if (!baselineDir) return
  const baselinePath = resolve(baselineDir, record.file)
  let baselineData
  try { baselineData = await readFile(baselinePath) } catch { differences.push({ id: record.id, status: 'new' }); return }
  const before = PNG.sync.read(baselineData)
  const after = PNG.sync.read(currentData)
  if (before.width !== after.width || before.height !== after.height) {
    differences.push({
      id: record.id, status: 'dimensions-changed',
      before: `${before.width}x${before.height}`, after: `${after.width}x${after.height}`,
    })
    return
  }
  const diff = new PNG({ width: after.width, height: after.height })
  const changed = pixelmatch(before.data, after.data, diff.data, after.width, after.height, { threshold: 0.1 })
  if (changed > 0) {
    await writeFile(resolve(diffsDir, record.file), PNG.sync.write(diff))
    differences.push({ id: record.id, status: 'changed', changedPixels: changed,
      changedPercent: changed * 100 / (after.width * after.height) })
  } else {
    differences.push({ id: record.id, status: 'unchanged', changedPixels: 0, changedPercent: 0 })
  }
}

try {
  for (const [captureIndex, capture] of captures.entries()) {
    // Plotly/WebGL-heavy captures can retain renderer resources after a page
    // closes. Recycle Chromium periodically so a comprehensive inventory is
    // just as stable as a short local capture run.
    if (captureIndex > 0 && captureIndex % 20 === 0) {
      await context.close()
      await browser.close()
      ;({ browser, context } = await launchContext())
    }
    const consoleErrors = await withTransientCaptureRetry(
      () => renderCapturePage(capture),
      { onRetry: ({ attempt, nextAttempt }) => process.stderr.write(
        `${capture.id}: browser execution context changed during capture attempt ${attempt}; retrying with a fresh page (attempt ${nextAttempt}/3)\n`,
      ) },
    )
    const target = resolve(screenshotsDir, capture.file)
    const data = await readFile(target)
    const quality = pngQuality(data, capture)
    if (data.length > 1_000_000) throw new Error(`${capture.id}: PNG exceeds the 1 MB limit`)
    if (data.length > 400_000) warnings.push(`${capture.file}: ${(data.length / 1024).toFixed(0)} KiB`)
    const record = {
      id: capture.id, module: capture.websiteModule, group: capture.group,
      file: capture.file, title: capture.title, alt: capture.alt,
      width: quality.width, height: quality.height, order: records.length,
      primary: capture.primary, sha256: sha256(data), sizeBytes: data.length,
      frame: capture.frame,
      contentState: capture.resultRequired ? 'completed-analysis' : 'configured-context',
    }
    records.push(record)
    await compareBaseline(record, data)
    const actionableErrors = consoleErrors.filter(message => !/favicon|ERR_FAILED|Failed to fetch/i.test(message))
    if (actionableErrors.length) warnings.push(`${capture.id}: console: ${actionableErrors.join(' | ')}`)
    process.stdout.write(`captured ${capture.file} (${quality.width}x${quality.height})\n`)
  }
} finally {
  await context.close()
  await browser.close()
  if (preview) preview.kill('SIGTERM')
}

const manifest = { schema: WEBSITE_RESOURCE_SCHEMA, captures: records }
const demoData = await readFile(demoPath)
const fixtureIndexData = await readFile(fixtureIndexPath)
const provenance = {
  schema: 'perdura.website-resource-build/v1',
  generatedAt: new Date().toISOString(), product: 'Perdura', version: packageJson.version,
  sourceCommit: process.env.GITHUB_SHA ?? process.env.PERDURA_COMMIT ?? 'development',
  demoProjectSha256: sha256(demoData), showcaseFixtureIndexSha256: sha256(fixtureIndexData), viewport: VIEWPORT,
  browser: 'playwright-chromium', captures: records.length, warnings, differences,
}
await writeFile(resolve(outDir, 'screenshots.generated.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(resolve(outDir, 'build-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
await writeFile(resolve(outDir, 'diff-report.json'), `${JSON.stringify({ differences }, null, 2)}\n`)

const cards = records.map(record => {
  const diff = differences.find(item => item.id === record.id)
  return `<article><h2>${escapeHtml(record.title)}</h2><p>${escapeHtml(record.module)} · ${escapeHtml(record.group)} · ${escapeHtml(diff?.status ?? 'not compared')}</p><img loading="lazy" src="screenshots/${encodeURIComponent(record.file)}" alt="${escapeHtml(record.alt)}"></article>`
}).join('\n')
await writeFile(resolve(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Perdura website resources</title><style>body{font:14px system-ui;margin:24px;background:#f8fafc;color:#172033}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}article{background:white;border:1px solid #dbe3ee;border-radius:10px;padding:12px}h1{margin:0 0 6px}h2{font-size:15px;margin:0}p{color:#64748b;margin:4px 0 10px}img{width:100%;height:auto;border:1px solid #e5e7eb}</style><h1>Perdura website screenshot review</h1><p>${records.length} deterministic captures</p><main>${cards}</main>`)

const filesForChecksum = []
async function collect(path) {
  for (const name of await readdir(path)) {
    const full = resolve(path, name)
    const info = await stat(full)
    if (info.isDirectory()) await collect(full)
    else if (name !== 'SHA256SUMS' && !name.endsWith('.zip')) filesForChecksum.push(full)
  }
}
await collect(outDir)
const checksums = []
const archive = {}
for (const file of filesForChecksum.sort()) {
  const data = await readFile(file)
  const name = relative(outDir, file).replaceAll('\\', '/')
  checksums.push(`${sha256(data)}  ${name}`)
  archive[name] = new Uint8Array(data)
}
await writeFile(resolve(outDir, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
archive.SHA256SUMS = new TextEncoder().encode(`${checksums.join('\n')}\n`)
await writeFile(resolve(outDir, 'Perdura-website-resources.zip'), zipSync(archive, { level: 9 }))

process.stdout.write(`Generated ${records.length} website screenshots in ${outDir}\n`)
if (warnings.length) process.stdout.write(`Warnings:\n- ${warnings.join('\n- ')}\n`)
