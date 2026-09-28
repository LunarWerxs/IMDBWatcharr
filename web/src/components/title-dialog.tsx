import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  Minimize2Icon,
  MonitorDownIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { Dialog } from 'radix-ui'

import { AskarrMark } from '@/components/askarr-brand'
import { Cover } from '@/components/cover'
import { Button } from '@/components/ui/button'
import { readTitleDetails, type PreviewItem, type TitleDetails } from '@/lib/api'

// How long the player takes to fade and the stage to fold before the player unmounts.
const CLOSE_MS = 450

const ASKARR_STEPS = [
  { icon: SearchIcon, text: 'Search from your phone or any browser' },
  { icon: PlusIcon, text: 'Tap request' },
  { icon: MonitorDownIcon, text: 'Your PC adds it to Radarr or Sonarr' },
] as const

function focusSoon(target: RefObject<HTMLElement | null>) {
  requestAnimationFrame(() => target.current?.focus({ preventScroll: true }))
}

const TARGET_LINE: Record<PreviewItem['target'], string> = {
  radarr: 'Movie · goes to Radarr',
  sonarr: 'Series · goes to Sonarr',
  skipped: 'Skipped · neither app takes it',
}

const DOT: Record<PreviewItem['target'], string> = {
  radarr: 'bg-primary',
  sonarr: 'bg-foreground',
  skipped: 'bg-muted-foreground',
}

function runtimeLabel(details: TitleDetails | null): string {
  if (!details) return ''
  if (details.runtimeMinutes) {
    const hours = Math.floor(details.runtimeMinutes / 60)
    const minutes = details.runtimeMinutes % 60
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }
  if (details.seasons) return details.seasons === 1 ? '1 season' : `${details.seasons} seasons`
  return ''
}

function askarrLink(item: PreviewItem, details: TitleDetails | null): string {
  const type = details?.mediaType ?? (item.target === 'sonarr' ? 'tv' : 'movie')
  const query = new URLSearchParams({ q: details?.title || item.title, type, utm_source: 'watcharr', utm_medium: 'title-popup' })
  return `https://askarr.com/search?${query}`
}

/**
 * A title's details, looked up the first time it is opened: the list already
 * gave us its name, year and cover, so the sheet opens with those at once and
 * the rest (backdrop, plot, genres, runtime, rating, trailer) fades in.
 */
function useTitleDetails(imdbId: string) {
  const [state, setState] = useState<{ details: TitleDetails | null; error: string | null; loading: boolean }>({
    details: null,
    error: null,
    loading: true,
  })
  useEffect(() => {
    let cancelled = false
    readTitleDetails(imdbId).then(
      (details) => !cancelled && setState({ details, error: null, loading: false }),
      (error: unknown) =>
        !cancelled &&
        setState({ details: null, error: error instanceof Error ? error.message : 'No details right now.', loading: false }),
    )
    return () => {
      cancelled = true
    }
  }, [imdbId])
  return state
}

/**
 * One of the sheet's two bottoms: the title's details, or the Askarr step. Its
 * row folds shut or open around the content while the content fades and slides,
 * so switching grows or shrinks the sheet smoothly instead of jumping.
 */
