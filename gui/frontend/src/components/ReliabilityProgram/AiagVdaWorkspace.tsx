import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  GitBranch,
  GripVertical,
  Link2,
  Maximize2,
  Minimize2,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import type {
  AIAGVDAFMEAAnalysis,
  AIAGVDAFMEAResult,
  FMEAAction,
  FMEAControlPlanRow,
  FMEAFunctionalRequirement,
  FMEAFailureChain,
  FMEAFunction,
  FMEAFunctionLink,
  FMEAFunctionRequirementLink,
  FMEAInterface,
  FMEAKind,
  FMEAPDiagram,
  FMEAPDiagramItem,
  FMEARatingProfile,
  FMEAStructureNode,
  FMEAVocabularyProfile,
  RequirementInput,
} from '../../api/reliabilityProgram'
import {
  FMEA_STEPS,
  FMES_GROUP_DIMENSIONS,
  buildFmesSummary,
  IMPORT_FIELDS,
  arrangeStructureNodes,
  copyFmeaFoundation,
  createFmeaAnalysis,
  detectFmeaMapping,
  exportFmeaCsv,
  exportFmeaXlsx,
  describeFmeaContents,
  hasFmeaContents,
  importedFailureChains,
  indentStructureNode,
  importFunctionWorkbook,
  mergeControlPlanProposal,
  orderedStructureNodes,
  outdentStructureNode,
  recognizedFunctionWorkbookSheets,
  removeStructureNode,
  synchronizeProgramRequirement,
  structureNodeOrdinals,
  readFmeaFile,
  type ColumnMapping,
  type FmesChain,
  type FmesGroupDimension,
  type FmesSummaryGroup,
  type FmeaWorkbookSheets,
  type StructureDropPlacement,
} from './fmeaModel'
import {
  FunctionStatementField,
  OperatingModesField,
  VocabularyManager,
  VocabularyPicker,
  VocabularyTaggedField,
} from './FmeaVocabularyAid'
import { failureModeStarter } from './fmeaVocabulary'
import RecordLinkField, {
  type ProgramRecordLinkOption,
} from './RecordLinkField'
import PredictionStructureImporter, {
  usePredictionStructureCatalogs,
} from './PredictionStructureImporter'
import FmeaBlockDiagramCanvas from './FmeaBlockDiagramCanvas'
import type {
  PredictionAnalysisSource,
} from './predictionStructureImport'
import {
  canSplitImportedPredictionPart,
  detachPredictionStructure,
  predictionSourceEntity,
  predictionSourceStatus,
  refreshPredictionStructure,
  splitImportedPredictionParts,
} from './predictionStructureImport'


type WorkspaceView =
  'guided'|'worksheet'|'control_plan'|'terminology'|'profiles'

const kindLabel = (kind: FMEAKind) =>
  kind === 'fmea_msr' ? 'FMEA-MSR' : kind.toUpperCase()
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const fieldClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100'
const areaClass = `${fieldClass} min-h-16 resize-y`

function OrdinalBadge({
  value,
  title,
}: {
  value: string
  title?: string
}) {
  return <span title={title ?? `Workspace item ${value}`}
    className="inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-1.5 font-mono text-[9px] font-semibold text-slate-500">
    {value}
  </span>
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string
  value: string|number|undefined
  onChange: (value: string) => void
  multiline?: boolean
  placeholder?: string
}) {
  return <label className="block text-[11px] font-medium text-slate-600">
    {label}
    {multiline
      ? <textarea value={value ?? ''} onChange={event => onChange(event.target.value)}
          placeholder={placeholder} className={`mt-1 ${areaClass}`} />
      : <input value={value ?? ''} onChange={event => onChange(event.target.value)}
          placeholder={placeholder} className={`mt-1 ${fieldClass}`} />}
  </label>
}

function RatingSelect({
  label,
  value,
  axis,
  profile,
  onChange,
}: {
  label: string
  value: number|undefined
  axis: string
  profile?: FMEARatingProfile
  onChange: (value: number) => void
}) {
  const criteria = profile?.rating_axes[axis] ?? []
  const selected = criteria.find(item => item.rating === value)
  return <label className="block text-[11px] font-medium text-slate-600">
    {label}
    <select value={value ?? 5} onChange={event => onChange(Number(event.target.value))}
      title={selected?.description} className={`mt-1 ${fieldClass}`}>
      {Array.from({ length: 10 }, (_, index) => index + 1).map(rating => {
        const criterion = criteria.find(item => item.rating === rating)
        return <option key={rating} value={rating}>
          {rating}{criterion ? ` — ${criterion.label}` : ''}
        </option>
      })}
    </select>
    {selected && <span className="mt-1 block font-normal leading-snug text-slate-400">
      {selected.description}
    </span>}
  </label>
}

function priorityClass(value?: string|null) {
  if (value === 'H') return 'border-red-300 bg-red-50 text-red-700'
  if (value === 'M') return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-emerald-300 bg-emerald-50 text-emerald-700'
}

export default function AiagVdaWorkspace({
  analyses,
  predictionSources,
  programRequirements,
  customProfiles,
  vocabularyProfile,
  hazardOptions,
  fracasOptions,
  builtInProfiles,
  result,
  activeId,
  onActiveId,
  view,
  onView,
  step,
  onStep,
  structureView,
  onStructureView,
  functionVisualView,
  pDiagramId,
  onFunctionVisualView,
  onPDiagramId,
  onAnalysesChange,
  onProfilesChange,
  onVocabularyProfileChange,
  onNavigateReference,
  onNavigatePrediction,
}: {
  analyses: AIAGVDAFMEAAnalysis[]
  predictionSources: PredictionAnalysisSource[]
  programRequirements: RequirementInput[]
  customProfiles: FMEARatingProfile[]
  vocabularyProfile: FMEAVocabularyProfile
  hazardOptions: ProgramRecordLinkOption[]
  fracasOptions: ProgramRecordLinkOption[]
  builtInProfiles: FMEARatingProfile[]
  result?: { analyses: AIAGVDAFMEAResult[] }|null
  activeId: string
  onActiveId: (id: string) => void
  view: WorkspaceView
  onView: (view: WorkspaceView) => void
  step: number
  onStep: (step: number) => void
  structureView?: 'hierarchy'|'diagram'
  onStructureView?: (value: 'hierarchy'|'diagram') => void
  functionVisualView?: 'tree'|'interfaces'|'p_diagram'|'coverage'
  pDiagramId?: string
  onFunctionVisualView?: (
    value: 'tree'|'interfaces'|'p_diagram'|'coverage') => void
  onPDiagramId?: (id: string) => void
  onAnalysesChange: (analyses: AIAGVDAFMEAAnalysis[]) => void
  onProfilesChange: (profiles: FMEARatingProfile[]) => void
  onVocabularyProfileChange: (profile: FMEAVocabularyProfile) => void
  onNavigateReference: (view: 'hazards'|'fracas', id: string) => void
  onNavigatePrediction?: (target: {
    analysisId: string
    entityId: string
    pieceKey?: string
  }) => void
}) {
  const [importState, setImportState] = useState<{
    headers: string[]
    rows: Record<string, string>[]
    mapping: ColumnMapping
    sheets?: FmeaWorkbookSheets
  }|null>(null)
  const [message, setMessage] = useState('')
  const [focusedFailureChainId, setFocusedFailureChainId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const active = analyses.find(item => item.id === activeId) ?? analyses[0]
  const activeResult = result?.analyses.find(item => item.id === active?.id)
  const allProfiles = [...builtInProfiles, ...customProfiles]
  const profile = allProfiles.find(item => item.id === active?.rating_profile_id)
  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(() => setMessage(''), 6000)
    return () => window.clearTimeout(timeout)
  }, [message])

  const update = (change: Partial<AIAGVDAFMEAAnalysis>) => {
    if (!active) return
    onAnalysesChange(analyses.map(item =>
      item.id === active.id ? { ...item, ...change } : item))
  }
  const add = (kind: FMEAKind) => {
    const created = createFmeaAnalysis(kind, analyses.length + 1)
    if (kind === 'fmea_msr') {
      const parent = analyses.find(item => item.kind === 'dfmea')
      if (parent) {
        created.parent_dfmea_id = parent.id
        created.source_revision = parent.revision
        created.structure_nodes = structuredClone(parent.structure_nodes)
        created.block_diagram = structuredClone(parent.block_diagram)
        created.functions = structuredClone(parent.functions)
        created.function_links = structuredClone(parent.function_links)
        created.functional_requirements = structuredClone(
          parent.functional_requirements)
        created.function_requirement_links = structuredClone(
          parent.function_requirement_links)
        created.interfaces = structuredClone(parent.interfaces)
        created.p_diagrams = structuredClone(parent.p_diagrams)
        created.failure_chains = parent.failure_chains.map(chain => ({
          ...structuredClone(chain),
          id: uid('MSR-FC'),
          occurrence: undefined,
          detection: undefined,
          frequency: 5,
          monitoring: 5,
          frequency_rationale: '',
          monitoring_rationale: '',
          actions: [],
          post_severity: undefined,
          post_occurrence: undefined,
          post_detection: undefined,
        }))
      }
    }
    onAnalysesChange([...analyses, created])
    onActiveId(created.id)
    onView('guided')
    onStep(1)
  }
  const removeActive = () => {
    if (!active) return
    if (hasFmeaContents(active)) {
      const contents = describeFmeaContents(active)
      const confirmed = window.confirm(
        `Delete ${kindLabel(active.kind)} sheet “${active.name}”?\n\n`
        + `It contains ${contents.join(', ')}. Deleting the sheet removes all of this data.`,
      )
      if (!confirmed) return
    }
    const next = analyses.filter(item => item.id !== active.id)
    onAnalysesChange(next)
    onActiveId(next[0]?.id ?? '')
  }
  const copyFoundation = async () => {
    if (!active) return
    const copy = await copyFmeaFoundation(active, analyses.length + 1)
    onAnalysesChange([...analyses, copy])
    onActiveId(copy.id)
    setMessage(`Created a traceable working copy of ${active.id} revision ${active.revision}.`)
  }
  const updateChain = (chainId: string, change: Partial<FMEAFailureChain>) => {
    if (!active) return
    update({ failure_chains: active.failure_chains.map(chain =>
      chain.id === chainId ? { ...chain, ...change } : chain) })
  }
  const addFailureChainForFunction = (
    functionId: string,
    relatedTo?: FMEAFailureChain,
  ) => {
    if (!active) return
    const created = relatedTo
      ? relatedFailureCase(active.kind, relatedTo)
      : { ...blankChain(active.kind), function_id: functionId }
    const sourceIndex = relatedTo
      ? active.failure_chains.findIndex(item => item.id === relatedTo.id)
      : -1
    const failure_chains = [...active.failure_chains]
    if (sourceIndex >= 0) failure_chains.splice(sourceIndex + 1, 0, created)
    else failure_chains.push(created)
    update({ failure_chains })
    setFocusedFailureChainId(created.id)
    onView('guided')
    onStep(4)
  }

  if (!active) return <div className="flex min-h-[520px] items-center justify-center p-8">
    <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <ShieldCheck size={36} className="mx-auto mb-3 text-blue-600" />
      <h3 className="text-lg font-semibold text-slate-800">Start an AIAG–VDA-aligned FMEA</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        Use the seven-step workflow for a design, process, or supplemental
        monitoring-and-system-response analysis. Classic FMEA/FMECA remains
        available as a separate method.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {(['dfmea', 'pfmea', 'fmea_msr'] as FMEAKind[]).map(kind =>
          <button key={kind} onClick={() => add(kind)}
            className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700">
            New {kindLabel(kind)}
          </button>)}
      </div>
    </div>
  </div>

  const readiness = activeResult?.step_readiness ?? []
  const exportMenu = <details className="relative">
    <summary className="flex cursor-pointer list-none items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 hover:border-blue-400">
      <Download size={13} /> Export <ChevronDown size={12} />
    </summary>
    <div className="absolute right-0 z-30 mt-1 w-36 rounded border border-slate-200 bg-white p-1 shadow-lg">
      <button onClick={() => void exportFmeaCsv(active)}
        className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100">Worksheet CSV</button>
      <button onClick={() => void exportFmeaXlsx(active)}
        className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100">Worksheet XLSX</button>
    </div>
  </details>

  return <div className="min-w-0">
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <select value={active.id} onChange={event => {
          const next = analyses.find(item => item.id === event.target.value)
          onActiveId(event.target.value)
          if (view === 'control_plan' && next?.kind !== 'pfmea') onView('guided')
        }}
          className="max-w-64 rounded border border-slate-300 px-2 py-1.5 text-xs font-medium">
          {analyses.map(item => <option key={item.id} value={item.id}>
            {item.name} · {kindLabel(item.kind)} · Rev {item.revision}
          </option>)}
        </select>
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white">
            <Plus size={13} /> New <ChevronDown size={12} />
          </summary>
          <div className="absolute left-0 z-30 mt-1 w-36 rounded border bg-white p-1 shadow-lg">
            {(['dfmea', 'pfmea', 'fmea_msr'] as FMEAKind[]).map(kind =>
              <button key={kind} onClick={() => add(kind)}
                className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                {kindLabel(kind)}
              </button>)}
          </div>
        </details>
        <button onClick={() => void copyFoundation()}
          title="Create an independent, traceable foundation copy"
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:border-blue-400">
          <ClipboardCopy size={13} /> Foundation copy
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:border-blue-400">
          <Upload size={13} /> Import
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden"
          onChange={async event => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              const data = await readFmeaFile(file)
              setImportState({ ...data, mapping: detectFmeaMapping(data.headers) })
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Import failed.')
            } finally {
              event.target.value = ''
            }
          }} />
        {exportMenu}
        <button onClick={removeActive} title="Delete FMEA sheet"
          className="ml-auto rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1.5">
        {(['guided', 'worksheet', ...(active.kind === 'pfmea' ? ['control_plan'] : []), 'terminology', 'profiles'] as WorkspaceView[])
          .map(item => <button key={item} onClick={() => onView(item)}
            className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium ${
              view === item ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
            {item === 'guided' ? 'Seven steps' :
             item === 'control_plan' ? 'Control Plan' :
             item === 'terminology' ? 'Project terminology' :
             item === 'profiles' ? 'Rating profiles' : 'Consolidated worksheet'}
          </button>)}
      </div>
    </div>

    {message && <div role="status"
      className="mx-4 mt-3 flex items-start gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={() => setMessage('')}
        aria-label="Dismiss notice"
        className="-mr-1 rounded p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-800">
        <X size={13} />
      </button>
    </div>}

    {view === 'guided' && <>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {FMEA_STEPS.map((label, index) => {
          const status = readiness.find(item => item.step === index + 1)
          return <button key={label} onClick={() => onStep(index + 1)}
            title={status ? `${status.errors} error(s), ${status.warnings} warning(s)` : 'Run analysis to check readiness'}
            className={`min-w-0 border-r border-slate-200 px-1 py-2 text-center ${
              step === index + 1 ? 'bg-white text-blue-700' : 'text-slate-500 hover:bg-white/70'}`}>
            <span className={`mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
              status?.ready ? 'bg-emerald-100 text-emerald-700' :
              status ? 'bg-red-100 text-red-700' :
              step === index + 1 ? 'bg-blue-100 text-blue-700' : 'bg-slate-200'}`}>
              {status?.ready ? <Check size={11} /> : index + 1}
            </span>
            <span className="block truncate text-[10px]">{label}</span>
          </button>
        })}
      </div>
      <div className="p-4">
        {step === 1 && <PlanningStep analysis={active} analyses={analyses} update={update} />}
        {step === 2 && <StructureStep analysis={active}
          predictionSources={predictionSources} update={update}
          initialView={structureView}
          onViewChange={onStructureView}
          onNavigatePrediction={onNavigatePrediction} />}
        {step === 3 && <FunctionStep analysis={active}
          result={activeResult} programRequirements={programRequirements}
          vocabularyProfile={vocabularyProfile}
          onAddFailureMode={functionId =>
            addFailureChainForFunction(functionId)}
          update={update} onStep={onStep}
          initialVisualView={functionVisualView}
          initialPDiagramId={pDiagramId}
          onVisualViewChange={onFunctionVisualView}
          onPDiagramIdChange={onPDiagramId} />}
        {step === 4 && <FailureStep analysis={active}
          vocabularyProfile={vocabularyProfile}
          hazardOptions={hazardOptions} fracasOptions={fracasOptions}
          onNavigateReference={onNavigateReference}
          focusedChainId={focusedFailureChainId}
          onFocusHandled={() => setFocusedFailureChainId('')}
          onAddFailureMode={functionId =>
            addFailureChainForFunction(functionId)}
          onAddRelatedCase={chain =>
            addFailureChainForFunction(chain.function_id ?? '', chain)}
          update={update} updateChain={updateChain} />}
        {step === 5 && <RiskStep analysis={active} profile={profile}
          result={activeResult} vocabularyProfile={vocabularyProfile}
          update={update} updateChain={updateChain} />}
        {step === 6 && <OptimizationStep analysis={active} result={activeResult}
          profile={profile} update={update} updateChain={updateChain} />}
        {step === 7 && <DocumentationStep analysis={active} result={activeResult} update={update} />}
      </div>
    </>}
    {view === 'worksheet' && <Worksheet analysis={active} result={activeResult}
      updateChain={updateChain} profile={profile} />}
    {view === 'control_plan' && <ControlPlanView analysis={active}
      result={activeResult} update={update} />}
    {view === 'terminology' &&
      <div className="p-4">
        <VocabularyManager profile={vocabularyProfile}
          onChange={onVocabularyProfileChange} />
      </div>}
    {view === 'profiles' && <ProfileManager analysis={active}
      profiles={allProfiles} customProfiles={customProfiles}
      update={update} onProfilesChange={onProfilesChange} />}
    {importState && <ImportMapping state={importState}
      kind={active.kind}
      onMapping={mapping => setImportState({ ...importState, mapping })}
      onCancel={() => setImportState(null)}
      onImportWorkbook={() => {
        const imported = importFunctionWorkbook(
          active, importState.sheets ?? {})
        const sections = recognizedFunctionWorkbookSheets(importState.sheets)
        update(imported)
        setImportState(null)
        setMessage(
          `Imported ${sections.join(', ')} into ${active.name}. `
          + 'Existing failure chains were preserved.',
        )
        onStep(3)
        onView('guided')
      }}
      onImport={() => {
        const chains = importedFailureChains(
          importState.rows, importState.mapping, active.kind)
        update({ failure_chains: [...active.failure_chains, ...chains] })
        setImportState(null)
        setMessage(`Imported ${chains.length} failure chain(s). Review ratings and rationales before finalizing.`)
      }} />}
  </div>
}

function PlanningStep({
  analysis,
  analyses,
  update,
}: {
  analysis: AIAGVDAFMEAAnalysis
  analyses: AIAGVDAFMEAAnalysis[]
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
}) {
  const plan = analysis.planning
  const setPlan = (change: Partial<typeof plan>) =>
    update({ planning: { ...plan, ...change } })
  return <section className="space-y-4">
    <StepHeading number={1} title="Planning and preparation"
      text="Establish the decision scope, boundaries, team, timing, and method basis before assigning ratings." />
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
      <div className="md:col-span-3">
        <OrdinalBadge value="PLAN1" title="Planning record 1" />
      </div>
      <Field label="Analysis name" value={analysis.name} onChange={name => update({ name })} />
      <Field label="Revision" value={analysis.revision} onChange={revision => update({ revision })} />
      <label className="text-[11px] font-medium text-slate-600">Lifecycle status
        <select value={analysis.status} onChange={event =>
          update({ status: event.target.value as AIAGVDAFMEAAnalysis['status'] })}
          className={`mt-1 ${fieldClass}`}>
          <option value="draft">Draft</option><option value="in_review">In review</option>
          <option value="finalized">Finalized</option>
        </select>
      </label>
      <Field label="Company" value={plan.company} onChange={company => setPlan({ company })} />
      <Field label="Location" value={plan.location} onChange={location => setPlan({ location })} />
      <Field label="Customer / stakeholder" value={plan.customer} onChange={customer => setPlan({ customer })} />
      <Field label="Model / program" value={plan.model_program} onChange={model_program => setPlan({ model_program })} />
      <Field label="Subject *" value={plan.subject} onChange={subject => setPlan({ subject })} />
      <Field label="Owner" value={plan.owner} onChange={owner => setPlan({ owner })} />
      <div className="md:col-span-2"><Field multiline label="Scope *" value={plan.scope}
        onChange={scope => setPlan({ scope })} /></div>
      <Field multiline label="Exclusions" value={plan.exclusions}
        onChange={exclusions => setPlan({ exclusions })} />
      <div className="md:col-span-2"><Field multiline label="Intent *" value={plan.intent}
        onChange={intent => setPlan({ intent })} /></div>
      <Field multiline label="Assumptions" value={plan.assumptions}
        onChange={assumptions => setPlan({ assumptions })} />
      <Field label="Timing / milestones" value={plan.timing} onChange={timing => setPlan({ timing })} />
      <Field label="Tasks / deliverables" value={plan.tasks} onChange={tasks => setPlan({ tasks })} />
      <Field label="Tools / evidence sources" value={plan.tools} onChange={tools => setPlan({ tools })} />
      <Field label="Cross-functional team (comma-separated)" value={plan.team.join(', ')}
        onChange={value => setPlan({ team: value.split(',').map(item => item.trim()).filter(Boolean) })} />
      <Field label="Start date" value={plan.start_date} onChange={start_date => setPlan({ start_date })} />
      <Field label="Revision date" value={plan.revision_date} onChange={revision_date => setPlan({ revision_date })} />
    </div>
    {analysis.kind === 'fmea_msr' && <div className="grid gap-3 rounded-lg border border-purple-200 bg-purple-50/40 p-4 md:grid-cols-2">
      <label className="text-[11px] font-medium text-slate-600">Source DFMEA
        <select value={analysis.parent_dfmea_id ?? ''} onChange={event => {
          const parent = analyses.find(item => item.id === event.target.value)
          update({ parent_dfmea_id: parent?.id, source_revision: parent?.revision })
        }} className={`mt-1 ${fieldClass}`}>
          <option value="">Standalone</option>
          {analyses.filter(item => item.kind === 'dfmea').map(item =>
            <option key={item.id} value={item.id}>{item.name} · Rev {item.revision}</option>)}
        </select>
      </label>
      {!analysis.parent_dfmea_id && <Field multiline label="Standalone scope justification *"
        value={analysis.standalone_justification}
        onChange={standalone_justification => update({ standalone_justification })} />}
      {analysis.parent_dfmea_id && <div className="text-xs text-purple-800">
        <div className="font-medium">Linked supplement</div>
        <div className="mt-1">Source revision: {analysis.source_revision || 'not recorded'}</div>
        <div className="mt-1 text-[11px] text-purple-600">Perdura flags the link when the source DFMEA revision changes.</div>
      </div>}
    </div>}
    {analysis.template_source_id && <details
      className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">
        Foundation provenance
      </summary>
      <div className="mt-2 leading-relaxed">
        Source {analysis.template_source_id} · revision{' '}
        {analysis.template_source_revision} · checksum{' '}
        <span className="font-mono">
          {analysis.template_source_checksum?.slice(0, 16)}…
        </span>. This analysis is an independent copy; later source changes do
        not overwrite it.
      </div>
    </details>}
  </section>
}

