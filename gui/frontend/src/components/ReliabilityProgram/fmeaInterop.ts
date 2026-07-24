import type {
  AIAGVDAFMEAAnalysis,
  FMEAAction,
  FMEAFailureChain,
} from '../../api/reliabilityProgram'
import { createFmeaAnalysis } from './fmeaModel'


export type ClassicFmeaCell = string | boolean
export type ClassicFmeaRow = Record<string, ClassicFmeaCell>

const CLASSIC_SYNC_PREFIX = 'CLASSIC-SYNC'
const CLASSIC_SYNC_NAME = 'Classic FMEA — generated AIAG–VDA view'

const text = (value: ClassicFmeaCell | undefined) =>
  String(value ?? '').trim()

const list = (value: ClassicFmeaCell | undefined) =>
  text(value).split(',').map(item => item.trim()).filter(Boolean)

const rating = (value: ClassicFmeaCell | undefined, fallback = 5) => {
  const numeric = Number(value)
  return Number.isFinite(numeric)
    ? Math.max(1, Math.min(10, Math.round(numeric)))
    : fallback
}

const safeIdPart = (value: string) =>
  value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72)
  || 'ROW'

function shortHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function projectedChainEntries(analyses: AIAGVDAFMEAAnalysis[]) {
  const eligible = analyses
    .filter(analysis => analysis.kind !== 'fmea_msr')
    .flatMap(analysis => analysis.failure_chains.map(chain => ({
      analysis,
      chain,
    })))
  const counts = new Map<string, number>()
  for (const { chain } of eligible) {
    counts.set(chain.id, (counts.get(chain.id) ?? 0) + 1)
  }
  return eligible.map(entry => ({
    ...entry,
    rowId: counts.get(entry.chain.id) === 1
      ? entry.chain.id
      : [
          'CF',
          safeIdPart(entry.analysis.id).slice(0, 38),
          safeIdPart(entry.chain.id).slice(0, 62),
          shortHash(`${entry.analysis.id}\u0000${entry.chain.id}`),
        ].join('-').slice(0, 128),
  }))
}

function uniqueId(prefix: string, seed: string, used: Set<string>) {
  const base = `${prefix}-${safeIdPart(seed)}`.slice(0, 118)
  let candidate = base
  let sequence = 2
  while (used.has(candidate)) {
    candidate = `${base}-${sequence}`.slice(0, 128)
    sequence += 1
  }
  used.add(candidate)
  return candidate
}

function usedAnalysisIds(analysis: AIAGVDAFMEAAnalysis) {
  return new Set([
    ...analysis.structure_nodes.map(item => item.id),
    ...analysis.functions.map(item => item.id),
    ...analysis.function_links.map(item => item.id),
    ...analysis.functional_requirements.map(item => item.id),
    ...analysis.function_requirement_links.map(item => item.id),
    ...analysis.interfaces.map(item => item.id),
    ...analysis.p_diagrams.map(item => item.id),
    ...analysis.p_diagrams.flatMap(item => item.items.map(child => child.id)),
    ...analysis.failure_chains.map(item => item.id),
    ...analysis.failure_chains.flatMap(item => [
      ...(item.effect_contexts ?? []).map(child => child.id),
      ...(item.actions ?? []).map(child => child.id),
    ]),
    ...analysis.control_plan.map(item => item.id),
  ])
}

function actionToClassicStatus(actions: FMEAAction[]) {
  if (!actions.length) return 'open'
  if (actions.some(action =>
    action.status === 'open'
    || action.status === 'decision_pending'
    || action.status === 'implementation_pending')) {
    return actions.some(action => action.status === 'open') ? 'open' : 'planned'
  }
  if (actions.some(action => action.status === 'completed')) return 'implemented'
  return 'closed'
}

function classicToActionStatus(value: string): FMEAAction['status'] {
  if (value === 'planned') return 'implementation_pending'
  if (value === 'implemented' || value === 'verified' || value === 'closed') {
    return 'completed'
  }
  return 'open'
}

function controlsForClassic(chain: FMEAFailureChain) {
  const controls = [
    chain.prevention_controls.trim()
      ? `Prevention: ${chain.prevention_controls.trim()}` : '',
    chain.detection_controls.trim()
      ? `Detection: ${chain.detection_controls.trim()}` : '',
  ].filter(Boolean)
  return controls.join(' | ')
}

function localEffect(chain: FMEAFailureChain) {
  const contexts = chain.effect_contexts ?? []
  return contexts.find(context =>
    /\b(local|item|component|process step)\b/i.test(context.context))
    ?.description
    ?? contexts[0]?.description
    ?? ''
}

