const RECOVERY_STORAGE_KEY = 'perdura:dynamic-import-recovery'
const RECOVERY_WINDOW_MS = 30_000

interface RecoveryRecord {
  resource: string
  attemptedAt: number
}

interface RecoveryEnvironment {
  now: () => number
  reload: () => void
  schedule: (callback: () => void) => void
  storage: Pick<Storage, 'getItem' | 'setItem'>
}

let scheduledResource: string | null = null

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }
  return ''
}

export function isDynamicImportLoadError(error: unknown): boolean {
  return /(error loading dynamically imported module|failed to fetch dynamically imported module|importing a module script failed|unable to preload (?:css|module))/i
    .test(errorMessage(error))
}

function resourceKey(error: unknown): string {
  const message = errorMessage(error)
  const url = message.match(/https?:\/\/[^\s)]+/i)?.[0]
  if (!url) return message.slice(0, 500)
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split('?')[0]
  }
}

function browserEnvironment(): RecoveryEnvironment | null {
  if (typeof window === 'undefined') return null
  return {
    now: () => Date.now(),
    reload: () => window.location.reload(),
    schedule: callback => window.setTimeout(callback, 0),
    storage: window.sessionStorage,
  }
}

/**
 * Recover once from a stale Vite/deployment chunk URL by reloading the page.
 * Returning true tells a lazy importer to remain suspended while navigation
 * starts. A recent attempt for the same resource is allowed to reach the
 * error boundary instead of creating a reload loop.
 */
export function requestDynamicImportRecovery(
  error: unknown,
  environment: RecoveryEnvironment | null = browserEnvironment(),
): boolean {
  if (!isDynamicImportLoadError(error) || !environment) return false
  const resource = resourceKey(error)
  if (scheduledResource === resource) return true

  try {
    const raw = environment.storage.getItem(RECOVERY_STORAGE_KEY)
    const previous = raw ? JSON.parse(raw) as Partial<RecoveryRecord> : null
    if (previous?.resource === resource
        && typeof previous.attemptedAt === 'number'
        && environment.now() - previous.attemptedAt < RECOVERY_WINDOW_MS) {
      return false
    }
    environment.storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({
      resource,
      attemptedAt: environment.now(),
    } satisfies RecoveryRecord))
  } catch {
    // If storage is unavailable, avoid an unguarded reload loop.
    return false
  }

  scheduledResource = resource
  environment.schedule(environment.reload)
  return true
}

export function installDynamicImportRecovery(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handlePreloadError = (event: Event) => {
    const preloadEvent = event as Event & { payload?: unknown }
    if (requestDynamicImportRecovery(preloadEvent.payload)) event.preventDefault()
  }
  window.addEventListener('vite:preloadError', handlePreloadError)
  return () => window.removeEventListener('vite:preloadError', handlePreloadError)
}
