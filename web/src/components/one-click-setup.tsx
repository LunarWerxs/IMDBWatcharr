import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { BookmarkPlusIcon } from 'lucide-react'

import type { CreateFeedResponse } from '@/lib/api'
import { bookmarkletHref } from '@/lib/bookmarklet'
import { cn } from '@/lib/utils'

/**
 * The one-click way in, beside copying the two links: a bookmark that, clicked inside the visitor's own
 * Radarr or Sonarr, adds this feed there (lib/arr-setup.js). It is drawn as a sticker to peel off the
 * page and drag to the bookmarks bar (the .sticker styles). Clicked on this page it does nothing but ask
 * for the drag (onHint): it only works from the bookmarks bar.
 */
export function BookmarkSticker({
  radarrUrl,
  sonarrUrl,
  listTitle,
  size = 'default',
  describedBy,
  onHint,
  onDragged,
}: {
  radarrUrl: string
  sonarrUrl: string
  /** What the lists are called in Radarr and Sonarr ("Watcharr: <this>"). */
  listTitle: string
  size?: 'default' | 'lg'
  describedBy?: string
  onHint?: () => void
  /** Once it has been dragged somewhere: the visitor knows how it works. */
  onDragged?: () => void
}) {
  const link = useRef<HTMLAnchorElement>(null)
  const [peeled, setPeeled] = useState(false)
  const frame = useRef(0)
  const href = useMemo(() => bookmarkletHref({ radarrUrl, sonarrUrl, listTitle }), [radarrUrl, sonarrUrl, listTitle])
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
    onDragged?.()
  }

  return (
    <span className="sticker-slot shrink-0" data-peeled={peeled || undefined}>
      <a
        ref={link}
        className={cn('sticker', size === 'lg' && 'sticker-lg')}
        draggable
        aria-describedby={describedBy}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(event) => {
          event.preventDefault()
          onHint?.()
        }}
      >
        <BookmarkPlusIcon className={size === 'lg' ? 'size-4' : 'size-3.5'} aria-hidden="true" />
        Add to Radarr / Sonarr
      </a>
      <span className="sticker-footprint" aria-hidden="true">
        ↑ Bookmarks bar
      </span>
    </span>
  )
}

/**
 * The bookmark under a signed-out result, with what to do with it. A bookmarks bar is a computer thing,
 * so it shows from tablet width up, by width alone: a touch-capable laptop still gets it.
 */
export function OneClickSetup({ result }: { result: CreateFeedResponse }) {
  const [hint, setHint] = useState(false)

  return (
    <div
      className="bg-secondary ring-foreground/10 mt-3 hidden items-center justify-center gap-5 rounded-lg px-5 py-3.5 ring-1 md:flex"
      style={{ '--sticker-page': 'var(--secondary)' }}
    >
      <BookmarkSticker
        radarrUrl={result.radarrFeedUrl}
        sonarrUrl={result.sonarrFeedUrl}
        listTitle={result.listTitle}
        describedBy="one-click-how"
        onHint={() => setHint(true)}
      />
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
