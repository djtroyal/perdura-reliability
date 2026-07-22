import { useState, useRef, useCallback, useMemo } from 'react'
import {
  FileText, Type, AlignLeft, Minus, Columns,
  GripVertical, Trash2, ChevronDown, Download, Upload, Save,
  Image as ImageIcon, Table as TableIcon, Plus, Loader,
  RefreshCw, ChevronRight, BarChart3, FolderOpen,
  ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, X, Copy,
  Camera, Pencil, Eye, Code2,
} from 'lucide-react'
import Plot from '../shared/ExportablePlot'
import { escapeHtmlText as escHtml, jsonForInlineScript } from '../shared/htmlSafety'
import Plotly from '../shared/plotly'
import { useModuleState, useStoreVersion } from '../../store/project'
import { enumerateAssets, AssetDescriptor } from '../../store/assetExtractors'
import {
  EMPTY_PLOT_MARKUP,
  mergePlotMarkup,
  sanitizePlotMarkup,
  splitUserMarkupFromLayout,
  type PlotMarkup,
} from '../../store/plotMarkup'
import { useHelpTopic } from '../help/context'
import { useShortcuts } from '../shared/KeyboardShortcuts'
import { handleTabKey } from '../shared/tabKeyboard'
import { downloadArtifact } from '../../store/artifactExport'
import { BookmarkAssetButton } from '../shared/BookmarkControls'
import {
  sanitizePlotSnapshots,
  type PlotSnapshot,
} from '../../store/plotSnapshots'
import {
  KATEX_STYLESHEET_URL,
  MarkdownEquationWarning,
  ReportMarkdown,
  markdownMathErrors,
  markdownToHtmlFragment,
} from './reportMarkdown'
import { renderReportMarkdownPdf } from './reportMarkdownPdf'
import {
  importReportImage,
  isSafeReportImageDataUrl,
} from './reportImage'
import RichMarkdownEditor from './RichMarkdownEditor'
// jsPDF is dynamically imported inside exportPDF() so it loads only on export.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLayout = any

// Stable Plotly config — hoisted so each plot block isn't handed a new config
// object reference on every render.
const RB_PLOT_CONFIG = {
  responsive: true,
  displayModeBar: false,
  scrollZoom: false,
  edits: { legendPosition: false },
} as const

