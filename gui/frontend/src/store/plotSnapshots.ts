import {
  getProjectState,
  setModuleState,
} from './project'
import {
  canonicalJson,
  hashCanonicalJson,
  newTraceId,
  softwareIdentity,
  type SoftwareIdentity,
} from './provenance'
import {
  splitUserMarkupFromLayout,
  type PlotMarkup,
} from './plotMarkup'

export const PLOT_SNAPSHOT_SCHEMA = 'perdura.plot-snapshot/v1' as const

export interface PlotSnapshotSource {
  module: string
  moduleLabel: string
  analysisId: string
  analysisName: string
  plotId: string
  assetKey?: string
  runId?: string
  runFingerprintSha256?: string
}

export interface PlotSnapshot {
  schema: typeof PLOT_SNAPSHOT_SCHEMA
  id: string
  name: string
  capturedAt: string
  plotData: unknown[]
  plotLayout: Record<string, unknown>
  plotMarkup: PlotMarkup
  sizeBytes: number
  figureSha256: string
  projectId: string
  source: PlotSnapshotSource
  software: SoftwareIdentity
}

interface ReportBuilderSnapshotHost {
  reports?: unknown[]
  activeReportId?: string
  plotSnapshots?: unknown
  [key: string]: unknown
}

const text = (value: unknown, fallback: string, max = 300) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : fallback

/** Imported project data is untrusted; expose only structurally valid records. */
export function sanitizePlotSnapshots(value: unknown): PlotSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.filter((raw): raw is PlotSnapshot => {
    if (!raw || typeof raw !== 'object') return false
    const item = raw as Partial<PlotSnapshot>
    return item.schema === PLOT_SNAPSHOT_SCHEMA
      && typeof item.id === 'string'
      && typeof item.name === 'string'
      && typeof item.capturedAt === 'string'
      && Array.isArray(item.plotData)
      && !!item.plotLayout && typeof item.plotLayout === 'object'
      && !!item.plotMarkup && typeof item.plotMarkup === 'object'
      && typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes)
      && typeof item.figureSha256 === 'string' && /^[0-9a-f]{64}$/i.test(item.figureSha256)
      && !!item.source && typeof item.source === 'object'
  })
}

function normalizeLayout(layout: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...layout }
  // Keep the visible view (axis ranges, legend position, scene camera, etc.)
  // while allowing the snapshot to resize cleanly inside a report block.
  delete normalized.width
  delete normalized.height
  delete normalized.uirevision
  delete normalized.editrevision
  delete normalized.datarevision
  delete normalized.selectionrevision
  delete normalized.dragmode
  delete normalized.newshape
  normalized.autosize = true
  return normalized
}

export async function createPlotSnapshot(args: {
  name: string
  plotData: unknown[]
  plotLayout: unknown
  source: Omit<PlotSnapshotSource, 'runId' | 'runFingerprintSha256'>
  capturedAt?: string
}): Promise<PlotSnapshot> {
  if (!Array.isArray(args.plotData)) throw new TypeError('The plot does not contain serializable trace data.')
  const separated = splitUserMarkupFromLayout(args.plotLayout)
  const figure = {
    plotData: args.plotData,
    plotLayout: normalizeLayout(separated.layout),
    plotMarkup: separated.markup,
  }
  // Canonical JSON both validates finite/cyclic input and creates a detached,
  // JSON-safe copy so later Plotly mutations cannot change the saved snapshot.
  const serialized = canonicalJson(figure)
  const detached = JSON.parse(serialized) as typeof figure
  const project = getProjectState()
  const run = [...project.analysisRuns].reverse().find(item =>
    item.moduleKey === args.source.module && item.analysisId === args.source.analysisId)
  return {
    schema: PLOT_SNAPSHOT_SCHEMA,
    id: newTraceId('plotsnap'),
    name: text(args.name, 'Plot Snapshot'),
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    ...detached,
    sizeBytes: new TextEncoder().encode(serialized).byteLength,
    figureSha256: await hashCanonicalJson(detached),
    projectId: project.identity.projectId,
    source: {
      ...args.source,
      module: text(args.source.module, 'unscoped', 100),
      moduleLabel: text(args.source.moduleLabel, 'Analysis', 200),
      analysisId: text(args.source.analysisId, 'default', 200),
      analysisName: text(args.source.analysisName, 'Default', 300),
      plotId: text(args.source.plotId, 'plot', 300),
      ...(run ? { runId: run.runId, runFingerprintSha256: run.fingerprintSha256 } : {}),
    },
    software: softwareIdentity(),
  }
}

/** Append after hashing, merging against the latest state to avoid clobbering
 * report edits made while a large figure was being serialized. */
export function storePlotSnapshot(snapshot: PlotSnapshot) {
  const project = getProjectState()
  if (project.identity.projectId !== snapshot.projectId) {
    throw new Error('The active project changed before the snapshot finished; capture it again in the intended project.')
  }
  const raw = project.modules.reportBuilder
  const current = raw && typeof raw === 'object'
    ? raw as ReportBuilderSnapshotHost : {}
  const existing = sanitizePlotSnapshots(current.plotSnapshots)
  if (Array.isArray(current.reports) && typeof current.activeReportId === 'string') {
    setModuleState('reportBuilder', {
      ...current,
      plotSnapshots: [snapshot, ...existing],
    })
    return
  }

  // A chart can be captured before Report Builder has ever mounted. Create a
  // valid empty report shell so opening the module later remains seamless.
  const reportId = newTraceId('rpt')
  setModuleState('reportBuilder', {
    ...current,
    reports: [{
      id: reportId,
      title: 'Untitled Report',
      blocks: [],
      pageFormat: { orientation: 'portrait', pageSize: 'a4', margin: 15 },
    }],
    activeReportId: reportId,
    plotSnapshots: [snapshot, ...existing],
  })
}
