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
import { useSyncExternalStore, useCallback, useMemo } from 'react'
import { UNIT_RULES, convertStateObject } from './unitFields'
import { toast } from '../components/shared/toast'
import { clearRuntimePlotAssets } from './runtimePlotAssets'
import { sameGroup } from './units'
import {
  EMPTY_PLOT_MARKUP,
  sanitizePlotMarkup,
  type PlotMarkup,
} from './plotMarkup'
import {
  APP_COMMIT,
  APP_SUBTITLE,
  APP_VERSION,
  APP_WEBSITE,
  BUILD_TIMESTAMP,
  PROJECT_FILE_TYPE,
  PROJECT_SCHEMA_VERSION,
  engineRevisionFor,
} from '../version'
import {
  createAnalysisRunRecord,
  hashCanonicalJson,
  newProjectIdentity,
  verifyArtifactBytes,
  type ArtifactManifest,
  type ArtifactSourceRecord,
  type AnalysisRunRecord,
  type ExportLedgerEntry,
  type ProjectIdentity,
} from './provenance'
import { ensurePredictionPartIds } from './predictionIdentity'
import { ProjectPersistence, type StoredProject } from './projectPersistence'
import { invalidateFtaResults, semanticFtaFingerprint, normalizeFtaLibrary, type FtaFolio } from '../components/FaultTree/libraryModel'
import type { PredictionPart } from '../api/client'
import { normalizeSharedSystemModules, systemInputFingerprint } from './sharedSystemModel'
import type { SystemDefinitionModel } from '../api/systemDefinition'
import { reconcileLinkedSources } from './linkedSourceInvalidation'
import { ssiInputFingerprint, type StressStrengthInput } from '../components/LifeData/stressStrengthModel'
import { resolveMcRun, type MonteCarloOwner } from '../components/LifeData/monteCarloModel'
import type { LifeDataModelFolio } from '../components/shared/adoptedDistribution'
import { quantityFromProjectUnit, type DatasetQuantity } from '../components/shared/datasetUnits'

export interface ProjectState {
  projectName: string
  identity: ProjectIdentity
  analysisRuns: AnalysisRunRecord[]
  exportLedger: ExportLedgerEntry[]
  /** Time units the data is entered in (shown on results, plots, etc.) */
  units: string
  /** Most recent successful named-project save, in ISO-8601 form. */
  lastSavedAt?: string | null
  revision: number
  modules: Record<string, unknown>
}

const MAX_PROVENANCE_RECORDS = 10000

function cleanIdentity(value: unknown): ProjectIdentity {
  const source = value && typeof value === 'object'
    ? value as Partial<ProjectIdentity> : {}
  const identity = newProjectIdentity()
  const text = (field: unknown) => typeof field === 'string'
    ? field.trim().slice(0, 300) || undefined : undefined
  return {
    projectId: typeof source.projectId === 'string' && source.projectId.trim()
      ? source.projectId.trim().slice(0, 200) : identity.projectId,
    organization: text(source.organization),
    analyst: text(source.analyst),
    projectNumber: text(source.projectNumber),
    documentNumber: text(source.documentNumber),
    classification: text(source.classification),
  }
}

function cleanAnalysisRuns(value: unknown): AnalysisRunRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => item && typeof item === 'object'
    && typeof item.runId === 'string'
    && typeof item.fingerprintSha256 === 'string')
    .slice(-MAX_PROVENANCE_RECORDS) as AnalysisRunRecord[]
}

function cleanExportLedger(value: unknown): ExportLedgerEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => item && typeof item === 'object'
    && typeof item.artifactId === 'string'
    && typeof item.sha256 === 'string')
    .slice(-MAX_PROVENANCE_RECORDS) as ExportLedgerEntry[]
}

export const UNIT_OPTIONS = [
  'hours', 'days', 'weeks', 'months', 'years', 'cycles', 'km', 'miles',
] as const

export const MODULE_LABELS: Record<string, string> = {
  lifeData: 'Life Data Analysis',
  alt: 'Reliability Testing',
  systemModeling: 'System Modeling',
  systemDefinition: 'System Definition',
  system: 'RBD',
  faultTree: 'Fault Tree Analysis',
  prediction: 'Failure Rate Prediction',
  pof: 'Physics of Failure',
  growth: 'Reliability Growth',
  softwareReliability: 'Software Reliability Engineering',
  fmea: 'FMEA',
  reliabilityProgram: 'Reliability Program',
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
  bookmarks: 'Bookmarks',
}

const SLICE_DETAIL_LABELS: Record<string, string> = {
  __provenance: 'Provenance & export ledger',
  degradation: 'Reliability Testing — Degradation',
  marginTest: 'Reliability Testing — Margin Testing',
  expChiSquared: 'Reliability Testing — Exponential Test Planning',
  rdtBayesian: 'Reliability Testing — Bayesian Demonstration Testing',
  differenceDetection: 'Reliability Testing — Difference Detection',
  reliabilityTestingTools: 'Reliability Testing — Planning & Screening Tools',
  system: 'System Modeling — RBD',
  faultTree: 'System Modeling — Fault Tree Analysis',
  markov: 'System Modeling — Markov Analysis',
  ram: 'Maintenance — Availability & Maintainability',
  maintReplacement: 'Maintenance — Replacement Planning',
  maintTaskAnalysis: 'Maintenance — Task Analysis',
  maintPMInterval: 'Maintenance — PM Interval',
  maintCostForecast: 'Maintenance — Cost Forecast',
  maintAvailability: 'Maintenance — Availability Sensitivity',
  maintVirtualAge: 'Maintenance — Virtual Age',
  dataAnalysisData: 'Statistical Modeling',
  descriptive: 'Statistical Modeling — Descriptive Statistics',
  dataModeling: 'Statistical Modeling — Regression & ML',
  dataAnalysisFolios: 'Statistical Modeling',
  'sixSigma.capability': 'Six Sigma — Process Capability',
  'sixSigma.spc': 'Six Sigma — Statistical Process Control',
  msa: 'Six Sigma — Measurement Systems Analysis',
  doe: 'Six Sigma — Design of Experiments',
}

/** Some UI modules span several store slices. Expand a module key into the
 *  concrete slice keys that hold its state (for per-module export/import). */
const MODULE_SLICE_GROUPS: Record<string, string[]> = {
  alt: [
    'alt', 'degradation', 'marginTest', 'expChiSquared', 'rdtBayesian',
    'differenceDetection', 'reliabilityTestingTools',
  ],
  systemModeling: ['systemDefinition', 'system', 'faultTree', 'faultTreeCatalog', 'markov', 'library'],
  dataAnalysis: ['dataAnalysisData', 'descriptive', 'dataModeling', 'dataAnalysisFolios'],
  maintenance: [
    'ram', 'maintTaskAnalysis', 'maintReplacement', 'maintPMInterval',
    'maintCostForecast', 'maintAvailability', 'maintVirtualAge',
  ],
  fmea: ['fmea', 'fmeaFailureFlow'],
  hra: ['hraTherp', 'hraHeart', 'hraSparH', 'hraCream', 'hraCreamExt', 'hraSlim', 'hraJhedi', 'hraSherpa', 'hraAtheana', 'hraMermos'],
  sixSigma: ['sixSigma.capability', 'sixSigma.spc', 'msa', 'doe'],
}

export function moduleSlices(moduleKey: string): string[] {
  if (moduleKey === 'faultTree') return ['faultTree', 'faultTreeCatalog']
  if (moduleKey === 'prediction') return ['prediction', 'systemDefinition']
  return MODULE_SLICE_GROUPS[moduleKey] ?? [moduleKey]
}

const PLOT_MARKUP_SLICE = '__plotMarkup'
const pendingMarkupClearScopes = new Set<string>()

function plotOwnerForSlice(sliceKey: string): string {
  if (sliceKey === 'faultTree') return sliceKey
  for (const [owner, slices] of Object.entries(MODULE_SLICE_GROUPS)) {
    if (slices.includes(sliceKey)) return owner
  }
  return sliceKey
}

const plotScopeToken = (moduleKey: string, analysisId?: string) => {
  const owner = cleanPlotKeyPart(plotOwnerForSlice(moduleKey))
  const id = cleanPlotKeyPart(analysisId ?? getActiveAnalysisId(owner))
  return `${owner}:${id}`
}

export function getActiveAnalysisId(moduleKey: string): string {
  if (moduleKey === 'dataAnalysis') {
    const data = state.modules.dataAnalysisFolios as { activeId?: unknown } | undefined
    return typeof data?.activeId === 'string' ? data.activeId : 'default'
  }
  const raw = state.modules[moduleKey] as Record<string, unknown> | undefined
  if (isFolioWrap(raw)) return String(raw.activeId || 'default')
  if (moduleKey === 'lifeData' && typeof raw?.activeId === 'string') return raw.activeId
  return 'default'
}

export function getActivePlotGroup(moduleKey: string): string | null {
  if (moduleKey === 'dataAnalysis') {
    const data = state.modules.dataAnalysisFolios as {
      activeId?: unknown
      analyses?: { id?: unknown; name?: unknown }[]
    } | undefined
    const active = data?.analyses?.find(item => String(item.id) === String(data.activeId))
    return active ? String(active.name ?? 'Analysis') : null
  }
  const raw = state.modules[moduleKey] as Record<string, unknown> | undefined
  if (isFolioWrap(raw)) {
    const active = raw.folios.find(item => item.id === raw.activeId)
    return active ? String(active.name ?? 'Analysis') : null
  }
  if (moduleKey === 'lifeData' && Array.isArray(raw?.folios)) {
    const active = (raw.folios as Record<string, unknown>[])
      .find(item => String(item.id) === String(raw.activeId))
    return active ? String(active.name ?? 'Analysis') : null
  }
  return null
}

export function getAnalysisIdForGroup(moduleKey: string, group: string): string {
  const ownerKey = plotOwnerForSlice(moduleKey)
  if (ownerKey === 'dataAnalysis') {
    const data = state.modules.dataAnalysisFolios as {
      analyses?: { id?: unknown; name?: unknown }[]
    } | undefined
    const match = data?.analyses?.find(item => String(item.name ?? '') === group)
    return match ? String(match.id) : 'default'
  }
  const raw = state.modules[ownerKey] as Record<string, unknown> | undefined
  if (isFolioWrap(raw)) {
    const match = raw.folios.find(item => String(item.name ?? '') === group)
    return match ? String(match.id) : 'default'
  }
  if (ownerKey === 'lifeData' && Array.isArray(raw?.folios)) {
    const match = (raw.folios as Record<string, unknown>[])
      .find(item => String(item.name ?? '') === group)
    return match ? String(match.id) : 'default'
  }
  return 'default'
}

/** Resolve saved source markup when an asset is enumerated off-screen. */
export function getPlotMarkupForAsset(
  moduleKey: string,
  group: string,
  plotId: string,
  analysisId?: string,
): PlotMarkup {
  const owner = cleanPlotKeyPart(plotOwnerForSlice(moduleKey))
  const analysis = cleanPlotKeyPart(analysisId ?? getAnalysisIdForGroup(moduleKey, group))
  const key = `${owner}:${analysis}:${cleanPlotKeyPart(plotId)}`
  const markup = plotMarkupMap()
  if (analysisId) {
    const concrete = `${cleanPlotKeyPart(moduleKey)}:${analysis}:${cleanPlotKeyPart(plotId)}`
    if (markup[concrete]) return sanitizePlotMarkup(markup[concrete])
  }
  const legacy = moduleKey === 'faultTree' ? `systemmodeling:${analysis}:${cleanPlotKeyPart(plotId)}` : key
  return sanitizePlotMarkup(markup[key] ?? markup[legacy])
}

const cleanPlotKeyPart = (value: string) => value.trim().toLowerCase()
  .replace(/[^a-z0-9_.-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'plot'

export function makePlotMarkupKey(moduleKey: string, plotId: string): string {
  return `${cleanPlotKeyPart(moduleKey)}:${cleanPlotKeyPart(getActiveAnalysisId(moduleKey))}:${cleanPlotKeyPart(plotId)}`
}

function plotMarkupMap(): Record<string, PlotMarkup> {
  const value = state.modules[PLOT_MARKUP_SLICE]
  return value && typeof value === 'object'
    ? value as Record<string, PlotMarkup> : {}
}

function sanitizePlotMarkupRecord(value: unknown): Record<string, PlotMarkup> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const clean: Record<string, PlotMarkup> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 2000)) {
    if (key.length > 500
        || !/^[a-z0-9_.-]+:[a-z0-9_.-]+:[a-z0-9_.-]+$/.test(key)) continue
    const markup = sanitizePlotMarkup(raw)
    if (markup.annotations.length || markup.shapes.length) clean[key] = markup
  }
  return clean
}

function sanitizeMarkupModule(modules: Record<string, unknown>): Record<string, unknown> {
  if (!modules[PLOT_MARKUP_SLICE]) return modules
  return {
    ...modules,
    [PLOT_MARKUP_SLICE]: sanitizePlotMarkupRecord(modules[PLOT_MARKUP_SLICE]),
  }
}

