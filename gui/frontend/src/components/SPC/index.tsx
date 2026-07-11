import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, AlertTriangle, Wand2 } from 'lucide-react'
import SPCWizard from './Wizard'
import InfoLabel from '../shared/InfoLabel'
import DataTable, { DataColumn } from '../shared/DataTable'
import DataGenerator from '../shared/DataGenerator'
import { useModuleState } from '../../store/project'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { computeChart, ChartResponse, ChartType, SubChart } from '../../api/spc'

// Curated I-MR series: 24 in-control individuals around a mean of 50 (σ ≈ 2),
// with a final point that breaches the +3σ limit — a clear out-of-control signal.
const EXAMPLE_IMR = [
  50.07, 52.72, 52.45, 48.98, 49.40, 48.95, 51.14, 49.89, 51.49, 46.31,
  53.13, 49.81, 51.36, 49.73, 49.24, 50.93, 51.65, 49.59, 49.69, 51.37,
  48.26, 46.97, 50.79, 48.66, 57.00,
]

interface SPCState {
  chart: ChartType
  phase: 'phase_i' | 'phase_ii'
  rows: Record<string, string>[]
  baselineRows: Record<string, string>[]
  removeSignals: boolean
  result: ChartResponse | null
}

const INITIAL: SPCState = {
  chart: 'i_mr',
  phase: 'phase_i',
  rows: Array.from({ length: 10 }, () => ({ a: '', b: '', c: '', d: '', e: '', size: '' })),
  baselineRows: Array.from({ length: 10 }, () => ({ a: '', b: '', c: '', d: '', e: '', size: '' })),
  removeSignals: false,
  result: null,
}

const CHARTS: { id: ChartType; label: string; tip: string }[] = [
  { id: 'i_mr', label: 'I-MR', tip: 'Individuals and Moving Range — one value per row.' },
  { id: 'xbar_r', label: 'Xbar-R', tip: 'Subgroup mean and range — enter each subgroup across columns.' },
  { id: 'xbar_s', label: 'Xbar-S', tip: 'Subgroup mean and standard deviation.' },
  { id: 'p', label: 'p', tip: 'Fraction nonconforming — count + sample size per row (variable size OK).' },
  { id: 'np', label: 'np', tip: 'Number nonconforming — count + constant sample size.' },
  { id: 'c', label: 'c', tip: 'Defect count per unit — one count per row.' },
  { id: 'u', label: 'u', tip: 'Defects per unit — count + inspection size per row (variable size OK).' },
]

const VARIABLE_SUBGROUP = (c: ChartType) => c === 'xbar_r' || c === 'xbar_s'
const ATTR_WITH_SIZE = (c: ChartType) => c === 'p' || c === 'np' || c === 'u'

