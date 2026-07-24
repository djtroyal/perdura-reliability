import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Play, Plus, Trash2 } from 'lucide-react'

import {
  fitSoftwareReliability,
  type SoftwareReliabilityModelKey,
  type SoftwareReliabilityModelResult,
  type SoftwareReliabilityResponse,
} from '../../api/client'
import { useFolioState, useUnits } from '../../store/project'
import ConfidenceInput from '../shared/ConfidenceInput'
import ExampleButton from '../shared/ExampleButton'
import ExportResultsButton from '../shared/ExportResultsButton'
import Plot from '../shared/ExportablePlot'
import FolioBar from '../shared/FolioBar'
import InfoLabel from '../shared/InfoLabel'
import { InfluenceScope, InfluenceSource, InfluenceTarget } from '../shared/InfluenceCues'
import { Card } from '../shared/ui'
import { inputCls, labelCls } from '../shared/styles'
import { useHelpTopic } from '../help/context'


type DataMode = 'event_times' | 'interval_counts'

interface IntervalRow { endpoint: string; count: string }
interface ProfileRow { name: string; observedExposure: string; failures: string; plannedShare: string }

interface SoftwareReliabilityState {
  dataMode: DataMode
  exposureLabel: string
  eventRows: string[]
  intervalRows: IntervalRow[]
  observationEnd: string
  selectedModels: SoftwareReliabilityModelKey[]
  ciText: string
  predictionHorizon: string
  missionDuration: string
  targetIntensity: string
  bootstrapSamples: string
  seed: string
  operationalProfileRows: ProfileRow[]
  result?: SoftwareReliabilityResponse | null
}

const MODEL_OPTIONS: { key: SoftwareReliabilityModelKey; label: string; detail: string }[] = [
  { key: 'hpp', label: 'Constant intensity (HPP)', detail: 'Required no-growth baseline' },
  { key: 'goel_okumoto', label: 'Goel–Okumoto', detail: 'Finite-fault exponential NHPP' },
  { key: 'musa_okumoto', label: 'Musa–Okumoto', detail: 'Logarithmic execution-time NHPP' },
  { key: 'power_law', label: 'Power-law NHPP', detail: 'Flexible monotone intensity trend' },
  { key: 'delayed_s', label: 'Delayed S-shaped', detail: 'Finite-fault learning/detection delay' },
]

const INITIAL_STATE: SoftwareReliabilityState = {
  dataMode: 'event_times',
  exposureLabel: 'test execution hours',
  eventRows: ['', '', '', '', '', ''],
  intervalRows: [
    { endpoint: '', count: '' }, { endpoint: '', count: '' },
    { endpoint: '', count: '' }, { endpoint: '', count: '' },
  ],
  observationEnd: '',
  selectedModels: MODEL_OPTIONS.map(model => model.key),
  ciText: '0.95',
  predictionHorizon: '',
  missionDuration: '',
  targetIntensity: '',
  bootstrapSamples: '0',
  seed: '1729',
  operationalProfileRows: [],
  result: null,
}

const EXAMPLE_STATE: Partial<SoftwareReliabilityState> = {
  dataMode: 'event_times',
  exposureLabel: 'test execution hours',
  eventRows: ['5', '12', '20', '31', '48', '70', '100', '140', '190', '250', '330', '430'],
  observationEnd: '500',
  predictionHorizon: '100',
  missionDuration: '50',
  targetIntensity: '0.01',
  bootstrapSamples: '0',
  result: null,
}

const fmt = (value: number | null | undefined, digits = 4) => {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4)) {
    return value.toExponential(3)
  }
  return value.toFixed(digits)
}

const pct = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : `${(100 * value).toFixed(2)}%`

export default function SoftwareReliability() {
  return (
    <InfluenceScope className="flex flex-col h-full">
      <SoftwareReliabilityContent />
    </InfluenceScope>
  )
}

