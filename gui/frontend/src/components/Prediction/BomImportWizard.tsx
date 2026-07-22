import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Save, Settings2, X } from 'lucide-react'
import { PredictionParamValue, PredictionPart } from '../../api/client'
import {
  BOM_FIELD_LABELS, BOM_FIELDS, BomColumnMapping, BomField, BomRegexProfileRevision,
  BomRegexRule, buildBomImportRows, cloneBuiltInsForEditing, createBomRegexProfile,
  detectBomColumns, sha256BomProfile, validateBomRegexRule,
} from './bomImport'
import { BomWorkbook, bomTableFromSheet, detectBomHeaderRow, readBomWorkbook } from './bomSpreadsheet'

export interface BomColumnTemplate {
  id: string
  name: string
  mapping: BomColumnMapping
}

interface Props {
  open: boolean
  standard: string
  categoryLabels: Record<string, string>
  defaultParams: (category: string) => Record<string, PredictionParamValue>
  existingParts: PredictionPart[]
  profiles: BomRegexProfileRevision[]
  templates: BomColumnTemplate[]
  parentOptions: { id: string; label: string }[]
  defaultParentId?: string | null
  onProfilesChange: (profiles: BomRegexProfileRevision[]) => void
  onTemplatesChange: (templates: BomColumnTemplate[]) => void
  onImport: (parts: PredictionPart[], mode: 'append' | 'replace') => void
  onClose: () => void
}