/** Project-backed user markup for one stable plot identity. */
export function usePlotMarkup(moduleKey: string, plotId: string): [
  PlotMarkup,
  (markup: PlotMarkup) => void,
] {
  const key = useSyncExternalStore(subscribe, () => makePlotMarkupKey(moduleKey, plotId))
  const markup = useSyncExternalStore(
    subscribe,
    () => plotMarkupMap()[key] ?? EMPTY_PLOT_MARKUP,
  )
  const setMarkup = useCallback((value: PlotMarkup) => {
    const currentKey = makePlotMarkupKey(moduleKey, plotId)
    const clean = sanitizePlotMarkup(value)
    const current = plotMarkupMap()
    const next = { ...current }
    if (clean.annotations.length === 0 && clean.shapes.length === 0) delete next[currentKey]
    else next[currentKey] = clean
    state = { ...state, modules: { ...state.modules, [PLOT_MARKUP_SLICE]: next } }
    emit({ sliceKey: moduleKey, fieldSig: `plot-markup:${currentKey}` })
  }, [moduleKey, plotId])
  // Toolbar-only renders must not recreate the plot layout. Besides avoiding
  // redundant Plotly.react calls, this preserves the reviewed view while a
  // snapshot or download is requested.
  const cleanMarkup = useMemo(() => sanitizePlotMarkup(markup), [markup])
  return [cleanMarkup, setMarkup]
}

/** Remove annotations for a module/analysis after a successful recalculation. */
export function clearPlotMarkupScope(moduleKey: string, analysisId?: string) {
  const owner = cleanPlotKeyPart(plotOwnerForSlice(moduleKey))
  const activeId = cleanPlotKeyPart(analysisId ?? getActiveAnalysisId(owner))
  const prefix = `${owner}:${activeId}:`
  pendingMarkupClearScopes.delete(`${owner}:${activeId}`)
  const current = plotMarkupMap()
  const next = Object.fromEntries(
    Object.entries(current).filter(([key]) => !key.startsWith(prefix)),
  )
  if (Object.keys(next).length === Object.keys(current).length) return
  state = { ...state, modules: { ...state.modules, [PLOT_MARKUP_SLICE]: next } }
}

// ---------------------------------------------------------------------------
// localStorage persistence (survives browser refresh)
// ---------------------------------------------------------------------------

// Browser persistence is scoped by the portable project schema. This prevents
// an older tab at the same remote origin from overwriting a newer tab's state
// with a persistence shape it cannot understand. The legacy keys are copied
// once, never deleted, so an already-open older tab remains isolated.
export const PROJECT_STORAGE_NAMESPACE = `perdura:project-schema:${PROJECT_SCHEMA_VERSION}`
const STORAGE_KEY = `${PROJECT_STORAGE_NAMESPACE}:session`
const PREVIOUS_STORAGE_KEY = 'perdura:project-schema:7:session'
const OLDER_STORAGE_KEY = 'perdura:project-schema:6:session'
const LEGACY_STORAGE_KEY = 'reliability-suite-session'
// A mirror of the last successfully-written session, so a corrupt/unreadable
// primary key (external tampering, another tab, a browser hiccup) can be
// recovered instead of silently falling back to an empty project.
const SESSION_BACKUP_KEY = `${PROJECT_STORAGE_NAMESPACE}:session-backup`
const PREVIOUS_SESSION_BACKUP_KEY = 'perdura:project-schema:7:session-backup'
const OLDER_SESSION_BACKUP_KEY = 'perdura:project-schema:6:session-backup'
const LEGACY_SESSION_BACKUP_KEY = 'reliability-suite-session-backup'

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
function notifySaveError(error?: unknown) {
  // eslint-disable-next-line no-console
  console.warn('Perdura: browser storage did not commit the project.', error)
  const now = Date.now()
  if (now - lastSaveErrorAt > 30000) {
    lastSaveErrorAt = now
    toast.error(error instanceof Error ? error.message : "Couldn't save to this browser. Export your project to preserve your work.")
  }
}

function parseSession(raw: string | null): ProjectState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectState>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.modules !== 'object') return null
    return {
      projectName: parsed.projectName ?? 'Untitled Project',
      identity: cleanIdentity(parsed.identity),
      analysisRuns: cleanAnalysisRuns(parsed.analysisRuns),
      exportLedger: cleanExportLedger(parsed.exportLedger),
      units: parsed.units ?? 'hours',
      lastSavedAt: typeof parsed.lastSavedAt === 'string' ? parsed.lastSavedAt : null,
      revision: 0,
      modules: sanitizeMarkupModule(
        (parsed.modules ?? {}) as Record<string, unknown>),
    }
  } catch {
    return null
  }
}

function loadPersisted(): ProjectState | null {
  let raw: string | null = null
  try { raw = localStorage.getItem(STORAGE_KEY) } catch { return null }
  let migratedLegacy = false
  if (!raw) {
    try {
      raw = localStorage.getItem(PREVIOUS_STORAGE_KEY)
        ?? localStorage.getItem(OLDER_STORAGE_KEY)
        ?? localStorage.getItem(LEGACY_STORAGE_KEY)
      migratedLegacy = Boolean(raw)
    } catch { return null }
  }
  if (!raw) return null   // fresh install — nothing saved yet
  const primary = parseSession(raw)
  if (primary) {
    return primary
  }
  // Primary present but unreadable → recover from the backup mirror.
  let backupRaw: string | null = null
  try { backupRaw = localStorage.getItem(SESSION_BACKUP_KEY) } catch { backupRaw = null }
  if (!backupRaw && migratedLegacy) {
    try {
      backupRaw = localStorage.getItem(PREVIOUS_SESSION_BACKUP_KEY)
        ?? localStorage.getItem(OLDER_SESSION_BACKUP_KEY)
        ?? localStorage.getItem(LEGACY_SESSION_BACKUP_KEY)
    } catch { backupRaw = null }
  }
  const backup = parseSession(backupRaw)
  if (backup) {
    startupNotice = 'Your saved session was unreadable — recovered from a backup copy.'
    return backup
  }
  // Both unreadable: tell the user rather than silently starting empty.
  startupNotice = 'Your saved session could not be read; starting a new project. If you have an exported .json backup, use Import to restore it.'
  return null
}

const projectFlushers = new Set<() => void>()
let flushingEditors = false
export function registerProjectFlusher(flusher: () => void): () => void {
  projectFlushers.add(flusher)
  return () => { projectFlushers.delete(flusher) }
}
export function flushProjectEditors(): void {
  if (flushingEditors) return
  flushingEditors = true
  try { for (const flusher of projectFlushers) flusher() }
  finally { flushingEditors = false }
}

const persistence = new ProjectPersistence((_key, value) => stripResults(value))
let storageReady = false
let hydration: Promise<void> | undefined
let persistenceError: string | null = null
let pendingPersistence = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveGeneration = 0
const namedProjectCache = new Map<string, SavedProjectListItem>()
const observedNamedProjects = new Set<string>()

function projectSnapshot(current: ProjectState): StoredProject {
  return {
    projectName: current.projectName, identity: current.identity,
    units: current.units, analysisRuns: current.analysisRuns,
    exportLedger: current.exportLedger, lastSavedAt: current.lastSavedAt,
    modules: current.modules,
  }
}

/** Initialize before mounting any editor; legacy browser records stay untouched. */
export function hydrateProjectStorage(): Promise<void> {
  if (hydration) return hydration
  const initialVersion = storeVersion
  hydration = (async () => {
    let restored = await persistence.read('session')
    // A rejected session must remain exportable from the recovery screen.
    // Validate before migration can write anything or normalize away an entry.
    if (restored) {
      try { validateFtaIdentities(restored.modules.faultTree) }
      catch (error) {
        if (storeVersion === initialVersion) state = { ...restored,
          identity: cleanIdentity(restored.identity), analysisRuns: cleanAnalysisRuns(restored.analysisRuns),
          exportLedger: cleanExportLedger(restored.exportLedger), revision: state.revision,
        }
        throw error
      }
    }
    if (!await persistence.migrationComplete()) {
      const legacy = readLegacyProjectsMap()
      for (const [name, saved] of Object.entries(legacy)) {
        const id = `named:${name}`
        if (!await persistence.read(id)) await persistence.save(id, {
          projectName: name, identity: cleanIdentity(saved.identity), units: saved.units ?? 'hours',
          analysisRuns: cleanAnalysisRuns(saved.analysisRuns), exportLedger: cleanExportLedger(saved.exportLedger),
          lastSavedAt: saved.savedAt, modules: normalizeProjectModules(sanitizeMarkupModule(saved.modules ?? {})),
        })
        persistence.forget(id)
      }
      if (!restored) {
        const legacySession = loadPersisted()
        if (legacySession) {
          restored = projectSnapshot({ ...legacySession, modules: normalizeProjectModules(legacySession.modules) })
          await persistence.save('session', restored)
          startupNotice = 'Migrated this browser project to IndexedDB. Previous saved data has been retained.'
        }
      }
      await persistence.markMigrationComplete()
    }
    if (storeVersion !== initialVersion) throw new Error('Project changed while browser storage was opening. Reload before editing.')
    if (restored) state = {
      ...restored, identity: cleanIdentity(restored.identity),
      analysisRuns: cleanAnalysisRuns(restored.analysisRuns), exportLedger: cleanExportLedger(restored.exportLedger),
      modules: normalizeProjectModules(sanitizeMarkupModule(restored.modules)), revision: state.revision + 1,
    }
    await refreshSavedProjects()
    storageReady = true
    persistenceError = null
    clearHistory()
    clearDirty()
    notify()
  })().catch(error => {
    hydration = undefined
    persistenceError = error instanceof Error ? error.message : 'Cannot open browser project storage.'
    throw error
  })
  return hydration
}

export function useProjectStorageStatus() {
  return useSyncExternalStore(subscribe, () => persistenceError ?? (pendingPersistence ? 'saving' : 'ready'))
}

function persist() {
  if (!storageReady) return
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = undefined; void flushProjectPersistence() }, 400)
}

/** Commit the current session and return false without clearing dirty state on failure. */
export async function flushProjectPersistence(): Promise<boolean> {
  flushProjectEditors()
  if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined }
  if (!storageReady) return false
  const snapshot = projectSnapshot(state)
  pendingPersistence++
  notify()
  try {
    await persistence.save('session', snapshot)
    persistenceError = null
    return true
  } catch (error) {
    persistenceError = error instanceof Error ? error.message : 'Browser save failed.'
    notifySaveError(error)
    return false
  } finally { pendingPersistence--; notify() }
}

let state: ProjectState = loadPersisted() ?? {
  projectName: 'Untitled Project',
  identity: newProjectIdentity(),
  analysisRuns: [],
  exportLedger: [],
  units: 'hours',
  lastSavedAt: null,
  revision: 0,
  modules: {},
}

function normalizePredictionSlice(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record._folioWrap === true && Array.isArray(record.folios)) {
    let changed = false
    const folios = record.folios.map(rawFolio => {
      if (!rawFolio || typeof rawFolio !== 'object') return rawFolio
      const folio = rawFolio as Record<string, unknown>
      const nextState = normalizePredictionSlice(folio.state)
      if (nextState === folio.state) return rawFolio
      changed = true
      return { ...folio, state: nextState }
    })
    return changed ? { ...record, folios } : value
  }
  if (!Array.isArray(record.parts)) return value
  const parts = ensurePredictionPartIds(record.parts as PredictionPart[])
  return parts === record.parts ? value : { ...record, parts }
}

function normalizePredictionModule(
  modules: Record<string, unknown>,
): Record<string, unknown> {
  if (modules.prediction === undefined) return modules
  const prediction = normalizePredictionSlice(modules.prediction)
  return prediction === modules.prediction
    ? modules
    : { ...modules, prediction }
}

function normalizeProjectModules(
  modules: Record<string, unknown>,
): Record<string, unknown> {
  validateFtaIdentities(modules.faultTree)
  const normalized = normalizeSharedSystemModules(normalizePredictionModule(modules))
  if (normalized.faultTree === undefined) return normalized
  const library = normalizeFtaLibrary(normalized.faultTree, normalized.faultTreeCatalog)
  return { ...normalized,
    faultTree: { _folioWrap: true, activeId: library.activeId, folios: library.folios },
    faultTreeCatalog: library.catalog,
  }
}

/** Identity repair cannot be inferred: it would break Transfers, provenance and
 * report sources. Raw legacy canvases have the one explicit migration ID f0. */
function validateFtaIdentities(raw: unknown): void {
  if (raw === undefined) return
  const fail = () => { throw new Error('FTA library contains missing, non-string, empty or duplicate tree IDs, or an empty folio list. The original data was retained; repair its identities before opening or importing it.') }
  if (!raw || typeof raw !== 'object') fail()
  const wrapper = raw as Record<string, unknown>
  const entries = Array.isArray(raw) ? raw : wrapper._folioWrap === true ? wrapper.folios : null
  if (entries === null) return // legacy raw canvas
  if (!Array.isArray(entries) || !entries.length) fail()
  const ids = new Set<string>()
  for (const entry of entries as unknown[]) {
    const id = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : undefined
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) fail()
    ids.add(id as string)
  }
}

