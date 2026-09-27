import type { FormEvent } from 'react'
import { ArrowRightIcon, LoaderCircleIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Reveal } from '@/components/reveal'
import { ASKARR_URL, SectionTitle, type SignInClick } from '@/components/site-chrome'
import { signInHref } from '@/lib/feed-page'
import type { Session } from '@/lib/api'

const EXAMPLE_URL = 'https://www.imdb.com/list/ls006123300/'

const STEPS = [
  {
    title: 'Paste a public IMDb link',
    body: 'Open your watchlist (imdb.com/user/ur…/watchlist/) or a list (imdb.com/list/ls…) on IMDb and copy the address from your browser. Make sure it is set to public, or we cannot read it.',
  },
  {
    title: 'Copy your two links',
    body: 'The same IMDb list always gives you the same two links, so you only have to set this up once.',
  },
  {
    title: 'Paste them into Radarr and Sonarr',
    body: 'Radarr takes the movies link as an RSS list. Sonarr takes the shows link as a custom list.',
  },
]

/** Steps of the page's opening, each rising in a beat after the last. */
function beat(step: number) {
  return { animationDelay: `${step * 80}ms` }
}

export function Hero() {
  return (
    <section className="relative isolate pt-10 pb-8 sm:pt-16 sm:pb-10">
      {/* A slow yellow glow drifting behind the headline: IMDb's colour as light, not as a block. */}
      <div
        aria-hidden="true"
        className="bg-primary/15 pointer-events-none absolute -top-32 -right-24 -z-10 size-96 rounded-full blur-3xl motion-safe:animate-drift sm:size-160"
      />
      <p className="text-ink text-ui mb-3 font-bold tracking-wider uppercase motion-safe:animate-rise" style={beat(0)}>
        IMDb lists for Radarr and Sonarr
      </p>
      <h1
        className="max-w-4xl text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl motion-safe:animate-rise"
        style={beat(1)}
      >
        Your IMDb list, straight into <span className="underline-sweep">Radarr and Sonarr</span>.
      </h1>
      <p
        className="text-muted-foreground mt-4 max-w-2xl text-base text-pretty sm:text-lg motion-safe:animate-rise"
        style={beat(2)}
      >
        Paste a public IMDb watchlist or list. You get two links back: one Radarr uses for the
        movies, one Sonarr uses for the shows. Both read the same list, and it is free.
      </p>
    </section>
  )
}

/**
 * IMDb's search bar, doing this site's one job: a white field joined to a
 * yellow button (stacked on a phone, where a joined pair is too cramped). When
 * either has focus the yellow ring goes around the pair, the way one control
 * would; the X in the field clears it, and whatever it had built.
 */
