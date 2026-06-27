import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play, Plus, Trash2 } from 'lucide-react'
import {
  oneSampleProportion, twoProportionTest, sampleSizeNoFailures,
  sequentialSampling, SequentialSamplingResponse,
  testPlanner, testDuration, goodnessOfFit, GoodnessOfFitResponse,
  computePassProbability, PassProbResponse,
  degradationAnalysis, DegradationResponse,
  destructiveDegradationAnalysis, DestructiveDegradationResponse,
  essAnalysis, ESSResponse, hassAnalysis, HASSResponse,
  burnInAnalysis, BurnInResponse,
} from '../../api/client'
import InfoLabel from '../shared/InfoLabel'
import { useModuleState } from '../../store/project'
import {
  inputCls, labelCls, detail, Card, Field, fmtNum, ToolLayout, PLOT_CFG, plotBase,
} from './toolkit'

// ─── Exponential test planner ────────────────────────────────────────────────

function Planner() {
  const [solveFor, setSolveFor] = useState<'MTBF' | 'test_duration' | 'number_of_failures'>('MTBF')
  const [mtbf, setMtbf] = useState('500')
  const [dur, setDur] = useState('10000')
  const [fails, setFails] = useState('5')
  const [ci, setCi] = useState('0.9')
  const [res, setRes] = useState<{ MTBF: number; test_duration: number; number_of_failures: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [mtbfTrue, setMtbfTrue] = useState('1000')
  const [passRes, setPassRes] = useState<PassProbResponse | null>(null)
  const [passErr, setPassErr] = useState<string | null>(null)
  const [passLoading, setPassLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await testPlanner({
        MTBF: solveFor === 'MTBF' ? null : parseFloat(mtbf),
        test_duration: solveFor === 'test_duration' ? null : parseFloat(dur),
        number_of_failures: solveFor === 'number_of_failures' ? null : parseInt(fails, 10),
        CI: parseFloat(ci),
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Error.')) } finally { setLoading(false) }
  }

  const computePassProb = async () => {
    if (!res) return
    const trueMtbf = parseFloat(mtbfTrue)
    if (!isFinite(trueMtbf) || trueMtbf <= 0) {
      setPassErr('True MTBF must be a positive number.'); return
    }
    setPassErr(null); setPassLoading(true)
    try {
      const testDur = res.test_duration
      const c = res.number_of_failures
      const r = await computePassProbability({
        test_duration: testDur,
        allowable_failures: c,
        true_mtbf: trueMtbf,
        oc_mtbf_min: trueMtbf * 0.1,
        oc_mtbf_max: trueMtbf * 5,
        oc_points: 200,
      })
      setPassRes(r)
    } catch (e) { setPassErr(detail(e, 'Error computing pass probability.')) } finally { setPassLoading(false) }
  }

  const pPct = passRes != null ? (passRes.p_pass * 100) : null
  const badgeColor = pPct == null ? ''
    : pPct >= 80 ? 'bg-green-100 text-green-800 border-green-300'
    : pPct >= 50 ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
    : 'bg-red-100 text-red-800 border-red-300'

  return (
    <ToolLayout
      intro="Plans an exponential (constant failure rate) reliability demonstration test. Provide two of MTBF / test duration / number of failures and solve for the third."
      controls={<>
        <div>
          <InfoLabel tip="The quantity to compute from the other two.">Solve for</InfoLabel>
          <select value={solveFor} onChange={e => setSolveFor(e.target.value as typeof solveFor)} className={inputCls}>
            <option value="MTBF">MTBF</option>
            <option value="test_duration">Test duration</option>
            <option value="number_of_failures">Number of failures</option>
          </select>
        </div>
        {solveFor !== 'MTBF' && <Field label="MTBF (lower bound)" tip="Demonstrated mean time between failures." value={mtbf} onChange={setMtbf} />}
        {solveFor !== 'test_duration' && <Field label="Total test duration" tip="Sum of test time across all units." value={dur} onChange={setDur} />}
        {solveFor !== 'number_of_failures' && <Field label="Number of failures" tip="Allowable failures during the test." value={fails} onChange={setFails} />}
        <div>
          <InfoLabel tip="Confidence level for the MTBF lower bound.">Confidence</InfoLabel>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.8">80%</option><option value="0.9">90%</option><option value="0.95">95%</option>
          </select>
        </div>
      </>}
      err={err} loading={loading} onRun={run} runLabel="Compute"
      results={res && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card label="MTBF" value={res.MTBF.toFixed(2)} accent={solveFor === 'MTBF'} />
            <Card label="Test duration" value={res.test_duration.toFixed(1)} accent={solveFor === 'test_duration'} />
            <Card label="Allowable failures" value={String(res.number_of_failures)} accent={solveFor === 'number_of_failures'} />
          </div>

          <hr className="my-5 border-gray-200" />

          <p className="text-sm font-semibold text-gray-800 mb-3">Probability of Passing</p>
          <p className="text-xs text-gray-500 mb-3 leading-snug">
            Given the test design above, what is the probability of observing &le;{res.number_of_failures} failures if
            the true MTBF equals the value below? Uses a Poisson model (exponential life).
          </p>
          <div className="flex items-end gap-2 mb-3">
            <div className="flex-1">
              <InfoLabel tip="The assumed true MTBF of the product. The OC curve sweeps a range around this value.">
                True MTBF (assumed)
              </InfoLabel>
              <input
                type="number" step="any" value={mtbfTrue}
                onChange={e => setMtbfTrue(e.target.value)}
                className={inputCls}
              />
            </div>
            <button
              onClick={computePassProb}
              disabled={passLoading}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors whitespace-nowrap"
            >
              <Play size={10} /> {passLoading ? 'Computing...' : 'Compute'}
            </button>
          </div>
          {passErr && <p className="text-xs text-red-600 bg-red-50 p-2 rounded mb-3">{passErr}</p>}
          {passRes != null && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <span className={`inline-block border rounded-full px-4 py-1 text-lg font-bold ${badgeColor}`}>
                  {(passRes.p_pass * 100).toFixed(2)}%
                </span>
                <span className="text-xs text-gray-500">
                  P(pass) &middot; &lambda; = T/M = {passRes.lambda.toFixed(4)}
                </span>
              </div>
              {passRes.oc_curve && (
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 380 }}>
                  <Plot
                    data={[
                      {
                        x: passRes.oc_curve.mtbf,
                        y: passRes.oc_curve.p_pass,
                        mode: 'lines',
                        name: 'P(pass)',
                        line: { color: '#2563eb', width: 2 },
                      } as Plotly.Data,
                      {
                        x: [passRes.true_mtbf, passRes.true_mtbf],
                        y: [0, 1],
                        mode: 'lines',
                        name: 'True MTBF',
                        line: { color: '#ef4444', width: 1.5, dash: 'dash' },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      title: { text: 'Operating Characteristic (OC) Curve', font: { size: 13 } },
                      xaxis: { title: { text: 'True MTBF' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'P(pass)' }, range: [0, 1], gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.7, y: 0.98, font: { size: 10 } },
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    />
  )
}

function Duration() {
  const [req, setReq] = useState('100'); const [des, setDes] = useState('200')
  const [cr, setCr] = useState('0.1'); const [pr, setPr] = useState('0.1')
  const [res, setRes] = useState<{ test_duration: number; number_of_failures: number } | null>(null)
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const run = async () => {
    setErr(null); setLoading(true)
    try {
      setRes(await testDuration({ MTBF_required: parseFloat(req), MTBF_design: parseFloat(des), consumer_risk: parseFloat(cr), producer_risk: parseFloat(pr) }))
    } catch (e) { setErr(detail(e, 'Error.')) } finally { setLoading(false) }
  }
  return (
    <ToolLayout
      intro="Computes the fixed-length exponential test duration and allowable failures that satisfy both the consumer's and producer's risk."
      controls={<>
        <Field label="MTBF required (threshold)" tip="The minimum acceptable MTBF (consumer's interest)." value={req} onChange={setReq} />
        <Field label="MTBF design (target)" tip="The true/target MTBF of the design (producer's interest). Must exceed the required MTBF." value={des} onChange={setDes} />
        <Field label="Consumer's risk" tip="Probability of accepting a design at the required-MTBF threshold (Type II)." value={cr} onChange={setCr} />
        <Field label="Producer's risk" tip="Probability of rejecting a good design at the design MTBF (Type I)." value={pr} onChange={setPr} />
      </>}
      err={err} loading={loading} onRun={run} runLabel="Compute"
      results={res && (
        <div className="grid grid-cols-2 gap-3">
          <Card label="Test duration" value={res.test_duration.toFixed(1)} accent />
          <Card label="Allowable failures" value={String(res.number_of_failures)} />
        </div>
      )}
    />
  )
}

function NoFailures() {
  const [R, setR] = useState('0.9'); const [ci, setCi] = useState('0.9')
  const [lt, setLt] = useState('1'); const [shape, setShape] = useState('1')
  const [res, setRes] = useState<{ n: number } | null>(null)
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const run = async () => {
    setErr(null); setLoading(true)
    try {
      setRes(await sampleSizeNoFailures({ reliability: parseFloat(R), CI: parseFloat(ci), lifetimes: parseFloat(lt), weibull_shape: parseFloat(shape) }))
    } catch (e) { setErr(detail(e, 'Error.')) } finally { setLoading(false) }
  }
  return (
    <ToolLayout
      intro="Sample size for a zero-failure reliability demonstration test (success-run theorem), optionally testing each unit for multiple mission lifetimes on a Weibull life."
      controls={<>
        <Field label="Reliability to demonstrate" tip="Target reliability R (0–1)." value={R} onChange={setR} />
        <div>
          <InfoLabel tip="Confidence level.">Confidence</InfoLabel>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.8">80%</option><option value="0.9">90%</option><option value="0.95">95%</option>
          </select>
        </div>
        <Field label="Test lifetimes" tip="Test duration as a multiple of one mission life. Testing longer reduces the required sample size." value={lt} onChange={setLt} />
        <Field label="Weibull shape (β)" tip="Weibull shape parameter of the life distribution (1 = exponential)." value={shape} onChange={setShape} />
      </>}
      err={err} loading={loading} onRun={run} runLabel="Compute"
      results={res && <div className="grid grid-cols-1 gap-3 max-w-xs"><Card label="Required sample size (zero failures)" value={String(res.n)} accent /></div>}
    />
  )
}

function OneProportion() {
  const [trials, setTrials] = useState('20'); const [succ, setSucc] = useState('20'); const [ci, setCi] = useState('0.95')
  const [res, setRes] = useState<{ proportion: number; lower: number; upper: number } | null>(null)
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const run = async () => {
    setErr(null); setLoading(true)
    try { setRes(await oneSampleProportion({ trials: parseInt(trials, 10), successes: parseInt(succ, 10), CI: parseFloat(ci) })) }
    catch (e) { setErr(detail(e, 'Error.')) } finally { setLoading(false) }
  }
  return (
    <ToolLayout
      intro="Exact (Clopper-Pearson) confidence interval for a success proportion / reliability from a pass-fail test."
      controls={<>
        <Field label="Trials" tip="Total units tested." value={trials} onChange={setTrials} />
        <Field label="Successes (passes)" tip="Number of units that passed." value={succ} onChange={setSucc} />
        <div>
          <InfoLabel tip="Confidence level for the interval.">Confidence</InfoLabel>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.9">90%</option><option value="0.95">95%</option><option value="0.99">99%</option>
          </select>
        </div>
      </>}
      err={err} loading={loading} onRun={run} runLabel="Compute"
      results={res && (
        <div className="grid grid-cols-3 gap-3">
          <Card label="Proportion" value={res.proportion.toFixed(4)} accent />
          <Card label="Lower bound" value={res.lower.toFixed(4)} />
          <Card label="Upper bound" value={res.upper.toFixed(4)} />
        </div>
      )}
    />
  )
}

function TwoProportion() {
  const [t1, setT1] = useState('100'); const [s1, setS1] = useState('90')
  const [t2, setT2] = useState('100'); const [s2, setS2] = useState('60'); const [ci, setCi] = useState('0.95')
  const [res, setRes] = useState<{ p1: number; p2: number; z: number; p_value: number; different: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const run = async () => {
    setErr(null); setLoading(true)
    try { setRes(await twoProportionTest({ trials_1: parseInt(t1, 10), successes_1: parseInt(s1, 10), trials_2: parseInt(t2, 10), successes_2: parseInt(s2, 10), CI: parseFloat(ci) })) }
    catch (e) { setErr(detail(e, 'Error.')) } finally { setLoading(false) }
  }
  return (
    <ToolLayout
      intro="Two-sided z-test comparing two independent success proportions (e.g. the reliability of two designs)."
      controls={<>
        <Field label="Sample 1 trials" value={t1} onChange={setT1} />
        <Field label="Sample 1 successes" value={s1} onChange={setS1} />
        <Field label="Sample 2 trials" value={t2} onChange={setT2} />
        <Field label="Sample 2 successes" value={s2} onChange={setS2} />
        <div>
          <InfoLabel tip="Significance is 1 − CI.">Confidence</InfoLabel>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.9">90%</option><option value="0.95">95%</option><option value="0.99">99%</option>
          </select>
        </div>
      </>}
      err={err} loading={loading} onRun={run} runLabel="Compare"
      results={res && (
        <>
          <p className={`text-2xl font-bold mb-3 ${res.different ? 'text-red-600' : 'text-green-600'}`}>
            {res.different ? 'Significantly different' : 'Not significantly different'}
          </p>
          <div className="grid grid-cols-4 gap-3">
            <Card label="p₁" value={res.p1.toFixed(4)} />
            <Card label="p₂" value={res.p2.toFixed(4)} />
            <Card label="z statistic" value={res.z.toFixed(4)} />
            <Card label="p-value" value={res.p_value.toExponential(3)} />
          </div>
        </>
      )}
    />
  )
}

function Sequential() {
  const [p1, setP1] = useState('0.01'); const [p2, setP2] = useState('0.10')
  const [alpha, setAlpha] = useState('0.05'); const [beta, setBeta] = useState('0.10')
  const [res, setRes] = useState<SequentialSamplingResponse | null>(null)
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const run = async () => {
    setErr(null); setLoading(true)
    try { setRes(await sequentialSampling({ p1: parseFloat(p1), p2: parseFloat(p2), alpha: parseFloat(alpha), beta: parseFloat(beta) })) }
    catch (e) { setErr(detail(e, 'Error.')) } finally { setLoading(false) }
  }
  return (
    <ToolLayout
      intro="Wald sequential probability ratio test (SPRT). Plots the accept/reject boundaries vs cumulative sample size for a binomial test."
      controls={<>
        <Field label="Acceptable fraction defective (p₁)" tip="Good quality level — producer's risk applies here." value={p1} onChange={setP1} />
        <Field label="Unacceptable fraction defective (p₂)" tip="Poor quality level — consumer's risk applies here. Must exceed p₁." value={p2} onChange={setP2} />
        <Field label="Producer's risk (α)" tip="Probability of rejecting good (p₁) quality." value={alpha} onChange={setAlpha} />
        <Field label="Consumer's risk (β)" tip="Probability of accepting bad (p₂) quality." value={beta} onChange={setBeta} />
      </>}
      err={err} loading={loading} onRun={run} runLabel="Build chart"
      results={res && (
        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 440 }}>
          <Plot
            data={[
              { x: res.n, y: res.rejection_line, mode: 'lines', name: 'Reject if above', line: { color: '#ef4444', width: 2 } } as Plotly.Data,
              { x: res.n, y: res.acceptance_line, mode: 'lines', name: 'Accept if below', line: { color: '#10b981', width: 2 } } as Plotly.Data,
            ]}
            layout={{
              title: { text: 'Sequential Sampling Chart (SPRT)', font: { size: 13 } },
              xaxis: { title: { text: 'Cumulative samples tested' }, gridcolor: '#e5e7eb' },
              yaxis: { title: { text: 'Cumulative failures' }, gridcolor: '#e5e7eb' },
              margin: { t: 40, r: 20, b: 50, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
              legend: { x: 0.02, y: 0.98, font: { size: 10 } },
            } as Partial<Plotly.Layout>}
            config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
          />
        </div>
      )}
    />
  )
}

const GOF_DISTS = ['Weibull_2P', 'Normal_2P', 'Lognormal_2P', 'Exponential_1P', 'Gamma_2P', 'Gumbel_2P', 'Loglogistic_2P']

function GoF() {
  const [text, setText] = useState('')
  const [dist, setDist] = useState('Weibull_2P')
  const [test, setTest] = useState('chi_squared')
  const [ci, setCi] = useState('0.95')
  const [res, setRes] = useState<GoodnessOfFitResponse | null>(null)
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const run = async () => {
    const failures = text.split(/[\s,\n]+/).map(v => parseFloat(v)).filter(n => !isNaN(n))
    if (failures.length < 5) { setErr('Enter at least 5 failure times.'); return }
    setErr(null); setLoading(true)
    try { setRes(await goodnessOfFit({ failures, distribution: dist, test, CI: parseFloat(ci) })) }
    catch (e) { setErr(detail(e, 'Error.')) } finally { setLoading(false) }
  }
  return (
    <ToolLayout
      intro="Fits the chosen distribution and runs a chi-squared or Kolmogorov-Smirnov goodness-of-fit test."
      controls={<>
        <div>
          <label className={labelCls}>Failure times</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6} className={inputCls + ' resize-none'} placeholder="Comma or newline separated" />
        </div>
        <div>
          <InfoLabel tip="Distribution to fit and test against.">Distribution</InfoLabel>
          <select value={dist} onChange={e => setDist(e.target.value)} className={inputCls}>
            {GOF_DISTS.map(d => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <InfoLabel tip="Chi-squared bins the data; KS compares the empirical and fitted CDFs.">Test</InfoLabel>
          <select value={test} onChange={e => setTest(e.target.value)} className={inputCls}>
            <option value="chi_squared">Chi-squared</option><option value="ks">Kolmogorov-Smirnov</option>
          </select>
        </div>
        <div>
          <InfoLabel tip="Confidence level for the critical value.">Confidence</InfoLabel>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.9">90%</option><option value="0.95">95%</option><option value="0.99">99%</option>
          </select>
        </div>
      </>}
      err={err} loading={loading} onRun={run} runLabel="Run test"
      results={res && (
        <>
          <p className={`text-2xl font-bold mb-1 ${res.hypothesis === 'accept' ? 'text-green-600' : 'text-red-600'}`}>
            {res.hypothesis === 'accept' ? 'Fit adequate' : 'Fit rejected'}
          </p>
          <p className="text-xs text-gray-500 mb-3">{res.test} test · {res.distribution.replace(/_/g, ' ')}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Statistic" value={res.statistic.toFixed(4)} />
            <Card label="Critical value" value={res.critical_value.toFixed(4)} />
            <Card label="p-value" value={res.p_value.toExponential(3)} />
            {res.df != null && <Card label="Degrees of freedom" value={String(res.df)} />}
          </div>
        </>
      )}
    />
  )
}

// ─── Degradation (wear-to-failure) ───────────────────────────────────────────

interface DegRow { unit: string; time: string; meas: string }
const emptyDegRows = (): DegRow[] =>
  Array.from({ length: 5 }, () => ({ unit: '', time: '', meas: '' }))

interface DestRow { time: string; meas: string }
const emptyDestRows = (): DestRow[] =>
  Array.from({ length: 5 }, () => ({ time: '', meas: '' }))

const DEG_MODELS = [
  { v: 'linear', l: 'Linear  (y = a·x + b)' },
  { v: 'exponential', l: 'Exponential  (y = b·e^(a·x))' },
  { v: 'power', l: 'Power  (y = b·x^a)' },
  { v: 'logarithmic', l: 'Logarithmic  (y = a·ln(x) + b)' },
  { v: 'gompertz', l: 'Gompertz  (y = a·b^(c^x))' },
  { v: 'lloyd_lipow', l: 'Lloyd-Lipow  (y = a − b/x)' },
]
const PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1']

// Persisted degradation state (so it loads from / saves to projects, incl. the
// demo project). Computed results stay local (ephemeral) and are not stored.
interface NDState {
  rows: DegRow[]; threshold: string; direction: 'above' | 'below'
  model: string; dist: string; relTime: string; useIntervals: boolean; ci: string
  result?: DegradationResponse | null
}
interface DestState {
  rows: DestRow[]; threshold: string; direction: 'above' | 'below'
  model: string; dist: string; relTime: string
  result?: DestructiveDegradationResponse | null
}
interface DegModuleState { mode: 'nondestructive' | 'destructive'; nd: NDState; dest: DestState }

const INITIAL_DEG: DegModuleState = {
  mode: 'nondestructive',
  nd: { rows: emptyDegRows(), threshold: '30', direction: 'above', model: 'exponential', dist: 'Weibull_2P', relTime: '', useIntervals: false, ci: '0.90', result: null },
  dest: { rows: emptyDestRows(), threshold: '150', direction: 'below', model: 'linear', dist: 'Weibull', relTime: '5', result: null },
}

function Degradation() {
  const [s, setS] = useModuleState<DegModuleState>('degradation', INITIAL_DEG)
  const mode = s.mode
  const setMode = (v: 'nondestructive' | 'destructive') => setS(prev => ({ ...prev, mode: v }))
  return (
    <div className="flex flex-1 overflow-hidden flex-col">
      <div className="flex gap-2 px-4 pt-3 bg-white border-b border-gray-100">
        {([['nondestructive', 'Non-Destructive'], ['destructive', 'Destructive']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setMode(v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors ${
              mode === v ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{l}</button>
        ))}
      </div>
      {mode === 'nondestructive' ? <NonDestructiveDeg /> : <DestructiveDeg />}
    </div>
  )
}

function NonDestructiveDeg() {
  const [s, setS] = useModuleState<DegModuleState>('degradation', INITIAL_DEG)
  const nd = s.nd
  const patchND = (p: Partial<NDState>) => setS(prev => ({ ...prev, nd: { ...prev.nd, ...p } }))
  const { rows, threshold, direction, model, dist, relTime, useIntervals, ci } = nd
  const setRows = (v: DegRow[]) => patchND({ rows: v })
  const setThreshold = (v: string) => patchND({ threshold: v })
  const setDirection = (v: 'above' | 'below') => patchND({ direction: v })
  const setModel = (v: string) => patchND({ model: v })
  const setDist = (v: string) => patchND({ dist: v })
  const setRelTime = (v: string) => patchND({ relTime: v })
  const setUseIntervals = (v: boolean) => patchND({ useIntervals: v })
  const setCi = (v: string) => patchND({ ci: v })
  const res = nd.result ?? null
  const setRes = (v: DegradationResponse | null) => patchND({ result: v })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const update = (i: number, k: keyof DegRow, v: string) =>
    setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const addRow = () => setRows([...rows, { unit: '', time: '', meas: '' }])
  const delRow = (i: number) => setRows(rows.filter((_, j) => j !== i))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const valid = rows.filter(r => r.unit.trim() && r.time.trim() && r.meas.trim())
      const r = await degradationAnalysis({
        unit_ids: valid.map(v => v.unit.trim()),
        times: valid.map(v => parseFloat(v.time)),
        measurements: valid.map(v => parseFloat(v.meas)),
        threshold: parseFloat(threshold),
        threshold_direction: direction,
        degradation_model: model,
        life_distribution: dist,
        reliability_time: relTime.trim() ? parseFloat(relTime) : null,
        use_extrapolated_intervals: useIntervals,
        ci: parseFloat(ci),
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const pathTraces = res ? res.paths.flatMap((p, i) => {
    const c = PALETTE[i % PALETTE.length]
    const traces: Record<string, unknown>[] = [
      { x: p.t, y: p.m, mode: 'markers', name: p.unit_id, marker: { color: c, size: 6 }, legendgroup: p.unit_id },
    ]
    if (p.fit_t && p.fit_m) traces.push({
      x: p.fit_t, y: p.fit_m, mode: 'lines', name: `${p.unit_id} fit`,
      line: { color: c, width: 1.5, dash: 'dot' }, legendgroup: p.unit_id, showlegend: false,
    })
    return traces
  }) : []

  const controls = (
    <>
      <div>
        <InfoLabel tip="Repeated degradation measurements per unit. Each unit's path is fitted and extrapolated to the failure threshold, then the projected times are analysed as life data.">Measurement data</InfoLabel>
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="max-h-52 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-1 py-1 text-left font-medium text-gray-500">Unit</th>
                  <th className="px-1 py-1 text-left font-medium text-gray-500">Time</th>
                  <th className="px-1 py-1 text-left font-medium text-gray-500">Meas.</th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 group">
                    <td className="px-0.5 py-0.5"><input value={r.unit} onChange={e => update(i, 'unit', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="ID" /></td>
                    <td className="px-0.5 py-0.5"><input value={r.time} onChange={e => update(i, 'time', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="0" /></td>
                    <td className="px-0.5 py-0.5"><input value={r.meas} onChange={e => update(i, 'meas', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="0" /></td>
                    <td className="px-0.5 text-center"><button tabIndex={-1} onClick={() => delRow(i)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addRow} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-1 flex items-center justify-center gap-1 border-t border-gray-100"><Plus size={11} /> Add row</button>
        </div>
      </div>
      <Field label="Failure threshold" tip="Measurement value at which a unit is considered failed." value={threshold} onChange={setThreshold} />
      <div>
        <label className={labelCls}>Failure direction</label>
        <select value={direction} onChange={e => setDirection(e.target.value as 'above' | 'below')} className={inputCls}>
          <option value="above">Fails when above threshold</option>
          <option value="below">Fails when below threshold</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Degradation model</label>
        <select value={model} onChange={e => setModel(e.target.value)} className={inputCls}>
          {DEG_MODELS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Life distribution</label>
        <select value={dist} onChange={e => setDist(e.target.value)} className={inputCls}>
          <option value="Best_Fit">Best fit (auto-select)</option>
          <option value="Weibull_2P">Weibull (2P)</option>
          <option value="Weibull_3P">Weibull (3P)</option>
          <option value="Normal_2P">Normal</option>
          <option value="Lognormal_2P">Lognormal (2P)</option>
          <option value="Lognormal_3P">Lognormal (3P)</option>
          <option value="Exponential_1P">Exponential</option>
          <option value="Gumbel_2P">Gumbel</option>
          <option value="Gamma_2P">Gamma</option>
          <option value="Loglogistic_2P">Loglogistic</option>
        </select>
      </div>
      <Field label="Reliability time (optional)" tip="Compute R(t) and probability of failure at this time from the fitted life distribution." value={relTime} onChange={setRelTime} />
      <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
        <input type="checkbox" checked={useIntervals} onChange={e => setUseIntervals(e.target.checked)} />
        Use extrapolated intervals
      </label>
      {useIntervals && (
        <div>
          <label className={labelCls}>Confidence level</label>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.90">90%</option>
            <option value="0.95">95%</option>
            <option value="0.99">99%</option>
          </select>
        </div>
      )}
    </>
  )

  const results = res && (
    <div className="space-y-5">
      {res.distribution_fit && (
        <div className="grid grid-cols-4 gap-3">
          <Card label="Mean life" value={fmtNum(res.distribution_fit.summary.mean)} accent />
          <Card label="B50 (median)" value={fmtNum(res.distribution_fit.summary.B50)} />
          <Card label="B10 life" value={fmtNum(res.distribution_fit.summary.B10)} />
          {res.distribution_fit.reliability
            ? <Card label={`R(t=${fmtNum(res.distribution_fit.reliability.time)})`} value={res.distribution_fit.reliability.R.toFixed(4)} />
            : <Card label="Units" value={String(res.unit_table.length)} />}
        </div>
      )}
      {res.distribution_fit && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">
            Fitted life distribution: <span className="text-blue-700 font-mono">{res.distribution_fit.distribution}</span>
            {dist === 'Best_Fit' && <span className="text-gray-400 font-normal"> (auto-selected by AICc)</span>}
          </p>
          <table className="w-full text-xs border border-gray-200 rounded">
            <thead className="bg-gray-50"><tr>
              <th className="px-3 py-1.5 text-left font-medium text-gray-600">Distribution</th>
              {Object.keys(res.distribution_fit.params).map(k => (
                <th key={k} className="px-3 py-1.5 text-right font-medium text-gray-600">{k}</th>
              ))}
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">AICc</th>
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">BIC</th>
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">LogLik</th>
            </tr></thead>
            <tbody>
              <tr className="border-t border-gray-100">
                <td className="px-3 py-1 text-gray-700 font-mono">{res.distribution_fit.distribution}</td>
                {Object.values(res.distribution_fit.params).map((v, i) => (
                  <td key={i} className="px-3 py-1 text-right font-mono">{fmtNum(v)}</td>
                ))}
                <td className="px-3 py-1 text-right font-mono">{res.distribution_fit.gof?.AICc != null ? fmtNum(res.distribution_fit.gof.AICc) : '—'}</td>
                <td className="px-3 py-1 text-right font-mono">{res.distribution_fit.gof?.BIC != null ? fmtNum(res.distribution_fit.gof.BIC) : '—'}</td>
                <td className="px-3 py-1 text-right font-mono">{res.distribution_fit.gof?.LogLik != null ? fmtNum(res.distribution_fit.gof.LogLik) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {res.distribution_fit?.comparison && res.distribution_fit.comparison.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Distribution ranking (by AICc)</p>
          <table className="w-full text-xs border border-gray-200 rounded">
            <thead className="bg-gray-50"><tr>
              <th className="px-3 py-1.5 text-left font-medium text-gray-600">Rank</th>
              <th className="px-3 py-1.5 text-left font-medium text-gray-600">Distribution</th>
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">AICc</th>
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">BIC</th>
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">AD</th>
              <th className="px-3 py-1.5 text-right font-medium text-gray-600">LogLik</th>
            </tr></thead>
            <tbody>
              {res.distribution_fit.comparison.map((c, i) => (
                <tr key={c.distribution} className={`border-t border-gray-100 ${i === 0 ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-1 text-gray-500">{i + 1}</td>
                  <td className="px-3 py-1 text-gray-700 font-mono">{c.distribution}</td>
                  <td className="px-3 py-1 text-right font-mono">{c.AICc != null ? fmtNum(c.AICc) : '—'}</td>
                  <td className="px-3 py-1 text-right font-mono">{c.BIC != null ? fmtNum(c.BIC) : '—'}</td>
                  <td className="px-3 py-1 text-right font-mono">{c.AD != null ? fmtNum(c.AD) : '—'}</td>
                  <td className="px-3 py-1 text-right font-mono">{c.LogLik != null ? fmtNum(c.LogLik) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Degradation paths</p>
        <Plot
          data={[
            ...pathTraces,
            { x: [Math.min(...res.paths.flatMap(p => p.t)), Math.max(...res.paths.flatMap(p => [...p.t, ...(p.fit_t ?? [])]))],
              y: [res.threshold, res.threshold], mode: 'lines', name: 'Threshold',
              line: { color: '#9ca3af', width: 1.5, dash: 'dash' } },
          ] as Plotly.Data[]}
          layout={{ ...plotBase, height: 320, xaxis: { title: { text: 'Time' } }, yaxis: { title: { text: 'Measurement' } } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      {res.distribution_fit && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Projected failure-time distribution (CDF)</p>
          <Plot
            data={[{ x: res.distribution_fit.curve_x, y: res.distribution_fit.cdf, mode: 'lines', line: { color: '#3b82f6', width: 2 }, name: 'CDF' }] as Plotly.Data[]}
            layout={{ ...plotBase, height: 260, xaxis: { title: { text: 'Time to failure' } }, yaxis: { title: { text: 'Unreliability' }, range: [0, 1] } } as Plotly.Layout}
            config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Per-unit projections {res.use_extrapolated_intervals ? `(${Math.round(res.ci * 100)}% intervals)` : ''}</p>
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50"><tr>
            <th className="px-3 py-1.5 text-left font-medium text-gray-600">Unit</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">a</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">b</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">Projected</th>
            {res.use_extrapolated_intervals && <th className="px-3 py-1.5 text-right font-medium text-gray-600">Lower</th>}
            {res.use_extrapolated_intervals && <th className="px-3 py-1.5 text-right font-medium text-gray-600">Upper</th>}
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">R²</th>
          </tr></thead>
          <tbody>
            {res.unit_table.map(u => (
              <tr key={u.unit_id} className="border-t border-gray-100">
                <td className="px-3 py-1 text-gray-700">{u.unit_id}</td>
                <td className="px-3 py-1 text-right font-mono">{u.a != null ? u.a.toPrecision(4) : '—'}</td>
                <td className="px-3 py-1 text-right font-mono">{u.b != null ? u.b.toPrecision(4) : '—'}</td>
                <td className="px-3 py-1 text-right font-mono">{u.projected_failure != null ? fmtNum(u.projected_failure) : '—'}</td>
                {res.use_extrapolated_intervals && <td className="px-3 py-1 text-right font-mono">{u.lower != null ? fmtNum(u.lower) : '—'}</td>}
                {res.use_extrapolated_intervals && <td className="px-3 py-1 text-right font-mono">{u.upper != null ? fmtNum(u.upper) : '—'}</td>}
                <td className="px-3 py-1 text-right font-mono">{u.r2 != null ? u.r2.toFixed(4) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return <ToolLayout intro="Non-destructive degradation: each unit is measured repeatedly over time. Its degradation path is fitted and extrapolated to the failure threshold, then the projected times-to-failure are analysed as life data." controls={controls} err={err} loading={loading} onRun={run} runLabel="Analyze" results={results} />
}

// ─── Destructive degradation ─────────────────────────────────────────────────

function DestructiveDeg() {
  const [s, setS] = useModuleState<DegModuleState>('degradation', INITIAL_DEG)
  const dest = s.dest
  const patchDest = (p: Partial<DestState>) => setS(prev => ({ ...prev, dest: { ...prev.dest, ...p } }))
  const { rows, threshold, direction, model, dist, relTime } = dest
  const setRows = (v: DestRow[]) => patchDest({ rows: v })
  const setThreshold = (v: string) => patchDest({ threshold: v })
  const setDirection = (v: 'above' | 'below') => patchDest({ direction: v })
  const setModel = (v: string) => patchDest({ model: v })
  const setDist = (v: string) => patchDest({ dist: v })
  const setRelTime = (v: string) => patchDest({ relTime: v })
  const res = dest.result ?? null
  const setRes = (v: DestructiveDegradationResponse | null) => patchDest({ result: v })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const update = (i: number, k: keyof DestRow, v: string) =>
    setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const addRow = () => setRows([...rows, { time: '', meas: '' }])
  const delRow = (i: number) => setRows(rows.filter((_, j) => j !== i))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const valid = rows.filter(r => r.time.trim() && r.meas.trim())
      const r = await destructiveDegradationAnalysis({
        times: valid.map(v => parseFloat(v.time)),
        measurements: valid.map(v => parseFloat(v.meas)),
        threshold: parseFloat(threshold),
        threshold_direction: direction,
        degradation_model: model,
        measurement_distribution: dist,
        reliability_time: relTime.trim() ? parseFloat(relTime) : null,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div>
        <InfoLabel tip="One destructive measurement per sample per time. The measurement distribution's location parameter changes with time (MLE), and reliability is the probability of staying on the safe side of the critical level.">Measurement data (time, value)</InfoLabel>
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="max-h-52 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-1 py-1 text-left font-medium text-gray-500">Time</th>
                  <th className="px-1 py-1 text-left font-medium text-gray-500">Measurement</th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 group">
                    <td className="px-0.5 py-0.5"><input value={r.time} onChange={e => update(i, 'time', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="0" /></td>
                    <td className="px-0.5 py-0.5"><input value={r.meas} onChange={e => update(i, 'meas', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" placeholder="0" /></td>
                    <td className="px-0.5 text-center"><button tabIndex={-1} onClick={() => delRow(i)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addRow} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-1 flex items-center justify-center gap-1 border-t border-gray-100"><Plus size={11} /> Add row</button>
        </div>
      </div>
      <div>
        <label className={labelCls}>Measurement distribution</label>
        <select value={dist} onChange={e => setDist(e.target.value)} className={inputCls}>
          <option value="Weibull">Weibull</option>
          <option value="Exponential">Exponential</option>
          <option value="Normal">Normal</option>
          <option value="Lognormal">Lognormal</option>
          <option value="Gumbel">Gumbel</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Degradation model</label>
        <select value={model} onChange={e => setModel(e.target.value)} className={inputCls}>
          <option value="linear">Linear</option>
          <option value="exponential">Exponential</option>
          <option value="power">Power</option>
          <option value="logarithm">Logarithm</option>
          <option value="lloyd_lipow">Lloyd-Lipow</option>
        </select>
      </div>
      <Field label="Critical degradation" tip="Degradation level at which the product is considered failed." value={threshold} onChange={setThreshold} />
      <div>
        <label className={labelCls}>Failure direction</label>
        <select value={direction} onChange={e => setDirection(e.target.value as 'above' | 'below')} className={inputCls}>
          <option value="above">Fails when above critical</option>
          <option value="below">Fails when below critical</option>
        </select>
      </div>
      <Field label="Reliability time" tip="Compute R(t) and probability of failure at this time." value={relTime} onChange={setRelTime} />
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {res.reliability && <Card label={`R(t=${fmtNum(res.reliability.time)})`} value={res.reliability.R.toFixed(4)} accent />}
        {res.reliability && <Card label={`Prob. of failure`} value={res.reliability.F.toFixed(4)} />}
        {res.shape != null && <Card label={res.shape_label ?? 'shape'} value={fmtNum(res.shape)} />}
        <Card label="Log-likelihood" value={fmtNum(res.loglik)} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Degradation vs time (median path + critical level)</p>
        <Plot
          data={[
            { x: res.scatter.t, y: res.scatter.y, mode: 'markers', name: 'Measurements', marker: { color: '#3b82f6', size: 5, opacity: 0.6 } },
            { x: res.degradation_curve.t, y: res.degradation_curve.median, mode: 'lines', name: 'Median path', line: { color: '#10b981', width: 2 } },
            { x: [Math.min(...res.scatter.t), Math.max(...res.degradation_curve.t)], y: [res.threshold, res.threshold], mode: 'lines', name: 'Critical level', line: { color: '#ef4444', width: 1.5, dash: 'dash' } },
          ] as Plotly.Data[]}
          layout={{ ...plotBase, height: 320, xaxis: { title: { text: 'Time' } }, yaxis: { title: { text: 'Measurement' } } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Reliability vs time</p>
        <Plot
          data={[{ x: res.reliability_curve.t, y: res.reliability_curve.R, mode: 'lines', line: { color: '#3b82f6', width: 2 }, name: 'R(t)' }] as Plotly.Data[]}
          layout={{ ...plotBase, height: 260, xaxis: { title: { text: 'Time' } }, yaxis: { title: { text: 'Reliability' }, range: [0, 1] } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <div className="text-xs text-gray-600 border border-gray-200 rounded p-3">
        <p className="font-semibold text-gray-700 mb-1">Fitted model</p>
        <p>{res.measurement_distribution} measurement distribution · {res.degradation_model} location model</p>
        <p className="font-mono mt-1">{Object.entries(res.model_params).map(([k, v]) => `${k}=${v.toPrecision(5)}`).join('   ')}{res.shape != null ? `   ${res.shape_label}=${res.shape.toPrecision(5)}` : ''}</p>
      </div>
    </div>
  )

  return <ToolLayout intro="Destructive degradation: each sample yields a single measurement (the unit is consumed). The measurement distribution's location parameter is modelled as a function of time by MLE, and reliability is the probability of remaining on the safe side of the critical level." controls={controls} err={err} loading={loading} onRun={run} runLabel="Analyze" results={results} />
}

// ─── ESS (Environmental Stress Screening) ────────────────────────────────────

function ESS() {
  const [defectRate, setDefectRate] = useState('0.05')
  const [target, setTarget] = useState('0.9')
  const [type, setType] = useState<'thermal' | 'vibration' | 'combined'>('thermal')
  const [tempRange, setTempRange] = useState('80')
  const [cycles, setCycles] = useState('10')
  const [grms, setGrms] = useState('6')
  const [vibDur, setVibDur] = useState('10')
  const [res, setRes] = useState<ESSResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await essAnalysis({
        defect_rate: parseFloat(defectRate),
        target_screening_strength: parseFloat(target),
        screening_type: type,
        temp_range: type !== 'vibration' ? parseFloat(tempRange) : null,
        num_cycles: type !== 'vibration' ? parseInt(cycles, 10) : null,
        grms: type !== 'thermal' ? parseFloat(grms) : null,
        vib_duration: type !== 'thermal' ? parseFloat(vibDur) : null,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Field label="Incoming defect rate" tip="Fraction of units arriving with latent defects (0-1)." value={defectRate} onChange={setDefectRate} />
      <Field label="Target screening strength" tip="Desired fraction of latent defects precipitated (0-1)." value={target} onChange={setTarget} />
      <div>
        <label className={labelCls}>Screening type</label>
        <select value={type} onChange={e => setType(e.target.value as typeof type)} className={inputCls}>
          <option value="thermal">Thermal cycling</option>
          <option value="vibration">Random vibration</option>
          <option value="combined">Combined</option>
        </select>
      </div>
      {type !== 'vibration' && <>
        <Field label="Temperature range ΔT (°C)" value={tempRange} onChange={setTempRange} />
        <Field label="Number of cycles" value={cycles} onChange={setCycles} />
      </>}
      {type !== 'thermal' && <>
        <Field label="Vibration level (gRMS)" value={grms} onChange={setGrms} />
        <Field label="Vibration duration (min)" value={vibDur} onChange={setVibDur} />
      </>}
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Screening strength" value={`${(res.screening_strength * 100).toFixed(1)}%`} accent />
        <Card label={`Required ${res.required_label.toLowerCase()}`} value={res.required != null ? fmtNum(res.required) : '—'} />
        <Card label="Residual defect fraction" value={res.residual_defect_fraction.toExponential(2)} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Screening strength vs {res.curve.x_label.toLowerCase()}</p>
        <Plot
          data={[
            { x: res.curve.x, y: res.curve.y, mode: 'lines', line: { color: '#3b82f6', width: 2 }, name: 'Screening strength' },
            { x: [res.curve.x[0], res.curve.x[res.curve.x.length - 1]], y: [res.curve.target, res.curve.target], mode: 'lines', line: { color: '#ef4444', width: 1.5, dash: 'dash' }, name: 'Target' },
          ] as Plotly.Data[]}
          layout={{ ...plotBase, height: 320, xaxis: { title: { text: res.curve.x_label } }, yaxis: { title: { text: 'Screening strength' }, range: [0, 1] } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <p className="text-xs text-gray-500">Detected defect fraction: {res.detected_defect_fraction.toExponential(3)} of incoming population.</p>
    </div>
  )

  return <ToolLayout intro="Develop an Environmental Stress Screening (ESS) profile that precipitates latent manufacturing defects. Uses standard thermal-cycling and random-vibration screening-strength models." controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute profile" results={results} />
}

// ─── HASS (Highly Accelerated Stress Screening) ──────────────────────────────

function HASS() {
  const [opLow, setOpLow] = useState('-40')
  const [opHigh, setOpHigh] = useState('85')
  const [dsLow, setDsLow] = useState('-60')
  const [dsHigh, setDsHigh] = useState('120')
  const [opVib, setOpVib] = useState('10')
  const [dsVib, setDsVib] = useState('30')
  const [precip, setPrecip] = useState('0.9')
  const [detDur, setDetDur] = useState('24')
  const [mtbf, setMtbf] = useState('5000')
  const [res, setRes] = useState<HASSResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await hassAnalysis({
        op_temp_low: parseFloat(opLow), op_temp_high: parseFloat(opHigh),
        destruct_temp_low: parseFloat(dsLow), destruct_temp_high: parseFloat(dsHigh),
        op_vib: parseFloat(opVib), destruct_vib: parseFloat(dsVib),
        target_precip_ss: parseFloat(precip), detection_duration: parseFloat(detDur),
        use_mtbf: parseFloat(mtbf),
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Operating limits (HALT)</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Temp low (°C)" value={opLow} onChange={setOpLow} />
        <Field label="Temp high (°C)" value={opHigh} onChange={setOpHigh} />
      </div>
      <Field label="Vibration (gRMS)" value={opVib} onChange={setOpVib} />
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Destruct limits (HALT)</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Temp low (°C)" value={dsLow} onChange={setDsLow} />
        <Field label="Temp high (°C)" value={dsHigh} onChange={setDsHigh} />
      </div>
      <Field label="Vibration (gRMS)" value={dsVib} onChange={setDsVib} />
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Screen targets</p>
      <Field label="Precipitation strength" tip="Target fraction of defects precipitated by the precipitation screen." value={precip} onChange={setPrecip} />
      <Field label="Detection duration (h)" value={detDur} onChange={setDetDur} />
      <Field label="Use-condition MTBF (h)" value={mtbf} onChange={setMtbf} />
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Precip. cycles" value={res.precipitation_screen.required_cycles != null ? fmtNum(res.precipitation_screen.required_cycles) : '—'} accent />
        <Card label="Precip. strength" value={`${(res.precipitation_screen.screening_strength * 100).toFixed(1)}%`} />
        <Card label="P(detect)" value={`${(res.detection_screen.probability_of_detection * 100).toFixed(2)}%`} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Stress level diagram (temperature)</p>
        <Plot
          data={[
            { x: ['Destruct', 'Precipitation', 'Operating', 'Operating', 'Precipitation', 'Destruct'],
              y: [res.stress_levels.destruct[1], res.stress_levels.precipitation[1], res.stress_levels.operating[1],
                  res.stress_levels.operating[0], res.stress_levels.precipitation[0], res.stress_levels.destruct[0]],
              type: 'bar', marker: { color: ['#fca5a5', '#fdba74', '#86efac', '#86efac', '#fdba74', '#fca5a5'] }, name: 'Temp (°C)' },
          ] as Plotly.Data[]}
          layout={{ ...plotBase, height: 300, yaxis: { title: { text: 'Temperature (°C)' } } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="border border-gray-200 rounded p-3">
          <p className="font-semibold text-gray-700 mb-1">Precipitation screen</p>
          <p>ΔT: {res.precipitation_screen.delta_t} °C ({res.precipitation_screen.temp_low} to {res.precipitation_screen.temp_high})</p>
          <p>Vibration: {res.precipitation_screen.vibration} gRMS</p>
        </div>
        <div className="border border-gray-200 rounded p-3">
          <p className="font-semibold text-gray-700 mb-1">Detection screen</p>
          <p>ΔT: {res.detection_screen.delta_t} °C ({res.detection_screen.temp_low} to {res.detection_screen.temp_high})</p>
          <p>Duration: {res.detection_screen.duration} h</p>
        </div>
      </div>
    </div>
  )

  return <ToolLayout intro="Design a Highly Accelerated Stress Screen (HASS) using product operating and destruct limits from HALT. Generates a precipitation screen (defect generation) and a detection screen (fault detection)." controls={controls} err={err} loading={loading} onRun={run} runLabel="Design screen" results={results} />
}

// ─── Burn-In design ──────────────────────────────────────────────────────────

function BurnIn() {
  const [duration, setDuration] = useState('48')
  const [beta, setBeta] = useState('0.5')
  const [eta, setEta] = useState('10000')
  const [units, setUnits] = useState('100')
  const [af, setAf] = useState('1')
  const [res, setRes] = useState<BurnInResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await burnInAnalysis({
        duration: parseFloat(duration), beta: parseFloat(beta), eta: parseFloat(eta),
        n_units: parseInt(units, 10), acceleration_factor: parseFloat(af),
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Field label="Burn-in duration (h)" value={duration} onChange={setDuration} />
      <Field label="Weibull shape β" tip="Infant-mortality period has β < 1." value={beta} onChange={setBeta} />
      <Field label="Characteristic life η (h)" value={eta} onChange={setEta} />
      <Field label="Number of units" value={units} onChange={setUnits} />
      <Field label="Acceleration factor" tip="Stress acceleration during burn-in vs use conditions." value={af} onChange={setAf} />
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Expected failures" value={fmtNum(res.expected_failures)} accent />
        <Card label="Survival probability" value={`${(res.survival_probability * 100).toFixed(2)}%`} />
        <Card label="Post burn-in MTBF" value={fmtNum(res.post_burn_in_mtbf)} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Reliability: before vs after burn-in</p>
        <Plot
          data={[
            { x: res.reliability_plot.time, y: res.reliability_plot.before, mode: 'lines', line: { color: '#9ca3af', width: 1.5, dash: 'dash' }, name: 'Before' },
            { x: res.reliability_plot.time, y: res.reliability_plot.after, mode: 'lines', line: { color: '#3b82f6', width: 2 }, name: 'After burn-in' },
          ] as Plotly.Data[]}
          layout={{ ...plotBase, height: 300, xaxis: { title: { text: 'Time (h)' } }, yaxis: { title: { text: 'Reliability' }, range: [0, 1] } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Hazard rate: before vs after burn-in</p>
        <Plot
          data={[
            { x: res.hazard_plot.time, y: res.hazard_plot.before, mode: 'lines', line: { color: '#9ca3af', width: 1.5, dash: 'dash' }, name: 'Before' },
            { x: res.hazard_plot.time, y: res.hazard_plot.after, mode: 'lines', line: { color: '#ef4444', width: 2 }, name: 'After burn-in' },
          ] as Plotly.Data[]}
          layout={{ ...plotBase, height: 260, xaxis: { title: { text: 'Time (h)' } }, yaxis: { title: { text: 'Hazard rate' } } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
    </div>
  )

  return <ToolLayout intro="Design a burn-in test to remove infant-mortality failures (Weibull β < 1). Shows expected fallout, survival probability, and the reduced hazard rate of the surviving population." controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}

// Tool components are exported individually and composed into the module's
// top-level tabs by ALT/index.tsx.
export {
  Planner, Duration, NoFailures, OneProportion, TwoProportion,
  Sequential, GoF, Degradation, ESS, HASS, BurnIn,
}
