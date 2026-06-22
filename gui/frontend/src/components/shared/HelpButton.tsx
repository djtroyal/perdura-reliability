import { useState } from 'react'
import { HelpCircle, X } from 'lucide-react'
import { HELP_CONTENT, HelpItem } from './helpContent'

/**
 * Header help affordance: a "?" button that opens a slide-over drawer with the
 * companion user manual for the currently-active module. Keyed by module store
 * key, so a single instance in the app header documents every module.
 */
export default function HelpButton({ activeModule }: { activeModule: string }) {
  const [open, setOpen] = useState(false)
  const help = HELP_CONTENT[activeModule]
  if (!help) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Help — ${help.title}`}
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <HelpCircle size={13} /> Help
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative bg-white w-full max-w-md h-full shadow-xl overflow-y-auto flex flex-col">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">User Manual</p>
                <h2 className="text-base font-semibold text-gray-900">{help.title}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700" title="Close">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-5 text-sm">
              <p className="text-gray-600 leading-relaxed">{help.overview}</p>

              {help.sections.map(section => (
                <div key={section.heading}>
                  <h3 className="text-sm font-semibold text-gray-800 mb-1.5">{section.heading}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {section.items.map((item, i) => (
                      <li key={i} className="text-gray-600 leading-snug">
                        {renderItem(item)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-3">
                Perdura — Reliability Engineering and Statistics Suite. This guide summarizes typical use; consult the
                referenced standards/methods for authoritative definitions.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function renderItem(item: HelpItem) {
  if (typeof item === 'string') {
    return <span className="flex gap-1.5"><span className="text-gray-300">•</span><span>{item}</span></span>
  }
  return (
    <span className="flex gap-1.5">
      <span className="text-gray-300">•</span>
      <span><span className="font-medium text-gray-800">{item.term}</span> — {item.def}</span>
    </span>
  )
}
