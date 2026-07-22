type LayoutRecord = Record<string, unknown>

function record(value: unknown): LayoutRecord {
  return value && typeof value === 'object' ? value as LayoutRecord : {}
}

function layoutKeys(fullLayout: unknown, pattern: RegExp): string[] {
  return Object.keys(record(fullLayout)).filter(key => pattern.test(key))
}

/**
 * Build a Plotly.relayout payload that restores the authored view. Explicit
 * axis ranges and cameras are restored; otherwise the data are auto-ranged.
 * User annotations and shapes are intentionally untouched.
 */
export function buildPlotViewResetUpdates(
  initialLayout: unknown,
  fullLayout: unknown,
): Record<string, unknown> {
  const initial = record(initialLayout)
  const full = record(fullLayout)
  const updates: Record<string, unknown> = {}

  const axes = new Set([
    ...layoutKeys(full, /^[xy]axis\d*$/),
    ...Object.keys(initial).filter(key => /^[xy]axis\d*$/.test(key)),
  ])
  axes.forEach(axisKey => {
    const authored = record(initial[axisKey])
    const range = authored.range
    if (Array.isArray(range) && range.length >= 2 && authored.autorange !== true) {
      updates[`${axisKey}.range`] = [...range]
      updates[`${axisKey}.autorange`] = authored.autorange ?? false
    } else {
      updates[`${axisKey}.autorange`] = authored.autorange ?? true
    }
  })

  const scenes = new Set([
    ...layoutKeys(full, /^scene\d*$/),
    ...Object.keys(initial).filter(key => /^scene\d*$/.test(key)),
  ])
  scenes.forEach(sceneKey => {
    const authored = record(initial[sceneKey])
    updates[`${sceneKey}.camera`] = authored.camera ?? null
    updates[`${sceneKey}.dragmode`] = authored.dragmode ?? 'orbit'
  })

  updates.dragmode = initial.dragmode ?? 'zoom'
  if (full.legend != null) {
    const authoredLegend = record(initial.legend)
    for (const key of ['x', 'y', 'xanchor', 'yanchor']) {
      updates[`legend.${key}`] = authoredLegend[key] ?? null
    }
  }
  return updates
}
