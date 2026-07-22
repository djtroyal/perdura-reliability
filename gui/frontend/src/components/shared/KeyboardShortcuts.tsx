import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore, type ReactNode,
} from 'react'
import { Command, CornerDownLeft, Keyboard, Search, X } from 'lucide-react'
import { useFocusTrap } from './useDialog'
import {
  formatShortcut, isApplePlatform, isEditableTarget, matchesShortcut, scopePriority,
  type ShortcutBinding, type ShortcutScope,
} from './shortcutCore'

export interface ShortcutCommand {
  id: string
  label: string
  category: string
  description?: string
  keywords?: string[]
  bindings?: ShortcutBinding[]
  scope?: ShortcutScope
  handler: () => void | Promise<void>
  enabled?: boolean | (() => boolean)
  disabledReason?: string | (() => string)
  allowInEditable?: boolean
  when?: () => boolean
  /** Additional focus predicate used only for key dispatch (palette visibility is unchanged). */
  keyWhen?: () => boolean
}

type PaletteMode = 'commands' | 'shortcuts'
type RegistryEntry = { owner: symbol; sequence: number; getCommands: () => ShortcutCommand[] }

let sequence = 0
let registry: RegistryEntry[] = []
let snapshot: RegistryEntry[] = []
const listeners = new Set<() => void>()

function emitRegistry() {
  snapshot = [...registry]
  listeners.forEach(listener => listener())
}

