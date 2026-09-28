import { useEffect, useRef, useState } from 'react'
import { ExternalLinkIcon, LoaderCircleIcon, Minimize2Icon, PlayIcon, PlusIcon, XIcon } from 'lucide-react'
import { Dialog } from 'radix-ui'

import { Cover } from '@/components/cover'
import { readTitleDetails, type PreviewItem, type TitleDetails } from '@/lib/api'

// How long the player takes to fade and the stage to fold before the player unmounts.
const CLOSE_MS = 450

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

function Sheet({ item }: { item: PreviewItem }) {
  const { details, error, loading } = useTitleDetails(item.imdbId)
  // idle -> open -> closing -> idle. 'closing' keeps the player mounted while it
  // fades and the stage folds back, so closing animates instead of vanishing.
  const [stage, setStage] = useState<'idle' | 'open' | 'closing'>('idle')
  const [trailerReady, setTrailerReady] = useState(false)
  const [backdropLoaded, setBackdropLoaded] = useState(false)
  const playButton = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const playing = stage === 'open'
  const playerMounted = stage !== 'idle'

  function openTrailer() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setTrailerReady(false)
    setStage('open')
  }

  function closeTrailer() {
    setStage('closing')
    closeTimer.current = setTimeout(() => {
      setStage('idle')
      requestAnimationFrame(() => playButton.current?.focus({ preventScroll: true }))
    }, CLOSE_MS)
  }

  const backdrop = details?.backdropUrl ?? null
  // Without a TMDB backdrop, the title's own cover, blurred, stands in for one.
  const fallbackBackdrop = !backdrop ? (item.poster ?? details?.posterUrl ?? null) : null
  const year = details?.year ?? item.year
  const meta = [year ? String(year) : '', runtimeLabel(details)].filter(Boolean)
  const trailer = details?.trailerKey
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(details.trailerKey)}?autoplay=1&rel=0&playsinline=1`
    : null

  return (
    <article className="@container relative">
      {/* The backdrop, and the stage the trailer plays on (16:9, under a strip for its close button). */}
      <div
        className={`group/stage ease-soft relative overflow-hidden transition-[height,background-color] duration-700 ${
          playing ? 'h-[calc(56.25cqw+3.5rem)] bg-black' : 'bg-secondary h-44 sm:h-64'
        }`}
      >
        {backdrop && (
          <img
            src={backdrop}
            alt=""
            decoding="async"
            onLoad={() => setBackdropLoaded(true)}
            className={`ease-soft absolute inset-0 size-full object-cover transition-[opacity,scale] duration-700 ${
              playing ? 'opacity-0' : backdropLoaded ? 'scale-100 opacity-100' : 'scale-105 opacity-0'
            } ${trailer && !playing ? 'group-hover/stage:scale-[1.03]' : ''}`}
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

        {trailer && !playerMounted && (
          <button
            ref={playButton}
            type="button"
            aria-label={`Play the ${item.title} trailer`}
            onClick={openTrailer}
            className="group/play absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 pb-10 text-white outline-none motion-safe:animate-[backdrop-in_400ms_ease-out_both] sm:pb-0"
          >
            <span className="flex size-14 scale-90 items-center justify-center rounded-full bg-white/15 opacity-0 shadow-2xl ring-1 ring-white/40 backdrop-blur-md transition duration-300 ring-inset group-hover/play:scale-100 group-hover/play:bg-white/25 group-hover/play:opacity-100 group-focus-visible/play:scale-100 group-focus-visible/play:opacity-100 group-focus-visible/play:ring-2 sm:size-16 [@media(hover:none)]:scale-100 [@media(hover:none)]:opacity-100">
              <PlayIcon className="size-6 translate-x-px fill-current" aria-hidden="true" />
            </span>
            <span className="text-ui translate-y-1 font-bold tracking-widest text-white/90 uppercase opacity-0 transition duration-300 [text-shadow:0_1px_10px_rgb(0_0_0/0.7)] group-hover/play:translate-y-0 group-hover/play:opacity-100 group-focus-visible/play:translate-y-0 group-focus-visible/play:opacity-100 max-sm:hidden [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
              Trailer
            </span>
          </button>
        )}

        {playerMounted && trailer && (
          <>
            {/* The player grows in from slightly small once it has loaded, and on close fades
                and shrinks back while the stage folds up around it. */}
            <iframe
              src={trailer}
              title={`${item.title} trailer`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setTrailerReady(true)}
              className={`ease-soft absolute inset-x-0 top-14 h-[calc(100%-3.5rem)] w-full origin-top border-0 transition-[opacity,scale] ${
                playing && trailerReady ? 'scale-100 opacity-100 delay-100 duration-700' : 'scale-[0.96] opacity-0 duration-300'
              }`}
            />
            {playing && !trailerReady && (
              <div className="absolute inset-x-0 top-14 bottom-0 grid place-items-center">
                <LoaderCircleIcon className="size-7 animate-spin text-white/70" aria-label="Loading the trailer" />
              </div>
            )}
            <button
              type="button"
              onClick={closeTrailer}
              className={`text-ui ease-soft absolute top-3 left-3 z-20 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3.5 font-bold text-white transition-[opacity,translate,background-color] duration-500 hover:bg-white/20 ${
                playing ? 'translate-y-0 opacity-100 motion-safe:animate-rise' : 'pointer-events-none -translate-y-2 opacity-0'
              }`}
            >
              <Minimize2Icon className="size-4" aria-hidden="true" /> Close trailer
            </button>
          </>
        )}
      </div>

      {/* Over the stage; only the poster takes the pointer, so the play button works around it. */}
      <header
        className={`ease-soft pointer-events-none relative z-20 flex gap-5 px-5 transition-[margin] duration-700 sm:gap-7 sm:px-8 ${
          playing ? 'mt-5' : '-mt-24 sm:-mt-32'
        }`}
      >
        <div
          className={`ease-soft pointer-events-auto shrink-0 transition-[width] duration-700 motion-safe:animate-rise ${
            playing ? 'w-20 sm:w-24' : 'w-28 sm:w-40'
          }`}
          style={{ animationDelay: '80ms' }}
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
            className="text-muted-foreground text-2xs flex items-center gap-2 font-bold tracking-widest uppercase motion-safe:animate-rise"
            style={{ animationDelay: '140ms' }}
          >
            <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[item.target]}`} />
            {TARGET_LINE[item.target]}
          </p>
          <Dialog.Title
            className="mt-2 text-2xl leading-tight font-bold tracking-tight text-balance motion-safe:animate-rise sm:text-4xl"
            style={{ animationDelay: '190ms' }}
          >
            {details?.title || item.title}
          </Dialog.Title>
          {(meta.length > 0 || details?.rating) && (
            <p
              className="text-muted-foreground mt-2.5 text-sm tabular-nums motion-safe:animate-rise"
              style={{ animationDelay: '240ms' }}
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

      <div className="grid gap-6 px-5 pt-6 pb-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-10 sm:px-8 sm:pb-8">
        <div className="min-w-0">
          {loading ? (
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
          ) : error ? (
            <Dialog.Description className="text-muted-foreground text-sm">{error}</Dialog.Description>
          ) : (
            <div className="space-y-5">
              {details && details.genres.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Genres">
                  {details.genres.map((genre, index) => (
                    <li
                      key={genre}
                      className="border-foreground/15 text-muted-foreground rounded-md border px-2 py-0.5 text-xs font-medium motion-safe:animate-pop"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      {genre}
                    </li>
                  ))}
                </ul>
              )}
              <Dialog.Description
                className="text-foreground/85 max-w-prose text-base leading-relaxed text-pretty motion-safe:animate-rise"
                style={{ animationDelay: '120ms' }}
              >
                {details?.overview || 'No plot summary for this one yet.'}
              </Dialog.Description>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <a
            href={`https://www.imdb.com/title/${item.imdbId}/`}
            target="_blank"
            rel="noreferrer"
            className="bg-primary text-primary-foreground shine inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 font-bold shadow-lg shadow-black/30 transition hover:-translate-y-0.5 active:translate-y-0 max-sm:w-full"
          >
            View on IMDb
            <ExternalLinkIcon className="size-4" aria-hidden="true" />
          </a>
          <a
            href={askarrLink(item, details)}
            className="group/askarr bg-secondary hover:bg-accent inline-flex h-11 items-center justify-center gap-2.5 rounded-full ps-2 pe-5 font-bold transition hover:-translate-y-0.5 active:translate-y-0 max-sm:w-full"
          >
            <span className="bg-foreground/10 grid size-7 place-items-center rounded-full transition-transform duration-500 group-hover/askarr:rotate-90">
              <PlusIcon className="size-4" aria-hidden="true" />
            </span>
            Request with Askarr
          </a>
          <p className="text-muted-foreground text-2xs sm:text-right">Details and images from TMDB</p>
        </div>
      </div>
    </article>
  )
}

/**
 * The popup a poster opens, after Askarr's title sheet: backdrop and trailer on
 * top, the cover rising over it, then genres, plot and where to go next.
 */
export function TitleDialog({ item, onClose }: { item: PreviewItem | null; onClose: () => void }) {
  return (
    <Dialog.Root open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content
          data-page-overlay=""
          className="bg-card text-card-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-6 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 fixed top-1/2 left-1/2 z-50 max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-x-hidden overflow-y-auto rounded-xl shadow-2xl ring-1 ring-white/10 duration-300"
        >
          {item && <Sheet key={item.imdbId} item={item} />}
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
