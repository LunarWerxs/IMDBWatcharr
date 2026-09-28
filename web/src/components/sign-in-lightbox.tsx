import { Dialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { rememberSignInList } from '@/lib/feed-page'
import type { PopupSignIn } from '@/lib/sign-in'

/**
 * What the page shows while the Connections window is open: the page dims,
 * says where the sign-in went, and offers to bring the window back. Closing it
 * only stops waiting; a sign-in finished later is still picked up next visit.
 */
export function SignInLightbox({ signIn }: { signIn: PopupSignIn }) {
  return (
    <Dialog.Root open={signIn.open} onOpenChange={(next) => !next && signIn.cancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/70 backdrop-blur-xs" />
        <Dialog.Content
          data-page-overlay=""
          className="bg-card text-card-foreground border-primary data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border-t-4 p-6 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold">Finish signing in</Dialog.Title>
          <Dialog.Description className="text-muted-foreground text-sm text-pretty">
            A small Connections window opened. Type your email there, enter the code it sends you,
            and it closes by itself. Your list stays right here.
          </Dialog.Description>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={signIn.reopen}>
              Show the window again
            </Button>
            <Button size="sm" variant="ghost" onClick={signIn.cancel}>
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            No window?{' '}
            <a
              href={signIn.fallbackHref}
              onClick={() => rememberSignInList(signIn.list ?? undefined)}
              className="hover:text-foreground underline underline-offset-2"
            >
              Sign in on this page instead
            </a>
            .
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
