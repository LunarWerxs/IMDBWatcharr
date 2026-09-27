// The page's two pieces of lifecycle, kept out of App so it stays a layout:
// which list to show when the page opens, and the poll that follows a list
// while its read from IMDb is pending.
import { useEffect, type Dispatch, type SetStateAction } from 'react'

import { readFeedStatus, readSession, type CreateFeedResponse, type Session } from '@/lib/api'

// The query parameter that carries a list across the sign-in round trip, so
// signing in from a result claims that list instead of landing on a blank form.
const LIST_PARAM = 'list'

// Set just before leaving for sign-in, so the page that comes back can tell its
// own round trip (build the list, which claims it) from someone else's link
// carrying ?list= (fill the field in, and let the visitor decide).
const SIGN_IN_LIST_KEY = 'imdbwatch:sign-in-list'

// The last list this tab built, so coming back from the sign-in page with the
// Back button (or reopening the site in the same tab) shows it again instead of
// an empty form: simulated visitors read the empty form as "my feeds are gone".
const LAST_LIST_KEY = 'imdbwatch:last-list'

/** Session storage that can be switched off, or throw in Safari, without breaking the page. */
function stored(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // Storage is off; the page just forgets, which is what it did before.
  }
}

/** The sign-in link, coming back to the given list when there is one. */
export function signInHref(listUrl?: string): string {
  const returnTo = listUrl ? `/?${LIST_PARAM}=${encodeURIComponent(listUrl)}` : '/'
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
}

export function rememberSignInList(listUrl?: string) {
  if (listUrl) store(SIGN_IN_LIST_KEY, listUrl)
}

export function rememberLastList(listUrl: string) {
  store(LAST_LIST_KEY, listUrl)
}

/** True once, for the list this tab itself carried through sign-in. */
function takeSignInList(listUrl: string): boolean {
  const expected = stored(SIGN_IN_LIST_KEY)
  store(SIGN_IN_LIST_KEY, null)
  return expected === listUrl
}

/** Take a list out of the address (the sign-in return, or a shared link), tidying the address. */
function takeListFromAddress(): string | null {
  const url = new URL(window.location.href)
  const list = url.searchParams.get(LIST_PARAM)
  if (list) {
    url.searchParams.delete(LIST_PARAM)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return list
}

/**
 * Which list to open with, and whether to build it straight away. A list in
 * the address is built when this tab carried it through sign-in, or when nobody
 * is signed in to claim it; a signed-in visitor following somebody else's link
 * decides for themselves. Otherwise the tab's last list comes back, rebuilt
 * automatically only when signed out, where building claims nothing.
 */
function startingList(session: Session): { list: string; build: boolean } | null {
  const fromAddress = takeListFromAddress()
  if (fromAddress) {
    return { list: fromAddress, build: takeSignInList(fromAddress) || !session.signedIn }
  }

  const last = stored(LAST_LIST_KEY)
  return last ? { list: last, build: !session.signedIn } : null
}

/** Read the session once, then hand the page the list it should open with. */
export function useStartingList({
  onSession,
  onList,
}: {
  onSession: (session: Session) => void
  onList: (list: string, build: boolean) => void
}) {
  useEffect(() => {
    let cancelled = false
    readSession().then((session) => {
      if (cancelled) return
      onSession(session)
      const start = startingList(session)
      if (start) onList(start.list, start.build)
    })
    return () => {
      cancelled = true
    }
    // Once, on the first render: the callbacks only set state.
  }, [])
}

/** Merge a status read into the result on screen, keeping what it does not carry (the URLs). */
export function mergeStatus(setResult: Dispatch<SetStateAction<CreateFeedResponse | null>>, slug: string) {
  return readFeedStatus(slug).then((status) =>
    setResult((current) => (current && current.slug === status.slug ? { ...current, ...status } : current)),
  )
}

/**
 * While a read from IMDb is pending, ask where the feed stands at the pace the
 * API suggests, instead of making the reader click Generate again to see
 * whether it landed. The status route is read-only and carries the counts, so a
 * poll never claims or re-queues anything (a list unfollowed mid-poll stays
 * unfollowed).
 */
export function useFeedStatusPoll(
  result: CreateFeedResponse | null,
  setResult: Dispatch<SetStateAction<CreateFeedResponse | null>>,
) {
  const pollSlug = result?.syncing ? result.slug : null
  const pollAfterMs = (result?.pollAfterSeconds ?? 30) * 1000

  useEffect(() => {
    if (!pollSlug) return

    const timer = setInterval(() => {
      mergeStatus(setResult, pollSlug).catch(() => {
        // A transient failure mid-poll is not worth surfacing over the result
        // already on screen; the next tick tries again.
      })
    }, pollAfterMs)

    return () => clearInterval(timer)
  }, [pollSlug, pollAfterMs, setResult])
}