function Swap({ shown, from, children }: { shown: boolean; from: 'left' | 'right'; children: ReactNode }) {
  return (
    <div
      inert={!shown}
      className={`ease-soft transition-layout grid duration-500 ${shown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`ease-soft transition ${
            shown
              ? 'translate-x-0 opacity-100 delay-150 duration-500'
              : `${from === 'left' ? '-translate-x-8' : 'translate-x-8'} opacity-0 duration-200`
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * What "Request with Askarr" opens, in place of the details: what Askarr is,
 * how it works, and the way over there, or back to the title. Nobody is taken
 * off the page by surprise; going to Askarr opens a new tab.
 */
function AskarrStep({
  item,
  details,
  shown,
  headingRef,
  onBack,
}: {
  item: PreviewItem
  details: TitleDetails | null
  shown: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  onBack: () => void
}) {
  // The steps settle in one after another each time the step opens.
  const settle = (order: number) => ({
    className: `ease-soft transition-delay-var transition duration-500 ${shown ? '' : 'translate-y-2 opacity-0'}`,
    delay: shown ? `${220 + order * 70}ms` : '0ms',
  })
  return (
    <section aria-labelledby="askarr-step" className="px-5 pt-6 pb-7 sm:px-8 sm:pb-8">
      <div className="flex items-start gap-4">
        <AskarrMark className="mt-1 size-11 shrink-0 drop-shadow-lg" />
        <div className="min-w-0">
          <p className="text-muted-foreground text-2xs font-bold tracking-widest uppercase">From the makers of Watcharr</p>
          <h3 id="askarr-step" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-bold outline-none sm:text-2xl">
            Request it with Askarr
          </h3>
          <p className="text-foreground/85 mt-2 max-w-prose text-sm leading-relaxed text-pretty">
            Watcharr syncs whole lists. Askarr gets you one title at a time, straight into your Radarr or Sonarr at
            home.
          </p>
        </div>
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-3">
        {ASKARR_STEPS.map((step, index) => {
          const Icon = step.icon
          const { className, delay } = settle(index)
          return (
            <li
              key={step.text}
              className={`bg-secondary flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${className}`}
              style={{ '--delay': delay }}
            >
              <span className="text-ink font-bold tabular-nums">{index + 1}</span>
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              {step.text}
            </li>
          )
        })}
      </ol>

      <div
        className={`mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between ${settle(3).className}`}
        style={{ '--delay': settle(3).delay }}
      >
        <button
          type="button"
          onClick={onBack}
          className="group/back text-muted-foreground hover:text-foreground hover:bg-secondary inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 font-bold transition-colors"
        >
          <ArrowLeftIcon className="size-4 transition-transform group-hover/back:-translate-x-0.5" aria-hidden="true" />
          Back to the title
        </button>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <Button asChild variant="askarr" size="pill" className="gap-2.5 ps-4 pe-6">
            <a href={askarrLink(item, details)} target="_blank" rel="noopener">
              <AskarrMark inverted className="size-5" />
              Continue to Askarr
              <ExternalLinkIcon className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}

/**
 * The trailer's life on the stage: idle, open, then closing, which keeps the
 * player mounted while it fades and the stage folds back, so closing animates
 * instead of vanishing. Focus goes back to the play button once it has.
 */
function useTrailer(playButton: RefObject<HTMLButtonElement | null>) {
  const [stage, setStage] = useState<'idle' | 'open' | 'closing'>('idle')
  const [ready, setReady] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  return {
    playing: stage === 'open',
    mounted: stage !== 'idle',
    ready,
    onLoaded: () => setReady(true),
    open() {
      if (closeTimer.current) clearTimeout(closeTimer.current)
      setReady(false)
      setStage('open')
    },
    close() {
      setStage('closing')
      closeTimer.current = setTimeout(() => {
        setStage('idle')
        focusSoon(playButton)
      }, CLOSE_MS)
    },
  }
}

type Trailer = ReturnType<typeof useTrailer>

/** The play button over the backdrop: hidden until hover or focus on a pointer, always shown on touch. */
function PlayButton({
  title,
  buttonRef,
  onPlay,
}: {
  title: string
  buttonRef: RefObject<HTMLButtonElement | null>
  onPlay: () => void
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Play the ${title} trailer`}
      onClick={onPlay}
      className="group/play absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 pb-10 text-white outline-none motion-safe:animate-fade-in sm:pb-0"
    >
      <span className="flex size-14 scale-90 items-center justify-center rounded-full bg-white/15 opacity-0 shadow-2xl ring-1 ring-white/40 backdrop-blur-md transition duration-300 ring-inset group-hover/play:scale-100 group-hover/play:bg-white/25 group-hover/play:opacity-100 group-focus-visible/play:scale-100 group-focus-visible/play:opacity-100 group-focus-visible/play:ring-2 sm:size-16 [@media(hover:none)]:scale-100 [@media(hover:none)]:opacity-100">
        <PlayIcon className="size-6 translate-x-px fill-current" aria-hidden="true" />
      </span>
      <span className="text-ui text-shadow-scrim translate-y-1 font-bold tracking-widest text-white/90 uppercase opacity-0 transition duration-300 group-hover/play:translate-y-0 group-hover/play:opacity-100 group-focus-visible/play:translate-y-0 group-focus-visible/play:opacity-100 max-sm:hidden [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
        Trailer
      </span>
    </button>
  )
}

/**
 * The player: it grows in from slightly small once it has loaded, and on close
 * fades and shrinks back while the stage folds up around it.
 */
function TrailerPlayer({ src, title, trailer }: { src: string; title: string; trailer: Trailer }) {
  return (
    <>
      <iframe
        src={src}
        title={`${title} trailer`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={trailer.onLoaded}
        className={`ease-soft absolute inset-x-0 top-14 h-[calc(100%-3.5rem)] w-full origin-top border-0 transition ${
          trailer.playing && trailer.ready
            ? 'scale-100 opacity-100 delay-100 duration-700'
            : 'scale-[0.96] opacity-0 duration-300'
        }`}
      />
      {trailer.playing && !trailer.ready && (
        <div className="absolute inset-x-0 top-14 bottom-0 grid place-items-center">
          <LoaderCircleIcon className="size-7 animate-spin text-white/70" aria-label="Loading the trailer" />
        </div>
      )}
      <button
        type="button"
        onClick={trailer.close}
        className={`text-ui ease-soft absolute top-3 left-3 z-20 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3.5 font-bold text-white transition duration-500 hover:bg-white/20 ${
          trailer.playing ? 'translate-y-0 opacity-100 motion-safe:animate-rise' : 'pointer-events-none -translate-y-2 opacity-0'
        }`}
      >
        <Minimize2Icon className="size-4" aria-hidden="true" /> Close trailer
      </button>
    </>
  )
}

/** The backdrop, and the stage the trailer plays on (16:9, under a strip for its close button). */
function Stage({
  item,
  details,
  trailer,
  playButton,
}: {
  item: PreviewItem
  details: TitleDetails | null
  trailer: Trailer
  playButton: RefObject<HTMLButtonElement | null>
}) {
  const [backdropLoaded, setBackdropLoaded] = useState(false)
  const backdrop = details?.backdropUrl ?? null
  // Without a TMDB backdrop, the title's own cover, blurred, stands in for one.
  const fallbackBackdrop = backdrop ? null : (item.poster ?? details?.posterUrl ?? null)
  const src = details?.trailerKey
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(details.trailerKey)}?autoplay=1&rel=0&playsinline=1`
    : null
  const { playing } = trailer
  const backdropState = playing ? 'opacity-0' : backdropLoaded ? 'scale-100 opacity-100' : 'scale-105 opacity-0'

  return (
    <div
      className={`group/stage ease-soft transition-layout relative overflow-hidden duration-700 ${
        playing ? 'h-[calc(56.25cqw+3.5rem)] bg-black' : 'bg-secondary h-44 sm:h-64'
      }`}
    >
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          decoding="async"
          onLoad={() => setBackdropLoaded(true)}
          className={`ease-soft absolute inset-0 size-full object-cover transition duration-700 ${backdropState} ${
            src && !playing ? 'group-hover/stage:scale-[1.03]' : ''
          }`}
        />
      )}
      {fallbackBackdrop && (
        <img
          src={fallbackBackdrop}
          alt=""
          aria-hidden="true"
          className={`ease-soft absolute inset-0 size-full scale-125 object-cover blur-2xl transition-opacity duration-700 motion-safe:animate-backdrop ${
            playing ? 'opacity-0' : 'opacity-50'
          }`}
        />
      )}
      <div
        aria-hidden="true"
        className={`from-card via-card/55 to-card/0 ease-soft absolute inset-0 bg-linear-to-t transition-opacity duration-700 ${playing ? 'opacity-0' : ''}`}
      />
      {src && !trailer.mounted && <PlayButton title={item.title} buttonRef={playButton} onPlay={trailer.open} />}
      {src && trailer.mounted && <TrailerPlayer src={src} title={item.title} trailer={trailer} />}
    </div>
  )
}

/** Over the stage: the cover, what the title is, and its year, length and rating. Only the cover takes the pointer, so the play button works around it. */
function SheetHeader({ item, details, playing }: { item: PreviewItem; details: TitleDetails | null; playing: boolean }) {
  const year = details?.year ?? item.year
  const meta = [year ? String(year) : '', runtimeLabel(details)].filter(Boolean)
  return (
    <header
      className={`ease-soft transition-layout pointer-events-none relative z-20 flex gap-5 px-5 duration-700 sm:gap-7 sm:px-8 ${
        playing ? 'mt-5' : '-mt-24 sm:-mt-32'
      }`}
    >
      <div
        className={`ease-soft transition-layout animation-delay-var pointer-events-auto shrink-0 duration-700 motion-safe:animate-rise ${
          playing ? 'w-20 sm:w-24' : 'w-28 sm:w-40'
        }`}
        style={{ '--delay': '80ms' }}
      >
        <Cover
          seed={item.imdbId}
          src={item.poster ?? details?.posterUrl}
          eager
          className="aspect-2/3 rounded-lg shadow-2xl ring-1 shadow-black/60 ring-white/15"
        />
      </div>
      <div className="flex min-w-0 flex-col justify-end pb-1">
        <p
          className="text-muted-foreground text-2xs animation-delay-var flex items-center gap-2 font-bold tracking-widest uppercase motion-safe:animate-rise"
          style={{ '--delay': '140ms' }}
        >
          <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[item.target]}`} />
          {TARGET_LINE[item.target]}
        </p>
        <Dialog.Title
          className="animation-delay-var mt-2 text-2xl leading-tight font-bold tracking-tight text-balance motion-safe:animate-rise sm:text-4xl"
          style={{ '--delay': '190ms' }}
        >
          {details?.title || item.title}
        </Dialog.Title>
        {(meta.length > 0 || details?.rating) && (
          <p
            className="text-muted-foreground animation-delay-var mt-2.5 text-sm tabular-nums motion-safe:animate-rise"
            style={{ '--delay': '240ms' }}
          >
            {meta.join(' · ')}
            {details?.rating ? (
              <>
                {meta.length > 0 && <span aria-hidden="true"> · </span>}
                <span className="text-ink font-bold">★ {details.rating.toFixed(1)}</span>
              </>
            ) : null}
          </p>
        )}
      </div>
    </header>
  )
}

/** Genres and plot once TMDB answers, a shimmer while it has not, the reason if it could not. */
function Overview({ details, error, loading }: { details: TitleDetails | null; error: string | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="flex gap-2">
          <div className="shimmer bg-secondary h-6 w-16 rounded-md" />
          <div className="shimmer bg-secondary h-6 w-20 rounded-md" />
          <div className="shimmer bg-secondary h-6 w-14 rounded-md" />
        </div>
        <div className="shimmer bg-secondary h-4 w-full rounded" />
        <div className="shimmer bg-secondary h-4 w-11/12 rounded" />
        <div className="shimmer bg-secondary h-4 w-2/3 rounded" />
      </div>
    )
  }

  if (error) {
    return <Dialog.Description className="text-muted-foreground text-sm">{error}</Dialog.Description>
  }

  return (
    <div className="space-y-5">
      {details && details.genres.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Genres">
          {details.genres.map((genre, index) => (
            <li
              key={genre}
              className="border-foreground/15 text-muted-foreground animation-delay-var rounded-md border px-2 py-0.5 text-xs font-medium motion-safe:animate-pop"
              style={{ '--delay': `${index * 50}ms` }}
            >
              {genre}
            </li>
          ))}
        </ul>
      )}
      <Dialog.Description
        className="text-foreground/85 animation-delay-var max-w-prose text-base leading-relaxed text-pretty motion-safe:animate-rise"
        style={{ '--delay': '120ms' }}
      >
        {details?.overview || 'No plot summary for this one yet.'}
      </Dialog.Description>
    </div>
  )
}

/** The details and where to go next: IMDb, or the Askarr step. */
function Details({
  item,
  requestButton,
  onAsk,
  children,
}: {
  item: PreviewItem
  requestButton: RefObject<HTMLButtonElement | null>
  onAsk: () => void
  children: ReactNode
}) {
  return (
    <div className="grid gap-6 px-5 pt-6 pb-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-10 sm:px-8 sm:pb-8">
      <div className="min-w-0">{children}</div>
      <div className="flex flex-col gap-2 sm:items-end">
        <Button asChild variant="cta" size="pill" className="max-sm:w-full">
          <a href={`https://www.imdb.com/title/${item.imdbId}/`} target="_blank" rel="noreferrer">
            View on IMDb
            <ExternalLinkIcon className="size-4" aria-hidden="true" />
          </a>
        </Button>
        <button
          ref={requestButton}
          type="button"
          onClick={onAsk}
          className="group/askarr bg-secondary hover:bg-accent inline-flex h-11 items-center justify-center gap-2.5 rounded-full ps-2 pe-5 font-bold transition hover:-translate-y-0.5 active:translate-y-0 max-sm:w-full"
        >
          <span className="bg-foreground/10 grid size-7 place-items-center rounded-full transition-transform duration-500 group-hover/askarr:scale-110">
            <AskarrMark className="size-4" />
          </span>
          Request with Askarr
        </button>
        <p className="text-muted-foreground text-2xs sm:text-right">Details and images from TMDB</p>
      </div>
    </div>
  )
}

function Sheet({ item, asking, onAsking }: { item: PreviewItem; asking: boolean; onAsking: (asking: boolean) => void }) {
  const { details, error, loading } = useTitleDetails(item.imdbId)
  const playButton = useRef<HTMLButtonElement>(null)
  const trailer = useTrailer(playButton)
  const requestButton = useRef<HTMLButtonElement>(null)
  const askHeading = useRef<HTMLHeadingElement>(null)

  // Focus follows the swap: onto the Askarr step when it opens, and back to the
  // button that opened it on the way back (however the way back was taken).
  const wasAsking = useRef(asking)
  useEffect(() => {
    if (asking) focusSoon(askHeading)
    else if (wasAsking.current) focusSoon(requestButton)
    wasAsking.current = asking
  }, [asking])

  return (
    <article className="@container relative">
      <Stage item={item} details={details} trailer={trailer} playButton={playButton} />
      <SheetHeader item={item} details={details} playing={trailer.playing} />
      <Swap shown={!asking} from="left">
        <Details item={item} requestButton={requestButton} onAsk={() => onAsking(true)}>
          <Overview details={details} error={error} loading={loading} />
        </Details>
      </Swap>
      <Swap shown={asking} from="right">
        <AskarrStep item={item} details={details} shown={asking} headingRef={askHeading} onBack={() => onAsking(false)} />
      </Swap>
    </article>
  )
}

/**
 * The popup a poster opens, after Askarr's title sheet: backdrop and trailer on
 * top, the cover rising over it, then genres, plot and where to go next.
 */
export function TitleDialog({ item, onClose }: { item: PreviewItem | null; onClose: () => void }) {
  // Which title is showing its Askarr step, so another title always opens on its details.
  const [askingFor, setAskingFor] = useState<string | null>(null)
  const asking = item !== null && askingFor === item.imdbId
  return (
    <Dialog.Root
      open={item !== null}
      onOpenChange={(open) => {
        if (open) return
        setAskingFor(null)
        onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content
          data-page-overlay=""
          // On the Askarr step, Escape goes back to the title rather than closing the sheet.
          onEscapeKeyDown={(event) => {
            if (!asking) return
            event.preventDefault()
            setAskingFor(null)
          }}
          className="bg-card text-card-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-6 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 fixed top-1/2 left-1/2 z-50 max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-x-hidden overflow-y-auto rounded-xl shadow-2xl ring-1 ring-white/10 duration-300"
        >
          {item && (
            <Sheet
              key={item.imdbId}
              item={item}
              asking={asking}
              onAsking={(next) => setAskingFor(next ? item.imdbId : null)}
            />
          )}
          <Dialog.Close
            aria-label="Close"
            className="absolute top-3 right-3 z-30 grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:rotate-90 hover:bg-black/65"
          >
            <XIcon className="size-4.5" aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
