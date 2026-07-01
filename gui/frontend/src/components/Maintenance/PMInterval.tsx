import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { computePMInterval, PMIntervalResponse } from '../../api/client'
import { useUnits, useModuleState } from '../../store/project'
import { useReliabilitySources } from '../shared/ldaFolios'
import { ToolLayout, detail, Card } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtNum } from '../shared/format'

interface State {
  srcId: string; alpha: string; beta: string
  target: string; horizon: string
  result: PMIntervalResponse | null
}
const INITIAL: State = { srcId: '', alpha: '1000', beta: '2.5', target: '0.9', horizon: '5000', result: null }
const EXAMPLE: State = { srcId: '', alpha: '800', beta: '2', target: '0.95', horizon: '4000', result: null }

/** PM interval that sustains a reliability target (Maintenance-Free Operating Period). */
export default function PMInterval() {
  const [units] = useUnits()
  const [st, setSt] = useModuleState<State>('maintPMInterval', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const sources = useReliabilitySources()
  const activeSrc = sources.find(s => s.id === st.srcId)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const src = sources.find(s => s.id === st.srcId)
      const dist = src ? src.dist : 'weibull'
      const dist_params = src ? src.dist_params : { alpha: parseFloat(st.alpha), beta: parseFloat(st.beta) }
      const r = await computePMInterval({
        dist, dist_params,
        target_reliability: parseFloat(st.target), horizon: parseFloat(st.horizon),
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing PM interval.')) }
    finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="Use a fitted distribution from Life Data / Prediction, or enter a Weibull manually below.">Failure distribution</InfoLabel>
        <select value={st.srcId} onChange={e => patch({ srcId: e.target.value })} className={inputCls}>
          <option value="">Manual Weibull</option>
          {sources.map(s => <option key={s.id} value={s.id}>{s.name} — {s.sourceDist} ({s.moduleLabel})</option>)}
        </select>
        {activeSrc && <p className="text-[10px] text-blue-500 mt-0.5 truncate" title={activeSrc.label}>↳ {activeSrc.label}</p>}
      </div>
      {!activeSrc && (
        <>
          <div>
            <InfoLabel tip="Weibull scale parameter (characteristic life).">Weibull α (scale)</InfoLabel>
            <input type="number" step="any" value={st.alpha} onChange={e => patch({ alpha: e.target.value })} className={inputCls} />
          </div>
          <div>
            <InfoLabel tip="Weibull shape parameter.">Weibull β (shape)</InfoLabel>
            <input type="number" step="any" value={st.beta} onChange={e => patch({ beta: e.target.value })} className={inputCls} />
          </div>
        </>
      )}
      <div>
        <InfoLabel tip="The reliability level to maintain. PM is scheduled so reliability never drops below this between services.">Target reliability</InfoLabel>
        <input type="number" step="any" min="0" max="1" value={st.target} onChange={e => patch({ target: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Planning window over which to count the number of preventive-maintenance actions.">Horizon ({units})</InfoLabel>
        <input type="number" step="any" value={st.horizon} onChange={e => patch({ horizon: e.target.value })} className={inputCls} />
      </div>
    </>
  )

  const target = res?.target_reliability ?? 0
  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">PM Interval for {(target * 100).toFixed(0)}% Reliability</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="pm_interval" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Card label={`PM interval (${units})`} value={fmtNum(res.pm_interval)} accent tip="Service every this many time units to keep reliability at or above the target (the maintenance-free operating period)." />
        <Card label={`PM actions over horizon`} value={String(res.n_pm)} />
        <Card label={`MTTF (${units})`} value={fmtNum(res.mttf)} />
      </div>
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
        <Plot
          data={[
            { x: res.curve.time, y: res.curve.reliability_pm, mode: 'lines', name: 'With PM', line: { color: '#10b981', width: 2 } } as Plotly.Data,
            { x: res.curve.time, y: res.curve.reliability_none, mode: 'lines', name: 'No maintenance', line: { color: '#9ca3af', width: 1.5, dash: 'dot' } } as Plotly.Data,
            { x: [res.curve.time[0], res.curve.time[res.curve.time.length - 1]], y: [target, target], mode: 'lines', name: `Target ${(target * 100).toFixed(0)}%`, line: { color: '#ef4444', width: 1, dash: 'dash' } } as Plotly.Data,
          ]}
          layout={{
            title: { text: 'Reliability with Preventive Maintenance', font: { size: 13 } },
            xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
            yaxis: { title: { text: 'Reliability R(t)' }, gridcolor: '#e5e7eb', range: [0, 1.02] },
            margin: { t: 40, r: 20, b: 50, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
            legend: { x: 0.98, y: 0.98, xanchor: 'right', font: { size: 10 } },
          } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
        />
      </div>
    </div>
  )

  return (
    <ToolLayout
      intro="Finds the preventive-maintenance interval that keeps reliability at or above a target. With as-good-as-new PM, reliability sawtooths between 1 and the target — the interval is the Maintenance-Free Operating Period (MFOP)."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Compute interval" results={results}
    />
  )
}
