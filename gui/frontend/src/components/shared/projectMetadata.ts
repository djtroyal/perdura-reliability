/** Format persisted project timestamps consistently in the user's locale. */
export function formatProjectTimestamp(value: string | null | undefined): string {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

/** Native-tooltip text for the global unsaved-changes indicators. */
export function unsavedChangesTitle(
  details: string[],
  lastSavedAt: string | null,
): string {
  const saved = lastSavedAt
    ? `Last saved: ${formatProjectTimestamp(lastSavedAt)}`
    : 'This project has not been saved yet.'
  const changed = details.length
    ? `Unsaved changes in:\n${details.map(detail => `• ${detail}`).join('\n')}`
    : 'The project has unsaved changes.'
  return `${changed}\n\n${saved}\n\nPress Ctrl/Cmd-S or use Save to store the project.`
}
