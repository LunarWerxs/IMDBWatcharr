import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { BookmarkPlusIcon } from 'lucide-react'

import type { CreateFeedResponse } from '@/lib/api'
import { bookmarkletHref } from '@/lib/bookmarklet'

/**
 * The one-click way in, beside copying the two links: a bookmark that, clicked inside the visitor's own
 * Radarr or Sonarr, adds this list there (lib/arr-setup.js). It is drawn as a sticker to peel off the
 * page and drag to the bookmarks bar (the .sticker styles). A bookmarks bar is a computer thing, so it
 * shows from tablet width up, by width alone: a touch-capable laptop still gets it.
 */
export function OneClickSetup({ result }: { result: CreateFeedResponse }) {
  const link = useRef<HTMLAnchorElement>(null)
  const [hint, setHint] = useState(false)
  const [peeled, setPeeled] = useState(false)
  const frame = useRef(0)
  const href = useMemo(
    () =>
      bookmarkletHref({ radarrUrl: result.radarrFeedUrl, sonarrUrl: result.sonarrFeedUrl, listTitle: result.listTitle }),
    [result.radarrFeedUrl, result.sonarrFeedUrl, result.listTitle],
  )
  // React blocks javascript: links as a precaution, and a bookmark is one, so it goes on the element directly.
  useEffect(() => {
    link.current?.setAttribute('href', href)
  }, [href])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const onDragStart = (event: DragEvent<HTMLAnchorElement>) => {
    event.dataTransfer.setDragImage(event.currentTarget, event.nativeEvent.offsetX, event.nativeEvent.offsetY)
    // The browser photographs the drag image from this frame, so the footprint shows from the next.
    frame.current = requestAnimationFrame(() => setPeeled(true))
  }
  const onDragEnd = () => {
    cancelAnimationFrame(frame.current)
    setPeeled(false)
  }

  return (
    <div
      className="bg-secondary ring-foreground/10 mt-3 hidden items-center justify-center gap-5 rounded-lg px-5 py-3.5 ring-1 md:flex"
      style={{ '--sticker-page': 'var(--secondary)' }}
    >
      <span className="sticker-slot shrink-0" data-peeled={peeled || undefined}>
        {/* Here it only explains itself: it works once it is on the bookmarks bar. */}
        <a
          ref={link}
          className="sticker"
          draggable
          aria-describedby="one-click-how"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={(event) => {
            event.preventDefault()
            setHint(true)
          }}
        >
          <BookmarkPlusIcon className="size-3.5" aria-hidden="true" />
          Add to Radarr / Sonarr
        </a>
        <span className="sticker-footprint" aria-hidden="true">
          ↑ Bookmarks bar
        </span>
      </span>
      <p id="one-click-how" role={hint ? 'status' : undefined} className="text-muted-foreground max-w-xs text-sm text-pretty">
        {hint ? (
          <span className="text-foreground font-bold">Drag it to your bookmarks bar first, then click it in Radarr or Sonarr.</span>
        ) : (
          'Drag it to your bookmarks bar, then click it in Radarr or Sonarr: it adds this list there for you.'
        )}
      </p>
    </div>
  )
}
