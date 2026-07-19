// html-to-image and jspdf are dynamically imported inside exportDiagram so they
// load only when the user exports, not on first module visit.
import type { ReactFlowInstance } from '@xyflow/react'

export type DiagramFormat = 'svg' | 'png' | 'jpg' | 'pdf'
export type DiagramExportPreparation = () => void | (() => void) | Promise<void | (() => void)>

/**
 * Temporarily fit the complete React Flow model to its canvas for export. The
 * editor viewport is restored after capture, so exporting never changes where
 * the user was working.
 */
export async function fitReactFlowForExport(
  instance: ReactFlowInstance | null,
): Promise<void | (() => void)> {
  if (!instance) return
  const viewport = instance.getViewport()
  await instance.fitView({
    padding: 0.06,
    minZoom: 0.05,
    maxZoom: 1.6,
    duration: 0,
    includeHiddenNodes: true,
  })
  // React Flow commits the transform on an animation frame. Waiting for two
  // frames ensures html-to-image sees the fitted transform and final edge paths.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  return () => { void instance.setViewport(viewport, { duration: 0 }) }
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

/**
 * React Flow draws connectors in nested `.react-flow__edges` SVG layers whose
 * stroke comes from the imported stylesheet, and some edges are animated
 * (dashed). html-to-image often drops these because a percentage-sized SVG
 * collapses to zero in the detached clone, and an animated dash can be captured
 * mid-gap (invisible). Before capturing we therefore (a) pin each edge SVG to
 * explicit pixel dimensions, (b) inline the computed stroke onto every edge
 * path, and (c) freeze the dash to solid — then restore everything afterwards.
 */
async function withVisibleEdges<T>(
  element: HTMLElement, fn: () => Promise<T>,
): Promise<T> {
  const restore: (() => void)[] = []

  const svgs = element.querySelectorAll<SVGSVGElement>('.react-flow__edges')
  svgs.forEach(svg => {
    const rect = svg.getBoundingClientRect()
    const prevW = svg.getAttribute('width')
    const prevH = svg.getAttribute('height')
    if (rect.width && rect.height) {
      svg.setAttribute('width', String(rect.width))
      svg.setAttribute('height', String(rect.height))
      restore.push(() => {
        if (prevW === null) svg.removeAttribute('width'); else svg.setAttribute('width', prevW)
        if (prevH === null) svg.removeAttribute('height'); else svg.setAttribute('height', prevH)
      })
    }
  })

  const paths = element.querySelectorAll<SVGPathElement>(
    '.react-flow__edge-path, .react-flow__connection-path')
  paths.forEach(p => {
    const cs = getComputedStyle(p)
    const stroke = cs.stroke && cs.stroke !== 'none' ? cs.stroke : '#b1b1b7'
    const width = cs.strokeWidth && cs.strokeWidth !== '0px' ? cs.strokeWidth : '1.5px'
    const prev = p.getAttribute('style')
    p.style.stroke = stroke
    p.style.strokeWidth = width
    p.style.fill = 'none'
    p.style.strokeDasharray = 'none'
    restore.push(() => {
      if (prev === null) p.removeAttribute('style'); else p.setAttribute('style', prev)
    })
  })

  try {
    return await fn()
  } finally {
    restore.forEach(r => r())
  }
}

/**
 * Export a diagram DOM node (e.g. a ReactFlow wrapper) to SVG / PNG / JPG / PDF
 * (#19). Pass the element to capture and the desired format.
 */
function exportFilter(node: HTMLElement): boolean {
  if (node.tagName === 'BUTTON') return false
  if (node.dataset?.exportIgnore != null) return false
  // Canvas navigation aids belong to the editor, not the engineering figure.
  // Filtering their roots also excludes the snap-grid/dot pattern and every
  // child in the overview minimap from all supported export formats.
  if (node.classList?.contains('react-flow__background')) return false
  if (node.classList?.contains('react-flow__minimap')) return false
  if (node.classList?.contains('react-flow__controls')) return false
  if (node.classList?.contains('react-flow__panel')) return false
  if (node.classList?.contains('react-flow__attribution')) return false
  if (node.classList?.contains('react-flow__handle')) return false
  if (node.classList?.contains('react-flow__resize-control')) return false
  if (node.classList?.contains('react-flow__edgeupdater')) return false
  if (node.classList?.contains('react-flow__selection')) return false
  if (node.classList?.contains('react-flow__nodesselection')) return false
  return true
}

export async function exportDiagram(
  element: HTMLElement | null, format: DiagramFormat, baseName = 'diagram',
  prepareExport?: DiagramExportPreparation,
): Promise<void> {
  if (!element) throw new Error('Nothing to export.')
  const opts = { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true, filter: exportFilter }
  const { toSvg, toPng, toJpeg } = await import('html-to-image')
  const restoreViewport = await prepareExport?.()
  element.dataset.diagramExporting = 'true'
  try {
    return await withVisibleEdges(element, async () => {
      if (format === 'svg') {
        const dataUrl = await toSvg(element, { backgroundColor: '#ffffff', cacheBust: true, filter: exportFilter })
        triggerDownload(dataUrl, `${baseName}.svg`)
        return
      }
      if (format === 'png') {
        triggerDownload(await toPng(element, opts), `${baseName}.png`)
        return
      }
      if (format === 'jpg') {
        triggerDownload(await toJpeg(element, { ...opts, quality: 0.95 }), `${baseName}.jpg`)
        return
      }
      // PDF: rasterize to PNG, place on a page sized to the diagram.
      const png = await toPng(element, opts)
      const w = element.offsetWidth || 800
      const h = element.offsetHeight || 600
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({
        orientation: w >= h ? 'landscape' : 'portrait',
        unit: 'px',
        format: [w, h],
      })
      pdf.addImage(png, 'PNG', 0, 0, w, h)
      pdf.save(`${baseName}.pdf`)
    })
  } finally {
    delete element.dataset.diagramExporting
    restoreViewport?.()
  }
}
