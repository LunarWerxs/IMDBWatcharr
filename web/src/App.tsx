import { useState, type FormEvent } from 'react'
import {
  ArrowRightIcon,
  ClapperboardIcon,
  FilmIcon,
  LoaderCircleIcon,
  RssIcon,
  TriangleAlertIcon,
  TvIcon,
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
import { createFeed, isSupportedImdbUrl, type CreateFeedResponse } from '@/lib/api'

const EXAMPLE_URL = 'https://www.imdb.com/list/ls006123300/'

const STEPS = [
  {
    title: 'Paste a public IMDb URL',
    body: 'A watchlist (imdb.com/user/ur…/watchlist/) or a list (imdb.com/list/ls…). It has to be public.',
  },
  {
    title: 'Get two stable URLs',
    body: 'Both are derived from the IMDb identifier, so the same list always maps to the same URLs.',
  },
  {
    title: 'Point Radarr and Sonarr at them',
    body: 'Radarr reads the RSS feed for movies. Sonarr reads the JSON custom list for series.',
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

export default function App() {
  const [sourceUrl, setSourceUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateFeedResponse | null>(null)

  const trimmed = sourceUrl.trim()
  const looksValid = trimmed.length === 0 || isSupportedImdbUrl(trimmed)
  // The Worker keeps serving the stored snapshot when IMDb blocks a refresh, so
  // a failed sync with items behind it is not a failed request.
  const servedFromSnapshot = Boolean(result && result.status !== 'ready' && result.totalCount > 0)

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
      <div className="bg-background text-foreground relative min-h-dvh">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(60rem_24rem_at_50%_-8rem,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]"
        />

        <header className="relative mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-5">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
              <ClapperboardIcon className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">IMDb Watcharr</div>
              <div className="text-muted-foreground text-xs">IMDb to Radarr and Sonarr</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <GithubLink />
            <ThemeToggle />
          </div>
        </header>

        <main className="relative mx-auto w-full max-w-3xl px-4 pb-20">
          <section className="pt-6 pb-8 sm:pt-10">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Your IMDb list, straight into Radarr and Sonarr.
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl text-base text-pretty">
              Paste a public IMDb watchlist or list. You get one RSS feed for Radarr's movies
              and one custom list for Sonarr's series, both built from the same source.
            </p>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Create your feeds</CardTitle>
              <CardDescription>
                Nothing to sign up for. The URLs are derived from the IMDb identifier.
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
                        Fetching IMDb
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
                    'That is not an IMDb list or watchlist URL yet.'
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
                      {servedFromSnapshot ? 'last good snapshot' : result.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {servedFromSnapshot
                      ? `IMDb did not answer this refresh, so the feeds keep serving the last good snapshot. ${result.message}`
                      : result.message}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <StatTile label="IMDb items" value={result.totalCount} />
                    <StatTile label="Movies for Radarr" value={result.radarrCount} />
                    <StatTile label="Series for Sonarr" value={result.sonarrCount} />
                    <StatTile label="Series unresolved" value={result.sonarrUnresolvedCount} />
                  </div>
                  {result.sonarrUnresolvedCount > 0 && (
                    <p className="text-muted-foreground mt-3 text-xs">
                      Sonarr needs a TVDB id. {result.sonarrUnresolvedCount} series had no TVMaze
                      to TVDB mapping, so they are left out of the custom list.
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

        <footer className="text-muted-foreground relative mx-auto w-full max-w-3xl px-4 pb-10 text-xs">
          <Separator className="mb-6" />
          <p>
            Feeds refresh at most every six hours and fall back to the last good snapshot when
            IMDb blocks a fetch.
          </p>
        </footer>
      </div>
    </TooltipProvider>
  )
}
