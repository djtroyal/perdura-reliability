import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightLeft, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react'
import type { SystemConversionReport } from '../../api/client'
import { useFocusTrap } from './useDialog'

export interface ConversionProvenance {
  schemaVersion: 1
  sourceKind: 'rbd' | 'fta'
  sourceAnalysisId: string
  sourceAnalysisName: string
  convertedAt: string
  exact: true
  verificationMethod: string
  snapshot: true
}

interface Props {
  open: boolean
  loading: boolean
  sourceLabel: string
  targetLabel: string
  targetName: string
  report: SystemConversionReport | null
  onTargetNameChange: (value: string) => void
  onClose: () => void
  onCreate: () => void
}

export default function SystemConversionDialog({
  open, loading, sourceLabel, targetLabel, targetName, report,
  onTargetNameChange, onClose, onCreate,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="system-conversion-title"
        className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-blue-700"><ArrowRightLeft size={16} />
              <h2 id="system-conversion-title" className="text-sm font-semibold">Convert {sourceLabel} to {targetLabel}</h2>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Creates a separate editable snapshot; the source analysis is unchanged.</p>
          </div>
          <button onClick={onClose} aria-label="Close conversion dialog" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="space-y-4 p-5">
          {loading ? (
            <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-sm text-slate-500">
              <Loader2 className="animate-spin text-blue-600" size={24} />
              Validating source semantics and proving exact equivalence…
            </div>
          ) : report && (
            <>
              {report.convertible ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
                  <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} /> Exact conversion verified</div>
                  <p className="mt-1 text-[10px] leading-4">Canonical ROBDD comparison proved that the source and generated target have identical system-failure logic.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
                  <p className="text-xs font-semibold">This model cannot be converted exactly.</p>
                  <p className="mt-1 text-[10px]">No target analysis has been created and no approximation will be substituted.</p>
                </div>
              )}
              {report.summary && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded border border-slate-200 p-2"><p className="text-[9px] uppercase text-slate-400">Source</p><p className="font-mono text-sm font-semibold text-slate-700">{report.summary.source_nodes} nodes</p></div>
                  <div className="rounded border border-slate-200 p-2"><p className="text-[9px] uppercase text-slate-400">Target</p><p className="font-mono text-sm font-semibold text-slate-700">{report.summary.target_nodes} nodes</p></div>
                  <div className="rounded border border-slate-200 p-2"><p className="text-[9px] uppercase text-slate-400">Logical events</p><p className="font-mono text-sm font-semibold text-slate-700">{report.summary.logical_events}</p></div>
                </div>
              )}
              {report.diagnostics.length > 0 && <div className="space-y-1.5">
                {report.diagnostics.map((item, index) => <div key={`${item.code}-${index}`} className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                  <span className="font-semibold">{item.code.replace(/_/g, ' ')}</span> — {item.message}
                </div>)}
              </div>}
              {report.warnings.length > 0 && <details className="rounded border border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                <summary className="cursor-pointer px-3 py-2 font-medium">Conversion notes ({report.warnings.length})</summary>
                <ul className="space-y-1 border-t border-amber-200 px-5 py-2">{report.warnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul>
              </details>}
              {report.convertible && <label className="block text-xs text-slate-600">New {targetLabel} analysis name
                <input autoFocus className="field mt-1" value={targetName} onChange={event => onTargetNameChange(event.target.value)} maxLength={160} />
              </label>}
              <p className="rounded bg-slate-50 p-2 text-[10px] leading-4 text-slate-500">Calculated results and free-form diagram annotations are intentionally excluded. Recalculate the generated analysis with its native engine after reviewing the layout.</p>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="mini-button">{report?.convertible ? 'Cancel' : 'Close'}</button>
          {report?.convertible && !loading && <button onClick={onCreate} disabled={!targetName.trim()} className="primary-button">
            <CheckCircle2 size={13} /> Create {targetLabel}
          </button>}
        </div>
      </div>
    </div>, document.body,
  )
}
