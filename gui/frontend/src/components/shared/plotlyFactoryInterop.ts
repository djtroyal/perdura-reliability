/** Plotly treats a present-but-undefined axis key as an axis container. */
export function stripUndefinedPlotLayoutValues<T extends object>(layout: T): T {
  return Object.fromEntries(
    Object.entries(layout).filter(([, value]) => value !== undefined),
  ) as T
}
