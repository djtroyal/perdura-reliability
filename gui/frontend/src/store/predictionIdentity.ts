import type { PredictionPart } from '../api/client'

let partSequence = 0

export function newPredictionPartId(): string {
  const random = typeof crypto !== 'undefined'
    && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(++partSequence).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return `part-${random}`
}

/**
 * Give every Prediction part a persistent, unique identity. Existing project
 * files did not require one, so normalization is intentionally idempotent and
 * only replaces missing or duplicated identifiers.
 */
export function ensurePredictionPartIds(
  parts: PredictionPart[],
): PredictionPart[] {
  const seen = new Set<string>()
  let changed = false
  const normalized = parts.map(part => {
    const candidate = part.id?.trim()
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate)
      return part
    }
    changed = true
    let id = newPredictionPartId()
    while (seen.has(id)) id = newPredictionPartId()
    seen.add(id)
    return { ...part, id }
  })
  return changed ? normalized : parts
}
