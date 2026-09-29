// The signed-in demo (/?demo, see demo-mode.ts): a stand-in for the Worker's
// account routes, installed over window.fetch before the page starts. It holds
// a made-up person, Alex, with lists of their own, a shared list they made and
// one they joined, and answers /api/me, /api/my-feeds, /api/notifications,
// /api/unfollow and every /api/shared route from that, in memory: a reload
// starts over. What anyone may read without an account (a list's links and
// posters, a title's details) still comes from the live Worker, marked as the
// signed-in person's where the page asks.
//
// Every answer is typed with the page's own API types, so a change to the API
// that the demo does not follow fails the build instead of the demo.
import {
  isSupportedImdbUrl,
  type CreateFeedResponse,
  type MyFeed,
  type Session,
  type SharedInvite,
  type SharedList,
  type SharedMember,
  type SharedSource,
} from '@/lib/api'
import { DEMO_GAME_NIGHT_INVITE as GAME_NIGHT_INVITE, DEMO_PARAM, demoLayout } from '@/lib/demo-mode'

const YOU = 'Alex'
const MAX_SOURCES = 25
// A list added in the demo is "read from IMDb" this long after it was added.
const DEMO_READ_DELAY_MS = 12_000

// Real, public lists the live site has already read (home-sections.tsx's
// examples), so their counts, links and posters are the real ones.
const LISTS = {
  movies: { title: 'The 100 greatest movies', url: 'https://www.imdb.com/list/ls055592025/' },
  tv: { title: 'Variety’s 100 greatest TV shows', url: 'https://www.imdb.com/list/ls522130686/' },
  marvel: { title: 'Every Marvel movie and show', url: 'https://www.imdb.com/list/ls505369170/' },
  oscars: { title: 'Every Best Picture winner', url: 'https://www.imdb.com/list/ls009480135/' },
  ghibli: { title: 'Every Studio Ghibli film', url: 'https://www.imdb.com/list/ls575362999/' },
} as const

// Alex's own watchlist, which is private on IMDb: it is what makes the alert
// bell and a failing row show. It is never sent to the live Worker.
const PRIVATE_WATCHLIST = 'https://www.imdb.com/user/ur00000001/watchlist/'
const PRIVATE_ERROR = 'This watchlist is private on IMDb. Make it public there, and the next read picks it up.'

type ListStats = { title: string; status: MyFeed['status']; lastSyncedAt: string | null; movies: number; shows: number; total: number }

const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

// ── The live Worker, for what is public ──────────────────────────────────────

let realFetch: typeof window.fetch

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function refuse(error: string, status = 400): Response {
  return json({ error }, status)
}

/** The IMDb key a link names (ls…, p.…, ur…), so two spellings of one list count once. */
function listKey(url: string): string {
  const match = url.match(/\/list\/(ls\d+)|\/user\/((?:p\.[a-z0-9]+|ur\d+))\/watchlist/i)
  return (match?.[1] ?? match?.[2] ?? url).toLowerCase()
}

function canonicalUrl(url: string): string {
  const key = listKey(url)
  return key.startsWith('ls') ? `https://www.imdb.com/list/${key}/` : `https://www.imdb.com/user/${key}/watchlist/`
}

/** The Worker's feed slug: the first 12 hex of the canonical URL's SHA-256 (hashText in src/imdb.js). */
async function feedSlug(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalUrl(url)))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}

function feedPath(url: string, target: 'radarr' | 'sonarr'): string {
  const key = listKey(url)
  return `/${target}/${key.startsWith('ls') ? 'l' : 'p'}/${key}`
}

