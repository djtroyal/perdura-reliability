import { RE2JS } from 're2js'
import type { PredictionParamValue, PredictionPart } from '../../api/client'
import { newPredictionPartId } from '../../store/predictionIdentity.ts'

export type BomField =
  | 'reference_designators' | 'quantity' | 'part_number' | 'manufacturer'
  | 'supplier_part_number' | 'description' | 'value'
  | 'package_or_footprint' | 'population_status' | 'notes'

export const BOM_FIELD_LABELS: Record<BomField, string> = {
  reference_designators: 'Reference designators',
  quantity: 'Quantity',
  part_number: 'Part number',
  manufacturer: 'Manufacturer',
  supplier_part_number: 'Supplier part number',
  description: 'Description',
  value: 'Value / rating',
  package_or_footprint: 'Package / footprint',
  population_status: 'Populate / DNP status',
  notes: 'Notes',
}

export const BOM_FIELDS = Object.keys(BOM_FIELD_LABELS) as BomField[]

export type BomRuleField = BomField | 'combined' | 'header'
export type CanonicalFamily =
  | 'ic' | 'diode' | 'transistor' | 'optoelectronic' | 'resistor'
  | 'capacitor' | 'inductor' | 'transformer' | 'relay' | 'switch'
  | 'connector' | 'pcb' | 'crystal' | 'fuse' | 'rotating' | 'filter'

export interface BomRegexCondition {
  field: BomRuleField
  pattern: string
  caseInsensitive?: boolean
  negate?: boolean
}

export interface BomParameterAction {
  value: PredictionParamValue | string
  transform?: 'text' | 'integer' | 'number' | 'engineering'
}

export interface BomRegexRule {
  id: string
  label: string
  kind: 'header' | 'component'
  enabled: boolean
  conditions: BomRegexCondition[]
  match: 'all' | 'any'
  weight: number
  terminal?: boolean
  headerField?: BomField
  family?: CanonicalFamily
  category?: string
  categories?: Record<string, string>
  params?: Record<string, BomParameterAction>
}

export interface BomRegexProfileRevision {
  id: string
  name: string
  revision: number
  mode: 'supplement' | 'replace'
  createdAt: string
  rules: BomRegexRule[]
  sha256?: string
}

export interface ParsedBomTable {
  fileName: string
  sheet?: string
  headerRow: number
  headers: string[]
  rows: Record<string, string>[]
  warnings: string[]
}

export interface BomColumnMapping {
  [field: string]: string | undefined
}

export interface NormalizedBomRow {
  sourceRow: number
  values: Partial<Record<BomField, string>>
  attributes: Record<string, string>
}

export interface BomMappingProposal {
  category?: string
  family?: CanonicalFamily
  params: Record<string, PredictionParamValue>
  confidence?: 'high' | 'medium' | 'low'
  score: number
  evidence: string[]
  matchedRuleIds: string[]
  conflicts: string[]
}

export interface BomImportRow {
  normalized: NormalizedBomRow
  part: PredictionPart
  proposal: BomMappingProposal
  include: boolean
  warning?: string
}

const headerRule = (id: string, field: BomField, pattern: string): BomRegexRule => ({
  id, label: BOM_FIELD_LABELS[field], kind: 'header', enabled: true,
  conditions: [{ field: 'header', pattern, caseInsensitive: true }],
  match: 'all', weight: 100, headerField: field,
})

const componentRule = (
  id: string,
  label: string,
  field: BomRuleField,
  pattern: string,
  family: CanonicalFamily,
  weight: number,
  params?: Record<string, BomParameterAction>,
): BomRegexRule => ({
  id, label, kind: 'component', enabled: true,
  conditions: [{ field, pattern, caseInsensitive: true }],
  match: 'all', weight, family, params,
})

