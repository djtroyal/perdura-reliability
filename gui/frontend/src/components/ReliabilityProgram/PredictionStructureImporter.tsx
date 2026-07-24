import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  RefreshCw,
  Unlink,
  X,
} from 'lucide-react'

import type {
  FMEAStructureNode,
} from '../../api/reliabilityProgram'
import {
  buildPredictionStructureCatalog,
  canSplitImportedPredictionPart,
  defaultPredictionImportSelection,
  descendantsOf,
  detachPredictionStructure,
  importPredictionStructure,
  predictionEntityPieces,
  predictionImportableItemCount,
  predictionSourceEntity,
  predictionSourceStatus,
  refreshPredictionStructure,
  splitImportedPredictionParts,
  type PredictionAnalysisSource,
  type PredictionStructureCatalog,
} from './predictionStructureImport'

export function usePredictionStructureCatalogs(
  sources: PredictionAnalysisSource[],
): PredictionStructureCatalog[] {
  const [catalogs, setCatalogs] = useState<PredictionStructureCatalog[]>([])
  useEffect(() => {
    let active = true
    setCatalogs([])
    void Promise.all(sources.map(buildPredictionStructureCatalog))
      .then(next => { if (active) setCatalogs(next) })
    return () => { active = false }
  }, [sources])
  return catalogs
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/30 p-4"
    role="dialog" aria-modal="true" aria-label={title}>
    <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <button onClick={onClose} aria-label="Close"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={15} />
        </button>
      </div>
      {children}
    </div>
  </div>
}

