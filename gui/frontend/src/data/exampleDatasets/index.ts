import type { ExportPayload } from '../../store/project'
import generated from './catalog.generated.json'

export interface ExampleDatasetSource {
  id: string
  filename: string
  title: string
  url: string
  rawSha256: string
  normalizedSha256: string
}

export interface ExampleDataset {
  id: string
  title: string
  description: string
  targetModule: string
  targetLabel: string
  targetSlices: string[]
  subtool: string
  category: string
  units: string
  rowCount: number
  variables: string[]
  transformation: string
  source: ExampleDatasetSource
  payload: ExportPayload
}

interface ExampleDatasetCatalog {
  schemaVersion: number
  sourcePage: string
  entries: ExampleDataset[]
}

export const NIST_DATASET_CATALOG = generated as unknown as ExampleDatasetCatalog
export const EXAMPLE_DATASETS = NIST_DATASET_CATALOG.entries

export function exampleDatasetsForModule(moduleKey: string): ExampleDataset[] {
  return EXAMPLE_DATASETS.filter(entry => entry.targetModule === moduleKey)
}