function SoftwareReliabilityContent() {
  const [state, setState, folios] = useFolioState<SoftwareReliabilityState>(
    'softwareReliability', INITIAL_STATE,
  )
  const [units] = useUnits()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<SoftwareReliabilityModelKey | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  useHelpTopic('softwareReliability.overview')

  const patch = (change: Partial<SoftwareReliabilityState>) => {
    setState(previous => ({ ...previous, ...change, result: null }))
    setError(null)
  }
  const result = state.result ?? null
  useEffect(() => {
    if (result?.best_model) setSelectedModel(result.best_model)
  }, [result])
  const activeFit = result?.models.find(model => model.model === selectedModel)
    ?? result?.models[0]
    ?? null

  const eventTimes = state.eventRows.map(Number).filter(value => Number.isFinite(value) && value > 0)
  const completeIntervals = state.intervalRows.filter(row => row.endpoint.trim() || row.count.trim())
  const observedTrace = useMemo(() => {
    if (state.dataMode === 'event_times') {
      return { x: eventTimes, y: eventTimes.map((_, index) => index + 1) }
    }
    let cumulative = 0
    return {
      x: completeIntervals.map(row => Number(row.endpoint)),
      y: completeIntervals.map(row => (cumulative += Number(row.count) || 0)),
    }
  }, [completeIntervals, eventTimes, state.dataMode])

  const run = async () => {
    const T = Number(state.observationEnd)
    if (!Number.isFinite(T) || T <= 0) {
      setError('Enter the total observation exposure, including event-free exposure after the last failure.')
      return
    }
    if (!state.selectedModels.length) {
      setError('Select at least one candidate model.'); return
    }
    const CI = Number(state.ciText)
    if (!(CI > 0 && CI < 1)) {
      setError('Confidence must be strictly between 0 and 1.'); return
    }
    if (state.dataMode === 'event_times' && !eventTimes.length) {
      setError('Enter at least one cumulative failure-event exposure.'); return
    }
    const intervalEndpoints = completeIntervals.map(row => Number(row.endpoint))
    const intervalCounts = completeIntervals.map(row => Number(row.count))
    if (state.dataMode === 'interval_counts' && (!completeIntervals.length
        || intervalEndpoints.some(value => !Number.isFinite(value) || value <= 0)
        || intervalCounts.some(value => !Number.isInteger(value) || value < 0))) {
      setError('Each interval needs a positive endpoint and a non-negative integer failure count.')
      return
    }
    const profileRows = (state.operationalProfileRows ?? []).filter(row =>
      row.name.trim() || row.observedExposure.trim() || row.failures.trim() || row.plannedShare.trim())
    if (profileRows.some(row => !row.name.trim() || !(Number(row.observedExposure) > 0)
        || !Number.isInteger(Number(row.failures)) || Number(row.failures) < 0
        || !(Number(row.plannedShare) >= 0))) {
      setError('Each operational-profile row needs a name, positive observed exposure, non-negative integer failures, and a non-negative planned share.')
      return
    }
    setLoading(true); setError(null)
    try {
      const response = await fitSoftwareReliability({
        event_times: state.dataMode === 'event_times' ? eventTimes : undefined,
        observation_end: T,
        interval_endpoints: state.dataMode === 'interval_counts' ? intervalEndpoints : undefined,
        interval_counts: state.dataMode === 'interval_counts' ? intervalCounts : undefined,
        models: state.selectedModels,
        CI,
        prediction_horizon: Number(state.predictionHorizon) || undefined,
        mission_duration: Number(state.missionDuration) || undefined,
        target_failure_intensity: Number(state.targetIntensity) || undefined,
        bootstrap_samples: Number(state.bootstrapSamples) || 0,
        seed: Number(state.seed) || 1729,
        operational_profile: profileRows.map(row => ({
          name: row.name.trim(), observed_exposure: Number(row.observedExposure),
          failures: Number(row.failures), planned_share: Number(row.plannedShare),
        })),
      })
      setState(previous => ({ ...previous, result: response }))
    } catch (caught: unknown) {
      const message = (caught as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(message || (caught instanceof Error ? caught.message : 'Analysis failed.'))
    } finally {
      setLoading(false)
    }
  }

  const setEventRow = (index: number, value: string) => patch({
    eventRows: state.eventRows.map((row, rowIndex) => rowIndex === index ? value : row),
  })
  const setIntervalRow = (index: number, field: keyof IntervalRow, value: string) => patch({
    intervalRows: state.intervalRows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row),
  })
  const toggleModel = (key: SoftwareReliabilityModelKey) => patch({
    selectedModels: state.selectedModels.includes(key)
      ? state.selectedModels.filter(model => model !== key)
      : [...state.selectedModels, key],
  })
  const updateProfileRow = (index: number, field: keyof ProfileRow, value: string) => patch({
    operationalProfileRows: (state.operationalProfileRows ?? []).map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row),
  })

  return (
    <div className="flex flex-col h-full">
      <FolioBar api={folios} label="Analysis" />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <InfoLabel tip="Failure occurrence exposure may be execution hours, transactions, requests, cycles, or another consistently measured opportunity for failure. Do not silently mix it with calendar time.">Exposure basis</InfoLabel>
              <input value={state.exposureLabel} onChange={event => patch({ exposureLabel: event.target.value })}
                placeholder={`e.g., execution hours (project unit: ${units})`} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Observation format</label>
              <div className="grid grid-cols-2 gap-1">
                {([['event_times', 'Event times'], ['interval_counts', 'Interval counts']] as const).map(([mode, label]) => (
                  <button key={mode} onClick={() => patch({ dataMode: mode })}
                    className={`rounded border px-2 py-1.5 text-xs ${state.dataMode === mode
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 text-gray-600 hover:border-blue-300'}`}>{label}</button>
                ))}
              </div>
            </div>

            <InfluenceSource influence="failure-data">
              <div className="flex items-center justify-between px-1">
                <InfoLabel tip="Cumulative exposure at each observed software failure. Ties are permitted for rounded or batched observations.">
                  {state.dataMode === 'event_times' ? 'Cumulative failure-event exposure' : 'Failures by exposure interval'}
                </InfoLabel>
                <ExampleButton hasData={eventTimes.length > 0 || completeIntervals.length > 0}
                  onLoad={() => patch(EXAMPLE_STATE)} />
              </div>
              <div className="rounded border border-gray-200 overflow-hidden">
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-gray-500">
                      <tr><th className="px-2 py-1 text-left">#</th>
                        <th className="px-2 py-1 text-left">{state.dataMode === 'event_times' ? 'Exposure' : 'Interval end'}</th>
                        {state.dataMode === 'interval_counts' && <th className="px-2 py-1 text-left">Failures</th>}
                        <th className="w-7" /></tr>
                    </thead>
                    <tbody>
                      {state.dataMode === 'event_times' ? state.eventRows.map((row, index) => (
                        <tr key={index} className="border-t border-gray-100">
                          <td className="px-2 text-gray-400">{index + 1}</td>
                          <td><input type="number" min="0" value={row} onChange={event => setEventRow(index, event.target.value)}
                            className="w-full px-2 py-1.5 font-mono outline-none" /></td>
                          <td><button onClick={() => patch({ eventRows: state.eventRows.filter((_, i) => i !== index) })}
                            title="Remove row" className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button></td>
                        </tr>
                      )) : state.intervalRows.map((row, index) => (
                        <tr key={index} className="border-t border-gray-100">
                          <td className="px-2 text-gray-400">{index + 1}</td>
                          <td><input type="number" min="0" value={row.endpoint} onChange={event => setIntervalRow(index, 'endpoint', event.target.value)}
                            className="w-full px-2 py-1.5 font-mono outline-none" /></td>
                          <td><input type="number" min="0" step="1" value={row.count} onChange={event => setIntervalRow(index, 'count', event.target.value)}
                            className="w-16 px-2 py-1.5 font-mono outline-none" /></td>
                          <td><button onClick={() => patch({ intervalRows: state.intervalRows.filter((_, i) => i !== index) })}
                            title="Remove row" className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => state.dataMode === 'event_times'
                  ? patch({ eventRows: [...state.eventRows, ''] })
                  : patch({ intervalRows: [...state.intervalRows, { endpoint: '', count: '' }] })}
                  className="flex w-full items-center justify-center gap-1 border-t border-gray-200 py-1 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-blue-600">
                  <Plus size={11} /> Add row
                </button>
              </div>
            </InfluenceSource>

            <InfluenceSource influence="observation-end">
              <InfoLabel tip="Total exposure through test termination, including the event-free interval after the last failure. This is not inferred from the final event.">Total observation exposure</InfoLabel>
              <input type="number" min="0" value={state.observationEnd}
                onChange={event => patch({ observationEnd: event.target.value })} className={inputCls} />
            </InfluenceSource>

            <fieldset>
              <legend className={labelCls}>Candidate models</legend>
              <div className="space-y-1 rounded border border-gray-200 p-2">
                {MODEL_OPTIONS.map(model => (
                  <label key={model.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-gray-50">
                    <input type="checkbox" checked={state.selectedModels.includes(model.key)}
                      onChange={() => toggleModel(model.key)} className="mt-0.5" />
                    <span><span className="block text-xs text-gray-700">{model.label}</span>
                      <span className="block text-[10px] text-gray-400">{model.detail}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Confidence</label>
                <ConfidenceInput value={state.ciText} onChange={value => patch({ ciText: value })} className="w-full" /></div>
              <div><InfoLabel tip="Elapsed exposure beyond the observation end used for the future failure-count projection.">Projection horizon</InfoLabel>
                <input type="number" min="0" value={state.predictionHorizon} onChange={event => patch({ predictionHorizon: event.target.value })} className={inputCls} placeholder="25% of T" /></div>
              <div><InfoLabel tip="Exposure window over which no-failure probability is reported, conditional on the fitted NHPP.">Release mission</InfoLabel>
                <input type="number" min="0" value={state.missionDuration} onChange={event => patch({ missionDuration: event.target.value })} className={inputCls} placeholder="horizon" /></div>
              <div><InfoLabel tip="Optional maximum acceptable instantaneous failure intensity, in failures per selected exposure unit.">Target intensity</InfoLabel>
                <input type="number" min="0" value={state.targetIntensity} onChange={event => patch({ targetIntensity: event.target.value })} className={inputCls} /></div>
              <div><InfoLabel tip="Optional parametric NHPP simulations that refit each model. Zero uses asymptotic log-parameter uncertainty when available.">Bootstrap fits</InfoLabel>
                <input type="number" min="0" max="500" step="10" value={state.bootstrapSamples} onChange={event => patch({ bootstrapSamples: event.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Random seed</label>
                <input type="number" step="1" value={state.seed} onChange={event => patch({ seed: event.target.value })} className={inputCls} /></div>
            </div>
            <details className="rounded border border-gray-200 bg-gray-50/60">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-700">
                Operational profile context <span className="font-normal text-gray-400">(optional)</span>
              </summary>
              <div className="border-t border-gray-200 p-2">
                <p className="mb-2 text-[10px] leading-snug text-gray-500">Profile rows produce a separate stratified constant-rate baseline. Perdura does not multiply the NHPP result by usage percentages.</p>
                <div className="overflow-x-auto rounded border border-gray-200 bg-white"><table className="w-full text-[10px]">
                  <thead className="bg-gray-50 text-gray-500"><tr><th className="px-1 py-1 text-left">Operation</th><th className="px-1 py-1">Observed exposure</th><th className="px-1 py-1">Failures</th><th className="px-1 py-1">Planned share</th><th /></tr></thead>
                  <tbody>{(state.operationalProfileRows ?? []).map((row, index) => <tr key={index} className="border-t border-gray-100">
                    <td><input value={row.name} onChange={event => updateProfileRow(index, 'name', event.target.value)} className="w-28 px-1 py-1 outline-none" /></td>
                    <td><input type="number" min="0" value={row.observedExposure} onChange={event => updateProfileRow(index, 'observedExposure', event.target.value)} className="w-20 px-1 py-1 font-mono outline-none" /></td>
                    <td><input type="number" min="0" step="1" value={row.failures} onChange={event => updateProfileRow(index, 'failures', event.target.value)} className="w-14 px-1 py-1 font-mono outline-none" /></td>
                    <td><input type="number" min="0" step="0.01" value={row.plannedShare} onChange={event => updateProfileRow(index, 'plannedShare', event.target.value)} className="w-16 px-1 py-1 font-mono outline-none" /></td>
                    <td><button onClick={() => patch({ operationalProfileRows: state.operationalProfileRows.filter((_, rowIndex) => rowIndex !== index) })} className="px-1 text-gray-300 hover:text-red-500"><Trash2 size={11} /></button></td>
                  </tr>)}</tbody>
                </table></div>
                <button onClick={() => patch({ operationalProfileRows: [...(state.operationalProfileRows ?? []), { name: '', observedExposure: '', failures: '', plannedShare: '' }] })}
                  className="mt-2 flex items-center gap-1 text-[10px] text-gray-500 hover:text-blue-600"><Plus size={10} /> Add operation</button>
              </div>
            </details>
          </div>
          <div className="border-t border-gray-200 bg-white p-3">
            {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
            {loading && Number(state.bootstrapSamples) > 0 && (
              <div className="mb-2 h-1.5 overflow-hidden rounded bg-gray-100" aria-label="Bootstrap model fitting in progress">
                <div className="h-full w-1/2 animate-pulse rounded bg-blue-500" />
              </div>
            )}
            <button onClick={run} disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {loading ? 'Fitting models…' : 'Analyze'}
            </button>
          </div>
        </aside>

        <main ref={resultsRef} className="flex-1 overflow-y-auto bg-gray-50 p-5">
          {!result ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-gray-400">
              <div><p className="font-medium text-gray-500">No software reliability results yet</p>
                <p className="mt-1 max-w-lg">Enter exposure-indexed software failures, retain the constant-intensity baseline, and compare growth models before making a release decision.</p></div>
            </div>
          ) : (
            <SoftwareResults result={result} activeFit={activeFit} selectedModel={selectedModel}
              setSelectedModel={setSelectedModel} observedTrace={observedTrace}
              exposureLabel={state.exposureLabel || units} resultsRef={resultsRef} />
          )}
        </main>
      </div>
    </div>
  )
}

function SoftwareResults({ result, activeFit, selectedModel, setSelectedModel, observedTrace,
  exposureLabel, resultsRef }: {
  result: SoftwareReliabilityResponse
  activeFit: SoftwareReliabilityModelResult | null
  selectedModel: SoftwareReliabilityModelKey | null
  setSelectedModel: (model: SoftwareReliabilityModelKey) => void
  observedTrace: { x: number[]; y: number[] }
  exposureLabel: string
  resultsRef: React.RefObject<HTMLDivElement>
}) {
  const best = result.models.find(model => model.model === result.best_model) ?? result.models[0]
  if (!best) return null
  const fit = activeFit ?? best
  const interval = fit.projection.uncertainty.intervals.current_intensity
  const missionInterval = fit.projection.uncertainty.intervals.mission_reliability
  const intervalSuffix = interval ? ` [${fmt(interval.lower)}, ${fmt(interval.upper)}]` : ''

  const cumulativeTraces: Plotly.Data[] = [
    ...(fit.projection.curve.cumulative_lower && fit.projection.curve.cumulative_upper ? [
      { x: fit.projection.curve.time, y: fit.projection.curve.cumulative_upper, mode: 'lines', name: 'Upper uncertainty', line: { width: 0 }, showlegend: false } as Plotly.Data,
      { x: fit.projection.curve.time, y: fit.projection.curve.cumulative_lower, mode: 'lines', name: `${Math.round(result.confidence_level * 100)}% parameter uncertainty`, fill: 'tonexty', fillcolor: 'rgba(37,99,235,0.12)', line: { width: 0 } } as Plotly.Data,
    ] : []),
    { x: fit.projection.curve.time, y: fit.projection.curve.cumulative_failures, mode: 'lines', name: fit.label, line: { color: '#2563eb', width: 2.5 } } as Plotly.Data,
    { x: observedTrace.x, y: observedTrace.y, mode: 'markers', name: 'Observed cumulative failures', marker: { color: '#111827', size: 7 } } as Plotly.Data,
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold text-gray-900">Software Reliability Results</h2>
          <p className="text-xs text-gray-500">Exposure basis: {exposureLabel} · {result.data_mode === 'event_times' ? 'failure events' : 'interval counts'}</p></div>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="software_reliability" title="Software Reliability Engineering" />
      </div>
      {result.warnings.map((warning, index) => (
        <div key={index} className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /><span>{warning}</span>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Best supported model" value={best.label} accent />
        <Card label="Observed failures" value={String(result.n_failures)} />
        <Card label={`Current intensity${intervalSuffix}`} value={fmt(best.projection.current_intensity)} />
        <Card label={`Mission reliability${missionInterval ? ` [${pct(missionInterval.lower)}, ${pct(missionInterval.upper)}]` : ''}`}
          value={pct(best.projection.mission_reliability)} />
      </div>

      <InfluenceTarget influences={['failure-data', 'observation-end']}>
        <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 px-4 py-3"><h3 className="text-sm font-semibold text-gray-800">Candidate model comparison</h3>
            <p className="text-[11px] text-gray-500">Weights show relative support within these candidates under {result.comparison_criterion}.</p></div>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="px-3 py-2 text-left">Model</th><th className="px-3 py-2 text-right">Log likelihood</th>
              <th className="px-3 py-2 text-right">AICc</th><th className="px-3 py-2 text-right">BIC</th>
              <th className="px-3 py-2 text-right">Δ</th><th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2 text-left">Diagnostic</th><th className="px-3 py-2 text-left">Status</th>
            </tr></thead>
            <tbody>{result.models.map(model => (
              <tr key={model.model} onClick={() => setSelectedModel(model.model)}
                className={`cursor-pointer border-t border-gray-100 ${selectedModel === model.model ? 'bg-blue-50' : 'hover:bg-gray-50'} ${!model.eligible ? 'text-red-600' : ''}`}>
                <td className="px-3 py-2 font-medium">{model.label}</td><td className="px-3 py-2 text-right font-mono">{fmt(model.log_likelihood)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(model.AICc)}</td><td className="px-3 py-2 text-right font-mono">{fmt(model.BIC)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(model.delta)}</td><td className="px-3 py-2 text-right">{pct(model.weight)}</td>
                <td className="px-3 py-2">{model.goodness_of_fit.available ? `p = ${fmt(model.goodness_of_fit.p_value)}` : model.goodness_of_fit.reason ?? 'Unavailable'}</td>
                <td className="px-3 py-2">{model.eligible ? 'Eligible' : 'Ineligible'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      </InfluenceTarget>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <Plot plotId="software-cumulative-failures" reportLabel="Software cumulative failures"
            data={cumulativeTraces} layout={{ autosize: true, height: 390, margin: { l: 62, r: 24, t: 42, b: 55 },
              title: { text: 'Observed and fitted cumulative failures' },
              xaxis: { title: { text: exposureLabel }, gridcolor: '#e5e7eb' },
              yaxis: { title: { text: 'Cumulative failures' }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
              legend: { orientation: 'h', y: -0.2 } }} useResizeHandler style={{ width: '100%', height: 390 }} />
        </section>
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <Plot plotId="software-failure-intensity" reportLabel="Software failure intensity"
            data={[{ x: fit.projection.curve.time, y: fit.projection.curve.intensity, mode: 'lines', name: fit.label,
              line: { color: '#dc2626', width: 2.5 } } as Plotly.Data]}
            layout={{ autosize: true, height: 390, margin: { l: 72, r: 24, t: 42, b: 55 },
              title: { text: 'Fitted failure intensity' }, xaxis: { title: { text: exposureLabel }, gridcolor: '#e5e7eb' },
              yaxis: { title: { text: `Failures per ${exposureLabel}` }, gridcolor: '#e5e7eb', rangemode: 'tozero' } }}
            useResizeHandler style={{ width: '100%', height: 390 }} />
        </section>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-gray-800">Selected model details</h3>
          <p className="text-[11px] text-gray-500">{fit.source}</p></div>
          <select value={fit.model} onChange={event => setSelectedModel(event.target.value as SoftwareReliabilityModelKey)} className="rounded border border-gray-300 px-2 py-1 text-xs">
            {result.models.map(model => <option key={model.model} value={model.model}>{model.label}</option>)}
          </select></div>
        {fit.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-700">• {warning}</p>)}
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-500"><tr>
          <th className="px-3 py-2 text-left">Parameter</th><th className="px-3 py-2 text-right">Estimate</th>
          <th className="px-3 py-2 text-right">Lower</th><th className="px-3 py-2 text-right">Upper</th><th className="px-3 py-2 text-right">Relative SE</th>
        </tr></thead><tbody>{fit.parameters.map(parameter => <tr key={parameter.name} className="border-t border-gray-100">
          <td className="px-3 py-2">{parameter.name.replace(/_/g, ' ')}</td><td className="px-3 py-2 text-right font-mono">{fmt(parameter.estimate)}</td>
          <td className="px-3 py-2 text-right font-mono">{fmt(parameter.lower)}</td><td className="px-3 py-2 text-right font-mono">{fmt(parameter.upper)}</td>
          <td className="px-3 py-2 text-right">{pct(parameter.relative_standard_error)}</td>
        </tr>)}</tbody></table></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="Expected future failures" value={fmt(fit.projection.expected_future_failures)} />
          <Card label="Zero-failure probability" value={pct(fit.projection.probability_zero_failures_over_horizon)} />
          <Card label="Remaining faults" value={fit.projection.remaining_faults_available ? fmt(fit.projection.remaining_faults) : 'Not a model parameter'}
            tip="Only finite-fault models support a remaining-fault parameter." />
          <Card label="Additional exposure to target" value={fmt(fit.projection.additional_test_exposure_to_target)} tip={fit.projection.target_status ?? undefined} />
        </div>
        <div className="rounded border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
          <p><strong>Uncertainty:</strong> {fit.projection.uncertainty.method.replace(/_/g, ' ')} using {fit.projection.uncertainty.successful_draws} successful draws.</p>
          <p className="mt-1"><strong>Goodness of fit:</strong> {fit.goodness_of_fit.available
            ? `${fit.goodness_of_fit.method.replace(/_/g, ' ')}; p = ${fmt(fit.goodness_of_fit.p_value)} (${fit.goodness_of_fit.calibration?.replace(/_/g, ' ')})`
            : fit.goodness_of_fit.reason}</p>
          {fit.projection.probability_current_intensity_meets_target != null && <p className="mt-1"><strong>Probability current intensity meets target:</strong> {pct(fit.projection.probability_current_intensity_meets_target)}</p>}
        </div>
      </section>
      {result.operational_profile && <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
        <div><h3 className="text-sm font-semibold text-gray-800">Operational profile baseline</h3>
          <p className="text-[11px] text-amber-700">{result.operational_profile.warning}</p></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Card label="Profile mission exposure" value={fmt(result.operational_profile.mission_exposure)} />
          <Card label="Expected mission failures" value={fmt(result.operational_profile.expected_mission_failures)} />
          <Card label="Profile mission reliability" value={pct(result.operational_profile.mission_reliability)} />
        </div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-500"><tr>
          <th className="px-2 py-1.5 text-left">Operation</th><th className="px-2 py-1.5 text-right">Planned share</th><th className="px-2 py-1.5 text-right">Failures / exposure</th><th className="px-2 py-1.5 text-right">Rate interval</th><th className="px-2 py-1.5 text-right">Expected mission failures</th>
        </tr></thead><tbody>{result.operational_profile.rows.map(row => <tr key={row.name} className="border-t border-gray-100">
          <td className="px-2 py-1.5">{row.name}</td><td className="px-2 py-1.5 text-right">{pct(row.planned_share)}</td>
          <td className="px-2 py-1.5 text-right font-mono">{row.failures} / {fmt(row.observed_exposure)}</td>
          <td className="px-2 py-1.5 text-right font-mono">{fmt(row.failure_rate)} [{fmt(row.failure_rate_lower)}, {fmt(row.failure_rate_upper)}]</td>
          <td className="px-2 py-1.5 text-right font-mono">{fmt(row.expected_mission_failures)}</td>
        </tr>)}</tbody></table></div>
      </section>}
      <p className="text-[10px] text-gray-400">Method status: {result.standards_context.status.replace(/_/g, ' ')} · {result.standards_context.references.join(' · ')}</p>
    </div>
  )
}
