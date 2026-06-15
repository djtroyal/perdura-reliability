/**
 * Perdura logo — a nested family of Weibull probability-density curves with a
 * shape parameter β = 1.7 (a smooth, rounded peak with a gentle right tail),
 * drawn in rainbow colors over a soft, light background. Evokes life-data
 * analysis and the shape of a wear-out failure distribution.
 *
 * The paths are sampled from an actual Weibull(β=1.7) PDF, so the peak is
 * genuinely rounded rather than a sharp spike. The front-most curve is filled
 * to read clearly as a PDF. The backdrop is a dark slate (not pure black) so
 * the rainbow curves read with strong contrast.
 */
const CURVES: { d: string; c: string }[] = [
  // back (tallest) → front (shortest), rainbow order
  { d: 'M4 25 L4.0 24.6 L6.2 9.3 L8.4 5.0 L10.6 6.2 L12.7 10.1 L14.9 14.6 L17.1 18.5 L19.3 21.3 L21.5 23.1 L23.6 24.1 L25.8 24.6 L28.0 24.8', c: '#a855f7' }, // violet
  { d: 'M4 25 L4.0 24.7 L6.2 11.7 L8.4 8.0 L10.6 9.0 L12.7 12.3 L14.9 16.2 L17.1 19.5 L19.3 21.9 L21.5 23.4 L23.6 24.2 L25.8 24.6 L28.0 24.9', c: '#3b82f6' }, // blue
  { d: 'M4 25 L4.0 24.7 L6.2 14.0 L8.4 11.0 L10.6 11.8 L12.7 14.6 L14.9 17.7 L17.1 20.5 L19.3 22.4 L21.5 23.7 L23.6 24.3 L25.8 24.7 L28.0 24.9', c: '#22c55e' }, // green
]

// Front filled curve (amber→red) — the headline Weibull(β=1.7) PDF.
const FILL_CURVE = 'M4 25 L4.0 24.8 L6.2 16.0 L8.4 13.5 L10.6 14.2 L12.7 16.4 L14.9 19.0 L17.1 21.3 L19.3 22.9 L21.5 23.9 L23.6 24.5 L25.8 24.8 L28.0 24.9'

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="Perdura logo">
      {/* dark slate backdrop */}
      <rect x="1" y="1" width="30" height="30" rx="7" fill="url(#perdura-bg)"
        stroke="#334155" strokeWidth="0.75" />
      {/* baseline */}
      <line x1="4" y1="25" x2="28" y2="25" stroke="#475569" strokeWidth="1.1"
        strokeLinecap="round" />
      {/* rainbow family of Weibull PDF curves */}
      {CURVES.map(c => (
        <path key={c.c} d={c.d} stroke={c.c} strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
      {/* front filled headline curve */}
      <path d={`${FILL_CURVE} L28 25 L4 25 Z`} fill="url(#perdura-fill)" opacity="0.85" />
      <path d={FILL_CURVE} stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round"
        strokeLinejoin="round" fill="none" />
      <defs>
        <linearGradient id="perdura-bg" x1="0" y1="0" x2="32" y2="32"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="perdura-fill" x1="0" y1="4" x2="0" y2="25"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb923c" stopOpacity="0.70" />
          <stop offset="1" stopColor="#ef4444" stopOpacity="0.12" />
        </linearGradient>
      </defs>
    </svg>
  )
}
