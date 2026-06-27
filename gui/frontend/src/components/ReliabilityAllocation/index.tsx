import { useState } from 'react'
import { Play, Plus, Trash2 } from 'lucide-react'
import Plot from '../shared/ExportablePlot'
import { computeAllocation, AllocationRequest, AllocationResponse } from '../../api/client'
import { useFolioState, useUnits } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import InfoLabel from '../shared/InfoLabel'

type Method = 'equal' | 'arinc' | 'agree' | 'feasibility'

interface SubsystemRow {
  name: string
  failure_rate: string   // ARINC
  complexity: string     // AGREE
  importance: string     // AGREE
  difficulty: string     // Feasibility of effort
}

interface AllocState {
  method: Method
  targetType: 'reliability' | 'mtbf'
  targetReliability: string
  targetMtbf: string
  missionTime: string
  subsystems: SubsystemRow[]
  result: AllocationResponse | null
}

const blankRow = (): SubsystemRow => ({ name: '', failure_rate: '', complexity: '', importance: '1', difficulty: '5' })

const INITIAL_STATE: AllocState = {
  method: 'equal',
  targetType: 'reliability',
  targetReliability: '0.95',
  targetMtbf: '10000',
  missionTime: '1000',
  subsystems: [
    { name: 'Subsystem A', failure_rate: '2', complexity: '10', importance: '1', difficulty: '3' },
    { name: 'Subsystem B', failure_rate: '5', complexity: '25', importance: '1', difficulty: '6' },
    { name: 'Subsystem C', failure_rate: '3', complexity: '15', importance: '0.5', difficulty: '8' },
  ],
  result: null,
}

const METHOD_OPTS: { value: Method; label: string }[] = [
  { value: 'equal', label: 'Equal apportionment' },
  { value: 'arinc', label: 'ARINC (by failure rate)' },
  { value: 'agree', label: 'AGREE (by complexity)' },
  { value: 'feasibility', label: 'Feasibility of effort' },
]

const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400'
const cellCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400'

