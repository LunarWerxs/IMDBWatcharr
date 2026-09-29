// WHY: markFeedFailure() recorded a sync failure but nothing ever told the
// owner, so a stale feed was discovered by accident (Radarr/Sonarr going
// quiet) rather than reported. Adapted from PostHog's threshold-alert
// pattern (products/alerts/, MIT): fire once a metric - here, consecutive
// sync failures - crosses a threshold, surfaced as a small header badge
// backed by GET /api/notifications.
import { useEffect, useState } from 'react'
import { BellIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readNotifications } from '@/lib/api'
import { FEEDS_CHANGED, NEEDS_ATTENTION } from '@/lib/feed-page'

// A signed-out visitor can never own a feed, so the header only renders this
// once a session is known signed in.
export function NotificationsBadge() {
  const [count, setCount] = useState(0)

  // Read once, and again whenever the library changes a feed: taking a failing list out clears it.
  useEffect(() => {
    let cancelled = false
    const read = () =>
      readNotifications().then((value) => {
        if (!cancelled) setCount(value.count)
      })
    void read()
    window.addEventListener(FEEDS_CHANGED, read)
    return () => {
      cancelled = true
      window.removeEventListener(FEEDS_CHANGED, read)
    }
  }, [])

  if (count === 0) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" className="relative">
          <a href={`#${NEEDS_ATTENTION}`} aria-label={`${count} ${count === 1 ? 'feed needs' : 'feeds need'} attention`}>
            <BellIcon className="size-4" />
            <Badge
              variant="destructive"
              size="sm"
              className="absolute -top-1 -right-1 h-4 min-w-4"
            >
              <span className="text-3xs">{count}</span>
            </Badge>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="dark">
        {count} feed{count === 1 ? '' : 's'} failing to sync
      </TooltipContent>
    </Tooltip>
  )
}
