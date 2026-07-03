import { ArrowRight, CircleCheck, CircleDashed, CircleDot, Sparkles } from 'lucide-react'
import { useStoreVersion, useIsDirty } from '../../store/project'
import { computeDashboardSummary, AreaSummary } from '../../store/dashboardSummary'
import { Card } from '../shared/ui'
import type { UpdateInfo } from '../../api/updateCheck'

/**
 * Project landing page: at-a-glance view of which analysis areas / sub-tools /
 * folios hold input data or computed results, with quick navigation. Re-derives
 * on every store write via useStoreVersion().
 */
export default function Dashboard({ onNavigate, update, onOpenAbout }: {
  onNavigate: (tabId: string) => void
  update?: UpdateInfo | null
  onOpenAbout?: () => void
}) {
  useStoreVersion()          // subscribe: re-render on any store mutation
  const dirty = useIsDirty()
  const s = computeDashboardSummary()

  const anyData = s.areasWithData > 0

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{s.projectName}</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Project dashboard · units: {s.units}
            {' · '}
            <span className={dirty ? 'text-amber-600' : 'text-gray-400'}>
              {dirty ? 'unsaved changes' : 'all changes saved'}
            </span>
          </p>
        </div>
      </div>

      {/* Update banner (when a newer release exists) */}
      {update && (
        <button
          onClick={() => (onOpenAbout ? onOpenAbout() : window.open(update.url, '_blank'))}
          className="flex items-center gap-2 text-left rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 hover:bg-blue-100 transition-colors"
        >
          <Sparkles size={16} className="text-blue-600 flex-shrink-0" />
          <span className="text-sm text-blue-800">
            <b>Perdura {update.version}</b> is available — {onOpenAbout ? 'see what’s new in About' : 'download the update'}.
          </span>
          <ArrowRight size={14} className="text-blue-600 ml-auto flex-shrink-0" />
        </button>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Areas in use" value={`${s.areasWithData} / ${s.totalAreas}`} accent
          tip="Analysis areas that hold input data or computed results" />
        <Card label="Analyses / folios" value={String(s.totalAnalyses)}
          tip="Total folios across folio-based modules (Life Data, ALT, System Modeling, …)" />
        <Card label="With results" value={String(s.totalWithResults)}
          tip="Folios and sub-tools that carry computed results" />
        <Card label="Save state" value={dirty ? 'Unsaved' : 'Saved'}
          tip={dirty ? 'Press Ctrl/Cmd-S or use Save' : 'All changes are saved to this browser'} />
      </div>

      {/* Empty state */}
      {!anyData && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <CircleDashed size={28} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-700">This project is empty</p>
          <p className="text-xs text-gray-500 mt-1">
            Pick an area below to enter data and run an analysis — your work autosaves to this browser.
          </p>
        </div>
      )}

      {/* Per-area grid */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Modules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {s.areas.map(a => <AreaCard key={a.tabId} area={a} onNavigate={onNavigate} />)}
        </div>
      </div>
    </div>
  )
}

function AreaCard({ area, onNavigate }: { area: AreaSummary; onNavigate: (tabId: string) => void }) {
  const status: 'results' | 'progress' | 'empty' =
    area.hasResults ? 'results' : area.hasInput ? 'progress' : 'empty'
  const StatusIcon = status === 'results' ? CircleCheck : status === 'progress' ? CircleDot : CircleDashed
  const statusColor =
    status === 'results' ? 'text-emerald-500' : status === 'progress' ? 'text-amber-500' : 'text-gray-300'
  const statusLabel =
    status === 'results' ? 'Results' : status === 'progress' ? 'In progress' : 'Empty'

  const detail =
    area.subTools != null
      ? `${area.subToolsWithResults}/${area.subTools} tools computed`
      : area.analyses != null
        ? `${area.analysesWithResults}/${area.analyses} ${area.analyses === 1 ? 'analysis' : 'analyses'} with results`
        : null

  return (
    <button
      onClick={() => onNavigate(area.tabId)}
      className={`group text-left rounded-lg border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 ${
        status === 'empty' ? 'bg-white border-gray-200' : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon size={15} className={`flex-shrink-0 ${statusColor}`} />
        <span className={`text-sm font-medium ${area.color}`}>{area.label}</span>
        {area.stale && (
          <span title="Results are stale — inputs changed since last run"
            className="ml-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1">stale</span>
        )}
        <ArrowRight size={13} className="ml-auto text-gray-300 group-hover:text-blue-500 flex-shrink-0" />
      </div>
      <p className="text-[11px] text-gray-500 mt-1.5">
        {statusLabel}{detail ? ` · ${detail}` : ''}
      </p>
    </button>
  )
}
