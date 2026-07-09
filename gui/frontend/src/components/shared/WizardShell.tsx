/**
 * Shared UI for method-selection wizards (DOE design wizard, hypothesis test
 * picker, reliability-test navigator, …): a focus-trapped stepped modal with
 * option cards, progress dots, Back / Start over / Next / Apply footer, and a
 * standard recommendation card (rationale + cautions + alternatives).
 * Each wizard supplies its own answer state, decision engine, and step bodies.
 */
import { ReactNode, useRef } from 'react'
import { X, Wand2, ArrowLeft, ArrowRight, Check, AlertTriangle } from 'lucide-react'
import { useFocusTrap } from './useDialog'

/** Common shape of a wizard recommendation, rendered by RecommendationCard. */
export interface RecInfo {
  title: string
  /** One-line key facts (run count, test inputs, …) shown in mono under the title. */
  detail: string
  rationale: string
  cautions: string[]
  alternatives: { label: string; note: string }[]
}

export function OptionCard({ title, desc, selected, onClick }: {
  title: string; desc: string; selected: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
        selected ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-300' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <span className={`block text-xs font-semibold ${selected ? 'text-violet-800' : 'text-gray-800'}`}>{title}</span>
      <span className="block text-[11px] text-gray-500 mt-0.5 leading-snug">{desc}</span>
    </button>
  )
}

export function RecommendationCard({ rec, footNote }: { rec: RecInfo; footNote?: string }) {
  return (
    <>
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-0.5">Recommended</p>
        <p className="text-sm font-semibold text-violet-900">{rec.title}</p>
        {rec.detail && <p className="text-xs text-violet-700 mt-0.5 font-mono">{rec.detail}</p>}
        <p className="text-[11px] text-gray-700 mt-2 leading-relaxed">{rec.rationale}</p>
      </div>
      {rec.cautions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 flex flex-col gap-1">
          {rec.cautions.map((c, i) => (
            <p key={i} className="text-[11px] text-amber-800 flex gap-1.5">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-amber-500" /> {c}
            </p>
          ))}
        </div>
      )}
      {rec.alternatives.length > 0 && (
        <div className="text-[11px] text-gray-500">
          <p className="font-medium text-gray-600 mb-0.5">Also reasonable:</p>
          {rec.alternatives.map((alt, i) => (
            <p key={i}>• <span className="font-medium">{alt.label}</span> — {alt.note}</p>
          ))}
        </div>
      )}
      {footNote && <p className="text-[11px] text-gray-400">{footNote}</p>}
    </>
  )
}

export default function WizardShell({
  open, onClose, title, stepCount, stepIdx, isFinal, canNext,
  onBack, onNext, onRestart, onApply, applyLabel = 'Apply', busy, children,
}: {
  open: boolean
  onClose: () => void
  title: string
  stepCount: number
  stepIdx: number
  /** true when the current step is the recommendation (Apply replaces Next). */
  isFinal: boolean
  canNext: boolean
  onBack: () => void
  onNext: () => void
  onRestart: () => void
  onApply: () => void
  applyLabel?: string
  busy?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, open, onClose)
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white rounded-xl shadow-xl border border-gray-200 w-[34rem] max-w-[94vw] max-h-[88vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
          <Wand2 size={16} className="text-violet-600" />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <span className="ml-2 flex items-center gap-1">
            {Array.from({ length: stepCount }, (_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= stepIdx ? 'bg-violet-500' : 'bg-gray-200'}`} />
            ))}
          </span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-gray-300 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-2.5">{children}</div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100">
          {stepIdx > 0 && (
            <button onClick={onBack}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5">
              <ArrowLeft size={12} /> Back
            </button>
          )}
          <button onClick={onRestart} className="text-[11px] text-gray-400 hover:text-gray-600">Start over</button>
          <div className="flex-1" />
          {!isFinal ? (
            <button onClick={onNext} disabled={!canNext}
              className="flex items-center gap-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded px-3 py-1.5">
              Next <ArrowRight size={12} />
            </button>
          ) : (
            <button onClick={onApply} disabled={busy}
              className="flex items-center gap-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded px-3 py-1.5">
              <Check size={12} /> {busy ? 'Working…' : applyLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
