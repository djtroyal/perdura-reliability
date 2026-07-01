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

const METHODS: { key: string; label: string; gen: string }[] = [
  { key: 'hraTherp', label: 'THERP', gen: 'First gen' },
  { key: 'hraHeart', label: 'HEART', gen: 'First gen' },
  { key: 'hraSparH', label: 'SPAR-H', gen: 'First gen' },
  { key: 'hraCream', label: 'CREAM', gen: 'Second gen' },
  { key: 'hraSlim', label: 'SLIM-MAUD', gen: 'First gen' },
  { key: 'hraAtheana', label: 'ATHEANA', gen: 'Second gen' },
  { key: 'hraJhedi', label: 'JHEDI', gen: 'Screening' },
  { key: 'hraSherpa', label: 'SHERPA', gen: 'Second gen' },
  { key: 'hraMermos', label: 'MERMOS', gen: 'Specialized' },
]

/** Compare the latest HEP from each HRA method that has been run. */
export default function Overview() {
  const resultsRef = useRef<HTMLDivElement>(null)
  // Hooks must run unconditionally and in a fixed order.
  const heps: (number | null)[] = [
    useHep('hraTherp'), useHep('hraHeart'), useHep('hraSparH'), useHep('hraCream'),
    useHep('hraSlim'), useHep('hraAtheana'), useHep('hraJhedi'), useHep('hraSherpa'),
    useHep('hraMermos'),
  ]
  const rows = METHODS.map((m, i) => ({ ...m, hep: heps[i] }))
  const withData = rows.filter(r => r.hep != null)

  return (
    <div className="flex-1 overflow-y-auto p-6" ref={resultsRef}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Human Reliability — Method Comparison</h2>
          <p className="text-xs text-gray-500 mt-0.5">The latest human-error probability (HEP) from each method you have run.</p>
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
              layout={{ title: { text: 'HEP by method', font: { size: 13 } }, xaxis: { title: { text: '' } }, yaxis: { title: { text: 'HEP' }, type: 'log' }, margin: { t: 40, r: 20, b: 50, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white' } as Partial<Plotly.Layout>}
              config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Method</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Generation</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">HEP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-700">{r.label}</td>
                    <td className="px-3 py-2 text-gray-500">{r.gen}</td>
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
        </>
      )}
    </div>
  )
}
