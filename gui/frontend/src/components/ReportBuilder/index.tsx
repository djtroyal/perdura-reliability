import { useState, useRef, useCallback, useMemo } from 'react'
import {
  FileText, Type, AlignLeft, Minus, Columns,
  GripVertical, Trash2, ChevronDown, Download, Upload, Save,
  Image as ImageIcon, Table as TableIcon, Plus, Loader,
  RefreshCw, ChevronRight, BarChart3,
  ArrowUp, ArrowDown, ChevronsUp, ChevronsDown,
} from 'lucide-react'
import Plot from '../shared/ExportablePlot'
// @ts-expect-error -- plotly.js-dist-min ships no TS declarations
import Plotly from 'plotly.js-dist-min'
import { useModuleState } from '../../store/project'
import { enumerateAssets, AssetDescriptor } from '../../store/assetExtractors'
import jsPDF from 'jspdf'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLayout = any

interface HeadingBlock { id: string; type: 'heading'; text: string; level: 1 | 2 | 3 }
interface TextBlock { id: string; type: 'text'; content: string }
interface PlotBlock {
  id: string; type: 'plot'
  plotData: unknown[]; plotLayout: unknown
  label: string; assetId?: string
}
interface TableBlock {
  id: string; type: 'table'
  headers: string[]; rows: (string | number)[][]
  label: string
}
interface MetricsBlock {
  id: string; type: 'metrics'
  items: { label: string; value: string }[]
  label: string
}
interface DividerBlock { id: string; type: 'divider' }
interface PageBreakBlock { id: string; type: 'pagebreak' }

type ReportBlock =
  | HeadingBlock | TextBlock | PlotBlock
  | TableBlock | MetricsBlock | DividerBlock | PageBreakBlock

interface ReportState {
  title: string
  blocks: ReportBlock[]
}

const INITIAL: ReportState = { title: 'Untitled Report', blocks: [] }

let seq = 0
const newId = () => `rb_${Date.now().toString(36)}_${(seq++).toString(36)}`

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// PDF Export (block-by-block rendering for crisp output)
// ---------------------------------------------------------------------------