function StructureStep({
  analysis,
  predictionSources,
  update,
  initialView,
  onViewChange,
  onNavigatePrediction,
}: {
  analysis: AIAGVDAFMEAAnalysis
  predictionSources: PredictionAnalysisSource[]
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
  initialView?: 'hierarchy'|'diagram'
  onViewChange?: (value: 'hierarchy'|'diagram') => void
  onNavigatePrediction?: (target: {
    analysisId: string
    entityId: string
    pieceKey?: string
  }) => void
}) {
  const levels = analysis.kind === 'pfmea'
    ? ['process_item', 'process_step', 'work_element', 'interface']
    : ['next_higher', 'focus', 'next_lower', 'interface']
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [draggedNodeId, setDraggedNodeId] = useState('')
  const [structureView, setStructureView] = useState<'hierarchy'|'diagram'>(
    initialView ?? 'hierarchy',
  )
  useEffect(() => {
    setStructureView(initialView ?? 'hierarchy')
  }, [analysis.id, initialView])
  const selectStructureView = (value: 'hierarchy'|'diagram') => {
    setStructureView(value)
    onViewChange?.(value)
  }
  const [dropHint, setDropHint] = useState<{
    targetId?: string
    placement: StructureDropPlacement
  }|null>(null)
  const predictionCatalogs = usePredictionStructureCatalogs(predictionSources)
  const orderedNodes = useMemo(
    () => orderedStructureNodes(analysis.structure_nodes),
    [analysis.structure_nodes],
  )
  const structureOrdinals = useMemo(
    () => structureNodeOrdinals(analysis.structure_nodes),
    [analysis.structure_nodes],
  )
  const depthById = useMemo(() => {
    const byId = new Map(analysis.structure_nodes.map(node => [node.id, node]))
    const result = new Map<string, number>()
    const depth = (node: FMEAStructureNode) => {
      if (result.has(node.id)) return result.get(node.id)!
      const visited = new Set([node.id])
      let current = node
      let value = 0
      while (current.parent_id && byId.has(current.parent_id)) {
        if (visited.has(current.parent_id)) break
        visited.add(current.parent_id)
        value += 1
        current = byId.get(current.parent_id)!
      }
      result.set(node.id, value)
      return value
    }
    for (const node of analysis.structure_nodes) depth(node)
    return result
  }, [analysis.structure_nodes])
  const childrenById = useMemo(() => {
    const result = new Map<string, FMEAStructureNode[]>()
    for (const node of analysis.structure_nodes) {
      if (!node.parent_id) continue
      result.set(node.parent_id, [...(result.get(node.parent_id) ?? []), node])
    }
    return result
  }, [analysis.structure_nodes])
  const visibleNodes = useMemo(() => {
    const byId = new Map(analysis.structure_nodes.map(node => [node.id, node]))
    return orderedNodes.filter(node => {
      const visited = new Set<string>()
      let parentId = node.parent_id
      while (parentId && byId.has(parentId)) {
        if (collapsedNodeIds.has(parentId)) return false
        if (visited.has(parentId)) break
        visited.add(parentId)
        parentId = byId.get(parentId)?.parent_id
      }
      return true
    })
  }, [analysis.structure_nodes, collapsedNodeIds, orderedNodes])
  useEffect(() => {
    if (selectedNodeId
      && analysis.structure_nodes.some(node => node.id === selectedNodeId)) return
    setSelectedNodeId(orderedNodes[0]?.id ?? '')
  }, [analysis.structure_nodes, orderedNodes, selectedNodeId])
  const changeNode = (id: string, change: Partial<FMEAStructureNode>) => {
    const block_diagram = 'name' in change
      ? {
          ...analysis.block_diagram,
          nodes: analysis.block_diagram.nodes.map(item =>
            item.structure_node_id === id
              ? { ...item, label: change.name ?? item.label }
              : item),
        }
      : analysis.block_diagram
    update({
      structure_nodes: analysis.structure_nodes.map(item =>
        item.id === id ? { ...item, ...change } : item),
      block_diagram,
    })
  }
  const revealBranch = (
    nodeId: string,
    nodes: FMEAStructureNode[] = analysis.structure_nodes,
  ) => {
    const byId = new Map(nodes.map(node => [node.id, node]))
    const ancestors = new Set<string>()
    let parentId = byId.get(nodeId)?.parent_id
    while (parentId && byId.has(parentId) && !ancestors.has(parentId)) {
      ancestors.add(parentId)
      parentId = byId.get(parentId)?.parent_id
    }
    setCollapsedNodeIds(current => {
      const next = new Set(current)
      for (const id of ancestors) next.delete(id)
      return next
    })
  }
  const selectNode = (nodeId: string) => {
    revealBranch(nodeId)
    setSelectedNodeId(nodeId)
  }
  const addNode = ({
    parentId,
    afterId,
    level,
  }: {
    parentId?: string
    afterId?: string
    level: string
  }) => {
    const node: FMEAStructureNode = {
      id: uid('ST'),
      name: '',
      level,
      parent_id: parentId,
      description: '',
      interface: '',
    }
    const structure_nodes = [...analysis.structure_nodes]
    const afterIndex = afterId
      ? structure_nodes.findIndex(item => item.id === afterId)
      : -1
    if (afterIndex >= 0) structure_nodes.splice(afterIndex + 1, 0, node)
    else structure_nodes.push(node)
    update({ structure_nodes })
    if (parentId) {
      setCollapsedNodeIds(current => {
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }
    setSelectedNodeId(node.id)
  }
  const deleteNode = (node: FMEAStructureNode) => {
    const childCount = childrenById.get(node.id)?.length ?? 0
    const functionCount = analysis.functions.filter(
      item => item.structure_node_id === node.id,
    ).length
    if ((childCount || functionCount) && !window.confirm(
      `Delete "${node.name || 'Unnamed element'}"?\n\n`
      + (childCount
        ? `${childCount} direct child item(s) will move up one level. `
        : '')
      + (functionCount
        ? `${functionCount} function allocation(s) will be cleared.`
        : ''),
    )) return
    const removedBlockIds = new Set(analysis.block_diagram.nodes
      .filter(item => item.structure_node_id === node.id)
      .map(item => item.id))
    update({
      structure_nodes: removeStructureNode(analysis.structure_nodes, node.id),
      functions: analysis.functions.map(item =>
        item.structure_node_id === node.id
          ? { ...item, structure_node_id: '' }
          : item),
      block_diagram: {
        ...analysis.block_diagram,
        nodes: analysis.block_diagram.nodes.filter(
          item => !removedBlockIds.has(item.id)),
      },
      interfaces: analysis.interfaces.filter(item =>
        !removedBlockIds.has(item.source_block_id ?? '')
        && !removedBlockIds.has(item.target_block_id ?? '')),
    })
    setCollapsedNodeIds(current => {
      const next = new Set(current)
      next.delete(node.id)
      return next
    })
    setSelectedNodeId(node.parent_id ?? '')
  }
  const semanticChildLevel = (node: FMEAStructureNode) => {
    const currentIndex = levels.indexOf(node.level)
    const lastStructuralLevel = Math.max(0, levels.length - 2)
    return levels[Math.min(
      currentIndex >= 0 ? currentIndex + 1 : 1,
      lastStructuralLevel,
    )]
  }
  const dropNode = (
    targetId: string | undefined,
    placement: StructureDropPlacement,
  ) => {
    const structure_nodes = arrangeStructureNodes(
      analysis.structure_nodes,
      draggedNodeId,
      targetId,
      placement,
    )
    if (structure_nodes !== analysis.structure_nodes) {
      update({ structure_nodes })
      revealBranch(draggedNodeId, structure_nodes)
      setSelectedNodeId(draggedNodeId)
    }
    setDraggedNodeId('')
    setDropHint(null)
  }
  return <section className="space-y-4">
    <StepHeading number={2} title="Structure analysis"
      text="Build the analysis structure directly in the hierarchy. Add, edit, reorder, promote, and demote blocks to define the system or process decomposition." />
    {analysis.kind !== 'pfmea' && <PredictionStructureImporter
      nodes={analysis.structure_nodes}
      sources={predictionSources}
      catalogs={predictionCatalogs}
      update={structure_nodes => update({ structure_nodes })}
      onNavigatePrediction={onNavigatePrediction}
    />}
    <div className="flex w-fit items-center rounded-lg border border-slate-200 bg-white p-1">
      <button type="button" onClick={() => selectStructureView('hierarchy')}
        className={`rounded px-3 py-1.5 text-xs font-medium ${
          structureView === 'hierarchy'
            ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'
        }`}>
        Structure hierarchy
      </button>
      <button type="button" onClick={() => selectStructureView('diagram')}
        className={`rounded px-3 py-1.5 text-xs font-medium ${
          structureView === 'diagram'
            ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'
        }`}>
        Block diagram
      </button>
    </div>
    {structureView === 'diagram'
      ? <FmeaBlockDiagramCanvas analysis={analysis} update={update} />
      : <div aria-label="Interactive FMEA structure hierarchy"
      className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-slate-800">
            Structure hierarchy
          </div>
          <div className="text-[10px] text-slate-400">
            Select a block to edit it. Drag the grip to reorder or reparent.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] text-slate-400">
            {orderedNodes.length} item(s)
          </span>
          {analysis.structure_nodes.length > 0 && <>
            <button type="button" onClick={() => setCollapsedNodeIds(new Set())}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50">
              Expand all
            </button>
            <button type="button" onClick={() => {
              setCollapsedNodeIds(new Set(childrenById.keys()))
              setSelectedNodeId(orderedNodes.find(
                node => !node.parent_id
                  || !analysis.structure_nodes.some(
                    item => item.id === node.parent_id,
                  ),
              )?.id ?? orderedNodes[0]?.id ?? '')
            }} className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50">
              Collapse all
            </button>
          </>}
          <button type="button" onClick={() => addNode({
            level: levels[0],
          })} className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-blue-700">
            <Plus size={11} /> Add top-level block
          </button>
        </div>
      </div>
      <div className="space-y-2 overflow-x-auto p-3">
        {draggedNodeId && <div onDragOver={event => {
          if (!draggedNodeId) return
          event.preventDefault()
          setDropHint({ placement: 'root' })
        }} onDrop={event => {
          event.preventDefault()
          dropNode(undefined, 'root')
        }} className={`rounded border border-dashed px-3 py-1.5 text-center text-[10px] transition ${
          dropHint?.placement === 'root'
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : 'border-slate-200 text-slate-400'
        }`}>
          Drop here to make a top-level item
        </div>}
        {visibleNodes.map((node, index) => {
          const activeHint = dropHint?.targetId === node.id
            ? dropHint.placement
            : undefined
          const selected = selectedNodeId === node.id
          const children = childrenById.get(node.id) ?? []
          const collapsed = collapsedNodeIds.has(node.id)
          const siblingNodes = analysis.structure_nodes.filter(item =>
            (item.parent_id ?? '') === (node.parent_id ?? ''))
          const siblingIndex = siblingNodes.findIndex(item => item.id === node.id)
          const canIndent = !node.source_ref && siblingIndex > 0
          const canOutdent = !node.source_ref && !!node.parent_id
          const sourceCatalog = predictionCatalogs.find(item =>
            item.analysisId === node.source_ref?.analysis_id)
          const sourceStatus = predictionSourceStatus(node, sourceCatalog)
          const sourceEntity = predictionSourceEntity(node, sourceCatalog)
          const canSplitPredictionPart = canSplitImportedPredictionPart(
            node,
            sourceCatalog,
          )
          const sourceParentAvailable = !sourceEntity?.parentId
            || analysis.structure_nodes.some(item =>
              item.source_ref?.analysis_id === node.source_ref?.analysis_id
              && item.source_ref?.entity_id === sourceEntity.parentId)
          const depth = depthById.get(node.id) ?? 0
          return <div key={node.id} style={{ marginLeft: depth * 20 }}
            className={`relative min-w-[520px] rounded-lg border bg-white shadow-sm transition ${
              selected
                ? 'border-blue-400 ring-2 ring-blue-100'
                : activeHint === 'inside'
                  ? 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-100'
                  : 'border-slate-200 hover:border-slate-300'
            }`}>
            {depth > 0 && <span aria-hidden="true"
              className="absolute -left-3 top-0 h-5 w-3 rounded-bl border-b border-l border-slate-300" />}
            {activeHint === 'before' && <span
              className="absolute -top-0.5 left-0 right-0 h-0.5 rounded bg-blue-500" />}
            {activeHint === 'after' && <span
              className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded bg-blue-500" />}
            <div onDragOver={event => {
              if (!draggedNodeId) return
              const bounds = event.currentTarget.getBoundingClientRect()
              const ratio = (event.clientY - bounds.top) / bounds.height
              const placement: StructureDropPlacement = ratio < 0.24
                ? 'before'
                : ratio > 0.76
                  ? 'after'
                  : 'inside'
              if (arrangeStructureNodes(
                analysis.structure_nodes,
                draggedNodeId,
                node.id,
                placement,
              ) === analysis.structure_nodes) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropHint({ targetId: node.id, placement })
            }} onDrop={event => {
              event.preventDefault()
              if (activeHint) dropNode(node.id, activeHint)
            }} onClick={() => selectNode(node.id)}
              className={`flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 ${
                selected ? 'bg-blue-50/60' : ''
              }`}>
              <span draggable={!node.source_ref}
                onDragStart={event => {
                  if (node.source_ref) return
                  setDraggedNodeId(node.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', node.id)
                }}
                onDragEnd={() => {
                  setDraggedNodeId('')
                  setDropHint(null)
                }}
                onClick={event => event.stopPropagation()}
                title={node.source_ref
                  ? 'Detach this managed Prediction item before rearranging it'
                  : 'Drag to rearrange the structure hierarchy'}
                aria-label={`Drag structure item ${index + 1}`}
                className={`rounded p-0.5 text-slate-300 ${
                  node.source_ref
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-grab hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing'
                }`}>
                <GripVertical size={13} />
              </span>
              <button type="button" disabled={children.length === 0}
                onClick={event => {
                  event.stopPropagation()
                  if (!children.length) return
                  setCollapsedNodeIds(current => {
                    const next = new Set(current)
                    if (next.has(node.id)) next.delete(node.id)
                    else next.add(node.id)
                    return next
                  })
                  setSelectedNodeId(node.id)
                }}
                aria-label={collapsed ? 'Expand branch' : 'Collapse branch'}
                className="rounded p-0.5 text-slate-400 disabled:opacity-20">
                {collapsed
                  ? <ChevronRight size={13} />
                  : <ChevronDown size={13} />}
              </button>
              <OrdinalBadge value={`S${structureOrdinals.get(node.id) ?? index + 1}`}
                title={`Structure item ${structureOrdinals.get(node.id) ?? index + 1}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-slate-800">
                  {node.name || 'Unnamed element'}
                </div>
                {!selected && (node.description || node.interface) && <div
                  className="truncate text-[10px] text-slate-400">
                  {node.description || `Interface: ${node.interface}`}
                </div>}
              </div>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] capitalize text-slate-500">
                {node.level.replace(/_/g, ' ')}
              </span>
              {sourceStatus && <button type="button" title={
                sourceStatus === 'current'
                  ? `Managed snapshot from ${node.source_ref?.analysis_name}`
                  : sourceStatus === 'changed'
                    ? 'The linked Failure Rate Prediction record has changed'
                    : 'The linked Prediction analysis or record is unavailable'
              } disabled={!onNavigatePrediction || sourceStatus === 'missing'}
                onClick={event => {
                  event.stopPropagation()
                  if (!node.source_ref || sourceStatus === 'missing') return
                  onNavigatePrediction?.({
                    analysisId: node.source_ref.analysis_id,
                    entityId: node.source_ref.entity_id,
                    pieceKey: node.source_ref.piece_key,
                  })
                }} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                sourceStatus === 'current'
                  ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                  : sourceStatus === 'changed'
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-red-100 text-red-700'
              }`}>
                {sourceStatus === 'current' ? 'Prediction linked'
                  : sourceStatus === 'changed' ? 'Source changed' : 'Source missing'}
                {sourceStatus !== 'missing' && <ExternalLink size={9} />}
              </button>}
              {children.length > 0 && <span className="text-[9px] text-slate-400">
                {children.length} child{children.length === 1 ? '' : 'ren'}
              </span>}
              <span className="text-[9px] text-slate-400">
                Level {depth + 1}
              </span>
            </div>
            {selected && <div
              className="space-y-2 border-t border-blue-100 px-3 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => addNode({
                  parentId: node.id,
                  level: semanticChildLevel(node),
                })} className="flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-[10px] text-blue-700 hover:bg-blue-50">
                  <Plus size={10} /> Add child
                </button>
                <button type="button" onClick={() => addNode({
                  parentId: node.parent_id,
                  afterId: node.id,
                  level: node.level,
                })} className="flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-[10px] text-blue-700 hover:bg-blue-50">
                  <Plus size={10} /> Add sibling
                </button>
                <button type="button" disabled={!canIndent} onClick={() => {
                  const structure_nodes = indentStructureNode(
                    analysis.structure_nodes,
                    node.id,
                  )
                  if (structure_nodes !== analysis.structure_nodes) {
                    update({ structure_nodes })
                    revealBranch(node.id, structure_nodes)
                  }
                }} title={node.source_ref
                  ? 'Detach this managed Prediction item before rearranging it'
                  : 'Demote this block under its preceding sibling'}
                  className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35">
                  Demote
                </button>
                <button type="button" disabled={!canOutdent} onClick={() => {
                  const structure_nodes = outdentStructureNode(
                    analysis.structure_nodes,
                    node.id,
                  )
                  if (structure_nodes !== analysis.structure_nodes) {
                    update({ structure_nodes })
                    revealBranch(node.id, structure_nodes)
                  }
                }} title={node.source_ref
                  ? 'Detach this managed Prediction item before rearranging it'
                  : 'Promote this block up one hierarchy level'}
                  className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35">
                  Promote
                </button>
                <button type="button" onClick={() => deleteNode(node)}
                  className="ml-auto flex items-center gap-1 rounded border border-red-100 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50">
                  <Trash2 size={10} /> Delete
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_220px]">
                <label className="text-[10px] text-slate-500">Block name
                  <input value={node.name} readOnly={!!node.source_ref}
                    title={node.source_ref
                      ? 'Name is managed by the linked Prediction record; detach to edit'
                      : undefined}
                    autoFocus={!node.name}
                    onChange={event =>
                      changeNode(node.id, { name: event.target.value })}
                    placeholder="Element name"
                    className={`mt-1 ${fieldClass} ${
                      node.source_ref ? 'bg-slate-50 text-slate-500' : ''
                    }`} />
                </label>
                <label className="text-[10px] text-slate-500">Structure level
                  <select value={node.level} onChange={event =>
                    changeNode(node.id, { level: event.target.value })}
                    className={`mt-1 ${fieldClass}`}>
                    {levels.map(level => <option key={level} value={level}>
                      {level.replace(/_/g, ' ')}
                    </option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Field multiline label="Description / boundary"
                  value={node.description} onChange={description =>
                    changeNode(node.id, { description })} />
                <Field multiline label="Interface"
                  value={node.interface} onChange={interfaceValue =>
                    changeNode(node.id, { interface: interfaceValue })} />
              </div>
              {analysis.kind === 'pfmea' && <label
                className="block text-[10px] text-slate-500">4M type
                <select value={node.element_type ?? ''}
                  onChange={event =>
                    changeNode(node.id, { element_type: event.target.value })}
                  className={`mt-1 ${fieldClass}`}>
                  <option value="">Required for work elements</option>
                  <option value="man">Man / operator</option>
                  <option value="machine">Machine</option>
                  <option value="material">Material</option>
                  <option value="environment">Environment</option>
                </select>
              </label>}
              {node.source_ref && <div
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-blue-50/60 px-2 py-1.5 text-[9px] text-slate-500">
                <button type="button"
                  disabled={!onNavigatePrediction || sourceStatus === 'missing'}
                  onClick={() => onNavigatePrediction?.({
                    analysisId: node.source_ref!.analysis_id,
                    entityId: node.source_ref!.entity_id,
                    pieceKey: node.source_ref!.piece_key,
                  })}
                  title={sourceStatus === 'missing'
                    ? 'The source Prediction record is unavailable'
                    : 'Open this record in Failure Rate Prediction'}
                  className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline disabled:no-underline disabled:opacity-60">
                  {node.source_ref.analysis_name}
                  {sourceStatus !== 'missing' && <ExternalLink size={9} />}
                </button>
                {node.source_ref.reference_designators.length > 0 && <span>
                  RefDes {node.source_ref.reference_designators.join(', ')}
                </span>}
                {node.source_ref.part_number &&
                  <span>P/N {node.source_ref.part_number}</span>}
                {node.source_ref.quantity && <span>Qty {node.source_ref.quantity}</span>}
                {node.source_ref.manufacturer && <span>
                  {node.source_ref.manufacturer}
                </span>}
                {sourceStatus === 'changed' && sourceParentAvailable
                  && <button type="button" onClick={() =>
                  update({ structure_nodes: refreshPredictionStructure(
                    analysis.structure_nodes,
                    predictionCatalogs,
                    new Set([node.id]),
                  ) })}
                  className="ml-auto flex items-center gap-1 font-medium text-amber-700">
                  <RefreshCw size={10} /> Refresh
                </button>}
                {sourceStatus === 'changed' && !sourceParentAvailable && <span
                  className="ml-auto font-medium text-amber-700">
                  Pull source parent before refresh
                </span>}
                {canSplitPredictionPart && <button type="button" onClick={() =>
                  update({ structure_nodes: splitImportedPredictionParts(
                    analysis.structure_nodes,
                    sourceCatalog ? [sourceCatalog] : [],
                    new Set([node.id]),
                  ) })}
                  className={`${sourceStatus === 'changed' ? '' : 'ml-auto'} font-medium text-violet-700 hover:text-violet-900`}>
                  Split into individual parts
                </button>}
                <button type="button" onClick={() => update({
                  structure_nodes: detachPredictionStructure(
                    analysis.structure_nodes, new Set([node.id])),
                })} className={`${
                  sourceStatus === 'changed' || canSplitPredictionPart
                    ? '' : 'ml-auto'
                } font-medium text-slate-500 hover:text-slate-800`}>
                  {analysis.structure_nodes.some(item =>
                    item.parent_id === node.id) ? 'Detach branch' : 'Detach'}
                </button>
              </div>}
              <div className="font-mono text-[9px] text-slate-300">
                Internal record {node.id}
              </div>
            </div>}
          </div>
        })}
        {analysis.structure_nodes.length === 0 && <div
          className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-white text-xs text-slate-400">
          <span>Add a top-level block to begin the structure hierarchy.</span>
          <button type="button" onClick={() => addNode({ level: levels[0] })}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
            <Plus size={12} /> Add top-level block
          </button>
        </div>}
      </div>
    </div>}
  </section>
}

