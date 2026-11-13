import { useCallback, useSyncExternalStore } from 'react'
import type { Dispatch, SetStateAction } from 'react'

type UiPreferenceValue = boolean | string | number
export const UI_PREFERENCE_PREFIX = 'perdura:ui-preferences:'

// Browser display preferences are deliberately independent of project data:
// changing one must not invalidate calculations, mark a project dirty, or add
// undo history. Memory also preserves them while storage is unavailable.
const values = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()
let listeningForStorage = false

function notify(key: string): void {
  listeners.get(key)?.forEach(listener => listener())
}

function listenForStorageChanges(): void {
  if (listeningForStorage || typeof window === 'undefined') return
  listeningForStorage = true
  window.addEventListener('storage', event => {
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return
    } catch { return }
    if (event.key === null) {
      values.clear()
      listeners.forEach(callbacks => callbacks.forEach(listener => listener()))
    } else if (event.key.startsWith(UI_PREFERENCE_PREFIX)) {
      const key = event.key.slice(UI_PREFERENCE_PREFIX.length)
      values.delete(key)
      notify(key)
    }
  })
}

function validValue<T extends UiPreferenceValue>(
  value: unknown,
  fallback: T,
  allowedValues?: readonly T[],
): value is T {
  return typeof value === typeof fallback
    && (typeof value !== 'number' || Number.isFinite(value))
    && (!allowedValues || allowedValues.includes(value as T))
}

export function readUiPreference<T extends UiPreferenceValue>(
  key: string,
  fallback: T,
  allowedValues?: readonly T[],
): T {
  listenForStorageChanges()
  if (!values.has(key)) {
    let value: unknown
    try {
      const stored = localStorage.getItem(`${UI_PREFERENCE_PREFIX}${key}`)
      if (stored !== null) value = JSON.parse(stored)
    } catch { /* Preferences are optional when browser storage is unavailable. */ }
    values.set(key, value)
  }
  const value = values.get(key)
  return validValue(value, fallback, allowedValues) ? value : fallback
}

export function setUiPreference(key: string, value: UiPreferenceValue): void {
  if (!['boolean', 'string', 'number'].includes(typeof value)
    || (typeof value === 'number' && !Number.isFinite(value))) return
  values.set(key, value)
  try {
    localStorage.setItem(`${UI_PREFERENCE_PREFIX}${key}`, JSON.stringify(value))
  } catch { /* Keep the preference for this session even when a write fails. */ }
  notify(key)
}

/** Remember display choices across module unmounts and browser reloads. */
export function useUiPreference<T extends UiPreferenceValue>(
  key: string,
  fallback: T,
  allowedValues?: readonly T[],
): [T, Dispatch<SetStateAction<T>>] {
  const subscribe = useCallback((listener: () => void) => {
    listenForStorageChanges()
    const callbacks = listeners.get(key) ?? new Set<() => void>()
    callbacks.add(listener)
    listeners.set(key, callbacks)
    return () => {
      callbacks.delete(listener)
      if (!callbacks.size) listeners.delete(key)
    }
  }, [key])
  const snapshot = useCallback(() => readUiPreference(key, fallback, allowedValues),
    [key, fallback, allowedValues])
  const value = useSyncExternalStore(subscribe, snapshot, () => fallback)
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(next => {
    const resolved = typeof next === 'function' ? next(snapshot()) : next
    if (validValue(resolved, fallback, allowedValues)) setUiPreference(key, resolved)
  }, [key, snapshot, fallback, allowedValues])
  return [value, setValue]
}
