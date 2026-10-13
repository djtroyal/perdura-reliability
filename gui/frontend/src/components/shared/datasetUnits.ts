/** Dataset quantities are independent of the project's lifetime display unit. */
export type QuantityKind = 'time' | 'cycles' | 'distance' | 'pressure' | 'force' | 'dimensionless' | 'custom'
export interface DatasetQuantity { kind: QuantityKind; unit: string }
export const DATASET_UNITS: Record<Exclude<QuantityKind, 'custom'>, Readonly<Record<string, number>>> = {
  time: { seconds: 1, minutes: 60, hours: 3600, days: 86400, weeks: 604800, months: 2629746, years: 31556952 },
  cycles: { cycles: 1 },
  distance: { mm: .001, cm: .01, m: 1, km: 1000, inches: .0254, feet: .3048, miles: 1609.344 },
  pressure: { Pa: 1, kPa: 1000, MPa: 1e6, GPa: 1e9, bar: 1e5, psi: 6894.757293168, ksi: 6894757.293168 },
  force: { N: 1, kN: 1000, MN: 1e6, lbf: 4.4482216152605 },
  dimensionless: { '1': 1 },
}
export function validateDatasetQuantity(value: unknown): DatasetQuantity {
  if (!value || typeof value !== 'object') throw new Error('Choose the dataset quantity and unit.')
  const { kind, unit } = value as DatasetQuantity
  if (typeof unit !== 'string' || !unit.trim()) throw new Error('A quantity unit is required.')
  if (kind === 'custom') return { kind, unit: unit.trim() }
  if (!(kind in DATASET_UNITS) || !Object.prototype.hasOwnProperty.call(DATASET_UNITS[kind], unit)) {
    throw new Error(`Unsupported ${String(kind)} unit: ${unit}.`)
  }
  return { kind, unit }
}
export function quantityFromProjectUnit(unit = 'hours'): DatasetQuantity {
  for (const [kind, units] of Object.entries(DATASET_UNITS)) {
    if (Object.prototype.hasOwnProperty.call(units, unit)) return { kind: kind as QuantityKind, unit }
  }
  return { kind: 'custom', unit: unit.trim() || 'unspecified' }
}
/** Multiply a value in `from` by this factor to express it in `to`. */
export function quantityConversionFactor(from: DatasetQuantity, to: DatasetQuantity): number {
  const a = validateDatasetQuantity(from), b = validateDatasetQuantity(to)
  if (a.kind !== b.kind) throw new Error(`Incompatible quantities: ${a.kind} and ${b.kind}.`)
  if (a.kind === 'custom') {
    if (a.unit !== b.unit) throw new Error('Custom quantities require the exact same unit label.')
    return 1
  }
  return DATASET_UNITS[a.kind][a.unit] / DATASET_UNITS[a.kind][b.unit]
}
