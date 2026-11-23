import type { LifecycleState, LifecycleSettings, SystemDiagram } from '../../api/systemTools'
import { resolveLinkedNodes, type SourceProject } from './reliabilitySources'
import { systemTaskSourceIssue, type SystemTaskCatalog } from './systemTaskImport'

const calculationFields = new Set([
  'distribution', 'dist_params', 'distributionSource', 'sourceFingerprint', 'sourceError',
  'systemReferenceBroken', 'component_key', 'eventKey', 'event_key', 'mission_time', 'exposure_time',
  'reliability', 'probability', 'k', 'min', 'max', 'low', 'high', 'state', 'value',
  'linkedAnalysisId', 'analysisId', 'referenceAnalysisId', 'transferTo', 'ccf_group', 'ccf_beta',
])
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}

export const lifecycleSettingsSignature = (settings: LifecycleSettings): string => JSON.stringify(canonical(settings))

/** One semantic signature for the live editor, persisted reports, and source guards. */
export function systemDiagramSignature(diagram: SystemDiagram): string {
  return JSON.stringify(canonical({ kind: diagram.kind, mission_time: diagram.mission_time,
    nodes: diagram.nodes.map(n => ({ id: n.id, type: n.type,
      data: Object.fromEntries(Object.entries(n.data).filter(([key]) => calculationFields.has(key))) })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: diagram.edges.map(e => ({ source: e.source, target: e.target, role: e.role, order: e.order }))
      .sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b)))),
  }))
}

/** Resolve adopted sources at the calculation/report boundary, never from cached params. */
export function resolveLifecycleDiagram(project: SourceProject, kind: 'rbd' | 'fta', state: Record<string, any>): SystemDiagram {
  return { kind, mission_time: Number(kind === 'rbd' ? state.missionTime ?? 1000 : state.exposureTime ?? 1000),
    nodes: (state.nodes ?? []).map((node: any) => {
      const normalized = { id: String(node.id), type: String(node.type ?? (kind === 'rbd' ? 'component' : 'basic')), data: node.data ?? {} }
      return resolveLinkedNodes(project, [normalized])[0]
    }),
    edges: (state.edges ?? []).filter((edge: any) => !edge.data?.annotation).map((edge: any) => ({
      source: String(edge.source), target: String(edge.target),
      ...(kind === 'fta' ? { role: edge.role ?? edge.data?.role, order: edge.order ?? edge.data?.order } : {}),
    })),
  }
}

export function lifecycleSourceStatus(project: SourceProject, kind: 'rbd' | 'fta', state: Record<string, any>): { current: boolean; reason: string } {
  const lifecycle = state.lifecycle as LifecycleState | undefined
  if (!lifecycle?.modelSignature) return { current: false, reason: 'No verified diagram/source signature accompanies this lifecycle result.' }
  if (lifecycle.inputSignature !== lifecycleSettingsSignature(lifecycle.settings))
    return { current: false, reason: 'Lifecycle settings changed or the saved result lacks a verified input signature. Recalculate.' }
  try {
    const issue = systemTaskSourceIssue(project.modules.maintTaskAnalysis as SystemTaskCatalog ?? { tasks: [], personnel: [], resources: [] }, lifecycle.settings.policies, project.units, lifecycle.settings.repair_crews)
    if (issue) return { current: false, reason: issue }
    if (systemDiagramSignature(resolveLifecycleDiagram(project, kind, state)) !== lifecycle.modelSignature)
      return { current: false, reason: 'The diagram, exposure or adopted source changed since lifecycle calculation.' }
    if (lifecycle.stateResult && JSON.stringify(lifecycle.stateResult.evaluated_overrides ?? {}) !== JSON.stringify(lifecycle.settings.overrides))
      return { current: false, reason: 'State-success overrides changed and have not been reevaluated.' }
    return { current: true, reason: '' }
  } catch (error) { return { current: false, reason: (error as Error).message } }
}
