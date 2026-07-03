import { useEffect, useState } from 'react'

// Best-effort "is a newer release available?" check against the public GitHub
// releases API. Entirely client-side (no backend), throttled to once per day,
// and silent on any failure (offline, rate-limited, private repo) so it never
// disrupts the app.

const REPO = 'djtroyal/reliability'
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

const CHECK_TS_KEY = 'perdura-update-last-check'
const LATEST_KEY = 'perdura-update-latest'      // cache: {version,url}
const DISMISSED_KEY = 'perdura-update-dismissed' // version the user dismissed
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface UpdateInfo {
  version: string   // normalized, no leading "v"
  url: string       // release page to open
}

function parseSemver(v: string): [number, number, number] | null {
  const m = String(v).replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True iff `latest` is strictly newer than `current` (both x.y.z). Returns
 *  false when either side is unparseable (e.g. current === 'dev'). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest)
  const b = parseSemver(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

export async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  const res = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.tag_name) return null
  return {
    version: String(data.tag_name).replace(/^v/i, ''),
    url: typeof data.html_url === 'string' ? data.html_url : RELEASES_PAGE,
  }
}

/**
 * Surfaces a newer release (if any) for the given running version. Shows a
 * cached result immediately, then refreshes from GitHub at most once per day.
 * No-ops for dev builds and after the user dismisses a given version.
 */
export function useUpdateCheck(currentVersion: string): {
  update: UpdateInfo | null
  dismiss: () => void
} {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    if (!currentVersion || currentVersion === 'dev') return
    let cancelled = false

    const surface = (info: UpdateInfo | null) => {
      if (cancelled || !info) return
      if (isNewer(info.version, currentVersion) &&
          localStorage.getItem(DISMISSED_KEY) !== info.version) {
        setUpdate(info)
      }
    }

    // 1. Immediately reflect any previously-fetched latest.
    try {
      const cached = localStorage.getItem(LATEST_KEY)
      if (cached) surface(JSON.parse(cached) as UpdateInfo)
    } catch { /* ignore malformed cache */ }

    // 2. Refresh from GitHub, throttled to once per day.
    const now = Date.now()
    const last = Number(localStorage.getItem(CHECK_TS_KEY) || 0)
    if (now - last >= CHECK_INTERVAL_MS) {
      fetchLatestRelease()
        .then(info => {
          if (cancelled) return
          localStorage.setItem(CHECK_TS_KEY, String(now))
          if (info) {
            localStorage.setItem(LATEST_KEY, JSON.stringify(info))
            surface(info)
          }
        })
        .catch(() => { /* offline / rate-limited: stay silent */ })
    }

    return () => { cancelled = true }
  }, [currentVersion])

  const dismiss = () => {
    if (update) localStorage.setItem(DISMISSED_KEY, update.version)
    setUpdate(null)
  }

  return { update, dismiss }
}
