import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import Descriptive from '../Descriptive'
import DataModeling from '../DataModeling'
import { useModuleState, setModuleState, getProjectState } from '../../store/project'
import { INITIAL_DATASET } from './shared'

type SubTab = 'descriptive' | 'modeling'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'descriptive', label: 'Descriptive Statistics' },
  { id: 'modeling', label: 'Regression & ML' },
]

interface AnalysisEntry {
  id: string
  name: string
}

interface DAFolioState {
  analyses: AnalysisEntry[]
  activeId: string
  snapshots: Record<string, { data: unknown; descriptive: unknown; modeling: unknown }>
  /** Per-analysis "results are stale" flag (inputs changed since last compute). */
  dirty?: Record<string, boolean>
}

const INITIAL_FOLIO: DAFolioState = {
  analyses: [{ id: 'a0', name: 'Analysis 1' }],
  activeId: 'a0',
  snapshots: {},
  dirty: {},
}

let seq = 0
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`

type Combined = { data: unknown; descriptive: unknown; modeling: unknown }

/** Strip computed-result and view-only fields so two snapshots can be compared
 *  for *input* changes (which would make existing results stale). */
function stripForInputCompare(c: Combined): unknown {
  const obj = (v: unknown) => (v && typeof v === 'object') ? { ...(v as Record<string, unknown>) } : v
  const desc = obj(c.descriptive) as Record<string, unknown> | unknown
  if (desc && typeof desc === 'object') {
    delete (desc as Record<string, unknown>).results
    delete (desc as Record<string, unknown>).activeTabs
    delete (desc as Record<string, unknown>).activeTab
  }
  const mod = obj(c.modeling) as Record<string, unknown> | unknown
  if (mod && typeof mod === 'object') {
    for (const k of ['fitted', 'selectedId', 'view', 'excluded', 'metricReg', 'metricClass']) {
      delete (mod as Record<string, unknown>)[k]
    }
  }
  return { data: c.data, descriptive: desc, modeling: mod }
}

function daInputsChanged(prev: Combined, next: Combined): boolean {
  try {
    return JSON.stringify(stripForInputCompare(prev)) !== JSON.stringify(stripForInputCompare(next))
  } catch {
    return true
  }
}

/** Whether a snapshot carries any computed results (descriptive tables/plots or
 *  fitted regression/ML models). */
function daHasResults(c: Combined): boolean {
  const desc = c.descriptive as { results?: Record<string, unknown> | null } | null
  const descHas = !!desc?.results && Object.values(desc.results).some(v => v != null)
  const mod = c.modeling as { fitted?: unknown[] } | null
  const modHas = Array.isArray(mod?.fitted) && mod!.fitted.length > 0
  return descHas || modHas
}

export default function DataAnalysis() {
  const [sub, setSub] = useState<SubTab>('descriptive')
  const [folio, setFolio] = useModuleState<DAFolioState>('dataAnalysisFolios', INITIAL_FOLIO)
  const switchingRef = useRef(false)

  // Subscribe to the active analysis's store slices so we can flag a tab as
  // "stale" (asterisk) when its inputs change after results were computed.
  const [daData] = useModuleState<unknown>('dataAnalysisData', null)
  const [descState] = useModuleState<unknown>('descriptive', null)
  const [modelingState] = useModuleState<unknown>('dataModeling', null)
  const lastStateRef = useRef<unknown>(null)

  useEffect(() => {
    const combined: Combined = { data: daData, descriptive: descState, modeling: modelingState }
    // Skip the synthetic changes produced while restoring a snapshot on switch.
    if (switchingRef.current) { lastStateRef.current = combined; return }
    const prev = lastStateRef.current as Combined | null
    lastStateRef.current = combined
    if (prev == null) return
    const dirty = daHasResults(combined) && daInputsChanged(prev, combined)
    setFolio(f => {
      const cur = f.dirty?.[f.activeId] ?? false
      if (cur === dirty) return f
      return { ...f, dirty: { ...(f.dirty ?? {}), [f.activeId]: dirty } }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daData, descState, modelingState])

  const currentSnap = () => {
    const s = getProjectState()
    return {
      data: s.modules['dataAnalysisData'] ?? INITIAL_DATASET,
      descriptive: s.modules['descriptive'] ?? null,
      modeling: s.modules['dataModeling'] ?? null,
    }
  }

  const restoreSnap = (snap: { data: unknown; descriptive: unknown; modeling: unknown } | undefined) => {
    switchingRef.current = true
    setModuleState('dataAnalysisData', snap?.data ?? INITIAL_DATASET)
    setModuleState('descriptive', snap?.descriptive ?? null)
    setModuleState('dataModeling', snap?.modeling ?? null)
    setTimeout(() => { switchingRef.current = false }, 0)
  }

  const switchTo = useCallback((id: string) => {
    if (id === folio.activeId) return
    const snap = currentSnap()
    const newSnapshots = { ...folio.snapshots, [folio.activeId]: snap }
    // Restore the target analysis's store slices BEFORE changing activeId.
    // The content div is keyed on activeId, so the folio change remounts the
    // sub-modules; the store must already hold the target snapshot by then,
    // otherwise the remounted module reads the previous analysis's results.
    restoreSnap(newSnapshots[id])
    setFolio({ ...folio, activeId: id, snapshots: newSnapshots })
  }, [folio, setFolio])

  const addAnalysis = useCallback(() => {
    const snap = currentSnap()
    const id = newId()
    const n = folio.analyses.length + 1
    const newSnapshots = { ...folio.snapshots, [folio.activeId]: snap }
    // Reset the store slices for the fresh analysis before the activeId change
    // remounts the sub-modules (see switchTo).
    restoreSnap(undefined)
    setFolio({
      ...folio,
      analyses: [...folio.analyses, { id, name: `Analysis ${n}` }],
      activeId: id,
      snapshots: newSnapshots,
    })
  }, [folio, setFolio])

  const removeAnalysis = useCallback((id: string) => {
    const isLast = folio.analyses.length <= 1
    if (!window.confirm(isLast
      ? 'Close this analysis? Its data will be removed and a new blank analysis created.'
      : 'Close this analysis? Its data will be removed.')) return
    if (isLast) {
      // Closing the only tab: spawn a fresh blank analysis in its place.
      const nid = newId()
      restoreSnap(undefined)
      setFolio({ analyses: [{ id: nid, name: 'Analysis 1' }], activeId: nid, snapshots: {}, dirty: {} })
      return
    }
    const idx = folio.analyses.findIndex(a => a.id === id)
    const analyses = folio.analyses.filter(a => a.id !== id)
    const newSnapshots = { ...folio.snapshots }
    delete newSnapshots[id]
    const newDirty = { ...(folio.dirty ?? {}) }
    delete newDirty[id]
    let activeId = folio.activeId
    if (activeId === id) {
      activeId = analyses[Math.max(0, idx - 1)].id
      restoreSnap(newSnapshots[activeId])
    }
    setFolio({ ...folio, analyses, activeId, snapshots: newSnapshots, dirty: newDirty })
  }, [folio, setFolio])

  const renameAnalysis = useCallback((id: string) => {
    const entry = folio.analyses.find(a => a.id === id)
    const name = window.prompt('Rename analysis:', entry?.name ?? '')
    if (name && name.trim()) {
      setFolio({
        ...folio,
        analyses: folio.analyses.map(a => a.id === id ? { ...a, name: name.trim() } : a),
      })
    }
  }, [folio, setFolio])

  return (
    <div className="flex flex-col h-full">
      {/* Analysis tabs (folios) */}
      <div className="flex items-stretch gap-1 bg-gray-100 border-b border-gray-200 px-2 pt-1.5 overflow-x-auto flex-shrink-0">
        {folio.analyses.map(a => {
          const isActive = a.id === folio.activeId
          const isDirty = !!folio.dirty?.[a.id]
          return (
            <div
              key={a.id}
              onClick={() => switchTo(a.id)}
              onDoubleClick={() => renameAnalysis(a.id)}
              title={isDirty
                ? 'Inputs changed since results were last computed — re-run to refresh'
                : 'Click to switch · double-click to rename'}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t cursor-pointer whitespace-nowrap border border-b-0 transition-colors ${
                isActive
                  ? 'bg-white border-gray-200 text-blue-700 font-medium'
                  : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-200/60'
              }`}
            >
              <span>
                {a.name}
                {isDirty && (
                  <span className="text-amber-500 font-bold" title="Unsaved changes — recalculate results">&nbsp;*</span>
                )}
              </span>
              <button
                onClick={e => { e.stopPropagation(); removeAnalysis(a.id) }}
                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Close analysis"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        <button
          onClick={addAnalysis}
          title="New analysis"
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-blue-600 self-end mb-px"
        >
          <Plus size={13} /> New
        </button>
      </div>

      {/* Sub-tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 flex gap-0">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              sub === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content — key on activeId to force remount when switching analyses */}
      <div className="flex-1 overflow-hidden" key={folio.activeId}>
        {sub === 'descriptive' && <Descriptive />}
        {sub === 'modeling' && <DataModeling />}
      </div>
    </div>
  )
}