export function FeedForm({
  sourceUrl,
  onSourceUrlChange,
  onClear,
  looksValid,
  pending,
  canSubmit,
  signedIn,
  onSubmit,
}: {
  sourceUrl: string
  onSourceUrlChange: (value: string) => void
  onClear: () => void
  looksValid: boolean
  pending: boolean
  canSubmit: boolean
  signedIn: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="bg-card ring-foreground/10 rounded-lg p-5 ring-1 sm:p-8 motion-safe:animate-rise"
      style={beat(3)}
    >
      <Label htmlFor="source-url" className="text-muted-foreground mb-2 block text-sm font-medium">
        IMDb watchlist or list URL
      </Label>
      <div className="sm:focus-within:ring-primary/70 flex flex-col gap-3 rounded-md transition-shadow sm:h-12 sm:flex-row sm:gap-0 sm:focus-within:ring-3">
        <div className="relative sm:flex-1">
          <Input
            id="source-url"
            name="sourceUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="Paste your IMDb list or watchlist link"
            value={sourceUrl}
            onChange={(event) => onSourceUrlChange(event.target.value)}
            aria-invalid={!looksValid}
            aria-describedby="source-url-hint"
            className={`h-12 rounded-md border-black/15 bg-white pl-4 text-base text-black placeholder:text-black/45 sm:h-full sm:rounded-r-none sm:focus-visible:ring-0 md:text-base dark:border-transparent dark:bg-white ${
              sourceUrl ? 'pr-11' : 'pr-4'
            }`}
            required
          />
          {sourceUrl && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear the link"
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-black/45 transition-colors hover:bg-black/5 hover:text-black motion-safe:animate-pop"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <Button
          type="submit"
          disabled={!canSubmit}
          className="shine h-12 rounded-md border-0 px-7 text-base font-bold sm:h-full sm:rounded-l-none sm:focus-visible:ring-0"
        >
          {pending ? (
            <>
              <LoaderCircleIcon className="size-4 animate-spin" />
              Building
            </>
          ) : (
            <>
              Generate
              <ArrowRightIcon className="size-4 transition-transform group-hover/button:translate-x-0.5" />
            </>
          )}
        </Button>
      </div>
      <p
        id="source-url-hint"
        className={looksValid ? 'text-muted-foreground mt-3 text-sm' : 'text-destructive mt-3 text-sm'}
      >
        {looksValid ? (
          <>
            Try{' '}
            <button
              type="button"
              className="hover:text-ink break-all underline underline-offset-2 transition-colors"
              onClick={() => onSourceUrlChange(EXAMPLE_URL)}
            >
              {EXAMPLE_URL}
            </button>
          </>
        ) : (
          'That does not look like an IMDb list or watchlist link.'
        )}
      </p>
      {signedIn && (
        <p className="text-muted-foreground mt-1 text-sm">
          You are signed in, so every list you paste here is kept up to date for you.
        </p>
      )}
    </form>
  )
}

export function HowItWorks() {
  return (
    <section className="mt-12" aria-labelledby="how-it-works">
      <SectionTitle id="how-it-works">How it works</SectionTitle>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Reveal delay={index * 120} className="h-full">
              <div className="bg-card ring-foreground/10 hover:ring-primary/50 h-full rounded-lg p-5 ring-1 transition duration-300 hover:-translate-y-1 sm:p-6">
                <span className="bg-primary text-primary-foreground mb-4 flex size-8 items-center justify-center rounded-full text-sm font-bold tabular-nums">
                  {index + 1}
                </span>
                <h3 className="mb-2 text-lg font-bold">{step.title}</h3>
                <p className="text-muted-foreground text-sm text-pretty">{step.body}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * The general case for an account, for a visitor who has not built anything
 * yet. Once they have a result, the result panel makes the same case about
 * that list instead, so the two never show together.
 */
export function KeepUpdating({
  session,
  hasResult,
  onSignIn,
}: {
  session: Session | null
  hasResult: boolean
  onSignIn: SignInClick
}) {
  if (!session?.authAvailable || session.signedIn || hasResult) {
    return null
  }

  return (
    <div className="bg-card border-primary ring-foreground/10 mt-12 flex flex-col gap-4 rounded-lg border-l-4 p-5 ring-1 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <p className="font-medium text-pretty">
        Sign in, free, and we check your list about every fifteen minutes.
      </p>
      <Button asChild className="shine h-10 shrink-0 px-5 font-bold">
        <a href={signInHref()} onClick={onSignIn}>
          Sign in with Connections
        </a>
      </Button>
    </div>
  )
}

/**
 * Askarr is LunarWerx's other Radarr and Sonarr product, and the visitor who
 * has just wired up both apps is exactly who it is for: the list feed covers
 * what they planned on IMDb, Askarr covers the one title they think of on the
 * go.
 */
export function AskarrSection() {
  return (
    <section className="mt-12" aria-labelledby="more-from-lunarwerx">
      <SectionTitle id="more-from-lunarwerx">More from LunarWerx</SectionTitle>
      <div className="bg-card ring-foreground/10 rounded-lg p-5 ring-1 sm:p-8">
        <h3 className="text-lg font-bold">Askarr</h3>
        <p className="mt-1 font-medium">Want one title without editing the list?</p>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
          Search any movie or show from your phone or any browser, tap request, and the Askarr
          Monitor on your Windows PC adds it to your own Radarr and Sonarr. Nothing on your network
          has to face the internet. Free to start.
        </p>
        <Button asChild variant="secondary" className="mt-5 h-10 px-5 font-bold">
          <a href={ASKARR_URL}>
            Try Askarr
            <ArrowRightIcon className="size-4" />
          </a>
        </Button>
      </div>
    </section>
  )
}
