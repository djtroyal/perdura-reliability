import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import katex from 'katex'
import TurndownService from 'turndown'
import { gfm as turndownGfm } from 'turndown-plugin-gfm'
import 'katex/dist/katex.min.css'

export interface MarkdownNode {
  type: string
  value?: string
  url?: string
  alt?: string
  title?: string | null
  checked?: boolean | null
  ordered?: boolean
  start?: number | null
  align?: Array<'left' | 'right' | 'center' | null>
  children?: MarkdownNode[]
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Accept the familiar one-line `$$formula$$` spelling as display math. */
export function normalizeMarkdownMathSyntax(content: string): string {
  return content.replace(/^([ \t]*)\$\$([^\n]+?)\$\$[ \t]*$/gm,
    (_match, indent: string, expression: string) => `${indent}$$\n${expression.trim()}\n${indent}$$`)
}

/** Allow only auditable, non-executable link targets in authored reports. */
export function safeMarkdownUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('#')) return trimmed
  try {
    const parsed = new URL(trimmed)
    return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

function walkMarkdown(
  node: MarkdownNode,
  visitor: (node: MarkdownNode, parent?: MarkdownNode, index?: number) => void,
  parent?: MarkdownNode,
  index?: number,
) {
  visitor(node, parent, index)
  node.children?.forEach((child, childIndex) => walkMarkdown(child, visitor, node, childIndex))
}

/** Security transform shared by HTML and PDF serialization. */
function remarkSecureReportMarkdown() {
  return (tree: MarkdownNode) => {
    walkMarkdown(tree, (node, parent, index) => {
      if (node.type === 'link') node.url = safeMarkdownUrl(node.url ?? '') ?? ''
      if (node.type === 'image' && parent?.children && index != null) {
        const label = node.alt?.trim() || 'image'
        parent.children[index] = {
          type: 'text',
          value: `[Image omitted: ${label}]`,
        }
      }
    })
  }
}

function rehypeSafeLinks() {
  return (tree: MarkdownNode) => {
    walkMarkdown(tree, node => {
      const element = node as MarkdownNode & {
        tagName?: string
        properties?: Record<string, unknown>
      }
      if (element.tagName !== 'a' || !element.properties) return
      const href = safeMarkdownUrl(String(element.properties.href ?? ''))
      if (!href) {
        delete element.properties.href
        return
      }
      element.properties.href = href
      element.properties.target = '_blank'
      element.properties.rel = ['noopener', 'noreferrer']
    })
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkSecureReportMarkdown)

/** Parse the exact Markdown dialect used by preview and both exports. */
export function parseReportMarkdown(content: string): MarkdownNode {
  const normalized = normalizeMarkdownMathSyntax(content)
  return processor.runSync(processor.parse(normalized)) as MarkdownNode
}

export interface MarkdownMathError {
  expression: string
  display: boolean
  message: string
}

export function markdownMathErrors(content: string): MarkdownMathError[] {
  const errors: MarkdownMathError[] = []
  const tree = parseReportMarkdown(content)
  walkMarkdown(tree, node => {
    if (node.type !== 'math' && node.type !== 'inlineMath') return
    try {
      katex.renderToString(node.value ?? '', {
        displayMode: node.type === 'math',
        throwOnError: true,
        strict: false,
        trust: false,
      })
    } catch (cause) {
      errors.push({
        expression: node.value ?? '',
        display: node.type === 'math',
        message: cause instanceof Error ? cause.message : 'Invalid LaTeX expression.',
      })
    }
  })
  return errors
}

/** Produce a safe fragment for the downloaded HTML report. */
export async function markdownToHtmlFragment(content: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkSecureReportMarkdown)
    // Raw HTML is intentionally not passed through.
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeKatex, { throwOnError: false, strict: false, trust: false })
    .use(rehypeSafeLinks)
    .use(rehypeStringify)
    .process(normalizeMarkdownMathSyntax(content))
  return String(result)
}

