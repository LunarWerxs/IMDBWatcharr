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
}

const IMDB_LIST_RE = /^https?:\/\/(?:www\.)?imdb\.com\/list\/ls\d+\/?(?:[?#].*)?$/i
const IMDB_WATCHLIST_RE =
  /^https?:\/\/(?:www\.)?imdb\.com\/user\/[a-z0-9._-]+\/watchlist\/?(?:[?#].*)?$/i

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
