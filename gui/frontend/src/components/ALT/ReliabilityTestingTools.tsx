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
import { useHelpTopic } from '../help/context'
import ConfidenceInput from '../shared/ConfidenceInput'
import { useModuleState } from '../../store/project'
import {
  inputCls, labelCls, detail, Card, Field, fmtNum, ToolLayout, PLOT_CFG, plotBase,
} from './toolkit'
import { useTestingToolState } from './reliabilityTestingState'

interface PlannerState {
  solveFor: 'MTBF' | 'test_duration' | 'number_of_failures'
  mtbf: string
  duration: string
  failures: string
  confidence: string
  result: { MTBF: number; test_duration: number; number_of_failures: number } | null
  trueMtbf: string
  passResult: PassProbResponse | null
}

const INITIAL_PLANNER: PlannerState = {
  solveFor: 'MTBF', mtbf: '500', duration: '10000', failures: '5',
  confidence: '0.95', result: null, trueMtbf: '1000', passResult: null,
}

interface DurationState {
  requiredMtbf: string
  designMtbf: string
  consumerRisk: string
  producerRisk: string
  result: { test_duration: number; number_of_failures: number } | null
}

const INITIAL_DURATION: DurationState = {
  requiredMtbf: '100', designMtbf: '200', consumerRisk: '0.1',
  producerRisk: '0.1', result: null,
}

interface NoFailuresState {
  reliability: string
  confidence: string
  lifetimes: string
  shape: string
  result: { n: number } | null
}

const INITIAL_NO_FAILURES: NoFailuresState = {
  reliability: '0.9', confidence: '0.95', lifetimes: '1', shape: '1',
  result: null,
}

interface OneProportionState {
  trials: string
  successes: string
  confidence: string
  result: { proportion: number; lower: number; upper: number } | null
}

const INITIAL_ONE_PROPORTION: OneProportionState = {
  trials: '20', successes: '20', confidence: '0.95', result: null,
}

interface TwoProportionState {
  trials1: string
  successes1: string
  trials2: string
  successes2: string
  confidence: string
  result: {
    p1: number
    p2: number
    difference: number
    z: number | null
    p_value: number
    method: 'fisher-exact' | 'pooled-z'
    different: boolean
  } | null
}

const INITIAL_TWO_PROPORTION: TwoProportionState = {
  trials1: '100', successes1: '90', trials2: '100', successes2: '60',
  confidence: '0.95', result: null,
}

interface SequentialState {
  p1: string
  p2: string
  alpha: string
  beta: string
  result: SequentialSamplingResponse | null
}

const INITIAL_SEQUENTIAL: SequentialState = {
  p1: '0.01', p2: '0.10', alpha: '0.05', beta: '0.10', result: null,
}

interface GoodnessOfFitState {
  text: string
  distribution: string
  test: string
  confidence: string
  bootstrapSamples: string
  result: GoodnessOfFitResponse | null
}

const INITIAL_GOODNESS_OF_FIT: GoodnessOfFitState = {
  text: '', distribution: 'Weibull_2P', test: 'chi_squared',
  confidence: '0.95', bootstrapSamples: '200', result: null,
}

// ─── Exponential test planner ────────────────────────────────────────────────

