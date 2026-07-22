import { useEffect, useRef, useState } from 'react'
import {
  Bold, Braces, Code2, Italic, Link, List, ListOrdered,
  Minus, Quote, Sigma, Strikethrough, Table2,
} from 'lucide-react'
import {
  markdownToHtmlFragment,
  richHtmlToMarkdown,
  safeMarkdownUrl,
} from './reportMarkdown'

interface Props {
  markdown: string
  onChange: (markdown: string) => void
}

function ToolbarButton({ label, children, onClick }: {
  label: string
  children: React.ReactNode
  onClick: () => void
}) {
  return <button type="button" title={label} aria-label={label}
    onMouseDown={event => event.preventDefault()} onClick={onClick}
    className="rounded p-1 text-gray-500 hover:bg-blue-50 hover:text-blue-700">
    {children}
  </button>
}

/** Controlled rich editor whose only persisted output is sanitized Markdown. */
export default function RichMarkdownEditor({ markdown, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef<string | null>(null)
  const renderSequence = useRef(0)
  const savedRange = useRef<Range | null>(null)
  const [loading, setLoading] = useState(true)

  const prepareRenderedDom = () => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('.katex').forEach(node => {
      node.contentEditable = 'false'
      node.setAttribute('title', 'Edit this equation in Markdown source mode.')
    })
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(node => {
      node.disabled = false
      node.contentEditable = 'false'
    })
  }

  useEffect(() => {
    if (lastEmitted.current === markdown) return
    const sequence = ++renderSequence.current
    setLoading(true)
    void markdownToHtmlFragment(markdown).then(html => {
      if (sequence !== renderSequence.current || !rootRef.current) return
      rootRef.current.innerHTML = html || '<p><br></p>'
      prepareRenderedDom()
      setLoading(false)
    })
  }, [markdown])

  const emit = () => {
    if (!rootRef.current) return
    const next = richHtmlToMarkdown(rootRef.current.innerHTML)
    lastEmitted.current = next
    onChange(next)
  }

  const rememberSelection = () => {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (range && rootRef.current?.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange()
    }
  }

  const restoreSelection = () => {
    rootRef.current?.focus()
    const range = savedRange.current
    if (!range || !rootRef.current?.contains(range.commonAncestorContainer)) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const command = (name: string, value?: string) => {
    restoreSelection()
    document.execCommand(name, false, value)
    rememberSelection()
    emit()
  }

  const createLink = () => {
    const requested = window.prompt('Link URL (https, http, or mailto):')?.trim()
    if (!requested) return
    const href = safeMarkdownUrl(requested)
    if (!href) {
      window.alert('Use an http, https, or mailto URL.')
      return
    }
    command('createLink', href)
  }

  const insertTable = () => {
    const rows = Math.min(10, Math.max(1, Number.parseInt(window.prompt('Table body rows (1–10):', '2') ?? '', 10) || 2))
    const columns = Math.min(8, Math.max(1, Number.parseInt(window.prompt('Table columns (1–8):', '2') ?? '', 10) || 2))
    const header = `<thead><tr>${Array.from({ length: columns }, (_, index) => `<th>Column ${index + 1}</th>`).join('')}</tr></thead>`
    const body = `<tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: columns }, () => '<td>Value</td>').join('')}</tr>`).join('')}</tbody>`
    command('insertHTML', `<table>${header}${body}</table><p><br></p>`)
  }

  const insertMath = () => {
    const expression = window.prompt('LaTeX expression:')?.trim()
    if (!expression) return
    const display = window.confirm('Use a display equation? Select Cancel for inline math.')
    command('insertText', display ? `\n$$\n${expression}\n$$\n` : `$${expression}$`)
    // Re-render once so the inserted source becomes a protected KaTeX node.
    const next = lastEmitted.current ?? markdown
    lastEmitted.current = null
    const sequence = ++renderSequence.current
    void markdownToHtmlFragment(next).then(html => {
      if (sequence !== renderSequence.current || !rootRef.current) return
      rootRef.current.innerHTML = html
      prepareRenderedDom()
    })
  }

  return (
    <div className="overflow-hidden rounded border border-blue-200 bg-white">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-blue-100 bg-blue-50/60 px-1.5 py-1">
        <select aria-label="Text style" defaultValue="p" onChange={event => command('formatBlock', event.target.value)}
          className="mr-1 rounded border border-blue-100 bg-white px-1 py-0.5 text-[10px] text-gray-600">
          <option value="p">Paragraph</option><option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option><option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option><option value="pre">Code block</option>
        </select>
        <ToolbarButton label="Bold" onClick={() => command('bold')}><Bold size={13} /></ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => command('italic')}><Italic size={13} /></ToolbarButton>
        <ToolbarButton label="Strikethrough" onClick={() => command('strikeThrough')}><Strikethrough size={13} /></ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-blue-100" />
        <ToolbarButton label="Bulleted list" onClick={() => command('insertUnorderedList')}><List size={13} /></ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => command('insertOrderedList')}><ListOrdered size={13} /></ToolbarButton>
        <ToolbarButton label="Block quote" onClick={() => command('formatBlock', 'blockquote')}><Quote size={13} /></ToolbarButton>
        <ToolbarButton label="Code block" onClick={() => command('formatBlock', 'pre')}><Code2 size={13} /></ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-blue-100" />
        <ToolbarButton label="Link" onClick={createLink}><Link size={13} /></ToolbarButton>
        <ToolbarButton label="Table" onClick={insertTable}><Table2 size={13} /></ToolbarButton>
        <ToolbarButton label="Equation" onClick={insertMath}><Sigma size={13} /></ToolbarButton>
        <ToolbarButton label="Horizontal rule" onClick={() => command('insertHorizontalRule')}><Minus size={13} /></ToolbarButton>
        <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-gray-400"><Braces size={10} /> Markdown-backed</span>
      </div>
      <div className="relative">
        {loading && <div className="absolute inset-x-0 top-0 z-10 bg-white/80 px-2 py-1 text-[9px] text-gray-400">Preparing rich editor…</div>}
        <div ref={rootRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
          onInput={() => { rememberSelection(); emit() }} onChange={() => { rememberSelection(); emit() }}
          onMouseUp={rememberSelection} onKeyUp={rememberSelection} onFocus={rememberSelection}
          onPaste={event => {
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
            emit()
          }}
          onDrop={event => {
            event.preventDefault()
            const text = event.dataTransfer.getData('text/plain')
            if (text) document.execCommand('insertText', false, text)
            emit()
          }}
          className="report-markdown min-h-32 px-3 py-2 text-sm leading-relaxed text-gray-700 outline-none focus:ring-1 focus:ring-inset focus:ring-blue-300" />
      </div>
      <p className="border-t border-gray-100 px-2 py-1 text-[9px] text-gray-400">
        Equations are protected in Rich mode; switch to Markdown to edit their LaTeX source. Pasted content is inserted as plain text.
      </p>
    </div>
  )
}
