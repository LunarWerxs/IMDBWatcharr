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

// A signed-out visitor can never own a feed, so this only bothers to poll
// once a session is known signed in.
export function NotificationsBadge({ signedIn }: { signedIn: boolean }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!signedIn) {
      setCount(0)
      return
    }

    let cancelled = false
    readNotifications().then((value) => {
      if (!cancelled) setCount(value.count)
    })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  if (!signedIn || count === 0) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" className="relative">
          <a href="#my-feeds" aria-label={`${count} feed${count === 1 ? '' : 's'} need attention`}>
            <BellIcon className="size-4" />
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px]"
            >
              {count}
            </Badge>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {count} feed{count === 1 ? '' : 's'} failing to sync
      </TooltipContent>
    </Tooltip>
  )
}
