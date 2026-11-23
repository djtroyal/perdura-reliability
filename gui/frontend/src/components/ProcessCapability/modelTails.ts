import { distributionFingerprint, resolveAdoptedDistribution, type AdoptedDistribution, type LifeDataModelFolio } from '../shared/adoptedDistribution.ts'
import type { SpecificationTailResult } from '../../api/capability.ts'

type ModelProject = { units: string; modules: Record<string, unknown> }
export interface SavedSpecificationTailResult extends SpecificationTailResult {
  sourceFingerprint: string
  sourceName: string
  unit: string
  provenance?: { schemaVersion: 1; engineRevision: number; sourceId: string; model: AdoptedDistribution }
}
export interface CapabilityTailState {
  modelSourceId?: string
  modelTailResult?: SavedSpecificationTailResult | null
  lsl?: string
  usl?: string
}

/** Capability uses the measurement unit of the adopted model, including
 * force, pressure and custom quantities; lifetime-only source adapters would
 * incorrectly discard these datasets. */
export function capabilityModelSources(project: ModelProject) {
  const state = project.modules.lifeData as { folios?: LifeDataModelFolio[] } | undefined
  return (state?.folios ?? []).flatMap(folio => {
    const resolved = resolveAdoptedDistribution(folio, { projectUnit: project.units })
    return resolved.status === 'current'
      ? [{ id: folio.id, name: folio.name ?? folio.id, model: resolved.model, fingerprint: resolved.fingerprint }]
      : []
  })
}

export function saveCapabilityModelTail(result: SpecificationTailResult,
  source: ReturnType<typeof capabilityModelSources>[number], engineRevision: number): SavedSpecificationTailResult {
  return { ...result, sourceFingerprint: source.fingerprint, sourceName: source.name, unit: source.model.quantity.unit,
    provenance: { schemaVersion: 1, engineRevision, sourceId: source.id, model: structuredClone(source.model) } }
}

/** Evaluate saved context without rewriting results or promoting legacy output. */
export function capabilityModelTailStatus(project: ModelProject, state: CapabilityTailState, engineRevision: number) {
  const result = state.modelTailResult
  if (!result) return null
  const provenance = result.provenance
  if (!provenance || provenance.schemaVersion !== 1 || !provenance.model) return {
    status: 'unverified' as const, reason: 'The saved result has no verified calculation context. Recalculate model PPM.',
  }
  const { adoptedAt: _date, modelFingerprint, ...contents } = provenance.model
  if (distributionFingerprint(contents) !== modelFingerprint) return {
    status: 'unverified' as const, reason: 'The saved model snapshot is inconsistent. Recalculate model PPM.',
  }
  const source = capabilityModelSources(project).find(item => item.id === state.modelSourceId)
  if (provenance.engineRevision !== engineRevision) return {
    status: 'stale' as const, reason: 'The calculation engine changed since this result was calculated.',
  }
  if (!source || source.id !== provenance.sourceId || source.fingerprint !== result.sourceFingerprint
    || source.fingerprint !== provenance.model.modelFingerprint) return {
    status: 'stale' as const, reason: 'The adopted source model changed or is unavailable.',
  }
  const parameters = (value: Record<string, number>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
  if (result.distribution !== provenance.model.distribution || result.unit !== provenance.model.quantity.unit
    || parameters(result.params) !== parameters(provenance.model.parameters)) return {
    status: 'unverified' as const, reason: 'The saved calculation and model snapshot do not agree. Recalculate model PPM.',
  }
  if ((state.lsl?.trim() ? Number(state.lsl) : null) !== result.lsl
    || (state.usl?.trim() ? Number(state.usl) : null) !== result.usl) return {
    status: 'stale' as const, reason: 'Specification limits changed since this result was calculated.',
  }
  return { status: 'current' as const, reason: 'Current adopted model and specification limits.' }
}
