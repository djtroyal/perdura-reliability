import { getProjectState } from './project'

/** Capture after flushing editors; ordinary input edits do not always increment revision. */
export function captureProjectExportOrigin() {
  const state = getProjectState()
  return { projectId: state.identity.projectId, revision: state.revision, modules: state.modules,
    units: state.units, projectName: state.projectName }
}
export function assertProjectExportOrigin(origin: ReturnType<typeof captureProjectExportOrigin>): void {
  const current = getProjectState()
  if (current.identity.projectId !== origin.projectId || current.revision !== origin.revision
      || current.modules !== origin.modules || current.units !== origin.units || current.projectName !== origin.projectName) {
    throw new Error('The project changed while this export was being prepared. Restart the export to keep its source metadata consistent.')
  }
}
