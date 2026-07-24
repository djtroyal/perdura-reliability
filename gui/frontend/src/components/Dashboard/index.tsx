import { useState } from 'react'
import {
  ArrowRight, Atom, Bookmark, CircleCheck, CircleDashed, CircleDot, Cpu,
  FileText, FlaskConical, GitFork, LineChart, Network, ScatterChart,
  ShieldCheck, Sparkles, Target, Thermometer, TrendingUp, Users, Wrench, X, FileCode2, ClipboardList,
} from 'lucide-react'
import {
  useStoreVersion, useIsDirty, useLastSavedAt, useUnsavedChangeDetails,
} from '../../store/project'
import { computeDashboardSummary, AreaSummary, DashboardSummary } from '../../store/dashboardSummary'
import { Card } from '../shared/ui'
import { formatProjectTimestamp, unsavedChangesTitle } from '../shared/projectMetadata'
import type { UpdateInfo } from '../../api/updateCheck'
import { useHelpTopic } from '../help/context'
import { enumerateAssets } from '../../store/assetExtractors'
import { useBookmarks } from '../../store/bookmarks'
import { RemoveBookmarkButton, type BookmarkOpenRequest } from '../shared/BookmarkControls'

type KpiKey = 'areas' | 'analyses' | 'results' | 'save'

const BOOKMARK_MODULE_ICONS: Record<string, typeof Network> = {
  'life-data': LineChart,
  alt: Thermometer,
  'system-modeling': Network,
  allocation: GitFork,
  prediction: Cpu,
  pof: Atom,
  growth: TrendingUp,
  'software-reliability': FileCode2,
  'reliability-program': ClipboardList,
  maintenance: Wrench,
  hra: Users,
  warranty: ShieldCheck,
  hypothesis: FlaskConical,
  'data-analysis': ScatterChart,
  'six-sigma': Target,
  'report-builder': FileText,
}

/**
 * Project landing page: at-a-glance view of which analysis areas / sub-tools /
 * folios hold input data or computed results, with quick navigation. Re-derives
 * on every store write via useStoreVersion().
 */
