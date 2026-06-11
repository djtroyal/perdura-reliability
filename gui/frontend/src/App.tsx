import { useState } from 'react'
import LifeData from './components/LifeData'
import ALT from './components/ALT'
import SystemReliability from './components/SystemReliability'
import FaultTreePage from './components/FaultTree'
import Prediction from './components/Prediction'
import PhysicsOfFailure from './components/PhysicsOfFailure'
import ProjectBar from './components/shared/ProjectBar'

type Tab = 'life-data' | 'alt' | 'system' | 'fault-tree' | 'prediction' | 'pof'

const tabs: { id: Tab; label: string; moduleKey: string }[] = [
  { id: 'life-data', label: 'Life Data Analysis', moduleKey: 'lifeData' },
  { id: 'alt', label: 'Accelerated Life Testing', moduleKey: 'alt' },
  { id: 'system', label: 'RBD', moduleKey: 'system' },
  { id: 'fault-tree', label: 'Fault Tree Analysis', moduleKey: 'faultTree' },
  { id: 'prediction', label: 'Failure Rate Prediction', moduleKey: 'prediction' },
  { id: 'pof', label: 'Physics of Failure', moduleKey: 'pof' },
]

export default function App() {
  const [active, setActive] = useState<Tab>('life-data')
  const activeModuleKey = tabs.find(t => t.id === active)?.moduleKey ?? 'lifeData'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="px-6 flex items-stretch gap-6">
          <span className="font-semibold text-gray-900 text-base tracking-tight flex items-center select-none">
            Reliability Analysis Suite
          </span>
          <nav className="flex">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`px-3 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                  active === tab.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
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
      </main>

      <footer className="bg-white border-t border-gray-100 px-6 py-1.5 text-[10px] text-gray-400 flex-shrink-0">
        Inspired by the{' '}
        <a href="https://reliability.readthedocs.io/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">reliability</a>{' '}
        Python library. Reid, M. (2022). <em>JOSS</em>, 7(76), 4619.{' '}
        <a href="https://doi.org/10.21105/joss.04619" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">doi:10.21105/joss.04619</a>
      </footer>
    </div>
  )
}
