// Signed-in layout 3 (/?demo=3): a library. Feeds down the side (across the
// top on a phone), the one you picked filling the rest: its cover and name,
// its two copy buttons, then its lists and a strip of what is on it. Where the
// links go in the apps folds away until asked for; people and the join link
// live in a Share window; rename, delete and leave behind a ⋯.
import { useState } from 'react'
import { AlertTriangleIcon, ChevronDownIcon, PlusIcon, UsersIcon } from 'lucide-react'

import {
  AddSource,
  AvatarStack,
  CopyAppButton,
  CoverMosaic,
  FeedMenu,
  HealthDot,
  InviteLink,
  NewFeedForm,
  PeopleList,
  SetupSteps,
  SourceRow,
} from '@/components/feed-bits'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { Session } from '@/lib/api'
import { cn } from '@/lib/utils'
import { countsOf, coversOf, useFeeds, usePeeks, type Feed, type FeedsApi } from '@/lib/use-feeds'

type Peeks = ReturnType<typeof usePeeks>

function Sidebar({
  feeds,
  current,
  peeks,
  onPick,
  onNew,
}: {
  feeds: Feed[]
  current: Feed | undefined
  peeks: Peeks
  onPick: (key: string) => void
  onNew: () => void
}) {
  return (
    <>
      {/* A phone: the feeds as a row of cards to swipe through. */}
      <nav aria-label="Your feeds" className="scrollbar-quiet -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:hidden">
        {feeds.map((feed) => (
          <button
            key={feed.key}
            type="button"
            onClick={() => onPick(feed.key)}
            aria-current={feed.key === current?.key ? 'true' : undefined}
            className={cn(
              'bg-card ring-foreground/10 flex w-36 shrink-0 snap-start flex-col gap-2 rounded-xl p-2.5 text-left ring-1 transition-colors',
              feed.key === current?.key && 'ring-primary ring-2',
            )}
          >
            <CoverMosaic posters={coversOf(feed, peeks, 4)} className="aspect-square w-full" />
            <span className="flex items-center gap-1.5 text-sm font-bold">
              {feed.alerting && <span className="bg-destructive size-2 shrink-0 rounded-full" aria-label="Needs attention" />}
              <span className="truncate">{feed.name}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={onNew}
          className="text-muted-foreground border-foreground/20 hover:text-foreground flex w-24 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs font-medium"
        >
          <PlusIcon className="size-5" />
          New feed
        </button>
      </nav>

      {/* Wider: a column, like a music app's playlists. */}
      <nav aria-label="Your feeds" className="bg-card ring-foreground/10 sticky top-20 hidden rounded-xl p-2 ring-1 md:block">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <h2 className="text-sm font-bold">Your feeds</h2>
          <Button type="button" variant="ghost-muted" size="icon" onClick={onNew} aria-label="New feed">
            <PlusIcon />
          </Button>
        </div>
        {/* minmax(0, 1fr): a long name truncates inside the column instead of widening it. */}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {feeds.map((feed) => {
            const active = feed.key === current?.key
            return (
              <li key={feed.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onPick(feed.key)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors',
                    active ? 'bg-accent' : 'hover:bg-muted',
                  )}
                >
                  <CoverMosaic posters={coversOf(feed, peeks, 4)} className="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{feed.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {feed.kind === 'shared' ? `Shared · ${feed.members.length} people` : 'Just you'}
                    </span>
                  </span>
                  {feed.alerting ? (
                    <AlertTriangleIcon className="text-destructive size-4 shrink-0" aria-label="Needs attention" />
                  ) : (
                    feed.health === 'pending' && <span className="size-2 shrink-0 animate-pulse rounded-full bg-amber-400" aria-label="Reading" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}

function Detail({ feed, peeks, api, onGone, onShare }: { feed: Feed; peeks: Peeks; api: FeedsApi; onGone: () => void; onShare: () => void }) {
  const shared = feed.kind === 'shared'
  const covers = coversOf(feed, peeks, 24)
  const failing = feed.sources.find((source) => source.alerting || source.status === 'error')

  return (
    <article className="min-w-0" aria-labelledby="feed-title">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <CoverMosaic posters={covers.slice(0, 4)} className="size-32 rounded-xl shadow-lg shadow-black/30 sm:size-40" />
        <div className="min-w-0 flex-1">
          <p className="text-ink text-ui font-bold tracking-wider uppercase">{shared ? 'Shared feed' : 'Feed'}</p>
          <h2 id="feed-title" className="mt-1 truncate text-3xl font-bold tracking-tight sm:text-4xl">
            {feed.name}
          </h2>
          <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span>{countsOf(feed, peeks)}</span>
            <span aria-hidden="true">·</span>
            <HealthDot health={feed.health} />
            {shared && (
              <>
                <span aria-hidden="true">·</span>
                <span>{feed.owner ? 'You made this' : `Made by ${feed.ownerName ?? 'someone'}`}</span>
              </>
            )}
          </p>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <CopyAppButton app="Radarr" url={feed.radarrUrl} variant="cta" size="cta" />
        <CopyAppButton app="Sonarr" url={feed.sonarrUrl} variant="cta" size="cta" />
        {shared && (
          <Button type="button" variant="secondary" size="cta" onClick={onShare}>
            <UsersIcon />
            Share
            <AvatarStack members={feed.members} max={3} className="ms-1" />
          </Button>
        )}
        <FeedMenu feed={feed} api={api} onGone={onGone} />
      </div>

      <details className="group/setup mt-3">
        <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 text-sm transition-colors [&::-webkit-details-marker]:hidden">
          Where do these go in Radarr and Sonarr?
          <ChevronDownIcon className="size-4 transition-transform group-open/setup:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-3 motion-safe:animate-rise">
          <SetupSteps feed={feed} />
        </div>
      </details>

      {failing && (
        <div className="bg-warn/10 ring-warn/30 text-warn-ink mt-6 flex items-start gap-3 rounded-lg px-4 py-3 text-sm ring-1">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">{failing.listTitle || 'A list'} cannot be read.</span>{' '}
            {failing.lastError ?? 'IMDb did not answer. We try again on every run.'}
          </p>
        </div>
      )}

      <section className="mt-8" aria-labelledby="lists-title">
        <div className="flex items-baseline justify-between gap-2 border-b pb-2">
          <h3 id="lists-title" className="font-bold">
            IMDb list{feed.sources.length === 1 ? '' : 's'} <span className="text-muted-foreground font-normal">{feed.sources.length}</span>
          </h3>
        </div>
        <ul className="divide-y">
          {feed.sources.map((source) => (
            <SourceRow key={source.slug} feed={feed} source={source} api={api} />
          ))}
        </ul>
        {shared ? (
          <AddSource feed={feed} api={api} />
        ) : (
          <p className="text-muted-foreground mt-2 text-xs">To put several lists behind one pair of links, make a new feed with more than one.</p>
        )}
      </section>

      {covers.length > 4 && (
        <section className="mt-8" aria-labelledby="on-it-title">
          <h3 id="on-it-title" className="border-b pb-2 font-bold">
            On it
          </h3>
          <ul className="scrollbar-quiet -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
            {covers.map((poster) => (
              <li key={poster} className="shrink-0">
                <img src={poster} alt="" loading="lazy" decoding="async" className="ring-foreground/10 h-36 w-24 rounded-md object-cover ring-1" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

export function HomeV3({ session, focusSlug }: { session: Session | null; focusSlug: string | null }) {
  const api = useFeeds()
  const [picked, setPicked] = useState<string | null>(focusSlug ? `shared:${focusSlug}` : null)
  const [dialog, setDialog] = useState<'new' | 'share' | null>(null)
  const feeds = api.feeds
  const current = feeds?.find((feed) => feed.key === picked) ?? feeds?.[0]
  const peeks = usePeeks(feeds?.flatMap((feed) => feed.sources.map((source) => source.slug)) ?? [])
  const firstName = session?.name?.trim().split(/\s+/)[0]

  if (feeds === null) {
    return <div className="bg-card ring-foreground/10 mt-10 h-72 animate-pulse rounded-xl ring-1" />
  }

  return (
    <div className="grid gap-6 pt-8 pb-4 sm:pt-10 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="md:self-start">
        <Sidebar feeds={feeds} current={current} peeks={peeks} onPick={setPicked} onNew={() => setDialog('new')} />
      </aside>

      {current ? (
        <Detail
          key={current.key}
          feed={current}
          peeks={peeks}
          api={api}
          onGone={() => setPicked(null)}
          onShare={() => setDialog('share')}
        />
      ) : (
        <div className="bg-card ring-foreground/10 rounded-xl p-10 text-center ring-1">
          <p className="text-lg font-bold">No feeds yet</p>
          <p className="text-muted-foreground mt-1 text-sm">A feed is one Radarr link and one Sonarr link, from any public IMDb list.</p>
          <Button type="button" variant="cta" size="cta" className="mt-5" onClick={() => setDialog('new')}>
            <PlusIcon />
            New feed
          </Button>
        </div>
      )}

      <Dialog open={dialog === 'new'} onOpenChange={(open) => setDialog(open ? 'new' : null)}>
        <DialogContent>
          <DialogTitle>New feed</DialogTitle>
          <DialogDescription>One Radarr link and one Sonarr link, from one IMDb list or several.</DialogDescription>
          <NewFeedForm
            api={api}
            defaultName={firstName ? `${firstName}’s lists` : 'My lists'}
            onCancel={() => setDialog(null)}
            onMade={(key) => {
              setDialog(null)
              setPicked(key)
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'share' && current?.kind === 'shared'} onOpenChange={(open) => setDialog(open ? 'share' : null)}>
        {current && (
          <DialogContent>
            <DialogTitle>Share “{current.name}”</DialogTitle>
            <DialogDescription>Everyone here adds their own IMDb lists; the two links stay the same.</DialogDescription>
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
    </div>
  )
}
