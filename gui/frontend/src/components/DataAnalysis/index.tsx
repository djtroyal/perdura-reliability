import { useState } from 'react'
import Descriptive from '../Descriptive'
import DataModeling from '../DataModeling'

/**
 * Combined Data Analysis module: descriptive statistics and Regression & ML
 * over a single shared dataset (see ./shared). Switching sub-tabs keeps the
 * same data, so you can summarize, plot, then model without re-entering it.
 */
type SubTab = 'descriptive' | 'modeling'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'descriptive', label: 'Descriptive Statistics' },
  { id: 'modeling', label: 'Regression & ML' },
]

export default function DataAnalysis() {
  const [sub, setSub] = useState<SubTab>('descriptive')

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 flex gap-0">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              sub === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {sub === 'descriptive' && <Descriptive />}
        {sub === 'modeling' && <DataModeling />}
      </div>
    </div>
  )
}
