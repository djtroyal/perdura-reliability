import { lazy, Suspense, useState } from 'react'
import { HelpCircle, Loader2 } from 'lucide-react'
import { HELP_MODULE_BY_ID } from '../help/modules'
import { useActiveHelpTopic } from '../help/context'

const HelpCenter = lazy(() => import('../help/HelpCenter'))

/**
 * Header help affordance: opens the searchable, context-aware Help Center for
 * the current module/analysis while preserving the user's working screen.
 */
export default function HelpButton({ activeModule }: { activeModule: string }) {
  const [open, setOpen] = useState(false)
  const contextualTopicId = useActiveHelpTopic()
  const module = HELP_MODULE_BY_ID.get(activeModule)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Help — ${module?.title ?? 'Perdura'} · ? keyboard shortcuts · Ctrl/⌘+K commands`}
        aria-label={`Open help for ${module?.title ?? 'Perdura'}`}
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <HelpCircle size={13} /> <span className="hidden xl:inline">Help</span>
      </button>

      {open && <Suspense fallback={<div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 text-white"><Loader2 size={22} className="animate-spin" /></div>}>
        <HelpCenter open={open} onClose={() => setOpen(false)} activeModule={activeModule} contextualTopicId={contextualTopicId} />
      </Suspense>}
    </>
  )
}
