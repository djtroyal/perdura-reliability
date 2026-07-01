import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeCostForecast, CostForecastResponse } from '../../api/client'
import { useUnits, useModuleState } from '../../store/project'
import { useReliabilitySources } from '../shared/ldaFolios'
import { ToolLayout, detail, Card, Select } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtNum } from '../shared/format'

interface State {
  policy: string; costPM: string; costCM: string; alpha: string; beta: string
  horizon: string; interval: string
  result: CostForecastResponse | null
}
const INITIAL: State = { policy: 'age', costPM: '1', costCM: '5', alpha: '1000', beta: '2.5', horizon: '10000', interval: '', result: null }
const EXAMPLE: State = { policy: 'block', costPM: '2', costCM: '12', alpha: '1500', beta: '2.8', horizon: '20000', interval: '', result: null }

/** Forecast expected maintenance events and cost over a planning horizon. */
export default function CostForecast() {
  const [units] = useUnits()
  const [st, setSt] = useModuleState<State>('maintCostForecast', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const weibullSources = useReliabilitySources().filter(s => s.dist === 'weibull')
  const [sourceId, setSourceId] = useState('')
  const [sourceName, setSourceName] = useState<string | null>(null)
  const pickSource = (id: string) => {
    const src = weibullSources.find(s => s.id === id)
    if (!src) { setSourceId(''); setSourceName(null); return }
    setSourceId(id); setSourceName(`${src.name} (${src.moduleLabel})`)
    if (src.dist_params.alpha != null) patch({ alpha: String(src.dist_params.alpha) })
    if (src.dist_params.beta != null) patch({ beta: String(src.dist_params.beta) })
  }
  const editAlpha = (v: string) => { patch({ alpha: v }); setSourceId(''); setSourceName(null) }
  const editBeta = (v: string) => { patch({ beta: v }); setSourceId(''); setSourceName(null) }

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeCostForecast({
        policy: st.policy, cost_PM: parseFloat(st.costPM), cost_CM: parseFloat(st.costCM),
        weibull_alpha: parseFloat(st.alpha), weibull_beta: parseFloat(st.beta),
        horizon: parseFloat(st.horizon),
        interval: st.interval.trim() ? parseFloat(st.interval) : null,
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error forecasting maintenance cost.')) }
    finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => { setSt(EXAMPLE); setSourceId(''); setSourceName(null) }} />
      </div>
      <Select label="Policy" tip="Corrective = run to failure. Age = replace on failure or at the interval. Block = replace every interval, minimally repair failures between."
        value={st.policy} onChange={v => patch({ policy: v })}
        options={[{ value: 'corrective', label: 'Corrective only (run to failure)' }, { value: 'age', label: 'Age replacement' }, { value: 'block', label: 'Block replacement' }]} />
      <div>
        <InfoLabel tip="Cost of a planned preventive replacement.">Cost of preventive maintenance (PM)</InfoLabel>
        <input type="number" step="any" value={st.costPM} onChange={e => patch({ costPM: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Cost of an unplanned corrective replacement after a failure.">Cost of corrective maintenance (CM)</InfoLabel>
        <input type="number" step="any" value={st.costCM} onChange={e => patch({ costCM: e.target.value })} className={inputCls} />
      </div>
      {weibullSources.length > 0 && (
        <div>
          <InfoLabel tip="Optionally pull the Weibull α/β from a fitted Life-Data distribution.">Weibull source</InfoLabel>
          <select value={sourceId} onChange={e => pickSource(e.target.value)} className={inputCls}>
            <option value="">Manual entry</option>
            {weibullSources.map(s => <option key={s.id} value={s.id}>{s.name} — {s.label}</option>)}
          </select>
          {sourceName && <p className="text-[10px] text-blue-500 mt-0.5 truncate" title={sourceName}>↳ α/β linked to {sourceName}</p>}
        </div>
      )}
      <div>
        <InfoLabel tip="Weibull scale parameter (characteristic life).">Weibull α (scale)</InfoLabel>
        <input type="number" step="any" value={st.alpha} onChange={e => editAlpha(e.target.value)} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Weibull shape parameter.">Weibull β (shape)</InfoLabel>
        <input type="number" step="any" value={st.beta} onChange={e => editBeta(e.target.value)} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Planning window over which to accumulate maintenance cost.">Horizon ({units})</InfoLabel>
        <input type="number" step="any" value={st.horizon} onChange={e => patch({ horizon: e.target.value })} className={inputCls} />
      </div>
      {st.policy !== 'corrective' && (
        <div>
          <InfoLabel tip="Replacement interval to assume. Leave blank to use this policy's cost-optimal interval.">Interval ({units}, optional)</InfoLabel>
          <input type="number" step="any" value={st.interval} onChange={e => patch({ interval: e.target.value })} placeholder="optimal" className={inputCls} />
        </div>
      )}
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Maintenance Cost Forecast</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="cost_forecast" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card label="Total cost" value={fmtNum(res.total_cost)} accent />
        <Card label="Expected PM events" value={fmtNum(res.expected_pm)} />
        <Card label="Expected CM events" value={fmtNum(res.expected_cm)} />
        <Card label={res.interval != null ? `Interval used (${units})` : 'Policy'} value={res.interval != null ? fmtNum(res.interval) : 'Run to failure'} />
      </div>
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
        <Plot
          data={[
            { x: res.time, y: res.cumulative_cost, mode: 'lines', name: 'Cumulative cost', line: { color: '#6366f1', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(99,102,241,0.08)' } as Plotly.Data,
          ]}
          layout={{
            title: { text: 'Cumulative Maintenance Cost over the Horizon', font: { size: 13 } },
            xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
            yaxis: { title: { text: 'Cumulative cost' }, gridcolor: '#e5e7eb' },
            margin: { t: 40, r: 20, b: 50, l: 70 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
            showlegend: false,
          } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
        />
      </div>
    </div>
  )

  return (
    <ToolLayout
      intro="Projects the expected number of preventive and corrective maintenance events, and the total cost, over a planning horizon under the chosen policy — with a cumulative-cost curve for budgeting."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Forecast cost" results={results}
    />
  )
}
