import {
  APP_COMMIT,
  APP_VERSION,
  BUILD_TIMESTAMP,
  BUILD_VERIFICATION_REPORT_SHA256,
  BUILD_VERIFICATION_RUN_URL,
  OFFICIAL_REPOSITORY,
} from '../version'

export const ARTIFACT_MANIFEST_SCHEMA = 'perdura.artifact-manifest/v1' as const
export const ANALYSIS_RUN_SCHEMA = 'perdura.analysis-run/v1' as const

export interface ProjectIdentity {
  projectId: string
  organization?: string
  analyst?: string
  projectNumber?: string
  documentNumber?: string
  classification?: string
}

export interface SoftwareIdentity {
  product: 'Perdura'
  version: string
  commit: string
  builtAt: string
  repository: string
  commitUrl: string | null
  releaseUrl: string | null
  verificationReportSha256: string | null
  verificationRunUrl: string | null
  runtimeExecutableSha256: string | null
  buildStatus: 'verified-release-metadata' | 'development' | 'identity-mismatch'
}

export interface AnalysisRunRecord {
  schema: typeof ANALYSIS_RUN_SCHEMA
  runId: string
  projectId: string
  moduleKey: string
  moduleLabel: string
  analysisId: string
  analysisName: string
  method?: string
  engineRevision: number
  completedAt: string
  inputSha256: string
  resultSha256: string
  fingerprintSha256: string
  software: SoftwareIdentity
}

export interface ArtifactSourceRecord {
  runId: string
  moduleKey: string
  analysisId: string
  analysisName: string
  fingerprintSha256: string
  inputSha256: string
  resultSha256: string
  engineRevision: number
  current: boolean
}

export interface ArtifactManifest {
  schema: typeof ARTIFACT_MANIFEST_SCHEMA
  artifactId: string
  generatedAt: string
  artifact: {
    filename: string
    mediaType: string
    sizeBytes: number
    sha256: string
  }
  project: ProjectIdentity & { name: string; units: string }
  software: SoftwareIdentity
  sources: ArtifactSourceRecord[]
  export: {
    kind: string
    title?: string
    moduleKey?: string
    analysisId?: string
  }
  assurance: {
    level: 'checksum_only'
    integrityAlgorithm: 'SHA-256'
    authenticityEstablished: false
    statement: string
  }
}

export interface ExportLedgerEntry {
  artifactId: string
  filename: string
  mediaType: string
  sizeBytes: number
  sha256: string
  generatedAt: string
  kind: string
  sourceRunIds: string[]
  softwareVersion: string
  softwareCommit: string
}

export interface BackendSoftwareIdentity {
  version?: string
  commit?: string
  built_at?: string
  verification_report_sha256?: string
  verification_run_url?: string
  runtime_executable_sha256?: string | null
}

let backendIdentity: BackendSoftwareIdentity | null = null
let backendIdentityChecked = false

export function setBackendSoftwareIdentity(identity: BackendSoftwareIdentity | null) {
  backendIdentity = identity
  backendIdentityChecked = true
}

export function newTraceId(prefix: string): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  return `${prefix}-${value}`
}

export function newProjectIdentity(): ProjectIdentity {
  return { projectId: newTraceId('prj') }
}

function normalizedJsonValue(value: unknown, stack = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Provenance hashing does not accept non-finite numbers.')
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'bigint') throw new TypeError('Provenance hashing does not accept bigint values.')
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return value.toISOString()
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value))
  if (typeof value !== 'object') return String(value)
  if (stack.has(value)) throw new TypeError('Provenance hashing does not accept cyclic values.')
  stack.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map(item => normalizedJsonValue(item, stack) ?? null)
    }
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const normalized = normalizedJsonValue(source[key], stack)
      if (normalized !== undefined) result[key] = normalized
    }
    return result
  } finally {
    stack.delete(value)
  }
}

/** RFC 8785-compatible canonical JSON for Perdura's JSON-safe analysis data. */
export function canonicalJson(value: unknown): string {
  const normalized = normalizedJsonValue(value)
  return JSON.stringify(normalized === undefined ? null : normalized)
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

export async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value))
}

export async function hashCanonicalJson(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value))
}

const isReleaseVersion = (value: string) => /^\d+\.\d+\.\d+$/.test(value)
const isCommit = (value: string) => /^[0-9a-f]{40}$/i.test(value)
const isDigest = (value: string) => /^[0-9a-f]{64}$/i.test(value)

