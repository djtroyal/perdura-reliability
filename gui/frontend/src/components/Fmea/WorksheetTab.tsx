/**
 * Worksheet tab — the classic FMEA table, fully DERIVED from the model.
 * Effects come from the structural walk (local → next → end), causes from the
 * knob chains, detection from the bound controls. S/O/D suggestions come from
 * the engine (propagation depth / ideal-observer criteria); the analyst's
 * override always wins. RPN needs an occurrence rating; Action Priority (AP)
 * degrades gracefully without one.
 */
import { Download } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import { FmeaState, Rating } from './model'
import { worksheetRows, lynchpins, WorksheetRow } from './engine'

const NUM = 'w-10 text-xs text-center border border-gray-300 rounded px-0.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400'

export default function WorksheetTab({ s, patch }: {
  s: FmeaState
  patch: (p: Partial<FmeaState>) => void
}) {
  const rows = worksheetRows(s)
  const pins = lynchpins(s)

  const setRating = (modeId: string, causeId: string | null, field: keyof Pick<Rating, 'severity' | 'occurrence' | 'detection'>, value: string) => {
    const existing = s.ratings.find(r => r.modeId === modeId && r.causeId === causeId)
    if (existing) {
      patch({ ratings: s.ratings.map(r => r === existing ? { ...r, [field]: value } : r) })
    } else {
      patch({ ratings: [...s.ratings, { modeId, causeId, severity: '', occurrence: '', detection: '', [field]: value }] })
    }
  }
  const ratingOf = (modeId: string, causeId: string | null) =>
    s.ratings.find(r => r.modeId === modeId && r.causeId === causeId)

  const exportCsv = () => {
    const esc = (v: string | number | null) => {
      const str = v == null ? '' : String(v)
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }
    const header = ['Item', 'Function', 'Type', 'Guide word', 'Failure mode', 'Local effect', 'Intermediate effects', 'End effect', 'Cause', 'Cause terminal', 'Detection', 'S', 'O', 'D', 'RPN', 'AP', 'Contradiction']
    const lines = rows.map(r => [
      r.objectName, r.functionLabel, r.fnType, r.guideword, r.modeDescription,
      r.localEffect, r.nextEffects, r.endEffect, r.causeText, r.causeTerminal,
      r.detection, r.severity, r.occurrence ?? '', r.detectionRating, r.rpn ?? '', r.actionPriority,
      r.contradiction ? 'yes' : '',
    ].map(esc).join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'fmea_worksheet.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const apColor = (ap: WorksheetRow['actionPriority']) =>
    ap === 'H' ? 'bg-red-100 text-red-700' : ap === 'M' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <InfoLabel tip="Every row is derived from the model — item, function, effects (structural walk), causes (knob chains) and detection (bound informing functions). S/O/D show engine suggestions until you type an override. RPN = S×O×D (needs occurrence); AP follows an AIAG-VDA-style logic.">
          Worksheet ({rows.length} rows)
        </InfoLabel>
        <button onClick={exportCsv} disabled={rows.length === 0}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded disabled:opacity-40">
          <Download size={12} /> Export CSV
        </button>
      </div>

      {pins.length > 0 && (
        <div className="border border-violet-200 bg-violet-50 rounded px-3 py-2 text-[11px] text-violet-800">
          <b>Lynchpin contradiction{pins.length > 1 ? 's' : ''}:</b>{' '}
          {pins.map(p => `"${p.attribute}" appears under ${p.modeIds.length} failure modes`).join('; ')}
          {' '}— resolving one contradiction clears several problems at once. Prioritize these.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 border border-dashed border-gray-300 rounded p-6 text-center">
          The worksheet fills itself as you keep failure modes in the Failure Analysis tab.
          Nothing here is typed directly — every row traces back to an object, a function, and a mode.
        </p>
      ) : (
        <div className="border border-gray-200 rounded overflow-x-auto bg-white">
          <table className="w-full text-[11px] min-w-[1100px]">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['Item', 'Function', 'Guide word', 'Failure mode', 'Effects (local → end)', 'Cause (knob = setting)', 'Detection', 'S', 'O', 'D', 'RPN', 'AP'].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rating = ratingOf(r.modeId, r.causeId)
                return (
                  <tr key={i} className="border-t border-gray-100 align-top">
                    <td className="px-2 py-1.5 font-medium text-gray-700 whitespace-nowrap">{r.objectName}</td>
                    <td className="px-2 py-1.5 text-gray-600 max-w-44">{r.functionLabel}</td>
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{r.guideword}</td>
                    <td className="px-2 py-1.5 text-gray-800 max-w-52">{r.modeDescription}</td>
                    <td className="px-2 py-1.5 text-gray-600 max-w-64">
                      <span className="text-gray-500">{r.localEffect}</span>
                      {r.nextEffects && <span className="text-gray-400"> → {r.nextEffects}</span>}
                      <span className="text-gray-700 font-medium"> → {r.endEffect}</span>
                    </td>
                    <td className={`px-2 py-1.5 max-w-52 ${r.contradiction ? 'text-violet-700' : 'text-gray-600'}`}>
                      {r.causeText}
                      {r.causeTerminal && <span className="text-gray-400"> [{r.causeTerminal}]</span>}
                      {r.contradiction && <span title="Contradiction flagged on this cause"> ⚡</span>}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 max-w-40">{r.detection}</td>
                    <td className="px-1 py-1.5">
                      <input className={NUM} value={rating?.severity ?? ''} placeholder={String(r.severity)}
                        onChange={e => setRating(r.modeId, r.causeId, 'severity', e.target.value)} />
                    </td>
                    <td className="px-1 py-1.5">
                      <input className={NUM} value={rating?.occurrence ?? ''} placeholder="—"
                        onChange={e => setRating(r.modeId, r.causeId, 'occurrence', e.target.value)} />
                    </td>
                    <td className="px-1 py-1.5">
                      <input className={NUM} value={rating?.detection ?? ''} placeholder={String(r.detectionRating)}
                        onChange={e => setRating(r.modeId, r.causeId, 'detection', e.target.value)} />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-gray-700">{r.rpn ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded font-semibold ${apColor(r.actionPriority)}`}>{r.actionPriority}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 leading-relaxed">
        Gray numbers in S/D are engine suggestions (effect-propagation depth; detection-chain ideality) —
        type to override. Occurrence is yours to rate (hook to field/test data where available).
        ⚡ marks causes flagged as contradictions: the fix-setting worsens something else — candidates
        for TRIZ separation strategies rather than brute-force redesign.
      </p>
    </div>
  )
}
