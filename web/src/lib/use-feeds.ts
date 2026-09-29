// One model for the signed-in page's redesigns (demo layouts 2 and 3): a
// "feed" is one Radarr link and one Sonarr link, fed by one IMDb list (a list
// the person follows) or by several (a shared list). The page stops showing two
// kinds of thing and shows feeds; which kind a feed is only decides what it can
// do (only a shared one has people).
import { useCallback, useEffect, useState } from 'react'

import {
  changeSharedList,
  createFeed,
  createSharedList,
  readFeedStatus,
  readMyFeeds,
  readSharedLists,
  unfollowFeed,
  type MyFeed,
  type SharedList,
  type SharedMember,
  type SharedSource,
} from '@/lib/api'
import { notify } from '@/lib/notify'

export type Health = 'ready' | 'pending' | 'error'

export type Feed = {
  key: string
  kind: 'single' | 'shared'
  /** The shared list's slug, or the single list's feed slug. */
  slug: string
  name: string
  radarrUrl: string
  sonarrUrl: string
  /** True for the person who made it (always, for a single list). */
  owner: boolean
  ownerName: string | null
  inviteUrl: string | null
  members: SharedMember[]
  sources: SharedSource[]
  /** Distinct movies and shows it serves; a single list's come from its status read. */
  movies: number | null
  shows: number | null
  health: Health
  alerting: boolean
  lastSyncedAt: string | null
  /** The single list behind it, for unfollowing. */
  myFeed?: MyFeed
}

function healthOf(status: MyFeed['status']): Health {
  if (status === 'ready') return 'ready'
  if (status === 'error') return 'error'
  return 'pending'
}

function fromMyFeed(feed: MyFeed): Feed {
  return {
    key: `list:${feed.slug}`,
    kind: 'single',
    slug: feed.slug,
    name: feed.listTitle || 'IMDb list',
    radarrUrl: feed.radarrUrl,
    sonarrUrl: feed.sonarrUrl,
    owner: true,
    ownerName: null,
    inviteUrl: null,
    members: [],
    sources: [
      {
        slug: feed.slug,
        sourceUrl: feed.sourceUrl,
        listTitle: feed.listTitle,
        status: feed.status,
        itemCount: feed.itemCount,
        lastSyncedAt: feed.lastSyncedAt,
        lastError: feed.lastError,
        consecutiveFailures: feed.consecutiveFailures,
        alerting: feed.alerting,
        addedBy: null,
        yours: true,
        removable: false,
      },
    ],
    movies: null,
    shows: null,
    health: healthOf(feed.status),
    alerting: feed.alerting,
    lastSyncedAt: feed.lastSyncedAt,
    myFeed: feed,
  }
}

function fromShared(list: SharedList): Feed {
  const healths = list.sources.map((source) => healthOf(source.status))
  const health: Health = healths.includes('error') ? 'error' : healths.includes('pending') ? 'pending' : 'ready'
  const reads = list.sources.map((source) => source.lastSyncedAt).filter((value): value is string => Boolean(value))
  return {
    key: `shared:${list.slug}`,
    kind: 'shared',
    slug: list.slug,
    name: list.name,
    radarrUrl: list.radarrUrl,
    sonarrUrl: list.sonarrUrl,
    owner: list.owner,
    ownerName: list.members.find((member) => member.owner)?.name ?? null,
    inviteUrl: list.inviteUrl,
    members: list.members,
    sources: list.sources,
    movies: list.movieCount,
    shows: list.showCount,
    health: list.sources.length === 0 ? 'ready' : health,
    alerting: list.sources.some((source) => source.alerting),
    lastSyncedAt: reads.sort().at(-1) ?? null,
  }
}

// A list still being read fills in on the next sync run; until then the page asks again at this pace.
const POLL_WHILE_WAITING_MS = 20_000