/** Convert the controlled rich editor DOM back to canonical GFM source. */
export function richHtmlToMarkdown(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script,style,iframe,object,embed,img,svg,form').forEach(node => node.remove())
  template.content.querySelectorAll<HTMLElement>('*').forEach(node => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name)
    }
    if (node.tagName === 'A') {
      const href = safeMarkdownUrl(node.getAttribute('href') ?? '')
      if (href) node.setAttribute('href', href)
      else node.removeAttribute('href')
    }
  })

  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })
  service.use(turndownGfm)
  service.addRule('katexEquation', {
    filter: node => node.nodeName === 'SPAN' && node.classList.contains('katex'),
    replacement: (_content, node) => {
      const expression = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ?? ''
      if (!expression) return ''
      const display = node.parentElement?.classList.contains('katex-display')
      return display ? `\n\n$$\n${expression}\n$$\n\n` : `$${expression}$`
    },
  })
  return service.turndown(template.content).replace(/\n{3,}/g, '\n\n').trim()
}

function ExternalLink(props: ComponentPropsWithoutRef<'a'>) {
  const href = safeMarkdownUrl(props.href ?? '')
  if (!href) return <span className="text-gray-700">{props.children}</span>
  return <a {...props} href={href} target="_blank" rel="noopener noreferrer"
    className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900" />
}

function OmittedImage({ alt }: { alt?: string }) {
  return <span className="rounded bg-gray-100 px-1 py-0.5 text-xs italic text-gray-500">
    [Image omitted: {alt?.trim() || 'image'}]
  </span>
}

function Code({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
  const fenced = /language-/.test(className ?? '') || String(children).includes('\n')
  if (fenced) return <code {...props} className={`${className ?? ''} font-mono text-[12px]`}>{children}</code>
  return <code {...props} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-800">{children}</code>
}

/** Safe GFM + KaTeX preview used by Report Builder text blocks. */
export function ReportMarkdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`report-markdown text-sm leading-relaxed text-gray-700 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, trust: false }]]}
        skipHtml
        urlTransform={url => safeMarkdownUrl(url) ?? ''}
        components={{
          a: ExternalLink,
          img: OmittedImage,
          h1: ({ children: value }) => <h1 className="mb-2 mt-4 text-xl font-bold text-gray-900">{value}</h1>,
          h2: ({ children: value }) => <h2 className="mb-2 mt-4 text-lg font-bold text-gray-900">{value}</h2>,
          h3: ({ children: value }) => <h3 className="mb-1.5 mt-3 text-base font-semibold text-gray-900">{value}</h3>,
          h4: ({ children: value }) => <h4 className="mb-1 mt-3 text-sm font-semibold text-gray-900">{value}</h4>,
          p: ({ children: value }) => <p className="my-2">{value}</p>,
          ul: ({ children: value, className: valueClass }) => <ul className={`my-2 list-disc space-y-1 pl-6 ${valueClass ?? ''}`}>{value}</ul>,
          ol: ({ children: value, className: valueClass }) => <ol className={`my-2 list-decimal space-y-1 pl-6 ${valueClass ?? ''}`}>{value}</ol>,
          li: ({ children: value, className: valueClass }) => <li className={`pl-0.5 ${valueClass?.includes('task-list-item') ? 'list-none' : ''} ${valueClass ?? ''}`}>{value}</li>,
          blockquote: ({ children: value }) => <blockquote className="my-3 border-l-4 border-slate-300 bg-slate-50 px-3 py-1 text-slate-600">{value}</blockquote>,
          pre: ({ children: value }) => <pre className="my-3 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px] leading-5 text-slate-800">{value}</pre>,
          code: Code,
          table: ({ children: value }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-xs">{value}</table></div>,
          th: ({ children: value }) => <th className="border border-slate-300 bg-slate-100 px-2 py-1.5 text-left font-semibold text-slate-700">{value}</th>,
          td: ({ children: value }) => <td className="border border-slate-200 px-2 py-1.5 align-top">{value}</td>,
          hr: () => <hr className="my-4 border-slate-200" />,
        }}
      >{normalizeMarkdownMathSyntax(children)}</ReactMarkdown>
    </div>
  )
}

export function MarkdownEquationWarning({ errors }: { errors: MarkdownMathError[] }) {
  if (!errors.length) return null
  const title = errors.map(error => `${error.display ? 'Display' : 'Inline'} equation: ${error.message}`).join('\n')
  return <span title={title} className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
    {errors.length} equation{errors.length === 1 ? '' : 's'} could not be rendered
  </span>
}

export function markdownPlainText(node: MarkdownNode): string {
  if (node.value) return node.value
  if (node.type === 'image') return `[Image omitted: ${node.alt || 'image'}]`
  return (node.children ?? []).map(markdownPlainText).join('')
}

export const KATEX_STYLESHEET_URL = `https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css`

export type MarkdownChildren = ReactNode