export default function PredictionStructureImporter({
  nodes,
  sources,
  catalogs,
  update,
  onNavigatePrediction,
}: {
  nodes: FMEAStructureNode[]
  sources: PredictionAnalysisSource[]
  catalogs: PredictionStructureCatalog[]
  update: (nodes: FMEAStructureNode[]) => void
  onNavigatePrediction?: (target: {
    analysisId: string
    entityId: string
    pieceKey?: string
  }) => void
}) {
  const [open, setOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [analysisId, setAnalysisId] = useState('')
  const [focusId, setFocusId] = useState('system:system')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [splitGroupedParts, setSplitGroupedParts] = useState(false)
  const catalog = catalogs.find(item => item.analysisId === analysisId)
    ?? catalogs[0]
  const establishedFocus = nodes.find(node =>
    node.level === 'focus'
    && node.source_ref?.analysis_id === catalog?.analysisId)
    ?.source_ref?.entity_id
  const linked = nodes.filter(node => node.source_ref?.module === 'prediction')
  const changed = linked.filter(node => predictionSourceStatus(
    node,
    catalogs.find(item => item.analysisId === node.source_ref?.analysis_id),
  ) === 'changed')
  const missing = linked.filter(node => predictionSourceStatus(
    node,
    catalogs.find(item => item.analysisId === node.source_ref?.analysis_id),
  ) === 'missing')
  const splittableImported = linked.filter(node =>
    canSplitImportedPredictionPart(
      node,
      catalogs.find(item =>
        item.analysisId === node.source_ref?.analysis_id),
    ))
  const splittableForCatalog = splittableImported.filter(node =>
    node.source_ref?.analysis_id === catalog?.analysisId)
  const refreshableChanged = changed.filter(node => {
    const ref = node.source_ref!
    const catalog = catalogs.find(item => item.analysisId === ref.analysis_id)
    const source = predictionSourceEntity(node, catalog)
    return !source?.parentId || nodes.some(item =>
      item.source_ref?.analysis_id === ref.analysis_id
      && item.source_ref.entity_id === source.parentId)
  })

  const resetSelection = (
    nextCatalog: PredictionStructureCatalog|undefined,
    nextFocus = 'system:system',
  ) => {
    setFocusId(nextFocus)
    setSelected(nextCatalog
      ? defaultPredictionImportSelection(nextCatalog, nextFocus)
      : new Set())
  }
  const beginImport = () => {
    const first = catalogs[0]
    setAnalysisId(first?.analysisId ?? '')
    resetSelection(first, nodes.find(node =>
      node.level === 'focus'
      && node.source_ref?.analysis_id === first?.analysisId)
      ?.source_ref?.entity_id ?? 'system:system')
    setSplitGroupedParts(false)
    setOpen(true)
  }
  const existingSources = useMemo(() => new Set(nodes
    .filter(node => !!node.source_ref && !!catalog
      && node.source_ref.analysis_id === catalog.analysisId)
    .map(node => node.source_ref!.entity_id)), [catalog?.analysisId, nodes])
  const focusDescendants = catalog ? descendantsOf(catalog, focusId) : new Set<string>()
  const focusAncestors = useMemo(() => {
    const result = new Set<string>()
    if (!catalog) return result
    const byId = new Map(catalog.entities.map(entity => [entity.id, entity]))
    let current = byId.get(focusId)
    while (current?.parentId) {
      result.add(current.parentId)
      current = byId.get(current.parentId)
    }
    return result
  }, [catalog, focusId])
  const toggle = (id: string, checked: boolean) => {
    if (!catalog || id === focusId || focusAncestors.has(id)) return
    const next = new Set(selected)
    const descendants = descendantsOf(catalog, id)
    if (checked) {
      next.add(id)
      descendants.forEach(child => next.add(child))
      const byId = new Map(catalog.entities.map(entity => [entity.id, entity]))
      let current = byId.get(id)
      while (current?.parentId && current.parentId !== focusId) {
        next.add(current.parentId)
        current = byId.get(current.parentId)
      }
    } else {
      next.delete(id)
      descendants.forEach(child => next.delete(child))
    }
    setSelected(selectionWithRequiredParents(next))
  }
  const selectionWithRequiredParents = (candidate: Set<string>) => {
    if (!catalog) return candidate
    const next = new Set([
      focusId,
      ...focusAncestors,
      ...[...existingSources].filter(id =>
        id === focusId || focusDescendants.has(id)),
      ...candidate,
    ])
    const byId = new Map(catalog.entities.map(entity => [entity.id, entity]))
    for (const id of [...next]) {
      let current = byId.get(id)
      while (current?.parentId
          && (current.parentId === focusId
            || focusDescendants.has(current.parentId))) {
        next.add(current.parentId)
        current = byId.get(current.parentId)
      }
    }
    return next
  }
  const entityHasImportableItems = (entityId: string) => !!catalog
    && predictionImportableItemCount(
      nodes,
      catalog,
      new Set([entityId]),
      splitGroupedParts,
    ) > 0
  const selectableIds = catalog?.entities
    .filter(entity => focusDescendants.has(entity.id)
      && entityHasImportableItems(entity.id))
    .map(entity => entity.id) ?? []
  const importableCount = catalog
    ? predictionImportableItemCount(
      nodes,
      catalog,
      selected,
      splitGroupedParts,
    )
    : 0

  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={beginImport} disabled={!catalogs.length}
        title={!sources.length
          ? 'No Failure Rate Prediction analyses are available'
          : !catalogs.length ? 'Preparing Prediction hierarchy…'
            : 'Pull system blocks and Parts List rows into this FMEA'}
        className="flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400">
        <Download size={13} /> Pull from Failure Rate Prediction
      </button>
      {(changed.length > 0 || missing.length > 0) && <button type="button"
        onClick={() => setReviewOpen(true)}
        className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
        <AlertTriangle size={13} />
        Review {changed.length + missing.length} source change{
          changed.length + missing.length === 1 ? '' : 's'}
      </button>}
      {linked.length > 0 && <span className="text-[10px] text-slate-400">
        {linked.length} managed Prediction link{linked.length === 1 ? '' : 's'}
      </span>}
    </div>

    {open && <Modal title="Pull Prediction structure" onClose={() => setOpen(false)}>
      <div className="grid gap-3 border-b bg-slate-50 px-4 py-3 sm:grid-cols-2">
        <label className="text-[10px] font-medium text-slate-500">
          Failure Rate Prediction analysis
          <select value={catalog?.analysisId ?? ''} onChange={event => {
            const next = catalogs.find(item => item.analysisId === event.target.value)
            setAnalysisId(event.target.value)
            resetSelection(next, nodes.find(node =>
              node.level === 'focus'
              && node.source_ref?.analysis_id === next?.analysisId)
              ?.source_ref?.entity_id ?? 'system:system')
          }} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700">
            {catalogs.map(item => <option key={item.analysisId} value={item.analysisId}>
              {item.analysisName} · {Math.max(0, item.entities.length - 1)} item(s)
            </option>)}
          </select>
        </label>
        <label className="text-[10px] font-medium text-slate-500">
          FMEA focus element
          <select value={focusId} onChange={event => {
            setFocusId(event.target.value)
            if (catalog) setSelected(defaultPredictionImportSelection(
              catalog, event.target.value))
          }} disabled={!catalog || !!catalog.errors.length || !!establishedFocus}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700">
            {catalog?.entities.filter(entity =>
              entity.type === 'system' || entity.type === 'block')
              .map(entity => <option key={entity.id} value={entity.id}>
                {'  '.repeat(Math.max(0, entity.depth - 1))}
                {entity.type === 'system' ? 'Overall system: ' : ''}
                {entity.name}
              </option>)}
          </select>
          {establishedFocus && <span className="mt-1 block text-[9px] font-normal text-slate-400">
            This managed source already has an FMEA focus. Detach the imported
            branch before selecting a different focus.
          </span>}
        </label>
        <label className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 sm:col-span-2">
          <input type="checkbox" checked={splitGroupedParts}
            onChange={event => setSplitGroupedParts(event.target.checked)}
            className="mt-0.5" />
          <span>
            <span className="block text-xs font-medium text-slate-700">
              Pull grouped quantities as individual piece parts
            </span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
              Creates one quantity-one structure block per RefDes when available,
              with stable links back to the grouped Prediction row.
            </span>
          </span>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {catalog?.errors.length ? <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <div className="font-semibold">The source hierarchy cannot be imported.</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {catalog.errors.map(error => <li key={error}>{error}</li>)}
          </ul>
        </div> : <>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Ancestors preserve context above the focus. Choose the descendants
            to include below it. Existing managed records will not be duplicated.
          </p>
          {splittableForCatalog.length > 0 && <div
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div>
              <div className="text-xs font-medium text-amber-900">
                {splittableForCatalog.length} grouped imported part{
                  splittableForCatalog.length === 1 ? '' : 's'} can be split
              </div>
              <div className="text-[10px] text-amber-700">
                Existing function links remain attached to the first resulting
                line item.
              </div>
            </div>
            <button type="button" onClick={() => update(
              splitImportedPredictionParts(
                nodes,
                catalogs,
                new Set(splittableForCatalog.map(node => node.id)),
              ),
            )} className="rounded border border-amber-300 bg-white px-2.5 py-1.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100">
              Split existing grouped parts
            </button>
          </div>}
          <div className="mb-2 flex flex-wrap justify-end gap-1">
            <button type="button" onClick={() => setSelected(
              selectionWithRequiredParents(new Set(selectableIds)))}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-600 hover:border-blue-300 hover:text-blue-700">
              Select All
            </button>
            <button type="button" onClick={() => setSelected(
              selectionWithRequiredParents(new Set()))}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-600 hover:border-blue-300 hover:text-blue-700">
              Deselect All
            </button>
            <button type="button" onClick={() => {
              const inverse = new Set(
                selectableIds.filter(id => !selected.has(id)))
              setSelected(selectionWithRequiredParents(inverse))
            }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-600 hover:border-blue-300 hover:text-blue-700">
              Select Inverse
            </button>
          </div>
          <div className="space-y-1">
            {catalog?.entities.filter(entity =>
              entity.id === focusId
              || focusAncestors.has(entity.id)
              || focusDescendants.has(entity.id))
              .map(entity => {
                const locked = entity.id === focusId || focusAncestors.has(entity.id)
                const existingForEntity = nodes.filter(node =>
                  node.source_ref?.analysis_id === catalog.analysisId
                  && node.source_ref.entity_id === entity.id)
                const already = !entityHasImportableItems(entity.id)
                const pieces = predictionEntityPieces(entity)
                const importedPieceCount = existingForEntity.filter(
                  node => !!node.source_ref?.piece_key,
                ).length
                return <label key={entity.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                    entity.id === focusId
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-slate-200 bg-white'
                  }`}
                  style={{ marginLeft: Math.min(entity.depth, 6) * 12 }}>
                  <input type="checkbox" checked={selected.has(entity.id)}
                    disabled={locked || already}
                    onChange={event => toggle(entity.id, event.target.checked)} />
                  <ChevronRight size={11} className="text-slate-300" />
                  <span className="min-w-0 flex-1 truncate">{entity.name}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">
                    {entity.id === focusId ? 'focus' : entity.type}
                  </span>
                  {pieces.length > 0 && <span
                    className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] text-violet-700">
                    Qty {pieces.length}
                  </span>}
                  {already && <span className="flex items-center gap-0.5 text-[9px] text-emerald-600">
                    <Check size={10} /> {importedPieceCount
                      ? `${importedPieceCount}/${pieces.length} pieces imported`
                      : 'Imported'}
                  </span>}
                </label>
              })}
          </div>
        </>}
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <span className="text-[10px] text-slate-500">
          {importableCount} new structure item{importableCount === 1 ? '' : 's'}
        </span>
        <div className="flex gap-2">
          <button onClick={() => setOpen(false)}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600">
            Cancel
          </button>
          <button disabled={!catalog || !!catalog.errors.length || importableCount === 0}
            onClick={() => {
              if (!catalog) return
              update(importPredictionStructure(
                nodes,
                catalog,
                focusId,
                selected,
                { splitGroupedParts },
              ))
              setOpen(false)
            }}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-slate-300">
            Import selected
          </button>
        </div>
      </div>
    </Modal>}

    {reviewOpen && <Modal title="Review Prediction source changes"
      onClose={() => setReviewOpen(false)}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {changed.length > 0 && <section>
          <h3 className="text-xs font-semibold text-slate-700">Changed at source</h3>
          <div className="mt-2 space-y-1">
            {changed.map(node => {
              const catalog = catalogs.find(item =>
                item.analysisId === node.source_ref?.analysis_id)
              const current = predictionSourceEntity(node, catalog)
              const ref = node.source_ref!
              const changes = [
                ref.analysis_name !== catalog?.analysisName
                  ? `Analysis: ${ref.analysis_name} → ${catalog?.analysisName}` : '',
                ref.source_name !== current?.name
                  ? `Name: ${ref.source_name} → ${current?.name}` : '',
                (ref.parent_entity_id ?? '') !== (current?.parentId ?? '')
                  ? `Parent: ${ref.parent_entity_id ?? 'top level'} → ${current?.parentId ?? 'top level'}` : '',
                ref.part_number !== current?.partNumber
                  ? `Part number: ${ref.part_number ?? '—'} → ${current?.partNumber ?? '—'}` : '',
                ref.quantity !== current?.quantity
                  ? `Quantity: ${ref.quantity ?? '—'} → ${current?.quantity ?? '—'}` : '',
                ref.reference_designators.join(', ') !==
                  (current?.referenceDesignators ?? []).join(', ')
                  ? `RefDes: ${ref.reference_designators.join(', ') || '—'} → ${(current?.referenceDesignators ?? []).join(', ') || '—'}` : '',
              ].filter(Boolean)
              const parentAvailable = !current?.parentId || nodes.some(item =>
                item.source_ref?.analysis_id === ref.analysis_id
                && item.source_ref.entity_id === current.parentId)
              return <div key={node.id}
                className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                <button type="button"
                  disabled={!onNavigatePrediction}
                  onClick={() => onNavigatePrediction?.({
                    analysisId: ref.analysis_id,
                    entityId: ref.entity_id,
                    pieceKey: ref.piece_key,
                  })}
                  className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline disabled:text-slate-700 disabled:no-underline">
                  {node.name}
                  {onNavigatePrediction && <ExternalLink size={10} />}
                </button>
                <ul className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                  {changes.map(change => <li key={change}>{change}</li>)}
                </ul>
                {!parentAvailable && <div className="mt-1 text-[10px] font-medium text-amber-800">
                  Pull the new source parent before refreshing this item, or
                  detach it if it no longer belongs under the FMEA focus.
                </div>}
              </div>
            })}
          </div>
        </section>}
        {missing.length > 0 && <section>
          <h3 className="text-xs font-semibold text-slate-700">Missing at source</h3>
          <p className="mt-1 text-[10px] text-slate-500">
            These records are retained. Detach them to make them fully local,
            or delete them from Structure Analysis when no longer applicable.
          </p>
          <div className="mt-2 space-y-1">
            {missing.map(node => <div key={node.id}
              className="flex items-center justify-between rounded border border-red-200 bg-red-50 px-3 py-2 text-xs">
              <span>{node.name}</span>
              <button onClick={() => update(detachPredictionStructure(
                nodes, new Set([node.id])))}
                className="flex items-center gap-1 text-[10px] font-medium text-red-700">
                <Unlink size={11} /> Detach
              </button>
            </div>)}
          </div>
        </section>}
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <button onClick={() => setReviewOpen(false)}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600">
          Close
        </button>
        {refreshableChanged.length > 0 && <button onClick={() => {
          update(refreshPredictionStructure(
            nodes, catalogs,
            new Set(refreshableChanged.map(node => node.id))))
          if (refreshableChanged.length === changed.length) setReviewOpen(false)
        }} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
          <RefreshCw size={12} /> Refresh {refreshableChanged.length} available
        </button>}
      </div>
    </Modal>}
  </div>
}