function Planner() {
  const [state, patchState] = useTestingToolState('exponentialPlanner', INITIAL_PLANNER)
  const {
    solveFor, mtbf, duration: dur, failures: fails, confidence: ci,
    result: res, trueMtbf: mtbfTrue, passResult: passRes,
  } = state
  const setSolveFor = (value: PlannerState['solveFor']) => patchState({ solveFor: value })
  const setMtbf = (value: string) => patchState({ mtbf: value })
  const setDur = (value: string) => patchState({ duration: value })
  const setFails = (value: string) => patchState({ failures: value })
  const setCi = (value: string) => patchState({ confidence: value })
  const setRes = (value: PlannerState['result']) => patchState({ result: value })
  const setMtbfTrue = (value: string) => patchState({ trueMtbf: value })
  const setPassRes = (value: PassProbResponse | null) => patchState({ passResult: value })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
          <InfoLabel tip="Confidence level for the MTBF lower bound; 0.95 = 95%.">Confidence</InfoLabel>
          <ConfidenceInput value={ci} onChange={setCi} className="w-full" />
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
                type="number" min="0" step="1" value={mtbfTrue}
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
  const [state, patchState] = useTestingToolState('testDuration', INITIAL_DURATION)
  const {
    requiredMtbf: req, designMtbf: des, consumerRisk: cr, producerRisk: pr,
    result: res,
  } = state
  const setReq = (value: string) => patchState({ requiredMtbf: value })
  const setDes = (value: string) => patchState({ designMtbf: value })
  const setCr = (value: string) => patchState({ consumerRisk: value })
  const setPr = (value: string) => patchState({ producerRisk: value })
  const setRes = (value: DurationState['result']) => patchState({ result: value })
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
  const [state, patchState] = useTestingToolState(
    'zeroFailureSampleSize', INITIAL_NO_FAILURES)
  const {
    reliability: R, confidence: ci, lifetimes: lt, shape, result: res,
  } = state
  const setR = (value: string) => patchState({ reliability: value })
  const setCi = (value: string) => patchState({ confidence: value })
  const setLt = (value: string) => patchState({ lifetimes: value })
  const setShape = (value: string) => patchState({ shape: value })
  const setRes = (value: NoFailuresState['result']) => patchState({ result: value })
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
          <InfoLabel tip="Confidence level; 0.95 = 95%.">Confidence</InfoLabel>
          <ConfidenceInput value={ci} onChange={setCi} className="w-full" />
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
  const [state, patchState] = useTestingToolState('oneProportion', INITIAL_ONE_PROPORTION)
  const { trials, successes: succ, confidence: ci, result: res } = state
  const setTrials = (value: string) => patchState({ trials: value })
  const setSucc = (value: string) => patchState({ successes: value })
  const setCi = (value: string) => patchState({ confidence: value })
  const setRes = (value: OneProportionState['result']) => patchState({ result: value })
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
          <InfoLabel tip="Confidence level for the interval; 0.95 = 95%.">Confidence</InfoLabel>
          <ConfidenceInput value={ci} onChange={setCi} className="w-full" />
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
  const [state, patchState] = useTestingToolState('twoProportion', INITIAL_TWO_PROPORTION)
  const {
    trials1: t1, successes1: s1, trials2: t2, successes2: s2,
    confidence: ci, result: res,
  } = state
  const setT1 = (value: string) => patchState({ trials1: value })
  const setS1 = (value: string) => patchState({ successes1: value })
  const setT2 = (value: string) => patchState({ trials2: value })
  const setS2 = (value: string) => patchState({ successes2: value })
  const setCi = (value: string) => patchState({ confidence: value })
  const setRes = (value: TwoProportionState['result']) => patchState({ result: value })
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
          <InfoLabel tip="Significance is 1 − CI; 0.95 = 95%.">Confidence</InfoLabel>
          <ConfidenceInput value={ci} onChange={setCi} className="w-full" />
        </div>
      </>}
      err={err} loading={loading} onRun={run} runLabel="Compare"
      results={res && (
        <>
          <p className={`text-2xl font-bold mb-3 ${res.different ? 'text-red-600' : 'text-green-600'}`}>
            {res.different ? 'Significantly different' : 'Not significantly different'}
          </p>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <Card label="p₁" value={res.p1.toFixed(4)} />
            <Card label="p₂" value={res.p2.toFixed(4)} />
            <Card label="Difference" value={res.difference.toFixed(4)} />
            <Card label={res.method === 'fisher-exact' ? 'Method' : 'z statistic'} value={res.method === 'fisher-exact' ? 'Fisher exact' : res.z!.toFixed(4)} />
            <Card label="p-value" value={res.p_value.toExponential(3)} />
          </div>
        </>
      )}
    />
  )
}

