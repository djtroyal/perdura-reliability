import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import domino from '@mixmark-io/domino'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  globalThis.document = domino.createWindow('<!doctype html><html><body></body></html>').document
  const markdown = await vite.ssrLoadModule('/src/components/ReportBuilder/reportMarkdown.tsx')
  const markdownPdf = await vite.ssrLoadModule('/src/components/ReportBuilder/reportMarkdownPdf.ts')
  const reportImage = await vite.ssrLoadModule('/src/components/ReportBuilder/reportImage.ts')
  const { jsPDF } = await import('jspdf')

  const source = `## Findings

The estimate is **conditional** and the mission reliability is $R(t)=e^{-\\lambda t}$.

- [x] Review assumptions
- [ ] Approve result

| Item | Value |
| --- | ---: |
| MTBF | 1000 h |

$$\\lambda = 2.5\\times10^{-6}$$
`
  const html = await markdown.markdownToHtmlFragment(source)
  assert.match(html, /<h2>Findings<\/h2>/)
  assert.match(html, /<strong>conditional<\/strong>/)
  assert.match(html, /type="checkbox" checked disabled/)
  assert.match(html, /<table>/)
  assert.match(html, /class="katex"/)
  assert.match(html, /class="katex-display"/)

  const preview = renderToStaticMarkup(markdown.ReportMarkdown({ children: source }))
  assert.match(preview, /report-markdown/)
  assert.match(preview, /class="katex"/)
  assert.match(preview, /class="katex-display"/)
  assert.match(preview, /task-list-item/)

  const roundTripped = markdown.richHtmlToMarkdown(html)
  assert.match(roundTripped, /## Findings/)
  assert.match(roundTripped, /\*\*conditional\*\*/)
  assert.match(roundTripped, /-\s+\[x\]\s+Review assumptions/)
  assert.match(roundTripped, /\| Item\s+\| Value\s+\|/)
  assert.match(roundTripped, /\$\$\n\\lambda = 2\.5\\times10\^\{-6\}\n\$\$/)

  const hostile = `<script>alert('x')</script>
[unsafe](javascript:alert(1))
[safe](https://example.com/evidence)
![remote evidence](https://example.com/tracker.png)`
  const safeHtml = await markdown.markdownToHtmlFragment(hostile)
  assert.doesNotMatch(safeHtml, /<script|javascript:|<img/i)
  assert.match(safeHtml, /Image omitted: remote evidence/)
  assert.match(safeHtml, /href="https:\/\/example\.com\/evidence"/)
  assert.match(safeHtml, /rel="noopener noreferrer"/)

  assert.equal(markdown.safeMarkdownUrl('data:text/html,unsafe'), null)
  assert.equal(markdown.safeMarkdownUrl('/relative/path'), null)
  assert.equal(markdown.safeMarkdownUrl('mailto:review@example.com'), 'mailto:review@example.com')
  const hostileRich = markdown.richHtmlToMarkdown('<p onclick="alert(1)">Safe <a href="javascript:alert(2)">label</a><script>alert(3)</script></p>')
  assert.equal(hostileRich, 'Safe label')
  assert.equal(markdown.markdownMathErrors('Valid: $x^2$').length, 0)
  assert.equal(markdown.markdownMathErrors('Invalid: $\\frac{1$').length, 1)

  const pdf = new jsPDF('p', 'mm', 'a4')
  let y = 15
  const bottomY = 282
  const newPage = () => { pdf.addPage(); y = 15 }
  await markdownPdf.renderReportMarkdownPdf(pdf, source.replaceAll('$', ''), {
    x: 15,
    width: 180,
    bottomY,
    getY: () => y,
    setY: value => { y = value },
    ensureSpace: height => { if (y + height > bottomY) newPage() },
    newPage,
  })
  assert.ok(y > 15)
  assert.ok(pdf.output('arraybuffer').byteLength > 1000)

  assert.equal(reportImage.isSafeReportImageDataUrl('data:image/png;base64,iVBORw0KGgo=', 'image/png'), true)
  assert.equal(reportImage.isSafeReportImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=', 'image/png'), false)
  assert.equal(reportImage.MAX_REPORT_IMAGE_BYTES, 10 * 1024 * 1024)

  const reportBuilder = await readFile(
    new URL('../src/components/ReportBuilder/index.tsx', import.meta.url), 'utf8')
  assert.match(reportBuilder, /label="Import Image"/)
  assert.match(reportBuilder, /case 'image'/)
  assert.match(reportBuilder, /renderReportMarkdownPdf/)
  assert.match(reportBuilder, /markdownToHtmlFragment/)
  assert.match(reportBuilder, /<RichMarkdownEditor/)
  assert.match(reportBuilder, /<div draggable onDragStart=\{\(\) => onDragStart\(idx\)\}/)
  assert.doesNotMatch(reportBuilder, /key=\{block\.id\}\s+draggable/)

  console.log('Report Builder Markdown and imported-image contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
