import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeCream, CreamResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { CREAM_CPCS, fmtHep } from './tables'

interface State { levels: Record<string, string>; result: CreamResponse | null }
// Default each CPC to its middle 'not_significant' level.
const defaults = () => Object.fromEntries(CREAM_CPCS.map(c => {
  const mid = c.levels.find(l => l.effect === 'not_significant') ?? c.levels[0]
  return [c.key, mid.key]
}))
const INITIAL: State = { levels: defaults(), result: null }
const EXAMPLE: State = {
  levels: {
    ...defaults(),
    organisation: 'deficient', working_conditions: 'incompatible', mmi_support: 'inappropriate',
    available_time: 'continuously_inadequate', training_experience: 'inadequate',
  },
  result: null,
}

const MODE_COLOR: Record<string, string> = {
  strategic: '#10b981', tactical: '#3b82f6', opportunistic: '#f59e0b', scrambled: '#ef4444',
}

export default function Cream() {
  const [st, setSt] = useModuleState<State>('hraCream', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const setLevel = (k: string, v: string) => patch({ levels: { ...st.levels, [k]: v } })
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeCream({ cpc_levels: st.levels })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing CREAM control mode.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      {CREAM_CPCS.map(cpc => (
        <div key={cpc.key}>
          <label className="block text-xs font-medium text-gray-700 mb-1">{cpc.label}</label>
          <select value={st.levels[cpc.key]} onChange={e => setLevel(cpc.key, e.target.value)} className={inputCls}>
            {cpc.levels.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </div>
      ))}
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">CREAM Control Mode</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="cream" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card label="Control mode" value={res.control_mode.charAt(0).toUpperCase() + res.control_mode.slice(1)} accent />
        <Card label="Point HEP" value={fmtHep(res.hep)} tip="Geometric mean of the control-mode interval." />
        <Card label="CPCs reducing" value={String(res.sum_reduced)} />
        <Card label="CPCs improving" value={String(res.sum_improved)} />
      </div>
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 220 }}>
        <Plot
          data={[{ type: 'bar', orientation: 'h', x: [res.hep_upper - res.hep_lower], base: [res.hep_lower], y: [res.control_mode], marker: { color: MODE_COLOR[res.control_mode] ?? '#3b82f6' }, name: 'HEP interval' } as unknown as Plotly.Data,
                 { x: [res.hep], y: [res.control_mode], mode: 'markers', marker: { color: '#111827', size: 12, symbol: 'diamond' }, name: 'Point' } as Plotly.Data]}
          layout={{ title: { text: 'HEP interval for the control mode', font: { size: 13 } }, xaxis: { title: { text: 'HEP' }, type: 'log' }, yaxis: { automargin: true }, showlegend: false, margin: { t: 40, r: 20, b: 45, l: 90 }, paper_bgcolor: 'white', plot_bgcolor: 'white' } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
      </div>
      <p className="text-[11px] text-gray-500 mt-2 leading-snug">
        Interval {fmtHep(res.hep_lower)} – {fmtHep(res.hep_upper)}. Control mode follows a transparent
        discretization of Hollnagel's chart from the counts of CPCs reducing vs improving reliability.
      </p>
    </div>
  )

  return (
    <ToolLayout
      intro="CREAM (basic method) — rate the 9 Common Performance Conditions. The counts of conditions that reduce vs improve reliability determine the control mode (Strategic / Tactical / Opportunistic / Scrambled) and its HEP interval."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Evaluate" results={results} />
  )
}
