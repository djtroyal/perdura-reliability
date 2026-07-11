import { useState, useRef } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { computeMissionScenarioScreening, MissionScenarioScreeningResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtHep } from './tables'

interface Scenario { label: string; probability: string }
interface State { mission: string; scenarios: Scenario[]; mutuallyExclusive: boolean; result: MissionScenarioScreeningResponse | null }
const INITIAL: State = {
  mission: '',
  scenarios: [
    { label: '', probability: '' },
    { label: '', probability: '' },
  ],
  mutuallyExclusive: false,
  result: null,
}
const EXAMPLE: State = {
  mission: 'Establish and maintain feed-and-bleed cooling within 30 minutes',
  scenarios: [
    { label: 'Crew mis-diagnoses the transient (leading CICA fails)', probability: '0.02' },
    { label: 'Procedure step omitted under time pressure', probability: '0.015' },
    { label: 'Failure to recover after wrong action', probability: '0.008' },
  ],
  mutuallyExclusive: true,
  result: null,
}

export default function Mermos() {
  const [stored, setSt] = useModuleState<State>('hraMermos', INITIAL)
  const st: State = { ...INITIAL, ...stored }
  const patch = (p: Partial<State>) => setSt(prev => ({ ...INITIAL, ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const setRow = (i: number, k: keyof Scenario, v: string) => patch({ scenarios: st.scenarios.map((r, j) => j === i ? { ...r, [k]: v } : r) })
  const addRow = () => patch({ scenarios: [...st.scenarios, { label: '', probability: '0.01' }] })
  const delRow = (i: number) => patch({ scenarios: st.scenarios.filter((_, j) => j !== i) })

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeMissionScenarioScreening({
        scenarios: st.scenarios.map(s => ({ label: s.label || 'scenario', probability: parseFloat(s.probability) || 0 })),
        mutually_exclusive: st.mutuallyExclusive,
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error aggregating the mission scenarios.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="The operator mission whose failure scenarios are being screened.">Mission</InfoLabel>
        <textarea value={st.mission} onChange={e => patch({ mission: e.target.value })} rows={2} className={`${inputCls} resize-y`} />
      </div>
      <InfoLabel tip="Identified failure scenarios (from important configurations / CICAs) and their probabilities. Total failure probability = Σ p.">Failure scenarios</InfoLabel>
      <div className="flex flex-col gap-1.5">
        {st.scenarios.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={s.label} onChange={e => setRow(i, 'label', e.target.value)} placeholder="Scenario" className={`${inputCls} !py-1 flex-1`} />
            <input type="number" step="any" value={s.probability} onChange={e => setRow(i, 'probability', e.target.value)} className={`${inputCls} !py-1 w-20`} />
            <button onClick={() => delRow(i)} title="Remove" className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
          </div>
        ))}
        <button onClick={addRow} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"><Plus size={11} /> Add scenario</button>
      </div>
      <label className="flex items-start gap-2 text-[11px] text-gray-700">
        <input type="checkbox" checked={st.mutuallyExclusive} onChange={e => patch({ mutuallyExclusive: e.target.checked })} className="mt-0.5" />
        <span>I confirm these failure scenarios are mutually exclusive and collectively use compatible unconditional probabilities.</span>
      </label>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Mission-Scenario Screen</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="mission_scenario_screen" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card label="Total failure probability" value={fmtHep(res.hep)} accent tip="Σ of the identified failure-scenario probabilities." />
        <Card label="Scenarios" value={String(res.scenarios.length)} />
        <Card label="Dominant scenario" value={res.dominant_scenario ? fmtHep(res.dominant_scenario.probability) : '—'}
          tip={res.dominant_scenario?.label} />
      </div>
      <p className="text-[11px] text-amber-700 mt-3 leading-snug">{res.warning}</p>
    </div>
  )

  return (
    <ToolLayout
      intro="Mission-scenario screen — sum analyst-supplied failure probabilities only after confirming the scenarios are mutually exclusive. This arithmetic screen is not the full MERMOS mission-analysis and crew-response workflow."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Aggregate" results={results} />
  )
}