/** A real list's counts from the live Worker's read-only status route; made-up ones if it cannot answer. */
async function realStats(url: string, fallback: string): Promise<ListStats> {
  try {
    const response = await realFetch(`/api/feeds/${await feedSlug(url)}`)
    if (!response.ok) throw new Error('unavailable')
    const status = (await response.json()) as CreateFeedResponse
    return {
      title: status.listTitle || fallback,
      status: status.status,
      lastSyncedAt: status.lastSyncedAt,
      movies: status.radarrCount,
      shows: status.sonarrCount,
      total: status.totalCount,
    }
  } catch {
    return { title: fallback, status: 'ready', lastSyncedAt: ago(0.2 * HOUR), movies: 60, shows: 40, total: 100 }
  }
}

// ── The made-up account ──────────────────────────────────────────────────────

type DemoSource = { url: string; addedBy: string; stats: ListStats | null; readAt: number }
type DemoMember = { id: number; name: string }
type DemoShared = {
  slug: string
  name: string
  owner: string
  inviteCode: string
  members: DemoMember[]
  sources: DemoSource[]
}

let nextId = 100
const stats = new Map<string, ListStats>()
// Each list's real feed slug, so the page can read its covers from the live Worker.
const slugs = new Map<string, string>()

async function ensureSlug(url: string) {
  if (isSupportedImdbUrl(url) && !slugs.has(listKey(url))) slugs.set(listKey(url), await feedSlug(url))
}

function slugOf(url: string): string {
  return slugs.get(listKey(url)) ?? listKey(url)
}
const myFeeds: string[] = [LISTS.movies.url, LISTS.ghibli.url, PRIVATE_WATCHLIST]
const shared: DemoShared[] = []

