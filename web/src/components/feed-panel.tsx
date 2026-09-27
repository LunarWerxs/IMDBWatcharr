import type { CSSProperties, ReactNode } from 'react'
import { FilmIcon, LoaderCircleIcon, TriangleAlertIcon, TvIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CopyField } from '@/components/copy-field'
import { Cover } from '@/components/cover'
import { SectionTitle, type SignInClick } from '@/components/site-chrome'
import { UpdateNote } from '@/components/update-note'
import { useCountUp } from '@/lib/motion'
import type { CreateFeedResponse, Session } from '@/lib/api'

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

const TARGETS = [
  {
    app: 'Radarr',
    kind: 'RSS List',
    icon: FilmIcon,
    urlKey: 'radarrFeedUrl',
    label: 'Radarr RSS URL',
    path: 'Settings, Lists, Add list, Advanced, RSS List.',
  },
  {
    app: 'Sonarr',
    kind: 'Custom List',
    icon: TvIcon,
    urlKey: 'sonarrFeedUrl',
    label: 'Sonarr custom list URL',
    path: 'Settings, Import Lists, Add list, Advanced, Custom List.',
  },
] as const

const STAT_LABELS = ['Titles on the list', 'Movies for Radarr', 'Shows for Sonarr', 'Shows we skipped'] as const

/** An element that rises in `order` steps after the panel it sits in. */
function riseDelay(order: number): CSSProperties {
  return { animationDelay: `${order * 70}ms` }
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card ring-foreground/10 relative overflow-hidden rounded-lg p-5 ring-1 sm:p-8 ${className}`}>
      {children}
    </div>
  )
}

function StatusPill({ result }: { result: CreateFeedResponse }) {
  const state = feedState(result)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-bold tracking-wider uppercase before:size-1.5 before:rounded-full before:content-[''] ${PILL_TONES[state]}`}
    >
      <span>{FEED_STATE_LABELS[state]}</span>
    </span>
  )
}

function StatTile({ label, value, order }: { label: string; value: number; order: number }) {
  const shown = useCountUp(value)
  return (
    <div className="bg-secondary ring-foreground/10 rounded-md px-4 py-3.5 ring-1 motion-safe:animate-rise" style={riseDelay(order)}>
      <div className="text-2xl leading-tight font-bold tabular-nums">{shown}</div>
      <div className="text-muted-foreground text-ui mt-1">{label}</div>
    </div>
  )
}

/** The same four tiles before there is anything to count, shimmering while a read is on its way. */
function GhostTiles({ loading }: { loading: boolean }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      {STAT_LABELS.map((label) => (
        <div key={label} className="bg-secondary/60 ring-foreground/5 rounded-md px-4 py-3.5 ring-1">
          <div
            aria-hidden="true"
            className={`text-muted-foreground/60 h-8 text-2xl leading-tight font-bold ${loading ? 'shimmer w-14 rounded' : ''}`}
          >
            {loading ? '' : '–'}
          </div>
          <div className="text-muted-foreground text-ui mt-1">{label}</div>
        </div>
      ))}
    </div>
  )
}

function TargetCards({ result }: { result: CreateFeedResponse | null }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {TARGETS.map((target, index) => {
        const Icon = target.icon
        return (
          <div
            key={target.app}
            className="bg-secondary ring-foreground/10 flex flex-col rounded-lg p-4 ring-1 sm:p-5 motion-safe:animate-rise"
            style={riseDelay(4 + index)}
          >
            <div className="mb-3 flex items-center gap-2.5 font-bold">
              <Icon className="text-ink size-4" aria-hidden="true" />
              {target.app}
              <span className="text-muted-foreground font-normal">· {target.kind}</span>
            </div>
            {result ? (
              <CopyField value={result[target.urlKey]} label={target.label} />
            ) : (
              <div className="border-foreground/15 text-muted-foreground rounded-md border border-dashed px-3 py-2.5 text-xs">
                Your {target.app} link shows up here.
              </div>
            )}
            <p className="text-muted-foreground text-ui border-foreground/10 mt-4 border-t pt-3">{target.path}</p>
          </div>
        )
      })}
    </div>
  )
}

// How far each cover in the fan sits from the middle: a share of its own width
// sideways, a few degrees of tilt, the middle one on top.
function fanStyle(index: number, count: number): CSSProperties {
  const offset = index - (count - 1) / 2
  return {
    '--fan-x': `${offset * 46}%`,
    '--fan-r': `${offset * 7}deg`,
    zIndex: 10 - Math.abs(Math.round(offset)),
    animationDelay: `${250 + index * 90}ms`,
  } as CSSProperties
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
    <div className="group/fan relative order-first h-32 w-full shrink-0 sm:order-none sm:h-48 sm:w-80" aria-hidden="true">
      {slots.map((item, index) => (
        <div
          key={item?.imdbId ?? index}
          className="fan-card absolute top-1/2 left-1/2 w-20 motion-safe:animate-fan sm:w-28"
          style={fanStyle(index, slots.length)}
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
      ))}
    </div>
  )
}

