import { useEffect, useRef, useState } from 'react'
import {
  calculateMTBFInterval, calculateBinomialInterval, calculateNormalInterval, calculateDiscreteProbability, calculateSequentialPlan,
  type MTBFResponse, type BinomialResponse, type NormalResponse, type DiscreteResponse, type SequentialResponse,
  type Sides, type TerminalRule,
} from '../../api/inferenceTools'
import { getProjectState, useUnits } from '../../store/project'
import { useTestingToolState, type ReliabilityTestingToolKey } from './reliabilityTestingState'
import { finiteInput, numericList, outcomeList, exposureRows, inferenceSignature, inferenceResultStatus } from './inferenceToolContracts'
import { Card, Field, Select, ToolLayout, inputCls, detail, plotBase } from './toolkit'
import Plot from '../shared/ExportablePlot'

const fmt = (value: number | null | undefined, infinite = '∞') => value == null ? infinite : Number(value.toPrecision(7)).toString()
const sidesOptions = [{ value: 'two-sided', label: 'Two-sided interval' }, { value: 'lower', label: 'One-sided lower bound' }, { value: 'upper', label: 'One-sided upper bound' }]

function useInferenceState<T extends { result: unknown }>(key: ReliabilityTestingToolKey, initial: T) {
  const [state, save] = useTestingToolState(key, initial)
  const [units] = useUnits()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const signature = inferenceSignature(state)
  const current = useRef('')
  current.current = JSON.stringify([signature, units, getProjectState().identity.projectId])
  const alive = useRef(true)
  const sequence = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current += 1 } }, [])
  const patch = (change: Partial<T>) => { sequence.current += 1; setLoading(false); save({ ...change, result: null } as Partial<T>); setError(null) }
  const run = async (compute: () => Promise<unknown>) => {
    const token = ++sequence.current
    const inputs = current.current
    setLoading(true); setError(null)
    try {
      const result = await compute()
      if (alive.current && token === sequence.current && inputs === current.current
        && inputs === JSON.stringify([signature, getProjectState().units, getProjectState().identity.projectId]))
        save({ result: { ...(result as object), _inputSignature: signature, _units: units } } as Partial<T>)
    } catch (caught) {
      if (alive.current && token === sequence.current && inputs === current.current) {
        const message = detail(caught, 'Calculation failed.')
        setError(typeof message === 'string' ? message : JSON.stringify(message))
      }
    } finally { if (alive.current && token === sequence.current) setLoading(false) }
  }
  const status = inferenceResultStatus(state, units)
  return { state: state.result && !status.current ? { ...state, result: null } as T : state, patch, run,
    error: error || (state.result && !status.current ? status.reason : null), loading }
}
function Assumptions({ rows }: { rows: string[] }) {
  return <details className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs"><summary className="cursor-pointer font-medium">Method and assumptions</summary><ul className="mt-2 list-disc space-y-1 pl-4">{rows.map(row => <li key={row}>{row}</li>)}</ul></details>
}
function TextInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <label className="block text-xs font-medium text-gray-600">{label}<textarea aria-label={label} value={value} onChange={e => onChange(e.target.value)} rows={4} className={`${inputCls} mt-1 font-mono`} />{hint && <span className="mt-1 block font-normal text-gray-500">{hint}</span>}</label>
}
function ConfidenceControls({ confidence, sides, patch }: { confidence: string; sides: Sides; patch: (value: { confidence?: string; sides?: Sides }) => void }) {
  return <><Field label="Confidence (0–1)" value={confidence} onChange={confidence => patch({ confidence })} /><Select label="Confidence statement" value={sides} onChange={sides => patch({ sides: sides as Sides })} options={sidesOptions} /></>
}
function Table({ headings, rows }: { headings: string[]; rows: (string | number)[][] }) {
  return <div className="mt-4 max-h-80 overflow-auto rounded border border-gray-200"><table className="w-full whitespace-nowrap text-right text-xs"><thead className="sticky top-0 bg-gray-100"><tr>{headings.map(h => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t border-gray-100">{row.map((cell, j) => <td key={j} className="px-3 py-2">{cell}</td>)}</tr>)}</tbody></table></div>
}

const initialMTBF = { exposureMode: 'total', totalExposure: '800', exposureText: '10, 100, 0.8', failures: '2', confidence: '.9', sides: 'two-sided' as Sides, termination: 'time' as 'time' | 'failure', result: null as MTBFResponse | null }
export function AggregateMTBF() {
  const { state: s, patch, run, error, loading } = useInferenceState('aggregateMTBF', initialMTBF)
  const [units] = useUnits()
  const r = s.result
  return <ToolLayout intro="Estimate field MTBF and rate with confidence bounds matched to the declared stopping rule. Enter actual operating exposure across all units." err={error} loading={loading} runLabel="Calculate MTBF interval"
    onRun={() => run(() => calculateMTBFInterval({ failures: finiteInput(s.failures, 'Failures'), confidence: finiteInput(s.confidence, 'Confidence'), sides: s.sides, termination: s.termination,
      ...(s.exposureMode === 'total' ? { total_exposure: finiteInput(s.totalExposure, 'Exposure') } : { exposure_rows: exposureRows(s.exposureText) }) }))}
    controls={<><Select label="Exposure entry" value={s.exposureMode} onChange={exposureMode => patch({ exposureMode })} options={[{ value: 'total', label: 'Total accumulated exposure' }, { value: 'rows', label: 'Unit groups and operating duty' }]} />
      {s.exposureMode === 'total' ? <Field label={`Operating exposure (${units})`} value={s.totalExposure} onChange={totalExposure => patch({ totalExposure })} /> : <TextInput label="Exposure groups" value={s.exposureText} onChange={exposureText => patch({ exposureText })} hint={`One row per group: units, duration (${units}), duty (0–1).`} />}
      <Field label="Observed failures" value={s.failures} onChange={failures => patch({ failures })} />
      <Select label="Stopping design" value={s.termination} onChange={termination => patch({ termination: termination as 'time' | 'failure' })} options={[{ value: 'time', label: 'Fixed exposure: repairable / replacement' }, { value: 'failure', label: 'Predeclared failure count' }]} />
      <ConfidenceControls confidence={s.confidence} sides={s.sides} patch={patch} /></>}
    results={r && <><div className="grid grid-cols-2 gap-3"><Card label={`MTBF point estimate (${units})`} value={fmt(r.mtbf_estimate)} /><Card label={`Total operating exposure (${units})`} value={fmt(r.total_exposure)} /><Card label={`MTBF lower endpoint (${units})`} value={fmt(r.mtbf_lower)} /><Card label={`MTBF upper endpoint (${units})`} value={fmt(r.mtbf_upper)} /><Card label={`Failure rate (per ${units})`} value={fmt(r.rate_estimate)} /><Card label="Rate interval" value={`${fmt(r.rate_lower)} to ${fmt(r.rate_upper)}`} /></div>
      <p className="mt-3 text-xs text-gray-600">{100 * r.confidence}% {r.sides} confidence · {r.method.replace(/_/g, ' ')}{r.unbounded_point_estimate && ' · Zero failures: no finite MTBF point estimate.'}</p>
      {r.exposure_rows.length > 0 && <Table headings={['Group', 'Units', `Duration (${units})`, 'Duty', `Exposure (${units})`]} rows={r.exposure_rows.map(row => [row.label, row.units, fmt(row.duration), row.duty, fmt(row.exposure)])} />}
      <Assumptions rows={r.assumptions} /></>} />
}

const initialBinomial = { trials: '20', successes: '20', confidence: '.95', sides: 'two-sided' as Sides, orientation: 'success' as 'success' | 'defect', method: 'exact' as 'exact' | 'wilson', result: null as BinomialResponse | null }
export function ProportionInterval() {
  const { state: s, patch, run, error, loading } = useInferenceState('oneProportion', initialBinomial)
  const r = s.result && 'estimate' in s.result ? s.result : null
  return <ToolLayout intro="Estimate a success or defect probability with an explicit one-sided or two-sided confidence statement." err={error} loading={loading} runLabel="Calculate proportion interval"
    onRun={() => run(() => calculateBinomialInterval({ trials: finiteInput(s.trials, 'Trials'), count: finiteInput(s.successes, 'Count'), confidence: finiteInput(s.confidence, 'Confidence'), sides: s.sides, orientation: s.orientation, method: s.method }))}
    controls={<><Field label="Trials" value={s.trials} onChange={trials => patch({ trials })} /><Select label="Count represents" value={s.orientation} onChange={orientation => patch({ orientation: orientation as 'success' | 'defect' })} options={[{ value: 'success', label: 'Successful units' }, { value: 'defect', label: 'Defective units' }]} /><Field label={s.orientation === 'success' ? 'Successes' : 'Defects'} value={s.successes} onChange={successes => patch({ successes })} /><ConfidenceControls confidence={s.confidence} sides={s.sides} patch={patch} /><Select label="Interval method" value={s.method} onChange={method => patch({ method: method as 'exact' | 'wilson' })} options={[{ value: 'exact', label: 'Exact Clopper–Pearson' }, { value: 'wilson', label: 'Wilson score (approximate coverage)' }]} /></>}
    results={r && <><div className="grid grid-cols-3 gap-3"><Card label={`${r.orientation} probability`} value={fmt(r.estimate)} /><Card label="Lower endpoint" value={fmt(r.lower)} /><Card label="Upper endpoint" value={fmt(r.upper)} /></div><p className="mt-3 text-xs">{100 * r.confidence}% {r.sides} · {r.method.replace(/_/g, ' ')}</p>{r.orientation === 'defect' && <p className="mt-3 text-sm">Reliability: {fmt(r.reliability_estimate)}; transformed interval {fmt(r.reliability_lower)} to {fmt(r.reliability_upper)}.</p>}<Assumptions rows={r.assumptions} /></>} />
}

const initialNormal = { mean: '100', sd: '10', n: '31', confidence: '.95', sides: 'two-sided' as Sides, sigmaKnown: false, result: null as NormalResponse | null }
export function NormalSummary() {
  const { state: s, patch, run, error, loading } = useInferenceState('normalSummary', initialNormal)
  const [units] = useUnits()
  const r = s.result
  return <ToolLayout intro="Use summary statistics from complete Normal lifetime observations in project units. Unknown population variance uses Student’s t at every sample size." err={error} loading={loading} runLabel="Calculate mean interval"
    onRun={() => run(() => calculateNormalInterval({ mean: finiteInput(s.mean, 'Mean'), standard_deviation: finiteInput(s.sd, 'Deviation'), sample_size: finiteInput(s.n, 'Sample size'), confidence: finiteInput(s.confidence, 'Confidence'), sides: s.sides, sigma_known: s.sigmaKnown }))}
    controls={<><Field label={`Mean (${units})`} value={s.mean} onChange={mean => patch({ mean })} /><Field label={`${s.sigmaKnown ? 'Population sigma' : 'Sample SD'} (${units})`} value={s.sd} onChange={sd => patch({ sd })} /><Field label="Sample size" value={s.n} onChange={n => patch({ n })} /><label className="flex gap-2 text-xs"><input type="checkbox" checked={s.sigmaKnown} onChange={e => patch({ sigmaKnown: e.target.checked })} />Population sigma is known externally</label><ConfidenceControls confidence={s.confidence} sides={s.sides} patch={patch} /></>}
    results={r && <><div className="grid grid-cols-3 gap-3"><Card label={`Mean (${units})`} value={fmt(r.mean)} /><Card label="Lower endpoint" value={fmt(r.lower, '−∞')} /><Card label="Upper endpoint" value={fmt(r.upper)} /></div><p className="mt-3 text-xs">{100 * r.confidence}% {r.sides} · {r.method.replace(/_/g, ' ')} · Standard error {fmt(r.standard_error)}{r.degrees_of_freedom != null && ` · ${r.degrees_of_freedom} degrees of freedom`}</p><Assumptions rows={r.assumptions} /></>} />
}

const initialDiscrete = { model: 'binomial' as 'binomial' | 'hypergeometric', n: '30', p: '.05', lotSize: '100', lotDefects: '5', event: 'at_most' as 'at_most' | 'at_least' | 'exactly' | 'between', threshold: '2', upper: '4', good: '.01', bad: '.1', result: null as DiscreteResponse | null }
export function DiscreteProbability() {
  const { state: s, patch, run, error, loading } = useInferenceState('discreteProbability', initialDiscrete)
  const r = s.result
  return <ToolLayout intro="Explore defect-count probabilities and the chance a fixed sample passes an acceptance limit. Choose finite-lot sampling when drawing without replacement." err={error} loading={loading} runLabel="Calculate probabilities"
    onRun={() => run(() => calculateDiscreteProbability({ model: s.model, sample_size: finiteInput(s.n, 'Sample size'), probability: s.model === 'binomial' ? finiteInput(s.p, 'Defect probability') : 0, threshold: finiteInput(s.threshold, 'Threshold'), event: s.event,
      ...(s.model === 'hypergeometric' ? { lot_size: finiteInput(s.lotSize, 'Lot size'), lot_defects: finiteInput(s.lotDefects, 'Lot defects') } : {}), ...(s.event === 'between' ? { upper: finiteInput(s.upper, 'Upper count') } : {}), ...(s.good.trim() ? { good_quality: finiteInput(s.good, 'Good quality') } : {}), ...(s.bad.trim() ? { bad_quality: finiteInput(s.bad, 'Bad quality') } : {}) }))}
    controls={<><Select label="Sampling model" value={s.model} onChange={model => patch({ model: model as typeof s.model })} options={[{ value: 'binomial', label: 'Binomial: independent trials' }, { value: 'hypergeometric', label: 'Hypergeometric: finite lot' }]} /><Field label="Sample size" value={s.n} onChange={n => patch({ n })} />
      {s.model === 'binomial' ? <Field label="Defect probability" value={s.p} onChange={p => patch({ p })} /> : <><Field label="Lot size" value={s.lotSize} onChange={lotSize => patch({ lotSize })} /><Field label="Defects in lot" value={s.lotDefects} onChange={lotDefects => patch({ lotDefects })} /></>}
      <Select label="Probability event" value={s.event} onChange={event => patch({ event: event as typeof s.event })} options={[{ value: 'at_most', label: 'At most the threshold' }, { value: 'at_least', label: 'At least the threshold' }, { value: 'exactly', label: 'Exactly the threshold' }, { value: 'between', label: 'Between two counts, inclusive' }]} /><Field label="Defect threshold / acceptance count" value={s.threshold} onChange={threshold => patch({ threshold })} />{s.event === 'between' && <Field label="Upper defect count" value={s.upper} onChange={upper => patch({ upper })} />}
      <details><summary className="cursor-pointer text-xs">Producer / consumer risk points</summary><div className="mt-2 space-y-2"><Field label="Good-quality fraction defective" value={s.good} onChange={good => patch({ good })} /><Field label="Bad-quality fraction defective" value={s.bad} onChange={bad => patch({ bad })} /></div></details></>}
    results={r && <><div className="grid grid-cols-3 gap-3"><Card label="Requested event probability" value={fmt(r.probability)} /><Card label="Acceptance probability (at most threshold)" value={fmt(r.probability_accept)} /><Card label="Expected defects" value={fmt(r.mean_defects)} /></div>
      <Plot plotId="discrete-count-probabilities" reportLabel="Discrete Defect Probabilities" data={[{ x: r.table.defects, y: r.table.pmf, type: r.table.complete_support ? 'bar' : 'scatter', mode: 'markers', name: 'PMF' } as Plotly.Data, { x: r.table.defects, y: r.table.cdf, type: 'scatter', mode: 'lines+markers', name: 'CDF', yaxis: 'y2' } as Plotly.Data]} layout={{ ...plotBase, height: 330, title: { text: 'Defect-count probability' }, xaxis: { title: { text: 'Number of defects' } }, yaxis: { title: { text: 'Point probability' } }, yaxis2: { title: { text: 'Cumulative probability' }, overlaying: 'y', side: 'right', range: [0, 1] } }} style={{ width: '100%' }} useResizeHandler />
      <Plot plotId="discrete-acceptance-oc" reportLabel="Fixed Sample Acceptance OC" data={[{ x: r.oc_curve.fraction_defective, y: r.oc_curve.probability_accept, mode: 'lines', name: 'Accept' } as Plotly.Data]} layout={{ ...plotBase, height: 300, title: { text: 'Acceptance operating characteristic' }, xaxis: { title: { text: 'Fraction defective' } }, yaxis: { title: { text: 'Probability of acceptance' }, range: [0, 1] } }} style={{ width: '100%' }} useResizeHandler />
      {r.risk_points.length > 0 && <Table headings={['Quality', 'Requested defect fraction', 'Actual lot fraction', 'Decision risk']} rows={r.risk_points.map(point => [point.quality, fmt(point.requested_fraction_defective), fmt(point.fraction_defective), fmt(point.risk)])} />}
      {!r.table.complete_support && <p className="text-xs">Large support: the plot/table shows sampled counts. Event probabilities use the full distribution.</p>}
      <Table headings={['Defects', 'P(X=x)', 'P(X≤x)', 'P(X>x)']} rows={r.table.defects.map((x, i) => [x, fmt(r.table.pmf[i]), fmt(r.table.cdf[i]), fmt(r.table.sf[i])])} /><Assumptions rows={r.assumptions} /></>} />
}

const initialSequential = { model: 'bernoulli' as 'bernoulli' | 'exponential', p1: '.01', p2: '.1', alpha: '.05', beta: '.1', goodMtbf: '1000', badMtbf: '500', horizon: '100', exposureHorizon: '3000', observedExposure: '0', outcomes: '', failureTimes: '', terminalRule: 'inconclusive' as TerminalRule, simulations: '2000', seed: '42', result: null as SequentialResponse | null }
export function ExecutedSequential() {
  const { state: s, patch, run, error, loading } = useInferenceState('sequentialSampling', initialSequential)
  const [units] = useUnits()
  const r = s.result && 'model' in s.result ? s.result : null
  const exponential = s.model === 'exponential'
  return <ToolLayout intro="Plan and execute a sequential test. A finite horizon and its terminal rule determine achieved risks; an inconclusive outcome remains explicit." err={error} loading={loading} runLabel="Analyze sequential test"
    onRun={() => run(() => calculateSequentialPlan(s.model, { alpha: finiteInput(s.alpha, 'Producer risk'), beta: finiteInput(s.beta, 'Consumer risk'), terminal_rule: s.terminalRule,
      ...(exponential ? { good_mtbf: finiteInput(s.goodMtbf, 'Good MTBF'), bad_mtbf: finiteInput(s.badMtbf, 'Bad MTBF'), horizon: finiteInput(s.exposureHorizon, 'Exposure horizon'), observed_exposure: finiteInput(s.observedExposure, 'Observed exposure'), failure_times: numericList(s.failureTimes, 'Failure time'), simulations: finiteInput(s.simulations, 'Simulations'), seed: finiteInput(s.seed, 'Seed') }
      : { good_probability: finiteInput(s.p1, 'Good defect probability'), bad_probability: finiteInput(s.p2, 'Bad defect probability'), horizon: finiteInput(s.horizon, 'Sample horizon'), outcomes: outcomeList(s.outcomes) }) }))}
    controls={<><Select label="Sequential model" value={s.model} onChange={model => patch({ model: model as typeof s.model })} options={[{ value: 'bernoulli', label: 'Bernoulli: lot / pass–fail inspection' }, { value: 'exponential', label: 'Exponential: operating exposure / MTBF' }]} />
      {exponential ? <><Field label={`Good MTBF (${units})`} value={s.goodMtbf} onChange={goodMtbf => patch({ goodMtbf })} /><Field label={`Bad MTBF (${units})`} value={s.badMtbf} onChange={badMtbf => patch({ badMtbf })} /></> : <><Field label="Acceptable fraction defective" value={s.p1} onChange={p1 => patch({ p1 })} /><Field label="Unacceptable fraction defective" value={s.p2} onChange={p2 => patch({ p2 })} /></>}
      <Field label="Producer risk α" value={s.alpha} onChange={alpha => patch({ alpha })} /><Field label="Consumer risk β" value={s.beta} onChange={beta => patch({ beta })} />
      {exponential ? <Field label={`Exposure horizon (${units})`} value={s.exposureHorizon} onChange={exposureHorizon => patch({ exposureHorizon })} /> : <Field label="Maximum inspected samples" value={s.horizon} onChange={horizon => patch({ horizon })} />}
      <Select label="At horizon without crossing" value={s.terminalRule} onChange={terminalRule => patch({ terminalRule: terminalRule as TerminalRule })} options={[{ value: 'inconclusive', label: 'Report inconclusive' }, { value: 'likelihood_ratio', label: 'Choose more likely hypothesis (tie: accept)' }]} />
      {exponential ? <><Field label={`Observed exposure (${units})`} value={s.observedExposure} onChange={observedExposure => patch({ observedExposure })} /><TextInput label="Cumulative failure exposures" value={s.failureTimes} onChange={failureTimes => patch({ failureTimes })} hint="Strictly increasing totals across all units; blank is a no-failure observation." /><details><summary className="cursor-pointer text-xs">OC simulation settings</summary><div className="mt-2 space-y-2"><Field label="Trials per OC point" value={s.simulations} onChange={simulations => patch({ simulations })} /><Field label="Random seed" value={s.seed} onChange={seed => patch({ seed })} /></div></details></>
        : <TextInput label="Ordered inspection outcomes" value={s.outcomes} onChange={outcomes => patch({ outcomes })} hint="0 = good, 1 = defective. Commas or whitespace; blank builds the plan only." />}</>}
    results={r && <><div className="grid grid-cols-3 gap-3"><Card label="Observed decision" value={r.decision} /><Card label={r.model === 'exponential' ? `Stop exposure (${units})` : 'Stopping sample'} value={fmt(r.stopping_time, 'Not stopped')} /><Card label="Later observations ignored" value={String(r.ignored_observations)} /></div>
      <Plot plotId="sequential-executed-path" reportLabel="Sequential Test Boundaries and Observations" data={[
        { x: r.boundaries.map(row => row.time ?? row.samples), y: r.boundaries.map(row => row.accept_boundary), mode: 'lines', name: 'Accept at/below', line: { color: '#16a34a' } } as Plotly.Data,
        { x: r.boundaries.map(row => row.time ?? row.samples), y: r.boundaries.map(row => row.reject_boundary), mode: 'lines', name: 'Reject at/above', line: { color: '#dc2626' } } as Plotly.Data,
        { x: r.trace.map(row => row.time ?? row.samples), y: r.trace.map(row => row.failures ?? row.defects), mode: 'lines+markers', name: 'Observed path', line: { color: '#2563eb', shape: r.model === 'exponential' ? 'hv' : 'linear' } } as Plotly.Data,
      ]} layout={{ ...plotBase, height: 350, title: { text: 'Sequential decision path' }, xaxis: { title: { text: r.model === 'exponential' ? `Operating exposure (${units})` : 'Samples inspected' } }, yaxis: { title: { text: 'Cumulative failures / defects' }, rangemode: 'tozero' } }} style={{ width: '100%' }} useResizeHandler />
      <Table headings={['Risk / endpoint', 'Nominal', 'Achieved', 'Inconclusive']} rows={[
        ['Producer: reject good', fmt(r.alpha), fmt(r.risk_check.achieved_producer_risk), fmt(r.risk_check.inconclusive_at_good)],
        ['Consumer: accept bad', fmt(r.beta), fmt(r.risk_check.achieved_consumer_risk), fmt(r.risk_check.inconclusive_at_bad)],
      ]} />
      <p className="mt-2 text-xs text-gray-600">{r.operating_characteristics_method.replace(/_/g, ' ')}. Duration means include all tests ending at the declared horizon.</p>
      <Plot plotId="sequential-oc" reportLabel="Sequential Operating Characteristics" data={[
        { x: r.oc_curve.map(row => row.true_value), y: r.oc_curve.map(row => row.probability_accept), mode: 'lines+markers', name: 'Accept', error_y: r.model === 'exponential' ? { type: 'data', symmetric: false, array: r.oc_curve.map(row => (row.accept_interval?.[1] ?? 0) - row.probability_accept), arrayminus: r.oc_curve.map(row => row.probability_accept - (row.accept_interval?.[0] ?? 0)) } : undefined } as Plotly.Data,
        { x: r.oc_curve.map(row => row.true_value), y: r.oc_curve.map(row => row.probability_inconclusive), mode: 'lines', name: 'Inconclusive' } as Plotly.Data,
      ]} layout={{ ...plotBase, height: 310, title: { text: 'Operating characteristic at declared horizon' }, xaxis: { title: { text: r.model === 'exponential' ? `True MTBF (${units})` : 'True defect probability' } }, yaxis: { range: [0, 1], title: { text: 'Probability' } } }} style={{ width: '100%' }} useResizeHandler />
      <Table headings={[r.model === 'exponential' ? `True MTBF (${units})` : 'True defect probability', 'Accept', 'Reject', 'Inconclusive', r.model === 'exponential' ? `Mean exposure (${units})` : 'Average sample number', '95% MC mean interval']} rows={r.oc_curve.map(row => [fmt(row.true_value), fmt(row.probability_accept), fmt(row.probability_reject), fmt(row.probability_inconclusive), fmt(row.expected_duration), row.duration_interval ? row.duration_interval.map(v => fmt(v)).join(' – ') : 'Exact recursion'])} />
      {r.model === 'bernoulli' && <details className="mt-4"><summary className="cursor-pointer text-sm">Integer stopping boundaries</summary><Table headings={['Samples', 'Accept at most', 'Reject at least']} rows={r.boundaries.map(row => [row.samples!, fmt(row.accept_at_most, 'Cannot accept yet'), fmt(row.reject_at_least, 'Cannot reject yet')])} /></details>}
      <details className="mt-4"><summary className="cursor-pointer text-sm">Observed likelihood path</summary><Table headings={['Exposure / sample', 'Count', 'Log likelihood ratio', 'Decision']} rows={r.trace.map(row => [fmt(row.time ?? row.samples), row.failures ?? row.defects ?? 0, fmt(row.log_likelihood_ratio), row.decision])} /></details><Assumptions rows={r.assumptions} /></>} />
}
