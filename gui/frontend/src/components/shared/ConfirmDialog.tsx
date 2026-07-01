import { useRef, useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  useDialogRequest, resolveDialog, useFocusTrap,
  type DialogRequest,
} from './useDialog'

/**
 * Renders the active confirm/prompt dialog from the useDialog singleton. Mount
 * once near the app root (App.tsx). Styling mirrors the original in-ProjectBar
 * "Replace project?" modal, generalized. Focus is trapped and Escape cancels.
 */
export default function DialogHost() {
  const request = useDialogRequest()
  if (!request) return null
  // key forces a fresh instance (and fresh input state) per request.
  return <DialogModal key={request.id} request={request} />
}

function DialogModal({ request }: { request: DialogRequest }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancel = () => resolveDialog(request.kind === 'confirm' ? false : null)
  useFocusTrap(panelRef, true, cancel)

  const [value, setValue] = useState(request.kind === 'prompt' ? (request.opts.defaultValue ?? '') : '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (request.kind === 'prompt') { inputRef.current?.focus(); inputRef.current?.select() }
  }, [request])

  const isDanger = request.kind === 'confirm' && request.opts.tone === 'danger'
  const confirmLabel = request.opts.confirmLabel ?? (request.kind === 'confirm' ? 'Confirm' : 'OK')
  const cancelLabel = request.kind === 'confirm' ? (request.opts.cancelLabel ?? 'Cancel') : 'Cancel'

  const submit = () => {
    if (request.kind === 'confirm') resolveDialog(true)
    else resolveDialog(value)
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30"
      onClick={cancel}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.opts.title}
        className="bg-white rounded-lg shadow-xl border border-gray-200 p-5 w-[26rem] max-w-[90vw]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {isDanger && <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-800">{request.opts.title}</h3>
            {request.kind === 'confirm' && request.opts.body && (
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{request.opts.body}</p>
            )}
            {request.kind === 'prompt' && (
              <div className="mt-2">
                {request.opts.label && (
                  <label className="text-xs text-gray-600 block mb-1">{request.opts.label}</label>
                )}
                <input
                  ref={inputRef}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
                  placeholder={request.opts.placeholder}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400"
                />
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={cancel}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={submit}
            className={`px-3 py-1.5 text-xs rounded font-medium text-white ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
