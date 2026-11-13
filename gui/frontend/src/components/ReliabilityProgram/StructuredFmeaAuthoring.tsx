import { useMemo } from 'react'
import type { AIAGVDAFMEAAnalysis, FMEAFunction } from '../../api/reliabilityProgram'
import type { SystemDefinitionModel } from '../../api/systemDefinition'
import { commitProjectSystem, currentProjectSystem } from '../../store/sharedSystem'
import { processArchitectureModel } from '../../store/systemArchitecture'
import { applyProcessArchitecture } from '../../store/interfaceFunctions'
import { inspectFunctionResourceConnections, reconcileFunctionResources } from '../../store/functionResourceFlows'
import ParentFunctionSupportEditor from '../shared/ParentFunctionSupportEditor'
import { SystemInterfaceTransferEditor } from '../shared/ResourceTransferEditor'

type Update = (patch: Partial<AIAGVDAFMEAAnalysis>) => void
export function commitArchitecture(model: SystemDefinitionModel) {
  commitProjectSystem({ ...currentProjectSystem(), model }, 'fmea-architecture')
}
export function FmeaFunctionSupport({ analysis, fn, model, update }: {
  analysis: AIAGVDAFMEAAnalysis; fn: FMEAFunction; model?: SystemDefinitionModel; update: Update
}) {
  const physical = analysis.kind !== 'pfmea'
  const architecture = useMemo(() => physical ? model : processArchitectureModel(analysis), [physical, model, analysis])
  const ambiguities = useMemo(() => architecture ? inspectFunctionResourceConnections(architecture).ambiguities : [], [architecture])
  if (!architecture) return null
  const ref = fn.system_definition_ref
  const instanceId = physical ? ref?.instance_id ?? '' : fn.structure_node_id
  const functionId = physical ? ref?.function_id ?? '' : fn.id
  const commit = (next: SystemDefinitionModel) => physical ? commitArchitecture(next) : update(applyProcessArchitecture(analysis, next))
  return <><ParentFunctionSupportEditor model={architecture} instanceId={instanceId} functionId={functionId} onChange={commit} />
    {ambiguities.filter(item => item.instanceId === instanceId && item.functionId === functionId).map(item =>
      <label key={item.inputKey} className="mt-2 block text-xs text-amber-900">Choose the interface for this input
        <select className="mt-1 block rounded border border-amber-300 bg-white p-2" value="" onChange={event =>
          commit(reconcileFunctionResources(architecture, { routeSelections: { [item.inputKey]: event.target.value } }).model)}>
          <option value="">Choose a route</option>{item.interfaceIds.map(id => <option key={id} value={id}>
            {architecture.interfaces.find(edge => edge.id === id)?.name || id}</option>)}
        </select>
      </label>)}
  </>
}
export function FmeaTransferEditor({ analysis, interfaceId, model, update }: {
  analysis: AIAGVDAFMEAAnalysis; interfaceId: string; model?: SystemDefinitionModel; update: Update
}) {
  const edge = analysis.interfaces.find(item => item.id === interfaceId)
  if (!edge) return null
  if (analysis.kind !== 'pfmea' && model && edge.system_definition_ref?.interface_id)
    return <SystemInterfaceTransferEditor model={model} interfaceId={edge.system_definition_ref.interface_id} onChange={commitArchitecture} />
  return <SystemInterfaceTransferEditor model={processArchitectureModel(analysis)} interfaceId={edge.id}
    onChange={next => update(applyProcessArchitecture(analysis, next))} />
}

