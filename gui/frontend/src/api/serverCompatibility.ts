import { APP_COMMIT, APP_VERSION } from '../version'

/**
 * Increment this only for a breaking frontend/backend request or response
 * contract. Compatible Perdura releases may keep the same contract number.
 */
export const FRONTEND_API_CONTRACT = 1
export const CLIENT_API_CONTRACT_HEADER = 'X-Perdura-Client-API-Contract'
export const CLIENT_VERSION_HEADER = 'X-Perdura-Client-Version'
export const SERVER_COMPATIBILITY_EVENT = 'perdura:server-compatibility'

export interface ServerCompatibilityIdentity {
  version?: string
  commit?: string
  api_contract?: number
  minimum_client_api_contract?: number
  maximum_client_api_contract?: number
  [key: string]: unknown
}

export type ServerCompatibilityKind = 'compatible' | 'refresh' | 'incompatible' | 'unavailable'

export interface ServerCompatibilityAssessment {
  kind: ServerCompatibilityKind
  title: string
  message: string
  serverVersion?: string
  serverCommit?: string
}

const integer = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

export function assessServerCompatibility(
  identity: ServerCompatibilityIdentity,
  clientContract = FRONTEND_API_CONTRACT,
  frontendVersion = APP_VERSION,
  frontendCommit = APP_COMMIT,
): ServerCompatibilityAssessment {
  const serverContract = integer(identity.api_contract)
  const minimum = integer(identity.minimum_client_api_contract)
  const maximum = integer(identity.maximum_client_api_contract)
  const serverVersion = typeof identity.version === 'string' ? identity.version : undefined
  const serverCommit = typeof identity.commit === 'string' ? identity.commit : undefined

  if (serverContract == null || minimum == null || maximum == null
      || minimum > maximum || serverContract < minimum || serverContract > maximum) {
    return {
      kind: 'incompatible',
      title: 'Server compatibility cannot be verified',
      message: 'The connected server does not publish a valid Perdura API compatibility range. Use the frontend deployed with that server.',
      serverVersion,
      serverCommit,
    }
  }
  if (clientContract < minimum) {
    return {
      kind: 'incompatible',
      title: 'This Perdura tab is out of date',
      message: `This frontend uses API contract ${clientContract}; the server accepts ${minimum} through ${maximum}. Reload to obtain the deployed frontend.`,
      serverVersion,
      serverCommit,
    }
  }
  if (clientContract > maximum) {
    return {
      kind: 'incompatible',
      title: 'The connected server is out of date',
      message: `This frontend uses API contract ${clientContract}; the server accepts ${minimum} through ${maximum}. Use the frontend supplied by that server or ask its administrator to update it.`,
      serverVersion,
      serverCommit,
    }
  }

  const versionChanged = Boolean(serverVersion && frontendVersion && serverVersion !== frontendVersion)
  const commitChanged = Boolean(
    serverCommit && frontendCommit
    && serverCommit !== 'dev' && frontendCommit !== 'dev'
    && serverCommit !== frontendCommit,
  )
  if (versionChanged || commitChanged) {
    return {
      kind: 'refresh',
      title: 'A compatible server update is available',
      message: `This tab is Perdura ${frontendVersion}; the server is ${serverVersion ?? 'a different build'}. Reload when convenient so the interface and server build match.`,
      serverVersion,
      serverCommit,
    }
  }
  return {
    kind: 'compatible',
    title: 'Frontend and server are compatible',
    message: `API contract ${clientContract} is supported.`,
    serverVersion,
    serverCommit,
  }
}

export function apiClientHeaders(): Record<string, string> {
  return {
    [CLIENT_API_CONTRACT_HEADER]: String(FRONTEND_API_CONTRACT),
    [CLIENT_VERSION_HEADER]: APP_VERSION,
  }
}

type HeaderSource = Headers | { get?: (name: string) => unknown; [key: string]: unknown }

function readHeader(headers: HeaderSource | null | undefined, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value == null ? undefined : String(value)
  }
  const record = headers as Record<string, unknown>
  const value = record[name] ?? record[name.toLowerCase()]
  return value == null ? undefined : String(value)
}

let lastPublishedAssessment = ''

export function publishServerResponseCompatibility(headers: HeaderSource | null | undefined): void {
  if (typeof window === 'undefined') return
  const contract = readHeader(headers, 'X-Perdura-API-Contract')
  const minimum = readHeader(headers, 'X-Perdura-Min-Client-API-Contract')
  const maximum = readHeader(headers, 'X-Perdura-Max-Client-API-Contract')
  if (contract == null && minimum == null && maximum == null) return
  const assessment = assessServerCompatibility({
    version: readHeader(headers, 'X-Perdura-Version'),
    commit: readHeader(headers, 'X-Perdura-Commit'),
    api_contract: integer(contract) ?? undefined,
    minimum_client_api_contract: integer(minimum) ?? undefined,
    maximum_client_api_contract: integer(maximum) ?? undefined,
  })
  if (assessment.kind === 'compatible') return
  const signature = JSON.stringify(assessment)
  if (signature === lastPublishedAssessment) return
  lastPublishedAssessment = signature
  window.dispatchEvent(new CustomEvent<ServerCompatibilityAssessment>(
    SERVER_COMPATIBILITY_EVENT,
    { detail: assessment },
  ))
}

export function publishFrontendUpdateRequired(message?: string): void {
  if (typeof window === 'undefined') return
  const assessment: ServerCompatibilityAssessment = {
    kind: 'incompatible',
    title: 'This Perdura tab must be reloaded',
    message: message || 'The server rejected this frontend API contract. Reload to obtain the deployed frontend.',
  }
  window.dispatchEvent(new CustomEvent<ServerCompatibilityAssessment>(
    SERVER_COMPATIBILITY_EVENT,
    { detail: assessment },
  ))
}

/** Fetch an API stream with the same negotiation headers used by Axios. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(apiClientHeaders())) headers.set(name, value)
  const response = await fetch(input, { ...init, headers })
  publishServerResponseCompatibility(response.headers)
  if (response.status === 409) {
    const cloned = response.clone()
    const body = await cloned.json().catch(() => null)
    if (body?.error?.code === 'frontend_update_required') {
      publishFrontendUpdateRequired(body.error.message)
    }
  }
  return response
}
