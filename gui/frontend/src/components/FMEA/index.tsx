import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Beaker,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  CircleAlert,
  FileDiff,
  FlaskConical,
  LibraryBig,
  Link2,
  Loader2,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'

import {
  analyzeFmeaStudies,
  createFmeaRelease,
  createFmeaRevision,
  diffFmeaStudies,
  getFmeaMethodProfiles,
  getFmeaSuggestions,
  instantiateFmeaLibraryItem,
  prepareFmeaLibraryItem,
  transitionFmeaLifecycle,
  verifyFmeaRelease,
  type FMEAAnalysisResponse,
  type FMEAAttestation,
  type FMEAAssignment,
  type FMEAChangeRequest,
  type FMEAEvidenceLink,
  type FMEAEntityGraph,
  type FMEDAFailureMode,
  type FMEDASource,
  type FMEALibraryInstance,
  type FMEALibraryItem,
  type FMEALifecycleEvent,
  type FMEALifecycleStatus,
  type FMEAMethodProfile,
  type FMEAProcessStep,
  type FMEAReleaseRecord,
  type FMEAReviewFinding,
  type FMEARevisionRecord,
  type FMEASemanticChange,
  type FMEASpecialCharacteristic,
  type FMEASavedView,
  type FMEASuggestion,
  type FMEAStudy,
  type FMEAFailureFlowRegistry,
  type FMEAVerificationPlanRow,
  type RequirementInput,
} from '../../api/fmea'
import { getFmeaRatingProfiles } from '../../api/reliabilityProgram'
import {
  useFolioState,
  useModuleFolios,
  useModuleState,
  writeFolioStatesWithCompanion,
} from '../../store/project'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'
import { APP_COMMIT, APP_VERSION } from '../../version'
import { useHelpTopic } from '../help/context'
import FolioBar from '../shared/FolioBar'
import { toast } from '../shared/toast'
import AiagVdaWorkspace from '../ReliabilityProgram/AiagVdaWorkspace'
import { normalizeFmeaAnalysis } from '../ReliabilityProgram/fmeaModel'
import { EMPTY_FMEA_VOCABULARY_PROFILE } from '../ReliabilityProgram/fmeaVocabulary'
import type {
  AIAGVDAFMEAAnalysis,
  FMEARatingProfile,
  FMEAVocabularyProfile,
} from '../../api/reliabilityProgram'
import type {
  PredictionAnalysisSource,
  PredictionStructureState,
} from '../ReliabilityProgram/predictionStructureImport'
import {
  EMPTY_FAILURE_FLOW_REGISTRY,
  failureFlowSnapshot,
  normalizeFailureFlowRegistry,
  sameAnalysisRef as sameFlowRef,
  updateFailureStatementText,
  type FailureFlowCommit,
  type FMEAFlowPortfolioAnalysis,
} from './failureFlow'

type TopView =
  'analysis'|'evidence'|'verification'|'fmeda'|'knowledge'|'review'|'methods'
type WorkspaceView = 'guided'|'worksheet'|'control_plan'|'terminology'|'profiles'

interface StudyGovernance {
  methodProfileId: string
  lifecycleStatus: FMEALifecycleStatus
  evidenceLinks: FMEAEvidenceLink[]
  fmedaSources: FMEDASource[]
  fmedaModes: FMEDAFailureMode[]
  processSteps: FMEAProcessStep[]
  verificationPlan: FMEAVerificationPlanRow[]
  specialCharacteristics: FMEASpecialCharacteristic[]
  reviewFindings: FMEAReviewFinding[]
  assignments: FMEAAssignment[]
  changeRequests: FMEAChangeRequest[]
  libraryItems: FMEALibraryItem[]
  libraryInstances: FMEALibraryInstance[]
  savedViews: FMEASavedView[]
  lifecycleHistory: FMEALifecycleEvent[]
  revisions: FMEARevisionRecord[]
  releases: FMEAReleaseRecord[]
}

interface FMEAState {
  view: TopView
  workspaceView: WorkspaceView
  step: number
  structureView: 'hierarchy'|'diagram'
  functionVisualView: 'tree'|'interfaces'|'p_diagram'|'coverage'
  pDiagramId: string
  activeId: string
  analyses: FMEAEntityGraph[]
  customRatingProfiles: FMEARatingProfile[]
  vocabularyProfile: FMEAVocabularyProfile
  governance: Record<string, StudyGovernance>
  result?: FMEAAnalysisResponse|null
}

const INITIAL_STATE: FMEAState = {
  view: 'analysis',
  workspaceView: 'guided',
  step: 1,
  structureView: 'hierarchy',
  functionVisualView: 'tree',
  pDiagramId: '',
  activeId: '',
  analyses: [],
  customRatingProfiles: [],
  vocabularyProfile: EMPTY_FMEA_VOCABULARY_PROFILE,
  governance: {},
  result: null,
}

const DEFAULT_METHOD_PROFILE = 'aiag_vda_2019_public'
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const fieldClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100'
const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50'

function emptyGovernance(): StudyGovernance {
  return {
    methodProfileId: DEFAULT_METHOD_PROFILE,
    lifecycleStatus: 'draft',
    evidenceLinks: [],
    fmedaSources: [],
    fmedaModes: [],
    processSteps: [],
    verificationPlan: [],
    specialCharacteristics: [],
    reviewFindings: [],
    assignments: [],
    changeRequests: [],
    libraryItems: [],
    libraryInstances: [],
    savedViews: [],
    lifecycleHistory: [],
    revisions: [],
    releases: [],
  }
}

function errorText(error: unknown): string {
  const detail = (error as {
    response?: { data?: { detail?: string|{ msg?: string }[] } }
  })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(item => item.msg ?? 'Invalid input').join('; ')
  return error instanceof Error ? error.message : 'The request failed.'
}

function semanticTargets(analysis?: FMEAEntityGraph) {
  if (!analysis) return []
  const targets = [{ id: analysis.id, label: `Analysis · ${analysis.name}` }]
  const add = (type: string, rows: { id: string; name?: string; description?: string }[]) =>
    rows.forEach(row => targets.push({
      id: row.id,
      label: `${type} · ${row.name || row.description || row.id}`,
    }))
  add('Structure', analysis.structure_nodes)
  add('Function', analysis.functions)
  add('Failure chain', analysis.failure_chains.map(item => ({
    id: item.id, description: item.failure_mode,
  })))
  add('Requirement', analysis.functional_requirements.map(item => ({
    id: item.id, description: item.statement,
  })))
  return targets
}

function fmtPercent(value: number|null|undefined) {
  return value == null || !Number.isFinite(value)
    ? '—' : `${(100 * value).toFixed(2)}%`
}

function buildStudy(
  analysis: FMEAEntityGraph,
  governance: StudyGovernance,
  failureFlow: ReturnType<typeof failureFlowSnapshot>,
): FMEAStudy {
  return {
    schema_version: 2,
    id: analysis.id,
    lifecycle_status: governance.lifecycleStatus,
    method_profile_id: governance.methodProfileId,
    model: analysis,
    evidence_links: governance.evidenceLinks,
    fmeda_sources: governance.fmedaSources,
    fmeda_modes: governance.fmedaModes,
    process_steps: governance.processSteps,
    verification_plan: governance.verificationPlan,
    special_characteristics: governance.specialCharacteristics,
    review_findings: governance.reviewFindings,
    assignments: governance.assignments,
    change_requests: governance.changeRequests,
    library_items: governance.libraryItems,
    library_instances: governance.libraryInstances,
    saved_views: governance.savedViews,
    lifecycle_history: governance.lifecycleHistory,
    revisions: governance.revisions,
    releases: governance.releases,
    failure_flow: failureFlow,
  }
}

