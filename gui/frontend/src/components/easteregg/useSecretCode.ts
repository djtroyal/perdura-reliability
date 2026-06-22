import { useEffect, useRef } from 'react'

/**
 * Listens for a hidden trigger and fires `onTrigger` once matched. Two ways in:
 *   1. The classic console code: ↑ ↑ ↓ ↓ ← → ← → B A
 *   2. Typing the word "yeti"
 * Key capture is suppressed while a text field is focused so it never
 * interferes with normal data entry.
 */
const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
]
const WORD = 'yeti'

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node) return false
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable
}

export function useSecretCode(onTrigger: () => void) {
  const seq = useRef<string[]>([])
  const word = useRef('')
  const cb = useRef(onTrigger)
  cb.current = onTrigger

  useEffect(() => {
    // Traditional breadcrumb for the curious — not shown anywhere in the UI.
    console.info(
      '%c❄ Perdura%c  Something stirs on the slopes... try the old console code (↑↑↓↓←→←→BA), or name the abominable one.',
      'color:#7cf3ff;font-weight:bold', 'color:#8aa',
    )
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(document.activeElement)) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      // Konami sequence (arrows + b a)
      seq.current = [...seq.current, key].slice(-KONAMI.length)
      if (seq.current.length === KONAMI.length &&
          seq.current.every((k, i) => k === KONAMI[i])) {
        seq.current = []
        cb.current()
        return
      }

      // Secret word
      if (/^[a-z]$/.test(key)) {
        word.current = (word.current + key).slice(-WORD.length)
        if (word.current === WORD) {
          word.current = ''
          cb.current()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
