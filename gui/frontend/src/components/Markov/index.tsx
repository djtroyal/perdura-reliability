import { useState, useCallback, useMemo } from 'react'
import Plot from '../shared/ExportablePlot'
import {
  Play, Plus, Trash2, Download, Circle, ArrowRight, Settings,
  BarChart3, Table, Activity, Loader2, Info,
} from 'lucide-react'
import {
  analyzeMarkov, getMarkovExample,
  MarkovStateInput, MarkovTransitionInput, MarkovResponse,
} from '../../api/client'
import NumberField from '../shared/NumberField'

const STATE_COLORS: Record<string, { bg: string; border: string; text: string; fill: string }> = {
  operational: { bg: 'bg-emerald-100', border: 'border-emerald-500', text: 'text-emerald-700', fill: '#10b981' },
  degraded: { bg: 'bg-amber-100', border: 'border-amber-500', text: 'text-amber-700', fill: '#f59e0b' },
  failed: { bg: 'bg-red-100', border: 'border-red-500', text: 'text-red-700', fill: '#ef4444' },
}

const EXAMPLE_MODELS = [
  { key: 'simple_repairable', label: 'Simple Repairable (2-state)' },
  { key: 'standby_redundancy', label: 'Standby Redundancy (1+1)' },
  { key: 'tmr', label: 'Triple Modular Redundancy' },
]

let _nextStateId = 3