export default function FMEA({
  onNavigatePrediction,
}: {
  onNavigatePrediction?: (target: {
    analysisId: string
    entityId: string
    pieceKey?: string
  }) => void
}) {
  const [state, setState, folios] = useFolioState<FMEAState>('fmea', INITIAL_STATE)
  const fmeaFolios = useModuleFolios<FMEAState>('fmea')
  const [failureFlowRegistry] = useModuleState<FMEAFailureFlowRegistry>(
    'fmeaFailureFlow', EMPTY_FAILURE_FLOW_REGISTRY)
  const predictionFolios = useModuleFolios<PredictionStructureState>('prediction')
  const programFolios = useModuleFolios<{
    rows?: { requirements?: Record<string, unknown>[]; hazards?: Record<string, unknown>[]; fracas?: Record<string, unknown>[] }
  }>('reliabilityProgram')
  const [methodProfiles, setMethodProfiles] = useState<FMEAMethodProfile[]>([])
  const [builtInProfiles, setBuiltInProfiles] = useState<FMEARatingProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string|null>(null)
  const bookmarkTarget = useBookmarkNavigationTarget()
  const appliedBookmark = useRef(0)
  useHelpTopic(`fmea.${state.view}`)

  const analyses = useMemo(
    () => (state.analyses ?? []).map(normalizeFmeaAnalysis),
    [state.analyses],
  )
  const active = analyses.find(item => item.id === state.activeId) ?? analyses[0]
  const governance = active
    ? { ...emptyGovernance(), ...(state.governance?.[active.id] ?? {}) }
    : emptyGovernance()
  const activeResult = state.result?.studies.find(item => item.study_id === active?.id)
  const failureFlowPortfolio = useMemo((): FMEAFlowPortfolioAnalysis[] =>
    fmeaFolios.flatMap(folio => {
      const folioState = folio.state ?? INITIAL_STATE
      return (folioState.analyses ?? []).map(analysis => ({
        ref: { folio_id: folio.id, analysis_id: analysis.id },
        folio_name: folio.name,
        analysis: normalizeFmeaAnalysis(analysis),
        lifecycle_status: {
          ...emptyGovernance(),
          ...(folioState.governance?.[analysis.id] ?? {}),
        }.lifecycleStatus,
      }))
    }), [fmeaFolios])
  const normalizedFailureFlow = useMemo(
    () => normalizeFailureFlowRegistry(failureFlowRegistry),
    [failureFlowRegistry],
  )
  const activeFailureFlowRef = active
    ? { folio_id: folios.activeId, analysis_id: active.id }
    : null
  const predictionSources = useMemo(() =>
    predictionFolios.map((folio): PredictionAnalysisSource => ({
      id: folio.id,
      name: folio.name,
      state: folio.state,
    })), [predictionFolios])
  const programState = programFolios.find(item => item.id === programFolios[0]?.id)?.state
  const requirements = useMemo((): RequirementInput[] =>
    (programState?.rows?.requirements ?? []).map(row => ({
      id: String(row.id ?? ''),
      statement: String(row.statement ?? ''),
      measure: String(row.measure ?? ''),
      target: String(row.target ?? ''),
      confidence: String(row.confidence ?? ''),
      mission_profile: String(row.missionProfile ?? ''),
      failure_definition: String(row.failureDefinition ?? ''),
      verification_method: String(row.verification ?? ''),
      owner: String(row.owner ?? ''),
      status: String(row.status ?? 'draft'),
      evidence_ids: String(row.evidence ?? '').split(',').map(item => item.trim()).filter(Boolean),
    })).filter(row => row.id), [programState])
  const hazardOptions = useMemo(() =>
    (programState?.rows?.hazards ?? []).map(row => ({
      id: String(row.id ?? ''),
      label: String(row.title ?? row.id ?? ''),
      detail: String(row.description ?? ''),
    })).filter(item => item.id), [programState])
  const fracasOptions = useMemo(() =>
    (programState?.rows?.fracas ?? []).map(row => ({
      id: String(row.id ?? ''),
      label: String(row.failureMode ?? row.id ?? ''),
      detail: String(row.system ?? ''),
    })).filter(item => item.id), [programState])

  useEffect(() => {
    let live = true
    Promise.all([getFmeaMethodProfiles(), getFmeaRatingProfiles()])
      .then(([methods, ratings]) => {
        if (!live) return
        setMethodProfiles(methods)
        setBuiltInProfiles(ratings)
      })
      .catch(caught => { if (live) setError(errorText(caught)) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!active || state.activeId === active.id) return
    setState(previous => ({ ...previous, activeId: active.id }))
  }, [active, setState, state.activeId])
  useEffect(() => {
    if (!bookmarkTarget
        || bookmarkTarget.nonce === appliedBookmark.current
        || bookmarkTarget.source.module !== 'fmea') return
    if (bookmarkTarget.source.analysisId
        && bookmarkTarget.source.analysisId !== folios.activeId) return
    const target = bookmarkTarget.source.view
    if (!target?.startsWith('fmea:')) return
    const [, encodedId, section, visual, encodedDiagram] = target.split(':')
    const analysisId = decodeURIComponent(encodedId ?? '')
    if (!analyses.some(item => item.id === analysisId)) return
    appliedBookmark.current = bookmarkTarget.nonce
    setState(previous => ({
      ...previous,
      view: 'analysis',
      activeId: analysisId,
      workspaceView:
        section === 'worksheet' ? 'worksheet'
        : section === 'control_plan' ? 'control_plan'
        : 'guided',
      step: section === 'documentation' ? 7
        : section === 'structure' ? 2
        : section === 'function' ? 3 : previous.step,
      structureView: section === 'structure' && visual === 'block_diagram'
        ? 'diagram' : previous.structureView,
      functionVisualView: section === 'function'
        && ['tree', 'interfaces', 'p_diagram', 'coverage'].includes(visual)
        ? visual as FMEAState['functionVisualView']
        : previous.functionVisualView,
      pDiagramId: encodedDiagram ? decodeURIComponent(encodedDiagram) : '',
    }))
  }, [analyses, bookmarkTarget, folios.activeId, setState])

  const patch = (change: Partial<FMEAState>) => {
    setState(previous => ({ ...previous, ...change }))
    setError(null)
  }
  const updateGovernance = (
    id: string,
    update: (previous: StudyGovernance) => StudyGovernance,
  ) => setState(previous => ({
    ...previous,
    governance: {
      ...(previous.governance ?? {}),
      [id]: update({
        ...emptyGovernance(),
        ...(previous.governance?.[id] ?? {}),
      }),
    },
    result: null,
  }))
  const commitFailureFlow = (
    commit: FailureFlowCommit,
    summary: string,
  ) => {
    const updates = fmeaFolios.map(folio => {
      const byId = new Map(commit.portfolio
        .filter(item => item.ref.folio_id === folio.id)
        .map(item => [item.analysis.id, item.analysis]))
      const nextAnalyses = (folio.state.analyses ?? []).map(analysis =>
        byId.get(analysis.id) ?? analysis)
      return {
        folioId: folio.id,
        nextState: {
          ...folio.state,
          analyses: nextAnalyses,
          result: null,
        },
      }
    })
    writeFolioStatesWithCompanion(
      'fmea',
      updates,
      'fmeaFailureFlow',
      commit.registry,
      `failure-flow:${summary || 'linked-statement-edit'}`,
    )
    setError(null)
    if (summary) toast.success(summary)
  }
  const changeFailureChain = (
    analysisId: string,
    chainId: string,
    change: Partial<AIAGVDAFMEAAnalysis['failure_chains'][number]>,
  ) => {
    if (!activeFailureFlowRef || activeFailureFlowRef.analysis_id !== analysisId) {
      return false
    }
    let commit: FailureFlowCommit = {
      registry: normalizedFailureFlow,
      portfolio: failureFlowPortfolio,
    }
    for (const role of (
      ['effect', 'failure_mode', 'cause'] as const
    )) {
      const value = change[role]
      if (typeof value !== 'string') continue
      const linked = updateFailureStatementText(
        commit.registry,
        commit.portfolio,
        { ...activeFailureFlowRef, chain_id: chainId, role },
        value,
      )
      if (linked) commit = linked
    }
    commit = {
      ...commit,
      portfolio: commit.portfolio.map(item => {
        if (!sameFlowRef(item.ref, activeFailureFlowRef)) return item
        return {
          ...item,
          analysis: {
            ...item.analysis,
            failure_chains: item.analysis.failure_chains.map(chain =>
              chain.id === chainId ? { ...chain, ...change } : chain),
          },
        }
      }),
    }
    commitFailureFlow(commit, '')
    return true
  }
  const studies = useMemo(() => analyses.map(analysis =>
    buildStudy(
      analysis,
      { ...emptyGovernance(), ...(state.governance?.[analysis.id] ?? {}) },
      failureFlowSnapshot(
        normalizedFailureFlow,
        { folio_id: folios.activeId, analysis_id: analysis.id },
        failureFlowPortfolio,
      ),
    )), [
    analyses,
    failureFlowPortfolio,
    folios.activeId,
    normalizedFailureFlow,
    state.governance,
  ])
  const activeStudy = active
    ? studies.find(item => item.id === active.id) ?? null
    : null

  const analyze = async () => {
    setLoading(true); setError(null)
    try {
      const result = await analyzeFmeaStudies(
        studies, state.customRatingProfiles ?? [], requirements)
      setState(previous => ({ ...previous, result }))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setLoading(false)
    }
  }

  const tabs: { id: TopView; label: string; icon: typeof ClipboardCheck }[] = [
    { id: 'analysis', label: 'Analysis', icon: ClipboardCheck },
    { id: 'evidence', label: 'Evidence', icon: Link2 },
    { id: 'verification', label: 'Process & Verification', icon: FlaskConical },
    { id: 'fmeda', label: 'FMEDA', icon: Beaker },
    { id: 'knowledge', label: 'Reuse & Guidance', icon: LibraryBig },
    { id: 'review', label: 'Review & Release', icon: ShieldCheck },
    { id: 'methods', label: 'Methods', icon: BookOpenCheck },
  ]

  return <div className="flex h-full flex-col bg-slate-50">
    <FolioBar api={folios} label="FMEA portfolio" />
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
      <nav className="flex gap-1" aria-label="FMEA workspace">
        {tabs.map(tab => {
          const Icon = tab.icon
          return <button key={tab.id} onClick={() => patch({ view: tab.id })}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
              state.view === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}>
            <Icon size={13} />{tab.label}
          </button>
        })}
      </nav>
      <div className="flex items-center gap-2">
        {activeResult && <span title={activeResult.content_sha256}
          className={`rounded-full border px-2 py-1 text-[10px] font-medium ${
            activeResult.release_ready
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}>
          {activeResult.release_ready ? 'Release ready' : 'Review findings'}
        </span>}
        <button onClick={analyze} disabled={loading || analyses.length === 0}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {loading ? 'Analyzing…' : 'Analyze FMEA'}
        </button>
      </div>
    </div>
    {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
      {error}
    </div>}
    {activeResult && activeResult.issue_index.length > 0 && <details
      className="border-b border-amber-200 bg-amber-50">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-xs font-medium text-amber-800">
        <CircleAlert size={14} />
        {activeResult.issue_index.length} navigable analysis finding(s)
      </summary>
      <div className="grid max-h-44 grid-cols-2 gap-2 overflow-auto border-t border-amber-100 p-3">
        {activeResult.issue_index.map((item, index) => <button
          key={`${item.code}-${item.target_id}-${index}`}
          className="rounded border border-amber-200 bg-white p-2 text-left text-[11px] text-slate-700 hover:border-blue-300"
          onClick={() => patch({
            view: item.category === 'fmeda'
              ? 'fmeda'
              : item.category === 'evidence'
                ? 'evidence'
                : item.category === 'flowdown'
                  ? 'verification'
                  : item.category === 'governance'
                    ? 'review' : 'methods',
          })}>
          <span className="font-semibold">{item.category} · {item.target_id}</span>
          <span className="mt-0.5 block text-slate-500">{item.message}</span>
        </button>)}
      </div>
    </details>}
    <main className="min-h-0 flex-1 overflow-auto">
      {state.view === 'analysis' && <AiagVdaWorkspace
        analyses={analyses}
        predictionSources={predictionSources}
        programRequirements={requirements}
        customProfiles={state.customRatingProfiles ?? []}
        vocabularyProfile={state.vocabularyProfile ?? EMPTY_FMEA_VOCABULARY_PROFILE}
        hazardOptions={hazardOptions}
        fracasOptions={fracasOptions}
        builtInProfiles={builtInProfiles}
        result={state.result?.core}
        activeId={state.activeId}
        onActiveId={activeId => patch({ activeId })}
        view={state.workspaceView}
        onView={workspaceView => patch({ workspaceView })}
        step={state.step}
        onStep={step => patch({ step })}
        structureView={state.structureView}
        onStructureView={structureView => patch({ structureView })}
        functionVisualView={state.functionVisualView}
        pDiagramId={state.pDiagramId}
        onFunctionVisualView={functionVisualView => patch({ functionVisualView })}
        onPDiagramId={pDiagramId => patch({ pDiagramId })}
        onAnalysesChange={next => setState(previous => ({
          ...previous,
          analyses: next,
          governance: Object.fromEntries(next.map(item => [
            item.id,
            previous.governance?.[item.id] ?? emptyGovernance(),
          ])),
          result: null,
        }))}
        onProfilesChange={customRatingProfiles => patch({ customRatingProfiles, result: null })}
        onVocabularyProfileChange={vocabularyProfile => patch({ vocabularyProfile })}
        onNavigateReference={() => toast.info('Open the linked record from Reliability Program.')}
        onNavigatePrediction={onNavigatePrediction}
        failureFlow={activeFailureFlowRef ? {
          registry: normalizedFailureFlow,
          portfolio: failureFlowPortfolio,
          active: activeFailureFlowRef,
          onCommit: commitFailureFlow,
          onChainChange: changeFailureChain,
        } : undefined}
      />}
      {state.view === 'evidence' && <EvidenceView
        analysis={active}
        links={governance.evidenceLinks}
        findings={activeResult?.evidence_findings ?? []}
        onChange={evidenceLinks => active && updateGovernance(
          active.id, previous => ({ ...previous, evidenceLinks }))}
      />}
      {state.view === 'fmeda' && <FmedaView
        analysis={active}
        sources={governance.fmedaSources}
        modes={governance.fmedaModes}
        result={activeResult?.fmeda}
        onSourcesChange={fmedaSources => active && updateGovernance(
          active.id, previous => ({ ...previous, fmedaSources }))}
        onModesChange={fmedaModes => active && updateGovernance(
          active.id, previous => ({ ...previous, fmedaModes }))}
      />}
      {state.view === 'verification' && <VerificationView
        analysis={active}
        governance={governance}
        findings={activeResult?.flowdown_findings ?? []}
        onChange={next => active && updateGovernance(active.id, () => next)}
      />}
      {state.view === 'knowledge' && <KnowledgeView
        analysis={active}
        governance={governance}
        study={activeStudy}
        onAnalysis={next => setState(previous => ({
          ...previous,
          analyses: analyses.map(item => item.id === next.id ? next : item),
          result: null,
        }))}
        onChange={next => active && updateGovernance(active.id, () => next)}
        onError={setError}
      />}
      {state.view === 'review' && <ReviewView
        analysis={active}
        governance={governance}
        result={activeResult}
        ratingProfiles={state.customRatingProfiles ?? []}
        requirements={requirements}
        buildStudy={() => activeStudy}
        onGovernance={next => active && setState(previous => ({
          ...previous,
          governance: { ...previous.governance, [active.id]: next },
          result: null,
        }))}
        onError={setError}
      />}
      {state.view === 'methods' && <MethodsView
        profiles={methodProfiles}
        selected={governance.methodProfileId}
        hasAnalysis={Boolean(active)}
        onSelect={methodProfileId => active && updateGovernance(
          active.id, previous => ({ ...previous, methodProfileId }))}
      />}
    </main>
  </div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-64 items-center justify-center text-sm text-slate-400">
    {children}
  </div>
}

function EvidenceView({
  analysis,
  links,
  findings,
  onChange,
}: {
  analysis?: FMEAEntityGraph
  links: FMEAEvidenceLink[]
  findings: { severity: string; message: string; record_id?: string }[]
  onChange: (links: FMEAEvidenceLink[]) => void
}) {
  const targets = semanticTargets(analysis)
  if (!analysis) return <Empty>Create an FMEA analysis before linking evidence.</Empty>
  const add = () => onChange([...links, {
    id: uid('ev'),
    target_id: targets[0]?.id ?? analysis.id,
    source_module: 'external',
    source_analysis_id: 'external-source',
    evidence_kind: 'other',
    claim: '',
    locator: '',
    captured_at: new Date().toISOString(),
    stale: false,
  }])
  const update = (id: string, change: Partial<FMEAEvidenceLink>) =>
    onChange(links.map(item => item.id === id ? { ...item, ...change } : item))
  return <section className="mx-auto max-w-7xl space-y-4 p-5">
    <div className="flex items-start justify-between">
      <div><h2 className="text-base font-semibold text-slate-900">Evidence register</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Link a claim to the exact FMEA record it supports. Checksums and source
          revisions make stale evidence visible; they do not replace technical review.
        </p></div>
      <button className={buttonClass} onClick={add}><Plus size={13} /> Add evidence</button>
    </div>
    {findings.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      {findings.map((item, index) => <p key={`${item.record_id}-${index}`}>{item.message}</p>)}
    </div>}
    {links.length === 0 ? <Empty>No evidence links yet.</Empty> : <div className="space-y-2">
      {links.map(link => <div key={link.id}
        className="grid grid-cols-[1.2fr_1fr_1fr_2fr_auto] gap-2 rounded border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-[10px] font-medium text-slate-500">Supports
          <select className={`mt-1 ${fieldClass}`} value={link.target_id}
            onChange={event => update(link.id, { target_id: event.target.value })}>
            {targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
          </select></label>
        <label className="text-[10px] font-medium text-slate-500">Source module
          <select className={`mt-1 ${fieldClass}`} value={link.source_module}
            onChange={event => update(link.id, {
              source_module: event.target.value as FMEAEvidenceLink['source_module'],
            })}>
            {['prediction','life_data','pof','reliability_testing','warranty','fracas','testability','fault_tree','rbd','markov','doe','msa','spc','requirements','external'].map(value =>
              <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
          </select></label>
        <label className="text-[10px] font-medium text-slate-500">Evidence kind
          <select className={`mt-1 ${fieldClass}`} value={link.evidence_kind}
            onChange={event => update(link.id, {
              evidence_kind: event.target.value as FMEAEvidenceLink['evidence_kind'],
            })}>
            {['rate','distribution','test_result','requirement','hazard','incident','control_effectiveness','diagnostic_coverage','verification','rationale','other'].map(value =>
              <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
          </select></label>
        <label className="text-[10px] font-medium text-slate-500">Supported claim
          <input className={`mt-1 ${fieldClass}`} value={link.claim}
            placeholder="What this evidence demonstrates"
            onChange={event => update(link.id, { claim: event.target.value })} />
        </label>
        <button title="Remove evidence link" className="self-end rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
          onClick={() => onChange(links.filter(item => item.id !== link.id))}>
          <Trash2 size={14} />
        </button>
        <label className="text-[10px] font-medium text-slate-500">Source analysis ID
          <input className={`mt-1 ${fieldClass}`} value={link.source_analysis_id}
            onChange={event => update(link.id, { source_analysis_id: event.target.value })} />
        </label>
        <label className="text-[10px] font-medium text-slate-500">Source record ID
          <input className={`mt-1 ${fieldClass}`} value={link.source_record_id ?? ''}
            onChange={event => update(link.id, {
              source_record_id: event.target.value || undefined,
            })} />
        </label>
        <label className="text-[10px] font-medium text-slate-500">Source revision
          <input className={`mt-1 ${fieldClass}`} value={link.source_revision ?? ''}
            onChange={event => update(link.id, {
              source_revision: event.target.value || undefined,
            })} />
        </label>
        <label className="col-span-2 text-[10px] font-medium text-slate-500">Locator / citation
          <input className={`mt-1 ${fieldClass}`} value={link.locator}
            placeholder="Artifact ID, file, URL, report section, or test record"
            onChange={event => update(link.id, { locator: event.target.value })} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-[10px] text-slate-600">
          <input type="checkbox" checked={link.stale}
            onChange={event => update(link.id, { stale: event.target.checked })} />
          Source changed
        </label>
        <label className="col-span-2 text-[10px] font-medium text-slate-500">Source SHA-256
          <input className={`mt-1 ${fieldClass} font-mono`}
            value={link.source_checksum ?? ''}
            placeholder="64 hexadecimal characters"
            onChange={event => update(link.id, {
              source_checksum: event.target.value || undefined,
            })} />
        </label>
        <label className="text-[10px] font-medium text-slate-500">Units
          <input className={`mt-1 ${fieldClass}`} value={link.units ?? ''}
            placeholder="e.g., failures/hour"
            onChange={event => update(link.id, {
              units: event.target.value || undefined,
            })} />
        </label>
        <label className="text-[10px] font-medium text-slate-500">Explicit rating proposal
          <div className="mt-1 grid grid-cols-[1fr_4rem] gap-1">
            <select className={fieldClass} value={link.rating_dimension ?? ''}
              onChange={event => update(link.id, event.target.value ? {
                rating_dimension: event.target.value as NonNullable<FMEAEvidenceLink['rating_dimension']>,
                rating_value: link.rating_value ?? 1,
              } : {
                rating_dimension: undefined,
                rating_value: undefined,
              })}>
              <option value="">None</option>
              {['severity','occurrence','detection','frequency','monitoring'].map(value =>
                <option key={value}>{value}</option>)}
            </select>
            <input type="number" min="1" max="10" className={fieldClass}
              disabled={!link.rating_dimension} value={link.rating_value ?? ''}
              onChange={event => update(link.id, {
                rating_value: Number(event.target.value),
              })} />
          </div>
        </label>
      </div>)}
    </div>}
  </section>
}

function FmedaView({
  analysis,
  sources,
  modes,
  result,
  onSourcesChange,
  onModesChange,
}: {
  analysis?: FMEAEntityGraph
  sources: FMEDASource[]
  modes: FMEDAFailureMode[]
  result?: FMEAAnalysisResponse['studies'][number]['fmeda']
  onSourcesChange: (sources: FMEDASource[]) => void
  onModesChange: (modes: FMEDAFailureMode[]) => void
}) {
  if (!analysis) return <Empty>Create an FMEA analysis before adding FMEDA records.</Empty>
  const addSource = () => onSourcesChange([...sources, {
    id: uid('fs'),
    label: analysis.structure_nodes[0]?.name || 'New rate source',
    failure_rate_per_hour: 0,
    exposure_fraction: 1,
    allocation_complete: true,
    evidence_link_ids: [],
    notes: '',
  }])
  const updateSource = (id: string, change: Partial<FMEDASource>) =>
    onSourcesChange(sources.map(item =>
      item.id === id ? { ...item, ...change } : item))
  const addMode = () => onModesChange([...modes, {
    id: uid('fm'),
    source_id: sources[0]?.id ?? '',
    description: '',
    mode_fraction: 1,
    classification: 'safe',
    diagnostic_coverage: 0,
    dependent_failure_fraction: 0,
    evidence_link_ids: [],
    notes: '',
  }])
  const updateMode = (id: string, change: Partial<FMEDAFailureMode>) =>
    onModesChange(modes.map(item =>
      item.id === id ? { ...item, ...change } : item))
  const metrics = result?.metrics
  return <section className="mx-auto max-w-7xl space-y-4 p-5">
    <div className="flex items-start justify-between">
      <div><h2 className="text-base font-semibold text-slate-900">Quantitative FMEDA</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Allocate source failure rates to failure modes and classifications.
          Perdura checks conservation and reports method-neutral metrics. A verified
          ISO/IEC profile is required before claiming standards conformance.
        </p></div>
      <div className="flex gap-2">
        <button className={buttonClass} onClick={addSource}>
          <Plus size={13} /> Add rate source
        </button>
        <button className={buttonClass} disabled={sources.length === 0}
          onClick={addMode}><Plus size={13} /> Allocate failure mode</button>
      </div>
    </div>
    {metrics && <div className="grid grid-cols-6 gap-3">
      {[
        ['SFF', fmtPercent(metrics.safe_failure_fraction)],
        ['DC', fmtPercent(metrics.diagnostic_coverage)],
        ['SPFM', fmtPercent(metrics.single_point_fault_metric)],
        ['LFM', fmtPercent(metrics.latent_fault_metric)],
        ['Residual / hour', metrics.residual_rate_per_hour?.toExponential(3) ?? '—'],
        ['Mission residual', fmtPercent(metrics.mission_residual_probability)],
      ].map(([label, value]) => <div key={label}
        className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-1 font-mono text-sm font-semibold text-slate-800">{value}</div>
      </div>)}
    </div>}
    {result?.issues.map(issue => <div key={`${issue.code}-${issue.record_id}`}
      className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
      {issue.message}
    </div>)}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <h3 className="text-xs font-semibold text-slate-800">Failure-rate sources</h3>
        <p className="text-[10px] text-slate-500">
          Define each source rate once. Mode fractions below allocate that rate
          without copying or double-counting it.
        </p>
      </div>
      {sources.length === 0
        ? <p className="p-4 text-xs text-slate-400">No rate sources yet.</p>
        : <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th className="p-2">Source</th><th className="p-2">Rate / hour</th>
              <th className="p-2">Lower</th><th className="p-2">Upper</th>
              <th className="p-2">Exposure</th><th className="p-2">Mission hours</th>
              <th className="p-2">Allocation</th><th /></tr>
          </thead>
          <tbody>{sources.map(source => <tr key={source.id}
            className="border-t border-slate-100">
            <td className="p-2"><input className={fieldClass} value={source.label}
              onChange={event => updateSource(source.id, { label: event.target.value })} />
              <code className="text-[9px] text-slate-400">{source.id}</code></td>
            <td className="p-2"><input type="number" min="0" step="any"
              className={`${fieldClass} font-mono`} value={source.failure_rate_per_hour}
              onChange={event => updateSource(source.id, {
                failure_rate_per_hour: Number(event.target.value),
              })} /></td>
            <td className="p-2"><input type="number" min="0" step="any"
              placeholder="same" className={`${fieldClass} font-mono`}
              value={source.lower_rate_per_hour ?? ''}
              onChange={event => updateSource(source.id, {
                lower_rate_per_hour: event.target.value === ''
                  ? undefined : Number(event.target.value),
              })} /></td>
            <td className="p-2"><input type="number" min="0" step="any"
              placeholder="same" className={`${fieldClass} font-mono`}
              value={source.upper_rate_per_hour ?? ''}
              onChange={event => updateSource(source.id, {
                upper_rate_per_hour: event.target.value === ''
                  ? undefined : Number(event.target.value),
              })} /></td>
            <td className="p-2"><input type="number" min="0" max="1" step="0.01"
              className={`${fieldClass} font-mono`} value={source.exposure_fraction}
              onChange={event => updateSource(source.id, {
                exposure_fraction: Number(event.target.value),
              })} /></td>
            <td className="p-2"><input type="number" min="0" step="any"
              className={`${fieldClass} font-mono`} value={source.mission_time_hours ?? ''}
              onChange={event => updateSource(source.id, {
                mission_time_hours: event.target.value === ''
                  ? undefined : Number(event.target.value),
              })} /></td>
            <td className="p-2"><label className="flex items-center gap-1.5 whitespace-nowrap text-[10px]">
              <input type="checkbox" checked={source.allocation_complete}
                onChange={event => updateSource(source.id, {
                  allocation_complete: event.target.checked,
                })} /> Complete
            </label></td>
            <td className="p-2"><button title={
              modes.some(mode => mode.source_id === source.id)
                ? 'Remove its failure modes first' : 'Remove source'
            } disabled={modes.some(mode => mode.source_id === source.id)}
              className="rounded p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
              onClick={() => onSourcesChange(sources.filter(item => item.id !== source.id))}>
              <Trash2 size={14} /></button></td>
          </tr>)}</tbody>
        </table>}
    </div>
    {modes.length === 0 ? <Empty>No FMEDA failure-mode allocations yet.</Empty> : <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
          <tr><th className="p-2">Source</th><th className="p-2">Failure mode</th>
            <th className="p-2">Mode fraction</th>
            <th className="p-2">Classification</th><th className="p-2">Diagnostic coverage</th>
            <th className="p-2">Dependent fraction</th>
            <th className="p-2">Diagnostic interval (h)</th>
            <th className="p-2">Proof-test interval (h)</th>
            <th className="p-2">Common-cause group</th>
            <th className="p-2">Mode rate / hour</th><th /></tr>
        </thead>
        <tbody>{modes.map(mode => {
          const computed = result?.rows.find(item => item.id === mode.id)
          return <tr key={mode.id} className="border-t border-slate-100">
            <td className="p-2"><select className={fieldClass} value={mode.source_id}
              onChange={event => updateMode(mode.id, { source_id: event.target.value })}>
              {sources.map(source => <option key={source.id} value={source.id}>
                {source.label}
              </option>)}
            </select></td>
            <td className="p-2"><input className={fieldClass} value={mode.description}
              onChange={event => updateMode(mode.id, { description: event.target.value })} /></td>
            <td className="p-2"><input type="number" min="0" max="1" step="0.01" className={`${fieldClass} font-mono`}
              value={mode.mode_fraction} onChange={event => updateMode(mode.id, { mode_fraction: Number(event.target.value) })} /></td>
            <td className="p-2"><select className={fieldClass} value={mode.classification}
              onChange={event => updateMode(mode.id, { classification: event.target.value as FMEDAFailureMode['classification'] })}>
              {['safe','no_effect','single_point','residual','multiple_point_detected','multiple_point_latent'].map(value =>
                <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
            </select></td>
            <td className="p-2"><input type="number" min="0" max="1" step="0.01" className={`${fieldClass} font-mono`}
              value={mode.diagnostic_coverage} onChange={event => updateMode(mode.id, { diagnostic_coverage: Number(event.target.value) })} /></td>
            <td className="p-2"><input type="number" min="0" max="1" step="0.01" className={`${fieldClass} font-mono`}
              value={mode.dependent_failure_fraction} onChange={event => updateMode(mode.id, {
                dependent_failure_fraction: Number(event.target.value),
              })} /></td>
            <td className="p-2"><input type="number" min="0" step="any"
              className={`${fieldClass} font-mono`}
              value={mode.diagnostic_interval_hours ?? ''}
              onChange={event => updateMode(mode.id, {
                diagnostic_interval_hours: event.target.value === ''
                  ? undefined : Number(event.target.value),
              })} /></td>
            <td className="p-2"><input type="number" min="0" step="any"
              className={`${fieldClass} font-mono`}
              value={mode.proof_test_interval_hours ?? ''}
              onChange={event => updateMode(mode.id, {
                proof_test_interval_hours: event.target.value === ''
                  ? undefined : Number(event.target.value),
              })} /></td>
            <td className="p-2"><input className={fieldClass}
              value={mode.common_cause_group_id ?? ''}
              onChange={event => updateMode(mode.id, {
                common_cause_group_id: event.target.value || undefined,
              })} /></td>
            <td className="p-2 font-mono text-slate-600">
              {computed?.mode_rate_per_hour.toExponential(3) ?? 'Run analysis'}
            </td>
            <td className="p-2"><button title="Remove failure mode" className="rounded p-1 text-slate-400 hover:text-red-600"
              onClick={() => onModesChange(modes.filter(item => item.id !== mode.id))}><Trash2 size={14} /></button></td>
          </tr>
        })}</tbody>
      </table>
    </div>}
  </section>
}

function LinkSelector({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: { id: string; label: string }[]
  onChange: (values: string[]) => void
}) {
  const selected = new Set(values)
  return <label className="relative block text-[10px] text-slate-500">
    {label}
    <details className="group mt-1">
      <summary className={`${fieldClass} cursor-pointer list-none truncate`}>
        {values.length === 0
          ? 'None selected'
          : `${values.length} selected · ${options
            .filter(option => selected.has(option.id))
            .map(option => option.label).slice(0, 2).join(', ')}`}
      </summary>
      <div className="absolute z-30 mt-1 max-h-56 min-w-full overflow-auto rounded border border-slate-200 bg-white p-2 shadow-xl">
        {options.length === 0
          ? <p className="p-2 text-slate-400">No records available.</p>
          : options.map(option => <label key={option.id}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5"
                checked={selected.has(option.id)}
                onChange={() => onChange(
                  selected.has(option.id)
                    ? values.filter(value => value !== option.id)
                    : [...values, option.id],
                )} />
              <span>{option.label}</span>
            </label>)}
      </div>
    </details>
  </label>
}

function VerificationView({
  analysis,
  governance,
  findings,
  onChange,
}: {
  analysis?: FMEAEntityGraph
  governance: StudyGovernance
  findings: { severity: string; message: string; record_id?: string }[]
  onChange: (value: StudyGovernance) => void
}) {
  if (!analysis) return <Empty>Create an FMEA analysis before defining flow-down.</Empty>
  const requirementOptions = analysis.functional_requirements.map(item => ({
    id: item.id,
    label: item.statement || item.id,
  }))
  const chainOptions = analysis.failure_chains.map(item => ({
    id: item.id,
    label: item.failure_mode || item.id,
  }))
  const evidenceOptions = governance.evidenceLinks.map(item => ({
    id: item.id,
    label: item.claim || item.locator || item.id,
  }))
  const stepOptions = governance.processSteps.map(item => ({
    id: item.id,
    label: `${item.sequence}. ${item.name}`,
  }))
  const controlOptions = analysis.control_plan.map(item => ({
    id: item.id,
    label: (
      item.product_characteristic
      || item.process_characteristic
      || item.id
    ),
  }))
  const patchStep = (id: string, change: Partial<FMEAProcessStep>) =>
    onChange({ ...governance, processSteps: governance.processSteps.map(
      item => item.id === id ? { ...item, ...change } : item) })
  const patchVerification = (
    id: string, change: Partial<FMEAVerificationPlanRow>,
  ) => onChange({ ...governance, verificationPlan: governance.verificationPlan.map(
    item => item.id === id ? { ...item, ...change } : item) })
  const patchCharacteristic = (
    id: string, change: Partial<FMEASpecialCharacteristic>,
  ) => onChange({
    ...governance,
    specialCharacteristics: governance.specialCharacteristics.map(
      item => item.id === id ? { ...item, ...change } : item),
  })
  return <section className="mx-auto max-w-7xl space-y-5 p-5">
    <div><h2 className="text-base font-semibold text-slate-900">Process and verification flow-down</h2>
      <p className="mt-1 max-w-4xl text-xs text-slate-500">
        Model PFMEA process sequence, plan requirement/failure verification,
        and trace special characteristics into process and Control Plan records.
        IDs are stable links; completed verification requires evidence.
      </p></div>
    {findings.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      {findings.map((item, index) => <p key={`${item.record_id}-${index}`}>{item.message}</p>)}
    </div>}
    <div className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div><h3 className="text-xs font-semibold text-slate-800">PFMEA process flow</h3>
          <p className="text-[10px] text-slate-400">Predecessor links form an acyclic directed flow.</p></div>
        <button className={buttonClass} onClick={() => onChange({
          ...governance,
          processSteps: [...governance.processSteps, {
            id: uid('ps'),
            sequence: governance.processSteps.length + 1,
            name: 'New process step',
            step_type: 'operation',
            predecessor_ids: governance.processSteps.length
              ? [governance.processSteps[governance.processSteps.length - 1].id] : [],
            product_characteristic: '',
            process_characteristic: '',
            notes: '',
          }],
        })}><Plus size={13} /> Add step</button>
      </div>
      {governance.processSteps.length === 0
        ? <p className="p-4 text-xs text-slate-400">No process-flow steps.</p>
        : <div className="overflow-x-auto"><table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
            <tr><th className="p-2">Seq.</th><th className="p-2">Step</th>
              <th className="p-2">Type</th><th className="p-2">Predecessor IDs</th>
              <th className="p-2">Product characteristic</th>
              <th className="p-2">Process characteristic</th><th /></tr>
          </thead><tbody>{[...governance.processSteps]
            .sort((a, b) => a.sequence - b.sequence).map(step =>
            <tr key={step.id} className="border-t border-slate-100">
              <td className="p-2"><input type="number" min="1" className={`${fieldClass} w-16`}
                value={step.sequence} onChange={event => patchStep(step.id, { sequence: Number(event.target.value) })} /></td>
              <td className="p-2"><input className={fieldClass} value={step.name}
                onChange={event => patchStep(step.id, { name: event.target.value })} />
                <code className="text-[9px] text-slate-400">{step.id}</code></td>
              <td className="p-2"><select className={fieldClass} value={step.step_type}
                onChange={event => patchStep(step.id, { step_type: event.target.value as FMEAProcessStep['step_type'] })}>
                {['operation','inspection','transport','storage','delay'].map(item =>
                  <option key={item}>{item}</option>)}</select></td>
              <td className="p-2"><LinkSelector label=""
                values={step.predecessor_ids}
                options={stepOptions.filter(item => item.id !== step.id)}
                onChange={predecessor_ids => patchStep(step.id, { predecessor_ids })} /></td>
              <td className="p-2"><input className={fieldClass} value={step.product_characteristic}
                onChange={event => patchStep(step.id, { product_characteristic: event.target.value })} /></td>
              <td className="p-2"><input className={fieldClass} value={step.process_characteristic}
                onChange={event => patchStep(step.id, { process_characteristic: event.target.value })} /></td>
              <td className="p-2"><button title="Remove step" className="text-slate-400 hover:text-red-600"
                onClick={() => onChange({ ...governance, processSteps: governance.processSteps.filter(item => item.id !== step.id) })}>
                <Trash2 size={14} /></button></td>
            </tr>)}</tbody>
        </table></div>}
    </div>
    <div className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div><h3 className="text-xs font-semibold text-slate-800">DVP&amp;R verification plan</h3>
          <p className="text-[10px] text-slate-400">Link objectives to requirement, failure-chain, and evidence IDs.</p></div>
        <button className={buttonClass} onClick={() => onChange({
          ...governance,
          verificationPlan: [...governance.verificationPlan, {
            id: uid('dvp'),
            objective: 'Verify requirement and associated failure control',
            requirement_ids: [],
            failure_chain_ids: [],
            method: '',
            level: '',
            sample_size: '',
            acceptance_criteria: '',
            owner: '',
            status: 'planned',
            evidence_link_ids: [],
          }],
        })}><Plus size={13} /> Add verification</button>
      </div>
      {governance.verificationPlan.length === 0
        ? <p className="p-4 text-xs text-slate-400">No verification records.</p>
        : <div className="space-y-2 p-3">{governance.verificationPlan.map(row =>
          <div key={row.id} className="grid grid-cols-6 gap-2 rounded border border-slate-100 p-3">
            <label className="col-span-2 text-[10px] text-slate-500">Objective
              <input className={`mt-1 ${fieldClass}`} value={row.objective}
                onChange={event => patchVerification(row.id, { objective: event.target.value })} /></label>
            <label className="text-[10px] text-slate-500">Method
              <input className={`mt-1 ${fieldClass}`} value={row.method}
                onChange={event => patchVerification(row.id, { method: event.target.value })} /></label>
            <label className="text-[10px] text-slate-500">Sample / exposure
              <input className={`mt-1 ${fieldClass}`} value={row.sample_size}
                onChange={event => patchVerification(row.id, { sample_size: event.target.value })} /></label>
            <label className="text-[10px] text-slate-500">Status
              <select className={`mt-1 ${fieldClass}`} value={row.status}
                onChange={event => patchVerification(row.id, { status: event.target.value as FMEAVerificationPlanRow['status'] })}>
                {['planned','in_progress','passed','failed','blocked'].map(item =>
                  <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select></label>
            <button title="Remove verification" className="self-end justify-self-end p-2 text-slate-400 hover:text-red-600"
              onClick={() => onChange({ ...governance, verificationPlan: governance.verificationPlan.filter(item => item.id !== row.id) })}>
              <Trash2 size={14} /></button>
            <LinkSelector label="Requirements" values={row.requirement_ids}
              options={requirementOptions}
              onChange={requirement_ids => patchVerification(row.id, { requirement_ids })} />
            <LinkSelector label="Failure chains" values={row.failure_chain_ids}
              options={chainOptions}
              onChange={failure_chain_ids => patchVerification(row.id, { failure_chain_ids })} />
            <LinkSelector label="Evidence" values={row.evidence_link_ids}
              options={evidenceOptions}
              onChange={evidence_link_ids => patchVerification(row.id, { evidence_link_ids })} />
            <label className="col-span-3 text-[10px] text-slate-500">Acceptance criteria
              <input className={`mt-1 ${fieldClass}`} value={row.acceptance_criteria}
                onChange={event => patchVerification(row.id, { acceptance_criteria: event.target.value })} /></label>
          </div>)}</div>}
    </div>
    <div className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div><h3 className="text-xs font-semibold text-slate-800">Special-characteristic register</h3>
          <p className="text-[10px] text-slate-400">Approved characteristics require requirement and failure-chain links.</p></div>
        <button className={buttonClass} onClick={() => onChange({
          ...governance,
          specialCharacteristics: [...governance.specialCharacteristics, {
            id: uid('sc'), symbol: '', name: 'New characteristic',
            classification: '', requirement_ids: [], failure_chain_ids: [],
            process_step_ids: [], control_plan_row_ids: [],
            status: 'proposed', rationale: '',
          }],
        })}><Plus size={13} /> Add characteristic</button>
      </div>
      {governance.specialCharacteristics.length === 0
        ? <p className="p-4 text-xs text-slate-400">No special characteristics.</p>
        : <div className="space-y-2 p-3">{governance.specialCharacteristics.map(item =>
          <div key={item.id} className="grid grid-cols-[6rem_1fr_1fr_1fr_1fr_auto] gap-2 rounded border border-slate-100 p-3">
            <input className={fieldClass} aria-label="Symbol" placeholder="Symbol" value={item.symbol}
              onChange={event => patchCharacteristic(item.id, { symbol: event.target.value })} />
            <input className={fieldClass} aria-label="Characteristic name" value={item.name}
              onChange={event => patchCharacteristic(item.id, { name: event.target.value })} />
            <LinkSelector label="Requirements" values={item.requirement_ids}
              options={requirementOptions}
              onChange={requirement_ids => patchCharacteristic(item.id, { requirement_ids })} />
            <LinkSelector label="Failure chains" values={item.failure_chain_ids}
              options={chainOptions}
              onChange={failure_chain_ids => patchCharacteristic(item.id, { failure_chain_ids })} />
            <select className={fieldClass} value={item.status}
              onChange={event => patchCharacteristic(item.id, { status: event.target.value as FMEASpecialCharacteristic['status'] })}>
              {['proposed','approved','retired'].map(value => <option key={value}>{value}</option>)}
            </select>
            <button title="Remove characteristic" className="p-2 text-slate-400 hover:text-red-600"
              onClick={() => onChange({ ...governance, specialCharacteristics: governance.specialCharacteristics.filter(row => row.id !== item.id) })}>
              <Trash2 size={14} /></button>
            <div className="col-span-6 grid grid-cols-2 gap-2">
              <LinkSelector label="Process steps" values={item.process_step_ids}
                options={stepOptions}
                onChange={process_step_ids => patchCharacteristic(
                  item.id, { process_step_ids })} />
              <LinkSelector label="Control Plan rows" values={item.control_plan_row_ids}
                options={controlOptions}
                onChange={control_plan_row_ids => patchCharacteristic(
                  item.id, { control_plan_row_ids })} />
            </div>
          </div>)}</div>}
    </div>
  </section>
}

function KnowledgeView({
  analysis,
  governance,
  study,
  onAnalysis,
  onChange,
  onError,
}: {
  analysis?: FMEAEntityGraph
  governance: StudyGovernance
  study: FMEAStudy|null
  onAnalysis: (analysis: FMEAEntityGraph) => void
  onChange: (value: StudyGovernance) => void
  onError: (message: string|null) => void
}) {
  const [suggestions, setSuggestions] = useState<FMEASuggestion[]>([])
  const [busy, setBusy] = useState(false)
  if (!analysis || !study) {
    return <Empty>Create an FMEA analysis before using reusable knowledge.</Empty>
  }
  const captureFamily = async () => {
    setBusy(true); onError(null)
    try {
      const item = await prepareFmeaLibraryItem({
        id: uid('library'),
        name: `${analysis.name} family`,
        kind: 'family',
        version: analysis.revision || 'A',
        status: 'draft',
        description: (
          'Reusable normalized structure, function, requirement, interface, '
          + 'failure-chain, and control records.'
        ),
        tags: [analysis.kind],
        applicability: { kind: analysis.kind },
        content: {
          structure_nodes: analysis.structure_nodes,
          functions: analysis.functions,
          functional_requirements: analysis.functional_requirements,
          function_links: analysis.function_links,
          function_requirement_links: analysis.function_requirement_links,
          failure_chains: analysis.failure_chains,
          interfaces: analysis.interfaces,
          control_plan: analysis.control_plan,
        },
      })
      onChange({
        ...governance,
        libraryItems: [...governance.libraryItems, item],
      })
      toast.success('Draft family item captured for review.')
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const releaseItem = async (item: FMEALibraryItem) => {
    setBusy(true); onError(null)
    try {
      const released = await prepareFmeaLibraryItem({
        ...item, status: 'released',
      })
      onChange({
        ...governance,
        libraryItems: governance.libraryItems.map(value =>
          value.id === item.id ? released : value),
      })
      toast.success(`${released.name} released for controlled reuse.`)
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const instantiate = async (item: FMEALibraryItem) => {
    setBusy(true); onError(null)
    try {
      const result = await instantiateFmeaLibraryItem(
        study, item, uid('instance'))
      onAnalysis(result.study.model)
      onChange({
        ...governance,
        libraryInstances: result.study.library_instances,
      })
      toast.success(`${item.name} added as a traceable library instance.`)
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const propose = async () => {
    setBusy(true); onError(null)
    try {
      const result = await getFmeaSuggestions(study)
      setSuggestions(result.suggestions)
      toast.info(`${result.count} cited proposal(s) prepared; none were applied.`)
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const accept = (suggestion: FMEASuggestion) => {
    if (
      suggestion.kind !== 'rating_proposal'
      || typeof suggestion.proposed_value !== 'number'
    ) return
    const parts = suggestion.path.split('.')
    const field = parts[parts.length - 1]
    if (!field) return
    onAnalysis({
      ...analysis,
      failure_chains: analysis.failure_chains.map(chain =>
        chain.id === suggestion.target_id
          ? { ...chain, [field]: suggestion.proposed_value }
          : chain),
    })
    setSuggestions(previous => previous.filter(item => item.id !== suggestion.id))
    toast.success('Proposal accepted as an analyst edit; rerun analysis to verify.')
  }
  return <section className="mx-auto grid max-w-7xl grid-cols-2 gap-5 p-5">
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold text-slate-900">
          Foundation and family library
        </h2><p className="mt-1 text-xs text-slate-500">
          Reuse normalized records with stable provenance. Instantiation creates
          new IDs and records the source version and checksum.
        </p></div>
        <button className={buttonClass} disabled={busy} onClick={captureFamily}>
          <LibraryBig size={13} /> Capture family
        </button>
      </div>
      {governance.libraryItems.length === 0
        ? <Empty>No reusable family or foundation items.</Empty>
        : governance.libraryItems.map(item => <div key={item.id}
            className="rounded border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-slate-900">{item.name}</h3>
                <p className="text-[10px] text-slate-500">
                  {item.kind} · version {item.version} · {item.status}
                </p></div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                item.status === 'released'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>{item.status}</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">{item.description}</p>
            <code className="mt-2 block truncate text-[9px] text-slate-400">
              {item.checksum}
            </code>
            <div className="mt-3 flex gap-2">
              {item.status === 'draft' && <button className={buttonClass}
                disabled={busy} onClick={() => releaseItem(item)}>
                <ShieldCheck size={13} /> Release item
              </button>}
              <button className={buttonClass}
                disabled={busy || item.status !== 'released'}
                onClick={() => instantiate(item)}>
                <Plus size={13} /> Instantiate
              </button>
            </div>
          </div>)}
    </div>
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold text-slate-900">
          Evidence-grounded guidance
        </h2><p className="mt-1 text-xs text-slate-500">
          Local rules identify missing bases and explicit evidence-backed rating
          proposals. Guidance never silently edits or approves the model.
        </p></div>
        <button className={buttonClass} disabled={busy} onClick={propose}>
          <Sparkles size={13} /> Generate proposals
        </button>
      </div>
      {suggestions.length === 0
        ? <Empty>No proposals generated.</Empty>
        : suggestions.map(item => <div key={item.id}
            className="rounded border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {item.kind.replace(/_/g, ' ')} · {item.confidence.replace(/_/g, ' ')}
              </p><h3 className="mt-1 text-xs font-semibold text-slate-800">
                {item.target_id}
              </h3></div>
              {item.evidence_link_ids.length > 0 && <span
                className="rounded bg-blue-50 px-2 py-1 text-[10px] text-blue-700">
                {item.evidence_link_ids.length} citation
              </span>}
            </div>
            <p className="mt-2 text-xs text-slate-600">{item.rationale}</p>
            {item.proposed_value != null && <p className="mt-2 font-mono text-xs">
              {String(item.current_value)} → {String(item.proposed_value)}
            </p>}
            <div className="mt-3 flex gap-2">
              {item.kind === 'rating_proposal' && <button className={buttonClass}
                onClick={() => accept(item)}>Accept proposal</button>}
              <button className={buttonClass}
                onClick={() => setSuggestions(previous =>
                  previous.filter(value => value.id !== item.id))}>Dismiss</button>
            </div>
          </div>)}
    </div>
  </section>
}

function ReviewView({
  analysis,
  governance,
  result,
  ratingProfiles,
  requirements,
  buildStudy: getStudy,
  onGovernance,
  onError,
}: {
  analysis?: FMEAEntityGraph
  governance: StudyGovernance
  result?: FMEAAnalysisResponse['studies'][number]
  ratingProfiles: FMEARatingProfile[]
  requirements: RequirementInput[]
  buildStudy: () => FMEAStudy|null
  onGovernance: (value: StudyGovernance) => void
  onError: (message: string|null) => void
}) {
  const [actor, setActor] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [changes, setChanges] = useState<FMEASemanticChange[]>([])
  const latest = governance.revisions[governance.revisions.length - 1]
  const study = getStudy()
  if (!analysis || !study) return <Empty>Create an FMEA analysis before review.</Empty>
  const transition = async (targetStatus: FMEALifecycleStatus) => {
    setBusy(true); onError(null)
    const attestation: FMEAAttestation[] = targetStatus === 'approved' ? [{
      id: uid('att'),
      role: 'approver',
      name: actor,
      decision: 'approved',
      statement: summary,
      timestamp: new Date().toISOString(),
      identity_assurance: 'named_local',
    }] : []
    try {
      const next = await transitionFmeaLifecycle(
        study, targetStatus, actor, summary, attestation)
      onGovernance({
        ...governance,
        lifecycleStatus: next.lifecycle_status,
        lifecycleHistory: next.lifecycle_history,
      })
      setSummary('')
      toast.success(`FMEA moved to ${targetStatus.replace(/_/g, ' ')}.`)
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const capture = async () => {
    setBusy(true); onError(null)
    try {
      const revision = await createFmeaRevision(study, actor, summary)
      onGovernance({
        ...governance,
        revisions: [...governance.revisions, revision],
      })
      setSummary('')
      toast.success(`Revision ${revision.revision} captured.`)
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const compare = async () => {
    if (!latest) return
    const baseline = latest.snapshot as unknown as FMEAStudy
    setBusy(true); onError(null)
    try { setChanges((await diffFmeaStudies(baseline, study)).changes) }
    catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const release = async () => {
    setBusy(true); onError(null)
    const attestation: FMEAAttestation = {
      id: uid('att'),
      role: 'approver',
      name: actor,
      decision: 'approved',
      statement: summary || 'Reviewed and approved for controlled release.',
      timestamp: new Date().toISOString(),
      identity_assurance: 'named_local',
    }
    try {
      const manifest = await createFmeaRelease(
        study, ratingProfiles, requirements, APP_VERSION, APP_COMMIT, [attestation])
      onGovernance({
        ...governance,
        lifecycleStatus: 'released',
        lifecycleHistory: [
          ...governance.lifecycleHistory, manifest.lifecycle_event,
        ],
        releases: [...governance.releases, manifest],
      })
      setSummary('')
      toast.success(`Release ${manifest.id} created and checksummed.`)
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const verify = async (releaseRecord: FMEAReleaseRecord) => {
    setBusy(true); onError(null)
    try {
      const verification = await verifyFmeaRelease(study, releaseRecord)
      verification.valid
        ? toast.success('Release content and manifest checksums match.')
        : toast.error('Release verification failed; the current content differs.')
    } catch (caught) { onError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const addFinding = () => onGovernance({
    ...governance,
    reviewFindings: [...governance.reviewFindings, {
      id: uid('finding'),
      target_id: analysis.id,
      severity: 'warning',
      title: 'New review finding',
      description: '',
      status: 'open',
      owner: '',
      disposition: '',
    }],
  })
  const patchFinding = (id: string, change: Partial<FMEAReviewFinding>) =>
    onGovernance({
      ...governance,
      reviewFindings: governance.reviewFindings.map(item =>
        item.id === id ? { ...item, ...change } : item),
    })
  const addAssignment = () => onGovernance({
    ...governance,
    assignments: [...governance.assignments, {
      id: uid('assignment'),
      target_id: analysis.id,
      assignee: actor.trim() || 'Unassigned',
      task: 'Resolve assigned engineering action',
      status: 'open',
    }],
  })
  const addChangeRequest = () => onGovernance({
    ...governance,
    changeRequests: [...governance.changeRequests, {
      id: uid('change'),
      title: 'Proposed engineering change',
      rationale: 'Document why the controlled baseline should change.',
      affected_ids: [analysis.id],
      status: 'proposed',
      requested_by: actor.trim() || 'Unassigned',
      requested_at: new Date().toISOString(),
      disposition: '',
    }],
  })
  const reviewTargets = semanticTargets(analysis)
  return <section className="mx-auto grid max-w-7xl grid-cols-[1fr_1.4fr] gap-5 p-5">
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold text-slate-900">Controlled lifecycle</h2>
        <p className="mt-1 text-xs text-slate-500">
          Revisions record a content hash and parent. Releases are immutable
          manifests. Local names are attestations, not authenticated identities.
        </p></div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
          {governance.lifecycleStatus.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-[11px] font-medium text-slate-600">Reviewer / approver name
          <input className={`mt-1 ${fieldClass}`} value={actor}
            onChange={event => setActor(event.target.value)} /></label>
        <label className="block text-[11px] font-medium text-slate-600">Change summary or approval statement
          <textarea className={`mt-1 min-h-20 ${fieldClass}`} value={summary}
            onChange={event => setSummary(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={busy || !actor.trim() || !summary.trim()}
            onClick={capture}><Archive size={13} /> Capture revision</button>
          <button className={buttonClass} disabled={busy || !latest}
            onClick={compare}><FileDiff size={13} /> Diff from baseline</button>
          {governance.lifecycleStatus === 'draft' && <button className={buttonClass}
            disabled={busy || !actor.trim() || !summary.trim() || !latest}
            onClick={() => transition('in_review')}>
            <ClipboardCheck size={13} /> Submit for review
          </button>}
          {governance.lifecycleStatus === 'in_review' && <button
            className={buttonClass}
            disabled={
              busy || !actor.trim() || !summary.trim()
              || !result?.release_ready
            }
            onClick={() => transition('approved')}>
            <CheckCircle2 size={13} /> Approve baseline
          </button>}
          {['in_review','approved'].includes(governance.lifecycleStatus) && <button
            className={buttonClass} disabled={busy || !actor.trim() || !summary.trim()}
            onClick={() => transition('draft')}>Return to draft</button>}
          <button className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            disabled={
              busy || !actor.trim() || !result?.release_ready
              || governance.lifecycleStatus !== 'approved'
            }
            onClick={release}><ShieldCheck size={13} /> Release</button>
        </div>
        {!result && <p className="text-[10px] text-amber-700">Run the analysis before release.</p>}
        {result && !result.release_ready && <p className="text-[10px] text-amber-700">
          Release is blocked by unresolved model or evidence errors.
        </p>}
      </div>
      <div className="rounded border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-semibold text-slate-800">Readiness</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <span>Model errors</span><strong>{result?.analysis.summary.errors ?? '—'}</strong>
          <span>Model warnings</span><strong>{result?.analysis.summary.warnings ?? '—'}</strong>
          <span>Evidence findings</span><strong>{result?.findings.length ?? '—'}</strong>
          <span>Open review findings</span><strong>{
            governance.reviewFindings.filter(item =>
              !['closed','accepted'].includes(item.status)).length
          }</strong>
          <span>Current hash</span><code title={result?.content_sha256}
            className="truncate text-[10px]">{result?.content_sha256?.slice(0, 16) ?? '—'}</code>
        </div>
      </div>
      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div><h3 className="text-xs font-semibold text-slate-800">
            Review findings
          </h3><p className="text-[10px] text-slate-400">
            Critical and error findings block approval and release.
          </p></div>
          <button className={buttonClass} onClick={addFinding}>
            <Plus size={13} /> Add finding
          </button>
        </div>
        {governance.reviewFindings.length === 0
          ? <p className="p-4 text-xs text-slate-400">No review findings.</p>
          : <div className="space-y-2 p-3">{governance.reviewFindings.map(item =>
            <div key={item.id}
              className="grid grid-cols-[1fr_8rem_8rem] gap-2 rounded border border-slate-100 p-2">
              <input className={fieldClass} aria-label="Finding title"
                value={item.title}
                onChange={event => patchFinding(item.id, {
                  title: event.target.value,
                })} />
              <select className={fieldClass} aria-label="Finding severity"
                value={item.severity}
                onChange={event => patchFinding(item.id, {
                  severity: event.target.value as FMEAReviewFinding['severity'],
                })}>
                {['info','warning','error','critical'].map(value =>
                  <option key={value}>{value}</option>)}
              </select>
              <select className={fieldClass} aria-label="Finding status"
                value={item.status}
                onChange={event => patchFinding(item.id, {
                  status: event.target.value as FMEAReviewFinding['status'],
                })}>
                {['open','in_progress','closed','accepted'].map(value =>
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </option>)}
              </select>
              <textarea className={`col-span-2 ${fieldClass}`}
                aria-label="Finding description" value={item.description}
                placeholder="Finding, evidence, and required response"
                onChange={event => patchFinding(item.id, {
                  description: event.target.value,
                })} />
              <input className={fieldClass} aria-label="Finding owner"
                placeholder="Owner" value={item.owner}
                onChange={event => patchFinding(item.id, {
                  owner: event.target.value,
                })} />
              {['closed','accepted'].includes(item.status) && <textarea
                className={`col-span-3 ${fieldClass}`}
                aria-label="Finding disposition" value={item.disposition}
                placeholder="Disposition and objective closure basis"
                onChange={event => patchFinding(item.id, {
                  disposition: event.target.value,
                })} />}
            </div>)}</div>}
      </div>
    </div>
    <div className="space-y-4">
      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div><h3 className="text-xs font-semibold text-slate-800">
            Assignments and change requests
          </h3><p className="text-[10px] text-slate-400">
            Coordinate review work without changing the approved engineering model.
          </p></div>
          <div className="flex gap-2">
            <button className={buttonClass} onClick={addAssignment}>
              <Plus size={13} /> Assignment
            </button>
            <button className={buttonClass} onClick={addChangeRequest}>
              <Plus size={13} /> Change request
            </button>
          </div>
        </div>
        {(governance.assignments.length === 0
          && governance.changeRequests.length === 0)
          ? <p className="p-4 text-xs text-slate-400">
              No assignments or change requests.
            </p>
          : <div className="grid grid-cols-2 gap-3 p-3">
            {governance.assignments.map(item => <div key={item.id}
              className="space-y-2 rounded border border-slate-100 p-3">
              <p className="text-[10px] font-semibold uppercase text-slate-400">
                Assignment
              </p>
              <select className={fieldClass} value={item.target_id}
                onChange={event => onGovernance({
                  ...governance,
                  assignments: governance.assignments.map(value =>
                    value.id === item.id
                      ? { ...value, target_id: event.target.value } : value),
                })}>
                {reviewTargets.map(target => <option key={target.id}
                  value={target.id}>{target.label}</option>)}
              </select>
              <input className={fieldClass} value={item.task}
                onChange={event => onGovernance({
                  ...governance,
                  assignments: governance.assignments.map(value =>
                    value.id === item.id
                      ? { ...value, task: event.target.value } : value),
                })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={fieldClass} value={item.assignee}
                  onChange={event => onGovernance({
                    ...governance,
                    assignments: governance.assignments.map(value =>
                      value.id === item.id
                        ? { ...value, assignee: event.target.value } : value),
                  })} />
                <select className={fieldClass} value={item.status}
                  onChange={event => onGovernance({
                    ...governance,
                    assignments: governance.assignments.map(value =>
                      value.id === item.id ? {
                        ...value,
                        status: event.target.value as FMEAAssignment['status'],
                      } : value),
                  })}>
                  {['open','in_progress','completed','cancelled'].map(value =>
                    <option key={value} value={value}>
                      {value.replace(/_/g, ' ')}
                    </option>)}
                </select>
              </div>
            </div>)}
            {governance.changeRequests.map(item => <div key={item.id}
              className="space-y-2 rounded border border-slate-100 p-3">
              <p className="text-[10px] font-semibold uppercase text-slate-400">
                Change request
              </p>
              <input className={fieldClass} value={item.title}
                onChange={event => onGovernance({
                  ...governance,
                  changeRequests: governance.changeRequests.map(value =>
                    value.id === item.id
                      ? { ...value, title: event.target.value } : value),
                })} />
              <LinkSelector label="Affected records"
                values={item.affected_ids} options={reviewTargets}
                onChange={affected_ids => onGovernance({
                  ...governance,
                  changeRequests: governance.changeRequests.map(value =>
                    value.id === item.id
                      ? { ...value, affected_ids } : value),
                })} />
              <select className={fieldClass} value={item.status}
                onChange={event => onGovernance({
                  ...governance,
                  changeRequests: governance.changeRequests.map(value =>
                    value.id === item.id ? {
                      ...value,
                      status: event.target.value as FMEAChangeRequest['status'],
                    } : value),
                })}>
                {['proposed','accepted','implemented','rejected','withdrawn'].map(value =>
                  <option key={value}>{value}</option>)}
              </select>
            </div>)}
          </div>}
      </div>
      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3"><h3 className="text-xs font-semibold text-slate-800">Revision history</h3></div>
        {governance.revisions.length === 0
          ? <p className="p-4 text-xs text-slate-400">No controlled revisions.</p>
          : [...governance.revisions].reverse().map(item => <div key={item.id}
              className="border-b border-slate-100 px-4 py-3 text-xs last:border-0">
              <div className="flex justify-between"><strong>Revision {item.revision}</strong>
                <span className="text-slate-400">{new Date(item.created_at).toLocaleString()}</span></div>
              <p className="mt-1 text-slate-600">{item.change_summary}</p>
              <code className="mt-1 block text-[10px] text-slate-400">{item.content_sha256}</code>
            </div>)}
      </div>
      {changes.length > 0 && <div className="rounded border border-blue-200 bg-white">
        <div className="border-b border-blue-100 px-4 py-3"><h3 className="text-xs font-semibold text-blue-800">Changes from latest baseline · {changes.length}</h3></div>
        <div className="max-h-72 overflow-auto">{changes.slice(0, 500).map((item, index) =>
          <div key={`${item.path}-${index}`} className="border-b border-slate-100 px-4 py-2 text-[11px]">
            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-medium">{item.change}</span>
            <code>{item.path}</code>
          </div>)}</div>
      </div>}
      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3"><h3 className="text-xs font-semibold text-slate-800">Immutable releases</h3></div>
        {governance.releases.length === 0
          ? <p className="p-4 text-xs text-slate-400">No releases.</p>
          : [...governance.releases].reverse().map(item => <div key={item.id}
              className="flex items-start justify-between border-b border-slate-100 px-4 py-3 text-xs last:border-0">
              <div><strong>{item.id}</strong><p className="mt-1 text-slate-500">
                {item.assurance === 'named_local'
                  ? 'Named local attestation · identity not authenticated'
                  : 'Authenticated hosted approval'}
              </p><code className="mt-1 block text-[10px] text-slate-400">{item.manifest_sha256}</code></div>
              <button className={buttonClass} disabled={busy} onClick={() => verify(item)}>
                <CheckCircle2 size={13} /> Verify
              </button>
            </div>)}
      </div>
    </div>
  </section>
}

function MethodsView({
  profiles,
  selected,
  hasAnalysis,
  onSelect,
}: {
  profiles: FMEAMethodProfile[]
  selected: string
  hasAnalysis: boolean
  onSelect: (id: string) => void
}) {
  return <section className="mx-auto max-w-6xl space-y-4 p-5">
    <div><h2 className="text-base font-semibold text-slate-900">Method profiles</h2>
      <p className="mt-1 max-w-3xl text-xs text-slate-500">
        A profile controls vocabulary, ratings, calculations, validation, and
        exports. Reference-gated profiles are visible for planning but cannot be
        selected until their source rules are independently verified.
      </p></div>
    <div className="grid grid-cols-2 gap-3">
      {profiles.map(profile => {
        const executable = profile.status === 'preview_public_alignment'
        return <div key={profile.id}
          className={`rounded border bg-white p-4 shadow-sm ${
            selected === profile.id ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'
          }`}>
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-slate-900">{profile.name}</h3>
              <p className="text-[11px] text-slate-500">{profile.edition}</p></div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
              executable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}>{executable ? 'Preview · executable' : 'Reference required'}</span>
          </div>
          <p className="mt-3 text-xs text-slate-600">{profile.capabilities.join(' · ')}</p>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{profile.basis.join('; ')}</p>
          <button className={`${buttonClass} mt-3`} disabled={!hasAnalysis || !executable}
            onClick={() => onSelect(profile.id)}>
            {selected === profile.id ? 'Selected' : 'Use profile'}
          </button>
        </div>
      })}
    </div>
  </section>
}
