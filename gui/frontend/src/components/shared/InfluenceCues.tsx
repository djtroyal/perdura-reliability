import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

export type InfluenceKey = string

interface InfluenceContextValue {
  active: InfluenceKey | null
  activate: (key: InfluenceKey) => void
  clear: () => void
  matches: (keys: InfluenceKey | readonly InfluenceKey[]) => boolean
}

const InfluenceContext = createContext<InfluenceContextValue | null>(null)

const keysArray = (keys: InfluenceKey | readonly InfluenceKey[]) =>
  typeof keys === 'string' ? [keys] : keys

/**
 * Owns one ephemeral input-to-result selection for a module or analysis pane.
 * This state is deliberately outside the project store and undo history.
 */
export function InfluenceScope({ children, resetKey, className = '' }: {
  children: ReactNode
  resetKey?: unknown
  className?: string
}) {
  const [active, setActive] = useState<InfluenceKey | null>(null)
  const activate = useCallback((key: InfluenceKey) => setActive(key), [])
  const clear = useCallback(() => setActive(null), [])
  const matches = useCallback((keys: InfluenceKey | readonly InfluenceKey[]) =>
    active != null && keysArray(keys).includes(active), [active])

  useEffect(() => setActive(null), [resetKey])

  const value = useMemo(() => ({ active, activate, clear, matches }),
    [active, activate, clear, matches])

  return (
    <InfluenceContext.Provider value={value}>
      <div
        className={className}
        data-influence-scope
        onPointerDownCapture={event => {
          const target = event.target instanceof Element ? event.target : null
          if (!target?.closest('[data-influence-source],[data-influence-target]')) clear()
        }}
        onKeyDownCapture={event => {
          if (event.key === 'Escape' && active != null) {
            clear()
            event.stopPropagation()
          }
        }}
      >
        {children}
      </div>
    </InfluenceContext.Provider>
  )
}

export function useInfluenceCues() {
  const context = useContext(InfluenceContext)
  return context ?? {
    active: null,
    activate: () => undefined,
    clear: () => undefined,
    matches: () => false,
  }
}

/** Wrap a semantically meaningful input without changing the input itself. */
export function InfluenceSource({ influence, children, className = '', ...props }: {
  influence: InfluenceKey
  children: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  const { active, activate } = useInfluenceCues()
  const selected = active === influence
  return (
    <div
      {...props}
      data-influence-source={influence}
      data-influence-active={selected || undefined}
      onFocusCapture={event => {
        props.onFocusCapture?.(event)
        if (!event.defaultPrevented) activate(influence)
      }}
      onPointerDown={event => {
        props.onPointerDown?.(event)
        if (!event.defaultPrevented) activate(influence)
      }}
      className={`rounded-md transition-[background-color,box-shadow] duration-150 ${
        selected ? 'bg-blue-50/70 ring-1 ring-blue-300' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * Wrap a result region. The overlay is ignored by Perdura's export filters and
 * does not replace warning/pass/fail backgrounds already owned by the result.
 */
export function InfluenceTarget({ influences, children, className = '', rounded = 'rounded-lg', ...props }: {
  influences: InfluenceKey | readonly InfluenceKey[]
  children: ReactNode
  rounded?: string
} & HTMLAttributes<HTMLDivElement>) {
  const { matches } = useInfluenceCues()
  const selected = matches(influences)
  return (
    <div
      {...props}
      data-influence-target={keysArray(influences).join(' ')}
      data-influence-active={selected || undefined}
      className={`relative ${className}`}
    >
      {children}
      {selected && (
        <span
          data-export-ignore
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 z-20 ${rounded} bg-blue-50/15 ring-1 ring-inset ring-blue-400/80 transition-shadow duration-150`}
        />
      )}
    </div>
  )
}

/** Overlay-only variant for table cells and existing positioned containers. */
export function InfluenceOverlay({ influences, rounded = '' }: {
  influences: InfluenceKey | readonly InfluenceKey[]
  rounded?: string
}) {
  const { matches } = useInfluenceCues()
  if (!matches(influences)) return null
  return (
    <span
      data-export-ignore
      data-influence-target={keysArray(influences).join(' ')}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-20 ${rounded} bg-blue-50/20 ring-1 ring-inset ring-blue-400/80`}
    />
  )
}
