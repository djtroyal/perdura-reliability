import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, ChevronDown,
  ChevronRight, ClipboardList, Clock3, Copy, Download, FileUp, GitBranch,
  HelpCircle, Link2, LoaderCircle, MoreHorizontal, Plus, Play, Search, Sparkles,
  Square, Trash2, Users, Wrench,
} from 'lucide-react'
import Plot from '../shared/ExportablePlot'
import ExportResultsButton from '../shared/ExportResultsButton'
import { Card, TabBar } from '../shared/ui'
import { btnCls, inputCls, labelCls } from '../shared/styles'
import { detail, fmtNum } from '../ALT/toolkit'
import {
  analyzeMaintenanceTasksStream,
  type MTAAnalysisResponse,
  type MTAFrequency,
  type MTAPersonnelRole,
  type MTAPortfolio,
  type MTAPredictionRateSource,
  type MTAResource,
  type MTAResourceKind,
  type MTATask,
  type MTATaskStep,
  type PredictionPart,
  type PredictionResponse,
} from '../../api/client'
import { useModuleFolios, useModuleState } from '../../store/project'
import { downloadArtifact } from '../../store/artifactExport'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'

type WorkspaceView =
  | 'inventory' | 'definition' | 'resources' | 'portfolio' | 'results'

export interface MaintenanceTaskAnalysisState {
  version: 1
  view: WorkspaceView
  tasks: MTATask[]
  personnel: MTAPersonnelRole[]
  resources: MTAResource[]
  activeTaskId: string
  portfolio: MTAPortfolio
  result: MTAAnalysisResponse | null
}

interface RCMSourceState {
  rows?: {
    rcm?: Record<string, string | boolean>[]
  }
}

interface PredictionMTAState {
  parts: PredictionPart[]
  blocks?: {
    id: string
    name: string
    parentId?: string | null
  }[]
  result?: PredictionResponse | null
}

interface PredictionTaskCandidate {
  key: string
  recordId: string
  parentRecordId: string | null
  hierarchyDepth: number
  source: MTAPredictionRateSource
  dutyCycle: number
  eligible: boolean
  reason: string
}

const EMPTY_FREQUENCY: MTAFrequency = {
  model: 'manual_per_period',
  occurrences_per_period: 1,
  period_hours: 8760,
  interval: 0,
  interval_unit: 'hours',
  annual_operating_hours: 0,
  first_due_hours: null,
  rate_per_hour: 0,
  population: 1,
  duty_cycle: 1,
  distribution: 'weibull',
  scale_hours: 0,
  shape: 0,
  event_times_hours: [],
  tolerance_before_hours: 0,
  tolerance_after_hours: 0,
  prediction_source: null,
  prediction_rate_override_enabled: false,
}

const EMPTY_PORTFOLIO: MTAPortfolio = {
  horizon_hours: 8760,
  slot_hours: 0.25,
  start_weekday: 0,
  allow_overtime: false,
  simulation_enabled: true,
  n_simulations: 2000,
  confidence: 0.95,
  seed: 42,
  asset_population: 0,
  default_downtime_cost_per_hour: 0,
  max_generated_jobs: 100000,
}

export const INITIAL_MTA_STATE: MaintenanceTaskAnalysisState = {
  version: 1,
  view: 'inventory',
  tasks: [],
  personnel: [],
  resources: [],
  activeTaskId: '',
  portfolio: EMPTY_PORTFOLIO,
  result: null,
}

const PHASES = [
  'prepare', 'access', 'isolate', 'inspect', 'diagnose', 'remove', 'repair',
  'replace', 'install', 'adjust', 'test', 'restore', 'close_out', 'operate',
  'transport', 'package', 'train', 'dispose', 'other',
]

const TASK_TYPES = [
  'corrective', 'preventive', 'condition_based', 'inspection', 'servicing',
  'operations', 'transport', 'packaging', 'training', 'logistics', 'disposal',
  'other',
]

const RESOURCE_KINDS: MTAResourceKind[] = [
  'tool', 'test_equipment', 'facility', 'support_equipment', 'spare',
  'repair_part', 'consumable', 'material', 'ppe', 'transport', 'training',
]

const GOVERNANCE = ['draft', 'reviewed', 'approved', 'demonstrated', 'superseded']
const LEVELS = [
  'organizational', 'intermediate', 'depot', 'supplier', 'field', 'shop',
  'unspecified',
]
const CRITICALITIES = [
  'safety', 'regulatory', 'mission', 'operational', 'support', 'routine',
]
const WEEKDAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday', 'Sunday',
]

const FIELD_HELP: Record<string, string> = {
  Revision: 'Controlled revision of this task definition. Increment it when an approved procedure changes.',
  'Task type': 'Classifies why the work occurs, such as corrective, preventive, inspection, or condition-directed maintenance.',
  'Maintenance level': 'Organizational level expected to perform the task; this supports staffing, facility, and support planning.',
  Criticality: 'Operational consequence priority used when the scheduler must choose among simultaneously ready tasks.',
  'Governance status': 'Maturity of the task definition and its supporting review or demonstration evidence.',
  'Frequency model': 'Defines how task occurrences enter the horizon. Choose the model that matches the maintenance basis.',
  'Annual operating hours': 'Expected annual exposure used to convert a usage interval into calendar occurrences.',
  'Asset population': 'Number of statistically exposed assets represented by this frequency model.',
  'Duty cycle': 'Fraction of calendar time contributing operating exposure; enter a value from 0 to 1.',
  'Priority adjustment': 'Scheduling tie-breaker within criticality. Larger integers receive earlier consideration.',
  'Affected asset count': 'Number of assets simultaneously unavailable while this task is performed.',
  'Fixed cost ($/event)': 'Direct event cost not already represented by labor, material, resource-use, travel, or downtime fields.',
  'Travel cost ($/event)': 'Travel or mobilization cost incurred for each generated task event.',
  'Downtime cost ($/hour)': 'Economic consequence applied during task downtime; it does not change the physical schedule.',
  'Step ID': 'Stable identifier used by predecessor relationships and exported audit records.',
  'Predecessor steps': 'Steps that must finish before this step may begin. Selections that would create a dependency cycle are disabled.',
  Phase: 'Procedural stage represented by this step, used to make task sequences easier to review.',
  'Action verb': 'Concise action performed, such as isolate, inspect, replace, or test.',
  Object: 'Item or condition on which the action is performed.',
  Qualifiers: 'Method, standard, limit, location, or constraint needed to make the step unambiguous.',
  'Execution probability': 'Probability that this step executes for each task event. Use 1 for an unconditional step.',
  'Exclusive branch group': 'Steps in the same nonblank group are mutually exclusive; their probabilities must total no more than 1.',
  Count: 'Number of people in this role required concurrently while the step is active.',
  Engage: 'Fraction of the step duration during which assigned personnel are actively engaged.',
  Quantity: 'Concurrent quantity of this equipment, tool, spare, or material required by the step.',
  'Available headcount': 'Maximum normally available people in this role during its working calendar.',
  'Loaded hourly rate ($/engaged hour)': 'Labor cost per engaged hour, including any burden represented in task cost.',
  'Off-shift overtime capacity': 'Additional qualified headcount available outside normal shifts when overtime is allowed.',
  'Overtime rate multiplier': 'Multiplier applied to loaded labor cost when off-shift capacity is used.',
  'Resource kind': 'Determines whether the item is scheduled as reusable capacity or consumed from inventory.',
  'Available capacity': 'Concurrent units of a renewable resource available during its working calendar.',
  'Unit / replacement cost ($/unit)': 'Cost incurred for each consumed or replaced unit.',
  'Use cost ($/resource-hour)': 'Operating or rental cost for each resource-unit hour reserved by a step.',
  'Quantity on hand': 'Inventory available to satisfy generated maintenance work in the planning horizon.',
  'Replenishment lead (hours)': 'Delay before consumed inventory is restored.',
  'Planning horizon (hours)': 'Calendar span over which task occurrences are generated and scheduled.',
  'Scheduling increment (hours)': 'Resolution of the scheduling grid. Smaller values improve timing precision but increase computation.',
  'Default downtime cost ($/hour)': 'Fallback economic consequence for tasks without their own downtime rate.',
  'Monte Carlo replications': 'Independent sampled schedules used to estimate uncertainty intervals.',
  'Confidence level': 'Central interval coverage reported from the ensemble; 0.95 means 95%.',
  'Random seed': 'Makes uncertainty samples and the representative schedule reproducible.',
  'Uncertainty distribution': 'Beta-PERT concentrates more probability near the most-likely estimate; triangular retains linear density to the endpoints.',
  'Horizon starts on': 'Weekday represented by hour zero; recurring resource calendars are aligned to this day.',
  Day: 'Weekday on which this recurring resource shift is available.',
  'Asset out of service during task': 'When enabled, elapsed task time contributes to asset downtime and availability loss.',
  'May pause across shift gaps': 'Allows an incomplete step to stop when capacity becomes unavailable and resume in a later working window.',
  'Run Monte Carlo uncertainty ensemble': 'Samples uncertain durations and conditional branches repeatedly instead of reporting only one seeded schedule.',
  'Permit configured off-shift overtime capacity': 'Allows the scheduler to reserve overtime headcount outside normal working calendars.',
  Start: 'Hour of day when this recurring availability window begins.',
  End: 'Hour of day when this recurring availability window ends.',
  Capacity: 'Capacity available during this shift or outage interval.',
}

const SECTION_HELP: Record<string, string> = {
  'Task identity and governance': 'Controlled identity, applicability, maturity, and review basis of the maintenance task.',
  'Occurrence and support assumptions': 'How often the task occurs and the operational and cost consequences of each occurrence.',
  'Support environment and validation evidence': 'Access, tooling, safety, training, and evidence that the task is executable and effective.',
  'Identity, qualification, and cost': 'A reusable resource-pool definition referenced by task steps.',
  'Working calendar and planned outages': 'Recurring availability plus explicit reduced-capacity or unavailable periods.',
  'Scheduling policy and disclosed assumptions': 'Deterministic rules used to release, prioritize, and reserve work.',
}

function MtaLabel({
  children, tip,
}: {
  children: React.ReactNode
  tip?: string
}) {
  return (
    <span className={`${labelCls} inline-flex items-center gap-1`} title={tip}>
      <span>{children}</span>
      {tip && (
        <HelpCircle size={11} tabIndex={0} aria-label={tip}
          className="flex-shrink-0 cursor-help text-slate-300 hover:text-blue-500 focus:text-blue-500" />
      )}
    </span>
  )
}

const pretty = (value: string) => value.replace(/_/g, ' ')
  .replace(/\b\w/g, (letter: string) => letter.toUpperCase())
const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const finite = (value: string | number, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function durationMean(step: MTATaskStep) {
  const estimate = step.duration
  if (estimate.mode === 'fixed') return estimate.fixed_hours
  return estimate.distribution === 'triangular'
    ? (estimate.optimistic_hours + estimate.most_likely_hours
      + estimate.pessimistic_hours) / 3
    : (estimate.optimistic_hours + 4 * estimate.most_likely_hours
      + estimate.pessimistic_hours) / 6
}

function stepDependsOn(
  stepId: string,
  possibleAncestorId: string,
  steps: MTATaskStep[],
) {
  const byId = new Map(steps.map(step => [step.id, step]))
  const pending = [...(byId.get(stepId)?.predecessor_step_ids ?? [])]
  const visited = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === possibleAncestorId) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(byId.get(current)?.predecessor_step_ids ?? []))
  }
  return false
}

const finiteRate = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function predictionRate(
  value: {
    service_rate_available?: boolean
    service_failure_rate_fpmh?: number | null
    total_failure_rate?: number | null
    effective_operating_fraction?: number
  } | undefined,
) {
  if (value?.service_rate_available
      && finiteRate(value.service_failure_rate_fpmh)) {
    return {
      rate: value.service_failure_rate_fpmh!,
      basis: 'service_calendar' as const,
      dutyCycle: 1,
    }
  }
  return {
    rate: finiteRate(value?.total_failure_rate)
      ? value!.total_failure_rate! : null,
    basis: 'operating' as const,
    dutyCycle: Math.min(
      1, Math.max(0, value?.effective_operating_fraction ?? 1)),
  }
}

export function predictionCandidates(
  folio: { id: string; name: string; state: PredictionMTAState } | undefined,
): PredictionTaskCandidate[] {
  if (!folio) return []
  const state = folio.state
  const result = state.result
  const standard = result?.standard ?? ''
  const candidates: PredictionTaskCandidate[] = []
  for (const [index, part] of (state.parts ?? []).entries()) {
    const row = result?.results?.[index]
    const resolved = predictionRate(row)
    const identity = part.id || `row-${index + 1}`
    const entityId = `part:${identity}`
    const refdes = (part.reference_designators ?? []).join(', ')
    const partIdentity = part.part_number?.trim()
      || part.name?.trim()
      || part.description?.trim()
      || part.category.replace(/_/g, ' ')
    const label = refdes && partIdentity
      ? `${refdes} — ${partIdentity}` : refdes || partIdentity
    const disabled = part.calculation_enabled === false
      || row?.excluded || row?.incompatible
    const parentId = part.parentId ?? part.parent_id ?? null
    candidates.push({
      key: `${folio.id}:${entityId}`,
      recordId: entityId,
      parentRecordId: parentId ? `block:${parentId}` : null,
      hierarchyDepth: 0,
      source: {
        analysis_id: folio.id,
        analysis_name: folio.name,
        entity_type: 'part',
        entity_id: entityId,
        label: label || `Part ${index + 1}`,
        rate_fpmh: resolved.rate ?? 0,
        rate_basis: resolved.basis,
        represented_quantity: Math.max(1, part.quantity || 1),
        standard,
        linked_at: '',
      },
      dutyCycle: resolved.dutyCycle,
      eligible: resolved.rate !== null && !disabled,
      reason: disabled
        ? row?.error || part.calculation_exclusion_reason
          || 'This part is excluded or not computable.'
        : resolved.rate === null
          ? 'Run Failure Rate Prediction to calculate this part.'
          : '',
    })
  }
  const blockInputs = new Map(
    (state.blocks ?? []).map(block => [block.id, block]))
  const blockResults = new Map(
    (result?.blocks ?? []).map(block => [block.id, block]))
  const blockIds = new Set([
    ...blockInputs.keys(),
    ...blockResults.keys(),
  ])
  for (const blockId of blockIds) {
    const block = blockResults.get(blockId)
    const resolved = predictionRate(block)
    const label = block?.name || blockInputs.get(blockId)?.name || blockId
    const entityId = `block:${blockId}`
    const parentId = blockInputs.get(blockId)?.parentId ?? null
    candidates.push({
      key: `${folio.id}:${entityId}`,
      recordId: entityId,
      parentRecordId: parentId ? `block:${parentId}` : null,
      hierarchyDepth: 0,
      source: {
        analysis_id: folio.id,
        analysis_name: folio.name,
        entity_type: 'block',
        entity_id: entityId,
        label,
        rate_fpmh: resolved.rate ?? 0,
        rate_basis: resolved.basis,
        represented_quantity: Math.max(1, block?.quantity ?? 1),
        standard,
        linked_at: '',
      },
      dutyCycle: resolved.dutyCycle,
      eligible: resolved.rate !== null,
      reason: resolved.rate === null
        ? 'Run Failure Rate Prediction to calculate this system block.' : '',
    })
  }
  if (result) {
    const resolved = predictionRate({
      service_rate_available: result.service_rate_available,
      service_failure_rate_fpmh: result.service_failure_rate_fpmh,
      total_failure_rate: result.total_failure_rate,
    })
    candidates.push({
      key: `${folio.id}:system:system`,
      recordId: 'system:system',
      parentRecordId: null,
      hierarchyDepth: 0,
      source: {
        analysis_id: folio.id,
        analysis_name: folio.name,
        entity_type: 'system',
        entity_id: 'system:system',
        label: `${folio.name} — system total`,
        rate_fpmh: resolved.rate ?? 0,
        rate_basis: resolved.basis,
        represented_quantity: 1,
        standard,
        linked_at: '',
      },
      dutyCycle: resolved.dutyCycle,
      eligible: resolved.rate !== null,
      reason: resolved.rate === null
        ? 'The Failure Rate Prediction system total is unavailable.' : '',
    })
  }

  // Preserve the Parts List hierarchy: system blocks precede their direct
  // piece parts, and each block's descendants remain nested beneath it.
  const byRecordId = new Map(
    candidates.map(candidate => [candidate.recordId, candidate]))
  const ordered: PredictionTaskCandidate[] = []
  const visited = new Set<string>()
  const system = byRecordId.get('system:system')
  if (system) {
    ordered.push(system)
    visited.add(system.recordId)
  }
  const validBlockIds = new Set(blockIds)
  const effectiveParent = (parentId: string | null | undefined) =>
    parentId && validBlockIds.has(parentId) ? parentId : null
  const blocks = [
    ...(state.blocks ?? []),
    ...[...blockIds]
      .filter(blockId => !(state.blocks ?? []).some(block => block.id === blockId))
      .map(blockId => ({
        id: blockId,
        name: blockResults.get(blockId)?.name ?? blockId,
        parentId: null,
      })),
  ]
  const walk = (parentId: string | null, depth: number) => {
    for (const block of blocks.filter(item =>
      effectiveParent(item.parentId) === parentId)) {
      const candidate = byRecordId.get(`block:${block.id}`)
      if (!candidate || visited.has(candidate.recordId)) continue
      candidate.hierarchyDepth = depth
      candidate.parentRecordId = parentId ? `block:${parentId}` : null
      ordered.push(candidate)
      visited.add(candidate.recordId)
      walk(block.id, depth + 1)
    }
    for (const [index, part] of (state.parts ?? []).entries()) {
      if (effectiveParent(part.parentId ?? part.parent_id) !== parentId) continue
      const identity = part.id || `row-${index + 1}`
      const candidate = byRecordId.get(`part:${identity}`)
      if (!candidate || visited.has(candidate.recordId)) continue
      candidate.hierarchyDepth = depth
      candidate.parentRecordId = parentId ? `block:${parentId}` : null
      ordered.push(candidate)
      visited.add(candidate.recordId)
    }
  }
  walk(null, 0)
  for (const candidate of candidates) {
    if (!visited.has(candidate.recordId)) ordered.push(candidate)
  }
  return ordered
}

