export type FeedStatus = 'pending' | 'syncing' | 'ready' | 'error'

/** Where a feed stands. Both /api/create and the status poll return these fields. */
export type FeedStatusResponse = {
  slug: string
  listTitle: string
  status: FeedStatus
  lastSyncedAt: string | null
  lastError: string | null
  message: string
  /** A read from IMDb is pending, so the page keeps asking. */
  syncing: boolean
  /** How long to wait before asking again while `syncing`. */
  pollAfterSeconds: number
  owned: boolean
  autoRefreshing: boolean
  /** The list's first titles, for the page to show what it read. */
  preview?: PreviewItem[]
  /** Every show Sonarr's list leaves out for want of a TVDB id. */
  skippedShows?: SkippedShow[]
}

/** A show with no TVDB id; no year means IMDb has it as announced but never released. */
export type SkippedShow = {
  imdbId: string
  title: string
  year: number | null
}

/** One title from the list, and which app it goes to (a show with no TVDB id is skipped). */
export type PreviewItem = {
  imdbId: string
  title: string
  year: number | null
  target: 'radarr' | 'sonarr' | 'skipped'
  /** A small cover from IMDb's image host, or null when IMDb has none. */
  poster?: string | null
}

/** One title's details for the poster popup, from TMDB via the Worker. */
export type TitleDetails = {
  imdbId: string
  mediaType: 'movie' | 'tv'
  title: string
  year: number | null
  overview: string
  genres: string[]
  runtimeMinutes: number | null
  seasons: number | null
  rating: number | null
  posterUrl: string | null
  backdropUrl: string | null
  trailerKey: string | null
}

export type CreateFeedResponse = FeedStatusResponse & {
  radarrRoutePath: string
  radarrFeedUrl: string
  sonarrRoutePath: string
  sonarrFeedUrl: string
  radarrCount: number
  sonarrCount: number
  sonarrUnresolvedCount: number
  totalCount: number
  signedIn: boolean
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

const IMDB_LIST_RE =
  /^https?:\/\/(?:www\.|m\.)?imdb\.com(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/list\/ls\d+\/?(?:[?#].*)?$/i
const IMDB_WATCHLIST_RE =
  /^https?:\/\/(?:www\.|m\.)?imdb\.com(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/user\/(?:p\.[a-z0-9]+|ur\d+)\/watchlist\/?(?:[?#].*)?$/i

/** Mirrors the Worker's `normalizeImdbUrl` so the field can validate before a round trip. */
export function isSupportedImdbUrl(value: string): boolean {
  const trimmed = value.trim()
  return IMDB_LIST_RE.test(trimmed) || IMDB_WATCHLIST_RE.test(trimmed)
}

/** POST a JSON body to one of the Worker's routes; a non-2xx answer throws its `error` text. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string } | null)?.error ??
        `Request failed with status ${response.status}.`,
    )
  }

  return payload as T
}

export function createFeed(sourceUrl: string): Promise<CreateFeedResponse> {
  return postJson<CreateFeedResponse>('/api/create', { sourceUrl: sourceUrl.trim() })
}

/** Where one feed stands, with its counts; the page polls this while a read from IMDb is pending. */
export type FeedStatusWithCounts = FeedStatusResponse &
  Pick<CreateFeedResponse, 'radarrCount' | 'sonarrCount' | 'sonarrUnresolvedCount' | 'totalCount'>

export async function readFeedStatus(slug: string): Promise<FeedStatusWithCounts> {
  const response = await fetch(`/api/feeds/${encodeURIComponent(slug)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Status check failed with status ${response.status}.`)
  return (await response.json()) as FeedStatusWithCounts
}

// Each title is looked up once per visit; the Worker caches it for a day too.
const titleDetailsCache = new Map<string, Promise<TitleDetails>>()

/** A title's details for the poster popup; rejects with a readable reason when there are none. */
export function readTitleDetails(imdbId: string): Promise<TitleDetails> {
  let pending = titleDetailsCache.get(imdbId)
  if (!pending) {
    pending = fetch(`/api/title/${encodeURIComponent(imdbId)}`).then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error ?? 'No details for this title right now.')
      }
      return payload as TitleDetails
    })
    // A failure is not remembered, so opening the title again tries again.
    pending.catch(() => titleDetailsCache.delete(imdbId))
    titleDetailsCache.set(imdbId, pending)
  }
  return pending
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

// WHY: /api/unfollow (src/index.js) has existed since claiming shipped, but
// nothing in the SPA ever called it - a signed-in visitor could see a feed in
// "My feeds" but had no way to stop auto-refreshing it short of the raw API.
/** Stops auto-refreshing a claimed feed. The feed's Radarr/Sonarr URLs keep serving its last snapshot. */
export async function unfollowFeed(sourceUrl: string): Promise<void> {
  await postJson<{ ok: boolean }>('/api/unfollow', { sourceUrl })
}
