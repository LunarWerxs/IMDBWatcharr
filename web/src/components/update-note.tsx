import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'

import { SignInWithConnections } from '@/components/connections-sign-in'
import type { SignInClick } from '@/components/site-chrome'
import { signInHref } from '@/lib/feed-page'
import type { CreateFeedResponse, Session } from '@/lib/api'

/**
 * A signed-out visitor's feed does not refresh itself. That used to be a whole
 * box in the result, which read as part of the page and got skipped (owner,
 * 2026-09-27); now it is a small note beside the status, with a pulsing dot so
 * it is noticed, that opens the explanation and the sign-in when clicked. The
 * sign-in comes back to this same list, so the list gets followed. It is
 * orange, apart from the yellow status beside it, because it is the one thing
 * on the result a visitor should act on (owner, 2026-09-28).
 */
export function UpdateNote({
  session,
  result,
  listUrl,
  onSignIn,
}: {
  session: Session | null
  result: CreateFeedResponse
  listUrl: string
  onSignIn: SignInClick
}) {
  const [open, setOpen] = useState(false)

  if (!session?.authAvailable || session.signedIn || result.autoRefreshing) {
    return null
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="group/note inline-flex items-center gap-2 rounded-full border border-orange-500/70 bg-orange-500/15 px-3 py-0.5 text-xs font-bold text-orange-700 transition-colors hover:bg-orange-500/25 motion-safe:animate-pop dark:text-orange-300"
          style={{ animationDelay: '450ms' }}
        >
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inline-flex size-full rounded-full bg-orange-500 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2 rounded-full bg-orange-500" />
          </span>
          Won’t update by itself
          <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/note:rotate-180" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={10}
          collisionPadding={16}
          className="bg-popover text-popover-foreground ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-lg border-t-4 border-orange-500 p-4 shadow-2xl ring-1"
        >
          <p className="font-bold">Keep this list up to date</p>
          <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
            Right now we only read it again when you paste it here. Sign in, free, and we check it
            about every fifteen minutes.
          </p>
          <SignInWithConnections
            href={signInHref(listUrl)}
            onClick={(event) => {
              setOpen(false)
              onSignIn(event)
            }}
            className="mt-3 w-full"
          />
          <p className="text-muted-foreground mt-2 text-center text-xs">
            One free LunarWerx account. No password, just a code by email.
          </p>
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
