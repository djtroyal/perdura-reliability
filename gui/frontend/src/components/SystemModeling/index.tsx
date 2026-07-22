import { Network, GitFork, GitBranch } from 'lucide-react'
import SystemReliability from '../SystemReliability'
import FaultTreePage from '../FaultTree'
import Markov from '../Markov'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { useApplySubNav, SubNav } from '../shared/useSubNav'
import { useHelpTopic } from '../help/context'
import { useRememberedTab } from '../shared/useRememberedTab'
import { handleTabKey } from '../shared/tabKeyboard'

type SubTab = 'rbd' | 'fta' | 'markov'

const subTabs: { id: SubTab; label: string; icon: typeof Network; color: string }[] = [
  { id: 'rbd', label: 'RBD', icon: Network, color: 'text-emerald-500' },
  { id: 'fta', label: 'Fault Tree Analysis', icon: GitFork, color: 'text-rose-500' },
  { id: 'markov', label: 'Markov Analysis', icon: GitBranch, color: 'text-purple-500' },
]

export default function SystemModeling({ navSub }: { navSub?: SubNav | null }) {
  const [active, setActive] = useRememberedTab(
    'system-modeling', 'rbd', subTabs.map(tab => tab.id),
  )
  useHelpTopic(active === 'fta' ? 'systemModeling.fault-tree' : `systemModeling.${active}`)
  useApplySubNav(navSub, s => setActive(s as SubTab))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div role="tablist" aria-label="System Modeling analyses" className="bg-gray-100 border-b border-gray-200 flex items-center px-4 gap-1 flex-shrink-0" style={{ height: 36 }}>
        {subTabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              role="tab"
              aria-selected={active === tab.id}
              tabIndex={active === tab.id ? 0 : -1}
              data-tab-id={tab.id}
              onKeyDown={event => handleTabKey(event, {
                ids: subTabs.map(item => item.id), currentId: tab.id,
                onSelect: id => setActive(id as SubTab),
              })}
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
          {active === 'rbd' && <SystemReliability onNavigate={() => setActive('fta')} />}
          {active === 'fta' && <FaultTreePage onNavigate={() => setActive('rbd')} />}
          {active === 'markov' && <Markov />}
        </ErrorBoundary>
      </div>
    </div>
  )
}