try { state = { ...state, modules: normalizeProjectModules(state.modules) } }
catch (error) {
  // Keep the complete raw legacy state in memory as well as localStorage.
  // Hydration will reject it visibly while the recovery export remains usable.
  startupNotice = error instanceof Error ? error.message : 'Cannot normalize the saved project.'
}

// ---------------------------------------------------------------------------
// Dirty (unsaved-changes) tracking
// ---------------------------------------------------------------------------

let _dirty = false
const dirtyTargets = new Map<string, string>()

function sliceDetailLabel(sliceKey: string): string {
  return SLICE_DETAIL_LABELS[sliceKey] ?? MODULE_LABELS[sliceKey]
    ?? sliceKey.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, value => value.toUpperCase())
}

function activeNamedEntry(value: unknown, preferredId?: string): { id: string; name: string } | null {
  if (!value || typeof value !== 'object') return null
  const container = value as {
    activeId?: unknown
    folios?: unknown
    analyses?: unknown
  }
  const entries = Array.isArray(container.folios)
    ? container.folios
    : Array.isArray(container.analyses) ? container.analyses : []
  const id = preferredId || (typeof container.activeId === 'string' ? container.activeId : '')
  const entry = entries.find(item => item && typeof item === 'object'
    && String((item as { id?: unknown }).id ?? '') === id) as { id?: unknown; name?: unknown } | undefined
  if (!entry) return null
  return {
    id: String(entry.id ?? id),
    name: String(entry.name ?? 'Untitled analysis'),
  }
}

function dirtyTargetFor(origin: EditOrigin): { key: string; label: string } {
  const sliceKey = origin.sliceKey
  if (!sliceKey) return { key: 'project-settings', label: 'Project settings' }

  // Statistical Modeling keeps the active analysis in a coordination slice
  // while its edits land in one of three content slices.
  if (['dataAnalysisData', 'descriptive', 'dataModeling', 'dataAnalysisFolios'].includes(sliceKey)) {
    const analysis = activeNamedEntry(state.modules.dataAnalysisFolios)
    if (analysis) {
      return {
        key: `dataAnalysis:${analysis.id}`,
        label: `Statistical Modeling — ${analysis.name}`,
      }
    }
  }

  // Life Data uses its own folio container rather than the generic wrapper.
  if (sliceKey === 'lifeData') {
    const stateSlice = state.modules.lifeData as { folios?: unknown[] } | undefined
    const indexMatch = origin.fieldSig.match(/^folios\[(\d+)]/)
    const indexed = indexMatch && Array.isArray(stateSlice?.folios)
      ? stateSlice!.folios![Number(indexMatch[1])] as { id?: unknown; name?: unknown } | undefined
      : undefined
    const folio = indexed?.id != null
      ? { id: String(indexed.id), name: String(indexed.name ?? 'Untitled folio') }
      : activeNamedEntry(state.modules.lifeData)
    if (folio) {
      return {
        key: `lifeData:${folio.id}`,
        label: `Life Data Analysis — ${folio.name}`,
      }
    }
  }

  const slice = state.modules[sliceKey]
  if (isFolioWrap(slice)) {
    const idPrefix = origin.fieldSig.match(/^([^:]+):/)?.[1]
    const folio = activeNamedEntry(slice, idPrefix)
      ?? activeNamedEntry(slice)
    if (folio) {
      return {
        key: `${sliceKey}:${folio.id}`,
        label: `${sliceDetailLabel(sliceKey)} — ${folio.name}`,
      }
    }
  }

  return { key: sliceKey, label: sliceDetailLabel(sliceKey) }
}

export function markDirty(origin?: EditOrigin) {
  _dirty = true
  if (origin) {
    const target = dirtyTargetFor(origin)
    if (dirtyTargets.get(target.key) !== target.label) {
      dirtyTargets.set(target.key, target.label)
      dirtyDetailsSnapshot = null
    }
  }
}
export function clearDirty() {
  _dirty = false
  dirtyTargets.clear()
  dirtyDetailsSnapshot = null
  notify()
}
export function isDirty() { return _dirty }
let dirtyDetailsSnapshot: string[] | null = null
export function getUnsavedChangeDetails(): string[] {
  return dirtyDetailsSnapshot ??= Array.from(dirtyTargets.values())
}

const listeners = new Set<() => void>()
// Monotonic counter bumped on every store write (any module). Unlike `revision`
// (which only changes on wholesale import/reset), this lets views react to any
// per-module mutation — e.g. the Report Builder re-enumerating assets after an
// analysis is run in another module.
let storeVersion = 0
// Bump the version and wake subscribers WITHOUT touching the dirty flag — used
// by clearDirty so the saved/unsaved indicator can update on save/open/new.
const notify = () => { storeVersion++; listeners.forEach(l => l()) }
// Identifies which slice + field a mutation touched, so the history layer can
// (a) start a NEW undo step whenever the edited field changes — no cross-field
// merging — while coalescing continuous edits to the same field, and (b) know
// which module/submodule to navigate to on undo/redo.
export type EditOrigin = { sliceKey: string; fieldSig: string }
let editSeq = 0
const anonOrigin = (sliceKey = ''): EditOrigin => ({ sliceKey, fieldSig: `anon-${++editSeq}` })

const emit = (origin: EditOrigin = anonOrigin()) => {
  state = { ...state, modules: reconcileLinkedSources(state) }
  if (state.identity.projectId === lastState.identity.projectId && state.revision === lastState.revision
      && state.modules.faultTree !== lastState.modules.faultTree) {
    const before = lastState.modules.faultTree
    const after = state.modules.faultTree
    if (isFolioWrap(before) && isFolioWrap(after)) {
      const folios = invalidateFtaResults(before.folios as FtaFolio[], after.folios as FtaFolio[])
      if (folios.some((folio, index) => folio !== after.folios[index])) {
        state = { ...state, modules: { ...state.modules, faultTree: { ...after, folios } } }
      }
    }
  }
  saveGeneration++
  markDirty(origin)
  if (redoStack.length) historyVersion++
  redoStack = []            // any fresh edit invalidates the redo branch
  persist()
  recordHistory(origin)     // one undo step per distinct field
  scheduleAutoSave()        // keep the open named project up to date
  lastState = state
  notify()
}

/** Persist audit metadata without manufacturing an undo step for a completed
 * calculation or download. The ledger is still a real unsaved project change. */
