// Signed-in layout 2 (/?demo=2): one column of feeds you open. Each feed is a
// single row (its cover, name, how it is doing, who is in it) with its two copy
// buttons, the thing people come back for, on the row itself. Everything else
// (its lists, its people, where the links go) waits behind the row, in tabs,
// and the rare actions behind a ⋯. The sales page is gone: a signed-in person
// has already bought in.
import { useState } from 'react'
import { Accordion } from 'radix-ui'
import { AlertTriangleIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Session } from '@/lib/api'
import { countsOf, coversOf, useFeeds, usePeeks, type Feed, type FeedsApi } from '@/lib/use-feeds'

type Peeks = ReturnType<typeof usePeeks>

function FeedRow({ feed, peeks, api, onGone }: { feed: Feed; peeks: Peeks; api: FeedsApi; onGone: () => void }) {
  const shared = feed.kind === 'shared'
  const failing = shared ? 'Cannot read a list' : 'Cannot read from IMDb'
  const status = feed.health === 'error' ? failing : feed.health === 'pending' ? 'Reading from IMDb' : 'Up to date'
  return (
    <Accordion.Item value={feed.key} className="group/feed">
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <Accordion.Header className="min-w-0 flex-1">
          <Accordion.Trigger className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full min-w-0 items-center gap-3 rounded-lg p-1.5 text-left transition-colors outline-none focus-visible:ring-3">
            <ChevronRightIcon
              className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/feed:rotate-90"
              aria-hidden="true"
            />
            <CoverMosaic posters={coversOf(feed, peeks, 4)} className="size-12" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-bold">{feed.name}</span>
                {shared && <AvatarStack members={feed.members} max={3} className="hidden sm:flex" />}
              </span>
              <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                <HealthDot health={feed.health} label={status} />
                <span aria-hidden="true">·</span>
                <span>{countsOf(feed, peeks)}</span>
                {shared && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {feed.sources.length} list{feed.sources.length === 1 ? '' : 's'}
                    </span>
                  </>
                )}
              </span>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <CopyAppButton app="Radarr" url={feed.radarrUrl} />
          <CopyAppButton app="Sonarr" url={feed.sonarrUrl} />
        </div>
      </div>

      <Accordion.Content className="data-[state=open]:animate-in data-[state=open]:fade-in-0">
        <div className="px-4 pb-5 sm:ps-[4.75rem] sm:pe-6">
          {/* On a phone the copy buttons are not on the row, so they lead here. */}
          <div className="mb-2 flex gap-2 md:hidden">
            <CopyAppButton app="Radarr" url={feed.radarrUrl} className="flex-1" />
            <CopyAppButton app="Sonarr" url={feed.sonarrUrl} className="flex-1" />
          </div>
          <Tabs defaultValue="lists">
            <div className="flex items-center gap-2">
              <TabsList className="min-w-0 flex-1">
                <TabsTrigger value="lists">
                  IMDb list{feed.sources.length === 1 ? '' : 's'}
                  <span className="text-muted-foreground text-xs">{feed.sources.length}</span>
                </TabsTrigger>
                {shared && (
                  <TabsTrigger value="people">
                    People <span className="text-muted-foreground text-xs">{feed.members.length}</span>
                  </TabsTrigger>
                )}
                <TabsTrigger value="setup">Set up in Radarr &amp; Sonarr</TabsTrigger>
              </TabsList>
              <FeedMenu feed={feed} api={api} onGone={onGone} />
            </div>

            <TabsContent value="lists">
              <ul className="divide-y">
                {feed.sources.map((source) => (
                  <SourceRow key={source.slug} feed={feed} source={source} api={api} />
                ))}
              </ul>
              {shared ? (
                <AddSource feed={feed} api={api} />
              ) : (
                <p className="text-muted-foreground mt-2 text-xs text-pretty">
                  Want several lists behind one pair of links, or family adding theirs? Make a new feed with more than one
                  list.
                </p>
              )}
            </TabsContent>

            {shared && (
              <TabsContent value="people" className="grid gap-5">
                <PeopleList feed={feed} api={api} />
                <div>
                  <h4 className="mb-2 text-sm font-bold">Invite someone</h4>
                  <InviteLink feed={feed} api={api} />
                </div>
              </TabsContent>
            )}

            <TabsContent value="setup">
              <SetupSteps feed={feed} />
            </TabsContent>
          </Tabs>
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}

export function HomeV2({ session, focusSlug }: { session: Session | null; focusSlug: string | null }) {
  const api = useFeeds()
  const [open, setOpen] = useState(focusSlug ? `shared:${focusSlug}` : '')
  const [composing, setComposing] = useState(false)
  const feeds = api.feeds
  const peeks = usePeeks(feeds?.flatMap((feed) => feed.sources.map((source) => source.slug)) ?? [])
  const firstName = session?.name?.trim().split(/\s+/)[0]
  const failing = feeds?.filter((feed) => feed.alerting) ?? []

  return (
    <section className="pt-8 pb-4 sm:pt-12" aria-labelledby="feeds-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {firstName && <p className="text-ink text-ui font-bold tracking-wider uppercase">Hi, {firstName}</p>}
          <h1 id="feeds-title" className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            Your feeds
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm text-pretty">
            A feed is one Radarr link and one Sonarr link. Set them up once; the IMDb lists behind them can change
            any time.
          </p>
        </div>
        {!composing && (
          <Button type="button" variant="cta" size="cta" onClick={() => setComposing(true)}>
            <PlusIcon />
            New feed
          </Button>
        )}
      </div>

      {composing && (
        <div className="bg-card ring-foreground/10 mt-6 rounded-xl p-5 ring-1 sm:p-6 motion-safe:animate-rise">
          <h2 className="mb-4 text-lg font-bold">New feed</h2>
          <NewFeedForm
            api={api}
            defaultName={firstName ? `${firstName}’s lists` : 'My lists'}
            onCancel={() => setComposing(false)}
            onMade={(key) => {
              setComposing(false)
              setOpen(key)
            }}
          />
        </div>
      )}

      {failing.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(failing[0].key)}
          className="bg-warn/10 ring-warn/30 text-warn-ink hover:bg-warn/15 mt-6 flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm ring-1 transition-colors"
        >
          <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="font-bold">{failing[0].name}</span>{' '}
            {failing[0].kind === 'single' ? 'cannot be read from IMDb.' : 'has a list we cannot read from IMDb.'}
          </span>
          <span className="shrink-0 font-medium underline underline-offset-2">Show me</span>
        </button>
      )}

      {feeds === null ? (
        <div className="bg-card ring-foreground/10 mt-6 h-40 animate-pulse rounded-xl ring-1" />
      ) : feeds.length === 0 ? (
        <div className="bg-card ring-foreground/10 mt-6 rounded-xl p-8 text-center ring-1">
          <p className="font-bold">No feeds yet</p>
          <p className="text-muted-foreground mt-1 text-sm">Make one from any public IMDb list or watchlist.</p>
        </div>
      ) : (
        <Accordion.Root
          type="single"
          collapsible
          value={open}
          onValueChange={setOpen}
          className="bg-card ring-foreground/10 mt-6 divide-y overflow-hidden rounded-xl ring-1"
        >
          {feeds.map((feed) => (
            <FeedRow key={feed.key} feed={feed} peeks={peeks} api={api} onGone={() => setOpen('')} />
          ))}
        </Accordion.Root>
      )}
    </section>
  )
}
