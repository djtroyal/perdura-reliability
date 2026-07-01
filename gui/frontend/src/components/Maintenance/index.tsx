import { Tabs } from '../shared/ui'
import type { ToolDef } from '../shared/ui'
import ReplacementPolicy from './ReplacementPolicy'
import PMInterval from './PMInterval'
import CostForecast from './CostForecast'
import AvailabilitySensitivity from './AvailabilitySensitivity'

/**
 * Maintenance module — planning tools for repairable systems: preventive
 * replacement policies (age vs block), the PM interval that sustains a
 * reliability target (MFOP), a maintenance-cost forecast over a horizon, and
 * availability sensitivity / solve-for-target. Complements the RAM module
 * (availability/maintainability/spares) and Growth (ROCOF/MCF trend tools).
 */
const TOOLS: ToolDef[] = [
  { id: 'replacement', label: 'Replacement Policy', render: () => <ReplacementPolicy /> },
  { id: 'pm-interval', label: 'PM Interval (MFOP)', render: () => <PMInterval /> },
  { id: 'cost-forecast', label: 'Cost Forecast', render: () => <CostForecast /> },
  { id: 'availability', label: 'Availability Sensitivity', render: () => <AvailabilitySensitivity /> },
]

export default function Maintenance() {
  return (
    <div className="flex flex-col h-full">
      <Tabs tools={TOOLS} />
    </div>
  )
}
