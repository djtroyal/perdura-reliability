import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AIAGVDAFMEAAnalysis } from '../../api/reliabilityProgram'
import type { SystemDefinitionModel } from '../../api/systemDefinition'
import { useUiPreference } from '../../store/uiPreferences'
import FmeaBlockDiagramCanvas from './FmeaBlockDiagramCanvas'
import { installedPath, instanceSubtree, mergeFmeaDiagramPatch, projectFmeaDiagram, type FmeaDiagramViewState } from './fmeaDiagramProjection'

const button = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 disabled:opacity-40'

export default function SharedFmeaDiagram({ analysis, model, update, focusInstanceId, onFocusInstanceId,
  scopeInstanceId, findingNavigation, fillHeight = false, viewSection = 'structure', bookmarkAnalysisId, interfaceInspector, structureInspector }: {
  analysis: AIAGVDAFMEAAnalysis
  model: SystemDefinitionModel
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
  focusInstanceId: string
  onFocusInstanceId: (id: string) => void
  scopeInstanceId?: string
  fillHeight?: boolean
  viewSection?: 'structure' | 'function' | 'equipment'
  bookmarkAnalysisId?: string
  interfaceInspector?: (interfaceId: string) => ReactNode
  structureInspector?: (instanceId: string) => ReactNode
  findingNavigation?: { requestId: number; record_id?: string } | null
}) {
  const [query, setQuery] = useState('')
  const [showParts, setShowParts] = useUiPreference<boolean>('fmea.focus.showPieceParts', false)
  const [viewJson, setViewJson] = useUiPreference<string>(
    `fmea.diagramView:${model.id}:${analysis.id}:${focusInstanceId}:${analysis.system_binding?.mode_id || 'all'}`, '')
  const history = useRef<string[]>([])
  const previousPath = useRef<string[]>([])
  const scope = useMemo(() => instanceSubtree(model, scopeInstanceId || model.root_instance_id || ''), [model, scopeInstanceId])
  const instances = useMemo(() => new Map(model.instances.map(item => [item.id, item])), [model.instances])
  const focus = scope.has(focusInstanceId) ? instances.get(focusInstanceId) : undefined
  const definitions = useMemo(() => new Map(model.definitions.map(item => [item.id, item])), [model.definitions])
  const isPart = (id: string) => definitions.get(instances.get(id)?.definition_id || '')?.kind === 'piece_part'
  useEffect(() => {
    if (focus) {
      const path: string[] = [], seen = new Set<string>()
      let current: typeof focus | undefined = focus
      while (current && !seen.has(current.id)) {
        seen.add(current.id); path.push(current.id)
        current = current.parent_instance_id ? instances.get(current.parent_instance_id) : undefined
      }
      previousPath.current = path
    } else if (focusInstanceId) {
      onFocusInstanceId(previousPath.current.find(id => instances.has(id) && scope.has(id))
        || (scopeInstanceId && instances.has(scopeInstanceId) ? scopeInstanceId : ''))
    }
  }, [focus, focusInstanceId, instances, scope, scopeInstanceId, onFocusInstanceId])
  const savedView = useMemo(() => {
    try {
      const parsed = JSON.parse(viewJson) as FmeaDiagramViewState
      return parsed && typeof parsed === 'object' ? parsed : undefined
    } catch { return undefined }
  }, [viewJson])
  const projection = useMemo(() => projectFmeaDiagram(model, analysis, focus?.id || '', savedView),
    [model, analysis, focus?.id, savedView])
  const retainedStructureIds = useMemo(() => [...projection.instanceIdByStructureId]
    .filter(([, instanceId]) => instanceId === focus?.id).map(([structureId]) => structureId),
  [projection.instanceIdByStructureId, focus?.id])
  const navigate = (id: string) => {
    if (id && !scope.has(id)) return
    if (id === focusInstanceId) return
    history.current.push(focusInstanceId)
    onFocusInstanceId(id)
  }
  const focusStructure = (id: string) => {
    const instanceId = projection.instanceIdByStructureId.get(id)
    if (instanceId) navigate(instanceId)
  }
  const breadcrumbs = []
  const seen = new Set<string>()
  let ancestor = focus
  while (ancestor && !seen.has(ancestor.id)) {
    seen.add(ancestor.id)
    if (scope.has(ancestor.id)) breadcrumbs.unshift(ancestor)
    ancestor = ancestor.parent_instance_id ? instances.get(ancestor.parent_instance_id) : undefined
  }
  const options = model.instances.filter(item => scope.has(item.id)
    && (showParts || !isPart(item.id) || item.id === focus?.id)
    && (!query || installedPath(model, item.id).toLowerCase().includes(query.toLowerCase())))
  const children = model.instances.filter(item => item.parent_instance_id === (focus?.id || scopeInstanceId || model.root_instance_id)
    && (showParts || !isPart(item.id)))
  const editProjection = (patch: Partial<AIAGVDAFMEAAnalysis>) => {
    if (patch.block_diagram) {
      const previous = new Map(projection.analysis.block_diagram.nodes.map(node => [node.id, node]))
      const expandedByNodeId = { ...savedView?.expandedByNodeId }
      for (const node of patch.block_diagram.nodes) if (Boolean(node.expanded) !== Boolean(previous.get(node.id)?.expanded))
        expandedByNodeId[node.id] = Boolean(node.expanded)
      setViewJson(JSON.stringify({ expandedByNodeId, viewport: patch.block_diagram.viewport }))
    }
    const merged = mergeFmeaDiagramPatch(analysis, projection, patch)
    if (Object.keys(merged).length) update(merged)
  }
  return <section aria-label="Shared system FMEA diagram" className={`flex flex-col gap-2 ${fillHeight
    ? 'h-full min-h-0' : 'h-[calc(100dvh-16rem)] min-h-[500px]'}`}>
    <div role="group" aria-label="FMEA focus controls" className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 p-2">
      <label className="text-xs font-medium text-slate-700">Item of focus
        <select aria-label="Item of focus" value={focus?.id || ''} onChange={event => navigate(event.target.value)}
          className="ml-2 max-w-[28rem] rounded border border-slate-300 bg-white px-2 py-1.5 text-xs">
          <option value="">Whole study · shared arrangement</option>
          {options.map(item => <option key={item.id} value={item.id}>{installedPath(model, item.id)}{isPart(item.id) ? ' (piece part)' : ''}</option>)}
          {focus && !options.some(item => item.id === focus.id) && <option value={focus.id}>{installedPath(model, focus.id)}</option>}
        </select>
      </label>
      <input type="search" aria-label="Find a system item" placeholder="Find a system item" value={query}
        onChange={event => setQuery(event.target.value)} className="min-w-32 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs" />
      <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={showParts}
        onChange={event => setShowParts(event.target.checked)} />Include piece parts in focus selector</label>
    </div>
    <nav aria-label="FMEA focus breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
      <button className={button} disabled={!history.current.length} onClick={() => onFocusInstanceId(history.current.pop() || '')}>Back</button>
      <button className={button} disabled={!focus} onClick={() => navigate(focus?.parent_instance_id && scope.has(focus.parent_instance_id) ? focus.parent_instance_id : '')}>Up</button>
      <button className={button} onClick={() => navigate('')}>Whole study</button>
      {breadcrumbs.map(item => <span key={item.id}> › <button type="button" onClick={() => navigate(item.id)}
        aria-current={item.id === focus?.id ? 'location' : undefined} className="rounded px-1 py-1 text-blue-700 hover:underline">
        {item.name || definitions.get(item.definition_id)?.name || item.id}</button></span>)}
      {projection.focused && <span className="ml-auto">{Object.keys(projection.interfaceEndpoints).length} boundary interfaces · {projection.internalInterfaceCount} internal</span>}
    </nav>
    <p className="text-xs text-slate-500">{projection.focused
      ? 'Boundary interfaces shown. Placement and model edits apply project-wide.'
      : 'Double-click a block to focus its interfaces. Placement and model edits apply project-wide.'}</p>
    <div className="min-h-0 flex-1">
      <FmeaBlockDiagramCanvas key={`${analysis.id}:${focus?.id || 'shared'}:${analysis.system_binding?.mode_id || 'all'}`} analysis={projection.analysis}
        displayPreferenceKey={`fmea:${model.id}:${analysis.id}`} resourceOptions={model.resources} retainedStructureIds={retainedStructureIds}
        update={editProjection} fillHeight allowCanonicalEditing focusView={projection.focused}
        hideAnalysisBoundary implicitRootStructureId={projection.implicitRootStructureId}
        findingNavigation={findingNavigation} interfaceEndpoints={projection.interfaceEndpoints}
        interfaceDescriptions={projection.interfaceDescriptions} hiddenStructureIds={projection.hiddenStructureIds}
        interfaceResourceIds={projection.interfaceResourceIds}
        interfaceResourceFlows={projection.interfaceResourceFlows} initialSelectedStructureId={retainedStructureIds[0]}
        interfaceInspector={interfaceInspector}
        onStructureFocus={focusStructure}
        canFocusStructure={id => scope.has(projection.instanceIdByStructureId.get(id) || '')}
        assetTargetView={`fmea:${encodeURIComponent(bookmarkAnalysisId ?? analysis.id)}:${viewSection}:${viewSection === 'structure' ? 'block_diagram' : 'interfaces'}:focus:${encodeURIComponent(focus?.id || '')}`}
        libraryContent={<div className="mb-3 border-b pb-3">
          <div className="mb-2 text-xs font-semibold text-slate-700">{focus ? 'Drill into children' : 'System items'}</div>
          {children.map(item => <button key={item.id} type="button" onClick={() => navigate(item.id)}
            className="mb-1 block w-full rounded border px-2 py-1.5 text-left text-xs text-slate-700 hover:border-blue-400">
            {item.name || definitions.get(item.definition_id)?.name || item.id}</button>)}
          {!children.length && <p className="text-xs text-slate-500">No displayed children. Use the selector to choose another item.</p>}
          {projection.focused && !Object.keys(projection.interfaceEndpoints).length && <p role="status" className="mt-3 text-xs text-slate-600">No interfaces cross this item’s boundary.</p>}
        </div>}
        structureInspector={structureId => {
          const node = analysis.structure_nodes.find(item => item.id === structureId)
          const instanceId = projection.instanceIdByStructureId.get(structureId)
          if (!node || !instanceId) return null
          if (structureInspector) return structureInspector(instanceId)
          return <div className="space-y-2">
            <p className="text-xs text-slate-500">{installedPath(model, instanceId)}{!scope.has(instanceId) ? ' · Outside study' : projection.focused && instanceId !== focus?.id ? ' · Outside focus' : ''}</p>
            <label className="block text-xs text-slate-600">Installed name<input value={node.name}
              onChange={event => update({ structure_nodes: analysis.structure_nodes.map(item => item.id === structureId
                ? { ...item, name: event.target.value } : item) })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></label>
          </div>
        }} />
    </div>
  </section>
}
