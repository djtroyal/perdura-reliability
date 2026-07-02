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

const MODES = ['strategic', 'tactical', 'opportunistic', 'scrambled'] as const
// Soft region fills (the assessment point is drawn solid on top).
const MODE_FILL: Record<string, string> = {
  strategic: 'rgba(16,185,129,0.45)', tactical: 'rgba(59,130,246,0.40)',
  opportunistic: 'rgba(245,158,11,0.45)', scrambled: 'rgba(239,68,68,0.45)',
}

/** Discrete 4-color scale for mode indices 0-3 (zmin −0.5, zmax 3.5). */
const MODE_COLORSCALE: [number, string][] = MODES.flatMap((m, i) => [
  [i / 4, MODE_FILL[m]], [(i + 1) / 4, MODE_FILL[m]],
] as [number, string][])

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
      {/* The control-mode diagram: the four regions on the Σreduced × Σimproved
          plane (built from the backend's grid, so chart and verdict cannot
          diverge), with the assessment point plotted in its region. */}
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
        <Plot
          data={[
            {
              type: 'heatmap',
              z: res.grid.map(row => row.map(m => m == null ? null : MODES.indexOf(m as typeof MODES[number]))),
              x: Array.from({ length: 10 }, (_, i) => i),
              y: Array.from({ length: 8 }, (_, i) => i),
              zmin: -0.5, zmax: 3.5,
              colorscale: MODE_COLORSCALE,
              showscale: false,
              hoverongaps: false,
              text: res.grid.map(row => row.map(m => m ?? '')) as unknown as string[],
              hovertemplate: 'reduced %{x}, improved %{y}: %{text}<extra></extra>',
              xgap: 1.5, ygap: 1.5,
            } as unknown as Plotly.Data,
            {
              x: [res.sum_reduced], y: [res.sum_improved], mode: 'markers',
              marker: { color: '#111827', size: 15, symbol: 'x', line: { width: 3, color: '#111827' } },
              name: 'This assessment',
              hovertemplate: `assessment: ${res.sum_reduced} reduced, ${res.sum_improved} improved → ${res.control_mode}<extra></extra>`,
            } as Plotly.Data,
          ]}
          layout={{
            title: { text: 'CREAM Control-Mode Diagram', font: { size: 13 } },
            xaxis: { title: { text: 'CPCs reducing reliability (Σreduced)' }, dtick: 1, range: [-0.5, 9.5], zeroline: false },
            yaxis: { title: { text: 'CPCs improving reliability (Σimproved)' }, dtick: 1, range: [-0.5, 7.5], zeroline: false },
            annotations: [
              { x: 0.7, y: 6.2, text: '<b>Strategic</b>', showarrow: false, font: { size: 11, color: '#065f46' } },
              { x: 2.3, y: 3.4, text: '<b>Tactical</b>', showarrow: false, font: { size: 11, color: '#1e3a8a' } },
              { x: 4.6, y: 1.0, text: '<b>Opportunistic</b>', showarrow: false, font: { size: 11, color: '#78350f' } },
              { x: 7.8, y: 0.6, text: '<b>Scrambled</b>', showarrow: false, font: { size: 11, color: '#7f1d1d' } },
            ],
            showlegend: false,
            margin: { t: 40, r: 20, b: 50, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
          } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
      </div>
      <p className="text-[11px] text-gray-500 mt-2 leading-snug">
        HEP interval for the {res.control_mode} mode: {fmtHep(res.hep_lower)} – {fmtHep(res.hep_upper)} (point
        estimate = geometric mean). Regions are a staircase digitization of Hollnagel's (1998) control-mode
        diagram; blank cells are infeasible (each CPC counts toward at most one axis, so Σreduced + Σimproved ≤ 9).
      </p>
    </div>
  )

  return (
    <ToolLayout
      intro="CREAM (basic method) — rate the 9 Common Performance Conditions. The counts of conditions that reduce vs improve reliability determine the control mode (Strategic / Tactical / Opportunistic / Scrambled) and its HEP interval."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Evaluate" results={results} />
  )
}
