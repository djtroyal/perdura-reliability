/**
 * Perdura logo — a family of left-skewed Weibull probability-density curves
 * (long left tail, peak shifted toward the right) drawn in rainbow colors over
 * a soft, light background. Evokes life-data analysis and the shape of a
 * wear-out failure distribution.
 *
 * Each curve is a smooth left-skewed bell sharing the same baseline; the
 * front-most curve is filled to read clearly as a PDF.
 */
const CURVES: { d: string; c: string }[] = [
  // back (tallest) → front (shortest), rainbow order
  { d: 'M5 25 C 13 25, 17 24, 21 4  C 22.5 11, 24 23, 27 25', c: '#a855f7' }, // violet
  { d: 'M5 25 C 13 25, 16.5 24, 20 7  C 21.5 13, 23 23.5, 26 25', c: '#3b82f6' }, // blue
  { d: 'M5 25 C 12.5 25, 16 24, 19 10 C 20.5 15, 22 24, 25 25', c: '#22c55e' }, // green
]

// Front filled curve (amber→red) — the headline left-skewed PDF.
const FILL_CURVE = 'M5 25 C 12 25, 15.5 24, 18 12.5 C 19.5 17, 21 24, 24 25'

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="Perdura logo">
      {/* soft light backdrop */}
      <rect x="1" y="1" width="30" height="30" rx="7" fill="url(#perdura-bg)"
        stroke="#e2e8f0" strokeWidth="0.75" />
      {/* baseline */}
      <line x1="5" y1="25" x2="27" y2="25" stroke="#cbd5e1" strokeWidth="1.1"
        strokeLinecap="round" />
      {/* rainbow family of left-skewed PDF curves */}
      {CURVES.map(c => (
        <path key={c.c} d={c.d} stroke={c.c} strokeWidth="1.6"
          strokeLinecap="round" fill="none" />
      ))}
      {/* front filled headline curve */}
      <path d={`${FILL_CURVE} L24 25 L5 25 Z`} fill="url(#perdura-fill)" opacity="0.85" />
      <path d={FILL_CURVE} stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <defs>
        <linearGradient id="perdura-bg" x1="0" y1="0" x2="32" y2="32"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#f8fafc" />
          <stop offset="1" stopColor="#eef2ff" />
        </linearGradient>
        <linearGradient id="perdura-fill" x1="0" y1="4" x2="0" y2="25"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb923c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ef4444" stopOpacity="0.10" />
        </linearGradient>
      </defs>
    </svg>
  )
}
