import { getProjectState, saveNamedProject } from '../../store/project'
import { promptDialog } from './useDialog'
import { toast } from './toast'

/**
 * Prompt for a name and save the current project to browser storage, then toast.
 * Shared by the ProjectBar Save button and the global Ctrl/Cmd-S shortcut so both
 * behave identically.
 */
export async function saveProjectFlow() {
  const name = await promptDialog({
    title: 'Save project',
    label: 'Save project as:',
    defaultValue: getProjectState().projectName || 'Untitled Project',
    confirmLabel: 'Save',
  })
  if (name && name.trim()) {
    saveNamedProject(name.trim())
    toast.success(`Saved "${name.trim()}" to this browser.`)
  }
}
