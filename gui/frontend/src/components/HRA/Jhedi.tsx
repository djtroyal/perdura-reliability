import { useState, useRef } from 'react'
import { computeJhedi, JhediResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, Select, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtHep } from './tables'

interface State { category: string; factors: string; result: JhediResponse | null }
const INITIAL: State = { category: 'routine', factors: '0', result: null }
const EXAMPLE: State = { category: 'complex', factors: '2', result: null }

export default function Jhedi() {
  const [st, setSt] = useModuleState<State>('hraJhedi', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeJhedi({ task_category: st.category, aggravating_factors: parseInt(st.factors, 10) || 0 })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing JHEDI screening HEP.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <Select label="Task category" tip="Base screening rate: simple 0.001, routine 0.01, complex 0.1, unfamiliar 0.3."
        value={st.category} onChange={v => patch({ category: v })}
        options={[
          { value: 'simple', label: 'Simple (0.001)' },
          { value: 'routine', label: 'Routine (0.01)' },
          { value: 'complex', label: 'Complex (0.1)' },
          { value: 'unfamiliar', label: 'Unfamiliar (0.3)' },
        ]} />
      <div>
        <InfoLabel tip="Number of aggravating conditions present. Each multiplies the base rate by 3 (screening approximation).">Aggravating factors</InfoLabel>
        <input type="number" step="1" min="0" value={st.factors} onChange={e => patch({ factors: e.target.value })} className={inputCls} />
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">JHEDI Screening</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="jhedi" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card label="Screening HEP" value={fmtHep(res.hep)} accent />
        <Card label="Base rate" value={fmtHep(res.base)} />
        <Card label="Aggravating factors" value={String(res.aggravating_factors)} />
      </div>
      <p className="text-[11px] text-gray-500 mt-3 leading-snug">
        JHEDI is a conservative screening technique: HEP = base rate × 3^(aggravating factors). Use a
        detailed method (HEART, SPAR-H) for tasks that screen as significant contributors.
      </p>
    </div>
  )

  return (
    <ToolLayout
      intro="JHEDI — a quick screening estimate: pick a task category for the base error rate and count the aggravating conditions present. Intended for first-pass screening, not detailed quantification."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Screen" results={results} />
  )
}
