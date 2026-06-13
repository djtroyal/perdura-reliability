/**
 * Perdura logo — a stylized "bathtub curve" (the hazard-rate curve every
 * reliability engineer knows: high infant-mortality, flat useful life, rising
 * wear-out). Simple, recognizable, and on-theme.
 */
export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="Perdura logo">
      <rect x="1" y="1" width="30" height="30" rx="7"
        fill="url(#perdura-grad)" />
      {/* baseline */}
      <line x1="6" y1="24" x2="26" y2="24" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
      {/* bathtub hazard curve */}
      <path d="M6 9 C 8 22, 9 23, 13 23 L 19 23 C 23 23, 24 22, 26 9"
        stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <defs>
        <linearGradient id="perdura-grad" x1="0" y1="0" x2="32" y2="32"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  )
}
