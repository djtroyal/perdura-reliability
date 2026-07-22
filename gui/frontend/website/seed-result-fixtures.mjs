#!/usr/bin/env node

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captures, EMPTY_RESULT_PATTERN } from './captures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '..')
const root = resolve(frontend, '..', '..')
const backend = resolve(root, 'gui', 'backend')
const fixtureDir = resolve(frontend, 'public', 'website-showcase')
const demoPath = resolve(frontend, 'src', 'data', 'demoProject.json')
const args = process.argv.slice(2)
const option = (name, fallback = null) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const baseUrl = option('--base-url', 'http://127.0.0.1:4173')
const apiUrl = option('--api-url', 'http://127.0.0.1:8000')
const managedServers = !option('--base-url')
const resume = args.includes('--resume')
const refreshId = option('--refresh')
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function waitForUrl(url, process, label) {
  let output = ''
  process?.stdout?.on('data', data => { output += data })
  process?.stderr?.on('data', data => { output += data })
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* still starting */ }
    if (process?.exitCode != null || attempt === 159) {
      throw new Error(`${label} did not start.\n${output}`)
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
}

async function applyAction(page, action) {
  const command = typeof action === 'string' ? { tab: action } : action
  if (command.tab) {
    const locator = page.locator(`[data-tab-id="${command.tab}"]:visible`).last()
    await locator.waitFor({ state: 'visible', timeout: 20_000 })
    await locator.click({ modifiers: command.modifiers ?? [] })
  } else if (command.select) {
    await page.locator(command.select).selectOption(command.value)
  } else if (command.click) {
    await page.locator(command.click).click()
  } else if (command.fill) {
    await page.locator(command.fill).last().fill(command.value)
  } else {
    throw new Error(`Unsupported seed action: ${JSON.stringify(command)}`)
  }
  await page.waitForTimeout(150)
}

async function visibleEmptyMessages(page) {
  const candidates = page.getByText(EMPTY_RESULT_PATTERN)
  const messages = []
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index)
    if (await candidate.isVisible().catch(() => false)) messages.push((await candidate.innerText()).trim())
  }
  return [...new Set(messages)]
}

const demo = JSON.parse(await readFile(demoPath, 'utf8'))
if (!resume) await rm(fixtureDir, { recursive: true, force: true })
await mkdir(fixtureDir, { recursive: true })

let apiProcess = null
let previewProcess = null
if (managedServers) {
  apiProcess = spawn('uv', [
    'run', '--no-sync', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000',
  ], { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitForUrl(`${apiUrl}/api/v1/version`, apiProcess, 'Perdura API')
  previewProcess = spawn(
    resolve(frontend, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'),
    ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { cwd: frontend, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await waitForUrl(baseUrl, previewProcess, 'Vite preview')
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 2280, height: 1365 }, deviceScaleFactor: 1,
  locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce',
})
const records = []

try {
  for (const capture of captures.filter(item => item.resultRequired)) {
    if (resume && capture.id !== refreshId) {
      try {
        const data = await readFile(resolve(fixtureDir, `${capture.id}.json`), 'utf8')
        const parsed = JSON.parse(data)
        records.push({ id: capture.id, modules: Object.keys(parsed.modules ?? {}), sha256: sha256(data) })
        process.stdout.write(`retained ${capture.id}\n`)
        continue
      } catch { /* missing or invalid: regenerate */ }
    }
    const page = await context.newPage()
    const failedResponses = []
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        failedResponses.push(`${response.status()} ${response.url()}`)
      }
    })
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, route => route.abort())
    try {
      const url = `${baseUrl}/?perduraShowcase=1&perduraSeedShowcase=1&module=${encodeURIComponent(capture.module)}`
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.locator('[data-perdura-showcase="ready"]').waitFor({ timeout: 30_000 })
      await page.waitForFunction(() => typeof window.__PERDURA_EXPORT_SHOWCASE__ === 'function')
      for (const action of capture.actions) await applyAction(page, action)
      for (const action of capture.seedActions ?? []) await applyAction(page, action)

      // Some analysis views are intentionally absent from the general demo;
      // their registry entry opts into the reviewed method-specific example.
      const example = page.getByText(/Load example/i).filter({ visible: true }).last()
      if (capture.seedExample && await example.count()) {
        await example.click()
        const confirmExample = page.locator('.fixed.inset-0 button').getByText(/Load example/i).last()
        if (await confirmExample.isVisible().catch(() => false)) await confirmExample.click()
        await page.waitForTimeout(150)
      }

      if (!capture.skipRun) {
        const runButton = page.locator('[data-shortcut-primary]:visible').last()
        await runButton.waitFor({ state: 'visible', timeout: 20_000 })
        if (await runButton.isDisabled()) throw new Error(`${capture.id}: primary analysis action is disabled`)
        await runButton.click()
        await page.waitForFunction(() => {
          const buttons = [...document.querySelectorAll('[data-shortcut-primary]')]
            .filter(button => button instanceof HTMLElement && button.offsetParent !== null)
          return buttons.length > 0 && buttons.every(button => {
            const text = button.textContent ?? ''
            return !(button instanceof HTMLButtonElement && button.disabled)
              && !/loading|running|computing|analyzing|fitting|generating|simulating/i.test(text)
          })
        }, null, { timeout: 240_000 })
        await page.waitForTimeout(500)
      }

      if (failedResponses.length) throw new Error(`${capture.id}: ${failedResponses.join(' | ')}`)
      const emptyMessages = await visibleEmptyMessages(page)
      if (emptyMessages.length) throw new Error(`${capture.id}: empty result state remains visible: ${emptyMessages.join(' | ')}`)
      if (await page.getByText('Something went wrong', { exact: false }).count()) {
        throw new Error(`${capture.id}: application error boundary is visible`)
      }

      const exported = await page.evaluate(() => window.__PERDURA_EXPORT_SHOWCASE__?.())
      if (!exported || typeof exported !== 'object') throw new Error(`${capture.id}: state export failed`)
      let changedModules = Object.fromEntries(Object.entries(exported.modules).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(demo.modules[key])))
      if (Object.keys(changedModules).length === 0 && capture.fixtureModules?.length) {
        changedModules = Object.fromEntries(capture.fixtureModules
          .filter(key => exported.modules[key] !== undefined)
          .map(key => [key, exported.modules[key]]))
      }
      if (Object.keys(changedModules).length === 0) {
        throw new Error(`${capture.id}: analysis produced no persisted state change`)
      }
      const fixture = { ...exported, modules: changedModules }
      const data = `${JSON.stringify(fixture, null, 2)}\n`
      await writeFile(resolve(fixtureDir, `${capture.id}.json`), data)
      records.push({ id: capture.id, modules: Object.keys(changedModules), sha256: sha256(data) })
      process.stdout.write(`seeded ${capture.id}\n`)
    } catch (error) {
      await page.screenshot({ path: resolve(root, 'build', `seed-failure-${capture.id}.png`), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await page.close()
    }
  }
} finally {
  await context.close()
  await browser.close()
  previewProcess?.kill('SIGTERM')
  apiProcess?.kill('SIGTERM')
}

await writeFile(resolve(fixtureDir, 'index.json'), `${JSON.stringify({
  schema: 'perdura.website-showcase-fixtures/v1', generatedAt: new Date().toISOString(),
  demoProjectSha256: sha256(await readFile(demoPath)), captures: records,
}, null, 2)}\n`)
process.stdout.write(`Seeded ${records.length} completed-analysis fixtures in ${fixtureDir}\n`)
