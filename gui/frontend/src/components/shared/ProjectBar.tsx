import { useRef, useState, useEffect } from 'react'
import { FolderPlus, FolderOpen, Save, Upload, Download, ChevronDown, Trash2 } from 'lucide-react'
import {
  useProjectName, useUnits, downloadExport, importPayload, newProject,
  readJSONFile, MODULE_LABELS, UNIT_OPTIONS, moduleSlices,
  listSavedProjects, saveNamedProject, openNamedProject, deleteNamedProject,
} from '../../store/project'

interface Props {
  /** store key of the currently active module (e.g. 'lifeData') */
  activeModule: string
}

/**
 * Project controls shown in the app header: save/open (browser local storage),
 * new, import/export (files), and the time-unit selector. The project *name*
 * input lives separately in the header (see App.tsx).
 */
export default function ProjectBar({ activeModule }: Props) {
  const [projectName] = useProjectName()
  const [units, setUnits] = useUnits()
  const [menu, setMenu] = useState<'export' | 'import' | 'open' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ name: string; savedAt: string }[]>([])
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
  const sanitize = (s: string) => (s || 'project').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'project'
  const exportBase = sanitize(projectName)

  const handleNew = () => {
    if (window.confirm('Start a new project? Unsaved data in all modules will be cleared.')) {
      newProject()
    }
  }

  const handleSave = () => {
    const name = window.prompt('Save project as:', projectName || 'Untitled Project')
    if (name && name.trim()) {
      saveNamedProject(name.trim())
      setNotice(`Saved "${name.trim()}" to this browser.`)
    }
  }

  const openMenu = () => {
    setSaved(listSavedProjects())
    setMenu(menu === 'open' ? null : 'open')
  }

  const handleOpen = (name: string) => {
    if (openNamedProject(name)) setNotice(`Opened "${name}".`)
    setMenu(null)
  }

  const handleDelete = (e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    if (window.confirm(`Delete saved project "${name}"? This cannot be undone.`)) {
      deleteNamedProject(name)
      setSaved(listSavedProjects())
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
      <select
        value={units}
        onChange={e => setUnits(e.target.value)}
        title="Time units for all data in this project"
        className="text-xs border border-gray-200 rounded px-1.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>

      <button onClick={handleSave} title="Save project to this browser"
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <Save size={13} /> Save
      </button>

      {/* Open (from browser storage) */}
      <div className="relative">
        <button onClick={openMenu} title="Open a saved project from this browser"
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
          <FolderOpen size={13} /> Open <ChevronDown size={11} />
        </button>
        {menu === 'open' && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 w-64 py-1 max-h-80 overflow-y-auto">
            {saved.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">No saved projects yet. Use “Save” to store one.</p>
            ) : (
              saved.map(p => (
                <div key={p.name}
                  onClick={() => handleOpen(p.name)}
                  className="group flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <span className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{p.name}</span>
                    <span className="text-[10px] text-gray-400">{new Date(p.savedAt).toLocaleString()}</span>
                  </span>
                  <button onClick={e => handleDelete(e, p.name)}
                    title="Delete saved project"
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <button onClick={handleNew} title="New project"
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <FolderPlus size={13} /> New
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
            <button onClick={() => {
              downloadExport(moduleSlices(activeModule), `${exportBase}_${sanitize(moduleLabel)}.json`)
              setMenu(null)
            }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              <span className="font-medium">{moduleLabel}</span> only
            </button>
            <button onClick={() => { downloadExport(undefined, `${exportBase}.json`); setMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              Entire project{projectName ? ` — "${projectName}"` : ''}
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
