import { analysisInputSnapshot } from '../../store/project'
import { analysisSourceFingerprint, type SourceProject } from '../shared/reliabilitySources'

const signatures = new WeakMap<object, string>()
function mathematicalState(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  let signature = signatures.get(value)
  if (signature === undefined) {
    signature = JSON.stringify(analysisInputSnapshot(value, 'system'))
    signatures.set(value, signature)
  }
  return signature
}

/** A parent's request owns the mathematical inputs of every referenced RBD,
 * while child presentation and newly calculated outputs may change safely. */
export function rbdCalculationContext(project: SourceProject, rootId: string): string {
  const wrapper = project.modules.system as { folios?: { id: string; state: unknown }[] } | undefined
  const entries = new Map((wrapper?.folios ?? []).map(folio => [folio.id, folio.state]))
  const seen = new Set<string>(), pending = [rootId]
  const inputs: [string, string][] = []
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const state = entries.get(id)
    inputs.push([id, mathematicalState(state)])
    const nodes = (state as { nodes?: { data?: { linkedAnalysisId?: unknown } }[] } | undefined)?.nodes
    for (const node of nodes ?? []) {
      if (node.data?.linkedAnalysisId) pending.push(String(node.data.linkedAnalysisId))
    }
  }
  inputs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  return JSON.stringify({ inputs, sources: analysisSourceFingerprint(project, 'system', rootId) })
}

/** Cached resolution diagnostics must not survive an explicit source change. */
export function clearRbdSourceMetadata(updates: Record<string, unknown>): Record<string, unknown> {
  return 'distributionSource' in updates || 'ldaSource' in updates
    ? { ...updates, sourceError: undefined, sourceFingerprint: undefined, sourceSnapshot: undefined }
    : updates
}
