import { useState } from 'react'
import {
  LineChart, Thermometer, Network, GitFork, Cpu, Atom, TrendingUp, ShieldCheck,
} from 'lucide-react'
import LifeData from './components/LifeData'
import ALT from './components/ALT'
import SystemReliability from './components/SystemReliability'
import FaultTreePage from './components/FaultTree'
import Prediction from './components/Prediction'
import PhysicsOfFailure from './components/PhysicsOfFailure'
import Growth from './components/Growth'
import Warranty from './components/Warranty'
import ProjectBar from './components/shared/ProjectBar'
import Logo from './components/shared/Logo'

type Tab = 'life-data' | 'alt' | 'system' | 'fault-tree' | 'prediction' | 'pof' | 'growth' | 'warranty'

const tabs: { id: Tab; label: string; moduleKey: string; icon: typeof LineChart }[] = [
  { id: 'life-data', label: 'Life Data Analysis', moduleKey: 'lifeData', icon: LineChart },
  { id: 'alt', label: 'Reliability Testing', moduleKey: 'alt', icon: Thermometer },
  { id: 'system', label: 'RBD', moduleKey: 'system', icon: Network },
  { id: 'fault-tree', label: 'Fault Tree Analysis', moduleKey: 'faultTree', icon: GitFork },
  { id: 'prediction', label: 'Failure Rate Prediction', moduleKey: 'prediction', icon: Cpu },
  { id: 'pof', label: 'Physics of Failure', moduleKey: 'pof', icon: Atom },
  { id: 'growth', label: 'Reliability Growth', moduleKey: 'growth', icon: TrendingUp },
  { id: 'warranty', label: 'Warranty Analysis', moduleKey: 'warranty', icon: ShieldCheck },
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
          <nav className="flex">
            {tabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActive(tab.id)}
                  title={tab.label}
                  className={`px-3 py-2.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
                    active === tab.id
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  <Icon size={14} className="flex-shrink-0" />
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

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        {active === 'life-data' && <LifeData />}
        {active === 'alt' && <ALT />}
        {active === 'system' && <SystemReliability />}
        {active === 'fault-tree' && <FaultTreePage />}
        {active === 'prediction' && <Prediction />}
        {active === 'pof' && <PhysicsOfFailure />}
        {active === 'growth' && <Growth />}
        {active === 'warranty' && <Warranty />}
      </main>

      <footer className="bg-white border-t border-gray-100 px-6 py-1.5 text-[10px] text-gray-400 flex-shrink-0 flex items-center gap-2">
        <Logo size={12} />
        <span>Perdura — Reliability Engineering Suite</span>
      </footer>
    </div>
  )
}