export const BUILTIN_BOM_RULES: BomRegexRule[] = [
  headerRule('hdr-refdes', 'reference_designators', '^(ref(erence)?[ _-]?(des(ignator)?s?)?|designators?|refs?)$'),
  headerRule('hdr-qty', 'quantity', '^(qty|quantity|count|units?)$'),
  headerRule('hdr-mpn', 'part_number', '^(mfr|manufacturer)?[ _-]?(part[ _-]?)?(number|no|#|pn|p/n|mpn)$'),
  headerRule('hdr-mfr', 'manufacturer', '^(manufacturer|mfr|maker|brand)$'),
  headerRule('hdr-mfr-supplier-alias', 'manufacturer', '^(?:#column name error:\\s*[\'\"]?\\s*)?(supplier|vendor|distributor)(?:\\s+\\d+)?$'),
  headerRule('hdr-supplier-pn', 'supplier_part_number', '^(?:#column name error:\\s*[\'\"]?\\s*)?(supplier|vendor|distributor)[ _-]?(part[ _-]?)?(number|no|#|pn|sku)(?:\\s+\\d+)?$'),
  headerRule('hdr-description', 'description', '^(description|desc|component|item[ _-]?description)$'),
  headerRule('hdr-value', 'value', '^(value|rating|component[ _-]?value)$'),
  headerRule('hdr-package', 'package_or_footprint', '^(package|footprint|case|land[ _-]?pattern)$'),
  headerRule('hdr-populate', 'population_status', '^(populate|population|fitted|mount|dnp|dni|stuff)$'),
  headerRule('hdr-notes', 'notes', '^(notes?|comments?|remarks?)$'),

  { ...componentRule('ref-ferrite', 'Ferrite bead designator', 'reference_designators', '(^|[,;\\s])FB\\d+', 'inductor', 95), categories: { 'MIL-HDBK-217F': 'ferrite_bead' } },
  componentRule('ref-resistor', 'Resistor designator', 'reference_designators', '(^|[,;\\s])(R|RT)\\d+', 'resistor', 85),
  componentRule('ref-capacitor', 'Capacitor designator', 'reference_designators', '(^|[,;\\s])C\\d+', 'capacitor', 85),
  componentRule('ref-inductor', 'Inductor designator', 'reference_designators', '(^|[,;\\s])L\\d+', 'inductor', 85),
  componentRule('ref-transformer', 'Transformer designator', 'reference_designators', '(^|[,;\\s])(T|XFMR)\\d+', 'transformer', 90),
  componentRule('ref-opto', 'Optoelectronic designator', 'reference_designators', '(^|[,;\\s])(LED|DS)\\d+', 'optoelectronic', 90),
  componentRule('ref-diode', 'Diode designator', 'reference_designators', '(^|[,;\\s])(D|CR)\\d+', 'diode', 80),
  componentRule('ref-transistor', 'Transistor designator', 'reference_designators', '(^|[,;\\s])Q\\d+', 'transistor', 85),
  componentRule('ref-ic', 'Integrated circuit designator', 'reference_designators', '(^|[,;\\s])(U|IC)\\d+', 'ic', 85),
  componentRule('ref-connector', 'Connector designator', 'reference_designators', '(^|[,;\\s])(J|CON|CN)\\d+', 'connector', 80),
  componentRule('ref-relay', 'Relay designator', 'reference_designators', '(^|[,;\\s])K\\d+', 'relay', 85),
  componentRule('ref-switch', 'Switch designator', 'reference_designators', '(^|[,;\\s])(S|SW)\\d+', 'switch', 80),
  componentRule('ref-fuse', 'Fuse designator', 'reference_designators', '(^|[,;\\s])(F|FU)\\d+', 'fuse', 85),
  componentRule('ref-crystal', 'Crystal or oscillator designator', 'reference_designators', '(^|[,;\\s])(Y|X|XTAL)\\d+', 'crystal', 80),
  {
    id: 'ref-motor-corroborated', label: 'Motor designator and description', kind: 'component', enabled: true,
    conditions: [
      { field: 'reference_designators', pattern: '(^|[,;\\s])M\\d+', caseInsensitive: true },
      { field: 'description', pattern: '\\b(motor|fan|blower)\\b', caseInsensitive: true },
    ],
    match: 'all', weight: 75, family: 'rotating',
  },

  { ...componentRule('desc-ferrite', 'Ferrite bead description', 'description', '\\b(ferrite[ -]?bead|emi[ -]?bead)\\b', 'inductor', 100), categories: { 'MIL-HDBK-217F': 'ferrite_bead' } },
  componentRule('desc-resistor', 'Resistor description', 'description', '\\b(e?res|resistor|resistive|thermistor|potentiometer)\\b', 'resistor', 75),
  componentRule('desc-capacitor', 'Capacitor description', 'description', '\\b(cap|capacitor|ceramic[ -]?cap|mlcc|tantalum|electrolytic)\\b', 'capacitor', 75),
  componentRule('desc-transformer', 'Transformer description', 'description', '\\b(transformer|xfmr)\\b', 'transformer', 90),
  componentRule('desc-inductor', 'Inductor description', 'description', '\\b(inductor|choke|coil)\\b', 'inductor', 75),
  { ...componentRule('desc-mosfet', 'MOSFET description', 'description', '\\b(mosfet|power fet|field[ -]?effect)\\b', 'transistor', 100, { fet_type: { value: 'mosfet' } }), categories: { 'MIL-HDBK-217F': 'fet', Telcordia: 'transistor_fet' } },
  {
    id: 'desc-mosfet-q-corroborated', label: 'MOSFET description with transistor designator', kind: 'component', enabled: true,
    conditions: [
      { field: 'reference_designators', pattern: '(^|[,;\\s])Q\\d+', caseInsensitive: true },
      { field: 'description', pattern: '\\b(mosfet|power fet|field[ -]?effect)\\b', caseInsensitive: true },
    ],
    match: 'all', weight: 65, family: 'transistor',
    categories: { 'MIL-HDBK-217F': 'fet', Telcordia: 'transistor_fet' },
  },
  componentRule('desc-bjt', 'Bipolar transistor description', 'description', '\\b(bjt|bipolar|npn|pnp)\\b', 'transistor', 95),
  componentRule('desc-diode', 'Diode description', 'description', '\\b(diode|rectifier|schottky|zener|tvs)\\b', 'diode', 75),
  componentRule('desc-opto', 'Optoelectronic description', 'description', '\\b(led|opto(coupler|isolator)|photodiode|phototransistor|display)\\b', 'optoelectronic', 95),
  {
    id: 'desc-led-d-corroborated', label: 'LED description with diode designator', kind: 'component', enabled: true,
    conditions: [
      { field: 'reference_designators', pattern: '(^|[,;\\s])D\\d+', caseInsensitive: true },
      { field: 'description', pattern: '\\bled\\b', caseInsensitive: true },
    ],
    match: 'all', weight: 65, family: 'optoelectronic',
  },
  componentRule('desc-ic-memory', 'Memory IC description', 'description', '\\b(memory|sram|dram|eeprom|flash|rom)\\b', 'ic', 100, { device_type: { value: 'memory' } }),
  componentRule('desc-ic', 'Integrated circuit description', 'description', '\\b(ic|integrated circuit|microcontroller|microprocessor|fpga|op[ -]?amp|logic)\\b', 'ic', 70),
  {
    id: 'desc-ic-functional-corroborated', label: 'IC designator and functional description', kind: 'component', enabled: true,
    conditions: [
      { field: 'reference_designators', pattern: '(^|[,;\\s])(U|IC)\\d+', caseInsensitive: true },
      { field: 'description', pattern: '\\b(ldo|regulator|dc[ -]?dc|converter|adc|dac|accelerometer|digital[ -]?isolator|sequencer|current[ -]?monitor|sensor|controller|amplifier|transceiver)\\b', caseInsensitive: true },
    ],
    match: 'all', weight: 75, family: 'ic',
  },
  componentRule('desc-connector', 'Connector description', 'description', '\\b(conn|connector|hdr|header|receptacle|rcpt|plug|socket)\\b', 'connector', 75),
  {
    id: 'ref-p-connector-corroborated', label: 'P-designator connector description', kind: 'component', enabled: true,
    conditions: [
      { field: 'reference_designators', pattern: '(^|[,;\\s])P\\d+', caseInsensitive: true },
      { field: 'description', pattern: '\\b(conn|connector|hdr|header|receptacle|rcpt|plug|socket)\\b', caseInsensitive: true },
    ],
    match: 'all', weight: 80, family: 'connector',
  },
  componentRule('desc-relay', 'Relay description', 'description', '\\b(relay|contactor)\\b', 'relay', 85),
  componentRule('desc-switch', 'Switch description', 'description', '\\b(switch|pushbutton|circuit breaker)\\b', 'switch', 70),
  componentRule('desc-fuse', 'Fuse description', 'description', '\\b(fuse|fusible)\\b', 'fuse', 90),
  componentRule('desc-crystal', 'Crystal or oscillator description', 'description', '\\b(crystal|oscillator|xtal|tcxo|ocxo)\\b', 'crystal', 80),
  componentRule('desc-filter', 'Electronic filter description', 'description', '\\b(filter|diplexer|multiplexer)\\b', 'filter', 75),
  componentRule('desc-motor', 'Motor description', 'description', '\\b(motor|fan|blower)\\b', 'rotating', 75),

  componentRule('pn-diode', 'JEDEC diode part number', 'part_number', '^1N\\d+', 'diode', 70),
  componentRule('pn-transistor', 'JEDEC transistor part number', 'part_number', '^2N\\d+', 'transistor', 70),
  componentRule('pn-logic-ic', 'Common logic IC part number', 'part_number', '^(SN)?(54|74)[A-Z0-9-]+', 'ic', 60, { device_type: { value: 'digital' } }),
]

