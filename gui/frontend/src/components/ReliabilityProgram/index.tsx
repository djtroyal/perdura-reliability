import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Info, Play, Plus, Trash2 } from 'lucide-react'

import {
  analyzeReliabilityProgram,
  getFmeaRatingProfiles,
  type AIAGVDAFMEAAnalysis,
  type FMEARatingProfile,
  type FMEAVocabularyProfile,
  type ReliabilityProgramRequest,
  type ReliabilityProgramResponse,
} from '../../api/reliabilityProgram'
import { useFolioState, useModuleFolios } from '../../store/project'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'
import FolioBar from '../shared/FolioBar'
import Plot from '../shared/ExportablePlot'
import ExportResultsButton from '../shared/ExportResultsButton'
import ConfidenceInput from '../shared/ConfidenceInput'
import { Card } from '../shared/ui'
import { useHelpTopic } from '../help/context'
import AiagVdaWorkspace from './AiagVdaWorkspace'
import {
  addClassicRowsToAiag,
  aiagClassicChainIds,
  classicRowsFromAiag,
  removeClassicRowFromAiag,
  updateAiagFromClassicRow,
} from './fmeaInterop'
import { normalizeFmeaAnalysis } from './fmeaModel'
import { EMPTY_FMEA_VOCABULARY_PROFILE } from './fmeaVocabulary'
import RecordLinkField, {
  type ProgramRecordLinkOption,
} from './RecordLinkField'
import type {
  PredictionAnalysisSource,
  PredictionStructureState,
} from './predictionStructureImport'


type View = 'fmea' | 'hazards' | 'fracas' | 'requirements' | 'testability' | 'rcm'
type Cell = string | boolean
type ProgramRow = Record<string, Cell>
type CellType = 'text' | 'number' | 'boolean' | 'select' | 'record-links'
interface Column {
  key: string
  label: string
  type?: CellType
  options?: string[]
  width?: string
  title?: string
  referenceView?: 'hazards'|'fracas'
}

interface ReliabilityProgramState {
  view: View
  rows: Record<View, ProgramRow[]>
  totalExposure: string
  ciText: string
  isolationThreshold: string
  mediumRpn: string
  highRpn: string
  fmeaMode: 'aiag'|'classic'
  fmeaStep: number
  fmeaStructureView: 'hierarchy'|'diagram'
  fmeaFunctionVisualView: 'tree'|'interfaces'|'p_diagram'|'coverage'
  fmeaPDiagramId: string
  activeFmeaId: string
  fmeaWorkspaceView:
    'guided'|'worksheet'|'control_plan'|'terminology'|'profiles'
  aiagAnalyses: AIAGVDAFMEAAnalysis[]
  customRatingProfiles: FMEARatingProfile[]
  fmeaVocabularyProfile: FMEAVocabularyProfile
  result?: ReliabilityProgramResponse | null
}

const VIEWS: { id: View; label: string; prefix: string }[] = [
  { id: 'fmea', label: 'FMEA / FMECA', prefix: 'FM' },
  { id: 'hazards', label: 'Hazards', prefix: 'HZ' },
  { id: 'fracas', label: 'FRACAS', prefix: 'FR' },
  { id: 'requirements', label: 'Requirements', prefix: 'REQ' },
  { id: 'testability', label: 'Testability', prefix: 'TF' },
  { id: 'rcm', label: 'RCM', prefix: 'RCM' },
]

const EMPTY_ROWS: Record<View, ProgramRow[]> = {
  fmea: [], hazards: [], fracas: [], requirements: [], testability: [], rcm: [],
}
const INITIAL_STATE: ReliabilityProgramState = {
  view: 'fmea', rows: EMPTY_ROWS, totalExposure: '', ciText: '0.95',
  isolationThreshold: '1', mediumRpn: '100', highRpn: '200',
  fmeaMode: 'aiag', fmeaStep: 1, activeFmeaId: '',
  fmeaStructureView: 'hierarchy',
  fmeaFunctionVisualView: 'tree', fmeaPDiagramId: '',
  fmeaWorkspaceView: 'guided',
  aiagAnalyses: [], customRatingProfiles: [],
  fmeaVocabularyProfile: EMPTY_FMEA_VOCABULARY_PROFILE,
  result: null,
}