function projectedClassicRow(
  chain: FMEAFailureChain,
  rowId: string,
  functionById: Map<
    string,
    AIAGVDAFMEAAnalysis['functions'][number]
  >,
  structureById: Map<
    string,
    AIAGVDAFMEAAnalysis['structure_nodes'][number]
  >,
  previous?: ClassicFmeaRow,
): ClassicFmeaRow {
  const fn = chain.function_id
    ? functionById.get(chain.function_id)
    : undefined
  const structure = fn ? structureById.get(fn.structure_node_id) : undefined
  return {
    id: rowId,
    item: structure?.name ?? '',
    function: fn?.description ?? '',
    failureMode: chain.failure_mode,
    localEffect: localEffect(chain),
    endEffect: chain.effect,
    cause: chain.cause,
    controls: controlsForClassic(chain),
    severity: String(chain.severity),
    occurrence: String(chain.occurrence ?? 5),
    detection: String(chain.detection ?? 5),
    action: chain.actions?.[0]?.description ?? '',
    owner: chain.actions?.[0]?.owner ?? '',
    status: actionToClassicStatus(chain.actions?.slice(0, 1) ?? []),
    hazardLinks: chain.linked_hazard_ids.join(', '),
    fracasLinks: chain.linked_fracas_ids.join(', '),
    failureRate: previous?.failureRate ?? '',
    modeRatio: previous?.modeRatio ?? '',
    effectProbability: previous?.effectProbability ?? '',
    missionTime: previous?.missionTime ?? '',
  }
}

export function classicRowsFromAiag(
  analyses: AIAGVDAFMEAAnalysis[],
  previousRows: ClassicFmeaRow[] = [],
): ClassicFmeaRow[] {
  const previous = new Map(previousRows.map(row => [text(row.id), row]))
  const maps = new Map(analyses.map(analysis => [analysis.id, {
    functionById: new Map(analysis.functions.map(item => [item.id, item])),
    structureById: new Map(
      analysis.structure_nodes.map(item => [item.id, item])),
  }]))
  return projectedChainEntries(analyses).map(({ analysis, chain, rowId }) => {
    const lookup = maps.get(analysis.id)!
    return projectedClassicRow(
      chain,
      rowId,
      lookup.functionById,
      lookup.structureById,
      previous.get(rowId),
    )
  })
}

export function aiagClassicChainIds(analyses: AIAGVDAFMEAAnalysis[]) {
  return new Set(projectedChainEntries(analyses).map(entry => entry.rowId))
}

function makeGeneratedAnalysis(
  analyses: AIAGVDAFMEAAnalysis[],
  rows: ClassicFmeaRow[],
): AIAGVDAFMEAAnalysis {
  const used = new Set([
    ...analyses.map(item => item.id),
    ...rows.map(row => text(row.id)),
  ])
  let analysisId = CLASSIC_SYNC_PREFIX
  let sequence = 2
  while (used.has(analysisId)) {
    analysisId = `${CLASSIC_SYNC_PREFIX}-${sequence}`
    sequence += 1
  }
  const analysis = createFmeaAnalysis('dfmea', analyses.length + 1)
  return {
    ...analysis,
    id: analysisId,
    name: CLASSIC_SYNC_NAME,
    planning: {
      ...analysis.planning,
      subject: 'Classic FMEA records',
      intent: 'Synchronized AIAG–VDA working view of Classic FMEA content.',
      assumptions: 'Generated fields require review and completion before finalization.',
    },
  }
}

function ensureFunction(
  analysis: AIAGVDAFMEAAnalysis,
  row: ClassicFmeaRow,
) {
  const functionText = text(row.function)
  if (!functionText) return undefined
  const itemText = text(row.item)
  const existingStructure = analysis.structure_nodes.find(
    item => item.name.trim().toLocaleLowerCase() === itemText.toLocaleLowerCase())
  const existingFunction = analysis.functions.find(item =>
    item.description.trim().toLocaleLowerCase()
      === functionText.toLocaleLowerCase()
    && item.structure_node_id === existingStructure?.id)
  if (existingFunction) return existingFunction.id

  const used = usedAnalysisIds(analysis)
  const structureId = existingStructure?.id
    ?? uniqueId('ST', `${text(row.id)}-${itemText || 'unassigned'}`, used)
  if (!existingStructure) {
    analysis.structure_nodes.push({
      id: structureId,
      name: itemText,
      level: 'focus',
      description: 'Generated from a synchronized Classic FMEA row.',
      interface: '',
      element_type: '',
    })
  }
  const functionId = uniqueId(
    'FN', `${text(row.id)}-${functionText || 'function'}`, used)
  analysis.functions.push({
    id: functionId,
    structure_node_id: structureId,
    description: functionText,
    function_type: 'primary',
    operating_modes: [],
    owner: '',
    notes: 'Generated from a synchronized Classic FMEA row.',
  })
  return functionId
}

