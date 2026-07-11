import { Tabs } from '../shared/ui'
import { SubNav } from '../shared/useSubNav'
import type { ToolDef } from '../shared/ui'
import Availability from './Availability'
import Maintainability from './Maintainability'
import Spares from './Spares'
import ReplacementPolicy from './ReplacementPolicy'
import PMInterval from './PMInterval'
import CostForecast from './CostForecast'
import AvailabilitySensitivity from './AvailabilitySensitivity'
import VirtualAge from './VirtualAge'

/**
 * Maintenance module — the home for availability, maintainability & spares
 * (availability from MTBF/MTTR/delays, lognormal repair-time roll-up, Poisson
 * spares) plus maintenance planning: preventive replacement policies (age vs
 * block), the PM interval that sustains a reliability target (MFOP), a
 * maintenance-cost forecast, and availability sensitivity / solve-for-target.
 * Complements Growth (ROCOF/MCF trend tools) and Markov (state-based availability).
 */
const TOOLS: ToolDef[] = [
  { id: 'availability', label: 'Availability', render: () => <Availability /> },
  { id: 'maintainability', label: 'Maintainability', render: () => <Maintainability /> },
  { id: 'spares', label: 'Spares', render: () => <Spares /> },
  { id: 'replacement', label: 'Replacement Policy', render: () => <ReplacementPolicy /> },
  { id: 'pm-interval', label: 'PM Interval (MFOP)', render: () => <PMInterval /> },
  { id: 'cost-forecast', label: 'Cost Forecast', render: () => <CostForecast /> },
  { id: 'virtual-age', label: 'Virtual Age', render: () => <VirtualAge /> },
  { id: 'availability-sensitivity', label: 'Availability Sensitivity', render: () => <AvailabilitySensitivity /> },
]

export default function Maintenance({ navSub }: { navSub?: SubNav | null }) {
  return (
    <div className="flex flex-col h-full">
      <Tabs tools={TOOLS} navSub={navSub} />
    </div>
  )
}