const COLUMNS: Record<View, Column[]> = {
  fmea: [
    { key: 'id', label: 'ID', width: 'w-20' }, { key: 'item', label: 'Item', width: 'w-32' },
    { key: 'function', label: 'Function', width: 'w-40' }, { key: 'failureMode', label: 'Failure mode', width: 'w-40' },
    { key: 'localEffect', label: 'Local effect', width: 'w-40' }, { key: 'endEffect', label: 'End effect', width: 'w-40' },
    { key: 'cause', label: 'Cause', width: 'w-40' }, { key: 'controls', label: 'Current controls', width: 'w-40' },
    { key: 'severity', label: 'S', type: 'number', width: 'w-14', title: 'Severity, 1–10' },
    { key: 'occurrence', label: 'O', type: 'number', width: 'w-14', title: 'Occurrence, 1–10' },
    { key: 'detection', label: 'D', type: 'number', width: 'w-14', title: 'Detection, 1–10; higher means harder to detect' },
    { key: 'action', label: 'Recommended action', width: 'w-48' }, { key: 'owner', label: 'Owner', width: 'w-28' },
    { key: 'status', label: 'Status', type: 'select', options: ['open', 'planned', 'implemented', 'verified', 'closed'], width: 'w-28' },
    { key: 'hazardLinks', label: 'Hazards', type: 'record-links',
      referenceView: 'hazards', width: 'w-52' },
    { key: 'fracasLinks', label: 'FRACAS records', type: 'record-links',
      referenceView: 'fracas', width: 'w-52' },
    { key: 'failureRate', label: 'Failure rate', type: 'number', width: 'w-24' }, { key: 'modeRatio', label: 'Mode ratio', type: 'number', width: 'w-20' },
    { key: 'effectProbability', label: 'Effect probability', type: 'number', width: 'w-28', title: 'Conditional probability that the mode produces the classified effect' },
    { key: 'missionTime', label: 'Mission time', type: 'number', width: 'w-24' },
  ],
  hazards: [
    { key: 'id', label: 'ID', width: 'w-20' }, { key: 'title', label: 'Hazard', width: 'w-40' },
    { key: 'description', label: 'Description', width: 'w-52' }, { key: 'cause', label: 'Cause', width: 'w-40' },
    { key: 'initialProbability', label: 'Initial P', type: 'select', options: ['A','B','C','D','E','F'], width: 'w-20' },
    { key: 'initialSeverity', label: 'Initial S', type: 'select', options: ['I','II','III','IV'], width: 'w-20' },
    { key: 'mitigation', label: 'Mitigation', width: 'w-52' }, { key: 'verification', label: 'Verification evidence', width: 'w-48' },
    { key: 'residualProbability', label: 'Residual P', type: 'select', options: ['A','B','C','D','E','F'], width: 'w-24' },
    { key: 'residualSeverity', label: 'Residual S', type: 'select', options: ['I','II','III','IV'], width: 'w-24' },
    { key: 'status', label: 'Acceptance', type: 'select', options: ['pending','review','accepted','closed'], width: 'w-24' },
    { key: 'authority', label: 'Acceptance authority', width: 'w-36' }, { key: 'fmeaLinks', label: 'FMEA IDs', width: 'w-28' },
  ],
  fracas: [
    { key: 'id', label: 'ID', width: 'w-20' }, { key: 'system', label: 'System / item', width: 'w-32' },
    { key: 'failureMode', label: 'Failure mode', width: 'w-40' }, { key: 'symptom', label: 'Symptom', width: 'w-40' },
    { key: 'exposure', label: 'Exposure at event', type: 'number', width: 'w-28' }, { key: 'rootCause', label: 'Root cause', width: 'w-40' },
    { key: 'action', label: 'Corrective action', width: 'w-48' }, { key: 'status', label: 'Status', type: 'select', options: ['open','investigating','actioned','verified','closed'], width: 'w-24' },
    { key: 'owner', label: 'Owner', width: 'w-28' }, { key: 'verified', label: 'Effectiveness verified', type: 'boolean', width: 'w-28' },
    { key: 'recurrence', label: 'Recurrence', type: 'boolean', width: 'w-20' }, { key: 'downtime', label: 'Downtime', type: 'number', width: 'w-20' },
    { key: 'fmeaLinks', label: 'FMEA IDs', width: 'w-28' },
  ],
  requirements: [
    { key: 'id', label: 'ID', width: 'w-24' }, { key: 'statement', label: 'Requirement statement', width: 'w-64' },
    { key: 'measure', label: 'Measure', width: 'w-36' }, { key: 'target', label: 'Target', width: 'w-28' },
    { key: 'confidence', label: 'Confidence', width: 'w-24' }, { key: 'missionProfile', label: 'Mission / use profile', width: 'w-48' },
    { key: 'failureDefinition', label: 'Failure definition', width: 'w-48' }, { key: 'verification', label: 'Verification method', width: 'w-40' },
    { key: 'owner', label: 'Owner', width: 'w-28' }, { key: 'status', label: 'Status', type: 'select', options: ['draft','approved','in verification','verified','accepted'], width: 'w-28' },
    { key: 'evidence', label: 'Evidence / analysis IDs', width: 'w-48' },
  ],
  testability: [
    { key: 'id', label: 'Fault ID', width: 'w-24' }, { key: 'description', label: 'Fault description', width: 'w-64' },
    { key: 'weight', label: 'Fault weight / rate', type: 'number', width: 'w-32' }, { key: 'detected', label: 'Detected', type: 'boolean', width: 'w-20' },
    { key: 'ambiguity', label: 'Ambiguity group size', type: 'number', width: 'w-36' }, { key: 'tests', label: 'Detecting test IDs', width: 'w-48' },
  ],
  rcm: [
    { key: 'id', label: 'ID', width: 'w-24' }, { key: 'item', label: 'Item', width: 'w-32' }, { key: 'function', label: 'Function', width: 'w-40' },
    { key: 'functionalFailure', label: 'Functional failure', width: 'w-48' }, { key: 'failureMode', label: 'Failure mode', width: 'w-40' },
    { key: 'consequence', label: 'Consequence', type: 'select', options: ['safety','environmental','operational','non-operational','hidden'], width: 'w-32' },
    { key: 'taskType', label: 'Task', type: 'select', options: ['undecided','on-condition','scheduled restoration','scheduled discard','failure-finding','run-to-failure','redesign'], width: 'w-40' },
    { key: 'interval', label: 'Task interval', type: 'number', width: 'w-24' }, { key: 'status', label: 'Decision', type: 'select', options: ['open','review','approved','closed'], width: 'w-24' },
    { key: 'rationale', label: 'Rationale', width: 'w-64' }, { key: 'fmeaLinks', label: 'FMEA IDs', width: 'w-28' },
  ],
}

