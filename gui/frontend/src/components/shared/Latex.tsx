import {
  useCallback, useEffect, useMemo, useRef, useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { EquationSymbolBinding } from '../../api/client'

/** Convert model-supplied handbook notation to KaTeX-friendly syntax. */
export function formulaToLatex(formula: string): string {
  const eq = formula.indexOf('=')
  if (eq >= 0 && formula.slice(eq + 1).trim().startsWith('user-specified')) {
    const lhs = formulaToLatex(formula.slice(0, eq).trim())
    const description = formula.slice(eq + 1).trim().replace(/([{}_$%&#])/g, String.raw`\$1`)
    return `${lhs} = \\text{${description}}`
  }
  const subscript = (symbol: string, name: string) =>
    `${symbol}_{${name.length === 1 ? name : `\\mathrm{${name}}`}}`
  return formula
    .replace(/T_HS/g, String.raw`T_{\mathrm{HS}}`)
    .replace(/λ([A-Za-z0-9]+)/g, (_, name: string) => subscript(String.raw`\lambda`, name))
    .replace(/π([A-Za-z0-9]+)/g, (_, name: string) => subscript(String.raw`\pi`, name))
    .replace(/α([A-Za-z0-9]+)/g, (_, name: string) => subscript(String.raw`\alpha`, name))
    .replace(/σ([A-Za-z0-9]+)/g, (_, name: string) => subscript(String.raw`\sigma`, name))
    .replace(/Δ/g, String.raw`\Delta `)
    .replace(/Σ/g, String.raw`\sum_i`)
    .replace(/\b([A-Z])([0-9]+)\b/g, '$1_{$2}')
    .replace(/\b([A-Z])i\b/g, '$1_i')
    .replace(/λ/g, String.raw`\lambda`)
    .replace(/η/g, String.raw`\eta`)
    .replace(/β/g, String.raw`\beta`)
    .replace(/·/g, String.raw`\,`)
    .replace(/×/g, String.raw`\times`)
    .replace(/−/g, '-')
    .replace(/\bexp\b/g, String.raw`\exp`)
    .replace(/\bmax\b/g, String.raw`\max`)
    .replace(/(^|[^\d])\.(\d+)/g, (_match, prefix: string, digits: string) => `${prefix}0.${digits}`)
    .replace(/\^(-?[\d.]+)/g, '^{$1}')
}

interface Candidate {
  binding: EquationSymbolBinding
  token: string
}

function aliasesFor(binding: EquationSymbolBinding): string[] {
  const canonical = formulaToLatex(binding.symbol)
  return Array.from(new Set([
    canonical,
    canonical.replace(/\\mathrm\{([^{}]+)\}/g, '$1'),
    canonical.replace(/_\{([A-Za-z0-9]+)\}/g, '_$1'),
    binding.symbol,
  ].filter(Boolean))).sort((a, b) => b.length - a.length)
}

function continuesName(character: string | undefined): boolean {
  return Boolean(character && (/\p{L}/u.test(character) || character === '_'))
}

function isValidOccurrence(expression: string, index: number, token: string): boolean {
  const before = index > 0 ? expression[index - 1] : undefined
  const after = expression[index + token.length]
  const commandToken = token.startsWith('\\') || /^[λπασΔΣ]/u.test(token)
  const beforeContinues = !commandToken && continuesName(before)
  const afterContinues = Boolean(after && (/[A-Za-z]/.test(after) || after === '_'))
  return !beforeContinues && !afterContinues
}

/** Add controlled KaTeX HTML-data commands around known symbol occurrences. */
export function annotateLatex(
  expression: string,
  bindings: EquationSymbolBinding[] = [],
): string {
  const safeBindings = bindings.filter(binding => /^[A-Za-z0-9_-]+$/.test(binding.id))
  const candidates: Candidate[] = safeBindings.flatMap(binding =>
    aliasesFor(binding).map(token => ({ binding, token })))
    .sort((a, b) => b.token.length - a.token.length)
  if (!candidates.length) return expression

  let cursor = 0
  let annotated = ''
  while (cursor < expression.length) {
    let bestIndex = -1
    let best: Candidate | undefined
    for (const candidate of candidates) {
      let index = expression.indexOf(candidate.token, cursor)
      while (index >= 0 && !isValidOccurrence(expression, index, candidate.token)) {
        index = expression.indexOf(candidate.token, index + 1)
      }
      if (index >= 0 && (
        bestIndex < 0 || index < bestIndex ||
        (index === bestIndex && candidate.token.length > (best?.token.length ?? 0))
      )) {
        bestIndex = index
        best = candidate
      }
    }
    if (!best || bestIndex < 0) {
      annotated += expression.slice(cursor)
      break
    }
    annotated += expression.slice(cursor, bestIndex)
    annotated += `\\htmlData{prediction-symbol=${best.binding.id}}{${best.token}}`
    cursor = bestIndex + best.token.length
  }
  return annotated
}

function formatValue(value: number): string {
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e7 || magnitude < 1e-5) {
    return value.toExponential(7).replace(/\.0+(?=e)/, '').replace(/(\.\d*?)0+(?=e)/, '$1')
  }
  return value.toLocaleString(undefined, { maximumSignificantDigits: 10 })
}

const SOURCE_LABELS: Record<EquationSymbolBinding['source'], string> = {
  input: 'Model input',
  factor: 'Calculated factor',
  intermediate: 'Intermediate result',
  result: 'Prediction result',
}

interface ActiveTooltip {
  binding: EquationSymbolBinding
  left: number
  top: number
}

/** Render trusted LaTeX, optionally exposing explicit numerical symbol values. */
export default function Latex({
  children,
  block = false,
  className = '',
  bindings = [],
  onBindingHover,
}: {
  children: string
  block?: boolean
  className?: string
  bindings?: EquationSymbolBinding[]
  onBindingHover?: (binding: EquationSymbolBinding | null) => void
}) {
  const rootRef = useRef<HTMLElement | null>(null)
  const [active, setActive] = useState<ActiveTooltip | null>(null)
  const bindingById = useMemo(
    () => new Map(bindings.map(binding => [binding.id, binding])),
    [bindings],
  )
  const trustedIds = useMemo(() => new Set(bindingById.keys()), [bindingById])
  const annotated = useMemo(() => annotateLatex(children, bindings), [children, bindings])
  const html = useMemo(() => katex.renderToString(annotated, {
    displayMode: block,
    throwOnError: false,
    strict: false,
    output: 'htmlAndMathml',
    trust: context => {
      if (context.command !== '\\htmlData') return false
      const attributes = context.attributes
      const id = attributes['data-prediction-symbol']
      return Object.keys(attributes).length === 1 && trustedIds.has(id)
    },
  }), [annotated, block, trustedIds])

  const clearActive = useCallback(() => {
    setActive(null)
    onBindingHover?.(null)
  }, [onBindingHover])

  const activateTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element) || !rootRef.current) return
    const symbol = target.closest<HTMLElement>('[data-prediction-symbol]')
    if (!symbol || !rootRef.current.contains(symbol)) return
    const binding = bindingById.get(symbol.dataset.predictionSymbol ?? '')
    if (!binding) return
    const rect = symbol.getBoundingClientRect()
    const left = Math.min(window.innerWidth - 145, Math.max(145, rect.left + rect.width / 2))
    const top = Math.min(window.innerHeight - 120, rect.bottom + 8)
    setActive({ binding, left, top })
    onBindingHover?.(binding)
  }, [bindingById, onBindingHover])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-prediction-symbol]').forEach(node => {
      const binding = bindingById.get(node.dataset.predictionSymbol ?? '')
      if (!binding) return
      node.tabIndex = 0
      node.setAttribute('role', 'term')
      const value = binding.available && binding.value != null ? formatValue(binding.value) : 'unavailable'
      const unit = binding.unit === 'dimensionless' ? '' : ` ${binding.unit}`
      node.setAttribute('aria-label', `${binding.symbol}, ${binding.label}: ${value}${unit}`)
    })
  }, [bindingById, html])

  useEffect(() => {
    const activeId = active?.binding.id
    rootRef.current?.querySelectorAll<HTMLElement>('[data-prediction-symbol]').forEach(node => {
      node.classList.toggle('equation-symbol-active', node.dataset.predictionSymbol === activeId)
    })
  }, [active, html])

  useEffect(() => {
    if (active && bindingById.get(active.binding.id) !== active.binding) clearActive()
  }, [active, bindingById, clearActive])

  useEffect(() => () => onBindingHover?.(null), [onBindingHover])

  const handleMouseOut = (event: ReactMouseEvent<HTMLElement>) => {
    const current = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-prediction-symbol]')
      : null
    const next = event.relatedTarget instanceof Element
      ? event.relatedTarget.closest<HTMLElement>('[data-prediction-symbol]')
      : null
    if (current?.dataset.predictionSymbol && current.dataset.predictionSymbol === next?.dataset.predictionSymbol) return
    clearActive()
  }

  const handleBlur = (event: ReactFocusEvent<HTMLElement>) => {
    const next = event.relatedTarget instanceof Element
      ? event.relatedTarget.closest<HTMLElement>('[data-prediction-symbol]')
      : null
    if (next && rootRef.current?.contains(next)) return
    clearActive()
  }

  const sharedProps = {
    className: `${className}${bindings.length ? ' interactive-latex' : ''}`,
    onMouseOver: (event: ReactMouseEvent<HTMLElement>) => activateTarget(event.target),
    onMouseOut: handleMouseOut,
    onFocus: (event: ReactFocusEvent<HTMLElement>) => activateTarget(event.target),
    onBlur: handleBlur,
    dangerouslySetInnerHTML: { __html: html },
  }
  const rendered = block
    ? <div ref={node => { rootRef.current = node }} {...sharedProps} />
    : <span ref={node => { rootRef.current = node }} {...sharedProps} />

  return (
    <>
      {rendered}
      {active && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[100] w-max max-w-[280px] -translate-x-1/2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left font-sans shadow-lg"
          style={{ left: active.left, top: active.top }}>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-sm font-semibold text-indigo-700">{active.binding.symbol}</span>
            <span className="text-xs font-semibold text-gray-900">
              {active.binding.available && active.binding.value != null
                ? formatValue(active.binding.value)
                : 'Unavailable'}
            </span>
            <span className="text-[10px] text-gray-500">{active.binding.unit}</span>
          </div>
          <div className="mt-1 text-[10px] leading-snug text-gray-600">{active.binding.label}</div>
          <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-gray-400">
            {SOURCE_LABELS[active.binding.source]}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
