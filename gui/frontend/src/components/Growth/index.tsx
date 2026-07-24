import { useState, useRef, useMemo } from 'react'
import Plot from '../shared/ExportablePlot'
import { AlertTriangle, Play, Trash2 } from 'lucide-react'
import {
  fitGrowth, GrowthInterval, GrowthOneSidedBound, GrowthResponse,
} from '../../api/client'
import { useFolioState, useUnits } from '../../store/project'
import InfoLabel from '../shared/InfoLabel'
import FolioBar from '../shared/FolioBar'
import RepairableTools, {
  INITIAL_ROCOF_STATE,
  type RocofState,
} from './RepairableTools'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import ConfidenceInput from '../shared/ConfidenceInput'
import { Card } from '../shared/ui'
import { inputCls, labelCls } from '../shared/styles'
import { magnitudeStep } from '../shared/numericSteps'
import {
  createGrowthRequestToken,
  isGrowthRequestTokenCurrent,
} from './growthContracts'
import {
  INITIAL_MCF_STATE,
  type MCFState,
} from './mcfContracts'
import { useHelpTopic } from '../help/context'
import { useRememberedTab } from '../shared/useRememberedTab'
import { handleTabKey } from '../shared/tabKeyboard'
import { InfluenceScope, InfluenceSource, InfluenceTarget } from '../shared/InfluenceCues'
import GrowthPlanning, {
  INITIAL_GROWTH_PLANNING_STATE,
  type GrowthPlanningState,
} from './GrowthPlanning'

// Optimal Replacement has moved to the dedicated Maintenance module (expanded
// into an age-vs-block policy comparison). Growth keeps the trend tools.
type GrowthView = 'growth' | 'planning' | 'rocof' | 'mcf'

const GROWTH_VIEWS: { id: GrowthView; label: string }[] = [
  { id: 'growth', label: 'Growth Models' },
  { id: 'planning', label: 'Growth Planning' },
  { id: 'rocof', label: 'ROCOF' },
  { id: 'mcf', label: 'Mean Cumulative Function' },
]

type GrowthModel = 'crow-amsaa' | 'duane'
type GrowthDataMode = 'exact' | 'grouped'
type GrowthTermination = 'time' | 'failure'
type GrowthEstimator = 'mle' | 'modified_mle'

interface GroupedRow {
  endpoint: string
  count: string
}

interface GrowthState {
  model: GrowthModel
  dataMode: GrowthDataMode
  termination: GrowthTermination
  estimator: GrowthEstimator
  rows: string[]         // tabular cumulative failure-time entries
  groupedRows: GroupedRow[]
  T: string
  ciText: string
  gofText: string
  predictionHorizon: string
  predictionFailureCount: string
  predictionProbability: string
  rocof: RocofState
  mcf: MCFState
  planning: GrowthPlanningState
  result?: GrowthResponse | null
}

const INITIAL_STATE: GrowthState = {
  model: 'crow-amsaa',
  dataMode: 'exact',
  termination: 'time',
  estimator: 'mle',
  rows: ['', '', '', '', ''],
  groupedRows: [
    { endpoint: '', count: '' },
    { endpoint: '', count: '' },
    { endpoint: '', count: '' },
  ],
  T: '',
  ciText: '0.95',
  gofText: '0.10',
  predictionHorizon: '',
  predictionFailureCount: '1',
  predictionProbability: '0.50',
  rocof: INITIAL_ROCOF_STATE,
  mcf: INITIAL_MCF_STATE,
  planning: INITIAL_GROWTH_PLANNING_STATE,
}

// A classic reliability-growth dataset: cumulative failure times from a
// test-analyze-fix programme, total test time 1000. Fits a Crow-AMSAA power law
// with growth (beta < 1). Loaded by the "Load example" button.
const EXAMPLE_STATE: GrowthState = {
  model: 'crow-amsaa',
  dataMode: 'exact',
  termination: 'time',
  estimator: 'mle',
  rows: ['12', '45', '89', '132', '200', '290', '410', '570', '720', '900'],
  groupedRows: INITIAL_STATE.groupedRows,
  T: '1000',
  ciText: '0.95',
  gofText: '0.10',
  predictionHorizon: '',
  predictionFailureCount: '1',
  predictionProbability: '0.50',
  rocof: INITIAL_ROCOF_STATE,
  mcf: INITIAL_MCF_STATE,
  planning: INITIAL_GROWTH_PLANNING_STATE,
}

export default function Growth() {
  return <InfluenceScope className="flex flex-col h-full"><GrowthContent /></InfluenceScope>
}

