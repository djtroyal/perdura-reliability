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
import { UNIT_RULES, convertStateObject } from './unitFields'

export interface ProjectState {
  projectName: string
  /** Time units the data is entered in (shown on results, plots, etc.) */
  units: string
  revision: number
  modules: Record<string, unknown>
}

export const UNIT_OPTIONS = [
  'hours', 'days', 'weeks', 'months', 'years', 'cycles', 'km', 'miles',
] as const

export const MODULE_LABELS: Record<string, string> = {
  lifeData: 'Life Data Analysis',
  alt: 'Reliability Testing',
  system: 'RBD',
  faultTree: 'Fault Tree Analysis',
  prediction: 'Failure Rate Prediction',
  pof: 'Physics of Failure',
  growth: 'Reliability Growth',
  ram: 'Availability & Spares',
  reliabilityAllocation: 'Reliability Allocation',
  warranty: 'Warranty Analysis',
  descriptive: 'Descriptive Statistics',
  hypothesis: 'Hypothesis Tests',
  regression: 'Regression Analysis',
  dataAnalysis: 'Statistical Modeling',
  dataAnalysisData: 'Statistical Modeling',
  dataModeling: 'Regression & ML',
  doe: 'Design of Experiments',
  msa: 'MSA',
  sixSigma: 'Six Sigma',
  library: 'Component/Event Library',
  reportBuilder: 'Report Builder',
}

/** Some UI modules span several store slices. Expand a module key into the
 *  concrete slice keys that hold its state (for per-module export/import). */
const MODULE_SLICE_GROUPS: Record<string, string[]> = {
  dataAnalysis: ['dataAnalysisData', 'descriptive', 'dataModeling', 'dataAnalysisFolios'],
}

export function moduleSlices(moduleKey: string): string[] {
  return MODULE_SLICE_GROUPS[moduleKey] ?? [moduleKey]
}

// ---------------------------------------------------------------------------
// localStorage persistence (survives browser refresh)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'reliability-suite-session'

function loadPersisted(): ProjectState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ProjectState>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.modules !== 'object') return null
    return {
      projectName: parsed.projectName ?? 'Untitled Project',
      units: parsed.units ?? 'hours',
      revision: 0,
      modules: (parsed.modules ?? {}) as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function persist() {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    // Persist inputs only — computed results (and their large plot arrays) are
    // stripped so the session snapshot stays small and serialization stays cheap
    // (results are recomputed on demand after a refresh, matching export/save).
    const snapshot = {
      projectName: state.projectName,
      units: state.units,
      modules: stripResults(state.modules) as Record<string, unknown>,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch { /* storage unavailable / quota exceeded; session persistence disabled */ }
  }, 400)
}

let state: ProjectState = loadPersisted() ?? {
  projectName: 'Untitled Project',
  units: 'hours',
  revision: 0,
  modules: {},
}

// ---------------------------------------------------------------------------
// Dirty (unsaved-changes) tracking
// ---------------------------------------------------------------------------

let _dirty = false
export function markDirty() { _dirty = true }
export function clearDirty() { _dirty = false; notify() }
export function isDirty() { return _dirty }

const listeners = new Set<() => void>()
// Monotonic counter bumped on every store write (any module). Unlike `revision`
// (which only changes on wholesale import/reset), this lets views react to any
// per-module mutation — e.g. the Report Builder re-enumerating assets after an
// analysis is run in another module.
let storeVersion = 0
// Bump the version and wake subscribers WITHOUT touching the dirty flag — used
// by clearDirty so the saved/unsaved indicator can update on save/open/new.
const notify = () => { storeVersion++; listeners.forEach(l => l()) }
const emit = () => { markDirty(); persist(); notify() }

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Reactive subscription to the unsaved-changes flag (for the header indicator). */
export function useIsDirty(): boolean {
  return useSyncExternalStore(subscribe, isDirty)
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

export function useUnits(): [string, (u: string) => void] {
  const units = useSyncExternalStore(subscribe, () => state.units)
  const set = useCallback((u: string) => {
    state = { ...state, units: u }
    emit()
  }, [])
  return [units, set]
}

export function useRevision(): number {
  return useSyncExternalStore(subscribe, () => state.revision)
}

/** Re-renders the caller on every store write (any module). Use to keep derived
 *  views — like the Report Builder's asset list — in sync with live module data. */
export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, () => storeVersion)
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

/** Read-only hook that returns the active folio's state for a module, unwrapping
 *  the FolioWrap if present, or the raw state otherwise. Use this for
 *  cross-module reads where the target module may or may not use folios. */
export function useModuleActiveState<T>(moduleKey: string, initial: T): T {
  const raw = useSyncExternalStore(subscribe, () => state.modules[moduleKey] as unknown)
  if (isFolioWrap(raw)) {
    const active = (raw as FolioWrap<T>).folios.find(
      f => f.id === (raw as FolioWrap<T>).activeId
    ) ?? (raw as FolioWrap<T>).folios[0]
    return active?.state ?? initial
  }
  return (raw as T | undefined) ?? initial
}

// ---------------------------------------------------------------------------
// Generic folios — multiple independent analyses per module
// ---------------------------------------------------------------------------

