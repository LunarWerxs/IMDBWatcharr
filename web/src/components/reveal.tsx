import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'

import { prefersReducedMotion } from '@/lib/motion'

/**
 * A block that rises in the first time it scrolls into view. It is visible by
 * default (the prerendered page, a browser without IntersectionObserver, a
 * visitor who wants less motion, and anything already on screen when the page
 * opens all just see it); only a block that starts below the fold is hidden,
 * before the first paint, and handed back as it arrives. The attribute is set
 * on the element directly because React never renders it, so nothing re-renders.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return
    if (element.getBoundingClientRect().top < window.innerHeight) return

    element.dataset.reveal = 'hidden'
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        element.dataset.reveal = 'shown'
        observer.disconnect()
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const style = delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  )
}