type FunctionEditorView =
  'functions'|'requirements'|'relationships'|'interfaces'|'p_diagrams'
type FunctionVisualView = 'tree'|'interfaces'|'p_diagram'|'coverage'
type FunctionContextKind =
  'structure'|'function'|'requirement'|'relationship'|'interface'
  |'p_diagram'|'p_item'|'correlation'
type FunctionContextSelection = {
  kind: FunctionContextKind
  id: string
  parentId?: string
  relatedId?: string
}

const functionTypeLabel = (value: FMEAFunction['function_type']) =>
  value === 'system_response' ? 'System response' :
  value.charAt(0).toUpperCase() + value.slice(1)
const listValue = (value: string) =>
  value.split(',').map(item => item.trim()).filter(Boolean)

function toggleId(values: string[], id: string) {
  return values.includes(id)
    ? values.filter(value => value !== id)
    : [...values, id]
}

function FunctionStep({
  analysis,
  result,
  programRequirements,
  vocabularyProfile,
  onAddFailureMode,
  update,
  onStep,
  initialVisualView,
  initialPDiagramId,
  onVisualViewChange,
  onPDiagramIdChange,
}: {
  analysis: AIAGVDAFMEAAnalysis
  result?: AIAGVDAFMEAResult
  programRequirements: RequirementInput[]
  vocabularyProfile: FMEAVocabularyProfile
  onAddFailureMode: (functionId: string) => void
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
  onStep: (step: number) => void
  initialVisualView?: FunctionVisualView
  initialPDiagramId?: string
  onVisualViewChange?: (value: FunctionVisualView) => void
  onPDiagramIdChange?: (id: string) => void
}) {
  const [editorView, setEditorView] = useState<FunctionEditorView>('functions')
  const [visualView, setVisualView] = useState<FunctionVisualView>('tree')
  const [query, setQuery] = useState('')
  const [selectedDiagramId, setSelectedDiagramId] = useState(
    analysis.p_diagrams[0]?.id ?? '')
  const [sourceRequirementId, setSourceRequirementId] = useState('')
  const [visualExpanded, setVisualExpanded] = useState(false)
  const [contextSelection, setContextSelection] =
    useState<FunctionContextSelection|null>(null)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setVisualView(initialVisualView ?? 'tree')
  }, [analysis.id, initialVisualView])
  useEffect(() => {
    setVisualExpanded(false)
    setContextSelection(null)
  }, [analysis.id])
  useEffect(() => {
    if (!visualExpanded) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVisualExpanded(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [visualExpanded])
  useEffect(() => {
    setSelectedDiagramId(current => {
      if (initialPDiagramId
          && analysis.p_diagrams.some(item => item.id === initialPDiagramId)) {
        return initialPDiagramId
      }
      if (analysis.p_diagrams.some(item => item.id === current)) return current
      return analysis.p_diagrams[0]?.id ?? ''
    })
  }, [analysis.id, analysis.p_diagrams, initialPDiagramId])

  const correlationsByFunction = useMemo(() => {
    const value = new Map<string, FMEAFunctionRequirementLink[]>()
    for (const link of analysis.function_requirement_links) {
      value.set(link.function_id, [...(value.get(link.function_id) ?? []), link])
    }
    return value
  }, [analysis.function_requirement_links])
  const localCoverage = useMemo(
    () => buildFunctionCoverage(analysis),
    [analysis],
  )
  const summary = {
    functions: analysis.functions.length,
    requirements: analysis.functional_requirements.length,
    interfaces: analysis.interfaces.length,
    pDiagrams: analysis.p_diagrams.length,
    covered: localCoverage.filter(item => item.function_ids.length).length,
    total: analysis.structure_nodes.length,
    gaps: localCoverage.reduce((total, item) => total + item.gaps.length, 0),
  }

  const changeFunction = (id: string, patch: Partial<FMEAFunction>) =>
    update({ functions: analysis.functions.map(item =>
      item.id === id ? { ...item, ...patch } : item) })
  const removeFunction = (id: string) => {
    const relationshipCount = analysis.function_links.filter(item =>
      item.source_function_id === id || item.target_function_id === id).length
    const correlationCount = analysis.function_requirement_links.filter(
      item => item.function_id === id).length
    const interfaceCount = analysis.interfaces.filter(
      item => item.function_ids.includes(id)).length
    const diagramCount = analysis.p_diagrams.filter(item =>
      item.primary_function_id === id
      || item.supporting_function_ids.includes(id)).length
    const chainCount = analysis.failure_chains.filter(
      item => item.function_id === id).length
    const affected = [
      relationshipCount && `${relationshipCount} relationship(s)`,
      correlationCount && `${correlationCount} correlation(s)`,
      interfaceCount && `${interfaceCount} interface(s)`,
      diagramCount && `${diagramCount} P-diagram(s)`,
      chainCount && `${chainCount} failure chain(s)`,
    ].filter(Boolean)
    if (affected.length && !window.confirm(
      `Delete this function?\n\nAffected records: ${affected.join(', ')}. `
      + 'Failure chains and shared requirements will be retained but detached.',
    )) return
    update({
      functions: analysis.functions.filter(item => item.id !== id),
      function_links: analysis.function_links.filter(item =>
        item.source_function_id !== id && item.target_function_id !== id),
      function_requirement_links: analysis.function_requirement_links.filter(
        item => item.function_id !== id),
      interfaces: analysis.interfaces.map(item => ({
        ...item, function_ids: item.function_ids.filter(value => value !== id),
      })),
      p_diagrams: analysis.p_diagrams
        .filter(item => item.primary_function_id !== id)
        .map(item => ({
          ...item,
          supporting_function_ids: item.supporting_function_ids.filter(
            value => value !== id),
        })),
      failure_chains: analysis.failure_chains.map(item =>
        item.function_id === id ? { ...item, function_id: undefined } : item),
    })
  }
  const addProgramRequirement = async () => {
    const source = programRequirements.find(
      item => item.id === sourceRequirementId)
    if (!source) return
    const requirementId = uid('FREQ')
    const created = await synchronizeProgramRequirement({
      id: requirementId, statement: '', requirement_type: 'functional',
      measure: '', target: '', unit: '', acceptance_criteria: '',
      operating_condition: '', source: '', owner: '', confidence: '',
      verification_method: '', evidence_ids: [], special_characteristic: '',
    }, source)
    update({ functional_requirements: [
      ...analysis.functional_requirements, created,
    ] })
    setSourceRequirementId('')
  }
  const visualOptions: [FunctionVisualView, string, typeof Network][] = [
    ['tree', 'Function tree', Network],
    ['interfaces', 'Inputs & interfaces', Link2],
    ['p_diagram', 'P-diagram', GitBranch],
    ['coverage', 'Correlation & coverage', Table2],
  ]
  const visualLabel = visualOptions.find(
    ([id]) => id === visualView,
  )?.[1] ?? 'Function analysis'
  const selectVisualView = (value: FunctionVisualView) => {
    setVisualView(value)
    onVisualViewChange?.(value)
  }
  const selectContext = (
    selection: FunctionContextSelection,
    targetEditor?: FunctionEditorView,
  ) => {
    setContextSelection(selection)
    if (targetEditor) setEditorView(targetEditor)
  }
  useEffect(() => {
    if (!contextSelection) return
    window.requestAnimationFrame(() => {
      const candidates = Array.from(
        editorPaneRef.current?.querySelectorAll<HTMLElement>(
          '[data-context-kind], [data-structure-id]',
        ) ?? [],
      )
      const target = candidates.find(item =>
        (contextSelection.kind === 'structure'
          && item.dataset.structureId === contextSelection.id)
        || (item.dataset.contextKind === contextSelection.kind
          && item.dataset.contextId === contextSelection.id))
      target?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    })
  }, [contextSelection, editorView])
  const visualization = <>
    {visualView === 'tree' && <FunctionTreeView analysis={analysis}
      selection={contextSelection}
      onSelect={(selection, editor) => selectContext(selection, editor)} />}
    {visualView === 'interfaces' &&
      <InterfaceFlowView analysis={analysis}
        selection={contextSelection}
        onSelect={(selection, editor) => selectContext(selection, editor)} />}
    {visualView === 'p_diagram' && <PDiagramView analysis={analysis}
      selection={contextSelection}
      onSelect={(selection, editor) => selectContext(selection, editor)}
      selectedId={selectedDiagramId} setSelectedId={value => {
        setSelectedDiagramId(value)
        onPDiagramIdChange?.(value)
      }} />}
    {visualView === 'coverage' && <FunctionCoverageView
      analysis={analysis} coverage={localCoverage}
      selection={contextSelection}
      onSelect={(selection, editor) => selectContext(selection, editor)} />}
  </>
  const visualToolbar = (expanded: boolean) =>
    <div className={`flex flex-wrap items-center justify-between gap-2 ${
      expanded ? 'px-4 py-2.5' : 'mb-2'
    }`}>
      <div className="flex flex-wrap gap-1">
        {visualOptions.map(([id, label, Icon]) =>
          <button key={id} type="button" onClick={() => selectVisualView(id)}
            className={`flex items-center gap-1 rounded px-2 py-1.5 text-[11px] ${
              visualView === id
                ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'
            }`}>
            <Icon size={12} /> {label}
          </button>)}
      </div>
      <div className="flex items-center gap-2">
        {visualView === 'coverage' && summary.gaps > 0 &&
          <button type="button" onClick={() => {
            setVisualExpanded(false)
            onStep(4)
          }} className="text-[11px] font-medium text-blue-700 hover:underline">
            Review failure coverage in Step 4 →
          </button>}
        <button type="button" onClick={() => setVisualExpanded(!expanded)}
          title={expanded
            ? 'Restore Function Analysis visualization'
            : `Expand ${visualLabel} to full screen`}
          aria-label={expanded
            ? 'Restore Function Analysis visualization'
            : `Expand ${visualLabel} to full screen`}
          className="rounded border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>

  return <section className="space-y-4">
    <StepHeading number={3} title="Function analysis"
      text="Allocate functions to the structure, correlate measurable requirements, and review inputs, interfaces, outputs, controls, and noise before defining failures." />
    <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {[
        ['Functions', summary.functions],
        ['Requirements', summary.requirements],
        ['Interfaces', summary.interfaces],
        ['P-diagrams', summary.pDiagrams],
        ['Structure coverage', `${summary.covered}/${summary.total}`],
        ['Coverage gaps', summary.gaps],
      ].map(([label, value]) => <div key={label}
        className="rounded border border-slate-200 bg-white px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-0.5 text-sm font-semibold text-slate-800">{value}</div>
      </div>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex min-w-52 flex-1 items-center gap-1 rounded border border-slate-200 px-2">
        <Search size={13} className="text-slate-400" />
        <input value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Search functions, requirements, interfaces…"
          className="w-full border-0 bg-transparent py-1.5 text-xs outline-none" />
      </div>
      <div className="flex flex-wrap gap-1">
        {([
          ['functions', 'Functions'], ['requirements', 'Requirements'],
          ['relationships', 'Relationships'], ['interfaces', 'Interfaces'],
          ['p_diagrams', 'P-diagrams'],
        ] as [FunctionEditorView, string][]).map(([id, label]) =>
          <button key={id} onClick={() => setEditorView(id)}
            className={`rounded px-2 py-1.5 text-[11px] font-medium ${
              editorView === id
                ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}>{label}</button>)}
      </div>
    </div>
    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(430px,0.95fr)_minmax(560px,1.05fr)]">
      <div ref={editorPaneRef} className="min-w-0 space-y-2">
        {editorView === 'functions' && <FunctionRecordsEditor
          analysis={analysis} query={query} change={changeFunction}
          vocabularyProfile={vocabularyProfile}
          onAddFailureMode={onAddFailureMode}
          remove={removeFunction} update={update}
          correlationsByFunction={correlationsByFunction}
          selection={contextSelection}
          onSelect={selection => selectContext(selection)} />}
        {editorView === 'requirements' && <RequirementRecordsEditor
          analysis={analysis} result={result} query={query}
          vocabularyProfile={vocabularyProfile}
          programRequirements={programRequirements}
          sourceRequirementId={sourceRequirementId}
          setSourceRequirementId={setSourceRequirementId}
          addProgramRequirement={addProgramRequirement} update={update}
          selection={contextSelection}
          onSelect={selection => selectContext(selection)} />}
        {editorView === 'relationships' && <FunctionRelationshipsEditor
          analysis={analysis} update={update}
          selection={contextSelection}
          onSelect={selection => selectContext(selection)} />}
        {editorView === 'interfaces' && <FunctionInterfacesEditor
          analysis={analysis} query={query} update={update}
          selection={contextSelection}
          onSelect={selection => selectContext(selection)} />}
        {editorView === 'p_diagrams' && <PDiagramEditor
          analysis={analysis} query={query} update={update}
          selection={contextSelection}
          onSelect={selection => selectContext(selection)}
          selectedId={selectedDiagramId} setSelectedId={value => {
            setSelectedDiagramId(value)
            onPDiagramIdChange?.(value)
          }} />}
      </div>
      <div className="min-w-0">
        {visualToolbar(false)}
        {!visualExpanded && visualization}
      </div>
    </div>
    {visualExpanded && <div
      className="fixed inset-0 z-[100] flex flex-col bg-slate-50"
      role="dialog" aria-modal="true"
      aria-label={`${visualLabel} full-screen view`}>
      <div className="border-b border-slate-200 bg-white shadow-sm">
        <div className="px-4 pt-2 text-xs font-semibold text-slate-800">
          Function analysis visualization
        </div>
        {visualToolbar(true)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {visualization}
      </div>
    </div>}
  </section>
}

function FunctionRecordsEditor({
  analysis, query, change, remove, update, correlationsByFunction,
  vocabularyProfile, onAddFailureMode, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  query: string
  vocabularyProfile: FMEAVocabularyProfile
  onAddFailureMode: (functionId: string) => void
  change: (id: string, patch: Partial<FMEAFunction>) => void
  remove: (id: string) => void
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
  correlationsByFunction: Map<string, FMEAFunctionRequirementLink[]>
  selection: FunctionContextSelection|null
  onSelect: (selection: FunctionContextSelection) => void
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const shown = analysis.functions.filter(item => {
    const structure = analysis.structure_nodes.find(
      node => node.id === item.structure_node_id)
    return !normalizedQuery || [
      item.description, item.notes, structure?.name,
      ...item.operating_modes,
    ].some(value => String(value ?? '').toLowerCase().includes(normalizedQuery))
  })
  return <>
    {selection?.kind === 'structure' && (() => {
      const structure = analysis.structure_nodes.find(
        item => item.id === selection.id)
      const allocated = analysis.functions.filter(
        item => item.structure_node_id === selection.id).length
      return <div data-structure-id={selection.id}
        className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-[10px] text-cyan-900 ring-1 ring-cyan-100">
        <span className="font-semibold">
          {structure?.name || 'Selected structure element'}
        </span>
        <span className="ml-2 text-cyan-700">
          {allocated} allocated function{allocated === 1 ? '' : 's'}
        </span>
      </div>
    })()}
    {shown.map(item => {
      const chainCount = analysis.failure_chains.filter(
        chain => chain.function_id === item.id).length
      const requirementCount = correlationsByFunction.get(item.id)?.length ?? 0
      const ordinal = analysis.functions.findIndex(value => value.id === item.id) + 1
      const directSelection = selection?.kind === 'function'
        && selection.id === item.id
      const structureSelection = selection?.kind === 'structure'
        && selection.id === item.structure_node_id
      const correlationSelection = selection?.kind === 'correlation'
        && selection.parentId === item.id
      return <div key={item.id}
        data-context-kind="function" data-context-id={item.id}
        data-structure-id={item.structure_node_id}
        onClick={event => {
          if ((event.target as HTMLElement).closest(
            '[data-structure-selector]')) return
          onSelect({ kind: 'function', id: item.id })
        }}
        onFocusCapture={() => onSelect({ kind: 'function', id: item.id })}
        className={`space-y-2 rounded-lg border bg-white p-3 transition ${
          directSelection || correlationSelection
            ? 'border-blue-400 ring-2 ring-blue-100'
            : structureSelection
              ? 'border-cyan-300 bg-cyan-50/30 ring-1 ring-cyan-100'
              : 'border-slate-200'
        }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <OrdinalBadge value={`F${ordinal}`} title={`Function ${ordinal}`} />
            <span className="font-mono text-[10px] text-slate-400">
              {item.id}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[9px] ${
              requirementCount ? 'bg-emerald-50 text-emerald-700' :
              'bg-amber-50 text-amber-700'}`}>
              {requirementCount} req.
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[9px] ${
              chainCount ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
              {chainCount} chain(s)
            </span>
            <button type="button" onClick={() => onAddFailureMode(item.id)}
              title="Create a new failure mode already linked to this function"
              className="flex items-center gap-0.5 rounded border border-blue-200 px-1.5 py-0.5 text-[9px] text-blue-700 hover:bg-blue-50">
              <Plus size={9} /> Failure mode
            </button>
            <button onClick={() => remove(item.id)}
              title="Delete function" className="text-slate-300 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <label data-structure-selector
            className="text-[10px] text-slate-500">Structure element
            <select value={item.structure_node_id} onChange={event =>
              {
                change(item.id, { structure_node_id: event.target.value })
                onSelect({
                  kind: 'structure',
                  id: event.target.value,
                })
              }}
              onFocus={() => onSelect({
                kind: 'structure',
                id: item.structure_node_id,
              })}
              className={`mt-0.5 ${fieldClass}`}>
              <option value="">Select element</option>
              {analysis.structure_nodes.map(node =>
                <option key={node.id} value={node.id}>{node.name}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-slate-500">Function type
            <select value={item.function_type} onChange={event =>
              change(item.id, {
                function_type: event.target.value as FMEAFunction['function_type'],
              })} className={`mt-0.5 ${fieldClass}`}>
              {(['primary', 'supporting', 'interface', 'monitoring',
                'system_response'] as FMEAFunction['function_type'][]).map(value =>
                <option key={value} value={value}>{functionTypeLabel(value)}</option>)}
            </select>
          </label>
        </div>
        <FunctionStatementField value={item.description}
          canonicalVerbId={item.canonical_verb_id}
          profile={vocabularyProfile} kind={analysis.kind}
          targetSuggestions={[...new Set([
            ...analysis.structure_nodes
              .filter(node => node.id !== item.structure_node_id)
              .map(node => node.name),
            ...analysis.interfaces.flatMap(value => [
              value.external_source, value.external_target,
            ]),
          ].map(value => value.trim()).filter(Boolean))]}
          onChange={(description, canonical_verb_id) =>
            change(item.id, { description, canonical_verb_id })} />
        <OperatingModesField values={item.operating_modes}
          profile={vocabularyProfile} kind={analysis.kind}
          onChange={operating_modes =>
            change(item.id, { operating_modes })} />
        <Field multiline label="Notes / assumptions" value={item.notes}
          onChange={notes => change(item.id, { notes })} />
      </div>
    })}
    <button onClick={() => update({ functions: [...analysis.functions, {
      id: uid('FN'), structure_node_id: analysis.structure_nodes[0]?.id ?? '',
      description: '', function_type: 'primary', operating_modes: [],
      owner: '', notes: '',
    }] })} className="flex items-center gap-1 rounded border border-dashed border-blue-300 px-3 py-2 text-xs text-blue-700">
      <Plus size={13} /> Add function
    </button>
  </>
}

function RequirementRecordsEditor({
  analysis, result, query, programRequirements, sourceRequirementId,
  setSourceRequirementId, addProgramRequirement, update, vocabularyProfile,
  selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  result?: AIAGVDAFMEAResult
  query: string
  vocabularyProfile: FMEAVocabularyProfile
  programRequirements: RequirementInput[]
  sourceRequirementId: string
  setSourceRequirementId: (value: string) => void
  addProgramRequirement: () => Promise<void>
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
  selection: FunctionContextSelection|null
  onSelect: (selection: FunctionContextSelection) => void
}) {
  const change = (id: string, patch: Partial<FMEAFunctionalRequirement>) =>
    update({ functional_requirements: analysis.functional_requirements.map(
      item => item.id === id ? { ...item, ...patch } : item) })
  const remove = (id: string) => {
    const correlationCount = analysis.function_requirement_links.filter(
      item => item.requirement_id === id).length
    const interfaceCount = analysis.interfaces.filter(
      item => item.requirement_ids.includes(id)).length
    const factorCount = analysis.p_diagrams.flatMap(item => item.items).filter(
      item => item.requirement_ids.includes(id)).length
    if ((correlationCount || interfaceCount || factorCount) && !window.confirm(
      `Delete this functional requirement?\n\nIt is used by `
      + `${correlationCount} correlation(s), ${interfaceCount} interface(s), `
      + `and ${factorCount} P-diagram item(s). Those links will be removed.`,
    )) return
    update({
      functional_requirements: analysis.functional_requirements.filter(
        item => item.id !== id),
      function_requirement_links: analysis.function_requirement_links.filter(
        item => item.requirement_id !== id),
      interfaces: analysis.interfaces.map(item => ({
        ...item,
        requirement_ids: item.requirement_ids.filter(value => value !== id),
      })),
      p_diagrams: analysis.p_diagrams.map(diagram => ({
        ...diagram,
        items: diagram.items.map(item => ({
          ...item,
          requirement_ids: item.requirement_ids.filter(value => value !== id),
        })),
      })),
    })
  }
  const addCorrelation = (requirementId: string) => {
    const functionId = analysis.functions.find(fn =>
      !analysis.function_requirement_links.some(link =>
        link.requirement_id === requirementId && link.function_id === fn.id))?.id
    if (!functionId) return
    update({ function_requirement_links: [
      ...analysis.function_requirement_links,
      {
        id: uid('FRC'), function_id: functionId,
        requirement_id: requirementId, strength: 'strong', rationale: '',
      },
    ] })
  }
  const queryText = query.trim().toLowerCase()
  const shown = analysis.functional_requirements.filter(item =>
    !queryText || [
      item.statement, item.measure, item.target, item.source,
      item.verification_method, item.special_characteristic,
    ].some(value => value.toLowerCase().includes(queryText)))
  return <>
    <div className="flex flex-wrap gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2">
      <select value={sourceRequirementId}
        onChange={event => setSourceRequirementId(event.target.value)}
        className="min-w-56 flex-1 rounded border border-blue-200 bg-white px-2 py-1.5 text-xs">
        <option value="">Link a Reliability Program requirement…</option>
        {programRequirements.map(item =>
          <option key={item.id} value={item.id}>{item.id} · {item.statement}</option>)}
      </select>
      <button disabled={!sourceRequirementId}
        onClick={() => void addProgramRequirement()}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
        Add linked snapshot
      </button>
    </div>
    {shown.map(item => {
      const correlations = analysis.function_requirement_links.filter(
        link => link.requirement_id === item.id)
      const sync = result?.requirement_sync.find(
        value => value.requirement_id === item.id)
      const ordinal = analysis.functional_requirements.findIndex(
        value => value.id === item.id) + 1
      const selected = (selection?.kind === 'requirement'
          && selection.id === item.id)
        || (selection?.kind === 'correlation'
          && selection.relatedId === item.id)
      return <div key={item.id}
        data-context-kind="requirement" data-context-id={item.id}
        onClick={event => {
          if ((event.target as HTMLElement).closest(
            '[data-correlation-record]')) return
          onSelect({ kind: 'requirement', id: item.id })
        }}
        onFocusCapture={event => {
          if ((event.target as HTMLElement).closest(
            '[data-correlation-record]')) return
          onSelect({ kind: 'requirement', id: item.id })
        }}
        className={`space-y-2 rounded-lg border bg-white p-3 transition ${
          selected
            ? 'border-blue-400 ring-2 ring-blue-100'
            : 'border-slate-200'
        }`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <OrdinalBadge value={`REQ${ordinal}`}
              title={`Functional requirement ${ordinal}`} />
            <span className="font-mono text-[10px] text-slate-400">{item.id}</span>
            {sync && <span title={sync.differences.map(diff => diff.field).join(', ')}
              className={`rounded px-1.5 py-0.5 text-[9px] ${
                sync.status === 'in_sync' ? 'bg-emerald-50 text-emerald-700' :
                sync.status === 'local' ? 'bg-slate-100 text-slate-500' :
                'bg-amber-50 text-amber-700'}`}>
              {sync.status.replace(/_/g, ' ')}
            </span>}
          </div>
          <div className="flex items-center gap-1">
            {item.linked_program_requirement_id &&
              <button title="Refresh snapshot from linked program requirement"
                onClick={async () => {
                  const source = programRequirements.find(
                    value => value.id === item.linked_program_requirement_id)
                  if (!source) return
                  const refreshed = await synchronizeProgramRequirement(item, source)
                  change(item.id, refreshed)
                }} className="rounded p-1 text-blue-600 hover:bg-blue-50">
                <RefreshCw size={12} />
              </button>}
            <button onClick={() => remove(item.id)}
              className="text-slate-300 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_150px]">
          <Field multiline label="Requirement statement *" value={item.statement}
            onChange={statement => change(item.id, { statement })} />
          <label className="text-[10px] text-slate-500">Requirement type
            <select value={item.requirement_type} onChange={event =>
              change(item.id, {
                requirement_type: event.target.value as
                  FMEAFunctionalRequirement['requirement_type'],
              })} className={`mt-1 ${fieldClass}`}>
              {(['functional', 'performance', 'interface', 'safety',
                'regulatory', 'customer', 'process', 'other'] as const).map(value =>
                <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <Field label="Measure" value={item.measure}
            onChange={measure => change(item.id, { measure })} />
          <Field label="Target" value={item.target}
            onChange={target => change(item.id, { target })} />
          <Field label="Unit" value={item.unit}
            onChange={unit => change(item.id, { unit })} />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="Acceptance criteria" value={item.acceptance_criteria}
            onChange={acceptance_criteria =>
              change(item.id, { acceptance_criteria })} />
          <Field label="Operating condition / mode" value={item.operating_condition}
            onChange={operating_condition =>
              change(item.id, { operating_condition })} />
          <Field label="Source" value={item.source}
            onChange={source => change(item.id, { source })} />
          <Field label="Owner" value={item.owner}
            onChange={owner => change(item.id, { owner })} />
          <VocabularyTaggedField label="Verification method"
            value={item.verification_method}
            semanticId={item.verification_method_id}
            domain="verification_method" profile={vocabularyProfile}
            kind={analysis.kind}
            onChange={(verification_method, verification_method_id) =>
              change(item.id, {
                verification_method,
                verification_method_id,
              })} />
          <Field label="Confidence / evidence basis" value={item.confidence}
            onChange={confidence => change(item.id, { confidence })} />
          <Field label="Evidence IDs (comma-separated)"
            value={item.evidence_ids.join(', ')}
            onChange={value => change(item.id, { evidence_ids: listValue(value) })} />
          <Field label="Special-characteristic class / symbol"
            value={item.special_characteristic}
            onChange={special_characteristic =>
              change(item.id, { special_characteristic })} />
        </div>
        <details className="rounded border border-slate-100 bg-slate-50">
          <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-medium text-slate-600">
            Function correlations ({correlations.length})
          </summary>
          <div className="space-y-1 border-t border-slate-100 p-2">
            {correlations.map(link =>
              <div key={link.id}
                data-correlation-record
                data-context-kind="correlation" data-context-id={link.id}
                onClick={() => onSelect({
                  kind: 'correlation',
                  id: link.id,
                  parentId: link.function_id,
                  relatedId: link.requirement_id,
                })}
                onFocusCapture={() => onSelect({
                  kind: 'correlation',
                  id: link.id,
                  parentId: link.function_id,
                  relatedId: link.requirement_id,
                })}
                className={`grid gap-1 rounded p-1 md:grid-cols-[1fr_100px_1fr_auto] ${
                  selection?.kind === 'correlation'
                    && selection.id === link.id
                    ? 'bg-blue-50 ring-1 ring-blue-200' : ''
                }`}>
                <select value={link.function_id} onChange={event =>
                  update({ function_requirement_links:
                    analysis.function_requirement_links.map(value =>
                      value.id === link.id
                        ? { ...value, function_id: event.target.value } : value) })}
                  className={fieldClass}>
                  {analysis.functions.map(fn =>
                    <option key={fn.id} value={fn.id}>{fn.description || fn.id}</option>)}
                </select>
                <select value={link.strength} onChange={event =>
                  update({ function_requirement_links:
                    analysis.function_requirement_links.map(value =>
                      value.id === link.id ? { ...value,
                        strength: event.target.value as
                          FMEAFunctionRequirementLink['strength'] } : value) })}
                  className={fieldClass}>
                  <option value="weak">Weak · 1</option>
                  <option value="medium">Medium · 3</option>
                  <option value="strong">Strong · 9</option>
                </select>
                <input value={link.rationale} placeholder="Correlation rationale"
                  onChange={event => update({ function_requirement_links:
                    analysis.function_requirement_links.map(value =>
                      value.id === link.id ? { ...value,
                        rationale: event.target.value } : value) })}
                  className={fieldClass} />
                <button onClick={() => update({ function_requirement_links:
                  analysis.function_requirement_links.filter(
                    value => value.id !== link.id) })}
                  className="text-slate-300 hover:text-red-500">
                  <Trash2 size={12} />
                </button>
              </div>)}
            <button onClick={() => addCorrelation(item.id)}
              disabled={!analysis.functions.length
                || correlations.length >= analysis.functions.length}
              className="flex items-center gap-1 text-[10px] text-blue-700 disabled:opacity-40">
              <Plus size={11} /> Correlate function
            </button>
          </div>
        </details>
      </div>
    })}
    <button onClick={() => update({ functional_requirements: [
      ...analysis.functional_requirements,
      {
        id: uid('FREQ'), statement: '', requirement_type: 'functional',
        measure: '', target: '', unit: '', acceptance_criteria: '',
        operating_condition: '', source: '', owner: '', confidence: '',
        verification_method: '', evidence_ids: [], special_characteristic: '',
      },
    ] })} className="flex items-center gap-1 rounded border border-dashed border-blue-300 px-3 py-2 text-xs text-blue-700">
      <Plus size={13} /> Add local requirement
    </button>
  </>
}

function FunctionRelationshipsEditor({
  analysis, update, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
  selection: FunctionContextSelection|null
  onSelect: (selection: FunctionContextSelection) => void
}) {
  const change = (id: string, patch: Partial<FMEAFunctionLink>) =>
    update({ function_links: analysis.function_links.map(item =>
      item.id === id ? { ...item, ...patch } : item) })
  return <>
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
      Decomposition forms the function tree. Other relationships document
      dependencies, signals, enabling functions, monitoring, and response
      without forcing an artificial hierarchy.
    </div>
    {analysis.function_links.map((item, index) =>
      <div key={item.id}
        data-context-kind="relationship" data-context-id={item.id}
        onClick={() => onSelect({ kind: 'relationship', id: item.id })}
        onFocusCapture={() =>
          onSelect({ kind: 'relationship', id: item.id })}
        className={`grid gap-2 rounded-lg border bg-white p-3 md:grid-cols-3 ${
          selection?.kind === 'relationship' && selection.id === item.id
            ? 'border-blue-400 ring-2 ring-blue-100'
            : 'border-slate-200'
        }`}>
        <div className="flex items-center gap-1.5 md:col-span-3">
          <OrdinalBadge value={`REL${index + 1}`}
            title={`Function relationship ${index + 1}`} />
          <span className="font-mono text-[9px] text-slate-300">{item.id}</span>
        </div>
        <select value={item.source_function_id} onChange={event =>
          change(item.id, { source_function_id: event.target.value })}
          className={fieldClass}>
          {analysis.functions.map(fn =>
            <option key={fn.id} value={fn.id}>{fn.description || fn.id}</option>)}
        </select>
        <select value={item.relationship} onChange={event =>
          change(item.id, {
            relationship: event.target.value as FMEAFunctionLink['relationship'],
          })} className={fieldClass}>
          {(['decomposes_to', 'depends_on', 'provides_input', 'enables',
            'monitors', 'responds_to'] as const).map(value =>
            <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </select>
        <div className="flex gap-1">
          <select value={item.target_function_id} onChange={event =>
            change(item.id, { target_function_id: event.target.value })}
            className={fieldClass}>
            {analysis.functions.map(fn =>
              <option key={fn.id} value={fn.id}>{fn.description || fn.id}</option>)}
          </select>
          <button onClick={() => update({ function_links:
            analysis.function_links.filter(value => value.id !== item.id) })}
            className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
        </div>
        <input value={item.label} onChange={event =>
          change(item.id, { label: event.target.value })}
          placeholder="Flow / relationship label" className={fieldClass} />
        <input value={item.rationale} onChange={event =>
          change(item.id, { rationale: event.target.value })}
          placeholder="Rationale" className="md:col-span-2 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
      </div>)}
    <button disabled={analysis.functions.length < 2}
      onClick={() => update({ function_links: [...analysis.function_links, {
        id: uid('FL'), source_function_id: analysis.functions[0]?.id ?? '',
        target_function_id: analysis.functions[1]?.id ?? '',
        relationship: 'decomposes_to', label: '', rationale: '',
      }] })} className="flex items-center gap-1 rounded border border-dashed border-blue-300 px-3 py-2 text-xs text-blue-700 disabled:opacity-40">
      <Plus size={13} /> Add relationship
    </button>
  </>
}

function IdChecklist({
  label, options, values, onChange,
}: {
  label: string
  options: { id: string; label: string }[]
  values: string[]
  onChange: (values: string[]) => void
}) {
  return <details className="rounded border border-slate-100 bg-slate-50">
    <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-medium text-slate-600">
      {label} ({values.length})
    </summary>
    <div className="grid max-h-40 gap-1 overflow-y-auto border-t p-2 md:grid-cols-2">
      {options.map(option => <label key={option.id}
        className="flex items-start gap-1.5 text-[10px] text-slate-600">
        <input type="checkbox" checked={values.includes(option.id)}
          onChange={() => onChange(toggleId(values, option.id))} />
        <span>{option.label}</span>
      </label>)}
      {!options.length && <span className="text-[10px] text-slate-400">No records available.</span>}
    </div>
  </details>
}

function FunctionInterfacesEditor({
  analysis, query, update, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  query: string
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
  selection: FunctionContextSelection|null
  onSelect: (selection: FunctionContextSelection) => void
}) {
  const change = (id: string, patch: Partial<FMEAInterface>) =>
    update({ interfaces: analysis.interfaces.map(item =>
      item.id === id ? { ...item, ...patch } : item) })
  const blockLabel = (id?: string) => {
    const block = analysis.block_diagram.nodes.find(item => item.id === id)
    if (!block) return ''
    return block.kind === 'structure'
      ? analysis.structure_nodes.find(
          item => item.id === block.structure_node_id)?.name || block.label
      : block.label
  }
  const endpointPatch = (
    blockId: string,
    side: 'source'|'target',
  ): Partial<FMEAInterface> => {
    const block = analysis.block_diagram.nodes.find(item => item.id === blockId)
    if (side === 'source') {
      return {
        source_block_id: blockId || undefined,
        source_structure_node_id: block?.kind === 'structure'
          ? block.structure_node_id : undefined,
        external_source: block?.kind === 'external' ? block.label : '',
      }
    }
    return {
      target_block_id: blockId || undefined,
      target_structure_node_id: block?.kind === 'structure'
        ? block.structure_node_id : undefined,
      external_target: block?.kind === 'external' ? block.label : '',
    }
  }
  const normalizedQuery = query.trim().toLowerCase()
  const shown = analysis.interfaces.filter(item => !normalizedQuery
    || [item.name, item.flow_description, item.external_source,
      item.external_target, blockLabel(item.source_block_id),
      blockLabel(item.target_block_id)].some(value =>
      value.toLowerCase().includes(normalizedQuery)))
  return <>
    <div className="rounded border border-blue-100 bg-blue-50/60 px-3 py-2 text-[10px] leading-relaxed text-blue-800">
      Interfaces drawn in the Structure Analysis block diagram appear here.
      Changes in either view update the same analysis records. P/E/I/M/H/C
      identify physical, energy, information, material, human-machine, and
      clearance interfaces.
    </div>
    {shown.map(item => {
      const ordinal = analysis.interfaces.findIndex(
        value => value.id === item.id) + 1
      return <div key={item.id}
      data-context-kind="interface" data-context-id={item.id}
      onClick={() => onSelect({ kind: 'interface', id: item.id })}
      onFocusCapture={() => onSelect({ kind: 'interface', id: item.id })}
      className={`space-y-2 rounded-lg border bg-white p-3 transition ${
        selection?.kind === 'interface' && selection.id === item.id
          ? 'border-blue-400 ring-2 ring-blue-100'
          : 'border-slate-200'
      }`}>
      <div className="flex justify-between">
        <div className="flex items-center gap-1.5">
          <OrdinalBadge value={`IF${ordinal}`}
            title={`Interface ${ordinal}`} />
          <span className="font-mono text-[10px] text-slate-400">{item.id}</span>
        </div>
        <button onClick={() => update({ interfaces:
          analysis.interfaces.filter(value => value.id !== item.id) })}
          className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_180px]">
        <Field label="Interface name" value={item.name}
          onChange={name => change(item.id, { name })} />
        <label className="text-[10px] text-slate-500">Interface category
          <select value={item.interface_type} onChange={event => {
            const type =
              event.target.value as FMEAInterface['interface_type']
            change(item.id, {
              interface_type: type,
              directionality: type === 'physical' || type === 'clearance'
                ? 'undirected' : 'directed',
              ...(type === 'clearance'
                ? { linkage: 'indirect' as const }
                : item.interface_type === 'clearance'
                  ? { linkage: 'direct' as const }
                  : {}),
            })
          }} className={`mt-1 ${fieldClass}`}>
            <option value="physical">P · Physical</option>
            <option value="energy">E · Energy</option>
            <option value="information">I · Information / data</option>
            <option value="material">M · Material</option>
            <option value="human_machine">H · Human-machine</option>
            <option value="clearance">C · Clearance / indirect</option>
          </select>
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-[10px] text-slate-500">Source block
          <select value={item.source_block_id ?? ''} onChange={event =>
            change(item.id, endpointPatch(event.target.value, 'source'))}
            className={`mt-1 ${fieldClass}`}>
            <option value="">Select diagram block</option>
            {analysis.block_diagram.nodes.map(node =>
              <option key={node.id} value={node.id}>
                {blockLabel(node.id)} · {node.kind === 'external'
                  ? 'external' : 'structure'}
              </option>)}
          </select>
        </label>
        <label className="text-[10px] text-slate-500">Destination block
          <select value={item.target_block_id ?? ''} onChange={event =>
            change(item.id, endpointPatch(event.target.value, 'target'))}
            className={`mt-1 ${fieldClass}`}>
            <option value="">Select diagram block</option>
            {analysis.block_diagram.nodes.map(node =>
              <option key={node.id} value={node.id}>
                {blockLabel(node.id)} · {node.kind === 'external'
                  ? 'external' : 'structure'}
              </option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-[10px] text-slate-500">Linkage
          <select value={item.linkage} onChange={event => change(item.id, {
            linkage: event.target.value as FMEAInterface['linkage'],
          })} className={`mt-1 ${fieldClass}`}>
            <option value="direct">Direct · solid line</option>
            <option value="indirect">Indirect · dashed line</option>
          </select>
        </label>
        <label className="text-[10px] text-slate-500">Direction
          <select value={item.directionality} onChange={event => change(item.id, {
            directionality:
              event.target.value as FMEAInterface['directionality'],
          })} className={`mt-1 ${fieldClass}`}>
            <option value="directed">Source → destination</option>
            <option value="bidirectional">Bidirectional</option>
            <option value="undirected">Non-Directional</option>
          </select>
        </label>
        <label className="text-[10px] text-slate-500">Strength
          <select value={item.relationship_strength}
            onChange={event => change(item.id, {
              relationship_strength:
                event.target.value as FMEAInterface['relationship_strength'],
            })} className={`mt-1 ${fieldClass}`}>
            <option value="unspecified">Unspecified</option>
            <option value="strong">Strong</option>
            <option value="weak">Weak</option>
          </select>
        </label>
        <label className="text-[10px] text-slate-500">Nature
          <select value={item.relationship_nature}
            onChange={event => change(item.id, {
              relationship_nature:
                event.target.value as FMEAInterface['relationship_nature'],
            })} className={`mt-1 ${fieldClass}`}>
            <option value="unspecified">Unspecified</option>
            <option value="beneficial">Beneficial</option>
            <option value="harmful">Harmful</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
      </div>
      <Field label="What flows across the interface" value={item.flow_description}
        onChange={flow_description => change(item.id, { flow_description })} />
      <Field multiline label="Interface detail / subtype"
        value={item.interface_detail}
        onChange={interface_detail => change(item.id, { interface_detail })} />
      <Field label="Operating condition" value={item.operating_condition}
        onChange={operating_condition => change(item.id, { operating_condition })} />
      <IdChecklist label="Linked functions"
        options={analysis.functions.map(value => ({
          id: value.id, label: value.description || value.id,
        }))} values={item.function_ids}
        onChange={function_ids => change(item.id, { function_ids })} />
      <IdChecklist label="Linked requirements"
        options={analysis.functional_requirements.map(value => ({
          id: value.id, label: value.statement || value.id,
        }))} values={item.requirement_ids}
        onChange={requirement_ids => change(item.id, { requirement_ids })} />
    </div>})}
    <button disabled={analysis.block_diagram.nodes.length < 2
        || !analysis.block_diagram.nodes.some(item => item.kind === 'structure')}
      title={analysis.block_diagram.nodes.length < 2
        || !analysis.block_diagram.nodes.some(item => item.kind === 'structure')
        ? 'Add at least two diagram blocks, including a Structure Analysis block'
        : 'Add an interface between existing diagram blocks'}
      onClick={() => {
        const source = analysis.block_diagram.nodes.find(
          item => item.kind === 'external')
          ?? analysis.block_diagram.nodes[0]
        const target = analysis.block_diagram.nodes.find(
          item => item.kind === 'structure' && item.id !== source?.id)
          ?? analysis.block_diagram.nodes.find(item => item.id !== source?.id)
        if (!source || !target) return
        update({ interfaces: [...analysis.interfaces, {
          id: uid('IF'),
          name: '',
          interface_type: 'information',
          source_block_id: source.id,
          target_block_id: target.id,
          linkage: 'direct',
          directionality: 'directed',
          relationship_strength: 'unspecified',
          relationship_nature: 'unspecified',
          interface_detail: '',
          ...endpointPatch(source.id, 'source'),
          ...endpointPatch(target.id, 'target'),
          external_source: source.kind === 'external' ? source.label : '',
          external_target: target.kind === 'external' ? target.label : '',
          flow_description: '',
          operating_condition: '',
          function_ids: [],
          requirement_ids: [],
        }] })
      }} className="flex items-center gap-1 rounded border border-dashed border-blue-300 px-3 py-2 text-xs text-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
      <Plus size={13} /> Add interface
    </button>
  </>
}

function PDiagramEditor({
  analysis, query, update, selectedId, setSelectedId, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  query: string
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
  selectedId: string
  setSelectedId: (id: string) => void
  selection: FunctionContextSelection|null
  onSelect: (selection: FunctionContextSelection) => void
}) {
  const changeDiagram = (id: string, patch: Partial<FMEAPDiagram>) =>
    update({ p_diagrams: analysis.p_diagrams.map(item =>
      item.id === id ? { ...item, ...patch } : item) })
  const changeItem = (
    diagramId: string, itemId: string, patch: Partial<FMEAPDiagramItem>,
  ) => {
    const diagram = analysis.p_diagrams.find(item => item.id === diagramId)
    if (!diagram) return
    changeDiagram(diagramId, { items: diagram.items.map(item =>
      item.id === itemId ? { ...item, ...patch } : item) })
  }
  const queryText = query.trim().toLowerCase()
  const shown = analysis.p_diagrams.filter(diagram => !queryText
    || diagram.title.toLowerCase().includes(queryText)
    || diagram.items.some(item =>
      `${item.label} ${item.description}`.toLowerCase().includes(queryText)))
  return <>
    {shown.map(diagram => {
      const ordinal = analysis.p_diagrams.findIndex(
        value => value.id === diagram.id) + 1
      return <div key={diagram.id}
      data-context-kind="p_diagram" data-context-id={diagram.id}
      className={`space-y-2 rounded-lg border bg-white p-3 ${
        selectedId === diagram.id
          || (selection?.kind === 'p_diagram' && selection.id === diagram.id)
          || (selection?.kind === 'p_item'
            && selection.parentId === diagram.id)
          ? 'border-blue-300 ring-2 ring-blue-100'
          : 'border-slate-200'}`}
      onClick={event => {
        if ((event.target as HTMLElement).closest('[data-p-item]')) return
        setSelectedId(diagram.id)
        onSelect({ kind: 'p_diagram', id: diagram.id })
      }}>
      <div className="flex items-center gap-1">
        <OrdinalBadge value={`PD${ordinal}`}
          title={`Parameter diagram ${ordinal}`} />
        <input value={diagram.title} onChange={event =>
          changeDiagram(diagram.id, { title: event.target.value })}
          placeholder="P-diagram title" className={fieldClass} />
        <button onClick={event => {
          event.stopPropagation()
          update({ p_diagrams: analysis.p_diagrams.filter(
            value => value.id !== diagram.id) })
          if (selectedId === diagram.id) setSelectedId('')
        }} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
      </div>
      <label className="text-[10px] text-slate-500">Ideal / primary function
        <select value={diagram.primary_function_id} onChange={event =>
          changeDiagram(diagram.id, {
            primary_function_id: event.target.value,
          })} className={`mt-1 ${fieldClass}`}>
          {analysis.functions.map(fn =>
            <option key={fn.id} value={fn.id}>{fn.description || fn.id}</option>)}
        </select>
      </label>
      <IdChecklist label="Supporting functions"
        options={analysis.functions
          .filter(value => value.id !== diagram.primary_function_id)
          .map(value => ({ id: value.id, label: value.description || value.id }))}
        values={diagram.supporting_function_ids}
        onChange={supporting_function_ids =>
          changeDiagram(diagram.id, { supporting_function_ids })} />
      <div className="space-y-1">
        {diagram.items.map(item =>
          <div key={item.id} data-p-item
            data-context-kind="p_item" data-context-id={item.id}
            onClick={() => {
              setSelectedId(diagram.id)
              onSelect({
                kind: 'p_item',
                id: item.id,
                parentId: diagram.id,
              })
            }}
            onFocusCapture={() => {
              setSelectedId(diagram.id)
              onSelect({
                kind: 'p_item',
                id: item.id,
                parentId: diagram.id,
              })
            }}
            className={`rounded border bg-slate-50 p-2 ${
              selection?.kind === 'p_item' && selection.id === item.id
                ? 'border-blue-400 ring-1 ring-blue-200'
                : 'border-slate-100'
            }`}>
            <div className="grid gap-1 md:grid-cols-[130px_1fr_auto]">
              <select value={item.category} onChange={event =>
                changeItem(diagram.id, item.id, {
                  category: event.target.value as FMEAPDiagramItem['category'],
                })} className={fieldClass}>
                <option value="signal_input">Signal input</option>
                <option value="intended_output">Intended output</option>
                <option value="control_factor">Control factor</option>
                <option value="noise_factor">Noise factor</option>
                <option value="error_state">Error state</option>
              </select>
              <input value={item.label} onChange={event =>
                changeItem(diagram.id, item.id, { label: event.target.value })}
                placeholder="Factor / response" className={fieldClass} />
              <button onClick={() => changeDiagram(diagram.id, {
                items: diagram.items.filter(value => value.id !== item.id),
              })} className="text-slate-300 hover:text-red-500">
                <Trash2 size={12} />
              </button>
            </div>
            <input value={item.description} onChange={event =>
              changeItem(diagram.id, item.id, {
                description: event.target.value,
              })} placeholder="Description / condition"
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[10px]" />
            <IdChecklist label="Linked requirements"
              options={analysis.functional_requirements.map(value => ({
                id: value.id, label: value.statement || value.id,
              }))} values={item.requirement_ids}
              onChange={requirement_ids =>
                changeItem(diagram.id, item.id, { requirement_ids })} />
          </div>)}
        <button onClick={() => changeDiagram(diagram.id, {
          items: [...diagram.items, {
            id: uid('PDI'), category: 'signal_input', label: '',
            description: '', requirement_ids: [],
          }],
        })} className="flex items-center gap-1 text-[10px] text-blue-700">
          <Plus size={11} /> Add factor or response
        </button>
      </div>
    </div>})}
    <button disabled={!analysis.functions.length} onClick={() => {
      const created: FMEAPDiagram = {
        id: uid('PD'), title: 'Parameter diagram',
        primary_function_id: analysis.functions[0]?.id ?? '',
        supporting_function_ids: [], items: [],
      }
      update({ p_diagrams: [...analysis.p_diagrams, created] })
      setSelectedId(created.id)
    }} className="flex items-center gap-1 rounded border border-dashed border-blue-300 px-3 py-2 text-xs text-blue-700 disabled:opacity-40">
      <Plus size={13} /> Add P-diagram
    </button>
  </>
}

function buildFunctionCoverage(analysis: AIAGVDAFMEAAnalysis) {
  return analysis.structure_nodes.map(node => {
    const functions = analysis.functions.filter(
      item => item.structure_node_id === node.id)
    const functionIds = functions.map(item => item.id)
    const requirementIds = [...new Set(
      analysis.function_requirement_links
        .filter(item => functionIds.includes(item.function_id))
        .map(item => item.requirement_id),
    )]
    const interfaceIds = analysis.interfaces.filter(item =>
      item.source_structure_node_id === node.id
      || item.target_structure_node_id === node.id).map(item => item.id)
    const failureChainIds = analysis.failure_chains.filter(item =>
      item.function_id && functionIds.includes(item.function_id)).map(item => item.id)
    const gaps: string[] = []
    if (!functionIds.length) gaps.push('function')
    if (functionIds.length && !requirementIds.length) gaps.push('requirement')
    if (functionIds.length && !failureChainIds.length) gaps.push('failure chain')
    if (node.interface.trim() && !interfaceIds.length) gaps.push('structured interface')
    return {
      structure_node_id: node.id, structure_name: node.name, level: node.level,
      function_ids: functionIds, requirement_ids: requirementIds,
      interface_ids: interfaceIds, failure_chain_ids: failureChainIds, gaps,
    }
  })
}

function FunctionTreeView({
  analysis, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  selection: FunctionContextSelection|null
  onSelect: (
    selection: FunctionContextSelection,
    editor: FunctionEditorView,
  ) => void
}) {
  const byParent = new Map<string, FMEAStructureNode[]>()
  for (const node of analysis.structure_nodes) {
    const key = node.parent_id ?? ''
    byParent.set(key, [...(byParent.get(key) ?? []), node])
  }
  const rootCandidates = analysis.structure_nodes.filter(node =>
    !node.parent_id
    || !analysis.structure_nodes.some(item => item.id === node.parent_id))
  const roots = rootCandidates.length
    ? rootCandidates : analysis.structure_nodes.slice(0, 1)
  const selectedFunctionIds = new Set<string>()
  if (selection?.kind === 'function') selectedFunctionIds.add(selection.id)
  if (selection?.kind === 'correlation' && selection.parentId) {
    selectedFunctionIds.add(selection.parentId)
  }
  if (selection?.kind === 'requirement') {
    analysis.function_requirement_links
      .filter(item => item.requirement_id === selection.id)
      .forEach(item => selectedFunctionIds.add(item.function_id))
  }
  if (selection?.kind === 'interface') {
    analysis.interfaces.find(item => item.id === selection.id)
      ?.function_ids.forEach(id => selectedFunctionIds.add(id))
  }
  if (selection?.kind === 'relationship') {
    const link = analysis.function_links.find(item => item.id === selection.id)
    if (link) {
      selectedFunctionIds.add(link.source_function_id)
      selectedFunctionIds.add(link.target_function_id)
    }
  }
  if (selection?.kind === 'p_diagram' || selection?.kind === 'p_item') {
    const diagram = analysis.p_diagrams.find(item =>
      item.id === (selection.kind === 'p_diagram'
        ? selection.id : selection.parentId))
    if (diagram) {
      selectedFunctionIds.add(diagram.primary_function_id)
      diagram.supporting_function_ids.forEach(id => selectedFunctionIds.add(id))
    }
  }
  const selectedStructureIds = new Set<string>()
  if (selection?.kind === 'structure') selectedStructureIds.add(selection.id)
  for (const functionId of selectedFunctionIds) {
    const structureId = analysis.functions.find(
      item => item.id === functionId)?.structure_node_id
    if (structureId) selectedStructureIds.add(structureId)
  }
  const branch = (node: FMEAStructureNode, trail: Set<string>): React.ReactNode => {
    const cycle = trail.has(node.id)
    const functions = analysis.functions.filter(
      item => item.structure_node_id === node.id)
    const children = cycle ? [] : byParent.get(node.id) ?? []
    const selectedStructure = selectedStructureIds.has(node.id)
    return <div key={`${node.id}-${trail.size}`} className="relative">
      <div role="button" tabIndex={0}
        aria-label={`Select structure element ${node.name || node.id}`}
        aria-pressed={selectedStructure}
        onClick={() => onSelect(
          { kind: 'structure', id: node.id },
          'functions',
        )}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onSelect({ kind: 'structure', id: node.id }, 'functions')
        }}
        className={`rounded-lg border bg-blue-50 p-2 transition ${
          selectedStructure
            ? 'border-blue-500 ring-2 ring-blue-200'
            : 'border-blue-200 hover:border-blue-400'
        }`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-800">{node.name || 'Unnamed element'}</div>
          <span className="text-[9px] uppercase text-blue-600">{node.level.replace(/_/g, ' ')}</span>
        </div>
        <div className="mt-2 grid gap-1 lg:grid-cols-2">
          {functions.map(fn => {
            const requirements = analysis.function_requirement_links.filter(
              item => item.function_id === fn.id)
            const childrenCount = analysis.function_links.filter(item =>
              item.source_function_id === fn.id
              && item.relationship === 'decomposes_to').length
            const selectedFunction = selectedFunctionIds.has(fn.id)
            return <div key={fn.id} role="button" tabIndex={0}
              aria-label={`Select function ${fn.description || fn.id}`}
              aria-pressed={selectedFunction}
              onClick={event => {
                event.stopPropagation()
                onSelect({ kind: 'function', id: fn.id }, 'functions')
              }}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                onSelect({ kind: 'function', id: fn.id }, 'functions')
              }}
              className={`rounded border bg-white p-2 transition ${
                selectedFunction
                  ? 'border-emerald-500 ring-2 ring-emerald-200'
                  : 'border-emerald-200 hover:border-emerald-400'
              }`}>
              <div className="text-[11px] font-semibold text-slate-700">
                {fn.description || 'Function not defined'}
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                <span className="rounded bg-emerald-50 px-1 text-emerald-700">
                  {functionTypeLabel(fn.function_type)}
                </span>
                <span className="rounded bg-slate-100 px-1 text-slate-500">
                  {requirements.length} requirement(s)
                </span>
                {childrenCount > 0 && <span className="rounded bg-blue-50 px-1 text-blue-600">
                  {childrenCount} child function(s)
                </span>}
              </div>
            </div>
          })}
          {!functions.length && <div className="rounded border border-dashed border-amber-300 px-2 py-1 text-[10px] text-amber-700">
            Function not allocated
          </div>}
        </div>
        {cycle && <div className="mt-1 text-[10px] text-red-600">Structure cycle detected</div>}
      </div>
      {children.length > 0 && <div className="ml-5 border-l border-slate-300 pl-4 pt-2">
        <div className="space-y-2">{children.map(child =>
          branch(child, new Set([...trail, node.id])))}</div>
      </div>}
    </div>
  }
  return <div aria-label="Static FMEA function tree"
    className="min-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3 text-[10px] font-medium uppercase tracking-wide text-slate-400">
      Structure and allocated functions
    </div>
    {roots.length
      ? <div className="space-y-3">{roots.map(node => branch(node, new Set()))}</div>
      : <EmptyFunctionView text="Add structure elements and functions to build the tree." />}
  </div>
}

function InterfaceFlowView({
  analysis, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  selection: FunctionContextSelection|null
  onSelect: (
    selection: FunctionContextSelection,
    editor: FunctionEditorView,
  ) => void
}) {
  const blockName = (
    blockId?: string,
    structureId?: string,
    external?: string,
  ) => {
    const block = analysis.block_diagram.nodes.find(item => item.id === blockId)
    if (block?.kind === 'structure') {
      return analysis.structure_nodes.find(
        item => item.id === block.structure_node_id)?.name
        || block.label || 'Unspecified'
    }
    return block?.label || external
      || analysis.structure_nodes.find(item => item.id === structureId)?.name
      || 'Unspecified'
  }
  const typeCode: Record<FMEAInterface['interface_type'], string> = {
    physical: 'P',
    energy: 'E',
    information: 'I',
    material: 'M',
    human_machine: 'H',
    clearance: 'C',
  }
  const functionName = (id: string) =>
    analysis.functions.find(item => item.id === id)?.description || id
  return <div aria-label="Static FMEA input and interface flow"
    className="min-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3 text-[10px] font-medium uppercase tracking-wide text-slate-400">
      Source → flow → destination
    </div>
    <div className="space-y-2">
      {analysis.interfaces.map(item => {
        const sourceBlock = analysis.block_diagram.nodes.find(
          block => block.id === item.source_block_id)
        const targetBlock = analysis.block_diagram.nodes.find(
          block => block.id === item.target_block_id)
        const structureIds = [
          sourceBlock?.structure_node_id ?? item.source_structure_node_id,
          targetBlock?.structure_node_id ?? item.target_structure_node_id,
        ].filter(Boolean)
        const active = (selection?.kind === 'interface'
            && selection.id === item.id)
          || (selection?.kind === 'structure'
            && structureIds.includes(selection.id))
          || (selection?.kind === 'function'
            && item.function_ids.includes(selection.id))
          || (selection?.kind === 'requirement'
            && item.requirement_ids.includes(selection.id))
          || (selection?.kind === 'correlation'
            && !!selection.relatedId
            && item.requirement_ids.includes(selection.relatedId))
        return <div key={item.id} role="button" tabIndex={0}
          aria-label={`Select interface ${item.name || item.id}`}
          aria-pressed={active}
          onClick={() => onSelect(
            { kind: 'interface', id: item.id },
            'interfaces',
          )}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onSelect({ kind: 'interface', id: item.id }, 'interfaces')
          }}
          className={`grid items-stretch gap-2 rounded-lg border bg-white p-2 transition md:grid-cols-[1fr_36px_1.2fr_36px_1fr] ${
            active
              ? 'border-blue-400 ring-2 ring-blue-100'
              : 'border-slate-200 hover:border-blue-300'
          }`}>
          <div className="flex flex-col justify-center rounded bg-blue-50 px-2 py-2">
            <span className="text-[9px] uppercase text-blue-500">Source</span>
            <span className="text-xs font-medium text-slate-700">
              {blockName(item.source_block_id,
                item.source_structure_node_id, item.external_source)}
            </span>
          </div>
          <div className="flex items-center justify-center text-slate-400">→</div>
          <div className="rounded bg-emerald-50 px-2 py-2 text-center">
            <div className="text-xs font-semibold text-slate-700">{item.name || 'Unnamed interface'}</div>
            <div className="text-[10px] text-emerald-700">
              {typeCode[item.interface_type]} ·{' '}
              {item.interface_type.replace(/_/g, ' ')} ·{' '}
              {item.flow_description || 'flow not defined'}
            </div>
            <div className="text-[9px] text-slate-400">
              {item.linkage} · {item.directionality}
            </div>
            {item.function_ids.length > 0 && <div className="mt-1 text-[9px] text-slate-500">
              {item.function_ids.map(functionName).join(' · ')}
            </div>}
          </div>
          <div className="flex items-center justify-center text-slate-400">→</div>
          <div className="flex flex-col justify-center rounded bg-purple-50 px-2 py-2">
            <span className="text-[9px] uppercase text-purple-500">Destination</span>
            <span className="text-xs font-medium text-slate-700">
              {blockName(item.target_block_id,
                item.target_structure_node_id, item.external_target)}
            </span>
          </div>
        </div>
      })}
      {analysis.function_links.filter(item =>
        item.relationship !== 'decomposes_to').map(item =>
        <div key={item.id} role="button" tabIndex={0}
          aria-label={`Select function relationship ${item.id}`}
          aria-pressed={selection?.kind === 'relationship'
            && selection.id === item.id}
          onClick={() => onSelect(
            { kind: 'relationship', id: item.id },
            'relationships',
          )}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onSelect({ kind: 'relationship', id: item.id }, 'relationships')
          }}
          className={`grid items-center gap-2 rounded border border-dashed px-3 py-2 text-[11px] md:grid-cols-[1fr_140px_1fr] ${
            selection?.kind === 'relationship' && selection.id === item.id
              ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100'
              : 'border-slate-300 hover:border-blue-300'
          }`}>
          <span>{functionName(item.source_function_id)}</span>
          <span className="text-center text-blue-600">
            → {item.relationship.replace(/_/g, ' ')} →
          </span>
          <span>{functionName(item.target_function_id)}</span>
        </div>)}
      {!analysis.interfaces.length && !analysis.function_links.length &&
        <EmptyFunctionView text="Define interfaces or function relationships to review flow." />}
    </div>
  </div>
}

const pCategoryLabels: Record<FMEAPDiagramItem['category'], string> = {
  signal_input: 'Signal inputs',
  intended_output: 'Intended outputs',
  control_factor: 'Control factors',
  noise_factor: 'Noise factors',
  error_state: 'Error states',
}

function PDiagramView({
  analysis, selectedId, setSelectedId, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  selectedId: string
  setSelectedId: (id: string) => void
  selection: FunctionContextSelection|null
  onSelect: (
    selection: FunctionContextSelection,
    editor: FunctionEditorView,
  ) => void
}) {
  const diagram = analysis.p_diagrams.find(item => item.id === selectedId)
    ?? analysis.p_diagrams[0]
  if (!diagram) return <div className="min-h-[520px] rounded-lg border border-slate-200 bg-slate-50 p-4">
    <EmptyFunctionView text="Add a P-diagram to examine signals, controls, noise, outputs, and error states." />
  </div>
  const primary = analysis.functions.find(
    item => item.id === diagram.primary_function_id)
  const group = (category: FMEAPDiagramItem['category']) =>
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {pCategoryLabels[category]}
      </div>
      <div className="space-y-1">
        {diagram.items.filter(item => item.category === category).map(item => {
          const active = (selection?.kind === 'p_item'
              && selection.id === item.id)
            || (selection?.kind === 'requirement'
              && item.requirement_ids.includes(selection.id))
            || (selection?.kind === 'correlation'
              && !!selection.relatedId
              && item.requirement_ids.includes(selection.relatedId))
          return <div key={item.id} role="button" tabIndex={0}
            aria-label={`Select P-diagram item ${item.label || item.id}`}
            aria-pressed={active}
            onClick={() => onSelect({
              kind: 'p_item',
              id: item.id,
              parentId: diagram.id,
            }, 'p_diagrams')}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect({
                kind: 'p_item',
                id: item.id,
                parentId: diagram.id,
              }, 'p_diagrams')
            }}
            className={`rounded px-2 py-1.5 transition ${
              active
                ? 'bg-blue-50 ring-2 ring-blue-200'
                : 'bg-slate-50 hover:bg-blue-50/60'
            }`}>
            <div className="text-[11px] font-medium text-slate-700">{item.label || 'Not defined'}</div>
            {item.description && <div className="text-[9px] text-slate-500">{item.description}</div>}
          </div>
        })}
        {!diagram.items.some(item => item.category === category) &&
          <div className="text-[10px] italic text-slate-400">None identified</div>}
      </div>
    </div>
  return <div aria-label="Static FMEA parameter diagram"
    className="min-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <select value={diagram.id} onChange={event => {
        setSelectedId(event.target.value)
        onSelect({
          kind: 'p_diagram',
          id: event.target.value,
        }, 'p_diagrams')
      }}
        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium">
        {analysis.p_diagrams.map(item =>
          <option key={item.id} value={item.id}>{item.title || item.id}</option>)}
      </select>
      <span className="text-[9px] uppercase tracking-wide text-slate-400">Static P-diagram</span>
    </div>
    <div className="grid gap-3 md:grid-cols-[1fr_1.2fr_1fr]">
      <div className="self-center">{group('signal_input')}</div>
      <div className="space-y-3">
        {group('control_factor')}
        <div role="button" tabIndex={0}
          aria-label={`Select P-diagram ${diagram.title || diagram.id}`}
          aria-pressed={(selection?.kind === 'p_diagram'
              && selection.id === diagram.id)
            || (selection?.kind === 'function'
              && [diagram.primary_function_id,
                ...diagram.supporting_function_ids].includes(selection.id))}
          onClick={() => onSelect({
            kind: 'p_diagram',
            id: diagram.id,
          }, 'p_diagrams')}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onSelect({ kind: 'p_diagram', id: diagram.id }, 'p_diagrams')
          }}
          className={`rounded-xl border-2 bg-blue-50 p-5 text-center shadow-sm transition ${
            (selection?.kind === 'p_diagram' && selection.id === diagram.id)
              || (selection?.kind === 'function'
                && [diagram.primary_function_id,
                  ...diagram.supporting_function_ids].includes(selection.id))
              ? 'border-blue-500 ring-2 ring-blue-200'
              : 'border-blue-300 hover:border-blue-400'
          }`}>
          <div className="text-[9px] uppercase tracking-wide text-blue-500">Ideal function</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">
            {primary?.description || 'Primary function unavailable'}
          </div>
          {diagram.supporting_function_ids.length > 0 &&
            <div className="mt-2 text-[9px] text-slate-500">
              Supported by {diagram.supporting_function_ids.map(id =>
                analysis.functions.find(item => item.id === id)?.description || id).join(' · ')}
            </div>}
        </div>
        {group('noise_factor')}
      </div>
      <div className="space-y-3 self-center">
        {group('intended_output')}
        {group('error_state')}
      </div>
    </div>
  </div>
}

function FunctionCoverageView({
  analysis, coverage, selection, onSelect,
}: {
  analysis: AIAGVDAFMEAAnalysis
  coverage: ReturnType<typeof buildFunctionCoverage>
  selection: FunctionContextSelection|null
  onSelect: (
    selection: FunctionContextSelection,
    editor: FunctionEditorView,
  ) => void
}) {
  const strength = (functionId: string, requirementId: string) =>
    analysis.function_requirement_links.find(item =>
      item.function_id === functionId
      && item.requirement_id === requirementId)?.strength
  const symbol = { strong: '●', medium: '◐', weak: '○' } as const
  return <div className="min-h-[520px] space-y-4 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        Function ↔ requirement correlation
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="min-w-full text-[10px]">
          <thead className="bg-slate-50">
            <tr><th className="sticky left-0 bg-slate-50 px-2 py-1.5 text-left">Function</th>
              {analysis.functional_requirements.map(item => {
                const active = (selection?.kind === 'requirement'
                    && selection.id === item.id)
                  || (selection?.kind === 'correlation'
                    && selection.relatedId === item.id)
                return <th key={item.id} title={item.statement}
                  className={`max-w-28 px-2 py-1.5 text-center font-medium ${
                    active ? 'bg-blue-100 text-blue-800' : ''
                  }`}>
                  <button type="button" onClick={() => onSelect({
                    kind: 'requirement',
                    id: item.id,
                  }, 'requirements')} className="rounded px-1 hover:bg-blue-100">
                    {item.id}
                  </button>
                </th>
              })}
            </tr>
          </thead>
          <tbody>{analysis.functions.map(fn => {
            const activeFunction = (selection?.kind === 'function'
                && selection.id === fn.id)
              || (selection?.kind === 'structure'
                && selection.id === fn.structure_node_id)
              || (selection?.kind === 'correlation'
                && selection.parentId === fn.id)
              || (selection?.kind === 'requirement'
                && analysis.function_requirement_links.some(item =>
                  item.function_id === fn.id
                  && item.requirement_id === selection.id))
            return <tr key={fn.id}
              onClick={() => onSelect({
                kind: 'function',
                id: fn.id,
              }, 'functions')}
              className={`cursor-pointer border-t ${
                activeFunction ? 'bg-blue-50' : 'hover:bg-slate-50'
              }`}>
              <td className={`sticky left-0 max-w-52 px-2 py-1.5 font-medium text-slate-700 ${
                activeFunction ? 'bg-blue-50' : 'bg-white'
              }`}>
                {fn.description || fn.id}
              </td>
              {analysis.functional_requirements.map(requirement => {
                const value = strength(fn.id, requirement.id)
                const correlation = analysis.function_requirement_links.find(
                  item => item.function_id === fn.id
                    && item.requirement_id === requirement.id)
                const activeCorrelation = selection?.kind === 'correlation'
                  && selection.id === correlation?.id
                return <td key={requirement.id}
                  onClick={event => {
                    if (!correlation) return
                    event.stopPropagation()
                    onSelect({
                      kind: 'correlation',
                      id: correlation.id,
                      parentId: correlation.function_id,
                      relatedId: correlation.requirement_id,
                    }, 'requirements')
                  }}
                  className={`px-2 py-1.5 text-center text-blue-700 ${
                    activeCorrelation
                      ? 'bg-blue-200 ring-1 ring-inset ring-blue-400'
                      : correlation ? 'cursor-pointer hover:bg-blue-50' : ''
                  }`}
                  title={value ? `${value} correlation` : 'No correlation'}>
                  {value ? symbol[value] : '—'}
                </td>
              })}
            </tr>
          })}</tbody>
        </table>
      </div>
      <div className="mt-1 text-[9px] text-slate-400">○ weak · ◐ medium · ● strong</div>
    </div>
    <div>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        Structure coverage
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="min-w-full text-[10px]">
          <thead className="bg-slate-50 text-slate-500"><tr>
            <th className="px-2 py-1.5 text-left">Structure element</th>
            <th className="px-2 py-1.5 text-right">Functions</th>
            <th className="px-2 py-1.5 text-right">Requirements</th>
            <th className="px-2 py-1.5 text-right">Interfaces</th>
            <th className="px-2 py-1.5 text-right">Failure chains</th>
            <th className="px-2 py-1.5 text-left">Gaps</th>
          </tr></thead>
          <tbody>{coverage.map(item => {
            const active = (selection?.kind === 'structure'
                && selection.id === item.structure_node_id)
              || (selection?.kind === 'function'
                && item.function_ids.includes(selection.id))
              || (selection?.kind === 'interface'
                && item.interface_ids.includes(selection.id))
              || (selection?.kind === 'requirement'
                && item.requirement_ids.includes(selection.id))
              || (selection?.kind === 'correlation'
                && !!selection.relatedId
                && item.requirement_ids.includes(selection.relatedId))
            return <tr key={item.structure_node_id} role="button" tabIndex={0}
              aria-label={`Select structure coverage for ${
                item.structure_name || item.structure_node_id}`}
              aria-pressed={active}
              onClick={() => onSelect({
                kind: 'structure',
                id: item.structure_node_id,
              }, 'functions')}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelect({
                  kind: 'structure',
                  id: item.structure_node_id,
                }, 'functions')
              }}
              className={`cursor-pointer border-t ${
                active ? 'bg-blue-50 ring-1 ring-inset ring-blue-200'
                  : 'hover:bg-slate-50'
              }`}>
              <td className="px-2 py-1.5 font-medium">{item.structure_name || item.structure_node_id}
                <span className="ml-1 text-[9px] text-slate-400">{item.level.replace(/_/g, ' ')}</span>
              </td>
              <td className="px-2 py-1.5 text-right">{item.function_ids.length}</td>
              <td className="px-2 py-1.5 text-right">{item.requirement_ids.length}</td>
              <td className="px-2 py-1.5 text-right">{item.interface_ids.length}</td>
              <td className="px-2 py-1.5 text-right">{item.failure_chain_ids.length}</td>
              <td className={`px-2 py-1.5 ${item.gaps.length
                ? 'text-amber-700' : 'text-emerald-700'}`}>
                {item.gaps.join(', ') || 'Complete'}
              </td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </div>
  </div>
}

function EmptyFunctionView({ text }: { text: string }) {
  return <div className="flex min-h-56 items-center justify-center px-6 text-center text-xs text-slate-400">
    {text}
  </div>
}

function blankChain(kind: FMEAKind): FMEAFailureChain {
  return {
    id: uid('FC'), effect: '', failure_mode: '', cause: '', effect_level: '',
    effect_contexts: [],
    severity: 5,
    occurrence: kind === 'fmea_msr' ? undefined : 5,
    detection: kind === 'fmea_msr' ? undefined : 5,
    frequency: kind === 'fmea_msr' ? 5 : undefined,
    monitoring: kind === 'fmea_msr' ? 5 : undefined,
    prevention_controls: '', detection_controls: '', severity_rationale: '',
    occurrence_rationale: '', detection_rationale: '',
    frequency_rationale: '', monitoring_rationale: '',
    actions: [], no_action_justification: '', post_severity_rationale: '',
    linked_hazard_ids: [], linked_fracas_ids: [], monitoring_system: '',
    system_response: '', safe_state: '',
    mitigated_effect: '', management_review_status: '',
    management_review_evidence_ids: [], remarks: '',
  }
}

export function relatedFailureCase(
  kind: FMEAKind,
  source: FMEAFailureChain,
): FMEAFailureChain {
  return {
    ...blankChain(kind),
    function_id: source.function_id,
    effect: source.effect,
    effect_contexts: (source.effect_contexts ?? []).map(context => ({
      ...structuredClone(context),
      id: uid('EC'),
    })),
    failure_mode: source.failure_mode,
    deviation_id: source.deviation_id,
    effect_level: source.effect_level,
    effect_level_id: source.effect_level_id,
    severity: source.severity,
    severity_rationale: source.severity_rationale,
    linked_hazard_ids: [...source.linked_hazard_ids],
  }
}

function FailureStep({
  analysis,
  vocabularyProfile,
  hazardOptions,
  fracasOptions,
  onNavigateReference,
  focusedChainId,
  onFocusHandled,
  onAddFailureMode,
  onAddRelatedCase,
  update,
  updateChain,
}: {
  analysis: AIAGVDAFMEAAnalysis
  vocabularyProfile: FMEAVocabularyProfile
  hazardOptions: ProgramRecordLinkOption[]
  fracasOptions: ProgramRecordLinkOption[]
  onNavigateReference: (view: 'hazards'|'fracas', id: string) => void
  focusedChainId: string
  onFocusHandled: () => void
  onAddFailureMode: (functionId: string) => void
  onAddRelatedCase: (chain: FMEAFailureChain) => void
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
  updateChain: (id: string, change: Partial<FMEAFailureChain>) => void
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const [newChainFunctionId, setNewChainFunctionId] = useState(
    analysis.functions[0]?.id ?? '')
  useEffect(() => {
    if (analysis.functions.some(item => item.id === newChainFunctionId)) return
    setNewChainFunctionId(analysis.functions[0]?.id ?? '')
  }, [analysis.functions, newChainFunctionId])
  useEffect(() => {
    if (!focusedChainId) return
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>(
        '[data-failure-chain-id]') ?? [])
        .find(element => element.dataset.failureChainId === focusedChainId)
      if (!row) return
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row.querySelector<HTMLInputElement>(
        '[data-failure-mode-input]')?.focus({ preventScroll: true })
      onFocusHandled()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusedChainId, onFocusHandled])
  return <section ref={sectionRef} className="space-y-4">
    <StepHeading number={4} title="Failure analysis"
      text="Build explicit effect → failure mode → cause chains and connect each chain to its intended function." />
    <div className="flex max-w-xl items-center gap-2 rounded border border-dashed border-blue-300 bg-blue-50/40 p-2">
      <select value={newChainFunctionId}
        onChange={event => setNewChainFunctionId(event.target.value)}
        className={fieldClass}>
        <option value="">Select function…</option>
        {analysis.functions.map(item =>
          <option key={item.id} value={item.id}>
            {item.description || item.id}
          </option>)}
      </select>
      <button type="button" disabled={!newChainFunctionId}
        onClick={() => onAddFailureMode(newChainFunctionId)}
        className="flex shrink-0 items-center gap-1 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">
        <Plus size={13} /> Add failure mode
      </button>
    </div>
    <FailureDiagram analysis={analysis} />
    <div className="space-y-2">
      {analysis.failure_chains.map((chain, index) => <div key={chain.id}
        data-failure-chain-id={chain.id}
        className={`grid gap-2 rounded-lg border bg-white p-3 transition md:grid-cols-[150px_1fr_1fr_1fr] ${
          focusedChainId === chain.id
            ? 'border-blue-300 ring-2 ring-blue-100'
            : 'border-slate-200'
        }`}>
        <div className="flex items-center justify-between gap-2 md:col-span-4">
          <div className="flex items-center gap-1.5">
            <OrdinalBadge value={`FC${index + 1}`}
              title={`Failure chain ${index + 1}`} />
            <span className="font-mono text-[10px] text-slate-400">
              {chain.id}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <button type="button" disabled={!chain.function_id}
              onClick={() => chain.function_id
                && onAddFailureMode(chain.function_id)}
              title="Add a blank failure mode already linked to this function"
              className="flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-[10px] text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40">
              <Plus size={10} /> Add mode
            </button>
            <button type="button" disabled={!chain.function_id}
              onClick={() => onAddRelatedCase(chain)}
              title="Copy this effect and failure mode into a new cause case; cause-specific ratings, controls, evidence, and actions start blank"
              className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40">
              <ClipboardCopy size={10} /> Add related case
            </button>
            <button onClick={() => update({ failure_chains:
              analysis.failure_chains.filter(item => item.id !== chain.id) })}
              title="Delete failure chain"
              className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        <select value={chain.function_id ?? ''} onChange={event =>
          updateChain(chain.id, { function_id: event.target.value || undefined })}
          className={fieldClass}><option value="">Function</option>
          {analysis.functions.map(item =>
            <option key={item.id} value={item.id}>{item.description}</option>)}</select>
        <input value={chain.effect} onChange={event => updateChain(chain.id, { effect: event.target.value })}
          placeholder="Effect" className={fieldClass} />
        <div className="flex items-start gap-1">
          <input value={chain.failure_mode} onChange={event =>
            updateChain(chain.id, { failure_mode: event.target.value })}
            data-failure-mode-input placeholder="Failure mode"
            className={fieldClass} />
          <VocabularyPicker domain="failure_deviation"
            profile={vocabularyProfile} kind={analysis.kind}
            selectedId={chain.deviation_id}
            onSelect={term => updateChain(chain.id, {
              deviation_id: term.id,
              failure_mode: chain.failure_mode.trim()
                ? chain.failure_mode
                : failureModeStarter(
                    term,
                    analysis.functions.find(
                      item => item.id === chain.function_id)?.description ?? '',
                  ),
            })} />
        </div>
        <input value={chain.cause} onChange={event => updateChain(chain.id, { cause: event.target.value })}
          placeholder="Cause / mechanism" className={fieldClass} />
        <div className="md:col-span-2">
          <VocabularyTaggedField label="Effect level / classification"
            value={chain.effect_level}
            semanticId={chain.effect_level_id}
            domain="effect_level" profile={vocabularyProfile}
            kind={analysis.kind}
            onChange={(effect_level, effect_level_id) =>
              updateChain(chain.id, { effect_level, effect_level_id })} />
        </div>
        <RecordLinkField label="Linked hazards" recordType="Hazard"
          values={chain.linked_hazard_ids} options={hazardOptions}
          onChange={linked_hazard_ids =>
            updateChain(chain.id, { linked_hazard_ids })}
          onNavigate={id => onNavigateReference('hazards', id)} />
        <RecordLinkField label="Linked FRACAS records" recordType="FRACAS"
          values={chain.linked_fracas_ids} options={fracasOptions}
          onChange={linked_fracas_ids =>
            updateChain(chain.id, { linked_fracas_ids })}
          onNavigate={id => onNavigateReference('fracas', id)} />
        <details className="md:col-span-4 rounded border border-slate-100 bg-slate-50">
          <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium text-slate-600">
            Effect contexts and severity ({(chain.effect_contexts ?? []).length})
          </summary>
          <div className="space-y-1 border-t p-2">
            {(chain.effect_contexts ?? []).map(context =>
              <div key={context.id} className="grid grid-cols-[180px_1fr_80px_auto] gap-1">
                <div className="flex items-start gap-1">
                  <input value={context.context} onChange={event => updateChain(chain.id, {
                    effect_contexts: (chain.effect_contexts ?? []).map(item =>
                      item.id === context.id
                        ? { ...item, context: event.target.value } : item),
                  })} placeholder="Stakeholder / level" className={fieldClass} />
                  <VocabularyPicker domain="effect_level"
                    profile={vocabularyProfile} kind={analysis.kind}
                    selectedId={context.level_id}
                    onSelect={term => updateChain(chain.id, {
                      effect_contexts: (chain.effect_contexts ?? []).map(item =>
                        item.id === context.id ? {
                          ...item,
                          level_id: term.id,
                          context: item.context.trim() ? item.context : term.label,
                        } : item),
                    })} />
                </div>
                <input value={context.description} onChange={event => updateChain(chain.id, {
                  effect_contexts: (chain.effect_contexts ?? []).map(item =>
                    item.id === context.id ? { ...item, description: event.target.value } : item),
                })} placeholder="Effect at this level" className={fieldClass} />
                <input type="number" min="1" max="10" step="1" value={context.severity}
                  onChange={event => {
                    const value = Math.max(1, Math.min(10, Number(event.target.value) || 1))
                    const effect_contexts = (chain.effect_contexts ?? []).map(item =>
                      item.id === context.id ? { ...item, severity: value } : item)
                    updateChain(chain.id, {
                      effect_contexts,
                      severity: Math.max(...effect_contexts.map(item => item.severity)),
                    })
                  }} className={fieldClass} />
                <button onClick={() => {
                  const effect_contexts = (chain.effect_contexts ?? []).filter(item => item.id !== context.id)
                  updateChain(chain.id, {
                    effect_contexts,
                    severity: effect_contexts.length
                      ? Math.max(...effect_contexts.map(item => item.severity))
                      : chain.severity,
                  })
                }} className="text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
              </div>)}
            <button onClick={() => updateChain(chain.id, {
              effect_contexts: [...(chain.effect_contexts ?? []), {
                id: uid('EC'),
                context: analysis.kind === 'pfmea' ? 'End user' : 'Next higher level',
                level_id: analysis.kind === 'pfmea'
                  ? 'effect_level:system-end-user'
                  : 'effect_level:next-higher-level',
                description: chain.effect,
                severity: chain.severity,
              }],
            })} className="flex items-center gap-1 text-[11px] text-blue-700">
              <Plus size={11} /> Add effect context
            </button>
            <p className="text-[10px] text-slate-400">
              The chain severity follows the highest recorded context.
            </p>
          </div>
        </details>
      </div>)}
    </div>
  </section>
}

function FailureDiagram({ analysis }: { analysis: AIAGVDAFMEAAnalysis }) {
  return <div role="img" aria-label="Static FMEA cause, failure mode, and effect relationships"
    className="rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3 grid grid-cols-[1fr_28px_1fr_28px_1fr] text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
      <span>Effect</span><span /><span>Failure mode</span><span /><span>Cause</span>
    </div>
    <div className="space-y-2">
      {analysis.failure_chains.map(chain =>
        <div key={chain.id} className="grid items-stretch grid-cols-[1fr_28px_1fr_28px_1fr]">
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
            <div className="text-xs font-semibold text-slate-800">{chain.effect || 'Effect not defined'}</div>
            {chain.effect_level && <div className="mt-1 text-[10px] text-orange-700">{chain.effect_level}</div>}
          </div>
          <div className="flex items-center justify-center text-slate-400">←</div>
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <div className="text-xs font-semibold text-slate-800">{chain.failure_mode || 'Mode not defined'}</div>
            <div className="mt-1 font-mono text-[9px] text-red-500">{chain.id}</div>
          </div>
          <div className="flex items-center justify-center text-slate-400">←</div>
          <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
            <div className="text-xs font-semibold text-slate-800">{chain.cause || 'Cause not defined'}</div>
          </div>
        </div>)}
      {analysis.failure_chains.length === 0 &&
        <div className="flex h-40 items-center justify-center text-xs text-slate-400">
          Add a failure chain to see its cause–mode–effect relationship.
        </div>}
    </div>
  </div>
}

function RiskStep({
  analysis,
  profile,
  result,
  vocabularyProfile,
  update,
  updateChain,
}: {
  analysis: AIAGVDAFMEAAnalysis
  profile?: FMEARatingProfile
  result?: AIAGVDAFMEAResult
  vocabularyProfile: FMEAVocabularyProfile
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
  updateChain: (id: string, change: Partial<FMEAFailureChain>) => void
}) {
  return <section className="space-y-4">
    <StepHeading number={5} title="Risk analysis"
      text="Select ratings from the controlled profile, record the evidence basis, and use Action Priority to direct review and action." />
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white p-3">
      <div>
        <div className="text-xs font-semibold text-slate-700">{profile?.name ?? 'Rating profile unavailable'}</div>
        <div className="text-[10px] text-slate-400">
          Version {profile?.version ?? '—'} · {profile?.method_status ?? 'Run analysis to verify'}
          {profile?.checksum && <> · <span className="font-mono">{profile.checksum.slice(0, 12)}…</span></>}
        </div>
      </div>
      <button onClick={() => update({ rating_profile_id: undefined })}
        className="hidden">Reset profile</button>
      <div className="max-w-lg text-[11px] text-slate-500">
        Action Priority is a need-for-action classification—not a probability,
        risk magnitude, or acceptance decision. AIAG profiles do not calculate RPN.
      </div>
    </div>
    <div className="space-y-3">
      {analysis.failure_chains.map((chain, index) => {
        const evaluated = result?.failure_chains.find(item => item.id === chain.id)
        const msr = analysis.kind === 'fmea_msr'
        return <div key={chain.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <OrdinalBadge value={`FC${index + 1}`}
                title={`Risk record ${index + 1}`} />
              <div><div className="text-xs font-semibold text-slate-800">{chain.failure_mode || chain.id}</div>
              <div className="text-[11px] text-slate-400">{chain.effect} ← {chain.cause}</div></div>
            </div>
            {evaluated && <span className={`rounded-full border px-3 py-1 text-xs font-bold ${priorityClass(evaluated.action_priority)}`}>
              AP {evaluated.action_priority}
            </span>}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2"><RatingSelect label="Severity (S)" value={chain.severity}
              axis="severity" profile={profile} onChange={severity => updateChain(chain.id, { severity })} />
              <Field label="Severity rationale" value={chain.severity_rationale}
                onChange={severity_rationale => updateChain(chain.id, { severity_rationale })} multiline /></div>
            <div className="space-y-2"><RatingSelect
              label={msr ? 'Frequency (F)' : 'Occurrence (O)'}
              value={msr ? chain.frequency : chain.occurrence}
              axis={msr ? 'frequency' : 'occurrence'} profile={profile}
              onChange={value => updateChain(chain.id, msr ? { frequency: value } : { occurrence: value })} />
              <Field label={`${msr ? 'Frequency' : 'Occurrence'} rationale`}
                value={msr ? chain.frequency_rationale : chain.occurrence_rationale}
                onChange={value => updateChain(chain.id, msr
                  ? { frequency_rationale: value } : { occurrence_rationale: value })} multiline /></div>
            <div className="space-y-2"><RatingSelect
              label={msr ? 'Monitoring (M)' : 'Detection (D)'}
              value={msr ? chain.monitoring : chain.detection}
              axis={msr ? 'monitoring' : 'detection'} profile={profile}
              onChange={value => updateChain(chain.id, msr ? { monitoring: value } : { detection: value })} />
              <Field label={`${msr ? 'Monitoring' : 'Detection'} rationale`}
                value={msr ? chain.monitoring_rationale : chain.detection_rationale}
                onChange={value => updateChain(chain.id, msr
                  ? { monitoring_rationale: value } : { detection_rationale: value })} multiline /></div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <VocabularyTaggedField label="Current prevention controls"
              value={chain.prevention_controls}
              semanticId={chain.prevention_control_method_id}
              domain="prevention_control" profile={vocabularyProfile}
              kind={analysis.kind} multiline fillWhenBlank={false}
              placeholder="Describe the specific preventive control and its basis."
              onChange={(prevention_controls, prevention_control_method_id) =>
                updateChain(chain.id, {
                  prevention_controls,
                  prevention_control_method_id,
                })} />
            <VocabularyTaggedField label="Current detection controls"
              value={chain.detection_controls}
              semanticId={chain.detection_control_method_id}
              domain="detection_control" profile={vocabularyProfile}
              kind={analysis.kind} multiline fillWhenBlank={false}
              placeholder="Describe how, where, and when the issue is detected."
              onChange={(detection_controls, detection_control_method_id) =>
                updateChain(chain.id, {
                  detection_controls,
                  detection_control_method_id,
                })} />
          </div>
          {msr && <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Monitoring system" value={chain.monitoring_system}
              onChange={monitoring_system => updateChain(chain.id, { monitoring_system })} />
            <Field label="System response" value={chain.system_response}
              onChange={system_response => updateChain(chain.id, { system_response })} />
            <Field label="Safe state" value={chain.safe_state}
              onChange={safe_state => updateChain(chain.id, { safe_state })} />
            <Field label="Response time" value={chain.response_time}
              onChange={value => updateChain(chain.id, {
                response_time: value === '' ? undefined : Number(value),
              })} />
            <Field label="Fault-tolerant interval" value={chain.fault_tolerant_interval}
              onChange={value => updateChain(chain.id, {
                fault_tolerant_interval: value === '' ? undefined : Number(value),
              })} />
            <div className="space-y-1"><Field label="Effect after response"
              value={chain.mitigated_effect}
              onChange={mitigated_effect => updateChain(chain.id, { mitigated_effect })} />
              <Field label="Severity after response"
                value={chain.mitigated_severity}
                onChange={value => updateChain(chain.id, {
                  mitigated_severity: value === '' ? undefined : Number(value),
                })} /></div>
            {chain.monitoring === 1 && <p className="md:col-span-3 xl:col-span-6 text-[10px] text-purple-700">
              With M = 1, MSR Action Priority uses the severity of the effect
              after monitoring and system response.
            </p>}
          </div>}
        </div>
      })}
    </div>
  </section>
}

function OptimizationStep({
  analysis,
  result,
  profile,
  update,
  updateChain,
}: {
  analysis: AIAGVDAFMEAAnalysis
  result?: AIAGVDAFMEAResult
  profile?: FMEARatingProfile
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
  updateChain: (id: string, change: Partial<FMEAFailureChain>) => void
}) {
  const addAction = (chain: FMEAFailureChain) => updateChain(chain.id, {
    actions: [...chain.actions, {
      id: uid('ACT'), kind: 'prevention', description: '', owner: '',
      status: 'decision_pending', evidence_ids: [], decision_rationale: '',
    }],
  })
  const updateAction = (chain: FMEAFailureChain, actionId: string, patch: Partial<FMEAAction>) =>
    updateChain(chain.id, { actions: chain.actions.map(action =>
      action.id === actionId ? { ...action, ...patch } : action) })
  return <section className="space-y-4">
    <StepHeading number={6} title="Optimization"
      text="Resolve Action Priority through prevention/detection actions or an explicit disposition, then record verified post-action ratings." />
    {analysis.failure_chains.map((chain, index) => {
      const evaluated = result?.failure_chains.find(item => item.id === chain.id)
      const msr = analysis.kind === 'fmea_msr'
      return <div key={chain.id} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <OrdinalBadge value={`OPT${index + 1}`}
              title={`Optimization record ${index + 1}`} />
            <div className="text-xs font-semibold">
              {chain.failure_mode || chain.id}
            </div>
          </div>
          {evaluated && <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${priorityClass(evaluated.action_priority)}`}>
            Initial AP {evaluated.action_priority}
          </span>}
        </div>
        <div className="mt-3 space-y-2">
          {chain.actions.map((action, actionIndex) => <div key={action.id}
            className="grid gap-1 rounded border border-slate-100 bg-slate-50 p-2 md:grid-cols-[110px_2fr_1fr_140px_130px_auto]">
            <div className="md:col-span-6">
              <OrdinalBadge value={`OPT${index + 1}-A${actionIndex + 1}`}
                title={`Action ${actionIndex + 1}`} />
            </div>
            <select value={action.kind} onChange={event => updateAction(chain, action.id, {
              kind: event.target.value as FMEAAction['kind'],
            })} className={fieldClass}>
              {['prevention', 'detection', 'design', 'process'].map(value =>
                <option key={value}>{value}</option>)}
            </select>
            <input value={action.description} onChange={event =>
              updateAction(chain, action.id, { description: event.target.value })}
              placeholder="Action" className={fieldClass} />
            <input value={action.owner} onChange={event =>
              updateAction(chain, action.id, { owner: event.target.value })}
              placeholder="Owner" className={fieldClass} />
            <select value={action.status} onChange={event => updateAction(chain, action.id, {
              status: event.target.value as FMEAAction['status'],
            })} className={fieldClass}>
              {['open', 'decision_pending', 'implementation_pending', 'completed', 'not_implemented'].map(value =>
                <option key={value}>{value.replace(/_/g, ' ')}</option>)}
            </select>
            <input type="date" value={action.target_date ?? ''} onChange={event =>
              updateAction(chain, action.id, { target_date: event.target.value || undefined })}
              className={fieldClass} />
            <button onClick={() => updateChain(chain.id, {
              actions: chain.actions.filter(item => item.id !== action.id),
            })} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
            {action.status === 'completed' && <>
              <input type="date" value={action.completion_date ?? ''} onChange={event =>
                updateAction(chain, action.id, { completion_date: event.target.value || undefined })}
                className={fieldClass} />
              <input value={action.evidence_ids.join(', ')} onChange={event =>
                updateAction(chain, action.id, {
                  evidence_ids: event.target.value.split(',').map(value => value.trim()).filter(Boolean),
                })} placeholder="Effectiveness evidence IDs" className="md:col-span-2 rounded border border-slate-300 px-2 py-1 text-xs" />
            </>}
            {action.status === 'not_implemented' && <input value={action.decision_rationale}
              onChange={event => updateAction(chain, action.id, { decision_rationale: event.target.value })}
              placeholder="Decision rationale" className="md:col-span-3 rounded border border-slate-300 px-2 py-1 text-xs" />}
          </div>)}
          <button onClick={() => addAction(chain)}
            className="flex items-center gap-1 text-xs text-blue-700"><Plus size={12} /> Add action</button>
          <Field label="No-action justification / disposition" value={chain.no_action_justification}
            onChange={no_action_justification => updateChain(chain.id, { no_action_justification })} multiline />
          {chain.severity >= 9 && <div className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-2 md:grid-cols-2">
            <label className="text-[11px] font-medium text-slate-600">Management review
              <select value={chain.management_review_status} onChange={event =>
                updateChain(chain.id, { management_review_status: event.target.value })}
                className={`mt-1 ${fieldClass}`}>
                <option value="">Not recorded</option>
                <option value="planned">Planned</option>
                <option value="reviewed">Reviewed</option>
                <option value="approved">Approved</option>
              </select>
            </label>
            <Field label="Management-review evidence IDs" value={(chain.management_review_evidence_ids ?? []).join(', ')}
              onChange={value => updateChain(chain.id, {
                management_review_evidence_ids: value.split(',').map(item => item.trim()).filter(Boolean),
              })} />
          </div>}
        </div>
        <details className="mt-3 rounded border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">
            Post-action evaluation {evaluated?.post_action_priority && `· AP ${evaluated.post_action_priority}`}
          </summary>
          <div className="grid gap-3 border-t p-3 md:grid-cols-3">
            <RatingSelect label="Post severity" value={chain.post_severity}
              axis="severity" profile={profile} onChange={post_severity => updateChain(chain.id, { post_severity })} />
            <RatingSelect label={`Post ${msr ? 'frequency' : 'occurrence'}`}
              value={msr ? chain.post_frequency : chain.post_occurrence}
              axis={msr ? 'frequency' : 'occurrence'} profile={profile}
              onChange={value => updateChain(chain.id, msr
                ? { post_frequency: value } : { post_occurrence: value })} />
            <RatingSelect label={`Post ${msr ? 'monitoring' : 'detection'}`}
              value={msr ? chain.post_monitoring : chain.post_detection}
              axis={msr ? 'monitoring' : 'detection'} profile={profile}
              onChange={value => updateChain(chain.id, msr
                ? { post_monitoring: value } : { post_detection: value })} />
            {msr && chain.post_monitoring === 1 && <RatingSelect
              label="Post severity after response"
              value={chain.post_mitigated_severity}
              axis="severity" profile={profile}
              onChange={post_mitigated_severity =>
                updateChain(chain.id, { post_mitigated_severity })} />}
            <div className="md:col-span-3"><Field label="Severity-change rationale"
              value={chain.post_severity_rationale}
              onChange={post_severity_rationale => updateChain(chain.id, { post_severity_rationale })} multiline /></div>
          </div>
        </details>
      </div>
    })}
    {analysis.kind === 'pfmea' && <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
      PFMEA-derived Control Plan changes are waiting in the Control Plan view.
      Review and accept them individually; Perdura does not silently overwrite
      sampling, reaction-plan, or responsibility decisions.
    </div>}
  </section>
}

function DocumentationStep({
  analysis,
  result,
  update,
}: {
  analysis: AIAGVDAFMEAAnalysis
  result?: AIAGVDAFMEAResult
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
}) {
  return <section className="space-y-4">
    <StepHeading number={7} title="Results documentation"
      text="Review completeness, document the method/profile revision, and finalize only when blocking findings are resolved." />
    {!result ? <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
      Run <strong>Analyze program</strong> to generate the readiness review and Action Priority results.
    </div> : <>
      <div className="text-[10px] font-medium text-slate-500">Results summary</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Failure chains" value={result.summary.failure_chains} />
        <Metric label="High AP" value={result.summary.high_action_priority} tone="red" />
        <Metric label="Open actions" value={result.summary.open_actions} tone="amber" />
        <Metric label="Errors" value={result.summary.errors} tone="red" />
        <Metric label="Warnings" value={result.summary.warnings} />
      </div>
      <div className="text-[10px] font-medium text-slate-500">FMES summary</div>
      <FmesSummary analysis={analysis} result={result} />
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b px-4 py-3 text-xs font-semibold text-slate-700">
          Readiness findings
        </div>
        {result.issues.length === 0
          ? <div className="p-4 text-xs text-emerald-700">No blocking or advisory findings.</div>
          : <div className="divide-y">{result.issues.map((issue, index) =>
            <div key={`${issue.code}-${issue.record_id}-${index}`}
              className="flex gap-3 px-4 py-2 text-xs">
              <span className={`mt-0.5 h-fit rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                issue.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                STEP {issue.step}
              </span>
              <div><div className="text-slate-700">{issue.message}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {issue.code.replace(/_/g, ' ')}
                  {issue.record_id && ` · ${issue.record_id}`}
                </div></div>
            </div>)}</div>}
      </div>
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <div className="font-medium text-slate-700">{result.methodology.title}</div>
        <div>{result.methodology.edition} · {result.methodology.errata}</div>
        <div className="mt-1">{result.methodology.implementation_status} · method {result.methodology.method_version}</div>
        <div className="mt-1 font-mono text-[10px]">Profile checksum: {result.methodology.profile_checksum}</div>
      </div>
      <button disabled={!result.finalization_ready} onClick={() => update({ status: 'finalized' })}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">
        {result.finalization_ready ? 'Finalize this revision' : 'Resolve blocking findings to finalize'}
      </button>
    </>}
    <div className="text-xs text-slate-500">
      Steps remain navigable at all times. Finalization is the only gated operation.
      A finalized revision retains the selected rating-profile version and checksum.
    </div>
  </section>
}

type FmesSort = 'risk'|'cases'|'name'

const fmesPriorityRank = (value?: string|null) =>
  value === 'H' ? 3 : value === 'M' ? 2 : value === 'L' ? 1 : 0

function sortFmesGroups(
  groups: FmesSummaryGroup[],
  sort: FmesSort,
): FmesSummaryGroup[] {
  const compare = (a: FmesSummaryGroup, b: FmesSummaryGroup) => {
    if (sort === 'name') return a.label.localeCompare(b.label)
    if (sort === 'cases') {
      return b.chains.length - a.chains.length
        || b.failure_modes.length - a.failure_modes.length
        || a.label.localeCompare(b.label)
    }
    return fmesPriorityRank(b.highest_action_priority)
        - fmesPriorityRank(a.highest_action_priority)
      || b.maximum_severity - a.maximum_severity
      || b.chains.length - a.chains.length
      || a.label.localeCompare(b.label)
  }
  return groups.map(group => ({
    ...group,
    subgroups: [...group.subgroups].sort(compare),
  })).sort(compare)
}

function FmesSummary({
  analysis,
  result,
}: {
  analysis: AIAGVDAFMEAAnalysis
  result: AIAGVDAFMEAResult
}) {
  const [groupBy, setGroupBy] =
    useState<FmesGroupDimension>('effect')
  const [thenBy, setThenBy] =
    useState<FmesGroupDimension|''>('')
  const [sort, setSort] = useState<FmesSort>('risk')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const functionById = useMemo(() => new Map(
    analysis.functions.map(item => [item.id, item])), [analysis.functions])
  const structureById = useMemo(() => new Map(
    analysis.structure_nodes.map(item => [item.id, item])),
  [analysis.structure_nodes])
  const chains = useMemo(() => {
    if (!normalizedQuery) return result.failure_chains
    return result.failure_chains.filter(chain => {
      const fn = chain.function_id
        ? functionById.get(chain.function_id)
        : undefined
      const structure = fn
        ? structureById.get(fn.structure_node_id)
        : undefined
      return [
        chain.id, chain.effect, chain.effect_level, chain.failure_mode,
        chain.cause, chain.action_priority, chain.post_action_priority,
        fn?.description, structure?.name,
        ...(fn?.operating_modes ?? []),
        ...(chain.linked_hazard_ids ?? []),
        ...(chain.effect_contexts ?? []).flatMap(item =>
          [item.context, item.description]),
      ].some(value => String(value ?? '').toLocaleLowerCase()
        .includes(normalizedQuery))
    })
  }, [
    functionById, normalizedQuery, result.failure_chains, structureById,
  ])
  const groups = useMemo(() => sortFmesGroups(buildFmesSummary(
    analysis, groupBy, thenBy || undefined, chains,
  ), sort), [analysis, chains, groupBy, sort, thenBy])
  const groupDescription = FMES_GROUP_DIMENSIONS.find(
    item => item.value === groupBy)?.description
  const canDuplicate = [groupBy, thenBy].some(value =>
    ['effect_context', 'operating_mode', 'hazard'].includes(value))

  return <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="border-b border-slate-200 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-xs font-semibold text-slate-800">
            Failure Modes and Effects Summary (FMES)
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Review related failure cases as a consolidated summary. Common
            Effect is the conventional view; alternate dimensions expose
            functional, structural, causal, priority, and hazard patterns.
          </p>
        </div>
        <div className="rounded bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
          {chains.length} of {result.failure_chains.length} unique case{
            result.failure_chains.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_190px_190px_150px]">
        <label className="relative block">
          <Search size={12}
            className="pointer-events-none absolute left-2 top-2.5 text-slate-400" />
          <input value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Filter effects, modes, causes, functions…"
            aria-label="Filter FMES"
            className={`${fieldClass} pl-7`} />
        </label>
        <label className="text-[10px] font-medium text-slate-500">
          Group by
          <select value={groupBy} onChange={event => {
            const value = event.target.value as FmesGroupDimension
            setGroupBy(value)
            if (thenBy === value) setThenBy('')
          }} className={`mt-0.5 ${fieldClass}`}>
            {FMES_GROUP_DIMENSIONS.map(option =>
              <option key={option.value} value={option.value}>
                {option.label}
              </option>)}
          </select>
        </label>
        <label className="text-[10px] font-medium text-slate-500">
          Then by
          <select value={thenBy} onChange={event =>
            setThenBy(event.target.value as FmesGroupDimension|'')}
            className={`mt-0.5 ${fieldClass}`}>
            <option value="">No secondary grouping</option>
            {FMES_GROUP_DIMENSIONS.filter(
              option => option.value !== groupBy).map(option =>
              <option key={option.value} value={option.value}>
                {option.label}
              </option>)}
          </select>
        </label>
        <label className="text-[10px] font-medium text-slate-500">
          Sort
          <select value={sort} onChange={event =>
            setSort(event.target.value as FmesSort)}
            className={`mt-0.5 ${fieldClass}`}>
            <option value="risk">Highest priority</option>
            <option value="cases">Most cases</option>
            <option value="name">Group name</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        {groupDescription} Matching ignores capitalization and repeated
        whitespace; it does not infer that differently worded effects are
        equivalent.
        {canDuplicate && ' Because this dimension can have multiple values, one case may appear in more than one group.'}
      </p>
    </div>
    {groups.length
      ? <div className="divide-y divide-slate-100">
          {groups.map(group =>
            <FmesGroupView key={group.key} analysis={analysis}
              group={group} secondaryDimension={thenBy || undefined} />)}
        </div>
      : <div className="px-4 py-8 text-center text-xs text-slate-400">
          {result.failure_chains.length
            ? 'No failure cases match this filter.'
            : 'No failure cases are available for the summary.'}
        </div>}
  </section>
}

function FmesGroupView({
  analysis,
  group,
  secondaryDimension,
}: {
  analysis: AIAGVDAFMEAAnalysis
  group: FmesSummaryGroup
  secondaryDimension?: FmesGroupDimension
}) {
  const secondaryLabel = FMES_GROUP_DIMENSIONS.find(
    item => item.value === secondaryDimension)?.label
  return <details className="group/fmes">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 hover:bg-slate-50">
      <ChevronDown size={13}
        className="-rotate-90 text-slate-400 transition-transform group-open/fmes:rotate-0" />
      <div className="min-w-48 flex-1">
        <div className="text-xs font-semibold text-slate-800">
          {group.label}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-slate-400"
          title={group.failure_modes.join(' · ')}>
          {group.failure_modes.length
            ? group.failure_modes.join(' · ')
            : 'No failure mode stated'}
        </div>
      </div>
      <FmesCount value={group.failure_modes.length} label="modes" />
      <FmesCount value={group.chains.length} label="cases" />
      <FmesCount value={group.causes.length} label="causes" />
      <span className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
        Max S <strong>{group.maximum_severity || '—'}</strong>
      </span>
      {group.highest_action_priority &&
        <span className={`rounded border px-2 py-1 text-[10px] font-bold ${
          priorityClass(group.highest_action_priority)}`}>
          AP {group.highest_action_priority}
        </span>}
      {group.open_actions > 0 &&
        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
          {group.open_actions} open action{group.open_actions === 1 ? '' : 's'}
        </span>}
    </summary>
    <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
      {secondaryDimension
        ? <div className="space-y-3">
            {group.subgroups.map(subgroup => <div key={subgroup.key}
              className="overflow-hidden rounded border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-3 py-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {secondaryLabel}
                </span>
                <span className="text-xs font-semibold text-slate-700">
                  {subgroup.label}
                </span>
                <span className="ml-auto text-[10px] text-slate-400">
                  {subgroup.failure_modes.length} mode{
                    subgroup.failure_modes.length === 1 ? '' : 's'} · {
                    subgroup.chains.length} case{
                    subgroup.chains.length === 1 ? '' : 's'}
                </span>
              </div>
              <FmesChainTable analysis={analysis} chains={subgroup.chains} />
            </div>)}
          </div>
        : <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <FmesChainTable analysis={analysis} chains={group.chains} />
          </div>}
    </div>
  </details>
}

function FmesCount({ value, label }: { value: number; label: string }) {
  return <span className="whitespace-nowrap text-[10px] text-slate-500">
    <strong className="text-slate-700">{value}</strong> {label}
  </span>
}

function FmesChainTable({
  analysis,
  chains,
}: {
  analysis: AIAGVDAFMEAAnalysis
  chains: FmesChain[]
}) {
  const functionById = new Map(
    analysis.functions.map(item => [item.id, item.description]))
  const msr = analysis.kind === 'fmea_msr'
  return <div className="overflow-x-auto">
    <table className="min-w-[1050px] w-full text-[11px]">
      <thead className="bg-slate-50 text-slate-500"><tr>
        {['Case', 'Failure mode', 'Function', 'Effect', 'Cause',
          'S', msr ? 'F' : 'O', msr ? 'M' : 'D', 'AP', 'Post AP',
          'Open actions'].map(label =>
          <th key={label} className="px-2 py-2 text-left font-medium">
            {label}
          </th>)}
      </tr></thead>
      <tbody>{chains.map(chain => {
        const openActions = chain.actions.filter(action =>
          !['completed', 'not_implemented'].includes(action.status)).length
        return <tr key={chain.id} className="border-t align-top">
          <td className="whitespace-nowrap px-2 py-2 font-mono text-[10px] text-slate-400">
            {chain.id}
          </td>
          <td className="max-w-52 px-2 py-2 font-medium text-slate-700">
            {chain.failure_mode || '—'}
          </td>
          <td className="max-w-52 px-2 py-2 text-slate-600">
            {chain.function_id
              ? functionById.get(chain.function_id)
                ?? `Unknown (${chain.function_id})`
              : '—'}
          </td>
          <td className="max-w-52 px-2 py-2 text-slate-600">
            {chain.effect || '—'}
          </td>
          <td className="max-w-52 px-2 py-2 text-slate-600">
            {chain.cause || '—'}
          </td>
          <td className="px-2 py-2">{chain.severity || '—'}</td>
          <td className="px-2 py-2">
            {(msr ? chain.frequency : chain.occurrence) ?? '—'}
          </td>
          <td className="px-2 py-2">
            {(msr ? chain.monitoring : chain.detection) ?? '—'}
          </td>
          <td className="px-2 py-2">
            {chain.action_priority
              ? <span className={`rounded border px-1.5 py-0.5 font-bold ${
                priorityClass(chain.action_priority)}`}>
                  {chain.action_priority}
                </span>
              : '—'}
          </td>
          <td className="px-2 py-2">{chain.post_action_priority ?? '—'}</td>
          <td className="px-2 py-2">{openActions}</td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

function Worksheet({
  analysis,
  result,
  updateChain,
  profile,
}: {
  analysis: AIAGVDAFMEAAnalysis
  result?: AIAGVDAFMEAResult
  updateChain: (id: string, change: Partial<FMEAFailureChain>) => void
  profile?: FMEARatingProfile
}) {
  const msr = analysis.kind === 'fmea_msr'
  return <div className="p-4">
    <StepHeading title="Consolidated worksheet"
      text="A compact review surface for the failure chains, controls, ratings, priority, and dispositions." />
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-[1450px] text-xs">
        <thead className="bg-slate-50 text-slate-500"><tr>
          {['ID', 'Function', 'Effect', 'Failure mode', 'Cause', 'S',
            msr ? 'F' : 'O', msr ? 'M' : 'D',
            'AP', 'Prevention controls', 'Detection controls', 'Actions', 'Disposition']
            .map(label => <th key={label} className="px-2 py-2 text-left font-medium">{label}</th>)}
        </tr></thead>
        <tbody>{analysis.failure_chains.map(chain => {
          const evaluated = result?.failure_chains.find(item => item.id === chain.id)
          return <tr key={chain.id} className="border-t align-top">
            <td className="px-2 py-2 font-mono text-[10px]">{chain.id}</td>
            <td className="p-1">
              <select value={chain.function_id ?? ''}
                onChange={event => updateChain(chain.id, {
                  function_id: event.target.value || undefined,
                })}
                aria-label={`Function for ${chain.id}`}
                className="w-52 rounded border border-transparent bg-white p-1 text-xs hover:border-slate-200 focus:border-blue-400">
                <option value="">No function linked</option>
                {analysis.functions.map(fn => <option key={fn.id} value={fn.id}>
                  {fn.description || 'Unnamed function'}
                </option>)}
              </select>
            </td>
            {(['effect', 'failure_mode', 'cause'] as const).map(field =>
              <td key={field} className="p-1"><textarea value={chain[field]}
                onChange={event => updateChain(chain.id, { [field]: event.target.value })}
                className="min-h-14 w-44 resize-y rounded border border-transparent p-1 hover:border-slate-200 focus:border-blue-400" /></td>)}
            <td className="p-1"><RatingSelect label="" value={chain.severity}
              axis="severity" profile={profile} onChange={severity => updateChain(chain.id, { severity })} /></td>
            <td className="p-1"><RatingSelect label="" value={msr ? chain.frequency : chain.occurrence}
              axis={msr ? 'frequency' : 'occurrence'} profile={profile}
              onChange={value => updateChain(chain.id, msr ? { frequency: value } : { occurrence: value })} /></td>
            <td className="p-1"><RatingSelect label="" value={msr ? chain.monitoring : chain.detection}
              axis={msr ? 'monitoring' : 'detection'} profile={profile}
              onChange={value => updateChain(chain.id, msr ? { monitoring: value } : { detection: value })} /></td>
            <td className="px-2 py-2">{evaluated
              ? <span className={`rounded border px-2 py-1 font-bold ${priorityClass(evaluated.action_priority)}`}>{evaluated.action_priority}</span>
              : '—'}</td>
            <td className="p-1"><textarea value={chain.prevention_controls}
              onChange={event => updateChain(chain.id, { prevention_controls: event.target.value })}
              className="min-h-14 w-44 resize-y rounded border border-transparent p-1 hover:border-slate-200" /></td>
            <td className="p-1"><textarea value={chain.detection_controls}
              onChange={event => updateChain(chain.id, { detection_controls: event.target.value })}
              className="min-h-14 w-44 resize-y rounded border border-transparent p-1 hover:border-slate-200" /></td>
            <td className="px-2 py-2">{chain.actions.length}</td>
            <td className="px-2 py-2 max-w-52">{chain.no_action_justification || '—'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </div>
}

function ControlPlanView({
  analysis,
  result,
  update,
}: {
  analysis: AIAGVDAFMEAAnalysis
  result?: AIAGVDAFMEAResult
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
}) {
  const changeRow = (id: string, change: Partial<FMEAControlPlanRow>) =>
    update({ control_plan: analysis.control_plan.map(row =>
      row.id === id ? { ...row, ...change } : row) })
  return <div className="space-y-4 p-4">
    <StepHeading title="PFMEA-linked Control Plan"
      text="Compare PFMEA-derived proposals with accepted Control Plan content. Accepting a proposal preserves sampling and reaction-plan decisions." />
    {result?.control_plan_review.map(review =>
      <div key={review.failure_chain_id}
        className={`rounded border p-3 ${review.status === 'in_sync'
          ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/30'}`}>
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-700">
            {review.failure_chain_id} · {review.status.replace(/_/g, ' ')}
          </div>
          {review.status !== 'in_sync' && <button onClick={() => update({
            control_plan: mergeControlPlanProposal(
              analysis.control_plan, review.proposal),
          })} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">
            Accept proposed fields
          </button>}
        </div>
        {review.differences.length > 0 && <div className="mt-2 grid gap-1">
          {review.differences.map(diff => <div key={diff.field}
            className="grid grid-cols-[140px_1fr_20px_1fr] gap-2 text-[11px]">
            <span className="font-medium text-slate-500">{diff.field.replace(/_/g, ' ')}</span>
            <span className="rounded bg-white px-2 py-1 text-slate-500">{diff.current || '—'}</span>
            <span className="text-center text-slate-400">→</span>
            <span className="rounded bg-white px-2 py-1 text-slate-700">{diff.proposed || '—'}</span>
          </div>)}
        </div>}
      </div>)}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="min-w-[1350px] text-xs">
        <thead className="bg-slate-50"><tr>
          {['ID', 'Chain', 'Process step', 'Product characteristic', 'Process characteristic',
            'Specification', 'Measurement', 'Sample size', 'Frequency',
            'Control', 'Reaction plan', 'Responsibility', 'Special']
            .map(value => <th key={value} className="px-2 py-2 text-left font-medium text-slate-500">{value}</th>)}
        </tr></thead>
        <tbody>{analysis.control_plan.map(row => <tr key={row.id} className="border-t">
          <td className="px-2 font-mono text-[10px]">{row.id}</td>
          {(['failure_chain_id', 'process_step', 'product_characteristic',
            'process_characteristic', 'specification', 'measurement_method',
            'sample_size', 'frequency', 'control_method', 'reaction_plan',
            'responsibility', 'special_characteristic'] as const).map(field =>
              <td key={field} className="p-1"><input value={String(row[field] ?? '')}
                onChange={event => changeRow(row.id, { [field]: event.target.value })}
                className="w-36 rounded border border-transparent px-1 py-1 hover:border-slate-200 focus:border-blue-400" /></td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <button onClick={() => update({ control_plan: [...analysis.control_plan, {
      id: uid('CP'), process_step: '', product_characteristic: '',
      process_characteristic: '', specification: '', measurement_method: '',
      sample_size: '', frequency: '', control_method: '', reaction_plan: '',
      responsibility: '', special_characteristic: '',
      source_revision: analysis.revision, stale: false,
    }] })} className="flex items-center gap-1 text-xs text-blue-700"><Plus size={12} /> Add Control Plan row</button>
  </div>
}

function ProfileManager({
  analysis,
  profiles,
  customProfiles,
  update,
  onProfilesChange,
}: {
  analysis: AIAGVDAFMEAAnalysis
  profiles: FMEARatingProfile[]
  customProfiles: FMEARatingProfile[]
  update: (change: Partial<AIAGVDAFMEAAnalysis>) => void
  onProfilesChange: (profiles: FMEARatingProfile[]) => void
}) {
  const selected = profiles.find(item => item.id === analysis.rating_profile_id)
  const custom = customProfiles.find(item => item.id === selected?.id)
  const createVersion = () => {
    if (!selected) return
    const next: FMEARatingProfile = {
      ...structuredClone(selected),
      id: `custom_${analysis.kind}_${Date.now().toString(36)}`,
      name: `${selected.name} — organization profile`,
      version: selected.built_in ? '1.0' :
        `${Number.parseFloat(selected.version || '1') + 0.1}`.replace(/0+$/, '').replace(/\.$/, ''),
      built_in: false,
      approved: false,
      approved_by: '',
      approved_date: '',
      method_status: 'organization-defined; approval pending',
      checksum: undefined,
    }
    onProfilesChange([...customProfiles, next])
    update({ rating_profile_id: next.id })
  }
  const patch = (change: Partial<FMEARatingProfile>) => {
    if (!custom || custom.approved) return
    onProfilesChange(customProfiles.map(item =>
      item.id === custom.id ? { ...item, ...change, checksum: undefined } : item))
  }
  return <div className="space-y-4 p-4">
    <StepHeading title="Controlled rating profiles"
      text="Built-ins contain concise, independently worded selection guidance. Organization profiles are versioned and become read-only when approved." />
    <div className="flex flex-wrap items-end gap-2 rounded border bg-white p-3">
      <label className="min-w-72 flex-1 text-[11px] font-medium text-slate-600">Selected profile
        <select value={analysis.rating_profile_id ?? ''} onChange={event =>
          update({ rating_profile_id: event.target.value })} className={`mt-1 ${fieldClass}`}>
          {profiles.filter(item => item.kind === analysis.kind).map(item =>
            <option key={item.id} value={item.id}>
              {item.name} · v{item.version}{item.approved ? ' · approved' : ' · draft'}
            </option>)}
        </select>
      </label>
      <button onClick={createVersion}
        className="rounded border border-blue-300 px-3 py-1.5 text-xs text-blue-700">
        {selected?.built_in ? 'Create organization profile' : 'Create new version'}
      </button>
    </div>
    {selected && <div className="rounded border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Name" value={selected.name} onChange={name => patch({ name })} />
        <Field label="Version" value={selected.version} onChange={version => patch({ version })} />
        <Field label="Approved by" value={selected.approved_by} onChange={approved_by => patch({ approved_by })} />
        <Field label="Approval date" value={selected.approved_date} onChange={approved_date => patch({ approved_date })} />
      </div>
      {custom && !custom.approved && <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={custom.approved} onChange={event => {
          if (!event.target.checked) return
          if (!custom.approved_by || !custom.approved_date) return
          patch({ approved: true, method_status: 'organization-defined; approved' })
        }} />
        Approve and lock this version
        {(!custom.approved_by || !custom.approved_date) &&
          <span className="text-amber-600">(approver and date required)</span>}
      </label>}
      {selected.approved && <div className="mt-3 flex items-center gap-1 text-xs text-emerald-700">
        <ShieldCheck size={13} /> Approved version; create a new version to change guidance.
      </div>}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {Object.entries(selected.rating_axes).map(([axis, criteria]) =>
          <div key={axis} className="rounded border border-slate-200">
            <div className="border-b bg-slate-50 px-3 py-2 text-xs font-semibold capitalize">{axis}</div>
            <div className="divide-y">{criteria.map(criterion =>
              <div key={criterion.rating} className="grid grid-cols-[24px_90px_1fr] gap-1 p-1.5">
                <span className="pt-1 text-center text-xs font-bold text-slate-600">{criterion.rating}</span>
                <input value={criterion.label} disabled={!custom || custom.approved}
                  onChange={event => patch({ rating_axes: {
                    ...selected.rating_axes,
                    [axis]: criteria.map(item => item.rating === criterion.rating
                      ? { ...item, label: event.target.value } : item),
                  } })} className="rounded border border-slate-200 px-1 text-[10px] disabled:bg-slate-50" />
                <textarea value={criterion.description} disabled={!custom || custom.approved}
                  onChange={event => patch({ rating_axes: {
                    ...selected.rating_axes,
                    [axis]: criteria.map(item => item.rating === criterion.rating
                      ? { ...item, description: event.target.value } : item),
                  } })} className="min-h-12 resize-y rounded border border-slate-200 px-1 text-[10px] disabled:bg-slate-50" />
              </div>)}</div>
          </div>)}
      </div>
    </div>}
  </div>
}

function ImportMapping({
  state,
  kind,
  onMapping,
  onCancel,
  onImport,
  onImportWorkbook,
}: {
  state: {
    headers: string[]
    rows: Record<string, string>[]
    mapping: ColumnMapping
    sheets?: FmeaWorkbookSheets
  }
  kind: FMEAKind
  onMapping: (mapping: ColumnMapping) => void
  onCancel: () => void
  onImport: () => void
  onImportWorkbook: () => void
}) {
  const functionSheets = recognizedFunctionWorkbookSheets(state.sheets)
  if (functionSheets.length) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-6">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold">Import Function Analysis workbook</h3>
            <p className="text-[11px] text-slate-500">
              A Perdura multi-sheet workbook was recognized.
            </p>
          </div>
          <FileSpreadsheet className="text-blue-600" size={20} />
        </div>
        <div className="space-y-3 p-5 text-xs text-slate-600">
          <p>
            The listed sections will replace their matching sections in the
            current FMEA. Sections absent from the workbook, including failure
            chains, are preserved.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {functionSheets.map(name => <div key={name}
              className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="font-medium text-slate-700">{name}</span>
              <span className="tabular-nums text-slate-500">
                {state.sheets?.[name]?.length ?? 0} row(s)
              </span>
            </div>)}
          </div>
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
            Review IDs and cross-references after import. Invalid or missing
            references will be identified by the next analysis run.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button onClick={onCancel}
            className="rounded border px-3 py-1.5 text-xs">Cancel</button>
          <button onClick={onImportWorkbook}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
            Replace listed sections
          </button>
        </div>
      </div>
    </div>
  }
  const visible = IMPORT_FIELDS.filter(field =>
    kind === 'fmea_msr'
      ? !['occurrence', 'detection', 'occurrence_rationale', 'detection_rationale'].includes(field)
      : !['frequency', 'monitoring', 'frequency_rationale', 'monitoring_rationale'].includes(field))
  const required = kind === 'fmea_msr'
    ? ['effect', 'failure_mode', 'cause', 'severity', 'frequency', 'monitoring']
    : ['effect', 'failure_mode', 'cause', 'severity', 'occurrence', 'detection']
  const missing = required.filter(field => !state.mapping[field as keyof ColumnMapping])
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-6">
    <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
      <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-3">
        <div><h3 className="text-sm font-semibold">Map FMEA worksheet columns</h3>
          <p className="text-[11px] text-slate-500">{state.rows.length} data row(s) found. Confirm the proposed mapping.</p></div>
        <FileSpreadsheet className="text-blue-600" size={20} />
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(field => <label key={field} className="text-[11px] font-medium text-slate-600">
          {field.replace(/_/g, ' ')}{required.includes(field) ? ' *' : ''}
          <select value={state.mapping[field] ?? ''} onChange={event =>
            onMapping({ ...state.mapping, [field]: event.target.value || undefined })}
            className={`mt-1 ${fieldClass}`}>
            <option value="">Not mapped</option>
            {state.headers.map(header => <option key={header} value={header}>{header}</option>)}
          </select>
        </label>)}
      </div>
      {missing.length > 0 && <div className="mx-5 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
        Map required fields: {missing.join(', ').replace(/_/g, ' ')}.
      </div>}
      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t bg-white px-5 py-3">
        <button onClick={onCancel} className="rounded border px-3 py-1.5 text-xs">Cancel</button>
        <button onClick={onImport} disabled={missing.length > 0}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-slate-300">
          Import failure chains
        </button>
      </div>
    </div>
  </div>
}

function StepHeading({
  number,
  title,
  text,
}: {
  number?: number
  title: string
  text: string
}) {
  return <div>
    <div className="flex items-center gap-2">
      {number && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{number}</span>}
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
    </div>
    <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-500">{text}</p>
  </div>
}

function Metric({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number
  tone?: 'slate'|'red'|'amber'
}) {
  const colors = tone === 'red' ? 'border-red-200 bg-red-50 text-red-700'
    : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-slate-200 bg-white text-slate-700'
  return <div className={`rounded border p-3 ${colors}`}>
    <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
    <div className="mt-1 text-xl font-semibold">{value}</div>
  </div>
}
