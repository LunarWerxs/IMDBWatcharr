import type { MouseEvent, ReactNode } from 'react'
import { ChevronRightIcon, ClapperboardIcon, UserIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { GithubLink } from '@/components/github-link'
import { NotificationsBadge } from '@/components/notifications-badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { signInHref } from '@/lib/feed-page'
import type { Session } from '@/lib/api'

export type SignInClick = (event: MouseEvent<HTMLAnchorElement>) => void

export const ASKARR_URL = 'https://askarr.com/?utm_source=watcharr&utm_medium=referral'
const REPO_URL = 'https://github.com/LunarWerxs/IMDBWatcharr'

/** The page's width, shared by the header, the main column and the footer. */
export const PAGE_WIDTH = 'mx-auto w-full max-w-6xl px-4 sm:px-6'

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
    <Button asChild variant="ghost" size="sm" className="hover:text-primary font-medium">
      <a href={signInHref(listUrl || undefined)} onClick={onSignIn}>
        <UserIcon className="size-4" />
        Sign in
      </a>
    </Button>
  )
}

/**
 * IMDb's bar: black whatever the theme (the `dark` class gives everything in
 * it the dark tokens), sticky, with the product mark on the left. The mark is
 * our own clapperboard on IMDb yellow, never IMDb's logo.
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
    <header className="dark text-foreground sticky top-0 z-40 border-b border-white/10 bg-black">
      <div className={`${PAGE_WIDTH} flex h-14 items-center justify-between gap-3`}>
        <a href="/" className="flex min-w-0 items-center gap-2.5" aria-label="IMDb Watcharr home">
          <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
            <ClapperboardIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="truncate text-xl font-black tracking-tight">Watcharr</span>
          <span className="text-muted-foreground hidden text-sm md:inline">for IMDb lists</span>
        </a>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <NotificationsBadge signedIn={Boolean(session?.signedIn)} />
          <a
            href="https://lunarwerx.com"
            aria-label="LunarWerx Studios"
            title="LunarWerx Studios"
            className="hover:ring-primary/70 focus-visible:ring-primary mx-1 flex size-7 shrink-0 items-center justify-center rounded-full ring-2 ring-transparent transition focus-visible:outline-none"
          >
            <img src="/lunarwerx-mark.png" alt="" width={28} height={28} className="size-7 rounded-full" />
          </a>
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
    <footer className="dark text-muted-foreground border-t border-white/10 bg-black text-sm">
      <div className={`${PAGE_WIDTH} grid gap-2 py-10`}>
        <p>
          <span className="text-foreground font-bold">IMDb Watcharr</span>
          <span aria-hidden="true"> · </span>
          by{' '}
          <a href="https://lunarwerx.com" className={link}>
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
        <p className="text-xs">Not affiliated with IMDb. IMDb is a trademark of IMDb.com, Inc.</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <a href={REPO_URL} className={link} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={`${REPO_URL}/blob/main/LICENSING.md`} className={link} target="_blank" rel="noreferrer">
            Free for noncommercial use (PolyForm Noncommercial)
          </a>
          <a href="https://lunarwerx.com" className={link}>
            LunarWerx Studios
          </a>
        </p>
      </div>
    </footer>
  )
}
