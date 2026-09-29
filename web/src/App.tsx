import { Suspense, useCallback, useState, type FormEvent } from 'react'

import { FaqSection } from '@/components/faq-section'
import { FeedsSection } from '@/components/feed-panel'
import { AskarrSection, FeedForm, Hero, HowItWorks, KeepUpdating } from '@/components/home-sections'
import { PosterRow } from '@/components/poster-row'
import { Reveal } from '@/components/reveal'
import { PAGE_WIDTH, SiteFooter, SiteHeader, type SignInClick } from '@/components/site-chrome'
import { createFeed, createSharedList, isSupportedImdbUrl, type CreateFeedResponse, type Session } from '@/lib/api'
import { forgetLastList, mergeStatus, rememberLastList, useFeedStatusPoll, useStartingList } from '@/lib/feed-page'
import { lazyPart } from '@/lib/lazy'
import { scrollBehavior } from '@/lib/motion'
import { notify } from '@/lib/notify'
import { usePopupSignIn } from '@/lib/sign-in'

// Only a signed-in visitor has feeds and shared lists, only a join link shows an
// invite, and the lightbox only shows while the sign-in window is open.
const MyFeeds = lazyPart(() => import('@/components/my-feeds').then((module) => module.MyFeeds))
const SharedLists = lazyPart(() => import('@/components/shared-lists').then((module) => module.SharedLists))
const JoinInvite = lazyPart(() => import('@/components/join-invite').then((module) => module.JoinInvite))
const SignInLightbox = lazyPart(() => import('@/components/sign-in-lightbox').then((module) => module.SignInLightbox))

/**
 * On a phone the results land below the fold, so pressing Generate brings the
 * panel up to watch it fill in. Where it is already on screen, nothing moves.
 */
function revealFeeds() {
  const heading = document.getElementById('your-feeds')
  if (heading && heading.getBoundingClientRect().top > window.innerHeight * 0.7) {
    heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }
}

export default function App() {
  const [sourceUrl, setSourceUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateFeedResponse | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  // The URL a poll should keep re-checking. Kept separate from `sourceUrl` so
  // editing the input mid-sync cannot redirect a poll already in flight.
  const [activeUrl, setActiveUrl] = useState('')
  // A shared list's join link that brought the visitor here, and the shared
  // list to bring into view: one just joined, or just made by Combine.
  const [shared, setShared] = useState<{ joinCode: string | null; focusSlug: string | null }>({
    joinCode: null,
    focusSlug: null,
  })

  async function buildFeeds(listUrl: string) {
    setPending(true)
    setError(null)
    setResult(null)
    setActiveUrl(listUrl)

    try {
      setResult(await createFeed(listUrl))
      rememberLastList(listUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }

  useStartingList({
    onSession: setSession,
    onList: (list, build) => {
      setSourceUrl(list)
      if (build) void buildFeeds(list)
    },
    onJoin: (joinCode) => setShared((current) => ({ ...current, joinCode })),
  })

  const handleJoined = useCallback((slug: string) => setShared({ joinCode: null, focusSlug: slug }), [])

  // More than one link in the form makes a shared list of them: one Radarr link
  // and one Sonarr link for all. Named after the person; they can rename it.
  async function combineLists(listUrls: string[]) {
    setPending(true)
    setError(null)
    setResult(null)
    setActiveUrl('')
    const firstName = session?.name?.trim().split(/\s+/)[0]
    const name = firstName ? `${firstName}’s lists` : 'My lists'

    try {
      const made = await createSharedList(name, listUrls)
      setShared((current) => ({ ...current, focusSlug: made.slug ?? null }))
      setSourceUrl('')
      forgetLastList()
      void notify('success', `Combined ${listUrls.length} lists into "${name}". Rename it any time.`)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
      return false
    } finally {
      setPending(false)
    }
  }

  useFeedStatusPoll(result, setResult)

  // Signing in from the window keeps this page as it is; the list on screen is
  // then built again, which, signed in, follows it.
  const signIn = usePopupSignIn((next, list) => {
    setSession(next)
    if (list) void buildFeeds(list)
  })
  const handleSignIn: SignInClick = (event) => signIn.start(event, activeUrl)

  // Unfollowing the list on screen from My feeds re-reads where it stands, so
  // the card stops saying it is being kept up to date.
  function handleUnfollowed(slug: string) {
    if (result?.slug !== slug) return
    mergeStatus(setResult, slug).catch(() => {
      // The card is only out of date; My feeds already shows the change.
    })
  }

  const trimmed = sourceUrl.trim()
  const looksValid = trimmed.length === 0 || isSupportedImdbUrl(trimmed)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    void buildFeeds(trimmed)
    revealFeeds()
  }

  // The X in the field: back to an empty page, and the list stays gone on the
  // next visit instead of coming back from this tab's memory.
  function handleClear() {
    setSourceUrl('')
    setActiveUrl('')
    setResult(null)
    setError(null)
    forgetLastList()
    document.getElementById('source-url')?.focus()
  }

  // One click on a list, from the account's saved lists or the form's example:
  // it goes in the field and is built straight away, with no Generate to press.
  function openList(listUrl: string) {
    if (pending) return
    setSourceUrl(listUrl)
    void buildFeeds(listUrl)
    revealFeeds()
  }

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader session={session} listUrl={activeUrl} onSignIn={handleSignIn} />

      <main className={`${PAGE_WIDTH} flex-1 pb-20`}>
        <Hero />

        {shared.joinCode && (
          <Suspense fallback={null}>
            <JoinInvite
              code={shared.joinCode}
              session={session}
              onSignIn={handleSignIn}
              onJoined={handleJoined}
              onDismiss={() => setShared((current) => ({ ...current, joinCode: null }))}
            />
          </Suspense>
        )}

        <FeedForm
          sourceUrl={sourceUrl}
          onSourceUrlChange={setSourceUrl}
          onClear={handleClear}
          looksValid={looksValid}
          pending={pending}
          session={session}
          onSubmit={handleSubmit}
          onCombine={combineLists}
          onSignIn={handleSignIn}
          onTry={openList}
        />

        {session?.signedIn && (
          <Suspense fallback={null}>
            <MyFeeds
              refreshKey={result ? `${result.slug}:${result.status}:${result.owned}` : ''}
              onOpen={openList}
              onUnfollowed={handleUnfollowed}
            />
          </Suspense>
        )}

        {session?.signedIn && (
          <Suspense fallback={null}>
            <SharedLists focusSlug={shared.focusSlug} />
          </Suspense>
        )}

        <Reveal>
          <FeedsSection
            pending={pending}
            error={error}
            result={result}
            session={session}
            listUrl={activeUrl}
            onSignIn={handleSignIn}
          />
        </Reveal>

        <Reveal>
          <PosterRow pending={pending} result={result} listUrl={activeUrl} />
        </Reveal>

        <Reveal>
          <HowItWorks />
        </Reveal>

        <Reveal>
          <KeepUpdating session={session} hasResult={pending || result !== null} onSignIn={handleSignIn} />
        </Reveal>

        <Reveal>
          <FaqSection />
        </Reveal>

        <Reveal>
          <AskarrSection />
        </Reveal>
      </main>

      <SiteFooter />
      {signIn.open && (
        <Suspense fallback={null}>
          <SignInLightbox signIn={signIn} />
        </Suspense>
      )}
    </div>
  )
}
