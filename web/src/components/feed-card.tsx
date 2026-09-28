import type { ReactNode } from 'react'
import { ChevronRightIcon, EyeOffIcon, FilmIcon, ListVideoIcon, TvIcon } from 'lucide-react'

// The result card's shape, shared by the empty card on arrival (feed-panel.tsx)
// and the filled-in one (result-panel.tsx), which loads after the page.

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

export type Target = (typeof TARGETS)[number]

// The list's counts, as one line under its name: an icon, the number, a word.
const STATS = [
  { key: 'totalCount', label: 'Titles on the list', word: 'titles', icon: ListVideoIcon },
  { key: 'radarrCount', label: 'Movies for Radarr', word: 'movies', icon: FilmIcon },
  { key: 'sonarrCount', label: 'Shows for Sonarr', word: 'shows', icon: TvIcon },
  { key: 'sonarrUnresolvedCount', label: 'Shows we skipped', word: 'skipped', icon: EyeOffIcon },
] as const

export type Stat = (typeof STATS)[number]

/** How long an element waits to rise: `order` steps after the panel it sits in. */
function riseDelay(order: number): string {
  return `${order * 70}ms`
}

/** The list's counts, as one line under its name; `item` draws each count, rising `delay` after the panel. */
export function StatLine({ item }: { item: (stat: Stat, delay: string) => ReactNode }) {
  return (
    <dl className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
      {STATS.map((stat, index) => item(stat, riseDelay(index)))}
    </dl>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card ring-foreground/10 relative overflow-hidden rounded-lg p-5 ring-1 sm:p-8 ${className}`}>
      {children}
    </div>
  )
}

/** The Radarr and Sonarr cards: where each link goes in its app, and the link itself (or where it will be). */
export function TargetCards({ link }: { link: (target: Target) => ReactNode }) {
  return (
    // grid-cols-1, not the implicit column: a link that will not wrap must not widen the card past the screen.
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {TARGETS.map((target, index) => {
        const Icon = target.icon
        return (
          // relative: painted over the fanned covers' shadows, which fall onto the top of these.
          <div
            key={target.app}
            className="bg-secondary ring-foreground/10 animation-delay-var relative rounded-lg p-4 ring-1 motion-safe:animate-rise"
            style={{ '--delay': riseDelay(4 + index) }}
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
            {link(target)}
          </div>
        )
      })}
    </div>
  )
}
