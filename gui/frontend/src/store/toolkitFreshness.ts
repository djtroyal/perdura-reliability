import type { getProjectState } from './project'
import { resolveReliabilitySource } from '../components/shared/reliabilitySources'
import { systemInputFingerprint } from './sharedSystemModel'

type Value = Record<string, unknown>
const record = (v: unknown): Value => v && typeof v === 'object' && !Array.isArray(v) ? v as Value : {}
type Status = { current: boolean; reason: string }
export function lifetimeInputSignature(input: object, view: string): string {
  const state = record(input)
  const linked = Boolean(state.sourceId)
  const fields = view === 'matrix' ? ['sourceId','ages','durations',...(!linked ? ['eta','beta'] : [])]
    : view === 'mechanical' ? ['sourceId','interval','cmDowntime','pmDowntime',...(!linked ? ['basis','beta',...(state.basis === 'percentile' ? ['percentileLife','failurePercent'] : ['eta'])] : [])]
    : ['sourceId','n','failures','firstAge','secondAge','level','priorAlpha','priorBeta',...(!linked ? ['betas'] : [])]
  return JSON.stringify(fields.map(key => [key,state[key]]))
}

export function inventoryInputSignature(input: object, units: string): string {
  const state = record(input)
  return JSON.stringify([units, ...['mode','horizon','service','target','dependence','trials','seed','rows','allocation','maximumStock','sourceFingerprint','linkedScenarioId'].map(key => [key,state[key]])])
}

export function lifetimeResultStatus(project: ReturnType<typeof getProjectState>, state: Value, resultKey: string): Status {
  const r = record(state[resultKey])
  if (!Object.keys(r).length) return { current:false, reason:'Not calculated' }
  if (r._units !== project.units) return { current:false, reason:'Project units changed' }
  if (!r._inputSignature) return { current:false, reason:'Saved inputs are unverified; recalculate' }
  if (r._inputSignature !== lifetimeInputSignature(state,resultKey.replace('Result',''))) return { current:false, reason:'Calculation inputs changed' }
  if (r._sourceId) {
    try {
      if (resolveReliabilitySource(project,String(r._sourceId),resultKey === 'matrixResult' ? 'distribution' : 'weibull-2p').fingerprint !== r._sourceFingerprint)
        return { current:false, reason:'Linked distribution changed' }
    } catch { return { current:false, reason:'Linked distribution is unavailable' } }
  }
  return { current:true, reason:'' }
}

export function inventoryResultStatus(project: ReturnType<typeof getProjectState>): Status {
  const state = record(project.modules.maintInventory), result = record(state.result)
  if (!Object.keys(result).length) return { current:false, reason:'Not calculated' }
  if (result.units !== project.units) return { current:false, reason:'Project units changed' }
  if (!result._inputSignature) return { current:false, reason:'Saved inputs are unverified; recalculate' }
  if (result._inputSignature !== inventoryInputSignature(state,project.units)) return { current:false, reason:'Calculation inputs changed' }
  if (state.linkedScenarioId) {
    const wrapper = record(project.modules.prediction), folios = Array.isArray(wrapper.folios) ? wrapper.folios : []
    const folio = record(folios.find(f => record(f).id === state.linkedScenarioId)), saved = record(folio.state)
    const model = record(project.modules.systemDefinition).model
    const signature = model ? JSON.stringify([systemInputFingerprint(model as Parameters<typeof systemInputFingerprint>[0]),state.linkedScenarioId,record(saved.result).request_sha256,folio.dirty,saved.partInputs,saved.blockInputs]) : ''
    if (!signature || signature !== result.source_fingerprint || folio.dirty) return { current:false, reason:'Prediction source changed' }
  }
  return { current:true, reason:'' }
}
