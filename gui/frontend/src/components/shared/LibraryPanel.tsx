import { useState } from 'react'
import { BookMarked, Plus, Trash2, Link2 } from 'lucide-react'
import { useModuleState } from '../../store/project'
import { evaluateDistribution, FitResponse, PredictionResponse, PredictionPart } from '../../api/client'

/**
 * Shared component/event library.
 *
 * Items snapshot their source at link time:
 *  - manual: a fixed reliability value
 *  - distribution: best-fit distribution + parameters from an LDA folio
 *  - lambda: a constant failure rate (FPMH) from a Failure Rate Prediction
 *    part or part group
 *
 * Applying an item to a selected node evaluates R(mission time) — RBD
 * components receive the reliability; FTA basic events receive the
 * failure probability 1 - R.
 */

export interface LibraryItem {
  id: string
  name: string
  kind: 'manual' | 'distribution' | 'lambda'
  value?: number                       // manual reliability
  distribution?: string                // distribution snapshot
  params?: Record<string, number>
  lambdaFpmh?: number                  // constant failure rate snapshot
  source?: string                      // provenance text
}

export interface LibraryState {
  items: LibraryItem[]
  missionHours: string
}

const INITIAL_LIBRARY: LibraryState = { items: [], missionHours: '8760' }

// Minimal shapes of the other modules' store slices we read from
interface FolioLite {
  id: string
  name: string
  result?: FitResponse | null
}
interface LifeDataLite { folios: FolioLite[] }
interface PredictionLite { parts: PredictionPart[]; result?: PredictionResponse | null }

const PARAM_BASE_NAMES = ['alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda']

let libSeq = 0
const makeId = () => `lib${Date.now().toString(36)}${++libSeq}`

export function itemSummary(item: LibraryItem): string {
  if (item.kind === 'manual') return `R = ${item.value}`
  if (item.kind === 'lambda') return `λ = ${item.lambdaFpmh} FPMH`
  const ps = Object.entries(item.params ?? {})
    .map(([k, v]) => `${k}=${Number(v.toPrecision(4))}`).join(', ')
  return `${item.distribution}(${ps})`
}

interface Props {
  /** 'reliability' (RBD components) or 'probability' (FTA events: 1-R) */
  mode: 'reliability' | 'probability'
  /** label of the currently selected node, or null if none */
  selectedLabel: string | null
  /** apply the computed value (and item name) to the selected node */
  onApply: (item: LibraryItem, value: number) => void
}

