import { Suspense, useCallback, useState, type FormEvent, type MouseEvent } from 'react'

import { FaqSection } from '@/components/faq-section'
import { FeedsSection } from '@/components/feed-panel'
import { DemoBanner } from '@/components/demo-banner'
import { AskarrSection, FeedForm, Hero, HowItWorks, KeepUpdating } from '@/components/home-sections'
import { LibrarySkeleton } from '@/components/library-skeleton'
import { PosterRow } from '@/components/poster-row'
import { Reveal } from '@/components/reveal'
import { PAGE_WIDTH, SiteFooter, SiteHeader, type SignInClick } from '@/components/site-chrome'
import { createFeed, isSupportedImdbUrl, type CreateFeedResponse, type Session } from '@/lib/api'
import { forgetLastList, rememberLastList, rememberSignedIn, useFeedStatusPoll, useStartingList } from '@/lib/feed-page'
import { inDemo } from '@/lib/demo-mode'
import { lazyPart, useHydrated } from '@/lib/lazy'
import { scrollBehavior } from '@/lib/motion'
import { usePopupSignIn } from '@/lib/sign-in'

// Only a signed-in visitor has a library, only a join link shows an invite, and
// the lightbox only shows while the sign-in window is open.
const Library = lazyPart(() => import('@/components/library').then((module) => module.Library))
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
  // Known only in the browser, and after hydrating, so the prerendered page never disagrees.
  const demo = useHydrated() && inDemo()
  const [sourceUrl, setSourceUrl] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  // Signed in, the page is the library: the sales pitch is for people who have not signed up.
  const signedIn = Boolean(session?.signedIn)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateFeedResponse | null>(null)
  // The URL a poll should keep re-checking. Kept separate from `sourceUrl` so
  // editing the input mid-sync cannot redirect a poll already in flight.
  const [activeUrl, setActiveUrl] = useState('')
  // A shared feed's join link that brought the visitor here, and what the
  // library opens on: the feed just joined or followed, or the links a new feed
  // starts from (a list link someone sent, or the lists the visitor signed in
  // to combine).
  const [arrival, setArrival] = useState<{ joinCode: string | null; focus: string | null; draft: string[] | null }>({
    joinCode: null,
    focus: null,
    draft: null,
  })

  async function buildFeeds(listUrl: string) {
    setPending(true)
    setError(null)
    setResult(null)
    setActiveUrl(listUrl)

    try {
      const made = await createFeed(listUrl)
      setResult(made)
      rememberLastList(listUrl)
      // Signed in, building a list follows it, and the library opens on it.
      if (made.signedIn) setArrival((current) => ({ ...current, focus: `list:${made.slug}` }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }

  useStartingList({
    onSession: (next) => {
      setSession(next)
      rememberSignedIn(next.signedIn)
    },
    onList: (list, build) => {
      setSourceUrl(list)
      if (build) void buildFeeds(list)
      // A list link someone sent a signed-in visitor: a new feed, waiting for their yes.
      else setArrival((current) => ({ ...current, draft: [list] }))
    },
    onJoin: (joinCode) => setArrival((current) => ({ ...current, joinCode })),
  })

  const handleJoined = useCallback(
    (slug: string) => setArrival((current) => ({ ...current, joinCode: null, focus: `shared:${slug}` })),
    [],
  )

  const handleDraftTaken = useCallback(() => setArrival((current) => ({ ...current, draft: null })), [])

  useFeedStatusPoll(result, setResult)

  // Signing in from the window keeps this page where it is. The list on screen
  // is then built again, which, signed in, follows it; unless the visitor
  // signed in to combine lists, when the library starts a new feed with them.
  const signIn = usePopupSignIn((next, list) => {
    setSession(next)
    rememberSignedIn(true)
    if (list && !arrival.draft) void buildFeeds(list)
  })
  const handleSignIn: SignInClick = (event) => signIn.start(event, activeUrl)

  // "Add another list", signed out: once signed in, the library starts a new
  // feed from the link in the field and a second one to fill in.
  function handleSignInToCombine(event: MouseEvent<HTMLAnchorElement>) {
    const typed = sourceUrl.trim()
    setArrival((current) => ({ ...current, draft: [typed && isSupportedImdbUrl(typed) ? typed : '', ''] }))
    signIn.start(event)
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

  // One click on the form's example: it goes in the field and is built straight
  // away, with no Generate to press.
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
        {demo && <DemoBanner />}

        {arrival.joinCode && (
          <Suspense fallback={null}>
            <JoinInvite
              code={arrival.joinCode}
              session={session}
              onSignIn={handleSignIn}
              onJoined={handleJoined}
              onDismiss={() => setArrival((current) => ({ ...current, joinCode: null }))}
            />
          </Suspense>
        )}

        {signedIn ? (
          <Suspense fallback={<LibrarySkeleton />}>
            <Library session={session} focus={arrival.focus} draft={arrival.draft} onDraftTaken={handleDraftTaken} />
          </Suspense>
        ) : (
          <>
            {/* Until the session is read, a visitor who was signed in last time sees their
                library's outline here instead of the sales page (index.html, index.css). */}
            {session === null && <LibrarySkeleton hinted />}
            <div data-signed-out>
              <Hero />

              <FeedForm
                sourceUrl={sourceUrl}
                onSourceUrlChange={setSourceUrl}
                onClear={handleClear}
                looksValid={looksValid}
                pending={pending}
                session={session}
                onSubmit={handleSubmit}
                onSignInToCombine={handleSignInToCombine}
                onTry={openList}
              />

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
            </div>
          </>
        )}
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