export const BUILTIN_BOM_PROFILE_ID = 'perdura-bom-defaults'
export const BUILTIN_BOM_PROFILE_REVISION = 2

export const createBomRegexProfile = (name = 'Project BOM mapping'): BomRegexProfileRevision => ({
  id: `bom-rules-${Date.now().toString(36)}`,
  name,
  revision: 1,
  mode: 'supplement',
  createdAt: new Date().toISOString(),
  rules: [],
})

const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')

const re2Flags = (condition: BomRegexCondition) =>
  condition.caseInsensitive ? RE2JS.CASE_INSENSITIVE : 0

export function validateBomRegexRule(rule: BomRegexRule): string[] {
  const errors: string[] = []
  if (!rule.id.trim()) errors.push('Rule ID is required.')
  if (!rule.label.trim()) errors.push('Rule label is required.')
  if (!rule.conditions.length) errors.push('At least one condition is required.')
  if (!Number.isFinite(rule.weight) || rule.weight < 0 || rule.weight > 1000) {
    errors.push('Weight must be between 0 and 1000.')
  }
  for (const condition of rule.conditions) {
    if (!condition.pattern || condition.pattern.length > 512) {
      errors.push('Every regex must contain 1–512 characters.')
      continue
    }
    try {
      RE2JS.compile(condition.pattern, re2Flags(condition))
    } catch (error) {
      errors.push(`Invalid RE2 pattern: ${error instanceof Error ? error.message : 'unsupported syntax'}`)
    }
  }
  if (rule.kind === 'header' && !rule.headerField) errors.push('Header rules need a destination field.')
  if (rule.kind === 'component' && !rule.family && !rule.category) errors.push('Component rules need a family or category.')
  return errors
}

