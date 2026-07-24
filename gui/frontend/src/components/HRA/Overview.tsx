import { useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { useModuleState } from '../../store/project'
import { Card } from '../ALT/toolkit'
import ExportResultsButton from '../shared/ExportResultsButton'
import { fmtHep } from './tables'

interface HasHep { result?: { hep?: number } | null }
const useHep = (key: string): number | null => {
  const v = useModuleState<HasHep>(key, { result: null })[0]
  const h = v?.result?.hep
  return typeof h === 'number' ? h : null
}

const METHODS: { key: string; label: string; scope: string }[] = [
  { key: 'hraTherp', label: 'THERP', scope: 'Quantitative method' },
  { key: 'hraHeart', label: 'HEART', scope: 'Quantitative method' },
  { key: 'hraSparH', label: 'SPAR-H', scope: 'Quantitative method' },
  { key: 'hraCream', label: 'CREAM', scope: 'Quantitative method' },
  { key: 'hraCreamExt', label: 'CREAM Extended', scope: 'Quantitative method' },
  { key: 'hraSlim', label: 'SLIM-MAUD', scope: 'Expert-calibrated method' },
  { key: 'hraAtheana', label: 'EFC elicitation', scope: 'Screening heuristic' },
  { key: 'hraJhedi', label: 'Category-factor', scope: 'Screening heuristic' },
  { key: 'hraSherpa', label: 'Error-mode', scope: 'Screening heuristic' },
  { key: 'hraMermos', label: 'Mission scenarios', scope: 'Screening arithmetic' },
]

/** Compare the latest HEP from each HRA method that has been run. */
export default function Overview() {
  const resultsRef = useRef<HTMLDivElement>(null)
  // Hooks must run unconditionally and in a fixed order.
  const heps: (number | null)[] = [
    useHep('hraTherp'), useHep('hraHeart'), useHep('hraSparH'), useHep('hraCream'),
    useHep('hraCreamExt'), useHep('hraSlim'), useHep('hraAtheana'), useHep('hraJhedi'),
    useHep('hraSherpa'), useHep('hraMermos'),
  ]
  const rows = METHODS.map((m, i) => ({ ...m, hep: heps[i] }))
  const withData = rows.filter(r => r.hep != null)

  return (
    <div className="flex-1 overflow-y-auto p-6" ref={resultsRef}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Human Reliability — Method Comparison</h2>
          <p className="text-xs text-gray-500 mt-0.5">Latest HEP estimates and screening outputs, with their analytical scope shown explicitly.</p>
        </div>
        {withData.length > 0 && <ExportResultsButton getElement={() => resultsRef.current} baseName="hra_comparison" />}
      </div>

      {withData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          Run one or more methods to compare their HEP estimates here.
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-lg mb-5" style={{ height: 360 }}>
            <Plot
              data={[{ type: 'bar', x: withData.map(r => r.label), y: withData.map(r => r.hep as number), marker: { color: '#e11d48' } } as Plotly.Data]}
              layout={{ title: { text: 'HEP and screening outputs', font: { size: 13 } }, xaxis: { title: { text: '' } }, yaxis: { title: { text: 'Probability output' }, type: 'log' }, margin: { t: 40, r: 20, b: 50, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white' } as Partial<Plotly.Layout>}
              config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Method</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Scope</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">HEP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-700">{r.label}</td>
                    <td className="px-3 py-2 text-gray-500">{r.scope}</td>
                    <td className="px-3 py-2 text-right">{r.hep != null ? fmtHep(r.hep) : <span className="text-gray-300">not run</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {withData.length >= 2 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
              <Card label="Lowest HEP" value={fmtHep(Math.min(...withData.map(r => r.hep as number)))} />
              <Card label="Highest HEP" value={fmtHep(Math.max(...withData.map(r => r.hep as number)))} accent />
              <Card label="Methods run" value={String(withData.length)} />
            </div>
          )}
          <p className="text-[11px] text-slate-500 mt-4 leading-snug">
            Compare like-for-like methods: each uses its own task definition, evidence, assumptions, and level of rigor. The Scope column distinguishes quantitative methods from screening outputs.
          </p>
        </>
      )}
    </div>
  )
}
