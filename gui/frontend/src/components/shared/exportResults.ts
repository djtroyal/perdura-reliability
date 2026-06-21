import { toPng } from 'html-to-image'
import { jsPDF } from 'jspdf'

/** Turn a file base name like "life_data" into a title "Life Data". */
function prettifyTitle(base: string): string {
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Exclude interactive chrome (buttons) and anything explicitly opted out
 *  via `data-export-ignore` from the rasterized output. */
function exportFilter(node: HTMLElement): boolean {
  if (!(node instanceof HTMLElement)) return true
  if (node.tagName === 'BUTTON') return false
  if (node.dataset && 'exportIgnore' in node.dataset) return false
  return true
}

/** Descend through single-child wrapper divs to find the real list of
 *  content blocks, so each chart/table/card paginates as its own unit. */
function contentBlocks(element: HTMLElement): HTMLElement[] {
  let container = element
  while (container.children.length === 1 && container.firstElementChild instanceof HTMLElement) {
    container = container.firstElementChild
  }
  const blocks = Array.from(container.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !('exportIgnore' in (c.dataset ?? {})),
  )
  return blocks.length > 0 ? blocks : [element]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
}

/** Slice a single image that is taller than one page across pages, cropping
 *  the source so margins are respected (no bleed into the margin area). */
function addSlicedImage(
  pdf: jsPDF, img: HTMLImageElement, x: number, y: number,
  drawW: number, margin: number, pageH: number,
): void {
  const scale = drawW / img.width            // pt per source px
  const usableHpt = pageH - margin - y       // remaining space on first page
  const fullUsableHpt = pageH - margin * 2   // on subsequent pages
  let srcY = 0
  let firstPage = true
  while (srcY < img.height) {
    const availPt = firstPage ? usableHpt : fullUsableHpt
    const sliceHpx = Math.min(img.height - srcY, availPt / scale)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = Math.ceil(sliceHpx)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, srcY, img.width, sliceHpx, 0, 0, img.width, sliceHpx)
    const png = canvas.toDataURL('image/png')
    const drawY = firstPage ? y : margin
    pdf.addImage(png, 'PNG', x, drawY, drawW, sliceHpx * scale)
    srcY += sliceHpx
    if (srcY < img.height) {
      pdf.addPage()
      firstPage = false
    }
  }
}

/**
 * Export an analysis-results DOM node to a cleanly formatted, multi-page A4
 * PDF: a titled header, page margins, and block-aware pagination so charts
 * and tables are not sliced across page breaks.
 */
export async function exportResultsToPdf(
  element: HTMLElement | null, baseName = 'results', title?: string,
): Promise<void> {
  if (!element) throw new Error('Nothing to export.')

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 36 // 0.5 inch
  const contentW = pageW - margin * 2

  // --- Header ---
  let cursorY = margin
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text(title ?? prettifyTitle(baseName), margin, cursorY + 6)
  cursorY += 22
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(120)
  pdf.text(`Perdura • exported ${new Date().toLocaleString()}`, margin, cursorY)
  pdf.setTextColor(0)
  cursorY += 10
  pdf.setDrawColor(220)
  pdf.line(margin, cursorY, pageW - margin, cursorY)
  cursorY += 14

  // --- Content blocks ---
  const blocks = contentBlocks(element)
  const opts = { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true, filter: exportFilter }
  const gap = 12

  for (const block of blocks) {
    if (block.offsetHeight === 0 || block.offsetWidth === 0) continue
    let png: string
    try {
      png = await toPng(block, opts)
    } catch {
      continue
    }
    const img = await loadImage(png)
    const drawW = contentW
    const drawH = (img.height * drawW) / img.width
    const usableH = pageH - margin * 2

    if (drawH <= usableH) {
      // Fits on a page: start a new page if it won't fit in the remaining space.
      if (cursorY + drawH > pageH - margin && cursorY > margin) {
        pdf.addPage()
        cursorY = margin
      }
      pdf.addImage(png, 'PNG', margin, cursorY, drawW, drawH)
      cursorY += drawH + gap
    } else {
      // Taller than a page: place on a fresh page and slice cleanly. Mark the
      // page as full so the next block (if any) starts a new page — avoids a
      // trailing blank page when this is the last block.
      if (cursorY > margin) {
        pdf.addPage()
        cursorY = margin
      }
      addSlicedImage(pdf, img, margin, cursorY, drawW, margin, pageH)
      cursorY = pageH - margin
    }
  }

  pdf.save(`${baseName}.pdf`)
}
