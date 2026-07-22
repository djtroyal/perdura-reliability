import type { PredictionPart, PredictionResult } from '../../api/client'

export type PartsStatusFilter =
  | 'all'
  | 'errors'
  | 'review'
  | 'disabled'
  | 'warnings'
  | 'overrides'
  | 'uncomputed'

export interface PartsFilter {
  query: string
  category: string
  status: PartsStatusFilter
}

export const PARTS_STATUS_FILTERS: { value: PartsStatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'errors', label: 'Calculation errors' },
  { value: 'review', label: 'Needs mapping review' },
  { value: 'disabled', label: 'Disabled / excluded' },
  { value: 'warnings', label: 'Has warnings' },
  { value: 'overrides', label: 'Rate overrides' },
  { value: 'uncomputed', label: 'Not yet computed' },
]

const searchableText = (part: PredictionPart, categoryLabel: string): string => [
  part.name,
  part.reference_designators?.join(' '),
  part.part_number,
  part.manufacturer,
  part.supplier,
  part.supplier_part_number,
  part.description,
  part.value,
  part.package_or_footprint,
  part.category,
  categoryLabel,
].filter(value => value != null && value !== '').join(' ').toLocaleLowerCase()

export function partMatchesFilter(
  part: PredictionPart,
  result: PredictionResult | undefined,
  filter: PartsFilter,
  categoryLabel: string,
): boolean {
  const query = filter.query.trim().toLocaleLowerCase()
  if (query && !searchableText(part, categoryLabel).includes(query)) return false
  if (filter.category !== 'all' && part.category !== filter.category) return false

  switch (filter.status) {
    case 'errors':
      return result?.incompatible === true || (!!result?.error && result.excluded !== true)
    case 'review':
      return !!part.bom_mapping && part.bom_mapping.status !== 'confirmed'
    case 'disabled':
      return part.calculation_enabled === false
        || part.population_status === 'dnp'
        || result?.excluded === true
    case 'warnings':
      return (result?.warnings?.length ?? 0) > 0
    case 'overrides':
      return part.failure_rate_override_enabled === true
    case 'uncomputed':
      return result == null
        || (result.failure_rate == null && !result.incompatible && !result.excluded)
    default:
      return true
  }
}

export function partsFilterIsActive(filter: PartsFilter): boolean {
  return filter.query.trim() !== '' || filter.category !== 'all' || filter.status !== 'all'
}
