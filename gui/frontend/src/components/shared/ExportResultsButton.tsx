import { useState } from 'react'
import { Download } from 'lucide-react'
import { exportResultsToPdf } from './exportResults'

/**
 * Single button that exports an analysis-results element to PDF (#19).
 * `getElement` returns the DOM node to capture (the results panel).
 */
export default function ExportResultsButton({
  getElement, baseName = 'results', title,
}: {
  getElement: () => HTMLElement | null
  baseName?: string
  title?: string
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setErr(null); setBusy(true)
    try {
      await exportResultsToPdf(getElement(), baseName, title)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[10px] text-red-600">{err}</span>}
      <button onClick={run} disabled={busy}
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded bg-white disabled:opacity-50">
        <Download size={12} /> {busy ? 'Exporting…' : 'Export PDF'}
      </button>
    </div>
  )
}
