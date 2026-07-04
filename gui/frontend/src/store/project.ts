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
import { toast } from '../components/shared/toast'

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
  maintenance: 'Maintenance',
  hra: 'Human Reliability Analysis',
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
  maintenance: ['ram', 'maintReplacement', 'maintPMInterval', 'maintCostForecast', 'maintAvailability'],
  hra: ['hraTherp', 'hraHeart', 'hraSparH', 'hraCream', 'hraCreamExt', 'hraSlim', 'hraJhedi', 'hraSherpa', 'hraAtheana', 'hraMermos'],
}

export function moduleSlices(moduleKey: string): string[] {
  return MODULE_SLICE_GROUPS[moduleKey] ?? [moduleKey]
}

// ---------------------------------------------------------------------------
// localStorage persistence (survives browser refresh)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'reliability-suite-session'
// A mirror of the last successfully-written session, so a corrupt/unreadable
// primary key (external tampering, another tab, a browser hiccup) can be
// recovered instead of silently falling back to an empty project.
const SESSION_BACKUP_KEY = 'reliability-suite-session-backup'

// A one-shot notice, set during startup load (before the toast viewport exists)
// and shown by App once it mounts.
let startupNotice: string | null = null
export function consumeStartupNotice(): string | null {
  const n = startupNotice
  startupNotice = null
  return n
}

// Debounced "couldn't save" warning so a full/blocked localStorage surfaces
// instead of silently dropping the user's work.
let lastSaveErrorAt = 0
function notifySaveError() {
  // eslint-disable-next-line no-console
  console.warn('Perdura: failed to write to localStorage — storage may be full or blocked.')
  const now = Date.now()
  if (now - lastSaveErrorAt > 30000) {
    lastSaveErrorAt = now
    toast.error("Couldn't save to this browser — storage may be full. Export your project (Export → Entire project) to avoid losing work.")
  }
}

