import type { jsPDF } from 'jspdf'

export interface PdfTableFlow {
  x: number; width: number; topY: number; bottomY: number
  getY: () => number; setY: (value: number) => void; newPage: () => void
}

/** Wrap every cell and split oversized rows across pages without discarding text. */
export function renderReportTablePdf(pdf: jsPDF, headers: string[], rows: (string | number)[][],
  flow: PdfTableFlow): void {
  const columns = Math.max(headers.length, ...rows.map(row => row.length), 1)
  const columnWidth = flow.width / columns
  const padding = 1.5, lineHeight = 3.6
  const pageHeight = flow.bottomY - flow.topY
  if (pageHeight < lineHeight + padding * 2) throw new Error('Report margins leave no room for table text.')
  pdf.setFontSize(8)
  const wrap = (values: (string | number)[]) => Array.from({ length: columns }, (_, index) =>
    pdf.splitTextToSize(String(values[index] ?? ''), Math.max(1, columnWidth - padding * 2)) as string[])
  pdf.setFont('helvetica', 'bold')
  const headerLines = wrap(headers)
  const headerHeight = Math.max(1, ...headerLines.map(lines => lines.length)) * lineHeight + padding * 2
  const repeatHeader = headers.length > 0 && headerHeight <= pageHeight * 0.4

  const draw = (cells: string[][], heading: boolean) => {
    const total = Math.max(1, ...cells.map(lines => lines.length))
    let offset = 0
    while (offset < total) {
      if (flow.bottomY - flow.getY() < lineHeight + padding * 2) {
        flow.newPage()
        if (!heading && repeatHeader) draw(headerLines, true)
      }
      const count = Math.min(total - offset,
        Math.max(1, Math.floor((flow.bottomY - flow.getY() - padding * 2) / lineHeight)))
      const y = flow.getY(), height = count * lineHeight + padding * 2
      pdf.setFont('helvetica', heading ? 'bold' : 'normal')
      pdf.setTextColor(heading ? 51 : 71, heading ? 65 : 85, heading ? 85 : 105)
      if (heading) { pdf.setFillColor(241, 245, 249); pdf.rect(flow.x, y, flow.width, height, 'F') }
      cells.forEach((lines, column) => lines.slice(offset, offset + count).forEach((line, index) =>
        pdf.text(line, flow.x + column * columnWidth + padding, y + padding + 2.7 + index * lineHeight)))
      pdf.setDrawColor(229, 231, 235)
      pdf.line(flow.x, y + height, flow.x + flow.width, y + height)
      flow.setY(y + height)
      offset += count
    }
  }
  if (headers.length) {
    if (headerHeight <= pageHeight && flow.getY() + headerHeight + lineHeight + padding * 2 > flow.bottomY) flow.newPage()
    draw(headerLines, true)
  }
  for (const row of rows) { pdf.setFont('helvetica', 'normal'); draw(wrap(row), false) }
  flow.setY(flow.getY() + 4)
}
