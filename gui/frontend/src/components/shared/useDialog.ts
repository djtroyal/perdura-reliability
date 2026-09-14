import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'

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
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]'

const modalStack: HTMLElement[] = []
const inerted = new Map<HTMLElement, boolean>()

// Only the top modal owns background inertness. Recompute when a nested modal
// opens/closes, restoring any pre-existing inert state before applying ours.
function syncModalInertness() {
  for (const [element, original] of inerted) element.inert = original
  inerted.clear()
  let branch = modalStack[modalStack.length - 1]
  while (branch && branch !== document.body) {
    const parent = branch.parentElement
    if (!parent) break
    for (const sibling of parent.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        inerted.set(sibling, sibling.inert)
        sibling.inert = true
      }
    }
    branch = parent
  }
}

/** Modal focus entry, containment, Escape, inert background and focus return. */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  const escape = useRef(onEscape)
  escape.current = onEscape
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const originalTabIndex = node.getAttribute('tabindex')
    node.tabIndex = -1
    modalStack.push(node)
    syncModalInertness()
    const isTop = () => modalStack[modalStack.length - 1] === node
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert], [hidden]'))
    const focusInside = () => (focusables()[0] ?? node).focus()
    focusInside()

    const onFocus = (event: FocusEvent) => {
      if (isTop() && !node.contains(event.target as Node)) focusInside()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation(); escape.current?.(); return
      }
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const items = focusables()
      if (!items.length) { event.preventDefault(); node.focus(); return }
      const current = document.activeElement
      if (event.shiftKey && (current === items[0] || current === node || !node.contains(current))) {
        event.preventDefault(); items[items.length - 1].focus()
      } else if (!event.shiftKey && (current === items[items.length - 1] || !node.contains(current))) {
        event.preventDefault(); items[0].focus()
      }
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      const wasTop = isTop()
      const shouldRestore = node.contains(document.activeElement) || document.activeElement === document.body
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKeyDown)
      const index = modalStack.indexOf(node)
      if (index >= 0) modalStack.splice(index, 1)
      syncModalInertness()
      if (originalTabIndex === null) node.removeAttribute('tabindex')
      else node.setAttribute('tabindex', originalTabIndex)
      if (wasTop && shouldRestore && previouslyFocused?.isConnected && !previouslyFocused.closest('[inert]')) {
        previouslyFocused.focus()
      }
    }
  }, [active, ref])
}