const DEFAULTS: Record<View, ProgramRow> = {
  fmea: { id: '', item: '', function: '', failureMode: '', localEffect: '', endEffect: '', cause: '', controls: '', severity: '5', occurrence: '5', detection: '5', action: '', owner: '', status: 'open', hazardLinks: '', fracasLinks: '', failureRate: '', modeRatio: '', effectProbability: '', missionTime: '' },
  hazards: { id: '', title: '', description: '', cause: '', initialProbability: 'C', initialSeverity: 'III', mitigation: '', verification: '', residualProbability: 'D', residualSeverity: 'III', status: 'pending', authority: '', fmeaLinks: '' },
  fracas: { id: '', system: '', failureMode: '', symptom: '', exposure: '', rootCause: '', action: '', status: 'open', owner: '', verified: false, recurrence: false, downtime: '0', fmeaLinks: '' },
  requirements: { id: '', statement: '', measure: '', target: '', confidence: '', missionProfile: '', failureDefinition: '', verification: '', owner: '', status: 'draft', evidence: '' },
  testability: { id: '', description: '', weight: '1', detected: false, ambiguity: '1', tests: '' },
  rcm: { id: '', item: '', function: '', functionalFailure: '', failureMode: '', consequence: 'operational', taskType: 'undecided', interval: '', status: 'open', rationale: '', fmeaLinks: '' },
}

const list = (value: Cell) => String(value || '').split(',').map(item => item.trim()).filter(Boolean)
const optionalNumber = (value: Cell | undefined) => value == null || String(value).trim() === '' ? undefined : Number(value)
const fmt = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(4)
const pct = (value: number | null | undefined) => value == null ? '—' : `${(100 * value).toFixed(1)}%`

