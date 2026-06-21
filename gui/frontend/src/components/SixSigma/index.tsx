import { useState } from 'react'
import ProcessCapability from '../ProcessCapability'
import MSA from '../MSA'
import SPC from '../SPC'
import DOE from '../DOE'

type SubTab = 'capability' | 'msa' | 'spc' | 'doe'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'capability', label: 'Process Capability' },
  { id: 'msa', label: 'MSA (Gage R&R)' },
  { id: 'spc', label: 'SPC' },
  { id: 'doe', label: 'DOE' },
]

export default function SixSigma() {
  const [sub, setSub] = useState<SubTab>('capability')

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
        {sub === 'capability' && <ProcessCapability />}
        {sub === 'msa' && <MSA />}
        {sub === 'spc' && <SPC />}
        {sub === 'doe' && <DOE />}
      </div>
    </div>
  )
}
