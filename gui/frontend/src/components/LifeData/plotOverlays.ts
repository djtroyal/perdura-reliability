/**
 * Shared plot-overlay helpers for the Life Data Analysis module:
 *  - salient points (mean, median/B50, B10 life, characteristic life η) (#6/#10)
 *  - suspensions / right-censored markers (#7/#10)
 *
 * Salient points are computed on the frontend from a fitted distribution's
 * curve data (interpolating the relevant function), which keeps the backend
 * untouched while working for every distribution that returns curves.
 */

export type CurveKey = 'pdf' | 'cdf' | 'sf' | 'hf'

export interface CurveData {
  x?: number[] | null
  pdf?: number[] | null
  cdf?: number[] | null
  sf?: number[] | null
  hf?: number[] | null
}

export interface SalientPoint {
  label: string
  /** time (x value) of the characteristic life marker */
  time: number
}

/** Linear interpolation of y at a given x over a monotone-ish x array. */
function interp(x: number[], y: number[], xq: number): number | null {
  if (x.length === 0 || x.length !== y.length) return null
  if (xq <= x[0]) return y[0]
  if (xq >= x[x.length - 1]) return y[y.length - 1]
  for (let i = 1; i < x.length; i++) {
    if (xq <= x[i]) {
      const t = (xq - x[i - 1]) / (x[i] - x[i - 1] || 1)
      return y[i - 1] + t * (y[i] - y[i - 1])
    }
  }
  return y[y.length - 1]
}

/** Invert a CDF curve: smallest x where cdf(x) >= p. */
function quantileFromCdf(x: number[], cdf: number[], p: number): number | null {
  if (x.length === 0 || x.length !== cdf.length) return null
  for (let i = 0; i < cdf.length; i++) {
    if (cdf[i] >= p) {
      if (i === 0) return x[0]
      const t = (p - cdf[i - 1]) / (cdf[i] - cdf[i - 1] || 1)
      return x[i - 1] + t * (x[i] - x[i - 1])
    }
  }
  return null
}

/** Mean as ∫ sf dt (numeric trapezoid) over the available range. */
function meanFromSf(x: number[], sf: number[]): number | null {
  if (x.length < 2 || x.length !== sf.length) return null
  let area = 0
  for (let i = 1; i < x.length; i++) {
    area += 0.5 * (sf[i] + sf[i - 1]) * (x[i] - x[i - 1])
  }
  // add the contribution before the first x (assume sf≈1 below the range start)
  area += sf[0] * x[0]
  return area
}

/**
 * Characteristic-life markers derived from the fitted distribution's curves.
 * `etaOverride` lets callers supply η directly (e.g. Weibull/Weibayes), in which
 * case it is preferred over an interpolated estimate.
 */
export function computeSalientPoints(
  curves: CurveData | null | undefined,
  etaOverride?: number | null,
): SalientPoint[] {
  if (!curves?.x || !curves.cdf || !curves.sf) return []
  const x = curves.x as number[]
  const cdf = curves.cdf as number[]
  const sf = curves.sf as number[]
  const out: SalientPoint[] = []

  const b10 = quantileFromCdf(x, cdf, 0.10)
  if (b10 != null) out.push({ label: 'B10 life', time: b10 })

  const b50 = quantileFromCdf(x, cdf, 0.50)
  if (b50 != null) out.push({ label: 'Median (B50)', time: b50 })

  const mean = meanFromSf(x, sf)
  if (mean != null && isFinite(mean)) out.push({ label: 'Mean', time: mean })

  // Characteristic life η: CDF ≈ 0.632 for a Weibull; use override when given.
  const eta = etaOverride != null && isFinite(etaOverride)
    ? etaOverride
    : quantileFromCdf(x, cdf, 1 - Math.exp(-1))
  if (eta != null) out.push({ label: 'η (char. life)', time: eta })

  return out
}

const SALIENT_COLORS: Record<string, string> = {
  'B10 life': '#f59e0b',
  'Median (B50)': '#8b5cf6',
  'Mean': '#10b981',
  'η (char. life)': '#ef4444',
}

/**
 * A Plotly marker trace placing each salient point on the given curve.
 * `yFor` returns the y value of the active curve at a time.
 */
export function salientTrace(
  points: SalientPoint[],
  curves: CurveData,
  key: CurveKey,
): Record<string, unknown> | null {
  if (points.length === 0) return null
  const x = curves.x as number[] | undefined
  const y = curves[key] as number[] | undefined
  if (!x || !y) return null
  const px: number[] = []
  const py: number[] = []
  const text: string[] = []
  const colors: string[] = []
  for (const pt of points) {
    const yv = interp(x, y, pt.time)
    if (yv == null) continue
    px.push(pt.time)
    py.push(yv)
    text.push(`${pt.label}: ${pt.time.toPrecision(4)}`)
    colors.push(SALIENT_COLORS[pt.label] ?? '#374151')
  }
  if (px.length === 0) return null
  return {
    x: px, y: py, text, mode: 'markers', type: 'scatter',
    name: 'Salient points',
    marker: { color: colors, size: 10, symbol: 'diamond',
      line: { color: '#1f2937', width: 1 } },
    hovertemplate: '%{text}<extra></extra>',
  }
}

/**
 * Markers for right-censored (suspension) times, placed on the curve at the
 * value of the active function. Uses distinct hollow/tick markers.
 */
export function suspensionTrace(
  rc: number[],
  curves: CurveData,
  key: CurveKey,
): Record<string, unknown> | null {
  if (rc.length === 0) return null
  const x = curves.x as number[] | undefined
  const y = curves[key] as number[] | undefined
  if (!x || !y) return null
  const px: number[] = []
  const py: number[] = []
  for (const t of rc) {
    const yv = interp(x, y, t)
    if (yv == null) continue
    px.push(t)
    py.push(yv)
  }
  if (px.length === 0) return null
  return {
    x: px, y: py, mode: 'markers', type: 'scatter',
    name: 'Suspensions',
    marker: {
      color: 'rgba(0,0,0,0)', size: 9, symbol: 'circle-open',
      line: { color: '#6b7280', width: 1.5 },
    },
    hovertemplate: 'Suspension: %{x}<extra></extra>',
  }
}
