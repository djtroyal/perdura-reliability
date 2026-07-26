/**
 * Shared Tailwind class-string constants for form controls and tables.
 * Previously copy-pasted into ~13 modules; this is the single source of truth.
 */
export const inputCls =
  'perdura-input w-full text-xs border rounded px-2 py-1.5 font-mono focus:outline-none'
export const labelCls = 'block text-xs font-medium text-gray-700 mb-1'
export const btnCls =
  'perdura-primary-button flex items-center justify-center gap-2 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors'
export const cellCls =
  'perdura-input w-24 text-xs border rounded px-2 py-1 font-mono text-center focus:outline-none'
export const disabledCellCls =
  'w-24 text-xs border border-gray-200 rounded px-2 py-1 font-mono text-center bg-gray-100 text-gray-400 cursor-not-allowed'
