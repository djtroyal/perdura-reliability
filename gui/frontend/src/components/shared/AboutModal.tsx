import { useRef } from 'react'
import { X, ExternalLink, Sparkles } from 'lucide-react'
import Logo from './Logo'
import { useFocusTrap } from './useDialog'
import type { UpdateInfo } from '../../api/updateCheck'
import {
  APP_COMMIT,
  APP_VERSION,
  BUILD_TIMESTAMP,
  PROJECT_SCHEMA_VERSION,
} from '../../version'

const REPO_URL = 'https://github.com/djtroyal/reliability'

function readableBuildTimestamp(value: string): string {
  if (value === 'dev') return 'Development build'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

/**
 * About Perdura: banner logo, version, description, copyright/licensing, links,
 * and — when a newer release exists — its changelog. Mirrors the shared dialog
 * overlay/panel conventions and reuses useFocusTrap for accessibility.
 */
export default function AboutModal({ open, onClose, update, onDismissUpdate }: {
  open: boolean
  onClose: () => void
  update?: UpdateInfo | null
  onDismissUpdate?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, open, onClose)
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="About Perdura"
        className="bg-white rounded-xl shadow-xl border border-gray-200 w-[30rem] max-w-[92vw] max-h-[85vh] overflow-y-auto"
      >
        {/* Header / banner */}
        <div className="relative px-6 pt-6 pb-4 text-center border-b border-gray-100">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 text-gray-300 hover:text-gray-600"
          >
            <X size={18} />
          </button>
          <div className="flex justify-center mb-3">
            <Logo size={72} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Perdura</h2>
          <p className="text-xs text-gray-500 mt-0.5">Reliability Engineering &amp; Statistics Suite</p>
          <p className="mt-2 inline-block text-xs font-medium text-gray-600 bg-gray-100 rounded-full px-2.5 py-0.5">
            Version {APP_VERSION}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-[10px] text-gray-400"
            title="Build identity for diagnostics and support">
            <span>Commit {APP_COMMIT === 'dev' ? 'dev' : APP_COMMIT.slice(0, 12)}</span>
            <span>Project schema {PROJECT_SCHEMA_VERSION}</span>
            <span>{readableBuildTimestamp(BUILD_TIMESTAMP)}</span>
          </div>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4 text-sm text-gray-700">
          <p className="text-[13px] leading-relaxed text-gray-600">
            A comprehensive, local-first suite for reliability engineering and statistics — life-data
            analysis, accelerated testing, system modeling, maintenance, human reliability, Six Sigma,
            and more. Your data stays in your browser.
          </p>

          {/* Update / changelog */}
          {update && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-blue-600 flex-shrink-0" />
                <span className="text-sm font-medium text-blue-800">
                  {update.name || `Perdura ${update.version}`} is available
                </span>
                {onDismissUpdate && (
                  <button onClick={onDismissUpdate}
                    className="ml-auto text-[11px] text-blue-500 hover:text-blue-700">Dismiss</button>
                )}
              </div>
              {update.body && (
                <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[11px] leading-snug text-gray-700">
                  {update.body}
                </pre>
              )}
              <a
                href={update.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                Download <ExternalLink size={12} />
              </a>
            </div>
          )}

          {/* Copyright / license */}
          <div className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 pt-3">
            <p>© 2026 Derek Taylor. All rights reserved.</p>
            <p className="mt-1">
              Licensed under the <b>PolyForm Noncommercial License 1.0.0</b> — free for personal,
              academic, and other non-commercial use. Commercial use requires a separate paid license
              (<a href="mailto:djtroyal@gmail.com" className="text-blue-600 hover:underline">djtroyal@gmail.com</a>).
            </p>
            <p className="mt-1">
              Includes resources from the open-source{' '}
              <a href="https://reliability.readthedocs.io/" target="_blank" rel="noopener noreferrer"
                className="text-blue-600 hover:underline">reliability</a>{' '}
              Python library by Matthew Reid (MIT License).
            </p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 text-xs">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline">
              Project home <ExternalLink size={12} />
            </a>
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline">
              Releases <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