function emptyChain(
  analysis: AIAGVDAFMEAAnalysis,
  row: ClassicFmeaRow,
): FMEAFailureChain {
  return {
    id: text(row.id),
    function_id: ensureFunction(analysis, row),
    effect: text(row.endEffect) || text(row.localEffect),
    effect_contexts: [],
    failure_mode: text(row.failureMode),
    cause: text(row.cause),
    effect_level: '',
    severity: rating(row.severity),
    occurrence: rating(row.occurrence),
    detection: rating(row.detection),
    prevention_controls: text(row.controls),
    detection_controls: '',
    severity_rationale: '',
    occurrence_rationale: '',
    detection_rationale: '',
    frequency_rationale: '',
    monitoring_rationale: '',
    actions: [],
    no_action_justification: '',
    post_severity_rationale: '',
    linked_hazard_ids: list(row.hazardLinks),
    linked_fracas_ids: list(row.fracasLinks),
    monitoring_system: '',
    system_response: '',
    safe_state: '',
    mitigated_effect: '',
    management_review_status: '',
    management_review_evidence_ids: [],
    remarks: 'Generated from a synchronized Classic FMEA row; complete AIAG–VDA-specific rationale and planning fields.',
  }
}

function findChain(
  analyses: AIAGVDAFMEAAnalysis[],
  id: string,
) {
  const found = projectedChainEntries(analyses)
    .find(entry => entry.rowId === id)
  if (found) {
    return {
      analysis: found.analysis,
      index: found.analysis.failure_chains.indexOf(found.chain),
    }
  }
  return undefined
}

function ensureFirstAction(
  analysis: AIAGVDAFMEAAnalysis,
  chain: FMEAFailureChain,
) {
  if (chain.actions.length) return chain.actions[0]
  const used = usedAnalysisIds(analysis)
  const action: FMEAAction = {
    id: uniqueId('ACT', chain.id, used),
    kind: 'prevention',
    description: '',
    owner: '',
    status: 'open',
    evidence_ids: [],
    decision_rationale: '',
  }
  chain.actions.push(action)
  return action
}

function applyClassicFields(
  analysis: AIAGVDAFMEAAnalysis,
  chain: FMEAFailureChain,
  row: ClassicFmeaRow,
  changedKeys: Set<string>,
) {
  if (changedKeys.has('item') || changedKeys.has('function')) {
    chain.function_id = ensureFunction(analysis, row)
  }
  if (changedKeys.has('failureMode')) chain.failure_mode = text(row.failureMode)
  if (changedKeys.has('endEffect')) {
    chain.effect = text(row.endEffect) || text(row.localEffect)
  }
  if (changedKeys.has('localEffect')) {
    const current = chain.effect_contexts.find(context =>
      context.context.trim().toLocaleLowerCase() === 'local')
    const description = text(row.localEffect)
    if (current) {
      if (description) current.description = description
      else chain.effect_contexts = chain.effect_contexts.filter(
        context => context.id !== current.id)
    } else if (description) {
      const used = usedAnalysisIds(analysis)
      chain.effect_contexts.push({
        id: uniqueId('EC', `${chain.id}-LOCAL`, used),
        context: 'Local',
        description,
        severity: rating(row.severity, chain.severity),
      })
    }
  }
  if (changedKeys.has('cause')) chain.cause = text(row.cause)
  if (changedKeys.has('controls')) {
    chain.prevention_controls = text(row.controls)
    chain.detection_controls = ''
  }
  if (changedKeys.has('severity')) chain.severity = rating(row.severity)
  if (changedKeys.has('occurrence')) chain.occurrence = rating(row.occurrence)
  if (changedKeys.has('detection')) chain.detection = rating(row.detection)
  if (changedKeys.has('hazardLinks')) {
    chain.linked_hazard_ids = list(row.hazardLinks)
  }
  if (changedKeys.has('fracasLinks')) {
    chain.linked_fracas_ids = list(row.fracasLinks)
  }
  if (changedKeys.has('action') || changedKeys.has('owner')
      || changedKeys.has('status')) {
    const hasActionData = text(row.action) || text(row.owner)
      || (text(row.status) && text(row.status) !== 'open')
    if (chain.actions.length || hasActionData) {
      const action = ensureFirstAction(analysis, chain)
      if (changedKeys.has('action')) action.description = text(row.action)
      if (changedKeys.has('owner')) action.owner = text(row.owner)
      if (changedKeys.has('status')) {
        action.status = classicToActionStatus(text(row.status))
      }
    }
  }
}

