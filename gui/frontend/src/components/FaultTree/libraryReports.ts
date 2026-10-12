import { captureProjectExportOrigin, assertProjectExportOrigin } from '../../store/exportSnapshot'
import { mergePlotMarkup, sanitizePlotMarkup, type PlotMarkup } from '../../store/plotMarkup'
import { CURRENT_ENGINE_REVISIONS } from '../../version'
import Papa from 'papaparse'
import { extractFaultTreeAssets } from '../../store/assetExtractors'
import { artifactSources, buildExport, getProjectState, getPlotMarkupForAsset, setModuleState, type ExportPayload } from '../../store/project'
import { downloadArtifact } from '../../store/artifactExport'
import type { AssetDescriptor } from '../../store/reportAssets'
import type { ReportBlock, SingleReport } from '../ReportBuilder'
import { buildFtaReferenceIndex, collectFtaClosure, ftaResultFreshness, normalizeFtaLibrary,
  type FtaFolio, type FtaLibraryCatalog, type FtaReferenceGroup, type FtaTreeState } from './libraryModel'

export type FtaReportScope = 'tree' | 'branch' | 'selected' | 'all'
export interface FtaLibraryReportOptions {
  folios: readonly FtaFolio[]; catalog: FtaLibraryCatalog; treeIds: readonly string[]
  scope: FtaReportScope; units: string
  /** Saved presentation copied at request time; never read after asynchronous rendering starts. */
  plotMarkupByTreeId?: Record<string, PlotMarkup>
}
export interface FtaPackageProgress { done: number; total: number; label: string }
export interface FtaAssetFailure { treeId: string; asset: string; error: string }
export interface FtaPackageResult {
  complete: boolean; trees: number; files: number; failedAssets: FtaAssetFailure[]; warnings: string[]
}
const json = (value: unknown) => JSON.stringify(value, null, 2)
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const encode = (value: string) => new TextEncoder().encode(value)
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100) || 'tree'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const uid = () => `fta-report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
const registerHeaders = ['Indenture', 'Code', 'Tree', 'Tree ID', 'Parent ID', 'Transfers', 'Reference modes', 'Detail section', 'Entry']
const referenceHeaders = ['Parent tree ID', 'Target tree ID', 'Transfer node ID', 'Reference mode', 'Placed', 'Ordered gate placements']

function captureReportOptions(options: FtaLibraryReportOptions): FtaLibraryReportOptions {
  return clone({ ...options, plotMarkupByTreeId: options.plotMarkupByTreeId ?? Object.fromEntries(options.folios.map(tree =>
    [tree.id, getPlotMarkupForAsset('faultTree', tree.name, 'fta-top-event-time', tree.id)])) })
}

export function ftaAssetReportBlock(asset: AssetDescriptor, capturedAt: string): ReportBlock {
  const data = asset.getData()
  const origin = { id: asset.id, assetId: asset.id, source: asset.source, sourceCapturedAt: capturedAt,
    sourceKind: 'snapshot' as const, label: `${asset.group} — ${asset.label}` }
  if (asset.type === 'plot' && data.plotData) return { ...origin, type: 'plot', plotData: data.plotData, plotLayout: data.plotLayout }
  if (asset.type === 'table' && data.tableHeaders) return { ...origin, type: 'table', headers: data.tableHeaders, rows: data.tableRows ?? [] }
  if (asset.type === 'metrics' && data.metrics) return { ...origin, type: 'metrics', items: data.metrics }
  if (asset.type === 'diagram' && data.diagramState) return { ...origin, type: 'diagram', diagramState: data.diagramState,
    showResults: data.diagramShowResults, treeNames: data.diagramTreeNames }
  throw new Error(`Missing ${asset.type} data: ${asset.label}`)
}

/** Immutable report snapshot: O(trees + references), never expands a shared DAG exponentially. */
export function buildFtaLibraryReport(options: FtaLibraryReportOptions) {
  const snapshot = clone(options)
  const normalized = normalizeFtaLibrary(snapshot.folios, snapshot.catalog)
  const index = buildFtaReferenceIndex(normalized.folios)
  const requestedIds = snapshot.scope === 'all' ? [...index.trees.keys()] : [...new Set(snapshot.treeIds)]
  if (!requestedIds.length) throw new Error('Select at least one fault tree to report.')
  const closure = collectFtaClosure(index, requestedIds)
  const folios = closure.treeIds.flatMap(id => index.trees.has(id) ? [index.trees.get(id)!] : [])
  const catalog: FtaLibraryCatalog = { schemaVersion: 1, byTreeId: Object.fromEntries(folios.map(tree =>
    [tree.id, normalized.catalog.byTreeId[tree.id]])) }
  const selectedIds = new Set(closure.treeIds)
  const capturedAt = new Date().toISOString()
  const sections = new Map(folios.map((folio, ordinal) => [folio.id, `${ordinal + 1}`]))
  const register: (string | number)[][] = []
  const visited = new Set<string>()
  const append = (treeId: string, occurrence: string, parentId = '', via?: FtaReferenceGroup) => {
    const depth = occurrence.split('.').length - 1
    const tree = index.trees.get(treeId)
    const repeated = visited.has(treeId)
    register.push([occurrence, catalog.byTreeId[treeId]?.code ?? 'MISSING',
      `${'  '.repeat(depth)}${tree?.name ?? 'Missing transfer target'}`, treeId, parentId,
      via?.references.length ?? 0, [...new Set(via?.references.map(ref => ref.mode) ?? [])].join(', '),
      sections.get(treeId) ?? 'Missing', !tree ? 'Unresolved reference' : repeated ? 'Cross-reference; detailed once' : 'Detailed tree'])
    if (!tree || repeated) return
    visited.add(treeId)
    for (const [ordinal, group] of (index.children.get(treeId) ?? []).entries()) append(group.targetId, `${occurrence}.${ordinal + 1}`, treeId, group)
  }
  // Root-first traversal retains the meaningful hierarchy in a whole-library export.
  const roots = snapshot.scope === 'all' ? [...index.roots, ...index.issueRoots] : requestedIds
  roots.forEach((id, ordinal) => append(id, String(ordinal + 1)))
  let rootOrdinal = roots.length
  for (const id of closure.treeIds) if (!visited.has(id)) append(id, String(++rootOrdinal))
  const references = index.references.filter(ref => selectedIds.has(ref.parentId))
  const referenceRows = references.map(ref => [ref.parentId, ref.targetId, ref.transferId, ref.mode,
    ref.placed ? 'Yes' : 'No', json(ref.placements)])
  const contexts = folios.map(tree => ({ treeId: tree.id, treeName: tree.name,
    ...ftaResultFreshness(index, tree.id, CURRENT_ENGINE_REVISIONS.faultTree), evaluationContext: 'Standalone root with full Transfer dependency closure',
    provenance: tree.state.resultProvenance ?? null }))
  const warnings = [
    ...closure.issues.map(issue => `${issue.treeId}: ${issue.message}`),
    ...closure.missingTargets.map(id => `Missing requested or referenced tree: ${id}`),
    ...contexts.filter(item => item.status !== 'current').map(item => `${item.treeId}: ${item.status} — ${item.reason}`),
  ]
  const manifest = { format: 'perdura-fta-library-package', schemaVersion: 1, scope: snapshot.scope,
    capturedAt, units: snapshot.units, requestedTreeIds: requestedIds, includedTreeIds: folios.map(tree => tree.id),
    dependenciesIncluded: true, missingTargets: closure.missingTargets, issues: closure.issues, contexts,
    warnings, complete: closure.missingTargets.length === 0 && !closure.issues.some(issue => issue.severity === 'error'),
    contentPolicy: 'Each unique tree is detailed once. Numerical outputs are included only for verified current standalone-root contexts. Transfer occurrences do not inherit a child standalone probability. Missing or stale outputs are explicitly marked, not recalculated during export.' }
  const blocks: ReportBlock[] = []
  let blockOrdinal = 0
  const id = () => `fta-library-block-${++blockOrdinal}`
  blocks.push({ id: id(), type: 'text', content: `Captured ${capturedAt}. Scope: ${snapshot.scope}. Units: ${snapshot.units}. ${manifest.contentPolicy}` },
    { id: id(), type: 'table', label: 'Indentured fault tree register', headers: registerHeaders, rows: register },
    { id: id(), type: 'table', label: 'Transfer cross-references', headers: referenceHeaders, rows: referenceRows })
  if (warnings.length) blocks.push({ id: id(), type: 'table', label: 'Completeness and result-status notices', headers: ['Notice'], rows: warnings.map(w => [w]) })
  const treeNames = Object.fromEntries(normalized.folios.map(tree => [tree.id,
    `${normalized.catalog.byTreeId[tree.id].code} — ${tree.name} [${tree.id}]`]))
  const assets = extractFaultTreeAssets(normalized.folios, snapshot.units)
  for (const asset of assets) {
    const getData = asset.getData
    if (asset.type === 'diagram') asset.getData = () => ({ ...getData(), diagramTreeNames: treeNames })
    if (asset.type === 'plot') asset.getData = () => {
      const data = getData()
      return { ...data, plotLayout: mergePlotMarkup(data.plotLayout as Partial<Plotly.Layout>,
        sanitizePlotMarkup(snapshot.plotMarkupByTreeId?.[asset.analysisId ?? ''])) }
    }
  }
  for (const tree of folios) {
    const metadata = catalog.byTreeId[tree.id]
    blocks.push({ id: id(), type: 'pagebreak' }, { id: id(), type: 'heading', level: 1,
      text: `${sections.get(tree.id)}. ${metadata.code} — ${tree.name}` })
    const contextAsset = assets.find(asset => asset.analysisId === tree.id && asset.label === 'Result Context')!
    const origin = { source: contextAsset.source, sourceCapturedAt: capturedAt, sourceKind: 'snapshot' as const }
    blocks.push({ id: id(), type: 'table', label: 'Tree definition and identity', ...origin, headers: ['Field', 'Value'], rows: [
      ['Tree ID', tree.id], ['Code', metadata.code], ['Description', metadata.description], ['Tags', metadata.tags.join(', ')],
      ['System links', json(metadata.systemLinks ?? [])],
      ['Settings', json({ exposureTime: tree.state.exposureTime, engine: tree.state.engine, confidenceLevel: tree.state.confidenceLevel,
        nSimulations: tree.state.nSimulations, simSeed: tree.state.simSeed })],
      ['Referenced by', (index.parents.get(tree.id) ?? []).map(group => `${group.parentId} (${group.references.length} transfers)`).join('\n') || 'None'],
    ] })
    for (const asset of assets.filter(item => item.analysisId === tree.id)) blocks.push(ftaAssetReportBlock(asset, capturedAt))
    blocks.push({ id: id(), type: 'table', label: 'Node definitions (saved inputs)', ...origin,
      headers: ['Node ID', 'Type', 'Label', 'Definition'], rows: (tree.state.nodes ?? []).map(node =>
        [node.id, node.type ?? '', String(node.data?.label ?? ''), json(node.data ?? {})]) },
    { id: id(), type: 'table', label: 'Connections and ordered input roles (saved inputs)', ...origin,
      headers: ['Edge ID', 'Parent gate', 'Input node', 'Role', 'Order', 'Additional data'],
      rows: (tree.state.edges ?? []).map((edge, ordinal) => [edge.id ?? '', edge.source, edge.target,
        String(edge.data?.role ?? edge.role ?? ''), Number(edge.data?.order ?? edge.order ?? ordinal), json(edge.data ?? {})]) })
  }
  const report: SingleReport = { id: uid(), title: `Fault Tree Library — ${snapshot.scope === 'all' ? 'Complete library' : snapshot.scope}`,
    blocks, pageFormat: { orientation: 'landscape', pageSize: 'a4', margin: 15 } }
  return { report, manifest, folios, catalog, register, referenceRows, assets: assets.filter(asset => selectedIds.has(asset.analysisId ?? '')) }
}

export async function addFtaLibraryToReport(options: FtaLibraryReportOptions): Promise<string> {
  const { report } = buildFtaLibraryReport(captureReportOptions(options))
  const existing = getProjectState().modules.reportBuilder as { reports?: SingleReport[]; [key: string]: unknown } | undefined
  setModuleState('reportBuilder', { ...existing, reports: [...(existing?.reports ?? []), report], activeReportId: report.id })
  return report.id
}

export interface FtaPackageRenderers {
  diagram: (state: FtaTreeState, label: string, showResults: boolean, treeNames?: Record<string, string>) => Promise<{ dataUrl: string; width: number; height: number; svgDataUrl: string }>
  pdf: (report: SingleReport) => Promise<ArrayBuffer>
  html: (report: SingleReport) => Promise<string>
}
function dataUrlBytes(url: string) {
  const comma = url.indexOf(',')
  if (!url.slice(0, comma).includes(';base64')) return encode(decodeURIComponent(url.slice(comma + 1)))
  const raw = atob(url.slice(comma + 1))
  return Uint8Array.from(raw, character => character.charCodeAt(0))
}

/** Isolated assembly seam also makes rendering failure semantics directly testable. */
export async function assembleFtaLibraryPackage(options: FtaLibraryReportOptions, project: ExportPayload,
  renderers: FtaPackageRenderers, onProgress?: (progress: FtaPackageProgress) => void) {
  const built = buildFtaLibraryReport(options)
  const files: Record<string, Uint8Array> = {}
  const failedAssets: FtaAssetFailure[] = []
  const usedPaths = new Set<string>()
  const paths = new Map(built.folios.map((tree, ordinal) => [tree.id,
    `trees/${String(ordinal + 1).padStart(3, '0')}-${safe(built.catalog.byTreeId[tree.id].code)}-${safe(tree.id)}`]))
  for (const path of paths.values()) { if (usedPaths.has(path)) throw new Error('Duplicate archive tree path'); usedPaths.add(path) }
  const includedIds = new Set(built.folios.map(tree => tree.id))
  const projectCopy = clone(project)
  projectCopy.modules = { ...projectCopy.modules,
    faultTree: { _folioWrap: true, activeId: built.manifest.requestedTreeIds.find(id => includedIds.has(id)) ?? built.folios[0]?.id ?? null,
      folios: built.folios }, faultTreeCatalog: built.catalog }
  files['project.json'] = encode(json(projectCopy))
  files['register.csv'] = encode(Papa.unparse({ fields: registerHeaders, data: built.register }))
  files['transfer-references.csv'] = encode(Papa.unparse({ fields: referenceHeaders, data: built.referenceRows }))
  files['README.txt'] = encode(`${built.manifest.contentPolicy}\n\nOpen report.html for the detailed report; its interactive plots use the versioned Plotly CDN. report.pdf and the scalable per-tree SVG diagrams are available offline. Transfer previews remain collapsed with target cross-references, so each dependency is detailed once. project.json contains the selected fault-tree closure and preserves other project modules for linked context. Raw saved outputs are retained for audit, but are not verified unless manifest.json marks their context current. Check manifest.json complete and failedAssets before relying on the package.\n`)
  const diagrams = built.report.blocks.filter(block => block.type === 'diagram')
  for (const [ordinal, block] of diagrams.entries()) {
    const treeId = block.source?.analysisId ?? ''
    onProgress?.({ done: ordinal, total: diagrams.length + 2, label: block.label })
    try {
      const image = await renderers.diagram(block.diagramState, block.label, Boolean(block.showResults), block.treeNames)
      block.renderedImage = image
      files[`${paths.get(treeId)}/diagram.png`] = dataUrlBytes(image.dataUrl)
      files[`${paths.get(treeId)}/diagram.svg`] = dataUrlBytes(image.svgDataUrl)
    } catch (error) {
      block.sourceUnavailable = true
      failedAssets.push({ treeId, asset: 'diagram.png', error: message(error) })
    }
  }
  for (const tree of built.folios) {
    const path = paths.get(tree.id)!
    files[`${path}/definition.json`] = encode(json(tree))
    const context = built.manifest.contexts.find(item => item.treeId === tree.id)!
    files[`${path}/context.json`] = encode(json(context))
    for (const asset of built.assets.filter(item => item.analysisId === tree.id)) {
      const data = asset.getData()
      if (asset.type === 'table') files[`${path}/${safe(asset.label)}.csv`] = encode(Papa.unparse({ fields: data.tableHeaders!, data: data.tableRows! }))
      if (asset.type === 'metrics') files[`${path}/${safe(asset.label)}.csv`] = encode(Papa.unparse({ fields: ['Metric', 'Value'], data: data.metrics!.map(item => [item.label, item.value]) }))
      if (asset.type === 'plot') files[`${path}/${safe(asset.label)}.json`] = encode(json(data))
    }
  }
  // Failed diagrams are explicit report notices; never silently represented as successful figures.
  const deliverable = { ...built.report, blocks: built.report.blocks.map(block => block.type === 'diagram' && block.sourceUnavailable
    ? { id: block.id, type: 'text' as const, content: `INCOMPLETE ASSET: ${block.label}. Diagram failed; see manifest.json.` } : block) }
  for (const format of ['html', 'pdf'] as const) {
    onProgress?.({ done: diagrams.length + (format === 'pdf' ? 1 : 0), total: diagrams.length + 2, label: `Rendering report.${format}` })
    try { files[`report.${format}`] = format === 'html' ? encode(await renderers.html(deliverable)) : new Uint8Array(await renderers.pdf(deliverable)) }
    catch (error) { failedAssets.push({ treeId: '', asset: `report.${format}`, error: message(error) }) }
  }
  const complete = built.manifest.complete && failedAssets.length === 0
  const manifest = { ...built.manifest, complete, failedAssets, files: [...Object.keys(files), 'manifest.json'] }
  files['manifest.json'] = encode(json(manifest))
  return { files, manifest, result: { complete, trees: built.folios.length, files: Object.keys(files).length,
    failedAssets, warnings: built.manifest.warnings } satisfies FtaPackageResult }
}

export async function downloadFtaLibraryPackage(options: FtaLibraryReportOptions,
  onProgress?: (progress: FtaPackageProgress) => void): Promise<FtaPackageResult> {
  const snapshot = captureReportOptions(options)
  const project = clone(buildExport(undefined, true))
  const origin = captureProjectExportOrigin()
  const index = buildFtaReferenceIndex(snapshot.folios)
  const closure = new Set(collectFtaClosure(index, snapshot.scope === 'all'
    ? snapshot.folios.map(tree => tree.id) : snapshot.treeIds).treeIds)
  const sources = (await artifactSources('faultTree')).filter(source => closure.has(source.analysisId)).map(source => ({ ...source,
    current: source.current && ftaResultFreshness(index, source.analysisId, CURRENT_ENGINE_REVISIONS.faultTree).status === 'current' }))
  assertProjectExportOrigin(origin)
  const [{ renderFtaDiagram }, { renderReportPDF, renderReportHtml }, { zipSync }] = await Promise.all([
    import('./ReadOnlyFaultTreeDiagram'), import('../ReportBuilder'), import('fflate'),
  ])
  const { files, result } = await assembleFtaLibraryPackage(snapshot, project,
    { diagram: renderFtaDiagram, pdf: renderReportPDF, html: renderReportHtml }, onProgress)
  const name = `${safe(project.project)}_fta_${snapshot.scope}${result.complete ? '' : '_incomplete'}.zip`
  onProgress?.({ done: result.trees + 2, total: result.trees + 2, label: 'Compressing package' })
  assertProjectExportOrigin(origin)
  await downloadArtifact(zipSync(files, { level: 6 }), name, 'application/zip', { kind: 'fta-library-package', title: project.project, sources })
  return result
}
