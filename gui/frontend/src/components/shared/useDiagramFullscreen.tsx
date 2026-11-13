import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { Viewport } from '@xyflow/react'
import { hasOpenPopovers } from './useDismissiblePopover'

interface FlowView {
  fitView: (options?: { padding?: number; duration?: number }) => Promise<boolean>
  getViewport: () => Viewport
  setViewport: (viewport: Viewport, options?: { duration?: number }) => Promise<boolean>
}
const focusable = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])'

/** Expand the existing diagram and inspector without remounting either editor. */
export function useDiagramFullscreen(label: string, getFlow: () => FlowView | null) {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const previousViewport = useRef<Viewport | null>(null)
  const flow = useRef(getFlow)
  flow.current = getFlow
  const changed = useRef(false)
  const close = useCallback(() => setExpanded(false), [])
  const toggle = useCallback(() => {
    setExpanded(value => {
      if (!value) previousViewport.current = flow.current()?.getViewport() ?? null
      return !value
    })
  }, [])

  useEffect(() => {
    if (!expanded && !changed.current) return
    changed.current = true
    // React Flow's ResizeObserver must see the new host size before fitting.
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const instance = flow.current()
        if (expanded) void instance?.fitView({ padding: 0.18, duration: 0 })
        else {
          if (previousViewport.current) void instance?.setViewport(previousViewport.current, { duration: 0 })
          triggerRef.current?.focus({ preventScroll: true })
        }
      })
    })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      const root = containerRef.current
      if (!root?.contains(event.target as Node)) return
      if (event.key === 'Escape' && !hasOpenPopovers()) {
        event.preventDefault(); event.stopImmediatePropagation(); close()
      } else if (event.key === 'Tab') {
        const items = [...root.querySelectorAll<HTMLElement>(focusable)]
          .filter(item => item.tabIndex >= 0 && item.getClientRects().length > 0 && !item.closest('[inert]'))
        const first = items[0], last = items[items.length - 1]
        if (!first) { event.preventDefault(); root.focus() }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [expanded, close])

  return { expanded, close, toggle, triggerRef,
    containerProps: {
      ref: containerRef,
      className: expanded ? 'fixed inset-0 z-[100] flex min-h-0 min-w-0 bg-white' : 'flex min-h-0 min-w-0 flex-1',
      role: expanded ? 'dialog' as const : undefined,
      'aria-modal': expanded || undefined,
      'aria-label': expanded ? `${label} — full screen` : undefined,
      'data-diagram-fullscreen': expanded ? 'true' : 'false',
      tabIndex: expanded ? -1 : undefined,
    },
  }
}

export function DiagramFullscreenButton({ controls }: { controls: ReturnType<typeof useDiagramFullscreen> }) {
  const title = controls.expanded ? 'Restore diagram' : 'Expand diagram to full screen'
  const Icon = controls.expanded ? Minimize2 : Maximize2
  return <button ref={controls.triggerRef} type="button" onClick={controls.toggle}
    title={title} aria-label={title} aria-pressed={controls.expanded}
    className="flex h-8 items-center justify-center rounded border border-slate-300 bg-white px-2 text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
    <Icon size={14} aria-hidden="true" />
  </button>
}
