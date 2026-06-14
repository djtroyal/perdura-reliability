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
  // back (tallest) → front (shortest), rainbow order — smooth rounded peaks
  { d: 'M4 25 C 10 25, 15 23, 19 8  C 21 14, 24 23, 28 25', c: '#a855f7' }, // violet
  { d: 'M4 25 C 10 25, 14 22, 18 10 C 20 15, 23 23, 27 25', c: '#3b82f6' }, // blue
  { d: 'M4 25 C 9 25, 13 22, 17 12  C 19 16, 22 23, 26 25', c: '#22c55e' }, // green
]

// Front filled curve (amber→red) — smooth rounded left-skewed PDF.
const FILL_CURVE = 'M4 25 C 9 25, 12 22, 16 14 C 18 17.5, 21 23, 25 25'

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="Perdura logo">
      {/* soft light backdrop */}
      <rect x="1" y="1" width="30" height="30" rx="7" fill="url(#perdura-bg)"
        stroke="#e2e8f0" strokeWidth="0.75" />
      {/* baseline */}
      <line x1="4" y1="25" x2="28" y2="25" stroke="#cbd5e1" strokeWidth="1.1"
        strokeLinecap="round" />
      {/* rainbow family of left-skewed PDF curves */}
      {CURVES.map(c => (
        <path key={c.c} d={c.d} stroke={c.c} strokeWidth="1.6"
          strokeLinecap="round" fill="none" />
      ))}
      {/* front filled headline curve */}
      <path d={`${FILL_CURVE} L25 25 L4 25 Z`} fill="url(#perdura-fill)" opacity="0.85" />
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
