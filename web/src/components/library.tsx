// The signed-in page: a library of feeds. The one picked fills the page: its
// cover and name, the Add to Radarr / Sonarr bookmark and its two links, then
// its lists and a strip of what is on it. The feeds themselves sit in a rail of
// covers that opens on hover (pills on a phone), so the feed is what the eye
// works on. It shows only
// what the moment needs: no side list for a single feed, the Radarr and Sonarr
// setup open only for a feed just made, a list's details only when its row is
// opened, people and the join link in a Share window, the rare actions
// behind a ⋯. A brand-new account starts on the one thing it can do.
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon, PinIcon, PinOffIcon, PlusIcon, UsersIcon } from 'lucide-react'

import { AskProvider } from '@/components/ask'
import {
  AddSource,
  AvatarStack,
  CopyAppButton,
  CoverImage,
  CoverMosaic,
  FeedMenu,
  Fold,
  HealthDot,
  InviteLink,
  NewFeedForm,
  PeopleList,
  RenameField,
  SetupSteps,
  SourceRow,
} from '@/components/feed-bits'
import { LibrarySkeleton } from '@/components/library-skeleton'
import { ScrollRow } from '@/components/scroll-row'
import { BookmarkSticker } from '@/components/one-click-setup'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { PreviewItem, Session } from '@/lib/api'
import { NEEDS_ATTENTION } from '@/lib/feed-page'
import { lazyPart } from '@/lib/lazy'
import { scrollBehavior } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { countsOf, coversOf, peopleIn, titlesOf, unread, useFeeds, usePeeks, type Feed, type FeedsApi } from '@/lib/use-feeds'

const TitleDialog = lazyPart(() => import('@/components/title-dialog').then((module) => module.TitleDialog))

type Peeks = ReturnType<typeof usePeeks>

/** A feed the page just brought here: made (it needs setting up) or joined (it wants your lists). */
type Fresh = { key: string; why: 'made' | 'joined' }

function freshFor(key: string): Fresh {
  return { key, why: key.startsWith('shared:') ? 'joined' : 'made' }
}

/** A stagger step for things rising in one after another. */
function beat(step: number) {
  return { '--delay': `${Math.min(step, 12) * 45}ms` }
}

/** How big a feed is, in a word or two, for the side list. */
function sizeOf(feed: Feed, peeks: Peeks): string {
  if (unread(feed)) return feed.health === 'error' ? 'Cannot be read' : 'Reading from IMDb'
  const peek = feed.kind === 'single' ? peeks.get(feed.slug) : undefined
  const counted = (feed.movies ?? peek?.movies ?? 0) + (feed.shows ?? peek?.shows ?? 0)
  const total = counted || feed.sources.reduce((sum, source) => sum + source.itemCount, 0)
  return `${total} title${total === 1 ? '' : 's'}`
}

/** A dot on a feed's cover when it needs a look: red, a list keeps failing; amber, breathing, being read. */
function FeedSign({ feed }: { feed: Feed }) {
  if (!feed.alerting && feed.health !== 'pending') return null
  return (
    <span
      className={cn(
        'ring-card absolute -top-1 -right-1 size-2.5 rounded-full ring-2',
        feed.alerting ? 'bg-destructive' : 'breathe bg-amber-400 text-amber-400',
      )}
    >
      <span className="sr-only">{feed.alerting ? 'Needs attention' : 'Reading from IMDb'}</span>
    </span>
  )
}

// How long the bookmark's line stays after it is dropped or clicked, before it folds away again.
const BOOKMARK_HINT_MS = 8000

/** The bookmark's line, for what the visitor is doing with it right now. */
const BOOKMARK_HINTS = {
  dragging: 'Drop it on your bookmarks bar. Then click it inside Radarr or Sonarr: it adds this feed there for you.',
  dropped: 'Now open Radarr or Sonarr and click the bookmark there: it adds this feed for you.',
  clicked: 'Drag it to your bookmarks bar first, then click it inside Radarr or Sonarr.',
} as const

// Whether the side list stays open; otherwise it is a rail of covers that opens while the pointer is on it.
const PINNED_KEY = 'watcharr:feeds-pinned'

function readPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_KEY) === '1'
  } catch {
    return false
  }
}

function writePinned(pinned: boolean) {
  try {
    if (pinned) localStorage.setItem(PINNED_KEY, '1')
    else localStorage.removeItem(PINNED_KEY)
  } catch {
    // No storage: it stays as picked until the page is left.
  }
}

function Sidebar({
  feeds,
  current,
  peeks,
  pinned,
  onPin,
  onPick,
  onNew,
}: {
  feeds: Feed[]
  current: Feed
  peeks: Peeks
  pinned: boolean
  onPin: (pinned: boolean) => void
  onPick: (key: string) => void
  onNew: () => void
}) {
  const list = useRef<HTMLUListElement>(null)
  const marker = useRef<HTMLSpanElement>(null)
  const pills = useRef<HTMLElement>(null)
  // Labels show when the list is pinned open, or while the rail is open under the pointer or the keyboard.
  const label = pinned
    ? ''
    : 'opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100 motion-reduce:transition-none'

  // The highlight slides to the feed picked: placed once where it belongs, then it moves.
  useLayoutEffect(() => {
    const place = () => {
      // The row, not its button: a row rising in holds a transform, which makes it the button's offset parent.
      const active = list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.closest('li')
      const pill = marker.current
      if (!active || !pill) return
      pill.style.setProperty('--pick-y', `${active.offsetTop}px`)
      pill.style.setProperty('--pick-h', `${active.offsetHeight}px`)
    }
    place()
    const frame = requestAnimationFrame(() => marker.current?.setAttribute('data-placed', ''))
    const watcher = new ResizeObserver(place)
    if (list.current) watcher.observe(list.current)
    return () => {
      cancelAnimationFrame(frame)
      watcher.disconnect()
    }
  }, [current.key, feeds.length])

  // On a phone, the feed picked comes fully into view.
  useEffect(() => {
    pills.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest', inline: 'nearest' })
  }, [current.key])

  return (
    <>
      {/* A phone: the feeds as small pills to swipe through, so the feed below is what the eye lands on. */}
      <nav ref={pills} aria-label="Your feeds" className="scrollbar-quiet -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pt-1 pb-2 md:hidden">
        {feeds.map((feed, index) => {
          const active = feed.key === current.key
          return (
            <button
              key={feed.key}
              type="button"
              onClick={() => onPick(feed.key)}
              aria-current={active ? 'true' : undefined}
              style={beat(index)}
              className={cn(
                'bg-card ring-foreground/10 animation-delay-var flex max-w-44 shrink-0 snap-start items-center gap-2 rounded-full py-1 ps-1 pe-3.5 text-sm font-semibold ring-1 transition-[box-shadow,transform] duration-300 ease-(--ease-soft) motion-safe:animate-rise',
                active ? 'ring-primary ring-2' : 'text-muted-foreground motion-safe:active:scale-[0.97]',
              )}
            >
              <span className="relative shrink-0">
                <CoverMosaic posters={coversOf(feed, peeks, 4)} size={32} className="size-8 rounded-full" />
                <FeedSign feed={feed} />
              </span>
              <span className="truncate">{feed.name}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={onNew}
          className="text-muted-foreground border-foreground/20 hover:text-foreground flex shrink-0 snap-start items-center gap-1 rounded-full border border-dashed px-3 text-sm font-medium transition-colors"
        >
          <PlusIcon className="size-4" />
          New feed
        </button>
      </nav>

      {/*
        Wider: a rail of covers, so the feed on the right is plainly the thing to work on. It opens over
        the page while the pointer is on it or the keyboard is in it (closing a moment after, so a pass
        across it does not flicker), and the pin keeps it open, remembered in this browser. Keyboard
        focus only, not focus: a click leaves focus on the feed picked, and the rail would stay open.
        Clipped rather than hidden: a hidden overflow is still a scroll box, and focus landing in the
        folded rail scrolled it sideways, leaving the covers cut off or gone.
      */}
      <nav
        aria-label="Your feeds"
        className={cn(
          'group/rail bg-card ring-foreground/10 sticky top-18 z-30 hidden overflow-clip rounded-xl p-2 ring-1 md:block',
          'transition-[width,box-shadow] duration-300 ease-(--ease-soft) motion-reduce:transition-none',
          pinned
            ? 'w-full'
            : 'w-18 delay-150 hover:w-64 hover:shadow-2xl hover:shadow-black/50 hover:delay-0 has-[:focus-visible]:w-64 has-[:focus-visible]:delay-0 lg:hover:w-72 lg:has-[:focus-visible]:w-72',
        )}
      >
        {/* As wide as the open list, whatever the rail's width: nothing reflows while it opens. */}
        <div className="w-60 lg:w-68">
          <div className="flex items-center gap-1 pt-1 pb-2">
            <Button type="button" variant="ghost-muted" size="icon" className="ms-3" onClick={onNew} aria-label="New feed" title="New feed">
              <PlusIcon />
            </Button>
            <h2 className={cn('min-w-0 flex-1 truncate text-sm font-bold', label)}>Your feeds</h2>
            <Button
              type="button"
              variant="ghost-muted"
              size="icon"
              className={label}
              onClick={() => onPin(!pinned)}
              aria-pressed={pinned}
              aria-label={pinned ? 'Let the list fold away' : 'Keep the list open'}
              title={pinned ? 'Let the list fold away' : 'Keep the list open'}
            >
              {pinned ? <PinOffIcon /> : <PinIcon />}
            </Button>
          </div>
          {/* minmax(0, 1fr): a long name truncates inside the column instead of widening it. */}
          <ul ref={list} className="relative grid grid-cols-[minmax(0,1fr)] gap-0.5">
            <span
              ref={marker}
              aria-hidden="true"
              className={cn(
                // Folded, it hugs the cover (its 2.5rem and the row's padding); open, the whole row. The gold
                // edge is the phone pills' own, so a row under the pointer never looks picked as well.
                'bg-accent ring-primary/60 absolute top-0 left-0 ring-1 h-(--pick-h) translate-y-(--pick-y) rounded-lg ease-(--ease-soft) data-placed:transition-[translate,height,width] data-placed:duration-350 motion-reduce:transition-none',
                pinned ? 'w-full' : 'w-14 group-hover/rail:w-full group-has-[:focus-visible]/rail:w-full',
              )}
            />
            {feeds.map((feed, index) => {
              const active = feed.key === current.key
              return (
                <li key={feed.key} className="animation-delay-var min-w-0 motion-safe:animate-rise" style={beat(index)}>
                  <button
                    type="button"
                    onClick={() => onPick(feed.key)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'group/feed relative flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors',
                      !active && 'hover:bg-muted',
                    )}
                  >
                    <span className="relative shrink-0">
                      <CoverMosaic
                        posters={coversOf(feed, peeks, 4)}
                        size={40}
                        className="size-10 transition-transform duration-300 ease-(--ease-soft) motion-safe:group-hover/feed:scale-105"
                      />
                      <FeedSign feed={feed} />
                    </span>
                    <span className={cn('min-w-0 flex-1', label)}>
                      <span className="block truncate text-sm font-semibold">{feed.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {feed.kind === 'shared' ? `${peopleIn(feed.members.length)} · ${sizeOf(feed, peeks)}` : sizeOf(feed, peeks)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>
    </>
  )
}

function Detail({
  feed,
  peeks,
  api,
  fresh,
  corner,
  onGone,
  onShare,
  onCombine,
  onOpenTitle,
}: {
  feed: Feed
  peeks: Peeks
  api: FeedsApi
  fresh: Fresh | null
  /** At the far end of the buttons: the New feed button when there is no side list to hold it. */
  corner?: ReactNode
  onGone: () => void
  onShare: () => void
  onCombine: () => void
  onOpenTitle: (item: PreviewItem) => void
}) {
  const shared = feed.kind === 'shared'
  const titles = titlesOf(feed, peeks, 18)
  const [setupOpen, setSetupOpen] = useState(fresh?.why === 'made')
  const [renaming, setRenaming] = useState(false)
  // What the bookmark's line says, while it is wanted: nothing until the bookmark is dragged or clicked.
  const [bookmark, setBookmark] = useState<keyof typeof BOOKMARK_HINTS | null>(null)
  useEffect(() => {
    if (bookmark !== 'dropped' && bookmark !== 'clicked') return
    const timer = setTimeout(() => setBookmark(null), BOOKMARK_HINT_MS)
    return () => clearTimeout(timer)
  }, [bookmark])
  // Copying a link opens where it goes in the app.
  const showSetup = () => setSetupOpen(true)
  const failing = feed.sources.filter((source) => source.status === 'error').length
  const eyebrow = shared ? (feed.owner ? 'Shared feed' : `Shared by ${feed.ownerName ?? 'someone'}`) : null
  const health =
    feed.health !== 'error'
      ? undefined
      : shared
        ? `${failing} list${failing === 1 ? '' : 's'} cannot be read`
        : 'Cannot be read from IMDb'

  return (
    <article className="min-w-0" aria-labelledby="feed-title">
      <header className="flex items-end gap-4 sm:gap-5">
        <div className="shrink-0 motion-safe:animate-pop">
          <CoverMosaic
            posters={titles.slice(0, 4).map((item) => item.poster as string)}
            size={160}
            className="size-20 rounded-xl shadow-lg shadow-black/30 sm:size-28 md:size-40"
          />
        </div>
        <div className="min-w-0 flex-1 motion-safe:animate-rise">
          {eyebrow && <p className="text-ink text-ui mb-1 font-bold tracking-wider uppercase">{eyebrow}</p>}
          {renaming ? (
            // The title's own size and line, so the name turns into a field where it stands.
            <RenameField
              feed={feed}
              api={api}
              onDone={() => setRenaming(false)}
              className="-mx-2.5 -my-px h-auto py-0 text-3xl font-bold tracking-tight sm:text-4xl md:text-4xl"
            />
          ) : (
            <h2 id="feed-title" tabIndex={-1} className="line-clamp-2 text-3xl font-bold tracking-tight break-words outline-none sm:text-4xl">
              {feed.name}
            </h2>
          )}
          {/* No separator: the status has its own dot, and a line that wraps would end on one. */}
          <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {!(feed.health === 'pending' && unread(feed)) && <span>{countsOf(feed, peeks)}</span>}
            <HealthDot health={feed.health} label={health} className={feed.health === 'error' ? 'text-destructive' : undefined} />
          </p>
        </div>
      </header>

      <div
        className="animation-delay-var mt-6 flex flex-wrap items-center gap-2 motion-safe:animate-rise"
        style={{ ...beat(1), '--sticker-page': 'var(--background)' }}
      >
        {/*
          A computer has a bookmarks bar: the bookmark sets the feed up inside Radarr or Sonarr in one
          click, so it leads and the links are the other way. A phone has none, so the links lead there.
        */}
        <span className="hidden md:inline-flex">
          <BookmarkSticker
            radarrUrl={feed.radarrUrl}
            sonarrUrl={feed.sonarrUrl}
            listTitle={feed.name}
            size="lg"
            describedBy="bookmark-how"
            onHint={() => setBookmark('clicked')}
            onDragBegin={() => setBookmark('dragging')}
            onDragged={() => setBookmark('dropped')}
          />
        </span>
        {/* The two links wrap as a pair, and Share with the ⋯, so a narrow row never splits either. */}
        <span className="flex gap-2">
          <CopyAppButton app="Radarr" url={feed.radarrUrl} variant="cta" size="cta" className="md:hidden" onUse={showSetup} />
          <CopyAppButton app="Sonarr" url={feed.sonarrUrl} variant="cta" size="cta" className="md:hidden" onUse={showSetup} />
          <CopyAppButton app="Radarr" url={feed.radarrUrl} size="cta" className="hidden md:inline-flex" onUse={showSetup} />
          <CopyAppButton app="Sonarr" url={feed.sonarrUrl} size="cta" className="hidden md:inline-flex" onUse={showSetup} />
        </span>
        <span className="flex items-center gap-2">
          {shared && (
            <Button type="button" variant="secondary" size="cta" onClick={onShare}>
              <UsersIcon />
              Share
              <AvatarStack members={feed.members} max={3} className="ms-1" />
            </Button>
          )}
          <FeedMenu feed={feed} api={api} onGone={onGone} onRename={() => setRenaming(true)} />
        </span>
        {corner && <span className="ms-auto">{corner}</span>}
      </div>

      {/* What the bookmark is for, only while it is being dragged, just dropped or clicked here. */}
      <div className="hidden md:block">
        <Fold open={bookmark !== null}>
          <p id="bookmark-how" role="status" className="pt-2 text-sm font-medium text-pretty">
            {bookmark && BOOKMARK_HINTS[bookmark]}
          </p>
        </Fold>
      </div>

      <div className="animation-delay-var mt-3 motion-safe:animate-rise" style={beat(2)}>
        <button
          type="button"
          onClick={() => setSetupOpen((open) => !open)}
          aria-expanded={setupOpen}
          aria-controls="feed-setup"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md text-sm transition-colors"
        >
          Where do these go in Radarr and Sonarr?
          <ChevronDownIcon
            className={cn('size-4 transition-transform duration-300 ease-(--ease-soft)', setupOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        <Fold open={setupOpen} id="feed-setup">
          <div className="pt-3">
            {fresh?.why === 'made' && (
              <p className="mb-3 text-sm text-pretty">
                <span className="font-bold">One last step:</span>{' '}
                <span className="text-muted-foreground">
                  put these two links in Radarr and Sonarr, and they fill in from here. On a computer, the Add to Radarr / Sonarr
                  bookmark does it for you.
                </span>
              </p>
            )}
            <SetupSteps feed={feed} />
          </div>
        </Fold>
      </div>

      <section className="animation-delay-var mt-8 motion-safe:animate-rise" style={beat(3)} aria-labelledby="lists-title">
        <h3 id="lists-title" tabIndex={-1} className="-mx-2 border-b px-2 pb-2 font-bold outline-none">
          IMDb list{feed.sources.length === 1 ? '' : 's'}{' '}
          <span className="text-muted-foreground font-normal">{feed.sources.length}</span>
        </h3>
        <ul className="-mx-2 mt-1 divide-y">
          {feed.sources.map((source) => (
            <SourceRow key={source.slug} feed={feed} source={source} api={api} />
          ))}
        </ul>
        {shared ? (
          <AddSource feed={feed} api={api} defaultOpen={fresh?.why === 'joined'} />
        ) : (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground mt-1" onClick={onCombine}>
            <PlusIcon />
            Combine with another list
          </Button>
        )}
      </section>

      {titles.length > 4 && (
        <section className="animation-delay-var mt-8 motion-safe:animate-rise" style={beat(4)} aria-labelledby="on-it-title">
          <h3 id="on-it-title" className="border-b pb-2 font-bold">
            On it
          </h3>
          <ScrollRow label="titles" count={titles.length} arrowTop="top-[4.75rem]" className="-mx-1 mt-3 gap-2 px-1 pt-1 pb-2">
            {titles.map((item, index) => (
              <li key={item.imdbId} className="animation-delay-var shrink-0 motion-safe:animate-rise" style={beat(index + 4)}>
                <button
                  type="button"
                  onClick={() => onOpenTitle(item)}
                  aria-label={item.year ? `${item.title} (${item.year})` : item.title}
                  title={item.title}
                  className="group/poster bg-secondary ring-foreground/10 focus-visible:ring-ring block h-36 w-24 overflow-hidden rounded-md ring-1 transition-[box-shadow,translate] duration-300 ease-(--ease-soft) outline-none hover:shadow-lg motion-safe:hover:-translate-y-1 hover:shadow-black/40 focus-visible:ring-2"
                >
                  <CoverImage src={item.poster as string} width={96} lazy className="transition-transform duration-500 motion-safe:group-hover/poster:scale-105" />
                </button>
              </li>
            ))}
          </ScrollRow>
        </section>
      )}
    </article>
  )
}

/** A brand-new account: nothing to browse yet, so the page is the one thing to do. */
function FirstRun({
  api,
  firstName,
  draft,
  onMade,
}: {
  api: FeedsApi
  firstName: string | undefined
  draft: string[] | null
  onMade: (key: string) => void
}) {
  return (
    <section className="mx-auto max-w-xl pt-10 pb-4 sm:pt-16" aria-labelledby="first-feed-title">
      <p className="text-ink text-ui font-bold tracking-wider uppercase motion-safe:animate-rise">
        {firstName ? `Welcome, ${firstName}` : 'Welcome'}
      </p>
      <h1 id="first-feed-title" tabIndex={-1} className="outline-none animation-delay-var mt-2 text-3xl font-bold tracking-tight motion-safe:animate-rise sm:text-4xl" style={beat(1)}>
        Make your first feed
      </h1>
      <p className="text-muted-foreground animation-delay-var mt-3 text-pretty motion-safe:animate-rise" style={beat(2)}>
        Paste a public IMDb list or watchlist. You get one link for Radarr and one for Sonarr, and both keep up with
        the list.
      </p>
      <div className="bg-card ring-foreground/10 animation-delay-var mt-6 rounded-xl p-5 ring-1 motion-safe:animate-rise sm:p-6" style={beat(3)}>
        <NewFeedForm
          api={api}
          defaultName={firstName ? `${firstName}’s lists` : 'My lists'}
          initialLinks={draft ?? undefined}
          onMade={onMade}
        />
      </div>
    </section>
  )
}

export function Library({
  session,
  focus,
  draft,
  onDraftTaken,
}: {
  session: Session | null
  /** A feed to open on, as `list:<slug>` or `shared:<slug>`: one just followed or joined. */
  focus: string | null
  /** Links a new feed starts from. */
  draft: string[] | null
  onDraftTaken: () => void
}) {
  return (
    <AskProvider>
      <Shelves session={session} focus={focus} draft={draft} onDraftTaken={onDraftTaken} />
    </AskProvider>
  )
}

function Shelves({
  session,
  focus,
  draft,
  onDraftTaken,
}: {
  session: Session | null
  focus: string | null
  draft: string[] | null
  onDraftTaken: () => void
}) {
  const api = useFeeds()
  const { feeds, reload } = api
  // The feed on screen: a key, or NEEDS_ATTENTION for the first one with a failing list (the bell).
  const [picked, setPicked] = useState<string | null>(() =>
    focus ?? (typeof window !== 'undefined' && window.location.hash === `#${NEEDS_ATTENTION}` ? NEEDS_ATTENTION : null),
  )
  const [fresh, setFresh] = useState<Fresh | null>(focus ? freshFor(focus) : null)
  const [seenFocus, setSeenFocus] = useState(focus)
  const [takenDraft, setTakenDraft] = useState<string[] | null>(null)
  // Which window is open; the new feed's links stay while it closes, so it fades out whole.
  const [dialog, setDialog] = useState<{ open: 'new' | 'share' | null; links?: string[] }>({ open: null })
  const close = () => setDialog((current) => ({ ...current, open: null }))
  const [title, setTitle] = useState<{ item: PreviewItem | null; opened: boolean }>({ item: null, opened: false })
  const [pinned, setPinned] = useState(readPinned)
  const peeks = usePeeks(feeds?.flatMap((feed) => feed.sources.map((source) => source.slug)) ?? [])
  const firstName = session?.name?.trim().split(/\s+/)[0]
  const defaultName = firstName ? `${firstName}’s lists` : 'My lists'

  // A feed the page just brought here (followed, joined): open on it.
  if (focus !== seenFocus) {
    setSeenFocus(focus)
    if (focus) {
      setPicked(focus)
      setFresh(freshFor(focus))
    }
  }

  // Links to start a new feed from, once there are feeds to show behind the window (none: the first-run form has them).
  if (draft && draft !== takenDraft && feeds && feeds.length > 0) {
    setTakenDraft(draft)
    setDialog({ open: 'new', links: draft })
  }

  useEffect(() => {
    if (takenDraft) onDraftTaken()
  }, [takenDraft, onDraftTaken])

  // ...and read the feeds again, so the one just followed or joined is among them.
  const lastFocus = useRef(focus)
  useEffect(() => {
    if (focus === lastFocus.current) return
    lastFocus.current = focus
    if (focus) void reload()
  }, [focus, reload])

  // The bell in the header: open the first feed with a list that keeps failing.
  useEffect(() => {
    const tidy = () => {
      if (window.location.hash !== `#${NEEDS_ATTENTION}`) return false
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      return true
    }
    tidy()
    const onHash = () => {
      if (tidy()) setPicked(NEEDS_ATTENTION)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (feeds === null) return <LibrarySkeleton />

  // The bell's pick becomes the feed it found, so that feed stays on screen once its list reads again.
  if (picked === NEEDS_ATTENTION) setPicked(feeds.find((feed) => feed.alerting)?.key ?? null)

  const current =
    (picked === NEEDS_ATTENTION ? feeds.find((feed) => feed.alerting) : feeds.find((feed) => feed.key === picked)) ?? feeds[0]

  function made(key: string) {
    close()
    setPicked(key)
    setFresh({ key, why: 'made' })
  }

  function pick(key: string) {
    setPicked(key)
    setFresh(null)
  }

  const detail = current && (
    <Detail
      key={current.key}
      feed={current}
      peeks={peeks}
      api={api}
      fresh={fresh?.key === current.key ? fresh : null}
      corner={
        feeds.length === 1 ? (
          <Button type="button" variant="ghost" size="cta" className="text-muted-foreground" onClick={() => setDialog({ open: 'new' })}>
            <PlusIcon />
            New feed
          </Button>
        ) : undefined
      }
      onGone={() => setPicked(null)}
      onShare={() => setDialog({ open: 'share' })}
      onCombine={() => setDialog({ open: 'new', links: [current.sources[0]?.sourceUrl ?? '', ''] })}
      onOpenTitle={(item) => setTitle({ item, opened: true })}
    />
  )

  return (
    <>
      {/* The page's heading for a screen reader; the eye has the feed's name. The first-run page has its own. */}
      {feeds.length > 0 && <h1 className="sr-only">Your feeds</h1>}
      {feeds.length === 0 ? (
        <FirstRun api={api} firstName={firstName} draft={draft} onMade={made} />
      ) : feeds.length === 1 ? (
        <div className="pt-8 pb-4 sm:pt-10">{detail}</div>
      ) : (
        // minmax(0, 1fr) on a phone too: the row of feed cards would otherwise widen the column past the screen.
        <div
          className={cn(
            'grid grid-cols-[minmax(0,1fr)] gap-4 pt-8 pb-4 transition-[grid-template-columns] duration-500 ease-(--ease-soft) sm:pt-10 md:gap-8 motion-reduce:transition-none',
            pinned ? 'md:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]' : 'md:grid-cols-[4.5rem_minmax(0,1fr)]',
          )}
        >
          <aside className="min-w-0">
            <Sidebar
              feeds={feeds}
              current={current}
              peeks={peeks}
              pinned={pinned}
              onPin={(next) => {
                writePinned(next)
                setPinned(next)
              }}
              onPick={pick}
              onNew={() => setDialog({ open: 'new' })}
            />
          </aside>
          {detail}
        </div>
      )}

      <Dialog open={dialog.open === 'new'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogTitle>New feed</DialogTitle>
          <DialogDescription>
            {dialog.links && dialog.links.length > 1
              ? 'One new pair of links for all of these lists. Your other feeds stay as they are.'
              : 'One Radarr link and one Sonarr link, from one IMDb list or several.'}
          </DialogDescription>
          <NewFeedForm api={api} defaultName={defaultName} initialLinks={dialog.links} onCancel={close} onMade={made} />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog.open === 'share' && current?.kind === 'shared'} onOpenChange={(open) => !open && close()}>
        {current && (
          <DialogContent>
            <DialogTitle>Share “{current.name}”</DialogTitle>
            <DialogDescription>Everyone here adds their own IMDb lists. The two links stay the same.</DialogDescription>
            <InviteLink feed={current} api={api} />
            <div>
              <h3 className="border-b pb-2 text-sm font-bold">
                People <span className="text-muted-foreground font-normal">{current.members.length}</span>
              </h3>
              <PeopleList feed={current} api={api} />
            </div>
          </DialogContent>
        )}
      </Dialog>

      {title.opened && (
        <Suspense fallback={null}>
          <TitleDialog item={title.item} onClose={() => setTitle({ item: null, opened: true })} />
        </Suspense>
      )}
    </>
  )
}
