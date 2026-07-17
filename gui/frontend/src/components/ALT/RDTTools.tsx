import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Plot from '../shared/ExportablePlot'
import {
  computeSampleSize, SampleSizeResponse,
  rdtExponentialChiSquared, ExpChiSquaredResponse,
  rdtBayesian, BayesianRDTResponse,
} from '../../api/client'
import {
  ToolLayout, ToolTabs, Card, Field, Select,
  detail, fmtNum, inputCls, labelCls, PLOT_CFG, plotBase,
  ToolDef,
} from './toolkit'
import { betaPdfCurve } from '../shared/stats'
import { useModuleState } from '../../store/project'
import type { SubNav } from '../shared/useSubNav'
import { useTestingToolState } from './reliabilityTestingState'

const CURVE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

interface ParametricBinomialState {
  solveFor: 'parametric_samples' | 'parametric_time'
  reliability: string
  confidence: string
  missionTime: string
  beta: string
  failures: string
  testTime: string
  sampleSize: string
  optionsTable: boolean
  ocCurve: boolean
  result: SampleSizeResponse | null
}

const INITIAL_PARAMETRIC_BINOMIAL: ParametricBinomialState = {
  solveFor: 'parametric_samples', reliability: '90', confidence: '95',
  missionTime: '100', beta: '1.5', failures: '0', testTime: '48',
  sampleSize: '20', optionsTable: false, ocCurve: true, result: null,
}

interface NonParametricBinomialState {
  reliability: string
  confidence: string
  failures: string
  ocCurve: boolean
  result: SampleSizeResponse | null
}

const INITIAL_NONPARAMETRIC_BINOMIAL: NonParametricBinomialState = {
  reliability: '80', confidence: '95', failures: '0', ocCurve: false,
  result: null,
}

// The chi-squared and Bayesian tools keep their established dedicated slices;
// the other RDT tools use the shared Reliability Testing persistence contract.
interface ExpChiState {
  metric: 'reliability' | 'mttf'; reliability: string; demoTime: string; mttf: string
  confidence: string; fails: string; solveFor: 'test_time' | 'sample_size'; n: string; testTime: string
  result: ExpChiSquaredResponse | null
}
const INITIAL_EXPCHI: ExpChiState = {
  metric: 'reliability', reliability: '85', demoTime: '500', mttf: '100', confidence: '95',
  fails: '2', solveFor: 'test_time', n: '1', testTime: '16374', result: null,
}
interface BayesState {
  solveFor: 'sample_size' | 'reliability' | 'confidence'; reliability: string; confidence: string
  fails: string; n: string; priorSource: 'expert' | 'subsystem'
  worst: string; likely: string; best: string; subs: SubRow[]
  result: BayesianRDTResponse | null
}

// ─── 1. Parametric Binomial ──────────────────────────────────────────────────