export default function Markov() {
  const [states, setStates] = useState<MarkovStateInput[]>([
    { id: 'op', name: 'Operating', state_type: 'operational', description: '' },
    { id: 'failed', name: 'Failed', state_type: 'failed', description: '' },
  ])
  const [transitions, setTransitions] = useState<MarkovTransitionInput[]>([
    { from_state: 'op', to_state: 'failed', rate: 0.001, label: 'λ' },
    { from_state: 'failed', to_state: 'op', rate: 0.1, label: 'μ' },
  ])

  const [tMax, setTMax] = useState(10000)
  const [nPoints, setNPoints] = useState(100)
  const [initialState, setInitialState] = useState('')

  const [result, setResult] = useState<MarkovResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [resultTab, setResultTab] = useState<'params' | 'probs' | 'availability' | 'matrix' | 'data'>('params')

  // --- State management ---
  const addState = useCallback(() => {
    const id = `s${_nextStateId++}`
    setStates(prev => [...prev, { id, name: `State ${id}`, state_type: 'operational', description: '' }])
  }, [])

  const removeState = useCallback((id: string) => {
    setStates(prev => prev.filter(s => s.id !== id))
    setTransitions(prev => prev.filter(t => t.from_state !== id && t.to_state !== id))
  }, [])

  const updateState = useCallback((id: string, field: keyof MarkovStateInput, value: string) => {
    setStates(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }, [])

  // --- Transition management ---
  const addTransition = useCallback(() => {
    if (states.length < 2) return
    setTransitions(prev => [...prev, {
      from_state: states[0].id, to_state: states[1].id, rate: 0.001, label: '',
    }])
  }, [states])

  const removeTransition = useCallback((idx: number) => {
    setTransitions(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const updateTransition = useCallback((idx: number, field: keyof MarkovTransitionInput, value: string | number) => {
    setTransitions(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t))
  }, [])

  // --- Load example ---
  const loadExample = useCallback(async (key: string) => {
    try {
      const ex = await getMarkovExample(key)
      setStates(ex.states.map(s => ({
        id: s.id, name: s.name, state_type: s.type as MarkovStateInput['state_type'],
        description: s.description,
      })))
      setTransitions(ex.transitions.map(t => ({
        from_state: t.from, to_state: t.to, rate: t.rate, label: t.label,
      })))
      setResult(null)
      setError('')
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load example')
    }
  }, [])

  // --- Run analysis ---
  const runAnalysis = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const times = Array.from({ length: nPoints }, (_, i) => (tMax * (i + 1)) / nPoints)
      const res = await analyzeMarkov({
        states, transitions, times,
        initial_state: initialState || undefined,
      })
      setResult(res)
      setResultTab('params')
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Analysis failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [states, transitions, tMax, nPoints, initialState])

  // --- State diagram (SVG) ---
  const diagram = useMemo(() => {
    const w = 580, h = 360
    const cx = w / 2, cy = h / 2
    const R = Math.min(w, h) * 0.32
    const nodeR = 30

    const positions = states.map((s, i) => {
      const angle = (2 * Math.PI * i) / states.length - Math.PI / 2
      return { ...s, x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) }
    })
    const posMap = Object.fromEntries(positions.map(p => [p.id, p]))

    const ssProbs = result?.steady_state ?? {}

    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6b7280" />
          </marker>
        </defs>
        {/* Transitions */}
        {transitions.map((t, i) => {
          const from = posMap[t.from_state]
          const to = posMap[t.to_state]
          if (!from || !to) return null
          if (t.from_state === t.to_state) {
            const lx = from.x, ly = from.y - nodeR - 20
            return (
              <g key={`t${i}`}>
                <path d={`M ${from.x - 10} ${from.y - nodeR} C ${lx - 30} ${ly - 20} ${lx + 30} ${ly - 20} ${from.x + 10} ${from.y - nodeR}`}
                  fill="none" stroke="#9ca3af" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
                <text x={lx} y={ly - 22} textAnchor="middle" fontSize="9" fill="#6b7280">
                  {t.label || t.rate}
                </text>
              </g>
            )
          }
          const dx = to.x - from.x, dy = to.y - from.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const ux = dx / dist, uy = dy / dist
          const x1 = from.x + ux * nodeR, y1 = from.y + uy * nodeR
          const x2 = to.x - ux * (nodeR + 8), y2 = to.y - uy * (nodeR + 8)
          const mx = (x1 + x2) / 2 - uy * 15, my = (y1 + y2) / 2 + ux * 15
          return (
            <g key={`t${i}`}>
              <path d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                fill="none" stroke="#9ca3af" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
              <text x={mx} y={my - 4} textAnchor="middle" fontSize="9" fill="#6b7280"
                fontFamily="monospace">
                {t.label ? `${t.label}=${t.rate}` : String(t.rate)}
              </text>
            </g>
          )
        })}
        {/* States */}
        {positions.map(s => {
          const colors = STATE_COLORS[s.state_type] ?? STATE_COLORS.operational
          const prob = ssProbs[s.id]
          return (
            <g key={s.id}>
              <circle cx={s.x} cy={s.y} r={nodeR} fill={colors.fill} fillOpacity={0.2}
                stroke={colors.fill} strokeWidth="2" />
              <text x={s.x} y={s.y - 4} textAnchor="middle" fontSize="10" fontWeight="600"
                fill={colors.fill}>{s.name}</text>
              {prob != null && (
                <text x={s.x} y={s.y + 10} textAnchor="middle" fontSize="9"
                  fill="#6b7280" fontFamily="monospace">{(prob * 100).toFixed(2)}%</text>
              )}
            </g>
          )
        })}
      </svg>
    )
  }, [states, transitions, result])

  // --- Result plots ---
  const sp = result?.system_params
  const td = result?.time_dependent

  const probPlot = useMemo(() => {
    if (!td || !td.length) return null
    const traces = states.map(s => ({
      x: td.map(e => e.time),
      y: td.map(e => e.state_probs[s.id] ?? 0),
      name: s.name,
      mode: 'lines' as const,
      line: { color: STATE_COLORS[s.state_type]?.fill ?? '#888' },
    }))
    return traces
  }, [td, states])

  const availPlot = useMemo(() => {
    if (!td || !td.length) return null
    return [
      { x: td.map(e => e.time), y: td.map(e => e.availability), name: 'Availability A(t)', line: { color: '#10b981' } },
      { x: td.map(e => e.time), y: td.map(e => e.reliability), name: 'Reliability R(t)', line: { color: '#3b82f6', dash: 'dash' } },
      { x: td.map(e => e.time), y: td.map(e => e.unavailability), name: 'Unavailability U(t)', line: { color: '#ef4444', dash: 'dot' } },
    ]
  }, [td])

  // export data
  const exportData = useMemo(() => {
    if (!result) return null
    const rows: Record<string, string | number | null>[] = []
    if (sp) {
      rows.push(
        { Parameter: 'Availability (SS)', Value: sp.availability_ss },
        { Parameter: 'Unavailability (SS)', Value: sp.unavailability_ss },
        { Parameter: 'MTTF', Value: sp.mttf },
        { Parameter: 'MTBF', Value: sp.mtbf },
        { Parameter: 'MTTR', Value: sp.mttr },
        { Parameter: 'Failure Frequency', Value: sp.failure_frequency },
        { Parameter: 'Repair Frequency', Value: sp.repair_frequency },
      )
    }
    return rows
  }, [result, sp])

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Editor */}
        <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
          {/* Example loader */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Load Example</label>
            <select onChange={e => e.target.value && loadExample(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
              defaultValue="">
              <option value="">— Select example —</option>
              {EXAMPLE_MODELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          <hr className="border-gray-200" />

          {/* States */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-gray-700">States</h3>
              <button onClick={addState} className="text-blue-600 hover:text-blue-800">
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-2">
              {states.map(s => {
                const colors = STATE_COLORS[s.state_type] ?? STATE_COLORS.operational
                return (
                  <div key={s.id} className={`p-2 rounded border ${colors.border} ${colors.bg}`}>
                    <div className="flex items-center gap-1 mb-1">
                      <Circle size={8} fill={colors.fill} stroke="none" className="flex-shrink-0" />
                      <input value={s.name} onChange={e => updateState(s.id, 'name', e.target.value)}
                        className="flex-1 text-xs font-medium bg-transparent border-none outline-none" />
                      <button onClick={() => removeState(s.id)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <select value={s.state_type}
                        onChange={e => updateState(s.id, 'state_type', e.target.value)}
                        className="text-[10px] border border-gray-300 rounded px-1 py-0.5 bg-white">
                        <option value="operational">Operational</option>
                        <option value="degraded">Degraded</option>
                        <option value="failed">Failed</option>
                      </select>
                      <span className="text-[10px] text-gray-400 ml-auto font-mono">{s.id}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <hr className="border-gray-200" />

          {/* Transitions */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-gray-700">Transitions</h3>
              <button onClick={addTransition} className="text-blue-600 hover:text-blue-800"
                disabled={states.length < 2}>
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-2">
              {transitions.map((t, i) => (
                <div key={i} className="flex items-center gap-1 bg-gray-50 rounded p-1.5 border border-gray-200">
                  <select value={t.from_state}
                    onChange={e => updateTransition(i, 'from_state', e.target.value)}
                    className="text-[10px] border rounded px-1 py-0.5 w-16 bg-white">
                    {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <ArrowRight size={10} className="text-gray-400 flex-shrink-0" />
                  <select value={t.to_state}
                    onChange={e => updateTransition(i, 'to_state', e.target.value)}
                    className="text-[10px] border rounded px-1 py-0.5 w-16 bg-white">
                    {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <NumberField value={String(t.rate)}
                    onChange={v => updateTransition(i, 'rate', parseFloat(v) || 0)}
                    step={0.001} min={0} className="!w-16 !text-[10px] !py-0.5" />
                  <input value={t.label} onChange={e => updateTransition(i, 'label', e.target.value)}
                    placeholder="λ" className="w-8 text-[10px] border rounded px-1 py-0.5" />
                  <button onClick={() => removeTransition(i)} className="text-red-400 hover:text-red-600">
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <hr className="border-gray-200" />

          {/* Analysis settings */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1">
              <Settings size={11} /> Analysis Settings
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-gray-500">t_max</label>
                <NumberField value={String(tMax)} onChange={v => setTMax(parseFloat(v) || 10000)}
                  min={1} className="!py-1 !text-xs" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500">Points</label>
                <NumberField value={String(nPoints)} onChange={v => setNPoints(parseInt(v) || 100)}
                  min={10} max={1000} className="!py-1 !text-xs" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500">Initial State</label>
              <select value={initialState} onChange={e => setInitialState(e.target.value)}
                className="w-full text-xs border rounded px-2 py-1">
                <option value="">First state ({states[0]?.name})</option>
                {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <button onClick={runAnalysis} disabled={loading || states.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Analyze
          </button>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
          )}
        </div>

        {/* Center: Diagram */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-200 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">State Transition Diagram</h3>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 bg-white">
            <div className="w-full max-w-[600px]">{diagram}</div>
          </div>
        </div>

        {/* Right panel: Results */}
        <div className="w-[420px] flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          {!result ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              <div className="text-center">
                <Info size={24} className="mx-auto mb-2 text-gray-300" />
                Run analysis to see results
              </div>
            </div>
          ) : (
            <>
              {/* Tab bar */}
              <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
                {([
                  ['params', 'System', Activity],
                  ['probs', 'Probabilities', BarChart3],
                  ['availability', 'A(t) / R(t)', Activity],
                  ['matrix', 'Matrix', Table],
                  ['data', 'Data', Settings],
                ] as [string, string, typeof Activity][]).map(([key, label, Icon]) => (
                  <button key={key} onClick={() => setResultTab(key as typeof resultTab)}
                    className={`flex-1 py-2 text-[10px] font-medium flex items-center justify-center gap-1 border-b-2 ${
                      resultTab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}>
                    <Icon size={11} />{label}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {/* System Parameters */}
                {resultTab === 'params' && sp && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-gray-700">System Parameters (Steady-State)</h4>
                    <table className="w-full text-xs">
                      <tbody>
                        {([
                          ['Availability (A_ss)', sp.availability_ss, ''],
                          ['Unavailability (U_ss)', sp.unavailability_ss, ''],
                          ['MTTF', sp.mttf, 'hours'],
                          ['MTBF', sp.mtbf, 'hours'],
                          ['MTTR', sp.mttr, 'hours'],
                          ['Failure Frequency', sp.failure_frequency, '/hr'],
                          ['Repair Frequency', sp.repair_frequency, '/hr'],
                        ] as [string, number | null, string][]).map(([label, val, unit]) => (
                          <tr key={label} className="border-t border-gray-100">
                            <td className="py-1.5 text-gray-600 font-medium">{label}</td>
                            <td className="py-1.5 text-right font-mono">
                              {val != null ? (typeof val === 'number' && val > 100 ? val.toFixed(2)
                                : typeof val === 'number' && val < 0.001 ? val.toExponential(4)
                                : typeof val === 'number' ? val.toFixed(6) : '—') : '—'}
                            </td>
                            <td className="py-1.5 pl-1 text-gray-400 text-[10px]">{unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {result.steady_state && (
                      <>
                        <h4 className="text-xs font-semibold text-gray-700 mt-4">Steady-State Probabilities</h4>
                        <div className="space-y-1">
                          {Object.entries(result.steady_state).map(([id, prob]) => {
                            const s = states.find(x => x.id === id)
                            const colors = STATE_COLORS[s?.state_type ?? 'operational']
                            return (
                              <div key={id} className="flex items-center gap-2">
                                <Circle size={8} fill={colors.fill} stroke="none" />
                                <span className="text-xs text-gray-600 flex-1">{s?.name ?? id}</span>
                                <div className="w-32 bg-gray-100 rounded-full h-3 overflow-hidden">
                                  <div className="h-full rounded-full" style={{
                                    width: `${prob * 100}%`,
                                    backgroundColor: colors.fill,
                                  }} />
                                </div>
                                <span className="text-xs font-mono w-14 text-right">{(prob * 100).toFixed(3)}%</span>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )}

                    {exportData && (
                      <div className="mt-4">
                        <button onClick={() => {
                          const csv = ['Parameter,Value', ...exportData.map(r => `${r.Parameter},${r.Value ?? ''}`)]
                            .join('\n')
                          const blob = new Blob([csv], { type: 'text/csv' })
                          const a = document.createElement('a')
                          a.href = URL.createObjectURL(blob); a.download = 'markov_results.csv'; a.click()
                        }}
                          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded bg-white">
                          <Download size={12} /> Export CSV
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* State Probabilities Plot */}
                {resultTab === 'probs' && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2">State Probabilities P_i(t)</h4>
                    {probPlot ? (
                      <Plot
                        data={probPlot.map(t => ({ ...t, mode: 'lines' as const }))}
                        layout={{
                          height: 350, margin: { t: 20, r: 20, b: 50, l: 60 },
                          xaxis: { title: { text: 'Time (hours)' } },
                          yaxis: { title: { text: 'Probability' }, range: [0, 1.05] },
                          legend: { x: 1, xanchor: 'right', y: 1 },
                          font: { size: 10 },
                        }}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: '100%' }}
                      />
                    ) : <p className="text-xs text-gray-400">No time-dependent data</p>}

                    {td && td.length > 0 && (
                      <>
                        <h4 className="text-xs font-semibold text-gray-700 mt-4 mb-2">State Probabilities Table</h4>
                        <div className="overflow-x-auto max-h-60 overflow-y-auto">
                          <table className="w-full text-[10px] font-mono">
                            <thead className="sticky top-0 bg-gray-100">
                              <tr>
                                <th className="px-2 py-1 text-left">Time</th>
                                {states.map(s => <th key={s.id} className="px-2 py-1 text-right">{s.name}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {td.filter((_, i) => i % Math.max(1, Math.floor(td.length / 20)) === 0 || i === td.length - 1).map((e, i) => (
                                <tr key={i} className="border-t border-gray-50">
                                  <td className="px-2 py-0.5">{e.time.toFixed(1)}</td>
                                  {states.map(s => (
                                    <td key={s.id} className="px-2 py-0.5 text-right">
                                      {(e.state_probs[s.id] ?? 0).toFixed(6)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Availability & Reliability */}
                {resultTab === 'availability' && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2">Availability & Reliability vs Time</h4>
                    {availPlot ? (
                      <Plot
                        data={availPlot.map(t => ({ ...t, mode: 'lines' as const }))}
                        layout={{
                          height: 350, margin: { t: 20, r: 20, b: 50, l: 60 },
                          xaxis: { title: { text: 'Time (hours)' } },
                          yaxis: { title: { text: 'Probability' }, range: [0, 1.05] },
                          legend: { x: 1, xanchor: 'right', y: 0.5 },
                          font: { size: 10 },
                        }}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: '100%' }}
                      />
                    ) : <p className="text-xs text-gray-400">No time-dependent data</p>}

                    {td && td.length > 0 && (
                      <>
                        <h4 className="text-xs font-semibold text-gray-700 mt-4 mb-2">Time-Dependent Metrics</h4>
                        <div className="overflow-x-auto max-h-60 overflow-y-auto">
                          <table className="w-full text-[10px] font-mono">
                            <thead className="sticky top-0 bg-gray-100">
                              <tr>
                                <th className="px-2 py-1 text-left">Time</th>
                                <th className="px-2 py-1 text-right">A(t)</th>
                                <th className="px-2 py-1 text-right">R(t)</th>
                                <th className="px-2 py-1 text-right">U(t)</th>
                                <th className="px-2 py-1 text-right">F(t)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {td.filter((_, i) => i % Math.max(1, Math.floor(td.length / 20)) === 0 || i === td.length - 1).map((e, i) => (
                                <tr key={i} className="border-t border-gray-50">
                                  <td className="px-2 py-0.5">{e.time.toFixed(1)}</td>
                                  <td className="px-2 py-0.5 text-right">{e.availability.toFixed(6)}</td>
                                  <td className="px-2 py-0.5 text-right">{e.reliability.toFixed(6)}</td>
                                  <td className="px-2 py-0.5 text-right">{e.unavailability.toFixed(6)}</td>
                                  <td className="px-2 py-0.5 text-right">{e.unreliability.toFixed(6)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Transition Matrix */}
                {resultTab === 'matrix' && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2">Transition Rate Matrix (Q)</h4>
                    {result.transition_matrix && (
                      <div className="overflow-x-auto">
                        <table className="text-[10px] font-mono border border-gray-200">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="px-2 py-1 border border-gray-200"></th>
                              {states.map(s => (
                                <th key={s.id} className="px-2 py-1 border border-gray-200 text-center">{s.name}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.transition_matrix.map((row, i) => (
                              <tr key={i}>
                                <td className="px-2 py-1 border border-gray-200 bg-gray-50 font-semibold">
                                  {states[i]?.name}
                                </td>
                                {row.map((val, j) => (
                                  <td key={j} className={`px-2 py-1 border border-gray-200 text-right ${
                                    i === j ? 'bg-blue-50 font-semibold' : val !== 0 ? 'bg-green-50' : ''
                                  }`}>
                                    {val === 0 ? '0' : val.toFixed(6)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Data report */}
                {resultTab === 'data' && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">States</h4>
                      <table className="w-full text-[10px]">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-1 text-left">ID</th>
                            <th className="px-2 py-1 text-left">Name</th>
                            <th className="px-2 py-1 text-left">Type</th>
                            <th className="px-2 py-1 text-right">π (SS)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.states.map(s => (
                            <tr key={s.id} className="border-t border-gray-100">
                              <td className="px-2 py-1 font-mono">{s.id}</td>
                              <td className="px-2 py-1">{s.name}</td>
                              <td className="px-2 py-1">
                                <span className={`inline-block w-2 h-2 rounded-full mr-1 ${STATE_COLORS[s.type]?.bg ?? ''}`}
                                  style={{ backgroundColor: STATE_COLORS[s.type]?.fill }} />
                                {s.type}
                              </td>
                              <td className="px-2 py-1 text-right font-mono">
                                {result.steady_state ? (result.steady_state[s.id] * 100).toFixed(4) + '%' : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">Transitions</h4>
                      <table className="w-full text-[10px]">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-1 text-left">From</th>
                            <th className="px-2 py-1 text-left">To</th>
                            <th className="px-2 py-1 text-right">Rate</th>
                            <th className="px-2 py-1 text-left">Label</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.transitions.map((t, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-2 py-1">{states.find(s => s.id === t.from)?.name ?? t.from}</td>
                              <td className="px-2 py-1">{states.find(s => s.id === t.to)?.name ?? t.to}</td>
                              <td className="px-2 py-1 text-right font-mono">{t.rate}</td>
                              <td className="px-2 py-1">{t.label}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
