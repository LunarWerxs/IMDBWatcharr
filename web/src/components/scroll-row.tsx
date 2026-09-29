import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { scrollBehavior } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * IMDb's carousel arrows: for a mouse, which cannot swipe the row. They show
 * on hover (or keyboard focus) and hide at the end they cannot go past; on a
 * touch screen the row is swiped instead, so they are not there at all.
 */
function RowArrow({
  side,
  label,
  hidden,
  top,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  hidden: boolean
  top: string
  onClick: () => void
}) {
  const Icon = side === 'left' ? ChevronLeftIcon : ChevronRightIcon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? `Scroll the ${label} back` : `Scroll the ${label} forward`}
      tabIndex={hidden ? -1 : 0}
      className={cn(
        'hover:text-primary absolute z-10 hidden h-14 w-11 -translate-y-1/2 items-center justify-center rounded-md border border-white/50 bg-black/60 text-white backdrop-blur-sm transition-opacity duration-200 sm:flex',
        top,
        side === 'left' ? '-left-2' : '-right-2',
        hidden ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Icon className="size-7" aria-hidden="true" />
    </button>
  )
}

/**
 * A row of covers that scrolls sideways: the page's one kind (the signed-out
 * result's titles, a feed's "On it"). Arrows for a mouse, and a slim gold
 * scrollbar that shows only while the row moves (scrollbar-quiet, index.css).
 */
export function ScrollRow({
  label,
  count,
  arrows = true,
  arrowTop,
  className,
  children,
}: {
  /** What it holds, for the arrows' names: "Scroll the <label> forward". */
  label: string
  /** How many items, so the arrows know again whether there is anything to scroll to. */
  count: number
  arrows?: boolean
  /** Where the arrows sit: across the middle of the covers. */
  arrowTop: string
  /** The list's own layout: gaps, padding, snapping. */
  className?: string
  children: ReactNode
}) {
  const row = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ atStart: true, atEnd: true })
  const readEdges = () => {
    const list = row.current
    if (!list) return
    setEdges({
      atStart: list.scrollLeft < 8,
      atEnd: list.scrollLeft + list.clientWidth > list.scrollWidth - 8,
    })
  }
  // Once the items are laid out, see whether there is anything to scroll to.
  useEffect(() => {
    const frame = requestAnimationFrame(readEdges)
    return () => cancelAnimationFrame(frame)
  }, [count])
  // The scrollbar shows only while the row moves: data-scrolling stays on until it has been still for a
  // moment. Set on the element itself, so scrolling never re-renders the row.
  const stillTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(stillTimer.current), [])
  const onScroll = () => {
    readEdges()
    const list = row.current
    if (!list) return
    list.dataset.scrolling = ''
    window.clearTimeout(stillTimer.current)
    stillTimer.current = window.setTimeout(() => delete list.dataset.scrolling, 900)
  }
  const page = (direction: 1 | -1) => {
    const list = row.current
    list?.scrollBy({ left: direction * list.clientWidth * 0.85, behavior: scrollBehavior() })
  }

  return (
    <div className="group/row relative">
      <ul ref={row} onScroll={onScroll} className={cn('scrollbar-quiet flex overflow-x-auto', className)}>
        {children}
      </ul>
      {arrows && (
        <>
          <RowArrow side="left" label={label} top={arrowTop} hidden={edges.atStart} onClick={() => page(-1)} />
          <RowArrow side="right" label={label} top={arrowTop} hidden={edges.atEnd} onClick={() => page(1)} />
        </>
      )}
    </div>
  )
}