async function exportPDF(state: ReportState) {
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const m = 15
  const cw = pw - 2 * m
  let y = m

  const newPage = () => { pdf.addPage(); y = m }
  const ensureSpace = (needed: number) => { if (y + needed > ph - m) newPage() }

  // Title
  pdf.setFontSize(22)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(30, 64, 175)
  pdf.text(state.title || 'Report', m, y + 7)
  y += 12
  pdf.setDrawColor(59, 130, 246)
  pdf.setLineWidth(0.5)
  pdf.line(m, y, m + cw, y)
  y += 8

  for (const block of state.blocks) {
    switch (block.type) {
      case 'heading': {
        const sz = block.level === 1 ? 16 : block.level === 2 ? 13 : 11
        ensureSpace(sz * 0.5 + 6)
        pdf.setFontSize(sz)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(30, 41, 59)
        const lines = pdf.splitTextToSize(block.text || '', cw) as string[]
        lines.forEach(l => {
          ensureSpace(sz * 0.45 + 2)
          pdf.text(l, m, y + sz * 0.35)
          y += sz * 0.45
        })
        y += 4
        break
      }
      case 'text': {
        pdf.setFontSize(10.5)
        pdf.setFont('helvetica', 'normal')
        pdf.setTextColor(51, 65, 85)
        const lines = pdf.splitTextToSize(block.content || '', cw) as string[]
        lines.forEach(l => {
          ensureSpace(5)
          pdf.text(l, m, y + 3.5)
          y += 4.5
        })
        y += 3
        break
      }
      case 'plot': {
        const plotH = 85
        ensureSpace(plotH + 8)
        try {
          const tmp = document.createElement('div')
          tmp.style.cssText = 'position:fixed;left:-9999px;width:800px;height:500px'
          document.body.appendChild(tmp)
          await (Plotly as AnyLayout).newPlot(tmp, block.plotData, {
            ...(block.plotLayout as Record<string, unknown>),
            width: 800, height: 500,
            paper_bgcolor: 'white', plot_bgcolor: 'white',
          })
          const imgUrl: string = await (Plotly as AnyLayout).toImage(tmp, {
            format: 'png', width: 800, height: 500, scale: 2,
          })
          pdf.addImage(imgUrl, 'PNG', m, y, cw, plotH)
          y += plotH + 6
          ;(Plotly as AnyLayout).purge(tmp)
          tmp.remove()
        } catch {
          pdf.setFontSize(10)
          pdf.setFont('helvetica', 'italic')
          pdf.setTextColor(148, 163, 184)
          pdf.text(`[Plot: ${block.label}]`, m, y + 4)
          y += 10
        }
        break
      }
      case 'table': {
        const colW = cw / Math.max(block.headers.length, 1)
        ensureSpace(14)
        pdf.setFillColor(241, 245, 249)
        pdf.rect(m, y, cw, 6, 'F')
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(51, 65, 85)
        block.headers.forEach((h, i) => {
          pdf.text(String(h).substring(0, 24), m + i * colW + 1, y + 4)
        })
        y += 6
        pdf.setFont('helvetica', 'normal')
        pdf.setTextColor(71, 85, 105)
        block.rows.forEach(row => {
          ensureSpace(6)
          row.forEach((c, i) => {
            pdf.text(String(c).substring(0, 24), m + i * colW + 1, y + 4)
          })
          pdf.setDrawColor(229, 231, 235)
          pdf.line(m, y + 5, m + cw, y + 5)
          y += 6
        })
        y += 4
        break
      }
      case 'metrics': {
        ensureSpace(8 + block.items.length * 5.5)
        if (block.label) {
          pdf.setFontSize(9)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(51, 65, 85)
          pdf.text(block.label, m, y + 3.5)
          y += 6
        }
        pdf.setFontSize(9)
        pdf.setFont('helvetica', 'normal')
        for (const item of block.items) {
          ensureSpace(5.5)
          pdf.setTextColor(100, 116, 139)
          pdf.text(item.label + ':', m + 2, y + 3)
          pdf.setTextColor(30, 41, 59)
          pdf.text(item.value, m + 50, y + 3)
          y += 5
        }
        y += 4
        break
      }
      case 'divider': {
        ensureSpace(6)
        pdf.setDrawColor(203, 213, 225)
        pdf.setLineWidth(0.3)
        pdf.line(m, y + 2, m + cw, y + 2)
        y += 6
        break
      }
      case 'pagebreak':
        newPage()
        break
    }
  }

  // Page numbers
  const pages = (pdf as AnyLayout).internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(148, 163, 184)
    pdf.text(
      `Generated by Perdura  ·  Page ${i} of ${pages}`,
      m, ph - 6,
    )
  }

  pdf.save(`${state.title || 'report'}.pdf`)
}

// ---------------------------------------------------------------------------
// HTML Export (interactive Plotly charts)
// ---------------------------------------------------------------------------

