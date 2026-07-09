/**
 * TRIZ-based FMEA — data model, constant tables, and initial state.
 *
 * The FMEA is DERIVED from a disciplined TRIZ function model rather than
 * hand-typed: objects form the structure (indenture) tree, grammar-validated
 * functions link them, failure modes are generated from each function via
 * guide words, causes are object-attribute ("knob") chains, effects propagate
 * structurally up the function graph, and detection controls are informing
 * functions bound to the failure modes they guard.
 *
 * Methodological basis: Larry Ball et al., "TRIZ Power Tools" (Working with
 * Functions; Idealizing Useful/Informing/Harmful Functions; Discovering Cause;
 * Discovering Why Targeted Objects are Required; Mobilizing Function
 * Resources; Resolving Contradictions; Neutralizing Harmful Functions —
 * opensourcetriz.com), which adapts Terninko/Zusman/Zlotin causal analysis and
 * Kaplan/Zlotin/Zusman Anticipatory Failure Determination.
 */

import { TRAPS } from './verbs'

// ---------------------------------------------------------------------------
// Objects (structure tree)
// ---------------------------------------------------------------------------

export interface SysObject {
  id: string
  name: string
  /** Parent object id — the indenture hierarchy. null = top level. */
  parentId: string | null
  /** 'system' = under our design authority; 'superSystem' = environment/not ours. */
  kind: 'system' | 'superSystem'
  /** The element the whole system exists to modify (highlighted in diagrams). */
  isSystemProduct: boolean
  /** Physicality check: "could you drop it on your foot?" Virtual carve-out for
   *  software/business objects — must be explicitly declared. */
  virtual: boolean
  notes: string
}

// ---------------------------------------------------------------------------
// Functions (the grammar: Tool →(Modification)→ Product)
// ---------------------------------------------------------------------------

export type FnType = 'useful' | 'harmful' | 'informing'
export type LonghandOp = 'changes' | 'controls' | 'creates'

export interface FnRequirements {
  /** Target level of the modification (metric + acceptable band) — the axis on
   *  which delivery is judged insufficient/excessive. */
  level: string
  metric: string
  band: string
  duration: string
  sequence: string
  dutyCycle: string
  /** Zero-function: conditions under which the function must intentionally NOT act. */
  zeroCondition: string
}

export interface Fn {
  id: string
  /** The acting object. null only while drafting ("write the function without the tool"). */
  toolId: string | null
  /** The object acted on. For informing functions this is the OBSERVER and the
   *  tool is the SUBJECT (measured object) — direction is always subject→observer. */
  productId: string
  /** Shorthand modification verb ("heats", "holds", "corrodes"). */
  verb: string
  /** Longhand disambiguation: changes|controls|creates + the physical attribute. */
  longhandOp: LonghandOp
  /** The product attribute physically changed/controlled ("temperature", "position"). */
  attribute: string
  type: FnType
  /** Hierarchical decomposition: which higher-level function this one serves.
   *  null = the Job Function (top of the effect-propagation walk). */
  parentFnId: string | null
  requirements: FnRequirements
  rationale: string
}

export const EMPTY_REQUIREMENTS: FnRequirements = {
  level: '', metric: '', band: '', duration: '', sequence: '', dutyCycle: '', zeroCondition: '',
}

// ---------------------------------------------------------------------------
// Failure modes (derived per function via guide words)
// ---------------------------------------------------------------------------

export type Guideword = 'absent' | 'insufficient' | 'excessive' | 'intermittent' | 'unintended' | 'wrongTime'

export const GUIDEWORDS: { key: Guideword; label: string; hint: string }[] = [
  { key: 'absent', label: 'Absent / fails to act',
    hint: 'The function is not delivered at all — the modification never happens.' },
  { key: 'insufficient', label: 'Insufficient',
    hint: 'Delivered below the required level/band (partial, weak, degraded over time).' },
  { key: 'excessive', label: 'Excessive',
    hint: 'Delivered beyond the required level — excess usually brings further harms.' },
  { key: 'intermittent', label: 'Intermittent / unstable',
    hint: 'Delivery fluctuates or drops out — timing, duty-cycle or stability failures.' },
  { key: 'unintended', label: 'Unintended side effect',
    hint: 'The tool simultaneously performs a HARMFUL function on another object (dual-tool principle).' },
  { key: 'wrongTime', label: 'Acts at the wrong time',
    hint: 'The function acts when it must not (zero-function violation) or out of sequence.' },
]

export interface FailureMode {
  id: string
  fnId: string
  guideword: Guideword
  /** Concrete statement of the mode. Empty + !dismissed = untriaged. */
  description: string
  /** A guideword may be dismissed as not credible — but only with a reason. */
  dismissed: boolean
  dismissReason: string
  /** For 'unintended': the object harmed by the side effect (if identified). */
  harmedObjectId?: string | null
}

// ---------------------------------------------------------------------------
// Causes (knob + setting chains, per Discovering Cause)
// ---------------------------------------------------------------------------

/** The Table of Knobs — the missing-cause sweep categories. */
export const KNOB_CATEGORIES = [
  'Existence', 'Number of objects', 'Location', 'Movement', 'Structure',
  'Surface properties', 'Bulk properties', 'Direction', 'Field structure',
  'Added/superimposed fields', 'Conductivity', 'Adjustability', 'Timing', 'Time variation',
] as const
export type KnobCategory = typeof KNOB_CATEGORIES[number]

/** The 7 knob types — how hard the cause is to act on (types 3–7 are the
 *  hard-but-high-payoff ones; type 3 marks a live contradiction). */
