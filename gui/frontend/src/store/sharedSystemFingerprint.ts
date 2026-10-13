import type { SystemDefinitionModel } from '../api/systemDefinition'
import { sha256FtaText } from '../components/FaultTree/libraryModel.ts'

export function systemInputFingerprint(model: SystemDefinitionModel): string {
  // Diagram geometry and viewport are presentation only.
  const { diagrams: _, name: _name, revision: _revision, ...inputs } = model
  return sha256FtaText(JSON.stringify(inputs))
}
