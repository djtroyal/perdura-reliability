import { useState, useRef } from 'react'
import { computeAtheana, AtheanaResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtHep } from './tables'

interface State {
  unsafeAction: string; efc: string
  min: string; mode: string; max: string
  result: AtheanaResponse | null
}
const INITIAL: State = { unsafeAction: '', efc: '', min: '0.001', mode: '0.01', max: '0.1', result: null }
const EXAMPLE: State = {
  unsafeAction: 'Operator terminates safety injection prematurely',
  efc: 'Misleading indication + high workload + training gap for this scenario',
  min: '0.005', mode: '0.03', max: '0.2', result: null,
}

export default function Atheana() {
  const [st, setSt] = useModuleState<State>('hraAtheana', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeAtheana({ min_hep: parseFloat(st.min), mode_hep: parseFloat(st.mode), max_hep: parseFloat(st.max) })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing ATHEANA estimate.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="The human failure event / unsafe action being analysed.">Unsafe action</InfoLabel>
        <textarea value={st.unsafeAction} onChange={e => patch({ unsafeAction: e.target.value })} rows={2} className={`${inputCls} resize-y`} />
      </div>
      <div>
        <InfoLabel tip="The error-forcing context: the plant conditions and performance-shaping factors that make the unsafe action likely.">Error-forcing context</InfoLabel>
        <textarea value={st.efc} onChange={e => patch({ efc: e.target.value })} rows={3} className={`${inputCls} resize-y`} />
      </div>
      <InfoLabel tip="Expert triangular estimate of the HEP; the point estimate is the mean (min + mode + max)/3.">Expert HEP estimate</InfoLabel>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-[10px] text-gray-400">Min</label><input type="number" step="any" value={st.min} onChange={e => patch({ min: e.target.value })} className={`${inputCls} !py-1`} /></div>
        <div><label className="text-[10px] text-gray-400">Most likely</label><input type="number" step="any" value={st.mode} onChange={e => patch({ mode: e.target.value })} className={`${inputCls} !py-1`} /></div>
        <div><label className="text-[10px] text-gray-400">Max</label><input type="number" step="any" value={st.max} onChange={e => patch({ max: e.target.value })} className={`${inputCls} !py-1`} /></div>
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">ATHEANA Estimate</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="atheana" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Elicited HEP (mean)" value={fmtHep(res.hep)} accent />
        <Card label="Min" value={fmtHep(res.min)} />
        <Card label="Most likely" value={fmtHep(res.mode)} />
        <Card label="Max" value={fmtHep(res.max)} />
      </div>
      <p className="text-[11px] text-gray-500 mt-3 leading-snug">
        ATHEANA is a qualitative, expert-driven search for error-forcing contexts; the number here is
        the mean of the expert triangular estimate documented above.
      </p>
    </div>
  )

  return (
    <ToolLayout
      intro="ATHEANA — document the unsafe action and its error-forcing context (the second-generation focus), then record an expert triangular HEP estimate. The point estimate is the mean of min / most-likely / max."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Estimate" results={results} />
  )
}
