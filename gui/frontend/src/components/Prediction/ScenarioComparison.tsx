import { useModuleState } from '../../store/project'
import type { SystemDefinitionModel } from '../../api/systemDefinition'
import { comparePredictionScenarios, type ComparisonFolio, type Difference } from './scenarioComparisonModel'

const initial = { baselineId: '', candidateId: '' }
const number = (value: number | null | undefined) => value == null ? 'Undefined' : value.toLocaleString(undefined, { maximumSignificantDigits: 7 })
const value = (v: unknown) => v === undefined ? 'Default' : typeof v === 'object' ? JSON.stringify(v) : String(v)
function Changes({ rows }: { rows: Difference[] }) {
  return rows.length ? <ul className="space-y-1">{rows.map(row => <li key={row.key}><strong>{row.key}</strong>: {value(row.baseline)} → {value(row.candidate)}{row.ratio != null && <span> (B/A {number(row.ratio)})</span>}</li>)}</ul> : <span className="text-gray-500">No changes</span>
}
export default function ScenarioComparison({ model, folios }: { model: SystemDefinitionModel; folios: ComparisonFolio[] }) {
  const [selection, setSelection] = useModuleState('predictionComparison', initial)
  const baselineId = selection.baselineId || folios[0]?.id || ''
  const candidateId = selection.candidateId || folios.find(folio => folio.id !== baselineId)?.id || ''
  const a = folios.find(folio => folio.id === baselineId), b = folios.find(folio => folio.id === candidateId)
  const pair = comparePredictionScenarios(model, a, b)
  return <section id="prediction-comparison-panel" role="tabpanel" aria-labelledby="prediction-comparison-tab" className="flex-1 min-h-0 overflow-auto p-5 space-y-4 text-xs">
    <h2 className="text-base font-semibold">Compare prediction scenarios</h2>
    <p>Pair two calculated recipes on the current shared bill of materials. Rates are calendar-hour failures per million hours; MTBF is in hours. Ratios describe these predictions and do not establish measured field performance.</p>
    <div className="flex items-end gap-4 flex-wrap">
      <label className="grid gap-1">Baseline A<select aria-label="Baseline A" className="border rounded p-2" value={baselineId} onChange={e => setSelection({ baselineId: e.target.value, candidateId })}><option value="">Select scenario</option>{folios.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label className="grid gap-1">Candidate B<select aria-label="Candidate B" className="border rounded p-2" value={candidateId} onChange={e => setSelection({ baselineId, candidateId: e.target.value })}><option value="">Select scenario</option>{folios.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <button type="button" className="border rounded p-2" onClick={() => setSelection({ baselineId: candidateId, candidateId: baselineId })}>Swap A and B</button>
    </div>
    {pair.reasons.length > 0 ? <div role="status" className="bg-amber-50 border border-amber-200 rounded p-3"><p className="font-semibold">Comparison needs current, compatible results</p><ul className="list-disc pl-5 mt-2">{pair.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : <>
      <table className="w-full text-left border-collapse" data-testid="prediction-comparison-summary"><thead><tr><th className="p-2">Measure</th><th>A — {a?.name}</th><th>B — {b?.name}</th><th>B / A</th></tr></thead><tbody>
        <tr className="border-t"><th className="p-2">Failure rate (failures / 10⁶ hours)</th><td>{number(pair.baseline?.total_failure_rate)}</td><td>{number(pair.candidate?.total_failure_rate)}</td><td data-testid="prediction-rate-ratio">{number(pair.rateRatio)}</td></tr>
        <tr className="border-t"><th className="p-2">MTBF (hours)</th><td>{number(pair.baseline?.mtbf_hours)}</td><td>{number(pair.candidate?.mtbf_hours)}</td><td data-testid="prediction-mtbf-ratio">{number(pair.mtbfRatio)}</td></tr>
      </tbody></table>
      <p>Rate difference B − A: {number(pair.rateDifference)} failures / 10⁶ hours. A lower rate corresponds to a higher MTBF. Ratios requiring division by zero, or an unbounded MTBF, are undefined.</p>
      <div className="border rounded p-3"><h3 className="font-semibold mb-2">Recipe differences</h3><Changes rows={pair.inputs} /></div>
      <div className="border rounded p-3 space-y-2"><h3 className="font-semibold">Calculation provenance</h3>
        <p>{pair.baseline?.standard} · {pair.baseline?.methodology.edition} · {pair.baseline?.methodology.source.title}</p>
        {pair.baseline?.methodology.source.url && <a href={pair.baseline.methodology.source.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">Method source</a>}
        {[['A', pair.baseline], ['B', pair.candidate]].map(([name, raw]) => { const result = raw as typeof pair.baseline; return <p className="break-all font-mono text-[10px]" key={String(name)}>{String(name)} request SHA-256: {result?.request_sha256}<br/>System: {result?.canonical_system_id} · {result?.source_fingerprint}</p> })}
        {[...(pair.baseline?.warnings ?? []), ...(pair.candidate?.warnings ?? [])].map((warning, i) => <p className="text-amber-700" key={i}>{warning}</p>)}
      </div>
      <h3 className="font-semibold">Per-part rates, factors and sources</h3>
      <p>Rates below include canonical assembly quantities. Factor ratios explain individual changes; combined effects and overrides should be read with the part equations.</p>
      {pair.rows.map(row => <details key={row.id} className="border rounded p-3" open={pair.rows.length < 4}>
        <summary className="font-semibold cursor-pointer">{row.name || row.id}: {number(row.baselineRate)} → {number(row.candidateRate)} failures / 10⁶ hours · B/A {number(row.ratio)}</summary>
        <div className="grid md:grid-cols-2 gap-4 mt-3"><div><h4 className="font-semibold mb-1">Factor differences</h4><Changes rows={row.factors}/></div><div><h4 className="font-semibold mb-1">Part input differences</h4><Changes rows={row.inputs}/></div></div>
        <p className="mt-3">{row.baseline.traceability?.standard} · §{row.baseline.traceability?.section} · {row.baseline.traceability?.model} · {row.baseline.traceability?.handbook_pages}</p><p>{row.baseline.traceability?.equation}</p>
        {[['A', row.baseline], ['B', row.candidate]].map(([side, raw]) => { const part = raw as typeof row.baseline; return <p className="text-gray-600 mt-1" key={String(side)}>{String(side)}: {part.operating_environment || 'Inherited environment'} · {part.traceability?.quality_basis}; {part.assumptions?.join(' ')} {part.warnings?.join(' ')}</p> })}
      </details>)}
    </>}
  </section>
}
