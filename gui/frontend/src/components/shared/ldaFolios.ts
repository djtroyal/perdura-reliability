import { getProjectState, useStoreVersion } from '../../store/project'
import { useMemo } from 'react'
import { listReliabilitySources, type SourceCapability } from './reliabilitySources'
export type { LdaDistKind, ReliabilitySource, ReliabilitySource as LdaFolioSource } from './reliabilitySources'
export type SourceModule = 'lda' | 'prediction'

/** Only explicitly adopted, current, compatible sources can be selected. */
export function useReliabilitySources(capability: SourceCapability = 'distribution') {
  useStoreVersion()
  const project = getProjectState()
  return useMemo(() => listReliabilitySources(project, capability),
    [project.modules.lifeData, project.modules.prediction, project.units, capability])
}
export function useLdaFolios() { return useReliabilitySources().filter(source => source.module === 'lda') }