function parseSession(raw: string | null): ProjectState | null {
  if (!raw) return null
  try {
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

function loadPersisted(): ProjectState | null {
  let raw: string | null = null
  try { raw = localStorage.getItem(STORAGE_KEY) } catch { return null }
  if (!raw) return null   // fresh install — nothing saved yet
  const primary = parseSession(raw)
  if (primary) return primary
  // Primary present but unreadable → recover from the backup mirror.
  let backupRaw: string | null = null
  try { backupRaw = localStorage.getItem(SESSION_BACKUP_KEY) } catch { backupRaw = null }
  const backup = parseSession(backupRaw)
  if (backup) {
    startupNotice = 'Your saved session was unreadable — recovered from a backup copy.'
    return backup
  }
  // Both unreadable: tell the user rather than silently starting empty.
  startupNotice = 'Your saved session could not be read; starting a new project. If you have an exported .json backup, use Import to restore it.'
  return null
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
      const str = JSON.stringify(snapshot)
      localStorage.setItem(STORAGE_KEY, str)
      // Best-effort mirror; failure here doesn't matter (primary already wrote).
      try { localStorage.setItem(SESSION_BACKUP_KEY, str) } catch { /* backup optional */ }
    } catch {
      notifySaveError()
    }
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
const emit = () => {
  markDirty()
  redoStack = []            // any fresh edit invalidates the redo branch
  persist()
  scheduleHistoryCommit()   // coalesce bursts into single undo steps
  scheduleAutoSave()        // keep the open named project up to date
  notify()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// ---------------------------------------------------------------------------
// Undo / redo history (in-memory, coalesced, project-global)
// ---------------------------------------------------------------------------
// The store replaces `state` wholesale per edit and unchanged module slices are
// shared by reference, so full-state snapshots are cheap. Rapid edits are
// grouped into one step via a debounced commit.

const HISTORY_LIMIT = 25
let undoStack: ProjectState[] = []
let redoStack: ProjectState[] = []
let committed: ProjectState = state  // last snapshot on the history baseline
let historyTimer: ReturnType<typeof setTimeout> | undefined

function commitHistory() {
  historyTimer = undefined
  if (committed === state) return
  undoStack.push(committed)
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  committed = state
  notify()   // enable the Undo button once a step is committed
}

function scheduleHistoryCommit() {
  if (historyTimer !== undefined) clearTimeout(historyTimer)
  historyTimer = setTimeout(commitHistory, 700)
}

function flushHistory() {
  if (historyTimer !== undefined) { clearTimeout(historyTimer); historyTimer = undefined }
  commitHistory()
}

function clearHistory() {
  undoStack = []
  redoStack = []
  if (historyTimer !== undefined) { clearTimeout(historyTimer); historyTimer = undefined }
  committed = state
}

function applySnapshot(snap: ProjectState) {
  // New revision so the ReactFlow canvases (RBD/FTA) re-init from the store.
  state = { projectName: snap.projectName, units: snap.units, modules: snap.modules, revision: state.revision + 1 }
  committed = state
  markDirty()
  persist()
  scheduleAutoSave()
  notify()
}

export function canUndo(): boolean { return undoStack.length > 0 || committed !== state }
export function canRedo(): boolean { return redoStack.length > 0 }

export function undo() {
  flushHistory()                 // commit any pending burst first
  const target = undoStack.pop()
  if (!target) return
  redoStack.push(committed)      // committed === current state here
  applySnapshot(target)
}

export function redo() {
  flushHistory()
  const target = redoStack.pop()
  if (!target) return
  undoStack.push(committed)
  applySnapshot(target)
}

/** Reactive undo/redo availability (for toolbar buttons). Returns a stable
 *  primitive so useSyncExternalStore doesn't loop. */
export function useCanUndoRedo(): { undo: boolean; redo: boolean } {
  const s = useSyncExternalStore(subscribe, () => `${canUndo() ? 1 : 0}${canRedo() ? 1 : 0}`)
  return { undo: s[0] === '1', redo: s[1] === '1' }
}

// ---------------------------------------------------------------------------
// Auto-save the open named project (once it has been saved/opened at least once)
// ---------------------------------------------------------------------------

let autoSaveTimer: ReturnType<typeof setTimeout> | undefined

function runAutoSave() {
  if (!isDirty()) return
  const name = state.projectName?.trim()
  if (!name) return
  // Only re-save projects that already exist — never auto-create clutter entries
  // for untitled/never-saved work (the session autosave already protects those).
  if (!Object.prototype.hasOwnProperty.call(readProjectsMap(), name)) return
  writeCurrentProject(name)
}

function scheduleAutoSave() {
  if (autoSaveTimer !== undefined) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(runAutoSave, 1500)
}

// Periodic safety net in case rapid edits keep resetting the debounce.
if (typeof window !== 'undefined') setInterval(runAutoSave, 20000)

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

// Cache of the stripped-and-serialized "input signature" per state object.
// States are immutable (replaced wholesale on write), so a WeakMap keyed on
// the object is safe — and it turns the per-keystroke staleness check from
// two full stripResults+stringify passes into one (the previous state's
// signature was cached when it was written).
const inputSigCache = new WeakMap<object, string>()

function inputSignature(v: unknown): string {
  const cacheable = typeof v === 'object' && v !== null
  if (cacheable) {
    const hit = inputSigCache.get(v as object)
    if (hit !== undefined) return hit
  }
  const sig = JSON.stringify(stripResults(v)) ?? ''
  if (cacheable) inputSigCache.set(v as object, sig)
  return sig
}

/** Compare two folio states ignoring computed-result fields, to tell whether
 *  the *inputs* changed (so existing results would be stale). */
export function inputsChanged(prev: unknown, next: unknown): boolean {
  try {
    return inputSignature(prev) !== inputSignature(next)
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
    // results — inputs unchanged — clears the flag. hasComputedResults is
    // checked first (cheap, early-exits) so pure data entry before any run
    // never pays for the signature comparison.
    const dirty = hasComputedResults(nextState) && inputsChanged(act.state, nextState)
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

export function buildExport(moduleKeys?: string[], includeResults = false): ExportPayload {
  const keys = moduleKeys ?? Object.keys(state.modules)
  const modules: Record<string, unknown> = {}
  for (const k of keys) {
    if (state.modules[k] === undefined) continue
    // Default is inputs-only (results recompute on open). With includeResults the
    // slice is copied verbatim so a full snapshot (fit outputs, plot data, …) is saved.
    modules[k] = includeResults ? state.modules[k] : stripResults(state.modules[k])
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

export function downloadExport(moduleKeys?: string[], filename?: string, includeResults = false) {
  const payload = buildExport(moduleKeys, includeResults)
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
  if (!onlyModule) { clearHistory(); clearDirty() }
  return { applied: keys }
}

export function newProject(name = 'Untitled Project') {
  state = { projectName: name, units: 'hours', revision: state.revision + 1, modules: {} }
  emit()
  clearHistory()   // a new project is a fresh undo baseline
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
const PROJECTS_BACKUP_KEY = 'reliability-suite-projects-backup'

interface SavedProject {
  name: string
  savedAt: string
  units: string
  modules: Record<string, unknown>
}

let projectsRecoveryNotified = false

function parseProjects(raw: string | null): Record<string, SavedProject> | null {
  if (!raw) return null
  try {
    const map = JSON.parse(raw)
    return (map && typeof map === 'object') ? map as Record<string, SavedProject> : null
  } catch {
    return null
  }
}

function readProjectsMap(): Record<string, SavedProject> {
  let raw: string | null = null
  try { raw = localStorage.getItem(PROJECTS_KEY) } catch { return {} }
  const primary = parseProjects(raw)
  if (primary) return primary
  if (raw) {
    // The saved-projects list is present but corrupt — recover from the mirror
    // rather than silently reporting zero saved projects.
    let backupRaw: string | null = null
    try { backupRaw = localStorage.getItem(PROJECTS_BACKUP_KEY) } catch { backupRaw = null }
    const backup = parseProjects(backupRaw)
    if (!projectsRecoveryNotified) {
      projectsRecoveryNotified = true
      if (backup) toast.info('Your saved-projects list was unreadable — recovered from a backup copy.')
      else toast.error('Your saved-projects list could not be read. Restore from an exported .json backup if you have one.')
    }
    if (backup) return backup
  }
  return {}
}

function writeProjectsMap(map: Record<string, SavedProject>): boolean {
  try {
    const str = JSON.stringify(map)
    localStorage.setItem(PROJECTS_KEY, str)
    try { localStorage.setItem(PROJECTS_BACKUP_KEY, str) } catch { /* backup optional */ }
    return true
  } catch {
    notifySaveError()
    return false
  }
}

/** True if a project is already saved under `name` (for overwrite prompts). */
export function projectExists(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(readProjectsMap(), name.trim())
}

/** List saved projects, most-recently-saved first. */
export function listSavedProjects(): { name: string; savedAt: string }[] {
  return Object.values(readProjectsMap())
    .map(p => ({ name: p.name, savedAt: p.savedAt }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** Save the current project under `name` (computed results are stripped to keep
 *  storage small — re-run analyses after opening). Adopts the name. */
/** Write the current project's stripped state into the saved-projects map under
 *  `name` (shared by manual Save and the autosave). Clears the dirty flag on a
 *  successful write. */
function writeCurrentProject(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  const map = readProjectsMap()
  map[trimmed] = {
    name: trimmed,
    savedAt: new Date().toISOString(),
    units: state.units,
    modules: stripResults(state.modules) as Record<string, unknown>,
  }
  const ok = writeProjectsMap(map)
  // Only mark "saved" if the write actually succeeded — a failed write already
  // warned via notifySaveError and the dirty flag stays set.
  if (ok) clearDirty()
  return ok
}

export function saveNamedProject(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  state = { ...state, projectName: trimmed }   // adopt the name
  persist()                                    // update the session snapshot too
  const ok = writeCurrentProject(trimmed)
  notify()                                     // reflect the new name / saved state
  return ok
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
  clearHistory()   // opening a different project resets undo history
  clearDirty()     // freshly loaded from a saved project → a clean baseline
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
