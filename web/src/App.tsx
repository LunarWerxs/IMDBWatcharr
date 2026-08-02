import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRightIcon,
  ClapperboardIcon,
  FilmIcon,
  LoaderCircleIcon,
  RssIcon,
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
import { ThemeToggle } from '@/components/theme-toggle'
import {
  createFeed,
  isSupportedImdbUrl,
  readSession,
  type CreateFeedResponse,
  type Session,
} from '@/lib/api'

const EXAMPLE_URL = 'https://www.imdb.com/list/ls006123300/'

const STEPS = [
  {
    title: 'Paste a public IMDb link',
    body: 'A watchlist (imdb.com/user/ur…/watchlist/) or a list (imdb.com/list/ls…). Make sure it is set to public, or we cannot read it.',
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
function AccountControl({ session }: { session: Session | null }) {
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
      <a href={`/auth/login?returnTo=${encodeURIComponent('/')}`}>
        <UserIcon className="size-4" />
        Sign in
      </a>
    </Button>
  )
}

export default function App() {
  const [sourceUrl, setSourceUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateFeedResponse | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    let cancelled = false
    readSession().then((value) => {
      if (!cancelled) setSession(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const trimmed = sourceUrl.trim()
  const looksValid = trimmed.length === 0 || isSupportedImdbUrl(trimmed)
  // The routes keep serving the stored snapshot when a sync fails, so a feed
  // with items behind it is stale rather than broken.
  const servedFromSnapshot = Boolean(result && result.status !== 'ready' && result.totalCount > 0)
  // A brand-new list has nothing stored yet: the sync job has to fetch it first.
  const awaitingFirstSync = Boolean(result && result.status !== 'ready' && result.totalCount === 0)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    setPending(true)
    setError(null)
    setResult(null)

    try {
      setResult(await createFeed(trimmed))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }

  return (
    <TooltipProvider>
      <div className="bg-background text-foreground min-h-dvh">
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-5">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
              <ClapperboardIcon className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-sm font-semibold">IMDb Watcharr</div>
              <a
                href="https://lunarwerx.com"
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                a LunarWerx product
              </a>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <AccountControl session={session} />
            <GithubLink />
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-20">
          <section className="pt-6 pb-8 sm:pt-10">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Your IMDb list, straight into Radarr and Sonarr.
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl text-base text-pretty">
              Paste a public IMDb watchlist or list. You get two links back: one Radarr uses for
              the movies, one Sonarr uses for the shows. Both read the same list.
            </p>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Create your feeds</CardTitle>
              <CardDescription>
                Your links never change, so you set them up once and leave them. Sign in and we
                keep the list up to date for you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-2">
                <Label htmlFor="source-url">IMDb watchlist or list URL</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="source-url"
                    name="sourceUrl"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    placeholder={EXAMPLE_URL}
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    aria-invalid={!looksValid}
                    aria-describedby="source-url-hint"
                    className="sm:flex-1"
                    required
                  />
                  <Button type="submit" size="lg" disabled={pending || !trimmed}>
                    {pending ? (
                      <>
                        <LoaderCircleIcon className="size-4 animate-spin" />
                        Reading IMDb
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
                    looksValid ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'
                  }
                >
                  {looksValid ? (
                    <>
                      Try{' '}
                      <button
                        type="button"
                        className="hover:text-foreground underline underline-offset-2"
                        onClick={() => setSourceUrl(EXAMPLE_URL)}
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

          {pending && (
            <div className="mt-4 grid gap-4">
              <Skeleton className="h-[132px] w-full rounded-xl" />
              <Skeleton className="h-[196px] w-full rounded-xl" />
            </div>
          )}

          {error && !pending && (
            <Alert variant="destructive" className="mt-4">
              <TriangleAlertIcon />
              <AlertTitle>Could not build the feeds</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && !pending && (
            <div className="mt-4 grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {result.listTitle || 'Your list'}
                    <Badge
                      variant={result.status === 'ready' ? 'secondary' : 'outline'}
                      className="font-normal"
                    >
                      {servedFromSnapshot
                        ? 'last good snapshot'
                        : awaitingFirstSync
                          ? 'fetching'
                          : result.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {servedFromSnapshot
                      ? `The last sync did not succeed, so the feeds keep serving the last good snapshot. ${result.message}`
                      : result.message}
                  </CardDescription>
                  {session?.authAvailable && !result.autoRefreshing ? (
                    <Alert className="mt-3">
                      <UserIcon className="size-4" />
                      <AlertTitle>This one will not update by itself</AlertTitle>
                      <AlertDescription>
                        <span>
                          Your links work now and will keep working. We only read the list again
                          when you come back and ask. Sign in and we check it for you about every
                          fifteen minutes.
                        </span>
                        <Button asChild size="sm" className="mt-2">
                          <a href={`/auth/login?returnTo=${encodeURIComponent('/')}`}>
                            Sign in with Connections
                          </a>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </CardHeader>
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
              </Card>

              <div className="grid gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FilmIcon className="text-muted-foreground size-4" />
                      Radarr
                      <Badge variant="outline" className="ml-auto font-normal">
                        <RssIcon className="size-3" />
                        RSS List
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Settings, Lists, Add list, Advanced, RSS List.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CopyField value={result.radarrFeedUrl} label="Radarr RSS URL" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TvIcon className="text-muted-foreground size-4" />
                      Sonarr
                      <Badge variant="outline" className="ml-auto font-normal">
                        Custom List
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Settings, Import Lists, Add list, Advanced, Custom List.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CopyField value={result.sonarrFeedUrl} label="Sonarr custom list URL" />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <section className="mt-12">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              How it works
            </h2>
            <ol className="mt-4 grid gap-5 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="grid gap-1.5">
                  <div className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums">
                    {index + 1}
                  </div>
                  <div className="text-sm font-medium">{step.title}</div>
                  <p className="text-muted-foreground text-sm text-pretty">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </main>

        <footer className="text-muted-foreground mx-auto w-full max-w-3xl px-4 pb-10 text-xs">
          <Separator className="mb-6" />
          <p>
            Sign in and we check your lists about every fifteen minutes. Signed out, we only
            read a list when you ask us to.
          </p>
          <p className="mt-3">
            If IMDb does not answer, your links keep serving whatever we saw last, so Radarr and
            Sonarr never get an empty list. A brand-new list takes a few seconds to show up.
          </p>
          <p className="mt-3">
            <span className="font-display text-foreground">IMDb Watcharr</span>
            <span aria-hidden="true"> · </span>
            built and operated by{' '}
            <a href="https://lunarwerx.com" className="hover:text-foreground transition-colors">
              LunarWerx
            </a>
            , an independent software studio.
          </p>
        </footer>
      </div>
    </TooltipProvider>
  )
}
