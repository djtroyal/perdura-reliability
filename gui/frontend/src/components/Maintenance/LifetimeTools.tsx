import { useEffect, useRef, useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeSurvivalMatrix, computeMechanicalRate, computeInspectionPrediction, parseLifetimeGrid, survivalMatrixCsv,
  type SurvivalMatrixResult, type MechanicalRateResult, type InspectionPredictionResult, type InspectionPredictionRow } from '../../api/lifeTools'
import { getProjectState, setModuleState, useModuleState, useUnits } from '../../store/project'
import { useReliabilitySources } from '../shared/ldaFolios'
import { resolveReliabilitySource } from '../shared/reliabilitySources'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import { inputCls } from '../shared/styles'
import { fmtNum } from '../shared/format'
import InfoLabel from '../shared/InfoLabel'
import { quantityFromProjectUnit } from '../shared/datasetUnits'
import { downloadArtifact } from '../../store/artifactExport'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'
import { lifetimeInputSignature, lifetimeResultStatus } from '../../store/toolkitFreshness'

type Tab = 'matrix' | 'mechanical' | 'inspection'
type Tagged<T> = T & { _sourceId: string; _sourceFingerprint: string; _units: string; _inputSignature?: string }
export interface LifetimeToolsState {
  tab: Tab; sourceId: string; eta: string; beta: string; ages: string; durations: string; measure: 'survival' | 'failure'
  basis: 'eta' | 'percentile'; percentileLife: string; failurePercent: string; interval: string; cmDowntime: string; pmDowntime: string
  n: string; failures: string; firstAge: string; secondAge: string; betas: string; level: string; priorAlpha: string; priorBeta: string
  matrixResult: Tagged<SurvivalMatrixResult> | null; mechanicalResult: Tagged<MechanicalRateResult> | null
  inspectionResult: Tagged<InspectionPredictionResult> | null
}
export const INITIAL_LIFETIME_TOOLS: LifetimeToolsState = {
  tab: 'matrix', sourceId: '', eta: '13', beta: '2', ages: '0:10:2', durations: '0:10:2', measure: 'survival',
  basis: 'eta', percentileLife: '5000', failurePercent: '10', interval: '10', cmDowntime: '0', pmDowntime: '0',
  n: '20000', failures: '8', firstAge: '3', secondAge: '10', betas: '3, 3.3, 3.6', level: '.95', priorAlpha: '.5', priorBeta: '.5',
  matrixResult: null, mechanicalResult: null, inspectionResult: null,
}
const TABS: Record<Tab, string> = { matrix: 'Conditional survival table', mechanical: 'Mechanical equivalent rate', inspection: 'Inspection prediction' }
const finite = (value: string, label: string) => {
  if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`${label} must be a finite number.`)
  return Number(value)
}
export default function LifetimeTools() {
  const [stored, setState] = useModuleState<LifetimeToolsState>('lifeTools', INITIAL_LIFETIME_TOOLS)
  const s = { ...INITIAL_LIFETIME_TOOLS, ...stored }
  const [units] = useUnits()
  const timeBasis = quantityFromProjectUnit(units).kind === 'time'
  const lifetimeQuantity = ['time', 'cycles', 'distance'].includes(quantityFromProjectUnit(units).kind)
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState('')
  const generation = useRef(0)
  const bookmark = useBookmarkNavigationTarget(), appliedBookmark = useRef(0)
  useEffect(() => {
    if (!bookmark || bookmark.nonce === appliedBookmark.current || bookmark.source.module !== 'lifeTools') return
    const view = bookmark.source.view as Tab
    if (!(view in TABS)) return
    appliedBookmark.current = bookmark.nonce
    generation.current++
    setState(old => ({ ...INITIAL_LIFETIME_TOOLS, ...old, tab: view }))
  }, [bookmark, setState])
  const sources = useReliabilitySources(s.tab === 'matrix' ? 'distribution' : 'weibull-2p')
  const selected = sources.find(source => source.id === s.sourceId)
  const patch = (change: Partial<LifetimeToolsState>) => {
    generation.current++; setNotice('')
    setState(old => ({ ...INITIAL_LIFETIME_TOOLS, ...old, ...change, matrixResult: null, mechanicalResult: null, inspectionResult: null }))
  }
  const field = (key: keyof LifetimeToolsState, label: string, tip?: string) => <div key={key}>
    <InfoLabel tip={tip ?? label}>{label}</InfoLabel>
    <input aria-label={label} className={inputCls} value={String(s[key])} onChange={e => patch({ [key]: e.target.value })} />
  </div>
  const run = async () => {
    setError(null); setNotice(''); setLoading(true)
    const requestGeneration = ++generation.current
    const projectId = getProjectState().identity.projectId
    try {
      const source = s.sourceId ? resolveReliabilitySource(getProjectState(), s.sourceId, s.tab === 'matrix' ? 'distribution' : 'weibull-2p') : null
      const tag = { _sourceId: s.sourceId, _sourceFingerprint: source?.fingerprint ?? '', _units: units, _inputSignature: lifetimeInputSignature(s,s.tab) }
      let result: Partial<LifetimeToolsState>
      if (s.tab === 'matrix') {
        const ages = parseLifetimeGrid(s.ages, 'Current ages'), durations = parseLifetimeGrid(s.durations, 'Additional durations')
        if (ages.length * durations.length > 2500) throw new Error('The survival table is limited to 2500 cells.')
        result = { matrixResult: { ...await computeSurvivalMatrix({ distribution: source?.dist ?? 'Weibull_2P',
          params: source?.dist_params ?? { eta: finite(s.eta, 'Scale'), beta: finite(s.beta, 'Shape') }, ages, durations }), ...tag } }
      } else if (s.tab === 'mechanical') {
        result = { mechanicalResult: { ...await computeMechanicalRate({ beta: source?.dist_params.beta ?? finite(s.beta, 'Shape'),
          interval: finite(s.interval, 'Replacement age'), eta: source?.dist_params.alpha ?? (s.basis === 'eta' ? finite(s.eta, 'Scale') : null),
          percentile_life: !source && s.basis === 'percentile' ? finite(s.percentileLife, 'Percentile life') : null,
          failure_percentile: !source && s.basis === 'percentile' ? finite(s.failurePercent, 'Failure percentile') / 100 : .1,
          exposure_basis: timeBasis ? 'time' : 'non_time',
          corrective_downtime: timeBasis ? finite(s.cmDowntime, 'Corrective downtime') : 0, preventive_downtime: timeBasis ? finite(s.pmDowntime, 'Preventive downtime') : 0 }), ...tag } }
      } else {
        result = { inspectionResult: { ...await computeInspectionPrediction({ n: finite(s.n, 'Population'), failures: finite(s.failures, 'Observed failures'),
          first_age: finite(s.firstAge, 'First inspection age'), second_age: finite(s.secondAge, 'Second inspection age'),
          betas: source ? [source.dist_params.beta] : parseLifetimeGrid(s.betas, 'Shape values', 12), level: finite(s.level, 'Credible level'),
          prior_alpha: finite(s.priorAlpha, 'Prior alpha'), prior_beta: finite(s.priorBeta, 'Prior beta'), prior_sensitivity: true }), ...tag } }
      }
      if (getProjectState().identity.projectId !== projectId) return
      if (requestGeneration !== generation.current || getProjectState().units !== units
        || (source && resolveReliabilitySource(getProjectState(), s.sourceId).fingerprint !== source.fingerprint)) throw new Error('Inputs or source changed. Recalculate the result.')
      setState(old => ({ ...INITIAL_LIFETIME_TOOLS, ...old, ...result }))
    } catch (err) { setError(detail(err, err instanceof Error ? err.message : 'Lifetime calculation failed.')) }
    finally { setLoading(false) }
  }
  const result = s.tab === 'matrix' ? s.matrixResult : s.tab === 'mechanical' ? s.mechanicalResult : s.inspectionResult
  const freshness = result ? lifetimeResultStatus(getProjectState(), { ...s }, `${s.tab}Result`) : null
  const stale = freshness && !freshness.current
  const loadExample = () => patch(s.tab === 'matrix' ? { sourceId: '', eta: '13', beta: '2', ages: '0:10:2', durations: '0:10:2' }
    : s.tab === 'mechanical' ? { sourceId: '', eta: '50000', beta: '1.3', interval: '87600', basis: 'eta', cmDowntime: '0', pmDowntime: '0' }
    : { sourceId: '', n: '20000', failures: '8', firstAge: '3', secondAge: '10', betas: '3,3.3,3.6', priorAlpha: '.5', priorBeta: '.5' })
  const controls = <>
    <div><InfoLabel tip="Choose the lifetime calculation.">Tool</InfoLabel><select className={inputCls} aria-label="Lifetime tool" value={s.tab} onChange={e => patch({ tab: e.target.value as Tab })}>
      {Object.entries(TABS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
    <button type="button" className="secondary-button" onClick={loadExample}>Load reference example</button>
    <div><InfoLabel tip={s.tab === 'inspection' ? 'Borrow only shape from an adopted Weibull model; scale is estimated from the inspection count.' : 'Use a current adopted distribution in project units.'}>{s.tab === 'inspection' ? 'Shape source' : 'Distribution source'}</InfoLabel>
      <select className={inputCls} aria-label="Lifetime distribution source" value={s.sourceId} onChange={e => patch({ sourceId: e.target.value })}>
        <option value="">Manual input</option>{s.sourceId && !selected && <option value={s.sourceId}>Unavailable or incompatible source</option>}
        {sources.map(source => <option key={source.id} value={source.id}>{source.name} — {source.label}</option>)}</select></div>
    {s.sourceId && !selected && <p role="alert" className="text-red-700 text-xs">Select a current compatible adopted model or use manual input.</p>}
    {s.tab === 'matrix' && <>
      {!s.sourceId && <>{field('eta', `Weibull scale (${units})`)}{field('beta', 'Weibull shape')}</>}
      {field('ages', `Current ages (${units})`, 'Comma-separated values or start:end:step; at most 2500 table cells.')}
      {field('durations', `Additional durations (${units})`, 'Additional exposure after survival to each row age; values or start:end:step.')}
    </>}
    {s.tab === 'mechanical' && <>
      {!s.sourceId && <><div><InfoLabel tip="Derive characteristic life from a failure percentile if needed.">Life input</InfoLabel><select aria-label="Mechanical life input" className={inputCls} value={s.basis} onChange={e => patch({ basis: e.target.value as 'eta' | 'percentile' })}>
        <option value="eta">Characteristic life η</option><option value="percentile">Lp percentile life</option></select></div>
        {field('beta', 'Weibull shape')}{s.basis === 'eta' ? field('eta', `Weibull scale (${units})`) : <>{field('percentileLife', `Lp life (${units})`)}{field('failurePercent', 'Percent failed at Lp (%)')}</>}</>}
      {field('interval', `Replacement age (${units})`, 'Renew at failure or attained operating age T, whichever comes first.')}
      {timeBasis && <>{field('cmDowntime', `Corrective downtime (${units})`)}{field('pmDowntime', `Preventive downtime (${units})`)}</>}
      <p className="text-xs text-slate-600">{timeBasis ? 'Downtime uses the same time unit as life; operating age pauses during downtime.' : 'Non-time exposure: only the operating-exposure rate is calculated. No conversion to calendar time is assumed.'}</p>
    </>}
    {s.tab === 'inspection' && <>
      {field('n', 'Original population N')}{field('failures', 'Failures observed X')}
      {field('firstAge', `First inspection age (${units})`)}{field('secondAge', `Second inspection age (${units})`)}
      {!s.sourceId && field('betas', 'Weibull shape values', 'One to twelve fixed shapes, comma-separated. Each row is a separate sensitivity scenario.')}
      {field('level', 'Predictive credible level', 'For example .95. Bayesian future-count probability, not a frequentist confidence level.')}
      {field('priorAlpha', 'Prior alpha', 'Beta prior for p1=P(failure by first inspection). Jeffreys: alpha=beta=.5.')}
      {field('priorBeta', 'Prior beta', 'Uniform prior: alpha=beta=1. Both sensitivities are shown.')}
    </>}
  </>
  const transfer = (row: InspectionPredictionRow) => {
    const r = s.inspectionResult
    if (!r || stale || row.eta_mle == null || r.survivors === 0) return
    setModuleState('maintFleet', { srcId: '', alpha: String(row.eta_mle), beta: String(row.beta), horizon: String(r.second_age - r.first_age), cost: '0', model: 'first_failure',
      cohorts: [{ id: 'Inspection survivors', count: String(r.survivors), age: String(r.first_age), entry: '0', exit: '' }], result: null })
    setNotice('Calibration saved to Fleet Forecast. Open that tab to add cohorts, entries, retirements or repeat-event models.')
  }
  const matrix = s.matrixResult, mechanical = s.mechanicalResult, inspection = s.inspectionResult
  const results = <div className="space-y-4" data-report-asset-key={bookmark?.source.module === 'lifeTools' && bookmark.source.view === s.tab ? bookmark.source.assetKey : undefined}>
    {stale && <p role="status" className="text-amber-800">Historical result: {freshness?.reason}. Recalculate before using it.</p>}
    {notice && <p role="status" className="text-blue-800">{notice}</p>}
    {s.tab === 'matrix' && matrix && <>
      <div className="flex gap-3 items-center"><label>Show <select aria-label="Survival table measure" className={inputCls} value={s.measure} onChange={e => setState(old => ({ ...old, measure: e.target.value as 'survival' | 'failure' }))}>
        <option value="survival">Survival probability</option><option value="failure">Failure probability</option></select></label>
        <button className="secondary-button" onClick={() => void downloadArtifact(survivalMatrixCsv(matrix, s.measure, matrix._units), 'conditional_survival.csv', 'text/csv;charset=utf-8', { kind: 'conditional-survival-table', title: 'Conditional survival table', moduleKey: 'lifeTools' }).catch(err => setError(String(err)))}>Export CSV</button></div>
      <p className="text-xs text-slate-600">{matrix.conditioning}</p>
      {lifetimeQuantity && matrix.negative_support_probability > .001 && <p className="text-amber-800 text-xs">This model assigns {(100 * matrix.negative_support_probability).toPrecision(4)}% below zero life. Rows condition on survival to the stated nonnegative age.</p>}
      <Plot data={[{ type: 'heatmap', x: matrix.durations, y: matrix.ages, z: matrix[s.measure], zmin: 0, zmax: 1, colorscale: 'Blues', colorbar: { title: { text: s.measure } } }]} layout={{ height: 360, xaxis: { title: { text: `Additional exposure (${matrix._units})` } }, yaxis: { title: { text: `Current age (${matrix._units})` } }, margin: { t: 15, l: 65, b: 55, r: 30 } }} config={{ responsive: true }} useResizeHandler style={{ width: '100%' }} />
      <div className="overflow-auto max-h-96"><table className="w-full text-xs" aria-label="Conditional probability table"><thead><tr><th className="p-2">Current age / additional exposure</th>{matrix.durations.map((d, i) => <th className="p-2" key={i}>{d}</th>)}</tr></thead><tbody>
        {matrix.ages.map((age, i) => <tr className="border-t" key={i}><th className="p-2">{age}</th>{matrix[s.measure][i].map((v, j) => <td className="p-2 font-mono" key={j}>{v.toPrecision(6)}</td>)}</tr>)}
      </tbody></table></div>
    </>}
    {s.tab === 'mechanical' && mechanical && <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card label="Derived characteristic life η" value={fmtNum(mechanical.eta)} />
        <Card label={`Corrective events / operating ${mechanical._units}`} value={mechanical.cm_per_time.toExponential(6)} accent />
        <Card label={`${mechanical.exposure_basis === 'time' ? 'Equivalent operating MTBF' : 'Exposure per corrective event'} (${mechanical._units})`} value={fmtNum(mechanical.equivalent_operating_mtbf)} />
        <Card label={`Unmaintained mean life (${mechanical._units})`} value={fmtNum(mechanical.mttf)} />
        {mechanical.calendar_failure_rate != null && <Card label={`Corrective events / calendar ${mechanical._units}`} value={mechanical.calendar_failure_rate.toExponential(6)} />}
        {mechanical.availability != null && <Card label="Long-run availability" value={mechanical.availability.toPrecision(6)} />}
      </div>
      <p className="text-sm">Age-replacement intensity = F(T) / ∫₀ᵀ R(u)du. Mean operating cycle: {fmtNum(mechanical.cycle_operating_time)} {mechanical._units}{mechanical.cycle_calendar_time != null && <>; calendar cycle: {fmtNum(mechanical.cycle_calendar_time)} {mechanical._units}</>}.</p>
      {mechanical.assumptions.map(note => <p className="text-xs text-slate-600" key={note}>{note}</p>)}
    </>}
    {s.tab === 'inspection' && inspection && <>
      <p className="text-sm font-medium">{(100 * inspection.level).toFixed(1)}% Bayesian posterior predictive intervals for additional first failures</p>
      <p className="text-xs text-slate-600">Prior p₁ ~ Beta({inspection.prior.alpha}, {inspection.prior.beta}); {inspection.survivors} survivors. Each β row fixes shape. These bounds include future count variation and uncertainty in p₁.</p>
      {inspection.boundary_note && <p className="text-amber-800 text-xs">{inspection.boundary_note}</p>}
      <div className="overflow-x-auto"><table className="w-full text-xs" aria-label="Inspection predictions"><thead><tr>{['Fixed β', 'Scale MLE', 'Plug-in expected count', 'Predictive mean', 'Predictive count interval', 'CDF error bound', 'Fleet scenario'].map(x => <th className="p-2 text-left" key={x}>{x}</th>)}</tr></thead><tbody>
        {inspection.rows.map((row, i) => <tr key={i} className="border-t"><td className="p-2">{row.beta}</td><td className="p-2">{fmtNum(row.eta_mle)}</td><td className="p-2">{fmtNum(row.expected_additional_failures_mle)}</td><td className="p-2">{fmtNum(row.posterior_predictive_mean)}</td>
          <td className="p-2">{row.predictive_interval.lower}–{row.predictive_interval.upper}</td><td className="p-2">{row.predictive_interval.cdf_error_bound.toExponential(2)}</td>
          <td className="p-2"><button className="secondary-button" disabled={Boolean(stale) || row.eta_mle == null || inspection.survivors === 0} onClick={() => transfer(row)}>Use in Fleet Forecast</button></td></tr>)}
      </tbody></table></div>
      <p className="text-xs text-slate-600">Using a row replaces the Fleet Forecast scenario with the surviving cohort and its calibrated model. Predictive bounds stay here; fleet solver bounds measure numerical error.</p>
      <details open><summary className="text-sm font-medium">Prior sensitivity</summary><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th>β</th><th>Prior</th><th>Predictive mean</th><th>Predictive count interval</th></tr></thead><tbody>
        {inspection.rows.flatMap((row, i) => (row.prior_sensitivity ?? []).map((prior, j) => <tr key={`${i}-${j}`} className="border-t"><td className="p-2">{row.beta}</td><td>{prior.prior} Beta({prior.alpha},{prior.beta})</td><td>{fmtNum(prior.mean)}</td><td>{prior.lower}–{prior.upper}</td></tr>))}
      </tbody></table></div></details>
      {inspection.assumptions.map(note => <p className="text-xs text-slate-600" key={note}>{note}</p>)}
      <div className="text-xs flex flex-wrap gap-3">{inspection.sources.map(source => <a className="text-blue-700 underline" href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div>
    </>}
    <p className="text-xs text-slate-600"><a className="text-blue-700 underline" href="https://www.itl.nist.gov/div898/handbook/apr/section1/apr162.htm" target="_blank" rel="noreferrer">Weibull definitions (NIST)</a> · η is characteristic life; β is shape. Conditional means, percentile lives and renewal intensities answer different questions.</p>
  </div>
  return <ToolLayout intro="Evaluate conditional life, convert percentile specifications to age-replacement rates, and predict failures from inspection counts." controls={controls} results={results} onRun={run} runLabel="Calculate lifetime tool" loading={loading} err={error} />
}
