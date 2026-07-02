import { Tabs } from '../shared/ui'
import type { ToolDef } from '../shared/ui'
import Overview from './Overview'
import Therp from './Therp'
import Heart from './Heart'
import SparH from './SparH'
import Cream from './Cream'
import CreamExtended from './CreamExtended'
import Slim from './Slim'
import Atheana from './Atheana'
import Jhedi from './Jhedi'
import Sherpa from './Sherpa'
import Mermos from './Mermos'

/**
 * Human Reliability Analysis (HRA) module — human-error-probability estimation
 * with the main first- and second-generation techniques. Quantitative
 * calculators (THERP, HEART, SPAR-H, CREAM, SLIM-MAUD) plus structured
 * worksheets for the qualitative methods (ATHEANA, SHERPA, MERMOS, JHEDI),
 * and an Overview tab that compares the latest HEP across methods.
 */
const TOOLS: ToolDef[] = [
  { id: 'overview', label: 'Overview', render: () => <Overview /> },
  { id: 'therp', label: 'THERP', render: () => <Therp /> },
  { id: 'heart', label: 'HEART', render: () => <Heart /> },
  { id: 'spar-h', label: 'SPAR-H', render: () => <SparH /> },
  { id: 'cream', label: 'CREAM', render: () => <Cream /> },
  { id: 'cream-extended', label: 'CREAM Extended', render: () => <CreamExtended /> },
  { id: 'slim', label: 'SLIM-MAUD', render: () => <Slim /> },
  { id: 'atheana', label: 'ATHEANA', render: () => <Atheana /> },
  { id: 'jhedi', label: 'JHEDI', render: () => <Jhedi /> },
  { id: 'sherpa', label: 'SHERPA', render: () => <Sherpa /> },
  { id: 'mermos', label: 'MERMOS', render: () => <Mermos /> },
]

export default function HRA() {
  return (
    <div className="flex flex-col h-full">
      <Tabs tools={TOOLS} />
    </div>
  )
}
