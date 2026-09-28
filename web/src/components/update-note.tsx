import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'

import { SignInWithConnections } from '@/components/connections-sign-in'
import { NotePopover } from '@/components/note-popover'
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
    <NotePopover
      open={open}
      onOpenChange={setOpen}
      className="border-warn w-[min(20rem,calc(100vw-2rem))]"
      title="Keep this list up to date"
      text="Right now we only read it again when you paste it here. Sign in and we check it about every fifteen minutes."
      trigger={
        <button
          type="button"
          className="group/note border-warn/70 bg-warn/15 text-warn-ink hover:bg-warn/25 animation-delay-var inline-flex items-center gap-2 rounded-full border px-3 py-0.5 text-xs font-bold transition-colors motion-safe:animate-pop"
          style={{ '--delay': '450ms' }}
        >
          <span className="relative flex size-2" aria-hidden="true">
            <span className="bg-warn absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping" />
            <span className="bg-warn relative inline-flex size-2 rounded-full" />
          </span>
          Won’t update by itself
          <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/note:rotate-180" aria-hidden="true" />
        </button>
      }
    >
      <SignInWithConnections
        href={signInHref(listUrl)}
        onClick={(event) => {
          setOpen(false)
          onSignIn(event)
        }}
        className="mt-3 w-full"
      />
    </NotePopover>
  )
}
