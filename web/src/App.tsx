import { useState, type FormEvent } from 'react'

import { TooltipProvider } from '@/components/ui/tooltip'
import { FaqSection } from '@/components/faq-section'
import { FeedsSection } from '@/components/feed-panel'
import { AskarrSection, FeedForm, Hero, HowItWorks, KeepUpdating } from '@/components/home-sections'
import { MyFeeds } from '@/components/my-feeds'
import { PosterRow } from '@/components/poster-row'
import { Reveal } from '@/components/reveal'
import { SignInLightbox } from '@/components/sign-in-lightbox'
import { PAGE_WIDTH, SiteFooter, SiteHeader, type SignInClick } from '@/components/site-chrome'
import { createFeed, isSupportedImdbUrl, type CreateFeedResponse, type Session } from '@/lib/api'
import { forgetLastList, mergeStatus, rememberLastList, useFeedStatusPoll, useStartingList } from '@/lib/feed-page'
import { scrollBehavior } from '@/lib/motion'
import { usePopupSignIn } from '@/lib/sign-in'

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
  })

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
  // The button stays live on an empty field (the field is `required`, so the
  // browser says what is missing): a disabled primary button read as "greyed
  // out and red at once" to a simulated visitor, who could not tell if it worked.
  const canSubmit = !pending

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

  // A list saved to the account, brought back up with its links and posters.
  function openSavedList(listUrl: string) {
    setSourceUrl(listUrl)
    void buildFeeds(listUrl)
    revealFeeds()
  }

  return (
    <TooltipProvider>
      <div className="bg-background text-foreground flex min-h-dvh flex-col overflow-x-clip">
        <SiteHeader session={session} listUrl={activeUrl} onSignIn={handleSignIn} />

        <main className={`${PAGE_WIDTH} flex-1 pb-20`}>
          <Hero />

          <FeedForm
            sourceUrl={sourceUrl}
            onSourceUrlChange={setSourceUrl}
            onClear={handleClear}
            looksValid={looksValid}
            pending={pending}
            canSubmit={canSubmit}
            signedIn={Boolean(session?.signedIn)}
            onSubmit={handleSubmit}
          />

          {session?.signedIn && (
            <MyFeeds
              refreshKey={result ? `${result.slug}:${result.status}:${result.owned}` : ''}
              onOpen={openSavedList}
              onUnfollowed={handleUnfollowed}
            />
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
        <SignInLightbox signIn={signIn} />
      </div>
    </TooltipProvider>
  )
}
