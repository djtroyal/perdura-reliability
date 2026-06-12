import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Play, Plus, Trash2 } from 'lucide-react'
import {
  computeSNCurve, computeStressStrain, computeCreepLife,
  computeLinearDamage, computeFracture,
  SNCurveResponse, StressStrainResponse, CreepResponse,
  DamageResponse, FractureResponse,
} from '../../api/client'
import { useModuleState } from '../../store/project'

type SubTab = 'sn' | 'stress-strain' | 'creep' | 'damage' | 'fracture'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'sn', label: 'S-N Curve' },
  { id: 'stress-strain', label: 'Stress-Strain' },
  { id: 'creep', label: 'Creep Life' },
  { id: 'damage', label: "Miner's Rule" },
  { id: 'fracture', label: 'Fracture Mechanics' },
]

// --- Miner's Rule row ---
interface DamageRow {
  stress: string
  cyclesApplied: string
  cyclesToFailure: string
}

// --- Module state ---
interface PoFState {
  subTab: SubTab

  // SN Curve
  snStress: string
  snCycles: string
  snStressQuery: string
  snLifeQuery: string
  snResult?: SNCurveResponse | null

  // Stress-Strain
  ssE: string
  ssK: string
  ssN: string
  ssSigmaY: string
  ssMaxStress: string
  ssResult?: StressStrainResponse | null

  // Creep Life
  crTemp: string
  crStress: string
  crC: string
  crLmpA: string
  crLmpB: string
  crResult?: CreepResponse | null

  // Miner's Rule
  dmgRows: DamageRow[]
  dmgResult?: DamageResponse | null

  // Fracture Mechanics
  frSigma: string
  frA: string
  frY: string
  frKIc: string
  frC: string
  frM: string
  frAInitial: string
  frDeltaSigma: string
  frResult?: FractureResponse | null
}

const INITIAL_STATE: PoFState = {
  subTab: 'sn',

  snStress: '',
  snCycles: '',
  snStressQuery: '',
  snLifeQuery: '',

  ssE: '200000',
  ssK: '1200',
  ssN: '0.15',
  ssSigmaY: '',
  ssMaxStress: '',

  crTemp: '500',
  crStress: '100',
  crC: '20',
  crLmpA: '25',
  crLmpB: '-0.01',

  dmgRows: [{ stress: '', cyclesApplied: '', cyclesToFailure: '' }],

  frSigma: '100',
  frA: '0.005',
  frY: '1.12',
  frKIc: '50',
  frC: '',
  frM: '',
  frAInitial: '',
  frDeltaSigma: '',
}

const parseNumbers = (text: string) =>
  text.split(/[\s,\n]+/).map(Number).filter(n => !isNaN(n))

