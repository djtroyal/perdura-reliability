import type { PredictionResponse, PredictionResult } from '../../api/client'
import type { SystemDefinitionModel } from '../../api/systemDefinition'
import type { PredictionScenario } from '../../store/sharedSystemModel'
import { systemInputFingerprint } from '../../store/sharedSystemFingerprint'
import { sha256FtaText } from '../FaultTree/libraryModel'

export interface ComparisonFolio { id: string; name: string; dirty?: boolean; state?: unknown }
export type ComparisonResponse = PredictionResponse & { scenario_input_fingerprint?: string }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

/** Only recipe inputs enter this stamp; labels, plot preferences and outputs do not. */
export function predictionScenarioFingerprint(scenario: PredictionScenario): string {
  return sha256FtaText(JSON.stringify(canonical({
    standard: scenario.standard ?? 'MIL-HDBK-217F', environment: scenario.environment ?? 'GB',
    vitaGlobal: scenario.vitaGlobal ?? false, processGrade: scenario.processGrade ?? null,
    processScore: scenario.processScore ?? null, missionPhases: scenario.missionPhases ?? [],
    missionProfileName: scenario.missionProfileName ?? '',
    partInputs: scenario.partInputs, blockInputs: scenario.blockInputs,
  })))
}
export interface Difference { key: string; baseline: unknown; candidate: unknown; ratio: number | null }
export function differences(a: Record<string, unknown>, b: Record<string, unknown>): Difference[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(key => !equal(a[key], b[key])).map(key => ({
    key, baseline: a[key], candidate: b[key], ratio: typeof a[key] === 'number' && typeof b[key] === 'number' && a[key] !== 0
      ? (b[key] as number) / (a[key] as number) : null,
  }))
}
const methodSource = (result: ComparisonResponse) => ({ standard: result.standard, edition: result.methodology?.edition,
  source: result.methodology?.source, scope: result.methodology?.method_scope })
const rowSource = (row: PredictionResult) => row.traceability ? {
  standard: row.traceability.standard, section: row.traceability.section, model: row.traceability.model, equation: row.traceability.equation,
} : null
const expandedRate = (row: PredictionResult) => row.system_contribution_failure_rate ?? row.system_expanded_failure_rate ?? row.total_failure_rate
export interface ScenarioPair {
  reasons: string[]
  baseline?: ComparisonResponse; candidate?: ComparisonResponse
  rateRatio: number | null; mtbfRatio: number | null; rateDifference: number | null
  inputs: Difference[]
  rows: { id: string; name: string; baseline: PredictionResult; candidate: PredictionResult;
    baselineRate: number | null; candidateRate: number | null; ratio: number | null; factors: Difference[]; inputs: Difference[] }[]
}

