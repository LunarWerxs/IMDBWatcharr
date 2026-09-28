import { Suspense, type MouseEvent, type ReactNode } from 'react'
import { ChevronRightIcon, UserIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { GithubLink, REPO_URL } from '@/components/github-link'
import { ThemeToggle } from '@/components/theme-toggle'
import { signInHref } from '@/lib/feed-page'
import { lazyPart } from '@/lib/lazy'
import type { Session } from '@/lib/api'

export type SignInClick = (event: MouseEvent<HTMLAnchorElement>) => void

export const ASKARR_URL = 'https://askarr.com/?utm_source=watcharr&utm_medium=referral'
const STUDIO_URL = 'https://lunarwerx.com'

// Only a signed-in visitor can have a feed that needs attention.
const NotificationsBadge = lazyPart(() =>
  import('@/components/notifications-badge').then((module) => module.NotificationsBadge),
)

/** The page's width, shared by the header, the main column and the footer. */
export const PAGE_WIDTH = 'mx-auto w-full max-w-260 px-4 sm:px-6'

/**
 * IMDb's section heading: a yellow bar, the title, a chevron that leans in on
 * hover. Every section on the page opens with one, and its bar grows in as the
 * section arrives (index.css, .title-bar).
 */
export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group/title mb-5 flex scroll-mt-20 items-stretch gap-3 text-2xl leading-tight font-bold">
      <span aria-hidden="true" className="title-bar bg-primary w-1 shrink-0 rounded-full" />
      <span className="flex items-center gap-1">
        {children}
        <ChevronRightIcon
          aria-hidden="true"
          className="size-6 transition-transform group-hover/title:translate-x-0.5 group-hover/title:text-ink"
        />
      </span>
    </h2>
  )
}

/**
 * Signing in is what turns a one-off read into a list that keeps itself
 * current, so the control only exists where Connections is configured.
 */
function AccountControl({
  session,
  listUrl,
  onSignIn,
}: {
  session: Session | null
  listUrl: string
  onSignIn: SignInClick
}) {
  if (!session?.authAvailable) {
    return null
  }

  if (session.signedIn) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground hidden max-w-32 truncate text-xs sm:inline">
          {session.name ?? 'Signed in'}
        </span>
        <Button asChild variant="ghost" size="sm">
          <a href="/auth/logout">Sign out</a>
        </Button>
      </div>
    )
  }

  return (
    <Button asChild variant="ghost-brand" size="sm">
      <a href={signInHref(listUrl || undefined)} onClick={onSignIn}>
        <UserIcon className="size-4" />
        Sign in
      </a>
    </Button>
  )
}

/**
 * Up to the studio, drawn like the icons beside it: one colour, the GitHub
 * mark's size. The mark is the LunarWerx badge's crescent and <\> as a glyph.
 */
function LunarWerxLink() {
  return (
    <Button asChild variant="ghost" size="icon">
      <a href={STUDIO_URL} aria-label="LunarWerx Studios" title="LunarWerx Studios">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M8.88 1.72A10.5 10.5 0 1 0 20.69 16.05A9.3 9.3 0 0 1 8.88 1.72Z" />
          <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.4 8.6 11.8 11.2l2.6 2.6" />
            <path d="M16.2 8.2 18 14.2" />
            <path d="M19.8 8.6 22.4 11.2l-2.6 2.6" />
          </g>
        </svg>
      </a>
    </Button>
  )
}

/**
 * The top bar: just off black whatever the theme (the `dark` class gives
 * everything in it the dark tokens), sticky, with the product mark on the left:
 * the Watcharr mark in its on-dark colours, the same mark as the favicon, never
 * IMDb's logo.
 */
export function SiteHeader({
  session,
  listUrl,
  onSignIn,
}: {
  session: Session | null
  listUrl: string
  onSignIn: SignInClick
}) {
  return (
    <header className="dark text-foreground bg-chrome lift-on-scroll sticky top-0 z-40 border-b border-white/10">
      <div className={`${PAGE_WIDTH} flex h-14 items-center justify-between gap-3`}>
        <a href="/" className="flex min-w-0 items-center gap-2.5" aria-label="IMDb Watcharr home">
          <img src="/brand/watcharr-mark-on-dark.svg" alt="" width="36" height="36" className="size-9 shrink-0" />
          <span className="truncate text-xl font-black tracking-tight">
            Watch<span className="text-primary">arr</span>
          </span>
          <span className="text-muted-foreground hidden text-sm md:inline">for IMDb lists</span>
        </a>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {session?.signedIn && (
            <Suspense fallback={null}>
              <NotificationsBadge />
            </Suspense>
          )}
          <LunarWerxLink />
          <GithubLink />
          <ThemeToggle />
          <AccountControl session={session} listUrl={listUrl} onSignIn={onSignIn} />
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  const link = 'hover:text-primary underline underline-offset-2 transition-colors'
  return (
    <footer className="dark text-muted-foreground bg-chrome border-t border-white/10 text-sm">
      <div className={`${PAGE_WIDTH} grid gap-2 py-10`}>
        <p>
          <span className="text-foreground font-bold">IMDb Watcharr</span>
          <span aria-hidden="true"> · </span>
          by{' '}
          <a href={STUDIO_URL} className={link}>
            LunarWerx
          </a>
        </p>
        <p>
          Also for Radarr and Sonarr:{' '}
          <a href={ASKARR_URL} className={`text-foreground ${link}`}>
            Askarr
          </a>
          , request any movie or show from anywhere and it lands at home.
        </p>
        <p className="text-xs">
          Not affiliated with IMDb. IMDb is a trademark of IMDb.com, Inc. Title details and images from{' '}
          <a href="https://www.themoviedb.org/" className={link} target="_blank" rel="noreferrer">
            TMDB
          </a>
          ; this product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <a href={REPO_URL} className={link} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={`${REPO_URL}/blob/main/LICENSING.md`} className={link} target="_blank" rel="noreferrer">
            Free for noncommercial use (PolyForm Noncommercial)
          </a>
          <a href={STUDIO_URL} className={link}>
            LunarWerx Studios
          </a>
        </p>
      </div>
    </footer>
  )
}
