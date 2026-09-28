import type { CSSProperties, ReactNode } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FilmIcon,
  ListVideoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  TvIcon,
} from 'lucide-react'
import { Popover } from 'radix-ui'

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
    icon: FilmIcon,
    urlKey: 'radarrFeedUrl',
    label: 'Radarr RSS URL',
    path: ['Settings', 'Lists', 'Add list', 'Advanced', 'RSS List'],
  },
  {
    app: 'Sonarr',
    icon: TvIcon,
    urlKey: 'sonarrFeedUrl',
    label: 'Sonarr custom list URL',
    path: ['Settings', 'Import Lists', 'Add list', 'Advanced', 'Custom List'],
  },
] as const

// The list's counts, as one line under its name: an icon, the number, a word.
const STATS = [
  { key: 'totalCount', label: 'Titles on the list', word: 'titles', icon: ListVideoIcon },
  { key: 'radarrCount', label: 'Movies for Radarr', word: 'movies', icon: FilmIcon },
  { key: 'sonarrCount', label: 'Shows for Sonarr', word: 'shows', icon: TvIcon },
  { key: 'sonarrUnresolvedCount', label: 'Shows we skipped', word: 'skipped', icon: EyeOffIcon },
] as const

type Stat = (typeof STATS)[number]

const STAT_LINE = 'mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm'

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

/**
 * Why some shows are missing from the Sonarr link, and which ones. It used to
 * be a paragraph under the counts; now the "skipped" count opens it, so the
 * panel stays short and the reason is one click away.
 */
function SkippedNote({ result, children }: { result: CreateFeedResponse; children: ReactNode }) {
  const names = result.skippedShows ?? []
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={10}
          collisionPadding={16}
          className="bg-popover text-popover-foreground border-primary ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border-t-4 p-4 shadow-2xl ring-1"
        >
          <p className="font-bold">Left out of Sonarr</p>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            Sonarr needs a TVDB id for every show, and we could not find one for {result.sonarrUnresolvedCount}{' '}
            of them, so we left those out.
          </p>
          {names.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Shows left out">
              {names.map((name) => (
                <li key={name} className="border-foreground/15 rounded-md border px-2 py-0.5 text-xs font-medium">
                  {name}
                </li>
              ))}
            </ul>
          )}
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function StatItem({ stat, result, order }: { stat: Stat; result: CreateFeedResponse; order: number }) {
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
    <div className="motion-safe:animate-rise" style={riseDelay(order)} title={stat.label}>
      <dt className="sr-only">{stat.label}</dt>
      <dd className="flex items-center gap-1.5">
        {stat.key === 'sonarrUnresolvedCount' && value > 0 ? <SkippedNote result={result}>{body}</SkippedNote> : body}
      </dd>
    </div>
  )
}

/** The same line before there is anything to count, shimmering while a read is on its way. */
function GhostStats({ loading }: { loading: boolean }) {
  return (
    <dl className={STAT_LINE}>
      {STATS.map((stat) => {
        const Icon = stat.icon
        return (
          <div key={stat.key} title={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-muted-foreground flex items-center gap-1.5">
              <Icon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
              {loading ? (
                <span aria-hidden="true" className="shimmer bg-secondary h-4 w-6 rounded" />
              ) : (
                <span className="font-bold">–</span>
              )}
              {stat.word}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function TargetCards({ result }: { result: CreateFeedResponse | null }) {
  return (
    // grid-cols-1, not the implicit column: a link that will not wrap must not widen the card past the screen.
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {TARGETS.map((target, index) => {
        const Icon = target.icon
        return (
          // relative: painted over the fanned covers' shadows, which fall onto the top of these.
          <div
            key={target.app}
            className="bg-secondary ring-foreground/10 relative rounded-lg p-4 ring-1 motion-safe:animate-rise"
            style={riseDelay(4 + index)}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="flex items-center gap-2 font-bold">
                <Icon className="text-ink size-4" aria-hidden="true" />
                {target.app}
              </span>
              <ol
                aria-label={`Where it goes in ${target.app}`}
                className="text-muted-foreground text-2xs flex flex-wrap items-center gap-x-1"
              >
                {target.path.map((step, stepIndex) => (
                  <li key={step} className="flex items-center gap-1">
                    {stepIndex > 0 && <ChevronRightIcon className="size-3 opacity-60" aria-hidden="true" />}
                    <span className={stepIndex === target.path.length - 1 ? 'text-foreground font-medium' : ''}>
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {result ? (
              <CopyField value={result[target.urlKey]} label={target.label} />
            ) : (
              <div className="border-foreground/15 text-muted-foreground flex h-11 items-center rounded-md border border-dashed px-3 text-xs">
                Your {target.app} link shows up here.
              </div>
            )}
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
    // isolate keeps the covers' own stacking inside the fan, so the cards below the header
    // still paint over the shadows that fall onto them.
    <div
      className="group/fan relative isolate order-first h-32 w-full shrink-0 sm:order-none sm:h-48 sm:w-80"
      aria-hidden="true"
    >
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

/** The top of the result: the list's own covers behind and beside what it is, what is on it, and where it stands. */
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
            {feedState(result) === 'queued' && (
              <LoaderCircleIcon className="text-muted-foreground size-4 shrink-0 animate-spin" />
            )}
          </h3>
          <dl className={STAT_LINE}>
            {STATS.map((stat, index) => (
              <StatItem key={stat.key} stat={stat} result={result} order={index} />
            ))}
          </dl>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <StatusPill result={result} />
            <UpdateNote session={session} result={result} listUrl={listUrl} onSignIn={onSignIn} />
          </div>
          {/* A ready list says nothing the badges beside it do not (owner, 2026-09-28); the others
              get a line on what went wrong or what happens next. */}
          {feedState(result) !== 'ready' && (
            <p className="text-muted-foreground mt-3 text-sm text-pretty">
              {feedState(result) === 'snapshot'
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
      <TargetCards result={result} />
    </Panel>
  )
}

/** Before a list (or while one is on its way): the panel's shape, so the page shows where things land. */
function GhostPanel({ loading }: { loading: boolean }) {
  return (
    <Panel>
      <div className="mb-5">
        <h3 className="text-muted-foreground text-2xl font-bold">{loading ? 'Reading your list' : 'Your list'}</h3>
        <GhostStats loading={loading} />
        <p className="text-muted-foreground mt-3 text-sm">
          {loading ? 'Getting your two links ready.' : 'Paste a list above and your two links show up here.'}
        </p>
      </div>
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
