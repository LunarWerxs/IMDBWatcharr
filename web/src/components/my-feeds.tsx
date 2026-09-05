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
  LoaderCircleIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { readMyFeeds, unfollowFeed, type MyFeed } from '@/lib/api'

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
      <Badge variant="destructive" className="font-normal">
        <AlertTriangleIcon className="size-3" />
        {feed.consecutiveFailures} failed syncs in a row
      </Badge>
    )
  }

  if (feed.status === 'error') {
    return (
      <Badge variant="outline" className="text-destructive font-normal">
        <AlertTriangleIcon className="size-3" />
        Last sync failed
      </Badge>
    )
  }

  if (feed.status === 'ready') {
    return (
      <Badge variant="secondary" className="font-normal">
        <CheckCircle2Icon className="size-3" />
        Healthy
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="font-normal">
      <LoaderCircleIcon className="size-3 animate-spin" />
      {feed.status}
    </Badge>
  )
}

function MyFeedRow({ feed, onUnfollow }: { feed: MyFeed; onUnfollow: (feed: MyFeed) => void }) {
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{feed.listTitle || feed.sourceUrl}</p>
        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
          <ClockIcon className="size-3" />
          Synced {formatRelativeTime(feed.lastSyncedAt)} · {feed.itemCount} title
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
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
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

/** Only renders once there is something to show: a signed-out visitor, or one with no claimed feeds yet, sees nothing. */
export function MyFeeds() {
  const [feeds, setFeeds] = useState<MyFeed[] | null>(null)

  useEffect(() => {
    let cancelled = false
    readMyFeeds().then((value) => {
      if (!cancelled) setFeeds(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Unfollowing only stops the schedule (releaseFeed in src/index.js) - it
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
      toast.success(`Stopped following "${label}".`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not unfollow this feed.')
    }
  }

  if (!feeds || feeds.length === 0) {
    return null
  }

  const alertingCount = feeds.filter((feed) => feed.alerting).length

  return (
    <Card id="my-feeds" className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCwIcon className="text-muted-foreground size-4" />
          My feeds
          {alertingCount > 0 && (
            <Badge variant="destructive" className="font-normal">
              {alertingCount} need{alertingCount === 1 ? 's' : ''} attention
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          {feeds.map((feed) => (
            <MyFeedRow key={feed.slug} feed={feed} onUnfollow={handleUnfollow} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
