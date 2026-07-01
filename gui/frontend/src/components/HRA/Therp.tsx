import { useState, useRef } from 'react'
import { computeTherp, TherpResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, Select, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtHep } from './tables'

interface State {
  nominal: string; stress: string; experience: string
  useDep: boolean; secondHep: string; dependency: string
  result: TherpResponse | null
}
const INITIAL: State = { nominal: '0.003', stress: 'optimal', experience: 'skilled', useDep: false, secondHep: '0.01', dependency: 'LD', result: null }
const EXAMPLE: State = { nominal: '0.003', stress: 'moderately_high', experience: 'novice', useDep: true, secondHep: '0.01', dependency: 'MD', result: null }

export default function Therp() {
  const [st, setSt] = useModuleState<State>('hraTherp', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeTherp({
        nominal_hep: parseFloat(st.nominal), stress: st.stress, experience: st.experience,
        second_hep: st.useDep ? parseFloat(st.secondHep) : null,
        dependency: st.dependency,
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing THERP HEP.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="Nominal (basic) human error probability from the THERP handbook tables for this task.">Nominal HEP</InfoLabel>
        <input type="number" step="any" value={st.nominal} onChange={e => patch({ nominal: e.target.value })} className={inputCls} />
      </div>
      <Select label="Stress level" value={st.stress} onChange={v => patch({ stress: v })}
        options={[
          { value: 'very_low', label: 'Very low (×2)' },
          { value: 'optimal', label: 'Optimal (×1)' },
          { value: 'moderately_high', label: 'Moderately high (×2)' },
          { value: 'extremely_high', label: 'Extremely high (×5)' },
        ]} />
      <Select label="Experience" value={st.experience} onChange={v => patch({ experience: v })}
        options={[{ value: 'skilled', label: 'Skilled (×1)' }, { value: 'novice', label: 'Novice (×2)' }]} />
      <label className="flex items-center gap-2 text-xs text-gray-700 mt-1">
        <input type="checkbox" checked={st.useDep} onChange={e => patch({ useDep: e.target.checked })} />
        Combine with a second task (dependency)
      </label>
      {st.useDep && <>
        <div>
          <InfoLabel tip="Basic HEP of the second task (before dependency).">Second task HEP</InfoLabel>
          <input type="number" step="any" value={st.secondHep} onChange={e => patch({ secondHep: e.target.value })} className={inputCls} />
        </div>
        <Select label="Dependency level" tip="Zero, Low, Moderate, High or Complete dependence between the two tasks."
          value={st.dependency} onChange={v => patch({ dependency: v })}
          options={[
            { value: 'ZD', label: 'Zero dependence' },
            { value: 'LD', label: 'Low dependence' },
            { value: 'MD', label: 'Moderate dependence' },
            { value: 'HD', label: 'High dependence' },
            { value: 'CD', label: 'Complete dependence' },
          ]} />
      </>}
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">THERP Result</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="therp" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Card label="Adjusted HEP" value={fmtHep(res.adjusted_hep)} accent tip="Nominal × stress × experience." />
        <Card label="Stress ×" value={String(res.stress_multiplier)} />
        <Card label="Experience ×" value={String(res.experience_multiplier)} />
      </div>
      {res.conditional_hep != null && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card label={`Conditional HEP (${res.dependency})`} value={fmtHep(res.conditional_hep)} tip="Probability of the second task failing given the first, at the chosen dependency level." />
          <Card label="Joint HEP (both fail)" value={fmtHep(res.joint_hep)} accent />
        </div>
      )}
    </div>
  )

  return (
    <ToolLayout
      intro="THERP — adjust a nominal (basic) HEP by stress and experience, and optionally combine two subtasks with the dependency model (ZD=independent … CD=complete). Conditional HEP: ZD=N, LD=(1+19N)/20, MD=(1+6N)/7, HD=(1+N)/2, CD=1."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Compute HEP" results={results} />
  )
}