export const KNOB_TYPES = [
  { key: 'easy', label: 'Easily turned', hint: 'Full control, nothing gets worse — the prize.' },
  { key: 'littleEffect', label: 'Little effect', hint: 'Turning it barely matters; usually not worth pursuing.' },
  { key: 'worsensOther', label: 'Something else gets worse', hint: 'Classic contradiction — fixing this setting degrades another attribute.' },
  { key: 'difficult', label: 'Difficult to turn', hint: 'No known phenomenon or too many knobs at once; knowledge may exist in another industry.' },
  { key: 'oneFlavor', label: 'Only one flavor', hint: 'The element only comes one way (customer-fixed, catalog part).' },
  { key: 'variable', label: 'Highly variable', hint: 'So variable the setting is never known (environment, usage).' },
  { key: 'outcome', label: 'Outcome knob', hint: 'A dependent variable considered directly, without changing its inputs.' },
] as const
export type KnobType = typeof KNOB_TYPES[number]['key']

export interface Cause {
  id: string
  /** Parent: a failure-mode id (top of a cause chain) or another cause id (sub-cause). */
  parentModeId: string | null
  parentCauseId: string | null
  /** The object whose attribute deviates (null for environmental/global knobs). */
  objectId: string | null
  knobCategory: KnobCategory
  /** The attribute (knob) and its bad setting — "acid reactivity" / "high". */
  attribute: string
  setting: string
  knobType: KnobType | null
  /** Requirements & design parameters "are not caused by anything" → terminal. */
  terminal: 'designParam' | 'requirement' | null
  /** AFD (saboteur) check: are the physical resources for this cause actually
   *  present in the system? A cause without available resources is not credible. */
  afdResourcesPresent: boolean | null
  afdNote: string
  /** Marked when fixing this setting worsens another attribute (contradiction). */
  contradiction: boolean
  contradictionNote: string
}

// ---------------------------------------------------------------------------
// Detection controls (informing functions bound to failure modes)
// ---------------------------------------------------------------------------

export interface DetectionCtl {
  id: string
  /** The failure mode this control guards — every detection exists because
   *  something tends to go out of bounds. */
  modeId: string
  /** What is observed (the SUBJECT — parameter/effect of the failure). */
  subject: string
  /** Who/what is informed (the OBSERVER at the end of the measurement chain). */
  observer: string
  /** Number of transformations in the measurement chain (subject→…→observer).
   *  Each transformation is a burden and a failure point of the detection itself. */
  transformations: string
  /** Ideal-observer criteria (each true degrades detection ideality). */
  contact: boolean
  destructive: boolean
  addedParts: boolean
  /** Detection happens only offline/periodically rather than continuously. */
  periodic: boolean
  note: string
}

// ---------------------------------------------------------------------------
// Mitigation flags (V1: flagging only; guided wizards deferred)
// ---------------------------------------------------------------------------

export const MITIGATION_FAMILIES = [
  { key: 'eliminateTool', label: 'Eliminate the harmful tool', hint: 'Remove the element/source/path, redirect, or absorb (Idealizing Harmful Functions, Group 1).' },
  { key: 'makeUseful', label: 'Convert harm to benefit', hint: 'Useful variant, anti-function, useful on another product, reverse fields… (Group 2 ladder).' },
  { key: 'eliminateProduct', label: 'Eliminate the harmed object', hint: 'The product cannot be harmed if it does not exist (Group 3).' },
  { key: 'neutralize', label: 'Neutralize (add function)', hint: 'Last resort: mediator, weak link, counter field, channel, strengthen, cushion… (12 methods).' },
  { key: 'contradiction', label: 'Resolve a contradiction', hint: 'The fix-setting worsens something else — route to the separation cascade.' },
  { key: 'idealize', label: 'Idealize the function', hint: 'Re-derive the ideal product/modification/tool for the flawed function.' },
] as const
export type MitigationFamily = typeof MITIGATION_FAMILIES[number]['key']

export interface MitigationFlag {
  id: string
  modeId: string
  causeId: string | null
  family: MitigationFamily
  note: string
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export interface Rating {
  modeId: string
  causeId: string | null
  /** 1–10 strings per app convention; '' = unrated. */
  severity: string
  occurrence: string
  detection: string
}

// ---------------------------------------------------------------------------
// Module state (per folio)
// ---------------------------------------------------------------------------

export interface FmeaState {
  objects: SysObject[]
  functions: Fn[]
  modes: FailureMode[]
  causes: Cause[]
  detections: DetectionCtl[]
  mitigations: MitigationFlag[]
  ratings: Rating[]
  /** Pairwise interaction sweep: "a|b" object-id pairs the analyst has reviewed. */
  sweptPairs: string[]
  seq: number
}

export const INITIAL_FMEA: FmeaState = {
  objects: [],
  functions: [],
  modes: [],
  causes: [],
  detections: [],
  mitigations: [],
  ratings: [],
  sweptPairs: [],
  seq: 0,
}

// ---------------------------------------------------------------------------
// Grammar helpers (suspect verbs, physicality)
// ---------------------------------------------------------------------------

/** Verbs that do not name a change/control of the stated product — the classic
 *  "confusing function" anti-patterns from Working with Functions. Derived from
 *  the verb dictionary's trap list so the validator and the VerbPicker agree. */
export const SUSPECT_VERBS: Record<string, string> = Object.fromEntries(
  TRAPS.map(t => [t.verb.toLowerCase(), t.hint]))

/** Abstract nouns that fail the "could you drop it on your foot?" test when
 *  used as objects (product must be a substance, not a parameter). */
export const ABSTRACT_PRODUCTS = [
  'temperature', 'reliability', 'electricity', 'quality', 'safety', 'pressure',
  'speed', 'performance', 'efficiency', 'cost', 'energy', 'power', 'signal',
]

let idSeq = 0
export const newId = (prefix: string) => `${prefix}${++idSeq}-${Math.random().toString(36).slice(2, 7)}`
