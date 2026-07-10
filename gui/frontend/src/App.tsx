import { useState, useEffect, useLayoutEffect, useRef, lazy, Suspense } from 'react'
// Nav uses static lucide-react icons for instant first paint. Tabs with an exact
// animated equivalent additionally swap to a lucide-animated icon once that chunk
// loads (lazy AnimatedNavIcon below) — keeping lucide-animated + motion (~100 KB
// gzip) out of the initial bundle. Tabs without an animated equivalent stay static.
import {
  LineChart, Thermometer, Network, Cpu, Atom, TrendingUp, ShieldCheck,
  FlaskConical, ScatterChart, Target, FolderKanban, FileText, GitFork,
  Wrench, Users, Loader2, LayoutDashboard, ChevronDown,
} from 'lucide-react'
import type { AnimatedIconHandle, AnimatedIconName } from './components/shared/AnimatedNavIcon'
const AnimatedNavIcon = lazy(() => import('./components/shared/AnimatedNavIcon'))
// Modules are code-split (React.lazy) so each loads on first visit instead of
// inflating the initial bundle. Heavy vendors are chunked in vite.config.ts.
const Dashboard = lazy(() => import('./components/Dashboard'))
const LifeData = lazy(() => import('./components/LifeData'))
const ALT = lazy(() => import('./components/ALT'))
const SystemModeling = lazy(() => import('./components/SystemModeling'))
const Prediction = lazy(() => import('./components/Prediction'))
const PhysicsOfFailure = lazy(() => import('./components/PhysicsOfFailure'))
const Growth = lazy(() => import('./components/Growth'))
const Warranty = lazy(() => import('./components/Warranty'))
const Maintenance = lazy(() => import('./components/Maintenance'))
const HRA = lazy(() => import('./components/HRA'))
const ReliabilityAllocation = lazy(() => import('./components/ReliabilityAllocation'))
const DataAnalysis = lazy(() => import('./components/DataAnalysis'))
const Hypothesis = lazy(() => import('./components/Hypothesis'))
const SixSigma = lazy(() => import('./components/SixSigma'))
const ReportBuilder = lazy(() => import('./components/ReportBuilder'))
import ProjectBar from './components/shared/ProjectBar'
import HelpButton from './components/shared/HelpButton'
import Logo from './components/shared/Logo'
import { ToastViewport, toast } from './components/shared/toast'
import DialogHost from './components/shared/ConfirmDialog'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { useProjectName, isDirty, useIsDirty, consumeStartupNotice, undo, redo, useNavTarget, clearNavTarget, NAV_MAP } from './store/project'
import { saveProjectFlow } from './components/shared/projectActions'
import SkiGame from './components/easteregg/SkiGame'
import { useSecretCode } from './components/easteregg/useSecretCode'
import { useUpdateCheck } from './api/updateCheck'
import AboutModal from './components/shared/AboutModal'

type Tab =
  | 'dashboard'
  | 'life-data' | 'alt' | 'system-modeling' | 'prediction' | 'pof' | 'growth' | 'warranty'
  | 'maintenance' | 'hra' | 'allocation' | 'hypothesis' | 'data-analysis' | 'six-sigma' | 'report-builder'

// `icon` is the static lucide-react glyph (instant paint / fallback); `anim` is
// the matching lucide-animated name (lazy-loaded) when one exists.
const tabs: {
  id: Tab; label: string; moduleKey: string
  icon: typeof Network; anim?: AnimatedIconName; color: string
}[] = [
  { id: 'dashboard', label: 'Dashboard', moduleKey: 'dashboard', icon: LayoutDashboard, color: 'text-blue-600' },
  { id: 'life-data', label: 'Life Data Analysis', moduleKey: 'lifeData', icon: LineChart, anim: 'ChartLine', color: 'text-blue-500' },
  { id: 'alt', label: 'Reliability Testing', moduleKey: 'alt', icon: Thermometer, anim: 'Thermometer', color: 'text-amber-500' },
  { id: 'system-modeling', label: 'System Modeling', moduleKey: 'systemModeling', icon: Network, color: 'text-emerald-500' },
  { id: 'allocation', label: 'Reliability Allocation', moduleKey: 'reliabilityAllocation', icon: GitFork, anim: 'GitFork', color: 'text-lime-600' },
  { id: 'prediction', label: 'Failure Rate Prediction', moduleKey: 'prediction', icon: Cpu, anim: 'Cpu', color: 'text-indigo-500' },
  { id: 'pof', label: 'Physics of Failure', moduleKey: 'pof', icon: Atom, anim: 'Atom', color: 'text-violet-500' },
  { id: 'growth', label: 'Reliability Growth', moduleKey: 'growth', icon: TrendingUp, anim: 'TrendingUp', color: 'text-green-500' },
  { id: 'maintenance', label: 'Maintenance', moduleKey: 'maintenance', icon: Wrench, color: 'text-slate-500' },
  { id: 'hra', label: 'Human Reliability', moduleKey: 'hra', icon: Users, color: 'text-rose-600' },
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

// Width reserved for the "More" overflow button (slight over-estimate is fine —
// it only makes the cutoff one tab more conservative).
const MORE_BTN_W = 84

/**
 * Priority-nav overflow: how many leading tabs fit in `width`, reserving room
 * for the More button whenever some don't. If the active tab is past the
 * cutoff it will be swapped into the last visible slot, so the fit check for
 * that slot uses the active tab's own width.
 */
function computeVisibleCount(width: number, widths: number[], activeIdx: number): number {
  const n = widths.length
  if (width <= 0 || widths.some(w => !w)) return n
  if (widths.reduce((a, b) => a + b, 0) <= width) return n
  const avail = width - MORE_BTN_W
  const prefix = [0]
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w)
  let k = 0
  while (k < n && prefix[k + 1] <= avail) k++
  if (activeIdx >= k) {
    // Last visible slot shows the active tab instead of tabs[k-1].
    while (k > 0 && prefix[k - 1] + widths[activeIdx] > avail) k--
  }
  return Math.max(k, 1)
}