function conditionsMatch(
  rule: BomRegexRule,
  source: Partial<Record<BomRuleField, string>>,
): { matches: boolean; captures: Record<string, string> } {
  const captures: Record<string, string> = {}
  const outcomes = rule.conditions.map(condition => {
    const input = normalize(source[condition.field]).slice(0, 4096)
    try {
      const compiled = RE2JS.compile(condition.pattern, re2Flags(condition))
      const match = compiled.exec(input) as (RegExpMatchArray & { groups?: Record<string, string> }) | null
      if (match?.groups) Object.assign(captures, match.groups)
      const found = match != null
      return condition.negate ? !found : found
    } catch {
      return false
    }
  })
  return {
    matches: rule.match === 'all' ? outcomes.every(Boolean) : outcomes.some(Boolean),
    captures,
  }
}

function effectiveRules(profile?: BomRegexProfileRevision): BomRegexRule[] {
  const custom = (profile?.rules ?? []).filter(rule => rule.enabled)
  return profile?.mode === 'replace'
    ? custom
    : [...custom, ...BUILTIN_BOM_RULES.filter(rule => rule.enabled)]
}

export function detectBomColumns(headers: string[], profile?: BomRegexProfileRevision): BomColumnMapping {
  const result: BomColumnMapping = {}
  const used = new Set<string>()
  for (const rule of effectiveRules(profile).filter(rule => rule.kind === 'header')) {
    if (!rule.headerField || result[rule.headerField]) continue
    const match = headers.find(header => !used.has(header) && conditionsMatch(rule, { header }).matches)
    if (match) {
      result[rule.headerField] = match
      used.add(match)
    }
  }
  return result
}

