import { useRef, useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { simulateVirtualAgeMaintenance, VirtualAgeSimulationResponse } from '../../api/client'
import { useModuleState, useUnits } from '../../store/project'
import { ToolLayout, detail, Card } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import { inputCls } from '../shared/styles'
import { fmtNum } from '../shared/format'

interface State {
  alpha: string; beta: string; horizon: string; interval: string
  qCM: string; qPM: string; costCM: string; costPM: string
  downCM: string; downPM: string; simulations: string; seed: string
  result: VirtualAgeSimulationResponse | null
}

const INITIAL: State = {
  alpha: '1000', beta: '2.5', horizon: '5000', interval: '750',
  qCM: '0.6', qPM: '0.2', costCM: '10', costPM: '2',
  downCM: '8', downPM: '2', simulations: '2000', seed: '42', result: null,
}

export default function VirtualAge() {
  const [units] = useUnits()
  const [st, setSt] = useModuleState<State>('maintVirtualAge', INITIAL)
  const patch = (value: Partial<State>) => setSt(previous => ({ ...previous, ...value }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const result = st.result

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const response = await simulateVirtualAgeMaintenance({
        weibull_alpha: parseFloat(st.alpha), weibull_beta: parseFloat(st.beta),
        horizon: parseFloat(st.horizon),
        preventive_interval: st.interval.trim() ? parseFloat(st.interval) : null,
        repair_effectiveness: parseFloat(st.qCM),
        preventive_effectiveness: st.qPM.trim() ? parseFloat(st.qPM) : null,
        cost_CM: parseFloat(st.costCM) || 0, cost_PM: parseFloat(st.costPM) || 0,
        corrective_downtime: parseFloat(st.downCM) || 0,
        preventive_downtime: parseFloat(st.downPM) || 0,
        n_simulations: parseInt(st.simulations) || 2000,
        seed: st.seed.trim() ? parseInt(st.seed) : null,
      })
      patch({ result: response })
    } catch (e) { setError(detail(e, 'Virtual-age simulation failed.')) }
    finally { setLoading(false) }
  }

  const field = (label: string, key: keyof State, tip: string, props: Record<string, string> = {}) => (
    <div>
      <InfoLabel tip={tip}>{label}</InfoLabel>
      <input type="number" step="any" value={String(st[key] ?? '')}
        onChange={e => patch({ [key]: e.target.value })} className={inputCls} {...props} />
    </div>
  )

  const controls = <>
    {field(`Weibull α (${units})`, 'alpha', 'Baseline characteristic life.')}
    {field('Weibull β', 'beta', 'Baseline wear-out shape.')}
    {field(`Finite horizon (${units})`, 'horizon', 'Calendar horizon for every simulation replicate.')}
    {field(`Preventive interval (${units})`, 'interval', 'Fixed calendar PM interval. Blank disables scheduled PM.')}
    {field('Corrective q', 'qCM', 'Kijima-II repair effectiveness: 0 = perfect renewal; 1 = minimal repair.', { min: '0', max: '1' })}
    {field('Preventive q', 'qPM', 'Post-PM virtual age fraction. Blank uses corrective q.', { min: '0', max: '1' })}
    {field('Corrective cost', 'costCM', 'Cost per corrective action.', { min: '0' })}
    {field('Preventive cost', 'costPM', 'Cost per preventive action.', { min: '0' })}
    {field(`Corrective downtime (${units})`, 'downCM', 'Calendar downtime per corrective action.', { min: '0' })}
    {field(`Preventive downtime (${units})`, 'downPM', 'Calendar downtime per preventive action.', { min: '0' })}
    {field('Simulation replicates', 'simulations', 'Monte Carlo replicates (100–100,000).', { min: '100', max: '100000' })}
    {field('Random seed', 'seed', 'Blank for a non-deterministic run.')}
  </>

  const results = result && <div ref={resultsRef}>
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">Kijima-II finite-horizon simulation</h3>
        <p className="text-[10px] text-gray-500">q=0 perfect renewal · q=1 minimal repair · {result.n_simulations.toLocaleString()} replicates</p>
      </div>
      <ExportResultsButton getElement={() => resultsRef.current} baseName="virtual_age_maintenance" />
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <Card label={`Failures mean [${(result.CI * 100).toFixed(0)}% interval]`}
        value={`${fmtNum(result.failures.mean)} [${fmtNum(result.failures.lower)}, ${fmtNum(result.failures.upper)}]`} accent />
      <Card label="Preventive actions" value={fmtNum(result.preventive_actions.mean)} />
      <Card label="Total cost" value={`${fmtNum(result.total_cost.mean)} [${fmtNum(result.total_cost.lower)}, ${fmtNum(result.total_cost.upper)}]`} />
      <Card label="Finite-horizon availability" value={`${(100 * result.availability.mean).toFixed(3)}%`} />
    </div>
    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 410 }}>
      <Plot data={[
        { x: result.curve.time, y: result.curve.upper_cumulative_failures, mode: 'lines', line: { width: 0 }, showlegend: false } as Plotly.Data,
        { x: result.curve.time, y: result.curve.lower_cumulative_failures, mode: 'lines', name: `${(result.CI * 100).toFixed(0)}% simulation interval`, fill: 'tonexty', fillcolor: 'rgba(245,158,11,0.14)', line: { width: 0 } } as Plotly.Data,
        { x: result.curve.time, y: result.curve.mean_cumulative_failures, mode: 'lines', name: 'Mean cumulative failures', line: { color: '#d97706', width: 2 } } as Plotly.Data,
      ]} layout={{
        title: { text: 'Finite-Horizon Failure Burden', font: { size: 13 } },
        xaxis: { title: { text: `Calendar time (${units})` }, gridcolor: '#e5e7eb' },
        yaxis: { title: { text: 'Cumulative failures' }, gridcolor: '#e5e7eb' },
        margin: { t: 40, r: 20, b: 50, l: 65 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
      } as Partial<Plotly.Layout>} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </div>
    <p className="text-[10px] text-gray-500 mt-2">{result.assumptions.join(' ')}</p>
  </div>

  return <ToolLayout
    intro="Simulates imperfect corrective and preventive maintenance with Kijima Type-II virtual age. Unlike long-run cost-rate formulas, failures, cost, downtime, and availability are reported over the chosen finite calendar horizon with Monte Carlo uncertainty."
    controls={controls} err={error} loading={loading} onRun={run} runLabel="Run virtual-age simulation" results={results}
  />
}
