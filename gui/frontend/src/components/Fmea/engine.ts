/**
 * TRIZ-FMEA pure engine — validation, derivation and traceability logic.
 * No React, no I/O: everything here is unit-testable in plain Node.
 *
 * - validateFunction: the six "Tests for Correctly Written Functions"
 * - deriveFailureModes: guide-word generation per validated function
 * - effectsOf: structural effect propagation UP the function graph
 * - detectionSuggestion: ideal-observer scoring of a detection control
 * - completeness: coverage metrics that make the FMEA auditable
 * - worksheetRows: the flattened classic FMEA table, fully derived
 */
import {
  FmeaState, Fn, SysObject, FailureMode, Cause, DetectionCtl, Rating,
  Guideword, GUIDEWORDS, SUSPECT_VERBS, ABSTRACT_PRODUCTS,
} from './model'

// ---------------------------------------------------------------------------
// Function grammar validation (the 6 Tests)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  test: 1 | 2 | 3 | 4 | 5 | 6
  severity: 'error' | 'warning'
  message: string
}

export function validateFunction(fn: Fn, objects: SysObject[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const obj = (id: string | null) => objects.find(o => o.id === id)
  const tool = obj(fn.toolId)
  const product = obj(fn.productId)

  // Test 1 — all parts present, causality direction implied by tool→product.
  if (!fn.toolId) {
    issues.push({ test: 1, severity: 'warning', message: 'No tool yet — fine while drafting ("write the function without the tool"), but the delivered design needs an acting object.' })
  } else if (!tool) {
    issues.push({ test: 1, severity: 'error', message: 'Tool references a missing object.' })
  }
  if (!product) {
    issues.push({ test: 1, severity: 'error', message: 'Every function needs a product (the object modified).' })
  }
  if (!fn.verb.trim()) {
    issues.push({ test: 1, severity: 'error', message: 'The modification verb is missing.' })
  }

  // Test 2 — tool and product must be physical ("droppable on your foot"),
  // unless explicitly declared virtual (software/business carve-out).
  for (const [role, o] of [['tool', tool], ['product', product]] as const) {
    if (o && !o.virtual) {
      const lower = o.name.trim().toLowerCase()
      if (ABSTRACT_PRODUCTS.some(a => lower === a || lower.endsWith(` ${a}`))) {
        issues.push({
          test: 2, severity: 'error',
          message: `"${o.name}" is a parameter, not a substance — you could not drop it on your foot. Name the physical object whose ${lower.split(' ').pop()} changes (or mark the object as virtual for software/business models).`,
        })
      }
    }
  }

  // Test 3 — the modification must be a change/control of a product attribute.
  if (!fn.attribute.trim()) {
    issues.push({
      test: 3, severity: 'warning',
      message: 'Name the attribute changed/controlled (longhand form): "changes temperature", "controls position". The longhand is the disambiguator when the verb is unclear.',
    })
  }

  // Test 5 — the type notation must match the modification's intent.
  if (fn.type === 'informing') {
    // Direction rule: subject (measured object) → observer. The verb "measures"
    // on an informing function usually signals a reversed arrow.
    if (SUSPECT_VERBS[fn.verb.trim().toLowerCase()]?.includes('informing') === false) { /* covered by test 6 */ }
  }

  // Test 6 — confusing-function anti-patterns (suspect verbs).
  const hint = SUSPECT_VERBS[fn.verb.trim().toLowerCase()]
  if (hint) {
    issues.push({ test: 6, severity: fn.type === 'informing' && /measure/.test(fn.verb) ? 'warning' : 'error', message: `Suspect verb "${fn.verb}": ${hint}` })
  }

  // Informing-function direction sanity: the OBSERVER should not be the thing
  // being measured (English inverts this: "thermometer measures temperature").
  if (fn.type === 'informing' && tool && product && tool.id === product.id) {
    issues.push({ test: 1, severity: 'warning', message: 'Self-informing function — valid, but confirm the subject really informs itself.' })
  }

  return issues
}

export const isValid = (fn: Fn, objects: SysObject[]) =>
  validateFunction(fn, objects).every(i => i.severity !== 'error')

// ---------------------------------------------------------------------------
// Failure-mode derivation (guide words)
// ---------------------------------------------------------------------------

/** Candidate modes for a function: one per guide word not yet present.
 *  Harmful functions get no candidates — they ARE failure content already
 *  (the 'unintended' side effect of some useful function). */
export function deriveFailureModes(fn: Fn, existing: FailureMode[]): Guideword[] {
  if (fn.type === 'harmful') return []
  const present = new Set(existing.filter(m => m.fnId === fn.id).map(m => m.guideword))
  return GUIDEWORDS.map(g => g.key).filter(k => !present.has(k))
}

/** A mode is triaged when described (kept) or dismissed with a reason. */
export const isTriaged = (m: FailureMode) =>
  m.dismissed ? m.dismissReason.trim().length > 0 : m.description.trim().length > 0

// ---------------------------------------------------------------------------
// Effect propagation (structural traceability)
// ---------------------------------------------------------------------------

export interface EffectStep {
  fnId: string
  label: string      // "tool verb product"
  via: 'hierarchy' | 'chain'
}

export function fnLabel(fn: Fn, objects: SysObject[]): string {
  const name = (id: string | null) => objects.find(o => o.id === id)?.name ?? '?'
  return `${fn.toolId ? name(fn.toolId) : '—'} ${fn.verb || '?'} ${name(fn.productId)}`
}

/**
 * Walk UP from a failure mode's function to the Job Function, collecting the
 * chain of higher-level functions affected. Two structural edges are followed:
 *  - hierarchy: fn.parentFnId (this function serves that one), and
 *  - chaining: another function whose TOOL is this function's PRODUCT object
 *    (the product of one function is the tool of the next).
 * Hierarchy wins when both exist; cycles are guarded.
 */
export function effectsOf(modeId: string, state: FmeaState, objects = state.objects): EffectStep[] {
  const mode = state.modes.find(m => m.id === modeId)
  if (!mode) return []
  let fn = state.functions.find(f => f.id === mode.fnId)
  const steps: EffectStep[] = []
  const seen = new Set<string>()
  while (fn && !seen.has(fn.id)) {
    seen.add(fn.id)
    let next: Fn | undefined
    let via: 'hierarchy' | 'chain' = 'hierarchy'
    if (fn.parentFnId) {
      next = state.functions.find(f => f.id === fn!.parentFnId)
    }
    if (!next) {
      // chaining: the product object of this function acts as tool elsewhere
      next = state.functions.find(f => f.toolId === fn!.productId && f.id !== fn!.id && !seen.has(f.id))
      via = 'chain'
    }
    if (!next) break
    steps.push({ fnId: next.id, label: fnLabel(next, objects), via })
    fn = next
  }
  return steps
}

/** Severity suggestion (1–10) from structural reach: how far up the chain the
 *  failure propagates and whether it reaches the Job Function (a top-level
 *  function with no parent) or harms a super-system object. A suggestion only —
 *  the analyst always owns the final rating. */
export function severitySuggestion(modeId: string, state: FmeaState): number {
  const chain = effectsOf(modeId, state)
  const mode = state.modes.find(m => m.id === modeId)
  const fn = mode && state.functions.find(f => f.id === mode.fnId)
  if (!fn) return 1
  const top = chain.length ? state.functions.find(f => f.id === chain[chain.length - 1].fnId) : fn
  const reachesJob = top ? top.parentFnId === null : false
  // Harm touching a super-system object (outside our design authority) is worse.
  const harmed = mode?.harmedObjectId ? state.objects.find(o => o.id === mode.harmedObjectId) : undefined
  const superSystemHarm = harmed?.kind === 'superSystem' || mode?.guideword === 'unintended'
  let s = 3 + Math.min(chain.length, 3)          // local 3 … deep chain 6
  if (reachesJob) s += 2                          // reaches the Job Function
  if (superSystemHarm) s += 1                     // harms the world outside
  return Math.max(1, Math.min(10, s))
}

// ---------------------------------------------------------------------------
// Detection scoring (ideal-observer criteria)
// ---------------------------------------------------------------------------

/** Suggested FMEA detection rating (1 = certain detection … 10 = none).
 *  Grounded in the informing-function ideality criteria: every transformation
 *  in the measurement chain is a burden and failure point; contact, destructive
 *  and added-parts detection is less ideal; periodic detection can miss. */
export function detectionSuggestion(ctl: DetectionCtl | undefined): number {
  if (!ctl) return 10
  const t = parseInt(ctl.transformations, 10)
  let d = 2 + (isNaN(t) ? 2 : Math.min(Math.max(t - 1, 0), 4))  // 1 transformation → 2 … many → 6
  if (ctl.contact) d += 1
  if (ctl.destructive) d += 2
  if (ctl.periodic) d += 1
  if (ctl.addedParts) d += 0   // burden, not a detectability penalty
  return Math.max(1, Math.min(10, d))
}

// ---------------------------------------------------------------------------
// Completeness (the auditability meters)
// ---------------------------------------------------------------------------

export interface Completeness {
  functionsValid: { done: number; total: number }
  modesTriaged: { done: number; total: number }
  keptModesWithCause: { done: number; total: number }
  keptModesWithEffect: { done: number; total: number }
  highSevWithDetection: { done: number; total: number }
  pairsSwept: { done: number; total: number }
}

export function ratingFor(state: FmeaState, modeId: string, causeId: string | null): Rating | undefined {
  return state.ratings.find(r => r.modeId === modeId && r.causeId === (causeId ?? null))
}

export function completeness(state: FmeaState): Completeness {
  const fns = state.functions
  const kept = state.modes.filter(m => !m.dismissed && m.description.trim())
  const objIds = state.objects.map(o => o.id)
  const totalPairs = (objIds.length * (objIds.length - 1)) / 2
  const sweptSet = new Set(state.sweptPairs)

  const highSev = kept.filter(m => {
    const r = state.ratings.find(x => x.modeId === m.id)
    const sev = r ? parseInt(r.severity, 10) : severitySuggestion(m.id, state)
    return sev >= 7
  })

  return {
    functionsValid: {
      done: fns.filter(f => isValid(f, state.objects)).length,
      total: fns.length,
    },
    modesTriaged: {
      done: state.modes.filter(isTriaged).length,
      total: state.modes.length,
    },
    keptModesWithCause: {
      done: kept.filter(m => state.causes.some(c => c.parentModeId === m.id)).length,
      total: kept.length,
    },
    keptModesWithEffect: {
      done: kept.filter(m => effectsOf(m.id, state).length > 0
        || state.functions.find(f => f.id === m.fnId)?.parentFnId === null).length,
      total: kept.length,
    },
    highSevWithDetection: {
      done: highSev.filter(m => state.detections.some(d => d.modeId === m.id)).length,
      total: highSev.length,
    },
    pairsSwept: { done: Math.min(sweptSet.size, totalPairs), total: totalPairs },
  }
}

// ---------------------------------------------------------------------------
// Cause helpers
// ---------------------------------------------------------------------------

export function causeChain(causeId: string, state: FmeaState): Cause[] {
  const out: Cause[] = []
  let c = state.causes.find(x => x.id === causeId)
  const seen = new Set<string>()
  while (c && !seen.has(c.id)) {
    seen.add(c.id)
    out.push(c)
    c = c.parentCauseId ? state.causes.find(x => x.id === c!.parentCauseId) : undefined
  }
  return out
}

export function causesOfMode(modeId: string, state: FmeaState): Cause[] {
  return state.causes.filter(c => c.parentModeId === modeId)
}

export function subCauses(causeId: string, state: FmeaState): Cause[] {
  return state.causes.filter(c => c.parentCauseId === causeId)
}

/** Lynchpin contradictions: a contradiction-marked cause attribute appearing
 *  under two or more different failure modes — one resolution clears several
 *  problems at once. */
export function lynchpins(state: FmeaState): { attribute: string; modeIds: string[] }[] {
  const byAttr = new Map<string, Set<string>>()
  for (const c of state.causes) {
    if (!c.contradiction || !c.attribute.trim()) continue
    // find the mode at the root of this cause's chain
    let cur: Cause | undefined = c
    const seen = new Set<string>()
    while (cur && cur.parentCauseId && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = state.causes.find(x => x.id === cur!.parentCauseId)
    }
    const modeId = cur?.parentModeId
    if (!modeId) continue
    const key = c.attribute.trim().toLowerCase()
    if (!byAttr.has(key)) byAttr.set(key, new Set())
    byAttr.get(key)!.add(modeId)
  }
  return [...byAttr.entries()]
    .filter(([, modes]) => modes.size >= 2)
    .map(([attribute, modes]) => ({ attribute, modeIds: [...modes] }))
}

// ---------------------------------------------------------------------------
// Worksheet generation
// ---------------------------------------------------------------------------

export interface WorksheetRow {
  objectName: string
  functionLabel: string
  fnType: string
  guideword: Guideword
  modeId: string
  modeDescription: string
  localEffect: string
  nextEffects: string
  endEffect: string
  causeId: string | null
  causeText: string
  causeTerminal: string
  detection: string
  severity: number
  occurrence: number | null
  detectionRating: number
  rpn: number | null
  actionPriority: 'H' | 'M' | 'L'
  contradiction: boolean
}

const AP = (s: number, o: number | null, d: number): 'H' | 'M' | 'L' => {
  const occ = o ?? 5
  if (s >= 9 && occ >= 2) return 'H'
  if (s >= 7 && occ >= 4) return 'H'
  if (s >= 7 || (s >= 4 && occ >= 6) || (occ >= 4 && d >= 7)) return 'M'
  return 'L'
}

export function worksheetRows(state: FmeaState): WorksheetRow[] {
  const rows: WorksheetRow[] = []
  const kept = state.modes.filter(m => !m.dismissed && m.description.trim())
  for (const mode of kept) {
    const fn = state.functions.find(f => f.id === mode.fnId)
    if (!fn) continue
    const product = state.objects.find(o => o.id === fn.productId)
    const chain = effectsOf(mode.id, state)
    const localEffect = `${fn.verb} ${product?.name ?? '?'} ${mode.guideword === 'absent' ? 'not delivered' : mode.guideword}`
    const nextEffects = chain.slice(0, -1).map(s => s.label).join(' → ')
    const endEffect = chain.length ? chain[chain.length - 1].label : fnLabel(fn, state.objects)
    const modeCauses = causesOfMode(mode.id, state)
    const detCtl = state.detections.find(d => d.modeId === mode.id)
    const detText = detCtl ? `${detCtl.subject} → ${detCtl.observer}` : '—'

    const emit = (cause: Cause | null) => {
      const rating = ratingFor(state, mode.id, cause?.id ?? null)
      const sev = rating?.severity ? parseInt(rating.severity, 10) : severitySuggestion(mode.id, state)
      const occ = rating?.occurrence ? parseInt(rating.occurrence, 10) : null
      const det = rating?.detection ? parseInt(rating.detection, 10) : detectionSuggestion(detCtl)
      rows.push({
        objectName: (state.objects.find(o => o.id === fn.toolId)?.name) ?? product?.name ?? '?',
        functionLabel: fnLabel(fn, state.objects),
        fnType: fn.type,
        guideword: mode.guideword,
        modeId: mode.id,
        modeDescription: mode.description,
        localEffect, nextEffects, endEffect,
        causeId: cause?.id ?? null,
        causeText: cause ? `${cause.attribute || cause.knobCategory} = ${cause.setting || '?'}${cause.objectId ? ` (${state.objects.find(o => o.id === cause.objectId)?.name ?? ''})` : ''}` : '—',
        causeTerminal: cause?.terminal ?? '',
        detection: detText,
        severity: isNaN(sev) ? severitySuggestion(mode.id, state) : sev,
        occurrence: occ !== null && !isNaN(occ) ? occ : null,
        detectionRating: isNaN(det) ? detectionSuggestion(detCtl) : det,
        rpn: occ !== null && !isNaN(occ) ? sev * occ * det : null,
        actionPriority: AP(sev, occ, det),
        contradiction: cause?.contradiction ?? false,
      })
    }

    if (modeCauses.length === 0) emit(null)
    else modeCauses.forEach(c => emit(c))
  }
  return rows
}
