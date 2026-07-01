import { useState, useRef } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { computeSlim, SlimResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtHep } from './tables'

interface PsfRow { name: string; weight: string; rating: string }
interface State {
  psfs: PsfRow[]
  sli1: string; hep1: string; sli2: string; hep2: string
  result: SlimResponse | null
}
const INITIAL: State = {
  psfs: [
    { name: 'Time', weight: '0.3', rating: '60' },
    { name: 'Training', weight: '0.4', rating: '70' },
    { name: 'Procedures', weight: '0.3', rating: '50' },
  ],
  sli1: '20', hep1: '0.1', sli2: '80', hep2: '0.0001', result: null,
}
const EXAMPLE: State = { ...INITIAL, psfs: [
  { name: 'Time', weight: '0.4', rating: '40' },
  { name: 'Stress', weight: '0.3', rating: '30' },
  { name: 'HMI', weight: '0.3', rating: '55' },
], result: null }

export default function Slim() {
  const [st, setSt] = useModuleState<State>('hraSlim', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const setRow = (i: number, k: keyof PsfRow, v: string) => patch({ psfs: st.psfs.map((r, j) => j === i ? { ...r, [k]: v } : r) })
  const addRow = () => patch({ psfs: [...st.psfs, { name: '', weight: '0.2', rating: '50' }] })
  const delRow = (i: number) => patch({ psfs: st.psfs.filter((_, j) => j !== i) })

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeSlim({
        psfs: st.psfs.map(p => ({ weight: parseFloat(p.weight) || 0, rating: parseFloat(p.rating) || 0 })),
        anchors: [
          { sli: parseFloat(st.sli1), hep: parseFloat(st.hep1) },
          { sli: parseFloat(st.sli2), hep: parseFloat(st.hep2) },
        ],
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing SLIM HEP.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="Each PSF has a weight (importance) and a rating (0-100, higher = more favourable). SLI = Σ(normalized weight × rating).">Performance shaping factors</InfoLabel>
        <div className="flex flex-col gap-1 mt-1">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 text-[10px] text-gray-400 px-0.5">
            <span>Name</span><span className="w-16 text-center">Weight</span><span className="w-16 text-center">Rating</span><span className="w-5" />
          </div>
          {st.psfs.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-1 items-center">
              <input value={p.name} onChange={e => setRow(i, 'name', e.target.value)} placeholder="PSF" className={`${inputCls} !py-1`} />
              <input type="number" step="any" value={p.weight} onChange={e => setRow(i, 'weight', e.target.value)} className={`${inputCls} !py-1 w-16`} />
              <input type="number" step="any" value={p.rating} onChange={e => setRow(i, 'rating', e.target.value)} className={`${inputCls} !py-1 w-16`} />
              <button onClick={() => delRow(i)} title="Remove" className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={addRow} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 mt-0.5"><Plus size={11} /> Add PSF</button>
        </div>
      </div>
      <div>
        <InfoLabel tip="Two anchor tasks with known SLI and HEP calibrate log10(HEP) = a·SLI + b.">Calibration anchors</InfoLabel>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <input type="number" step="any" value={st.sli1} onChange={e => patch({ sli1: e.target.value })} placeholder="SLI 1" className={`${inputCls} !py-1`} />
          <input type="number" step="any" value={st.hep1} onChange={e => patch({ hep1: e.target.value })} placeholder="HEP 1" className={`${inputCls} !py-1`} />
          <input type="number" step="any" value={st.sli2} onChange={e => patch({ sli2: e.target.value })} placeholder="SLI 2" className={`${inputCls} !py-1`} />
          <input type="number" step="any" value={st.hep2} onChange={e => patch({ hep2: e.target.value })} placeholder="HEP 2" className={`${inputCls} !py-1`} />
        </div>
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">SLIM-MAUD Result</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="slim" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Human error probability" value={fmtHep(res.hep)} accent />
        <Card label="Success Likelihood Index" value={res.sli.toFixed(2)} />
        <Card label="Calibration a" value={res.a.toPrecision(3)} />
        <Card label="Calibration b" value={res.b.toPrecision(3)} />
      </div>
    </div>
  )

  return (
    <ToolLayout
      intro="SLIM-MAUD — weight and rate the performance shaping factors to form a Success Likelihood Index (SLI), then calibrate log10(HEP) = a·SLI + b from two anchor tasks with known HEP."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Compute HEP" results={results} />
  )
}