export default function ReliabilityAllocation() {
  const [s, setS, folios] = useFolioState<AllocState>('reliabilityAllocation', INITIAL_STATE)
  const [units] = useUnits()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const patch = (p: Partial<AllocState>) => setS(prev => ({ ...prev, ...p }))

  const updateRow = (i: number, k: keyof SubsystemRow, v: string) =>
    patch({ subsystems: s.subsystems.map((r, j) => j === i ? { ...r, [k]: v } : r) })
  const addRow = () => patch({ subsystems: [...s.subsystems, blankRow()] })
  const delRow = (i: number) => patch({ subsystems: s.subsystems.filter((_, j) => j !== i) })

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const subsystems = s.subsystems
        .filter(r => r.name.trim() !== '' || r.failure_rate.trim() !== '' || r.complexity.trim() !== '')
        .map((r, i) => ({
          name: r.name.trim() || `Subsystem ${i + 1}`,
          failure_rate: r.failure_rate.trim() === '' ? null : parseFloat(r.failure_rate),
          complexity: r.complexity.trim() === '' ? null : parseFloat(r.complexity),
          importance: r.importance.trim() === '' ? null : parseFloat(r.importance),
          difficulty: r.difficulty.trim() === '' ? null : parseFloat(r.difficulty),
        }))
      const req: AllocationRequest = {
        method: s.method,
        target_reliability: s.targetType === 'reliability' ? parseFloat(s.targetReliability) : null,
        target_mtbf: s.targetType === 'mtbf' ? parseFloat(s.targetMtbf) : null,
        mission_time: parseFloat(s.missionTime),
        subsystems,
      }
      const res = await computeAllocation(req)
      patch({ result: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Allocation failed.')
    } finally { setLoading(false) }
  }

  const showCol = {
    failure_rate: s.method === 'arinc',
    complexity: s.method === 'agree',
    importance: s.method === 'agree',
    difficulty: s.method === 'feasibility',
  }
  const r = s.result

  return (
    <div className="flex flex-col h-full">
      <FolioBar api={folios} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left control panel */}
        <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
          <p className="text-xs text-gray-500 leading-snug">
            Top-down allocation of a system reliability (or MTBF) target across the subsystems of a
            series system. Pick a method and enter the per-subsystem attributes it needs.
          </p>
          <div>
            <InfoLabel tip="Equal: every subsystem gets the same reliability. ARINC: split the allowable failure rate proportional to each subsystem's current/predicted failure rate. AGREE: weight by complexity (module count) and utilisation. Feasibility of effort: weight by how hard each subsystem is to improve.">Method</InfoLabel>
            <select value={s.method} onChange={e => patch({ method: e.target.value as Method })} className={inputCls}>
              {METHOD_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <InfoLabel tip="Specify the system target as a reliability at the mission time, or as an MTBF (converted to reliability via the mission time).">Target type</InfoLabel>
            <select value={s.targetType} onChange={e => patch({ targetType: e.target.value as AllocState['targetType'] })} className={inputCls}>
              <option value="reliability">System reliability</option>
              <option value="mtbf">System MTBF</option>
            </select>
          </div>
          {s.targetType === 'reliability'
            ? <div><label className="block text-xs font-medium text-gray-700 mb-1">Target reliability (0-1)</label>
                <input type="number" step="any" value={s.targetReliability} onChange={e => patch({ targetReliability: e.target.value })} className={inputCls} /></div>
            : <div><label className="block text-xs font-medium text-gray-700 mb-1">Target MTBF ({units})</label>
                <input type="number" step="any" value={s.targetMtbf} onChange={e => patch({ targetMtbf: e.target.value })} className={inputCls} /></div>}
          <div>
            <InfoLabel tip="Time at which the reliability target applies (and the basis for converting between reliability, failure rate and MTBF).">Mission time ({units})</InfoLabel>
            <input type="number" step="any" value={s.missionTime} onChange={e => patch({ missionTime: e.target.value })} className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
          <button onClick={run} disabled={loading}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
            <Play size={12} /> {loading ? 'Working...' : 'Allocate'}
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Subsystem table */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Subsystems</h3>
            <div className="overflow-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Name</th>
                    {showCol.failure_rate && <th className="text-right px-3 py-2 font-medium text-gray-600">Current failure rate</th>}
                    {showCol.complexity && <th className="text-right px-3 py-2 font-medium text-gray-600">Complexity (modules)</th>}
                    {showCol.importance && <th className="text-right px-3 py-2 font-medium text-gray-600">Importance (0-1)</th>}
                    {showCol.difficulty && <th className="text-right px-3 py-2 font-medium text-gray-600">Difficulty (1-10)</th>}
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {s.subsystems.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100 group">
                      <td className="px-2 py-1"><input value={row.name} onChange={e => updateRow(i, 'name', e.target.value)} className={cellCls} placeholder={`Subsystem ${i + 1}`} /></td>
                      {showCol.failure_rate && <td className="px-2 py-1"><input value={row.failure_rate} onChange={e => updateRow(i, 'failure_rate', e.target.value)} className={`${cellCls} text-right`} placeholder="0" /></td>}
                      {showCol.complexity && <td className="px-2 py-1"><input value={row.complexity} onChange={e => updateRow(i, 'complexity', e.target.value)} className={`${cellCls} text-right`} placeholder="1" /></td>}
                      {showCol.importance && <td className="px-2 py-1"><input value={row.importance} onChange={e => updateRow(i, 'importance', e.target.value)} className={`${cellCls} text-right`} placeholder="1" /></td>}
                      {showCol.difficulty && <td className="px-2 py-1"><input value={row.difficulty} onChange={e => updateRow(i, 'difficulty', e.target.value)} className={`${cellCls} text-right`} placeholder="5" /></td>}
                      <td className="px-1 text-center"><button tabIndex={-1} onClick={() => delRow(i)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addRow} className="mt-2 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={12} /> Add subsystem</button>
          </section>

          {/* Results */}
          {r && (
            <section>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <Card label="Target system reliability" value={r.system_reliability.toFixed(5)} accent />
                <Card label="Method" value={METHOD_OPTS.find(m => m.value === r.method)?.label ?? r.method} />
                <Card label="Product of allocations" value={r.achieved_reliability.toFixed(5)} />
              </div>
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Allocated targets</h3>
              <div className="overflow-auto border border-gray-200 rounded-lg mb-4">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Subsystem</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Allocated reliability</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Failure rate</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">MTBF ({units})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.allocations.map((a, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-1.5 text-gray-700 font-medium">{a.name}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{a.reliability.toFixed(5)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{a.failure_rate == null ? '—' : a.failure_rate.toExponential(3)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{a.mtbf == null ? '—' : a.mtbf.toPrecision(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 340 }}>
                <Plot
                  data={[{
                    x: r.allocations.map(a => a.name),
                    y: r.allocations.map(a => a.reliability),
                    type: 'bar', marker: { color: '#3b82f6' }, name: 'Allocated R',
                  }] as Plotly.Data[]}
                  layout={{
                    margin: { t: 20, r: 20, b: 60, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
                    yaxis: { title: { text: 'Allocated reliability' }, range: [0, 1] },
                    showlegend: false,
                  } as Plotly.Layout}
                  config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
              </div>
            </section>
          )}
        </div>
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
