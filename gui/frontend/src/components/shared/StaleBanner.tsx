import { AlertTriangle } from 'lucide-react'

/**
 * A prominent "results are out of date" banner shown when a dataset has been
 * changed (added/removed/edited rows or columns) since the displayed analysis
 * was last computed. Render it above a results pane and pass `show`.
 */
export default function StaleBanner({
  show,
  message = 'The data has changed since these results were computed. Re-run the analysis for up-to-date results.',
  onRerun,
  rerunLabel = 'Re-run',
}: {
  show: boolean
  message?: string
  onRerun?: () => void
  rerunLabel?: string
}) {
  if (!show) return null
  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-xs rounded px-3 py-2 mx-4 mt-3">
      <AlertTriangle size={15} className="flex-shrink-0 text-amber-500" />
      <span className="flex-1">{message}</span>
      {onRerun && (
        <button onClick={onRerun}
          className="flex-shrink-0 bg-amber-500 hover:bg-amber-600 text-white font-medium px-2.5 py-1 rounded transition-colors">
          {rerunLabel}
        </button>
      )}
    </div>
  )
}
