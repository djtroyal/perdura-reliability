import { useCallback, useMemo } from 'react'
import type { AIAGVDAFMEAAnalysis } from '../api/reliabilityProgram'
import { assertFmeaEditAllowed } from './fmeaReadiness'
import { toast } from '../components/shared/toast'
import { beginFolioRequest, getProjectState, hasComputedResults, useFolioState, useModuleState, writeModuleSlices } from './project'
import { currentProjectSystem, projectSystemUpdates, useSharedSystemDefinition } from './sharedSystem'
import { systemInputFingerprint, validateProjectSystem } from './sharedSystemModel'
import { canonicalFmeaBinding, collectFmeaProtectedEntityIds, fmeaEngineeringFingerprint, fmeaSemanticFingerprint,
  materializeFmeaAnalysis, splitFmeaUpdate } from './sharedFmeaModel'
import { populateFmeaInterfaceFunctions } from './interfaceFunctions'

/** A working FMEA is a live system projection plus analysis-owned records.
 * Historical governance snapshots are never traversed or materialized here. */
export function useSharedFmeaState<T extends object>(
  moduleKey: 'fmea' | 'reliabilityProgram', initial: T,
  analysesKey: keyof T,
) {
  const [stored, setStored, folios] = useFolioState<T>(moduleKey, initial)
  const [system] = useSharedSystemDefinition()
  const [failureFlowRegistry] = useModuleState<unknown>('fmeaFailureFlow', undefined)
  const materialize = useCallback((value: T, model = currentProjectSystem().model,
    registry = getProjectState().modules.fmeaFailureFlow): T => {
    const protectedIds = collectFmeaProtectedEntityIds(value, registry)
    return { ...value, [analysesKey]: ((value[analysesKey] ?? []) as AIAGVDAFMEAAnalysis[])
      .map(analysis => materializeFmeaAnalysis(model, analysis, protectedIds)) }
  }, [analysesKey])
  const view = useMemo(() => materialize(stored, system.model, failureFlowRegistry),
    [stored, system.model, failureFlowRegistry, materialize])
  const set = useCallback((value: T | ((previous: T) => T)) => {
    const project = getProjectState()
    const raw = project.modules[moduleKey] as {
      _folioWrap?: boolean; activeId: string;
      folios: { id: string; name: string; state: T; dirty?: boolean }[];
    } | undefined
    const current = raw?._folioWrap
      ? raw.folios.find(item => item.id === raw.activeId)?.state ?? initial
      : (raw as unknown as T) ?? initial
    const beforeSystem = currentProjectSystem()
    const before = materialize(current, beforeSystem.model, project.modules.fmeaFailureFlow)
    const next = typeof value === 'function' ? (value as (previous: T) => T)(before) : value
    const beforeAnalyses = (before[analysesKey] ?? []) as AIAGVDAFMEAAnalysis[]
    const nextAnalyses = (next[analysesKey] ?? []) as AIAGVDAFMEAAnalysis[]
    // Navigation changes do not write derived system records back into studies.
    if (JSON.stringify(beforeAnalyses) === JSON.stringify(nextAnalyses)) {
      setStored({ ...next, [analysesKey]: current[analysesKey] })
      return
    }
    try {
      let model = beforeSystem.model
      const protectedIds = collectFmeaProtectedEntityIds(next, project.modules.fmeaFailureFlow)
      const analyses = nextAnalyses.map(analysis => {
        const previous = beforeAnalyses.find(item => item.id === analysis.id)
        if (!previous) return analysis.kind === 'pfmea' || !canonicalFmeaBinding(model, analysis)
          ? populateFmeaInterfaceFunctions(analysis) : analysis
        if (JSON.stringify(previous) === JSON.stringify(analysis)) return analysis
        assertFmeaEditAllowed(previous, analysis, model, (before as { governance?: Record<string, { methodProfileId?: string }> }).governance?.[analysis.id]?.methodProfileId)
        const split = splitFmeaUpdate(model, previous, analysis, protectedIds)
        model = split.model
        return split.analysis
      })
      validateProjectSystem(model)
      const nextSystem = { ...beforeSystem, model }
      const dependencies = projectSystemUpdates(beforeSystem, nextSystem, project.modules)
      const wrapper = raw?._folioWrap ? raw : { _folioWrap: true, activeId: 'f0',
        folios: [{ id: 'f0', name: 'Analysis 1', state: current }] }
      const dependencyWrapper = dependencies[moduleKey] as typeof wrapper | undefined
      const updated = { ...next, [analysesKey]: analyses }
      const changedSystem = systemInputFingerprint(model) !== systemInputFingerprint(beforeSystem.model)
      const changedAnalysis = fmeaEngineeringFingerprint(beforeAnalyses) !== fmeaEngineeringFingerprint(analyses)
      writeModuleSlices({ ...dependencies, systemDefinition: nextSystem,
        [moduleKey]: { ...wrapper, folios: (dependencyWrapper?.folios ?? wrapper.folios).map(folio =>
          folio.id === wrapper.activeId ? { ...folio, state: updated,
            dirty: hasComputedResults(updated) && Boolean(changedSystem || folio.dirty || changedAnalysis),
          } : folio) },
      }, { sliceKey: moduleKey, fieldSig: `${wrapper.activeId}:shared-fmea` })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the shared System Model.')
    }
  }, [analysesKey, initial, materialize, moduleKey, setStored])
  const startRequest = (channel = 'analysis') => {
    const read = () => {
      const raw = getProjectState().modules[moduleKey] as { _folioWrap?: boolean; folios?: { id: string; state: T }[] } | undefined
      return raw?._folioWrap ? raw.folios?.find(item => item.id === folios.activeId)?.state ?? stored
        : (raw as unknown as T) ?? stored
    }
    return beginFolioRequest(moduleKey, folios.activeId, read(), channel,
      () => JSON.stringify({ system: fmeaSemanticFingerprint(currentProjectSystem().model,
        (read()[analysesKey] ?? []) as AIAGVDAFMEAAnalysis[]), failureFlow: getProjectState().modules.fmeaFailureFlow }))
  }
  return [view, set, folios, startRequest] as const
}
