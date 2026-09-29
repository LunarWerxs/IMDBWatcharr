import { useCallback, useEffect, useState, useTransition } from 'react'
import { UsersIcon } from 'lucide-react'

import { SignInWithConnections } from '@/components/connections-sign-in'
import type { SignInClick } from '@/components/site-chrome'
import { Button } from '@/components/ui/button'
import { joinSharedList, readSharedInvite, type Session, type SharedInvite } from '@/lib/api'
import { joinSignInHref, rememberJoinAfterSignIn, takeJoinAfterSignIn } from '@/lib/feed-page'
import { notify } from '@/lib/notify'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * What a shared list's join link opens: whose list it is and how big, then
 * Join, or Sign in to join. A visitor who signs in from here joins as soon as
 * they are back, without being asked twice.
 */
export function JoinInvite({
  code,
  session,
  onSignIn,
  onJoined,
  onDismiss,
}: {
  code: string
  session: Session | null
  onSignIn: SignInClick
  onJoined: (slug: string) => void
  onDismiss: () => void
}) {
  const [invite, setInvite] = useState<SharedInvite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, startJoining] = useTransition()
  const signedIn = Boolean(session?.signedIn)

  // Read again once signed in: it then also says whether this person is already in.
  useEffect(() => {
    let cancelled = false
    readSharedInvite(code).then(
      (value) => {
        if (!cancelled) setInvite(value)
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'This invite link does not work.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [code, signedIn])

  const join = useCallback(
    () =>
      startJoining(async () => {
        try {
          const result = await joinSharedList(code)
          const joined = result.lists.find((list) => list.slug === result.slug)
          void notify('success', `You joined "${joined?.name ?? 'the shared feed'}". Add your IMDb lists to it.`)
          if (result.slug) startJoining(() => onJoined(result.slug as string))
        } catch (cause) {
          void notify('error', cause instanceof Error ? cause.message : 'Could not join. Try again.')
        }
      }),
    [code, onJoined],
  )

  // Back from signing in to join: join, rather than ask a second time.
  useEffect(() => {
    if (signedIn && takeJoinAfterSignIn(code)) join()
  }, [signedIn, code, join])

  if (!invite && !error) return null

  return (
    <section
      className="bg-card border-primary ring-foreground/10 mb-8 rounded-lg border-l-4 p-5 ring-1 sm:p-6"
      aria-labelledby="join-invite-title"
    >
      {error || !invite ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p id="join-invite-title" className="font-medium">
            {error}
          </p>
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Close
          </Button>
        </div>
      ) : (
        <>
          <h2 id="join-invite-title" className="flex items-center gap-2 text-xl font-bold">
            <UsersIcon className="text-ink size-5 shrink-0" aria-hidden="true" />
            Join “{invite.name}”
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-pretty">
            {invite.ownerName ?? 'Someone'} invited you to a shared feed: one Radarr link and one Sonarr link, fed by
            everyone’s IMDb lists. {plural(invite.sourceCount, 'IMDb list')} and{' '}
            {invite.memberCount === 1 ? '1 person' : `${invite.memberCount} people`} so far.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {invite.joined ? (
              <>
                <p className="font-medium">You are already in it.</p>
                <Button type="button" variant="ghost" onClick={onDismiss}>
                  Close
                </Button>
              </>
            ) : signedIn ? (
              <>
                <Button type="button" variant="cta" size="cta" onClick={join} disabled={joining}>
                  Join and add my lists
                </Button>
                <Button type="button" variant="ghost" onClick={onDismiss}>
                  Not now
                </Button>
              </>
            ) : session?.authAvailable ? (
              <>
                <SignInWithConnections
                  href={joinSignInHref(code)}
                  onClick={(event) => {
                    rememberJoinAfterSignIn(code)
                    onSignIn(event)
                  }}
                />
                <p className="text-muted-foreground text-sm">Joining needs an account. It is free.</p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Sign-in is not available here right now, so joining has to wait.</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