interface HeadingBlock { id: string; type: 'heading'; text: string; level: 1 | 2 | 3 }
interface TextBlock { id: string; type: 'text'; content: string }
interface ImageBlock {
  id: string
  type: 'image'
  dataUrl: string
  mimeType: 'image/png' | 'image/jpeg'
  fileName: string
  naturalWidth: number
  naturalHeight: number
  sha256: string
  alt: string
  caption: string
  widthPercent: 25 | 50 | 75 | 100
  alignment: 'left' | 'center' | 'right'
}
interface PlotBlock {
  id: string; type: 'plot'
  plotData: unknown[]; plotLayout: unknown
  plotMarkup?: PlotMarkup
  label: string; assetId?: string
  sourceKind?: 'live' | 'snapshot'
  snapshotId?: string
  snapshotSha256?: string
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
  | HeadingBlock | TextBlock | ImageBlock | PlotBlock
  | TableBlock | MetricsBlock | DividerBlock | PageBreakBlock

type Orientation = 'portrait' | 'landscape'
type PageSize = 'a4' | 'letter' | 'legal' | 'a3'

const PAGE_SIZES: Record<PageSize, { label: string; w: number; h: number }> = {
  a4:     { label: 'A4',     w: 210, h: 297 },
  letter: { label: 'Letter', w: 215.9, h: 279.4 },
  legal:  { label: 'Legal',  w: 215.9, h: 355.6 },
  a3:     { label: 'A3',     w: 297, h: 420 },
}

interface PageFormat {
  orientation: Orientation
  pageSize: PageSize
  margin: number
}

const DEFAULT_FORMAT: PageFormat = { orientation: 'portrait', pageSize: 'a4', margin: 15 }

// ---------------------------------------------------------------------------
// Header / Footer types  (Task #5)
// ---------------------------------------------------------------------------

interface HeaderFooter {
  enabled: boolean
  left: string
  center: string
  right: string
  showDate: boolean
  dateFormat: string   // e.g. 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'
  showPageNumber: boolean
  fontSize: number
}

const DEFAULT_HF: HeaderFooter = {
  enabled: false,
  left: '',
  center: '',
  right: '',
  showDate: false,
  dateFormat: 'YYYY-MM-DD',
  showPageNumber: false,
  fontSize: 8,
}

const DATE_FORMATS = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'] as const

function formatDate(fmt: string): string {
  const d = new Date()
  const yyyy = d.getFullYear().toString()
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  switch (fmt) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`
    default: return `${yyyy}-${mm}-${dd}`
  }
}

/** Replace {date}, {page}, {pages} tokens. */
function resolveTokens(text: string, dateFmt: string, page: number, pages: number): string {
  return text
    .replace(/\{date\}/g, formatDate(dateFmt))
    .replace(/\{page\}/g, String(page))
    .replace(/\{pages\}/g, String(pages))
}

// ---------------------------------------------------------------------------
// Multi-report types  (Task #6)
// ---------------------------------------------------------------------------

interface SingleReport {
  id: string
  title: string
  blocks: ReportBlock[]
  pageFormat?: PageFormat
  header?: HeaderFooter
  footer?: HeaderFooter
}

interface MultiReportState {
  reports: SingleReport[]
  activeReportId: string
  /** Collapsed state of Project Assets groups, keyed by module/folio. UI-only. */
  collapsed?: Record<string, boolean>
  /** Immutable interactive figures captured from Plotly's current live view. */
  plotSnapshots?: PlotSnapshot[]
}

function makeReportId() { return `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` }

function newSingleReport(title = 'Untitled Report'): SingleReport {
  return { id: makeReportId(), title, blocks: [], pageFormat: DEFAULT_FORMAT }
}

const INITIAL_MULTI: MultiReportState = (() => {
  const r = newSingleReport()
  return { reports: [r], activeReportId: r.id }
})()

let seq = 0
const newId = () => `rb_${Date.now().toString(36)}_${(seq++).toString(36)}`

function formatSnapshotSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// PDF Export  (block-by-block rendering, with header/footer)
// ---------------------------------------------------------------------------

async function exportPDF(report: SingleReport) {
  const pf = report.pageFormat ?? DEFAULT_FORMAT
  const orient = pf.orientation === 'landscape' ? 'l' : 'p'
  const sz = PAGE_SIZES[pf.pageSize] ?? PAGE_SIZES.a4
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF(orient, 'mm', [sz.w, sz.h])
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const m = pf.margin
  const cw = pw - 2 * m

  const hdr = report.header ?? DEFAULT_HF
  const ftr = report.footer ?? DEFAULT_HF

  // Reserve vertical space for header/footer
  const headerH = hdr.enabled ? hdr.fontSize * 0.5 + 4 : 0
  const footerH = ftr.enabled ? ftr.fontSize * 0.5 + 4 : 0
  const topY = m + headerH
  const bottomY = ph - m - footerH

  let y = topY

  const newPage = () => { pdf.addPage(); y = topY }
  const ensureSpace = (needed: number) => { if (y + needed > bottomY) newPage() }

  // Title
  pdf.setFontSize(22)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(30, 64, 175)
  pdf.text(report.title || 'Report', m, y + 7)
  y += 12
  pdf.setDrawColor(59, 130, 246)
  pdf.setLineWidth(0.5)
  pdf.line(m, y, m + cw, y)
  y += 8

  for (const block of report.blocks) {
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
        await renderReportMarkdownPdf(pdf, block.content || '', {
          x: m,
          width: cw,
          bottomY,
          getY: () => y,
          setY: value => { y = value },
          ensureSpace,
          newPage,
        })
        y += 3
        break
      }
      case 'image': {
        if (!isSafeReportImageDataUrl(block.dataUrl, block.mimeType)
            || block.naturalWidth <= 0 || block.naturalHeight <= 0) break
        const requestedWidth = cw * (block.widthPercent / 100)
        let drawW = requestedWidth
        let drawH = drawW * block.naturalHeight / block.naturalWidth
        let captionLines = block.caption
          ? pdf.splitTextToSize(block.caption, requestedWidth) as string[] : []
        let captionH = captionLines.length ? captionLines.length * 4 + 2 : 0
        const maxHeight = Math.max(10, bottomY - topY - captionH)
        if (drawH > maxHeight) {
          drawH = maxHeight
          drawW = drawH * block.naturalWidth / block.naturalHeight
          captionLines = block.caption
            ? pdf.splitTextToSize(block.caption, drawW) as string[] : []
          captionH = captionLines.length ? captionLines.length * 4 + 2 : 0
        }
        ensureSpace(drawH + captionH + 4)
        const drawX = block.alignment === 'center'
          ? m + (cw - drawW) / 2
          : block.alignment === 'right' ? m + cw - drawW : m
        pdf.addImage(block.dataUrl, block.mimeType === 'image/jpeg' ? 'JPEG' : 'PNG', drawX, y, drawW, drawH)
        y += drawH
        if (captionLines.length) {
          pdf.setFont('helvetica', 'italic')
          pdf.setFontSize(9)
          pdf.setTextColor(100, 116, 139)
          captionLines.forEach(line => {
            y += 4
            pdf.text(line, drawX + drawW / 2, y, { align: 'center', maxWidth: drawW })
          })
        }
        y += 4
        break
      }
      case 'plot': {
        const aspect = 500 / 800
        const avail = bottomY - topY
        let plotH = Math.min(cw * aspect, avail)
        let plotW = plotH / aspect
        if (plotW > cw) { plotW = cw; plotH = cw * aspect }
        if (y + plotH > bottomY) newPage()
        try {
          const rw = 800
          const rh = Math.round(rw * aspect)
          const tmp = document.createElement('div')
          tmp.style.cssText = `position:fixed;left:-9999px;width:${rw}px;height:${rh}px`
          document.body.appendChild(tmp)
          await (Plotly as AnyLayout).newPlot(tmp, block.plotData, {
            ...(mergePlotMarkup(
              block.plotLayout as Partial<Plotly.Layout>,
              sanitizePlotMarkup(block.plotMarkup ?? EMPTY_PLOT_MARKUP),
            ) as Record<string, unknown>),
            width: rw, height: rh,
            paper_bgcolor: 'white', plot_bgcolor: 'white',
          })
          const imgUrl: string = await (Plotly as AnyLayout).toImage(tmp, {
            format: 'png', width: rw, height: rh, scale: 2,
          })
          pdf.addImage(imgUrl, 'PNG', m, y, plotW, plotH)
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
        const maxChars = Math.max(4, Math.floor((colW - 2) / 1.8))
        ensureSpace(14)
        pdf.setFillColor(241, 245, 249)
        pdf.rect(m, y, cw, 6, 'F')
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(51, 65, 85)
        block.headers.forEach((h, i) => {
          pdf.text(String(h).substring(0, maxChars), m + i * colW + 1, y + 4)
        })
        y += 6
        pdf.setFont('helvetica', 'normal')
        pdf.setTextColor(71, 85, 105)
        block.rows.forEach(row => {
          ensureSpace(6)
          row.forEach((c, i) => {
            pdf.text(String(c).substring(0, maxChars), m + i * colW + 1, y + 4)
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
        const valX = m + Math.min(60, cw * 0.45)
        for (const item of block.items) {
          ensureSpace(5.5)
          pdf.setTextColor(100, 116, 139)
          pdf.text(item.label + ':', m + 2, y + 3)
          pdf.setTextColor(30, 41, 59)
          pdf.text(item.value, valX, y + 3)
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

  // Header / footer on every page
  const pages = (pdf as AnyLayout).internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)

    // Header
    if (hdr.enabled) {
      pdf.setFontSize(hdr.fontSize)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(100, 116, 139)
      const hY = m + hdr.fontSize * 0.35
      const leftTxt = resolveTokens(hdr.left, hdr.dateFormat, i, pages)
      const centerTxt = resolveTokens(hdr.center, hdr.dateFormat, i, pages)
      const rightTxt = resolveTokens(hdr.right, hdr.dateFormat, i, pages)
      if (leftTxt) pdf.text(leftTxt, m, hY)
      if (centerTxt) pdf.text(centerTxt, pw / 2, hY, { align: 'center' })
      if (rightTxt) pdf.text(rightTxt, pw - m, hY, { align: 'right' })
      // Separator line
      pdf.setDrawColor(203, 213, 225)
      pdf.setLineWidth(0.2)
      pdf.line(m, m + hdr.fontSize * 0.5 + 1, pw - m, m + hdr.fontSize * 0.5 + 1)
    }

    // Footer
    if (ftr.enabled) {
      pdf.setFontSize(ftr.fontSize)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(100, 116, 139)
      const fY = ph - m - 1
      const leftTxt = resolveTokens(ftr.left, ftr.dateFormat, i, pages)
      const centerTxt = resolveTokens(ftr.center, ftr.dateFormat, i, pages)
      const rightTxt = resolveTokens(ftr.right, ftr.dateFormat, i, pages)
      // Separator line
      pdf.setDrawColor(203, 213, 225)
      pdf.setLineWidth(0.2)
      pdf.line(m, ph - m - ftr.fontSize * 0.5 - 2, pw - m, ph - m - ftr.fontSize * 0.5 - 2)
      if (leftTxt) pdf.text(leftTxt, m, fY)
      if (centerTxt) pdf.text(centerTxt, pw / 2, fY, { align: 'center' })
      if (rightTxt) pdf.text(rightTxt, pw - m, fY, { align: 'right' })
    }

    // Default page-number line when footer is not used
    if (!ftr.enabled) {
      pdf.setFontSize(8)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(148, 163, 184)
      pdf.text(
        `Generated by Perdura  ·  Page ${i} of ${pages}`,
        m, ph - 6,
      )
    }
  }

  pdf.setProperties({
    title: report.title || 'Perdura report',
    subject: 'Perdura engineering report; verification metadata is included in the export package.',
    creator: 'Perdura',
  })
  await downloadArtifact(pdf.output('arraybuffer'), `${report.title || 'report'}.pdf`, 'application/pdf', {
    kind: 'report', title: report.title,
  })
}

// ---------------------------------------------------------------------------
// HTML Export (interactive Plotly charts)
// ---------------------------------------------------------------------------

async function exportHTML(report: SingleReport) {
  const blocks = (await Promise.all(report.blocks.map(async b => {
    switch (b.type) {
      case 'heading': {
        const tag = `h${b.level}`
        return `<${tag}>${escHtml(b.text)}</${tag}>`
      }
      case 'text':
        return `<section class="markdown">${await markdownToHtmlFragment(b.content)}</section>`
      case 'image': {
        if (!isSafeReportImageDataUrl(b.dataUrl, b.mimeType)) return ''
        const align = b.alignment === 'center' ? 'margin-left:auto;margin-right:auto'
          : b.alignment === 'right' ? 'margin-left:auto;margin-right:0' : 'margin-left:0;margin-right:auto'
        return `<figure class="report-image" style="width:${b.widthPercent}%;${align}"><img src="${b.dataUrl}" alt="${escHtml(b.alt)}"><figcaption>${escHtml(b.caption)}</figcaption></figure>`
      }
      case 'divider':
        return '<hr>'
      case 'pagebreak':
        return '<div class="pagebreak"></div>'
      case 'plot': {
        const pid = `p_${Math.random().toString(36).slice(2, 8)}`
        const exportedLayout = mergePlotMarkup(
          b.plotLayout as Partial<Plotly.Layout>,
          sanitizePlotMarkup(b.plotMarkup ?? EMPTY_PLOT_MARKUP),
        )
        return [
          `<div id="${pid}" class="plot"></div>`,
          `<script>Plotly.newPlot("${pid}",`,
          `${jsonForInlineScript(b.plotData)},`,
          `${jsonForInlineScript(exportedLayout)},`,
          `{responsive:true,scrollZoom:true,displaylogo:false,edits:{legendPosition:true,annotationPosition:true,annotationText:true,shapePosition:true},modeBarButtonsToAdd:["drawline","drawrect","drawcircle","eraseshape"]});</${'script'}>`,
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
  }))).join('\n')

  const pf = report.pageFormat ?? DEFAULT_FORMAT
  const szInfo = PAGE_SIZES[pf.pageSize] ?? PAGE_SIZES.a4
  const printW = pf.orientation === 'landscape' ? szInfo.h : szInfo.w
  const printH = pf.orientation === 'landscape' ? szInfo.w : szInfo.h

  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${escHtml(report.title)}</title>`,
    '<script src="https://cdn.plot.ly/plotly-3.7.0.min.js" charset="utf-8"></' + 'script>',
    `<link rel="stylesheet" href="${KATEX_STYLESHEET_URL}">`,
    `<style>
@page{size:${printW}mm ${printH}mm;margin:${pf.margin}mm}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:${printW - pf.margin * 2}mm;margin:0 auto;padding:40px 24px;color:#1e293b;line-height:1.6}
h1{color:#1e40af;border-bottom:2px solid #3b82f6;padding-bottom:8px;margin-top:0}
h2{color:#1e3a5f;margin-top:32px}
h3{color:#374151;margin-top:24px}
p{margin:10px 0;color:#334155}
.markdown ul,.markdown ol{margin:10px 0;padding-left:28px}
.markdown ul{list-style:disc}.markdown ol{list-style:decimal}
.markdown li{margin:3px 0}.markdown li.task-list-item{list-style:none}
.markdown blockquote{margin:14px 0;border-left:4px solid #cbd5e1;background:#f8fafc;padding:4px 14px;color:#475569}
.markdown code{border-radius:3px;background:#f1f5f9;padding:1px 4px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.markdown pre{overflow:auto;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;padding:12px}
.markdown pre code{background:transparent;padding:0}.markdown del{color:#64748b}
.markdown .katex-display{overflow-x:auto;overflow-y:hidden;padding:4px 0}
.report-image{margin-top:20px;margin-bottom:20px}.report-image img{display:block;width:100%;height:auto}
.report-image figcaption{margin-top:6px;text-align:center;color:#64748b;font-size:12px;font-style:italic}
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
    `<h1>${escHtml(report.title)}</h1>`,
    blocks,
    '<footer>Generated by Perdura — Reliability Engineering and Statistics Suite</footer>',
    '</body></html>',
  ].join('\n')

  await downloadArtifact(html, `${report.title || 'report'}.html`, 'text/html', {
    kind: 'report', title: report.title,
  })
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

const TPL_KEY = 'perdura_report_templates'

interface SavedTemplate {
  name: string; title: string; blocks: ReportBlock[]
  pageFormat?: PageFormat; header?: HeaderFooter; footer?: HeaderFooter
  savedAt: number
}

function getTemplates(): SavedTemplate[] {
  try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]') }
  catch { return [] }
}

function saveTemplateToStorage(name: string, report: SingleReport) {
  const tpls = getTemplates()
  tpls.push({
    name, title: report.title, blocks: report.blocks,
    pageFormat: report.pageFormat ?? DEFAULT_FORMAT,
    header: report.header, footer: report.footer,
    savedAt: Date.now(),
  })
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
  useHelpTopic('reportBuilder.overview')
  const [state, setState] = useModuleState<MultiReportState>('reportBuilder', INITIAL_MULTI)

  const reportRef = useRef<HTMLDivElement>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [tplVer, setTplVer] = useState(0)
  const [hfOpen, setHfOpen] = useState(false)
  const [imageImportError, setImageImportError] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const templates = getTemplates()
  void tplVer

  // --- Active report ---
  const activeReport = useMemo(
    () => state.reports.find(r => r.id === state.activeReportId) ?? state.reports[0],
    [state],
  )
  const activeId = activeReport?.id ?? ''

  /** Update only the active report inside the multi-report state. */
  const patchReport = useCallback((fn: (r: SingleReport) => SingleReport) => {
    setState(s => ({
      ...s,
      reports: s.reports.map(r => r.id === s.activeReportId ? fn(r) : r),
    }))
  }, [setState])

  // --- Page format ---
  const fmt_ = activeReport?.pageFormat ?? DEFAULT_FORMAT
  const patchFormat = useCallback((p: Partial<PageFormat>) => {
    patchReport(r => ({ ...r, pageFormat: { ...(r.pageFormat ?? DEFAULT_FORMAT), ...p } }))
  }, [patchReport])

  // --- Header / Footer helpers ---
  const patchHeader = useCallback((p: Partial<HeaderFooter>) => {
    patchReport(r => ({ ...r, header: { ...(r.header ?? DEFAULT_HF), ...p } }))
  }, [patchReport])
  const patchFooter = useCallback((p: Partial<HeaderFooter>) => {
    patchReport(r => ({ ...r, footer: { ...(r.footer ?? DEFAULT_HF), ...p } }))
  }, [patchReport])

  // --- Asset enumeration ---
  // Re-enumerate whenever any module writes to the store (storeVersion) so
  // analyses run in other modules (RBD, FTA, Markov, DOE, …) appear here
  // automatically — without requiring a manual refresh click.
  const storeVersion = useStoreVersion()
  const [assetVer, setAssetVer] = useState(0)
  const assets = useMemo(() => enumerateAssets(), [assetVer, storeVersion])
  void assetVer
  const refreshAssets = useCallback(() => setAssetVer(v => v + 1), [])
  const plotSnapshots = useMemo(
    () => sanitizePlotSnapshots(state.plotSnapshots),
    [state.plotSnapshots],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, AssetDescriptor[]>>()
    for (const a of assets) {
      if (!map.has(a.moduleLabel)) map.set(a.moduleLabel, new Map())
      const sub = map.get(a.moduleLabel)!
      const g = a.group || 'Default'
      if (!sub.has(g)) sub.set(g, [])
      sub.get(g)!.push(a)
    }
    return map
  }, [assets])

  const snapshotGroups = useMemo(() => {
    const map = new Map<string, Map<string, PlotSnapshot[]>>()
    for (const snapshot of plotSnapshots) {
      const moduleLabel = snapshot.source.moduleLabel || 'Analysis'
      if (!map.has(moduleLabel)) map.set(moduleLabel, new Map())
      const analyses = map.get(moduleLabel)!
      const analysisName = snapshot.source.analysisName || 'Default'
      if (!analyses.has(analysisName)) analyses.set(analysisName, [])
      analyses.get(analysisName)!.push(snapshot)
    }
    for (const analyses of map.values()) {
      for (const items of analyses.values()) {
        items.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      }
    }
    return map
  }, [plotSnapshots])

  const collapsed = state.collapsed ?? {}
  const toggleGroup = useCallback((key: string) => {
    setState(s => {
      const cur = s.collapsed ?? {}
      return { ...s, collapsed: { ...cur, [key]: !cur[key] } }
    })
  }, [setState])

  // --- Block operations (operate on active report) ---
  const addBlock = useCallback((b: ReportBlock) => {
    patchReport(r => ({ ...r, blocks: [...r.blocks, b] }))
  }, [patchReport])

  const addImportedImage = useCallback(async (file: File) => {
    setImageImportError(null)
    try {
      const image = await importReportImage(file)
      addBlock({
        id: newId(),
        type: 'image',
        dataUrl: image.dataUrl,
        mimeType: image.mimeType,
        fileName: image.fileName,
        naturalWidth: image.width,
        naturalHeight: image.height,
        sha256: image.sha256,
        alt: image.fileName.replace(/\.[^.]+$/, ''),
        caption: '',
        widthPercent: 100,
        alignment: 'center',
      })
    } catch (cause) {
      setImageImportError(cause instanceof Error ? cause.message : 'The image could not be imported.')
    }
  }, [addBlock])

  const removeBlock = useCallback((id: string) => {
    patchReport(r => ({ ...r, blocks: r.blocks.filter(b => b.id !== id) }))
  }, [patchReport])

  const updateBlock = useCallback((id: string, patch: Partial<ReportBlock>) => {
    patchReport(r => ({
      ...r,
      blocks: r.blocks.map(b => b.id === id ? { ...b, ...patch } as ReportBlock : b),
    }))
  }, [patchReport])

  const moveBlock = useCallback((from: number, to: number) => {
    patchReport(r => {
      const b = [...r.blocks]
      const [moved] = b.splice(from, 1)
      b.splice(to, 0, moved)
      return { ...r, blocks: b }
    })
  }, [patchReport])

  // --- Asset insertion ---
  const insertAsset = useCallback((a: AssetDescriptor) => {
    const data = a.getData()
    if (a.type === 'plot' && data.plotData) {
      const inherited = splitUserMarkupFromLayout(data.plotLayout ?? {})
      addBlock({
        id: newId(), type: 'plot',
        plotData: data.plotData, plotLayout: inherited.layout,
        plotMarkup: inherited.markup,
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

  const insertSnapshot = useCallback((snapshot: PlotSnapshot) => {
    addBlock({
      id: newId(),
      type: 'plot',
      plotData: snapshot.plotData,
      plotLayout: snapshot.plotLayout,
      plotMarkup: snapshot.plotMarkup,
      label: snapshot.name,
      assetId: `snapshot:${snapshot.id}`,
      sourceKind: 'snapshot',
      snapshotId: snapshot.id,
      snapshotSha256: snapshot.figureSha256,
    })
  }, [addBlock])

  const renameSnapshot = useCallback((snapshot: PlotSnapshot) => {
    const name = window.prompt('Snapshot name:', snapshot.name)?.trim()
    if (!name || name === snapshot.name) return
    setState(current => ({
      ...current,
      plotSnapshots: sanitizePlotSnapshots(current.plotSnapshots).map(item =>
        item.id === snapshot.id ? { ...item, name: name.slice(0, 300) } : item),
    }))
  }, [setState])

  const deleteSnapshot = useCallback((snapshot: PlotSnapshot) => {
    if (!window.confirm(`Delete plot snapshot “${snapshot.name}”? Reports that already contain a copy will not be changed.`)) return
    setState(current => ({
      ...current,
      plotSnapshots: sanitizePlotSnapshots(current.plotSnapshots).filter(item => item.id !== snapshot.id),
    }))
  }, [setState])

  const clearSnapshots = useCallback(() => {
    if (!plotSnapshots.length
        || !window.confirm(`Delete all ${plotSnapshots.length} plot snapshots? Existing report blocks will remain unchanged.`)) return
    setState(current => ({ ...current, plotSnapshots: [] }))
  }, [plotSnapshots.length, setState])

  // --- Refresh all asset-backed blocks ---
  const refreshBlocks = useCallback(() => {
    const freshAssets = enumerateAssets()
    const lookup = new Map<string, AssetDescriptor>()
    for (const asset of freshAssets) {
      lookup.set(asset.id, asset)
      if (asset.legacyId) lookup.set(asset.legacyId, asset)
    }
    patchReport(r => ({
      ...r,
      blocks: r.blocks.map(b => {
        if (b.type === 'plot' && b.sourceKind === 'snapshot') return b
        if (!('assetId' in b) || !b.assetId) return b
        const desc = lookup.get(b.assetId)
        if (!desc) return b
        const data = desc.getData()
        if (b.type === 'plot' && data.plotData) {
          const fresh = splitUserMarkupFromLayout(data.plotLayout ?? b.plotLayout)
          return { ...b, plotData: data.plotData, plotLayout: fresh.layout }
        }
        return b
      }),
    }))
    setAssetVer(v => v + 1)
  }, [patchReport])

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
    if (!activeReport) return
    setExporting(true)
    try { await exportPDF(activeReport) }
    catch (e) { console.error('PDF export error:', e) }
    finally { setExporting(false) }
  }

  const handleExportAll = async () => {
    setExporting(true)
    try {
      for (const r of state.reports) {
        await exportPDF(r)
      }
    } catch (e) { console.error('Export-all error:', e) }
    finally { setExporting(false) }
  }

  // --- Report tabs (Task #6) ---
  const addReport = useCallback(() => {
    const r = newSingleReport()
    setState(s => ({
      ...s,
      reports: [...s.reports, r],
      activeReportId: r.id,
    }))
  }, [setState])

  const switchReport = useCallback((id: string) => {
    setState(s => ({ ...s, activeReportId: id }))
  }, [setState])

  const deleteReport = useCallback((id: string) => {
    setState(s => {
      const target = s.reports.find(r => r.id === id)
      if (target && target.blocks.length > 0) {
        if (!window.confirm(`Delete report "${target.title}"? It has ${target.blocks.length} block(s).`)) return s
      }
      const remaining = s.reports.filter(r => r.id !== id)
      if (remaining.length === 0) {
        const fresh = newSingleReport()
        return { ...s, reports: [fresh], activeReportId: fresh.id }
      }
      const newActive = s.activeReportId === id
        ? remaining[0].id
        : s.activeReportId
      return { ...s, reports: remaining, activeReportId: newActive }
    })
  }, [setState])

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)

  const renameReport = useCallback((id: string, title: string) => {
    setState(s => ({
      ...s,
      reports: s.reports.map(r => r.id === id ? { ...r, title } : r),
    }))
  }, [setState])

  // --- Templates (now per-report) ---
  const handleSaveTpl = () => {
    if (!activeReport) return
    const name = window.prompt('Template name:', activeReport.title)
    if (!name) return
    saveTemplateToStorage(name, activeReport)
    setTplVer(v => v + 1)
    setTplOpen(false)
  }

  const handleLoadTpl = (idx: number) => {
    const t = templates[idx]
    if (!t) return
    patchReport(r => ({
      ...r,
      title: t.title,
      blocks: t.blocks,
      pageFormat: t.pageFormat ?? r.pageFormat ?? DEFAULT_FORMAT,
      header: t.header ?? r.header,
      footer: t.footer ?? r.footer,
    }))
    setTplOpen(false)
  }

  const handleDeleteTpl = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Delete template "${templates[idx]?.name}"?`)) return
    deleteTemplateFromStorage(idx)
    setTplVer(v => v + 1)
  }

  const handleExportTpl = () => {
    if (!activeReport) return
    const json = JSON.stringify({
      title: activeReport.title,
      blocks: activeReport.blocks,
      pageFormat: activeReport.pageFormat ?? DEFAULT_FORMAT,
      header: activeReport.header,
      footer: activeReport.footer,
    }, null, 2)
    void downloadArtifact(json + '\n', `${activeReport.title || 'template'}.json`, 'application/json', {
      kind: 'report-template', title: activeReport.title,
    })
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
            patchReport(r => ({
              ...r,
              title: t.title,
              blocks: t.blocks,
              pageFormat: t.pageFormat ?? r.pageFormat ?? DEFAULT_FORMAT,
              header: t.header ?? r.header,
              footer: t.footer ?? r.footer,
            }))
          }
        } catch { /* invalid */ }
      }
      reader.readAsText(f)
    }
    input.click()
    setTplOpen(false)
  }

  const clearReport = () => {
    if (!window.confirm('Clear all blocks in the current report?')) return
    patchReport(r => ({ ...r, blocks: [] }))
  }

  const blocks = activeReport?.blocks ?? []
  const headerCfg = activeReport?.header ?? DEFAULT_HF
  const footerCfg = activeReport?.footer ?? DEFAULT_HF
  const reportIndex = Math.max(0, state.reports.findIndex(report => report.id === activeId))
  const selectReportOffset = (offset: number) => {
    const target = state.reports[(reportIndex + offset + state.reports.length) % state.reports.length]
    if (target) switchReport(target.id)
  }
  useShortcuts([
    { id: 'report.new', label: 'New report', category: 'Report', scope: 'module', handler: addReport },
    { id: 'report.previous', label: 'Previous report', category: 'Report', scope: 'module', enabled: state.reports.length > 1, handler: () => selectReportOffset(-1) },
    { id: 'report.next', label: 'Next report', category: 'Report', scope: 'module', enabled: state.reports.length > 1, handler: () => selectReportOffset(1) },
    { id: 'report.rename', label: 'Rename current report', category: 'Report', scope: 'module', handler: () => setRenamingTabId(activeId) },
    { id: 'report.close', label: 'Close current report', category: 'Report', scope: 'module', handler: () => deleteReport(activeId) },
    { id: 'report.export-pdf', label: 'Export current report as PDF', category: 'Report', scope: 'module', enabled: !exporting && blocks.length > 0, disabledReason: 'Add at least one block before exporting.', handler: handlePDF },
    { id: 'report.refresh-assets', label: 'Refresh live report assets', category: 'Report', scope: 'module', enabled: blocks.length > 0, handler: refreshBlocks },
  ])

  return (
    <div className="flex flex-col h-full">
      {/* Report tabs bar (Task #6) */}
      <div role="tablist" aria-label="Report tabs" className="flex items-center gap-0 px-2 py-0 bg-gray-50 border-b border-gray-200 flex-shrink-0 overflow-x-auto">
        {state.reports.map(r => {
          const isActive = r.id === activeId
          return (
            <div
              key={r.id}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-b-2 transition-colors select-none ${
                isActive
                  ? 'border-blue-500 bg-white text-blue-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => switchReport(r.id)}
              role="tab" aria-selected={isActive} tabIndex={isActive ? 0 : -1}
              data-tab-id={r.id}
              onKeyDown={event => handleTabKey(event, {
                ids: state.reports.map(report => report.id), currentId: r.id,
                onSelect: switchReport,
                onRename: id => setRenamingTabId(id),
                onClose: deleteReport,
              })}
              onMouseDown={event => { if (event.button === 1) event.preventDefault() }}
              onAuxClick={event => {
                if (event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
                deleteReport(r.id)
              }}
              onDoubleClick={() => setRenamingTabId(r.id)}
              onContextMenu={e => {
                e.preventDefault()
                deleteReport(r.id)
              }}
            >
              {renamingTabId === r.id ? (
                <input
                  autoFocus
                  value={r.title}
                  onChange={e => renameReport(r.id, e.target.value)}
                  onBlur={() => setRenamingTabId(null)}
                  onKeyDown={e => { if (e.key === 'Enter') setRenamingTabId(null) }}
                  className="text-xs bg-transparent border-b border-blue-400 focus:outline-none w-28 px-0.5"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="truncate max-w-[120px]">{r.title || 'Untitled'}</span>
              )}
              {state.reports.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); deleteReport(r.id) }}
                  className="ml-1 p-0.5 rounded hover:bg-red-100 hover:text-red-500 text-gray-300 transition-colors"
                  title="Close report"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
        <button
          onClick={addReport}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-blue-500 hover:bg-gray-100 rounded transition-colors ml-1"
          title="New report"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <FileText size={16} className="text-rose-500 flex-shrink-0" />
        <input
          value={activeReport?.title ?? ''}
          onChange={e => patchReport(r => ({ ...r, title: e.target.value }))}
          placeholder="Report title"
          className="text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 py-0.5 w-64"
        />
        <div className="flex-1" />

        <button onClick={clearReport}
          className="text-[11px] text-gray-400 hover:text-red-500 px-2 py-1">
          Clear
        </button>

        <button onClick={handlePDF} disabled={exporting || blocks.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {exporting ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
          PDF
        </button>
        <button onClick={() => activeReport && exportHTML(activeReport)} disabled={blocks.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
          <Download size={13} /> HTML
        </button>

        {state.reports.length > 1 && (
          <button onClick={handleExportAll} disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {exporting ? <Loader size={13} className="animate-spin" /> : <Copy size={13} />}
            Export All
          </button>
        )}

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
        <div className="w-[27rem] flex-shrink-0 bg-white border-r border-gray-200 p-3 flex flex-col gap-4 overflow-y-auto">
          {/* Add blocks */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Add Block</p>
            <div className="flex flex-col gap-1">
              <PaletteBtn icon={<Type size={13} />} label="Heading"
                onClick={() => addBlock({ id: newId(), type: 'heading', text: 'Section Title', level: 2 })} />
              <PaletteBtn icon={<AlignLeft size={13} />} label="Text Paragraph"
                onClick={() => addBlock({ id: newId(), type: 'text', content: '' })} />
              <PaletteBtn icon={<ImageIcon size={13} />} label="Import Image"
                onClick={() => imageInputRef.current?.click()} />
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                className="hidden" onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void addImportedImage(file)
                  event.target.value = ''
                }} />
              {imageImportError && (
                <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] leading-relaxed text-red-700">
                  {imageImportError}
                </p>
              )}
              <PaletteBtn icon={<Minus size={13} />} label="Divider"
                onClick={() => addBlock({ id: newId(), type: 'divider' })} />
              <PaletteBtn icon={<Columns size={13} />} label="Page Break"
                onClick={() => addBlock({ id: newId(), type: 'pagebreak' })} />
            </div>
          </div>

          {/* Page format */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Page Format</p>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Orientation</label>
                <select
                  value={fmt_.orientation}
                  onChange={e => patchFormat({ orientation: e.target.value as Orientation })}
                  className="w-full text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-blue-400"
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Page Size</label>
                <select
                  value={fmt_.pageSize}
                  onChange={e => patchFormat({ pageSize: e.target.value as PageSize })}
                  className="w-full text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-blue-400"
                >
                  {Object.entries(PAGE_SIZES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-500 block mb-0.5">Margins: {fmt_.margin} mm</label>
                <input type="range" min={5} max={30} step={1}
                  value={fmt_.margin}
                  onChange={e => patchFormat({ margin: Number(e.target.value) })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Header & Footer settings (Task #5) */}
          <div>
            <button
              onClick={() => setHfOpen(o => !o)}
              className="flex items-center gap-1 w-full text-left"
            >
              <ChevronRight
                size={12}
                className={`flex-shrink-0 text-gray-400 transition-transform ${hfOpen ? 'rotate-90' : ''}`}
              />
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Header &amp; Footer</p>
            </button>
            {hfOpen && (
              <div className="mt-2 space-y-3">
                <HeaderFooterPanel
                  title="Header"
                  value={headerCfg}
                  onChange={patchHeader}
                />
                <HeaderFooterPanel
                  title="Footer"
                  value={footerCfg}
                  onChange={patchFooter}
                />
                <p className="text-[9px] text-gray-400 leading-relaxed">
                  Use <code className="bg-gray-100 px-0.5 rounded">{'{date}'}</code>,{' '}
                  <code className="bg-gray-100 px-0.5 rounded">{'{page}'}</code>,{' '}
                  <code className="bg-gray-100 px-0.5 rounded">{'{pages}'}</code> as tokens.
                </p>
              </div>
            )}
          </div>

          {/* Frozen plot snapshot library */}
          <div className="flex-shrink-0">
            <div className="mb-2 flex items-center gap-1">
              <button onClick={() => toggleGroup('__plotSnapshots')}
                className="flex min-w-0 flex-1 items-center gap-1 text-left">
                <ChevronRight size={12}
                  className={`flex-shrink-0 text-gray-400 transition-transform ${collapsed.__plotSnapshots ? '' : 'rotate-90'}`} />
                <Camera size={12} className="flex-shrink-0 text-violet-500" />
                <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Plot Snapshots ({plotSnapshots.length})
                </span>
              </button>
              {plotSnapshots.length > 0 && (
                <button type="button" onClick={clearSnapshots}
                  title="Delete all plot snapshots"
                  className="rounded px-1.5 py-0.5 text-[9px] text-gray-400 hover:bg-red-50 hover:text-red-600">
                  Clear all
                </button>
              )}
            </div>

            {!collapsed.__plotSnapshots && (
              plotSnapshots.length === 0 ? (
                <p className="rounded border border-dashed border-violet-200 bg-violet-50/40 px-2.5 py-2 text-[10px] leading-relaxed text-gray-500">
                  Use the camera button on any plot to preserve its current zoom, visible traces, legend position, and annotations here.
                </p>
              ) : (
                <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-violet-100 bg-violet-50/25 p-1.5">
                  {[...snapshotGroups.entries()].map(([moduleLabel, analyses]) => {
                    const moduleKey = `snapshot-module:${moduleLabel}`
                    const count = [...analyses.values()].reduce((total, items) => total + items.length, 0)
                    return (
                      <div key={moduleKey}>
                        <button type="button" onClick={() => toggleGroup(moduleKey)}
                          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] font-semibold text-gray-600 hover:bg-white/70">
                          <ChevronRight size={10}
                            className={`flex-shrink-0 transition-transform ${collapsed[moduleKey] ? '' : 'rotate-90'}`} />
                          <span className="truncate">{moduleLabel}</span>
                          <span className="ml-auto font-normal text-gray-400">{count}</span>
                        </button>
                        {!collapsed[moduleKey] && [...analyses.entries()].map(([analysisName, items]) => {
                          const analysisKey = `${moduleKey}:${analysisName}`
                          return (
                            <div key={analysisKey} className="ml-2">
                              <button type="button" onClick={() => toggleGroup(analysisKey)}
                                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-gray-500 hover:bg-white/70">
                                <ChevronRight size={9}
                                  className={`flex-shrink-0 transition-transform ${collapsed[analysisKey] ? '' : 'rotate-90'}`} />
                                <FolderOpen size={10} className="flex-shrink-0 text-violet-400" />
                                <span className="truncate">{analysisName}</span>
                                <span className="ml-auto text-gray-400">{items.length}</span>
                              </button>
                              {!collapsed[analysisKey] && (
                                <div className="ml-3 space-y-0.5 py-0.5">
                                  {items.map(snapshot => (
                                    <div key={snapshot.id}
                                      title={`Captured ${new Date(snapshot.capturedAt).toLocaleString()}\nSHA-256 ${snapshot.figureSha256}\n${formatSnapshotSize(snapshot.sizeBytes)}`}
                                      className="group flex items-center rounded border border-transparent bg-white/70 hover:border-violet-200 hover:bg-white">
                                      <button type="button" onClick={() => insertSnapshot(snapshot)}
                                        className="flex min-w-0 flex-1 items-start gap-1.5 px-2 py-1.5 text-left">
                                        <Camera size={11} className="mt-0.5 flex-shrink-0 text-violet-500" />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-[11px] text-gray-700">{snapshot.name}</span>
                                          <span className="block truncate font-mono text-[9px] text-gray-400">
                                            {new Date(snapshot.capturedAt).toLocaleString()} · {formatSnapshotSize(snapshot.sizeBytes)} · {snapshot.figureSha256.slice(0, 8)}…
                                          </span>
                                        </span>
                                        <Plus size={10} className="mt-0.5 flex-shrink-0 text-gray-300 group-hover:text-violet-500" />
                                      </button>
                                      <button type="button" onClick={() => renameSnapshot(snapshot)}
                                        title="Rename snapshot" aria-label={`Rename ${snapshot.name}`}
                                        className="rounded p-1 text-gray-300 hover:bg-blue-50 hover:text-blue-600">
                                        <Pencil size={10} />
                                      </button>
                                      <button type="button" onClick={() => deleteSnapshot(snapshot)}
                                        title="Delete snapshot" aria-label={`Delete ${snapshot.name}`}
                                        className="mr-1 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600">
                                        <Trash2 size={10} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            )}
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
                {[...grouped.entries()].map(([moduleLabel, folios]) => {
                  const moduleCount = [...folios.values()].reduce((a, v) => a + v.length, 0)
                  const moduleCollapsed = collapsed[moduleLabel]
                  return (
                    <div key={moduleLabel}>
                      <button
                        onClick={() => toggleGroup(moduleLabel)}
                        className="flex items-center gap-1 w-full text-left px-1 py-1 text-[11px] font-semibold text-gray-600 hover:text-gray-800 rounded hover:bg-gray-50 transition-colors"
                      >
                        <ChevronRight
                          size={12}
                          className={`flex-shrink-0 transition-transform ${moduleCollapsed ? '' : 'rotate-90'}`}
                        />
                        <span className="truncate">{moduleLabel}</span>
                        <span className="ml-auto text-[10px] text-gray-400 font-normal">{moduleCount}</span>
                      </button>

                      {!moduleCollapsed && (
                        <div className="ml-2 mt-0.5 mb-1 space-y-0.5">
                          {[...folios.entries()].map(([folioName, items]) => {
                            const fKey = `${moduleLabel} ${folioName}`
                            const fCollapsed = collapsed[fKey]
                            return (
                              <div key={fKey}>
                                <button
                                  onClick={() => toggleGroup(fKey)}
                                  className="flex items-center gap-1 w-full text-left px-1 py-0.5 text-[10px] font-medium text-gray-500 hover:text-gray-700 rounded hover:bg-gray-50 transition-colors"
                                >
                                  <ChevronRight
                                    size={10}
                                    className={`flex-shrink-0 transition-transform ${fCollapsed ? '' : 'rotate-90'}`}
                                  />
                                  <FolderOpen size={10} className="flex-shrink-0 text-gray-400" />
                                  <span className="truncate">{folioName}</span>
                                  <span className="ml-auto text-[10px] text-gray-300 font-normal">{items.length}</span>
                                </button>

                                {!fCollapsed && (
                                  <div className="ml-3.5 flex flex-col gap-0.5 mt-0.5 mb-0.5">
                                    {items.map(a => (
                                      <div key={a.id}
                                        className="group flex items-center rounded border border-transparent hover:border-blue-200 hover:bg-blue-50">
                                      <button
                                        onClick={() => insertAsset(a)}
                                        title={`Add "${a.label}" to report`}
                                        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-[11px] transition-colors"
                                      >
                                        {a.type === 'plot'
                                          ? <ImageIcon size={11} className="text-blue-500 flex-shrink-0" />
                                          : a.type === 'table'
                                          ? <TableIcon size={11} className="text-emerald-500 flex-shrink-0" />
                                          : <BarChart3 size={11} className="text-amber-500 flex-shrink-0" />}
                                        <span className="truncate text-gray-600 group-hover:text-gray-800">{a.label}</span>
                                        <Plus size={10} className="ml-auto text-gray-300 group-hover:text-blue-400 flex-shrink-0" />
                                      </button>
                                      <BookmarkAssetButton asset={a} className="mr-1 flex-shrink-0" />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="text-[10px] text-gray-400 leading-relaxed border-t border-gray-100 pt-3 flex-shrink-0">
            <p className="font-medium text-gray-500 mb-1">Quick Guide</p>
            <ul className="list-disc pl-3.5 space-y-1">
              <li>Plot snapshots preserve a reviewed interactive view</li>
              <li>Assets auto-populate from project analyses</li>
              <li>Click any asset to add it to the report</li>
              <li>Text paragraphs support GFM and $…$/$$…$$ LaTeX</li>
              <li>Imported images are embedded locally with captions and alt text</li>
              <li>Drag blocks to reorder</li>
              <li>Click block labels to rename them</li>
              <li>Use tabs to manage multiple reports</li>
              <li>Page breaks control PDF pagination</li>
              <li>HTML export keeps plots interactive</li>
            </ul>
          </div>
        </div>

        {/* Report canvas */}
        <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
          <div
            ref={reportRef}
            className="mx-auto bg-white rounded-lg shadow-sm border border-gray-200 min-h-[500px]"
            style={{
              width: (fmt_.orientation === 'landscape' ? PAGE_SIZES[fmt_.pageSize].h : PAGE_SIZES[fmt_.pageSize].w) * 3.7795,
              maxWidth: '100%',
              padding: Math.max(fmt_.margin * 3.7795, 16),
            }}
          >
            {/* Header preview (Task #5) */}
            {headerCfg.enabled && (
              <div className="flex items-center justify-between text-gray-400 border-b border-gray-200 pb-1 mb-4"
                style={{ fontSize: headerCfg.fontSize * 1.2 }}>
                <span>{resolveTokens(headerCfg.left, headerCfg.dateFormat, 1, 1)}</span>
                <span>{resolveTokens(headerCfg.center, headerCfg.dateFormat, 1, 1)}</span>
                <span>{resolveTokens(headerCfg.right, headerCfg.dateFormat, 1, 1)}</span>
              </div>
            )}

            {/* Title */}
            <input
              value={activeReport?.title ?? ''}
              onChange={e => patchReport(r => ({ ...r, title: e.target.value }))}
              placeholder="Report Title"
              className="w-full text-2xl font-bold text-gray-900 border-b-2 border-blue-200 pb-2 mb-8 focus:outline-none focus:border-blue-500 bg-transparent"
            />

            {blocks.length === 0 && (
              <div className="text-center py-24 text-gray-400">
                <FileText size={48} className="mx-auto mb-4 opacity-40" />
                <p className="text-sm font-medium">Your report is empty</p>
                <p className="text-xs mt-2 max-w-sm mx-auto leading-relaxed">
                  Add headings and text blocks from the panel, or click any
                  project asset to include it in your report.
                </p>
              </div>
            )}

            {blocks.map((block, idx) => {
              const isFirst = idx === 0
              const isLast = idx === blocks.length - 1
              return (
                <div
                  key={block.id}
                  onDragOver={e => onDragOver(e, idx)}
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
                    <div draggable onDragStart={() => onDragStart(idx)} onDragEnd={onDragEnd}
                      className="cursor-grab active:cursor-grabbing py-0.5" title="Drag to reorder">
                      <GripVertical size={14} className="text-gray-400" />
                    </div>
                    <button onClick={() => moveBlock(idx, idx + 1)} disabled={isLast} title="Move down"
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default">
                      <ArrowDown size={12} />
                    </button>
                    <button onClick={() => moveBlock(idx, blocks.length - 1)} disabled={isLast} title="Move to bottom"
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

            {blocks.length > 0 && (
              <div className="flex justify-center pt-4">
                <button onClick={refreshBlocks}
                  className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-blue-500 transition-colors"
                  title="Re-fetch data for all asset-backed blocks">
                  <RefreshCw size={11} /> Refresh live data
                </button>
              </div>
            )}

            {/* Footer preview (Task #5) */}
            {footerCfg.enabled && (
              <div className="flex items-center justify-between text-gray-400 border-t border-gray-200 pt-1 mt-4"
                style={{ fontSize: footerCfg.fontSize * 1.2 }}>
                <span>{resolveTokens(footerCfg.left, footerCfg.dateFormat, 1, 1)}</span>
                <span>{resolveTokens(footerCfg.center, footerCfg.dateFormat, 1, 1)}</span>
                <span>{resolveTokens(footerCfg.right, footerCfg.dateFormat, 1, 1)}</span>
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

// ---------------------------------------------------------------------------
// Header & Footer panel for sidebar (Task #5)
// ---------------------------------------------------------------------------

function HeaderFooterPanel({
  title,
  value,
  onChange,
}: {
  title: string
  value: HeaderFooter
  onChange: (p: Partial<HeaderFooter>) => void
}) {
  return (
    <div className="border border-gray-200 rounded p-2 space-y-1.5">
      <label className="flex items-center gap-1.5 text-[10px] font-medium text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={e => onChange({ enabled: e.target.checked })}
          className="accent-blue-500"
        />
        {title}
      </label>
      {value.enabled && (
        <>
          <div className="grid grid-cols-3 gap-1">
            <div>
              <label className="text-[9px] text-gray-400 block">Left</label>
              <input
                value={value.left}
                onChange={e => onChange({ left: e.target.value })}
                placeholder="e.g. {date}"
                className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-400 block">Center</label>
              <input
                value={value.center}
                onChange={e => onChange({ center: e.target.value })}
                placeholder="Title"
                className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-400 block">Right</label>
              <input
                value={value.right}
                onChange={e => onChange({ right: e.target.value })}
                placeholder="{page}/{pages}"
                className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <label className="text-[9px] text-gray-400 block">Date format</label>
              <select
                value={value.dateFormat}
                onChange={e => onChange({ dateFormat: e.target.value })}
                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-blue-400"
              >
                {DATE_FORMATS.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-gray-400 block">Font size</label>
              <input
                type="number" min={5} max={14} step={1}
                value={value.fontSize}
                onChange={e => onChange({ fontSize: Number(e.target.value) })}
                className="w-12 text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline Editable Label sub-component  (Task #3)
// ---------------------------------------------------------------------------

function InlineEditableLabel({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const startEdit = () => {
    setDraft(value)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== value) {
      onChange(draft.trim() || value)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className={`bg-white border border-blue-300 rounded px-1 py-0 focus:outline-none focus:border-blue-500 ${className ?? 'text-[10px] text-gray-500 font-medium'}`}
      />
    )
  }

  return (
    <span
      onClick={startEdit}
      title="Click to rename"
      className={`cursor-pointer hover:text-blue-500 hover:underline underline-offset-2 transition-colors ${className ?? 'text-[10px] text-gray-400 font-medium'}`}
    >
      {value}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Block Renderer (updated with inline editing - Task #3)
// ---------------------------------------------------------------------------

function MarkdownTextBlockEditor({ block, onChange }: {
  block: TextBlock
  onChange: (patch: Partial<ReportBlock>) => void
}) {
  const [mode, setMode] = useState<'rich' | 'source' | 'preview'>(() => block.content.trim() ? 'preview' : 'rich')
  const errors = useMemo(() => markdownMathErrors(block.content), [block.content])
  return (
    <div className="px-1 py-1">
      <div className="mb-1 flex items-center justify-between gap-2 opacity-70 transition-opacity hover:opacity-100">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMode('rich')}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${mode === 'rich' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
            <Pencil size={10} /> Rich
          </button>
          <button type="button" onClick={() => setMode('source')}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${mode === 'source' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
            <Code2 size={10} /> Markdown
          </button>
          <button type="button" onClick={() => setMode('preview')}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${mode === 'preview' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
            <Eye size={10} /> Preview
          </button>
          <MarkdownEquationWarning errors={errors} />
        </div>
        {mode === 'source' && <span className="text-[9px] text-gray-400">GFM + $LaTeX$ · Ctrl/⌘+Enter to preview</span>}
      </div>
      {mode === 'rich' ? (
        <RichMarkdownEditor markdown={block.content} onChange={content => onChange({ content })} />
      ) : mode === 'source' ? (
        <textarea
          autoFocus={!block.content}
          value={block.content}
          onChange={event => onChange({ content: event.target.value })}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              setMode('preview')
            }
          }}
          placeholder={'Write Markdown…\n\n- Lists and **emphasis**\n- Inline math: $R(t)=e^{-\\lambda t}$'}
          className="w-full resize-y rounded border border-transparent bg-slate-50/60 px-2 py-1.5 font-mono text-[12px] leading-5 text-gray-700 focus:border-blue-200 focus:bg-white focus:outline-none"
          rows={Math.max(5, Math.min(24, (block.content?.split('\n').length ?? 1) + 2))}
        />
      ) : block.content.trim() ? (
        <ReportMarkdown>{block.content}</ReportMarkdown>
      ) : (
        <button type="button" onClick={() => setMode('rich')}
          className="w-full rounded border border-dashed border-gray-200 py-4 text-xs text-gray-400 hover:border-blue-300 hover:text-blue-600">
          Add Markdown text
        </button>
      )}
    </div>
  )
}

function ImportedImageBlockEditor({ block, onChange }: {
  block: ImageBlock
  onChange: (patch: Partial<ReportBlock>) => void
}) {
  const safe = isSafeReportImageDataUrl(block.dataUrl, block.mimeType)
  const justify = block.alignment === 'center' ? 'justify-center'
    : block.alignment === 'right' ? 'justify-end' : 'justify-start'
  return (
    <div className="space-y-2 px-1 py-2">
      <div className="flex flex-wrap items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1">
        <span className="max-w-48 truncate text-[10px] font-medium text-gray-500" title={block.fileName}>{block.fileName}</span>
        <label className="ml-auto text-[9px] font-medium text-gray-400">Width
          <select value={block.widthPercent} onChange={event => onChange({ widthPercent: Number(event.target.value) as ImageBlock['widthPercent'] })}
            className="ml-1 rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-600">
            {[25, 50, 75, 100].map(value => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
        <div className="flex rounded border border-gray-200 bg-white p-0.5" aria-label="Image alignment">
          {(['left', 'center', 'right'] as const).map(value => (
            <button key={value} type="button" onClick={() => onChange({ alignment: value })}
              className={`rounded px-1.5 py-0.5 text-[9px] capitalize ${block.alignment === value ? 'bg-blue-100 font-semibold text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className={`flex ${justify}`}>
        {safe ? <img src={block.dataUrl} alt={block.alt} draggable={false}
          style={{ width: `${block.widthPercent}%` }} className="h-auto max-w-full rounded-sm" />
          : <div role="alert" className="w-full rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">The stored image data is invalid or unsupported.</div>}
      </div>
      <input value={block.caption} onChange={event => onChange({ caption: event.target.value })}
        placeholder="Optional figure caption"
        className="w-full border-0 bg-transparent text-center text-xs italic text-gray-500 outline-none placeholder:text-gray-300" />
      <div className="flex items-center gap-2">
        <label className="shrink-0 text-[9px] font-medium text-gray-400">Alt text</label>
        <input value={block.alt} onChange={event => onChange({ alt: event.target.value })}
          placeholder="Describe the image for accessibility"
          className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-[10px] text-gray-600 focus:border-blue-300 focus:outline-none" />
        <span className="max-w-40 truncate font-mono text-[8px] text-gray-300" title={`SHA-256 ${block.sha256}`}>SHA-256 {block.sha256.slice(0, 12)}…</span>
      </div>
    </div>
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
      return <MarkdownTextBlockEditor block={block} onChange={onChange} />

    case 'image':
      return <ImportedImageBlockEditor block={block} onChange={onChange} />

    case 'plot':
      return (
        <div className="py-2">
          <div className="mb-1 flex items-center gap-2 px-1">
            <InlineEditableLabel
              value={block.label}
              onChange={v => onChange({ label: v })}
            />
            {block.sourceKind === 'snapshot' && (
              <span title={block.snapshotSha256 ? `Immutable plot snapshot · SHA-256 ${block.snapshotSha256}` : 'Immutable plot snapshot'}
                className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700">
                <Camera size={9} /> Snapshot
              </span>
            )}
          </div>
          <div style={{ height: 400 }}>
            <Plot
              data={(block.plotData ?? []) as Plotly.Data[]}
              layout={{
                ...(block.plotLayout as Record<string, unknown>),
                autosize: true,
                margin: { t: 30, r: 20, b: 50, l: 60 },
              } as AnyLayout}
              config={RB_PLOT_CONFIG}
              plotId={`report-block-${block.id}`}
              plotMarkup={block.plotMarkup ?? EMPTY_PLOT_MARKUP}
              onPlotMarkupChange={plotMarkup => onChange({ plotMarkup })}
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
            <div className="px-1 mb-1">
              <InlineEditableLabel
                value={block.label}
                onChange={v => onChange({ label: v })}
              />
            </div>
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
            <div className="px-1 mb-1">
              <InlineEditableLabel
                value={block.label}
                onChange={v => onChange({ label: v })}
              />
            </div>
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