export default function PhysicsOfFailure() {
  const [s, setS] = useModuleState<PoFState>('pof', INITIAL_STATE)
  const patch = (p: Partial<PoFState>) => setS(prev => ({ ...prev, ...p }))
  const subTab = s.subTab

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---------- SN Curve ----------
  const runSN = async () => {
    const stress = parseNumbers(s.snStress)
    const cycles = parseNumbers(s.snCycles)
    if (stress.length < 3 || cycles.length < 3) {
      setError('Enter at least 3 data points for stress and cycles.'); return
    }
    if (stress.length !== cycles.length) {
      setError('Stress amplitudes and cycles must have equal length.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeSNCurve({
        stress_amplitude: stress,
        cycles_to_failure: cycles,
        stress_query: s.snStressQuery.trim() ? parseFloat(s.snStressQuery) : null,
        life_query: s.snLifeQuery.trim() ? parseFloat(s.snLifeQuery) : null,
      })
      patch({ snResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing S-N curve.')
    } finally { setLoading(false) }
  }

  // ---------- Stress-Strain ----------
  const runSS = async () => {
    const E = parseFloat(s.ssE)
    if (isNaN(E) || E <= 0) { setError('Young\'s modulus E must be positive.'); return }
    setError(null); setLoading(true)
    try {
      const res = await computeStressStrain({
        E,
        K: s.ssK.trim() ? parseFloat(s.ssK) : undefined,
        n: s.ssN.trim() ? parseFloat(s.ssN) : undefined,
        sigma_y: s.ssSigmaY.trim() ? parseFloat(s.ssSigmaY) : null,
        max_stress: s.ssMaxStress.trim() ? parseFloat(s.ssMaxStress) : null,
      })
      patch({ ssResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing stress-strain.')
    } finally { setLoading(false) }
  }

  // ---------- Creep Life ----------
  const runCreep = async () => {
    const temp = parseFloat(s.crTemp)
    const stress = parseFloat(s.crStress)
    if (isNaN(temp) || isNaN(stress)) { setError('Temperature and stress are required.'); return }
    const C = s.crC.trim() ? parseFloat(s.crC) : undefined
    const a = parseFloat(s.crLmpA)
    const b = parseFloat(s.crLmpB)
    if (isNaN(a) || isNaN(b)) { setError('LMP coefficients a and b are required.'); return }
    setError(null); setLoading(true)
    try {
      const res = await computeCreepLife({
        temperature_C: temp,
        stress_MPa: stress,
        C,
        lmp_coeffs: [a, b],
      })
      patch({ crResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing creep life.')
    } finally { setLoading(false) }
  }

  // ---------- Miner's Rule ----------
  const dmgRows = s.dmgRows
  const addDmgRow = () =>
    patch({ dmgRows: [...dmgRows, { stress: '', cyclesApplied: '', cyclesToFailure: '' }] })
  const removeDmgRow = (idx: number) =>
    patch({ dmgRows: dmgRows.filter((_, i) => i !== idx) })
  const updateDmgRow = (idx: number, field: keyof DamageRow, value: string) =>
    patch({ dmgRows: dmgRows.map((r, i) => i === idx ? { ...r, [field]: value } : r) })

  const runDamage = async () => {
    const stressLevels = dmgRows.map(r => parseFloat(r.stress))
    const cyclesApplied = dmgRows.map(r => parseFloat(r.cyclesApplied))
    const cyclesToFailure = dmgRows.map(r => parseFloat(r.cyclesToFailure))
    if (stressLevels.some(isNaN) || cyclesApplied.some(isNaN) || cyclesToFailure.some(isNaN)) {
      setError('All fields in every row must be valid numbers.'); return
    }
    if (dmgRows.length === 0) { setError('Add at least one stress level row.'); return }
    setError(null); setLoading(true)
    try {
      const res = await computeLinearDamage({
        stress_levels: stressLevels,
        cycles_applied: cyclesApplied,
        cycles_to_failure: cyclesToFailure,
      })
      patch({ dmgResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing damage.')
    } finally { setLoading(false) }
  }

  // ---------- Fracture Mechanics ----------
  const runFracture = async () => {
    const sigma = parseFloat(s.frSigma)
    const a = parseFloat(s.frA)
    const Y = parseFloat(s.frY)
    const K_Ic = parseFloat(s.frKIc)
    if (isNaN(sigma) || isNaN(a) || isNaN(Y) || isNaN(K_Ic)) {
      setError('sigma, a, Y, and K_Ic are required.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeFracture({
        sigma, a, Y, K_Ic,
        C: s.frC.trim() ? parseFloat(s.frC) : undefined,
        m: s.frM.trim() ? parseFloat(s.frM) : undefined,
        a_initial: s.frAInitial.trim() ? parseFloat(s.frAInitial) : null,
        delta_sigma: s.frDeltaSigma.trim() ? parseFloat(s.frDeltaSigma) : null,
      })
      patch({ frResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing fracture.')
    } finally { setLoading(false) }
  }

  // ---------- Render helpers ----------
  const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400'
  const labelCls = 'block text-xs font-medium text-gray-700 mb-1'
  const textareaCls = 'w-full h-20 text-xs border border-gray-300 rounded p-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-400'

  const runBtn = (onClick: () => void, label: string) => (
    <button onClick={onClick} disabled={loading}
      className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
      <Play size={12} /> {loading ? 'Computing...' : label}
    </button>
  )

  // ========== LEFT PANEL ==========
  const renderLeftPanel = () => {
    switch (subTab) {
      case 'sn':
        return (
          <>
            <div>
              <label className={labelCls}>
                Stress amplitudes <span className="text-gray-400">(comma-separated)</span>
              </label>
              <textarea value={s.snStress} onChange={e => patch({ snStress: e.target.value })}
                className={textareaCls} placeholder="400, 350, 300, 250, 200..." />
            </div>
            <div>
              <label className={labelCls}>
                Cycles to failure <span className="text-gray-400">(comma-separated)</span>
              </label>
              <textarea value={s.snCycles} onChange={e => patch({ snCycles: e.target.value })}
                className={textareaCls} placeholder="1e4, 3e4, 1e5, 3e5, 1e6..." />
            </div>
            <div>
              <label className={labelCls}>
                Stress query <span className="text-gray-400">(optional, predict life)</span>
              </label>
              <input type="number" step="any" value={s.snStressQuery}
                onChange={e => patch({ snStressQuery: e.target.value })}
                className={inputCls} placeholder="e.g. 275" />
            </div>
            <div>
              <label className={labelCls}>
                Life query <span className="text-gray-400">(optional, predict stress)</span>
              </label>
              <input type="number" step="any" value={s.snLifeQuery}
                onChange={e => patch({ snLifeQuery: e.target.value })}
                className={inputCls} placeholder="e.g. 500000" />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runSN, 'Fit S-N Curve')}
          </>
        )

      case 'stress-strain':
        return (
          <>
            <div>
              <label className={labelCls}>E (Young's modulus, MPa)</label>
              <input type="number" step="any" value={s.ssE}
                onChange={e => patch({ ssE: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>K (strength coefficient, MPa)</label>
              <input type="number" step="any" value={s.ssK}
                onChange={e => patch({ ssK: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>n (strain hardening exponent)</label>
              <input type="number" step="any" value={s.ssN}
                onChange={e => patch({ ssN: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>
                Yield stress, sigma_y <span className="text-gray-400">(optional, MPa)</span>
              </label>
              <input type="number" step="any" value={s.ssSigmaY}
                onChange={e => patch({ ssSigmaY: e.target.value })}
                className={inputCls} placeholder="e.g. 250" />
            </div>
            <div>
              <label className={labelCls}>
                Max stress <span className="text-gray-400">(optional, MPa)</span>
              </label>
              <input type="number" step="any" value={s.ssMaxStress}
                onChange={e => patch({ ssMaxStress: e.target.value })}
                className={inputCls} placeholder="e.g. 500" />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runSS, 'Compute Stress-Strain')}
          </>
        )

      case 'creep':
        return (
          <>
            <div>
              <label className={labelCls}>Temperature (deg C)</label>
              <input type="number" step="any" value={s.crTemp}
                onChange={e => patch({ crTemp: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Stress (MPa)</label>
              <input type="number" step="any" value={s.crStress}
                onChange={e => patch({ crStress: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>C (Larson-Miller constant)</label>
              <input type="number" step="any" value={s.crC}
                onChange={e => patch({ crC: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>LMP coefficient a</label>
              <input type="number" step="any" value={s.crLmpA}
                onChange={e => patch({ crLmpA: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>LMP coefficient b</label>
              <input type="number" step="any" value={s.crLmpB}
                onChange={e => patch({ crLmpB: e.target.value })}
                className={inputCls} />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runCreep, 'Compute Creep Life')}
          </>
        )

      case 'damage':
        return (
          <>
            <p className="text-xs text-gray-500">
              Enter stress levels with applied and failure cycles for each.
            </p>
            <div className="flex flex-col gap-2">
              {dmgRows.map((row, i) => (
                <div key={i} className="border border-gray-200 rounded p-2 flex flex-col gap-1 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-medium">Level {i + 1}</span>
                    {dmgRows.length > 1 && (
                      <button onClick={() => removeDmgRow(i)}
                        className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Stress</label>
                    <input type="number" step="any" value={row.stress}
                      onChange={e => updateDmgRow(i, 'stress', e.target.value)}
                      className={inputCls} placeholder="e.g. 300" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Cycles applied</label>
                    <input type="number" step="any" value={row.cyclesApplied}
                      onChange={e => updateDmgRow(i, 'cyclesApplied', e.target.value)}
                      className={inputCls} placeholder="e.g. 10000" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Cycles to failure</label>
                    <input type="number" step="any" value={row.cyclesToFailure}
                      onChange={e => updateDmgRow(i, 'cyclesToFailure', e.target.value)}
                      className={inputCls} placeholder="e.g. 100000" />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addDmgRow}
              className="flex items-center justify-center gap-1 border border-blue-600 text-blue-600 hover:bg-blue-50 text-xs font-medium py-1.5 rounded transition-colors">
              <Plus size={12} /> Add stress level
            </button>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runDamage, 'Compute Damage')}
          </>
        )

      case 'fracture':
        return (
          <>
            <p className="text-xs text-gray-500 mb-1">
              Linear elastic fracture mechanics (LEFM) assessment.
            </p>
            <div>
              <label className={labelCls}>Applied stress, sigma (MPa)</label>
              <input type="number" step="any" value={s.frSigma}
                onChange={e => patch({ frSigma: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Crack length, a (m)</label>
              <input type="number" step="any" value={s.frA}
                onChange={e => patch({ frA: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Geometry factor, Y</label>
              <input type="number" step="any" value={s.frY}
                onChange={e => patch({ frY: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Fracture toughness, K_Ic (MPa*m^0.5)</label>
              <input type="number" step="any" value={s.frKIc}
                onChange={e => patch({ frKIc: e.target.value })}
                className={inputCls} />
            </div>
            <hr className="border-gray-200" />
            <p className="text-[10px] text-gray-500">
              Optional: Paris law crack growth (provide C, m, a_initial, delta_sigma)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>C (Paris law)</label>
                <input type="number" step="any" value={s.frC}
                  onChange={e => patch({ frC: e.target.value })}
                  className={inputCls} placeholder="e.g. 1e-11" />
              </div>
              <div>
                <label className={labelCls}>m (Paris law)</label>
                <input type="number" step="any" value={s.frM}
                  onChange={e => patch({ frM: e.target.value })}
                  className={inputCls} placeholder="e.g. 3" />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Initial crack length, a_initial <span className="text-gray-400">(m)</span>
              </label>
              <input type="number" step="any" value={s.frAInitial}
                onChange={e => patch({ frAInitial: e.target.value })}
                className={inputCls} placeholder="e.g. 0.001" />
            </div>
            <div>
              <label className={labelCls}>
                Stress range, delta_sigma <span className="text-gray-400">(MPa)</span>
              </label>
              <input type="number" step="any" value={s.frDeltaSigma}
                onChange={e => patch({ frDeltaSigma: e.target.value })}
                className={inputCls} placeholder="e.g. 150" />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runFracture, 'Analyze Fracture')}
          </>
        )
    }
  }

  // ========== MAIN CONTENT ==========
  const renderMainContent = () => {
    switch (subTab) {
      case 'sn': {
        const r = s.snResult
        if (!r) return <EmptyState text="Enter S-N data and click Fit S-N Curve" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="A (intercept)" value={r.A.toExponential(4)} />
              <Card label="b (exponent)" value={r.b.toFixed(4)} />
              <Card label="R-squared" value={r.r_squared.toFixed(4)} />
              <Card label="Endurance limit" value={`${r.endurance_limit.toFixed(1)} MPa`} />
            </div>
            {r.prediction && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {r.prediction.cycles != null && (
                  <Card label="Predicted life (cycles)" value={r.prediction.cycles.toExponential(3)} accent />
                )}
                {r.prediction.stress != null && (
                  <Card label="Predicted stress (MPa)" value={r.prediction.stress.toFixed(1)} accent />
                )}
              </div>
            )}
            {/* Plot */}
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: parseNumbers(s.snCycles),
                    y: parseNumbers(s.snStress),
                    mode: 'markers',
                    name: 'Data',
                    marker: { color: '#ef4444', size: 8 },
                  } as Plotly.Data,
                  {
                    x: r.curve.n,
                    y: r.curve.s,
                    mode: 'lines',
                    name: 'Basquin fit',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Cycles to Failure (N)' }, type: 'log', gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Stress Amplitude (MPa)' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.7, y: 0.95, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'stress-strain': {
        const r = s.ssResult
        if (!r) return <EmptyState text="Set material properties and click Compute Stress-Strain" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-3 gap-3 mb-6">
              <Card label="E (MPa)" value={r.E.toLocaleString()} />
              <Card label="K (MPa)" value={r.K.toLocaleString()} />
              <Card label="n" value={r.n.toFixed(4)} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.strain_total, y: r.stress,
                    mode: 'lines', name: 'Total strain',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: r.strain_elastic, y: r.stress,
                    mode: 'lines', name: 'Elastic strain',
                    line: { color: '#10b981', width: 1.5, dash: 'dash' },
                  } as Plotly.Data,
                  {
                    x: r.strain_plastic, y: r.stress,
                    mode: 'lines', name: 'Plastic strain',
                    line: { color: '#f59e0b', width: 1.5, dash: 'dot' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Strain' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Stress (MPa)' }, gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'creep': {
        const r = s.crResult
        if (!r) return <EmptyState text="Set creep parameters and click Compute Creep Life" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-3 gap-3 mb-6">
              <Card label="Larson-Miller Parameter" value={r.lmp.toFixed(1)} accent />
              <Card label="Temperature (K)" value={r.temperature_K.toFixed(1)} />
              <Card label="Time to rupture (hours)" value={r.time_to_rupture_hours.toExponential(3)} accent />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.temperature_C, y: r.curve.time_hours,
                    mode: 'lines', name: 'Rupture time vs T',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: [parseFloat(s.crTemp)],
                    y: [r.time_to_rupture_hours],
                    mode: 'markers', name: 'Operating point',
                    marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Temperature (deg C)' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Time to Rupture (hours)' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'damage': {
        const r = s.dmgResult
        if (!r) return <EmptyState text="Enter stress levels and click Compute Damage" />
        const damageColor = r.total_damage >= 1 ? 'text-red-700' :
          r.total_damage >= 0.5 ? 'text-amber-600' : 'text-green-700'
        const damageBg = r.total_damage >= 1 ? 'bg-red-50 border-red-200' :
          r.total_damage >= 0.5 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
        return (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className={`rounded-lg border p-3 ${damageBg}`}>
                <p className="text-xs text-gray-500">Total damage (D)</p>
                <p className={`text-2xl font-bold ${damageColor}`}>{r.total_damage.toFixed(4)}</p>
              </div>
              <div className={`rounded-lg border p-3 ${damageBg}`}>
                <p className="text-xs text-gray-500">Remaining life</p>
                <p className={`text-2xl font-bold ${damageColor}`}>
                  {(r.remaining_life_fraction * 100).toFixed(1)}%
                </p>
              </div>
              <div className={`rounded-lg border p-3 ${r.failed ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-lg font-bold ${r.failed ? 'text-red-700' : 'text-green-700'}`}>
                  {r.failed ? 'FAILED' : 'SAFE'}
                </p>
              </div>
            </div>
            {/* Stacked bar chart */}
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
              <Plot
                data={r.damage_fractions.map((d, i) => ({
                  x: ['Cumulative Damage'],
                  y: [d],
                  type: 'bar',
                  name: `Level ${i + 1} (${(d * 100).toFixed(1)}%)`,
                  marker: {
                    color: ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'][i % 6],
                  },
                } as Plotly.Data))}
                layout={{
                  barmode: 'stack',
                  yaxis: { title: { text: 'Damage Fraction' }, gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 40, l: 60 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { font: { size: 10 } },
                  showlegend: true,
                  shapes: [{
                    type: 'line', x0: -0.5, x1: 0.5, y0: 1, y1: 1,
                    line: { color: '#ef4444', width: 2, dash: 'dash' },
                  }],
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'fracture': {
        const r = s.frResult
        if (!r) return <EmptyState text="Enter fracture parameters and click Analyze Fracture" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="K_I (MPa*m^0.5)" value={r.K_I.toFixed(2)} />
              <Card label="K_Ic (MPa*m^0.5)" value={r.K_Ic.toFixed(2)} />
              <div className={`rounded-lg border p-3 ${r.critical ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-lg font-bold ${r.critical ? 'text-red-700' : 'text-green-700'}`}>
                  {r.critical ? 'CRITICAL' : 'SAFE'}
                </p>
              </div>
              <Card label="Critical crack length (m)" value={r.critical_crack_length.toExponential(3)} />
            </div>
            {/* K_I vs K_Ic bar comparison */}
            <div className="grid gap-4" style={{ gridTemplateColumns: r.crack_growth_curve ? '1fr 1fr' : '1fr' }}>
              <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
                <Plot
                  data={[
                    {
                      x: ['K_I', 'K_Ic'],
                      y: [r.K_I, r.K_Ic],
                      type: 'bar',
                      marker: {
                        color: [r.critical ? '#ef4444' : '#3b82f6', '#10b981'],
                      },
                    } as Plotly.Data,
                  ]}
                  layout={{
                    yaxis: { title: { text: 'Stress Intensity (MPa*m^0.5)' }, gridcolor: '#e5e7eb' },
                    margin: { t: 20, r: 20, b: 40, l: 70 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                    showlegend: false,
                  } as Partial<Plotly.Layout>}
                  config={{ responsive: true }}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler
                />
              </div>
              {r.crack_growth_curve && (
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
                  <Plot
                    data={[
                      {
                        x: r.crack_growth_curve.cycles,
                        y: r.crack_growth_curve.a,
                        mode: 'lines', name: 'Crack length vs N',
                        line: { color: '#3b82f6', width: 2 },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      xaxis: { title: { text: 'Cycles (N)' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Crack Length a (m)' }, gridcolor: '#e5e7eb' },
                      margin: { t: 20, r: 20, b: 50, l: 70 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      showlegend: false,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              )}
            </div>
          </div>
        )
      }
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Sub-tab selector */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex gap-1">
        {SUB_TABS.map(tab => (
          <button key={tab.id}
            onClick={() => { patch({ subTab: tab.id }); setError(null) }}
            className={`px-3 py-1.5 text-xs rounded font-medium border transition-colors ${
              subTab === tab.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 text-gray-600 hover:bg-gray-100'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body: left panel + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
          {renderLeftPanel()}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {renderMainContent()}
        </div>
      </div>
    </div>
  )
}

// --- Small shared components ---

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-gray-400">
      <div className="text-center">
        <p className="text-lg font-medium">No results yet</p>
        <p className="text-sm mt-1">{text}</p>
      </div>
    </div>
  )
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
