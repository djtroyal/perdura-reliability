import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeSparH, SparHDependencyLevel, SparHResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { SPARH_PSFS, fmtHep } from './tables'

interface State {
  taskType: string
  psfs: Record<string, string>
  dependencyEnabled: boolean
  dependencyMode: 'context' | 'direct'
  dependencyLevel: SparHDependencyLevel
  sameCrew: boolean
  closeInTime: boolean
  sameLocation: boolean
  additionalCues: boolean
  failureNumber: string
  dependencyJustification: string
  uncertaintyConfidence: string
  result: SparHResponse | null
}
const nominalPsfs = () => Object.fromEntries(SPARH_PSFS.map(p => [p.key, 'nominal']))
const INITIAL: State = {
  taskType: 'action', psfs: nominalPsfs(), dependencyEnabled: false,
  dependencyMode: 'context', dependencyLevel: 'low', sameCrew: false,
  closeInTime: false, sameLocation: false, additionalCues: true,
  failureNumber: '2', dependencyJustification: '', uncertaintyConfidence: '0.90',
  result: null,
}
const EXAMPLE: State = {
  taskType: 'diagnosis',
  psfs: { ...nominalPsfs(), stress: 'high', complexity: 'highly_complex', experience: 'low', procedures: 'available_poor' },
  dependencyEnabled: true, dependencyMode: 'context', dependencyLevel: 'low',
  sameCrew: true, closeInTime: true, sameLocation: false, additionalCues: true,
  failureNumber: '2', dependencyJustification: 'Same crew response shortly after the preceding HFE.',
  uncertaintyConfidence: '0.90',
  result: null,
}

