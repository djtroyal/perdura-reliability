import { Tabs } from '../shared/ui'
import { SubNav } from '../shared/useSubNav'
import type { ToolDef } from '../shared/ui'
import Availability from './Availability'
import Maintainability from './Maintainability'
import TaskAnalysis from './TaskAnalysis'
import Spares from './Spares'
import ReplacementPolicy from './ReplacementPolicy'
import PMInterval from './PMInterval'
import CostForecast from './CostForecast'
import AvailabilitySensitivity from './AvailabilitySensitivity'
import VirtualAge from './VirtualAge'
import FleetForecast from './FleetForecast'
import LifetimeTools from './LifetimeTools'
import InventoryPlanning from './InventoryPlanning'
import { ReportAssetScopeProvider } from '../shared/ReportAssetScope'

/**
 * Maintenance module — task definition and resource-constrained portfolio
 * planning, availability, maintainability, spares, preventive replacement,
 * MFOP, maintenance-cost forecasting, and availability sensitivity.
 */
export default function Maintenance({
  navSub,
  onNavigatePrediction,
}: {
  navSub?: SubNav | null
  onNavigatePrediction?: (target: {
    analysisId: string
    entityId: string
  }) => void
}) {
  const tools: ToolDef[] = [
    { id: 'availability', label: 'Availability', render: () => <Availability /> },
    { id: 'maintainability', label: 'Maintainability', render: () => <Maintainability /> },
    {
      id: 'task-analysis',
      label: 'Task Analysis',
      render: () => (
        <TaskAnalysis onNavigatePrediction={onNavigatePrediction} />
      ),
    },
    { id: 'spares', label: 'Spares', render: () => <Spares /> },
    { id: 'inventory', label: 'Inventory Planning', render: () => <ReportAssetScopeProvider value={{ module: 'maintInventory', moduleLabel: 'Maintenance' }}><InventoryPlanning /></ReportAssetScopeProvider> },
    { id: 'replacement', label: 'Replacement Policy', render: () => <ReplacementPolicy /> },
    { id: 'pm-interval', label: 'PM Interval (MFOP)', render: () => <PMInterval /> },
    { id: 'cost-forecast', label: 'Cost Forecast', render: () => <CostForecast /> },
    { id: 'fleet-forecast', label: 'Fleet Forecast', render: () => <FleetForecast /> },
    { id: 'lifetime-tools', label: 'Lifetime Tools', render: () => <ReportAssetScopeProvider value={{ module: 'lifeTools', moduleLabel: 'Maintenance' }}><LifetimeTools /></ReportAssetScopeProvider> },
    { id: 'virtual-age', label: 'Virtual Age', render: () => <VirtualAge /> },
    { id: 'availability-sensitivity', label: 'Availability Sensitivity', render: () => <AvailabilitySensitivity /> },
  ]
  return (
    <div className="flex flex-col h-full">
      <Tabs tools={tools} navSub={navSub} helpTopicPrefix="maintenance" rememberKey="maintenance" />
    </div>
  )
}
