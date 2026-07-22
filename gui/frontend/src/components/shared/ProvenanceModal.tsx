import { useRef, useState } from 'react'
import { CheckCircle2, Copy, FileCheck2, ShieldCheck, Upload, X, XCircle } from 'lucide-react'
import { unzipSync } from 'fflate'
import { useProjectIdentity, useProvenanceLedger } from '../../store/project'
import {
  ARTIFACT_MANIFEST_SCHEMA,
  verifyArtifactBytes,
  type ArtifactManifest,
} from '../../store/provenance'
import { toast } from './toast'

interface Props { open: boolean; onClose: () => void }

type Verification = {
  manifest: ArtifactManifest
  valid: boolean
  integrityValid: boolean
  traceabilityComplete: boolean
  issues: string[]
  warnings: string[]
  actualSha256: string
} | null

const identityFields = [
  ['organization', 'Organization'],
  ['analyst', 'Analyst'],
  ['projectNumber', 'Project number'],
  ['documentNumber', 'Document number'],
  ['classification', 'Classification / marking'],
] as const

const short = (value: string) => value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value

export default function ProvenanceModal({ open, onClose }: Props) {
  const [identity, updateIdentity] = useProjectIdentity()
  const ledger = useProvenanceLedger()
  const [verification, setVerification] = useState<Verification>(null)
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  if (!open) return null

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value)
    toast.success('Copied identifier.')
  }

  const verifyPackage = async (file: File) => {
    setChecking(true)
    try {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const sidecarName = Object.keys(archive).find(name => name.endsWith('.perdura.json'))
      if (!sidecarName) throw new Error('The ZIP does not contain a Perdura manifest.')
      const manifest = JSON.parse(new TextDecoder().decode(archive[sidecarName])) as ArtifactManifest
      if (manifest.schema !== ARTIFACT_MANIFEST_SCHEMA) throw new Error('Unsupported manifest schema.')
      const artifactName = Object.keys(archive).find(name =>
        name !== sidecarName && (name === manifest.artifact.filename
          || name.endsWith(`/${manifest.artifact.filename}`)))
      if (!artifactName) throw new Error(`The declared artifact “${manifest.artifact.filename}” is missing.`)
      const result = await verifyArtifactBytes(archive[artifactName], manifest)
      setVerification({ manifest, ...result })
    } catch (error) {
      setVerification(null)
      toast.error(`Verification failed: ${(error as Error).message}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Provenance and verification"
        className="flex max-h-[90vh] w-[52rem] max-w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={event => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-3">
          <ShieldCheck size={18} className="text-blue-600" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-800">Provenance &amp; verification</h2>
            <p className="text-[10px] text-gray-500">Trace project analyses and verify exported bytes without claiming digital-signature authenticity.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={16} /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs font-semibold text-gray-700">Controlled project identity</h3>
            <label className="mb-3 block text-[10px] text-gray-500">
              Project UUID
              <span className="mt-1 flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-[10px] text-gray-700">
                <span className="min-w-0 flex-1 truncate" title={identity.projectId}>{identity.projectId}</span>
                <button type="button" onClick={() => copy(identity.projectId)} title="Copy project UUID"><Copy size={11} /></button>
              </span>
            </label>
            <div className="space-y-2">
              {identityFields.map(([key, label]) => (
                <label key={key} className="block text-[10px] text-gray-500">
                  {label} <span className="text-gray-300">optional</span>
                  <input value={identity[key] ?? ''}
                    onChange={event => updateIdentity({ [key]: event.target.value })}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300" />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold text-gray-700">Verify an export package</h3>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={checking}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-3 py-4 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
              <Upload size={14} /> {checking ? 'Checking SHA-256…' : 'Choose .perdura.zip'}
            </button>
            <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden"
              onChange={event => {
                const file = event.target.files?.[0]
                if (file) void verifyPackage(file)
                event.target.value = ''
              }} />
            {verification && (
              <div className={`mt-3 rounded-lg border p-3 ${verification.valid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                <p className={`flex items-center gap-1.5 text-xs font-semibold ${verification.valid ? 'text-green-800' : 'text-red-800'}`}>
                  {verification.valid ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  Package {verification.valid ? 'verified' : 'invalid'}
                </p>
                <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-[10px]">
                  <dt className="text-gray-500">Artifact</dt><dd className="truncate font-medium text-gray-700">{verification.manifest.artifact.filename}</dd>
                  <dt className="text-gray-500">Artifact ID</dt><dd className="font-mono text-gray-700" title={verification.manifest.artifactId}>{short(verification.manifest.artifactId)}</dd>
                  <dt className="text-gray-500">SHA-256</dt><dd className="font-mono text-gray-700" title={verification.actualSha256}>{short(verification.actualSha256)}</dd>
                  <dt className="text-gray-500">Integrity</dt><dd className={`font-medium ${verification.integrityValid ? 'text-green-700' : 'text-red-700'}`}>{verification.integrityValid ? 'Verified' : 'Failed'}</dd>
                  <dt className="text-gray-500">Traceability</dt><dd className={`font-medium ${verification.traceabilityComplete ? 'text-green-700' : 'text-amber-700'}`}>{verification.traceabilityComplete ? 'Linked' : 'Incomplete'}</dd>
                  <dt className="text-gray-500">Software</dt><dd className="text-gray-700">Perdura {verification.manifest.software.version}</dd>
                  <dt className="text-gray-500">Analysis links</dt><dd className="text-gray-700">{verification.manifest.sources.length}</dd>
                  <dt className="text-gray-500">Authenticity</dt><dd className="font-medium text-amber-700">Not established (checksum only)</dd>
                </dl>
                {verification.issues.map(issue => <p key={issue} className="mt-1 text-[10px] text-red-700">{issue}</p>)}
                {verification.warnings.map(warning => <p key={warning} className="mt-1 text-[10px] text-amber-700">{warning}</p>)}
              </div>
            )}
          </section>

          <section className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-700">Trace ledger</h3>
              <span className="text-[10px] text-gray-400">{ledger.analysisRuns.length} runs · {ledger.exports.length} exports</span>
            </div>
            {ledger.analysisRuns.length === 0 && ledger.exports.length === 0 ? (
              <p className="rounded border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-500">Completed calculations and verified exports will appear here.</p>
            ) : (
              <div className="max-h-48 overflow-auto rounded border border-gray-200">
                {[...ledger.exports].reverse().slice(0, 12).map(item => (
                  <div key={item.artifactId} className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-[10px] last:border-0">
                    <FileCheck2 size={12} className="flex-shrink-0 text-blue-500" />
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-700">{item.filename}</span>
                    <span className="font-mono text-gray-400" title={item.sha256}>{short(item.sha256)}</span>
                    <span className="text-gray-400">{new Date(item.generatedAt).toLocaleString()}</span>
                  </div>
                ))}
                {ledger.exports.length === 0 && (
                  <p className="p-3 text-[10px] text-gray-500">Analysis fingerprints are recorded; no verified artifact has been exported yet.</p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
