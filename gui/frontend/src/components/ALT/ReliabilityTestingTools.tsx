import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Play } from 'lucide-react'
import {
  oneSampleProportion, twoProportionTest, sampleSizeNoFailures,
  sequentialSampling, SequentialSamplingResponse,
  testPlanner, testDuration, goodnessOfFit, GoodnessOfFitResponse,
} from '../../api/client'
import InfoLabel from '../shared/InfoLabel'

const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400'
const labelCls = 'block text-xs font-medium text-gray-700 mb-1'
const btnCls = 'flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors'

function detail(e: unknown, fb: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fb
}
function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
function Field({ label, tip, value, onChange, type = 'number' }: {
  label: string; tip?: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      {tip ? <InfoLabel tip={tip}>{label}</InfoLabel> : <label className={labelCls}>{label}</label>}
      <input type={type} step="any" value={value} onChange={e => onChange(e.target.value)} className={inputCls} />
    </div>
  )
}

const RT_TOOLS = [
  { id: 'planner', label: 'Test Planner' },
  { id: 'duration', label: 'Test Duration' },
  { id: 'no-failures', label: 'Zero-Failure Sample Size' },
  { id: 'one-proportion', label: 'One-Sample Proportion' },
  { id: 'two-proportion', label: 'Two-Proportion Test' },
  { id: 'sequential', label: 'Sequential Sampling' },
  { id: 'gof', label: 'Goodness of Fit' },
] as const
type RTTool = typeof RT_TOOLS[number]['id']

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
        <div className="grid grid-cols-3 gap-3">
          <Card label="MTBF" value={res.MTBF.toFixed(2)} accent={solveFor === 'MTBF'} />
          <Card label="Test duration" value={res.test_duration.toFixed(1)} accent={solveFor === 'test_duration'} />
          <Card label="Allowable failures" value={String(res.number_of_failures)} accent={solveFor === 'number_of_failures'} />
        </div>
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

// ─── Shared layout ───────────────────────────────────────────────────────────

function ToolLayout({ intro, controls, err, loading, onRun, runLabel, results }: {
  intro: string; controls: React.ReactNode; err: string | null; loading: boolean
  onRun: () => void; runLabel: string; results: React.ReactNode
}) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-500 leading-snug">{intro}</p>
        {controls}
        {err && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{err}</p>}
        <button onClick={onRun} disabled={loading} className={btnCls}><Play size={12} /> {loading ? 'Working...' : runLabel}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {results ?? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Enter inputs and click {runLabel}.
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReliabilityTestingTools() {
  const [tool, setTool] = useState<RTTool>('planner')
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-stretch gap-1 bg-gray-50 border-b border-gray-200 px-3 overflow-x-auto">
        {RT_TOOLS.map(t => (
          <button key={t.id} onClick={() => setTool(t.id)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              tool === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>
      {tool === 'planner' && <Planner />}
      {tool === 'duration' && <Duration />}
      {tool === 'no-failures' && <NoFailures />}
      {tool === 'one-proportion' && <OneProportion />}
      {tool === 'two-proportion' && <TwoProportion />}
      {tool === 'sequential' && <Sequential />}
      {tool === 'gof' && <GoF />}
    </div>
  )
}
