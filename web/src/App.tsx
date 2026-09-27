import { useState, type FormEvent } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ClapperboardIcon,
  FilmIcon,
  LoaderCircleIcon,
  RssIcon,
  SparklesIcon,
  TriangleAlertIcon,
  TvIcon,
  UserIcon,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CopyField } from '@/components/copy-field'
import { GithubLink } from '@/components/github-link'
import { MyFeeds } from '@/components/my-feeds'
import { NotificationsBadge } from '@/components/notifications-badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { createFeed, isSupportedImdbUrl, type CreateFeedResponse, type Session } from '@/lib/api'
import {
  mergeStatus,
  rememberLastList,
  rememberSignInList,
  signInHref,
  useFeedStatusPoll,
  useStartingList,
} from '@/lib/feed-page'

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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/40 rounded-lg border px-3 py-2">
      <div className="text-foreground text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}

/**
 * Signing in is what turns a one-off fetch into a feed that keeps itself
 * current, so the control says that rather than just "Sign in".
 */
function AccountControl({ session, listUrl }: { session: Session | null; listUrl: string }) {
  if (!session?.authAvailable) {
    return null
  }

  if (session.signedIn) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground hidden text-xs sm:inline">
          {session.name ?? 'Signed in'}
        </span>
        <Button asChild variant="ghost" size="sm">
          <a href="/auth/logout">Sign out</a>
        </Button>
      </div>
    )
  }

  return (
    <Button asChild variant="outline" size="sm">
      <a href={signInHref(listUrl || undefined)} onClick={() => rememberSignInList(listUrl || undefined)}>
        <UserIcon className="size-4" />
        Sign in
      </a>
    </Button>
  )
}

// Up to the studio. It sits above the product mark rather than beside it so
// the hierarchy reads in the order it actually is: studio, then product. Same
// shape the other LunarWerx products use.
function AppHeader({ session, listUrl }: { session: Session | null; listUrl: string }) {
  return (
    <header className="mx-auto w-full max-w-3xl px-4 pt-3 pb-5">
      <a
        href="https://lunarwerx.com"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-2xs font-medium transition-colors"
      >
        <ArrowLeftIcon className="size-3.5 shrink-0" />
        LunarWerx Studios
      </a>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <ClapperboardIcon className="size-4" />
          </div>
          <div className="font-display truncate text-sm font-semibold">IMDb Watcharr</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <NotificationsBadge signedIn={Boolean(session?.signedIn)} />
          <GithubLink />
          <ThemeToggle />
          <AccountControl session={session} listUrl={listUrl} />
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="pt-6 pb-8 sm:pt-10">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Your IMDb list, straight into Radarr and Sonarr.
      </h1>
      <p className="text-muted-foreground mt-3 max-w-xl text-base text-pretty">
        Free. Paste a public IMDb watchlist or list. You get two links back: one Radarr uses for
        the movies, one Sonarr uses for the shows. Both read the same list.
      </p>
    </section>
  )
}

