import { ExternalLink, Link2, X } from 'lucide-react'


export interface ProgramRecordLinkOption {
  id: string
  label: string
  detail?: string
}

export default function RecordLinkField({
  label,
  recordType,
  values,
  options,
  onChange,
  onNavigate,
  compact = false,
}: {
  label?: string
  recordType: 'Hazard'|'FRACAS'
  values: string[]
  options: ProgramRecordLinkOption[]
  onChange: (values: string[]) => void
  onNavigate: (id: string) => void
  compact?: boolean
}) {
  const uniqueValues = [...new Set(values.map(value => value.trim())
    .filter(Boolean))]
  const available = options.filter(option =>
    !uniqueValues.includes(option.id))
  const optionById = new Map(options.map(option => [option.id, option]))
  return <div className="min-w-0">
    {label && <div className="mb-1 text-[10px] font-medium text-slate-500">
      {label}
    </div>}
    {uniqueValues.length > 0 && <div className="mb-1 flex flex-wrap gap-1">
      {uniqueValues.map(id => {
        const option = optionById.get(id)
        return <span key={id}
          className={`group inline-flex max-w-full items-center rounded border ${
            option
              ? 'border-blue-200 bg-blue-50 text-blue-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}>
          <button type="button" disabled={!option}
            title={option
              ? `Open ${recordType}: ${option.label}`
              : `${recordType} ${id} is missing from this project`}
            onClick={() => option && onNavigate(id)}
            className="flex min-w-0 items-center gap-1 px-1.5 py-0.5 text-[9px] disabled:cursor-not-allowed">
            {option ? <ExternalLink size={9} /> : <Link2 size={9} />}
            <span className="truncate">
              {option ? `${id} · ${option.label}` : `${id} · missing`}
            </span>
          </button>
          <button type="button" title={`Unlink ${recordType} ${id}`}
            aria-label={`Unlink ${recordType} ${id}`}
            onClick={() => onChange(uniqueValues.filter(value => value !== id))}
            className="mr-1 text-current opacity-45 hover:opacity-100">
            <X size={9} />
          </button>
        </span>
      })}
    </div>}
    <select value="" onChange={event => {
      const id = event.target.value
      if (id) onChange([...uniqueValues, id])
    }} aria-label={`Link ${recordType} record`}
      className={`w-full rounded border border-slate-200 bg-white text-slate-600 outline-none hover:border-blue-300 focus:border-blue-500 ${
        compact ? 'px-1 py-1 text-[10px]' : 'px-2 py-1.5 text-xs'
      }`}>
      <option value="">
        {available.length
          ? `Link ${recordType}…`
          : options.length
            ? `All ${recordType} records linked`
            : `No ${recordType} records available`}
      </option>
      {available.map(option =>
        <option key={option.id} value={option.id}>
          {option.id} · {option.label}{option.detail ? ` · ${option.detail}` : ''}
        </option>)}
    </select>
  </div>
}
