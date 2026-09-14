import type { PredictionPart } from '../../api/client'
import { beginFolioRequest, getProjectState, type FolioRequest } from '../../store/project'

export interface PredictionRequestOrigin {
  projectId: string
  revision: number
  folioId: string
  units: string
}

/** Read the latest inputs after a synchronous control update, but only from
 * the project and analysis that own the initiating render/calculation. */
export function beginDeratingCalculation<T extends { parts: PredictionPart[] }>(
  origin: PredictionRequestOrigin,
  parentRequest?: FolioRequest<T>,
): { snapshot: T; request: FolioRequest<T> } | null {
  if (parentRequest && !parentRequest.isCurrent()) return null
  const project = getProjectState()
  if (project.identity.projectId !== origin.projectId || project.revision !== origin.revision
      || project.units !== origin.units) {
    return null
  }
  const raw = project.modules.prediction
  if (!raw || typeof raw !== 'object') return null
  const wrap = raw as { _folioWrap?: boolean; activeId?: string; folios?: { id: string; state: T }[] }
  let snapshot: T | undefined
  if (wrap._folioWrap === true) {
    if (wrap.activeId !== origin.folioId || !Array.isArray(wrap.folios)) return null
    snapshot = wrap.folios.find(folio => folio.id === origin.folioId)?.state
  } else if (origin.folioId === 'f0') {
    snapshot = raw as T
  }
  if (!snapshot?.parts?.length) return null
  return {
    snapshot,
    request: beginFolioRequest('prediction', origin.folioId, snapshot, 'derating'),
  }
}

/** Use the same captured parts for API payload and shared-part input lookup. */
export function deratingApiParts(parts: PredictionPart[], profile: string) {
  const normalizePartNumber = (value?: string | null) => value?.trim().toLocaleUpperCase() ?? ''
  return parts.map(({ parentId: _parentId, system_ref: _systemRef, ...part }, index) => {
    const own = part.derating_params?.profile === profile ? part.derating_params : {}
    const partNumber = normalizePartNumber(part.part_number)
    const source = partNumber ? parts.find((candidate, candidateIndex) =>
      candidateIndex !== index
      && candidate.category === part.category
      && normalizePartNumber(candidate.part_number) === partNumber
      && candidate.derating_params?.profile === profile
      && (!own.family || candidate.derating_params?.family === own.family)
      && Object.keys(candidate.derating_params).some(key => key !== 'profile')) : undefined
    return {
      ...part,
      derating_params: source?.derating_params
        ? { ...source.derating_params, ...own, profile }
        : part.derating_params ?? {},
    }
  })
}