const newStep = (number: number): MTATaskStep => ({
  id: `S${number}`,
  label: `Step ${number}`,
  description: '',
  action_verb: '',
  object: '',
  qualifiers: '',
  phase: 'other',
  predecessor_step_ids: number > 1 ? [`S${number - 1}`] : [],
  duration: {
    mode: 'fixed',
    fixed_hours: 1,
    distribution: 'pert',
    optimistic_hours: 0.5,
    most_likely_hours: 1,
    pessimistic_hours: 2,
  },
  execution_probability: 1,
  branch_group: '',
  interruptible: true,
  personnel: [],
  resources: [],
  safety_precautions: '',
  technical_data: '',
  acceptance_criteria: '',
})

const newTask = (number: number): MTATask => ({
  id: `MTA-${String(number).padStart(3, '0')}`,
  title: `Support task ${number}`,
  description: '',
  task_type: 'corrective',
  maintenance_level: 'unspecified',
  status: 'draft',
  revision: 'A',
  source_refs: [],
  linked_rcm_row_ids: [],
  criticality: 'routine',
  priority: 0,
  frequency: { ...EMPTY_FREQUENCY },
  steps: [newStep(1)],
  takes_asset_out_of_service: true,
  affected_asset_count: 1,
  fixed_cost: 0,
  travel_cost: 0,
  downtime_cost_per_hour: 0,
  hazards: '',
  environment: '',
  training_requirements: '',
  validation_records: [],
  approval_rationale: '',
})

const EXAMPLE_STATE: MaintenanceTaskAnalysisState = {
  ...INITIAL_MTA_STATE,
  view: 'definition',
  activeTaskId: 'MTA-001',
  personnel: [{
    id: 'maint-tech',
    name: 'Maintenance technician',
    skill: 'Mechanical and electrical maintenance',
    available_headcount: 2,
    hourly_rate: 95,
    overtime_capacity: 1,
    overtime_rate_multiplier: 1.5,
    weekly_shifts: [0, 1, 2, 3, 4].map(weekday => ({
      weekday, start_hour: 7, end_hour: 15, capacity: 2,
    })),
    planned_outages: [],
  }],
  resources: [{
    id: 'portable-test-set',
    name: 'Portable diagnostic test set',
    kind: 'test_equipment',
    capacity: 1,
    unit_cost: 0,
    use_cost_per_hour: 18,
    quantity_on_hand: null,
    replenishment_lead_time_hours: 0,
    weekly_shifts: [],
    planned_outages: [],
  }, {
    id: 'pump-kit',
    name: 'Coolant pump replacement kit',
    kind: 'spare',
    capacity: 0,
    unit_cost: 650,
    use_cost_per_hour: 0,
    quantity_on_hand: 3,
    replenishment_lead_time_hours: 168,
    weekly_shifts: [],
    planned_outages: [],
  }],
  tasks: [{
    ...newTask(1),
    title: 'Replace failed coolant pump',
    status: 'approved',
    maintenance_level: 'field',
    criticality: 'mission',
    frequency: {
      ...EMPTY_FREQUENCY,
      model: 'poisson_rate',
      rate_per_hour: 0.00012,
      population: 20,
    },
    downtime_cost_per_hour: 250,
    hazards: 'Isolate electrical power and relieve coolant-system pressure.',
    training_requirements: 'Qualified mechanical maintainer.',
    steps: [{
      ...newStep(1),
      label: 'Prepare and isolate equipment',
      action_verb: 'isolate',
      object: 'coolant subsystem',
      phase: 'isolate',
      duration: { ...newStep(1).duration, fixed_hours: 0.5 },
      personnel: [{ role_id: 'maint-tech', headcount: 1, engagement_fraction: 1 }],
    }, {
      ...newStep(2),
      label: 'Diagnose pump failure',
      action_verb: 'diagnose',
      object: 'coolant pump',
      phase: 'diagnose',
      duration: {
        mode: 'uncertain', fixed_hours: 1, distribution: 'pert',
        optimistic_hours: 0.5, most_likely_hours: 1, pessimistic_hours: 3,
      },
      personnel: [{ role_id: 'maint-tech', headcount: 1, engagement_fraction: 1 }],
      resources: [{ resource_id: 'portable-test-set', quantity: 1 }],
    }, {
      ...newStep(3),
      label: 'Replace failed pump',
      action_verb: 'replace',
      object: 'coolant pump',
      phase: 'replace',
      duration: {
        mode: 'uncertain', fixed_hours: 2, distribution: 'pert',
        optimistic_hours: 1.5, most_likely_hours: 2, pessimistic_hours: 4,
      },
      personnel: [{ role_id: 'maint-tech', headcount: 2, engagement_fraction: 1 }],
      resources: [{ resource_id: 'pump-kit', quantity: 1 }],
    }, {
      ...newStep(4),
      label: 'Test and restore equipment',
      action_verb: 'verify',
      object: 'coolant-system operation',
      phase: 'test',
      duration: { ...newStep(4).duration, fixed_hours: 0.75 },
      personnel: [{ role_id: 'maint-tech', headcount: 1, engagement_fraction: 1 }],
      resources: [{ resource_id: 'portable-test-set', quantity: 1 }],
      acceptance_criteria: 'No leakage; flow and pressure within technical limits.',
    }],
  }],
  portfolio: {
    ...EMPTY_PORTFOLIO,
    horizon_hours: 2160,
    slot_hours: 0.25,
    n_simulations: 500,
    asset_population: 20,
  },
}

function Section({
  title, children, initialOpen = true, tip,
}: {
  title: string
  children: React.ReactNode
  initialOpen?: boolean
  tip?: string
}) {
  const [open, setOpen] = useState(initialOpen)
  const help = tip ?? SECTION_HELP[title]
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-gray-700 transition hover:bg-slate-50"
      >
        <span className={`rounded-md p-1 transition ${
          open ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
        }`}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span>{title}</span>
        {help && (
          <span title={help} tabIndex={0} aria-label={help}
            onClick={event => event.stopPropagation()}
            className="cursor-help text-slate-300 hover:text-blue-500 focus:text-blue-500">
            <HelpCircle size={11} />
          </span>
        )}
      </button>
      {open && <div className="border-t border-gray-100 p-4">{children}</div>}
    </section>
  )
}

function Field({
  label, value, onChange, type = 'text', min, max, step, title,
  disabled = false, prefix,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  type?: 'text' | 'number' | 'date'
  min?: number
  max?: number
  step?: number
  title?: string
  disabled?: boolean
  prefix?: string
}) {
  const help = title ?? FIELD_HELP[label]
  return (
    <label className="block">
      <MtaLabel tip={help}>{label}</MtaLabel>
      <span className="relative block">
        {prefix && (
          <span aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs font-medium text-slate-500">
            {prefix}
          </span>
        )}
        <input
          type={type}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          className={`${inputCls} ${prefix ? 'pl-6' : ''} disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500`}
        />
      </span>
    </label>
  )
}

function SelectField({
  label, value, onChange, options, tip,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  tip?: string
}) {
  const help = tip ?? FIELD_HELP[label]
  return (
    <label className="block">
      <MtaLabel tip={help}>{label}</MtaLabel>
      <select
        className={inputCls}
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => (
          <option key={option} value={option}>{pretty(option)}</option>
        ))}
      </select>
    </label>
  )
}

function Toggle({
  label, checked, onChange, tip,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  tip?: string
}) {
  const help = tip ?? FIELD_HELP[label]
  return (
    <label className="flex items-center gap-2 text-xs text-gray-700" title={help}>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="rounded border-gray-300 text-blue-600"
      />
      <span>{label}</span>
      {help && (
        <HelpCircle size={11} tabIndex={0} aria-label={help}
          className="cursor-help text-slate-300 hover:text-blue-500 focus:text-blue-500" />
      )}
    </label>
  )
}

