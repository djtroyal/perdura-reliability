import { useState, useCallback, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import Descriptive from '../Descriptive'
import DataModeling from '../DataModeling'
import { useModuleState, setModuleState, getProjectState } from '../../store/project'
import { INITIAL_DATASET, SharedDataset } from './shared'

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
}

const INITIAL_FOLIO: DAFolioState = {
  analyses: [{ id: 'a0', name: 'Analysis 1' }],
  activeId: 'a0',
  snapshots: {},
}

let seq = 0
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`

export default function DataAnalysis() {
  const [sub, setSub] = useState<SubTab>('descriptive')
  const [folio, setFolio] = useModuleState<DAFolioState>('dataAnalysisFolios', INITIAL_FOLIO)
  const switchingRef = useRef(false)

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
    if (snap?.descriptive != null) setModuleState('descriptive', snap.descriptive)
    if (snap?.modeling != null) setModuleState('dataModeling', snap.modeling)
    setTimeout(() => { switchingRef.current = false }, 0)
  }

  const switchTo = useCallback((id: string) => {
    if (id === folio.activeId) return
    const snap = currentSnap()
    const newSnapshots = { ...folio.snapshots, [folio.activeId]: snap }
    setFolio({ ...folio, activeId: id, snapshots: newSnapshots })
    restoreSnap(newSnapshots[id])
  }, [folio, setFolio])

  const addAnalysis = useCallback(() => {
    const snap = currentSnap()
    const id = newId()
    const n = folio.analyses.length + 1
    const newSnapshots = { ...folio.snapshots, [folio.activeId]: snap }
    setFolio({
      analyses: [...folio.analyses, { id, name: `Analysis ${n}` }],
      activeId: id,
      snapshots: newSnapshots,
    })
    restoreSnap(undefined)
  }, [folio, setFolio])

  const removeAnalysis = useCallback((id: string) => {
    if (folio.analyses.length <= 1) return
    if (!window.confirm('Close this analysis? Its data will be removed.')) return
    const idx = folio.analyses.findIndex(a => a.id === id)
    const analyses = folio.analyses.filter(a => a.id !== id)
    const newSnapshots = { ...folio.snapshots }
    delete newSnapshots[id]
    let activeId = folio.activeId
    if (activeId === id) {
      activeId = analyses[Math.max(0, idx - 1)].id
      restoreSnap(newSnapshots[activeId])
    }
    setFolio({ analyses, activeId, snapshots: newSnapshots })
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
          return (
            <div
              key={a.id}
              onClick={() => switchTo(a.id)}
              onDoubleClick={() => renameAnalysis(a.id)}
              title="Click to switch · double-click to rename"
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t cursor-pointer whitespace-nowrap border border-b-0 transition-colors ${
                isActive
                  ? 'bg-white border-gray-200 text-blue-700 font-medium'
                  : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-200/60'
              }`}
            >
              <span>{a.name}</span>
              {folio.analyses.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); removeAnalysis(a.id) }}
                  className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Close analysis"
                >
                  <X size={12} />
                </button>
              )}
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

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {sub === 'descriptive' && <Descriptive />}
        {sub === 'modeling' && <DataModeling />}
      </div>
    </div>
  )
}