export function splitReferenceDesignators(value: string): string[] {
  const compactRange = /^([A-Za-z]+)(\d+)\s*[-–]\s*([A-Za-z]*)(\d+)$/
  const out: string[] = []
  for (const token of value.split(/[,;\s]+/).map(v => v.trim()).filter(Boolean)) {
    const range = token.match(compactRange)
    if (range && (!range[3] || range[1].toUpperCase() === range[3].toUpperCase())) {
      const start = Number(range[2]); const end = Number(range[4])
      if (end >= start && end - start <= 10000) {
        for (let n = start; n <= end; n += 1) out.push(`${range[1].toUpperCase()}${n}`)
        continue
      }
    }
    out.push(token.toUpperCase())
  }
  return [...new Set(out)]
}

export function normalizeBomRows(
  table: ParsedBomTable,
  mapping: BomColumnMapping,
): NormalizedBomRow[] {
  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean))
  return table.rows.map((row, index) => {
    const values: Partial<Record<BomField, string>> = {}
    for (const field of BOM_FIELDS) {
      const header = mapping[field]
      if (header) values[field] = normalize(row[header])
    }
    const attributes = Object.fromEntries(Object.entries(row)
      .filter(([header, value]) => !mappedHeaders.has(header) && normalize(value))
      .slice(0, 100)
      .map(([header, value]) => [header.slice(0, 256), normalize(value).slice(0, 4096)]))
    return { sourceRow: table.headerRow + index + 1, values, attributes }
  })
}

const CATEGORY_BY_STANDARD: Record<string, Partial<Record<CanonicalFamily, string>>> = {
  'MIL-HDBK-217F': {
    ic: 'microcircuit', diode: 'diode', transistor: 'bjt', optoelectronic: 'optoelectronic',
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor_coil', transformer: 'transformer',
    relay: 'relay', switch: 'switch', connector: 'connector', pcb: 'pth_assembly', crystal: 'crystal',
    fuse: 'fuse', rotating: 'motor', filter: 'filter',
  },
  Telcordia: {
    ic: 'ic_digital', diode: 'diode', transistor: 'transistor_bjt', resistor: 'resistor',
    capacitor: 'capacitor', inductor: 'inductor', transformer: 'transformer', relay: 'relay',
    switch: 'switch', connector: 'connector', pcb: 'pcb', crystal: 'crystal', fuse: 'fuse',
  },
  '217Plus': {
    ic: 'microcircuit', diode: 'discrete_semiconductor', transistor: 'discrete_semiconductor',
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor', transformer: 'inductor',
    relay: 'relay', switch: 'switch', connector: 'connector', pcb: 'pcb', crystal: 'crystal',
    fuse: 'fuse', rotating: 'rotating',
  },
  FIDES: {
    ic: 'ic', diode: 'discrete', transistor: 'discrete', resistor: 'passive_resistor',
    capacitor: 'passive_capacitor', inductor: 'passive_inductor', transformer: 'passive_inductor',
    relay: 'relay', switch: 'switch', connector: 'connector', pcb: 'pcb', crystal: 'crystal',
  },
  'EPRD-2014': {
    ic: 'eprd_microcircuit', diode: 'eprd_diode', transistor: 'eprd_transistor',
    optoelectronic: 'eprd_optoelectronic', resistor: 'eprd_resistor', capacitor: 'eprd_capacitor',
    inductor: 'eprd_inductor', transformer: 'eprd_inductor', relay: 'eprd_relay',
    switch: 'eprd_switch', connector: 'eprd_connector',
  },
  'NPRD-2023': { rotating: 'nprd_motor', relay: 'nprd_relay', switch: 'nprd_switch', connector: 'nprd_connector' },
  NSWC: { rotating: 'electric_motor', filter: 'filter_mech' },
}

