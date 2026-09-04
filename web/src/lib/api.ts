export type FeedStatus = 'pending' | 'syncing' | 'ready' | 'error'

export type CreateFeedResponse = {
  slug: string
  listTitle: string
  radarrRoutePath: string
  radarrFeedUrl: string
  sonarrRoutePath: string
  sonarrFeedUrl: string
  status: FeedStatus
  radarrCount: number
  sonarrCount: number
  sonarrUnresolvedCount: number
  totalCount: number
  message: string
  syncing: boolean
  signedIn: boolean
  autoRefreshing: boolean
}

export type Session = {
  signedIn: boolean
  name: string | null
  authAvailable: boolean
}

export type MyFeed = {
  slug: string
  sourceUrl: string
  listTitle: string
  status: FeedStatus
  itemCount: number
  lastSyncedAt: string | null
  lastError: string | null
  consecutiveFailures: number
  /** True once a feed has failed enough syncs in a row to need attention. */
  alerting: boolean
  radarrUrl: string
  sonarrUrl: string
}

export type NotificationsResponse = {
  count: number
  feeds: Array<{
    slug: string
    listTitle: string
    consecutiveFailures: number
    lastError: string | null
  }>
}

const IMDB_LIST_RE = /^https?:\/\/(?:www\.)?imdb\.com\/list\/ls\d+\/?(?:[?#].*)?$/i
const IMDB_WATCHLIST_RE =
  /^https?:\/\/(?:www\.)?imdb\.com\/user\/(?:p\.[a-z0-9]+|ur\d+)\/watchlist\/?(?:[?#].*)?$/i

/** Mirrors the Worker's `normalizeImdbUrl` so the field can validate before a round trip. */
export function isSupportedImdbUrl(value: string): boolean {
  const trimmed = value.trim()
  return IMDB_LIST_RE.test(trimmed) || IMDB_WATCHLIST_RE.test(trimmed)
}

export async function createFeed(sourceUrl: string): Promise<CreateFeedResponse> {
  const response = await fetch('/api/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceUrl: sourceUrl.trim() }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string } | null)?.error ??
        `Request failed with status ${response.status}.`,
    )
  }

  return payload as CreateFeedResponse
}

export async function readSession(): Promise<Session> {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' })
    if (!response.ok) throw new Error('unavailable')
    return (await response.json()) as Session
  } catch {
    return { signedIn: false, name: null, authAvailable: false }
  }
}

/** The signed-in visitor's claimed feeds, each with its own sync health. Empty for a signed-out visitor. */
export async function readMyFeeds(): Promise<MyFeed[]> {
  try {
    const response = await fetch('/api/my-feeds', { credentials: 'same-origin' })
    if (!response.ok) throw new Error('unavailable')
    const payload = (await response.json()) as { feeds?: MyFeed[] }
    return payload.feeds ?? []
  } catch {
    return []
  }
}

/** Just the feeds that have crossed the failure threshold, for a header badge. */
export async function readNotifications(): Promise<NotificationsResponse> {
  try {
    const response = await fetch('/api/notifications', { credentials: 'same-origin' })
    if (!response.ok) throw new Error('unavailable')
    return (await response.json()) as NotificationsResponse
  } catch {
    return { count: 0, feeds: [] }
  }
}