const latestProfiles = (profiles: BomRegexProfileRevision[]) => {
  const latest = new Map<string, BomRegexProfileRevision>()
  for (const profile of profiles) {
    const current = latest.get(profile.id)
    if (!current || profile.revision > current.revision) latest.set(profile.id, profile)
  }
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const blankRule = (): BomRegexRule => ({
  id: `custom-${Date.now().toString(36)}`,
  label: 'Custom component rule',
  kind: 'component',
  enabled: true,
  conditions: [{ field: 'combined', pattern: '', caseInsensitive: true }],
  match: 'all',
  weight: 100,
  family: 'ic',
})

const RULE_FIELDS = [
  'reference_designators', 'part_number', 'manufacturer', 'supplier', 'supplier_part_number',
  'description', 'value', 'package_or_footprint', 'population_status', 'notes', 'combined', 'header',
] as const

const FAMILIES = [
  'ic', 'diode', 'transistor', 'optoelectronic', 'resistor', 'capacitor', 'inductor',
  'transformer', 'relay', 'switch', 'connector', 'pcb', 'crystal', 'fuse', 'rotating', 'filter',
] as const

export default function BomImportWizard(props: Props) {
  const [step, setStep] = useState(0)
  const [workbook, setWorkbook] = useState<BomWorkbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerRow, setHeaderRow] = useState(0)
  const [mapping, setMapping] = useState<BomColumnMapping>({})
  const [autoMap, setAutoMap] = useState(false)
  const [profileKey, setProfileKey] = useState('builtin')
  const [expandRefdes, setExpandRefdes] = useState(false)
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [parentId, setParentId] = useState(props.defaultParentId ?? '')
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({})
  const [excludedRows, setExcludedRows] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [draftProfile, setDraftProfile] = useState<BomRegexProfileRevision | null>(null)
  const [ruleErrors, setRuleErrors] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const profiles = useMemo(() => latestProfiles(props.profiles), [props.profiles])
  const profile = profileKey === 'builtin'
    ? undefined : profiles.find(item => `${item.id}:${item.revision}` === profileKey)
  const table = useMemo(() => workbook
    ? bomTableFromSheet(workbook, sheetIndex, headerRow) : null,
  [workbook, sheetIndex, headerRow])

  useEffect(() => {
    if (!props.open) return
    setParentId(props.defaultParentId ?? '')
  }, [props.defaultParentId, props.open])

  useEffect(() => {
    if (!table) return
    setMapping(detectBomColumns(table.headers, profile))
    setCategoryOverrides({})
  }, [table?.fileName, table?.sheet, table?.headerRow, profileKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const previewRows = useMemo(() => {
    if (!table) return []
    const existingRefdes = new Set(props.existingParts.flatMap(part => part.reference_designators ?? [])
      .map(value => value.toUpperCase()))
    return buildBomImportRows({
      table, mapping, standard: props.standard, profile, autoMap, expandRefdes,
      defaultParams: props.defaultParams, parentId,
    }).map((row, index) => {
      const key = `${row.normalized.sourceRow}:${index}`
      const duplicateRefdes = (row.part.reference_designators ?? [])
        .filter(value => existingRefdes.has(value.toUpperCase()))
      ;(row.part.reference_designators ?? []).forEach(value => existingRefdes.add(value.toUpperCase()))
      if (duplicateRefdes.length) {
        row.warning = [row.warning, `Duplicate RefDes: ${duplicateRefdes.join(', ')}`].filter(Boolean).join(' ')
      }
      const override = categoryOverrides[key]
      if (override) {
        row.part = {
          ...row.part,
          category: override,
          params: { ...props.defaultParams(override) },
          calculation_enabled: row.part.population_status !== 'dnp',
          calculation_exclusion_reason: row.part.population_status === 'dnp'
            ? row.part.calculation_exclusion_reason : undefined,
          bom_mapping: {
            ...row.part.bom_mapping!, status: 'confirmed', source: 'manual',
            confidence: undefined, evidence: ['User selected the component category during import.'],
          },
        }
      }
      return { ...row, key }
    })
  }, [table, mapping, props.standard, profile, autoMap, expandRefdes, props.defaultParams, props.existingParts, parentId, categoryOverrides])

  if (!props.open) return null

  const loadFile = async (file: File) => {
    setBusy(true); setError(null)
    try {
      const loaded = await readBomWorkbook(file)
      setWorkbook(loaded)
      setSheetIndex(0)
      setHeaderRow(detectBomHeaderRow(loaded.sheets[0]?.rows ?? [], profile))
      setStep(1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the electronic BOM.')
    } finally { setBusy(false) }
  }

  const saveTemplate = () => {
    const name = window.prompt('Mapping template name')?.trim()
    if (!name) return
    props.onTemplatesChange([...props.templates, {
      id: `bom-columns-${Date.now().toString(36)}`, name, mapping: { ...mapping },
    }])
  }

  const applyTemplate = (id: string) => {
    const template = props.templates.find(item => item.id === id)
    if (!template || !table) return
    setMapping(Object.fromEntries(Object.entries(template.mapping)
      .filter(([, header]) => header && table.headers.includes(header))))
  }

  const beginProfile = (action: 'supplement' | 'replace' | 'edit') => {
    const created = action === 'edit'
      ? cloneBuiltInsForEditing()
      : { ...createBomRegexProfile(action === 'replace' ? 'Replacement BOM rules' : 'Supplemental BOM rules'), mode: action }
    setDraftProfile(created)
    setRuleErrors([])
    setShowRules(true)
  }

  const editProfile = () => {
    if (!profile) { beginProfile('edit'); return }
    setDraftProfile({
      ...profile,
      revision: profile.revision + 1,
      createdAt: new Date().toISOString(),
      rules: profile.rules.map(rule => ({ ...rule, conditions: rule.conditions.map(condition => ({ ...condition })) })),
    })
    setRuleErrors([])
    setShowRules(true)
  }

  const saveProfile = async () => {
    if (!draftProfile) return
    if (draftProfile.rules.length > 500) {
      setRuleErrors(['A BOM regex profile may contain at most 500 rules.'])
      return
    }
    const errors = draftProfile.rules.flatMap(rule => validateBomRegexRule(rule).map(message => `${rule.label}: ${message}`))
    if (errors.length) { setRuleErrors(errors); return }
    const saved = { ...draftProfile, sha256: await sha256BomProfile(draftProfile) }
    props.onProfilesChange([...props.profiles, saved])
    setProfileKey(`${saved.id}:${saved.revision}`)
    setDraftProfile(null)
    setShowRules(false)
  }

  const updateDraftRule = (index: number, patch: Partial<BomRegexRule>) => {
    if (!draftProfile) return
    setDraftProfile({
      ...draftProfile,
      rules: draftProfile.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    })
  }

  const updateCondition = (index: number, patch: Record<string, unknown>) => {
    if (!draftProfile) return
    const rule = draftProfile.rules[index]
    updateDraftRule(index, { conditions: [{ ...rule.conditions[0], ...patch }] })
  }

  const updateParamsJson = (index: number, value: string) => {
    if (!draftProfile) return
    try {
      const parsed = value.trim() ? JSON.parse(value) : {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Parameters must be an object.')
      updateDraftRule(index, {
        params: Object.fromEntries(Object.entries(parsed).map(([key, entry]) => [
          key, typeof entry === 'object' && entry != null && 'value' in entry
            ? entry : { value: entry as PredictionParamValue },
        ])) as BomRegexRule['params'],
      })
      setRuleErrors([])
    } catch (cause) {
      setRuleErrors([cause instanceof Error ? cause.message : 'Invalid parameter JSON.'])
    }
  }

  const commitImport = async () => {
    if (!table) return
    const selected = previewRows.filter(row => !excludedRows.has(row.key))
    if (!selected.length) { setError('Select at least one BOM row to import.'); return }
    setBusy(true)
    try {
      const hash = await sha256BomProfile(profile)
      const parts = selected.map(row => ({
        ...row.part,
        bom_mapping: row.part.bom_mapping ? {
          ...row.part.bom_mapping,
          rule_profile_sha256: hash,
        } : undefined,
      }))
      props.onImport(parts, mode)
      props.onClose()
    } finally { setBusy(false) }
  }

  const mappedIdentity = mapping.reference_designators || mapping.part_number || mapping.description
  const mappedColumns = Object.values(mapping).filter((value): value is string => Boolean(value))
  const duplicateColumnMappings = [...new Set(mappedColumns.filter((value, index) => mappedColumns.indexOf(value) !== index))]
  const unresolvedCount = previewRows.filter(row => row.part.bom_mapping?.status !== 'confirmed').length

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Import electronic BOM">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><FileSpreadsheet size={17} className="text-blue-600" /> Import Electronic BOM</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">Local parsing · {props.standard} target · automatic model mapping is optional</p>
          </div>
          <button onClick={props.onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={17} /></button>
        </div>

        <div className="flex border-b border-gray-100 bg-gray-50 px-5">
          {['File', 'Columns', 'Classify & import'].map((label, index) => (
            <div key={label} className={`border-b-2 px-4 py-2 text-xs font-medium ${index === step ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-400'}`}>
              {index + 1}. {label}
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle size={14} />{error}</div>}

          {step === 0 && (
            <div className="mx-auto max-w-xl py-10 text-center">
              <FileSpreadsheet size={40} className="mx-auto text-blue-300" />
              <h3 className="mt-3 text-base font-semibold text-gray-800">Choose an exported electronic BOM</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">CSV, TSV, TXT, or XLSX up to 25 MiB. Files remain on this device and formulas or macros are never executed.</p>
              <button onClick={() => inputRef.current?.click()} disabled={busy}
                className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Reading…' : 'Choose BOM file'}
              </button>
              <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = '' }} />
            </div>
          )}

          {step === 1 && workbook && table && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-xs font-medium text-gray-600">Worksheet
                  <select value={sheetIndex} onChange={event => {
                    const next = Number(event.target.value); setSheetIndex(next)
                    setHeaderRow(detectBomHeaderRow(workbook.sheets[next]?.rows ?? [], profile))
                  }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs">
                    {workbook.sheets.map((sheet, index) => <option key={sheet.name} value={index}>{sheet.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">Header row
                  <input type="number" min={1} max={workbook.sheets[sheetIndex]?.rows.length ?? 1} value={headerRow + 1}
                    onChange={event => setHeaderRow(Math.max(0, Number(event.target.value) - 1))}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs" />
                </label>
                <label className="text-xs font-medium text-gray-600">Saved column mapping
                  <div className="mt-1 flex gap-1">
                    <select defaultValue="" onChange={event => applyTemplate(event.target.value)} className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs">
                      <option value="">Choose template…</option>
                      {props.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                    <button onClick={saveTemplate} title="Save current mapping" className="rounded border border-gray-300 px-2 text-gray-500 hover:bg-gray-50"><Save size={13} /></button>
                  </div>
                </label>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-800">Essential field mapping</h3>
                <p className="mb-3 text-[11px] text-gray-500">Perdura proposed mappings from the headers. Change any field that was not detected correctly.</p>
                {duplicateColumnMappings.length > 0 && (
                  <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
                    Each source column can map to only one field. Reassign: {duplicateColumnMappings.join(', ')}.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {BOM_FIELDS.map(field => (
                    <label key={field} className="rounded border border-gray-200 bg-gray-50 p-2 text-[11px] font-medium text-gray-600">
                      {BOM_FIELD_LABELS[field]}
                      <select value={mapping[field] ?? ''} onChange={event => setMapping(current => ({ ...current, [field]: event.target.value || undefined }))}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                        <option value="">Not mapped</option>
                        {table.headers.map(header => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-gray-200">
                <table className="w-full text-[10px]"><thead className="bg-gray-50"><tr>{table.headers.slice(0, 12).map(header => <th key={header} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-gray-600">{header}</th>)}</tr></thead>
                  <tbody>{table.rows.slice(0, 5).map((row, index) => <tr key={index} className="border-t border-gray-100">{table.headers.slice(0, 12).map(header => <td key={header} className="max-w-48 truncate px-2 py-1.5 text-gray-600" title={row[header]}>{row[header]}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {step === 2 && table && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 lg:grid-cols-5">
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 lg:col-span-2">
                  <input type="checkbox" checked={autoMap} onChange={event => setAutoMap(event.target.checked)} />
                  Perform automatic component mapping
                </label>
                <label className="text-[10px] font-medium text-gray-500">Rule profile
                  <select disabled={!autoMap} value={profileKey} onChange={event => setProfileKey(event.target.value)} className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:bg-gray-100">
                    <option value="builtin">Perdura built-in rules</option>
                    {profiles.map(item => <option key={`${item.id}:${item.revision}`} value={`${item.id}:${item.revision}`}>{item.name} · r{item.revision}</option>)}
                  </select>
                </label>
                <label className="text-[10px] font-medium text-gray-500">Row representation
                  <select value={expandRefdes ? 'expand' : 'group'} onChange={event => setExpandRefdes(event.target.value === 'expand')} className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                    <option value="group">Keep BOM lines grouped</option><option value="expand">One part per RefDes</option>
                  </select>
                </label>
                <label className="text-[10px] font-medium text-gray-500">Import behavior
                  <select value={mode} onChange={event => setMode(event.target.value as 'append' | 'replace')} className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                    <option value="append">Append to parts list</option><option value="replace">Replace parts list</option>
                  </select>
                </label>
                <label className="text-[10px] font-medium text-gray-500 lg:col-start-4">Target block
                  <select value={parentId} onChange={event => setParentId(event.target.value)} className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                    <option value="">Top level</option>{props.parentOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <div className="flex items-end gap-1 lg:col-span-2">
                  <button onClick={() => beginProfile('supplement')} className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-100">Supplement rules</button>
                  <button onClick={() => beginProfile('replace')} className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-100">Replace rules</button>
                  <button onClick={editProfile} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-100"><Settings2 size={11} /> Edit active</button>
                </div>
              </div>

              {showRules && draftProfile && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input value={draftProfile.name} onChange={event => setDraftProfile({ ...draftProfile, name: event.target.value })} className="rounded border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold" />
                      <select value={draftProfile.mode} onChange={event => setDraftProfile({ ...draftProfile, mode: event.target.value as 'supplement' | 'replace' })} className="rounded border border-indigo-200 bg-white px-2 py-1 text-xs">
                        <option value="supplement">Supplement built-ins</option><option value="replace">Replace built-ins</option>
                      </select>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setDraftProfile({ ...draftProfile, rules: [...draftProfile.rules, blankRule()] })} className="flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-1 text-[10px]"><Plus size={11} /> Rule</button>
                      <button onClick={() => void saveProfile()} className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white">Save revision</button>
                      <button onClick={() => { setDraftProfile(null); setShowRules(false) }} className="rounded border border-indigo-200 bg-white px-2 py-1 text-[10px]">Cancel</button>
                    </div>
                  </div>
                  <p className="mb-2 text-[10px] text-indigo-700">RE2 syntax is used for bounded matching; lookarounds and backreferences are intentionally unsupported.</p>
                  {ruleErrors.length > 0 && <div className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-700">{ruleErrors.slice(0, 8).map(item => <div key={item}>{item}</div>)}</div>}
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {draftProfile.rules.map((rule, index) => (
                      <div key={`${rule.id}:${index}`} className="grid grid-cols-[24px_1.1fr_90px_120px_2fr_90px_64px_1.2fr_26px] items-center gap-1 rounded border border-indigo-100 bg-white p-1.5 text-[10px]">
                        <input type="checkbox" checked={rule.enabled} onChange={event => updateDraftRule(index, { enabled: event.target.checked })} />
                        <input value={rule.label} onChange={event => updateDraftRule(index, { label: event.target.value })} className="min-w-0 rounded border px-1 py-0.5" title="Rule label" />
                        <select value={rule.kind} onChange={event => updateDraftRule(index, { kind: event.target.value as 'header' | 'component' })} className="rounded border px-1 py-0.5"><option value="component">Component</option><option value="header">Header</option></select>
                        <select value={rule.conditions[0]?.field ?? 'combined'} onChange={event => updateCondition(index, { field: event.target.value })} className="rounded border px-1 py-0.5">{RULE_FIELDS.map(field => <option key={field}>{field}</option>)}</select>
                        <input value={rule.conditions[0]?.pattern ?? ''} onChange={event => updateCondition(index, { pattern: event.target.value })} className="min-w-0 rounded border px-1 py-0.5 font-mono" placeholder="RE2 pattern" />
                        {rule.kind === 'header' ? (
                          <select value={rule.headerField ?? 'description'} onChange={event => updateDraftRule(index, { headerField: event.target.value as BomField })} className="rounded border px-1 py-0.5">{BOM_FIELDS.map(field => <option key={field}>{field}</option>)}</select>
                        ) : (
                          <select value={rule.category ? `category:${rule.category}` : `family:${rule.family ?? 'ic'}`}
                            onChange={event => {
                              const [kind, value] = event.target.value.split(':', 2)
                              updateDraftRule(index, kind === 'category'
                                ? { category: value, family: undefined }
                                : { family: value as typeof FAMILIES[number], category: undefined })
                            }} className="rounded border px-1 py-0.5">
                            <optgroup label="Canonical family">{FAMILIES.map(family => <option key={family} value={`family:${family}`}>{family}</option>)}</optgroup>
                            <optgroup label={`${props.standard} exact category`}>{Object.entries(props.categoryLabels).map(([key, label]) => <option key={key} value={`category:${key}`}>{label}</option>)}</optgroup>
                          </select>
                        )}
                        <input type="number" min={0} max={1000} value={rule.weight} onChange={event => updateDraftRule(index, { weight: Number(event.target.value) })} className="rounded border px-1 py-0.5" title="Evidence weight" />
                        <input defaultValue={JSON.stringify(rule.params ?? {})} onBlur={event => updateParamsJson(index, event.target.value)} className="min-w-0 rounded border px-1 py-0.5 font-mono" title='Parameter actions, e.g. {"pins":{"value":"$<pins>","transform":"integer"}}' placeholder="Parameters JSON" />
                        <button onClick={() => setDraftProfile({ ...draftProfile, rules: draftProfile.rules.filter((_, item) => item !== index) })} className="text-gray-400 hover:text-red-600"><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div><h3 className="text-sm font-semibold text-gray-800">Import preview</h3><p className="text-[11px] text-gray-500">{previewRows.length} output line(s) · {unresolvedCount} will remain excluded until confirmed</p></div>
                {unresolvedCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">Review required after import</span>}
              </div>
              <div className="max-h-[42vh] overflow-auto rounded border border-gray-200">
                <table className="w-full text-[10px]"><thead className="sticky top-0 bg-gray-50"><tr><th className="w-8 px-2 py-2"></th><th className="px-2 py-2 text-left">RefDes</th><th className="px-2 py-2 text-left">Part number</th><th className="px-2 py-2 text-left">Description</th><th className="px-2 py-2 text-left">Mapped model</th><th className="px-2 py-2 text-left">Confidence / evidence</th><th className="px-2 py-2 text-left">Status</th></tr></thead>
                  <tbody>{previewRows.map(row => {
                    const status = row.part.bom_mapping?.status
                    return <tr key={row.key} className="border-t border-gray-100">
                      <td className="px-2 py-1.5"><input type="checkbox" checked={!excludedRows.has(row.key)} onChange={() => setExcludedRows(current => { const next = new Set(current); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next })} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium">{row.part.reference_designators?.join(', ') || '—'}<span className="ml-1 text-gray-400">×{row.part.quantity}</span></td>
                      <td className="max-w-40 truncate px-2 py-1.5" title={row.part.part_number}>{row.part.part_number || '—'}</td>
                      <td className="max-w-56 truncate px-2 py-1.5" title={row.part.description}>{row.part.description || '—'}</td>
                      <td className="px-2 py-1.5"><select value={categoryOverrides[row.key] ?? row.part.category} onChange={event => setCategoryOverrides(current => ({ ...current, [row.key]: event.target.value }))} className="max-w-52 rounded border border-gray-300 px-1 py-0.5"><option value="">Unmapped</option>{Object.entries(props.categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td>
                      <td className="max-w-64 px-2 py-1.5"><span className={`font-semibold ${row.proposal.confidence === 'high' ? 'text-green-700' : row.proposal.confidence === 'medium' ? 'text-amber-700' : 'text-gray-500'}`}>{row.proposal.confidence ?? '—'}</span><span className="ml-1 text-gray-400" title={[...row.proposal.evidence, ...row.proposal.conflicts].join('\n')}>{row.proposal.evidence.slice(0, 2).join(' + ') || 'No automatic evidence'}</span>{row.warning && <div className="text-amber-600">{row.warning}</div>}</td>
                      <td className="px-2 py-1.5">{row.part.population_status === 'dnp' ? <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">DNP</span> : status === 'confirmed' ? <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-green-700"><Check size={9} /> Confirmed</span> : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">{status}</span>}</td>
                    </tr>
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button onClick={() => step === 0 ? props.onClose() : setStep(value => value - 1)} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"><ChevronLeft size={13} /> {step === 0 ? 'Cancel' : 'Back'}</button>
          {step < 2 ? <button onClick={() => setStep(value => value + 1)} disabled={step === 0 ? !workbook : !mappedIdentity || duplicateColumnMappings.length > 0} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Continue <ChevronRight size={13} /></button>
            : <button onClick={() => void commitImport()} disabled={busy || previewRows.length === 0} className="rounded bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">{busy ? 'Importing…' : `Import ${previewRows.length - excludedRows.size} line(s)`}</button>}
        </div>
      </div>
    </div>
  )
}