export default function TaskAnalysis({
  onNavigatePrediction,
}: {
  onNavigatePrediction?: (target: {
    analysisId: string
    entityId: string
  }) => void
}) {
  const [raw, setState] = useModuleState<MaintenanceTaskAnalysisState>(
    'maintTaskAnalysis', INITIAL_MTA_STATE,
  )
  const state: MaintenanceTaskAnalysisState = {
    ...INITIAL_MTA_STATE,
    ...raw,
    portfolio: { ...EMPTY_PORTFOLIO, ...(raw.portfolio ?? {}) },
    tasks: raw.tasks ?? [],
    personnel: raw.personnel ?? [],
    resources: raw.resources ?? [],
  }
  const rcmFolios = useModuleFolios<RCMSourceState>('reliabilityProgram')
  const predictionFolios = useModuleFolios<PredictionMTAState>('prediction')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expandedStep, setExpandedStep] = useState<string>('')
  const [taskQuery, setTaskQuery] = useState('')
  const [taskStatusFilter, setTaskStatusFilter] = useState('all')
  const [resourceCatalogView, setResourceCatalogView] = useState<
    'personnel' | 'resources'>('personnel')
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [predictionImportOpen, setPredictionImportOpen] = useState(false)
  const [predictionFolioId, setPredictionFolioId] = useState('')
  const [predictionSelection, setPredictionSelection] = useState<string[]>([])
  const [predictionLinkFilter, setPredictionLinkFilter] = useState<
    'all' | 'unlinked' | 'linked'>('unlinked')
  const [showCostBreakdown, setShowCostBreakdown] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const bookmarkTarget = useBookmarkNavigationTarget()
  const appliedBookmark = useRef(0)
  const activePredictionFolio = predictionFolios.find(
    folio => folio.id === predictionFolioId) ?? predictionFolios[0]
  const predictionItems = useMemo(
    () => predictionCandidates(activePredictionFolio),
    [activePredictionFolio],
  )
  const linkedPredictionRecords = useMemo(() => new Set(
    state.tasks.flatMap(task => task.source_refs
      .filter(ref => ref.module === 'prediction')
      .map(ref => `${ref.analysis_id ?? ''}:${ref.record_id}`)),
  ), [state.tasks])
  const predictionItemIsLinked = (item: PredictionTaskCandidate) =>
    linkedPredictionRecords.has(
      `${item.source.analysis_id}:${item.recordId}`)
  const filteredPredictionItems = predictionItems.filter(item =>
    predictionLinkFilter === 'all'
      || predictionItemIsLinked(item) === (predictionLinkFilter === 'linked'))
  const filteredPredictionRecordIds = new Set(
    filteredPredictionItems.map(item => item.recordId))
  const predictionItemsByRecordId = new Map(
    predictionItems.map(item => [item.recordId, item]))
  const hierarchyContextRecordIds = new Set<string>()
  for (const item of filteredPredictionItems) {
    let parentId = item.parentRecordId
    const visited = new Set<string>()
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      if (!filteredPredictionRecordIds.has(parentId)) {
        hierarchyContextRecordIds.add(parentId)
      }
      parentId = predictionItemsByRecordId.get(parentId)?.parentRecordId ?? null
    }
  }
  const displayedPredictionItems = predictionItems.filter(item =>
    filteredPredictionRecordIds.has(item.recordId)
      || hierarchyContextRecordIds.has(item.recordId))

  const activeTask = state.tasks.find(task => task.id === state.activeTaskId)
    ?? state.tasks[0]
  const queriedTasks = state.tasks.filter(task => {
    const query = taskQuery.trim().toLowerCase()
    return !query || [
      task.id, task.title, task.task_type, task.maintenance_level,
      ...task.source_refs.map(source => source.label ?? source.record_id ?? ''),
    ].some(value => String(value).toLowerCase().includes(query))
  })
  const visibleTasks = queriedTasks.filter(task =>
    taskStatusFilter === 'all' || task.status === taskStatusFilter)
  const activeTaskMeanStepHours = activeTask
    ? activeTask.steps.reduce(
      (sum, step) => sum + durationMean(step) * step.execution_probability, 0)
    : 0
  const activeTaskReadinessChecks = activeTask ? [
    Boolean(activeTask.title.trim()),
    activeTask.steps.length > 0,
    activeTask.steps.every(step => step.label.trim()),
    activeTask.steps.every(step => step.duration.mode === 'fixed'
      ? step.duration.fixed_hours >= 0
      : step.duration.optimistic_hours <= step.duration.most_likely_hours
        && step.duration.most_likely_hours
          <= step.duration.pessimistic_hours),
    activeTask.steps.every(step => step.personnel.every(assignment =>
      state.personnel.some(role => role.id === assignment.role_id))),
    activeTask.steps.every(step => step.resources.every(assignment =>
      state.resources.some(resource => resource.id === assignment.resource_id))),
    Boolean(activeTask.approval_rationale?.trim()),
    activeTask.validation_records.some(record => record.outcome === 'passed'),
  ] : []
  const activeTaskReadiness = activeTaskReadinessChecks.length
    ? Math.round(100 * activeTaskReadinessChecks.filter(Boolean).length
      / activeTaskReadinessChecks.length)
    : 0
  const selectedRole = state.personnel.find(
    role => role.id === selectedRoleId) ?? state.personnel[0]
  const selectedResource = state.resources.find(
    resource => resource.id === selectedResourceId) ?? state.resources[0]
  const patchWorkspace = (
    patch: Partial<MaintenanceTaskAnalysisState>,
    invalidate = false,
  ) => setState(previous => ({
    ...INITIAL_MTA_STATE,
    ...previous,
    ...patch,
    result: invalidate ? null : (patch.result === undefined
      ? previous.result ?? null : patch.result),
  }))
  useEffect(() => {
    if (!bookmarkTarget || bookmarkTarget.nonce === appliedBookmark.current) return
    if (!['maintTaskAnalysis', 'maintenance'].includes(
      bookmarkTarget.source.module)) return
    if (bookmarkTarget.source.view !== 'results') return
    appliedBookmark.current = bookmarkTarget.nonce
    patchWorkspace({ view: 'results' })
  // patchWorkspace intentionally follows the current persisted workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkTarget])
  useEffect(() => {
    const closeMenus = (except?: Node | null) => {
      toolbarRef.current?.querySelectorAll<HTMLDetailsElement>(
        'details[data-dropdown-menu][open]',
      ).forEach(menu => {
        if (!except || !menu.contains(except)) menu.open = false
      })
    }
    const onPointerDown = (event: PointerEvent) => closeMenus(event.target as Node)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])
  const setModel = (patch: Partial<MaintenanceTaskAnalysisState>) => {
    setError(null)
    setNotice(null)
    patchWorkspace(patch, true)
  }
  const updateTask = (taskId: string, patch: Partial<MTATask>) => {
    setModel({
      tasks: state.tasks.map(task =>
        task.id === taskId ? { ...task, ...patch } : task),
    })
  }
  const renameTask = (taskId: string, nextId: string) => {
    setModel({
      tasks: state.tasks.map(task =>
        task.id === taskId ? { ...task, id: nextId } : task),
      activeTaskId: state.activeTaskId === taskId
        ? nextId : state.activeTaskId,
    })
  }
  const updateStep = (
    taskId: string,
    stepId: string,
    patch: Partial<MTATaskStep>,
  ) => {
    const task = state.tasks.find(item => item.id === taskId)
    if (!task) return
    updateTask(taskId, {
      steps: task.steps.map(step =>
        step.id === stepId ? { ...step, ...patch } : step),
    })
  }
  const renameStep = (taskId: string, stepId: string, nextId: string) => {
    const task = state.tasks.find(item => item.id === taskId)
    if (!task) return
    updateTask(taskId, {
      steps: task.steps.map(step => ({
        ...step,
        id: step.id === stepId ? nextId : step.id,
        predecessor_step_ids: step.predecessor_step_ids.map(predecessor =>
          predecessor === stepId ? nextId : predecessor),
      })),
    })
    setExpandedStep(nextId)
  }
  const addTask = () => {
    let number = state.tasks.length + 1
    while (state.tasks.some(task =>
      task.id === `MTA-${String(number).padStart(3, '0')}`)) number += 1
    const task = newTask(number)
    setModel({
      tasks: [...state.tasks, task],
      activeTaskId: task.id,
      view: 'definition',
    })
  }
  const deleteTask = (taskId: string) => {
    const task = state.tasks.find(item => item.id === taskId)
    if (!task || !window.confirm(`Delete “${task.title}” and all of its steps?`)) return
    const tasks = state.tasks.filter(item => item.id !== taskId)
    setModel({
      tasks,
      activeTaskId: tasks[0]?.id ?? '',
    })
  }
  const addStep = (task: MTATask) => {
    let number = task.steps.length + 1
    while (task.steps.some(step => step.id === `S${number}`)) number += 1
    const step = newStep(number)
    updateTask(task.id, { steps: [...task.steps, step] })
    setExpandedStep(step.id)
  }
  const moveStep = (task: MTATask, index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= task.steps.length) return
    const steps = [...task.steps]
    ;[steps[index], steps[target]] = [steps[target], steps[index]]
    updateTask(task.id, { steps })
  }
  const duplicateStep = (task: MTATask, step: MTATaskStep, index: number) => {
    let suffix = 2
    let stepId = `${step.id}-${suffix}`
    while (task.steps.some(item => item.id === stepId)) {
      suffix += 1
      stepId = `${step.id}-${suffix}`
    }
    const duplicate: MTATaskStep = {
      ...step,
      id: stepId,
      label: `${step.label} (copy)`,
      predecessor_step_ids: [...step.predecessor_step_ids],
      duration: { ...step.duration },
      personnel: step.personnel.map(item => ({ ...item })),
      resources: step.resources.map(item => ({ ...item })),
    }
    const steps = [...task.steps]
    steps.splice(index + 1, 0, duplicate)
    updateTask(task.id, { steps })
    setExpandedStep(stepId)
  }

  const run = async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setProgress({ done: 0, total: state.portfolio.n_simulations })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await analyzeMaintenanceTasksStream({
        tasks: state.tasks,
        personnel: state.personnel,
        resources: state.resources,
        portfolio: state.portfolio,
      }, setProgress, controller.signal)
      patchWorkspace({ result, view: 'results' })
    } catch (cause) {
      if (controller.signal.aborted) {
        setNotice('Analysis cancelled. The prior result, if any, was retained.')
      } else {
        setError(detail(cause, 'Maintenance task analysis failed.'))
      }
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  const openPredictionImport = () => {
    const preferred = predictionFolios.find(
      folio => predictionCandidates(folio).some(item => item.eligible),
    ) ?? predictionFolios[0]
    setPredictionFolioId(preferred?.id ?? '')
    setPredictionSelection([])
    setPredictionLinkFilter('unlinked')
    setPredictionImportOpen(true)
  }

  const pullPredictionTasks = () => {
    const selected = predictionItems.filter(item =>
      item.eligible && predictionSelection.includes(item.key))
    if (!selected.length) return
    const linkedAt = new Date().toISOString()
    const tasks = [...state.tasks]
    const usedIds = new Set(tasks.map(task => task.id))
    let nextNumber = tasks.length + 1
    let created = 0
    let refreshed = 0
    for (const candidate of selected) {
      const source = { ...candidate.source, linked_at: linkedAt }
      const existingIndex = tasks.findIndex(task => task.source_refs.some(ref =>
        ref.module === 'prediction'
        && ref.analysis_id === source.analysis_id
        && ref.record_id === candidate.recordId))
      const sourceRef = {
        module: 'prediction',
        analysis_id: source.analysis_id,
        record_id: candidate.recordId,
        revision: source.standard,
        label: `${source.analysis_name} — ${source.label}`,
      }
      if (existingIndex >= 0) {
        const task = tasks[existingIndex]
        const override = Boolean(
          task.frequency.prediction_rate_override_enabled)
        tasks[existingIndex] = {
          ...task,
          source_refs: [
            ...task.source_refs.filter(ref => !(
              ref.module === 'prediction'
              && ref.analysis_id === source.analysis_id
              && ref.record_id === candidate.recordId
            )),
            sourceRef,
          ],
          frequency: {
            ...task.frequency,
            model: 'poisson_rate',
            rate_per_hour: override
              ? task.frequency.rate_per_hour : source.rate_fpmh / 1_000_000,
            population: 1,
            duty_cycle: override
              ? task.frequency.duty_cycle
              : source.rate_basis === 'service_calendar'
                ? 1 : candidate.dutyCycle,
            prediction_source: source,
          },
        }
        refreshed += 1
        continue
      }
      while (usedIds.has(
        `MTA-${String(nextNumber).padStart(3, '0')}`)) nextNumber += 1
      const task = newTask(nextNumber)
      usedIds.add(task.id)
      nextNumber += 1
      tasks.push({
        ...task,
        title: `Corrective maintenance — ${source.label}`,
        description: (
          `Failure-driven task published from ${source.analysis_name}. `
          + `Rate snapshot: ${source.rate_fpmh.toPrecision(6)} FPMH `
          + `(${source.rate_basis.replace('_', ' ')} basis); represents `
          + `${source.represented_quantity} item(s).`
        ),
        task_type: 'corrective',
        criticality: 'operational',
        source_refs: [sourceRef],
        frequency: {
          ...EMPTY_FREQUENCY,
          model: 'poisson_rate',
          rate_per_hour: source.rate_fpmh / 1_000_000,
          population: 1,
          duty_cycle: source.rate_basis === 'service_calendar'
            ? 1 : candidate.dutyCycle,
          prediction_source: source,
          prediction_rate_override_enabled: false,
        },
        steps: [{
          ...newStep(1),
          label: `Diagnose and restore ${source.label}`,
          action_verb: 'restore',
          object: source.label,
          phase: 'diagnose',
        }],
      })
      created += 1
    }
    setModel({
      tasks,
      activeTaskId: tasks[tasks.length - created]?.id
        ?? tasks.find(task => task.source_refs.some(ref =>
          ref.module === 'prediction'
          && ref.analysis_id === selected[0].source.analysis_id
          && ref.record_id === selected[0].recordId))?.id
        ?? state.activeTaskId,
      view: 'definition',
    })
    setPredictionImportOpen(false)
    setPredictionSelection([])
    setNotice([
      created ? `created ${created} draft task${created === 1 ? '' : 's'}` : '',
      refreshed ? `refreshed ${refreshed} linked rate${refreshed === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ').replace(/^./, value => value.toUpperCase()) + '.')
  }

  const pullRCM = () => {
    const rows = rcmFolios.flatMap(folio =>
      (folio.state?.rows?.rcm ?? []).map(row => ({ folio, row })))
      .filter(({ row }) =>
        String(row.taskType ?? 'undecided') !== 'undecided')
    const existingLinks = new Set(
      state.tasks.flatMap(task => task.linked_rcm_row_ids),
    )
    const incoming = rows.filter(({ row }) =>
      row.id && !existingLinks.has(String(row.id)))
    const usedIds = new Set(state.tasks.map(task => task.id))
    let nextNumber = state.tasks.length + 1
    const tasks = incoming.map(({ folio, row }) => {
      while (usedIds.has(
        `MTA-${String(nextNumber).padStart(3, '0')}`)) nextNumber += 1
      const task = newTask(nextNumber)
      usedIds.add(task.id)
      nextNumber += 1
      const rcmId = String(row.id)
      const taskType = String(row.taskType)
      const mappedType = taskType === 'on-condition'
        ? 'condition_based'
        : taskType.includes('scheduled') || taskType === 'failure-finding'
          ? 'preventive' : 'corrective'
      const interval = finite(String(row.interval ?? ''), 0)
      return {
        ...task,
        title: `${taskType === 'run-to-failure' ? 'Correct' : pretty(taskType)} — ${
          String(row.item || row.failureMode || rcmId)}`,
        description: [
          row.function && `Function: ${row.function}`,
          row.functionalFailure && `Functional failure: ${row.functionalFailure}`,
          row.failureMode && `Failure mode: ${row.failureMode}`,
          row.rationale && `RCM rationale: ${row.rationale}`,
        ].filter(Boolean).join('\n'),
        task_type: mappedType,
        status: String(row.status) === 'approved' || String(row.status) === 'closed'
          ? 'reviewed' as const : 'draft' as const,
        criticality: String(row.consequence) === 'safety'
          ? 'safety' : String(row.consequence) === 'operational'
            ? 'operational' : 'routine',
        linked_rcm_row_ids: [rcmId],
        source_refs: [{
          module: 'reliabilityProgram',
          analysis_id: folio.id,
          record_id: rcmId,
          label: `${folio.name} — ${String(row.failureMode || row.item || rcmId)}`,
        }],
        frequency: interval > 0 ? {
          ...EMPTY_FREQUENCY,
          model: 'calendar_interval' as const,
          interval,
          interval_unit: 'hours' as const,
        } : { ...EMPTY_FREQUENCY },
        steps: [{
          ...newStep(1),
          label: `${pretty(taskType)} ${String(row.item || row.failureMode || '')}`.trim(),
          object: String(row.item || row.failureMode || ''),
        }],
      } satisfies MTATask
    })
    if (!tasks.length) {
      setNotice(rows.length
        ? 'All eligible RCM decisions are already linked.'
        : 'No decided RCM rows are available to publish into MTA.')
      return
    }
    setModel({
      tasks: [...state.tasks, ...tasks],
      activeTaskId: tasks[0].id,
      view: 'definition',
    })
    setNotice(`Published ${tasks.length} RCM decision${tasks.length === 1 ? '' : 's'} as revision-linked draft tasks.`)
  }

  const exportJson = () => {
    void downloadArtifact(JSON.stringify({
      format: 'Perdura Maintenance Task Analysis',
      schema_version: 1,
      exported_at: new Date().toISOString(),
      data: {
        tasks: state.tasks,
        personnel: state.personnel,
        resources: state.resources,
        portfolio: state.portfolio,
      },
    }, null, 2),
    'maintenance-task-analysis.json',
    'application/json',
    {
      kind: 'maintenance-task-analysis',
      title: 'Maintenance Task Analysis',
      moduleKey: 'maintTaskAnalysis',
    })
  }

  const exportCsv = () => {
    const rows = state.tasks.flatMap(task =>
      (task.steps.length ? task.steps : [newStep(1)]).map(step => ({
        task_id: task.id,
        task_title: task.title,
        task_type: task.task_type,
        maintenance_level: task.maintenance_level,
        status: task.status,
        criticality: task.criticality,
        frequency_model: task.frequency.model,
        occurrences_per_period: task.frequency.occurrences_per_period,
        period_hours: task.frequency.period_hours,
        interval: task.frequency.interval,
        interval_unit: task.frequency.interval_unit,
        annual_operating_hours: task.frequency.annual_operating_hours,
        first_due_hours: task.frequency.first_due_hours ?? '',
        rate_per_hour: task.frequency.rate_per_hour,
        population: task.frequency.population,
        duty_cycle: task.frequency.duty_cycle,
        renewal_distribution: task.frequency.distribution,
        scale_hours: task.frequency.scale_hours,
        shape: task.frequency.shape,
        event_times_hours: task.frequency.event_times_hours.join('|'),
        tolerance_before_hours: task.frequency.tolerance_before_hours,
        tolerance_after_hours: task.frequency.tolerance_after_hours,
        prediction_analysis_id:
          task.frequency.prediction_source?.analysis_id ?? '',
        prediction_analysis_name:
          task.frequency.prediction_source?.analysis_name ?? '',
        prediction_entity_type:
          task.frequency.prediction_source?.entity_type ?? '',
        prediction_entity_id:
          task.frequency.prediction_source?.entity_id ?? '',
        prediction_label:
          task.frequency.prediction_source?.label ?? '',
        prediction_rate_fpmh:
          task.frequency.prediction_source?.rate_fpmh ?? '',
        prediction_rate_basis:
          task.frequency.prediction_source?.rate_basis ?? '',
        prediction_represented_quantity:
          task.frequency.prediction_source?.represented_quantity ?? '',
        prediction_standard:
          task.frequency.prediction_source?.standard ?? '',
        prediction_linked_at:
          task.frequency.prediction_source?.linked_at ?? '',
        prediction_rate_override_enabled:
          task.frequency.prediction_rate_override_enabled ?? false,
        step_id: step.id,
        step_label: step.label,
        phase: step.phase,
        predecessors: step.predecessor_step_ids.join('|'),
        duration_mode: step.duration.mode,
        fixed_hours: step.duration.fixed_hours,
        optimistic_hours: step.duration.optimistic_hours,
        most_likely_hours: step.duration.most_likely_hours,
        pessimistic_hours: step.duration.pessimistic_hours,
        execution_probability: step.execution_probability,
      })))
    void downloadArtifact(
      Papa.unparse(rows),
      'maintenance-task-inventory.csv',
      'text/csv;charset=utf-8',
      {
        kind: 'maintenance-task-inventory',
        title: 'Maintenance Task Inventory',
        moduleKey: 'maintTaskAnalysis',
      },
    )
  }

  const importFile = async (file: File) => {
    try {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error('MTA imports are limited to 20 MB.')
      }
      const text = await file.text()
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text)
        const data = parsed.data ?? parsed
        if (!Array.isArray(data.tasks)) {
          throw new Error('The JSON file has no task inventory.')
        }
        setModel({
          tasks: data.tasks,
          personnel: Array.isArray(data.personnel) ? data.personnel : [],
          resources: Array.isArray(data.resources) ? data.resources : [],
          portfolio: { ...EMPTY_PORTFOLIO, ...(data.portfolio ?? {}) },
          activeTaskId: data.tasks[0]?.id ?? '',
        })
      } else {
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: header => header.trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        })
        if (parsed.errors.length) throw new Error(parsed.errors[0].message)
        const grouped = new Map<string, Record<string, string>[]>()
        for (const row of parsed.data) {
          const taskId = row.task_id?.trim()
          if (!taskId) continue
          grouped.set(taskId, [...(grouped.get(taskId) ?? []), row])
        }
        const tasks: MTATask[] = [...grouped.entries()].map(
          ([taskId, rows], index) => {
            const first = rows[0]
            return {
              ...newTask(index + 1),
              id: taskId,
              title: first.task_title || taskId,
              task_type: first.task_type || 'other',
              maintenance_level: first.maintenance_level || 'unspecified',
              status: (GOVERNANCE.includes(first.status)
                ? first.status : 'draft') as MTATask['status'],
              criticality: first.criticality || 'routine',
              frequency: {
                ...EMPTY_FREQUENCY,
                model: (
                  first.frequency_model || 'manual_per_period'
                ) as MTAFrequency['model'],
                occurrences_per_period: finite(
                  first.occurrences_per_period, 0),
                period_hours: finite(first.period_hours, 8760),
                interval: finite(first.interval, 0),
                interval_unit: (
                  first.interval_unit || 'hours'
                ) as MTAFrequency['interval_unit'],
                annual_operating_hours: finite(
                  first.annual_operating_hours, 0),
                first_due_hours: first.first_due_hours?.trim()
                  ? finite(first.first_due_hours) : null,
                rate_per_hour: finite(first.rate_per_hour, 0),
                population: Math.max(1, Math.round(
                  finite(first.population, 1))),
                duty_cycle: finite(first.duty_cycle, 1),
                distribution: first.renewal_distribution === 'exponential'
                  ? 'exponential' : 'weibull',
                scale_hours: finite(first.scale_hours, 0),
                shape: finite(first.shape, 0),
                event_times_hours: (first.event_times_hours || '')
                  .split('|').map(value => finite(value, Number.NaN))
                  .filter(Number.isFinite),
                tolerance_before_hours: finite(
                  first.tolerance_before_hours, 0),
                tolerance_after_hours: finite(
                  first.tolerance_after_hours, 0),
                prediction_source: first.prediction_analysis_id?.trim()
                  ? {
                    analysis_id: first.prediction_analysis_id,
                    analysis_name: first.prediction_analysis_name || '',
                    entity_type: (
                      ['part', 'block', 'system'].includes(
                        first.prediction_entity_type)
                        ? first.prediction_entity_type : 'part'
                    ) as MTAPredictionRateSource['entity_type'],
                    entity_id: first.prediction_entity_id || 'part:unknown',
                    label: first.prediction_label
                      || first.task_title || taskId,
                    rate_fpmh: finite(first.prediction_rate_fpmh, 0),
                    rate_basis: first.prediction_rate_basis
                      === 'service_calendar'
                      ? 'service_calendar' : 'operating',
                    represented_quantity: Math.max(
                      finite(first.prediction_represented_quantity, 1), 1),
                    standard: first.prediction_standard || '',
                    linked_at: first.prediction_linked_at || '',
                  } : null,
                prediction_rate_override_enabled:
                  first.prediction_rate_override_enabled === 'true',
              },
              steps: rows.map((row, stepIndex) => ({
                ...newStep(stepIndex + 1),
                id: row.step_id || `S${stepIndex + 1}`,
                label: row.step_label || `Step ${stepIndex + 1}`,
                phase: row.phase || 'other',
                predecessor_step_ids: (row.predecessors || '')
                  .split('|').map(value => value.trim()).filter(Boolean),
                execution_probability: finite(
                  row.execution_probability, 1),
                duration: {
                  ...newStep(1).duration,
                  mode: row.duration_mode === 'uncertain'
                    ? 'uncertain' : 'fixed',
                  fixed_hours: finite(row.fixed_hours, 0),
                  optimistic_hours: finite(row.optimistic_hours, 0),
                  most_likely_hours: finite(row.most_likely_hours, 0),
                  pessimistic_hours: finite(row.pessimistic_hours, 0),
                },
              })),
            }
          },
        )
        setModel({ tasks, activeTaskId: tasks[0]?.id ?? '' })
      }
      setNotice(`Imported ${file.name}. Review task logic and resource mappings before approval.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const toolbar = (
    <div ref={toolbarRef}
      className="relative z-30 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
      <button type="button" onClick={addTask}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
        <Plus size={13} /> New task
      </button>
      <details data-dropdown-menu className="group relative">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
          <Link2 size={13} /> Add from source
          <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <div
          onClick={event => {
            if ((event.target as HTMLElement).closest('button')) {
              event.currentTarget.closest('details')!.open = false
            }
          }}
          className="absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white p-1.5 shadow-xl">
          <button type="button" onClick={pullRCM}
            className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-blue-50">
            <GitBranch size={15} className="mt-0.5 text-blue-600" />
            <span>
              <span className="block text-xs font-medium text-gray-800">
                Reliability Program RCM
              </span>
              <span className="block text-[10px] leading-relaxed text-gray-500">
                Publish decided maintenance policies as draft tasks.
              </span>
            </span>
          </button>
          <button type="button" onClick={openPredictionImport}
            className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-blue-50">
            <Clock3 size={15} className="mt-0.5 text-blue-600" />
            <span>
              <span className="block text-xs font-medium text-gray-800">
                Failure Rate Prediction
              </span>
              <span className="block text-[10px] leading-relaxed text-gray-500">
                Create or refresh failure-driven part and block tasks.
              </span>
            </span>
          </button>
        </div>
      </details>
      <button type="button" onClick={() => setState(EXAMPLE_STATE)}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
        <Sparkles size={13} className="text-amber-500" /> Worked example
      </button>
      <div className="ml-auto">
        <input ref={importRef} type="file"
          accept=".json,.csv,application/json,text/csv" className="hidden"
          onChange={event => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
          }} />
        <details data-dropdown-menu className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
            <MoreHorizontal size={14} /> Exchange
            <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
          </summary>
          <div
            onClick={event => {
              if ((event.target as HTMLElement).closest('button')) {
                event.currentTarget.closest('details')!.open = false
              }
            }}
            className="absolute right-0 top-full z-40 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1.5 shadow-xl">
            <button type="button" onClick={() => importRef.current?.click()}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <FileUp size={13} /> Import JSON or CSV
            </button>
            <button type="button" onClick={exportJson}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <Download size={13} /> Export JSON
            </button>
            <button type="button" onClick={exportCsv}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <Download size={13} /> Export CSV
            </button>
          </div>
        </details>
      </div>
    </div>
  )

  const inventoryView = (
    <div className="flex-1 overflow-auto p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Task portfolio</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Govern source-linked support work from definition through demonstrated execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative block">
            <Search size={13}
              className="pointer-events-none absolute left-2.5 top-2.5 text-gray-400" />
            <input value={taskQuery}
              onChange={event => setTaskQuery(event.target.value)}
              placeholder="Search tasks or sources…"
              className={`${inputCls} w-64 pl-8`} />
          </label>
          <select value={taskStatusFilter}
            onChange={event => setTaskStatusFilter(event.target.value)}
            className={`${inputCls} w-36`}>
            <option value="all">All statuses</option>
            {GOVERNANCE.map(status => (
              <option key={status} value={status}>{pretty(status)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Tasks" value={String(state.tasks.length)} accent />
        <Card
          label="Approved / demonstrated"
          value={String(state.tasks.filter(task =>
            ['approved', 'demonstrated'].includes(task.status)).length)}
          tone="success"
        />
        <Card
          label="Task steps"
          value={String(state.tasks.reduce(
            (sum, task) => sum + task.steps.length, 0))}
        />
        <Card
          label="Source-linked"
          value={String(state.tasks.filter(task =>
            task.source_refs.length > 0).length)}
          tone="info"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              {['ID', 'Task', 'Type', 'Level', 'Status', 'Frequency', 'Steps', 'Source', ''].map(label => (
                <th key={label} className="px-3 py-2 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map(task => (
              <tr
                key={task.id}
                className="cursor-pointer border-t border-gray-100 hover:bg-blue-50/50"
                onClick={() => patchWorkspace({
                  activeTaskId: task.id,
                  view: 'definition',
                })}
              >
                <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{task.id}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{task.title}</td>
                <td className="px-3 py-2">{pretty(task.task_type)}</td>
                <td className="px-3 py-2">{pretty(task.maintenance_level)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    ['approved', 'demonstrated'].includes(task.status)
                      ? 'bg-emerald-100 text-emerald-800'
                      : task.status === 'reviewed'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}>
                    {pretty(task.status)}
                  </span>
                </td>
                <td className="px-3 py-2">{pretty(task.frequency.model)}</td>
                <td className="px-3 py-2 text-center">{task.steps.length}</td>
                <td className="px-3 py-2">
                  {task.source_refs.length
                    ? `${task.source_refs.length} linked` : 'Manual'}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    aria-label={`Delete ${task.title}`}
                    onClick={event => {
                      event.stopPropagation()
                      deleteTask(task.id)
                    }}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!visibleTasks.length && (
              <tr>
                <td colSpan={9} className="px-6 py-14 text-center text-gray-400">
                  {state.tasks.length
                    ? 'No tasks match the current search and status filter.'
                    : 'Create a task, add one from a source, import an inventory, or load the worked example.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )

  const definitionView = activeTask ? (
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-slate-50 p-3">
        <div className="sticky top-0 z-10 -mx-1 mb-2 bg-slate-50 px-1 pb-2">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Task inventory
          </p>
          <label className="relative block">
            <Search size={12}
              className="pointer-events-none absolute left-2.5 top-2.5 text-gray-400" />
            <input value={taskQuery}
              onChange={event => setTaskQuery(event.target.value)}
              placeholder="Find a task…"
              className={`${inputCls} pl-8`} />
          </label>
        </div>
        <div className="space-y-1">
          {queriedTasks.map(task => (
            <button
              key={task.id}
              type="button"
              onClick={() => patchWorkspace({ activeTaskId: task.id })}
              className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                task.id === activeTask.id
                  ? 'border-blue-300 bg-white text-blue-900 shadow-sm ring-1 ring-blue-100'
                  : 'border-transparent hover:border-gray-200 hover:bg-white'
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{task.title}</span>
                  <span className="mt-0.5 block text-[10px] text-gray-500">
                    {task.id} · {task.steps.length} steps
                  </span>
                </span>
                <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${
                  ['approved', 'demonstrated'].includes(task.status)
                    ? 'bg-emerald-500' : task.status === 'reviewed'
                      ? 'bg-blue-500' : 'bg-amber-400'
                }`} title={pretty(task.status)} />
              </span>
            </button>
          ))}
          {!queriedTasks.length && (
            <p className="px-3 py-8 text-center text-[11px] text-gray-400">
              No matching tasks.
            </p>
          )}
        </div>
      </aside>
      <div className="flex-1 overflow-y-auto bg-gray-50/40 p-5">
        <div className="mx-auto w-full max-w-[96rem] space-y-4">
          <div className="sticky top-0 z-20 overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-gray-900">
                    {activeTask.title}
                  </h2>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">
                    {activeTask.id}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                    ['approved', 'demonstrated'].includes(activeTask.status)
                      ? 'bg-emerald-100 text-emerald-700'
                      : activeTask.status === 'reviewed'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-amber-100 text-amber-700'
                  }`}>
                    {pretty(activeTask.status)}
                  </span>
                  {activeTask.frequency.prediction_source && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-semibold text-violet-700">
                      <Link2 size={9} /> Prediction linked
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
                  title={`${activeTaskReadiness}% definition readiness`}>
                  <div className={`h-full rounded-full transition-all ${
                    activeTaskReadiness >= 75 ? 'bg-emerald-500'
                      : activeTaskReadiness >= 50 ? 'bg-blue-500' : 'bg-amber-400'
                  }`} style={{ width: `${activeTaskReadiness}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-3 divide-x divide-slate-200 text-center">
                <div className="px-3">
                  <span className="block text-sm font-semibold text-slate-800">
                    {activeTask.steps.length}
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-slate-400">Steps</span>
                </div>
                <div className="px-3">
                  <span className="block text-sm font-semibold text-slate-800">
                    {fmtNum(activeTaskMeanStepHours)} h
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-slate-400">Work content</span>
                </div>
                <div className="px-3">
                  <span className="block text-sm font-semibold text-slate-800">
                    {activeTaskReadiness}%
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-slate-400">Ready</span>
                </div>
              </div>
              <button type="button"
                onClick={() => patchWorkspace({ view: 'portfolio' })}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800">
                <Play size={12} /> Analyze
              </button>
            </div>
          </div>
          <Section title="Task identity and governance">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Task ID" value={activeTask.id}
                onChange={value => renameTask(activeTask.id, value)} />
              <div className="md:col-span-2">
                <Field label="Task title" value={activeTask.title}
                  onChange={value => updateTask(activeTask.id, { title: value })} />
              </div>
              <Field label="Revision" value={activeTask.revision}
                onChange={value => updateTask(activeTask.id, { revision: value })} />
              <SelectField label="Task type" value={activeTask.task_type}
                onChange={value => updateTask(activeTask.id, { task_type: value })}
                options={TASK_TYPES} />
              <SelectField label="Maintenance level" value={activeTask.maintenance_level}
                onChange={value => updateTask(activeTask.id, { maintenance_level: value })}
                options={LEVELS} />
              <SelectField label="Criticality" value={activeTask.criticality}
                onChange={value => updateTask(activeTask.id, { criticality: value })}
                options={CRITICALITIES} />
              <SelectField label="Governance status" value={activeTask.status}
                onChange={value => updateTask(activeTask.id, {
                  status: value as MTATask['status'],
                })}
                options={GOVERNANCE} />
              <div className="md:col-span-4">
                <label className={labelCls}>Description and task basis</label>
                <textarea
                  className={`${inputCls} min-h-20 resize-y`}
                  value={activeTask.description}
                  onChange={event => updateTask(activeTask.id, {
                    description: event.target.value,
                  })}
                />
              </div>
              <div className="md:col-span-4">
                <label className={labelCls}>Approval / override rationale</label>
                <textarea
                  className={`${inputCls} min-h-16 resize-y`}
                  value={activeTask.approval_rationale}
                  onChange={event => updateTask(activeTask.id, {
                    approval_rationale: event.target.value,
                  })}
                  placeholder="Record why the task is applicable, effective, and acceptable—or why an RCM recommendation was overridden."
                />
              </div>
              {activeTask.source_refs.length > 0 && (
                <div className="md:col-span-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <span className="font-semibold">Revision-linked sources: </span>
                  {activeTask.source_refs.map(source =>
                    source.label || `${source.module} / ${source.record_id}`).join('; ')}
                </div>
              )}
            </div>
          </Section>

          <Section title="Occurrence and support assumptions">
            <div className="grid gap-3 md:grid-cols-4">
              <SelectField label="Frequency model" value={activeTask.frequency.model}
                onChange={value => updateTask(activeTask.id, {
                  frequency: {
                    ...activeTask.frequency,
                    model: value as MTAFrequency['model'],
                    prediction_source: value === 'poisson_rate'
                      ? activeTask.frequency.prediction_source : null,
                    prediction_rate_override_enabled: value === 'poisson_rate'
                      ? activeTask.frequency.prediction_rate_override_enabled
                      : false,
                  },
                })}
                options={[
                  'manual_per_period', 'calendar_interval', 'usage_interval',
                  'event_list', 'poisson_rate', 'renewal',
                ]} />
              {activeTask.frequency.model === 'manual_per_period' && <>
                <Field label="Occurrences / period"
                  type="number" min={0} step={0.1}
                  value={activeTask.frequency.occurrences_per_period}
                  onChange={value => updateTask(activeTask.id, {
                    frequency: {
                      ...activeTask.frequency,
                      occurrences_per_period: finite(value),
                    },
                  })} />
                <Field label="Period (hours)"
                  type="number" min={0.001} step={1}
                  value={activeTask.frequency.period_hours}
                  onChange={value => updateTask(activeTask.id, {
                    frequency: {
                      ...activeTask.frequency,
                      period_hours: finite(value),
                    },
                  })} />
              </>}
              {['calendar_interval', 'usage_interval'].includes(
                activeTask.frequency.model) && <>
                <Field label={activeTask.frequency.model === 'usage_interval'
                  ? 'Usage interval' : 'Calendar interval'}
                  type="number" min={0} step={1}
                  value={activeTask.frequency.interval}
                  onChange={value => updateTask(activeTask.id, {
                    frequency: {
                      ...activeTask.frequency,
                      interval: finite(value),
                    },
                  })} />
                {activeTask.frequency.model === 'calendar_interval'
                  ? <SelectField label="Interval unit"
                    value={activeTask.frequency.interval_unit}
                    onChange={value => updateTask(activeTask.id, {
                      frequency: {
                        ...activeTask.frequency,
                        interval_unit: value as MTAFrequency['interval_unit'],
                      },
                    })}
                    options={['hours', 'days', 'weeks', 'months', 'years']} />
                  : <Field label="Annual operating hours"
                    type="number" min={0} step={1}
                    value={activeTask.frequency.annual_operating_hours}
                    onChange={value => updateTask(activeTask.id, {
                      frequency: {
                        ...activeTask.frequency,
                        annual_operating_hours: finite(value),
                      },
                    })} />}
              </>}
              {activeTask.frequency.model === 'poisson_rate' && (
                <Field
                  label={activeTask.frequency.prediction_source
                    ? 'Failure rate (FPMH)' : 'Rate / asset-hour'}
                  type="number"
                  min={0}
                  step={activeTask.frequency.prediction_source
                    ? 0.000001 : 0.000000001}
                  value={activeTask.frequency.prediction_source
                    ? activeTask.frequency.rate_per_hour * 1_000_000
                    : activeTask.frequency.rate_per_hour}
                  disabled={Boolean(
                    activeTask.frequency.prediction_source
                    && !activeTask.frequency.prediction_rate_override_enabled)}
                  onChange={value => updateTask(activeTask.id, {
                    frequency: {
                      ...activeTask.frequency,
                      rate_per_hour: finite(value)
                        / (activeTask.frequency.prediction_source
                          ? 1_000_000 : 1),
                    },
                  })} />
              )}
              {activeTask.frequency.model === 'renewal' && <>
                <SelectField label="Life distribution"
                  value={activeTask.frequency.distribution}
                  onChange={value => updateTask(activeTask.id, {
                    frequency: {
                      ...activeTask.frequency,
                      distribution: value as MTAFrequency['distribution'],
                    },
                  })}
                  options={['weibull', 'exponential']} />
                {activeTask.frequency.distribution === 'weibull'
                  ? <>
                    <Field label="Scale (hours)" type="number" min={0} step={1}
                      value={activeTask.frequency.scale_hours}
                      onChange={value => updateTask(activeTask.id, {
                        frequency: {
                          ...activeTask.frequency,
                          scale_hours: finite(value),
                        },
                      })} />
                    <Field label="Shape" type="number" min={0} step={0.1}
                      value={activeTask.frequency.shape}
                      onChange={value => updateTask(activeTask.id, {
                        frequency: {
                          ...activeTask.frequency,
                          shape: finite(value),
                        },
                      })} />
                  </>
                  : <Field label="Rate / hour" type="number" min={0} step={0.000001}
                    value={activeTask.frequency.rate_per_hour}
                    onChange={value => updateTask(activeTask.id, {
                      frequency: {
                        ...activeTask.frequency,
                        rate_per_hour: finite(value),
                      },
                    })} />}
              </>}
              {['poisson_rate', 'renewal'].includes(activeTask.frequency.model) && <>
                <Field label="Asset population" type="number" min={1} step={1}
                  value={activeTask.frequency.population}
                  disabled={Boolean(activeTask.frequency.prediction_source)}
                  onChange={value => updateTask(activeTask.id, {
                    frequency: {
                      ...activeTask.frequency,
                      population: Math.max(1, Math.round(finite(value, 1))),
                    },
                  })} />
                <Field label="Duty cycle" type="number" min={0} max={1} step={0.01}
                  value={activeTask.frequency.duty_cycle}
                  disabled={Boolean(
                    activeTask.frequency.prediction_source?.rate_basis
                      === 'service_calendar'
                    && !activeTask.frequency.prediction_rate_override_enabled)}
                  onChange={value => updateTask(activeTask.id, {
                    frequency: {
                      ...activeTask.frequency,
                      duty_cycle: finite(value, 1),
                    },
                  })} />
              </>}
              {activeTask.frequency.model === 'poisson_rate'
                  && activeTask.frequency.prediction_source && (
                <div className="md:col-span-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        Linked Failure Rate Prediction
                      </p>
                      <p className="mt-0.5">
                        {activeTask.frequency.prediction_source.label} ·{' '}
                        {fmtNum(activeTask.frequency.prediction_source.rate_fpmh)} FPMH ·{' '}
                        {pretty(activeTask.frequency.prediction_source.rate_basis)}
                      </p>
                      <p className="mt-1 text-[10px] text-blue-700">
                        Snapshot from {activeTask.frequency.prediction_source.analysis_name}
                        {activeTask.frequency.prediction_source.standard
                          ? ` · ${activeTask.frequency.prediction_source.standard}` : ''}
                        . Use Pull Failure Rate Prediction to refresh it.
                      </p>
                    </div>
                    {onNavigatePrediction && (
                      <button type="button"
                        onClick={() => onNavigatePrediction({
                          analysisId: activeTask.frequency.prediction_source!.analysis_id,
                          entityId: activeTask.frequency.prediction_source!.entity_id,
                        })}
                        className="rounded border border-blue-300 bg-white px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100">
                        Open source
                      </button>
                    )}
                  </div>
                  <div className="mt-2 border-t border-blue-200 pt-2">
                    <Toggle
                      label="Override the linked failure-rate snapshot"
                      checked={Boolean(
                        activeTask.frequency.prediction_rate_override_enabled)}
                      onChange={value => updateTask(activeTask.id, {
                        frequency: {
                          ...activeTask.frequency,
                          prediction_rate_override_enabled: value,
                          rate_per_hour: value
                            ? activeTask.frequency.rate_per_hour
                            : activeTask.frequency.prediction_source!.rate_fpmh
                              / 1_000_000,
                          duty_cycle: value
                            ? activeTask.frequency.duty_cycle
                            : activeTask.frequency.prediction_source!.rate_basis
                                === 'service_calendar' ? 1
                              : activeTask.frequency.duty_cycle,
                        },
                      })}
                    />
                  </div>
                </div>
              )}
              <Field label="Priority adjustment" type="number" step={1}
                value={activeTask.priority}
                onChange={value => updateTask(activeTask.id, {
                  priority: Math.round(finite(value)),
                })} />
              <Field label="Affected asset count" type="number" min={0.001} step={1}
                value={activeTask.affected_asset_count}
                onChange={value => updateTask(activeTask.id, {
                  affected_asset_count: finite(value, 1),
                })} />
              <Field label="Fixed cost ($/event)" type="number" min={0} step={1}
                prefix="$"
                value={activeTask.fixed_cost}
                onChange={value => updateTask(activeTask.id, {
                  fixed_cost: finite(value),
                })} />
              <Field label="Travel cost ($/event)" type="number" min={0} step={1}
                prefix="$"
                value={activeTask.travel_cost}
                onChange={value => updateTask(activeTask.id, {
                  travel_cost: finite(value),
                })} />
              <Field label="Downtime cost ($/hour)" type="number" min={0} step={1}
                prefix="$"
                value={activeTask.downtime_cost_per_hour}
                onChange={value => updateTask(activeTask.id, {
                  downtime_cost_per_hour: finite(value),
                })} />
              <div className="flex items-end pb-2">
                <Toggle label="Asset out of service during task"
                  checked={activeTask.takes_asset_out_of_service}
                  onChange={value => updateTask(activeTask.id, {
                    takes_asset_out_of_service: value,
                  })} />
              </div>
            </div>
          </Section>

          <Section title={`Conditional task flow · ${activeTask.steps.length} steps`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-700">Procedure map</p>
                <p className="text-[10px] text-gray-500">
                  Cards follow authoring order; predecessor badges define execution order.
                </p>
              </div>
              <button type="button" onClick={() => addStep(activeTask)}
                className={btnCls}><Plus size={13} /> Add step</button>
            </div>
            {activeTask.steps.length > 0 && (
              <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex min-w-max items-stretch gap-2">
                  {activeTask.steps.map((step, index) => (
                    <div key={step.id} className="flex items-center gap-2">
                      {index > 0 && <ArrowRight size={14} className="text-slate-300" />}
                      <button type="button"
                        onClick={() => setExpandedStep(step.id)}
                        className={`w-44 rounded-lg border bg-white p-2.5 text-left shadow-sm transition hover:border-blue-300 ${
                          expandedStep === step.id
                            ? 'border-blue-400 ring-2 ring-blue-100'
                            : 'border-slate-200'
                        }`}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[9px] font-semibold text-blue-600">
                            {step.id}
                          </span>
                          <span className="text-[9px] text-slate-400">
                            {fmtNum(durationMean(step))} h
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-[11px] font-medium text-slate-800">
                          {step.label}
                        </span>
                        <span className="mt-1 block truncate text-[9px] text-slate-400">
                          {step.predecessor_step_ids.length
                            ? `After ${step.predecessor_step_ids.join(', ')}`
                            : 'Root step'}
                          {step.execution_probability < 1
                            ? ` · ${(100 * step.execution_probability).toFixed(0)}%` : ''}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {activeTask.steps.map((step, index) => {
                const open = expandedStep === step.id
                const missingPredecessor = step.predecessor_step_ids.some(
                  predecessor => !activeTask.steps.some(
                    item => item.id === predecessor))
                const invalidDuration = step.duration.mode === 'uncertain'
                  && !(step.duration.optimistic_hours
                    <= step.duration.most_likely_hours
                    && step.duration.most_likely_hours
                      <= step.duration.pessimistic_hours)
                return (
                  <div key={step.id} className={`overflow-hidden rounded-lg border bg-gray-50/60 ${
                    missingPredecessor || invalidDuration
                      ? 'border-amber-300' : open
                        ? 'border-blue-300 shadow-sm' : 'border-gray-200'
                  }`}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => setExpandedStep(open ? '' : step.id)}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                          {step.id}
                        </span>
                        <span className="truncate text-xs font-medium text-gray-800">
                          {step.label}
                        </span>
                        <span className="ml-auto text-[10px] text-gray-500">
                          {pretty(step.phase)} · {
                            step.duration.mode === 'fixed'
                              ? `${step.duration.fixed_hours} h`
                              : `${step.duration.optimistic_hours} / ${step.duration.most_likely_hours} / ${step.duration.pessimistic_hours} h`
                          }
                        </span>
                      </button>
                      {step.execution_probability < 1 && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-medium text-violet-700">
                          {(100 * step.execution_probability).toFixed(0)}%
                        </span>
                      )}
                      {(step.personnel.length > 0 || step.resources.length > 0) && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-600">
                          {step.personnel.length} role · {step.resources.length} resource
                        </span>
                      )}
                      <button type="button" title="Move step up"
                        disabled={index === 0}
                        onClick={() => moveStep(activeTask, index, -1)}
                        className="rounded p-1 text-gray-400 hover:bg-white hover:text-blue-600 disabled:opacity-20">
                        <ArrowUp size={13} />
                      </button>
                      <button type="button" title="Move step down"
                        disabled={index === activeTask.steps.length - 1}
                        onClick={() => moveStep(activeTask, index, 1)}
                        className="rounded p-1 text-gray-400 hover:bg-white hover:text-blue-600 disabled:opacity-20">
                        <ArrowDown size={13} />
                      </button>
                      <button type="button" title="Duplicate step"
                        onClick={() => duplicateStep(activeTask, step, index)}
                        className="rounded p-1 text-gray-400 hover:bg-white hover:text-blue-600">
                        <Copy size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTask(activeTask.id, {
                          steps: activeTask.steps.filter(item => item.id !== step.id)
                            .map(item => ({
                              ...item,
                              predecessor_step_ids: item.predecessor_step_ids
                                .filter(value => value !== step.id),
                            })),
                        })}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${step.label}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {open && (
                      <div className="border-t border-gray-200 bg-white p-4">
                        <div className="grid gap-3 md:grid-cols-4">
                          <Field label="Step ID" value={step.id}
                            onChange={value => renameStep(
                              activeTask.id, step.id, value,
                            )} />
                          <div className="md:col-span-2">
                            <Field label="Step label" value={step.label}
                              onChange={value => updateStep(activeTask.id, step.id, {
                                label: value,
                              })} />
                          </div>
                          <SelectField label="Phase" value={step.phase}
                            onChange={value => updateStep(activeTask.id, step.id, {
                              phase: value,
                            })}
                            options={PHASES} />
                          <Field label="Action verb" value={step.action_verb ?? ''}
                            onChange={value => updateStep(activeTask.id, step.id, {
                              action_verb: value,
                            })} />
                          <Field label="Object" value={step.object ?? ''}
                            onChange={value => updateStep(activeTask.id, step.id, {
                              object: value,
                            })} />
                          <Field label="Qualifiers" value={step.qualifiers ?? ''}
                            onChange={value => updateStep(activeTask.id, step.id, {
                              qualifiers: value,
                            })} />
                          <label className="md:col-span-2">
                            <MtaLabel tip={FIELD_HELP['Predecessor steps']}>
                              Predecessor steps
                            </MtaLabel>
                            <span className="flex min-h-9 max-h-28 flex-wrap gap-1 overflow-y-auto rounded-md border border-gray-300 bg-white p-1.5">
                              {activeTask.steps
                                .filter(item => item.id !== step.id)
                                .map(candidate => {
                                  const selected = step.predecessor_step_ids
                                    .includes(candidate.id)
                                  const createsCycle = !selected
                                    && stepDependsOn(
                                      candidate.id, step.id, activeTask.steps)
                                  return (
                                    <button key={candidate.id} type="button"
                                      disabled={createsCycle}
                                      title={createsCycle
                                        ? `${candidate.label} already depends on ${step.id}`
                                        : candidate.label}
                                      onClick={() => updateStep(
                                        activeTask.id, step.id, {
                                          predecessor_step_ids: selected
                                            ? step.predecessor_step_ids.filter(
                                              value => value !== candidate.id)
                                            : [...step.predecessor_step_ids,
                                              candidate.id],
                                        })}
                                      className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                                        selected
                                          ? 'border-blue-300 bg-blue-100 font-medium text-blue-800'
                                          : createsCycle
                                            ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300'
                                            : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-200'
                                      }`}>
                                      {candidate.id}
                                    </button>
                                  )
                                })}
                              {activeTask.steps.length === 1 && (
                                <span className="px-1 py-0.5 text-[10px] text-gray-400">
                                  Root step · add another step to define dependencies
                                </span>
                              )}
                            </span>
                          </label>
                          <div className="md:col-span-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold text-slate-800">
                                  Step duration
                                </p>
                                <p className="mt-0.5 text-[10px] text-slate-500">
                                  Use a range when execution time varies meaningfully.
                                </p>
                              </div>
                              <div className="grid grid-cols-2 rounded-lg bg-slate-200/70 p-1">
                                {([
                                  ['fixed', 'Fixed duration'],
                                  ['uncertain', 'Uncertain duration'],
                                ] as const).map(([mode, label]) => (
                                  <button key={mode} type="button"
                                    onClick={() => updateStep(
                                      activeTask.id, step.id, {
                                        duration: { ...step.duration, mode },
                                      })}
                                    className={`rounded-md px-3 py-1.5 text-[10px] font-semibold transition ${
                                      step.duration.mode === mode
                                        ? 'bg-white text-blue-700 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                    }`}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {step.duration.mode === 'fixed'
                              ? <div className="mt-3 max-w-xs rounded-md border border-slate-200 bg-white p-3">
                                <Field label="Duration" type="number" min={0}
                                  step={0.01} value={step.duration.fixed_hours}
                                  onChange={value => updateStep(
                                    activeTask.id, step.id, {
                                      duration: {
                                        ...step.duration,
                                        fixed_hours: finite(value),
                                      },
                                    })} />
                                <p className="mt-1 text-[9px] text-slate-400">Hours</p>
                              </div>
                              : <div className="mt-3 space-y-3">
                                <div className="grid gap-2 lg:grid-cols-[1.15fr_repeat(3,minmax(0,1fr))]">
                                  <div className="rounded-md border border-slate-200 bg-white p-3">
                                    <label className="block">
                                    <MtaLabel tip={FIELD_HELP['Uncertainty distribution']}>
                                      Uncertainty distribution
                                    </MtaLabel>
                                    <select className={inputCls}
                                      value={step.duration.distribution}
                                      onChange={event => updateStep(
                                        activeTask.id, step.id, {
                                          duration: {
                                            ...step.duration,
                                            distribution: event.target.value as
                                              ('pert' | 'triangular'),
                                          },
                                        })}>
                                      <option value="pert">Beta-PERT</option>
                                      <option value="triangular">Triangular</option>
                                    </select>
                                    </label>
                                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                                      {step.duration.distribution === 'pert'
                                        ? 'Weights the most-likely estimate and softens the range endpoints.'
                                        : 'Uses straight-line density between the three estimates.'}
                                    </p>
                                  </div>
                                  {([
                                    [
                                      'Minimum',
                                      'Optimistic estimate',
                                      'optimistic_hours',
                                      'border-sky-300',
                                    ],
                                    [
                                      'Typical',
                                      'Most-likely estimate',
                                      'most_likely_hours',
                                      'border-blue-500',
                                    ],
                                    [
                                      'Maximum',
                                      'Pessimistic estimate',
                                      'pessimistic_hours',
                                      'border-amber-400',
                                    ],
                                  ] as const).map(([cue, label, key, border]) => (
                                    <div key={key}
                                      className={`rounded-md border border-slate-200 border-t-2 ${border} bg-white p-3`}>
                                      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                                        {cue}
                                      </p>
                                      <Field label={label} type="number" min={0}
                                        step={0.01} value={step.duration[key]}
                                        onChange={value => updateStep(
                                          activeTask.id, step.id, {
                                            duration: {
                                              ...step.duration,
                                              [key]: finite(value),
                                            },
                                          })} />
                                      <p className="mt-1 text-[9px] text-slate-400">
                                        Hours
                                      </p>
                                    </div>
                                  ))}
                                </div>
                                <div className={`flex items-center justify-between rounded-md px-3 py-2 text-[10px] ${
                                  invalidDuration
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-emerald-50 text-emerald-800'
                                }`}>
                                  <span>{invalidDuration
                                    ? 'Enter estimates in minimum ≤ most likely ≤ maximum order.'
                                    : 'Estimate order is valid.'}</span>
                                  <span className="font-semibold">
                                    Expected duration: {fmtNum(durationMean(step))} h
                                  </span>
                                </div>
                              </div>}
                          </div>
                          <Field label="Execution probability" type="number" min={0} max={1} step={0.01}
                            value={step.execution_probability}
                            onChange={value => updateStep(activeTask.id, step.id, {
                              execution_probability: finite(value, 1),
                            })} />
                          <Field
                            label="Exclusive branch group"
                            title="Steps in the same nonblank group are mutually exclusive. Their probabilities must sum to no more than 1."
                            value={step.branch_group ?? ''}
                            onChange={value => updateStep(activeTask.id, step.id, {
                              branch_group: value,
                            })}
                          />
                          <div className="flex items-end pb-2">
                            <Toggle label="May pause across shift gaps"
                              checked={step.interruptible}
                              onChange={value => updateStep(activeTask.id, step.id, {
                                interruptible: value,
                              })} />
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <div className="rounded-md border border-gray-200 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="flex items-center gap-1 text-xs font-semibold text-gray-700">
                                <Users size={13} /> Personnel
                              </p>
                              <button
                                type="button"
                                disabled={!state.personnel.length}
                                onClick={() => updateStep(activeTask.id, step.id, {
                                  personnel: [...step.personnel, {
                                    role_id: state.personnel[0].id,
                                    headcount: 1,
                                    engagement_fraction: 1,
                                  }],
                                })}
                                className="text-[10px] text-blue-600 disabled:text-gray-300"
                              >
                                + assignment
                              </button>
                            </div>
                            <div className="space-y-2">
                              {step.personnel.map((assignment, assignmentIndex) => (
                                <div key={`${assignment.role_id}-${assignmentIndex}`}
                                  className="grid grid-cols-[1fr_5rem_5rem_1.5rem] items-end gap-2">
                                  <label>
                                    <span className={labelCls}>Role</span>
                                    <select
                                      className={inputCls}
                                      value={assignment.role_id}
                                      onChange={event => updateStep(activeTask.id, step.id, {
                                        personnel: step.personnel.map((item, i) =>
                                          i === assignmentIndex
                                            ? { ...item, role_id: event.target.value }
                                            : item),
                                      })}
                                    >
                                      {state.personnel.map(role =>
                                        <option key={role.id} value={role.id}>{role.name}</option>)}
                                    </select>
                                  </label>
                                  <Field label="Count" type="number" min={0.01} step={1}
                                    value={assignment.headcount}
                                    onChange={value => updateStep(activeTask.id, step.id, {
                                      personnel: step.personnel.map((item, i) =>
                                        i === assignmentIndex
                                          ? { ...item, headcount: finite(value, 1) }
                                          : item),
                                    })} />
                                  <Field label="Engage" type="number" min={0.01} max={1} step={0.05}
                                    value={assignment.engagement_fraction}
                                    onChange={value => updateStep(activeTask.id, step.id, {
                                      personnel: step.personnel.map((item, i) =>
                                        i === assignmentIndex
                                          ? { ...item, engagement_fraction: finite(value, 1) }
                                          : item),
                                    })} />
                                  <button type="button"
                                    onClick={() => updateStep(activeTask.id, step.id, {
                                      personnel: step.personnel.filter(
                                        (_, i) => i !== assignmentIndex),
                                    })}
                                    className="mb-1 rounded p-1 text-gray-400 hover:text-red-600">
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ))}
                              {!step.personnel.length &&
                                <p className="text-[10px] text-gray-400">No personnel assigned.</p>}
                            </div>
                          </div>

                          <div className="rounded-md border border-gray-200 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="flex items-center gap-1 text-xs font-semibold text-gray-700">
                                <Wrench size={13} /> Resources and material
                              </p>
                              <button
                                type="button"
                                disabled={!state.resources.length}
                                onClick={() => updateStep(activeTask.id, step.id, {
                                  resources: [...step.resources, {
                                    resource_id: state.resources[0].id,
                                    quantity: 1,
                                  }],
                                })}
                                className="text-[10px] text-blue-600 disabled:text-gray-300"
                              >
                                + assignment
                              </button>
                            </div>
                            <div className="space-y-2">
                              {step.resources.map((assignment, assignmentIndex) => (
                                <div key={`${assignment.resource_id}-${assignmentIndex}`}
                                  className="grid grid-cols-[1fr_6rem_1.5rem] items-end gap-2">
                                  <label>
                                    <span className={labelCls}>Resource</span>
                                    <select
                                      className={inputCls}
                                      value={assignment.resource_id}
                                      onChange={event => updateStep(activeTask.id, step.id, {
                                        resources: step.resources.map((item, i) =>
                                          i === assignmentIndex
                                            ? { ...item, resource_id: event.target.value }
                                            : item),
                                      })}
                                    >
                                      {state.resources.map(resource =>
                                        <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                                    </select>
                                  </label>
                                  <Field label="Quantity" type="number" min={0.01} step={1}
                                    value={assignment.quantity}
                                    onChange={value => updateStep(activeTask.id, step.id, {
                                      resources: step.resources.map((item, i) =>
                                        i === assignmentIndex
                                          ? { ...item, quantity: finite(value, 1) }
                                          : item),
                                    })} />
                                  <button type="button"
                                    onClick={() => updateStep(activeTask.id, step.id, {
                                      resources: step.resources.filter(
                                        (_, i) => i !== assignmentIndex),
                                    })}
                                    className="mb-1 rounded p-1 text-gray-400 hover:text-red-600">
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ))}
                              {!step.resources.length &&
                                <p className="text-[10px] text-gray-400">No resources assigned.</p>}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          {([
                            ['Safety precautions', 'safety_precautions'],
                            ['Technical data', 'technical_data'],
                            ['Acceptance criteria', 'acceptance_criteria'],
                          ] as const).map(([label, key]) => (
                            <label key={key}>
                              <span className={labelCls}>{label}</span>
                              <textarea
                                className={`${inputCls} min-h-16 resize-y`}
                                value={step[key] ?? ''}
                                onChange={event => updateStep(activeTask.id, step.id, {
                                  [key]: event.target.value,
                                })}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>

          <Section title="Support environment and validation evidence" initialOpen={false}>
            <div className="grid gap-3 md:grid-cols-3">
              {([
                ['Hazards and precautions', 'hazards'],
                ['Environmental constraints', 'environment'],
                ['Training requirements', 'training_requirements'],
              ] as const).map(([label, key]) => (
                <label key={key}>
                  <span className={labelCls}>{label}</span>
                  <textarea className={`${inputCls} min-h-24 resize-y`}
                    value={activeTask[key] ?? ''}
                    onChange={event => updateTask(activeTask.id, {
                      [key]: event.target.value,
                    })} />
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">Validation records</p>
              <button type="button" className={btnCls}
                onClick={() => updateTask(activeTask.id, {
                  validation_records: [...activeTask.validation_records, {
                    id: id('VAL'),
                    kind: 'desktop_review',
                    date: '',
                    outcome: 'planned',
                    evidence: '',
                    reviewer: '',
                  }],
                })}><Plus size={13} /> Add record</button>
            </div>
            <div className="mt-2 space-y-2">
              {activeTask.validation_records.map((record, recordIndex) => (
                <div key={record.id}
                  className="grid gap-2 rounded-md border border-gray-200 p-3 md:grid-cols-[9rem_9rem_8rem_1fr_1fr_1.5rem]">
                  <SelectField label="Method" value={record.kind}
                    onChange={value => updateTask(activeTask.id, {
                      validation_records: activeTask.validation_records.map((item, i) =>
                        i === recordIndex
                          ? { ...item, kind: value as typeof record.kind } : item),
                    })}
                    options={[
                      'desktop_review', 'procedure_walkthrough', 'physical_demo',
                      'simulation', 'training_trial', 'other',
                    ]} />
                  <SelectField label="Outcome" value={record.outcome}
                    onChange={value => updateTask(activeTask.id, {
                      validation_records: activeTask.validation_records.map((item, i) =>
                        i === recordIndex
                          ? { ...item, outcome: value as typeof record.outcome } : item),
                    })}
                    options={['planned', 'passed', 'failed', 'conditional']} />
                  <Field label="Date" type="date" value={record.date ?? ''}
                    onChange={value => updateTask(activeTask.id, {
                      validation_records: activeTask.validation_records.map((item, i) =>
                        i === recordIndex ? { ...item, date: value } : item),
                    })} />
                  <Field label="Reviewer" value={record.reviewer ?? ''}
                    onChange={value => updateTask(activeTask.id, {
                      validation_records: activeTask.validation_records.map((item, i) =>
                        i === recordIndex ? { ...item, reviewer: value } : item),
                    })} />
                  <Field label="Evidence / observation" value={record.evidence ?? ''}
                    onChange={value => updateTask(activeTask.id, {
                      validation_records: activeTask.validation_records.map((item, i) =>
                        i === recordIndex ? { ...item, evidence: value } : item),
                    })} />
                  <button type="button"
                    onClick={() => updateTask(activeTask.id, {
                      validation_records: activeTask.validation_records.filter(
                        (_, i) => i !== recordIndex),
                    })}
                    className="mt-5 rounded p-1 text-gray-400 hover:text-red-600">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  ) : inventoryView

  const selectedRoleIndex = selectedRole
    ? state.personnel.findIndex(role => role.id === selectedRole.id) : -1
  const selectedResourceIndex = selectedResource
    ? state.resources.findIndex(resource => resource.id === selectedResource.id)
    : -1
  const roleUsage = (roleId: string) => state.tasks.reduce(
    (count, task) => count + task.steps.filter(step =>
      step.personnel.some(item => item.role_id === roleId)).length, 0)
  const resourceUsage = (resourceId: string) => state.tasks.reduce(
    (count, task) => count + task.steps.filter(step =>
      step.resources.some(item => item.resource_id === resourceId)).length, 0)
  const selectedResourceIsConsumable = selectedResource
    ? ['spare', 'repair_part', 'consumable', 'material', 'ppe']
      .includes(selectedResource.kind)
    : false
  const resourcesView = (
    <div className="flex flex-1 overflow-hidden bg-slate-50">
      <aside className="flex w-80 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Resource catalog</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Reusable qualified capacity and material assumptions.
          </p>
          <div className="mt-3 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            {([
              ['personnel', 'Personnel', state.personnel.length],
              ['resources', 'Equipment & material', state.resources.length],
            ] as const).map(([view, label, count]) => (
              <button key={view} type="button"
                onClick={() => setResourceCatalogView(view)}
                className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition ${
                  resourceCatalogView === view
                    ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
                }`}>
                {label} <span className="ml-1 text-slate-400">{count}</span>
              </button>
            ))}
          </div>
          <button type="button"
            onClick={() => {
              if (resourceCatalogView === 'personnel') {
                const role: MTAPersonnelRole = {
                  id: id('role'), name: 'New personnel role', skill: '',
                  available_headcount: 1, hourly_rate: 0,
                  overtime_capacity: 0, overtime_rate_multiplier: 1.5,
                  weekly_shifts: [], planned_outages: [],
                }
                setModel({ personnel: [...state.personnel, role] })
                setSelectedRoleId(role.id)
              } else {
                const resource: MTAResource = {
                  id: id('resource'), name: 'New resource', kind: 'tool',
                  capacity: 1, unit_cost: 0, use_cost_per_hour: 0,
                  quantity_on_hand: null, replenishment_lead_time_hours: 0,
                  weekly_shifts: [], planned_outages: [],
                }
                setModel({ resources: [...state.resources, resource] })
                setSelectedResourceId(resource.id)
              }
            }}
            className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            <Plus size={13} />
            Add {resourceCatalogView === 'personnel' ? 'personnel role' : 'resource'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {resourceCatalogView === 'personnel'
            ? state.personnel.map(role => {
              const usage = roleUsage(role.id)
              return (
                <button key={role.id} type="button"
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`mb-1 w-full rounded-lg border p-3 text-left transition ${
                    selectedRole?.id === role.id
                      ? 'border-blue-300 bg-blue-50 shadow-sm'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}>
                  <span className="flex items-start gap-2">
                    <span className="rounded-md bg-blue-100 p-1.5 text-blue-700">
                      <Users size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-800">
                        {role.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                        {role.skill || 'Qualification not specified'}
                      </span>
                      <span className="mt-1 block text-[9px] text-slate-400">
                        {role.available_headcount} available · {usage} step assignment{usage === 1 ? '' : 's'}
                      </span>
                    </span>
                  </span>
                </button>
              )
            })
            : state.resources.map(resource => {
              const usage = resourceUsage(resource.id)
              return (
                <button key={resource.id} type="button"
                  onClick={() => setSelectedResourceId(resource.id)}
                  className={`mb-1 w-full rounded-lg border p-3 text-left transition ${
                    selectedResource?.id === resource.id
                      ? 'border-violet-300 bg-violet-50 shadow-sm'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}>
                  <span className="flex items-start gap-2">
                    <span className="rounded-md bg-violet-100 p-1.5 text-violet-700">
                      <Wrench size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-800">
                        {resource.name}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {pretty(resource.kind)} · capacity {resource.capacity}
                      </span>
                      <span className="mt-1 block text-[9px] text-slate-400">
                        {usage} step assignment{usage === 1 ? '' : 's'}
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          {((resourceCatalogView === 'personnel' && !state.personnel.length)
              || (resourceCatalogView === 'resources' && !state.resources.length)) && (
            <div className="px-5 py-12 text-center">
              <div className="mx-auto mb-2 w-fit rounded-full bg-slate-100 p-3 text-slate-400">
                {resourceCatalogView === 'personnel'
                  ? <Users size={20} /> : <Wrench size={20} />}
              </div>
              <p className="text-xs font-medium text-slate-600">Catalog is empty</p>
              <p className="mt-1 text-[10px] text-slate-400">
                Add an entry to assign it to task steps.
              </p>
            </div>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-[96rem] space-y-4">
          {resourceCatalogView === 'personnel' && selectedRole
            ? <>
              <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white p-4 shadow-sm">
                <span className="rounded-lg bg-blue-600 p-2 text-white"><Users size={18} /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-slate-900">
                    {selectedRole.name}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    {selectedRole.id} · used by {roleUsage(selectedRole.id)} task step(s)
                  </p>
                </div>
                <button type="button" title={roleUsage(selectedRole.id)
                  ? 'Remove this role from all task steps before deleting it.'
                  : 'Delete personnel role'}
                  disabled={roleUsage(selectedRole.id) > 0}
                  onClick={() => {
                    setModel({ personnel: state.personnel.filter(
                      item => item.id !== selectedRole.id) })
                    setSelectedRoleId('')
                  }}
                  className="rounded-md border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30">
                  <Trash2 size={14} />
                </button>
              </div>
              <Section title="Identity, qualification, and cost">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <Field label="Role ID" value={selectedRole.id}
                    onChange={value => {
                      const oldId = selectedRole.id
                      setModel({
                        personnel: state.personnel.map((item, i) =>
                          i === selectedRoleIndex ? { ...item, id: value } : item),
                        tasks: state.tasks.map(task => ({
                          ...task,
                          steps: task.steps.map(step => ({
                            ...step,
                            personnel: step.personnel.map(assignment =>
                              assignment.role_id === oldId
                                ? { ...assignment, role_id: value } : assignment),
                          })),
                        })),
                      })
                      setSelectedRoleId(value)
                    }} />
                  <Field label="Role name" value={selectedRole.name}
                    onChange={value => setModel({
                      personnel: state.personnel.map((item, i) =>
                        i === selectedRoleIndex ? { ...item, name: value } : item),
                    })} />
                  <div className="md:col-span-2">
                    <Field label="Skill / qualification" value={selectedRole.skill ?? ''}
                      onChange={value => setModel({
                        personnel: state.personnel.map((item, i) =>
                          i === selectedRoleIndex ? { ...item, skill: value } : item),
                      })} />
                  </div>
                  <Field label="Available headcount" type="number" min={0} step={1}
                    value={selectedRole.available_headcount}
                    onChange={value => setModel({
                      personnel: state.personnel.map((item, i) =>
                        i === selectedRoleIndex ? {
                          ...item, available_headcount: Math.round(finite(value)),
                        } : item),
                    })} />
                  <Field label="Loaded hourly rate ($/engaged hour)"
                    type="number" min={0} step={1} prefix="$"
                    value={selectedRole.hourly_rate}
                    onChange={value => setModel({
                      personnel: state.personnel.map((item, i) =>
                        i === selectedRoleIndex
                          ? { ...item, hourly_rate: finite(value) } : item),
                    })} />
                  <Field label="Off-shift overtime capacity" type="number" min={0} step={1}
                    value={selectedRole.overtime_capacity ?? 0}
                    onChange={value => setModel({
                      personnel: state.personnel.map((item, i) =>
                        i === selectedRoleIndex ? {
                          ...item, overtime_capacity: Math.round(finite(value)),
                        } : item),
                    })} />
                  <Field label="Overtime rate multiplier" type="number"
                    min={1} max={10} step={0.1}
                    value={selectedRole.overtime_rate_multiplier ?? 1.5}
                    onChange={value => setModel({
                      personnel: state.personnel.map((item, i) =>
                        i === selectedRoleIndex ? {
                          ...item,
                          overtime_rate_multiplier: finite(value, 1.5),
                        } : item),
                    })} />
                </div>
              </Section>
              <Section title="Working calendar and planned outages">
                <ShiftEditor
                  shifts={selectedRole.weekly_shifts ?? []}
                  outages={selectedRole.planned_outages ?? []}
                  defaultCapacity={selectedRole.available_headcount}
                  onShifts={weekly_shifts => setModel({
                    personnel: state.personnel.map((item, i) =>
                      i === selectedRoleIndex ? { ...item, weekly_shifts } : item),
                  })}
                  onOutages={planned_outages => setModel({
                    personnel: state.personnel.map((item, i) =>
                      i === selectedRoleIndex ? { ...item, planned_outages } : item),
                  })}
                />
              </Section>
            </>
            : resourceCatalogView === 'resources' && selectedResource
              ? <>
                <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-white p-4 shadow-sm">
                  <span className="rounded-lg bg-violet-600 p-2 text-white"><Wrench size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-900">
                      {selectedResource.name}
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      {pretty(selectedResource.kind)} · {selectedResource.id} · used by{' '}
                      {resourceUsage(selectedResource.id)} task step(s)
                    </p>
                  </div>
                  <button type="button" disabled={resourceUsage(selectedResource.id) > 0}
                    title={resourceUsage(selectedResource.id)
                      ? 'Remove this resource from all task steps before deleting it.'
                      : 'Delete resource'}
                    onClick={() => {
                      setModel({ resources: state.resources.filter(
                        item => item.id !== selectedResource.id) })
                      setSelectedResourceId('')
                    }}
                    className="rounded-md border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30">
                    <Trash2 size={14} />
                  </button>
                </div>
                <Section title="Identity, classification, and cost">
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <Field label="Resource ID" value={selectedResource.id}
                      onChange={value => {
                        const oldId = selectedResource.id
                        setModel({
                          resources: state.resources.map((item, i) =>
                            i === selectedResourceIndex
                              ? { ...item, id: value } : item),
                          tasks: state.tasks.map(task => ({
                            ...task,
                            steps: task.steps.map(step => ({
                              ...step,
                              resources: step.resources.map(assignment =>
                                assignment.resource_id === oldId
                                  ? { ...assignment, resource_id: value }
                                  : assignment),
                            })),
                          })),
                        })
                        setSelectedResourceId(value)
                      }} />
                    <Field label="Resource name" value={selectedResource.name}
                      onChange={value => setModel({
                        resources: state.resources.map((item, i) =>
                          i === selectedResourceIndex
                            ? { ...item, name: value } : item),
                      })} />
                    <SelectField label="Resource kind" value={selectedResource.kind}
                      onChange={value => setModel({
                        resources: state.resources.map((item, i) =>
                          i === selectedResourceIndex ? {
                            ...item, kind: value as MTAResourceKind,
                          } : item),
                      })} options={RESOURCE_KINDS} />
                    <Field label="Available capacity" type="number" min={0} step={1}
                      value={selectedResource.capacity}
                      onChange={value => setModel({
                        resources: state.resources.map((item, i) =>
                          i === selectedResourceIndex ? {
                            ...item, capacity: Math.round(finite(value)),
                          } : item),
                      })} />
                    <Field label="Unit / replacement cost ($/unit)"
                      type="number" min={0} step={1} prefix="$"
                      value={selectedResource.unit_cost}
                      onChange={value => setModel({
                        resources: state.resources.map((item, i) =>
                          i === selectedResourceIndex ? {
                            ...item, unit_cost: finite(value),
                          } : item),
                      })} />
                    <Field label="Use cost ($/resource-hour)"
                      type="number" min={0} step={1} prefix="$"
                      value={selectedResource.use_cost_per_hour}
                      onChange={value => setModel({
                        resources: state.resources.map((item, i) =>
                          i === selectedResourceIndex ? {
                            ...item, use_cost_per_hour: finite(value),
                          } : item),
                      })} />
                    {selectedResourceIsConsumable && <>
                      <Field label="Quantity on hand" type="number" min={0} step={1}
                        value={selectedResource.quantity_on_hand ?? ''}
                        onChange={value => setModel({
                          resources: state.resources.map((item, i) =>
                            i === selectedResourceIndex ? {
                              ...item,
                              quantity_on_hand: value === '' ? null : finite(value),
                            } : item),
                        })} />
                      <Field label="Replenishment lead (hours)" type="number"
                        min={0} step={1}
                        value={selectedResource.replenishment_lead_time_hours ?? 0}
                        onChange={value => setModel({
                          resources: state.resources.map((item, i) =>
                            i === selectedResourceIndex ? {
                              ...item,
                              replenishment_lead_time_hours: finite(value),
                            } : item),
                        })} />
                    </>}
                  </div>
                </Section>
                {!selectedResourceIsConsumable && (
                  <Section title="Working calendar and planned outages">
                    <ShiftEditor
                      shifts={selectedResource.weekly_shifts ?? []}
                      outages={selectedResource.planned_outages ?? []}
                      defaultCapacity={selectedResource.capacity}
                      onShifts={weekly_shifts => setModel({
                        resources: state.resources.map((item, i) =>
                          i === selectedResourceIndex
                            ? { ...item, weekly_shifts } : item),
                      })}
                      onOutages={planned_outages => setModel({
                        resources: state.resources.map((item, i) =>
                          i === selectedResourceIndex
                            ? { ...item, planned_outages } : item),
                      })}
                    />
                  </Section>
                )}
              </>
              : <div className="flex min-h-[28rem] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
                <div>
                  <Wrench size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">
                    Select or create a catalog entry
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Only the active resource is shown here.
                  </p>
                </div>
              </div>}
        </div>
      </div>
    </div>
  )

  const referencedRoles = new Set(state.tasks.flatMap(task =>
    task.steps.flatMap(step => step.personnel.map(item => item.role_id))))
  const referencedResources = new Set(state.tasks.flatMap(task =>
    task.steps.flatMap(step => step.resources.map(item => item.resource_id))))
  const missingRoles = [...referencedRoles].filter(roleId =>
    !state.personnel.some(role => role.id === roleId))
  const missingResources = [...referencedResources].filter(resourceId =>
    !state.resources.some(resource => resource.id === resourceId))
  const cyclesRisk = state.tasks.filter(task =>
    task.steps.some(step => step.predecessor_step_ids.includes(step.id)))
  const portfolioView = (
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-80 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-4">
        <p className="mb-1 text-xs font-semibold text-gray-800">Portfolio assumptions</p>
        <p className="mb-4 text-[11px] leading-relaxed text-gray-500">
          A transparent time-grid scheduler resolves task dependencies, qualified
          capacity, working calendars, outages, priorities, and due windows.
        </p>
        <div className="space-y-3">
          <Field label="Planning horizon (hours)" type="number" min={0.01} step={1}
            value={state.portfolio.horizon_hours}
            onChange={value => setModel({
              portfolio: { ...state.portfolio, horizon_hours: finite(value, 1) },
            })} />
          <Field label="Scheduling increment (hours)" type="number" min={0.01} step={0.05}
            value={state.portfolio.slot_hours}
            onChange={value => setModel({
              portfolio: { ...state.portfolio, slot_hours: finite(value, 0.25) },
            })} />
          <label className="block">
            <MtaLabel tip={FIELD_HELP['Horizon starts on']}>
              Horizon starts on
            </MtaLabel>
            <select className={inputCls}
              value={state.portfolio.start_weekday}
              onChange={event => setModel({
                portfolio: {
                  ...state.portfolio,
                  start_weekday: Number(event.target.value),
                },
              })}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>{day}</option>
              ))}
            </select>
          </label>
          <Field label="Asset population" type="number" min={0} step={1}
            value={state.portfolio.asset_population}
            onChange={value => setModel({
              portfolio: { ...state.portfolio, asset_population: finite(value) },
            })} />
          <Field label="Default downtime cost ($/hour)"
            type="number" min={0} step={1} prefix="$"
            value={state.portfolio.default_downtime_cost_per_hour}
            onChange={value => setModel({
              portfolio: {
                ...state.portfolio,
                default_downtime_cost_per_hour: finite(value),
              },
            })} />
          <Toggle label="Run Monte Carlo uncertainty ensemble"
            checked={state.portfolio.simulation_enabled}
            onChange={value => setModel({
              portfolio: { ...state.portfolio, simulation_enabled: value },
            })} />
          {!state.portfolio.simulation_enabled && (
            <p className="-mt-2 text-[10px] leading-relaxed text-gray-400">
              Runs one reproducible seeded scenario. Expected-duration and
              probability-weighted task rollups remain available in Results.
            </p>
          )}
          <Toggle label="Permit configured off-shift overtime capacity"
            checked={state.portfolio.allow_overtime}
            onChange={value => setModel({
              portfolio: { ...state.portfolio, allow_overtime: value },
            })} />
          {state.portfolio.simulation_enabled && <>
            <Field label="Monte Carlo replications" type="number" min={1} max={20000} step={100}
              value={state.portfolio.n_simulations}
              onChange={value => setModel({
                portfolio: {
                  ...state.portfolio,
                  n_simulations: Math.round(finite(value, 2000)),
                },
              })} />
            <Field label="Confidence level" type="number" min={0.01} max={0.999} step={0.01}
              value={state.portfolio.confidence}
              onChange={value => setModel({
                portfolio: { ...state.portfolio, confidence: finite(value, 0.95) },
              })} />
            <Field label="Random seed" type="number" step={1}
              value={state.portfolio.seed}
              onChange={value => setModel({
                portfolio: {
                  ...state.portfolio,
                  seed: Math.round(finite(value, 42)),
                },
              })} />
          </>}
        </div>
        {loading ? (
          <div className="sticky bottom-0 mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-blue-800">
              <span className="flex items-center gap-1 font-medium">
                <LoaderCircle size={13} className="animate-spin" /> Scheduling portfolio
              </span>
              <span>{progress.total
                ? `${Math.round(100 * progress.done / progress.total)}%` : 'Starting…'}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
              <div className="h-full bg-blue-600 transition-all"
                style={{ width: `${progress.total
                  ? 100 * progress.done / progress.total : 2}%` }} />
            </div>
            <button type="button"
              onClick={() => abortRef.current?.abort()}
              className="mt-3 flex w-full items-center justify-center gap-1 rounded border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50">
              <Square size={11} fill="currentColor" /> Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={!state.tasks.length}
            data-shortcut-primary
            className={`${btnCls} sticky bottom-0 mt-5 w-full justify-center py-2 disabled:opacity-40`}
          >
            <Play size={13} /> Analyze task portfolio
          </button>
        )}
      </aside>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <h3 className="text-sm font-semibold text-gray-800">Pre-run readiness</h3>
          <p className="mt-1 text-xs text-gray-500">
            These checks are intentionally visible before computation so an
            audit reviewer can distinguish model deficiencies from schedule results.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Readiness
              good={state.tasks.length > 0}
              title={`${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'} in scope`}
              detailText={state.tasks.length
                ? `${state.tasks.reduce((sum, task) => sum + task.steps.length, 0)} procedural steps`
                : 'Define at least one task.'}
            />
            <Readiness
              good={missingRoles.length === 0}
              title={missingRoles.length ? 'Missing personnel mappings' : 'Personnel references resolve'}
              detailText={missingRoles.length ? missingRoles.join(', ') : `${state.personnel.length} reusable roles`}
            />
            <Readiness
              good={missingResources.length === 0}
              title={missingResources.length ? 'Missing resource mappings' : 'Resource references resolve'}
              detailText={missingResources.length ? missingResources.join(', ') : `${state.resources.length} catalog entries`}
            />
            <Readiness
              good={cyclesRisk.length === 0}
              title={cyclesRisk.length ? 'Self-dependency found' : 'No obvious self-dependencies'}
              detailText={cyclesRisk.length
                ? cyclesRisk.map(task => task.id).join(', ')
                : 'The backend also performs full directed-cycle validation.'}
            />
            <Readiness
              good={state.tasks.every(task =>
                ['approved', 'demonstrated'].includes(task.status))}
              title={state.tasks.every(task =>
                ['approved', 'demonstrated'].includes(task.status))
                ? 'All tasks are approved'
                : 'Draft/reviewed tasks will be included'}
              detailText="Results retain the governance status of every task."
            />
            <Readiness
              good={state.tasks.every(task =>
                task.validation_records.some(record => record.outcome === 'passed'))}
              title={state.tasks.every(task =>
                task.validation_records.some(record => record.outcome === 'passed'))
                ? 'All tasks have passed evidence'
                : 'Validation evidence is incomplete'}
              detailText="This is a readiness warning, not a calculation blocker."
            />
          </div>
          <Section title="Scheduling policy and disclosed assumptions">
            <ol className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-gray-600">
              <li>Release work at its occurrence time, then honor the task-step dependency graph.</li>
              <li>Select the earliest feasible work; break ties by criticality, due time, arrival time, and stable IDs.</li>
              <li>Reserve qualified personnel and renewable equipment on their working calendars. Interruptible steps may pause across unavailable shifts.</li>
              <li>Sample exclusive branches once per event and use fixed, triangular, or beta-PERT durations as configured.</li>
              <li>Do not preempt active work when a later, higher-priority job arrives. Report unfinished or late events explicitly.</li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  )

  const result = state.result
  const timeline = result?.portfolio.representative_timeline ?? []
  const taskName = new Map(state.tasks.map(task => [task.id, task.title]))
  const timelineLabels = timeline.map((row, index) => {
    const task = taskName.get(row.task_id) ?? 'Maintenance task'
    const step = row.label.trim()
    const occurrence = row.job_id.startsWith(`${row.task_id}:`)
      ? row.job_id.slice(row.task_id.length + 1)
      : String(index + 1)
    const taskAndStep = step && step.toLocaleLowerCase() !== task.toLocaleLowerCase()
      ? `${task} — ${step}` : task
    return `${taskAndStep} · Occurrence ${occurrence}`
  })
  const timelineData = timeline.length ? [{
    type: 'bar',
    orientation: 'h',
    base: timeline.map(row => row.start),
    x: timeline.map(row => Math.max(0, row.finish - row.start)),
    y: timelineLabels,
    customdata: timeline.map((row, index) => [
      taskName.get(row.task_id) ?? row.task_id,
      row.label,
      timelineLabels[index],
      row.start,
      row.finish,
    ]),
    marker: {
      color: timeline.map(row => row.active ? '#2563eb' : '#cbd5e1'),
    },
    hovertemplate: '<b>%{customdata[0]}</b><br>Step: %{customdata[1]}<br>%{customdata[2]}<br>Start: %{customdata[3]:.2f} h<br>Finish: %{customdata[4]:.2f} h<extra></extra>',
    name: 'Scheduled work',
  } as Plotly.Data] : []
  const utilisationEntries = result
    ? Object.entries(result.portfolio.resource_utilisation) : []
  const personnelNames = new Map(state.personnel.map(role => [role.id, role.name]))
  const resourceNames = new Map(state.resources.map(resource => [
    resource.id, resource.name,
  ]))
  const utilisationLabels = utilisationEntries.map(([pool]) => {
    if (pool.startsWith('personnel:')) {
      const roleId = pool.slice('personnel:'.length)
      return `${personnelNames.get(roleId) ?? pretty(roleId)} · Personnel`
    }
    if (pool.startsWith('resource:')) {
      const resourceId = pool.slice('resource:'.length)
      return `${resourceNames.get(resourceId) ?? pretty(resourceId)} · Equipment / material`
    }
    return pretty(pool)
  })
  const costBreakdownEntries = result ? ([
    ['Labor', result.portfolio.cost_breakdown.labour, '#2563eb'],
    ['Materials and consumables', result.portfolio.cost_breakdown.materials, '#7c3aed'],
    ['Renewable resource use', result.portfolio.cost_breakdown.resource_use, '#0891b2'],
    ['Fixed event cost', result.portfolio.cost_breakdown.fixed, '#64748b'],
    ['Travel and mobilization', result.portfolio.cost_breakdown.travel, '#d97706'],
    ['Downtime consequence', result.portfolio.cost_breakdown.downtime, '#dc2626'],
  ] as const) : []
  const costBreakdownMean = costBreakdownEntries.reduce(
    (sum, [, interval]) => sum + interval.mean, 0)
  const costPieEntries = costBreakdownEntries.filter(
    ([, interval]) => interval.mean > 0)
  const resultsView = result ? (
    <div ref={resultsRef} className="flex-1 overflow-y-auto p-5">
      <div className="mx-auto w-full max-w-[96rem] space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Maintenance task analysis results</h3>
            <p className="font-mono text-[10px] text-gray-400">
              Result SHA-256 {result.result_sha256}
              <span className="ml-3">Input SHA-256 {result.input_sha256}</span>
            </p>
          </div>
          <ExportResultsButton
            getElement={() => resultsRef.current}
            baseName="maintenance_task_analysis"
            title="Maintenance Task Analysis"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Card label="Generated work"
            value={`${fmtInterval(result.portfolio.jobs_generated)} jobs`} />
          <Card label="Completed work"
            value={`${fmtInterval(result.portfolio.jobs_completed)} jobs`} accent />
          <Card label="Backlog"
            value={`${fmtInterval(result.portfolio.backlog_jobs)} jobs`}
            tone={result.portfolio.backlog_jobs.upper > 0 ? 'warning' : 'success'} />
          <Card label="Late work"
            value={`${fmtInterval(result.portfolio.late_jobs)} jobs`}
            tone={result.portfolio.late_jobs.upper > 0 ? 'warning' : 'success'} />
          <Card label="Total cost"
            value={fmtCurrencyInterval(result.portfolio.total_cost)}
            onClick={() => setShowCostBreakdown(value => !value)}
            active={showCostBreakdown}
            tip="Show or hide the portfolio cost breakdown." />
          <Card label="Asset availability"
            value={result.portfolio.availability
              ? `${(100 * result.portfolio.availability.mean).toFixed(3)}%` : 'Not calculated'} />
        </div>
        {showCostBreakdown && (
          <section className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50/70 to-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold text-slate-900">
                  Portfolio cost breakdown
                </h4>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Component means reconcile to total mean cost. Each component’s
                  uncertainty interval is marginal, so interval endpoints should
                  not be added together.
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                  Total
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {fmtCurrencyInterval(result.portfolio.total_cost)}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.45fr)]">
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                {costPieEntries.length ? (
                  <Plot
                    plotId="mta-portfolio-cost-composition"
                    reportLabel="MTA Portfolio Cost Composition"
                    reportGroup="Maintenance Task Analysis"
                    data={[{
                      type: 'pie',
                      labels: costPieEntries.map(([label]) => label),
                      values: costPieEntries.map(([, interval]) => interval.mean),
                      customdata: costPieEntries.map(([, interval]) => [
                        interval.lower, interval.upper,
                      ]),
                      marker: {
                        colors: costPieEntries.map(([, , color]) => color),
                        line: { color: '#ffffff', width: 1.5 },
                      },
                      hole: 0.42,
                      sort: false,
                      direction: 'clockwise',
                      textinfo: 'percent',
                      hovertemplate: '<b>%{label}</b><br>Mean: $%{value:,.2f}<br>Share: %{percent}<br>Uncertainty interval: $%{customdata[0]:,.2f}–$%{customdata[1]:,.2f}<extra></extra>',
                      name: 'Cost',
                    } as Plotly.Data]}
                    layout={{
                      height: 340,
                      margin: { t: 20, r: 20, b: 95, l: 20 },
                      paper_bgcolor: 'white',
                      plot_bgcolor: 'white',
                      showlegend: true,
                      legend: {
                        orientation: 'h',
                        x: 0.5,
                        xanchor: 'center',
                        y: -0.08,
                        yanchor: 'top',
                        font: { size: 9 },
                      },
                    }}
                    config={{ responsive: true }}
                    style={{ width: '100%' }}
                    useResizeHandler
                  />
                ) : (
                  <p className="flex h-72 items-center justify-center text-xs text-slate-400">
                    No portfolio cost was generated.
                  </p>
                )}
                <p className="px-2 pb-1 text-center text-[9px] text-slate-400">
                  Wedge proportions use component mean costs.
                </p>
              </div>
              <div className="grid content-start gap-3 sm:grid-cols-2">
                {costBreakdownEntries.map(([label, interval, color]) => {
                  const share = costBreakdownMean > 0
                    ? 100 * interval.mean / costBreakdownMean : 0
                  return (
                    <div key={label}
                      className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-medium text-slate-600">
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-slate-900">
                            {fmtCurrencyInterval(interval)}
                          </p>
                        </div>
                        <span className="text-[10px] font-semibold text-slate-500">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(0, share))}%`,
                            backgroundColor: color,
                          }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )}
        {result.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="mb-1 font-semibold">Interpretation notes</p>
            <ul className="list-disc space-y-1 pl-5">
              {result.warnings.map(warning => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
        <div className="grid gap-5">
          <section className="rounded-lg border border-gray-200 bg-white p-3">
            <h4 className="mb-2 text-xs font-semibold text-gray-700">
              Representative resource-constrained schedule
            </h4>
            {timelineData.length
              ? <Plot
                plotId="mta-representative-schedule"
                reportLabel="Representative Resource-Constrained Schedule"
                reportGroup="Maintenance Task Analysis"
                data={timelineData}
                layout={{
                  height: Math.max(360, Math.min(1000, 110 + timeline.length * 28)),
                  margin: { t: 20, r: 20, b: 50, l: 285 },
                  xaxis: { title: { text: 'Portfolio time (hours)' }, gridcolor: '#e5e7eb' },
                  yaxis: {
                    automargin: true,
                    autorange: 'reversed',
                    tickfont: { size: 10 },
                  },
                  paper_bgcolor: 'white',
                  plot_bgcolor: 'white',
                  showlegend: false,
                }}
                config={{ responsive: true }}
                style={{ width: '100%' }}
                useResizeHandler
              />
              : <p className="py-16 text-center text-xs text-gray-400">
                No work was generated in the representative replication.
              </p>}
          </section>
          <section className="rounded-lg border border-gray-200 bg-white p-3">
            <h4 className="mb-2 text-xs font-semibold text-gray-700">
              Resource utilization
            </h4>
            {utilisationEntries.length
              ? <Plot
                plotId="mta-resource-utilisation"
                reportLabel="MTA Resource Utilization"
                reportGroup="Maintenance Task Analysis"
                data={[{
                  type: 'bar',
                  orientation: 'h',
                  x: utilisationEntries.map(([, interval]) => interval.mean * 100),
                  y: utilisationLabels,
                  customdata: utilisationEntries.map(([, interval]) => [
                    interval.lower * 100,
                    interval.upper * 100,
                  ]),
                  error_x: {
                    type: 'data',
                    symmetric: false,
                    array: utilisationEntries.map(([, interval]) =>
                      (interval.upper - interval.mean) * 100),
                    arrayminus: utilisationEntries.map(([, interval]) =>
                      (interval.mean - interval.lower) * 100),
                  },
                  marker: { color: '#0f766e' },
                  hovertemplate: `<b>%{y}</b><br>Mean: %{x:.2f}%<br>${
                    result.portfolio.n_simulations > 1
                      ? `${(100 * result.portfolio.confidence).toFixed(1)}% uncertainty interval`
                      : 'Uncertainty bounds'
                  }: %{customdata[0]:.2f}%–%{customdata[1]:.2f}%<extra></extra>`,
                  name: 'Utilization',
                } as Plotly.Data]}
                layout={{
                  height: Math.max(340, 130 + utilisationEntries.length * 34),
                  margin: { t: 20, r: 30, b: 50, l: 210 },
                  xaxis: { title: { text: 'Utilization (%)' }, rangemode: 'tozero' },
                  yaxis: { automargin: true, tickfont: { size: 10 } },
                  paper_bgcolor: 'white',
                  plot_bgcolor: 'white',
                  showlegend: false,
                }}
                config={{ responsive: true }}
                style={{ width: '100%' }}
                useResizeHandler
              />
              : <p className="py-16 text-center text-xs text-gray-400">
                Assign renewable personnel or equipment to display utilization.
              </p>}
          </section>
        </div>

        <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                {[
                  'Task', 'Status', 'Elapsed / event (hours)',
                  'Labor / event (labor-hours)', 'Cost / event ($)',
                  'Portfolio events (events)', 'Portfolio labor (labor-hours)',
                  'Portfolio downtime (hours)',
                ].map(label =>
                  <th key={label} className="px-3 py-2 font-medium">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.task_results.map(row => (
                <tr key={row.task_id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <button type="button"
                      className="text-left font-medium text-blue-700 hover:underline"
                      onClick={() => patchWorkspace({
                        activeTaskId: row.task_id,
                        view: 'definition',
                      })}>
                      {row.title}
                    </button>
                    <span className="block font-mono text-[10px] text-gray-400">{row.task_id}</span>
                  </td>
                  <td className="px-3 py-2">{pretty(row.status)}</td>
                  <td className="px-3 py-2">{fmtNum(row.elapsed_hours)} h</td>
                  <td className="px-3 py-2">{fmtNum(row.labour_hours)} h</td>
                  <td className="px-3 py-2">${fmtNum(row.cost_per_event.total)}</td>
                  <td className="px-3 py-2">{row.portfolio.events ? fmtInterval(row.portfolio.events) : '—'}</td>
                  <td className="px-3 py-2">{row.portfolio.labour_hours ? fmtInterval(row.portfolio.labour_hours) : '—'}</td>
                  <td className="px-3 py-2">{row.portfolio.downtime_hours ? fmtInterval(row.portfolio.downtime_hours) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

      </div>
    </div>
  ) : (
    <div className="flex flex-1 items-center justify-center text-center">
      <div>
        <ClipboardList size={36} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm text-gray-500">No current task-analysis result.</p>
        <button type="button"
          onClick={() => patchWorkspace({ view: 'portfolio' })}
          className="mt-3 text-xs font-medium text-blue-600 hover:underline">
          Review assumptions and run the portfolio
        </button>
      </div>
    </div>
  )

  const eligiblePredictionItems = filteredPredictionItems.filter(
    item => item.eligible)
  const selectedPredictionItems = predictionItems.filter(item =>
    predictionSelection.includes(item.key))
  const selectedPredictionTypes = new Set(
    selectedPredictionItems.map(item => item.source.entity_type))
  const predictionImportModal = predictionImportOpen && (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-6">
      <div role="dialog" aria-modal="true"
        aria-label="Pull Failure Rate Prediction tasks"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Pull from Failure Rate Prediction
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500">
              Create one failure-driven draft task per selected part, system
              block, or system. Reopening this window refreshes matching linked
              rates without replacing task steps or analyst wording.
            </p>
          </div>
          <button type="button" onClick={() => setPredictionImportOpen(false)}
            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
            Close
          </button>
        </div>
        <div className="border-b border-gray-100 px-5 py-3">
          <label className="block text-xs font-medium text-gray-700">
            Prediction analysis
            <select className={`${inputCls} mt-1`}
              value={activePredictionFolio?.id ?? ''}
              onChange={event => {
                setPredictionFolioId(event.target.value)
                setPredictionSelection([])
                setPredictionLinkFilter('unlinked')
              }}>
              {predictionFolios.map(folio => (
                <option key={folio.id} value={folio.id}>{folio.name}</option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Link status
            </span>
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              {([
                ['unlinked', 'Not linked', predictionItems.filter(
                  item => !predictionItemIsLinked(item)).length],
                ['linked', 'Linked', predictionItems.filter(
                  predictionItemIsLinked).length],
                ['all', 'All', predictionItems.length],
              ] as const).map(([filter, label, count]) => (
                <button key={filter} type="button"
                  onClick={() => {
                    setPredictionLinkFilter(filter)
                    setPredictionSelection([])
                  }}
                  title={filter === 'unlinked'
                    ? 'Show only prediction records that do not already have a linked maintenance task.'
                    : filter === 'linked'
                      ? 'Show linked records that can refresh their stored failure-rate snapshot.'
                      : 'Show both linked and not-yet-linked prediction records.'}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition ${
                    predictionLinkFilter === filter
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  {label} <span className="ml-1 text-slate-400">{count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ['All parts', (item: PredictionTaskCandidate) =>
                item.source.entity_type === 'part'],
              ['All blocks', (item: PredictionTaskCandidate) =>
                item.source.entity_type === 'block'],
              ['All eligible', (_item: PredictionTaskCandidate) => true],
            ] as const).map(([label, predicate]) => (
              <button key={label} type="button"
                onClick={() => setPredictionSelection(
                  eligiblePredictionItems.filter(predicate).map(item => item.key))}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50">
                {label}
              </button>
            ))}
            <button type="button"
              onClick={() => setPredictionSelection(
                eligiblePredictionItems.filter(item =>
                  !predictionSelection.includes(item.key)).map(item => item.key))}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50">
              Invert
            </button>
            <button type="button" onClick={() => setPredictionSelection([])}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50">
              Deselect all
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {!predictionFolios.length ? (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              No Failure Rate Prediction analyses are available.
            </p>
          ) : !predictionItems.length ? (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              This analysis has no parts or system blocks to publish.
            </p>
          ) : !filteredPredictionItems.length ? (
            <div className="rounded border border-slate-200 bg-slate-50 p-4 text-center">
              <p className="text-xs font-medium text-slate-700">
                No {predictionLinkFilter === 'unlinked'
                  ? 'not-yet-linked' : 'linked'} records in this analysis.
              </p>
              <button type="button"
                onClick={() => setPredictionLinkFilter('all')}
                className="mt-2 text-[11px] font-medium text-blue-700 hover:underline">
                Show all prediction records
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedPredictionItems.map(item => {
                const alreadyLinked = predictionItemIsLinked(item)
                const contextOnly = !filteredPredictionRecordIds.has(
                  item.recordId)
                const rowClass = `flex gap-3 rounded-lg border p-3 ${
                  contextOnly
                    ? 'border-slate-200 bg-slate-50 text-slate-500'
                    : item.eligible
                      ? 'cursor-pointer border-gray-200 hover:border-blue-300 hover:bg-blue-50/40'
                      : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-60'
                }`
                const rowContent = <>
                  {!contextOnly && (
                    <input type="checkbox"
                      className="mt-0.5 rounded border-gray-300"
                      disabled={!item.eligible}
                      checked={predictionSelection.includes(item.key)}
                      onChange={event => setPredictionSelection(current =>
                        event.target.checked
                          ? [...new Set([...current, item.key])]
                          : current.filter(key => key !== item.key))} />
                  )}
                  {contextOnly && (
                    <GitBranch size={13}
                      className="mt-0.5 flex-shrink-0 text-slate-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium text-xs ${
                        contextOnly ? 'text-slate-600' : 'text-gray-800'
                      }`}>
                        {item.source.label}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-600">
                        {item.source.entity_type === 'part'
                          ? 'Piece part'
                          : item.source.entity_type === 'block'
                            ? 'System block' : 'System total'}
                      </span>
                      {contextOnly && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                          hierarchy context
                        </span>
                      )}
                      {!contextOnly && alreadyLinked && (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                          linked · refresh
                        </span>
                      )}
                    </div>
                    {contextOnly ? (
                      <p className="mt-1 text-[10px] text-slate-400">
                        Parent shown to preserve the Failure Rate Prediction hierarchy.
                      </p>
                    ) : item.eligible ? (
                      <p className="mt-1 text-[11px] text-gray-500">
                        {fmtNum(item.source.rate_fpmh)} FPMH ·{' '}
                        {pretty(item.source.rate_basis)} · represents{' '}
                        {item.source.represented_quantity} item(s)
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-amber-700">
                        {item.reason}
                      </p>
                    )}
                  </div>
                </>
                return (
                  <div key={item.key} className="relative"
                    style={{ marginLeft: `${item.hierarchyDepth * 28}px` }}>
                    {item.hierarchyDepth > 0 && (
                      <span aria-hidden="true"
                        className="pointer-events-none absolute -left-4 -top-2 h-[calc(50%+0.5rem)] w-4 rounded-bl border-b border-l border-slate-300" />
                    )}
                    {contextOnly
                      ? <div className={rowClass}>{rowContent}</div>
                      : <label className={rowClass}>{rowContent}</label>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {selectedPredictionTypes.size > 1 && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-2 text-[11px] text-amber-800">
            Parent system/block rates overlap their descendant rates. Select
            multiple hierarchy levels only when duplicate maintenance demand is intentional.
          </div>
        )}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <span className="text-xs text-gray-500">
            {selectedPredictionItems.length} selected
          </span>
          <button type="button" disabled={!selectedPredictionItems.length}
            onClick={pullPredictionTasks}
            className={`${btnCls} px-4 py-2 disabled:cursor-not-allowed disabled:opacity-40`}>
            <Link2 size={13} /> Create or refresh linked tasks
          </button>
        </div>
      </div>
    </div>
  )

  const content = state.view === 'inventory'
    ? inventoryView
    : state.view === 'definition'
      ? definitionView
      : state.view === 'resources'
        ? resourcesView
        : state.view === 'portfolio'
          ? portfolioView : resultsView

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      <TabBar
        tabs={[
          { id: 'inventory', label: 'Task Inventory' },
          { id: 'definition', label: 'Task Definition' },
          { id: 'resources', label: 'Resources' },
          { id: 'portfolio', label: 'Portfolio' },
          { id: 'results', label: 'Results' },
        ]}
        active={state.view}
        onChange={view => patchWorkspace({ view: view as WorkspaceView })}
      />
      {toolbar}
      {(error || notice) && (
        <div className={`mx-4 mt-2 rounded-md border px-3 py-2 text-xs ${
          error
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-blue-200 bg-blue-50 text-blue-800'
        }`}>
          {error ?? notice}
        </div>
      )}
      {content}
      {predictionImportModal}
    </div>
  )
}

function ShiftEditor({
  shifts, outages, defaultCapacity, onShifts, onOutages,
}: {
  shifts: NonNullable<MTAPersonnelRole['weekly_shifts']>
  outages: NonNullable<MTAPersonnelRole['planned_outages']>
  defaultCapacity: number
  onShifts: (value: NonNullable<MTAPersonnelRole['weekly_shifts']>) => void
  onOutages: (value: NonNullable<MTAPersonnelRole['planned_outages']>) => void
}) {
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-600">Weekly shifts</p>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => onShifts([0, 1, 2, 3, 4].map(weekday => ({
              weekday, start_hour: 8, end_hour: 16, capacity: defaultCapacity,
            })))}
            className="text-[10px] text-blue-600">Weekdays 08–16</button>
          <button type="button"
            onClick={() => onShifts([...shifts, {
              weekday: 0, start_hour: 8, end_hour: 16,
              capacity: defaultCapacity,
            }])}
            className="text-[10px] text-blue-600">+ shift</button>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {shifts.map((shift, shiftIndex) => (
          <div key={shiftIndex}
            className="grid grid-cols-[1fr_1fr_1fr_1fr_1.5rem] items-end gap-2">
            <label className="block">
              <MtaLabel tip={FIELD_HELP.Day}>Day</MtaLabel>
              <select className={inputCls} value={shift.weekday}
                onChange={event => onShifts(shifts.map((item, i) =>
                  i === shiftIndex ? {
                    ...item, weekday: Number(event.target.value),
                  } : item))}>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </label>
            <Field label="Start" type="number" min={0} max={23.99} step={0.25}
              value={shift.start_hour}
              onChange={value => onShifts(shifts.map((item, i) =>
                i === shiftIndex ? { ...item, start_hour: finite(value) } : item))} />
            <Field label="End" type="number" min={0.01} max={24} step={0.25}
              value={shift.end_hour}
              onChange={value => onShifts(shifts.map((item, i) =>
                i === shiftIndex ? { ...item, end_hour: finite(value) } : item))} />
            <Field label="Capacity" type="number" min={0} step={1}
              value={shift.capacity ?? defaultCapacity}
              onChange={value => onShifts(shifts.map((item, i) =>
                i === shiftIndex
                  ? { ...item, capacity: Math.round(finite(value)) } : item))} />
            <button type="button"
              onClick={() => onShifts(shifts.filter((_, i) => i !== shiftIndex))}
              className="mb-1 rounded p-1 text-gray-400 hover:text-red-600">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!shifts.length &&
          <p className="text-[10px] text-gray-400">No shift rows means continuously available.</p>}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-600">Planned outages</p>
        <button type="button"
          onClick={() => onOutages([...outages, {
            start_hour: 0, end_hour: 8, capacity: 0, note: '',
          }])}
          className="text-[10px] text-blue-600">+ outage</button>
      </div>
      <div className="mt-2 space-y-1.5">
        {outages.map((outage, outageIndex) => (
          <div key={outageIndex}
            className="grid grid-cols-[1fr_1fr_1fr_1.5rem] items-end gap-2">
            <Field label="Start hour" type="number" min={0} step={1}
              value={outage.start_hour}
              onChange={value => onOutages(outages.map((item, i) =>
                i === outageIndex ? { ...item, start_hour: finite(value) } : item))} />
            <Field label="End hour" type="number" min={0.01} step={1}
              value={outage.end_hour}
              onChange={value => onOutages(outages.map((item, i) =>
                i === outageIndex ? { ...item, end_hour: finite(value) } : item))} />
            <Field label="Capacity" type="number" min={0} step={1}
              value={outage.capacity ?? 0}
              onChange={value => onOutages(outages.map((item, i) =>
                i === outageIndex
                  ? { ...item, capacity: Math.round(finite(value)) } : item))} />
            <button type="button"
              onClick={() => onOutages(outages.filter((_, i) => i !== outageIndex))}
              className="mb-1 rounded p-1 text-gray-400 hover:text-red-600">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Readiness({
  good, title, detailText,
}: {
  good: boolean
  title: string
  detailText: string
}) {
  return (
    <div className={`rounded-lg border p-3 ${
      good ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
    }`}>
      <div className="flex gap-2">
        {good
          ? <CheckCircle2 size={15} className="mt-0.5 text-emerald-600" />
          : <AlertTriangle size={15} className="mt-0.5 text-amber-600" />}
        <div>
          <p className="text-xs font-semibold text-gray-800">{title}</p>
          <p className="mt-0.5 text-[11px] text-gray-600">{detailText}</p>
        </div>
      </div>
    </div>
  )
}

function fmtInterval(interval: { mean: number; lower: number; upper: number }) {
  if (Math.abs(interval.upper - interval.lower) < 1e-12) {
    return fmtNum(interval.mean)
  }
  return `${fmtNum(interval.mean)} [${fmtNum(interval.lower)}, ${fmtNum(interval.upper)}]`
}

function fmtCurrencyInterval(
  interval: { mean: number; lower: number; upper: number },
) {
  if (Math.abs(interval.upper - interval.lower) < 1e-12) {
    return `$${fmtNum(interval.mean)}`
  }
  return `$${fmtNum(interval.mean)} [$${fmtNum(interval.lower)}, $${fmtNum(interval.upper)}]`
}
