import katex from 'katex'
import type { jsPDF } from 'jspdf'
import {
  markdownPlainText,
  parseReportMarkdown,
  safeMarkdownUrl,
  type MarkdownNode,
} from './reportMarkdown'

export interface MarkdownPdfFlow {
  x: number
  width: number
  bottomY: number
  getY: () => number
  setY: (value: number) => void
  ensureSpace: (height: number) => void
  newPage: () => void
}

interface TextStyle {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  link?: string
}

interface TextRun extends TextStyle {
  kind: 'text'
  text: string
}

interface MathRun {
  kind: 'math'
  source: string
  image?: string
  aspect?: number
}

type InlineRun = TextRun | MathRun

const mmPerPoint = 0.352778

function fontStyle(style: TextStyle): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  if (style.bold && style.italic) return 'bolditalic'
  if (style.bold) return 'bold'
  if (style.italic) return 'italic'
  return 'normal'
}

async function mathPng(expression: string, displayMode: boolean): Promise<{ image: string; aspect: number } | null> {
  if (typeof document === 'undefined') return null
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed', left: '-100000px', top: '0', zIndex: '-1',
    display: 'inline-block', padding: displayMode ? '8px 10px' : '2px 3px',
    color: '#1e293b', background: '#ffffff', fontSize: displayMode ? '18px' : '15px',
  })
  document.body.appendChild(host)
  try {
    katex.render(expression, host, {
      displayMode,
      throwOnError: true,
      strict: false,
      trust: false,
      output: 'html',
    })
    await document.fonts?.ready
    const rect = host.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const { toPng } = await import('html-to-image')
    const image = await toPng(host, { pixelRatio: 2, backgroundColor: '#ffffff' })
    return { image, aspect: rect.width / rect.height }
  } catch {
    return null
  } finally {
    host.remove()
  }
}

async function inlineRuns(nodes: MarkdownNode[], inherited: TextStyle = {}): Promise<InlineRun[]> {
  const out: InlineRun[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text': out.push({ kind: 'text', text: node.value ?? '', ...inherited }); break
      case 'break': out.push({ kind: 'text', text: '\n', ...inherited }); break
      case 'inlineCode': out.push({ kind: 'text', text: node.value ?? '', ...inherited, code: true }); break
      case 'inlineMath': {
        const rendered = await mathPng(node.value ?? '', false)
        out.push({ kind: 'math', source: node.value ?? '', image: rendered?.image, aspect: rendered?.aspect })
        break
      }
      case 'strong': out.push(...await inlineRuns(node.children ?? [], { ...inherited, bold: true })); break
      case 'emphasis': out.push(...await inlineRuns(node.children ?? [], { ...inherited, italic: true })); break
      case 'delete': out.push(...await inlineRuns(node.children ?? [], { ...inherited, strike: true })); break
      case 'link': out.push(...await inlineRuns(node.children ?? [], {
        ...inherited,
        link: safeMarkdownUrl(node.url ?? '') ?? undefined,
      })); break
      case 'image': out.push({ kind: 'text', text: `[Image omitted: ${node.alt || 'image'}]`, italic: true }); break
      default: if (node.children) out.push(...await inlineRuns(node.children, inherited)); break
    }
  }
  return out
}

