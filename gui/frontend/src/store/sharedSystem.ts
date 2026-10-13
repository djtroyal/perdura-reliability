import { useCallback, useMemo } from 'react'
import { toast } from '../components/shared/toast'
import { beginFolioRequest, getProjectState, useFolioState, useModuleState, writeModuleSlices,
  type FolioRequest } from './project'
import type { SystemDefinitionState } from '../components/SystemDefinition/model'
import { canonicalDependencyUpdates, createProjectSystem, emptyPredictionScenario, materializePrediction,
  splitPredictionUpdate, systemInputFingerprint, validateProjectSystem, pruneScenarioInputs, mergePredictionResultUpdate,
  type PredictionScenario, type PredictionView } from './sharedSystemModel'

const INITIAL_SYSTEM = createProjectSystem()
export function currentProjectSystem(): SystemDefinitionState {
  return getProjectState().modules.systemDefinition as SystemDefinitionState ?? INITIAL_SYSTEM
}

export function commitProjectSystem(next: SystemDefinitionState, label = 'shared-system') {
  validateProjectSystem(next.model)
  const project = getProjectState(), before = currentProjectSystem()
  const updates = canonicalDependencyUpdates(project.modules, before, next)
  if (systemInputFingerprint(before.model) !== systemInputFingerprint(next.model)) {
    const prediction = project.modules.prediction as { _folioWrap?: boolean; folios?: { state: PredictionScenario; dirty?: boolean }[] }
    if (prediction?._folioWrap && prediction.folios) updates.prediction = { ...prediction,
      folios: prediction.folios.map(folio => ({ ...folio, dirty: Boolean(folio.state.result || folio.dirty),
        state: { ...pruneScenarioInputs(next.model, folio.state), sourceSystemFingerprint: systemInputFingerprint(next.model) } })) }
  }
  writeModuleSlices({ ...updates, systemDefinition: next }, { sliceKey: 'systemDefinition', fieldSig: label })
}

export function useSharedSystemDefinition(): [SystemDefinitionState, (value: SystemDefinitionState | ((previous: SystemDefinitionState) => SystemDefinitionState)) => void] {
  const [state] = useModuleState('systemDefinition', INITIAL_SYSTEM)
  const set = useCallback((value: SystemDefinitionState | ((previous: SystemDefinitionState) => SystemDefinitionState)) => {
    const previous = currentProjectSystem()
    try { commitProjectSystem(typeof value === 'function' ? value(previous) : value) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Shared system update failed.') }
  }, [])
  return [state, set]
}

export function useSharedPredictionState<T extends PredictionView>(initial: T) {
  const initialScenario = useMemo(() => emptyPredictionScenario(initial), [initial])
  const [scenario, , folios] = useFolioState<PredictionScenario>('prediction', initialScenario)
  const [system] = useSharedSystemDefinition()
  const view = useMemo(() => materializePrediction(system, scenario, initial), [system, scenario, initial])
  const set = useCallback((value: T | ((previous: T) => T)) => {
    const project = getProjectState(), beforeSystem = currentProjectSystem()
    const raw = project.modules.prediction as { _folioWrap?: boolean; activeId: string; folios: { id: string; name: string; state: PredictionScenario; dirty?: boolean }[] } | undefined
    const beforeScenario = raw?._folioWrap ? raw.folios.find(folio => folio.id === folios.activeId)?.state : undefined
    const current = beforeScenario ?? initialScenario
    const previous = materializePrediction(beforeSystem, current, initial)
    const next = typeof value === 'function' ? value(previous) : value
    let split: ReturnType<typeof splitPredictionUpdate<T>>
    try { split = splitPredictionUpdate(beforeSystem, current, next) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Shared system update failed.'); return }
    const wrapper = raw?._folioWrap ? raw : { _folioWrap: true, activeId: 'f0', folios: [{ id: 'f0', name: 'Scenario 1', state: current }] }
    const fingerprint = systemInputFingerprint(split.system.model)
    const structureChanged = fingerprint !== systemInputFingerprint(beforeSystem.model)
    const updates = canonicalDependencyUpdates(project.modules, beforeSystem, split.system)
    writeModuleSlices({ ...updates, systemDefinition: split.system, prediction: { ...wrapper,
      folios: wrapper.folios.map(folio => folio.id === folios.activeId
        ? { ...folio, state: { ...split.scenario, sourceSystemFingerprint: fingerprint }, dirty: Boolean(split.scenario.result) }
        : structureChanged ? { ...folio, state: { ...pruneScenarioInputs(split.system.model, folio.state), sourceSystemFingerprint: fingerprint },
          dirty: Boolean(folio.state.result || folio.dirty) } : folio),
    } }, { sliceKey: 'prediction', fieldSig: `${folios.activeId}:shared-prediction` })
  }, [folios.activeId, initial, initialScenario])
  const startRequest = (channel = 'analysis'): FolioRequest<T> => {
    const raw = getProjectState().modules.prediction as { _folioWrap?: boolean; folios?: { id: string; state: PredictionScenario }[] }
    const current = raw?._folioWrap ? raw.folios?.find(folio => folio.id === folios.activeId)?.state ?? scenario : scenario
    const request = beginFolioRequest('prediction', folios.activeId, current, channel,
      () => systemInputFingerprint(currentProjectSystem().model))
    return { ...request, commit: update => request.commit(previous => {
      const currentSystem = currentProjectSystem()
      const before = materializePrediction(currentSystem, previous, initial)
      const next = update(before)
      // Calculation callbacks own outputs/settings only. Re-splitting a derived
      // view here would persist inherited defaults and make a fresh run dirty.
      return mergePredictionResultUpdate(previous, before, next)
    }) }
  }
  return [view, set, folios, startRequest] as const
}


/** Async architecture previews are scoped to both the source and destination analyses. */
export function captureSharedSystemContext(): () => boolean {
  const project = getProjectState(), system = currentProjectSystem()
  const projectId = project.identity.projectId, revision = project.revision
  const fingerprint = systemInputFingerprint(system.model), modeId = system.selectedModeId, instanceId = system.selectedInstanceId
  const activeIds = (modules: Record<string, unknown>) => JSON.stringify(Object.entries(modules)
    .filter(([, value]) => value && typeof value === 'object' && (value as { _folioWrap?: boolean })._folioWrap)
    .map(([key, value]) => [key, (value as { activeId: string }).activeId]))
  const targets = activeIds(project.modules)
  return () => { const current = getProjectState(), next = currentProjectSystem()
    return current.identity.projectId === projectId && current.revision === revision
      && next.selectedModeId === modeId && next.selectedInstanceId === instanceId && systemInputFingerprint(next.model) === fingerprint
      && activeIds(current.modules) === targets }
}
