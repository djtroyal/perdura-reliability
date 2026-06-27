/**
 * Shared number formatters. Folds together the several per-module `fmtNum` /
 * `fmt` / `fmtPct` copies into one place.
 */

/**
 * Format a number for display. By default uses 2 decimals, switching to
 * scientific notation for very large/small magnitudes. Pass `precision` for a
 * fixed number of decimals (the variant some modules used as `fmt(v, d)`).
 */
export function fmtNum(v: number | null | undefined, precision?: number): string {
  if (v == null || !isFinite(v)) return '—'
  if (precision != null) return v.toFixed(precision)
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2)
  return v.toFixed(2)
}

/** Format a 0–1 fraction as a percentage string. */
export function fmtPct(v: number | null | undefined, precision = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return `${(v * 100).toFixed(precision)}%`
}
