interface DefaultWrappedModule {
  default?: unknown
}

/**
 * Resolve the callable exported by react-plotly.js/factory across bundlers.
 *
 * The package is CommonJS with an `__esModule` default export. Vite 8's
 * Rolldown production build can preserve that object behind another default
 * wrapper, while older Vite development builds expose the function directly.
 */
export function resolvePlotlyFactory<T>(moduleValue: unknown): T {
  let candidate = moduleValue
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate === 'function') return candidate as T
    if (candidate == null || typeof candidate !== 'object' || !('default' in candidate)) break
    candidate = (candidate as DefaultWrappedModule).default
  }
  throw new TypeError('react-plotly.js factory export is not callable')
}

/** Plotly treats a present-but-undefined axis key as an axis container. */
export function stripUndefinedPlotLayoutValues<T extends object>(layout: T): T {
  return Object.fromEntries(
    Object.entries(layout).filter(([, value]) => value !== undefined),
  ) as T
}