function cleanGeneratedAnalyses(analyses: AIAGVDAFMEAAnalysis[]) {
  return analyses.flatMap(analysis => {
    if (!analysis.id.startsWith(CLASSIC_SYNC_PREFIX)) return [analysis]
    if (!analysis.failure_chains.length) return []
    const functionIds = new Set(analysis.failure_chains
      .map(chain => chain.function_id).filter(Boolean))
    analysis.functions = analysis.functions.filter(fn => functionIds.has(fn.id))
    const structureIds = new Set(analysis.functions.map(fn => fn.structure_node_id))
    analysis.structure_nodes = analysis.structure_nodes.filter(
      item => structureIds.has(item.id))
    return [analysis]
  })
}

export function updateAiagFromClassicRow(
  previousRow: ClassicFmeaRow | undefined,
  row: ClassicFmeaRow,
  analyses: AIAGVDAFMEAAnalysis[],
  rows: ClassicFmeaRow[],
  changedKeys?: string[],
): AIAGVDAFMEAAnalysis[] {
  const next = structuredClone(analyses)
  const previousId = text(previousRow?.id)
  const nextId = text(row.id)
  if (!nextId) return next
  let located = findChain(next, previousId || nextId)
  if (!located) {
    let generated = next.find(
      analysis => analysis.id.startsWith(CLASSIC_SYNC_PREFIX))
    if (!generated) {
      generated = makeGeneratedAnalysis(next, rows)
      next.push(generated)
    }
    const chain = emptyChain(generated, row)
    generated.failure_chains.push(chain)
    located = {
      analysis: generated,
      index: generated.failure_chains.length - 1,
    }
    applyClassicFields(
      generated,
      chain,
      row,
      new Set([
        'item', 'function', 'failureMode', 'localEffect', 'endEffect', 'cause',
        'controls', 'severity', 'occurrence', 'detection', 'action', 'owner',
        'status', 'hazardLinks', 'fracasLinks',
      ]),
    )
    return cleanGeneratedAnalyses(next)
  }

  const chain = located.analysis.failure_chains[located.index]
  if (previousId && nextId !== previousId) {
    const previousChainId = chain.id
    chain.id = nextId
    located.analysis.control_plan = located.analysis.control_plan.map(item =>
      item.failure_chain_id === previousChainId
        ? { ...item, failure_chain_id: nextId }
        : item)
  }
  applyClassicFields(
    located.analysis,
    chain,
    row,
    new Set(changedKeys ?? Object.keys(row)),
  )
  return cleanGeneratedAnalyses(next)
}

export function addClassicRowsToAiag(
  rows: ClassicFmeaRow[],
  analyses: AIAGVDAFMEAAnalysis[],
): AIAGVDAFMEAAnalysis[] {
  const knownIds = aiagClassicChainIds(analyses)
  const missing = rows.filter(row => {
    const rowId = text(row.id)
    if (!rowId || knownIds.has(rowId)) return false
    knownIds.add(rowId)
    return true
  })
  if (!missing.length) return analyses
  const next = structuredClone(analyses)
  let generated = next.find(
    analysis => analysis.id.startsWith(CLASSIC_SYNC_PREFIX))
  if (!generated) {
    generated = makeGeneratedAnalysis(next, rows)
    next.push(generated)
  }
  for (const row of missing) {
    const chain = emptyChain(generated, row)
    generated.failure_chains.push(chain)
    applyClassicFields(
      generated,
      chain,
      row,
      new Set([
        'item', 'function', 'failureMode', 'localEffect', 'endEffect', 'cause',
        'controls', 'severity', 'occurrence', 'detection', 'action', 'owner',
        'status', 'hazardLinks', 'fracasLinks',
      ]),
    )
  }
  return cleanGeneratedAnalyses(next)
}

export function removeClassicRowFromAiag(
  row: ClassicFmeaRow,
  analyses: AIAGVDAFMEAAnalysis[],
): AIAGVDAFMEAAnalysis[] {
  const rowId = text(row.id)
  const next = structuredClone(analyses)
  const located = findChain(next, rowId)
  if (!located) return next
  const chainId = located.analysis.failure_chains[located.index].id
  located.analysis.failure_chains.splice(located.index, 1)
  located.analysis.control_plan = located.analysis.control_plan.filter(
    item => item.failure_chain_id !== chainId)
  return cleanGeneratedAnalyses(next)
}
