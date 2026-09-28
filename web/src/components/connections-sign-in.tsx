import type { MouseEventHandler } from 'react'

import { Button } from '@/components/ui/button'

/**
 * The Connections mark, in its own colours (from Connections' brand kit,
 * flattened: at button size its gradients are invisible), cropped to the mark.
 */
export function ConnectionsLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="170 170 660 660" aria-hidden="true" className={className}>
      <path d="M721.4 327.7V498H551.1" fill="none" stroke="#fdbf14" strokeWidth="96" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="500.2" cy="498" r="87.5" fill="#fdb20e" />
      <path d="M312.8 721h357.9" fill="none" stroke="#3cb153" strokeWidth="100" strokeLinecap="round" />
      <circle cx="261.9" cy="721" r="87.5" fill="#36af52" />
      <circle cx="721.6" cy="721" r="104" fill="#36af52" />
      <path d="M312.8 279h357.9" fill="none" stroke="#4090fe" strokeWidth="100" strokeLinecap="round" />
      <circle cx="261.9" cy="279" r="87.5" fill="#4090fe" />
      <circle cx="721.4" cy="279" r="104" fill="#ef4430" />
      <circle cx="262.1" cy="500" r="55" fill="#a5a4a5" />
    </svg>
  )
}

/**
 * "Sign in with Connections", always carrying the Connections mark, the way
 * "Sign in with Google" always carries the G: on the yellow button it sits on
 * a white tile, so its own yellow still reads.
 */
export function SignInWithConnections({
  href,
  onClick,
  className = '',
}: {
  href: string
  onClick: MouseEventHandler<HTMLAnchorElement>
  className?: string
}) {
  return (
    <Button asChild className={`shine h-10 gap-2.5 ps-1.5 pe-5 font-bold ${className}`}>
      <a href={href} onClick={onClick}>
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white shadow-sm">
          <ConnectionsLogo className="size-5" />
        </span>
        Sign in with Connections
      </a>
    </Button>
  )
}
