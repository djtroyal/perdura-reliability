import { useCallback, useMemo } from 'react'
import { useModuleState } from '../../store/project'

export const RELIABILITY_TESTING_TOOLS_SLICE = 'reliabilityTestingTools'

export const RELIABILITY_TESTING_TOOL_KEYS = [
  'accelerationFactor',
  'stepStress',
  'multiStress',
  'halt',
  'parametricBinomial',
  'nonParametricBinomial',
  'expectedFailureTimes',
  'simulation',
  'exponentialPlanner',
  'testDuration',
  'zeroFailureSampleSize',
  'oneProportion',
  'twoProportion',
  'sequentialSampling',
  'goodnessOfFit',
  'ess',
  'hass',
  'burnIn',
] as const

export type ReliabilityTestingToolKey = typeof RELIABILITY_TESTING_TOOL_KEYS[number]
export type ReliabilityTestingToolsState = Record<string, Record<string, unknown>>

export function mergeTestingToolState<T extends object>(
  state: ReliabilityTestingToolsState,
  key: ReliabilityTestingToolKey,
  initial: T,
): T {
  return { ...initial, ...(state[key] as Partial<T> | undefined) }
}

export function updateTestingToolState<T extends object>(
  state: ReliabilityTestingToolsState,
  key: ReliabilityTestingToolKey,
  initial: T,
  update: Partial<T> | ((previous: T) => Partial<T>),
): ReliabilityTestingToolsState {
  const previous = mergeTestingToolState(state, key, initial)
  const patch = typeof update === 'function' ? update(previous) : update
  return { ...state, [key]: { ...previous, ...patch } }
}

/**
 * Project-backed state for a Reliability Testing analysis.
 *
 * Inputs and successful results live in one module slice so they survive both
 * inner-tool switches and unmounting the whole Reliability Testing module.
 * Defaults are merged on read, allowing newly added fields to appear in saved
 * projects without a migration pass.
 */
export function useTestingToolState<T extends object>(
  key: ReliabilityTestingToolKey,
  initial: T,
): [T, (update: Partial<T> | ((previous: T) => Partial<T>)) => void] {
  const [state, setState] = useModuleState<ReliabilityTestingToolsState>(
    RELIABILITY_TESTING_TOOLS_SLICE,
    {},
  )
  const value = useMemo(
    () => mergeTestingToolState(state, key, initial),
    [state, key, initial],
  )
  const patch = useCallback((update: Partial<T> | ((previous: T) => Partial<T>)) => {
    setState(previous => updateTestingToolState(previous, key, initial, update))
  }, [setState, key, initial])
  return [value, patch]
}
