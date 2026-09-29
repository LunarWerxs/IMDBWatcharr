import { AlertTriangleIcon, CheckCircle2Icon, LoaderCircleIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { MyFeed } from '@/lib/api'

/** How a list's reads from IMDb are going, for My feeds and for a shared list's lists. */
export function FeedHealthBadge({ feed }: { feed: Pick<MyFeed, 'alerting' | 'consecutiveFailures' | 'status'> }) {
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
