import { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { CreateFeedResponse } from '@/lib/api'
import { bookmarkletHref } from '@/lib/bookmarklet'

/**
 * The one-click way in, beside copying the two links: a bookmark that, clicked inside the visitor's own
 * Radarr or Sonarr, adds this list there (lib/arr-setup.js). A bookmarks bar is a computer thing, so it
 * shows from tablet width up, by width alone: a touch-capable laptop still gets it.
 */
export function OneClickSetup({ result }: { result: CreateFeedResponse }) {
  const link = useRef<HTMLAnchorElement>(null)
  const [hint, setHint] = useState(false)
  const href = useMemo(
    () =>
      bookmarkletHref({ radarrUrl: result.radarrFeedUrl, sonarrUrl: result.sonarrFeedUrl, listTitle: result.listTitle }),
    [result.radarrFeedUrl, result.sonarrFeedUrl, result.listTitle],
  )
  // React blocks javascript: links as a precaution, and a bookmark is one, so it goes on the element directly.
  useEffect(() => {
    link.current?.setAttribute('href', href)
  }, [href])

  return (
    <div className="bg-secondary ring-foreground/10 mt-3 hidden items-center gap-5 rounded-lg p-4 ring-1 motion-safe:animate-rise md:flex">
      <Button asChild variant="cta" size="cta" className="shrink-0 cursor-grab active:cursor-grabbing">
        {/* Here it only explains itself: it works once it is on the bookmarks bar. */}
        <a
          ref={link}
          aria-describedby="one-click-how"
          onClick={(event) => {
            event.preventDefault()
            setHint(true)
          }}
        >
          <BookmarkPlusIcon className="size-4" aria-hidden="true" />
          Add to Radarr / Sonarr
        </a>
      </Button>
      <p id="one-click-how" role={hint ? 'status' : undefined} className="text-muted-foreground text-sm text-pretty">
        {hint ? (
          <span className="text-foreground font-bold">
            Drag it to your bookmarks bar first, then click it inside Radarr or Sonarr.
          </span>
        ) : (
          'Or skip the copying: drag this to your bookmarks bar, then click it inside Radarr or Sonarr to add this list there.'
        )}
      </p>
    </div>
  )
}