async function renderInline(
  pdf: jsPDF,
  nodes: MarkdownNode[],
  flow: MarkdownPdfFlow,
  options: {
    fontSize?: number
    indent?: number
    prefix?: string
    color?: [number, number, number]
    baseStyle?: TextStyle
  } = {},
) {
  const fontSize = options.fontSize ?? 10.5
  const fontMm = fontSize * mmPerPoint
  const lineHeight = fontMm * 1.38
  const indent = options.indent ?? 0
  const left = flow.x + indent
  const right = flow.x + flow.width
  let cursorX = left
  let lineTop = flow.getY()
  const runs = await inlineRuns(nodes, options.baseStyle)
  if (options.prefix) runs.unshift({ kind: 'text', text: options.prefix, bold: true })

  const nextLine = () => {
    flow.setY(lineTop + lineHeight)
    flow.ensureSpace(lineHeight)
    lineTop = flow.getY()
    cursorX = left
  }
  flow.ensureSpace(lineHeight)
  lineTop = flow.getY()

  for (const run of runs) {
    if (run.kind === 'math') {
      if (!run.image || !run.aspect) {
        const fallback: TextRun = { kind: 'text', text: `$${run.source}$`, code: true }
        runs.splice(runs.indexOf(run) + 1, 0, fallback)
        continue
      }
      const height = fontMm * 1.45
      const width = Math.min(height * run.aspect, flow.width - indent)
      if (cursorX > left && cursorX + width > right) nextLine()
      pdf.addImage(run.image, 'PNG', cursorX, lineTop + Math.max(0, lineHeight - height) / 2, width, height)
      cursorX += width + 0.8
      continue
    }

    const chunks = run.text.split(/(\n|\s+)/).filter(value => value !== '')
    for (const chunk of chunks) {
      if (chunk === '\n') { nextLine(); continue }
      const whitespace = /^\s+$/.test(chunk)
      if (whitespace && cursorX === left) continue
      pdf.setFont(run.code ? 'courier' : 'helvetica', run.code ? 'normal' : fontStyle(run))
      pdf.setFontSize(run.code ? fontSize * 0.92 : fontSize)
      const display = whitespace ? ' ' : chunk
      const width = pdf.getTextWidth(display)
      if (!whitespace && cursorX > left && cursorX + width > right) nextLine()
      if (width > flow.width - indent && !whitespace) {
        const pieces = pdf.splitTextToSize(display, flow.width - indent) as string[]
        for (const piece of pieces) {
          if (cursorX > left) nextLine()
          pdf.text(piece, cursorX, lineTop + fontMm)
          nextLine()
        }
        continue
      }
      if (run.code && !whitespace) {
        pdf.setFillColor(241, 245, 249)
        pdf.roundedRect(cursorX - 0.4, lineTop + 0.2, width + 0.8, lineHeight - 0.4, 0.5, 0.5, 'F')
      }
      const color = run.link ? [29, 78, 216] as [number, number, number]
        : options.color ?? [51, 65, 85]
      pdf.setTextColor(...color)
      pdf.text(display, cursorX, lineTop + fontMm)
      if (run.strike && !whitespace) {
        pdf.setDrawColor(...color)
        pdf.setLineWidth(0.15)
        pdf.line(cursorX, lineTop + fontMm * 0.62, cursorX + width, lineTop + fontMm * 0.62)
      }
      if (run.link && !whitespace) {
        pdf.setDrawColor(147, 197, 253)
        pdf.line(cursorX, lineTop + fontMm + 0.35, cursorX + width, lineTop + fontMm + 0.35)
        pdf.link(cursorX, lineTop, width, lineHeight, { url: run.link })
      }
      cursorX += width
    }
  }
  flow.setY(lineTop + lineHeight)
}

async function renderTable(pdf: jsPDF, table: MarkdownNode, flow: MarkdownPdfFlow) {
  const rows = table.children ?? []
  if (!rows.length) return
  const columns = Math.max(1, ...rows.map(row => row.children?.length ?? 0))
  const cellWidth = flow.width / columns
  const fontSize = 8.5
  const lineHeight = fontSize * mmPerPoint * 1.35

  const measure = (row: MarkdownNode) => Math.max(lineHeight + 2,
    ...(row.children ?? []).map(cell => {
      pdf.setFontSize(fontSize)
      pdf.setFont('helvetica', 'normal')
      return (pdf.splitTextToSize(markdownPlainText(cell), cellWidth - 2) as string[]).length * lineHeight + 2
    }))

  const drawRow = (row: MarkdownNode, header: boolean) => {
    const rowHeight = measure(row)
    const y = flow.getY()
    ;(row.children ?? []).forEach((cell, index) => {
      const x = flow.x + index * cellWidth
      if (header) {
        pdf.setFillColor(241, 245, 249)
        pdf.rect(x, y, cellWidth, rowHeight, 'F')
      }
      pdf.setDrawColor(203, 213, 225)
      pdf.setLineWidth(0.15)
      pdf.rect(x, y, cellWidth, rowHeight)
      pdf.setFont('helvetica', header ? 'bold' : 'normal')
      pdf.setFontSize(fontSize)
      pdf.setTextColor(51, 65, 85)
      const lines = pdf.splitTextToSize(markdownPlainText(cell), cellWidth - 2) as string[]
      lines.forEach((line, lineIndex) => pdf.text(line, x + 1, y + 1.2 + (lineIndex + 1) * lineHeight - 0.6))
    })
    flow.setY(y + rowHeight)
  }

  rows.forEach((row, index) => {
    const rowHeight = measure(row)
    if (flow.getY() + rowHeight > flow.bottomY) {
      flow.newPage()
      if (index > 0) drawRow(rows[0], true)
    }
    drawRow(row, index === 0)
  })
  flow.setY(flow.getY() + 3)
}

