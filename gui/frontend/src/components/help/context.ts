import { useEffect, useRef, useSyncExternalStore } from 'react'

interface ActiveHelpContext {
  topicId: string | null
}

let active: ActiveHelpContext = { topicId: null }
const listeners = new Set<() => void>()
const registrations = new Map<symbol, { topicId: string; priority: number; sequence: number }>()
let sequence = 0

function emit() { listeners.forEach(listener => listener()) }
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function recompute() {
  const next = [...registrations.values()].sort((a, b) =>
    b.priority - a.priority || b.sequence - a.sequence)[0]?.topicId ?? null
  if (next === active.topicId) return
  active = { topicId: next }
  emit()
}

/** Publish the currently visible analysis without touching project state/history. */
export function useHelpTopic(topicId: string | null | undefined, priority = 0) {
  const owner = useRef(Symbol('help-topic'))
  useEffect(() => {
    if (!topicId) return
    registrations.set(owner.current, { topicId, priority, sequence: sequence += 1 })
    recompute()
    return () => {
      registrations.delete(owner.current)
      recompute()
    }
  }, [topicId, priority])
}

export function useActiveHelpTopic(): string | null {
  return useSyncExternalStore(subscribe, () => active.topicId, () => active.topicId)
}
