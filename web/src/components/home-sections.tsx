import { useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  ArrowRightIcon,
  CheckIcon,
  FilmIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'

import { AskarrLogo, AskarrMark } from '@/components/askarr-brand'
import { Button } from '@/components/ui/button'
import { SignInWithConnections } from '@/components/connections-sign-in'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Reveal } from '@/components/reveal'
import { ASKARR_URL, SectionTitle, type SignInClick } from '@/components/site-chrome'
import { DEMO_URL } from '@/lib/demo-mode'
import { signInHref } from '@/lib/feed-page'
import { isSupportedImdbUrl, type Session } from '@/lib/api'

// Public IMDb lists to try, none of them anyone's own watchlist: films, shows,
// and a mix of both. All read cleanly, covers and all, on 2026-09-28, and each
// is pre-built on the live site so its first click is instant: build any list
// added here the same way (POST it to /api/create, then run the sync once).
const EXAMPLE_LISTS = [
  { name: 'The 100 greatest movies', url: 'https://www.imdb.com/list/ls055592025/' },
  { name: 'Variety’s 100 greatest TV shows', url: 'https://www.imdb.com/list/ls522130686/' },
  { name: 'Every Marvel movie and show', url: 'https://www.imdb.com/list/ls505369170/' },
  { name: 'Every Best Picture winner', url: 'https://www.imdb.com/list/ls009480135/' },
  { name: 'Every Studio Ghibli film', url: 'https://www.imdb.com/list/ls575362999/' },
  { name: 'The top 100 TV shows', url: 'https://www.imdb.com/list/ls004729995/' },
] as const

// One example per visit, picked at random in the browser. The prerendered page
// always carries the first, and React swaps in the pick after hydrating, so the
// two never disagree.
const pickedExample = typeof window === 'undefined' ? 0 : Math.floor(Math.random() * EXAMPLE_LISTS.length)
const noChanges = () => () => {}

function useExampleList() {
  return EXAMPLE_LISTS[
    useSyncExternalStore(
      noChanges,
      () => pickedExample,
      () => 0,
    )
  ]
}

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
    body: 'In each app, add a list of its own kind (Radarr in Radarr, Sonarr in Sonarr) and paste the link as its Full URL. They check it every 15 and 5 minutes.',
  },
]

/** How long a step of the page's opening waits, each rising a beat after the last. */
function beat(step: number): string {
  return `${step * 80}ms`
}

export function Hero() {
  return (
    <section className="relative isolate pt-10 pb-8 sm:pt-16 sm:pb-10">
      {/* A slow yellow glow drifting behind the headline: IMDb's colour as light, not as a block. */}
      <div
        aria-hidden="true"
        className="bg-primary/15 pointer-events-none absolute -top-32 -right-24 -z-10 size-96 rounded-full blur-3xl motion-safe:animate-drift sm:size-160"
      />
      <p
        className="text-ink text-ui animation-delay-var mb-3 font-bold tracking-wider uppercase motion-safe:animate-rise"
        style={{ '--delay': beat(0) }}
      >
        IMDb lists for Radarr and Sonarr
      </p>
      <h1
        className="animation-delay-var max-w-4xl text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl motion-safe:animate-rise"
        style={{ '--delay': beat(1) }}
      >
        Your IMDb list, straight into <span className="underline-sweep">Radarr and Sonarr</span>.
      </h1>
      <p
        className="text-muted-foreground animation-delay-var mt-4 max-w-2xl text-base text-pretty sm:text-lg motion-safe:animate-rise"
        style={{ '--delay': beat(2) }}
      >
        Paste a public IMDb watchlist or list. You get two links back: one Radarr uses for the
        movies, one Sonarr uses for the shows. Both read the same list, and it is free.
      </p>
    </section>
  )
}

// A shared list holds up to 25 IMDb lists (src/shared-lists.js): the field plus 24 more.
const MAX_EXTRA_LISTS = 24