function register(owner: symbol, getCommands: () => ShortcutCommand[]) {
  registry.push({ owner, sequence: sequence++, getCommands })
  emitRegistry()
  return () => {
    registry = registry.filter(entry => entry.owner !== owner)
    emitRegistry()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() { return snapshot }

function resolve(value: boolean | (() => boolean) | undefined, fallback: boolean): boolean {
  try { return typeof value === 'function' ? value() : (value ?? fallback) }
  catch { return false }
}

function reason(command: ShortcutCommand): string | undefined {
  try {
    return typeof command.disabledReason === 'function'
      ? command.disabledReason()
      : command.disabledReason
  } catch { return 'Unavailable in the current context' }
}

function available(command: ShortcutCommand): boolean {
  return resolve(command.when, true) && resolve(command.enabled, true)
}

function flatten(entries: RegistryEntry[]): Array<ShortcutCommand & { sequence: number }> {
  const commands: Array<ShortcutCommand & { sequence: number }> = []
  for (const entry of entries) {
    try {
      for (const command of entry.getCommands()) commands.push({ ...command, sequence: entry.sequence })
    } catch { /* A disappearing lazy module should not break global shortcuts. */ }
  }
  return commands
}

interface ShortcutContextValue {
  openPalette: (mode?: PaletteMode) => void
  closePalette: () => void
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null)
const fallbackShortcutContext: ShortcutContextValue = {
  openPalette: () => {},
  closePalette: () => {},
}

export function useShortcutPalette() {
  return useContext(ShortcutContext) ?? fallbackShortcutContext
}

/** Register commands owned by the currently mounted module or canvas. */
export function useShortcuts(commands: ShortcutCommand[]) {
  const ownerRef = useRef(Symbol('shortcut-owner'))
  const commandsRef = useRef(commands)
  commandsRef.current = commands
  useEffect(() => register(ownerRef.current, () => commandsRef.current), [])
  useEffect(() => { emitRegistry() }, [commands])
}

export function useShortcut(command: ShortcutCommand) {
  useShortcuts([command])
}

function findPrimaryAction(): HTMLButtonElement | null {
  if (typeof document === 'undefined') return null
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>('main [data-shortcut-primary]'))
    .filter(button => {
    const style = window.getComputedStyle(button)
    return style.display !== 'none' && style.visibility !== 'hidden' && button.getClientRects().length > 0
    })
    .sort((left, right) => Number(right.dataset.shortcutPriority ?? 0) - Number(left.dataset.shortcutPriority ?? 0))
  return candidates[0] ?? null
}

export function activePrimaryCommands(): ShortcutCommand[] {
  return [{
    id: 'analysis.run-active',
    label: 'Run active analysis',
    category: 'Analysis',
    description: 'Runs the primary calculation for the active analysis or submodule.',
    bindings: [{ key: 'Enter', mod: true }],
    scope: 'global',
    allowInEditable: true,
    enabled: () => {
      const button = findPrimaryAction()
      return Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true')
    },
    disabledReason: () => findPrimaryAction()
      ? 'Complete the required inputs before running this analysis.'
      : 'This view has no primary calculation.',
    handler: () => findPrimaryAction()?.click(),
  }]
}

export function KeyboardShortcutProvider({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const openPalette = useCallback((mode: PaletteMode = 'commands') => setPalette(mode), [])
  const closePalette = useCallback(() => setPalette(null), [])

  const builtIns = useMemo<ShortcutCommand[]>(() => [
    {
      id: 'app.command-palette', label: 'Open command palette', category: 'Navigation',
      description: 'Search all commands available in the current context.',
      bindings: [{ key: 'k', mod: true }], scope: 'global', allowInEditable: true,
      handler: () => openPalette('commands'),
    },
    {
      id: 'app.shortcut-reference', label: 'Show keyboard shortcuts', category: 'Help',
      description: 'Show the keyboard reference for the current view.',
      bindings: [{ code: 'Slash', shift: true }], scope: 'global',
      handler: () => openPalette('shortcuts'),
    },
    ...activePrimaryCommands(),
  ], [openPalette])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return
      // A dialog owns the keyboard. This preserves local editor shortcuts such
      // as Help search and plot-note submission without triggering the module.
      const target = event.target as Element | null
      if (target?.closest('[role="dialog"], [aria-modal="true"]')
        || document.querySelector('[aria-modal="true"]')) return
      const commands = [...flatten(entries), ...builtIns.map(command => ({ ...command, sequence: -1 }))]
      const matches = commands
        .filter(command => command.bindings?.some(binding => matchesShortcut(event, binding)))
        .filter(command => resolve(command.when, true))
        .filter(command => resolve(command.keyWhen, true))
        .filter(command => command.allowInEditable || !isEditableTarget(event.target))
        .sort((a, b) => (scopePriority[b.scope ?? 'module'] - scopePriority[a.scope ?? 'module']) || b.sequence - a.sequence)
      const command = matches[0]
      if (!command || !available(command)) return
      event.preventDefault()
      event.stopPropagation()
      try {
        const result = command.handler()
        if (result instanceof Promise) void result.catch(error => console.error('Shortcut command failed', error))
      } catch (error) { console.error('Shortcut command failed', error) }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [builtIns, entries])

  const value = useMemo(() => ({ openPalette, closePalette }), [openPalette, closePalette])
  return (
    <ShortcutContext.Provider value={value}>
      {children}
      {palette && <CommandPalette mode={palette} onClose={closePalette} builtIns={builtIns} entries={entries} />}
    </ShortcutContext.Provider>
  )
}

function CommandPalette({
  mode, onClose, builtIns, entries,
}: {
  mode: PaletteMode
  onClose: () => void
  builtIns: ShortcutCommand[]
  entries: RegistryEntry[]
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  useFocusTrap(panelRef, true, onClose)
  useEffect(() => { searchRef.current?.focus() }, [])

  const commands = useMemo(() => {
    const all = [...builtIns, ...flatten(entries)]
    const seen = new Set<string>()
    return all.filter(command => {
      if (seen.has(command.id) || !resolve(command.when, true)) return false
      seen.add(command.id)
      if (mode === 'shortcuts' && !command.bindings?.length) return false
      const haystack = [command.label, command.category, command.description, ...(command.keywords ?? [])]
        .join(' ').toLowerCase()
      return !query.trim() || haystack.includes(query.trim().toLowerCase())
    }).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
  }, [builtIns, entries, mode, query])

  useEffect(() => { setActiveIndex(0) }, [query, mode])
  const run = (command: ShortcutCommand) => {
    if (!available(command)) return
    onClose()
    try {
      const result = command.handler()
      if (result instanceof Promise) void result.catch(error => console.error('Command failed', error))
    } catch (error) { console.error('Command failed', error) }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-slate-950/35 pt-[12vh] px-4" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'shortcuts' ? 'Keyboard shortcuts' : 'Command palette'}
        className="w-[42rem] max-w-full max-h-[72vh] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          {mode === 'shortcuts' ? <Keyboard size={18} className="text-blue-600" /> : <Command size={18} className="text-blue-600" />}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{mode === 'shortcuts' ? 'Keyboard shortcuts' : 'Command palette'}</h2>
            <p className="text-[11px] text-gray-500">Commands adapt to the active module and focused canvas.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="relative px-3 py-2 border-b border-gray-100">
          <Search size={15} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => Math.min(commands.length - 1, index + 1)) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)) }
              if (event.key === 'Enter' && commands[activeIndex]) { event.preventDefault(); run(commands[activeIndex]) }
            }}
            placeholder={mode === 'shortcuts' ? 'Filter shortcuts…' : 'Search commands…'}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="overflow-y-auto p-2" role="listbox">
          {commands.map((command, index) => {
            const isEnabled = available(command)
            return (
              <button
                key={command.id}
                role="option"
                aria-selected={index === activeIndex}
                disabled={!isEnabled}
                title={!isEnabled ? reason(command) : command.description}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run(command)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${index === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'} ${isEnabled ? 'text-gray-800' : 'text-gray-400'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium truncate">{command.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">{command.category}</span>
                  </div>
                  {(command.description || !isEnabled) && (
                    <p className="text-[10px] mt-0.5 truncate text-gray-500">{!isEnabled ? reason(command) : command.description}</p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {command.bindings?.map((binding, bindingIndex) => (
                    <kbd key={bindingIndex} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-gray-600 shadow-sm">
                      {formatShortcut(binding, isApplePlatform())}
                    </kbd>
                  ))}
                </div>
                {index === activeIndex && isEnabled && <CornerDownLeft size={12} className="text-blue-500 flex-shrink-0" />}
              </button>
            )
          })}
          {!commands.length && <p className="py-10 text-center text-xs text-gray-400">No matching commands.</p>}
        </div>
        <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
          <span><kbd className="font-mono">↑↓</kbd> choose</span><span><kbd className="font-mono">Enter</kbd> run</span><span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