export function softwareIdentity(): SoftwareIdentity {
  const frontend = {
    version: APP_VERSION,
    commit: APP_COMMIT,
    builtAt: BUILD_TIMESTAMP,
    verificationReportSha256: isDigest(BUILD_VERIFICATION_REPORT_SHA256)
      ? BUILD_VERIFICATION_REPORT_SHA256.toLowerCase() : null,
    verificationRunUrl: BUILD_VERIFICATION_RUN_URL || null,
  }
  const mismatch = backendIdentityChecked && backendIdentity != null
    && ((backendIdentity.version && backendIdentity.version !== frontend.version)
      || (backendIdentity.commit && backendIdentity.commit !== frontend.commit)
      || ((backendIdentity.verification_report_sha256 || null)
        !== frontend.verificationReportSha256))
  const release = isReleaseVersion(frontend.version) && isCommit(frontend.commit)
    && frontend.verificationReportSha256 != null
  const base = `https://github.com/${OFFICIAL_REPOSITORY}`
  return {
    product: 'Perdura',
    version: frontend.version,
    commit: frontend.commit,
    builtAt: frontend.builtAt,
    repository: OFFICIAL_REPOSITORY,
    commitUrl: isCommit(frontend.commit) ? `${base}/commit/${frontend.commit}` : null,
    releaseUrl: isReleaseVersion(frontend.version) ? `${base}/releases/tag/v${frontend.version}` : null,
    verificationReportSha256: frontend.verificationReportSha256,
    verificationRunUrl: frontend.verificationRunUrl,
    runtimeExecutableSha256: backendIdentity?.runtime_executable_sha256 ?? null,
    buildStatus: mismatch ? 'identity-mismatch' : release ? 'verified-release-metadata' : 'development',
  }
}

export async function createAnalysisRunRecord(args: {
  projectId: string
  moduleKey: string
  moduleLabel: string
  analysisId: string
  analysisName: string
  method?: string
  engineRevision: number
  inputs: unknown
  results: unknown
  completedAt?: string
}): Promise<AnalysisRunRecord> {
  const completedAt = args.completedAt ?? new Date().toISOString()
  const [inputSha256, resultSha256] = await Promise.all([
    hashCanonicalJson(args.inputs), hashCanonicalJson(args.results),
  ])
  const software = softwareIdentity()
  const core = {
    schema: ANALYSIS_RUN_SCHEMA,
    projectId: args.projectId,
    moduleKey: args.moduleKey,
    analysisId: args.analysisId,
    engineRevision: args.engineRevision,
    completedAt,
    inputSha256,
    resultSha256,
    software,
  }
  return {
    ...core,
    runId: newTraceId('run'),
    moduleLabel: args.moduleLabel,
    analysisName: args.analysisName,
    method: args.method,
    fingerprintSha256: await hashCanonicalJson(core),
  }
}

export async function verifyArtifactBytes(
  bytes: Uint8Array,
  manifest: ArtifactManifest,
): Promise<{
  valid: boolean
  integrityValid: boolean
  traceabilityComplete: boolean
  issues: string[]
  warnings: string[]
  actualSha256: string
}> {
  const issues: string[] = []
  const warnings: string[] = []
  if (manifest?.schema !== ARTIFACT_MANIFEST_SCHEMA) issues.push('Unsupported or missing artifact-manifest schema.')
  const actualSha256 = await sha256Bytes(bytes)
  if (manifest?.artifact?.sha256 !== actualSha256) issues.push('Artifact SHA-256 does not match the sidecar.')
  if (manifest?.artifact?.sizeBytes !== bytes.byteLength) issues.push('Artifact byte size does not match the sidecar.')
  if (manifest?.software?.buildStatus === 'development') warnings.push('Artifact declares a development build, not release traceability.')
  if (manifest?.software?.buildStatus === 'identity-mismatch') issues.push('Artifact declares inconsistent frontend/backend software identity.')
  if (manifest?.assurance?.authenticityEstablished !== false) issues.push('Checksum-only manifests must not claim producer authenticity.')
  const integrityValid = manifest?.artifact?.sha256 === actualSha256
    && manifest?.artifact?.sizeBytes === bytes.byteLength
  const traceabilityComplete = [
    manifest?.artifactId, manifest?.project?.projectId,
    manifest?.software?.version, manifest?.software?.commit,
  ].every(value => typeof value === 'string' && value.length > 0)
  if (!traceabilityComplete) warnings.push('Project, artifact, or software trace fields are incomplete.')
  return { valid: issues.length === 0, integrityValid, traceabilityComplete, issues, warnings, actualSha256 }
}
