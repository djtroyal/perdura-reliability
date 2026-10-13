import {distributionFingerprint,distributionRunSnapshot,resolveDistributionSource,validateDistributionParameters,folioQuantity,
  type DistributionSourceRef,type DistributionRunSnapshot,type LifeDataModelFolio,type SourceOptions} from '../shared/adoptedDistribution.ts'
import {validateDatasetQuantity,type DatasetQuantity} from '../shared/datasetUnits.ts'

export interface MCVariable {
 id:string;name:string;distribution:string;params:Record<string,string>
 distributionSource?:DistributionSourceRef;quantity?:DatasetQuantity
}
export interface ResolvedMcVariable {
 id:string;name:string;distribution:string;parameters:Record<string,number>;quantity:DatasetQuantity;source?:DistributionRunSnapshot
}
export interface MonteCarloOwner extends LifeDataModelFolio {
 spec:NonNullable<LifeDataModelFolio['spec']> & {mcMode:'single'|'equation';mcVariables:MCVariable[];mcEquation:string;n:string;seed:string;
  genMode:'replace'|'append';includeSuspensions:boolean;suspensionRate:string;mcId:string}
}
export interface McRunProvenance {
 fingerprint:string;variables:ResolvedMcVariable[];outputQuantity:DatasetQuantity;equation:string|null;n:number;seed?:number
}
export function resolveMcVariable(variable:MCVariable,folios:readonly LifeDataModelFolio[],quantity:DatasetQuantity,options:SourceOptions):ResolvedMcVariable {
 if(variable.distributionSource){
  const source=distributionRunSnapshot(resolveDistributionSource(folios,variable.distributionSource,options))
  return {id:variable.id,name:variable.name,distribution:source.distribution,parameters:source.parameters,quantity:source.quantity,source}
 }
 return {id:variable.id,name:variable.name,distribution:variable.distribution,
  parameters:validateDistributionParameters(variable.distribution,variable.params),quantity:validateDatasetQuantity(variable.quantity ?? quantity)}
}
export function resolveMcRun(owner:MonteCarloOwner,folios:readonly LifeDataModelFolio[],options:SourceOptions):McRunProvenance {
 const spec=owner.spec,n=Number(spec.n),seed=spec.seed.trim()?Number(spec.seed):undefined
 const max=spec.mcMode==='equation'?100000:10000
 if(!Number.isInteger(n)||n<2||n>max)throw new Error(`Sample count must be an integer between 2 and ${max.toLocaleString('en-US')}.`)
 if(seed!==undefined&&(!Number.isSafeInteger(seed)||seed<0))throw new Error('Seed must be a nonnegative integer or blank.')
 const outputQuantity=folioQuantity(owner,options)
 const variables=spec.mcMode==='equation'?spec.mcVariables.map(v=>resolveMcVariable(v,folios,outputQuantity,options))
  :[{id:'single',name:'X',distribution:spec.distribution,parameters:validateDistributionParameters(spec.distribution,spec.params),quantity:outputQuantity}]
 if(!variables.length||variables.length>20)throw new Error('Provide 1–20 variables.')
 const equation=spec.mcMode==='equation'?spec.mcEquation.trim():null
 if(spec.mcMode==='equation'&&!equation)throw new Error('Equation is empty.')
 const suspensionRate=spec.includeSuspensions?Number(spec.suspensionRate):0
 if(!Number.isFinite(suspensionRate)||suspensionRate<0||suspensionRate>100)throw new Error('Suspension rate must be between 0 and 100 percent.')
 const contents={variables,outputQuantity,equation,n,seed,genMode:spec.genMode,suspensionRate,mcId:spec.mcId,engineRevision:options.engineRevision ?? 2}
 return {fingerprint:distributionFingerprint(contents),variables,outputQuantity,equation,n,seed}
}
/** Destination edits must not be overwritten by an older generation request. */
export const mcDestinationFingerprint=(owner:LifeDataModelFolio)=>distributionFingerprint({rows:owner.rows,frequencyRows:owner.frequencyRows,intervalRows:owner.intervalRows,dataFormat:owner.dataFormat})
