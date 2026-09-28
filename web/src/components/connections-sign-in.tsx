import type { MouseEventHandler } from 'react'

import { Button } from '@/components/ui/button'

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
    <Button asChild variant="cta" size="cta" className={className}>
      <a href={href} onClick={onClick}>
        <span data-icon="tile" className="bg-field grid size-7 shrink-0 place-items-center rounded-md shadow-sm">
          <img src="/brand/connections-mark.svg" alt="" width="20" height="20" className="size-5" />
        </span>
        Sign in with Connections
      </a>
    </Button>
  )
}
