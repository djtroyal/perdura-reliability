import { useState, useEffect, useRef, lazy, Suspense } from 'react'
// Nav uses static lucide-react icons for instant first paint. Tabs with an exact
// animated equivalent additionally swap to a lucide-animated icon once that chunk
// loads (lazy AnimatedNavIcon below) — keeping lucide-animated + motion (~100 KB
// gzip) out of the initial bundle. Tabs without an animated equivalent stay static.
import {
  LineChart, Thermometer, Network, Cpu, Atom, TrendingUp, ShieldCheck,
  FlaskConical, ScatterChart, Target, FolderKanban, FileText, Gauge, GitFork,
  Wrench, Loader2,
} from 'lucide-react'
import type { AnimatedIconHandle, AnimatedIconName } from './components/shared/AnimatedNavIcon'
const AnimatedNavIcon = lazy(() => import('./components/shared/AnimatedNavIcon'))
// Modules are code-split (React.lazy) so each loads on first visit instead of
// inflating the initial bundle. Heavy vendors are chunked in vite.config.ts.
const LifeData = lazy(() => import('./components/LifeData'))
const ALT = lazy(() => import('./components/ALT'))
const SystemModeling = lazy(() => import('./components/SystemModeling'))
const Prediction = lazy(() => import('./components/Prediction'))
const PhysicsOfFailure = lazy(() => import('./components/PhysicsOfFailure'))
const Growth = lazy(() => import('./components/Growth'))
const Warranty = lazy(() => import('./components/Warranty'))
const RAM = lazy(() => import('./components/RAM'))
const Maintenance = lazy(() => import('./components/Maintenance'))
const ReliabilityAllocation = lazy(() => import('./components/ReliabilityAllocation'))
const DataAnalysis = lazy(() => import('./components/DataAnalysis'))
const Hypothesis = lazy(() => import('./components/Hypothesis'))
const SixSigma = lazy(() => import('./components/SixSigma'))
const ReportBuilder = lazy(() => import('./components/ReportBuilder'))
import ProjectBar from './components/shared/ProjectBar'
import HelpButton from './components/shared/HelpButton'
import Logo from './components/shared/Logo'
import { ToastViewport } from './components/shared/toast'
import DialogHost from './components/shared/ConfirmDialog'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { useProjectName, isDirty, useIsDirty } from './store/project'
import { saveProjectFlow } from './components/shared/projectActions'
import SkiGame from './components/easteregg/SkiGame'
import { useSecretCode } from './components/easteregg/useSecretCode'

type Tab =
  | 'life-data' | 'alt' | 'system-modeling' | 'prediction' | 'pof' | 'growth' | 'warranty'
  | 'ram' | 'maintenance' | 'allocation' | 'hypothesis' | 'data-analysis' | 'six-sigma' | 'report-builder'

// `icon` is the static lucide-react glyph (instant paint / fallback); `anim` is
// the matching lucide-animated name (lazy-loaded) when one exists.
const tabs: {
  id: Tab; label: string; moduleKey: string
  icon: typeof Network; anim?: AnimatedIconName; color: string
}[] = [
  { id: 'life-data', label: 'Life Data Analysis', moduleKey: 'lifeData', icon: LineChart, anim: 'ChartLine', color: 'text-blue-500' },
  { id: 'alt', label: 'Reliability Testing', moduleKey: 'alt', icon: Thermometer, anim: 'Thermometer', color: 'text-amber-500' },
  { id: 'system-modeling', label: 'System Modeling', moduleKey: 'systemModeling', icon: Network, color: 'text-emerald-500' },
  { id: 'allocation', label: 'Reliability Allocation', moduleKey: 'reliabilityAllocation', icon: GitFork, anim: 'GitFork', color: 'text-lime-600' },
  { id: 'prediction', label: 'Failure Rate Prediction', moduleKey: 'prediction', icon: Cpu, anim: 'Cpu', color: 'text-indigo-500' },
  { id: 'pof', label: 'Physics of Failure', moduleKey: 'pof', icon: Atom, anim: 'Atom', color: 'text-violet-500' },
  { id: 'growth', label: 'Reliability Growth', moduleKey: 'growth', icon: TrendingUp, anim: 'TrendingUp', color: 'text-green-500' },
  { id: 'ram', label: 'Availability & Spares', moduleKey: 'ram', icon: Gauge, anim: 'Gauge', color: 'text-sky-500' },
  { id: 'maintenance', label: 'Maintenance', moduleKey: 'maintenance', icon: Wrench, color: 'text-slate-500' },
  { id: 'warranty', label: 'Warranty Analysis', moduleKey: 'warranty', icon: ShieldCheck, anim: 'ShieldCheck', color: 'text-cyan-500' },
  { id: 'hypothesis', label: 'Hypothesis Tests', moduleKey: 'hypothesis', icon: FlaskConical, color: 'text-fuchsia-500' },
  { id: 'data-analysis', label: 'Statistical Modeling', moduleKey: 'dataAnalysis', icon: ScatterChart, anim: 'ChartScatter', color: 'text-orange-500' },
  { id: 'six-sigma', label: 'Six Sigma', moduleKey: 'sixSigma', icon: Target, color: 'text-teal-500' },
  { id: 'report-builder', label: 'Report Builder', moduleKey: 'reportBuilder', icon: FileText, color: 'text-rose-500' },
]

