import { Sparkles } from 'lucide-react'
import { confirmDialog } from './useDialog'

/**
 * Consistent "Load example" affordance for modules that otherwise start empty.
 * On click it loads a canonical sample dataset via `onLoad`; if the module
 * already holds data (`hasData`), it first confirms the replacement. Place it in
 * the module's input-panel header, next to Import/Export controls.
 */
export default function ExampleButton({
  onLoad, hasData, label = 'Load example', title, className,
}: {
  onLoad: () => void
  hasData: boolean
  label?: string
  title?: string
  className?: string
}) {
  const handle = async () => {
    if (hasData && !(await confirmDialog({
      title: 'Load example data?',
      body: 'This replaces the current inputs in this module with a sample dataset.',
      confirmLabel: 'Load example',
    }))) return
    onLoad()
  }

  return (
    <button
      type="button"
      onClick={handle}
      title={title ?? 'Fill this module with a sample dataset'}
      aria-label={title ?? 'Load example data'}
      className={className ?? 'flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700'}
    >
      <Sparkles size={12} /> {label}
    </button>
  )
}