function randomHex(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

function member(name: string): DemoMember {
  nextId += 1
  return { id: nextId, name }
}

function source(url: string, addedBy: string): DemoSource {
  return { url, addedBy, stats: stats.get(listKey(url)) ?? null, readAt: 0 }
}

async function seed() {
  const known = Object.values(LISTS)
  await Promise.all([...known.map((list) => list.url), PRIVATE_WATCHLIST].map(ensureSlug))
  const read = await Promise.all(known.map((list) => realStats(list.url, list.title)))
  known.forEach((list, index) => stats.set(listKey(list.url), read[index]))
  stats.set(listKey(PRIVATE_WATCHLIST), {
    title: 'Alex’s old watchlist',
    status: 'error',
    lastSyncedAt: ago(26 * HOUR),
    movies: 0,
    shows: 0,
    total: 0,
  })

  shared.push(
    {
      slug: 'de0000000001',
      name: 'Our house',
      owner: YOU,
      inviteCode: randomHex(32),
      members: [member(YOU), member('Sam'), member('Jordan')],
      sources: [source(LISTS.movies.url, YOU), source(LISTS.tv.url, 'Sam'), source(LISTS.marvel.url, 'Jordan')],
    },
    {
      slug: 'de0000000002',
      name: 'Movie night',
      owner: 'Riley',
      inviteCode: randomHex(32),
      members: [member('Riley'), member(YOU)],
      sources: [source(LISTS.oscars.url, 'Riley'), source(LISTS.ghibli.url, YOU)],
    },
  )
}

const seeded = { promise: null as Promise<void> | null }
function ready() {
  seeded.promise ??= seed()
  return seeded.promise
}

/** A list added in the demo is "read" a few seconds later, the way the sync job would. */
function settle(entry: DemoSource) {
  if (entry.stats || Date.now() < entry.readAt) return
  entry.stats = stats.get(listKey(entry.url)) ?? {
    title: `IMDb list ${listKey(entry.url)}`,
    status: 'ready',
    lastSyncedAt: new Date().toISOString(),
    movies: 18,
    shows: 6,
    total: 24,
  }
}

function sourceView(entry: DemoSource, youOwn: boolean): SharedSource {
  settle(entry)
  const read = entry.stats
  const failing = read?.status === 'error'
  return {
    slug: slugOf(entry.url),
    sourceUrl: canonicalUrl(entry.url),
    listTitle: read?.title ?? '',
    status: read?.status ?? 'pending',
    itemCount: read?.total ?? 0,
    lastSyncedAt: read?.lastSyncedAt ?? null,
    lastError: failing ? PRIVATE_ERROR : null,
    consecutiveFailures: failing ? 3 : 0,
    alerting: failing,
    addedBy: entry.addedBy,
    yours: entry.addedBy === YOU,
    removable: youOwn || entry.addedBy === YOU,
  }
}

function sharedView(list: DemoShared): SharedList {
  const owner = list.owner === YOU
  const sources = list.sources.map((entry) => sourceView(entry, owner))
  const read = list.sources.map((entry) => entry.stats).filter((value): value is ListStats => Boolean(value))
  const members: SharedMember[] = list.members.map((person) => ({
    id: person.id,
    name: person.name,
    owner: person.name === list.owner,
    you: person.name === YOU,
  }))
  return {
    slug: list.slug,
    name: list.name,
    owner,
    radarrUrl: `${window.location.origin}/radarr/s/${list.slug}`,
    sonarrUrl: `${window.location.origin}/sonarr/s/${list.slug}`,
    inviteUrl: owner ? joinUrl(list.inviteCode) : null,
    movieCount: read.reduce((sum, value) => sum + value.movies, 0),
    showCount: read.reduce((sum, value) => sum + value.shows, 0),
    members,
    sources,
  }
}

// A demo join link keeps the layout being looked at.
function joinUrl(code: string): string {
  return `${window.location.origin}/?${DEMO_PARAM}=${demoLayout()}&join=${code}`
}

function mine() {
  return shared.filter((list) => list.members.some((person) => person.name === YOU))
}

function lists(extra: Record<string, unknown> = {}): Response {
  return json({ lists: mine().map(sharedView), ...extra })
}

function myFeedView(url: string): MyFeed {
  const read = stats.get(listKey(url))
  const failing = read?.status === 'error'
  return {
    slug: slugOf(url),
    sourceUrl: canonicalUrl(url),
    listTitle: read?.title ?? '',
    status: read?.status ?? 'pending',
    itemCount: read?.total ?? 0,
    lastSyncedAt: read?.lastSyncedAt ?? null,
    lastError: failing ? PRIVATE_ERROR : null,
    consecutiveFailures: failing ? 3 : 0,
    alerting: failing,
    radarrUrl: `${window.location.origin}${feedPath(url, 'radarr')}`,
    sonarrUrl: `${window.location.origin}${feedPath(url, 'sonarr')}`,
  }
}

// ── The routes ───────────────────────────────────────────────────────────────

function cleanName(value: unknown): string | null {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return name || null
}

function addSource(list: DemoShared, url: string): Response | null {
  if (!isSupportedImdbUrl(url)) return refuse('That link is not a public IMDb list or watchlist. Check it and try again.')
  if (list.sources.some((entry) => listKey(entry.url) === listKey(url))) {
    return refuse(`That IMDb list is already in "${list.name}".`, 409)
  }
  if (list.sources.length >= MAX_SOURCES) return refuse(`A shared list can hold up to ${MAX_SOURCES} IMDb lists.`)
  list.sources.push({ url, addedBy: YOU, stats: null, readAt: Date.now() + DEMO_READ_DELAY_MS })
  return null
}

function createShared(body: { name?: unknown; sourceUrls?: unknown }): Response {
  const name = cleanName(body.name)
  if (!name) return refuse('Give the shared list a name.')
  const urls = Array.isArray(body.sourceUrls) ? body.sourceUrls.map((url) => String(url).trim()).filter(Boolean) : []
  const bad = urls.find((url) => !isSupportedImdbUrl(url))
  if (bad) return refuse(`"${bad}" is not a public IMDb list or watchlist link.`)
  const list: DemoShared = {
    slug: `de${randomHex(10)}`,
    name,
    owner: YOU,
    inviteCode: randomHex(32),
    members: [member(YOU)],
    sources: [],
  }
  for (const url of urls) addSource(list, url)
  shared.push(list)
  return lists({ slug: list.slug })
}

function actOnShared(list: DemoShared, action: string, body: Record<string, unknown>): Response {
  const owner = list.owner === YOU
  const ownerOnly = () => refuse('Only the person who made this shared list can do that.', 403)

  if (action === 'sources') {
    return addSource(list, String(body.sourceUrl ?? '').trim()) ?? lists()
  }
  if (action === 'sources/remove') {
    const index = list.sources.findIndex((entry) => slugOf(entry.url) === String(body.feedSlug))
    if (index < 0 || (!owner && list.sources[index].addedBy !== YOU)) {
      return refuse('You can only remove the lists you added.', 403)
    }
    list.sources.splice(index, 1)
    return lists()
  }
  if (action === 'members/remove') {
    const leaving = list.members.find((person) => person.id === Number(body.memberId))
    if (!leaving) return lists()
    if (leaving.name === YOU && owner) return refuse('You made this shared list, so delete it rather than leave it.')
    if (leaving.name !== YOU && !owner) return refuse('Only the person who made this shared list can remove people.', 403)
    list.members = list.members.filter((person) => person !== leaving)
    list.sources = list.sources.filter((entry) => entry.addedBy !== leaving.name)
    return lists()
  }
  if (!owner) return ownerOnly()
  if (action === 'invite') {
    list.inviteCode = randomHex(32)
  } else if (action === 'rename') {
    list.name = cleanName(body.name) ?? list.name
  } else if (action === 'delete') {
    shared.splice(shared.indexOf(list), 1)
  }
  return lists()
}

function gameNight(): DemoShared {
  let list = shared.find((entry) => entry.inviteCode === GAME_NIGHT_INVITE)
  if (!list) {
    list = {
      slug: 'de0000000003',
      name: 'Game night',
      owner: 'Casey',
      inviteCode: GAME_NIGHT_INVITE,
      members: [member('Casey'), member('Morgan')],
      sources: [source(LISTS.marvel.url, 'Casey')],
    }
    shared.push(list)
  }
  return list
}

function invitePreview(code: string): Response {
  const list = code === GAME_NIGHT_INVITE ? gameNight() : shared.find((entry) => entry.inviteCode === code)
  if (!list) return refuse('This invite link does not work any more. Ask for a new one.', 404)
  const invite: SharedInvite = {
    name: list.name,
    ownerName: list.owner,
    sourceCount: list.sources.length,
    memberCount: list.members.length,
    joined: list.members.some((person) => person.name === YOU),
  }
  return json(invite)
}

function join(code: string): Response {
  const list = code === GAME_NIGHT_INVITE ? gameNight() : shared.find((entry) => entry.inviteCode === code)
  if (!list) return refuse('This invite link does not work any more. Ask for a new one.', 404)
  if (!list.members.some((person) => person.name === YOU)) list.members.push(member(YOU))
  return lists({ slug: list.slug })
}

/**
 * A list read by the live Worker, as the signed-in person sees it: theirs, and
 * kept up to date. The private watchlist is answered here instead, failing.
 */
async function createFeed(request: Request, body: { sourceUrl?: unknown }): Promise<Response> {
  const url = String(body.sourceUrl ?? '').trim()
  if (isSupportedImdbUrl(url) && listKey(url) === listKey(PRIVATE_WATCHLIST)) {
    const view = myFeedView(PRIVATE_WATCHLIST)
    const failed: CreateFeedResponse = {
      slug: view.slug,
      listTitle: view.listTitle,
      status: 'error',
      lastSyncedAt: view.lastSyncedAt,
      lastError: PRIVATE_ERROR,
      message: PRIVATE_ERROR,
      syncing: false,
      pollAfterSeconds: 30,
      owned: true,
      autoRefreshing: true,
      preview: [],
      skippedShows: [],
      radarrRoutePath: feedPath(url, 'radarr'),
      radarrFeedUrl: view.radarrUrl,
      sonarrRoutePath: feedPath(url, 'sonarr'),
      sonarrFeedUrl: view.sonarrUrl,
      radarrCount: 0,
      sonarrCount: 0,
      sonarrUnresolvedCount: 0,
      totalCount: 0,
      signedIn: true,
    }
    return json(failed)
  }

  const response = await realFetch(request)
  if (!response.ok) return response
  const created = (await response.json()) as CreateFeedResponse
  if (isSupportedImdbUrl(url) && !myFeeds.some((entry) => listKey(entry) === listKey(url))) {
    myFeeds.push(url)
    stats.set(listKey(url), {
      title: created.listTitle,
      status: created.status,
      lastSyncedAt: created.lastSyncedAt,
      movies: created.radarrCount,
      shows: created.sonarrCount,
      total: created.totalCount,
    })
  }
  return json(asYours(created))
}

function asYours<T extends { owned: boolean; autoRefreshing: boolean; status: string; message: string }>(feed: T): T {
  return {
    ...feed,
    owned: true,
    autoRefreshing: true,
    signedIn: true,
    message: feed.status === 'ready' ? 'Ready, and we are keeping it up to date.' : feed.message,
  }
}

async function answer(request: Request, url: URL): Promise<Response | null> {
  const path = url.pathname
  const method = request.method
  const body = method === 'POST' ? ((await request.clone().json().catch(() => ({}))) as Record<string, unknown>) : {}

  if (path === '/api/me') {
    const session: Session = { signedIn: true, name: YOU, authAvailable: true }
    return json(session)
  }
  if (path === '/api/create' && method === 'POST') return createFeed(request, body)
  if (/^\/api\/feeds\/[a-f0-9]{12}$/.test(path)) {
    const response = await realFetch(request)
    return response.ok ? json(asYours(await response.json())) : response
  }

  await ready()
  // A link added here gets its real slug first, so its covers can be read like the others'.
  const links = [body.sourceUrl, ...(Array.isArray(body.sourceUrls) ? body.sourceUrls : [])]
  await Promise.all(links.filter(Boolean).map((link) => ensureSlug(String(link).trim())))
  if (path === '/api/my-feeds') return json({ feeds: myFeeds.map(myFeedView) })
  if (path === '/api/notifications') {
    const alerting = myFeeds.map(myFeedView).filter((feed) => feed.alerting)
    return json({
      count: alerting.length,
      feeds: alerting.map(({ slug, listTitle, consecutiveFailures, lastError }) => ({
        slug,
        listTitle,
        consecutiveFailures,
        lastError,
      })),
    })
  }
  if (path === '/api/unfollow' && method === 'POST') {
    const key = listKey(String(body.sourceUrl ?? ''))
    myFeeds.splice(0, myFeeds.length, ...myFeeds.filter((entry) => listKey(entry) !== key))
    return json({ ok: true })
  }
  if (path === '/api/shared') return method === 'POST' ? createShared(body) : lists()
  if (path === '/api/shared/join' && method === 'POST') return join(String(body.code ?? ''))
  const invite = path.match(/^\/api\/shared\/invite\/([a-f0-9]{32})$/)
  if (invite) return invitePreview(invite[1])
  const change = path.match(/^\/api\/shared\/([a-z0-9]+)\/(sources|sources\/remove|members\/remove|invite|rename|delete)$/)
  if (change && method === 'POST') {
    const list = mine().find((entry) => entry.slug === change[1])
    return list ? actOnShared(list, change[2], body) : refuse('There is no such shared list, or you are not in it.', 404)
  }
  return null
}

/** Put the demo in front of the page's own calls to the Worker. Everything else goes out as usual. */
export function installDemo() {
  realFetch = window.fetch.bind(window)
  void ready()
  window.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      const demoAnswer = await answer(request, url)
      if (demoAnswer) return demoAnswer
    }
    return realFetch(request)
  }
}