/** Every feed the signed-in person has, and what they can do to them. */
export function useFeeds() {
  const [mine, setMine] = useState<MyFeed[] | null>(null)
  const [shared, setShared] = useState<SharedList[] | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(
    () =>
      Promise.all([readMyFeeds(), readSharedLists().catch(() => [] as SharedList[])]).then(([feeds, lists]) => {
        setMine(feeds)
        setShared(lists)
      }),
    [],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const feeds = mine && shared ? [...shared.map(fromShared), ...mine.map(fromMyFeed)] : null

  const waiting = Boolean(feeds?.some((feed) => feed.health === 'pending'))
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void reload(), POLL_WHILE_WAITING_MS)
    return () => clearInterval(timer)
  }, [waiting, reload])

  /** Run a change; true when it worked. A refusal shows as a toast in the server's own words. */
  async function run<T>(change: () => Promise<T>, done?: string): Promise<T | null> {
    setBusy(true)
    try {
      const result = await change()
      if (done) void notify('success', done)
      return result
    } catch (error) {
      void notify('error', error instanceof Error ? error.message : 'That did not work. Try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  /** A new feed: one link follows that list, several make a shared list. Its key, once made. */
  async function create(urls: string[], name: string): Promise<string | null> {
    if (urls.length === 1) {
      const made = await run(() => createFeed(urls[0]), 'Feed made. Copy its links into Radarr and Sonarr.')
      if (!made) return null
      await reload()
      return `list:${made.slug}`
    }
    const made = await run(() => createSharedList(name, urls), `Made "${name}" from ${urls.length} lists.`)
    if (!made) return null
    setShared(made.lists)
    return made.slug ? `shared:${made.slug}` : null
  }

  /** Change a shared list; the answer carries all of them, so they are swapped in whole. */
  async function change(feed: Feed, action: Parameters<typeof changeSharedList>[1], done?: string) {
    const result = await run(() => changeSharedList(feed.slug, action), done)
    if (result) setShared(result.lists)
    return Boolean(result)
  }

  async function unfollow(feed: Feed) {
    if (!feed.myFeed) return false
    const sourceUrl = feed.myFeed.sourceUrl
    const result = await run(() => unfollowFeed(sourceUrl).then(() => true), `Stopped following "${feed.name}".`)
    if (result) await reload()
    return Boolean(result)
  }

  return { feeds, busy, create, change, unfollow, reload }
}

export type FeedsApi = ReturnType<typeof useFeeds>

// ── Covers and counts, read from each list's public status ───────────────────

type Peek = { posters: string[]; movies: number; shows: number }
const peeks = new Map<string, Promise<Peek>>()

function readPeek(slug: string): Promise<Peek> {
  let pending = peeks.get(slug)
  if (!pending) {
    pending = readFeedStatus(slug).then(
      (status) => ({
        posters: (status.preview ?? []).map((item) => item.poster).filter((poster): poster is string => Boolean(poster)),
        movies: status.radarrCount,
        shows: status.sonarrCount,
      }),
      () => ({ posters: [], movies: 0, shows: 0 }),
    )
    peeks.set(slug, pending)
  }
  return pending
}

/** Each list's covers and counts, by feed slug; empty until read. */
export function usePeeks(slugs: string[]): Map<string, Peek> {
  const [found, setFound] = useState(new Map<string, Peek>())
  const key = slugs.join(',')
  useEffect(() => {
    let cancelled = false
    const wanted = key ? key.split(',') : []
    Promise.all(wanted.map(readPeek)).then((values) => {
      if (!cancelled) setFound(new Map(wanted.map((slug, index) => [slug, values[index]])))
    })
    return () => {
      cancelled = true
    }
  }, [key])
  return found
}

/** A feed's covers: the first from each list in turn, so every list shows. */
export function coversOf(feed: Feed, found: Map<string, Peek>, count: number): string[] {
  const lists = feed.sources.map((source) => found.get(source.slug)?.posters ?? [])
  const covers: string[] = []
  for (let index = 0; covers.length < count && lists.some((posters) => index < posters.length); index += 1) {
    for (const posters of lists) {
      if (index < posters.length && covers.length < count) covers.push(posters[index])
    }
  }
  return covers
}

/**
 * "148 movies · 119 shows", from the feed or, for a single list, from its
 * status; "Nothing read yet" for a list IMDb has never given us.
 */
export function countsOf(feed: Feed, found: Map<string, Peek>): string {
  if (feed.health !== 'ready' && feed.sources.every((source) => source.itemCount === 0)) return 'Nothing read yet'
  const peek = feed.kind === 'single' ? found.get(feed.slug) : undefined
  const movies = feed.movies ?? peek?.movies
  const shows = feed.shows ?? peek?.shows
  if (movies === undefined || shows === undefined) return `${feed.sources[0]?.itemCount ?? 0} titles`
  return `${movies} movie${movies === 1 ? '' : 's'} · ${shows} show${shows === 1 ? '' : 's'}`
}
