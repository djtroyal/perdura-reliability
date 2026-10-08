import { expect } from '@playwright/test'

async function expectLocked(page, boundary, calculationRequests) {
  await expect(boundary).toHaveAttribute('aria-hidden', 'true')
  await expect(boundary).toHaveAttribute('inert', '')
  await expect(boundary).toHaveCSS('pointer-events', 'none')
  await expect(boundary).toHaveCSS('opacity', '0.6')
  // Sequential navigation must stay outside the locked app. Native inert also
  // prevents scripts from focusing a control that Enter could then activate.
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[data-server-compatibility]') === null)).toBe(true)
  }
  await page.evaluate(() => document.activeElement?.blur())
  const about = page.getByRole('button', { name: 'About Perdura', includeHidden: true })
  await about.focus()
  await expect(about).not.toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'About Perdura', includeHidden: true })).toHaveCount(0)
  const priorRequests = calculationRequests()
  await page.keyboard.press('ControlOrMeta+Enter')
  await page.keyboard.press('ControlOrMeta+k')
  // Observe asynchronous shortcut effects as well as the immediate DOM state.
  await page.waitForTimeout(200)
  expect(calculationRequests()).toBe(priorRequests)
  await expect(page.getByRole('dialog', { name: 'Command palette', includeHidden: true })).toHaveCount(0)
}

// Exercise the real boundary and stylesheet in every qualified browser engine.
// Version responses are controlled, and dispatched calculations are intercepted
// so these interaction checks never perform backend work.
export async function verifyServerCompatibilityBoundary(context, baseUrl) {
  const identity = {
    api_contract: 1,
    minimum_client_api_contract: 1,
    maximum_client_api_contract: 1,
  }
  const results = []
  for (const scenario of ['compatible', 'refresh', 'incompatible', 'unavailable']) {
    const page = await context.newPage()
    let releaseCheck
    const delayedCheck = new Promise(resolve => { releaseCheck = resolve })
    let recovering = false
    let calculationRequests = 0
    try {
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, route => route.abort())
      await page.route('**/api/v1/life-data/fit/stream', async route => {
        calculationRequests++
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Browser interaction fixture"}' })
      })
      await page.route('**/api/v1/version?*', async route => {
        await delayedCheck
        const body = recovering || scenario === 'compatible' ? identity
          : scenario === 'refresh' ? { ...identity, version: '0.0.0' }
            : scenario === 'incompatible' ? {
              api_contract: 2,
              minimum_client_api_contract: 2,
              maximum_client_api_contract: 2,
            } : { error: 'Version service unavailable' }
        await route.fulfill({
          status: !recovering && scenario === 'unavailable' ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      })
      await page.goto(`${baseUrl}/?perduraShowcase=1&module=life-data`, {
        waitUntil: 'domcontentloaded', timeout: 60_000,
      })
      const boundary = page.locator('[data-server-compatibility]')
      await page.locator('[data-perdura-showcase="ready"]').waitFor({ timeout: 60_000 })
      // The primary action would be runnable if the compatibility gate leaked.
      await expect(page.locator('[data-shortcut-primary]')).not.toBeDisabled()
      await expect(page.getByRole('heading', { name: 'Checking the Perdura server…' })).toBeVisible()
      await expectLocked(page, boundary, () => calculationRequests)
      releaseCheck()

      if (scenario === 'incompatible' || scenario === 'unavailable') {
        await expect(page.getByRole('heading', {
          name: scenario === 'incompatible'
            ? 'This Perdura tab is out of date'
            : 'Server compatibility is not available',
          exact: true,
        })).toBeVisible()
        await expect(boundary).toHaveAttribute('data-server-compatibility', 'blocked')
        await expectLocked(page, boundary, () => calculationRequests)
        recovering = true
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
      }

      await expect(boundary).toHaveAttribute('data-server-compatibility', 'ready')
      await expect(boundary).not.toHaveAttribute('aria-hidden', 'true')
      await expect(boundary).not.toHaveAttribute('inert', '')
      await expect(boundary).toHaveCSS('pointer-events', 'auto')
      await expect(boundary).toHaveCSS('opacity', '1')
      if (scenario === 'refresh') {
        await expect(page.getByRole('heading', { name: 'A compatible server update is available' })).toBeVisible()
        await page.getByRole('button', { name: 'Later', exact: true }).click()
        await expect(boundary).toHaveCSS('opacity', '1')
      }
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toHaveCount(0)
      const calculation = page.waitForRequest(request => request.url().endsWith('/api/v1/life-data/fit/stream'))
      await page.keyboard.press('ControlOrMeta+Enter')
      await calculation
      await expect.poll(() => calculationRequests).toBe(1)
      const about = page.getByRole('button', { name: 'About Perdura', exact: true })
      await about.focus()
      await expect(about).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog', { name: 'About Perdura', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      results.push({ id: scenario, status: 'passed' })
    } finally {
      releaseCheck()
      await page.close()
    }
  }
  return results
}
