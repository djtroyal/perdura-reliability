/** Shared identity and navigation contract for analysis result assets. */
export type AssetType = 'plot' | 'table' | 'metrics'

export interface AssetSource {
  /** Store slice that owns the result. */
  module: string
  /** Main application tab. */
  tab: string
  /** Optional module-internal tab. */
  sub?: string
  /** Stable analysis/folio identifier when the module supports analyses. */
  analysisId?: string
  /** Optional result subview understood by the destination module. */
  view?: string
  /** Display-only analysis name retained if the live result is removed. */
  analysisName: string
  /** DOM/result identity used for exact focus after navigation. */
  assetKey: string
}

export interface AssetData {
  plotData?: unknown[]
  plotLayout?: unknown
  tableHeaders?: string[]
  tableRows?: (string | number)[][]
  metrics?: { label: string; value: string }[]
}

export interface AssetDescriptor {
  /** Durable semantic identity. Assigned by enumerateAssets(). */
  id: string
  /** Previous extractor-order identity, retained only to refresh existing report blocks. */
  legacyId?: string
  module: string
  moduleLabel: string
  group: string
  label: string
  type: AssetType
  /** Assigned by enumerateAssets(); optional only while extractors build drafts. */
  source?: AssetSource
  getData: () => AssetData
}

export function cleanAssetIdentity(value: string): string {
  return value.toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/\bbest\b/g, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'result'
}

/** IDs deliberately use analysis IDs rather than mutable analysis names. */
export function makeAssetKey(
  module: string,
  moduleLabel: string,
  analysisId: string,
  type: AssetType,
  label: string,
): string {
  return [
    'asset', cleanAssetIdentity(module), cleanAssetIdentity(moduleLabel), cleanAssetIdentity(analysisId),
    type, cleanAssetIdentity(label),
  ].join(':')
}
