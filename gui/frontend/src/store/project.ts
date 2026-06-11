/**
 * Lightweight project-wide store.
 *
 * Each module keeps its persistent state in a named slice so that:
 *  - state survives tab switches (components unmount on tab change)
 *  - projects (all modules) and single modules can be exported/imported
 *
 * `revision` increments whenever state is replaced wholesale (import /
 * new project) so components holding local mirrors (ReactFlow canvases)
 * can re-initialize.
 */
import { useSyncExternalStore, useCallback } from 'react'

export interface ProjectState {
  projectName: string
  revision: number
  modules: Record<string, unknown>
}

export const MODULE_LABELS: Record<string, string> = {
  lifeData: 'Life Data Analysis',
  alt: 'Accelerated Life Testing',
  system: 'System Reliability',
  faultTree: 'Fault Tree Analysis',
  prediction: 'Failure Rate Prediction',
  library: 'Component/Event Library',
}

let state: ProjectState = {
  projectName: 'Untitled Project',
  revision: 0,
  modules: {},
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export const getProjectState = () => state

export function useProjectName(): [string, (n: string) => void] {
  const name = useSyncExternalStore(subscribe, () => state.projectName)
  const set = useCallback((n: string) => {
    state = { ...state, projectName: n }
    emit()
  }, [])
  return [name, set]
}

export function useRevision(): number {
  return useSyncExternalStore(subscribe, () => state.revision)
}

/** useState-like hook backed by a module slice of the project store. */
export function useModuleState<T>(moduleKey: string, initial: T):
    [T, (v: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    subscribe, () => state.modules[moduleKey] as T | undefined)
  const set = useCallback((v: T | ((prev: T) => T)) => {
    const prev = (state.modules[moduleKey] as T | undefined) ?? initial
    const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
    state = { ...state, modules: { ...state.modules, [moduleKey]: next } }
    emit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey])
  return [value ?? initial, set]
}

export function setModuleState(moduleKey: string, data: unknown) {
  state = { ...state, modules: { ...state.modules, [moduleKey]: data } }
  emit()
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const FILE_TYPE = 'reliability-suite'
const FILE_VERSION = 1

/** Fields stripped from each module slice on export (computed results). */
const RESULT_FIELDS = new Set([
  'result', 'results', 'npResult', 'specResult', 'fitResult', 'compareResult',
])

function stripResults(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripResults)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (RESULT_FIELDS.has(k)) continue
      out[k] = stripResults(v)
    }
    return out
  }
  return value
}

export interface ExportPayload {
  app: string
  version: number
  project: string
  exported: string
  modules: Record<string, unknown>
}

export function buildExport(moduleKeys?: string[]): ExportPayload {
  const keys = moduleKeys ?? Object.keys(state.modules)
  const modules: Record<string, unknown> = {}
  for (const k of keys) {
    if (state.modules[k] !== undefined) modules[k] = stripResults(state.modules[k])
  }
  return {
    app: FILE_TYPE,
    version: FILE_VERSION,
    project: state.projectName,
    exported: new Date().toISOString(),
    modules,
  }
}

export function downloadExport(moduleKeys?: string[], filename?: string) {
  const payload = buildExport(moduleKeys)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const base = (payload.project || 'project').replace(/[^\w.-]+/g, '_')
  a.href = url
  a.download = filename ?? (moduleKeys && moduleKeys.length === 1
    ? `${base}_${moduleKeys[0]}.json`
    : `${base}.json`)
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Import a payload. If `onlyModule` is given, only that module's slice is
 * applied; otherwise every module present in the file is applied and (for
 * full-project files) the project name is adopted.
 */
export function importPayload(payload: ExportPayload, onlyModule?: string):
    { applied: string[] } {
  if (!payload || payload.app !== FILE_TYPE || !payload.modules) {
    throw new Error('Not a valid reliability-suite export file.')
  }
  const keys = onlyModule
    ? (payload.modules[onlyModule] !== undefined ? [onlyModule] : [])
    : Object.keys(payload.modules)
  if (keys.length === 0) {
    throw new Error(onlyModule
      ? `File contains no data for module '${MODULE_LABELS[onlyModule] ?? onlyModule}'.`
      : 'File contains no module data.')
  }
  const modules = { ...state.modules }
  for (const k of keys) modules[k] = payload.modules[k]
  state = {
    projectName: !onlyModule && payload.project ? payload.project : state.projectName,
    revision: state.revision + 1,
    modules,
  }
  emit()
  return { applied: keys }
}

export function newProject(name = 'Untitled Project') {
  state = { projectName: name, revision: state.revision + 1, modules: {} }
  emit()
}

export function readJSONFile(file: File): Promise<ExportPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as ExportPayload)
      } catch {
        reject(new Error('File is not valid JSON.'))
      }
    }
    reader.onerror = () => reject(new Error('Could not read file.'))
    reader.readAsText(file)
  })
}
