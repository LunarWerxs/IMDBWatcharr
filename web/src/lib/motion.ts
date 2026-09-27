// The page's motion, in one place: a count-up for the result's numbers and the
// check every animation makes first. Everything else is CSS (index.css), where
// motion-safe: turns it off for anyone who asked their system for less.
import { useEffect, useRef, useState } from 'react'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** Scroll smoothly, or jump, depending on what the visitor's system asked for. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

/**
 * A number that counts up to `target` when it first appears and glides to each
 * new value after that. The server render (and a visitor who wants no motion)
 * gets the real number straight away, so the markup never says 0 for 17.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [shown, setShown] = useState(() =>
    typeof window === 'undefined' || prefersReducedMotion() ? target : 0,
  )
  const shownRef = useRef(shown)

  useEffect(() => {
    const start = shownRef.current
    if (start === target) return

    const duration = prefersReducedMotion() ? 0 : durationMs
    let began: number | null = null
    let frame = requestAnimationFrame(function tick(now) {
      began ??= now
      const progress = duration === 0 ? 1 : Math.min(1, (now - began) / duration)
      // Ease out: quick at first, settling onto the number.
      const value = Math.round(start + (target - start) * (1 - (1 - progress) ** 3))
      shownRef.current = value
      setShown(value)
      if (progress < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])

  return shown
}
