import { useState, useRef } from 'react'
import { HelpCircle, X } from 'lucide-react'
import { HELP_CONTENT, HelpItem } from './helpContent'
import { useFocusTrap } from './useDialog'

/**
 * Header help affordance: a "?" button that opens a slide-over drawer with the
 * companion user manual for the currently-active module. Keyed by module store
 * key, so a single instance in the app header documents every module.
 */
export default function HelpButton({ activeModule }: { activeModule: string }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, open, () => setOpen(false))
  const help = HELP_CONTENT[activeModule]
  if (!help) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Help — ${help.title}`}
        aria-label={`Open help for ${help.title}`}
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <HelpCircle size={13} /> <span className="hidden xl:inline">Help</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`Help — ${help.title}`}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div ref={panelRef} className="relative bg-white w-full max-w-md h-full shadow-xl overflow-y-auto flex flex-col">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">User Manual</p>
                <h2 className="text-base font-semibold text-gray-900">{help.title}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700" title="Close" aria-label="Close help">
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

              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1.5">Interactive plots</h3>
                <ul className="flex flex-col gap-1.5">
                  {[
                    'Use the mouse wheel to zoom, select Pan in the regular plot toolbar to move the view, and double-click to restore it. Legends can be dragged; click a legend item to toggle it or double-click to isolate it.',
                    'Open Annotate to add text callouts, axis projections, lines, rectangles, or circles. Axis projection adds x/y guide lines and values from a selected data line or point. Notes can be dragged and clicked again to edit or delete them; Erase shape removes drawn shapes.',
                    'Plot markup is saved with the project and included in PNG, SVG, HTML, ZIP, Report Builder, and PDF output. A successful recalculation clears source-plot markup because its data coordinates may no longer be valid.',
                    'Compact plots keep their toolbar hidden. Use Full screen to access zoom, export, and annotation controls without crowding the analysis view.',
                  ].map((item, index) => (
                    <li key={index} className="text-gray-600 leading-snug">
                      {renderItem(item)}
                    </li>
                  ))}
                </ul>
              </div>

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
