import { useRef, useState, useEffect } from 'react'
import { FolderPlus, FolderOpen, Save, Upload, Download, ChevronDown, Trash2, AlertTriangle, Undo2, Redo2 } from 'lucide-react'
import {
  useProjectName, useUnits, downloadExport, importPayload, newProject,
  readJSONFile, MODULE_LABELS, UNIT_OPTIONS, moduleSlices,
  listSavedProjects, saveNamedProject, openNamedProject, deleteNamedProject,
  listRecentProjects,
  getProjectState, convertProjectUnits, projectExists,
  undo, redo, useCanUndoRedo, openDemoProject, DEMO_PROJECT_NAME,
} from '../../store/project'
import { sameGroup } from '../../store/units'
import { toast } from './toast'
import { confirmDialog, promptDialog, useFocusTrap } from './useDialog'
import { saveProjectFlow } from './projectActions'
import { formatProjectTimestamp } from './projectMetadata'

/** A queued action that will replace the current project once the user
 *  confirms how to handle unsaved work. */
type PendingOverwrite =
  | { kind: 'open'; name: string }
  | { kind: 'import'; file: File }
  | { kind: 'demo' }

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
  const canUndoRedo = useCanUndoRedo()
  const [menu, setMenu] = useState<'export' | 'import' | 'open' | null>(null)
  const [saved, setSaved] = useState<{ name: string; savedAt: string }[]>([])
  const [recent, setRecent] = useState<{ name: string; savedAt: string; openedAt: string }[]>([])
  const [pending, setPending] = useState<PendingOverwrite | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importScope = useRef<'module' | 'all'>('all')
  const wrapRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<HTMLDivElement>(null)
  useFocusTrap(pendingRef, pending != null, () => setPending(null))

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(null)
    }
    // Escape closes any open dropdown menu.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const moduleLabel = MODULE_LABELS[activeModule] ?? activeModule
  const sanitize = (s: string) => (s || 'project').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'project'
  const exportBase = sanitize(projectName)

  const handleExportZip = async () => {
    setMenu(null)
    setZipBusy(true)
    toast.info('Packaging project assets — rendering plots…')
    try {
      const { exportProjectZip } = await import('../../store/exportZip')
      const res = await exportProjectZip()
      if (res.files <= 1) toast.info('No computed assets yet — run some analyses first.')
      else toast.success(`Exported ${res.files} files${res.skipped ? ` (${res.skipped} skipped)` : ''}.`)
    } catch {
      toast.error('Failed to export assets.')
    } finally {
      setZipBusy(false)
    }
  }

  const handleNew = async () => {
    if (await confirmDialog({
      title: 'Start a new project?',
      body: 'Unsaved data in all modules will be cleared.',
      confirmLabel: 'New project',
      tone: 'danger',
    })) {
      newProject()
      toast.info('Started a new project.')
    }
  }

  /** Switch units. For compatible units (e.g. hours↔days) offer to rescale the
   *  existing time-valued inputs; otherwise just relabel. */
  const handleUnitsChange = async (next: string) => {
    if (next === units) return
    const hasData = Object.keys(getProjectState().modules).length > 0
    if (sameGroup(units, next) && hasData &&
        await confirmDialog({
          title: `Convert existing values from ${units} to ${next}?`,
          body: 'Time-valued inputs (failure times, MTBF, mission time, rates, …) will be '
            + 'rescaled and computed results cleared for re-running. Choose Cancel to only '
            + 'change the label.',
          confirmLabel: 'Convert values',
        })) {
      convertProjectUnits(units, next)
      toast.success(`Converted values to ${next}.`)
    }
    setUnits(next)
  }

  const handleSave = saveProjectFlow

  const openMenu = () => {
    setSaved(listSavedProjects())
    setRecent(listRecentProjects())
    setMenu(menu === 'open' ? null : 'open')
  }

  /** Does the current project hold any data worth warning about losing? */
  const projectHasContent = () => Object.keys(getProjectState().modules).length > 0

  const doOpen = (name: string) => {
    if (openNamedProject(name)) toast.success(`Opened "${name}".`)
  }

  const handleOpen = (name: string) => {
    setMenu(null)
    if (projectHasContent()) setPending({ kind: 'open', name })
    else doOpen(name)
  }

  const doOpenDemo = async () => {
    if (await openDemoProject()) toast.success(`Opened "${DEMO_PROJECT_NAME}".`)
    else toast.error('Could not load the demo project.')
  }

  const handleOpenDemo = () => {
    setMenu(null)
    if (projectHasContent()) setPending({ kind: 'demo' })
    else void doOpenDemo()
  }

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    if (await confirmDialog({
      title: `Delete saved project "${name}"?`,
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })) {
      deleteNamedProject(name)
      setSaved(listSavedProjects())
      setRecent(listRecentProjects())
      toast.info(`Deleted "${name}".`)
    }
  }

  const pickImport = (scope: 'module' | 'all') => {
    importScope.current = scope
    setMenu(null)
    fileRef.current?.click()
  }

  const doImport = async (file: File, scope: 'module' | 'all') => {
    try {
      const payload = await readJSONFile(file)
      const { applied } = importPayload(payload, scope === 'module' ? activeModule : undefined)
      if (applied.length === 0) {
        toast.info('Nothing to import — the file had no matching module data.')
      } else {
        toast.success(`Imported: ${applied.map(k => MODULE_LABELS[k] ?? k).join(', ')}`)
      }
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`)
    }
  }

  const handleImportFile = async (file: File) => {
    // A full-project import replaces everything — warn first if there's work to
    // lose. A module-scoped import overwrites the active module's data, so
    // confirm before replacing it.
    if (importScope.current === 'all' && projectHasContent()) {
      setPending({ kind: 'import', file })
      return
    }
    if (importScope.current === 'module') {
      const label = MODULE_LABELS[activeModule] ?? activeModule
      const ok = await confirmDialog({
        title: 'Replace module data?',
        body: `Importing will replace the current ${label} data with the file's contents. Continue?`,
        confirmLabel: 'Import',
        tone: 'danger',
      })
      if (!ok) return
    }
    await doImport(file, importScope.current)
  }

  // --- overwrite confirmation (open / full import) ---
  const runPending = async () => {
    const p = pending
    setPending(null)
    if (!p) return
    if (p.kind === 'open') doOpen(p.name)
    else if (p.kind === 'demo') await doOpenDemo()
    else await doImport(p.file, 'all')
  }

  const saveThenContinue = async () => {
    const name = await promptDialog({
      title: 'Save current project',
      label: 'Save current project as:',
      defaultValue: projectName || 'Untitled Project',
      confirmLabel: 'Save',
    })
    const trimmed = name?.trim()
    if (!trimmed) return // cancel the whole flow; nothing lost
    if (projectExists(trimmed) && trimmed !== projectName) {
      const ok = await confirmDialog({
        title: 'Overwrite project?',
        body: `A project named "${trimmed}" already exists in this browser. Overwrite it?`,
        confirmLabel: 'Overwrite',
        tone: 'danger',
      })
      if (!ok) return
    }
    if (!saveNamedProject(trimmed)) return // save failed → don't discard current work
    toast.success(`Saved "${trimmed}".`)
    runPending()
  }

  const pendingLabel = pending == null ? ''
    : pending.kind === 'open' ? `Opening "${pending.name}"`
    : pending.kind === 'demo' ? `Opening "${DEMO_PROJECT_NAME}"`
    : `Importing "${pending.file.name}"`

  return (
    <div ref={wrapRef} className="ml-auto flex items-center gap-1.5 xl:gap-2 relative flex-shrink-0">
      {/* Undo / redo (project-wide, one step per field change) */}
      <div className="flex items-center">
        <button onClick={() => undo()} disabled={!canUndoRedo.undo}
          title="Undo (Ctrl/Cmd-Z)" aria-label="Undo"
          className="flex items-center text-xs text-gray-600 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-default border border-gray-200 rounded-l px-2 py-1.5 border-r-0">
          <Undo2 size={13} />
        </button>
        <button onClick={() => redo()} disabled={!canUndoRedo.redo}
          title="Redo (Ctrl/Cmd-Shift-Z)" aria-label="Redo"
          className="flex items-center text-xs text-gray-600 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-default border border-gray-200 rounded-r px-2 py-1.5">
          <Redo2 size={13} />
        </button>
      </div>

      <select
        value={units}
        onChange={e => handleUnitsChange(e.target.value)}
        title="Units for all data in this project. Switching between compatible units (e.g. hours/days) offers to convert existing values."
        className="text-xs border border-gray-200 rounded px-1.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>

      <button onClick={handleSave} title="Save project to this browser" aria-label="Save project to this browser"
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <Save size={13} /> <span className="hidden xl:inline">Save</span>
      </button>

      {/* Open (from browser storage) */}
      <div className="relative">
        <button onClick={openMenu} title="Open a saved project from this browser"
          aria-label="Open a saved project" aria-haspopup="menu" aria-expanded={menu === 'open'}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
          <FolderOpen size={13} /> <span className="hidden xl:inline">Open</span> <ChevronDown size={11} />
        </button>
        {menu === 'open' && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 w-72 py-1 max-h-96 overflow-y-auto">
            {recent.length > 0 && (
              <>
                <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Recent</p>
                {recent.map(project => (
                  <div key={`recent-${project.name}`}
                    onClick={() => handleOpen(project.name)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <span className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{project.name}</span>
                      <span className="text-[10px] text-gray-400">
                        Last modified {formatProjectTimestamp(project.savedAt)}
                      </span>
                      <span className="text-[9px] text-gray-300">
                        Last opened {formatProjectTimestamp(project.openedAt)}
                      </span>
                    </span>
                  </div>
                ))}
                <div className="my-1 border-t border-gray-100" />
              </>
            )}
            {/* Bundled sample — always available */}
            <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Examples</p>
            <div onClick={handleOpenDemo}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
              <span className="flex flex-col min-w-0">
                <span className="font-medium truncate">{DEMO_PROJECT_NAME}</span>
                <span className="text-[10px] text-gray-400">Sample data across every module</span>
              </span>
            </div>
            <div className="my-1 border-t border-gray-100" />
            <p className="px-3 pt-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Saved projects</p>
            {saved.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">No saved projects yet. Use “Save” to store one.</p>
            ) : (
              saved.map(p => (
                <div key={p.name}
                  onClick={() => handleOpen(p.name)}
                  className="group flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <span className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{p.name}</span>
                    <span className="text-[10px] text-gray-400">
                      Last modified {formatProjectTimestamp(p.savedAt)}
                    </span>
                  </span>
                  <button onClick={e => handleDelete(e, p.name)}
                    title="Delete saved project" aria-label={`Delete saved project ${p.name}`}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <button onClick={handleNew} title="New project" aria-label="Start a new project"
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
        <FolderPlus size={13} /> <span className="hidden xl:inline">New</span>
      </button>

      {/* Import */}
      <div className="relative">
        <button onClick={() => setMenu(menu === 'import' ? null : 'import')}
          title="Import data from a file" aria-label="Import data from a file"
          aria-haspopup="menu" aria-expanded={menu === 'import'}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
          <Upload size={13} /> <span className="hidden xl:inline">Import</span> <ChevronDown size={11} />
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
          title="Export data to a file" aria-label="Export data to a file"
          aria-haspopup="menu" aria-expanded={menu === 'export'}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 px-2 py-1.5 rounded">
          <Download size={13} /> <span className="hidden xl:inline">Export</span> <ChevronDown size={11} />
        </button>
        {menu === 'export' && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 w-64 py-1">
            <button onClick={() => {
              downloadExport(moduleSlices(activeModule), `${exportBase}_${sanitize(moduleLabel)}.json`)
              setMenu(null)
            }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              <span className="font-medium">{moduleLabel}</span> only
            </button>
            <div className="my-1 border-t border-gray-100" />
            <button onClick={() => { downloadExport(undefined, `${exportBase}.json`, false); setMenu(null) }}
              title="Smallest file — analyses recompute when the project is re-opened"
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              Entire project — <span className="font-medium">inputs only</span>
              <span className="block text-[10px] text-gray-400">results recompute on open</span>
            </button>
            <button onClick={() => { downloadExport(undefined, `${exportBase}_full.json`, true); setMenu(null) }}
              title="Complete snapshot including computed results and plots (larger file)"
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              Entire project — <span className="font-medium">with results</span>
              <span className="block text-[10px] text-gray-400">full snapshot, larger file</span>
            </button>
            <div className="my-1 border-t border-gray-100" />
            <button onClick={handleExportZip} disabled={zipBusy}
              title="Every plot (PNG, SVG, interactive HTML) and table (CSV), foldered by module, plus a re-importable project.json"
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              All assets — <span className="font-medium">.zip</span>
              <span className="block text-[10px] text-gray-400">plots (PNG/SVG/HTML) + tables (CSV) by module</span>
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

      {/* Overwrite confirmation — protects unsaved work when opening/importing */}
      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          onClick={() => setPending(null)}>
          <div ref={pendingRef} role="dialog" aria-modal="true" aria-label="Replace current project?"
            className="bg-white rounded-lg shadow-xl border border-gray-200 p-5 w-[26rem] max-w-[90vw]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-800">Replace current project?</h3>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                  {pendingLabel} will replace your current project
                  {projectName ? <> (<span className="font-medium">{projectName}</span>)</> : ''}.
                  Any unsaved changes will be lost. Save the current project first?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPending(null)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => runPending()}
                className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50">
                Discard &amp; continue
              </button>
              <button onClick={saveThenContinue}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium">
                Save &amp; continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
