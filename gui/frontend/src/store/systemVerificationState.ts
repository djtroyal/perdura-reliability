import type { ArtifactSourceRecord } from './provenance'
import { canonicalJson } from './provenance'
import { sha256FtaText } from '../components/FaultTree/libraryModel'
import { analysisInputSnapshot, extractResults, type ProjectState } from './project'
import { engineRevisionFor } from '../version'

/** Use the same inputs and SHA-256 as export provenance, without an asynchronous stale-view race. */
export function verificationSourcesForProject(project: Pick<ProjectState, 'modules'|'units'|'analysisRuns'>): ArtifactSourceRecord[] {
  const latest = new Map<string, typeof project.analysisRuns[number]>()
  for (const run of project.analysisRuns) latest.set(`${run.moduleKey}:${run.analysisId}`, run)
  return [...latest.values()].map(run => {
    const raw = project.modules[run.moduleKey] as { _folioWrap?: boolean; folios?: {id: string; state?: unknown; dirty?: boolean}[] } | undefined
    const folio = raw?._folioWrap ? raw.folios?.find(item => item.id === run.analysisId) : undefined
    const currentState = raw?._folioWrap ? folio?.state
      : run.moduleKey === 'lifeData' && Array.isArray(raw?.folios) ? raw.folios.find(item => String(item.id) === run.analysisId) : raw
    const results = extractResults(currentState)
    const current = currentState !== undefined && results !== undefined && !folio?.dirty
      && run.engineRevision === engineRevisionFor(run.moduleKey)
      && sha256FtaText(canonicalJson(analysisInputSnapshot(currentState, run.moduleKey, project))) === run.inputSha256
      && sha256FtaText(canonicalJson(results)) === run.resultSha256
    return { runId: run.runId, moduleKey: run.moduleKey, analysisId: run.analysisId, analysisName: run.analysisName,
      fingerprintSha256: run.fingerprintSha256, inputSha256: run.inputSha256, resultSha256: run.resultSha256,
      engineRevision: run.engineRevision, current }
  })
}
