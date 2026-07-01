import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { Trash2, Plus } from 'lucide-react'
import { computeHeart, HeartResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { HEART_GTT, HEART_EPC, fmtHep } from './tables'

interface EpcRow { epc_id: number; proportion: string }
interface State { gtt: string; epcs: EpcRow[]; result: HeartResponse | null }
const INITIAL: State = { gtt: 'E', epcs: [], result: null }
const EXAMPLE: State = {
  gtt: 'C',
  epcs: [{ epc_id: 1, proportion: '0.4' }, { epc_id: 11, proportion: '0.5' }, { epc_id: 17, proportion: '0.6' }],
  result: null,
}

export default function Heart() {
  const [st, setSt] = useModuleState<State>('hraHeart', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const usedIds = new Set(st.epcs.map(e => e.epc_id))
  const available = HEART_EPC.filter(e => !usedIds.has(e.id))

  const addEpc = (id: number) => patch({ epcs: [...st.epcs, { epc_id: id, proportion: '0.5' }] })
  const setProp = (i: number, v: string) => patch({ epcs: st.epcs.map((e, j) => j === i ? { ...e, proportion: v } : e) })
  const delEpc = (i: number) => patch({ epcs: st.epcs.filter((_, j) => j !== i) })

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeHeart({
        gtt: st.gtt,
        epcs: st.epcs.map(e => ({ epc_id: e.epc_id, proportion: parseFloat(e.proportion) || 0 })),
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing HEART HEP.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null || st.epcs.length > 0} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="Generic Task Type — the nominal human unreliability before error-producing conditions.">Generic task type</InfoLabel>
        <select value={st.gtt} onChange={e => patch({ gtt: e.target.value })} className={inputCls}>
          {HEART_GTT.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
      </div>
      <div>
        <InfoLabel tip="Each chosen error-producing condition (EPC) is weighted by its assessed proportion of affect (0-1).">Error-producing conditions</InfoLabel>
        <div className="flex flex-col gap-1.5 mt-1">
          {st.epcs.map((e, i) => {
            const meta = HEART_EPC.find(m => m.id === e.epc_id)
            return (
              <div key={e.epc_id} className="border border-gray-200 rounded p-1.5">
                <div className="flex items-start gap-1">
                  <span className="text-[10px] text-gray-600 flex-1 leading-tight">EPC{e.epc_id} (×{meta?.max}) — {meta?.label}</span>
                  <button onClick={() => delEpc(i)} title="Remove" className="text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 size={12} /></button>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-gray-400">Proportion</span>
                  <input type="number" step="0.05" min="0" max="1" value={e.proportion}
                    onChange={ev => setProp(i, ev.target.value)} className={`${inputCls} !py-1 w-20`} />
                </div>
              </div>
            )
          })}
          {available.length > 0 && (
            <select value="" onChange={e => e.target.value && addEpc(Number(e.target.value))}
              className={`${inputCls} text-gray-500`}>
              <option value="">+ Add error-producing condition…</option>
              {available.map(e => <option key={e.id} value={e.id}>EPC{e.id} (×{e.max}) — {e.label}</option>)}
            </select>
          )}
        </div>
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">HEART Result</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="heart" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Card label="Human error probability" value={fmtHep(res.hep)} accent tip="Nominal × Π[((EPC max−1)·proportion)+1]" />
        <Card label="Nominal (GTT)" value={fmtHep(res.nominal)} />
        <Card label="EPCs applied" value={String(res.contributions.length)} />
      </div>
      {res.contributions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
          <Plot
            data={[{ type: 'bar', x: res.contributions.map(c => `EPC${c.epc_id}`), y: res.contributions.map(c => c.factor), marker: { color: '#e11d48' } } as Plotly.Data]}
            layout={{ title: { text: 'EPC contribution factor', font: { size: 13 } }, xaxis: { title: { text: 'Error-producing condition' } }, yaxis: { title: { text: 'Multiplier' } }, margin: { t: 40, r: 20, b: 50, l: 55 }, paper_bgcolor: 'white', plot_bgcolor: 'white' } as Partial<Plotly.Layout>}
            config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
        </div>
      )}
    </div>
  )

  return (
    <ToolLayout
      intro="HEART — pick a generic task type (its nominal unreliability), then add the error-producing conditions that apply, each weighted by an assessed proportion of affect (0-1). HEP = nominal × Π[((EPC max−1)·proportion)+1]."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Compute HEP" results={results} />
  )
}
