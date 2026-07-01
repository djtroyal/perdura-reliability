import { useEffect, useSyncExternalStore, type RefObject } from 'react'

/**
 * Promise-based modal dialogs (confirm / prompt) as a module-level singleton, so
 * any code — components, the project store, ProjectBar — can `await confirmDialog(...)`
 * without context plumbing. `<DialogHost/>` (see ConfirmDialog.tsx) must be mounted
 * once near the app root to render the active request. Also exports `useFocusTrap`,
 * the shared accessibility hook reused by the host, the Help drawer and modals.
 */

export type DialogTone = 'default' | 'danger'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

export interface PromptOptions {
  title: string
  label?: string
  defaultValue?: string
  confirmLabel?: string
  placeholder?: string
}

interface ConfirmRequest {
  kind: 'confirm'
  id: number
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}
interface PromptRequest {
  kind: 'prompt'
  id: number
  opts: PromptOptions
  resolve: (v: string | null) => void
}
export type DialogRequest = ConfirmRequest | PromptRequest

let current: DialogRequest | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit() { listeners.forEach(l => l()) }
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }

/** Subscribe to the active dialog request (used by DialogHost). */
export function useDialogRequest(): DialogRequest | null {
  return useSyncExternalStore(subscribe, () => current)
}

/** Resolve and clear the active request. Called by the host on confirm/cancel. */
export function resolveDialog(value: boolean | string | null) {
  const req = current
  current = null
  emit()
  if (!req) return
  if (req.kind === 'confirm') req.resolve(value as boolean)
  else req.resolve(value as string | null)
}

/** Show a styled confirm dialog. Resolves true (confirmed) / false (cancelled). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    // If a dialog is already open, reject the previous one as cancelled.
    if (current?.kind === 'confirm') current.resolve(false)
    else if (current?.kind === 'prompt') current.resolve(null)
    current = { kind: 'confirm', id: nextId++, opts, resolve }
    emit()
  })
}

/** Show a styled text-prompt dialog. Resolves the entered string, or null if cancelled. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise(resolve => {
    if (current?.kind === 'confirm') current.resolve(false)
    else if (current?.kind === 'prompt') current.resolve(null)
    current = { kind: 'prompt', id: nextId++, opts, resolve }
    emit()
  })
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Trap focus inside `ref` while `active`. On activate: remember the previously
 * focused element, move focus inside, and confine Tab/Shift-Tab. Escape calls
 * `onEscape`. On deactivate: restore focus to where it was. Used by every modal
 * surface (dialog host, Help drawer, Replace-project modal).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.offsetParent !== null || el === document.activeElement)

    // Move focus inside (prefer the first focusable, else the container itself).
    const first = focusables()[0]
    if (first) first.focus()
    else { node.setAttribute('tabindex', '-1'); node.focus() }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEscape?.(); return }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) { e.preventDefault(); return }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const activeEl = document.activeElement as HTMLElement | null
      if (e.shiftKey && (activeEl === firstEl || !node.contains(activeEl))) {
        e.preventDefault(); lastEl.focus()
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault(); firstEl.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      // Restore focus if it's still inside the trap (avoid stealing focus the
      // user has since moved elsewhere).
      if (previouslyFocused && node.contains(document.activeElement)) previouslyFocused.focus()
    }
  }, [active, ref, onEscape])
}