function Sequential() {
  const [state, patchState] = useTestingToolState(
    'sequentialSampling', INITIAL_SEQUENTIAL)
  const { p1, p2, alpha, beta, result: res } = state
  const setP1 = (value: string) => patchState({ p1: value })
  const setP2 = (value: string) => patchState({ p2: value })
  const setAlpha = (value: string) => patchState({ alpha: value })
  const setBeta = (value: string) => patchState({ beta: value })
  const setRes = (value: SequentialSamplingResponse | null) => patchState({ result: value })
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
  const [state, patchState] = useTestingToolState(
    'goodnessOfFit', INITIAL_GOODNESS_OF_FIT)
  const {
    text, distribution: dist, test, confidence: ci,
    bootstrapSamples: bootstrapN, result: res,
  } = state
  const setText = (value: string) => patchState({ text: value })
  const setDist = (value: string) => patchState({ distribution: value })
  const setTest = (value: string) => patchState({ test: value })
  const setCi = (value: string) => patchState({ confidence: value })
  const setBootstrapN = (value: string) => patchState({ bootstrapSamples: value })
  const setRes = (value: GoodnessOfFitResponse | null) => patchState({ result: value })
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const run = async () => {
    const failures = text.split(/[\s,\n]+/).map(v => parseFloat(v)).filter(n => !isNaN(n))
    if (failures.length < 5) { setErr('Enter at least 5 failure times.'); return }
    const nBootstrap = parseInt(bootstrapN, 10)
    if (!Number.isInteger(nBootstrap) || nBootstrap < 50) { setErr('Bootstrap replicates must be at least 50.'); return }
    setErr(null); setLoading(true)
    try { setRes(await goodnessOfFit({ failures, distribution: dist, test, CI: parseFloat(ci), n_bootstrap: nBootstrap, seed: 1729 })) }
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
          <InfoLabel tip="Each replicate is generated from the fitted model, refitted, and retested. More replicates reduce Monte Carlo error in the p-value.">Bootstrap replicates</InfoLabel>
          <input type="number" value={bootstrapN} min={50} step={50}
            onChange={e => setBootstrapN(e.target.value)} className={inputCls} />
        </div>
        <div>
          <InfoLabel tip="Chi-squared bins the data; KS compares the empirical and fitted CDFs.">Test</InfoLabel>
          <select value={test} onChange={e => setTest(e.target.value)} className={inputCls}>
            <option value="chi_squared">Chi-squared</option><option value="ks">Kolmogorov-Smirnov</option>
          </select>
        </div>
        <div>
          <InfoLabel tip="Confidence level for the critical value; 0.95 = 95%.">Confidence</InfoLabel>
          <ConfidenceInput value={ci} onChange={setCi} className="w-full" />
        </div>
      </>}
      err={err} loading={loading} onRun={run} runLabel="Run test"
      results={res && (
        <>
          <p className={`text-2xl font-bold mb-1 ${res.hypothesis === 'accept' ? 'text-green-600' : 'text-red-600'}`}>
            {res.hypothesis === 'accept' ? 'Fit adequate' : 'Fit rejected'}
          </p>
          <p className="text-xs text-gray-500 mb-3">{res.test} test · {res.distribution.replace(/_/g, ' ')}</p>
          <p className="text-xs text-gray-600 mb-3">{res.null_hypothesis}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Statistic" value={res.statistic.toFixed(4)} />
            <Card label="Critical value" value={res.critical_value.toFixed(4)} />
            <Card label="p-value" value={res.p_value.toExponential(3)} />
            {res.df != null && <Card label="Degrees of freedom" value={String(res.df)} />}
          </div>
          <p className="text-[11px] text-gray-500 mt-3">
            Parametric bootstrap with refitting: {res.successful_bootstrap_refits}/{res.n_bootstrap} successful replicates.
            {res.bins_merged && ` Sparse bins merged to ${res.bins} bins (minimum expected ${res.minimum_expected_count?.toFixed(1)}).`}
          </p>
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
const DEG_MODEL_GUIDANCE: Record<string, { useWhen: string; check: string }> = {
  linear: {
    useWhen: 'Use when degradation changes by an approximately constant absolute amount per unit time.',
    check: 'Plot measurement versus time: the path should be roughly straight with pattern-free residuals. It is the safest choice when observations include time zero.',
  },
  exponential: {
    useWhen: 'Use for a roughly constant percentage rate of change, common for multiplicative growth or decay.',
    check: 'Measurements should be positive and log(measurement) versus time should be approximately linear. Long extrapolations can grow or decay very quickly.',
  },
  power: {
    useWhen: 'Use for monotonic curvature whose rate accelerates or decelerates with elapsed time.',
    check: 'Time and measurements should be positive; a log-log plot should be approximately linear. Avoid time zero and inspect leverage from the earliest observations.',
  },
  logarithmic: {
    useWhen: 'Use for rapid early change followed by a steadily diminishing rate.',
    check: 'Requires positive times. Confirm measurement versus log(time) is approximately linear and avoid extrapolating toward time zero.',
  },
  gompertz: {
    useWhen: 'Use for a sigmoidal path that approaches an asymptote, with slow–fast–slow degradation phases.',
    check: 'Use only when data cover enough of the bend to identify the asymptote and inflection; otherwise the extrapolated threshold time can be unstable.',
  },
  lloyd_lipow: {
    useWhen: 'Use for a path that is linear in 1/time and approaches an asymptote.',
    check: 'Requires strictly positive times and is highly sensitive near zero. Confirm measurement versus 1/time is approximately linear.',
  },
}

function DegradationModelGuidance({ model }: { model: string }) {
  const guide = DEG_MODEL_GUIDANCE[model === 'logarithm' ? 'logarithmic' : model]
  if (!guide) return null
  return (
    <div className="mt-1.5 rounded border border-blue-100 bg-blue-50/60 px-2 py-1.5 text-[10px] leading-relaxed text-blue-900">
      <p>{guide.useWhen}</p>
      <p className="mt-0.5 text-blue-700"><span className="font-semibold">Check:</span> {guide.check}</p>
    </div>
  )
}
const PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1']

// Persisted degradation state (including computed results) so switching tools
// or leaving the module does not discard an analysis.
interface NDState {
  rows: DegRow[]; threshold: string; direction: 'above' | 'below'
  model: string; dist: string; relTime: string; ci: string
  analysisMethod: 'per_unit_delta' | 'hierarchical_nlme'
  nMonteCarlo: string; nBootstrap: string; seed: string
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
  nd: {
    rows: emptyDegRows(), threshold: '30', direction: 'above', model: 'exponential',
    dist: 'Weibull_2P', relTime: '', ci: '0.95', analysisMethod: 'per_unit_delta',
    nMonteCarlo: '10000', nBootstrap: '200', seed: '1729', result: null,
  },
  dest: { rows: emptyDestRows(), threshold: '150', direction: 'below', model: 'linear', dist: 'Best_Fit', relTime: '5', result: null },
}

function Degradation() {
  const [s, setS] = useModuleState<DegModuleState>('degradation', INITIAL_DEG)
  const mode = s.mode
  useHelpTopic(`alt.degradation-${mode}`, 10)
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
  const { rows, threshold, direction, model, dist, relTime, ci } = nd
  const analysisMethod = nd.analysisMethod ?? 'per_unit_delta'
  const nMonteCarlo = nd.nMonteCarlo ?? '10000'
  const nBootstrap = nd.nBootstrap ?? '200'
  const seed = nd.seed ?? '1729'
  const setRows = (v: DegRow[]) => patchND({ rows: v })
  const setThreshold = (v: string) => patchND({ threshold: v })
  const setDirection = (v: 'above' | 'below') => patchND({ direction: v })
  const setModel = (v: string) => patchND({ model: v })
  const setDist = (v: string) => patchND({ dist: v })
  const setRelTime = (v: string) => patchND({ relTime: v })
  const setCi = (v: string) => patchND({ ci: v })
  const setAnalysisMethod = (v: 'per_unit_delta' | 'hierarchical_nlme') => patchND({ analysisMethod: v })
  const setNMonteCarlo = (v: string) => patchND({ nMonteCarlo: v })
  const setNBootstrap = (v: string) => patchND({ nBootstrap: v })
  const setSeed = (v: string) => patchND({ seed: v })
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
        ci: parseFloat(ci),
        analysis_method: analysisMethod,
        n_monte_carlo: parseInt(nMonteCarlo, 10),
        n_bootstrap: analysisMethod === 'hierarchical_nlme' ? parseInt(nBootstrap, 10) : 0,
        seed: seed.trim() ? parseInt(seed, 10) : null,
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
  const showInspectionIntervals = Boolean(
    res?.unit_table.some(u => u.life_observation === 'interval_censored'),
  )
  const showProjectionIntervals = Boolean(
    res?.unit_table.some(u => u.projection_lower != null && u.projection_upper != null),
  )

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
        <InfoLabel tip="The hierarchical model pools repeated paths across units and derives the population first-passage life distribution directly. The legacy per-unit method independently extrapolates each path and uses first-order delta bounds as a screening approximation.">Analysis method</InfoLabel>
        <select value={analysisMethod}
          onChange={e => setAnalysisMethod(e.target.value as 'per_unit_delta' | 'hierarchical_nlme')}
          className={inputCls}>
          <option value="hierarchical_nlme" disabled={!['linear', 'exponential'].includes(model)}>
            Hierarchical population model
          </option>
          <option value="per_unit_delta">Per-unit delta screening</option>
        </select>
        {analysisMethod === 'hierarchical_nlme' && !['linear', 'exponential'].includes(model) && (
          <p className="mt-1 text-[10px] text-amber-700">Hierarchical inference currently supports linear and exponential paths.</p>
        )}
      </div>
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
        <DegradationModelGuidance model={model} />
      </div>
      {analysisMethod === 'per_unit_delta' && <div>
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
      </div>}
      <Field label="Reliability time (optional)" tip={analysisMethod === 'hierarchical_nlme'
        ? 'Compute reliability from the induced population first-passage distribution.'
        : 'Compute R(t) and probability of failure at this time from the fitted life distribution.'} value={relTime} onChange={setRelTime} />
      {analysisMethod === 'hierarchical_nlme' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Monte Carlo draws" tip="Population random-effect draws used to evaluate the induced first-passage distribution." value={nMonteCarlo} onChange={setNMonteCarlo} />
          <Field label="Bootstrap refits" tip="Refitted parametric-bootstrap samples used to propagate population-parameter uncertainty. Enter 0 for a point-estimate-only diagnostic run." value={nBootstrap} onChange={setNBootstrap} />
          <Field label="Random seed" tip="Seed for reproducible population simulation and bootstrap refits." value={seed} onChange={setSeed} />
        </div>
      )}
      <div>
        <InfoLabel tip={analysisMethod === 'hierarchical_nlme'
          ? 'Confidence level for refitted-bootstrap population parameters, life summaries, and reliability.'
          : 'Confidence level for the displayed delta-method uncertainty around each extrapolated crossing time. These bounds are not treated as interval-censored life observations.'}>Confidence level</InfoLabel>
        <ConfidenceInput value={ci} onChange={setCi} className="w-full" />
      </div>
    </>
  )

  const results = res && (
    <div className="space-y-5">
      {res.hierarchical_fit && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Card label="Mean life" value={fmtNum(res.hierarchical_fit.life_distribution.summary.mean)} accent />
            <Card label="B50 (median)" value={fmtNum(res.hierarchical_fit.life_distribution.summary.B50)} />
            <Card label="B10 life" value={fmtNum(res.hierarchical_fit.life_distribution.summary.B10)} />
            {res.hierarchical_fit.life_distribution.reliability
              ? <Card label={`R(t=${fmtNum(res.hierarchical_fit.life_distribution.reliability.time)})`}
                  value={res.hierarchical_fit.life_distribution.reliability.R.toFixed(4)} />
              : <Card label="Units" value={String(res.unit_table.length)} />}
          </div>
          <div className="rounded border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xs text-gray-700 space-y-1">
            <p className="font-semibold text-emerald-800">Hierarchical first-passage model</p>
            <p>
              Repeated paths are pooled through population random effects. Life is induced by
              threshold crossing; projected subject crossings are display-only and are not fitted
              again as an arbitrary life distribution.
            </p>
            <p>
              Median slope magnitude {fmtNum(res.hierarchical_fit.population_parameters.median_slope_magnitude)} ·
              {' '}between-unit SDs {fmtNum(res.hierarchical_fit.random_effects.sd_intercept)} (intercept) and
              {' '}{fmtNum(res.hierarchical_fit.random_effects.sd_log_slope)} (log slope) ·
              {' '}residual SD {fmtNum(res.hierarchical_fit.residual_sigma)}.
            </p>
            <p className={res.hierarchical_fit.fit_eligible ? 'text-green-700' : 'text-amber-700'}>
              {res.hierarchical_fit.fit_eligible ? 'Fit passed convergence and identifiability checks.' : 'Fit is diagnostic only; review convergence and identifiability diagnostics.'}
              {' '}Bootstrap refits: {res.hierarchical_fit.uncertainty.diagnostics.successful}/
              {res.hierarchical_fit.uncertainty.diagnostics.requested} successful
              {' '}({res.hierarchical_fit.uncertainty.diagnostics.status.replace(/_/g, ' ')}).
            </p>
            {(res.hierarchical_fit.uncertainty.diagnostics.warnings?.length ?? 0) > 0 && (
              <p className="text-amber-700">
                Bootstrap warning: {res.hierarchical_fit.uncertainty.diagnostics.warnings!
                  .map(warning => warning.replace(/_/g, ' ')).join('; ')}.
              </p>
            )}
          </div>
          {Object.keys(res.hierarchical_fit.uncertainty.summary_intervals).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">
                Refitted-bootstrap life uncertainty ({Math.round(res.hierarchical_fit.uncertainty.confidence_level * 100)}%)
              </p>
              <table className="w-full text-xs border border-gray-200 rounded">
                <thead className="bg-gray-50"><tr>
                  <th className="px-3 py-1.5 text-left font-medium text-gray-600">Quantity</th>
                  <th className="px-3 py-1.5 text-right font-medium text-gray-600">Estimate</th>
                  <th className="px-3 py-1.5 text-right font-medium text-gray-600">Bootstrap interval</th>
                </tr></thead>
                <tbody>
                  {(['mean', 'B10', 'B50'] as const).map(key => {
                    const interval = res.hierarchical_fit!.uncertainty.summary_intervals[key]
                    const estimate = res.hierarchical_fit!.life_distribution.summary[key]
                    return interval && (
                      <tr key={key} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 text-gray-700">{key === 'mean' ? 'Mean life' : key}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtNum(estimate)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">[{fmtNum(interval[0])}, {fmtNum(interval[1])}]</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
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
            {res.distribution_fit.fit_method && (
              <span className="text-gray-400 font-normal"> · {res.distribution_fit.fit_method.replace(/_/g, ' ')}</span>
            )}
            {res.distribution_fit.converged && (
              <span className="text-green-600 font-normal"> · convergence checked</span>
            )}
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
      {res.analysis_method === 'per_unit_delta' && res.life_data_summary && (
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 space-y-1">
          <p>
            Life likelihood uses one contribution per unit: {res.life_data_summary.exact} projected point,
            {' '}{res.life_data_summary.interval} observed inspection interval, and
            {' '}{res.life_data_summary.right_censored} right-censored.
            {res.life_data_summary.units_dropped > 0
              ? ` ${res.life_data_summary.units_dropped} unit(s) could not be used.`
              : ' No units were dropped.'}
          </p>
          <p>
            Projection uncertainty is display-only and never enters the censoring likelihood
            ({res.projection_uncertainty.intervals_available} interval(s) available at
            {' '}{Math.round(res.projection_uncertainty.confidence_level * 100)}%).
          </p>
        </div>
      )}
      {res.distribution_fit_error && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Life-distribution fit unavailable: {res.distribution_fit_error}
        </p>
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
      {res.hierarchical_fit && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Induced population first-passage distribution</p>
          <Plot
            data={[
              { x: res.hierarchical_fit.life_distribution.curve_x,
                y: res.hierarchical_fit.life_distribution.cdf,
                mode: 'lines', line: { color: '#059669', width: 2 }, name: 'CDF' },
            ] as Plotly.Data[]}
            layout={{ ...plotBase, height: 260, xaxis: { title: { text: 'Time to threshold crossing' } }, yaxis: { title: { text: 'Unreliability' }, range: [0, 1] } } as Plotly.Layout}
            config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">
          {res.analysis_method === 'hierarchical_nlme'
            ? 'Posterior subject paths and display-only threshold projections'
            : `Per-unit projections (${Math.round(res.projection_uncertainty.confidence_level * 100)}% uncertainty intervals are display-only)`}
        </p>
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50"><tr>
            <th className="px-3 py-1.5 text-left font-medium text-gray-600">Unit</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">a</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">b</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">Projected</th>
            {showProjectionIntervals && <th className="px-3 py-1.5 text-right font-medium text-gray-600">Projection lower</th>}
            {showProjectionIntervals && <th className="px-3 py-1.5 text-right font-medium text-gray-600">Projection upper</th>}
            {showInspectionIntervals && <th className="px-3 py-1.5 text-right font-medium text-gray-600">Inspection lower</th>}
            {showInspectionIntervals && <th className="px-3 py-1.5 text-right font-medium text-gray-600">Inspection upper</th>}
            <th className="px-3 py-1.5 text-left font-medium text-gray-600">Life input</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">R²</th>
          </tr></thead>
          <tbody>
            {res.unit_table.map(u => (
              <tr key={u.unit_id} className="border-t border-gray-100">
                <td className="px-3 py-1 text-gray-700">{u.unit_id}</td>
                <td className="px-3 py-1 text-right font-mono">{u.a != null ? u.a.toPrecision(4) : '—'}</td>
                <td className="px-3 py-1 text-right font-mono">{u.b != null ? u.b.toPrecision(4) : '—'}</td>
                <td className="px-3 py-1 text-right font-mono">{u.projected_failure != null ? fmtNum(u.projected_failure) : '—'}</td>
                {showProjectionIntervals && <td className="px-3 py-1 text-right font-mono">{u.projection_lower != null ? fmtNum(u.projection_lower) : '—'}</td>}
                {showProjectionIntervals && <td className="px-3 py-1 text-right font-mono">{u.projection_upper != null ? fmtNum(u.projection_upper) : '—'}</td>}
                {showInspectionIntervals && <td className="px-3 py-1 text-right font-mono">{u.inspection_lower != null ? fmtNum(u.inspection_lower) : '—'}</td>}
                {showInspectionIntervals && <td className="px-3 py-1 text-right font-mono">{u.inspection_upper != null ? fmtNum(u.inspection_upper) : '—'}</td>}
                <td className="px-3 py-1 text-gray-600">
                  {u.life_observation === 'interval_censored'
                    ? 'inspection interval (observed)'
                    : u.life_observation === 'joint_longitudinal_measurements'
                      ? 'longitudinal measurements (joint fit)'
                    : u.life_observation === 'right_censored'
                      ? `right-censored @ ${fmtNum(u.censor_time)}`
                      : u.life_observation === 'projected_exact' ? 'projected point' : 'unusable'}
                </td>
                <td className="px-3 py-1 text-right font-mono">{u.r2 != null ? u.r2.toFixed(4) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return <ToolLayout intro={analysisMethod === 'hierarchical_nlme'
    ? 'Non-destructive degradation: pool repeated unit paths in a hierarchical population model, then derive reliability from the induced threshold first-passage distribution.'
    : 'Non-destructive degradation screening: fit and extrapolate each unit separately, then summarize projected crossing times with explicitly display-only first-order uncertainty.'}
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Analyze" results={results} />
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
        <InfoLabel tip="The measurement family at each inspection time. Best fit jointly refits the time-varying degradation location and common distribution shape for every candidate, then selects by AICc (AIC if the sample is too small for AICc). It does not fit a distribution to pooled measurements, which would ignore time-dependent degradation.">Measurement distribution</InfoLabel>
        <select value={dist} onChange={e => setDist(e.target.value)} className={inputCls}>
          <option value="Best_Fit">Best fit (joint MLE + AICc/AIC)</option>
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
        <DegradationModelGuidance model={model} />
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
      {res.measurement_distribution_selection && (
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-3 py-2">
          Selected <span className="font-semibold">{res.measurement_distribution}</span> from the joint measurement-distribution fits using {res.measurement_distribution_selection}.
        </p>
      )}
      {res.distribution_comparison && res.distribution_comparison.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Measurement distribution ranking</p>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50"><tr>
                <th className="px-3 py-1.5 text-left font-medium text-gray-600">Distribution</th>
                <th className="px-3 py-1.5 text-right font-medium text-gray-600">AICc</th>
                <th className="px-3 py-1.5 text-right font-medium text-gray-600">AIC</th>
                <th className="px-3 py-1.5 text-right font-medium text-gray-600">BIC</th>
                <th className="px-3 py-1.5 text-right font-medium text-gray-600">LogLik</th>
                <th className="px-3 py-1.5 text-right font-medium text-gray-600">Status</th>
              </tr></thead>
              <tbody>
                {res.distribution_comparison.map(c => (
                  <tr key={c.distribution}
                    title={c.reason}
                    className={`border-t border-gray-100 ${
                      c.distribution === res.measurement_distribution ? 'bg-green-50' : !c.fit_eligible ? 'bg-red-50/70' : ''
                    }`}>
                    <td className="px-3 py-1 font-mono text-gray-700">{c.distribution}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.AICc != null ? fmtNum(c.AICc) : '—'}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.AIC != null ? fmtNum(c.AIC) : '—'}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.BIC != null ? fmtNum(c.BIC) : '—'}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.LogLik != null ? fmtNum(c.LogLik) : '—'}</td>
                    <td className={`px-3 py-1 text-right ${c.fit_eligible ? 'text-green-700' : 'text-red-600'}`}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

interface ESSState {
  defectRate: string
  target: string
  type: 'thermal' | 'vibration' | 'combined'
  tempRange: string
  cycles: string
  grms: string
  vibrationDuration: string
  result: ESSResponse | null
}

const INITIAL_ESS: ESSState = {
  defectRate: '0.05', target: '0.9', type: 'thermal', tempRange: '80',
  cycles: '10', grms: '6', vibrationDuration: '10', result: null,
}

function ESS() {
  const [state, patchState] = useTestingToolState('ess', INITIAL_ESS)
  const {
    defectRate, target, type, tempRange, cycles, grms,
    vibrationDuration: vibDur, result: res,
  } = state
  const setDefectRate = (value: string) => patchState({ defectRate: value })
  const setTarget = (value: string) => patchState({ target: value })
  const setType = (value: ESSState['type']) => patchState({ type: value })
  const setTempRange = (value: string) => patchState({ tempRange: value })
  const setCycles = (value: string) => patchState({ cycles: value })
  const setGrms = (value: string) => patchState({ grms: value })
  const setVibDur = (value: string) => patchState({ vibrationDuration: value })
  const setRes = (value: ESSResponse | null) => patchState({ result: value })
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

interface HASSState {
  operatingLow: string
  operatingHigh: string
  destructLow: string
  destructHigh: string
  operatingVibration: string
  destructVibration: string
  precipitation: string
  detectionDuration: string
  mtbf: string
  result: HASSResponse | null
}

const INITIAL_HASS: HASSState = {
  operatingLow: '-40', operatingHigh: '85', destructLow: '-60',
  destructHigh: '120', operatingVibration: '10', destructVibration: '30',
  precipitation: '0.9', detectionDuration: '24', mtbf: '5000', result: null,
}

function HASS() {
  const [state, patchState] = useTestingToolState('hass', INITIAL_HASS)
  const {
    operatingLow: opLow, operatingHigh: opHigh, destructLow: dsLow,
    destructHigh: dsHigh, operatingVibration: opVib,
    destructVibration: dsVib, precipitation: precip,
    detectionDuration: detDur, mtbf, result: res,
  } = state
  const setOpLow = (value: string) => patchState({ operatingLow: value })
  const setOpHigh = (value: string) => patchState({ operatingHigh: value })
  const setDsLow = (value: string) => patchState({ destructLow: value })
  const setDsHigh = (value: string) => patchState({ destructHigh: value })
  const setOpVib = (value: string) => patchState({ operatingVibration: value })
  const setDsVib = (value: string) => patchState({ destructVibration: value })
  const setPrecip = (value: string) => patchState({ precipitation: value })
  const setDetDur = (value: string) => patchState({ detectionDuration: value })
  const setMtbf = (value: string) => patchState({ mtbf: value })
  const setRes = (value: HASSResponse | null) => patchState({ result: value })
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

interface BurnInState {
  duration: string
  beta: string
  eta: string
  units: string
  accelerationFactor: string
  result: BurnInResponse | null
}

const INITIAL_BURN_IN: BurnInState = {
  duration: '48', beta: '0.5', eta: '10000', units: '100',
  accelerationFactor: '1', result: null,
}

function BurnIn() {
  const [state, patchState] = useTestingToolState('burnIn', INITIAL_BURN_IN)
  const { duration, beta, eta, units, accelerationFactor: af, result: res } = state
  const setDuration = (value: string) => patchState({ duration: value })
  const setBeta = (value: string) => patchState({ beta: value })
  const setEta = (value: string) => patchState({ eta: value })
  const setUnits = (value: string) => patchState({ units: value })
  const setAf = (value: string) => patchState({ accelerationFactor: value })
  const setRes = (value: BurnInResponse | null) => patchState({ result: value })
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
        <Card label="Mean residual life after burn-in" value={fmtNum(res.post_burn_in_mean_residual_life)}
          tip="Expected additional life conditional on surviving burn-in; integrates the fitted Weibull tail to infinity." />
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