function ParametricBinomial() {
  const [state, patchState] = useTestingToolState(
    'parametricBinomial', INITIAL_PARAMETRIC_BINOMIAL)
  const {
    solveFor, reliability: R, confidence: ci, missionTime, beta,
    failures: fails, testTime, sampleSize: n, optionsTable, ocCurve,
    result: res,
  } = state
  const setSolveFor = (value: ParametricBinomialState['solveFor']) => patchState({ solveFor: value })
  const setR = (value: string) => patchState({ reliability: value })
  const setCi = (value: string) => patchState({ confidence: value })
  const setMissionTime = (value: string) => patchState({ missionTime: value })
  const setBeta = (value: string) => patchState({ beta: value })
  const setFails = (value: string) => patchState({ failures: value })
  const setTestTime = (value: string) => patchState({ testTime: value })
  const setN = (value: string) => patchState({ sampleSize: value })
  const setOptionsTable = (value: boolean) => patchState({ optionsTable: value })
  const setOcCurve = (value: boolean) => patchState({ ocCurve: value })
  const setRes = (value: SampleSizeResponse | null) => patchState({ result: value })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await computeSampleSize({
        method: solveFor,
        failures: parseInt(fails, 10),
        R: parseFloat(R) / 100,
        CI: parseFloat(ci) / 100,
        mission_time: parseFloat(missionTime),
        beta: parseFloat(beta),
        test_time: solveFor === 'parametric_samples' ? parseFloat(testTime) : undefined,
        n: solveFor === 'parametric_time' ? parseInt(n, 10) : undefined,
        options_table: optionsTable,
        oc_curve: ocCurve,
        curves: true,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const solvingSamples = solveFor === 'parametric_samples'

  const controls = (
    <>
      <Select label="Solve for" value={solveFor} onChange={v => setSolveFor(v as typeof solveFor)}
        options={[
          { value: 'parametric_samples', label: 'Sample size (given test time)' },
          { value: 'parametric_time', label: 'Test time (given sample size)' },
        ]} />
      <Field label="Demonstrated reliability R (%)" tip="Reliability to demonstrate at the stated time." value={R} onChange={setR} />
      <Field label="Confidence level (%)" tip="Confidence level of the demonstration." value={ci} onChange={setCi} />
      <Field label="Demonstrated at time" tip="Mission time at which the reliability is demonstrated." value={missionTime} onChange={setMissionTime} />
      <Field label="Weibull shape β" tip="Known/assumed Weibull shape parameter." value={beta} onChange={setBeta} />
      <Field label="Allowable failures" tip="Number of failures permitted during the test." value={fails} onChange={setFails} />
      {solvingSamples
        ? <Field label="Test time per unit" tip="Duration each unit is tested." value={testTime} onChange={setTestTime} />
        : <Field label="Sample size" tip="Number of units tested." value={n} onChange={setN} />}
      <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
        <input type="checkbox" checked={optionsTable} onChange={e => setOptionsTable(e.target.checked)} />
        Show options table
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
        <input type="checkbox" checked={ocCurve} onChange={e => setOcCurve(e.target.checked)} />
        Show OC curve
      </label>
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {solvingSamples
          ? <Card label="Required sample size" value={res.n != null ? String(res.n) : '—'} accent />
          : <Card label="Required test time" value={fmtNum(res.test_time)} accent />}
        <Card label="Weibull η" value={fmtNum(res.eta)} />
        <Card label="R demonstrated at test time" value={res.R_test != null ? res.R_test.toFixed(4) : '—'} />
      </div>
      {res.options_table && res.options_table.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Options table</p>
          <table className="w-full text-xs border border-gray-200 rounded">
            <thead className="bg-gray-50"><tr>
              <th className="px-3 py-1.5 text-left font-medium text-gray-600">Allowable failures (f)</th>
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">{solvingSamples ? 'Sample size (n)' : 'Test time'}</th>
            </tr></thead>
            <tbody>
              {res.options_table.map((row, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-1 text-gray-700">{row.f}</td>
                  <td className="px-3 py-1 text-right font-mono">
                    {solvingSamples
                      ? (row.n != null ? String(row.n) : '—')
                      : (row.test_time != null ? fmtNum(row.test_time) : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res.oc_curve && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Operating characteristic (OC) curve</p>
          <Plot
            data={[{ x: res.oc_curve.R, y: res.oc_curve.P_accept, mode: 'lines', line: { color: '#3b82f6', width: 2 }, name: 'P(accept)' }] as Plotly.Data[]}
            layout={{ ...plotBase, height: 320, xaxis: { title: { text: 'True reliability R' } }, yaxis: { title: { text: 'P(accept)' }, range: [0, 1] } } as Plotly.Layout}
            config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
        </div>
      )}
      {res.requirement_curve && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">
            {res.requirement_curve.y_label} vs demonstrated reliability
            {res.requirement_curve.curves.length > 1 && ' (one curve per allowable failures f)'}
          </p>
          <Plot
            data={res.requirement_curve.curves.map((c, i) => ({
              x: res.requirement_curve!.R, y: c.values, mode: 'lines',
              line: { color: CURVE_COLORS[i % CURVE_COLORS.length], width: 2 },
              name: `f=${c.f}`,
            })) as Plotly.Data[]}
            layout={{ ...plotBase, height: 320, showlegend: res.requirement_curve.curves.length > 1,
              xaxis: { title: { text: 'Demonstrated reliability R' } },
              yaxis: { title: { text: res.requirement_curve.y_label } } } as Plotly.Layout}
            config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
        </div>
      )}
      {res.tradeoff_curve && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">
            Sample size vs test time per unit (same R/CI)
            {res.tradeoff_curve.curves.length > 1 && ' (one curve per allowable failures f)'}
          </p>
          <Plot
            data={res.tradeoff_curve.curves.map((c, i) => ({
              x: res.tradeoff_curve!.test_time, y: c.n, mode: 'lines',
              line: { color: CURVE_COLORS[i % CURVE_COLORS.length], width: 2 },
              name: `f=${c.f}`,
            })) as Plotly.Data[]}
            layout={{ ...plotBase, height: 320, showlegend: res.tradeoff_curve.curves.length > 1,
              xaxis: { title: { text: 'Test time per unit' } },
              yaxis: { title: { text: 'Required sample size' } } } as Plotly.Layout}
            config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
        </div>
      )}
    </div>
  )

  return <ToolLayout
    intro="Parametric binomial demonstration: demonstrate a reliability at a time assuming a Weibull life with a known shape. Solve for either the required sample size (given test time) or the required test time (given sample size)."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}

// ─── 2. Non-Parametric Binomial ──────────────────────────────────────────────

function NonParametricBinomial() {
  const [state, patchState] = useTestingToolState(
    'nonParametricBinomial', INITIAL_NONPARAMETRIC_BINOMIAL)
  const {
    reliability: R, confidence: ci, failures: fails, ocCurve, result: res,
  } = state
  const setR = (value: string) => patchState({ reliability: value })
  const setCi = (value: string) => patchState({ confidence: value })
  const setFails = (value: string) => patchState({ failures: value })
  const setOcCurve = (value: boolean) => patchState({ ocCurve: value })
  const setRes = (value: SampleSizeResponse | null) => patchState({ result: value })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await computeSampleSize({
        method: 'nonparametric',
        failures: parseInt(fails, 10),
        R: parseFloat(R) / 100,
        CI: parseFloat(ci) / 100,
        oc_curve: ocCurve,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Field label="Demonstrated reliability R (%)" tip="Reliability to demonstrate (no distribution assumption)." value={R} onChange={setR} />
      <Field label="Confidence level (%)" tip="Confidence level of the demonstration." value={ci} onChange={setCi} />
      <Field label="Allowable failures" tip="Number of failures permitted during the test." value={fails} onChange={setFails} />
      <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
        <input type="checkbox" checked={ocCurve} onChange={e => setOcCurve(e.target.checked)} />
        Show OC curve
      </label>
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Required sample size" value={res.n != null ? String(res.n) : '—'} accent />
        <Card label="Demonstrated reliability" value={`${(res.R * 100).toFixed(1)}%`} />
        <Card label="Confidence level" value={`${(res.CI * 100).toFixed(1)}%`} />
      </div>
      {res.oc_curve && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Operating characteristic (OC) curve</p>
          <Plot
            data={[{ x: res.oc_curve.R, y: res.oc_curve.P_accept, mode: 'lines', line: { color: '#3b82f6', width: 2 }, name: 'P(accept)' }] as Plotly.Data[]}
            layout={{ ...plotBase, height: 320, xaxis: { title: { text: 'True reliability R' } }, yaxis: { title: { text: 'P(accept)' }, range: [0, 1] } } as Plotly.Layout}
            config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
        </div>
      )}
    </div>
  )

  return <ToolLayout
    intro="Non-parametric binomial demonstration: no distribution assumption, for one-shot / pass-fail devices. Computes the required sample size to demonstrate a reliability at a confidence level given the allowable failures."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}

// ─── 3. Exponential Chi-Squared ──────────────────────────────────────────────

function ExpChiSquared() {
  const [st, setSt] = useModuleState<ExpChiState>('expChiSquared', INITIAL_EXPCHI)
  const patchSt = (p: Partial<ExpChiState>) => setSt(prev => ({ ...prev, ...p }))
  const { metric, reliability, demoTime, mttf, confidence, fails, solveFor, n, testTime } = st
  const res = st.result
  const setMetric = (v: 'reliability' | 'mttf') => patchSt({ metric: v })
  const setReliability = (v: string) => patchSt({ reliability: v })
  const setDemoTime = (v: string) => patchSt({ demoTime: v })
  const setMttf = (v: string) => patchSt({ mttf: v })
  const setConfidence = (v: string) => patchSt({ confidence: v })
  const setFails = (v: string) => patchSt({ fails: v })
  const setSolveFor = (v: 'test_time' | 'sample_size') => patchSt({ solveFor: v })
  const setN = (v: string) => patchSt({ n: v })
  const setTestTime = (v: string) => patchSt({ testTime: v })
  const setRes = (v: ExpChiSquaredResponse | null) => patchSt({ result: v })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await rdtExponentialChiSquared({
        metric,
        reliability: metric === 'reliability' ? parseFloat(reliability) / 100 : undefined,
        demo_time: metric === 'reliability' ? parseFloat(demoTime) : undefined,
        mttf: metric === 'mttf' ? parseFloat(mttf) : undefined,
        confidence: parseFloat(confidence) / 100,
        failures: parseInt(fails, 10),
        solve_for: solveFor,
        n: solveFor === 'test_time' ? parseInt(n, 10) : null,
        test_time: solveFor === 'sample_size' ? parseFloat(testTime) : null,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Select label="Metric" value={metric} onChange={v => setMetric(v as typeof metric)}
        options={[
          { value: 'reliability', label: 'Reliability at a time' },
          { value: 'mttf', label: 'MTTF' },
        ]} />
      {metric === 'reliability' ? <>
        <Field label="Demonstrated reliability (%)" tip="Reliability to demonstrate at the stated time." value={reliability} onChange={setReliability} />
        <Field label="Demonstrated at time" tip="Mission time at which the reliability is demonstrated." value={demoTime} onChange={setDemoTime} />
      </> : (
        <Field label="Demonstrated MTTF" tip="Mean time to failure to demonstrate." value={mttf} onChange={setMttf} />
      )}
      <Field label="Confidence level (%)" tip="Confidence level of the demonstration." value={confidence} onChange={setConfidence} />
      <Field label="Allowable failures" tip="Number of failures permitted during the test." value={fails} onChange={setFails} />
      <Select label="Solve for" value={solveFor} onChange={v => setSolveFor(v as typeof solveFor)}
        options={[
          { value: 'test_time', label: 'Test time per unit (given units)' },
          { value: 'sample_size', label: 'Sample size (given test time)' },
        ]} />
      {solveFor === 'test_time'
        ? <Field label="Sample size (units)" tip="Number of units under test." value={n} onChange={setN} />
        : <Field label="Test time per unit" tip="Duration each unit is tested." value={testTime} onChange={setTestTime} />}
    </>
  )

  const results = res && (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Accumulated test time" value={fmtNum(res.accumulated_test_time)} accent />
        <Card label="Chi-squared" value={fmtNum(res.chi_squared)} />
        <Card label="Implied MTTF" value={fmtNum(res.implied_mttf)} />
        {res.sample_size != null
          ? <Card label="Sample size" value={String(res.sample_size)} />
          : res.test_time != null
            ? <Card label="Test time per unit" value={fmtNum(res.test_time)} />
            : <Card label="Allowable failures" value={String(res.failures)} />}
      </div>
      <p className="text-[11px] text-gray-500 leading-snug">
        Accumulating <span className="font-mono">{fmtNum(res.accumulated_test_time)}</span> unit-hours of test
        with at most <span className="font-mono">{res.failures}</span> failure{res.failures === 1 ? '' : 's'} demonstrates
        the target at <span className="font-mono">{(res.confidence * 100).toFixed(0)}%</span> confidence
        (implied MTTF {fmtNum(res.implied_mttf)}).
      </p>
    </div>
  )

  return <ToolLayout
    intro="Exponential chi-squared demonstration: assumes a constant failure rate (exponential life). Computes the accumulated test time required to demonstrate a reliability-at-time or an MTTF at a confidence level with a given number of allowable failures."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}

// ─── 4. Non-Parametric Bayesian ──────────────────────────────────────────────

interface SubRow { name: string; n: string; r: string }
const emptySubRows = (): SubRow[] =>
  Array.from({ length: 3 }, () => ({ name: '', n: '', r: '' }))

const INITIAL_BAYES: BayesState = {
  solveFor: 'sample_size', reliability: '90', confidence: '95', fails: '1', n: '20',
  priorSource: 'expert', worst: '80', likely: '85', best: '97', subs: emptySubRows(), result: null,
}

function Bayesian() {
  const [st, setSt] = useModuleState<BayesState>('rdtBayesian', INITIAL_BAYES)
  const patchSt = (p: Partial<BayesState>) => setSt(prev => ({ ...prev, ...p }))
  const { solveFor, reliability, confidence, fails, n, priorSource, worst, likely, best, subs } = st
  const res = st.result
  const setSolveFor = (v: 'sample_size' | 'reliability' | 'confidence') => patchSt({ solveFor: v })
  const setReliability = (v: string) => patchSt({ reliability: v })
  const setConfidence = (v: string) => patchSt({ confidence: v })
  const setFails = (v: string) => patchSt({ fails: v })
  const setN = (v: string) => patchSt({ n: v })
  const setPriorSource = (v: 'expert' | 'subsystem') => patchSt({ priorSource: v })
  const setWorst = (v: string) => patchSt({ worst: v })
  const setLikely = (v: string) => patchSt({ likely: v })
  const setBest = (v: string) => patchSt({ best: v })
  const setSubs = (v: SubRow[]) => patchSt({ subs: v })
  const setRes = (v: BayesianRDTResponse | null) => patchSt({ result: v })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const updateSub = (i: number, k: keyof SubRow, v: string) =>
    setSubs(subs.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const addSub = () => setSubs([...subs, { name: '', n: '', r: '' }])
  const delSub = (i: number) => setSubs(subs.filter((_, j) => j !== i))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await rdtBayesian({
        solve_for: solveFor,
        reliability: solveFor !== 'reliability' ? parseFloat(reliability) / 100 : undefined,
        confidence: solveFor !== 'confidence' ? parseFloat(confidence) / 100 : undefined,
        failures: parseInt(fails, 10),
        n: solveFor !== 'sample_size' ? parseInt(n, 10) : null,
        prior_source: priorSource,
        worst: priorSource === 'expert' ? parseFloat(worst) / 100 : null,
        likely: priorSource === 'expert' ? parseFloat(likely) / 100 : null,
        best: priorSource === 'expert' ? parseFloat(best) / 100 : null,
        subsystems: priorSource === 'subsystem'
          ? subs.filter(s => s.n.trim() && s.r.trim()).map(s => ({
              name: s.name.trim() || undefined, n: parseInt(s.n, 10), r: parseInt(s.r, 10),
            }))
          : null,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Select label="Solve for" value={solveFor} onChange={v => setSolveFor(v as typeof solveFor)}
        options={[
          { value: 'sample_size', label: 'Sample size' },
          { value: 'reliability', label: 'Demonstrated reliability' },
          { value: 'confidence', label: 'Confidence level' },
        ]} />
      {solveFor !== 'reliability' &&
        <Field label="Required reliability (%)" tip="Target reliability to demonstrate." value={reliability} onChange={setReliability} />}
      {solveFor !== 'confidence' &&
        <Field label="Confidence level (%)" tip="Confidence level of the demonstration." value={confidence} onChange={setConfidence} />}
      <Field label="Allowed failures" tip="Number of failures permitted in the test." value={fails} onChange={setFails} />
      {solveFor !== 'sample_size' &&
        <Field label="Sample size n" tip="Number of units tested." value={n} onChange={setN} />}
      <Select label="Prior source" value={priorSource} onChange={v => setPriorSource(v as typeof priorSource)}
        options={[
          { value: 'expert', label: 'Expert opinion' },
          { value: 'subsystem', label: 'Subsystem tests' },
        ]} />
      {priorSource === 'expert' ? <>
        <Field label="Worst-case reliability (%)" tip="Pessimistic estimate of reliability." value={worst} onChange={setWorst} />
        <Field label="Most-likely (%)" tip="Most-likely estimate of reliability." value={likely} onChange={setLikely} />
        <Field label="Best-case (%)" tip="Optimistic estimate of reliability." value={best} onChange={setBest} />
      </> : (
        <div>
          <label className={labelCls}>Subsystem test data</label>
          <div className="border border-gray-200 rounded overflow-hidden">
            <div className="max-h-52 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-1 py-1 text-left font-medium text-gray-500">Name</th>
                    <th className="px-1 py-1 text-left font-medium text-gray-500">n</th>
                    <th className="px-1 py-1 text-left font-medium text-gray-500">r</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s, i) => (
                    <tr key={i} className="border-t border-gray-100 group">
                      <td className="px-0.5 py-0.5"><input value={s.name} onChange={e => updateSub(i, 'name', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="ID" /></td>
                      <td className="px-0.5 py-0.5"><input value={s.n} onChange={e => updateSub(i, 'n', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="0" /></td>
                      <td className="px-0.5 py-0.5"><input value={s.r} onChange={e => updateSub(i, 'r', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="0" /></td>
                      <td className="px-0.5 text-center"><button tabIndex={-1} onClick={() => delSub(i)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addSub} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-1 flex items-center justify-center gap-1 border-t border-gray-100"><Plus size={11} /> Add row</button>
          </div>
        </div>
      )}
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {res.solve_for === 'sample_size'
          ? <Card label="Required sample size" value={res.sample_size != null ? String(res.sample_size) : '—'} accent />
          : res.solve_for === 'reliability'
            ? <Card label="Demonstrated reliability" value={res.reliability != null ? res.reliability.toFixed(4) : '—'} accent />
            : <Card label="Confidence level" value={res.confidence != null ? `${(res.confidence * 100).toFixed(2)}%` : '—'} accent />}
        <Card label="Allowed failures" value={String(res.failures)} />
        {res.n != null && <Card label="Sample size n" value={String(res.n)} />}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Prior parameters ({res.prior_source})</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="E(R₀)" value={res.E_R0.toFixed(4)} />
          <Card label="α₀" value={fmtNum(res.alpha0)} />
          <Card label="β₀" value={fmtNum(res.beta0)} />
          {res.posterior_alpha != null && res.posterior_beta != null && (
            <Card label="Posterior α / β" value={`${fmtNum(res.posterior_alpha)} / ${fmtNum(res.posterior_beta)}`} />
          )}
        </div>
      </div>
      {(() => {
        const prior = betaPdfCurve(res.alpha0, res.beta0)
        const hasPost = res.posterior_alpha != null && res.posterior_beta != null
        const post = hasPost ? betaPdfCurve(res.posterior_alpha!, res.posterior_beta!) : null
        const ymax = Math.max(...prior.y, ...(post ? post.y : [0])) * 1.05
        const data: Plotly.Data[] = [
          { x: prior.x, y: prior.y, mode: 'lines', name: 'Prior', line: { color: CURVE_COLORS[0], width: 2 } },
          ...(post ? [{ x: post.x, y: post.y, mode: 'lines', name: 'Posterior', line: { color: CURVE_COLORS[1], width: 2 } } as Plotly.Data] : []),
          { x: [res.E_R0, res.E_R0], y: [0, ymax], mode: 'lines', name: `E(R₀)=${res.E_R0.toFixed(3)}`,
            line: { color: '#9ca3af', width: 1.5, dash: 'dot' }, hoverinfo: 'name' },
        ]
        return (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Reliability belief (Beta {hasPost ? 'prior → posterior' : 'prior'})</p>
            <Plot
              data={data}
              layout={{ ...plotBase, height: 320,
                xaxis: { title: { text: 'Reliability R' }, range: [0, 1] },
                yaxis: { title: { text: 'Density' }, rangemode: 'tozero' } } as Plotly.Layout}
              config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
          </div>
        )
      })()}
    </div>
  )

  return <ToolLayout
    intro="Non-parametric Bayesian demonstration: a Beta prior on reliability is built from expert opinion (worst / most-likely / best) or from subsystem test data, then combined with the demonstration test to solve for sample size, demonstrated reliability, or confidence."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}

// ─── Container ───────────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  { id: 'parametric', label: 'Parametric Binomial', render: () => <ParametricBinomial /> },
  { id: 'nonparametric', label: 'Non-Parametric Binomial', render: () => <NonParametricBinomial /> },
  { id: 'chisquared', label: 'Exponential Chi-Squared', render: () => <ExpChiSquared /> },
  { id: 'bayesian', label: 'Non-Parametric Bayesian', render: () => <Bayesian /> },
]

export default function RDTTools({ navSub, active, onActiveChange }: {
  navSub?: SubNav | null
  active?: string
  onActiveChange?: (id: string) => void
}) {
  return <ToolTabs tools={TOOLS} navSub={navSub}
    active={active} onActiveChange={onActiveChange} />
}
