import { getProjectState, saveNamedProject, projectExists } from '../../store/project'
import { promptDialog, confirmDialog } from './useDialog'
import { toast } from './toast'

/**
 * Prompt for a name and save the current project to browser storage, then toast.
 * Shared by the ProjectBar Save button and the global Ctrl/Cmd-S shortcut so both
 * behave identically. Confirms before overwriting an existing project, and only
 * reports success if the underlying write succeeded.
 */
export async function saveProjectFlow() {
  const name = await promptDialog({
    title: 'Save project',
    label: 'Save project as:',
    defaultValue: getProjectState().projectName || 'Untitled Project',
    confirmLabel: 'Save',
  })
  const trimmed = name?.trim()
  if (!trimmed) return
  // Guard against silently clobbering a different saved project with the same name.
  if (projectExists(trimmed) && trimmed !== getProjectState().projectName) {
    const ok = await confirmDialog({
      title: 'Overwrite project?',
      body: `A project named "${trimmed}" already exists in this browser. Overwrite it?`,
      confirmLabel: 'Overwrite',
      tone: 'danger',
    })
    if (!ok) return
  }
  if (saveNamedProject(trimmed)) {
    toast.success(`Saved "${trimmed}" to this browser.`)
  }
}
