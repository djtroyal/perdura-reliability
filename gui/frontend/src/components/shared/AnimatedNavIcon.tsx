import {
  forwardRef, type CSSProperties, type ForwardRefExoticComponent, type RefAttributes,
} from 'react'
import {
  ChartLineIcon, ThermometerIcon, CpuIcon, AtomIcon, TrendingUpIcon,
  ShieldCheckIcon, ChartScatterIcon, GaugeIcon, GitForkIcon,
} from 'lucide-animated'

// Imperative handle exposed by lucide-animated icons (no-op for static icons).
export interface AnimatedIconHandle { startAnimation?: () => void; stopAnimation?: () => void }

export type AnimatedIconName =
  | 'ChartLine' | 'Thermometer' | 'Cpu' | 'Atom' | 'TrendingUp'
  | 'ShieldCheck' | 'ChartScatter' | 'Gauge' | 'GitFork'

type IconC = ForwardRefExoticComponent<
  { size?: number; className?: string; style?: CSSProperties } & RefAttributes<AnimatedIconHandle>
>

const MAP = {
  ChartLine: ChartLineIcon, Thermometer: ThermometerIcon, Cpu: CpuIcon, Atom: AtomIcon,
  TrendingUp: TrendingUpIcon, ShieldCheck: ShieldCheckIcon, ChartScatter: ChartScatterIcon,
  Gauge: GaugeIcon, GitFork: GitForkIcon,
} as unknown as Record<AnimatedIconName, IconC>

/**
 * Renders one animated lucide-animated nav icon by name, forwarding the ref so
 * the parent can drive startAnimation()/stopAnimation(). Statically imports
 * lucide-animated + motion, so this module is the lazy chunk that keeps those
 * out of the initial bundle (App.tsx React.lazy-loads it behind a static
 * lucide-react fallback).
 */
const AnimatedNavIcon = forwardRef<AnimatedIconHandle, {
  name: AnimatedIconName; size?: number; className?: string; style?: CSSProperties
}>(({ name, size, className, style }, ref) => {
  const C = MAP[name]
  return <C ref={ref} size={size} className={className} style={style} />
})
AnimatedNavIcon.displayName = 'AnimatedNavIcon'

export default AnimatedNavIcon