function exportHTML(state: ReportState) {
  const blocks = state.blocks.map(b => {
    switch (b.type) {
      case 'heading': {
        const tag = `h${b.level}`
        return `<${tag}>${escHtml(b.text)}</${tag}>`
      }
      case 'text':
        return b.content.split('\n').map(p => `<p>${escHtml(p)}</p>`).join('\n')
      case 'divider':
        return '<hr>'
      case 'pagebreak':
        return '<div class="pagebreak"></div>'
      case 'plot': {
        const pid = `p_${Math.random().toString(36).slice(2, 8)}`
        return [
          `<div id="${pid}" class="plot"></div>`,
          `<script>Plotly.newPlot("${pid}",`,
          `${JSON.stringify(b.plotData)},`,
          `Object.assign(${JSON.stringify(b.plotLayout)},{responsive:true}));</${'script'}>`,
        ].join('')
      }
      case 'table': {
        const ths = b.headers.map(h => `<th>${escHtml(String(h))}</th>`).join('')
        const trs = b.rows.map(r =>
          `<tr>${r.map(c => `<td>${escHtml(String(c))}</td>`).join('')}</tr>`
        ).join('\n')
        if (b.label) {
          return `<p class="cap">${escHtml(b.label)}</p>\n<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`
        }
        return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`
      }
      case 'metrics': {
        const rows = b.items.map(i =>
          `<tr><td class="mlbl">${escHtml(i.label)}</td><td class="mval">${escHtml(i.value)}</td></tr>`
        ).join('\n')
        return (b.label ? `<p class="cap">${escHtml(b.label)}</p>\n` : '') +
          `<table class="metrics"><tbody>${rows}</tbody></table>`
      }
      default: return ''
    }
  }).join('\n')

  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${escHtml(state.title)}</title>`,
    '<script src="https://cdn.plot.ly/plotly-2.35.0.min.js" charset="utf-8"></' + 'script>',
    `<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:900px;margin:0 auto;padding:40px 24px;color:#1e293b;line-height:1.6}
h1{color:#1e40af;border-bottom:2px solid #3b82f6;padding-bottom:8px;margin-top:0}
h2{color:#1e3a5f;margin-top:32px}
h3{color:#374151;margin-top:24px}
p{margin:10px 0;color:#334155}
.plot{width:100%;height:500px;margin:24px 0}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px}
td,th{border:1px solid #e2e8f0;padding:7px 10px;text-align:left}
th{background:#f1f5f9;font-weight:600;color:#334155}
tr:nth-child(even){background:#f8fafc}
table.metrics{width:auto;min-width:320px}
table.metrics td{border:none;padding:4px 12px 4px 0}
.mlbl{color:#64748b;font-weight:500}
.mval{color:#1e293b;font-weight:600}
hr{border:none;border-top:1px solid #e2e8f0;margin:32px 0}
.cap{font-size:12px;color:#64748b;font-weight:600;margin-bottom:2px}
.pagebreak{page-break-after:always;break-after:page}
footer{margin-top:48px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8}
@media print{.pagebreak{page-break-after:always}}
</style>`,
    '</head><body>',
    `<h1>${escHtml(state.title)}</h1>`,
    blocks,
    '<footer>Generated by Perdura — Reliability Engineering and Statistics Suite</footer>',
    '</body></html>',
  ].join('\n')

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${state.title || 'report'}.html`; a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

const TPL_KEY = 'perdura_report_templates'

interface SavedTemplate { name: string; title: string; blocks: ReportBlock[]; savedAt: number }

function getTemplates(): SavedTemplate[] {
  try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]') }
  catch { return [] }
}

function saveTemplateToStorage(name: string, state: ReportState) {
  const tpls = getTemplates()
  tpls.push({ name, title: state.title, blocks: state.blocks, savedAt: Date.now() })
  localStorage.setItem(TPL_KEY, JSON.stringify(tpls))
}

function deleteTemplateFromStorage(idx: number) {
  const tpls = getTemplates()
  tpls.splice(idx, 1)
  localStorage.setItem(TPL_KEY, JSON.stringify(tpls))
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ReportBuilder() {
  const [state, setState] = useModuleState<ReportState>('reportBuilder', INITIAL)
  const reportRef = useRef<HTMLDivElement>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [tplVer, setTplVer] = useState(0)
  const templates = getTemplates()
  void tplVer

  // --- Asset enumeration ---
  const [assetVer, setAssetVer] = useState(0)
  const assets = useMemo(() => enumerateAssets(), [assetVer])
  void assetVer
  const refreshAssets = useCallback(() => setAssetVer(v => v + 1), [])

  const grouped = useMemo(() => {
    const map = new Map<string, AssetDescriptor[]>()
    for (const a of assets) {
      const key = a.moduleLabel
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return map
  }, [assets])

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleGroup = useCallback((key: string) => {
    setCollapsed(c => ({ ...c, [key]: !c[key] }))
  }, [])

  // --- Block operations ---
  const addBlock = useCallback((b: ReportBlock) => {
    setState(s => ({ ...s, blocks: [...s.blocks, b] }))
  }, [setState])

  const removeBlock = useCallback((id: string) => {
    setState(s => ({ ...s, blocks: s.blocks.filter(b => b.id !== id) }))
  }, [setState])

  const updateBlock = useCallback((id: string, patch: Partial<ReportBlock>) => {
    setState(s => ({
      ...s,
      blocks: s.blocks.map(b => b.id === id ? { ...b, ...patch } as ReportBlock : b),
    }))
  }, [setState])

  const moveBlock = useCallback((from: number, to: number) => {
    setState(s => {
      const b = [...s.blocks]
      const [moved] = b.splice(from, 1)
      b.splice(to, 0, moved)
      return { ...s, blocks: b }
    })
  }, [setState])

  // --- Asset insertion ---
  const insertAsset = useCallback((a: AssetDescriptor) => {
    const data = a.getData()
    if (a.type === 'plot' && data.plotData) {
      addBlock({
        id: newId(), type: 'plot',
        plotData: data.plotData, plotLayout: data.plotLayout ?? {},
        label: a.label, assetId: a.id,
      })
    } else if (a.type === 'table' && data.tableHeaders) {
      addBlock({
        id: newId(), type: 'table',
        headers: data.tableHeaders, rows: data.tableRows ?? [],
        label: a.label,
      })
    } else if (a.type === 'metrics' && data.metrics) {
      addBlock({
        id: newId(), type: 'metrics',
        items: data.metrics,
        label: a.label,
      })
    }
  }, [addBlock])

  // --- Refresh all asset-backed blocks with fresh data ---
  const refreshBlocks = useCallback(() => {
    const freshAssets = enumerateAssets()
    const lookup = new Map(freshAssets.map(a => [a.id, a]))
    setState(s => ({
      ...s,
      blocks: s.blocks.map(b => {
        if (!('assetId' in b) || !b.assetId) return b
        const desc = lookup.get(b.assetId)
        if (!desc) return b
        const data = desc.getData()
        if (b.type === 'plot' && data.plotData) {
          return { ...b, plotData: data.plotData, plotLayout: data.plotLayout ?? b.plotLayout }
        }
        return b
      }),
    }))
    setAssetVer(v => v + 1)
  }, [setState])

  // --- Drag and drop ---
  const onDragStart = (i: number) => setDragIdx(i)
  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragIdx != null && dragIdx !== i) {
      moveBlock(dragIdx, i)
      setDragIdx(i)
    }
  }
  const onDragEnd = () => setDragIdx(null)

  // --- Export ---
  const handlePDF = async () => {
    setExporting(true)
    try { await exportPDF(state) }
    catch (e) { console.error('PDF export error:', e) }
    finally { setExporting(false) }
  }

  // --- Templates ---
  const handleSaveTpl = () => {
    const name = window.prompt('Template name:', state.title)
    if (!name) return
    saveTemplateToStorage(name, state)
    setTplVer(v => v + 1)
    setTplOpen(false)
  }

  const handleLoadTpl = (idx: number) => {
    const t = templates[idx]
    if (!t) return
    setState({ title: t.title, blocks: t.blocks })
    setTplOpen(false)
  }

  const handleDeleteTpl = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Delete template "${templates[idx]?.name}"?`)) return
    deleteTemplateFromStorage(idx)
    setTplVer(v => v + 1)
  }

  const handleExportTpl = () => {
    const json = JSON.stringify({ title: state.title, blocks: state.blocks }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${state.title || 'template'}.json`; a.click()
    URL.revokeObjectURL(url)
    setTplOpen(false)
  }

  const handleImportTpl = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const t = JSON.parse(reader.result as string)
          if (t.title && Array.isArray(t.blocks)) {
            setState({ title: t.title, blocks: t.blocks })
          }
        } catch { /* invalid */ }
      }
      reader.readAsText(f)
    }
    input.click()
    setTplOpen(false)
  }

  const clearReport = () => {
    if (!window.confirm('Clear all report contents?')) return
    setState(INITIAL)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <FileText size={16} className="text-rose-500 flex-shrink-0" />
        <input
          value={state.title}
          onChange={e => setState(s => ({ ...s, title: e.target.value }))}
          placeholder="Report title"
          className="text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 py-0.5 w-64"
        />
        <div className="flex-1" />

        <button onClick={clearReport}
          className="text-[11px] text-gray-400 hover:text-red-500 px-2 py-1">
          Clear
        </button>

        <button onClick={handlePDF} disabled={exporting || state.blocks.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {exporting ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
          PDF
        </button>
        <button onClick={() => exportHTML(state)} disabled={state.blocks.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
          <Download size={13} /> HTML
        </button>

        {/* Templates dropdown */}
        <div className="relative">
          <button onClick={() => setTplOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded hover:bg-gray-50">
            <Save size={13} /> Templates <ChevronDown size={11} />
          </button>
          {tplOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTplOpen(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-60 py-1">
                <button onClick={handleSaveTpl}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
                  <Save size={12} /> Save as Template
                </button>
                <button onClick={handleExportTpl}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
                  <Upload size={12} /> Export Template File
                </button>
                <button onClick={handleImportTpl}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
                  <Download size={12} /> Import Template File
                </button>
                {templates.length > 0 && (
                  <>
                    <div className="border-t border-gray-100 my-1" />
                    <p className="px-3 py-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider">Saved</p>
                    {templates.map((t, i) => (
                      <button key={i} onClick={() => handleLoadTpl(i)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between group">
                        <span className="truncate">{t.name}</span>
                        <span onClick={e => handleDeleteTpl(i, e)}
                          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0">
                          <Trash2 size={11} />
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-60 flex-shrink-0 bg-white border-r border-gray-200 p-3 flex flex-col gap-4 overflow-y-auto">
          {/* Add blocks */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Add Block</p>
            <div className="flex flex-col gap-1">
              <PaletteBtn icon={<Type size={13} />} label="Heading"
                onClick={() => addBlock({ id: newId(), type: 'heading', text: 'Section Title', level: 2 })} />
              <PaletteBtn icon={<AlignLeft size={13} />} label="Text Paragraph"
                onClick={() => addBlock({ id: newId(), type: 'text', content: '' })} />
              <PaletteBtn icon={<Minus size={13} />} label="Divider"
                onClick={() => addBlock({ id: newId(), type: 'divider' })} />
              <PaletteBtn icon={<Columns size={13} />} label="Page Break"
                onClick={() => addBlock({ id: newId(), type: 'pagebreak' })} />
            </div>
          </div>

          {/* Project assets */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Project Assets ({assets.length})
              </p>
              <button onClick={refreshAssets} title="Refresh assets from project data"
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors">
                <RefreshCw size={12} />
              </button>
            </div>

            {assets.length === 0 ? (
              <p className="text-[10px] text-gray-400 leading-relaxed">
                No analysis results yet. Run analyses in other modules and their
                outputs will appear here automatically.
              </p>
            ) : (
              <div className="flex-1 overflow-y-auto -mr-1 pr-1 space-y-1">
                {[...grouped.entries()].map(([moduleLabel, items]) => (
                  <div key={moduleLabel}>
                    <button
                      onClick={() => toggleGroup(moduleLabel)}
                      className="flex items-center gap-1 w-full text-left px-1 py-1 text-[11px] font-semibold text-gray-600 hover:text-gray-800 rounded hover:bg-gray-50 transition-colors"
                    >
                      <ChevronRight
                        size={12}
                        className={`flex-shrink-0 transition-transform ${collapsed[moduleLabel] ? '' : 'rotate-90'}`}
                      />
                      <span className="truncate">{moduleLabel}</span>
                      <span className="ml-auto text-[10px] text-gray-400 font-normal">{items.length}</span>
                    </button>

                    {!collapsed[moduleLabel] && (
                      <div className="ml-3 flex flex-col gap-0.5 mt-0.5 mb-1">
                        {items.map(a => (
                          <button
                            key={a.id}
                            onClick={() => insertAsset(a)}
                            title={`Add "${a.label}" to report`}
                            className="flex items-center gap-1.5 text-left text-[11px] px-2 py-1 rounded border border-transparent hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                          >
                            {a.type === 'plot'
                              ? <ImageIcon size={11} className="text-blue-500 flex-shrink-0" />
                              : a.type === 'table'
                              ? <TableIcon size={11} className="text-emerald-500 flex-shrink-0" />
                              : <BarChart3 size={11} className="text-amber-500 flex-shrink-0" />}
                            <span className="truncate text-gray-600 group-hover:text-gray-800">{a.label}</span>
                            <Plus size={10} className="ml-auto text-gray-300 group-hover:text-blue-400 flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-[10px] text-gray-400 leading-relaxed border-t border-gray-100 pt-3 flex-shrink-0">
            <p className="font-medium text-gray-500 mb-1">Quick Guide</p>
            <ul className="list-disc pl-3.5 space-y-1">
              <li>Assets auto-populate from project analyses</li>
              <li>Click any asset to add it to the report</li>
              <li>Drag blocks to reorder</li>
              <li>Page breaks control PDF pagination</li>
              <li>HTML export keeps plots interactive</li>
            </ul>
          </div>
        </div>

        {/* Report canvas */}
        <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
          <div
            ref={reportRef}
            className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 min-h-[500px]"
            style={{ padding: '40px 48px' }}
          >
            {/* Title */}
            <input
              value={state.title}
              onChange={e => setState(s => ({ ...s, title: e.target.value }))}
              placeholder="Report Title"
              className="w-full text-2xl font-bold text-gray-900 border-b-2 border-blue-200 pb-2 mb-8 focus:outline-none focus:border-blue-500 bg-transparent"
            />

            {state.blocks.length === 0 && (
              <div className="text-center py-24 text-gray-400">
                <FileText size={48} className="mx-auto mb-4 opacity-40" />
                <p className="text-sm font-medium">Your report is empty</p>
                <p className="text-xs mt-2 max-w-sm mx-auto leading-relaxed">
                  Add headings and text blocks from the panel, or click any
                  project asset to include it in your report.
                </p>
              </div>
            )}

            {state.blocks.map((block, idx) => {
              const isFirst = idx === 0
              const isLast = idx === state.blocks.length - 1
              return (
                <div
                  key={block.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={e => onDragOver(e, idx)}
                  onDragEnd={onDragEnd}
                  className={`group relative mb-3 rounded-lg transition-all ${
                    dragIdx === idx
                      ? 'ring-2 ring-blue-400 bg-blue-50/40'
                      : 'hover:ring-1 hover:ring-gray-200'
                  }`}
                >
                  {/* Left controls: drag + move */}
                  <div className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-0.5 z-10">
                    <button onClick={() => moveBlock(idx, 0)} disabled={isFirst} title="Move to top"
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default">
                      <ChevronsUp size={12} />
                    </button>
                    <button onClick={() => moveBlock(idx, idx - 1)} disabled={isFirst} title="Move up"
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default">
                      <ArrowUp size={12} />
                    </button>
                    <div className="cursor-grab active:cursor-grabbing py-0.5" title="Drag to reorder">
                      <GripVertical size={14} className="text-gray-400" />
                    </div>
                    <button onClick={() => moveBlock(idx, idx + 1)} disabled={isLast} title="Move down"
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default">
                      <ArrowDown size={12} />
                    </button>
                    <button onClick={() => moveBlock(idx, state.blocks.length - 1)} disabled={isLast} title="Move to bottom"
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default">
                      <ChevronsDown size={12} />
                    </button>
                  </div>
                  <button
                    onClick={() => removeBlock(block.id)}
                    className="absolute -right-2 -top-2 p-1 rounded-full bg-white border border-gray-200 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:border-red-200 hover:text-red-500 z-10"
                    title="Remove block"
                  >
                    <Trash2 size={11} />
                  </button>

                  <BlockRenderer block={block} onChange={p => updateBlock(block.id, p)} />
                </div>
              )
            })}

            {state.blocks.length > 0 && (
              <div className="flex justify-center pt-4">
                <button onClick={refreshBlocks}
                  className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-blue-500 transition-colors"
                  title="Re-fetch data for all asset-backed blocks">
                  <RefreshCw size={11} /> Refresh live data
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PaletteBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-600 rounded border border-gray-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors w-full text-left">
      {icon}{label}
    </button>
  )
}

function BlockRenderer({ block, onChange }: { block: ReportBlock; onChange: (p: Partial<ReportBlock>) => void }) {
  switch (block.type) {
    case 'heading':
      return (
        <div className="py-2 px-1">
          <div className="flex items-center gap-1 mb-1">
            {([1, 2, 3] as const).map(l => (
              <button key={l} onClick={() => onChange({ level: l })}
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                  block.level === l ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'
                }`}>
                H{l}
              </button>
            ))}
          </div>
          <input
            value={block.text}
            onChange={e => onChange({ text: e.target.value })}
            className={`w-full bg-transparent focus:outline-none font-bold text-gray-900 ${
              block.level === 1 ? 'text-xl' : block.level === 2 ? 'text-lg' : 'text-base'
            }`}
            placeholder="Section heading"
          />
        </div>
      )

    case 'text':
      return (
        <div className="py-1 px-1">
          <textarea
            value={block.content}
            onChange={e => onChange({ content: e.target.value })}
            placeholder="Type your text here..."
            className="w-full bg-transparent focus:outline-none text-sm text-gray-700 leading-relaxed resize-none"
            rows={Math.max(3, (block.content?.split('\n').length ?? 1) + 1)}
          />
        </div>
      )

    case 'plot':
      return (
        <div className="py-2">
          <p className="text-[10px] text-gray-400 mb-1 font-medium px-1">{block.label}</p>
          <div style={{ height: 400 }}>
            <Plot
              data={(block.plotData ?? []) as Plotly.Data[]}
              layout={{
                ...(block.plotLayout as Record<string, unknown>),
                autosize: true,
                margin: { t: 30, r: 20, b: 50, l: 60 },
              } as AnyLayout}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </div>
        </div>
      )

    case 'table':
      return (
        <div className="py-2">
          {block.label && (
            <p className="text-[10px] text-gray-400 mb-1 font-medium px-1">{block.label}</p>
          )}
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {block.headers.map((h, i) => (
                    <th key={i} className="px-3 py-1.5 text-left font-medium text-gray-600 border-b border-gray-200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-gray-100 last:border-0">
                    {row.map((c, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-gray-700">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )

    case 'metrics':
      return (
        <div className="py-2">
          {block.label && (
            <p className="text-[10px] text-gray-400 mb-1 font-medium px-1">{block.label}</p>
          )}
          <div className="bg-gray-50 rounded-lg border border-gray-200 px-4 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {block.items.map((item, i) => (
                <div key={i} className="flex items-baseline justify-between text-xs">
                  <span className="text-gray-500">{item.label}</span>
                  <span className="font-semibold text-gray-800 ml-2 font-mono text-[11px]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )

    case 'divider':
      return <hr className="border-t border-gray-300 my-4" />

    case 'pagebreak':
      return (
        <div className="flex items-center gap-3 py-3">
          <div className="flex-1 border-t border-dashed border-gray-300" />
          <span className="text-[10px] text-gray-400 font-medium tracking-wider">PAGE BREAK</span>
          <div className="flex-1 border-t border-dashed border-gray-300" />
        </div>
      )

    default:
      return null
  }
}