type TabDef = typeof tabs[number]

/**
 * A navigation tab. When the tab has an animated icon, it swaps in the lazy
 * lucide-animated version (static icon shown until that chunk loads) and animates
 * when the whole tab is hovered or selected — driven via the icon's ref.
 */
function NavTab({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) {
  const iconRef = useRef<AnimatedIconHandle | null>(null)
  const play = () => iconRef.current?.startAnimation?.()
  // Animate when this tab becomes the selected one (no-op until the chunk loads).
  useEffect(() => { if (active) play() }, [active])
  const StaticIcon = tab.icon
  const staticIcon = <StaticIcon size={13} className={`flex-shrink-0 ${tab.color}`} />
  return (
    <button
      onClick={onClick}
      onMouseEnter={play}
      title={tab.label}
      className={`px-2.5 py-2.5 text-[11px] font-medium transition-colors border-b-2 flex items-center gap-1 whitespace-nowrap ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
      }`}
    >
      {tab.anim
        ? <Suspense fallback={staticIcon}>
            <AnimatedNavIcon ref={iconRef} name={tab.anim} size={13} className={`flex-shrink-0 ${tab.color}`} />
          </Suspense>
        : staticIcon}
      {tab.label}
    </button>
  )
}

export default function App() {
  const [active, setActive] = useState<Tab>('life-data')
  const activeModuleKey = tabs.find(t => t.id === active)?.moduleKey ?? 'lifeData'
  const [projectName, setProjectName] = useProjectName()
  const dirty = useIsDirty()
  // Hidden Easter egg: ↑↑↓↓←→←→ B A, or type "yeti".
  const [skiOpen, setSkiOpen] = useState(false)
  useSecretCode(() => setSkiOpen(true))

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Global Ctrl/Cmd-S saves the project (same flow as the ProjectBar button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        void saveProjectFlow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        {/* Top row: brand · project name · project controls */}
        <div className="px-6 flex items-center gap-4 py-2 border-b border-gray-100">
          <span className="font-semibold text-gray-900 text-base tracking-tight flex items-center gap-2 select-none flex-shrink-0"
            title="Perdura — Reliability Engineering and Statistics Suite">
            <Logo size={24} />
            Perdura
          </span>
          {/* Prominent project name field */}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 focus-within:ring-2 focus-within:ring-blue-400/40 focus-within:border-blue-400">
            <FolderKanban size={16} className="text-blue-500 flex-shrink-0" />
            <input
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="Untitled Project"
              title="Project name"
              className="bg-transparent text-sm font-medium text-gray-800 w-56 focus:outline-none placeholder:text-gray-400 placeholder:font-normal"
            />
          </div>
          {/* Saved / unsaved-changes indicator (Ctrl/Cmd-S to save). */}
          <span
            title={dirty ? 'You have unsaved changes — press Ctrl/Cmd-S or click Save' : 'All changes saved to this browser'}
            className={`flex items-center gap-1.5 text-[11px] font-medium flex-shrink-0 ${dirty ? 'text-amber-600' : 'text-gray-400'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${dirty ? 'bg-amber-500' : 'bg-gray-300'}`} />
            {dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <HelpButton activeModule={activeModuleKey} />
            <ProjectBar activeModule={activeModuleKey} />
          </div>
        </div>
        {/* Second row: module navigation */}
        <div className="px-6">
          <nav className="flex overflow-x-auto">
            {tabs.map(tab => (
              <NavTab key={tab.id} tab={tab} active={active === tab.id} onClick={() => setActive(tab.id)} />
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col">
        <ErrorBoundary key={active} label={tabs.find(t => t.id === active)?.label}>
          <Suspense fallback={
            <div className="flex-1 flex items-center justify-center text-gray-400 gap-2 text-sm">
              <Loader2 size={18} className="animate-spin" /> Loading…
            </div>
          }>
            {active === 'life-data' && <LifeData />}
            {active === 'alt' && <ALT />}
            {active === 'system-modeling' && <SystemModeling />}
            {active === 'prediction' && <Prediction />}
            {active === 'pof' && <PhysicsOfFailure />}
            {active === 'growth' && <Growth />}
            {active === 'ram' && <RAM />}
            {active === 'maintenance' && <Maintenance />}
            {active === 'allocation' && <ReliabilityAllocation />}
            {active === 'warranty' && <Warranty />}
            {active === 'hypothesis' && <Hypothesis />}
            {active === 'data-analysis' && <DataAnalysis />}
            {active === 'six-sigma' && <SixSigma />}
            {active === 'report-builder' && <ReportBuilder />}
          </Suspense>
        </ErrorBoundary>
      </main>

      <footer className="bg-white border-t border-gray-100 px-6 py-1.5 text-[10px] text-gray-400 flex-shrink-0 flex items-center gap-2">
        <Logo size={12} />
        <span>Perdura — Reliability Engineering and Statistics Suite</span>
      </footer>

      {skiOpen && <SkiGame onClose={() => setSkiOpen(false)} />}
      <ToastViewport />
      <DialogHost />
    </div>
  )
}