export default function Dashboard({ onNavigate, onOpenBookmark, update, onOpenAbout }: {
  onNavigate: (tabId: string) => void
  onOpenBookmark: (request: BookmarkOpenRequest) => void
  update?: UpdateInfo | null
  onOpenAbout?: () => void
}) {
  useHelpTopic('dashboard.overview')
  useStoreVersion()          // subscribe: re-render on any store mutation
  const dirty = useIsDirty()
  const lastSavedAt = useLastSavedAt()
  const unsavedDetails = useUnsavedChangeDetails()
  const dirtyTitle = unsavedChangesTitle(unsavedDetails, lastSavedAt)
  const s = computeDashboardSummary()
  const { items: bookmarks } = useBookmarks()
  const liveAssets = new Map(enumerateAssets().map(asset => [asset.id, asset]))
  // Which KPI card's breakdown panel is expanded (click toggles).
  const [expanded, setExpanded] = useState<KpiKey | null>(null)
  const toggle = (k: KpiKey) => setExpanded(e => (e === k ? null : k))

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
            <span className={dirty ? 'text-amber-600' : 'text-gray-400'}
              title={dirty ? dirtyTitle : undefined}>
              {dirty ? 'unsaved changes' : 'all changes saved'}
              {dirty && (
                <span className="text-amber-500">
                  {' · '}last saved {lastSavedAt ? formatProjectTimestamp(lastSavedAt) : 'never'}
                </span>
              )}
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

      {/* KPI row — click a card for its breakdown */}
      <div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="Areas in use" value={`${s.areasWithData} / ${s.totalAreas}`} accent
            tip="Analysis areas that hold input data or computed results — click for the list"
            onClick={() => toggle('areas')} active={expanded === 'areas'} />
          <Card label="Analyses / folios" value={String(s.totalAnalyses)}
            tip="Total folios across folio-based modules — click for the per-module breakdown"
            onClick={() => toggle('analyses')} active={expanded === 'analyses'} />
          <Card label="With results" value={String(s.totalWithResults)}
            tip="Folios and sub-tools that carry computed results — click for the per-module breakdown"
            onClick={() => toggle('results')} active={expanded === 'results'} />
          <Card label="Save state" value={dirty ? 'Unsaved' : 'Saved'}
            tip={dirty ? dirtyTitle : 'All changes are saved to this browser — click for details'}
            onClick={() => toggle('save')} active={expanded === 'save'} />
        </div>
        {expanded && (
          <KpiBreakdown kpi={expanded} summary={s} dirty={dirty}
            lastSavedAt={lastSavedAt} unsavedDetails={unsavedDetails}
            onNavigate={onNavigate} onClose={() => setExpanded(null)} />
        )}
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

      {bookmarks.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Bookmark size={13} className="text-amber-600" fill="currentColor" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bookmarks</h2>
            <span className="text-[10px] text-gray-400">{bookmarks.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bookmarks.map(bookmark => {
              const live = liveAssets.get(bookmark.assetKey)
              const source = live?.source ?? bookmark.source
              const Icon = BOOKMARK_MODULE_ICONS[source.tab] ?? Bookmark
              const moduleColor = s.areas.find(area => area.tabId === source.tab)?.color ?? 'text-amber-700'
              return (
                <div key={bookmark.assetKey}
                  className={`group flex min-w-0 items-center rounded-lg border bg-white shadow-sm transition-colors ${
                    live ? 'border-gray-200 hover:border-amber-300' : 'border-dashed border-gray-300'
                  }`}>
                  <button type="button" disabled={!source}
                    onClick={() => source && onOpenBookmark({ source, label: bookmark.label })}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left">
                    <span title={`${bookmark.moduleLabel} · ${bookmark.type}`}
                      className={`rounded-md p-1.5 ${live ? `bg-gray-50 ${moduleColor}` : 'bg-gray-100 text-gray-400'}`}>
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-gray-800">{bookmark.label}</span>
                      <span className="block truncate text-[10px] text-gray-500">
                        {bookmark.moduleLabel} · {bookmark.group}
                      </span>
                      <span className="block truncate text-[9px] text-gray-400">
                        {live ? `Bookmarked ${new Date(bookmark.createdAt).toLocaleString()}` : 'Result unavailable · open its analysis or remove bookmark'}
                      </span>
                    </span>
                  </button>
                  <RemoveBookmarkButton assetKey={bookmark.assetKey} />
                </div>
              )
            })}
          </div>
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

/** Expanded breakdown for a clicked KPI card. */
function KpiBreakdown({
  kpi, summary: s, dirty, lastSavedAt, unsavedDetails, onNavigate, onClose,
}: {
  kpi: KpiKey; summary: DashboardSummary; dirty: boolean
  lastSavedAt: string | null; unsavedDetails: string[]
  onNavigate: (tabId: string) => void; onClose: () => void
}) {
  const title =
    kpi === 'areas' ? 'Areas in use'
    : kpi === 'analyses' ? 'Analyses / folios by module'
    : kpi === 'results' ? 'Computed results by module'
    : 'Save state'

  // Rows for the three area-based breakdowns; each navigates on click.
  let rows: { area: AreaSummary; detail: string }[] = []
  if (kpi === 'areas') {
    rows = s.areas.filter(a => a.hasInput || a.hasResults).map(a => ({
      area: a,
      detail: a.hasResults ? 'has results' : 'input data only',
    }))
  } else if (kpi === 'analyses') {
    rows = s.areas.filter(a => (a.analyses ?? 0) > 0 || (a.subTools ?? 0) > 0).map(a => ({
      area: a,
      detail: a.analyses != null
        ? `${a.analyses} ${a.analyses === 1 ? 'folio' : 'folios'} · ${a.analysesWithResults} with results`
        : `${a.subTools} tools · ${a.subToolsWithResults} computed`,
    })).filter(r => r.area.analyses == null || r.area.analyses > 0)
  } else if (kpi === 'results') {
    rows = s.areas.filter(a => a.analysesWithResults + a.subToolsWithResults > 0).map(a => ({
      area: a,
      detail: a.analyses != null
        ? `${a.analysesWithResults}/${a.analyses} ${a.analyses === 1 ? 'folio' : 'folios'} with results${a.stale ? ' · stale' : ''}`
        : `${a.subToolsWithResults}/${a.subTools} tools computed`,
    }))
  }

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-600">{title}</h3>
        <button onClick={onClose} aria-label="Close breakdown"
          className="text-gray-300 hover:text-gray-500"><X size={14} /></button>
      </div>
      {kpi === 'save' ? (
        <div className="text-xs text-gray-600 flex flex-col gap-1">
          <p>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${dirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {dirty
              ? 'You have unsaved changes. Press Ctrl/Cmd-S, or use Save in the top bar, to store the project in this browser.'
              : 'All changes are saved to this browser’s storage.'}
          </p>
          {dirty && (
            <>
              <p className="text-gray-500">
                Last saved: {lastSavedAt ? formatProjectTimestamp(lastSavedAt) : 'Never'}
              </p>
              {unsavedDetails.length > 0 && (
                <div className="mt-1 rounded border border-amber-100 bg-amber-50/60 px-2 py-1.5">
                  <p className="font-medium text-amber-800">Changed since that save</p>
                  {unsavedDetails.map(detail => (
                    <p key={detail} className="text-amber-700">• {detail}</p>
                  ))}
                </div>
              )}
            </>
          )}
          <p className="text-gray-400">
            Browser storage is per-machine and per-browser — use Export (top bar) to write the
            project to a .json file for backup or sharing, and Export → All assets for a full .zip.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400">
          Nothing here yet — pick a module below to enter data and run an analysis.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
          {rows.map(({ area, detail }) => (
            <button key={area.tabId} onClick={() => onNavigate(area.tabId)}
              className="group flex items-center gap-2 text-left text-xs py-1 rounded hover:bg-blue-50/60 px-1.5 transition-colors">
              <span className={`font-medium ${area.color}`}>{area.label}</span>
              <span className="text-gray-400">{detail}</span>
              <ArrowRight size={11} className="ml-auto text-gray-200 group-hover:text-blue-500 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
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
          <span title={`Results are stale:\n${area.staleDetails.map(detail => `• ${detail}`).join('\n')}\n\nRe-run the affected analyses to refresh their results.`}
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
