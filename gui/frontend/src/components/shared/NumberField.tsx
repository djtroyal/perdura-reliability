import { useCallback } from 'react'
import { magnitudeStep, semanticNumericStep } from './numericSteps'

/**
 * Numeric input with sensible, bounded step increments (#13).
 *
 * Native number inputs default to a step of 1, which is wrong for most
 * engineering parameters (a shape parameter wants 0.1, an activation energy
 * 0.01, a count 1). Pass an explicit `step`, or let the component derive a
 * "nice" step from the current value's magnitude. Values are clamped to
 * [min, max] on change and on blur.
 */
export default function NumberField({
  value, onChange, min, max, step, semantic, placeholder, className = '', disabled, id, title,
}: {
  value: string | number
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
  /** Parameter/variable label used to select a type-appropriate increment. */
  semantic?: string
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  title?: string
}) {
  // Derive a nice step from the magnitude of the current value when none given.
  const autoStep = useCallback((v: number): number => magnitudeStep(v), [])

  const clamp = (n: number): number => {
    if (min != null) n = Math.max(min, n)
    if (max != null) n = Math.min(max, n)
    return n
  }

  const numeric = typeof value === 'number' ? value : parseFloat(value)
  const effectiveStep = step ?? (semantic
    ? semanticNumericStep(semantic, numeric)
    : min === 0 && max === 1
      ? 0.01
      : (isFinite(numeric) ? autoStep(numeric) : 1))

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      title={title}
      disabled={disabled}
      value={value}
      min={min}
      max={max}
      step={effectiveStep}
      placeholder={placeholder}
      onChange={e => {
        const raw = e.target.value
        if (raw === '' || raw === '-') { onChange(raw); return }
        const n = parseFloat(raw)
        if (isNaN(n)) { onChange(raw); return }
        // Only clamp when out of bounds so typing intermediate values still works.
        const c = clamp(n)
        onChange(c === n ? raw : String(c))
      }}
      onBlur={e => {
        const n = parseFloat(e.target.value)
        if (!isNaN(n)) { const c = clamp(n); if (c !== n) onChange(String(c)) }
      }}
      className={`text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 ${className}`}
    />
  )
}