/** The top of the result: the list's own covers behind and beside what it is and where it stands. */
function ResultHeader({
  result,
  session,
  listUrl,
  onSignIn,
}: {
  result: CreateFeedResponse
  session: Session | null
  listUrl: string
  onSignIn: SignInClick
}) {
  const backdrop = result.preview?.find((item) => item.poster)?.poster
  return (
    // overflow-hidden keeps the blurred backdrop inside the header, where the
    // gradient fades it into the panel, instead of spilling onto the counts.
    <div className="relative -mx-5 -mt-5 mb-6 overflow-hidden px-5 pt-5 pb-2 sm:-mx-8 sm:-mt-8 sm:px-8 sm:pt-8">
      {backdrop && (
        <>
          <img
            src={backdrop}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-40 blur-3xl motion-safe:animate-backdrop"
          />
          <div className="to-card from-card/20 absolute inset-0 bg-linear-to-b" />
        </>
      )}
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-center gap-2 text-2xl font-bold">
            <span className="truncate">{result.listTitle || 'Your list'}</span>
            {result.syncing && <LoaderCircleIcon className="text-muted-foreground size-4 shrink-0 animate-spin" />}
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill result={result} />
            <UpdateNote session={session} result={result} listUrl={listUrl} onSignIn={onSignIn} />
          </div>
          <p className="text-muted-foreground mt-3 text-sm text-pretty">
            {feedState(result) === 'snapshot'
              ? `The last sync did not succeed, so the feeds keep serving the last good snapshot. ${result.message}`
              : result.message}
          </p>
        </div>
        <CoverFan result={result} />
      </div>
    </div>
  )
}

function ResultPanel({
  result,
  session,
  listUrl,
  onSignIn,
}: {
  result: CreateFeedResponse
  session: Session | null
  listUrl: string
  onSignIn: SignInClick
}) {
  return (
    // Keyed by the list, so a different list rises in afresh.
    <Panel key={result.slug} className="motion-safe:animate-rise">
      <ResultHeader result={result} session={session} listUrl={listUrl} onSignIn={onSignIn} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={STAT_LABELS[0]} value={result.totalCount} order={0} />
        <StatTile label={STAT_LABELS[1]} value={result.radarrCount} order={1} />
        <StatTile label={STAT_LABELS[2]} value={result.sonarrCount} order={2} />
        <StatTile label={STAT_LABELS[3]} value={result.sonarrUnresolvedCount} order={3} />
      </div>
      {result.sonarrUnresolvedCount > 0 && (
        <p className="text-muted-foreground -mt-3 mb-6 text-xs">
          Sonarr needs a TVDB id for every show, and we could not find one for{' '}
          {result.sonarrUnresolvedCount} of them, so we left those out.
          {result.skippedShows && result.skippedShows.length > 0 && (
            <span className="text-foreground/80 mt-1 block">Left out: {result.skippedShows.join(', ')}.</span>
          )}
        </p>
      )}
      <TargetCards result={result} />
    </Panel>
  )
}

/** Before a list (or while one is on its way): the panel's shape, so the page shows where things land. */
function GhostPanel({ loading }: { loading: boolean }) {
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-muted-foreground text-xl font-bold">{loading ? 'Reading your list' : 'Your list'}</h3>
      </div>
      <p className="text-muted-foreground mb-6 text-sm">
        {loading ? 'Getting your two links ready.' : 'Paste a list above and your two links show up here.'}
      </p>
      <GhostTiles loading={loading} />
      <TargetCards result={null} />
    </Panel>
  )
}

/**
 * What a submission leaves behind: the panel's empty shape at first, a
 * shimmer while the request is out, the reason if it failed, or the feed it
 * built. At most one of them is on screen, so they are decided together.
 */
export function FeedsSection({
  pending,
  error,
  result,
  session,
  listUrl,
  onSignIn,
}: {
  pending: boolean
  error: string | null
  result: CreateFeedResponse | null
  session: Session | null
  listUrl: string
  onSignIn: SignInClick
}) {
  let body: ReactNode
  if (pending) {
    body = <GhostPanel loading />
  } else if (error) {
    body = (
      <Alert variant="destructive" className="motion-safe:animate-rise">
        <TriangleAlertIcon />
        <AlertTitle>Could not build the feeds</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  } else if (result) {
    body = <ResultPanel result={result} session={session} listUrl={listUrl} onSignIn={onSignIn} />
  } else {
    body = <GhostPanel loading={false} />
  }

  return (
    <section className="mt-12" aria-labelledby="your-feeds">
      <SectionTitle id="your-feeds">Your feeds</SectionTitle>
      {body}
    </section>
  )
}
