import { useState } from 'react'
import {
  LineChart, Thermometer, Network, Cpu, Atom, TrendingUp, ShieldCheck,
  BarChart3, FlaskConical, ScatterChart, Target,
} from 'lucide-react'
import LifeData from './components/LifeData'
import ALT from './components/ALT'
import SystemModeling from './components/SystemModeling'
import Prediction from './components/Prediction'
import PhysicsOfFailure from './components/PhysicsOfFailure'
import Growth from './components/Growth'
import Warranty from './components/Warranty'
import Descriptive from './components/Descriptive'
import Hypothesis from './components/Hypothesis'
import Regression from './components/Regression'
import SixSigma from './components/SixSigma'
import ProjectBar from './components/shared/ProjectBar'
import Logo from './components/shared/Logo'
import { ErrorBoundary } from './components/shared/ErrorBoundary'

type Tab =
  | 'life-data' | 'alt' | 'system-modeling' | 'prediction' | 'pof' | 'growth' | 'warranty'
  | 'descriptive' | 'hypothesis' | 'regression' | 'six-sigma'

const tabs: { id: Tab; label: string; moduleKey: string; icon: typeof LineChart; color: string }[] = [
  { id: 'life-data', label: 'Life Data Analysis', moduleKey: 'lifeData', icon: LineChart, color: 'text-blue-500' },
  { id: 'alt', label: 'Reliability Testing', moduleKey: 'alt', icon: Thermometer, color: 'text-amber-500' },
  { id: 'system-modeling', label: 'System Modeling', moduleKey: 'systemModeling', icon: Network, color: 'text-emerald-500' },
  { id: 'prediction', label: 'Failure Rate Prediction', moduleKey: 'prediction', icon: Cpu, color: 'text-indigo-500' },
  { id: 'pof', label: 'Physics of Failure', moduleKey: 'pof', icon: Atom, color: 'text-violet-500' },
  { id: 'growth', label: 'Reliability Growth', moduleKey: 'growth', icon: TrendingUp, color: 'text-green-500' },
  { id: 'warranty', label: 'Warranty Analysis', moduleKey: 'warranty', icon: ShieldCheck, color: 'text-cyan-500' },
  { id: 'descriptive', label: 'Descriptive Statistics', moduleKey: 'descriptive', icon: BarChart3, color: 'text-sky-500' },
  { id: 'hypothesis', label: 'Hypothesis Tests', moduleKey: 'hypothesis', icon: FlaskConical, color: 'text-fuchsia-500' },
  { id: 'regression', label: 'Regression', moduleKey: 'regression', icon: ScatterChart, color: 'text-orange-500' },
  { id: 'six-sigma', label: 'Six Sigma', moduleKey: 'sixSigma', icon: Target, color: 'text-teal-500' },
]

export default function App() {
  const [active, setActive] = useState<Tab>('life-data')
  const activeModuleKey = tabs.find(t => t.id === active)?.moduleKey ?? 'lifeData'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="px-6 flex items-stretch gap-6">
          <span className="font-semibold text-gray-900 text-base tracking-tight flex items-center gap-2 select-none"
            title="Perdura — Reliability Engineering Suite">
            <Logo size={24} />
            Perdura
          </span>
          <nav className="flex overflow-x-auto">
            {tabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActive(tab.id)}
                  title={tab.label}
                  className={`px-2.5 py-2.5 text-[11px] font-medium transition-colors border-b-2 flex items-center gap-1 whitespace-nowrap ${
                    active === tab.id
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  <Icon size={13} className={`flex-shrink-0 ${tab.color}`} />
                  {tab.label}
                </button>
              )
            })}
          </nav>
          <div className="flex-1" />
          <div className="flex items-center">
            <ProjectBar activeModule={activeModuleKey} />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col">
        <ErrorBoundary key={active} label={tabs.find(t => t.id === active)?.label}>
          {active === 'life-data' && <LifeData />}
          {active === 'alt' && <ALT />}
          {active === 'system-modeling' && <SystemModeling />}
          {active === 'prediction' && <Prediction />}
          {active === 'pof' && <PhysicsOfFailure />}
          {active === 'growth' && <Growth />}
          {active === 'warranty' && <Warranty />}
          {active === 'descriptive' && <Descriptive />}
          {active === 'hypothesis' && <Hypothesis />}
          {active === 'regression' && <Regression />}
          {active === 'six-sigma' && <SixSigma />}
        </ErrorBoundary>
      </main>

      <footer className="bg-white border-t border-gray-100 px-6 py-1.5 text-[10px] text-gray-400 flex-shrink-0 flex items-center gap-2">
        <Logo size={12} />
        <span>Perdura — Reliability Engineering Suite</span>
      </footer>
    </div>
  )
}
