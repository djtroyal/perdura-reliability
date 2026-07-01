import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeSparH, SparHResponse } from '../../api/hra'
import { useModuleState } from '../../store/project'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { inputCls } from '../shared/styles'
import { SPARH_PSFS, fmtHep } from './tables'

interface State { taskType: string; psfs: Record<string, string>; result: SparHResponse | null }
const nominalPsfs = () => Object.fromEntries(SPARH_PSFS.map(p => [p.key, 'nominal']))
const INITIAL: State = { taskType: 'action', psfs: nominalPsfs(), result: null }
const EXAMPLE: State = {
  taskType: 'diagnosis',
  psfs: { ...nominalPsfs(), stress: 'high', complexity: 'highly_complex', experience: 'low', procedures: 'available_poor' },
  result: null,
}

export default function SparH() {
  const [st, setSt] = useModuleState<State>('hraSparH', INITIAL)
  const patch = (p: Partial<State>) => setSt(prev => ({ ...prev, ...p }))
  const setPsf = (k: string, v: string) => patch({ psfs: { ...st.psfs, [k]: v } })
  const res = st.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await computeSparH({ task_type: st.taskType, psfs: st.psfs })
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
        <Card label="Nominal" value={fmtHep(res.nominal)} />
        <Card label="Negative PSFs" value={String(res.n_negative_psfs)} />
        <Card label="Adjustment" value={res.adjustment_applied ? 'Applied (≥3 neg.)' : 'None'} tip="When ≥3 PSFs worsen performance, the NUREG/CR-6883 correction keeps HEP ≤ 1." />
      </div>
      {res.guaranteed_failure && (
        <div className="mb-5 p-3 rounded-lg border bg-red-50 border-red-200 text-red-700 text-xs">
          A guaranteed-failure PSF level (inadequate time or unfit for duty) sets HEP = 1.0.
        </div>
      )}
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
      intro="SPAR-H — choose the task type and rate the 8 performance shaping factors. HEP = nominal × Π(PSF multipliers), with the NUREG/CR-6883 correction applied automatically when 3 or more PSFs worsen performance."
      controls={controls} err={error} loading={loading} onRun={run} runLabel="Compute HEP" results={results} />
  )
}