function emitSystemMetadata() {
  saveGeneration++
  markDirty({ sliceKey: '__provenance', fieldSig: 'ledger' })
  persist()
  scheduleAutoSave()
  lastState = state
  notify()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

const subscribeInactive = () => () => {}

// ---------------------------------------------------------------------------
// Undo / redo history (in-memory, per-field, project-global)
// ---------------------------------------------------------------------------
// Snapshots are whole ProjectStates; because the store replaces `state`
// wholesale per edit and unchanged module slices are shared by reference, each
// snapshot is a cheap shallow shell. A new undo step is pushed the instant the
// edited field changes (keyed by slice + field signature); consecutive edits to
// the SAME field coalesce into one step.

interface HistoryEntry {
  state: ProjectState
  sliceKey: string
  fieldSig: string
  label: string
  detail: string
}
export interface ProjectHistoryItem {
  steps: number
  sliceKey: string
  label: string
  detail: string
}
const HISTORY_LIMIT = 100
let undoStack: HistoryEntry[] = []
let redoStack: HistoryEntry[] = []
let historyVersion = 0
let pendingKey: string | null = null   // slice::field of the in-progress step
let lastState: ProjectState = state     // state as of the previous emit

function historyFieldLabel(fieldSig: string): string {
  if (/^anon-/.test(fieldSig)) return 'Project edit'
  if (/^folio-op-/.test(fieldSig)) return 'Analysis list'
  const raw = fieldSig.includes(':') ? fieldSig.slice(fieldSig.lastIndexOf(':') + 1) : fieldSig
  const known: Record<string, string> = {
    projectName: 'Project name', units: 'Project units', state: 'Analysis contents',
    value: 'Value', result: 'Analysis result', nodes: 'Diagram nodes', edges: 'Diagram connectors',
  }
  if (known[raw]) return known[raw]
  return raw
    .replace(/\[(\d+)]/g, ' row $1 ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, value => value.toUpperCase()) || 'Edit'
}

function recordHistory(origin: EditOrigin) {
  const key = `${origin.sliceKey}::${origin.fieldSig}`
  if (key === pendingKey) return         // same field → coalesce, no new step
  const target = dirtyTargetFor(origin)
  undoStack.push({
    state: lastState,
    sliceKey: origin.sliceKey,
    fieldSig: origin.fieldSig,
    label: target.label,
    detail: historyFieldLabel(origin.fieldSig),
  })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  historyVersion++
  pendingKey = key
}

function clearHistory() {
  historyVersion++
  undoStack = []
  redoStack = []
  pendingKey = null
  lastState = state
}

function applySnapshot(snap: ProjectState, sliceKey: string) {
  // New revision so the ReactFlow canvases (RBD/FTA) re-init from the store.
  state = {
    projectName: snap.projectName,
    identity: snap.identity,
    analysisRuns: snap.analysisRuns,
    exportLedger: snap.exportLedger,
    units: snap.units,
    lastSavedAt: state.lastSavedAt ?? null,
    modules: snap.modules,
    revision: state.revision + 1,
  }
  pendingMarkupClearScopes.clear()
  lastState = state
  pendingKey = null
  saveGeneration++
  markDirty({ sliceKey, fieldSig: 'undo-redo' })
  persist()
  scheduleAutoSave()
  notify()
}

export function canUndo(): boolean { return undoStack.length > 0 }
export function canRedo(): boolean { return redoStack.length > 0 }

function travelHistory(direction: 'undo' | 'redo', requestedSteps: number) {
  const source = direction === 'undo' ? undoStack : redoStack
  const destination = direction === 'undo' ? redoStack : undoStack
  const normalizedSteps = Number.isFinite(requestedSteps) ? Math.floor(requestedSteps) : 1
  const steps = Math.max(0, Math.min(source.length, Math.max(1, normalizedSteps)))
  let targetState = state
  let finalEntry: HistoryEntry | undefined
  for (let index = 0; index < steps; index += 1) {
    const entry = source.pop()
    if (!entry) break
    destination.push({
      state: targetState,
      sliceKey: entry.sliceKey,
      fieldSig: entry.fieldSig,
      label: entry.label,
      detail: entry.detail,
    })
    targetState = entry.state
    finalEntry = entry
  }
  if (!finalEntry) return
  historyVersion++
  setNavTarget(finalEntry.sliceKey)
  applySnapshot(targetState, finalEntry.sliceKey)
}

export function undoSteps(steps = 1) { travelHistory('undo', steps) }
export function redoSteps(steps = 1) { travelHistory('redo', steps) }
export function undo() { undoSteps(1) }
export function redo() { redoSteps(1) }

function historyItems(stack: HistoryEntry[]): ProjectHistoryItem[] {
  return [...stack].reverse().map((entry, index) => ({
    steps: index + 1,
    sliceKey: entry.sliceKey,
    label: entry.label,
    detail: entry.detail,
  }))
}

const EMPTY_HISTORY = { undo: [] as ProjectHistoryItem[], redo: [] as ProjectHistoryItem[] }
let historySnapshot = EMPTY_HISTORY
let historySnapshotVersion = -1
export function getUndoRedoHistory() {
  if (historySnapshotVersion !== historyVersion) {
    historySnapshot = { undo: historyItems(undoStack), redo: historyItems(redoStack) }
    historySnapshotVersion = historyVersion
  }
  return historySnapshot
}
export function getUndoHistory(): ProjectHistoryItem[] { return getUndoRedoHistory().undo }
export function getRedoHistory(): ProjectHistoryItem[] { return getUndoRedoHistory().redo }

/** Closed menus do not subscribe or derive history labels. */
export function useUndoRedoHistory(enabled = true) {
  return useSyncExternalStore(enabled ? subscribe : subscribeInactive,
    enabled ? getUndoRedoHistory : () => EMPTY_HISTORY)
}

export function useUndoRedoCounts(): { undo: number; redo: number } {
  const snapshot = useSyncExternalStore(subscribe, () => `${undoStack.length}:${redoStack.length}`)
  const [undo, redo] = snapshot.split(':').map(Number)
  return { undo, redo }
}

/** Reactive undo/redo availability (for toolbar buttons). Returns a stable
 *  primitive so useSyncExternalStore doesn't loop. */
export function useCanUndoRedo(): { undo: boolean; redo: boolean } {
  const s = useSyncExternalStore(subscribe, () => `${canUndo() ? 1 : 0}${canRedo() ? 1 : 0}`)
  return { undo: s[0] === '1', redo: s[1] === '1' }
}

// ---------------------------------------------------------------------------
// Undo/redo navigation target — the slice whose change is being (un)done, so
// the UI can jump to that module + submodule. Set by undo()/redo(); cleared on
// any manual navigation or fresh edit.
// ---------------------------------------------------------------------------
let navTarget: { sliceKey: string; nonce: number } | null = null
let navSeq = 0
function setNavTarget(sliceKey: string) {
  navTarget = sliceKey ? { sliceKey, nonce: ++navSeq } : null
}
export function clearNavTarget() { navTarget = null }
export function useNavTarget(): { sliceKey: string; nonce: number } | null {
  return useSyncExternalStore(subscribe, () => navTarget)
}

/** Where each store slice lives in the UI: the App tab id and, for modules with
 *  internal sub-tools, the container sub-tab id. Used to jump to the
 *  module/submodule of an undone/redone change. */
export interface NavLocation { tab: string; sub?: string }
export const NAV_MAP: Record<string, NavLocation> = {
  lifeData: { tab: 'life-data' },
  prediction: { tab: 'prediction' },
  pof: { tab: 'pof' },
  growth: { tab: 'growth' },
  softwareReliability: { tab: 'software-reliability' },
  fmea: { tab: 'fmea' },
  reliabilityProgram: { tab: 'reliability-program' },
  warranty: { tab: 'warranty' },
  reliabilityAllocation: { tab: 'allocation' },
  hypothesis: { tab: 'hypothesis' },
  reportBuilder: { tab: 'report-builder' },
  systemModeling: { tab: 'system-modeling' },
  maintenance: { tab: 'maintenance' },
  hra: { tab: 'hra' },
  dataAnalysis: { tab: 'data-analysis' },
  sixSigma: { tab: 'six-sigma' },
  // Reliability Testing (single tab, top-level sub-view keyed by slice)
  alt: { tab: 'alt', sub: 'alt' },
  degradation: { tab: 'alt', sub: 'degradation' },
  marginTest: { tab: 'alt', sub: 'rdt' },
  expChiSquared: { tab: 'alt', sub: 'rdt' },
  rdtBayesian: { tab: 'alt', sub: 'rdt' },
  differenceDetection: { tab: 'alt', sub: 'design' },
  reliabilityTestingTools: { tab: 'alt' },
  // System modeling
  system: { tab: 'system-modeling', sub: 'rbd' },
  faultTree: { tab: 'system-modeling', sub: 'fta' },
  markov: { tab: 'system-modeling', sub: 'markov' },
  // Maintenance
  ram: { tab: 'maintenance', sub: 'availability' },
  maintTaskAnalysis: { tab: 'maintenance', sub: 'task-analysis' },
  maintReplacement: { tab: 'maintenance', sub: 'replacement' },
  maintPMInterval: { tab: 'maintenance', sub: 'pm-interval' },
  maintCostForecast: { tab: 'maintenance', sub: 'cost-forecast' },
  maintAvailability: { tab: 'maintenance', sub: 'availability-sensitivity' },
  maintVirtualAge: { tab: 'maintenance', sub: 'virtual-age' },
  // Human Reliability
  hraTherp: { tab: 'hra', sub: 'therp' },
  hraHeart: { tab: 'hra', sub: 'heart' },
  hraSparH: { tab: 'hra', sub: 'spar-h' },
  hraCream: { tab: 'hra', sub: 'cream' },
  hraCreamExt: { tab: 'hra', sub: 'cream-extended' },
  hraSlim: { tab: 'hra', sub: 'slim' },
  hraJhedi: { tab: 'hra', sub: 'jhedi' },
  hraSherpa: { tab: 'hra', sub: 'sherpa' },
  hraAtheana: { tab: 'hra', sub: 'atheana' },
  hraMermos: { tab: 'hra', sub: 'mermos' },
  // Statistical Modeling
  descriptive: { tab: 'data-analysis', sub: 'descriptive' },
  dataAnalysisData: { tab: 'data-analysis', sub: 'descriptive' },
  dataAnalysisFolios: { tab: 'data-analysis', sub: 'descriptive' },
  dataModeling: { tab: 'data-analysis', sub: 'modeling' },
  // Six Sigma
  'sixSigma.capability': { tab: 'six-sigma', sub: 'capability' },
  'sixSigma.spc': { tab: 'six-sigma', sub: 'spc' },
  msa: { tab: 'six-sigma', sub: 'msa' },
  doe: { tab: 'six-sigma', sub: 'doe' },
}

/** Reactive helper for container modules: returns the sub-tab to switch to when
 *  the current undo/redo nav target points at `tabId`, or null. `nonce` lets the
 *  caller de-dupe repeated targets. */
export function useSubNav(tabId: string): { sub: string; nonce: number } | null {
  const nav = useNavTarget()
  if (!nav) return null
  const loc = NAV_MAP[nav.sliceKey]
  if (!loc || loc.tab !== tabId || !loc.sub) return null
  return { sub: loc.sub, nonce: nav.nonce }
}

// Compute a stable signature for WHICH field within a slice changed, so the
// history layer can tell edits to different fields/cells apart while coalescing
// repeated edits to the same one. Drills one level into row-array grids.
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
export function changeSignature(prev: unknown, next: unknown): string {
  if (prev === next) return 'same'
  if (!isObj(prev) || !isObj(next)) return 'value'
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const changed: string[] = []
  for (const k of keys) if (prev[k] !== next[k]) changed.push(k)
  if (changed.length !== 1) return changed.join('+') || 'value'
  const k = changed[0]
  const pv = prev[k], nv = next[k]
  if (Array.isArray(pv) && Array.isArray(nv) && pv.length === nv.length) {
    let idx = -1
    for (let i = 0; i < pv.length; i++) {
      if (pv[i] !== nv[i]) { if (idx !== -1) return k; idx = i }
    }
    if (idx === -1) return k
    const rp = pv[idx], rn = nv[idx]
    if (isObj(rp) && isObj(rn)) {
      const rk = [...new Set([...Object.keys(rp), ...Object.keys(rn)])].filter(kk => rp[kk] !== rn[kk])
      return `${k}[${idx}].${rk.join('+')}`
    }
    return `${k}[${idx}]`
  }
  return k
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
  if (!namedProjectCache.has(name) || !storageReady || pendingNamedSaves) return
  void writeCurrentProject(name)
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

/** Reactive timestamp of the most recent successful named-project save. */
export function useLastSavedAt(): string | null {
  return useSyncExternalStore(subscribe, () => state.lastSavedAt
    ?? namedProjectCache.get(state.projectName)?.savedAt
    ?? null)
}

/** Reactive module/analysis labels touched since the last successful save. */
export function useUnsavedChangeDetails(): string[] {
  return useSyncExternalStore(subscribe, getUnsavedChangeDetails)
}

export const getProjectState = () => state

export function useProjectIdentity(): [ProjectIdentity, (patch: Partial<Omit<ProjectIdentity, 'projectId'>>) => void] {
  const identity = useSyncExternalStore(subscribe, () => state.identity)
  const update = useCallback((patch: Partial<Omit<ProjectIdentity, 'projectId'>>) => {
    state = { ...state, identity: cleanIdentity({ ...state.identity, ...patch, projectId: state.identity.projectId }) }
    emit({ sliceKey: '__provenance', fieldSig: 'project-identity' })
  }, [])
  return [identity, update]
}

const EMPTY_LEDGER = { analysisRuns: [] as AnalysisRunRecord[], exports: [] as ExportLedgerEntry[] }
let ledgerSnapshot = EMPTY_LEDGER
export function getProvenanceLedger() {
  if (ledgerSnapshot.analysisRuns !== state.analysisRuns || ledgerSnapshot.exports !== state.exportLedger) {
    ledgerSnapshot = { analysisRuns: state.analysisRuns, exports: state.exportLedger }
  }
  return ledgerSnapshot
}

export function useProvenanceLedger(enabled = true) {
  return useSyncExternalStore(enabled ? subscribe : subscribeInactive,
    enabled ? getProvenanceLedger : () => EMPTY_LEDGER)
}

export function recordExportLedger(entry: ExportLedgerEntry) {
  if (state.exportLedger.some(item => item.artifactId === entry.artifactId)) return
  state = { ...state, exportLedger: [...state.exportLedger, entry].slice(-MAX_PROVENANCE_RECORDS) }
  emitSystemMetadata()
}

export function useProjectName(): [string, (n: string) => void] {
  const name = useSyncExternalStore(subscribe, () => state.projectName)
  const set = useCallback((n: string) => {
    state = { ...state, projectName: n }
    emit({ sliceKey: '', fieldSig: 'projectName' })
  }, [])
  return [name, set]
}

export function useUnits(): [string, (u: string) => void] {
  const units = useSyncExternalStore(subscribe, () => state.units)
  const set = useCallback((u: string) => {
    state = { ...state, units: u }
    emit({ sliceKey: '', fieldSig: 'units' })
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
    clearMarkupForReplacedResults(moduleKey, prev, next)
    emit({ sliceKey: moduleKey, fieldSig: changeSignature(prev, next) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey])
  return [value ?? initial, set]
}

export function setModuleState(moduleKey: string, data: unknown) {
  const prev = state.modules[moduleKey]
  state = { ...state, modules: { ...state.modules, [moduleKey]: data } }
  clearMarkupForReplacedResults(moduleKey, prev, data)
  emit({ sliceKey: moduleKey, fieldSig: changeSignature(prev, data) })
}

/** Commit related module edits as one project history and persistence action. */
export function writeModuleSlices(updates: Record<string, unknown>, origin?: EditOrigin) {
  const previous = state.modules
  state = { ...state, modules: { ...previous, ...updates } }
  for (const [key, value] of Object.entries(updates)) {
    clearMarkupForReplacedResults(key, previous[key], value)
  }
  emit(origin ?? { sliceKey: Object.keys(updates)[0] ?? '', fieldSig: 'shared-edit' })
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

export interface ModuleFolioSnapshot<T> {
  id: string
  name: string
  state: T
  active: boolean
  dirty: boolean
}

/** Reactive read-only access to every analysis in a folio-backed module. */
export function useModuleFolios<T>(
  moduleKey: string,
): ModuleFolioSnapshot<T>[] {
  const raw = useSyncExternalStore(
    subscribe, () => state.modules[moduleKey] as unknown)
  return useMemo(() => {
    if (isFolioWrap(raw)) {
      const wrap = raw as FolioWrap<T>
      return wrap.folios.map(folio => ({
        id: folio.id,
        name: folio.name,
        state: folio.state,
        active: folio.id === wrap.activeId,
        dirty: !!folio.dirty,
      }))
    }
    if (raw === undefined) return []
    return [{
      id: 'f0',
      name: 'Analysis 1',
      state: raw as T,
      active: true,
      dirty: false,
    }]
  }, [raw])
}

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
const inputSigCache = new WeakMap<object, Map<string, string>>()

function inputSignature(v: unknown, moduleKey = ''): string {
  const cacheable = typeof v === 'object' && v !== null
  if (cacheable) {
    const hit = inputSigCache.get(v as object)?.get(moduleKey)
    if (hit !== undefined) return hit
  }
  const sig = JSON.stringify(analysisInputSnapshot(v, moduleKey)) ?? ''
  if (cacheable) {
    const signatures = inputSigCache.get(v as object) ?? new Map<string, string>()
    signatures.set(moduleKey, sig); inputSigCache.set(v as object, signatures)
  }
  return sig
}

/** Compare two folio states ignoring computed-result fields, to tell whether
 *  the *inputs* changed (so existing results would be stale). */
export function inputsChanged(prev: unknown, next: unknown, moduleKey = ''): boolean {
  try {
    return inputSignature(prev, moduleKey) !== inputSignature(next, moduleKey)
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
  moduleKey: string
  /** Read-only snapshots support same-module transfer/library references. */
  folios: { id: string; name: string; dirty?: boolean; state?: unknown }[]
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

  const norm = useMemo<FolioWrap<T>>(() => isFolioWrap(raw)
    ? (raw as FolioWrap<T>)
    : {
        _folioWrap: true,
        activeId: 'f0',
        folios: [{ id: 'f0', name: 'Analysis 1', state: (raw as T | undefined) ?? initial }],
      }, [raw, initial])
  const active = norm.folios.find(f => f.id === norm.activeId) ?? norm.folios[0]

  const writeWrap = useCallback((next: FolioWrap<T>, origin?: EditOrigin) => {
    state = { ...state, modules: { ...state.modules, [moduleKey]: next } }
    // Structural folio ops (add/rename/remove/select) get a unique signature so
    // each is its own undo step; per-field edits pass an explicit origin.
    emit(origin ?? { sliceKey: moduleKey, fieldSig: `folio-op-${++editSeq}` })
  }, [moduleKey])

  const setActiveState = useCallback((v: T | ((p: T) => T)) => {
    const cur = state.modules[moduleKey] as unknown
    const w: FolioWrap<T> = isFolioWrap(cur)
      ? (cur as FolioWrap<T>)
      : { _folioWrap: true, activeId: 'f0',
          folios: [{ id: 'f0', name: 'Analysis 1', state: (cur as T | undefined) ?? initial }] }
    const act = w.folios.find(f => f.id === w.activeId) ?? w.folios[0]
    const nextState = typeof v === 'function' ? (v as (p: T) => T)(act.state) : v
    if (nextState === act.state || JSON.stringify(nextState) === JSON.stringify(act.state)) return
    // Stale-results tracking (#11): a folio is "dirty" when it holds computed
    // results but its inputs have since changed. A write that (re)computes
    // results — inputs unchanged — clears the flag. hasComputedResults is
    // checked first (cheap, early-exits) so pure data entry before any run
    // never pays for the signature comparison.
    const dirty = hasComputedResults(nextState) && (moduleKey === 'faultTree'
      ? semanticFtaFingerprint(act.state as FtaFolio['state']) !== semanticFtaFingerprint(nextState as FtaFolio['state'])
      : inputsChanged(act.state, nextState, moduleKey) || Boolean(act.dirty && !hasReplacedComputedOutput(act.state, nextState)))
    const nextWrap = {
      ...w,
      folios: w.folios.map(f => f.id === act.id ? { ...f, state: nextState, dirty } : f),
    }
    state = { ...state, modules: { ...state.modules, [moduleKey]: nextWrap } }
    handleMarkupCalculationTransition(moduleKey, act.state, nextState, act.id)
    emit({ sliceKey: moduleKey, fieldSig: `${act.id}:${changeSignature(act.state, nextState)}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, moduleKey])

  const freshWrap = () => {
    flushProjectEditors()
    const current = state.modules[moduleKey]
    return isFolioWrap(current) ? current as FolioWrap<T> : {
      _folioWrap: true as const, activeId: 'f0',
      folios: [{ id: 'f0', name: 'Analysis 1', state: (current as T | undefined) ?? initial }],
    }
  }
  const api = useMemo<FoliosApi>(() => ({
    moduleKey,
    folios: norm.folios.map(f => ({ id: f.id, name: f.name, dirty: !!f.dirty, state: f.state })),
    activeId: norm.activeId,
    add: () => {
      const current = freshWrap()
      const id = newFolioId()
      writeWrap({ ...current, activeId: id, folios: [...current.folios,
        { id, name: `Analysis ${current.folios.length + 1}`, state: initial }] })
    },
    rename: (id, name) => {
      const current = freshWrap()
      writeWrap({ ...current, folios: current.folios.map(f => f.id === id ? { ...f, name } : f) })
    },
    remove: id => {
      const current = freshWrap()
      if (!current.folios.some(folio => folio.id === id)) return
      clearPlotMarkupScope(moduleKey, id)
      if (current.folios.length <= 1) {
        const nid = newFolioId()
        writeWrap({ ...current, activeId: nid, folios: [{ id: nid, name: 'Analysis 1', state: initial }] })
        return
      }
      const idx = current.folios.findIndex(f => f.id === id)
      const folios = current.folios.filter(f => f.id !== id)
      const activeId = current.activeId === id ? folios[Math.max(0, idx - 1)].id : current.activeId
      writeWrap({ ...current, activeId, folios })
    },
    select: id => {
      const current = freshWrap()
      if (current.folios.some(folio => folio.id === id)) writeWrap({ ...current, activeId: id })
    },
  // freshWrap deliberately reads current state at invocation, never captured norm.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [initial, moduleKey, norm, writeWrap])

  return [active.state, setActiveState, api]
}

/** One atomic history operation for graph-backed FTA library mutations.
 * Call flushProjectEditors before deriving the replacement folio list. */
export function writeFtaLibrary<T>(
  folios: { id: string; name: string; state: T; dirty?: boolean }[],
  catalog: unknown, activeId: string, historyLabel = 'FTA library',
): void {
  if (!folios.length || !folios.some(folio => folio.id === activeId)
      || new Set(folios.map(folio => folio.id)).size !== folios.length) {
    throw new Error('FTA library requires unique tree IDs and an existing active tree.')
  }
  const before = state.modules.faultTree
  const prior = isFolioWrap(before) ? before.folios as FtaFolio[] : []
  const invalidated = invalidateFtaResults(prior, folios as unknown as FtaFolio[])
  state = { ...state, revision: state.revision + 1, modules: {
    ...state.modules, faultTree: { _folioWrap: true, activeId, folios: invalidated }, faultTreeCatalog: catalog,
  } }
  emit({ sliceKey: 'faultTree', fieldSig: `folio-op-${historyLabel}-${++editSeq}` })
}

/**
 * Write state to a *specific* folio by id (not necessarily the active one).
 * Used by canvas modules to flush a folio's pending edits to the folio they
 * belong to before switching the active folio — otherwise a debounced write
 * would either be discarded or land in the wrong (newly selected) folio. No-op
 * if the module isn't folio-wrapped yet or the folio no longer exists.
 */
export function writeFolioState<T>(
  moduleKey: string,
  folioId: string,
  nextState: T,
  historyFieldSig?: string,
) {
  const cur = state.modules[moduleKey] as unknown
  if (!isFolioWrap(cur)) return
  const w = cur as FolioWrap<T>
  const target = w.folios.find(f => f.id === folioId)
  if (!target) return
  // Canvas views flush debounced snapshots instead of calling their hook setter
  // for every drag tick. Avoid dirty/history entries for a no-op flush, and use
  // the actual changed field as the global undo coalescing key.
  if (JSON.stringify(target.state) === JSON.stringify(nextState)) return
  const dirty = hasComputedResults(nextState) && (moduleKey === 'faultTree'
    ? semanticFtaFingerprint(target.state as FtaFolio['state']) !== semanticFtaFingerprint(nextState as FtaFolio['state'])
    : inputsChanged(target.state, nextState, moduleKey) || Boolean(target.dirty && !hasReplacedComputedOutput(target.state, nextState)))
  state = {
    ...state,
    modules: {
      ...state.modules,
      [moduleKey]: {
        ...w,
        folios: w.folios.map(f => f.id === folioId
          ? { ...f, state: nextState, dirty }
          : f),
      },
    },
  }
  handleMarkupCalculationTransition(moduleKey, target.state, nextState, folioId)
  emit({
    sliceKey: moduleKey,
    fieldSig: `${folioId}:${historyFieldSig ?? changeSignature(target.state, nextState)}`,
  })
}

export interface FolioRequest<T> {
  /** Origin still visible and no newer request has replaced this one. */
  isActive(): boolean
  /** Origin and inputs have remained unchanged for this request's lifetime. */
  isCurrent(): boolean
  commit(update: (current: T) => T): boolean
  finish(): void
}

export function readFolioState<T>(moduleKey: string, folioId: string): T | undefined {
  const raw = state.modules[moduleKey]
  return isFolioWrap(raw) ? raw.folios.find(folio => folio.id === folioId)?.state as T | undefined
    : folioId === 'f0' ? raw as T | undefined : undefined
}

const activeFolioRequests = new Map<string, symbol>()

/** Bind asynchronous work to its originating project, analysis, and inputs.
 * Call finish in finally (and on unmount) to release the store subscription.
 * A channel separates independent calculations within the same analysis. */
export function beginFolioRequest<T>(
  moduleKey: string, folioId: string, initial: T, channel = 'analysis',
  contextFingerprint?: () => string,
): FolioRequest<T> {
  const projectId = state.identity.projectId
  const revision = state.revision
  const units = state.units
  const context = contextFingerprint?.()
  const key = JSON.stringify([moduleKey, folioId, channel])
  const token = Symbol(key)
  activeFolioRequests.set(key, token)
  let finished = false
  let invalidated = false
  const currentState = (): T | undefined => {
    const raw = state.modules[moduleKey]
    if (isFolioWrap(raw)) {
      return raw.activeId === folioId
        ? raw.folios.find(folio => folio.id === folioId)?.state as T | undefined
        : undefined
    }
    return folioId === 'f0' ? (raw as T | undefined) ?? initial : undefined
  }
  const isActive = () => !finished && activeFolioRequests.get(key) === token
    && state.identity.projectId === projectId && state.revision === revision
    && currentState() !== undefined
  const matchingInputs = () => state.units === units
    && (!contextFingerprint || contextFingerprint() === context)
    && !inputsChanged(initial, currentState(), moduleKey)
  const unsubscribe = subscribe(() => {
    if (!isActive() || !matchingInputs()) invalidated = true
  })
  const isCurrent = () => !invalidated && isActive() && matchingInputs()
  return {
    isActive,
    isCurrent,
    commit: update => {
      if (!isCurrent()) return false
      const raw = state.modules[moduleKey]
      const wrap: FolioWrap<T> = isFolioWrap(raw) ? raw as FolioWrap<T> : {
        _folioWrap: true, activeId: 'f0',
        folios: [{ id: 'f0', name: 'Analysis 1', state: currentState()! }],
      }
      const before = wrap.folios.find(folio => folio.id === folioId)!.state
      const next = update(before)
      state = { ...state, modules: { ...state.modules, [moduleKey]: {
        ...wrap, folios: wrap.folios.map(folio => folio.id === folioId
          ? { ...folio, state: next, dirty: hasComputedResults(next) && (moduleKey === 'faultTree'
            ? semanticFtaFingerprint(before as FtaFolio['state']) !== semanticFtaFingerprint(next as FtaFolio['state'])
            : inputsChanged(before, next, moduleKey)) }
          : folio),
      } } }
      handleMarkupCalculationTransition(moduleKey, before, next, folioId)
      emit({ sliceKey: moduleKey, fieldSig: `${folioId}:${changeSignature(before, next)}` })
      return true
    },
    finish: () => {
      finished = true
      unsubscribe()
      if (activeFolioRequests.get(key) === token) activeFolioRequests.delete(key)
    },
  }
}

/**
 * Atomically update several folios plus a project-level companion slice.
 * Cross-folio semantic tools use this so a propagated edit is one global
 * undo/redo operation rather than a sequence of partially applied writes.
 */
export function writeFolioStatesWithCompanion<T, S>(
  moduleKey: string,
  updates: { folioId: string; nextState: T }[],
  companionKey: string,
  companionState: S,
  historyFieldSig: string,
) {
  const current = state.modules[moduleKey] as unknown
  const wrap: FolioWrap<T> = isFolioWrap(current)
    ? current as FolioWrap<T>
    : {
        _folioWrap: true,
        activeId: 'f0',
        folios: current === undefined
          ? []
          : [{ id: 'f0', name: 'Analysis 1', state: current as T }],
      }
  const byId = new Map(updates.map(item => [item.folioId, item.nextState]))
  let changed = JSON.stringify(state.modules[companionKey])
    !== JSON.stringify(companionState)
  const folios = wrap.folios.map(folio => {
    const nextState = byId.get(folio.id)
    if (nextState === undefined
        || JSON.stringify(nextState) === JSON.stringify(folio.state)) {
      return folio
    }
    changed = true
    handleMarkupCalculationTransition(
      moduleKey, folio.state, nextState, folio.id)
    return {
      ...folio,
      state: nextState,
      dirty: hasComputedResults(nextState)
        && (moduleKey === 'faultTree'
          ? semanticFtaFingerprint(folio.state as FtaFolio['state']) !== semanticFtaFingerprint(nextState as FtaFolio['state'])
          : inputsChanged(folio.state, nextState, moduleKey) || Boolean(folio.dirty && !hasReplacedComputedOutput(folio.state, nextState))),
    }
  })
  if (!changed) return
  state = {
    ...state,
    modules: {
      ...state.modules,
      [moduleKey]: { ...wrap, folios },
      [companionKey]: companionState,
    },
  }
  emit({ sliceKey: moduleKey, fieldSig: historyFieldSig })
}

/** Add and activate a fully initialized analysis in another module.
 * Cross-module workflows such as exact RBD/FTA conversion use one atomic
 * project edit instead of manufacturing a blank folio and patching it later. */
export function createFolioState<T>(moduleKey: string, requestedName: string,
                                    nextState: T): string {
  const current = state.modules[moduleKey] as unknown
  const wrap: FolioWrap<T> = isFolioWrap(current)
    ? current as FolioWrap<T>
    : current === undefined ? {
        _folioWrap: true, activeId: '', folios: [],
      } : {
        _folioWrap: true,
        activeId: 'f0',
        folios: [{ id: 'f0', name: 'Analysis 1', state: current as T }],
      }
  const base = requestedName.trim() || 'Converted Analysis'
  const existing = new Set(wrap.folios.map(folio => folio.name.toLocaleLowerCase()))
  let name = base
  let suffix = 2
  while (existing.has(name.toLocaleLowerCase())) name = `${base} (${suffix++})`
  const id = newFolioId()
  state = {
    ...state,
    modules: {
      ...state.modules,
      [moduleKey]: {
        ...wrap,
        activeId: id,
        folios: [...wrap.folios, { id, name, state: nextState, dirty: false }],
      },
    },
  }
  emit({ sliceKey: moduleKey, fieldSig: `folio-op-convert-${++editSeq}` })
  return id
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

/** Fields stripped from each module slice on export (computed results). */
const RESULT_FIELDS = new Set([
  'result', 'results', 'npResult', 'specResult', 'fitResult', 'compareResult',
  'convertResult', 'forecastResult', 'resultProvenance',
  // Decision-grade modeling outputs. Full project snapshots retain these;
  // inputs-only exports omit validation results, executable bytes, and the
  // embedded rebuild dataset.
  'run', 'finalized', 'assets',
])

/** Whether a state key holds computed results (so it is stripped on export and
 *  drives the stale-results indicator). Matches the explicit set above plus any
 *  key ending in "Result"/"Results" (arResult, psResult, cmResult, …). */
function isResultField(key: string): boolean {
  return RESULT_FIELDS.has(key) || /results?$/i.test(key)
}

/** True only when a successful computed output is introduced or replaced.
 * Setting a result to null while editing inputs intentionally does not clear
 * annotations; a failed run therefore cannot destroy user work. */
function hasReplacedComputedOutput(prev: unknown, next: unknown, depth = 0): boolean {
  if (depth > 12 || prev === next || next == null) return false
  if (Array.isArray(next)) {
    const before = Array.isArray(prev) ? prev : []
    return next.some((value, index) =>
      hasReplacedComputedOutput(before[index], value, depth + 1))
  }
  if (typeof next !== 'object') return false
  const before = prev && typeof prev === 'object'
    ? prev as Record<string, unknown> : {}
  for (const [key, value] of Object.entries(next as Record<string, unknown>)) {
    if (isResultField(key) && value != null
        && !(Array.isArray(value) && value.length === 0)
        && before[key] !== value) return true
    if (!isResultField(key)
        && hasReplacedComputedOutput(before[key], value, depth + 1)) return true
  }
  return false
}

function hasRemovedComputedOutput(prev: unknown, next: unknown, depth = 0): boolean {
  if (depth > 12 || prev === next || prev == null) return false
  if (Array.isArray(prev)) {
    const after = Array.isArray(next) ? next : []
    return prev.some((value, index) =>
      hasRemovedComputedOutput(value, after[index], depth + 1))
  }
  if (typeof prev !== 'object') return false
  const after = next && typeof next === 'object'
    ? next as Record<string, unknown> : {}
  for (const [key, value] of Object.entries(prev as Record<string, unknown>)) {
    if (isResultField(key) && value != null
        && !(Array.isArray(value) && value.length === 0)
        && (after[key] == null || (Array.isArray(after[key]) && after[key].length === 0))) {
      return true
    }
    if (!isResultField(key)
        && hasRemovedComputedOutput(value, after[key], depth + 1)) return true
  }
  return false
}

function handleMarkupCalculationTransition(
  moduleKey: string,
  prev: unknown,
  next: unknown,
  analysisId?: string,
) {
  const token = plotScopeToken(moduleKey, analysisId)
  if (hasRemovedComputedOutput(prev, next)) pendingMarkupClearScopes.add(token)
  if (!hasReplacedComputedOutput(prev, next)) return
  queueAnalysisRun(moduleKey, next, analysisId)
  // An initial calculation after reopening a stripped project preserves saved
  // markup. A true re-run (or a run following input invalidation) clears it.
  if (hasComputedResults(prev) || pendingMarkupClearScopes.has(token)) {
    clearPlotMarkupScope(moduleKey, analysisId)
  }
}

function clearMarkupForReplacedResults(moduleKey: string, prev: unknown, next: unknown) {
  if (moduleKey === 'lifeData') {
    const oldFolios = Array.isArray((prev as { folios?: unknown })?.folios)
      ? (prev as { folios: Record<string, unknown>[] }).folios : []
    const newFolios = Array.isArray((next as { folios?: unknown })?.folios)
      ? (next as { folios: Record<string, unknown>[] }).folios : []
    const oldById = new Map(oldFolios.map(folio => [String(folio.id ?? ''), folio]))
    for (const folio of newFolios) {
      const id = String(folio.id ?? '')
      if (id) handleMarkupCalculationTransition('lifeData', oldById.get(id), folio, id)
    }
    return
  }
  handleMarkupCalculationTransition(moduleKey, prev, next)
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

/** Mathematical fingerprints are distinct from persistence/export snapshots:
 * presentation still round-trips through stripResults and ordinary project JSON. */
export function analysisInputSnapshot(value: unknown, moduleKey = '', context?: Pick<ProjectState, 'modules' | 'units'>): unknown {
  const metadata = new Set(['sourceStale', 'sourceStaleReason', 'adoptedCurves', 'mcConvergence',
    'mcRunProvenance', 'ssProvenance', 'fitProvenance'])
  const withoutMetadata = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(withoutMetadata)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .filter(([key]) => !metadata.has(key)).map(([key, child]) => [key, withoutMetadata(child)]))
  }
  const inputs = withoutMetadata(stripResults(value))
  if (!inputs || typeof inputs !== 'object') return inputs
  if (isFolioWrap(inputs)) return { ...inputs, folios: inputs.folios.map(folio => ({
    ...folio, state: analysisInputSnapshot(folio.state, moduleKey, context),
  })) }
  const record = inputs as Record<string, unknown>
  const omit = (object: Record<string, unknown>, keys: Set<string>) =>
    Object.fromEntries(Object.entries(object).filter(([key]) => !keys.has(key)))
  if (moduleKey === 'lifeData' && context) {
    const raw = value as Record<string, unknown>
    if (Array.isArray(raw.folios)) return { ...record, folios: raw.folios.map(folio => analysisInputSnapshot(folio, moduleKey, context)) }
    const folios = (context.modules.lifeData as { folios?: LifeDataModelFolio[] } | undefined)?.folios ?? []
    const owner = raw as unknown as LifeDataModelFolio
    const options = { projectUnit: context.units, engineRevision: engineRevisionFor('lifeData') }
    const resolved: Record<string, unknown> = {}
    const capture = (key: string, calculate: () => string) => {
      try { resolved[key] = { status: 'current', fingerprint: calculate() } }
      catch { resolved[key] = { status: 'unavailable' } }
    }
    if (raw.ssResult != null || raw.ssProvenance != null || raw.ssStressInput || raw.ssStrengthInput) {
      const side = (name: 'stress' | 'strength'): StressStrengthInput => {
        const prefix = name === 'stress' ? 'ssStress' : 'ssStrength'
        if (raw[`${prefix}Input`]) return raw[`${prefix}Input`] as StressStrengthInput
        const parameters = (raw[`${prefix}Params`] ?? {}) as Record<string, string>
        return { mode: raw.ssSource === 'data' ? 'group' : Object.keys(parameters).length ? 'manual' : 'dataset',
          distribution: String(raw[`${prefix}Dist`] ?? 'Normal_2P'), parameters,
          groupId: raw[`${prefix}Group`] as string | undefined,
          quantity: (raw.quantity as DatasetQuantity | undefined) ?? quantityFromProjectUnit(context.units),
          source: name === 'stress' && raw.adoptedDistribution ? { module: 'lifeData', analysisId: owner.id } : undefined }
      }
      capture('stressStrength', () => ssiInputFingerprint([side('stress'), side('strength')], owner, folios, options))
    }
    const spec = raw.spec as Record<string, unknown> | undefined
    if (spec?.mcRunProvenance != null || spec?.mcConvergence != null || spec?.mcMode === 'equation') {
      capture('monteCarlo', () => resolveMcRun(raw as unknown as MonteCarloOwner, folios, options).fingerprint)
    }
    return Object.keys(resolved).length ? { ...record, resolvedSources: resolved } : record
  }
  if (moduleKey === 'faultTree' && Array.isArray(record.nodes) && Array.isArray(record.edges)) {
    return { graph: semanticFtaFingerprint(record as FtaFolio['state']) }
  }
  if (moduleKey === 'markov') return omit(record, new Set([
    'canvasNodes', 'canvasEdges', 'positions', 'annotations', 'stateColors', 'viewport',
    'density', 'layoutOptions', 'snapToGrid', 'nextStateId', 'nextTransitionId',
  ]))
  if (moduleKey === 'system' && Array.isArray(record.nodes) && Array.isArray(record.edges)) {
    const presentation = new Set(['displayDensity','diagramColor','showNodeIds','computedReliability',
      'mirrorCount','blockId','voteId','inputCount','highlighted','validationIssue'])
    return { ...omit(record, new Set(['nodes','edges','annotations','density','layoutOptions',
      'connectorStyle','snapToGrid','showNodeIds','viewport','positions','stateColors','autoFitOnOpen'])),
      nodes: (record.nodes as Record<string, unknown>[]).map(node => ({
        id: node.id, type: node.type, data: omit((node.data ?? {}) as Record<string, unknown>, presentation),
      })),
      edges: (record.edges as Record<string, unknown>[]).map(edge => ({
        id: edge.id, source: edge.source, target: edge.target,
      })),
    }
  }
  if (moduleKey === 'systemDefinition' || moduleKey === 'reliabilityProgram') {
    const project = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(project)
      if (!item || typeof item !== 'object') return item
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .filter(([key]) => key !== 'diagrams' && key !== 'block_diagram')
        .map(([key, child]) => [key, project(child)]))
    }
    return project(record)
  }
  return inputs
}

function extractResults(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(extractResults)
    return items.some(item => item !== undefined) ? items : undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isResultField(key)) out[key] = child
    else {
      const nested = extractResults(child)
      if (nested !== undefined) out[key] = nested
    }
  }
  return Object.keys(out).length ? out : undefined
}

const pendingAnalysisCaptures = new Map<string, number>()

function inferredMethod(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  for (const key of ['method', 'model', 'analysisMode', 'analysisType', 'testType', 'designType', 'distribution']) {
    const candidate = source[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 160)
  }
  return undefined
}

function analysisLabel(moduleKey: string, analysisId: string): string {
  const raw = state.modules[moduleKey]
  if (isFolioWrap(raw)) {
    const folio = raw.folios.find(item => item.id === analysisId)
    if (folio?.name) return folio.name
  }
  if (moduleKey === 'lifeData' && Array.isArray((raw as { folios?: unknown })?.folios)) {
    const folio = ((raw as { folios: Record<string, unknown>[] }).folios)
      .find(item => String(item.id) === analysisId)
    if (folio?.name) return String(folio.name)
  }
  return getActivePlotGroup(plotOwnerForSlice(moduleKey))
    ?? SLICE_DETAIL_LABELS[moduleKey]
    ?? MODULE_LABELS[moduleKey]
    ?? 'Analysis'
}

/** Capture a completed calculation without coupling every analysis component to
 * the assurance implementation. Closely-spaced result writes are coalesced so
 * an async calculation that publishes several output fields becomes one run. */
function queueAnalysisRun(moduleKey: string, completedState: unknown, suppliedAnalysisId?: string) {
  const owner = plotOwnerForSlice(moduleKey)
  const analysisId = suppliedAnalysisId ?? getActiveAnalysisId(owner)
  const scope = `${moduleKey}:${analysisId}`
  const sequence = (pendingAnalysisCaptures.get(scope) ?? 0) + 1
  pendingAnalysisCaptures.set(scope, sequence)
  const snapshot = completedState
  // Resolve dependencies now, before the coalescing timer. Later source edits
  // cannot be silently stamped onto an already completed result.
  const inputSnapshot = analysisInputSnapshot(snapshot, moduleKey, state)
  const projectId = state.identity.projectId
  const revision = state.revision
  const analysisName = analysisLabel(moduleKey, analysisId)
  const sameProject = () => state.identity.projectId === projectId && state.revision === revision
  setTimeout(() => {
    if (pendingAnalysisCaptures.get(scope) !== sequence) return
    pendingAnalysisCaptures.delete(scope)
    if (!sameProject()) return
    const results = extractResults(snapshot)
    if (results === undefined) return
    void createAnalysisRunRecord({
      projectId,
      moduleKey,
      moduleLabel: SLICE_DETAIL_LABELS[moduleKey] ?? MODULE_LABELS[moduleKey] ?? moduleKey,
      analysisId,
      analysisName,
      method: inferredMethod(snapshot),
      engineRevision: engineRevisionFor(moduleKey),
      inputs: inputSnapshot,
      results,
    }).then(record => {
      if (!sameProject()) return
      const latest = [...state.analysisRuns].reverse().find(item =>
        item.moduleKey === moduleKey && item.analysisId === analysisId)
      if (latest?.inputSha256 === record.inputSha256
          && latest.resultSha256 === record.resultSha256
          && latest.engineRevision === record.engineRevision) return
      state = { ...state, analysisRuns: [...state.analysisRuns, record].slice(-MAX_PROVENANCE_RECORDS) }
      emitSystemMetadata()
    }).catch(error => {
      if (!sameProject()) return
      // Calculation results remain usable if the browser cannot provide the
      // hashing primitive, but the missing trace record is never hidden.
      console.warn('Perdura: unable to record analysis provenance.', error)
      toast.error('Analysis completed, but its provenance fingerprint could not be recorded.')
    })
  }, 180)
}

function currentAnalysisState(run: AnalysisRunRecord): unknown {
  const raw = state.modules[run.moduleKey]
  if (isFolioWrap(raw)) return raw.folios.find(item => item.id === run.analysisId)?.state
  if (run.moduleKey === 'lifeData' && Array.isArray((raw as { folios?: unknown })?.folios)) {
    return ((raw as { folios: Record<string, unknown>[] }).folios)
      .find(item => String(item.id) === run.analysisId)
  }
  return raw
}

/** Latest completed run per analysis, suitable for embedding in an export manifest. */
export async function artifactSources(moduleKey?: string, analysisId?: string): Promise<ArtifactSourceRecord[]> {
  const context = state
  const latest = new Map<string, AnalysisRunRecord>()
  for (const run of state.analysisRuns) {
    if (moduleKey && plotOwnerForSlice(run.moduleKey) !== plotOwnerForSlice(moduleKey)) continue
    if (analysisId && run.analysisId !== analysisId) continue
    latest.set(`${run.moduleKey}:${run.analysisId}`, run)
  }
  return Promise.all(Array.from(latest.values()).map(async run => {
    const currentState = currentAnalysisState(run)
    const current = currentState !== undefined
      && await hashCanonicalJson(analysisInputSnapshot(currentState, run.moduleKey, context)) === run.inputSha256
    return {
      runId: run.runId,
      moduleKey: run.moduleKey,
      analysisId: run.analysisId,
      analysisName: run.analysisName,
      fingerprintSha256: run.fingerprintSha256,
      inputSha256: run.inputSha256,
      resultSha256: run.resultSha256,
      engineRevision: run.engineRevision,
      current,
    }
  }))
}

/**
 * Rescale all time-valued inputs across modules when the project units change
 * (e.g. hours → days). Walks the per-module field registry, handling the three
 * container shapes (folio-wrapped modules, the lifeData folios array, and flat
 * slices). Computed results are stripped so nothing is left in stale,
 * pre-conversion units. Does NOT set the units value itself — the caller does.
 */
export function convertProjectUnits(from: string, to: string) {
  flushProjectEditors()
  const modules = { ...state.modules }
  for (const [key, rules] of Object.entries(UNIT_RULES)) {
    // Explicit dataset units and hour-valued Prediction settings are owned by
    // their modules. A project display-unit change must retain their results.
    if (rules.length === 0) continue
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
  // Source annotations use data coordinates. Clearing them avoids silently
  // leaving callouts attached to values expressed in the previous unit system.
  delete modules[PLOT_MARKUP_SLICE]
  pendingMarkupClearScopes.clear()
  state = { ...state, modules }
  emit()
}

export interface ExportPayload {
  app: string
  subtitle: string
  website: string
  schemaVersion: number
  createdWith: {
    version: string
    commit: string
    builtAt: string
  }
  engineRevisions: Record<string, number>
  project: string
  units?: string
  exported: string
  identity: ProjectIdentity
  analysisRuns: AnalysisRunRecord[]
  exportLedger: ExportLedgerEntry[]
  modules: Record<string, unknown>
}

export function buildExport(moduleKeys?: string[], includeResults = false): ExportPayload {
  flushProjectEditors()
  const keys = [...new Set((moduleKeys ?? Object.keys(state.modules)).flatMap(key => key === 'prediction' ? ['prediction', 'systemDefinition'] : [key]))]
  const modules: Record<string, unknown> = {}
  for (const k of keys) {
    if (state.modules[k] === undefined) continue
    // Default is inputs-only (results recompute on open). With includeResults the
    // slice is copied verbatim so a full snapshot (fit outputs, plot data, …) is saved.
    modules[k] = includeResults ? state.modules[k] : stripResults(state.modules[k])
  }
  if (moduleKeys && state.modules[PLOT_MARKUP_SLICE]) {
    const owners = new Set(moduleKeys.map(plotOwnerForSlice).map(cleanPlotKeyPart))
    const selected = Object.fromEntries(Object.entries(plotMarkupMap()).filter(([key]) =>
      owners.has(key.split(':', 1)[0])))
    if (Object.keys(selected).length > 0) modules[PLOT_MARKUP_SLICE] = selected
  }
  return projectExportEnvelope(normalizeProjectModules(modules))
}

function projectExportEnvelope(modules: Record<string, unknown>): ExportPayload {
  return {
    app: PROJECT_FILE_TYPE,
    subtitle: APP_SUBTITLE,
    website: APP_WEBSITE,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    createdWith: {
      version: APP_VERSION,
      commit: APP_COMMIT,
      builtAt: BUILD_TIMESTAMP,
    },
    engineRevisions: Object.fromEntries(
      Object.keys(modules)
        .filter(key => key !== PLOT_MARKUP_SLICE)
        .map(key => [key, engineRevisionFor(key)]),
    ),
    project: state.projectName,
    units: state.units,
    exported: new Date().toISOString(),
    identity: state.identity,
    analysisRuns: state.analysisRuns,
    exportLedger: state.exportLedger,
    modules,
  }
}

/** Recovery deliberately bypasses model normalization, editor flushing and
 * analytical provenance: malformed source documents must remain recoverable. */
export function buildRecoveryExport() {
  return { ...projectExportEnvelope(state.modules), recovery: {
    status: 'unvalidated' as const,
    message: persistenceError ?? startupNotice ?? 'Original browser data retained for repair.',
  } }
}

export async function downloadRecoveryExport(): Promise<void> {
  const payload = buildRecoveryExport()
  const filename = `${(payload.project || 'project').replace(/[^\w.-]+/g, '_')}-recovery.json`
  const { downloadRecoveryArtifact } = await import('./artifactExport')
  downloadRecoveryArtifact(JSON.stringify(payload, null, 2) + '\n', filename)
}

export async function downloadExport(moduleKeys?: string[], filename?: string, includeResults = false) {
  const payload = buildExport(moduleKeys, includeResults)
  const base = (payload.project || 'project').replace(/[^\w.-]+/g, '_')
  const exportFilename = filename ?? (moduleKeys && moduleKeys.length === 1
    ? `${base}_${moduleKeys[0]}.json`
    : `${base}.json`)
  const { downloadArtifact } = await import('./artifactExport')
  await downloadArtifact(JSON.stringify(payload, null, 2) + '\n', exportFilename, 'application/json', {
    kind: moduleKeys?.length === 1 ? 'module-project-export' : 'project-export',
    title: payload.project,
    moduleKey: moduleKeys?.length === 1 ? moduleKeys[0] : undefined,
  })
}

/**
 * Import a payload. If `onlyModule` is given, only that module's slice is
 * applied; otherwise every module present in the file is applied and (for
 * full-project files) the project name is adopted.
 */
export function importPayload(payload: ExportPayload, onlyModule?: string):
    { applied: string[]; recalculationRequired: string[] } {
  if (!payload || payload.app !== PROJECT_FILE_TYPE || !payload.modules) {
    throw new Error('Not a valid Perdura project export file.')
  }
  if (![6, 7, PROJECT_SCHEMA_VERSION].includes(payload.schemaVersion)) {
    const found = Number.isInteger(payload.schemaVersion)
      ? String(payload.schemaVersion) : 'missing'
    throw new Error(
      `Unsupported project schema ${found}. This Perdura build accepts schemas 6, 7 `
      + `or ${PROJECT_SCHEMA_VERSION}; the file was not imported.`,
    )
  }
  if (payload.subtitle !== APP_SUBTITLE || payload.website !== APP_WEBSITE
      || !payload.createdWith || typeof payload.createdWith.version !== 'string'
      || !payload.engineRevisions || typeof payload.engineRevisions !== 'object'
      || !payload.identity || typeof payload.identity.projectId !== 'string'
      || !Array.isArray(payload.analysisRuns) || !Array.isArray(payload.exportLedger)) {
    throw new Error(`Project schema ${PROJECT_SCHEMA_VERSION} metadata is incomplete; the file was not imported.`)
  }
  const keys = onlyModule
    ? [
        ...moduleSlices(onlyModule).filter(k => payload.modules[k] !== undefined),
        ...(payload.modules[PLOT_MARKUP_SLICE] ? [PLOT_MARKUP_SLICE] : []),
      ]
    : Object.keys(payload.modules)
  // A scenario never supplies its own physical hierarchy. Keep both slices
  // together, and never replace another populated project's canonical system
  // as an incidental consequence of a module-scoped import.
  if (keys.includes('prediction') && payload.modules.systemDefinition === undefined)
    throw new Error('Prediction import requires its canonical System Definition companion.')
  if (keys.includes('systemDefinition')) {
    const incoming = normalizeSharedSystemModules({ systemDefinition: payload.modules.systemDefinition,
      ...(keys.includes('prediction') ? { prediction: payload.modules.prediction } : {}) })
    if (onlyModule && state.modules.systemDefinition) {
      const before = state.modules.systemDefinition as { model: SystemDefinitionModel }
      const after = incoming.systemDefinition as { model: SystemDefinitionModel }
      const blank = before.model.instances.length === 1 && Object.keys(state.modules)
        .every(key => key === 'systemDefinition' || key === PLOT_MARKUP_SLICE)
      if (!blank && systemInputFingerprint(before.model) !== systemInputFingerprint(after.model))
        throw new Error('The imported scenario belongs to a different shared system. Open the whole project or import into a new blank project; the current system was not changed.')
    }
  }
  if (keys.includes('faultTree')) validateFtaIdentities(payload.modules.faultTree)
  if (keys.length === 0) {
    throw new Error(onlyModule
      ? `File contains no data for module '${MODULE_LABELS[onlyModule] ?? onlyModule}'.`
      : 'File contains no module data.')
  }
  const modules: Record<string, unknown> = onlyModule ? { ...state.modules } : {}
  const recalculationRequired: string[] = []
  const selectedMarkupOwner = onlyModule
    ? cleanPlotKeyPart(plotOwnerForSlice(onlyModule)) : null
  // Replacing module inputs invalidates its old coordinate-based markup even
  // when the incoming file contains no annotations. A full-project import
  // likewise must not retain markup from the project it replaces.
  if (selectedMarkupOwner) {
    modules[PLOT_MARKUP_SLICE] = Object.fromEntries(
      Object.entries(plotMarkupMap()).filter(([key]) =>
        key.split(':', 1)[0] !== selectedMarkupOwner),
    )
    for (const token of pendingMarkupClearScopes) {
      if (token.startsWith(`${selectedMarkupOwner}:`)) {
        pendingMarkupClearScopes.delete(token)
      }
    }
  } else {
    delete modules[PLOT_MARKUP_SLICE]
    pendingMarkupClearScopes.clear()
  }
  for (const k of keys) {
    let incoming = payload.modules[k]
    if (k === PLOT_MARKUP_SLICE) {
      const clean = Object.fromEntries(Object.entries(
        sanitizePlotMarkupRecord(incoming),
      ).filter(([key]) => !selectedMarkupOwner
        || key.split(':', 1)[0] === selectedMarkupOwner))
      // Coordinates from a differently-scaled unit system cannot safely be
      // reused after inputs are converted during a module-scoped import.
      const convertedUnits = !!(onlyModule && payload.units
        && payload.units !== state.units)
      modules[k] = onlyModule
        ? {
            ...((modules[k] as Record<string, PlotMarkup> | undefined) ?? {}),
            ...(convertedUnits ? {} : clean),
          }
        : clean
      continue
    }
    if (payload.engineRevisions[k] !== engineRevisionFor(k) && hasComputedResults(incoming)) {
      if (k === 'faultTree') {
        const historical = normalizeFtaLibrary(incoming)
        incoming = { _folioWrap: true, activeId: historical.activeId,
          folios: historical.folios.map(folio => ({ ...folio, dirty: true })) }
      } else incoming = stripResults(incoming)
      recalculationRequired.push(SLICE_DETAIL_LABELS[k] ?? MODULE_LABELS[k] ?? k)
    }
    const sourceUnits = payload.units
    const rules = UNIT_RULES[k]
    if (onlyModule && sourceUnits && sourceUnits !== state.units && rules?.length) {
      if (!sameGroup(sourceUnits, state.units)) {
        throw new Error(
          `Module data uses ${sourceUnits}, which cannot be converted to this project's ${state.units}. `
          + 'Change the project units or import into a new project.',
        )
      }
      const convert = (value: unknown) => stripResults(
        convertStateObject(value, rules, sourceUnits, state.units),
      )
      if (isFolioWrap(incoming)) {
        incoming = {
          ...incoming,
          folios: incoming.folios.map(folio => ({ ...folio, state: convert(folio.state), dirty: false })),
        }
      } else if (Array.isArray((incoming as { folios?: unknown } | null)?.folios)) {
        const lifeData = incoming as { folios: unknown[] }
        incoming = { ...lifeData, folios: lifeData.folios.map(convert) }
      } else {
        incoming = convert(incoming)
      }
    }
    modules[k] = incoming
  }
  clearRuntimePlotAssets()
  state = {
    projectName: !onlyModule && payload.project ? payload.project : state.projectName,
    identity: !onlyModule ? cleanIdentity(payload.identity) : state.identity,
    analysisRuns: !onlyModule ? cleanAnalysisRuns(payload.analysisRuns) : state.analysisRuns,
    exportLedger: !onlyModule ? cleanExportLedger(payload.exportLedger) : state.exportLedger,
    units: !onlyModule && payload.units ? payload.units : state.units,
    lastSavedAt: onlyModule ? state.lastSavedAt ?? null : null,
    revision: state.revision + 1,
    modules: normalizeProjectModules(modules),
  }
  emit()
  if (recalculationRequired.length) {
    toast.info(
      `Recalculate ${recalculationRequired.join(', ')} because their calculation engine revision differs. `
      + 'FTA results are retained as historical; other affected results were removed.',
    )
  }
  // A full-project import matches the source file, so treat it as a clean
  // baseline; a module-scoped import edits the current project, so keep dirty.
  if (!onlyModule) { clearHistory(); clearDirty() }
  return { applied: keys, recalculationRequired }
}

export function newProject(name = 'Untitled Project') {
  clearRuntimePlotAssets()
  pendingMarkupClearScopes.clear()
  state = {
    projectName: name,
    identity: newProjectIdentity(),
    analysisRuns: [],
    exportLedger: [],
    units: 'hours',
    lastSavedAt: null,
    revision: state.revision + 1,
    modules: {},
  }
  emit()
  clearHistory()   // a new project is a fresh undo baseline
  clearDirty()
}

export function clearAllModules() {
  clearRuntimePlotAssets()
  pendingMarkupClearScopes.clear()
  state = { ...state, analysisRuns: [], revision: state.revision + 1, modules: {} }
  emit()
}

// ---------------------------------------------------------------------------
// Named projects — save/open multiple projects in localStorage
// ---------------------------------------------------------------------------

const PROJECTS_KEY = `${PROJECT_STORAGE_NAMESPACE}:projects`
const PROJECTS_BACKUP_KEY = `${PROJECT_STORAGE_NAMESPACE}:projects-backup`
const RECENT_PROJECTS_KEY = `${PROJECT_STORAGE_NAMESPACE}:recent-projects`
const PREVIOUS_PROJECTS_KEY = 'perdura:project-schema:7:projects'
const OLDER_PROJECTS_KEY = 'perdura:project-schema:6:projects'
const PREVIOUS_PROJECTS_BACKUP_KEY = 'perdura:project-schema:7:projects-backup'
const OLDER_PROJECTS_BACKUP_KEY = 'perdura:project-schema:6:projects-backup'
const PREVIOUS_RECENT_PROJECTS_KEY = 'perdura:project-schema:7:recent-projects'
const LEGACY_PROJECTS_KEY = 'reliability-suite-projects'
const LEGACY_PROJECTS_BACKUP_KEY = 'reliability-suite-projects-backup'
const LEGACY_RECENT_PROJECTS_KEY = 'reliability-suite-recent-projects'
const MAX_RECENT_PROJECTS = 5

interface SavedProject {
  name: string
  savedAt: string
  units: string
  identity?: ProjectIdentity
  analysisRuns?: AnalysisRunRecord[]
  exportLedger?: ExportLedgerEntry[]
  modules: Record<string, unknown>
}

export interface SavedProjectListItem {
  name: string
  savedAt: string
}

export interface RecentProjectListItem extends SavedProjectListItem {
  openedAt: string
}

interface RecentProjectRecord {
  name: string
  openedAt: string
}

let projectsRecoveryNotified = false

// Cache only parsing, keyed by the complete stored bytes. Every read still
// checks storage, so writes in another tab, migrations and backup recovery are
// observed without relying on an event arriving first. Two entries bound the
// cache to the current primary and mirror; callers must not mutate the map.
const parsedProjectsCache = new Map<string, Record<string, SavedProject> | null>()

function parseProjects(raw: string | null): Record<string, SavedProject> | null {
  if (!raw) return null
  if (parsedProjectsCache.has(raw)) return parsedProjectsCache.get(raw) ?? null
  let result: Record<string, SavedProject> | null = null
  try {
    const map = JSON.parse(raw)
    result = map && typeof map === 'object' ? map as Record<string, SavedProject> : null
  } catch { /* invalid bytes can be cached as well */ }
  if (parsedProjectsCache.size >= 2) parsedProjectsCache.delete(parsedProjectsCache.keys().next().value!)
  parsedProjectsCache.set(raw, result)
  return result
}

function readLegacyProjectsMap(): Record<string, SavedProject> {
  let raw: string | null = null
  try { raw = localStorage.getItem(PROJECTS_KEY) } catch { return {} }
  let migratedLegacy = false
  if (!raw) {
    try {
      raw = localStorage.getItem(PREVIOUS_PROJECTS_KEY)
        ?? localStorage.getItem(OLDER_PROJECTS_KEY)
        ?? localStorage.getItem(LEGACY_PROJECTS_KEY)
      migratedLegacy = Boolean(raw)
    } catch { return {} }
  }
  const primary = parseProjects(raw)
  if (primary) {
    return primary
  }
  if (raw) {
    // The saved-projects list is present but corrupt — recover from the mirror
    // rather than silently reporting zero saved projects.
    let backupRaw: string | null = null
    try { backupRaw = localStorage.getItem(PROJECTS_BACKUP_KEY) } catch { backupRaw = null }
    if (!backupRaw && migratedLegacy) {
      try {
        backupRaw = localStorage.getItem(PREVIOUS_PROJECTS_BACKUP_KEY)
          ?? localStorage.getItem(LEGACY_PROJECTS_BACKUP_KEY)
      } catch { backupRaw = null }
    }
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

/** Small in-memory metadata cache; the editor never reads all named project bodies. */
export async function refreshSavedProjects(): Promise<void> {
  const summaries = await persistence.list()
  namedProjectCache.clear()
  for (const row of summaries) namedProjectCache.set(row.name, { name: row.name, savedAt: row.savedAt })
}
export function projectExists(name: string): boolean { return namedProjectCache.has(name.trim()) }
export function listSavedProjects(): SavedProjectListItem[] {
  return [...namedProjectCache.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

function readRecentProjects(): RecentProjectRecord[] {
  try {
    const current = localStorage.getItem(RECENT_PROJECTS_KEY)
    const legacy = current == null
      ? localStorage.getItem(PREVIOUS_RECENT_PROJECTS_KEY)
        ?? localStorage.getItem(LEGACY_RECENT_PROJECTS_KEY)
      : null
    const parsed = JSON.parse(current ?? legacy ?? '[]')
    if (!Array.isArray(parsed)) return []
    const records = parsed.filter(item => item && typeof item === 'object'
      && typeof item.name === 'string' && typeof item.openedAt === 'string')
    if (current == null && legacy != null) writeRecentProjects(records)
    return records
  } catch {
    return []
  }
}

function writeRecentProjects(recent: RecentProjectRecord[]) {
  try { localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recent)) } catch { /* optional convenience */ }
}

function recordRecentProject(name: string) {
  const next = [
    { name, openedAt: new Date().toISOString() },
    ...readRecentProjects().filter(item => item.name !== name),
  ].slice(0, MAX_RECENT_PROJECTS)
  writeRecentProjects(next)
}

/** Recently opened saved projects, newest first. Deleted projects are pruned. */
export function listRecentProjects(): RecentProjectListItem[] {
  const stored = readRecentProjects()
  const recent = stored.filter(item => namedProjectCache.has(item.name))
  if (recent.length !== stored.length) writeRecentProjects(recent)
  return recent.map(item => ({
    ...item,
    savedAt: namedProjectCache.get(item.name)?.savedAt ?? '',
  }))
}

let pendingNamedSaves = 0
async function writeCurrentProject(name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (!trimmed) return false
  flushProjectEditors()
  const current = state
  const generation = saveGeneration
  const savedAt = new Date().toISOString()
  const snapshot = { ...projectSnapshot(current), projectName: trimmed, lastSavedAt: savedAt }
  pendingNamedSaves++
  pendingPersistence++
  notify()
  try {
    if (!storageReady) throw new Error('Browser project storage is not ready. Export your project to preserve your work.')
    if (!observedNamedProjects.has(trimmed)) {
      await persistence.read(`named:${trimmed}`)
      observedNamedProjects.add(trimmed)
    }
    await persistence.save(`named:${trimmed}`, snapshot)
    namedProjectCache.set(trimmed, { name: trimmed, savedAt })
    if (state.identity.projectId === current.identity.projectId && state.revision === current.revision) {
      state = { ...state, projectName: state.projectName === current.projectName ? trimmed : state.projectName, lastSavedAt: savedAt }
      if (generation === saveGeneration) clearDirty()
      persist()
    }
    persistenceError = null
    return true
  } catch (error) {
    persistenceError = error instanceof Error ? error.message : 'Browser save failed.'
    notifySaveError(error)
    return false
  } finally { pendingNamedSaves--; pendingPersistence--; notify() }
}

export async function saveNamedProject(name: string): Promise<boolean> {
  return writeCurrentProject(name)
}

export async function openNamedProject(name: string): Promise<boolean> {
  flushProjectEditors()
  const generation = saveGeneration
  const projectId = state.identity.projectId
  try {
    const p = await persistence.read(`named:${name}`)
    if (!p) return false
    if (generation !== saveGeneration || projectId !== state.identity.projectId) {
      throw new Error('The current project changed while opening another project. Retry after saving your edits.')
    }
    observedNamedProjects.add(name)
    clearRuntimePlotAssets()
    pendingMarkupClearScopes.clear()
    state = {
      ...p, identity: cleanIdentity(p.identity),
      analysisRuns: cleanAnalysisRuns(p.analysisRuns), exportLedger: cleanExportLedger(p.exportLedger),
      modules: normalizeProjectModules(sanitizeMarkupModule(p.modules)), revision: state.revision + 1,
    }
    emit()
    clearHistory()
    clearDirty()
    recordRecentProject(p.projectName)
    return true
  } catch (error) { notifySaveError(error); return false }
}

export async function deleteNamedProject(name: string): Promise<boolean> {
  try {
    await persistence.remove(`named:${name}`)
    namedProjectCache.delete(name)
    observedNamedProjects.delete(name)
    writeRecentProjects(readRecentProjects().filter(item => item.name !== name))
    return true
  } catch (error) { notifySaveError(error); return false }
}

/** Name of the always-available bundled sample project shown under "Examples"
 *  in the Open menu. */
export const DEMO_PROJECT_NAME = 'Perdura Demo Project'

/** Load the bundled demo project into the current session (a full import). It is
 *  not written to the saved-projects map, so autosave never persists over it —
 *  edits stay session-only until the user explicitly saves under a new name. The
 *  JSON is dynamically imported so it stays out of the main bundle. */
export async function openDemoProject(): Promise<boolean> {
  try {
    const demo = (await import('../data/demoProject.json')).default as unknown as ExportPayload
    importPayload(demo)
    clearDirty()
    return true
  } catch {
    return false
  }
}

/** Apply the reviewed, results-bearing patch for one website capture. */
export async function applyWebsiteShowcaseFixture(captureId: string): Promise<boolean> {
  try {
    const response = await fetch(`/website-showcase/${encodeURIComponent(captureId)}.json`)
    if (!response.ok) throw new Error(`Showcase fixture ${captureId} is unavailable`)
    const patch = await response.json() as ExportPayload
    // Showcase fixtures deliberately contain only changed slices. Make their
    // merge explicit before using the ordinary full-project replacement path.
    const baseline = buildExport(undefined, true)
    importPayload({
      ...patch,
      engineRevisions: {
        ...baseline.engineRevisions,
        ...Object.fromEntries(Object.keys(patch.modules).map(key => [key, patch.engineRevisions[key]])),
      },
      modules: { ...baseline.modules, ...patch.modules },
    })
    clearDirty()
    return true
  } catch {
    return false
  }
}

export async function readJSONFile(file: File): Promise<ExportPayload> {
  try {
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      const { unzipSync } = await import('fflate')
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const manifestName = Object.keys(archive).find(name => name.endsWith('.perdura.json'))
      if (!manifestName) throw new Error('Verification package has no Perdura manifest.')
      const manifest = JSON.parse(new TextDecoder().decode(archive[manifestName])) as ArtifactManifest
      if (manifest.artifact.mediaType !== 'application/json') {
        throw new Error('Verification package does not contain a project JSON artifact.')
      }
      const artifactName = Object.keys(archive).find(name =>
        name !== manifestName && (name === manifest.artifact.filename
          || name.endsWith(`/${manifest.artifact.filename}`)))
      if (!artifactName) throw new Error('Verification package is missing its declared project artifact.')
      const verified = await verifyArtifactBytes(archive[artifactName], manifest)
      if (!verified.valid) throw new Error(`Verification package failed integrity checks: ${verified.issues.join(' ')}`)
      return JSON.parse(new TextDecoder().decode(archive[artifactName])) as ExportPayload
    }
    return JSON.parse(await file.text()) as ExportPayload
  } catch (error) {
    if (error instanceof Error && /Verification package/.test(error.message)) throw error
    throw new Error('File is not valid project JSON or a valid Perdura verification package.')
  }
}
