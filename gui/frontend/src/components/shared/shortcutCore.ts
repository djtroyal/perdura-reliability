export type ShortcutScope = 'global' | 'module' | 'canvas' | 'modal'

export interface ShortcutBinding {
  key?: string
  code?: string
  mod?: boolean
  alt?: boolean
  shift?: boolean
}

export interface KeyboardLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export const scopePriority: Record<ShortcutScope, number> = {
  modal: 4,
  canvas: 3,
  module: 2,
  global: 1,
}

export function matchesShortcut(event: KeyboardLike, binding: ShortcutBinding): boolean {
  const hasMod = event.ctrlKey || event.metaKey
  if (hasMod !== Boolean(binding.mod)) return false
  if (event.altKey !== Boolean(binding.alt)) return false
  if (event.shiftKey !== Boolean(binding.shift)) return false
  if (binding.code && event.code !== binding.code) return false
  if (binding.key && event.key.toLowerCase() !== binding.key.toLowerCase()) return false
  return Boolean(binding.key || binding.code)
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    || el.tagName === 'SELECT' || el.isContentEditable
}

export function formatShortcut(binding: ShortcutBinding, apple = false): string {
  const parts: string[] = []
  if (binding.mod) parts.push(apple ? '⌘' : 'Ctrl')
  if (binding.alt) parts.push(apple ? '⌥' : 'Alt')
  if (binding.shift) parts.push(apple ? '⇧' : 'Shift')
  const raw = binding.key ?? binding.code ?? ''
  const names: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    BracketLeft: '[', BracketRight: ']', Space: 'Space', Escape: 'Esc',
  }
  parts.push(names[raw] ?? (raw.length === 1 ? raw.toUpperCase() : raw))
  return parts.join(apple ? '' : '+')
}

export function adjacentTabId(
  ids: string[],
  currentId: string,
  key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
): string | null {
  if (!ids.length) return null
  const current = Math.max(0, ids.indexOf(currentId))
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  const delta = key === 'ArrowLeft' ? -1 : 1
  return ids[(current + delta + ids.length) % ids.length]
}

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
}
