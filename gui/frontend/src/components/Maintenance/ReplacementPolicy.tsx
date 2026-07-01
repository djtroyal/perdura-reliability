import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeReplacementPolicy, ReplacementPolicyResponse } from '../../api/client'
import { useUnits, useModuleState } from '../../store/project'
import { useReliabilitySources } from '../shared/ldaFolios'
import { ToolLayout, detail, Card } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { fmtNum } from '../shared/format'

interface State {
  costPM: string; costCM: string; alpha: string; beta: string
  result: ReplacementPolicyResponse | null
}
const INITIAL: State = { costPM: '1', costCM: '5', alpha: '1000', beta: '2.5', result: null }
const EXAMPLE: State = { costPM: '1', costCM: '8', alpha: '1200', beta: '3', result: null }

/** Compare age vs block preventive-replacement policies for a Weibull item. */
export default function ReplacementPolicy() {
  const [units] = useUnits()
  const [st, setSt] = useModuleState<State>('maintReplacement', INITIAL)
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
      const r = await computeReplacementPolicy({
        cost_PM: parseFloat(st.costPM), cost_CM: parseFloat(st.costCM),
        weibull_alpha: parseFloat(st.alpha), weibull_beta: parseFloat(st.beta),
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error comparing replacement policies.')) }
    finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => { setSt(EXAMPLE); setSourceId(''); setSourceName(null) }} />
      </div>
      <div>
        <InfoLabel tip="Cost of a planned preventive replacement. Must be less than the corrective cost.">Cost of preventive maintenance (PM)</InfoLabel>
        <input type="number" step="any" value={st.costPM} onChange={e => patch({ costPM: e.target.value })} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Cost of an unplanned corrective replacement after a failure.">Cost of corrective maintenance (CM)</InfoLabel>
        <input type="number" step="any" value={st.costCM} onChange={e => patch({ costCM: e.target.value })} className={inputCls} />
      </div>
      {weibullSources.length > 0 && (
        <div>
          <InfoLabel tip="Optionally pull the Weibull α/β from a fitted Life-Data distribution instead of typing them.">Weibull source</InfoLabel>
          <select value={sourceId} onChange={e => pickSource(e.target.value)} className={inputCls}>
            <option value="">Manual entry</option>
            {weibullSources.map(s => <option key={s.id} value={s.id}>{s.name} — {s.label}</option>)}
          </select>
          {sourceName && <p className="text-[10px] text-blue-500 mt-0.5 truncate" title={sourceName}>↳ α/β linked to {sourceName}</p>}
        </div>
      )}
      <div>
        <InfoLabel tip="Weibull scale parameter (characteristic life) of the failure distribution.">Weibull α (scale)</InfoLabel>
        <input type="number" step="any" value={st.alpha} onChange={e => editAlpha(e.target.value)} className={inputCls} />
      </div>
      <div>
        <InfoLabel tip="Weibull shape parameter. Preventive replacement only pays off when β > 1 (wear-out).">Weibull β (shape)</InfoLabel>
        <input type="number" step="any" value={st.beta} onChange={e => editBeta(e.target.value)} className={inputCls} />
      </div>
    </>
  )

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Age vs Block Replacement</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="replacement_policy" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Card label="Cheaper policy" value={res.cheaper_policy === 'age' ? 'Age replacement' : 'Block replacement'} accent tip="The policy with the lower long-run cost per unit time." />
        <Card label={`MTTF (${units})`} value={fmtNum(res.mttf)} />
        <Card label="Corrective-only cost/time" value={res.corrective_only_cost.toExponential(3)} tip="Baseline: run to failure with no preventive maintenance." />
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg mb-5">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Policy</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Optimal interval ({units})</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Cost / unit time</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">PM / unit time</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">CM / unit time</th>
            </tr>
          </thead>
          <tbody>
            {([['Age replacement', res.age], ['Block replacement', res.block]] as const).map(([label, p]) => (
              <tr key={label} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-700 font-medium">{label}</td>
                <td className="px-3 py-2 text-right">{fmtNum(p.optimal_time)}</td>
                <td className="px-3 py-2 text-right">{p.min_cost.toExponential(3)}</td>
                <td className="px-3 py-2 text-right">{p.pm_per_time != null ? p.pm_per_time.toExponential(3) : '—'}</td>
                <td className="px-3 py-2 text-right">{p.cm_per_time != null ? p.cm_per_time.toExponential(3) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
        <Plot
          data={[
            { x: res.age.time, y: res.age.cost, mode: 'lines', name: 'Age', line: { color: '#3b82f6', width: 2 } } as Plotly.Data,
            { x: res.block.time, y: res.block.cost, mode: 'lines', name: 'Block', line: { color: '#f59e0b', width: 2 } } as Plotly.Data,
            { x: [res.age.optimal_time], y: [res.age.min_cost], mode: 'markers', name: 'Age optimum', marker: { color: '#3b82f6', size: 11, symbol: 'star' } } as Plotly.Data,
            { x: [res.block.optimal_time], y: [res.block.min_cost], mode: 'markers', name: 'Block optimum', marker: { color: '#f59e0b', size: 11, symbol: 'star' } } as Plotly.Data,
          ]}
          layout={{
            title: { text: 'Cost per Unit Time vs Replacement Interval', font: { size: 13 } },
            xaxis: { title: { text: `Replacement interval (${units})` }, gridcolor: '#e5e7eb' },
            yaxis: { title: { text: 'Cost per unit time' }, gridcolor: '#e5e7eb' },
            margin: { t: 40, r: 20, b: 50, l: 70 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
            legend: { x: 0.98, y: 0.98, xanchor: 'right', font: { size: 10 } },
          } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
        />
      </div>
    </div>
  )

  return (
    <ToolLayout
      intro="Balances scheduled preventive-maintenance (PM) cost against the higher cost of unplanned corrective maintenance (CM), comparing age-based replacement (replace on failure or at age T) with block/periodic replacement (replace every T, minimally repair failures between). Meaningful for wear-out (β > 1)."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Compare policies" results={results}
    />
  )
}
