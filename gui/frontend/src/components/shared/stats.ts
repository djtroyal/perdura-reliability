/**
 * Small statistical helpers for client-side result visualisation.
 */

/**
 * Beta probability density on a 0–1 grid, normalised numerically (trapezoid) so
 * the curve integrates to ~1 without needing a gamma function. Returns the grid
 * `x` and density `y`. Guards against the unbounded ends when α or β < 1.
 */
export function betaPdfCurve(alpha: number, beta: number, n = 201): { x: number[]; y: number[] } {
  const x: number[] = []
  const yRaw: number[] = []
  for (let i = 0; i < n; i++) {
    // Nudge off the exact 0/1 endpoints to keep x^(a-1)(1-x)^(b-1) finite.
    const t = Math.min(1 - 1e-9, Math.max(1e-9, i / (n - 1)))
    x.push(t)
    yRaw.push(Math.exp((alpha - 1) * Math.log(t) + (beta - 1) * Math.log(1 - t)))
  }
  // Trapezoidal area for normalisation.
  let area = 0
  for (let i = 1; i < n; i++) area += (x[i] - x[i - 1]) * (yRaw[i] + yRaw[i - 1]) / 2
  const y = area > 0 && isFinite(area) ? yRaw.map(v => v / area) : yRaw
  return { x, y }
}
