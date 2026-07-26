import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const hmrServer = createHttpServer()
const vite = await createServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

function luminance(hex) {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map(value => Number.parseInt(value, 16) / 255)
    .map(value => value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const lighter = Math.max(luminance(a), luminance(b))
  const darker = Math.min(luminance(a), luminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

try {
  const {
    MODULE_THEMES, modulePlotColorway, moduleThemeStyle, resolveModuleTheme,
  } = await vite.ssrLoadModule('/src/components/shared/moduleThemes.ts')

  assert.equal(Object.keys(MODULE_THEMES).length, 18,
    'every top-level module, including the dashboard, must have a visual theme')

  for (const [key, theme] of Object.entries(MODULE_THEMES)) {
    assert.equal(contrast(theme.accent, '#ffffff') >= 4.5, true,
      `${key} accent must support WCAG AA normal-sized white text`)
    assert.equal(contrast(theme.text, theme.tint) >= 4.5, true,
      `${key} accent text must remain readable on its module tint`)
    assert.equal(theme.plot[0], theme.accent,
      `${key} plots must begin with the owning module accent`)
    assert.equal(new Set(theme.plot).size >= 7, true,
      `${key} plots must expose a sufficiently distinct multi-series palette`)
    const style = moduleThemeStyle(key)
    assert.equal(style['--perdura-accent'], theme.accent)
    assert.equal(style['--perdura-accent-rgb'], theme.rgb)
    assert.equal(contrast(style['--perdura-control-border'], '#ffffff') >= 3, true,
      `${key} control boundaries must meet the non-text contrast threshold`)
  }

  const tabAliases = [
    ['life-data', 'lifeData'],
    ['system-modeling', 'systemModeling'],
    ['allocation', 'reliabilityAllocation'],
    ['software-reliability', 'softwareReliability'],
    ['reliability-program', 'reliabilityProgram'],
    ['data-analysis', 'dataAnalysis'],
    ['six-sigma', 'sixSigma'],
    ['report-builder', 'reportBuilder'],
  ]
  for (const [tabId, key] of tabAliases) {
    assert.equal(resolveModuleTheme(tabId), MODULE_THEMES[key],
      `${tabId} must resolve to its store/module theme`)
  }
  assert.deepEqual(modulePlotColorway('prediction'), [...MODULE_THEMES.prediction.plot])

  console.log('Module theme and contrast contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