function transformAction(action: BomParameterAction, captures: Record<string, string>): PredictionParamValue | undefined {
  let value: unknown = action.value
  if (typeof value === 'string') {
    value = value.replace(/\$<([A-Za-z][A-Za-z0-9_]*)>/g, (_, name: string) => captures[name] ?? '')
  }
  if (!action.transform || action.transform === 'text') return String(value)
  const raw = String(value).trim()
  if (action.transform === 'integer') {
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (action.transform === 'number') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const engineering = raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([pnumkKMGTµ]?)/)
  if (!engineering) return undefined
  const scale: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, '': 1 }
  return Number(engineering[1]) * (scale[engineering[2]] ?? 1)
}

export function classifyBomRow(
  row: NormalizedBomRow,
  standard: string,
  profile?: BomRegexProfileRevision,
): BomMappingProposal {
  const source: Partial<Record<BomRuleField, string>> = { ...row.values }
  source.combined = BOM_FIELDS.map(field => row.values[field] ?? '').join(' | ')
  const candidates = new Map<string, {
    score: number
    family?: CanonicalFamily
    evidence: string[]
    matchedRuleIds: string[]
    params: Record<string, PredictionParamValue>
    parameterKeys: Set<string>
  }>()
  let terminalCategory: string | undefined

  for (const rule of effectiveRules(profile).filter(rule => rule.kind === 'component')) {
    const match = conditionsMatch(rule, source)
    if (!match.matches) continue
    const category = rule.categories?.[standard] ?? rule.category
      ?? (rule.family ? CATEGORY_BY_STANDARD[standard]?.[rule.family] : undefined)
    if (!category) continue
    const candidate = candidates.get(category) ?? {
      score: 0,
      family: rule.family,
      evidence: [],
      matchedRuleIds: [],
      params: {},
      parameterKeys: new Set<string>(),
    }
    candidate.score += rule.weight
    candidate.family ??= rule.family
    candidate.evidence.push(rule.label)
    candidate.matchedRuleIds.push(rule.id)
    for (const [key, action] of Object.entries(rule.params ?? {})) {
      if (candidate.parameterKeys.has(key)) continue
      const value = transformAction(action, match.captures)
      if (value !== undefined) {
        candidate.params[key] = value
        candidate.parameterKeys.add(key)
      }
    }
    candidates.set(category, candidate)
    if (rule.terminal) { terminalCategory = category; break }
  }

  const ranked = [...candidates.entries()]
    .map(([category, candidate]) => [category, candidate.score] as const)
    .sort((a, b) => b[1] - a[1])
  const category = terminalCategory ?? ranked[0]?.[0]
  const selected = category ? candidates.get(category) : undefined
  const score = selected?.score ?? 0
  const runnerUp = ranked.find(([candidate]) => candidate !== category)?.[1] ?? 0
  const margin = score - runnerUp
  const conflicts = ranked.slice(1).filter(([, candidateScore]) => candidateScore >= score - 20)
    .map(([candidate, candidateScore]) => `${candidate} also scored ${candidateScore}`)
  const confidence = !category ? undefined
    : score >= 150 && margin >= 40 ? 'high'
      : score >= 80 && margin >= 20 ? 'medium' : 'low'
  return {
    category,
    family: selected?.family,
    params: selected?.params ?? {},
    confidence,
    score,
    evidence: selected?.evidence ?? [],
    matchedRuleIds: selected?.matchedRuleIds ?? [],
    conflicts,
  }
}