function CreateFeedForm({
  sourceUrl,
  onSourceUrlChange,
  looksValid,
  pending,
  canSubmit,
  signedIn,
  onSubmit,
}: {
  sourceUrl: string
  onSourceUrlChange: (value: string) => void
  looksValid: boolean
  pending: boolean
  canSubmit: boolean
  signedIn: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your feeds</CardTitle>
        <CardDescription>
          Your links never change, so you set them up once and leave them.{' '}
          {signedIn
            ? 'You are signed in, so every list you paste here is kept up to date for you.'
            : 'Sign in and we keep the list up to date for you.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-2">
          <Label htmlFor="source-url">IMDb watchlist or list URL</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
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
              className="sm:flex-1"
              required
            />
            <Button type="submit" size="lg" disabled={!canSubmit}>
              {pending ? (
                <>
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  Building
                </>
              ) : (
                <>
                  Generate feeds
                  <ArrowRightIcon className="size-4" />
                </>
              )}
            </Button>
          </div>
          <p
            id="source-url-hint"
            className={
              looksValid ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'
            }
          >
            {looksValid ? (
              <>
                Try{' '}
                <button
                  type="button"
                  className="hover:text-foreground underline underline-offset-2"
                  onClick={() => onSourceUrlChange(EXAMPLE_URL)}
                >
                  {EXAMPLE_URL}
                </button>
              </>
            ) : (
              'That does not look like an IMDb list or watchlist link.'
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function SyncSkeleton() {
  return (
    <div className="mt-4 grid gap-4">
      <Skeleton shape="card" className="h-33 w-full" />
      <Skeleton shape="card" className="h-49 w-full" />
    </div>
  )
}

function BuildError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="mt-4">
      <TriangleAlertIcon />
      <AlertTitle>Could not build the feeds</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

/**
 * What a submission leaves behind: skeletons while it is in flight, the reason
 * if it failed, or the feed it built. At most one of them is ever on screen,
 * which is why they are decided together rather than three times over.
 */
function FeedOutcome({
  pending,
  error,
  result,
  session,
  listUrl,
}: {
  pending: boolean
  error: string | null
  result: CreateFeedResponse | null
  session: Session | null
  listUrl: string
}) {
  if (pending) {
    return <SyncSkeleton />
  }

  if (error) {
    return <BuildError message={error} />
  }

  return result ? <FeedResult result={result} session={session} listUrl={listUrl} /> : null
}

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

function FeedStatusBadge({ result }: { result: CreateFeedResponse }) {
  const state = feedState(result)

  return (
    <Badge variant={state === 'ready' ? 'secondary' : 'outline'}>
      <span className="font-normal">{FEED_STATE_LABELS[state]}</span>
    </Badge>
  )
}

function StatTiles({ result }: { result: CreateFeedResponse }) {
  return (
    <CardContent>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Titles on the list" value={result.totalCount} />
        <StatTile label="Movies for Radarr" value={result.radarrCount} />
        <StatTile label="Shows for Sonarr" value={result.sonarrCount} />
        <StatTile label="Shows we skipped" value={result.sonarrUnresolvedCount} />
      </div>
      {result.sonarrUnresolvedCount > 0 && (
        <p className="text-muted-foreground mt-3 text-xs">
          Sonarr needs a TVDB id for every show, and we could not find one for{' '}
          {result.sonarrUnresolvedCount} of them, so we left those out.
        </p>
      )}
    </CardContent>
  )
}

/**
 * A signed-out visitor's feed does not refresh itself, so it says so, and the
 * sign-in it offers comes back to this same list so the list gets claimed.
 */
function UnsyncedNudge({
  session,
  result,
  listUrl,
}: {
  session: Session | null
  result: CreateFeedResponse
  listUrl: string
}) {
  if (!session?.authAvailable || session.signedIn || result.autoRefreshing) {
    return null
  }

  const read = result.lastSyncedAt !== null

  return (
    <Alert className="mt-3">
      <UserIcon className="size-4" />
      <AlertTitle>This one will not update by itself</AlertTitle>
      <AlertDescription>
        <span>
          {read
            ? 'Your links work now and keep working. We only read the list again when you come back and paste it. '
            : 'Once we have read the list, your links keep working. After that we only read it again when you come back and paste it. '}
          Sign in, free, and we check it for you about every fifteen minutes.
        </span>
        <span className="mt-1 block">
          Connections is the free account every LunarWerx app signs in with. It opens on its own
          page: type your email, enter the code it sends you, and you land back here with this list
          saved.
        </span>
        <Button asChild size="sm" className="mt-2">
          <a href={signInHref(listUrl)} onClick={() => rememberSignInList(listUrl)}>
            Sign in with Connections
          </a>
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function FeedSummaryCard({
  result,
  session,
  listUrl,
}: {
  result: CreateFeedResponse
  session: Session | null
  listUrl: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex items-center gap-2">
            {result.listTitle || 'Your list'}
            <FeedStatusBadge result={result} />
            {result.syncing && (
              <LoaderCircleIcon className="text-muted-foreground size-3.5 animate-spin" />
            )}
          </div>
        </CardTitle>
        <CardDescription>
          {feedState(result) === 'snapshot'
            ? `The last sync did not succeed, so the feeds keep serving the last good snapshot. ${result.message}`
            : result.message}
        </CardDescription>
        <UnsyncedNudge session={session} result={result} listUrl={listUrl} />
      </CardHeader>
      <StatTiles result={result} />
    </Card>
  )
}

function TargetCards({ result }: { result: CreateFeedResponse }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <FilmIcon className="text-muted-foreground size-4" />
              Radarr
              <Badge variant="outline" className="ml-auto">
                <RssIcon className="size-3" />
                <span className="font-normal">RSS List</span>
              </Badge>
            </div>
          </CardTitle>
          <CardDescription>Settings, Lists, Add list, Advanced, RSS List.</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyField value={result.radarrFeedUrl} label="Radarr RSS URL" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <TvIcon className="text-muted-foreground size-4" />
              Sonarr
              <Badge variant="outline" className="ml-auto">
                <span className="font-normal">Custom List</span>
              </Badge>
            </div>
          </CardTitle>
          <CardDescription>Settings, Import Lists, Add list, Advanced, Custom List.</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyField value={result.sonarrFeedUrl} label="Sonarr custom list URL" />
        </CardContent>
      </Card>
    </div>
  )
}

function FeedResult({
  result,
  session,
  listUrl,
}: {
  result: CreateFeedResponse
  session: Session | null
  listUrl: string
}) {
  return (
    <div className="mt-4 grid gap-4">
      <FeedSummaryCard result={result} session={session} listUrl={listUrl} />
      <TargetCards result={result} />
    </div>
  )
}

const ASKARR_URL = 'https://askarr.com/?utm_source=watcharr&utm_medium=referral'

/**
 * Askarr is LunarWerx's other Radarr and Sonarr product, and the visitor who
 * has just wired up both apps is exactly who it is for: the list feed covers
 * what they planned on IMDb, Askarr covers the one title they think of on the
 * go.
 */
function AskarrCard() {
  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>
          <div className="flex items-center gap-2">
            <SparklesIcon className="text-muted-foreground size-4" />
            Want one title without editing the list?
          </div>
        </CardTitle>
        <CardDescription>
          Askarr, also by LunarWerx: search any movie or show from your phone or any browser, tap
          request, and the Askarr Monitor on your Windows PC adds it to your own Radarr and Sonarr.
          Nothing on your network has to face the internet. Free to start.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" size="sm">
          <a href={ASKARR_URL}>
            Try Askarr
            <ArrowRightIcon className="size-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}

// Reference for a first-time visitor, noise for a returning one, so it starts
// closed. A native <details> keeps it keyboard- and search-friendly without
// another dependency.
function HowItWorks() {
  return (
    <details className="group mt-12">
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium tracking-wider uppercase transition-colors [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
        How it works
      </summary>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            {/* A header-only card: the body sits in the header's gap-1 grid with mt-1,
                which keeps the tight 8px title-to-body step the card's own gap would widen. */}
            <Card className="h-full">
              <CardHeader>
                <div className="bg-muted text-muted-foreground mb-1.5 flex size-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums">
                  {index + 1}
                </div>
                <CardTitle>
                  <div className="text-sm">{step.title}</div>
                </CardTitle>
                <p className="text-muted-foreground mt-1 text-sm text-pretty">{step.body}</p>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ol>
    </details>
  )
}

function AppFooter() {
  return (
    <footer className="text-muted-foreground mx-auto w-full max-w-3xl px-4 pb-10 text-xs">
      <Separator className="mb-6" />
      <p>
        <span className="font-display text-foreground">IMDb Watcharr</span>
        <span aria-hidden="true"> · </span>
        by{' '}
        <a href="https://lunarwerx.com" className="hover:text-foreground transition-colors">
          LunarWerx
        </a>
      </p>
      <p className="mt-2">
        Also for Radarr and Sonarr:{' '}
        <a
          href={ASKARR_URL}
          className="text-foreground underline underline-offset-2 transition-colors hover:text-primary"
        >
          Askarr
        </a>
        , request any movie or show from anywhere and it lands at home.
      </p>
    </footer>
  )
}

export default function App() {
  const [sourceUrl, setSourceUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateFeedResponse | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  // The URL a poll should keep re-checking. Kept separate from `sourceUrl` so
  // editing the input mid-sync cannot redirect a poll already in flight.
  const [activeUrl, setActiveUrl] = useState('')

  async function buildFeeds(listUrl: string) {
    setPending(true)
    setError(null)
    setResult(null)
    setActiveUrl(listUrl)

    try {
      setResult(await createFeed(listUrl))
      rememberLastList(listUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }

  useStartingList({
    onSession: setSession,
    onList: (list, build) => {
      setSourceUrl(list)
      if (build) void buildFeeds(list)
    },
  })

  useFeedStatusPoll(result, setResult)

  // Unfollowing the list on screen from My feeds re-reads where it stands, so
  // the card stops saying it is being kept up to date.
  function handleUnfollowed(slug: string) {
    if (result?.slug !== slug) return
    mergeStatus(setResult, slug).catch(() => {
      // The card is only out of date; My feeds already shows the change.
    })
  }

  const trimmed = sourceUrl.trim()
  const looksValid = trimmed.length === 0 || isSupportedImdbUrl(trimmed)
  // The button stays live on an empty field (the field is `required`, so the
  // browser says what is missing): a disabled primary button read as "greyed
  // out and red at once" to a simulated visitor, who could not tell if it worked.
  const canSubmit = !pending

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    void buildFeeds(trimmed)
  }

  return (
    <TooltipProvider>
      <div className="bg-background text-foreground min-h-dvh">
        <AppHeader session={session} listUrl={activeUrl} />

        <main className="mx-auto w-full max-w-3xl px-4 pb-20">
          <Hero />

          <CreateFeedForm
            sourceUrl={sourceUrl}
            onSourceUrlChange={setSourceUrl}
            looksValid={looksValid}
            pending={pending}
            canSubmit={canSubmit}
            signedIn={Boolean(session?.signedIn)}
            onSubmit={handleSubmit}
          />

          {session?.signedIn && (
            <MyFeeds
              refreshKey={result ? `${result.slug}:${result.status}:${result.owned}` : ''}
              onUnfollowed={handleUnfollowed}
            />
          )}

          <FeedOutcome
            pending={pending}
            error={error}
            result={result}
            session={session}
            listUrl={activeUrl}
          />

          <HowItWorks />

          <AskarrCard />
        </main>

        <AppFooter />
      </div>
    </TooltipProvider>
  )
}
