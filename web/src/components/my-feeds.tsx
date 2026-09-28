// WHY: the "My feeds" backend (/api/my-feeds) has returned per-feed sync
// health - status, itemCount, lastSyncedAt - since it shipped, but nothing in
// the SPA ever rendered it, so a claimed feed going stale was invisible until
// someone noticed Radarr/Sonarr had gone quiet. Adapted from PostHog's
// web-analytics live-view idea (products/web_analytics/, MIT): a small
// status dashboard over data the backend already sends, no new pipeline.
import { useEffect, useState } from 'react'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  LinkIcon,
  LoaderCircleIcon,
  XIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionTitle } from '@/components/site-chrome'
import { readMyFeeds, unfollowFeed, type MyFeed } from '@/lib/api'
import { notify } from '@/lib/notify'

/** "3 minutes ago", "2 hours ago", … - coarse on purpose, this is a glance, not a log. */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function FeedHealthBadge({ feed }: { feed: MyFeed }) {
  if (feed.alerting) {
    return (
      <Badge variant="destructive">
        <AlertTriangleIcon className="size-3" />
        <span className="font-normal">{feed.consecutiveFailures} failed syncs in a row</span>
      </Badge>
    )
  }

  if (feed.status === 'error') {
    return (
      <Badge variant="outline">
        <AlertTriangleIcon className="text-destructive size-3" />
        <span className="text-destructive font-normal">Last sync failed</span>
      </Badge>
    )
  }

  if (feed.status === 'ready') {
    return (
      <Badge variant="secondary">
        <CheckCircle2Icon className="size-3" />
        <span className="font-normal">Healthy</span>
      </Badge>
    )
  }

  return (
    <Badge variant="outline">
      <LoaderCircleIcon className="size-3 animate-spin" />
      <span className="font-normal">Waiting for IMDb</span>
    </Badge>
  )
}

function MyFeedRow({
  feed,
  onOpen,
  onUnfollow,
}: {
  feed: MyFeed
  onOpen: (sourceUrl: string) => void
  onUnfollow: (feed: MyFeed) => void
}) {
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{feed.listTitle || feed.sourceUrl}</p>
        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
          <ClockIcon className="size-3" />
          Read from IMDb {formatRelativeTime(feed.lastSyncedAt)} · {feed.itemCount} title
          {feed.itemCount === 1 ? '' : 's'}
        </p>
        {feed.status === 'error' && feed.lastError && (
          <p className="text-destructive mt-1 text-xs">{feed.lastError}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <FeedHealthBadge feed={feed} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onOpen(feed.sourceUrl)}
          aria-label={`Show the links for ${feed.listTitle || feed.sourceUrl}`}
        >
          <LinkIcon className="size-3.5" />
          Show links
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost-destructive-muted"
          onClick={() => onUnfollow(feed)}
          aria-label={`Stop following ${feed.listTitle || feed.sourceUrl}`}
        >
          <XIcon className="size-3.5" />
          Unfollow
        </Button>
      </div>
    </li>
  )
}

/**
 * Every list a signed-in visitor follows, kept on their account: its health,
 * and a button that brings its links (and posters) back up in the page. Only
 * renders once there is something to show: a signed-out visitor, or one with
 * no claimed feeds yet, sees nothing. `refreshKey` changes whenever the page
 * claims a list or a pending one lands, so the list re-reads instead of
 * missing the one the visitor just added.
 */
export function MyFeeds({
  refreshKey = '',
  onOpen,
  onUnfollowed,
}: {
  refreshKey?: string
  onOpen: (sourceUrl: string) => void
  onUnfollowed?: (slug: string) => void
}) {
  const [feeds, setFeeds] = useState<MyFeed[] | null>(null)

  useEffect(() => {
    let cancelled = false
    readMyFeeds().then((value) => {
      if (!cancelled) setFeeds(value)
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // Unfollowing only stops the schedule (releaseFeed in src/store.js) - it
  // never deletes the feed row or its cached snapshot, so the confirm below
  // is honest about what stays working afterward.
  async function handleUnfollow(feed: MyFeed) {
    const label = feed.listTitle || feed.sourceUrl
    if (
      !window.confirm(
        `Stop auto-refreshing "${label}"? Its Radarr/Sonarr URLs keep serving the last synced snapshot, they just stop updating.`,
      )
    ) {
      return
    }

    try {
      await unfollowFeed(feed.sourceUrl)
      setFeeds((current) => (current ?? []).filter((item) => item.slug !== feed.slug))
      onUnfollowed?.(feed.slug)
      void notify('success', `Stopped following "${label}".`)
    } catch (error) {
      void notify('error', error instanceof Error ? error.message : 'Could not unfollow this feed.')
    }
  }

  if (!feeds || feeds.length === 0) {
    return null
  }

  const alertingCount = feeds.filter((feed) => feed.alerting).length

  return (
    <section id="my-feeds" className="mt-12" aria-labelledby="your-lists">
      <SectionTitle id="your-lists">Your lists</SectionTitle>
      <p className="text-muted-foreground -mt-2 mb-4 flex flex-wrap items-center gap-2 text-sm">
        Saved to your account and checked about every fifteen minutes.
        {alertingCount > 0 && (
          <Badge variant="destructive">
            <span className="font-normal">
              {alertingCount} need{alertingCount === 1 ? 's' : ''} attention
            </span>
          </Badge>
        )}
      </p>
      <div className="bg-card ring-foreground/10 rounded-lg px-5 py-2 ring-1 sm:px-6">
        <ul>
          {feeds.map((feed) => (
            <MyFeedRow key={feed.slug} feed={feed} onOpen={onOpen} onUnfollow={handleUnfollow} />
          ))}
        </ul>
      </div>
    </section>
  )
}
