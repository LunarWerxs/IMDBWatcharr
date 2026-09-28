import { Suspense, type ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Panel, STAT_LINE, STATS, TargetCards } from '@/components/feed-card'
import { SectionTitle, type SignInClick } from '@/components/site-chrome'
import type { CreateFeedResponse, Session } from '@/lib/api'
import { lazyPart } from '@/lib/lazy'

// Nobody arrives to a built list, so the filled-in card is not part of the
// first download; until it is there, the shimmering card below stands in.
const ResultPanel = lazyPart(() => import('@/components/result-panel').then((module) => module.ResultPanel))

/** The same line before there is anything to count, shimmering while a read is on its way. */
function GhostStats({ loading }: { loading: boolean }) {
  return (
    <dl className={STAT_LINE}>
      {STATS.map((stat) => {
        const Icon = stat.icon
        return (
          <div key={stat.key} title={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-muted-foreground flex items-center gap-1.5">
              <Icon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
              {loading ? (
                <span aria-hidden="true" className="shimmer bg-secondary h-4 w-6 rounded" />
              ) : (
                <span className="font-bold">–</span>
              )}
              {stat.word}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** Before a list (or while one is on its way): the panel's shape, so the page shows where things land. */
function GhostPanel({ loading }: { loading: boolean }) {
  return (
    <Panel>
      <div className="mb-5">
        <h3 className="text-muted-foreground text-2xl font-bold">{loading ? 'Reading your list' : 'Your list'}</h3>
        <GhostStats loading={loading} />
        <p className="text-muted-foreground mt-3 text-sm">
          {loading ? 'Getting your two links ready.' : 'Paste a list above and your two links show up here.'}
        </p>
      </div>
      <TargetCards
        link={(target) => (
          <div className="border-foreground/15 text-muted-foreground flex h-11 items-center rounded-md border border-dashed px-3 text-xs">
            Your {target.app} link shows up here.
          </div>
        )}
      />
    </Panel>
  )
}

/**
 * What a submission leaves behind: the panel's empty shape at first, a
 * shimmer while the request is out, the reason if it failed, or the feed it
 * built. At most one of them is on screen, so they are decided together.
 */
export function FeedsSection({
  pending,
  error,
  result,
  session,
  listUrl,
  onSignIn,
}: {
  pending: boolean
  error: string | null
  result: CreateFeedResponse | null
  session: Session | null
  listUrl: string
  onSignIn: SignInClick
}) {
  let body: ReactNode
  if (pending) {
    body = <GhostPanel loading />
  } else if (error) {
    body = (
      <div className="motion-safe:animate-rise">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not build the feeds</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  } else if (result) {
    body = (
      <Suspense fallback={<GhostPanel loading />}>
        <ResultPanel result={result} session={session} listUrl={listUrl} onSignIn={onSignIn} />
      </Suspense>
    )
  } else {
    body = <GhostPanel loading={false} />
  }

  return (
    <section className="mt-12" aria-labelledby="your-feeds">
      <SectionTitle id="your-feeds">Your feeds</SectionTitle>
      {body}
    </section>
  )
}
