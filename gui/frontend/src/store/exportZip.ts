import { captureProjectExportOrigin, assertProjectExportOrigin } from './exportSnapshot'
/**
 * Export ALL project assets as a single .zip, foldered by
 * module / group(folio·analysis) / asset. Plots are rendered off-screen to PNG +
 * SVG and also emitted as standalone interactive HTML; tables and metrics become
 * CSV. A results-included project.json is added at the root for round-trip
 * re-import. Fully client-side (no backend), reusing the same `enumerateAssets`
 * layer the Report Builder uses and the slim Plotly bundle.
 */
import Papa from 'papaparse'
import { buildInteractivePlotHtml } from '../components/shared/plotHtml'
import Plotly from '../components/shared/plotly'
import { enumerateAssets, type AssetDescriptor, type AssetData } from './assetExtractors'
import { artifactSources, buildExport } from './project'
import { downloadArtifact } from './artifactExport'

export interface ZipProgress { done: number; total: number; label: string }
export interface ZipResult { assets: number; files: number; skipped: number; complete: boolean; failedAssets: { assetId: string; label: string; error: string }[] }

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
      html: enc(buildInteractivePlotHtml(data.plotData, data.plotLayout, title)),
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
  // Flush editors and freeze both the project and every asset before asynchronous rendering.
  const project = JSON.parse(JSON.stringify(buildExport(undefined, true)))
  const origin = captureProjectExportOrigin()
  const assets: AssetDescriptor[] = enumerateAssets()
  const captured = assets.map(asset => {
    try { return { data: JSON.parse(JSON.stringify(asset.getData())) as AssetData } }
    catch (error) { return { error } }
  })
  const sources = (await artifactSources()).map(source => source.moduleKey === 'faultTree' ? { ...source,
    current: source.current && assets.some(asset => asset.module === 'faultTree' && asset.analysisId === source.analysisId
      && asset.source?.resultStatus === 'current') } : source)
  assertProjectExportOrigin(origin)
  const failedAssets: ZipResult['failedAssets'] = []
  const records: { assetId: string; source: AssetDescriptor['source']; status: 'complete' | 'failed'; files: string[] }[] = []
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  let skipped = 0

  const total = assets.length
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i]
    onProgress?.({ done: i, total, label: `${a.moduleLabel} · ${a.label}` })
    const folder = `${sanitize(a.moduleLabel)}/${sanitize(a.group)}${a.source?.analysisId ? ` [${sanitize(a.source.analysisId)}]` : ''}`
    const base = `${folder}/${sanitize(a.label)}`
    const record = { assetId: a.id, source: a.source, status: 'complete' as 'complete' | 'failed', files: [] as string[] }
    const priorFiles = new Set(Object.keys(files))
    try {
      if ('error' in captured[i]) throw captured[i].error
      const data = captured[i].data!
      files[uniquePath(used, base, 'source.json')] = enc(JSON.stringify({ source: a.source, capturedAt: project.exported }, null, 2))
      if (a.type === 'plot' && data.plotData) {
        const { png, svg, html } = await renderPlot(data, a.label)
        files[uniquePath(used, base, 'png')] = png
        files[uniquePath(used, base, 'svg')] = svg
        files[uniquePath(used, base, 'html')] = html
      } else if (a.type === 'diagram' && data.diagramState) {
        const { renderFtaDiagram } = await import('../components/FaultTree/ReadOnlyFaultTreeDiagram')
        const rendered = await renderFtaDiagram(data.diagramState, a.label, data.diagramShowResults, data.diagramTreeNames)
        files[uniquePath(used, base, 'png')] = dataUrlToBytes(rendered.dataUrl)
        files[uniquePath(used, base, 'svg')] = dataUrlToBytes(rendered.svgDataUrl)
      } else {
        const csv = tableCsv(data)
        if (csv) files[uniquePath(used, base, 'csv')] = csv
        else throw new Error('No supported data supplied for this asset.')
      }
    } catch (error) {
      skipped++
      record.status = 'failed'
      failedAssets.push({ assetId: a.id, label: a.label, error: error instanceof Error ? error.message : String(error) })
    }
    record.files = Object.keys(files).filter(path => !priorFiles.has(path))
    records.push(record)
    // Yield to the event loop so the UI can paint progress.
    await new Promise(r => setTimeout(r, 0))
  }

  // Round-trip project file (results included) at the archive root.
  files['project.json'] = enc(JSON.stringify(project, null, 2))

  files['manifest.json'] = enc(JSON.stringify({ schemaVersion: 1, complete: skipped === 0, capturedAt: project.exported,
    assets: records, failedAssets, files: [...Object.keys(files), 'manifest.json'] }, null, 2))
  onProgress?.({ done: total, total, label: 'Compressing…' })
  const { zipSync } = await import('fflate')
  const zipped = zipSync(files, { level: 6 })
  const name = sanitize(project.project || 'project')
  assertProjectExportOrigin(origin)
  await downloadArtifact(zipped, `${name}_assets${skipped ? '_incomplete' : ''}.zip`, 'application/zip', {
    kind: 'project-assets', title: project.project, sources,
  })

  return { assets: total, files: Object.keys(files).length, skipped, complete: skipped === 0, failedAssets }
}
