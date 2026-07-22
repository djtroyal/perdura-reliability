import { toast } from '../components/shared/toast'
import {
  ARTIFACT_MANIFEST_SCHEMA,
  newTraceId,
  sha256Bytes,
  softwareIdentity,
  type ArtifactManifest,
  type ArtifactSourceRecord,
} from './provenance'
import { artifactSources, getProjectState, recordExportLedger } from './project'

const ASSURANCE_EXPORT_KEY = 'perdura-assurance-export-enabled'

export interface ArtifactExportContext {
  kind: string
  title?: string
  moduleKey?: string
  analysisId?: string
  artifactId?: string
  generatedAt?: string
  sources?: ArtifactSourceRecord[]
}

export function assuranceExportEnabled(): boolean {
  try { return localStorage.getItem(ASSURANCE_EXPORT_KEY) !== 'false' } catch { return true }
}

export function setAssuranceExportEnabled(enabled: boolean) {
  try { localStorage.setItem(ASSURANCE_EXPORT_KEY, String(enabled)) } catch { /* preference is optional */ }
  window.dispatchEvent(new CustomEvent('perdura-assurance-export-change', { detail: enabled }))
}

function triggerDownload(bytes: Uint8Array, filename: string, mediaType: string) {
  const blob = new Blob([bytes.slice()], { type: mediaType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function toBytes(value: Blob | string | Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(await value.arrayBuffer())
}

function safeArchiveName(filename: string): string {
  return filename.replace(/[\\/]+/g, '_') || 'artifact.bin'
}

/** Download an export, optionally as a single verification ZIP containing the
 * exact artifact bytes and their machine-readable SHA-256 sidecar. */
export async function downloadArtifact(
  value: Blob | string | Uint8Array | ArrayBuffer,
  filename: string,
  mediaType: string,
  context: ArtifactExportContext,
): Promise<ArtifactManifest | null> {
  const bytes = await toBytes(value)
  const artifactFilename = safeArchiveName(filename)
  if (!assuranceExportEnabled()) {
    triggerDownload(bytes, artifactFilename, mediaType)
    return null
  }

  const software = softwareIdentity()
  if (software.buildStatus === 'identity-mismatch') {
    toast.error('Export blocked: the frontend and calculation service report different build identities.')
    throw new Error('Frontend/backend build identity mismatch.')
  }
  const project = getProjectState()
  const sources = context.sources ?? await artifactSources(context.moduleKey, context.analysisId)
  const artifactId = context.artifactId ?? newTraceId('art')
  const generatedAt = context.generatedAt ?? new Date().toISOString()
  const sha256 = await sha256Bytes(bytes)
  const manifest: ArtifactManifest = {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    artifactId,
    generatedAt,
    artifact: { filename: artifactFilename, mediaType, sizeBytes: bytes.byteLength, sha256 },
    project: { ...project.identity, name: project.projectName, units: project.units },
    software,
    sources,
    export: {
      kind: context.kind,
      title: context.title,
      moduleKey: context.moduleKey,
      analysisId: context.analysisId,
    },
    assurance: {
      level: 'checksum_only',
      integrityAlgorithm: 'SHA-256',
      authenticityEstablished: false,
      statement: 'The checksum detects changes and links this artifact to recorded analysis and build metadata; it does not authenticate the producer.',
    },
  }
  const manifestName = `${artifactFilename}.perdura.json`
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n')
  const { zipSync } = await import('fflate')
  const zipped = zipSync({
    [artifactFilename]: bytes,
    [manifestName]: manifestBytes,
  }, { level: 6 })
  triggerDownload(zipped, `${artifactFilename}.perdura.zip`, 'application/zip')
  recordExportLedger({
    artifactId,
    filename: artifactFilename,
    mediaType,
    sizeBytes: bytes.byteLength,
    sha256,
    generatedAt,
    kind: context.kind,
    sourceRunIds: sources.map(source => source.runId),
    softwareVersion: software.version,
    softwareCommit: software.commit,
  })
  return manifest
}

export async function downloadDataUrlArtifact(
  dataUrl: string,
  filename: string,
  mediaType: string,
  context: ArtifactExportContext,
) {
  const response = await fetch(dataUrl)
  return downloadArtifact(await response.blob(), filename, mediaType, context)
}
