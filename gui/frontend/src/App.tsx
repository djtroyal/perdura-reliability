import { useState } from 'react'
import LifeData from './components/LifeData'
import ALT from './components/ALT'
import SystemReliability from './components/SystemReliability'
import FaultTreePage from './components/FaultTree'
import Prediction from './components/Prediction'

type Tab = 'life-data' | 'alt' | 'system' | 'fault-tree' | 'prediction'

const tabs: { id: Tab; label: string }[] = [
  { id: 'life-data', label: 'Life Data Analysis' },
  { id: 'alt', label: 'Accelerated Life Testing' },
  { id: 'system', label: 'System Reliability' },
  { id: 'fault-tree', label: 'Fault Tree Analysis' },
  { id: 'prediction', label: 'Failure Rate Prediction' },
]

export default function App() {
  const [active, setActive] = useState<Tab>('life-data')

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="px-6 py-3 flex items-center gap-8">
          <span className="font-semibold text-gray-900 text-lg tracking-tight">
            Reliability Analysis
          </span>
          <nav className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  active === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        {active === 'life-data' && <LifeData />}
        {active === 'alt' && <ALT />}
        {active === 'system' && <SystemReliability />}
        {active === 'fault-tree' && <FaultTreePage />}
        {active === 'prediction' && <Prediction />}
      </main>
    </div>
  )
}
