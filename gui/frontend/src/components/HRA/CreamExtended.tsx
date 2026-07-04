import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { Trash2, Plus } from 'lucide-react'
import { computeCreamExtended, CreamExtendedResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { CREAM_CPCS, CREAM_ACTIVITIES, CREAM_FAILURE_TYPES, fmtHep } from './tables'

interface StepRow { description: string; activity: string; failure_type: string }
interface State { levels: Record<string, string>; steps: StepRow[]; result: CreamExtendedResponse | null }

const defaults = () => Object.fromEntries(CREAM_CPCS.map(c => {
  const mid = c.levels.find(l => l.effect === 'not_significant') ?? c.levels[0]
  return [c.key, mid.key]
}))
const INITIAL: State = {
  levels: defaults(),
  steps: [{ description: '', activity: 'execute', failure_type: 'E1' }],
  result: null,
}
const EXAMPLE: State = {
  levels: { ...defaults(), available_time: 'continuously_inadequate', training_experience: 'inadequate' },
  steps: [
    { description: 'Diagnose the alarm pattern', activity: 'diagnose', failure_type: 'I1' },
    { description: 'Select the response procedure', activity: 'plan', failure_type: 'P2' },
    { description: 'Isolate the affected train', activity: 'execute', failure_type: 'E5' },
    { description: 'Verify system response', activity: 'verify', failure_type: 'O3' },
  ],
  result: null,
}

/** Failure types applicable to an activity (its cognitive functions). */
const typesFor = (activityKey: string) => {
  const act = CREAM_ACTIVITIES.find(a => a.key === activityKey)
  if (!act) return CREAM_FAILURE_TYPES
  return CREAM_FAILURE_TYPES.filter(t => act.functions.includes(t.fn))
}

export default function CreamExtended() {
  const [st, setSt] = useModuleState<State>('hraCreamExt', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const setLevel = (k: string, v: string) => patch({ levels: { ...st.levels, [k]: v } })
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const setStep = (i: number, p: Partial<StepRow>) => {
    const next = st.steps.map((s, j) => {
      if (j !== i) return s
      const merged = { ...s, ...p }
      // Changing the activity may invalidate the chosen failure type — snap to
      // the first applicable one so backend validation can't trip on stale state.
      if (p.activity && !typesFor(merged.activity).some(t => t.id === merged.failure_type)) {
        merged.failure_type = typesFor(merged.activity)[0]?.id ?? 'E1'
      }
      return merged
    })
    patch({ steps: next })
  }
  const addStep = () => patch({ steps: [...st.steps, { description: '', activity: 'execute', failure_type: 'E1' }] })
  const delStep = (i: number) => patch({ steps: st.steps.filter((_, j) => j !== i) })

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeCreamExtended({ cpc_levels: st.levels, steps: st.steps })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing extended CREAM.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <InfoLabel tip="Break the task into steps; classify each step's cognitive activity and the credible generic failure type (filtered to that activity's cognitive functions).">Task steps</InfoLabel>
      <div className="flex flex-col gap-1.5">
        {st.steps.map((s, i) => (
          <div key={i} className="border border-gray-200 rounded p-1.5 flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input value={s.description} onChange={e => setStep(i, { description: e.target.value })}
                placeholder={`Step ${i + 1}`} className={`${inputCls} !py-1 flex-1`} />
              <button onClick={() => delStep(i)} title="Remove" className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
            </div>
            <div className="flex items-center gap-1">
              <select value={s.activity} onChange={e => setStep(i, { activity: e.target.value })} className={`${inputCls} !py-1 flex-1`}>
                {CREAM_ACTIVITIES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              <select value={s.failure_type} onChange={e => setStep(i, { failure_type: e.target.value })} className={`${inputCls} !py-1 flex-1`}>
                {typesFor(s.activity).map(t => <option key={t.id} value={t.id}>{t.id} — {t.label}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button onClick={addStep} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"><Plus size={11} /> Add step</button>
      </div>
      <InfoLabel tip="The same nine Common Performance Conditions as the basic method; here each level weights the nominal failure probabilities per cognitive function.">Common performance conditions</InfoLabel>
      <div className="flex flex-col gap-2">
        {CREAM_CPCS.map(cpc => (
          <div key={cpc.key}>
            <label className="block text-[10px] font-medium text-gray-500 mb-0.5">{cpc.label}</label>
            <select value={st.levels[cpc.key]} onChange={e => setLevel(cpc.key, e.target.value)} className={`${inputCls} !py-1`}>
              {cpc.levels.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Extended CREAM Result</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="cream_extended" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Card label="Task HEP (any step fails)" value={fmtHep(res.hep)} accent tip="1 − Π(1 − CFPᵢ) across all steps." />
        <Card label="Dominant step" value={res.dominant_step ? fmtHep(res.dominant_step.cfp) : '—'}
          tip={res.dominant_step ? `${res.dominant_step.description || res.dominant_step.failure_type}: ${res.dominant_step.failure_label}` : undefined} />
        <Card label="Steps analysed" value={String(res.steps.length)} />
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg mb-5">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Step</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Activity</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Failure type</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Nominal CFP</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Context ×</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Adjusted CFP</th>
            </tr>
          </thead>
          <tbody>
            {res.steps.map((s, i) => (
              <tr key={i} className={`border-t border-gray-100 ${s === res.dominant_step ? 'bg-amber-50' : ''}`}>
                <td className="px-3 py-2 text-gray-700">{s.description || `Step ${i + 1}`}</td>
                <td className="px-3 py-2 text-gray-500 capitalize">{s.activity}</td>
                <td className="px-3 py-2 text-gray-500">{s.failure_type} — {s.failure_label}</td>
                <td className="px-3 py-2 text-right">{fmtHep(s.nominal_cfp)}</td>
                <td className="px-3 py-2 text-right">{s.weight.toPrecision(3)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtHep(s.cfp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
        <Plot
          data={[
            { type: 'bar', x: res.steps.map((s, i) => s.description || `Step ${i + 1}`), y: res.steps.map(s => s.nominal_cfp), name: 'Nominal', marker: { color: '#9ca3af' } } as Plotly.Data,
            { type: 'bar', x: res.steps.map((s, i) => s.description || `Step ${i + 1}`), y: res.steps.map(s => s.cfp), name: 'Adjusted', marker: { color: '#e11d48' } } as Plotly.Data,
          ]}
          layout={{
            title: { text: 'Cognitive failure probability per step', font: { size: 13 } },
            yaxis: { title: { text: 'CFP' }, type: 'log' }, barmode: 'group',
            margin: { t: 40, r: 20, b: 70, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
            legend: { orientation: 'h', y: -0.35, font: { size: 10 } },
          } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
      </div>
      <p className="text-[11px] text-gray-500 mt-2 leading-snug">
        Context weights by cognitive function: {(['observation', 'interpretation', 'planning', 'execution'] as const)
          .map(fn => `${fn} ×${(res.context_weights[fn] ?? 1).toPrecision(3)}`).join(' · ')}.
      </p>
    </div>
  )

  return (
    <ToolLayout
      intro="Extended CREAM — break the task into steps, classify each step's cognitive activity and credible failure type, and rate the common performance conditions. Each step's nominal Cognitive Failure Probability is weighted by the CPC factors for its cognitive function; the task HEP combines the steps."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Quantify" results={results} />
  )
}
