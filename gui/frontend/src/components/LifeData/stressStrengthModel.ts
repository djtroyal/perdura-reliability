import { distributionFingerprint, distributionRunSnapshot, extractLifeObservations, resolveDistributionSource,
  validateDistributionParameters, folioQuantity, type DistributionRunSnapshot, type DistributionSourceRef,
  type LifeDataModelFolio, type SourceOptions } from '../shared/adoptedDistribution.ts'
import { quantityConversionFactor, type DatasetQuantity } from '../shared/datasetUnits.ts'

export interface StressStrengthInput {
  mode: 'dataset' | 'manual' | 'group'
  source?: DistributionSourceRef
  distribution?: string
  parameters?: Record<string,string>
  quantity?: DatasetQuantity
  groupId?: string
}
export interface ResolvedSsiSide { distribution: string; parameters: Record<string,number>; quantity: DatasetQuantity; source?: DistributionRunSnapshot }
export interface SsiRunProvenance { fingerprint: string; stress: ResolvedSsiSide; strength: ResolvedSsiSide }
export function resolveSsiSide(input: StressStrengthInput, folios: readonly LifeDataModelFolio[], options: SourceOptions): ResolvedSsiSide {
  if (input.mode === 'dataset') {
    if (!input.source) throw new Error('Select a source dataset.')
    const snapshot = distributionRunSnapshot(resolveDistributionSource(folios,input.source,options))
    return {distribution:snapshot.distribution,parameters:snapshot.parameters,quantity:snapshot.quantity,source:snapshot}
  }
  if (input.mode !== 'manual') throw new Error('Fit the selected ID group before calculating interference.')
  if (!input.quantity) throw new Error('Choose the manual model quantity and unit.')
  quantityConversionFactor(input.quantity,input.quantity)
  return {distribution:input.distribution ?? '',parameters:validateDistributionParameters(input.distribution ?? '',input.parameters ?? {}),quantity:input.quantity}
}
export function ssiInputFingerprint(inputs: [StressStrengthInput,StressStrengthInput], owner: LifeDataModelFolio,
  folios: readonly LifeDataModelFolio[], options: SourceOptions): string {
  if(inputs.some(input=>input.mode==='group' && !input.groupId)) throw new Error('Select both required ID groups.')
  return distributionFingerprint(inputs.map(input=>input.mode === 'group'
    ? {mode:'group',distribution:input.distribution,groupId:input.groupId,
      observations:extractLifeObservations(owner,input.groupId),method:owner.method ?? 'MLE',confidence:owner.ci ?? .95,quantity:folioQuantity(owner,options)}
    : resolveSsiSide(input,folios,options)))
}
