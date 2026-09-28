import type { ReactNode } from 'react'
import { ChevronDownIcon, LoaderCircleIcon } from 'lucide-react'

import { CopyField } from '@/components/copy-field'
import { Cover } from '@/components/cover'
import { Panel, StatLine, TargetCards, type Stat } from '@/components/feed-card'
import { OneClickSetup } from '@/components/one-click-setup'
import { NotePopover } from '@/components/note-popover'
import type { SignInClick } from '@/components/site-chrome'
import { UpdateNote } from '@/components/update-note'
import { useCountUp } from '@/lib/motion'
import type { CreateFeedResponse, Session } from '@/lib/api'

// The card once a list is built: loaded after the page (see feed-panel.tsx), so
// its popovers, tooltips and toasts are not part of the first download.

type FeedState = 'ready' | 'snapshot' | 'queued' | 'unreadable'

const FEED_STATE_LABELS: Record<FeedState, string> = {
  ready: 'ready',
  snapshot: 'last good snapshot',
  queued: 'waiting for IMDb',
  unreadable: 'could not read',
}

/**
 * The routes keep serving the stored snapshot when a sync fails, so a feed with
 * items behind it is stale rather than broken. A list with nothing stored is
 * either still in the queue, or was tried and given up on (usually private),
 * which only the list's owner can change.
 */
function feedState(result: CreateFeedResponse): FeedState {
  if (result.status === 'ready') {
    return 'ready'
  }

  if (result.totalCount > 0) {
    return 'snapshot'
  }

  return result.syncing ? 'queued' : 'unreadable'
}

const PILL_TONES: Record<FeedState, string> = {
  ready: 'border-primary/50 bg-primary/10 text-ink before:bg-primary',
  snapshot: 'border-primary/30 text-foreground before:bg-primary/60',
  queued: 'border-foreground/20 text-muted-foreground before:bg-muted-foreground',
  unreadable: 'border-destructive/40 bg-destructive/10 text-destructive before:bg-destructive',
}

