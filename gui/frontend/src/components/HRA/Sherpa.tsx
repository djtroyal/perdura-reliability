import { useState, useRef } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { computeSherpa, SherpaResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtHep } from './tables'

interface Row { step: string; error_mode: string; probability: string; critical: boolean }
interface State { rows: Row[]; result: SherpaResponse | null }
const ERROR_MODES = ['Action', 'Checking', 'Retrieval', 'Communication', 'Selection']
const INITIAL: State = {
  rows: [
    { step: 'Open valve V1', error_mode: 'Action', probability: 'M', critical: true },
    { step: 'Verify flow', error_mode: 'Checking', probability: 'L', critical: false },
  ],
  result: null,
}
const EXAMPLE: State = {
  rows: [
    { step: 'Select correct pump', error_mode: 'Selection', probability: 'M', critical: true },
    { step: 'Start pump', error_mode: 'Action', probability: 'L', critical: false },
    { step: 'Read pressure gauge', error_mode: 'Retrieval', probability: 'H', critical: true },
    { step: 'Report to supervisor', error_mode: 'Communication', probability: 'L', critical: false },
  ],
  result: null,
}

export default function Sherpa() {
  const [st, setSt] = useModuleState<State>('hraSherpa', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const setRow = (i: number, k: keyof Row, v: string | boolean) => patch({ rows: st.rows.map((r, j) => j === i ? { ...r, [k]: v } : r) })
  const addRow = () => patch({ rows: [...st.rows, { step: '', error_mode: 'Action', probability: 'M', critical: false }] })
  const delRow = (i: number) => patch({ rows: st.rows.filter((_, j) => j !== i) })

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeSherpa({ rows: st.rows.map(r => ({ error_mode: r.error_mode, probability: r.probability, critical: r.critical })) })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error aggregating SHERPA worksheet.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <InfoLabel tip="For each task step, classify the credible error mode, its likelihood (Low/Medium/High → 0.001/0.01/0.1) and whether the consequence is critical.">Task-step error worksheet</InfoLabel>
      <div className="flex flex-col gap-1.5">
        {st.rows.map((r, i) => (
          <div key={i} className="border border-gray-200 rounded p-1.5 flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input value={r.step} onChange={e => setRow(i, 'step', e.target.value)} placeholder="Task step" className={`${inputCls} !py-1 flex-1`} />
              <button onClick={() => delRow(i)} title="Remove" className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
            </div>
            <div className="flex items-center gap-1">
              <select value={r.error_mode} onChange={e => setRow(i, 'error_mode', e.target.value)} className={`${inputCls} !py-1 flex-1`}>
                {ERROR_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={r.probability} onChange={e => setRow(i, 'probability', e.target.value)} className={`${inputCls} !py-1 w-16`}>
                <option value="L">L</option><option value="M">M</option><option value="H">H</option>
              </select>
              <label className="flex items-center gap-1 text-[10px] text-gray-600 whitespace-nowrap">
                <input type="checkbox" checked={r.critical} onChange={e => setRow(i, 'critical', e.target.checked)} /> crit.
              </label>
            </div>
          </div>
        ))}
        <button onClick={addRow} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"><Plus size={11} /> Add step</button>
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">SHERPA Result</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="sherpa" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Card label="Overall error probability" value={fmtHep(res.hep)} accent tip="1 − Π(1 − p) across all steps." />
        <Card label="Worst critical step" value={fmtHep(res.max_critical_probability)} />
        <Card label="Steps analysed" value={String(res.rows.length)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(res.counts_by_mode).map(([m, c]) => (
          <span key={m} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-1 rounded">{m}: {c}</span>
        ))}
      </div>
    </div>
  )

  return (
    <ToolLayout
      intro="SHERPA — a task-step error worksheet using the human-error taxonomy (Action / Checking / Retrieval / Communication / Selection). Each step's likelihood (L/M/H) aggregates to an overall error probability; critical steps are highlighted."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Aggregate" results={results} />
  )
}