async function renderList(
  pdf: jsPDF,
  list: MarkdownNode,
  flow: MarkdownPdfFlow,
  depth = 0,
) {
  let number = list.start ?? 1
  for (const item of list.children ?? []) {
    const prefix = item.checked == null
      ? (list.ordered ? `${number}. ` : '• ')
      : `${item.checked ? '[x]' : '[ ]'} `
    const children = item.children ?? []
    const first = children[0]
    if (first?.type === 'paragraph') {
      await renderInline(pdf, first.children ?? [], flow, {
        indent: Math.min(depth * 5, 20), prefix,
      })
    }
    for (const child of children.slice(first?.type === 'paragraph' ? 1 : 0)) {
      if (child.type === 'list') await renderList(pdf, child, flow, depth + 1)
      else await renderBlock(pdf, child, flow, Math.min((depth + 1) * 5, 20))
    }
    number += 1
  }
  flow.setY(flow.getY() + 1)
}

async function renderDisplayMath(pdf: jsPDF, node: MarkdownNode, flow: MarkdownPdfFlow) {
  const rendered = await mathPng(node.value ?? '', true)
  if (!rendered) {
    await renderInline(pdf, [{ type: 'inlineCode', value: `$$${node.value ?? ''}$$` }], flow)
    return
  }
  const maxWidth = flow.width * 0.94
  const width = Math.min(maxWidth, 42 * rendered.aspect)
  const height = width / rendered.aspect
  flow.ensureSpace(height + 5)
  const y = flow.getY()
  pdf.addImage(rendered.image, 'PNG', flow.x + (flow.width - width) / 2, y + 1, width, height)
  flow.setY(y + height + 5)
}

async function renderBlock(
  pdf: jsPDF,
  node: MarkdownNode,
  flow: MarkdownPdfFlow,
  indent = 0,
) {
  switch (node.type) {
    case 'heading': {
      const depth = Number((node as MarkdownNode & { depth?: number }).depth ?? 2)
      const fontSize = depth === 1 ? 16 : depth === 2 ? 13 : depth === 3 ? 11.5 : 10.5
      flow.setY(flow.getY() + 2)
      await renderInline(pdf, node.children ?? [], flow, { fontSize, indent, baseStyle: { bold: true } })
      flow.setY(flow.getY() + 2)
      break
    }
    case 'paragraph':
      await renderInline(pdf, node.children ?? [], flow, { indent })
      flow.setY(flow.getY() + 2)
      break
    case 'list': await renderList(pdf, node, flow, Math.round(indent / 5)); break
    case 'blockquote': {
      const startPage = pdf.getNumberOfPages()
      const startY = flow.getY()
      for (const child of node.children ?? []) await renderBlock(pdf, child, flow, indent + 5)
      if (pdf.getNumberOfPages() === startPage) {
        pdf.setDrawColor(148, 163, 184)
        pdf.setLineWidth(0.8)
        pdf.line(flow.x + indent + 1, startY, flow.x + indent + 1, flow.getY() - 1)
      }
      break
    }
    case 'code': {
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(8.5)
      const lines = pdf.splitTextToSize(node.value ?? '', flow.width - indent - 6) as string[]
      const lineHeight = 3.7
      for (let index = 0; index < lines.length;) {
        const available = Math.max(1, Math.floor((flow.bottomY - flow.getY() - 4) / lineHeight))
        if (available <= 1) { flow.newPage(); continue }
        const pageLines = lines.slice(index, index + available)
        const height = pageLines.length * lineHeight + 4
        const y = flow.getY()
        pdf.setFillColor(248, 250, 252)
        pdf.setDrawColor(226, 232, 240)
        pdf.roundedRect(flow.x + indent, y, flow.width - indent, height, 1, 1, 'FD')
        pdf.setTextColor(30, 41, 59)
        pageLines.forEach((line, lineIndex) => pdf.text(line, flow.x + indent + 3, y + 3.2 + lineIndex * lineHeight))
        flow.setY(y + height + 2)
        index += pageLines.length
        if (index < lines.length) flow.newPage()
      }
      break
    }
    case 'math': await renderDisplayMath(pdf, node, flow); break
    case 'table': await renderTable(pdf, node, flow); break
    case 'thematicBreak': {
      flow.ensureSpace(5)
      const y = flow.getY() + 2
      pdf.setDrawColor(203, 213, 225)
      pdf.setLineWidth(0.25)
      pdf.line(flow.x + indent, y, flow.x + flow.width, y)
      flow.setY(y + 4)
      break
    }
    case 'html': break
    default:
      if (node.children) for (const child of node.children) await renderBlock(pdf, child, flow, indent)
  }
}

/** Render Markdown into the existing block-oriented jsPDF page flow. */
export async function renderReportMarkdownPdf(
  pdf: jsPDF,
  content: string,
  flow: MarkdownPdfFlow,
) {
  const tree = parseReportMarkdown(content)
  for (const node of tree.children ?? []) await renderBlock(pdf, node, flow)
}
