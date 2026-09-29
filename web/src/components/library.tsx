// The signed-in page: a library of feeds. Feeds down the side (a row of cards
// on a phone), the one picked filling the rest: its cover and name, its two
// copy buttons, then its lists and a strip of what is on it. It shows only
// what the moment needs: no side list for a single feed, the Radarr and Sonarr
// setup open only for a feed just made, a list's details only when its row is
// opened, people and the join link in a Share window, the rare actions
// behind a ⋯. A brand-new account starts on the one thing it can do.
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangleIcon, ChevronDownIcon, PlusIcon, UsersIcon } from 'lucide-react'

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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { PreviewItem, Session } from '@/lib/api'
import { NEEDS_ATTENTION } from '@/lib/feed-page'
import { lazyPart } from '@/lib/lazy'
import { scrollBehavior } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { countsOf, coversOf, titlesOf, unread, useFeeds, usePeeks, type Feed, type FeedsApi } from '@/lib/use-feeds'

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

function FeedSign({ feed }: { feed: Feed }) {
  if (feed.alerting) return <AlertTriangleIcon className="text-destructive size-4 shrink-0" aria-label="Needs attention" />
  if (feed.health === 'pending') return <HealthDot health="pending" label="" className="shrink-0" />
  return null
}

function Sidebar({
  feeds,
  current,
  peeks,
  onPick,
  onNew,
}: {
  feeds: Feed[]
  current: Feed
  peeks: Peeks
  onPick: (key: string) => void
  onNew: () => void
}) {
  const list = useRef<HTMLUListElement>(null)
  const marker = useRef<HTMLSpanElement>(null)
  const cards = useRef<HTMLElement>(null)

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

  // On a phone, the card picked comes fully into view.
  useEffect(() => {
    cards.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest', inline: 'nearest' })
  }, [current.key])

  return (
    <>
      {/* A phone: the feeds as a row of cards to swipe through. */}
      <nav
        ref={cards}
        aria-label="Your feeds"
        className="scrollbar-quiet -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pt-1 pb-2 md:hidden"
      >
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
                'bg-card ring-foreground/10 animation-delay-var flex w-36 shrink-0 snap-start flex-col gap-2 rounded-xl p-2.5 text-left ring-1 transition-[box-shadow,transform] duration-300 ease-(--ease-soft) motion-safe:animate-rise',
                active ? 'ring-primary ring-2' : 'active:scale-[0.98]',
              )}
            >
              <CoverMosaic posters={coversOf(feed, peeks, 4)} className="aspect-square w-full" />
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <span className="min-w-0 flex-1 truncate">{feed.name}</span>
                <FeedSign feed={feed} />
              </span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={onNew}
          className="text-muted-foreground border-foreground/20 hover:text-foreground hover:border-foreground/40 flex w-24 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs font-medium transition-colors"
        >
          <PlusIcon className="size-5" />
          New feed
        </button>
      </nav>

      {/* Wider: a column, like a music app's playlists. */}
      <nav aria-label="Your feeds" className="bg-card ring-foreground/10 sticky top-18 hidden rounded-xl p-2 ring-1 md:block">
        <div className="flex items-center justify-between ps-2 pt-1 pb-2">
          <h2 className="text-sm font-bold">Your feeds</h2>
          <Button type="button" variant="ghost-muted" size="icon" onClick={onNew} aria-label="New feed" title="New feed">
            <PlusIcon />
          </Button>
        </div>
        {/* minmax(0, 1fr): a long name truncates inside the column instead of widening it. */}
        <ul ref={list} className="relative grid grid-cols-[minmax(0,1fr)] gap-0.5">
          <span
            ref={marker}
            aria-hidden="true"
            className="bg-accent absolute inset-x-0 top-0 h-(--pick-h) translate-y-(--pick-y) rounded-lg ease-(--ease-soft) data-placed:transition-[translate,height] data-placed:duration-350 motion-reduce:transition-none"
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
                  <CoverMosaic
                    posters={coversOf(feed, peeks, 4)}
                    className="size-10 transition-transform duration-300 ease-(--ease-soft) group-hover/feed:scale-105"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{feed.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {feed.kind === 'shared' ? `${feed.members.length} people · ${sizeOf(feed, peeks)}` : sizeOf(feed, peeks)}
                    </span>
                  </span>
                  <FeedSign feed={feed} />
                </button>
              </li>
            )
          })}
        </ul>
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
  /** Beside the name, top right: the New feed button when there is no side list to hold it. */
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
      <header className={cn('relative flex flex-col gap-5 sm:flex-row sm:items-end', corner && 'pe-28 sm:pe-32')}>
        {/* On a phone the picked card above already shows this cover. */}
        <div className="hidden md:block motion-safe:animate-pop">
          <CoverMosaic
            posters={titles.slice(0, 4).map((item) => item.poster as string)}
            className="size-40 rounded-xl shadow-lg shadow-black/30"
          />
        </div>
        <div className="min-w-0 flex-1 motion-safe:animate-rise">
          {eyebrow && <p className="text-ink text-ui mb-1 font-bold tracking-wider uppercase">{eyebrow}</p>}
          {renaming ? (
            <RenameField
              feed={feed}
              api={api}
              onDone={() => setRenaming(false)}
              className="h-12 text-2xl font-bold tracking-tight sm:text-3xl"
            />
          ) : (
            <h2 id="feed-title" className="truncate text-3xl font-bold tracking-tight sm:text-4xl">
              {feed.name}
            </h2>
          )}
          <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {!(feed.health === 'pending' && unread(feed)) && (
              <>
                <span>{countsOf(feed, peeks)}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <HealthDot health={feed.health} label={health} className={feed.health === 'error' ? 'text-destructive' : undefined} />
          </p>
        </div>
        {corner && <div className="absolute top-0 right-0">{corner}</div>}
      </header>

      <div className="animation-delay-var mt-6 flex flex-wrap items-center gap-2 motion-safe:animate-rise" style={beat(1)}>
        <CopyAppButton app="Radarr" url={feed.radarrUrl} variant="cta" size="cta" />
        <CopyAppButton app="Sonarr" url={feed.sonarrUrl} variant="cta" size="cta" />
        {shared && (
          <Button type="button" variant="secondary" size="cta" onClick={onShare}>
            <UsersIcon />
            Share
            <AvatarStack members={feed.members} max={3} className="ms-1" />
          </Button>
        )}
        <FeedMenu feed={feed} api={api} onGone={onGone} onRename={() => setRenaming(true)} />
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
                <span className="text-muted-foreground">put these two links in Radarr and Sonarr, and they fill in from here.</span>
              </p>
            )}
            <SetupSteps feed={feed} />
          </div>
        </Fold>
      </div>

      <section className="animation-delay-var mt-8 motion-safe:animate-rise" style={beat(3)} aria-labelledby="lists-title">
        <h3 id="lists-title" className="border-b pb-2 font-bold">
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
          <ul className="scrollbar-quiet -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
            {titles.map((item, index) => (
              <li key={item.imdbId} className="animation-delay-var shrink-0 motion-safe:animate-rise" style={beat(index + 4)}>
                <button
                  type="button"
                  onClick={() => onOpenTitle(item)}
                  aria-label={item.year ? `${item.title} (${item.year})` : item.title}
                  title={item.title}
                  className="group/poster bg-secondary ring-foreground/10 focus-visible:ring-ring block h-36 w-24 overflow-hidden rounded-md ring-1 transition-[box-shadow,translate] duration-300 ease-(--ease-soft) outline-none hover:-translate-y-1 hover:shadow-lg hover:shadow-black/40 focus-visible:ring-2"
                >
                  <CoverImage src={item.poster as string} className="transition-transform duration-500 group-hover/poster:scale-105" />
                </button>
              </li>
            ))}
          </ul>
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
      <h1 id="first-feed-title" className="animation-delay-var mt-2 text-3xl font-bold tracking-tight motion-safe:animate-rise sm:text-4xl" style={beat(1)}>
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
          <Button type="button" variant="secondary" size="sm" onClick={() => setDialog({ open: 'new' })}>
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
      {feeds.length === 0 ? (
        <FirstRun api={api} firstName={firstName} draft={draft} onMade={made} />
      ) : feeds.length === 1 ? (
        <div className="pt-8 pb-4 sm:pt-10">{detail}</div>
      ) : (
        // minmax(0, 1fr) on a phone too: the row of feed cards would otherwise widen the column past the screen.
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pt-8 pb-4 sm:pt-10 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-w-0 md:self-start">
            <Sidebar feeds={feeds} current={current} peeks={peeks} onPick={pick} onNew={() => setDialog({ open: 'new' })} />
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
