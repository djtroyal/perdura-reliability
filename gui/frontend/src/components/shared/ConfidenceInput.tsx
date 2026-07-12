interface ConfidenceInputProps {
  value: string
  onChange: (value: string) => void
  onCommit?: (confidence: number) => void
  className?: string
  title?: string
}

/** Free-form confidence entry using the LDA convention: 0.95 means 95%. */
export default function ConfidenceInput({
  value, onChange, onCommit, className = '',
  title = 'Enter a confidence level between 0 and 1; 0.95 = 95%.',
}: ConfidenceInputProps) {
  const commit = () => {
    const parsed = Number.parseFloat(value)
    const confidence = Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 0.95
    onChange(String(confidence))
    onCommit?.(confidence)
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={event => onChange(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
      title={title}
      className={`text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 ${className}`}
    />
  )
}
