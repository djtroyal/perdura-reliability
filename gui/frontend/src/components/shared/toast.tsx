import { useSyncExternalStore, useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

/**
 * Tiny dependency-free toast system. A module-level singleton store (same
 * subscribe/emit shape as store/project.ts) so it can be driven from anywhere —
 * React components, the axios interceptor, or the project store — via the
 * exported `toast` object. Mount `<ToastViewport/>` once (in App.tsx).
 */

export type ToastKind = 'success' | 'error' | 'info'
export interface Toast { id: number; kind: ToastKind; message: string }

const MAX_STACK = 4
const DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, error: 6000 }

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  // New array identity so useSyncExternalStore sees a change.
  toasts = toasts.slice()
  listeners.forEach(l => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function dismissToast(id: number) {
  const t = timers.get(id)
  if (t !== undefined) { clearTimeout(t); timers.delete(id) }
  toasts = toasts.filter(x => x.id !== id)
  emit()
}

function push(kind: ToastKind, message: string): number {
  const id = nextId++
  toasts = [...toasts, { id, kind, message }]
  // Cap the stack — drop the oldest when overflowing.
  if (toasts.length > MAX_STACK) {
    const overflow = toasts.slice(0, toasts.length - MAX_STACK)
    overflow.forEach(o => {
      const t = timers.get(o.id)
      if (t !== undefined) { clearTimeout(t); timers.delete(o.id) }
    })
    toasts = toasts.slice(-MAX_STACK)
  }
  timers.set(id, setTimeout(() => dismissToast(id), DURATION[kind]))
  emit()
  return id
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
}

const STYLES: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200', iconColor: 'text-emerald-500' },
  error: { icon: AlertTriangle, ring: 'border-red-200', iconColor: 'text-red-500' },
  info: { icon: Info, ring: 'border-blue-200', iconColor: 'text-blue-500' },
}

function ToastCard({ t }: { t: Toast }) {
  const { icon: Icon, ring, iconColor } = STYLES[t.kind]
  // Fade/slide-in on mount.
  const [shown, setShown] = useState(false)
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r) }, [])
  return (
    <div
      role={t.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-2 bg-white border ${ring} shadow-lg rounded-lg px-3 py-2.5 w-80 max-w-[90vw] transition-all duration-200 ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
      }`}
    >
      <Icon size={16} className={`flex-shrink-0 mt-0.5 ${iconColor}`} />
      <p className="flex-1 text-xs text-gray-700 leading-snug break-words">{t.message}</p>
      <button
        onClick={() => dismissToast(t.id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 text-gray-300 hover:text-gray-600"
      >
        <X size={14} />
      </button>
    </div>
  )
}

/** Fixed bottom-right stack of active toasts. Mount once near the app root. */
export function ToastViewport() {
  const items = useSyncExternalStore(subscribe, () => toasts)
  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map(t => <ToastCard key={t.id} t={t} />)}
    </div>
  )
}
