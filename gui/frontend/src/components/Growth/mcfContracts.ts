import type { MCFResponse } from '../../api/client'

export type MCFIntervalMethod = 'log_transformed' | 'cluster_bootstrap'

export interface MCFState {
  text: string
  ciText: string
  parametric: boolean
  intervalMethod: MCFIntervalMethod
  bootstrapSamples: string
  result?: MCFResponse | null
}

export const INITIAL_MCF_STATE: MCFState = {
  text: '5, 10, 15 | 17\n6, 13 | 17\n12, 20, 25 | 26\n4, 9, 13 | 17',
  ciText: '0.95',
  parametric: true,
  intervalMethod: 'log_transformed',
  bootstrapSamples: '500',
  result: null,
}

export interface ParsedMCFData {
  data: number[][]
  observation_ends: number[]
}

// Number() is whole-token, but it accepts blank strings as zero. Keep an
// explicit grammar so malformed entries such as "12hours" cannot be silently
// truncated the way parseFloat() truncates them.
const FINITE_NUMBER_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function parseStrictFiniteNumber(token: string, label: string): number {
  const trimmed = token.trim()
  if (!FINITE_NUMBER_TOKEN.test(trimmed)) {
    throw new Error(`${label}: ${trimmed ? `"${trimmed}" is not a valid number` : 'value is missing'}.`)
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) throw new Error(`${label}: value must be finite.`)
  return value
}

/** Parse one-system-per-line MCF input without discarding malformed tokens. */
export function parseMCFWideText(text: string): ParsedMCFData {
  const data: number[][] = []
  const observation_ends: number[] = []

  for (const [rowIndex, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue
    const parts = raw.split('|')
    if (parts.length !== 2) {
      throw new Error(`Row ${rowIndex + 1}: use exactly one "|" in "events | observation end".`)
    }

    const eventField = parts[0].trim()
    const rawTokens = eventField ? eventField.split(/[\s,]+/).filter(Boolean) : []
    const events = rawTokens.map((token, tokenIndex) =>
      parseStrictFiniteNumber(token, `Row ${rowIndex + 1}, event ${tokenIndex + 1}`))
    const end = parseStrictFiniteNumber(parts[1], `Row ${rowIndex + 1}, observation end`)

    if (end < 0) throw new Error(`Row ${rowIndex + 1}: observation end cannot be negative.`)
    for (const [eventIndex, event] of events.entries()) {
      if (event < 0) {
        throw new Error(`Row ${rowIndex + 1}, event ${eventIndex + 1}: event time cannot be negative.`)
      }
      if (eventIndex > 0 && event < events[eventIndex - 1]) {
        throw new Error(`Row ${rowIndex + 1}, event ${eventIndex + 1}: event times must be nondecreasing.`)
      }
      if (event > end) {
        throw new Error(`Row ${rowIndex + 1}, event ${eventIndex + 1}: event ${event} occurs after observation end ${end}.`)
      }
    }

    data.push(events)
    observation_ends.push(end)
  }
  return { data, observation_ends }
}

export interface MCFRequestToken {
  folioId: string
  inputSignature: string
  requestId: number
}

export function mcfInputSignature(state: MCFState): string {
  const { result, ...inputs } = state
  void result
  return JSON.stringify(inputs)
}

export function createMCFRequestToken(
  folioId: string,
  state: MCFState,
  requestId: number,
): MCFRequestToken {
  return { folioId, inputSignature: mcfInputSignature(state), requestId }
}

/** Prevent a response from being attached to edited input or another folio. */
export function isMCFRequestTokenCurrent(
  token: MCFRequestToken,
  folioId: string,
  state: MCFState,
  requestId: number,
): boolean {
  return token.requestId === requestId
    && token.folioId === folioId
    && token.inputSignature === mcfInputSignature(state)
}
