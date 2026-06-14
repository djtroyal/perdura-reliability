/**
 * Perdura logo — a stylized family of Weibull probability-density curves
 * radiating from a common origin in rainbow colors (each "ray" is a Weibull
 * PDF of a different shape parameter). Evokes life-data analysis and the
 * spread of failure distributions, on a dark field so the colors pop.
 */
const RAYS: { d: string; c: string }[] = [
  { d: 'M6 25 C 9 23, 11 6, 26 6', c: '#ef4444' },   // red
  { d: 'M6 25 C 9 24, 11 9, 26 10', c: '#f97316' },  // orange
  { d: 'M6 25 C 10 25, 13 12, 26 14', c: '#eab308' }, // yellow
  { d: 'M6 25 C 10 25, 14 16, 26 18', c: '#22c55e' }, // green
  { d: 'M6 25 C 11 25, 16 20, 26 21', c: '#3b82f6' }, // blue
  { d: 'M6 25 C 12 25, 18 23, 26 24', c: '#a855f7' }, // violet
]

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="Perdura logo">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="url(#perdura-grad)" />
      {/* baseline */}
      <line x1="6" y1="25" x2="26" y2="25" stroke="rgba(255,255,255,0.30)" strokeWidth="1.1" />
      {/* rainbow fan of Weibull PDF curves radiating from the origin */}
      {RAYS.map(r => (
        <path key={r.c} d={r.d} stroke={r.c} strokeWidth="1.7"
          strokeLinecap="round" fill="none" />
      ))}
      {/* origin dot */}
      <circle cx="6" cy="25" r="1.6" fill="white" />
      <defs>
        <linearGradient id="perdura-grad" x1="0" y1="0" x2="32" y2="32"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
      </defs>
    </svg>
  )
}
