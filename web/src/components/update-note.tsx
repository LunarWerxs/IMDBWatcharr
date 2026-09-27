import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'

import { Button } from '@/components/ui/button'
import type { SignInClick } from '@/components/site-chrome'
import { signInHref } from '@/lib/feed-page'
import type { CreateFeedResponse, Session } from '@/lib/api'

/**
 * A signed-out visitor's feed does not refresh itself. That used to be a whole
 * box in the result, which read as part of the page and got skipped (owner,
 * 2026-09-27); now it is a small note beside the status, with a pulsing dot so
 * it is noticed, that opens the explanation and the sign-in when clicked. The
 * sign-in comes back to this same list, so the list gets followed.
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

  const read = result.lastSyncedAt !== null

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="group/note border-primary/60 bg-primary/10 hover:bg-primary/20 inline-flex items-center gap-2 rounded-full border px-3 py-0.5 text-xs font-bold transition-colors motion-safe:animate-pop"
          style={{ animationDelay: '450ms' }}
        >
          <span className="relative flex size-2" aria-hidden="true">
            <span className="bg-primary absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping" />
            <span className="bg-primary relative inline-flex size-2 rounded-full" />
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
          className="bg-popover text-popover-foreground border-primary ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border-t-4 p-4 shadow-2xl ring-1"
        >
          <p className="font-bold">Keep this list up to date</p>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            {read
              ? 'Your links work now and keep working. We only read the list again when you come back and paste it.'
              : 'Once we have read the list, your links keep working. After that we only read it again when you come back and paste it.'}{' '}
            Sign in, free, and we check it for you about every fifteen minutes.
          </p>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            Connections is the free account every LunarWerx app signs in with. It opens in a small
            window over this page: type your email, enter the code it sends you, and this list is
            saved to your account.
          </p>
          <Button asChild size="sm" className="mt-3 w-full font-bold">
            <a
              href={signInHref(listUrl)}
              onClick={(event) => {
                setOpen(false)
                onSignIn(event)
              }}
            >
              Sign in with Connections
            </a>
          </Button>
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
