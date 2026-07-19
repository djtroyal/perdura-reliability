import { useState } from 'react'
import { Download } from 'lucide-react'
import { exportDiagram, DiagramFormat, type DiagramExportPreparation } from './exportDiagram'

const FORMATS: { value: DiagramFormat; label: string }[] = [
  { value: 'svg', label: 'SVG (vector)' },
  { value: 'pdf', label: 'PDF' },
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
]

/**
 * Dropdown button that exports a diagram element to SVG / PDF / PNG / JPG (#19).
 * `getElement` returns the DOM node to capture (e.g. the ReactFlow wrapper).
 */
export default function ExportDiagramButton({
  getElement, baseName = 'diagram', buttonClassName, prepareExport,
}: {
  getElement: () => HTMLElement | null
  baseName?: string
  buttonClassName?: string
  prepareExport?: DiagramExportPreparation
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<DiagramFormat | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async (fmt: DiagramFormat) => {
    setErr(null); setBusy(fmt)
    try {
      await exportDiagram(getElement(), fmt, baseName, prepareExport)
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={buttonClassName
          ?? 'flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded bg-white'}>
        <Download size={12} /> Export
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-36">
            {FORMATS.map(f => (
              <button key={f.value} onClick={() => run(f.value)} disabled={busy != null}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-blue-50 disabled:opacity-50">
                {busy === f.value ? 'Exporting…' : f.label}
              </button>
            ))}
            {err && <p className="text-[10px] text-red-600 px-3 py-1">{err}</p>}
          </div>
        </>
      )}
    </div>
  )
}