interface FolioEntry<T> { id: string; name: string; state: T; dirty?: boolean }
interface FolioWrap<T> { _folioWrap: true; activeId: string; folios: FolioEntry<T>[] }

/** True if `value` carries any computed result (a non-empty RESULT_FIELDS key),
 *  searching nested objects/arrays. Used to know whether stale-input warnings
 *  (the folio-tab asterisk, #11) are meaningful. */
export function hasComputedResults(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasComputedResults)
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isResultField(k)) {
        if (v != null && !(Array.isArray(v) && v.length === 0)) return true
      }
      if (hasComputedResults(v)) return true
    }
  }
  return false
}

/** Compare two folio states ignoring computed-result fields, to tell whether
 *  the *inputs* changed (so existing results would be stale). */
export function inputsChanged(prev: unknown, next: unknown): boolean {
  try {
    return JSON.stringify(stripResults(prev)) !== JSON.stringify(stripResults(next))
  } catch {
    return true
  }
}

function isFolioWrap(v: unknown): v is FolioWrap<unknown> {
  return !!v && typeof v === 'object'
    && (v as { _folioWrap?: unknown })._folioWrap === true
    && Array.isArray((v as { folios?: unknown }).folios)
}

let folioSeq = 0
const newFolioId = () => `f${Date.now().toString(36)}${(folioSeq++).toString(36)}`

export interface FoliosApi {
  folios: { id: string; name: string; dirty?: boolean }[]
  activeId: string
  add: () => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  select: (id: string) => void
}

/**
 * useState-like hook backed by the *active folio* of a module slice, plus a
 * folios API for the tab bar. A legacy raw slice is migrated into a single
 * folio on first write. Modules whose state is reactive (read straight from
 * the store) get multi-analysis support for free; canvas modules should also
 * key their re-init effect on `api.activeId`.
 */
export function useFolioState<T>(moduleKey: string, initial: T):
    [T, (v: T | ((prev: T) => T)) => void, FoliosApi] {
  const raw = useSyncExternalStore(
    subscribe, () => state.modules[moduleKey] as unknown)

  const norm: FolioWrap<T> = isFolioWrap(raw)
    ? (raw as FolioWrap<T>)
    : {
        _folioWrap: true,
        activeId: 'f0',
        folios: [{ id: 'f0', name: 'Analysis 1', state: (raw as T | undefined) ?? initial }],
      }
  const active = norm.folios.find(f => f.id === norm.activeId) ?? norm.folios[0]

  const writeWrap = (next: FolioWrap<T>) => {
    state = { ...state, modules: { ...state.modules, [moduleKey]: next } }
    emit()
  }

  const setActiveState = useCallback((v: T | ((p: T) => T)) => {
    const cur = state.modules[moduleKey] as unknown
    const w: FolioWrap<T> = isFolioWrap(cur)
      ? (cur as FolioWrap<T>)
      : { _folioWrap: true, activeId: 'f0',
          folios: [{ id: 'f0', name: 'Analysis 1', state: (cur as T | undefined) ?? initial }] }
    const act = w.folios.find(f => f.id === w.activeId) ?? w.folios[0]
    const nextState = typeof v === 'function' ? (v as (p: T) => T)(act.state) : v
    // Stale-results tracking (#11): a folio is "dirty" when it holds computed
    // results but its inputs have since changed. A write that (re)computes
    // results — inputs unchanged — clears the flag.
    const changed = inputsChanged(act.state, nextState)
    const dirty = hasComputedResults(nextState) && (changed ? true : false)
    writeWrap({ ...w, folios: w.folios.map(f => f.id === act.id ? { ...f, state: nextState, dirty } : f) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey])

  const api: FoliosApi = {
    folios: norm.folios.map(f => ({ id: f.id, name: f.name, dirty: !!f.dirty })),
    activeId: norm.activeId,
    add: () => {
      const id = newFolioId()
      const n = norm.folios.length + 1
      writeWrap({ ...norm, activeId: id, folios: [...norm.folios, { id, name: `Analysis ${n}`, state: initial }] })
    },
    rename: (id, name) =>
      writeWrap({ ...norm, folios: norm.folios.map(f => f.id === id ? { ...f, name } : f) }),
    remove: (id) => {
      // Closing the only folio is allowed: replace it with a fresh blank one
      // so at least one folio is always present.
      if (norm.folios.length <= 1) {
        const nid = newFolioId()
        writeWrap({ ...norm, activeId: nid, folios: [{ id: nid, name: 'Analysis 1', state: initial }] })
        return
      }
      const idx = norm.folios.findIndex(f => f.id === id)
      const folios = norm.folios.filter(f => f.id !== id)
      const activeId = norm.activeId === id
        ? folios[Math.max(0, idx - 1)].id
        : norm.activeId
      writeWrap({ ...norm, activeId, folios })
    },
    select: (id) => writeWrap({ ...norm, activeId: id }),
  }

  return [active.state, setActiveState, api]
}

/**
 * Write state to a *specific* folio by id (not necessarily the active one).
 * Used by canvas modules to flush a folio's pending edits to the folio they
 * belong to before switching the active folio — otherwise a debounced write
 * would either be discarded or land in the wrong (newly selected) folio. No-op
 * if the module isn't folio-wrapped yet or the folio no longer exists.
 */
export function writeFolioState<T>(moduleKey: string, folioId: string, nextState: T) {
  const cur = state.modules[moduleKey] as unknown
  if (!isFolioWrap(cur)) return
  const w = cur as FolioWrap<T>
  if (!w.folios.some(f => f.id === folioId)) return
  state = {
    ...state,
    modules: {
      ...state.modules,
      [moduleKey]: {
        ...w,
        folios: w.folios.map(f => f.id === folioId ? { ...f, state: nextState } : f),
      },
    },
  }
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
  'convertResult', 'forecastResult',
])

/** Whether a state key holds computed results (so it is stripped on export and
 *  drives the stale-results indicator). Matches the explicit set above plus any
 *  key ending in "Result"/"Results" (arResult, psResult, cmResult, …). */
function isResultField(key: string): boolean {
  return RESULT_FIELDS.has(key) || /results?$/i.test(key)
}

function stripResults(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripResults)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isResultField(k)) continue
      out[k] = stripResults(v)
    }
    return out
  }
  return value
}

