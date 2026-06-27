import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { parseCsv, ParsedCsv } from './parseCsv'

/**
 * Reusable "Import CSV" control: a file picker that parses the chosen
 * CSV/TSV/text file (via the shared papaparse helper) and hands the result to
 * the caller. Used by the data grids, MSA, and Hypothesis to give every
 * tabular module the file-import that previously only Life Data had.
 */
export default function ImportCsvButton({
  onImport, label = 'Import CSV', title, className,
}: {
  onImport: (result: ParsedCsv) => void
  label?: string
  title?: string
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  const handle = async (file: File | undefined) => {
    if (!file) return
    try {
      const result = await parseCsv(file)
      onImport(result)
    } catch {
      // Surface nothing intrusive — a malformed file simply imports no rows.
    } finally {
      if (ref.current) ref.current.value = ''   // allow re-importing the same file
    }
  }

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        className="hidden"
        onChange={e => handle(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        title={title ?? 'Import data from a CSV / TSV file'}
        className={className ?? 'flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700'}
      >
        <Upload size={12} /> {label}
      </button>
    </>
  )
}