export default function LibraryPanel({ mode, selectedLabel, onApply }: Props) {
  const [lib, setLib] = useModuleState<LibraryState>('library', INITIAL_LIBRARY)
  const [lifeData] = useModuleState<LifeDataLite>('lifeData', { folios: [] })
  const [prediction] = useModuleState<PredictionLite>('prediction', { parts: [] })

  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addKind, setAddKind] = useState<'manual' | 'folio' | 'prediction'>('manual')
  const [addName, setAddName] = useState('')
  const [addValue, setAddValue] = useState('0.95')
  const [addFolioId, setAddFolioId] = useState('')
  const [addPredRef, setAddPredRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fittedFolios = lifeData.folios.filter(f => f.result?.best_distribution)

  // Prediction sources: individual parts and groups (require a run for λ)
  const predResults = prediction.result?.results ?? []
  const predSources: { key: string; label: string; lambda: number }[] = []
  if (predResults.length === prediction.parts.length && predResults.length > 0) {
    const groups = new Map<string, number>()
    prediction.parts.forEach((p, i) => {
      const r = predResults[i]
      predSources.push({
        key: `part:${i}`,
        label: `${r.name} (part)`,
        lambda: r.total_failure_rate,
      })
      if (p.group?.trim()) {
        groups.set(p.group.trim(),
          (groups.get(p.group.trim()) ?? 0) + r.total_failure_rate)
      }
    })
    for (const [g, lam] of groups) {
      predSources.push({ key: `group:${g}`, label: `${g} (group)`, lambda: lam })
    }
  }

  const addItem = () => {
    setError(null)
    if (addKind === 'manual') {
      const v = parseFloat(addValue)
      if (isNaN(v) || v <= 0 || v > 1) { setError('Reliability must be in (0, 1].'); return }
      if (!addName.trim()) { setError('Name is required.'); return }
      setLib(l => ({
        ...l,
        items: [...l.items, {
          id: makeId(), name: addName.trim(), kind: 'manual', value: v,
          source: 'manual entry',
        }],
      }))
    } else if (addKind === 'folio') {
      const folio = fittedFolios.find(f => f.id === addFolioId)
      const res = folio?.result
      if (!folio || !res) { setError('Select a folio with a completed fit.'); return }
      const best = res.best_distribution
      const row = res.results.find(r => r.Distribution === best)
      if (!row?.params) { setError('Selected folio has no fitted parameters.'); return }
      const params: Record<string, number> = {}
      for (const p of PARAM_BASE_NAMES) {
        const v = row.params[p]
        if (typeof v === 'number') params[p] = v
      }
      setLib(l => ({
        ...l,
        items: [...l.items, {
          id: makeId(),
          name: addName.trim() || folio.name,
          kind: 'distribution',
          distribution: best,
          params,
          source: `LDA folio "${folio.name}" (${best})`,
        }],
      }))
    } else {
      const src = predSources.find(s => s.key === addPredRef)
      if (!src) { setError('Select a prediction part or group (run a prediction first).'); return }
      setLib(l => ({
        ...l,
        items: [...l.items, {
          id: makeId(),
          name: addName.trim() || src.label.replace(/ \((part|group)\)$/, ''),
          kind: 'lambda',
          lambdaFpmh: src.lambda,
          source: `Prediction: ${src.label}`,
        }],
      }))
    }
    setAdding(false)
    setAddName('')
  }

  const removeItem = (id: string) =>
    setLib(l => ({ ...l, items: l.items.filter(i => i.id !== id) }))

  const apply = async (item: LibraryItem) => {
    setError(null)
    const t = parseFloat(lib.missionHours)
    if (item.kind !== 'manual' && (isNaN(t) || t <= 0)) {
      setError('Enter a positive mission time.')
      return
    }
    try {
      let R: number
      if (item.kind === 'manual') {
        R = item.value!
      } else if (item.kind === 'lambda') {
        R = Math.exp(-item.lambdaFpmh! * t / 1e6)
      } else {
        setBusy(true)
        const res = await evaluateDistribution(item.distribution!, item.params!, t)
        R = res.sf
      }
      onApply(item, mode === 'reliability' ? R : 1 - R)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Evaluation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-gray-100 pt-3">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide w-full">
        <BookMarked size={13} />
        Library ({lib.items.length})
        <span className="ml-auto text-gray-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-0.5 block">Mission time (h)</label>
            <input type="text" inputMode="decimal" value={lib.missionHours}
              onChange={e => setLib(l => ({ ...l, missionHours: e.target.value }))}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>

          {lib.items.length === 0 && !adding && (
            <p className="text-[11px] text-gray-400">
              No library items. Add components/events linked to an LDA folio,
              a prediction part, or a manual value.
            </p>
          )}

          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
            {lib.items.map(item => (
              <div key={item.id} className="bg-gray-50 border border-gray-200 rounded px-2 py-1.5 group">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700 truncate">{item.name}</span>
                  <button onClick={() => removeItem(item.id)} tabIndex={-1}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 flex-shrink-0">
                    <Trash2 size={11} />
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 font-mono truncate">{itemSummary(item)}</p>
                {item.source && <p className="text-[10px] text-gray-400 truncate">{item.source}</p>}
                <button
                  onClick={() => apply(item)}
                  disabled={!selectedLabel || busy}
                  title={selectedLabel
                    ? `Set ${mode} of "${selectedLabel}" from this item at mission time`
                    : 'Select a node first'}
                  className="mt-1 flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 disabled:text-gray-300"
                >
                  <Link2 size={10} />
                  {selectedLabel ? `Link to "${selectedLabel}"` : 'Select a node to link'}
                </button>
              </div>
            ))}
          </div>

          {adding ? (
            <div className="border border-blue-200 bg-blue-50/50 rounded p-2 flex flex-col gap-1.5">
              <select value={addKind} onChange={e => setAddKind(e.target.value as typeof addKind)}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none">
                <option value="manual">Manual value</option>
                <option value="folio">From LDA folio (fitted distribution)</option>
                <option value="prediction">From prediction part / group (λ)</option>
              </select>
              <input type="text" placeholder="Name" value={addName}
                onChange={e => setAddName(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none" />
              {addKind === 'manual' && (
                <input type="text" inputMode="decimal" placeholder="Reliability (0-1]"
                  value={addValue} onChange={e => setAddValue(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 font-mono focus:outline-none" />
              )}
              {addKind === 'folio' && (
                fittedFolios.length === 0 ? (
                  <p className="text-[10px] text-gray-400">No folios with completed fits — run an LDA analysis first.</p>
                ) : (
                  <select value={addFolioId} onChange={e => setAddFolioId(e.target.value)}
                    className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none">
                    <option value="">Select folio…</option>
                    {fittedFolios.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.result!.best_distribution})
                      </option>
                    ))}
                  </select>
                )
              )}
              {addKind === 'prediction' && (
                predSources.length === 0 ? (
                  <p className="text-[10px] text-gray-400">No prediction results — run a failure rate prediction first.</p>
                ) : (
                  <select value={addPredRef} onChange={e => setAddPredRef(e.target.value)}
                    className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none">
                    <option value="">Select part or group…</option>
                    {predSources.map(s => (
                      <option key={s.key} value={s.key}>{s.label} — λ={s.lambda.toFixed(4)}</option>
                    ))}
                  </select>
                )
              )}
              <div className="flex gap-1">
                <button onClick={addItem}
                  className="flex-1 text-xs bg-blue-600 text-white rounded py-1 hover:bg-blue-700">Add</button>
                <button onClick={() => { setAdding(false); setError(null) }}
                  className="flex-1 text-xs border border-gray-300 text-gray-600 rounded py-1 hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
              <Plus size={11} /> Add library item
            </button>
          )}

          {error && <p className="text-[10px] text-red-600 bg-red-50 p-1.5 rounded">{error}</p>}
        </div>
      )}
    </div>
  )
}