/** One more IMDb link under the main field, for combining; its X takes the row away. */
function ExtraListField({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number
  value: string
  onChange: (value: string) => void
  onRemove: () => void
}) {
  const trimmed = value.trim()
  return (
    <div className="relative mt-3 sm:h-12">
      <Input
        type="url"
        inputMode="url"
        spellCheck={false}
        placeholder="Another IMDb list or watchlist link"
        aria-label={`IMDb list ${index + 2}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={trimmed.length > 0 && !isSupportedImdbUrl(trimmed)}
        variant="search"
        className="sm:rounded-r-md"
        // A row that was just added is where the visitor is about to paste.
        autoFocus={!value}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove IMDb list ${index + 2}`}
        className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-field-foreground/45 hover:bg-field-foreground/5 hover:text-field-foreground transition-colors"
      >
        <XIcon className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Asked for more lists while signed out: combining them into one pair of
 * links is a shared list, which lives on an account.
 */
function SignInToAddMore({
  authAvailable,
  listUrl,
  onSignIn,
  onDismiss,
}: {
  authAvailable: boolean
  listUrl: string
  onSignIn: SignInClick
  onDismiss: () => void
}) {
  return (
    <div className="bg-secondary ring-foreground/10 mt-3 flex flex-col gap-3 rounded-md p-4 ring-1 motion-safe:animate-rise md:flex-row md:items-center md:justify-between">
      <p className="text-sm text-pretty">
        <span className="font-bold">To add more lists, sign in.</span>{' '}
        <span className="text-muted-foreground">
          {authAvailable
            ? 'Then you can combine as many IMDb lists as you like into one Radarr link and one Sonarr link.'
            : 'This copy of Watcharr has no sign-in set up, so it makes links for one list at a time.'}
        </span>
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {authAvailable && <SignInWithConnections href={signInHref(listUrl || undefined)} onClick={onSignIn} />}
        {authAvailable && (
          <Button asChild variant="ghost">
            <a href={DEMO_URL}>See how it looks</a>
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </div>
  )
}

/**
 * IMDb's search bar, doing this site's one job: a white field joined to a
 * yellow button (stacked on a phone, where a joined pair is too cramped). When
 * either has focus the yellow ring goes around the pair, the way one control
 * would; the X in the field clears it, and whatever it had built.
 *
 * "Add another list" under it is how a visitor learns lists can be combined.
 * Signed in, it adds a field, and with more than one link Generate becomes
 * Combine, which makes a shared list: one Radarr link and one Sonarr link for
 * all of them. Signed out, it says that takes signing in, with the button.
 */
export function FeedForm({
  sourceUrl,
  onSourceUrlChange,
  onClear,
  looksValid,
  pending,
  session,
  onSubmit,
  onCombine,
  onSignIn,
  onTry,
}: {
  sourceUrl: string
  onSourceUrlChange: (value: string) => void
  onClear: () => void
  looksValid: boolean
  pending: boolean
  session: Session | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  /** Every link in the form, the main field's first, to make one shared list of; true once made. */
  onCombine: (listUrls: string[]) => Promise<boolean>
  onSignIn: SignInClick
  /** Builds a list in one click: the example link fills the field and generates. */
  onTry: (listUrl: string) => void
}) {
  const example = useExampleList()
  const signedIn = Boolean(session?.signedIn)
  // The extra links; null until "Add another list" is pressed. Pressed while
  // signed out, the rows wait for the sign-in and appear once it lands.
  const [extra, setExtra] = useState<string[] | null>(null)
  const extraUrls = signedIn ? (extra ?? []) : []
  const filled = extraUrls.map((url) => url.trim()).filter(Boolean)
  const combining = filled.length > 0
  const extrasValid = filled.every(isSupportedImdbUrl)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!combining) {
      onSubmit(event)
      return
    }
    event.preventDefault()
    if (pending || !looksValid || !extrasValid) return
    // Made, the lists live in the shared list below, so the form starts over.
    void onCombine([sourceUrl.trim(), ...filled]).then((made) => {
      if (made) setExtra(null)
    })
  }

  const submitLabel = pending ? (
    <>
      <LoaderCircleIcon className="size-4 animate-spin" />
      Building
    </>
  ) : (
    <>
      {combining ? `Combine ${filled.length + 1}` : 'Generate'}
      <ArrowRightIcon className="size-4 transition-transform group-hover/button:translate-x-0.5" />
    </>
  )

  const setRow = (index: number, value: string) =>
    setExtra((current) => (current ?? []).map((url, at) => (at === index ? value : url)))
  const removeRow = (index: number) => setExtra((current) => (current ?? []).filter((_, at) => at !== index))

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card ring-foreground/10 animation-delay-var rounded-lg p-5 ring-1 sm:p-8 motion-safe:animate-rise"
      style={{ '--delay': beat(3) }}
    >
      <Label htmlFor="source-url" className="mb-2 block">
        {extraUrls.length > 0 ? 'IMDb watchlists or lists to combine' : 'IMDb watchlist or list URL'}
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
            variant="search"
            required
          />
          {sourceUrl && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear the link"
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-field-foreground/45 hover:bg-field-foreground/5 hover:text-field-foreground transition-colors motion-safe:animate-pop"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <Button
          type="submit"
          // Live on an empty field (it is `required`, so the browser says what is missing): a
          // disabled primary button read as greyed out and red at once to a simulated visitor.
          disabled={pending}
          variant="cta"
          size="search"
          // On a phone, where the button stacks under the field, it moves below the extra links.
          className={extraUrls.length > 0 ? 'hidden sm:inline-flex' : undefined}
        >
          {submitLabel}
        </Button>
      </div>
      {extraUrls.map((url, index) => (
        <ExtraListField
          // The rows only ever grow at the end or lose one; the index is the row.
          key={index}
          index={index}
          value={url}
          onChange={(value) => setRow(index, value)}
          onRemove={() => removeRow(index)}
        />
      ))}
      {extraUrls.length > 0 && (
        <Button type="submit" disabled={pending} variant="cta" size="search" className="mt-3 w-full sm:hidden">
          {submitLabel}
        </Button>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p
          id="source-url-hint"
          className={looksValid && extrasValid ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'}
        >
          {!looksValid || !extrasValid ? (
            'That does not look like an IMDb list or watchlist link.'
          ) : (
            <>
              Try{' '}
              <button
                type="button"
                title={example.url}
                className="hover:text-ink underline underline-offset-2 transition-colors"
                onClick={() => onTry(example.url)}
              >
                {example.name}
              </button>
            </>
          )}
        </p>
        {extraUrls.length < MAX_EXTRA_LISTS && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setExtra((current) => [...(signedIn ? (current ?? []) : []), ''])}
          >
            <PlusIcon className="size-3.5" />
            Add another list
          </Button>
        )}
      </div>
      {!signedIn && extra !== null && (
        <SignInToAddMore
          authAvailable={Boolean(session?.authAvailable)}
          listUrl={sourceUrl.trim()}
          onSignIn={onSignIn}
          onDismiss={() => setExtra(null)}
        />
      )}
      {signedIn && (
        <p className="text-muted-foreground mt-1 text-sm">
          {combining
            ? 'Combined, these lists make one shared list: one Radarr link and one Sonarr link for all of them, kept up to date.'
            : 'You are signed in, so every list you paste here is kept up to date for you.'}
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
        Sign in and we check your list about every fifteen minutes. You can also make a shared list: one Radarr
        and one Sonarr link that everyone in the house adds their IMDb lists to.
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SignInWithConnections href={signInHref()} onClick={onSignIn} />
        <Button asChild variant="ghost">
          <a href={DEMO_URL}>See how it looks</a>
        </Button>
      </div>
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
      <div className="bg-card ring-foreground/10 relative grid items-center gap-8 overflow-hidden rounded-lg p-5 ring-1 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] md:gap-12">
        {/* A wash of Askarr's teal behind its picture, so the card reads as Askarr's own. */}
        <div
          aria-hidden="true"
          className="bg-askarr/30 pointer-events-none absolute -right-24 -bottom-32 size-104 rounded-full blur-3xl motion-safe:animate-drift"
        />
        <div className="relative">
          <h3>
            <AskarrLogo className="h-8 w-auto" />
          </h3>
          <p className="text-muted-foreground mt-4 max-w-md text-pretty">
            Want one title without editing the list? Ask for it from your phone, and it lands in your own
            Radarr or Sonarr at home.
          </p>
          <Button asChild variant="askarr" size="lift" className="group/askarr mt-6">
            <a href={ASKARR_URL}>
              <AskarrMark inverted className="size-5" />
              Try Askarr
              <ArrowRightIcon className="size-4 transition-transform group-hover/askarr:translate-x-0.5" aria-hidden="true" />
            </a>
          </Button>
        </div>
        <AskarrPreview />
      </div>
    </section>
  )
}

/**
 * A small picture of Askarr at work: a title asked for on the phone, the
 * request hopping home, and the PC adding it to Radarr. Drawn rather than
 * screenshotted, so it stays sharp and never shows an old version of the app.
 * Always dark, like the app, whichever theme this page is in.
 */
function AskarrPreview() {
  return (
    <div
      aria-hidden="true"
      className="dark bg-background text-foreground ring-foreground/10 relative rounded-xl p-4 shadow-2xl ring-1 sm:p-5"
    >
      <div className="bg-secondary ring-foreground/10 flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm ring-1">
        <SearchIcon className="text-muted-foreground size-4" />
        Dune: Part Two
        <span className="bg-askarr-ink -ml-1.5 h-4 w-px motion-safe:animate-pulse" />
      </div>
      <div className="bg-secondary/60 ring-foreground/10 mt-3 flex items-center gap-3 rounded-lg p-2.5 ring-1">
        <span className="bg-askarr/40 grid h-12 w-8 shrink-0 place-items-center rounded">
          <FilmIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">Dune: Part Two</span>
          <span className="text-muted-foreground block text-xs">2024 · Movie</span>
        </span>
        <span className="bg-askarr text-askarr-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold">
          <CheckIcon className="size-3.5" />
          Requested
        </span>
      </div>
      <div className="bg-foreground/15 relative mx-auto h-8 w-px">
        <span className="bg-askarr-ink absolute top-0 left-1/2 size-2 rounded-full opacity-0 motion-safe:animate-hop" />
      </div>
      <div className="bg-secondary/60 ring-foreground/10 rounded-lg p-3 ring-1">
        <p className="flex items-center gap-2 text-xs font-bold">
          <MonitorIcon className="text-muted-foreground size-4" />
          Your PC · Askarr Monitor
        </p>
        <p className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
          <span className="bg-primary size-1.5 rounded-full" />
          Radarr: Dune: Part Two added
        </p>
      </div>
    </div>
  )
}
