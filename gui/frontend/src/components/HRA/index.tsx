import { useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Tabs } from '../shared/ui'
import { SubNav } from '../shared/useSubNav'
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
import HRAWizard from './Wizard'

/**
 * Human Reliability Analysis (HRA) module — human-error-probability estimation
 * with implemented quantitative methods plus explicitly labeled screening
 * worksheets. The Overview tab compares their latest numeric outputs while
 * preserving the distinction between method results and screening heuristics.
 */
const TOOLS: ToolDef[] = [
  { id: 'overview', label: 'Overview', render: () => <Overview /> },
  { id: 'therp', label: 'THERP', render: () => <Therp /> },
  { id: 'heart', label: 'HEART', render: () => <Heart /> },
  { id: 'spar-h', label: 'SPAR-H', render: () => <SparH /> },
  { id: 'cream', label: 'CREAM', render: () => <Cream /> },
  { id: 'cream-extended', label: 'CREAM Extended', render: () => <CreamExtended /> },
  { id: 'slim', label: 'SLIM-MAUD', render: () => <Slim /> },
  { id: 'atheana', label: 'EFC Elicitation', render: () => <Atheana /> },
  { id: 'jhedi', label: 'Category Screen', render: () => <Jhedi /> },
  { id: 'sherpa', label: 'Error-Mode Screen', render: () => <Sherpa /> },
  { id: 'mermos', label: 'Mission Scenarios', render: () => <Mermos /> },
]

export default function HRA({ navSub }: { navSub?: SubNav | null }) {
  const [wizardOpen, setWizardOpen] = useState(false)
  // Local nav target (from the method wizard) takes precedence over the
  // undo/redo navigation prop; both drive the same Tabs navSub mechanism.
  const [localNav, setLocalNav] = useState<SubNav | null>(null)

  return (
    <div className="flex flex-col h-full relative">
      <button
        onClick={() => setWizardOpen(true)}
        title="Answer a few questions and get the appropriate HRA method"
        className="absolute top-1 right-3 z-10 flex items-center gap-1.5 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded px-2.5 py-1 transition-colors"
      >
        <Wand2 size={12} /> Method wizard
      </button>
      <HRAWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onApply={sub => {
          // Offset so local nonces never collide with undo-nav nonces in Tabs' de-dupe.
          setLocalNav(prev => ({ sub, nonce: (prev?.nonce ?? 1_000_000_000) + 1 }))
          setWizardOpen(false)
        }}
      />
      <Tabs tools={TOOLS} navSub={localNav ?? navSub} />
    </div>
  )
}
