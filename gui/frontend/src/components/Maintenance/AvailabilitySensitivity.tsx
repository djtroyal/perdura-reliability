import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeAvailabilitySensitivity, AvailabilitySensitivityResponse } from '../../api/client'
import { useUnits, useModuleState } from '../../store/project'
import { ToolLayout, detail, Card } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtNum } from '../shared/format'

interface State {
  mtbf: string; mttr: string; admin: string; logistics: string
  swing: string; target: string
  result: AvailabilitySensitivityResponse | null
}
const INITIAL: State = { mtbf: '500', mttr: '8', admin: '2', logistics: '12', swing: '20', target: '0.98', result: null }
const EXAMPLE: State = { mtbf: '1000', mttr: '6', admin: '3', logistics: '24', swing: '25', target: '0.99', result: null }

/** Sensitivity of operational availability to its drivers, plus solve-for-target. */
export default function AvailabilitySensitivity() {
  const [units] = useUnits()
  const [st, setSt] = useModuleState<State>('maintAvailability', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeAvailabilitySensitivity({
        mtbf: parseFloat(st.mtbf), mttr: parseFloat(st.mttr),
        admin_delay: parseFloat(st.admin), logistics_delay: parseFloat(st.logistics),
        swing_pct: parseFloat(st.swing),
        target_availability: st.target.trim() ? parseFloat(st.target) : null,
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing availability sensitivity.')) }
    finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="Mean time between failures (uptime between failures).">MTBF ({units})</InfoLabel>
        <input type="number" step="any" value={st.mtbf} onChange={e => patch({ mtbf: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Mean corrective repair time.">MTTR ({units})</InfoLabel>
        <input type="number" step="any" value={st.mttr} onChange={e => patch({ mttr: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Mean administrative delay before maintenance begins.">Admin delay ({units})</InfoLabel>
        <input type="number" step="any" value={st.admin} onChange={e => patch({ admin: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Mean logistics / supply delay (e.g. waiting for a spare).">Logistics delay ({units})</InfoLabel>
        <input type="number" step="any" value={st.logistics} onChange={e => patch({ logistics: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Percent each driver is swung up and down to gauge sensitivity.">Sensitivity swing (±%)</InfoLabel>
        <input type="number" step="any" value={st.swing} onChange={e => patch({ swing: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Optional: solve for the MTTR / max downtime needed to reach this operational availability.">Target availability (optional)</InfoLabel>
        <input type="number" step="any" min="0" max="1" value={st.target} onChange={e => patch({ target: e.target.value })} className={inputCls} />
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Availability Sensitivity</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="availability_sensitivity" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Card label="Operational availability" value={(res.baseline_availability * 100).toFixed(3) + '%'} accent />
        <Card label={`Mean down time (${units})`} value={fmtNum(res.mean_down_time)} />
        <Card label="Most sensitive driver" value={res.tornado[0]?.driver ?? '—'} tip="The input whose ±swing moves availability the most." />
      </div>
      {res.solve && (
        <div className={`mb-5 p-3 rounded-lg border text-xs ${res.solve.achievable ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {res.solve.achievable ? (
            <>To reach <b>{(res.solve.target_availability * 100).toFixed(2)}%</b> availability, MTTR must be ≤ <b>{fmtNum(res.solve.required_mttr)} {units}</b> (total down time ≤ {fmtNum(res.solve.max_down_time)} {units}, with the current delays).</>
          ) : (
            <>Reaching <b>{(res.solve.target_availability * 100).toFixed(2)}%</b> availability is <b>not achievable</b> by repair time alone — the admin + logistics delays already exceed the allowable down time of {fmtNum(res.solve.max_down_time)} {units}. Reduce the delays.</>
          )}
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
        <Plot
          data={[
            { type: 'bar', orientation: 'h', x: res.tornado.map(d => d.range), y: res.tornado.map(d => d.driver), marker: { color: '#0ea5e9' } } as Plotly.Data,
          ]}
          layout={{
            title: { text: `Availability Sensitivity (±${res.swing_pct}% swing)`, font: { size: 13 } },
            xaxis: { title: { text: 'Availability swing (range)' }, gridcolor: '#e5e7eb' },
            yaxis: { automargin: true },
            margin: { t: 40, r: 20, b: 45, l: 90 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
          } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
        />
      </div>
    </div>
  )

  return (
    <ToolLayout
      intro="Shows how sensitive operational availability is to MTBF, MTTR and the admin/logistics delays (a tornado of ±swing impacts), and optionally solves for the repair time or maximum downtime needed to hit a target availability."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Analyze" results={results}
    />
  )
}
