import { useRef, useState, useEffect } from 'react'
import { FolderPlus, Upload, Download, ChevronDown, Trash2 } from 'lucide-react'
import {
  useProjectName, useUnits, downloadExport, importPayload, newProject,
  clearAllModules, readJSONFile, MODULE_LABELS, UNIT_OPTIONS, moduleSlices,
} from '../../store/project'

interface Props {
  /** store key of the currently active module (e.g. 'lifeData') */
  activeModule: string
}

/**
 * Project name + new/import/export controls shown in the app header.
 * Export and import both offer "current module only" or "entire project".
 */
export default function ProjectBar({ activeModule }: Props) {
  const [projectName, setProjectName] = useProjectName()
  const [units, setUnits] = useUnits()
  const [menu, setMenu] = useState<'export' | 'import' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importScope = useRef<'module' | 'all'>('all')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const moduleLabel = MODULE_LABELS[activeModule] ?? activeModule

  const handleNew = () => {
    if (window.confirm('Start a new project? Unsaved data in all modules will be cleared.')) {
      newProject()
    }
  }

  const handleClearAll = () => {
    if (window.confirm('Clear ALL data across every module and analysis? This cannot be undone.')) {
      clearAllModules()
      setNotice('All module data cleared.')
    }
  }

  const pickImport = (scope: 'module' | 'all') => {
    importScope.current = scope
    setMenu(null)
    fileRef.current?.click()
  }

  const handleImportFile = async (file: File) => {
    try {
      const payload = await readJSONFile(file)
      const { applied } = importPayload(
        payload, importScope.current === 'module' ? activeModule : undefined)
      setNotice(`Imported: ${applied.map(k => MODULE_LABELS[k] ?? k).join(', ')}`)
    } catch (e) {
      setNotice(`Import failed: ${(e as Error).message}`)
    }
  }

  return (
    <div ref={wrapRef} className="ml-auto flex items-center gap-2 relative">
      {notice && (
        <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-1 rounded max-w-72 truncate">
          {notice}
        </span>
      )}
      <input
        value={projectName}
        onChange={e => setProjectName(e.target.value)}
        title="Project name"
        className="text-xs border border-gray-200 rounded px-2 py-1.5 w-40 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <select
        value={units}
        onChange={e => setUnits(e.target.value)}
        title="Time units for all data in this project"
        className="text-xs border border-gray-200 rounded px-1.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
      <button onClick={handleNew} title="New project"
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <FolderPlus size={13} /> New
      </button>
      <button onClick={handleClearAll} title="Clear all data across every module"
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-red-600 border border-gray-200 px-2 py-1.5 rounded">
        <Trash2 size={13} /> Clear All
      </button>

      {/* Import */}
      <div className="relative">
        <button onClick={() => setMenu(menu === 'import' ? null : 'import')}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
          <Upload size={13} /> Import <ChevronDown size={11} />
        </button>
        {menu === 'import' && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 w-56 py-1">
            <button onClick={() => pickImport('module')}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              Into <span className="font-medium">{moduleLabel}</span> only
            </button>
            <button onClick={() => pickImport('all')}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              Everything in file (project)
            </button>
          </div>
        )}
      </div>

      {/* Export */}
      <div className="relative">
        <button onClick={() => setMenu(menu === 'export' ? null : 'export')}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
          <Download size={13} /> Export <ChevronDown size={11} />
        </button>
        {menu === 'export' && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 w-56 py-1">
            <button onClick={() => { downloadExport(moduleSlices(activeModule)); setMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              <span className="font-medium">{moduleLabel}</span> only
            </button>
            <button onClick={() => { downloadExport(); setMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              Entire project (all modules)
            </button>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleImportFile(f)
          e.target.value = ''
        }} />
    </div>
  )
}
