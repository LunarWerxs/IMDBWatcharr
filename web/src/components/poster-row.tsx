import { Suspense, useState } from 'react'
import {
  CheckIcon,
  ClapperboardIcon,
  EyeOffIcon,
  FilmIcon,
  MinusIcon,
  TvIcon,
} from 'lucide-react'

import { Cover } from '@/components/cover'
import { ScrollRow } from '@/components/scroll-row'
import { SectionTitle } from '@/components/site-chrome'
import type { CreateFeedResponse, PreviewItem } from '@/lib/api'
import { lazyPart } from '@/lib/lazy'

// The popup only matters once a poster is clicked, so it loads after the page.
const TitleDialog = lazyPart(() => import('@/components/title-dialog').then((module) => module.TitleDialog))

// Where each title goes, as the glass chip on its cover: the app's icon from the feed cards, and its name.
const TARGET_CHIPS = {
  radarr: { icon: FilmIcon, label: 'Radarr', spoken: 'a movie for Radarr' },
  sonarr: { icon: TvIcon, label: 'Sonarr', spoken: 'a series for Sonarr' },
  skipped: { icon: EyeOffIcon, label: 'Skipped', spoken: 'skipped' },
} satisfies Record<PreviewItem['target'], unknown>

const ITEM_WIDTH = 'w-36 shrink-0 snap-start sm:w-44'

function PosterCard({ item, order, onOpen }: { item: PreviewItem; order: number; onOpen: (item: PreviewItem) => void }) {
  const sent = item.target !== 'skipped'
  const chip = TARGET_CHIPS[item.target]
  const ChipIcon = chip.icon
  return (
    <li
      className={`${ITEM_WIDTH} animation-delay-var motion-safe:animate-pop`}
      style={{ '--delay': `${Math.min(order, 12) * 55}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`${item.title}${item.year ? ` (${item.year})` : ''}, ${chip.spoken}: details`}
        className="group/poster block w-full rounded-md text-left"
        title={sent ? undefined : 'Sonarr needs a TVDB id for this one, or neither app takes this kind of title.'}
      >
        <div className="group-hover/poster:ring-primary relative aspect-2/3 overflow-hidden rounded-md shadow-lg ring-1 shadow-black/40 ring-white/10 transition duration-300 group-hover/poster:-translate-y-1.5 group-hover/poster:shadow-2xl">
          <Cover
            seed={item.imdbId}
            src={item.poster}
            className="size-full transition-transform duration-500 group-hover/poster:scale-105"
          />
          <span
            aria-hidden="true"
            // IMDb's bookmark ribbon; dark over any cover, in either theme.
            className="dark bg-background/80 clip-ribbon absolute top-0 left-3 flex h-11 w-8 justify-center pt-1.5 backdrop-blur-sm"
          >
            {sent ? <CheckIcon className="text-primary size-4" /> : <MinusIcon className="size-4 text-white/60" />}
          </span>
          <span
            aria-hidden="true"
            // Frosted glass over the cover, so it reads on any picture in either theme.
            className={`absolute bottom-2 left-2 flex items-center gap-1 rounded-full border border-white/20 bg-black/40 py-0.5 ps-1.5 pe-2 text-2xs font-bold shadow-md shadow-black/30 backdrop-blur-md ${
              sent ? 'text-white' : 'text-white/70'
            }`}
          >
            <ChipIcon className={`size-3 ${sent ? 'text-primary' : ''}`} />
            {chip.label}
          </span>
          {/* Without a cover, the tile carries the title itself, above the chip. */}
          {!item.poster && (
            <span className="absolute inset-x-0 bottom-0 line-clamp-3 bg-linear-to-t from-black/85 via-black/50 to-transparent p-3 pt-8 pb-10 text-sm leading-tight font-bold text-white">
              {item.title}
            </span>
          )}
        </div>
        <span className="mt-2 block truncate text-sm font-bold group-hover/poster:underline">{item.title}</span>
        <span className="text-muted-foreground text-ui block">{item.year ?? 'Year unknown'}</span>
      </button>
    </li>
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

  // The poster whose popup is open, if any, and whether one ever was: from then
  // on the popup stays mounted, so it can animate shut.
  const [open, setOpen] = useState<PreviewItem | null>(null)
  const [opened, setOpened] = useState(false)
  const openPoster = (item: PreviewItem) => {
    setOpened(true)
    setOpen(item)
  }

  let caption = 'The titles we read from your list show up here.'
  if (loading) caption = 'The titles show up here as soon as we have read the list.'
  else if (result && items.length === 0) caption = 'Nothing to show yet: we have no titles from this list.'

  return (
    <section className="mt-12" aria-labelledby="on-this-list">
      <SectionTitle id="on-this-list">On this list</SectionTitle>
      {items.length === 0 && <p className="text-muted-foreground -mt-2 mb-4 text-sm">{caption}</p>}
      <ScrollRow
        key={result?.slug ?? 'none'}
        label="titles"
        count={items.length}
        arrows={items.length > 0}
        arrowTop="top-24 sm:top-28"
        className="-mx-4 snap-x snap-mandatory scroll-px-4 gap-4 px-4 pt-1 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0"
      >
          {items.length > 0
            ? items.map((item, index) => <PosterCard key={item.imdbId} item={item} order={index} onOpen={openPoster} />)
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
      </ScrollRow>
      {opened && (
        <Suspense fallback={null}>
          <TitleDialog item={open} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </section>
  )
}