export default function SPC() {
  const [s, setS] = useModuleState<SPCState>('sixSigma.spc', INITIAL)
  const patch = (p: Partial<SPCState>) => setS(prev => ({ ...prev, ...p }))
  const [loading, setLoading] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const columns: DataColumn[] = VARIABLE_SUBGROUP(s.chart)
    ? ['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ key: k, label: `x${i + 1}`, type: 'number' as const }))
    : ATTR_WITH_SIZE(s.chart)
      ? [
          { key: 'a', label: 'Count', type: 'number' as const },
          { key: 'size', label: 'Size (n)', type: 'number' as const },
        ]
      : [{ key: 'a', label: s.chart === 'c' ? 'Defects' : 'Value', type: 'number' as const }]

  const fillGenerated = (vals: number[]) =>
    patch({
      rows: vals.map(v => ({ a: String(v), b: '', c: '', d: '', e: '', size: '' })),
      result: null,
    })

  const parseRows = (rows: Record<string, string>[]): { data: number[] | number[][]; sizes?: number[] } => {
    const num = (v: string) => parseFloat(v)
    if (VARIABLE_SUBGROUP(s.chart)) {
      const data = rows
        .map(r => ['a', 'b', 'c', 'd', 'e'].map(k => num(r[k])).filter(v => !isNaN(v)))
        .filter(g => g.length >= 2)
      return { data }
    }
    if (ATTR_WITH_SIZE(s.chart)) {
      const valid = rows.filter(r => !isNaN(num(r.a)) && !isNaN(num(r.size)))
      return {
        data: valid.map(r => num(r.a)),
        sizes: valid.map(r => num(r.size)),
      }
    }
    const data = rows.map(r => num(r.a)).filter(v => !isNaN(v))
    return { data }
  }

  const buildPayload = () => {
    const current = parseRows(s.rows)
    const baseline = parseRows(s.baselineRows ?? [])
    return {
      chart: s.chart,
      ...current,
      phase: s.phase ?? 'phase_i',
      phase_i_remove_signals: s.removeSignals ?? false,
      ...((s.phase ?? 'phase_i') === 'phase_ii' ? {
        baseline_data: baseline.data,
        baseline_sizes: baseline.sizes,
      } : {}),
    }
  }

  const run = async () => {
    const payload = buildPayload()
    const len = Array.isArray(payload.data) ? payload.data.length : 0
    if (len < 2) { setError('Enter at least 2 data points / subgroups.'); return }
    if (payload.phase === 'phase_ii' && (!payload.baseline_data || payload.baseline_data.length < 2)) {
      setError('Phase II requires at least 2 separate Phase-I baseline points / subgroups.'); return
    }
    setError(null); setLoading(true)
    try {
      patch({ result: await computeChart(payload) })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Error computing control chart.')
    } finally { setLoading(false) }
  }

  const r = s.result
  const allViolations = r ? r.subcharts.flatMap((sc, ci) =>
    sc.violations.map(v => ({ ...v, chart: sc.name, ci }))) : []

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <button
          onClick={() => setWizardOpen(true)}
          title="Answer a few questions and get the right control chart"
          className="flex items-center justify-center gap-2 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded py-2 transition-colors"
        >
          <Wand2 size={13} /> Chart wizard — help me choose
        </button>
        <SPCWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onApply={chart => { patch({ chart, result: null }); setWizardOpen(false) }}
        />
        <div>
          <InfoLabel tip="Control chart type. Variables charts use measured values; attribute charts use counts.">Chart type</InfoLabel>
          <select value={s.chart}
            onChange={e => patch({ chart: e.target.value as ChartType, result: null })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
            {CHARTS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">{CHARTS.find(c => c.id === s.chart)?.tip}</p>
        </div>

        <div>
          <InfoLabel tip="Phase I estimates a candidate baseline. Phase II monitors new observations against limits frozen from a separate Phase-I baseline.">Workflow phase</InfoLabel>
          <select value={s.phase ?? 'phase_i'}
            onChange={e => patch({ phase: e.target.value as SPCState['phase'], result: null })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5">
            <option value="phase_i">Phase I — establish baseline</option>
            <option value="phase_ii">Phase II — frozen-limit monitoring</option>
          </select>
          {(s.phase ?? 'phase_i') === 'phase_i' && (
            <label className="mt-2 flex items-start gap-2 text-[10px] text-gray-600">
              <input type="checkbox" checked={s.removeSignals ?? false}
                onChange={e => patch({ removeSignals: e.target.checked, result: null })} />
              Iteratively screen Rule-1 candidates (all exclusions remain visible and require an assignable cause)
            </label>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <InfoLabel tip="Spreadsheet entry — Tab on the last cell adds a row, paste accepts tab/comma data.">Data</InfoLabel>
            <ExampleButton hasData={s.rows.some(r => Object.values(r).some(v => v.trim()))}
              onLoad={() => patch({
                chart: 'i_mr',
                rows: EXAMPLE_IMR.map(v => ({ a: String(v), b: '', c: '', d: '', e: '', size: '' })),
                result: null,
              })} />
          </div>
          <DataTable columns={columns} rows={s.rows}
            onChange={rows => patch({ rows, result: null })} minRows={1} />
        </div>

        {(s.phase ?? 'phase_i') === 'phase_ii' && (
          <div className="rounded border border-violet-200 bg-violet-50 p-2">
            <InfoLabel tip="Historical stable observations used only to estimate center and limits. These limits remain frozen while current data are evaluated.">Separate Phase-I baseline</InfoLabel>
            <DataTable columns={columns} rows={s.baselineRows ?? []}
              onChange={baselineRows => patch({ baselineRows, result: null })} minRows={1} />
          </div>
        )}

        {!VARIABLE_SUBGROUP(s.chart) && !ATTR_WITH_SIZE(s.chart) && (
          <DataGenerator defaultDist={s.chart === 'c' ? 'poisson' : 'normal'}
            onGenerate={fillGenerated} label="Generate sample data" />
        )}

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <button onClick={run} disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
          <Play size={12} /> {loading ? 'Computing...' : 'Build Chart'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!r ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">No chart yet</p>
              <p className="text-sm mt-1">Pick a chart type, enter data, then Build Chart</p>
            </div>
          </div>
        ) : (
          <div ref={resultsRef} className="p-6 flex flex-col gap-4">
            <div className="flex justify-end">
              <ExportResultsButton getElement={() => resultsRef.current} baseName="spc" />
            </div>
            {r.workflow && (
              <div className={`rounded border p-3 text-xs ${r.workflow.limits_frozen
                ? 'bg-violet-50 border-violet-200 text-violet-800'
                : r.workflow.excluded_points?.length
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                <p className="font-semibold">
                  {r.workflow.phase === 'phase_ii' ? 'Phase II — limits frozen from the separate baseline' : 'Phase I — candidate baseline'}
                </p>
                <p className="mt-1">Status: {r.workflow.status.replace(/_/g, ' ')}</p>
                {!!r.workflow.excluded_points?.length && (
                  <p className="mt-1">Screened candidate points: {r.workflow.excluded_points.join(', ')}. {r.workflow.warning}</p>
                )}
                {r.workflow.warning && !r.workflow.excluded_points?.length && (
                  <p className="mt-1 font-medium">{r.workflow.warning}</p>
                )}
              </div>
            )}
            {r.subcharts.map((sc, i) => <ControlChart key={i} sc={sc} />)}

            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={14} className={allViolations.length ? 'text-red-500' : 'text-gray-300'} />
                Out-of-Control Signals ({allViolations.length})
              </h3>
              {allViolations.length === 0 ? (
                <p className="text-xs text-gray-500">No violations detected — process appears in control.</p>
              ) : (
                <div className="overflow-x-auto rounded border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                        <th className="px-3 py-2 text-left font-medium">Chart</th>
                        <th className="px-3 py-2 text-left font-medium">Point</th>
                        <th className="px-3 py-2 text-right font-medium">Value</th>
                        <th className="px-3 py-2 text-left font-medium">Rule</th>
                        <th className="px-3 py-2 text-left font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allViolations.map((v, i) => (
                        <tr key={i} className="border-b border-gray-100 last:border-0">
                          <td className="px-3 py-2">{v.chart}</td>
                          <td className="px-3 py-2 font-mono">{v.index + 1}</td>
                          <td className="px-3 py-2 text-right font-mono">{v.value.toFixed(3)}</td>
                          <td className="px-3 py-2 font-mono">WE {v.rule}</td>
                          <td className="px-3 py-2 text-gray-600">{v.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Interpretation panel */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
                <p className="text-xs font-medium text-blue-800 mb-1">Interpretation</p>
                <div className="text-xs text-blue-700">
                  {allViolations.length === 0 ? (
                    <p>The process is in statistical control. All points fall within the control limits and no non-random patterns were detected. The process is behaving predictably.</p>
                  ) : (
                    <>
                      <p className="mb-1">
                        The process is OUT of statistical control. {allViolations.length} signal{allViolations.length > 1 ? 's were' : ' was'} detected, indicating the process is not behaving predictably.
                      </p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {Array.from(new Set(allViolations.map(v => v.rule))).map(rule => {
                          const count = allViolations.filter(v => v.rule === rule).length
                          const desc = allViolations.find(v => v.rule === rule)?.description ?? ''
                          let meaning = ''
                          if (rule === 1) meaning = 'This typically indicates a sudden shift or special cause event.'
                          else if (rule === 2) meaning = 'This suggests a sustained shift in the process mean.'
                          else if (rule === 3) meaning = 'This indicates a trend — the process is drifting in one direction.'
                          else if (rule === 4) meaning = 'This suggests oscillation or over-adjustment.'
                          else if (rule === 5) meaning = 'This indicates the process variability has increased.'
                          else if (rule === 6) meaning = 'This suggests reduced variability or stratification.'
                          else if (rule === 7) meaning = 'This suggests a systematic pattern in the data.'
                          else if (rule === 8) meaning = 'This indicates extreme variability between consecutive points.'
                          return (
                            <li key={rule}>
                              Rule {rule} ({desc}): {count} occurrence{count > 1 ? 's' : ''}.{meaning ? ` ${meaning}` : ''}
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ControlChart({ sc }: { sc: SubChart }) {
  const x = sc.labels
  const ocIdx = new Set(sc.violations.map(v => v.index))
  const colors = sc.points.map((_, i) => ocIdx.has(i) ? '#ef4444' : '#3b82f6')
  const asArr = (v: number | number[]) => Array.isArray(v) ? v : sc.points.map(() => v)

  return (
    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 340 }}>
      <Plot
        data={[
          {
            x, y: sc.points, mode: 'lines+markers', name: sc.name,
            line: { color: '#3b82f6', width: 1.5 },
            marker: { color: colors, size: 7 },
          } as Plotly.Data,
          { x, y: asArr(sc.ucl), mode: 'lines', name: 'UCL', line: { color: '#dc2626', dash: 'dash', width: 1 } } as Plotly.Data,
          { x, y: asArr(sc.cl), mode: 'lines', name: 'CL', line: { color: '#16a34a', width: 1 } } as Plotly.Data,
          { x, y: asArr(sc.lcl), mode: 'lines', name: 'LCL', line: { color: '#dc2626', dash: 'dash', width: 1 } } as Plotly.Data,
        ]}
        layout={{
          title: { text: `${sc.name} Chart`, font: { size: 13 } },
          xaxis: { title: { text: 'Subgroup / Observation' }, gridcolor: '#e5e7eb' },
          yaxis: { gridcolor: '#e5e7eb' },
          margin: { t: 40, r: 20, b: 45, l: 60 },
          paper_bgcolor: 'white', plot_bgcolor: 'white',
          legend: { orientation: 'h', y: -0.2, font: { size: 10 } },
        } as PlotlyLayout}
        config={{ responsive: true }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  )
}
