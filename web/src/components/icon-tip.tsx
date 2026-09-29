import type { ReactNode } from 'react'

/**
 * A word or two under a header icon on hover or keyboard focus, drawn like the bell's pop-up
 * (ui/tooltip.tsx) but in CSS alone: the header is on every first paint, and a pop-up library there
 * would be in every first download. The icon's own accessible name says the same, so this is for
 * the eye only.
 */
export function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className="bg-foreground text-background pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 -translate-x-1/2 scale-95 rounded-md px-3 py-1.5 text-xs whitespace-nowrap opacity-0 transition duration-150 ease-(--ease-soft) group-hover/tip:scale-100 group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:scale-100 group-has-[:focus-visible]/tip:opacity-100 motion-reduce:transition-none"
      >
        <span className="bg-foreground absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-xs" />
        <span className="relative">{label}</span>
      </span>
    </span>
  )
}