/**
 * Rescale all time-valued inputs across modules when the project units change
 * (e.g. hours → days). Walks the per-module field registry, handling the three
 * container shapes (folio-wrapped modules, the lifeData folios array, and flat
 * slices). Computed results are stripped so nothing is left in stale,
 * pre-conversion units. Does NOT set the units value itself — the caller does.
 */
export function convertProjectUnits(from: string, to: string) {
  const modules = { ...state.modules }
  for (const [key, rules] of Object.entries(UNIT_RULES)) {
    const val = modules[key]
    if (val == null) continue
    const conv = (obj: unknown) => stripResults(convertStateObject(obj, rules, from, to))
    if (isFolioWrap(val)) {
      modules[key] = { ...val, folios: val.folios.map(f => ({ ...f, state: conv(f.state), dirty: false })) }
    } else if (Array.isArray((val as { folios?: unknown }).folios)) {
      // lifeData-style: row data lives directly on each folio object.
      const m = val as { folios: unknown[] }
      modules[key] = { ...m, folios: m.folios.map(f => conv(f)) }
    } else {
      modules[key] = conv(val)
    }
  }
  state = { ...state, modules }
  emit()
}

export interface ExportPayload {
  app: string
  version: number
  project: string
  units?: string
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
    units: state.units,
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
    ? moduleSlices(onlyModule).filter(k => payload.modules[k] !== undefined)
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
    units: !onlyModule && payload.units ? payload.units : state.units,
    revision: state.revision + 1,
    modules,
  }
  emit()
  // A full-project import matches the source file, so treat it as a clean
  // baseline; a module-scoped import edits the current project, so keep dirty.
  if (!onlyModule) clearDirty()
  return { applied: keys }
}

export function newProject(name = 'Untitled Project') {
  state = { projectName: name, units: 'hours', revision: state.revision + 1, modules: {} }
  emit()
  clearDirty()
}

export function clearAllModules() {
  state = { ...state, revision: state.revision + 1, modules: {} }
  emit()
}

// ---------------------------------------------------------------------------
// Named projects — save/open multiple projects in localStorage
// ---------------------------------------------------------------------------

const PROJECTS_KEY = 'reliability-suite-projects'

interface SavedProject {
  name: string
  savedAt: string
  units: string
  modules: Record<string, unknown>
}

function readProjectsMap(): Record<string, SavedProject> {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    const map = raw ? JSON.parse(raw) : {}
    return (map && typeof map === 'object') ? map as Record<string, SavedProject> : {}
  } catch {
    return {}
  }
}

function writeProjectsMap(map: Record<string, SavedProject>) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(map))
  } catch { /* storage unavailable */ }
}

/** List saved projects, most-recently-saved first. */
export function listSavedProjects(): { name: string; savedAt: string }[] {
  return Object.values(readProjectsMap())
    .map(p => ({ name: p.name, savedAt: p.savedAt }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** Save the current project under `name` (computed results are stripped to keep
 *  storage small — re-run analyses after opening). Adopts the name. */
export function saveNamedProject(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  const map = readProjectsMap()
  map[trimmed] = {
    name: trimmed,
    savedAt: new Date().toISOString(),
    units: state.units,
    modules: stripResults(state.modules) as Record<string, unknown>,
  }
  writeProjectsMap(map)
  state = { ...state, projectName: trimmed }
  emit()
  clearDirty()
}

/** Load a previously-saved project into the live store. */
export function openNamedProject(name: string): boolean {
  const p = readProjectsMap()[name]
  if (!p) return false
  state = {
    projectName: p.name,
    units: p.units ?? 'hours',
    revision: state.revision + 1,
    modules: p.modules ?? {},
  }
  emit()
  clearDirty()   // freshly loaded from a saved project → a clean baseline
  return true
}

export function deleteNamedProject(name: string) {
  const map = readProjectsMap()
  delete map[name]
  writeProjectsMap(map)
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