export default function SparH() {
  const [stored, setSt] = useModuleState<State>('hraSparH', INITIAL)
  const st: State = { ...INITIAL, ...stored, psfs: { ...nominalPsfs(), ...(stored.psfs ?? {}) } }
  const patch = (p: Partial<State>) => setSt(prev => ({ ...INITIAL, ...prev, ...p }))
  const setPsf = (k: string, v: string) => patch({ psfs: { ...st.psfs, [k]: v } })
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const dependency = st.dependencyEnabled ? {
        enabled: true,
        ...(st.dependencyMode === 'direct'
          ? { level: st.dependencyLevel }
          : {
              same_crew: st.sameCrew,
              close_in_time: st.closeInTime,
              same_location: st.sameLocation,
              additional_cues: st.additionalCues,
            }),
        failure_number_in_sequence: Math.max(2, parseInt(st.failureNumber, 10) || 2),
        justification: st.dependencyJustification,
      } : { enabled: false }
      const r = await computeSparH({
        task_type: st.taskType,
        psfs: st.psfs,
        dependency,
        uncertainty_confidence: parseFloat(st.uncertaintyConfidence) || 0.90,
      })
      patch({ result: r })
    } catch (e) { setError(detail(e, 'Error computing SPAR-H HEP.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={res != null} onLoad={() => setSt(EXAMPLE)} />
      </div>
      <div>
        <InfoLabel tip="Diagnosis tasks have a nominal HEP of 0.01; action tasks 0.001.">Task type</InfoLabel>
        <select value={st.taskType} onChange={e => patch({ taskType: e.target.value })} className={inputCls}>
          <option value="action">Action (nominal 0.001)</option>
          <option value="diagnosis">Diagnosis (nominal 0.01)</option>
        </select>
      </div>
      {SPARH_PSFS.map(psf => {
        const levels = psf.levels.filter(l => !l.tasks || l.tasks === st.taskType || l.tasks === 'both')
        const cur = levels.some(l => l.key === st.psfs[psf.key]) ? st.psfs[psf.key] : 'nominal'
        return (
          <div key={psf.key}>
            <label className="block text-xs font-medium text-gray-700 mb-1">{psf.label}</label>
            <select value={cur} onChange={e => setPsf(psf.key, e.target.value)} className={inputCls}>
              {levels.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </div>
        )
      })}
      <div className="border-t border-gray-200 pt-3 space-y-3">
        <label className="flex items-start gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={st.dependencyEnabled}
            onChange={e => patch({ dependencyEnabled: e.target.checked })} className="mt-0.5" />
          <span><strong>Model dependency on a preceding HFE</strong><br />
            <span className="text-[10px] text-gray-500">Apply SPAR-H Part IV when failure of this event is conditionally related to an earlier event.</span>
          </span>
        </label>
        {st.dependencyEnabled && <>
          <div>
            <InfoLabel tip="Use the published crew/time/location/cue matrix when those facts are known. Direct assignment requires an analyst justification.">Dependency assignment</InfoLabel>
            <select value={st.dependencyMode} onChange={e => patch({ dependencyMode: e.target.value as State['dependencyMode'] })} className={inputCls}>
              <option value="context">Derive from context matrix</option>
              <option value="direct">Assign level directly</option>
            </select>
          </div>
          {st.dependencyMode === 'context' ? (
            <div className="grid grid-cols-2 gap-2">
              {([
                ['sameCrew', 'Same crew'], ['closeInTime', 'Close in time'],
                ['sameLocation', 'Same location'], ['additionalCues', 'Additional cues'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-[11px] text-gray-700">
                  <input type="checkbox" checked={st[key]} onChange={e => patch({ [key]: e.target.checked })} /> {label}
                </label>
              ))}
            </div>
          ) : (
            <div>
              <InfoLabel tip="Zero, low, moderate, high, and complete use the dependency equations in NUREG/CR-6883. The third failure is at least moderate and the fourth or later at least high.">Assigned level</InfoLabel>
              <select value={st.dependencyLevel} onChange={e => patch({ dependencyLevel: e.target.value as SparHDependencyLevel })} className={inputCls}>
                {['zero', 'low', 'moderate', 'high', 'complete'].map(level =>
                  <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
              </select>
            </div>
          )}
          <div>
            <InfoLabel tip="Dependency is applied to the second and later failures. SPAR-H imposes a minimum of moderate for the third failure and high for the fourth or later.">Failure number in sequence</InfoLabel>
            <input type="number" min="2" step="1" value={st.failureNumber} onChange={e => patch({ failureNumber: e.target.value })} className={inputCls} />
          </div>
          <div>
            <InfoLabel tip="Record the event relationship and evidence supporting the dependency assessment.">Justification</InfoLabel>
            <textarea rows={2} value={st.dependencyJustification} onChange={e => patch({ dependencyJustification: e.target.value })} className={`${inputCls} resize-y`} />
          </div>
        </>}
      </div>
      <div>
        <InfoLabel tip="Central equal-tail interval from the SPAR-H beta approximation to constrained-noninformative uncertainty around the final mean HEP.">Uncertainty confidence</InfoLabel>
        <select value={st.uncertaintyConfidence} onChange={e => patch({ uncertaintyConfidence: e.target.value })} className={inputCls}>
          <option value="0.80">80%</option><option value="0.90">90%</option><option value="0.95">95%</option>
        </select>
      </div>
    </>
  )

  const barData = res ? Object.entries(res.applied)
    .filter(([, v]) => typeof v.multiplier === 'number')
    .map(([k, v]) => ({ psf: SPARH_PSFS.find(p => p.key === k)?.label ?? k, mult: v.multiplier as number })) : []

  const results = res && (
    <div ref={resultsRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">SPAR-H Result</h3>
        <ExportResultsButton getElement={() => resultsRef.current} baseName="spar_h" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card label="Human error probability" value={fmtHep(res.hep)} accent />
        <Card label="Independent HEP" value={fmtHep(res.independent_hep)} tip="HEP after PSFs and the minimum cutoff, before formal dependency." />
        <Card label="Dependency" value={res.dependency.applied ? res.dependency.level : 'None'} tip={res.dependency.source} />
        <Card label={`${Math.round(res.uncertainty.confidence * 100)}% uncertainty interval`}
          value={`${fmtHep(res.uncertainty.lower)} – ${fmtHep(res.uncertainty.upper)}`}
          tip="Equal-tail beta interval around the final mean HEP; it does not include uncertainty in discrete PSF classification." />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card label="Nominal" value={fmtHep(res.nominal)} />
        <Card label="Negative PSFs" value={String(res.n_negative_psfs)} />
        <Card label="Multi-PSF adjustment" value={res.adjustment_applied ? 'Applied (≥3 neg.)' : 'None'} tip="When ≥3 PSFs worsen performance, the NUREG/CR-6883 correction keeps HEP ≤ 1." />
        <Card label="Beta parameters" value={res.uncertainty.alpha == null ? 'Degenerate' : `α ${res.uncertainty.alpha.toPrecision(3)}, β ${res.uncertainty.beta!.toPrecision(3)}`}
          tip={res.uncertainty.parameter_source} />
      </div>
      {res.guaranteed_failure && (
        <div className="mb-5 p-3 rounded-lg border bg-red-50 border-red-200 text-red-700 text-xs">
          A guaranteed-failure PSF level (inadequate time or unfit for duty) sets HEP = 1.0.
        </div>
      )}
      {res.minimum_cutoff_applied && (
        <div className="mb-5 p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-xs">
          The SPAR-H minimum HEP cutoff of 1×10⁻⁵ was applied after the PSF calculation.
        </div>
      )}
      <p className="text-[11px] text-gray-500 mb-4 leading-snug">{res.psf_dependence_note}</p>
      {barData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
          <Plot
            data={[{ type: 'bar', orientation: 'h', x: barData.map(d => d.mult), y: barData.map(d => d.psf), marker: { color: '#e11d48' } } as Plotly.Data]}
            layout={{ title: { text: 'PSF multipliers', font: { size: 13 } }, xaxis: { title: { text: 'Multiplier' }, type: 'log' }, yaxis: { automargin: true }, margin: { t: 40, r: 20, b: 45, l: 120 }, paper_bgcolor: 'white', plot_bgcolor: 'white' } as Partial<Plotly.Layout>}
            config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
        </div>
      )}
    </div>
  )

  return (
    <ToolLayout
      intro="SPAR-H (NUREG/CR-6883) — rate the eight performance shaping factors, optionally assess formal dependency on a preceding HFE, and report beta-approximated uncertainty around the final mean HEP."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Compute HEP" results={results} />
  )
}
