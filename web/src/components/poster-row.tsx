import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClapperboardIcon, MinusIcon } from 'lucide-react'

import { SectionTitle } from '@/components/site-chrome'
import type { CreateFeedResponse, PreviewItem } from '@/lib/api'
import { scrollBehavior } from '@/lib/motion'

// Posters are ours, not IMDb's: a dark duotone per title, picked from its id so
// the same title always gets the same one. Nothing is fetched from IMDb.
const DUOTONES = [
  ['rgba(245,158,11,0.45)', '#b45309', '#2a1205'],
  ['rgba(20,184,166,0.45)', '#0f766e', '#042f2e'],
  ['rgba(244,63,94,0.40)', '#be123c', '#4c0519'],
  ['rgba(234,179,8,0.40)', '#a16207', '#3f1508'],
  ['rgba(249,115,22,0.45)', '#c2410c', '#301006'],
  ['rgba(163,163,163,0.35)', '#525252', '#171717'],
  ['rgba(132,204,22,0.40)', '#4d7c0f', '#1a2e05'],
  ['rgba(217,70,239,0.35)', '#86198f', '#2e0633'],
] as const

function posterBackground(imdbId: string): string {
  let hash = 0
  for (const char of imdbId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const [glow, top, bottom] = DUOTONES[hash % DUOTONES.length]
  return `radial-gradient(circle at 65% 25%, ${glow}, transparent 60%), linear-gradient(160deg, ${top} 0%, ${bottom} 70%, #070707 100%)`
}

const TARGET_LABELS: Record<PreviewItem['target'], string> = {
  radarr: 'Movie → Radarr',
  sonarr: 'Series → Sonarr',
  skipped: 'Skipped',
}

// IMDb's bookmark ribbon, cut from a rectangle.
const RIBBON_SHAPE = { clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)' }

const ITEM_WIDTH = 'w-36 shrink-0 snap-start sm:w-44'

function PosterCard({ item, order }: { item: PreviewItem; order: number }) {
  const sent = item.target !== 'skipped'
  return (
    <li className={`${ITEM_WIDTH} motion-safe:animate-pop`} style={{ animationDelay: `${Math.min(order, 12) * 45}ms` }}>
      <a
        href={`https://www.imdb.com/title/${item.imdbId}/`}
        target="_blank"
        rel="noreferrer"
        className="group/poster block rounded-md"
        title={sent ? undefined : 'Sonarr needs a TVDB id for this one, or neither app takes this kind of title.'}
      >
        <div
          className="group-hover/poster:ring-primary relative aspect-2/3 overflow-hidden rounded-md shadow-lg ring-1 shadow-black/40 ring-white/10 transition duration-200 group-hover/poster:-translate-y-1"
          style={{ background: posterBackground(item.imdbId) }}
        >
          <span
            aria-hidden="true"
            className="absolute top-0 left-3 flex h-11 w-8 justify-center bg-neutral-900/80 pt-1.5 backdrop-blur-sm"
            style={RIBBON_SHAPE}
          >
            {sent ? <CheckIcon className="text-primary size-4" /> : <MinusIcon className="size-4 text-white/60" />}
          </span>
          <span className="absolute inset-x-0 bottom-0 line-clamp-3 bg-linear-to-t from-black/85 via-black/50 to-transparent p-3 pt-8 text-sm leading-tight font-bold text-white">
            {item.title}
          </span>
        </div>
        <span className="mt-2 block truncate text-sm font-bold group-hover/poster:underline">{item.title}</span>
        <span className="text-muted-foreground text-ui block">{item.year ?? 'Year unknown'}</span>
        <span
          className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-xs ${
            sent ? 'border-foreground/30 text-foreground/85' : 'border-foreground/15 text-muted-foreground'
          }`}
        >
          {TARGET_LABELS[item.target]}
        </span>
      </a>
    </li>
  )
}

/**
 * IMDb's carousel arrows: for a mouse, which cannot swipe the row. They show
 * on hover (or keyboard focus) and hide at the end they cannot go past; on a
 * touch screen the row is swiped instead, so they are not there at all.
 */
function RowArrow({ side, hidden, onClick }: { side: 'left' | 'right'; hidden: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeftIcon : ChevronRightIcon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Scroll the titles back' : 'Scroll the titles forward'}
      tabIndex={hidden ? -1 : 0}
      className={`hover:text-primary absolute top-24 z-10 hidden h-14 w-11 -translate-y-1/2 items-center justify-center rounded-md border border-white/50 bg-black/60 text-white backdrop-blur-sm transition-opacity duration-200 sm:flex sm:top-28 ${
        side === 'left' ? '-left-2' : '-right-2'
      } ${hidden ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'}`}
    >
      <Icon className="size-7" aria-hidden="true" />
    </button>
  )
}

function GhostPoster({ loading }: { loading: boolean }) {
  return (
    <li className={ITEM_WIDTH} aria-hidden="true">
      <div
        className={`border-foreground/15 flex aspect-2/3 items-center justify-center rounded-md border-2 border-dashed ${loading ? 'shimmer' : ''}`}
      >
        <ClapperboardIcon className="text-muted-foreground/40 size-8" />
      </div>
      <div className="bg-foreground/10 mt-2 h-3.5 w-3/4 rounded" />
      <div className="bg-foreground/5 mt-1.5 h-3 w-1/3 rounded" />
    </li>
  )
}

/**
 * The titles we read, as a row of posters that scrolls sideways (edge to edge
 * on a phone). Before there are titles it keeps the row's shape, and says why
 * it is empty.
 */
export function PosterRow({
  pending,
  result,
  listUrl,
}: {
  pending: boolean
  result: CreateFeedResponse | null
  listUrl: string
}) {
  const items = pending ? [] : (result?.preview ?? [])
  const more = result && !pending ? result.totalCount - items.length : 0
  const loading = pending || Boolean(result?.syncing)

  const rowRef = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ atStart: true, atEnd: true })
  const readEdges = () => {
    const row = rowRef.current
    if (!row) return
    setEdges({
      atStart: row.scrollLeft < 8,
      atEnd: row.scrollLeft + row.clientWidth > row.scrollWidth - 8,
    })
  }
  // Once the titles are laid out, see whether there is anything to scroll to.
  useEffect(() => {
    const frame = requestAnimationFrame(readEdges)
    return () => cancelAnimationFrame(frame)
  }, [items.length])
  const page = (direction: 1 | -1) => {
    const row = rowRef.current
    row?.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: scrollBehavior() })
  }

  let caption = 'The titles we read from your list show up here.'
  if (loading) caption = 'The titles show up here as soon as we have read the list.'
  else if (result && items.length === 0) caption = 'Nothing to show yet: we have no titles from this list.'

  return (
    <section className="mt-12" aria-labelledby="on-this-list">
      <SectionTitle id="on-this-list">On this list</SectionTitle>
      {items.length === 0 && <p className="text-muted-foreground -mt-2 mb-4 text-sm">{caption}</p>}
      <div className="group/row relative">
        <ul
          ref={rowRef}
          onScroll={readEdges}
          key={result?.slug ?? 'none'}
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pt-1 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0"
        >
          {items.length > 0
            ? items.map((item, index) => <PosterCard key={item.imdbId} item={item} order={index} />)
            : Array.from({ length: 6 }, (_, index) => <GhostPoster key={index} loading={loading} />)}
          {more > 0 && (
            <li className={ITEM_WIDTH}>
              <a
                href={listUrl}
                target="_blank"
                rel="noreferrer"
                className="border-foreground/20 text-muted-foreground hover:border-primary hover:text-ink flex aspect-2/3 items-center justify-center rounded-md border-2 border-dashed p-4 text-center text-sm font-bold transition-colors"
              >
                +{more} more on IMDb
              </a>
            </li>
          )}
        </ul>
        {items.length > 0 && (
          <>
            <RowArrow side="left" hidden={edges.atStart} onClick={() => page(-1)} />
            <RowArrow side="right" hidden={edges.atEnd} onClick={() => page(1)} />
          </>
        )}
      </div>
    </section>
  )
}