const parseQuantity = (value?: string) => {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function isDnp(value?: string): boolean {
  return /^(dnp|dni|dnf|do not (populate|install|fit)|not fitted|no)$/i.test(normalize(value))
}

export function buildBomImportRows(args: {
  table: ParsedBomTable
  mapping: BomColumnMapping
  standard: string
  profile?: BomRegexProfileRevision
  autoMap: boolean
  expandRefdes: boolean
  defaultParams: (category: string) => Record<string, PredictionParamValue>
  parentId?: string | null
  ruleProfileSha256?: string
}): BomImportRow[] {
  const normalizedRows = normalizeBomRows(args.table, args.mapping)
  const importedAt = new Date().toISOString()
  const out: BomImportRow[] = []
  for (const normalized of normalizedRows) {
    const proposal = args.autoMap
      ? classifyBomRow(normalized, args.standard, args.profile)
      : { params: {}, score: 0, evidence: [], matchedRuleIds: [], conflicts: [] }
    const refdes = splitReferenceDesignators(normalized.values.reference_designators ?? '')
    const quantity = parseQuantity(normalized.values.quantity)
    const dnp = isDnp(normalized.values.population_status)
    const groups = args.expandRefdes && refdes.length ? refdes.map(item => [item]) : [refdes]
    for (const designators of groups) {
      const status = proposal.category ? 'provisional' : 'unmapped'
      const category = proposal.category ?? ''
      const defaults = category ? args.defaultParams(category) : {}
      const inferredParams = Object.fromEntries(Object.entries(proposal.params)
        .filter(([key]) => Object.prototype.hasOwnProperty.call(defaults, key)))
      const ignoredParams = Object.keys(proposal.params)
        .filter(key => !Object.prototype.hasOwnProperty.call(defaults, key))
      if (ignoredParams.length) {
        proposal.conflicts.push(`Ignored parameters not defined by ${category}: ${ignoredParams.join(', ')}`)
      }
      const part: PredictionPart = {
        id: newPredictionPartId(),
        category,
        name: normalized.values.description || undefined,
        reference_designators: designators,
        quantity: args.expandRefdes && designators.length ? 1 : quantity,
        part_number: normalized.values.part_number || undefined,
        manufacturer: normalized.values.manufacturer || undefined,
        supplier_part_number: normalized.values.supplier_part_number || undefined,
        description: normalized.values.description || undefined,
        value: normalized.values.value || undefined,
        package_or_footprint: normalized.values.package_or_footprint || undefined,
        population_status: dnp ? 'dnp' : normalized.values.population_status ? 'populate' : 'unknown',
        notes: normalized.values.notes || undefined,
        bom_attributes: normalized.attributes,
        bom_source: {
          file_name: args.table.fileName,
          sheet: args.table.sheet,
          source_row: normalized.sourceRow,
          imported_at: importedAt,
        },
        bom_mapping: {
          status,
          source: args.autoMap ? 'perdura' : 'manual',
          target_standard: args.standard,
          confidence: proposal.confidence,
          score: proposal.score,
          evidence: proposal.evidence,
          matched_rule_ids: proposal.matchedRuleIds,
          rule_profile_id: args.profile?.id ?? BUILTIN_BOM_PROFILE_ID,
          rule_profile_revision: args.profile?.revision ?? BUILTIN_BOM_PROFILE_REVISION,
          rule_profile_sha256: args.ruleProfileSha256,
        },
        calculation_enabled: false,
        calculation_exclusion_reason: dnp
          ? 'This BOM line is marked do-not-populate (DNP).'
          : 'Confirm the imported component mapping before calculation.',
        params: category ? { ...defaults, ...inferredParams } : {},
        apply_vita: null,
        environment: null,
        parentId: args.parentId || null,
      }
      out.push({
        normalized,
        part,
        proposal,
        include: true,
        warning: [
          !args.mapping.quantity ? 'Quantity was not mapped; defaulted to 1.' : '',
          refdes.length && quantity !== refdes.length
            ? `Quantity ${quantity} differs from ${refdes.length} parsed designators.` : '',
        ].filter(Boolean).join(' ') || undefined,
      })
    }
  }
  return out
}

export async function sha256BomProfile(profile?: BomRegexProfileRevision): Promise<string | undefined> {
  const canonical = JSON.stringify({
    id: profile?.id ?? BUILTIN_BOM_PROFILE_ID,
    revision: profile?.revision ?? BUILTIN_BOM_PROFILE_REVISION,
    mode: profile?.mode ?? 'replace',
    rules: profile ? effectiveRules(profile) : BUILTIN_BOM_RULES,
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function cloneBuiltInsForEditing(name = 'Edited Perdura BOM rules'): BomRegexProfileRevision {
  return {
    id: `bom-rules-${Date.now().toString(36)}`,
    name,
    revision: 1,
    mode: 'replace',
    createdAt: new Date().toISOString(),
    rules: BUILTIN_BOM_RULES.map(rule => ({
      ...rule,
      conditions: rule.conditions.map(condition => ({ ...condition })),
      params: rule.params ? Object.fromEntries(Object.entries(rule.params).map(([key, action]) => [key, { ...action }])) : undefined,
    })),
  }
}
