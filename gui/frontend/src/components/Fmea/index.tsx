/**
 * FMEA (TRIZ-based) — module container. The FMEA worksheet is DERIVED from a
 * disciplined function model: structure (object tree) → grammar-validated
 * functions → guide-word failure modes with knob-chain causes, structural
 * effect propagation and bound detection controls → generated worksheet.
 */
import { useState } from 'react'
import { Wand2 } from 'lucide-react'
import { useFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import ExampleButton from '../shared/ExampleButton'
import { TabBar } from '../shared/ui'
import { FmeaState, INITIAL_FMEA, SysObject, Fn } from './model'
import { buildExample } from './example'
import BuildWizard from './BuildWizard'
import { normalizeState } from './engine'
import StructureTab from './StructureTab'
import FunctionsTab from './FunctionsTab'
import AnalysisTab from './AnalysisTab'
import WorksheetTab from './WorksheetTab'
import { completeness } from './engine'

type SubTab = 'structure' | 'functions' | 'analysis' | 'worksheet'

export default function Fmea() {
  const [s, setS, folios] = useFolioState<FmeaState>('fmea', INITIAL_FMEA)
  const [tab, setTab] = useState<SubTab>('structure')
  const [wizardOpen, setWizardOpen] = useState(false)
  // Every mutation runs through the automation pass: guide-word modes are
  // derived for every function, dual-tool harms auto-link, function pairs
  // count as swept. Manual clicks for derivable content disappear.
  const patch = (p: Partial<FmeaState>) => setS(prev => normalizeState({ ...prev, ...p }))

  const applyWizard = ({ objects, functions }: { objects: SysObject[]; functions: Fn[] }) => {
    setWizardOpen(false)
    setS(prev => normalizeState({
      ...prev,
      objects: [...prev.objects, ...objects],
      functions: [...prev.functions, ...functions],
    }))
    setTab('analysis')
  }

  const comp = completeness(s)
  const pct = (x: { done: number; total: number }) => x.total === 0 ? null : Math.round((x.done / x.total) * 100)
  const meter = (label: string, x: { done: number; total: number }) => {
    const p = pct(x)
    return (
      <span key={label} title={`${x.done}/${x.total} ${label}`}
        className={`text-[10px] px-1.5 py-0.5 rounded border ${
          p === null ? 'text-gray-400 border-gray-200' :
          p === 100 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
          p >= 50 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-200'
        }`}>
        {label} {p === null ? '—' : `${p}%`}
      </span>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <FolioBar api={folios} />
      <div className="flex items-center bg-gray-50 border-b border-gray-200 pr-3">
        <div className="flex-1">
          <TabBar
            tabs={[
              { id: 'structure', label: '1 · Structure' },
              { id: 'functions', label: '2 · Functions' },
              { id: 'analysis', label: '3 · Failure Analysis' },
              { id: 'worksheet', label: '4 · Worksheet' },
            ]}
            active={tab}
            onChange={id => setTab(id as SubTab)}
          />
        </div>
        {/* Completeness meters — the audit trail of the analysis */}
        <div className="hidden lg:flex items-center gap-1">
          {meter('functions', comp.functionsValid)}
          {meter('sweep', comp.pairsSwept)}
          {meter('modes', comp.modesTriaged)}
          {meter('causes', comp.keptModesWithCause)}
          {meter('detection', comp.highSevWithDetection)}
        </div>
        <div className="ml-3 flex items-center gap-2">
          <button
            onClick={() => setWizardOpen(true)}
            title="Guided build: mission → objects → functions → harm sweep, with failure modes derived automatically"
            className="flex items-center gap-1.5 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded px-2.5 py-1 transition-colors"
          >
            <Wand2 size={12} /> Build wizard
          </button>
          <ExampleButton
            hasData={s.objects.length > 0 || s.functions.length > 0}
            onLoad={() => setS(normalizeState(buildExample()))}
            title="Load the acid-container corrosion-test example (worked throughout the TRIZ Power Tools books)"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50/50">
        {tab === 'structure' && <StructureTab s={s} patch={patch} />}
        {tab === 'functions' && <FunctionsTab s={s} patch={patch} />}
        {tab === 'analysis' && <AnalysisTab s={s} patch={patch} />}
        {tab === 'worksheet' && <WorksheetTab s={s} patch={patch} />}
      </div>

      <BuildWizard open={wizardOpen} onClose={() => setWizardOpen(false)} state={s} onApply={applyWizard} />
    </div>
  )
}
