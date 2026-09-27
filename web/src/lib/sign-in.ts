// Sign-in opens Connections in a small window over the page, so a visitor never
// leaves their list for a third party's full-page form. Connections cannot be
// framed (it sends X-Frame-Options: SAMEORIGIN), so a window is as close to an
// in-page lightbox as sign-in can get; the page dims behind it meanwhile.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'

import { readSession, type Session } from '@/lib/api'
import { rememberSignInList, signInHref } from '@/lib/feed-page'

const WINDOW_NAME = 'connections-sign-in'
// Must match the page /auth/callback answers the window with (src/auth.js).
const CHANNEL = 'watcharr-auth'
const SIGNED_IN = 'watcharr:signed-in'

function openSignInWindow(listUrl: string | null): Window | null {
  const width = 480
  const height = 720
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 3))
  return window.open(
    `${signInHref(listUrl ?? undefined)}&popup=1`,
    WINDOW_NAME,
    `popup,width=${width},height=${height},left=${left},top=${top}`,
  )
}

function isSignedInMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === SIGNED_IN
}

/**
 * The sign-in window and the lightbox the page shows while it is open. `start`
 * is a sign-in link's click handler: it opens the window and keeps the page
 * where it is, or, when the browser blocks the window (or the click asked for a
 * new tab), lets the link go to the full-page sign-in as before.
 */
export function usePopupSignIn(onSignedIn: (session: Session, listUrl: string | null) => void) {
  // The list the visitor was on when they chose to sign in; null when none.
  const [attempt, setAttempt] = useState<{ list: string | null } | null>(null)
  const onSignedInRef = useRef(onSignedIn)
  useEffect(() => {
    onSignedInRef.current = onSignedIn
  })

  const start = useCallback((event: MouseEvent<HTMLAnchorElement>, listUrl?: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const list = listUrl || null
    if (!openSignInWindow(list)) {
      // Blocked: the link carries on to the full-page sign-in, which comes back to this list.
      rememberSignInList(listUrl)
      return
    }

    event.preventDefault()
    setAttempt({ list })
  }, [])

  const reopen = useCallback(() => {
    openSignInWindow(attempt?.list ?? null)?.focus()
  }, [attempt])

  const cancel = useCallback(() => setAttempt(null), [])

  useEffect(() => {
    if (!attempt) return

    let settled = false
    // Every signal is only a hint to look: the session read decides.
    const check = async () => {
      const session = await readSession().catch(() => null)
      if (settled || !session?.signedIn) return
      settled = true
      setAttempt(null)
      onSignedInRef.current(session, attempt.list)
    }

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = (event) => {
        if (isSignedInMessage(event.data)) void check()
      }
    } catch {
      // No BroadcastChannel: coming back to this tab (focus) still notices.
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && isSignedInMessage(event.data)) void check()
    }
    // The window may have opened as a tab, or the browser may lack the channel.
    const onFocus = () => void check()

    window.addEventListener('message', onMessage)
    window.addEventListener('focus', onFocus)
    return () => {
      settled = true
      channel?.close()
      window.removeEventListener('message', onMessage)
      window.removeEventListener('focus', onFocus)
    }
  }, [attempt])

  return {
    open: attempt !== null,
    list: attempt?.list ?? null,
    // The full-page sign-in, for a visitor whose window never showed up.
    fallbackHref: signInHref(attempt?.list ?? undefined),
    start,
    reopen,
    cancel,
  }
}

export type PopupSignIn = ReturnType<typeof usePopupSignIn>
