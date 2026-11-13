import { useCallback, useMemo } from 'react'
import type { AIAGVDAFMEAAnalysis } from '../api/reliabilityProgram'
import { assertFmeaEditAllowed } from './fmeaReadiness'
import { toast } from '../components/shared/toast'
import { beginFolioRequest, getProjectState, hasComputedResults, useFolioState, useModuleState, useStoreVersion, writeModuleSlices } from './project'
import { currentProjectSystem, projectSystemUpdates, useSharedSystemDefinition } from './sharedSystem'
import { systemInputFingerprint, validateProjectSystem } from './sharedSystemModel'
import { canonicalFmeaBinding, collectFmeaProtectedEntityIds, fmeaEngineeringFingerprint, fmeaSemanticFingerprint,
  materializeFmeaAnalysis, splitFmeaUpdate } from './sharedFmeaModel'
import { populateFmeaInterfaceFunctions } from './interfaceFunctions'
import { materializeSharedRequirementState, splitSharedRequirementState, stripSharedRequirementProjections,
  sharedRequirementCalculationInputs, splitFmeaRequirements } from './sharedRequirementViews'
import { verificationSourcesForProject } from './systemVerificationState'

/** A working FMEA is a live system projection plus analysis-owned records.
 * Historical governance snapshots are never traversed or materialized here. */
export function useSharedFmeaState<T extends object>(
  moduleKey: 'fmea' | 'reliabilityProgram', initial: T,
  analysesKey: keyof T,
) {
  const [stored, setStored, folios] = useFolioState<T>(moduleKey, initial)
  const [system] = useSharedSystemDefinition()
  const [failureFlowRegistry] = useModuleState<unknown>('fmeaFailureFlow', undefined)
  const projectRevision = useStoreVersion()
  const materializeArchitecture = useCallback((value: T, model = currentProjectSystem().model,
    registry = getProjectState().modules.fmeaFailureFlow): T => {
    const protectedIds = collectFmeaProtectedEntityIds(value, registry)
    return { ...value, [analysesKey]: ((value[analysesKey] ?? []) as AIAGVDAFMEAAnalysis[])
      .map(analysis => materializeFmeaAnalysis(model, analysis, protectedIds)) }
  }, [analysesKey])
  const materialize = useCallback((value: T, model = currentProjectSystem().model,
    registry = getProjectState().modules.fmeaFailureFlow): T =>
    materializeSharedRequirementState(materializeArchitecture(value, model, registry), model, analysesKey, moduleKey,
      verificationSourcesForProject(getProjectState()))
  , [analysesKey, moduleKey, materializeArchitecture])
  const architectureView = useMemo(() => materializeArchitecture(stored, system.model, failureFlowRegistry),
    [stored, system.model, failureFlowRegistry, materializeArchitecture])
  const view = useMemo(() => materializeSharedRequirementState(architectureView, system.model, analysesKey, moduleKey,
    verificationSourcesForProject(getProjectState())), [architectureView, system.model, analysesKey, moduleKey, projectRevision])
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
    const requirementsChanged = JSON.stringify((before as { rows?: { requirements?: unknown } }).rows?.requirements)
      !== JSON.stringify((next as { rows?: { requirements?: unknown } }).rows?.requirements)
    const governanceChanged = JSON.stringify((before as { governance?: unknown }).governance)
      !== JSON.stringify((next as { governance?: unknown }).governance)
    if (JSON.stringify(beforeAnalyses) === JSON.stringify(nextAnalyses) && !requirementsChanged && !governanceChanged) {
      setStored(stripSharedRequirementProjections({ ...next, [analysesKey]: current[analysesKey] }, beforeSystem.model, analysesKey, moduleKey))
      return
    }
    try {
      let model = beforeSystem.model
      const protectedIds = collectFmeaProtectedEntityIds(next, project.modules.fmeaFailureFlow)
      const analyses = nextAnalyses.map(analysis => {
        const previous = beforeAnalyses.find(item => item.id === analysis.id)
        if (!previous) {
          if (analysis.kind === 'pfmea' || !canonicalFmeaBinding(model, analysis)) return populateFmeaInterfaceFunctions(analysis)
          model = splitFmeaRequirements(model, { ...analysis, functional_requirements: [] }, analysis, moduleKey)
          return analysis
        }
        if (JSON.stringify(previous) === JSON.stringify(analysis)) return analysis
        assertFmeaEditAllowed(previous, analysis, model, (before as { governance?: Record<string, { methodProfileId?: string }> }).governance?.[analysis.id]?.methodProfileId)
        const split = splitFmeaUpdate(model, previous, analysis, protectedIds, moduleKey)
        model = split.model
        return split.analysis
      })
      const requirementUpdate = splitSharedRequirementState(before, { ...next, [analysesKey]: analyses }, model, analysesKey, moduleKey)
      model = requirementUpdate.model
      validateProjectSystem(model)
      const nextSystem = { ...beforeSystem, model }
      const dependencies = projectSystemUpdates(beforeSystem, nextSystem, project.modules)
      const wrapper = raw?._folioWrap ? raw : { _folioWrap: true, activeId: 'f0',
        folios: [{ id: 'f0', name: 'Analysis 1', state: current }] }
      const dependencyWrapper = dependencies[moduleKey] as typeof wrapper | undefined
      const updated = requirementUpdate.state
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
    return beginFolioRequest(moduleKey, folios.activeId, read(), channel, () => {
      const inputs = sharedRequirementCalculationInputs(read(), currentProjectSystem().model, moduleKey)
      const analyses = (inputs[analysesKey] ?? []) as AIAGVDAFMEAAnalysis[]
      return JSON.stringify({ system: fmeaSemanticFingerprint(currentProjectSystem().model, analyses),
        requirementInputs: analyses.map(analysis => [analysis.id, analysis.functional_requirements]),
        programRequirements: moduleKey === 'reliabilityProgram' ? (inputs as { rows?: { requirements?: unknown } }).rows?.requirements : undefined,
        failureFlow: getProjectState().modules.fmeaFailureFlow })
    })
  }
  return [view, set, folios, startRequest] as const
}
