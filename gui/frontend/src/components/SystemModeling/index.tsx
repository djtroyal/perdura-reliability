import { useState } from 'react'
import { Network, GitFork, GitBranch } from 'lucide-react'
import SystemReliability from '../SystemReliability'
import FaultTreePage from '../FaultTree'
import Markov from '../Markov'
import { ErrorBoundary } from '../shared/ErrorBoundary'

type SubTab = 'rbd' | 'fta' | 'markov'

const subTabs: { id: SubTab; label: string; icon: typeof Network; color: string }[] = [
  { id: 'rbd', label: 'RBD', icon: Network, color: 'text-emerald-500' },
  { id: 'fta', label: 'Fault Tree Analysis', icon: GitFork, color: 'text-rose-500' },
  { id: 'markov', label: 'Markov Analysis', icon: GitBranch, color: 'text-purple-500' },
]

export default function SystemModeling() {
  const [active, setActive] = useState<SubTab>('rbd')

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="bg-gray-100 border-b border-gray-200 flex items-center px-4 gap-1 flex-shrink-0" style={{ height: 36 }}>
        {subTabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors border-b-2 flex items-center gap-1 whitespace-nowrap ${
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
      </div>

      {/* Active sub-module */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <ErrorBoundary key={active} label={subTabs.find(t => t.id === active)?.label}>
          {active === 'rbd' && <SystemReliability />}
          {active === 'fta' && <FaultTreePage />}
          {active === 'markov' && <Markov />}
        </ErrorBoundary>
      </div>
    </div>
  )
}