function StatusPill({ state }: { state: FeedState }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-bold tracking-wider uppercase before:size-1.5 before:rounded-full before:content-[''] ${PILL_TONES[state]}`}
    >
      <span>{FEED_STATE_LABELS[state]}</span>
    </span>
  )
}

/**
 * Why some shows are missing from the Sonarr link, and which ones. It used to
 * be a paragraph under the counts; now the "skipped" count opens it, so the
 * panel stays short and the reason is one click away.
 */
function SkippedNote({ result, children }: { result: CreateFeedResponse; children: ReactNode }) {
  const shows = result.skippedShows ?? []
  return (
    <NotePopover
      className="border-primary w-[min(22rem,calc(100vw-2rem))]"
      title="Left out of Sonarr"
      text="Sonarr only adds shows listed on TheTVDB, and these are not. They join your link if they ever are."
      trigger={
        <button
          type="button"
          className="group/skip hover:bg-foreground/10 -mx-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors"
        >
          {children}
          <ChevronDownIcon
            className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]/skip:rotate-180"
            aria-hidden="true"
          />
        </button>
      }
    >
      {shows.length > 0 && (
        <ul className="mt-3 grid gap-1" aria-label="Shows left out">
          {shows.map((show) => (
            <li key={show.imdbId}>
              <a
                href={`https://www.imdb.com/title/${show.imdbId}/`}
                target="_blank"
                rel="noreferrer"
                className="hover:bg-foreground/10 -mx-2 flex items-baseline justify-between gap-3 rounded-md px-2 py-1 text-sm transition-colors"
              >
                <span className="min-w-0 truncate font-medium">{show.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{show.year ?? 'never released'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </NotePopover>
  )
}

function StatItem({ stat, result, delay }: { stat: Stat; result: CreateFeedResponse; delay: string }) {
  const value = result[stat.key]
  const shown = useCountUp(value)
  const Icon = stat.icon
  const body = (
    <>
      <Icon className="text-ink size-4 shrink-0" aria-hidden="true" />
      <span className="text-foreground font-bold tabular-nums">{shown}</span>
      <span className="text-muted-foreground">{stat.word}</span>
    </>
  )
  return (
    <div className="animation-delay-var motion-safe:animate-rise" style={{ '--delay': delay }} title={stat.label}>
      <dt className="sr-only">{stat.label}</dt>
      <dd className="flex items-center gap-1.5">
        {stat.key === 'sonarrUnresolvedCount' && value > 0 ? <SkippedNote result={result}>{body}</SkippedNote> : body}
      </dd>
    </div>
  )
}

/**
 * The list's first covers, fanned out at the top of the result: they start
 * stacked and spread into place, and lean further apart on hover. While a list
 * is still waiting for IMDb the fan is placeholders, shimmering.
 */
function CoverFan({ result }: { result: CreateFeedResponse }) {
  const covers = (result.preview ?? []).filter((item) => item.poster).slice(0, 5)
  if (covers.length === 0 && !result.syncing) return null

  const slots = covers.length > 0 ? covers : [null, null, null, null]
  return (
    // isolate keeps the covers' own stacking inside the fan, so the cards below the header
    // still paint over the shadows that fall onto them.
    <div
      className="group/fan relative isolate order-first h-32 w-full shrink-0 sm:order-none sm:h-48 sm:w-80"
      aria-hidden="true"
    >
      {slots.map((item, index) => {
        // How far this cover sits from the middle: a share of its own width sideways, a few
        // degrees of tilt, the middle one on top.
        const offset = index - (slots.length - 1) / 2
        return (
          <div
            key={item?.imdbId ?? index}
            className="fan-card animation-delay-var absolute top-1/2 left-1/2 w-20 motion-safe:animate-fan sm:w-28"
            style={{
              '--fan-x': `${offset * 46}%`,
              '--fan-r': `${offset * 7}deg`,
              '--fan-z': 10 - Math.abs(Math.round(offset)),
              '--delay': `${250 + index * 90}ms`,
            }}
          >
            <div className="transition-transform duration-300 ease-out group-hover/fan:-translate-y-2">
              {item ? (
                <Cover
                  seed={item.imdbId}
                  src={item.poster}
                  eager
                  className="aspect-2/3 rounded-md shadow-2xl ring-1 shadow-black/60 ring-white/15"
                />
              ) : (
                <div className="bg-secondary shimmer aspect-2/3 rounded-md ring-1 ring-white/10" />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

type ResultProps = {
  result: CreateFeedResponse
  session: Session | null
  listUrl: string
  onSignIn: SignInClick
}

/** The top of the result: the list's own covers behind and beside what it is, what is on it, and where it stands. */
function ResultHeader({ result, session, listUrl, onSignIn }: ResultProps) {
  const backdrop = result.preview?.find((item) => item.poster)?.poster
  const state = feedState(result)
  return (
    <div className="relative -mx-5 -mt-5 mb-5 px-5 pt-5 pb-2 sm:-mx-8 sm:-mt-8 sm:px-8 sm:pt-8">
      {backdrop && (
        // The blurred backdrop is clipped on its own layer rather than the whole header, so the
        // fanned covers' shadows carry on past the header's edge instead of stopping in a line.
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={backdrop}
            alt=""
            className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-3xl motion-safe:animate-backdrop"
          />
          <div className="to-card from-card/20 absolute inset-0 bg-linear-to-b" />
        </div>
      )}
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-center gap-2 text-2xl font-bold">
            <span className="truncate">{result.listTitle || 'Your list'}</span>
            {/* Only while there is nothing to show yet: a list that is ready and just being re-read
                keeps serving what it has, so it does not look busy. */}
            {state === 'queued' && <LoaderCircleIcon className="text-muted-foreground size-4 shrink-0 animate-spin" />}
          </h3>
          <StatLine item={(stat, delay) => <StatItem key={stat.key} stat={stat} result={result} delay={delay} />} />
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <StatusPill state={state} />
            <UpdateNote session={session} result={result} listUrl={listUrl} onSignIn={onSignIn} />
          </div>
          {/* A ready list says nothing the badges beside it do not (owner, 2026-09-28); the others
              get a line on what went wrong or what happens next. */}
          {state !== 'ready' && (
            <p className="text-muted-foreground mt-3 text-sm text-pretty">
              {state === 'snapshot'
                ? `The last sync did not succeed, so the feeds keep serving the last good snapshot. ${result.message}`
                : result.message}
            </p>
          )}
        </div>
        <CoverFan result={result} />
      </div>
    </div>
  )
}

export function ResultPanel(props: ResultProps) {
  const { result } = props
  return (
    // Keyed by the list, so a different list rises in afresh.
    <Panel key={result.slug} className="motion-safe:animate-rise">
      <ResultHeader {...props} />
      <TargetCards link={(target) => <CopyField value={result[target.urlKey]} label={target.label} />} />
      <OneClickSetup result={result} />
    </Panel>
  )
}
