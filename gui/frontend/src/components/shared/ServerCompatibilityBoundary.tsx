import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Server } from 'lucide-react'
import {
  apiClientHeaders,
  assessServerCompatibility,
  SERVER_COMPATIBILITY_EVENT,
  type ServerCompatibilityAssessment,
  type ServerCompatibilityIdentity,
} from '../../api/serverCompatibility'
import { setBackendSoftwareIdentity } from '../../store/provenance'

const CHECK_TIMEOUT_MS = 8_000

const checking: ServerCompatibilityAssessment = {
  kind: 'unavailable',
  title: 'Checking the Perdura server…',
  message: 'Confirming that this browser frontend and the remote calculation server use compatible contracts.',
}

export default function ServerCompatibilityBoundary({ children }: { children: ReactNode }) {
  const [assessment, setAssessment] = useState<ServerCompatibilityAssessment>(checking)
  const [initialCheckComplete, setInitialCheckComplete] = useState(false)
  const [dismissedRefresh, setDismissedRefresh] = useState(false)

  const check = useCallback(async () => {
    setInitialCheckComplete(false)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    try {
      const query = new URLSearchParams({
        client_api_contract: apiClientHeaders()['X-Perdura-Client-API-Contract'],
        cache_bust: String(Date.now()),
      })
      const response = await fetch(`/api/v1/version?${query}`, {
        cache: 'no-store',
        headers: apiClientHeaders(),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Server identity request failed (${response.status}).`)
      const identity = await response.json() as ServerCompatibilityIdentity
      setBackendSoftwareIdentity(identity)
      setAssessment(assessServerCompatibility(identity))
    } catch {
      setBackendSoftwareIdentity(null)
      setAssessment({
        kind: 'unavailable',
        title: 'Server compatibility is not available',
        message: 'Perdura could not verify the calculation server. The interface remains locked until the connection and API contract can be confirmed.',
      })
    } finally {
      window.clearTimeout(timeout)
      setInitialCheckComplete(true)
    }
  }, [])

  useEffect(() => { void check() }, [check])
  useEffect(() => {
    const receive = (event: Event) => {
      setDismissedRefresh(false)
      setAssessment((event as CustomEvent<ServerCompatibilityAssessment>).detail)
      setInitialCheckComplete(true)
    }
    window.addEventListener(SERVER_COMPATIBILITY_EVENT, receive)
    return () => window.removeEventListener(SERVER_COMPATIBILITY_EVENT, receive)
  }, [])

  const blocking = !initialCheckComplete
    || assessment.kind === 'incompatible'
    || assessment.kind === 'unavailable'
  const showNotice = !initialCheckComplete
    || assessment.kind === 'incompatible'
    || assessment.kind === 'unavailable'
    || (assessment.kind === 'refresh' && !dismissedRefresh)

  return (
    <>
      <div className={blocking ? 'pointer-events-none select-none opacity-60' : undefined} aria-hidden={blocking || undefined}>
        {children}
      </div>
      {showNotice && (
        <div className={blocking
          ? 'fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/25 p-4'
          : 'fixed left-1/2 top-3 z-[300] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2'}>
          <section
            role={assessment.kind === 'incompatible' ? 'alertdialog' : 'status'}
            aria-live="assertive"
            className={`rounded-xl border bg-white p-4 shadow-xl ${
              assessment.kind === 'incompatible' ? 'border-red-300'
                : assessment.kind === 'unavailable' ? 'border-amber-300'
                  : 'border-blue-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {assessment.kind === 'incompatible' || assessment.kind === 'unavailable'
                ? <AlertTriangle size={20} className={assessment.kind === 'incompatible' ? 'mt-0.5 text-red-600' : 'mt-0.5 text-amber-600'} />
                : <Server size={20} className="mt-0.5 text-blue-600" />}
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-900">{assessment.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{assessment.message}</p>
                {blocking && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Perdura blocks calculation requests until compatibility is verified; it never interprets mismatched responses approximately.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              {initialCheckComplete && assessment.kind === 'refresh' && (
                <button onClick={() => setDismissedRefresh(true)} className="mini-button">Later</button>
              )}
              <button onClick={() => void check()} className="mini-button">Retry</button>
              <button
                onClick={() => window.location.reload()}
                className="mini-button inline-flex items-center gap-1.5 border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              >
                <RefreshCw size={13} /> Reload deployed frontend
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