export default function ReliabilityProgram({
  onNavigatePrediction,
}: {
  onNavigatePrediction?: (target: {
    analysisId: string
    entityId: string
    pieceKey?: string
  }) => void
}) {
  const [state, setState, folios] = useFolioState<ReliabilityProgramState>('reliabilityProgram', INITIAL_STATE)
  const predictionFolios = useModuleFolios<PredictionStructureState>('prediction')
  const predictionSources = useMemo(() =>
    predictionFolios.map((folio): PredictionAnalysisSource => ({
      id: folio.id,
      name: folio.name,
      state: folio.state,
    })), [predictionFolios])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkedRecordTarget, setLinkedRecordTarget] = useState<{
    view: 'hazards'|'fracas'
    id: string
  }|null>(null)
  const [builtInProfiles, setBuiltInProfiles] = useState<FMEARatingProfile[]>([])
  const resultsRef = useRef<HTMLDivElement>(null)
  const bookmarkTarget = useBookmarkNavigationTarget()
  const appliedBookmark = useRef(0)
  const reconciledFolio = useRef<string | null>(null)
  useHelpTopic(`reliabilityProgram.${state.view}`)
  useEffect(() => {
    let active = true
    getFmeaRatingProfiles()
      .then(profiles => { if (active) setBuiltInProfiles(profiles) })
      .catch(() => { /* Analysis results retain profile metadata if discovery is unavailable. */ })
    return () => { active = false }
  }, [])
  const patch = (change: Partial<ReliabilityProgramState>) => {
    setState(previous => ({ ...previous, ...change, result: null }))
    setError(null)
  }
  const currentRows = state.rows[state.view]
  const normalizedAnalyses = useMemo(
    () => (state.aiagAnalyses ?? []).map(normalizeFmeaAnalysis),
    [state.aiagAnalyses],
  )
  useEffect(() => {
    if (reconciledFolio.current === folios.activeId) return
    reconciledFolio.current = folios.activeId
    const aiagAnalyses = addClassicRowsToAiag(
      state.rows.fmea,
      normalizedAnalyses,
    )
    const fmea = classicRowsFromAiag(aiagAnalyses, state.rows.fmea)
    if (
      JSON.stringify(aiagAnalyses) === JSON.stringify(state.aiagAnalyses ?? [])
      && JSON.stringify(fmea) === JSON.stringify(state.rows.fmea)
    ) return
    setState(previous => ({
      ...previous,
      aiagAnalyses,
      rows: { ...previous.rows, fmea },
      result: null,
    }))
  }, [
    folios.activeId,
    normalizedAnalyses,
    setState,
    state.aiagAnalyses,
    state.rows.fmea,
  ])
  const updateRow = (index: number, key: string, value: Cell) => {
    const previousRow = currentRows[index]
    const nextRows = currentRows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [key]: value } : row)
    if (state.view === 'fmea' && state.fmeaMode === 'classic') {
      const withStandalone = addClassicRowsToAiag(
        currentRows,
        normalizedAnalyses,
      )
      const aiagAnalyses = updateAiagFromClassicRow(
        previousRow,
        nextRows[index],
        withStandalone,
        nextRows,
        [key],
      )
      patch({
        aiagAnalyses,
        rows: {
          ...state.rows,
          fmea: classicRowsFromAiag(aiagAnalyses, nextRows),
        },
      })
      return
    }
    patch({ rows: {
      ...state.rows,
      [state.view]: nextRows,
    } })
  }
  const addRow = () => {
    const spec = VIEWS.find(item => item.id === state.view)!
    const used = new Set(Object.values(state.rows).flat().map(row => String(row.id)))
    let counter = currentRows.length + 1
    while (used.has(`${spec.prefix}-${counter}`)) counter += 1
    const created = {
      ...DEFAULTS[state.view],
      id: `${spec.prefix}-${counter}`,
    }
    const nextRows = [...currentRows, created]
    if (state.view === 'fmea' && state.fmeaMode === 'classic') {
      const withStandalone = addClassicRowsToAiag(
        currentRows,
        normalizedAnalyses,
      )
      const aiagAnalyses = updateAiagFromClassicRow(
        undefined,
        created,
        withStandalone,
        nextRows,
      )
      patch({
        aiagAnalyses,
        rows: {
          ...state.rows,
          fmea: classicRowsFromAiag(aiagAnalyses, nextRows),
        },
      })
      return
    }
    patch({ rows: {
      ...state.rows,
      [state.view]: nextRows,
    } })
  }
  const removeRow = (index: number) => {
    const removed = currentRows[index]
    const nextRows = currentRows.filter((_, rowIndex) => rowIndex !== index)
    if (state.view === 'fmea' && state.fmeaMode === 'classic') {
      const withStandalone = addClassicRowsToAiag(
        nextRows,
        normalizedAnalyses,
      )
      const aiagAnalyses = removeClassicRowFromAiag(
        removed,
        withStandalone,
      )
      patch({
        aiagAnalyses,
        rows: {
          ...state.rows,
          fmea: classicRowsFromAiag(aiagAnalyses, nextRows),
        },
      })
      return
    }
    patch({ rows: {
      ...state.rows,
      [state.view]: nextRows,
    } })
  }
  const changeFmeaMode = (fmeaMode: 'aiag'|'classic') => {
    const aiagAnalyses = addClassicRowsToAiag(
      state.rows.fmea,
      normalizedAnalyses,
    )
    patch({
      fmeaMode,
      aiagAnalyses,
      rows: {
        ...state.rows,
        fmea: classicRowsFromAiag(aiagAnalyses, state.rows.fmea),
      },
    })
  }
  const changeAiagAnalyses = (
    nextAnalyses: AIAGVDAFMEAAnalysis[],
  ) => {
    const previousIds = aiagClassicChainIds(normalizedAnalyses)
    const nextIds = aiagClassicChainIds(nextAnalyses)
    const standaloneRows = state.rows.fmea.filter(row => {
      const rowId = String(row.id ?? '').trim()
      return !previousIds.has(rowId) && !nextIds.has(rowId)
    })
    const aiagAnalyses = addClassicRowsToAiag(
      standaloneRows,
      nextAnalyses.map(normalizeFmeaAnalysis),
    )
    patch({
      aiagAnalyses,
      rows: {
        ...state.rows,
        fmea: classicRowsFromAiag(aiagAnalyses, state.rows.fmea),
      },
    })
  }
  const referenceOptions = useMemo((): Record<
    'hazards'|'fracas', ProgramRecordLinkOption[]
  > => ({
    hazards: state.rows.hazards
      .map(row => ({
        id: String(row.id ?? '').trim(),
        label: String(row.title || 'Untitled hazard'),
        detail: String(row.status || ''),
      }))
      .filter(option => option.id),
    fracas: state.rows.fracas
      .map(row => ({
        id: String(row.id ?? '').trim(),
        label: String(row.failureMode || row.system || 'Untitled FRACAS record'),
        detail: String(row.status || ''),
      }))
      .filter(option => option.id),
  }), [state.rows.fracas, state.rows.hazards])
  const navigateToReference = (view: 'hazards'|'fracas', id: string) => {
    setLinkedRecordTarget({ view, id })
    setState(previous => ({ ...previous, view }))
  }
  useEffect(() => {
    if (!linkedRecordTarget || state.view !== linkedRecordTarget.view) return
    const row = Array.from(resultsRef.current?.querySelectorAll<HTMLElement>(
      '[data-program-record-id]') ?? [])
      .find(element =>
        element.dataset.programRecordId === linkedRecordTarget.id)
    if (!row) return
    row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    row.querySelector<HTMLElement>('input, select, button')?.focus({
      preventScroll: true,
    })
  }, [linkedRecordTarget, state.view])
  useEffect(() => {
    if (!bookmarkTarget
        || bookmarkTarget.nonce === appliedBookmark.current
        || bookmarkTarget.source.module !== 'reliabilityProgram') return
    if (bookmarkTarget.source.analysisId
        && bookmarkTarget.source.analysisId !== folios.activeId) return
    const target = bookmarkTarget.source.view
    if (!target?.startsWith('fmea:')) return
    const [, encodedId, section, visual, encodedDiagram] = target.split(':')
    const analysisId = decodeURIComponent(encodedId ?? '')
    if (!normalizedAnalyses.some(item => item.id === analysisId)) return
    appliedBookmark.current = bookmarkTarget.nonce
    setState(previous => ({
      ...previous,
      view: 'fmea',
      fmeaMode: 'aiag',
      activeFmeaId: analysisId,
      fmeaWorkspaceView:
        section === 'worksheet' ? 'worksheet'
        : section === 'control_plan' ? 'control_plan'
        : 'guided',
      fmeaStep: section === 'documentation' ? 7
        : section === 'structure' ? 2
        : section === 'function' ? 3 : previous.fmeaStep,
      fmeaStructureView: section === 'structure' && visual === 'block_diagram'
        ? 'diagram' : previous.fmeaStructureView,
      fmeaFunctionVisualView: section === 'function'
        && ['tree', 'interfaces', 'p_diagram', 'coverage'].includes(visual)
        ? visual as ReliabilityProgramState['fmeaFunctionVisualView']
        : previous.fmeaFunctionVisualView,
      fmeaPDiagramId: encodedDiagram
        ? decodeURIComponent(encodedDiagram) : '',
    }))
  }, [bookmarkTarget, folios.activeId, normalizedAnalyses, setState])
  const programRequirements = useMemo(
    () => state.rows.requirements.map(row => ({
      id: String(row.id), statement: String(row.statement),
      measure: String(row.measure), target: String(row.target),
      confidence: String(row.confidence),
      mission_profile: String(row.missionProfile),
      failure_definition: String(row.failureDefinition),
      verification_method: String(row.verification), owner: String(row.owner),
      status: String(row.status), evidence_ids: list(row.evidence),
    })),
    [state.rows.requirements],
  )
  const request = useMemo((): ReliabilityProgramRequest => ({
    fmea: state.rows.fmea.map(row => ({ id: String(row.id), item: String(row.item), function: String(row.function), failure_mode: String(row.failureMode), local_effect: String(row.localEffect), end_effect: String(row.endEffect), cause: String(row.cause), current_controls: String(row.controls), severity: Number(row.severity), occurrence: Number(row.occurrence), detection: Number(row.detection), recommended_action: String(row.action), action_owner: String(row.owner), action_status: String(row.status), linked_hazard_ids: list(row.hazardLinks), linked_fracas_ids: list(row.fracasLinks), failure_rate: optionalNumber(row.failureRate), mode_ratio: optionalNumber(row.modeRatio), effect_probability: optionalNumber(row.effectProbability), mission_time: optionalNumber(row.missionTime) })),
    hazards: state.rows.hazards.map(row => ({ id: String(row.id), title: String(row.title), description: String(row.description), cause: String(row.cause), initial_probability: String(row.initialProbability) as 'A', initial_severity: String(row.initialSeverity) as 'I', mitigation: String(row.mitigation), verification: String(row.verification), residual_probability: String(row.residualProbability) as 'D', residual_severity: String(row.residualSeverity) as 'III', acceptance_status: String(row.status), acceptance_authority: String(row.authority), linked_fmea_ids: list(row.fmeaLinks) })),
    fracas: state.rows.fracas.map(row => ({ id: String(row.id), system: String(row.system), failure_mode: String(row.failureMode), symptom: String(row.symptom), exposure_at_event: optionalNumber(row.exposure), root_cause: String(row.rootCause), corrective_action: String(row.action), status: String(row.status), action_owner: String(row.owner), effectiveness_verified: Boolean(row.verified), recurrence: Boolean(row.recurrence), downtime: Number(row.downtime) || 0, linked_fmea_ids: list(row.fmeaLinks) })),
    requirements: programRequirements,
    testability_faults: state.rows.testability.map(row => ({ id: String(row.id), description: String(row.description), weight: Number(row.weight), detected: Boolean(row.detected), ambiguity_group_size: Number(row.ambiguity), detecting_test_ids: list(row.tests) })),
    rcm: state.rows.rcm.map(row => ({ id: String(row.id), item: String(row.item), function: String(row.function), functional_failure: String(row.functionalFailure), failure_mode: String(row.failureMode), consequence: String(row.consequence), task_type: String(row.taskType), task_interval: optionalNumber(row.interval), decision_status: String(row.status), rationale: String(row.rationale), linked_fmea_ids: list(row.fmeaLinks) })),
    fmea_analyses: normalizedAnalyses,
    rating_profiles: state.customRatingProfiles ?? [],
    total_exposure: optionalNumber(state.totalExposure), CI: Number(state.ciText),
    isolation_threshold: Number(state.isolationThreshold), medium_rpn: Number(state.mediumRpn), high_rpn: Number(state.highRpn),
  }), [normalizedAnalyses, programRequirements, state])
  const run = async () => {
    setLoading(true); setError(null)
    try { const result = await analyzeReliabilityProgram(request); setState(previous => ({ ...previous, result })) }
    catch (caught: unknown) { setError((caught as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (caught instanceof Error ? caught.message : 'Program analysis failed.')) }
    finally { setLoading(false) }
  }
  return <div className="flex h-full flex-col">
    <FolioBar api={folios} label="Program" />
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="mb-3 rounded border border-blue-100 bg-blue-50 p-2 text-[11px] leading-snug text-blue-800">Closed-loop records share IDs and explicit links. Scores set review priority; linked evidence carries the technical basis.</div>
          {VIEWS.map(view => <button key={view.id} onClick={() => {
            setLinkedRecordTarget(null)
            setState(previous => ({ ...previous, view: view.id }))
          }}
            className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs ${state.view === view.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            <span>{view.label}</span><span className={`rounded px-1.5 py-0.5 text-[10px] ${state.view === view.id ? 'bg-white/20' : 'bg-gray-100'}`}>{view.id === 'fmea' && state.fmeaMode === 'aiag' ? (state.aiagAnalyses ?? []).length : state.rows[view.id].length}</span>
          </button>)}
          {state.view === 'fmea' && <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-1">
            <button onClick={() => changeFmeaMode('aiag')}
              className={`w-1/2 rounded px-2 py-1.5 text-[11px] font-medium ${state.fmeaMode !== 'classic' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
              AIAG–VDA
            </button>
            <button onClick={() => changeFmeaMode('classic')}
              className={`w-1/2 rounded px-2 py-1.5 text-[11px] font-medium ${state.fmeaMode === 'classic' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
              Classic
            </button>
            <p className="px-1 pt-1.5 text-[10px] leading-snug text-slate-400">
              Shared DFMEA/PFMEA content synchronizes automatically. Classic
              retains RPN and FMECA inputs; FMEA-MSR remains AIAG–VDA-only.
            </p>
          </div>}
          <div className="mt-4 border-t border-gray-200 pt-3 space-y-2">
            {state.view === 'fracas' && <><label className="block text-[10px] text-gray-500">FRACAS total exposure<input type="number" min="0" value={state.totalExposure} onChange={event => patch({ totalExposure: event.target.value })} className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" /></label>
              <label className="block text-[10px] text-gray-500">Confidence<ConfidenceInput value={state.ciText} onChange={value => patch({ ciText: value })} className="mt-0.5 w-full" /></label></>}
            {state.view === 'testability' && <label className="block text-[10px] text-gray-500">FFI ambiguity threshold<input type="number" min="1" step="1" value={state.isolationThreshold} onChange={event => patch({ isolationThreshold: event.target.value })} className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" /></label>}
            {state.view === 'fmea' && state.fmeaMode === 'classic' && <div className="grid grid-cols-2 gap-1"><label className="text-[10px] text-gray-500">Medium RPN<input type="number" min="1" value={state.mediumRpn} onChange={event => patch({ mediumRpn: event.target.value })} className="mt-0.5 w-full rounded border border-gray-300 px-1 py-1 text-xs font-mono" /></label><label className="text-[10px] text-gray-500">High RPN<input type="number" min="2" value={state.highRpn} onChange={event => patch({ highRpn: event.target.value })} className="mt-0.5 w-full rounded border border-gray-300 px-1 py-1 text-xs font-mono" /></label></div>}
          </div>
        </div>
        <div className="border-t border-gray-200 p-3">{error && <p className="mb-2 text-xs text-red-600">{error}</p>}<button onClick={run} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"><Play size={14} />{loading ? 'Analyzing…' : 'Analyze program'}</button></div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-gray-50" ref={resultsRef}>
        {state.view === 'fmea' && state.fmeaMode !== 'classic'
          ? <AiagVdaWorkspace
              analyses={normalizedAnalyses}
              predictionSources={predictionSources}
              programRequirements={programRequirements}
              customProfiles={state.customRatingProfiles ?? []}
              vocabularyProfile={state.fmeaVocabularyProfile
                ?? EMPTY_FMEA_VOCABULARY_PROFILE}
              hazardOptions={referenceOptions.hazards}
              fracasOptions={referenceOptions.fracas}
              builtInProfiles={builtInProfiles}
              result={state.result?.aiag_vda_fmea}
              activeId={state.activeFmeaId ?? ''}
              onActiveId={activeFmeaId =>
                setState(previous => ({ ...previous, activeFmeaId }))}
              view={state.fmeaWorkspaceView ?? 'guided'}
              onView={fmeaWorkspaceView =>
                setState(previous => ({ ...previous, fmeaWorkspaceView }))}
              step={state.fmeaStep ?? 1}
              onStep={fmeaStep => setState(previous => ({ ...previous, fmeaStep }))}
              structureView={state.fmeaStructureView ?? 'hierarchy'}
              onStructureView={fmeaStructureView =>
                setState(previous => ({ ...previous, fmeaStructureView }))}
              functionVisualView={state.fmeaFunctionVisualView ?? 'tree'}
              pDiagramId={state.fmeaPDiagramId ?? ''}
              onFunctionVisualView={fmeaFunctionVisualView =>
                setState(previous => ({ ...previous, fmeaFunctionVisualView }))}
              onPDiagramId={fmeaPDiagramId =>
                setState(previous => ({ ...previous, fmeaPDiagramId }))}
              onAnalysesChange={changeAiagAnalyses}
              onProfilesChange={customRatingProfiles => patch({ customRatingProfiles })}
              onVocabularyProfileChange={fmeaVocabularyProfile =>
                patch({ fmeaVocabularyProfile })}
              onNavigateReference={navigateToReference}
              onNavigatePrediction={onNavigatePrediction}
            />
          : <>
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2"><div><h2 className="text-sm font-semibold text-gray-800">{state.view === 'fmea' ? 'Classic FMEA / FMECA' : VIEWS.find(view => view.id === state.view)?.label}</h2><p className="text-[10px] text-gray-400">{state.view === 'fmea' ? 'Shared fields synchronize with DFMEA/PFMEA; FMECA rate inputs remain Classic-only.' : 'Double-entry is avoided through linked record IDs.'}</p></div><div className="flex gap-2"><button onClick={addRow} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600"><Plus size={12} /> Add record</button>{state.result && <ExportResultsButton getElement={() => resultsRef.current} baseName="reliability_program" title="Reliability Program" />}</div></div>
            <EditableTable columns={COLUMNS[state.view]} rows={currentRows}
              updateRow={updateRow} referenceOptions={referenceOptions}
              linkedRecordTarget={linkedRecordTarget}
              onNavigateReference={navigateToReference}
              removeRow={removeRow} />
            {state.result && state.result.traceability.summary.issues > 0 && <div className="mx-4 mt-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"><strong>Traceability needs review:</strong> {state.result.traceability.summary.unknown_references} unknown reference(s) and {state.result.traceability.summary.missing_reciprocal_links} missing reciprocal link(s).<ul className="mt-1 list-disc pl-5">{state.result.traceability.issues.slice(0, 8).map((issue, index) => <li key={`${issue.code}-${issue.source_id}-${issue.target_id}-${index}`}>{issue.source_id} → {issue.target_id}: {issue.code.replace(/_/g, ' ')}</li>)}</ul></div>}
            {state.result && <ProgramResults view={state.view} result={state.result} />}
            {!state.result && currentRows.length === 0 && <div className="flex h-64 items-center justify-center text-sm text-gray-400"><ClipboardCheck size={18} className="mr-2" />Add the first {VIEWS.find(view => view.id === state.view)?.label} record.</div>}
          </>}
      </main>
    </div>
  </div>
}

function EditableTable({
  columns,
  rows,
  updateRow,
  removeRow,
  referenceOptions,
  linkedRecordTarget,
  onNavigateReference,
}: {
  columns: Column[]
  rows: ProgramRow[]
  updateRow: (index: number, key: string, value: Cell) => void
  removeRow: (index: number) => void
  referenceOptions: Record<
    'hazards'|'fracas', ProgramRecordLinkOption[]
  >
  linkedRecordTarget: { view: 'hazards'|'fracas'; id: string }|null
  onNavigateReference: (view: 'hazards'|'fracas', id: string) => void
}) {
  return <div className="overflow-x-auto border-b border-gray-200 bg-white">
    <table className="min-w-max text-xs">
      <thead className="bg-gray-50 text-gray-500"><tr>
        {columns.map(column => <th key={column.key} title={column.title}
          className={`${column.width ?? 'w-32'} px-2 py-1.5 text-left font-medium`}>
          {column.label}
        </th>)}
        <th className="w-8" />
      </tr></thead>
      <tbody>{rows.map((row, index) => {
        const rowId = String(row.id)
        const targeted = linkedRecordTarget?.id === rowId
        return <tr key={rowId} data-program-record-id={rowId}
          className={`border-t border-gray-100 transition ${
            targeted
              ? 'bg-blue-100 ring-1 ring-inset ring-blue-300'
              : 'hover:bg-blue-50/30'
          }`}>
          {columns.map(column => <td key={column.key}
            className={`${column.width ?? 'w-32'} p-0.5 align-top`}>
            {column.type === 'boolean'
              ? <label className="flex justify-center">
                  <input type="checkbox" checked={Boolean(row[column.key])}
                    onChange={event =>
                      updateRow(index, column.key, event.target.checked)} />
                </label>
              : column.type === 'select'
                ? <select value={String(row[column.key] ?? '')}
                    onChange={event =>
                      updateRow(index, column.key, event.target.value)}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-1 outline-none hover:border-gray-200 focus:border-blue-400">
                    {column.options?.map(option =>
                      <option key={option}>{option}</option>)}
                  </select>
                : column.type === 'record-links' && column.referenceView
                  ? <RecordLinkField
                      recordType={column.referenceView === 'hazards'
                        ? 'Hazard' : 'FRACAS'}
                      values={list(row[column.key])}
                      options={referenceOptions[column.referenceView]}
                      onChange={values =>
                        updateRow(index, column.key, values.join(', '))}
                      onNavigate={id =>
                        onNavigateReference(column.referenceView!, id)}
                      compact />
                  : <input type={column.type === 'number' ? 'number' : 'text'}
                      value={String(row[column.key] ?? '')}
                      onChange={event =>
                        updateRow(index, column.key, event.target.value)}
                      className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 outline-none hover:border-gray-200 focus:border-blue-400" />}
          </td>)}
          <td><button onClick={() => removeRow(index)} title="Remove record"
            className="text-gray-300 hover:text-red-500">
            <Trash2 size={12} />
          </button></td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

function ProgramResults({ view, result }: { view: View; result: ReliabilityProgramResponse }) {
  if (view === 'fmea') return <ResultSection warning={result.fmea.rpn_policy.warning} cards={[['Failure modes', result.fmea.summary.total], ['Open actions', result.fmea.summary.open_actions], ['High / severity override', result.fmea.summary.high_or_severity_override], ['Criticality available', result.fmea.summary.criticality_available]]}><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">ID</th><th className="px-2 py-1 text-left">Failure mode</th><th className="px-2 py-1 text-right">S</th><th className="px-2 py-1 text-right">O</th><th className="px-2 py-1 text-right">D</th><th className="px-2 py-1 text-right">RPN</th><th className="px-2 py-1 text-left">Screen</th><th className="px-2 py-1 text-right">Mode criticality</th></tr></thead><tbody>{result.fmea.rows.sort((a,b) => result.fmea.ranked_ids.indexOf(a.id)-result.fmea.ranked_ids.indexOf(b.id)).map(row => <tr key={row.id} className="border-t"><td className="px-2 py-1">{row.id}</td><td className="px-2 py-1">{row.failure_mode}</td><td className="px-2 py-1 text-right">{row.severity}</td><td className="px-2 py-1 text-right">{row.occurrence}</td><td className="px-2 py-1 text-right">{row.detection}</td><td className="px-2 py-1 text-right font-mono">{row.rpn}</td><td className="px-2 py-1">{row.screening_band}</td><td className="px-2 py-1 text-right">{fmt(row.mode_criticality)}</td></tr>)}</tbody></table></ResultSection>
  if (view === 'hazards') return <ResultSection warning={result.hazards.warning} cards={[['Hazards', result.hazards.summary.total], ['Initial high/serious', result.hazards.summary.initial_high_or_serious], ['Residual high/serious', result.hazards.summary.residual_high_or_serious], ['Unaccepted', result.hazards.summary.unaccepted]]}><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">ID</th><th className="px-2 py-1 text-left">Hazard</th><th className="px-2 py-1 text-left">Initial</th><th className="px-2 py-1 text-left">Residual</th><th className="px-2 py-1 text-left">Acceptance</th></tr></thead><tbody>{result.hazards.rows.map(row => <tr key={row.id} className="border-t"><td className="px-2 py-1">{row.id}</td><td className="px-2 py-1">{row.title}</td><td className="px-2 py-1">{row.initial_risk.risk_index} · {row.initial_risk.risk_level}</td><td className="px-2 py-1">{row.residual_risk.risk_index} · {row.residual_risk.risk_level}</td><td className="px-2 py-1">{row.acceptance_status}</td></tr>)}</tbody></table></ResultSection>
  if (view === 'fracas') return <ResultSection warning={result.fracas.warning} cards={[['Records', result.fracas.summary.records], ['Open', result.fracas.summary.open], ['Closure', pct(result.fracas.summary.closure_fraction)], ['Event rate', fmt(result.fracas.exposure_metrics.event_rate)]]}>{result.fracas.pareto_failure_modes.length > 0 && <Plot plotId="fracas-pareto" reportLabel="FRACAS Failure Mode Pareto" data={[{ x: result.fracas.pareto_failure_modes.map(row => row.name), y: result.fracas.pareto_failure_modes.map(row => row.count), type: 'bar', marker: { color: '#2563eb' } } as Plotly.Data]} layout={{ height: 340, margin: { l: 55, r: 20, t: 35, b: 90 }, title: { text: 'FRACAS failure-mode counts' }, xaxis: { tickangle: -30 }, yaxis: { title: { text: 'Records' }, rangemode: 'tozero' } }} style={{ width: '100%', height: 340 }} />}</ResultSection>
  if (view === 'requirements') return <ResultSection warning={result.requirements.warning} cards={[['Requirements', result.requirements.summary.total], ['Complete definitions', result.requirements.summary.complete_definitions], ['With evidence', result.requirements.summary.with_evidence], ['Verification ready', result.requirements.summary.verification_ready]]}><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">ID</th><th className="px-2 py-1 text-left">Missing fields</th><th className="px-2 py-1 text-right">Evidence</th><th className="px-2 py-1 text-left">Status</th><th className="px-2 py-1">Ready</th></tr></thead><tbody>{result.requirements.rows.map(row => <tr key={row.id} className="border-t"><td className="px-2 py-1">{row.id}</td><td className="px-2 py-1">{row.missing_fields.join(', ') || 'None'}</td><td className="px-2 py-1 text-right">{row.evidence_count}</td><td className="px-2 py-1">{row.status}</td><td className="px-2 py-1 text-center">{row.verification_ready ? 'Yes' : 'No'}</td></tr>)}</tbody></table></ResultSection>
  if (view === 'testability') { const test = result.testability; return <ResultSection warning={test?.warning ?? 'Enter a declared fault universe to calculate diagnostic coverage.'} cards={[['Faults', test?.summary.faults ?? 0], ['FFD', pct(test?.summary.fraction_faults_detected)], [`FFI (≤${test?.summary.isolation_threshold ?? 1})`, pct(test?.summary.fraction_faults_isolated)], ['Undetected', test?.summary.undetected_fault_ids.length ?? 0]]}>{test && <table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">Fault</th><th className="px-2 py-1 text-right">Weight</th><th className="px-2 py-1">Detected</th><th className="px-2 py-1 text-right">Ambiguity</th><th className="px-2 py-1">Isolated</th></tr></thead><tbody>{test.rows.map(row => <tr key={row.id} className="border-t"><td className="px-2 py-1">{row.id}</td><td className="px-2 py-1 text-right">{fmt(row.weight)}</td><td className="px-2 py-1 text-center">{row.detected ? 'Yes' : 'No'}</td><td className="px-2 py-1 text-right">{row.ambiguity_group_size}</td><td className="px-2 py-1 text-center">{row.isolation_eligible ? 'Yes' : 'No'}</td></tr>)}</tbody></table>}</ResultSection> }
  return <ResultSection warning={result.rcm.warning} cards={[['RCM items', result.rcm.summary.items], ['Unresolved', result.rcm.summary.unresolved], ['Tasks with interval', result.rcm.summary.with_interval], ['Consequence classes', Object.keys(result.rcm.consequences).length]]}><div className="grid gap-3 md:grid-cols-2"><Breakdown title="Consequences" values={result.rcm.consequences} /><Breakdown title="Selected tasks" values={result.rcm.tasks} /></div></ResultSection>
}

function ResultSection({ warning, cards, children }: { warning: string; cards: [string, string | number][]; children: React.ReactNode }) { return <section className="m-4 space-y-3 rounded-lg border border-gray-200 bg-white p-4"><div className="flex gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"><Info size={14} className="mt-0.5 flex-shrink-0 text-slate-400" /><span><span className="font-medium text-slate-700">Interpretation:</span> {warning}</span></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{cards.map(([label, value]) => <Card key={label} label={label} value={String(value)} />)}</div><div className="overflow-x-auto rounded border border-gray-200">{children}</div></section> }
function Breakdown({ title, values }: { title: string; values: Record<string, number> }) { return <div className="p-3"><h4 className="mb-2 text-xs font-semibold text-gray-700">{title}</h4>{Object.entries(values).map(([key,value]) => <div key={key} className="flex justify-between border-t border-gray-100 py-1 text-xs"><span>{key}</span><span className="font-mono">{value}</span></div>)}</div> }
