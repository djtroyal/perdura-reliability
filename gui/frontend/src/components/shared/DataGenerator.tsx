import { useState } from 'react'
import { Dices } from 'lucide-react'
import InfoLabel from './InfoLabel'
import NumberField from './NumberField'
import { GEN_DISTRIBUTIONS, generateColumn, roundSamples } from './dataGen'

/**
 * Collapsible "Generate sample data" panel (#12). Drop into any module that has
 * a manual numeric-input field; on Generate it calls `onGenerate` with a fresh
 * simulated column. Reproducible via the optional seed.
 */
export default function DataGenerator({
  onGenerate, defaultDist = 'weibull', defaultN = 30, label = 'Generate sample data',
  className = '',
}: {
  onGenerate: (values: number[]) => void
  defaultDist?: string
  defaultN?: number
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [dist, setDist] = useState(defaultDist)
  const [params, setParams] = useState<Record<string, string>>(() => {
    const d = GEN_DISTRIBUTIONS.find(x => x.value === defaultDist) ?? GEN_DISTRIBUTIONS[0]
    return Object.fromEntries(d.params.map(p => [p.key, String(p.default)]))
  })
  const [n, setN] = useState(String(defaultN))
  const [seed, setSeed] = useState('')

  const distDef = GEN_DISTRIBUTIONS.find(x => x.value === dist) ?? GEN_DISTRIBUTIONS[0]

  const selectDist = (v: string) => {
    setDist(v)
    const d = GEN_DISTRIBUTIONS.find(x => x.value === v)
    if (d) setParams(Object.fromEntries(d.params.map(p => [p.key, String(p.default)])))
  }

  const run = () => {
    const nNum = Math.max(1, Math.min(100000, parseInt(n, 10) || defaultN))
    const numericParams: Record<string, number> = {}
    for (const p of distDef.params) numericParams[p.key] = parseFloat(params[p.key] ?? '') || p.default
    const seedNum = seed.trim() === '' ? undefined : parseInt(seed, 10)
    const integer = dist === 'poisson' || dist === 'binomial'
    onGenerate(roundSamples(generateColumn(dist, numericParams, nNum, seedNum), integer))
  }

  return (
    <div className={`border border-dashed border-gray-300 rounded-lg ${className}`}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-medium text-gray-600 w-full px-3 py-2">
        <Dices size={13} className="text-purple-500" /> {label}
        <span className="ml-auto text-gray-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div>
            <InfoLabel tip="Distribution to draw the simulated sample from." className="text-[10px] text-gray-500 mb-0.5">Distribution</InfoLabel>
            <select value={dist} onChange={e => selectDist(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-hidden focus:ring-1 focus:ring-blue-400">
              {GEN_DISTRIBUTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {distDef.params.map(p => (
              <div key={p.key}>
                <label className="text-[10px] text-gray-500 block mb-0.5" title={p.label}>{p.label}</label>
                <NumberField value={params[p.key] ?? ''} min={p.min} max={p.max} step={p.step}
                  onChange={v => setParams(prev => ({ ...prev, [p.key]: v }))} className="w-full" />
              </div>
            ))}
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Sample size (n)</label>
              <NumberField value={n} min={1} max={100000} step={1} onChange={setN} className="w-full" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Seed (optional)</label>
              <NumberField value={seed} step={1} onChange={setSeed} placeholder="random" className="w-full" />
            </div>
          </div>
          <button onClick={run}
            className="flex items-center justify-center gap-1.5 border border-purple-500 text-purple-600 hover:bg-purple-50 text-xs font-medium py-1.5 rounded transition-colors">
            <Dices size={12} /> Generate
          </button>
        </div>
      )}
    </div>
  )
}