/** "More ▾" dropdown listing the overflowed tabs (ProjectBar menu styling). */
function MoreMenu({ overflow, onPick }: { overflow: TabDef[]; onPick: (id: Tab) => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${overflow.length} more module${overflow.length === 1 ? '' : 's'}`}
        className="px-2.5 py-2.5 text-[11px] font-medium transition-colors border-b-2 border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300 flex items-center gap-1 whitespace-nowrap"
      >
        More ({overflow.length})
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 w-56 py-1">
          {overflow.map(tab => {
            const Icon = tab.icon
            return (
              <button key={tab.id} role="menuitem"
                onClick={() => { onPick(tab.id); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <Icon size={13} className={`flex-shrink-0 ${tab.color}`} />
                {tab.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [active, setActive] = useState<Tab>('dashboard')
  const [aboutOpen, setAboutOpen] = useState(false)
  // Sub-tab target handed to a container after an undo/redo, so it can jump to
  // the submodule whose change is being (un)done.
  const [navSub, setNavSub] = useState<{ tab: string; sub: string; nonce: number } | null>(null)
  const navTarget = useNavTarget()
  // Manual navigation clears any pending undo/redo target so a stale one can't
  // hijack a later manual tab switch.
  const go = (tab: Tab) => { clearNavTarget(); setNavSub(null); setActive(tab) }
  const activeModuleKey = tabs.find(t => t.id === active)?.moduleKey ?? 'dashboard'

  // --- Priority nav: collapse tabs that don't fit into a "More" menu ---
  // First paint renders all tabs (navWidth=Infinity); the layout effect caches
  // each tab's natural width once, then tracks the container width. The
  // visible count is derived at render purely from the cached widths, so
  // hiding tabs never feeds back into the measurement.
  const navRef = useRef<HTMLElement>(null)
  const tabWidths = useRef<number[]>([])
  const tabRefs = useRef<(HTMLElement | null)[]>([])
  const [navWidth, setNavWidth] = useState(Infinity)
  const [, bumpMeasure] = useState(0)
  useLayoutEffect(() => {
    const measureTabs = () => {
      tabRefs.current.forEach((el, i) => {
        if (el) tabWidths.current[i] = el.offsetWidth
      })
    }
    measureTabs()
    setNavWidth(navRef.current?.clientWidth ?? Infinity)
    const ro = new ResizeObserver(() =>
      setNavWidth(navRef.current?.clientWidth ?? Infinity))
    if (navRef.current) ro.observe(navRef.current)
    // The webfont can reflow tab widths after first paint; re-measure and
    // force a recompute (the container width itself may be unchanged).
    document.fonts?.ready.then(() => {
      measureTabs()
      bumpMeasure(n => n + 1)
    }).catch(() => {})
    return () => ro.disconnect()
  }, [])
  const activeIdx = tabs.findIndex(t => t.id === active)
  // Until every tab has been rendered and measured once, show all of them
  // (that first full render is what populates the width cache).
  const measured = tabWidths.current.filter(Boolean).length === tabs.length
  const visibleCount = measured
    ? computeVisibleCount(navWidth, tabWidths.current, activeIdx)
    : tabs.length
  let visibleTabs = tabs.slice(0, visibleCount)
  let overflowTabs = tabs.slice(visibleCount)
  if (activeIdx >= visibleCount) {
    visibleTabs = [...tabs.slice(0, visibleCount - 1), tabs[activeIdx]]
    overflowTabs = tabs.filter((_, i) => i >= visibleCount - 1 && i !== activeIdx)
  }
  const [projectName, setProjectName] = useProjectName()
  const dirty = useIsDirty()
  // Hidden Easter egg: ↑↑↓↓←→←→ B A, or type "yeti".
  const [skiOpen, setSkiOpen] = useState(false)
  useSecretCode(() => setSkiOpen(true))
  // Best-effort check for a newer release (public GitHub, once/day, silent).
  const { update, dismiss } = useUpdateCheck(__APP_VERSION__)

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        e.preventDefault()
        e.returnValue = ''   // required by some browsers to actually show the prompt
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Surface any startup recovery/corruption notice from the store (set before
  // the toast viewport existed).
  useEffect(() => {
    const notice = consumeStartupNotice()
    if (notice) toast.info(notice)
  }, [])

  // Global keyboard: Ctrl/Cmd-S saves; Ctrl/Cmd-Z / Shift-Z / Y undo/redo the
  // project (suppressed while typing in a field so native text undo still works).
  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null
      if (!el) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        || el.tagName === 'SELECT' || el.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void saveProjectFlow()
      } else if ((k === 'z' || k === 'y') && !isEditable(e.target)) {
        e.preventDefault()
        if (k === 'y' || e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // On undo/redo, jump to the module (and hand the sub-tab to the container) of
  // the change being (un)done.
  useEffect(() => {
    if (!navTarget) return
    const loc = NAV_MAP[navTarget.sliceKey]
    if (!loc) return
    setActive(loc.tab as Tab)
    if (loc.sub) setNavSub({ tab: loc.tab, sub: loc.sub, nonce: navTarget.nonce })
  }, [navTarget])

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        {/* Top row: brand · project name · project controls */}
        <div className="px-6 flex items-center gap-4 py-2 border-b border-gray-100">
          <button
            onClick={() => setAboutOpen(true)}
            title="About Perdura"
            aria-label="About Perdura"
            className="relative font-semibold text-gray-900 text-base tracking-tight flex items-center gap-2 select-none flex-shrink-0 hover:text-blue-700 transition-colors"
          >
            <Logo size={24} />
            Perdura
            {update && (
              <span
                title={`Perdura ${update.version} is available`}
                className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white"
              />
            )}
          </button>
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
        {/* Second row: module navigation. Tabs that don't fit the window
            width collapse into the trailing "More" menu (priority nav). */}
        <div className="px-6">
          <nav ref={navRef} className="flex min-w-0">
            {visibleTabs.map(tab => (
              <div key={tab.id} ref={el => { tabRefs.current[tabs.indexOf(tab)] = el }}
                className="flex-shrink-0">
                <NavTab tab={tab} active={active === tab.id} onClick={() => go(tab.id)} />
              </div>
            ))}
            {overflowTabs.length > 0 && (
              <MoreMenu overflow={overflowTabs} onPick={id => go(id)} />
            )}
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
            {active === 'dashboard' && <Dashboard onNavigate={(id) => go(id as Tab)} update={update} onOpenAbout={() => setAboutOpen(true)} />}
            {active === 'life-data' && <LifeData />}
            {active === 'alt' && <ALT navSub={navSub?.tab === 'alt' ? navSub : null} />}
            {active === 'system-modeling' && <SystemModeling navSub={navSub?.tab === 'system-modeling' ? navSub : null} />}
            {active === 'prediction' && <Prediction />}
            {active === 'pof' && <PhysicsOfFailure />}
            {active === 'growth' && <Growth />}
            {active === 'maintenance' && <Maintenance navSub={navSub?.tab === 'maintenance' ? navSub : null} />}
            {active === 'hra' && <HRA navSub={navSub?.tab === 'hra' ? navSub : null} />}
            {active === 'allocation' && <ReliabilityAllocation />}
            {active === 'warranty' && <Warranty />}
            {active === 'hypothesis' && <Hypothesis />}
            {active === 'data-analysis' && <DataAnalysis navSub={navSub?.tab === 'data-analysis' ? navSub : null} />}
            {active === 'six-sigma' && <SixSigma navSub={navSub?.tab === 'six-sigma' ? navSub : null} />}
            {active === 'report-builder' && <ReportBuilder />}
          </Suspense>
        </ErrorBoundary>
      </main>

      <footer className="bg-white border-t border-gray-100 px-6 py-1.5 text-[10px] text-gray-400 flex-shrink-0 flex items-center gap-2">
        <Logo size={12} />
        <span>Perdura — Reliability Engineering and Statistics Suite</span>
      </footer>

      {skiOpen && <SkiGame onClose={() => setSkiOpen(false)} />}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} update={update} onDismissUpdate={dismiss} />
      <ToastViewport />
      <DialogHost />
    </div>
  )
}