function GrowthContent() {
  const [s, setS, folios] = useFolioState<GrowthState>('growth', INITIAL_STATE)
  const latestStateRef = useRef(s)
  const latestFolioRef = useRef(folios.activeId)
  const inputEpochRef = useRef(0)
  latestStateRef.current = s
  latestFolioRef.current = folios.activeId
  // Every input mutation invalidates the previous fit. This prevents stale
  // estimates from being presented under a changed sampling contract.
  const patch = (p: Partial<GrowthState>) => {
    inputEpochRef.current += 1
    setS(prev => ({ ...prev, ...p, result: null }))
  }
  const [units] = useUnits()
  const tableRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useRememberedTab(
    'growth', 'growth', GROWTH_VIEWS.map(item => item.id),
  )
  useHelpTopic(`growth.${view === 'growth' ? s.model : view}`)
  const setMcfState = (value: MCFState | ((previous: MCFState) => MCFState)) => {
    setS(previous => {
      const current = previous.mcf ?? INITIAL_MCF_STATE
      const next = typeof value === 'function' ? value(current) : value
      return { ...previous, mcf: next }
    })
  }
  const setRocofState = (value: RocofState | ((previous: RocofState) => RocofState)) => {
    setS(previous => {
      const current = previous.rocof ?? INITIAL_ROCOF_STATE
      const next = typeof value === 'function' ? value(current) : value
      return { ...previous, rocof: next }
    })
  }
  const setPlanningState = (value: GrowthPlanningState | ((previous: GrowthPlanningState) => GrowthPlanningState)) => {
    setS(previous => {
      const current = previous.planning ?? INITIAL_GROWTH_PLANNING_STATE
      const next = typeof value === 'function' ? value(current) : value
      return { ...previous, planning: next }
    })
  }

  // Sort state for the data table (display-only)
  const [grSortDir, setGrSortDir] = useState<'asc' | 'desc' | null>(null)
  const toggleGrSort = () => {
    if (grSortDir === null) setGrSortDir('asc')
    else if (grSortDir === 'asc') setGrSortDir('desc')
    else setGrSortDir(null)
  }

  const rows = s.rows

  const grSortedIndices = useMemo(() => {
    const indices = rows.map((_, i) => i)
    if (!grSortDir) return indices
    return indices.sort((a, b) => {
      const na = parseFloat(rows[a]), nb = parseFloat(rows[b])
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : rows[a].localeCompare(rows[b])
      return grSortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, grSortDir])

  const setRows = (next: string[]) => patch({ rows: next, result: null })
  const updateRow = (idx: number, val: string) =>
    setRows(rows.map((r, i) => i === idx ? val : r))
  const addRow = () => setRows([...rows, ''])
  const removeRow = (idx: number) =>
    setRows(rows.length <= 1 ? [''] : rows.filter((_, i) => i !== idx))
  const handleRowKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Tab' && !e.shiftKey && idx === rows.length - 1) {
      e.preventDefault()
      setRows([...rows, ''])
      setTimeout(() => {
        tableRef.current
          ?.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"]`)
          ?.focus()
      }, 0)
    }
  }
  const rowsToNumbers = () =>
    rows.map(r => parseFloat(r)).filter(n => !isNaN(n))

  const groupedRows = s.groupedRows ?? INITIAL_STATE.groupedRows
  const updateGroupedRow = (idx: number, field: keyof GroupedRow, value: string) =>
    patch({ groupedRows: groupedRows.map((row, i) => i === idx ? { ...row, [field]: value } : row) })
  const addGroupedRow = () => patch({ groupedRows: [...groupedRows, { endpoint: '', count: '' }] })
  const removeGroupedRow = (idx: number) => patch({
    groupedRows: groupedRows.length <= 3
      ? groupedRows
      : groupedRows.filter((_, i) => i !== idx),
  })

  const runAnalysis = async () => {
    const isCrow = s.model === 'crow-amsaa'
    const dataMode: GrowthDataMode = isCrow ? (s.dataMode ?? 'exact') : 'exact'
    const times = rowsToNumbers()
    const validGrouped = groupedRows.filter(row => row.endpoint.trim() !== '' || row.count.trim() !== '')
    const groupedEndpoints = validGrouped.map(row => Number(row.endpoint))
    const groupedCounts = validGrouped.map(row => Number(row.count))
    if (dataMode === 'exact' && times.length < 2) {
      setError('Enter at least 2 cumulative recurrence times.'); return
    }
    if (dataMode === 'exact' && times.some((time, i) => !Number.isFinite(time) || time <= 0
      || (i > 0 && time < times[i - 1]))) {
      setError('Recurrence times must be finite, positive, and entered in nondecreasing order.'); return
    }
    if (dataMode === 'grouped' && (validGrouped.length < 3
      || groupedEndpoints.some((end, i) => !Number.isFinite(end) || end <= 0
        || (i > 0 && end <= groupedEndpoints[i - 1]))
      || groupedCounts.some(count => !Number.isInteger(count) || count < 0)
      || groupedCounts.reduce((sum, count) => sum + count, 0) < 2
      || groupedCounts.filter(count => count > 0).length < 2)) {
      setError('Grouped data require at least 3 increasing positive endpoints, nonnegative integer counts, and failures in at least 2 intervals.'); return
    }
    const confidence = isCrow ? Number(s.ciText ?? '0.95') : 0.95
    if (isCrow && (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1)) {
      setError('Confidence level must be between 0 and 1.'); return
    }
    const gof = isCrow ? Number(s.gofText ?? '0.10') : 0.10
    if (isCrow && ![0.01, 0.05, 0.10, 0.15, 0.20].includes(gof)) {
      setError('GOF significance must be one of 0.01, 0.05, 0.10, 0.15, or 0.20.'); return
    }
    const T = (s.T ?? '').trim() ? Number(s.T) : null
    if (isCrow && dataMode === 'exact' && (s.termination ?? 'time') === 'time'
      && (!T || T < times[times.length - 1])) {
      setError('A time-terminated exact analysis requires T at or beyond the final recurrence.'); return
    }
    if (isCrow && dataMode === 'exact' && (s.termination ?? 'time') === 'failure'
      && T != null && Math.abs(T - times[times.length - 1]) > 1e-10 * Math.max(1, T)) {
      setError('For failure termination, leave T blank or set it equal to the final recurrence.'); return
    }
    if (!isCrow && T != null
      && (!Number.isFinite(T) || T < times[times.length - 1])) {
      setError('The optional Duane evaluation time must be at or beyond the final recurrence.'); return
    }
    if (isCrow && dataMode === 'exact' && (s.termination ?? 'time') === 'failure'
      && (s.estimator ?? 'mle') === 'modified_mle' && times.length < 3) {
      setError('Failure-terminated bias-corrected estimation requires at least 3 recurrences.'); return
    }
    const predictionHorizon = isCrow && (s.predictionHorizon ?? '').trim()
      ? Number(s.predictionHorizon) : null
    const predictionProbability = isCrow ? Number(s.predictionProbability ?? '0.50') : 0.50
    const predictionFailureCount = isCrow ? Number(s.predictionFailureCount ?? '1') : 1
    if (isCrow && ((predictionHorizon != null && (!Number.isFinite(predictionHorizon) || predictionHorizon <= 0))
      || !Number.isFinite(predictionProbability) || predictionProbability <= 0 || predictionProbability >= 1
      || !Number.isInteger(predictionFailureCount) || predictionFailureCount < 1
      || predictionFailureCount > 10_000)) {
      setError('Projection inputs require a positive horizon, event order from 1 to 10,000, and probability between 0 and 1.'); return
    }
    const requestToken = createGrowthRequestToken(folios.activeId, s)
    const requestEpoch = inputEpochRef.current
    const requestIsCurrent = () => inputEpochRef.current === requestEpoch
      && isGrowthRequestTokenCurrent(
        requestToken, latestFolioRef.current, latestStateRef.current)
    setError(null); setLoading(true)
    try {
      const res = await fitGrowth({
        times: dataMode === 'exact' ? times : [],
        T: dataMode === 'grouped' ? null : T,
        model: s.model,
        data_mode: dataMode,
        termination: dataMode === 'grouped' || !isCrow ? 'time' : (s.termination ?? 'time'),
        estimator: dataMode === 'grouped' || s.model === 'duane' ? 'mle' : (s.estimator ?? 'mle'),
        CI: confidence,
        gof_significance: gof,
        grouped_endpoints: dataMode === 'grouped' ? groupedEndpoints : [],
        grouped_counts: dataMode === 'grouped' ? groupedCounts : [],
        prediction_horizon: predictionHorizon,
        prediction_failure_count: predictionFailureCount,
        prediction_probability: predictionProbability,
      })
      if (requestIsCurrent()) setS(prev => ({ ...prev, result: res }))
    } catch (e: unknown) {
      if (requestIsCurrent()) setError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Error fitting growth model.',
      )
    } finally { setLoading(false) }
  }

  // --- Results ---
  const r = s.result
  const confidenceLevel = r?.confidence?.level ?? 0.95
  const confidencePct = `${(100 * confidenceLevel).toFixed(1).replace('.0', '')}%`
  const betaInterval = r?.confidence?.intervals.beta ?? {
    estimate: r?.beta, lower: null, upper: null, method: null, available: false,
  }
  const instantaneousInterval = r?.confidence?.intervals.instantaneous_mtbf_at_T ?? {
    estimate: r?.mtbf_instantaneous, lower: null, upper: null,
    method: null, available: false,
  }
  const cumulativeInterval = r?.confidence?.intervals.cumulative_mtbf_at_T ?? {
    estimate: r?.mtbf_cumulative, lower: null, upper: null,
    method: null, available: false,
  }
  const warnings = Array.from(new Set([
    ...(r?.diagnostics?.warnings ?? []),
    ...(r?.confidence?.warnings ?? []),
    ...(r?.regime_warning ? [r.regime_warning] : []),
  ]))
  const intervalIntensityValues = r?.interval_context?.fitted_average_intensity
  const finalIntervalIntensity = r?.grouped_final_interval?.average_failure_intensity
    ?? intervalIntensityValues?.[intervalIntensityValues.length - 1]
  const finalIntervalMtbf = r?.grouped_final_interval?.average_mtbf
    ?? (finalIntervalIntensity != null && finalIntervalIntensity > 0
      ? 1 / finalIntervalIntensity : null)
  const finalIntervalIntensityInterval = r?.grouped_final_interval
    ?.target_profile.average_failure_intensity_interval
  const finalIntervalMtbfInterval = r?.grouped_final_interval
    ?.target_profile.average_mtbf_interval
  const handbookFinalIntensityInterval = r?.grouped_final_interval
    ?.handbook_approximate.average_failure_intensity_interval
  const handbookFinalMtbfInterval = r?.grouped_final_interval
    ?.handbook_approximate.average_mtbf_interval
  const currentMtbfLowerBound = r?.confidence?.one_sided_bounds
    ?.instantaneous_mtbf_at_T_lower
  const handbookFinalMtbfLowerBound = r?.grouped_final_interval
    ?.handbook_approximate.average_mtbf_one_sided_lower_bound

  return (
    <>
      <FolioBar api={folios} />
      {/* Sub-tab navigation for the repairable-systems tools */}
      <div role="tablist" aria-label="Reliability Growth analyses" className="flex items-stretch gap-1 bg-white border-b border-gray-200 px-3">
        {GROWTH_VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            role="tab" aria-selected={view === v.id} tabIndex={view === v.id ? 0 : -1}
            data-tab-id={v.id}
            onKeyDown={event => handleTabKey(event, {
              ids: GROWTH_VIEWS.map(item => item.id), currentId: v.id,
              onSelect: id => setView(id as GrowthView),
            })}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              view === v.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >{v.label}</button>
        ))}
      </div>

      {view === 'planning' ? (
        <GrowthPlanning
          state={s.planning ?? INITIAL_GROWTH_PLANNING_STATE}
          setState={setPlanningState}
          units={units}
        />
      ) : view !== 'growth' ? (
        <RepairableTools
          tool={view}
          rocofState={s.rocof ?? INITIAL_ROCOF_STATE}
          setRocofState={setRocofState}
          mcfState={s.mcf ?? INITIAL_MCF_STATE}
          setMcfState={setMcfState}
          folioId={folios.activeId}
        />
      ) : (
      /* Body: left panel + main content */
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
          {/* Model selection */}
          <div>
            <InfoLabel tip="Crow-AMSAA fits a non-homogeneous Poisson process (power law) by maximum likelihood — the standard for tracking reliability growth during test-analyze-fix. Duane is the older graphical/regression method on log-log cumulative MTBF.">Model</InfoLabel>
            <select
              data-showcase-control="growth-model"
              value={s.model}
              onChange={e => {
                const model = e.target.value as GrowthModel
                patch({ model, dataMode: model === 'duane' ? 'exact' : (s.dataMode ?? 'exact') })
              }}
              className={inputCls}
            >
              <option value="crow-amsaa">Crow-AMSAA (NHPP)</option>
              <option value="duane">Duane</option>
            </select>
          </div>

          {s.model === 'crow-amsaa' && (
            <div>
              <InfoLabel tip="Exact events use cumulative recurrence times. Grouped data use the count observed in each interval ending at the stated endpoint. Independent component lifetimes from LDA are not recurrent-event data.">Data format</InfoLabel>
              <div className="flex gap-1">
                {([['exact', 'Exact event times'], ['grouped', 'Grouped counts']] as const).map(([mode, label]) => (
                  <button key={mode} onClick={() => patch({
                    dataMode: mode,
                    termination: mode === 'grouped' ? 'time' : (s.termination ?? 'time'),
                    estimator: mode === 'grouped' ? 'mle' : (s.estimator ?? 'mle'),
                  })}
                    className={`flex-1 py-1 text-xs rounded border transition-colors ${
                      (s.dataMode ?? 'exact') === mode
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600'
                    }`}>{label}</button>
                ))}
              </div>
            </div>
          )}

          {(s.dataMode ?? 'exact') === 'exact' || s.model === 'duane' ? (
            <div>
              <div className="flex items-center justify-between">
                <label className={labelCls}>
                  Cumulative recurrence times <span className="text-gray-400">({rowsToNumbers().length} events)</span>
                </label>
                <ExampleButton
                  hasData={(s.rows ?? []).some(r => r.trim() !== '') || s.T.trim() !== ''}
                  onLoad={() => patch(EXAMPLE_STATE)}
                />
              </div>
              <div ref={tableRef} className="border border-gray-200 rounded overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-gray-500 w-8">#</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-500 select-none cursor-pointer hover:text-blue-600"
                          onClick={toggleGrSort}>Time ({units}) {grSortDir ? <span className="text-[10px]">{grSortDir === 'asc' ? '▲' : '▼'}</span> : ''}</th>
                        <th className="w-7"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {grSortedIndices.map(i => {
                        const row = rows[i]
                        return (
                        <tr key={i} className="border-t border-gray-100 group">
                          <td className="px-2 py-0.5 text-gray-400 font-mono">{i + 1}</td>
                          <td className="px-1 py-0.5">
                            <input
                              type="number" step={magnitudeStep(Number(row))}
                              data-row={i}
                              value={row}
                              onChange={e => updateRow(i, e.target.value)}
                              onKeyDown={e => handleRowKeyDown(e, i)}
                              className="w-full text-xs border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 font-mono focus:outline-none"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            <button onClick={() => removeRow(i)}
                              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={addRow}
                  className="w-full text-[11px] text-blue-600 hover:bg-blue-50 py-1 border-t border-gray-100">
                  + Add row
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Enter one repairable-system event history in time order. Rounded ties are retained;
                these are not independent unit lifetimes.
              </p>
            </div>
          ) : (
            <div>
              <InfoLabel tip="Each row represents (previous endpoint, endpoint]. Count is the number of recurrent failures in that interval. The first interval starts at zero.">Grouped intervals</InfoLabel>
              <div className="border border-gray-200 rounded overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-gray-500">End ({units})</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-500">Failures</th>
                        <th className="w-7"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedRows.map((row, i) => (
                        <tr key={i} className="border-t border-gray-100 group">
                          <td className="px-1 py-0.5">
                            <input type="number" min="0" step={magnitudeStep(Number(row.endpoint))}
                              value={row.endpoint}
                              onChange={e => updateGroupedRow(i, 'endpoint', e.target.value)}
                              className="w-full text-xs border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 font-mono focus:outline-none"
                              placeholder={String((i + 1) * 100)} />
                          </td>
                          <td className="px-1 py-0.5">
                            <input type="number" min="0" step="1" value={row.count}
                              onChange={e => updateGroupedRow(i, 'count', e.target.value)}
                              className="w-full text-xs border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 font-mono focus:outline-none"
                              placeholder="0" />
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            <button onClick={() => removeGroupedRow(i)}
                              disabled={groupedRows.length <= 3}
                              className="text-gray-300 hover:text-red-500 disabled:opacity-20 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={addGroupedRow}
                  className="w-full text-[11px] text-blue-600 hover:bg-blue-50 py-1 border-t border-gray-100">
                  + Add interval
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Grouped fits are time-terminated at the final endpoint. Sparse adjacent intervals
                may be pooled for the Pearson goodness-of-fit test; failures must occur in at
                least two intervals to identify a trend.
              </p>
            </div>
          )}

          {s.model === 'crow-amsaa' && (s.dataMode ?? 'exact') === 'exact' && (
            <>
              <div>
                <InfoLabel tip="Termination is part of the test design. Time termination fixes T in advance. Failure termination stops on the final observed recurrence. It cannot be inferred safely from T equaling the last event.">Termination design</InfoLabel>
                <div className="flex gap-1">
                  {([['time', 'Time terminated'], ['failure', 'Failure terminated']] as const).map(([term, label]) => (
                    <button key={term} onClick={() => patch({ termination: term })}
                      className={`flex-1 py-1 text-xs rounded border transition-colors ${
                        (s.termination ?? 'time') === term
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-300 text-gray-600'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>
              <div>
                <InfoLabel tip={(s.termination ?? 'time') === 'time'
                  ? 'Required fixed observation end; it must be at or beyond the last recurrence.'
                  : 'The stopping time is the final recurrence. Leave T blank, or enter that same value explicitly.'}>
                  T (total accumulated test time)
                  {(s.termination ?? 'time') === 'failure' && <span className="text-gray-400"> (optional)</span>}
                </InfoLabel>
                <input type="number" min="0" step={magnitudeStep(Number(s.T))}
                  value={s.T}
                  onChange={e => patch({ T: e.target.value })}
                  className={inputCls}
                  placeholder={(s.termination ?? 'time') === 'time' ? 'Required' : 'Uses final event when blank'} />
              </div>
            </>
          )}

          {s.model === 'duane' && (
            <div>
              <InfoLabel tip="Optional time at which to evaluate the descriptive Duane curve; when blank, the final recurrence is used. This is not a Crow-AMSAA stopping-design selection.">
                Evaluation time ({units}) <span className="text-gray-400">(optional)</span>
              </InfoLabel>
              <input type="number" min="0" step={magnitudeStep(Number(s.T))}
                value={s.T}
                onChange={e => patch({ T: e.target.value })}
                className={inputCls}
                placeholder="Uses final recurrence when blank" />
            </div>
          )}

          {s.model === 'crow-amsaa' && (s.dataMode ?? 'exact') === 'exact' && (
            <div>
              <InfoLabel tip="Raw MLE drives the likelihood fit. The bias-corrected (modified) estimator reduces small-sample shape bias and may be selected for reported curves and metrics; both estimates remain visible. The GoF test always uses its prescribed bias correction.">Reported estimator</InfoLabel>
              <div className="flex gap-1">
                {([['mle', 'Raw MLE'], ['modified_mle', 'Bias-corrected']] as const).map(([estimator, label]) => (
                  <button key={estimator} onClick={() => patch({ estimator })}
                    className={`flex-1 py-1 text-xs rounded border transition-colors ${
                      (s.estimator ?? 'mle') === estimator
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600'
                    }`}>{label}</button>
                ))}
              </div>
            </div>
          )}

          {s.model === 'crow-amsaa' && (
            <div className="grid grid-cols-2 gap-2">
              <InfluenceSource influence="growth.confidence" className="-m-1 p-1">
                <InfoLabel tip="Confidence level for parameter and MTBF intervals; enter any number between 0 and 1.">Confidence</InfoLabel>
                <ConfidenceInput value={s.ciText ?? '0.95'}
                  onChange={value => patch({ ciText: value })}
                  onCommit={value => patch({ ciText: String(value) })}
                  className="w-full" />
              </InfluenceSource>
              <InfluenceSource influence="growth.gofAlpha" className="-m-1 p-1">
                <InfoLabel tip="Type-I significance for the exact-event CvM or grouped Pearson goodness-of-fit test. Published CvM table levels are 0.01, 0.05, 0.10, 0.15, and 0.20.">GOF α</InfoLabel>
                <input type="text" inputMode="decimal" value={s.gofText ?? '0.10'}
                  onChange={e => patch({ gofText: e.target.value })}
                  className={`${inputCls} font-mono`} />
              </InfluenceSource>
            </div>
          )}

          {s.model === 'crow-amsaa' && (
            <div className="border border-gray-200 rounded p-2">
              <p className="text-xs font-medium text-gray-700">Conditional process projection</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <InfluenceSource influence="growth.predictionHorizon"><label className="text-[10px] text-gray-500">Count horizon ({units})
                  <input type="number" min="0" value={s.predictionHorizon ?? ''}
                    onChange={e => patch({ predictionHorizon: e.target.value })}
                    className={`${inputCls} mt-0.5`} placeholder="Optional" />
                </label></InfluenceSource>
                <InfluenceSource influence="growth.predictionOrder"><label className="text-[10px] text-gray-500">Future event order
                  <input type="number" min="1" max="10000" step="1" value={s.predictionFailureCount ?? '1'}
                    onChange={e => patch({ predictionFailureCount: e.target.value })}
                    className={`${inputCls} mt-0.5`} />
                </label></InfluenceSource>
                <InfluenceSource influence="growth.predictionQuantile" className="col-span-2"><label className="text-[10px] text-gray-500">Event-time quantile probability
                  <input type="text" inputMode="decimal" value={s.predictionProbability ?? '0.50'}
                    onChange={e => patch({ predictionProbability: e.target.value })}
                    className={`${inputCls} mt-0.5 font-mono`} />
                </label></InfluenceSource>
                <p className="col-span-2 text-[10px] text-gray-400">
                  Future-event quantiles are always returned. A horizon also returns count
                  predictions. Both include process variation only, with fitted parameters fixed.
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

          <button
            onClick={runAnalysis}
            disabled={loading}
            data-shortcut-primary
            data-shortcut-label="Analyze reliability growth"
            title="Analyze reliability growth (Ctrl/⌘+Enter)"
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors"
          >
            <Play size={12} /> {loading ? 'Computing...' : 'Analyze'}
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!r ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-lg font-medium">No results yet</p>
                <p className="text-sm mt-1">
                  {(s.dataMode ?? 'exact') === 'grouped' && s.model === 'crow-amsaa'
                    ? 'Enter grouped interval counts and click Analyze'
                    : 'Enter cumulative recurrence times and click Analyze'}
                </p>
              </div>
            </div>
          ) : (
            <div ref={resultsRef} className="flex-1 overflow-y-auto p-6">
              <div className="flex justify-end">
                <ExportResultsButton getElement={() => resultsRef.current} baseName="growth" />
              </div>
              {/* Results summary. Note: the backend normalizes the model name
                  to underscores ('crow_amsaa'). */}
              <div className="mb-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">
                    {r.model === 'crow_amsaa' ? 'Crow-AMSAA' : 'Duane'} Model Results
                  </h3>
                  {r.model === 'crow_amsaa' && (
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">
                        {r.data_mode === 'grouped' ? 'Grouped interval counts' : 'Exact event times'}
                      </span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">
                        {r.termination === 'failure' ? 'Failure terminated' : 'Time terminated'}
                      </span>
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">
                        Curves use {r.parameter_sets?.curves_use === 'modified_mle' ? 'bias-corrected / modified MLE' : 'raw MLE'}
                      </span>
                    </div>
                  )}
                </div>
                {warnings.map((warning, i) => (
                  <div key={i} className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
                {r.interpretation && (
                  <div className={`p-3 rounded-lg border text-xs leading-snug ${
                    r.interpretation.trend === 'improving'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : r.interpretation.trend === 'worsening'
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-blue-50 border-blue-200 text-blue-800'
                  }`}>
                    {r.interpretation.detail}
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {r.model === 'crow_amsaa' ? (
                    <>
                      <Card label={betaInterval.available
                        ? `Beta (shape) [${fmt(betaInterval.lower)}, ${fmt(betaInterval.upper)}]`
                        : 'Beta (shape)'}
                        value={fmt(r.beta)}
                        tip={`Reported shape; β<1 is decreasing intensity. ${confidencePct} interval method: ${betaInterval.method ?? 'not reported'}.${growthIntervalReferenceTip(betaInterval)}`} />
                      <Card label="Lambda (scale)"
                        value={r.scale_representable === false ? 'Not representable' : fmtSci(r.Lambda)}
                        tip={`Scale in E[N(t)] = Λt^β; its units depend on β. log Λ = ${fmt(r.log_Lambda)}.`} />
                      <Card label={`Intensity at T (failures/${units})`}
                        value={fmtSci(r.instantaneous_failure_intensity)} />
                      <Card label={`MTBF (instantaneous, ${units})`} value={fmtNum(r.mtbf_instantaneous)} accent
                        tip={instantaneousInterval.available
                          ? `${confidencePct} two-sided interval [${fmtNum(instantaneousInterval.lower)}, ${fmtNum(instantaneousInterval.upper)}]. Method: ${instantaneousInterval.method ?? 'not reported'}.${growthIntervalReferenceTip(instantaneousInterval)}${growthOneSidedBoundTip(currentMtbfLowerBound)}`
                          : 'No supported interval is available for current MTBF.'} />
                    </>
                  ) : (
                    <>
                      <Card label="Alpha (growth rate)" value={fmt(r.alpha)} />
                      <Card label="A (intercept)" value={fmtSci(r.A)} />
                      <Card label="R-squared" value={fmtR2(r.r_squared)} />
                      <Card label={`MTBF (instantaneous, ${units})`} value={fmtNum(r.mtbf_instantaneous)} accent />
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <Card label={`MTBF (cumulative, ${units})`} value={fmtNum(r.mtbf_cumulative)}
                    tip={cumulativeInterval.available
                      ? `${confidencePct} interval [${fmtNum(cumulativeInterval.lower)}, ${fmtNum(cumulativeInterval.upper)}]. Method: ${cumulativeInterval.method ?? 'not reported'}.${growthIntervalReferenceTip(cumulativeInterval)}`
                      : undefined} />
                  <Card label="Growth rate (1 − β)" value={fmt(r.growth_rate)} />
                  <Card label="Total failures" value={String(r.n_failures)} />
                  <Card label={`Total test time (T, ${units})`} value={fmtNum(r.T)} />
                </div>

                {r.data_mode === 'grouped' && finalIntervalIntensity != null && (
                  <div className="rounded border border-cyan-200 bg-cyan-50 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Card label={finalIntervalIntensityInterval?.available
                        ? `Final-interval average intensity (failures/${units}) [${fmtFlexible(finalIntervalIntensityInterval.lower)}, ${fmtFlexible(finalIntervalIntensityInterval.upper)}]`
                        : `Final-interval average intensity (failures/${units})`}
                        value={fmtSci(finalIntervalIntensity)}
                        tip={`Expected failures divided by final-interval width. ${confidencePct} target-profile interval method: ${finalIntervalIntensityInterval?.method ?? 'unavailable'}.`} />
                      <Card label={finalIntervalMtbfInterval?.available
                        ? `Final-interval average MTBF (${units}) [${fmtFlexible(finalIntervalMtbfInterval.lower)}, ${fmtFlexible(finalIntervalMtbfInterval.upper)}]`
                        : `Final-interval average MTBF (${units})`}
                        value={fmtNum(finalIntervalMtbf)}
                        tip={`Reciprocal of fitted final-interval average intensity. ${confidencePct} target-profile interval method: ${finalIntervalMtbfInterval?.method ?? 'unavailable'}.`} />
                    </div>
                    <p className="mt-2 text-[10px] text-cyan-800">
                      Primary bounds profile the grouped Poisson likelihood for this final-bin
                      target. These averages are distinct from instantaneous endpoint intensity
                      ρ(T) and instantaneous MTBF 1/ρ(T), which are reported above.
                    </p>
                    {(handbookFinalIntensityInterval?.available
                      || handbookFinalMtbfInterval?.available) && (
                      <div className="mt-2 rounded border border-cyan-300 bg-white/60 p-2 text-[10px] text-cyan-900">
                        <p className="font-semibold">
                          MIL-HDBK-189C grouped Crow-coefficient approximation
                        </p>
                        <p className="mt-0.5">
                          Intensity [{fmtFlexible(handbookFinalIntensityInterval?.lower)},
                          {' '}{fmtFlexible(handbookFinalIntensityInterval?.upper)}]
                          {' · '}MTBF [{fmtFlexible(handbookFinalMtbfInterval?.lower)},
                          {' '}{fmtFlexible(handbookFinalMtbfInterval?.upper)}]. This is a
                          handbook approximation, shown separately from the target-profile interval.
                        </p>
                        {handbookFinalMtbfLowerBound?.available && (
                          <p className="mt-0.5 font-medium">
                            {fmtProbability(handbookFinalMtbfLowerBound.confidence_level)}
                            {' '}one-sided MTBF lower confidence bound =
                            {' '}{fmtFlexible(handbookFinalMtbfLowerBound.bound)} {units}.
                            This is a direct one-tail handbook coefficient, not the lower
                            endpoint of the {confidencePct} two-sided interval.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {r.parameter_sets && (
                  <div className="rounded border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                      Point-estimator comparison
                    </div>
                    <table className="w-full text-xs">
                      <thead className="border-t border-gray-200 bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Estimator</th>
                          <th className="px-3 py-1.5 text-right">β</th>
                          <th className="px-3 py-1.5 text-right">Λ</th>
                          <th className="px-3 py-1.5 text-right">log Λ</th>
                          <th className="px-3 py-1.5 text-right">Intensity at T</th>
                          <th className="px-3 py-1.5 text-right">Current MTBF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          ['mle', 'Raw maximum likelihood', r.parameter_sets.mle],
                          ['modified_mle', 'Bias-corrected / modified MLE', r.parameter_sets.modified_mle],
                        ] as const).filter(([, , values]) => values != null).map(([key, label, values]) => (
                          <tr key={key} className={`border-t border-gray-100 ${
                            r.parameter_sets?.selected === key ? 'bg-emerald-50 text-emerald-900' : ''
                          }`}>
                            <td className="px-3 py-1.5">
                              {label}{r.parameter_sets?.selected === key ? ' (reported)' : ''}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{fmt(values?.beta)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{fmtSci(values?.Lambda)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{fmt(values?.log_Lambda)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{fmtSci(values?.instantaneous_failure_intensity_at_T)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{fmtNum(values?.instantaneous_mtbf_at_T)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-500">
                      Raw MLE maximizes the likelihood. Modified MLE applies the
                      termination-specific small-sample shape correction. Goodness-of-fit uses
                      its prescribed bias-corrected shape independently of this display choice.
                    </p>
                  </div>
                )}

                {r.confidence && (
                  <InfluenceTarget influences="growth.confidence" className="rounded border border-gray-200 overflow-x-auto">
                    <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                      {confidencePct} uncertainty intervals
                    </div>
                    <table className="w-full min-w-[980px] text-xs">
                      <thead className="border-t border-gray-200 bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Quantity</th>
                          <th className="px-3 py-1.5 text-right">Reported estimate</th>
                          <th className="px-3 py-1.5 text-right">Interval reference</th>
                          <th className="px-3 py-1.5 text-right">Lower</th>
                          <th className="px-3 py-1.5 text-right">Upper</th>
                          <th className="px-3 py-1.5 text-left">Method</th>
                          <th className="px-3 py-1.5 text-left">Coverage status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(r.confidence.intervals).map(([key, interval]) => (
                          <tr key={key} className="border-t border-gray-100">
                            <td className="px-3 py-1.5">{growthMetricLabel(key)}</td>
                            <td className="px-3 py-1.5 text-right">
                              <span className="font-mono">{fmtFlexible(interval.estimate)}</span>
                              <span className="block text-[10px] text-gray-400">
                                {growthBasisLabel(interval.reported_estimate_basis)}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <span className="font-mono">
                                {fmtFlexible(interval.interval_reference_estimate)}
                              </span>
                              <span className="block text-[10px] text-gray-400">
                                {growthBasisLabel(interval.interval_reference_basis)}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{interval.available ? fmtFlexible(interval.lower) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{interval.available ? fmtFlexible(interval.upper) : '—'}</td>
                            <td className="px-3 py-1.5 text-gray-500">
                              <span>{interval.method ?? 'Unavailable'}</span>
                              {interval.warning && (
                                <span className="block mt-0.5 text-[10px] text-amber-700">{interval.warning}</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-gray-500">
                              {growthCoverageLabel(interval.coverage_status ?? interval.status)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </InfluenceTarget>
                )}

                {r.confidence?.one_sided_bounds
                  && Object.keys(r.confidence.one_sided_bounds).length > 0 && (
                  <InfluenceTarget influences="growth.confidence" className="rounded border border-indigo-200 overflow-x-auto">
                    <div className="bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
                      One-sided confidence bounds
                    </div>
                    <table className="w-full min-w-[900px] text-xs">
                      <thead className="border-t border-indigo-100 bg-indigo-50/60 text-indigo-700">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Quantity</th>
                          <th className="px-3 py-1.5 text-right">Lower bound</th>
                          <th className="px-3 py-1.5 text-right">Confidence</th>
                          <th className="px-3 py-1.5 text-right">Reported estimate</th>
                          <th className="px-3 py-1.5 text-right">Bound reference</th>
                          <th className="px-3 py-1.5 text-left">Method</th>
                          <th className="px-3 py-1.5 text-left">Coverage status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(r.confidence.one_sided_bounds).map(
                          ([key, bound]) => (
                            <tr key={key} className="border-t border-indigo-100">
                              <td className="px-3 py-1.5">
                                {growthMetricLabel(bound.quantity)}
                                <span className="block text-[10px] text-indigo-500">
                                  One-sided lower confidence bound
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {bound.available ? fmtFlexible(bound.bound) : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {fmtProbability(bound.confidence_level)}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <span className="font-mono">{fmtFlexible(bound.estimate)}</span>
                                <span className="block text-[10px] text-gray-400">
                                  {growthBasisLabel(bound.reported_estimate_basis)}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <span className="font-mono">
                                  {fmtFlexible(bound.interval_reference_estimate)}
                                </span>
                                <span className="block text-[10px] text-gray-400">
                                  {growthBasisLabel(bound.interval_reference_basis)}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-gray-500">
                                {bound.method ?? 'Unavailable'}
                              </td>
                              <td className="px-3 py-1.5 text-gray-500">
                                {growthCoverageLabel(
                                  bound.coverage_status ?? bound.status)}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                    <p className="border-t border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[10px] text-indigo-700">
                      These are direct one-tail bounds at the displayed confidence level;
                      they are not endpoints copied from the same-level two-sided intervals.
                    </p>
                  </InfluenceTarget>
                )}

                {r.goodness_of_fit && (
                  <InfluenceTarget influences="growth.gofAlpha" className={`rounded border p-3 text-xs ${
                    r.goodness_of_fit.decision === 'reject'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : r.goodness_of_fit.decision === 'fail_to_reject'
                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                  }`}>
                    <p className="font-semibold">{r.goodness_of_fit.method}</p>
                    <p className="mt-1">{r.goodness_of_fit.decision_text}</p>
                    <p className="mt-1 text-[10px] opacity-80">
                      Statistic {fmt(r.goodness_of_fit.statistic)}
                      {r.goodness_of_fit.critical_value != null && (
                        <span> · critical {fmt(r.goodness_of_fit.critical_value)}</span>
                      )}
                      {r.goodness_of_fit.p_value != null && (
                        <span> · p = {fmt(r.goodness_of_fit.p_value)}</span>
                      )}
                      {r.goodness_of_fit.degrees_of_freedom != null && (
                        <span> · df = {r.goodness_of_fit.degrees_of_freedom}</span>
                      )}
                      {r.goodness_of_fit.effective_event_count != null && (
                        <span> · effective events = {r.goodness_of_fit.effective_event_count}</span>
                      )}
                      {r.goodness_of_fit.shape_used != null && (
                        <span> · bias-corrected β used = {fmt(r.goodness_of_fit.shape_used)}</span>
                      )}
                      <span> · α = {r.goodness_of_fit.significance}</span>
                    </p>
                    {r.goodness_of_fit.expected_count_rule && (
                      <p className="mt-1 text-[10px] opacity-80">
                        Expected-count rule: {r.goodness_of_fit.expected_count_rule}
                      </p>
                    )}
                    {r.goodness_of_fit.pooled_intervals
                      && r.goodness_of_fit.pooled_intervals.length > 0 && (
                      <div className="mt-2 overflow-x-auto rounded border border-current/20 bg-white/50">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr>
                              <th className="px-2 py-1 text-left">Pooled interval</th>
                              <th className="px-2 py-1 text-right">Observed</th>
                              <th className="px-2 py-1 text-right">Expected</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.goodness_of_fit.pooled_intervals.map((interval, i) => (
                              <tr key={`${interval.start}-${interval.end}-${i}`} className="border-t border-current/10">
                                <td className="px-2 py-1">({fmt(interval.start)}, {fmt(interval.end)}]</td>
                                <td className="px-2 py-1 text-right font-mono">{interval.observed}</td>
                                <td className="px-2 py-1 text-right font-mono">{fmt(interval.expected)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {r.goodness_of_fit.decision === 'fail_to_reject' && (
                      <p className="mt-1 text-[10px]">
                        The test found no material departure from the power-law NHPP; use the
                        observed-versus-fitted plots and engineering change history to assess adequacy.
                      </p>
                    )}
                  </InfluenceTarget>
                )}

                {r.trend_test && (
                  <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                    <p className="font-semibold">{r.trend_test.method}</p>
                    <p className="mt-1">{r.trend_test.decision_text}</p>
                    {r.trend_test.p_value_two_sided != null && (
                      <p className="mt-1 text-[10px] text-gray-500">
                        Q = {fmt(r.trend_test.statistic)}
                        {r.trend_test.degrees_of_freedom != null && (
                          <span> · df = {r.trend_test.degrees_of_freedom}</span>
                        )}
                        <span> · two-sided p = {fmt(r.trend_test.p_value_two_sided)}</span>
                        {r.trend_test.p_value_improving != null && (
                          <span> · improving p = {fmt(r.trend_test.p_value_improving)}</span>
                        )}
                        {r.trend_test.p_value_worsening != null && (
                          <span> · worsening p = {fmt(r.trend_test.p_value_worsening)}</span>
                        )}
                        {r.trend_test.observed_direction && (
                          <span> · test-tail direction: {r.trend_test.observed_direction}</span>
                        )}
                        {r.trend_test.shape_for_direction != null && (
                          <span> · raw-MLE β context = {fmt(r.trend_test.shape_for_direction)}</span>
                        )}
                        {r.trend_test.direction_basis && (
                          <span> · basis: {r.trend_test.direction_basis}</span>
                        )}
                      </p>
                    )}
                  </div>
                )}

                {r.prediction && (
                  <InfluenceTarget influences={['growth.predictionHorizon', 'growth.predictionOrder', 'growth.predictionQuantile']} className="rounded border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
                    <p className="font-semibold">Conditional NHPP continuation projection</p>
                    {r.prediction.future_event && (
                      <p className="mt-1">
                        The {ordinal(r.prediction.future_event.order)} future event’s
                        {' '}{fmtProbability(r.prediction.future_event.quantile_probability)} quantile is
                        at t = {fmtNum(r.prediction.future_event.absolute_time)} {units}
                        {' '}({fmtNum(r.prediction.future_event.elapsed_time_after_T)} {units} after T).
                      </p>
                    )}
                    {r.prediction.horizon && (
                      <p className="mt-1">
                        Over the next {fmtNum(r.prediction.horizon.elapsed_time)} {units}:
                        {' '}expected failures = {fmt(r.prediction.horizon.expected_failures)};
                        {' '}P(no failures) = {fmtProbability(r.prediction.horizon.probability_no_failures)}
                        {r.prediction.horizon.failure_count_prediction_interval && (
                          <span>
                            ; {confidencePct} process-count interval = [
                            {r.prediction.horizon.failure_count_prediction_interval.lower},
                            {' '}{r.prediction.horizon.failure_count_prediction_interval.upper}]
                          </span>
                        )}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-violet-700">
                      {r.prediction.uncertainty_scope}. Parameter uncertainty is not included.
                    </p>
                  </InfluenceTarget>
                )}
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Cumulative failures plot */}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
                  <Plot
                    data={[
                      {
                        x: r.scatter.t,
                        y: r.scatter.n,
                        mode: 'markers',
                        name: 'Observed',
                        marker: { color: '#ef4444', size: 7 },
                      } as Plotly.Data,
                      {
                        x: r.model_curve.t,
                        y: r.model_curve.n,
                        mode: 'lines',
                        name: 'Fitted model',
                        line: { color: '#3b82f6', width: 2 },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      title: { text: 'Cumulative Failures', font: { size: 13 } },
                      xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Cumulative Failures' }, gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                      showlegend: true,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>

                {/* MTBF plot */}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
                  <Plot
                    data={[
                      {
                        x: r.mtbf_curve.t,
                        y: r.mtbf_curve.cumulative,
                        mode: 'lines',
                        name: 'Cumulative MTBF',
                        line: { color: '#3b82f6', width: 2 },
                      } as Plotly.Data,
                      {
                        x: r.mtbf_curve.t,
                        y: r.mtbf_curve.instantaneous,
                        mode: 'lines',
                        name: 'Instantaneous MTBF',
                        line: { color: '#10b981', width: 2, dash: 'dash' },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      title: { text: 'MTBF vs Time', font: { size: 13 } },
                      xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: `MTBF (${units})` }, gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                      showlegend: true,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>

                {r.intensity_curve && r.interval_context && (
                  <div className="bg-white border border-gray-200 rounded-lg lg:col-span-2" style={{ height: 420 }}>
                    <Plot
                      data={[
                        {
                          x: r.intensity_curve.t,
                          y: r.intensity_curve.instantaneous,
                          mode: 'lines',
                          name: 'Fitted instantaneous intensity',
                          line: { color: '#2563eb', width: 2 },
                        } as Plotly.Data,
                        {
                          x: r.interval_context.interval_start.map(
                            (start, i) => (start + r.interval_context!.interval_end[i]) / 2,
                          ),
                          y: r.interval_context.observed_average_intensity,
                          mode: 'markers',
                          name: 'Observed interval intensity',
                          marker: { color: '#ef4444', size: 8, symbol: 'circle' },
                          customdata: r.interval_context.observed_count.map(
                            (count, i) => [count, r.interval_context!.interval_start[i], r.interval_context!.interval_end[i]],
                          ),
                          hovertemplate: 'Observed: %{y:.5g}<br>Count: %{customdata[0]}<br>Interval: (%{customdata[1]}, %{customdata[2]}]<extra></extra>',
                        } as Plotly.Data,
                        {
                          x: r.interval_context.interval_start.map(
                            (start, i) => (start + r.interval_context!.interval_end[i]) / 2,
                          ),
                          y: r.interval_context.fitted_average_intensity,
                          mode: 'markers',
                          name: 'Fitted interval average',
                          marker: { color: '#10b981', size: 8, symbol: 'diamond-open' },
                        } as Plotly.Data,
                      ]}
                      layout={{
                        title: { text: 'Observed vs Fitted Failure Intensity', font: { size: 13 } },
                        xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                        yaxis: { title: { text: `Failures per ${units}` }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
                        margin: { t: 40, r: 20, b: 50, l: 70 },
                        paper_bgcolor: 'white', plot_bgcolor: 'white',
                        legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                        showlegend: true,
                      } as Partial<Plotly.Layout>}
                      config={{ responsive: true }}
                      style={{ width: '100%', height: '100%' }}
                      useResizeHandler
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </>
  )
}

// --- Formatting helpers ---

function fmt(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(4)
}

function fmtSci(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toExponential(4)
}

function fmtNum(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(2)
}

function fmtR2(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(4)
}

function fmtFlexible(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const magnitude = Math.abs(v)
  return magnitude !== 0 && (magnitude >= 1e4 || magnitude < 1e-3)
    ? v.toExponential(4)
    : v.toFixed(4)
}

function fmtProbability(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(100 * v).toFixed(1).replace('.0', '')}%`
}

function growthBasisLabel(basis: string | null | undefined): string {
  if (!basis) return 'Not reported'
  const labels: Record<string, string> = {
    selected_mle: 'Selected raw MLE',
    selected_modified_mle: 'Selected modified MLE',
    endpoint_count_identity: 'Endpoint count identity',
    raw_mle_interval_statistic: 'Raw-MLE interval statistic',
    grouped_mle: 'Grouped MLE',
    grouped_mle_interval_statistic: 'Grouped-MLE interval statistic',
    grouped_mle_target_profile_statistic: 'Grouped-MLE target profile',
    grouped_mle_handbook_crow_coefficient_reference: 'Handbook Crow coefficient',
  }
  return labels[basis] ?? basis.split('_').join(' ')
}

function growthIntervalReferenceTip(interval: GrowthInterval): string {
  if (interval.interval_reference_estimate == null) return ''
  return ` Reported point basis: ${growthBasisLabel(interval.reported_estimate_basis)}. Interval reference: ${fmtFlexible(interval.interval_reference_estimate)} (${growthBasisLabel(interval.interval_reference_basis)}).`
}

function growthOneSidedBoundTip(
  bound: GrowthOneSidedBound | null | undefined,
): string {
  if (!bound?.available || bound.bound == null) return ''
  return ` ${fmtProbability(bound.confidence_level)} one-sided lower confidence bound: ${fmtFlexible(bound.bound)}. This uses the direct one-tail construction (${bound.method ?? 'method not reported'}), not the lower endpoint of the same-level two-sided interval.`
}

function growthMetricLabel(key: string): string {
  const labels: Record<string, string> = {
    beta: 'β (shape)',
    Lambda: 'Λ (scale)',
    growth_rate: 'Growth rate (1 − β)',
    instantaneous_failure_intensity_at_T: 'Instantaneous intensity at T',
    cumulative_mtbf_at_T: 'Cumulative MTBF at T',
    instantaneous_mtbf_at_T: 'Instantaneous MTBF at T',
    final_interval_average_failure_intensity_target_profile: 'Final-interval average failure intensity — target profile',
    final_interval_average_mtbf_target_profile: 'Final-interval average MTBF — target profile',
    final_interval_average_failure_intensity_handbook_approximate: 'Final-interval average failure intensity — handbook approximation',
    final_interval_average_mtbf_handbook_approximate: 'Final-interval average MTBF — handbook approximation',
  }
  return labels[key] ?? key.split('_').join(' ')
}

function growthCoverageLabel(status: string | null | undefined): string {
  if (!status) return 'Not reported'
  const labels: Record<string, string> = {
    exact: 'Exact under model',
    exact_under_model: 'Exact under model',
    exact_under_model_conservative: 'Exact under model; discrete-count conservative',
    asymptotic_profile_likelihood: 'Asymptotic profile likelihood',
    asymptotic_target_profile_likelihood: 'Asymptotic target-profile likelihood',
    small_sample_asymptotic: 'Asymptotic; small-sample caution',
    approximate_grouped_handbook: 'Approximate grouped Handbook interval',
    diagnostic_not_target_calibrated: 'Diagnostic; not target-calibrated',
    unavailable: 'Unavailable',
    method_specific: 'Method-specific',
  }
  return labels[status] ?? status.split('_').join(' ')
}

function ordinal(n: number): string {
  const mod100 = n % 100
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}
