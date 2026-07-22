import { adjacentTabId } from './shortcutCore'

interface TabKeyOptions {
  ids: string[]
  currentId: string
  onSelect: (id: string) => void
  onRename?: (id: string) => void
  onClose?: (id: string) => void
}

function focusTab(tablist: HTMLElement | null, id: string) {
  requestAnimationFrame(() => {
    const tabs = Array.from(tablist?.querySelectorAll<HTMLElement>('[role="tab"][data-tab-id]') ?? [])
    tabs.find(tab => tab.dataset.tabId === id)?.focus()
  })
}

/** Shared WAI-ARIA tab behavior for module, analysis, and report tabs. */
export function handleTabKey(event: React.KeyboardEvent<HTMLElement>, options: TabKeyOptions) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const tablist = event.currentTarget.closest<HTMLElement>('[role="tablist"]')
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
    const next = adjacentTabId(options.ids, options.currentId, event.key)
    if (!next) return
    event.preventDefault()
    options.onSelect(next)
    focusTab(tablist, next)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    options.onSelect(options.currentId)
  } else if (event.key === 'F2' && options.onRename) {
    event.preventDefault()
    options.onRename(options.currentId)
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && options.onClose) {
    event.preventDefault()
    options.onClose(options.currentId)
  }
}
