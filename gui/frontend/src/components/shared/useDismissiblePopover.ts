import { useEffect, useRef } from 'react'

interface PopoverOptions {
  open: boolean
  onDismiss: () => void
  /** Include both the trigger and the popup, including portalled content. */
  elements: () => (HTMLElement | null | undefined)[]
  trigger?: () => HTMLElement | null | undefined
}

interface OpenPopover {
  parent?: OpenPopover
  contains: (target: EventTarget | null) => boolean
  dismiss: (restoreFocus: boolean) => void
}

const popovers: OpenPopover[] = []
let removeListeners: (() => void) | undefined

/** Outer layers such as fullscreen must allow the active popup to handle Escape first. */
export function hasOpenPopovers(): boolean {
  return popovers.length > 0 || (typeof document !== 'undefined'
    && Boolean(document.querySelector('details[data-dropdown-menu][open]')))
}

function listen() {
  if (removeListeners || typeof document === 'undefined') return
  const outside = (event: Event) => {
    // Closing does not consume the click or move focus away from its target.
    const inside = new Set<OpenPopover>()
    for (const popup of popovers) if (popup.contains(event.target)) {
      for (let current: OpenPopover | undefined = popup; current; current = current.parent) inside.add(current)
    }
    for (const popup of [...popovers].reverse()) if (!inside.has(popup)) popup.dismiss(false)
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return
    const popup = popovers[popovers.length - 1]
    if (!popup) return
    event.preventDefault()
    event.stopImmediatePropagation()
    popup.dismiss(true)
  }
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('focusin', outside, true)
  document.addEventListener('keydown', escape, true)
  removeListeners = () => {
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('focusin', outside, true)
    document.removeEventListener('keydown', escape, true)
    removeListeners = undefined
  }
}

/** Shared nonmodal popup behavior: outside interaction dismisses without
 * swallowing that interaction; Escape dismisses the top popup and restores its trigger. */
export function useDismissiblePopover(options: PopoverOptions): void {
  const latest = useRef(options)
  latest.current = options
  useEffect(() => {
    if (!options.open) return
    const openedFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let active = true
    const remove = () => {
      if (!active) return
      active = false
      const index = popovers.indexOf(popup)
      if (index >= 0) popovers.splice(index, 1)
      if (!popovers.length) removeListeners?.()
    }
    const popup: OpenPopover = {
      parent: [...popovers].reverse().find(parent => parent.contains(latest.current.trigger?.() ?? openedFrom)),
      contains: target => target instanceof Node
        && latest.current.elements().some(element => element?.contains(target)),
      dismiss: restoreFocus => {
        if (!active) return
        remove()
        latest.current.onDismiss()
        if (restoreFocus) {
          const trigger = latest.current.trigger?.() ?? openedFrom
          if (trigger?.isConnected) trigger.focus({ preventScroll: true })
        }
      },
    }
    popovers.push(popup)
    listen()
    return remove
  }, [options.open])
}
