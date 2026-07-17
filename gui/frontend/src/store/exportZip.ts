/**
 * Export ALL project assets as a single .zip, foldered by
 * module / group(folio·analysis) / asset. Plots are rendered off-screen to PNG +
 * SVG and also emitted as standalone interactive HTML; tables and metrics become
 * CSV. A results-included project.json is added at the root for round-trip
 * re-import. Fully client-side (no backend), reusing the same `enumerateAssets`
 * layer the Report Builder uses and the slim Plotly bundle.
 */
import Papa from 'papaparse'
import { escapeHtmlText, jsonForInlineScript } from '../components/shared/htmlSafety'
import Plotly from '../components/shared/plotly'
import { enumerateAssets, type AssetDescriptor, type AssetData } from './assetExtractors'
import { buildExport, getProjectState } from './project'

export interface ZipProgress { done: number; total: number; label: string }
export interface ZipResult { assets: number; files: number; skipped: number }

// ---- filesystem-safe path helpers ------------------------------------------

function sanitize(seg: string): string {
  return (seg || 'untitled')
    .replace(/[\\/:*?"<>|]+/g, ' ')     // illegal path chars
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')                 // no leading dots
    .slice(0, 80) || 'untitled'
}

/** Reserve a unique path within the archive (append " (2)", " (3)" on clashes). */
function uniquePath(used: Set<string>, base: string, ext: string): string {
  let candidate = `${base}.${ext}`
  let n = 2
  while (used.has(candidate.toLowerCase())) candidate = `${base} (${n++}).${ext}`
  used.add(candidate.toLowerCase())
  return candidate
}

// ---- data URL / string → bytes ---------------------------------------------

function dataUrlToBytes(url: string): Uint8Array {
  const comma = url.indexOf(',')
  const meta = url.slice(0, comma)
  const data = url.slice(comma + 1)
  if (meta.includes(';base64')) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  }
  return new TextEncoder().encode(decodeURIComponent(data))
}

const enc = (s: string) => new TextEncoder().encode(s)

/** Standalone, fully interactive HTML for one figure (mirrors ExportablePlot). */
function plotToHtml(data: unknown, layout: unknown, title: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${escapeHtmlText(title)}</title>`,
    '<script src="https://cdn.plot.ly/plotly-3.7.0.min.js" charset="utf-8"></' + 'script>',
    '<style>html,body{margin:0;height:100%}#p{width:100vw;height:100vh}</style>',
    '</head><body><div id="p"></div><script>',
    `Plotly.newPlot("p",${jsonForInlineScript(data)},${jsonForInlineScript(layout)},{responsive:true,scrollZoom:true,displaylogo:false,edits:{legendPosition:true,annotationPosition:true,annotationText:true,shapePosition:true},modeBarButtonsToAdd:["drawline","drawrect","drawcircle","eraseshape"]});`,
    '</' + 'script></body></html>',
  ].join('\n')
}

// ---- per-asset renderers ----------------------------------------------------

const RW = 900, RH = 560

/** Render a plot asset off-screen and return png/svg/html bytes. */
async function renderPlot(data: AssetData, title: string):
    Promise<{ png: Uint8Array; svg: Uint8Array; html: Uint8Array }> {
  const tmp = document.createElement('div')
  tmp.style.cssText = `position:fixed;left:-9999px;top:0;width:${RW}px;height:${RH}px`
  document.body.appendChild(tmp)
  try {
    const layout = { ...(data.plotLayout as object), width: RW, height: RH,
      paper_bgcolor: 'white', plot_bgcolor: 'white' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const P = Plotly as any
    await P.newPlot(tmp, data.plotData, layout, { staticPlot: true })
    const pngUrl: string = await P.toImage(tmp, { format: 'png', width: RW, height: RH, scale: 2 })
    const svgUrl: string = await P.toImage(tmp, { format: 'svg', width: RW, height: RH })
    return {
      png: dataUrlToBytes(pngUrl),
      svg: dataUrlToBytes(svgUrl),
      html: enc(plotToHtml(data.plotData, data.plotLayout, title)),
    }
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { (Plotly as any).purge(tmp) } catch { /* ignore */ }
    tmp.remove()
  }
}

function tableCsv(data: AssetData): Uint8Array | null {
  if (data.tableHeaders && data.tableRows) {
    return enc(Papa.unparse({ fields: data.tableHeaders, data: data.tableRows }))
  }
  if (data.metrics && data.metrics.length) {
    return enc(Papa.unparse({ fields: ['Metric', 'Value'], data: data.metrics.map(m => [m.label, m.value]) }))
  }
  return null
}

// ---- main -------------------------------------------------------------------

/**
 * Build the assets archive and trigger a download. Returns a summary. Assets
 * whose render throws are skipped (counted) rather than aborting the whole zip.
 */
export async function exportProjectZip(onProgress?: (p: ZipProgress) => void): Promise<ZipResult> {
  const assets: AssetDescriptor[] = enumerateAssets()
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  let skipped = 0

  const total = assets.length
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i]
    onProgress?.({ done: i, total, label: `${a.moduleLabel} · ${a.label}` })
    const folder = `${sanitize(a.moduleLabel)}/${sanitize(a.group)}`
    const base = `${folder}/${sanitize(a.label)}`
    try {
      const data = a.getData()
      if (a.type === 'plot' && data.plotData) {
        const { png, svg, html } = await renderPlot(data, a.label)
        files[uniquePath(used, base, 'png')] = png
        files[uniquePath(used, base, 'svg')] = svg
        files[uniquePath(used, base, 'html')] = html
      } else {
        const csv = tableCsv(data)
        if (csv) files[uniquePath(used, base, 'csv')] = csv
        else skipped++
      }
    } catch {
      skipped++
    }
    // Yield to the event loop so the UI can paint progress.
    await new Promise(r => setTimeout(r, 0))
  }

  // Round-trip project file (results included) at the archive root.
  files['project.json'] = enc(JSON.stringify(buildExport(undefined, true), null, 2))

  onProgress?.({ done: total, total, label: 'Compressing…' })
  const { zipSync } = await import('fflate')
  const zipped = zipSync(files, { level: 6 })
  // Copy into a fresh ArrayBuffer-backed view so the Blob gets a clean buffer.
  const blob = new Blob([zipped.slice()], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const name = sanitize(getProjectState().projectName || 'project')
  a.href = url
  a.download = `${name}_assets.zip`
  a.click()
  URL.revokeObjectURL(url)

  return { assets: total, files: Object.keys(files).length, skipped }
}