export function comparePredictionScenarios(model: SystemDefinitionModel, a?: ComparisonFolio, b?: ComparisonFolio): ScenarioPair {
  const empty: ScenarioPair = { reasons: [], rateRatio: null, mtbfRatio: null, rateDifference: null, rows: [], inputs: [] }
  if (!a || !b || a.id === b.id) return { ...empty, reasons: ['Select two different calculated scenarios.'] }
  const fingerprint = systemInputFingerprint(model)
  const scenarios = [record(a.state), record(b.state)] as unknown as PredictionScenario[]
  const results = scenarios.map(scenario => scenario.result as ComparisonResponse | undefined)
  const reasons: string[] = []
  ;[a, b].forEach((folio, i) => {
    const result = results[i], scenario = scenarios[i]
    if (!result) { reasons.push(`${folio.name}: calculate this scenario first.`); return }
    if (folio.dirty) reasons.push(`${folio.name}: inputs changed; recalculate this scenario.`)
    if (result.source_fingerprint !== fingerprint || result.canonical_system_id !== model.id)
      reasons.push(`${folio.name}: calculation uses a different or older shared system; recalculate.`)
    if (!result.scenario_input_fingerprint || result.scenario_input_fingerprint !== predictionScenarioFingerprint(scenario))
      reasons.push(`${folio.name}: recipe provenance is missing or changed; recalculate.`)
    if (!result.request_sha256 || result.standard !== (scenario.standard ?? 'MIL-HDBK-217F'))
      reasons.push(`${folio.name}: calculation provenance does not match its selected method.`)
    if (!result.methodology?.edition || !result.methodology?.source?.title)
      reasons.push(`${folio.name}: method edition and source are required.`)
    if (result.total_failure_rate == null || !Number.isFinite(result.total_failure_rate) || result.total_failure_rate < 0)
      reasons.push(`${folio.name}: a finite nonnegative system failure rate is required.`)
    if (result.service_rate_available === false || result.rate_time_basis !== 'calendar_hours')
      reasons.push(`${folio.name}: a comparable calendar-hour failure rate is unavailable.`)
    if (result.results.some(row => row.excluded || row.incompatible || row.error) || result.excluded_part_count || result.incompatible?.length)
      reasons.push(`${folio.name}: resolve excluded or incompatible BOM lines before comparing whole-system totals.`)
    const known = new Set(model.instances.map(item => item.id))
    const ids = result.results.map(row => row.part_id)
    if (ids.some(id => !id || !known.has(id)) || new Set(ids).size !== ids.length)
      reasons.push(`${folio.name}: result rows lack unique current BOM identities.`)
  })
  const baseline = results[0], candidate = results[1]
  if (!baseline || !candidate) return { ...empty, reasons }
  if (!equal(methodSource(baseline), methodSource(candidate))) reasons.push('The scenarios use different prediction standards, editions, sources or method scopes.')
  const signature = (result: ComparisonResponse) => result.results.map(row => [row.part_id, row.category, row.quantity, row.multiplier, row.block_quantity_multiplier ?? 1]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))
  if (!equal(signature(baseline), signature(candidate))) reasons.push('The scenarios do not have matching part identities, categories and quantities.')
  const byId = new Map(candidate.results.map(row => [row.part_id, row]))
  for (const row of baseline.results) {
    const other = byId.get(row.part_id)
    if (other && (!rowSource(row) || !equal(rowSource(row), rowSource(other)))) reasons.push(`${row.name || row.part_id}: part model sources differ or are missing.`)
  }
  if (reasons.length) return { ...empty, reasons: [...new Set(reasons)] }
  const ar = baseline.total_failure_rate!, br = candidate.total_failure_rate!
  const inputs = differences({ environment: scenarios[0].environment, vitaGlobal: scenarios[0].vitaGlobal,
    processGrade: scenarios[0].processGrade, processScore: scenarios[0].processScore, missionPhases: scenarios[0].missionPhases,
    blockInputs: scenarios[0].blockInputs }, { environment: scenarios[1].environment, vitaGlobal: scenarios[1].vitaGlobal,
    processGrade: scenarios[1].processGrade, processScore: scenarios[1].processScore, missionPhases: scenarios[1].missionPhases,
    blockInputs: scenarios[1].blockInputs })
  return { reasons: [], baseline, candidate, inputs, rateDifference: br - ar,
    rateRatio: ar > 0 ? br / ar : null, mtbfRatio: br > 0 && ar > 0 ? ar / br : null,
    rows: baseline.results.map(row => {
      const other = byId.get(row.part_id)!, aRate = expandedRate(row), bRate = expandedRate(other)
      return { id: row.part_id!, name: row.name, baseline: row, candidate: other,
        baselineRate: aRate, candidateRate: bRate, ratio: aRate != null && aRate > 0 && bRate != null ? bRate / aRate : null,
        factors: differences(row.pi_factors, other.pi_factors),
        inputs: differences(scenarios[0].partInputs[row.part_id!] ?? {}, scenarios[1].partInputs[row.part_id!] ?? {}) }
    }) }
}
